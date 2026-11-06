/* 内置版本 / 卡池日历（与网页端 src/main/resources/calendar/banners.json 保持一致）
   数据为内置示例，按官方公告维护版本、卡池起止时间与预估收入。 */

var net = require('./net');

var DATA = {
  genshin: {
    currency: '原石',
    updatedAt: '2026-11-01',
    note: '内置示例日历：版本与卡池起止时间按官方公告维护（小程序改 utils/calendar.js）。',
    versions: [
      {
        version: '6.3',
        start: '2026-10-21',
        end: '2026-12-02',
        phases: [
          {
            name: '上半',
            start: '2026-10-21',
            end: '2026-11-11',
            incomePrimogems: 4200,
            banners: ['角色活动', '武器活动']
          },
          {
            name: '下半',
            start: '2026-11-11',
            end: '2026-12-02',
            incomePrimogems: 4200,
            banners: ['角色活动', '武器活动', '集录祈愿']
          }
        ]
      },
      {
        version: '6.4',
        start: '2026-12-02',
        end: '2027-01-13',
        phases: [
          {
            name: '上半',
            start: '2026-12-02',
            end: '2026-12-23',
            incomePrimogems: 4200,
            banners: ['角色活动', '武器活动']
          },
          {
            name: '下半',
            start: '2026-12-23',
            end: '2027-01-13',
            incomePrimogems: 4200,
            banners: ['角色活动', '武器活动', '集录祈愿']
          }
        ]
      }
    ]
  }
};

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

