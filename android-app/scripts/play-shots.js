/**
 * Google Play store screenshots with generic mock titles (no copyrighted names).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..', 'www');
const OUT = '/workspace/play/screenshots';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome-stable';

const MOCK = {
  en: {
    hero: 'Northern Lights',
    meta: '2026 · Adventure / Drama',
    plot: 'A sample title used only for store screenshots. No real channels or movies are included in the app.',
    rows: [
      { label: 'Continue watching', items: ['Harbor Night', 'Quiet Valley', 'Paper Planes', 'Glass Garden', 'Soft Echo', 'Blue Horizon'] },
      { label: 'Movies', items: ['Silver Trail', 'Amber Clock', 'River Song', 'Cedar House', 'Moon Circuit', 'Dust Parade'] },
      { label: 'Series', items: ['Station Seven', 'Lake House', 'Night Desk', 'Coral Gate', 'Wind Room', 'Maple Line'] },
    ],
  },
  ar: {
    hero: 'أضواء الشمال',
    meta: '2026 · مغامرة / دراما',
    plot: 'عنوان تجريبي لصور المتجر فقط. التطبيق لا يتضمن أي قنوات أو أفلام.',
    rows: [
      { label: 'متابعة المشاهدة', items: ['ليلة الميناء', 'الوادي الهادئ', 'طائرات ورقية', 'حديقة الزجاج', 'صدى ناعم', 'أفق أزرق'] },
      { label: 'أفلام', items: ['درب فضي', 'ساعة عنبر', 'أغنية النهر', 'بيت الأرز', 'دائرة القمر', 'موكب الغبار'] },
      { label: 'مسلسلات', items: ['المحطة السابعة', 'بيت البحيرة', 'مكتب الليل', 'بوابة المرجان', 'غرفة الريح', 'خط القيقب'] },
    ],
  },
};

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

const PALETTE = [
  ['#1a1a2e', '#e50914'],
  ['#16213e', '#0f3460'],
  ['#0f0f0f', '#c9a227'],
  ['#1b1b1b', '#4ecdc4'],
  ['#2d132c', '#801336'],
  ['#0b132b', '#3a506b'],
];

function cardHtml(title, i) {
  const [bg, accent] = PALETTE[i % PALETTE.length];
  return (
    '<button class="card" tabindex="0" style="background:linear-gradient(160deg,' + bg + ' 40%,' + accent + '55);">' +
    '<span class="title"><span>' + title + '</span></span></button>'
  );
}

async function paintHome(page, lang) {
  const mock = MOCK[lang] || MOCK.en;
  await page.evaluate((lang, mock) => {
    document.documentElement.classList.remove('fonts-wait');
    document.body.style.opacity = '1';
    const login = document.getElementById('login');
    const home = document.getElementById('home');
    if (login) login.classList.add('hidden');
    if (home) home.classList.remove('hidden');
    const hero = document.getElementById('hero');
    if (hero) {
      hero.innerHTML =
        '<div class="hero-slide on">' +
        '<div class="hero-bg" style="background:linear-gradient(120deg,#0b0b10,#1a0a0c 50%,#0b0b10);"></div>' +
        '<div class="hero-content">' +
        '<div class="hero-kicker">Kayan</div>' +
        '<h2><span>' + mock.hero + '</span></h2>' +
        '<div class="hero-meta">' + mock.meta + '</div>' +
        '<p>' + mock.plot + '</p>' +
        '<div class="hero-dots"><span class="on"><i></i></span><span></span><span></span></div>' +
        '</div></div>';
    }
    const rows = document.getElementById('rows');
    if (rows) {
      rows.innerHTML = mock.rows.map((row) => {
        const cards = row.items.map((t, i) => {
          const pal = [
            ['#1a1a2e', '#e50914'],
            ['#16213e', '#0f3460'],
            ['#0f0f0f', '#c9a227'],
            ['#1b1b1b', '#4ecdc4'],
            ['#2d132c', '#801336'],
            ['#0b132b', '#3a506b'],
          ][i % 6];
          return (
            '<button class="card" tabindex="0" style="background:linear-gradient(160deg,' + pal[0] + ' 35%,' + pal[1] + '88);">' +
            '<span class="title"><span>' + t + '</span></span></button>'
          );
        }).join('');
        return (
          '<div class="row"><h3>' + row.label + ' <span class="count">' + row.items.length + '</span></h3>' +
          '<div class="row-items">' + cards + '</div></div>'
        );
      }).join('');
    }
    document.querySelectorAll('.topbar .navbtn').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-cat') === 'home' || b.getAttribute('data-cat') === 'movies');
    });
    // Prefer Home active if present
    const homeBtn = document.querySelector('.navbtn[data-cat="home"]');
    if (homeBtn) {
      document.querySelectorAll('.topbar .navbtn').forEach((b) => b.classList.remove('active'));
      homeBtn.classList.add('active');
    }
    if (window.I18n && I18n.apply) I18n.apply(document);
    if (window.KayanFitStage) window.KayanFitStage();
  }, lang, mock);
  await new Promise((r) => setTimeout(r, 700));
}

async function paintSettings(page, lang) {
  await page.evaluate((lang) => {
    document.documentElement.classList.remove('fonts-wait');
    document.body.style.opacity = '1';
    const login = document.getElementById('login');
    if (login) login.classList.add('hidden');
    const home = document.getElementById('home');
    if (home) home.classList.add('hidden');
    // Try open settings via existing UI hooks
    const settingsBtn = document.querySelector('[data-action="settings"], .navbtn[data-cat="settings"], #btnSettings, button.settings');
    if (settingsBtn) settingsBtn.click();
    const panel = document.getElementById('settings') || document.querySelector('.settings, #settingsPanel, .control-center');
    if (panel) {
      panel.classList.remove('hidden');
      panel.style.display = 'block';
    }
    // Fallback: fabricate a clean settings panel overlay
    if (!document.getElementById('play-shot-settings')) {
      const el = document.createElement('div');
      el.id = 'play-shot-settings';
      el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(8,8,12,.92);backdrop-filter:blur(12px);color:#fff;font-family:system-ui,sans-serif;padding:48px 64px;';
      const title = lang === 'ar' ? 'مركز التحكم' : 'Control Center';
      const items = lang === 'ar'
        ? [['الحسابات والقوائم', 'أضف M3U أو Xtream'], ['المشغّل والتخزين المؤقت', 'جودة التشغيل'], ['المظهر والسمات', 'زجاج · صلصال · سويسري'], ['التحميلات والتخزين', 'تحذير المساحة'], ['الرقابة الأبوية', 'رمز PIN'], ['النسخ الاحتياطي', 'تصدير / استيراد']]
        : [['Accounts & playlists', 'Add your own M3U or Xtream'], ['Player & buffering', 'Playback quality'], ['Appearance & themes', 'Glass · Clay · Swiss'], ['Downloads & storage', 'Free-space warnings'], ['Parental controls', 'PIN lock'], ['Backup & reset', 'Export / import']];
      el.innerHTML =
        '<div style="max-width:1100px;margin:0 auto;">' +
        '<div style="display:flex;align-items:center;gap:16px;margin-bottom:36px;">' +
        '<div style="width:48px;height:48px;border-radius:12px;background:#e50914;display:grid;place-items:center;font-weight:700;">K</div>' +
        '<div><div style="font-size:36px;font-weight:700;">' + title + '</div>' +
        '<div style="opacity:.65;margin-top:4px;">Kayan IPTV</div></div></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;">' +
        items.map(([h, s]) =>
          '<div style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:22px 24px;">' +
          '<div style="font-size:22px;font-weight:600;margin-bottom:8px;">' + h + '</div>' +
          '<div style="opacity:.7;font-size:16px;">' + s + '</div></div>'
        ).join('') +
        '</div></div>';
      document.body.appendChild(el);
    }
    if (window.KayanFitStage) window.KayanFitStage();
  }, lang);
  await new Promise((r) => setTimeout(r, 500));
}

async function paintLogin(page, lang) {
  await page.evaluate((lang) => {
    document.documentElement.classList.remove('fonts-wait');
    document.body.style.opacity = '1';
    const login = document.getElementById('login');
    const home = document.getElementById('home');
    if (home) home.classList.add('hidden');
    if (login) login.classList.remove('hidden');
    const shot = document.getElementById('play-shot-settings');
    if (shot) shot.remove();
    if (window.I18n && I18n.apply) I18n.apply(document);
    if (window.KayanFitStage) window.KayanFitStage();
  }, lang);
  await new Promise((r) => setTimeout(r, 500));
}

const SHOTS = [
  { name: 'phone-01-home-en', w: 1080, h: 1920, dpr: 1, lang: 'en', paint: 'home' },
  { name: 'phone-02-home-ar', w: 1080, h: 1920, dpr: 1, lang: 'ar', paint: 'home' },
  { name: 'phone-03-settings-en', w: 1080, h: 1920, dpr: 1, lang: 'en', paint: 'settings' },
  { name: 'phone-04-login-en', w: 1080, h: 1920, dpr: 1, lang: 'en', paint: 'login' },
  { name: 'phone-05-home-land-en', w: 1920, h: 1080, dpr: 1, lang: 'en', paint: 'home' },
  { name: 'tv-01-home-en', w: 1920, h: 1080, dpr: 1, lang: 'en', paint: 'home' },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const port = server.address().port;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none', '--window-size=1920,1080'],
  });
  try {
    for (const shot of SHOTS) {
      const page = await browser.newPage();
      await page.setViewport({ width: shot.w, height: shot.h, deviceScaleFactor: shot.dpr });
      await page.evaluateOnNewDocument((lang) => {
        try {
          localStorage.setItem('iptv_lang', lang);
          localStorage.setItem('iptv_theme', 'glass');
        } catch (e) {}
      }, shot.lang);
      await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0', timeout: 60000 });
      if (shot.paint === 'home') await paintHome(page, shot.lang);
      else if (shot.paint === 'settings') await paintSettings(page, shot.lang);
      else if (shot.paint === 'login') await paintLogin(page, shot.lang);
      const file = path.join(OUT, shot.name + '.png');
      await page.screenshot({ path: file, fullPage: false, type: 'png' });
      console.log('wrote', file);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
