var app = getApp();
var store = require('../../utils/store');
var gameLib = require('../../utils/game');
var sync = require('../../utils/sync');
var api = require('../../utils/api');

Page({
  data: {
    statusBarHeight: 20,
    game: 'genshin',
    g: gameLib.config('genshin'),
    res: {},
    user: null,
    syncText: '未登录 / 离线',
    syncing: false,
    editing: false,
    form: {
      primogems: '',
      mora: '',
      intertwinedFates: '',
      acquaintedFates: ''
    }
  },

  onLoad: function () {
    var info = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: info.statusBarHeight || 20 });
  },

  onShow: function () {
    if (!app.globalData.user && !app.isOfflineMode()) {
      wx.reLaunch({ url: '/pages/login/index' });
      return;
    }
    this.setData({ user: app.globalData.user });
    this.load(app.globalData.game);
    this.refreshSync(false);
  },

  /** 联网时自动合并；成功后用服务端快照覆盖本地 */
  refreshSync: function (force) {
    var that = this;
    if (!sync.enabled()) {
      this.setData({ syncText: app.globalData.user ? '未配置同步服务器' : '离线模式' });
      return;
    }
    this.setData({ syncing: true });
    sync.sync(this.data.game, force).then(function (result) {
      that.setData({
        syncing: false,
        syncText: result.ok && !result.skipped ? sync.statusText(that.data.game) : (result.message || sync.statusText(that.data.game))
      });
      if (result.ok && !result.skipped) {
        that.load(that.data.game);
      }
    });
  },

  onSyncTap: function () {
    if (this.data.syncing) {
      return;
    }
    var that = this;
    this.setData({ syncing: true });
    sync.syncAll(true).then(function (results) {
      var failed = results.filter(function (item) {
        return !item.ok;
      });
      that.setData({
        syncing: false,
        syncText: failed.length ? (failed[0].message || '同步失败') : sync.statusText(that.data.game)
      });
      if (!failed.length) {
        that.load(that.data.game);
        wx.showToast({ title: '同步完成', icon: 'success' });
      } else {
        wx.showToast({ title: failed[0].message || '同步失败', icon: 'none' });
      }
    });
  },

  goLogin: function () {
    wx.reLaunch({ url: '/pages/login/index' });
  },

  logout: function () {
    wx.showModal({
      title: '退出登录',
      content: '本机数据仍保留在该账号目录下，重新登录后可继续使用。',
      success: function (res) {
        if (!res.confirm) {
          return;
        }
        api.clearAuth();
        store.setUser(null);
        app.globalData.user = null;
        wx.reLaunch({ url: '/pages/login/index' });
      }
    });
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
        acquaintedFates: String(resource.acquaintedFates)
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
      acquaintedFates: form.acquaintedFates
    });
    this.setData({ editing: false });
    this.load(this.data.game);
    wx.showToast({ title: '已保存', icon: 'success' });
    if (sync.enabled()) {
      this.refreshSync(true);
    }
  }
});
