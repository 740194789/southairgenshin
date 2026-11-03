var app = getApp();
var store = require('../../utils/store');
var gameLib = require('../../utils/game');
var file = require('../../utils/file');
var uigf = require('../../utils/uigf');
var avatars = require('../../utils/avatars');
var weaponIcons = require('../../utils/weaponIcons');
var calendarLib = require('../../utils/calendar');

/** 记录对应的头像 / 图标，缺失时返回空字符串 */
function itemIcon(game, item) {
  var name = (item && item.itemName) || '';
  var avatarMap = avatars[game] || {};
  var weaponMap = weaponIcons[game] || {};
  return avatarMap[name] || weaponMap[name] || '';
}

function starText(rarity) {
  var count = Math.max(0, Math.min(5, Number(rarity) || 0));
  var text = '';
  for (var i = 0; i < count; i++) {
    text += '★';
  }
  return text;
}

function guaranteeText(pool) {
  if (pool === '集录祈愿') {
    return '命定值满 · 下次必定定轨物品';
  }
  if (pool === '武器活动') {
    return '命定值满 · 下次必定定轨武器';
  }
  return '大保底 · 下次必定 UP';
}

/** 卡池筛选按钮：全部 + 有五星记录的卡池，按游戏配置顺序排列。 */
function chartPoolOptions(list, game) {
  var g = gameLib.config(game);
  var seen = {};
  (list || []).forEach(function (item) {
    seen[item.pool || '未知卡池'] = true;
  });
  var options = [{ key: 'all', label: '全部' }];
  var known = [];
  (g.pools || []).forEach(function (pool) {
    if (seen[pool]) {
      known.push(pool);
    }
  });
  Object.keys(seen).forEach(function (pool) {
    if (known.indexOf(pool) < 0) {
      known.push(pool);
    }
  });
  known.forEach(function (pool) {
    options.push({ key: pool, label: gameLib.poolLabel(pool) });
  });
  return options;
}

/** 保底面板跟随同一个卡池筛选：全部时展示所有卡池，否则只看选中的卡池。 */
function filterPools(pools, pool) {
  if (!pool || pool === 'all') {
    return pools || [];
  }
  return (pools || []).filter(function (item) {
    return item.pool === pool;
  });
}

/**
 * 五星抽数柱形图：real 为 true 时隐藏歪的记录，按 UP 周期累计真实抽数。
 * 周期按卡池分别累计，避免角色池与武器 / 光锥池混算。
 * pool 为 'all' 时展示全部卡池，否则只展示该卡池。
 */
function buildChart(list, real, pool, game) {
  var all = list || [];
  var selected = pool && pool !== 'all'
    ? all.filter(function (item) {
      return (item.pool || '未知卡池') === pool;
    })
    : all;
  var scope = pool && pool !== 'all' ? pool + '：' : '';
  var points = [];
  var total = 0;

  if (real) {
    var cycles = {};
    selected.forEach(function (item) {
      var poolName = item.pool || '未知卡池';
      var acc = (cycles[poolName] || 0) + (item.pityCount || 0);
      if (item.isUp === true) {
        points.push({ name: item.itemName || '未命名', value: acc, up: true, icon: itemIcon(game, item) });
        acc = 0;
      }
      cycles[poolName] = acc;
    });
  } else {
    points = selected.map(function (item) {
      return {
        name: item.itemName || '未命名',
        value: item.pityCount || 0,
        up: item.isUp === true,
        icon: itemIcon(game, item)
      };
    });
  }

  var max = 1;
  // 记录按时间升序参与周期累计，展示时最新的一根在上
  points.reverse();
  points.forEach(function (point) {
    max = Math.max(max, point.value);
  });
  points.forEach(function (point) {
    point.percent = Math.max(4, Math.round(point.value / max * 100));
    total += point.value;
  });

  var hidden = selected.filter(function (item) {
    return item.isUp !== true;
  }).length;

  return {
    points: points,
    total: total,
    summary: scope + (real
      ? '已隐藏 ' + hidden + ' 次歪的记录 · 抽到 UP 一共用了 ' + total + ' 抽（含歪掉的抽数'
        + (scope ? '' : '，按卡池分别累计') + '）'
      : '共 ' + points.length + ' 次五星，合计 ' + total + ' 抽；深色柱为歪掉的五星')
  };
}

/* ---------------- 抽卡期望 ---------------- */

var EXPECT_KEY = 'sg_expect_';

