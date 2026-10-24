// 演示编辑器：幻灯片列表、画布、选择/拖动/缩放/旋转、文本编辑、撤销重做、剪贴板、视图。
import { h, icon, toast, modal, formBox, promptBox, confirmBox, contextMenu, showMenu, zoomControl, pickFile, readFileAs, debounce } from '../../core/ui.js';
import { dims, uid, LAYOUTS, newSlide, layoutElements, textEl, shapeEl, baseEl, tableEl, chartEl, cloneEl, cloneSlide, isTextEmpty, elementLabel, linesToHtml, esc } from './model.js';
import { slideHTML, elementHTML, slideThumb, ensureRenderCSS, WORDART, mediaSrc } from './render.js';
import { getTheme, THEMES } from './themes.js';
import { isLine, SHAPES } from './shapes.js';
import { ANIMS, animName, animCat, CAT_NAMES, CAT_COLORS, TRIGGERS, TRANSITIONS, playTransition, buildSteps, animKeyframes } from './anim.js';
import { CHART_TYPES, defaultChartData, dataToText, textToData } from './chart.js';
import { startShow } from './slideshow.js';
import { exportPptx, printDeck, exportPng } from './io.js';
import { buildRibbon } from './ribbon.js';
import { setupSlidesAI } from './ai.js';

let CLIPBOARD = null; // { kind:'elements'|'slides', items, media, mark }
let clipSystemOk = false;

const textCapable = (el) => el && (el.type === 'text' || el.type === 'table' || (el.type === 'shape' && !isLine(el.shape)));

export function normalizeDeck(c) {
  const deck = c && c.slides ? c : null;
  if (!deck) return null;
  deck.media = deck.media || {};
  deck.footer = deck.footer || { showNumber: false, showDate: false, text: '', notOnTitle: true };
  deck.size = deck.size || '16:9';
  deck.theme = deck.theme || 'office';
  for (const s of deck.slides) {
    s.id = s.id || uid();
    s.elements = s.elements || [];
    s.animations = s.animations || [];
    s.transition = s.transition || { type: 'none', duration: 0.7 };
    s.notes = s.notes || '';
  }
  return deck;
}

/** 压缩过大的图片 */
async function loadImage(file) {
  const url = await readFileAs(file, 'dataURL');
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => {});
  let { naturalWidth: w, naturalHeight: hh } = img;
  const max = 1920;
  if ((w > max || hh > max) && !/svg|gif/.test(file.type)) {
    const k = max / Math.max(w, hh);
    const c = document.createElement('canvas');
    c.width = Math.round(w * k);
    c.height = Math.round(hh * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const out = file.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.88);
    return { url: out, w: c.width, h: c.height };
  }
  return { url, w: w || 400, h: hh || 300 };
}

