// Local playback proxy. The TV browser cannot change its User-Agent, and this
// provider answers 409 to that browser. Playback is fetched with a normal
// player identity and handed to the video element on 127.0.0.1 only.
var http = require('http');
var https = require('https');
// The TV runs Node 8.12. The global URL object arrived in Node 10.
var URL = require('url').URL;

var UAS = [
  'LTVPlayer',
  'VLC/3.0.21 LibVLC/3.0.21',
  'IPTVSmartersPlayer',
  'Lavf/61.1.100'
];
var uaIndex = 0;
var boundPort = 0;

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
  return 'http://' + host + ':' + port + '/' + path + '?u=' + encodeURIComponent(abs);
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

function allowed(target) {
  var parsed;
  try { parsed = new URL(target); } catch (e) { return null; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  var host = parsed.hostname;
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return null;
  return parsed;
}

function fetchOnce(target, ua, range, cb) {
  var hops = 0;
  var settled = false;
  function done(err, res, finalUrl) {
    if (settled) return;
    settled = true;
    cb(err, res, finalUrl);
  }
  function go(current) {
    var parsed = allowed(current);
    if (!parsed) { done(new Error('bad url')); return; }
    var lib = parsed.protocol === 'https:' ? https : http;
    var headers = { 'User-Agent': ua, 'Accept': '*/*' };
    if (range) headers.Range = range;
    var req = lib.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: headers,
      rejectUnauthorized: false
    }, function (res) {
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
    req.setTimeout(20000, function () { req.destroy(); done(new Error('timeout')); });
    req.on('error', function (err) { done(err); });
    req.end();
  }
  go(target);
}

function fetchBest(target, range, cb) {
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
    });
  }
  attempt();
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
}

function onRequest(req, res) {
  cors(res);
  if (!ownRequest(req)) { res.writeHead(403); res.end(); return; }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  var q = String(req.url || '');
  var pathOnly = q.split('?')[0];
  var target = queryValue(q.indexOf('?') >= 0 ? q.slice(q.indexOf('?')) : '', 'u');
  if (!target || !allowed(target)) { res.writeHead(400); res.end('bad url'); return; }
  fetchBest(target, req.headers.range, function (err, up, finalUrl) {
    if (err || !up) {
      if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end(err ? String(err.message || err) : 'upstream'); }
      return;
    }
    var code = up.statusCode || 502;
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
    else if (!type) type = 'application/octet-stream';
    var headers = {
      'Content-Type': type,
      'Cache-Control': 'no-store'
    };
    if (up.headers['content-length']) headers['Content-Length'] = up.headers['content-length'];
    if (up.headers['content-range']) headers['Content-Range'] = up.headers['content-range'];
    if (up.headers['accept-ranges']) headers['Accept-Ranges'] = up.headers['accept-ranges'];
    res.writeHead(code, headers);
    if (req.method === 'HEAD') { up.resume(); res.end(); return; }
    up.pipe(res);
    var stop = function () { if (up.destroy) up.destroy(); };
    req.on('close', stop);
    res.on('close', stop);
  });
}

function listen(startPort, cb) {
  var port = startPort;
  var hosts = ['0.0.0.0', '127.0.0.1'];
  var hostAt = 0;
  function attempt() {
    var host = hosts[hostAt];
    var server = http.createServer(onRequest);
    server.timeout = 0;
    if (server.requestTimeout !== undefined) server.requestTimeout = 0;
    server.on('error', function (err) {
      if (err && err.code === 'EADDRINUSE' && port < startPort + 5) { port++; attempt(); return; }
      if (hostAt < hosts.length - 1) { hostAt++; port = startPort; attempt(); return; }
      cb(err);
    });
    // 0.0.0.0 so the TV's media pipeline can open the TV's LAN address.
    // ownRequest() still refuses every other device. Loopback is the fallback.
    server.listen(port, host, function () {
      boundPort = port;
      cb(null, port);
    });
  }
  attempt();
}

module.exports = { listen: listen, rewrite: rewrite, wrap: wrap };
