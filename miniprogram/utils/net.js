/**
 * 联网兜底：小程序 wx.request 只能访问已配置的 request 合法域名。
 * 当请求被域名白名单拦截（未配置或后台配置尚未生效）时，改走云函数 fetchLink 代理，
 * 云函数不受该限制。未开通云开发 / 未部署 fetchLink 时保持原来的报错。
 */

var PROXY_FUNCTION = 'fetchLink';

/** errMsg 里出现这些字样说明是合法域名拦截，而不是断网 */
function isDomainError(message) {
  var text = String(message || '');
  return text.indexOf('domain list') >= 0
    || text.indexOf('合法域名') >= 0
    || text.indexOf('url not in domain') >= 0;
}

/** 通过云函数 fetchLink 代下载 JSON；返回解析后的对象 */
function proxyJson(url) {
  return new Promise(function (resolve, reject) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      reject(new Error('当前环境不支持云开发'));
      return;
    }
    wx.cloud.callFunction({
      name: PROXY_FUNCTION,
      data: { url: url },
      success: function (res) {
        var result = res && res.result;
        if (!result || !result.ok) {
          reject(new Error((result && result.error) || '云函数下载失败'));
          return;
        }
        var text = result.text;
        if (typeof text !== 'string' || !text) {
          reject(new Error('云函数返回内容为空'));
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch (e) {
          reject(new Error('云函数返回内容不是 JSON'));
        }
      },
      fail: function (err) {
        reject(new Error((err && err.errMsg) || '云函数调用失败'));
      }
    });
  });
}

module.exports = {
  isDomainError: isDomainError,
  proxyJson: proxyJson
};
