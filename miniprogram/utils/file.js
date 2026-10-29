/* 文件导入导出：生成文件后调用微信「发送给朋友」，导入从聊天文件选择 */

function writeFile(fileName, content) {
  var fs = wx.getFileSystemManager();
  var path = wx.env.USER_DATA_PATH + '/' + fileName;
  fs.writeFileSync(path, content, 'utf8');
  return path;
}

function fallbackOpen(path) {
  wx.openDocument({
    filePath: path,
    showMenu: true,
    fail: function () {
      wx.showModal({
        title: '文件已生成',
        content: '当前环境无法直接分享文件，路径：' + path,
        showCancel: false
      });
    }
  });
}

function exportFile(fileName, content) {
  var path;
  try {
    path = writeFile(fileName, content);
  } catch (e) {
    wx.showToast({ title: '生成文件失败', icon: 'none' });
    return;
  }
  if (typeof wx.shareFileMessage === 'function') {
    wx.shareFileMessage({
      filePath: path,
      fileName: fileName,
      fail: function () {
        fallbackOpen(path);
      }
    });
  } else {
    fallbackOpen(path);
  }
}

function chooseFile(extensions) {
  return new Promise(function (resolve, reject) {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: extensions,
      success: function (res) {
        var file = res.tempFiles && res.tempFiles[0];
        if (!file) {
          reject(new Error('未选择文件'));
          return;
        }
        wx.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: function (read) {
            resolve({ name: file.name, content: read.data });
          },
          fail: function () {
            reject(new Error('读取文件失败'));
          }
        });
      },
      fail: function () {
        reject(new Error('未选择文件'));
      }
    });
  });
}

module.exports = {
  exportFile: exportFile,
  chooseFile: chooseFile
};
