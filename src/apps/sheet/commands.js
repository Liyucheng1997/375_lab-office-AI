// 表格命令：格式、结构（插入/删除）、填充、剪贴板、排序筛选、工作表操作等
import { h, icon, toast, confirmBox, promptBox, formBox, alertBox, printHTML, colorPicker } from '../../core/ui.js';
import { key, unkey, addr, rangeStr, colName, norm, inRange, intersects, MAX_ROWS, MAX_COLS } from './refs.js';
import { formatValue, adjustDecimals, toggleThousands, isDateFormat, serialToDate, dateToSerial, todaySerial, nowSerial, valueToEditText, isErr } from './format.js';
import { shiftFormula, adjustFormula, renameSheetInFormula, compareValues, parse, evaluate } from './formula.js';
import { newSheet, oid, DEFAULT_COL_W, DEFAULT_ROW_H } from './model.js';
import { makeCriteria } from './functions.js';
import * as dlg from './dialogs.js';
import { sheetToHTML } from './io.js';

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

/* ================= 样式 ================= */

export function setStyle(ed, patch, label = '设置格式') {
  ed.change(label, () => {
    ed.forEachSelected((r, c) => {
      const m = ed.mergeAt(r, c);
      if (m && (m.r1 !== r || m.c1 !== c) && !('bd' in patch)) return;
      const cell = ed.ensureCell(r, c);
      const s = (cell.s = cell.s || {});
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === false) delete s[k];
        else s[k] = v;
      }
      ed.cleanCell(r, c);
    });
  });
}

export function toggleStyle(ed, prop) {
  const cell = ed.cellAt(ed.sel.active.r, ed.sel.active.c);
  const on = !(cell && cell.s && cell.s[prop]);
  setStyle(ed, { [prop]: on || null });
}

export function fontSizeStep(ed, dir) {
  const cell = ed.cellAt(ed.sel.active.r, ed.sel.active.c);
  const cur = (cell && cell.s && cell.s.fs) || 11;
  const steps = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
  let next = dir > 0 ? steps.find((s) => s > cur) || cur + 4 : [...steps].reverse().find((s) => s < cur) || Math.max(1, cur - 1);
  setStyle(ed, { fs: next });
}

export function setNumberFormat(ed, nf) {
  setStyle(ed, { nf: nf === 'General' ? null : nf }, '数字格式');
}
export function changeDecimals(ed, delta) {
  const { r, c } = ed.sel.active;
  const cell = ed.cellAt(r, c);
  const nf = adjustDecimals(cell && cell.s && cell.s.nf, delta, ed.engine.display(ed.si, r, c));
  setStyle(ed, { nf }, '小数位数');
}
export function thousands(ed) {
  const cell = ed.cellAt(ed.sel.active.r, ed.sel.active.c);
  setStyle(ed, { nf: toggleThousands(cell && cell.s && cell.s.nf) }, '千位分隔');
}

/** 边框：kind = all | outer | thickOuter | none | top | bottom | left | right | inner | doubleBottom | thickBottom */
export function setBorder(ed, kind, line = ed.borderLine || { w: 1, c: '#000000' }) {
  ed.change('边框', () => {
    for (const rg0 of ed.sel.ranges) {
      const rg = ed.usedPartForStyle(rg0);
      const side = (r, c, sideName, val) => {
        const cell = ed.ensureCell(r, c);
        cell.s = cell.s || {};
        const bd = (cell.s.bd = { ...(cell.s.bd || {}) });
        if (val) bd[sideName] = { ...val };
        else delete bd[sideName];
        if (!Object.keys(bd).length) delete cell.s.bd;
        ed.cleanCell(r, c);
      };
      const L = line;
      const thick = { ...line, w: 2 };
      for (let r = rg.r1; r <= rg.r2; r++)
        for (let c = rg.c1; c <= rg.c2; c++) {
          const top = r === rg.r1, bottom = r === rg.r2, left = c === rg.c1, right = c === rg.c2;
          switch (kind) {
            case 'all': side(r, c, 't', L); side(r, c, 'b', L); side(r, c, 'l', L); side(r, c, 'r', L); break;
            case 'none':
              side(r, c, 't', null); side(r, c, 'b', null); side(r, c, 'l', null); side(r, c, 'r', null);
              if (top && r > 0 && ed.cellAt(r - 1, c)) side(r - 1, c, 'b', null);
              if (left && c > 0 && ed.cellAt(r, c - 1)) side(r, c - 1, 'r', null);
              if (bottom && ed.cellAt(r + 1, c)) side(r + 1, c, 't', null);
              if (right && ed.cellAt(r, c + 1)) side(r, c + 1, 'l', null);
              break;
            case 'outer': case 'thickOuter': {
              const v = kind === 'thickOuter' ? thick : L;
              if (top) side(r, c, 't', v); if (bottom) side(r, c, 'b', v); if (left) side(r, c, 'l', v); if (right) side(r, c, 'r', v);
              break;
            }
            case 'inner':
              if (!bottom) side(r, c, 'b', L); if (!right) side(r, c, 'r', L);
              break;
            case 'top': if (top) side(r, c, 't', L); break;
            case 'bottom': if (bottom) side(r, c, 'b', L); break;
            case 'left': if (left) side(r, c, 'l', L); break;
            case 'right': if (right) side(r, c, 'r', L); break;
            case 'thickBottom': if (bottom) side(r, c, 'b', thick); break;
            case 'doubleBottom': if (bottom) side(r, c, 'b', { ...line, w: 3 }); break;
            case 'topBottom': if (top) side(r, c, 't', L); if (bottom) side(r, c, 'b', L); break;
          }
        }
    }
  });
}

/** 合并：center | merge | across | unmerge */
export async function merge(ed, kind = 'center') {
  const s = ed.sheet;
  const ranges = ed.sel.ranges.map((rg) => ed.usedPartForStyle(rg));
  if (kind === 'unmerge' || (kind === 'center' && ed.mergeAt(ed.sel.active.r, ed.sel.active.c) && ranges.length === 1 && s.merges.some((m) => m.r1 === ranges[0].r1 && m.c1 === ranges[0].c1 && m.r2 === ranges[0].r2 && m.c2 === ranges[0].c2))) {
    ed.change('取消合并', () => {
      s.merges = s.merges.filter((m) => !ranges.some((rg) => intersects(m, rg)));
    });
    return;
  }
  const targets = [];
  for (const rg of ranges) {
    if (kind === 'across') for (let r = rg.r1; r <= rg.r2; r++) targets.push({ r1: r, c1: rg.c1, r2: r, c2: rg.c2 });
    else targets.push(rg);
  }
  const valid = targets.filter((t) => t.r1 !== t.r2 || t.c1 !== t.c2);
  if (!valid.length) return;
  // 多个值时提醒
  let multi = false;
  for (const t of valid) {
    let n = 0;
    for (let r = t.r1; r <= t.r2; r++) for (let c = t.c1; c <= t.c2; c++) if (ed.cellAt(r, c)?.v != null || ed.cellAt(r, c)?.f != null) n++;
    if (n > 1) multi = true;
  }
  if (multi && !(await confirmBox('选定区域包含多个数值。合并到一个单元格后只能保留最左上角的数据。', '合并单元格'))) return;
  ed.change('合并单元格', () => {
    s.merges = s.merges.filter((m) => !valid.some((t) => intersects(m, t)));
    for (const t of valid) {
      for (let r = t.r1; r <= t.r2; r++) for (let c = t.c1; c <= t.c2; c++) {
        if (r === t.r1 && c === t.c1) continue;
        const cell = ed.cellAt(r, c);
        if (cell) { delete cell.v; delete cell.f; ed.cleanCell(r, c); }
      }
      s.merges.push({ ...t });
      if (kind === 'center') { const cell = ed.ensureCell(t.r1, t.c1); cell.s = { ...(cell.s || {}), ha: 'center', va: 'middle' }; }
    }
  });
}

