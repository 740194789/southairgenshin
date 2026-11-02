/* UIGF v4.2（原神）/ SRGF v1.0（星穹铁道）互转，与网页端 UigfService 口径一致 */

var GENSHIN_TYPE_TO_POOL = {
  301: '角色活动',
  302: '武器活动',
  400: '集录祈愿',
  200: '常驻'
};
var GENSHIN_POOL_TO_TYPE = {
  角色活动: '301',
  武器活动: '302',
  集录祈愿: '400',
  常驻: '200'
};
var STARRAIL_TYPE_TO_POOL = {
  11: '角色活动',
  12: '光锥活动',
  21: '联动',
  22: '联动',
  1: '常驻'
};
var STARRAIL_POOL_TO_TYPE = {
  角色活动: '11',
  光锥活动: '12',
  联动: '21',
  常驻: '1'
};

var STANDARD = {
  genshin: {
    characters: ['迪卢克', '琴', '莫娜', '七七', '刻晴', '提纳里', '迪希雅', '梦见月瑞希'],
    weapons: ['天空之刃', '天空之翼', '天空之傲', '天空之卷', '天空之脊',
      '阿莫斯之弓', '狼的末路', '风鹰剑', '四风原典', '和璞鸢']
  },
  starrail: {
    characters: ['姬子', '瓦尔特', '布洛妮娅', '杰帕德', '克拉拉', '彦卿', '白露'],
    extraCharacters: ['云璃', '银枝', '银狼', '符玄', '刃', '希儿'],
    weapons: ['银河铁道之夜', '无可取代的东西', '但战斗还未结束', '以世界之名',
      '制胜的瞬间', '于夜色中', '时节不居']
  }
};

var APP_NAME = 'SouthAir Genshin';
var APP_VERSION = '1.0';

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

