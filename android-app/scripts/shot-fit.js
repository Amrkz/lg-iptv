/**
 * Headless fit tests for the Android 1920×1080 stage scaler.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..', 'www');
const OUT = '/workspace/shots';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome-stable';

const SIZES = [
  { name: '960x540', w: 960, h: 540, dpr: 2 },
  { name: '1280x720', w: 1280, h: 720, dpr: 1 },
  { name: '1920x1080', w: 1920, h: 1080, dpr: 1 },
  { name: '412x915', w: 412, h: 915, dpr: 2.625 },
];
const LANGS = ['en', 'ar'];

function contentType(p) {
  if (p.endsWith('.html')) return 'text/html; charset=utf-8';
  if (p.endsWith('.css')) return 'text/css';
  if (p.endsWith('.js')) return 'application/javascript';
  if (p.endsWith('.woff2')) return 'font/woff2';
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.svg')) return 'image/svg+xml';
  if (p.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let u = decodeURIComponent((req.url || '/').split('?')[0]);
      if (u === '/') u = '/index.html';
      const fp = path.join(ROOT, u.replace(/^\//, ''));
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        res.writeHead(404); res.end('missing'); return;
      }
      res.writeHead(200, { 'Content-Type': contentType(fp) });
      fs.createReadStream(fp).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function paintHome(page, lang) {
  await page.evaluate((lang) => {
    document.documentElement.classList.remove('fonts-wait');
    document.body.style.opacity = '1';
    // Do NOT call I18n.set — it reloads. Direction/lang already applied from localStorage.
    const login = document.getElementById('login');
    const home = document.getElementById('home');
    if (login) login.classList.add('hidden');
    if (home) home.classList.remove('hidden');
    const hero = document.getElementById('hero');
    if (hero) {
      const title = lang === 'ar' ? 'رحلة الضحك (2026)' : 'Comedy Quest (2026)';
      const meta = lang === 'ar' ? '2026 · كوميديا / أكشن' : '2026 · Comedy / Action';
      const plot = lang === 'ar'
        ? 'فيلم تجريبي لاختبار تناسب الشاشة على أجهزة أندرويد.'
        : 'A sample title used to verify the Android stage fits every viewport.';
      hero.innerHTML =
        '<div class="hero-slide on">' +
        '<div class="hero-bg"></div>' +
        '<div class="hero-content">' +
        '<div class="hero-kicker">Kayan</div>' +
        '<h2><span>' + title + '</span></h2>' +
        '<div class="hero-meta">' + meta + '</div>' +
        '<p>' + plot + '</p>' +
        '<div class="hero-dots"><span class="on"><i></i></span><span></span><span></span></div>' +
        '</div></div>';
    }
    const rows = document.getElementById('rows');
    if (rows) {
      const label = lang === 'ar' ? 'أفلام' : 'Movies';
      let cards = '';
      for (let i = 0; i < 6; i++) {
        cards += '<button class="card" tabindex="0"><span class="title"><span>' + label + ' ' + (i + 1) + '</span></span></button>';
      }
      rows.innerHTML =
        '<div class="row"><h3>' + label + ' <span class="count">6</span></h3>' +
        '<div class="row-items">' + cards + '</div></div>';
    }
    document.querySelectorAll('.topbar .navbtn').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-cat') === 'movies');
    });
    if (window.I18n && I18n.apply) I18n.apply(document);
    if (window.KayanFitStage) window.KayanFitStage();
  }, lang);
  await new Promise(r => setTimeout(r, 600));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const port = server.address().port;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
  });
  const report = [];
  try {
    for (const size of SIZES) {
      for (const lang of LANGS) {
        const page = await browser.newPage();
        await page.setViewport({ width: size.w, height: size.h, deviceScaleFactor: size.dpr });
        await page.evaluateOnNewDocument((lang) => {
          try { localStorage.setItem('iptv_lang', lang); } catch (e) {}
        }, lang);
        await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0', timeout: 60000 });
        await paintHome(page, lang);
        const metrics = await page.evaluate(() => {
          const app = document.getElementById('app');
          const hint = document.querySelector('.hint');
          const active = document.querySelector('.navbtn.active');
          const live = document.querySelector('.navbtn[data-cat="live"]');
          const heroH2 = document.querySelector('.hero h2');
          const logo = document.querySelector('.logo');
          const r = (el) => el ? el.getBoundingClientRect() : null;
          const ar = r(app), hr = r(hint), ac = r(active), lv = r(live), hh = r(heroH2), lg = r(logo);
          const vw = window.innerWidth, vh = window.innerHeight;
          const overlap = hr && ac ? !(hr.bottom <= ac.top + 2 || hr.top >= ac.bottom - 2 || hr.right <= ac.left || hr.left >= ac.right) : false;
          const cs = window.getComputedStyle(app);
          return {
            scale: app && app.getAttribute('data-scale'),
            transform: cs.transform,
            app: ar && { left: +ar.left.toFixed(1), top: +ar.top.toFixed(1), right: +ar.right.toFixed(1), bottom: +ar.bottom.toFixed(1), w: +ar.width.toFixed(1), h: +ar.height.toFixed(1) },
            viewport: { vw, vh },
            liveOk: lv ? (lv.left >= -1 && lv.right <= vw + 1 && lv.top >= -1 && lv.bottom <= vh + 1) : null,
            heroOk: hh ? (hh.left >= -1 && hh.right <= vw + 1) : null,
            logoOk: lg ? (lg.left >= -1 && lg.right <= vw + 1) : null,
            hintBelowActive: hr && ac ? hr.top >= ac.bottom - 1 : null,
            hintOverlapActive: overlap,
            plat: document.documentElement.className,
            dir: document.documentElement.getAttribute('dir'),
            homeHidden: document.getElementById('home').classList.contains('hidden'),
          };
        });
        const file = path.join(OUT, `android-fit-${size.name}-${lang}.png`);
        await page.screenshot({ path: file, fullPage: false });
        report.push({ size: size.name, lang, file, metrics });
        const ok = metrics.liveOk && metrics.heroOk && !metrics.hintOverlapActive && metrics.hintBelowActive && !metrics.homeHidden;
        console.log(JSON.stringify({ size: size.name, lang, scale: metrics.scale, appW: metrics.app && metrics.app.w, liveOk: metrics.liveOk, heroOk: metrics.heroOk, hintBelow: metrics.hintBelowActive, overlap: metrics.hintOverlapActive, ok }));
        await page.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  fs.writeFileSync(path.join(OUT, 'android-fit-report.json'), JSON.stringify(report, null, 2));
  const failed = report.filter(r => {
    const m = r.metrics;
    return !(m.liveOk && m.heroOk && !m.hintOverlapActive && m.hintBelowActive && !m.homeHidden);
  });
  console.log('wrote', report.length, 'shots; failed', failed.length);
  if (failed.length) process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
