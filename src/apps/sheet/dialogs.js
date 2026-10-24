// 表格对话框：插入函数、查找替换、设置单元格格式、筛选菜单、排序、条件格式、数据验证等
import { h, icon, modal, formBox, toast, popover, showMenu, alertBox, colorPicker, FONT_FAMILIES, FONT_SIZES } from '../../core/ui.js';
import { FUNC_META, CATEGORIES } from './functions.js';
import { NUMBER_FORMATS, formatValue } from './format.js';
import { key, unkey, addr, rangeStr, parseRange, colName, inRange } from './refs.js';
import { CF_STYLES, describeRule } from './cf.js';
import * as cmd from './commands.js';

/* ================= 插入函数 ================= */
export async function insertFunction(ed, presetCat) {
  const cats = ['常用函数', '全部', ...CATEGORIES];
  const COMMON = ['SUM', 'AVERAGE', 'IF', 'COUNT', 'MAX', 'MIN', 'VLOOKUP', 'SUMIF', 'COUNTIF', 'ROUND', 'IFERROR', 'TODAY'];
  const catSel = h('select', { class: 'input', style: 'width:100%' }, cats.map((c) => h('option', { value: c, selected: c === presetCat }, c)));
  const search = h('input', { class: 'input', placeholder: '搜索函数，如 求和、SUM', style: 'width:100%' });
  const list = h('div', { class: 'ss-fn-list' });
  const desc = h('div', { class: 'ss-fn-desc' });
  let chosen = null;
  const render = () => {
    const q = search.value.trim().toUpperCase();
    let items = Object.values(FUNC_META);
    if (q) items = items.filter((f) => f.name.includes(q) || f.desc.includes(search.value.trim()));
    else if (catSel.value === '常用函数') items = COMMON.map((n) => FUNC_META[n]);
    else if (catSel.value !== '全部') items = items.filter((f) => f.cat === catSel.value);
    list.replaceChildren(...items.map((f) => {
      const el = h('div', { class: 'ss-fn-item' + (chosen === f.name ? ' active' : ''), onclick: () => { chosen = f.name; render(); }, ondblclick: () => { chosen = f.name; ok.click(); } }, f.name);
      return el;
    }));
    if (!chosen && items[0]) { chosen = items[0].name; render(); return; }
    const m = FUNC_META[chosen];
    desc.replaceChildren(m ? h('div', null, h('b', null, `${m.name}(${m.sig})`), h('div', { class: 'muted', style: 'margin-top:6px' }, m.desc)) : '');
  };
  catSel.onchange = () => { chosen = null; render(); };
  search.oninput = () => { chosen = null; render(); };
  let ok;
  const res = await modal({
    title: '插入函数', width: 480,
    body: h('div', { class: 'form' }, search, h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, '类别'), catSel), list, desc),
    buttons: [{ label: '取消', value: null }, { label: '确定', primary: true, onClick: () => chosen }],
    onOpen: (dlgEl) => { ok = dlgEl.querySelector('.btn-primary'); render(); },
  });
  if (!res) return;
  if (ed.editing) {
    const el = ed.activeEditEl();
    const p = el.selectionStart;
    const ins = (el.value.startsWith('=') ? '' : '') + res + '(';
    el.value = el.value.slice(0, p) + ins + el.value.slice(el.selectionEnd);
    el.setSelectionRange(p + ins.length, p + ins.length);
    ed.onEditInput(el === ed.fx ? 'bar' : undefined);
    el.focus();
  } else {
    ed.beginEdit('=' + res + '()', 'edit');
    const n = ed.input.value.length - 1;
    ed.input.setSelectionRange(n, n);
    ed.onEditInput();
  }
}

