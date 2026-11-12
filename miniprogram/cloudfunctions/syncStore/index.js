/**
 * 云函数 syncStore
 *
 * 小程序 ↔ 电脑端的加密中转：只按「同步码哈希」定位文档，文档里只放密文。
 * 不读取、不保存 openid / 昵称 / 设备信息；不打印同步码与数据内容。
 *
 * 集合：sync_data
 *   文档 _id = SHA-256(同步码) 前 32 位（云数据库里没有同步码原文）
 *   字段 payload = 密文（客户端端到端加密），rev = 版本号，updatedAt = 更新时间
 *
 * 支持两种调用方式：
 *   1. 小程序 wx.cloud.callFunction（event 直接带 action）
 *   2. 云开发「HTTP 访问服务」（event 带 httpMethod / body）
 */

var crypto = require('crypto');
var cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
var db = cloud.database();

var COLLECTION = 'sync_data';
var MAX_PAYLOAD = 900 * 1024;
var CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
var CODE_LENGTH = 24;
var CODE_PATTERN = new RegExp('^[' + CODE_ALPHABET + ']{20,64}$');

/* ---------------- 工具 ---------------- */

function hashCode(code) {
  return crypto.createHash('sha256').update('southair-sync-v1|' + code + '|id', 'utf8')
    .digest('hex').substring(0, 32);
}

function newCode() {
  var bytes = crypto.randomBytes(CODE_LENGTH);
  var text = '';
  for (var i = 0; i < CODE_LENGTH; i++) {
    // 256 / 32 整除，取模不会产生偏差
    text += CODE_ALPHABET.charAt(bytes[i] % CODE_ALPHABET.length);
  }
  return text;
}

function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function toMs(value) {
  if (!value) {
    return 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  var parsed = new Date(value).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

function isHttp(event) {
  return !!(event && (event.httpMethod || event.requestContext));
}

function respond(event, payload) {
  if (!isHttp(event)) {
    return payload;
  }
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, OPTIONS'
    },
    body: JSON.stringify(payload)
  };
}

function parseJson(text) {
  if (typeof text !== 'string') {
    return null;
  }
  var trimmed = text.trim();
  if (trimmed.charAt(0) !== '{') {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    return null;
  }
}

/**
 * HTTP 网关 / HTTP 访问服务 / 小程序 callFunction 的入参统一成对象。
 * 新版网关有时会把 JSON body 再做一次 base64，这里两种都兼容。
 */
function readEvent(event) {
  var data = event || {};
  var raw = data.body;
  if (Buffer.isBuffer(raw)) {
    raw = raw.toString('utf8');
  }
  if (typeof raw !== 'string' || !raw) {
    return data;
  }

  var parsed = parseJson(raw);
  if (!parsed && data.isBase64Encoded) {
    try {
      parsed = parseJson(Buffer.from(raw, 'base64').toString('utf8'));
    } catch (e) {
      parsed = null;
    }
  }
  if (!parsed && !data.isBase64Encoded) {
    try {
      parsed = parseJson(Buffer.from(raw, 'base64').toString('utf8'));
    } catch (e) {
      parsed = null;
    }
  }
  if (!parsed) {
    try {
      parsed = parseJson(decodeURIComponent(raw));
    } catch (e) {
      parsed = null;
    }
  }
  if (!parsed) {
    // 只带回请求体形态，不带任何内容，便于排查网关编码问题
    var detail = 'type=' + (Buffer.isBuffer(data.body) ? 'buffer' : typeof data.body)
      + '，长度=' + (typeof data.body === 'string' ? data.body.length : 0)
      + '，b64=' + (data.isBase64Encoded ? '1' : '0');
    throw new Error('请求内容不是有效的 JSON（' + detail + '）');
  }
  return parsed;
}

async function getDoc(id) {
  try {
    var res = await db.collection(COLLECTION).doc(id).get();
    return res && res.data ? res.data : null;
  } catch (e) {
    return null;
  }
}

