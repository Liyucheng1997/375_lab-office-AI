// 演示功能区：开始/插入/设计/切换/动画/放映/视图 + 上下文工具选项卡。
import { h, icon, createRibbon, gridPicker, symbolPicker, popover, colorPicker, FONT_FAMILIES, FONT_SIZES } from '../../core/ui.js';
import { LAYOUTS, newSlide, fill as fillPh, dims } from './model.js';
import { THEMES, getTheme } from './themes.js';
import { SHAPES, shapeIconSVG } from './shapes.js';
import { slideThumb, WORDART } from './render.js';
import { ANIMS, TRANSITIONS, TRIGGERS, CAT_COLORS } from './anim.js';
import { CHART_TYPES } from './chart.js';

const TR_ICONS = { none: 'ban', fade: 'blend', push: 'arrow-left-to-line', wipe: 'arrow-right-from-line', split: 'columns-2', cover: 'layers', uncover: 'layers-2', zoom: 'zoom-in', flip: 'flip-horizontal-2', cube: 'box', circle: 'circle-dot', blinds: 'align-justify', random: 'shuffle' };

function gallery(items, onPick, { cls = '' } = {}) {
  const tiles = {};
  const el = h('div', { class: 'sl-gallery ' + cls }, items.map((it) => {
    const t = h('button', { class: 'sl-gtile', title: it.title || it.label, onmousedown: (e) => e.preventDefault(), onclick: () => onPick(it.id) }, it.visual, h('span', { class: 'sl-gtile-label' }, it.label));
    tiles[it.id] = t;
    return t;
  }));
  return { el, setActive(id) { Object.entries(tiles).forEach(([k, t]) => t.classList.toggle('active', k === id)); } };
}

function layoutPreview(id) {
  const deck = { size: '16:9', theme: 'office', slides: [], media: {}, footer: {} };
  const s = newSlide(id, deck);
  s.elements.forEach((e) => { if (e.type !== 'image') e.html = `<div>${e.role === 'title' ? '标题' : e.role === 'subtitle' ? '副标题' : '— — —'}</div>`; });
  const box = slideThumb(s, deck, 96);
  box.classList.add('sl-layout-thumb');
  return box;
}

function layoutMenu(onPick) {
  return (anchor) => {
    let p;
    const grid = h('div', { class: 'sl-layout-grid' }, LAYOUTS.map((l) => h('button', { class: 'sl-layout-item', onclick: () => { p.close(); onPick(l.id); } }, layoutPreview(l.id), h('span', null, l.name))));
    p = popover(anchor, h('div', { class: 'sl-pop' }, h('div', { class: 'cp-title' }, '版式'), grid));
  };
}

function shapesMenu(onPick) {
  return (anchor) => {
    let p;
    const groups = {};
    SHAPES.forEach((s) => (groups[s.group] = groups[s.group] || []).push(s));
    const body = h('div', { class: 'sl-pop sl-shapes-pop' }, Object.entries(groups).map(([g, list]) => [
      h('div', { class: 'cp-title' }, g),
      h('div', { class: 'sl-shape-grid' }, list.map((s) => h('button', { class: 'sl-shape-btn', title: s.name, html: shapeIconSVG(s.key, 22), onmousedown: (e) => e.preventDefault(), onclick: () => { p.close(); onPick(s.key); } }))),
    ]));
    p = popover(anchor, body);
  };
}

function wordArtMenu(onPick) {
  return (anchor) => {
    let p;
    const grid = h('div', { class: 'sl-wa-grid' }, WORDART.map((w) => h('button', { class: 'sl-wa-item', title: w.name, onmousedown: (e) => e.preventDefault(), onclick: () => { p.close(); onPick(w.id); } },
      h('span', { style: `font-size:22px;font-weight:bold;color:#2b579a;${w.css}` }, 'A'), h('small', null, w.name))));
    p = popover(anchor, h('div', { class: 'sl-pop' }, h('div', { class: 'cp-title' }, '艺术字样式'), grid));
  };
}

function quickStyles(theme) {
  const out = [];
  theme.colors.accent.slice(0, 6).forEach((c) => {
    out.push({ fill: { type: 'solid', color: c }, stroke: { width: 0 }, color: '#ffffff' });
  });
  theme.colors.accent.slice(0, 6).forEach((c) => {
    out.push({ fill: { type: 'solid', color: '#ffffff' }, stroke: { color: c, width: 2, dash: 'solid' }, color: c });
  });
  theme.colors.accent.slice(0, 6).forEach((c) => {
    out.push({ fill: { type: 'gradient', color: c, color2: '#ffffff', angle: 180 }, stroke: { width: 0 }, color: '#1f2329', shadow: true });
  });
  return out;
}

