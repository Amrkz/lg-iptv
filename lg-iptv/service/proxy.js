// Local playback proxy. The TV browser cannot change its User-Agent, and many
// providers answer that browser with HTTP 409. Playback is fetched with a
// normal player identity and handed to the video element.
//
// Only this app may use the helper. Each start creates a random token, returned
// on the Luna bus (not over the open network). Every HTTP request, including
// the segment links rewritten into a playlist, must carry that token. The TV
// player cannot set a header, so the token rides in the query string.
// Upstream targets on loopback, link-local, or private LAN ranges are refused,
// including after a redirect. TLS certificate checks stay off; see guard.js.
var http = require('http');
var https = require('https');
var fs = require('fs');
var crypto = require('crypto');
// The TV runs Node 8.12. The global URL object arrived in Node 10.
var URL = require('url').URL;
var guard = require('./guard');

var UAS = [
  'LTVPlayer',
  'VLC/3.0.21 LibVLC/3.0.21',
  'IPTVSmartersPlayer',
  'Lavf/61.1.100'
];
var uaIndex = 0;
var boundPort = 0;
var boundHosts = [];
var openServers = [];
var token = '';
var TOKEN_FILE = process.env.KAYAN_TOKEN_FILE || '/tmp/kayan-proxy.token';

// One line per stream request in /tmp/kayan-proxy.log, with the login and the
// helper token masked, so a movie that will not start can be read back from the TV.
// The file restarts when it grows past 200 KB.
var LOG_FILE = '/tmp/kayan-proxy.log';
function mask(u) {
  return String(u || '')
    .replace(/\/(movie|series|live|timeshift)\/[^\/]+\/[^\/]+\//g, '/$1/*/*/')
    .replace(/(username|password)=[^&]*/g, '$1=*')
    .replace(/([?&](?:k|token)=)[^&\s]*/g, '$1*');
}
function note(line) {
  try {
    try { if (fs.statSync(LOG_FILE).size > 200000) fs.writeFileSync(LOG_FILE, ''); } catch (e) { /* no file yet */ }
    fs.appendFileSync(LOG_FILE, new Date().toISOString().slice(11, 19) + ' ' + line + '\n');
  } catch (e) { /* the log is a help, never a reason to fail */ }
}

function readTokenFile() {
  try {
    var existing = String(fs.readFileSync(TOKEN_FILE, 'utf8') || '').trim();
    if (/^[a-f0-9]{48}$/.test(existing)) return existing;
  } catch (e) { /* not written yet */ }
  return '';
}

function tokenValue() {
  if (token) return token;
  var existing = readTokenFile();
  if (existing) token = existing;
  return token;
}

function ensureToken() {
  if (token) return token;
  var existing = readTokenFile();
  if (existing) { token = existing; return token; }
  var fresh = crypto.randomBytes(24).toString('hex');
  try {
    fs.writeFileSync(TOKEN_FILE, fresh, { flag: 'wx', mode: 384 });
    try { fs.chmodSync(TOKEN_FILE, 384); } catch (e1) { /* umask already applied */ }
    token = fresh;
    return token;
  } catch (e) {
    existing = readTokenFile();
    if (existing) { token = existing; return token; }
    try { fs.writeFileSync(TOKEN_FILE, fresh, { mode: 384 }); token = fresh; } catch (e2) { token = fresh; }
    return token;
  }
}

function tokenOk(got) {
  var a = String(got || '');
  var b = tokenValue();
  if (!b || a.length !== b.length) return false;
  var n = 0;
  var i;
  for (i = 0; i < a.length; i++) n |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return n === 0;
}

function absUrl(ref, base) {
  try { return new URL(ref, base).toString(); } catch (e) { return ref; }
}

function wrap(abs, host, port) {
  var path = 'seg.bin';
  if (/\.m3u8(\?|$)/i.test(abs)) path = 'list.m3u8';
  else if (/\.ts(\?|$)/i.test(abs)) path = 'seg.ts';
  else if (/\.mp4(\?|$)/i.test(abs)) path = 'seg.mp4';
  else if (/\.m4s(\?|$)/i.test(abs)) path = 'seg.m4s';
  else if (/\.(aac|mp3)(\?|$)/i.test(abs)) path = 'seg.aac';
  var url = 'http://' + host + ':' + port + '/' + path + '?u=' + encodeURIComponent(abs);
  var tok = tokenValue();
  if (tok) url += '&k=' + encodeURIComponent(tok);
  return url;
}

function rewrite(text, base, host, port) {
  return String(text || '').split(/\r?\n/).map(function (line) {
    if (!line) return line;
    if (line.charAt(0) === '#') {
      // webOS refuses a playlist that names more than one codec, and it does so without an error.
      line = line.replace(/,?\s*CODECS="[^"]*"/gi, '').replace(/:,/g, ':').replace(/,\s*,/g, ',').replace(/,\s*$/g, '');
      return line.replace(/URI="([^"]*)"/g, function (_, u) {
        return 'URI="' + wrap(absUrl(u, base), host, port) + '"';
      });
    }
    var trimmed = line.trim();
    if (!trimmed) return line;
    return wrap(absUrl(trimmed, base), host, port);
  }).join('\n');
}