/* ================= 查找替换 ================= */
export function findReplace(ed, replaceMode) {
  if (ed.findPanel) { ed.findPanel.remove(); }
  const findIn = h('input', { class: 'input', placeholder: '查找内容' });
  const replIn = h('input', { class: 'input', placeholder: '替换为' });
  const matchCase = h('input', { type: 'checkbox' });
  const whole = h('input', { type: 'checkbox' });
  const scope = h('select', { class: 'input' }, h('option', { value: 'sheet' }, '工作表'), h('option', { value: 'book' }, '工作簿'));
  const lookIn = h('select', { class: 'input' }, h('option', { value: 'formulas' }, '公式'), h('option', { value: 'values' }, '值'));
  const results = h('div', { class: 'ss-find-results' });
  const replRow = h('div', { class: 'ss-find-row' }, h('label', null, '替换为'), replIn);
  const tabs = h('div', { class: 'ss-find-tabs' });
  const setMode = (rep) => {
    replRow.style.display = rep ? '' : 'none';
    btnRepl.style.display = btnReplAll.style.display = rep ? '' : 'none';
    tabs.querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === (rep ? 1 : 0)));
  };
  tabs.append(h('button', { onclick: () => setMode(false) }, '查找'), h('button', { onclick: () => setMode(true) }, '替换'));

  const matcher = () => {
    let q = findIn.value;
    if (!q) return null;
    const esc = q.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    const re = new RegExp(whole.checked ? '^' + esc + '$' : esc, matchCase.checked ? 'g' : 'gi');
    return re;
  };
  const cellText = (si, r, c, cell) => {
    if (lookIn.value === 'formulas' && cell.f != null) return '=' + cell.f;
    const v = ed.engine.display(si, r, c);
    return v == null ? '' : formatValue(v, cell.s && cell.s.nf).text;
  };
  const findAll = () => {
    const re = matcher();
    if (!re) return [];
    const out = [];
    const sheets = scope.value === 'book' ? ed.wb.sheets.map((_, i) => i) : [ed.si];
    for (const si of sheets) {
      const cells = ed.wb.sheets[si].cells;
      const keys = Object.keys(cells).map(unkey).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const [r, c] of keys) {
        const cell = cells[key(r, c)];
        const t = cellText(si, r, c, cell);
        re.lastIndex = 0;
        if (t && re.test(t)) out.push({ si, r, c, text: t });
      }
    }
    return out;
  };
  const goTo = (m) => {
    if (m.si !== ed.si) ed.switchSheet(m.si);
    ed.select(m.r, m.c);
  };
  const findNext = () => {
    const all = findAll();
    if (!all.length) { toast('找不到正在搜索的数据', 'error'); return null; }
    const { r, c } = ed.sel.active;
    const next = all.find((m) => (m.si === ed.si && (m.r > r || (m.r === r && m.c > c))) || m.si > ed.si) || all[0];
    goTo(next);
    return next;
  };
  const replaceOne = (m) => {
    const cell = ed.cellAt(m.r, m.c, m.si);
    if (!cell) return false;
    const re = matcher();
    const text = cell.f != null ? '=' + cell.f : String(cell.v ?? '');
    const nt = text.replace(re, replIn.value);
    if (nt === text) return false;
    ed.writeInput(m.r, m.c, nt, m.si);
    return true;
  };
  const btnNext = h('button', { class: 'btn btn-sm btn-primary', onclick: () => findNext() }, '查找下一个');
  const btnAll = h('button', { class: 'btn btn-sm', onclick: () => {
    const all = findAll();
    results.replaceChildren(h('div', { class: 'muted' }, `共找到 ${all.length} 个单元格`), ...all.slice(0, 500).map((m) =>
      h('div', { class: 'ss-find-item', onclick: () => goTo(m) }, h('span', null, ed.wb.sheets[m.si].name), h('span', null, addr(m.r, m.c)), h('span', { class: 'ss-find-val' }, m.text))));
  } }, '查找全部');
  const btnRepl = h('button', { class: 'btn btn-sm', onclick: () => {
    const { r, c } = ed.sel.active;
    const re = matcher();
    const cell = ed.cellAt(r, c);
    if (cell && re && re.test(cellText(ed.si, r, c, cell))) {
      ed.change('替换', () => replaceOne({ si: ed.si, r, c }));
    }
    findNext();
  } }, '替换');
  const btnReplAll = h('button', { class: 'btn btn-sm', onclick: () => {
    const all = findAll();
    let n = 0;
    if (all.length) ed.change('全部替换', () => { for (const m of all) if (replaceOne(m)) n++; }, scope.value === 'book' ? 'book' : 'sheet');
    toast(`全部完成，共替换 ${n} 处`, n ? 'success' : 'info');
  } }, '全部替换');
  const close = () => { panel.remove(); ed.findPanel = null; ed.input.focus(); };
  const panel = h('div', { class: 'ss-find' },
    h('div', { class: 'ss-find-head' }, tabs, h('button', { class: 'icon-btn', onclick: close }, icon('x', 15))),
    h('div', { class: 'ss-find-row' }, h('label', null, '查找内容'), findIn),
    replRow,
    h('div', { class: 'ss-find-opts' },
      h('label', null, '范围 ', scope), h('label', null, '查找范围 ', lookIn),
      h('label', null, matchCase, '区分大小写'), h('label', null, whole, '单元格匹配')),
    h('div', { class: 'ss-find-btns' }, btnRepl, btnReplAll, btnAll, btnNext),
    results);
  panel.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') { e.preventDefault(); findNext(); }
  });
  // 拖动
  panel.firstChild.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    const r = panel.getBoundingClientRect(), pr = ed.root.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const mv = (ev) => { panel.style.left = ev.clientX - pr.left - ox + 'px'; panel.style.top = ev.clientY - pr.top - oy + 'px'; panel.style.right = 'auto'; };
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  });
  ed.root.append(panel);
  ed.findPanel = panel;
  setMode(replaceMode);
  const cur = ed.engine.display(ed.si, ed.sel.active.r, ed.sel.active.c);
  if (typeof cur === 'string' && cur.length < 50) findIn.value = cur;
  findIn.focus();
  findIn.select();
}

