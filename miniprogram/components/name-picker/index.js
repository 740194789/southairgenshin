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
    cells: []
  },

  observers: {
    'visible, game, current, names, showTabs, excludeProtagonist':
      function (visible, game, current, names, showTabs, excludeProtagonist) {
        if (!visible) {
          return;
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
      if (showTabs) {
        tabs = [
          { key: 'characters', label: g.itemTypes[0], count: characters.length },
          { key: 'weapons', label: g.itemTypes[1], count: weapons.length }
        ];
        active = forcedTab || (current && weapons.indexOf(current) >= 0 ? 'weapons' : 'characters');
      } else {
        tabs = [{ key: 'custom', label: '可选', count: (names || []).length }];
        active = 'custom';
      }

      var list = active === 'weapons' ? weapons : (active === 'custom' ? (names || []).slice() : characters);
      var skipCurrent = excludeProtagonist && current === protagonist;
      if (current && !skipCurrent && list.indexOf(current) < 0) {
        list = [current].concat(list);
      }

      var cells = list.map(function (name) {
        return {
          name: name,
          initial: (name || '?').charAt(0),
          icon: avatarMap[name] || weaponMap[name] || ''
        };
      });

      this.setData({ tabs: tabs, activeTab: active, cells: cells });
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

    onMaskTap: function () {
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