/* 官方 / 社区通行估算值，与网页端保持一致 */
var EXPECT_MODEL = {
  fiveStarAvg: 62.5,
  weaponFiveStarAvg: 53.3,
  genshinCharUpRate: 0.55,
  starrailCharUpRate: 0.5,
  starrailWeaponUpRate: 0.75,
  genshinWeaponFives: 2
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * 把五星记录按卡池累计成「UP 周期」样本：从上次 UP 到这次 UP 一共花了多少抽
 * （含中间歪掉的五星），与网页端、后端口径一致。
 */
function upCycleSamples(records, pools) {
  var cycles = [];
  var acc = 0;
  (records || []).forEach(function (record) {
    if (pools.indexOf(record.pool) < 0) {
      return;
    }
    acc += Number(record.pityCount) || 0;
    if (record.isUp === true) {
      if (acc > 0) {
        cycles.push(acc);
      }
      acc = 0;
    }
  });
  return cycles;
}

/** 线性插值分位数，用于从往期样本得到区间。 */
function percentile(values, p) {
  if (!values.length) {
    return 0;
  }
  var sorted = values.slice().sort(function (a, b) {
    return a - b;
  });
  if (sorted.length === 1) {
    return sorted[0];
  }
  var index = (sorted.length - 1) * p;
  var low = Math.floor(index);
  var high = Math.ceil(index);
  var weight = index - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

/** 把上下限渲染成「A–B」或单个数（上下限相同时）。 */
function rangeText(low, high) {
  var lo = Math.max(0, Math.round(low));
  var hi = Math.max(lo, Math.round(high));
  return hi > lo ? store.fmt(lo) + '–' + store.fmt(hi) : store.fmt(lo);
}

function expectPrefs(game) {
  var raw = null;
  try {
    raw = wx.getStorageSync(EXPECT_KEY + game);
  } catch (e) {
    raw = null;
  }
  raw = raw && typeof raw === 'object' ? raw : {};
  var days = raw.days === undefined ? 21 : Number(raw.days);
  return {
    c: clamp(Number(raw.c) || 0, 0, 6),
    r: clamp(Number(raw.r) || 0, 0, 5),
    mode: raw.mode === 'theory' ? 'theory' : 'history',
    days: isFinite(days) ? clamp(Math.round(days), 0, 365) : 21
  };
}

function saveExpectPrefs(game, prefs) {
  try {
    wx.setStorageSync(EXPECT_KEY + game, prefs);
  } catch (e) {
    /* 忽略存储失败 */
  }
}

function poolStatOf(list, pool) {
  var items = list || [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].pool === pool) {
      return items[i];
    }
  }
  return null;
}

/**
 * 目标（角色 c 命 + 武器 r 精炼）的抽数期望。
 * theory：按平均五星抽数与 UP 概率推算单点期望；
 * history：用往期 UP 周期样本的 25%–75% 分位得到区间。
 * 首个 UP 会先抵扣当前保底进度；已有大保底时首个 UP 只需一个五星。
 */
