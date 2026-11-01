// Languages. The English text is the key: tr('Live TV') gives the English text, or the translation in the
// chosen language. A dictionary lives in its own file (js/lang-<id>.js) and registers itself with I18n.add().
// Placeholders look like {n}:  tr('Season {n}', { n: 2 }).
// Static markup uses  data-i18n="text"  (words), data-i18n-ph="placeholder"  and  data-i18n-aria="aria-label".
const I18n = (function () {
  const LANGS = [
    { id: 'en', name: 'English', rtl: false },
    { id: 'ar', name: 'العربية', rtl: true }
  ];
  const KEY = 'iptv_lang';
  const dicts = {};
  const missed = {};
  let lang = 'en';

  function known(id) { return LANGS.some(l => l.id === id); }
  function find(id) { return LANGS.filter(l => l.id === id)[0] || LANGS[0]; }

  function saved() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  // The first start follows the TV's own menu language; after that the viewer's choice wins.
  function initial() {
    const s = saved();
    if (s && known(s)) return s;
    const nav = String((typeof navigator !== 'undefined' && (navigator.language || (navigator.languages && navigator.languages[0]))) || 'en').toLowerCase();
    const short = nav.split('-')[0];
    return known(short) ? short : 'en';
  }

  function tr(key, vars) {
    let s = key;
    const d = dicts[lang];
    if (lang !== 'en') {
      if (d && Object.prototype.hasOwnProperty.call(d, key)) s = d[key];
      else if (key) missed[key] = true;
    }
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? vars[k] : m));
    return s;
  }

  // Put the language into the page: direction, and every element that carries a data-i18n attribute.
  function apply(root) {
    const base = root || document;
    const all = base.querySelectorAll ? base.querySelectorAll('[data-i18n], [data-i18n-ph], [data-i18n-aria]') : [];
    Array.prototype.forEach.call(all, (el) => {
      const a = el.getAttribute('data-i18n');
      if (a) el.textContent = tr(a);
      const p = el.getAttribute('data-i18n-ph');
      if (p) el.setAttribute('placeholder', tr(p));
      const r = el.getAttribute('data-i18n-aria');
      if (r) el.setAttribute('aria-label', tr(r));
    });
  }

  function setup() {
    lang = initial();
    const cur = find(lang);
    const root = document.documentElement;
    root.setAttribute('lang', cur.id);
    root.setAttribute('dir', cur.rtl ? 'rtl' : 'ltr');
    // Pictures, rows and the player keep their left-to-right layout (the arrow keys, the scrolling and the seek
    // bar are built for it). The login, the top bar and the dialogs follow the language.
    ['rows', 'hero', 'player'].forEach((id) => { const el = document.getElementById(id); if (el) el.setAttribute('dir', 'ltr'); });
    // the words in the page markup are translated when the dictionary arrives (see add); English needs nothing
  }

  function add(id, dict) {
    dicts[id] = Object.assign(dicts[id] || {}, dict);
    if (id === lang) apply(document); // the words in the page markup, now that they can be translated
  }

  function set(id) {
    if (!known(id)) return;
    try { localStorage.setItem(KEY, id); } catch (e) { /* private mode: the choice lasts until the next start */ }
    if (id === lang) return;
    location.reload();
  }

  // The next language in the list (two languages: a toggle).
  function next() {
    const i = LANGS.map(l => l.id).indexOf(lang);
    return LANGS[(i + 1) % LANGS.length];
  }

  const api = {
    LANGS, tr, add, apply, set, next,
    get lang() { return lang; },
    get rtl() { return find(lang).rtl; },
    missing: () => Object.keys(missed)
  };
  window.I18n = api;
  window.tr = tr;
  setup();
  return api;
})();
