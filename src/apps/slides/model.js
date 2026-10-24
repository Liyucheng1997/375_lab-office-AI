// 数据模型：演示文稿 / 幻灯片 / 元素 / 版式。
// deck: { version, size:'16:9'|'4:3', theme, slides:[], media:{id:dataURL}, footer:{...} }
// slide: { id, layout, elements:[], bg:null|{type,color,color2,angle,mediaId}, notes, transition:{type,duration}, animations:[], hidden }
// element 公共字段: { id, type:'text'|'shape'|'image'|'table'|'chart', x, y, w, h, rot, opacity, locked, groupId, link }
//   文本/形状: html, role:'title'|'subtitle'|'body'|null, placeholder:'提示文字'|null, style:{ fontFamily, fontSize(pt), color, bold, align, lineHeight, valign, bullet:'disc'|'decimal'|null, effect }
//   形状: shape, fill:{type:'solid'|'gradient'|'none', color, color2, angle}, stroke:{color, width, dash}, shadow
//   图片: mediaId, border:{color,width}, radius
//   表格: rows:[[{html, fill}]], colW:[比例], tableStyle:{header, banded, color}
//   图表: chartType, data:{labels:[], series:[{name, values:[]}]}, chartTitle, legend

export const SIZES = { '16:9': { w: 960, h: 540 }, '4:3': { w: 960, h: 720 } };
export const dims = (deck) => SIZES[deck.size] || SIZES['16:9'];

export const uid = () => Math.random().toString(36).slice(2, 10);

export const LAYOUTS = [
  { id: 'title', name: '标题幻灯片' },
  { id: 'titleContent', name: '标题和内容' },
  { id: 'section', name: '节标题' },
  { id: 'twoContent', name: '两栏内容' },
  { id: 'comparison', name: '比较' },
  { id: 'titleOnly', name: '仅标题' },
  { id: 'blank', name: '空白' },
  { id: 'pictureTitle', name: '图片与标题' },
];
export const isCoverLayout = (l) => l === 'title' || l === 'section';

export function baseEl(type, props = {}) {
  return { id: uid(), type, x: 100, y: 100, w: 300, h: 80, rot: 0, opacity: 1, locked: false, ...props };
}

export function textEl(props = {}) {
  const { style, ...rest } = props;
  return baseEl('text', { html: '', role: null, placeholder: null, autoFit: true, ...rest, style: { fontSize: 18, align: 'left', lineHeight: 1.3, valign: 'top', ...(style || {}) } });
}

export function shapeEl(shape, props = {}) {
  const { style, ...rest } = props;
  const line = shape === 'line' || shape === 'arrowLine';
  return baseEl('shape', {
    shape, html: '', w: line ? 200 : 160, h: line ? 20 : 120,
    fill: line ? { type: 'none' } : { type: 'solid', color: null },
    stroke: line ? { color: null, width: 2.5, dash: 'solid' } : { color: null, width: 0, dash: 'solid' },
    shadow: false,
    ...rest,
    style: { fontSize: 18, align: 'center', valign: 'middle', lineHeight: 1.2, color: '#ffffff', ...(style || {}) },
  });
}

const ph = (role, prompt, box, style) => textEl({ role, placeholder: prompt, ...box, style });

