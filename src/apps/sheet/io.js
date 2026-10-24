// 导入导出：xlsx/xls/ods/csv 导入，xlsx/ods/csv/html 导出，HTML 表格生成（打印/复制用）
import { download } from '../../core/ui.js';
import { key, unkey, colName } from './refs.js';
import { formatValue, isErr, parseInput } from './format.js';
import { newSheet, newWorkbook, DEFAULT_COL_W, DEFAULT_ROW_H, DEFAULT_FONT } from './model.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function bdCss(b) {
  if (!b) return '';
  return `${b.w >= 3 ? 3 : b.w || 1}px ${b.w >= 3 ? 'double' : b.d === 'dashed' ? 'dashed' : b.d === 'dotted' ? 'dotted' : 'solid'} ${b.c || '#000'}`;
}

/** 区域转 HTML 表格（含格式、合并、列宽） */
export function sheetToHTML(ed, si, rg, { inline = false } = {}) {
  const s = ed.wb.sheets[si];
  const eng = ed.engine;
  const covered = new Set();
  const mergeOf = new Map();
  for (const m of s.merges) {
    if (m.r1 < rg.r1 || m.c1 < rg.c1 || m.r1 > rg.r2 || m.c1 > rg.c2) continue;
    mergeOf.set(key(m.r1, m.c1), m);
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) covered.add(key(r, c));
  }
  const colW = (c) => (s.hiddenCols[c] ? 0 : s.colW[c] ?? DEFAULT_COL_W);
  const rowH = (r) => (s.hiddenRows[r] || s.filterHidden?.[r] ? 0 : s.rowH[r] ?? DEFAULT_ROW_H);
  let html = `<table style="border-collapse:collapse;table-layout:fixed;font-family:'${DEFAULT_FONT}',sans-serif"><colgroup>`;
  let totalW = 0;
  for (let c = rg.c1; c <= rg.c2; c++) { if (colW(c)) { html += `<col style="width:${colW(c)}px">`; totalW += colW(c); } }
  html += '</colgroup>';
  for (let r = rg.r1; r <= rg.r2; r++) {
    if (!rowH(r)) continue;
    html += `<tr style="height:${rowH(r)}px">`;
    for (let c = rg.c1; c <= rg.c2; c++) {
      if (!colW(c) || covered.has(key(r, c))) continue;
      const cell = s.cells[key(r, c)];
      const st = (cell && cell.s) || {};
      let v;
      try { v = eng.display(si, r, c); } catch { v = null; }
      const { text, color } = formatValue(v, st.nf);
      const m = mergeOf.get(key(r, c));
      let ha = st.ha && st.ha !== 'general' ? st.ha : typeof v === 'number' ? 'right' : typeof v === 'boolean' || isErr(v) ? 'center' : 'left';
      if (ha === 'centerAcross') ha = 'center';
      const css = [
        `font-size:${st.fs || 11}pt`, st.ff ? `font-family:'${st.ff}'` : '', st.b ? 'font-weight:bold' : '', st.i ? 'font-style:italic' : '',
        st.u || st.st ? `text-decoration:${st.u ? 'underline' : ''} ${st.st ? 'line-through' : ''}` : '',
        `color:${color || st.fc || '#000'}`, st.bg ? `background:${st.bg}` : '', `text-align:${ha}`, `vertical-align:${st.va === 'top' ? 'top' : st.va === 'bottom' ? 'bottom' : 'middle'}`,
        st.wrap ? 'white-space:pre-wrap;word-break:break-all' : 'white-space:nowrap', 'overflow:hidden', 'padding:1px 4px',
        st.bd?.t ? `border-top:${bdCss(st.bd.t)}` : '', st.bd?.b ? `border-bottom:${bdCss(st.bd.b)}` : '',
        st.bd?.l ? `border-left:${bdCss(st.bd.l)}` : '', st.bd?.r ? `border-right:${bdCss(st.bd.r)}` : '',
        st.indent ? `padding-left:${4 + st.indent * 10}px` : '',
      ].filter(Boolean).join(';');
      const span = m ? ` rowspan="${m.r2 - m.r1 + 1}" colspan="${m.c2 - m.c1 + 1}"` : '';
      const content = cell && cell.link ? `<a href="${esc(cell.link)}">${esc(text)}</a>` : esc(text);
      html += `<td${span} style="${css}">${content}</td>`;
    }
    html += '</tr>';
  }
  html += '</table>';
  return html;
}

/* ================= 导入 ================= */

function decodeText(buf) {
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) {
    try { text = new TextDecoder('gbk').decode(buf); } catch {}
  }
  return text.replace(/^﻿/, '');
}

function parseDelimited(text, sep) {
  text = text.replace(/\r\n?/g, '\n');
  const rows = [[]];
  let cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
      continue;
    }
    if (ch === '"' && cur === '') q = true;
    else if (ch === sep) { rows[rows.length - 1].push(cur); cur = ''; }
    else if (ch === '\n') { rows[rows.length - 1].push(cur); cur = ''; rows.push([]); }
    else cur += ch;
  }
  rows[rows.length - 1].push(cur);
  if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
  return rows;
}

