var app = getApp();
var gameLib = require('../../utils/game');
var collection = require('../../utils/collection');

var MANUAL_LABELS = {
  characters4: '四星角色',
  characters5: '五星角色',
  weapons5: '五星武器 / 光锥'
};

Page({
  data: {
    statusBarHeight: 20,
    game: 'genshin',
    g: gameLib.config('genshin'),
    sections: [],
    characterCount: 0,
    weaponCount: 0
  },

  onLoad: function () {
    var info = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: info.statusBarHeight || 20 });
  },

  onShow: function () {
    this.load(app.globalData.game);
  },

  onSwitchGame: function (event) {
    app.setGame(event.detail.game);
    this.load(event.detail.game);
  },

  load: function (game) {
    var sections = collection.build(game);
    var characterCount = 0;
    var weaponCount = 0;
    sections.forEach(function (section) {
      if (section.kind === 'character') {
        characterCount += section.items.length;
      } else {
        weaponCount += section.items.length;
      }
    });
    this.setData({
      game: game,
      g: gameLib.config(game),
      sections: sections,
      characterCount: characterCount,
      weaponCount: weaponCount
    });
  },

  onImageError: function (event) {
    var si = Number(event.currentTarget.dataset.si);
    var ii = Number(event.currentTarget.dataset.ii);
    var patch = {};
    patch['sections[' + si + '].items[' + ii + '].icon'] = '';
    this.setData(patch);
  },

  addManual: function () {
    var that = this;
    var categories = ['characters4', 'characters5', 'weapons5'];
    var weaponLabel = this.data.g.itemTypes[1] === '光锥' ? '五星光锥' : '五星武器';
    wx.showActionSheet({
      itemList: [MANUAL_LABELS.characters4, MANUAL_LABELS.characters5, weaponLabel],
      success: function (sectionRes) {
        var category = categories[sectionRes.tapIndex];
        var categoryLabel = category === 'weapons5' ? weaponLabel : MANUAL_LABELS[category];
        wx.showModal({
          title: categoryLabel,
          editable: true,
          placeholderText: '输入角色 / 武器名称',
          success: function (nameRes) {
            if (!nameRes.confirm) {
              return;
            }
            var name = String(nameRes.content || '').trim();
            if (!name) {
              wx.showToast({ title: '请输入名称', icon: 'none' });
              return;
            }
            wx.showModal({
              title: '额外数量',
              editable: true,
              content: '1–6；角色按命座折算，武器按精炼折算',
              placeholderText: '例如 2',
              success: function (countRes) {
                if (!countRes.confirm) {
                  return;
                }
                var text = String(countRes.content || '').trim();
                if (!text) {
                  return;
                }
                var copies = Math.floor(Number(text));
                if (!isFinite(copies) || copies < 1 || copies > 6) {
                  wx.showToast({ title: '数量需在 1–6 之间', icon: 'none' });
                  return;
                }
                collection.addManual(that.data.game, category, name, copies);
                that.load(that.data.game);
                wx.showToast({ title: '已补充 ' + name + ' ×' + copies, icon: 'none' });
              }
            });
          }
        });
      }
    });
  },

  removeManual: function (event) {
    var that = this;
    var section = event.currentTarget.dataset.section;
    var name = event.currentTarget.dataset.name;
    wx.showModal({
      title: '清除手动补充',
      content: '确定清除「' + name + '」的手动补充吗？',
      confirmColor: '#ff6b6b',
      success: function (res) {
        if (!res.confirm) {
          return;
        }
        collection.removeManual(that.data.game, section, name);
        that.load(that.data.game);
        wx.showToast({ title: '已清除', icon: 'none' });
      }
    });
  }
});
