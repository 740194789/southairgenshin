/* 离线 AI 录入：本地语义解析，不联网（与网页版 app.js 的解析口径保持一致） */

var avatars = require('./avatars');
var weaponIcons = require('./weaponIcons');
var gameLib = require('./game');

/* 常驻名单：判定五星是否 UP，与网页端、链接导入口径一致 */
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

var RESOURCE_WORDS = [
  { key: 'primogems', words: ['原石', '星琼', '石头'] },
  { key: 'mora', words: ['摩拉', '信用点'] },
  { key: 'intertwinedFates', words: ['纠缠之缘', '纠缠', '星轨专票', '专票'] },
  { key: 'acquaintedFates', words: ['相遇之缘', '相遇', '星轨通票', '通票'] },
  { key: 'genesisCrystals', words: ['创世结晶', '创世', '结晶'] },
  { key: 'heroWit', words: ['大英雄的经验', '大英雄', '经验书', '紫书'] },
  { key: 'adventurerExp', words: ['冒险家的经验', '冒险家', '蓝书'] },
  { key: 'wandererAdvice', words: ['流浪者的经验', '流浪者', '绿书'] },
  { key: 'sanctifyingUnction', words: ['祝圣油膏', '油膏'] },
  { key: 'sanctifyingEssence', words: ['祝圣精华', '精华'] }
];

var NUMBER_PATTERN = '([0-9][0-9,]*(?:\\.[0-9]+)?|[零〇一二两三四五六七八九十百千万]+)';

function sortNames(list) {
  return list.slice().sort(function (a, b) {
    return a.localeCompare(b, 'zh-Hans-CN');
  });
}

function nameLists(game) {
  return {
    characters: sortNames(Object.keys(avatars[game] || {})),
    weapons: sortNames(Object.keys(weaponIcons[game] || {}))
  };
}

function isFourStar(game, name) {
  var four = gameLib.FOUR_STAR_CHARACTERS[game] || [];
  return four.indexOf(name) >= 0;
}

function protagonistOf(game) {
  return game === 'starrail' ? '开拓者' : '旅行者';
}

/** 录入五星时的候选：五星角色 + 五星武器 / 光锥 */
function fiveStarNames(game) {
  var lists = nameLists(game);
  var protagonist = protagonistOf(game);
  var characters = lists.characters.filter(function (name) {
    return name !== protagonist && !isFourStar(game, name);
  });
  return characters.concat(lists.weapons);
}

function compact(text) {
  return String(text || '').replace(/\s+/g, '');
}

function pad2(value) {
  var number = Number(value);
  return (number < 10 ? '0' : '') + number;
}