function buildExpectation(data, game, prefs) {
  var g = gameLib.config(game);
  var isSR = game === 'starrail';
  var charPool = poolStatOf(data.poolStats, g.charPool);
  var weaponPool = poolStatOf(data.poolStats, g.weaponPool);
  var charPity = charPool ? Math.max(0, charPool.currentPity || 0) : 0;
  var weaponPity = weaponPool ? Math.max(0, weaponPool.currentPity || 0) : 0;
  var charGuaranteed = !!(charPool && charPool.upGuaranteed);
  var weaponGuaranteed = !!(weaponPool && weaponPool.upGuaranteed);

  var charRate = isSR ? EXPECT_MODEL.starrailCharUpRate : EXPECT_MODEL.genshinCharUpRate;
  var charUnitTheory = EXPECT_MODEL.fiveStarAvg * (1 + (1 - charRate));
  var weaponUnitTheory = isSR
    ? EXPECT_MODEL.weaponFiveStarAvg * (1 + (1 - EXPECT_MODEL.starrailWeaponUpRate))
    : EXPECT_MODEL.weaponFiveStarAvg * EXPECT_MODEL.genshinWeaponFives;

  var charSamples = Number(data.characterUpSamples) || 0;
  var weaponSamples = Number(data.weaponUpSamples) || 0;
  var charCycles = upCycleSamples(data.fiveStarHistory, [g.charPool]);
  var weaponCycles = upCycleSamples(data.fiveStarHistory, [g.weaponPool]);
  var historyReady = charCycles.length >= 2 && data.characterUpAvgPity > 0;
  var useHistory = prefs.mode === 'history' && historyReady;
  var weaponHistory = useHistory && weaponCycles.length >= 2 && data.weaponUpAvgPity > 0;

  var charUnitLow;
  var charUnitHigh;
  if (useHistory) {
    charUnitLow = percentile(charCycles, 0.25);
    charUnitHigh = percentile(charCycles, 0.75);
  } else {
    charUnitLow = charUnitTheory;
    charUnitHigh = charUnitTheory;
  }

  var weaponUnitLow;
  var weaponUnitHigh;
  if (weaponHistory) {
    weaponUnitLow = percentile(weaponCycles, 0.25);
    weaponUnitHigh = percentile(weaponCycles, 0.75);
  } else {
    weaponUnitLow = weaponUnitTheory;
    weaponUnitHigh = weaponUnitTheory;
  }

  var charFirstLow = Math.max(1, (charGuaranteed ? EXPECT_MODEL.fiveStarAvg : charUnitLow) - charPity);
  var charFirstHigh = Math.max(1, (charGuaranteed ? EXPECT_MODEL.fiveStarAvg : charUnitHigh) - charPity);
  var charCostLow = charFirstLow + prefs.c * charUnitLow;
  var charCostHigh = charFirstHigh + prefs.c * charUnitHigh;

  var weaponCostLow = 0;
  var weaponCostHigh = 0;
  if (prefs.r > 0) {
    var weaponFirstLow = Math.max(1, (weaponGuaranteed ? EXPECT_MODEL.weaponFiveStarAvg : weaponUnitLow)
      - weaponPity);
    var weaponFirstHigh = Math.max(1, (weaponGuaranteed ? EXPECT_MODEL.weaponFiveStarAvg : weaponUnitHigh)
      - weaponPity);
    weaponCostLow = weaponFirstLow + (prefs.r - 1) * weaponUnitLow;
    weaponCostHigh = weaponFirstHigh + (prefs.r - 1) * weaponUnitHigh;
  }

  var totalLow = Math.max(1, Math.round(charCostLow + weaponCostLow));
  var totalHigh = Math.max(1, Math.round(charCostHigh + weaponCostHigh));
  var isRange = totalHigh > totalLow;
  var available = data.resource.totalPulls || 0;
  var currencyPerPull = data.resource.primogemsPerPull || 160;
  var enough = available >= totalHigh;
  var percent = Math.min(100, Math.round(available / totalHigh * 100));
  var weaponWord = isSR ? '光锥' : '武器';

  var compareText;
  if (enough) {
    compareText = '当前可抽 ' + store.fmt(available) + ' 抽 · 已足够（按区间上限），余 '
      + store.fmt(available - totalHigh) + ' 抽';
  } else if (available >= totalLow) {
    compareText = '当前可抽 ' + store.fmt(available) + ' 抽 · 已达到区间下限，按上限还差 '
      + store.fmt(totalHigh - available) + ' 抽（约 '
      + store.fmt((totalHigh - available) * currencyPerPull) + ' ' + g.currency + '）';
  } else {
    var gapLow = totalLow - available;
    var gapHigh = totalHigh - available;
    compareText = '当前可抽 ' + store.fmt(available) + ' 抽 · 还差 '
      + (isRange ? store.fmt(gapLow) + '–' + store.fmt(gapHigh) : store.fmt(gapLow)) + ' 抽（约 '
      + (isRange
        ? store.fmt(gapLow * currencyPerPull) + '–' + store.fmt(gapHigh * currencyPerPull)
        : store.fmt(gapLow * currencyPerPull))
      + ' ' + g.currency + '）';
  }

  var sourceNote;
  if (useHistory) {
    sourceNote = '往期区间：角色 UP 共 ' + charSamples + ' 次，单次 UP '
      + rangeText(charUnitLow, charUnitHigh) + ' 抽（25%–75% 分位）';
    if (prefs.r > 0) {
      sourceNote += weaponHistory
        ? ' · ' + weaponWord + ' UP 共 ' + weaponSamples + ' 次，单次 '
          + rangeText(weaponUnitLow, weaponUnitHigh) + ' 抽'
        : ' · ' + weaponWord + '样本不足 2 次，改用理论值';
    }
  } else {
    sourceNote = isSR
      ? '理论模型：角色池五星平均 62.5 抽、UP 基础 50%；光锥池五星平均 53.3 抽、UP 75%，歪后大保底。'
      : '理论模型：角色池五星平均 62.5 抽、UP 综合 55%（含捕获明光）；'
        + '武器池五星平均 53.3 抽、定轨约需 2 个五星。';
  }

  var pityNote = '已扣除当前保底进度：' + gameLib.poolLabel(g.charPool) + ' ' + charPity + ' / '
    + (charPool ? charPool.cap : 90)
    + (prefs.r > 0 ? '，' + gameLib.poolLabel(g.weaponPool) + ' ' + weaponPity + ' / '
      + (weaponPool ? weaponPool.cap : 80) : '')
    + (charGuaranteed ? ' · 角色池大保底' : '')
    + (weaponGuaranteed && prefs.r > 0 ? ' · 武器池大保底' : '') + '。';

  var dailyPrimogems = Math.max(0, Math.round(Number(data.resource.dailyPrimogems) || 0));
  var dailyPulls = dailyPrimogems / currencyPerPull;
  var income = Math.round(dailyPulls * prefs.days * 10) / 10;
  var projected = Math.round((available + income) * 10) / 10;
  var gapHigh = Math.max(0, totalHigh - projected);
  var gapLow = Math.max(0, totalLow - projected);
  var planPercent = totalHigh > 0 ? Math.min(100, Math.round(projected / totalHigh * 100)) : 100;
  var planEnough = projected >= totalHigh;
  var planText;
  if (planEnough) {
    planText = '到期预计 ' + store.fmt(projected) + ' 抽，已达到区间上限，余 '
      + store.fmt(projected - totalHigh) + ' 抽';
  } else if (projected >= totalLow) {
    planText = '到期预计 ' + store.fmt(projected) + ' 抽，达到区间下限，距上限还差 '
      + store.fmt(gapHigh) + ' 抽';
  } else {
    planText = '到期预计 ' + store.fmt(projected) + ' 抽，还差 '
      + (gapHigh > gapLow ? store.fmt(gapLow) + '–' + store.fmt(gapHigh) : store.fmt(gapHigh)) + ' 抽';
  }
  var planAdvice;
  if (gapHigh > 0) {
    var parts = [];
    if (prefs.days > 0) {
      parts.push('每天需攒 ' + store.fmt(Math.ceil(gapHigh * currencyPerPull / prefs.days)) + ' ' + g.currency);
    }
    if (dailyPrimogems > 0) {
      var needDays = Math.ceil(gapHigh * currencyPerPull / dailyPrimogems);
      var eta = new Date(Date.now() + needDays * 86400000);
      parts.push('还需 ' + needDays + ' 天（约 ' + eta.getFullYear() + '-'
        + ('0' + (eta.getMonth() + 1)).slice(-2) + '-' + ('0' + eta.getDate()).slice(-2) + '）');
    }
    planAdvice = parts.join(' · ');
  } else {
    planAdvice = '保持当前节奏即可，不必额外投入。';
  }

  return {
    c: prefs.c,
    r: prefs.r,
    historyOn: useHistory,
    historyReady: historyReady,
    targetName: 'C' + prefs.c + (prefs.r > 0 ? ' + R' + prefs.r : ''),
    totalText: rangeText(totalLow, totalHigh),
    isRange: isRange,
    enough: enough,
    percent: percent,
    compareText: compareText,
    charLabel: '角色 C' + prefs.c,
    charCostText: rangeText(charCostLow, charCostHigh) + ' 抽',
    charUpText: (prefs.c + 1) + ' 个 UP',
    charNote: prefs.c === 0 ? '仅本体，不追命座' : '本体 + ' + prefs.c + ' 命',
    weaponLabel: prefs.r > 0 ? weaponWord + ' R' + prefs.r : weaponWord,
    weaponCostText: prefs.r > 0 ? rangeText(weaponCostLow, weaponCostHigh) + ' 抽' : '—',
    weaponUpText: prefs.r > 0 ? prefs.r + ' 把 UP' : '未选择',
    weaponNote: prefs.r === 0 ? '不抽' + weaponWord : '本体 + ' + (prefs.r - 1) + ' 把精炼',
    sourceNote: sourceNote,
    pityNote: pityNote,
    rangeNote: useHistory
      ? '区间取往期 UP 周期的 25%–75% 分位，约一半情况落在此范围。'
      : '理论值为单点估算，约一半概率在期望抽数内达成。',
    planner: {
      dailyPrimogems: dailyPrimogems,
      dailyPrimogemsText: store.fmt(dailyPrimogems),
      dailyPullsText: String(Math.round(dailyPulls * 10) / 10),
      currency: g.currency,
      days: prefs.days,
      incomeText: String(income),
      projectedText: store.fmt(projected),
      availableText: store.fmt(available),
      percent: planPercent,
      enough: planEnough,
      statusText: planText,
      adviceText: planAdvice
    }
  };
}

