/* 图鉴在线更新：小程序直连公开数据源，合并角色头像与五星武器 / 光锥图标。
   数据来源：原神 Yatta（gi.yatta.moe）、星穹铁道 StarRailRes（jsDelivr），
   仅用于非商业个人记录；离线或请求失败时继续使用内置数据与上次缓存。 */

var avatars = require('./avatars');
var weaponIcons = require('./weaponIcons');
var net = require('./net');

var CACHE_KEY = 'sg_catalog_';
var CACHE_TTL = 24 * 3600 * 1000;

var SOURCES = {
  genshin: {
    domain: 'gi.yatta.moe',
    characters: 'https://gi.yatta.moe/api/v2/chs/avatar',
    weapons: 'https://gi.yatta.moe/api/v2/chs/weapon'
  },
  starrail: {
    domain: 'fastly.jsdelivr.net',
    characters: 'https://fastly.jsdelivr.net/gh/Mar-7th/StarRailRes@master/index_min/cn/characters.json',
    weapons: 'https://fastly.jsdelivr.net/gh/Mar-7th/StarRailRes@master/index_min/cn/light_cones.json'
  }
};

/* 崩铁图标同样走 StarRailRes（与数据源同一仓库，新角色 / 新光锥不会缺图） */
var STARRAIL_ASSETS = 'https://fastly.jsdelivr.net/gh/Mar-7th/StarRailRes@master/';

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function nowText() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
    + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/** 只新增缺失名称，保留内置的本地图标与已知可用地址，避免在线地址缺图时覆盖。 */
function mergeMap(target, source) {
  var added = 0;
  Object.keys(source || {}).forEach(function (name) {
    if (!target[name] && source[name]) {
      target[name] = source[name];
      added += 1;
    }
  });
  return added;
}

function yattaIcon(icon) {
  var text = String(icon || '').trim();
  if (!text) {
    return '';
  }
  return 'https://gi.yatta.moe/assets/UI/' + text + (/\.png$/i.test(text) ? '' : '.png');
}

function parseGenshinCharacters(root) {
  var map = {};
  var items = (root && root.data && root.data.items) || {};
  Object.keys(items).forEach(function (key) {
    var item = items[key] || {};
    var name = String(item.name || '').trim();
    var icon = yattaIcon(item.icon);
    if (name && icon && !map[name]) {
      map[name] = icon;
    }
  });
  return map;
}

function parseGenshinWeapons(root) {
  var map = {};
  var items = (root && root.data && root.data.items) || {};
  Object.keys(items).forEach(function (key) {
    var item = items[key] || {};
    if (Number(item.rank) !== 5) {
      return;
    }
    var name = String(item.name || '').trim();
    var icon = yattaIcon(item.icon);
    if (name && icon && !map[name]) {
      map[name] = icon;
    }
  });
  return map;
}

function parseStarRailCharacters(root) {
  var map = {};
  Object.keys(root || {}).forEach(function (id) {
    var item = root[id] || {};
    var name = String(item.name || '').trim();
    if (name && !map[name]) {
      map[name] = STARRAIL_ASSETS + 'icon/character/' + id + '.png';
    }
  });
  return map;
}

function parseStarRailWeapons(root) {
  var map = {};
  Object.keys(root || {}).forEach(function (id) {
    var item = root[id] || {};
    if (Number(item.rarity) !== 5) {
      return;
    }
    var name = String(item.name || '').trim();
    var icon = String(item.icon || '').trim().replace(/^\/+/, '');
    if (name && icon && !map[name]) {
      map[name] = STARRAIL_ASSETS + icon;
    }
  });
  return map;
}

function parse(game, charactersRoot, weaponsRoot) {
  return game === 'starrail'
    ? {
      characters: parseStarRailCharacters(charactersRoot),
      weapons: parseStarRailWeapons(weaponsRoot)
    }
    : {
      characters: parseGenshinCharacters(charactersRoot),
      weapons: parseGenshinWeapons(weaponsRoot)
    };
}

function readCache(game) {
  try {
    var cached = wx.getStorageSync(CACHE_KEY + game);
    if (cached && cached.data) {
      return cached;
    }
  } catch (e) {
    /* 读取失败按无缓存处理 */
  }
  return null;
}