/* ================= 设置单元格格式 ================= */
export async function formatCells(ed) {
  const { r, c } = ed.sel.active;
  const cell = ed.cellAt(r, c);
  const s = (cell && cell.s) || {};
  const v = ed.engine.display(ed.si, r, c);
  const cur = s.nf || 'General';
  const known = NUMBER_FORMATS.find((f) => f.fmt === cur);
  const fields = [
    { name: 'cat', label: '数字分类', type: 'select', value: known ? known.fmt : 'custom', options: [...NUMBER_FORMATS.map((f) => ({ value: f.fmt, label: f.label })), { value: 'custom', label: '自定义' }] },
    { name: 'code', label: '格式代码', value: cur, placeholder: '如 0.00、#,##0、yyyy-mm-dd、0.0%' },
    { name: 'ha', label: '水平对齐', type: 'select', value: s.ha || 'general', options: [{ value: 'general', label: '常规' }, { value: 'left', label: '靠左' }, { value: 'center', label: '居中' }, { value: 'right', label: '靠右' }, { value: 'centerAcross', label: '跨列居中' }] },
    { name: 'va', label: '垂直对齐', type: 'select', value: s.va || 'middle', options: [{ value: 'top', label: '靠上' }, { value: 'middle', label: '居中' }, { value: 'bottom', label: '靠下' }] },
    { name: 'indent', label: '缩进', type: 'number', value: s.indent || 0, min: 0, max: 15 },
    { name: 'wrap', label: '自动换行', type: 'checkbox', value: !!s.wrap },
    { name: 'ff', label: '字体', type: 'select', value: s.ff || 'Microsoft YaHei', options: FONT_FAMILIES },
    { name: 'fs', label: '字号', type: 'number', value: s.fs || 11, min: 1, max: 409, step: 0.5 },
    { name: 'b', label: '加粗', type: 'checkbox', value: !!s.b },
    { name: 'i', label: '倾斜', type: 'checkbox', value: !!s.i },
    { name: 'u', label: '下划线', type: 'checkbox', value: !!s.u },
    { name: 'st', label: '删除线', type: 'checkbox', value: !!s.st },
    { name: 'fc', label: '字体颜色', type: 'color', value: s.fc || '#000000' },
    { name: 'useBg', label: '填充背景色', type: 'checkbox', value: !!s.bg },
    { name: 'bg', label: '背景颜色', type: 'color', value: s.bg || '#ffff00' },
  ];
  const preview = h('div', { class: 'ss-fmt-preview' });
  const res = await formBox('设置单元格格式', fields, { width: 460 });
  if (!res) return;
  let nf = res.cat === 'custom' ? res.code : res.cat;
  if (res.cat !== 'custom' && res.code !== cur && res.code) nf = res.code;
  const patch = {
    nf: nf === 'General' ? null : nf, ha: res.ha === 'general' ? null : res.ha, va: res.va === 'middle' ? null : res.va,
    indent: res.indent || null, wrap: res.wrap || null, ff: res.ff === 'Microsoft YaHei' ? null : res.ff, fs: res.fs === 11 ? null : res.fs,
    b: res.b || null, i: res.i || null, u: res.u || null, st: res.st || null,
    fc: res.fc && res.fc !== '#000000' ? res.fc : null, bg: res.useBg ? res.bg : null,
  };
  cmd.setStyle(ed, patch, '设置单元格格式');
}

