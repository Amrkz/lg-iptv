// Salted PIN hash for parental control. Sync on purpose: the lock is checked
// on the remote's OK key, and this TV's Chromium has no async/await in our
// scripts. SHA-256 of a 4-digit PIN is not a password vault; it stops the PIN
// sitting in local storage and in a backup as plain digits.
var PinHash = (function () {
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function rotr(n, x) { return (x >>> n) | (x << (32 - n)); }

  function utf8(str) {
    var s = String(str);
    var out = [];
    var i;
    for (i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        var c2 = s.charCodeAt(++i);
        var u = ((c - 0xd800) * 1024) + (c2 - 0xdc00) + 0x10000;
        out.push(0xf0 | (u >> 18), 0x80 | ((u >> 12) & 0x3f), 0x80 | ((u >> 6) & 0x3f), 0x80 | (u & 0x3f));
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  function sha256(str) {
    var bytes = utf8(str);
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while ((bytes.length % 64) !== 56) bytes.push(0);
    var hi = Math.floor(bitLen / 0x100000000);
    var lo = bitLen >>> 0;
    var s;
    for (s = 3; s >= 0; s--) bytes.push((hi >>> (s * 8)) & 255);
    for (s = 3; s >= 0; s--) bytes.push((lo >>> (s * 8)) & 255);

    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var i;
    for (i = 0; i < bytes.length; i += 64) {
      var W = [];
      var t;
      for (t = 0; t < 16; t++) {
        var o = i + t * 4;
        W[t] = ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
      }
      for (t = 16; t < 64; t++) {
        var w15 = W[t - 15];
        var w2 = W[t - 2];
        var s0 = (rotr(7, w15) ^ rotr(18, w15) ^ (w15 >>> 3)) >>> 0;
        var s1 = (rotr(17, w2) ^ rotr(19, w2) ^ (w2 >>> 10)) >>> 0;
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = (rotr(6, e) ^ rotr(11, e) ^ rotr(25, e)) >>> 0;
        var ch = ((e & f) ^ ((~e) & g)) >>> 0;
        var temp1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
        var S0 = (rotr(2, a) ^ rotr(13, a) ^ rotr(22, a)) >>> 0;
        var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        var temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e;
        e = (d + temp1) >>> 0;
        d = c; c = b; b = a;
        a = (temp1 + temp2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var hex = '';
    for (i = 0; i < 8; i++) {
      var v = H[i];
      var n;
      for (n = 7; n >= 0; n--) hex += '0123456789abcdef'.charAt((v >>> (n * 4)) & 15);
    }
    return hex;
  }

  function hashPin(pin, salt) {
    return sha256(String(salt || '') + ':' + String(pin || ''));
  }

  return { sha256: sha256, hashPin: hashPin };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PinHash;
