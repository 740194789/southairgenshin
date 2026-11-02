var app = getApp();
var store = require('../../utils/store');
var gameLib = require('../../utils/game');

Page({
  data: {
    statusBarHeight: 20,
    game: 'genshin',
    g: gameLib.config('genshin'),
    res: {},
    editing: false,
    form: {
      primogems: '',
      mora: '',
      intertwinedFates: '',
      acquaintedFates: '',
      dailyPrimogems: ''
    }
  },

  onLoad: function () {
    var info = wx.getSystemInfoSync();
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
        dailyPrimogems: String(resource.dailyPrimogems || 0)
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
      dailyPrimogems: form.dailyPrimogems
    });
    this.setData({ editing: false });
    this.load(this.data.game);
    wx.showToast({ title: '已保存', icon: 'success' });
  }
});
