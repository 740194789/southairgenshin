/* 云同步（小程序端）
 *
 * 与电脑端互换数据：云端只保存密文，同步码本身不会上传。
 * 加密格式（两端必须一致）：
 *   同步码 → 大写去分隔符
 *   id       = SHA-256("southair-sync-v1|" + code + "|id") 前 32 位
 *   encKey   = SHA-256("southair-sync-v1|" + code + "|enc")
 *   macKey   = SHA-256("southair-sync-v1|" + code + "|mac")
 *   密文串    = "1.<iv 16 hex>.<base64(密文)>.<mac 32 hex>"
 *   密钥流    = SHA-256(encKey + "|" + iv + "|" + 序号) 的 32 字节
 *   mac      = SHA-256(macKey + "|" + iv + "|" + base64(密文)) 前 32 位
 *
 * 任何提示信息都不会包含同步码或明文数据。
 */

var checksum = require('./checksum');
var store = require('./store');

var CODE_KEY = 'sg_sync_code';
var META_KEY = 'sg_sync_meta';
var AUTO_KEY = 'sg_sync_auto';

var PREFIX = 'southair-sync-v1|';
var MAX_TEXT = 400 * 1024;
var ALPHABET_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{20,64}$/;

/* ---------------- 编码工具 ---------------- */

function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** 展示用：每 4 位加一个短横线，方便抄写 */
function prettyCode(code) {
  var text = normalizeCode(code);
  var groups = [];
  for (var i = 0; i < text.length; i += 4) {
    groups.push(text.substring(i, i + 4));
  }
  return groups.join('-');
}

function utf8Encode(text) {
  var bytes = [];
  for (var i = 0; i < text.length; i++) {
    var c = text.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      var next = text.charCodeAt(++i);
      var code = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return bytes;
}

function utf8Decode(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length;) {
    var b = bytes[i++];
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (b >= 0xc0 && b < 0xe0) {
      out += String.fromCharCode(((b & 31) << 6) | (bytes[i++] & 63));
    } else if (b >= 0xe0 && b < 0xf0) {
      out += String.fromCharCode(((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
    } else {
      var code = ((b & 7) << 18) | ((bytes[i++] & 63) << 12)
        | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 1023));
    }
  }
  return out;
}

var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var a = bytes[i];
    var b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    var c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64.charAt(a >> 2);
    out += B64.charAt(((a & 3) << 4) | (b >> 4));
    out += i + 1 < bytes.length ? B64.charAt(((b & 15) << 2) | (c >> 6)) : '=';
    out += i + 2 < bytes.length ? B64.charAt(c & 63) : '=';
  }
  return out;
}

function base64ToBytes(text) {
  var clean = String(text || '').replace(/[^A-Za-z0-9+/]/g, '');
  var bytes = [];
  for (var i = 0; i < clean.length; i += 4) {
    var c0 = clean.charAt(i);
    var c1 = clean.charAt(i + 1);
    var c2 = clean.charAt(i + 2);
    var c3 = clean.charAt(i + 3);
    // 注意：charAt 越界返回空串，而 indexOf('') 会返回 0，必须先判空
    var a = c0 ? B64.indexOf(c0) : -1;
    var b = c1 ? B64.indexOf(c1) : -1;
    var c = c2 ? B64.indexOf(c2) : -1;
    var d = c3 ? B64.indexOf(c3) : -1;
    if (a < 0 || b < 0) {
      break;
    }
    bytes.push((a << 2) | (b >> 4));
    if (c >= 0) {
      bytes.push(((b & 15) << 4) | (c >> 2));
    }
    if (d >= 0) {
      bytes.push(((c & 3) << 6) | d);
    }
  }
  return bytes;
}

function hexToBytes(text) {
  var bytes = [];
  for (var i = 0; i < text.length; i += 2) {
    bytes.push(parseInt(text.substring(i, i + 2), 16));
  }
  return bytes;
}

/* ---------------- 随机数 ---------------- */

var randomCounter = 0;

/** 8 字节随机数（16 位十六进制）；优先使用系统加密随机源 */
function randomHex(length) {
  var bytes = [];
  var cryptoApi = typeof crypto !== 'undefined' && crypto && crypto.getRandomValues ? crypto : null;
  if (cryptoApi) {
    var pool = new Uint8Array(length / 2);
    cryptoApi.getRandomValues(pool);
    for (var i = 0; i < pool.length; i++) {
      bytes.push(pool[i]);
    }
  } else {
    var seed = checksum.sha256([
      String(Date.now()),
      String(randomCounter++),
      String(Math.random()),
      String(Math.random())
    ].join('|'));
    for (var j = 0; j < length / 2; j++) {
      bytes.push(parseInt(seed.substring(j * 2, j * 2 + 2), 16));
    }
  }
  var hex = '';
  bytes.forEach(function (value) {
    hex += (value < 16 ? '0' : '') + value.toString(16);
  });
  return hex;
}

