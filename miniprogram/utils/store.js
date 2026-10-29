/* 数据层：本地缓存 + 多账号隔离 + 待同步删除墓碑
 *
 * 所有数据按「账号 + 游戏」存放，未登录时使用 anon 命名空间（离线可用）。
 * 抽卡记录用客户端生成的 clientUid 作为稳定标识，便于多端合并。
 */

var gameLib = require('./game');

var PER_PULL = 160;
var currentUserId = null;

/* ---------------- 账号 ---------------- */

function setUser(userId) {
  currentUserId = userId === null || userId === undefined || userId === '' ? null : String(userId);
}

function getUserKey() {
  return currentUserId || 'anon';
}

function key(prefix, game) {
  return 'sg_' + prefix + '_' + getUserKey() + '_' + game;
}

function newUid() {
  return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

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

function normalizeRecord(source, game, uid, editedAt) {
  var rarity = clamp(source.rarity, 1, 5, 3);
  return {
    clientUid: uid || source.clientUid || newUid(),
    game: game,
    itemName: normalizeItemName(source.itemName, rarity),
    itemType: truncate(source.itemType, 16),
    pool: truncate(source.pool, 16),
    rarity: rarity,
    isUp: source.isUp === true,
    pityCount: clamp(source.pityCount, 1, 180, 1),
    wishTime: source.wishTime || nowStr(),
    note: truncate(source.note, 255),
    editedAt: editedAt || toInt(source.editedAt) || Date.now()
  };
}

/* ---------------- 缓存读写 ---------------- */

function getWishes(game) {
  var list = wx.getStorageSync(key('wishes', game));
  return Array.isArray(list) ? list : [];
}

function saveWishes(game, list) {
  wx.setStorageSync(key('wishes', game), list);
}

function getTombstones(game) {
  var list = wx.getStorageSync(key('tomb', game));
  return Array.isArray(list) ? list : [];
}

function saveTombstones(game, list) {
  wx.setStorageSync(key('tomb', game), list);
}

function addTombstones(game, items) {
  var list = getTombstones(game);
  var byUid = {};
  list.forEach(function (item) {
    byUid[item.clientUid] = item;
  });
  (items || []).forEach(function (item) {
    var existing = byUid[item.clientUid];
    if (!existing || (item.editedAt || 0) >= (existing.editedAt || 0)) {
      byUid[item.clientUid] = {
        clientUid: item.clientUid,
        editedAt: item.editedAt || Date.now()
      };
    }
  });
  var next = Object.keys(byUid).map(function (uid) {
    return byUid[uid];
  });
  saveTombstones(game, next);
  return next;
}

function clearTombstones(game) {
  saveTombstones(game, []);
}

function getResource(game) {
  var res = wx.getStorageSync(key('resource', game));
  if (!res || typeof res !== 'object') {
    res = {};
  }
  return {
    primogems: Math.max(0, toInt(res.primogems)),
    mora: Math.max(0, toInt(res.mora)),
    intertwinedFates: Math.max(0, toInt(res.intertwinedFates)),
    acquaintedFates: Math.max(0, toInt(res.acquaintedFates)),
    editedAt: toInt(res.editedAt)
  };
}

function saveResource(game, res, editedAt) {
  wx.setStorageSync(key('resource', game), {
    primogems: Math.max(0, toInt(res.primogems)),
    mora: Math.max(0, toInt(res.mora)),
    intertwinedFates: Math.max(0, toInt(res.intertwinedFates)),
    acquaintedFates: Math.max(0, toInt(res.acquaintedFates)),
    editedAt: editedAt === undefined ? toInt(res.editedAt) : editedAt
  });
}

function updateResource(game, patch) {
  var next = getResource(game);
  ['primogems', 'mora', 'intertwinedFates', 'acquaintedFates'].forEach(function (item) {
    if (patch[item] !== undefined) {
      next[item] = Math.max(0, toInt(patch[item]));
    }
  });
  next.editedAt = Date.now();
  saveResource(game, next, next.editedAt);
  return next;
}

function getLastSync(game) {
  return wx.getStorageSync(key('synced', game)) || 0;
}

function setLastSync(game, time) {
  wx.setStorageSync(key('synced', game), time || Date.now());
}

/* ---------------- 抽卡记录 CRUD ---------------- */

function addWish(game, data) {
  var list = getWishes(game);
  var record = normalizeRecord(data, game, newUid(), Date.now());
  list.push(record);
  saveWishes(game, list);
  return record;
}

function addWishes(game, records) {
  var list = getWishes(game);
  var saved = [];
  var now = Date.now();
  (records || []).forEach(function (item) {
    var record = normalizeRecord(item, game, newUid(), now);
    list.push(record);
    saved.push(record);
  });
  saveWishes(game, list);
  return saved;
}

function updateWish(game, uid, data) {
  var list = getWishes(game);
  var index = -1;
  for (var i = 0; i < list.length; i++) {
    if (list[i].clientUid === uid) {
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
  }, game, uid, Date.now());
  list[index] = merged;
  saveWishes(game, list);
  return merged;
}

function deleteWishes(game, uids) {
  var targets = {};
  var now = Date.now();
  var tombstones = [];
  (uids || []).forEach(function (uid) {
    targets[uid] = true;
    tombstones.push({ clientUid: uid, editedAt: now });
  });
  var list = getWishes(game);
  var kept = list.filter(function (record) {
    return !targets[record.clientUid];
  });
  saveWishes(game, kept);
  addTombstones(game, tombstones);
  return list.length - kept.length;
}

function descCompare(a, b) {
  if (a.wishTime !== b.wishTime) {
    return a.wishTime < b.wishTime ? 1 : -1;
  }
  return a.clientUid < b.clientUid ? 1 : -1;
}

function ascCompare(a, b) {
  if (a.wishTime !== b.wishTime) {
    return a.wishTime < b.wishTime ? -1 : 1;
  }
  return a.clientUid < b.clientUid ? -1 : 1;
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

/* ---------------- 同步 ---------------- */

function syncPayload(game) {
  var resource = getResource(game);
  var records = getWishes(game).map(function (record) {
    return {
      clientUid: record.clientUid,
      itemName: record.itemName,
      itemType: record.itemType,
      pool: record.pool,
      rarity: record.rarity,
      isUp: record.isUp,
      pityCount: record.pityCount,
      wishTime: record.wishTime,
      note: record.note,
      editedAt: record.editedAt || 0
    };
  });
  var tombstones = getTombstones(game).map(function (item) {
    return {
      clientUid: item.clientUid,
      deleted: true,
      editedAt: item.editedAt || 0
    };
  });
  return {
    resource: resource,
    records: records.concat(tombstones)
  };
}

/**
 * 用服务端快照更新本地。
 *
 * <p>不是简单覆盖：同步请求发出后本地可能又产生了修改（编辑、删除），
 * 这里按 editedAt 取新，并保留「未参与本次上传」的本地记录与墓碑，等下一轮补传。</p>
 *
 * @param {Array<string>} sentRecords 本次上传的非删除记录 clientUid
 * @param {Array<string>} sentTombstones 本次上传的墓碑 clientUid
 */
function applySnapshot(game, snapshot, sentRecords, sentTombstones) {
  var source = snapshot || {};
  var sentRecordSet = {};
  (sentRecords || []).forEach(function (uid) {
    sentRecordSet[uid] = true;
  });
  var sentTombstoneSet = {};
  (sentTombstones || []).forEach(function (uid) {
    sentTombstoneSet[uid] = true;
  });
  var tombstoneSet = {};
  var tombstones = getTombstones(game);
  tombstones.forEach(function (item) {
    tombstoneSet[item.clientUid] = true;
  });

  var localByUid = {};
  getWishes(game).forEach(function (record) {
    localByUid[record.clientUid] = record;
  });

  var serverSet = {};
  var records = [];
  (source.records || []).forEach(function (item) {
    var uid = item.clientUid;
    if (!uid) {
      return;
    }
    serverSet[uid] = true;
    // 同步期间本地删除了这条记录：先移除，等待下一轮上传墓碑
    if (tombstoneSet[uid]) {
      return;
    }
    var local = localByUid[uid];
    if (local && (local.editedAt || 0) > (item.editedAt || 0)) {
      records.push(local);
    } else {
      records.push(normalizeRecord(item, game, uid, item.editedAt));
    }
  });

  // 本次上传后才创建的本地记录：服务端还没收到，保留在本地等补传
  Object.keys(localByUid).forEach(function (uid) {
    if (serverSet[uid] || sentRecordSet[uid] || tombstoneSet[uid]) {
      return;
    }
    records.push(localByUid[uid]);
  });
  saveWishes(game, records);

  if (source.resource && typeof source.resource === 'object') {
    var localRes = getResource(game);
    var incoming = source.resource;
    if ((localRes.editedAt || 0) > toInt(incoming.editedAt)) {
      saveResource(game, localRes, localRes.editedAt);
    } else {
      saveResource(game, incoming, toInt(incoming.editedAt));
    }
  }

  saveTombstones(game, tombstones.filter(function (item) {
    return !sentTombstoneSet[item.clientUid];
  }));
  setLastSync(game, source.serverTime || Date.now());
  return records.length;
}

/* ---------------- 旧版离线数据迁移 ---------------- */

var LEGACY_GAMES = ['genshin', 'starrail'];

function hasLegacyData() {
  for (var i = 0; i < LEGACY_GAMES.length; i++) {
    var game = LEGACY_GAMES[i];
    var oldWishes = wx.getStorageSync('sg_wishes_' + game);
    if (Array.isArray(oldWishes) && oldWishes.length) {
      return true;
    }
    var oldRes = wx.getStorageSync('sg_resource_' + game);
    if (oldRes && typeof oldRes === 'object') {
      return true;
    }
  }
  return false;
}

function hasOfflineData() {
  for (var i = 0; i < LEGACY_GAMES.length; i++) {
    var game = LEGACY_GAMES[i];
    var list = wx.getStorageSync('sg_wishes_anon_' + game);
    if (Array.isArray(list) && list.length) {
      return true;
    }
    var res = wx.getStorageSync('sg_resource_anon_' + game);
    if (res && typeof res === 'object'
        && (toInt(res.primogems) || toInt(res.mora)
          || toInt(res.intertwinedFates) || toInt(res.acquaintedFates))) {
      return true;
    }
  }
  return false;
}

/**
 * 把「未登录离线」命名空间下的数据并入当前账号。
 */
function migrateOfflineData() {
  var savedUser = currentUserId;
  currentUserId = null;
  var snapshots = LEGACY_GAMES.map(function (game) {
    return {
      game: game,
      wishes: getWishes(game),
      resource: getResource(game)
    };
  });
  LEGACY_GAMES.forEach(function (game) {
    wx.removeStorageSync(key('wishes', game));
    wx.removeStorageSync(key('resource', game));
    wx.removeStorageSync(key('tomb', game));
    wx.removeStorageSync(key('synced', game));
  });
  currentUserId = savedUser;

  var total = 0;
  snapshots.forEach(function (item) {
    if (item.wishes.length) {
      total += importRecords(item.game, item.wishes, 'merge').imported;
    }
    var current = getResource(item.game);
    var hasValue = current.primogems || current.mora
      || current.intertwinedFates || current.acquaintedFates;
    var res = item.resource;
    if (!hasValue && res && (res.primogems || res.mora || res.intertwinedFates || res.acquaintedFates)) {
      updateResource(item.game, res);
    }
  });
  return total;
}

/**
 * 把旧版（无账号）离线数据并入当前账号，返回导入条数。
 */
function migrateLegacy() {
  var total = 0;
  LEGACY_GAMES.forEach(function (game) {
    var oldWishes = wx.getStorageSync('sg_wishes_' + game);
    if (Array.isArray(oldWishes) && oldWishes.length) {
      var result = importRecords(game, oldWishes, 'merge');
      total += result.imported;
    }
    var oldRes = wx.getStorageSync('sg_resource_' + game);
    if (oldRes && typeof oldRes === 'object') {
      var current = getResource(game);
      if (current.primogems === 0 && current.mora === 0
          && current.intertwinedFates === 0 && current.acquaintedFates === 0) {
        saveResource(game, oldRes, Date.now());
      }
    }
    wx.removeStorageSync('sg_wishes_' + game);
    wx.removeStorageSync('sg_resource_' + game);
    wx.removeStorageSync('sg_seq_' + game);
  });
  return total;
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
    fiveStarRate: wishCount === 0 ? 0 : round1(fiveStarWishes * 100 / wishCount),
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
  var existing = getWishes(game);
  var list = replace ? [] : existing.slice();
  var seen = {};
  var imported = 0;
  var skipped = 0;
  var now = Date.now();

  if (replace) {
    // 覆盖导入前的删除也要同步到其他端，避免旧数据复活
    addTombstones(game, existing.map(function (record) {
      return { clientUid: record.clientUid, editedAt: now };
    }));
  }

  (records || []).forEach(function (source) {
    if (source === null || source === undefined) {
      return;
    }
    var rarity = clamp(source.rarity, 1, 5, 3);
    var itemName = normalizeItemName(source.itemName, rarity);
    var pool = truncate(source.pool, 16);
    var wishTime = source.wishTime || nowStr();
    var mark = itemName + '\u0001' + pool + '\u0001' + wishTime;
    var seenCount = seen[mark] || 0;

    if (!replace) {
      var sameCount = 0;
      existing.forEach(function (record) {
        if (record.itemName === itemName && (record.pool || '') === pool && record.wishTime === wishTime) {
          sameCount++;
        }
      });
      if (sameCount > seenCount) {
        skipped++;
        seen[mark] = seenCount + 1;
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
    }, game, source.clientUid || newUid(), source.editedAt || now));
    imported++;
    seen[mark] = seenCount + 1;
  });

  saveWishes(game, list);
  return {
    mode: replace ? 'replace' : 'merge',
    imported: imported,
    skipped: skipped
  };
}

function exportBackup(game) {
  return {
    version: 1,
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
    var current = getResource(game);
    var hasValue = current.primogems || current.mora
      || current.intertwinedFates || current.acquaintedFates;
    if (!hasValue) {
      updateResource(game, payload.resource);
    }
  }
  var wishes = Array.isArray(payload.wishes) ? payload.wishes : [];
  return importRecords(game, wishes, mode || 'merge');
}

module.exports = {
  PER_PULL: PER_PULL,
  setUser: setUser,
  getUserKey: getUserKey,
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
  fmt: fmt,
  syncPayload: syncPayload,
  applySnapshot: applySnapshot,
  getTombstones: getTombstones,
  addTombstones: addTombstones,
  getLastSync: getLastSync,
  setLastSync: setLastSync,
  hasLegacyData: hasLegacyData,
  migrateLegacy: migrateLegacy,
  hasOfflineData: hasOfflineData,
  migrateOfflineData: migrateOfflineData
};
