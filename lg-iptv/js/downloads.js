// Offline downloads. Talks to the TV service over the local proxy HTTP API
// (and luna when the bus is available). Live TV is never downloaded.
const Downloads = (() => {
  // Capacitor Android provides a Filesystem-backed manager; use it when present.
  if (window.AndroidDownloads) return window.AndroidDownloads;
  const BUS = 'luna://com.amrkz.lumioplayer.proxy/';
  let cache = { jobs: [], space: null, at: 0 };
  let pollTimer = null;
  let listeners = [];

  function port() {
    return (window.API && API.proxyPort) || 0;
  }

  function base() {
    const p = port();
    return p ? ('http://127.0.0.1:' + p) : '';
  }

  function http(path, opts) {
    const root = base();
    if (!root) return Promise.reject(new Error('proxy offline'));
    const o = opts || {};
    return fetch(root + path, {
      method: o.method || 'GET',
      headers: o.body ? { 'Content-Type': 'application/json' } : undefined,
      body: o.body ? JSON.stringify(o.body) : undefined
    }).then(r => r.json().catch(() => ({})));
  }

  function luna(cmd, payload) {
    return new Promise(resolve => {
      if (!window.PalmServiceBridge) { resolve(null); return; }
      let done = false;
      const bridge = new PalmServiceBridge();
      const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 4000);
      bridge.onservicecallback = (raw) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { resolve(JSON.parse(raw)); } catch (e) { resolve(null); }
      };
      try { bridge.call(BUS + cmd, JSON.stringify(payload || {})); }
      catch (e) { clearTimeout(timer); resolve(null); }
    });
  }

  function notify() { listeners.forEach(fn => { try { fn(cache); } catch (e) {} }); }

  function setJobs(snap) {
    if (!snap) return;
    cache.jobs = snap.jobs || [];
    cache.at = Date.now();
    notify();
  }

  function refresh() {
    return Promise.all([
      http('/dl/list').catch(() => luna('dlList').then(r => r && r.returnValue === false ? null : r)),
      http('/dl/space').catch(() => luna('dlSpace').then(r => r && r.returnValue === false ? null : r))
    ]).then(pair => {
      if (pair[0]) setJobs(pair[0]);
      if (pair[1]) cache.space = pair[1];
      notify();
      return cache;
    }).catch(() => cache);
  }

  function startPolling() {
    if (pollTimer) return;
    const tick = () => { refresh().then(() => { pollTimer = setTimeout(tick, 1500); }); };
    tick();
  }

  function stopPolling() {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  function subscribe(fn) {
    listeners.push(fn);
    startPolling();
    return () => { listeners = listeners.filter(x => x !== fn); if (!listeners.length) stopPolling(); };
  }

  function jobByUrl(url) {
    if (!url) return null;
    const list = cache.jobs || [];
    for (let i = 0; i < list.length; i++) if (list[i].url === url) return list[i];
    return null;
  }

  function localUrl(job) {
    if (!job || job.status !== 'done') return null;
    const root = base();
    return root ? (root + '/dl/file?id=' + encodeURIComponent(job.id)) : null;
  }

  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function start(meta, force) {
    const body = Object.assign({}, meta, { force: !!force });
    return http('/dl/start', { method: 'POST', body: body }).catch(() =>
      luna('dlStart', body).then(r => r || { ok: false, reason: 'offline' })
    ).then(r => { refresh(); return r; });
  }

  function pause(id) {
    return http('/dl/pause', { method: 'POST', body: { id } }).catch(() => luna('dlPause', { id })).then(r => { refresh(); return r; });
  }
  function resume(id) {
    return http('/dl/resume', { method: 'POST', body: { id } }).catch(() => luna('dlResume', { id })).then(r => { refresh(); return r; });
  }
  function cancel(id) {
    return http('/dl/cancel', { method: 'POST', body: { id } }).catch(() => luna('dlCancel', { id })).then(r => { refresh(); return r; });
  }
  function remove(id) {
    return http('/dl/remove', { method: 'POST', body: { id } }).catch(() => luna('dlRemove', { id })).then(r => { refresh(); return r; });
  }

  // Prefer a finished local file when the viewer opens a title.
  function resolvePlayUrl(remoteUrl) {
    const job = jobByUrl(remoteUrl);
    const local = localUrl(job);
    return local || remoteUrl;
  }

  return {
    refresh, subscribe, start, pause, resume, cancel, remove,
    jobByUrl, localUrl, resolvePlayUrl, fmtBytes,
    get jobs() { return cache.jobs || []; },
    get space() { return cache.space; }
  };
})();
window.Downloads = Downloads;
