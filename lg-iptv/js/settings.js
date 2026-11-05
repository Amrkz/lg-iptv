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
    showClock: true,
    hideEmptyCats: false
  };

  function get(key) {
    const v = API.pref('set_' + key);
    return (v === null || v === undefined) ? DEF[key] : v;
  }
  function set(key, val) {
    API.pref('set_' + key, val);
    apply(key, val);
    return val;
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
    const key = snap.type === 'xtream' ? ('x:' + snap.server + '|' + snap.user) : ('m:' + snap.m3u);
    const list = getProfiles().filter(p => {
      const k = p.type === 'xtream' ? ('x:' + p.server + '|' + p.user) : ('m:' + p.m3u);
      return k !== key;
    });
    list.unshift(snap);
    saveProfiles(list.slice(0, 8));
    setCurrentProfileId(snap.id);
  }

  function apply(key, val) {
    if (key === 'accent') {
      const map = { red: '#e50914', blue: '#2b7cff', green: '#1db954', amber: '#f5a623', purple: '#a855f7' };
      document.documentElement.style.setProperty('--accent', map[val] || map.red);
    }
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

  function exportBackup() {
    return JSON.stringify({
      v: 1, app: 'Kayan IPTV', at: Date.now(),
      settings: all(), profiles: getProfiles(),
      lang: (window.I18n && I18n.lang) || 'en',
      prefs: { aspect: API.pref('aspect'), subStyle: API.pref('subStyle'), audioLang: API.pref('audioLang'), subLang: API.pref('subLang'), section: API.pref('section') }
    });
  }

  function importBackup(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return { ok: false, error: 'badjson' }; }
    if (!data || !data.settings) return { ok: false, error: 'badjson' };
    Object.keys(data.settings).forEach(k => { if (Object.prototype.hasOwnProperty.call(DEF, k)) set(k, data.settings[k]); });
    if (Array.isArray(data.profiles)) saveProfiles(data.profiles);
    if (data.prefs) Object.keys(data.prefs).forEach(k => { if (data.prefs[k] != null) API.pref(k, data.prefs[k]); });
    if (data.lang) { try { localStorage.setItem('iptv_lang', data.lang); } catch (e) {} }
    return { ok: true };
  }

  function resetAll() {
    Object.keys(DEF).forEach(k => { try { localStorage.removeItem('iptv_pref_set_' + k); } catch (e) {} });
    applyAll();
  }

  function clearCache() {
    try {
      ['prog', 'watched_movies', 'watched_series', 'recent', 'intro'].forEach(k => localStorage.removeItem('iptv_' + k));
    } catch (e) {}
  }

  function pinOk(code) {
    const pin = String(get('pin') || '');
    if (!get('pinOn') || !pin) return true;
    return String(code || '') === pin;
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
      item(tr('Export settings'), tr('Copy a backup code'), 'export'),
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

  return {
    VERSION, DEF, get, set, all, applyAll, build, cycle, toggle,
    exportBackup, importBackup, resetAll, clearCache,
    getProfiles, saveProfiles, rememberProfile, currentProfileId, setCurrentProfileId,
    pinOk, catLocked, hlsBufferOpts
  };
})();
window.Settings = Settings;
