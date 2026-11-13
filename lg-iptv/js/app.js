const App = (() => {
  const MAX_CATS = 8;
  const GROUP_HEAD = 300; // how much of a category is grouped by quality before it is shown
  let currentKind = 'movies';
  let view = 'browse'; // 'browse' | 'category' | 'episodes'
  let loadId = 0;      // bumps on every navigation so stale responses are ignored
  let currentEpisodes = []; // flat episode list of the series being browsed
  let progMap = {};         // watch progress, refreshed on each render
  let favKeys = {};         // favorite keys, refreshed on each render (one localStorage read, not one per card)

  const rows = () => UI.$('#rows');
  const hero = () => UI.$('#hero');
  const homeVisible = () => !UI.$('#home').classList.contains('hidden');

  function setActiveNav(kind) {
    UI.$$('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.cat === kind));
    if (kind !== 'recent' && typeof hideRecentTabs === 'function') hideRecentTabs();
    try { updateBentoLayout(); } catch (e) {}
  }

  function favOf(item, kind) {
    if (kind === 'series' && !item.url) return null; // xtream series: nothing playable yet
    const url = API.streamUrl(item, kind);
    if (!url) return null;
    return { key: url, name: item.name || item.title || '', url, icon: item.icon || item.stream_icon || item.cover || '' };
  }

  function render(cats, map, kind) {
    progMap = API.progressMap();
    favKeys = {};
    API.getFavs().forEach(f => { favKeys[f.key] = true; });
    UI.renderRows(rows(), cats, map, kind, handlers);
  }

  function kindFromUrl(url) {
    if (/\/series\//i.test(url)) return 'series';
    if (/\/movie\//i.test(url) || /\.(mp4|mkv|avi)(\?|$)/i.test(url)) return 'movies';
    return 'live';
  }

  function resolveItem(it, kind) {
    let url = API.streamUrl(it, kind);
    if (url && window.Downloads && kind !== 'live') url = Downloads.resolvePlayUrl(url) || url;
    const out = {
      url: url,
      title: it.seriesName || it.name || it.title || '',
      subtitle: it.seriesName ? tr('S{s}:E{e}', { s: it.season, e: it.ep }) + '  ' + it.epTitle : '',
      icon: it.icon || it.stream_icon || it.cover || '',
      fav: favOf(it, kind),
      alt: kind === 'live' ? API.liveAltUrl(it) : null,
      remoteUrl: API.streamUrl(it, kind)
    };
    if (kind === 'episode') {
      // saved with the watch progress, so Continue Watching can reopen the whole series
      out.series = { sid: it.sid, name: it.seriesName, season: it.season, ep: it.ep, cover: it.seriesCover || '' };
    }
    if (kind === 'live') {
      out.live = { streamId: it.stream_id, num: it.num, archive: API.hasArchive(it), item: it };
    }
    return out;
  }

  // text for the "paused" card: plot, year, rating, genre
  function detailsFor(it, kind) {
    if (kind === 'episode') {
      return Promise.resolve({ meta: tr('S{s}:E{e}', { s: it.season, e: it.ep }) + '  ·  ' + it.epTitle, plot: it.plot || '' });
    }
    if (kind === 'movies' && it.stream_id) {
      return API.getVodInfoCached(it.stream_id).then(r => {
        const i = r && r.info;
        if (!i) return null;
        const year = String(i.releasedate || i.release_date || '').slice(0, 4);
        return { meta: [year, i.rating ? '★ ' + i.rating : '', i.genre].filter(Boolean).join('  ·  '), plot: i.plot || i.description || '' };
      });
    }
    return Promise.resolve(null);
  }

  function recordRecent(it) {
    API.addRecent({ key: String(it.stream_id || it.url), stream_id: it.stream_id, url: it.url, name: it.name, icon: it.icon, stream_icon: it.stream_icon, tv_archive: it.tv_archive, num: it.num });
  }

  // flat, ordered episode list of a series (episode number order inside each season)
  function episodesFromInfo(series, info) {
    const c = API.getConfig();
    const u = encodeURIComponent(c.user), p = encodeURIComponent(c.pass);
    const eps = (info && info.episodes) || {};
    const cats = [], map = {}, flat = [];
    Object.keys(eps).sort((a, b) => Number(a) - Number(b)).forEach(sn => {
      const raw = Array.isArray(eps[sn]) ? eps[sn] : [];
      if (!raw.length) return;
      const num = (e) => Number(e.episode_num) || 0;
      const list = raw.map((e, i) => ({ e, i })).sort((a, b) => (num(a.e) - num(b.e)) || (a.i - b.i)).map(x => x.e);
      const key = 's' + sn;
      cats.push({ category_id: key, category_name: tr('Season {n}', { n: sn }) });
      map[key] = list.map(ep => {
        const o = {
          name: 'E' + (ep.episode_num || '?') + ' · ' + (ep.title || 'Episode'),
          epTitle: ep.title || tr('Episode'),
          season: sn,
          ep: ep.episode_num || '?',
          icon: (ep.info && ep.info.movie_image) || series.cover || '',
          plot: (ep.info && (ep.info.plot || ep.info.description)) || series.plot || '',
          url: `${c.server}/series/${u}/${p}/${ep.id}.${ep.container_extension || 'mp4'}`,
          seriesName: series.name,
          seriesCover: series.cover || '',
          sid: series.series_id
        };
        flat.push(o);
        return o;
      });
    });
    return { cats, map, flat };
  }

  function seriesCtx(flat, index) {
    return {
      type: 'series', kind: 'series', items: flat, index,
      resolve: it => resolveItem(it, 'episode'),
      details: it => detailsFor(it, 'episode'),
      onPlay: recordSeries
    };
  }

  // Continue Watching: reopen the whole series so Next episode, Episodes and autoplay work
  function openContinue(entry) {
    const cover = entry.scover || entry.icon || '';
    const plain = () => pick({ name: entry.sname || entry.name, icon: cover, url: entry.url }, 'series');
    if (entry.sid == null || entry.sid === '') { plain(); return; } // old row with no series id: play the saved episode
    const series = { series_id: entry.sid, name: entry.sname || entry.name, cover: cover };
    API.getSeriesInfo(entry.sid).then(info => {
      const built = episodesFromInfo(series, info);
      let idx = -1;
      built.flat.forEach((o, i) => { if (o.url === entry.url) idx = i; });
      if (idx < 0) { plain(); return; }
      currentEpisodes = built.flat;
      Player.play(seriesCtx(built.flat, idx));
    }).catch(plain);
  }

  // ---------- watched history ----------
  function recordMovie(it) {
    const key = String(it.stream_id || it.url || '');
    if (!key) return;
    API.addWatched('movies', { key, name: it.name || it.title || '', stream_id: it.stream_id, stream_icon: it.stream_icon, icon: it.icon, container_extension: it.container_extension, url: it.url });
  }
  function recordSeries(ep) {
    if (!ep || !ep.sid) return; // a playlist episode has no series to come back to
    API.addWatched('series', { key: 's' + ep.sid, series_id: ep.sid, name: ep.seriesName || '', cover: ep.seriesCover || '' });
  }

  // "Recently Watched" for one department, without the titles already shown under Continue Watching
  function watchedRow(kind, cont) {
    const inCont = {};
    cont.forEach(e => {
      const c = e._cont || e;
      if (kind === 'series') {
        if (c.sid != null && c.sid !== '') inCont['s' + c.sid] = true;
        const nm = String(c.sname || e.name || '').toLowerCase().trim();
        if (nm) inCont['n:' + nm] = true;
      } else {
        const url = e.url || c.url || API.streamUrl(e, 'movies');
        if (url) inCont[url] = true;
      }
    });
    return API.getWatched(kind).filter(w => {
      if (kind === 'series') {
        if (inCont[w.key]) return false;
        if (w.series_id != null && inCont['s' + w.series_id]) return false;
        const nm = String(w.name || '').toLowerCase().trim();
        if (nm && inCont['n:' + nm]) return false;
        return true;
      }
      const url = w.url || API.streamUrl(w, 'movies');
      return !url || !inCont[url];
    });
  }

  // One Continue Watching card: series show the series name/poster and "S2 E5", not every episode.
  function contCard(e) {
    const seriesLike = e.kind === 'series' || (e.sid != null && e.sid !== '');
    if (seriesLike) {
      const name = e.sname || String(e.name || '').split(/\s*[·|]\s*/)[0] || e.name || '';
      const sub = (e.sn != null && e.sn !== '' && e.epn != null && e.epn !== '')
        ? tr('S{s} E{e}', { s: e.sn, e: e.epn }) : '';
      return {
        name: name,
        icon: e.scover || e.icon || '',
        cover: e.scover || e.icon || '',
        url: e.url,
        sub: sub,
        series_id: e.sid,
        _cont: e
      };
    }
    return { name: e.name, icon: e.icon, url: e.url, _cont: e };
  }

  // ---------- quality grouping ----------
  // Providers list one film several times ("4K Heat", "FHD Heat", "Heat HD"). Gather them into one card
  // that opens a picker. Grouping is by title with the quality words removed.
  const Q_RE = /\b(?:4k|uhd|2160p?|fhd|full\s?hd|1080p?|hd|720p?|sd|480p?|hdtc|hdcam|cam|hdrip|hevc|h\.?26[45]|x26[45]|hdr10?|hdr|dv|10bit|blu-?ray|brrip|bdrip|web-?dl|webrip|remux|dual)\b/gi;
  const Q_RANK = { '4K': 6, 'FHD': 5, 'HD': 4, 'HDTC': 3, 'SD': 2, 'CAM': 1, '': 0 };

  function qualityOf(name) {
    const n = String(name).toLowerCase();
    if (/\b(4k|uhd|2160p?)\b/.test(n)) return '4K';
    if (/\b(fhd|full\s?hd|1080p?)\b/.test(n)) return 'FHD';
    if (/\b(hdtc|hdcam)\b/.test(n)) return 'HDTC';
    if (/\b(hd|720p?|hdrip|brrip|bdrip|blu-?ray|web-?dl|webrip)\b/.test(n)) return 'HD';
    if (/\b(sd|480p?)\b/.test(n)) return 'SD';
    if (/\bcam\b/.test(n)) return 'CAM';
    return '';
  }

  function cleanTitle(name) {
    const t = String(name).replace(Q_RE, ' ').replace(/\[\s*\]|\(\s*\)|\{\s*\}/g, ' ')
      .replace(/^[\s\-\u2013\u2014|:\[\]]+|[\s\-\u2013\u2014|:\[\]]+$/g, '').replace(/\s{2,}/g, ' ');
    return t || String(name);
  }

  function groupQualities(items) {
    const byKey = {}, order = [];
    items.forEach(it => {
      const nm = it.name || it.title || '';
      const key = API.norm(String(nm).replace(Q_RE, ' ').replace(/[(\[]\s*(?:19|20)\d{2}\s*[)\]]/g, ' ').replace(/[\[\](){}|_.\-\u2013\u2014:,]+/g, ' '));
      if (!key) { order.push({ solo: it }); return; }
      let g = byKey[key];
      if (!g) { g = byKey[key] = { list: [] }; order.push(g); }
      g.list.push({ item: it, q: qualityOf(nm) });
    });
    return order.map(g => {
      if (g.solo) return g.solo;
      if (g.list.length === 1) return g.list[0].item;
      g.list.sort((a, b) => (Q_RANK[b.q] || 0) - (Q_RANK[a.q] || 0)); // best first
      const out = Object.assign({}, g.list[0].item);
      out.name = cleanTitle(out.name || out.title || '');
      out._variants = g.list.map(v => ({ item: v.item, label: v.q || tr('Standard') }));
      const seen = {};
      out._qualities = out._variants.map(v => v.label).filter(l => (seen[l] ? false : (seen[l] = true)));
      return out;
    });
  }

  let pickerOpen = false, pickerReturn = null;
  function openPicker(group, kind) {
    const list = UI.$('#picker-list');
    list.innerHTML = '';
    const title = UI.$('#picker-title');
    title.textContent = group.name;
    title.dir = 'auto';
    group._variants.forEach(v => {
      const b = document.createElement('button');
      b.className = 'd-item';
      const tag = document.createElement('span');
      tag.className = 'q-tag';
      tag.textContent = v.label;
      const nm = document.createElement('span');
      nm.className = 'd-name';
      nm.dir = 'auto';
      nm.textContent = v.item.name || v.item.title || '';
      b.appendChild(tag);
      b.appendChild(nm);
      b.addEventListener('click', () => { closePicker(); pick(v.item, kind, [v.item]); });
      list.appendChild(b);
    });
    pickerReturn = document.activeElement;
    pickerOpen = true;
    UI.$('#picker').classList.remove('hidden');
    const first = list.querySelector('.d-item');
    if (first) first.focus();
  }

  function closePicker() {
    if (!pickerOpen) return;
    pickerOpen = false;
    UI.$('#picker').classList.add('hidden');
    if (pickerReturn && document.body.contains(pickerReturn)) { try { pickerReturn.focus({ preventScroll: true }); } catch (e) { pickerReturn.focus(); } }
    pickerReturn = null;
  }
  UI.$('#picker').addEventListener('mousedown', (e) => { if (e.target === UI.$('#picker')) closePicker(); });

  // ---------- download confirm ----------
  let confirmOpen = false, confirmReturn = null;
  function closeConfirm() {
    if (!confirmOpen) return;
    confirmOpen = false;
    UI.$('#confirm').classList.add('hidden');
    if (confirmReturn && document.body.contains(confirmReturn)) {
      try { confirmReturn.focus({ preventScroll: true }); } catch (e) { confirmReturn.focus(); }
    }
    confirmReturn = null;
  }
  function openConfirm(title, body, actions) {
    UI.$('#confirm-title').textContent = title || '';
    UI.$('#confirm-body').textContent = body || '';
    const box = UI.$('#confirm-actions');
    box.innerHTML = '';
    (actions || []).forEach((a, i) => {
      const b = document.createElement('button');
      b.className = 'd-item' + (a.primary ? ' primary' : '');
      b.textContent = a.label;
      b.addEventListener('click', () => { closeConfirm(); if (a.on) a.on(); });
      box.appendChild(b);
      if (i === 0) setTimeout(() => b.focus(), 0);
    });
    confirmReturn = document.activeElement;
    confirmOpen = true;
    UI.$('#confirm').classList.remove('hidden');
  }
  UI.$('#confirm').addEventListener('mousedown', (e) => { if (e.target === UI.$('#confirm')) closeConfirm(); });

  // ---------- theme picker (live preview on focus) ----------
  let themeOpen = false, themeReturn = null, themePreview = null;
  function closeThemePicker(commit) {
    if (!themeOpen) return;
    themeOpen = false;
    UI.$('#theme-picker').classList.add('hidden');
    if (!commit && themePreview != null) {
      Settings.set('theme', themePreview); // restore if cancelled
    }
    themePreview = null;
    updateBentoLayout();
    if (themeReturn && document.body.contains(themeReturn)) {
      try { themeReturn.focus({ preventScroll: true }); } catch (e) { themeReturn.focus(); }
    }
    themeReturn = null;
    if (currentKind === 'settings') showSettings(true);
  }
  function openThemePicker() {
    const list = UI.$('#theme-picker-list');
    list.innerHTML = '';
    const cur = Settings.get('theme') || 'default';
    themePreview = cur;
    Settings.THEMES.forEach(t => {
      const b = document.createElement('button');
      b.className = 'd-item' + (t.id === cur ? ' on' : '');
      b.dataset.theme = t.id;
      const sw = document.createElement('span');
      sw.className = 'swatch swatch-' + t.id;
      sw.setAttribute('aria-hidden', 'true');
      const nm = document.createElement('span');
      nm.className = 'd-name';
      nm.textContent = Settings.themeLabel(t.id);
      const sub = document.createElement('span');
      sub.className = 'd-sub';
      sub.textContent = tr(t.blurb);
      const col = document.createElement('span');
      col.style.flex = '1';
      col.appendChild(nm);
      col.appendChild(sub);
      b.appendChild(sw);
      b.appendChild(col);
      b.addEventListener('focus', () => {
        Settings.set('theme', t.id); // live preview
        updateBentoLayout();
      });
      b.addEventListener('click', () => {
        Settings.set('theme', t.id);
        themePreview = t.id; // committing — do not restore
        closeThemePicker(true);
        toastHome(tr('Theme') + ': ' + Settings.themeLabel(t.id));
      });
      list.appendChild(b);
    });
    themeReturn = document.activeElement;
    themeOpen = true;
    UI.$('#theme-picker').classList.remove('hidden');
    const focusEl = list.querySelector('.d-item.on') || list.querySelector('.d-item');
    if (focusEl) focusEl.focus();
  }
  UI.$('#theme-picker').addEventListener('mousedown', (e) => {
    if (e.target === UI.$('#theme-picker')) closeThemePicker(false);
  });

  function updateBentoLayout() {
    const home = UI.$('#home');
    if (!home) return;
    const bento = Settings.get('theme') === 'bento';
    // side-by-side hero only on movies browse; otherwise stack
    const side = bento && currentKind === 'movies' && view === 'browse';
    home.classList.toggle('bento-stack', bento && !side);
    if (window.Settings && Settings.syncFrost) Settings.syncFrost();
  }


  function dlMeta(item, kind) {
    const url = item.url || API.streamUrl(item, kind === 'episode' ? 'series' : kind);
    if (!url) return null;
    return {
      url: url,
      name: item.seriesName ? (item.seriesName + ' · ' + tr('S{s} E{e}', { s: item.season, e: item.ep })) : (item.name || item.title || ''),
      icon: item.seriesCover || item.icon || item.stream_icon || item.cover || '',
      kind: kind === 'episode' ? 'series' : (kind || 'movies'),
      seriesId: item.sid || item.series_id || '',
      seriesName: item.seriesName || item.name || '',
      season: item.season || '',
      ep: item.ep || ''
    };
  }

  function explainGate(r) {
    if (!r) return tr('Could not start the download.');
    if (r.reason === 'live') return tr('Live TV cannot be downloaded. Live channels keep a larger buffer instead.');
    if (r.reason === 'nospace' || r.block) return tr('Not enough free space. Need {need}, free {free}.', { need: Downloads.fmtBytes(r.need), free: Downloads.fmtBytes(r.free) });
    if (r.reason === 'unknown') return tr('File size is unknown. Free space: {free}. Download anyway?', { free: Downloads.fmtBytes(r.free) });
    if (r.reason === 'low') return tr('This would leave less than 1 GB free ({free} free, file {need}). Download anyway?', { free: Downloads.fmtBytes(r.free), need: Downloads.fmtBytes(r.need) });
    if (r.reason === 'nodir') return tr('Storage is not available on this TV.');
    return tr('Could not start the download.');
  }

  function requestDownload(item, kind) {
    if (!window.Downloads) return;
    if (kind === 'live') {
      openConfirm(tr('Downloads'), tr('Live TV cannot be downloaded. Live channels keep a larger buffer instead.'), [
        { label: tr('OK'), primary: true }
      ]);
      return;
    }
    const meta = dlMeta(item, kind);
    if (!meta) return;
    Downloads.start(meta, false).then(r => {
      if (r && r.already) { openConfirm(tr('Downloads'), tr('Already downloaded.'), [{ label: tr('OK'), primary: true }]); return; }
      if (r && r.ok && !r.warn) { toastHome(tr('Download started')); return; }
      if (r && (r.warn || r.block)) {
        const actions = [{ label: tr('Cancel') }];
        if (!r.block) actions.unshift({ label: tr('Download anyway'), primary: true, on: () => Downloads.start(meta, true).then(() => toastHome(tr('Download started'))) });
        openConfirm(tr('Storage warning'), explainGate(r), actions);
        return;
      }
      openConfirm(tr('Downloads'), explainGate(r), [{ label: tr('OK'), primary: true }]);
    }).catch(() => openConfirm(tr('Downloads'), tr('Could not start the download.'), [{ label: tr('OK'), primary: true }]));
  }

  function downloadSeason(seasonKey, list) {
    const eps = (list || []).filter(ep => ep && ep.url);
    if (!eps.length) return;
    // queue one by one; first call surfaces the space warning for the first file
    const run = (i, force) => {
      if (i >= eps.length) { toastHome(tr('Season queued')); return; }
      const meta = dlMeta(eps[i], 'episode');
      Downloads.start(meta, force).then(r => {
        if (r && r.block) { openConfirm(tr('Storage warning'), explainGate(r), [{ label: tr('OK'), primary: true }]); return; }
        if (r && r.warn && !force) {
          openConfirm(tr('Storage warning'), explainGate(r), [
            { label: tr('Download anyway'), primary: true, on: () => run(i, true) },
            { label: tr('Cancel') }
          ]);
          return;
        }
        run(i + 1, force);
      });
    };
    run(0, false);
  }

  function toastHome(text) {
    if (window.Player && Player.toast) { Player.toast(text, 1800); return; }
    const el = UI.$('#toast');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 1800);
  }

  // ---------- hero extras: TV guide for channels, details for movies ----------
  function enrich(item, kind) {
    if (kind === 'live' && item.stream_id) {
      API.getShortEpg(item.stream_id).then(list => {
        if (!list.length) return;
        const t = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const now = list[0], next = list[1];
        UI.enrichHero(hero(), item, { metaText: tr('Now') + '  ' + now.title + '  (' + t(now.start) + '\u2013' + t(now.end) + ')' + (next ? '     ' + tr('Next') + '  ' + next.title : '') });
      });
    } else if (kind === 'movies' && item.stream_id && !item.plot) {
      API.getVodInfoCached(item.stream_id).then(r => {
        const i = r && r.info;
        if (!i) return;
        UI.enrichHero(hero(), item, { plot: i.plot || i.description, genre: i.genre, rating: i.rating, releaseDate: i.releasedate || i.release_date, duration: i.duration });
      });
    }
  }

  // ---------- hero slideshow ----------
  // Rotates featured titles while the menu has focus; a focused card takes over the hero.
  const SLIDE_MS = 7000;
  let slides = [], slideKind = null, slideIdx = 0, slideTimer = null;

  function pickSlides(cats, map) {
    const lists = cats.filter(c => c.category_id !== '__cats' && c.category_id !== '__cont').map(c => map[c.category_id] || []);
    const out = [], seen = {};
    const idOf = (it) => String(it.stream_id || it.series_id || it.url || it.name || it.title || '');
    for (let depth = 0; depth < 20 && out.length < 12; depth++) { // round-robin: variety across categories
      lists.forEach(l => {
        const it = l[depth];
        if (it && !seen[idOf(it)]) { seen[idOf(it)] = true; out.push(it); } // providers repeat titles across categories
      });
    }
    const hasArt = (it) => !!UI.safeUrl(it.icon || it.stream_icon || it.cover);
    return out.filter(hasArt).concat(out.filter(it => !hasArt(it))).slice(0, 6);
  }

  function showSlide() {
    if (!slides.length) return;
    UI.setHero(hero(), slides[slideIdx], slideKind, { count: slides.length, index: slideIdx, ms: SLIDE_MS });
  }

  function stopSlideshow() {
    clearInterval(slideTimer);
    slideTimer = null;
  }

  function startSlideshow(advance) {
    stopSlideshow();
    clearTimeout(heroTimer);
    if (!slides.length || view !== 'browse') return;
    if (advance) slideIdx = (slideIdx + 1) % slides.length;
    showSlide();
    if (slides.length < 2) return;
    slideTimer = setInterval(() => {
      if (!homeVisible()) return; // paused behind the player
      slideIdx = (slideIdx + 1) % slides.length;
      showSlide();
    }, SLIDE_MS);
  }

  function setSlides(cats, map, kind) {
    slides = pickSlides(cats, map);
    slideKind = kind;
    slideIdx = 0;
    const a = document.activeElement;
    if (!a || !a.classList || !a.classList.contains('card')) startSlideshow(false);
  }

  let heroTimer = null;
  const handlers = {
    head(cat, kind) { if (Settings.catLocked && Settings.catLocked(cat.category_name)) { pick({ cat: cat, name: cat.category_name }, kind); return; } showCategory(kind === 'recent' ? currentKind : kind, cat); },
    // the hero follows the focused card (debounced, so scrolling a row stays smooth)
    focus: (item, kind) => {
      stopSlideshow();
      if (item.cat || kind === 'episode' || view === 'search') return; // search keeps its own hero
      clearTimeout(heroTimer);
      heroTimer = setTimeout(() => { UI.setHero(hero(), item, kind); enrich(item, kind); }, 380); // rebuild only once the cursor has rested
    },
    pick: (item, kind, list) => pick(item, kind, list),
    fav: (item, kind) => {
      const f = favOf(item, kind);
      if (!f) return null;
      const on = API.toggleFav(f);
      favKeys[f.key] = !!on;
      if (kind === 'fav') showFavs(true);
      return on;
    },
    isFav: (item, kind) => {
      const f = favOf(item, kind);
      return !!f && !!favKeys[f.key];
    },
    progress: (item, kind) => {
      if (kind === 'live' || kind === 'category') return 0;
      const url = item.url || (kind === 'movies' ? API.streamUrl(item, 'movies') : null);
      const p = url && progMap[url];
      return p && p.d ? p.t / p.d : 0;
    }
  };

  function loadCategory(kind) {
    const id = ++loadId;
    currentKind = kind;
    view = 'browse';
    setActiveNav(kind);
    stopSlideshow();
    slides = [];
    UI.clearHero(hero());
    UI.setMessage(rows(), tr('Loading…'));

    return API.getCategories(kind).then(cats => {
      if (id !== loadId) return;
      const allCats = cats && cats.length ? cats : [{ category_id: 'all', category_name: tr('All') }];
      const categories = allCats.slice(0, MAX_CATS);
      const itemsByCat = {};
      const failures = [];
      return Promise.all(categories.map(c =>
        API.getStreams(kind, c.category_id).then(items => {
          items = Array.isArray(items) ? items : [];
          if (kind === 'movies' || kind === 'series') {
            // a shelf shows 40 cards, so only the head of a big list is grouped; the count keeps the real size
            const grouped = groupQualities(items.slice(0, GROUP_HEAD));
            grouped.total = items.length;
            itemsByCat[c.category_id] = grouped;
          } else {
            itemsByCat[c.category_id] = items;
          }
        }).catch(e => { failures.push(e); itemsByCat[c.category_id] = []; }) // one slow shelf must not blank the screen
      )).then(() => {
        if (id !== loadId) return;
        if (failures.length === categories.length) throw failures[0];
        let shown = categories;
        if (allCats.length > 1) {
          // first row lists EVERY category, so panels with hundreds of them stay reachable
          itemsByCat.__cats = allCats.map(c => ({ name: c.category_name, cat: c }));
          shown = [{ category_id: '__cats', category_name: tr('All categories'), limit: 1000 }].concat(categories);
        }
        if (kind === 'live') {
          const rec = API.getRecent();
          if (rec.length) {
            itemsByCat.__recent = rec;
            shown = [{ category_id: '__recent', category_name: tr('Recently watched'), limit: 20 }].concat(shown);
          }
        }
        if (kind === 'movies' || kind === 'series') {
          const cont = API.listProgressCollapsed(kind).slice(0, 20).map(contCard);
          const seen = watchedRow(kind, cont);
          if (seen.length) {
            itemsByCat.__rec = seen;
            shown = [{ category_id: '__rec', category_name: tr('Recently Watched'), limit: 20 }].concat(shown);
          }
          if (cont.length) {
            itemsByCat.__cont = cont;
            shown = [{ category_id: '__cont', category_name: tr('Continue Watching'), limit: 20 }].concat(shown);
          }
        }
        if (Settings.get('theme') === 'bento' && kind === 'movies') {
          itemsByCat.__bento = [
            { name: tr('Continue Watching'), _bento: 'recent', bento: 'recent' },
            { name: tr('Live TV'), _bento: 'live', bento: 'live' },
            { name: tr('Movies'), _bento: 'movies', bento: 'movies' },
            { name: tr('Series'), _bento: 'series', bento: 'series' },
            { name: tr('Downloads'), _bento: 'dl', bento: 'dl' }
          ];
          shown = [{ category_id: '__bento', category_name: tr('Home'), limit: 10 }].concat(shown);
        }
        render(shown, itemsByCat, kind);
        // mark bento hub cards
        if (Settings.get('theme') === 'bento' && kind === 'movies') {
          const hub = rows().querySelector('.row');
          if (hub) {
            hub.querySelectorAll('.card').forEach((c, i) => {
              const it = (itemsByCat.__bento || [])[i];
              c.classList.add('bento-tile', 'noart');
              if (it && it.bento) c.classList.add(it.bento);
              if (i === 0) c.classList.add('bento-lg');
            });
          }
        }
        updateBentoLayout();
        setSlides(categories, itemsByCat, kind);
      });
    }).catch(e => {
      if (id === loadId) UI.setMessage(rows(), tr('Could not load: {msg}', { msg: e && e.message ? e.message : e }));
    });
  }

  function showCategory(kind, cat) {
    const id = ++loadId;
    view = 'category';
    stopSlideshow();
    UI.clearHero(hero());
    UI.setMessage(rows(), tr('Loading…'));
    API.getStreams(kind, cat.category_id).then(items => {
      if (id !== loadId) return;
      items = Array.isArray(items) ? items : [];
      const total = items.length;
      if (kind === 'movies' || kind === 'series') items = groupQualities(items.slice(0, GROUP_HEAD * 4)); // 300 cards are shown
      const map = {};
      map[cat.category_id] = items;
      render([{ category_id: cat.category_id, category_name: cat.category_name + ' (' + total + ')', limit: 300, grid: true }], map, kind);
      const firstCard = UI.$('.card');
      if (firstCard) firstCard.focus();
    }).catch(e => {
      if (id === loadId) UI.setMessage(rows(), tr('Could not load: {msg}', { msg: e && e.message ? e.message : e }));
    });
  }

  function pick(item, kind, list) {
    if (item && item._bento) { openSection(item._bento, true); return; }
    if (item._set) { handleSetting(item); return; }
    if (item.cat && Settings.catLocked(item.cat.category_name || item.name)) {
      promptValue(tr('Parental control'), tr('Enter PIN'), '', code => {
        if (!Settings.pinOk(code)) { openConfirm(tr('Parental control'), tr('Wrong PIN'), [{ label: tr('OK'), primary: true }]); return; }
        showCategory(currentKind, item.cat);
      });
      return;
    }
    if (item._dlAction === 'season') { downloadSeason(item._seasonKey, item._seasonEps); return; }
    if (item._dlAction === 'pause' && item._job) { Downloads.pause(item._job.id).then(() => showDownloads(true)); return; }
    if (item._dlAction === 'resume' && item._job) { Downloads.resume(item._job.id).then(() => showDownloads(true)); return; }
    if (item._dlAction === 'cancel' && item._job) { Downloads.cancel(item._job.id).then(() => showDownloads(true)); return; }
    if (item._dlAction === 'remove' && item._job) { Downloads.remove(item._job.id).then(() => showDownloads(true)); return; }
    if (item._job && item._job.status === 'done' && item._job.url) {
      // play the local file through the normal player path
      const fake = { name: item.name, icon: item.icon, url: item._job.url, sid: item._job.seriesId, seriesName: item._job.seriesName, season: item._job.season, ep: item._job.ep, seriesCover: item.icon };
      pick(fake, item._job.kind === 'series' ? 'episode' : 'movies', [fake]);
      return;
    }
    if (item.cat) { showCategory(currentKind, item.cat); return; }
    if (item._variants && item._variants.length > 1) { openPicker(item, kind); return; }
    if (kind === 'series' && !item.url) { showEpisodes(item); return; }
    if (item._cont && item._cont.sid) { openContinue(item._cont); return; }
    const url = API.streamUrl(item, kind);
    if (!url) return;
    if (kind === 'live') recordRecent(item);
    const k = kind === 'fav' || kind === 'recent' ? kindFromUrl(url) : (kind === 'episode' ? 'series' : kind);
    let ctx;
    if (kind === 'live' && list && list.indexOf(item) >= 0) {
      ctx = { type: 'live', kind: 'live', items: list, index: list.indexOf(item), resolve: it => resolveItem(it, 'live'), onPlay: recordRecent };
    } else if (kind === 'episode' && currentEpisodes.indexOf(item) >= 0) {
      ctx = seriesCtx(currentEpisodes, currentEpisodes.indexOf(item));
    } else {
      ctx = {
        type: k === 'live' ? 'live' : k === 'movies' ? 'movie' : 'single', kind: k, items: [item], index: 0,
        resolve: it => resolveItem(it, kind), details: it => detailsFor(it, k === 'movies' ? 'movies' : kind)
      };
      if (ctx.type === 'live') ctx.onPlay = recordRecent;
      else if (k === 'movies') ctx.onPlay = recordMovie;
    }
    Player.play(ctx);
  }

  function showEpisodes(series) {
    const id = ++loadId;
    view = 'episodes';
    UI.setMessage(rows(), tr('Loading episodes…'));
    UI.setHero(hero(), series, 'series');
    API.getSeriesInfo(series.series_id).then(info => {
      if (id !== loadId) return;
      const built = episodesFromInfo(series, info);
      currentEpisodes = built.flat;
      built.cats.forEach(c => {
        const eps = built.map[c.category_id] || [];
        built.map[c.category_id] = [{
          name: tr('Download season'),
          cat: null,
          _dlAction: 'season',
          _seasonKey: c.category_id,
          _seasonEps: eps,
          icon: series.cover || ''
        }].concat(eps);
      });
      render(built.cats, built.map, 'episode');
      const firstCard = UI.$('.card');
      if (firstCard) firstCard.focus();
    }).catch(e => {
      if (id === loadId) UI.setMessage(rows(), tr('Could not load episodes: {msg}', { msg: e && e.message ? e.message : e }));
    });
  }

  function promptValue(title, body, initial, onOk) {
    UI.$('#confirm-title').textContent = title || '';
    UI.$('#confirm-body').textContent = body || '';
    const box = UI.$('#confirm-actions');
    box.innerHTML = '';
    const input = document.createElement('input');
    input.className = 'confirm-input';
    input.value = initial || '';
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('spellcheck', 'false');
    box.appendChild(input);
    const ok = document.createElement('button');
    ok.className = 'd-item primary';
    ok.textContent = tr('OK');
    ok.addEventListener('click', () => { closeConfirm(); if (onOk) onOk(input.value); });
    const cancel = document.createElement('button');
    cancel.className = 'd-item';
    cancel.textContent = tr('Cancel');
    cancel.addEventListener('click', () => closeConfirm());
    box.appendChild(ok);
    box.appendChild(cancel);
    confirmReturn = document.activeElement;
    confirmOpen = true;
    UI.$('#confirm').classList.remove('hidden');
    setTimeout(() => input.focus(), 50);
  }

  function handleSetting(item) {
    if (!item || !item._set || item._set === 'noop' || item._set === 'storage-info') return;
    const a = item._set;
    const refresh = () => showSettings(true);
    if (a === 'live-buffer') { Settings.cycle('liveBuffer', [30, 45, 60, 90, 120]); refresh(); return; }
    if (a === 'vod-buffer') { Settings.cycle('vodBuffer', [15, 30, 45, 60]); refresh(); return; }
    if (a === 'aspect') { Settings.cycle('aspect', ['fit', 'fill', 'zoom', 'stretch', '43']); refresh(); return; }
    if (a === 'auto-next') { Settings.toggle('autoNext'); refresh(); return; }
    if (a === 'resume') { Settings.toggle('resume'); refresh(); return; }
    if (a === 'sub-bg') { Settings.toggle('subBg'); refresh(); return; }
    if (a === 'sub-size') { Settings.cycle('subSize', ['', 'large', 'small']); refresh(); return; }
    if (a === 'audio-lang') {
      promptValue(tr('Preferred audio'), tr('Language code, for example en or ar. Leave blank for default.'), Settings.get('audioLang') || '', v => { Settings.set('audioLang', String(v || '').trim()); refresh(); });
      return;
    }
    if (a === 'sub-lang') {
      promptValue(tr('Preferred subtitles'), tr('Language code, for example en or ar. Leave blank for default.'), Settings.get('subLang') || '', v => { Settings.set('subLang', String(v || '').trim()); refresh(); });
      return;
    }
    if (a === 'epg-url') {
      promptValue(tr('EPG source URL'), tr('XMLTV URL, or blank to use the provider.'), Settings.get('epgUrl') || '', v => { Settings.set('epgUrl', String(v || '').trim()); refresh(); });
      return;
    }
    if (a === 'epg-hours') { Settings.cycle('epgHours', [6, 12, 24, 48]); refresh(); return; }
    if (a === 'epg-offset') { Settings.cycle('epgOffset', [-120, -60, -30, 0, 30, 60, 120]); refresh(); return; }
    if (a === 'pin-on') {
      if (!Settings.get('pin') && !Settings.get('pinOn')) {
        promptValue(tr('Change PIN'), tr('Choose a 4-digit PIN.'), '', v => {
          const pin = String(v || '').replace(/\D/g, '').slice(0, 4);
          if (pin.length < 4) { openConfirm(tr('Parental control'), tr('PIN must be 4 digits.'), [{ label: tr('OK'), primary: true }]); return; }
          Settings.set('pin', pin); Settings.set('pinOn', true); refresh();
        });
        return;
      }
      Settings.toggle('pinOn'); refresh(); return;
    }
    if (a === 'pin-set') {
      promptValue(tr('Change PIN'), tr('Choose a 4-digit PIN.'), '', v => {
        const pin = String(v || '').replace(/\D/g, '').slice(0, 4);
        if (pin.length < 4) { openConfirm(tr('Parental control'), tr('PIN must be 4 digits.'), [{ label: tr('OK'), primary: true }]); return; }
        Settings.set('pin', pin); refresh();
      });
      return;
    }
    if (a === 'lock-adult') { Settings.toggle('lockAdult'); refresh(); return; }
    if (a === 'language') { const next = I18n.next(); I18n.set(next.id); return; }
    if (a === 'accent') { Settings.cycle('accent', ['red', 'blue', 'green', 'amber', 'purple']); refresh(); return; }
    if (a === 'theme') { openThemePicker(); return; }
    if (a === 'clock') { Settings.toggle('showClock'); refresh(); return; }
    if (a === 'hide-empty') { Settings.toggle('hideEmptyCats'); refresh(); return; }
    if (a === 'open-dl') { openSection('dl', true); return; }
    if (a === 'clear-cache') {
      openConfirm(tr('Clear watch history'), tr('Remove Continue Watching, Recent, and watched lists? Downloads stay.'), [
        { label: tr('Clear'), primary: true, on: () => { Settings.clearCache(); toastHome(tr('Cleared')); refresh(); } },
        { label: tr('Cancel') }
      ]);
      return;
    }
    if (a === 'export') {
      const code = Settings.exportBackup();
      openConfirm(tr('Export settings'), code.slice(0, 280) + (code.length > 280 ? '…' : ''), [
        { label: tr('Copy'), primary: true, on: () => { try { navigator.clipboard.writeText(code); } catch (e) {} toastHome(tr('Copied')); } },
        { label: tr('OK') }
      ]);
      return;
    }
    if (a === 'import') {
      promptValue(tr('Import settings'), tr('Paste a backup code. Passwords and the PIN are not in it.'), '', v => {
        const r = Settings.importBackup(v);
        openConfirm(tr('Import settings'), r.ok ? tr('Settings restored. Reloading…') : tr('Backup code is not valid.'), [
          { label: tr('OK'), primary: true, on: () => { if (r.ok) location.reload(); } }
        ]);
      });
      return;
    }
    if (a === 'reset') {
      openConfirm(tr('Reset settings'), tr('Restore defaults? Playlists and downloads stay.'), [
        { label: tr('Reset'), primary: true, on: () => { Settings.resetAll(); toastHome(tr('Settings reset')); refresh(); } },
        { label: tr('Cancel') }
      ]);
      return;
    }
    if (a === 'about') {
      openConfirm(tr('About'), 'Kayan IPTV  v' + Settings.VERSION + '\n' + tr('This app does not include any channels or media. You must provide your own content.'), [{ label: tr('OK'), primary: true }]);
      return;
    }
    if (a === 'refresh') {
      API.clearLists();
      UI.setMessage(rows(), tr('Loading…'));
      API.ensureLoaded().then(() => { toastHome(tr('Playlist refreshed')); openSection('movies', true); })
        .catch(e => openConfirm(tr('Playlists & accounts'), tr('Could not load: {msg}', { msg: e && e.message ? e.message : e }), [{ label: tr('OK'), primary: true }]));
      return;
    }
    if (a === 'profile-save') { Settings.rememberProfile(); toastHome(tr('Profile saved')); refresh(); return; }
    if (a === 'profile-clear') { Settings.saveProfiles([]); toastHome(tr('Cleared')); refresh(); return; }
    if (a === 'profile-add') {
      Settings.rememberProfile();
      API.clearConfig();
      UI.showScreen('login');
      return;
    }
    if (a === 'profile-switch' && item._profile) {
      const p = item._profile;
      UI.setMessage(rows(), tr('Signing in…'));
      const go = p.type === 'xtream'
        ? API.xtreamLogin(p.server, p.user, p.pass)
        : API.m3uLogin(p.m3u);
      go.then(() => { Settings.setCurrentProfileId(p.id); Settings.rememberProfile(); UI.showScreen('home'); openSection('movies', true); })
        .catch(e => openConfirm(tr('Playlists & accounts'), (e && e.message) || tr('Login failed'), [{ label: tr('OK'), primary: true, on: refresh }]));
      return;
    }
    if (a === 'profile-current') return;
  }

  function showSettings(refocus) {
    loadId++;
    currentKind = 'settings';
    view = 'browse';
    setActiveNav('settings');
    stopSlideshow();
    UI.clearHero(hero());
    const paint = () => {
      if (currentKind !== 'settings') return;
      const built = Settings.build();
      render(built.cats, built.map, 'settings');
      slides = [];
      if (refocus) {
        const el = UI.$('.card') || UI.$('.navbtn.active');
        if (el) el.focus();
      }
    };
    if (window.Downloads) Downloads.refresh().then(paint, paint);
    else paint();
  }

  function showDownloads(refocus) {
    loadId++;
    currentKind = 'dl';
    view = 'browse';
    setActiveNav('dl');
    stopSlideshow();
    UI.clearHero(hero());
    const paint = () => {
      if (currentKind !== 'dl') return;
      const jobs = (window.Downloads && Downloads.jobs) || [];
      const space = (window.Downloads && Downloads.space) || {};
      const cats = [], map = {};
      const free = space.free || 0, used = space.used || 0, total = space.total || (free + used);
      const banner = [{
        name: tr('Storage: {used} used · {free} free', { used: Downloads.fmtBytes(used), free: Downloads.fmtBytes(free) }),
        cat: null, _dlAction: 'noop', icon: ''
      }];
      map.__space = banner;
      cats.push({ category_id: '__space', category_name: tr('Storage'), kind: 'dl', limit: 5 });
      const active = jobs.filter(j => j.status === 'running' || j.status === 'queued' || j.status === 'paused' || j.status === 'error');
      const done = jobs.filter(j => j.status === 'done');
      if (active.length) {
        map.__active = active.map(j => ({
          name: j.name || tr('Download'),
          icon: j.icon,
          sub: j.status === 'running'
            ? (Math.round((j.bytes / Math.max(1, j.total)) * 100) + '% · ' + Downloads.fmtBytes(j.bytes))
            : (j.status === 'paused' ? tr('Paused') : (j.status === 'error' ? tr('Failed') : tr('Queued'))),
          _job: j,
          _dlAction: j.status === 'paused' || j.status === 'error' ? 'resume' : (j.status === 'running' || j.status === 'queued' ? 'pause' : 'noop')
        }));
        cats.push({ category_id: '__active', category_name: tr('In progress'), kind: 'dl', limit: 40 });
      }
      if (done.length) {
        map.__done = done.map(j => ({
          name: j.name || tr('Download'),
          icon: j.icon,
          sub: Downloads.fmtBytes(j.total || j.bytes),
          _job: j
        }));
        cats.push({ category_id: '__done', category_name: tr('Ready to play'), kind: 'movies', limit: 40 });
      }
      if (!active.length && !done.length) {
        slides = [];
        UI.setMessage(rows(), tr('No downloads yet. Open a movie or episode and choose Download.'));
        // still show storage row
        render(cats, map, 'dl');
        return;
      }
      // action chips under in-progress
      if (active.length) {
        map.__acts = active.map(j => ({
          name: tr('Remove') + ': ' + (j.name || ''),
          _job: j, _dlAction: j.status === 'done' ? 'remove' : 'cancel', icon: ''
        }));
        cats.push({ category_id: '__acts', category_name: tr('Manage'), kind: 'dl', limit: 40 });
      }
      if (done.length) {
        map.__rm = done.map(j => ({ name: tr('Delete') + ': ' + (j.name || ''), _job: j, _dlAction: 'remove', icon: '' }));
        cats.push({ category_id: '__rm', category_name: tr('Delete downloads'), kind: 'dl', limit: 40 });
      }
      render(cats, map, 'dl');
      slides = done.slice(0, 6).map(j => ({ name: j.name, icon: j.icon, url: j.url, _job: j }));
      slideKind = 'dl';
      slideIdx = 0;
      if (!refocus) startSlideshow(false);
      if (refocus) {
        const el = UI.$('.card') || UI.$('.navbtn.active');
        if (el) el.focus();
      }
    };
    UI.setMessage(rows(), tr('Loading…'));
    if (window.Downloads) Downloads.refresh().then(paint, paint);
    else paint();
  }

  function showFavs(refocus) {
    loadId++;
    currentKind = 'fav';
    view = 'browse';
    setActiveNav('fav');
    stopSlideshow();
    UI.clearHero(hero());
    const favCats = [{ category_id: 'fav', category_name: tr('Favorites') }], favMap = { fav: API.getFavs() };
    render(favCats, favMap, 'fav');
    slides = favMap.fav.slice(0, 6);
    slideKind = 'fav';
    slideIdx = 0;
    if (!refocus) startSlideshow(false);
    if (refocus) {
      const el = UI.$('.card') || UI.$('.navbtn.active');
      if (el) el.focus();
    }
  }

  // ---------- recent: pick up where the viewer left off ----------
  let recentTab = 'series';
  function recentTabsEl() {
    let el = document.getElementById('rtabs');
    if (!el) { el = document.createElement('div'); el.id = 'rtabs'; el.className = 'rtabs'; document.getElementById('home').appendChild(el); }
    return el;
  }
  function hideRecentTabs() {
    const el = document.getElementById('rtabs');
    if (el) el.classList.remove('on');
    rows().classList.remove('with-rtabs');
  }
  function showRecentTabs(cats) {
    const el = recentTabsEl();
    el.innerHTML = '';
    cats.forEach(c => {
      const b = document.createElement('button');
      b.className = 'rtab' + (c.kind === recentTab ? ' active' : '');
      b.dataset.kind = c.kind;
      b.tabIndex = 0;
      b.textContent = c.category_name;
      b.addEventListener('click', () => { recentTab = c.kind; showRecent(false); focusRecentTab(); });
      el.appendChild(b);
    });
    el.classList.add('on');
    rows().classList.add('with-rtabs');
  }
  // idle on Recent: the tabs step through Live TV, Movies, Series by themselves
  const RECENT_ROTATE_MS = 12000;
  let recentIdleT = null;
  function armRecentRotate() {
    clearTimeout(recentIdleT);
    // stay long enough for the hero to show each of this tab's featured titles once
    const n = (slideKind === 'recent' && slides.length) ? slides.length : 1;
    recentIdleT = setTimeout(rotateRecentTab, Math.max(RECENT_ROTATE_MS, n * SLIDE_MS));
  }
  function rotateRecentTab() {
    const tabs = Array.from(document.querySelectorAll('#rtabs.on .rtab'));
    if (currentKind !== 'recent' || view !== 'browse' || !homeVisible() || tabs.length < 2 || themeOpen || confirmOpen || pickerOpen) { armRecentRotate(); return; }
    const i = tabs.findIndex(t => t.dataset.kind === recentTab);
    recentTab = tabs[(i + 1) % tabs.length].dataset.kind;
    showRecent(false);
    focusRecentTab();
    armRecentRotate();
  }
  ['keydown', 'mousemove', 'wheel'].forEach(ev => document.addEventListener(ev, () => { if (currentKind === 'recent') armRecentRotate(); }, { passive: true, capture: true }));
  function focusRecentTab() {
    const b = UI.$('#rtabs .rtab.active') || UI.$('#rtabs .rtab');
    if (b) b.focus();
  }
  // Three clear shelves: Live TV, Movies, Series. Series episodes collapse into one series card.
  function showRecent(refocus) {
    loadId++;
    currentKind = 'recent';
    view = 'browse';
    setActiveNav('recent');
    stopSlideshow();
    UI.clearHero(hero());
    const cats = [], map = {};
    const contMovies = API.listProgressCollapsed('movies').slice(0, 20).map(contCard);
    const contSeries = API.listProgressCollapsed('series').slice(0, 20).map(contCard);
    const movies = contMovies.concat(watchedRow('movies', contMovies));
    const series = contSeries.concat(watchedRow('series', contSeries));
    const live = API.getRecent();
    if (live.length) { cats.push({ category_id: '__live', category_name: tr('Live TV'), kind: 'live', limit: 20 }); map.__live = live; }
    if (movies.length) { cats.push({ category_id: '__movies', category_name: tr('Movies'), kind: 'movies', limit: 20 }); map.__movies = movies; }
    if (series.length) { cats.push({ category_id: '__series', category_name: tr('Series'), kind: 'series', limit: 20 }); map.__series = series; }
    if (!cats.length) {
      slides = [];
      hideRecentTabs();
      UI.setMessage(rows(), tr('Nothing to resume yet. Movies and episodes you start, and channels you watch, will show up here.'));
      return;
    }
    // vertical tabs: one department at a time
    if (!cats.some(c => c.kind === recentTab)) recentTab = cats[0].kind;
    const pick = cats.filter(c => c.kind === recentTab).map(c => Object.assign({}, c, { grid: true, limit: 60 }));
    render(pick, map, 'recent');
    showRecentTabs(cats);
    // hero shows the selected tab's titles only (4 each), then the tabs move on
    slides = (map['__' + recentTab] || []).slice(0, 4);
    slideKind = 'recent';
    slideIdx = 0;
    armRecentRotate();
    if (!refocus) startSlideshow(false);
    if (refocus) {
      const el = UI.$('.card') || UI.$('.navbtn.active');
      if (el) el.focus();
    }
  }

  // ---------- station navigation ----------
  // Each horizontal line of icons is one station row. Down/Up move exactly one line and
  // stay on the same icon. Left/Right move exactly one icon and never jump to another line.
  const SCROLL_MS = 240, SIDE_MS = 190; // short scrolls feel quick and finish before the next key press
  const tweens = {};
  function tween(el, prop, to, ms) {
    const key = prop + (el.id || el.className);
    if (tweens[key]) cancelAnimationFrame(tweens[key]);
    const from = el[prop], t0 = Date.now(), dur = ms || 320;
    if (Math.abs(to - from) < 1) { el[prop] = to; return; }
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / dur);
      el[prop] = from + (to - from) * (1 - Math.pow(1 - k, 3)); // ease-out cubic
      if (k < 1) tweens[key] = requestAnimationFrame(step);
    };
    tweens[key] = requestAnimationFrame(step);
  }

  const railRows = () => Array.from(rows().querySelectorAll('.row')).filter(r => r.querySelector('.card'));
  const focusNoScroll = (el) => { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } };

  function rowOf(card) {
    let n = card.parentNode;
    while (n && n !== document.body) {
      if (n.classList && n.classList.contains('row')) return n;
      n = n.parentNode;
    }
    return null;
  }

  // One entry per visual line. A sideways rail is a single line; a wrapped category grid is several.
  function linesIn(row) {
    const itemsEl = row.querySelector('.row-items');
    const cards = Array.from(itemsEl.children).filter(el => el.classList && el.classList.contains('card'));
    if (!itemsEl.classList.contains('grid')) return [{ cards: cards, itemsEl: itemsEl }];
    const lines = [];
    cards.forEach(card => {
      const top = card.offsetTop;
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.top - top) < 24) last.cards.push(card);
      else lines.push({ top: top, cards: [card], itemsEl: itemsEl });
    });
    return lines;
  }

  function locate(card) {
    const row = rowOf(card);
    if (!row) return null;
    const lines = linesIn(row);
    for (let i = 0; i < lines.length; i++) {
      const ci = lines[i].cards.indexOf(card);
      if (ci >= 0) return { row: row, lines: lines, li: i, ci: ci };
    }
    return null;
  }

  function clearCardPast() {
    rows().querySelectorAll('.card.past').forEach(c => c.classList.remove('past'));
  }

  // keep a card fully visible inside its horizontally scrolling row
  function keepInView(itemsEl, card) {
    const pad = 88;
    const left = card.offsetLeft, right = left + card.offsetWidth, view = itemsEl.clientWidth;
    let to = itemsEl.scrollLeft;
    if (left - pad < to) to = left - pad;
    else if (right + pad > to + view) to = right + pad - view;
    tween(itemsEl, 'scrollLeft', Math.max(0, to), SIDE_MS);
  }

  function alignRow(row, list) {
    const first = list[0];
    const anchor = first.offsetTop + parseFloat(getComputedStyle(first).paddingTop || 0);
    markPast(list, row);
    tween(rows(), 'scrollTop', Math.max(0, row.offsetTop - anchor), SCROLL_MS);
  }

  // Read every position first, then write the classes: mixing them forces a re-layout per row.
  function markPast(list, row) {
    const top = row.offsetTop;
    const flags = list.map(r => r.offsetTop < top);
    list.forEach((r, i) => r.classList.toggle('past', flags[i]));
  }

  // Put this icon in the station slot: same column across lines, previous lines step aside for the hero.
  function place(card) {
    const row = rowOf(card);
    const list = railRows();
    const itemsEl = card.parentNode;
    if (!row || list.indexOf(row) < 0) { focusNoScroll(card); return; }
    clearCardPast();
    if (itemsEl.classList.contains('grid')) {
      const here = locate(card);
      markPast(list, row);
      if (here) {
        here.lines.forEach((line, i) => {
          if (i < here.li) line.cards.forEach(c => c.classList.add('past'));
        });
      }
      card.classList.remove('past'); // a hidden icon cannot take focus
      focusNoScroll(card);
      const slotCard = linesIn(list[0])[0].cards[0];
      const slot = list[0].offsetTop + slotCard.offsetTop;
      tween(rows(), 'scrollTop', Math.max(0, row.offsetTop + card.offsetTop - slot), SCROLL_MS);
    } else {
      alignRow(row, list); // un-hide the row first: a hidden row cannot take focus
      focusNoScroll(card);
      keepInView(itemsEl, card);
    }
  }

  function focusAt(row, lineIndex, col) {
    const lines = linesIn(row);
    const line = lines[Math.max(0, Math.min(lineIndex, lines.length - 1))];
    const card = line.cards[Math.max(0, Math.min(col, line.cards.length - 1))];
    row._last = line.cards.indexOf(card);
    place(card);
  }

  function focusNav() {
    railRows().forEach(r => r.classList.remove('past'));
    clearCardPast();
    tween(rows(), 'scrollTop', 0, SCROLL_MS);
    const nb = UI.$('.navbtn.active') || UI.$('.navbtn');
    if (nb) nb.focus();
  }

  function onArrow(dir) {
    if (!homeVisible()) return false;
    if (themeOpen) { spatialNav(dir, UI.$('#theme-picker')); return true; }
    if (confirmOpen) { spatialNav(dir, UI.$('#confirm')); return true; }
    if (pickerOpen) { spatialNav(dir, UI.$('#picker')); return true; }
    const a = document.activeElement;
    const list = railRows();
    if (!a || !a.classList) return false;
    if (!list.length) { if (a.id === 'search-input' && dir === 'UP') { focusNav(); return true; } return false; }

    if (a.classList.contains('navbtn')) {
      if (dir === 'LEFT' || dir === 'RIGHT') {
        const navs = Array.from(document.querySelectorAll('#home .topbar .navbtn:not(.hidden)'));
        const n = navs[navs.indexOf(a) + (dir === 'RIGHT' ? 1 : -1) * (I18n.rtl ? -1 : 1)]; // the top bar is mirrored in Arabic
        if (n) n.focus();
        return true;
      }
      if (dir === 'DOWN' && currentKind === 'recent' && document.querySelector('#rtabs.on')) { focusRecentTab(); return true; }
      if (dir === 'DOWN') { focusAt(list[0], 0, list[0]._last || 0); return true; }
      return true;
    }
    if (a.classList.contains('rtab')) {
      const tabs = Array.from(document.querySelectorAll('#rtabs .rtab'));
      const i = tabs.indexOf(a);
      if (dir === 'UP' || dir === 'DOWN') {
        const n = tabs[i + (dir === 'DOWN' ? 1 : -1)];
        if (n) { recentTab = n.dataset.kind; showRecent(false); focusRecentTab(); }
        else if (dir === 'UP') focusNav();
        return true;
      }
      const into = I18n.rtl ? 'LEFT' : 'RIGHT';
      if (dir === into) { focusAt(list[0], 0, 0); return true; }
      return true;
    }
    if (a.id === 'search-input') {
      if (dir === 'DOWN') { focusAt(list[0], 0, 0); return true; }
      if (dir === 'UP') { focusNav(); return true; }
      return false;
    }
    if (!a.classList.contains('card')) return false;

    const here = locate(a);
    if (!here) return false;
    here.row._last = here.ci;

    if (dir === 'LEFT' || dir === 'RIGHT') {
      const cards = here.lines[here.li].cards;
      const ni = here.ci + (dir === 'RIGHT' ? 1 : -1);
      if (ni >= 0 && ni < cards.length) {
        here.row._last = ni;
        place(cards[ni]);
      } else if (ni < 0 && currentKind === 'recent' && document.querySelector('#rtabs.on')) {
        focusRecentTab();
      }
      return true; // one icon only — never leak into the next line
    }

    const delta = dir === 'DOWN' ? 1 : -1;
    const nli = here.li + delta;
    if (nli >= 0 && nli < here.lines.length) {
      focusAt(here.row, nli, here.ci); // same icon, one line up or down
      return true;
    }
    const ri = list.indexOf(here.row);
    const nrow = list[ri + delta];
    if (nrow) {
      const nlines = linesIn(nrow);
      focusAt(nrow, delta > 0 ? 0 : nlines.length - 1, here.ci);
      return true;
    }
    if (dir === 'UP') focusNav();
    return true;
  }

  // after the player closes, put the focused row back in its slot
  function onPlayerClosed() {
    if (currentKind === 'recent' && view === 'browse') { showRecent(true); return; } // what was just watched moves to the front
    if (currentKind === 'dl' && view === 'browse') { showDownloads(true); return; }
    const a = document.activeElement;
    if (a && a.classList && a.classList.contains('card') && rowOf(a) && railRows().indexOf(rowOf(a)) >= 0) place(a);
  }

  // Back on the home screen: step out of sub-views first, exit the app from Live TV.
  function onBack() {
    if (!homeVisible()) return false;
    if (themeOpen) { closeThemePicker(false); return true; }
    if (confirmOpen) { closeConfirm(); return true; }
    if (pickerOpen) { closePicker(); return true; }
    if (view === 'episodes' || view === 'category') { openSection(currentKind, false); return true; } // back to the section it came from
    if (currentKind !== 'movies') { loadCategory('movies'); return true; } // Movies is home
    return false;
  }

  // ---------- search ----------
  let searchTimer = null, searchSeq = 0;
  const SEARCH_HINT = tr('Type at least two letters to search channels, movies and series.');

  function showSearch() {
    loadId++;
    currentKind = 'search';
    view = 'search';
    setActiveNav('search');
    stopSlideshow();
    clearTimeout(heroTimer);
    UI.setMessage(rows(), SEARCH_HINT);
    const input = UI.showSearch(hero());
    if (lastQuery) input.value = lastQuery; // coming back to Search keeps the last words
    let lastRun = '';
    const go = () => { // Enter / OK / the keyboard's Search key: search now, then put the cursor on the first result
      clearTimeout(searchTimer);
      lastRun = input.value.trim();
      runSearch(input.value, true);
      if (document.documentElement.classList.contains('touch') && input.blur) input.blur(); // put the phone keyboard away
    };
    input.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { lastRun = input.value.trim(); runSearch(input.value, false); }, 350); });
    input.addEventListener('keydown', (e) => {
      const enter = e.keyCode === KEYS.ENTER || e.key === 'Enter' || e.key === 'Go' || e.key === 'Search';
      if (!enter || e.isComposing) return;
      e.preventDefault();
      go();
    });
    const form = input.form;
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); if (input.value.trim() !== lastRun || !railRows().length) go(); });
    // webOS and some Android keyboards close with "Done" and only send change: search if it was not searched yet
    input.addEventListener('change', () => { if (input.value.trim() !== lastRun) { lastRun = input.value.trim(); runSearch(input.value, false); } });
    input.addEventListener('search', () => { if (input.value.trim() !== lastRun) go(); }); // the clear (x) / Search key of type=search
    input.focus();
    if (lastQuery) runSearch(lastQuery, false);
  }

  let lastQuery = '';
  function runSearch(q, focusFirst) {
    q = (q || '').trim();
    lastQuery = q;
    if (q.length < 2) { UI.setMessage(rows(), SEARCH_HINT); return; }
    const seq = ++searchSeq;
    UI.setMessage(rows(), tr('Searching…'));
    API.search(q).then(res => {
      if (seq !== searchSeq || view !== 'search') return;
      const cats = [], map = {};
      [['live', tr('Live TV')], ['movies', tr('Movies')], ['series', tr('Series')]].forEach(pair => {
        let list = res[pair[0]] || [];
        if (pair[0] !== 'live') list = groupQualities(list);
        if (list.length) { cats.push({ category_id: 's_' + pair[0], category_name: pair[1], kind: pair[0], limit: 40 }); map['s_' + pair[0]] = list; }
      });
      if (!cats.length) { UI.setMessage(rows(), tr('No results for "{q}".', { q })); return; }
      render(cats, map, 'search'); // render() also refreshes the favorite keys that isFav reads
      if (focusFirst) { const l = railRows(); if (l.length) focusAt(l[0], 0, 0); }
    }).catch(e => {
      if (seq === searchSeq) UI.setMessage(rows(), tr('Search failed: {msg}', { msg: e && e.message ? e.message : e }));
    });
  }

  // ---------- landing page ----------
  // The app opens on the section that was open last. If that section has nothing in it,
  // it opens on the first tab of the menu instead.
  const SECTIONS = ['live', 'movies', 'series', 'recent', 'dl', 'fav', 'settings'];
  const DEFAULT_SECTION = 'movies'; // first run, nothing remembered yet

  const firstSection = () => {
    const b = UI.$('.navbtn[data-cat]:not([data-cat="search"])'); // Search sits first in the menu but is not a section to land on
    return b ? b.dataset.cat : 'live';
  };

  // open a section; `remember` stores it as the one to land on next time
  function openSection(kind, remember) {
    if (remember) API.pref('section', kind);
    if (kind === 'fav') { showFavs(false); return Promise.resolve(); }
    if (kind === 'recent') { showRecent(false); return Promise.resolve(); }
    if (kind === 'dl') { showDownloads(false); return Promise.resolve(); }
    if (kind === 'settings') { showSettings(false); return Promise.resolve(); }
    return loadCategory(kind);
  }

  // true when the section on screen shows no real item (the "All categories" chips do not count)
  const sectionEmpty = () => !rows().querySelector('.card:not(.chip)');

  function startSection() {
    const saved = API.pref('section');
    return SECTIONS.indexOf(saved) >= 0 ? saved : DEFAULT_SECTION;
  }

  function landing() {
    const kind = startSection();
    const first = firstSection();
    const p = openSection(kind, false);
    const id = loadId; // the open above bumped it; a later key press bumps it again
    return p.then(() => {
      if (id !== loadId || kind === first || !sectionEmpty()) return;
      return openSection(first, false); // empty: go to the top of the menu
    });
  }

  // colour buttons: red = search, green = favorites, blue = next section
  function onColor(k) {
    if (!homeVisible() || pickerOpen || confirmOpen || themeOpen) return false;
    const goNav = () => { const nb = UI.$('.navbtn.active'); if (nb) nb.focus(); };
    if (k === KEYS.RED) { showSearch(); return true; }
    if (k === KEYS.GREEN) { openSection('fav', true); goNav(); return true; }
    if (k === KEYS.BLUE) {
      const next = SECTIONS[(SECTIONS.indexOf(currentKind) + 1) % SECTIONS.length];
      openSection(next, true);
      goNav();
      return true;
    }
    return false;
  }

  // pointer scrolling or clicking: show every row again (keyboard row-nav hides the ones above the focused row)
  ['wheel', 'mousedown', 'touchstart'].forEach(evt => rows().addEventListener(evt, () => {
    rows().querySelectorAll('.row.past').forEach(r => r.classList.remove('past'));
  }, { passive: true }));
  // card pictures load lazily: start the ones scrolled near the screen.
  // capture:true also catches the sideways scroll inside each row.
  let lazyT = null;
  rows().addEventListener('scroll', () => {
    if (lazyT) return;
    lazyT = setTimeout(() => { lazyT = null; UI.lazyImages(rows()); }, 120);
  }, { passive: true, capture: true });
  UI.$$('.topbar .navbtn').forEach(b => b.addEventListener('mouseenter', () => {
    if (window.pointerAiming && !window.pointerAiming()) return; // a remote press must not be stolen by the cursor
    if (document.activeElement !== b) b.focus();
  }));

  // back on the menu: the slideshow takes the hero again
  UI.$$('.topbar .navbtn').forEach(b => b.addEventListener('focus', () => {
    if (homeVisible() && view === 'browse' && !slideTimer) startSlideshow(true);
  }));

  // navigation
  UI.$$('.navbtn[data-cat]').forEach(b => {
    b.addEventListener('click', () => {
      if (!homeVisible()) return; // signed out or another screen on top
      const cat = b.dataset.cat;
      if (cat === 'search') showSearch();
      else openSection(cat, true);
    });
  });

  // login
  UI.$$('.tab').forEach(t => {
    t.addEventListener('click', () => {
      UI.$$('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      const tab = t.dataset.tab;
      UI.$('#form-xtream').classList.toggle('hidden', tab !== 'xtream');
      UI.$('#form-m3u').classList.toggle('hidden', tab !== 'm3u');
    });
  });

  // typing on a TV is slow: remember server/username/playlist between logins
  const last = API.getLast();
  if (last.server) UI.$('#x-server').value = last.server;
  if (last.user) UI.$('#x-user').value = last.user;
  if (last.m3u) UI.$('#m-url').value = last.m3u;

  let busy = false;
  UI.$('#login-btn').addEventListener('click', () => {
    if (busy) return;
    busy = true;
    const btn = UI.$('#login-btn');
    const err = UI.$('#login-err');
    err.textContent = '';
    btn.textContent = tr('Signing in…');
    let p;
    if (UI.$('.tab.active').dataset.tab === 'xtream') {
      p = API.xtreamLogin(UI.$('#x-server').value.trim(), UI.$('#x-user').value.trim(), UI.$('#x-pass').value.trim());
    } else {
      p = API.m3uLogin(UI.$('#m-url').value.trim());
    }
    p.then(() => {
      if (window.Settings) Settings.rememberProfile();
      UI.showScreen('home');
      setActiveNav(startSection());
      landing();
    }).catch(e => {
      err.textContent = (e && e.message) || tr('Login failed');
    }).then(() => {
      busy = false;
      btn.textContent = tr('Sign in');
    });
  });

  ['#x-pass', '#m-url'].forEach(sel => {
    UI.$(sel).addEventListener('keydown', (e) => {
      if (e.keyCode === KEYS.ENTER) UI.$('#login-btn').click();
    });
  });

  // theme button: open the picker (live preview while browsing themes)
  const themeBtn = UI.$('#theme-btn');
  if (themeBtn) themeBtn.addEventListener('click', () => openThemePicker());

  // language: one button on the sign-in screen and one in the top bar; it shows the language it will switch to
  ['#login-lang', '#lang'].forEach(sel => {
    const b = UI.$(sel);
    const to = I18n.next();
    b.textContent = to.name;
    b.setAttribute('lang', to.id);
    b.addEventListener('click', () => I18n.set(to.id));
  });

  UI.$('#logout').addEventListener('click', () => {
    loadId++;
    API.clearConfig();
    UI.showScreen('login');
  });

  // settings + clock
  if (window.Settings) { Settings.applyAll(); try { updateBentoLayout(); } catch (e) {} }
  (function tickClock() {
    const el = UI.$('#clock');
    if (el) {
      const d = new Date();
      const two = n => (n < 10 ? '0' : '') + n;
      el.textContent = two(d.getHours()) + ':' + two(d.getMinutes());
    }
    setTimeout(tickClock, 15000);
  })();

  // auto-login
  if (API.getConfig()) {
    UI.showScreen('home');
    setActiveNav(startSection()); // the menu shows the right tab while the list loads
    UI.setMessage(rows(), tr('Loading…'));
    // stay signed in: if the server or network is slow (TV just woke up), keep retrying instead of logging out
    let tries = 0;
    (function restore() {
      API.ensureLoaded().then(() => landing()).catch(e => {
        tries++;
        UI.setMessage(rows(), ((e && e.message) || tr('Could not restore session')) + '  \u2014  ' + tr('Retrying…'));
        setTimeout(restore, Math.min(30000, 3000 * tries));
      });
    })();
  } else {
    UI.showScreen('login');
  }

  // Phones and tablets have no Back key on screen (iPhone has none at all): show an on-screen Back
  // arrow whenever there is a level to go back to (a category, episodes, or an open picker).
  const canGoBack = () => homeVisible() && (themeOpen || confirmOpen || pickerOpen || view === 'episodes' || view === 'category');
  (function touchBack() {
    const btn = UI.$('#touch-back');
    if (!btn) return;
    btn.addEventListener('click', () => { onBack(); });
    if (!document.documentElement.classList.contains('touch')) return; // TVs use the remote's Back key
    setInterval(() => { const want = canGoBack(); if (btn.classList.contains('hidden') === want) btn.classList.toggle('hidden', !want); }, 400);
  })();

  return { onBack, onArrow, onColor, onPlayerClosed, requestDownload, showDownloads, showSettings, canGoBack };
})();
window.App = App;
