var app = getApp();
var store = require('../../utils/store');
var gameLib = require('../../utils/game');
var csv = require('../../utils/csv');
var gacha = require('../../utils/gacha');
var avatars = require('../../utils/avatars');
var weaponIcons = require('../../utils/weaponIcons');
var ai = require('../../utils/ai');

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

/** 录入五星时的候选：五星角色 + 五星武器 / 光锥（排除四星角色与主角） */
function fiveStarNames(game) {
  var four = gameLib.FOUR_STAR_CHARACTERS[game] || [];
  var protagonist = gameLib.config(game).itemTypes[0] === '角色' ? '旅行者' : '开拓者';
  var characters = sortNames(Object.keys(avatars[game] || {})).filter(function (name) {
    return name !== protagonist && four.indexOf(name) < 0;
  });
  var weapons = sortNames(Object.keys(weaponIcons[game] || {}));
  return characters.concat(weapons);
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

/** 名称对应的头像 / 武器图标，缺失时返回空字符串 */
function itemIcon(game, name) {
  var avatarMap = avatars[game] || {};
  var weaponMap = weaponIcons[game] || {};
  return avatarMap[name] || weaponMap[name] || '';
}

function inferIsUp(game, pool, name, wishTime) {
  var standard = STANDARD_ITEMS[game];
  if (!standard || !name) {
    return false;
  }
  // 联动跃迁没有常驻歪池，五星均为联动 UP
  if (pool === '联动') {
    return true;
  }
  if (pool === '角色活动') {
    if (standard.characters.indexOf(name) >= 0) {
      return false;
    }
    if (game === 'starrail') {
      // 星缘相邀：加入时间之前只可能是当期 UP，之后按歪处理
      var xingyuan = gameLib.xingyuanIsUp(name, wishTime);
      if (xingyuan !== null) {
        return xingyuan;
      }
    }
    return true;
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
    icon: '',
    itemType: '',
    rarity: FIVE_STAR,
    poolIndex: poolIndex || 0,
    capture: false,
    pity: '1',
    date: parts.date,
    time: parts.time,
    second: '00'
  };
}

/** 混池 / 常驻 / 联动：角色与武器都可能出，选名称时不自动改卡池 */
function isMixedPool(g, pool) {
  return pool === '常驻' || pool === '集录祈愿' || pool === '联动';
}

/** 按卡池过滤可选名称：武器池只给武器，角色池只给角色，混池给全部 */
function namesForPool(game, source, pool) {
  var g = gameLib.config(game);
  var weapons = ai.nameLists(game).weapons;
  if (pool === g.weaponPool) {
    return source.filter(function (name) {
      return weapons.indexOf(name) >= 0;
    });
  }
  if (pool === g.charPool) {
    return source.filter(function (name) {
      return weapons.indexOf(name) < 0;
    });
  }
  return source.slice();
}

/** AI 解析结果 → 本地记录结构 */
function recordOf(values) {
  var time = String(values.time || '12:00');
  var full = time.length === 5 ? time + ':00' : time;
  return {
    itemName: values.itemName,
    itemType: values.itemType,
    pool: values.pool,
    rarity: values.rarity || FIVE_STAR,
    isUp: values.isUp === true,
    pityCount: values.pityCount || 1,
    wishTime: values.date + ' ' + full,
    captureTriggered: false
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
    keyword: '',
    startDate: '',
    endDate: '',
    rows: [],
    page: 1,
    pages: 1,
    total: 0,
    selected: [],
    selectedCount: 0,
    allChecked: false,
    onlyFive: false,
    pickerVisible: false,
    fiveStarNames: [],
    batchVisible: false,
    batchRows: [],
    editorVisible: false,
    editorId: null,
    editor: editorDefaults(0),
    pickerNames: [],
    linkVisible: false,
    linkUrl: '',
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
      keyword: '',
      startDate: '',
      endDate: '',
      page: 1,
      selected: [],
      selectedCount: 0,
      allChecked: false,
      pickerVisible: false,
      editorVisible: false
    });
    this.load();
  },

  /* ---------------- 列表 ---------------- */

  load: function () {
    var game = this.data.game;
    var pool = this.data.poolIndex === 0 ? '' : this.data.g.pools[this.data.poolIndex - 1];
    var result = store.pageWishes(game, pool, this.data.page, PAGE_SIZE,
      this.data.onlyFive ? 5 : null, {
        keyword: this.data.keyword,
        start: this.data.startDate,
        end: this.data.endDate
      });
    this.pageRecords = result.records;
    var selected = this.data.selected;
    var rows = result.records.map(function (record) {
      return {
        id: record.id,
        displayName: record.itemName || '未命名',
        initial: (record.itemName || '未命名').charAt(0),
        icon: itemIcon(game, record.itemName),
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

  onAvatarError: function (event) {
    var id = Number(event.currentTarget.dataset.id);
    var rows = this.data.rows.map(function (row) {
      if (row.id === id) {
        row.icon = '';
      }
      return row;
    });
    this.setData({ rows: rows });
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

  onKeywordInput: function (event) {
    var that = this;
    var value = event.detail.value;
    this.setData({ keyword: value });
    clearTimeout(this.keywordTimer);
    this.keywordTimer = setTimeout(function () {
      that.setData({ page: 1, selected: [], selectedCount: 0, allChecked: false });
      that.load();
    }, 400);
  },

  onStartDate: function (event) {
    this.setData({
      startDate: event.detail.value,
      page: 1,
      selected: [],
      selectedCount: 0,
      allChecked: false
    });
    this.load();
  },

  onEndDate: function (event) {
    this.setData({
      endDate: event.detail.value,
      page: 1,
      selected: [],
      selectedCount: 0,
      allChecked: false
    });
    this.load();
  },

  resetFilters: function () {
    this.setData({
      poolIndex: 0,
      keyword: '',
      startDate: '',
      endDate: '',
      onlyFive: false,
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

  openAdd: function () {
    var poolIndex = this.data.poolIndex > 0 ? this.data.poolIndex - 1 : 0;
    this.setData({
      editorVisible: true,
      editorId: null,
      fiveStarNames: fiveStarNames(this.data.game),
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
    this.setData({
      editorVisible: true,
      editorId: id,
      editor: {
        itemName: name,
        icon: itemIcon(this.data.game, name),
        itemType: record.itemType || inferItemType(this.data.game, name),
        rarity: record.rarity || FIVE_STAR,
        poolIndex: poolIndex < 0 ? 0 : poolIndex,
        capture: record.captureTriggered === true,
        pity: String(record.pityCount || 1),
        date: wishTime.slice(0, 10),
        time: wishTime.slice(11, 16),
        second: wishTime.length >= 19 ? wishTime.slice(17, 19) : '00'
      }
    });
  },

  /* ---------------- 批量编辑本页 ---------------- */

  openBatchEdit: function () {
    var records = this.pageRecords || [];
    if (!records.length) {
      wx.showToast({ title: '当前页没有可编辑的记录', icon: 'none' });
      return;
    }
    this.setData({
      batchVisible: true,
      batchRows: records.map(function (record, index) {
        return {
          id: record.id,
          index: index + 1,
          name: record.itemName || '',
          isUp: record.isUp === true,
          pityCount: record.pityCount || 1
        };
      })
    });
  },

  closeBatchEdit: function () {
    this.setData({ batchVisible: false, batchRows: [] });
  },

  onBatchName: function (event) {
    var index = Number(event.currentTarget.dataset.index);
    this.setData({ ['batchRows[' + index + '].name']: event.detail.value });
  },

  onBatchPity: function (event) {
    var index = Number(event.currentTarget.dataset.index);
    this.setData({ ['batchRows[' + index + '].pityCount']: event.detail.value });
  },

  onBatchUp: function (event) {
    var index = Number(event.currentTarget.dataset.index);
    this.setData({ ['batchRows[' + index + '].isUp']: event.detail.value });
  },

  saveBatchEdit: function () {
    var game = this.data.game;
    var records = this.pageRecords || [];
    var rows = this.data.batchRows || [];
    var byId = {};
    records.forEach(function (record) {
      byId[record.id] = record;
    });
    var saved = 0;
    rows.forEach(function (row) {
      var original = byId[row.id];
      if (!original) {
        return;
      }
      var name = String(row.name || '').trim();
      if (!name) {
        return;
      }
      store.updateWish(game, row.id, {
        itemName: name,
        itemType: original.itemType,
        pool: original.pool,
        rarity: original.rarity,
        isUp: row.isUp === true,
        pityCount: Math.max(1, Number(row.pityCount) || 1),
        wishTime: original.wishTime,
        note: original.note,
        captureTriggered: original.captureTriggered === true
      });
      saved++;
    });
    this.setData({ batchVisible: false, batchRows: [] });
    wx.showToast({ title: '已保存 ' + saved + ' 条修改', icon: 'none' });
    this.load();
  },

  closeEditor: function () {
    this.setData({ editorVisible: false });
  },

  noop: function () {
  },

  onEditorName: function (event) {
    var detail = event.detail || {};
    var name = detail.name || '';
    var g = this.data.g;
    var patch = {
      pickerVisible: false,
      'editor.itemName': name,
      'editor.icon': detail.icon || itemIcon(this.data.game, name),
      'editor.itemType': inferItemType(this.data.game, name)
    };
    // 选到武器自动切武器池、选到角色自动切角色池；混池 / 常驻 / 联动保持不动
    var pool = g.pools[this.data.editor.poolIndex] || g.pools[0];
    if (name && !isMixedPool(g, pool)) {
      var isWeapon = ai.nameLists(this.data.game).weapons.indexOf(name) >= 0;
      var targetIndex = g.pools.indexOf(isWeapon ? g.weaponPool : g.charPool);
      if (targetIndex >= 0) {
        patch['editor.poolIndex'] = targetIndex;
      }
    }
    this.setData(patch);
  },

  openNamePicker: function () {
    var g = this.data.g;
    var pool = g.pools[this.data.editor.poolIndex] || g.pools[0];
    var lists = ai.nameLists(this.data.game);
    // 编辑已有记录时用全量名单，避免四星 / 历史名称被过滤掉
    var source = this.data.editorId ? lists.characters.concat(lists.weapons)
      : fiveStarNames(this.data.game);
    this.setData({
      pickerNames: namesForPool(this.data.game, source, pool),
      pickerVisible: true
    });
  },

  closeNamePicker: function () {
    this.setData({ pickerVisible: false });
  },

  onEditorPool: function (event) {
    var poolIndex = Number(event.detail.value);
    var g = this.data.g;
    var pool = g.pools[poolIndex] || g.pools[0];
    var lists = ai.nameLists(this.data.game);
    var source = this.data.editorId ? lists.characters.concat(lists.weapons)
      : fiveStarNames(this.data.game);
    var patch = { 'editor.poolIndex': poolIndex };
    var current = this.data.editor.itemName;
    if (current && namesForPool(this.data.game, source, pool).indexOf(current) < 0) {
      patch['editor.itemName'] = '';
      patch['editor.icon'] = '';
    }
    this.setData(patch);
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
    // 手动选择分钟时秒数归零
    this.setData({ 'editor.time': event.detail.value, 'editor.second': '00' });
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
    var pool = g.pools[editor.poolIndex] || g.pools[0];
    var pityCap = pool === g.weaponPool ? 80 : 90;
    var pity = Math.max(1, Math.min(pityCap, Number(editor.pity) || 1));
    var itemType = inferItemType(this.data.game, name) || g.itemTypes[0];
    var wishTime = editor.date + ' ' + editor.time + ':' + (editor.second || '00');
    var data = {
      itemName: name,
      rarity: rarity,
      itemType: itemType,
      pool: pool,
      isUp: inferIsUp(this.data.game, pool, name, wishTime),
      pityCount: pity,
      wishTime: wishTime,
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

  /* ---------------- AI 自然语言录入（离线解析） ---------------- */

  openAiEntry: function () {
    this._aiItems = [];
    this.setData({ aiVisible: true, aiText: '', aiError: '', aiRows: [], aiReady: false });
  },

  closeAiEntry: function () {
    this._aiItems = [];
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
          + '参考「7抽莫娜 2025年10月22日 20时01分05秒」',
        aiReady: false
      });
      return;
    }
    if (batch.type === 'owned') {
      this.setData({ aiError: '收藏补充请到「收藏图鉴」页用 AI 录入', aiReady: false });
      return;
    }
    if (batch.type !== 'wish') {
      this.setData({ aiError: '账号资源请到「资源」页用 AI 录入', aiReady: false });
      return;
    }
    // 单条：直接打开录入弹窗并预填
    if (batch.items.length === 1) {
      var values = batch.items[0].values;
      var poolIndex = this.data.g.pools.indexOf(values.pool);
      this._aiItems = [];
      this.setData({
        aiVisible: false,
        aiReady: false,
        editorVisible: true,
        editorId: null,
        editor: {
          itemName: values.itemName,
          icon: itemIcon(game, values.itemName),
          itemType: values.itemType,
          rarity: FIVE_STAR,
          poolIndex: poolIndex < 0 ? 0 : poolIndex,
          capture: false,
          pity: String(values.pityCount || 1),
          date: values.date,
          time: values.time.slice(0, 5),
          second: values.time.length > 5 ? values.time.slice(6, 8) : '00'
        }
      });
      return;
    }
    // 多条：列出核对列表
    this._aiItems = batch.items;
    this.setData({
      aiError: '',
      aiReady: true,
      aiRows: batch.items.map(function (item, index) {
        return {
          index: index + 1,
          name: item.name,
          pool: gameLib.poolLabel(item.values.pool),
          pity: item.values.pityCount || 1,
          time: item.values.date + ' ' + item.values.time,
          up: item.values.isUp === true
        };
      })
    });
  },

  confirmAiBatch: function () {
    var items = this._aiItems || [];
    if (!items.length) {
      return;
    }
    var game = this.data.game;
    items.forEach(function (item) {
      store.addWish(game, recordOf(item.values));
    });
    this._aiItems = [];
    this.setData({ aiVisible: false, aiRows: [], aiReady: false, aiText: '' });
    this.load();
    wx.showToast({ title: '已批量录入 ' + items.length + ' 条', icon: 'none' });
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
      var batch = gacha.processItems(game, items);
      if (!batch.records.length) {
        fail('链接中没有可导入的抽卡记录');
        return;
      }
      that.setData({ linkVisible: false });
      that.chooseImportMode(batch.records, batch.pity);
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

  chooseImportMode: function (records, pity) {
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
              that.applyImport(records, mode, pity);
            }
          });
          return;
        }
        that.applyImport(records, mode, pity);
      }
    });
  },

  applyImport: function (records, mode, pity) {
    var result = store.importRecords(this.data.game, records, mode);
    if (pity) {
      store.savePitySnapshot(this.data.game, pity);
    }
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
