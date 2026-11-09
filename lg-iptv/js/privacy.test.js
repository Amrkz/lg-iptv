// Backup and parental-PIN checks. Run: node lg-iptv/js/privacy.test.js
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var store = {};
var localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};
function tr(s) { return s; }
var document = {
  documentElement: {
    setAttribute: function () {},
    style: { setProperty: function () {} },
    classList: { contains: function () { return true; }, add: function () {}, remove: function () {} },
    getAttribute: function () { return ''; }
  },
  getElementById: function () { return null; },
  querySelector: function () { return null; }
};
var cfg = { type: 'xtream', server: 'http://provider.example:8080', user: 'alice', pass: 's3cret', url: '' };
var API = {
  pref: function (key, value) {
    if (value === undefined) {
      var raw = localStorage.getItem('iptv_pref_' + key);
      if (raw == null) return null;
      try { return JSON.parse(raw); } catch (e) { return null; }
    }
    localStorage.setItem('iptv_pref_' + key, JSON.stringify(value));
    return value;
  },
  getConfig: function () { return cfg; },
  getLast: function () { return { user: 'alice', server: cfg.server }; }
};
var sandbox = {
  console: console, localStorage: localStorage, tr: tr, document: document, API: API,
  PinHash: require('./pinhash.js'),
  crypto: { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = (i * 17 + 3) & 255; return a; } },
  Uint8Array: Uint8Array, JSON: JSON, Object: Object, Array: Array, String: String, Date: Date,
  decodeURIComponent: decodeURIComponent, Math: Math
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'settings.js'), 'utf8'), sandbox, { filename: 'settings.js' });
var Settings = sandbox.Settings;

var failed = 0;
function check(name, fn) {
  try { fn(); console.log('ok ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n' + (e && e.stack || e)); }
}

check('a stored 4-digit PIN is migrated to a hash and still unlocks', function () {
  localStorage.setItem('iptv_pref_set_pin', JSON.stringify('1234'));
  localStorage.setItem('iptv_pref_set_pinOn', JSON.stringify(true));
  assert.strictEqual(Settings.pinOk('1234'), true);
  assert.strictEqual(Settings.pinOk('0000'), false);
  assert.strictEqual(Settings.pinOk('12'), false);
  var left = localStorage.getItem('iptv_pref_set_pin');
  assert.ok(left === '""' || left === null);
  var hash = JSON.parse(localStorage.getItem('iptv_pref_set_pinHash'));
  assert.strictEqual(hash.length, 64);
  assert.ok(hash.indexOf('1234') < 0);
  assert.ok(Settings.get('pin'));
});

check('changing the PIN replaces the hash', function () {
  var before = localStorage.getItem('iptv_pref_set_pinHash');
  Settings.set('pin', '9876');
  assert.notStrictEqual(localStorage.getItem('iptv_pref_set_pinHash'), before);
  assert.strictEqual(Settings.pinOk('9876'), true);
  assert.strictEqual(Settings.pinOk('1234'), false);
});

check('a backup leaves out the PIN, the hash, and the account password', function () {
  Settings.rememberProfile();
  Settings.saveProfiles([{
    id: 'm1', name: 'list', type: 'm3u', user: 'bob', pass: 'hide-me',
    m3u: 'http://user:hide-me@host.example/get.php?username=bob&password=hide-me&type=m3u',
    server: ''
  }]);
  var raw = Settings.exportBackup();
  var data = JSON.parse(raw);
  assert.strictEqual(data.v, 2);
  assert.ok(!Object.prototype.hasOwnProperty.call(data.settings, 'pin'));
  assert.ok(!Object.prototype.hasOwnProperty.call(data.settings, 'pinHash'));
  assert.ok(!Object.prototype.hasOwnProperty.call(data.settings, 'pinSalt'));
  assert.ok(raw.indexOf('9876') < 0);
  assert.ok(raw.indexOf('s3cret') < 0);
  assert.ok(raw.indexOf('hide-me') < 0);
  assert.ok(raw.indexOf('password=') < 0);
  assert.strictEqual(data.profiles[0].user, 'bob');
  assert.ok(data.profiles[0].m3u.indexOf('type=m3u') >= 0);
  assert.ok(!Object.prototype.hasOwnProperty.call(data.profiles[0], 'pass'));
});

check('an older backup can restore a login once, and the PIN is stored only as a hash', function () {
  var r = Settings.importBackup(JSON.stringify({
    v: 1,
    settings: { pin: '2468', pinOn: true, theme: 'glass', pinHash: 'deadbeef' },
    profiles: [{ id: 'p9', type: 'xtream', name: 'old', server: 'http://old.example', user: 'sam', pass: 'from-old-backup' }]
  }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(Settings.pinOk('2468'), true);
  assert.strictEqual(Settings.pinOk('9876'), false);
  assert.ok(String(localStorage.getItem('iptv_pref_set_pinHash')).indexOf('deadbeef') < 0);
  assert.strictEqual(Settings.getProfiles()[0].pass, 'from-old-backup');
  var again = Settings.exportBackup();
  assert.ok(again.indexOf('from-old-backup') < 0);
  assert.ok(again.indexOf('2468') < 0);
});

check('reset clears the hashed PIN', function () {
  Settings.resetAll();
  assert.strictEqual(Settings.pinOk('2468'), true);
  assert.ok(!Settings.get('pin'));
});

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('privacy tests passed');
