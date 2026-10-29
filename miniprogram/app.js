var gameLib = require('./utils/game');

App({
  globalData: {
    game: 'genshin'
  },

  onLaunch: function () {
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
