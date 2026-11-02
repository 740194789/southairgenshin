/* 内置版本 / 卡池日历（与网页端 src/main/resources/calendar/banners.json 保持一致）
   数据为内置示例，按官方公告维护版本、卡池起止时间与预估收入。 */

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
  },
  starrail: {
    currency: '星琼',
    updatedAt: '2026-11-01',
    note: '内置示例日历：版本与卡池起止时间按官方公告维护（小程序改 utils/calendar.js）。',
    versions: [
      {
        version: '4.7',
        start: '2026-10-14',
        end: '2026-11-25',
        phases: [
          {
            name: '上半',
            start: '2026-10-14',
            end: '2026-11-04',
            incomePrimogems: 3600,
            banners: ['角色活动', '光锥活动']
          },
          {
            name: '下半',
            start: '2026-11-04',
            end: '2026-11-25',
            incomePrimogems: 3600,
            banners: ['角色活动', '光锥活动']
          }
        ]
      },
      {
        version: '4.8',
        start: '2026-11-25',
        end: '2027-01-06',
        phases: [
          {
            name: '上半',
            start: '2026-11-25',
            end: '2026-12-16',
            incomePrimogems: 3600,
            banners: ['角色活动', '光锥活动']
          },
          {
            name: '下半',
            start: '2026-12-16',
            end: '2027-01-06',
            incomePrimogems: 3600,
            banners: ['角色活动', '光锥活动']
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

function gameData(game) {
  return DATA[game] || DATA.genshin;
}

/** 当前与下一期卡池：{ calendar, current, next } */
function info(game) {
  var calendar = gameData(game);
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

module.exports = {
  data: DATA,
  gameData: gameData,
  info: info,
  daysUntil: daysUntil,
  dateOnly: dateOnly
};
