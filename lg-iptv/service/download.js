// Offline downloads for movies and series episodes.
// Plain ES5: the TV runs Node 8 (no fs.promises, no recursive mkdir, no fs.statfs).
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var http = require('http');
var https = require('https');
var URL = require('url').URL;
var child = require('child_process');
var guard = require('./guard');

var MIN_FREE = 1024 * 1024 * 1024; // keep at least 1 GB free after a download
var MAX_JOBS = 80;
var META = 'index.json';
var UAS = ['LTVPlayer', 'VLC/3.0.21 LibVLC/3.0.21', 'IPTVSmartersPlayer'];

function mkdirp(dir) {
  try { fs.mkdirSync(dir); return true; } catch (e) {
    if (e.code === 'EEXIST') return true;
    if (e.code !== 'ENOENT') return false;
    var parent = path.dirname(dir);
    if (parent === dir || !mkdirp(parent)) return false;
    try { fs.mkdirSync(dir); return true; } catch (e2) { return e2.code === 'EEXIST'; }
  }
}

function pickDir(dirs) {
  for (var i = 0; i < dirs.length; i++) {
    var d = dirs[i];
    if (!d || !mkdirp(d)) continue;
    try {
      var probe = path.join(d, '.probe');
      fs.writeFileSync(probe, 'x');
      fs.unlinkSync(probe);
      return d;
    } catch (e) { /* next */ }
  }
  return '';
}

function idOf(url) { return crypto.createHash('sha1').update(String(url || '')).digest('hex'); }

