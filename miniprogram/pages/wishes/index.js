var app = getApp();
var store = require('../../utils/store');
var gameLib = require('../../utils/game');
var csv = require('../../utils/csv');
var gacha = require('../../utils/gacha');
var avatars = require('../../utils/avatars');
var weaponIcons = require('../../utils/weaponIcons');

var PAGE_SIZE = 10;
var FIVE_STAR = 5;

/* 常驻名单：用于自动判定五星是否 UP（与网页端、链接导入口径一致） */
var STANDARD_ITEMS = {
  genshin: {
    characters: ['迪卢克', '琴', '莫娜', '七七', '刻晴', '提纳里', '迪希雅', '梦见月瑞希'],
    weapons: ['天空之刃', '天空之翼', '天空之傲', '天空之卷', '天空之脊', '阿莫斯之弓',
      '狼的末路', '风鹰剑', '四风原典', '和璞鸢']
  },
  starrail: {
    characters: ['姬子', '瓦尔特', '布洛妮娅', '克拉拉', '杰帕德', '彦卿', '白露'],
    weapons: ['银河铁道之夜', '无可取代的东西', '但战斗还未结束', '以世界之名',
      '制胜的瞬间', '于夜色中', '时节不居'],
    extraCharacters: ['云璃', '银枝', '银狼', '符玄', '刃', '希儿']
  }
};

function sortNames(list) {
  return list.slice().sort(function (a, b) {
    return a.localeCompare(b, 'zh-Hans-CN');
  });
}

/** 角色 + 武器 / 光锥的完整候选名单，角色在前。 */
function allNames(game) {
  var characters = sortNames(Object.keys(avatars[game] || {}));
  var weapons = sortNames(Object.keys(weaponIcons[game] || {}));
  return { characters: characters, weapons: weapons };
}

function inferItemType(game, name) {
  var lists = allNames(game);
  if (lists.characters.indexOf(name) >= 0) {
    return gameLib.config(game).itemTypes[0];
  }
  if (lists.weapons.indexOf(name) >= 0) {
    return gameLib.config(game).itemTypes[1];
  }
  return '';
}

function inferIsUp(game, pool, name) {
  var standard = STANDARD_ITEMS[game];
  if (!standard || !name) {
    return false;
  }
  if (pool === '角色活动') {
    return standard.characters.indexOf(name) < 0
      && (standard.extraCharacters || []).indexOf(name) < 0;
  }
  if (pool === '武器活动' || pool === '光锥活动') {
    return standard.weapons.indexOf(name) < 0;
  }
  return false;
}

function starText(rarity) {
  var count = Math.max(0, Math.min(5, Number(rarity) || 0));
  var text = '';
  for (var i = 0; i < count; i++) {
    text += '★';
  }
  return text;
}

/** 解析链接导入的内容：JSON（数组、单游戏备份、全量备份）或 CSV。 */
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

function editorDefaults(poolIndex) {
  var parts = nowParts();
  return {
    itemName: '',
    nameIndex: -1,
    itemType: '',
    rarity: FIVE_STAR,
    poolIndex: poolIndex || 0,
    capture: false,
    pity: '1',
    date: parts.date,
    time: parts.time
  };
}

Page({
  data: {
    statusBarHeight: 20,
    game: 'genshin',
    g: gameLib.config('genshin'),
    poolOptions: ['全部卡池'].concat(gameLib.config('genshin').pools.map(gameLib.poolLabel)),
    poolLabels: gameLib.config('genshin').pools.map(gameLib.poolLabel),
    poolIndex: 0,
    rows: [],
    page: 1,
    pages: 1,
    total: 0,
    selected: [],
    selectedCount: 0,
    allChecked: false,
    onlyFive: false,
    nameOptions: [],
    editorVisible: false,
    editorId: null,
    editor: editorDefaults(0),
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
      poolOptions: ['全部卡池'].concat(g.pools.map(gameLib.poolLabel)),
      poolLabels: g.pools.map(gameLib.poolLabel),
      poolIndex: 0,
      page: 1,
      selected: [],
      selectedCount: 0,
      allChecked: false,
      editorVisible: false
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
        initial: (record.itemName || '未命名').charAt(0),
        stars: starText(record.rarity),
        rarity: record.rarity,
        itemType: record.itemType || '—',
        pool: gameLib.poolLabel(record.pool) || '未知卡池',
        isUp: record.isUp === true,
        capture: record.captureTriggered === true,
        pityCount: record.pityCount || 1,
        time: (record.wishTime || '').slice(0, 16),
        checked: selected.indexOf(record.id) >= 0
      };
    });

    this.setData({
      rows: rows,
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

  editorNameOptions: function (game, currentName) {
    var lists = allNames(game);
    var options = lists.characters.concat(lists.weapons);
    if (currentName && options.indexOf(currentName) < 0) {
      options.unshift(currentName);
    }
    return options;
  },

  openAdd: function () {
    var poolIndex = this.data.poolIndex > 0 ? this.data.poolIndex - 1 : 0;
    this.setData({
      editorVisible: true,
      editorId: null,
      nameOptions: this.editorNameOptions(this.data.game, ''),
      editor: editorDefaults(poolIndex)
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
    var poolIndex = g.pools.indexOf(record.pool);
    var name = record.itemName || '';
    var nameOptions = this.editorNameOptions(this.data.game, name);
    this.setData({
      editorVisible: true,
      editorId: id,
      nameOptions: nameOptions,
      editor: {
        itemName: name,
        nameIndex: name ? nameOptions.indexOf(name) : -1,
        itemType: record.itemType || inferItemType(this.data.game, name),
        rarity: record.rarity || FIVE_STAR,
        poolIndex: poolIndex < 0 ? 0 : poolIndex,
        capture: record.captureTriggered === true,
        pity: String(record.pityCount || 1),
        date: wishTime.slice(0, 10),
        time: wishTime.slice(11, 16)
      }
    });
  },

  closeEditor: function () {
    this.setData({ editorVisible: false });
  },

  noop: function () {
  },

  onEditorName: function (event) {
    var index = Number(event.detail.value);
    var name = this.data.nameOptions[index] || '';
    this.setData({
      'editor.nameIndex': index,
      'editor.itemName': name,
      'editor.itemType': inferItemType(this.data.game, name)
    });
  },

  onEditorPool: function (event) {
    this.setData({ 'editor.poolIndex': Number(event.detail.value) });
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

  saveEditor: function () {
    var editor = this.data.editor;
    var g = this.data.g;
    var editing = !!this.data.editorId;
    var rarity = Number(editor.rarity) || FIVE_STAR;
    var name = (editor.itemName || '').trim();
    if (!name) {
      wx.showToast({ title: '请选择角色 / 物品', icon: 'none' });
      return;
    }
    var pity = Math.max(1, Math.min(90, Number(editor.pity) || 1));
    var pool = g.pools[editor.poolIndex] || g.pools[0];
    var itemType = inferItemType(this.data.game, name) || g.itemTypes[0];
    var data = {
      itemName: name,
      rarity: rarity,
      itemType: itemType,
      pool: pool,
      isUp: inferIsUp(this.data.game, pool, name),
      pityCount: pity,
      wishTime: editor.date + ' ' + editor.time + ':00',
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

  /* ---------------- 链接导入 ---------------- */

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

  /* ---------------- 导入结果 ---------------- */

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
