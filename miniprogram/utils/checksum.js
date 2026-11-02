/* 备份文件 SHA-256 校验：先做键名排序的规范化 JSON，再计算 SHA-256。
   小程序没有 crypto API，这里自带 UTF-8 编码与 SHA-256 实现。
   只校验带 checksumApp = 'southair-mini' 的文件，网页端或其他工具的备份直接跳过。 */

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

function rotr(value, amount) {
  return (value >>> amount) | (value << (32 - amount));
}

function utf8Bytes(text) {
  var bytes = [];
  for (var i = 0; i < text.length; i++) {
    var c = text.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      var c2 = text.charCodeAt(++i);
      var code = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return bytes;
}

/** SHA-256（返回 64 位小写十六进制） */
function sha256(text) {
  var bytes = utf8Bytes(String(text || ''));
  var bitLength = bytes.length * 8;
  var padded = bytes.slice();
  padded.push(0x80);
  while (padded.length % 64 !== 56) {
    padded.push(0);
  }
  for (var i = 7; i >= 0; i--) {
    padded.push(i >= 4 ? 0 : (bitLength >>> (8 * i)) & 0xff);
  }

  var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var w = new Array(64);
  for (var offset = 0; offset < padded.length; offset += 64) {
    for (var t = 0; t < 16; t++) {
      var p = offset + t * 4;
      w[t] = (padded[p] << 24) | (padded[p + 1] << 16) | (padded[p + 2] << 8) | padded[p + 3];
    }
    for (var n = 16; n < 64; n++) {
      var s0 = rotr(w[n - 15], 7) ^ rotr(w[n - 15], 18) ^ (w[n - 15] >>> 3);
      var s1 = rotr(w[n - 2], 17) ^ rotr(w[n - 2], 19) ^ (w[n - 2] >>> 10);
      w[n] = (w[n - 16] + s0 + w[n - 7] + s1) >>> 0;
    }
    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (var m = 0; m < 64; m++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      var ch = (e & f) ^ (~e & g);
      var temp1 = (hh + S1 + ch + K[m] + w[m]) >>> 0;
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  var out = '';
  h.forEach(function (value) {
    var hex = value.toString(16);
    while (hex.length < 8) {
      hex = '0' + hex;
    }
    out += hex;
  });
  return out;
}

/** 规范化 JSON：对象键排序、数组保持顺序、紧凑输出 */
function canonical(value) {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']';
  }
  if (typeof value === 'object') {
    var keys = Object.keys(value).sort();
    return '{' + keys.map(function (key) {
      return JSON.stringify(key) + ':' + canonical(value[key]);
    }).join(',') + '}';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return isFinite(value) ? String(value) : 'null';
  }
  return JSON.stringify(value);
}

/** 计算校验值（忽略 payload.checksum） */
function compute(payload) {
  var copy = {};
  Object.keys(payload || {}).forEach(function (key) {
    if (key !== 'checksum') {
      copy[key] = payload[key];
    }
  });
  return sha256(canonical(copy));
}

/** 校验备份；非本机生成的备份直接通过。返回 { ok, error } */
function verify(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: true };
  }
  if (payload.checksumApp !== 'southair-mini' || !payload.checksum) {
    return { ok: true };
  }
  var expected = compute(payload);
  if (expected.toLowerCase() !== String(payload.checksum).toLowerCase()) {
    return { ok: false, error: '备份文件校验失败：SHA-256 不一致，文件可能被修改或损坏' };
  }
  return { ok: true };
}

module.exports = {
  sha256: sha256,
  canonical: canonical,
  compute: compute,
  verify: verify
};
