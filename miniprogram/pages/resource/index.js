var app = getApp();
var store = require('../../utils/store');
var gameLib = require('../../utils/game');
var avatars = require('../../utils/avatars');

var CHAR_NAMES = Object.keys(avatars.genshin || {}).sort(function (a, b) {
  return a.localeCompare(b, 'zh-Hans-CN');
});

/* 角色 1→90 每级所需经验（下标 = 当前等级，共 89 项） */
var CHARACTER_EXP = [
  1000, 1325, 1700, 2150, 2625, 3150, 3725, 4350, 5000, 5700,
  6450, 7225, 8050, 8925, 9825, 10750, 11725, 12725, 13775, 14875,
  16800, 18000, 19250, 20550, 21875, 23250, 24650, 26100, 27575, 29100,
  30650, 32250, 33875, 35550, 37250, 38975, 40750, 42575, 44425, 46300,
  50625, 52700, 54775, 56900, 59075, 61275, 63525, 65800, 68125, 70475,
  76500, 79050, 81650, 84275, 86950, 89650, 92400, 95175, 98000, 100875,
  108950, 112050, 115175, 118325, 121525, 124775, 128075, 131400, 134775, 138175,
  148700, 152375, 156075, 159825, 163600, 167425, 171300, 175225, 179175, 183175,
  216225, 243025, 273100, 306800, 344600, 386950, 434425, 487625, 547200
];

/* 圣遗物各星级每级所需经验（下标 = 当前等级） */
var ARTIFACT_EXP = {
  '5': [3000, 3725, 4425, 5150, 5900, 6675, 7500, 8350, 9225, 10125,
    11050, 12025, 13025, 15150, 17600, 20375, 23500, 27050, 31050, 35575],
  '4': [2400, 2975, 3550, 4125, 4725, 5350, 6000, 6675, 7375, 8100,
    8850, 9625, 10425, 12125, 14075, 16300],
  '3': [1800, 2225, 2650, 3100, 3550, 4000, 4500, 5000, 5525, 6075, 6625, 7225]
};

var ARTIFACT_RARITY = ['5', '4', '3'];
var ARTIFACT_LABEL = ['五星（上限 +20）', '四星（上限 +16）', '三星（上限 +12）'];
var ARTIFACT_MAX = { '5': 20, '4': 16, '3': 12 };
var CHAR_ITEM_EXP = { heroWit: 20000, adventurerExp: 5000, wandererAdvice: 1000 };
var ART_ITEM_EXP = { sanctifyingUnction: 2500, sanctifyingEssence: 10000 };

function toInt(value) {
  var number = parseInt(value, 10);
  return isNaN(number) ? 0 : number;
}

/** 从当前等级逐级扣减经验，返回可达等级 / 消耗 / 剩余 / 距满级还差 */
function climbExp(total, table, maxLevel, startLevel) {
  var level = Math.max(0, Math.min(maxLevel, toInt(startLevel)));
  var rest = Math.max(0, toInt(total));
  var spent = 0;
  while (level < maxLevel && rest >= table[level]) {
    rest -= table[level];
    spent += table[level];
    level += 1;
  }
  var gap = 0;
  for (var i = level; i < maxLevel; i += 1) {
    gap += table[i];
  }
  return { level: level, spent: spent, rest: rest, gap: gap };
}