/* ================= 超链接 ================= */
export async function hyperlink(ed) {
  const { r, c } = ed.sel.active;
  const cell = ed.cellAt(r, c);
  const res = await formBox('插入超链接', [
    { name: 'text', label: '要显示的文字', value: cell ? (cell.v ?? '') : '' },
    { name: 'url', label: '地址', value: (cell && cell.link) || 'https://' },
  ]);
  if (!res) return;
  ed.change('超链接', () => {
    const cl = ed.ensureCell(r, c);
    const url = res.url.trim();
    if (url && url !== 'https://') cl.link = url; else delete cl.link;
    if (res.text) { delete cl.f; cl.v = res.text; } else if (cl.link && cl.v == null) cl.v = cl.link;
    ed.cleanCell(r, c);
  });
}

/* ================= 插入/删除单元格 ================= */
export async function insertCellsDialog(ed) {
  const res = await formBox('插入', [{ name: 'm', label: '插入方式', type: 'select', value: 'down', options: [
    { value: 'right', label: '活动单元格右移' }, { value: 'down', label: '活动单元格下移' }, { value: 'row', label: '整行' }, { value: 'col', label: '整列' }] }]);
  if (!res) return;
  if (res.m === 'row') cmd.insertRows(ed, 'above');
  else if (res.m === 'col') cmd.insertCols(ed, 'left');
  else cmd.shiftCells(ed, res.m);
}
export async function deleteCellsDialog(ed) {
  const res = await formBox('删除', [{ name: 'm', label: '删除方式', type: 'select', value: 'up', options: [
    { value: 'left', label: '右侧单元格左移' }, { value: 'up', label: '下方单元格上移' }, { value: 'row', label: '整行' }, { value: 'col', label: '整列' }] }]);
  if (!res) return;
  if (res.m === 'row') cmd.deleteRows(ed);
  else if (res.m === 'col') cmd.deleteCols(ed);
  else cmd.shiftCells(ed, res.m);
}

/* ================= 数据验证下拉 ================= */
export function validationList(ed) {
  const { r, c } = ed.sel.active;
  const dv = ed.validationAt(r, c);
  if (!dv || dv.type !== 'list') return false;
  const items = cmd.listItems(ed, dv);
  const rc = ed.grid.cellRect(r, c);
  const br = ed.grid.scroller.getBoundingClientRect();
  showMenu({ x: br.left + rc.x, y: br.top + rc.y + rc.h }, items.length ? items.map((it) => ({ label: it, onClick: () => ed.change('选择', () => ed.writeInput(r, c, it)) })) : [{ label: '(无选项)', disabled: true }]);
  return true;
}
/** 从同列已有内容中选择（Alt+↓） */
export function pickFromList(ed) {
  const { r, c } = ed.sel.active;
  const set = new Set();
  const b = ed.engine.bounds[ed.si];
  for (let rr = 0; rr <= b.maxR; rr++) { const v = ed.engine.display(ed.si, rr, c); if (typeof v === 'string' && v) set.add(v); }
  const items = [...set].sort().slice(0, 200);
  if (!items.length) return;
  const rc = ed.grid.cellRect(r, c);
  const br = ed.grid.scroller.getBoundingClientRect();
  showMenu({ x: br.left + rc.x, y: br.top + rc.y + rc.h }, items.map((it) => ({ label: it, onClick: () => ed.change('选择', () => ed.writeInput(r, c, it)) })));
}

