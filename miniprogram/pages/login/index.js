var app = getApp();
var api = require('../../utils/api');
var store = require('../../utils/store');
var config = require('../../utils/config');

Page({
  data: {
    statusBarHeight: 20,
    username: '',
    password: '',
    loading: false,
    configured: config.isConfigured(),
    user: null
  },

  onLoad: function () {
    var info = wx.getSystemInfoSync();
    this.setData({
      statusBarHeight: info.statusBarHeight || 20,
      user: api.getUser()
    });
  },

  onUsername: function (event) {
    this.setData({ username: event.detail.value });
  },

  onPassword: function (event) {
    this.setData({ password: event.detail.value });
  },

  valid: function () {
    var username = (this.data.username || '').trim();
    var password = this.data.password || '';
    if (!username) {
      wx.showToast({ title: '请输入账号', icon: 'none' });
      return null;
    }
    if (password.length < 6) {
      wx.showToast({ title: '密码至少 6 位', icon: 'none' });
      return null;
    }
    return { username: username, password: password };
  },

  doLogin: function () {
    if (this.data.loading || !this.data.configured) {
      if (!this.data.configured) {
        wx.showToast({ title: '请先配置同步服务器', icon: 'none' });
      }
      return;
    }
    var form = this.valid();
    if (!form) {
      return;
    }
    var that = this;
    this.setData({ loading: true });
    api.login(form.username, form.password).then(function (data) {
      return that.afterAuth(data.token, data.user);
    }).then(null, function (err) {
      that.setData({ loading: false });
      wx.showToast({ title: err && err.message ? err.message : '登录失败', icon: 'none' });
    });
  },

  doRegister: function () {
    if (this.data.loading || !this.data.configured) {
      if (!this.data.configured) {
        wx.showToast({ title: '请先配置同步服务器', icon: 'none' });
      }
      return;
    }
    var form = this.valid();
    if (!form) {
      return;
    }
    var that = this;
    this.setData({ loading: true });
    api.register(form.username, form.password).then(function (data) {
      return that.afterAuth(data.token, data.user);
    }).then(null, function (err) {
      that.setData({ loading: false });
      wx.showToast({ title: err && err.message ? err.message : '注册失败', icon: 'none' });
    });
  },

  /** 登录成功：切换数据命名空间，并询问是否并入本机离线数据 */
  afterAuth: function (token, user) {
    var that = this;
    app.applyUser(token, user);
    var hasLocal = store.hasLegacyData() || store.hasOfflineData();
    if (!hasLocal) {
      wx.reLaunch({ url: '/pages/resource/index' });
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      wx.showModal({
        title: '发现本机离线数据',
        content: '是否把本机已有的抽卡记录和资源并入当前账号？并入后会随账号同步到其他设备。',
        confirmText: '并入账号',
        cancelText: '暂不处理',
        success: function (res) {
          if (res.confirm) {
            var count = store.migrateLegacy();
            count += store.migrateOfflineData();
            wx.showToast({ title: '已并入 ' + count + ' 条记录', icon: 'none' });
          }
          resolve();
        }
      });
    }).then(function () {
      that.setData({ loading: false });
      wx.reLaunch({ url: '/pages/resource/index' });
    });
  },

  useOffline: function () {
    app.useOffline();
    wx.reLaunch({ url: '/pages/resource/index' });
  },

  continueCurrent: function () {
    wx.reLaunch({ url: '/pages/resource/index' });
  },

  logout: function () {
    var that = this;
    wx.showModal({
      title: '退出登录',
      content: '本机数据仍保留在该账号目录下，重新登录后可继续使用。',
      success: function (res) {
        if (!res.confirm) {
          return;
        }
        api.clearAuth();
        store.setUser(null);
        app.globalData.user = null;
        wx.removeStorageSync('sg_offline');
        that.setData({ user: null, loading: false });
        wx.showToast({ title: '已退出登录', icon: 'none' });
      }
    });
  }
});