/* ================= 格式刷 ================= */
export function startPainter(ed, sticky = false) {
  const rg = ed.range;
  const styles = [];
  for (let r = rg.r1; r <= Math.min(rg.r2, rg.r1 + 200); r++) {
    const row = [];
    for (let c = rg.c1; c <= Math.min(rg.c2, rg.c1 + 100); c++) row.push(clone(ed.cellAt(r, c)?.s) || null);
    styles.push(row);
  }
  ed.painter = { styles, sticky, src: { ...rg } };
  ed.updateUI();
  toast(sticky ? '格式刷已锁定，按 Esc 退出' : '请选择要应用格式的单元格');
}
export function applyPainter(ed) {
  const p = ed.painter;
  if (!p) return;
  const rg = ed.range;
  ed.change('格式刷', () => {
    const H = p.styles.length, W = p.styles[0].length;
    const ur = ed.usedPartForStyle(rg);
    for (let r = ur.r1; r <= ur.r2; r++) for (let c = ur.c1; c <= ur.c2; c++) {
      const st = p.styles[(r - rg.r1) % H][(c - rg.c1) % W];
      const cell = ed.ensureCell(r, c);
      if (st) cell.s = clone(st); else delete cell.s;
      ed.cleanCell(r, c);
    }
    // 复制合并
    const src = p.src;
    if (src.r2 - src.r1 + 1 === H && src.c2 - src.c1 + 1 === W) {
      const ms = ed.sheet.merges.filter((m) => m.r1 >= src.r1 && m.r2 <= src.r2 && m.c1 >= src.c1 && m.c2 <= src.c2);
      if (ms.length) {
        ed.sheet.merges = ed.sheet.merges.filter((m) => !intersects(m, rg));
        for (const m of ms) ed.sheet.merges.push({ r1: rg.r1 + m.r1 - src.r1, c1: rg.c1 + m.c1 - src.c1, r2: rg.r1 + m.r2 - src.r1, c2: rg.c1 + m.c2 - src.c1 });
      }
    }
  });
  if (!p.sticky) ed.painter = null;
  ed.updateUI();
}

/* ================= 清除 ================= */
export function clear(ed, what = 'contents') {
  ed.change('清除', () => {
    ed.forEachSelected((r, c) => {
      const cell = ed.cellAt(r, c);
      if (!cell) return;
      if (what === 'all') { delete ed.sheet.cells[key(r, c)]; return; }
      if (what === 'contents') { delete cell.v; delete cell.f; delete cell.forceText; }
      if (what === 'formats') delete cell.s;
      if (what === 'comments') delete cell.cm;
      if (what === 'links') delete cell.link;
      ed.cleanCell(r, c);
    });
    if (what === 'all' || what === 'formats') {
      const s = ed.sheet;
      s.merges = s.merges.filter((m) => !ed.sel.ranges.some((rg) => m.r1 >= rg.r1 && m.r2 <= rg.r2 && m.c1 >= rg.c1 && m.c2 <= rg.c2));
    }
  });
}

/* ================= 插入 / 删除 行列 ================= */

function adjustRange(rg, axis, at, n) {
  const k1 = axis === 'r' ? 'r1' : 'c1', k2 = axis === 'r' ? 'r2' : 'c2';
  const out = { ...rg };
  if (n > 0) {
    if (out[k1] >= at) out[k1] += n;
    if (out[k2] >= at) out[k2] += n;
    return out;
  }
  const del = -n, end = at + del - 1;
  if (out[k1] >= at && out[k2] <= end) return null;
  const f = (x, lo) => (x < at ? x : x > end ? x - del : lo ? at : at - 1);
  out[k1] = f(out[k1], true);
  out[k2] = f(out[k2], false);
  return out[k2] < out[k1] ? null : out;
}
function shiftMap(map, at, n) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) {
    const i = +k;
    if (i < at) out[i] = v;
    else if (n > 0) out[i + n] = v;
    else if (i >= at - n) out[i + n] = v;
  }
  return out;
}

/** axis: 'r'|'c'；n>0 插入，n<0 删除 */
export function shiftStructure(ed, axis, at, n) {
  const wb = ed.wb, s = ed.sheet, name = s.name;
  const cells = {};
  for (const [k, cell] of Object.entries(s.cells)) {
    let [r, c] = unkey(k);
    const i = axis === 'r' ? r : c;
    if (n < 0 && i >= at && i < at - n) continue;
    if (i >= at) { if (axis === 'r') r += n; else c += n; }
    cells[key(r, c)] = cell;
  }
  s.cells = cells;
  // 所有工作表中的公式
  for (const sh of wb.sheets) {
    for (const cell of Object.values(sh.cells)) if (cell.f != null) cell.f = adjustFormula(cell.f, sh.name, name, axis, at, n);
    for (const rule of sh.cf || []) if (rule.f) rule.f = adjustFormula(rule.f.replace(/^=/, ''), sh.name, name, axis, at, n);
  }
  if (axis === 'r') {
    s.rowH = shiftMap(s.rowH, at, n);
    s.hiddenRows = shiftMap(s.hiddenRows, at, n);
    s.filterHidden = shiftMap(s.filterHidden, at, n);
    s.rows = Math.max(1, Math.min(MAX_ROWS, s.rows + n));
  } else {
    s.colW = shiftMap(s.colW, at, n);
    s.hiddenCols = shiftMap(s.hiddenCols, at, n);
    s.cols = Math.max(1, Math.min(MAX_COLS, s.cols + n));
    if (s.filter && s.filter.conds) {
      const nc = {};
      for (const [k, v] of Object.entries(s.filter.conds)) { const c = +k; if (c < at) nc[c] = v; else if (n > 0 || c >= at - n) nc[c + n] = v; }
      s.filter.conds = nc;
    }
  }
  s.merges = s.merges.map((m) => adjustRange(m, axis, at, n)).filter((m) => m && (m.r1 !== m.r2 || m.c1 !== m.c2));
  s.cf = (s.cf || []).map((rule) => { const rg = adjustRange(rule.range, axis, at, n); return rg ? { ...rule, range: rg } : null; }).filter(Boolean);
  s.dv = (s.dv || []).map((d) => { const rg = adjustRange(d.range, axis, at, n); return rg ? { ...d, range: rg } : null; }).filter(Boolean);
  if (s.filter) { const rg = adjustRange(s.filter, axis, at, n); s.filter = rg ? { ...s.filter, ...rg } : null; if (!s.filter) s.filterHidden = {}; }
  for (const o of s.objects || []) if (o.src) { const rg = adjustRange(o.src, axis, at, n); if (rg) o.src = rg; }
}

export function insertRows(ed, where = 'above', count) {
  const rg = ed.range;
  const n = count || rg.r2 - rg.r1 + 1;
  const at = where === 'above' ? rg.r1 : rg.r2 + 1;
  ed.change('插入行', () => shiftStructure(ed, 'r', at, n), 'book');
  ed.selectRange({ r1: at, c1: rg.c1, r2: at + n - 1, c2: rg.c2 });
}
export function insertCols(ed, where = 'left', count) {
  const rg = ed.range;
  const n = count || rg.c2 - rg.c1 + 1;
  const at = where === 'left' ? rg.c1 : rg.c2 + 1;
  ed.change('插入列', () => shiftStructure(ed, 'c', at, n), 'book');
  ed.selectRange({ r1: rg.r1, c1: at, r2: rg.r2, c2: at + n - 1 });
}
export function deleteRows(ed) {
  const rg = ed.range;
  ed.change('删除行', () => shiftStructure(ed, 'r', rg.r1, -(rg.r2 - rg.r1 + 1)), 'book');
  ed.select(Math.min(rg.r1, ed.sheet.rows - 1), ed.sel.active.c);
}
export function deleteCols(ed) {
  const rg = ed.range;
  ed.change('删除列', () => shiftStructure(ed, 'c', rg.c1, -(rg.c2 - rg.c1 + 1)), 'book');
  ed.select(ed.sel.active.r, Math.min(rg.c1, ed.sheet.cols - 1));
}

/** 插入/删除单元格（移动单元格，不调整公式引用） */
export function shiftCells(ed, mode) {
  const rg = ed.range;
  const s = ed.sheet;
  ed.change('移动单元格', () => {
    const cells = {};
    const h0 = rg.r2 - rg.r1 + 1, w0 = rg.c2 - rg.c1 + 1;
    for (const [k, cell] of Object.entries(s.cells)) {
      let [r, c] = unkey(k);
      const inCols = c >= rg.c1 && c <= rg.c2, inRows = r >= rg.r1 && r <= rg.r2;
      if (mode === 'down' && inCols && r >= rg.r1) r += h0;
      else if (mode === 'right' && inRows && c >= rg.c1) c += w0;
      else if (mode === 'up' && inCols && r >= rg.r1) { if (r <= rg.r2) continue; r -= h0; }
      else if (mode === 'left' && inRows && c >= rg.c1) { if (c <= rg.c2) continue; c -= w0; }
      cells[key(r, c)] = cell;
    }
    s.cells = cells;
  });
}

