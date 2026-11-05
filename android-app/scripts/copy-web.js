const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const root = path.join(__dirname, '..');
const src = '/workspace/lg-iptv/lg-iptv';
const dest = path.join(root, 'www');
execSync(`rm -rf "${dest}" && mkdir -p "${dest}" && cp -a "${src}/." "${dest}/" && rm -rf "${dest}/service"`, { stdio: 'inherit' });
// Ensure Android index bits
let html = fs.readFileSync(path.join(dest, 'index.html'), 'utf8');
if (!html.includes('android-shim.js')) {
  html = html.replace(
    '<meta name="viewport" content="width=1920, height=1080, initial-scale=1" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n  <meta name="mobile-web-app-capable" content="yes" />\n  <meta name="theme-color" content="#0a0a0c" />'
  );
  html = html.replace(
    '<link rel="stylesheet" href="css/themes.css?v=20261106050000" />',
    '<link rel="stylesheet" href="css/themes.css?v=20261106050000" />\n  <link rel="stylesheet" href="css/android.css?v=20261106060000" />'
  );
  html = html.replace(
    '<script src="js/i18n.js',
    '<script src="js/android-shim.js?v=20261106060000"></script>\n  <script src="js/i18n.js'
  );
  fs.writeFileSync(path.join(dest, 'index.html'), html);
}
console.log('www synced');
