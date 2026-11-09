// Upstream target checks for the TV helper. Plain ES5: the TV runs Node 8.
// The helper exists so a provider that rejects the TV browser can still be played.
// It must not also be an open proxy onto the LAN, loopback, or link-local network.
var dns = require('dns');
var URL = require('url').URL;

var DNS_TTL = 60000;
var DNS_FAIL_TTL = 2000;
var dnsCache = {};
var lookupImpl = null;

function stripBrackets(host) {
  var s = String(host || '');
  if (s.charAt(0) === '[' && s.charAt(s.length - 1) === ']') return s.slice(1, -1);
  return s;
}

function nameKey(host) {
  return String(host || '').toLowerCase().replace(/\.$/, '');
}

function nameBlocked(host) {
  var h = nameKey(host);
  if (!h || h.length > 253) return true;
  if (/[\s\x00-\x1f\\/%]/.test(h)) return true;
  if (h === 'localhost' || h === 'localhost.localdomain' || h === 'ip6-localhost' || h === 'ip6-loopback') return true;
  var suffixes = ['.localhost', '.local', '.localdomain', '.internal', '.intranet', '.home', '.lan', '.home.arpa', '.corp', '.localnet'];
  var i;
  for (i = 0; i < suffixes.length; i++) {
    var suf = suffixes[i];
    if (h.length > suf.length && h.lastIndexOf(suf) === h.length - suf.length) return true;
  }
  return false;
}

function parsePart(p) {
  var s = String(p || '');
  if (!/^(0x[0-9a-f]+|0+[0-7]*|[1-9][0-9]*)$/i.test(s)) return null;
  var n;
  if (/^0x/i.test(s)) n = parseInt(s, 16);
  else if (/^0[0-7]+$/.test(s)) n = parseInt(s, 8);
  else n = parseInt(s, 10);
  if (!isFinite(n) || n < 0) return null;
  return n;
}

// inet_aton forms, including the ones older URL parsers leave un-normalized:
// 127.0.0.1, 127.1, 2130706433, 0x7f.0.0.1, 0177.0.0.1.
function parseIPv4(host) {
  var s = nameKey(stripBrackets(host));
  if (!s || s.indexOf(':') >= 0) return null;
  if (!/^[0-9.]+$/.test(s) && !/^0x[0-9a-f.]+$/i.test(s) && s.indexOf('0x') < 0) return null;
  if (s.indexOf('0x') >= 0 && !/^0x[0-9a-f]+(\.0x[0-9a-f]+)*$/i.test(s) && !/^[0-9a-fx.]+$/i.test(s)) return null;
  var parts = s.split('.');
  if (!parts.length || parts.length > 4) return null;
  var nums = [];
  var i;
  for (i = 0; i < parts.length; i++) {
    var n = parsePart(parts[i]);
    if (n == null) return null;
    nums.push(n);
  }
  var ip = 0;
  if (nums.length === 1) {
    ip = nums[0];
  } else if (nums.length === 2) {
    if (nums[0] > 0xff || nums[1] > 0xffffff) return null;
    ip = (nums[0] * 16777216) + nums[1];
  } else if (nums.length === 3) {
    if (nums[0] > 0xff || nums[1] > 0xff || nums[2] > 0xffff) return null;
    ip = (nums[0] * 16777216) + (nums[1] * 65536) + nums[2];
  } else if (nums[0] > 0xff || nums[1] > 0xff || nums[2] > 0xff || nums[3] > 0xff) {
    return null;
  } else {
    ip = (nums[0] * 16777216) + (nums[1] * 65536) + (nums[2] * 256) + nums[3];
  }
  if (ip < 0 || ip > 0xffffffff) return null;
  return ip >>> 0;
}

function dotted(ip) {
  return ((ip >>> 24) & 255) + '.' + ((ip >>> 16) & 255) + '.' + ((ip >>> 8) & 255) + '.' + (ip & 255);
}

function ipv4Blocked(ip) {
  var a = (ip >>> 24) & 255;
  var b = (ip >>> 16) & 255;
  var c = (ip >>> 8) & 255;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT, not a public host
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function expandIPv6(host) {
  var s = nameKey(stripBrackets(host));
  if (s.indexOf(':') < 0) return null;
  var v4 = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    var ip4 = parseIPv4(v4[2]);
    if (ip4 == null) return null;
    var hi = (ip4 >>> 16) & 0xffff;
    var lo = ip4 & 0xffff;
    s = v4[1] + hi.toString(16) + ':' + lo.toString(16);
  }
  var halves = s.split('::');
  if (halves.length > 2) return null;
  var head = halves[0] ? halves[0].split(':') : [];
  var tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && head.length + tail.length > 7) return null;
  var missing = halves.length === 2 ? 8 - head.length - tail.length : 0;
  var parts = head;
  var z;
  for (z = 0; z < missing; z++) parts = parts.concat(['0']);
  if (halves.length === 2) parts = parts.concat(tail);
  if (parts.length !== 8) return null;
  var groups = [];
  var i;
  for (i = 0; i < parts.length; i++) {
    if (!/^[0-9a-f]{1,4}$/.test(parts[i])) return null;
    groups.push(parseInt(parts[i], 16));
  }
  return groups;
}

