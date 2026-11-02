var app = getApp();
var gameLib = require('../../utils/game');
var collection = require('../../utils/collection');

Page({
  data: {
    statusBarHeight: 20,
    game: 'genshin',
    g: gameLib.config('genshin'),
    sections: [],
    characterCount: 0,
    weaponCount: 0,
    manualOpen: false,
    manualCategory: 'characters4',
    manualCategories: [],
    manualNames: [],
    manualName: '',
    manualIcon: '',
    pickerVisible: false,
    manualCopies: ['1', '2', '3', '4', '5', '6'],
    manualCopiesIndex: 0
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
    var g = gameLib.config(game);
    this.setData({
      game: game,
      g: g,
      sections: sections,
      characterCount: characterCount,
      weaponCount: weaponCount,
      manualOpen: false,
      manualCategory: 'characters4',
      manualName: '',
      manualIcon: '',
      pickerVisible: false,
      manualCopiesIndex: 0,
      manualNames: collection.nameOptions(game, 'characters4'),
      manualCategories: [
        { key: 'characters4', label: '四星角色' },
        { key: 'characters5', label: '五星角色' },
        { key: 'weapons5', label: '五星' + g.itemTypes[1] }
      ]
    });
  },

  onImageError: function (event) {
    var si = Number(event.currentTarget.dataset.si);
    var ii = Number(event.currentTarget.dataset.ii);
    var patch = {};
    patch['sections[' + si + '].items[' + ii + '].icon'] = '';
    this.setData(patch);
  },

  openManual: function () {
    this.setData({
      manualOpen: true,
      manualCategory: 'characters4',
      manualName: '',
      manualIcon: '',
      manualCopiesIndex: 0,
      manualNames: collection.nameOptions(this.data.game, 'characters4')
    });
  },

  closeManual: function () {
    this.setData({ manualOpen: false });
  },

  onManualCategory: function (event) {
    var category = event.currentTarget.dataset.key;
    this.setData({
      manualCategory: category,
      manualName: '',
      manualIcon: '',
      manualNames: collection.nameOptions(this.data.game, category)
    });
  },

  openNamePicker: function () {
    this.setData({ pickerVisible: true });
  },

  closeNamePicker: function () {
    this.setData({ pickerVisible: false });
  },

  onManualName: function (event) {
    var detail = event.detail || {};
    this.setData({
      pickerVisible: false,
      manualName: detail.name || '',
      manualIcon: detail.icon || ''
    });
  },

  onManualCopies: function (event) {
    this.setData({ manualCopiesIndex: Number(event.detail.value) || 0 });
  },

  confirmManual: function () {
    var name = this.data.manualName;
    if (!name) {
      wx.showToast({ title: '请选择角色 / 物品', icon: 'none' });
      return;
    }
    var copies = this.data.manualCopiesIndex + 1;
    collection.addManual(this.data.game, this.data.manualCategory, name, copies);
    this.load(this.data.game);
    wx.showToast({ title: '已补充 ' + name + ' ×' + copies, icon: 'none' });
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