/** 阿拉伯数字 / 中文数字统一转数值（支持「六百」「六十六」「1.2万」） */
function parseNumber(text) {
  var raw = String(text || '').replace(/,/g, '');
  if (/^[0-9]+(\.[0-9]+)?$/.test(raw)) {
    return Number(raw);
  }
  var digit = {
    '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9
  };
  var unit = { '十': 10, '百': 100, '千': 1000 };
  var total = 0;
  var section = 0;
  var number = 0;
  for (var i = 0; i < raw.length; i += 1) {
    var ch = raw.charAt(i);
    if (digit[ch] !== undefined) {
      number = digit[ch];
    } else if (ch === '万') {
      total += (section + number) * 10000;
      section = 0;
      number = 0;
    } else if (unit[ch]) {
      section += (number || 1) * unit[ch];
      number = 0;
    } else {
      return NaN;
    }
  }
  return total + section + number;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 在关键词前后找数值，兼容「600原石」「原石：600」 */
function amountNear(text, word) {
  var escaped = escapeRegExp(word);
  var patterns = [
    new RegExp(NUMBER_PATTERN + '\\s*(万|w|W)?\\s*(?:个|枚|抽|本|份)?\\s*' + escaped),
    new RegExp(escaped + '\\s*(?:还有|有|是|大概|约|剩|：|:|＝|=)?\\s*'
      + NUMBER_PATTERN + '\\s*(万|w|W)?')
  ];
  for (var i = 0; i < patterns.length; i += 1) {
    var match = patterns[i].exec(text);
    if (!match) {
      continue;
    }
    var value = parseNumber(match[1]);
    if (isNaN(value)) {
      continue;
    }
    return /万|w|W/.test(match[2] || '') ? value * 10000 : value;
  }
  return null;
}

/** 资源类语句 → 表单字段 */
function parseResource(text, game) {
  var values = {};
  var found = 0;
  RESOURCE_WORDS.forEach(function (token) {
    for (var i = 0; i < token.words.length; i += 1) {
      var amount = amountNear(text, token.words[i]);
      if (amount !== null) {
        values[token.key] = amount;
        found += 1;
        return;
      }
    }
  });
  return found ? values : null;
}

/** 抽卡时间：绝对日期、相对日期与可选时刻，返回 { date, time } */
function wishTime(text) {
  var now = new Date();
  var hour = 12;
  var minute = 0;
  var second = null;
  var clock = /(\d{1,2})\s*[:：]\s*(\d{1,2})(?:\s*[:：]\s*(\d{1,2}))?/.exec(text);
  var spoken = /(上午|中午|下午|傍晚|晚上|凌晨|清晨|早上)?\s*(\d{1,2})\s*[点时](?:\s*(\d{1,2})\s*分?)?(?:\s*(\d{1,2})\s*秒)?/
    .exec(text);
  if (clock) {
    hour = Number(clock[1]);
    minute = Number(clock[2]);
    if (clock[3] !== undefined) {
      second = Number(clock[3]);
    }
  } else if (spoken) {
    var period = spoken[1] || '';
    hour = Number(spoken[2]);
    minute = spoken[3] ? Number(spoken[3]) : 0;
    if (spoken[4] !== undefined) {
      second = Number(spoken[4]);
    }
    if (/下午|傍晚|晚上/.test(period) && hour < 12) {
      hour += 12;
    }
    if (/凌晨|清晨|早上|上午/.test(period) && hour === 12) {
      hour = 0;
    }
  }
  if (hour > 23) {
    hour = 23;
  }
  if (minute > 59) {
    minute = 59;
  }
  if (second !== null && (second > 59 || isNaN(second))) {
    second = null;
  }

  var year = now.getFullYear();
  var month = now.getMonth() + 1;
  var day = now.getDate();
  var full = /(\d{4})[年\-/．.](\d{1,2})[月\-/．.](\d{1,2})[日号]?/.exec(text);
  var monthDay = /(\d{1,2})月(\d{1,2})[日号]?/.exec(text);
  var dayOnly = /(\d{1,2})[日号]/.exec(text);
  var relative = /前天|昨天|昨日|昨晚|今天|今日|刚才|刚刚|现在/.test(text);

  if (full) {
    year = Number(full[1]);
    month = Number(full[2]);
    day = Number(full[3]);
  } else if (monthDay) {
    month = Number(monthDay[1]);
    day = Number(monthDay[2]);
  } else if (dayOnly) {
    day = Number(dayOnly[1]);
  } else if (/前天/.test(text)) {
    day -= 2;
  } else if (/昨天|昨日|昨晚/.test(text)) {
    day -= 1;
  }
  if (!clock && !spoken && relative) {
    hour = now.getHours();
    minute = now.getMinutes();
  }

  var built = new Date(year, Math.max(1, month) - 1, Math.max(1, day), hour, minute);
  if (built.getTime() > now.getTime() + 24 * 3600 * 1000 && !full) {
    built.setFullYear(built.getFullYear() - 1);
  }
  var date = built.getFullYear() + '-' + pad2(built.getMonth() + 1) + '-' + pad2(built.getDate());
  var time = pad2(built.getHours()) + ':' + pad2(built.getMinutes())
    + (second === null ? '' : ':' + pad2(second));
  return { date: date, time: time };
}

function matchName(text, names) {
  var best = null;
  names.forEach(function (name) {
    var index = text.indexOf(name);
    if (index >= 0 && (!best || name.length > best.name.length)) {
      best = { name: name, index: index };
    }
  });
  if (best) {
    return best;
  }
  names.forEach(function (name) {
    if (name.length < 3 || best) {
      return;
    }
    // 只允许同长度的一字容错，避免「黑塔」被误判为「大黑塔」
    for (var i = 0; i + name.length <= text.length; i += 1) {
      if (editDistance(name, text.substr(i, name.length)) <= 1) {
        best = { name: name, index: i };
        return;
      }
    }
  });
  return best;
}

function editDistance(a, b) {
  var prev = [];
  for (var j = 0; j <= b.length; j += 1) {
    prev[j] = j;
  }
  for (var i = 1; i <= a.length; i += 1) {
    var cur = [i];
    for (var k = 1; k <= b.length; k += 1) {
      cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1,
        prev[k - 1] + (a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 卡池：按文字里的角色池 / 武器池 / 混池 / 联动池 / 常驻判定 */
function poolOf(text, game, isWeapon) {
  var g = gameLib.config(game);
  if (/常驻|标准池|标准祈愿|普池/.test(text)) {
    return '常驻';
  }
  if (game === 'genshin') {
    if (/集录|混池|混合池|自选池/.test(text)) {
      return '集录祈愿';
    }
  } else if (/联动|Fate|fate|命运之夜|Saber|Archer|远坂凛|吉尔伽美什/.test(text)) {
    return '联动';
  }
  if (/武器池|武器卡池|武器活动|武器祈愿|光锥池|光锥卡池|光锥活动|光锥祈愿/.test(text)) {
    return g.weaponPool;
  }
  if (/角色池|角色卡池|角色活动|角色祈愿|限定池|限定祈愿|UP池|up池|星缘相邀/.test(text)) {
    return g.charPool;
  }
  return isWeapon ? g.weaponPool : g.charPool;
}

/** 抽数：优先取靠近「出 / 抽到 / 歪」的数字 */
function pityOf(text, nameIndex) {
  var re = /([0-9]{1,3}|[零〇一二三四五六七八九十百]{1,5})\s*(?:抽|连|发)/g;
  var best = null;
  var match;
  while ((match = re.exec(text)) !== null) {
    var value = parseNumber(match[1]);
    if (isNaN(value) || value < 1 || value > 200) {
      continue;
    }
    var around = text.slice(Math.max(0, match.index - 12), match.index + match[0].length + 14);
    var score = /出|歪|中|拿到|来了|获得|抽到/.test(around) ? 2 : 0;
    if (nameIndex !== undefined && match.index > nameIndex && match.index - nameIndex < 30) {
      score += 1;
    }
    if (!best || score > best.score) {
      best = { value: value, score: score };
    }
  }
  return best ? best.value : null;
}

/** 收藏补充：把「N命 / 精N / 满命」换算成目标总份数（C0 = 1 份） */
function ownedTarget(text, game, name) {
  var lists = nameLists(game);
  var category = 'characters5';
  if (lists.weapons.indexOf(name) >= 0) {
    category = 'weapons5';
  } else if (isFourStar(game, name)) {
    category = 'characters4';
  }
  var target = 1;
  if (category === 'weapons5') {
    if (/满精/.test(text)) {
      target = 5;
    } else {
      var refine = /精[炼]?\s*([0-9一二两三四五])(?![\d])/.exec(text)
        || /([0-9一二两三四五])\s*精/.exec(text);
      target = refine ? parseNumber(refine[1]) : 1;
    }
    if (!isFinite(target) || target < 1) {
      target = 1;
    }
    target = Math.min(5, target);
  } else {
    if (/满命/.test(text)) {
      target = 7;
    } else {
      var con = /([0-9一二两三四五六])\s*命/.exec(text);
      target = con ? (parseNumber(con[1]) || 0) + 1 : 1;
    }
    if (!isFinite(target) || target < 1) {
      target = 1;
    }
    target = Math.min(7, target);
  }
  return { category: category, name: name, target: target };
}

function badge(category, copies) {
  if (category === 'weapons5') {
    return 'R' + Math.min(5, Math.max(1, Number(copies) || 1));
  }
  return 'C' + Math.min(6, Math.max(0, (Number(copies) || 1) - 1));
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

/** 一句话 → 动作类型 + 预填字段；解析不出来返回 null */
function parseOne(raw, game) {
  var text = compact(raw);
  if (!text) {
    return null;
  }
  var lists = nameLists(game);
  var hit = matchName(text, fiveStarNames(game));
  var hasPull = /抽|出|歪|获得|拿到|中了/.test(text);
  if (hit && hasPull) {
    var isWeapon = lists.weapons.indexOf(hit.name) >= 0;
    var pool = poolOf(text, game, isWeapon);
    var time = wishTime(text);
    var values = {
      itemName: hit.name,
      rarity: 5,
      itemType: isWeapon ? gameLib.config(game).itemTypes[1] : gameLib.config(game).itemTypes[0],
      pool: pool,
      isUp: inferIsUp(game, pool, hit.name, time.date + ' ' + time.time),
      pityCount: 1
    };
    values.date = time.date;
    values.time = time.time;
    var pity = pityOf(text, hit.index);
    if (pity) {
      values.pityCount = Math.min(pool === gameLib.config(game).weaponPool ? 80 : 90, pity);
    }
    return { type: 'wish', name: hit.name, values: values };
  }
  var resources = parseResource(text, game);
  if (resources) {
    return { type: 'resource', values: resources };
  }
  var owned = hit || matchName(text, lists.characters.concat(lists.weapons));
  if (owned) {
    return { type: 'owned', name: owned.name, values: ownedTarget(text, game, owned.name) };
  }
  return null;
}

/** 多行文本按行解析：返回统一批量结果 */
function parseLines(raw, game) {
  var lines = String(raw || '').split(/[\r\n]+/)
    .map(function (line) { return line.trim(); })
    .filter(function (line) { return !!line; });
  var items = [];
  var resources = {};
  var failures = [];
  var types = [];
  lines.forEach(function (line, index) {
    var one = parseOne(line, game);
    if (!one) {
      failures.push(index + 1);
      return;
    }
    if (one.type === 'resource') {
      Object.keys(one.values).forEach(function (key) {
        resources[key] = one.values[key];
      });
    } else {
      items.push(one);
    }
    types.push(one.type);
  });
  var type = '';
  if (types.length) {
    type = types.every(function (item) { return item === types[0]; }) ? types[0] : '';
  }
  return { lines: lines, items: items, resources: resources, failures: failures, type: type };
}

module.exports = {
  nameLists: nameLists,
  fiveStarNames: fiveStarNames,
  isFourStar: isFourStar,
  parseOne: parseOne,
  parseLines: parseLines,
  parseResource: parseResource,
  wishTime: wishTime,
  ownedTarget: ownedTarget,
  badge: badge,
  inferIsUp: inferIsUp,
  parseNumber: parseNumber
};
