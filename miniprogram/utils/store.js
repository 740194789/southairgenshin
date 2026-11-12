/* 离线数据层：所有数据存放在小程序本地缓存（wx storage），按游戏隔离 */

var gameLib = require('./game');
var checksum = require('./checksum');

var PER_PULL = 160;
var WISH_KEY = 'sg_wishes_';
var RES_KEY = 'sg_resource_';
var SEQ_KEY = 'sg_seq_';
var PITY_KEY = 'sg_pity_';

/* 各卡池保底上限，保存快照时按卡池截断 */
var PITY_CAPS = {
  genshin: { '角色活动': 90, '武器活动': 80, '集录祈愿': 90, '常驻': 90 },
  starrail: { '角色活动': 90, '光锥活动': 80, '联动': 90, '常驻': 90 }
};

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

/** 本地自然日 yyyy-MM-dd */
function dateStr(date) {
  var d = date || new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** 两个 yyyy-MM-dd 之间的整日差（to - from），解析失败返回 0 */
function daysBetween(fromText, toText) {
  var a = String(fromText || '').split('-');
  var b = String(toText || '').split('-');
  if (a.length !== 3 || b.length !== 3) {
    return 0;
  }
  var from = new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2]));
  var to = new Date(Number(b[0]), Number(b[1]) - 1, Number(b[2]));
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return 0;
  }
  return Math.round((to.getTime() - from.getTime()) / 86400000);
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
  var pool = String(source.pool || '');
  var pityCap = pool === '武器活动' || pool === '光锥活动' ? 80 : 90;
  return {
    id: id,
    game: game,
    uid: truncate(source.uid, 32),
    itemName: normalizeItemName(source.itemName, rarity),
    itemType: truncate(source.itemType, 16),
    pool: truncate(source.pool, 16),
    rarity: rarity,
    isUp: source.isUp === true,
    pityCount: clamp(source.pityCount, 1, pityCap, 1),
    wishTime: source.wishTime || nowStr(),
    note: truncate(source.note, 255),
    captureTriggered: source.captureTriggered === true
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

/* ---------------- 保底快照（对齐网页端 t_wish_pity） ---------------- */

/** 链接同步时的各卡池已垫抽数；比最新记录新才用于统计页 */
function getPitySnapshot(game) {
  var raw = wx.getStorageSync(PITY_KEY + game);
  if (!raw || typeof raw !== 'object' || !raw.pools) {
    return null;
  }
  return { pools: raw.pools, updatedAt: String(raw.updatedAt || '') };
}

function savePitySnapshot(game, pools, updatedAt) {
  var caps = PITY_CAPS[game] || {};
  var data = {};
  Object.keys(pools || {}).forEach(function (pool) {
    var value = Math.max(0, toInt(pools[pool]));
    data[pool] = caps[pool] ? Math.min(caps[pool], value) : value;
  });
  wx.setStorageSync(PITY_KEY + game, {
    updatedAt: updatedAt || nowStr(),
    pools: data
  });
}

function clearPitySnapshot(game) {
  try {
    wx.removeStorageSync(PITY_KEY + game);
  } catch (e) {
    // 无缓存时忽略
  }
}

function getResource(game) {
  var res = wx.getStorageSync(RES_KEY + game);
  if (!res || typeof res !== 'object') {
    res = {};
  }
  return accrueResource(game, {
    primogems: Math.max(0, toInt(res.primogems)),
    mora: Math.max(0, toInt(res.mora)),
    intertwinedFates: Math.max(0, toInt(res.intertwinedFates)),
    acquaintedFates: Math.max(0, toInt(res.acquaintedFates)),
    genesisCrystals: Math.max(0, toInt(res.genesisCrystals)),
    dailyPrimogems: Math.max(0, toInt(res.dailyPrimogems)),
    heroWit: Math.max(0, toInt(res.heroWit)),
    adventurerExp: Math.max(0, toInt(res.adventurerExp)),
    wandererAdvice: Math.max(0, toInt(res.wandererAdvice)),
    sanctifyingUnction: Math.max(0, toInt(res.sanctifyingUnction)),
    sanctifyingEssence: Math.max(0, toInt(res.sanctifyingEssence)),
    lastAccrualDate: String(res.lastAccrualDate || '')
  });
}

/** 按自然日把每日原石累加进资源；同一天重复读取不会重复累加。 */
function accrueResource(game, res) {
  var today = dateStr();
  if (!res.lastAccrualDate) {
    res.lastAccrualDate = today;
    return res;
  }
  var days = daysBetween(res.lastAccrualDate, today);
  if (days <= 0) {
    return res;
  }
  var daily = Math.max(0, toInt(res.dailyPrimogems));
  if (daily > 0) {
    res.primogems += daily * days;
  }
  res.lastAccrualDate = today;
  saveResource(game, res);
  return res;
}

function saveResource(game, res) {
  wx.setStorageSync(RES_KEY + game, {
    primogems: Math.max(0, toInt(res.primogems)),
    mora: Math.max(0, toInt(res.mora)),
    intertwinedFates: Math.max(0, toInt(res.intertwinedFates)),
    acquaintedFates: Math.max(0, toInt(res.acquaintedFates)),
    genesisCrystals: Math.max(0, toInt(res.genesisCrystals)),
    dailyPrimogems: clamp(res.dailyPrimogems, 0, 999999, 0),
    heroWit: Math.max(0, toInt(res.heroWit)),
    adventurerExp: Math.max(0, toInt(res.adventurerExp)),
    wandererAdvice: Math.max(0, toInt(res.wandererAdvice)),
    sanctifyingUnction: Math.max(0, toInt(res.sanctifyingUnction)),
    sanctifyingEssence: Math.max(0, toInt(res.sanctifyingEssence)),
    lastAccrualDate: String(res.lastAccrualDate || '')
  });
}

function updateResource(game, patch) {
  var next = getResource(game);
  ['primogems', 'mora', 'intertwinedFates', 'acquaintedFates', 'genesisCrystals',
    'heroWit', 'adventurerExp', 'wandererAdvice',
    'sanctifyingUnction', 'sanctifyingEssence'].forEach(function (key) {
    if (patch[key] !== undefined) {
      next[key] = Math.max(0, toInt(patch[key]));
    }
  });
  if (patch.dailyPrimogems !== undefined) {
    next.dailyPrimogems = clamp(patch.dailyPrimogems, 0, 999999, 0);
  }
  // 手动修改资产或每日额度后，从今天重新开始累积
  if (patch.primogems !== undefined || patch.dailyPrimogems !== undefined) {
    next.lastAccrualDate = dateStr();
  }
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
    uid: list[index].uid,
    itemName: data.itemName,
    itemType: data.itemType,
    pool: data.pool,
    rarity: data.rarity,
    isUp: data.isUp,
    pityCount: data.pityCount,
    wishTime: data.wishTime || list[index].wishTime,
    note: data.note,
    captureTriggered: data.captureTriggered !== undefined
      ? data.captureTriggered : list[index].captureTriggered
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

function pageWishes(game, pool, page, size, rarity, filters) {
  var extra = filters || {};
  var keyword = String(extra.keyword || '').trim().toLowerCase();
  var list = getWishes(game);
  if (pool) {
    list = list.filter(function (record) {
      return record.pool === pool;
    });
  }
  if (rarity) {
    list = list.filter(function (record) {
      return Number(record.rarity) === Number(rarity);
    });
  }
  if (extra.uid) {
    list = list.filter(function (record) {
      return (record.uid || '') === extra.uid;
    });
  }
  if (keyword) {
    list = list.filter(function (record) {
      return (record.itemName || '').toLowerCase().indexOf(keyword) >= 0;
    });
  }
  if (extra.start) {
    list = list.filter(function (record) {
      return (record.wishTime || '').slice(0, 10) >= extra.start;
    });
  }
  if (extra.end) {
    list = list.filter(function (record) {
      return (record.wishTime || '').slice(0, 10) <= extra.end;
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
    genesisCrystals: res.genesisCrystals || 0,
    primogemsPerPull: unit,
    pullsFromPrimogems: pulls,
    primogemsRemainder: res.primogems % unit,
    primogemsFromFates: res.intertwinedFates * unit,
    totalPulls: pulls + res.intertwinedFates,
    totalPrimogems: res.primogems + res.intertwinedFates * unit,
    dailyPrimogems: res.dailyPrimogems || 0,
    dailyPulls: Math.floor((res.dailyPrimogems || 0) / unit * 10) / 10,
    heroWit: res.heroWit || 0,
    adventurerExp: res.adventurerExp || 0,
    wandererAdvice: res.wandererAdvice || 0,
    sanctifyingUnction: res.sanctifyingUnction || 0,
    sanctifyingEssence: res.sanctifyingEssence || 0
  };
}

/* ---------------- 统计（移植 StatsService.java） ---------------- */

var POOL_DEFS = {
  genshin: [['角色活动', 90], ['武器活动', 80], ['集录祈愿', 90], ['常驻', 90]],
  starrail: [['角色活动', 90], ['光锥活动', 80], ['联动', 90], ['常驻', 90]]
};

/**
 * 抽卡统计：小保底不歪率、连歪 / 连不歪纪录、捕获明光次数与 UP 周期平均抽数。
 * 连歪 / 连不歪只按「小保底」统计；歪后紧跟的大保底 UP 不计入，也不打断连歪纪录。
 */
function luckStats(asc) {
  var softCount = 0;
  var softUp = 0;
  var lost = 0;
  var captures = 0;
  var curLoss = 0;
  var curUp = 0;
  var maxLoss = 0;
  var maxUp = 0;
  var guaranteed = false;
  var charCycle = 0;
  var charUps = 0;
  var charSum = 0;
  var weaponCycle = 0;
  var weaponUps = 0;
  var weaponSum = 0;

  asc.forEach(function (record) {
    if (record.rarity !== 5) {
      return;
    }
    var pity = record.pityCount || 0;
    var up = record.isUp === true;
    if (record.captureTriggered === true) {
      captures++;
    }
    if (record.pool === '角色活动') {
      charCycle += pity;
      if (up) {
        charSum += charCycle;
        charUps++;
        charCycle = 0;
      }
      if (guaranteed) {
        guaranteed = !up;
        return;
      }
      softCount++;
      if (up) {
        softUp++;
        curUp++;
        curLoss = 0;
        maxUp = Math.max(maxUp, curUp);
      } else {
        lost++;
        curLoss++;
        curUp = 0;
        maxLoss = Math.max(maxLoss, curLoss);
      }
      guaranteed = !up;
    } else if (record.pool === '武器活动' || record.pool === '光锥活动') {
      weaponCycle += pity;
      if (up) {
        weaponSum += weaponCycle;
        weaponUps++;
        weaponCycle = 0;
      }
    }
  });

  return {
    softCount: softCount,
    softUp: softUp,
    rate: softCount === 0 ? 0 : round1(softUp * 100 / softCount),
    lost: lost,
    maxLoss: maxLoss,
    maxUp: maxUp,
    captures: captures,
    charAvg: charUps === 0 ? 0 : round1(charSum / charUps),
    charUps: charUps,
    weaponAvg: weaponUps === 0 ? 0 : round1(weaponSum / weaponUps),
    weaponUps: weaponUps
  };
}

function overview(game) {
  var defs = POOL_DEFS[game] || POOL_DEFS.genshin;
  var asc = getWishes(game).slice().sort(ascCompare);
  var resource = resourceVO(getResource(game));
  var snapshot = getPitySnapshot(game);
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
    // 链接同步快照比本地最新记录新时，以游戏内实际已垫为准
    var snap = snapshot && snapshot.pools ? snapshot.pools[pool] : undefined;
    if (snap !== undefined
        && String(snapshot.updatedAt) > String(latest ? latest.wishTime : '')) {
      currentPity = Math.max(0, Math.min(cap, toInt(snap)));
    }

    var fatePoints = 0;
    if (game !== 'starrail' && pool === '武器活动') {
      asc.forEach(function (record) {
        if (record.pool !== pool || record.rarity !== 5) {
          return;
        }
        fatePoints = record.isUp === true ? 0 : Math.min(1, fatePoints + 1);
      });
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
      fatePoints: fatePoints,
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

  // 最近出货只展示五星
  var recent = asc.filter(function (record) {
    return record.rarity === 5;
  }).sort(descCompare).slice(0, 5);

  var luck = luckStats(asc);
  var result = {
    resource: resource,
    wishCount: wishCount,
    fiveStarWishes: fiveStarWishes,
    fourStarWishes: fourStarWishes,
    fiveStarRate: pitySum === 0 ? 0 : round1(fiveStarWishes * 100 / pitySum),
    avgFiveStarPity: fiveStarWishes === 0 ? 0 : round1(pitySum / fiveStarWishes),
    totalPulls: pitySum,
    softPityCount: luck.softCount,
    softPityUpCount: luck.softUp,
    softPityUpRate: luck.rate,
    lostCount: luck.lost,
    maxLossStreak: luck.maxLoss,
    maxUpStreak: luck.maxUp,
    captureTriggeredCount: luck.captures,
    characterUpAvgPity: luck.charAvg,
    characterUpSamples: luck.charUps,
    weaponUpAvgPity: luck.weaponAvg,
    weaponUpSamples: luck.weaponUps,
    avgPrimogemsPerUpCharacter: luck.charAvg > 0 ? Math.round(luck.charAvg * PER_PULL) : 0,
    avgPrimogemsPerUpWeapon: luck.weaponAvg > 0 ? Math.round(luck.weaponAvg * PER_PULL) : 0,
    poolDistribution: distribution,
    recentWishes: recent,
    fiveStarHistory: asc.filter(function (record) {
      return record.rarity === 5;
    }),
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
 * 导入抽卡记录：merge 模式按「UID + 名称 + 卡池 + 时间」去重；replace 模式清空后导入。
 * dryRun 只统计新增 / 跳过 / 忽略条数，不分配 ID、不写缓存，用于导入预演。
 */
function importRecords(game, records, mode, dryRun) {
  var replace = mode === 'replace';
  if (replace && !dryRun) {
    clearPitySnapshot(game);
  }
  var list = replace ? [] : getWishes(game);
  var existing = replace ? [] : list.slice();
  var seen = {};
  var imported = 0;
  var skipped = 0;
  var filtered = 0;
  var ids = dryRun ? [] : allocIds(game, records.length);
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
    var uid = truncate(source.uid, 32);
    var itemName = normalizeItemName(source.itemName, rarity);
    var pool = truncate(source.pool, 16);
    var wishTime = source.wishTime || nowStr();
    var key = uid + '\u0001' + itemName + '\u0001' + pool + '\u0001' + wishTime;
    var seenCount = seen[key] || 0;

    if (!replace) {
      var sameCount = 0;
      existing.forEach(function (record) {
        if ((record.uid || '') === uid && record.itemName === itemName
            && (record.pool || '') === pool && record.wishTime === wishTime) {
          sameCount++;
        }
      });
      if (sameCount > seenCount) {
        skipped++;
        seen[key] = seenCount + 1;
        return;
      }
    }

    if (dryRun) {
      imported++;
      seen[key] = seenCount + 1;
      return;
    }

    list.push(normalizeRecord({
      uid: uid,
      itemName: source.itemName,
      itemType: source.itemType,
      pool: source.pool,
      rarity: source.rarity,
      isUp: source.isUp,
      pityCount: source.pityCount,
      wishTime: wishTime,
      note: source.note,
      captureTriggered: source.captureTriggered === true
    }, game, ids[idIndex++]));
    imported++;
    seen[key] = seenCount + 1;
  });

  if (!dryRun) {
    saveWishes(game, list);
  }
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
  if (wishes.length) {
    clearPitySnapshot(game);
  }
  return importRecords(game, wishes, mode || 'merge');
}

function ownedForBackup(game) {
  var raw = wx.getStorageSync('sg_owned_' + game);
  return {
    characters4: (raw && raw.characters4) || {},
    characters5: (raw && raw.characters5) || {},
    weapons5: (raw && raw.weapons5) || {}
  };
}

/** 恢复手动补充：合并取较大值，覆盖直接用备份值 */
function applyOwnedBackup(game, incoming, mode) {
  if (!incoming || typeof incoming !== 'object') {
    return;
  }
  var replace = mode === 'replace';
  var base = replace
    ? { characters4: {}, characters5: {}, weapons5: {} }
    : ownedForBackup(game);
  var data = { characters4: {}, characters5: {}, weapons5: {} };
  ['characters4', 'characters5', 'weapons5'].forEach(function (key) {
    var source = incoming[key] || {};
    Object.keys(source).forEach(function (name) {
      var value = Math.max(0, toInt(source[name]));
      if (value > 0) {
        data[key][name] = replace ? value : Math.max(toInt(base[key][name]), value);
      }
    });
    if (!replace) {
      Object.keys(base[key] || {}).forEach(function (name) {
        if (!data[key][name]) {
          data[key][name] = toInt(base[key][name]);
        }
      });
    }
  });
  wx.setStorageSync('sg_owned_' + game, data);
}

function exportAllBackup() {
  // 与网页端 /api/backup/export-all 的结构一致：两个游戏一次打包
  var games = {};
  ['genshin', 'starrail'].forEach(function (game) {
    games[game] = {
      resource: getResource(game),
      wishes: exportRecords(game)
    };
  });
  var owned = {};
  ['genshin', 'starrail'].forEach(function (game) {
    owned[game] = ownedForBackup(game);
  });
  var payload = {
    app: 'SouthAir Genshin',
    version: 5,
    exportedAt: nowStr(),
    games: games,
    owned: owned
  };
  // 小程序自带 SHA-256 实现；网页端校验时会跳过非网页端生成的校验值
  payload.checksumApp = 'southair-mini';
  payload.checksum = checksum.compute(payload);
  return payload;
}

function importAllBackup(payload, mode) {
  var result = {
    mode: mode === 'replace' ? 'replace' : 'merge',
    imported: 0,
    skipped: 0,
    filtered: 0
  };
  if (!payload || typeof payload !== 'object' || !payload.games) {
    return result;
  }
  var check = checksum.verify(payload);
  if (!check.ok) {
    result.error = check.error;
    return result;
  }
  ['genshin', 'starrail'].forEach(function (game) {
    var item = payload.games[game];
    if (!item || typeof item !== 'object') {
      return;
    }
    if (item.resource && typeof item.resource === 'object') {
      saveResource(game, item.resource);
    }
    var wishes = Array.isArray(item.wishes) ? item.wishes : [];
    if (wishes.length) {
      clearPitySnapshot(game);
      var one = importRecords(game, wishes, mode);
      result.imported += one.imported;
      result.skipped += one.skipped;
      result.filtered += one.filtered;
    }
  });
  if (payload.owned && typeof payload.owned === 'object') {
    ['genshin', 'starrail'].forEach(function (game) {
      applyOwnedBackup(game, payload.owned[game], result.mode);
    });
  }
  return result;
}

/** 当前游戏里出现过的 UID 列表（去重、升序）。 */
function uids(game) {
  var seen = {};
  getWishes(game).forEach(function (record) {
    if (record.uid) {
      seen[record.uid] = true;
    }
  });
  return Object.keys(seen).sort();
}

function importResource(game, resource) {
  var patch = {};
  ['primogems', 'mora', 'intertwinedFates', 'acquaintedFates', 'genesisCrystals'].forEach(function (key) {
    if (resource && resource[key] !== undefined && resource[key] !== null) {
      patch[key] = resource[key];
    }
  });
  updateResource(game, patch);
  return getResource(game);
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
  importResource: importResource,
  resourceVO: resourceVO,
  overview: overview,
  uids: uids,
  importRecords: importRecords,
  getPitySnapshot: getPitySnapshot,
  savePitySnapshot: savePitySnapshot,
  clearPitySnapshot: clearPitySnapshot,
  exportBackup: exportBackup,
  importBackup: importBackup,
  exportAllBackup: exportAllBackup,
  importAllBackup: importAllBackup,
  normalizeItemName: normalizeItemName,
  nowStr: nowStr,
  fmt: fmt
};