/** 卡池名称：实时日历来自官方公告，内置日历只有卡池类型 */
function bannerNames(banners) {
  var names = [];
  (banners || []).forEach(function (banner) {
    var name = typeof banner === 'string' ? '' : (banner && banner.name);
    if (name && names.indexOf(name) < 0) {
      names.push(name);
    }
  });
  return names.join(' · ');
}

/** 卡池日历：仅原神有官方公告实时数据，星铁不显示日历 */
function buildCalendar(game, unit) {
  if (game !== 'genshin') {
    return null;
  }
  var live = calendarLib.loadLive(game);
  var info = live ? calendarLib.infoOf(live) : calendarLib.info(game);
  function row(item) {
    if (!item) {
      return null;
    }
    var income = Number(item.phase.incomePrimogems) || 0;
    return {
      version: item.version,
      name: item.phase.name || '',
      start: item.phase.start,
      end: item.phase.end,
      left: Math.max(0, calendarLib.daysUntil(item.phase.end)),
      hasIncome: income > 0,
      incomeText: store.fmt(income),
      pullsText: String(Math.round(income / unit * 10) / 10),
      bannersText: bannerNames(item.phase.banners)
    };
  }
  return {
    live: !!live,
    updatedAt: info.calendar.updatedAt || '',
    note: info.calendar.note || '',
    current: row(info.current),
    next: row(info.next)
  };
}

