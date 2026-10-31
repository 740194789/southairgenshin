/* 米游社抽卡链接：校验、卡池映射、保底推算与 UP 判定（小程序端） */

var GACHA_HOSTS = [
  'public-operation-hk4e.mihoyo.com',
  'public-operation-hkrpg.mihoyo.com',
  'public-operation-hk4e-sg.hoyoverse.com',
  'public-operation-hkrpg-sg.hoyoverse.com'
];

var WEB_HOSTS = [
  'webstatic.mihoyo.com',
  'webstatic.hoyoverse.com',
  'webstatic-sea.mihoyo.com',
  'webstatic-sea.hoyoverse.com'
];

var GENSHIN_TYPES = [
  { type: '301', pool: '角色活动' },
  { type: '302', pool: '武器活动' },
  { type: '200', pool: '常驻' },
  { type: '400', pool: '集录祈愿' }
];

var STARRAIL_TYPES = [
  { type: '11', pool: '角色活动' },
  { type: '12', pool: '光锥活动' },
  { type: '21', pool: '联动' },
  { type: '22', pool: '联动' },
  { type: '1', pool: '常驻' }
];

var GENSHIN_STANDARD_CHARACTERS = [
  '迪卢克', '琴', '莫娜', '七七', '刻晴', '提纳里', '迪希雅', '梦见月瑞希'
];

var GENSHIN_STANDARD_WEAPONS = [
  '天空之刃', '天空之翼', '天空之傲', '天空之卷', '天空之脊',
  '阿莫斯之弓', '狼的末路', '风鹰剑', '四风原典', '和璞鸢'
];

var STARRAIL_STANDARD_CHARACTERS = ['姬子', '瓦尔特', '布洛妮娅', '杰帕德', '克拉拉', '彦卿', '白露'];
var STARRAIL_XINGYUAN_CHARACTERS = ['云璃', '银枝', '银狼', '符玄', '刃', '希儿'];
var STARRAIL_STANDARD_LIGHT_CONES = [
  '银河铁道之夜', '无可取代的东西', '但战斗还未结束', '以世界之名',
  '制胜的瞬间', '于夜色中', '时节不居'
];

function inList(list, value) {
  return list.indexOf(value) >= 0;
}

function hostOf(url) {
  var match = String(url || '').match(/^https?:\/\/([^/?#]+)/i);
  if (!match) {
    return '';
  }
  return match[1].split(':')[0].toLowerCase();
}

function isWebHost(host) {
  return inList(WEB_HOSTS, host);
}

function isApiHost(host) {
  return inList(GACHA_HOSTS, host);
}

function isMihoyoLink(url) {
  var host = hostOf(url);
  return isWebHost(host) || isApiHost(host);
}

/**
 * 校验米游社链接。
 * 非米游社链接返回 { isGacha: false }，交给普通文件链接流程。
 */
function validateLink(url, game) {
  if (!isMihoyoLink(url)) {
    return { isGacha: false };
  }
  var host = hostOf(url);
  var starrailLink = isWebHost(host)
    ? String(url).toLowerCase().indexOf('hkrpg') >= 0
    : host.indexOf('hkrpg') >= 0;
  var isStarrail = game === 'starrail';
  if (starrailLink !== isStarrail) {
    return {
      isGacha: true,
      ok: false,
      error: starrailLink
        ? '这是崩坏：星穹铁道的链接，请切换游戏后重试'
        : '这是原神的链接，请切换游戏后重试'
    };
  }
  if (String(url).indexOf('authkey=') < 0) {
    return {
      isGacha: true,
      ok: false,
      error: '链接中缺少 authkey，请在游戏内重新打开抽卡记录并复制'
    };
  }
  return { isGacha: true, ok: true, starrail: starrailLink };
}

function poolDefs(game) {
  return game === 'starrail' ? STARRAIL_TYPES : GENSHIN_TYPES;
}

function timeValue(text) {
  var ms = Date.parse(String(text || '').trim().replace(' ', 'T'));
  return isFinite(ms) ? ms : 0;
}

function idLess(a, b) {
  var left = String(a || '');
  var right = String(b || '');
  if (left.length !== right.length) {
    return left.length < right.length;
  }
  return left < right;
}

function resolveIsUp(game, item) {
  if (item.rarity !== 5) {
    return false;
  }
  if (item.pool === '角色活动') {
    if (game === 'starrail') {
      return !inList(STARRAIL_STANDARD_CHARACTERS, item.name)
        && !inList(STARRAIL_XINGYUAN_CHARACTERS, item.name);
    }
    return !inList(GENSHIN_STANDARD_CHARACTERS, item.name);
  }
  if (item.pool === '武器活动') {
    return !inList(GENSHIN_STANDARD_WEAPONS, item.name);
  }
  if (item.pool === '光锥活动') {
    return !inList(STARRAIL_STANDARD_LIGHT_CONES, item.name);
  }
  return false;
}

function isRecordable(item) {
  if (item.rarity < 4) {
    return false;
  }
  return item.rarity === 5 || item.itemType === '角色';
}

/**
 * 把接口原始记录按卡池排序、逐抽累计保底，再按记录规则过滤。
 * 三星与四星武器 / 光锥不计入记录，但会计入保底累计。
 */
function processItems(game, items) {
  var byPool = {};
  (items || []).forEach(function (item) {
    if (!byPool[item.pool]) {
      byPool[item.pool] = [];
    }
    byPool[item.pool].push(item);
  });

  var records = [];
  Object.keys(byPool).forEach(function (pool) {
    var list = byPool[pool].slice().sort(function (a, b) {
      var diff = timeValue(a.wishTime) - timeValue(b.wishTime);
      if (diff !== 0) {
        return diff;
      }
      return idLess(a.id, b.id) ? -1 : (idLess(b.id, a.id) ? 1 : 0);
    });
    var count = 0;
    list.forEach(function (item) {
      count += 1;
      var pity = count;
      if (item.rarity >= 5) {
        count = 0;
      }
      if (!isRecordable(item)) {
        return;
      }
      records.push({
        itemName: item.name,
        itemType: item.itemType,
        pool: item.pool,
        rarity: item.rarity,
        isUp: resolveIsUp(game, item),
        pityCount: pity,
        wishTime: item.wishTime
      });
    });
  });
  return records;
}

module.exports = {
  validateLink: validateLink,
  isMihoyoLink: isMihoyoLink,
  poolDefs: poolDefs,
  processItems: processItems
};
