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

/* 四星角色名单：收藏「补充已有」按类别选择时用于切分四星 / 五星角色 */
var FOUR_STAR_CHARACTERS = {
  genshin: ['丽莎', '芭芭拉', '凯亚', '雷泽', '安柏', '香菱', '北斗', '行秋', '凝光', '菲谢尔',
    '班尼特', '诺艾尔', '重云', '迪奥娜', '砂糖', '辛焱', '罗莎莉亚', '烟绯', '托马', '早柚',
    '五郎', '九条裟罗', '鹿野院平藏', '绮良良', '云堇', '久岐忍', '柯莱', '多莉', '坎蒂丝',
    '莱依拉', '珐露珊', '瑶瑶', '米卡', '卡维', '琳妮特', '菲米尼', '夏洛蒂', '夏沃蕾',
    '嘉明', '赛索斯', '卡齐娜', '欧洛伦', '蓝砚', '伊安珊', '伊法', '塔利雅', '爱诺',
    '雅珂达', '叶洛亚', '布伦妮', '阿罗夏'],
  starrail: ['三月七', '丹恒', '阿兰', '艾丝妲', '黑塔', '希露瓦', '娜塔莎', '佩拉', '桑博',
    '虎克', '玲可', '卢卡', '青雀', '停云', '素裳', '驭空', '桂乃芬', '雪衣', '寒鸦',
    '貊泽', '加拉赫', '米沙', '大丽花']
};

function config(key) {
  return GAMES[key] || GAMES.genshin;
}

module.exports = {
  GAMES: GAMES,
  POOL_LABELS: POOL_LABELS,
  FOUR_STAR_CHARACTERS: FOUR_STAR_CHARACTERS,
  poolLabel: poolLabel,
  config: config
};