export function hideRowsCols(ed, axis, hide) {
  const s = ed.sheet;
  ed.change(hide ? '隐藏' : '取消隐藏', () => {
    for (const rg of ed.sel.ranges) {
      if (axis === 'r') {
        const lo = hide ? rg.r1 : Math.max(0, rg.r1 - (rg.r1 === rg.r2 ? 1 : 0)), hi = hide ? rg.r2 : rg.r2 + (rg.r1 === rg.r2 ? 1 : 0);
        for (let r = lo; r <= Math.min(hi, s.rows); r++) { if (hide) s.hiddenRows[r] = 1; else { delete s.hiddenRows[r]; if (s.rowH[r] === 0) delete s.rowH[r]; } }
      } else {
        const lo = hide ? rg.c1 : Math.max(0, rg.c1 - (rg.c1 === rg.c2 ? 1 : 0)), hi = hide ? rg.c2 : rg.c2 + (rg.c1 === rg.c2 ? 1 : 0);
        for (let c = lo; c <= Math.min(hi, s.cols); c++) { if (hide) s.hiddenCols[c] = 1; else { delete s.hiddenCols[c]; if (s.colW[c] === 0) delete s.colW[c]; } }
      }
    }
  });
}

export async function setRowHeight(ed) {
  const cur = ed.grid.rowH(ed.sel.active.r) || DEFAULT_ROW_H;
  const v = await promptBox('行高', '行高（像素）', String(cur), { type: 'number' });
  if (v == null || v === '' || isNaN(v)) return;
  ed.change('行高', () => { for (const rg of ed.sel.ranges) for (let r = rg.r1; r <= Math.min(rg.r2, ed.sheet.rows - 1); r++) ed.sheet.rowH[r] = Math.max(0, +v); });
}
export async function setColWidth(ed) {
  const cur = ed.grid.colW(ed.sel.active.c) || DEFAULT_COL_W;
  const v = await promptBox('列宽', '列宽（像素）', String(cur), { type: 'number' });
  if (v == null || v === '' || isNaN(v)) return;
  ed.change('列宽', () => { for (const rg of ed.sel.ranges) for (let c = rg.c1; c <= Math.min(rg.c2, ed.sheet.cols - 1); c++) ed.sheet.colW[c] = Math.max(0, +v); });
}
export function autoFitCols(ed, cols) {
  if (!cols) { cols = []; for (const rg of ed.sel.ranges) for (let c = rg.c1; c <= Math.min(rg.c2, ed.engine.bounds[ed.si].maxC); c++) cols.push(c); }
  const b = ed.engine.bounds[ed.si];
  ed.change('自动调整列宽', () => {
    for (const c of cols) {
      let w = 0;
      for (let r = 0; r <= b.maxR; r++) { const m = ed.mergeAt(r, c); if (m && m.c1 !== m.c2) continue; w = Math.max(w, ed.grid.measureCell(r, c)); }
      if (w) ed.sheet.colW[c] = Math.min(600, Math.max(30, Math.ceil(w)));
      else delete ed.sheet.colW[c];
    }
  });
}
export function autoFitRows(ed, rows) {
  if (!rows) { rows = []; for (const rg of ed.sel.ranges) for (let r = rg.r1; r <= Math.min(rg.r2, ed.engine.bounds[ed.si].maxR); r++) rows.push(r); }
  ed.change('自动调整行高', () => {
    for (const r of rows) {
      let hgt = DEFAULT_ROW_H;
      for (const [k, cell] of Object.entries(ed.sheet.cells)) {
        const [rr, cc] = unkey(k);
        if (rr !== r || !cell.s) continue;
        const fs = (cell.s.fs || 11) * 4 / 3;
        let lines = 1;
        if (cell.s.wrap) {
          const v = ed.engine.display(ed.si, rr, cc);
          const text = formatValue(v, cell.s.nf).text;
          const ctx = ed.grid.ctx;
          ctx.font = `${cell.s.b ? 'bold ' : ''}${fs}px "${cell.s.ff || 'Microsoft YaHei'}"`;
          const save = ed.grid.z;
          lines = ed.grid.wrapLines(text, ed.grid.colW(cc) - 6).length;
        }
        hgt = Math.max(hgt, Math.ceil(fs * 1.3 * lines + 8));
      }
      if (hgt === DEFAULT_ROW_H) delete ed.sheet.rowH[r];
      else ed.sheet.rowH[r] = hgt;
    }
  });
}

/* ================= 剪贴板 ================= */

function toTSV(ed, rg) {
  const lines = [];
  for (let r = rg.r1; r <= rg.r2; r++) {
    if (!ed.grid.rowH(r)) continue;
    const row = [];
    for (let c = rg.c1; c <= rg.c2; c++) {
      const v = ed.engine.display(ed.si, r, c);
      let t = formatValue(v, ed.cellAt(r, c)?.s?.nf).text;
      if (/[\t\n"]/.test(t)) t = '"' + t.replace(/"/g, '""') + '"';
      row.push(t);
    }
    lines.push(row.join('\t'));
  }
  return lines.join('\r\n');
}
function parseTSV(text) {
  text = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const rows = [[]];
  let i = 0, cur = '', q = false;
  while (i < text.length) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i += 2; continue; } q = false; i++; continue; }
      cur += ch; i++; continue;
    }
    if (ch === '"' && cur === '') { q = true; i++; continue; }
    if (ch === '\t') { rows[rows.length - 1].push(cur); cur = ''; i++; continue; }
    if (ch === '\n') { rows[rows.length - 1].push(cur); cur = ''; rows.push([]); i++; continue; }
    cur += ch; i++;
  }
  rows[rows.length - 1].push(cur);
  return rows;
}

export function copy(ed, cut = false, clipboardData) {
  if (ed.sel.ranges.length > 1) { toast('不能对多重选定区域使用此命令', 'error'); return; }
  const rg0 = ed.range;
  const rg = ed.usedPart(rg0);
  const cells = [];
  for (let r = rg.r1; r <= rg.r2; r++) {
    const row = [];
    for (let c = rg.c1; c <= rg.c2; c++) row.push(clone(ed.cellAt(r, c)) || null);
    cells.push(row);
  }
  const text = toTSV(ed, rg);
  const html = sheetToHTML(ed, ed.si, rg, { inline: true });
  const merges = ed.sheet.merges.filter((m) => m.r1 >= rg.r1 && m.r2 <= rg.r2 && m.c1 >= rg.c1 && m.c2 <= rg.c2).map((m) => ({ ...m }));
  ed.clip = { si: ed.si, range: rg, cells, text, cut, marquee: true, merges };
  if (clipboardData) {
    clipboardData.setData('text/plain', text);
    clipboardData.setData('text/html', html);
  } else {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]).catch(() => navigator.clipboard.writeText(text).catch(() => {}));
      } else navigator.clipboard?.writeText(text).catch(() => {});
    } catch {}
  }
  ed.grid.invalidate();
}

export async function pasteFromSystem(ed, mode = 'all') {
  let text = null;
  try { text = await navigator.clipboard.readText(); } catch {}
  if (text == null && !ed.clip) { toast('无法读取剪贴板，请使用 Ctrl+V 粘贴', 'error'); return; }
  paste(ed, mode, text ?? ed.clip.text);
}

