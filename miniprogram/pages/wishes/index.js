var app = getApp();
var store = require('../../utils/store');
var gameLib = require('../../utils/game');
var csv = require('../../utils/csv');
var file = require('../../utils/file');

var PAGE_SIZE = 10;
var FIVE_STAR = 5;

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
    rarity: FIVE_STAR,
    typeIndex: 0,
    poolIndex: poolIndex || 0,
    isUp: true,
    capture: false,
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
    typeOptions: gameLib.config('genshin').itemTypes,
    editorVisible: false,
    editorId: null,
    editor: editorDefaults(gameLib.config('genshin'), 0),
    textVisible: false,
    textContent: ''
  },

  onLoad: function () {
    var info = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: info.statusBarHeight || 20 });
  },

  onShow: function () {
    this.load(app.globalData.game);
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
      textVisible: false
    });
    this.load();
  },

  /* ---------------- 列表 ---------------- */

  load: function () {
    var game = this.data.game;
    var pool = this.data.poolIndex === 0 ? '' : this.data.g.pools[this.data.poolIndex - 1];
    var result = store.pageWishes(game, pool, this.data.page, PAGE_SIZE);
    var selected = this.data.selected;
    var rows = result.records.map(function (record) {
      return {
        id: record.id,
        displayName: record.itemName || '未命名',
        stars: starText(record.rarity),
        rarity: record.rarity,
        itemType: record.itemType || '—',
        pool: record.pool || '未知卡池',
        isUp: record.isUp === true,
        capture: record.captureTriggered === true,
        pityCount: record.pityCount || 1,
        time: (record.wishTime || '').slice(0, 16),
        checked: selected.indexOf(record.id) >= 0
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
    var id = Number(event.currentTarget.dataset.id);
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
        wx.showToast({ title: '已删除 ' + count + ' 条', icon: 'none' });
      }
    });
  },

  removeRow: function (event) {
    var that = this;
    var id = Number(event.currentTarget.dataset.id);
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
    var id = Number(event.currentTarget.dataset.id);
    var row = this.data.rows.filter(function (item) {
      return item.id === id;
    })[0];
    if (!row) {
      return;
    }
    var record = store.getWishes(this.data.game).filter(function (item) {
      return item.id === id;
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
        itemName: record.itemName || '',
        rarity: record.rarity || FIVE_STAR,
        typeIndex: typeIndex < 0 ? 0 : typeIndex,
        poolIndex: poolIndex < 0 ? 0 : poolIndex,
        isUp: record.isUp === true,
        capture: record.captureTriggered === true,
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

  onEditorType: function (event) {
    this.setData({ 'editor.typeIndex': Number(event.detail.value) });
  },

  onEditorPool: function (event) {
    this.setData({ 'editor.poolIndex': Number(event.detail.value) });
  },

  onEditorUp: function (event) {
    this.setData({ 'editor.isUp': event.detail.value });
  },

  onEditorCapture: function (event) {
    this.setData({ 'editor.capture': event.detail.value });
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
    var rarity = Number(editor.rarity) || FIVE_STAR;
    var name = (editor.itemName || '').trim();
    if (!name) {
      wx.showToast({ title: '请填写五星名称', icon: 'none' });
      return;
    }
    var pity = Math.max(1, Math.min(90, Number(editor.pity) || 1));
    var data = {
      itemName: name,
      rarity: rarity,
      itemType: g.itemTypes[editor.typeIndex] || g.itemTypes[0],
      pool: g.pools[editor.poolIndex] || g.pools[0],
      isUp: editor.isUp,
      pityCount: pity,
      wishTime: editor.date + ' ' + editor.time + ':00',
      note: editor.note,
      captureTriggered: this.data.game === 'genshin' && editor.capture === true
    };
    if (editing) {
      store.updateWish(this.data.game, this.data.editorId, data);
    } else {
      store.addWish(this.data.game, data);
    }
    this.setData({ editorVisible: false });
    this.load();
    wx.showToast({ title: editing ? '修改已保存' : '新增成功', icon: 'success' });
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

  /** 下载 JSON 模板：可先发给电脑编辑，或直接复制文本粘贴回「文本导入」。 */
  downloadTemplate: function () {
    file.exportFile('southair-wishes-template.json', csv.templateJson());
  },

  /** 手机文本录入：直接在弹窗里按行填写，不需要生成 / 编辑文件。 */
  openTextImport: function () {
    this.setData({
      textVisible: true,
      textContent: csv.templateText()
    });
  },

  closeTextImport: function () {
    this.setData({ textVisible: false });
  },

  onTextInput: function (event) {
    this.setData({ textContent: event.detail.value });
  },

  applyTextImport: function () {
    var text = (this.data.textContent || '').trim();
    if (!text) {
      wx.showToast({ title: '请先填写内容', icon: 'none' });
      return;
    }
    var records;
    var first = text.charAt(0);
    if (first === '[' || first === '{') {
      var payload;
      try {
        payload = JSON.parse(text);
      } catch (e) {
        wx.showToast({ title: '不是有效的 JSON', icon: 'none' });
        return;
      }
      if (Array.isArray(payload)) {
        records = payload;
      } else if (payload && Array.isArray(payload.wishes)) {
        records = payload.wishes;
      } else if (payload && payload.games && payload.games[this.data.game]
          && Array.isArray(payload.games[this.data.game].wishes)) {
        records = payload.games[this.data.game].wishes;
      } else {
        wx.showToast({ title: 'JSON 里没有抽卡记录', icon: 'none' });
        return;
      }
    } else {
      records = csv.parse(text);
    }
    if (!records.length) {
      wx.showToast({ title: '没有可导入的记录', icon: 'none' });
      return;
    }
    this.setData({ textVisible: false });
    this.chooseImportMode(records);
  },

  /** 从聊天记录里选择电脑端导出的 CSV / JSON 文件。 */
  importRecords: function () {
    this.pickWishFile();
  },

  pickWishFile: function () {
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

      that.chooseImportMode(records);
    }).catch(function (err) {
      wx.showToast({ title: err && err.message ? err.message : '导入失败', icon: 'none' });
    });
  },

  chooseImportMode: function (records) {
    var that = this;
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
  },

  applyImport: function (records, mode) {
    var result = store.importRecords(this.data.game, records, mode);
    this.setData({ page: 1, selected: [], selectedCount: 0 });
    this.load();
    wx.showToast({
      title: '导入 ' + result.imported + ' 条'
        + (result.skipped ? '，跳过 ' + result.skipped + ' 条' : '')
        + (result.filtered ? '，忽略 ' + result.filtered + ' 条' : ''),
      icon: 'none'
    });
  }
});