Page({
  data: {
    statusBarHeight: 20,
    game: 'genshin',
    g: gameLib.config('genshin'),
    res: {},
    editing: false,
    showConvert: false,
    exp: {},
    charOptions: ['未选择（按序号）'].concat(CHAR_NAMES),
    charIndex: 0,
    charPlanView: [],
    expCharLevel: 1,
    artRarityIndex: 0,
    artRarityOptions: ARTIFACT_LABEL,
    artLevel: 0,
    form: {
      primogems: '',
      mora: '',
      intertwinedFates: '',
      acquaintedFates: '',
      dailyPrimogems: '',
      heroWit: '',
      adventurerExp: '',
      wandererAdvice: '',
      sanctifyingUnction: '',
      sanctifyingEssence: ''
    }
  },

  onLoad: function () {
    var info = wx.getSystemInfoSync();
    this._charPlan = [];
    this.setData({ statusBarHeight: info.statusBarHeight || 20 });
  },

  onShow: function () {
    this.load(app.globalData.game);
  },

  load: function (game) {
    var res = store.resourceVO(store.getResource(game));
    res.primogemsText = store.fmt(res.primogems);
    res.moraText = store.fmt(res.mora);
    res.intertwinedFatesText = store.fmt(res.intertwinedFates);
    res.acquaintedFatesText = store.fmt(res.acquaintedFates);
    res.pullsFromPrimogemsText = store.fmt(res.pullsFromPrimogems);
    res.primogemsRemainderText = store.fmt(res.primogemsRemainder);
    res.primogemsFromFatesText = store.fmt(res.primogemsFromFates);
    res.totalPullsText = store.fmt(res.totalPulls);
    res.totalPrimogemsText = store.fmt(res.totalPrimogems);
    res.dailyPrimogemsText = store.fmt(res.dailyPrimogems || 0);

    this.setData({
      game: game,
      g: gameLib.config(game),
      res: res
    });
    this.applyExp();
  },

  /** 按当前资源数量与当前等级重新计算养成经验 */
  applyExp: function () {
    var res = this.data.res;
    if (this.data.game !== 'genshin') {
      this.setData({ exp: {} });
      return;
    }
    var charTotal = res.heroWit * CHAR_ITEM_EXP.heroWit
      + res.adventurerExp * CHAR_ITEM_EXP.adventurerExp
      + res.wandererAdvice * CHAR_ITEM_EXP.wandererAdvice;
    var artTotal = res.sanctifyingUnction * ART_ITEM_EXP.sanctifyingUnction
      + res.sanctifyingEssence * ART_ITEM_EXP.sanctifyingEssence;

    var plan = this._charPlan || [];
    var remaining = charTotal;
    var planSpent = 0;
    var planView = plan.map(function (row, index) {
      var step = climbExp(remaining, CHARACTER_EXP, 90, Math.max(1, row.fromLevel));
      remaining = step.rest;
      planSpent += step.spent;
      return {
        name: row.name || ('角色 ' + (index + 1)),
        fromLevel: Math.max(1, row.fromLevel),
        toLevel: step.level,
        spentText: store.fmt(step.spent)
      };
    });

    var charResult = climbExp(remaining, CHARACTER_EXP, 90,
      Math.max(1, toInt(this.data.expCharLevel)));
    var rarity = ARTIFACT_RARITY[this.data.artRarityIndex];
    var maxLevel = ARTIFACT_MAX[rarity];
    var level = Math.max(0, Math.min(maxLevel, toInt(this.data.artLevel)));
    var artResult = climbExp(artTotal, ARTIFACT_EXP[rarity], maxLevel, level);

    this.setData({
      artLevel: level,
      charPlanView: planView,
      exp: {
        heroWitText: store.fmt(res.heroWit),
        adventurerExpText: store.fmt(res.adventurerExp),
        wandererAdviceText: store.fmt(res.wandererAdvice),
        unctionText: store.fmt(res.sanctifyingUnction),
        essenceText: store.fmt(res.sanctifyingEssence),
        charTotalText: store.fmt(charTotal),
        artTotalText: store.fmt(artTotal),
        charLevel: charResult.level,
        charSpentText: store.fmt(charResult.spent),
        charRestText: store.fmt(charResult.rest),
        charNote: charResult.level >= 90
          ? '已满级' : '距 90 级还差 ' + store.fmt(charResult.gap),
        planSpentText: store.fmt(planSpent),
        planRestText: store.fmt(remaining),
        artLevel: artResult.level,
        artSpentText: store.fmt(artResult.spent),
        artRestText: store.fmt(artResult.rest),
        artNote: artResult.level >= maxLevel
          ? '已满级' : '距 +' + maxLevel + ' 还差 ' + store.fmt(artResult.gap)
      }
    });
  },

  toggleConvert: function () {
    this.setData({ showConvert: !this.data.showConvert });
  },

  onCharLevel: function (event) {
    this.setData({ expCharLevel: event.detail.value });
    this.applyExp();
  },

  onCharName: function (event) {
    this.setData({ charIndex: Number(event.detail.value) || 0 });
  },

  onAddChar: function () {
    this._charPlan = this._charPlan || [];
    var index = this.data.charIndex;
    this._charPlan.push({
      name: index > 0 ? this.data.charOptions[index] : '',
      fromLevel: Math.max(1, toInt(this.data.expCharLevel))
    });
    this.setData({ charIndex: 0, expCharLevel: 1 });
    this.applyExp();
  },

  onRemoveChar: function (event) {
    var index = Number(event.currentTarget.dataset.index);
    if (this._charPlan && index >= 0) {
      this._charPlan.splice(index, 1);
    }
    this.applyExp();
  },

  onArtLevel: function (event) {
    this.setData({ artLevel: event.detail.value });
    this.applyExp();
  },

  onArtRarity: function (event) {
    this.setData({ artRarityIndex: Number(event.detail.value) || 0 });
    this.applyExp();
  },

  onSwitchGame: function (event) {
    var game = event.detail.game;
    app.setGame(game);
    this.setData({ editing: false });
    this.load(game);
  },

  openEdit: function () {
    var resource = store.getResource(this.data.game);
    this.setData({
      editing: true,
      form: {
        primogems: String(resource.primogems),
        mora: String(resource.mora),
        intertwinedFates: String(resource.intertwinedFates),
        acquaintedFates: String(resource.acquaintedFates),
        dailyPrimogems: String(resource.dailyPrimogems || 0),
        heroWit: String(resource.heroWit || 0),
        adventurerExp: String(resource.adventurerExp || 0),
        wandererAdvice: String(resource.wandererAdvice || 0),
        sanctifyingUnction: String(resource.sanctifyingUnction || 0),
        sanctifyingEssence: String(resource.sanctifyingEssence || 0)
      }
    });
  },

  closeEdit: function () {
    this.setData({ editing: false });
  },

  noop: function () {
  },

  onInput: function (event) {
    var key = event.currentTarget.dataset.key;
    var patch = {};
    patch['form.' + key] = event.detail.value;
    this.setData(patch);
  },

  saveEdit: function () {
    var form = this.data.form;
    store.updateResource(this.data.game, {
      primogems: form.primogems,
      mora: form.mora,
      intertwinedFates: form.intertwinedFates,
      acquaintedFates: form.acquaintedFates,
      dailyPrimogems: form.dailyPrimogems,
      heroWit: form.heroWit,
      adventurerExp: form.adventurerExp,
      wandererAdvice: form.wandererAdvice,
      sanctifyingUnction: form.sanctifyingUnction,
      sanctifyingEssence: form.sanctifyingEssence
    });
    this.setData({ editing: false });
    this.load(this.data.game);
    wx.showToast({ title: '已保存', icon: 'success' });
  }
});