/** mode: all | values | formats | formulas | transpose | noborder */
export function paste(ed, mode = 'all', text, html) {
  const clip = ed.clip;
  const internal = clip && (text == null || normalizeNL(text) === normalizeNL(clip.text));
  const dest = ed.range;
  const r0 = dest.r1, c0 = dest.c1;
  if (internal) {
    const H = clip.cells.length, W = clip.cells[0].length;
    const tr = mode === 'transpose';
    const ph = tr ? W : H, pw = tr ? H : W;
    // 目标区域是源区域整数倍时平铺
    const dh = dest.r2 - dest.r1 + 1, dw = dest.c2 - dest.c1 + 1;
    const ty = dh % ph === 0 && dh > ph ? dh / ph : 1, tx = dw % pw === 0 && dw > pw ? dw / pw : 1;
    const srcSheet = ed.wb.sheets[clip.si];
    ed.change(clip.cut ? '剪切' : '粘贴', () => {
      if (clip.cut) {
        for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) delete srcSheet.cells[key(clip.range.r1 + i, clip.range.c1 + j)];
        if (clip.si === ed.si) ed.sheet.merges = ed.sheet.merges.filter((m) => !intersects(m, clip.range));
      }
      for (let ty0 = 0; ty0 < ty; ty0++) for (let tx0 = 0; tx0 < tx; tx0++) {
        for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) {
          const r = r0 + ty0 * ph + (tr ? j : i), c = c0 + tx0 * pw + (tr ? i : j);
          const src = clip.cells[i][j];
          const dr = r - (clip.range.r1 + i), dc = c - (clip.range.c1 + j);
          const k = key(r, c);
          const cur = ed.sheet.cells[k] || {};
          let next = { ...cur };
          if (mode === 'all' || mode === 'transpose' || mode === 'noborder') {
            next = clone(src) || {};
            if (next.f != null && !clip.cut) next.f = shiftFormula(next.f, dr, dc);
            if (mode === 'noborder' && next.s) delete next.s.bd;
          } else if (mode === 'values') {
            delete next.f; delete next.v;
            const v = ed.engine.display(clip.si, clip.range.r1 + i, clip.range.c1 + j);
            if (v != null && !isErr(v)) next.v = v;
            if (src && src.s && src.s.nf) next.s = { ...(next.s || {}), nf: src.s.nf };
          } else if (mode === 'formats') {
            if (src && src.s) next.s = clone(src.s); else delete next.s;
          } else if (mode === 'formulas') {
            delete next.f; delete next.v;
            if (src && src.f != null) next.f = shiftFormula(src.f, dr, dc);
            else if (src && src.v != null) next.v = src.v;
          }
          ed.sheet.cells[k] = next;
          ed.cleanCell(r, c);
        }
        if ((mode === 'all' || mode === 'formats') && clip.merges && !tr) {
          const offR = r0 + ty0 * ph - clip.range.r1, offC = c0 + tx0 * pw - clip.range.c1;
          const ms = clip.merges.map((m) => ({ r1: m.r1 + offR, r2: m.r2 + offR, c1: m.c1 + offC, c2: m.c2 + offC }));
          ed.sheet.merges = ed.sheet.merges.filter((m) => !ms.some((x) => intersects(x, m))).concat(ms);
        }
      }
    }, clip.cut && clip.si !== ed.si ? 'book' : 'sheet');
    ed.selectRange({ r1: r0, c1: c0, r2: r0 + ph * ty - 1, c2: c0 + pw * tx - 1 });
    if (clip.cut) ed.clip = null;
    return;
  }
  if (!text) return;
  const rows = parseTSV(text);
  ed.change('粘贴', () => {
    rows.forEach((row, i) => row.forEach((t, j) => {
      const r = r0 + (mode === 'transpose' ? j : i), c = c0 + (mode === 'transpose' ? i : j);
      ed.writeInput(r, c, t);
    }));
  });
  const nr = rows.length, nc = Math.max(...rows.map((r) => r.length));
  ed.selectRange({ r1: r0, c1: c0, r2: r0 + (mode === 'transpose' ? nc : nr) - 1, c2: c0 + (mode === 'transpose' ? nr : nc) - 1 });
  if (ed.clip) ed.clip.marquee = false;
}
const normalizeNL = (s) => (s || '').replace(/\r\n?/g, '\n').replace(/\n$/, '');

/* ================= 填充 ================= */

const LISTS = [
  ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'],
  ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'],
  ['第一季度', '第二季度', '第三季度', '第四季度'],
  ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'],
  ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'],
  ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'],
];

/** 根据源序列推算第 k 个（k 从 n 开始）元素；返回 cell */
function seriesGenerator(srcCells) {
  const n = srcCells.length;
  const vals = srcCells.map((c) => (c ? c.v : null));
  const hasFormula = srcCells.some((c) => c && c.f != null);
  if (!hasFormula && n && vals.every((v) => typeof v === 'number')) {
    if (n === 1) {
      const isDate = srcCells[0]?.s?.nf && isDateFormat(srcCells[0].s.nf);
      return (k) => (isDate ? vals[0] + k : vals[0]);
    }
    // 线性拟合
    const xs = vals.map((_, i) => i);
    const mx = (n - 1) / 2, my = vals.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    xs.forEach((x, i) => { sxy += (x - mx) * (vals[i] - my); sxx += (x - mx) ** 2; });
    const slope = sxy / sxx, icpt = my - slope * mx;
    return (k) => +(icpt + slope * k).toPrecision(15);
  }
  if (!hasFormula && n && vals.every((v) => typeof v === 'string')) {
    // 自定义序列
    for (const list of LISTS) {
      const idx = vals.map((v) => list.indexOf(v));
      if (idx.every((i) => i >= 0)) {
        const step = n > 1 ? idx[1] - idx[0] : 1;
        return (k) => list[(((idx[0] + step * k) % list.length) + list.length) % list.length];
      }
    }
    // 文本 + 数字
    const parts = vals.map((v) => v.match(/^(.*?)(\d+)(\D*)$/));
    if (parts.every((p) => p) && parts.every((p) => p[1] === parts[0][1] && p[3] === parts[0][3])) {
      const nums = parts.map((p) => +p[2]);
      const width = parts[0][2].length;
      const step = n > 1 ? nums[n - 1] - nums[n - 2] || 1 : 1;
      const base = nums[0];
      const stepAll = n > 1 ? (nums[n - 1] - nums[0]) / (n - 1) : step;
      return (k) => {
        const val = Math.round(base + stepAll * k);
        const s = String(Math.abs(val)).padStart(parts[0][2].startsWith('0') ? width : 1, '0');
        return parts[0][1] + (val < 0 ? '-' : '') + s + parts[0][3];
      };
    }
  }
  return null;
}

export function autoFill(ed, src, target) {
  ed.change('填充', () => {
    const vertical = target.c1 === src.c1 && target.c2 === src.c2 && (target.r1 !== src.r1 || target.r2 !== src.r2);
    const forward = vertical ? target.r2 > src.r2 : target.c2 > src.c2;
    const lines = vertical ? src.c2 - src.c1 + 1 : src.r2 - src.r1 + 1;
    const len = vertical ? src.r2 - src.r1 + 1 : src.c2 - src.c1 + 1;
    const tlen = vertical ? target.r2 - target.r1 + 1 : target.c2 - target.c1 + 1;
    for (let l = 0; l < lines; l++) {
      const srcPos = (i) => (vertical ? [src.r1 + i, src.c1 + l] : [src.r1 + l, src.c1 + i]);
      const srcCells = [];
      for (let i = 0; i < len; i++) srcCells.push(clone(ed.cellAt(...srcPos(i))));
      const gen = seriesGenerator(srcCells);
      for (let t = 0; t < tlen - len; t++) {
        // 目标位置
        const k = forward ? len + t : -1 - t; // 序列索引
        const i = forward ? len + t : -1 - t;
        const [r, c] = vertical ? [forward ? src.r2 + 1 + t : src.r1 - 1 - t, src.c1 + l] : [src.r1 + l, forward ? src.c2 + 1 + t : src.c1 - 1 - t];
        const srcIdx = ((i % len) + len) % len;
        const base = srcCells[srcIdx];
        const [sr, sc] = srcPos(srcIdx);
        const cell = clone(base) || {};
        if (cell.f != null) cell.f = shiftFormula(cell.f, r - sr, c - sc);
        else if (gen && !ed.fillCopyOnly) cell.v = gen(k);
        ed.sheet.cells[key(r, c)] = cell;
        ed.cleanCell(r, c);
      }
    }
    // 在源区域内向回拖动 = 清除
  });
  const all = { r1: Math.min(src.r1, target.r1), c1: Math.min(src.c1, target.c1), r2: Math.max(src.r2, target.r2), c2: Math.max(src.c2, target.c2) };
  ed.selectRange(all, { active: ed.sel.active });
}

export function fillDirection(ed, dir) {
  const rg = ed.range;
  ed.change('填充', () => {
    if (dir === 'down') {
      const r0 = rg.r1 === rg.r2 ? rg.r1 - 1 : rg.r1;
      if (r0 < 0) return;
      for (let c = rg.c1; c <= rg.c2; c++) {
        const src = ed.cellAt(r0, c);
        for (let r = r0 + 1; r <= rg.r2; r++) {
          const cell = clone(src) || {};
          if (cell.f != null) cell.f = shiftFormula(cell.f, r - r0, 0);
          ed.sheet.cells[key(r, c)] = cell; ed.cleanCell(r, c);
        }
      }
    } else {
      const c0 = rg.c1 === rg.c2 ? rg.c1 - 1 : rg.c1;
      if (c0 < 0) return;
      for (let r = rg.r1; r <= rg.r2; r++) {
        const src = ed.cellAt(r, c0);
        for (let c = c0 + 1; c <= rg.c2; c++) {
          const cell = clone(src) || {};
          if (cell.f != null) cell.f = shiftFormula(cell.f, 0, c - c0);
          ed.sheet.cells[key(r, c)] = cell; ed.cleanCell(r, c);
        }
      }
    }
  });
}

