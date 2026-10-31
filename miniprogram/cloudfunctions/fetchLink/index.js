/**
 * 云函数 fetchLink
 *
 * 1. 普通模式：代小程序下载公网 JSON / CSV，供「链接导入」使用。
 * 2. gacha 模式：代小程序分页抓取米游社抽卡记录接口（原神 / 星穹铁道）。
 *
 * 小程序 wx.request 只能访问已配置的合法域名，云函数不受该限制。
 */

var https = require('https');
var http = require('http');

var MAX_BYTES = 5 * 1024 * 1024;
var TIMEOUT_MS = 12000;
var MAX_REDIRECT = 3;

/* ---------------- 通用下载 ---------------- */

function fetchText(url, redirectCount, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var target;
    try {
      target = new URL(url);
    } catch (e) {
      reject(new Error('链接格式不正确'));
      return;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      reject(new Error('只支持 http / https 链接'));
      return;
    }

    var lib = target.protocol === 'https:' ? https : http;
    var req = lib.get(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SouthAirGenshin/1.1',
        Accept: 'application/json,text/plain,*/*',
        'Accept-Encoding': 'identity'
      }
    }, function (res) {
      var status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if ((redirectCount || 0) >= MAX_REDIRECT) {
          reject(new Error('链接跳转次数过多'));
          return;
        }
        var next = new URL(res.headers.location, target).toString();
        fetchText(next, (redirectCount || 0) + 1, timeoutMs).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error('下载失败（HTTP ' + status + '）'));
        return;
      }

      var type = String(res.headers['content-type'] || '');
      if (type && !/json|text|octet-stream|plain|csv|excel/.test(type)) {
        res.resume();
        reject(new Error('链接不是文本或 JSON 文件'));
        return;
      }

      var size = 0;
      var chunks = [];
      res.on('data', function (chunk) {
        size += chunk.length;
        if (size > MAX_BYTES) {
          req.destroy();
          reject(new Error('文件超过 5MB，无法导入'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', function () {
        resolve({
          text: Buffer.concat(chunks).toString('utf8'),
          contentType: type,
          size: size
        });
      });
      res.on('error', reject);
    });

    req.setTimeout(timeoutMs || TIMEOUT_MS, function () {
      req.destroy(new Error('下载超时，请检查链接是否可访问'));
    });
    req.on('error', reject);
  });
}

/* ---------------- 米游社抽卡链接 ---------------- */

var ALLOWED_HOSTS = [
  'public-operation-hk4e.mihoyo.com',
  'public-operation-hkrpg.mihoyo.com',
  'public-operation-hk4e-sg.hoyoverse.com',
  'public-operation-hkrpg-sg.hoyoverse.com'
];

var WEB_HOSTS = [
  'webstatic.mihoyo.com',
  'webstatic.hoyoverse.com',
  'webstatic-sea.mihoyo.com',
  'webstatic-sea.hoyoverse.com'
];

var API_PARAMS = ['authkey', 'authkey_ver', 'sign_type', 'auth_appid', 'lang', 'region', 'game_biz'];

var GENSHIN_TYPES = [
  { type: '301', pool: '角色活动' },
  { type: '302', pool: '武器活动' },
  { type: '200', pool: '常驻' },
  { type: '400', pool: '集录祈愿' }
];

var STARRAIL_TYPES = [
  { type: '11', pool: '角色活动' },
  { type: '12', pool: '光锥活动' },
  { type: '21', pool: '联动' },
  { type: '22', pool: '联动' },
  { type: '1', pool: '常驻' }
];

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function parseGachaLink(rawUrl, game) {
  var url = String(rawUrl || '').trim();
  if (!url) {
    throw new Error('请填写抽卡记录链接');
  }
  var target;
  try {
    target = new URL(url);
  } catch (e) {
    throw new Error('链接格式不正确');
  }
  var host = target.hostname;
  var webLink = WEB_HOSTS.indexOf(host) >= 0;
  var apiLink = ALLOWED_HOSTS.indexOf(host) >= 0;
  if (!webLink && !apiLink) {
    throw new Error('链接不是米游社抽卡记录地址，请重新复制');
  }

  var starrailLink = webLink
    ? target.pathname.toLowerCase().indexOf('hkrpg') >= 0
    : host.indexOf('hkrpg') >= 0;
  var isStarrail = game === 'starrail';
  if (starrailLink !== isStarrail) {
    throw new Error(starrailLink
      ? '这是崩坏：星穹铁道的链接，请切换游戏后重试'
      : '这是原神的链接，请切换游戏后重试');
  }
  if (url.indexOf('authkey=') < 0) {
    throw new Error('链接中缺少 authkey，请在游戏内重新打开抽卡记录并复制');
  }

  return {
    url: url,
    starrail: starrailLink,
    webLink: webLink,
    host: host,
    pathname: target.pathname
  };
}

function buildApiBase(info) {
  var endpoint = info.starrail
    ? 'https://public-operation-hkrpg.mihoyo.com/common/gacha_record/api/getGachaLog'
    : 'https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog';

  var queryIndex = info.url.indexOf('?');
  var rawQuery = queryIndex < 0 ? '' : info.url.substring(queryIndex + 1);
  var kept = '';
  var hasGameBiz = false;
  rawQuery.split('&').forEach(function (pair) {
    if (!pair) {
      return;
    }
    var eq = pair.indexOf('=');
    var key = eq < 0 ? pair : pair.substring(0, eq);
    if (API_PARAMS.indexOf(key) < 0) {
      return;
    }
    if (key === 'game_biz') {
      hasGameBiz = true;
    }
    kept += (kept ? '&' : '') + pair;
  });
  if (!hasGameBiz) {
    kept += '&game_biz=' + (info.starrail ? 'hkrpg_cn' : 'hk4e_cn');
  }
  return endpoint + '?' + kept;
}

