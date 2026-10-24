// 表格编辑器主控：状态、选区、单元格编辑、撤销重做、剪贴板、键盘鼠标交互
import { h, icon, toast, alertBox, contextMenu, showMenu, popover, zoomControl, debounce } from '../../core/ui.js';
import { Grid } from './grid.js';
import { Engine } from './engine.js';
import { normalizeWorkbook, DEFAULT_FONT, DEFAULT_FS } from './model.js';
import { key, unkey, addr, rangeStr, parseRange, norm, colName, colIndex as colIndexOf, inRange, quoteSheet, MAX_ROWS, MAX_COLS } from './refs.js';
import { parseInput, valueToEditText, formatValue, isErr, isDateFormat } from './format.js';
import { tokenize, listRefs, shiftFormula } from './formula.js';
import { FUNC_META } from './functions.js';
import * as cmd from './commands.js';
import * as dlg from './dialogs.js';
import { ObjectLayer } from './objects.js';
import { buildRibbon } from './ribbon.js';

export class SheetEditor {
  constructor(root, file, ctx) {
    this.root = root;
    root.__sheetEditor = this; // 便于调试
    this.file = file;
    this.ctx = ctx;
    this.wb = normalizeWorkbook(structuredClone(file.content));
    this.engine = new Engine(this.wb);
    this.si = this.wb.active;
    this.sel = { ranges: [{ r1: 0, c1: 0, r2: 0, c2: 0 }], active: { r: 0, c: 0 }, anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } };
    this.undoStack = [];
    this.redoStack = [];
    this.layoutVer = 0;
    this.editing = null;
    this.editRefs = null;
    this.clip = null;
    this.showFormulas = false;
    this.painter = null;
    this.buildMergeIndex();
    this.buildDOM();
    this.bindEvents();
    this.renderTabs();
    this.objects.render();
    this.select(0, 0, { scroll: false });
  }

  get sheet() { return this.wb.sheets[this.si]; }
  get zoom() { return this.wb.zoom || 100; }

  /* ================= DOM ================= */
  buildDOM() {
    this.ribbon = buildRibbon(this);
    this.nameBox = h('input', { class: 'ss-namebox', spellcheck: false });
    this.fx = h('textarea', { class: 'ss-fx', rows: 1, spellcheck: false });
    this.fxExpand = h('button', { class: 'ss-fx-expand', title: '展开/收起编辑栏', onclick: () => this.fbar.classList.toggle('expanded') }, icon('chevron-down', 14));
    this.fbar = h('div', { class: 'ss-fbar' },
      this.nameBox,
      h('div', { class: 'ss-fbar-btns' },
        h('button', { class: 'ss-fbtn', title: '取消', onmousedown: (e) => e.preventDefault(), onclick: () => this.cancelEdit() }, icon('x', 14)),
        h('button', { class: 'ss-fbtn', title: '输入', onmousedown: (e) => e.preventDefault(), onclick: () => this.commitEdit() }, icon('check', 14)),
        h('button', { class: 'ss-fbtn ss-fbtn-fx', title: '插入函数', onmousedown: (e) => e.preventDefault(), onclick: () => dlg.insertFunction(this) }, h('i', null, 'fx'))),
      this.fx, this.fxExpand);
    this.input = h('textarea', { class: 'ss-input', spellcheck: false, autocomplete: 'off', wrap: 'off' });
    this.tip = h('div', { class: 'ss-tip' });
    this.gridWrap = h('div', { class: 'ss-gridwrap' });
    this.grid = new Grid(this, this.gridWrap);
    this.gridWrap.append(this.input, this.tip);
    this.objects = new ObjectLayer(this);
    this.tabsEl = h('div', { class: 'ss-tablist' });
    this.tabsBar = h('div', { class: 'ss-tabs' },
      h('button', { class: 'ss-tabnav', title: '第一个工作表', onclick: () => this.tabsEl.scrollTo({ left: 0, behavior: 'smooth' }) }, icon('chevrons-left', 14)),
      h('button', { class: 'ss-tabnav', title: '上一个工作表', onclick: () => this.switchSheet(Math.max(0, this.si - 1)) }, icon('chevron-left', 14)),
      h('button', { class: 'ss-tabnav', title: '下一个工作表', onclick: () => this.switchSheet(Math.min(this.wb.sheets.length - 1, this.si + 1)) }, icon('chevron-right', 14)),
      h('button', { class: 'ss-tabnav', title: '最后一个工作表', onclick: () => this.tabsEl.scrollTo({ left: 1e6, behavior: 'smooth' }) }, icon('chevrons-right', 14)),
      this.tabsEl,
      h('button', { class: 'ss-tabadd', title: '新建工作表', onclick: () => cmd.addSheet(this) }, icon('plus', 15)));
    this.statSpan = h('span', { class: 'ss-stats' });
    this.modeSpan = h('span', null, '就绪');
    this.zoomCtl = zoomControl(this.zoom, (z) => this.setZoom(z), { min: 25, max: 400 });
    this.status = h('div', { class: 'statusbar' }, this.modeSpan, h('div', { class: 'sb-spacer' }), this.statSpan, this.zoomCtl.el);
    this.body = h('div', { class: 'app-body ss-body' }, this.gridWrap);
    this.root.classList.add('ss-root');
    this.root.append(this.ribbon.el, this.fbar, this.body, this.tabsBar, this.status);
    this.applyViewToggles();
  }

  applyViewToggles() {
    this.fbar.style.display = this.hideFormulaBar ? 'none' : '';
  }

  /* ================= 生命周期 ================= */
  onShow() {
    this.grid.geoKey = '';
    this.grid.draw();
    this.grid.positionObjects();
    this.objects.render();
    this.focusGrid();
  }
  focusGrid() {
    if (!this.root.classList.contains('active')) return;
    if (document.activeElement !== this.input && !this.editing) this.input.focus({ preventScroll: true });
    this.positionInput();
  }
  destroy() {
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('keydown', this.onDocKey);
    clearInterval(this.marchTimer);
    this.objects.destroy();
    this.ro && this.ro.disconnect();
  }

  getContent() {
    if (this.editing) this.commitEdit();
    this.wb.active = this.si;
    return JSON.parse(JSON.stringify(this.wb));
  }

  /* ================= 合并单元格索引 ================= */
  buildMergeIndex() {
    this.mergeIdx = new Map();
    for (const m of this.sheet.merges) {
      if ((m.r2 - m.r1 + 1) * (m.c2 - m.c1 + 1) > 200000) continue;
      for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) this.mergeIdx.set(key(r, c), m);
    }
  }
  mergeAt(r, c) { return this.mergeIdx.get(key(r, c)); }
  /** 将区域扩展到完整覆盖相交的合并单元格 */
  expandMerges(rg) {
    let changed = true;
    rg = { ...rg };
    while (changed) {
      changed = false;
      for (const m of this.sheet.merges) {
        if (m.r2 >= rg.r1 && m.r1 <= rg.r2 && m.c2 >= rg.c1 && m.c1 <= rg.c2) {
          if (m.r1 < rg.r1) { rg.r1 = m.r1; changed = true; }
          if (m.c1 < rg.c1) { rg.c1 = m.c1; changed = true; }
          if (m.r2 > rg.r2) { rg.r2 = m.r2; changed = true; }
          if (m.c2 > rg.c2) { rg.c2 = m.c2; changed = true; }
        }
      }
    }
    return rg;
  }
  activeRect() {
    const { r, c } = this.sel.active;
    const m = this.mergeAt(r, c);
    return m ? { ...m } : { r1: r, c1: c, r2: r, c2: c };
  }
  validationAt(r, c) {
    return this.sheet.dv && this.sheet.dv.find((d) => inRange(d.range, r, c));
  }

  /* ================= 变更与撤销 ================= */
  snapshot(scope, si = this.si) {
    return scope === 'book' ? JSON.stringify({ sheets: this.wb.sheets, active: this.si }) : JSON.stringify(this.wb.sheets[si]);
  }
  /** 执行一次可撤销的修改 */
  change(label, fn, scope = 'sheet') {
    if (this.editing && label !== '编辑') this.commitEdit();
    const data = this.snapshot(scope);
    const sel = structuredClone(this.sel);
    let res;
    try { res = fn(); }
    catch (e) { console.error(e); toast('操作失败：' + e.message, 'error'); }
    if (res === false) return res;
    this.undoStack.push({ label, scope, si: this.si, data, sel });
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.afterChange();
    return res;
  }
  afterChange({ dirty = true } = {}) {
    this.engine.recalc();
    this.layoutVer++;
    this.buildMergeIndex();
    this.grid.geometry();
    this.grid.invalidate();
    this.objects.render();
    this.updateUI();
    if (dirty) this.ctx.markDirty();
  }
  restore(entry, stackTo) {
    const cur = { label: entry.label, scope: entry.scope, si: entry.scope === 'book' ? this.si : entry.si, data: this.snapshot(entry.scope, entry.si), sel: structuredClone(this.sel) };
    stackTo.push(cur);
    if (entry.scope === 'book') {
      const o = JSON.parse(entry.data);
      this.wb.sheets = o.sheets;
      this.si = Math.min(o.active, o.sheets.length - 1);
    } else {
      this.wb.sheets[entry.si] = JSON.parse(entry.data);
      this.si = entry.si;
    }
    this.sel = entry.sel;
    this.renderTabs();
    this.afterChange();
    this.grid.ensureVisible(this.sel.active.r, this.sel.active.c);
  }
  undo() {
    if (this.editing) { this.cancelEdit(); return; }
    const e = this.undoStack.pop();
    if (!e) return;
    this.restore(e, this.redoStack);
  }
  redo() {
    const e = this.redoStack.pop();
    if (!e) return;
    this.restore(e, this.undoStack);
  }

  /* ================= 选区 ================= */
  get range() { return this.sel.ranges[this.sel.ranges.length - 1]; }

  select(r, c, { extend = false, add = false, scroll = true } = {}) {
    const s = this.sheet;
    r = Math.max(0, Math.min(r, MAX_ROWS - 1));
    c = Math.max(0, Math.min(c, MAX_COLS - 1));
    if (r >= s.rows) { s.rows = Math.min(MAX_ROWS, r + 50); this.layoutVer++; }
    if (c >= s.cols) { s.cols = Math.min(MAX_COLS, c + 5); this.layoutVer++; }
    this.grid.geometry();
    if (extend) {
      const a = this.sel.anchor;
      const rg = this.expandMerges(norm({ r1: a.r, c1: a.c, r2: r, c2: c }));
      this.sel.ranges[this.sel.ranges.length - 1] = rg;
      this.sel.focus = { r, c };
    } else {
      const m = this.mergeAt(r, c);
      const rg = m ? { ...m } : { r1: r, c1: c, r2: r, c2: c };
      if (m) { r = m.r1; c = m.c1; }
      if (add) this.sel.ranges.push(rg);
      else this.sel.ranges = [rg];
      this.sel.active = { r, c };
      this.sel.anchor = { r, c };
      this.sel.focus = { r, c };
    }
    if (scroll) this.grid.ensureVisible(extend ? r : this.sel.active.r, extend ? c : this.sel.active.c);
    this.onSelectionChange();
  }
  selectRange(rg, { active } = {}) {
    rg = norm(rg);
    this.sel.ranges = [this.expandMerges(rg)];
    this.sel.active = active || { r: rg.r1, c: rg.c1 };
    this.sel.anchor = { ...this.sel.active };
    this.sel.focus = { r: rg.r2, c: rg.c2 };
    this.grid.ensureVisible(this.sel.active.r, this.sel.active.c);
    this.onSelectionChange();
  }
  selectAll() {
    const s = this.sheet;
    this.sel.ranges = [{ r1: 0, c1: 0, r2: s.rows - 1, c2: s.cols - 1 }];
    this.sel.anchor = { r: 0, c: 0 };
    this.sel.focus = { r: s.rows - 1, c: s.cols - 1 };
    this.onSelectionChange();
  }
  onSelectionChange() {
    this.grid.invalidate();
    this.updateUI();
    if (this.painter && !this.dragging) {}
  }
  /** 当前选区中数据部分（裁剪到已用区域） */
  usedPart(rg) {
    const b = this.engine.bounds[this.si];
    return { r1: rg.r1, c1: rg.c1, r2: Math.min(rg.r2, Math.max(b.maxR, rg.r1)), c2: Math.min(rg.c2, Math.max(b.maxC, rg.c1)) };
  }
  forEachSelected(fn, { used = true } = {}) {
    for (const rg0 of this.sel.ranges) {
      const rg = used ? this.usedPartForStyle(rg0) : rg0;
      for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) fn(r, c);
    }
  }
  /** 整行/整列选择时，样式只作用到已用区域 + 少量余量，避免产生海量单元格 */
  usedPartForStyle(rg) {
    const b = this.engine.bounds[this.si];
    const s = this.sheet;
    let { r1, c1, r2, c2 } = rg;
    if (r2 - r1 > 2000) r2 = Math.max(r1, Math.min(r2, Math.max(b.maxR + 50, s.rows - 1 < 2000 ? s.rows - 1 : b.maxR + 50)));
    if (c2 - c1 > 200) c2 = Math.max(c1, Math.min(c2, Math.max(b.maxC + 10, 25)));
    return { r1, c1, r2, c2 };
  }

  /* ================= 单元格读写 ================= */
  cellAt(r, c, si = this.si) { return this.wb.sheets[si].cells[key(r, c)]; }
  ensureCell(r, c, si = this.si) {
    const cells = this.wb.sheets[si].cells, k = key(r, c);
    return cells[k] || (cells[k] = {});
  }
  cleanCell(r, c, si = this.si) {
    const cells = this.wb.sheets[si].cells, k = key(r, c);
    const cell = cells[k];
    if (!cell) return;
    if (cell.s && !Object.keys(cell.s).length) delete cell.s;
    if (cell.v == null && cell.f == null && !cell.s && !cell.cm && !cell.link) delete cells[k];
  }
  /** 用户输入文本写入单元格（不含撤销包装） */
  writeInput(r, c, text, si = this.si) {
    const cell = this.ensureCell(r, c, si);
    const isText = cell.s && cell.s.nf === '@';
    delete cell.forceText;
    if (text === '' || text == null) {
      delete cell.v; delete cell.f;
    } else if (isText) {
      delete cell.f; cell.v = String(text);
    } else {
      const p = parseInput(String(text));
      if (p.f != null) {
        delete cell.v;
        cell.f = normalizeFormula(p.f);
        // 日期类公式自动套用日期格式（与 Excel 一致）
        if (!(cell.s && cell.s.nf)) {
          let nf = null;
          if (/^(TODAY|DATE|EDATE|EOMONTH|WORKDAY|DATEVALUE)\(/.test(cell.f)) nf = 'yyyy/m/d';
          else if (/^NOW\(/.test(cell.f)) nf = 'yyyy/m/d h:mm';
          else if (/^TIME\(/.test(cell.f)) nf = 'h:mm';
          else {
            const m = cell.f.match(/^\$?([A-Z]{1,3})\$?(\d+)\s*[+-]/);
            if (m) {
              const src = this.cellAt(+m[2] - 1, colIndexOf(m[1]), si);
              if (src && src.s && src.s.nf && isDateFormat(src.s.nf)) nf = src.s.nf;
            }
          }
          if (nf) (cell.s || (cell.s = {})).nf = nf;
        }
      } else {
        delete cell.f;
        cell.v = p.v;
        if (p.forceText) cell.forceText = true;
        if (p.nf && !(cell.s && cell.s.nf && cell.s.nf !== 'General')) (cell.s || (cell.s = {})).nf = p.nf;
        if (typeof p.v === 'string' && /^https?:\/\/\S+$/i.test(p.v)) cell.link = p.v;
      }
      if (typeof text === 'string' && text.includes('\n') && !(cell.s && cell.s.wrap)) (cell.s || (cell.s = {})).wrap = true;
    }
    this.cleanCell(r, c, si);
  }

  /* ================= 单元格编辑 ================= */
  beginEdit(text, mode = 'edit', { fromBar = false, keepValue = false } = {}) {
    if (this.editing) return;
    const { r, c } = this.sel.active;
    const cell = this.cellAt(r, c);
    if (text == null) text = valueToEditText(cell);
    this.editing = { si: this.si, r, c, mode, fromBar };
    if (!keepValue) this.input.value = text;
    this.fx.value = this.input.value;
    this.input.classList.add('editing');
    this.modeSpan.textContent = mode === 'enter' ? '输入' : '编辑';
    this.styleInput();
    this.positionInput();
    if (!fromBar) {
      this.input.focus({ preventScroll: true });
      const n = this.input.value.length;
      this.input.setSelectionRange(n, n);
    }
    this.onEditInput();
  }
  /** 编辑框字体与单元格一致 */
  styleInput() {
    const ed = this.editing;
    const cell = ed && this.cellAt(ed.r, ed.c, ed.si);
    const st = (cell && cell.s) || {};
    const z = this.zoom / 100;
    Object.assign(this.input.style, {
      fontFamily: `"${st.ff || DEFAULT_FONT}", "Microsoft YaHei", sans-serif`,
      fontSize: ((st.fs || DEFAULT_FS) * 4 / 3 * z).toFixed(1) + 'px',
      fontWeight: st.b ? 'bold' : 'normal',
      fontStyle: st.i ? 'italic' : 'normal',
      color: st.fc || '#1f2329',
      background: st.bg || '#fff',
      textAlign: st.ha === 'right' ? 'right' : st.ha === 'center' ? 'center' : 'left',
    });
  }
  positionInput() {
    const ed = this.editing;
    if (ed && ed.si !== this.si) { this.input.style.visibility = 'hidden'; return; }
    this.input.style.visibility = '';
    const { r, c } = ed || this.sel.active;
    const rc = this.grid.cellRect(r, c);
    const st = this.input.style;
    st.left = rc.x + 'px';
    st.top = rc.y + 'px';
    if (!ed) { st.width = Math.max(4, rc.w) + 'px'; st.height = rc.h + 'px'; return; }
    st.minWidth = rc.w + 1 + 'px';
    st.minHeight = rc.h + 1 + 'px';
    // 根据内容自动增长
    st.width = rc.w + 1 + 'px';
    st.height = rc.h + 1 + 'px';
    const maxW = Math.max(rc.w, this.grid.W - rc.x - 4);
    const ctx = this.grid.ctx;
    ctx.font = `${st.fontStyle} ${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;
    const tw = Math.max(...this.input.value.split('\n').map((l) => ctx.measureText(l).width)) + 14;
    const sw = Math.min(maxW, tw);
    if (sw > rc.w) st.width = sw + 'px';
    if (this.input.scrollHeight > rc.h) st.height = this.input.scrollHeight + 'px';
  }
  onEditInput(from) {
    if (!this.editing) return;
    if (from === 'bar') this.input.value = this.fx.value;
    else this.fx.value = this.input.value;
    const text = this.input.value;
    if (text.startsWith('=')) {
      this.editRefs = listRefs(text.slice(1)).map((x) => {
        const si = x.sheet == null ? this.editing.si : this.engine.sheetIndex(x.sheet);
        const a = x.ref.a, b = x.ref.b || a;
        if (x.ref.kind === 'cols') return { si, r1: 0, r2: this.sheet.rows - 1, c1: Math.min(a.c, b.c), c2: Math.max(a.c, b.c) };
        if (x.ref.kind === 'rows') return { si, c1: 0, c2: this.sheet.cols - 1, r1: Math.min(a.r, b.r), r2: Math.max(a.r, b.r) };
        return { si, r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
      });
    } else this.editRefs = null;
    this.positionInput();
    this.grid.invalidate();
    this.updateAutocomplete(from === 'bar' ? this.fx : this.input);
  }
  /** 当前光标处可以插入引用吗（公式编辑的"点选"模式） */
  canPickRef() {
    if (!this.editing) return false;
    const el = this.activeEditEl();
    const text = el.value;
    if (!text.startsWith('=')) return false;
    if (this.pick && this.pick.end === el.selectionStart) return true;
    const before = text.slice(0, el.selectionStart).trimEnd();
    return /[=(,+\-*/^&<>:;]$/.test(before);
  }
  activeEditEl() { return document.activeElement === this.fx ? this.fx : this.input; }
  insertRefText(rg, si) {
    const el = this.activeEditEl();
    let refText = rangeStr(rg);
    if (si !== this.editing.si) refText = quoteSheet(this.wb.sheets[si].name) + '!' + refText;
    const text = el.value;
    let start = el.selectionStart, end = el.selectionEnd;
    if (this.pick && this.pick.end === start) start = this.pick.start;
    el.value = text.slice(0, start) + refText + text.slice(end);
    const caret = start + refText.length;
    el.setSelectionRange(caret, caret);
    this.pick = { start, end: caret };
    this.onEditInput(el === this.fx ? 'bar' : undefined);
  }
  commitEdit(move) {
    const ed = this.editing;
    if (!ed) return true;
    let text = this.input.value;
    // 数据验证
    const dv = this.wb.sheets[ed.si].dv?.find((d) => inRange(d.range, ed.r, ed.c));
    if (dv && text !== '') {
      const ok = cmd.validateInput(this, dv, text);
      if (!ok) {
        alertBox(dv.msg || '输入值非法。其他用户已经限定了可以输入该单元格的数值。', '数据验证');
        return false;
      }
    }
    this.hideAutocomplete();
    const prevSi = this.si;
    this.editing = null;
    this.editRefs = null;
    this.pick = null;
    this.input.classList.remove('editing');
    this.modeSpan.textContent = '就绪';
    if (ed.si !== this.si) this.switchSheet(ed.si, { keepEdit: true });
    const old = valueToEditText(this.cellAt(ed.r, ed.c));
    if (text !== old || this.ctrlEnter) {
      const targets = this.ctrlEnter ? this.sel.ranges : [{ r1: ed.r, c1: ed.c, r2: ed.r, c2: ed.c }];
      this.change('编辑', () => {
        for (const rg of targets) {
          const ur = this.usedPartForStyle(rg);
          for (let r = ur.r1; r <= ur.r2; r++) for (let c = ur.c1; c <= ur.c2; c++) {
            if (this.mergeAt(r, c) && (this.mergeAt(r, c).r1 !== r || this.mergeAt(r, c).c1 !== c)) continue;
            const t = text.startsWith('=') ? '=' + shiftFormula(text.slice(1), r - ed.r, c - ed.c) : text;
            this.writeInput(r, c, t);
          }
        }
      });
    }
    this.ctrlEnter = false;
    this.input.value = '';
    if (move) this.moveAfterEnter(move);
    this.positionInput();
    this.grid.invalidate();
    this.updateUI();
    this.input.focus({ preventScroll: true });
    return true;
  }
  cancelEdit() {
    const ed = this.editing;
    if (!ed) return;
    this.hideAutocomplete();
    this.editing = null;
    this.editRefs = null;
    this.pick = null;
    this.input.value = '';
    this.input.classList.remove('editing');
    this.modeSpan.textContent = '就绪';
    if (ed.si !== this.si) this.switchSheet(ed.si);
    this.positionInput();
    this.grid.invalidate();
    this.updateUI();
    this.input.focus({ preventScroll: true });
  }
  moveAfterEnter(dir) {
    if (dir === 'down' && this.tabAnchorCol != null) {
      // Tab 连续录入后回车：回到起始列的下一行
      const c0 = this.tabAnchorCol;
      this.tabAnchorCol = null;
      this.select(this.sel.active.r + 1, c0);
      return;
    }
    if (dir !== 'right') this.tabAnchorCol = null;
    const rg = this.range;
    const multi = this.sel.ranges.length === 1 && (rg.r1 !== rg.r2 || rg.c1 !== rg.c2);
    const { r, c } = this.sel.active;
    if (multi) {
      // 在选区内循环移动
      let nr = r, nc = c;
      if (dir === 'down') { nr++; if (nr > rg.r2) { nr = rg.r1; nc++; if (nc > rg.c2) nc = rg.c1; } }
      else if (dir === 'up') { nr--; if (nr < rg.r1) { nr = rg.r2; nc--; if (nc < rg.c1) nc = rg.c2; } }
      else if (dir === 'right') { nc++; if (nc > rg.c2) { nc = rg.c1; nr++; if (nr > rg.r2) nr = rg.r1; } }
      else if (dir === 'left') { nc--; if (nc < rg.c1) { nc = rg.c2; nr--; if (nr < rg.r1) nr = rg.r2; } }
      this.sel.active = { r: nr, c: nc };
      this.grid.ensureVisible(nr, nc);
      this.onSelectionChange();
      return;
    }
    const d = { down: [1, 0], up: [-1, 0], right: [0, 1], left: [0, -1] }[dir];
    this.move(d[0], d[1]);
  }

  /* ================= 键盘导航 ================= */
  move(dr, dc, { extend = false, jump = false } = {}) {
    const s = this.sheet;
    const from = extend ? this.sel.focus : this.sel.active;
    let r = from.r, c = from.c;
    // 从合并单元格边缘出发
    const m = !extend && this.mergeAt(r, c);
    if (m) { if (dr > 0) r = m.r2; if (dc > 0) c = m.c2; }
    if (jump) [r, c] = this.jumpTarget(r, c, dr, dc);
    else {
      do { r += dr; c += dc; } while (r >= 0 && c >= 0 && r < s.rows && c < s.cols && (dr ? !this.grid.rowH(r) : !this.grid.colW(c)));
    }
    r = Math.max(0, Math.min(r, MAX_ROWS - 1));
    c = Math.max(0, Math.min(c, MAX_COLS - 1));
    if (extend) this.select(r, c, { extend: true });
    else this.select(r, c);
  }
  hasData(r, c) {
    const v = this.engine.display(this.si, r, c);
    return v != null && v !== '';
  }
  jumpTarget(r, c, dr, dc) {
    const s = this.sheet, b = this.engine.bounds[this.si];
    const maxR = dr > 0 ? Math.max(b.maxR, s.rows - 1) : 0, maxC = dc > 0 ? Math.max(b.maxC, s.cols - 1) : 0;
    const inb = (rr, cc) => rr >= 0 && cc >= 0 && rr <= Math.max(b.maxR, s.rows - 1) && cc <= Math.max(b.maxC, s.cols - 1);
    let nr = r + dr, nc = c + dc;
    if (!inb(nr, nc)) return [r, c];
    if (this.hasData(r, c) && this.hasData(nr, nc)) {
      while (inb(nr + dr, nc + dc) && this.hasData(nr + dr, nc + dc)) { nr += dr; nc += dc; }
      return [nr, nc];
    }
    while (inb(nr, nc) && !this.hasData(nr, nc)) {
      if ((dr > 0 && nr > b.maxR) || (dc > 0 && nc > b.maxC)) return [dr ? (dr > 0 ? maxR : 0) : nr, dc ? (dc > 0 ? maxC : 0) : nc];
      nr += dr; nc += dc;
    }
    if (!inb(nr, nc)) return [Math.max(0, nr - dr), Math.max(0, nc - dc)];
    return [nr, nc];
  }

  /* ================= 事件绑定 ================= */
  bindEvents() {
    const inp = this.input;
    inp.addEventListener('keydown', (e) => this.onKey(e));
    inp.addEventListener('input', (e) => {
      if (!this.editing) {
        // 未经 keydown 的输入（输入法、自动化输入等）：直接进入编辑
        if (!inp.value) return;
        if (e.isComposing) return;
        this.beginEdit('', 'enter', { keepValue: true });
        return;
      }
      this.pick = null;
      this.onEditInput();
    });
    inp.addEventListener('compositionstart', () => { if (!this.editing) this.beginEdit('', 'enter', { keepValue: true }); });
    inp.addEventListener('copy', (e) => { this.clipEventSeen = true; if (!this.editing) { e.preventDefault(); cmd.copy(this, false, e.clipboardData); } });
    inp.addEventListener('cut', (e) => { this.clipEventSeen = true; if (!this.editing) { e.preventDefault(); cmd.copy(this, true, e.clipboardData); } });
    inp.addEventListener('paste', (e) => {
      this.clipEventSeen = true;
      if (this.editing) return;
      e.preventDefault();
      const dt = e.clipboardData;
      const img = [...dt.items].find((it) => it.type.startsWith('image/'));
      const text = dt.getData('text/plain');
      if (img && !text) { const f = img.getAsFile(); this.objects.insertImageFile(f); return; }
      cmd.paste(this, 'all', text, dt.getData('text/html'));
    });
    inp.addEventListener('blur', () => { if (this.editing && !this.editing.fromBar && document.activeElement !== this.fx) {/* 保持编辑状态 */} });

    // 编辑栏
    this.fx.addEventListener('focus', () => {
      if (!this.editing) this.beginEdit(null, 'edit', { fromBar: true });
      else this.editing.fromBar = true;
    });
    this.fx.addEventListener('input', () => { if (this.editing) { this.pick = null; this.onEditInput('bar'); } });
    this.fx.addEventListener('keydown', (e) => {
      if (this.acHandleKey(e)) return;
      if (e.key === 'Enter' && !e.altKey) { e.preventDefault(); this.commitEdit(e.shiftKey ? 'up' : 'down'); }
      else if (e.key === 'Escape') { e.preventDefault(); this.cancelEdit(); }
      else if (e.key === 'Tab') { e.preventDefault(); this.commitEdit(e.shiftKey ? 'left' : 'right'); }
    });
    this.fx.addEventListener('click', () => this.updateAutocomplete(this.fx));

    // 名称框
    this.nameBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.gotoRef(this.nameBox.value); this.input.focus(); }
      if (e.key === 'Escape') { this.updateUI(); this.input.focus(); }
    });
    this.nameBox.addEventListener('focus', () => this.nameBox.select());

    // 鼠标
    this.grid.scroller.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.grid.scroller.addEventListener('dblclick', (e) => this.onDblClick(e));
    this.grid.scroller.addEventListener('mousemove', (e) => this.onHover(e));
    this.grid.scroller.addEventListener('mouseleave', () => this.hideTip());
    this.grid.scroller.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    this.grid.scroller.addEventListener('wheel', (e) => {
      if (e.ctrlKey) { e.preventDefault(); this.setZoom(this.zoom + (e.deltaY < 0 ? 10 : -10)); }
    }, { passive: false });

    this.onResize = debounce(() => { if (this.root.classList.contains('active')) { this.grid.draw(); this.grid.positionObjects(); this.positionInput(); } }, 50);
    window.addEventListener('resize', this.onResize);
    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(() => this.onResize());
      this.ro.observe(this.gridWrap);
    }
    // 焦点落在页面空白处时，把按键交给表格
    this.onDocKey = (e) => {
      if (!this.root.classList.contains('active')) return;
      const ae = document.activeElement;
      if (ae && ae !== document.body && !this.gridWrap.contains(ae)) return;
      if (document.querySelector('.modal-overlay')) return;
      if (ae === this.input) return;
      this.input.focus({ preventScroll: true });
      const wasEditing = !!this.editing;
      this.onKey(e);
      // 按键原本的落点不是编辑框：手动补上字符
      if (!wasEditing && this.editing && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this.input.value = e.key;
        this.onEditInput();
      }
    };
    document.addEventListener('keydown', this.onDocKey);
    // 复制选框的"蚂蚁线"动画
    this.marchTimer = setInterval(() => {
      if (this.clip && this.clip.marquee && this.root.classList.contains('active')) { this.marchOffset = ((this.marchOffset || 0) + 1) % 16; this.grid.invalidate(); }
    }, 80);
  }

  gotoRef(text) {
    text = text.trim();
    let si = this.si;
    const m = text.match(/^(?:'([^']+)'|([^!]+))!(.+)$/);
    if (m) { si = this.engine.sheetIndex(m[1] || m[2]); text = m[3]; if (si < 0) { toast('找不到工作表', 'error'); return; } }
    const rg = parseRange(text);
    if (!rg) { toast('无效的引用：' + text, 'error'); this.updateUI(); return; }
    if (si !== this.si) this.switchSheet(si);
    rg.r2 = Math.min(rg.r2, MAX_ROWS - 1);
    this.selectRange(rg);
  }

  onKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (this.editing) {
      if (this.acHandleKey(e)) return;
      const ed = this.editing;
      if (k === 'Enter') {
        if (e.altKey) {
          e.preventDefault();
          const el = this.input, p = el.selectionStart;
          el.setRangeText('\n', p, el.selectionEnd, 'end');
          this.onEditInput();
          return;
        }
        e.preventDefault();
        if (mod) this.ctrlEnter = true;
        this.commitEdit(mod ? null : e.shiftKey ? 'up' : 'down');
        return;
      }
      if (k === 'Tab') { e.preventDefault(); if (!e.shiftKey && this.tabAnchorCol == null) this.tabAnchorCol = ed.c; this.commitEdit(e.shiftKey ? 'left' : 'right'); return; }
      if (k === 'Escape') { e.preventDefault(); this.cancelEdit(); return; }
      if (k === 'F2') { e.preventDefault(); ed.mode = ed.mode === 'enter' ? 'edit' : 'enter'; this.modeSpan.textContent = ed.mode === 'enter' ? '输入' : '编辑'; return; }
      if (ed.mode === 'enter' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k) && !e.shiftKey) {
        // 公式点选模式：方向键插入引用
        if (this.canPickRef()) {
          e.preventDefault();
          const base = this.pickCell || { r: ed.r, c: ed.c };
          const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
          const nr = Math.max(0, base.r + d[0]), nc = Math.max(0, base.c + d[1]);
          this.pickCell = { r: nr, c: nc };
          this.insertRefText({ r1: nr, c1: nc, r2: nr, c2: nc }, this.si);
          return;
        }
        e.preventDefault();
        this.commitEdit({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[k]);
        return;
      }
      if (mod && k.toLowerCase() === 'a') return; // 文本全选
      if (k === 'F4' && this.input.value.startsWith('=')) { e.preventDefault(); this.toggleAbsRef(this.input); return; }
      this.pickCell = null;
      return;
    }
    // 非编辑状态
    if (this.objects.selected && (k === 'Delete' || k === 'Backspace')) { e.preventDefault(); this.objects.deleteSelected(); return; }
    if (k === 'Escape') {
      if (this.objects.selected) { this.objects.select(null); return; }
      if (this.clip) { this.clip.marquee = false; this.grid.invalidate(); }
      if (this.painter) { this.painter = null; this.updateUI(); }
      return;
    }
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[k]) { e.preventDefault(); this.tabAnchorCol = null; this.move(...arrows[k], { extend: e.shiftKey, jump: mod }); return; }
    if (mod) {
      const lk = k.toLowerCase();
      const map = {
        z: () => this.undo(), y: () => this.redo(), a: () => this.selectAll(),
        b: () => cmd.toggleStyle(this, 'b'), i: () => cmd.toggleStyle(this, 'i'), u: () => cmd.toggleStyle(this, 'u'),
        f: () => dlg.findReplace(this, false), h: () => dlg.findReplace(this, true),
        d: () => cmd.fillDirection(this, 'down'), r: () => cmd.fillDirection(this, 'right'),
        1: () => dlg.formatCells(this), k: () => dlg.hyperlink(this),
        ';': () => cmd.insertNow(this, 'date'), ':': () => cmd.insertNow(this, 'time'),
        home: () => this.select(0, 0), end: () => { const b = this.engine.bounds[this.si]; this.select(b.maxR, b.maxC); },
        '=': () => this.setZoom(this.zoom + 10), '-': () => this.setZoom(this.zoom - 10),
      };
      if (e.shiftKey && lk === 'l') { e.preventDefault(); cmd.toggleFilter(this); return; }
      if (e.shiftKey && (k === '+' || k === '=')) { e.preventDefault(); dlg.insertCellsDialog(this); return; }
      if (lk === 'c' || lk === 'x' || lk === 'v') {
        // 优先使用原生剪贴板事件；若浏览器未触发（如自动化环境），回退到异步剪贴板 API
        this.clipEventSeen = false;
        setTimeout(() => {
          if (this.clipEventSeen) return;
          if (lk === 'v') cmd.pasteFromSystem(this, e.shiftKey ? 'values' : 'all');
          else cmd.copy(this, lk === 'x');
        }, 0);
        return;
      }
      if (lk === 's' || lk === 'o' || lk === 'p') {
        if (lk === 'p') { e.preventDefault(); this.print(); }
        return; // 保存/打开交给外壳
      }
      const fn = map[lk];
      if (fn) { e.preventDefault(); fn(); }
      return;
    }
    switch (k) {
      case 'Enter': e.preventDefault(); this.moveAfterEnter(e.shiftKey ? 'up' : 'down'); return;
      case 'Tab': e.preventDefault(); if (!e.shiftKey && this.tabAnchorCol == null) this.tabAnchorCol = this.sel.active.c; this.moveAfterEnter(e.shiftKey ? 'left' : 'right'); return;
      case 'Delete': e.preventDefault(); cmd.clear(this, 'contents'); return;
      case 'Backspace': e.preventDefault(); this.beginEdit('', 'enter'); return;
      case 'F2': e.preventDefault(); this.beginEdit(null, 'edit'); return;
      case 'Home': e.preventDefault(); this.select(this.sel.active.r, 0, { extend: e.shiftKey }); return;
      case 'End': e.preventDefault(); return;
      case 'PageDown': case 'PageUp': {
        e.preventDefault();
        const vr = this.grid.visibleRange();
        const n = Math.max(1, vr.r2 - vr.r1 - 1) * (k === 'PageDown' ? 1 : -1);
        this.grid.scroller.scrollTop += n * 24 * this.zoom / 100;
        this.select(Math.max(0, this.sel.active.r + n), this.sel.active.c, { extend: e.shiftKey });
        return;
      }
      case 'F4': e.preventDefault(); this.redo(); return;
    }
    if (e.altKey && k === '=') { e.preventDefault(); cmd.autoSum(this, 'SUM'); return; }
    if (e.altKey && k === 'ArrowDown') { e.preventDefault(); dlg.validationList(this) || dlg.pickFromList(this); return; }
    if (k.length === 1 && !e.altKey) {
      // 开始输入：替换内容
      this.beginEdit('', 'enter');
      // 让字符自然输入到 textarea
    }
  }

  toggleAbsRef(el) {
    const text = el.value, caret = el.selectionStart;
    const refs = listRefs(text.slice(1));
    const hit = refs.find((x) => caret - 1 >= x.start && caret - 1 <= x.end) || refs.find((x) => caret - 1 === x.end);
    if (!hit) return;
    const s = hit.start + 1, e2 = hit.end + 1;
    const part = text.slice(s, e2);
    const cycle = (p) => {
      const m = p.match(/^(\$?)([A-Za-z]+)(\$?)(\d+)$/);
      if (!m) return p;
      const st = (m[1] ? 2 : 0) + (m[3] ? 1 : 0); // 0:A1 3:$A$1 1:A$1 2:$A1
      const next = { 0: 3, 3: 1, 1: 2, 2: 0 }[st];
      return (next & 2 ? '$' : '') + m[2] + (next & 1 ? '$' : '') + m[4];
    };
    const sheetSep = part.lastIndexOf('!');
    const prefix = sheetSep >= 0 ? part.slice(0, sheetSep + 1) : '';
    const body = part.slice(prefix.length).split(':').map(cycle).join(':');
    el.value = text.slice(0, s) + prefix + body + text.slice(e2);
    const nc = s + prefix.length + body.length;
    el.setSelectionRange(nc, nc);
    this.onEditInput(el === this.fx ? 'bar' : undefined);
  }

  /* ================= 鼠标 ================= */
  localPoint(e) {
    const r = this.grid.scroller.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onMouseDown(e) {
    if (e.button !== 0) return;
    const { x, y } = this.localPoint(e);
    if (x > this.grid.W || y > this.grid.H) return; // 点击滚动条
    e.preventDefault();
    this.objects.select(null);
    this.hideTip();
    this.tabAnchorCol = null;
    const g = this.grid;
    const hit = g.hit(x, y);
    // 数据验证下拉
    if (g.dvBtn && x >= g.dvBtn.x && x <= g.dvBtn.x + g.dvBtn.w && y >= g.dvBtn.y && y <= g.dvBtn.y + g.dvBtn.h) { setTimeout(() => dlg.validationList(this)); return; }
    // 筛选按钮
    const f = this.sheet.filter;
    if (f && hit.area === 'cell' && hit.r === f.r1 && hit.c >= f.c1 && hit.c <= f.c2) {
      const rc = g.cellRect(hit.r, hit.c);
      if (x >= rc.x + rc.w - 18 * g.z) { const pt = { x: e.clientX - 8, y: e.clientY + 10 }; setTimeout(() => dlg.filterMenu(this, hit.c, pt)); return; }
    }
    // 公式点选
    if (this.editing && hit.area === 'cell' && this.canPickRef()) {
      const start = { r: hit.r, c: hit.c };
      this.insertRefText({ r1: hit.r, c1: hit.c, r2: hit.r, c2: hit.c }, this.si);
      this.mode = 'refpick';
      this.dragLoop(e, (h2) => {
        this.insertRefText(norm({ r1: start.r, c1: start.c, r2: h2.r, c2: h2.c }), this.si);
      }, () => { this.mode = null; this.activeEditEl().focus(); });
      return;
    }
    if (this.editing) {
      if (!this.commitEdit()) return;
    }
    this.input.focus({ preventScroll: true });
    // 列宽/行高调整
    if (hit.resizeCol != null) return this.resizeDrag(e, 'c', hit.resizeCol);
    if (hit.resizeRow != null) return this.resizeDrag(e, 'r', hit.resizeRow);
    // 填充柄
    const L = this.range;
    const lr = g.cellRect(L.r2, L.c2);
    if (hit.area === 'cell' && Math.abs(x - (lr.x + lr.w)) <= 5 && Math.abs(y - (lr.y + lr.h)) <= 5 && this.sel.ranges.length === 1) {
      return this.fillDrag(e);
    }
    const s = this.sheet;
    if (hit.area === 'corner') { this.selectAll(); return; }
    if (hit.area === 'colhead') {
      const extend = e.shiftKey;
      if (!extend) {
        if (!e.ctrlKey) this.sel.ranges = [];
        this.sel.ranges.push({ r1: 0, r2: s.rows - 1, c1: hit.c, c2: hit.c });
        this.sel.anchor = { r: 0, c: hit.c };
        this.sel.active = { r: g.visibleRange().r1 > 0 && this.grid.fr === 0 ? 0 : 0, c: hit.c };
      }
      const anchorC = this.sel.anchor.c;
      const upd = (c) => {
        this.sel.ranges[this.sel.ranges.length - 1] = { r1: 0, r2: s.rows - 1, c1: Math.min(anchorC, c), c2: Math.max(anchorC, c) };
        this.sel.focus = { r: s.rows - 1, c };
        this.onSelectionChange();
      };
      upd(hit.c);
      this.dragLoop(e, (h2) => upd(h2.c), null, 'x');
      return;
    }
    if (hit.area === 'rowhead') {
      if (!e.shiftKey) {
        if (!e.ctrlKey) this.sel.ranges = [];
        this.sel.ranges.push({ r1: hit.r, r2: hit.r, c1: 0, c2: s.cols - 1 });
        this.sel.anchor = { r: hit.r, c: 0 };
        this.sel.active = { r: hit.r, c: 0 };
      }
      const anchorR = this.sel.anchor.r;
      const upd = (r) => {
        this.sel.ranges[this.sel.ranges.length - 1] = { r1: Math.min(anchorR, r), r2: Math.max(anchorR, r), c1: 0, c2: s.cols - 1 };
        this.sel.focus = { r, c: s.cols - 1 };
        this.onSelectionChange();
      };
      upd(hit.r);
      this.dragLoop(e, (h2) => upd(h2.r), null, 'y');
      return;
    }
    // 超链接 Ctrl+单击
    const cell = this.cellAt(hit.r, hit.c);
    if (cell && cell.link && (e.ctrlKey || e.metaKey)) { openLink(cell.link); return; }
    if (e.shiftKey) this.select(hit.r, hit.c, { extend: true, scroll: false });
    else this.select(hit.r, hit.c, { add: e.ctrlKey || e.metaKey, scroll: false });
    this.dragging = true;
    this.dragLoop(e, (h2) => this.select(h2.r, h2.c, { extend: true, scroll: false }), () => {
      this.dragging = false;
      this.updateUI();
      if (this.painter) cmd.applyPainter(this);
    });
  }

  /** 通用拖动循环（含自动滚动） */
  dragLoop(e0, onMove, onEnd, axis) {
    const g = this.grid;
    let last = null, timer = null;
    const handle = (ev) => {
      const p = this.localPoint(ev);
      last = p;
      const cx = Math.max(g.hw + 1, Math.min(p.x, g.W - 1));
      const cy = Math.max(g.hh + 1, Math.min(p.y, g.H - 1));
      const hh = g.hit(axis === 'y' ? 1 : cx, axis === 'x' ? 1 : cy);
      if (axis === 'x') hh.c = g.hit(cx, g.hh + 2).c;
      if (axis === 'y') hh.r = g.hit(g.hw + 2, cy).r;
      onMove(hh, p);
    };
    const tick = () => {
      if (!last) return;
      let dx = 0, dy = 0;
      if (last.x > g.W) dx = Math.min(60, last.x - g.W);
      else if (last.x < g.hw) dx = -Math.min(60, g.hw - last.x);
      if (last.y > g.H) dy = Math.min(60, last.y - g.H);
      else if (last.y < g.hh) dy = -Math.min(60, g.hh - last.y);
      if (axis === 'x') dy = 0;
      if (axis === 'y') dx = 0;
      if (dx || dy) { g.scroller.scrollLeft += dx; g.scroller.scrollTop += dy; handle({ clientX: last.x + g.scroller.getBoundingClientRect().left, clientY: last.y + g.scroller.getBoundingClientRect().top }); }
    };
    timer = setInterval(tick, 50);
    const mv = (ev) => handle(ev);
    const up = () => {
      clearInterval(timer);
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      onEnd && onEnd();
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  }

  resizeDrag(e, axis, idx) {
    const g = this.grid, z = g.z;
    const s = this.sheet;
    const start = axis === 'c' ? e.clientX : e.clientY;
    const orig = axis === 'c' ? g.colW(idx) : g.rowH(idx);
    // 若选中了多列/整列，同时调整
    const targets = [];
    for (const rg of this.sel.ranges) {
      if (axis === 'c' && rg.r1 === 0 && rg.r2 >= s.rows - 1 && idx >= rg.c1 && idx <= rg.c2) for (let c = rg.c1; c <= rg.c2; c++) targets.push(c);
      if (axis === 'r' && rg.c1 === 0 && rg.c2 >= s.cols - 1 && idx >= rg.r1 && idx <= rg.r2) for (let r = rg.r1; r <= rg.r2; r++) targets.push(r);
    }
    if (!targets.includes(idx)) targets.splice(0, targets.length, idx);
    const data = this.snapshot('sheet');
    const sel = structuredClone(this.sel);
    const line = h('div', { class: 'ss-resize-line ' + (axis === 'c' ? 'v' : 'h') });
    this.gridWrap.append(line);
    let size = orig;
    const mv = (ev) => {
      const d = ((axis === 'c' ? ev.clientX : ev.clientY) - start) / z;
      size = Math.max(0, Math.round(orig + d));
      const p = this.localPoint(ev);
      if (axis === 'c') line.style.left = p.x + 'px'; else line.style.top = p.y + 'px';
      this.tipAt(p.x + 12, p.y + 12, (axis === 'c' ? '宽度: ' : '高度: ') + size + ' 像素');
    };
    const up = () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      line.remove();
      this.hideTip();
      if (size === orig) return;
      for (const t of targets) {
        if (axis === 'c') { if (size === 0) { s.hiddenCols[t] = 1; } else { s.colW[t] = size; delete s.hiddenCols[t]; } }
        else { if (size === 0) { s.hiddenRows[t] = 1; } else { s.rowH[t] = size; delete s.hiddenRows[t]; } }
      }
      this.undoStack.push({ label: '调整大小', scope: 'sheet', si: this.si, data, sel });
      this.redoStack = [];
      this.afterChange();
    };
    mv(e);
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  }

  fillDrag(e) {
    const src = { ...this.range };
    let target = null;
    this.dragLoop(e, (hh) => {
      const { r, c } = hh;
      let t = { ...src };
      const dDown = r - src.r2, dUp = src.r1 - r, dRight = c - src.c2, dLeft = src.c1 - c;
      const vert = Math.max(dDown, dUp), horiz = Math.max(dRight, dLeft);
      if (vert <= 0 && horiz <= 0) {
        // 在选区内部拖动：清除
        t = r < src.r2 && r >= src.r1 && vert > horiz - 1 ? { ...src, r2: r } : { ...src };
        target = null;
        this.fillPreview = t;
      } else if (vert >= horiz) {
        if (dDown > 0) t.r2 = r; else t.r1 = r;
        target = t;
        this.fillPreview = t;
      } else {
        if (dRight > 0) t.c2 = c; else t.c1 = c;
        target = t;
        this.fillPreview = t;
      }
      this.grid.invalidate();
    }, () => {
      this.fillPreview = null;
      if (target) cmd.autoFill(this, src, target);
      this.grid.invalidate();
    });
  }

  onDblClick(e) {
    const { x, y } = this.localPoint(e);
    const hit = this.grid.hit(x, y);
    if (hit.resizeCol != null) { cmd.autoFitCols(this, [hit.resizeCol]); return; }
    if (hit.resizeRow != null) { cmd.autoFitRows(this, [hit.resizeRow]); return; }
    if (hit.area !== 'cell') return;
    // 双击填充柄：向下填充到相邻列的末尾
    const L = this.range, lr = this.grid.cellRect(L.r2, L.c2);
    if (Math.abs(x - (lr.x + lr.w)) <= 5 && Math.abs(y - (lr.y + lr.h)) <= 5) { cmd.fillToAdjacent(this); return; }
    this.beginEdit(null, 'edit');
  }

  onHover(e) {
    if (this.dragging) return;
    const { x, y } = this.localPoint(e);
    const g = this.grid;
    const hit = g.hit(x, y);
    let cursor = 'cell';
    if (hit.resizeCol != null) cursor = 'col-resize';
    else if (hit.resizeRow != null) cursor = 'row-resize';
    else if (hit.area === 'colhead') cursor = 'colsel';
    else if (hit.area === 'rowhead') cursor = 'rowsel';
    else if (hit.area === 'cell') {
      const L = this.range, lr = g.cellRect(L.r2, L.c2);
      if (Math.abs(x - (lr.x + lr.w)) <= 5 && Math.abs(y - (lr.y + lr.h)) <= 5) cursor = 'fill';
    }
    this.grid.scroller.dataset.cursor = this.painter ? 'painter' : cursor;
    // 批注 / 链接提示
    if (hit.area === 'cell') {
      const m = this.mergeAt(hit.r, hit.c);
      const cell = this.cellAt(m ? m.r1 : hit.r, m ? m.c1 : hit.c);
      const k = hit.r + ',' + hit.c;
      if (cell && (cell.cm || cell.link)) {
        if (this.tipKey !== k) {
          this.tipKey = k;
          const rc = g.cellRect(hit.r, hit.c);
          if (cell.cm) this.tipAt(rc.x + rc.w + 4, rc.y, cell.cm, 'comment');
          else this.tipAt(x + 12, y + 16, cell.link + '\nCtrl + 单击可跟踪链接');
        }
        return;
      }
    }
    if (this.tipKey) this.hideTip();
  }
  tipAt(x, y, text, kind = '') {
    this.tip.className = 'ss-tip show ' + kind;
    this.tip.textContent = text;
    this.tip.style.left = Math.min(x, this.grid.W - 220) + 'px';
    this.tip.style.top = y + 'px';
  }
  hideTip() { this.tipKey = null; this.tip.className = 'ss-tip'; }

  onContextMenu(e) {
    e.preventDefault();
    if (this.editing) this.commitEdit();
    const { x, y } = this.localPoint(e);
    const hit = this.grid.hit(x, y);
    const inSel = this.sel.ranges.some((rg) => inRange(rg, hit.r, hit.c));
    const s = this.sheet;
    if (hit.area === 'colhead') {
      const full = this.sel.ranges.some((rg) => rg.r1 === 0 && rg.r2 >= s.rows - 1 && hit.c >= rg.c1 && hit.c <= rg.c2);
      if (!full) { this.sel.ranges = [{ r1: 0, r2: s.rows - 1, c1: hit.c, c2: hit.c }]; this.sel.active = { r: 0, c: hit.c }; this.sel.anchor = { ...this.sel.active }; this.onSelectionChange(); }
      contextMenu(e, cmd.colMenu(this));
      return;
    }
    if (hit.area === 'rowhead') {
      const full = this.sel.ranges.some((rg) => rg.c1 === 0 && rg.c2 >= s.cols - 1 && hit.r >= rg.r1 && hit.r <= rg.r2);
      if (!full) { this.sel.ranges = [{ r1: hit.r, r2: hit.r, c1: 0, c2: s.cols - 1 }]; this.sel.active = { r: hit.r, c: 0 }; this.sel.anchor = { ...this.sel.active }; this.onSelectionChange(); }
      contextMenu(e, cmd.rowMenu(this));
      return;
    }
    if (hit.area === 'cell' && !inSel) this.select(hit.r, hit.c, { scroll: false });
    contextMenu(e, cmd.cellMenu(this));
  }

  /* ================= 自动完成 ================= */
  updateAutocomplete(el) {
    if (!this.editing || !el.value.startsWith('=')) { this.hideAutocomplete(); return; }
    const caret = el.selectionStart;
    const before = el.value.slice(0, caret);
    const m = before.match(/(^|[=(,+\-*/^&<>:;\s])([A-Za-z][A-Za-z0-9.]*)$/);
    let items = [];
    if (m) {
      const prefix = m[2].toUpperCase();
      items = Object.values(FUNC_META).filter((f) => f.name.startsWith(prefix)).slice(0, 12);
      if (items.length === 1 && items[0].name === prefix && before.endsWith('(')) items = [];
    }
    // 函数参数提示
    const fnName = currentFunction(before);
    const meta = fnName && FUNC_META[fnName];
    if (!items.length && !meta) { this.hideAutocomplete(); return; }
    if (!this.ac) {
      this.ac = h('div', { class: 'ss-ac' });
      document.body.append(this.ac);
    }
    const anchor = el.getBoundingClientRect();
    let left = anchor.left, top = anchor.bottom + 2;
    if (el === this.input) { left = anchor.left; top = anchor.bottom + 2; }
    this.ac.style.left = left + 'px';
    this.ac.style.top = top + 'px';
    this.ac.replaceChildren();
    this.acItems = items;
    this.acPrefixLen = m ? m[2].length : 0;
    this.acEl = el;
    if (items.length) {
      this.acIndex = Math.min(this.acIndex || 0, items.length - 1);
      items.forEach((f, i) => {
        this.ac.append(h('div', {
          class: 'ss-ac-item' + (i === this.acIndex ? ' active' : ''),
          onmousedown: (ev) => { ev.preventDefault(); this.acIndex = i; this.acAccept(); },
        }, h('b', null, f.name), h('span', null, f.desc)));
      });
    } else if (meta) {
      this.ac.append(h('div', { class: 'ss-ac-sig' }, h('b', null, meta.name), '(' + meta.sig + ')', h('div', { class: 'ss-ac-desc' }, meta.desc)));
    }
    this.ac.style.display = 'block';
  }
  hideAutocomplete() {
    if (this.ac) this.ac.style.display = 'none';
    this.acItems = [];
    this.acIndex = 0;
  }
  acAccept() {
    const f = this.acItems[this.acIndex];
    if (!f) return;
    const el = this.acEl;
    const caret = el.selectionStart;
    const start = caret - this.acPrefixLen;
    const after = el.value.slice(caret);
    const ins = f.name + (after.startsWith('(') ? '' : '(');
    el.value = el.value.slice(0, start) + ins + after;
    const nc = start + ins.length;
    el.setSelectionRange(nc, nc);
    this.acItems = [];
    this.onEditInput(el === this.fx ? 'bar' : undefined);
  }
  acHandleKey(e) {
    if (!this.ac || this.ac.style.display === 'none' || !this.acItems || !this.acItems.length) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.acIndex = (this.acIndex + (e.key === 'ArrowDown' ? 1 : -1) + this.acItems.length) % this.acItems.length;
      this.updateAutocomplete(this.acEl);
      return true;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && this.acPrefixLen > 0)) {
      e.preventDefault();
      this.acAccept();
      return true;
    }
    if (e.key === 'Escape') { e.preventDefault(); this.hideAutocomplete(); return true; }
    return false;
  }

  /* ================= 工作表 ================= */
  switchSheet(i, { keepEdit = false } = {}) {
    if (i === this.si || i < 0 || i >= this.wb.sheets.length) return;
    if (this.editing && !keepEdit) {
      // 公式编辑时切换工作表：保持编辑（跨表引用点选）
      if (!this.input.value.startsWith('=')) { if (!this.commitEdit()) return; }
    }
    this.sheetSel = this.sheetSel || {};
    this.sheetSel[this.sheet.id] = { sel: this.sel, sx: this.grid.sx, sy: this.grid.sy };
    this.si = i;
    const saved = this.sheetSel[this.sheet.id];
    this.sel = saved ? saved.sel : { ranges: [{ r1: 0, c1: 0, r2: 0, c2: 0 }], active: { r: 0, c: 0 }, anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } };
    this.buildMergeIndex();
    if (!saved && this.mergeAt(0, 0)) this.sel.ranges = [{ ...this.mergeAt(0, 0) }];
    this.layoutVer++;
    this.grid.geoKey = '';
    this.grid.geometry();
    this.grid.scroller.scrollLeft = saved ? saved.sx : 0;
    this.grid.scroller.scrollTop = saved ? saved.sy : 0;
    this.objects.render();
    this.renderTabs();
    this.grid.draw();
    this.updateUI();
    this.positionInput();
    if (this.editing) (this.editing.fromBar ? this.fx : this.input).focus();
    else this.input.focus({ preventScroll: true });
  }

  renderTabs() {
    this.tabsEl.replaceChildren();
    this.wb.sheets.forEach((s, i) => {
      const tab = h('div', {
        class: 'ss-tab' + (i === this.si ? ' active' : ''),
        style: s.tabColor ? { '--tab-color': s.tabColor } : null,
        draggable: true,
        onmousedown: (e) => {
          if (e.button !== 0) return;
          if (this.editing && this.input.value.startsWith('=')) { e.preventDefault(); this.switchSheet(i, { keepEdit: true }); this.activeEditEl().focus(); return; }
          this.switchSheet(i);
        },
        ondblclick: () => cmd.renameSheetInline(this, i, tab),
        oncontextmenu: (e) => { this.switchSheet(i); contextMenu(e, cmd.sheetMenu(this, i, tab)); },
        ondragstart: (e) => { e.dataTransfer.setData('text/x-sheet', String(i)); },
        ondragover: (e) => e.preventDefault(),
        ondrop: (e) => { e.preventDefault(); const from = +e.dataTransfer.getData('text/x-sheet'); if (!isNaN(from) && from !== i) cmd.moveSheet(this, from, i); },
      }, s.tabColor ? h('span', { class: 'ss-tab-color' }) : null, s.name);
      this.tabsEl.append(tab);
    });
    const act = this.tabsEl.children[this.si];
    if (act) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /* ================= 界面状态 ================= */
  updateUI() {
    const { r, c } = this.sel.active;
    const rg = this.range;
    const rows = rg.r2 - rg.r1 + 1, cols = rg.c2 - rg.c1 + 1;
    const merge = this.mergeAt(r, c);
    const single = this.sel.ranges.length === 1 && (merge ? merge.r1 === rg.r1 && merge.c1 === rg.c1 && merge.r2 === rg.r2 && merge.c2 === rg.c2 : rows === 1 && cols === 1);
    if (document.activeElement !== this.nameBox) this.nameBox.value = this.dragging && !single ? `${rows}R × ${cols}C` : addr(r, c);
    const cell = this.cellAt(r, c);
    if (!this.editing) this.fx.value = valueToEditText(cell);
    this.updateStats();
    this.ribbon.sync(cell && cell.s ? cell.s : {}, { merged: !!merge });
    if (!this.editing) this.positionInput();
  }

  updateStats() {
    const s = this.sheet;
    let total = 0, nCount = 0, count = 0, cells = 0;
    let min = Infinity, max = -Infinity;
    const act = this.activeRect(), rg1 = this.range;
    if (this.sel.ranges.length === 1 && act.r1 === rg1.r1 && act.c1 === rg1.c1 && act.r2 === rg1.r2 && act.c2 === rg1.c2) { this.statSpan.replaceChildren(); return; }
    for (const rg0 of this.sel.ranges) {
      const rg = this.usedPart(rg0);
      cells += (rg0.r2 - rg0.r1 + 1) * (rg0.c2 - rg0.c1 + 1);
      if ((rg.r2 - rg.r1 + 1) * (rg.c2 - rg.c1 + 1) > 300000) continue;
      for (let r = rg.r1; r <= rg.r2; r++) {
        if (!this.grid.rowH(r)) continue;
        for (let c = rg.c1; c <= rg.c2; c++) {
          const v = this.engine.display(this.si, r, c);
          if (v == null || v === '') continue;
          count++;
          if (typeof v === 'number') { nCount++; total += v; min = Math.min(min, v); max = Math.max(max, v); }
        }
      }
    }
    if (cells <= 1 || !count) { this.statSpan.replaceChildren(); return; }
    const fmt = (n) => formatValue(+n.toPrecision(12)).text;
    const parts = [];
    if (nCount) parts.push(`平均值=${fmt(total / nCount)}`);
    parts.push(`计数=${count}`);
    if (nCount) parts.push(`求和=${fmt(total)}`, `最小值=${fmt(min)}`, `最大值=${fmt(max)}`);
    this.statSpan.replaceChildren(...parts.map((p) => h('span', null, p)));
  }

  onViewChange() {
    this.positionInput();
  }

  setZoom(z) {
    z = Math.max(25, Math.min(400, Math.round(z)));
    if (z === this.zoom) return;
    this.wb.zoom = z;
    this.zoomCtl.set(z);
    this.layoutVer++;
    this.grid.geoKey = '';
    this.grid.geometry();
    this.grid.draw();
    this.grid.positionObjects();
    this.objects.render();
    if (this.editing) this.styleInput();
    this.positionInput();
  }

  print() { cmd.printSheet(this); }
}

function normalizeFormula(f) {
  // 函数名大写、自动补全右括号
  let depth = 0, out = '';
  for (const t of tokenize(f)) {
    if (t.type === 'func') out += t.text.toUpperCase();
    else if (t.type === 'ref' && !t.sheet) out += t.text.toUpperCase();
    else if (t.type === 'ref') out += t.text.slice(0, t.text.length - t.body.length) + t.body.toUpperCase();
    else if (t.type === 'bool') out += t.text.toUpperCase();
    else out += t.text;
    if (t.type === 'op' && t.text === '(') depth++;
    if (t.type === 'op' && t.text === ')') depth--;
  }
  while (depth-- > 0) out += ')';
  return out;
}

/** 光标前所在的最内层函数名 */
function currentFunction(before) {
  let depth = 0, inStr = false;
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i];
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) {
        const m = before.slice(0, i).match(/([A-Za-z][A-Za-z0-9.]*)\s*$/);
        return m ? m[1].toUpperCase() : null;
      }
      depth--;
    }
  }
  return null;
}

export function openLink(url) {
  if (/^#/.test(url)) return;
  if (!/^[a-z]+:/i.test(url)) url = 'https://' + url;
  window.open(url, '_blank', 'noopener');
}