function ipv6Info(host) {
  var g = expandIPv6(host);
  if (!g) return null;
  var mapped = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff;
  if (mapped) {
    var ip4 = (g[6] * 65536) + g[7];
    return { address: dotted(ip4 >>> 0), family: 4, blocked: ipv4Blocked(ip4 >>> 0) };
  }
  var blocked = false;
  var allZero = true;
  var i;
  for (i = 0; i < 8; i++) if (g[i] !== 0) allZero = false;
  if (allZero || (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0 && g[6] === 0 && g[7] === 1)) blocked = true;
  if ((g[0] & 0xfe00) === 0xfc00) blocked = true; // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) blocked = true; // link local fe80::/10
  if ((g[0] & 0xff00) === 0xff00) blocked = true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) blocked = true; // documentation
  var address = stripBrackets(host).toLowerCase();
  return { address: address, family: 6, blocked: blocked };
}

function looksLikeIp(host) {
  var s = nameKey(stripBrackets(host));
  if (!s) return false;
  if (s.indexOf(':') >= 0) return true;
  if (/^[0-9.]+$/.test(s)) return true;
  if (s.indexOf('0x') >= 0) return true;
  return false;
}

function ipFromHost(host) {
  var v6 = ipv6Info(host);
  if (v6) return v6;
  var ip4 = parseIPv4(host);
  if (ip4 == null) return null;
  return { address: dotted(ip4), family: 4, blocked: ipv4Blocked(ip4) };
}

// kind: 'ip' | 'name' | 'bad'
function classifyHost(host) {
  var raw = stripBrackets(host);
  if (!raw || /[\s\x00-\x1f\\]/.test(raw)) return { kind: 'bad' };
  if (looksLikeIp(raw)) {
    var ip = ipFromHost(raw);
    if (!ip) return { kind: 'bad' };
    return { kind: 'ip', address: ip.address, family: ip.family, blocked: ip.blocked };
  }
  if (nameBlocked(raw)) return { kind: 'name', blocked: true };
  return { kind: 'name', blocked: false };
}

