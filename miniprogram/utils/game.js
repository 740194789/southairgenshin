/* 两套游戏的卡池、货币与文案配置（与网页版 src/main/resources/static/js/app.js 保持一致） */

var GAMES = {
  genshin: {
    key: 'genshin',
    switchLabel: '原神',
    fullName: '原神',
    title: 'SouthAir Genshin · 原神数据记录',
    subtitle: '提瓦特数据记录 · 离线小程序',
    heroSub: 'Wish Planner',
    pools: ['角色活动', '武器活动', '集录祈愿', '常驻'],
    itemTypes: ['角色', '武器'],
    currency: '原石',
    credit: '摩拉',
    fateLimited: '纠缠之缘',
    fateStandard: '相遇之缘',
    genesisCrystal: '创世结晶',
    threeStarType: '武器',
    charPool: '角色活动',
    weaponPool: '武器活动'
  },
  starrail: {
    key: 'starrail',
    switchLabel: '星穹铁道',
    fullName: '崩坏：星穹铁道',
    title: 'SouthAir Genshin · 崩坏：星穹铁道记录',
    subtitle: '星穹列车数据记录 · 离线小程序',
    heroSub: 'Warp Planner',
    pools: ['角色活动', '光锥活动', '联动', '常驻'],
    itemTypes: ['角色', '光锥'],
    currency: '星琼',
    credit: '信用点',
    fateLimited: '星轨专票',
    fateStandard: '星轨通票',
    genesisCrystal: '古老梦华',
    threeStarType: '光锥',
    charPool: '角色活动',
    weaponPool: '光锥活动'
  }
};

/* 卡池展示名：库内值保持不变，避免历史记录、备份与导入失效 */
var POOL_LABELS = {
  '角色活动': '角色卡池',
  '武器活动': '武器卡池',
  '光锥活动': '光锥卡池'
};

function poolLabel(pool) {
  return POOL_LABELS[pool] || pool || '';
}

/** 由 UID 首位推断区服，与网页端 UidRegion 口径一致 */
function regionOf(uid, game) {
  var text = String(uid || '').trim();
  if (!text) {
    return '未知区服';
  }
  var first = text.charAt(0);
  if ((game || 'genshin') === 'starrail') {
    if (first === '1' || first === '2') {
      return '国服';
    }
  } else if (first >= '1' && first <= '5') {
    return '国服';
  }
  if (first === '6') {
    return '美服';
  }
  if (first === '7') {
    return '欧服';
  }
  if (first === '8') {
    return '亚服';
  }
  if (first === '9') {
    return '港澳台服';
  }
  return '未知区服';
}

/* 四星角色名单：收藏「补充已有」按类别选择时用于切分四星 / 五星角色 */
var FOUR_STAR_CHARACTERS = {
  genshin: ['丽莎', '芭芭拉', '凯亚', '雷泽', '安柏', '香菱', '北斗', '行秋', '凝光', '菲谢尔',
    '班尼特', '诺艾尔', '重云', '迪奥娜', '砂糖', '辛焱', '罗莎莉亚', '烟绯', '托马', '早柚',
    '五郎', '九条裟罗', '鹿野院平藏', '绮良良', '云堇', '久岐忍', '柯莱', '多莉', '坎蒂丝',
    '莱依拉', '珐露珊', '瑶瑶', '米卡', '卡维', '琳妮特', '菲米尼', '夏洛蒂', '夏沃蕾',
    '嘉明', '赛索斯', '卡齐娜', '欧洛伦', '蓝砚', '伊安珊', '伊法', '塔利雅', '爱诺',
    '雅珂达', '叶洛亚', '布伦妮', '阿罗夏', '瓦列里'],
  starrail: ['三月七', '丹恒', '阿兰', '艾丝妲', '黑塔', '希露瓦', '娜塔莎', '佩拉', '桑博',
    '虎克', '玲可', '卢卡', '青雀', '停云', '素裳', '驭空', '桂乃芬', '雪衣', '寒鸦',
    '貊泽', '加拉赫', '米沙']
};

function config(key) {
  return GAMES[key] || GAMES.genshin;
}

/* 崩铁「星缘相邀」可选角色 → 该角色加入名单的版本更新时间（官方公告为准） */
var XINGYUAN_JOINED = {
  // 3.2（2025-04-09）上线「星缘相邀」时的初始可选名单
  '符玄': '2025-04-09 06:00:00',
  '刃': '2025-04-09 06:00:00',
  '希儿': '2025-04-09 06:00:00',
  // 4.2（2026-04-22）名单扩充加入
  '云璃': '2026-04-22 06:00:00',
  '银枝': '2026-04-22 06:00:00',
  '银狼': '2026-04-22 06:00:00'
};
var XINGYUAN_CHARACTERS = Object.keys(XINGYUAN_JOINED);

/**
 * 星缘相邀角色是否算 UP：该角色加入名单之前抽到 → 不歪；之后 → 按歪处理。
 * 不在名单内返回 null，交由调用方按常驻 / UP 规则判断。
 */
function xingyuanIsUp(name, wishTime) {
  var joined = XINGYUAN_JOINED[name];
  if (!joined) {
    return null;
  }
  var time = String(wishTime || '');
  if (!time) {
    return false;
  }
  return time < joined;
}

module.exports = {
  GAMES: GAMES,
  POOL_LABELS: POOL_LABELS,
  FOUR_STAR_CHARACTERS: FOUR_STAR_CHARACTERS,
  XINGYUAN_CHARACTERS: XINGYUAN_CHARACTERS,
  XINGYUAN_JOINED: XINGYUAN_JOINED,
  poolLabel: poolLabel,
  regionOf: regionOf,
  xingyuanIsUp: xingyuanIsUp,
  config: config
};