/** 双击填充柄：填充到左右相邻列数据末尾 */
export function fillToAdjacent(ed) {
  const rg = ed.range;
  const has = (r, c) => c >= 0 && ed.hasData(r, c);
  let end = rg.r2;
  const col = has(rg.r2 + 1, rg.c1 - 1) || has(rg.r2, rg.c1 - 1) ? rg.c1 - 1 : rg.c2 + 1;
  while (has(end + 1, col)) end++;
  if (end <= rg.r2) return;
  autoFill(ed, rg, { ...rg, r2: end });
}

export function insertNow(ed, kind) {
  const n = kind === 'date' ? todaySerial() : nowSerial() % 1;
  const { r, c } = ed.sel.active;
  ed.change('插入日期', () => {
    const cell = ed.ensureCell(r, c);
    delete cell.f;
    cell.v = n;
    cell.s = { ...(cell.s || {}), nf: kind === 'date' ? 'yyyy/m/d' : 'h:mm' };
  });
}

/* ================= 自动求和 ================= */
export function autoSum(ed, fn = 'SUM') {
  const rg = ed.range;
  const single = rg.r1 === rg.r2 && rg.c1 === rg.c2;
  if (single) {
    const { r, c } = ed.sel.active;
    const isNum = (rr, cc) => typeof ed.engine.display(ed.si, rr, cc) === 'number';
    let src = null;
    if (r > 0 && isNum(r - 1, c)) {
      let top = r - 1;
      while (top > 0 && isNum(top - 1, c)) top--;
      src = { r1: top, c1: c, r2: r - 1, c2: c };
    } else if (c > 0 && isNum(r, c - 1)) {
      let left = c - 1;
      while (left > 0 && isNum(r, left - 1)) left--;
      src = { r1: r, c1: left, r2: r, c2: c - 1 };
    }
    const text = `=${fn}(${src ? rangeStr(src) : ''})`;
    ed.beginEdit(text, 'enter');
    if (!src) { const p = text.length - 1; ed.input.setSelectionRange(p, p); }
    return;
  }
  // 选区：在每列下方写入汇总
  const ur = ed.usedPart(rg);
  ed.change('自动求和', () => {
    let row = ur.r2 + 1;
    const lastEmpty = [...Array(ur.c2 - ur.c1 + 1).keys()].every((j) => !ed.hasData(ur.r2, ur.c1 + j));
    if (lastEmpty && ur.r2 > ur.r1) row = ur.r2;
    for (let c = ur.c1; c <= ur.c2; c++) {
      const end = row - 1;
      if (end < ur.r1) continue;
      ed.writeInput(row, c, `=${fn}(${rangeStr({ r1: ur.r1, c1: c, r2: end, c2: c })})`);
    }
  });
}

/* ================= 排序 / 筛选 ================= */

/** 获取活动单元格所在的连续数据区域 */
export function currentRegion(ed, r, c) {
  let rg = { r1: r, c1: c, r2: r, c2: c };
  const has = (rr, cc) => rr >= 0 && cc >= 0 && ed.hasData(rr, cc);
  let grew = true;
  while (grew) {
    grew = false;
    const ex = (dir) => {
      const t = { ...rg };
      if (dir === 'up') t.r1--; if (dir === 'down') t.r2++; if (dir === 'left') t.c1--; if (dir === 'right') t.c2++;
      if (t.r1 < 0 || t.c1 < 0) return false;
      const row = dir === 'up' ? t.r1 : dir === 'down' ? t.r2 : null, col = dir === 'left' ? t.c1 : dir === 'right' ? t.c2 : null;
      for (let i = (row != null ? t.c1 : t.r1) - 0; i <= (row != null ? t.c2 : t.r2); i++) {
        if (row != null ? has(row, i) : has(i, col)) { rg = t; return true; }
      }
      return false;
    };
    for (const d of ['up', 'down', 'left', 'right']) if (ex(d)) grew = true;
  }
  return rg;
}
export function sortTarget(ed) {
  const rg = ed.range;
  if (rg.r1 === rg.r2 && rg.c1 === rg.c2) return currentRegion(ed, rg.r1, rg.c1);
  return ed.usedPart(rg);
}
export function guessHeader(ed, rg) {
  if (rg.r1 === rg.r2) return false;
  let textCount = 0, n = 0;
  for (let c = rg.c1; c <= rg.c2; c++) {
    const v = ed.engine.display(ed.si, rg.r1, c), v2 = ed.engine.display(ed.si, rg.r1 + 1, c);
    if (typeof v === 'string') textCount++;
    if (v2 != null) n++;
    if (typeof v === 'string' && typeof v2 === 'number') return true;
  }
  return textCount === rg.c2 - rg.c1 + 1 && rg.c2 - rg.c1 >= 0 && !!ed.sheet.cells[key(rg.r1, rg.c1)]?.s?.b;
}

/** keys: [{ c, asc }] */
export function sortRange(ed, rg, keys, hasHeader) {
  const s = ed.sheet;
  const r1 = rg.r1 + (hasHeader ? 1 : 0);
  if (r1 > rg.r2) return;
  ed.change('排序', () => {
    const rows = [];
    for (let r = r1; r <= rg.r2; r++) {
      const cells = [];
      for (let c = rg.c1; c <= rg.c2; c++) cells.push(s.cells[key(r, c)] || null);
      rows.push({ r, cells, keys: keys.map((k) => ed.engine.display(ed.si, r, k.c)) });
    }
    rows.sort((a, b) => {
      for (let i = 0; i < keys.length; i++) {
        const x = a.keys[i], y = b.keys[i];
        const xe = x == null || x === '', ye = y == null || y === '';
        if (xe && ye) continue;
        if (xe) return 1;
        if (ye) return -1;
        const cmp = compareValues(isErr(x) ? '' : x, isErr(y) ? '' : y);
        if (cmp) return keys[i].asc ? cmp : -cmp;
      }
      return a.r - b.r;
    });
    rows.forEach((row, i) => {
      const r = r1 + i;
      row.cells.forEach((cell, j) => {
        const k = key(r, rg.c1 + j);
        if (cell) {
          const nc = clone(cell);
          if (nc.f != null && row.r !== r) nc.f = shiftFormula(nc.f, r - row.r, 0);
          s.cells[k] = nc;
        } else delete s.cells[k];
      });
    });
  });
}
export function quickSort(ed, asc) {
  const rg = sortTarget(ed);
  const header = guessHeader(ed, rg) || (ed.sheet.filter && ed.sheet.filter.r1 === rg.r1);
  sortRange(ed, rg, [{ c: ed.sel.active.c, asc }], header);
}

export function toggleFilter(ed) {
  const s = ed.sheet;
  if (s.filter) {
    ed.change('取消筛选', () => { s.filter = null; s.filterHidden = {}; });
    return;
  }
  let rg = ed.range;
  if (rg.r1 === rg.r2 && rg.c1 === rg.c2) rg = currentRegion(ed, rg.r1, rg.c1);
  else rg = ed.usedPart(rg);
  ed.change('筛选', () => { s.filter = { r1: rg.r1, c1: rg.c1, r2: Math.max(rg.r2, rg.r1 + 1), c2: rg.c2, conds: {} }; s.filterHidden = {}; });
}

/** 筛选区域的数据末行（自动扩展到连续数据） */
export function filterEnd(ed) {
  const f = ed.sheet.filter;
  let end = f.r2;
  const b = ed.engine.bounds[ed.si];
  for (let r = f.r2 + 1; r <= b.maxR; r++) {
    let any = false;
    for (let c = f.c1; c <= f.c2; c++) if (ed.hasData(r, c)) { any = true; break; }
    if (!any) break;
    end = r;
  }
  return end;
}

export function displayText(ed, r, c) {
  const v = ed.engine.display(ed.si, r, c);
  return v == null || v === '' ? '' : formatValue(v, ed.cellAt(r, c)?.s?.nf).text;
}

export function condMatch(cond, v, text) {
  if (cond.type === 'values') return cond.values.includes(text);
  const test = (op, a) => {
    if (op === 'contains') return text.toLowerCase().includes(String(a).toLowerCase());
    if (op === 'notContains') return !text.toLowerCase().includes(String(a).toLowerCase());
    if (op === 'begins') return text.toLowerCase().startsWith(String(a).toLowerCase());
    if (op === 'ends') return text.toLowerCase().endsWith(String(a).toLowerCase());
    const crit = { eq: '=', ne: '<>', gt: '>', lt: '<', ge: '>=', le: '<=' }[op] + a;
    return makeCriteria(crit)(v);
  };
  if (cond.type === 'cond') {
    const a = test(cond.op, cond.a);
    if (!cond.op2) return a;
    const b = test(cond.op2, cond.b);
    return cond.join === 'or' ? a || b : a && b;
  }
  return true;
}