/** 生成某版式的占位元素 */
export function layoutElements(layout, W, H) {
  const r = (x, y, w, h) => ({ x: Math.round(W * x), y: Math.round(H * y), w: Math.round(W * w), h: Math.round(H * h) });
  const title = (box, extra = {}) => ph('title', '单击此处添加标题', box, { fontSize: 32, bold: true, valign: 'middle', lineHeight: 1.15, ...extra });
  const body = (box, extra = {}) => ph('body', '单击此处添加文本', box, { fontSize: 20, bullet: 'disc', lineHeight: 1.5, ...extra });
  switch (layout) {
    case 'title':
      return [
        title(r(0.1, 0.28, 0.8, 0.24), { fontSize: 44, align: 'center', valign: 'bottom' }),
        ph('subtitle', '单击此处添加副标题', r(0.15, 0.56, 0.7, 0.14), { fontSize: 20, align: 'center', valign: 'top' }),
      ];
    case 'titleContent':
      return [title(r(0.06, 0.04, 0.88, 0.15)), body(r(0.06, 0.23, 0.88, 0.68))];
    case 'section':
      return [
        title(r(0.1, 0.34, 0.8, 0.2), { fontSize: 40, valign: 'bottom' }),
        ph('subtitle', '单击此处添加文本', r(0.1, 0.56, 0.8, 0.12), { fontSize: 18, valign: 'top' }),
      ];
    case 'twoContent':
      return [title(r(0.06, 0.04, 0.88, 0.15)), body(r(0.06, 0.23, 0.43, 0.68)), body(r(0.51, 0.23, 0.43, 0.68))];
    case 'comparison':
      return [
        title(r(0.06, 0.04, 0.88, 0.15)),
        ph('body', '单击此处添加标题', r(0.06, 0.22, 0.43, 0.1), { fontSize: 22, bold: true, valign: 'bottom' }),
        body(r(0.06, 0.33, 0.43, 0.58), { fontSize: 18 }),
        ph('body', '单击此处添加标题', r(0.51, 0.22, 0.43, 0.1), { fontSize: 22, bold: true, valign: 'bottom' }),
        body(r(0.51, 0.33, 0.43, 0.58), { fontSize: 18 }),
      ];
    case 'titleOnly':
      return [title(r(0.06, 0.04, 0.88, 0.15))];
    case 'pictureTitle':
      return [
        baseEl('image', { ...r(0.05, 0.1, 0.47, 0.8), mediaId: null, placeholder: '单击图标添加图片', border: null, radius: 0 }),
        title(r(0.56, 0.1, 0.39, 0.2), { fontSize: 28, valign: 'bottom' }),
        ph('body', '单击此处添加文本', r(0.56, 0.33, 0.39, 0.55), { fontSize: 16, lineHeight: 1.5 }),
      ];
    default:
      return [];
  }
}

export function newSlide(layout, deck) {
  const { w, h } = dims(deck);
  return { id: uid(), layout, elements: layoutElements(layout, w, h), bg: null, notes: '', transition: { type: 'none', duration: 0.7 }, animations: [], hidden: false };
}

export function newDeck(theme = 'office', size = '16:9') {
  return { version: 1, size, theme, slides: [], media: {}, footer: { showNumber: false, showDate: false, text: '', notOnTitle: true } };
}

/** 文本转安全 HTML（多行 -> 每行一个 div） */
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function linesToHtml(lines) {
  if (typeof lines === 'string') lines = lines.split('\n');
  return lines.map((l) => `<div>${l ? esc(l) : '<br>'}</div>`).join('');
}

export function isTextEmpty(html) {
  if (!html) return true;
  const d = document.createElement('div');
  d.innerHTML = html;
  return !d.textContent.trim() && !d.querySelector('img');
}

/** 设置占位符内容的辅助函数（模板用） */
export function fill(slide, role, lines, nth = 0) {
  const els = slide.elements.filter((e) => e.role === role);
  const el = els[nth];
  if (el) el.html = linesToHtml(lines);
  return el;
}

export function cloneEl(el, dx = 0, dy = 0) {
  const c = structuredClone(el);
  c.id = uid();
  c.x += dx;
  c.y += dy;
  return c;
}

export function cloneSlide(slide) {
  const s = structuredClone(slide);
  s.id = uid();
  const map = {};
  s.elements.forEach((e) => { const n = uid(); map[e.id] = n; e.id = n; });
  const gmap = {};
  s.elements.forEach((e) => { if (e.groupId) e.groupId = gmap[e.groupId] || (gmap[e.groupId] = uid()); });
  s.animations = (s.animations || []).filter((a) => map[a.elId]).map((a) => ({ ...a, id: uid(), elId: map[a.elId] }));
  return s;
}

export const elementLabel = (el) => {
  const txt = (el.html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const kind = { text: '文本框', shape: '形状', image: '图片', table: '表格', chart: '图表' }[el.type] || '对象';
  if (el.role === 'title') return '标题: ' + (txt || '(空)');
  return txt ? `${kind}: ${txt.slice(0, 16)}` : kind;
};

export function tableEl(rows, cols, props = {}) {
  const data = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ html: '' })));
  return baseEl('table', { x: 100, y: 140, w: Math.min(760, cols * 150), h: rows * 40, rows: data, colW: Array(cols).fill(1), tableStyle: { header: true, banded: true, color: null }, style: { fontSize: 14, lineHeight: 1.3 }, ...props });
}

export function tableFrom(matrix, props = {}) {
  const t = tableEl(matrix.length, matrix[0].length, props);
  t.rows = matrix.map((r) => r.map((c) => ({ html: esc(String(c)) })));
  return t;
}

export function chartEl(props = {}) {
  return baseEl('chart', { x: 180, y: 120, w: 600, h: 360, chartType: 'bar', data: null, chartTitle: '', legend: true, ...props });
}
