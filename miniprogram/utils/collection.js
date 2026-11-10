/* 收藏图鉴：抽卡记录聚合 + 手动补充（小程序本地存储） */

var store = require('./store');
var avatars = require('./avatars');
var weaponIcons = require('./weaponIcons');
var gameLib = require('./game');

function sortNames(list) {
  return list.slice().sort(function (a, b) {
    return a.localeCompare(b, 'zh-CN');
  });
}

/** 补充已有时可选的名称：按类别限定四星角色 / 五星角色 / 五星武器（光锥）。 */
function nameOptions(game, category) {
  if (category === 'weapons5') {
    return sortNames(Object.keys(weaponIcons[game] || {}));
  }
  var four = gameLib.FOUR_STAR_CHARACTERS[game] || [];
  var wantFour = category === 'characters4';
  var list = Object.keys(avatars[game] || {}).filter(function (name) {
    return (four.indexOf(name) >= 0) === wantFour;
  });
  return sortNames(list);
}

function ownedKey(game) {
  return 'sg_owned_' + game;
}

function getOwned(game) {
  try {
    var raw = wx.getStorageSync(ownedKey(game));
    return {
      characters4: (raw && raw.characters4) || {},
      characters5: (raw && raw.characters5) || {},
      weapons5: (raw && raw.weapons5) || {}
    };
  } catch (e) {
    return { characters4: {}, characters5: {}, weapons5: {} };
  }
}

function saveOwned(game, data) {
  try {
    wx.setStorageSync(ownedKey(game), data);
  } catch (e) {
    // 存储失败时保持当前会话可用
  }
}

function addManual(game, category, name, copies) {
  var data = getOwned(game);
  data[category][name] = (Number(data[category][name]) || 0) + copies;
  saveOwned(game, data);
}

function removeManual(game, category, name) {
  var data = getOwned(game);
  if (data[category]) {
    delete data[category][name];
  }
  saveOwned(game, data);
}

function sectionOf(item) {
  if (Number(item.rarity) === 5 && item.itemType !== '角色') {
    return 'weapons5';
  }
  if (item.itemType === '角色' && Number(item.rarity) === 4) {
    return 'characters4';
  }
  if (item.itemType === '角色' && Number(item.rarity) === 5) {
    return 'characters5';
  }
  return '';
}

function buildDefs(game) {
  return [
    { key: 'characters5', title: '五星角色', kind: 'character' },
    { key: 'weapons5', title: game === 'starrail' ? '五星光锥' : '五星武器', kind: 'weapon' },
    { key: 'characters4', title: '四星角色', kind: 'character' }
  ];
}

function build(game) {
  var defs = buildDefs(game);
  var owned = getOwned(game);
  var avatarMap = avatars[game] || {};
  var weaponMap = weaponIcons[game] || {};
  var sections = {};
  defs.forEach(function (def) {
    sections[def.key] = [];
  });

  store.getWishes(game).forEach(function (record) {
    var key = sectionOf(record);
    if (!key) {
      return;
    }
    var name = String(record.itemName || '').trim();
    if (!name) {
      return;
    }
    var existing = sections[key].filter(function (entry) {
      return entry.name === name;
    })[0];
    if (existing) {
      existing.count += 1;
    } else {
      sections[key].push({ name: name, count: 1, manual: 0 });
    }
  });

  defs.forEach(function (def) {
    var manualMap = owned[def.key] || {};
    Object.keys(manualMap).forEach(function (name) {
      var copies = Math.floor(Number(manualMap[name]) || 0);
      if (copies <= 0) {
        return;
      }
      var existing = sections[def.key].filter(function (entry) {
        return entry.name === name;
      })[0];
      if (existing) {
        existing.manual = copies;
      } else {
        sections[def.key].push({ name: name, count: 0, manual: copies });
      }
    });

    sections[def.key].sort(function (a, b) {
      var totalA = a.count + a.manual;
      var totalB = b.count + b.manual;
      if (totalA !== totalB) {
        return totalB - totalA;
      }
      return a.name.localeCompare(b.name, 'zh-CN');
    });

    sections[def.key] = sections[def.key].map(function (entry) {
      var copies = entry.count + entry.manual;
      var iconMap = def.kind === 'character' ? avatarMap : weaponMap;
      return {
        name: entry.name,
        initial: entry.name.charAt(0),
        icon: iconMap[entry.name] || '',
        copies: copies,
        manual: entry.manual,
        badge: def.kind === 'character'
          ? 'C' + Math.min(6, Math.max(0, copies - 1))
          : 'R' + Math.min(5, Math.max(1, copies)),
        sub: def.kind === 'character' ? '共 ' + copies + ' 份' : '共 ' + copies + ' 把'
      };
    });
  });

  return defs.map(function (def) {
    return {
      key: def.key,
      title: def.title,
      kind: def.kind,
      items: sections[def.key]
    };
  });
}

module.exports = {
  getOwned: getOwned,
  addManual: addManual,
  removeManual: removeManual,
  nameOptions: nameOptions,
  build: build
};
