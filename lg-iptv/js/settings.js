// Settings / Control Center for Kayan IPTV.
// Only real controls: each row maps to a preference the app already honours.
const Settings = (() => {
  const VERSION = '1.0.0';
  const DEF = {
    liveBuffer: 60,
    vodBuffer: 30,
    autoNext: true,
    resume: true,
    aspect: 'fit',
    audioLang: '',
    subLang: '',
    subSize: '',
    subBg: false,
    epgUrl: '',
    epgHours: 24,
    epgOffset: 0,
    pin: '',
    pinOn: false,
    lockAdult: false,
    accent: 'red',
    theme: 'default',
    showClock: true,
    hideEmptyCats: false
  };

  const THEMES = [
    { id: 'default', name: 'Default', blurb: 'Cinema marquee — current look' },
    { id: 'glass', name: 'Glass', blurb: 'Frosted panels and soft light edges' },
    { id: 'neo', name: 'Neo Brutalism', blurb: 'Thick borders, hard shadows, bold colour' },
    { id: 'bento', name: 'Bento Grid', blurb: 'Rounded tiles of mixed sizes' },
    { id: 'swiss', name: 'Swiss Style', blurb: 'Strict grid, red black white' },
    { id: 'skeuo', name: 'Skeuomorphism', blurb: 'Metal, leather, glossy beveled controls' },
    { id: 'clay', name: 'Claymorphism', blurb: 'Soft puffy pastels with gentle shadows' }
  ];

  function get(key) {
    if (key === 'pin') return pinIsSet() ? '1' : '';
    const v = API.pref('set_' + key);
    return (v === null || v === undefined) ? DEF[key] : v;
  }
  function set(key, val) {
    if (key === 'pin') { setPin(val); apply(key, val); return val; }
    API.pref('set_' + key, val);
    apply(key, val);
    return val;
  }

  function randomSalt() {
    const bytes = [];
    if (window.crypto && crypto.getRandomValues) {
      const a = new Uint8Array(16);
      crypto.getRandomValues(a);
      for (let i = 0; i < a.length; i++) bytes.push(a[i]);
    } else {
      for (let j = 0; j < 16; j++) bytes.push(Math.floor(Math.random() * 256));
    }
    return bytes.map(b => ('0' + b.toString(16)).slice(-2)).join('');
  }
  function setPin(pin) {
    const digits = String(pin || '').replace(/\D/g, '').slice(0, 4);
    if (digits.length !== 4) {
      API.pref('set_pin', '');
      API.pref('set_pinHash', '');
      API.pref('set_pinSalt', '');
      return '';
    }
    // Leave a stored PIN in place if the hash helper did not load, so the lock stays shut.
    if (!window.PinHash || !PinHash.hashPin) return '';
    const salt = randomSalt();
    const hash = PinHash.hashPin(digits, salt);
    if (!hash || hash.length < 64) return '';
    API.pref('set_pinHash', hash);
    API.pref('set_pinSalt', salt);
    API.pref('set_pin', '');
    return digits;
  }
  function migratePin() {
    if (migratePin.done) return;
    migratePin.done = true;
    const legacy = API.pref('set_pin');
    if (legacy == null || legacy === '') return;
    const s = String(legacy);
    if (/^\d{4}$/.test(s)) setPin(s);
    else API.pref('set_pin', '');
  }
  function pinIsSet() {
    migratePin();
    return !!(API.pref('set_pinHash') && API.pref('set_pinSalt'));
  }
  function all() {
    const o = {};
    Object.keys(DEF).forEach(k => { o[k] = get(k); });
    return o;
  }

  function getProfiles() {
    try { return JSON.parse(localStorage.getItem('iptv_profiles') || '[]') || []; } catch (e) { return []; }
  }
  function saveProfiles(list) {
    try { localStorage.setItem('iptv_profiles', JSON.stringify(list || [])); } catch (e) {}
  }
  function currentProfileId() {
    try { return localStorage.getItem('iptv_profile_id') || ''; } catch (e) { return ''; }
  }
  function setCurrentProfileId(id) {
    try { localStorage.setItem('iptv_profile_id', id || ''); } catch (e) {}
  }

  function rememberProfile() {
    const cfg = API.getConfig();
    if (!cfg) return;
    const last = API.getLast() || {};
    const snap = {
      id: currentProfileId() || ('p' + Date.now()),
      name: cfg.type === 'xtream'
        ? ((last.user || cfg.user || '') + '@' + String(cfg.server || '').replace(/^https?:\/\//, ''))
        : tr('M3U playlist'),
      type: cfg.type,
      server: cfg.server || last.server || '',
      user: cfg.user || last.user || '',
      pass: cfg.pass || '',
      m3u: cfg.url || last.m3u || '',
      ts: Date.now()
    };
    // the username is compared without letter case, so a login whose case was corrected replaces its old entry
    const key = snap.type === 'xtream' ? ('x:' + snap.server + '|' + String(snap.user).toLowerCase()) : ('m:' + snap.m3u);
    const list = getProfiles().filter(p => {
      const k = p.type === 'xtream' ? ('x:' + p.server + '|' + String(p.user).toLowerCase()) : ('m:' + p.m3u);
      return k !== key;
    });
    list.unshift(snap);
    saveProfiles(list.slice(0, 8));
    setCurrentProfileId(snap.id);
  }

  function themeMeta(id) {
    return THEMES.find(t => t.id === id) || THEMES[0];
  }
  function themeLabel(id) {
    const m = themeMeta(id);
    return tr(m.name);
  }
  function applyTheme(id) {
    const t = themeMeta(id).id;
    const root = document.documentElement;
    root.setAttribute('data-theme', t);
    // Feature-detect cheap backdrop-filter once; skip on weak GPUs via reduced-motion too
    if (!root.classList.contains('can-backdrop') && !root.classList.contains('no-backdrop')) {
      try {
        const ok = CSS && CSS.supports && (CSS.supports('backdrop-filter: blur(4px)') || CSS.supports('-webkit-backdrop-filter: blur(4px)'));
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        root.classList.add(ok && !reduce ? 'can-backdrop' : 'no-backdrop');
      } catch (e) { root.classList.add('no-backdrop'); }
    }
    // Swiss / Neo own the accent; otherwise honour the Accent colour setting
    const map = { red: '#e50914', blue: '#2b7cff', green: '#1db954', amber: '#f5a623', purple: '#a855f7' };
    if (t === 'swiss') root.style.setProperty('--accent', '#e30613');
    else if (t === 'neo') root.style.setProperty('--accent', '#ff2d55');
    else if (t === 'skeuo') root.style.setProperty('--accent', '#c45c26');
    else if (t === 'clay') root.style.setProperty('--accent', '#7c9cff');
    else root.style.setProperty('--accent', map[get('accent')] || map.red);
    const btn = document.getElementById('theme-btn');
    if (btn) {
      const label = themeLabel(t);
      btn.setAttribute('data-theme-id', t);
      btn.setAttribute('aria-label', tr('Theme') + ': ' + label);
      const nameEl = btn.querySelector('.theme-name');
      if (nameEl) nameEl.textContent = label;
    }
    // bento: stack hero when not on movies browse (set by App); default clear
    const home = document.getElementById('home');
    if (home && t !== 'bento') home.classList.remove('bento-stack');
    // sync frost layer from current hero artwork if present
    syncFrost();
  }
  function syncFrost() {
    const frost = document.getElementById('frost');
    if (!frost) return;
    if (get('theme') !== 'glass') { frost.style.backgroundImage = ''; return; }
    const bg = document.querySelector('.hero-slide:not(.leaving) .hero-bg');
    if (bg) {
      frost.style.backgroundImage = bg.style.backgroundImage || '';
    }
  }

  function apply(key, val) {
    if (key === 'accent') {
      const t = get('theme');
      if (t !== 'swiss' && t !== 'neo' && t !== 'skeuo' && t !== 'clay') {
        const map = { red: '#e50914', blue: '#2b7cff', green: '#1db954', amber: '#f5a623', purple: '#a855f7' };
        document.documentElement.style.setProperty('--accent', map[val] || map.red);
      }
    }
    if (key === 'theme') applyTheme(val);
    if (key === 'showClock') {
      const el = document.getElementById('clock');
      if (el) el.classList.toggle('hidden', !val);
    }
    if (key === 'aspect') API.pref('aspect', val);
    if (key === 'audioLang') API.pref('audioLang', val || '');
    if (key === 'subLang') API.pref('subLang', val || '');
    if (key === 'subSize' || key === 'subBg') {
      const st = Object.assign({}, API.pref('subStyle') || {}, {
        size: key === 'subSize' ? val : get('subSize'),
        bg: key === 'subBg' ? val : get('subBg')
      });
      API.pref('subStyle', st);
    }
  }

  function applyAll() {
    Object.keys(DEF).forEach(k => apply(k, get(k)));
    // sync from older prefs once
    const aspect = API.pref('aspect'); if (aspect && get('aspect') === DEF.aspect) set('aspect', aspect);
    const st = API.pref('subStyle') || {};
    if (st.size && get('subSize') === DEF.subSize) set('subSize', st.size);
    if (st.bg && get('subBg') === DEF.subBg) set('subBg', !!st.bg);
  }

  function stripUrlSecrets(url) {
    let s = String(url || '');
    const hashAt = s.indexOf('#');
    const frag = hashAt >= 0 ? s.slice(hashAt) : '';
    if (hashAt >= 0) s = s.slice(0, hashAt);
    s = s.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#@]*@/i, '$1');
    const q = s.indexOf('?');
    if (q < 0) return s + frag;
    const path = s.slice(0, q);
    const keep = [];
    s.slice(q + 1).split('&').forEach(part => {
      if (!part) return;
      let name = part.split('=')[0];
      try { name = decodeURIComponent(name); } catch (e) {}
      if (/^(password|passwd|pass|token|pin)$/i.test(name)) return;
      keep.push(part);
    });
    return path + (keep.length ? '?' + keep.join('&') : '') + frag;
  }
  function publicProfile(p) {
    return {
      id: p.id, name: p.name, type: p.type,
      server: p.server || '', user: p.user || '',
      m3u: stripUrlSecrets(p.m3u || ''), ts: p.ts || 0
    };
  }

  function exportBackup() {
    const settings = all();
    delete settings.pin;
    delete settings.pinHash;
    delete settings.pinSalt;
    return JSON.stringify({
      v: 2, app: 'Kayan IPTV', at: Date.now(),
      settings: settings, profiles: getProfiles().map(publicProfile),
      lang: (window.I18n && I18n.lang) || 'en',
      prefs: { aspect: API.pref('aspect'), subStyle: API.pref('subStyle'), audioLang: API.pref('audioLang'), subLang: API.pref('subLang'), section: API.pref('section') }
    });
  }

  function importBackup(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return { ok: false, error: 'badjson' }; }
    if (!data || !data.settings) return { ok: false, error: 'badjson' };
    Object.keys(data.settings).forEach(k => {
      if (k === 'pinHash' || k === 'pinSalt') return;
      if (k === 'pin') {
        if (/^\d{4}$/.test(String(data.settings.pin || ''))) set('pin', String(data.settings.pin));
        return;
      }
      if (Object.prototype.hasOwnProperty.call(DEF, k)) set(k, data.settings[k]);
    });
    if (Array.isArray(data.profiles)) saveProfiles(data.profiles);
    if (data.prefs) Object.keys(data.prefs).forEach(k => { if (data.prefs[k] != null) API.pref(k, data.prefs[k]); });
    if (data.lang) { try { localStorage.setItem('iptv_lang', data.lang); } catch (e) {} }
    return { ok: true };
  }

  function resetAll() {
    Object.keys(DEF).forEach(k => { try { localStorage.removeItem('iptv_pref_set_' + k); } catch (e) {} });
    try {
      localStorage.removeItem('iptv_pref_set_pinHash');
      localStorage.removeItem('iptv_pref_set_pinSalt');
    } catch (e) {}
    migratePin.done = false;
    applyAll();
  }

  function clearCache() {
    try {
      ['prog', 'watched_movies', 'watched_series', 'recent', 'intro'].forEach(k => localStorage.removeItem('iptv_' + k));
    } catch (e) {}
  }

  function sameHash(a, b) {
    const x = String(a || '');
    const y = String(b || '');
    if (!x || x.length !== y.length) return false;
    let n = 0;
    for (let i = 0; i < x.length; i++) n |= x.charCodeAt(i) ^ y.charCodeAt(i);
    return n === 0;
  }
  function pinOk(code) {
    migratePin();
    if (!get('pinOn')) return true;
    const digits = String(code || '').replace(/\D/g, '').slice(0, 4);
    if (pinIsSet()) {
      if (!window.PinHash || digits.length !== 4) return false;
      return sameHash(PinHash.hashPin(digits, String(API.pref('set_pinSalt') || '')), String(API.pref('set_pinHash') || ''));
    }
    const legacy = String(API.pref('set_pin') || '');
    if (/^\d{4}$/.test(legacy)) return digits === legacy;
    return true;
  }

  function catLocked(name) {
    if (!get('pinOn')) return false;
    if (!get('lockAdult')) return false;
    return /\b(adult|xxx|18\+|porn|nsfw)\b/i.test(String(name || ''));
  }

  function hlsBufferOpts(isLive) {
    const live = Number(get('liveBuffer')) || 60;
    const vod = Number(get('vodBuffer')) || 30;
    if (isLive) return { maxBufferLength: live, maxMaxBufferLength: Math.max(live * 2, 120), liveSyncDurationCount: 5, liveMaxLatencyDurationCount: 12 };
    return { maxBufferLength: vod, maxMaxBufferLength: Math.max(vod * 2, 60) };
  }

  function onOff(v) { return v ? tr('On') : tr('Off'); }

  function item(name, sub, action, extra) {
    return Object.assign({ name: name, sub: sub || '', _set: action, icon: '' }, extra || {});
  }

  // Build the Settings shelves. Keep each shelf short (ADHD-friendly).
  function build() {
    const cats = [], map = {};
    const cfg = API.getConfig();
    const profiles = getProfiles();

    // 1. Playlists & accounts
    const pl = [];
    if (cfg) {
      pl.push(item(
        cfg.type === 'xtream' ? tr('Xtream account') : tr('M3U playlist'),
        cfg.type === 'xtream' ? (cfg.user + ' · ' + String(cfg.server || '').replace(/^https?:\/\//, '')) : String(cfg.url || '').slice(0, 48),
        'profile-current'
      ));
      pl.push(item(tr('Refresh playlist'), tr('Reload channels and categories'), 'refresh'));
      pl.push(item(tr('Save as profile'), tr('Keep this login in the list'), 'profile-save'));
    }
    profiles.forEach(p => {
      pl.push(item(p.name || tr('Profile'), p.type === 'xtream' ? tr('Xtream account') : tr('M3U playlist'), 'profile-switch', { _profile: p }));
    });
    if (profiles.length) pl.push(item(tr('Remove saved profiles'), tr('{n} saved', { n: profiles.length }), 'profile-clear'));
    pl.push(item(tr('Add playlist'), tr('Sign in with another Xtream or M3U'), 'profile-add'));
    map.playlists = pl;
    cats.push({ category_id: 'playlists', category_name: tr('Playlists & accounts'), kind: 'settings', limit: 20 });

    // 2. EPG
    map.epg = [
      item(tr('EPG source URL'), get('epgUrl') || tr('Provider default'), 'epg-url'),
      item(tr('EPG refresh'), tr('Every {n} hours', { n: get('epgHours') }), 'epg-hours'),
      item(tr('EPG time offset'), tr('{n} minutes', { n: get('epgOffset') }), 'epg-offset')
    ];
    cats.push({ category_id: 'epg', category_name: tr('EPG'), kind: 'settings', limit: 10 });

    // 3. Player
    map.player = [
      item(tr('Live buffer'), tr('{n} seconds', { n: get('liveBuffer') }), 'live-buffer'),
      item(tr('Movie buffer'), tr('{n} seconds', { n: get('vodBuffer') }), 'vod-buffer'),
      item(tr('Picture size'), tr(String(get('aspect') || 'fit')), 'aspect'),
      item(tr('Auto-play next episode'), onOff(get('autoNext')), 'auto-next'),
      item(tr('Resume playback'), onOff(get('resume')), 'resume')
    ];
    cats.push({ category_id: 'player', category_name: tr('Player'), kind: 'settings', limit: 10 });

    // 4. Subtitles & audio
    map.tracks = [
      item(tr('Preferred audio'), get('audioLang') || tr('Default'), 'audio-lang'),
      item(tr('Preferred subtitles'), get('subLang') || tr('Default'), 'sub-lang'),
      item(tr('Subtitle size'), get('subSize') || tr('Normal'), 'sub-size'),
      item(tr('Subtitle background'), onOff(get('subBg')), 'sub-bg')
    ];
    cats.push({ category_id: 'tracks', category_name: tr('Subtitles & audio'), kind: 'settings', limit: 10 });

    // 5. Parental
    map.parental = [
      item(tr('Parental lock'), onOff(get('pinOn')), 'pin-on'),
      item(tr('Change PIN'), get('pin') ? '••••' : tr('Not set'), 'pin-set'),
      item(tr('Lock adult categories'), onOff(get('lockAdult')), 'lock-adult')
    ];
    cats.push({ category_id: 'parental', category_name: tr('Parental control'), kind: 'settings', limit: 10 });

    // 6. Appearance
    map.appear = [
      item(tr('Theme'), themeLabel(get('theme')), 'theme'),
      item(tr('Language'), (window.I18n && I18n.lang === 'ar') ? 'العربية' : 'English', 'language'),
      item(tr('Accent colour'), tr(String(get('accent'))), 'accent'),
      item(tr('Clock'), onOff(get('showClock')), 'clock'),
      item(tr('Hide empty categories'), onOff(get('hideEmptyCats')), 'hide-empty')
    ];
    cats.push({ category_id: 'appear', category_name: tr('Appearance'), kind: 'settings', limit: 10 });

    // 7. Downloads & storage
    const space = (window.Downloads && Downloads.space) || {};
    map.storage = [
      item(tr('Free space'), SettingsFmt(space.free), 'storage-info'),
      item(tr('Used by downloads'), SettingsFmt(space.used), 'storage-info'),
      item(tr('Open Downloads'), tr('Manage offline files'), 'open-dl'),
      item(tr('Clear watch history'), tr('Continue Watching and Recent'), 'clear-cache')
    ];
    cats.push({ category_id: 'storage', category_name: tr('Downloads & storage'), kind: 'settings', limit: 10 });

    // 8. Remote help
    map.remote = [
      item(tr('Arrow keys'), tr('Move between rows and cards'), 'noop'),
      item(tr('OK'), tr('Open or play'), 'noop'),
      item(tr('Back'), tr('Go up one level'), 'noop'),
      item(tr('Red / Green / Yellow / Blue'), tr('Search · Favorites · Favorite · Next section'), 'noop')
    ];
    cats.push({ category_id: 'remote', category_name: tr('Remote & keys'), kind: 'settings', limit: 10 });

    // 9. Backup / reset / about
    map.backup = [
      item(tr('Export settings'), tr('Passwords and PIN stay on this device'), 'export'),
      item(tr('Import settings'), tr('Paste a backup code'), 'import'),
      item(tr('Reset settings'), tr('Defaults only — playlists stay'), 'reset'),
      item(tr('About'), 'Kayan IPTV · v' + VERSION, 'about')
    ];
    cats.push({ category_id: 'backup', category_name: tr('Backup & about'), kind: 'settings', limit: 10 });

    return { cats: cats, map: map };
  }

  function SettingsFmt(n) {
    n = Number(n) || 0;
    if (!n) return tr('Unknown');
    if (n >= 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    return (n / 1024).toFixed(0) + ' KB';
  }

  function cycle(key, values) {
    const cur = get(key);
    const i = values.indexOf(cur);
    return set(key, values[(i + 1) % values.length]);
  }

  function toggle(key) { return set(key, !get(key)); }

  function cycleTheme() {
    const ids = THEMES.map(t => t.id);
    return cycle('theme', ids);
  }

  return {
    VERSION, DEF, THEMES, get, set, all, applyAll, build, cycle, toggle,
    exportBackup, importBackup, resetAll, clearCache,
    getProfiles, saveProfiles, rememberProfile, currentProfileId, setCurrentProfileId,
    pinOk, catLocked, hlsBufferOpts,
    themeMeta, themeLabel, applyTheme, syncFrost, cycleTheme
  };
})();
window.Settings = Settings;