export function applyFilter(ed) {
  const s = ed.sheet, f = s.filter;
  if (!f) return;
  f.r2 = filterEnd(ed);
  const hidden = {};
  const conds = Object.entries(f.conds || {});
  // top10 / 平均值类条件需统计
  for (let r = f.r1 + 1; r <= f.r2; r++) {
    for (const [cs, cond] of conds) {
      const c = +cs;
      const v = ed.engine.display(ed.si, r, c);
      const text = displayText(ed, r, c);
      if (cond.type === 'top' || cond.type === 'above' || cond.type === 'below') {
        const nums = [];
        for (let rr = f.r1 + 1; rr <= f.r2; rr++) { const x = ed.engine.display(ed.si, rr, c); if (typeof x === 'number') nums.push(x); }
        nums.sort((a, b) => b - a);
        if (typeof v !== 'number') { hidden[r] = 1; break; }
        if (cond.type === 'top' && v < nums[Math.min(nums.length - 1, (cond.n || 10) - 1)]) { hidden[r] = 1; break; }
        const avg = nums.reduce((a, b) => a + b, 0) / (nums.length || 1);
        if (cond.type === 'above' && !(v > avg)) { hidden[r] = 1; break; }
        if (cond.type === 'below' && !(v < avg)) { hidden[r] = 1; break; }
        continue;
      }
      if (!condMatch(cond, v, text)) { hidden[r] = 1; break; }
    }
  }
  s.filterHidden = hidden;
}

export function setFilterCond(ed, c, cond) {
  ed.change('筛选', () => {
    const f = ed.sheet.filter;
    if (cond) f.conds[c] = cond; else delete f.conds[c];
    applyFilter(ed);
  });
}
export function clearAllFilters(ed) {
  const f = ed.sheet.filter;
  if (!f) return;
  ed.change('清除筛选', () => { f.conds = {}; ed.sheet.filterHidden = {}; });
}
export function reapplyFilter(ed) {
  if (!ed.sheet.filter) return;
  ed.change('重新应用', () => applyFilter(ed));
}
export function filterBySelected(ed) {
  const { r, c } = ed.sel.active;
  const text = displayText(ed, r, c);
  if (!ed.sheet.filter) {
    const rg = currentRegion(ed, r, c);
    ed.sheet.filter = { r1: rg.r1, c1: rg.c1, r2: rg.r2, c2: rg.c2, conds: {} };
    if (r === rg.r1) return;
  }
  setFilterCond(ed, c, { type: 'values', values: [text] });
}

export async function removeDuplicates(ed) {
  const rg = sortTarget(ed);
  const header = guessHeader(ed, rg);
  const cols = [];
  for (let c = rg.c1; c <= rg.c2; c++) cols.push({ name: 'c' + c, label: (header ? displayText(ed, rg.r1, c) || '列 ' + colName(c) : '列 ' + colName(c)), type: 'checkbox', value: true });
  const res = await formBox('删除重复项', [{ name: 'header', label: '数据包含标题', type: 'checkbox', value: header }, ...cols]);
  if (!res) return;
  const keyCols = [];
  for (let c = rg.c1; c <= rg.c2; c++) if (res['c' + c]) keyCols.push(c);
  if (!keyCols.length) return;
  const start = rg.r1 + (res.header ? 1 : 0);
  const s = ed.sheet;
  let removed = 0;
  ed.change('删除重复项', () => {
    const seen = new Set();
    const keep = [];
    for (let r = start; r <= rg.r2; r++) {
      const k = JSON.stringify(keyCols.map((c) => { const v = ed.engine.display(ed.si, r, c); return typeof v === 'string' ? v.toLowerCase() : v; }));
      if (seen.has(k)) { removed++; continue; }
      seen.add(k);
      keep.push(r);
    }
    const rowsData = keep.map((r) => { const row = []; for (let c = rg.c1; c <= rg.c2; c++) row.push(s.cells[key(r, c)] || null); return row; });
    for (let r = start; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) delete s.cells[key(r, c)];
    rowsData.forEach((row, i) => row.forEach((cell, j) => { if (cell) s.cells[key(start + i, rg.c1 + j)] = cell; }));
  });
  alertBox(removed ? `发现了 ${removed} 个重复值，已将其删除；保留了 ${rg.r2 - start + 1 - removed} 个唯一值。` : '未发现重复值。', '删除重复项');
}

export async function textToColumns(ed) {
  const rg = ed.range;
  if (rg.c1 !== rg.c2) { toast('一次只能转换一列数据', 'error'); return; }
  const res = await formBox('分列', [
    { name: 'sep', label: '分隔符号', type: 'select', value: ',', options: [{ value: ',', label: '逗号 ,' }, { value: '\t', label: 'Tab 键' }, { value: ' ', label: '空格' }, { value: ';', label: '分号 ;' }, { value: '，', label: '中文逗号 ，' }, { value: 'other', label: '其他' }] },
    { name: 'other', label: '其他分隔符', value: '' },
  ]);
  if (!res) return;
  const sep = res.sep === 'other' ? res.other : res.sep;
  if (!sep) return;
  const ur = ed.usedPart(rg);
  ed.change('分列', () => {
    for (let r = ur.r1; r <= ur.r2; r++) {
      const v = ed.engine.display(ed.si, r, rg.c1);
      if (typeof v !== 'string') continue;
      v.split(sep).forEach((part, j) => ed.writeInput(r, rg.c1 + j, part.trim()));
    }
  });
}

/* ================= 数据验证 ================= */
export function validateInput(ed, dv, text) {
  if (dv.type === 'any') return true;
  const p = text.trim();
  if (dv.type === 'list') {
    const items = listItems(ed, dv);
    return items.some((x) => String(x).toLowerCase() === p.toLowerCase());
  }
  if (dv.type === 'length') return compare(p.length, dv);
  let n = Number(p.replace(/,/g, ''));
  if (dv.type === 'date') {
    const m = p.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
    if (m) n = dateToSerial(+m[1], +m[2], +m[3]);
  }
  if (isNaN(n)) return false;
  if (dv.type === 'whole' && !Number.isInteger(n)) return false;
  return compare(n, dv);
}
function compare(n, dv) {
  const a = Number(dv.a), b = Number(dv.b);
  switch (dv.op) {
    case 'between': return n >= Math.min(a, b) && n <= Math.max(a, b);
    case 'notBetween': return n < Math.min(a, b) || n > Math.max(a, b);
    case 'eq': return n === a; case 'ne': return n !== a;
    case 'gt': return n > a; case 'lt': return n < a; case 'ge': return n >= a; case 'le': return n <= a;
  }
  return true;
}
export function listItems(ed, dv) {
  const src = String(dv.list || '').trim();
  if (src.startsWith('=')) {
    try {
      const v = evaluate(parse(src.slice(1)), { engine: ed.engine, sheet: ed.si, r: 0, c: 0 });
      return (Array.isArray(v) ? v.flat() : [v]).filter((x) => x != null && x !== '').map((x) => formatValue(x).text);
    } catch { return []; }
  }
  return src.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
}

