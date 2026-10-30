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
    chartReal: false,
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
      chart: chart
    });
  },

  onSwitchGame: function (event) {
    var game = event.detail.game;
    app.setGame(game);
    this.setData({ chartReal: false });
    this.load(game);
  },

  onToggleReal: function () {
    var real = !this.data.chartReal;
    this.setData({
      chartReal: real,
      chart: buildChart(this.fiveStars || [], real)
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

  downloadResourceTemplate: function () {
    wx.showActionSheet({
      itemList: ['下载 CSV 模板', '下载 JSON 模板'],
      success: function (res) {
        if (res.tapIndex === 0) {
          file.exportFile('southair-resources-template.csv', resourceCsv.template());
        } else {
          file.exportFile('southair-resources-template.json', resourceCsv.templateJson());
        }
      }
    });
  },

  importResource: function () {
    var that = this;
    wx.showActionSheet({
      itemList: ['下载 CSV 模板', '下载 JSON 模板', '直接导入'],
      success: function (res) {
        if (res.tapIndex === 0) {
          file.exportFile('southair-resources-template.csv', resourceCsv.template());
          return;
        }
        if (res.tapIndex === 1) {
          file.exportFile('southair-resources-template.json', resourceCsv.templateJson());
          return;
        }
        that.pickResourceFile();
      }
    });
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
      var filled = ['primogems', 'mora', 'intertwinedFates', 'acquaintedFates'].filter(function (key) {
        return values[key] !== undefined && values[key] !== null;
      });
      if (!filled.length) {
        wx.showToast({ title: '请先在模板里填写数值', icon: 'none' });
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
