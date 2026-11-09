// Node checks for the TV helper. Run: node lg-iptv/service/guard.test.js
var assert = require('assert');
var fs = require('fs');
var http = require('http');
var os = require('os');
var path = require('path');

process.env.KAYAN_TOKEN_FILE = path.join(os.tmpdir(), 'kayan-proxy-test-' + process.pid + '.token');
try { fs.unlinkSync(process.env.KAYAN_TOKEN_FILE); } catch (e) {}

var guard = require('./guard');
var proxy = require('./proxy');

var failed = 0;
function check(name, fn) {
  try { fn(); console.log('ok ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n' + (e && e.stack || e)); }
}

function host(input) { return guard.classifyHost(input); }

check('blocks loopback, private, link-local, and documentation addresses', function () {
  ['127.0.0.1', '127.0.0.2', '0.0.0.0', '10.1.2.3', '192.168.1.1', '172.16.0.1', '172.31.255.255',
    '169.254.169.254', '100.64.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '198.18.0.1',
    '224.0.0.1', '255.255.255.255', '2130706433', '0177.0.0.1', '0x7f000001', '127.1',
    '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', 'ff02::1', '2001:db8::1', '::ffff:127.0.0.1', '::ffff:7f00:1'
  ].forEach(function (item) {
    var got = host(item);
    assert.strictEqual(got.kind, 'ip', item);
    assert.strictEqual(got.blocked, true, item);
  });
});

check('allows ordinary public addresses', function () {
  ['8.8.8.8', '1.1.1.1', '172.32.0.1', '11.0.0.1', '2001:4860:4860::8888'].forEach(function (item) {
    var got = host(item);
    assert.strictEqual(got.kind, 'ip', item);
    assert.strictEqual(got.blocked, false, item);
  });
});

check('blocks local names and accepts a public name', function () {
  ['localhost', 'foo.local', 'printer.lan', 'nas.internal', 'box.home.arpa'].forEach(function (item) {
    var got = host(item);
    assert.strictEqual(got.kind, 'name', item);
    assert.strictEqual(got.blocked, true, item);
  });
  var pub = host('cdn.example');
  assert.strictEqual(pub.kind, 'name');
  assert.strictEqual(pub.blocked, false);
});

function checkUrl(url) {
  return new Promise(function (resolve) {
    guard.checkUrl(url, function (err, info) { resolve({ err: err, info: info }); });
  });
}

var pending = Promise.resolve();
function later(name, fn) {
  pending = pending.then(function () {
    return Promise.resolve().then(fn).then(function () { console.log('ok ' + name); }, function (e) {
      failed++;
      console.error('FAIL ' + name + '\n' + (e && e.stack || e));
    });
  });
}

later('literal private URLs never resolve', function () {
  return Promise.all([
    'http://127.0.0.1/admin',
    'http://2130706433/',
    'http://[::1]/',
    'http://10.0.0.1/',
    'http://localhost/x',
    'http://example.com@127.0.0.1/',
    'http://169.254.169.254/latest/'
  ].map(checkUrl)).then(function (rows) {
    rows.forEach(function (row, i) { assert.ok(row.err, 'row ' + i); assert.ok(!row.info); });
  });
});

later('a public literal is pinned to that address', function () {
  return checkUrl('http://1.1.1.1/live/u/p/1.m3u8').then(function (row) {
    assert.ok(!row.err);
    assert.strictEqual(row.info.address, '1.1.1.1');
    assert.strictEqual(row.info.family, 4);
    assert.strictEqual(row.info.path, '/live/u/p/1.m3u8');
  });
});

