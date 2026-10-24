// 形状库：生成 SVG 路径。key 与 pptxgenjs 的 ShapeType 保持一致，便于导出。

export const SHAPES = [
  { key: 'rect', name: '矩形', group: '基本形状' },
  { key: 'roundRect', name: '圆角矩形', group: '基本形状' },
  { key: 'ellipse', name: '椭圆', group: '基本形状' },
  { key: 'triangle', name: '三角形', group: '基本形状' },
  { key: 'rtTriangle', name: '直角三角形', group: '基本形状' },
  { key: 'diamond', name: '菱形', group: '基本形状' },
  { key: 'parallelogram', name: '平行四边形', group: '基本形状' },
  { key: 'trapezoid', name: '梯形', group: '基本形状' },
  { key: 'pentagon', name: '五边形', group: '基本形状' },
  { key: 'hexagon', name: '六边形', group: '基本形状' },
  { key: 'octagon', name: '八边形', group: '基本形状' },
  { key: 'plus', name: '十字形', group: '基本形状' },
  { key: 'heart', name: '心形', group: '基本形状' },
  { key: 'can', name: '圆柱', group: '基本形状' },
  { key: 'star4', name: '四角星', group: '星与旗帜' },
  { key: 'star5', name: '五角星', group: '星与旗帜' },
  { key: 'star6', name: '六角星', group: '星与旗帜' },
  { key: 'rightArrow', name: '右箭头', group: '箭头' },
  { key: 'leftArrow', name: '左箭头', group: '箭头' },
  { key: 'upArrow', name: '上箭头', group: '箭头' },
  { key: 'downArrow', name: '下箭头', group: '箭头' },
  { key: 'leftRightArrow', name: '左右箭头', group: '箭头' },
  { key: 'chevron', name: '燕尾形', group: '箭头' },
  { key: 'homePlate', name: '五边形箭头', group: '箭头' },
  { key: 'wedgeRectCallout', name: '矩形标注', group: '标注' },
  { key: 'wedgeEllipseCallout', name: '椭圆标注', group: '标注' },
  { key: 'line', name: '直线', group: '线条' },
  { key: 'arrowLine', name: '箭头线', group: '线条' },
];

export const isLine = (k) => k === 'line' || k === 'arrowLine';

const f = (n) => Math.round(n * 100) / 100;
const pts = (arr) => 'M' + arr.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L') + ' Z';

function polygon(n, w, h, start = -90) {
  const a = [];
  for (let i = 0; i < n; i++) {
    const t = ((start + (360 / n) * i) * Math.PI) / 180;
    a.push([w / 2 + (w / 2) * Math.cos(t), h / 2 + (h / 2) * Math.sin(t)]);
  }
  return pts(a);
}
function star(n, w, h, inner) {
  const a = [];
  for (let i = 0; i < n * 2; i++) {
    const t = ((-90 + (180 / n) * i) * Math.PI) / 180;
    const r = i % 2 ? inner : 1;
    a.push([w / 2 + (w / 2) * r * Math.cos(t), h / 2 + (h / 2) * r * Math.sin(t)]);
  }
  return pts(a);
}

