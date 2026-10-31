/* 账号资源 CSV 读写，与网页端 /api/resources 的格式保持一致 */

var BOM = '\uFEFF';
var HEADERS = ['原石/星琼', '摩拉/信用点', '纠缠之缘/星轨专票', '相遇之缘/星轨通票'];

function header() {
  return BOM + HEADERS.join(',') + '\r\n';
}

function write(res) {
  var source = res || {};
  var row = [
    source.primogems === undefined || source.primogems === null ? '' : source.primogems,
    source.mora === undefined || source.mora === null ? '' : source.mora,
    source.intertwinedFates === undefined || source.intertwinedFates === null ? '' : source.intertwinedFates,
    source.acquaintedFates === undefined || source.acquaintedFates === null ? '' : source.acquaintedFates
  ];
  return header() + row.join(',') + '\r\n';
}

/**
 * 解析资源 CSV：只读取第一行数据，空单元格返回 null（表示保持原值）。
 */
function parse(text) {
  var result = {
    primogems: null,
    mora: null,
    intertwinedFates: null,
    acquaintedFates: null
  };
  if (!text) {
    return result;
  }
  var raw = String(text);
  if (raw.charAt(0) === BOM) {
    raw = raw.substring(1);
  }
  var lines = raw.split(/\r?\n/).filter(function (line) {
    return line.trim() !== '';
  });
  if (!lines.length) {
    return result;
  }

  var headerCells = lines[0].split(',');
  var index = { primogems: -1, mora: -1, intertwinedFates: -1, acquaintedFates: -1 };
  headerCells.forEach(function (cell, i) {
    var name = String(cell).trim().toLowerCase();
    if (index.primogems < 0 && (name.indexOf('原石') >= 0 || name.indexOf('星琼') >= 0 || name.indexOf('primogems') >= 0)) {
      index.primogems = i;
    } else if (index.mora < 0 && (name.indexOf('摩拉') >= 0 || name.indexOf('信用点') >= 0 || name.indexOf('mora') >= 0)) {
      index.mora = i;
    } else if (index.intertwinedFates < 0
        && (name.indexOf('纠缠') >= 0 || name.indexOf('专票') >= 0 || name.indexOf('intertwined') >= 0)) {
      index.intertwinedFates = i;
    } else if (index.acquaintedFates < 0
        && (name.indexOf('相遇') >= 0 || name.indexOf('通票') >= 0 || name.indexOf('acquainted') >= 0)) {
      index.acquaintedFates = i;
    }
  });

  var mapped = index.primogems >= 0 || index.mora >= 0
    || index.intertwinedFates >= 0 || index.acquaintedFates >= 0;
  var dataLine = 0;
  if (mapped) {
    if (lines.length < 2) {
      return result;
    }
    dataLine = 1;
  } else {
    // 手机粘贴时可以不写表头：按「原石, 摩拉, 纠缠, 相遇」顺序解析。
    index = { primogems: 0, mora: 1, intertwinedFates: 2, acquaintedFates: 3 };
  }
  var row = lines[dataLine].split(',');
  ['primogems', 'mora', 'intertwinedFates', 'acquaintedFates'].forEach(function (key) {
    var at = index[key];
    if (at < 0 || at >= row.length) {
      return;
    }
    var value = String(row[at]).replace(/,/g, '').replace(/，/g, '').trim();
    if (value === '' || value === '-') {
      return;
    }
    var n = parseInt(value, 10);
    if (!isNaN(n) && n >= 0) {
      result[key] = n;
    }
  });
  return result;
}

module.exports = {
  write: write,
  parse: parse
};