// The media pipeline fetches from outside this app. It can open the TV's own
// address, and it often cannot open 127.0.0.1. Segment links must use the
// same host the playlist was requested on.
function requestHost(req) {
  var host = String((req.headers && req.headers.host) || '127.0.0.1').replace(/:\d+$/, '');
  if (host.charAt(0) === '[') {
    var end = host.indexOf(']');
    host = end >= 0 ? host.slice(1, end) : host;
  }
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return '127.0.0.1';
  return host;
}

function ownRequest(req) {
  var remote = String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
  if (remote === '127.0.0.1' || remote === '::1') return true;
  var local = String((req.socket && req.socket.localAddress) || '').replace(/^::ffff:/, '');
  if (remote && remote === local) return true;
  // The TV media pipeline often connects from a private address that is not
  // the address it connected to. Refusing that looks like a dead player.
  // A token is still required, so another device on the LAN cannot call this.
  var m = remote.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  var a = +m[1], b = +m[2];
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

function queryValue(search, name) {
  var parts = String(search || '').replace(/^\?/, '').split('&');
  var i;
  for (i = 0; i < parts.length; i++) {
    var pair = parts[i].split('=');
    var key = '';
    try { key = decodeURIComponent(pair[0] || ''); } catch (e) { key = pair[0] || ''; }
    if (key !== name) continue;
    var raw = pair.slice(1).join('=');
    try { return decodeURIComponent(raw.replace(/\+/g, ' ')); } catch (e2) { return raw; }
  }
  return '';
}

function presentedToken(req, search) {
  var fromQuery = queryValue(search, 'k');
  if (fromQuery) return fromQuery;
  var headers = req.headers || {};
  return String(headers['x-kayan-token'] || '');
}

// The page origin on webOS is an opaque file origin ("null") or a non-http
// app scheme. A normal website is refused. Missing Origin is the TV player,
// which does not send one; the token still has to match.
function originOk(origin) {
  if (!origin) return 'absent';
  var o = String(origin);
  if (o.length > 200 || /[\r\n]/.test(o)) return 'reject';
  if (o === 'null' || /^file:/i.test(o)) return 'ok';
  if (/^https?:\/\//i.test(o)) {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(o)) return 'ok';
    if (o.indexOf('kayaniptv') >= 0) return 'ok';
    return 'reject';
  }
  return 'ok';
}

function applyCors(req, res) {
  var origin = req.headers && req.headers.origin;
  var decision = originOk(origin);
  if (decision === 'reject') return false;
  if (decision === 'ok') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    var asked = req.headers['access-control-request-headers'];
    res.setHeader('Access-Control-Allow-Headers', asked || 'Content-Type, Range, Accept, X-Kayan-Token');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  return true;
}

// wait = how long the provider may take to start answering. A cold movie file can take 15 s or more.
function fetchOnce(target, ua, range, cb, wait) {
  var hops = 0;
  var settled = false;
  function done(err, res, finalUrl) {
    if (settled) return;
    settled = true;
    cb(err, res, finalUrl);
  }
  function go(current) {
    guard.checkUrl(current, function (err, info) {
      if (err || !info) { done(new Error('bad url')); return; }
      var lib = info.protocol === 'https:' ? https : http;
      var headers = { 'User-Agent': ua, 'Accept': '*/*' };
      if (range) headers.Range = range;
      var req = lib.request(guard.requestOptions(info, 'GET', headers), function (res) {
        var code = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].indexOf(code) >= 0 && res.headers.location && hops < 5) {
          hops++;
          var next;
          try { next = new URL(res.headers.location, current).toString(); } catch (e) { done(e); return; }
          res.resume();
          go(next);
          return;
        }
        req.setTimeout(0);
        done(null, res, current);
      });
      req.setTimeout(wait || 20000, function () { req.destroy(); done(new Error('timeout')); });
      req.on('error', function (reqErr) { done(reqErr); });
      req.end();
    });
  }
  go(target);
}