export function createEditor(root, file, ctx) {
  ensureRenderCSS();
  const deck = normalizeDeck(file.content) || { version: 1, size: '16:9', theme: 'office', slides: [], media: {}, footer: {} };
  if (!deck.slides.length) deck.slides.push(newSlide('title', deck));

  let cur = 0;
  let sel = new Set();
  let slideSel = new Set([0]);
  let editingId = null;
  let editState = null; // { snap, before }
  let focusArea = 'canvas';
  let zoom = 'fit';
  let scale = 1;
  let view = 'normal';
  let showNotes = true;
  let showGrid = false;
  let showGuides = false;
  let animPaneOpen = false;
  let selAnimId = null;
  let painter = null;
  let lastTableCell = null;
  const undoStack = [], redoStack = [];
  let lastTag = null, lastTagTime = 0;

  const W = () => dims(deck).w;
  const H = () => dims(deck).h;
  const slide = () => deck.slides[cur];
  const find = (id) => slide().elements.find((e) => e.id === id);
  const selected = () => slide().elements.filter((e) => sel.has(e.id));
  const isActive = () => root.classList.contains('active');

  /* ---------------- 撤销 / 重做 ---------------- */
  const snapshot = () => JSON.stringify({ slides: deck.slides, size: deck.size, theme: deck.theme, footer: deck.footer });
  function checkpoint(tag) {
    const now = Date.now();
    if (tag && tag === lastTag && now - lastTagTime < 1000) { lastTagTime = now; return; }
    lastTag = tag || null;
    lastTagTime = now;
    undoStack.push(snapshot());
    if (undoStack.length > 120) undoStack.shift();
    redoStack.length = 0;
  }
  function restore(s) {
    const d = JSON.parse(s);
    deck.slides = d.slides;
    deck.size = d.size;
    deck.theme = d.theme;
    deck.footer = d.footer;
    cur = Math.min(cur, deck.slides.length - 1);
    slideSel = new Set([cur]);
    sel = new Set([...sel].filter((id) => find(id)));
    editingId = null;
    renderAll();
    ctx.markDirty();
  }
  function undo() {
    if (editingId) exitEdit();
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
    lastTag = null;
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    lastTag = null;
  }

  /** 修改模型的统一入口 */
  function change(fn, { slides = false, canvas = true, tag } = {}) {
    if (editingId && !tag) exitEdit();
    checkpoint(tag);
    const r = fn();
    afterChange({ slides, canvas });
    return r;
  }
  function afterChange({ slides = false, canvas = true } = {}) {
    ctx.markDirty();
    if (canvas) renderCanvas();
    renderOverlay();
    if (slides) renderThumbs();
    else updateThumb(cur);
    renderNotes();
    sync();
  }

  /* ---------------- DOM ---------------- */
  const E = {}; // 给功能区用的命令集合
  const thumbsEl = h('div', { class: 'sl-thumbs', tabindex: '0' });
  const layer = h('div', { class: 'sl-layer' });
  const overlay = h('div', { class: 'sl-overlay' });
  const gridEl = h('div', { class: 'sl-grid' });
  const guidesEl = h('div', { class: 'sl-guides-static' });
  const stage = h('div', { class: 'sl-stage' }, layer, gridEl, guidesEl, overlay);
  const stageBox = h('div', { class: 'sl-stagebox' }, stage);
  const canvasWrap = h('div', { class: 'sl-canvas-wrap' }, stageBox);
  const notesTa = h('textarea', { class: 'sl-notes-ta', placeholder: '单击此处添加备注' });
  const notesEl = h('div', { class: 'sl-notes' }, notesTa);
  const center = h('div', { class: 'sl-center' }, canvasWrap, notesEl);
  const sorterEl = h('div', { class: 'sl-sorter' });
  const animPane = h('div', { class: 'side-pane sl-animpane' });
  const body = h('div', { class: 'app-body sl-body' }, thumbsEl, center, sorterEl, animPane);
  const sbSlide = h('span');
  const sbTheme = h('span');
  const zoomCtl = zoomControl(100, (z) => setZoom(z), { min: 10, max: 400 });
  const viewBtns = {
    normal: h('button', { class: 'sb-btn', title: '普通视图', onclick: () => setView('normal') }, icon('rectangle-horizontal', 15)),
    sorter: h('button', { class: 'sb-btn', title: '幻灯片浏览', onclick: () => setView('sorter') }, icon('layout-grid', 15)),
    reading: h('button', { class: 'sb-btn', title: '阅读视图', onclick: () => E.show(true, false) }, icon('book-open', 15)),
  };
  const notesBtn = h('button', { class: 'sb-btn', title: '备注', onclick: () => E.toggleNotes() }, icon('notebook-pen', 14), '备注');
  const statusbar = h('div', { class: 'statusbar' },
    sbSlide, sbTheme, h('div', { class: 'sb-spacer' }), notesBtn,
    viewBtns.normal, viewBtns.sorter, viewBtns.reading,
    h('button', { class: 'sb-btn', title: '从当前幻灯片开始放映 (Shift+F5)', onclick: () => E.show(true) }, icon('play', 14), '放映'),
    zoomCtl.el,
    h('button', { class: 'sb-btn', title: '适应窗口大小', onclick: () => setZoom('fit') }, icon('maximize', 14)));
  const ribbon = buildRibbon(E, ctx);
  root.append(ribbon.el, body, statusbar);

  /* ---------------- 渲染 ---------------- */
  function fit() {
    const aw = canvasWrap.clientWidth - 56, ah = canvasWrap.clientHeight - 56;
    if (aw <= 0 || ah <= 0) return;
    scale = zoom === 'fit' ? Math.max(0.05, Math.min(aw / W(), ah / H())) : zoom / 100;
    stage.style.width = W() + 'px';
    stage.style.height = H() + 'px';
    stage.style.transform = `scale(${scale})`;
    stage.style.setProperty('--inv', String(1 / scale));
    stageBox.style.width = W() * scale + 'px';
    stageBox.style.height = H() * scale + 'px';
    zoomCtl.set(Math.round(scale * 100));
    renderOverlay();
  }
  function setZoom(z) {
    zoom = z === 'fit' ? 'fit' : Math.max(10, Math.min(400, z));
    fit();
  }
  new ResizeObserver(() => { if (view === 'normal') fit(); }).observe(canvasWrap);

  function layerNode(id) { return layer.querySelector(`.sl-el[data-id="${id}"]`); }

  function renderCanvas() {
    if (editingId) return;
    layer.innerHTML = slideHTML(slide(), deck, { mode: 'edit', index: cur });
    stage.classList.toggle('show-grid', showGrid);
    guidesEl.style.display = showGuides ? '' : 'none';
  }
  function rerenderEl(el) {
    const node = layerNode(el.id);
    if (!node || el.id === editingId) return;
    const t = document.createElement('div');
    t.innerHTML = elementHTML(el, deck, 'edit');
    if (t.firstElementChild) node.replaceWith(t.firstElementChild);
  }

  function renderOverlay() {
    overlay.replaceChildren();
    if (view !== 'normal') return;
    const els = selected();
    const single = els.length === 1;
    for (const el of els) {
      const box = h('div', { class: 'sl-selbox' + (el.id === editingId ? ' editing' : '') + (el.locked ? ' locked' : ''), style: { left: el.x + 'px', top: el.y + 'px', width: el.w + 'px', height: el.h + 'px', transform: `rotate(${el.rot || 0}deg)` } });
      if (single && !el.locked && el.id !== editingId) {
        const line = el.type === 'shape' && isLine(el.shape);
        const hs = line ? ['w', 'e'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        hs.forEach((d) => box.append(h('div', { class: 'sl-h sl-h-' + d, dataset: { h: d } })));
        box.append(h('div', { class: 'sl-h sl-rot', dataset: { h: 'rot' } }, h('span', { class: 'sl-rot-ico' })));
      } else if (single && el.id === editingId) {
        // 编辑状态下也允许旋转把手外的大小调整
      }
      if (el.locked) box.append(h('div', { class: 'sl-lock' }, icon('lock', 12)));
      overlay.append(box);
    }
  }

  /* -------- 幻灯片列表 (缩略图) -------- */
  function slideTitle(s, i) {
    const t = s.elements.find((e) => e.role === 'title' && !isTextEmpty(e.html));
    return t ? t.html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim() : `幻灯片 ${i + 1}`;
  }
  function thumbItem(i, width) {
    const s = deck.slides[i];
    const th = slideThumb(s, deck, width, i);
    const item = h('div', {
      class: 'sl-th' + (i === cur ? ' current' : '') + (slideSel.has(i) ? ' selected' : '') + (s.hidden ? ' hidden-slide' : ''),
      dataset: { i },
      title: slideTitle(s, i),
    },
      h('div', { class: 'sl-th-num' }, String(i + 1), (s.transition && s.transition.type !== 'none') || s.animations.length ? h('span', { class: 'sl-th-star', title: '含切换/动画' }, '★') : null),
      h('div', { class: 'sl-th-img' }, th));
    return item;
  }
  function renderThumbs() {
    if (view === 'sorter') { renderSorter(); }
    thumbsEl.replaceChildren(...deck.slides.map((_, i) => thumbItem(i, 168)));
    const curEl = thumbsEl.querySelector('.sl-th.current');
    if (curEl) curEl.scrollIntoView({ block: 'nearest' });
    sbSlide.textContent = `幻灯片 第 ${cur + 1} 张，共 ${deck.slides.length} 张`;
    sbTheme.textContent = `主题：${getTheme(deck.theme).name}`;
  }
  const updateThumbSoon = debounce((i) => updateThumb(i), 400);
  function updateThumb(i) {
    if (view === 'sorter') { renderSorter(); return; }
    const old = thumbsEl.querySelector(`.sl-th[data-i="${i}"]`);
    if (!old) { renderThumbs(); return; }
    old.replaceWith(thumbItem(i, 168));
  }
  function renderSorter() {
    sorterEl.replaceChildren(...deck.slides.map((_, i) => {
      const it = thumbItem(i, 240);
      it.append(h('div', { class: 'sl-th-cap' }, slideTitle(deck.slides[i], i)));
      return it;
    }));
  }

  function bindSlideList(container) {
    container.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.sl-th');
      focusArea = 'thumbs';
      if (editingId) exitEdit();
      if (!item) return;
      const i = +item.dataset.i;
      if (e.button === 2) {
        if (!slideSel.has(i)) { slideSel = new Set([i]); goto(i); }
        return;
      }
      if (e.shiftKey) {
        const a = Math.min(cur, i), b = Math.max(cur, i);
        slideSel = new Set(Array.from({ length: b - a + 1 }, (_, k) => a + k));
        markSlideSel();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (slideSel.has(i) && slideSel.size > 1) slideSel.delete(i); else slideSel.add(i);
        markSlideSel();
        return;
      }
      if (!slideSel.has(i)) slideSel = new Set([i]);
      if (i !== cur) goto(i, { keepSlideSel: true });
      // 拖动排序
      const sx = e.clientX, sy = e.clientY;
      let dragging = false, indicator = null, target = null;
      const move = (ev) => {
        if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        if (!dragging) { dragging = true; indicator = h('div', { class: 'sl-drop-ind' }); container.append(indicator); container.classList.add('dragging'); }
        const items = [...container.querySelectorAll('.sl-th')];
        let best = null, bestD = Infinity;
        for (const it of items) {
          const r = it.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const d = Math.hypot(ev.clientX - cx, ev.clientY - cy);
          if (d < bestD) { bestD = d; best = { it, r, after: container === sorterEl ? ev.clientX > cx : ev.clientY > cy }; }
        }
        if (!best) return;
        target = +best.it.dataset.i + (best.after ? 1 : 0);
        const cr = container.getBoundingClientRect();
        if (container === sorterEl) {
          const x = (best.after ? best.r.right + 6 : best.r.left - 8) - cr.left + container.scrollLeft;
          Object.assign(indicator.style, { left: x + 'px', top: best.r.top - cr.top + container.scrollTop + 'px', width: '3px', height: best.r.height + 'px' });
        } else {
          const y = (best.after ? best.r.bottom + 3 : best.r.top - 4) - cr.top + container.scrollTop;
          Object.assign(indicator.style, { left: '8px', right: '8px', top: y + 'px', height: '3px' });
        }
      };
      const up = () => {
        removeEventListener('mousemove', move);
        removeEventListener('mouseup', up);
        if (indicator) indicator.remove();
        container.classList.remove('dragging');
        if (dragging && target != null) moveSlides([...slideSel].sort((a, b) => a - b), target);
      };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    });
    container.addEventListener('dblclick', (e) => {
      const item = e.target.closest('.sl-th');
      if (item && container === sorterEl) { goto(+item.dataset.i); setView('normal'); }
    });
    container.addEventListener('contextmenu', (e) => {
      const item = e.target.closest('.sl-th');
      contextMenu(e, slideMenuItems(!!item));
    });
  }
  bindSlideList(thumbsEl);
  bindSlideList(sorterEl);

  function markSlideSel() {
    for (const c of [thumbsEl, sorterEl]) c.querySelectorAll('.sl-th').forEach((t) => t.classList.toggle('selected', slideSel.has(+t.dataset.i)));
  }

  function slideMenuItems(onItem) {
    return [
      { label: '新建幻灯片', icon: 'plus', shortcut: 'Ctrl+M', onClick: () => E.addSlide() },
      ...(onItem ? [
        { label: '复制幻灯片', icon: 'copy-plus', onClick: () => E.duplicateSlides() },
        { label: '删除幻灯片', icon: 'trash-2', onClick: () => E.deleteSlides() },
        '-',
        { label: '剪切', icon: 'scissors', onClick: () => { E.copySlides(); E.deleteSlides(); } },
        { label: '复制', icon: 'copy', onClick: () => E.copySlides() },
      ] : []),
      { label: '粘贴', icon: 'clipboard-paste', disabled: !CLIPBOARD, onClick: () => E.paste() },
      '-',
      ...(onItem ? [
        { label: '版式', icon: 'layout-template', items: LAYOUTS.map((l) => ({ label: l.name, checked: slide().layout === l.id, onClick: () => E.setLayout(l.id) })) },
        { label: slide().hidden ? '取消隐藏幻灯片' : '隐藏幻灯片', icon: 'eye-off', onClick: () => E.toggleHidden() },
        { label: '设置背景格式...', icon: 'paint-bucket', onClick: () => E.formatBackground() },
        '-',
        { label: '从此张开始放映', icon: 'play', onClick: () => E.show(true) },
      ] : []),
    ];
  }

  /* -------- 备注 -------- */
  function renderNotes() {
    if (document.activeElement !== notesTa) notesTa.value = slide().notes || '';
  }
  notesTa.addEventListener('focus', () => { checkpoint(); focusArea = 'notes'; });
  notesTa.addEventListener('input', () => { slide().notes = notesTa.value; ctx.markDirty(); });

  /* -------- 视图 -------- */
  function setView(v) {
    if (editingId) exitEdit();
    view = v;
    body.classList.toggle('sorter-view', v === 'sorter');
    Object.entries(viewBtns).forEach(([k, b]) => b.classList.toggle('active', k === v));
    if (v === 'sorter') { renderSorter(); markSlideSel(); }
    else { renderAll(); requestAnimationFrame(fit); }
    sync();
  }
  E.setView = setView;
  E.toggleNotes = () => { showNotes = !showNotes; notesEl.style.display = showNotes ? '' : 'none'; notesBtn.classList.toggle('active', showNotes); requestAnimationFrame(fit); sync(); };
  E.toggleGrid = () => { showGrid = !showGrid; stage.classList.toggle('show-grid', showGrid); sync(); };
  E.toggleGuides = () => { showGuides = !showGuides; guidesEl.style.display = showGuides ? '' : 'none'; sync(); };
  E.setZoom = setZoom;
  E.zoomDialog = async () => {
    const r = await formBox('显示比例', [{ name: 'z', label: '百分比', type: 'select', value: zoom === 'fit' ? 'fit' : String(zoom), options: [{ value: 'fit', label: '适应窗口' }, '50', '66', '75', '100', '150', '200', '300'] }]);
    if (r) setZoom(r.z === 'fit' ? 'fit' : +r.z);
  };

  function goto(i, { keepSlideSel = false } = {}) {
    if (editingId) exitEdit();
    cur = Math.max(0, Math.min(deck.slides.length - 1, i));
    if (!keepSlideSel) slideSel = new Set([cur]);
    sel.clear();
    selAnimId = null;
    renderCanvas();
    renderOverlay();
    for (const c of [thumbsEl, sorterEl]) c.querySelectorAll('.sl-th').forEach((t) => {
      t.classList.toggle('current', +t.dataset.i === cur);
      t.classList.toggle('selected', slideSel.has(+t.dataset.i));
    });
    const ce = thumbsEl.querySelector('.sl-th.current');
    if (ce) ce.scrollIntoView({ block: 'nearest' });
    sbSlide.textContent = `幻灯片 第 ${cur + 1} 张，共 ${deck.slides.length} 张`;
    renderNotes();
    sync();
  }
  E.goto = goto;

  function renderAll() {
    renderCanvas();
    renderThumbs();
    renderOverlay();
    renderNotes();
    stage.style.width = W() + 'px';
    fit();
    sync();
  }

  /* ---------------- 画布交互 ---------------- */
  function toLogical(e) {
    const r = stage.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }
  function groupIds(el) {
    if (!el.groupId) return [el.id];
    return slide().elements.filter((e) => e.groupId === el.groupId).map((e) => e.id);
  }

  canvasWrap.addEventListener('mousedown', (e) => {
    focusArea = 'canvas';
    if (view !== 'normal') return;
    const handle = e.target.closest('.sl-h');
    if (handle && e.button === 0) { e.preventDefault(); startHandleDrag(e, handle.dataset.h); return; }
    const elNode = e.target.closest('.sl-layer .sl-el');
    if (editingId) {
      if (elNode && elNode.dataset.id === editingId) return; // 文本内部操作
      exitEdit();
    }
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) ae.blur();
    if (elNode) {
      const el = find(elNode.dataset.id);
      if (!el) return;
      if (painter && e.button === 0) { applyPainter(el); e.preventDefault(); return; }
      const ids = groupIds(el);
      const wasSelected = sel.has(el.id);
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        if (wasSelected) ids.forEach((id) => sel.delete(id)); else ids.forEach((id) => sel.add(id));
        renderOverlay(); sync();
        if (!sel.has(el.id)) return;
      } else if (!wasSelected) {
        sel = new Set(ids);
        selAnimId = null;
      }
      renderOverlay(); sync();
      if (e.button !== 0) return;
      if (e.target.closest('[data-action=pick-image]')) { e.preventDefault(); E.pickImageFor(el); return; }
      e.preventDefault();
      startMove(e, wasSelected && sel.size === 1 && textCapable(el) && !el.groupId ? el : null);
    } else {
      if (painter) { painter = null; root.classList.remove('sl-painting'); }
      if (!(e.shiftKey || e.ctrlKey)) sel.clear();
      renderOverlay(); sync();
      if (e.button === 0) { e.preventDefault(); startMarquee(e); }
    }
  });
  canvasWrap.addEventListener('dblclick', (e) => {
    if (view !== 'normal') return;
    const elNode = e.target.closest('.sl-layer .sl-el');
    if (!elNode) return;
    const el = find(elNode.dataset.id);
    if (!el) return;
    if (el.id === editingId) return;
    if (el.type === 'chart') E.editChartData();
    else if (el.type === 'image') E.pickImageFor(el);
    else if (textCapable(el)) enterEdit(el.id, e);
  });
  canvasWrap.addEventListener('contextmenu', (e) => {
    if (view !== 'normal') return;
    if (editingId && e.target.closest('.sl-layer .sl-el')?.dataset.id === editingId) {
      contextMenu(e, textMenuItems());
      return;
    }
    const elNode = e.target.closest('.sl-layer .sl-el');
    contextMenu(e, elNode && sel.size ? elementMenuItems() : canvasMenuItems());
  });
  canvasWrap.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(Math.round(scale * 100) + (e.deltaY < 0 ? 10 : -10));
  }, { passive: false });

  function textMenuItems() {
    return [
      { label: '剪切', icon: 'scissors', shortcut: 'Ctrl+X', onClick: () => document.execCommand('cut') },
      { label: '复制', icon: 'copy', shortcut: 'Ctrl+C', onClick: () => document.execCommand('copy') },
      { label: '粘贴', icon: 'clipboard-paste', shortcut: 'Ctrl+V', onClick: () => navigator.clipboard?.readText().then((t) => t && document.execCommand('insertText', false, t)).catch(() => toast('请使用 Ctrl+V 粘贴')) },
      '-',
      { label: '超链接...', icon: 'link', onClick: () => E.link() },
      { label: '全选', shortcut: 'Ctrl+A', onClick: () => document.execCommand('selectAll') },
      { label: '退出编辑', shortcut: 'Esc', onClick: () => exitEdit() },
    ];
  }
  function elementMenuItems() {
    const els = selected();
    const one = els.length === 1 ? els[0] : null;
    return [
      { label: '剪切', icon: 'scissors', shortcut: 'Ctrl+X', onClick: () => E.cut() },
      { label: '复制', icon: 'copy', shortcut: 'Ctrl+C', onClick: () => E.copy() },
      { label: '粘贴', icon: 'clipboard-paste', shortcut: 'Ctrl+V', disabled: !CLIPBOARD, onClick: () => E.paste() },
      { label: '删除', icon: 'trash-2', shortcut: 'Del', onClick: () => E.deleteSel() },
      '-',
      ...(one && textCapable(one) ? [{ label: '编辑文字', icon: 'type', onClick: () => enterEdit(one.id, null, false) }] : []),
      ...(one && one.type === 'chart' ? [{ label: '编辑数据...', icon: 'table', onClick: () => E.editChartData() }] : []),
      ...(one && one.type === 'image' ? [{ label: '更改图片...', icon: 'image', onClick: () => E.pickImageFor(one) }, { label: '另存为图片...', icon: 'download', onClick: () => { const a = document.createElement('a'); a.href = mediaSrc(deck, one.mediaId); a.download = 'image'; a.click(); } }] : []),
      { label: '置于顶层', icon: 'bring-to-front', onClick: () => E.order('front') },
      { label: '置于底层', icon: 'send-to-back', onClick: () => E.order('back') },
      { label: '上移一层', icon: 'arrow-up', onClick: () => E.order('forward') },
      { label: '下移一层', icon: 'arrow-down', onClick: () => E.order('backward') },
      '-',
      { label: '对齐', icon: 'align-center-horizontal', items: alignMenu() },
      ...(els.length > 1 ? [{ label: '组合', icon: 'group', shortcut: 'Ctrl+G', onClick: () => E.group() }] : []),
      ...(els.some((e) => e.groupId) ? [{ label: '取消组合', icon: 'ungroup', shortcut: 'Ctrl+Shift+G', onClick: () => E.ungroup() }] : []),
      { label: els.every((e) => e.locked) ? '解除锁定' : '锁定', icon: 'lock', onClick: () => E.toggleLock() },
      '-',
      { label: '超链接...', icon: 'link', onClick: () => E.link() },
      { label: '添加动画', icon: 'sparkles', items: Object.entries(ANIMS).map(([cat, list]) => ({ label: CAT_NAMES[cat], items: list.map((a) => ({ label: a.name, onClick: () => E.addAnim(a.id) })) })) },
      { label: '格式刷', icon: 'paintbrush', onClick: () => E.painter() },
    ];
  }
  function canvasMenuItems() {
    return [
      { label: '粘贴', icon: 'clipboard-paste', shortcut: 'Ctrl+V', disabled: !CLIPBOARD, onClick: () => E.paste() },
      '-',
      { label: '新建幻灯片', icon: 'plus', onClick: () => E.addSlide() },
      { label: '版式', icon: 'layout-template', items: LAYOUTS.map((l) => ({ label: l.name, checked: slide().layout === l.id, onClick: () => E.setLayout(l.id) })) },
      { label: '设置背景格式...', icon: 'paint-bucket', onClick: () => E.formatBackground() },
      '-',
      { label: '网格线', checked: showGrid, onClick: () => E.toggleGrid() },
      { label: '参考线', checked: showGuides, onClick: () => E.toggleGuides() },
      '-',
      { label: '全选', shortcut: 'Ctrl+A', onClick: () => E.selectAll() },
    ];
  }
  function alignMenu() {
    return [
      { label: '左对齐', icon: 'align-start-vertical', onClick: () => E.align('left') },
      { label: '水平居中', icon: 'align-center-vertical', onClick: () => E.align('hcenter') },
      { label: '右对齐', icon: 'align-end-vertical', onClick: () => E.align('right') },
      { label: '顶端对齐', icon: 'align-start-horizontal', onClick: () => E.align('top') },
      { label: '垂直居中', icon: 'align-center-horizontal', onClick: () => E.align('vcenter') },
      { label: '底端对齐', icon: 'align-end-horizontal', onClick: () => E.align('bottom') },
      '-',
      { label: '横向分布', icon: 'align-horizontal-distribute-center', disabled: sel.size < 3, onClick: () => E.distribute('h') },
      { label: '纵向分布', icon: 'align-vertical-distribute-center', disabled: sel.size < 3, onClick: () => E.distribute('v') },
    ];
  }
  E.alignMenu = alignMenu;

  /* -------- 移动（含智能参考线吸附） -------- */
  const guideLayer = h('div', { class: 'sl-snap' });
  stage.append(guideLayer);
  function bbox(els) {
    const xs = els.map((e) => e.x), ys = els.map((e) => e.y);
    const x2 = els.map((e) => e.x + e.w), y2 = els.map((e) => e.y + e.h);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...x2) - x, h: Math.max(...y2) - y };
  }
  function startMove(e, editCandidate) {
    const start = toLogical(e);
    const movers = selected().filter((x) => !x.locked);
    const orig = new Map(movers.map((m) => [m.id, { x: m.x, y: m.y }]));
    const others = slide().elements.filter((x) => !sel.has(x.id));
    const vx = [0, W() / 2, W()], vy = [0, H() / 2, H()];
    others.forEach((o) => { vx.push(o.x, o.x + o.w / 2, o.x + o.w); vy.push(o.y, o.y + o.h / 2, o.y + o.h); });
    const b0 = movers.length ? bbox(movers) : null;
    let moved = false;
    const move = (ev) => {
      const p = toLogical(ev);
      let dx = p.x - start.x, dy = p.y - start.y;
      if (!moved && Math.hypot(dx, dy) * scale < 3) return;
      if (!movers.length) return;
      if (!moved) { moved = true; checkpoint(); }
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      guideLayer.replaceChildren();
      if (!ev.altKey) {
        const th = 6 / scale;
        const snap = (pos, size, cands) => {
          let best = null;
          for (const [k, off] of [[0, 0], [1, size / 2], [2, size]]) {
            for (const c of cands) {
              const d = c - (pos + off);
              if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: c };
            }
          }
          return best;
        };
        const sxr = snap(b0.x + dx, b0.w, vx);
        const syr = snap(b0.y + dy, b0.h, vy);
        if (sxr) { dx += sxr.d; guideLayer.append(h('div', { class: 'sl-snap-v', style: { left: sxr.line + 'px' } })); }
        if (syr) { dy += syr.d; guideLayer.append(h('div', { class: 'sl-snap-h', style: { top: syr.line + 'px' } })); }
      }
      for (const m of movers) {
        const o = orig.get(m.id);
        m.x = Math.round(o.x + dx);
        m.y = Math.round(o.y + dy);
        const n = layerNode(m.id);
        if (n) { n.style.left = m.x + 'px'; n.style.top = m.y + 'px'; }
      }
      renderOverlay();
    };
    const up = (ev) => {
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      guideLayer.replaceChildren();
      if (moved) afterChange({ canvas: false });
      else if (editCandidate) enterEdit(editCandidate.id, ev);
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  }

  /* -------- 缩放 / 旋转 -------- */
  function startHandleDrag(e, dir) {
    const el = selected()[0];
    if (!el) return;
    if (editingId) exitEdit();
    checkpoint();
    const start = toLogical(e);
    const o = { x: el.x, y: el.y, w: el.w, h: el.h, rot: el.rot || 0 };
    const cx0 = o.x + o.w / 2, cy0 = o.y + o.h / 2;
    const th = (o.rot * Math.PI) / 180, cos = Math.cos(th), sin = Math.sin(th);
    const hx = dir.includes('e') ? 1 : dir.includes('w') ? -1 : 0;
    const hy = dir.includes('s') ? 1 : dir.startsWith('n') ? -1 : 0;
    const line = el.type === 'shape' && isLine(el.shape);
    const move = (ev) => {
      const p = toLogical(ev);
      if (dir === 'rot') {
        let a = (Math.atan2(p.y - cy0, p.x - cx0) * 180) / Math.PI + 90;
        a = ((a % 360) + 360) % 360;
        if (ev.shiftKey) a = Math.round(a / 15) * 15;
        else for (const s of [0, 90, 180, 270, 360]) if (Math.abs(a - s) < 4) a = s;
        el.rot = Math.round(a) % 360;
      } else {
        const dx = p.x - start.x, dy = p.y - start.y;
        const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos;
        let w = o.w + hx * lx, hh = o.h + hy * ly;
        const keep = (ev.shiftKey || (el.type === 'image' && hx && hy)) && hx && hy;
        if (keep) {
          const s = Math.max(w / o.w, hh / o.h);
          w = o.w * s; hh = o.h * s;
        }
        const min = line ? 4 : 8;
        w = Math.max(min, w); hh = Math.max(line ? 4 : 8, hh);
        const dwx = ((w - o.w) / 2) * hx, dwy = ((hh - o.h) / 2) * hy;
        const cx = cx0 + dwx * cos - dwy * sin, cy = cy0 + dwx * sin + dwy * cos;
        el.w = Math.round(w); el.h = Math.round(hh);
        el.x = Math.round(cx - w / 2); el.y = Math.round(cy - hh / 2);
      }
      rerenderEl(el);
      renderOverlay();
      syncSize();
    };
    const up = () => {
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      afterChange({ canvas: true });
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  }

  /* -------- 框选 -------- */
  function startMarquee(e) {
    const s = toLogical(e);
    const base = new Set(sel);
    const box = h('div', { class: 'sl-marquee' });
    let shown = false;
    const move = (ev) => {
      const p = toLogical(ev);
      const x = Math.min(s.x, p.x), y = Math.min(s.y, p.y), w = Math.abs(p.x - s.x), hh = Math.abs(p.y - s.y);
      if (!shown && w * scale < 3 && hh * scale < 3) return;
      if (!shown) { shown = true; stage.append(box); }
      Object.assign(box.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' });
      sel = new Set(base);
      for (const el of slide().elements) {
        if (el.x >= x && el.y >= y && el.x + el.w <= x + w && el.y + el.h <= y + hh) groupIds(el).forEach((id) => sel.add(id));
      }
      renderOverlay();
    };
    const up = () => {
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      box.remove();
      sync();
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  }

  /* ---------------- 文本编辑 ---------------- */
  function editNodeOf(id) {
    const n = layerNode(id);
    return n ? n.querySelector('.sl-txt') : null;
  }
  function placeCaret(target, evt, selectAll) {
    const s = getSelection();
    let r = null;
    if (evt && document.caretRangeFromPoint) {
      r = document.caretRangeFromPoint(evt.clientX, evt.clientY);
      if (r && !target.contains(r.startContainer)) r = null;
    }
    if (!r) {
      r = document.createRange();
      r.selectNodeContents(target);
      if (!selectAll) r.collapse(false);
    }
    s.removeAllRanges();
    s.addRange(r);
  }
  function enterEdit(id, evt, selectAll = false) {
    const el = find(id);
    if (!textCapable(el) || el.locked) return;
    if (editingId) exitEdit();
    sel = new Set([id]);
    editingId = id;
    editState = { snap: snapshot(), before: JSON.stringify(el.type === 'table' ? el.rows : el.html) };
    const node = layerNode(id);
    if (!node) { editingId = null; return; }
    node.classList.add('sl-editing');
    if (el.type === 'table') {
      const cells = [...node.querySelectorAll('.sl-cell')];
      cells.forEach((c) => (c.contentEditable = 'true'));
      const hit = evt && evt.clientX != null ? document.elementFromPoint(evt.clientX, evt.clientY) : null;
      let target = hit && hit.closest ? hit.closest('td')?.querySelector('.sl-cell') : null;
      if (target && !node.contains(target)) target = null;
      if (!target) target = cells[0];
      target.focus();
      placeCaret(target, evt, selectAll);
      lastTableCell = target.closest('td');
      node.addEventListener('input', onEditInput);
      node.addEventListener('focusin', (ev) => { const td = ev.target.closest('td'); if (td) lastTableCell = td; sync(); });
    } else {
      const txt = node.querySelector('.sl-txt');
      txt.classList.remove('sl-empty');
      if (isTextEmpty(el.html)) txt.innerHTML = '<div><br></div>';
      txt.contentEditable = 'true';
      txt.focus();
      placeCaret(txt, evt, selectAll);
      txt.addEventListener('input', onEditInput);
    }
    renderOverlay();
    sync();
  }
  function readEditing() {
    const el = find(editingId);
    if (!el) return;
    const node = layerNode(editingId);
    if (!node) return;
    if (el.type === 'table') {
      node.querySelectorAll('td').forEach((td) => {
        const r = +td.dataset.r, c = +td.dataset.c;
        if (el.rows[r] && el.rows[r][c]) el.rows[r][c].html = td.querySelector('.sl-cell').innerHTML.replace(/^<br>$/, '');
      });
    } else {
      const txt = node.querySelector('.sl-txt');
      el.html = txt.innerHTML;
    }
  }
  function onEditInput() {
    const el = find(editingId);
    if (!el) return;
    readEditing();
    const node = layerNode(editingId);
    // 自动扩展高度
    if (el.type === 'text' && el.autoFit !== false) {
      const tb = node.querySelector('.sl-tb');
      const txt = node.querySelector('.sl-txt');
      const cs = getComputedStyle(tb);
      const need = Math.ceil(txt.scrollHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom));
      if (need > el.h) { el.h = need; node.style.height = need + 'px'; renderOverlay(); }
    } else if (el.type === 'table') {
      const t = node.querySelector('table');
      if (t && t.offsetHeight > el.h + 1) { el.h = t.offsetHeight; node.style.height = el.h + 'px'; renderOverlay(); }
    }
    ctx.markDirty();
    updateThumbSoon(cur);
  }
  function exitEdit() {
    if (!editingId) return;
    const id = editingId;
    const el = find(id);
    if (el) {
      readEditing();
      if (el.type !== 'table') {
        // 规范化：顶层裸文本包进 div
        const d = document.createElement('div');
        d.innerHTML = el.html;
        let pending = null;
        [...d.childNodes].forEach((n) => {
          const inline = n.nodeType === 3 || (n.nodeType === 1 && !/^(DIV|P|UL|OL|H\d|TABLE|BLOCKQUOTE)$/.test(n.tagName));
          if (inline) { if (!pending) { pending = document.createElement('div'); n.before(pending); } pending.append(n); }
          else pending = null;
        });
        el.html = isTextEmpty(d.innerHTML) ? '' : d.innerHTML;
      }
      const after = JSON.stringify(el.type === 'table' ? el.rows : el.html);
      if (after !== editState.before) {
        undoStack.push(editState.snap);
        if (undoStack.length > 120) undoStack.shift();
        redoStack.length = 0;
        lastTag = null;
        ctx.markDirty();
      }
    }
    editingId = null;
    editState = null;
    lastTableCell = null;
    getSelection().removeAllRanges();
    renderCanvas();
    renderOverlay();
    updateThumb(cur);
    sync();
  }
  E.exitEdit = exitEdit;
  E.enterEdit = (id) => enterEdit(id || selected()[0]?.id, null, true);

  const onSelChange = () => { if (editingId && isActive()) syncTextState(); };
  document.addEventListener('selectionchange', onSelChange);

  /** 应用文字格式。编辑中作用于选区，否则作用于选中对象的全部文字 */
  const ELEMENT_LEVEL = { fontName: 'fontFamily', fontSize: 'fontSize', foreColor: 'color' };
  function fixFontSize(root, pt) {
    root.querySelectorAll('font[size="7"]').forEach((f) => { const s = document.createElement('span'); s.style.fontSize = pt + 'pt'; s.append(...f.childNodes); f.replaceWith(s); });
    root.querySelectorAll('[style]').forEach((n) => { if (n.style.fontSize === 'xxx-large' || n.style.fontSize === '-webkit-xxx-large') { n.style.fontSize = pt + 'pt'; n.querySelectorAll('[style]').forEach((c) => (c.style.fontSize = '')); } });
  }
  function stripInline(html, prop) {
    const d = document.createElement('div');
    d.innerHTML = html;
    d.querySelectorAll('[style]').forEach((n) => { n.style[prop] = ''; if (!n.getAttribute('style')) n.removeAttribute('style'); });
    if (prop === 'color') d.querySelectorAll('font[color]').forEach((f) => f.removeAttribute('color'));
    if (prop === 'fontFamily') d.querySelectorAll('font[face]').forEach((f) => f.removeAttribute('face'));
    return d.innerHTML;
  }
  function fmt(cmd, value) {
    if (editingId) {
      document.execCommand('styleWithCSS', false, true);
      if (cmd === 'fontSize') {
        document.execCommand('fontSize', false, '7');
        fixFontSize(layerNode(editingId), value);
      } else document.execCommand(cmd, false, value);
      onEditInput();
      syncTextState();
      return;
    }
    const targets = selected().filter(textCapable);
    if (!targets.length) return;
    checkpoint();
    for (const el of targets) {
      const prop = ELEMENT_LEVEL[cmd];
      if (prop) {
        el.style = el.style || {};
        el.style[prop] = cmd === 'fontSize' ? +value : value;
        if (el.type === 'table') el.rows.forEach((r) => r.forEach((c) => (c.html = stripInline(c.html || '', prop))));
        else el.html = stripInline(el.html || '', prop);
        continue;
      }
      if (cmd === 'removeFormat') {
        const strip = (html) => { const d = document.createElement('div'); d.innerHTML = html; d.querySelectorAll('[style]').forEach((n) => n.removeAttribute('style')); d.querySelectorAll('b,strong,i,em,u,s,strike,font,span').forEach((n) => n.replaceWith(...n.childNodes)); return d.innerHTML; };
        if (el.type === 'table') el.rows.forEach((r) => r.forEach((c) => (c.html = strip(c.html || ''))));
        else el.html = strip(el.html || '');
        Object.assign(el.style, { bold: false, italic: false, underline: false, strike: false, effect: null });
        continue;
      }
      const toggles = { bold: 'bold', italic: 'italic', underline: 'underline', strikeThrough: 'strike' };
      if (toggles[cmd] && (el.type === 'table' || isTextEmpty(el.html))) {
        el.style[toggles[cmd]] = !el.style[toggles[cmd]];
        continue;
      }
      // 借助 execCommand 处理整个对象的文字
      const node = layerNode(el.id);
      const runOn = (target) => {
        target.contentEditable = 'true';
        target.focus();
        const r = document.createRange();
        r.selectNodeContents(target);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        document.execCommand('styleWithCSS', false, true);
        document.execCommand(cmd, false, value);
        target.contentEditable = 'false';
        return target.innerHTML;
      };
      if (!node) continue;
      if (el.type === 'table') {
        node.querySelectorAll('td').forEach((td) => {
          const cell = td.querySelector('.sl-cell');
          if (cell.textContent.trim()) el.rows[+td.dataset.r][+td.dataset.c].html = runOn(cell);
        });
      } else {
        const txt = node.querySelector('.sl-txt');
        if (!isTextEmpty(el.html)) el.html = runOn(txt);
      }
    }
    getSelection().removeAllRanges();
    afterChange();
  }
  E.fmt = fmt;

  function setStyle(prop, value, { strip } = {}) {
    if (editingId) {
      const el = find(editingId);
      if (prop === 'align' && el.type !== 'table') {
        document.execCommand({ left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight', justify: 'justifyFull' }[value]);
        onEditInput();
        return;
      }
      if (prop === 'align' && el.type === 'table' && lastTableCell) {
        const r = +lastTableCell.dataset.r, c = +lastTableCell.dataset.c;
        el.rows[r][c].align = value;
        lastTableCell.style.textAlign = value;
        ctx.markDirty();
        return;
      }
      el.style[prop] = value;
      const node = layerNode(editingId);
      const txt = node.querySelector('.sl-txt');
      if (txt) {
        if (prop === 'lineHeight') txt.style.lineHeight = value;
        if (prop === 'bullet') { txt.classList.toggle('sl-bul', value === 'disc'); txt.classList.toggle('sl-num', value === 'decimal'); }
        if (prop === 'valign') node.querySelector('.sl-tb').style.justifyContent = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[value];
        if (prop === 'effect') { exitEdit(); renderCanvas(); }
      }
      ctx.markDirty();
      sync();
      return;
    }
    const targets = selected().filter(textCapable);
    if (!targets.length) return;
    change(() => {
      for (const el of targets) {
        el.style = el.style || {};
        el.style[prop] = value;
        if (strip) {
          if (el.type === 'table') el.rows.forEach((r) => r.forEach((c) => { c.html = stripInline(c.html || '', strip); if (prop === 'align') c.align = value; }));
          else el.html = stripInline(el.html || '', strip);
        }
      }
    });
  }
  E.setAlign = (a) => setStyle('align', a, { strip: 'textAlign' });
  E.setValign = (v) => setStyle('valign', v);
  E.setLineHeight = (v) => setStyle('lineHeight', +v);
  E.setBullet = (b) => {
    const el = editingId ? find(editingId) : selected().find(textCapable);
    if (!el) return;
    setStyle('bullet', el.style?.bullet === b ? null : b);
  };
  E.setWordArt = (id) => setStyle('effect', id === 'none' ? null : id);
  E.growFont = (dir) => {
    const steps = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 72, 80, 96];
    const curSize = currentFontSize() || 18;
    let next = dir > 0 ? steps.find((s) => s > curSize) || curSize + 8 : [...steps].reverse().find((s) => s < curSize) || Math.max(1, curSize - 1);
    fmt('fontSize', next);
  };
  function currentFontSize() {
    if (editingId) {
      const s = getSelection();
      let n = s.anchorNode;
      if (n && n.nodeType === 3) n = n.parentElement;
      if (n) return Math.round(parseFloat(getComputedStyle(n).fontSize) * 0.75 * 2) / 2;
    }
    const el = selected().find(textCapable);
    return el ? el.style?.fontSize || 18 : null;
  }

  /* ---------------- 选择相关命令 ---------------- */
  E.selectAll = () => {
    if (editingId) { document.execCommand('selectAll'); return; }
    if (focusArea === 'thumbs') { slideSel = new Set(deck.slides.map((_, i) => i)); markSlideSel(); return; }
    sel = new Set(slide().elements.map((e) => e.id));
    renderOverlay(); sync();
  };
  E.deleteSel = () => {
    if (!sel.size) return;
    change(() => {
      slide().elements = slide().elements.filter((e) => !sel.has(e.id) || e.locked);
      slide().animations = slide().animations.filter((a) => slide().elements.some((e) => e.id === a.elId));
      sel.clear();
    });
  };

  /* -------- 剪贴板 -------- */
  function collectMedia(els) {
    const m = {};
    for (const e of els) if (e.mediaId && deck.media[e.mediaId]) m[e.mediaId] = deck.media[e.mediaId];
    return m;
  }
  function setClip(c) {
    c.mark = 'sl-clip:' + uid();
    CLIPBOARD = c;
    clipSystemOk = false;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(c.mark).then(() => (clipSystemOk = true)).catch(() => {});
  }
  E.copy = () => {
    if (focusArea === 'thumbs') return E.copySlides();
    const els = selected();
    if (!els.length) return;
    const anims = slide().animations.filter((a) => sel.has(a.elId));
    setClip({ kind: 'elements', items: structuredClone(els), anims: structuredClone(anims), media: collectMedia(els) });
  };
  E.cut = () => {
    if (focusArea === 'thumbs') { E.copySlides(); E.deleteSlides(); return; }
    E.copy();
    E.deleteSel();
  };
  E.copySlides = () => {
    const idx = [...slideSel].sort((a, b) => a - b);
    const slides = idx.map((i) => deck.slides[i]);
    setClip({ kind: 'slides', items: structuredClone(slides), media: collectMedia(slides.flatMap((s) => s.elements).concat(slides.map((s) => s.bg || {}))) });
    toast(`已复制 ${slides.length} 张幻灯片`, 'info', 1200);
  };
  function importMedia(media) {
    for (const [k, v] of Object.entries(media || {})) if (!deck.media[k]) deck.media[k] = v;
  }
  function pasteInternal() {
    const c = CLIPBOARD;
    if (!c) return;
    importMedia(c.media);
    if (c.kind === 'slides') {
      change(() => {
        const at = cur + 1;
        const copies = c.items.map(cloneSlide);
        deck.slides.splice(at, 0, ...copies);
        cur = at;
        slideSel = new Set(copies.map((_, k) => at + k));
        sel.clear();
      }, { slides: true });
      return;
    }
    change(() => {
      const offset = c.items.some((it) => slide().elements.some((e) => e.x === it.x && e.y === it.y)) ? 20 : 0;
      const map = {}, gmap = {};
      const copies = c.items.map((it) => {
        const n = cloneEl(it, offset, offset);
        n.role = it.role === 'title' && slide().elements.some((e) => e.role === 'title') ? null : it.role;
        n.placeholder = null;
        if (n.groupId) n.groupId = gmap[n.groupId] || (gmap[n.groupId] = uid());
        map[it.id] = n.id;
        return n;
      });
      slide().elements.push(...copies);
      for (const a of c.anims || []) if (map[a.elId]) slide().animations.push({ ...a, id: uid(), elId: map[a.elId] });
      sel = new Set(copies.map((x) => x.id));
      // 连续粘贴时继续偏移
      c.items.forEach((it) => { it.x += offset; it.y += offset; });
    });
  }
  E.paste = async () => {
    if (editingId) {
      try { const t = await navigator.clipboard.readText(); if (t) document.execCommand('insertText', false, t); } catch { toast('请使用 Ctrl+V 粘贴'); }
      return;
    }
    if (CLIPBOARD) { pasteInternal(); return; }
    try {
      const t = await navigator.clipboard.readText();
      if (t) insertTextBox(t);
    } catch { toast('请使用 Ctrl+V 粘贴'); }
  };
  E.pasteText = async () => {
    try { const t = await navigator.clipboard.readText(); if (t) { if (editingId) document.execCommand('insertText', false, t); else insertTextBox(t); } } catch { toast('无法读取剪贴板，请使用 Ctrl+V'); }
  };
  E.duplicate = () => {
    if (focusArea === 'thumbs') return E.duplicateSlides();
    const els = selected();
    if (!els.length) return;
    change(() => {
      const gmap = {};
      const copies = els.map((e) => { const n = cloneEl(e, 20, 20); n.placeholder = null; if (n.role === 'title') n.role = null; if (n.groupId) n.groupId = gmap[n.groupId] || (gmap[n.groupId] = uid()); return n; });
      slide().elements.push(...copies);
      sel = new Set(copies.map((c) => c.id));
    });
  };

  document.addEventListener('paste', onPaste);
  async function onPaste(e) {
    if (!isActive() || document.querySelector('.modal-overlay')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const cd = e.clipboardData;
    if (editingId) {
      // 只粘贴纯文本，避免带入外部复杂样式
      e.preventDefault();
      const text = cd.getData('text/plain');
      if (text && !(CLIPBOARD && text === CLIPBOARD.mark)) document.execCommand('insertText', false, text);
      return;
    }
    if (!root.contains(document.activeElement) && document.activeElement !== document.body) return;
    e.preventDefault();
    const files = [...cd.files].filter((f) => f.type.startsWith('image/'));
    if (files.length) { for (const f of files) await insertImageFile(f); return; }
    const text = cd.getData('text/plain');
    if (CLIPBOARD && (text === CLIPBOARD.mark || (!clipSystemOk && !text) || !text)) { pasteInternal(); return; }
    if (text) insertTextBox(text);
  }

  /* -------- 排列 -------- */
  E.order = (how) => {
    const ids = sel;
    if (!ids.size) return;
    change(() => {
      const arr = slide().elements;
      const picked = arr.filter((e) => ids.has(e.id));
      const rest = arr.filter((e) => !ids.has(e.id));
      if (how === 'front') slide().elements = [...rest, ...picked];
      else if (how === 'back') slide().elements = [...picked, ...rest];
      else {
        const a = arr.slice();
        if (how === 'forward') {
          for (let i = a.length - 2; i >= 0; i--) if (ids.has(a[i].id) && !ids.has(a[i + 1].id)) [a[i], a[i + 1]] = [a[i + 1], a[i]];
        } else {
          for (let i = 1; i < a.length; i++) if (ids.has(a[i].id) && !ids.has(a[i - 1].id)) [a[i], a[i - 1]] = [a[i - 1], a[i]];
        }
        slide().elements = a;
      }
    });
  };
  E.align = (how) => {
    const els = selected().filter((e) => !e.locked);
    if (!els.length) return;
    const ref = els.length === 1 ? { x: 0, y: 0, w: W(), h: H() } : bbox(els);
    change(() => {
      for (const e of els) {
        if (how === 'left') e.x = ref.x;
        if (how === 'hcenter') e.x = Math.round(ref.x + (ref.w - e.w) / 2);
        if (how === 'right') e.x = ref.x + ref.w - e.w;
        if (how === 'top') e.y = ref.y;
        if (how === 'vcenter') e.y = Math.round(ref.y + (ref.h - e.h) / 2);
        if (how === 'bottom') e.y = ref.y + ref.h - e.h;
      }
    });
  };
  E.distribute = (dir) => {
    const els = selected().filter((e) => !e.locked);
    if (els.length < 3) { toast('请至少选择 3 个对象'); return; }
    change(() => {
      const k = dir === 'h' ? 'x' : 'y', s = dir === 'h' ? 'w' : 'h';
      els.sort((a, b) => a[k] - b[k]);
      const first = els[0], last = els[els.length - 1];
      const total = els.reduce((t, e) => t + e[s], 0);
      const gap = (last[k] + last[s] - first[k] - total) / (els.length - 1);
      let pos = first[k];
      for (const e of els) { e[k] = Math.round(pos); pos += e[s] + gap; }
    });
  };
  E.group = () => {
    if (sel.size < 2) return;
    change(() => { const g = uid(); selected().forEach((e) => (e.groupId = g)); });
  };
  E.ungroup = () => change(() => selected().forEach((e) => delete e.groupId));
  E.toggleLock = () => {
    const els = selected();
    const lock = !els.every((e) => e.locked);
    change(() => els.forEach((e) => (e.locked = lock)));
  };
  E.rotate = (deg) => change(() => selected().forEach((e) => (e.rot = (((e.rot || 0) + deg) % 360 + 360) % 360)));
  E.flip = (axis) => change(() => selected().forEach((e) => {
    if (e.type === 'image') { if (axis === 'h') e.flipH = !e.flipH; else e.flipV = !e.flipV; }
    else e.rot = axis === 'h' ? (360 - (e.rot || 0)) % 360 : (180 - (e.rot || 0) + 360) % 360;
  }));
  E.setGeom = (prop, v) => {
    const el = selected()[0];
    if (!el || isNaN(v)) return;
    change(() => {
      if (prop === 'w' && el.type === 'image' && E.lockRatio) { el.h = Math.round(el.h * (v / el.w)); }
      if (prop === 'h' && el.type === 'image' && E.lockRatio) { el.w = Math.round(el.w * (v / el.h)); }
      el[prop] = prop === 'rot' ? ((v % 360) + 360) % 360 : Math.round(v);
    });
  };
  E.lockRatio = true;

  /* -------- 格式刷 -------- */
  E.painter = () => {
    const el = selected()[0];
    if (!el) { toast('请先选择一个对象'); return; }
    painter = { style: structuredClone(el.style || {}), fill: structuredClone(el.fill), stroke: structuredClone(el.stroke), shadow: el.shadow, type: el.type };
    root.classList.add('sl-painting');
    toast('单击目标对象以应用格式（Esc 取消）', 'info', 1800);
  };
  function applyPainter(el) {
    const p = painter;
    painter = null;
    root.classList.remove('sl-painting');
    change(() => {
      el.style = { ...el.style, ...p.style };
      if (el.type === 'shape' && p.type === 'shape') { el.fill = structuredClone(p.fill); el.stroke = structuredClone(p.stroke); el.shadow = p.shadow; }
      el.html = stripInline(stripInline(stripInline(el.html || '', 'color'), 'fontSize'), 'fontFamily');
      sel = new Set([el.id]);
    });
  }

  /* -------- 形状格式 -------- */
  const shapeTargets = () => selected().filter((e) => e.type === 'shape' || e.type === 'text');
  E.setFill = (color) => change(() => shapeTargets().forEach((e) => {
    if (e.type === 'text') { e.type = 'shape'; e.shape = 'rect'; e.stroke = { width: 0 }; e.style.color = e.style.color || getTheme(deck.theme).colors.text; }
    e.fill = color == null ? { type: 'none' } : { ...(e.fill || {}), type: e.fill?.type === 'gradient' ? 'gradient' : 'solid', color };
  }));
  E.setGradient = (g) => change(() => shapeTargets().forEach((e) => {
    if (e.type === 'text') { e.type = 'shape'; e.shape = 'rect'; e.stroke = { width: 0 }; }
    e.fill = g ? { type: 'gradient', color: g.color || e.fill?.color || null, color2: g.color2, angle: g.angle } : { type: 'solid', color: e.fill?.color || null };
  }));
  E.setStroke = (prop, v) => change(() => shapeTargets().forEach((e) => {
    if (e.type === 'text') { e.type = 'shape'; e.shape = 'rect'; e.fill = { type: 'none' }; }
    e.stroke = { width: 0, dash: 'solid', ...(e.stroke || {}) };
    if (prop === 'color') { e.stroke.color = v; if (v == null) e.stroke.width = 0; else if (!e.stroke.width) e.stroke.width = 1.5; }
    else e.stroke[prop] = v;
  }));
  E.toggleShadow = () => {
    const els = selected();
    const on = !els.every((e) => e.shadow);
    change(() => els.forEach((e) => (e.shadow = on)));
  };
  E.setOpacity = (v) => change(() => selected().forEach((e) => (e.opacity = v)));
  E.changeShape = (key) => change(() => selected().forEach((e) => {
    if (e.type === 'text') { Object.assign(e, { type: 'shape', fill: { type: 'solid', color: null }, stroke: { width: 0 } }); }
    if (e.type === 'shape') e.shape = key;
  }));
  E.quickStyle = (qs) => change(() => shapeTargets().forEach((e) => {
    if (e.type === 'text') { e.type = 'shape'; e.shape = 'rect'; }
    e.fill = qs.fill; e.stroke = qs.stroke; e.shadow = !!qs.shadow;
    e.style = { ...e.style, color: qs.color };
  }));

  /* -------- 图片 -------- */
  E.imageProp = (prop, v) => change(() => selected().filter((e) => e.type === 'image').forEach((e) => {
    if (prop === 'border') e.border = v;
    else e[prop] = v;
  }));
  E.resetImageSize = () => {
    const el = selected().find((e) => e.type === 'image' && e.mediaId);
    if (!el) return;
    const img = new Image();
    img.onload = () => change(() => {
      let w = img.naturalWidth, hh = img.naturalHeight;
      const k = Math.min(1, (W() * 0.9) / w, (H() * 0.9) / hh);
      w = Math.round(w * k); hh = Math.round(hh * k);
      el.x += Math.round((el.w - w) / 2); el.y += Math.round((el.h - hh) / 2);
      el.w = w; el.h = hh; el.rot = 0; el.flipH = el.flipV = false; el.filter = null;
    });
    img.src = mediaSrc(deck, el.mediaId);
  };
  E.pickImageFor = async (el) => {
    const f = await pickFile('image/*');
    if (!f) return;
    const img = await loadImage(f);
    const id = uid();
    deck.media[id] = img.url;
    change(() => {
      const wasPh = !el.mediaId;
      el.mediaId = id;
      if (wasPh) { el.fit = 'cover'; el.placeholder = null; }
      else { const k = el.w / img.w; el.h = Math.round(img.h * k); }
    });
  };

  /* -------- 插入 -------- */
  function addElement(el, { edit = false } = {}) {
    change(() => {
      slide().elements.push(el);
      sel = new Set([el.id]);
    });
    if (edit) enterEdit(el.id, null, true);
    return el;
  }
  function centered(w, hh) { return { x: Math.round((W() - w) / 2), y: Math.round((H() - hh) / 2), w, h: hh }; }
  function insertTextBox(text) {
    const lines = String(text).split(/\r?\n/);
    const el = textEl({ ...centered(Math.min(700, Math.max(240, Math.max(...lines.map((l) => l.length)) * 14)), 40 + lines.length * 28), html: linesToHtml(lines) });
    addElement(el);
  }
  E.insertTextBox = (vertical) => {
    const el = textEl({ ...centered(vertical ? 60 : 360, vertical ? 240 : 48), html: '' });
    if (vertical) { el.style.vertical = true; el.autoFit = false; }
    addElement(el, { edit: true });
  };
  E.insertWordArt = (effect) => {
    const el = textEl({ ...centered(560, 100), html: linesToHtml('请在此处放置您的文字'), style: { fontSize: 48, bold: true, align: 'center', valign: 'middle', effect, color: effect === 'shadow' || effect === '3d' ? getTheme(deck.theme).colors.accent[0] : null } });
    el.autoFit = false;
    addElement(el, { edit: false });
    enterEdit(el.id, null, true);
  };
  E.insertShape = (key) => {
    const line = isLine(key);
    const el = shapeEl(key, centered(line ? 240 : key === 'rightArrow' || key === 'leftArrow' || key === 'leftRightArrow' || key === 'chevron' || key === 'homePlate' ? 200 : 160, line ? 20 : key.includes('Arrow') && !key.startsWith('left') && !key.startsWith('right') ? 160 : 120));
    if (key === 'wedgeRectCallout' || key === 'wedgeEllipseCallout') el.w = 220;
    addElement(el);
  };
  E.insertImage = async () => {
    const files = await pickFile('image/*', true);
    if (!files || !files.length) return;
    for (const f of files) await insertImageFile(f);
  };
  async function insertImageFile(f) {
    const img = await loadImage(f);
    const id = uid();
    deck.media[id] = img.url;
    const k = Math.min(1, (W() * 0.6) / img.w, (H() * 0.7) / img.h);
    const w = Math.round(img.w * k), hh = Math.round(img.h * k);
    addElement(baseEl('image', { ...centered(w, hh), mediaId: id, border: null, radius: 0 }));
  }
  E.insertTable = (r, c) => {
    const el = tableEl(r, c);
    Object.assign(el, centered(el.w, el.h));
    addElement(el);
  };
  E.insertTableDialog = async () => {
    const r = await formBox('插入表格', [{ name: 'rows', label: '行数', type: 'number', value: 4, min: 1, max: 30 }, { name: 'cols', label: '列数', type: 'number', value: 4, min: 1, max: 15 }]);
    if (r && r.rows > 0 && r.cols > 0) E.insertTable(Math.min(30, r.rows), Math.min(15, r.cols));
  };
  E.insertChart = (type) => {
    const el = chartEl({ ...centered(640, 380), chartType: type, data: defaultChartData() });
    addElement(el);
  };
  E.insertSymbol = (s) => {
    if (editingId) { document.execCommand('insertText', false, s); onEditInput(); return; }
    insertTextBox(s);
  };
  E.insertDate = async () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const fmts = [
      `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`,
      `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`,
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${'日一二三四五六'[d.getDay()]}`,
      `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    ];
    const wasEditing = editingId;
    const range = wasEditing && getSelection().rangeCount ? getSelection().getRangeAt(0).cloneRange() : null;
    const r = await formBox('日期和时间', [{ name: 'f', label: '格式', type: 'select', value: fmts[0], options: fmts }]);
    if (!r) return;
    if (wasEditing && editingId === wasEditing && range) {
      const s = getSelection(); s.removeAllRanges(); s.addRange(range);
      document.execCommand('insertText', false, r.f); onEditInput();
    } else insertTextBox(r.f);
  };
  E.headerFooter = async () => {
    const f = deck.footer || {};
    const r = await formBox('页眉和页脚', [
      { name: 'showDate', label: '日期和时间', type: 'checkbox', value: f.showDate },
      { name: 'dateText', label: '固定日期（留空自动更新）', type: 'text', value: f.dateText || '' },
      { name: 'showNumber', label: '幻灯片编号', type: 'checkbox', value: f.showNumber },
      { name: 'text', label: '页脚文字', type: 'text', value: f.text || '' },
      { name: 'notOnTitle', label: '标题幻灯片中不显示', type: 'checkbox', value: f.notOnTitle !== false },
    ], { okLabel: '全部应用' });
    if (r) change(() => { deck.footer = r; }, { slides: true });
  };
  E.slideNumber = () => change(() => { deck.footer = { ...(deck.footer || {}), showNumber: !deck.footer?.showNumber }; }, { slides: true });
  E.link = async () => {
    const wasEditing = editingId;
    const s = getSelection();
    const range = wasEditing && s.rangeCount && !s.isCollapsed ? s.getRangeAt(0).cloneRange() : null;
    const target = selected()[0];
    if (!range && !target) { toast('请先选择文字或对象'); return; }
    const opts = [{ value: '', label: '（网址）' }, ...deck.slides.map((sl, i) => ({ value: '#slide-' + (i + 1), label: `幻灯片 ${i + 1}：${slideTitle(sl, i).slice(0, 20)}` }))];
    const r = await formBox('插入超链接', [
      { name: 'url', label: '网址', type: 'text', value: (!range && target?.link && !target.link.startsWith('#')) ? target.link : 'https://' },
      { name: 'slide', label: '或本文档中的位置', type: 'select', value: target?.link?.startsWith('#') ? target.link : '', options: opts },
      ...(!range && target?.link ? [{ name: 'remove', label: '删除链接', type: 'checkbox', value: false }] : []),
    ]);
    if (!r) return;
    const url = r.slide || (r.url && r.url !== 'https://' ? r.url : '');
    if (range && editingId === wasEditing) {
      const ss = getSelection(); ss.removeAllRanges(); ss.addRange(range);
      if (url) document.execCommand('createLink', false, url);
      onEditInput();
      return;
    }
    if (target) change(() => { target.link = r.remove ? null : url || null; });
  };

  /* -------- 表格 -------- */
  const curTable = () => {
    const el = editingId ? find(editingId) : selected()[0];
    return el && el.type === 'table' ? el : null;
  };
  function tableCellPos() {
    if (lastTableCell) return { r: +lastTableCell.dataset.r, c: +lastTableCell.dataset.c };
    return null;
  }
  E.tableOp = (op) => {
    const t = curTable();
    if (!t) return;
    const pos = tableCellPos() || { r: t.rows.length - 1, c: t.colW.length - 1 };
    const wasEditing = editingId === t.id;
    if (wasEditing) exitEdit();
    change(() => {
      const nc = t.colW.length;
      const blankRow = () => Array.from({ length: nc }, () => ({ html: '' }));
      if (op === 'rowAbove') { t.rows.splice(pos.r, 0, blankRow()); t.h += Math.round(t.h / (t.rows.length - 1)); }
      if (op === 'rowBelow') { t.rows.splice(pos.r + 1, 0, blankRow()); t.h += Math.round(t.h / (t.rows.length - 1)); }
      if (op === 'colLeft' || op === 'colRight') {
        const at = op === 'colLeft' ? pos.c : pos.c + 1;
        t.rows.forEach((r) => r.splice(at, 0, { html: '' }));
        t.colW.splice(at, 0, t.colW[pos.c] || 1);
      }
      if (op === 'delRow' && t.rows.length > 1) { t.h = Math.round(t.h * (t.rows.length - 1) / t.rows.length); t.rows.splice(pos.r, 1); }
      if (op === 'delCol' && t.colW.length > 1) { t.rows.forEach((r) => r.splice(pos.c, 1)); t.colW.splice(pos.c, 1); }
      if (op === 'delTable') { slide().elements = slide().elements.filter((e) => e !== t); sel.clear(); }
      if (op === 'evenCols') t.colW = t.colW.map(() => 1);
    });
  };
  E.tableStyle = (patch) => {
    const t = curTable();
    if (!t) return;
    change(() => { t.tableStyle = { header: true, banded: true, ...(t.tableStyle || {}), ...patch }; });
  };
  E.cellFill = (color) => {
    const t = curTable();
    if (!t) return;
    const pos = tableCellPos();
    if (editingId) exitEdit();
    change(() => {
      if (pos) t.rows[pos.r][pos.c].fill = color;
      else t.rows.forEach((r) => r.forEach((c) => (c.fill = color)));
    });
  };

  /* -------- 图表 -------- */
  E.editChartData = async () => {
    const el = selected().find((e) => e.type === 'chart');
    if (!el) return;
    const ta = h('textarea', { class: 'input sl-chart-ta', rows: 10 }, dataToText(el.data || defaultChartData()));
    const typeSel = h('select', { class: 'input' }, CHART_TYPES.map((t) => h('option', { value: t.value, selected: t.value === el.chartType }, t.label)));
    const title = h('input', { class: 'input', value: el.chartTitle || '', placeholder: '图表标题（可选）' });
    const legend = h('input', { type: 'checkbox', checked: el.legend !== false });
    const r = await modal({
      title: '编辑图表数据',
      width: 560,
      body: h('div', { class: 'form' },
        h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, '图表类型'), typeSel),
        h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, '标题'), title),
        h('label', { class: 'form-check' }, legend, '显示图例'),
        h('div', { class: 'muted' }, '首行为类别，之后每行为一个系列（制表符或逗号分隔），可直接从表格粘贴：'),
        ta),
      buttons: [{ label: '取消', value: null }, { label: '确定', primary: true, onClick: () => { try { return { data: textToData(ta.value) }; } catch (e) { toast(e.message, 'error'); return false; } } }],
    });
    if (!r) return;
    change(() => { el.data = r.data; el.chartType = typeSel.value; el.chartTitle = title.value; el.legend = legend.checked; });
  };
  E.chartProp = (prop, v) => {
    const el = selected().find((e) => e.type === 'chart');
    if (el) change(() => { el[prop] = v; });
  };

  /* -------- 幻灯片 -------- */
  E.addSlide = (layout) => {
    const lay = layout || (slide().layout === 'title' ? 'titleContent' : slide().layout === 'blank' ? 'blank' : slide().layout || 'titleContent');
    change(() => {
      const s = newSlide(lay, deck);
      s.transition = { ...slide().transition };
      deck.slides.splice(cur + 1, 0, s);
      cur++;
      slideSel = new Set([cur]);
      sel.clear();
    }, { slides: true });
  };
  E.duplicateSlides = () => {
    const idx = [...slideSel].sort((a, b) => a - b);
    change(() => {
      const last = idx[idx.length - 1];
      const copies = idx.map((i) => cloneSlide(deck.slides[i]));
      deck.slides.splice(last + 1, 0, ...copies);
      cur = last + 1;
      slideSel = new Set(copies.map((_, k) => last + 1 + k));
      sel.clear();
    }, { slides: true });
  };
  E.deleteSlides = () => {
    const idx = [...slideSel].sort((a, b) => a - b);
    if (idx.length >= deck.slides.length) {
      change(() => { deck.slides = [newSlide('title', deck)]; cur = 0; slideSel = new Set([0]); sel.clear(); }, { slides: true });
      return;
    }
    change(() => {
      deck.slides = deck.slides.filter((_, i) => !slideSel.has(i));
      cur = Math.min(idx[0], deck.slides.length - 1);
      slideSel = new Set([cur]);
      sel.clear();
    }, { slides: true });
  };
  function moveSlides(indices, target) {
    if (!indices.length) return;
    const curId = slide().id;
    change(() => {
      const moving = indices.map((i) => deck.slides[i]);
      const before = indices.filter((i) => i < target).length;
      deck.slides = deck.slides.filter((_, i) => !indices.includes(i));
      const at = target - before;
      deck.slides.splice(at, 0, ...moving);
      slideSel = new Set(moving.map((_, k) => at + k));
      cur = deck.slides.findIndex((s) => s.id === curId);
    }, { slides: true });
  }
  E.moveSlide = (d) => {
    const i = cur, j = cur + d;
    if (j < 0 || j >= deck.slides.length) return;
    moveSlides([i], d > 0 ? j + 1 : j);
  };
  E.toggleHidden = () => {
    const idx = slideSel.size ? [...slideSel] : [cur];
    const hide = !idx.every((i) => deck.slides[i].hidden);
    change(() => idx.forEach((i) => (deck.slides[i].hidden = hide)), { slides: true });
  };
  E.setLayout = (layout) => change(() => {
    const s = slide();
    const fresh = layoutElements(layout, W(), H());
    const oldPh = s.elements.filter((e) => e.placeholder || e.role);
    const used = new Set();
    for (const n of fresh) {
      const compat = (o) => o.role === n.role || (n.role === 'body' && (o.role === 'subtitle' || !o.role)) || (n.role === 'subtitle' && o.role === 'body');
      const m = oldPh.find((o) => !used.has(o.id) && o.type === n.type && o.role === n.role) || oldPh.find((o) => !used.has(o.id) && o.type === n.type && compat(o));
      if (m) { used.add(m.id); if (m.type === 'image') n.mediaId = m.mediaId; else n.html = m.html; if (n.mediaId) n.placeholder = n.placeholder; }
    }
    const keep = s.elements.filter((e) => !(e.placeholder || e.role) || (!used.has(e.id) && !(e.type === 'image' ? !e.mediaId : isTextEmpty(e.html))));
    const keepIds = new Set(keep.map((e) => e.id));
    s.animations = s.animations.filter((a) => keepIds.has(a.elId));
    s.elements = [...fresh, ...keep.filter((e) => !used.has(e.id))];
    s.layout = layout;
    sel.clear();
  }, { slides: true });
  E.resetSlide = () => E.setLayout(slide().layout || 'titleContent');

  /* -------- 设计 -------- */
  E.setTheme = (id, all = true) => change(() => {
    deck.theme = id;
    if (all) deck.slides.forEach((s) => (s.bg = null));
    else slide().bg = null;
  }, { slides: true });
  E.setSize = (size) => {
    if (size === deck.size) return;
    change(() => {
      const oldH = H();
      deck.size = size;
      const k = H() / oldH;
      for (const s of deck.slides) for (const e of s.elements) {
        const cy = e.y + e.h / 2;
        e.y = Math.round(cy * k - e.h / 2);
      }
    }, { slides: true });
    fit();
  };
  E.formatBackground = async () => {
    const bg = slide().bg || structuredClone(getTheme(deck.theme).bg);
    const typeSel = h('select', { class: 'input' }, [['theme', '跟随主题'], ['solid', '纯色填充'], ['gradient', '渐变填充'], ['image', '图片填充']].map(([v, l]) => h('option', { value: v }, l)));
    typeSel.value = slide().bg ? bg.type : 'theme';
    const c1 = h('input', { type: 'color', value: bg.color && bg.color.startsWith('#') ? bg.color.slice(0, 7) : '#ffffff' });
    const c2 = h('input', { type: 'color', value: bg.color2 || '#4472c4' });
    const ang = h('input', { class: 'input', type: 'number', value: bg.angle ?? 135, style: 'width:80px' });
    let mediaId = bg.mediaId || null;
    const imgBtn = h('button', { class: 'btn', onclick: async () => { const f = await pickFile('image/*'); if (f) { const img = await loadImage(f); mediaId = uid(); deck.media[mediaId] = img.url; imgBtn.textContent = '已选择图片 ✓'; } } }, mediaId ? '已选择图片 ✓' : '选择图片...');
    const rowC1 = h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, '颜色'), c1);
    const rowC2 = h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, '结束颜色'), c2);
    const rowA = h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, '角度'), ang);
    const rowI = h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, '图片'), imgBtn);
    const upd = () => {
      const t = typeSel.value;
      rowC1.style.display = t === 'theme' ? 'none' : '';
      rowC2.style.display = rowA.style.display = t === 'gradient' ? '' : 'none';
      rowI.style.display = t === 'image' ? '' : 'none';
    };
    typeSel.addEventListener('change', upd);
    upd();
    const make = () => {
      const t = typeSel.value;
      if (t === 'theme') return null;
      if (t === 'solid') return { type: 'solid', color: c1.value };
      if (t === 'gradient') return { type: 'gradient', color: c1.value, color2: c2.value, angle: +ang.value || 0 };
      return { type: 'image', mediaId, color: c1.value };
    };
    const r = await modal({
      title: '设置背景格式', width: 400,
      body: h('div', { class: 'form' }, h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, '填充'), typeSel), rowC1, rowC2, rowA, rowI),
      buttons: [{ label: '取消', value: null }, { label: '全部应用', onClick: () => ({ all: true, bg: make() }) }, { label: '应用', primary: true, onClick: () => ({ all: false, bg: make() }) }],
    });
    if (!r) return;
    if (r.bg && r.bg.type === 'image' && !r.bg.mediaId) { toast('请选择图片'); return; }
    change(() => {
      const idx = r.all ? deck.slides.map((_, i) => i) : [...new Set([cur, ...slideSel])];
      idx.forEach((i) => (deck.slides[i].bg = r.bg ? structuredClone(r.bg) : null));
    }, { slides: true });
  };
  E.resetBackground = () => change(() => { slide().bg = null; }, { slides: true });

  /* -------- 切换 -------- */
  E.setTransition = (type) => {
    const idx = [...new Set([cur, ...slideSel])];
    change(() => idx.forEach((i) => (deck.slides[i].transition = { ...(deck.slides[i].transition || {}), type })), { slides: true });
    if (type !== 'none') E.previewTransition();
  };
  E.setTransitionDuration = (d) => change(() => { slide().transition = { ...slide().transition, duration: Math.max(0.1, Math.min(10, d)) }; }, { tag: 'trdur' });
  E.applyTransitionAll = () => {
    const t = structuredClone(slide().transition);
    change(() => deck.slides.forEach((s) => (s.transition = structuredClone(t))), { slides: true });
    toast('已应用到全部幻灯片', 'success', 1200);
  };
  E.previewTransition = () => {
    if (editingId) exitEdit();
    const t = slide().transition || {};
    const prevHTML = cur > 0 ? slideHTML(deck.slides[cur - 1], deck, { mode: 'show', index: cur - 1 }) : `<div style="width:${W()}px;height:${H()}px;background:#000"></div>`;
    const box = h('div', { class: 'sl-preview' });
    const a = h('div', { class: 'sl-preview-layer', html: prevHTML });
    const b = h('div', { class: 'sl-preview-layer', html: slideHTML(slide(), deck, { mode: 'show', index: cur }) });
    box.append(a, b);
    stage.append(box);
    const fallback = setTimeout(() => box.remove(), (t.duration || 0.7) * 1000 + 800);
    box.addEventListener('mousedown', (e) => { e.stopPropagation(); box.remove(); });
    playTransition(t.type === 'none' ? 'fade' : t.type, a, b, t.duration || 0.7).then((anims) => { clearTimeout(fallback); (anims || []).forEach((x) => x.cancel()); box.remove(); });
  };

  /* -------- 动画 -------- */
  E.addAnim = (effect, replace = false) => {
    const els = selected();
    if (!els.length) { toast('请先选择要添加动画的对象'); return; }
    change(() => {
      for (const el of els) {
        const existing = slide().animations.filter((a) => a.elId === el.id);
        if (replace && existing.length) { existing[0].effect = effect; selAnimId = existing[0].id; continue; }
        const a = { id: uid(), elId: el.id, effect, trigger: 'click', duration: effect === 'appear' || effect === 'disappear' ? 0.01 : 0.5, delay: 0 };
        slide().animations.push(a);
        selAnimId = a.id;
      }
    }, { slides: false });
    renderAnimPane();
    previewAnims(selAnimId);
  };
  function curAnim() {
    const list = slide().animations;
    return list.find((a) => a.id === selAnimId) || list.find((a) => sel.has(a.elId)) || null;
  }
  E.curAnim = curAnim;
  E.setAnimProp = (prop, v) => {
    const a = curAnim();
    if (!a) return;
    change(() => { a[prop] = v; }, { tag: 'anim-' + prop });
    renderAnimPane();
  };
  E.removeAnim = (id) => {
    const target = id ? slide().animations.find((a) => a.id === id) : null;
    change(() => {
      if (target) slide().animations = slide().animations.filter((a) => a !== target);
      else slide().animations = slide().animations.filter((a) => !sel.has(a.elId));
    });
    renderAnimPane();
  };
  E.moveAnim = (id, d) => {
    const list = slide().animations;
    const i = list.findIndex((a) => a.id === id), j = i + d;
    if (i < 0 || j < 0 || j >= list.length) return;
    change(() => { [list[i], list[j]] = [list[j], list[i]]; });
    renderAnimPane();
  };
  function previewAnims(onlyId) {
    if (editingId) exitEdit();
    const list = onlyId ? slide().animations.filter((a) => a.id === onlyId) : slide().animations;
    if (!list.length) return;
    const box = h('div', { class: 'sl-preview' });
    const l = h('div', { class: 'sl-preview-layer', html: slideHTML(slide(), deck, { mode: 'show', index: cur }) });
    box.append(l);
    stage.append(box);
    const firstCat = {};
    for (const a of list) if (!(a.elId in firstCat)) firstCat[a.elId] = animCat(a.effect);
    Object.entries(firstCat).forEach(([id, cat]) => { const n = l.querySelector(`.sl-el[data-id="${id}"]`); if (n && cat === 'entrance') n.style.visibility = 'hidden'; });
    // 预览时把所有步骤串起来
    const { auto, steps } = buildSteps(list);
    let t0 = 0, maxEnd = 0;
    const timers = [];
    for (const items of [auto, ...steps]) {
      let stepEnd = 0;
      for (const it of items) {
        const startAt = t0 + it.start;
        const dur = (it.anim.duration ?? 0.5) * 1000;
        stepEnd = Math.max(stepEnd, it.start + dur);
        timers.push(setTimeout(() => {
          const n = l.querySelector(`.sl-el[data-id="${it.anim.elId}"]`);
          if (!n) return;
          const el = find(it.anim.elId);
          const cat = animCat(it.anim.effect);
          const [kf, extra = {}] = animKeyframes(it.anim.effect, el ? el.rot || 0 : 0);
          if (cat === 'entrance') n.style.visibility = 'visible';
          n.animate(kf, { duration: dur, easing: 'ease', ...extra, fill: cat === 'exit' ? 'forwards' : 'none' });
        }, startAt));
      }
      t0 += stepEnd + 250;
      maxEnd = t0;
    }
    const done = () => { timers.forEach(clearTimeout); box.remove(); };
    box.addEventListener('mousedown', (e) => { e.stopPropagation(); done(); });
    setTimeout(done, maxEnd + 400);
  }
  E.previewAnims = () => previewAnims(null);
  E.toggleAnimPane = () => { animPaneOpen = !animPaneOpen; renderAnimPane(); requestAnimationFrame(fit); sync(); };
  E.isAnimPaneOpen = () => animPaneOpen;

  function renderAnimPane() {
    animPane.style.display = animPaneOpen && view === 'normal' ? '' : 'none';
    if (!animPaneOpen) return;
    const list = slide().animations;
    const ca = curAnim();
    const rows = list.map((a, i) => {
      const el = find(a.elId);
      const trig = a.trigger === 'click' ? icon('mouse-pointer-click', 13) : a.trigger === 'with' ? icon('equal', 13) : icon('clock', 13);
      return h('div', {
        class: 'sl-ap-row' + (ca && ca.id === a.id ? ' active' : ''),
        onclick: () => { selAnimId = a.id; if (el) sel = new Set([el.id]); renderOverlay(); sync(); renderAnimPane(); },
      },
        h('span', { class: 'sl-ap-i' }, String(i + 1)),
        h('span', { class: 'sl-ap-trig', title: TRIGGERS.find((t) => t.value === a.trigger)?.label }, trig),
        h('span', { class: 'sl-ap-cat', style: { background: CAT_COLORS[animCat(a.effect)] } }),
        h('span', { class: 'sl-ap-name' }, animName(a.effect), h('small', null, el ? elementLabel(el) : '(已删除)')),
        h('span', { class: 'sl-ap-acts' },
          h('button', { class: 'icon-btn', title: '上移', onclick: (e) => { e.stopPropagation(); E.moveAnim(a.id, -1); } }, icon('chevron-up', 13)),
          h('button', { class: 'icon-btn', title: '下移', onclick: (e) => { e.stopPropagation(); E.moveAnim(a.id, 1); } }, icon('chevron-down', 13)),
          h('button', { class: 'icon-btn', title: '删除', onclick: (e) => { e.stopPropagation(); E.removeAnim(a.id); } }, icon('x', 13))));
    });
    const detail = ca ? h('div', { class: 'sl-ap-detail' },
      h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, '效果'), h('select', { class: 'input', onchange: (e) => E.setAnimProp('effect', e.target.value) },
        Object.entries(ANIMS).map(([cat, l]) => h('optgroup', { label: CAT_NAMES[cat] }, l.map((x) => h('option', { value: x.id, selected: x.id === ca.effect }, x.name)))))),
      h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, '开始'), h('select', { class: 'input', onchange: (e) => E.setAnimProp('trigger', e.target.value) }, TRIGGERS.map((t) => h('option', { value: t.value, selected: t.value === ca.trigger }, t.label)))),
      h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, '持续时间(秒)'), h('input', { class: 'input', type: 'number', step: '0.1', min: '0', value: ca.duration, onchange: (e) => E.setAnimProp('duration', Math.max(0.01, +e.target.value)) })),
      h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, '延迟(秒)'), h('input', { class: 'input', type: 'number', step: '0.1', min: '0', value: ca.delay || 0, onchange: (e) => E.setAnimProp('delay', Math.max(0, +e.target.value)) })))
      : null;
    animPane.replaceChildren(
      h('div', { class: 'side-pane-head' }, '动画窗格', h('button', { class: 'icon-btn', onclick: () => E.toggleAnimPane() }, icon('x', 15))),
      h('div', { class: 'side-pane-body' },
        h('div', { class: 'sl-ap-tools' },
          h('button', { class: 'btn btn-sm', onclick: () => E.previewAnims() }, icon('play', 13), '全部播放'),
          h('button', { class: 'btn btn-sm', disabled: !ca, onclick: () => ca && previewAnims(ca.id) }, icon('play', 13), '播放所选')),
        list.length ? h('div', { class: 'sl-ap-list' }, rows) : h('div', { class: 'muted', style: 'padding:20px 0;text-align:center' }, '本页暂无动画。选择对象后，在"动画"选项卡中添加。'),
        detail));
  }

  /* -------- 放映 -------- */
  E.show = (fromCurrent, fullscreen = true) => {
    if (editingId) exitEdit();
    const start = fromCurrent ? cur : 0;
    startShow(deck, start, { fullscreen, onExit: (i) => { if (i != null && i !== cur && deck.slides[i]) goto(i); } });
  };

  /* -------- 查找替换 -------- */
  E.findReplace = async (replaceMode = false) => {
    if (editingId) exitEdit();
    const fi = h('input', { class: 'input', placeholder: '查找内容' });
    const ri = h('input', { class: 'input', placeholder: '替换为' });
    const info = h('div', { class: 'muted', style: 'min-height:18px' });
    const caseCb = h('input', { type: 'checkbox' });
    let lastPos = { s: cur, e: -1 };
    const textNodes = (html) => { const d = document.createElement('div'); d.innerHTML = html || ''; return d; };
    const matches = (txt, q) => (caseCb.checked ? txt.includes(q) : txt.toLowerCase().includes(q.toLowerCase()));
    const findNext = () => {
      const q = fi.value;
      if (!q) return;
      const n = deck.slides.length;
      for (let k = 0; k <= n; k++) {
        const si = (lastPos.s + k) % n;
        const els = deck.slides[si].elements;
        const startE = k === 0 ? lastPos.e + 1 : 0;
        for (let ei = startE; ei < els.length; ei++) {
          const el = els[ei];
          const txt = el.type === 'table' ? el.rows.flat().map((c) => textNodes(c.html).textContent).join(' ') : textNodes(el.html).textContent;
          if (matches(txt, q)) {
            lastPos = { s: si, e: ei };
            goto(si);
            sel = new Set([el.id]);
            renderOverlay(); sync();
            info.textContent = `在第 ${si + 1} 张幻灯片找到`;
            return true;
          }
        }
      }
      info.textContent = '未找到匹配内容';
      return false;
    };
    const replaceIn = (html, q, rep) => {
      const d = textNodes(html);
      const walker = document.createTreeWalker(d, NodeFilter.SHOW_TEXT);
      let count = 0, node;
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseCb.checked ? 'g' : 'gi');
      while ((node = walker.nextNode())) {
        const t = node.textContent;
        const nt = t.replace(re, () => { count++; return rep; });
        if (nt !== t) node.textContent = nt;
      }
      return { html: d.innerHTML, count };
    };
    const replaceAll = () => {
      const q = fi.value;
      if (!q) return;
      let total = 0;
      change(() => {
        for (const s of deck.slides) for (const el of s.elements) {
          if (el.type === 'table') el.rows.forEach((r) => r.forEach((c) => { const x = replaceIn(c.html, q, ri.value); c.html = x.html; total += x.count; }));
          else if (el.html) { const x = replaceIn(el.html, q, ri.value); el.html = x.html; total += x.count; }
        }
      }, { slides: true });
      info.textContent = `共替换 ${total} 处`;
    };
    const replaceOne = () => {
      const q = fi.value;
      if (!q) return;
      const el = selected()[0];
      if (el && el.html !== undefined) {
        const txt = textNodes(el.html).textContent;
        if (matches(txt, q)) {
          change(() => {
            const d = textNodes(el.html);
            const walker = document.createTreeWalker(d, NodeFilter.SHOW_TEXT);
            let node;
            const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseCb.checked ? '' : 'i');
            while ((node = walker.nextNode())) { if (re.test(node.textContent)) { node.textContent = node.textContent.replace(re, ri.value); break; } }
            el.html = d.innerHTML;
          });
        }
      }
      findNext();
    };
    await modal({
      title: replaceMode ? '替换' : '查找', width: 420,
      body: h('div', { class: 'form' },
        h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, '查找内容'), fi),
        replaceMode ? h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, '替换为'), ri) : null,
        h('label', { class: 'form-check' }, caseCb, '区分大小写'),
        info,
        h('div', { style: 'display:flex;gap:8px;justify-content:flex-end' },
          h('button', { class: 'btn', onclick: findNext }, '查找下一个'),
          replaceMode ? h('button', { class: 'btn', onclick: replaceOne }, '替换') : null,
          replaceMode ? h('button', { class: 'btn', onclick: replaceAll }, '全部替换') : null)),
      buttons: [{ label: '关闭', value: null }],
    });
  };

  /* -------- 导出 -------- */
  E.exportPptx = () => exportPptx(deck, ctx.getName()).then(() => toast('已导出 PPTX', 'success')).catch((e) => { console.error(e); toast('导出失败：' + e.message, 'error'); });
  E.print = (notes) => printDeck(deck, ctx.getName(), { notes });
  E.exportPng = () => exportPng(deck, cur, ctx.getName()).catch((e) => { console.error(e); toast('导出图片失败：' + e.message, 'error'); });
  E.undo = undo;
  E.redo = redo;

  /* ---------------- 键盘 ---------------- */
  function onKey(e) {
    if (!isActive() || document.querySelector('.modal-overlay') || document.querySelector('.sl-show') || root.querySelector('.backstage')) return;
    const t = e.target;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (k === 'F5') { e.preventDefault(); E.show(e.shiftKey); return; }
    if (editingId) {
      if (k === 'Escape') { e.preventDefault(); exitEdit(); return; }
      if (k === 'Tab') {
        const el = find(editingId);
        if (el && el.type === 'table') {
          e.preventDefault();
          const cells = [...layerNode(editingId).querySelectorAll('.sl-cell')];
          const i = cells.indexOf(document.activeElement.closest('.sl-cell'));
          let j = i + (e.shiftKey ? -1 : 1);
          if (j >= cells.length) { const r = el.rows.length - 1; exitEdit(); lastTableCell = null; change(() => { el.rows.push(el.colW.map(() => ({ html: '' }))); el.h += Math.round(el.h / (el.rows.length - 1)); }); enterEdit(el.id); const cs = [...layerNode(el.id).querySelectorAll('.sl-cell')]; const target = cs[(r + 1) * el.colW.length]; if (target) { target.focus(); placeCaret(target, null, false); } return; }
          j = Math.max(0, j);
          cells[j].focus();
          placeCaret(cells[j], null, true);
          return;
        }
        e.preventDefault();
        document.execCommand(e.shiftKey ? 'outdent' : 'indent');
        return;
      }
      if (mod && (k === 'b' || k === 'i' || k === 'u')) { e.preventDefault(); fmt({ b: 'bold', i: 'italic', u: 'underline' }[k]); return; }
      if (mod && (k === ']' || k === '[')) { e.preventDefault(); E.growFont(k === ']' ? 1 : -1); return; }
      if (mod && ['l', 'e', 'r', 'j'].includes(k)) { e.preventDefault(); E.setAlign({ l: 'left', e: 'center', r: 'right', j: 'justify' }[k]); return; }
      if (mod && k === 'k') { e.preventDefault(); E.link(); return; }
      return;
    }
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (painter && k === 'Escape') { painter = null; root.classList.remove('sl-painting'); return; }
    let handled = true;
    if (mod && k.toLowerCase() === 'z') e.shiftKey ? redo() : undo();
    else if (mod && k.toLowerCase() === 'y') redo();
    else if (mod && k.toLowerCase() === 'c') E.copy();
    else if (mod && k.toLowerCase() === 'x') E.cut();
    else if (mod && k.toLowerCase() === 'v') { handled = false; } // 交给 paste 事件
    else if (mod && k.toLowerCase() === 'd') E.duplicate();
    else if (mod && k.toLowerCase() === 'a') E.selectAll();
    else if (mod && k.toLowerCase() === 'g') e.shiftKey ? E.ungroup() : E.group();
    else if (mod && k.toLowerCase() === 'm') E.addSlide();
    else if (mod && k.toLowerCase() === 'f') E.findReplace(false);
    else if (mod && k.toLowerCase() === 'h') E.findReplace(true);
    else if (mod && k.toLowerCase() === 'b') fmt('bold');
    else if (mod && k.toLowerCase() === 'i') fmt('italic');
    else if (mod && k.toLowerCase() === 'u') fmt('underline');
    else if (mod && (k === ']' || k === '[')) E.growFont(k === ']' ? 1 : -1);
    else if (mod && ['l', 'e', 'r', 'j'].includes(k.toLowerCase()) && sel.size) E.setAlign({ l: 'left', e: 'center', r: 'right', j: 'justify' }[k.toLowerCase()]);
    else if (k === 'Delete' || k === 'Backspace') {
      if (focusArea === 'thumbs' || (view === 'sorter')) E.deleteSlides();
      else if (sel.size) E.deleteSel();
      else handled = false;
    } else if (k.startsWith('Arrow')) {
      if (focusArea === 'thumbs' || view === 'sorter' || !sel.size) {
        if (k === 'ArrowDown' || k === 'ArrowRight') goto(cur + 1);
        else goto(cur - 1);
      } else {
        const step = mod ? 1 : e.shiftKey ? 20 : 5;
        const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
        const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
        change(() => selected().filter((x) => !x.locked).forEach((x) => { x.x += dx; x.y += dy; }), { tag: 'nudge' });
      }
    } else if (k === 'PageDown') goto(cur + 1);
    else if (k === 'PageUp') goto(cur - 1);
    else if (k === 'Home' && (focusArea === 'thumbs' || !sel.size)) goto(0);
    else if (k === 'End' && (focusArea === 'thumbs' || !sel.size)) goto(deck.slides.length - 1);
    else if (k === 'Escape') { sel.clear(); renderOverlay(); sync(); }
    else if ((k === 'Enter' || k === 'F2') && sel.size === 1 && textCapable(selected()[0])) enterEdit(selected()[0].id, null, k === 'F2');
    else if (k === 'Enter' && focusArea === 'thumbs') E.addSlide();
    else if (k === 'Tab' && slide().elements.length) {
      const els = slide().elements;
      const i = els.findIndex((x) => sel.has(x.id));
      const j = ((i + (e.shiftKey ? -1 : 1)) % els.length + els.length) % els.length;
      sel = new Set([els[j].id]);
      renderOverlay(); sync();
    } else if (!mod && !e.altKey && k.length === 1 && sel.size === 1 && textCapable(selected()[0]) && selected()[0].type !== 'table' && focusArea === 'canvas') {
      // 直接输入：进入编辑并替换内容
      enterEdit(selected()[0].id, null, true);
      handled = false;
    } else handled = false;
    if (handled) e.preventDefault();
  }
  document.addEventListener('keydown', onKey);

  /* ---------------- 功能区状态同步 ---------------- */
  function syncTextState() {
    const st = {};
    try {
      st.bold = document.queryCommandState('bold');
      st.italic = document.queryCommandState('italic');
      st.underline = document.queryCommandState('underline');
      st.strike = document.queryCommandState('strikeThrough');
      st.sup = document.queryCommandState('superscript');
      st.sub = document.queryCommandState('subscript');
      const s = getSelection();
      let n = s.anchorNode;
      if (n && n.nodeType === 3) n = n.parentElement;
      if (n) {
        const cs = getComputedStyle(n);
        st.fontSize = Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2;
        st.fontFamily = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
        st.align = cs.textAlign === 'start' ? 'left' : cs.textAlign;
      }
    } catch {}
    ribbon.syncText(st);
  }
  function syncSize() { ribbon.syncSize(selected()[0] || null); }
  function sync() {
    const els = selected();
    const one = els[0];
    ribbon.sync({
      selCount: els.length,
      el: editingId ? find(editingId) : one || null,
      editing: !!editingId,
      types: new Set(els.map((e) => (e.type === 'shape' && isLine(e.shape) ? 'line' : e.type))),
      slide: slide(),
      deck,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      view, showGrid, showGuides, showNotes, animPaneOpen,
      anim: curAnim(),
    });
    if (editingId) syncTextState();
    else if (one && textCapable(one)) {
      const s = one.style || {};
      const st = { bold: !!s.bold, italic: !!s.italic, underline: !!s.underline, strike: !!s.strike, fontSize: s.fontSize || 18, fontFamily: s.fontFamily || (one.role === 'title' ? getTheme(deck.theme).titleFont : getTheme(deck.theme).bodyFont), align: s.align || 'left' };
      // 以首个文字的实际样式为准（可能被行内格式覆盖）
      const node = layerNode(one.id);
      const box = node && node.querySelector(one.type === 'table' ? '.sl-cell' : '.sl-txt');
      if (box && !isTextEmpty(one.type === 'table' ? box.innerHTML : one.html)) {
        const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
        let tn;
        while ((tn = w.nextNode()) && !tn.textContent.trim());
        if (tn) {
          const cs = getComputedStyle(tn.parentElement);
          st.bold = +cs.fontWeight >= 600 || cs.fontWeight === 'bold';
          st.italic = cs.fontStyle === 'italic';
          const deco = [];
          for (let n = tn.parentElement; n && n !== box.parentElement; n = n.parentElement) deco.push(getComputedStyle(n).textDecorationLine);
          st.underline = deco.some((d) => d.includes('underline'));
          st.strike = deco.some((d) => d.includes('line-through'));
          st.fontSize = Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2;
        }
      }
      ribbon.syncText(st);
    } else ribbon.syncText({});
    syncSize();
    if (animPaneOpen) renderAnimPane();
  }
  E.sync = sync;
  E.state = () => ({ deck, cur, sel, editingId });

  /* ---------------- AI 助手 ---------------- */
  const ai = setupSlidesAI({
    deck, E, ctx, layer,
    change: (fn, opts) => change(() => {
      const r = fn();
      // 增删页后当前页可能越界，先收拢再重绘
      cur = Math.max(0, Math.min(deck.slides.length - 1, cur));
      slideSel = new Set([cur]);
      return r;
    }, opts),
    goto: (i) => goto(i),
    state: () => ({ cur, sel, editingId }),
    onToggle: (on) => { ribbon.setAIActive(on); requestAnimationFrame(fit); setTimeout(fit, 320); },
  });
  body.append(ai.el);
  E.toggleAI = () => ai.toggle();
  root._slides = { ai, E }; // 便于调试

  /* ---------------- 初始化 ---------------- */
  renderAll();
  renderAnimPane();
  notesBtn.classList.add('active');
  viewBtns.normal.classList.add('active');

  function getContent() {
    if (editingId) readEditing();
    const used = new Set();
    const scan = (o) => { if (o && o.mediaId) used.add(o.mediaId); };
    deck.slides.forEach((s) => { scan(s.bg); s.elements.forEach(scan); });
    // 撤销栈里引用的媒体也保留在内存中，但只保存当前用到的
    const media = {};
    for (const id of used) if (deck.media[id]) media[id] = deck.media[id];
    return { version: 1, size: deck.size, theme: deck.theme, footer: deck.footer, slides: deck.slides, media };
  }

  return {
    getContent,
    onShow() { fit(); requestAnimationFrame(() => { fit(); renderThumbs(); }); setTimeout(fit, 60); },
    onHide() { if (editingId) exitEdit(); },
    ai,
    destroy() {
      ai.destroy();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('selectionchange', onSelChange);
    },
    print: () => E.print(false),
    exports: [
      { label: 'PowerPoint 演示文稿 (.pptx)', icon: 'presentation', desc: '可在 PowerPoint / WPS 中打开编辑', run: () => E.exportPptx() },
      { label: 'PDF 文档', icon: 'file-text', desc: '通过打印对话框选择"另存为 PDF"，每页一张幻灯片', run: () => E.print(false) },
      { label: 'PDF 讲义（含备注）', icon: 'notebook-text', desc: '每页一张幻灯片及其演讲者备注', run: () => E.print(true) },
      { label: 'PNG 图片（当前幻灯片）', icon: 'image', desc: '导出当前幻灯片为高清图片', run: () => E.exportPng() },
    ],
  };
}