/* ================= 筛选下拉 ================= */
export function filterMenu(ed, c, point) {
  const f = ed.sheet.filter;
  const end = cmd.filterEnd(ed);
  const cond = f.conds[c];
  // 统计该列的不同值（考虑其他列的筛选）
  const counts = new Map();
  for (let r = f.r1 + 1; r <= end; r++) {
    const hiddenByOthers = Object.entries(f.conds).some(([cc, cd]) => +cc !== c && cd.type !== 'top' && !cmd.condMatch(cd, ed.engine.display(ed.si, r, +cc), cmd.displayText(ed, r, +cc)));
    if (hiddenByOthers) continue;
    const t = cmd.displayText(ed, r, c);
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  const values = [...counts.keys()].sort((a, b) => {
    if (a === '') return 1; if (b === '') return -1;
    const na = Number(a.replace(/,/g, '')), nb = Number(b.replace(/,/g, ''));
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b, 'zh');
  });
  const checked = new Set(cond && cond.type === 'values' ? cond.values : values);
  const search = h('input', { class: 'input', placeholder: '搜索', style: 'width:100%' });
  const listEl = h('div', { class: 'ss-filter-list' });
  const allBox = h('input', { type: 'checkbox' });
  const renderList = () => {
    const q = search.value.trim().toLowerCase();
    const vis = values.filter((v) => !q || v.toLowerCase().includes(q));
    allBox.checked = vis.every((v) => checked.has(v));
    listEl.replaceChildren(...vis.map((v) => {
      const cb = h('input', { type: 'checkbox', checked: checked.has(v), onchange: () => { if (cb.checked) checked.add(v); else checked.delete(v); allBox.checked = vis.every((x) => checked.has(x)); } });
      return h('label', { class: 'ss-filter-item' }, cb, h('span', null, v === '' ? '(空白)' : v), h('span', { class: 'muted' }, '(' + counts.get(v) + ')'));
    }));
  };
  allBox.onchange = () => {
    const q = search.value.trim().toLowerCase();
    values.filter((v) => !q || v.toLowerCase().includes(q)).forEach((v) => (allBox.checked ? checked.add(v) : checked.delete(v)));
    renderList();
  };
  search.oninput = renderList;
  const numeric = values.filter((v) => v !== '').every((v) => !isNaN(Number(v.replace(/[,%¥$]/g, ''))));
  let p;
  const close = () => p.close();
  const sortBtn = (asc) => h('button', { class: 'ss-filter-sort', onclick: () => {
    close();
    ed.sel.active = { r: f.r1, c };
    cmd.sortRange(ed, { r1: f.r1, c1: f.c1, r2: end, c2: f.c2 }, [{ c, asc }], true);
    cmd.reapplyFilter(ed);
  } }, icon(asc ? 'arrow-up-a-z' : 'arrow-down-z-a', 15), asc ? '升序' : '降序');
  const condMenu = (anchor) => {
    const ops = numeric
      ? [['eq', '等于'], ['ne', '不等于'], ['gt', '大于'], ['ge', '大于或等于'], ['lt', '小于'], ['le', '小于或等于'], ['between', '介于'], ['top', '前十项'], ['above', '高于平均值'], ['below', '低于平均值']]
      : [['eq', '等于'], ['ne', '不等于'], ['begins', '开头是'], ['ends', '结尾是'], ['contains', '包含'], ['notContains', '不包含']];
    showMenu(anchor, ops.map(([op, label]) => ({ label, onClick: async () => {
      close();
      if (op === 'above' || op === 'below') { cmd.setFilterCond(ed, c, { type: op }); return; }
      if (op === 'top') {
        const r = await formBox('自动筛选前 10 个', [{ name: 'n', label: '显示最大的', type: 'number', value: 10, min: 1 }]);
        if (r) cmd.setFilterCond(ed, c, { type: 'top', n: r.n });
        return;
      }
      const opts = ops.filter(([o]) => !['between', 'top', 'above', 'below'].includes(o)).map(([value, label]) => ({ value, label }));
      const res = await formBox('自定义自动筛选', [
        { name: 'op', label: '条件 1', type: 'select', value: op === 'between' ? 'ge' : op, options: opts },
        { name: 'a', label: '值 1', value: '' },
        { name: 'join', label: '关系', type: 'select', value: 'and', options: [{ value: 'and', label: '与' }, { value: 'or', label: '或' }] },
        { name: 'op2', label: '条件 2', type: 'select', value: op === 'between' ? 'le' : '', options: [{ value: '', label: '(无)' }, ...opts] },
        { name: 'b', label: '值 2', value: '' },
      ]);
      if (!res) return;
      cmd.setFilterCond(ed, c, { type: 'cond', op: res.op, a: res.a, join: res.join, op2: res.op2 || null, b: res.b });
    } })));
  };
  const content = h('div', { class: 'ss-filter' },
    h('div', { class: 'ss-filter-sorts' }, sortBtn(true), sortBtn(false)),
    h('button', { class: 'ss-filter-cond', onclick: (e) => condMenu(e.currentTarget) }, icon('funnel', 14), numeric ? '数字筛选' : '文本筛选', icon('chevron-right', 12)),
    cond ? h('button', { class: 'ss-filter-cond', onclick: () => { close(); cmd.setFilterCond(ed, c, null); } }, icon('funnel-x', 14), '清空条件') : null,
    search,
    h('label', { class: 'ss-filter-item ss-filter-all' }, allBox, '(全选)'),
    listEl,
    h('div', { class: 'ss-filter-btns' },
      h('button', { class: 'btn btn-sm', onclick: close }, '取消'),
      h('button', { class: 'btn btn-sm btn-primary', onclick: () => {
        close();
        if (values.every((v) => checked.has(v))) cmd.setFilterCond(ed, c, null);
        else cmd.setFilterCond(ed, c, { type: 'values', values: [...checked] });
      } }, '确定')));
  renderList();
  p = popover(point, content);
  search.focus();
}

