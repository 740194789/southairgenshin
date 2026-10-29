/* 多端同步：离线优先，联网时把本地全量数据推给服务端并取回合并结果 */

var api = require('./api');
var store = require('./store');

var GAMES = ['genshin', 'starrail'];
var pending = {};
var lastAttempt = {};
var THROTTLE_MS = 20000;

function enabled() {
  return api.isConfigured() && !!api.getToken();
}

function notifyAuthExpired() {
  try {
    var app = getApp();
    if (app && app.handleAuthExpired) {
      app.handleAuthExpired();
    }
  } catch (e) {
    // 非页面环境忽略
  }
}

/**
 * 同步单个游戏。
 *
 * @param {string} game
 * @param {boolean} force true 表示忽略节流（本地刚改过数据时使用）
 */
function sync(game, force) {
  if (!enabled()) {
    return Promise.resolve({ ok: false, skipped: true, message: '未登录或未配置同步服务器' });
  }
  if (pending[game]) {
    // 正在同步时又产生了本地修改：等上一轮结束再补一次，避免快照覆盖新改动
    return force
      ? pending[game].then(function () { return sync(game, true); })
      : pending[game];
  }
  var now = Date.now();
  if (!force && lastAttempt[game] && now - lastAttempt[game] < THROTTLE_MS) {
    return Promise.resolve({ ok: true, skipped: true, message: '稍后自动同步' });
  }
  lastAttempt[game] = now;

  var payload = store.syncPayload(game);
  var sentRecords = [];
  var sentTombstones = [];
  payload.records.forEach(function (item) {
    if (item.deleted) {
      sentTombstones.push(item.clientUid);
    } else {
      sentRecords.push(item.clientUid);
    }
  });

  var promise = api.syncMerge(game, payload).then(function (snapshot) {
    var count = store.applySnapshot(game, snapshot, sentRecords, sentTombstones);
    return { ok: true, count: count, serverTime: snapshot.serverTime || now };
  }).then(function (result) {
    delete pending[game];
    return result;
  }, function (err) {
    delete pending[game];
    var message = err && err.message ? err.message : '同步失败';
    if (message.indexOf('登录状态') >= 0) {
      notifyAuthExpired();
    }
    return { ok: false, message: message };
  });

  pending[game] = promise;
  return promise;
}

function syncAll(force) {
  return Promise.all(GAMES.map(function (game) {
    return sync(game, force);
  }));
}

function statusText(game) {
  var last = store.getLastSync(game);
  if (!last) {
    return enabled() ? '尚未同步' : '未登录 / 离线';
  }
  var date = new Date(last);
  var pad = function (n) {
    return n < 10 ? '0' + n : String(n);
  };
  return '已同步 ' + (date.getMonth() + 1) + '-' + date.getDate()
    + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

module.exports = {
  enabled: enabled,
  sync: sync,
  syncAll: syncAll,
  statusText: statusText
};
