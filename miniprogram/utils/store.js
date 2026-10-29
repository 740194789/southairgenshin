/* 离线数据层：所有数据存放在小程序本地缓存（wx storage），按游戏隔离 */

var gameLib = require('./game');

var PER_PULL = 160;
var WISH_KEY = 'sg_wishes_';
var RES_KEY = 'sg_resource_';
var SEQ_KEY = 'sg_seq_';

/* ---------------- 基础工具 ---------------- */

function toInt(value) {
  var n = Number(value);
  return isFinite(n) ? Math.floor(n) : 0;
}

function clamp(value, min, max, defaultValue) {
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }
  var n = Number(value);
  if (!isFinite(n)) {
    return defaultValue;
  }
  n = Math.floor(n);
  return Math.max(min, Math.min(max, n));
}

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function nowStr(date) {
  var d = date || new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function fmt(value) {
  var n = Number(value);
  if (!isFinite(n)) {
    n = 0;
  }
  var sign = n < 0 ? '-' : '';
  var text = String(Math.abs(Math.floor(n)));
  return sign + text.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function truncate(value, maxLength) {
  if (value === null || value === undefined) {
    return '';
  }
  var text = String(value);
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function normalizeItemName(name, rarity) {
  var text = name === null || name === undefined ? '' : String(name).trim();
  if (text) {
    return text.length <= 64 ? text : text.slice(0, 64);
  }
  var r = clamp(rarity, 1, 5, 3);
  if (r >= 5) {
    return '五星物品';
  }
  if (r === 4) {
    return '四星物品';
  }
  return '三星物品';
}

/** 记录规则：三星物品不记录；四星只记录角色；五星记录角色与武器 / 光锥。 */
function isRecordable(rarity, itemType) {
  var r = clamp(rarity, 1, 5, 0);
  if (r >= 5) {
    return true;
  }
  return r === 4 && String(itemType || '').trim() === '角色';
}

function normalizeRecord(source, game, id) {
  var rarity = clamp(source.rarity, 1, 5, 3);
  return {
    id: id,
    game: game,
    itemName: normalizeItemName(source.itemName, rarity),
    itemType: truncate(source.itemType, 16),
    pool: truncate(source.pool, 16),
    rarity: rarity,
    isUp: source.isUp === true,
    pityCount: clamp(source.pityCount, 1, 180, 1),
    wishTime: source.wishTime || nowStr(),
    note: truncate(source.note, 255)
  };
}

/* ---------------- 缓存读写 ---------------- */

function getWishes(game) {
  var list = wx.getStorageSync(WISH_KEY + game);
  return Array.isArray(list) ? list : [];
}

function saveWishes(game, list) {
  wx.setStorageSync(WISH_KEY + game, list);
}

function getResource(game) {
  var res = wx.getStorageSync(RES_KEY + game);
  if (!res || typeof res !== 'object') {
    res = {};
  }
  return {
    primogems: Math.max(0, toInt(res.primogems)),
    mora: Math.max(0, toInt(res.mora)),
    intertwinedFates: Math.max(0, toInt(res.intertwinedFates)),
    acquaintedFates: Math.max(0, toInt(res.acquaintedFates))
  };
}

function saveResource(game, res) {
  wx.setStorageSync(RES_KEY + game, {
    primogems: Math.max(0, toInt(res.primogems)),
    mora: Math.max(0, toInt(res.mora)),
    intertwinedFates: Math.max(0, toInt(res.intertwinedFates)),
    acquaintedFates: Math.max(0, toInt(res.acquaintedFates))
  });
}

function updateResource(game, patch) {
  var next = getResource(game);
  ['primogems', 'mora', 'intertwinedFates', 'acquaintedFates'].forEach(function (key) {
    if (patch[key] !== undefined) {
      next[key] = Math.max(0, toInt(patch[key]));
    }
  });
  saveResource(game, next);
  return next;
}

function allocIds(game, count) {
  var base = toInt(wx.getStorageSync(SEQ_KEY + game));
  var ids = [];
  for (var i = 1; i <= count; i++) {
    ids.push(base + i);
  }
  wx.setStorageSync(SEQ_KEY + game, base + count);
  return ids;
}

/* ---------------- 抽卡记录 CRUD ---------------- */

function addWish(game, data) {
  var list = getWishes(game);
  var record = normalizeRecord(data, game, allocIds(game, 1)[0]);
  list.push(record);
  saveWishes(game, list);
  return record;
}

function addWishes(game, records) {
  var list = getWishes(game);
  var ids = allocIds(game, records.length);
  var saved = records.map(function (item, index) {
    return normalizeRecord(item, game, ids[index]);
  });
  saveWishes(game, list.concat(saved));
  return saved;
}

function updateWish(game, id, data) {
  var list = getWishes(game);
  var index = -1;
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      index = i;
      break;
    }
  }
  if (index < 0) {
    return null;
  }
  var merged = normalizeRecord({
    itemName: data.itemName,
    itemType: data.itemType,
    pool: data.pool,
    rarity: data.rarity,
    isUp: data.isUp,
    pityCount: data.pityCount,
    wishTime: data.wishTime || list[index].wishTime,
    note: data.note
  }, game, id);
  list[index] = merged;
  saveWishes(game, list);
  return merged;
}

function deleteWishes(game, ids) {
  var targets = {};
  (ids || []).forEach(function (id) {
    targets[id] = true;
  });
  var list = getWishes(game);
  var kept = list.filter(function (record) {
    return !targets[record.id];
  });
  saveWishes(game, kept);
  return list.length - kept.length;
}

function descCompare(a, b) {
  if (a.wishTime !== b.wishTime) {
    return a.wishTime < b.wishTime ? 1 : -1;
  }
  return b.id - a.id;
}

function ascCompare(a, b) {
  if (a.wishTime !== b.wishTime) {
    return a.wishTime < b.wishTime ? -1 : 1;
  }
  return a.id - b.id;
}

function pageWishes(game, pool, page, size) {
  var list = getWishes(game);
  if (pool) {
    list = list.filter(function (record) {
      return record.pool === pool;
    });
  }
  list = list.slice().sort(descCompare);
  var pageSize = size || 10;
  var total = list.length;
  var pages = Math.max(1, Math.ceil(total / pageSize));
  var current = Math.min(Math.max(page || 1, 1), pages);
  var start = (current - 1) * pageSize;
  return {
    records: list.slice(start, start + pageSize),
    total: total,
    page: current,
    pages: pages
  };
}

function exportRecords(game) {
  return getWishes(game).slice().sort(ascCompare);
}

/* ---------------- 资源换算 ---------------- */

function resourceVO(res) {
  var unit = PER_PULL;
  var pulls = Math.floor(res.primogems / unit);
  return {
    primogems: res.primogems,
    mora: res.mora,
    intertwinedFates: res.intertwinedFates,
    acquaintedFates: res.acquaintedFates,
    primogemsPerPull: unit,
    pullsFromPrimogems: pulls,
    primogemsRemainder: res.primogems % unit,
    primogemsFromFates: res.intertwinedFates * unit,
    totalPulls: pulls + res.intertwinedFates,
    totalPrimogems: res.primogems + res.intertwinedFates * unit
  };
}

/* ---------------- 统计（移植 StatsService.java） ---------------- */

var POOL_DEFS = {
  genshin: [['角色活动', 90], ['武器活动', 80], ['集录祈愿', 90], ['常驻', 90]],
  starrail: [['角色活动', 90], ['光锥活动', 80], ['常驻', 90]]
};

function overview(game) {
  var defs = POOL_DEFS[game] || POOL_DEFS.genshin;
  var asc = getWishes(game).slice().sort(ascCompare);
  var resource = resourceVO(getResource(game));
  var wishCount = asc.length;
  var fiveStarWishes = 0;
  var fourStarWishes = 0;
  var pitySum = 0;

  asc.forEach(function (record) {
    if (record.rarity === 5) {
      fiveStarWishes++;
      pitySum += record.pityCount || 0;
    } else if (record.rarity === 4) {
      fourStarWishes++;
    }
  });

  var poolStats = defs.map(function (def) {
    var pool = def[0];
    var cap = def[1];
    var count = 0;
    var five = 0;
    var poolPitySum = 0;
    var latest = null;
    var latestFive = null;

    asc.forEach(function (record) {
      if (record.pool !== pool) {
        return;
      }
      count++;
      latest = record;
      if (record.rarity === 5) {
        five++;
        poolPitySum += record.pityCount || 0;
        latestFive = record;
      }
    });

    var currentPity = 0;
    if (latest) {
      currentPity = latest.rarity === 5 ? 0 : (latest.pityCount || 0);
    }

    return {
      pool: pool,
      cap: cap,
      currentPity: currentPity,
      pullsToPity: Math.max(cap - currentPity, 0),
      wishCount: count,
      fiveStarCount: five,
      avgFiveStarPity: five === 0 ? 0 : round1(poolPitySum / five),
      upGuaranteed: pool !== '常驻' && latestFive !== null && latestFive.isUp !== true,
      percent: cap > 0 ? Math.min(100, Math.round(currentPity / cap * 100)) : 0
    };
  });

  var distribution = [];
  defs.forEach(function (def) {
    var value = 0;
    asc.forEach(function (record) {
      if (record.pool === def[0]) {
        value++;
      }
    });
    if (value > 0) {
      distribution.push({ name: def[0], value: value });
    }
  });

  var recent = asc.slice().sort(descCompare).slice(0, 5);

  var result = {
    resource: resource,
    wishCount: wishCount,
    fiveStarWishes: fiveStarWishes,
    fourStarWishes: fourStarWishes,
    fiveStarRate: pitySum === 0 ? 0 : round1(fiveStarWishes * 100 / pitySum),
    avgFiveStarPity: fiveStarWishes === 0 ? 0 : round1(pitySum / fiveStarWishes),
    poolDistribution: distribution,
    recentWishes: recent,
    poolStats: poolStats
  };

  if (game !== 'starrail') {
    var capture = captureInfo(asc);
    result.captureLossCount = capture.losses;
    result.captureNextUpRate = capture.rate;
    result.captureRemaining = Math.max(0, 3 - capture.losses);
    result.captureGuaranteed = capture.losses >= 3;
    result.characterFiveStarWishes = capture.fives;
    result.characterUpWishes = capture.upCount;
    result.characterUpRate = capture.fives === 0 ? 0 : round1(capture.upCount * 100 / capture.fives);
  }
  return result;
}

/**
 * 原神「捕获明光」：角色活动池连续未中 UP 的五星累积进度，连续 3 次歪后下一次必定 UP。
 */
function captureInfo(asc) {
  var fives = asc.filter(function (record) {
    return record.pool === '角色活动' && record.rarity === 5;
  });
  var losses = 0;
  var upCount = 0;
  var lastWasLoss = false;

  fives.forEach(function (record) {
    var up = record.isUp === true;
    if (up) {
      upCount++;
      if (lastWasLoss) {
        if (losses >= 3) {
          losses = 0;
        }
      } else {
        losses = 0;
      }
      lastWasLoss = false;
    } else {
      losses++;
      lastWasLoss = true;
    }
  });

  var rate;
  if (losses >= 3) {
    rate = 100;
  } else if (losses === 2) {
    rate = 75;
  } else if (losses === 1) {
    rate = 55;
  } else {
    rate = 50;
  }

  return {
    losses: losses,
    rate: rate,
    fives: fives.length,
    upCount: upCount
  };
}

/* ---------------- 导入 / 导出 ---------------- */

/**
 * 导入抽卡记录：merge 模式按「名称 + 卡池 + 时间」去重；replace 模式清空后导入。
 */
function importRecords(game, records, mode) {
  var replace = mode === 'replace';
  var list = replace ? [] : getWishes(game);
  var existing = replace ? [] : list.slice();
  var seen = {};
  var imported = 0;
  var skipped = 0;
  var filtered = 0;
  var ids = allocIds(game, records.length);
  var idIndex = 0;

  records.forEach(function (source) {
    if (source === null || source === undefined) {
      return;
    }
    var rarity = clamp(source.rarity, 1, 5, 3);
    if (!isRecordable(rarity, source.itemType)) {
      filtered++;
      return;
    }
    var itemName = normalizeItemName(source.itemName, rarity);
    var pool = truncate(source.pool, 16);
    var wishTime = source.wishTime || nowStr();
    var key = itemName + '\u0001' + pool + '\u0001' + wishTime;
    var seenCount = seen[key] || 0;

    if (!replace) {
      var sameCount = 0;
      existing.forEach(function (record) {
        if (record.itemName === itemName && (record.pool || '') === pool && record.wishTime === wishTime) {
          sameCount++;
        }
      });
      if (sameCount > seenCount) {
        skipped++;
        seen[key] = seenCount + 1;
        return;
      }
    }

    list.push(normalizeRecord({
      itemName: source.itemName,
      itemType: source.itemType,
      pool: source.pool,
      rarity: source.rarity,
      isUp: source.isUp,
      pityCount: source.pityCount,
      wishTime: wishTime,
      note: source.note
    }, game, ids[idIndex++]));
    imported++;
    seen[key] = seenCount + 1;
  });

  saveWishes(game, list);
  return {
    mode: replace ? 'replace' : 'merge',
    imported: imported,
    skipped: skipped,
    filtered: filtered
  };
}

function exportBackup(game) {
  // 与网页端 /api/backup/export 的 JSON 结构保持一致，可直接互相导入
  return {
    app: 'SouthAir Genshin',
    version: 4,
    game: game,
    exportedAt: nowStr(),
    resource: getResource(game),
    wishes: exportRecords(game)
  };
}

function importBackup(game, payload, mode) {
  if (!payload || typeof payload !== 'object') {
    return { imported: 0, skipped: 0, mode: mode };
  }
  if (payload.resource && typeof payload.resource === 'object') {
    saveResource(game, payload.resource);
  }
  var wishes = Array.isArray(payload.wishes) ? payload.wishes : [];
  return importRecords(game, wishes, mode || 'merge');
}

module.exports = {
  PER_PULL: PER_PULL,
  getWishes: getWishes,
  addWish: addWish,
  addWishes: addWishes,
  updateWish: updateWish,
  deleteWishes: deleteWishes,
  pageWishes: pageWishes,
  exportRecords: exportRecords,
  getResource: getResource,
  updateResource: updateResource,
  resourceVO: resourceVO,
  overview: overview,
  importRecords: importRecords,
  exportBackup: exportBackup,
  importBackup: importBackup,
  normalizeItemName: normalizeItemName,
  nowStr: nowStr,
  fmt: fmt
};