/* ================= 自定义排序 ================= */
export async function sortDialog(ed) {
  const rg = cmd.sortTarget(ed);
  const header = cmd.guessHeader(ed, rg);
  const colOpts = (hdr) => {
    const out = [];
    for (let c = rg.c1; c <= rg.c2; c++) out.push({ value: c, label: hdr ? (cmd.displayText(ed, rg.r1, c) || '列 ' + colName(c)) : '列 ' + colName(c) });
    return out;
  };
  const opts = colOpts(header);
  const res = await formBox('排序 - ' + rangeStr(rg), [
    { name: 'header', label: '数据包含标题', type: 'checkbox', value: header },
    { name: 'k1', label: '主要关键字', type: 'select', value: ed.sel.active.c, options: opts },
    { name: 'o1', label: '次序', type: 'select', value: 'asc', options: [{ value: 'asc', label: '升序' }, { value: 'desc', label: '降序' }] },
    { name: 'k2', label: '次要关键字', type: 'select', value: '', options: [{ value: '', label: '(无)' }, ...opts] },
    { name: 'o2', label: '次序', type: 'select', value: 'asc', options: [{ value: 'asc', label: '升序' }, { value: 'desc', label: '降序' }] },
    { name: 'k3', label: '第三关键字', type: 'select', value: '', options: [{ value: '', label: '(无)' }, ...opts] },
    { name: 'o3', label: '次序', type: 'select', value: 'asc', options: [{ value: 'asc', label: '升序' }, { value: 'desc', label: '降序' }] },
  ], { width: 440 });
  if (!res) return;
  const keys = [];
  for (const i of [1, 2, 3]) if (res['k' + i] !== '') keys.push({ c: +res['k' + i], asc: res['o' + i] === 'asc' });
  cmd.sortRange(ed, rg, keys, res.header);
}