/* ---------------- 加解密 ---------------- */

function deriveKeys(code) {
  var base = PREFIX + normalizeCode(code);
  return {
    id: checksum.sha256(base + '|id').substring(0, 32),
    enc: checksum.sha256(base + '|enc'),
    mac: checksum.sha256(base + '|mac')
  };
}

function xorStream(input, encKey, iv) {
  var out = new Array(input.length);
  for (var offset = 0, index = 0; offset < input.length; offset += 32, index++) {
    var block = hexToBytes(checksum.sha256(encKey + '|' + iv + '|' + index));
    for (var i = 0; i < 32 && offset + i < input.length; i++) {
      out[offset + i] = input[offset + i] ^ block[i];
    }
  }
  return out;
}

function sign(macKey, iv, body) {
  return checksum.sha256(macKey + '|' + iv + '|' + body).substring(0, 32);
}

function encryptText(plainText, code) {
  var keys = deriveKeys(code);
  var iv = randomHex(16);
  var cipher = bytesToBase64(xorStream(utf8Encode(plainText), keys.enc, iv));
  return '1.' + iv + '.' + cipher + '.' + sign(keys.mac, iv, cipher);
}

function decryptText(blob, code) {
  var parts = String(blob || '').split('.');
  if (parts.length !== 4 || parts[0] !== '1') {
    throw new Error('云端数据格式不正确');
  }
  var keys = deriveKeys(code);
  var expected = sign(keys.mac, parts[1], parts[2]);
  if (expected !== parts[3]) {
    throw new Error('同步码不匹配或云端数据已损坏');
  }
  return utf8Decode(xorStream(base64ToBytes(parts[2]), keys.enc, parts[1]));
}

/* ---------------- 本地设置 ---------------- */

function getCode() {
  return normalizeCode(wx.getStorageSync(CODE_KEY));
}

function saveCode(code) {
  wx.setStorageSync(CODE_KEY, normalizeCode(code));
}

function getMeta() {
  var raw = wx.getStorageSync(META_KEY);
  return raw && typeof raw === 'object' ? raw : {};
}

function saveMeta(meta) {
  wx.setStorageSync(META_KEY, meta || {});
}

function clearLocal() {
  try {
    wx.removeStorageSync(CODE_KEY);
    wx.removeStorageSync(META_KEY);
  } catch (e) {
    /* 忽略 */
  }
}

function isAuto() {
  return wx.getStorageSync(AUTO_KEY) === true;
}

function setAuto(value) {
  wx.setStorageSync(AUTO_KEY, value === true);
}

/* ---------------- 云端调用 ---------------- */

function callCloud(data) {
  return new Promise(function (resolve, reject) {
    if (!wx.cloud) {
      reject(new Error('当前环境未启用云开发'));
      return;
    }
    wx.cloud.callFunction({
      name: 'syncStore',
      data: data,
      success: function (res) {
        var result = res && res.result;
        if (!result) {
          reject(new Error('云端返回为空'));
          return;
        }
        if (!result.ok) {
          var error = new Error(result.error || '云端同步失败');
          error.code = result.code || '';
          error.updatedAt = result.updatedAt;
          reject(error);
          return;
        }
        resolve(result);
      },
      fail: function (err) {
        var message = (err && err.errMsg) || '';
        if (/FunctionName|not found|FUNCTION_NOT_FOUND/i.test(message)) {
          reject(new Error('云函数 syncStore 尚未部署'));
          return;
        }
        reject(new Error('无法连接云端同步服务，请检查网络'));
      }
    });
  });
}

/* ---------------- 对外接口 ---------------- */

/** 生成新的同步码（由云函数用加密随机数生成，本地保存，不上传原文） */
function createCode() {
  return callCloud({ action: 'create' }).then(function (res) {
    saveCode(res.code);
    saveMeta({ updatedAt: 0, lastSyncAt: 0 });
    return res.code;
  });
}