export function buildRibbon(E, ctx) {
  const sizeInputs = [];
  function sizeGroup() {
    const mk = (label, prop, tip) => {
      const inp = h('input', { class: 'rb-select sl-num-in', type: 'number', title: tip, onchange: () => E.setGeom(prop, +inp.value), onkeydown: (e) => { if (e.key === 'Enter') inp.blur(); }, onmousedown: (e) => e.stopPropagation() });
      sizeInputs.push({ inp, prop });
      return h('label', { class: 'sl-num-row' }, h('span', null, label), inp);
    };
    return { label: '大小与位置', items: [{ type: 'custom', el: h('div', { class: 'sl-size-grid' }, mk('高', 'h', '高度 (像素)'), mk('宽', 'w', '宽度 (像素)'), mk('X', 'x', '水平位置'), mk('Y', 'y', '垂直位置'), mk('旋转', 'rot', '旋转角度')) }] };
  }
  const arrangeGroup = () => ({
    label: '排列', items: [
      { type: 'col', items: [
        { icon: 'bring-to-front', label: '上移一层', showLabel: true, onClick: () => E.order('forward') },
        { icon: 'send-to-back', label: '下移一层', showLabel: true, onClick: () => E.order('backward') },
        { type: 'dropdown', icon: 'align-center-horizontal', label: '对齐', showLabel: true, menu: () => E.alignMenu() },
      ] },
      { type: 'col', items: [
        { icon: 'group', label: '组合', showLabel: true, onClick: () => E.group() },
        { icon: 'ungroup', label: '取消组合', showLabel: true, onClick: () => E.ungroup() },
        { type: 'dropdown', icon: 'rotate-cw', label: '旋转', showLabel: true, menu: () => [
          { label: '向右旋转 90°', icon: 'rotate-cw', onClick: () => E.rotate(90) },
          { label: '向左旋转 90°', icon: 'rotate-ccw', onClick: () => E.rotate(-90) },
          { label: '水平翻转', icon: 'flip-horizontal', onClick: () => E.flip('h') },
          { label: '垂直翻转', icon: 'flip-vertical', onClick: () => E.flip('v') },
        ] },
      ] },
    ],
  });
  const orderMenu = () => [
    { label: '置于顶层', icon: 'bring-to-front', onClick: () => E.order('front') },
    { label: '置于底层', icon: 'send-to-back', onClick: () => E.order('back') },
    { label: '上移一层', icon: 'arrow-up', onClick: () => E.order('forward') },
    { label: '下移一层', icon: 'arrow-down', onClick: () => E.order('backward') },
    '-',
    { label: '组合', icon: 'group', onClick: () => E.group() },
    { label: '取消组合', icon: 'ungroup', onClick: () => E.ungroup() },
    '-',
    { label: '对齐', icon: 'align-center-horizontal', items: E.alignMenu() },
    { label: '锁定 / 解锁', icon: 'lock', onClick: () => E.toggleLock() },
  ];

  const themeGal = gallery(THEMES.map((t) => {
    const deck = { size: '16:9', theme: t.id, slides: [], media: {}, footer: {} };
    const s = newSlide('title', deck);
    fillPh(s, 'title', ['Aa']);
    fillPh(s, 'subtitle', [t.name]);
    s.elements[0].style.fontSize = 80;
    s.elements[1].style.fontSize = 36;
    return { id: t.id, label: t.name, visual: slideThumb(s, deck, 88) };
  }), (id) => E.setTheme(id), { cls: 'sl-theme-gal' });

  const trGal = gallery(TRANSITIONS.map((t) => ({ id: t.id, label: t.name, visual: icon(TR_ICONS[t.id] || 'square', 22) })), (id) => E.setTransition(id), { cls: 'sl-tr-gal' });
  const enGal = gallery(ANIMS.entrance.slice(0, 10).map((a) => ({ id: a.id, label: a.name, visual: h('span', { style: { color: CAT_COLORS.entrance, display: 'flex' } }, icon('star', 20)) })), (id) => E.addAnim(id, true), { cls: 'sl-an-gal' });

  const durInput = h('input', { class: 'rb-select sl-num-in', type: 'number', step: '0.1', min: '0.1', title: '持续时间(秒)', onchange: () => E.setTransitionDuration(+durInput.value), onmousedown: (e) => e.stopPropagation() });
  const animTrig = h('select', { class: 'rb-select', style: 'width:118px', title: '开始', onchange: () => E.setAnimProp('trigger', animTrig.value) }, TRIGGERS.map((t) => h('option', { value: t.value }, t.label)));
  const animDur = h('input', { class: 'rb-select sl-num-in', type: 'number', step: '0.1', min: '0', title: '持续时间(秒)', onchange: () => E.setAnimProp('duration', Math.max(0.01, +animDur.value)), onmousedown: (e) => e.stopPropagation() });
  const animDelay = h('input', { class: 'rb-select sl-num-in', type: 'number', step: '0.1', min: '0', title: '延迟(秒)', onchange: () => E.setAnimProp('delay', Math.max(0, +animDelay.value)), onmousedown: (e) => e.stopPropagation() });
  const labeled = (label, el) => h('label', { class: 'sl-num-row' }, h('span', null, label), el);

  const animMenuOf = (cat, replace) => () => ANIMS[cat].map((a) => ({ label: a.name, onClick: () => E.addAnim(a.id, replace) }));

  const rb = createRibbon({
    onFile: ctx.openBackstage,
    onAI: () => E.toggleAI && E.toggleAI(),
    tabs: [
      {
        id: 'home', label: '开始', groups: [
          { label: '剪贴板', items: [
            { type: 'split', size: 'large', icon: 'clipboard-paste', label: '粘贴', onClick: () => E.paste(), menu: () => [{ label: '粘贴', icon: 'clipboard-paste', onClick: () => E.paste() }, { label: '只粘贴文本', icon: 'type', onClick: () => E.pasteText() }] },
            { type: 'col', items: [
              { icon: 'scissors', label: '剪切', showLabel: true, onClick: () => E.cut() },
              { icon: 'copy', label: '复制', showLabel: true, onClick: () => E.copy() },
              { icon: 'paintbrush', label: '格式刷', showLabel: true, onClick: () => E.painter() },
            ] },
          ] },
          { label: '幻灯片', items: [
            { type: 'split', size: 'large', icon: 'square-plus', label: '新建幻灯片', onClick: () => E.addSlide(), menu: layoutMenu((l) => E.addSlide(l)) },
            { type: 'col', items: [
              { type: 'dropdown', icon: 'layout-template', label: '版式', showLabel: true, menu: layoutMenu((l) => E.setLayout(l)) },
              { icon: 'rotate-ccw', label: '重置', showLabel: true, title: '重置占位符位置', onClick: () => E.resetSlide() },
              { icon: 'copy-plus', label: '复制', showLabel: true, title: '复制幻灯片', onClick: () => E.duplicateSlides() },
            ] },
          ] },
          { label: '字体', items: [
            { type: 'col', items: [
              { type: 'row', items: [
                { type: 'select', id: 'font', options: FONT_FAMILIES, width: 118, title: '字体', onChange: (v) => E.fmt('fontName', v) },
                { type: 'select', id: 'size', editable: true, options: FONT_SIZES.map((s) => ({ value: s.value, label: s.label })), width: 52, title: '字号', onChange: (v) => { const n = parseFloat(v); if (n > 0 && n < 1000) E.fmt('fontSize', n); } },
                { icon: 'a-arrow-up', title: '增大字号 (Ctrl+])', onClick: () => E.growFont(1) },
                { icon: 'a-arrow-down', title: '减小字号 (Ctrl+[)', onClick: () => E.growFont(-1) },
                { icon: 'remove-formatting', title: '清除格式', onClick: () => E.fmt('removeFormat') },
              ] },
              { type: 'row', items: [
                { id: 'bold', icon: 'bold', title: '加粗 (Ctrl+B)', onClick: () => E.fmt('bold') },
                { id: 'italic', icon: 'italic', title: '倾斜 (Ctrl+I)', onClick: () => E.fmt('italic') },
                { id: 'underline', icon: 'underline', title: '下划线 (Ctrl+U)', onClick: () => E.fmt('underline') },
                { id: 'strike', icon: 'strikethrough', title: '删除线', onClick: () => E.fmt('strikeThrough') },
                { id: 'sup', icon: 'superscript', title: '上标', onClick: () => E.fmt('superscript') },
                { id: 'sub', icon: 'subscript', title: '下标', onClick: () => E.fmt('subscript') },
                { type: 'color', id: 'fcolor', icon: 'baseline', title: '字体颜色', color: '#c00000', onClick: (c) => c && E.fmt('foreColor', c === 'auto' ? '#000000' : c), autoLabel: '自动' },
                { type: 'color', id: 'hcolor', icon: 'highlighter', title: '突出显示', color: '#ffff00', allowNone: true, noneLabel: '无颜色', onClick: (c) => E.fmt('hiliteColor', c || 'transparent') },
                { type: 'dropdown', icon: 'wand-sparkles', title: '文字效果（艺术字）', menu: wordArtMenu((id) => E.setWordArt(id)) },
              ] },
            ] },
          ] },
          { label: '段落', items: [
            { type: 'col', items: [
              { type: 'row', items: [
                { id: 'bul', icon: 'list', title: '项目符号', onClick: () => E.setBullet('disc') },
                { id: 'num', icon: 'list-ordered', title: '编号', onClick: () => E.setBullet('decimal') },
                { icon: 'indent-decrease', title: '减少缩进', onClick: () => document.execCommand('outdent') },
                { icon: 'indent-increase', title: '增加缩进', onClick: () => document.execCommand('indent') },
                { type: 'dropdown', icon: 'list-collapse', title: '行距', menu: () => [1, 1.15, 1.3, 1.5, 2, 2.5, 3].map((v) => ({ label: String(v), onClick: () => E.setLineHeight(v) })) },
              ] },
              { type: 'row', items: [
                { id: 'al-left', icon: 'align-left', title: '左对齐 (Ctrl+L)', onClick: () => E.setAlign('left') },
                { id: 'al-center', icon: 'align-center', title: '居中 (Ctrl+E)', onClick: () => E.setAlign('center') },
                { id: 'al-right', icon: 'align-right', title: '右对齐 (Ctrl+R)', onClick: () => E.setAlign('right') },
                { id: 'al-justify', icon: 'align-justify', title: '两端对齐 (Ctrl+J)', onClick: () => E.setAlign('justify') },
                { type: 'dropdown', icon: 'align-vertical-justify-center', title: '文本垂直对齐', menu: () => [
                  { label: '顶端对齐', icon: 'align-vertical-justify-start', onClick: () => E.setValign('top') },
                  { label: '中部对齐', icon: 'align-vertical-justify-center', onClick: () => E.setValign('middle') },
                  { label: '底端对齐', icon: 'align-vertical-justify-end', onClick: () => E.setValign('bottom') },
                ] },
              ] },
            ] },
          ] },
          { label: '绘图', items: [
            { type: 'dropdown', size: 'large', icon: 'shapes', label: '形状', menu: shapesMenu((k) => E.insertShape(k)) },
            { type: 'dropdown', size: 'large', icon: 'layers', label: '排列', menu: orderMenu },
            { type: 'col', items: [
              { type: 'color', id: 'sfill', icon: 'paint-bucket', title: '形状填充', color: '#4472c4', allowNone: true, noneLabel: '无填充', onClick: (c) => E.setFill(c) },
              { type: 'color', id: 'sline', icon: 'pen-line', title: '形状轮廓', color: '#2f5496', allowNone: true, noneLabel: '无轮廓', onClick: (c) => E.setStroke('color', c) },
            ] },
          ] },
          { label: '编辑', items: [
            { type: 'col', items: [
              { icon: 'search', label: '查找', showLabel: true, onClick: () => E.findReplace(false) },
              { icon: 'replace', label: '替换', showLabel: true, onClick: () => E.findReplace(true) },
              { icon: 'square-dashed-mouse-pointer', label: '全选', showLabel: true, onClick: () => E.selectAll() },
            ] },
          ] },
        ],
      },
      {
        id: 'insert', label: '插入', groups: [
          { label: '幻灯片', items: [{ type: 'split', size: 'large', icon: 'square-plus', label: '新建幻灯片', onClick: () => E.addSlide(), menu: layoutMenu((l) => E.addSlide(l)) }] },
          { label: '表格', items: [{ type: 'dropdown', size: 'large', icon: 'table', label: '表格', menu: (anchor) => {
            let p;
            p = popover(anchor, h('div', null, gridPicker((r, c) => { p.close(); E.insertTable(r, c); }, 8, 10), h('div', { class: 'menu-item', onclick: () => { p.close(); E.insertTableDialog(); } }, h('span', { class: 'menu-icon' }, icon('table-2', 14)), h('span', { class: 'menu-label' }, '插入表格...'))));
          } }] },
          { label: '图像', items: [
            { size: 'large', icon: 'image', label: '图片', onClick: () => E.insertImage() },
            { type: 'dropdown', size: 'large', icon: 'shapes', label: '形状', menu: shapesMenu((k) => E.insertShape(k)) },
            { type: 'dropdown', size: 'large', icon: 'chart-column', label: '图表', menu: () => CHART_TYPES.map((t) => ({ label: t.label, onClick: () => E.insertChart(t.value) })) },
          ] },
          { label: '文本', items: [
            { type: 'split', size: 'large', icon: 'text-cursor-input', label: '文本框', onClick: () => E.insertTextBox(false), menu: () => [{ label: '横向文本框', icon: 'type', onClick: () => E.insertTextBox(false) }, { label: '竖向文本框', icon: 'text-select', onClick: () => E.insertTextBox(true) }] },
            { type: 'dropdown', size: 'large', icon: 'wand-sparkles', label: '艺术字', menu: wordArtMenu((id) => E.insertWordArt(id === 'none' ? 'shadow' : id)) },
            { type: 'col', items: [
              { icon: 'panel-bottom', label: '页眉页脚', showLabel: true, onClick: () => E.headerFooter() },
              { icon: 'calendar', label: '日期和时间', showLabel: true, onClick: () => E.insertDate() },
              { icon: 'hash', label: '幻灯片编号', showLabel: true, onClick: () => E.slideNumber() },
            ] },
          ] },
          { label: '链接', items: [{ size: 'large', icon: 'link', label: '超链接', onClick: () => E.link() }] },
          { label: '符号', items: [{ size: 'large', icon: 'omega', label: '符号', onClick: () => { const a = rb.get('sym'); symbolPicker(a ? a.btn : document.body, (s) => E.insertSymbol(s)); }, id: 'sym' }] },
        ],
      },
      {
        id: 'design', label: '设计', groups: [
          { label: '主题', items: [{ type: 'custom', el: themeGal.el }] },
          { label: '背景', items: [
            { size: 'large', icon: 'paint-bucket', label: '背景格式', onClick: () => E.formatBackground() },
            { size: 'large', icon: 'eraser', label: '重置背景', onClick: () => E.resetBackground() },
          ] },
          { label: '自定义', items: [{ type: 'dropdown', size: 'large', icon: 'ratio', label: '幻灯片大小', menu: () => [
            { label: '宽屏 (16:9)', onClick: () => E.setSize('16:9') },
            { label: '标准 (4:3)', onClick: () => E.setSize('4:3') },
          ] }] },
        ],
      },
      {
        id: 'trans', label: '切换', groups: [
          { label: '预览', items: [{ size: 'large', icon: 'play', label: '预览', onClick: () => E.previewTransition() }] },
          { label: '切换效果', items: [{ type: 'custom', el: trGal.el }] },
          { label: '计时', items: [
            { type: 'col', items: [
              { type: 'custom', el: labeled('持续时间', durInput) },
              { icon: 'copy-check', label: '应用到全部', showLabel: true, onClick: () => E.applyTransitionAll() },
            ] },
          ] },
        ],
      },
      {
        id: 'anim', label: '动画', groups: [
          { label: '预览', items: [{ size: 'large', icon: 'play', label: '预览', onClick: () => E.previewAnims() }] },
          { label: '进入', items: [{ type: 'custom', el: enGal.el }] },
          { label: '效果', items: [
            { type: 'dropdown', size: 'large', icon: 'sparkle', label: '强调', menu: animMenuOf('emphasis', true) },
            { type: 'dropdown', size: 'large', icon: 'log-out', label: '退出', menu: animMenuOf('exit', true) },
          ] },
          { label: '高级动画', items: [
            { type: 'dropdown', size: 'large', icon: 'sparkles', label: '添加动画', menu: () => Object.entries(ANIMS).map(([cat, list]) => ({ label: { entrance: '进入', emphasis: '强调', exit: '退出' }[cat], items: list.map((a) => ({ label: a.name, onClick: () => E.addAnim(a.id, false) })) })) },
            { id: 'animpane', size: 'large', icon: 'list-video', label: '动画窗格', onClick: () => E.toggleAnimPane() },
            { size: 'large', icon: 'trash-2', label: '删除动画', onClick: () => E.removeAnim() },
          ] },
          { label: '计时', items: [
            { type: 'col', items: [{ type: 'custom', el: labeled('开始', animTrig) }, { type: 'custom', el: labeled('持续', animDur) }, { type: 'custom', el: labeled('延迟', animDelay) }] },
          ] },
        ],
      },
      {
        id: 'show', label: '放映', groups: [
          { label: '开始放映', items: [
            { size: 'large', icon: 'play', label: '从头开始', title: 'F5', onClick: () => E.show(false) },
            { size: 'large', icon: 'circle-play', label: '从当前开始', title: 'Shift+F5', onClick: () => E.show(true) },
            { size: 'large', icon: 'book-open', label: '阅读视图', onClick: () => E.show(true, false) },
          ] },
          { label: '设置', items: [
            { id: 'hideSlide', size: 'large', icon: 'eye-off', label: '隐藏幻灯片', onClick: () => E.toggleHidden() },
            { id: 'notes2', size: 'large', icon: 'notebook-pen', label: '演讲者备注', onClick: () => E.toggleNotes() },
          ] },
        ],
      },
      {
        id: 'view', label: '视图', groups: [
          { label: '演示文稿视图', items: [
            { id: 'v-normal', size: 'large', icon: 'rectangle-horizontal', label: '普通', onClick: () => E.setView('normal') },
            { id: 'v-sorter', size: 'large', icon: 'layout-grid', label: '幻灯片浏览', onClick: () => E.setView('sorter') },
            { size: 'large', icon: 'book-open', label: '阅读视图', onClick: () => E.show(true, false) },
          ] },
          { label: '显示', items: [
            { type: 'col', items: [
              { id: 'grid', icon: 'grid-3x3', label: '网格线', showLabel: true, onClick: () => E.toggleGrid() },
              { id: 'guides', icon: 'crosshair', label: '参考线', showLabel: true, onClick: () => E.toggleGuides() },
              { id: 'notes', icon: 'notebook-pen', label: '备注', showLabel: true, onClick: () => E.toggleNotes() },
            ] },
          ] },
          { label: '显示比例', items: [
            { size: 'large', icon: 'search', label: '显示比例', onClick: () => E.zoomDialog() },
            { size: 'large', icon: 'maximize', label: '适应窗口', onClick: () => E.setZoom('fit') },
          ] },
        ],
      },
      {
        id: 'draw', label: '绘图工具', contextual: true, hidden: true, groups: [
          { label: '插入形状', items: [{ type: 'dropdown', size: 'large', icon: 'shapes', label: '更改形状', menu: shapesMenu((k) => E.changeShape(k)) }] },
          { label: '形状样式', items: [
            { type: 'dropdown', size: 'large', icon: 'palette', label: '快速样式', menu: (anchor) => {
              let p;
              const th = getTheme(E.state().deck.theme);
              const grid = h('div', { class: 'sl-qs-grid' }, quickStyles(th).map((qs) => h('button', {
                class: 'sl-qs', onclick: () => { p.close(); E.quickStyle(qs); },
                style: `background:${qs.fill.type === 'gradient' ? `linear-gradient(180deg,${qs.fill.color},${qs.fill.color2})` : qs.fill.color};border:${qs.stroke.width ? `2px solid ${qs.stroke.color}` : '1px solid transparent'};color:${qs.color};${qs.shadow ? 'box-shadow:2px 3px 4px rgba(0,0,0,.3);' : ''}`,
              }, 'Abc')));
              p = popover(anchor, h('div', { class: 'sl-pop' }, h('div', { class: 'cp-title' }, '形状样式'), grid));
            } },
            { type: 'col', items: [
              { type: 'color', id: 'fill2', icon: 'paint-bucket', label: '填充', showLabel: true, color: '#4472c4', allowNone: true, noneLabel: '无填充', onClick: (c) => E.setFill(c) },
              { type: 'color', id: 'line2', icon: 'pen-line', label: '轮廓', showLabel: true, color: '#2f5496', allowNone: true, noneLabel: '无轮廓', onClick: (c) => E.setStroke('color', c) },
              { type: 'dropdown', icon: 'sparkles', label: '效果', showLabel: true, menu: () => [
                { label: '阴影 开/关', icon: 'square', onClick: () => E.toggleShadow() },
                '-',
                ...[1, 0.8, 0.6, 0.4, 0.2].map((v) => ({ label: `不透明度 ${Math.round(v * 100)}%`, onClick: () => E.setOpacity(v) })),
              ] },
            ] },
            { type: 'col', items: [
              { type: 'dropdown', icon: 'blend', label: '渐变', showLabel: true, menu: () => [
                { label: '无渐变', onClick: () => E.setGradient(null) },
                { label: '线性向下', onClick: () => E.setGradient({ color2: '#ffffff', angle: 180 }) },
                { label: '线性向右', onClick: () => E.setGradient({ color2: '#ffffff', angle: 90 }) },
                { label: '深色对角', onClick: () => E.setGradient({ color2: '#1f2329', angle: 135 }) },
                { label: '日落', onClick: () => E.setGradient({ color: '#f97316', color2: '#db2777', angle: 135 }) },
                { label: '海洋', onClick: () => E.setGradient({ color: '#06b6d4', color2: '#6366f1', angle: 135 }) },
                { label: '森林', onClick: () => E.setGradient({ color: '#84cc16', color2: '#047857', angle: 180 }) },
              ] },
              { type: 'dropdown', icon: 'minus', label: '粗细', showLabel: true, menu: () => [0.75, 1, 1.5, 2.25, 3, 4.5, 6].map((w) => ({ label: w + ' 磅', onClick: () => E.setStroke('width', w) })) },
              { type: 'dropdown', icon: 'ellipsis', label: '虚线', showLabel: true, menu: () => [['solid', '实线'], ['dash', '短划线'], ['dot', '圆点']].map(([v, l]) => ({ label: l, onClick: () => E.setStroke('dash', v) })) },
            ] },
          ] },
          arrangeGroup(),
          sizeGroup(),
        ],
      },
      {
        id: 'pic', label: '图片工具', contextual: true, hidden: true, groups: [
          { label: '调整', items: [
            { size: 'large', icon: 'image-up', label: '更改图片', onClick: () => { const el = E.state().deck.slides[E.state().cur].elements.find((e) => E.state().sel.has(e.id) && e.type === 'image'); if (el) E.pickImageFor(el); } },
            { size: 'large', icon: 'scaling', label: '重设大小', onClick: () => E.resetImageSize() },
            { type: 'dropdown', size: 'large', icon: 'sliders-horizontal', label: '颜色', menu: () => [
              ['原图', null], ['灰度', 'grayscale(1)'], ['褐色', 'sepia(.85)'], ['冲蚀', 'brightness(1.35) contrast(.6)'], ['高对比度', 'contrast(1.6)'], ['变暗', 'brightness(.65)'], ['反色', 'invert(1)'], ['模糊', 'blur(3px)'],
            ].map(([l, f]) => ({ label: l, onClick: () => E.imageProp('filter', f) })) },
          ] },
          { label: '图片样式', items: [
            { type: 'col', items: [
              { type: 'color', icon: 'square', label: '边框', showLabel: true, color: '#000000', allowNone: true, noneLabel: '无边框', onClick: (c) => E.imageProp('border', c ? { color: c, width: 3 } : null) },
              { type: 'dropdown', icon: 'square-round-corner', label: '圆角', showLabel: true, menu: () => [0, 8, 16, 32, 9999].map((r) => ({ label: r === 9999 ? '圆形/椭圆' : r ? r + ' px' : '无', onClick: () => E.imageProp('radius', r) })) },
              { icon: 'copy', label: '阴影', showLabel: true, onClick: () => E.toggleShadow() },
            ] },
            { type: 'col', items: [
              { type: 'dropdown', icon: 'crop', label: '填充方式', showLabel: true, menu: () => [['拉伸', 'fill'], ['裁剪填满', 'cover'], ['完整显示', 'contain']].map(([l, v]) => ({ label: l, onClick: () => E.imageProp('fit', v) })) },
              { type: 'dropdown', icon: 'blend', label: '透明度', showLabel: true, menu: () => [1, 0.8, 0.6, 0.4, 0.2].map((v) => ({ label: Math.round(v * 100) + '%', onClick: () => E.setOpacity(v) })) },
            ] },
          ] },
          arrangeGroup(),
          sizeGroup(),
        ],
      },
      {
        id: 'table', label: '表格工具', contextual: true, hidden: true, groups: [
          { label: '表格样式', items: [
            { type: 'col', items: [
              { id: 'tb-head', icon: 'heading', label: '标题行', showLabel: true, onClick: () => E.tableStyle({ header: !E.state().deck.slides[E.state().cur].elements.find((e) => e.id === [...E.state().sel][0])?.tableStyle?.header }) },
              { id: 'tb-band', icon: 'rows-3', label: '镶边行', showLabel: true, onClick: () => E.tableStyle({ banded: !E.state().deck.slides[E.state().cur].elements.find((e) => e.id === [...E.state().sel][0])?.tableStyle?.banded }) },
            ] },
            { type: 'color', icon: 'palette', label: '样式颜色', showLabel: true, color: '#4472c4', onClick: (c) => c && E.tableStyle({ color: c === 'auto' ? null : c }) },
          ] },
          { label: '行和列', items: [
            { type: 'col', items: [
              { icon: 'between-horizontal-end', label: '在上方插入', showLabel: true, onClick: () => E.tableOp('rowAbove') },
              { icon: 'between-horizontal-start', label: '在下方插入', showLabel: true, onClick: () => E.tableOp('rowBelow') },
              { icon: 'rows-2', label: '平均分布列', showLabel: true, onClick: () => E.tableOp('evenCols') },
            ] },
            { type: 'col', items: [
              { icon: 'between-vertical-end', label: '在左侧插入', showLabel: true, onClick: () => E.tableOp('colLeft') },
              { icon: 'between-vertical-start', label: '在右侧插入', showLabel: true, onClick: () => E.tableOp('colRight') },
            ] },
            { type: 'dropdown', size: 'large', icon: 'table-cells-merge', label: '删除', menu: () => [
              { label: '删除行', onClick: () => E.tableOp('delRow') },
              { label: '删除列', onClick: () => E.tableOp('delCol') },
              { label: '删除表格', onClick: () => E.tableOp('delTable') },
            ] },
          ] },
          { label: '单元格', items: [{ type: 'color', icon: 'paint-bucket', label: '底纹', showLabel: true, color: '#ffc000', allowNone: true, noneLabel: '无填充', onClick: (c) => E.cellFill(c) }] },
          arrangeGroup(),
          sizeGroup(),
        ],
      },
      {
        id: 'chart', label: '图表工具', contextual: true, hidden: true, groups: [
          { label: '数据', items: [{ size: 'large', icon: 'table', label: '编辑数据', onClick: () => E.editChartData() }] },
          { label: '类型', items: [{ type: 'dropdown', size: 'large', icon: 'chart-pie', label: '更改类型', menu: () => CHART_TYPES.map((t) => ({ label: t.label, onClick: () => E.chartProp('chartType', t.value) })) }] },
          { label: '图表元素', items: [
            { type: 'col', items: [
              { icon: 'list', label: '图例 开/关', showLabel: true, onClick: () => { const el = E.state().deck.slides[E.state().cur].elements.find((e) => E.state().sel.has(e.id)); if (el) E.chartProp('legend', el.legend === false); } },
              { icon: 'heading', label: '图表标题', showLabel: true, onClick: async () => { const { promptBox } = await import('../../core/ui.js'); const el = E.state().deck.slides[E.state().cur].elements.find((e) => E.state().sel.has(e.id)); const t = await promptBox('图表标题', '标题', el?.chartTitle || ''); if (t != null) E.chartProp('chartTitle', t); } },
            ] },
          ] },
          arrangeGroup(),
          sizeGroup(),
        ],
      },
    ],
  });

  let lastCtx = null;
  return {
    el: rb.el,
    get: rb.get,
    setAIActive: (on) => rb.setAIActive(on),
    sync(s) {
      const t = s.types;
      const draw = t.has('shape') || t.has('text') || t.has('line');
      const ctxTabs = { draw, pic: t.has('image'), table: t.has('table'), chart: t.has('chart') };
      const sig = JSON.stringify(ctxTabs);
      for (const [id, v] of Object.entries(ctxTabs)) rb.setTabVisible(id, v);
      // 新插入/选中图片、表格、图表时自动切到对应工具选项卡
      if (sig !== lastCtx) {
        const only = s.selCount === 1 ? [...t][0] : null;
        if (only === 'table' || only === 'chart' || only === 'image') {
          if (['home', 'draw', 'pic', 'table', 'chart', 'insert'].includes(rb.currentTab) && lastCtx !== null) rb.showTab({ table: 'table', chart: 'chart', image: 'pic' }[only]);
        }
        lastCtx = sig;
      }
      themeGal.setActive(s.deck.theme);
      trGal.setActive(s.slide.transition?.type || 'none');
      if (document.activeElement !== durInput) durInput.value = s.slide.transition?.duration ?? 0.7;
      const a = s.anim;
      enGal.setActive(a ? a.effect : null);
      animTrig.value = a ? a.trigger : 'click';
      animTrig.disabled = animDur.disabled = animDelay.disabled = !a;
      if (document.activeElement !== animDur) animDur.value = a ? a.duration : '';
      if (document.activeElement !== animDelay) animDelay.value = a ? a.delay || 0 : '';
      rb.setActive('animpane', s.animPaneOpen);
      rb.setActive('hideSlide', !!s.slide.hidden);
      rb.setActive('grid', s.showGrid);
      rb.setActive('guides', s.showGuides);
      rb.setActive('notes', s.showNotes);
      rb.setActive('notes2', s.showNotes);
      rb.setActive('v-normal', s.view === 'normal');
      rb.setActive('v-sorter', s.view === 'sorter');
      const el = s.el;
      rb.setActive('bul', el?.style?.bullet === 'disc');
      rb.setActive('num', el?.style?.bullet === 'decimal');
      rb.setActive('tb-head', el?.type === 'table' && el.tableStyle?.header !== false);
      rb.setActive('tb-band', el?.type === 'table' && el.tableStyle?.banded !== false);
    },
    syncText(st) {
      rb.setActive('bold', !!st.bold);
      rb.setActive('italic', !!st.italic);
      rb.setActive('underline', !!st.underline);
      rb.setActive('strike', !!st.strike);
      rb.setActive('sup', !!st.sup);
      rb.setActive('sub', !!st.sub);
      rb.setValue('size', st.fontSize ? String(st.fontSize) : '');
      rb.setValue('font', st.fontFamily || '');
      ['left', 'center', 'right', 'justify'].forEach((a) => rb.setActive('al-' + a, st.align === a));
    },
    syncSize(el) {
      for (const { inp, prop } of sizeInputs) {
        if (document.activeElement === inp) continue;
        inp.value = el ? Math.round(el[prop] || 0) : '';
        inp.disabled = !el;
      }
    },
  };
}