export async function importFile(file) {
  const name = file.name.replace(/\.[^.]+$/, '');
  const ext = file.name.toLowerCase().split('.').pop();
  const buf = await file.arrayBuffer();
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    const text = decodeText(buf);
    const sep = ext === 'tsv' || (!text.includes(',') && text.includes('\t')) ? '\t' : ',';
    const wb = newWorkbook();
    const s = wb.sheets[0];
    s.name = name.slice(0, 31).replace(/[\\/?*[\]:]/g, '_') || 'Sheet1';
    const rows = parseDelimited(text, sep);
    let maxC = 0;
    rows.forEach((row, r) => row.forEach((t, c) => {
      if (t === '') return;
      const p = parseInput(t);
      const cell = {};
      if (p.f != null) cell.v = t; else cell.v = p.v;
      if (p.nf) cell.s = { nf: p.nf };
      s.cells[key(r, c)] = cell;
      maxC = Math.max(maxC, c);
    }));
    s.rows = Math.max(200, rows.length + 50);
    s.cols = Math.max(26, maxC + 5);
    autoWidths(s);
    return { name, content: wb };
  }
  const XLSX = await import('xlsx');
  const x = XLSX.read(buf, { type: 'array', cellFormula: true, cellStyles: true, cellNF: true, cellDates: false });
  const wb = { version: 1, sheets: [], active: 0, zoom: 100 };
  for (const sname of x.SheetNames) {
    const ws = x.Sheets[sname];
    const s = newSheet(sname);
    let maxR = 0, maxC = 0;
    for (const k of Object.keys(ws)) {
      if (k[0] === '!') continue;
      const xc = ws[k];
      const { r, c } = XLSX.utils.decode_cell(k);
      const cell = {};
      if (xc.f) cell.f = xc.f.replace(/^_xlfn\./i, '').replace(/_xlfn\./gi, '');
      else if (xc.t === 'n' || xc.t === 's' || xc.t === 'str' || xc.t === 'b') cell.v = xc.v;
      else if (xc.t === 'd') cell.v = (new Date(xc.v).getTime() - Date.UTC(1899, 11, 30)) / 86400000;
      else if (xc.t === 'e') cell.v = xc.w || '#N/A';
      else if (xc.t === 'z') { /* 仅样式 */ }
      const st = {};
      if (xc.z && xc.z !== 'General') st.nf = String(xc.z);
      const sty = xc.s;
      if (sty) {
        const fg = sty.fgColor && sty.fgColor.rgb;
        if (fg && sty.patternType && sty.patternType !== 'none' && fg !== 'FFFFFF') st.bg = '#' + fg.slice(-6);
        if (sty.font) {
          if (sty.font.bold) st.b = true;
          if (sty.font.italic) st.i = true;
          if (sty.font.underline) st.u = true;
          if (sty.font.color && sty.font.color.rgb) st.fc = '#' + sty.font.color.rgb.slice(-6);
          if (sty.font.sz) st.fs = +sty.font.sz;
          if (sty.font.name) st.ff = sty.font.name;
        }
        if (sty.alignment) {
          if (sty.alignment.horizontal) st.ha = sty.alignment.horizontal;
          if (sty.alignment.vertical === 'top') st.va = 'top';
          if (sty.alignment.vertical === 'bottom') st.va = 'bottom';
          if (sty.alignment.wrapText) st.wrap = true;
        }
      }
      if (Object.keys(st).length) cell.s = st;
      if (xc.l && xc.l.Target) cell.link = xc.l.Target;
      if (xc.c && xc.c.length) cell.cm = xc.c.map((cm) => cm.t).join('\n');
      if (Object.keys(cell).length) {
        s.cells[key(r, c)] = cell;
        maxR = Math.max(maxR, r);
        maxC = Math.max(maxC, c);
      }
    }
    for (const m of ws['!merges'] || []) s.merges.push({ r1: m.s.r, c1: m.s.c, r2: m.e.r, c2: m.e.c });
    (ws['!cols'] || []).forEach((col, i) => {
      if (!col) return;
      if (col.hidden) s.hiddenCols[i] = 1;
      const w = col.wpx || (col.wch ? Math.round(col.wch * 7 + 5) : col.width ? Math.round(col.width * 7 + 5) : null);
      if (w) s.colW[i] = w;
    });
    (ws['!rows'] || []).forEach((row, i) => {
      if (!row) return;
      if (row.hidden) s.hiddenRows[i] = 1;
      const hgt = row.hpx || (row.hpt ? Math.round((row.hpt * 4) / 3) : null);
      if (hgt) s.rowH[i] = Math.max(DEFAULT_ROW_H, hgt);
    });
    s.rows = Math.max(200, maxR + 50);
    s.cols = Math.max(26, maxC + 5);
    if (!ws['!cols']) autoWidths(s);
    wb.sheets.push(s);
  }
  if (!wb.sheets.length) wb.sheets.push(newSheet('Sheet1'));
  return { name, content: wb };
}

