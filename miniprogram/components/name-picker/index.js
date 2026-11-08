/* 名称选择弹窗：头像 / 图标 + 名字，一排 5 个（与网页端一致） */

var avatars = require('../../utils/avatars');
var weaponIcons = require('../../utils/weaponIcons');
var gameLib = require('../../utils/game');

/* 主角不在抽卡记录里出现，抽卡页选择时排除；收藏「补充已有」仍可选 */
var PROTAGONISTS = { genshin: '旅行者', starrail: '开拓者' };

function sortNames(list) {
  return list.slice().sort(function (a, b) {
    return a.localeCompare(b, 'zh-CN');
  });
}

Component({
  properties: {
    visible: { type: Boolean, value: false },
    game: { type: String, value: 'genshin' },
    current: { type: String, value: '' },
    // 自定义名单：收藏「补充已有」按类别传入，此时不显示分页
    names: { type: Array, value: [] },
    showTabs: { type: Boolean, value: true },
    excludeProtagonist: { type: Boolean, value: false }
  },

  data: {
    tabs: [],
    activeTab: '',
    cells: [],
    allCells: {},
    keyword: '',
    searching: false
  },

  observers: {
    'visible, game, current, names, showTabs, excludeProtagonist':
      function (visible, game, current, names, showTabs, excludeProtagonist) {
        if (!visible) {
          return;
        }
        // 每次打开重置搜索词，避免上次的过滤结果残留
        if (this.data.keyword) {
          this.setData({ keyword: '' });
        }
        this.build(game, current, names, showTabs, excludeProtagonist);
      }
  },

  methods: {
    build: function (game, current, names, showTabs, excludeProtagonist, forcedTab) {
      var g = gameLib.config(game);
      var avatarMap = avatars[game] || {};
      var weaponMap = weaponIcons[game] || {};
      var protagonist = PROTAGONISTS[game];
      var characters = sortNames(Object.keys(avatarMap)).filter(function (name) {
        return !excludeProtagonist || name !== protagonist;
      });
      var weapons = sortNames(Object.keys(weaponMap));

      var tabs;
      var active;
      var lists = {};
      if (showTabs) {
        tabs = [
          { key: 'characters', label: g.itemTypes[0], count: characters.length },
          { key: 'weapons', label: g.itemTypes[1], count: weapons.length }
        ];
        active = forcedTab || (current && weapons.indexOf(current) >= 0 ? 'weapons' : 'characters');
        lists.characters = characters;
        lists.weapons = weapons;
      } else {
        tabs = [{ key: 'custom', label: '可选', count: (names || []).length }];
        active = 'custom';
        lists.custom = (names || []).slice();
      }

      var list = lists[active] || [];
      var skipCurrent = excludeProtagonist && current === protagonist;
      if (current && !skipCurrent && list.indexOf(current) < 0) {
        list = [current].concat(list);
        lists[active] = list;
      }

      var allCells = {};
      Object.keys(lists).forEach(function (key) {
        allCells[key] = lists[key].map(function (name) {
          return {
            name: name,
            initial: (name || '?').charAt(0),
            icon: avatarMap[name] || weaponMap[name] || ''
          };
        });
      });

      var keyword = String(this.data.keyword || '').trim();
      this.setData({
        tabs: tabs,
        activeTab: active,
        allCells: allCells,
        searching: keyword.length > 0,
        cells: this.filterCells(allCells, active, keyword)
      });
    },

    /** 有关键词时跨分类合并结果，否则只显示当前分类 */
    filterCells: function (allCells, active, keyword) {
      var text = String(keyword || '').trim().toLowerCase();
      var cells = allCells || {};
      if (!text) {
        return cells[active] || [];
      }
      var seen = {};
      var result = [];
      Object.keys(cells).forEach(function (key) {
        cells[key].forEach(function (cell) {
          var lower = String(cell.name || '').toLowerCase();
          if (!seen[lower] && lower.indexOf(text) >= 0) {
            seen[lower] = true;
            result.push(cell);
          }
        });
      });
      return result;
    },

    onSearch: function (event) {
      var keyword = event.detail.value || '';
      this.setData({
        keyword: keyword,
        searching: String(keyword).trim().length > 0,
        cells: this.filterCells(this.data.allCells, this.data.activeTab, keyword)
      });
    },

    switchTab: function (event) {
      var key = event.currentTarget.dataset.key;
      if (!key || key === this.data.activeTab) {
        return;
      }
      this.build(this.data.game, this.data.current, this.data.names, this.data.showTabs,
        this.data.excludeProtagonist, key);
    },

    pick: function (event) {
      var name = event.currentTarget.dataset.name;
      if (!name) {
        return;
      }
      this.triggerEvent('select', {
        name: name,
        icon: event.currentTarget.dataset.icon || ''
      });
      this.triggerEvent('close');
    },

    close: function () {
      this.triggerEvent('close');
    },

    noop: function () {
    },

    onIconError: function (event) {
      var index = Number(event.currentTarget.dataset.index);
      var patch = {};
      patch['cells[' + index + '].icon'] = '';
      this.setData(patch);
    }
  }
});
