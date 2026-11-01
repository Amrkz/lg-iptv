const KEYS = {
  LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 461,
  PLAY: 415, PAUSE: 19, STOP: 413, RW: 412, FF: 417,
  RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
  CH_UP: 427, CH_DOWN: 428, PAGE_UP: 33, PAGE_DOWN: 34,
  INFO: 457, GUIDE: 458
};
window.KEYS = KEYS;

// scope (optional): only elements inside it can take focus, and hidden ones are skipped
function focusables(scope) {
  const root = scope || document;
  let list = Array.from(root.querySelectorAll('button, .card, input, [tabindex]'))
    .filter(el => !el.disabled && el.tabIndex >= 0 && el.offsetParent !== null);
  if (scope) list = list.filter(el => getComputedStyle(el).visibility !== 'hidden');
  return list;
}

function spatialNav(dir, scope) {
  const active = document.activeElement;
  const cands = focusables(scope);
  // nothing useful focused (e.g. <body>): grab the first thing on screen
  if (!active || active === document.body || active.offsetParent === null || (scope && !scope.contains(active))) {
    if (cands[0]) cands[0].focus();
    return;
  }
  const rect = active.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let best = null, bestScore = Infinity;
  cands.forEach(el => {
    if (el === active) return;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    let ok = false;
    if (dir === 'LEFT' && dx < -5) ok = true;
    if (dir === 'RIGHT' && dx > 5) ok = true;
    if (dir === 'UP' && dy < -5) ok = true;
    if (dir === 'DOWN' && dy > 5) ok = true;
    if (!ok) return;
    const horiz = dir === 'LEFT' || dir === 'RIGHT';
    const primary = horiz ? Math.abs(dx) : Math.abs(dy);
    const secondary = horiz ? Math.abs(dy) : Math.abs(dx);
    const score = primary + secondary * 0.5;
    if (score < bestScore) { bestScore = score; best = el; }
  });
  if (best) best.focus();
}

function exitApp() {
  if (window.webOS && window.webOS.platformBack) window.webOS.platformBack();
  else window.close();
}

// Back at the top level asks first. A slip of the thumb should not drop the viewer out of the app.
let exitOpen = false, exitReturn = null;
function askExit() {
  const box = document.getElementById('exitbox');
  const stay = document.getElementById('exit-stay');
  if (!box || !stay) { exitApp(); return; }
  if (exitOpen) return;
  exitOpen = true;
  exitReturn = document.activeElement;
  box.classList.remove('hidden');
  stay.focus(); // the safe answer is the one under the cursor
}
function closeExit() {
  if (!exitOpen) return;
  exitOpen = false;
  document.getElementById('exitbox').classList.add('hidden');
  const back = exitReturn;
  exitReturn = null;
  if (back && document.body.contains(back)) { try { back.focus({ preventScroll: true }); } catch (e) { back.focus(); } }
}
(function () {
  const stay = document.getElementById('exit-stay');
  const leave = document.getElementById('exit-leave');
  const box = document.getElementById('exitbox');
  if (stay) stay.addEventListener('click', closeExit);
  if (leave) leave.addEventListener('click', () => { closeExit(); exitApp(); });
  if (box) box.addEventListener('mousedown', (e) => { if (e.target === box) closeExit(); });
})();

// A second press of the app icon must bring this window forward.
document.addEventListener('webOSRelaunch', () => {
  if (window.PalmSystem && PalmSystem.activate) PalmSystem.activate();
});

// Arrow keys move one station at a time. A resting pointer must not refocus whatever scrolls underneath it.
let pointerAim = false;
document.addEventListener('pointermove', () => { pointerAim = true; }, true);
document.addEventListener('mousedown', () => { pointerAim = true; }, true);
window.pointerAiming = () => pointerAim;

document.addEventListener('keydown', (e) => {
  pointerAim = false;
  const k = e.keyCode;

  // the exit question owns the keys while it is open
  if (exitOpen) {
    e.preventDefault();
    if (k === KEYS.BACK) { closeExit(); return; }
    const stay = document.getElementById('exit-stay'), leave = document.getElementById('exit-leave');
    if (k === KEYS.LEFT || k === KEYS.UP) stay.focus();
    else if (k === KEYS.RIGHT || k === KEYS.DOWN) leave.focus();
    else if (k === KEYS.ENTER) (document.activeElement === leave ? leave : stay).click();
    return;
  }

  // the player owns every key while it is open
  if (window.Player && !document.getElementById('player').classList.contains('hidden')) {
    Player.handleKey(e);
    return;
  }

  if (k === KEYS.BACK) {
    e.preventDefault();
    if (window.App && App.onBack && App.onBack()) return;
    askExit();
    return;
  }

  if ((k === KEYS.RED || k === KEYS.GREEN || k === KEYS.BLUE) && window.App && App.onColor && App.onColor(k)) { e.preventDefault(); return; }

  const map = { 37: 'LEFT', 38: 'UP', 39: 'RIGHT', 40: 'DOWN' };
  const dir = map[k];
  if (!dir) return;

  const t = e.target;
  const isRange = t && t.tagName === 'INPUT' && t.type === 'range';
  if (isRange && (dir === 'LEFT' || dir === 'RIGHT')) return; // native seek

  const isText = t && t.tagName === 'INPUT' && !isRange;
  if (isText && (dir === 'LEFT' || dir === 'RIGHT')) {
    // let the caret move; only leave the field when it is at the edge
    if (dir === 'LEFT' && t.selectionEnd > 0) return;
    if (dir === 'RIGHT' && t.selectionStart < t.value.length) return;
  }

  if (window.App && App.onArrow && App.onArrow(dir)) { e.preventDefault(); return; } // row-by-row home nav
  spatialNav(dir);
  e.preventDefault();
}, true);

// ---------- fit to the window ----------
// The layout is designed at 1920x1080. A TV browser window can be bigger or smaller, and focusing an
// element can scroll the page sideways, so scale to fit, centre it, and never let the page scroll.
(function () {
  const W = 1920, H = 1080;
  const root = document.documentElement;
  function fit() {
    const s = Math.min(window.innerWidth / W, window.innerHeight / H);
    if (!s || !isFinite(s)) return;
    root.style.zoom = Math.abs(s - 1) < 0.005 ? '' : String(s);
    // centre the 1920x1080 stage in whatever is left over (margins are in zoomed units)
    root.style.marginLeft = Math.max(0, (window.innerWidth - W * s) / 2 / s) + 'px';
    root.style.marginTop = Math.max(0, (window.innerHeight - H * s) / 2 / s) + 'px';
  }
  function lock() {
    const el = document.scrollingElement || root;
    if (el.scrollLeft || el.scrollTop) { el.scrollLeft = 0; el.scrollTop = 0; }
    if (document.body.scrollLeft || document.body.scrollTop) { document.body.scrollLeft = 0; document.body.scrollTop = 0; }
  }
  window.addEventListener('resize', fit);
  window.addEventListener('scroll', lock, true);
  document.addEventListener('focusin', lock);
  fit();
})();
