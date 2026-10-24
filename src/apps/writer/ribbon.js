// 文字功能区定义与状态同步
import { h, icon, createRibbon, colorPicker, gridPicker, symbolPicker, popover, FONT_FAMILIES, FONT_SIZES } from '../../core/ui.js';
import { PAPER_SIZES } from './io.js';

export function buildRibbon(E) {
  const B = (id, ic, label, onClick, extra = {}) => ({ type: 'button', id, icon: ic, label, title: extra.title || label, onClick, ...extra });
  const L = (id, ic, label, onClick, extra = {}) => B(id, ic, label, onClick, { size: 'large', ...extra });
  const D = (id, ic, label, menu, extra = {}) => ({ type: 'dropdown', id, icon: ic, label, title: extra.title || label, menu, ...extra });

  // 样式库
  const gallery = h('div', { class: 'wr-style-gallery' });
  const galleryBtns = {};
  for (const [key, st] of Object.entries(E.STYLES)) {
    const b = h('button', { class: 'wr-style-item wr-si-' + key, title: st.label, onmousedown: (e) => e.preventDefault(), onclick: () => E.applyStyle(key) },
      h('span', { class: 'wr-si-preview' }, key === 'normal' ? 'AaBb正文' : key === 'code' ? 'Code' : 'AaBb'), h('span', { class: 'wr-si-label' }, st.label));
    galleryBtns[key] = b;
    gallery.append(b);
  }

  const lineSpacingMenu = () => [
    ...['1.0', '1.15', '1.5', '2.0', '2.5', '3.0'].map((v) => ({ label: v, onClick: () => E.setLineHeight(v) })),
    '-',
    { label: '段落设置...', icon: 'pilcrow', onClick: E.paragraphDialog },
  ];
  const bulletMenu = () => [
    { type: 'header', label: '项目符号' },
    { label: '● 实心圆', onClick: () => E.setList(false, 'disc') },
    { label: '○ 空心圆', onClick: () => E.setList(false, 'circle') },
    { label: '■ 实心方块', onClick: () => E.setList(false, 'square') },
    { label: '✓ 对勾', onClick: () => E.setList(false, '"✓ "') },
    { label: '➢ 箭头', onClick: () => E.setList(false, '"➢ "') },
    { label: '◆ 菱形', onClick: () => E.setList(false, '"◆ "') },
  ];
  const numberMenu = () => [
    { type: 'header', label: '编号' },
    { label: '1. 2. 3.', onClick: () => E.setList(true, 'decimal') },
    { label: '一、二、三、', onClick: () => E.setList(true, 'cjk-ideographic') },
    { label: 'a. b. c.', onClick: () => E.setList(true, 'lower-alpha') },
    { label: 'A. B. C.', onClick: () => E.setList(true, 'upper-alpha') },
    { label: 'i. ii. iii.', onClick: () => E.setList(true, 'lower-roman') },
    { label: 'I. II. III.', onClick: () => E.setList(true, 'upper-roman') },
    { label: '01. 02. 03.', onClick: () => E.setList(true, 'decimal-leading-zero') },
  ];
  const caseMenu = () => [
    { label: '句首字母大写', onClick: () => E.changeCase('sentence') },
    { label: '全部小写', onClick: () => E.changeCase('lower') },
    { label: '全部大写', onClick: () => E.changeCase('upper') },
    { label: '每个单词首字母大写', onClick: () => E.changeCase('title') },
    { label: '切换大小写', onClick: () => E.changeCase('toggle') },
    '-',
    { label: '半角', onClick: () => E.changeCase('half') },
    { label: '全角', onClick: () => E.changeCase('full') },
  ];
  const borderMenu = () => [
    { label: '无框线', icon: 'square-dashed', onClick: () => E.setParaBorder('none') },
    { label: '外侧框线', icon: 'square', onClick: () => E.setParaBorder('box') },
    { label: '上框线', icon: 'panel-top', onClick: () => E.setParaBorder('top') },
    { label: '下框线', icon: 'panel-bottom', onClick: () => E.setParaBorder('bottom') },
    { label: '左侧粗线', icon: 'panel-left', onClick: () => E.setParaBorder('left') },
  ];

  const tableMenu = (anchor) => {
    let p;
    const content = h('div', { class: 'wr-table-menu' },
      gridPicker((r, c) => { p.close(); E.insertTable(r, c); }),
      h('div', { class: 'menu-sep' }),
      h('div', { class: 'menu-item', onclick: () => { p.close(); E.insertTableDialog(); } }, h('span', { class: 'menu-icon' }, icon('table', 14)), h('span', { class: 'menu-label' }, '插入表格...')),
      h('div', { class: 'menu-item', onclick: () => { p.close(); E.insertTable(4, 4, 'wr-ts-blue'); } }, h('span', { class: 'menu-icon' }, icon('sheet', 14)), h('span', { class: 'menu-label' }, '快速表格：蓝色标题行')),
      h('div', { class: 'menu-item', onclick: () => { p.close(); E.insertTable(4, 4, 'wr-ts-three'); } }, h('span', { class: 'menu-icon' }, icon('rows-3', 14)), h('span', { class: 'menu-label' }, '快速表格：三线表')));
    p = popover(anchor, content);
  };

  const shapeMenu = (anchor) => {
    let p;
    const grid = h('div', { class: 'wr-shape-grid' }, Object.entries(E.SHAPES).map(([k, s]) =>
      h('button', { class: 'wr-shape-btn', title: s.label, onmousedown: (e) => e.preventDefault(), onclick: () => { p.close(); E.insertShape(k); } }, h('img', { src: E.shapeSrc(k), alt: s.label }))));
    p = popover(anchor, h('div', { class: 'wr-shape-panel' }, h('div', { class: 'cp-title' }, '基本形状'), grid));
  };

  const dateMenu = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const wk = '日一二三四五六'[d.getDay()];
    const cn = (n) => String(n).split('').map((x) => '〇一二三四五六七八九'[x]).join('');
    const fmts = [
      `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`,
      `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日星期${wk}`,
      `${cn(d.getFullYear())}年${['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'][d.getMonth() + 1]}月`,
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`,
      `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`,
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    ];
    return fmts.map((f) => ({ label: f, onClick: () => E.insertText(f) }));
  };

  const pnMenu = () => {
    const fmts = [['1', '{n}'], ['第 1 页', '第 {n} 页'], ['第 1 页 共 N 页', '第 {n} 页 共 {total} 页'], ['- 1 -', '- {n} -'], ['1 / N', '{n} / {total}']];
    const pn = E.state.pageNumber;
    return [
      { type: 'header', label: '位置' },
      { label: '页面底端居中', checked: pn.enabled && pn.pos === 'footer' && pn.align === 'center', onClick: () => E.setPageNumber({ enabled: true, pos: 'footer', align: 'center' }) },
      { label: '页面底端右侧', checked: pn.enabled && pn.pos === 'footer' && pn.align === 'right', onClick: () => E.setPageNumber({ enabled: true, pos: 'footer', align: 'right' }) },
      { label: '页面顶端居中', checked: pn.enabled && pn.pos === 'header' && pn.align === 'center', onClick: () => E.setPageNumber({ enabled: true, pos: 'header', align: 'center' }) },
      { label: '页面顶端右侧', checked: pn.enabled && pn.pos === 'header' && pn.align === 'right', onClick: () => E.setPageNumber({ enabled: true, pos: 'header', align: 'right' }) },
      { label: '页码格式', icon: 'list-ordered', items: fmts.map(([l, f]) => ({ label: l, checked: pn.format === f, onClick: () => E.setPageNumber({ enabled: true, format: f }) })) },
      '-',
      { label: '删除页码', icon: 'trash-2', disabled: !pn.enabled, onClick: () => E.setPageNumber({ enabled: false }) },
    ];
  };

  const marginMenu = () => {
    const presets = [
      ['普通', '上下 2.54 厘米，左右 3.18 厘米', { top: 25.4, bottom: 25.4, left: 31.8, right: 31.8 }],
      ['窄', '上下左右 1.27 厘米', { top: 12.7, bottom: 12.7, left: 12.7, right: 12.7 }],
      ['适中', '上下 2.54 厘米，左右 1.91 厘米', { top: 25.4, bottom: 25.4, left: 19.1, right: 19.1 }],
      ['宽', '上下 2.54 厘米，左右 5.08 厘米', { top: 25.4, bottom: 25.4, left: 50.8, right: 50.8 }],
      ['公文', '上 3.7 下 3.5 左 2.8 右 2.6 厘米', { top: 37, bottom: 35, left: 28, right: 26 }],
    ];
    const m = E.state.page.margins;
    return [
      ...presets.map(([l, d, v]) => ({ label: `${l}（${d}）`, checked: ['top', 'bottom', 'left', 'right'].every((k) => Math.abs(m[k] - v[k]) < 0.05), onClick: () => E.updatePage({ margins: v }) })),
      '-',
      { label: '自定义页边距...', icon: 'settings-2', onClick: E.customMargins },
    ];
  };
  const sizeMenu = () => Object.entries(PAPER_SIZES).map(([k, v]) => ({ label: v.label, checked: E.state.page.size === k, onClick: () => E.updatePage({ size: k }) }));
  const orientMenu = () => [
    { label: '纵向', icon: 'rectangle-vertical', checked: E.state.page.orientation !== 'landscape', onClick: () => E.updatePage({ orientation: 'portrait' }) },
    { label: '横向', icon: 'rectangle-horizontal', checked: E.state.page.orientation === 'landscape', onClick: () => E.updatePage({ orientation: 'landscape' }) },
  ];
  const colsMenu = () => [
    { label: '一栏', icon: 'square', onClick: () => E.setColumns(1) },
    { label: '两栏', icon: 'columns-2', onClick: () => E.setColumns(2) },
    { label: '三栏', icon: 'columns-3', onClick: () => E.setColumns(3) },
    '-',
    { type: 'header', label: '选中文字时仅对选中段落分栏' },
  ];
  const watermarkMenu = () => [
    ...['机密', '绝密', '严禁复制', '样本', '草稿', '内部资料'].map((t) => ({ label: t, onClick: () => E.updatePage({ watermark: { text: t, size: 72, color: '#c0c0c0', opacity: 0.35, diagonal: true } }) })),
    '-',
    { label: '自定义水印...', icon: 'stamp', onClick: E.watermarkDialog },
    { label: '删除水印', icon: 'trash-2', disabled: !E.state.page.watermark, onClick: () => E.updatePage({ watermark: null }) },
  ];

  const tableBorderMenu = () => [
    { label: '所有框线', icon: 'grid-3x3', onClick: () => E.tableOp('border', '') },
    { label: '外侧框线', icon: 'square', onClick: () => E.tableOp('border', 'wr-tb-outer') },
    { label: '仅横线', icon: 'rows-3', onClick: () => E.tableOp('border', 'wr-tb-hz') },
    { label: '无框线', icon: 'square-dashed', onClick: () => E.tableOp('border', 'wr-tb-none') },
  ];
  const tableStyleMenu = () => [
    { label: '普通网格', onClick: () => E.tableOp('style', '') },
    { label: '蓝色标题行 + 镶边行', onClick: () => E.tableOp('style', 'wr-ts-blue') },
    { label: '橙色标题行 + 镶边行', onClick: () => E.tableOp('style', 'wr-ts-orange') },
    { label: '三线表（学术）', onClick: () => E.tableOp('style', 'wr-ts-three') },
  ];

  const tabs = [
    {
      id: 'home', label: '开始', groups: [
        { label: '撤销', items: [{ type: 'col', items: [B('undo', 'undo-2', '撤销', E.undo, { title: '撤销 (Ctrl+Z)' }), B('redo', 'redo-2', '恢复', E.redo, { title: '恢复 (Ctrl+Y)' })] }] },
        {
          label: '剪贴板', items: [
            { type: 'split', id: 'paste', icon: 'clipboard-paste', label: '粘贴', size: 'large', onClick: () => E.pasteFromClipboard(false), menu: () => [
              { label: '粘贴', icon: 'clipboard-paste', onClick: () => E.pasteFromClipboard(false) },
              { label: '只粘贴文本', icon: 'clipboard-type', onClick: () => E.pasteFromClipboard(true) }] },
            { type: 'col', items: [
              B('cut', 'scissors', '剪切', () => E.run(() => E.exec('cut')), { showLabel: true }),
              B('copy', 'copy', '复制', () => E.exec('copy'), { showLabel: true }),
              B('painter', 'paintbrush', '格式刷', () => (E.painter ? E.cancelPainter() : E.pickPainter()), { showLabel: true }),
            ] },
          ],
        },
        {
          label: '字体', items: [{ type: 'col', items: [
            { type: 'row', items: [
              { type: 'select', id: 'fontName', options: FONT_FAMILIES, width: 118, title: '字体', onChange: (v) => E.applyFontName(v) },
              { type: 'select', id: 'fontSize', editable: true, options: FONT_SIZES.map((s) => ({ value: s.value, label: s.label })), width: 52, title: '字号', onChange: (v) => {
                const found = FONT_SIZES.find((s) => s.label === v);
                E.applyFontSize(found ? found.value : v);
              } },
              B('grow', 'a-arrow-up', '增大字号', () => E.growFont(1), { title: '增大字号 (Ctrl+])' }),
              B('shrink', 'a-arrow-down', '减小字号', () => E.growFont(-1), { title: '减小字号 (Ctrl+[)' }),
              B('clear', 'remove-formatting', '清除格式', E.clearFormat),
            ] },
            { type: 'row', items: [
              B('bold', 'bold', '加粗', () => E.toggleInline('bold'), { title: '加粗 (Ctrl+B)' }),
              B('italic', 'italic', '倾斜', () => E.toggleInline('italic'), { title: '倾斜 (Ctrl+I)' }),
              B('underline', 'underline', '下划线', () => E.toggleInline('underline'), { title: '下划线 (Ctrl+U)' }),
              B('strike', 'strikethrough', '删除线', () => E.toggleInline('strikeThrough')),
              B('sup', 'superscript', '上标', () => E.toggleInline('superscript')),
              B('sub', 'subscript', '下标', () => E.toggleInline('subscript')),
              { type: 'color', id: 'fontColor', icon: 'baseline', title: '字体颜色', color: '#c00000', onClick: (c) => E.setColor(c), autoLabel: '自动' },
              { type: 'color', id: 'hilite', icon: 'highlighter', title: '突出显示', color: '#ffff00', onClick: (c) => E.setHighlight(c), allowNone: true, noneLabel: '无' },
              D('case', 'case-sensitive', '更改大小写', caseMenu),
            ] },
          ] }],
        },
        {
          label: '段落', items: [{ type: 'col', items: [
            { type: 'row', items: [
              { type: 'split', id: 'ul', icon: 'list', title: '项目符号', onClick: () => E.setList(false), menu: bulletMenu },
              { type: 'split', id: 'ol', icon: 'list-ordered', title: '编号', onClick: () => E.setList(true), menu: numberMenu },
              B('outdent', 'indent-decrease', '减少缩进', () => E.indent(-1)),
              B('indent', 'indent-increase', '增加缩进', () => E.indent(1)),
              D('lineh', 'list-chevrons-up-down', '行距', lineSpacingMenu),
              B('para', 'pilcrow', '段落设置', E.paragraphDialog),
            ] },
            { type: 'row', items: [
              B('alignLeft', 'align-left', '左对齐', () => E.setAlign('left'), { title: '左对齐 (Ctrl+L)' }),
              B('alignCenter', 'align-center', '居中', () => E.setAlign('center'), { title: '居中 (Ctrl+E)' }),
              B('alignRight', 'align-right', '右对齐', () => E.setAlign('right'), { title: '右对齐 (Ctrl+R)' }),
              B('alignJustify', 'align-justify', '两端对齐', () => E.setAlign('justify'), { title: '两端对齐 (Ctrl+J)' }),
              { type: 'color', id: 'shading', icon: 'paint-bucket', title: '段落底纹', color: '#d9e2f3', onClick: (c) => E.setParaShading(c), allowNone: true, noneLabel: '无底纹' },
              D('pborder', 'square', '边框', borderMenu),
            ] },
          ] }],
        },
        { label: '样式', items: [{ type: 'custom', el: gallery }] },
        {
          label: '编辑', items: [{ type: 'col', items: [
            B('find', 'search', '查找', () => E.panes.openFind(false), { showLabel: true, title: '查找 (Ctrl+F)' }),
            B('replace', 'replace', '替换', () => E.panes.openFind(true), { showLabel: true, title: '替换 (Ctrl+H)' }),
            B('selall', 'text-select', '全选', () => { E.focusDoc(); const r = document.createRange(); r.selectNodeContents(E.doc); E.setRange(r); }, { showLabel: true }),
          ] }],
        },
      ],
    },
    {
      id: 'insert', label: '插入', groups: [
        { label: '页', items: [L('blankPage', 'file-plus', '空白页', E.insertBlankPage), L('pageBreak', 'separator-horizontal', '分页符', E.insertPageBreak, { title: '分页符 (Ctrl+Enter)' })] },
        { label: '表格', items: [D('table', 'table', '表格', tableMenu, { size: 'large' })] },
        { label: '插图', items: [L('image', 'image', '图片', E.insertImage), D('shape', 'shapes', '形状', shapeMenu, { size: 'large' }), L('textbox', 'text-cursor-input', '文本框', E.insertTextBox)] },
        { label: '链接', items: [L('link', 'link', '超链接', E.linkDialog, { title: '超链接 (Ctrl+K)' })] },
        { label: '页眉和页脚', items: [L('header', 'panel-top', '页眉页脚', () => E.headerFooterDialog('header')), D('pageNum', 'hash', '页码', pnMenu, { size: 'large' })] },
        {
          label: '文本', items: [
            D('date', 'calendar', '日期', dateMenu, { size: 'large' }),
            D('symbol', 'omega', '符号', (anchor) => { symbolPicker(anchor, (s) => E.insertText(s)); }, { size: 'large' }),
            L('hr', 'minus', '水平线', E.insertHR),
          ],
        },
        { label: '批注', items: [L('comment', 'message-square-plus', '批注', E.newComment)] },
      ],
    },
    {
      id: 'layout', label: '页面布局', groups: [
        {
          label: '页面设置', items: [
            D('margins', 'square-dashed', '页边距', marginMenu, { size: 'large' }),
            D('orient', 'rotate-ccw-square', '纸张方向', orientMenu, { size: 'large' }),
            D('psize', 'file', '纸张大小', sizeMenu, { size: 'large' }),
            D('cols', 'columns-2', '分栏', colsMenu, { size: 'large' }),
          ],
        },
        {
          label: '页面背景', items: [
            D('pcolor', 'paint-bucket', '页面颜色', (anchor) => { colorPicker(anchor, (c) => E.updatePage({ color: c }), { allowNone: true, noneLabel: '无颜色' }); }, { size: 'large' }),
            D('watermark', 'stamp', '水印', watermarkMenu, { size: 'large' }),
            L('pborderToggle', 'frame', '页面边框', () => { E.updatePage({ border: !E.state.page.border }); }),
          ],
        },
      ],
    },
    {
      id: 'refs', label: '引用', groups: [
        {
          label: '目录', items: [
            D('toc', 'list-tree', '目录', () => [
              { label: '插入自动目录', icon: 'list-tree', onClick: E.insertTOC },
              { label: '更新目录', icon: 'refresh-cw', onClick: E.updateTOC },
              { label: '删除目录', icon: 'trash-2', onClick: E.deleteTOC },
            ], { size: 'large' }),
            L('tocUpdate', 'refresh-cw', '更新目录', E.updateTOC),
          ],
        },
        { label: '脚注', items: [L('footnote', 'superscript', '插入脚注', E.insertFootnote)] },
        { label: '导航', items: [L('navRef', 'panel-left', '导航窗格', () => E.toggleNav())] },
      ],
    },
    {
      id: 'review', label: '审阅', groups: [
        { label: '校对', items: [L('spell', 'spell-check', '拼写检查', () => E.toggleSpell()), L('wc', 'whole-word', '字数统计', () => E.panes.wordCountDialog())] },
        {
          label: '批注', items: [
            L('newComment', 'message-square-plus', '新建批注', E.newComment),
            D('delComment', 'message-square-x', '删除批注', () => [{ label: '删除文档中的所有批注', onClick: E.deleteAllComments }], { size: 'large' }),
            L('commentPane', 'messages-square', '批注窗格', () => E.panes.openComments()),
          ],
        },
        { label: '查找', items: [L('find2', 'search', '查找替换', () => E.panes.openFind(true))] },
      ],
    },
    {
      id: 'view', label: '视图', groups: [
        { label: '视图', items: [L('view-page', 'file-text', '页面视图', () => E.setViewMode('page')), L('view-read', 'book-open', '阅读视图', () => E.setViewMode('read')), L('view-web', 'globe', 'Web 版式', () => E.setViewMode('web'))] },
        { label: '显示', items: [L('nav', 'panel-left', '导航窗格', () => E.toggleNav()), L('ruler', 'ruler', '标尺', () => E.setRuler(!E.state.view.ruler))] },
        {
          label: '显示比例', items: [
            L('z100', 'scan', '100%', () => E.setZoom(100)),
            L('zwidth', 'move-horizontal', '页宽', E.fitWidth),
            L('zpage', 'file', '单页', E.fitPage),
            { type: 'col', items: [B('zin', 'zoom-in', '放大', () => E.setZoom(E.state.view.zoom + 10), { showLabel: true }), B('zout', 'zoom-out', '缩小', () => E.setZoom(E.state.view.zoom - 10), { showLabel: true })] },
          ],
        },
        { label: '窗口', items: [L('full', 'maximize', '全屏显示', E.fullscreen)] },
      ],
    },
    {
      id: 'table', label: '表格工具', contextual: true, hidden: true, groups: [
        { label: '行和列', items: [
          { type: 'col', items: [B('rowAbove', 'between-horizontal-start', '在上方插入行', () => E.tableOp('rowAbove'), { showLabel: true }), B('rowBelow', 'between-horizontal-end', '在下方插入行', () => E.tableOp('rowBelow'), { showLabel: true })] },
          { type: 'col', items: [B('colLeft', 'between-vertical-start', '在左侧插入列', () => E.tableOp('colLeft'), { showLabel: true }), B('colRight', 'between-vertical-end', '在右侧插入列', () => E.tableOp('colRight'), { showLabel: true })] },
          D('tdel', 'trash-2', '删除', () => [{ label: '删除行', onClick: () => E.tableOp('delRow') }, { label: '删除列', onClick: () => E.tableOp('delCol') }, { label: '删除表格', onClick: () => E.tableOp('delTable') }], { size: 'large' }),
        ] },
        { label: '合并', items: [L('merge', 'merge', '合并单元格', () => E.tableOp('merge')), L('split', 'split', '拆分单元格', () => E.tableOp('split'))] },
        { label: '样式', items: [
          D('tstyle', 'palette', '表格样式', tableStyleMenu, { size: 'large' }),
          { type: 'col', items: [
            { type: 'color', id: 'cellBg', icon: 'paint-bucket', title: '单元格底纹', label: '底纹', showLabel: true, color: '#d9e2f3', onClick: (c) => E.tableOp('bg', c), allowNone: true, noneLabel: '无底纹' },
            D('tborder', 'grid-3x3', '边框', tableBorderMenu, { showLabel: true }),
            B('theader', 'heading', '标题行', () => E.tableOp('header'), { showLabel: true }),
          ] },
        ] },
        { label: '对齐方式', items: [{ type: 'col', items: [
          { type: 'row', items: [B('tl', 'align-left', '左对齐', () => E.tableOp('align', 'left')), B('tc', 'align-center', '居中', () => E.tableOp('align', 'center')), B('tr', 'align-right', '右对齐', () => E.tableOp('align', 'right')), B('tdist', 'columns-3', '平均分布各列', () => E.tableOp('distribute'))] },
          { type: 'row', items: [B('vt', 'align-vertical-justify-start', '顶端对齐', () => E.tableOp('valign', 'top')), B('vm', 'align-vertical-justify-center', '垂直居中', () => E.tableOp('valign', 'middle')), B('vb', 'align-vertical-justify-end', '底端对齐', () => E.tableOp('valign', 'bottom'))] },
        ] }] },
      ],
    },
    {
      id: 'image', label: '图片工具', contextual: true, hidden: true, groups: [
        { label: '大小', items: [L('isize', 'scaling', '大小', E.imageSizeDialog), L('ireset', 'rotate-ccw', '重设大小', () => E.imageOp('reset'))] },
        { label: '环绕', items: [
          L('iinline', 'image', '嵌入型', () => E.imageOp('wrap', 'inline')),
          L('ileft', 'wrap-text', '左环绕', () => E.imageOp('wrap', 'left')),
          L('iright', 'wrap-text', '右环绕', () => E.imageOp('wrap', 'right')),
          L('icenter', 'align-center', '居中', () => E.imageOp('wrap', 'center')),
        ] },
        { label: '样式', items: [
          L('iborder', 'square', '边框', () => E.imageOp('border')),
          L('ishadow', 'copy', '阴影', () => E.imageOp('shadow')),
          L('iradius', 'squircle', '圆角', () => E.imageOp('radius')),
          D('ifill', 'paint-bucket', '形状填充', (anchor) => {
            if (!E.selectedImg?.dataset.shape) return [{ label: '仅适用于形状', disabled: true }];
            colorPicker(anchor, (c) => E.imageOp('fill', c || 'transparent'), { allowNone: true, noneLabel: '无填充' });
          }, { size: 'large' }),
        ] },
        { label: '删除', items: [L('idel', 'trash-2', '删除', () => E.imageOp('delete'))] },
      ],
    },
  ];

  const rb = createRibbon({ tabs, onFile: E.ctx.openBackstage, onAI: () => E.ai?.toggle() });

  // 保证字体下拉框能显示文档中任意字体
  const fontSel = rb.get('fontName').el;
  const ensureFontOption = (v) => {
    if (![...fontSel.options].some((o) => o.value === v)) fontSel.append(h('option', { value: v }, v));
  };

  let ctxTab = { table: false, image: false };
  E.syncRibbon = () => {
    const r = E.getRange();
    const has = !!r && E.doc.contains(r.commonAncestorContainer);
    const q = (c) => { try { return has && document.queryCommandState(c); } catch { return false; } };
    rb.setActive('bold', q('bold'));
    rb.setActive('italic', q('italic'));
    rb.setActive('underline', q('underline'));
    rb.setActive('strike', q('strikeThrough'));
    rb.setActive('sup', q('superscript'));
    rb.setActive('sub', q('subscript'));
    rb.setActive('ul', has && !!E.closestIn(r.startContainer, 'ul'));
    rb.setActive('ol', has && !!E.closestIn(r.startContainer, 'ol'));
    let align = 'left';
    if (has) {
      const el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
      if (el && E.doc.contains(el)) {
        const cs = getComputedStyle(el);
        const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
        ensureFontOption(fam);
        rb.setValue('fontName', fam);
        const pt = Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2;
        rb.setValue('fontSize', String(pt));
        const blk = E.closestIn(r.startContainer, 'p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,pre,div') || el;
        const ta = getComputedStyle(blk).textAlign;
        align = ta === 'center' ? 'center' : ta === 'right' || ta === 'end' ? 'right' : ta === 'justify' ? 'justify' : 'left';
      }
    }
    rb.setActive('alignLeft', align === 'left');
    rb.setActive('alignCenter', align === 'center');
    rb.setActive('alignRight', align === 'right');
    rb.setActive('alignJustify', align === 'justify');
    const sk = E.currentStyleKey();
    Object.entries(galleryBtns).forEach(([k, b]) => b.classList.toggle('active', k === sk));

    const inTable = (has && !!E.closestIn(r.startContainer, 'td,th')) || E.selCells.length > 0;
    if (inTable !== ctxTab.table) { rb.setTabVisible('table', inTable); ctxTab.table = inTable; }
    const img = !!E.selectedImg;
    if (img !== ctxTab.image) { rb.setTabVisible('image', img); ctxTab.image = img; if (img) rb.showTab('image'); }
    rb.setDisabled('merge', E.selCells.length < 2);
    rb.setActive('pborderToggle', !!E.state.page.border);
    rb.setActive('nav', !!E.state.view.nav);
    rb.setActive('navRef', !!E.state.view.nav);
    rb.setActive('ruler', !!E.state.view.ruler);
  };
  E.updateUndo = () => {
    rb.setDisabled('undo', E.hist.idx <= 0);
    rb.setDisabled('redo', E.hist.idx >= E.hist.stack.length - 1);
  };
  return rb;
}