/** 返回形状路径 d（线条类返回 null） */
export function shapePath(key, w, h) {
  const m = Math.min(w, h);
  switch (key) {
    case 'rect': return pts([[0, 0], [w, 0], [w, h], [0, h]]);
    case 'roundRect': {
      const r = m * 0.16;
      return `M${r} 0 H${w - r} A${r} ${r} 0 0 1 ${w} ${r} V${h - r} A${r} ${r} 0 0 1 ${w - r} ${h} H${r} A${r} ${r} 0 0 1 0 ${h - r} V${r} A${r} ${r} 0 0 1 ${r} 0 Z`;
    }
    case 'ellipse': return `M0 ${h / 2} A${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2} A${w / 2} ${h / 2} 0 1 0 0 ${h / 2} Z`;
    case 'triangle': return pts([[w / 2, 0], [w, h], [0, h]]);
    case 'rtTriangle': return pts([[0, 0], [w, h], [0, h]]);
    case 'diamond': return pts([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
    case 'parallelogram': { const o = w * 0.25; return pts([[o, 0], [w, 0], [w - o, h], [0, h]]); }
    case 'trapezoid': { const o = w * 0.22; return pts([[o, 0], [w - o, 0], [w, h], [0, h]]); }
    case 'pentagon': return polygon(5, w, h);
    case 'hexagon': return pts([[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2]]);
    case 'octagon': { const o = m * 0.29; return pts([[o, 0], [w - o, 0], [w, o], [w, h - o], [w - o, h], [o, h], [0, h - o], [0, o]]); }
    case 'plus': { const tx = w * 0.3, ty = h * 0.3; return pts([[tx, 0], [w - tx, 0], [w - tx, ty], [w, ty], [w, h - ty], [w - tx, h - ty], [w - tx, h], [tx, h], [tx, h - ty], [0, h - ty], [0, ty], [tx, ty]]); }
    case 'heart': return `M${w / 2} ${h * 0.3} C${w * 0.5} ${h * 0.05} ${w * 0.05} ${-h * 0.02} ${w * 0.02} ${h * 0.32} C0 ${h * 0.55} ${w * 0.3} ${h * 0.75} ${w / 2} ${h} C${w * 0.7} ${h * 0.75} ${w} ${h * 0.55} ${w * 0.98} ${h * 0.32} C${w * 0.95} ${-h * 0.02} ${w * 0.5} ${h * 0.05} ${w / 2} ${h * 0.3} Z`;
    case 'can': { const ry = Math.min(h * 0.12, w * 0.25); return `M0 ${ry} A${w / 2} ${ry} 0 0 1 ${w} ${ry} V${h - ry} A${w / 2} ${ry} 0 0 1 0 ${h - ry} Z M0 ${ry} A${w / 2} ${ry} 0 0 0 ${w} ${ry}`; }
    case 'star4': return star(4, w, h, 0.38);
    case 'star5': return star(5, w, h, 0.4);
    case 'star6': return star(6, w, h, 0.55);
    case 'rightArrow': { const hl = Math.min(w * 0.45, h); return pts([[0, h * 0.25], [w - hl, h * 0.25], [w - hl, 0], [w, h / 2], [w - hl, h], [w - hl, h * 0.75], [0, h * 0.75]]); }
    case 'leftArrow': { const hl = Math.min(w * 0.45, h); return pts([[w, h * 0.25], [hl, h * 0.25], [hl, 0], [0, h / 2], [hl, h], [hl, h * 0.75], [w, h * 0.75]]); }
    case 'upArrow': { const hl = Math.min(h * 0.45, w); return pts([[w * 0.25, h], [w * 0.25, hl], [0, hl], [w / 2, 0], [w, hl], [w * 0.75, hl], [w * 0.75, h]]); }
    case 'downArrow': { const hl = Math.min(h * 0.45, w); return pts([[w * 0.25, 0], [w * 0.75, 0], [w * 0.75, h - hl], [w, h - hl], [w / 2, h], [0, h - hl], [w * 0.25, h - hl]]); }
    case 'leftRightArrow': { const hl = Math.min(w * 0.3, h); return pts([[0, h / 2], [hl, 0], [hl, h * 0.25], [w - hl, h * 0.25], [w - hl, 0], [w, h / 2], [w - hl, h], [w - hl, h * 0.75], [hl, h * 0.75], [hl, h]]); }
    case 'chevron': { const o = Math.min(w * 0.4, h / 2); return pts([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h], [o, h / 2]]); }
    case 'homePlate': { const o = Math.min(w * 0.4, h / 2); return pts([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h]]); }
    case 'wedgeRectCallout': return pts([[0, 0], [w, 0], [w, h * 0.78], [w * 0.42, h * 0.78], [w * 0.2, h], [w * 0.25, h * 0.78], [0, h * 0.78]]);
    case 'wedgeEllipseCallout': {
      const ry = h * 0.4, cy = h * 0.4;
      return `M${w * 0.3} ${cy + ry * 0.92} L${w * 0.18} ${h} L${w * 0.42} ${cy + ry * 0.98} A${w / 2} ${ry} 0 1 0 ${w * 0.3} ${cy + ry * 0.92} Z`;
    }
    default: return pts([[0, 0], [w, 0], [w, h], [0, h]]);
  }
}

/** 形状选择面板中的小图标 */
export function shapeIconSVG(key, size = 22) {
  const w = size, h = size;
  if (isLine(key)) {
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><line x1="2" y1="${h - 3}" x2="${w - 3}" y2="3" stroke="currentColor" stroke-width="1.6"/>${key === 'arrowLine' ? `<path d="M${w - 3} 3 l-7 1.5 l5.5 5.5 Z" fill="currentColor"/>` : ''}</svg>`;
  }
  const d = shapePath(key, w - 4, h - 4);
  return `<svg width="${w}" height="${h}" viewBox="-2 -2 ${w} ${h}"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
}
