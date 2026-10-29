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
    threeStarType: '武器'
  },
  starrail: {
    key: 'starrail',
    switchLabel: '星穹铁道',
    fullName: '崩坏：星穹铁道',
    title: 'SouthAir Genshin · 崩坏：星穹铁道记录',
    subtitle: '星穹列车数据记录 · 离线小程序',
    heroSub: 'Warp Planner',
    pools: ['角色活动', '光锥活动', '常驻'],
    itemTypes: ['角色', '光锥'],
    currency: '星琼',
    credit: '信用点',
    fateLimited: '星轨专票',
    fateStandard: '星轨通票',
    threeStarType: '光锥'
  }
};

function config(key) {
  return GAMES[key] || GAMES.genshin;
}

module.exports = {
  GAMES: GAMES,
  config: config
};
