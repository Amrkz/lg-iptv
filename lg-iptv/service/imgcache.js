// Picture cache for posters and channel logos.
// The first request for a picture downloads it once, keeps it on the TV's disk,
// and every later request (this session or after a restart) reads the local copy.
// Plain ES5 on purpose: the TV runs Node 8, which has no recursive mkdir and no fs.promises.
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var MAX_FILE = 8 * 1024 * 1024;     // a picture larger than this is not cached
var MAX_TOTAL = 64 * 1024 * 1024;   // /tmp on the TV is memory: when the folder grows past this, the oldest pictures go
var MAX_FETCHES = 5;                // downloads at the same time, so streams keep their share of the line
var FAIL_MS = 60000;                // a picture that failed is not asked for again for a minute
var IDLE_MS = 20000;                // a download that goes quiet this long is dropped
var TOUCH_MS = 3600000;             // "recently used" is refreshed at most once an hour per picture
var SIZES = { 92: 1, 154: 1, 185: 1, 342: 1, 500: 1 }; // the widths TMDB serves
var TYPES = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

function mkdirp(dir) {
  try { fs.mkdirSync(dir); return true; } catch (e) {
    if (e.code === 'EEXIST') return true;
    if (e.code !== 'ENOENT') return false;
    var parent = path.dirname(dir);
    if (parent === dir || !mkdirp(parent)) return false;
    try { fs.mkdirSync(dir); return true; } catch (e2) { return e2.code === 'EEXIST'; }
  }
}

// the first folder that can be created and written
function pickDir(dirs) {
  for (var i = 0; i < dirs.length; i++) {
    var d = dirs[i];
    if (!d || !mkdirp(d)) continue;
    try {
      var probe = path.join(d, '.probe');
      fs.writeFileSync(probe, 'x');
      fs.unlinkSync(probe);
      return d;
    } catch (e) { /* try the next one */ }
  }
  return '';
}