/* ================= 条件格式 ================= */
function styleOptions() { return CF_STYLES.map((s, i) => ({ value: i, label: s.label })); }
function selRange(ed) {
  const rg = ed.range;
  return rg.r2 - rg.r1 > 5000 ? ed.usedPart(rg) : { ...rg };
}
export async function cfRule(ed, type, op) {
  const range = selRange(ed);
  let rule = { id: Date.now().toString(36), range, type };
  const opLabel = { gt: '大于', lt: '小于', between: '介于', eq: '等于', ge: '大于或等于', le: '小于或等于', ne: '不等于' };
  if (type === 'cell') {
    const fields = [{ name: 'a', label: `为${opLabel[op]}以下值的单元格设置格式`, value: '' }];
    if (op === 'between') fields.push({ name: 'b', label: '到', value: '' });
    fields.push({ name: 'st', label: '设置为', type: 'select', value: 0, options: styleOptions() });
    const res = await formBox(opLabel[op], fields);
    if (!res) return;
    rule = { ...rule, op, a: res.a, b: res.b, style: CF_STYLES[res.st].s };
  } else if (type === 'text') {
    const res = await formBox('文本中包含', [{ name: 'a', label: '为包含以下文本的单元格设置格式', value: '' }, { name: 'st', label: '设置为', type: 'select', value: 0, options: styleOptions() }]);
    if (!res) return;
    rule = { ...rule, a: res.a, style: CF_STYLES[res.st].s };
  } else if (type === 'dup' || type === 'unique' || type === 'above' || type === 'below' || type === 'blank') {
    const res = await formBox({ dup: '重复值', unique: '唯一值', above: '高于平均值', below: '低于平均值', blank: '空值' }[type], [{ name: 'st', label: '设置为', type: 'select', value: 0, options: styleOptions() }]);
    if (!res) return;
    rule.style = CF_STYLES[res.st].s;
  } else if (type === 'top' || type === 'bottom') {
    const res = await formBox(type === 'top' ? '前 10 项' : '最后 10 项', [{ name: 'n', label: '项数', type: 'number', value: 10, min: 1 }, { name: 'percent', label: '按百分比', type: 'checkbox', value: false }, { name: 'st', label: '设置为', type: 'select', value: 0, options: styleOptions() }]);
    if (!res) return;
    rule = { ...rule, n: res.n, percent: res.percent, style: CF_STYLES[res.st].s };
  } else if (type === 'formula') {
    const res = await formBox('使用公式确定要设置格式的单元格', [{ name: 'f', label: '公式', value: '=' + addr(range.r1, range.c1) + '>0' }, { name: 'st', label: '设置为', type: 'select', value: 0, options: styleOptions() }]);
    if (!res) return;
    rule = { ...rule, f: res.f, style: CF_STYLES[res.st].s };
  } else if (type === 'bar') {
    rule.color = op || '#638ec6';
  } else if (type === 'scale2' || type === 'scale3') {
    rule.colors = op;
  }
  ed.change('条件格式', () => { ed.sheet.cf.push(rule); });
}
export function clearCF(ed, scope) {
  ed.change('清除规则', () => {
    if (scope === 'sheet') ed.sheet.cf = [];
    else ed.sheet.cf = ed.sheet.cf.filter((rule) => !ed.sel.ranges.some((rg) => rule.range.r1 >= rg.r1 && rule.range.r2 <= rg.r2 && rule.range.c1 >= rg.c1 && rule.range.c2 <= rg.c2) && !ed.sel.ranges.some((rg) => rg.r1 === rule.range.r1 && rg.c1 === rule.range.c1));
  });
}
export async function manageCF(ed) {
  const list = h('div', { class: 'ss-cf-list' });
  const render = () => {
    list.replaceChildren(...(ed.sheet.cf.length ? ed.sheet.cf.map((rule, i) => h('div', { class: 'ss-cf-item' },
      h('span', { class: 'ss-cf-swatch', style: { background: rule.style?.bg || rule.color || (rule.colors ? `linear-gradient(90deg, ${rule.colors.join(',')})` : '#fff'), color: rule.style?.fc || '#000' } }, 'Aa'),
      h('span', { class: 'ss-cf-desc' }, describeRule(rule)),
      h('span', { class: 'muted' }, rangeStr(rule.range)),
      h('button', { class: 'icon-btn', title: '删除规则', onclick: () => { ed.change('删除规则', () => ed.sheet.cf.splice(i, 1)); render(); } }, icon('trash-2', 14))))
      : [h('div', { class: 'muted' }, '此工作表没有条件格式规则')]));
  };
  render();
  await modal({ title: '条件格式规则管理器', width: 520, body: list, buttons: [{ label: '关闭', primary: true }] });
}