function extOf(url, type) {
  var p = String(url || '').split(/[?#]/)[0];
  var m = /\.([a-z0-9]{2,5})$/i.exec(p);
  if (m) return m[1].toLowerCase();
  if (/mp4/i.test(type || '')) return 'mp4';
  if (/matroska|mkv/i.test(type || '')) return 'mkv';
  return 'bin';
}

function create(opts) {
  var dir = pickDir(opts.dirs || []);
  var jobs = {};          // id -> job
  var active = null;      // id currently writing
  var queue = [];         // ids waiting
  var listeners = [];     // status subscribers: fn(snapshot)
  var uaIndex = 0;

  function log(line) {
    try { fs.appendFileSync('/tmp/kayan-proxy.log', 'dl ' + line + '\n'); } catch (e) {}
  }

  function persist() {
    if (!dir) return;
    try {
      var list = Object.keys(jobs).map(function (k) { return publicJob(jobs[k]); });
      fs.writeFileSync(path.join(dir, META), JSON.stringify({ jobs: list }));
    } catch (e) { log('persist ' + e); }
  }

  function publicJob(j) {
    return {
      id: j.id, url: j.url, name: j.name, icon: j.icon || '', kind: j.kind || 'movies',
      seriesId: j.seriesId || '', seriesName: j.seriesName || '', season: j.season || '', ep: j.ep || '',
      status: j.status, bytes: j.bytes || 0, total: j.total || 0, error: j.error || '',
      path: j.path || '', ts: j.ts || 0, ext: j.ext || 'mp4'
    };
  }

  function emit() {
    var snap = snapshot();
    listeners.slice().forEach(function (fn) {
      try { fn(snap); } catch (e) {}
    });
  }

  function load() {
    if (!dir) return;
    try {
      var raw = fs.readFileSync(path.join(dir, META), 'utf8');
      var data = JSON.parse(raw);
      (data.jobs || []).forEach(function (j) {
        if (!j || !j.id) return;
        j.bytes = j.bytes || 0;
        j.total = j.total || 0;
        if (j.status === 'running' || j.status === 'queued') j.status = 'paused';
        // drop jobs whose file vanished
        if (j.status === 'done' && j.path) {
          try { fs.accessSync(j.path); } catch (e) { j.status = 'missing'; }
        }
        jobs[j.id] = j;
      });
    } catch (e) { /* first run */ }
  }

  function diskSpace(cb) {
    if (!dir) { cb(null, { free: 0, total: 0, used: 0, path: '' }); return; }
    // Node 18+: fs.statfs. On the TV (Node 8) we fall back to df.
    if (typeof fs.statfs === 'function') {
      try {
        fs.statfs(dir, function (err, s) {
          if (err || !s) { dfFallback(cb); return; }
          var bsize = s.bsize || s.frsize || 1;
          var free = (s.bavail != null ? s.bavail : s.bfree) * bsize;
          var total = s.blocks * bsize;
          cb(null, { free: free, total: total, used: Math.max(0, total - free), path: dir });
        });
        return;
      } catch (e) { /* fall through */ }
    }
    dfFallback(cb);
  }

  function dfFallback(cb) {
    child.exec('df -k "' + dir.replace(/"/g, '') + '"', { timeout: 4000 }, function (err, stdout) {
      if (err || !stdout) {
        // last resort: sum of file sizes we know about, free unknown
        var used = 0;
        Object.keys(jobs).forEach(function (k) { used += jobs[k].bytes || 0; });
        cb(null, { free: 0, total: used, used: used, path: dir, unknown: true });
        return;
      }
      var lines = String(stdout).trim().split(/\n/);
      var last = lines[lines.length - 1].trim().split(/\s+/);
      // Filesystem 1K-blocks Used Available Use% Mounted
      var totalK = parseInt(last[1], 10) || 0;
      var usedK = parseInt(last[2], 10) || 0;
      var freeK = parseInt(last[3], 10) || 0;
      cb(null, { free: freeK * 1024, total: totalK * 1024, used: usedK * 1024, path: dir });
    });
  }

  function headSize(url, cb, hops) {
    if ((hops || 0) > 5) { cb(new Error('bad url')); return; }
    guard.checkUrl(url, function (err, info) {
      if (err || !info) { cb(new Error('bad url')); return; }
      var lib = info.protocol === 'https:' ? https : http;
      var ua = UAS[uaIndex % UAS.length];
      var headers = { 'User-Agent': ua, 'Accept': '*/*' };
      var req = lib.request(guard.requestOptions(info, 'HEAD', headers), function (res) {
      var code = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].indexOf(code) >= 0 && res.headers.location) {
        res.resume();
        var next;
        try { next = new URL(res.headers.location, url).toString(); } catch (e) { cb(e); return; }
        headSize(next, cb, (hops || 0) + 1);
        return;
      }
      res.resume();
      var len = parseInt(res.headers['content-length'], 10);
      cb(null, {
        size: isFinite(len) && len > 0 ? len : 0,
        type: res.headers['content-type'] || '',
        acceptRanges: /bytes/i.test(String(res.headers['accept-ranges'] || ''))
      });
    });
      req.setTimeout(12000, function () { req.destroy(); cb(new Error('timeout')); });
      req.on('error', function (err2) { cb(err2); });
      req.end();
    });
  }

  function filePath(id, ext) { return path.join(dir, id + '.' + (ext || 'mp4')); }

  function checkSpace(need, cb) {
    diskSpace(function (err, sp) {
      if (err) { cb(err); return; }
      var free = sp.free || 0;
      var unknownSize = !(need > 0);
      var unknownFree = !!sp.unknown || free <= 0;
      if (!unknownSize && free > 0 && free < need) {
        cb(null, { ok: false, block: true, reason: 'nospace', need: need, free: free, space: sp });
        return;
      }
      var warn = false;
      var reason = '';
      if (unknownSize || unknownFree) { warn = true; reason = 'unknown'; }
      else if (free - need < MIN_FREE) { warn = true; reason = 'low'; }
      cb(null, { ok: true, warn: warn, reason: reason, need: need || 0, free: free, space: sp });
    });
  }

  function snapshot() {
    var list = Object.keys(jobs).map(function (k) { return publicJob(jobs[k]); });
    list.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    return { jobs: list, active: active, dir: dir || '' };
  }

  function pump() {
    if (active || !queue.length) { emit(); return; }
    var id = queue.shift();
    var j = jobs[id];
    if (!j || (j.status !== 'queued' && j.status !== 'paused')) { pump(); return; }
    runJob(j);
  }

  function runJob(j) {
    active = j.id;
    j.status = 'running';
    j.error = '';
    emit();
    persist();
    if ((j._hops || 0) > 5 || !dir) {
      j.status = 'error'; j.error = 'bad url'; active = null; persist(); emit(); pump(); return;
    }
    guard.checkUrl(j.url, function (chkErr, info) {
      if (active !== j.id || j.status !== 'running') return;
      if (chkErr || !info) {
        j.status = 'error'; j.error = 'bad url'; active = null; persist(); emit(); pump(); return;
      }
      var lib = info.protocol === 'https:' ? https : http;
      var ua = UAS[uaIndex % UAS.length];
      var headers = { 'User-Agent': ua, 'Accept': '*/*' };
      var existing = 0;
      try {
        if (j.path && fs.existsSync(j.path)) existing = fs.statSync(j.path).size;
      } catch (e) { existing = 0; }
      if (existing > 0 && j.total > 0 && existing >= j.total) {
        j.bytes = j.total; j.status = 'done'; active = null; persist(); emit(); pump(); return;
      }
      if (existing > 0) headers.Range = 'bytes=' + existing + '-';
      var settled = false;
      var req = lib.request(guard.requestOptions(info, 'GET', headers), function (res) {
      var code = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].indexOf(code) >= 0 && res.headers.location) {
        res.resume();
        j._hops = (j._hops || 0) + 1;
        try { j.url = new URL(res.headers.location, j.url).toString(); } catch (e) { fail(j, 'bad url'); return; }
        active = null;
        runJob(j);
        return;
      }
      if (code === 403 || code === 409) {
        res.resume();
        uaIndex = (uaIndex + 1) % UAS.length;
        if (!j._uaTried) { j._uaTried = 1; active = null; runJob(j); return; }
      }
      if (code >= 400 && code !== 206) {
        res.resume();
        fail(j, 'HTTP ' + code);
        return;
      }
      var len = parseInt(res.headers['content-length'], 10);
      if (code === 206) {
        var cr = String(res.headers['content-range'] || '');
        var m = /\/(\d+)\s*$/.exec(cr);
        if (m) j.total = parseInt(m[1], 10);
        j.bytes = existing;
      } else {
        // server ignored Range: rewrite from scratch
        if (existing > 0 && code === 200) {
          try { fs.unlinkSync(j.path); } catch (e) {}
          existing = 0; j.bytes = 0;
        }
        if (isFinite(len) && len > 0) j.total = len;
        j.bytes = 0;
      }
      if (!j.ext) j.ext = extOf(j.url, res.headers['content-type']);
      j.path = filePath(j.id, j.ext);
      var flags = existing > 0 && code === 206 ? 'a' : 'w';
      var out;
      try { out = fs.createWriteStream(j.path, { flags: flags }); }
      catch (e) { res.resume(); fail(j, String(e.message || e)); return; }

      j._req = req;
      j._res = res;
      j._out = out;

      res.on('data', function (chunk) {
        if (j.status !== 'running') return;
        j.bytes += chunk.length;
        if (!out.write(chunk)) res.pause();
      });
      out.on('drain', function () { if (j.status === 'running') res.resume(); });
      res.on('end', function () {
        out.end(function () {
          if (settled) return;
          settled = true;
          cleanupStreams(j);
          if (j.status === 'paused' || j.status === 'canceled') { active = null; persist(); emit(); pump(); return; }
          if (j.total > 0 && j.bytes < j.total * 0.98) {
            fail(j, 'incomplete');
            return;
          }
          j.status = 'done';
          j.total = j.total || j.bytes;
          active = null;
          persist();
          emit();
          pump();
        });
      });
      res.on('error', function (err) {
        if (settled) return;
        settled = true;
        cleanupStreams(j);
        if (j.status === 'paused' || j.status === 'canceled') { active = null; persist(); emit(); pump(); return; }
        fail(j, String(err.message || err));
      });
      out.on('error', function (err) {
        if (settled) return;
        settled = true;
        cleanupStreams(j);
        fail(j, String(err.message || err));
      });
      emit();
    });
    req.setTimeout(0);
    req.on('error', function (err) {
      if (settled) return;
      settled = true;
      if (j.status === 'paused' || j.status === 'canceled') { active = null; persist(); emit(); pump(); return; }
      fail(j, String(err.message || err));
    });
    j._req = req;
    req.end();
    });
  }

  function cleanupStreams(j) {
    try { if (j._req) j._req.destroy(); } catch (e) {}
    try { if (j._res && j._res.destroy) j._res.destroy(); } catch (e) {}
    try { if (j._out) j._out.destroy(); } catch (e) {}
    j._req = j._res = j._out = null;
  }

  function fail(j, msg) {
    cleanupStreams(j);
    j.status = 'error';
    j.error = msg || 'error';
    active = null;
    persist();
    emit();
    pump();
  }

  function start(meta, force, cb) {
    if (!dir) { cb(null, { ok: false, block: true, reason: 'nodir' }); return; }
    var url = meta && meta.url;
    if (!url) { cb(null, { ok: false, block: true, reason: 'badurl' }); return; }
    if (/\/live\//i.test(url) || meta.kind === 'live') {
      cb(null, { ok: false, block: true, reason: 'live' });
      return;
    }
    guard.checkUrl(url, function (chkErr) {
      if (chkErr) { cb(null, { ok: false, block: true, reason: 'badurl' }); return; }
    var id = meta.id || idOf(url);
    var existing = jobs[id];
    if (existing && (existing.status === 'done' || existing.status === 'running' || existing.status === 'queued')) {
      cb(null, { ok: true, job: publicJob(existing), already: true });
      return;
    }
    headSize(url, function (err, info) {
      var size = (info && info.size) || (meta.size || 0) || 0;
      checkSpace(size, function (err2, gate) {
        if (err2) { cb(err2); return; }
        if (gate.block && !force) { cb(null, gate); return; }
        if (gate.warn && !force) { cb(null, gate); return; }
        var j = existing || {
          id: id, url: url, name: meta.name || '', icon: meta.icon || '',
          kind: meta.kind || 'movies', seriesId: meta.seriesId || '', seriesName: meta.seriesName || '',
          season: meta.season || '', ep: meta.ep || '', bytes: 0, total: size, path: '', ext: extOf(url, info && info.type)
        };
        j.url = url;
        j.name = meta.name || j.name;
        j.icon = meta.icon || j.icon;
        j.kind = meta.kind || j.kind;
        j.seriesId = meta.seriesId || j.seriesId || '';
        j.seriesName = meta.seriesName || j.seriesName || '';
        j.season = meta.season || j.season || '';
        j.ep = meta.ep || j.ep || '';
        j.total = size || j.total || 0;
        j.status = 'queued';
        j.error = '';
        j.ts = Date.now();
        j.path = j.path || filePath(id, j.ext);
        jobs[id] = j;
        // cap list
        var keys = Object.keys(jobs);
        if (keys.length > MAX_JOBS) {
          keys.sort(function (a, b) { return (jobs[a].ts || 0) - (jobs[b].ts || 0); });
          keys.slice(0, keys.length - MAX_JOBS).forEach(function (k) {
            if (jobs[k].status === 'done' || jobs[k].status === 'error' || jobs[k].status === 'canceled') {
              try { if (jobs[k].path) fs.unlinkSync(jobs[k].path); } catch (e) {}
              delete jobs[k];
            }
          });
        }
        if (queue.indexOf(id) < 0) queue.push(id);
        persist();
        emit();
        pump();
        cb(null, { ok: true, warn: gate.warn, reason: gate.reason, need: gate.need, free: gate.free, space: gate.space, job: publicJob(j) });
      });
    });
    });
  }

  function pause(id, cb) {
    var j = jobs[id];
    if (!j) { cb(null, { ok: false }); return; }
    if (j.status === 'running' || j.status === 'queued') {
      j.status = 'paused';
      queue = queue.filter(function (x) { return x !== id; });
      cleanupStreams(j);
      if (active === id) active = null;
      persist(); emit(); pump();
    }
    cb(null, { ok: true, job: publicJob(j) });
  }

  function resume(id, cb) {
    var j = jobs[id];
    if (!j) { cb(null, { ok: false }); return; }
    if (j.status === 'paused' || j.status === 'error' || j.status === 'canceled') {
      j.status = 'queued';
      j.error = '';
      if (queue.indexOf(id) < 0) queue.push(id);
      persist(); emit(); pump();
    }
    cb(null, { ok: true, job: publicJob(j) });
  }

  function cancel(id, cb) {
    var j = jobs[id];
    if (!j) { cb(null, { ok: false }); return; }
    j.status = 'canceled';
    queue = queue.filter(function (x) { return x !== id; });
    cleanupStreams(j);
    if (active === id) active = null;
    try { if (j.path) fs.unlinkSync(j.path); } catch (e) {}
    j.bytes = 0; j.path = '';
    persist(); emit(); pump();
    cb(null, { ok: true });
  }

  function remove(id, cb) {
    var j = jobs[id];
    if (!j) { cb(null, { ok: false }); return; }
    queue = queue.filter(function (x) { return x !== id; });
    cleanupStreams(j);
    if (active === id) active = null;
    try { if (j.path) fs.unlinkSync(j.path); } catch (e) {}
    delete jobs[id];
    persist(); emit();
    pump();
    cb(null, { ok: true });
  }

  function get(id) { return jobs[id] ? publicJob(jobs[id]) : null; }
  function byUrl(url) { return get(idOf(url)); }

  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (x) { return x !== fn; });
    };
  }

  function serveFile(req, res, id) {
    var j = jobs[id];
    if (!j || j.status !== 'done' || !j.path) { res.writeHead(404); res.end('not found'); return; }
    var st;
    try { st = fs.statSync(j.path); } catch (e) { res.writeHead(404); res.end('missing'); return; }
    var types = { mp4: 'video/mp4', m4v: 'video/mp4', mkv: 'video/x-matroska', avi: 'video/x-msvideo', ts: 'video/mp2t', webm: 'video/webm' };
    var type = types[j.ext] || 'application/octet-stream';
    var range = req.headers.range;
    if (range) {
      var m = /bytes=(\d+)-(\d*)/.exec(range);
      if (m) {
        var start = parseInt(m[1], 10);
        var end = m[2] ? parseInt(m[2], 10) : st.size - 1;
        if (start >= st.size) { res.writeHead(416); res.end(); return; }
        end = Math.min(end, st.size - 1);
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Length': end - start + 1,
          'Content-Range': 'bytes ' + start + '-' + end + '/' + st.size,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store'
        });
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(j.path, { start: start, end: end }).pipe(res);
        return;
      }
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store'
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(j.path).pipe(res);
  }

  load();
  return {
    ready: !!dir,
    dir: dir,
    idOf: idOf,
    space: diskSpace,
    check: function (url, size, cb) {
      if (size > 0) { checkSpace(size, cb); return; }
      headSize(url, function (err, info) {
        checkSpace((info && info.size) || 0, cb);
      });
    },
    start: start,
    pause: pause,
    resume: resume,
    cancel: cancel,
    remove: remove,
    list: function () { return snapshot(); },
    get: get,
    byUrl: byUrl,
    subscribe: subscribe,
    serveFile: serveFile,
    headSize: headSize
  };
}

module.exports = { create: create, idOf: idOf, MIN_FREE: MIN_FREE };
