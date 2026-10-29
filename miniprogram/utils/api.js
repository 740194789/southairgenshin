/* 后端 API 封装：登录凭证保存在本地，401 时自动清除 */

var config = require('./config');

var TOKEN_KEY = 'sg_token';
var USER_KEY = 'sg_user';

function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || '';
}

function getUser() {
  var user = wx.getStorageSync(USER_KEY);
  return user && typeof user === 'object' ? user : null;
}

function saveAuth(token, user) {
  wx.setStorageSync(TOKEN_KEY, token || '');
  wx.setStorageSync(USER_KEY, user || null);
}

function clearAuth() {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(USER_KEY);
}

function request(path, method, data) {
  return new Promise(function (resolve, reject) {
    if (!config.isConfigured()) {
      reject(new Error('尚未配置同步服务器'));
      return;
    }
    var header = { 'Content-Type': 'application/json' };
    var token = getToken();
    if (token) {
      header.Authorization = 'Bearer ' + token;
    }
    wx.request({
      url: config.BASE_URL + path,
      method: method || 'GET',
      data: data,
      header: header,
      timeout: 20000,
      success: function (res) {
        var body = res.data || {};
        if (res.statusCode === 401 || body.code === 401) {
          clearAuth();
          reject(new Error('登录状态已失效，请重新登录'));
          return;
        }
        if (res.statusCode !== 200 || body.code !== 0) {
          reject(new Error(body.message || ('请求失败（' + res.statusCode + '）')));
          return;
        }
        resolve(body.data);
      },
      fail: function () {
        reject(new Error('网络不可用，数据已保存在本机'));
      }
    });
  });
}

function login(username, password) {
  return request('/api/auth/login', 'POST', {
    username: username,
    password: password
  }).then(function (data) {
    saveAuth(data.token, data.user);
    return data;
  });
}

function register(username, password) {
  return request('/api/auth/register', 'POST', {
    username: username,
    password: password
  }).then(function (data) {
    saveAuth(data.token, data.user);
    return data;
  });
}

function syncSnapshot(game) {
  return request('/api/sync/snapshot?game=' + encodeURIComponent(game), 'GET');
}

function syncMerge(game, payload) {
  return request('/api/sync/merge?game=' + encodeURIComponent(game), 'POST', payload);
}

module.exports = {
  isConfigured: config.isConfigured,
  getToken: getToken,
  getUser: getUser,
  saveAuth: saveAuth,
  clearAuth: clearAuth,
  login: login,
  register: register,
  syncSnapshot: syncSnapshot,
  syncMerge: syncMerge
};
