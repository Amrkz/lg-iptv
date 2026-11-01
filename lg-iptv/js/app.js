const App = (() => {
  const MAX_CATS = 8;
  let currentKind = 'movies';
  let view = 'browse'; // 'browse' | 'category' | 'episodes'
  let loadId = 0;      // bumps on every navigation so stale responses are ignored
  let currentEpisodes = []; // flat episode list of the series being browsed
  let progMap = {};         // watch progress, refreshed on each render

  const rows = () => UI.$('#rows');
  const hero = () => UI.$('#hero');
  const homeVisible = () => !UI.$('#home').classList.contains('hidden');

  function setActiveNav(kind) {
    UI.$$('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.cat === kind));
  }

  function favOf(item, kind) {
    if (kind === 'series' && !item.url) return null; // xtream series: nothing playable yet
    const url = API.streamUrl(item, kind);
    if (!url) return null;
    return { key: url, name: item.name || item.title || '', url, icon: item.icon || item.stream_icon || item.cover || '' };
  }

  function render(cats, map, kind) {
    progMap = API.progressMap();
    UI.renderRows(rows(), cats, map, kind, handlers);
  }

  function kindFromUrl(url) {
    if (/\/series\//i.test(url)) return 'series';
    if (/\/movie\//i.test(url) || /\.(mp4|mkv|avi)(\?|$)/i.test(url)) return 'movies';
    return 'live';
  }

  function resolveItem(it, kind) {
    const out = {
      url: API.streamUrl(it, kind),
      title: it.seriesName || it.name || it.title || '',
      subtitle: it.seriesName ? 'S' + it.season + ':E' + it.ep + '  ' + it.epTitle : '',
      icon: it.icon || it.stream_icon || it.cover || '',
      fav: favOf(it, kind),
      alt: kind === 'live' ? API.liveAltUrl(it) : null
    };
    if (kind === 'episode') {
      // saved with the watch progress, so Continue Watching can reopen the whole series
      out.series = { sid: it.sid, name: it.seriesName, season: it.season, ep: it.ep };
    }
    if (kind === 'live') {
      out.live = { streamId: it.stream_id, num: it.num, archive: API.hasArchive(it), item: it };
    }
    return out;
  }

  // text for the "paused" card: plot, year, rating, genre
  function detailsFor(it, kind) {
    if (kind === 'episode') {
      return Promise.resolve({ meta: 'S' + it.season + ':E' + it.ep + '  ·  ' + it.epTitle, plot: it.plot || '' });
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
      cats.push({ category_id: key, category_name: 'Season ' + sn });
      map[key] = list.map(ep => {
        const o = {
          name: 'E' + (ep.episode_num || '?') + ' · ' + (ep.title || 'Episode'),
          epTitle: ep.title || 'Episode',
          season: sn,
          ep: ep.episode_num || '?',
          icon: (ep.info && ep.info.movie_image) || series.cover || '',
          plot: (ep.info && (ep.info.plot || ep.info.description)) || series.plot || '',
          url: `${c.server}/series/${u}/${p}/${ep.id}.${ep.container_extension || 'mp4'}`,
          seriesName: series.name,
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
      details: it => detailsFor(it, 'episode')
    };
  }

  // Continue Watching: reopen the whole series so Next episode, Episodes and autoplay work
  function openContinue(entry) {
    const series = { series_id: entry.sid, name: entry.sname || entry.name, cover: entry.icon };
    const plain = () => pick({ name: entry.name, icon: entry.icon, url: entry.url }, 'series');
    API.getSeriesInfo(entry.sid).then(info => {
      const built = episodesFromInfo(series, info);
      let idx = -1;
      built.flat.forEach((o, i) => { if (o.url === entry.url) idx = i; });
      if (idx < 0) { plain(); return; }
      currentEpisodes = built.flat;
      Player.play(seriesCtx(built.flat, idx));
    }).catch(plain);
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
      out._variants = g.list.map(v => ({ item: v.item, label: v.q || 'Standard' }));
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

  // ---------- hero extras: TV guide for channels, details for movies ----------
  function enrich(item, kind) {
    if (kind === 'live' && item.stream_id) {
      API.getShortEpg(item.stream_id).then(list => {
        if (!list.length) return;
        const t = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const now = list[0], next = list[1];
        UI.enrichHero(hero(), item, { metaText: 'Now  ' + now.title + '  (' + t(now.start) + '\u2013' + t(now.end) + ')' + (next ? '     Next  ' + next.title : '') });
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
      if (kind === 'fav') showFavs(true);
      return on;
    },
    isFav: (item, kind) => {
      const f = favOf(item, kind);
      return !!f && API.isFav(f.key);
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
    UI.setMessage(rows(), 'Loading…');

    return API.getCategories(kind).then(cats => {
      if (id !== loadId) return;
      const allCats = cats && cats.length ? cats : [{ category_id: 'all', category_name: 'All' }];
      const categories = allCats.slice(0, MAX_CATS);
      const itemsByCat = {};
      return Promise.all(categories.map(c =>
        API.getStreams(kind, c.category_id).then(items => {
          items = Array.isArray(items) ? items : [];
          itemsByCat[c.category_id] = (kind === 'movies' || kind === 'series') ? groupQualities(items) : items;
        })
      )).then(() => {
        if (id !== loadId) return;
        let shown = categories;
        if (allCats.length > 1) {
          // first row lists EVERY category, so panels with hundreds of them stay reachable
          itemsByCat.__cats = allCats.map(c => ({ name: c.category_name, cat: c }));
          shown = [{ category_id: '__cats', category_name: 'All categories', limit: 1000 }].concat(categories);
        }
        if (kind === 'live') {
          const rec = API.getRecent();
          if (rec.length) {
            itemsByCat.__recent = rec;
            shown = [{ category_id: '__recent', category_name: 'Recently watched', limit: 20 }].concat(shown);
          }
        }
        if (kind === 'movies' || kind === 'series') {
          const cont = API.listProgress(kind).slice(0, 20).map(e => ({ name: e.name, icon: e.icon, url: e.url, _cont: e }));
          if (cont.length) {
            itemsByCat.__cont = cont;
            shown = [{ category_id: '__cont', category_name: 'Continue Watching', limit: 20 }].concat(shown);
          }
        }
        render(shown, itemsByCat, kind);
        setSlides(categories, itemsByCat, kind);
      });
    }).catch(e => {
      if (id === loadId) UI.setMessage(rows(), 'Could not load: ' + (e && e.message ? e.message : e));
    });
  }

  function showCategory(kind, cat) {
    const id = ++loadId;
    view = 'category';
    stopSlideshow();
    UI.clearHero(hero());
    UI.setMessage(rows(), 'Loading\u2026');
    API.getStreams(kind, cat.category_id).then(items => {
      if (id !== loadId) return;
      items = Array.isArray(items) ? items : [];
      if (kind === 'movies' || kind === 'series') items = groupQualities(items);
      const map = {};
      map[cat.category_id] = items;
      render([{ category_id: cat.category_id, category_name: cat.category_name + ' (' + items.length + ')', limit: 300, grid: true }], map, kind);
      const firstCard = UI.$('.card');
      if (firstCard) firstCard.focus();
    }).catch(e => {
      if (id === loadId) UI.setMessage(rows(), 'Could not load: ' + (e && e.message ? e.message : e));
    });
  }

  function pick(item, kind, list) {
    if (item.cat) { showCategory(currentKind, item.cat); return; }
    if (item._variants && item._variants.length > 1) { openPicker(item, kind); return; }
    if (kind === 'series' && !item.url) { showEpisodes(item); return; }
    if (item._cont && item._cont.sid) { openContinue(item._cont); return; }
    const url = API.streamUrl(item, kind);
    if (!url) return;
    if (kind === 'live') recordRecent(item);
    const k = kind === 'fav' ? kindFromUrl(url) : (kind === 'episode' ? 'series' : kind);
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
    }
    Player.play(ctx);
  }

  function showEpisodes(series) {
    const id = ++loadId;
    view = 'episodes';
    UI.setMessage(rows(), 'Loading episodes…');
    UI.setHero(hero(), series, 'series');
    API.getSeriesInfo(series.series_id).then(info => {
      if (id !== loadId) return;
      const built = episodesFromInfo(series, info);
      currentEpisodes = built.flat;
      render(built.cats, built.map, 'episode');
      const firstCard = UI.$('.card');
      if (firstCard) firstCard.focus();
    }).catch(e => {
      if (id === loadId) UI.setMessage(rows(), 'Could not load episodes: ' + (e && e.message ? e.message : e));
    });
  }

  function showFavs(refocus) {
    loadId++;
    currentKind = 'fav';
    view = 'browse';
    setActiveNav('fav');
    stopSlideshow();
    UI.clearHero(hero());
    const favCats = [{ category_id: 'fav', category_name: 'Favorites' }], favMap = { fav: API.getFavs() };
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
    if (pickerOpen) { spatialNav(dir, UI.$('#picker')); return true; }
    const a = document.activeElement;
    const list = railRows();
    if (!a || !a.classList) return false;
    if (!list.length) { if (a.id === 'search-input' && dir === 'UP') { focusNav(); return true; } return false; }

    if (a.classList.contains('navbtn')) {
      if (dir === 'LEFT' || dir === 'RIGHT') {
        const navs = Array.from(document.querySelectorAll('#home .topbar .navbtn'));
        const n = navs[navs.indexOf(a) + (dir === 'RIGHT' ? 1 : -1)];
        if (n) n.focus();
        return true;
      }
      if (dir === 'DOWN') { focusAt(list[0], 0, list[0]._last || 0); return true; }
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
    const a = document.activeElement;
    if (a && a.classList && a.classList.contains('card') && rowOf(a) && railRows().indexOf(rowOf(a)) >= 0) place(a);
  }

  // Back on the home screen: step out of sub-views first, exit the app from Live TV.
  function onBack() {
    if (!homeVisible()) return false;
    if (pickerOpen) { closePicker(); return true; }
    if (view === 'episodes' || view === 'category') { loadCategory(currentKind); return true; }
    if (currentKind !== 'movies') { loadCategory('movies'); return true; } // Movies is home
    return false;
  }

  // ---------- search ----------
  let searchTimer = null, searchSeq = 0;
  const SEARCH_HINT = 'Type at least two letters to search channels, movies and series.';

  function showSearch() {
    loadId++;
    currentKind = 'search';
    view = 'search';
    setActiveNav('search');
    stopSlideshow();
    clearTimeout(heroTimer);
    UI.setMessage(rows(), SEARCH_HINT);
    const input = UI.showSearch(hero());
    input.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(input.value, false), 350); });
    input.addEventListener('keydown', (e) => { if (e.keyCode === KEYS.ENTER) { clearTimeout(searchTimer); runSearch(input.value, true); } });
    input.focus();
  }

  function runSearch(q, focusFirst) {
    q = (q || '').trim();
    if (q.length < 2) { UI.setMessage(rows(), SEARCH_HINT); return; }
    const seq = ++searchSeq;
    UI.setMessage(rows(), 'Searching\u2026');
    API.search(q).then(res => {
      if (seq !== searchSeq || view !== 'search') return;
      const cats = [], map = {};
      [['live', 'Live TV'], ['movies', 'Movies'], ['series', 'Series']].forEach(pair => {
        let list = res[pair[0]] || [];
        if (pair[0] !== 'live') list = groupQualities(list);
        if (list.length) { cats.push({ category_id: 's_' + pair[0], category_name: pair[1], kind: pair[0], limit: 40 }); map['s_' + pair[0]] = list; }
      });
      if (!cats.length) { UI.setMessage(rows(), 'No results for "' + q + '".'); return; }
      progMap = API.progressMap();
      UI.renderRows(rows(), cats, map, 'search', handlers);
      if (focusFirst) { const l = railRows(); if (l.length) focusAt(l[0], 0, 0); }
    }).catch(e => {
      if (seq === searchSeq) UI.setMessage(rows(), 'Search failed: ' + (e && e.message ? e.message : e));
    });
  }

  // ---------- landing page ----------
  // The app opens on the section that was open last. If that section has nothing in it,
  // it opens on the first tab of the menu instead.
  const SECTIONS = ['live', 'movies', 'series', 'fav'];
  const DEFAULT_SECTION = 'movies'; // first run, nothing remembered yet

  const firstSection = () => {
    const b = UI.$('.navbtn[data-cat]');
    return b ? b.dataset.cat : 'live';
  };

  // open a section; `remember` stores it as the one to land on next time
  function openSection(kind, remember) {
    if (remember) API.pref('section', kind);
    if (kind === 'fav') { showFavs(false); return Promise.resolve(); }
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
    if (!homeVisible() || pickerOpen) return false;
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
    btn.textContent = 'Signing in…';
    let p;
    if (UI.$('.tab.active').dataset.tab === 'xtream') {
      p = API.xtreamLogin(UI.$('#x-server').value.trim(), UI.$('#x-user').value.trim(), UI.$('#x-pass').value.trim());
    } else {
      p = API.m3uLogin(UI.$('#m-url').value.trim());
    }
    p.then(() => {
      UI.showScreen('home');
      setActiveNav(startSection());
      landing();
    }).catch(e => {
      err.textContent = (e && e.message) || 'Login failed';
    }).then(() => {
      busy = false;
      btn.textContent = 'Sign In';
    });
  });

  ['#x-pass', '#m-url'].forEach(sel => {
    UI.$(sel).addEventListener('keydown', (e) => {
      if (e.keyCode === KEYS.ENTER) UI.$('#login-btn').click();
    });
  });

  UI.$('#logout').addEventListener('click', () => {
    loadId++;
    API.clearConfig();
    UI.showScreen('login');
  });

  // auto-login
  if (API.getConfig()) {
    UI.showScreen('home');
    setActiveNav(startSection()); // the menu shows the right tab while the list loads
    UI.setMessage(rows(), 'Loading…');
    API.ensureLoaded().then(() => landing()).catch(e => {
      API.clearConfig();
      UI.showScreen('login');
      UI.$('#login-err').textContent = (e && e.message) || 'Could not restore session';
    });
  } else {
    UI.showScreen('login');
  }

  return { onBack, onArrow, onColor, onPlayerClosed };
})();
window.App = App;
