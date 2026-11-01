// Netflix-style player.
//
// Player.play(ctx) where ctx = {
//   type:   'live' | 'movie' | 'series' | 'single' | 'catchup',
//   kind:   'live' | 'movies' | 'series' | 'catchup'   (used to file "continue watching")
//   items:  array the user can move through (channels, episodes, or a single item),
//   index:  position in items,
//   resolve(item) -> { url, title, subtitle, icon, fav, alt, series?, live? }
//   onPlay(item)?   called each time an item starts (recently watched)
//   details(item)?  -> Promise<{ meta, plot }> for the paused card
// }
const Player = (() => {
  const $ = (id) => document.getElementById(id);
  const video = $('video');
  const playerEl = $('player');
  const overlayEl = $('overlay');
  const miniEl = $('mini');
  const drawerEl = $('drawer');
  const drawerBody = $('drawer-body');
  const seekbar = $('seekbar');
  const sbBuf = $('sb-buf');
  const sbPlayed = $('sb-played');
  const sbThumb = $('sb-thumb');
  const sbBubble = $('sb-bubble');
  const tElapsed = $('t-elapsed');
  const tRemain = $('t-remain');
  const msgEl = $('player-msg');
  const toastEl = $('toast');
  const spinner = $('spinner');
  const chnumEl = $('chnum');
  const bannerEl = $('banner');
  const bnTop = $('bn-top');
  const bnNow = $('bn-now');
  const bnNext = $('bn-next');
  const upBox = $('upnext');
  const upNextBtn = $('up-next');
  const upCreditsBtn = $('up-credits');
  const upFill = $('up-fill');
  const skipBtn = $('skipintro');
  const stillEl = $('still');
  const stillGo = $('still-go');
  const stillBack = $('still-back');
  const sleepEl = $('sleepcard');
  const sleepSub = $('sleep-sub');
  const sleepKeep = $('sleep-keep');
  const pauseCard = $('pausecard');
  const pcTitle = $('pc-title');
  const pcMeta = $('pc-meta');
  const pcPlot = $('pc-plot');
  const B = {
    back: $('btn-back'), play: $('btn-play'), rw: $('btn-rw'), ff: $('btn-ff'), next: $('btn-next'),
    start: $('btn-start'), live: $('btn-live'),
    eps: $('btn-eps'), chans: $('btn-chans'), guide: $('btn-guide'), tracks: $('btn-tracks'), pic: $('btn-pic'),
    speed: $('btn-speed'), sleep: $('btn-sleep'), fav: $('btn-fav')
  };

  const PATH_PLAY = 'M8 5v14l11-7z';
  const PATH_PAUSE = 'M6 5h4v14H6zm8 0h4v14h-4z';
  const SCRUB_STEPS = [10, 10, 10, 20, 30, 60, 60, 120, 180, 300]; // grows while a key is held
  const HIDE_AFTER = 8000;
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const BUSY_RETRY_MS = 8000, BUSY_RETRY_MAX = 3;
  const STALL_MS = 15000;          // a started stream that does not move this long is reopened
  const RECONNECT_MAX = 3;
  const ZAP_DELAY = 450;           // channel keys wait this long before opening the stream
  const NUMBER_DELAY = 1500;
  const UP_COUNT_MS = 10000;       // Up Next countdown
  const STILL_AFTER = 3;           // episodes that start by themselves before "Are you still watching?"
  const PAUSE_CARD_MS = 10000;
  const LIVE_RELOAD_MS = 30000;    // a live channel paused longer than this reopens at the live point

  const PICTURES = [
    { id: 'fit', name: 'Fit', note: 'The whole picture, black bars if needed' },
    { id: 'fill', name: 'Fill', note: 'Fills the screen, trims the edges' },
    { id: 'zoom', name: 'Zoom', note: 'Cuts black bars that are part of the broadcast' },
    { id: 'stretch', name: 'Stretch', note: 'Stretches the picture to the screen shape' },
    { id: '43', name: '4:3', note: 'Narrow picture in the middle' }
  ];
  const SUB_SIZES = [{ id: 's', name: 'Small', px: 32 }, { id: 'm', name: 'Medium', px: 44 }, { id: 'l', name: 'Large', px: 60 }];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let ctx = null, info = null, alts = [];
  let hls = null, retries = 0, started = false, stallTimer = null;
  let hideTimer = null, toastTimer = null;
  let scrub = null;                 // { pos, n, ts, timer } while the user is dragging the bar
  let skipAcc = 0, skipTs = 0, skipFrom = 0;
  let upShown = false, upDismissed = false, resumeDone = false, upLeft = UP_COUNT_MS, upLastTick = 0;
  let returnFocus = null, drawerOpener = null, saveCount = 0, lastRowBtn = null;
  let startUrl = '', curSource = '';
  let engine = '';                                 // 'js' or 'native'; the other is tried once
  let triedJs = false, triedNative = false;
  let wantPlay = true;
  let failed = false, busyRetries = 0, busyTimer = null;
  let httpStatus = 0, httpNote = '';               // status captured from the play request, so a failure needs no extra fetch
  let playToken = 0;

  let reconnects = 0, lastReconnect = 0, lastTime = -1, lastMoveTs = 0;
  let seekOnLoad = 0, seekTries = 0;
  let pausedAt = 0, ignorePauseUntil = 0;
  let finishedHandled = false, resumedFrom = 0;

  let zapIdx = -1, zapTimer = null, prevItem = null;
  let numBuf = '', numTimer = null, bannerTimer = null, bannerKey = '';
  let epg = [], epgLoadedAt = 0;
  let savedLive = null;                            // live channel to return to from a replay

  let autoChain = 0, lastAdvance = 0, stillOpen = false;
  let sleepAt = 0, sleepEnd = false, sleepWarnShown = false;
  let pauseCardTimer = null, pauseCardShown = false;
  let langApplied = false, langTries = 0;
  let introRange = null, skipShown = false, learnOff = 0;
  let pictureId = API.pref('aspect') || 'fit';

  const hidden = () => playerEl.classList.contains('hidden');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const isLive = () => !!ctx && ctx.type === 'live';
  const isCatchup = () => !!ctx && ctx.type === 'catchup';
  const overlayVisible = () => !overlayEl.classList.contains('hide');
  const drawerOpen = () => !drawerEl.classList.contains('hide');
  const hasDuration = () => !!video.duration && isFinite(video.duration);
  const two = (n) => (n < 10 ? '0' : '') + n;
  const hhmm = (ms) => { const d = new Date(ms); return two(d.getHours()) + ':' + two(d.getMinutes()); };
  const altsOf = (i) => (i && i.alt ? [].concat(i.alt) : []).filter(Boolean);
  const sameChannel = (a, b) => !!a && !!b && String(a.stream_id || a.url) === String(b.stream_id || b.url);
  const hasArchive = () => isLive() && !!(info && info.live && info.live.archive);

  function epgLine() {
    if (!isLive() || !epg.length) return '';
    let s = 'Now: ' + epg[0].title;
    if (epg[1]) s += '  ·  ' + hhmm(epg[1].start) + ' ' + epg[1].title;
    return s;
  }
  const setMsg = (t) => {
    msgEl.textContent = t || '';
    const sub = $('player-sub');
    if (!sub) return;
    sub.textContent = t || epgLine() || (info && info.subtitle) || '';
  };
  function refreshSub() {
    if (msgEl.textContent) return;
    const sub = $('player-sub');
    if (sub) sub.textContent = epgLine() || (info && info.subtitle) || '';
  }
  const safePlay = () => { const p = video.play(); if (p && p.catch) p.catch(() => {}); };
  const idle = () => { autoChain = 0; };

  function resumePlay() {
    if (failed && info) { busyRetries = 0; reconnects = 0; restart(0); return; } // OK on the error screen retries
    wantPlay = true;
    // old buffered video is useless on a live channel: reopen at the live point
    if (isLive() && pausedAt && Date.now() - pausedAt > LIVE_RELOAD_MS && info) { pausedAt = 0; restart(0); return; }
    pausedAt = 0;
    safePlay();
  }
  const togglePlay = () => {
    if (video.paused || failed) resumePlay();
    else { wantPlay = false; video.pause(); }
  };

  function fmt(t) {
    t = Math.max(0, Math.floor(t));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const ss = (s < 10 ? '0' : '') + s;
    return h ? h + ':' + (m < 10 ? '0' : '') + m + ':' + ss : m + ':' + ss;
  }

  function toast(text, ms) {
    toastEl.textContent = '';
    const s = document.createElement('span'); // the pill sizes itself to the text (see #player .toast span)
    s.textContent = text;
    toastEl.appendChild(s);
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), ms || 1400);
  }

  // ---------- overlay ----------
  function armHide() {
    clearTimeout(hideTimer);
    // Paused, failed, scrubbing, or a drawer: the controls stay until the user leaves them.
    if (!overlayVisible() || video.paused || failed || drawerOpen() || scrub) return;
    hideTimer = setTimeout(hideOverlay, HIDE_AFTER);
  }

  function showOverlay(focusEl) {
    if (stillOpen) return;
    hideBanner();
    overlayEl.classList.remove('hide');
    miniEl.classList.add('hide');
    // webOS drops a focus() that happens in the same turn the controls become visible
    if (focusEl) setTimeout(() => { if (overlayVisible() && !hidden()) focusEl.focus(); }, 0);
    armHide();
  }

  function forceHideOverlay() {
    clearTimeout(hideTimer);
    overlayEl.classList.add('hide');
    const a = document.activeElement;
    if (a && overlayEl.contains(a)) a.blur();
  }

  function hideOverlay() {
    if (drawerOpen() || scrub || failed || video.paused) return;
    forceHideOverlay();
    if (upShown) { upNextBtn.focus(); return; } // so OK plays the next episode
    if (skipShown) { skipBtn.focus(); return; }
    syncMini();
    miniEl.classList.remove('hide');
  }

  function syncMini() {
    const live = isLive();
    $('mini-ico').textContent = video.paused ? '▶' : '❚❚';
    $('mini-el').textContent = live ? 'LIVE' : tElapsed.textContent;
    $('mini-re').textContent = live ? '' : tRemain.textContent;
    $('mini-played').style.width = live ? '100%' : sbPlayed.style.width;
  }

  function updatePlayIcon() {
    B.play.querySelector('path').setAttribute('d', video.paused ? PATH_PLAY : PATH_PAUSE);
    B.play.querySelector('.plabel').textContent = video.paused ? 'Play' : 'Pause';
    if (!miniEl.classList.contains('hide')) syncMini();
  }

  function refreshFav() {
    const on = !!(info && info.fav && API.isFav(info.fav.key));
    B.fav.classList.toggle('on', on);
    B.fav.querySelector('.plabel').textContent = on ? 'Favorited' : 'Favorite';
    B.fav.classList.toggle('hidden', !(info && info.fav));
  }

  function updateStartBtn() {
    const vodResume = !!ctx && !isLive() && !isCatchup() && resumedFrom > 0;
    B.start.classList.toggle('hidden', !(hasArchive() || vodResume));
  }

  // show only the controls that make sense for what is playing
  function applyMode() {
    const live = isLive();
    const series = !!ctx && ctx.type === 'series';
    B.rw.classList.toggle('hidden', live);
    B.ff.classList.toggle('hidden', live);
    B.speed.classList.toggle('hidden', live);
    B.next.classList.toggle('hidden', !(series && ctx.index < ctx.items.length - 1));
    B.eps.classList.toggle('hidden', !series);
    B.chans.classList.toggle('hidden', !(live && ctx.items.length > 1));
    B.live.classList.toggle('hidden', !isCatchup());
    B.guide.classList.toggle('hidden', !hasArchive());
    updateStartBtn();
    seekbar.classList.toggle('live', live);
    seekbar.classList.remove('epg');
    seekbar.tabIndex = live ? -1 : 0;
    tElapsed.textContent = live ? '' : '0:00';
    tRemain.textContent = live ? 'LIVE' : '-0:00';
    sbPlayed.style.width = live ? '100%' : '0';
    sbBuf.style.width = '0';
    B.speed.querySelector('.plabel').textContent = 'Speed';
  }

  // ---------- picture size ----------
  // Only the video box changes. A transform over the picture would drop the TV's video plane.
  function applyPicture() {
    const s = video.style;
    s.top = '0'; s.left = '0'; s.width = '100%'; s.height = '100%'; s.objectFit = 'contain';
    if (pictureId === 'fill') s.objectFit = 'cover';
    else if (pictureId === 'stretch') s.objectFit = 'fill';
    else if (pictureId === 'zoom') { s.width = '133.34%'; s.height = '133.34%'; s.left = '-16.67%'; s.top = '-16.67%'; }
    else if (pictureId === '43') { s.width = '75%'; s.left = '12.5%'; s.objectFit = 'fill'; }
  }

  function setPicture(id) {
    pictureId = id;
    API.pref('aspect', id);
    applyPicture();
  }

  function pictureName(id) {
    for (let i = 0; i < PICTURES.length; i++) if (PICTURES[i].id === id) return PICTURES[i].name;
    return id;
  }

  function cyclePicture() {
    let idx = 0;
    PICTURES.forEach((p, i) => { if (p.id === pictureId) idx = i; });
    const next = PICTURES[(idx + 1) % PICTURES.length];
    setPicture(next.id);
    toast('Picture: ' + next.name);
  }

  // ---------- subtitle style ----------
  function applySubStyle() {
    let st = document.getElementById('cue-style');
    const pref = API.pref('subStyle');
    if (!pref || !pref.size) { if (st) st.textContent = ''; return; }
    let px = 44;
    SUB_SIZES.forEach(s => { if (s.id === pref.size) px = s.px; });
    if (!st) { st = document.createElement('style'); st.id = 'cue-style'; document.head.appendChild(st); }
    st.textContent = 'video::cue { font-size: ' + px + 'px; ' +
      (pref.bg ? 'background-color: rgba(0, 0, 0, 0.75);' : 'background-color: transparent; text-shadow: 0 0 6px #000, 0 0 6px #000;') + ' }';
  }

  // ---------- seek bar ----------
  function renderSeek(pos, scrubbing) {
    const d = video.duration;
    const pct = clamp(pos / d, 0, 1) * 100;
    sbPlayed.style.width = pct + '%';
    sbThumb.style.left = pct + '%';
    tElapsed.textContent = fmt(pos);
    tRemain.textContent = '-' + fmt(d - pos);
    sbBubble.classList.toggle('hidden', !scrubbing);
    if (scrubbing) { sbBubble.style.left = pct + '%'; sbBubble.textContent = fmt(pos); }
  }

  function updateTime() {
    if (hidden() || !ctx) return;
    if (isLive()) return;
    if (!hasDuration()) { tElapsed.textContent = '--:--'; tRemain.textContent = ''; return; }
    if (!scrub) renderSeek(video.currentTime, document.activeElement === seekbar);
    if (!miniEl.classList.contains('hide')) syncMini();
    const b = video.buffered;
    if (b && b.length) sbBuf.style.width = clamp(b.end(b.length - 1) / video.duration, 0, 1) * 100 + '%';
  }

  function scrubStep(sign) {
    if (!hasDuration()) return;
    const now = Date.now();
    if (!scrub) scrub = { pos: video.currentTime, n: 0, ts: 0, timer: null };
    scrub.n = now - scrub.ts < 450 ? scrub.n + 1 : 0; // key held / tapped fast -> bigger jumps
    scrub.ts = now;
    const step = SCRUB_STEPS[Math.min(scrub.n, SCRUB_STEPS.length - 1)];
    scrub.pos = clamp(scrub.pos + sign * step, 0, video.duration - 1);
    renderSeek(scrub.pos, true);
    clearTimeout(hideTimer);
    clearTimeout(scrub.timer);
    scrub.timer = setTimeout(commitScrub, 900);
  }

  function commitScrub() {
    if (!scrub) return;
    clearTimeout(scrub.timer);
    learnIntro(video.currentTime, scrub.pos);
    video.currentTime = scrub.pos;
    scrub = null;
    sbBubble.classList.add('hidden');
    updateTime();
    armHide();
  }

  function cancelScrub() {
    if (!scrub) return;
    clearTimeout(scrub.timer);
    scrub = null;
    sbBubble.classList.add('hidden');
    updateTime();
    armHide();
  }

  function skipBy(sec) {
    if (!hasDuration()) return;
    commitScrub();
    const now = Date.now();
    if (now - skipTs >= 1200) skipFrom = video.currentTime;
    skipAcc = now - skipTs < 1200 ? skipAcc + sec : sec;
    skipTs = now;
    const to = clamp(video.currentTime + sec, 0, video.duration - 0.5);
    learnIntro(skipFrom, to);
    video.currentTime = to;
    toast((skipAcc > 0 ? '+' : '') + skipAcc + 's');
    updateTime();
  }

  // ---------- continue watching ----------
  function seriesMeta(i) {
    return i && i.series ? { sid: i.series.sid, sname: i.series.name, sn: i.series.season, epn: i.series.ep } : {};
  }

  // an episode is done: it leaves Continue Watching and the next episode takes its place
  function markFinished() {
    if (!ctx || !info || finishedHandled) return;
    finishedHandled = true;
    API.removeProgress(info.url);
    const nx = nextItem();
    if (nx) {
      const r = ctx.resolve(nx);
      API.saveProgress(Object.assign({ url: r.url, name: r.title + (r.subtitle ? ' · ' + r.subtitle : ''), icon: r.icon || '', kind: ctx.kind, t: 0, d: 0 }, seriesMeta(r)));
    }
  }

  function saveProgress() {
    if (!ctx || !info || isLive() || isCatchup() || !started || !hasDuration() || finishedHandled) return;
    const d = video.duration, t = video.currentTime;
    if (d < 120 || t < 20) return;
    if (d - t < 30 || t / d > 0.95) { markFinished(); return; }
    API.saveProgress(Object.assign({ url: info.url, name: info.title + (info.subtitle ? ' · ' + info.subtitle : ''), icon: info.icon || '', kind: ctx.kind, t, d }, seriesMeta(info)));
  }

  function tryResume() {
    if (resumeDone || !ctx || isLive() || isCatchup() || !hasDuration()) return;
    resumeDone = true;
    const pr = API.getProgress(info.url);
    if (pr && pr.t > 20 && pr.t < video.duration - 30) {
      video.currentTime = pr.t;
      resumedFrom = pr.t;
      updateStartBtn();
      toast('Resumed at ' + fmt(pr.t), 2200);
    }
  }

  function applySeek() {
    if (seekOnLoad <= 0 || !hasDuration()) return;
    try { video.currentTime = Math.min(seekOnLoad, video.duration - 1); } catch (e) {}
    if (Math.abs(video.currentTime - seekOnLoad) < 5 || ++seekTries >= 6) { seekOnLoad = 0; seekTries = 0; }
  }

  // ---------- next episode ----------
  const nextItem = () => (ctx && ctx.type === 'series' ? ctx.items[ctx.index + 1] || null : null);

  function showUpNext(nx) {
    upShown = true;
    upLeft = UP_COUNT_MS;
    upLastTick = Date.now();
    $('up-title').textContent = nx.name || '';
    const t = $('up-thumb');
    const src = UI.safeUrl(nx.icon);
    t.style.backgroundImage = src ? 'url(' + JSON.stringify(src) + ')' : 'none';
    upBox.classList.remove('hidden');
    hideSkip();
    updateUpCard();
    // like Netflix: get the controls out of the way so OK on the card plays the next episode
    if (!drawerOpen() && !scrub && !stillOpen) {
      forceHideOverlay();
      upNextBtn.focus();
    }
  }

  function hideUpNext() {
    upShown = false;
    upBox.classList.add('hidden');
    const a = document.activeElement;
    if (a === upNextBtn || a === upCreditsBtn) a.blur();
  }

  function updateUpCard() {
    $('up-count').textContent = 'Starts in ' + Math.max(0, Math.ceil(upLeft / 1000)) + 's';
    upFill.style.width = clamp(100 - (upLeft / UP_COUNT_MS) * 100, 0, 100) + '%';
  }

  function dismissCredits() {
    upDismissed = true;
    hideUpNext();
  }

  function checkUpNext() {
    const nx = nextItem();
    if (!nx) { if (upShown) hideUpNext(); return; }
    if (!hasDuration() || scrub) return;
    const now = Date.now();
    const rem = video.duration - video.currentTime;
    const threshold = clamp(video.duration * 0.05, 20, 60); // roughly the end credits
    if (rem <= threshold && rem > 0.5 && !upDismissed) {
      if (!upShown) showUpNext(nx);
      // the count only runs while the card is what the viewer sees
      const running = !video.paused && !drawerOpen() && !overlayVisible() && !stillOpen;
      if (running) upLeft -= Math.min(1000, now - upLastTick);
      upLastTick = now;
      updateUpCard();
      if (upLeft <= 0) autoAdvance();
    } else if (upShown && (rem > threshold + 3 || upDismissed)) {
      hideUpNext();
    }
  }

  // the next episode starts by itself (credits countdown or end of file)
  function autoAdvance() {
    const now = Date.now();
    if (now - lastAdvance < 3000) return;
    lastAdvance = now;
    if (sleepEnd) { sleepDone(); return; }
    if (autoChain >= STILL_AFTER) { showStill(); return; }
    autoChain++;
    markFinished();
    playIndex(ctx.index + 1, true);
  }

  function showStill() {
    stillOpen = true;
    wantPlay = false;
    video.pause();
    hideUpNext();
    hideSkip();
    forceHideOverlay();
    miniEl.classList.add('hide');
    stillEl.classList.remove('hidden');
    stillGo.focus();
  }

  function hideStill() {
    stillOpen = false;
    stillEl.classList.add('hidden');
  }

  function stillKey(e, k, dir) {
    e.preventDefault();
    if (k === KEYS.ENTER) {
      const a = document.activeElement;
      if (a === stillGo || a === stillBack) a.click(); else stillGo.click();
    } else if (k === KEYS.BACK || k === KEYS.STOP) {
      hideStill();
      back();
    } else if (dir === 'LEFT' || dir === 'RIGHT') {
      (document.activeElement === stillGo ? stillBack : stillGo).focus();
    }
  }

  // ---------- skip intro (learned from the viewer's own skips) ----------
  const sidOf = () => (info && info.series && info.series.sid) || '';

  function loadIntro() {
    introRange = ctx && ctx.type === 'series' && sidOf() ? API.getIntro(sidOf()) : null;
  }

  function learnIntro(oldT, newT) {
    if (!ctx || ctx.type !== 'series' || !sidOf() || Date.now() < learnOff) return;
    if (oldT > 300 || newT - oldT < 30 || newT < 20 || newT > 360) return;
    const had = !!introRange;
    introRange = { from: Math.round(oldT), to: Math.round(newT) };
    API.setIntro(sidOf(), introRange);
    if (!had) toast('Intro remembered for this series', 2400);
  }

  function showSkip() {
    skipShown = true;
    skipBtn.classList.remove('hidden');
    if (!overlayVisible() && !drawerOpen() && !upShown && !stillOpen) skipBtn.focus();
  }

  function hideSkip() {
    if (!skipShown) return;
    skipShown = false;
    skipBtn.classList.add('hidden');
    if (document.activeElement === skipBtn) skipBtn.blur();
  }

  function doSkip() {
    if (!introRange) return;
    learnOff = Date.now() + 3000;
    video.currentTime = introRange.to;
    hideSkip();
    toast('Intro skipped');
  }

  function checkSkipIntro() {
    if (!introRange || !ctx || ctx.type !== 'series' || upShown || stillOpen || failed || !started) { hideSkip(); return; }
    const t = video.currentTime;
    if (t >= introRange.from - 5 && t < introRange.to - 5) { if (!skipShown) showSkip(); }
    else hideSkip();
  }

  // ---------- reliability ----------
  function watchStall() {
    const now = Date.now();
    if (!started || failed || stillOpen || !wantPlay || video.paused || scrub) { lastMoveTs = now; lastTime = video.currentTime; return; }
    const t = video.currentTime;
    if (Math.abs(t - lastTime) > 0.05) {
      lastTime = t;
      lastMoveTs = now;
      if (reconnects && now - lastReconnect > 60000) reconnects = 0;
      return;
    }
    if (now - lastMoveTs > STALL_MS) reconnect();
  }

  // a stream that started and then froze is reopened quietly, a few times
  function reconnect() {
    lastMoveTs = Date.now();
    if (!info) return;
    if (reconnects >= RECONNECT_MAX) { triedJs = true; triedNative = true; alts = []; fail(); return; }
    reconnects++;
    lastReconnect = Date.now();
    const at = isLive() ? 0 : video.currentTime;
    restart(at);
    setMsg('Reconnecting…');
  }

  // open the current item again from the start of the engine list
  function restart(seekTo) {
    triedJs = false; triedNative = false; engine = '';
    alts = altsOf(info);
    seekOnLoad = seekTo > 0 ? seekTo : 0;
    seekTries = 0;
    start(info.url);
  }

  // ---------- playback ----------
  function teardown() {
    clearTimeout(stallTimer);
    if (hls) { hls.destroy(); hls = null; }
  }

  function releaseVideo() {
    if (!video.paused) ignorePauseUntil = Date.now() + 250; // the pause below is not the viewer's
    video.pause();
    video.autoplay = false;
    while (video.firstChild) video.removeChild(video.firstChild);
    video.removeAttribute('src');
    // Do not call load() here. A load that finishes after the next source is
    // attached leaves the TV player idle, with no error and no picture.
  }

  // webOS starts HLS only from a <source> whose type is the playlist MIME.
  // Assigning video.src leaves the pipeline idle: no error and no picture.
  function playSource(url) {
    let mime = '';
    if (/\.m3u8(\?|$)/i.test(url)) mime = 'application/vnd.apple.mpegurl';
    else if (/\.ts(\?|$)/i.test(url)) mime = 'video/mp2t';
    else if (/\.(mp4|m4v)(\?|$)/i.test(url)) mime = 'video/mp4';
    const source = document.createElement('source');
    source.src = url;
    if (mime) source.type = mime;
    video.autoplay = true;
    video.appendChild(source);
    video.load();
    safePlay();
  }

  function firstLine(body) {
    return String(body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  function noteResponse(status, body) {
    status = status | 0;
    if (status < 100) return;
    httpStatus = status;
    const line = firstLine(body);
    if (line) httpNote = line;
  }

  // hls.js puts the playlist response on the fatal error. Read it before destroy().
  function noteHlsError(data) {
    const xhr = data && data.networkDetails;
    const resp = data && data.response;
    const code = (resp && resp.code) || (xhr && xhr.status);
    let body = '';
    try { if (xhr && xhr.responseText) body = xhr.responseText; } catch (e) {}
    if (!body && resp && resp.text) body = resp.text;
    noteResponse(code, body);
  }

  function maybeRetry(url, status) {
    // 409 is a refusal (often the User-Agent). Retrying it just hits the provider again.
    // 429, 458 and 509 are the limit responses, and those can clear on their own.
    if ((status !== 429 && status !== 458 && status !== 509) || busyRetries >= BUSY_RETRY_MAX) return '';
    busyRetries++;
    clearTimeout(busyTimer);
    busyTimer = setTimeout(() => { if (info && failed && !hidden()) restart(0); }, BUSY_RETRY_MS);
    return ' Retrying automatically (' + busyRetries + ' of ' + BUSY_RETRY_MAX + '). Press OK to retry now.';
  }

  function failureText(status, note) {
    const head = 'HTTP ' + status + (note ? ': ' + note : '');
    const again = ' Press OK to try again.';
    if (status === 429 || status === 458 || status === 509) return head + '. The provider is limiting connections.' + again;
    if (status === 401 || status === 403) return head + '. Check the username, password and subscription.';
    if (status === 404 || status === 410) return head + '. The provider no longer has this stream.';
    if (status >= 500) return head + '. The provider server has a problem.';
    if (status >= 200 && status < 300) return 'The provider answered, but this TV cannot decode this stream format.';
    if (status === 409) {
      var via = startUrl.indexOf('127.0.0.1') >= 0;
      var why = via ? '. The on-TV player was refused too.' : '. The on-TV player did not start, so this is still the browser.';
      if (!via && window.API && API.proxyError) why += ' (' + API.proxyError + ')';
      return head + why + again;
    }
    if (status) return head + '.' + again;
    return '';
  }

  // what the viewer reads when nothing worked
  function failureMessage(text) {
    if (isCatchup()) return 'This replay cannot be played. ' + (text || '') + ' Press Back to return to live.';
    return text || 'Cannot play this stream';
  }

  function fail() {
    const original = curSource || (info && info.url) || startUrl;
    if (engine === 'js' && !triedNative) { start(original, 'native'); return; }
    if (engine === 'native' && !triedJs && window.Hls && window.MediaSource) { start(original, 'js'); return; }
    if (alts.length) { // try the next format or link once
      const a = alts.shift();
      triedJs = false; triedNative = false; engine = '';
      start(a);
      return;
    }
    spinner.classList.add('hidden');
    failed = true;
    const failedUrl = startUrl || (info && info.url);
    teardown();
    releaseVideo(); // let go of the connection before any diagnostic request
    showOverlay(B.play);
    if (failedUrl) explainFailure(failedUrl);
    else setMsg(failureMessage(''));
  }

  // Use the status from the play request. Fetch only when the native player hid it,
  // and only after that player has released the URL.
  function explainFailure(url) {
    const token = playToken;
    const stale = () => token !== playToken || !failed;
    if (httpStatus) {
      const why = failureText(httpStatus, httpNote) + maybeRetry(url, httpStatus);
      setMsg(failureMessage(why));
      return;
    }
    if (!window.fetch) { setMsg(failureMessage('')); return; }
    const ctl = window.AbortController ? new AbortController() : null;
    // plain GET on purpose: extra request headers would trigger a CORS preflight the provider refuses
    fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(r => {
      if (stale()) { if (ctl) ctl.abort(); return null; }
      const type = (r.headers && r.headers.get('content-type')) || '';
      // a real playlist or video is not an explanation; do not download it
      if (r.status < 400 || /mpegurl|video|audio|mp2t/i.test(type)) {
        if (ctl) ctl.abort();
        return { status: r.status, text: '' };
      }
      return r.text().then(t => ({ status: r.status, text: String(t).slice(0, 500) })).catch(() => ({ status: r.status, text: '' }));
    }).then(res => {
      if (!res || stale()) return;
      noteResponse(res.status, res.text);
      const why = failureText(res.status, firstLine(res.text)) + maybeRetry(url, res.status);
      setMsg(failureMessage(why));
    }).catch(() => {
      if (!stale()) setMsg(failureMessage('This stream is not available right now.'));
    });
  }

  function start(url, mode) {
    const token = ++playToken;
    curSource = url;
    // From here until the new stream plays, the video element still holds the old stream's
    // time and length. They must not be saved or watched as if they belonged to the new item.
    started = false;
    // drop the previous connection while the local player proxy answers
    teardown();
    releaseVideo();
    setMsg('Opening…');
    spinner.classList.remove('hidden');
    // The TV's own player reads the LAN address. The page player reads loopback.
    if (!mode) mode = 'native';
    const lan = mode !== 'js';
    const run = (playUrl) => { if (token === playToken) startNow(playUrl, mode); };
    if (window.API && API.proxyUrl) API.proxyUrl(url, lan).then(run, () => run(url));
    else run(url);
  }

  function startHls(url) {
    engine = 'js';
    triedJs = true;
    setMsg('Opening…');
    hls = new Hls({
      enableWorker: false,
      lowLatencyMode: false,
      manifestLoadingTimeOut: 20000,
      fragLoadingTimeOut: 20000,
      xhrSetup: (xhr) => {
        xhr.addEventListener('loadend', () => {
          let body = '';
          try { if (xhr.status >= 400) body = xhr.responseText || ''; } catch (e) {}
          noteResponse(xhr.status, body);
        });
      }
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => { safePlay(); });
    if (Hls.Events.AUDIO_TRACKS_UPDATED) hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, applyLangPrefs);
    if (Hls.Events.SUBTITLE_TRACKS_UPDATED) hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, applyLangPrefs);
    hls.on(Hls.Events.ERROR, (ev, data) => {
      if (!data || !data.fatal) return;
      noteHlsError(data);
      if (!started) { fail(); return; }  // never got going: go straight to the fallback
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retries < 2) {
        retries++;
        setMsg('Reconnecting…');
        hls.startLoad();
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && retries < 2) {
        retries++;
        hls.recoverMediaError();
      } else {
        fail();
      }
    });
    video.autoplay = true;
    hls.loadSource(url);
    hls.attachMedia(video);
  }

  function startNow(url, mode) {
    startUrl = url;
    retries = 0;
    started = false;
    failed = false;
    httpStatus = 0;
    httpNote = '';
    wantPlay = true;
    lastTime = -1;
    lastMoveTs = Date.now();
    clearTimeout(busyTimer);
    teardown();
    // drop the old stream first: providers count open connections, and a lingering one blocks the next
    releaseVideo();
    spinner.classList.remove('hidden');
    // a live channel starts in seconds; a movie file can take a provider much longer to open
    stallTimer = setTimeout(() => { if (!started) fail(); }, isCatchup() ? 15000 : isLive() ? 8000 : 20000);
    const isHls = /\.m3u8(\?|$)/i.test(url);
    const jsOk = !!(window.Hls && window.MediaSource);
    // hls.js reports "playing" on this TV while the picture stays black.
    // The TV player is the one that can put a picture on screen.
    if (mode === 'js' && isHls && jsOk) {
      try { startHls(url); return; } catch (e) { teardown(); }
    }
    if (mode === 'js') triedJs = true;
    engine = 'native';
    triedNative = true;
    setMsg('');
    playSource(url);
  }

  function startCurrent() {
    const item = ctx.items[ctx.index];
    info = ctx.resolve(item);
    alts = altsOf(info);
    upShown = false; upDismissed = false; resumeDone = false; scrub = null; busyRetries = 0;
    finishedHandled = false; resumedFrom = 0; langApplied = false; langTries = 0;
    reconnects = 0; seekOnLoad = 0; seekTries = 0; pausedAt = 0;
    epg = []; epgLoadedAt = 0;
    triedJs = false; triedNative = false; engine = '';
    hideUpNext();
    hideSkip();
    hidePauseCard();
    hideBanner();
    closeDrawer(true);
    $('player-title').textContent = info.title || '';
    $('player-title').dir = 'auto';
    $('player-sub').textContent = info.subtitle || '';
    video.playbackRate = 1;
    applyMode();
    refreshFav();
    updatePlayIcon();
    applyPicture();
    loadIntro();
    if (ctx.onPlay) { try { ctx.onPlay(item); } catch (e) {} }
    if (isLive()) loadEpg();
    start(info.url);
  }

  function play(newCtx) {
    if (hidden()) returnFocus = document.activeElement;
    saveProgress();
    ctx = newCtx;
    savedLive = null; prevItem = null; zapIdx = -1; autoChain = 0; lastAdvance = 0;
    hideStill();
    UI.showScreen('player');
    startCurrent();
    lastRowBtn = null;
    showOverlay(B.play);
  }

  function playIndex(i, auto) {
    if (!ctx || i < 0 || i >= ctx.items.length) return;
    clearTimeout(zapTimer);
    zapIdx = -1;
    if (i === ctx.index && !failed && !auto) return;
    saveProgress();
    if (ctx.type === 'live') prevItem = ctx.items[ctx.index];
    hideStill();
    ctx.index = i;
    startCurrent();
    if (ctx.type === 'live') showBanner();
    else if (!auto) showOverlay(B.play);
  }

  function stop() {
    clearTimeout(busyTimer);
    clearTimeout(hideTimer);
    clearTimeout(toastTimer);
    clearTimeout(zapTimer);
    clearTimeout(numTimer);
    clearTimeout(bannerTimer);
    clearTimeout(pauseCardTimer);
    playToken++; // a start() whose proxy lookup is still in flight must not open after Back
    wantPlay = false;
    if (!video.paused) ignorePauseUntil = Date.now() + 250;
    video.pause();
    teardown();
    video.removeAttribute('src');
    while (video.firstChild) video.removeChild(video.firstChild);
    video.load();
    setMsg('');
    spinner.classList.add('hidden');
    toastEl.classList.add('hidden');
    numBuf = '';
    chnumEl.classList.add('hidden');
    hideBanner();
    hidePauseCard();
    hideUpNext();
    hideSkip();
    hideStill();
    hideSleepCard();
    closeDrawer(true);
  }

  function back() {
    saveProgress();
    stop();
    ctx = null; info = null; savedLive = null; epg = [];
    sleepAt = 0; sleepEnd = false;
    updateSleepLabel();
    UI.showScreen('home');
    if (returnFocus && document.body.contains(returnFocus) && returnFocus.offsetParent !== null) returnFocus.focus();
    returnFocus = null;
    if (window.App && App.onPlayerClosed) App.onPlayerClosed();
  }

  // ---------- live: channel keys, numbers, guide ----------
  function channelNumber(it, idx) {
    return it && it.num !== undefined && it.num !== null && it.num !== '' ? String(it.num) : String(idx + 1);
  }

  function showBanner(idx) {
    if (!ctx || ctx.type !== 'live' || overlayVisible()) return;
    const i = idx === undefined ? ctx.index : idx;
    const it = ctx.items[i];
    if (!it) return;
    const r = ctx.resolve(it);
    bnTop.textContent = channelNumber(it, i) + '   ' + (r.title || '');
    bnTop.dir = 'auto';
    bnNow.textContent = '';
    bnNext.textContent = '';
    bannerEl.classList.remove('hidden');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(hideBanner, 4000);
    const sid = r.live && r.live.streamId;
    bannerKey = String(sid || '');
    if (!sid) return;
    const key = bannerKey;
    API.getShortEpg(sid).then(list => {
      if (key !== bannerKey || bannerEl.classList.contains('hidden')) return;
      const now = list[0], next = list[1];
      if (now) bnNow.textContent = 'Now  ' + now.title + '  (' + hhmm(now.start) + '–' + hhmm(now.end) + ')';
      if (next) bnNext.textContent = 'Next  ' + hhmm(next.start) + '  ' + next.title;
    });
  }

  function hideBanner() {
    clearTimeout(bannerTimer);
    bannerKey = '';
    bannerEl.classList.add('hidden');
  }

  // channel up / down: the name changes at once, the stream opens when the keys stop
  function zapPreview(i) {
    zapIdx = i;
    const r = ctx.resolve(ctx.items[i]);
    $('player-title').textContent = r.title || '';
    $('player-sub').textContent = '';
    showBanner(i);
    clearTimeout(zapTimer);
    zapTimer = setTimeout(() => {
      const t = zapIdx;
      zapIdx = -1;
      if (ctx && t >= 0) playIndex(t);
    }, ZAP_DELAY);
  }

  function zap(dir) { // channel up/down for live, next/previous episode for series
    if (!ctx || ctx.items.length < 2) return;
    cancelNumber(); // a half-typed channel number is abandoned when zapping
    if (ctx.type === 'live') {
      const n = ctx.items.length;
      const base = zapIdx >= 0 ? zapIdx : ctx.index;
      zapPreview((base + dir + n) % n);
    } else if (ctx.type === 'series') {
      playIndex(ctx.index + dir);
    }
  }

  function lastChannel() {
    if (!isLive() || !prevItem) { toast('No previous channel'); return; }
    cancelNumber();
    let i = -1;
    ctx.items.forEach((it, k) => { if (sameChannel(it, prevItem)) i = k; });
    if (i < 0) { toast('No previous channel'); return; }
    playIndex(i);
  }

  function typeDigit(d) {
    if (numBuf.length >= 5) return;
    numBuf += String(d);
    chnumEl.textContent = numBuf;
    chnumEl.classList.remove('hidden');
    clearTimeout(numTimer);
    numTimer = setTimeout(commitNumber, NUMBER_DELAY);
  }

  function cancelNumber() {
    clearTimeout(numTimer);
    numBuf = '';
    chnumEl.classList.add('hidden');
  }

  function findByNumber(items, num) {
    let hasNums = false;
    for (let i = 0; i < items.length; i++) {
      const v = items[i].num;
      if (v !== undefined && v !== null && v !== '') { hasNums = true; break; }
    }
    if (hasNums) {
      for (let i = 0; i < items.length; i++) if (Number(items[i].num) === num) return i;
      return -1;
    }
    return num >= 1 && num <= items.length ? num - 1 : -1;
  }

  function commitNumber() {
    clearTimeout(numTimer);
    const n = numBuf;
    numBuf = '';
    chnumEl.classList.add('hidden');
    if (!n || !isLive()) return;
    const num = parseInt(n, 10);
    API.getAll('live').then(all => {
      if (!isLive()) return;
      const j = findByNumber(all, num);
      if (j < 0) { toast('No channel ' + num); return; }
      const target = all[j];
      let i = -1;
      ctx.items.forEach((it, k) => { if (sameChannel(it, target)) i = k; });
      if (i < 0) { ctx.items = all; i = j; applyMode(); } // outside this list: switch to all channels
      playIndex(i);
    }).catch(() => toast('No channel ' + num));
  }

  function loadEpg() {
    if (!isLive() || !info || !info.live || !info.live.streamId) { epg = []; renderProgramme(); return Promise.resolve([]); }
    const mine = info;
    epgLoadedAt = Date.now();
    return API.getShortEpg(info.live.streamId).then(list => {
      if (info !== mine) return list;
      epg = list.filter(e => e.end > Date.now());
      refreshSub();
      renderProgramme();
      return epg;
    });
  }

  // the live bar shows how far the programme on now has run
  function renderProgramme() {
    if (!isLive()) return;
    const cur = epg[0];
    if (!cur || cur.start > Date.now() + 60000) {
      seekbar.classList.remove('epg');
      tElapsed.textContent = '';
      tRemain.textContent = 'LIVE';
      return;
    }
    seekbar.classList.add('epg');
    sbPlayed.style.width = clamp((Date.now() - cur.start) / (cur.end - cur.start), 0, 1) * 100 + '%';
    tElapsed.textContent = hhmm(cur.start);
    tRemain.textContent = hhmm(cur.end);
  }

  function tickEpg() {
    if (epg[0] && Date.now() > epg[0].end && Date.now() - epgLoadedAt > 20000) loadEpg();
    if (overlayVisible()) renderProgramme();
  }

  // ---------- replay (catch-up) ----------
  function playCatchup(prog) {
    const base = isLive() ? { ctx: ctx, index: ctx.index } : savedLive;
    if (!base) return;
    const chItem = base.ctx.items[base.index];
    const urls = API.catchupUrls(chItem, prog);
    if (!urls) { toast('Replay is not available here'); return; }
    const chInfo = base.ctx.resolve(chItem);
    savedLive = base;
    clearTimeout(zapTimer);
    zapIdx = -1;
    saveProgress();
    ctx = {
      type: 'catchup', kind: 'catchup', items: [prog], index: 0,
      resolve: () => ({
        url: urls[0], alt: urls.slice(1), title: chInfo.title,
        subtitle: hhmm(prog.start) + '–' + hhmm(prog.end) + '  ' + prog.title, icon: chInfo.icon, fav: null
      })
    };
    closeDrawer(true);
    startCurrent();
    showOverlay(B.play);
  }

  function backToLive() {
    if (!savedLive) { back(); return; }
    const b = savedLive;
    savedLive = null;
    ctx = b.ctx;
    ctx.index = b.index;
    startCurrent();
    showBanner();
  }

  // play the programme on now from its beginning
  function catchupStartOver() {
    const go = (list) => {
      const now = list[0];
      if (!now) { toast('No programme information for this channel'); return; }
      playCatchup({ title: now.title, desc: now.desc, start: now.start, end: now.end, startStr: now.startStr, archive: true });
    };
    if (epg.length) go(epg); else loadEpg().then(go, () => toast('No programme information for this channel'));
  }

  function startOver() {
    if (isLive()) { if (hasArchive()) catchupStartOver(); return; }
    video.currentTime = 0;
    resumedFrom = 0;
    updateStartBtn();
    toast('Starting over');
    showOverlay(B.play);
  }

  // ---------- pause card ----------
  function schedulePauseCard() {
    clearTimeout(pauseCardTimer);
    pauseCardTimer = setTimeout(showPauseCard, PAUSE_CARD_MS);
  }

  function showPauseCard() {
    if (!ctx || !info || !video.paused || video.ended || hidden() || failed || drawerOpen() || scrub || stillOpen || sleepWarnShown) return;
    pcTitle.textContent = info.title || '';
    pcTitle.dir = 'auto';
    pcMeta.textContent = info.subtitle || '';
    pcPlot.textContent = '';
    if (isLive()) {
      if (epg[0]) { pcMeta.textContent = hhmm(epg[0].start) + '–' + hhmm(epg[0].end) + '  ' + epg[0].title; pcPlot.textContent = epg[0].desc || ''; }
    } else if (ctx.details) {
      const mine = info;
      ctx.details(ctx.items[ctx.index]).then(d => {
        if (info !== mine || !pauseCardShown || !d) return;
        if (d.meta) pcMeta.textContent = d.meta;
        pcPlot.textContent = d.plot || '';
      }, () => {});
    }
    forceHideOverlay();
    miniEl.classList.add('hide');
    pauseCard.classList.remove('hidden');
    pauseCardShown = true;
  }

  function hidePauseCard() {
    clearTimeout(pauseCardTimer);
    if (!pauseCardShown) return;
    pauseCardShown = false;
    pauseCard.classList.add('hidden');
  }

  // ---------- sleep timer ----------
  function updateSleepLabel() {
    const l = B.sleep.querySelector('.plabel');
    if (sleepEnd) l.textContent = 'Sleep: at the end';
    else if (sleepAt) l.textContent = 'Sleep ' + Math.max(1, Math.ceil((sleepAt - Date.now()) / 60000)) + 'm';
    else l.textContent = 'Sleep timer';
  }

  function setSleep(min) {
    sleepAt = Date.now() + min * 60000;
    sleepEnd = false;
    sleepWarnShown = false;
    updateSleepLabel();
    toast('Sleep timer: ' + min + ' minutes');
  }

  function hideSleepCard() {
    sleepWarnShown = false;
    sleepEl.classList.add('hidden');
  }

  function cancelSleep() {
    sleepAt = 0;
    sleepEnd = false;
    hideSleepCard();
    updateSleepLabel();
  }

  function sleepDone() {
    sleepAt = 0;
    sleepEnd = false;
    hideSleepCard();
    back();
  }

  function tickSleep() {
    if (!sleepAt) return;
    const left = sleepAt - Date.now();
    if (left <= 0) { sleepDone(); return; }
    updateSleepLabel();
    if (left <= 60000) {
      if (!sleepWarnShown) {
        sleepWarnShown = true;
        hidePauseCard();
        sleepEl.classList.remove('hidden');
        sleepKeep.focus();
      }
      sleepSub.textContent = 'Stopping in ' + Math.ceil(left / 1000) + ' seconds. Press any key to keep watching.';
    }
  }

  // ---------- audio and subtitle languages ----------
  function audioOptions() {
    if (hls && hls.audioTracks && hls.audioTracks.length > 1) {
      return hls.audioTracks.map((t, i) => ({
        key: String(t.lang || t.name || '').toLowerCase(),
        label: t.name || t.lang || 'Audio ' + (i + 1), on: hls.audioTrack === i, set: () => { hls.audioTrack = i; }
      }));
    }
    const at = video.audioTracks;
    if (at && at.length > 1) {
      const out = [];
      for (let i = 0; i < at.length; i++) {
        out.push({
          key: String(at[i].language || at[i].label || '').toLowerCase(),
          label: at[i].label || at[i].language || 'Audio ' + (i + 1), on: at[i].enabled,
          set: () => { for (let j = 0; j < at.length; j++) at[j].enabled = j === i; }
        });
      }
      return out;
    }
    return [];
  }

  function subtitleOptions() {
    if (hls && hls.subtitleTracks && hls.subtitleTracks.length) {
      const out = [{ key: 'off', label: 'Off', on: hls.subtitleTrack < 0 || hls.subtitleDisplay === false, set: () => { hls.subtitleTrack = -1; hls.subtitleDisplay = false; } }];
      hls.subtitleTracks.forEach((t, i) => out.push({
        key: String(t.lang || t.name || '').toLowerCase(),
        label: t.name || t.lang || 'Subtitles ' + (i + 1),
        on: hls.subtitleTrack === i && hls.subtitleDisplay !== false,
        set: () => { hls.subtitleTrack = i; hls.subtitleDisplay = true; }
      }));
      return out;
    }
    const tt = [];
    for (let i = 0; i < video.textTracks.length; i++) {
      const t = video.textTracks[i];
      if (t.kind === 'subtitles' || t.kind === 'captions') tt.push(t);
    }
    if (!tt.length) return [];
    const out = [{ key: 'off', label: 'Off', on: tt.every(t => t.mode !== 'showing'), set: () => { tt.forEach(t => { t.mode = 'disabled'; }); } }];
    tt.forEach((t, i) => out.push({
      key: String(t.language || t.label || '').toLowerCase(),
      label: t.label || t.language || 'Subtitles ' + (i + 1), on: t.mode === 'showing',
      set: () => { tt.forEach((x, j) => { x.mode = j === i ? 'showing' : 'disabled'; }); }
    }));
    return out;
  }

  // the next episode or film starts with the languages the viewer chose last time
  function applyLangPrefs() {
    if (langApplied || !ctx || ++langTries > 12) return;
    const wantA = API.pref('audioLang'), wantS = API.pref('subLang');
    if (!wantA && !wantS) { langApplied = true; return; }
    const audio = audioOptions(), subs = subtitleOptions();
    if (!audio.length && !subs.length) return; // tracks are not listed yet; try again on the next event
    langApplied = true;
    const pickBy = (list, key) => { for (let i = 0; i < list.length; i++) if (list[i].key === key) return list[i]; return null; };
    if (wantA) { const o = pickBy(audio, wantA); if (o && !o.on) o.set(); }
    if (wantS) { const o = pickBy(subs, wantS); if (o && !o.on) o.set(); }
  }

  // ---------- side drawer ----------
  function dItem(o) {
    const b = document.createElement('button');
    b.className = 'd-item' + (o.now ? ' now' : '');
    if (o.thumb !== undefined) {
      const t = document.createElement('div');
      t.className = 'd-thumb';
      const src = UI.safeUrl(o.thumb);
      if (src) t.style.backgroundImage = 'url(' + JSON.stringify(src) + ')';
      if (o.pct > 0) {
        const bar = document.createElement('div');
        bar.className = 'prog';
        const fill = document.createElement('i');
        fill.style.width = Math.round(Math.min(1, o.pct) * 100) + '%';
        bar.appendChild(fill);
        t.appendChild(bar);
      }
      b.appendChild(t);
    }
    if (o.num !== undefined) {
      const c = document.createElement('span');
      c.className = 'd-num';
      c.textContent = o.num;
      b.appendChild(c);
    }
    if (o.time !== undefined) {
      const c = document.createElement('span');
      c.className = 'd-time';
      c.textContent = o.time;
      b.appendChild(c);
    }
    if (o.check !== undefined) {
      const c = document.createElement('span');
      c.className = 'd-check';
      c.textContent = o.check ? '✓' : '';
      b.appendChild(c);
    }
    const n = document.createElement('span');
    n.className = 'd-name';
    n.textContent = o.name;
    n.dir = 'auto';
    if (o.sub) {
      const s = document.createElement('span');
      s.className = 'd-sub';
      s.textContent = o.sub;
      n.appendChild(s);
    }
    b.appendChild(n);
    b.addEventListener('click', o.onClick);
    return b;
  }

  function dTitle(text) {
    const d = document.createElement('div');
    d.className = 'd-title';
    d.textContent = text;
    return d;
  }

  const pctFor = (url) => { const p = API.getProgress(url); return p && p.d ? p.t / p.d : 0; };

  function openDrawer(builder, opener) {
    drawerOpener = opener;
    clearTimeout(hideTimer);
    hidePauseCard();
    drawerBody.innerHTML = '';
    const focusEl = builder();
    drawerEl.classList.remove('hide');
    if (focusEl) focusEl.focus();
  }

  function closeDrawer(silent) {
    if (!drawerOpen()) return;
    drawerEl.classList.add('hide');
    if (!silent) showOverlay(drawerOpener && drawerOpener.offsetParent !== null ? drawerOpener : B.play);
  }

  function buildEpisodes() {
    const cur = ctx.items[ctx.index];
    const seasons = [];
    ctx.items.forEach(it => { if (seasons.indexOf(it.season) < 0) seasons.push(it.season); });
    let season = cur.season;
    drawerBody.appendChild(dTitle(cur.seriesName || 'Episodes'));
    const chips = document.createElement('div');
    chips.className = 'd-chips';
    const list = document.createElement('div');
    drawerBody.appendChild(chips);
    drawerBody.appendChild(list);
    let nowBtn = null;
    function render() {
      chips.innerHTML = '';
      seasons.forEach(sn => {
        const c = document.createElement('button');
        c.className = 'd-chip' + (sn === season ? ' on' : '');
        c.textContent = 'Season ' + sn;
        c.addEventListener('click', () => { season = sn; render(); const f = list.querySelector('.d-item'); if (f) f.focus(); });
        chips.appendChild(c);
      });
      list.innerHTML = '';
      nowBtn = null;
      ctx.items.forEach((it, i) => {
        if (it.season !== season) return;
        const b = dItem({
          thumb: it.icon, name: it.name, sub: i === ctx.index ? 'Now playing' : '', now: i === ctx.index, pct: pctFor(it.url),
          onClick: () => { closeDrawer(true); playIndex(i); }
        });
        if (i === ctx.index) nowBtn = b;
        list.appendChild(b);
      });
    }
    render();
    return nowBtn || list.querySelector('.d-item');
  }

  // Thousands of channels would freeze the drawer, so it draws a window around the current one.
  function buildChannels() {
    drawerBody.appendChild(dTitle('Channels'));
    const list = document.createElement('div');
    drawerBody.appendChild(list);
    const n = ctx.items.length;
    let from = Math.max(0, ctx.index - 150), to = Math.min(n, ctx.index + 150);
    const btnAt = {};
    function more(label, onClick) {
      return dItem({ name: label, onClick });
    }
    function render() {
      list.innerHTML = '';
      if (from > 0) list.appendChild(more('Earlier channels…', () => { const old = from; from = Math.max(0, from - 300); render(); if (btnAt[old - 1]) btnAt[old - 1].focus(); }));
      for (let i = from; i < to; i++) {
        const it = ctx.items[i];
        const r = ctx.resolve(it);
        const idx = i;
        const b = dItem({
          thumb: r.icon || '', num: channelNumber(it, i), name: r.title, now: i === ctx.index, sub: i === ctx.index ? 'Now playing' : '',
          onClick: () => { closeDrawer(true); playIndex(idx); }
        });
        btnAt[i] = b;
        list.appendChild(b);
      }
      if (to < n) list.appendChild(more('More channels…', () => { const old = to; to = Math.min(n, to + 300); render(); if (btnAt[old]) btnAt[old].focus(); }));
    }
    render();
    return btnAt[ctx.index] || list.querySelector('.d-item');
  }

  function dayLabel(ms) {
    const d = new Date(ms), t = new Date();
    const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(d, t)) return 'Today';
    if (same(d, new Date(t.getTime() - 86400000))) return 'Yesterday';
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }

  // programmes the provider kept, newest first, grouped by day
  function buildGuide() {
    drawerBody.appendChild(dTitle('Replay guide'));
    const status = document.createElement('div');
    status.className = 'd-empty';
    status.textContent = 'Loading…';
    drawerBody.appendChild(status);
    const mine = info;
    API.getArchiveGuide(info.live.streamId).then(list => {
      if (info !== mine || !drawerOpen() || drawerOpener !== B.guide) return;
      const now = Date.now();
      const flagged = list.some(e => e.archive);
      const rows = list.filter(e => e.start <= now && (e.now || !flagged || e.archive)).sort((a, b) => b.start - a.start).slice(0, 120);
      if (!rows.length) { status.textContent = 'No replays are listed for this channel.'; return; }
      drawerBody.removeChild(status);
      let day = '', first = null, nowBtn = null;
      rows.forEach(e => {
        const label = dayLabel(e.start);
        if (label !== day) {
          day = label;
          const h = document.createElement('div');
          h.className = 'd-day';
          h.textContent = label;
          drawerBody.appendChild(h);
        }
        const isNow = e.start <= now && e.end > now;
        const b = dItem({
          time: hhmm(e.start), name: e.title, sub: isNow ? 'On now · plays from the start' : '',
          onClick: () => playCatchup(e)
        });
        if (!first) first = b;
        if (isNow) nowBtn = b;
        drawerBody.appendChild(b);
      });
      (nowBtn || first).focus();
    });
    return null;
  }

  function buildTracks(focusKey) {
    drawerBody.innerHTML = '';
    drawerBody.appendChild(dTitle('Audio & Subtitles'));
    const audio = audioOptions(), subs = subtitleOptions();
    if (!audio.length && !subs.length) {
      const e = document.createElement('div');
      e.className = 'd-empty';
      e.textContent = 'This stream has no alternate audio or subtitles.';
      drawerBody.appendChild(e);
      return null;
    }
    const cols = document.createElement('div');
    cols.className = 'd-cols';
    drawerBody.appendChild(cols);
    let focusEl = null;
    [['Audio', audio, 'audioLang'], ['Subtitles', subs, 'subLang']].forEach(trio => {
      const col = document.createElement('div');
      col.className = 'd-col';
      const h = document.createElement('h4');
      h.textContent = trio[0];
      col.appendChild(h);
      if (!trio[1].length) {
        const e = document.createElement('div');
        e.className = 'd-empty';
        e.textContent = 'None';
        col.appendChild(e);
      }
      trio[1].forEach((o, i) => {
        const key = trio[0] + i;
        const b = dItem({ name: o.label, check: o.on, onClick: () => { o.set(); API.pref(trio[2], o.key); buildTracks(key); } });
        b.dataset.key = key;
        if (key === focusKey || (!focusEl && o.on && !focusKey)) focusEl = b;
        col.appendChild(b);
      });
      cols.appendChild(col);
    });
    if (subs.length) {
      const sect = document.createElement('div');
      sect.className = 'd-sect';
      sect.textContent = 'Subtitle style';
      drawerBody.appendChild(sect);
      const chips = document.createElement('div');
      chips.className = 'd-chips';
      drawerBody.appendChild(chips);
      const st = API.pref('subStyle') || { size: '', bg: false };
      const save = (o, key) => { API.pref('subStyle', o); applySubStyle(); buildTracks(key); };
      const chip = (text, on, key, onClick) => {
        const c = document.createElement('button');
        c.className = 'd-chip' + (on ? ' on' : '');
        c.textContent = text;
        c.dataset.key = key;
        c.addEventListener('click', onClick);
        chips.appendChild(c);
        if (key === focusKey) focusEl = c;
      };
      SUB_SIZES.forEach(s => chip(s.name, st.size === s.id, 'size' + s.id, () => save({ size: s.id, bg: st.size ? st.bg : true }, 'size' + s.id)));
      chip('Dark background', !!st.bg, 'bg', () => save({ size: st.size || 'm', bg: !st.bg }, 'bg'));
      const hint = document.createElement('div');
      hint.className = 'd-hint';
      hint.textContent = 'Size applies to subtitles the app can style.';
      drawerBody.appendChild(hint);
    }
    focusEl = focusEl || drawerBody.querySelector('.d-item');
    if (focusKey && focusEl) focusEl.focus();
    return focusEl;
  }

  function buildSpeed() {
    drawerBody.innerHTML = '';
    drawerBody.appendChild(dTitle('Playback speed'));
    let cur = null;
    SPEEDS.forEach(s => {
      const on = video.playbackRate === s;
      const b = dItem({
        name: s === 1 ? 'Normal' : s + 'x', check: on,
        onClick: () => { video.playbackRate = s; B.speed.querySelector('.plabel').textContent = s === 1 ? 'Speed' : 'Speed ' + s + 'x'; buildSpeed(); const nb = drawerBody.querySelectorAll('.d-item')[SPEEDS.indexOf(s)]; if (nb) nb.focus(); }
      });
      if (on) cur = b;
      drawerBody.appendChild(b);
    });
    return cur;
  }

  function buildPicture() {
    drawerBody.innerHTML = '';
    drawerBody.appendChild(dTitle('Picture size'));
    let cur = null;
    PICTURES.forEach((p, i) => {
      const b = dItem({
        name: p.name, sub: p.note, check: p.id === pictureId,
        onClick: () => { setPicture(p.id); buildPicture(); const nb = drawerBody.querySelectorAll('.d-item')[i]; if (nb) nb.focus(); }
      });
      if (p.id === pictureId) cur = b;
      drawerBody.appendChild(b);
    });
    const hint = document.createElement('div');
    hint.className = 'd-hint';
    hint.textContent = 'Blue key changes the size too. If nothing changes, this TV player ignores that size.';
    drawerBody.appendChild(hint);
    return cur;
  }

  function buildSleep() {
    drawerBody.innerHTML = '';
    drawerBody.appendChild(dTitle('Sleep timer'));
    const opts = [{ label: 'Off', on: !sleepAt && !sleepEnd, set: () => { cancelSleep(); toast('Sleep timer off'); } }];
    [30, 60, 90, 120].forEach(m => opts.push({ label: m + ' minutes', on: false, set: () => setSleep(m) }));
    if (!isLive()) {
      opts.push({
        label: ctx && ctx.type === 'series' ? 'End of this episode' : 'End of this film', on: sleepEnd,
        set: () => { sleepEnd = true; sleepAt = 0; sleepWarnShown = false; updateSleepLabel(); toast('Stops at the end'); }
      });
    }
    let cur = null;
    opts.forEach(o => {
      const b = dItem({ name: o.label, check: o.on, onClick: () => { o.set(); closeDrawer(); } });
      if (o.on) cur = b;
      drawerBody.appendChild(b);
    });
    return cur || drawerBody.querySelector('.d-item');
  }

  function toggleTracks() {
    if (drawerOpen() && drawerOpener === B.tracks) closeDrawer();
    else openDrawer(() => buildTracks(null), B.tracks);
  }

  // ---------- keys ----------
  function onEnter() {
    const a = document.activeElement;
    if (a === upNextBtn || a === upCreditsBtn || a === skipBtn) { a.click(); return; }
    if (!overlayVisible()) {
      showOverlay(B.play); // first OK opens the controls; it does not pause
      return;
    }
    if (a === seekbar) {
      if (scrub) commitScrub(); else togglePlay();
      armHide();
      return;
    }
    if (a && a.tagName === 'BUTTON') { a.click(); armHide(); return; }
    togglePlay();
  }

  // Explicit D-pad rules for the controls (generic spatial nav treats the wide seek bar as "to the right").
  function moveInOverlay(dir) {
    const a = document.activeElement;
    const row = Array.from(overlayEl.querySelectorAll('.btn-row .pbtn')).filter(b => !b.classList.contains('hidden'));
    const idx = row.indexOf(a);
    const card = upShown ? upNextBtn : (skipShown ? skipBtn : null);
    if (idx >= 0) {
      lastRowBtn = a;
      if (dir === 'LEFT' && idx > 0) row[idx - 1].focus();
      else if (dir === 'RIGHT' && idx < row.length - 1) row[idx + 1].focus();
      else if (dir === 'UP') (isLive() ? B.back : seekbar).focus();
    } else if (a === seekbar) {
      if (dir === 'DOWN') (lastRowBtn && row.indexOf(lastRowBtn) >= 0 ? lastRowBtn : B.play).focus();
      else if (dir === 'UP') (card || B.back).focus();
    } else if (a === B.back) {
      if (dir === 'DOWN') (isLive() ? B.play : seekbar).focus();
    } else if (a === upNextBtn || a === upCreditsBtn || a === skipBtn) {
      if (dir === 'DOWN') (isLive() ? B.play : seekbar).focus();
      else if (a === upNextBtn && dir === 'RIGHT') upCreditsBtn.focus();
      else if (a === upCreditsBtn && dir === 'LEFT') upNextBtn.focus();
    } else {
      B.play.focus();
    }
  }

  function onArrow(dir) {
    const horiz = dir === 'LEFT' || dir === 'RIGHT';
    const sign = dir === 'RIGHT' ? 1 : -1;
    const a = document.activeElement;
    if (!overlayVisible()) {
      // the Up Next card has two buttons side by side
      if (upShown && horiz && (a === upNextBtn || a === upCreditsBtn)) { (a === upNextBtn ? upCreditsBtn : upNextBtn).focus(); return; }
      if (horiz && !isLive()) { showOverlay(seekbar); scrubStep(sign); return; } // like Netflix: arrows scrub
      if (!horiz && isLive() && ctx.items.length > 1) { zap(dir === 'UP' ? 1 : -1); return; } // like a TV box: up / down change channel
      showOverlay(B.play);
      return;
    }
    armHide();
    if (a === seekbar && horiz && !isLive()) { scrubStep(sign); return; }
    if (scrub) commitScrub();
    moveInOverlay(dir);
  }

  function onBackKey() {
    if (numBuf) { cancelNumber(); return; }
    if (drawerOpen()) { closeDrawer(); return; }
    if (scrub) { cancelScrub(); return; }
    if (isCatchup()) { backToLive(); return; }
    back();
  }

  function toggleInfo() {
    if (overlayVisible()) {
      forceHideOverlay();
      if (isLive()) showBanner();
      else { syncMini(); miniEl.classList.remove('hide'); }
    } else {
      hideBanner();
      showOverlay(B.play);
    }
  }

  function handleKey(e) {
    const k = e.keyCode;
    const dir = { 37: 'LEFT', 38: 'UP', 39: 'RIGHT', 40: 'DOWN' }[k];
    idle();

    if (sleepWarnShown) { e.preventDefault(); cancelSleep(); toast('Sleep timer cancelled'); return; }
    if (stillOpen) { stillKey(e, k, dir); return; }
    if (pauseCardShown) {
      hidePauseCard();
      // the first key only brings the controls back, except for the transport keys
      if (k !== KEYS.PLAY && k !== KEYS.PAUSE && k !== KEYS.STOP && k !== KEYS.BACK) { e.preventDefault(); showOverlay(B.play); return; }
    }

    if (k === KEYS.BACK) { e.preventDefault(); onBackKey(); return; }
    if (k === KEYS.STOP) { e.preventDefault(); back(); return; }
    if (k === KEYS.PLAY) { e.preventDefault(); resumePlay(); showOverlay(); return; }
    if (k === KEYS.PAUSE) { e.preventDefault(); wantPlay = false; video.pause(); return; }
    if (k === KEYS.FF || k === KEYS.RW) {
      e.preventDefault();
      if (!isLive()) { showOverlay(seekbar); scrubStep(k === KEYS.FF ? 1 : -1); }
      else if (k === KEYS.RW) startOver(); // live with replay: the programme on now, from its start
      return;
    }
    if (k === KEYS.CH_UP || k === KEYS.PAGE_UP) { e.preventDefault(); zap(1); return; }
    if (k === KEYS.CH_DOWN || k === KEYS.PAGE_DOWN) { e.preventDefault(); zap(-1); return; }
    if (k === KEYS.YELLOW) { e.preventDefault(); toggleFav(); return; }
    if (k === KEYS.BLUE) { e.preventDefault(); cyclePicture(); return; }
    if (k === KEYS.RED) { e.preventDefault(); toggleTracks(); return; }
    if (k === KEYS.GREEN) { e.preventDefault(); lastChannel(); return; }
    if (k === KEYS.INFO) { e.preventDefault(); toggleInfo(); return; }
    if (k === KEYS.GUIDE) { e.preventDefault(); if (hasArchive()) openDrawer(buildGuide, B.guide); return; }

    const digit = k >= 48 && k <= 57 ? k - 48 : (k >= 96 && k <= 105 ? k - 96 : -1);
    if (digit >= 0 && isLive() && !drawerOpen()) { e.preventDefault(); typeDigit(digit); return; }
    if (k === KEYS.ENTER && numBuf) { e.preventDefault(); commitNumber(); return; }

    if (drawerOpen()) {
      if (k === KEYS.ENTER) {
        e.preventDefault();
        const a = document.activeElement;
        if (a && a.tagName === 'BUTTON') a.click();
      } else if (dir) {
        e.preventDefault();
        spatialNav(dir, drawerEl);
      }
      return;
    }
    if (k === KEYS.ENTER) { e.preventDefault(); onEnter(); return; }
    if (dir) { e.preventDefault(); onArrow(dir); }
  }

  function toggleFav() {
    if (!info || !info.fav) return;
    const on = API.toggleFav(info.fav);
    refreshFav();
    toast(on ? '★ Added to favorites' : 'Removed from favorites');
  }

  // ---------- wiring ----------
  B.back.addEventListener('click', onBackKey);
  B.play.addEventListener('click', togglePlay);
  B.rw.addEventListener('click', () => skipBy(-10));
  B.ff.addEventListener('click', () => skipBy(10));
  B.next.addEventListener('click', () => playIndex(ctx.index + 1));
  B.start.addEventListener('click', startOver);
  B.live.addEventListener('click', backToLive);
  B.eps.addEventListener('click', () => openDrawer(buildEpisodes, B.eps));
  B.chans.addEventListener('click', () => openDrawer(buildChannels, B.chans));
  B.guide.addEventListener('click', () => openDrawer(buildGuide, B.guide));
  B.tracks.addEventListener('click', () => openDrawer(() => buildTracks(null), B.tracks));
  B.pic.addEventListener('click', () => openDrawer(buildPicture, B.pic));
  B.speed.addEventListener('click', () => openDrawer(buildSpeed, B.speed));
  B.sleep.addEventListener('click', () => openDrawer(buildSleep, B.sleep));
  B.fav.addEventListener('click', toggleFav);
  upNextBtn.addEventListener('click', () => { idle(); markFinished(); playIndex(ctx.index + 1); });
  upCreditsBtn.addEventListener('click', dismissCredits);
  skipBtn.addEventListener('click', doSkip);
  stillGo.addEventListener('click', () => { hideStill(); idle(); wantPlay = true; markFinished(); playIndex(ctx.index + 1); });
  stillBack.addEventListener('click', () => { hideStill(); back(); });
  sleepKeep.addEventListener('click', () => { cancelSleep(); toast('Sleep timer cancelled'); });

  seekbar.addEventListener('click', (e) => {
    if (isLive() || !hasDuration()) return;
    const r = seekbar.getBoundingClientRect();
    const to = clamp((e.clientX - r.left) / r.width, 0, 1) * video.duration;
    learnIntro(video.currentTime, to);
    video.currentTime = to;
    updateTime();
  });
  video.addEventListener('click', () => {
    if (!overlayVisible()) showOverlay(B.play);
    else { togglePlay(); showOverlay(); }
  });

  // Magic Remote pointer: moving it wakes the controls
  let lastMove = 0;
  playerEl.addEventListener('mousemove', () => {
    const now = Date.now();
    if (now - lastMove < 150) return;
    lastMove = now;
    idle();
    if (stillOpen || sleepWarnShown) return;
    if (pauseCardShown) { hidePauseCard(); showOverlay(); return; }
    if (!overlayVisible()) showOverlay(); else armHide();
  });

  video.addEventListener('play', () => { updatePlayIcon(); armHide(); hidePauseCard(); pausedAt = 0; });
  video.addEventListener('pause', () => {
    updatePlayIcon();
    if (Date.now() < ignorePauseUntil) return; // the app released the old stream, the viewer did not pause
    if (video.ended) return;                   // the file ran out; 'ended' decides what comes next
    if (isLive()) pausedAt = Date.now();
    if (hidden() || !ctx || stillOpen) return;
    if (!overlayVisible()) showOverlay(B.play);
    else { clearTimeout(hideTimer); miniEl.classList.add('hide'); }
    schedulePauseCard();
  });
  video.addEventListener('playing', () => {
    retries = 0;
    lastMoveTs = Date.now();
    spinner.classList.add('hidden');
    tryResume();
    applySeek();
    applyLangPrefs();
    setTimeout(applyLangPrefs, 2500);
  });
  video.addEventListener('timeupdate', () => {
    if (started || hidden()) return;
    if (video.videoWidth > 0 || video.currentTime > 0.4) {
      started = true;
      lastMoveTs = Date.now();
      clearTimeout(stallTimer);
      spinner.classList.add('hidden');
      setMsg('');
      refreshSub();
    }
  });
  video.addEventListener('waiting', () => { if (!hidden()) spinner.classList.remove('hidden'); });
  video.addEventListener('canplay', () => {
    spinner.classList.add('hidden');
    applySeek();
    if (wantPlay && !failed && video.paused && !hidden() && !stillOpen) safePlay();
  });
  video.addEventListener('loadedmetadata', () => { tryResume(); applySeek(); applyLangPrefs(); });
  video.addEventListener('durationchange', () => { tryResume(); applySeek(); });
  video.addEventListener('error', () => { if (!hidden() && ctx && !hls && (video.getAttribute('src') || video.querySelector('source'))) fail(); });
  video.addEventListener('ended', () => {
    if (!ctx || hidden()) return;
    if (isCatchup()) { backToLive(); return; }
    if (nextItem()) { autoAdvance(); return; }
    if (isLive()) { fail(); return; }
    if (sleepEnd) { sleepDone(); return; }
    if (info) API.removeProgress(info.url);
    back();
  });

  setInterval(() => {
    if (hidden() || !ctx) return;
    updateTime();
    checkUpNext();
    checkSkipIntro();
    watchStall();
    tickSleep();
    if (isLive()) tickEpg();
    if (++saveCount % 10 === 0) saveProgress(); // every ~5s
  }, 500);

  window.addEventListener('beforeunload', saveProgress);

  applyPicture();
  applySubStyle();

  return { play, handleKey, back, stop, toggle: togglePlay };
})();
window.Player = Player;
