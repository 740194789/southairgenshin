var app = getApp();
var store = require('../../utils/store');
var gameLib = require('../../utils/game');
var avatars = require('../../utils/avatars');

var CHAR_NAMES = Object.keys(avatars.genshin || {}).filter(function (name) {
  return name !== '旅行者';
}).sort(function (a, b) {
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

/* 五星圣遗物 +0 强化到 +20 所需经验 */
var FIVE_STAR_ARTIFACT_EXP = 270475;

/* 角色可选等级：90 级后为 95 / 100（需无主的命星，不再消耗经验） */
var CHAR_LEVELS = (function () {
  var list = [];
  for (var lv = 1; lv <= 90; lv += 1) {
    list.push(lv);
  }
  list.push(95, 100);
  return list;
})();

function toLevelsFor(from) {
  return CHAR_LEVELS.filter(function (lv) {
    return lv > from;
  });
}

/** 当前等级 → 目标等级：经验书经验 + 无主的命星数量 */
function levelPlan(fromLevel, toLevel) {
  var start = Math.max(1, Math.min(100, toInt(fromLevel)));
  var end = Math.max(start, Math.min(100, toInt(toLevel)));
  var exp = 0;
  for (var lv = start; lv < Math.min(end, 90); lv += 1) {
    exp += CHARACTER_EXP[lv - 1];
  }
  var stars = 0;
  if (end > 90) {
    if (start >= 95) {
      stars = end >= 100 ? 2 : 0;
    } else {
      stars = end >= 100 ? 3 : 1;
    }
  }
  return { from: start, to: end, exp: exp, stars: stars };
}

var CHAR_ITEM_EXP = { heroWit: 20000, adventurerExp: 5000, wandererAdvice: 1000 };
var ART_ITEM_EXP = { sanctifyingUnction: 2500, sanctifyingEssence: 10000 };

function toInt(value) {
  var number = parseInt(value, 10);
  return isNaN(number) ? 0 : number;
}

Page({
  data: {
    statusBarHeight: 20,
    game: 'genshin',
    g: gameLib.config('genshin'),
    res: {},
    editing: false,
    exp: {},
    charNames: CHAR_NAMES,
    selectedChar: '',
    pickerVisible: false,
    charPlanView: [],
    showStock: false,
    showExp: false,
    stockItems: [],
    fromLevels: CHAR_LEVELS,
    fromIndex: 0,
    toLevels: toLevelsFor(1),
    toIndex: 0,
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
      res: res,
      stockItems: [
        { label: '大英雄的经验', valueText: store.fmt(res.heroWit), note: '20,000 经验 / 本' },
        { label: '冒险家的经验', valueText: store.fmt(res.adventurerExp), note: '5,000 经验 / 本' },
        { label: '流浪者的经验', valueText: store.fmt(res.wandererAdvice), note: '1,000 经验 / 本' },
        { label: '祝圣油膏', valueText: store.fmt(res.sanctifyingUnction), note: '2,500 经验 / 个' },
        { label: '祝圣精华', valueText: store.fmt(res.sanctifyingEssence), note: '10,000 经验 / 个' }
      ]
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
    var needed = 0;
    var planView = plan.map(function (row, index) {
      var step = levelPlan(row.from, row.to);
      needed += step.exp;
      return {
        name: row.name || ('角色 ' + (index + 1)),
        fromLevel: step.from,
        toLevel: step.to,
        expText: store.fmt(step.exp) + ' 经验',
        starText: step.stars ? ' · 命星 ' + step.stars + ' 枚' : ''
      };
    });

    var fromLevel = this.data.fromLevels[this.data.fromIndex];
    var toLevel = this.data.toLevels[this.data.toIndex];
    var preview = levelPlan(fromLevel, toLevel);
    var available = Math.max(0, charTotal - needed);
    var artCount = Math.floor(artTotal / FIVE_STAR_ARTIFACT_EXP);
    var artRest = artTotal % FIVE_STAR_ARTIFACT_EXP;

    this.setData({
      charPlanView: planView,
      exp: {
        charTotalText: store.fmt(charTotal),
        artTotalText: store.fmt(artTotal),
        charPreviewText: 'Lv ' + preview.from + ' → Lv ' + preview.to
          + ' · 需 ' + store.fmt(preview.exp) + ' 经验'
          + (preview.stars ? ' · 无主的命星 ' + preview.stars + ' 枚' : '')
          + (preview.exp > available
            ? ' · 还差 ' + store.fmt(preview.exp - available)
            : ' · 可用 ' + store.fmt(available) + '，足够'),
        planNeedText: planView.length
          ? store.fmt(needed) + ' 经验 · 可用 ' + store.fmt(charTotal)
          : '',
        planDiffText: needed > charTotal
          ? '还差 ' + store.fmt(needed - charTotal)
          : '剩余 ' + store.fmt(charTotal - needed),
        artCount: store.fmt(artCount),
        artRestText: store.fmt(artRest),
        artNote: artRest > 0
          ? '距下一个还差 ' + store.fmt(FIVE_STAR_ARTIFACT_EXP - artRest) + ' 经验'
          : '刚好凑整'
      }
    });
  },

  toggleStock: function () {
    this.setData({ showStock: !this.data.showStock });
  },

  toggleExp: function () {
    this.setData({ showExp: !this.data.showExp });
  },

  onOpenPicker: function () {
    this.setData({ pickerVisible: true });
  },

  onClosePicker: function () {
    this.setData({ pickerVisible: false });
  },

  onPickChar: function (event) {
    this.setData({
      selectedChar: event.detail.name || '',
      pickerVisible: false
    });
  },

  onCharFrom: function (event) {
    var index = Number(event.detail.value) || 0;
    var from = this.data.fromLevels[index];
    var levels = toLevelsFor(from);
    var previous = this.data.toLevels[this.data.toIndex];
    var toIndex = levels.indexOf(previous);
    this.setData({
      fromIndex: index,
      toLevels: levels,
      toIndex: toIndex >= 0 ? toIndex : 0
    });
    this.applyExp();
  },

  onCharTo: function (event) {
    this.setData({ toIndex: Number(event.detail.value) || 0 });
    this.applyExp();
  },

  onAddChar: function () {
    this._charPlan = this._charPlan || [];
    this._charPlan.push({
      name: this.data.selectedChar,
      from: this.data.fromLevels[this.data.fromIndex],
      to: this.data.toLevels[this.data.toIndex]
    });
    this.setData({
      selectedChar: '',
      fromIndex: 0,
      toLevels: toLevelsFor(this.data.fromLevels[0]),
      toIndex: 0
    });
    this.applyExp();
  },

  onRemoveChar: function (event) {
    var index = Number(event.currentTarget.dataset.index);
    if (this._charPlan && index >= 0) {
      this._charPlan.splice(index, 1);
    }
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