function fetchBest(target, range, cb, wait) {
  var start = uaIndex;
  var i = 0;
  function attempt() {
    var ua = UAS[(start + i) % UAS.length];
    fetchOnce(target, ua, range, function (err, res, finalUrl) {
      if (err) { cb(err); return; }
      var code = res.statusCode || 0;
      if ((code === 403 || code === 409) && i < UAS.length - 1) {
        res.resume();
        i++;
        attempt();
        return;
      }
      if (code > 0 && code < 400) uaIndex = (start + i) % UAS.length;
      cb(null, res, finalUrl);
    }, wait);
  }
  attempt();
}

// Posters and logos: downloaded once, kept on the TV's disk, served from there afterwards.
var images = null;
function pictures() {
  if (!images) {
    images = require('./imgcache').create({
      dirs: [process.env.KAYAN_IMG_DIR, '/media/developer/temp/kayan-img', '/var/tmp/kayan-img', '/tmp/kayan-img'],
      fetch: function (url, cb) { fetchBest(url, null, cb); }
    });
  }
  return images;
}

// Offline movie/episode downloads kept on the TV's app storage.
var downloads = null;
function dls() {
  if (!downloads) {
    downloads = require('./download').create({
      dirs: [process.env.KAYAN_DL_DIR, '/media/developer/apps/usr/palm/applications/com.amrkz.kayaniptv/downloads', '/media/developer/temp/kayan-dl', '/var/tmp/kayan-dl', '/tmp/kayan-dl']
    });
  }
  return downloads;
}

function readBody(req, cb) {
  var chunks = [], size = 0;
  req.on('data', function (c) {
    size += c.length;
    if (size < 200000) chunks.push(c);
  });
  req.on('end', function () {
    var raw = Buffer.concat(chunks).toString('utf8');
    var data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch (e) { data = {}; }
    cb(data);
  });
  req.on('error', function () { cb({}); });
}

