/* 同步服务配置：部署后端后，把 BASE_URL 换成自己的已备案 HTTPS 域名 */

var BASE_URL = 'https://api.southair.example.com';

/* 占位域名视为未配置，避免小程序一启动就发起无效请求 */
function isConfigured() {
  return !!BASE_URL && BASE_URL.indexOf('example.com') < 0;
}

module.exports = {
  BASE_URL: BASE_URL,
  isConfigured: isConfigured
};
