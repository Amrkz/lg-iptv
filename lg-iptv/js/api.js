// Written for older webOS Chromium (no async/await, no object spread, no .flat()).
const API = (() => {
  let cfg = null;
  let m3uItems = null;

  const store = (k, v) => { try { localStorage.setItem('iptv_' + k, JSON.stringify(v)); } catch (e) { /* quota/private mode */ } };
  const load = (k) => { try { return JSON.parse(localStorage.getItem('iptv_' + k)); } catch (e) { return null; } };

  function niceError(e) {
    if (e instanceof SyntaxError) return new Error(tr('Bad response from server'));
    if (e instanceof TypeError) return new Error(tr('Cannot reach server (network or CORS blocked)'));
    return e;
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(tr('Server timed out'))), ms);
      promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }

  function fetchJson(url) {
    return withTimeout(fetch(url), 30000)
      .then(r => { if (!r.ok) throw new Error(tr('Server error {code}', { code: r.status })); return r.json(); })
      .catch(e => { throw niceError(e); });
  }

  function fetchText(url) {
    return withTimeout(fetch(url), 60000)
      .then(r => { if (!r.ok) throw new Error(tr('Server error {code}', { code: r.status })); return r.text(); })
      .catch(e => { throw niceError(e); });
  }

  function getConfig() { if (!cfg) cfg = load('cfg'); return cfg; }
  // lists belong to one login: a new login must not see the last one's lists
  function clearConfig() {
    cfg = null; m3uItems = null;
    clearLists();
    Object.keys(allCache).forEach(k => { delete allCache[k]; });
    try { localStorage.removeItem('iptv_cfg'); } catch (e) {}
  }

  // Accepts "host:port", "http://host:port/", "http://host:port/c/", or a full
  // get.php / player_api.php link (username and password are lifted from its query).
  function parseServer(input) {
    let s = (input || '').trim();
    if (!s) return { server: '', user: null, pass: null };
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    const q = s.match(/[?&]username=([^&#]*)/i);
    const w = s.match(/[?&]password=([^&#]*)/i);
    const safeDecode = (v) => { try { return decodeURIComponent(v); } catch (e) { return v; } };
    s = s.replace(/[?#].*$/, '')
         .replace(/\/(player_api|get|panel_api|xmltv|portal)\.php$/i, '')
         .replace(/\/c\/?$/i, '')
         .replace(/\/+$/, '');
    return { server: s, user: q ? safeDecode(q[1]) : null, pass: w ? safeDecode(w[1]) : null };
  }

  function rememberLogin(patch) {
    const last = load('last') || {};
    Object.keys(patch).forEach(k => { last[k] = patch[k]; });
    store('last', last);
  }
  function getLast() { return load('last') || {}; }

  function xtreamLogin(serverInput, user, pass) {
    const parsed = parseServer(serverInput);
    const server = parsed.server;
    user = user || parsed.user;
    pass = pass || parsed.pass;
    if (!server || !user || !pass) return Promise.reject(new Error(tr('Fill in server, username and password')));
    const url = `${server}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;
    return fetchJson(url).then(j => {
      const ui = j && j.user_info;
      if (!ui || Number(ui.auth) !== 1) throw new Error(tr('Login refused: check username and password'));
      if (ui.status && String(ui.status).toLowerCase() !== 'active') throw new Error(tr('Account {status}', { status: ui.status }));
      if (ui.exp_date && Number(ui.exp_date) > 0 && Number(ui.exp_date) * 1000 < Date.now()) throw new Error(tr('Account expired'));
      const formats = Array.isArray(ui.allowed_output_formats) ? ui.allowed_output_formats : [];
      clearLists();
      cfg = { type: 'xtream', server, user, pass, formats };
      store('cfg', cfg);
      rememberLogin({ server, user });
      return cfg;
    });
  }

  // Only the URL is persisted (playlists can be many MB and overflow localStorage).
  function m3uLogin(url) {
    if (!url) return Promise.reject(new Error(tr('Enter a playlist URL')));
    return fetchText(url).then(text => {
      const items = parseM3U(text);
      if (!items.length) throw new Error(tr('No channels found in playlist'));
      m3uItems = items;
      cfg = { type: 'm3u', url };
      store('cfg', cfg);
      rememberLogin({ m3u: url });
      return cfg;
    });
  }

  // After an app restart an M3U playlist must be fetched again.
  function ensureLoaded() {
    const c = getConfig();
    if (c && c.type === 'm3u' && !m3uItems) {
      return fetchText(c.url).then(text => { m3uItems = parseM3U(text); });
    }
    return Promise.resolve();
  }

  function xtreamGet(action, extra) {
    const c = getConfig();
    return fetchJson(`${c.server}/player_api.php?username=${encodeURIComponent(c.user)}&password=${encodeURIComponent(c.pass)}&action=${action}${extra || ''}`);
  }

  function classify(url) {
    if (/\/series\//i.test(url)) return 'series';
    if (/\/movie\//i.test(url) || /\.(mp4|mkv|avi)(\?|$)/i.test(url)) return 'movies';
    return 'live';
  }

  function parseM3U(text) {
    const lines = text.split(/\r?\n/);
    const items = [];
    let cur = null;
    lines.forEach(line => {
      line = line.trim();
      if (line.indexOf('#EXTINF') === 0) {
        // blank out quoted attributes first, so the title is everything after the first remaining comma
        const nameMatch = line.replace(/"[^"]*"/g, '""').match(/,(.*)$/);
        const logoMatch = line.match(/tvg-logo="([^"]*)"/);
        const groupMatch = line.match(/group-title="([^"]*)"/);
        cur = {
          name: nameMatch && nameMatch[1].trim() ? nameMatch[1].trim() : tr('Unknown'),
          icon: logoMatch ? logoMatch[1] : '',
          group: groupMatch && groupMatch[1] ? groupMatch[1] : tr('Other'),
          url: ''
        };
      } else if (line && line.charAt(0) !== '#' && cur) {
        cur.url = line;
        cur.type = classify(line);
        items.push(cur);
        cur = null;
      }
    });
    return items;
  }

  function m3uOf(kind) { return (m3uItems || []).filter(i => i.type === kind); }

  // Lists stay in memory for a while, and two screens asking for the same list share one request.
  // A failed request is not kept, so the next visit asks again.
  const LIST_TTL = 10 * 60 * 1000;
  const listCache = {};
  function cachedList(key, make) {
    const hit = listCache[key];
    if (hit && Date.now() - hit.t < LIST_TTL) return hit.p;
    const p = make().then(v => {
      if (!Array.isArray(v)) throw new Error(tr('The provider did not send a list'));
      return v;
    }).catch(e => { delete listCache[key]; throw e; });
    listCache[key] = { t: Date.now(), p };
    return p;
  }
  function clearLists() { Object.keys(listCache).forEach(k => { delete listCache[k]; }); }

  function getCategories(kind) {
    const c = getConfig();
    if (c.type === 'm3u') {
      const seen = {}, cats = [];
      m3uOf(kind).forEach(i => {
        if (!seen[i.group]) { seen[i.group] = true; cats.push({ category_id: i.group, category_name: i.group }); }
      });
      return Promise.resolve(cats);
    }
    const action = kind === 'live' ? 'get_live_categories' : kind === 'movies' ? 'get_vod_categories' : 'get_series_categories';
    // a provider with no categories answers with an empty list or nothing; that is not an error
    return cachedList('c:' + kind, () => xtreamGet(action).then(v => (Array.isArray(v) ? v : [])));
  }

  // Errors are passed on, so the screen can say what went wrong. An empty shelf looks like "no movies".
  function getStreams(kind, catId) {
    const c = getConfig();
    const all = !catId || catId === 'all';
    if (c.type === 'm3u') {
      return Promise.resolve(m3uOf(kind).filter(i => all || i.group === catId));
    }
    const action = kind === 'live' ? 'get_live_streams' : kind === 'movies' ? 'get_vod_streams' : 'get_series';
    return cachedList('s:' + kind + ':' + (all ? 'all' : catId), () => xtreamGet(action, all ? '' : `&category_id=${encodeURIComponent(catId)}`));
  }

  // webOS plays an HLS playlist. A raw endless .ts file is what the Android
  // app's FFmpeg player uses, and the TV video element sits on it without a picture.
  function liveExt(c) {
    const f = c.formats || [];
    // Android WebView + hls.js need an HLS playlist; raw .ts is for native FFmpeg players.
    if (window.KayanPlatform && window.KayanPlatform.isAndroid) return 'm3u8';
    return f.length && f.indexOf('m3u8') < 0 && f.indexOf('ts') >= 0 ? 'ts' : 'm3u8';
  }

  // The other live format, tried automatically if the first one fails.
  function liveAltUrl(item) {
    const c = getConfig();
    if (!c || c.type !== 'xtream' || item.url) return null;
    const f = c.formats || [];
    const alt = liveExt(c) === 'm3u8' ? 'ts' : 'm3u8';
    if (f.length && f.indexOf(alt) < 0) return null;
    return `${c.server}/live/${encodeURIComponent(c.user)}/${encodeURIComponent(c.pass)}/${item.stream_id}.${alt}`;
  }

  function streamUrl(item, kind) {
    if (item.url) return item.url; // M3U items, episodes, favorites
    const c = getConfig();
    const u = encodeURIComponent(c.user), p = encodeURIComponent(c.pass);
    if (kind === 'live') return `${c.server}/live/${u}/${p}/${item.stream_id}.${liveExt(c)}`;
    if (kind === 'movies') return `${c.server}/movie/${u}/${p}/${item.stream_id}.${item.container_extension || 'mp4'}`;
    return null; // xtream series need an episode pick first
  }

  function getSeriesInfo(id) { return xtreamGet('get_series_info', `&series_id=${encodeURIComponent(id)}`); }
  function getVodInfo(id) { return xtreamGet('get_vod_info', `&vod_id=${encodeURIComponent(id)}`); }

  // ---------- whole-catalog lists (for search) ----------
  // Fetched once per kind on first search, then kept in memory.
  const allCache = {};
  function getAll(kind) {
    const c = getConfig();
    if (c.type === 'm3u') return Promise.resolve(m3uOf(kind));
    if (allCache[kind]) return allCache[kind];
    const action = kind === 'live' ? 'get_live_streams' : kind === 'movies' ? 'get_vod_streams' : 'get_series';
    allCache[kind] = xtreamGet(action).then(l => (Array.isArray(l) ? l : [])).catch(e => { delete allCache[kind]; throw e; });
    return allCache[kind];
  }

  // fold case, Arabic letter variants and diacritics, so "اخبار" also finds "أخبار"
  function norm(str) {
    return String(str || '').toLowerCase()
      .replace(/[ً-ْـ]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/\s+/g, ' ').trim();
  }

  function search(q) {
    const n = norm(q);
    const kinds = ['live', 'movies', 'series'];
    return Promise.all(kinds.map(k => getAll(k).catch(() => []))).then(lists => {
      const out = {};
      kinds.forEach((k, i) => {
        out[k] = lists[i].filter(it => {
          if (it._n === undefined) it._n = norm(it.name || it.title); // normalise once per item
          return it._n.indexOf(n) >= 0;
        }).slice(0, 60);
      });
      return out;
    });
  }

  // ---------- TV guide: now / next for one channel ----------
  const epgCache = {};
  function b64(str) { try { return decodeURIComponent(escape(atob(str))); } catch (e) { return str || ''; } }
  function getShortEpg(streamId) {
    const c = getConfig();
    if (!c || c.type !== 'xtream' || !streamId) return Promise.resolve([]);
    const hit = epgCache[streamId];
    if (hit && Date.now() - hit.t < 120000) return hit.p;
    const p = xtreamGet('get_short_epg', `&stream_id=${encodeURIComponent(streamId)}&limit=2`).then(r => {
      const list = (r && r.epg_listings) || [];
      return list.map(e => ({
        title: b64(e.title), desc: b64(e.description),
        start: Number(e.start_timestamp) * 1000, end: Number(e.stop_timestamp || e.end_timestamp) * 1000,
        startStr: String(e.start || '')
      })).filter(e => e.title && e.start && e.end);
    }).catch(() => []);
    epgCache[streamId] = { t: Date.now(), p };
    return p;
  }

  // Past and current programmes of one channel, for catch-up. archive = the provider kept a recording.
  function getArchiveGuide(streamId) {
    const c = getConfig();
    if (!c || c.type !== 'xtream' || !streamId) return Promise.resolve([]);
    return xtreamGet('get_simple_data_table', `&stream_id=${encodeURIComponent(streamId)}`).then(r => {
      const list = (r && r.epg_listings) || [];
      return list.map(e => ({
        title: b64(e.title), desc: b64(e.description),
        start: Number(e.start_timestamp) * 1000, end: Number(e.stop_timestamp || e.end_timestamp) * 1000,
        startStr: String(e.start || ''),
        archive: Number(e.has_archive) === 1, now: Number(e.now_playing) === 1
      })).filter(e => e.title && e.start && e.end);
    }).catch(() => []);
  }

  // Xtream replay links. The stamp is the provider's own clock, so use its start text when it sent one.
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function timeshiftStamp(prog) {
    const m = String(prog.startStr || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3] + ':' + m[4] + '-' + m[5];
    const d = new Date(prog.start);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ':' + pad2(d.getHours()) + '-' + pad2(d.getMinutes());
  }
  // First link is tried first; the rest are tried one by one if it fails.
  function catchupUrls(item, prog) {
    const c = getConfig();
    if (!c || c.type !== 'xtream' || !item || !item.stream_id || !prog) return null;
    const mins = Math.max(1, Math.ceil((prog.end - prog.start) / 60000));
    const u = encodeURIComponent(c.user), p = encodeURIComponent(c.pass);
    const stamp = timeshiftStamp(prog);
    const ext = liveExt(c), alt = ext === 'm3u8' ? 'ts' : 'm3u8';
    const base = `${c.server}/timeshift/${u}/${p}/${mins}/${stamp}/${item.stream_id}`;
    return [
      base + '.' + ext,
      base + '.' + alt,
      `${c.server}/streaming/timeshift.php?username=${u}&password=${p}&stream=${encodeURIComponent(item.stream_id)}&start=${stamp}&duration=${mins}`
    ];
  }
  function hasArchive(item) { return !!item && Number(item.tv_archive) === 1; }

  // small saved settings (picture mode, subtitle style, chosen languages) and learned intros
  function pref(key, value) {
    if (value === undefined) return load('pref_' + key);
    store('pref_' + key, value);
    return value;
  }
  function getIntro(sid) { const m = load('intro') || {}; return m[sid] || null; }
  function setIntro(sid, range) {
    const m = load('intro') || {};
    m[sid] = range;
    const keys = Object.keys(m);
    if (keys.length > 200) delete m[keys[0]];
    store('intro', m);
  }

  // movie details (plot, genre, rating...), cached per title
  const vodInfoCache = {};
  function getVodInfoCached(id) {
    if (!vodInfoCache[id]) vodInfoCache[id] = getVodInfo(id).catch(() => null);
    return vodInfoCache[id];
  }

  // ---------- recently watched movies and series ----------
  // One short list per kind: the title, newest first. A series is kept as the series, not as an episode.
  // Old builds may have stored one row per episode; fold those into one series entry on read.
  function collapseWatchedSeries(list) {
    const byKey = {}, order = [];
    let changed = false;
    (list || []).forEach(w => {
      let key = w.key, entry = w;
      const sid = w.series_id != null && w.series_id !== '' ? w.series_id : (w.sid != null && w.sid !== '' ? w.sid : null);
      if (sid != null) {
        key = 's' + sid;
        entry = { key: key, series_id: sid, name: w.name || w.seriesName || w.sname || '', cover: w.cover || w.seriesCover || w.icon || '' };
        if (w.key !== key) changed = true;
      } else if (w.url && /\/series\//i.test(w.url)) {
        const nm = String(w.name || '').split(/\s*[·|]\s*/)[0].trim() || w.name || '';
        key = 'n:' + String(nm).toLowerCase();
        entry = { key: key, name: nm, cover: w.cover || w.icon || '' };
        changed = true;
      }
      if (!byKey[key]) { byKey[key] = entry; order.push(key); }
      else changed = true;
    });
    return { list: order.map(k => byKey[k]), changed: changed };
  }
  function getWatched(kind) {
    const raw = load('watched_' + kind) || [];
    if (kind !== 'series') return raw;
    const migrated = collapseWatchedSeries(raw);
    if (migrated.changed) store('watched_series', migrated.list);
    return migrated.list;
  }
  function addWatched(kind, entry) {
    const list = getWatched(kind).filter(w => w.key !== entry.key);
    list.unshift(entry);
    store('watched_' + kind, list.slice(0, 20));
  }

  // ---------- recently watched channels ----------
  function getRecent() { return load('recent') || []; }
  function addRecent(item) {
    const list = getRecent().filter(r => r.key !== item.key);
    list.unshift(item);
    store('recent', list.slice(0, 20));
  }

  // Watch progress ("continue watching"): { [url]: { url, name, icon, kind, t, d, ts, sid?, sname?, sn?, epn?, scover? } }
  const MAX_PROGRESS = 60;
  function progressMap() { return load('prog') || {}; }
  function getProgress(url) { return progressMap()[url] || null; }

  // Fill series fields on old rows that only saved "Title · S2:E5 …" in the name.
  function normalizeProgress(e) {
    if (!e || typeof e !== 'object') return e;
    const out = Object.assign({}, e);
    const parts = String(out.name || '').split(/\s*[·|]\s*/);
    if ((out.sid == null || out.sid === '') && parts.length >= 2) {
      const ep = parts[1].match(/S\s*(\d+)\s*[:\s]*E\s*(\d+)/i) || parts[1].match(/م\s*(\d+)\s*[:\s]*ح\s*(\d+)/i);
      if (ep) {
        if (!out.sname) out.sname = parts[0].trim();
        if (out.sn == null || out.sn === '') out.sn = ep[1];
        if (out.epn == null || out.epn === '') out.epn = ep[2];
      }
    }
    if (!out.kind && /\/series\//i.test(out.url || '')) out.kind = 'series';
    if (!out.sname && out.kind === 'series' && parts[0]) out.sname = parts[0].trim();
    return out;
  }

  // Group key: one card per series (by id, else by series name), one card per movie/url.
  function progressGroupKey(e) {
    e = normalizeProgress(e);
    const seriesLike = e.kind === 'series' || (e.sid != null && e.sid !== '') || /\/series\//i.test(e.url || '');
    if (!seriesLike) return 'u:' + e.url;
    if (e.sid != null && e.sid !== '') return 's:' + e.sid;
    if (e.sname) return 'n:' + String(e.sname).toLowerCase().trim();
    return 'u:' + e.url;
  }

  function saveProgress(entry) {
    const m = progressMap();
    entry = normalizeProgress(entry);
    entry.ts = Date.now();
    m[entry.url] = entry;
    const keys = Object.keys(m);
    if (keys.length > MAX_PROGRESS) {
      keys.sort((a, b) => m[a].ts - m[b].ts).slice(0, keys.length - MAX_PROGRESS).forEach(k => { delete m[k]; });
    }
    store('prog', m);
  }
  function removeProgress(url) {
    const m = progressMap();
    if (m[url]) { delete m[url]; store('prog', m); }
  }
  function listProgress(kind) {
    const m = progressMap();
    return Object.keys(m).map(k => normalizeProgress(m[k])).filter(e => !kind || e.kind === kind).sort((a, b) => b.ts - a.ts);
  }
  // Same list, but every series is one row: the latest episode watched.
  function listProgressCollapsed(kind) {
    const seen = {}, out = [];
    listProgress(kind).forEach(e => {
      const k = progressGroupKey(e);
      if (seen[k]) return;
      seen[k] = true;
      out.push(e);
    });
    return out;
  }

  function getFavs() { return load('favs') || []; }
  function toggleFav(item) {
    const favs = getFavs();
    const idx = favs.findIndex(f => f.key === item.key);
    if (idx >= 0) favs.splice(idx, 1); else favs.push(item);
    store('favs', favs);
    return idx < 0;
  }
  function isFav(key) { return getFavs().some(f => f.key === key); }

  // The provider returns 409 to the TV browser. A service on the TV refetches
  // the stream with a player identity and serves it on 127.0.0.1.
  let proxyPort = 0;
  let proxyHost = '';
  let hostKnown = false;
  let proxyError = '';
  let proxyBridge = null;
  let proxyWait = null;
  let hostWait = null;
  function isProxied(url) {
    return /^http:\/\/[^/]+\/(list\.m3u8|seg\.[a-z0-9]{2,5})\?u=/.test(url || '');
  }
  function probeProxy(port, host) {
    return new Promise(resolve => {
      if (!window.XMLHttpRequest) { resolve(0); return; }
      const x = new XMLHttpRequest();
      let done = false;
      const finish = (ok) => { if (done) return; done = true; resolve(ok ? port : 0); };
      x.open('GET', 'http://' + (host || '127.0.0.1') + ':' + port + '/list.m3u8', true);
      x.timeout = 1200;
      x.onload = () => finish(true);
      x.onerror = () => finish(false);
      x.ontimeout = () => finish(false);
      try { x.send(); } catch (e) { finish(false); }
    });
  }
  function ensureProxy() {
    if (proxyPort) return Promise.resolve(proxyPort);
    if (proxyWait) return proxyWait;
    proxyWait = new Promise(resolve => {
      const finish = (port) => {
        if (port) proxyPort = port;
        else proxyWait = null;
        resolve(port || 0);
      };
      const askBus = () => {
        if (!window.PalmServiceBridge) { probeProxy(18491).then(finish); return; }
        proxyBridge = new PalmServiceBridge();
        const timer = setTimeout(() => { probeProxy(18491).then(finish); }, 4000);
        proxyBridge.onservicecallback = (raw) => {
          let msg = {};
          try { msg = JSON.parse(raw); } catch (e) { msg = {}; }
          if (msg.port) { clearTimeout(timer); finish(msg.port); return; }
          if (msg.returnValue === false || msg.errorText) {
            proxyError = msg.errorText || 'proxy failed';
            clearTimeout(timer);
            probeProxy(18491).then(finish);
          }
        };
        try {
          // This TV's bus rejects service names that contain '-'.
          proxyBridge.call('luna://com.amrkz.lumioplayer.proxy/alive', '{"subscribe":true}');
        } catch (e) {
          proxyError = String(e && e.message || e);
          clearTimeout(timer);
          probeProxy(18491).then(finish);
        }
      };
      probeProxy(18491).then(found => { if (found) finish(found); else askBus(); });
    });
    return proxyWait;
  }
  // The media pipeline plays from the TV's LAN address. 127.0.0.1 often never starts.
  function ensureHost() {
    if (hostKnown) return Promise.resolve(proxyHost);
    if (hostWait) return hostWait;
    hostWait = new Promise(resolve => {
      const finish = (ip) => {
        hostKnown = true;
        proxyHost = ip || '';
        resolve(proxyHost);
      };
      if (!window.PalmServiceBridge) { finish(''); return; }
      const ask = (uri, next) => {
        let settled = false;
        const bridge = new PalmServiceBridge();
        const done = (ip) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (ip) finish(ip);
          else if (next) next();
          else finish('');
        };
        const timer = setTimeout(() => done(''), 2000);
        bridge.onservicecallback = (raw) => {
          let msg = {};
          try { msg = JSON.parse(raw); } catch (e) { msg = {}; }
          const wifi = msg.wifi || msg.wifiInfo || {};
          const wired = msg.wired || msg.wiredInfo || {};
          const ip = (wifi.state === 'connected' && wifi.ipAddress) || (wired.state === 'connected' && wired.ipAddress) || wifi.ipAddress || wired.ipAddress || msg.ipAddress || '';
          if (ip && ip !== '0.0.0.0') done(ip);
          else if (msg.returnValue === false || msg.errorText) done('');
        };
        try { bridge.call(uri, '{}'); }
        catch (e) { done(''); }
      };
      ask('luna://com.webos.service.connectionmanager/getStatus', () => {
        ask('luna://com.palm.connectionmanager/getStatus', null);
      });
    });
    return hostWait;
  }
  // A proxy bound to loopback only refuses the LAN address, and the TV player
  // then stays black with no error. Use the LAN address only after it answers.
  // Only success is cached, so a proxy that starts later is found on the next play.
  let lanOkKey = '';
  function lanHost(ip, port) {
    if (!ip || !port) return Promise.resolve('127.0.0.1');
    const key = ip + ':' + port;
    if (lanOkKey === key) return Promise.resolve(ip);
    return probeProxy(port, ip).then(ok => {
      if (ok) { lanOkKey = key; return ip; }
      return '127.0.0.1';
    });
  }
  function proxyUrl(url, lan) {
    const retarget = (proxied) => {
      if (!lan || !proxied) return Promise.resolve(proxied);
      const m = proxied.match(/^http:\/\/[^/:]+:(\d+)\//);
      if (!m) return Promise.resolve(proxied);
      return ensureHost()
        .then(ip => lanHost(ip, +m[1]))
        .then(host => proxied.replace(/^http:\/\/[^/:]+/, 'http://' + host));
    };
    if (!url) return Promise.resolve(url);
    if (isProxied(url)) return retarget(url);
    const ready = lan ? Promise.all([ensureProxy(), ensureHost()]) : Promise.all([ensureProxy(), Promise.resolve('')]);
    return ready.then(both => {
      const port = both[0];
      if (!port) return url;
      return (lan ? lanHost(both[1], port) : Promise.resolve('127.0.0.1')).then(host => {
        // The TV player picks its demuxer from the file name in the address, so a movie keeps its own
        // extension (seg.mkv, seg.avi...). seg.bin is a name it does not know, and the picture never starts.
        const vid = /\.(mp4|m4v|mkv|avi|mov|webm|mpg|mpeg|wmv|flv|3gp)(?:\?|$)/i.exec(url);
        const path = /\.m3u8(\?|$)/i.test(url) ? 'list.m3u8'
          : /\.ts(\?|$)/i.test(url) || /timeshift\.php/i.test(url) ? 'seg.ts'
          : vid ? 'seg.' + vid[1].toLowerCase()
          : /\.m4s(\?|$)/i.test(url) ? 'seg.m4s'
          : 'seg.bin';
        return 'http://' + host + ':' + port + '/' + path + '?u=' + encodeURIComponent(url);
      });
    });
  }
  // Pictures go through the helper on the TV, which keeps a copy on disk and shrinks TMDB posters.
  // Until the helper has answered once (or if it never does), the picture loads from its own address.
  // w = the width wanted; the helper only changes pictures from TMDB.
  function imgUrl(src, w) {
    if (!src || !proxyPort || !/^https?:\/\//i.test(src)) return src;
    if (/^http:\/\/(127\.0\.0\.1|localhost)[:\/]/i.test(src)) return src;
    return 'http://127.0.0.1:' + proxyPort + '/img?w=' + (w || 342) + '&u=' + encodeURIComponent(src);
  }
  ensureProxy();

  return { getWatched, addWatched, imgUrl, clearLists, norm, getAll, search, getShortEpg, getArchiveGuide, catchupUrls, hasArchive, pref, getIntro, setIntro, getVodInfoCached, getRecent, addRecent, progressMap, getProgress, saveProgress, removeProgress, listProgress, listProgressCollapsed, parseServer, getLast, liveAltUrl, xtreamLogin, m3uLogin, ensureLoaded, getConfig, clearConfig, getCategories, getStreams, streamUrl, getSeriesInfo, getVodInfo, getFavs, toggleFav, isFav, proxyUrl, get proxyPort() { return proxyPort; }, get proxyError() { return proxyError; } };
})();
window.API = API;