// Posters from TMDB come in many sizes, and the biggest is 2000 px wide. A card is 206 px wide.
function resize(url, w) {
  w = SIZES[w] ? w : 342;
  var m = /^(https?:\/\/image\.tmdb\.org\/t\/p\/)[^\/]+(\/[^?#]+)$/i.exec(String(url || ''));
  return m ? m[1] + 'w' + w + m[2] : url;
}

function keyOf(url) { return crypto.createHash('sha1').update(String(url)).digest('hex'); }

// Only real pictures are kept. An error page or a script saved under a picture address is not.
function sniff(b) {
  if (!b || b.length < 12) return '';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return '';
}

// opts.fetch(url, cb) -> cb(err, upstreamResponse, finalUrl); opts.dirs = folders to try, in order
function create(opts) {
  var dir = pickDir(opts.dirs || []);
  var index = {};      // key -> extension of the stored file
  var total = 0;       // bytes on disk, roughly
  var touched = {};    // key -> last time its "recently used" mark was refreshed
  var failed = {};     // key -> time of the last failure
  var inflight = {};   // key -> requests waiting for the same download
  var queue = [];      // downloads waiting for a free slot
  var running = 0;
  var pruning = false;

  function fileOf(key, ext) { return path.join(dir, key + '.' + ext); }

  function scan() {
    var names = [];
    try { names = fs.readdirSync(dir); } catch (e) { return; }
    names.forEach(function (n) {
      var m = /^([0-9a-f]{40})\.(jpg|png|gif|webp)$/.exec(n);
      if (m) {
        index[m[1]] = m[2];
        try { total += fs.statSync(path.join(dir, n)).size; } catch (e) { /* gone already */ }
      } else if (/\.part$/.test(n)) {
        try { fs.unlinkSync(path.join(dir, n)); } catch (e2) { /* ignore */ }
      }
    });
  }
  if (dir) scan();

  function prune() {
    if (pruning || total <= MAX_TOTAL) return;
    pruning = true;
    fs.readdir(dir, function (err, names) {
      if (err) { pruning = false; return; }
      var list = [];
      names.forEach(function (n) {
        if (!/^[0-9a-f]{40}\.(jpg|png|gif|webp)$/.test(n)) return;
        try { var st = fs.statSync(path.join(dir, n)); list.push({ n: n, size: st.size, t: st.mtime.getTime() }); } catch (e) { /* gone */ }
      });
      list.sort(function (a, b) { return a.t - b.t; });
      var sum = 0;
      list.forEach(function (f) { sum += f.size; });
      var goal = MAX_TOTAL * 0.8;
      for (var i = 0; i < list.length && sum > goal; i++) {
        try { fs.unlinkSync(path.join(dir, list[i].n)); } catch (e) { /* ignore */ }
        delete index[list[i].n.slice(0, 40)];
        sum -= list[i].size;
      }
      total = sum;
      pruning = false;
    });
  }

  function touch(key, ext) {
    var now = Date.now();
    if (touched[key] && now - touched[key] < TOUCH_MS) return;
    touched[key] = now;
    var d = new Date(now);
    fs.utimes(fileOf(key, ext), d, d, function () {});
  }

  // answer from the stored file; cb(err) only if the file turned out to be unreadable
  function send(req, res, key, ext, cb) {
    var file = fileOf(key, ext);
    fs.stat(file, function (err, st) {
      if (err || !st.isFile()) { cb(err || new Error('missing')); return; }
      var etag = '"' + key + '"';
      var headers = {
        'Content-Type': TYPES[ext],
        'Cache-Control': 'public, max-age=31536000, immutable',
        'ETag': etag
      };
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); touch(key, ext); return; }
      headers['Content-Length'] = st.size;
      res.writeHead(200, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      var rs = fs.createReadStream(file);
      rs.on('error', function () { try { res.destroy(); } catch (e) { /* ignore */ } });
      res.on('close', function () { try { rs.destroy(); } catch (e) { /* ignore */ } });
      rs.pipe(res);
      touch(key, ext);
    });
  }

  function download(url, key, done) {
    opts.fetch(url, function (err, up) {
      if (err || !up) { done(err || new Error('no answer')); return; }
      var code = up.statusCode || 0;
      if (code !== 200) { up.resume(); done(new Error('HTTP ' + code)); return; }
      if ((+up.headers['content-length'] || 0) > MAX_FILE) { up.destroy(); done(new Error('too big')); return; }
      var chunks = [], size = 0, over = false, ended = false, timer = null;
      function finish(e, ext) {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        done(e, ext);
      }
      function bump() {
        clearTimeout(timer);
        timer = setTimeout(function () { try { up.destroy(); } catch (e) { /* ignore */ } finish(new Error('stalled')); }, IDLE_MS);
      }
      bump();
      up.on('data', function (c) {
        bump();
        size += c.length;
        if (size > MAX_FILE) { over = true; try { up.destroy(); } catch (e) { /* ignore */ } finish(new Error('too big')); return; }
        chunks.push(c);
      });
      up.on('error', function (e) { finish(e); });
      up.on('close', function () { if (!ended && !up.complete) finish(new Error('closed early')); });
      up.on('end', function () {
        if (over || ended) return;
        var buf = Buffer.concat(chunks);
        var ext = sniff(buf);
        if (!ext) { finish(new Error('not a picture')); return; }
        var tmp = fileOf(key, ext) + '.part';
        fs.writeFile(tmp, buf, function (werr) {
          if (werr) { finish(werr); return; }
          fs.rename(tmp, fileOf(key, ext), function (rerr) {
            if (rerr) { finish(rerr); return; }
            index[key] = ext;
            total += buf.length;
            finish(null, ext);
            prune();
          });
        });
      });
    });
  }

  function pump() {
    while (running < MAX_FETCHES && queue.length) {
      (function (job) {
        running++;
        download(job.url, job.key, function (err, ext) {
          running--;
          var waiters = inflight[job.key] || [];
          delete inflight[job.key];
          if (err) failed[job.key] = Date.now();
          waiters.forEach(function (w) {
            if (err || !ext) { w.res.writeHead(502, { 'Content-Type': 'text/plain' }); w.res.end('picture not available'); return; }
            send(w.req, w.res, job.key, ext, function () {
              if (!w.res.headersSent) { w.res.writeHead(502); }
              w.res.end();
            });
          });
          pump();
        });
      })(queue.shift());
    }
  }

  // req/res are the incoming request and its answer. target is the picture address, w the width wanted.
  function serve(req, res, target, w) {
    if (!dir) { res.writeHead(503, { 'Content-Type': 'text/plain' }); res.end('no picture folder'); return; }
    var url = resize(target, +w);
    var key = keyOf(url);
    var ext = index[key];
    var again = function () {
      if (failed[key] && Date.now() - failed[key] < FAIL_MS) { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('picture not available'); return; }
      if (inflight[key]) { inflight[key].push({ req: req, res: res }); return; }
      inflight[key] = [{ req: req, res: res }];
      queue.push({ url: url, key: key });
      pump();
    };
    if (ext) {
      send(req, res, key, ext, function () { delete index[key]; again(); });
      return;
    }
    again();
  }

  return { dir: dir, serve: serve, stats: function () { return { dir: dir, files: Object.keys(index).length, bytes: total }; } };
}

module.exports = { create: create, resize: resize, sniff: sniff, keyOf: keyOf };
