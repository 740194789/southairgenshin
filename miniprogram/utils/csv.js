/* 抽卡记录 CSV 读写（带 BOM，便于 Excel / WPS 直接编辑），移植自后端 WishCsv.java */

var BOM = '\uFEFF';
var HEADERS = ['抽卡时间', '物品名称', '星级', '类型', '卡池', '是否UP', '保底计数', '备注', '捕获明光'];

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function normalizeTime(value) {
  if (!value) {
    return null;
  }
  var text = String(value).trim().replace(/\//g, '-').replace('T', ' ');
  var m = text.match(/^(\d{4})-(\d{2})-(\d{2})[ ]?(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) {
    return null;
  }
  return m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + (m[6] || '00');
}

function formatTime(date) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}

function escapeCell(value) {
  var text = value === null || value === undefined ? '' : String(value);
  if (text.indexOf(',') < 0 && text.indexOf('"') < 0 && text.indexOf('\n') < 0 && text.indexOf('\r') < 0) {
    return text;
  }
  return '"' + text.replace(/"/g, '""') + '"';
}

function write(records) {
  var lines = [HEADERS.join(',')];
  (records || []).forEach(function (record) {
    lines.push([
      record.wishTime || '',
      record.itemName || '',
      record.rarity === null || record.rarity === undefined ? '' : record.rarity,
      record.itemType || '',
      record.pool || '',
      record.isUp ? 'UP' : '否',
      record.pityCount === null || record.pityCount === undefined ? '' : record.pityCount,
      record.note || '',
      record.captureTriggered ? '是' : '否'
    ].map(escapeCell).join(','));
  });
  return BOM + lines.join('\r\n') + '\r\n';
}

/** 导入模板：表头 + 一条三星示例行（三星不记录，示例行导入时会被忽略）。 */
function template() {
  var sample = [{
    wishTime: '2026-01-01 12:00:00',
    itemName: '示例物品',
    rarity: 3,
    itemType: '武器',
    pool: '常驻',
    isUp: false,
    pityCount: 1,
    note: '示例行可删除，导入时会被忽略',
    captureTriggered: false
  }];
  return write(sample);
}

/** 导入模板的 JSON 版本：一条三星示例记录。 */
function templateJson() {
  return JSON.stringify([{
    wishTime: '2026-01-01 12:00:00',
    itemName: '示例物品',
    rarity: 3,
    itemType: '武器',
    pool: '常驻',
    isUp: false,
    pityCount: 1,
    note: '示例行可删除，导入时会被忽略'
  }], null, 2);
}

function readRows(text) {
  var rows = [];
  var row = [];
  var cell = '';
  var quoted = false;

  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (i + 1 < text.length && text.charAt(i + 1) === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function normalizeHeader(value) {
  var header = String(value === null || value === undefined ? '' : value).trim().toLowerCase().replace(/\s/g, '');
  if (header === '抽卡时间' || header === '时间' || header === 'wishtime' || header === 'time') {
    return 'time';
  }
  if (header === '物品名称' || header === '名称' || header === '抽到的物品' || header === 'itemname' || header === 'name') {
    return 'name';
  }
  if (header === '星级' || header === 'rarity') {
    return 'rarity';
  }
  if (header === '类型' || header === 'itemtype' || header === 'type') {
    return 'type';
  }
  if (header === '卡池' || header === 'pool') {
    return 'pool';
  }
  if (header === '是否up' || header === 'up' || header === 'isup') {
    return 'isup';
  }
  if (header === '保底计数' || header === '保底' || header === 'pity' || header === 'pitycount') {
    return 'pity';
  }
  if (header === '备注' || header === 'note' || header === 'remark') {
    return 'note';
  }
  if (header === '捕获明光' || header === 'capture' || header === 'capturetriggered' || header === 'captured') {
    return 'capture';
  }
  return header;
}

function cell(row, index, key) {
  var at = index[key];
  if (at === undefined || at >= row.length) {
    return null;
  }
  var value = row[at];
  if (value === null || value === undefined) {
    return null;
  }
  value = String(value).trim();
  return value === '' ? null : value;
}

function isBlankRow(row) {
  for (var i = 0; i < row.length; i++) {
    if (row[i] !== null && row[i] !== undefined && String(row[i]).trim() !== '') {
      return false;
    }
  }
  return true;
}

function parseIntValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  var text = String(value).trim();
  if (text === '') {
    return null;
  }
  if (text.indexOf('★') >= 0) {
    var stars = 0;
    for (var i = 0; i < text.length; i++) {
      if (text.charAt(i) === '★') {
        stars++;
      }
    }
    return stars > 0 ? stars : null;
  }
  var n = parseInt(text, 10);
  return isNaN(n) ? null : n;
}

function parseBoolean(value) {
  if (value === null || value === undefined) {
    return null;
  }
  var text = String(value).trim().toLowerCase();
  if (text === '') {
    return null;
  }
  return text === 'true' || text === '1' || text === '是'
    || text === 'up' || text === 'up内' || text === 'y';
}

function parse(text) {
  if (!text) {
    return [];
  }
  var raw = String(text);
  if (raw.charAt(0) === BOM) {
    raw = raw.substring(1);
  }
  var rows = readRows(raw);
  if (!rows.length) {
    return [];
  }

  var index = {};
  rows[0].forEach(function (header, i) {
    index[normalizeHeader(header)] = i;
  });

  var records = [];
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (isBlankRow(row)) {
      continue;
    }
    records.push({
      wishTime: normalizeTime(cell(row, index, 'time')),
      itemName: cell(row, index, 'name'),
      rarity: parseIntValue(cell(row, index, 'rarity')),
      itemType: cell(row, index, 'type'),
      pool: cell(row, index, 'pool'),
      isUp: parseBoolean(cell(row, index, 'isup')),
      pityCount: parseIntValue(cell(row, index, 'pity')),
      note: cell(row, index, 'note'),
      captureTriggered: parseBoolean(cell(row, index, 'capture')) === true
    });
  }
  return records;
}

module.exports = {
  write: write,
  parse: parse,
  template: template,
  templateJson: templateJson,
  formatTime: formatTime,
  normalizeTime: normalizeTime
};
