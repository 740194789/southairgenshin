var app = getApp();
var store = require('../../utils/store');
var gameLib = require('../../utils/game');
var file = require('../../utils/file');
var resourceCsv = require('../../utils/resourceCsv');

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

/**
 * 五星抽数柱形图：real 为 true 时隐藏歪的记录，按 UP 周期累计真实抽数。
 * 周期按卡池分别累计，避免角色池与武器 / 光锥池混算。
 */
function buildChart(list, real) {
  var points = [];
  var total = 0;

  if (real) {
    var cycles = {};
    (list || []).forEach(function (item) {
      var pool = item.pool || '未知卡池';
      var acc = (cycles[pool] || 0) + (item.pityCount || 0);
      if (item.isUp === true) {
        points.push({ name: item.itemName || '未命名', value: acc, up: true });
        acc = 0;
      }
      cycles[pool] = acc;
    });
  } else {
    points = (list || []).map(function (item) {
      return {
        name: item.itemName || '未命名',
        value: item.pityCount || 0,
        up: item.isUp === true
      };
    });
  }

  var max = 1;
  points.forEach(function (point) {
    max = Math.max(max, point.value);
  });
  points.forEach(function (point) {
    point.height = Math.max(10, Math.round(point.value / max * 250));
    total += point.value;
  });

  var hidden = (list || []).filter(function (item) {
    return item.isUp !== true;
  }).length;

  return {
    points: points,
    total: total,
    summary: real
      ? '已隐藏 ' + hidden + ' 次歪的记录 · 抽到 UP 一共用了 ' + total + ' 抽（含歪掉的抽数，按卡池分别累计）'
      : '共 ' + points.length + ' 次五星，合计 ' + total + ' 抽；深色柱为歪掉的五星'
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

function expectPrefs(game) {
  var raw = null;
  try {
    raw = wx.getStorageSync(EXPECT_KEY + game);
  } catch (e) {
    raw = null;
  }
  raw = raw && typeof raw === 'object' ? raw : {};
  return {
    c: clamp(Number(raw.c) || 0, 0, 6),
    r: clamp(Number(raw.r) || 0, 0, 5),
    mode: raw.mode === 'history' ? 'history' : 'theory'
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
 * theory：按平均五星抽数与 UP 概率推算；history：用账号历史 UP 周期平均抽数。
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
  var historyReady = charSamples >= 2 && data.characterUpAvgPity > 0;
  var useHistory = prefs.mode === 'history' && historyReady;
  var weaponHistory = useHistory && weaponSamples >= 2 && data.weaponUpAvgPity > 0;

  var charUnit = useHistory ? data.characterUpAvgPity : charUnitTheory;
  var weaponUnit = weaponHistory ? data.weaponUpAvgPity : weaponUnitTheory;

  var charFirst = Math.max(1, (charGuaranteed ? EXPECT_MODEL.fiveStarAvg : charUnit) - charPity);
  var charCost = charFirst + prefs.c * charUnit;

  var weaponCost = 0;
  if (prefs.r > 0) {
    var weaponFirst = Math.max(1, (weaponGuaranteed ? EXPECT_MODEL.weaponFiveStarAvg : weaponUnit)
      - weaponPity);
    weaponCost = weaponFirst + (prefs.r - 1) * weaponUnit;
  }

  var total = Math.max(1, Math.round(charCost + weaponCost));
  var available = data.resource.totalPulls || 0;
  var currencyPerPull = data.resource.primogemsPerPull || 160;
  var gap = total - available;
  var enough = gap <= 0;
  var percent = Math.min(100, Math.round(available / total * 100));
  var weaponWord = isSR ? '光锥' : '武器';

  var compareText = enough
    ? '当前可抽 ' + store.fmt(available) + ' 抽 · 已足够，余 ' + store.fmt(-gap) + ' 抽'
    : '当前可抽 ' + store.fmt(available) + ' 抽 · 还差 ' + store.fmt(gap)
      + ' 抽（约 ' + store.fmt(gap * currencyPerPull) + ' ' + g.currency + '）';

  var sourceNote;
  if (useHistory) {
    sourceNote = '往期数据：角色 UP 平均 ' + data.characterUpAvgPity + ' 抽（'
      + charSamples + ' 次样本）';
    if (prefs.r > 0) {
      sourceNote += weaponHistory
        ? ' · 武器 UP 平均 ' + data.weaponUpAvgPity + ' 抽（' + weaponSamples + ' 次样本）'
        : ' · 武器样本不足 2 次，改用理论值';
    }
  } else {
    sourceNote = isSR
      ? '理论模型：角色池五星平均 62.5 抽、UP 基础 50%；光锥池五星平均 53.3 抽、UP 75%，歪后大保底。'
      : '理论模型：角色池五星平均 62.5 抽、UP 综合 55%（含捕获明光）；'
        + '武器池五星平均 53.3 抽、定轨约需 2 个五星。';
  }

  var pityNote = '已扣除当前保底进度：' + g.charPool + ' ' + charPity + ' / '
    + (charPool ? charPool.cap : 90)
    + (prefs.r > 0 ? '，' + g.weaponPool + ' ' + weaponPity + ' / '
      + (weaponPool ? weaponPool.cap : 80) : '')
    + (charGuaranteed ? ' · 角色池大保底' : '')
    + (weaponGuaranteed && prefs.r > 0 ? ' · 武器池大保底' : '') + '。';

  return {
    c: prefs.c,
    r: prefs.r,
    historyOn: useHistory,
    historyReady: historyReady,
    targetName: 'C' + prefs.c + (prefs.r > 0 ? ' + R' + prefs.r : ''),
    totalText: store.fmt(total),
    enough: enough,
    percent: percent,
    compareText: compareText,
    charLabel: '角色 C' + prefs.c,
    charCostText: store.fmt(Math.round(charCost)) + ' 抽',
    charUpText: (prefs.c + 1) + ' 个 UP',
    charNote: prefs.c === 0 ? '仅本体，不追命座' : '本体 + ' + prefs.c + ' 命',
    weaponLabel: prefs.r > 0 ? weaponWord + ' R' + prefs.r : weaponWord,
    weaponCostText: prefs.r > 0 ? store.fmt(Math.round(weaponCost)) + ' 抽' : '—',
    weaponUpText: prefs.r > 0 ? prefs.r + ' 把 UP' : '未选择',
    weaponNote: prefs.r === 0 ? '不抽' + weaponWord : '本体 + ' + (prefs.r - 1) + ' 把精炼',
    sourceNote: sourceNote,
    pityNote: pityNote
  };
}

Page({
  data: {
    statusBarHeight: 20,
    game: 'genshin',
    g: gameLib.config('genshin'),
    stats: {},
    pools: [],
    dist: [],
    recent: [],
    capture: null,
    expect: null,
    chartReal: false,
    chart: { points: [], summary: '' },
    resourceEditing: false,
    resourceForm: {
      primogems: '',
      mora: '',
      intertwinedFates: '',
      acquaintedFates: ''
    },
    resourceTextVisible: false,
    resourceText: ''
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
    var chart = buildChart(this.fiveStars, this.data.chartReal);

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

    var pools = data.poolStats.map(function (item) {
      return {
        pool: item.pool,
        cap: item.cap,
        currentPity: item.currentPity,
        percent: item.percent,
        fiveStarCount: item.fiveStarCount,
        avgFiveStarPity: item.avgFiveStarPity,
        pullsToPity: item.pullsToPity,
        upGuaranteed: item.upGuaranteed,
        guaranteeText: guaranteeText(item.pool)
      };
    });

    var maxValue = 1;
    data.poolDistribution.forEach(function (item) {
      maxValue = Math.max(maxValue, item.value);
    });
    var dist = data.poolDistribution.map(function (item) {
      return {
        name: item.name,
        value: item.value,
        percent: Math.max(8, Math.round(item.value / maxValue * 100))
      };
    });

    var recent = data.recentWishes.map(function (item) {
      return {
        id: item.id,
        stars: starText(item.rarity),
        name: item.itemName || '未命名',
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
      dist: dist,
      recent: recent,
      capture: capture,
      expect: buildExpectation(data, game, expectPrefs(game)),
      chart: chart
    });
  },

  onSwitchGame: function (event) {
    var game = event.detail.game;
    app.setGame(game);
    this.setData({ chartReal: false, resourceEditing: false, resourceTextVisible: false });
    this.load(game);
  },

  onToggleReal: function () {
    var real = !this.data.chartReal;
    this.setData({
      chartReal: real,
      chart: buildChart(this.fiveStars || [], real)
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

  refreshExpectation: function () {
    if (!this.expectSource) {
      return;
    }
    this.setData({
      expect: buildExpectation(this.expectSource, this.data.game, expectPrefs(this.data.game))
    });
  },

  /* ---------------- 账号资源导入导出 ---------------- */

  exportResourceCsv: function () {
    var game = this.data.game;
    var res = store.getResource(game);
    file.exportFile('southair-' + game + '-resources.csv', resourceCsv.write(res));
  },

  exportResourceJson: function () {
    var game = this.data.game;
    var res = store.getResource(game);
    file.exportFile('southair-' + game + '-resources.json', JSON.stringify({
      primogems: res.primogems,
      mora: res.mora,
      intertwinedFates: res.intertwinedFates,
      acquaintedFates: res.acquaintedFates
    }, null, 2));
  },

  /** 手机手动填写资源：不下载模板，直接在弹窗里改 4 个数值。 */
  openResourceForm: function () {
    var res = store.getResource(this.data.game);
    this.setData({
      resourceEditing: true,
      resourceForm: {
        primogems: String(res.primogems),
        mora: String(res.mora),
        intertwinedFates: String(res.intertwinedFates),
        acquaintedFates: String(res.acquaintedFates)
      }
    });
  },

  closeResourceForm: function () {
    this.setData({ resourceEditing: false });
  },

  onResourceInput: function (event) {
    var key = event.currentTarget.dataset.key;
    var patch = {};
    patch['resourceForm.' + key] = event.detail.value;
    this.setData(patch);
  },

  noop: function () {
  },

  saveResourceForm: function () {
    store.updateResource(this.data.game, this.data.resourceForm);
    this.setData({ resourceEditing: false });
    this.load(this.data.game);
    wx.showToast({ title: '资源已保存', icon: 'success' });
  },

  /** 粘贴导入：支持网页端导出的 JSON，也支持表头 + 一行数值的 CSV。 */
  openResourceText: function () {
    this.setData({ resourceTextVisible: true, resourceText: '' });
  },

  closeResourceText: function () {
    this.setData({ resourceTextVisible: false });
  },

  onResourceTextInput: function (event) {
    this.setData({ resourceText: event.detail.value });
  },

  applyResourceText: function () {
    var text = (this.data.resourceText || '').trim();
    if (!text) {
      wx.showToast({ title: '请先粘贴内容', icon: 'none' });
      return;
    }
    var values;
    if (text.charAt(0) === '{') {
      try {
        values = JSON.parse(text);
      } catch (e) {
        wx.showToast({ title: '不是有效的 JSON', icon: 'none' });
        return;
      }
    } else {
      values = resourceCsv.parse(text);
    }
    if (values && values.resource && typeof values.resource === 'object') {
      values = values.resource;
    }
    if (!values || typeof values !== 'object') {
      wx.showToast({ title: '没有识别到资源数值', icon: 'none' });
      return;
    }
    this.setData({ resourceTextVisible: false });
    this.applyResourceValues(values);
  },

  applyResourceValues: function (values) {
    var that = this;
    var filled = ['primogems', 'mora', 'intertwinedFates', 'acquaintedFates'].filter(function (key) {
      return values[key] !== undefined && values[key] !== null;
    });
    if (!filled.length) {
      wx.showToast({ title: '没有识别到资源数值', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '导入资源',
      content: '导入会覆盖当前游戏已填写的资源数值，确定继续吗？',
      success: function (confirm) {
        if (!confirm.confirm) {
          return;
        }
        store.importResource(that.data.game, values);
        that.load(that.data.game);
        wx.showToast({ title: '资源已导入', icon: 'success' });
      }
    });
  },

  /** 从聊天记录选择电脑端导出的资源 CSV / JSON 文件。 */
  importResource: function () {
    this.pickResourceFile();
  },

  pickResourceFile: function () {
    var that = this;
    file.chooseFile(['csv', 'json']).then(function (picked) {
      var values;
      if (/\.json$/i.test(picked.name)) {
        try {
          values = JSON.parse(picked.content);
        } catch (e) {
          wx.showToast({ title: '不是有效的 JSON 文件', icon: 'none' });
          return;
        }
      } else {
        values = resourceCsv.parse(picked.content);
      }
      if (!values || typeof values !== 'object') {
        wx.showToast({ title: '文件里没有资源数据', icon: 'none' });
        return;
      }
      if (values.resource && typeof values.resource === 'object') {
        values = values.resource;
      }
      that.applyResourceValues(values);
    }).catch(function (err) {
      wx.showToast({ title: err && err.message ? err.message : '导入失败', icon: 'none' });
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
    }).catch(function (err) {
      wx.showToast({ title: err && err.message ? err.message : '导入失败', icon: 'none' });
    });
  },

  applyAllImport: function (payload, mode) {
    var result = store.importAllBackup(payload, mode);
    this.load(this.data.game);
    wx.showToast({
      title: '导入 ' + result.imported + ' 条'
        + (result.skipped ? '，跳过 ' + result.skipped + ' 条' : '')
        + (result.filtered ? '，忽略 ' + result.filtered + ' 条' : ''),
      icon: 'none'
    });
  }
});
