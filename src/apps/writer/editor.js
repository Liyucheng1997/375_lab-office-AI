// 文字编辑器核心：页面视图/分页、撤销重做、选区、格式命令、对象（图片/表格）操作。
import { h, icon, toast, debounce, readFileAs, pickFile, printHTML, zoomControl, contextMenu, formBox, promptBox, FONT_SIZES, FONT_FAMILIES } from '../../core/ui.js';
import { CONTENT_CSS, injectContentCss } from './content-css.js';
import { pageDims, mm2px, px2mm, sanitizeHTML, exportDocx, exportHTML, exportText, exportMarkdown } from './io.js';
import { defaultPage } from './templates.js';
import * as T from './table.js';
import { buildRibbon } from './ribbon.js';
import { createPanes } from './panes.js';
import './writer.css';

const GAP = 18; // 页间距(px)
const uid = () => Math.random().toString(36).slice(2, 9);

export function mountWriter(root, file, ctx) {
  injectContentCss();
  const c0 = file.content || {};
  const state = {
    page: { ...defaultPage(), ...(c0.page || {}) },
    header: { text: '', align: 'center', ...(c0.header || {}) },
    footer: { text: '', align: 'center', ...(c0.footer || {}) },
    pageNumber: { enabled: false, pos: 'footer', align: 'center', format: '{n}', ...(c0.pageNumber || {}) },
    comments: { ...(c0.comments || {}) },
    view: { zoom: 100, ruler: true, nav: false, mode: 'page', ...(c0.view || {}) },
  };
  state.page.margins = { ...defaultPage().margins, ...(state.page.margins || {}) };

  /* ---------- DOM ---------- */
  const doc = h('div', { class: 'wr-doc wr-editable', contenteditable: 'true', spellcheck: 'false' });
  const sheets = h('div', { class: 'wr-sheets' });
  const overlay = h('div', { class: 'wr-img-overlay' });
  const stage = h('div', { class: 'wr-stage' }, sheets, doc, overlay);
  const sizer = h('div', { class: 'wr-sizer' }, stage);
  const rulerCanvas = h('canvas', { class: 'wr-ruler' });
  const rulerWrap = h('div', { class: 'wr-ruler-wrap' }, rulerCanvas);
  const canvas = h('div', { class: 'wr-canvas' }, rulerWrap, sizer);
  const navPane = h('div', { class: 'wr-nav' });
  const sidePane = h('div', { class: 'side-pane wr-side' });
  const body = h('div', { class: 'app-body wr-body' }, navPane, canvas, sidePane);
  const sbPage = h('span', null, '第 1 页，共 1 页');
  const sbWords = h('span', { class: 'wr-sb-click', title: '字数统计' }, '字数：0');
  const sbSpell = h('button', { class: 'sb-btn', title: '拼写检查' }, icon('spell-check', 14));
  const zoomCtl = zoomControl(state.view.zoom, (z) => setZoom(z), { min: 25, max: 300 });
  const viewBtns = {
    page: h('button', { class: 'sb-btn', title: '页面视图', onclick: () => setViewMode('page') }, icon('file-text', 14)),
    read: h('button', { class: 'sb-btn', title: '阅读视图', onclick: () => setViewMode('read') }, icon('book-open', 14)),
    web: h('button', { class: 'sb-btn', title: 'Web 版式', onclick: () => setViewMode('web') }, icon('globe', 14)),
  };
  const statusbar = h('div', { class: 'statusbar' }, sbPage, sbWords, sbSpell, h('span', { class: 'wr-sb-state' }), h('div', { class: 'sb-spacer' }),
    viewBtns.page, viewBtns.read, viewBtns.web, zoomCtl.el);
  root.classList.add('wr-root');

  /* ---------- 状态 ---------- */
  let zoom = state.view.zoom / 100;
  let pageCount = 1;
  let savedRange = null;
  let selectedImg = null;
  let cellAnchor = null;
  let selCells = [];
  let painter = null;
  const listeners = [];
  const on = (target, ev, fn, opt) => { target.addEventListener(ev, fn, opt); listeners.push(() => target.removeEventListener(ev, fn, opt)); };
  const isActive = () => root.classList.contains('active');

  /* ---------- 内容加载与规范化 ---------- */
  function setHTML(html) {
    doc.innerHTML = html || '<p><br></p>';
    normalize();
  }

  function normalize() {
    // 去掉块元素之间的空白文本节点
    const strip = (el) => {
      for (const n of [...el.childNodes]) {
        if (n.nodeType === 3 && !n.data.trim() && (n.previousSibling?.nodeType === 1 || n.nextSibling?.nodeType === 1 || el === doc)) {
          const prev = n.previousSibling, next = n.nextSibling;
          const blockish = (x) => !x || (x.nodeType === 1 && /^(P|DIV|H\d|UL|OL|LI|TABLE|TBODY|THEAD|TR|TD|TH|BLOCKQUOTE|PRE|HR)$/.test(x.tagName));
          if (el === doc || /^(UL|OL|TABLE|TBODY|THEAD|TR)$/.test(el.tagName) || (blockish(prev) && blockish(next))) n.remove();
        }
      }
    };
    strip(doc);
    doc.querySelectorAll('ul,ol,table,tbody,thead,tr,blockquote').forEach(strip);
    // 顶层游离的行内内容包进 <p>
    let pending = null;
    for (const n of [...doc.childNodes]) {
      const inline = n.nodeType === 3 || (n.nodeType === 1 && !/^(P|DIV|H\d|UL|OL|TABLE|BLOCKQUOTE|PRE|HR)$/.test(n.tagName));
      if (inline) {
        if (!pending) { pending = document.createElement('p'); n.before(pending); }
        pending.append(n);
      } else pending = null;
    }
    // 空单元格/段落补 <br>
    doc.querySelectorAll('td,th').forEach((td) => { if (!td.firstChild) td.innerHTML = '<br>'; });
    ensureTrailingParagraph();
  }

  function ensureTrailingParagraph() {
    if (!doc.firstChild) { doc.innerHTML = '<p><br></p>'; return; }
    let last = doc.lastElementChild;
    if (last && last.classList.contains('wr-footnotes')) {
      const prev = last.previousElementSibling;
      if (!prev || !/^(P|H\d)$/.test(prev.tagName)) last.before(h('p', null, h('br')));
      return;
    }
    if (last && !/^(P|H\d|UL|OL|BLOCKQUOTE|PRE)$/.test(last.tagName)) doc.append(h('p', null, h('br')));
  }

  /** 去掉分页推移与临时标记后的 HTML */
  function cleanHTML() {
    const clone = doc.cloneNode(true);
    clone.querySelectorAll('[data-wr-pt]').forEach((el) => {
      el.style.marginTop = el.dataset.wrOmt || '';
      el.removeAttribute('data-wr-pt');
      el.removeAttribute('data-wr-omt');
      if (!el.getAttribute('style')) el.removeAttribute('style');
    });
    clone.querySelectorAll('.wr-cell-sel,.wr-img-sel').forEach((el) => {
      el.classList.remove('wr-cell-sel', 'wr-img-sel');
      if (!el.className) el.removeAttribute('class');
    });
    return clone.innerHTML;
  }

  /* ---------- 选区 ---------- */
  function liveRange() {
    const sel = getSelection();
    if (sel.rangeCount) {
      const r = sel.getRangeAt(0);
      if (doc.contains(r.commonAncestorContainer)) return r;
    }
    return null;
  }
  function getRange() {
    const r = liveRange();
    if (r) return r;
    return savedRange && doc.contains(savedRange.startContainer) ? savedRange : null;
  }

  function focusDoc() {
    if (document.activeElement === doc && liveRange()) return;
    doc.focus({ preventScroll: true });
    if (savedRange && doc.contains(savedRange.commonAncestorContainer)) {
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  }
  function setRange(r) {
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange = r.cloneRange();
  }
  function caretAt(node, offset = 0) {
    const r = document.createRange();
    r.setStart(node, offset);
    r.collapse(true);
    doc.focus({ preventScroll: true });
    setRange(r);
  }
  function caretInto(el, atEnd = false) {
    // 把光标放到元素内第一个/最后一个文本位置
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let t = null, n;
    while ((n = walker.nextNode())) { t = n; if (!atEnd) break; }
    if (t) caretAt(t, atEnd ? t.length : 0);
    else caretAt(el, atEnd ? el.childNodes.length : 0);
  }

  const elOf = (node) => (node && node.nodeType === 1 ? node : node?.parentElement);
  function closestIn(node, sel) {
    const el = elOf(node)?.closest(sel);
    return el && doc.contains(el) && el !== doc ? el : null;
  }
  function topBlock(node) {
    let n = node;
    while (n && n.parentNode !== doc) n = n.parentNode;
    return n && n.parentNode === doc ? n : null;
  }

  // 选区序列化：(顶层块索引, 块内字符偏移)
  function charOffset(container, node, offset) {
    const r = document.createRange();
    r.setStart(container, 0);
    try { r.setEnd(node, offset); } catch { return 0; }
    return r.toString().length;
  }
  function pointOf(node, offset) {
    const tb = topBlock(node);
    if (!tb) return null;
    return { b: [...doc.childNodes].indexOf(tb), o: charOffset(tb, node, offset) };
  }
  function locate(p) {
    const tb = doc.childNodes[Math.min(p.b, doc.childNodes.length - 1)];
    if (!tb) return null;
    const walker = document.createTreeWalker(tb, NodeFilter.SHOW_TEXT);
    let left = p.o, n, last = null;
    while ((n = walker.nextNode())) {
      if (left <= n.length) return [n, left];
      left -= n.length;
      last = n;
    }
    return last ? [last, last.length] : [tb, 0];
  }
  function saveSel() {
    const r = getRange();
    if (!r) return null;
    const s = pointOf(r.startContainer, r.startOffset), e = pointOf(r.endContainer, r.endOffset);
    return s && e ? { s, e } : null;
  }
  function restoreSel(sp) {
    if (!sp) return;
    const s = locate(sp.s), e = locate(sp.e);
    if (!s || !e) return;
    const r = document.createRange();
    try { r.setStart(s[0], s[1]); r.setEnd(e[0], e[1]); } catch { return; }
    doc.focus({ preventScroll: true });
    setRange(r);
  }

  /* ---------- 撤销 / 恢复 ---------- */
  const hist = { stack: [], idx: -1 };
  function record() {
    const snap = { html: cleanHTML(), sel: saveSel() };
    const cur = hist.stack[hist.idx];
    if (cur && cur.html === snap.html) { cur.sel = snap.sel || cur.sel; return; }
    hist.stack.splice(hist.idx + 1);
    hist.stack.push(snap);
    if (hist.stack.length > 300) hist.stack.shift();
    hist.idx = hist.stack.length - 1;
    E.updateUndo && E.updateUndo();
  }
  const recordLater = debounce(record, 450);
  function commit() { recordLater.cancel(); record(); }
  function restoreSnap(s) {
    deselectImage();
    clearCellSel();
    setHTML(s.html);
    paginate();
    restoreSel(s.sel);
    afterChange(false);
    E.updateUndo && E.updateUndo();
  }
  function undo() {
    commit();
    if (hist.idx > 0) { hist.idx--; restoreSnap(hist.stack[hist.idx]); }
  }
  function redo() {
    recordLater.cancel();
    if (hist.idx < hist.stack.length - 1) { hist.idx++; restoreSnap(hist.stack[hist.idx]); }
  }

  /* ---------- 变更通知 ---------- */
  const paginateLater = debounce(() => paginate(), 120);
  const panesLater = debounce(() => { panes.refreshNav(); panes.refreshComments(); updateStats(); }, 300);
  function afterChange(recordIt = true) {
    renumberFootnotes();
    ensureTrailingParagraph();
    ctx.markDirty();
    paginateLater();
    panesLater();
    if (recordIt) recordLater();
    updateOverlay();
  }

  /** 执行一个修改操作：先提交待记录输入，再执行，最后记录快照 */
  function run(fn, { focus = true } = {}) {
    commit();
    clearPushes(); // 避免命令修改到分页推移产生的临时 margin
    if (focus) focusDoc();
    const r = fn();
    afterChange(false);
    paginate();
    record();
    scheduleState();
    return r;
  }
  function exec(cmd, val = null) {
    focusDoc();
    return document.execCommand(cmd, false, val);
  }

  /* ---------- 页面几何与分页 ---------- */
  function geom() {
    const { w, h: hh } = pageDims(state.page);
    const m = state.page.margins;
    return { pw: mm2px(w), ph: mm2px(hh), mt: mm2px(m.top), mb: mm2px(m.bottom), ml: mm2px(m.left), mr: mm2px(m.right) };
  }

  function applyPageStyle() {
    const g = geom();
    const web = state.view.mode === 'web';
    root.classList.toggle('wr-web', web);
    if (web) {
      const w = Math.max(400, (canvas.clientWidth - 40) / zoom);
      stage.style.width = w + 'px';
      doc.style.padding = '40px 60px';
    } else {
      stage.style.width = g.pw + 'px';
      doc.style.padding = `${g.mt}px ${g.mr}px ${g.mb}px ${g.ml}px`;
    }
    doc.style.width = '100%';
    stage.style.transform = `scale(${zoom})`;
    drawRuler();
  }

  function clearPushes() {
    doc.querySelectorAll('[data-wr-pt]').forEach((el) => {
      el.style.marginTop = el.dataset.wrOmt || '';
      el.removeAttribute('data-wr-pt');
      el.removeAttribute('data-wr-omt');
      if (!el.getAttribute('style')) el.removeAttribute('style');
    });
  }

  let paginatePending = false;
  function paginate() {
    paginateLater.cancel();
    if (!isActive() || !doc.isConnected || canvas.clientWidth === 0) { paginatePending = true; return; }
    paginatePending = false;
    applyPageStyle();
    clearPushes();
    const g = geom();
    if (state.view.mode === 'web') {
      pageCount = 1;
      doc.style.minHeight = canvas.clientHeight / zoom - 40 + 'px';
      renderSheets();
      sizeStage();
      return;
    }
    const stride = g.ph + GAP;
    const contentH = g.ph - g.mt - g.mb;
    const kids = [...doc.children].filter((el) => {
      const cs = getComputedStyle(el);
      return cs.position !== 'absolute' && cs.position !== 'fixed' && cs.float === 'none' && cs.display !== 'none';
    });
    const m = kids.map((el) => [el.offsetTop, el.offsetHeight]);
    let shift = 0, prevBottom = g.mt, forcePage = -1;
    const pushes = [];
    kids.forEach((el, i) => {
      const [ot, oh] = m[i];
      const top = ot + shift;
      const bottom = top + oh;
      const k = Math.floor(top / stride);
      const cTop = k * stride + g.mt, cBot = k * stride + g.ph - g.mb;
      let target = null;
      if (forcePage >= 0) {
        if (top < (forcePage + 1) * stride + g.mt) target = (forcePage + 1) * stride + g.mt;
        forcePage = -1;
      } else if (top >= cBot - 1) target = (k + 1) * stride + g.mt;
      else if (top < cTop - 1 && k > 0) target = cTop;
      else if (bottom > cBot + 1 && oh <= contentH && top > cTop + 1) target = (k + 1) * stride + g.mt;
      if (target != null && target > top) {
        pushes.push([el, ot - prevBottom + (target - top)]);
        shift += target - top;
      }
      prevBottom = ot + oh;
      if (el.classList.contains('wr-pagebreak')) forcePage = Math.floor((ot + shift) / stride);
    });
    for (const [el, mtop] of pushes) {
      el.dataset.wrOmt = el.style.marginTop || '';
      el.dataset.wrPt = '1';
      el.style.marginTop = mtop + 'px';
    }
    const lastBottom = m.length ? m[m.length - 1][0] + m[m.length - 1][1] + shift : g.mt;
    pageCount = Math.max(1, Math.floor(Math.max(0, lastBottom - 1) / stride) + 1, forcePage >= 0 ? forcePage + 2 : 1);
    doc.style.minHeight = pageCount * stride - GAP + 'px';
    renderSheets();
    sizeStage();
    updateTOCPages();
    updateOverlay();
    updatePageIndicator();
  }

  function sizeStage() {
    const hgt = state.view.mode === 'web' ? doc.offsetHeight : pageCount * (geom().ph + GAP) - GAP;
    sizer.style.width = stage.offsetWidth * zoom + 'px';
    sizer.style.height = Math.max(hgt, doc.offsetHeight) * zoom + 'px';
  }

  function fmtPageNum(fmt, n, total) {
    return (fmt || '{n}').replace(/\{n\}/g, n).replace(/\{total\}/g, total);
  }

  function renderSheets() {
    const g = geom();
    sheets.replaceChildren();
    if (state.view.mode === 'web') {
      sheets.append(h('div', { class: 'wr-sheet wr-sheet-web', style: { top: 0, height: '100%', width: '100%', background: state.page.color || '#fff' } }));
      return;
    }
    const pn = state.pageNumber;
    const wm = state.page.watermark;
    for (let i = 0; i < pageCount; i++) {
      const sheet = h('div', { class: 'wr-sheet', style: { top: i * (g.ph + GAP) + 'px', width: g.pw + 'px', height: g.ph + 'px', background: state.page.color || '#fff' } });
      // 版心角标
      const cm = 18;
      [['tl', g.ml - cm, g.mt - cm], ['tr', g.pw - g.mr, g.mt - cm], ['bl', g.ml - cm, g.ph - g.mb], ['br', g.pw - g.mr, g.ph - g.mb]].forEach(([k, x, y]) =>
        sheet.append(h('div', { class: 'wr-corner wr-corner-' + k, style: { left: x + 'px', top: y + 'px', width: cm + 'px', height: cm + 'px' } })));
      const hfText = (part, isFooter) => {
        let t = part.text || '';
        const pnHere = pn.enabled && (pn.pos === 'footer') === isFooter;
        return { t, pnHere };
      };
      for (const [part, isFooter] of [[state.header, false], [state.footer, true]]) {
        const { t, pnHere } = hfText(part, isFooter);
        const style = { left: g.ml + 'px', right: g.mr + 'px' };
        if (isFooter) style.bottom = Math.max(10, g.mb / 2 - 10) + 'px';
        else style.top = Math.max(10, g.mt / 2 - 10) + 'px';
        const box = h('div', { class: 'wr-hf ' + (isFooter ? 'wr-hf-foot' : 'wr-hf-head'), style });
        if (t) box.append(h('div', { style: { textAlign: part.align } }, t));
        if (pnHere) box.append(h('div', { style: { textAlign: pn.align } }, fmtPageNum(pn.format, i + 1, pageCount)));
        sheet.append(box);
      }
      if (wm && wm.text) {
        sheet.append(h('div', { class: 'wr-watermark' + (wm.diagonal !== false ? ' diag' : ''), style: { color: wm.color || '#c0c0c0', fontSize: (wm.size || 72) + 'px', opacity: wm.opacity ?? 0.35 } }, wm.text));
      }
      if (state.page.border) sheet.append(h('div', { class: 'wr-page-border' }));
      sheets.append(sheet);
    }
  }

  function pageOfY(y) {
    return Math.max(0, Math.min(pageCount - 1, Math.floor(y / (geom().ph + GAP))));
  }
  function yInDoc(el) {
    return (el.getBoundingClientRect().top - doc.getBoundingClientRect().top) / zoom;
  }
  function updatePageIndicator() {
    let cur = 1;
    const r = liveRange();
    if (r) {
      let rect = r.getClientRects()[0] || elOf(r.startContainer)?.getBoundingClientRect();
      if (rect) cur = pageOfY((rect.top - doc.getBoundingClientRect().top) / zoom) + 1;
    } else {
      const cr = canvas.getBoundingClientRect();
      cur = pageOfY((cr.top + cr.height / 3 - doc.getBoundingClientRect().top) / zoom) + 1;
    }
    sbPage.textContent = state.view.mode === 'web' ? 'Web 版式' : `第 ${cur} 页，共 ${pageCount} 页`;
  }

  /* ---------- 缩放 / 视图 ---------- */
  function setZoom(z) {
    state.view.zoom = Math.round(z);
    zoom = state.view.zoom / 100;
    zoomCtl.set(state.view.zoom);
    applyPageStyle();
    sizeStage();
    updateOverlay();
    if (state.view.mode === 'web') paginate();
  }
  function fitWidth() { setZoom(((canvas.clientWidth - 48) / geom().pw) * 100); }
  function fitPage() { setZoom(((canvas.clientHeight - 48) / geom().ph) * 100); }

  function setViewMode(mode) {
    state.view.mode = mode;
    root.classList.toggle('wr-reading', mode === 'read');
    doc.contentEditable = mode === 'read' ? 'false' : 'true';
    Object.entries(viewBtns).forEach(([k, b]) => b.classList.toggle('active', k === mode));
    ['page', 'read', 'web'].forEach((k) => E.ribbon?.setActive('view-' + k, k === mode));
    if (mode === 'read') deselectImage();
    paginate();
  }

  function setRuler(on) {
    state.view.ruler = on;
    rulerWrap.style.display = on ? '' : 'none';
    E.ribbon?.setActive('ruler', on);
    drawRuler();
  }

  /* ---------- 标尺 ---------- */
  function drawRuler() {
    if (!state.view.ruler || state.view.mode === 'web') { rulerWrap.style.display = 'none'; return; }
    rulerWrap.style.display = '';
    const g = geom();
    const W = Math.round(g.pw * zoom), H = 20;
    const dpr = window.devicePixelRatio || 1;
    rulerCanvas.width = W * dpr;
    rulerCanvas.height = H * dpr;
    rulerCanvas.style.width = W + 'px';
    rulerCanvas.style.height = H + 'px';
    const c = rulerCanvas.getContext('2d');
    c.scale(dpr, dpr);
    const dark = document.documentElement.dataset.theme === 'dark';
    c.fillStyle = dark ? '#3a3d44' : '#d9dce2';
    c.fillRect(0, 0, W, H);
    c.fillStyle = dark ? '#5a5e67' : '#fff';
    c.fillRect(g.ml * zoom, 2, (g.pw - g.ml - g.mr) * zoom, H - 4);
    c.strokeStyle = dark ? '#aaa' : '#666';
    c.fillStyle = dark ? '#ddd' : '#444';
    c.font = '9px Arial';
    c.textAlign = 'center';
    const cmPx = mm2px(10) * zoom;
    const origin = g.ml * zoom;
    c.beginPath();
    for (let x = origin % (cmPx / 4), i = -Math.floor(origin / (cmPx / 4)); x <= W; x += cmPx / 4, i++) {
      const q = ((i % 4) + 4) % 4;
      if (q === 0) {
        const n = Math.abs(i / 4);
        if (n) c.fillText(String(n), x, 13.5);
      } else {
        const len = q === 2 ? 5 : 3;
        c.moveTo(Math.round(x) + 0.5, H / 2 - len / 2);
        c.lineTo(Math.round(x) + 0.5, H / 2 + len / 2);
      }
    }
    c.stroke();
    // 页边距标记
    c.fillStyle = 'var(--accent)';
    c.fillStyle = getComputedStyle(root).getPropertyValue('--accent') || '#007aff';
    for (const x of [g.ml * zoom, (g.pw - g.mr) * zoom]) {
      c.beginPath();
      c.moveTo(x - 4, H);
      c.lineTo(x + 4, H);
      c.lineTo(x, H - 6);
      c.fill();
    }
  }
  on(rulerCanvas, 'mousemove', (e) => {
    const g = geom();
    const x = e.offsetX;
    const near = Math.abs(x - g.ml * zoom) < 5 || Math.abs(x - (g.pw - g.mr) * zoom) < 5;
    rulerCanvas.style.cursor = near ? 'ew-resize' : 'default';
  });
  on(rulerCanvas, 'mousedown', (e) => {
    const g = geom();
    const x = e.offsetX;
    let side = null;
    if (Math.abs(x - g.ml * zoom) < 5) side = 'left';
    else if (Math.abs(x - (g.pw - g.mr) * zoom) < 5) side = 'right';
    if (!side) return;
    e.preventDefault();
    const rect = rulerCanvas.getBoundingClientRect();
    const move = (ev) => {
      const px = (ev.clientX - rect.left) / zoom;
      const mm = side === 'left' ? px2mm(px) : px2mm(g.pw - px);
      state.page.margins[side] = Math.max(5, Math.min(80, Math.round(mm * 10) / 10));
      applyPageStyle();
      renderSheets();
    };
    const up = () => {
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      ctx.markDirty();
      paginate();
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  });

  /* ---------- 字体/段落格式 ---------- */
  function selectedBlocks() {
    const r = getRange();
    if (!r) return [];
    const SEL = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,th,div:not(.wr-toc):not(.wr-pagebreak):not(.wr-footnotes):not(.wr-cols)';
    const blocks = [];
    if (!r.collapsed) {
      for (const b of doc.querySelectorAll(SEL)) {
        if (r.intersectsNode(b) && !b.querySelector('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,table,div')) blocks.push(b);
      }
    }
    if (!blocks.length) {
      const b = closestIn(r.startContainer, 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,th,div');
      if (b && !b.classList.contains('wr-toc')) blocks.push(b);
    }
    return blocks;
  }

  function wrapSelectionWithMarker() {
    // 利用 fontSize=7 产生 <font size=7> 标记包裹选中文本
    document.execCommand('styleWithCSS', false, false);
    document.execCommand('fontSize', false, '7');
    document.execCommand('styleWithCSS', false, true);
    const marks = [...doc.querySelectorAll('font[size="7"], span[style*="xxx-large"]')];
    return marks;
  }

  function applyFontSize(pt) {
    pt = parseFloat(pt);
    if (!pt || pt < 1 || pt > 400) return;
    run(() => {
      const r = getRange();
      if (!r) return;
      if (r.collapsed) {
        const span = h('span', { style: { fontSize: pt + 'pt' } }, '​');
        r.insertNode(span);
        caretAt(span.firstChild, 1);
        return;
      }
      const marks = wrapSelectionWithMarker();
      const spans = marks.map((f) => {
        const span = document.createElement('span');
        if (f.tagName === 'SPAN') { span.setAttribute('style', f.getAttribute('style')); }
        if (f.color) span.style.color = f.color;
        if (f.face) span.style.fontFamily = f.face;
        span.style.fontSize = pt + 'pt';
        span.append(...f.childNodes);
        span.querySelectorAll('[style*="font-size"]').forEach((x) => { x.style.fontSize = ''; if (!x.getAttribute('style')) x.removeAttribute('style'); });
        span.querySelectorAll('font[size]').forEach((x) => x.removeAttribute('size'));
        f.replaceWith(span);
        return span;
      });
      if (spans.length) {
        const nr = document.createRange();
        nr.setStartBefore(spans[0]);
        nr.setEndAfter(spans[spans.length - 1]);
        setRange(nr);
      }
    });
  }

  function currentFontPt() {
    const r = getRange();
    const el = r ? elOf(r.startContainer) : null;
    if (!el || !doc.contains(el)) return 12;
    return Math.round(parseFloat(getComputedStyle(el).fontSize) * 0.75 * 2) / 2;
  }
  function growFont(dir) {
    const sizes = FONT_SIZES.map((s) => +s.value).sort((a, b) => a - b);
    const cur = currentFontPt();
    let next = dir > 0 ? sizes.find((s) => s > cur + 0.01) : [...sizes].reverse().find((s) => s < cur - 0.01);
    if (next == null) next = dir > 0 ? cur + 2 : Math.max(1, cur - 1);
    applyFontSize(next);
  }

  function applyFontName(name) {
    run(() => { document.execCommand('styleWithCSS', false, true); exec('fontName', name); });
  }

  function toggleInline(cmd) {
    run(() => { document.execCommand('styleWithCSS', false, true); exec(cmd); });
  }

  function setColor(color) {
    run(() => { document.execCommand('styleWithCSS', false, true); exec('foreColor', color === 'auto' || !color ? '#000000' : color); });
  }
  function setHighlight(color) {
    run(() => { document.execCommand('styleWithCSS', false, true); exec('hiliteColor', color || 'transparent'); });
  }

  function clearFormat() {
    run(() => {
      exec('removeFormat');
      exec('unlink');
      for (const b of selectedBlocks()) {
        if (b.tagName === 'TD' || b.tagName === 'TH') continue;
        b.removeAttribute('style');
        b.classList.remove('wr-title', 'wr-subtitle');
        if (!b.className) b.removeAttribute('class');
      }
    });
  }

  function changeCase(mode) {
    run(() => {
      const r = getRange();
      if (!r || r.collapsed) return;
      const walker = document.createTreeWalker(r.commonAncestorContainer.nodeType === 3 ? r.commonAncestorContainer.parentNode : r.commonAncestorContainer, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let n;
      while ((n = walker.nextNode())) if (r.intersectsNode(n)) nodes.push(n);
      const sc = r.startContainer, so = r.startOffset, ec = r.endContainer, eo = r.endOffset;
      for (const t of nodes) {
        const s = t === sc ? so : 0, e = t === ec ? eo : t.length;
        const part = t.data.slice(s, e);
        let out = part;
        if (mode === 'upper') out = part.toUpperCase();
        else if (mode === 'lower') out = part.toLowerCase();
        else if (mode === 'title') out = part.toLowerCase().replace(/(^|[\s\-(])([a-z])/g, (m0, a, b) => a + b.toUpperCase());
        else if (mode === 'sentence') out = part.toLowerCase().replace(/(^\s*|[.!?。！？]\s*)([a-z])/g, (m0, a, b) => a + b.toUpperCase());
        else if (mode === 'toggle') out = [...part].map((ch) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase())).join('');
        else if (mode === 'full') out = part.replace(/[!-~]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0)).replace(/ /g, '　');
        else if (mode === 'half') out = part.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ');
        t.data = t.data.slice(0, s) + out + t.data.slice(e);
      }
      const nr = document.createRange();
      nr.setStart(sc, Math.min(so, sc.length ?? so));
      nr.setEnd(ec, Math.min(eo, ec.length ?? eo));
      setRange(nr);
    });
  }

  function setAlign(a) {
    const cmd = { left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight', justify: 'justifyFull' }[a];
    run(() => {
      document.execCommand('styleWithCSS', false, true);
      exec(cmd);
      // 表格单元格内直接设置
      for (const b of selectedBlocks()) if (b.tagName === 'TD' || b.tagName === 'TH') b.style.textAlign = a;
    });
  }

  function setLineHeight(v) {
    run(() => selectedBlocks().forEach((b) => (b.style.lineHeight = v)));
  }

  function setList(ordered, styleType) {
    run(() => {
      const r = getRange();
      const inList = r && closestIn(r.startContainer, ordered ? 'ol' : 'ul');
      if (!inList || !styleType) exec(ordered ? 'insertOrderedList' : 'insertUnorderedList');
      const r2 = getRange();
      const list = r2 && closestIn(r2.startContainer, ordered ? 'ol' : 'ul');
      if (list && styleType) {
        list.style.listStyleType = styleType;
        // 多段落选区：所有涉及的列表
        doc.querySelectorAll(ordered ? 'ol' : 'ul').forEach((l) => { if (r2.intersectsNode(l)) l.style.listStyleType = styleType; });
      }
    });
  }

  function indent(dir) {
    run(() => {
      const r = getRange();
      if (r && closestIn(r.startContainer, 'li')) exec(dir > 0 ? 'indent' : 'outdent');
      else selectedBlocks().forEach((b) => {
        const cur = parseFloat(b.style.marginLeft) || 0;
        const nv = Math.max(0, cur + dir * 2);
        b.style.marginLeft = nv ? nv + 'em' : '';
      });
    });
  }

  const STYLES = {
    normal: { label: '正文', tag: 'p' },
    title: { label: '标题', tag: 'p', cls: 'wr-title' },
    subtitle: { label: '副标题', tag: 'p', cls: 'wr-subtitle' },
    h1: { label: '标题 1', tag: 'h1' },
    h2: { label: '标题 2', tag: 'h2' },
    h3: { label: '标题 3', tag: 'h3' },
    h4: { label: '标题 4', tag: 'h4' },
    quote: { label: '引用', tag: 'blockquote' },
    code: { label: '代码', tag: 'pre' },
  };
  function applyStyle(key) {
    const st = STYLES[key];
    run(() => {
      const before = selectedBlocks();
      // 已在 blockquote 中切换为其他样式：先取消引用
      exec('formatBlock', st.tag);
      let blocks = selectedBlocks();
      if (!blocks.length) blocks = before;
      for (const b of blocks) {
        if (b.tagName === 'TD' || b.tagName === 'TH' || b.tagName === 'LI') continue;
        b.classList.remove('wr-title', 'wr-subtitle');
        if (st.cls) b.classList.add(st.cls);
        if (!b.className) b.removeAttribute('class');
      }
    });
  }
  function currentStyleKey() {
    const r = getRange();
    if (!r) return null;
    const b = closestIn(r.startContainer, 'p,h1,h2,h3,h4,h5,h6,blockquote,pre');
    if (!b) return 'normal';
    if (b.classList.contains('wr-title')) return 'title';
    if (b.classList.contains('wr-subtitle')) return 'subtitle';
    return { P: 'normal', H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h4', BLOCKQUOTE: 'quote', PRE: 'code' }[b.tagName] || 'normal';
  }

  function setParaShading(color) {
    run(() => selectedBlocks().forEach((b) => (b.style.backgroundColor = color || '')));
  }
  function setParaBorder(kind) {
    run(() => selectedBlocks().forEach((b) => {
      ['border', 'borderTop', 'borderBottom', 'borderLeft', 'borderRight', 'padding'].forEach((p) => (b.style[p] = ''));
      const line = '1px solid #000';
      if (kind === 'box') { b.style.border = line; b.style.padding = '2px 6px'; }
      else if (kind === 'bottom') b.style.borderBottom = line;
      else if (kind === 'top') b.style.borderTop = line;
      else if (kind === 'left') { b.style.borderLeft = '3px solid #000'; b.style.paddingLeft = '8px'; }
      if (!b.getAttribute('style')) b.removeAttribute('style');
    }));
  }

  async function paragraphDialog() {
    const blocks = selectedBlocks();
    const b = blocks[0];
    if (!b) return;
    const cs = getComputedStyle(b);
    const fs = parseFloat(cs.fontSize) || 16;
    const ti = parseFloat(cs.textIndent) || 0;
    const lh = parseFloat(cs.lineHeight);
    const r = await formBox('段落', [
      { name: 'align', label: '对齐方式', type: 'select', value: ['left', 'center', 'right', 'justify'].includes(cs.textAlign) ? cs.textAlign : 'left', options: [{ value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }, { value: 'right', label: '右对齐' }, { value: 'justify', label: '两端对齐' }] },
      { name: 'left', label: '左缩进(字符)', type: 'number', step: 0.5, value: Math.round(((parseFloat(cs.marginLeft) || 0) / fs) * 10) / 10 },
      { name: 'right', label: '右缩进(字符)', type: 'number', step: 0.5, value: Math.round(((parseFloat(cs.marginRight) || 0) / fs) * 10) / 10 },
      { name: 'special', label: '特殊格式', type: 'select', value: ti > 0 ? 'first' : ti < 0 ? 'hanging' : 'none', options: [{ value: 'none', label: '无' }, { value: 'first', label: '首行缩进' }, { value: 'hanging', label: '悬挂缩进' }] },
      { name: 'indentVal', label: '度量值(字符)', type: 'number', step: 0.5, value: ti ? Math.abs(Math.round((ti / fs) * 10) / 10) : 2 },
      { name: 'before', label: '段前(行)', type: 'number', step: 0.5, value: Math.round(((parseFloat(cs.marginTop) || 0) / (lh || fs * 1.6)) * 10) / 10 },
      { name: 'after', label: '段后(行)', type: 'number', step: 0.5, value: Math.round(((parseFloat(cs.marginBottom) || 0) / (lh || fs * 1.6)) * 10) / 10 },
      { name: 'line', label: '行距(倍)', type: 'select', value: String(lh ? Math.round((lh / fs) * 100) / 100 : 1.6), options: ['1', '1.15', '1.3', '1.5', '1.6', '2', '2.5', '3'].concat(lh ? [String(Math.round((lh / fs) * 100) / 100)] : []).filter((v, i, a) => a.indexOf(v) === i) },
    ], { width: 400 });
    if (!r) return;
    run(() => {
      for (const blk of blocks) {
        blk.style.textAlign = r.align;
        blk.style.marginLeft = r.left ? r.left + 'em' : '';
        blk.style.marginRight = r.right ? r.right + 'em' : '';
        blk.style.textIndent = r.special === 'first' ? r.indentVal + 'em' : r.special === 'hanging' ? -r.indentVal + 'em' : '';
        if (r.special === 'hanging') blk.style.paddingLeft = r.indentVal + 'em';
        blk.style.marginTop = r.before ? r.before * +r.line + 'em' : '';
        blk.style.marginBottom = r.after ? r.after * +r.line + 'em' : '';
        blk.style.lineHeight = r.line;
      }
    });
  }

  async function fontDialog() {
    const r0 = getRange();
    const el = r0 ? elOf(r0.startContainer) : null;
    const cs = el ? getComputedStyle(el) : null;
    const fam = cs ? cs.fontFamily.split(',')[0].replace(/["']/g, '') : 'SimSun';
    const r = await formBox('字体', [
      { name: 'font', label: '字体', type: 'select', value: fam, options: FONT_FAMILIES.some((f) => f.value === fam) ? FONT_FAMILIES : [{ value: fam, label: fam }, ...FONT_FAMILIES] },
      { name: 'size', label: '字号(磅)', type: 'number', step: 0.5, value: currentFontPt() },
      { name: 'color', label: '颜色', type: 'color', value: '#000000' },
      { name: 'bold', label: '加粗', type: 'checkbox', value: document.queryCommandState('bold') },
      { name: 'italic', label: '倾斜', type: 'checkbox', value: document.queryCommandState('italic') },
      { name: 'underline', label: '下划线', type: 'checkbox', value: document.queryCommandState('underline') },
      { name: 'strike', label: '删除线', type: 'checkbox', value: document.queryCommandState('strikeThrough') },
      { name: 'spacing', label: '字符间距(px)', type: 'number', step: 0.5, value: parseFloat(cs?.letterSpacing) || 0 },
    ], { width: 380 });
    if (!r) return;
    run(() => {
      document.execCommand('styleWithCSS', false, true);
      exec('fontName', r.font);
      exec('foreColor', r.color);
      if (document.queryCommandState('bold') !== r.bold) exec('bold');
      if (document.queryCommandState('italic') !== r.italic) exec('italic');
      if (document.queryCommandState('underline') !== r.underline) exec('underline');
      if (document.queryCommandState('strikeThrough') !== r.strike) exec('strikeThrough');
    });
    if (r.size) applyFontSize(r.size);
    if (r.spacing != null) run(() => {
      const marks = wrapSelectionWithMarker();
      marks.forEach((f) => {
        const span = document.createElement('span');
        if (f.tagName === 'SPAN') span.setAttribute('style', f.getAttribute('style'));
        span.style.fontSize = '';
        if (f.color) span.style.color = f.color;
        if (f.face) span.style.fontFamily = f.face;
        span.style.letterSpacing = r.spacing ? r.spacing + 'px' : '';
        span.append(...f.childNodes);
        f.replaceWith(span);
      });
    });
  }

  /* ---------- 格式刷 ---------- */
  function pickPainter() {
    const r = getRange();
    const el = r ? elOf(r.startContainer) : null;
    if (!el) return;
    const cs = getComputedStyle(el);
    let underline = false, strike = false, bg = null;
    for (let e = el; e && e !== doc; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.textDecorationLine.includes('underline')) underline = true;
      if (s.textDecorationLine.includes('line-through')) strike = true;
      if (!bg && e.tagName === 'SPAN' && s.backgroundColor !== 'rgba(0, 0, 0, 0)') bg = s.backgroundColor;
    }
    painter = { font: cs.fontFamily, size: Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2, bold: parseInt(cs.fontWeight, 10) >= 600, italic: cs.fontStyle === 'italic', underline, strike, color: cs.color, bg };
    root.classList.add('wr-painting');
    E.ribbon?.setActive('painter', true);
    toast('格式刷：选择要应用格式的文本');
  }
  function applyPainter() {
    const p = painter;
    painter = null;
    root.classList.remove('wr-painting');
    E.ribbon?.setActive('painter', false);
    const r = getRange();
    if (!r || r.collapsed) return;
    run(() => {
      exec('removeFormat');
      document.execCommand('styleWithCSS', false, true);
      exec('fontName', p.font.split(',')[0].replace(/["']/g, ''));
      exec('foreColor', p.color);
      if (p.bg) exec('hiliteColor', p.bg);
      if (p.bold) exec('bold');
      if (p.italic) exec('italic');
      if (p.underline) exec('underline');
      if (p.strike) exec('strikeThrough');
    });
    applyFontSize(p.size);
  }

  /* ---------- 插入 ---------- */
  /** 在当前顶层块之后插入块元素（当前块为空段落时替换之） */
  function insertBlock(el, { replaceEmpty = true } = {}) {
    const r = getRange();
    let tb = r ? topBlock(r.startContainer) : null;
    if (!tb) tb = doc.lastElementChild;
    // 光标在段落中间时拆分段落
    if (tb && r && /^(P|H\d)$/.test(tb.tagName) && tb.textContent.length) {
      const atStart = charOffset(tb, r.startContainer, r.startOffset) === 0;
      const atEnd = charOffset(tb, r.startContainer, r.startOffset) >= tb.textContent.length;
      if (atStart) { tb.before(el); return el; }
      if (!atEnd) {
        const rr = document.createRange();
        rr.setStart(r.startContainer, r.startOffset);
        rr.setEndAfter(tb);
        const frag = rr.extractContents();
        tb.after(el);
        el.after(frag);
        if (!tb.textContent && !tb.querySelector('img')) tb.innerHTML = '<br>';
        const nb = el.nextElementSibling;
        if (nb && !nb.textContent && !nb.querySelector('img')) nb.innerHTML = '<br>';
        return el;
      }
    }
    if (tb && replaceEmpty && tb.tagName === 'P' && !tb.textContent.trim() && !tb.querySelector('img,.wr-textbox')) {
      tb.replaceWith(el);
    } else if (tb && !tb.classList.contains('wr-footnotes')) tb.after(el);
    else if (tb) tb.before(el);
    else doc.append(el);
    if (!el.nextElementSibling || el.nextElementSibling.classList.contains('wr-footnotes')) el.after(h('p', null, h('br')));
    return el;
  }

  function insertPageBreak() {
    run(() => {
      const pb = h('div', { class: 'wr-pagebreak', contenteditable: 'false' });
      insertBlock(pb, { replaceEmpty: false });
      let next = pb.nextElementSibling;
      if (!next || !/^(P|H\d|UL|OL|TABLE|BLOCKQUOTE|PRE)$/.test(next.tagName)) { next = h('p', null, h('br')); pb.after(next); }
      caretInto(next);
    });
  }
  function insertBlankPage() {
    run(() => {
      const pb1 = h('div', { class: 'wr-pagebreak', contenteditable: 'false' });
      insertBlock(pb1, { replaceEmpty: false });
      const p = h('p', null, h('br'));
      const pb2 = h('div', { class: 'wr-pagebreak', contenteditable: 'false' });
      pb1.after(p, pb2);
      if (!pb2.nextElementSibling) pb2.after(h('p', null, h('br')));
      caretInto(p);
    });
  }

  function insertTable(rows, cols, cls = '') {
    run(() => {
      const tpl = document.createElement('template');
      tpl.innerHTML = T.tableHTML(rows, cols, cls);
      const table = tpl.content.firstChild;
      const r = getRange();
      const cell = r && closestIn(r.startContainer, 'td,th');
      if (cell) { cell.append(table); } else insertBlock(table);
      caretInto(table.rows[0].cells[0]);
    });
  }
  async function insertTableDialog() {
    const r = await formBox('插入表格', [
      { name: 'rows', label: '行数', type: 'number', value: 3, min: 1, max: 200 },
      { name: 'cols', label: '列数', type: 'number', value: 4, min: 1, max: 30 },
      { name: 'style', label: '表格样式', type: 'select', value: '', options: [{ value: '', label: '普通网格' }, { value: 'wr-ts-blue', label: '蓝色标题行' }, { value: 'wr-ts-orange', label: '橙色标题行' }, { value: 'wr-ts-three', label: '三线表' }, { value: 'wr-tb-none', label: '无框线' }] },
    ], { width: 340 });
    if (r && r.rows > 0 && r.cols > 0) insertTable(Math.min(200, r.rows), Math.min(30, r.cols), r.style);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }
  async function insertImageSrc(src, extraAttrs = {}) {
    let w = 300;
    try {
      const im = await loadImage(src);
      const g = geom();
      w = Math.min(im.naturalWidth || 300, g.pw - g.ml - g.mr);
    } catch {}
    run(() => {
      const img = h('img', { src, style: { width: Math.round(w) + 'px' }, ...extraAttrs });
      const r = getRange();
      if (r) {
        r.deleteContents();
        r.insertNode(img);
        const nr = document.createRange();
        nr.setStartAfter(img);
        nr.collapse(true);
        setRange(nr);
      } else {
        const p = h('p', null, img);
        insertBlock(p);
      }
      setTimeout(() => { paginate(); }, 50);
    });
  }
  async function insertImageFile(f) {
    if (!f || !f.type.startsWith('image/')) return;
    let src = await readFileAs(f, 'dataURL');
    // 大图压缩，避免文档过大
    if (f.size > 1.5 * 1024 * 1024 && !/svg|gif/.test(f.type)) {
      try {
        const im = await loadImage(src);
        const s = Math.min(1, 2000 / Math.max(im.naturalWidth, im.naturalHeight));
        const cv = h('canvas', { width: Math.round(im.naturalWidth * s), height: Math.round(im.naturalHeight * s) });
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        src = cv.toDataURL('image/jpeg', 0.88);
      } catch {}
    }
    await insertImageSrc(src);
  }
  async function insertImage() {
    focusDoc();
    const keep = getRange()?.cloneRange();
    const f = await pickFile('image/*');
    if (!f) return;
    if (keep) savedRange = keep;
    await insertImageFile(f);
  }

  const SHAPES = {
    rect: { label: '矩形', vb: '0 0 200 120', svg: (f, s) => `<rect x="2" y="2" width="196" height="116" fill="${f}" stroke="${s}" stroke-width="3"/>` },
    roundrect: { label: '圆角矩形', vb: '0 0 200 120', svg: (f, s) => `<rect x="2" y="2" width="196" height="116" rx="20" fill="${f}" stroke="${s}" stroke-width="3"/>` },
    ellipse: { label: '椭圆', vb: '0 0 200 120', svg: (f, s) => `<ellipse cx="100" cy="60" rx="97" ry="57" fill="${f}" stroke="${s}" stroke-width="3"/>` },
    triangle: { label: '三角形', vb: '0 0 200 160', svg: (f, s) => `<polygon points="100,3 197,157 3,157" fill="${f}" stroke="${s}" stroke-width="3"/>` },
    diamond: { label: '菱形', vb: '0 0 200 140', svg: (f, s) => `<polygon points="100,3 197,70 100,137 3,70" fill="${f}" stroke="${s}" stroke-width="3"/>` },
    star: { label: '五角星', vb: '0 0 200 190', svg: (f, s) => `<polygon points="100,4 124,72 196,73 139,117 160,186 100,145 40,186 61,117 4,73 76,72" fill="${f}" stroke="${s}" stroke-width="3"/>` },
    arrow: { label: '右箭头', vb: '0 0 200 120', svg: (f, s) => `<polygon points="3,35 125,35 125,4 197,60 125,116 125,85 3,85" fill="${f}" stroke="${s}" stroke-width="3"/>` },
    callout: { label: '对话框', vb: '0 0 200 150', svg: (f, s) => `<path d="M12 3h176a9 9 0 0 1 9 9v90a9 9 0 0 1-9 9H80l-40 36 6-36H12a9 9 0 0 1-9-9V12a9 9 0 0 1 9-9z" fill="${f}" stroke="${s}" stroke-width="3"/>` },
    line: { label: '直线', vb: '0 0 200 10', svg: (f, s) => `<line x1="0" y1="5" x2="200" y2="5" stroke="${s}" stroke-width="4"/>` },
    heart: { label: '心形', vb: '0 0 200 180', svg: (f, s) => `<path d="M100 175 C20 120 3 80 3 50 A47 47 0 0 1 100 30 A47 47 0 0 1 197 50 C197 80 180 120 100 175z" fill="${f}" stroke="${s}" stroke-width="3"/>` },
  };
  function shapeSrc(type, fill = '#4472c4', stroke = '#2f528f') {
    const sh = SHAPES[type];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${sh.vb}" preserveAspectRatio="none">${sh.svg(fill, stroke)}</svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function insertShape(type) {
    const sh = SHAPES[type];
    const [, , vw, vh] = sh.vb.split(' ').map(Number);
    const w = 160;
    run(() => {
      const img = h('img', { src: shapeSrc(type), dataset: { shape: type, fill: '#4472c4' }, style: { width: w + 'px', height: Math.max(4, Math.round((w * vh) / vw)) + 'px' } });
      const r = getRange();
      if (r) { r.collapse(false); r.insertNode(img); } else insertBlock(h('p', null, img));
      selectImage(img);
    });
  }

  function insertTextBox() {
    run(() => {
      const box = h('span', { class: 'wr-textbox', style: { width: '220px' } }, '在此输入文字');
      const r = getRange();
      if (r) { r.collapse(false); r.insertNode(box); } else insertBlock(h('p', null, box));
      const sr = document.createRange();
      sr.selectNodeContents(box);
      setRange(sr);
    });
  }

  async function linkDialog() {
    const r0 = getRange();
    const a = r0 && closestIn(r0.startContainer, 'a');
    const keep = r0?.cloneRange();
    const text = a ? a.textContent : r0 ? r0.toString() : '';
    const res = await formBox(a ? '编辑超链接' : '插入超链接', [
      { name: 'text', label: '要显示的文字', value: text },
      { name: 'url', label: '地址', value: a ? a.getAttribute('href') : 'https://', placeholder: 'https://' },
    ]);
    if (!res || !res.url || res.url === 'https://') return;
    let url = res.url.trim();
    if (!/^(https?:|mailto:|#|tel:)/i.test(url)) url = 'https://' + url;
    if (keep) savedRange = keep;
    run(() => {
      if (a) {
        a.href = url;
        if (res.text && res.text !== a.textContent) a.textContent = res.text;
        return;
      }
      const rr = getRange();
      if (rr && !rr.collapsed && res.text === text) exec('createLink', url);
      else {
        const link = h('a', { href: url }, res.text || url);
        if (rr) { rr.deleteContents(); rr.insertNode(link); const nr = document.createRange(); nr.setStartAfter(link); nr.collapse(true); setRange(nr); }
      }
    });
  }

  function insertText(text) {
    run(() => exec('insertText', text));
  }

  function insertHR() {
    run(() => insertBlock(h('hr')));
  }

  /* ---------- 批注 ---------- */
  async function newComment() {
    const r = getRange();
    if (!r || r.collapsed) { toast('请先选中要批注的文字'); return; }
    const keep = r.cloneRange();
    const text = await promptBox('新建批注', `为"${keep.toString().slice(0, 30)}"添加批注：`, '');
    if (!text) return;
    savedRange = keep;
    const id = uid();
    state.comments[id] = { text, author: '我', time: Date.now() };
    run(() => {
      exec('createLink', 'wr-cmt:' + id);
      doc.querySelectorAll(`a[href="wr-cmt:${id}"]`).forEach((a) => {
        const span = h('span', { class: 'wr-comment', dataset: { cid: id }, title: text });
        span.append(...a.childNodes);
        a.replaceWith(span);
      });
    });
    panes.openComments();
  }
  function deleteComment(id) {
    run(() => {
      doc.querySelectorAll(`.wr-comment[data-cid="${id}"]`).forEach((s) => s.replaceWith(...s.childNodes));
      delete state.comments[id];
    }, { focus: false });
    panes.refreshComments();
  }
  function deleteAllComments() {
    run(() => {
      doc.querySelectorAll('.wr-comment').forEach((s) => s.replaceWith(...s.childNodes));
      state.comments = {};
    }, { focus: false });
    panes.refreshComments();
  }

  /* ---------- 脚注 ---------- */
  async function insertFootnote() {
    const keep = getRange()?.cloneRange();
    const text = await promptBox('插入脚注', '脚注内容', '');
    if (!text) return;
    if (keep) savedRange = keep;
    const id = uid();
    run(() => {
      const r = getRange();
      const ref = h('sup', { class: 'wr-fnref', contenteditable: 'false', dataset: { fn: id } }, '*');
      if (r) { r.collapse(false); r.insertNode(ref); const nr = document.createRange(); nr.setStartAfter(ref); nr.collapse(true); setRange(nr); }
      let box = doc.querySelector('.wr-footnotes');
      if (!box) { box = h('div', { class: 'wr-footnotes', contenteditable: 'false' }, h('ol')); doc.append(box); }
      box.querySelector('ol').append(h('li', { dataset: { fn: id } }, text));
    });
  }
  function renumberFootnotes() {
    const refs = [...doc.querySelectorAll('.wr-fnref')];
    const box = doc.querySelector('.wr-footnotes');
    if (!box) return;
    const ol = box.querySelector('ol');
    const items = new Map([...ol.children].map((li) => [li.dataset.fn, li]));
    const order = [];
    refs.forEach((r, i) => {
      if (r.textContent !== String(i + 1)) r.textContent = String(i + 1);
      const li = items.get(r.dataset.fn);
      if (li) order.push(li);
    });
    const same = order.length === ol.children.length && order.every((li, i) => ol.children[i] === li);
    if (!same) { ol.replaceChildren(...order); }
    if (!order.length) box.remove();
    else if (box.nextSibling) doc.append(box);
  }

  /* ---------- 目录 ---------- */
  function headingText(hd) {
    const c = hd.cloneNode(true);
    c.querySelectorAll('.wr-fnref').forEach((x) => x.remove());
    return c.textContent.trim();
  }
  function headingList() {
    return [...doc.querySelectorAll('h1,h2,h3')].filter((x) => !x.closest('.wr-toc') && x.textContent.trim());
  }
  function buildTOC(toc) {
    const hs = headingList();
    hs.forEach((hd) => { if (!hd.id) hd.id = 'wr-h-' + uid(); });
    toc.replaceChildren(h('div', { class: 'wr-toc-title' }, '目　录'),
      ...hs.map((hd) => h('div', { class: `wr-toc-item wr-toc-l${hd.tagName[1]}`, dataset: { target: hd.id } },
        h('span', { class: 'wr-toc-text' }, headingText(hd)), h('span', { class: 'wr-toc-dots' }), h('span', { class: 'wr-toc-page' }, '1'))));
    if (!hs.length) toc.append(h('div', { class: 'wr-toc-empty' }, '未找到标题。请使用"标题 1/2/3"样式后更新目录。'));
  }
  function insertTOC() {
    run(() => {
      let toc = doc.querySelector('.wr-toc');
      if (!toc) {
        toc = h('div', { class: 'wr-toc', contenteditable: 'false' });
        const r = getRange();
        if (!r) doc.prepend(toc); else insertBlock(toc);
      }
      buildTOC(toc);
    });
    paginate();
    toast('目录已生成');
  }
  function updateTOC() {
    const tocs = doc.querySelectorAll('.wr-toc');
    if (!tocs.length) { toast('文档中还没有目录'); return; }
    run(() => tocs.forEach(buildTOC), { focus: false });
    paginate();
    toast('目录已更新');
  }
  function deleteTOC() {
    run(() => doc.querySelectorAll('.wr-toc').forEach((t) => t.remove()), { focus: false });
  }
  function updateTOCPages() {
    doc.querySelectorAll('.wr-toc-item').forEach((it) => {
      const hd = doc.querySelector('#' + CSS.escape(it.dataset.target || ''));
      const span = it.querySelector('.wr-toc-page');
      if (!hd || !span) return;
      const pg = String(pageOfY(yInDoc(hd)) + 1);
      if (span.textContent !== pg) span.textContent = pg;
    });
  }

  /* ---------- 表格操作 ---------- */
  function currentCell() {
    const r = getRange();
    return r ? closestIn(r.startContainer, 'td,th') : null;
  }
  function targetCells() {
    if (selCells.length) return selCells;
    const c = currentCell();
    return c ? [c] : [];
  }
  function clearCellSel() {
    selCells.forEach((c) => c.classList.remove('wr-cell-sel'));
    selCells = [];
  }
  function tableOp(op, arg) {
    const cell = selCells[0] || currentCell();
    if (!cell) return;
    const table = cell.closest('table');
    run(() => {
      const g = T.buildGrid(table);
      const p = g.pos.get(cell);
      switch (op) {
        case 'rowAbove': T.insertRowAt(table, p.r); break;
        case 'rowBelow': { const tr = T.insertRowAt(table, p.r + p.rs); caretInto(tr.cells[0] || cell); break; }
        case 'colLeft': T.insertColAt(table, p.c); break;
        case 'colRight': T.insertColAt(table, p.c + p.cs); break;
        case 'delRow': {
          const rows = new Set(targetCells().map((c) => g.pos.get(c).r));
          [...rows].sort((a, b) => b - a).forEach((r) => T.deleteRow(table, r));
          clearCellSel();
          break;
        }
        case 'delCol': {
          const cols = new Set(targetCells().map((c) => g.pos.get(c).c));
          [...cols].sort((a, b) => b - a).forEach((c) => T.deleteCol(table, c));
          clearCellSel();
          break;
        }
        case 'delTable': table.remove(); clearCellSel(); break;
        case 'merge': {
          if (selCells.length < 2) { toast('请先拖动鼠标选择多个单元格'); return; }
          const first = T.mergeCells(table, selCells);
          clearCellSel();
          if (first) caretInto(first, true);
          break;
        }
        case 'split':
          if (!T.splitCell(table, cell)) toast('只能拆分已合并的单元格');
          break;
        case 'bg': targetCells().forEach((c) => (c.style.backgroundColor = arg || '')); break;
        case 'align': targetCells().forEach((c) => (c.style.textAlign = arg)); break;
        case 'valign': targetCells().forEach((c) => (c.style.verticalAlign = arg)); break;
        case 'border':
          table.classList.remove('wr-tb-none', 'wr-tb-outer', 'wr-tb-hz');
          if (arg) table.classList.add(arg);
          break;
        case 'style':
          table.classList.remove('wr-ts-blue', 'wr-ts-orange', 'wr-ts-three');
          if (arg) table.classList.add(arg);
          break;
        case 'distribute':
          table.querySelectorAll('td,th').forEach((c) => (c.style.width = ''));
          table.querySelectorAll('col').forEach((c) => c.remove());
          break;
        case 'header': {
          const tr = table.rows[0];
          [...tr.cells].forEach((c) => {
            const n = document.createElement(c.tagName === 'TH' ? 'td' : 'th');
            for (const a of c.attributes) n.setAttribute(a.name, a.value);
            n.append(...c.childNodes);
            c.replaceWith(n);
          });
          break;
        }
      }
      if (!table.isConnected || !table.rows.length) table.remove();
    });
  }

  // 拖动选择多个单元格 / 调整列宽
  let colDrag = null;
  on(doc, 'mousedown', (e) => {
    if (e.button !== 0) return;
    const td = e.target.closest?.('td,th');
    clearCellSel();
    if (painter) return;
    if (td && doc.contains(td)) {
      const rect = td.getBoundingClientRect();
      if (rect.right - e.clientX < 5 && rect.right - e.clientX > -3) {
        // 列宽拖动
        e.preventDefault();
        const table = td.closest('table');
        const g = T.buildGrid(table);
        const p = g.pos.get(td);
        const col = p.c + p.cs - 1;
        const firstRowCells = [];
        for (let c = 0; c < g.cols; c++) {
          const cell = g.grid[0][c];
          if (!firstRowCells.includes(cell)) firstRowCells.push(cell);
        }
        const widths = firstRowCells.map((c) => c.getBoundingClientRect().width / zoom);
        firstRowCells.forEach((c, i) => (c.style.width = widths[i] + 'px'));
        const leftCell = g.grid[0][col];
        const rightCell = g.grid[0][col + 1];
        colDrag = { x: e.clientX, leftCell, rightCell, lw: leftCell.getBoundingClientRect().width / zoom, rw: rightCell ? rightCell.getBoundingClientRect().width / zoom : 0 };
        commit();
        return;
      }
      cellAnchor = td;
    } else cellAnchor = null;
  });
  on(document, 'mousemove', (e) => {
    if (colDrag) {
      const dx = (e.clientX - colDrag.x) / zoom;
      const lw = Math.max(24, colDrag.lw + dx);
      const real = lw - colDrag.lw;
      colDrag.leftCell.style.width = lw + 'px';
      if (colDrag.rightCell) colDrag.rightCell.style.width = Math.max(24, colDrag.rw - real) + 'px';
      return;
    }
    if (!cellAnchor || e.buttons !== 1) return;
    const td = e.target.closest?.('td,th');
    if (!td || td === cellAnchor || td.closest('table') !== cellAnchor.closest('table')) {
      if (td === cellAnchor && selCells.length) clearCellSel();
      return;
    }
    const cells = T.cellsInRect(cellAnchor.closest('table'), cellAnchor, td);
    clearCellSel();
    selCells = cells;
    cells.forEach((c) => c.classList.add('wr-cell-sel'));
    scheduleState();
  });
  on(document, 'mouseup', () => {
    if (colDrag) { colDrag = null; afterChange(false); record(); }
    cellAnchor = null;
  });
  on(doc, 'mousemove', (e) => {
    if (colDrag) return;
    const td = e.target.closest?.('td,th');
    if (!td) { doc.style.cursor = ''; return; }
    const rect = td.getBoundingClientRect();
    doc.style.cursor = rect.right - e.clientX < 5 && rect.right - e.clientX > -3 ? 'col-resize' : '';
  });

  /* ---------- 图片选择/缩放 ---------- */
  function selectImage(img) {
    if (selectedImg === img) { updateOverlay(); return; }
    deselectImage();
    selectedImg = img;
    img.classList.add('wr-img-sel');
    overlay.style.display = 'block';
    updateOverlay();
    scheduleState();
  }
  function deselectImage() {
    if (!selectedImg) return;
    selectedImg.classList.remove('wr-img-sel');
    if (!selectedImg.className) selectedImg.removeAttribute('class');
    selectedImg = null;
    overlay.style.display = 'none';
    scheduleState();
  }
  function updateOverlay() {
    if (!selectedImg) return;
    if (!doc.contains(selectedImg)) { deselectImage(); return; }
    const sr = stage.getBoundingClientRect();
    const r = selectedImg.getBoundingClientRect();
    Object.assign(overlay.style, {
      left: (r.left - sr.left) / zoom + 'px', top: (r.top - sr.top) / zoom + 'px',
      width: r.width / zoom + 'px', height: r.height / zoom + 'px',
    });
  }
  ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((dir) => {
    const hd = h('div', { class: 'wr-h wr-h-' + dir });
    hd.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const img = selectedImg;
      if (!img) return;
      commit();
      const r = img.getBoundingClientRect();
      const w0 = r.width / zoom, h0 = r.height / zoom, ratio = w0 / h0;
      const x0 = e.clientX, y0 = e.clientY;
      const keep = dir.length === 2;
      const move = (ev) => {
        let dx = (ev.clientX - x0) / zoom, dy = (ev.clientY - y0) / zoom;
        if (dir.includes('w')) dx = -dx;
        if (dir.includes('n')) dy = -dy;
        let w = w0, hh = h0;
        if (dir.includes('e') || dir.includes('w')) w = Math.max(10, w0 + dx);
        if (dir.includes('n') || dir.includes('s')) hh = Math.max(4, h0 + dy);
        if (keep) { if (Math.abs(dx) > Math.abs(dy)) hh = w / ratio; else w = hh * ratio; }
        img.style.width = Math.round(w) + 'px';
        img.style.height = keep && !img.dataset.shape ? 'auto' : Math.round(hh) + 'px';
        if (keep && !img.dataset.shape) img.style.height = '';
        updateOverlay();
      };
      const up = () => {
        removeEventListener('mousemove', move);
        removeEventListener('mouseup', up);
        afterChange(false);
        record();
      };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    });
    overlay.append(hd);
  });
  overlay.append(h('div', { class: 'wr-img-size' }));

  function imageOp(op, arg) {
    const img = selectedImg;
    if (!img) return;
    run(() => {
      switch (op) {
        case 'wrap':
          img.style.float = '';
          img.style.display = '';
          img.style.margin = '';
          if (arg === 'left') { img.style.float = 'left'; img.style.margin = '4px 12px 4px 0'; }
          else if (arg === 'right') { img.style.float = 'right'; img.style.margin = '4px 0 4px 12px'; }
          else if (arg === 'center') { img.style.display = 'block'; img.style.margin = '6px auto'; }
          break;
        case 'border': img.style.border = img.style.border ? '' : '1px solid #000'; break;
        case 'shadow': img.style.boxShadow = img.style.boxShadow ? '' : '3px 3px 8px rgba(0,0,0,.35)'; break;
        case 'radius': img.style.borderRadius = img.style.borderRadius ? '' : '12px'; break;
        case 'reset': img.style.width = ''; img.style.height = ''; break;
        case 'size':
          img.style.width = arg.w + 'px';
          img.style.height = arg.h ? arg.h + 'px' : '';
          break;
        case 'fill':
          if (img.dataset.shape) { img.dataset.fill = arg; img.src = shapeSrc(img.dataset.shape, arg, arg === 'transparent' ? '#2f528f' : shade(arg)); }
          break;
        case 'delete': img.remove(); break;
      }
    }, { focus: false });
    if (op === 'delete') deselectImage();
    else setTimeout(updateOverlay, 0);
  }
  function shade(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#333';
    const n = parseInt(m[1], 16);
    const f = (v) => Math.max(0, Math.round(v * 0.7)).toString(16).padStart(2, '0');
    return '#' + f(n >> 16) + f((n >> 8) & 255) + f(n & 255);
  }
  async function imageSizeDialog() {
    const img = selectedImg;
    if (!img) return;
    const r = img.getBoundingClientRect();
    const res = await formBox('图片大小', [
      { name: 'w', label: '宽度(像素)', type: 'number', value: Math.round(r.width / zoom) },
      { name: 'h', label: '高度(像素)', type: 'number', value: Math.round(r.height / zoom) },
      { name: 'lock', label: '锁定纵横比', type: 'checkbox', value: !img.dataset.shape },
    ], { width: 320 });
    if (!res) return;
    imageOp('size', { w: res.w, h: res.lock ? Math.round((res.w * r.height) / r.width) : res.h });
  }

  /* ---------- 页面设置 ---------- */
  function updatePage(patch) {
    commit();
    Object.assign(state.page, patch);
    ctx.markDirty();
    paginate();
  }
  async function customMargins() {
    const m = state.page.margins;
    const cm = (v) => Math.round(v) / 10;
    const r = await formBox('页边距（厘米）', [
      { name: 'top', label: '上', type: 'number', step: 0.01, value: cm(m.top * 10) },
      { name: 'bottom', label: '下', type: 'number', step: 0.01, value: cm(m.bottom * 10) },
      { name: 'left', label: '左', type: 'number', step: 0.01, value: cm(m.left * 10) },
      { name: 'right', label: '右', type: 'number', step: 0.01, value: cm(m.right * 10) },
    ], { width: 320 });
    if (!r) return;
    const mm = (v) => Math.max(0, Math.min(100, (+v || 0) * 10));
    updatePage({ margins: { top: mm(r.top), bottom: mm(r.bottom), left: mm(r.left), right: mm(r.right) } });
  }
  function setColumns(n) {
    run(() => {
      const r = getRange();
      let blocks = [...doc.children].filter((c) => !c.classList.contains('wr-footnotes'));
      if (r && !r.collapsed) blocks = blocks.filter((c) => r.intersectsNode(c));
      const wrappers = new Set(blocks.filter((b) => b.classList.contains('wr-cols')));
      if (r) { const w = closestIn(r.startContainer, '.wr-cols'); if (w) wrappers.add(w); }
      if (wrappers.size) {
        wrappers.forEach((w) => {
          if (n <= 1) w.replaceWith(...w.childNodes);
          else w.style.columnCount = n;
        });
        return;
      }
      if (n <= 1 || !blocks.length) return;
      const wrap = h('div', { class: 'wr-cols', style: { columnCount: n } });
      blocks[0].before(wrap);
      wrap.append(...blocks);
      ensureTrailingParagraph();
    });
  }
  async function watermarkDialog() {
    const wm = state.page.watermark || {};
    const r = await formBox('自定义水印', [
      { name: 'text', label: '水印文字', value: wm.text || '机密' },
      { name: 'size', label: '字号(px)', type: 'number', value: wm.size || 72 },
      { name: 'color', label: '颜色', type: 'color', value: wm.color || '#c0c0c0' },
      { name: 'opacity', label: '透明度(0-1)', type: 'number', step: 0.05, value: wm.opacity ?? 0.35 },
      { name: 'diagonal', label: '倾斜', type: 'checkbox', value: wm.diagonal !== false },
    ], { width: 340 });
    if (r) updatePage({ watermark: r.text ? r : null });
  }

  async function headerFooterDialog(focus = 'header') {
    const r = await formBox('页眉和页脚', [
      { name: 'header', label: '页眉文字', value: state.header.text },
      { name: 'headerAlign', label: '页眉对齐', type: 'select', value: state.header.align, options: [{ value: 'left', label: '左' }, { value: 'center', label: '居中' }, { value: 'right', label: '右' }] },
      { name: 'footer', label: '页脚文字', value: state.footer.text },
      { name: 'footerAlign', label: '页脚对齐', type: 'select', value: state.footer.align, options: [{ value: 'left', label: '左' }, { value: 'center', label: '居中' }, { value: 'right', label: '右' }] },
    ], { width: 420 });
    void focus;
    if (!r) return;
    commit();
    state.header = { text: r.header, align: r.headerAlign };
    state.footer = { text: r.footer, align: r.footerAlign };
    ctx.markDirty();
    renderSheets();
  }
  function setPageNumber(patch) {
    state.pageNumber = { ...state.pageNumber, ...patch };
    ctx.markDirty();
    renderSheets();
  }

  /* ---------- 统计 ---------- */
  function stats() {
    const text = doc.innerText.replace(/​/g, '');
    const cjk = (text.match(/[一-鿿㐀-䶿豈-﫿]/g) || []).length;
    const cjkPunct = (text.match(/[　-〿＀-￯‘-‟…—]/g) || []).length;
    const eng = (text.replace(/[一-鿿㐀-䶿豈-﫿]/g, ' ').match(/[A-Za-z0-9]+(?:['’.-][A-Za-z0-9]+)*/g) || []).length;
    const noSpace = text.replace(/\s/g, '').length;
    const withSpace = text.replace(/\n/g, '').length;
    const paras = [...doc.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre')].filter((p) => p.textContent.trim()).length;
    return { pages: pageCount, words: cjk + cjkPunct + eng, cjk, eng, noSpace, withSpace, paras };
  }
  function updateStats() {
    const s = stats();
    const r = liveRange();
    if (r && !r.collapsed) {
      const t = r.toString();
      const n = (t.match(/[一-鿿]/g) || []).length + (t.replace(/[一-鿿]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
      sbWords.textContent = `字数：${n}/${s.words}`;
    } else sbWords.textContent = `字数：${s.words}`;
  }

  /* ---------- 打印 / 导出 ---------- */
  function cssContent(fmt) {
    const parts = (fmt || '{n}').split(/(\{n\}|\{total\})/).filter(Boolean).map((s) => (s === '{n}' ? 'counter(page)' : s === '{total}' ? 'counter(pages)' : JSON.stringify(s)));
    return parts.join(' ');
  }
  function print() {
    const { w, h: hh } = pageDims(state.page);
    const m = state.page.margins;
    const boxes = [];
    const pos = (isFooter, align) => `@${isFooter ? 'bottom' : 'top'}-${align === 'left' ? 'left' : align === 'right' ? 'right' : 'center'}`;
    const used = {};
    const add = (key, content) => { used[key] = used[key] ? used[key] + ' " " ' + content : content; };
    if (state.header.text) add(pos(false, state.header.align), JSON.stringify(state.header.text));
    if (state.footer.text) add(pos(true, state.footer.align), JSON.stringify(state.footer.text));
    if (state.pageNumber.enabled) add(pos(state.pageNumber.pos === 'footer', state.pageNumber.align), cssContent(state.pageNumber.format));
    for (const [k, v] of Object.entries(used)) boxes.push(`${k} { content: ${v}; font-size: 9pt; color: #555; font-family: 'Microsoft YaHei', sans-serif; }`);
    const wm = state.page.watermark;
    const css = `${CONTENT_CSS}
@page { size: ${w}mm ${hh}mm; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; ${boxes.join(' ')} }
html, body { margin: 0; background: ${state.page.color || '#fff'}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.wr-doc { padding: 0; }
.wr-doc .wr-comment { background: none; border: 0; }
.wr-doc .wr-toc-item { color: inherit; }
.wr-wm { position: fixed; left: 0; right: 0; top: 40%; text-align: center; pointer-events: none; ${wm ? `color: ${wm.color || '#c0c0c0'}; font-size: ${wm.size || 72}px; opacity: ${wm.opacity ?? 0.35}; transform: rotate(${wm.diagonal !== false ? -35 : 0}deg);` : ''} font-family: 'Microsoft YaHei', sans-serif; white-space: nowrap; }`;
    const wmHtml = wm && wm.text ? `<div class="wr-wm">${wm.text.replace(/</g, '&lt;')}</div>` : '';
    printHTML(`${wmHtml}<div class="wr-doc">${cleanHTML()}</div>`, css, ctx.getName());
  }

  function getContent() {
    const used = new Set([...doc.querySelectorAll('.wr-comment[data-cid]')].map((s) => s.dataset.cid));
    const comments = {};
    for (const [k, v] of Object.entries(state.comments)) if (used.has(k)) comments[k] = v;
    return {
      html: cleanHTML(),
      page: structuredClone(state.page),
      header: { ...state.header },
      footer: { ...state.footer },
      pageNumber: { ...state.pageNumber },
      comments,
      view: { ...state.view },
    };
  }

  /* ---------- 粘贴 / 拖放 ---------- */
  function insertSanitized(html) {
    const clean = sanitizeHTML(html);
    exec('insertHTML', clean);
  }
  on(doc, 'paste', (e) => {
    e.preventDefault();
    const dt = e.clipboardData;
    const files = [...dt.files].filter((f) => f.type.startsWith('image/'));
    if (files.length) { files.forEach(insertImageFile); return; }
    const html = dt.getData('text/html');
    const text = dt.getData('text/plain');
    run(() => {
      if (html) insertSanitized(html.replace(/^[\s\S]*<!--StartFragment-->|<!--EndFragment-->[\s\S]*$/g, ''));
      else if (text) exec('insertText', text);
      normalize();
    });
  });
  async function pasteFromClipboard(plain = false) {
    try {
      if (!plain && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const it of items) {
          const img = it.types.find((t) => t.startsWith('image/'));
          if (img) { await insertImageFile(new File([await it.getType(img)], 'paste.png', { type: img })); return; }
          if (it.types.includes('text/html')) { const html = await (await it.getType('text/html')).text(); run(() => { insertSanitized(html); normalize(); }); return; }
          if (it.types.includes('text/plain')) { const t = await (await it.getType('text/plain')).text(); insertText(t); return; }
        }
      } else {
        const t = await navigator.clipboard.readText();
        if (t) insertText(t);
      }
    } catch (err) {
      console.warn(err);
      toast('浏览器不允许直接读取剪贴板，请使用 Ctrl+V 粘贴');
    }
  }
  on(doc, 'drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    const r = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (r && doc.contains(r.startContainer)) { doc.focus(); setRange(r); }
    files.forEach((f) => insertImageFile(f));
  });
  on(doc, 'dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });

  /* ---------- 键盘 ---------- */
  function moveCell(dir) {
    const cell = currentCell();
    if (!cell) return false;
    const table = cell.closest('table');
    const cells = [...table.querySelectorAll('td,th')].filter((c) => c.closest('table') === table);
    let i = cells.indexOf(cell) + dir;
    if (i >= cells.length) {
      run(() => { const tr = T.insertRowAt(table, table.rows.length); caretInto(tr.cells[0]); });
      return true;
    }
    if (i < 0) i = 0;
    const r = document.createRange();
    r.selectNodeContents(cells[i]);
    setRange(r);
    return true;
  }
  on(doc, 'keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (selectedImg && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); imageOp('delete'); return; }
    if (selectedImg && !mod && e.key.length === 1) deselectImage();
    if (mod && !e.altKey) {
      const map = {
        z: () => (e.shiftKey ? redo() : undo()), y: redo,
        b: () => toggleInline('bold'), i: () => toggleInline('italic'), u: () => toggleInline('underline'),
        e: () => setAlign('center'), l: () => setAlign('left'), r: () => setAlign('right'), j: () => setAlign('justify'),
        k: linkDialog, f: () => panes.openFind(false), h: () => panes.openFind(true), p: print,
        enter: insertPageBreak, ']': () => growFont(1), '[': () => growFont(-1),
        '=': () => (e.shiftKey ? toggleInline('superscript') : toggleInline('subscript')),
        '>': () => growFont(1), '<': () => growFont(-1), '.': () => e.shiftKey && growFont(1), ',': () => e.shiftKey && growFont(-1),
        d: fontDialog,
      };
      if (map[k]) { e.preventDefault(); e.stopPropagation(); map[k](); return; }
      if (k === 's') return; // 交给外壳保存
    }
    if (e.key === 'Tab' && !mod) {
      e.preventDefault();
      if (moveCell(e.shiftKey ? -1 : 1)) return;
      const r = getRange();
      if (r && closestIn(r.startContainer, 'li')) { indent(e.shiftKey ? -1 : 1); return; }
      if (!e.shiftKey) insertText('\t');
      return;
    }
    if (e.key === 'Enter' && !mod) {
      commit();
      // 在空的引用/代码块中回车退出
      const r = getRange();
      const blk = r && closestIn(r.startContainer, 'pre');
      if (blk && e.shiftKey === false && blk.textContent.endsWith('\n\n')) {
        e.preventDefault();
        run(() => { blk.textContent = blk.textContent.replace(/\n+$/, ''); const p = h('p', null, h('br')); blk.after(p); caretInto(p); });
      }
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && !mod) commit();
  });
  on(doc, 'beforeinput', (e) => {
    if (e.inputType === 'historyUndo') { e.preventDefault(); undo(); }
    else if (e.inputType === 'historyRedo') { e.preventDefault(); redo(); }
  });
  on(doc, 'input', (e) => {
    if (selCells.length) clearCellSel();
    afterChange(true);
    if (e.inputType === 'insertParagraph' || e.inputType === 'deleteContentBackward') paginate();
  });
  on(doc, 'focus', () => { document.execCommand('defaultParagraphSeparator', false, 'p'); document.execCommand('styleWithCSS', false, true); });

  on(document, 'keydown', (e) => {
    if (!isActive() || document.querySelector('.modal-overlay')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || doc.contains(e.target) || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'p') { e.preventDefault(); print(); }
    else if (k === 'f') { e.preventDefault(); panes.openFind(false); }
    else if (k === 'h') { e.preventDefault(); panes.openFind(true); }
    else if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  });

  /* ---------- 鼠标 ---------- */
  on(doc, 'click', (e) => {
    const t = e.target;
    if (t.tagName === 'IMG' && state.view.mode !== 'read') { selectImage(t); return; }
    deselectImage();
    const tocItem = t.closest('.wr-toc-item');
    if (tocItem) {
      const hd = doc.querySelector('#' + CSS.escape(tocItem.dataset.target || ''));
      if (hd) { hd.scrollIntoView({ block: 'start', behavior: 'smooth' }); caretInto(hd); }
      return;
    }
    const a = t.closest('a');
    if (a && (e.ctrlKey || e.metaKey || state.view.mode === 'read')) { e.preventDefault(); window.open(a.href, '_blank', 'noopener'); }
    const fn = t.closest('.wr-fnref');
    if (fn) { doc.querySelector(`.wr-footnotes li[data-fn="${fn.dataset.fn}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  });
  on(doc, 'dblclick', async (e) => {
    const li = e.target.closest('.wr-footnotes li');
    if (li) {
      const t = await promptBox('编辑脚注', '脚注内容', li.textContent);
      if (t != null) run(() => (li.textContent = t), { focus: false });
      return;
    }
    // 双击页眉/页脚区域
    const y = (e.clientY - doc.getBoundingClientRect().top) / zoom;
    const g = geom();
    const inPage = y % (g.ph + GAP);
    if (state.view.mode === 'page' && (inPage < g.mt * 0.8 || (inPage > g.ph - g.mb * 0.8 && inPage < g.ph))) headerFooterDialog();
  });
  on(doc, 'mouseup', (e) => {
    if (painter) setTimeout(applyPainter, 0);
    if (e.target.classList?.contains('wr-textbox')) { afterChange(true); }
  });
  on(doc, 'contextmenu', (e) => {
    if (e.target.tagName === 'IMG') selectImage(e.target);
    const r = getRange();
    const inTable = r && closestIn(r.startContainer, 'td,th');
    const link = closestIn(e.target, 'a');
    const hasSel = r && !r.collapsed;
    const items = [
      { label: '剪切', icon: 'scissors', shortcut: 'Ctrl+X', disabled: !hasSel, onClick: () => run(() => exec('cut')) },
      { label: '复制', icon: 'copy', shortcut: 'Ctrl+C', disabled: !hasSel, onClick: () => exec('copy') },
      { label: '粘贴', icon: 'clipboard-paste', shortcut: 'Ctrl+V', onClick: () => pasteFromClipboard(false) },
      { label: '只粘贴文本', icon: 'clipboard-type', onClick: () => pasteFromClipboard(true) },
      '-',
    ];
    if (selectedImg) {
      items.push(
        { label: '图片大小...', icon: 'scaling', onClick: imageSizeDialog },
        { label: '文字环绕', icon: 'wrap-text', items: [
          { label: '嵌入型', onClick: () => imageOp('wrap', 'inline') }, { label: '左侧环绕', onClick: () => imageOp('wrap', 'left') },
          { label: '右侧环绕', onClick: () => imageOp('wrap', 'right') }, { label: '居中独占一行', onClick: () => imageOp('wrap', 'center') }] },
        { label: '删除图片', icon: 'trash-2', onClick: () => imageOp('delete') }, '-');
    }
    if (link) {
      items.push({ label: '编辑超链接', icon: 'link', onClick: linkDialog },
        { label: '打开超链接', icon: 'external-link', onClick: () => window.open(link.href, '_blank', 'noopener') },
        { label: '取消超链接', icon: 'unlink', onClick: () => run(() => { link.replaceWith(...link.childNodes); }) }, '-');
    }
    if (inTable) {
      items.push({ label: '插入', icon: 'table-2', items: [
        { label: '在上方插入行', onClick: () => tableOp('rowAbove') }, { label: '在下方插入行', onClick: () => tableOp('rowBelow') },
        { label: '在左侧插入列', onClick: () => tableOp('colLeft') }, { label: '在右侧插入列', onClick: () => tableOp('colRight') }] },
      { label: '删除', icon: 'trash-2', items: [
        { label: '删除行', onClick: () => tableOp('delRow') }, { label: '删除列', onClick: () => tableOp('delCol') }, { label: '删除表格', onClick: () => tableOp('delTable') }] },
      { label: '合并单元格', icon: 'merge', disabled: selCells.length < 2, onClick: () => tableOp('merge') },
      { label: '拆分单元格', icon: 'split', onClick: () => tableOp('split') }, '-');
    }
    items.push({ label: '字体...', icon: 'type', onClick: fontDialog },
      { label: '段落...', icon: 'pilcrow', onClick: paragraphDialog },
      { label: '超链接...', icon: 'link', onClick: linkDialog },
      { label: '新建批注', icon: 'message-square-plus', disabled: !hasSel, onClick: newComment },
      '-',
      { label: '全选', icon: 'text-select', shortcut: 'Ctrl+A', onClick: () => { const rr = document.createRange(); rr.selectNodeContents(doc); setRange(rr); } });
    contextMenu(e, items);
  });

  /* ---------- 选区变化 → 功能区状态 ---------- */
  let stateRaf = 0;
  function scheduleState() {
    if (stateRaf) return;
    stateRaf = requestAnimationFrame(() => { stateRaf = 0; E.syncRibbon && E.syncRibbon(); updatePageIndicator(); updateStats(); });
  }
  on(document, 'selectionchange', () => {
    if (!isActive()) return;
    const r = liveRange();
    if (r) savedRange = r.cloneRange();
    scheduleState();
  });
  on(canvas, 'scroll', () => { if (!liveRange()) updatePageIndicator(); });
  const ro = new ResizeObserver(() => { if (isActive()) { if (state.view.mode === 'web') paginate(); else sizeStage(); } });
  ro.observe(canvas);
  sbSpell.addEventListener('click', () => toggleSpell());
  sbWords.addEventListener('click', () => panes.wordCountDialog());
  function toggleSpell(v) {
    const onv = v ?? doc.spellcheck !== true;
    doc.spellcheck = onv;
    sbSpell.classList.toggle('active', onv);
    E.ribbon?.setActive('spell', onv);
    // 重新触发检查
    doc.blur();
    doc.focus({ preventScroll: true });
  }

  /* ---------- 组装 ---------- */
  const E = {
    root, doc, state, canvas, ctx, run, exec, focusDoc, getRange, setRange, caretInto, closestIn, selectedBlocks,
    undo, redo, hist, commit,
    applyFontSize, applyFontName, growFont, toggleInline, setColor, setHighlight, clearFormat, changeCase,
    setAlign, setLineHeight, setList, indent, STYLES, applyStyle, currentStyleKey, setParaShading, setParaBorder, paragraphDialog, fontDialog,
    pickPainter, get painter() { return painter; }, cancelPainter: () => { painter = null; root.classList.remove('wr-painting'); E.ribbon?.setActive('painter', false); },
    insertPageBreak, insertBlankPage, insertTable, insertTableDialog, insertImage, insertShape, SHAPES, shapeSrc, insertTextBox, linkDialog, insertText, insertHR,
    newComment, deleteComment, deleteAllComments, insertFootnote, insertTOC, updateTOC, deleteTOC, headingList, headingText,
    tableOp, currentCell, get selCells() { return selCells; }, get selectedImg() { return selectedImg; }, imageOp, imageSizeDialog,
    updatePage, customMargins, setColumns, watermarkDialog, headerFooterDialog, setPageNumber,
    setZoom, fitWidth, fitPage, setViewMode, setRuler, toggleSpell, print, stats, pasteFromClipboard,
    get pageCount() { return pageCount; }, paginate, zoomCtl,
    toggleNav: (v) => panes.toggleNav(v),
    fullscreen: () => { if (document.fullscreenElement) document.exitFullscreen(); else root.requestFullscreen?.(); },
  };
  const panes = createPanes(E, { navPane, sidePane });
  E.panes = panes;
  E.ribbon = buildRibbon(E);
  root._writer = E; // 便于调试

  root.append(E.ribbon.el, body, statusbar);
  setHTML(file.content?.html);
  setRuler(state.view.ruler);
  if (state.view.nav) panes.toggleNav(true);
  setViewMode(state.view.mode === 'read' ? 'page' : state.view.mode);
  record();

  const instance = {
    getContent,
    onShow() {
      paginate();
      drawRuler();
      panes.refreshNav();
      updateStats();
      E.syncRibbon && E.syncRibbon();
    },
    onHide() { E.cancelPainter(); },
    destroy() { listeners.forEach((f) => f()); ro.disconnect(); },
    print,
    exports: [
      { label: 'Word 文档 (.docx)', icon: 'file-text', desc: '可在 Microsoft Word / WPS 中打开编辑', run: (name) => exportDocx(getContent(), name) },
      { label: 'PDF 文档 (.pdf)', icon: 'file-type', desc: '通过打印对话框选择"另存为 PDF"', run: () => print() },
      { label: '网页 (.html)', icon: 'globe', desc: '单个 HTML 文件，图片内嵌', run: (name) => exportHTML(getContent(), name) },
      { label: 'Markdown (.md)', icon: 'file-code', desc: '纯文本标记格式', run: (name) => exportMarkdown(getContent(), name) },
      { label: '纯文本 (.txt)', icon: 'file', desc: '仅保留文字内容', run: (name) => exportText(getContent(), name) },
    ],
  };
  E.getContent = getContent;
  root._writerInst = instance;
  return instance;
}