/** 缓存是否仍在有效期内 */
function isFresh(game) {
  var cached = readCache(game);
  return !!cached && Date.now() - (Number(cached.savedAt) || 0) <= CACHE_TTL;
}

/** 把缓存合并进头像 / 武器图标；返回 { updatedAt, addedCharacters, addedWeapons } 或 null */
function applyCached(game) {
  var cached = readCache(game);
  if (!cached) {
    return null;
  }
  var data = cached.data || {};
  var charMap = avatars[game] || (avatars[game] = {});
  var weaponMap = weaponIcons[game] || (weaponIcons[game] = {});
  var addedCharacters = mergeMap(charMap, data.characters);
  var addedWeapons = mergeMap(weaponMap, data.weapons);
  return {
    updatedAt: cached.updatedAt || '',
    addedCharacters: addedCharacters,
    addedWeapons: addedWeapons
  };
}

/** 最近一次更新时间（即使已过期也返回），没有缓存时为空 */
function cachedAt(game) {
  var cached = readCache(game);
  return cached ? (cached.updatedAt || '') : '';
}

function requestError(err, game) {
  var message = String((err && err.errMsg) || '');
  if (message.indexOf('domain list') >= 0 || message.indexOf('合法域名') >= 0) {
    return new Error('未配置请求域名：请在微信后台 request 合法域名添加 '
      + (SOURCES[game] || SOURCES.genshin).domain);
  }
  return new Error('图鉴联网失败，请检查网络');
}

function getJson(url, game) {
  return new Promise(function (resolve, reject) {
    wx.request({
      url: url,
      method: 'GET',
      timeout: 15000,
      header: { Accept: 'application/json' },
      success: function (res) {
        if (res.statusCode !== 200) {
          reject(new Error('图鉴接口请求失败（HTTP ' + res.statusCode + '）'));
          return;
        }
        var body = res.data;
        if (typeof body === 'string') {
          try {
            body = JSON.parse(body);
          } catch (e) {
            reject(new Error('图鉴数据解析失败'));
            return;
          }
        }
        resolve(body);
      },
      fail: function (err) {
        if (!net.isDomainError(err && err.errMsg)) {
          reject(requestError(err, game));
          return;
        }
        /* 后台还没配好 request 合法域名时，用云函数代理再试一次 */
        net.proxyJson(url).then(resolve, function () {
          reject(requestError(err, game));
        });
      }
    });
  });
}

var inflight = {};

/**
 * 联网拉取两个数据源，合并到当前进程并写入 24 小时缓存。
 * 返回 Promise<{updatedAt, addedCharacters, addedWeapons}>；同一游戏并发调用复用请求。
 */
function refresh(game) {
  var key = game === 'starrail' ? 'starrail' : 'genshin';
  if (inflight[key]) {
    return inflight[key];
  }
  var source = SOURCES[key];
  inflight[key] = Promise.all([
    getJson(source.characters, key),
    getJson(source.weapons, key)
  ]).then(function (roots) {
    var data = parse(key, roots[0], roots[1]);
    var updatedAt = nowText();
    try {
      wx.setStorageSync(CACHE_KEY + key, { savedAt: Date.now(), updatedAt: updatedAt, data: data });
    } catch (e) {
      /* 存储失败时仍让本次会话生效 */
    }
    var charMap = avatars[key] || (avatars[key] = {});
    var weaponMap = weaponIcons[key] || (weaponIcons[key] = {});
    return {
      updatedAt: updatedAt,
      addedCharacters: mergeMap(charMap, data.characters),
      addedWeapons: mergeMap(weaponMap, data.weapons)
    };
  }).then(function (result) {
    inflight[key] = null;
    return result;
  }, function (err) {
    inflight[key] = null;
    throw err;
  });
  return inflight[key];
}

module.exports = {
  isFresh: isFresh,
  applyCached: applyCached,
  cachedAt: cachedAt,
  refresh: refresh,
  parse: parse,
  parseGenshinCharacters: parseGenshinCharacters,
  parseGenshinWeapons: parseGenshinWeapons,
  parseStarRailCharacters: parseStarRailCharacters,
  parseStarRailWeapons: parseStarRailWeapons
};
