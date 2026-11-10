var app = getApp();
var gameLib = require('../../utils/game');
var collection = require('../../utils/collection');
var catalog = require('../../utils/catalog');
var ai = require('../../utils/ai');

/** 收藏分组与角色 / 武器数量，供加载和联网更新后复用 */
function sectionsOf(game) {
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
  return {
    sections: sections,
    characterCount: characterCount,
    weaponCount: weaponCount
  };
}

Page({
  data: {
    statusBarHeight: 20,
    game: 'genshin',
    g: gameLib.config('genshin'),
    sections: [],
    characterCount: 0,
    weaponCount: 0,
    catalogUpdatedAt: '',
    catalogUpdating: false,
    manualOpen: false,
    manualCategory: 'characters4',
    manualCategories: [],
    manualNames: [],
    manualName: '',
    manualIcon: '',
    pickerVisible: false,
    manualCopies: ['1', '2', '3', '4', '5', '6', '7'],
    manualCopiesIndex: 0,
    aiVisible: false,
    aiText: '',
    aiError: '',
    aiRows: [],
    aiReady: false
  },

  onLoad: function () {
    var info = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: info.statusBarHeight || 20 });
  },

  onShow: function () {
    this.syncCatalog(app.globalData.game, true);
  },

  onSwitchGame: function (event) {
    app.setGame(event.detail.game);
    this.syncCatalog(event.detail.game, true);
  },

  load: function (game) {
    var g = gameLib.config(game);
    var patch = sectionsOf(game);
    patch.game = game;
    patch.g = g;
    patch.manualOpen = false;
    patch.manualCategory = 'characters4';
    patch.manualName = '';
    patch.manualIcon = '';
    patch.pickerVisible = false;
    patch.manualCopiesIndex = 0;
    patch.aiVisible = false;
    patch.aiText = '';
    patch.aiError = '';
    patch.aiRows = [];
    patch.aiReady = false;
    patch.manualNames = collection.nameOptions(game, 'characters4');
    patch.manualCategories = [
      { key: 'characters4', label: '四星角色' },
      { key: 'characters5', label: '五星角色' },
      { key: 'weapons5', label: '五星' + g.itemTypes[1] }
    ];
    this.setData(patch);
  },

  /**
   * 图鉴联网同步：先并入上次缓存；auto 为 true 时仅在缓存超过 24 小时才后台更新，
   * 手动刷新（auto=false）总会请求并提示结果。
   */
  syncCatalog: function (game, auto) {
    var that = this;
    var cached = catalog.applyCached(game);
    this.load(game);
    this.setData({ catalogUpdatedAt: cached ? cached.updatedAt : catalog.cachedAt(game) });
    if (auto && catalog.isFresh(game)) {
      return;
    }
    this.setData({ catalogUpdating: true });
    catalog.refresh(game).then(function (result) {
      if (that.data.game !== game) {
        return;
      }
      that.setData({ catalogUpdating: false, catalogUpdatedAt: result.updatedAt });
      if (that.data.manualOpen) {
        that.setData(sectionsOf(game));
      } else {
        that.load(game);
      }
      if (result.addedCharacters || result.addedWeapons) {
        wx.showToast({ title: '图鉴已更新', icon: 'none' });
      } else if (!auto) {
        wx.showToast({ title: '图鉴已是最新', icon: 'none' });
      }
    }, function (err) {
      if (that.data.game !== game) {
        return;
      }
      that.setData({ catalogUpdating: false });
      if (!auto) {
        wx.showToast({ title: (err && err.message) || '图鉴联网失败', icon: 'none' });
      }
    });
  },

  onRefreshCatalog: function () {
    this.syncCatalog(this.data.game, false);
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
  },

  noop: function () {
  },

  /* ---------------- AI 自然语言录入（离线解析，按命座 / 精炼补差） ---------------- */

  openAiEntry: function () {
    this._aiRows = [];
    this.setData({ aiVisible: true, aiText: '', aiError: '', aiRows: [], aiReady: false });
  },

  closeAiEntry: function () {
    this._aiRows = [];
    this.setData({ aiVisible: false, aiRows: [], aiError: '', aiReady: false });
  },

  onAiInput: function (event) {
    this.setData({ aiText: event.detail.value, aiError: '', aiReady: false });
  },

  parseAiEntry: function () {
    var game = this.data.game;
    var batch = ai.parseLines(this.data.aiText, game);
    if (!batch.lines.length) {
      this.setData({ aiError: '先输入一句话', aiReady: false });
      return;
    }
    if (batch.failures.length) {
      this.setData({
        aiError: '第 ' + batch.failures.join('、') + ' 行没解析出来，'
          + '参考「莫娜 3命」「满命钟离」「精5 天空之翼」',
        aiReady: false
      });
      return;
    }
    var owned = batch.items.filter(function (item) {
      return item.type === 'owned';
    });
    if (!owned.length) {
      this.setData({
        aiError: '没识别到角色 / 武器；抽卡请到「抽卡」页、资源请到「资源」页用 AI 录入',
        aiReady: false
      });
      return;
    }

    // 当前份数表：抽卡记录 + 手动补充（与图鉴展示口径一致）
    var current = {};
    sectionsOf(game).sections.forEach(function (section) {
      section.items.forEach(function (item) {
        current[section.key + '|' + item.name] = item.copies;
      });
    });
    var labels = {
      characters4: '四星角色',
      characters5: '五星角色',
      weapons5: game === 'starrail' ? '五星光锥' : '五星武器'
    };

    var rows = owned.map(function (item, index) {
      var key = item.values.category + '|' + item.values.name;
      var copies = current[key] || 0;
      var delta = Math.max(0, item.values.target - copies);
      return {
        index: index + 1,
        name: item.values.name,
        category: item.values.category,
        categoryLabel: labels[item.values.category] || '',
        target: ai.badge(item.values.category, item.values.target),
        copies: copies,
        delta: delta,
        done: delta === 0,
        deltaText: delta ? '+ ' + delta : '已达标'
      };
    });

    this._aiRows = rows;
    this.setData({
      aiError: '',
      aiReady: rows.some(function (row) { return row.delta > 0; }),
      aiRows: rows
    });
  },

  confirmAiBatch: function () {
    var rows = this._aiRows || [];
    var todo = rows.filter(function (row) {
      return row.delta > 0;
    });
    if (!todo.length) {
      wx.showToast({ title: '都已达标，无需补充', icon: 'none' });
      return;
    }
    var game = this.data.game;
    todo.forEach(function (row) {
      collection.addManual(game, row.category, row.name, row.delta);
    });
    this._aiRows = [];
    this.setData({ aiVisible: false, aiRows: [], aiReady: false, aiText: '' });
    this.load(game);
    wx.showToast({ title: '已补充 ' + todo.length + ' 个图鉴项', icon: 'none' });
  }
});
