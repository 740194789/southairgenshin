var gameLib = require('./utils/game');

App({
  globalData: {
    game: 'genshin'
  },

  onLaunch: function () {
    if (wx.cloud) {
      try {
        wx.cloud.init({ traceUser: true });
      } catch (e) {
        /* 未开通云开发时忽略，链接导入会给出提示 */
      }
    }
    var saved = wx.getStorageSync('sg_game');
    if (saved && gameLib.GAMES[saved]) {
      this.globalData.game = saved;
    }
  },

  setGame: function (game) {
    if (!gameLib.GAMES[game]) {
      return;
    }
    this.globalData.game = game;
    wx.setStorageSync('sg_game', game);
  }
});