/* ================= 批注 / 超链接 ================= */
export async function editComment(ed) {
  const { r, c } = ed.sel.active;
  const cell = ed.cellAt(r, c);
  const res = await formBox(cell && cell.cm ? '编辑批注' : '新建批注', [{ name: 'cm', label: '批注内容', type: 'textarea', value: (cell && cell.cm) || '', rows: 5 }]);
  if (!res) return;
  ed.change('批注', () => {
    const cl = ed.ensureCell(r, c);
    if (res.cm.trim()) cl.cm = res.cm; else delete cl.cm;
    ed.cleanCell(r, c);
  });
}
export function nextComment(ed, dir = 1) {
  const list = Object.entries(ed.sheet.cells).filter(([, c]) => c.cm).map(([k]) => unkey(k)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (!list.length) { toast('工作表中没有批注'); return; }
  const { r, c } = ed.sel.active;
  let i = list.findIndex(([rr, cc]) => rr > r || (rr === r && cc > c));
  if (dir < 0) { i = list.findLastIndex(([rr, cc]) => rr < r || (rr === r && cc < c)); if (i < 0) i = list.length - 1; }
  else if (i < 0) i = 0;
  ed.select(list[i][0], list[i][1]);
}

/* ================= 冻结窗格 ================= */
export function freeze(ed, kind) {
  const s = ed.sheet;
  ed.change('冻结窗格', () => {
    if (kind === 'none') s.freeze = { r: 0, c: 0 };
    else if (kind === 'row') s.freeze = { r: 1, c: 0 };
    else if (kind === 'col') s.freeze = { r: 0, c: 1 };
    else s.freeze = { r: ed.sel.active.r, c: ed.sel.active.c };
  });
  ed.grid.scroller.scrollTop = 0;
  ed.grid.scroller.scrollLeft = 0;
}

/* ================= 样式预设 ================= */
export const CELL_STYLES = [
  { group: '好、差和适中', items: [
    { name: '常规', s: null },
    { name: '好', s: { bg: '#c6efce', fc: '#006100' } },
    { name: '差', s: { bg: '#ffc7ce', fc: '#9c0006' } },
    { name: '适中', s: { bg: '#ffeb9c', fc: '#9c5700' } },
  ] },
  { group: '数据和模型', items: [
    { name: '计算', s: { bg: '#f2f2f2', fc: '#fa7d00', b: true, bd: side4('#7f7f7f') } },
    { name: '检查单元格', s: { bg: '#a5a5a5', fc: '#ffffff', b: true, bd: side4('#3f3f3f', 3) } },
    { name: '输入', s: { bg: '#ffcc99', fc: '#3f3f76', bd: side4('#7f7f7f') } },
    { name: '输出', s: { bg: '#f2f2f2', fc: '#3f3f3f', b: true, bd: side4('#3f3f3f') } },
    { name: '注释', s: { bg: '#ffffcc', bd: side4('#b2b2b2') } },
    { name: '警告文本', s: { fc: '#ff0000' } },
  ] },
  { group: '标题', items: [
    { name: '标题', s: { fs: 18, b: true, fc: '#44546a' } },
    { name: '标题 1', s: { fs: 15, b: true, fc: '#44546a', bd: { b: { w: 2, c: '#4472c4' } } } },
    { name: '标题 2', s: { fs: 13, b: true, fc: '#44546a', bd: { b: { w: 2, c: '#a2b8e1' } } } },
    { name: '标题 3', s: { fs: 11, b: true, fc: '#44546a', bd: { b: { w: 2, c: '#8ea9db' } } } },
    { name: '汇总', s: { b: true, bd: { t: { w: 1, c: '#4472c4' }, b: { w: 3, c: '#4472c4' } } } },
  ] },
  { group: '主题单元格样式', items: [
    ...[['强调文字颜色 1', '#4472c4'], ['强调文字颜色 2', '#ed7d31'], ['强调文字颜色 3', '#a5a5a5'], ['强调文字颜色 4', '#ffc000'], ['强调文字颜色 5', '#5b9bd5'], ['强调文字颜色 6', '#70ad47']]
      .map(([n, c]) => ({ name: n, s: { bg: c, fc: '#ffffff' } })),
    ...[['20% - 强调 1', '#d9e1f2'], ['20% - 强调 2', '#fce4d6'], ['20% - 强调 3', '#ededed'], ['20% - 强调 4', '#fff2cc'], ['20% - 强调 5', '#ddebf7'], ['20% - 强调 6', '#e2efda']]
      .map(([n, c]) => ({ name: n, s: { bg: c } })),
  ] },
];
function side4(c, w = 1) { const s = { w, c }; return { t: s, b: s, l: s, r: s }; }

export function applyCellStyle(ed, st) {
  ed.change('单元格样式', () => {
    ed.forEachSelected((r, c) => {
      const cell = ed.ensureCell(r, c);
      const nf = cell.s && cell.s.nf;
      cell.s = st ? clone(st) : {};
      if (nf) cell.s.nf = nf;
      ed.cleanCell(r, c);
    });
  });
}

export const TABLE_STYLES = [
  { name: '蓝色', head: '#4472c4', band: '#d9e1f2', line: '#8ea9db' },
  { name: '橙色', head: '#ed7d31', band: '#fce4d6', line: '#f4b084' },
  { name: '绿色', head: '#70ad47', band: '#e2efda', line: '#a9d08e' },
  { name: '灰色', head: '#7f7f7f', band: '#ededed', line: '#bfbfbf' },
  { name: '金色', head: '#bf8f00', band: '#fff2cc', line: '#ffd966' },
  { name: '蓝灰', head: '#44546a', band: '#d6dce4', line: '#adb9ca' },
  { name: '紫色', head: '#7030a0', band: '#e4d4f0', line: '#c09fdc' },
  { name: '青色', head: '#1a8a8a', band: '#d4eeee', line: '#8fcccc' },
  { name: '红色', head: '#c00000', band: '#fadbd8', line: '#ea9a96' },
];
export function applyTableStyle(ed, ts, withFilter = true) {
  let rg = ed.range;
  if (rg.r1 === rg.r2 && rg.c1 === rg.c2) rg = currentRegion(ed, rg.r1, rg.c1);
  else rg = ed.usedPart(rg);
  ed.change('套用表格格式', () => {
    const line = { w: 1, c: ts.line };
    for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) {
      const cell = ed.ensureCell(r, c);
      const s = (cell.s = { ...(cell.s || {}) });
      delete s.bg; delete s.fc; delete s.b;
      if (r === rg.r1) { s.bg = ts.head; s.fc = '#ffffff'; s.b = true; }
      else if ((r - rg.r1) % 2 === 1) s.bg = ts.band;
      s.bd = { t: line, b: line, l: line, r: line };
      ed.cleanCell(r, c);
    }
    if (withFilter && !ed.sheet.filter) ed.sheet.filter = { ...rg, conds: {} };
  });
}