later('a name that resolves to a private address is refused, and so is a mixed answer', function () {
  guard._setLookup(function (host, cb) {
    if (host === 'rebinder.example') cb(null, [{ address: '1.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 }]);
    else if (host === 'cdn.example') cb(null, [{ address: '1.1.1.1', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }]);
    else cb(new Error('dns'));
  });
  return checkUrl('http://rebinder.example/a').then(function (bad) {
    assert.ok(bad.err);
    return checkUrl('http://cdn.example/a');
  }).then(function (good) {
    assert.ok(!good.err);
    assert.strictEqual(good.info.address, '1.1.1.1');
    return checkUrl('http://missing.example/a');
  }).then(function (miss) {
    assert.ok(miss.err);
    guard._resetForTests();
  });
});

later('helper requires the app token, refuses other origins, and will not fetch the LAN', function () {
  return new Promise(function (resolve, reject) {
    var redirector = http.createServer(function (req, res) {
      res.writeHead(302, { Location: 'http://127.0.0.1/admin' });
      res.end();
    });
    redirector.listen(0, '127.0.0.1', function () {
      var redirPort = redirector.address().port;
      var seen = [];
      var real = guard.checkUrl;
      guard.checkUrl = function (url, cb) {
        seen.push(url);
        if (url.indexOf('http://redirect.test/') === 0) {
          cb(null, {
            protocol: 'http:', hostname: 'redirect.test', port: redirPort, path: '/',
            hostHeader: 'redirect.test', address: '127.0.0.1', family: 4
          });
          return;
        }
        real(url, cb);
      };
      proxy.listen(18771, function (err, port) {
        if (err) { guard.checkUrl = real; redirector.close(); reject(err); return; }
        var tok = proxy.token();
        assert.ok(/^[a-f0-9]{48}$/.test(tok));
        var hosts = proxy.bindHosts();
        assert.ok(hosts.indexOf('0.0.0.0') < 0, 'bind list ' + hosts.join(','));
        assert.ok(hosts.indexOf('127.0.0.1') >= 0);
        var wrapped = proxy.rewrite('#EXTM3U\nhttp://1.1.1.1/seg.ts\n', 'http://1.1.1.1/list.m3u8', '127.0.0.1', port);
        assert.ok(wrapped.indexOf('k=' + tok) >= 0);
        assert.ok(wrapped.indexOf('1.1.1.1') >= 0);

        function hit(method, path, headers, body) {
          return new Promise(function (res, rej) {
            var req = http.request({ host: '127.0.0.1', port: port, path: path, method: method, headers: headers || {} }, function (up) {
              var chunks = [];
              up.on('data', function (c) { chunks.push(c); });
              up.on('end', function () { res({ status: up.statusCode, headers: up.headers, body: Buffer.concat(chunks).toString('utf8') }); });
            });
            req.on('error', rej);
            if (body) req.write(body);
            req.end();
          });
        }

        hit('GET', '/seg.ts?u=' + encodeURIComponent('http://127.0.0.1/secret'), {}).then(function (noTok) {
          assert.strictEqual(noTok.status, 403);
          assert.ok(!noTok.headers['access-control-allow-origin']);
          return hit('GET', '/seg.ts?u=' + encodeURIComponent('http://10.1.2.3/a') + '&k=' + tok, { Origin: 'null' });
        }).then(function (priv) {
          assert.strictEqual(priv.status, 400);
          assert.strictEqual(priv.headers['access-control-allow-origin'], 'null');
          assert.ok(String(priv.headers['access-control-allow-origin']).indexOf('*') < 0);
          return hit('GET', '/seg.ts?k=' + tok + '&u=' + encodeURIComponent('http://192.168.0.1/'), { Origin: 'https://evil.example/' });
        }).then(function (evil) {
          assert.strictEqual(evil.status, 403);
          assert.ok(!evil.headers['access-control-allow-origin']);
          return hit('GET', '/seg.ts?k=' + tok + '&u=' + encodeURIComponent('http://redirect.test/movie'), {});
        }).then(function (redir) {
          assert.strictEqual(redir.status, 400);
          assert.strictEqual(redir.body, 'bad url');
          assert.ok(seen.some(function (u) { return u.indexOf('http://redirect.test/') === 0; }));
          assert.ok(seen.some(function (u) { return u.indexOf('http://127.0.0.1/admin') === 0; }));
          return hit('POST', '/dl/start?k=' + tok, { 'Content-Type': 'application/json', Origin: 'null' }, JSON.stringify({ url: 'http://127.0.0.1/movie.mp4', name: 'x', kind: 'movies' }));
        }).then(function (dl) {
          assert.strictEqual(dl.status, 200);
          var body = JSON.parse(dl.body);
          assert.strictEqual(body.ok, false);
          assert.strictEqual(body.reason, 'badurl');
          return hit('GET', '/dl/list?k=' + tok, { 'X-Kayan-Token': 'nope' });
        }).then(function (badHeader) {
          // query token wins; a wrong header does not replace a good query token
          assert.strictEqual(badHeader.status, 200);
          return hit('GET', '/dl/list', { 'X-Kayan-Token': tok });
        }).then(function (headerOnly) {
          assert.strictEqual(headerOnly.status, 200);
          guard.checkUrl = real;
          proxy.close(function () { redirector.close(function () { resolve(); }); });
        }).catch(function (e) {
          guard.checkUrl = real;
          proxy.close(function () { redirector.close(function () { reject(e); }); });
        });
      });
    });
  });
});

pending.then(function () {
  try { fs.unlinkSync(process.env.KAYAN_TOKEN_FILE); } catch (e) {}
  if (failed) {
    console.error(failed + ' failed');
    process.exit(1);
  }
  console.log('guard tests passed');
});
