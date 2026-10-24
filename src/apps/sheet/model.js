// 工作簿数据结构
// workbook: { version, sheets: [Sheet], active, zoom }
// Sheet: { id, name, tabColor, cells: { 'r,c': Cell }, rows, cols, colW: {c:px}, rowH: {r:px}, hiddenRows: {r:1}, hiddenCols: {c:1},
//          merges: [{r1,c1,r2,c2}], freeze: {r,c}, cf: [Rule], dv: [Validation], objects: [Chart|Image], filter: null|{...},
//          showGrid, showHeaders }
// Cell: { v, f, s: Style, cm: 批注, link: 超链接, forceText }
// Style: { ff, fs, b, i, u, st, fc, bg, ha, va, wrap, nf, bd: { t, b, l, r: { w, c } } }
import { key } from './refs.js';

export const DEFAULT_COL_W = 80;
export const DEFAULT_ROW_H = 24;
export const DEFAULT_FONT = 'Microsoft YaHei';
export const DEFAULT_FS = 11;

let seq = 0;
export const oid = () => 'o' + Date.now().toString(36) + (seq++).toString(36);

export function newSheet(name = 'Sheet1') {
  return {
    id: oid(), name, tabColor: null, cells: {}, rows: 200, cols: 26, colW: {}, rowH: {}, hiddenRows: {}, hiddenCols: {},
    merges: [], freeze: { r: 0, c: 0 }, cf: [], dv: [], objects: [], filter: null, showGrid: true, showHeaders: true,
  };
}

export function newWorkbook() {
  return { version: 1, sheets: [newSheet('Sheet1')], active: 0, zoom: 100 };
}

/** 修复/补全旧数据字段 */
export function normalizeWorkbook(wb) {
  if (!wb || !Array.isArray(wb.sheets) || !wb.sheets.length) return newWorkbook();
  wb.sheets = wb.sheets.map((s) => Object.assign(newSheet(s.name), s));
  wb.active = Math.min(wb.active || 0, wb.sheets.length - 1);
  wb.zoom = wb.zoom || 100;
  return wb;
}

/** 便捷构造：在 sheet 中按二维数组写入数据（字符串以 = 开头视为公式） */
export function fillRows(sheet, r0, c0, rows, style) {
  rows.forEach((row, i) =>
    row.forEach((v, j) => {
      if (v == null || v === '') return;
      const cell = {};
      if (typeof v === 'string' && v[0] === '=') cell.f = v.slice(1);
      else cell.v = v;
      if (style) cell.s = { ...style };
      sheet.cells[key(r0 + i, c0 + j)] = cell;
    })
  );
}

export function styleRange(sheet, r1, c1, r2, c2, style) {
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) {
      const k = key(r, c);
      const cell = sheet.cells[k] || (sheet.cells[k] = {});
      cell.s = { ...(cell.s || {}), ...style };
      if (style.bd) cell.s.bd = { ...(cell.s.bd || {}), ...style.bd };
    }
}

export function borderAll(sheet, r1, c1, r2, c2, color = '#bfbfbf', w = 1) {
  const side = { w, c: color };
  styleRange(sheet, r1, c1, r2, c2, { bd: { t: side, b: side, l: side, r: side } });
}