/* ---------------- 业务 ---------------- */

async function create() {
  var code = newCode();
  var id = hashCode(code);
  var now = db.serverDate();
  try {
    await db.collection(COLLECTION).add({
      data: {
        _id: id,
        payload: '',
        rev: 0,
        createdAt: now,
        updatedAt: now
      }
    });
  } catch (e) {
    // 概率极低的重码：换一个再来一次
    code = newCode();
    id = hashCode(code);
    await db.collection(COLLECTION).add({
      data: {
        _id: id,
        payload: '',
        rev: 0,
        createdAt: now,
        updatedAt: now
      }
    });
  }
  return { ok: true, code: code };
}

async function pull(code) {
  var doc = await getDoc(hashCode(code));
  if (!doc) {
    return { ok: true, exists: false };
  }
  return {
    ok: true,
    exists: true,
    payload: doc.payload || '',
    rev: Number(doc.rev) || 0,
    updatedAt: toMs(doc.updatedAt)
  };
}

async function push(code, data) {
  var payload = typeof data.payload === 'string' ? data.payload : '';
  if (!payload) {
    return { ok: false, error: '同步内容为空' };
  }
  if (payload.length > MAX_PAYLOAD) {
    return { ok: false, error: '同步数据过大，请先精简记录' };
  }

  var id = hashCode(code);
  var doc = await getDoc(id);
  if (!doc) {
    return { ok: false, code: 'notfound', error: '同步码不存在，请重新生成或核对' };
  }

  var hasData = !!(doc.payload && String(doc.payload).length > 0);
  var prev = data.prevUpdatedAt === undefined || data.prevUpdatedAt === null
    ? null : Number(data.prevUpdatedAt);
  var current = toMs(doc.updatedAt);
  // 云端已有更新版本时拒绝写入，让客户端重新拉取合并后再推
  if (hasData && (prev === null || prev !== current)) {
    return { ok: false, code: 'conflict', updatedAt: current };
  }

  await db.collection(COLLECTION).doc(id).update({
    data: {
      payload: payload,
      rev: (Number(doc.rev) || 0) + 1,
      updatedAt: db.serverDate()
    }
  });

  var fresh = await getDoc(id);
  return {
    ok: true,
    rev: fresh ? Number(fresh.rev) || 0 : 0,
    updatedAt: fresh ? toMs(fresh.updatedAt) : Date.now()
  };
}

async function remove(code) {
  try {
    await db.collection(COLLECTION).doc(hashCode(code)).remove();
  } catch (e) {
    return { ok: true };
  }
  return { ok: true };
}

async function handle(event) {
  var data = readEvent(event);
  var action = String(data.action || '');

  if (!action) {
    return { ok: false, error: '缺少操作类型' };
  }
  if (action === 'create') {
    return await create();
  }

  var code = normalizeCode(data.code);
  if (!CODE_PATTERN.test(code)) {
    return { ok: false, error: '同步码格式不正确（20–64 位字母数字）' };
  }

  if (action === 'pull') {
    return await pull(code);
  }
  if (action === 'push') {
    return await push(code, data);
  }
  if (action === 'delete') {
    return await remove(code);
  }
  return { ok: false, error: '不支持的操作' };
}

exports.main = async function (event) {
  var httpMode = isHttp(event);
  if (httpMode && String((event && event.httpMethod) || '').toUpperCase() === 'OPTIONS') {
    return respond(event, { ok: true });
  }
  try {
    return respond(event, await handle(event));
  } catch (e) {
    var message = '云端同步失败，请稍后重试';
    if (e && e.message && e.message.indexOf('请求内容不是有效的 JSON') === 0) {
      message = e.message;
    } else if (e && /collection/i.test(e.message || '')) {
      message = '云数据库集合 sync_data 尚未创建';
    }
    return respond(event, { ok: false, error: message });
  }
};
