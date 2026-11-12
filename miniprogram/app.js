var gameLib = require('./utils/game');
var catalog = require('./utils/catalog');

App({
  globalData: {
    game: 'genshin'
  },

  onLaunch: function () {
    // 先把上次联网更新的图鉴并入内置名单，保证本机离线时也能看到新角色 / 新武器
    catalog.applyCached('genshin');
    catalog.applyCached('starrail');
    if (wx.cloud) {
      try {
        // traceUser 关闭：不把用户身份信息记到云端访问日志里，云同步只按同步码哈希存取密文
        wx.cloud.init({ env: 'qq740194789-d5ghcyv7x748499f9', traceUser: false });
      } catch (e) {
        /* 未开通云开发时忽略，链接导入会给出提示 */
      }
    }
    var saved = wx.getStorageSync('sg_game');
    if (saved && gameLib.GAMES[saved]) {
      this.globalData.game = saved;
    }
    // 当前游戏图鉴超过 24 小时（或从未更新）时静默联网更新，失败不影响离线使用
    if (!catalog.isFresh(this.globalData.game)) {
      catalog.refresh(this.globalData.game).catch(function () {});
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