function rawAuthority(target) {
  var s = String(target || '').replace(/^\s+/, '');
  var m = /^[a-z][a-z0-9+.-]*:\/\//i.exec(s);
  if (!m) return '';
  s = s.slice(m[0].length);
  var cut = s.search(/[/?#]/);
  if (cut >= 0) s = s.slice(0, cut);
  var at = s.lastIndexOf('@');
  if (at >= 0) s = s.slice(at + 1);
  return s;
}

function hostFromAuthority(auth) {
  if (!auth) return '';
  if (auth.charAt(0) === '[') {
    var end = auth.indexOf(']');
    return end < 0 ? '' : auth.slice(1, end);
  }
  var colon = auth.lastIndexOf(':');
  if (colon >= 0 && auth.indexOf(':') === colon) return auth.slice(0, colon);
  return auth;
}

function familyOf(entry) {
  if (!entry) return 4;
  if (entry.family === 6 || entry.family === 'IPv6') return 6;
  return 4;
}

function lookupAll(host, cb) {
  var key = nameKey(host);
  var hit = dnsCache[key];
  if (hit && (Date.now() - hit.at) < hit.ttl) {
    cb(hit.err || null, hit.addrs || null);
    return;
  }
  var impl = lookupImpl || defaultLookup;
  impl(key, function (err, addrs) {
    dnsCache[key] = {
      at: Date.now(),
      ttl: err ? DNS_FAIL_TTL : DNS_TTL,
      err: err || null,
      addrs: addrs || null
    };
    cb(err, addrs);
  });
}

function defaultLookup(host, cb) {
  var done = false;
  var timer = setTimeout(function () {
    if (done) return;
    done = true;
    cb(new Error('dns timeout'));
  }, 4000);
  function finish(err, addrs) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    cb(err, addrs);
  }
  try {
    dns.lookup(host, { all: true }, function (err, addrs) {
      if (!err && addrs && addrs.length) { finish(null, addrs); return; }
      dns.lookup(host, function (err2, address, family) {
        if (err2 || !address) { finish(err2 || err || new Error('dns')); return; }
        finish(null, [{ address: address, family: family || 4 }]);
      });
    });
  } catch (e) {
    dns.lookup(host, function (err2, address, family) {
      if (err2 || !address) { finish(err2 || new Error('dns')); return; }
      finish(null, [{ address: address, family: family || 4 }]);
    });
  }
}

function chooseAddress(addrs) {
  var v4 = [];
  var v6 = [];
  var i;
  for (i = 0; i < addrs.length; i++) {
    var addr = addrs[i] && addrs[i].address;
    if (!addr) return null;
    var info = ipFromHost(addr);
    if (!info) return null;
    if (info.blocked) return null;
    if (info.family === 4) v4.push(info);
    else v6.push(info);
  }
  return v4[0] || v6[0] || null;
}

function describe(parsed, address, family) {
  var port = parseInt(parsed.port, 10);
  if (!port) port = parsed.protocol === 'https:' ? 443 : 80;
  var path = (parsed.pathname || '/') + (parsed.search || '');
  return {
    protocol: parsed.protocol,
    hostname: stripBrackets(parsed.hostname),
    port: port,
    path: path || '/',
    hostHeader: parsed.host,
    address: address,
    family: family
  };
}

function checkUrl(target, cb) {
  var rawHost = hostFromAuthority(rawAuthority(target));
  var parsed;
  try { parsed = new URL(String(target || '')); } catch (e) { cb(new Error('bad url')); return; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { cb(new Error('bad url')); return; }
  if (parsed.username || parsed.password) { cb(new Error('bad url')); return; }
  var host = stripBrackets(parsed.hostname);
  var parsedClass = classifyHost(host);
  var rawClass = rawHost ? classifyHost(rawHost) : null;
  if (parsedClass.kind === 'bad' || (rawClass && rawClass.kind === 'bad')) { cb(new Error('bad url')); return; }
  if (parsedClass.kind === 'name' && parsedClass.blocked) { cb(new Error('bad url')); return; }
  if (rawClass && rawClass.kind === 'name' && rawClass.blocked) { cb(new Error('bad url')); return; }
  if (parsedClass.kind === 'ip' || (rawClass && rawClass.kind === 'ip')) {
    if (parsedClass.kind === 'ip' && parsedClass.blocked) { cb(new Error('bad url')); return; }
    if (rawClass && rawClass.kind === 'ip' && rawClass.blocked) { cb(new Error('bad url')); return; }
    if (rawClass && rawClass.kind === 'ip' && parsedClass.kind === 'ip' && rawClass.address !== parsedClass.address) {
      cb(new Error('bad url'));
      return;
    }
    if (rawClass && rawClass.kind === 'ip' && parsedClass.kind !== 'ip') { cb(new Error('bad url')); return; }
    if (rawClass && rawClass.kind === 'name' && parsedClass.kind === 'ip') { cb(new Error('bad url')); return; }
    if (parsedClass.kind !== 'ip') { cb(new Error('bad url')); return; }
    cb(null, describe(parsed, parsedClass.address, parsedClass.family));
    return;
  }
  lookupAll(host, function (err, addrs) {
    if (err || !addrs || !addrs.length) { cb(new Error('bad url')); return; }
    var chosen = chooseAddress(addrs);
    if (!chosen) { cb(new Error('bad url')); return; }
    cb(null, describe(parsed, chosen.address, chosen.family));
  });
}

// Connect to the address we already classified. Host / SNI stay the playlist
// name so a name-based panel still answers. Certificate checks are off because
// IPTV panels routinely present a certificate that is self-signed, expired, or
// issued for a different name than the host in the URL (often a raw IP). The
// TV browser never sees this session; only the helper does. Checking those
// certificates drops playback for the providers this helper exists to reach.
function requestOptions(info, method, headers) {
  var h = {};
  var src = headers || {};
  Object.keys(src).forEach(function (k) {
    if (String(k).toLowerCase() === 'host') return;
    h[k] = src[k];
  });
  h.Host = info.hostHeader;
  var opts = {
    protocol: info.protocol,
    host: info.address,
    port: info.port,
    path: info.path || '/',
    method: method || 'GET',
    headers: h,
    rejectUnauthorized: false
  };
  if (info.protocol === 'https:' && info.hostname && !ipFromHost(info.hostname)) opts.servername = info.hostname;
  if (info.family === 6) opts.family = 6;
  return opts;
}

function setLookupForTests(fn) { lookupImpl = fn; }
function resetForTests() {
  dnsCache = {};
  lookupImpl = null;
}

module.exports = {
  checkUrl: checkUrl,
  classifyHost: classifyHost,
  requestOptions: requestOptions,
  nameBlocked: nameBlocked,
  ipv4Blocked: ipv4Blocked,
  parseIPv4: parseIPv4,
  _setLookup: setLookupForTests,
  _resetForTests: resetForTests
};
