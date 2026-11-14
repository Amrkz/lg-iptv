// Login cache and guide-time checks. Run: node lg-iptv/js/api.logic.test.js
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
function tr(s, vars) {
  if (!vars) return s;
  return String(s).replace(/\{(\w+)\}/g, function (m, k) {
    return vars[k] !== undefined && vars[k] !== null ? vars[k] : m;
  });
}
var settings = { epgOffset: 0 };
var Settings = { get: function (k) { return settings[k]; } };
var fetches = [];
function ok(body) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: function () { return Promise.resolve(body); },
    text: function () { return Promise.resolve(typeof body === 'string' ? body : ''); }
  });
}
var liveLists = {
  amy: [{ name: 'Amy News', stream_id: 7 }],
  bob: [{ name: 'Bob Sport', stream_id: 9 }]
};
function fetch(url) {
  url = String(url);
  fetches.push(url);
  if (url.indexOf('player_api.php') >= 0 && url.indexOf('action=') < 0) {
    return ok({ user_info: { auth: 1, status: 'Active', allowed_output_formats: ['m3u8'] } });
  }
  if (url.indexOf('action=get_live_streams') >= 0) {
    var who = /username=([^&]+)/.exec(url);
    var name = who ? decodeURIComponent(who[1]) : '';
    return ok(liveLists[name] || []);
  }
  if (url.indexOf('action=get_short_epg') >= 0) {
    return ok({
      epg_listings: [{
        title: Buffer.from('News').toString('base64'),
        description: Buffer.from('Hello').toString('base64'),
        start_timestamp: 1700000000,
        stop_timestamp: 1700003600,
        start: '2023-11-14 21:13:20'
      }]
    });
  }
  if (/\.m3u/i.test(url)) {
    return ok('#EXTM3U\n#EXTINF:-1 tvg-logo="" group-title="News",One\nhttp://cdn.example/live/1.ts\n');
  }
  return ok([]);
}

var sandbox = {
  console: console, localStorage: localStorage, tr: tr, Settings: Settings, fetch: fetch,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  atob: function (s) { return Buffer.from(s, 'base64').toString('binary'); },
  escape: escape, decodeURIComponent: decodeURIComponent, encodeURIComponent: encodeURIComponent,
  Promise: Promise, Date: Date, JSON: JSON, Object: Object, Array: Array, String: String,
  Number: Number, Math: Math, Error: Error, TypeError: TypeError, SyntaxError: SyntaxError,
  document: { getElementById: function () { return null; } }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8'), sandbox, { filename: 'api.js' });
var API = sandbox.API;

var failed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn).then(function () { console.log('ok ' + name); }, function (e) {
    failed++;
    console.error('FAIL ' + name + '\n' + (e && e.stack || e));
  });
}

var pending = Promise.resolve();
function later(name, fn) {
  pending = pending.then(function () { return check(name, fn); });
}

later('a new login does not keep the previous provider in search', function () {
  return API.xtreamLogin('http://prov.example:8080', 'amy', 'pw').then(function () {
    return API.getAll('live');
  }).then(function (list) {
    assert.strictEqual(list[0].name, 'Amy News');
    var n = fetches.filter(function (u) { return u.indexOf('get_live_streams') >= 0; }).length;
    return API.getAll('live').then(function (again) {
      assert.strictEqual(again[0].name, 'Amy News');
      assert.strictEqual(fetches.filter(function (u) { return u.indexOf('get_live_streams') >= 0; }).length, n);
      return API.xtreamLogin('http://prov.example:8080', 'bob', 'pw2');
    });
  }).then(function () {
    return API.getAll('live');
  }).then(function (list) {
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].name, 'Bob Sport');
  });
});

later('the guide offset moves the times and leaves the catch-up link on the provider clock', function () {
  settings.epgOffset = 60;
  return API.getShortEpg(7).then(function (list) {
    assert.strictEqual(list[0].title, 'News');
    assert.strictEqual(list[0].startRaw, 1700000000 * 1000);
    assert.strictEqual(list[0].start, 1700000000 * 1000 + 60 * 60000);
    assert.strictEqual(list[0].end - list[0].start, 3600000);
    var urls = API.catchupUrls({ stream_id: 7 }, list[0]);
    assert.ok(urls[0].indexOf('/2023-11-14:21-13/') >= 0);
    var shiftedOnly = { title: 'X', start: list[0].start, end: list[0].end };
    var fromRaw = API.catchupUrls({ stream_id: 7 }, {
      title: 'X', start: list[0].start, end: list[0].end, startRaw: list[0].startRaw
    });
    assert.notStrictEqual(fromRaw[0], API.catchupUrls({ stream_id: 7 }, shiftedOnly)[0]);
  });
});

later('a signed-out guide request fails instead of crashing', function () {
  API.clearConfig();
  return API.getSeriesInfo(1).then(function () {
    throw new Error('expected a rejection');
  }, function (e) {
    assert.ok(e && e.message);
  });
});

pending.then(function () {
  if (failed) {
    console.error(failed + ' failed');
    process.exit(1);
  }
  console.log('api logic tests passed');
});
