const UI = (() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // Only allow http(s) image URLs (playlists are untrusted input).
  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }

  // stable hue from a name, so art-less tiles get their own colour
  function hueOf(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return h;
  }

  function markNoArt(card, name) {
    const h = hueOf(name || '');
    card.classList.add('noart');
    card.style.backgroundImage = 'linear-gradient(135deg, hsl(' + h + ',30%,26%), hsl(' + h + ',36%,13%))';
  }

  function firstFocus(name) {
    const sel = { login: '.tab.active', home: '.navbtn.active', player: '#btn-play' }[name];
    const el = sel && $(sel);
    if (el) el.focus();
  }

  function showScreen(name) {
    $$('.screen').forEach(s => s.classList.add('hidden'));
    $('#' + name).classList.remove('hidden');
    // The grain layer is an opacity overlay. On webOS that covers the video plane, so the picture stays black.
    document.body.classList.toggle('playback', name === 'player');
    firstFocus(name);
  }

  function setMessage(container, text) {
    container.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = text;
    container.appendChild(d);
  }

  // handlers: { pick(item, kind, rowItems), fav(item, kind) -> bool|null, isFav(item, kind) -> bool, progress(item, kind) -> 0..1 }
  function renderRows(container, categories, itemsByCat, kind, handlers) {
    container.innerHTML = '';
    container.scrollTop = 0;
    let count = 0;
    (categories || []).forEach(cat => {
      const rk = cat.kind || kind; // a row may carry its own kind (search results)
      const all = itemsByCat[cat.category_id] || [];
      const items = all.slice(0, cat.limit || 40);
      if (!items.length) return;
      count++;
      const row = document.createElement('div');
      row.className = 'row';
      const h3 = document.createElement('h3');
      const nm = document.createElement('span');
      nm.dir = 'auto'; // Arabic reads right-to-left, the heading stays on the left gutter
      nm.textContent = cat.category_name || 'Category';
      h3.appendChild(nm);
      let countEl = null;
      if (all.length > 1 && !cat.grid) {
        countEl = document.createElement('span');
        countEl.className = 'count';
        countEl.textContent = all.length;
        h3.appendChild(countEl);
      }
      const itemsEl = document.createElement('div');
      itemsEl.className = 'row-items' + (cat.grid ? ' grid' : '');
      items.forEach((it, idx) => {
        const card = document.createElement('div');
        card.className = 'card' + (it.cat ? ' chip' : '') + (!it.cat && (rk === 'movies' || rk === 'series') ? ' poster' : '');
        card.tabIndex = 0;
        const name = it.name || it.title || '';
        const src = safeUrl(it.icon || it.stream_icon || it.cover);
        if (src) {
          // The picture loads only when the card is near the screen (see lazyImages):
          // hundreds of eager downloads used to stall the rows on the TV.
          const img = document.createElement('img');
          img.onerror = () => { if (img.parentNode) img.parentNode.removeChild(img); markNoArt(card, name); };
          img.setAttribute('data-src', src);
          card.appendChild(img);
        } else {
          markNoArt(card, name);
        }
        const title = document.createElement('div');
        title.className = 'title';
        title.dir = 'auto';
        const label = document.createElement('span');
        label.textContent = it.name || it.title || '';
        title.appendChild(label);
        card.appendChild(title);
        const star = document.createElement('div');
        star.className = 'star';
        star.textContent = '★';
        star.style.display = handlers.isFav && handlers.isFav(it, rk) ? 'block' : 'none';
        card.appendChild(star);
        if (it._qualities && it._qualities.length > 1) {
          const q = document.createElement('div');
          q.className = 'qual';
          q.textContent = it._qualities.join(' \u00b7 ');
          card.appendChild(q);
        }
        const pct = handlers.progress ? handlers.progress(it, rk) : 0;
        if (pct > 0) {
          const bar = document.createElement('div');
          bar.className = 'prog';
          const fill = document.createElement('i');
          fill.style.width = Math.min(100, Math.round(pct * 100)) + '%';
          bar.appendChild(fill);
          card.appendChild(bar);
        }

        const pos = idx + 1;
        card.addEventListener('focus', () => {
          if (countEl) countEl.textContent = pos + ' / ' + all.length; // where am I in this row
          if (handlers.focus) handlers.focus(it, rk);
        });
        card.addEventListener('blur', () => { if (countEl) countEl.textContent = all.length; });
        // Magic Remote pointer: hovering a card focuses it, so the hero and spotlight follow
        card.addEventListener('mouseenter', () => {
          if (window.pointerAiming && !window.pointerAiming()) return; // remote movement scrolls tiles under a resting cursor
          if (document.activeElement !== card) { try { card.focus({ preventScroll: true }); } catch (e) { card.focus(); } }
        });
        card.addEventListener('click', () => handlers.pick(it, rk, items));
        card.addEventListener('keydown', (e) => {
          if (e.keyCode === KEYS.ENTER) { e.preventDefault(); handlers.pick(it, rk, items); }
          else if (e.keyCode === KEYS.YELLOW) {
            e.preventDefault();
            const r = handlers.fav ? handlers.fav(it, rk) : null;
            if (r === true || r === false) star.style.display = r ? 'block' : 'none';
          }
        });
        itemsEl.appendChild(card);
      });
      row.appendChild(h3);
      row.appendChild(itemsEl);
      container.appendChild(row);
    });
    if (!count) setMessage(container, 'Nothing here yet.');
    lazyImages(container);
  }

  // Pictures start loading only when their card is within a screen and a half
  // of the viewport. Runs after every render and on scroll (see app.js).
  let lazyQueued = false;
  function lazyImages(container) {
    if (lazyQueued || !container) return;
    lazyQueued = true;
    const run = () => {
      lazyQueued = false;
      const vh = window.innerHeight || 1080;
      const vw = window.innerWidth || 1920;
      const buf = vh * 1.5;
      const imgs = container.querySelectorAll('img[data-src]');
      for (let i = 0; i < imgs.length; i++) {
        const img = imgs[i];
        const r = img.getBoundingClientRect();
        if (r.bottom > -buf && r.top < vh + buf && r.right > -buf && r.left < vw + buf) {
          img.src = img.getAttribute('data-src');
          img.removeAttribute('data-src');
        }
      }
    };
    if (window.requestAnimationFrame) window.requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  function clearHero(el) {
    el.innerHTML = '';
  }

  const KICKERS = { live: 'Live TV', movies: 'Movie', series: 'Series', episode: 'Series', fav: 'Favorite' };

  // "2023 · Drama / Thriller · ★ 7.4 · 1h 52m" from whatever fields the provider sends
  function metaOf(it) {
    const parts = [];
    const y = String(it.releaseDate || it.release_date || it.releasedate || it.year || '').match(/\d{4}/);
    if (y) parts.push(y[0]);
    if (it.genre) parts.push(String(it.genre).split(/[,/]/).slice(0, 2).map(x => x.trim()).filter(Boolean).join(' / '));
    const r = parseFloat(it.rating);
    if (r > 0) parts.push('\u2605 ' + r.toFixed(1));
    const d = String(it.duration || '').match(/^(\d+):(\d+)/);
    if (d) parts.push((+d[1] ? +d[1] + 'h ' : '') + +d[2] + 'm');
    return parts.filter(Boolean).join('   \u00b7   ');
  }

  // fill in details that arrive after the hero is shown (movie info, TV guide), if it still shows that item
  function enrichHero(el, item, extra) {
    const live = Array.from(el.querySelectorAll('.hero-slide')).filter(x => !x.classList.contains('leaving'));
    const slide = live[live.length - 1];
    if (!slide || slide._item !== item) return;
    const box = slide.querySelector('.hero-content');
    const p = box.querySelector('p');
    const text = extra.metaText || metaOf(Object.assign({}, item, extra));
    if (text) {
      let meta = box.querySelector('.hero-meta');
      if (!meta) { meta = document.createElement('div'); meta.className = 'hero-meta'; box.insertBefore(meta, p); }
      meta.textContent = text;
    }
    if (extra.plot && p) { p.textContent = extra.plot; p.dir = 'auto'; }
  }

  // the hero becomes a big search field
  function showSearch(el) {
    clearHero(el);
    const slide = document.createElement('div');
    slide.className = 'hero-slide';
    const box = document.createElement('div');
    box.className = 'hero-content';
    const k = document.createElement('div');
    k.className = 'hero-kicker';
    k.textContent = 'Search';
    const input = document.createElement('input');
    input.id = 'search-input';
    input.className = 'search-input';
    input.placeholder = 'Channels, movies, series';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.dir = 'auto';
    const p = document.createElement('p');
    p.textContent = 'Press OK to type. Press Down for results.';
    box.appendChild(k);
    box.appendChild(input);
    box.appendChild(p);
    slide.appendChild(box);
    el.appendChild(slide);
    return input;
  }

  // opts (slideshow only): { count, index, ms } draws one progress segment per slide
  function setHero(el, item, kind, opts) {
    // crossfade: the old slide fades out underneath the new one, then is removed
    Array.from(el.querySelectorAll('.hero-slide')).forEach(old => {
      if (old.classList.contains('leaving')) return;
      old.classList.add('leaving');
      setTimeout(() => { if (old.parentNode) old.parentNode.removeChild(old); }, 700);
    });
    if (!item) return;
    const slide = document.createElement('div');
    slide.className = 'hero-slide';
    const src = safeUrl(item.icon || item.stream_icon || item.cover);
    if (src) {
      const bg = document.createElement('div');
      bg.className = 'hero-bg';
      bg.style.backgroundImage = 'url(' + JSON.stringify(src) + ')';
      if (opts && opts.ms) bg.style.animationDuration = '0.8s, ' + (opts.ms + 1500) + 'ms';
      slide.appendChild(bg);
      const art = document.createElement('img');
      art.className = 'hero-art';
      art.onerror = () => { if (art.parentNode) art.parentNode.removeChild(art); };
      art.src = src;
      slide.appendChild(art);
    }
    const box = document.createElement('div');
    box.className = 'hero-content';
    const k = document.createElement('div');
    k.className = 'hero-kicker';
    k.textContent = KICKERS[kind] || 'Featured';
    const h2 = document.createElement('h2');
    h2.dir = 'auto';
    const h2text = document.createElement('span');
    h2text.textContent = item.name || item.title || '';
    h2.appendChild(h2text);
    const p = document.createElement('p');
    p.textContent = item.plot || item.description || 'Press OK to play. Press the yellow button to add it to your favorites.';
    p.dir = 'auto';
    box.appendChild(k);
    box.appendChild(h2);
    const metaText = metaOf(item);
    if (metaText) {
      const meta = document.createElement('div');
      meta.className = 'hero-meta';
      meta.textContent = metaText;
      box.appendChild(meta);
    }
    box.appendChild(p);
    if (opts && opts.count > 1) {
      const dots = document.createElement('div');
      dots.className = 'hero-dots';
      for (let i = 0; i < opts.count; i++) {
        const seg = document.createElement('span');
        if (i < opts.index) seg.className = 'done';
        if (i === opts.index) {
          const fill = document.createElement('i');
          fill.style.animationDuration = opts.ms + 'ms';
          seg.appendChild(fill);
        }
        dots.appendChild(seg);
      }
      box.appendChild(dots);
    }
    slide.appendChild(box);
    slide._item = item;
    el.appendChild(slide);
  }

  return { showScreen, renderRows, lazyImages, setHero, enrichHero, showSearch, clearHero, setMessage, safeUrl, $, $$ };
})();
window.UI = UI;
