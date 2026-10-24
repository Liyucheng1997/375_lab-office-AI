// 表格功能区
import { h, icon, createRibbon, showMenu, popover, symbolPicker, FONT_FAMILIES, FONT_SIZES } from '../../core/ui.js';
import { NUMBER_FORMATS } from './format.js';
import { FUNC_META, CATEGORIES } from './functions.js';
import { CF_STYLES } from './cf.js';
import { CHART_TYPES } from './objects.js';
import * as cmd from './commands.js';
import * as dlg from './dialogs.js';

export function buildRibbon(ed) {
  const sel = () => ed.sel;
  const B = (icon2, label, onClick, extra = {}) => ({ icon: icon2, label, title: extra.title || label, onClick, ...extra });

  const pasteMenu = () => [
    { label: '粘贴', icon: 'clipboard-paste', onClick: () => cmd.pasteFromSystem(ed) },
    { label: '仅粘贴值', icon: 'clipboard-type', onClick: () => cmd.pasteFromSystem(ed, 'values') },
    { label: '仅粘贴格式', icon: 'paintbrush', onClick: () => cmd.pasteFromSystem(ed, 'formats') },
    { label: '仅粘贴公式', icon: 'sigma', onClick: () => cmd.pasteFromSystem(ed, 'formulas') },
    { label: '转置', icon: 'arrow-down-left', onClick: () => cmd.pasteFromSystem(ed, 'transpose') },
    { label: '无框线', icon: 'square-dashed', onClick: () => cmd.pasteFromSystem(ed, 'noborder') },
  ];

  const borderMenu = () => [
    { label: '下框线', icon: 'panel-bottom', onClick: () => cmd.setBorder(ed, 'bottom') },
    { label: '上框线', icon: 'panel-top', onClick: () => cmd.setBorder(ed, 'top') },
    { label: '左框线', icon: 'panel-left', onClick: () => cmd.setBorder(ed, 'left') },
    { label: '右框线', icon: 'panel-right', onClick: () => cmd.setBorder(ed, 'right') },
    '-',
    { label: '无框线', icon: 'square-dashed', onClick: () => cmd.setBorder(ed, 'none') },
    { label: '所有框线', icon: 'grid-3x3', onClick: () => cmd.setBorder(ed, 'all') },
    { label: '外侧框线', icon: 'square', onClick: () => cmd.setBorder(ed, 'outer') },
    { label: '粗外侧框线', icon: 'square', onClick: () => cmd.setBorder(ed, 'thickOuter') },
    { label: '内部框线', icon: 'plus', onClick: () => cmd.setBorder(ed, 'inner') },
    { label: '上下框线', icon: 'rows-2', onClick: () => cmd.setBorder(ed, 'topBottom') },
    { label: '双底框线', icon: 'panel-bottom', onClick: () => cmd.setBorder(ed, 'doubleBottom') },
    { label: '粗底框线', icon: 'panel-bottom', onClick: () => cmd.setBorder(ed, 'thickBottom') },
    '-',
    { label: '线条颜色', icon: 'palette', items: ['#000000', '#7f7f7f', '#bfbfbf', '#c00000', '#ff0000', '#ffc000', '#00b050', '#0070c0', '#7030a0'].map((c) => ({ label: c, icon: h('span', { class: 'ss-swatch', style: { background: c } }), checked: (ed.borderLine?.c || '#000000') === c, onClick: () => { ed.borderLine = { ...(ed.borderLine || { w: 1 }), c }; } })) },
    { label: '线条样式', icon: 'minus', items: [
      { label: '细实线', onClick: () => { ed.borderLine = { ...(ed.borderLine || { c: '#000000' }), w: 1, d: null }; } },
      { label: '中等粗线', onClick: () => { ed.borderLine = { ...(ed.borderLine || { c: '#000000' }), w: 2, d: null }; } },
      { label: '粗线', onClick: () => { ed.borderLine = { ...(ed.borderLine || { c: '#000000' }), w: 3, d: null }; } },
      { label: '虚线', onClick: () => { ed.borderLine = { ...(ed.borderLine || { c: '#000000' }), w: 1, d: 'dashed' }; } },
      { label: '点线', onClick: () => { ed.borderLine = { ...(ed.borderLine || { c: '#000000' }), w: 1, d: 'dotted' }; } },
    ] },
  ];

  const cfMenu = () => [
    { label: '突出显示单元格规则', icon: 'highlighter', items: [
      { label: '大于...', onClick: () => dlg.cfRule(ed, 'cell', 'gt') },
      { label: '小于...', onClick: () => dlg.cfRule(ed, 'cell', 'lt') },
      { label: '介于...', onClick: () => dlg.cfRule(ed, 'cell', 'between') },
      { label: '等于...', onClick: () => dlg.cfRule(ed, 'cell', 'eq') },
      { label: '文本包含...', onClick: () => dlg.cfRule(ed, 'text') },
      { label: '重复值...', onClick: () => dlg.cfRule(ed, 'dup') },
      { label: '唯一值...', onClick: () => dlg.cfRule(ed, 'unique') },
      { label: '空值...', onClick: () => dlg.cfRule(ed, 'blank') },
    ] },
    { label: '项目选取规则', icon: 'list-ordered', items: [
      { label: '前 10 项...', onClick: () => dlg.cfRule(ed, 'top') },
      { label: '最后 10 项...', onClick: () => dlg.cfRule(ed, 'bottom') },
      { label: '高于平均值...', onClick: () => dlg.cfRule(ed, 'above') },
      { label: '低于平均值...', onClick: () => dlg.cfRule(ed, 'below') },
    ] },
    { label: '数据条', icon: 'chart-bar-big', items: [['蓝色', '#638ec6'], ['绿色', '#63c384'], ['红色', '#ff555a'], ['橙色', '#ffb628'], ['浅蓝', '#008aef'], ['紫色', '#d6007b']].map(([n, c]) => ({ label: n + '数据条', icon: h('span', { class: 'ss-swatch', style: { background: c } }), onClick: () => dlg.cfRule(ed, 'bar', c) })) },
    { label: '色阶', icon: 'palette', items: [
      { label: '红-黄-绿', colors: ['#f8696b', '#ffeb84', '#63be7b'] }, { label: '绿-黄-红', colors: ['#63be7b', '#ffeb84', '#f8696b'] },
      { label: '红-白-蓝', colors: ['#f8696b', '#fcfcff', '#5a8ac6'] }, { label: '白-绿', colors: ['#fcfcff', '#63be7b'] },
      { label: '白-红', colors: ['#fcfcff', '#f8696b'] }, { label: '黄-绿', colors: ['#ffef9c', '#63be7b'] },
    ].map((x) => ({ label: x.label, icon: h('span', { class: 'ss-swatch', style: { background: `linear-gradient(90deg, ${x.colors.join(',')})` } }), onClick: () => dlg.cfRule(ed, x.colors.length === 3 ? 'scale3' : 'scale2', x.colors) })) },
    '-',
    { label: '新建规则（公式）...', icon: 'square-function', onClick: () => dlg.cfRule(ed, 'formula') },
    { label: '清除规则', icon: 'eraser', items: [
      { label: '清除所选单元格的规则', onClick: () => dlg.clearCF(ed, 'selection') },
      { label: '清除整个工作表的规则', onClick: () => dlg.clearCF(ed, 'sheet') },
    ] },
    { label: '管理规则...', icon: 'list-checks', onClick: () => dlg.manageCF(ed) },
  ];

  const tableStyleMenu = (anchor) => {
    const grid = h('div', { class: 'ss-ts-grid' }, cmd.TABLE_STYLES.map((ts) => h('button', {
      class: 'ss-ts', title: ts.name, onmousedown: (e) => e.preventDefault(),
      onclick: () => { p.close(); cmd.applyTableStyle(ed, ts); },
    }, ...[0, 1, 2, 3].map((i) => h('div', { class: 'ss-ts-row', style: { background: i === 0 ? ts.head : i % 2 ? ts.band : '#fff', borderColor: ts.line } })))));
    const p = popover(anchor, h('div', { class: 'ss-ts-panel' }, h('div', { class: 'cp-title' }, '套用表格格式'), grid));
  };
  const cellStyleMenu = (anchor) => {
    let p;
    const groups = cmd.CELL_STYLES.map((g) => h('div', null, h('div', { class: 'cp-title' }, g.group),
      h('div', { class: 'ss-cs-grid' }, g.items.map((it) => h('button', {
        class: 'ss-cs', onmousedown: (e) => e.preventDefault(),
        style: it.s ? { background: it.s.bg || '#fff', color: it.s.fc || '#000', fontWeight: it.s.b ? 'bold' : '', borderBottom: it.s.bd?.b ? `2px solid ${it.s.bd.b.c}` : '' } : {},
        onclick: () => { p.close(); cmd.applyCellStyle(ed, it.s); },
      }, it.name)))));
    p = popover(anchor, h('div', { class: 'ss-cs-panel' }, groups));
  };

  const fnCatMenu = (cat) => () => Object.values(FUNC_META).filter((f) => f.cat === cat).map((f) => ({ label: f.name, onClick: () => insertFn(f.name) }));
  const insertFn = (name) => {
    if (ed.editing) {
      const el = ed.activeEditEl();
      const p = el.selectionStart;
      el.setRangeText(name + '(', p, el.selectionEnd, 'end');
      ed.onEditInput(el === ed.fx ? 'bar' : undefined);
      el.focus();
    } else {
      ed.beginEdit('=' + name + '()', 'edit');
      const n = ed.input.value.length - 1;
      ed.input.setSelectionRange(n, n);
      ed.onEditInput();
    }
  };
  const autoSumMenu = () => [['SUM', '求和'], ['AVERAGE', '平均值'], ['COUNT', '计数'], ['MAX', '最大值'], ['MIN', '最小值']].map(([f, l]) => ({ label: l, onClick: () => cmd.autoSum(ed, f) }))
    .concat(['-', { label: '其他函数...', onClick: () => dlg.insertFunction(ed) }]);

  const chartBtn = (t, size = 'large') => ({ type: 'button', size, icon: t.icon, label: t.label.replace('图', ''), title: '插入' + t.label, onClick: () => ed.objects.insertChart(t.id) });
  const withChart = (fn) => () => { const o = ed.objects.selectedChart(); if (o) fn(o); };

  const tabs = [
    {
      id: 'home', label: '开始', groups: [
        { label: '剪贴板', items: [
          { type: 'split', size: 'large', id: 'paste', icon: 'clipboard-paste', label: '粘贴', onClick: () => cmd.pasteFromSystem(ed), menu: pasteMenu },
          { type: 'col', items: [
            B('scissors', '剪切', () => cmd.copy(ed, true), { showLabel: true }),
            B('copy', '复制', () => cmd.copy(ed), { showLabel: true }),
            { type: 'split', id: 'painter', icon: 'paintbrush', label: '格式刷', showLabel: true, onClick: () => cmd.startPainter(ed), menu: () => [{ label: '锁定格式刷（连续使用）', onClick: () => cmd.startPainter(ed, true) }] },
          ] },
        ] },
        { label: '字体', items: [
          { type: 'col', items: [
            { type: 'row', items: [
              { type: 'select', id: 'ff', width: 118, options: FONT_FAMILIES, title: '字体', onChange: (v) => { cmd.setStyle(ed, { ff: v === 'Microsoft YaHei' ? null : v }); ed.input.focus(); } },
              { type: 'select', id: 'fs', editable: true, width: 54, options: FONT_SIZES.map((s) => ({ value: s.value, label: s.label })), value: '11', title: '字号', onChange: (v) => { const n = parseFloat(v); if (n > 0) cmd.setStyle(ed, { fs: n === 11 ? null : n }); ed.input.focus(); } },
              B('a-arrow-up', '增大字号', () => cmd.fontSizeStep(ed, 1)),
              B('a-arrow-down', '减小字号', () => cmd.fontSizeStep(ed, -1)),
            ] },
            { type: 'row', items: [
              { id: 'b', icon: 'bold', title: '加粗 (Ctrl+B)', onClick: () => cmd.toggleStyle(ed, 'b') },
              { id: 'i', icon: 'italic', title: '倾斜 (Ctrl+I)', onClick: () => cmd.toggleStyle(ed, 'i') },
              { id: 'u', icon: 'underline', title: '下划线 (Ctrl+U)', onClick: () => cmd.toggleStyle(ed, 'u') },
              { id: 'st', icon: 'strikethrough', title: '删除线', onClick: () => cmd.toggleStyle(ed, 'st') },
              { type: 'sep' },
              { type: 'split', icon: 'grid-2x2', title: '所有框线', onClick: () => cmd.setBorder(ed, 'all'), menu: borderMenu },
              { type: 'color', id: 'bg', icon: 'paint-bucket', title: '填充颜色', color: '#ffff00', allowNone: true, noneLabel: '无填充颜色', onClick: (c) => cmd.setStyle(ed, { bg: c || null }) },
              { type: 'color', id: 'fc', icon: 'baseline', title: '字体颜色', color: '#ff0000', autoLabel: '自动', onClick: (c) => cmd.setStyle(ed, { fc: c === 'auto' ? null : c }) },
            ] },
          ] },
        ] },
        { label: '对齐方式', items: [
          { type: 'col', items: [
            { type: 'row', items: [
              { id: 'va-top', icon: 'align-vertical-justify-start', title: '顶端对齐', onClick: () => cmd.setStyle(ed, { va: 'top' }) },
              { id: 'va-middle', icon: 'align-vertical-justify-center', title: '垂直居中', onClick: () => cmd.setStyle(ed, { va: null }) },
              { id: 'va-bottom', icon: 'align-vertical-justify-end', title: '底端对齐', onClick: () => cmd.setStyle(ed, { va: 'bottom' }) },
              { type: 'sep' },
              { id: 'wrap', icon: 'wrap-text', label: '自动换行', showLabel: true, title: '自动换行', onClick: () => cmd.toggleStyle(ed, 'wrap') },
            ] },
            { type: 'row', items: [
              { id: 'ha-left', icon: 'align-left', title: '左对齐', onClick: () => cmd.setStyle(ed, { ha: 'left' }) },
              { id: 'ha-center', icon: 'align-center', title: '居中', onClick: () => cmd.setStyle(ed, { ha: 'center' }) },
              { id: 'ha-right', icon: 'align-right', title: '右对齐', onClick: () => cmd.setStyle(ed, { ha: 'right' }) },
              { type: 'sep' },
              B('indent-decrease', '减少缩进', () => { const c = ed.cellAt(ed.sel.active.r, ed.sel.active.c); const n = Math.max(0, ((c && c.s && c.s.indent) || 0) - 1); cmd.setStyle(ed, { indent: n || null }); }),
              B('indent-increase', '增加缩进', () => { const c = ed.cellAt(ed.sel.active.r, ed.sel.active.c); cmd.setStyle(ed, { indent: ((c && c.s && c.s.indent) || 0) + 1, ha: c?.s?.ha === 'right' ? 'right' : 'left' }); }),
            ] },
          ] },
          { type: 'split', size: 'large', id: 'merge', icon: 'table-cells-merge', label: '合并居中', onClick: () => cmd.merge(ed, 'center'), menu: () => [
            { label: '合并居中', icon: 'table-cells-merge', onClick: () => cmd.merge(ed, 'center') },
            { label: '合并单元格', icon: 'merge', onClick: () => cmd.merge(ed, 'merge') },
            { label: '按行合并', icon: 'rows-3', onClick: () => cmd.merge(ed, 'across') },
            { label: '取消合并单元格', icon: 'table-cells-split', onClick: () => cmd.merge(ed, 'unmerge') },
          ] },
        ] },
        { label: '数字', items: [
          { type: 'col', items: [
            { type: 'row', items: [
              { type: 'select', id: 'nf', width: 120, title: '数字格式', options: [...NUMBER_FORMATS.map((f) => ({ value: f.fmt, label: f.label })), { value: '__custom', label: '其他数字格式...' }],
                onChange: (v) => { if (v === '__custom') dlg.formatCells(ed); else cmd.setNumberFormat(ed, v); ed.input.focus(); } },
            ] },
            { type: 'row', items: [
              { type: 'split', icon: 'japanese-yen', title: '会计数字格式', onClick: () => cmd.setNumberFormat(ed, '¥#,##0.00'), menu: () => [
                { label: '¥ 中文（中国）', onClick: () => cmd.setNumberFormat(ed, '¥#,##0.00') },
                { label: '$ 英语（美国）', onClick: () => cmd.setNumberFormat(ed, '$#,##0.00') },
                { label: '€ 欧元', onClick: () => cmd.setNumberFormat(ed, '€#,##0.00') },
                { label: '£ 英镑', onClick: () => cmd.setNumberFormat(ed, '£#,##0.00') },
                { label: '会计专用', onClick: () => cmd.setNumberFormat(ed, NUMBER_FORMATS.find((f) => f.id === 'accounting').fmt) },
              ] },
              B('percent', '百分比样式', () => cmd.setNumberFormat(ed, '0%')),
              { icon: h('span', { class: 'ss-txt-ico' }, ',000'), title: '千位分隔样式', onClick: () => cmd.thousands(ed) },
              { icon: h('span', { class: 'ss-txt-ico' }, '.0→'), title: '增加小数位数', onClick: () => cmd.changeDecimals(ed, 1) },
              { icon: h('span', { class: 'ss-txt-ico' }, '←.0'), title: '减少小数位数', onClick: () => cmd.changeDecimals(ed, -1) },
            ] },
          ] },
        ] },
        { label: '样式', items: [
          { type: 'dropdown', size: 'large', icon: 'layout-grid', label: '条件格式', menu: cfMenu },
          { type: 'dropdown', size: 'large', icon: 'table', label: '表格样式', menu: (a) => tableStyleMenu(a) },
          { type: 'dropdown', size: 'large', icon: 'swatch-book', label: '单元格样式', menu: (a) => cellStyleMenu(a) },
        ] },
        { label: '单元格', items: [
          { type: 'dropdown', size: 'large', icon: 'between-horizontal-start', label: '插入', menu: () => [
            { label: '插入单元格...', onClick: () => dlg.insertCellsDialog(ed) },
            { label: '在上方插入行', onClick: () => cmd.insertRows(ed, 'above') },
            { label: '在下方插入行', onClick: () => cmd.insertRows(ed, 'below') },
            { label: '在左侧插入列', onClick: () => cmd.insertCols(ed, 'left') },
            { label: '在右侧插入列', onClick: () => cmd.insertCols(ed, 'right') },
            '-',
            { label: '插入工作表', onClick: () => cmd.addSheet(ed) },
          ] },
          { type: 'dropdown', size: 'large', icon: 'trash-2', label: '删除', menu: () => [
            { label: '删除单元格...', onClick: () => dlg.deleteCellsDialog(ed) },
            { label: '删除工作表行', onClick: () => cmd.deleteRows(ed) },
            { label: '删除工作表列', onClick: () => cmd.deleteCols(ed) },
            '-',
            { label: '删除工作表', onClick: () => cmd.deleteSheet(ed, ed.si) },
          ] },
          { type: 'dropdown', size: 'large', icon: 'settings-2', label: '格式', menu: () => [
            { type: 'header', label: '单元格大小' },
            { label: '行高...', icon: 'move-vertical', onClick: () => cmd.setRowHeight(ed) },
            { label: '自动调整行高', icon: 'arrow-up-down', onClick: () => cmd.autoFitRows(ed) },
            { label: '列宽...', icon: 'move-horizontal', onClick: () => cmd.setColWidth(ed) },
            { label: '自动调整列宽', icon: 'arrow-left-right', onClick: () => cmd.autoFitCols(ed) },
            { type: 'header', label: '可见性' },
            { label: '隐藏和取消隐藏', icon: 'eye', items: [
              { label: '隐藏行', onClick: () => cmd.hideRowsCols(ed, 'r', true) },
              { label: '隐藏列', onClick: () => cmd.hideRowsCols(ed, 'c', true) },
              { label: '取消隐藏行', onClick: () => cmd.hideRowsCols(ed, 'r', false) },
              { label: '取消隐藏列', onClick: () => cmd.hideRowsCols(ed, 'c', false) },
            ] },
            { type: 'header', label: '组织工作表' },
            { label: '重命名工作表', icon: 'pencil', onClick: () => cmd.renameSheetInline(ed, ed.si, ed.tabsEl.children[ed.si]) },
            { label: '工作表标签颜色', icon: 'palette', items: ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#7030a0'].map((c) => ({ label: c, icon: h('span', { class: 'ss-swatch', style: { background: c } }), onClick: () => cmd.setTabColor(ed, ed.si, c) })).concat([{ label: '无颜色', onClick: () => cmd.setTabColor(ed, ed.si, null) }]) },
            '-',
            { label: '设置单元格格式...', icon: 'settings-2', shortcut: 'Ctrl+1', onClick: () => dlg.formatCells(ed) },
          ] },
        ] },
        { label: '编辑', items: [
          { type: 'split', size: 'large', icon: 'sigma', label: '求和', onClick: () => cmd.autoSum(ed, 'SUM'), menu: autoSumMenu },
          { type: 'col', items: [
            { type: 'dropdown', icon: 'arrow-down-to-line', label: '填充', showLabel: true, menu: () => [
              { label: '向下 (Ctrl+D)', icon: 'arrow-down', onClick: () => cmd.fillDirection(ed, 'down') },
              { label: '向右 (Ctrl+R)', icon: 'arrow-right', onClick: () => cmd.fillDirection(ed, 'right') },
            ] },
            { type: 'dropdown', icon: 'eraser', label: '清除', showLabel: true, menu: () => [
              { label: '全部清除', onClick: () => cmd.clear(ed, 'all') },
              { label: '清除格式', onClick: () => cmd.clear(ed, 'formats') },
              { label: '清除内容', onClick: () => cmd.clear(ed, 'contents') },
              { label: '清除批注', onClick: () => cmd.clear(ed, 'comments') },
              { label: '清除超链接', onClick: () => cmd.clear(ed, 'links') },
            ] },
          ] },
          { type: 'dropdown', size: 'large', icon: 'arrow-down-wide-narrow', label: '排序和筛选', menu: () => [
            { label: '升序', icon: 'arrow-up-a-z', onClick: () => cmd.quickSort(ed, true) },
            { label: '降序', icon: 'arrow-down-z-a', onClick: () => cmd.quickSort(ed, false) },
            { label: '自定义排序...', icon: 'list-filter', onClick: () => dlg.sortDialog(ed) },
            '-',
            { label: '筛选', icon: 'filter', checked: !!ed.sheet.filter, onClick: () => cmd.toggleFilter(ed) },
            { label: '清除筛选', icon: 'funnel-x', disabled: !ed.sheet.filter, onClick: () => cmd.clearAllFilters(ed) },
            { label: '重新应用', icon: 'refresh-cw', disabled: !ed.sheet.filter, onClick: () => cmd.reapplyFilter(ed) },
          ] },
          { type: 'dropdown', size: 'large', icon: 'search', label: '查找', menu: () => [
            { label: '查找...', icon: 'search', shortcut: 'Ctrl+F', onClick: () => dlg.findReplace(ed, false) },
            { label: '替换...', icon: 'replace', shortcut: 'Ctrl+H', onClick: () => dlg.findReplace(ed, true) },
            { label: '转到...', icon: 'locate', onClick: () => { ed.nameBox.focus(); } },
          ] },
        ] },
      ],
    },
    {
      id: 'insert', label: '插入', groups: [
        { label: '表格', items: [
          { type: 'dropdown', size: 'large', icon: 'table', label: '表格样式', menu: (a) => tableStyleMenu(a) },
        ] },
        { label: '插图', items: [
          { type: 'button', size: 'large', icon: 'image', label: '图片', onClick: () => ed.objects.insertImage() },
        ] },
        { label: '图表', items: [
          chartBtn(CHART_TYPES[0]), chartBtn(CHART_TYPES[3]), chartBtn(CHART_TYPES[5]),
          { type: 'col', items: [
            { ...chartBtn(CHART_TYPES[1], 'small'), showLabel: true },
            { ...chartBtn(CHART_TYPES[4], 'small'), showLabel: true },
            { ...chartBtn(CHART_TYPES[7], 'small'), showLabel: true },
          ] },
          { type: 'dropdown', size: 'large', icon: 'chart-no-axes-combined', label: '全部图表', menu: () => CHART_TYPES.map((t) => ({ label: t.label, icon: t.icon, onClick: () => ed.objects.insertChart(t.id) })) },
        ] },
        { label: '链接', items: [{ type: 'button', size: 'large', icon: 'link', label: '超链接', onClick: () => dlg.hyperlink(ed) }] },
        { label: '批注', items: [{ type: 'button', size: 'large', icon: 'message-square-plus', label: '批注', onClick: () => cmd.editComment(ed) }] },
        { label: '符号', items: [
          { type: 'dropdown', size: 'large', icon: 'omega', label: '符号', menu: (a) => symbolPicker(a, (s) => {
            if (!ed.editing) ed.beginEdit(null, 'edit');
            const el = ed.activeEditEl();
            el.setRangeText(s, el.selectionStart, el.selectionEnd, 'end');
            ed.onEditInput(el === ed.fx ? 'bar' : undefined);
          }) },
          { type: 'col', items: [
            B('calendar', '日期', () => cmd.insertNow(ed, 'date'), { showLabel: true, title: '插入当前日期 (Ctrl+;)' }),
            B('clock', '时间', () => cmd.insertNow(ed, 'time'), { showLabel: true, title: '插入当前时间 (Ctrl+Shift+;)' }),
          ] },
        ] },
        { label: '函数', items: [{ type: 'button', size: 'large', icon: 'square-function', label: '插入函数', onClick: () => dlg.insertFunction(ed) }] },
      ],
    },
    {
      id: 'layout', label: '页面布局', groups: [
        { label: '页面设置', items: [
          { type: 'dropdown', size: 'large', icon: 'rectangle-vertical', label: '纸张方向', menu: () => [
            { label: '纵向', checked: !ed.sheet.page?.landscape, onClick: () => ed.change('纸张方向', () => { ed.sheet.page = { ...(ed.sheet.page || {}), landscape: false }; }) },
            { label: '横向', checked: !!ed.sheet.page?.landscape, onClick: () => ed.change('纸张方向', () => { ed.sheet.page = { ...(ed.sheet.page || {}), landscape: true }; }) },
          ] },
          { type: 'dropdown', size: 'large', icon: 'file', label: '纸张大小', menu: () => ['A4', 'A3', 'A5', 'B5', 'Letter', 'Legal'].map((s) => ({ label: s, checked: (ed.sheet.page?.size || 'A4') === s, onClick: () => ed.change('纸张大小', () => { ed.sheet.page = { ...(ed.sheet.page || {}), size: s }; }) })) },
          { type: 'dropdown', size: 'large', icon: 'square-dashed', label: '页边距', menu: () => [['普通', 18], ['窄', 6], ['宽', 25]].map(([n, m]) => ({ label: `${n} (${m}mm)`, checked: (ed.sheet.page?.margin ?? 12) === m, onClick: () => ed.change('页边距', () => { ed.sheet.page = { ...(ed.sheet.page || {}), margin: m }; }) })) },
          { type: 'button', size: 'large', icon: 'settings', label: '页面设置', onClick: () => dlg.pageSetup(ed) },
        ] },
        { label: '打印', items: [{ type: 'button', size: 'large', icon: 'printer', label: '打印', onClick: () => cmd.printSheet(ed) }] },
        { label: '工作表选项', items: [
          { type: 'col', items: [
            { id: 'v-grid2', icon: 'grid-3x3', label: '显示网格线', showLabel: true, onClick: () => toggleView('showGrid') },
            { id: 'v-head2', icon: 'heading', label: '显示行号列标', showLabel: true, onClick: () => toggleView('showHeaders') },
          ] },
        ] },
      ],
    },
    {
      id: 'formula', label: '公式', groups: [
        { label: '函数库', items: [
          { type: 'button', size: 'large', icon: 'square-function', label: '插入函数', onClick: () => dlg.insertFunction(ed) },
          { type: 'split', size: 'large', icon: 'sigma', label: '自动求和', onClick: () => cmd.autoSum(ed, 'SUM'), menu: autoSumMenu },
          { type: 'dropdown', size: 'large', icon: 'star', label: '常用函数', menu: () => ['SUM', 'AVERAGE', 'IF', 'COUNT', 'MAX', 'MIN', 'VLOOKUP', 'SUMIF', 'COUNTIF', 'IFERROR'].map((n) => ({ label: n, onClick: () => insertFn(n) })) },
          { type: 'col', items: [
            { type: 'dropdown', icon: 'landmark', label: '财务', showLabel: true, menu: fnCatMenu('财务') },
            { type: 'dropdown', icon: 'git-branch', label: '逻辑', showLabel: true, menu: fnCatMenu('逻辑') },
            { type: 'dropdown', icon: 'type', label: '文本', showLabel: true, menu: fnCatMenu('文本') },
          ] },
          { type: 'col', items: [
            { type: 'dropdown', icon: 'calendar', label: '日期和时间', showLabel: true, menu: fnCatMenu('日期与时间') },
            { type: 'dropdown', icon: 'search', label: '查找与引用', showLabel: true, menu: fnCatMenu('查找与引用') },
            { type: 'dropdown', icon: 'calculator', label: '数学和三角', showLabel: true, menu: fnCatMenu('数学和三角') },
          ] },
          { type: 'col', items: [
            { type: 'dropdown', icon: 'chart-line', label: '统计', showLabel: true, menu: fnCatMenu('统计') },
            { type: 'dropdown', icon: 'info', label: '信息', showLabel: true, menu: fnCatMenu('信息') },
          ] },
        ] },
        { label: '公式审核', items: [
          { type: 'button', size: 'large', id: 'showf', icon: 'file-code', label: '显示公式', onClick: () => { ed.showFormulas = !ed.showFormulas; rb.setActive('showf', ed.showFormulas); ed.grid.invalidate(); } },
        ] },
        { label: '计算', items: [
          { type: 'button', size: 'large', icon: 'refresh-cw', label: '重算', title: '重新计算 (F9)', onClick: () => { ed.engine.recalc(); ed.grid.invalidate(); ed.objects.render(); ed.updateUI(); } },
        ] },
      ],
    },
    {
      id: 'data', label: '数据', groups: [
        { label: '排序和筛选', items: [
          { type: 'button', size: 'large', id: 'filter', icon: 'filter', label: '筛选', onClick: () => cmd.toggleFilter(ed) },
          { type: 'col', items: [
            B('arrow-up-a-z', '升序', () => cmd.quickSort(ed, true), { showLabel: true }),
            B('arrow-down-z-a', '降序', () => cmd.quickSort(ed, false), { showLabel: true }),
            B('list-filter', '自定义排序', () => dlg.sortDialog(ed), { showLabel: true }),
          ] },
          { type: 'col', items: [
            B('funnel-x', '清除', () => cmd.clearAllFilters(ed), { showLabel: true, title: '清除筛选' }),
            B('refresh-cw', '重新应用', () => cmd.reapplyFilter(ed), { showLabel: true }),
          ] },
        ] },
        { label: '数据工具', items: [
          { type: 'button', size: 'large', icon: 'columns-3', label: '分列', onClick: () => cmd.textToColumns(ed) },
          { type: 'button', size: 'large', icon: 'copy-x', label: '删除重复项', onClick: () => cmd.removeDuplicates(ed) },
          { type: 'button', size: 'large', icon: 'copy-check', label: '高亮重复项', onClick: () => dlg.cfRule(ed, 'dup') },
          { type: 'split', size: 'large', icon: 'shield-check', label: '有效性', onClick: () => dlg.validationDialog(ed), menu: () => [
            { label: '数据有效性...', onClick: () => dlg.validationDialog(ed) },
            { label: '清除验证', onClick: () => dlg.clearValidation(ed) },
          ] },
          { type: 'button', size: 'large', icon: 'list', label: '下拉列表', title: '为选区创建下拉列表', onClick: () => dlg.validationDialog(ed) },
        ] },
      ],
    },
    {
      id: 'review', label: '审阅', groups: [
        { label: '批注', items: [
          { type: 'button', size: 'large', icon: 'message-square-plus', label: '新建批注', onClick: () => cmd.editComment(ed) },
          { type: 'button', size: 'large', icon: 'message-square-x', label: '删除批注', onClick: () => cmd.clear(ed, 'comments') },
          { type: 'col', items: [
            B('chevron-up', '上一条', () => cmd.nextComment(ed, -1), { showLabel: true }),
            B('chevron-down', '下一条', () => cmd.nextComment(ed, 1), { showLabel: true }),
          ] },
        ] },
        { label: '校对', items: [
          { type: 'button', size: 'large', icon: 'search', label: '查找替换', onClick: () => dlg.findReplace(ed, true) },
        ] },
      ],
    },
    {
      id: 'view', label: '视图', groups: [
        { label: '显示', items: [
          { type: 'col', items: [
            { id: 'v-fbar', icon: 'square-function', label: '编辑栏', showLabel: true, onClick: () => { ed.hideFormulaBar = !ed.hideFormulaBar; ed.applyViewToggles(); sync(); } },
            { id: 'v-grid', icon: 'grid-3x3', label: '网格线', showLabel: true, onClick: () => toggleView('showGrid') },
            { id: 'v-head', icon: 'heading', label: '行号列标', showLabel: true, onClick: () => toggleView('showHeaders') },
          ] },
        ] },
        { label: '窗口', items: [
          { type: 'dropdown', size: 'large', icon: 'snowflake', label: '冻结窗格', menu: () => [
            { label: '冻结至当前单元格', onClick: () => cmd.freeze(ed, 'cell') },
            { label: '冻结首行', onClick: () => cmd.freeze(ed, 'row') },
            { label: '冻结首列', onClick: () => cmd.freeze(ed, 'col') },
            { label: '取消冻结窗格', onClick: () => cmd.freeze(ed, 'none') },
          ] },
        ] },
        { label: '显示比例', items: [
          { type: 'button', size: 'large', icon: 'zoom-in', label: '显示比例', onClick: async () => { const { promptBox } = await import('../../core/ui.js'); const v = await promptBox('显示比例', '缩放比例 (%)', String(ed.zoom), { type: 'number' }); if (v) ed.setZoom(+v); } },
          { type: 'button', size: 'large', icon: 'scan', label: '100%', onClick: () => ed.setZoom(100) },
          { type: 'button', size: 'large', icon: 'scan-search', label: '缩放到选定区域', onClick: () => zoomToSelection() },
        ] },
      ],
    },
    {
      id: 'chart', label: '图表工具', contextual: true, hidden: true, groups: [
        { label: '类型', items: [
          { type: 'dropdown', size: 'large', icon: 'chart-column', label: '更改类型', menu: () => CHART_TYPES.map((t) => ({ label: t.label, icon: t.icon, onClick: withChart((o) => ed.change('图表类型', () => { o.type = t.id; })) })) },
          { type: 'button', size: 'large', icon: 'arrow-left-right', label: '切换行列', onClick: withChart((o) => ed.change('切换行列', () => { o.byRow = !o.byRow; })) },
        ] },
        { label: '图表元素', items: [
          { type: 'button', size: 'large', icon: 'heading', label: '图表标题', onClick: withChart(async (o) => { const { promptBox } = await import('../../core/ui.js'); const t = await promptBox('图表标题', '标题', o.title || ''); if (t != null) ed.change('图表标题', () => { o.title = t; }); }) },
          { type: 'dropdown', size: 'large', icon: 'list', label: '图例', menu: () => [['top', '顶部'], ['bottom', '底部'], ['right', '右侧'], ['left', '左侧'], ['none', '无']].map(([v, l]) => ({ label: l, onClick: withChart((o) => ed.change('图例', () => { o.legend = v; })) })) },
          { type: 'dropdown', size: 'large', icon: 'palette', label: '配色', menu: () => [
            ['默认', null], ['彩色', ['#5b9bd5', '#ed7d31', '#a5a5a5', '#ffc000', '#4472c4', '#70ad47']],
            ['蓝色系', ['#1f4e79', '#2e75b6', '#5b9bd5', '#9dc3e6', '#bdd7ee', '#deebf7']], ['绿色系', ['#375623', '#548235', '#70ad47', '#a9d08e', '#c6e0b4', '#e2efda']],
            ['暖色系', ['#c00000', '#ff6b35', '#ffc000', '#f4b183', '#ff9999', '#ffd966']], ['灰度', ['#262626', '#595959', '#7f7f7f', '#a6a6a6', '#bfbfbf', '#d9d9d9']],
          ].map(([n, cols]) => ({ label: n, onClick: withChart((o) => ed.change('图表配色', () => { o.colors = cols; })) })) },
        ] },
        { label: '数据', items: [
          { type: 'button', size: 'large', icon: 'table-properties', label: '编辑图表', onClick: withChart((o) => ed.objects.editChart(o)) },
          { type: 'button', size: 'large', icon: 'image-down', label: '导出图片', onClick: withChart((o) => ed.objects.exportChart(o)) },
          { type: 'button', size: 'large', icon: 'trash-2', label: '删除图表', onClick: () => ed.objects.deleteSelected() },
        ] },
      ],
    },
  ];

  function toggleView(prop) {
    ed.change('视图', () => { ed.sheet[prop] = !ed.sheet[prop]; });
    sync();
  }
  function zoomToSelection() {
    const rg = ed.range, g = ed.grid;
    const w = g.X(Math.min(rg.c2 + 1, ed.sheet.cols)) - g.X(rg.c1), hh = g.Y(Math.min(rg.r2 + 1, ed.sheet.rows)) - g.Y(rg.r1);
    const z = Math.min((g.W - 60) / w, (g.H - 40) / hh) * 100;
    ed.setZoom(Math.max(25, Math.min(400, z)));
    g.ensureVisible(rg.r1, rg.c1);
  }

  const rb = createRibbon({ tabs, onFile: () => ed.ctx.openBackstage() });

  let lastStyle = {};
  function sync(style = lastStyle, info = {}) {
    lastStyle = style;
    rb.setValue('ff', style.ff || 'Microsoft YaHei');
    rb.setValue('fs', String(style.fs || 11));
    for (const p of ['b', 'i', 'u', 'st', 'wrap']) rb.setActive(p, !!style[p]);
    for (const a of ['left', 'center', 'right']) rb.setActive('ha-' + a, style.ha === a);
    rb.setActive('va-top', style.va === 'top');
    rb.setActive('va-middle', !style.va || style.va === 'middle');
    rb.setActive('va-bottom', style.va === 'bottom');
    rb.setActive('merge', !!info.merged);
    const nf = style.nf || 'General';
    const known = NUMBER_FORMATS.find((f) => f.fmt === nf);
    const sel = rb.get('nf');
    if (sel) {
      if (!known && ![...sel.el.options].some((o) => o.value === nf)) sel.el.append(h('option', { value: nf }, '自定义'));
      sel.el.value = nf;
    }
    rb.setActive('filter', !!ed.sheet.filter);
    rb.setActive('painter', !!ed.painter);
    rb.setActive('v-fbar', !ed.hideFormulaBar);
    rb.setActive('v-grid', ed.sheet.showGrid);
    rb.setActive('v-head', ed.sheet.showHeaders);
    rb.setActive('v-grid2', ed.sheet.showGrid);
    rb.setActive('v-head2', ed.sheet.showHeaders);
    rb.setActive('showf', ed.showFormulas);
  }
  rb.sync = sync;
  return rb;
}