Page({
  data: {
    statusBarHeight: 20,
    game: 'genshin',
    g: gameLib.config('genshin'),
    statsTab: 'overview',
    statsTabs: [
      { key: 'overview', label: '概览' },
      { key: 'pity', label: '保底分析' },
      { key: 'expect', label: '期望' },
      { key: 'resource', label: '资源' }
    ],
    stats: {},
    pools: [],
    pityPools: [],
    showCapture: false,
    dist: [],
    recent: [],
    capture: null,
    expect: null,
    calendar: null,
    weaponOptions: [],
    chartReal: false,
    chartPool: 'all',
    chartPools: [{ key: 'all', label: '全部' }],
    chart: { points: [], summary: '' }
  },

  onLoad: function () {
    var info = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: info.statusBarHeight || 20 });
  },

  onShow: function () {
    this.load(app.globalData.game);
  },

  load: function (game) {
    var data = store.overview(game);
    var g = gameLib.config(game);
    this.expectSource = data;
    this.fiveStars = data.fiveStarHistory || [];
    var chartPools = chartPoolOptions(this.fiveStars, game);
    var chartPool = this.data.chartPool;
    var poolExists = chartPools.some(function (item) {
      return item.key === chartPool;
    });
    if (!poolExists) {
      chartPool = 'all';
    }
    var chart = buildChart(this.fiveStars, this.data.chartReal, chartPool, game);

    var stats = {
      totalPullsText: store.fmt(data.resource.totalPulls),
      totalPrimogemsText: store.fmt(data.resource.totalPrimogems),
      wishCount: data.wishCount,
      fiveStarWishes: data.fiveStarWishes,
      fourStarWishes: data.fourStarWishes,
      fiveStarRate: data.fiveStarRate,
      avgFiveStarPity: data.avgFiveStarPity,
      fourStarPercent: data.wishCount ? Math.round(data.fourStarWishes * 100 / data.wishCount) : 0,
      recordPullsText: store.fmt(data.totalPulls || 0),
      lostCount: data.lostCount || 0,
      softPityCount: data.softPityCount || 0,
      softPityUpCount: data.softPityUpCount || 0,
      softPityUpRate: data.softPityUpRate || 0,
      maxLossStreak: data.maxLossStreak || 0,
      maxUpStreak: data.maxUpStreak || 0,
      captureCount: data.captureTriggeredCount || 0,
      charSamples: data.characterUpSamples || 0,
      weaponSamples: data.weaponUpSamples || 0,
      charAvgText: data.characterUpSamples ? String(data.characterUpAvgPity) : '—',
      weaponAvgText: data.weaponUpSamples ? String(data.weaponUpAvgPity) : '—',
      charCostText: data.characterUpSamples ? store.fmt(data.avgPrimogemsPerUpCharacter) : '—',
      weaponCostText: data.weaponUpSamples ? store.fmt(data.avgPrimogemsPerUpWeapon) : '—'
    };

    var weaponOptions = Object.keys(weaponIcons[game] || {}).sort(function (a, b) {
      return a.localeCompare(b, 'zh-Hans-CN');
    });
    var weaponTarget = '';
    try {
      weaponTarget = wx.getStorageSync('sg_weapon_target_' + game) || '';
    } catch (e) {
      weaponTarget = '';
    }

    var pools = data.poolStats.map(function (item) {
      return {
        pool: item.pool,
        poolLabel: gameLib.poolLabel(item.pool),
        cap: item.cap,
        currentPity: item.currentPity,
        percent: item.percent,
        fiveStarCount: item.fiveStarCount,
        avgFiveStarPity: item.avgFiveStarPity,
        pullsToPity: item.pullsToPity,
        upGuaranteed: item.upGuaranteed,
        guaranteeText: guaranteeText(item.pool),
        showFate: game === 'genshin' && item.pool === '武器活动',
        fatePoints: item.fatePoints || 0,
        weaponTarget: weaponTarget,
        weaponTargetIndex: weaponOptions.indexOf(weaponTarget)
      };
    });

    var maxValue = 1;
    data.poolDistribution.forEach(function (item) {
      maxValue = Math.max(maxValue, item.value);
    });
    var dist = data.poolDistribution.map(function (item) {
      return {
        name: gameLib.poolLabel(item.name),
        value: item.value,
        percent: Math.max(8, Math.round(item.value / maxValue * 100))
      };
    });

    var recent = data.recentWishes.map(function (item) {
      return {
        id: item.id,
        stars: starText(item.rarity),
        name: item.itemName || '未命名',
        icon: itemIcon(game, item),
        time: (item.wishTime || '').slice(5, 16)
      };
    });

    var capture = null;
    if (game === 'genshin') {
      var losses = data.captureLossCount || 0;
      var status = data.captureGuaranteed
        ? '已连歪 ' + losses + ' 次：下次五星必定触发捕获明光'
        : (losses === 0
          ? '当前小保底：下次五星 50% 为当期 UP'
          : '已连歪 ' + losses + ' 次：下次五星 UP 概率约 ' + (data.captureNextUpRate || 50) + '%');
      capture = {
        losses: losses,
        percent: Math.min(100, Math.round(losses / 3 * 100)),
        remaining: data.captureRemaining || 0,
        status: status,
        characterFive: data.characterFiveStarWishes || 0,
        characterUp: data.characterUpWishes || 0,
        characterRate: data.characterUpRate || 0
      };
    }

    this.setData({
      game: game,
      g: g,
      stats: stats,
      pools: pools,
      pityPools: filterPools(pools, chartPool),
      showCapture: !!capture && (chartPool === 'all' || chartPool === g.charPool),
      dist: dist,
      recent: recent,
      capture: capture,
      expect: buildExpectation(data, game, expectPrefs(game)),
      calendar: buildCalendar(game, data.resource.primogemsPerPull || 160),
      weaponOptions: weaponOptions,
      chartPool: chartPool,
      chartPools: chartPools,
      chart: chart
    });
  },

  onRecentIconError: function (event) {
    var id = Number(event.currentTarget.dataset.id);
    var recent = this.data.recent.map(function (item) {
      if (item.id === id) {
        item.icon = '';
      }
      return item;
    });
    this.setData({ recent: recent });
  },

  onChartIconError: function (event) {
    var index = Number(event.currentTarget.dataset.index);
    var patch = {};
    patch['chart.points[' + index + '].icon'] = '';
    this.setData(patch);
  },

  onSwitchGame: function (event) {
    var game = event.detail.game;
    app.setGame(game);
    this.setData({ chartReal: false, chartPool: 'all' });
    this.load(game);
  },

  onSelectStatsTab: function (event) {
    var tab = event.currentTarget.dataset.tab || 'overview';
    if (tab === this.data.statsTab) {
      return;
    }
    this.setData({ statsTab: tab });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  onToggleReal: function () {
    var real = !this.data.chartReal;
    this.setData({
      chartReal: real,
      chart: buildChart(this.fiveStars || [], real, this.data.chartPool, this.data.game)
    });
  },

  onSelectChartPool: function (event) {
    var pool = event.currentTarget.dataset.pool || 'all';
    if (pool === this.data.chartPool) {
      return;
    }
    this.setData({
      chartPool: pool,
      pityPools: filterPools(this.data.pools, pool),
      showCapture: !!this.data.capture && (pool === 'all' || pool === this.data.g.charPool),
      chart: buildChart(this.fiveStars || [], this.data.chartReal, pool, this.data.game)
    });
  },

  /* ---------------- 抽卡期望 ---------------- */

  onExpectStep: function (event) {
    var step = event.currentTarget.dataset.step;
    var dir = Number(event.currentTarget.dataset.dir) || 0;
    var prefs = expectPrefs(this.data.game);
    if (step === 'c') {
      prefs.c = clamp(prefs.c + dir, 0, 6);
    } else if (step === 'r') {
      prefs.r = clamp(prefs.r + dir, 0, 5);
    }
    saveExpectPrefs(this.data.game, prefs);
    this.refreshExpectation();
  },

  onExpectMode: function (event) {
    var mode = event.currentTarget.dataset.mode;
    var prefs = expectPrefs(this.data.game);
    if (mode === 'history' && !(this.data.expect && this.data.expect.historyReady)) {
      wx.showToast({ title: '往期 UP 样本不足 2 次', icon: 'none' });
      return;
    }
    prefs.mode = mode === 'history' ? 'history' : 'theory';
    saveExpectPrefs(this.data.game, prefs);
    this.refreshExpectation();
  },

  /** 原神武器池定轨目标：仅本机记录，用于命定值提示。 */
  onFateTarget: function (event) {
    var index = Number(event.detail.value);
    var name = this.data.weaponOptions[index] || '';
    try {
      wx.setStorageSync('sg_weapon_target_' + this.data.game, name);
    } catch (e) {
      /* 忽略存储失败 */
    }
    wx.showToast({ title: name ? '定轨目标：' + name : '已清除定轨目标', icon: 'none' });
    this.load(this.data.game);
  },

  /* ---------------- 战绩卡（Canvas） ---------------- */

  onBattleCard: function () {
    var data = store.overview(this.data.game);
    var g = this.data.g;
    var ctx = wx.createCanvasContext('battleCard', this);
    function text(value, x, y, size, color, align) {
      ctx.setFillStyle(color || '#e8ebf2');
      ctx.setFontSize(size);
      ctx.setTextAlign(align || 'left');
      ctx.fillText(String(value), x, y);
    }
    function mask(uid) {
      var value = String(uid || '').trim();
      if (!value) {
        return 'UID 未标注';
      }
      return value.length <= 5 ? ('UID ' + value)
        : ('UID ' + value.slice(0, 3) + '***' + value.slice(-3));
    }
    var recentAll = data.recentWishes || [];
    var uid = '';
    for (var i = 0; i < recentAll.length; i++) {
      if (recentAll[i].uid) {
        uid = recentAll[i].uid;
        break;
      }
    }
    var fives = (data.fiveStarHistory || []).slice(-6).reverse();

    ctx.setFillStyle('#0b0d16');
    ctx.fillRect(0, 0, 720, 1000);
    ctx.setStrokeStyle('rgba(231,197,128,0.55)');
    ctx.setLineWidth(2);
    ctx.strokeRect(26, 26, 668, 948);

    text('SouthAir Genshin', 60, 96, 24, '#e7c580');
    text(g.fullName + ' · 战绩卡', 60, 130, 18, '#9aa1b5');
    text(mask(uid), 660, 96, 18, '#9aa1b5', 'right');
    text(store.nowStr().slice(0, 10), 660, 128, 15, '#71778e', 'right');

    text('合计可抽', 60, 196, 18, '#9aa1b5');
    text(store.fmt(data.resource.totalPulls), 60, 280, 54, '#ffffff');
    text('抽', 60 + 10 + 32 * String(store.fmt(data.resource.totalPulls)).length, 280, 20, '#9aa1b5');

    var cards = [
      ['抽卡记录', store.fmt(data.wishCount)],
      ['五星出货', store.fmt(data.fiveStarWishes)],
      ['五星出货率', data.fiveStarRate + '%'],
      ['四星出货', store.fmt(data.fourStarWishes)]
    ];
    cards.forEach(function (item, index) {
      var x = 60 + (index % 2) * 310;
      var y = 350 + Math.floor(index / 2) * 118;
      ctx.setFillStyle('rgba(255,255,255,0.04)');
      ctx.fillRect(x, y, 280, 96);
      text(item[0], x + 20, y + 30, 15, '#9aa1b5');
      text(item[1], x + 20, y + 70, 28);
    });

    text('五星平均抽数', 60, 636, 16, '#9aa1b5');
    text(data.avgFiveStarPity, 300, 636, 16, '#e8ebf2');
    text('小保底不歪率', 400, 636, 16, '#9aa1b5');
    text(data.softPityUpRate + '%', 660, 636, 16, '#e8ebf2', 'right');
    text('连歪纪录', 60, 682, 16, '#9aa1b5');
    text(data.maxLossStreak + ' 次', 300, 682, 16, '#e8ebf2');
    text('连不歪纪录', 400, 682, 16, '#9aa1b5');
    text(data.maxUpStreak + ' 次', 660, 682, 16, '#e8ebf2', 'right');

    text('最近五星', 60, 744, 18, '#e7c580');
    if (!fives.length) {
      text('还没有五星记录', 60, 786, 16, '#71778e');
    }
    fives.forEach(function (item, index) {
      var y = 786 + index * 38;
      text(item.itemName || '未命名', 60, y, 17);
      text((item.pityCount || 1) + ' 抽', 460, y, 15, '#9aa1b5');
      text(item.pool || '', 660, y, 15, '#71778e', 'right');
    });
    text('数据来自本机记录 · 个人统计，仅供参考', 60, 944, 13, '#5d6479');
    var that = this;
    ctx.draw(false, function () {
      wx.canvasToTempFilePath({
        canvasId: 'battleCard',
        x: 0,
        y: 0,
        width: 720,
        height: 1000,
        destWidth: 720,
        destHeight: 1000,
        success: function (res) {
          wx.saveImageToPhotosAlbum({
            filePath: res.tempFilePath,
            success: function () {
              wx.showToast({ title: '战绩卡已保存到相册', icon: 'none' });
            },
            fail: function () {
              wx.previewImage({ urls: [res.tempFilePath] });
            }
          });
        },
        fail: function () {
          wx.showToast({ title: '战绩卡生成失败', icon: 'none' });
        }
      }, that);
    });
  },

  /** 卡池日历「用剩余 N 天」：写入攒抽规划的天数。 */
  onCalendarUseDays: function (event) {
    var days = clamp(Math.round(Number(event.currentTarget.dataset.days) || 0), 0, 365);
    var prefs = expectPrefs(this.data.game);
    prefs.days = days;
    saveExpectPrefs(this.data.game, prefs);
    this.refreshExpectation();
    wx.showToast({ title: '已填入卡池剩余 ' + days + ' 天', icon: 'none' });
  },

  /** 联网获取官方公告里的实时卡池，成功写入 24 小时缓存并刷新页面。 */
  onLiveCalendar: function () {
    var that = this;
    var game = this.data.game;
    wx.showLoading({ title: '获取卡池中', mask: true });
    calendarLib.fetchLive(game).then(function (calendar) {
      calendarLib.saveLive(game, calendar);
      wx.hideLoading();
      that.load(game);
      wx.showToast({ title: '卡池已更新', icon: 'none' });
    }).catch(function (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || '联网获取失败', icon: 'none' });
    });
  },

  /** 攒抽规划输入：失焦 / 确认时保存并重算。 */
  onPlanInput: function (event) {
    var key = event.currentTarget.dataset.key;
    var value = Number(event.detail.value);
    var game = this.data.game;
    if (key === 'daily') {
      var daily = isFinite(value) ? clamp(value, 0, 999999) : 0;
      store.updateResource(game, { dailyPrimogems: daily });
      if (this.expectSource) {
        this.expectSource.resource = store.resourceVO(store.getResource(game));
      }
      this.refreshExpectation();
      return;
    }
    var prefs = expectPrefs(game);
    if (key === 'days') {
      prefs.days = isFinite(value) ? clamp(Math.round(value), 0, 365) : prefs.days;
    }
    saveExpectPrefs(game, prefs);
    this.refreshExpectation();
  },

  refreshExpectation: function () {
    if (!this.expectSource) {
      return;
    }
    this.setData({
      expect: buildExpectation(this.expectSource, this.data.game, expectPrefs(this.data.game))
    });
  },

  /* ---------------- UIGF / SRGF ---------------- */

  exportUigf: function () {
    var game = this.data.game;
    var format = game === 'starrail' ? 'SRGF' : 'UIGF';
    var payload = uigf.build(store.exportRecords(game), game, '');
    file.exportFile('southair-' + game + '-' + format.toLowerCase() + '-'
      + store.nowStr().slice(0, 10).replace(/-/g, '') + '.json',
      JSON.stringify(payload, null, 2));
  },

  importUigf: function () {
    var that = this;
    var game = this.data.game;
    var format = game === 'starrail' ? 'SRGF' : 'UIGF';
    file.chooseFile(['json']).then(function (picked) {
      var parsed = uigf.parse(picked.content, game);
      if (parsed.error) {
        wx.showToast({ title: parsed.error, icon: 'none' });
        return;
      }
      var preview = store.importRecords(game, parsed.records, 'merge', true);
      wx.showActionSheet({
        itemList: ['合并导入（跳过重复）', '覆盖导入（清空当前游戏记录）'],
        success: function (res) {
          var mode = res.tapIndex === 1 ? 'replace' : 'merge';
          var total = parsed.total;
          var ignored = parsed.filtered || 0;
          var validCount = parsed.records.length;
          var willWrite = mode === 'replace' ? validCount : preview.imported;
          var skipText = mode === 'replace' ? '' : '，跳过重复 ' + preview.skipped + ' 条';
          var invalidText = parsed.invalid ? '，格式无效 ' + parsed.invalid + ' 条' : '';
          wx.showModal({
            title: format + ' 导入预演',
            content: '共 ' + total + ' 条：将' + (mode === 'replace' ? '写入' : '新增') + ' '
              + willWrite + ' 条' + skipText + '，忽略 ' + ignored
              + ' 条（三星 / 四星武器）' + invalidText + '。'
              + (mode === 'replace' ? '覆盖导入会先清空当前游戏记录。' : ''),
            confirmText: '确认导入',
            confirmColor: mode === 'replace' ? '#ff6b6b' : '#576b95',
            success: function (confirm) {
              if (confirm.confirm) {
                that.applyUigf(parsed.records, mode, format);
              }
            }
          });
        }
      });
    }).catch(function (err) {
      wx.showToast({ title: err && err.message ? err.message : '导入失败', icon: 'none' });
    });
  },

  applyUigf: function (records, mode, format) {
    var result = store.importRecords(this.data.game, records, mode);
    this.load(this.data.game);
    wx.showModal({
      title: format + ' 导入完成',
      content: '新增 ' + result.imported + ' 条，跳过 ' + result.skipped + ' 条，忽略 '
        + result.filtered + ' 条（三星 / 四星武器）。',
      showCancel: false
    });
  },

  /* ---------------- 全量备份 ---------------- */

  exportAllBackup: function () {
    var payload = store.exportAllBackup();
    file.exportFile('southair-all-backup-' + store.nowStr().slice(0, 10).replace(/-/g, '') + '.json',
      JSON.stringify(payload, null, 2));
  },

  importAllBackup: function () {
    var that = this;
    file.chooseFile(['json']).then(function (picked) {
      var payload;
      try {
        payload = JSON.parse(picked.content);
      } catch (e) {
        wx.showToast({ title: '不是有效的 JSON 备份文件', icon: 'none' });
        return;
      }
      if (!payload || typeof payload !== 'object' || !payload.games) {
        wx.showToast({ title: '这不是全量备份文件', icon: 'none' });
        return;
      }
      that.confirmAllImport(payload);
    }).catch(function (err) {
      wx.showToast({ title: err && err.message ? err.message : '导入失败', icon: 'none' });
    });
  },

  /** 弹出合并 / 覆盖选择并执行，文件导入与链接导入共用。 */
  confirmAllImport: function (payload) {
    var that = this;
    wx.showActionSheet({
      itemList: ['合并导入（按名称+卡池+时间去重）', '覆盖导入（清空两个游戏的记录）'],
      success: function (res) {
        var mode = res.tapIndex === 1 ? 'replace' : 'merge';
        if (mode === 'replace') {
          wx.showModal({
            title: '覆盖导入',
            content: '覆盖导入会清空两个游戏的全部抽卡记录，确定继续吗？',
            confirmColor: '#ff6b6b',
            success: function (confirm) {
              if (!confirm.confirm) {
                return;
              }
              that.applyAllImport(payload, mode);
            }
          });
          return;
        }
        that.applyAllImport(payload, mode);
      }
    });
  },

  applyAllImport: function (payload, mode) {
    var result = store.importAllBackup(payload, mode);
    if (result.error) {
      wx.showModal({
        title: '备份校验失败',
        content: result.error,
        showCancel: false
      });
      return;
    }
    this.load(this.data.game);
    wx.showToast({
      title: '导入 ' + result.imported + ' 条'
        + (result.skipped ? '，跳过 ' + result.skipped + ' 条' : '')
        + (result.filtered ? '，忽略 ' + result.filtered + ' 条' : ''),
      icon: 'none'
    });
  }
});
