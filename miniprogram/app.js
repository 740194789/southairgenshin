var gameLib = require('./utils/game');
var api = require('./utils/api');
var store = require('./utils/store');

var OFFLINE_KEY = 'sg_offline';

App({
  globalData: {
    game: 'genshin',
    user: null
  },

  onLaunch: function () {
    var saved = wx.getStorageSync('sg_game');
    if (saved && gameLib.GAMES[saved]) {
      this.globalData.game = saved;
    }

    var user = api.getUser();
    if (user && !api.getToken()) {
      api.clearAuth();
      user = null;
    }
    this.globalData.user = user;
    store.setUser(user ? user.id : null);
  },

  setGame: function (game) {
    if (!gameLib.GAMES[game]) {
      return;
    }
    this.globalData.game = game;
    wx.setStorageSync('sg_game', game);
  },

  /** 登录 / 注册成功后调用：保存凭证并切换本地数据命名空间 */
  applyUser: function (token, user) {
    api.saveAuth(token, user);
    store.setUser(user.id);
    this.globalData.user = user;
    wx.removeStorageSync(OFFLINE_KEY);
  },

  isOfflineMode: function () {
    return wx.getStorageSync(OFFLINE_KEY) === '1';
  },

  useOffline: function () {
    wx.setStorageSync(OFFLINE_KEY, '1');
    store.setUser(null);
    this.globalData.user = null;
  },

  /** 登录态失效：退回登录页，本机数据仍保留在原账号目录下 */
  handleAuthExpired: function () {
    api.clearAuth();
    store.setUser(null);
    this.globalData.user = null;
    wx.showModal({
      title: '登录已失效',
      content: '请重新登录，本机数据不会丢失。',
      showCancel: false,
      success: function () {
        wx.reLaunch({ url: '/pages/login/index' });
      }
    });
  }
});
