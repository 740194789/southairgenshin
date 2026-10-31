var app = getApp();
var store = require('../../utils/store');
var gameLib = require('../../utils/game');
var csv = require('../../utils/csv');
var gacha = require('../../utils/gacha');
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

/** 解析文本导入 / 链接导入的内容：JSON（数组、单游戏备份、全量备份）或 CSV。 */
function parseWishText(text, game) {
  var content = String(text || '').trim();
  if (!content) {
    return { error: '内容为空' };
  }
  var first = content.charAt(0);
  if (first === '[' || first === '{') {
    var payload;
    try {
      payload = JSON.parse(content);
    } catch (e) {
      return { error: '不是有效的 JSON' };
    }
    if (Array.isArray(payload)) {
      return { records: payload };
    }
    if (payload && Array.isArray(payload.wishes)) {
      return { records: payload.wishes };
    }
    if (payload && payload.games && payload.games[game]
        && Array.isArray(payload.games[game].wishes)) {
      return { records: payload.games[game].wishes };
    }
    return { error: 'JSON 里没有抽卡记录' };
  }
  return { records: csv.parse(content) };
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
    allChecked: false,
    pityChips: [],
    onlyFive: false,
    typeOptions: gameLib.config('genshin').itemTypes,
    editorVisible: false,
    editorId: null,
    editor: editorDefaults(gameLib.config('genshin'), 0),
    textVisible: false,
    textContent: '',
    linkVisible: false,
    linkUrl: ''
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
      allChecked: false,
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
    var result = store.pageWishes(game, pool, this.data.page, PAGE_SIZE,
      this.data.onlyFive ? 5 : null);
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

    var overview = store.overview(game);
    var pityChips = (overview.poolStats || []).map(function (item) {
      var cap = Number(item.cap) || 90;
      var pity = Math.max(0, Number(item.currentPity) || 0);
      return {
        pool: item.pool,
        currentPity: pity,
        cap: cap,
        left: Math.max(0, cap - pity),
        guaranteed: item.upGuaranteed === true,
        manual: item.pityManual === true
      };
    });

    this.setData({
      rows: rows,
      pityChips: pityChips,
      allChecked: rows.length > 0 && rows.every(function (row) {
        return row.checked;
      }),
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
      selectedCount: 0,
      allChecked: false
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
      selectedCount: 0,
      allChecked: false
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
      selectedCount: 0,
      allChecked: false
    });
    this.load();
  },

  editPity: function (event) {
    var that = this;
    var pool = event.currentTarget.dataset.pool;
    var cap = Number(event.currentTarget.dataset.cap) || 90;
    var pity = Number(event.currentTarget.dataset.pity) || 0;
    wx.showModal({
      title: pool + ' 已垫抽数',
      editable: true,
      content: '当前 ' + pity + ' 抽，可填 0–' + (cap - 1) + '（0 表示清除手动值）',
      placeholderText: '输入新的已垫抽数',
      success: function (res) {
        if (!res.confirm) {
          return;
        }
        var text = String(res.content || '').trim();
        if (!text) {
          return;
        }
        var value = Math.floor(Number(text));
        if (!isFinite(value) || value < 0 || value > cap - 1) {
          wx.showToast({ title: '需在 0–' + (cap - 1) + ' 之间', icon: 'none' });
          return;
        }
        store.setPityOverride(that.data.game, pool, value);
        that.load();
        wx.showToast({
          title: value > 0 ? '已更新为 ' + value + ' 抽' : '已清除手动已垫',
          icon: 'none'
        });
      }
    });
  },

  toggleOnlyFive: function () {
    this.setData({
      onlyFive: !this.data.onlyFive,
      page: 1,
      selected: [],
      selectedCount: 0,
      allChecked: false
    });
    this.load();
  },

  toggleAll: function () {
    var allChecked = !this.data.allChecked;
    var selected = allChecked ? this.data.rows.map(function (row) {
      return row.id;
    }) : [];
    var rows = this.data.rows.map(function (row) {
      row.checked = allChecked;
      return row;
    });
    this.setData({
      selected: selected,
      selectedCount: selected.length,
      allChecked: allChecked,
      rows: rows
    });
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
      allChecked: rows.length > 0 && rows.every(function (row) {
        return row.checked;
      }),
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
        that.setData({ selected: [], selectedCount: 0, allChecked: false, page: 1 });
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
        that.setData({ selected: selected, selectedCount: selected.length, allChecked: false });
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
    var parsed = parseWishText(text, this.data.game);
    if (parsed.error) {
      wx.showToast({ title: parsed.error, icon: 'none' });
      return;
    }
    var records = parsed.records;
    if (!records.length) {
      wx.showToast({ title: '没有可导入的记录', icon: 'none' });
      return;
    }
    this.setData({ textVisible: false });
    this.chooseImportMode(records);
  },

  openLinkImport: function () {
    this.setData({ linkVisible: true });
  },

  closeLinkImport: function () {
    this.setData({ linkVisible: false });
  },

  onLinkInput: function (event) {
    this.setData({ linkUrl: event.detail.value });
  },

  applyLinkImport: function () {
    var that = this;
    var url = String(this.data.linkUrl || '').trim();
    if (!url) {
      wx.showToast({ title: '请填写链接', icon: 'none' });
      return;
    }
    if (!/^(https?:\/\/|cloud:\/\/)/.test(url)) {
      wx.showToast({ title: '只支持 https 链接或 cloud:// 文件 ID', icon: 'none' });
      return;
    }
    if (!wx.cloud) {
      wx.showToast({ title: '当前微信版本不支持云开发', icon: 'none' });
      return;
    }

    var info = gacha.validateLink(url, this.data.game);
    if (info.isGacha) {
      if (!info.ok) {
        wx.showToast({ title: info.error, icon: 'none' });
        return;
      }
      this.importGachaLink(url);
      return;
    }

    function fail(message) {
      wx.hideLoading();
      wx.showToast({ title: message || '下载失败', icon: 'none' });
    }

    function done(text) {
      wx.hideLoading();
      var parsed = parseWishText(text, that.data.game);
      if (parsed.error) {
        wx.showToast({ title: parsed.error, icon: 'none' });
        return;
      }
      if (!parsed.records.length) {
        wx.showToast({ title: '链接里没有可导入的记录', icon: 'none' });
        return;
      }
      that.setData({ linkVisible: false });
      that.chooseImportMode(parsed.records);
    }

    wx.showLoading({ title: '下载中', mask: true });
    if (url.indexOf('cloud://') === 0) {
      wx.cloud.downloadFile({ fileID: url }).then(function (res) {
        var text;
        try {
          text = wx.getFileSystemManager().readFileSync(res.tempFilePath, 'utf8');
        } catch (e) {
          fail('读取云文件失败');
          return;
        }
        done(text);
      }).catch(function () {
        fail('云文件下载失败，请检查文件 ID');
      });
      return;
    }

    wx.cloud.callFunction({ name: 'fetchLink', data: { url: url } }).then(function (res) {
      var result = res && res.result;
      if (!result || !result.ok) {
        fail((result && result.error) || '下载失败');
        return;
      }
      done(result.text);
    }).catch(function () {
      fail('云函数调用失败，请确认已部署 fetchLink');
    });
  },

  /** 米游社抽卡链接：按卡池分页抓取，客户端累计后统一推算保底与 UP。 */
  importGachaLink: function (url) {
    var that = this;
    var game = this.data.game;
    var defs = gacha.poolDefs(game);
    var items = [];
    var poolIndex = 0;

    function fail(message) {
      wx.hideLoading();
      wx.showToast({ title: message || '读取抽卡记录失败', icon: 'none' });
    }

    function finish() {
      wx.hideLoading();
      var records = gacha.processItems(game, items);
      if (!records.length) {
        fail('链接中没有可导入的抽卡记录');
        return;
      }
      that.setData({ linkVisible: false });
      that.chooseImportMode(records);
    }

    function nextPool() {
      if (poolIndex >= defs.length) {
        finish();
        return;
      }
      var def = defs[poolIndex];
      var endId = '0';
      var page = 1;

      function nextPage() {
        wx.showLoading({ title: '读取' + def.pool, mask: true });
        wx.cloud.callFunction({
          name: 'fetchLink',
          data: {
            mode: 'gacha',
            url: url,
            game: game,
            gachaType: def.type,
            endId: endId,
            page: page
          }
        }).then(function (res) {
          var result = res && res.result;
          if (!result || !result.ok) {
            fail((result && result.error) || '读取抽卡记录失败');
            return;
          }
          if (result.items && result.items.length) {
            items = items.concat(result.items);
          }
          if (result.hasMore) {
            endId = result.lastId;
            page = result.page;
            nextPage();
            return;
          }
          poolIndex += 1;
          nextPool();
        }).catch(function () {
          fail('云函数调用失败，请确认已部署 fetchLink');
        });
      }

      nextPage();
    }

    nextPool();
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
    this.setData({ page: 1, selected: [], selectedCount: 0, allChecked: false });
    this.load();
    wx.showToast({
      title: '导入 ' + result.imported + ' 条'
        + (result.skipped ? '，跳过 ' + result.skipped + ' 条' : '')
        + (result.filtered ? '，忽略 ' + result.filtered + ' 条' : ''),
      icon: 'none'
    });
  }
});
