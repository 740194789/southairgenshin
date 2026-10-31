/**
 * 云函数 fetchLink：代小程序下载公网 JSON / 文本。
 * 小程序 wx.request 只能访问已配置的合法域名，云函数不受该限制，
 * 因此「链接导入」由本函数拉取链接内容并原样返回文本。
 */

var https = require('https');
var http = require('http');

var MAX_BYTES = 5 * 1024 * 1024;
var TIMEOUT_MS = 12000;
var MAX_REDIRECT = 3;

function fetchText(url, redirectCount) {
  return new Promise(function (resolve, reject) {
    var target;
    try {
      target = new URL(url);
    } catch (e) {
      reject(new Error('链接格式不正确'));
      return;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      reject(new Error('只支持 http / https 链接'));
      return;
    }

    var lib = target.protocol === 'https:' ? https : http;
    var req = lib.get(target, {
      headers: {
        'User-Agent': 'SouthAirGenshin/1.1',
        Accept: 'application/json,text/plain,*/*'
      }
    }, function (res) {
      var status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if ((redirectCount || 0) >= MAX_REDIRECT) {
          reject(new Error('链接跳转次数过多'));
          return;
        }
        var next = new URL(res.headers.location, target).toString();
        fetchText(next, (redirectCount || 0) + 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error('下载失败（HTTP ' + status + '）'));
        return;
      }

      var type = String(res.headers['content-type'] || '');
      if (type && !/json|text|octet-stream|plain/.test(type)) {
        res.resume();
        reject(new Error('链接不是文本或 JSON 文件'));
        return;
      }

      var size = 0;
      var chunks = [];
      res.on('data', function (chunk) {
        size += chunk.length;
        if (size > MAX_BYTES) {
          req.destroy();
          reject(new Error('文件超过 5MB，无法导入'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', function () {
        resolve({
          text: Buffer.concat(chunks).toString('utf8'),
          contentType: type,
          size: size
        });
      });
      res.on('error', reject);
    });

    req.setTimeout(TIMEOUT_MS, function () {
      req.destroy(new Error('下载超时，请检查链接是否可访问'));
    });
    req.on('error', reject);
  });
}

exports.main = async function (event) {
  var url = String((event && event.url) || '').trim();
  if (!url) {
    return { ok: false, error: '请填写链接' };
  }
  try {
    var data = await fetchText(url, 0);
    return {
      ok: true,
      text: data.text,
      contentType: data.contentType,
      size: data.size
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || '下载失败' };
  }
};