function json(res, code, obj) {
  var body = JSON.stringify(obj || {});
  res.writeHead(code || 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function handleDownloadApi(req, res, pathOnly, search) {
  var d = dls();
  var id = queryValue(search, 'id');
  if (pathOnly === '/dl/file') {
    if (!id) { res.writeHead(400); res.end('id'); return true; }
    d.serveFile(req, res, id);
    return true;
  }
  if (req.method === 'GET' && pathOnly === '/dl/space') {
    d.space(function (err, sp) { json(res, 200, sp || { free: 0, total: 0, used: 0 }); });
    return true;
  }
  if (req.method === 'GET' && pathOnly === '/dl/list') {
    json(res, 200, d.list());
    return true;
  }
  if (req.method === 'GET' && pathOnly === '/dl/get') {
    json(res, 200, { job: id ? d.get(id) : d.byUrl(queryValue(search, 'u')) });
    return true;
  }
  if (req.method === 'POST' && pathOnly === '/dl/start') {
    readBody(req, function (body) {
      d.start(body || {}, !!body.force, function (err, result) {
        if (err) json(res, 500, { ok: false, error: String(err.message || err) });
        else json(res, 200, result || { ok: false });
      });
    });
    return true;
  }
  if (req.method === 'POST' && pathOnly === '/dl/pause') {
    readBody(req, function (body) { d.pause(body.id || id, function (err, r) { json(res, 200, r || { ok: false }); }); });
    return true;
  }
  if (req.method === 'POST' && pathOnly === '/dl/resume') {
    readBody(req, function (body) { d.resume(body.id || id, function (err, r) { json(res, 200, r || { ok: false }); }); });
    return true;
  }
  if (req.method === 'POST' && pathOnly === '/dl/cancel') {
    readBody(req, function (body) { d.cancel(body.id || id, function (err, r) { json(res, 200, r || { ok: false }); }); });
    return true;
  }
  if (req.method === 'POST' && pathOnly === '/dl/remove') {
    readBody(req, function (body) { d.remove(body.id || id, function (err, r) { json(res, 200, r || { ok: false }); }); });
    return true;
  }
  if (req.method === 'POST' && pathOnly === '/dl/check') {
    readBody(req, function (body) {
      d.check(body.url || '', body.size || 0, function (err, r) {
        if (err) json(res, 500, { ok: false, error: String(err.message || err) });
        else json(res, 200, r || { ok: false });
      });
    });
    return true;
  }
  return false;
}

// A movie file has no .m3u8 or .ts in its name. The TV player decides how to open it from the
// Content-Type, and some providers send none or a generic one.
var VIDEO_TYPES = { mp4: 'video/mp4', m4v: 'video/mp4', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mov: 'video/quicktime', webm: 'video/webm', ts: 'video/mp2t' };
function videoTypeOf(target) {
  var p = String(target || '').split(/[?#]/)[0];
  var m = /\.([a-z0-9]{2,4})$/i.exec(p);
  return m ? (VIDEO_TYPES[m[1].toLowerCase()] || '') : '';
}

function onRequest(req, res) {
  if (!ownRequest(req)) {
    note('reject remote ' + String((req.socket && req.socket.remoteAddress) || ''));
    res.writeHead(403); res.end(); return;
  }
  var q = String(req.url || '');
  var pathOnly = q.split('?')[0];
  var search = q.indexOf('?') >= 0 ? q.slice(q.indexOf('?')) : '';
  if (!tokenOk(presentedToken(req, search))) {
    note('reject token ' + (req.method || '') + ' ' + pathOnly);
    res.writeHead(403); res.end(); return;
  }
  if (!applyCors(req, res)) {
    note('reject origin ' + String((req.headers && req.headers.origin) || ''));
    res.writeHead(403); res.end(); return;
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (pathOnly.indexOf('/dl') === 0) {
    if (handleDownloadApi(req, res, pathOnly, search)) return;
    res.writeHead(404); res.end('dl'); return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  var target = queryValue(search, 'u');
  if (!target) { res.writeHead(400); res.end('bad url'); return; }
  if (pathOnly === '/img') { pictures().serve(req, res, target, queryValue(search, 'w')); return; }
  var asked = Date.now();
  var wait = /\.(m3u8|ts|m4s|aac)$/i.test(pathOnly) ? 20000 : 45000; // a playlist or segment is quick; a movie file may not be
  fetchBest(target, req.headers.range, function (err, up, finalUrl) {
    if (err || !up) {
      var why = err ? String(err.message || err) : 'upstream';
      note(req.method + ' ' + pathOnly + ' ' + mask(target) + ' range=' + (req.headers.range || '-') + ' -> ERROR ' + why);
      if (!res.headersSent) {
        var blocked = why === 'bad url';
        res.writeHead(blocked ? 400 : 502, { 'Content-Type': 'text/plain' });
        res.end(blocked ? 'bad url' : why);
      }
      return;
    }
    var code = up.statusCode || 502;
    if (!/\.(ts|m4s|aac)$/i.test(pathOnly)) {
      note(req.method + ' ' + pathOnly + ' ' + mask(target) + ' range=' + (req.headers.range || '-') + ' -> ' + code +
        ' type=' + (up.headers['content-type'] || '-') + ' len=' + (up.headers['content-length'] || '-') +
        ' range-back=' + (up.headers['content-range'] || '-') + ' ua=' + UAS[uaIndex] + ' ' + (Date.now() - asked) + 'ms');
    }
    var playlist = /\.m3u8$/i.test(pathOnly) || /mpegurl/i.test(String(up.headers['content-type'] || ''));
    if (code >= 400 || playlist) {
      var chunks = [];
      var size = 0;
      up.on('data', function (c) {
        size += c.length;
        if (size < 1500000) chunks.push(c);
      });
      up.on('end', function () {
        var buf = Buffer.concat(chunks);
        if (code >= 400) {
          // what the provider said, so a refusal can be read back from the log (login masked)
          note('   ' + code + ' says: ' + mask(buf.toString('utf8', 0, 400)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200));
          res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(buf.toString('utf8').slice(0, 300) || ('HTTP ' + code));
          return;
        }
        var text = buf.toString('utf8');
        if (text.indexOf('#EXTM3U') >= 0) text = rewrite(text, finalUrl, requestHost(req), boundPort);
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' });
        res.end(text);
      });
      up.on('error', function () {
        if (!res.headersSent) { res.writeHead(502); res.end(); }
      });
      return;
    }
    var type = up.headers['content-type'] || '';
    if (/\.ts$/i.test(pathOnly)) type = 'video/mp2t';
    else if (!type || /^(application\/octet-stream|binary\/octet-stream|text\/plain)/i.test(type)) type = videoTypeOf(finalUrl || target) || type || 'application/octet-stream';
    var headers = {
      'Content-Type': type,
      'Cache-Control': 'no-store'
    };
    if (up.headers['content-length']) headers['Content-Length'] = up.headers['content-length'];
    if (up.headers['content-range']) headers['Content-Range'] = up.headers['content-range'];
    if (up.headers['accept-ranges']) headers['Accept-Ranges'] = up.headers['accept-ranges'];
    res.writeHead(code, headers);
    // resume() would read the whole movie to throw it away, and hold the provider connection while it does.
    if (req.method === 'HEAD') { if (up.destroy) up.destroy(); res.end(); return; }
    up.pipe(res);
    var stop = function () { if (up.destroy) up.destroy(); };
    req.on('close', stop);
    res.on('close', stop);
  }, wait);
}

function lanAddrs() {
  var out = [];
  var os;
  try { os = require('os'); } catch (e) { return out; }
  var nets;
  try { nets = os.networkInterfaces(); } catch (e2) { return out; }
  if (!nets) return out;
  Object.keys(nets).forEach(function (name) {
    var list = nets[name] || [];
    var i;
    for (i = 0; i < list.length; i++) {
      var n = list[i];
      if (!n || n.internal) continue;
      if (n.family !== 'IPv4' && n.family !== 4) continue;
      if (!n.address || n.address === '0.0.0.0') continue;
      if (out.indexOf(n.address) < 0) out.push(n.address);
    }
  });
  return out;
}

// The native player opens the TV's LAN address. hls.js opens 127.0.0.1.
// Bind those addresses when we can see them. 0.0.0.0 is only the fallback
// for a TV that does not report a LAN address (binding loopback alone stays black).
function bindHosts() {
  var lans = lanAddrs();
  if (!lans.length) return ['0.0.0.0'];
  var hosts = lans.slice();
  if (hosts.indexOf('127.0.0.1') < 0) hosts.push('127.0.0.1');
  return hosts;
}

function shutdownServers() {
  var list = openServers.slice();
  openServers = [];
  list.forEach(function (s) { try { s.close(); } catch (e) {} });
}

function attempt(hosts, port, startPort, narrow, cb) {
  var pending = hosts.length;
  var failed = 0;
  var inUse = 0;
  var finished = false;
  function after() {
    if (finished) return;
    if (failed === 0) {
      finished = true;
      boundPort = port;
      boundHosts = hosts.slice();
      ensureToken();
      note('listen ' + hosts.join(',') + ' ' + port);
      cb(null, port);
      return;
    }
    shutdownServers();
    if (inUse && failed === hosts.length && port < startPort + 5) {
      finished = true;
      attempt(hosts, port + 1, startPort, narrow, cb);
      return;
    }
    if (narrow) {
      finished = true;
      note('listen narrow failed, falling back to 0.0.0.0');
      attempt(['0.0.0.0'], startPort, startPort, false, cb);
      return;
    }
    finished = true;
    var err = new Error('listen failed');
    err.code = inUse ? 'EADDRINUSE' : 'ELISTEN';
    cb(err);
  }
  hosts.forEach(function (host) {
    var server = http.createServer(onRequest);
    server.timeout = 0;
    if (server.requestTimeout !== undefined) server.requestTimeout = 0;
    var settled = false;
    function one(err) {
      if (settled || finished) return;
      settled = true;
      if (err) {
        if (err.code === 'EADDRINUSE') inUse++;
        failed++;
        try { server.close(); } catch (e) {}
      } else {
        openServers.push(server);
      }
      pending--;
      if (pending === 0) after();
    }
    server.on('error', function (err) { one(err || new Error('listen')); });
    server.listen(port, host, function () { one(null); });
  });
}

function listen(startPort, cb) {
  var port = startPort || 18491;
  var hosts = bindHosts();
  attempt(hosts, port, port, hosts[0] !== '0.0.0.0', cb);
}

function close(cb) {
  shutdownServers();
  boundPort = 0;
  if (cb) cb();
}

module.exports = {
  listen: listen,
  rewrite: rewrite,
  wrap: wrap,
  dls: dls,
  token: tokenValue,
  bindHosts: bindHosts,
  close: close
};