/* ================= 数据验证 ================= */
export async function validationDialog(ed) {
  const rg = selRange(ed);
  const cur = ed.validationAt(ed.sel.active.r, ed.sel.active.c) || {};
  const res = await formBox('数据有效性 - ' + rangeStr(rg), [
    { name: 'type', label: '允许', type: 'select', value: cur.type || 'list', options: [
      { value: 'any', label: '任何值' }, { value: 'whole', label: '整数' }, { value: 'decimal', label: '小数' }, { value: 'list', label: '序列' }, { value: 'date', label: '日期' }, { value: 'length', label: '文本长度' }] },
    { name: 'op', label: '数据', type: 'select', value: cur.op || 'between', options: [
      { value: 'between', label: '介于' }, { value: 'notBetween', label: '未介于' }, { value: 'eq', label: '等于' }, { value: 'ne', label: '不等于' },
      { value: 'gt', label: '大于' }, { value: 'lt', label: '小于' }, { value: 'ge', label: '大于或等于' }, { value: 'le', label: '小于或等于' }] },
    { name: 'a', label: '最小值', value: cur.a ?? '' },
    { name: 'b', label: '最大值', value: cur.b ?? '' },
    { name: 'list', label: '来源(序列)', value: cur.list || '', placeholder: '用逗号分隔，如 男,女；或 =$A$1:$A$5' },
    { name: 'dropdown', label: '提供下拉箭头', type: 'checkbox', value: cur.dropdown !== false },
    { name: 'msg', label: '出错提示', value: cur.msg || '' },
  ], { width: 460 });
  if (!res) return;
  ed.change('数据有效性', () => {
    const s = ed.sheet;
    s.dv = (s.dv || []).filter((d) => !(d.range.r1 >= rg.r1 && d.range.r2 <= rg.r2 && d.range.c1 >= rg.c1 && d.range.c2 <= rg.c2));
    if (res.type !== 'any') s.dv.push({ range: rg, type: res.type, op: res.op, a: res.a, b: res.b, list: res.list, dropdown: res.dropdown, msg: res.msg });
  });
}
export function clearValidation(ed) {
  ed.change('清除验证', () => { ed.sheet.dv = (ed.sheet.dv || []).filter((d) => !ed.sel.ranges.some((rg) => d.range.r1 >= rg.r1 && d.range.r2 <= rg.r2 && d.range.c1 >= rg.c1 && d.range.c2 <= rg.c2)); });
}

/* ================= 页面设置 ================= */
export async function pageSetup(ed) {
  const p = ed.sheet.page || {};
  const res = await formBox('页面设置', [
    { name: 'size', label: '纸张大小', type: 'select', value: p.size || 'A4', options: ['A4', 'A3', 'A5', 'B5', 'Letter', 'Legal'] },
    { name: 'landscape', label: '横向', type: 'checkbox', value: !!p.landscape },
    { name: 'margin', label: '页边距(mm)', type: 'number', value: p.margin ?? 12, min: 0, max: 50 },
    { name: 'gridlines', label: '打印网格线', type: 'checkbox', value: !!p.gridlines },
    { name: 'title', label: '打印工作表名称', type: 'checkbox', value: p.title !== false },
  ]);
  if (!res) return;
  ed.change('页面设置', () => { ed.sheet.page = res; });
}
