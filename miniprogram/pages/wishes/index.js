var app = getApp();
var store = require('../../utils/store');
var gameLib = require('../../utils/game');
var csv = require('../../utils/csv');
var file = require('../../utils/file');
var sync = require('../../utils/sync');

var RARITY_VALUES = [3, 4, 5];
var RARITY_LABELS = ['3 星', '4 星', '5 星'];
var PAGE_SIZE = 10;

function starText(rarity) {
  var count = Math.max(0, Math.min(5, Number(rarity) || 0));
  var text = '';
  for (var i = 0; i < count; i++) {
    text += '★';
  }
  return text;
}

function nowParts() {
  var now = store.nowStr();
  return {
    date: now.slice(0, 10),
    time: now.slice(11, 16)
  };
}

function editorDefaults(g, poolIndex) {
  var parts = nowParts();
  return {
    itemName: '',
    rarityIndex: 2,
    typeIndex: 0,
    poolIndex: poolIndex || 0,
    isUp: true,
    pity: '1',
    date: parts.date,
    time: parts.time,
    note: ''
  };
}

Page({
  data: {
    statusBarHeight: 20,
    game: 'genshin',
    g: gameLib.config('genshin'),
    poolOptions: ['全部卡池'].concat(gameLib.config('genshin').pools),
    poolIndex: 0,
    rows: [],
    page: 1,
    pages: 1,
    total: 0,
    selected: [],
    selectedCount: 0,
    rarityLabels: RARITY_LABELS,
    typeOptions: gameLib.config('genshin').itemTypes,
    editorVisible: false,
    editorId: null,
    editor: editorDefaults(gameLib.config('genshin'), 0),
    batchVisible: false,
    batch: {
      poolIndex: 0,
      date: '',
      time: '',
      rows: []
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
    this.load(app.globalData.game);
    this.syncNow(false);
  },

  /** 联网时自动合并，成功后重新加载列表 */
  syncNow: function (force) {
    var that = this;
    if (!sync.enabled()) {
      return;
    }
    sync.sync(this.data.game, force).then(function (result) {
      if (result.ok && !result.skipped) {
        that.load();
      }
    });
  },

  onSwitchGame: function (event) {
    var game = event.detail.game;
    app.setGame(game);
    var g = gameLib.config(game);
    this.setData({
      game: game,
      g: g,
      poolOptions: ['全部卡池'].concat(g.pools),
      poolIndex: 0,
      page: 1,
      selected: [],
      selectedCount: 0,
      typeOptions: g.itemTypes,
      editorVisible: false,
      batchVisible: false
    });
    this.load();
    this.syncNow(false);
  },

  /* ---------------- 列表 ---------------- */

  load: function () {
    var game = this.data.game;
    var pool = this.data.poolIndex === 0 ? '' : this.data.g.pools[this.data.poolIndex - 1];
    var result = store.pageWishes(game, pool, this.data.page, PAGE_SIZE);
    var selected = this.data.selected;
    var rows = result.records.map(function (record) {
      return {
        id: record.clientUid,
        shortId: (record.clientUid || '').slice(-6),
        displayName: record.itemName || '三星物品',
        stars: starText(record.rarity),
        rarity: record.rarity,
        itemType: record.itemType || '—',
        pool: record.pool || '未知卡池',
        isUp: record.isUp === true,
        pityCount: record.pityCount || 1,
        time: (record.wishTime || '').slice(0, 16),
        checked: selected.indexOf(record.clientUid) >= 0
      };
    });

    this.setData({
      rows: rows,
      page: result.page,
      pages: result.pages,
      total: result.total
    });
  },

  onPoolChange: function (event) {
    this.setData({
      poolIndex: Number(event.detail.value),
      page: 1,
      selected: [],
      selectedCount: 0
    });
    this.load();
  },

  prevPage: function () {
    if (this.data.page <= 1) {
      return;
    }
    this.setData({
      page: this.data.page - 1,
      selected: [],
      selectedCount: 0
    });
    this.load();
  },

  nextPage: function () {
    if (this.data.page >= this.data.pages) {
      return;
    }
    this.setData({
      page: this.data.page + 1,
      selected: [],
      selectedCount: 0
    });
    this.load();
  },

  toggleSelect: function (event) {
    var id = String(event.currentTarget.dataset.id);
    var selected = this.data.selected.slice();
    var index = selected.indexOf(id);
    if (index >= 0) {
      selected.splice(index, 1);
    } else {
      selected.push(id);
    }
    var rows = this.data.rows.map(function (row) {
      if (row.id === id) {
        row.checked = index < 0;
      }
      return row;
    });
    this.setData({
      selected: selected,
      selectedCount: selected.length,
      rows: rows
    });
  },

  deleteSelected: function () {
    if (!this.data.selectedCount) {
      return;
    }
    var that = this;
    var count = this.data.selectedCount;
    wx.showModal({
      title: '批量删除',
      content: '确定删除选中的 ' + count + ' 条抽卡记录吗？',
      confirmColor: '#ff6b6b',
      success: function (res) {
        if (!res.confirm) {
          return;
        }
        store.deleteWishes(that.data.game, that.data.selected);
        that.setData({ selected: [], selectedCount: 0, page: 1 });
        that.load();
        that.syncNow(true);
        wx.showToast({ title: '已删除 ' + count + ' 条', icon: 'none' });
      }
    });
  },

  removeRow: function (event) {
    var that = this;
    var id = String(event.currentTarget.dataset.id);
    var row = this.data.rows.filter(function (item) {
      return item.id === id;
    })[0];
    if (!row) {
      return;
    }
    wx.showModal({
      title: '删除记录',
      content: '确定删除「' + row.displayName + '」这条抽卡记录吗？',
      confirmColor: '#ff6b6b',
      success: function (res) {
        if (!res.confirm) {
          return;
        }
        store.deleteWishes(that.data.game, [id]);
        var selected = that.data.selected.filter(function (item) {
          return item !== id;
        });
        that.setData({ selected: selected, selectedCount: selected.length });
        that.load();
        that.syncNow(true);
        wx.showToast({ title: '已删除', icon: 'success' });
      }
    });
  },

  /* ---------------- 单条编辑 ---------------- */

  openAdd: function () {
    var poolIndex = this.data.poolIndex > 0 ? this.data.poolIndex - 1 : 0;
    this.setData({
      editorVisible: true,
      editorId: null,
      editor: editorDefaults(this.data.g, poolIndex)
    });
  },

  editRow: function (event) {
    var id = String(event.currentTarget.dataset.id);
    var row = this.data.rows.filter(function (item) {
      return item.id === id;
    })[0];
    if (!row) {
      return;
    }
    var record = store.getWishes(this.data.game).filter(function (item) {
      return item.clientUid === id;
    })[0];
    if (!record) {
      return;
    }
    var g = this.data.g;
    var wishTime = record.wishTime || store.nowStr();
    var typeIndex = g.itemTypes.indexOf(record.itemType);
    var poolIndex = g.pools.indexOf(record.pool);
    this.setData({
      editorVisible: true,
      editorId: id,
      editor: {
        itemName: record.rarity === 3 && record.itemName === '三星物品' ? '' : (record.itemName || ''),
        rarityIndex: Math.max(0, Math.min(2, (record.rarity || 3) - 3)),
        typeIndex: typeIndex < 0 ? 0 : typeIndex,
        poolIndex: poolIndex < 0 ? 0 : poolIndex,
        isUp: record.isUp === true,
        pity: String(record.pityCount || 1),
        date: wishTime.slice(0, 10),
        time: wishTime.slice(11, 16),
        note: record.note || ''
      }
    });
  },

  closeEditor: function () {
    this.setData({ editorVisible: false });
  },

  noop: function () {
  },

  onEditorName: function (event) {
    this.setData({ 'editor.itemName': event.detail.value });
  },

  onEditorRarity: function (event) {
    this.setData({ 'editor.rarityIndex': Number(event.detail.value) });
  },

  onEditorType: function (event) {
    this.setData({ 'editor.typeIndex': Number(event.detail.value) });
  },

  onEditorPool: function (event) {
    this.setData({ 'editor.poolIndex': Number(event.detail.value) });
  },

  onEditorUp: function (event) {
    this.setData({ 'editor.isUp': event.detail.value });
  },

  onEditorPity: function (event) {
    this.setData({ 'editor.pity': event.detail.value });
  },

  onEditorDate: function (event) {
    this.setData({ 'editor.date': event.detail.value });
  },

  onEditorTime: function (event) {
    this.setData({ 'editor.time': event.detail.value });
  },

  onEditorNote: function (event) {
    this.setData({ 'editor.note': event.detail.value });
  },

  saveEditor: function () {
    var editor = this.data.editor;
    var g = this.data.g;
    var editing = !!this.data.editorId;
    var rarity = RARITY_VALUES[editor.rarityIndex] || 3;
    var name = (editor.itemName || '').trim();
    if (rarity > 3 && !name) {
      wx.showToast({ title: '四星 / 五星请填写名称（三星可留空）', icon: 'none' });
      return;
    }
    var data = {
      itemName: name,
      rarity: rarity,
      itemType: g.itemTypes[editor.typeIndex] || g.itemTypes[0],
      pool: g.pools[editor.poolIndex] || g.pools[0],
      isUp: editor.isUp,
      pityCount: Number(editor.pity) || 1,
      wishTime: editor.date + ' ' + editor.time + ':00',
      note: editor.note
    };
    if (editing) {
      store.updateWish(this.data.game, this.data.editorId, data);
    } else {
      store.addWish(this.data.game, data);
    }
    this.setData({ editorVisible: false });
    this.load();
    this.syncNow(true);
    wx.showToast({ title: editing ? '修改已保存' : '新增成功', icon: 'success' });
  },

  /* ---------------- 十连录入 ---------------- */

  openBatch: function () {
    var parts = nowParts();
    var rows = [];
    for (var i = 0; i < 10; i++) {
      rows.push({
        key: i,
        rarityIndex: 0,
        name: '',
        up: false,
        pity: '1'
      });
    }
    this.setData({
      batchVisible: true,
      batch: {
        poolIndex: this.data.poolIndex > 0 ? this.data.poolIndex - 1 : 0,
        date: parts.date,
        time: parts.time,
        rows: rows
      }
    });
  },

  closeBatch: function () {
    this.setData({ batchVisible: false });
  },

  onBatchPool: function (event) {
    this.setData({ 'batch.poolIndex': Number(event.detail.value) });
  },

  onBatchDate: function (event) {
    this.setData({ 'batch.date': event.detail.value });
  },

  onBatchTime: function (event) {
    this.setData({ 'batch.time': event.detail.value });
  },

  onBatchRarity: function (event) {
    var index = Number(event.currentTarget.dataset.index);
    this.setData(this.nested('batch.rows[' + index + '].rarityIndex', Number(event.detail.value)));
  },

  onBatchName: function (event) {
    var index = Number(event.currentTarget.dataset.index);
    this.setData(this.nested('batch.rows[' + index + '].name', event.detail.value));
  },

  onBatchUp: function (event) {
    var index = Number(event.currentTarget.dataset.index);
    var row = this.data.batch.rows[index];
    if (!row) {
      return;
    }
    this.setData(this.nested('batch.rows[' + index + '].up', !row.up));
  },

  onBatchPity: function (event) {
    var index = Number(event.currentTarget.dataset.index);
    this.setData(this.nested('batch.rows[' + index + '].pity', event.detail.value));
  },

  nested: function (path, value) {
    var patch = {};
    patch[path] = value;
    return patch;
  },

  saveBatch: function () {
    var batch = this.data.batch;
    var g = this.data.g;
    var records = [];
    for (var i = 0; i < batch.rows.length; i++) {
      var row = batch.rows[i];
      var rarity = RARITY_VALUES[row.rarityIndex] || 3;
      var name = (row.name || '').trim();
      if (rarity > 3 && !name) {
        wx.showToast({ title: '第 ' + (i + 1) + ' 行是 ' + rarity + ' 星，请填写名称', icon: 'none' });
        return;
      }
      records.push({
        itemName: name,
        rarity: rarity,
        itemType: rarity === 3 ? g.threeStarType : g.itemTypes[0],
        pool: g.pools[batch.poolIndex] || g.pools[0],
        isUp: row.up,
        pityCount: Number(row.pity) || 1,
        wishTime: batch.date + ' ' + batch.time + ':00'
      });
    }
    store.addWishes(this.data.game, records);
    this.setData({ batchVisible: false, page: 1, selected: [], selectedCount: 0 });
    this.load();
    this.syncNow(true);
    wx.showToast({ title: '已保存 10 抽', icon: 'success' });
  },

  /* ---------------- 导入 / 导出 ---------------- */

  exportCsv: function () {
    var records = store.exportRecords(this.data.game);
    if (!records.length) {
      wx.showToast({ title: '还没有抽卡记录', icon: 'none' });
      return;
    }
    file.exportFile('southair-wishes-' + this.data.game + '.csv', csv.write(records));
  },

  exportJson: function () {
    var records = store.exportRecords(this.data.game);
    if (!records.length) {
      wx.showToast({ title: '还没有抽卡记录', icon: 'none' });
      return;
    }
    file.exportFile('southair-wishes-' + this.data.game + '.json', JSON.stringify(records, null, 2));
  },

  importRecords: function () {
    var that = this;
    file.chooseFile(['csv', 'json']).then(function (picked) {
      var records = [];
      if (/\.json$/i.test(picked.name)) {
        try {
          var payload = JSON.parse(picked.content);
          records = Array.isArray(payload) ? payload : (payload.wishes || []);
        } catch (e) {
          wx.showToast({ title: '不是有效的 JSON 文件', icon: 'none' });
          return;
        }
      } else {
        records = csv.parse(picked.content);
      }

      if (!records.length) {
        wx.showToast({ title: '文件里没有可导入的记录', icon: 'none' });
        return;
      }

      wx.showActionSheet({
        itemList: ['合并导入（按名称+卡池+时间去重）', '覆盖导入（清空当前游戏记录）'],
        success: function (res) {
          var mode = res.tapIndex === 1 ? 'replace' : 'merge';
          if (mode === 'replace') {
            wx.showModal({
              title: '覆盖导入',
              content: '覆盖导入会清空当前游戏的全部抽卡记录，确定继续吗？',
              confirmColor: '#ff6b6b',
              success: function (confirm) {
                if (!confirm.confirm) {
                  return;
                }
                that.applyImport(records, mode);
              }
            });
            return;
          }
          that.applyImport(records, mode);
        }
      });
    }).catch(function (err) {
      wx.showToast({ title: err && err.message ? err.message : '导入失败', icon: 'none' });
    });
  },

  applyImport: function (records, mode) {
    var result = store.importRecords(this.data.game, records, mode);
    this.setData({ page: 1, selected: [], selectedCount: 0 });
    this.load();
    this.syncNow(true);
    wx.showToast({
      title: '导入 ' + result.imported + ' 条' + (result.skipped ? '，跳过 ' + result.skipped + ' 条' : ''),
      icon: 'none'
    });
  }
});
