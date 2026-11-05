// Android / Capacitor bridge. Safe no-op on webOS and desktop browsers.
(function () {
  'use strict';
  var isCap = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  var isAndroid = isCap && ((window.Capacitor.getPlatform && window.Capacitor.getPlatform()) === 'android');
  window.KayanPlatform = { isCapacitor: isCap, isAndroid: isAndroid, isWebOS: !!(window.PalmSystem || window.webOS) };

  // Mark body for CSS (touch scroll, TV banner spacing, etc.)
  try {
    document.documentElement.classList.add(isAndroid ? 'plat-android' : (window.KayanPlatform.isWebOS ? 'plat-webos' : 'plat-web'));
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      document.documentElement.classList.add('touch');
    }
  } catch (e) {}

  // Capacitor hardware Back -> same path as webOS BACK (keyCode 461)
  function wireBack() {
    try {
      var App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (!App || !App.addListener) return;
      App.addListener('backButton', function () {
        var ev;
        try {
          ev = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true });
          Object.defineProperty(ev, 'keyCode', { get: function () { return 27; } });
        } catch (err) {
          ev = document.createEvent('Event');
          ev.initEvent('keydown', true, true);
          try { Object.defineProperty(ev, 'keyCode', { value: 27 }); } catch (e2) {}
        }
        document.dispatchEvent(ev);
      });
    } catch (e) {}
  }

  // Prefer HLS on Android WebView (raw .ts is for native FFmpeg players)
  if (isAndroid) {
    try {
      document.documentElement.classList.add('prefer-hls');
    } catch (e) {}
  }

  // ---------- Downloads via Capacitor Filesystem (IndexedDB metadata) ----------
  function AndroidDownloads() {
    var Directory = { DATA: 'DATA', CACHE: 'CACHE', EXTERNAL: 'EXTERNAL', DOCUMENTS: 'DOCUMENTS' };
    var FS = null;
    var jobs = [];
    var space = { free: 0, total: 0, used: 0, ok: true };
    var listeners = [];
    var pollTimer = null;
    var META_KEY = 'kayan.android.dl.jobs';
    var DIR = 'kayan-downloads';

    function fs() {
      if (FS) return FS;
      FS = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
      return FS;
    }

    function notify() { listeners.forEach(function (fn) { try { fn({ jobs: jobs, space: space }); } catch (e) {} }); }

    function loadMeta() {
      try { jobs = JSON.parse(localStorage.getItem(META_KEY) || '[]') || []; }
      catch (e) { jobs = []; }
    }
    function saveMeta() {
      try { localStorage.setItem(META_KEY, JSON.stringify(jobs)); } catch (e) {}
      notify();
    }

    function fmtBytes(n) {
      n = Number(n) || 0;
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
      if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
      return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }

    function refreshSpace() {
      // Best-effort free space. navigator.storage.estimate is available in Chromium WebView.
      var p = (navigator.storage && navigator.storage.estimate)
        ? navigator.storage.estimate().then(function (est) {
            space = {
              free: Math.max(0, (est.quota || 0) - (est.usage || 0)),
              total: est.quota || 0,
              used: est.usage || 0,
              ok: true
            };
          }).catch(function () {})
        : Promise.resolve();
      return p.then(function () { notify(); return space; });
    }

    function ensureDir() {
      var F = fs();
      if (!F) return Promise.resolve();
      return F.mkdir({ path: DIR, directory: Directory.DATA, recursive: true }).catch(function () {});
    }

    function jobByUrl(url) {
      if (!url) return null;
      for (var i = 0; i < jobs.length; i++) if (jobs[i].url === url) return jobs[i];
      return null;
    }

    function localUrl(job) {
      if (!job || job.status !== 'done' || !job.path) return null;
      try {
        if (window.Capacitor && window.Capacitor.convertFileSrc) {
          // Filesystem path relative to DATA
          return window.Capacitor.convertFileSrc(job.nativeUri || job.path);
        }
      } catch (e) {}
      return job.objectUrl || null;
    }

    function uid() { return 'dl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

    function writeChunkBase64(path, base64, append) {
      var F = fs();
      return F.writeFile({
        path: path,
        data: base64,
        directory: Directory.DATA,
        recursive: true,
        append: !!append
      });
    }

    // Fetch as blob, write as base64 in pieces so large VODs don't blow RAM twice.
    function downloadToFile(job) {
      job.status = 'running';
      job.error = '';
      saveMeta();
      return ensureDir().then(function () {
        return fetch(job.url, { credentials: 'omit', mode: 'cors' }).then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          var total = Number(res.headers.get('content-length') || 0);
          job.total = total;
          var reader = res.body && res.body.getReader ? res.body.getReader() : null;
          if (!reader || !window.btoa) {
            return res.arrayBuffer().then(function (buf) {
              var bytes = new Uint8Array(buf);
              job.total = bytes.length;
              job.received = bytes.length;
              var b64 = arrayBufferToBase64(bytes);
              var path = DIR + '/' + job.id + (job.ext || '.bin');
              return writeChunkBase64(path, b64, false).then(function () {
                return fs().getUri({ path: path, directory: Directory.DATA }).then(function (u) {
                  job.path = path;
                  job.nativeUri = u.uri;
                  job.status = 'done';
                  job.received = bytes.length;
                  saveMeta();
                  return job;
                });
              });
            });
          }
          // Streaming path: accumulate then write (WebView Filesystem API is file-oriented).
          var chunks = [];
          var received = 0;
          function pump() {
            return reader.read().then(function (r) {
              if (r.done) return;
              chunks.push(r.value);
              received += r.value.length;
              job.received = received;
              if (job.total) job.pct = Math.min(99, Math.floor(received / job.total * 100));
              if (job._paused) throw new Error('paused');
              if (job._cancel) throw new Error('cancelled');
              // notify occasionally
              if (received % (512 * 1024) < r.value.length) saveMeta();
              return pump();
            });
          }
          return pump().then(function () {
            var bytes = concatChunks(chunks, received);
            var b64 = arrayBufferToBase64(bytes);
            var path = DIR + '/' + job.id + (job.ext || '.bin');
            return writeChunkBase64(path, b64, false).then(function () {
              return fs().getUri({ path: path, directory: Directory.DATA }).then(function (u) {
                job.path = path;
                job.nativeUri = u.uri;
                job.status = 'done';
                job.pct = 100;
                job.received = received;
                saveMeta();
                return job;
              });
            });
          });
        });
      }).catch(function (err) {
        if (job._cancel) { job.status = 'cancelled'; }
        else if (job._paused) { job.status = 'paused'; }
        else { job.status = 'error'; job.error = String(err && err.message || err); }
        saveMeta();
        return job;
      });
    }

    function concatChunks(chunks, total) {
      var out = new Uint8Array(total);
      var off = 0;
      for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], off); off += chunks[i].length; }
      return out;
    }

    function arrayBufferToBase64(bytes) {
      var binary = '';
      var chunk = 0x8000;
      for (var i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    }

    function guessExt(url, meta) {
      if (meta && meta.ext) return meta.ext.charAt(0) === '.' ? meta.ext : '.' + meta.ext;
      var m = String(url || '').match(/\.([a-z0-9]{2,4})(?:\?|$)/i);
      if (m) return '.' + m[1].toLowerCase();
      return '.mp4';
    }

    function start(meta, force) {
      meta = meta || {};
      if (!meta.url) return Promise.resolve({ ok: false, reason: 'no url' });
      var existing = jobByUrl(meta.url);
      if (existing && existing.status === 'done' && !force) return Promise.resolve({ ok: true, job: existing, reason: 'exists' });
      if (existing && (existing.status === 'running' || existing.status === 'paused') && !force) {
        return Promise.resolve({ ok: true, job: existing, reason: 'active' });
      }
      return refreshSpace().then(function () {
        // Warn if free space looks tight (< 500 MB) unless force
        var needWarn = space.free && space.free < 500 * 1024 * 1024;
        if (needWarn && !force && !meta.force) {
          return { ok: false, reason: 'low-space', free: space.free, freeLabel: fmtBytes(space.free) };
        }
        var job = existing && force ? existing : {
          id: uid(),
          url: meta.url,
          title: meta.title || 'Download',
          subtitle: meta.subtitle || '',
          kind: meta.kind || 'movie',
          poster: meta.poster || '',
          status: 'queued',
          received: 0,
          total: 0,
          pct: 0,
          created: Date.now()
        };
        job.ext = guessExt(meta.url, meta);
        job._paused = false;
        job._cancel = false;
        if (!existing || force) {
          if (existing) jobs = jobs.filter(function (j) { return j.id !== existing.id; });
          jobs.unshift(job);
        }
        saveMeta();
        // Fire and forget download
        downloadToFile(job);
        return { ok: true, job: job };
      });
    }

    function pause(id) {
      var j = jobs.filter(function (x) { return x.id === id; })[0];
      if (j) { j._paused = true; j.status = 'paused'; saveMeta(); }
      return Promise.resolve({ ok: true });
    }
    function resume(id) {
      var j = jobs.filter(function (x) { return x.id === id; })[0];
      if (j && j.status === 'paused') {
        j._paused = false;
        downloadToFile(j);
      }
      return Promise.resolve({ ok: true });
    }
    function cancel(id) {
      var j = jobs.filter(function (x) { return x.id === id; })[0];
      if (j) { j._cancel = true; j.status = 'cancelled'; saveMeta(); }
      return Promise.resolve({ ok: true });
    }
    function remove(id) {
      var j = jobs.filter(function (x) { return x.id === id; })[0];
      jobs = jobs.filter(function (x) { return x.id !== id; });
      saveMeta();
      if (j && j.path && fs()) {
        fs().deleteFile({ path: j.path, directory: Directory.DATA }).catch(function () {});
      }
      return Promise.resolve({ ok: true });
    }

    function refresh() {
      loadMeta();
      return refreshSpace().then(function () { return { jobs: jobs, space: space }; });
    }

    function subscribe(fn) {
      listeners.push(fn);
      if (!pollTimer) {
        var tick = function () {
          refreshSpace();
          pollTimer = setTimeout(tick, 2000);
        };
        tick();
      }
      fn({ jobs: jobs, space: space });
      return function () {
        listeners = listeners.filter(function (x) { return x !== fn; });
        if (!listeners.length) { clearTimeout(pollTimer); pollTimer = null; }
      };
    }

    function resolvePlayUrl(remoteUrl) {
      var job = jobByUrl(remoteUrl);
      var local = localUrl(job);
      return local || remoteUrl;
    }

    loadMeta();
    refreshSpace();

    return {
      refresh: refresh, subscribe: subscribe, start: start, pause: pause, resume: resume,
      cancel: cancel, remove: remove, jobByUrl: jobByUrl, localUrl: localUrl,
      resolvePlayUrl: resolvePlayUrl, fmtBytes: fmtBytes,
      get jobs() { return jobs; },
      get space() { return space; }
    };
  }

  if (isAndroid) {
    window.AndroidDownloads = AndroidDownloads();
  }

  function boot() {
    wireBack();
    // Soften exit on Android: stay in app / minimize instead of window.close
    if (isAndroid && typeof window.exitApp === 'function') {
      /* keys.js defines exitApp later; patch after load */
    }
    document.addEventListener('DOMContentLoaded', function () {
      if (!isAndroid) return;
      // Replace exitApp to background the app
      window.exitApp = function () {
        try {
          var App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
          if (App && App.minimizeApp) { App.minimizeApp(); return; }
          if (App && App.exitApp) { App.exitApp(); return; }
        } catch (e) {}
      };
      // Patch keys.js exitApp if it closed over its own function — redefine on window used by askExit
      try {
        // keys.js uses function exitApp() which is global in non-module script
      } catch (e) {}
    });
  }
  boot();
})();