/* ================= 工作表操作 ================= */
function uniqueSheetName(ed, base) {
  const names = new Set(ed.wb.sheets.map((s) => s.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  let i = 2;
  while (names.has(`${base} (${i})`.toLowerCase())) i++;
  return `${base} (${i})`;
}
export function addSheet(ed, at = ed.si + 1) {
  let n = ed.wb.sheets.length + 1;
  while (ed.wb.sheets.some((s) => s.name.toLowerCase() === ('sheet' + n))) n++;
  ed.change('新建工作表', () => { ed.wb.sheets.splice(at, 0, newSheet('Sheet' + n)); }, 'book');
  ed.renderTabs();
  ed.switchSheet(at);
}
export async function deleteSheet(ed, i) {
  if (ed.wb.sheets.length <= 1) { alertBox('工作簿内至少含有一张可视工作表。'); return; }
  const s = ed.wb.sheets[i];
  if (Object.keys(s.cells).length && !(await confirmBox(`确定要删除工作表"${s.name}"吗？`, '删除工作表', '删除'))) return;
  ed.change('删除工作表', () => {
    ed.wb.sheets.splice(i, 1);
    ed.si = Math.min(ed.si, ed.wb.sheets.length - 1);
  }, 'book');
  ed.renderTabs();
  ed.sel = { ranges: [{ r1: 0, c1: 0, r2: 0, c2: 0 }], active: { r: 0, c: 0 }, anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } };
  ed.buildMergeIndex();
  ed.objects.render();
  ed.grid.draw();
}
export function renameSheet(ed, i, name) {
  name = (name || '').trim();
  const old = ed.wb.sheets[i].name;
  if (!name || name === old) return;
  if (/[\\/?*[\]:]/.test(name) || name.length > 31) { alertBox('工作表名称不能包含 \\ / ? * [ ] : 且不超过 31 个字符'); return; }
  if (ed.wb.sheets.some((s, j) => j !== i && s.name.toLowerCase() === name.toLowerCase())) { alertBox('该名称已被使用，请另选一个名称。'); return; }
  ed.change('重命名工作表', () => {
    ed.wb.sheets[i].name = name;
    for (const sh of ed.wb.sheets) for (const cell of Object.values(sh.cells)) if (cell.f != null) cell.f = renameSheetInFormula(cell.f, old, name);
  }, 'book');
  ed.renderTabs();
}
export function renameSheetInline(ed, i, tab) {
  const input = h('input', { class: 'ss-tab-input', value: ed.wb.sheets[i].name });
  tab.replaceChildren(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (ok) => { if (done) return; done = true; if (ok) renameSheet(ed, i, input.value); ed.renderTabs(); ed.input.focus(); };
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('mousedown', (e) => e.stopPropagation());
}
export function duplicateSheet(ed, i) {
  const src = ed.wb.sheets[i];
  ed.change('复制工作表', () => {
    const copy = clone(src);
    copy.id = oid();
    copy.name = uniqueSheetName(ed, src.name);
    for (const o of copy.objects || []) o.id = oid();
    ed.wb.sheets.splice(i + 1, 0, copy);
  }, 'book');
  ed.renderTabs();
  ed.switchSheet(i + 1);
}
export function moveSheet(ed, from, to) {
  if (to < 0 || to >= ed.wb.sheets.length) return;
  ed.change('移动工作表', () => {
    const [s] = ed.wb.sheets.splice(from, 1);
    ed.wb.sheets.splice(to, 0, s);
    ed.si = to;
  }, 'book');
  ed.renderTabs();
}
export function setTabColor(ed, i, color) {
  ed.change('工作表标签颜色', () => { ed.wb.sheets[i].tabColor = color || null; }, 'book');
  ed.renderTabs();
}

export function sheetMenu(ed, i, tab) {
  return [
    { label: '插入工作表', icon: 'plus', onClick: () => addSheet(ed, i + 1) },
    { label: '删除工作表', icon: 'trash-2', onClick: () => deleteSheet(ed, i) },
    { label: '重命名', icon: 'pencil', onClick: () => renameSheetInline(ed, i, ed.tabsEl.children[i]) },
    { label: '创建副本', icon: 'copy', onClick: () => duplicateSheet(ed, i) },
    '-',
    { label: '左移', icon: 'arrow-left', disabled: i === 0, onClick: () => moveSheet(ed, i, i - 1) },
    { label: '右移', icon: 'arrow-right', disabled: i === ed.wb.sheets.length - 1, onClick: () => moveSheet(ed, i, i + 1) },
    { label: '工作表标签颜色', icon: 'palette', onClick: () => colorPicker(ed.tabsEl.children[i] || ed.tabsEl, (c) => setTabColor(ed, i, c), { allowNone: true }) },
  ];
}

/* ================= 右键菜单 ================= */
function pasteItems(ed) {
  return [
    { label: '粘贴', icon: 'clipboard-paste', shortcut: 'Ctrl+V', onClick: () => pasteFromSystem(ed) },
    { label: '选择性粘贴', icon: 'clipboard-list', items: [
      { label: '仅粘贴值', onClick: () => pasteFromSystem(ed, 'values') },
      { label: '仅粘贴格式', onClick: () => pasteFromSystem(ed, 'formats') },
      { label: '仅粘贴公式', onClick: () => pasteFromSystem(ed, 'formulas') },
      { label: '转置', onClick: () => pasteFromSystem(ed, 'transpose') },
      { label: '无框线', onClick: () => pasteFromSystem(ed, 'noborder') },
    ] },
  ];
}
export function cellMenu(ed) {
  const { r, c } = ed.sel.active;
  const cell = ed.cellAt(r, c);
  return [
    { label: '复制', icon: 'copy', shortcut: 'Ctrl+C', onClick: () => copy(ed) },
    { label: '剪切', icon: 'scissors', shortcut: 'Ctrl+X', onClick: () => copy(ed, true) },
    ...pasteItems(ed),
    '-',
    { label: '插入', icon: 'between-horizontal-start', items: [
      { label: '在上方插入行', onClick: () => insertRows(ed, 'above') },
      { label: '在下方插入行', onClick: () => insertRows(ed, 'below') },
      { label: '在左侧插入列', onClick: () => insertCols(ed, 'left') },
      { label: '在右侧插入列', onClick: () => insertCols(ed, 'right') },
      '-',
      { label: '插入单元格...', onClick: () => dlg.insertCellsDialog(ed) },
    ] },
    { label: '删除', icon: 'trash-2', items: [
      { label: '删除整行', onClick: () => deleteRows(ed) },
      { label: '删除整列', onClick: () => deleteCols(ed) },
      { label: '删除单元格...', onClick: () => dlg.deleteCellsDialog(ed) },
    ] },
    { label: '清除内容', icon: 'eraser', shortcut: 'Delete', onClick: () => clear(ed, 'contents') },
    '-',
    { label: '筛选', icon: 'filter', items: [
      { label: '按所选单元格的值筛选', onClick: () => filterBySelected(ed) },
      { label: ed.sheet.filter ? '取消筛选' : '启用筛选', onClick: () => toggleFilter(ed) },
    ] },
    { label: '排序', icon: 'arrow-down-up', items: [
      { label: '升序', icon: 'arrow-up-a-z', onClick: () => quickSort(ed, true) },
      { label: '降序', icon: 'arrow-down-z-a', onClick: () => quickSort(ed, false) },
      { label: '自定义排序...', onClick: () => dlg.sortDialog(ed) },
    ] },
    '-',
    { label: cell && cell.cm ? '编辑批注' : '插入批注', icon: 'message-square-plus', onClick: () => editComment(ed) },
    cell && cell.cm ? { label: '删除批注', icon: 'message-square-x', onClick: () => clear(ed, 'comments') } : null,
    { label: '设置单元格格式...', icon: 'settings-2', shortcut: 'Ctrl+1', onClick: () => dlg.formatCells(ed) },
    { label: '超链接...', icon: 'link', shortcut: 'Ctrl+K', onClick: () => dlg.hyperlink(ed) },
    { label: '从下拉列表中选择', icon: 'list', onClick: () => dlg.pickFromList(ed) },
  ].filter(Boolean);
}
export function colMenu(ed) {
  return [
    { label: '复制', icon: 'copy', onClick: () => copy(ed) },
    { label: '剪切', icon: 'scissors', onClick: () => copy(ed, true) },
    ...pasteItems(ed),
    '-',
    { label: '在左侧插入列', icon: 'between-vertical-start', onClick: () => insertCols(ed, 'left') },
    { label: '在右侧插入列', icon: 'between-vertical-end', onClick: () => insertCols(ed, 'right') },
    { label: '删除列', icon: 'trash-2', onClick: () => deleteCols(ed) },
    { label: '清除内容', icon: 'eraser', onClick: () => clear(ed, 'contents') },
    '-',
    { label: '列宽...', icon: 'move-horizontal', onClick: () => setColWidth(ed) },
    { label: '最适合的列宽', icon: 'arrow-left-right', onClick: () => autoFitCols(ed) },
    { label: '隐藏', icon: 'eye-off', onClick: () => hideRowsCols(ed, 'c', true) },
    { label: '取消隐藏', icon: 'eye', onClick: () => hideRowsCols(ed, 'c', false) },
    '-',
    { label: '设置单元格格式...', icon: 'settings-2', onClick: () => dlg.formatCells(ed) },
  ];
}
export function rowMenu(ed) {
  return [
    { label: '复制', icon: 'copy', onClick: () => copy(ed) },
    { label: '剪切', icon: 'scissors', onClick: () => copy(ed, true) },
    ...pasteItems(ed),
    '-',
    { label: '在上方插入行', icon: 'between-horizontal-start', onClick: () => insertRows(ed, 'above') },
    { label: '在下方插入行', icon: 'between-horizontal-end', onClick: () => insertRows(ed, 'below') },
    { label: '删除行', icon: 'trash-2', onClick: () => deleteRows(ed) },
    { label: '清除内容', icon: 'eraser', onClick: () => clear(ed, 'contents') },
    '-',
    { label: '行高...', icon: 'move-vertical', onClick: () => setRowHeight(ed) },
    { label: '最适合的行高', icon: 'arrow-up-down', onClick: () => autoFitRows(ed) },
    { label: '隐藏', icon: 'eye-off', onClick: () => hideRowsCols(ed, 'r', true) },
    { label: '取消隐藏', icon: 'eye', onClick: () => hideRowsCols(ed, 'r', false) },
    '-',
    { label: '设置单元格格式...', icon: 'settings-2', onClick: () => dlg.formatCells(ed) },
  ];
}

/* ================= 打印 ================= */
export function printSheet(ed, si = ed.si) {
  const s = ed.wb.sheets[si];
  const b = ed.engine.bounds[si];
  if (!Object.keys(s.cells).length) { toast('工作表为空，没有可打印的内容'); return; }
  const rg = { r1: 0, c1: 0, r2: b.maxR, c2: b.maxC };
  const page = s.page || {};
  const css = `@page { size: ${page.size || 'A4'} ${page.landscape ? 'landscape' : 'portrait'}; margin: ${page.margin || 12}mm; }
    body { font-family: "Microsoft YaHei", sans-serif; margin: 0; }
    table { border-collapse: collapse; table-layout: fixed; }
    td { overflow: hidden; padding: 1px 3px; font-size: 11pt; ${page.gridlines ? 'border: 1px solid #ccc;' : ''} }
    h3 { font-size: 12pt; margin: 0 0 6px; }`;
  printHTML(`${page.title !== false ? `<h3>${escapeHTML(s.name)}</h3>` : ''}` + sheetToHTML(ed, si, rg), css, s.name);
}
export function escapeHTML(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