function nowStr() {
  var d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function parseTime(value) {
  var text = String(value || '').trim().replace('T', ' ');
  if (text.length > 19) {
    text = text.slice(0, 19);
  }
  if (text.length === 16) {
    text += ':00';
  }
  return text || nowStr();
}

function poolOf(gachaType, starrail) {
  var map = starrail ? STARRAIL_TYPE_TO_POOL : GENSHIN_TYPE_TO_POOL;
  return map[String(gachaType)] || '角色活动';
}

function typeOf(pool, starrail) {
  var map = starrail ? STARRAIL_POOL_TO_TYPE : GENSHIN_POOL_TO_TYPE;
  return map[pool] || (starrail ? '11' : '301');
}

function inferIsUp(starrail, pool, name, rarity) {
  if (Number(rarity) < 5) {
    return false;
  }
  var std = STANDARD[starrail ? 'starrail' : 'genshin'];
  if (pool === '角色活动') {
    return std.characters.indexOf(name) < 0
      && (std.extraCharacters || []).indexOf(name) < 0;
  }
  if (pool === '武器活动' || pool === '光锥活动') {
    return std.weapons.indexOf(name) < 0;
  }
  return false;
}

/** 按 UID + 卡池累计抽数，命中五星时记录本次保底并清零。 */
function applyPity(items) {
  var groups = {};
  items.forEach(function (item) {
    var key = (item.uid || '') + '\u0001' + item.pool;
    (groups[key] = groups[key] || []).push(item);
  });
  Object.keys(groups).forEach(function (key) {
    var list = groups[key].sort(function (a, b) {
      if (a.time !== b.time) {
        return a.time < b.time ? -1 : 1;
      }
      return a.order - b.order;
    });
    var count = 0;
    list.forEach(function (item) {
      count += item.count;
      item.pity = count;
      if (item.rarity >= 5) {
        count = 0;
      }
    });
  });
}

/**
 * 解析 UIGF v4.2 / SRGF v1.0 / UIGF v3 文本。
 * 返回 { records } 或 { error }。
 */
function parse(text, game) {
  var content = String(text || '').trim();
  if (!content) {
    return { error: '导入内容为空' };
  }
  var root;
  try {
    root = JSON.parse(content);
  } catch (e) {
    return { error: '不是有效的 JSON 文件' };
  }
  if (!root || typeof root !== 'object') {
    return { error: '不是有效的 UIGF / SRGF 文件' };
  }
  var starrail = game === 'starrail';
  var lists = [];
  if (root.hk4e || root.hkrpg) {
    var section = starrail ? root.hkrpg : root.hk4e;
    if (!section) {
      return { error: starrail ? '文件里没有星穹铁道（hkrpg）记录' : '文件里没有原神（hk4e）记录' };
    }
    if (Array.isArray(section)) {
      section.forEach(function (account) {
        lists.push({ list: account.gachaLog || [], uid: account.uid || '' });
      });
    } else {
      lists.push({ list: section.gachaLog || [], uid: section.uid || '' });
    }
  } else if (Array.isArray(root.list)) {
    lists.push({
      list: root.list,
      uid: (root.info && root.info.uid) || '',
      starrail: (root.info && root.info.srgf_version) ? true : starrail
    });
  } else {
    return { error: '未识别的 UIGF / SRGF 结构' };
  }

  var items = [];
  var order = 0;
  lists.forEach(function (group) {
    var isSR = group.starrail === true || starrail;
    (group.list || []).forEach(function (node) {
      if (!node || typeof node !== 'object') {
        return;
      }
      order++;
      var rarity = Number(node.rank_type || node.rarity || 3);
      var gachaType = String(node.gacha_type || '');
      items.push({
        order: order,
        starrail: isSR,
        uid: String(node.uid || group.uid || ''),
        name: String(node.name || ''),
        itemType: String(node.item_type || ''),
        rarity: rarity,
        count: Math.max(1, Number(node.count) || 1),
        time: parseTime(node.time),
        pool: poolOf(gachaType, isSR),
        pityOverride: Number(node.pity) || 0,
        isUpOverride: node.is_up === true ? true : (node.is_up === false ? false : null),
        captureOverride: node.capture_triggered === true ? true : null
      });
    });
  });
  if (!items.length) {
    return { error: '文件中没有抽卡记录' };
  }
  applyPity(items);

  var records = [];
  items.forEach(function (item) {
    var recordable = item.rarity >= 5
      || (item.rarity === 4 && (item.itemType || '').trim() === '角色');
    if (!recordable) {
      return;
    }
    records.push({
      uid: item.uid,
      itemName: item.name,
      itemType: item.itemType,
      pool: item.pool,
      rarity: item.rarity,
      pityCount: item.pityOverride > 0 ? item.pityOverride : Math.max(1, item.pity),
      isUp: item.isUpOverride !== null
        ? item.isUpOverride
        : inferIsUp(item.starrail, item.pool, item.name, item.rarity),
      wishTime: item.time,
      captureTriggered: item.captureOverride === true
    });
  });
  if (!records.length) {
    return { error: '文件中的记录都被规则过滤（只保留四星角色与五星物品）' };
  }
  return { records: records };
}

function groupByUid(records, uid) {
  var groups = {};
  var filter = String(uid || '').trim();
  (records || []).forEach(function (record) {
    var key = String(record.uid || '').trim() || '100000000';
    if (filter && key !== filter) {
      return;
    }
    (groups[key] = groups[key] || []).push(record);
  });
  if (!Object.keys(groups).length) {
    groups[filter || '100000000'] = [];
  }
  return groups;
}

function appendEntries(logs, uid, records, starrail) {
  records.forEach(function (record, index) {
    logs.push({
      uid: uid,
      gacha_type: typeOf(record.pool, starrail),
      item_id: '',
      count: '1',
      time: parseTime(record.wishTime),
      name: record.itemName || '',
      lang: 'zh-cn',
      item_type: record.itemType || '',
      rank_type: String(record.rarity || 3),
      id: uid + '-' + (index + 1),
      pity: Number(record.pityCount) || 1,
      is_up: record.isUp === true,
      capture_triggered: record.captureTriggered === true
    });
  });
}

/** 导出为 UIGF v4.2（原神）或 SRGF v1.0（星穹铁道）对象。 */
function build(records, game, uid) {
  var starrail = game === 'starrail';
  var groups = groupByUid(records, uid);
  var uids = Object.keys(groups);
  var now = nowStr();
  if (starrail) {
    var srgfUid = uids[0];
    var srgfLogs = [];
    appendEntries(srgfLogs, srgfUid, groups[srgfUid], true);
    return {
      info: {
        uid: srgfUid,
        lang: 'zh-cn',
        region_time_zone: 8,
        srgf_version: 'v1.0',
        export_timestamp: Math.floor(Date.now() / 1000),
        export_app: APP_NAME,
        export_app_version: APP_VERSION
      },
      list: srgfLogs
    };
  }
  var accounts = uids.map(function (key) {
    var logs = [];
    appendEntries(logs, key, groups[key], false);
    return { uid: key, lang: 'zh-cn', region_time_zone: 8, gachaLog: logs };
  });
  return {
    info: {
      version: 'v4.2',
      lang: 'zh-cn',
      region_time_zone: 8,
      export_time: now,
      export_timestamp: Math.floor(Date.now() / 1000),
      export_app: APP_NAME,
      export_app_version: APP_VERSION
    },
    hk4e: accounts
  };
}

module.exports = {
  parse: parse,
  build: build
};
