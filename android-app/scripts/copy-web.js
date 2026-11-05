const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const root = path.join(__dirname, '..');
const src = '/workspace/lg-iptv/lg-iptv';
const dest = path.join(root, 'www');
const V = '20261106070000';
execSync(`rm -rf "${dest}" && mkdir -p "${dest}" && cp -a "${src}/." "${dest}/" && rm -rf "${dest}/service"`, { stdio: 'inherit' });
let html = fs.readFileSync(path.join(dest, 'index.html'), 'utf8');
// Android viewport: real device CSS pixels so the 1920×1080 stage can scale to fit.
html = html.replace(
  /<meta name="viewport"[^>]*>/,
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n  <meta name="mobile-web-app-capable" content="yes" />\n  <meta name="theme-color" content="#0a0a0c" />\n  <script>document.documentElement.classList.add("plat-android");</script>'
);
// Cache-bust + ensure android.css
html = html.replace(/css\/styles\.css\?v=[^"]+/g, 'css/styles.css?v=' + V);
html = html.replace(/css\/themes\.css\?v=[^"]+/g, 'css/themes.css?v=' + V);
if (!html.includes('android.css')) {
  html = html.replace(
    /(<link rel="stylesheet" href="css\/themes\.css\?v=[^"]+" \/>)/,
    '$1\n  <link rel="stylesheet" href="css/android.css?v=' + V + '" />'
  );
} else {
  html = html.replace(/css\/android\.css\?v=[^"]+/g, 'css/android.css?v=' + V);
}
// Ensure android-shim loads first among app scripts
if (!html.includes('android-shim.js')) {
  html = html.replace(
    /<script src="js\/i18n\.js[^"]*"><\/script>/,
    '<script src="js/android-shim.js?v=' + V + '"></script>\n  <script src="js/i18n.js?v=' + V + '"></script>'
  );
} else {
  html = html.replace(/js\/android-shim\.js\?v=[^"]+/g, 'js/android-shim.js?v=' + V);
}
html = html.replace(/js\/(i18n|lang-ar|keys|api|ui|player|settings|downloads|app)\.js\?v=[^"]+/g, 'js/$1.js?v=' + V);
fs.writeFileSync(path.join(dest, 'index.html'), html);
console.log('www synced', V);