/** 依据内容粗略设置列宽 */
function autoWidths(s) {
  const widths = {};
  for (const [k, cell] of Object.entries(s.cells)) {
    const [, c] = unkey(k);
    const t = cell.v == null ? '' : String(cell.v);
    let w = 0;
    for (const ch of t.slice(0, 60)) w += ch.charCodeAt(0) > 255 ? 15 : 8;
    widths[c] = Math.max(widths[c] || 0, w + 14);
  }
  for (const [c, w] of Object.entries(widths)) if (w > DEFAULT_COL_W) s.colW[c] = Math.min(320, w);
}

/* ================= 导出 ================= */

export async function exportXLSX(ed, name, bookType = 'xlsx') {
  const XLSX = await import('xlsx');
  if (ed.editing) ed.commitEdit();
  const out = XLSX.utils.book_new();
  ed.wb.sheets.forEach((s, si) => {
    const ws = {};
    const b = ed.engine.bounds[si];
    const write = (r, c, cell) => {
      const v = ed.engine.display(si, r, c);
      const xc = {};
      if (cell && cell.f != null) xc.f = cell.f;
      if (typeof v === 'number') { xc.t = 'n'; xc.v = v; }
      else if (typeof v === 'boolean') { xc.t = 'b'; xc.v = v; }
      else if (isErr(v)) { xc.t = 'e'; xc.v = { '#NULL!': 0, '#DIV/0!': 7, '#VALUE!': 15, '#REF!': 23, '#NAME?': 29, '#NUM!': 36, '#N/A': 42 }[v.code] ?? 15; xc.w = v.code; }
      else if (v == null || v === '') { if (!cell || (!cell.s && !cell.f)) return; xc.t = 's'; xc.v = ''; }
      else { xc.t = 's'; xc.v = String(v); }
      if (cell && cell.s && cell.s.nf) xc.z = cell.s.nf;
      if (cell && cell.link) xc.l = { Target: cell.link };
      if (cell && cell.cm) xc.c = [{ a: '作者', t: cell.cm }];
      ws[XLSX.utils.encode_cell({ r, c })] = xc;
    };
    for (const [k, cell] of Object.entries(s.cells)) { const [r, c] = unkey(k); write(r, c, cell); }
    // 动态数组溢出值作为常量导出
    for (const k of ed.engine.spill[si]?.keys() || []) { const [r, c] = unkey(k); if (!s.cells[k]) write(r, c, null); }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, b.maxR), c: Math.max(0, b.maxC) } });
    if (s.merges.length) ws['!merges'] = s.merges.map((m) => ({ s: { r: m.r1, c: m.c1 }, e: { r: m.r2, c: m.c2 } }));
    const cols = [];
    for (let c = 0; c <= b.maxC; c++) cols.push({ wpx: s.colW[c] ?? DEFAULT_COL_W, hidden: !!s.hiddenCols[c] });
    ws['!cols'] = cols;
    const rows = [];
    for (let r = 0; r <= b.maxR; r++) rows.push(s.rowH[r] != null || s.hiddenRows[r] ? { hpx: s.rowH[r] ?? DEFAULT_ROW_H, hidden: !!s.hiddenRows[r] } : null);
    ws['!rows'] = rows;
    if (s.filter) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: s.filter.r1, c: s.filter.c1 }, e: { r: s.filter.r2, c: s.filter.c2 } }) };
    XLSX.utils.book_append_sheet(out, ws, s.name.slice(0, 31));
  });
  const data = XLSX.write(out, { type: 'array', bookType, compression: true });
  const mime = bookType === 'ods' ? 'application/vnd.oasis.opendocument.spreadsheet' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  download(new Blob([data], { type: mime }), `${name}.${bookType}`);
}

export function exportCSV(ed, name) {
  const s = ed.sheet, si = ed.si;
  const b = ed.engine.bounds[si];
  const lines = [];
  for (let r = 0; r <= b.maxR; r++) {
    const row = [];
    for (let c = 0; c <= b.maxC; c++) {
      const v = ed.engine.display(si, r, c);
      let t = v == null ? '' : formatValue(v, s.cells[key(r, c)]?.s?.nf).text;
      if (/[",\n]/.test(t)) t = '"' + t.replace(/"/g, '""') + '"';
      row.push(t);
    }
    lines.push(row.join(','));
  }
  download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${name}-${s.name}.csv`);
}

export function exportHTML(ed, name) {
  let body = '';
  ed.wb.sheets.forEach((s, si) => {
    const b = ed.engine.bounds[si];
    body += `<h2>${esc(s.name)}</h2>` + sheetToHTML(ed, si, { r1: 0, c1: 0, r2: b.maxR, c2: b.maxC });
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)}</title><style>body{font-family:"Microsoft YaHei",sans-serif;margin:24px}h2{font-size:16px;margin:24px 0 8px}td{border:1px solid #e3e3e3}</style></head><body>${body}</body></html>`;
  download(new Blob([html], { type: 'text/html;charset=utf-8' }), `${name}.html`);
}
