// 幻灯片放映：全屏、切换效果、单击动画、键盘/鼠标导航、黑屏/白屏、画笔与激光笔。
import { h, icon, showMenu } from '../../core/ui.js';
import { slideHTML, ensureRenderCSS } from './render.js';
import { dims } from './model.js';
import { animKeyframes, animCat, buildSteps, playTransition } from './anim.js';

export function startShow(deck, startIndex = 0, { fullscreen = true, onExit } = {}) {
  ensureRenderCSS();
  const { w: W, h: H } = dims(deck);
  const visible = deck.slides.map((s, i) => i).filter((i) => !deck.slides[i].hidden || i === startIndex);
  if (!visible.length) return null;
  let pos = Math.max(0, visible.indexOf(startIndex));
  let steps = { auto: [], steps: [] };
  let stepIdx = 0;
  let layer = null;
  let ended = false;
  let running = []; // Animation 对象
  let pending = []; // { timer, run }
  let mode = 'none'; // none | pen | laser
  let numBuf = '';
  let scale = 1;
  let transitioning = false;

  const stage = h('div', { class: 'sl-show-stage' });
  const blank = h('div', { class: 'sl-show-blank' });
  const penCanvas = h('canvas', { class: 'sl-show-pen' });
  const laser = h('div', { class: 'sl-show-laser' });
  const counter = h('span', { class: 'sl-show-count' });
  const bar = h('div', { class: 'sl-show-bar' },
    h('button', { title: '上一张', onclick: (e) => { e.stopPropagation(); prev(); } }, icon('chevron-left', 18)),
    counter,
    h('button', { title: '下一张', onclick: (e) => { e.stopPropagation(); next(); } }, icon('chevron-right', 18)),
    h('button', { title: '画笔', onclick: (e) => { e.stopPropagation(); setMode(mode === 'pen' ? 'none' : 'pen'); } }, icon('pen-line', 16)),
    h('button', { title: '激光笔', onclick: (e) => { e.stopPropagation(); setMode(mode === 'laser' ? 'none' : 'laser'); } }, icon('crosshair', 16)),
    h('button', { title: '更多', onclick: (e) => { e.stopPropagation(); menu(e.currentTarget); } }, icon('ellipsis', 16)),
    h('button', { title: '结束放映 (Esc)', onclick: (e) => { e.stopPropagation(); exit(); } }, icon('x', 16)));
  const overlay = h('div', { class: 'sl-show', tabindex: '-1' }, stage, penCanvas, blank, laser, bar);
  document.body.append(overlay);
  overlay.focus();
  // 全屏时只有 overlay 内的元素可见：把弹出菜单搬进 overlay
  const mo = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.classList && n.classList.contains('popover')) overlay.append(n);
  });
  mo.observe(document.body, { childList: true });

  if (fullscreen && overlay.requestFullscreen) overlay.requestFullscreen().catch(() => {});

  function fit() {
    const vw = overlay.clientWidth || innerWidth, vh = overlay.clientHeight || innerHeight;
    scale = Math.min(vw / W, vh / H);
    stage.style.width = W * scale + 'px';
    stage.style.height = H * scale + 'px';
    stage.querySelectorAll('.sl-show-layer > .sl-slide').forEach((s) => (s.style.transform = `scale(${scale})`));
    penCanvas.width = vw;
    penCanvas.height = vh;
  }

  function makeLayer(index) {
    const l = h('div', { class: 'sl-show-layer' });
    l.innerHTML = slideHTML(deck.slides[index], deck, { mode: 'show', index });
    const s = l.firstElementChild;
    s.style.transformOrigin = '0 0';
    s.style.transform = `scale(${scale})`;
    return l;
  }

  const elRot = (id) => (deck.slides[visible[pos]].elements.find((e) => e.id === id) || {}).rot || 0;

  function prepare(l, slide, built) {
    const first = {}, last = {};
    for (const a of slide.animations || []) {
      if (!(a.elId in first)) first[a.elId] = animCat(a.effect);
      last[a.elId] = animCat(a.effect);
    }
    for (const id of Object.keys(first)) {
      const el = l.querySelector(`.sl-el[data-id="${id}"]`);
      if (!el) continue;
      const hidden = built ? last[id] === 'exit' : first[id] === 'entrance';
      el.style.visibility = hidden ? 'hidden' : '';
    }
  }

  function clearPen() {
    penCanvas.getContext('2d').clearRect(0, 0, penCanvas.width, penCanvas.height);
  }

  async function go(newPos, { built = false, transition = true } = {}) {
    finishAll();
    ended = false;
    pos = newPos;
    const index = visible[pos];
    const slide = deck.slides[index];
    steps = buildSteps(slide.animations);
    stepIdx = built ? steps.steps.length : 0;
    const nl = makeLayer(index);
    prepare(nl, slide, built);
    const old = layer;
    layer = nl;
    stage.append(nl);
    clearPen();
    updateCounter();
    const tr = slide.transition || {};
    if (transition && tr.type && tr.type !== 'none') {
      transitioning = true;
      const anims = await playTransition(tr.type, old, nl, tr.duration || 0.7);
      transitioning = false;
      (anims || []).forEach((a) => a.cancel());
      if (layer !== nl) return; // 切换期间又跳转了
    }
    if (old) old.remove();
    stage.querySelectorAll('.sl-show-layer').forEach((x) => { if (x !== layer) x.remove(); });
    if (!built && steps.auto.length) runItems(steps.auto);
  }

  function runItems(items) {
    for (const it of items) {
      const run = () => {
        pending = pending.filter((p) => p.run !== run);
        const el = layer && layer.querySelector(`.sl-el[data-id="${it.anim.elId}"]`);
        if (!el) return;
        const cat = animCat(it.anim.effect);
        const [kf, extra = {}] = animKeyframes(it.anim.effect, elRot(it.anim.elId));
        if (cat === 'entrance') el.style.visibility = 'visible';
        const a = el.animate(kf, { duration: (it.anim.duration ?? 0.5) * 1000, easing: 'ease', ...extra, fill: cat === 'exit' ? 'forwards' : 'none' });
        running.push(a);
        a.finished.then(() => {
          running = running.filter((x) => x !== a);
          if (cat === 'exit') { el.style.visibility = 'hidden'; a.cancel(); }
        }).catch(() => {});
      };
      if (it.start > 0) pending.push({ timer: setTimeout(run, it.start), run });
      else run();
    }
  }

  function finishAll() {
    const p = pending;
    pending = [];
    p.forEach((x) => { clearTimeout(x.timer); x.run(); });
    running.slice().forEach((a) => { try { a.finish(); } catch {} });
  }

  function busy() { return running.length > 0 || pending.length > 0; }

  function next() {
    if (blank.classList.contains('on')) { blank.className = 'sl-show-blank'; return; }
    if (transitioning) return;
    if (busy()) { finishAll(); return; }
    if (ended) { exit(); return; }
    if (stepIdx < steps.steps.length) { runItems(steps.steps[stepIdx++]); return; }
    if (pos < visible.length - 1) go(pos + 1);
    else showEnd();
  }
  function prev() {
    if (blank.classList.contains('on')) { blank.className = 'sl-show-blank'; return; }
    if (ended) { go(pos, { built: true, transition: false }); return; }
    finishAll();
    if (pos > 0) go(pos - 1, { built: true, transition: false });
  }
  function showEnd() {
    finishAll();
    ended = true;
    const l = h('div', { class: 'sl-show-layer sl-show-end' }, '放映结束，单击鼠标退出。');
    stage.querySelectorAll('.sl-show-layer').forEach((x) => x.remove());
    layer = l;
    stage.append(l);
    counter.textContent = '';
  }
  function updateCounter() { counter.textContent = `${pos + 1} / ${visible.length}`; }

  function setMode(m) {
    mode = m;
    overlay.classList.toggle('pen', m === 'pen');
    overlay.classList.toggle('laser', m === 'laser');
  }

  function menu(anchor) {
    const items = [
      { label: '下一张', icon: 'chevron-right', onClick: next },
      { label: '上一张', icon: 'chevron-left', onClick: prev },
      { label: '定位至幻灯片', icon: 'list', items: visible.map((idx, p) => ({ label: `${p + 1}. ${titleOf(idx)}`, checked: p === pos, onClick: () => go(p) })) },
      '-',
      { label: '黑屏', shortcut: 'B', onClick: () => (blank.className = 'sl-show-blank on black') },
      { label: '白屏', shortcut: 'W', onClick: () => (blank.className = 'sl-show-blank on white') },
      '-',
      { label: '画笔', icon: 'pen-line', checked: mode === 'pen', onClick: () => setMode(mode === 'pen' ? 'none' : 'pen') },
      { label: '激光笔', icon: 'crosshair', checked: mode === 'laser', onClick: () => setMode(mode === 'laser' ? 'none' : 'laser') },
      { label: '清除墨迹', icon: 'eraser', shortcut: 'E', onClick: clearPen },
      '-',
      { label: '结束放映', icon: 'x', shortcut: 'Esc', onClick: exit },
    ];
    showMenu(anchor, items);
  }
  function titleOf(idx) {
    const t = deck.slides[idx].elements.find((e) => e.role === 'title') || deck.slides[idx].elements.find((e) => e.html);
    const s = t ? (t.html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim() : '';
    return s.slice(0, 24) || '幻灯片 ' + (idx + 1);
  }

  // 输入
  const onKey = (e) => {
    if (document.querySelector('.modal-overlay')) return;
    const k = e.key;
    let handled = true;
    if (/^[0-9]$/.test(k)) numBuf += k;
    else if (k === 'Enter' && numBuf) { const n = parseInt(numBuf, 10) - 1; numBuf = ''; if (n >= 0 && n < visible.length) go(n); }
    else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(k)) next();
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k)) prev();
    else if (k === 'Home') go(0, { transition: false });
    else if (k === 'End') go(visible.length - 1, { transition: false });
    else if (k === 'Escape') exit();
    else if (k === 'b' || k === 'B' || k === '.') blank.className = blank.classList.contains('black') ? 'sl-show-blank' : 'sl-show-blank on black';
    else if (k === 'w' || k === 'W' || k === ',') blank.className = blank.classList.contains('white') ? 'sl-show-blank' : 'sl-show-blank on white';
    else if (k === 'e' || k === 'E') clearPen();
    else if (k === 'F5') {}
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
    else if (!e.ctrlKey && !e.altKey && !e.metaKey && k.length === 1) { e.stopPropagation(); }
  };
  document.addEventListener('keydown', onKey, true);

  let drawing = false;
  overlay.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.sl-show-bar') || e.target.closest('.popover')) return;
    if (mode === 'pen') {
      drawing = true;
      const c = penCanvas.getContext('2d');
      c.strokeStyle = '#ff2d2d';
      c.lineWidth = 3;
      c.lineCap = c.lineJoin = 'round';
      c.beginPath();
      c.moveTo(e.clientX, e.clientY);
    }
  });
  let hideTimer;
  overlay.addEventListener('mousemove', (e) => {
    overlay.classList.add('show-ui');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => overlay.classList.remove('show-ui'), 2000);
    if (mode === 'laser') { laser.style.left = e.clientX + 'px'; laser.style.top = e.clientY + 'px'; }
    if (drawing) { const c = penCanvas.getContext('2d'); c.lineTo(e.clientX, e.clientY); c.stroke(); }
  });
  overlay.addEventListener('mouseup', () => { drawing = false; });
  overlay.addEventListener('click', (e) => {
    if (e.target.closest('.sl-show-bar') || e.target.closest('.popover') || mode === 'pen') return;
    const elNode = e.target.closest('.sl-el');
    if (elNode && !ended) {
      const el = deck.slides[visible[pos]].elements.find((x) => x.id === elNode.dataset.id);
      if (el && el.link) { openLink(el.link); return; }
    }
    const a = e.target.closest('a[href]');
    if (a) { e.preventDefault(); openLink(a.getAttribute('href')); return; }
    next();
  });
  function openLink(link) {
    const m = /^#slide-(\d+)$/.exec(link);
    if (m) { const p = visible.indexOf(+m[1] - 1); if (p >= 0) go(p); return; }
    window.open(link, '_blank', 'noopener');
  }
  overlay.addEventListener('contextmenu', (e) => { e.preventDefault(); if (e.target.closest('.popover')) return; menu({ x: e.clientX, y: e.clientY }); });
  overlay.addEventListener('wheel', (e) => { if (e.deltaY > 0) next(); else if (e.deltaY < 0) prev(); }, { passive: true });

  const onResize = () => fit();
  window.addEventListener('resize', onResize);
  const onFs = () => { if (fullscreen && !document.fullscreenElement && !closed) exit(); };
  document.addEventListener('fullscreenchange', onFs);

  let closed = false;
  function exit() {
    if (closed) return;
    closed = true;
    mo.disconnect();
    finishAll();
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('fullscreenchange', onFs);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    overlay.remove();
    onExit && onExit(visible[pos]);
  }

  fit();
  // 首次全屏后尺寸会变化
  setTimeout(fit, 150);
  go(pos);
  return { exit, next, prev };
}