function buildApiBaseFromApiLink(info) {
  var queryIndex = info.url.indexOf('?');
  var base = queryIndex < 0 ? info.url : info.url.substring(0, queryIndex);
  var rawQuery = queryIndex < 0 ? '' : info.url.substring(queryIndex + 1);
  var kept = '';
  rawQuery.split('&').forEach(function (pair) {
    if (!pair) {
      return;
    }
    var eq = pair.indexOf('=');
    var key = eq < 0 ? pair : pair.substring(0, eq);
    if (key === 'gacha_type' || key === 'page' || key === 'size' || key === 'end_id') {
      return;
    }
    kept += (kept ? '&' : '') + pair;
  });
  return base + '?' + kept;
}

function retcodeMessage(code) {
  var messages = {
    '-101': 'authkey 已失效，请在游戏内重新打开抽卡记录并复制新链接',
    '-100': 'authkey 已失效，请在游戏内重新打开抽卡记录并复制新链接',
    '-109': 'authkey 已失效，请在游戏内重新打开抽卡记录并复制新链接',
    '-110': 'authkey 校验失败，请重新复制链接',
    '-111': '登录凭证无效，请重新复制链接',
    '-500001': '米游社接口繁忙，请稍后重试'
  };
  return messages[String(code)] || ('读取抽卡记录失败（错误码 ' + code + '）');
}

async function readGachaPage(url, timeoutMs) {
  var text = (await fetchText(url, 0, timeoutMs)).text;
  var root;
  try {
    root = JSON.parse(text);
  } catch (e) {
    throw new Error('米游社返回了无法解析的内容，请重新复制链接');
  }
  return root;
}

async function requestGachaPage(url, timeoutMs) {
  var root = await readGachaPage(url, timeoutMs);
  var code = Number(root && root.retcode);
  if (code === 0) {
    return root;
  }
  if (code === -110 || code === -101 || code === -100 || code === -109) {
    await sleep(600);
    root = await readGachaPage(url, timeoutMs);
    code = Number(root && root.retcode);
    if (code === 0) {
      return root;
    }
  }
  throw new Error(retcodeMessage(code));
}

async function fetchOnePage(base, type, pool, page, endId, timeoutMs) {
  var url = base + '&gacha_type=' + type + '&page=' + page + '&size=20&end_id=' + endId;
  var root = await requestGachaPage(url, timeoutMs);
  var list = (root && root.data && root.data.list) || [];
  var items = [];
  var lastId = endId;
  list.forEach(function (node) {
    var id = String(node.id || '');
    items.push({
      id: id,
      name: String(node.name || ''),
      itemType: String(node.item_type || ''),
      rarity: Number(node.rank_type) || 3,
      wishTime: String(node.time || ''),
      pool: pool
    });
    if (id) {
      lastId = id;
    }
  });
  return {
    items: items,
    lastId: lastId,
    hasMore: list.length >= 20 && lastId !== endId
  };
}

/**
 * 按云函数剩余超时自适应抓取：3 秒约 2–4 页，20 秒最多 30 页（600 抽）。
 * 客户端根据 hasMore / lastId / page 继续调用。
 */
async function handleGacha(event, context) {
  var info = parseGachaLink(event.url, event.game);
  var types = info.starrail ? STARRAIL_TYPES : GENSHIN_TYPES;
  var def = null;
  types.forEach(function (item) {
    if (item.type === String(event.gachaType)) {
      def = item;
    }
  });
  if (!def) {
    throw new Error('不支持的卡池类型');
  }

  var base = info.webLink ? buildApiBase(info) : buildApiBaseFromApiLink(info);
  var page = Math.max(1, Number(event.page) || 1);
  var endId = String(event.endId || '0');
  var items = [];
  var lastId = endId;
  var hasMore = true;

  var timeLimit = Number(context && context.time_limit_in_ms) || 3000;
  var deadline = Date.now() + Math.max(1200, timeLimit - 800);
  var maxPages = 30;

  for (var i = 0; i < maxPages; i++) {
    var remaining = deadline - Date.now();
    if (remaining < 1500) {
      hasMore = true;
      break;
    }
    var result;
    try {
      result = await fetchOnePage(base, def.type, def.pool, page, endId, Math.min(TIMEOUT_MS, remaining));
    } catch (e) {
      if (items.length > 0) {
        // 后续页失败时先返回已取到的数据，避免整次导入失败
        hasMore = true;
        break;
      }
      throw e;
    }
    items = items.concat(result.items);
    lastId = result.lastId;
    if (!result.hasMore) {
      hasMore = false;
      break;
    }
    endId = lastId;
    page += 1;
    if (i < maxPages - 1) {
      await sleep(120);
    }
  }

  return {
    ok: true,
    items: items,
    lastId: lastId,
    page: page,
    hasMore: hasMore,
    pool: def.pool
  };
}

/* ---------------- 入口 ---------------- */

exports.main = async function (event, context) {
  if (event && event.mode === 'gacha') {
    try {
      return await handleGacha(event, context);
    } catch (e) {
      return { ok: false, error: (e && e.message) || '读取抽卡记录失败' };
    }
  }

  var url = String((event && event.url) || '').trim();
  if (!url) {
    return { ok: false, error: '请填写链接' };
  }
  try {
    var data = await fetchText(url, 0);
    return {
      ok: true,
      text: data.text,
      contentType: data.contentType,
      size: data.size
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || '下载失败' };
  }
};