/** 绑定已有同步码：只确认云端存在，不立即导数据 */
function bindCode(raw) {
  var code = normalizeCode(raw);
  if (!ALPHABET_PATTERN.test(code)) {
    return Promise.reject(new Error('同步码应为 20–64 位字母数字'));
  }
  return callCloud({ action: 'pull', code: code }).then(function (res) {
    if (!res.exists) {
      throw new Error('同步码不存在，请核对后重试');
    }
    saveCode(code);
    saveMeta({ updatedAt: res.updatedAt || 0, lastSyncAt: 0 });
    return { hasData: !!res.payload };
  });
}

function pullOnce(code) {
  return callCloud({ action: 'pull', code: code }).then(function (res) {
    if (!res.exists) {
      throw new Error('同步码不存在或已被删除');
    }
    var result = { updatedAt: res.updatedAt || 0, hasData: false, imported: 0, skipped: 0, filtered: 0 };
    if (!res.payload) {
      return result;
    }
    var payload = JSON.parse(decryptText(res.payload, code));
    var applied = store.importAllBackup(payload, 'merge');
    if (applied.error) {
      throw new Error(applied.error);
    }
    result.hasData = true;
    result.imported = applied.imported || 0;
    result.skipped = applied.skipped || 0;
    result.filtered = applied.filtered || 0;
    return result;
  });
}

function pushOnce(code, updatedAt) {
  return Promise.resolve().then(function () {
    var text = JSON.stringify(store.exportAllBackup());
    if (text.length > MAX_TEXT) {
      throw new Error('本地数据过大，暂时无法同步');
    }
    return callCloud({
      action: 'push',
      code: code,
      payload: encryptText(text, code),
      prevUpdatedAt: updatedAt || null
    });
  });
}

function attempt(code, allowRetry) {
  return pullOnce(code).then(function (pulled) {
    return pushOnce(code, pulled.updatedAt).then(function (pushed) {
      saveMeta({ updatedAt: pushed.updatedAt || 0, lastSyncAt: Date.now() });
      return {
        pulled: pulled.hasData,
        imported: pulled.imported,
        skipped: pulled.skipped,
        filtered: pulled.filtered,
        updatedAt: pushed.updatedAt || 0
      };
    }, function (err) {
      // 另一台设备刚推过：重新拉取合并后再推一次
      if (err && err.code === 'conflict' && allowRetry) {
        return attempt(code, false);
      }
      throw err;
    });
  });
}

/** 立即同步：先拉取云端并合并，再把合并后的本地数据推上去 */
function syncNow() {
  var code = getCode();
  if (!code) {
    return Promise.reject(new Error('请先生成或绑定同步码'));
  }
  return attempt(code, true);
}

/** 只上传：用本机数据覆盖云端（先读云端更新时间做并发校验） */
function uploadLocal() {
  var code = getCode();
  if (!code) {
    return Promise.reject(new Error('请先生成或绑定同步码'));
  }
  function push(allowRetry) {
    return callCloud({ action: 'pull', code: code }).then(function (res) {
      if (!res.exists) {
        throw new Error('同步码不存在或已被删除');
      }
      return pushOnce(code, res.updatedAt || 0).then(function (pushed) {
        saveMeta({ updatedAt: pushed.updatedAt || 0, lastSyncAt: Date.now() });
        return { updatedAt: pushed.updatedAt || 0 };
      }, function (err) {
        // 另一台设备刚好推过：重新读取更新时间后再覆盖一次
        if (err && err.code === 'conflict' && allowRetry) {
          return push(false);
        }
        throw err;
      });
    });
  }
  return push(true);
}

/** 解绑本机（云端密文保留，可用同步码重新绑定） */
function unbind() {
  clearLocal();
}

/** 删除云端密文并解绑 */
function deleteRemote() {
  var code = getCode();
  if (!code) {
    return Promise.reject(new Error('请先生成或绑定同步码'));
  }
  return callCloud({ action: 'delete', code: code }).then(function () {
    clearLocal();
  });
}

function status() {
  var code = getCode();
  var meta = getMeta();
  return {
    bound: !!code,
    code: code,
    pretty: code ? prettyCode(code) : '',
    lastSyncAt: meta.lastSyncAt || 0,
    remoteUpdatedAt: meta.updatedAt || 0,
    auto: isAuto()
  };
}

module.exports = {
  createCode: createCode,
  bindCode: bindCode,
  syncNow: syncNow,
  uploadLocal: uploadLocal,
  unbind: unbind,
  deleteRemote: deleteRemote,
  status: status,
  isAuto: isAuto,
  setAuto: setAuto,
  normalizeCode: normalizeCode,
  prettyCode: prettyCode
};