function dateOnly(date) {
  var d = date || new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function parseDate(text) {
  var parts = String(text || '').slice(0, 10).split('-');
  if (parts.length !== 3) {
    return null;
  }
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return isNaN(d.getTime()) ? null : d;
}

/** 距离 yyyy-MM-dd 还有多少天（按本地自然日） */
function daysUntil(text) {
  var end = parseDate(text);
  if (!end) {
    return 0;
  }
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((end.getTime() - today.getTime()) / 86400000);
}

function gameData() {
  return DATA.genshin;
}

/** 当前与下一期卡池：{ calendar, current, next } */
function info(game) {
  return infoOf(gameData(game));
}

/** 基于指定日历数据（内置或实时）计算当前与下一期 */
function infoOf(calendar) {
  var today = dateOnly();
  var list = [];
  (calendar.versions || []).forEach(function (version) {
    (version.phases || []).forEach(function (phase) {
      list.push({ version: version.version, phase: phase });
    });
  });
  for (var i = 0; i < list.length; i++) {
    if (list[i].phase.start <= today && today <= list[i].phase.end) {
      return { calendar: calendar, current: list[i], next: list[i + 1] || null };
    }
  }
  for (var j = 0; j < list.length; j++) {
    if (list[j].phase.start > today) {
      return { calendar: calendar, current: null, next: list[j] };
    }
  }
  return { calendar: calendar, current: null, next: null };
}

/* ---------------- 官方公告实时卡池（仅原神） ---------------- */

var LIVE_URL = 'https://hk4e-api.mihoyo.com/common/hk4e_cn/announcement/api/getAnnList'
    + '?game=hk4e&game_biz=hk4e_cn&lang=zh-cn&bundle_id=hk4e_cn'
    + '&platform=pc&region=cn_gf01&level=60&uid=100000000';
var LIVE_CACHE_KEY = 'sg_calendar_live_';

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function nowText() {
  var d = new Date();
  return dateOnly(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function compareVersion(left, right) {
  if (!right) {
    return 1;
  }
  var a = String(left).split('.');
  var b = String(right).split('.');
  var major = Number(a[0]) - Number(b[0]);
  if (major) {
    return major;
  }
  return (Number(a[1]) || 0) - (Number(b[1]) || 0);
}

function parseBanners(title, banners) {
  var pool = title.indexOf('神铸赋形') >= 0 ? '武器活动'
      : (title.indexOf('集录祈愿') >= 0 ? '集录祈愿' : '角色活动');
  var colon = Math.max(title.indexOf('：'), title.indexOf(':'));
  var segment = colon >= 0 ? title.slice(colon + 1) : title;
  var up = segment.indexOf('概率UP');
  if (up >= 0) {
    segment = segment.slice(0, up);
  }
  segment.split(/」「|、/).forEach(function (raw) {
    var name = raw.replace(/「|」/g, '').trim();
    if (!name) {
      return;
    }
    var exists = banners.some(function (item) {
      return item.name === name;
    });
    if (!exists) {
      banners.push({ pool: pool, name: name });
    }
  });
}

/** 把官方公告 JSON 解析成与内置日历相同的结构 */
function parseLive(root) {
  var groups = (root && root.data && root.data.list) || [];
  var phases = [];
  var version = '';
  groups.forEach(function (group) {
    (group.list || []).forEach(function (ann) {
      var title = String(ann.title || '').trim();
      var matcher = title.match(/(\d+\.\d+)版本/);
      if (matcher && compareVersion(matcher[1], version) > 0) {
        version = matcher[1];
      }
      if (title.indexOf('祈愿') < 0
          || (title.indexOf('概率UP') < 0 && title.indexOf('集录祈愿') < 0)) {
        return;
      }
      var end = String(ann.end_time || '').slice(0, 10);
      if (!end) {
        return;
      }
      var start = String(ann.start_time || '').slice(0, 10);
      var phase = null;
      phases.forEach(function (item) {
        if (item.end === end) {
          phase = item;
        }
      });
      if (!phase) {
        phase = { start: start, end: end, banners: [] };
        phases.push(phase);
      }
      if (start && (!phase.start || start < phase.start)) {
        phase.start = start;
      }
      parseBanners(title, phase.banners);
    });
  });
  // 只保留尚未结束或刚结束 12 小时内的分期
  var cutoff = dateOnly(new Date(Date.now() - 12 * 3600 * 1000));
  phases = phases.filter(function (phase) {
    return phase.end >= cutoff;
  }).sort(function (a, b) {
    return a.end < b.end ? -1 : (a.end > b.end ? 1 : 0);
  }).slice(0, 3);
  phases.forEach(function (phase, index) {
    if (index > 0) {
      phase.start = phases[index - 1].end;
    }
    if (!phase.start) {
      phase.start = dateOnly(new Date(new Date(phase.end + 'T00:00:00').getTime() - 21 * 86400000));
    }
    phase.name = '第' + (index + 1) + '期';
  });
  return {
    currency: '原石',
    updatedAt: nowText(),
    note: '来自米游社官方公告（实时）；预估收入未提供，剩余天数按公告结束时间计算。',
    _live: true,
    versions: [{
      version: version || '实时',
      start: phases.length ? phases[0].start : '',
      end: phases.length ? phases[phases.length - 1].end : '',
      phases: phases
    }]
  };
}

/** 读取 24 小时内的实时卡池缓存 */
function loadLive(game) {
  if (game !== 'genshin') {
    return null;
  }
  var cached = null;
  try {
    cached = wx.getStorageSync(LIVE_CACHE_KEY + game);
  } catch (e) {
    return null;
  }
  if (!cached || !cached.data || !(cached.data.versions || []).length) {
    return null;
  }
  if (Date.now() - (Number(cached.savedAt) || 0) > 24 * 3600 * 1000) {
    return null;
  }
  cached.data._live = true;
  return cached.data;
}

function saveLive(game, calendar) {
  try {
    wx.setStorageSync(LIVE_CACHE_KEY + game, { savedAt: Date.now(), data: calendar });
  } catch (e) {
    /* 存储失败时忽略，仅本次生效 */
  }
}

/** 联网获取官方公告并解析；失败时抛出可读错误 */
function fetchLive(game) {
  if (game !== 'genshin') {
    return Promise.reject(new Error('星穹铁道暂未提供公开卡池接口'));
  }
  return new Promise(function (resolve, reject) {
    wx.request({
      url: LIVE_URL,
      method: 'GET',
      timeout: 15000,
      success: function (res) {
        if (res.statusCode !== 200) {
          reject(new Error('官方公告请求失败（HTTP ' + res.statusCode + '）'));
          return;
        }
        var root = res.data;
        if (typeof root === 'string') {
          try {
            root = JSON.parse(root);
          } catch (e) {
            reject(new Error('官方公告解析失败'));
            return;
          }
        }
        var calendar = parseLive(root);
        if (!calendar.versions[0].phases.length) {
          reject(new Error('官方公告里没有可用卡池'));
          return;
        }
        resolve(calendar);
      },
      fail: function (err) {
        var message = String((err && err.errMsg) || '');
        if (net.isDomainError(message)) {
          /* 后台还没配好 request 合法域名时，用云函数代理再试一次 */
          net.proxyJson(LIVE_URL).then(function (root) {
            var calendar = parseLive(root);
            if (!calendar.versions[0].phases.length) {
              reject(new Error('官方公告里没有可用卡池'));
              return;
            }
            resolve(calendar);
          }, function () {
            reject(new Error('未配置请求域名：请在小程序后台添加 hk4e-api.mihoyo.com'));
          });
          return;
        }
        reject(new Error('联网获取失败，请检查网络'));
      }
    });
  });
}

module.exports = {
  data: DATA,
  gameData: gameData,
  info: info,
  infoOf: infoOf,
  parseLive: parseLive,
  loadLive: loadLive,
  saveLive: saveLive,
  fetchLive: fetchLive,
  daysUntil: daysUntil,
  dateOnly: dateOnly
};
