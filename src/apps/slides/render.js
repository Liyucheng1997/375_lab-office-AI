// 渲染：把幻灯片 / 元素转成 HTML 字符串。编辑画布、缩略图、放映、打印、导出图片共用。
import { getTheme, shade } from './themes.js';
import { shapePath, isLine } from './shapes.js';
import { chartSrc } from './chart.js';
import { dims, isCoverLayout, isTextEmpty, esc } from './model.js';

export const RENDER_CSS = `
.sl-slide{position:relative;overflow:hidden;color:#000;font-family:'Microsoft YaHei',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;text-align:left}
.sl-slide *{box-sizing:border-box}
.sl-decor{position:absolute;left:0;top:0;pointer-events:none}
.sl-decor svg{display:block}
.sl-el{position:absolute}
.sl-tb{position:absolute;left:0;top:0;right:0;bottom:0;display:flex;flex-direction:column;padding:5px 10px}
.sl-txt{outline:none;overflow-wrap:break-word;word-break:normal;min-height:1em;cursor:inherit}
.sl-txt div,.sl-txt p{margin:0}
.sl-txt ul,.sl-txt ol{margin:0;padding-left:1.3em}
.sl-txt a{color:inherit;text-decoration:underline}
.sl-bul>div,.sl-bul>p{position:relative;padding-left:1.1em}
.sl-bul>div::before,.sl-bul>p::before{content:'•';position:absolute;left:0.1em}
.sl-num{counter-reset:sln}
.sl-num>div,.sl-num>p{position:relative;padding-left:1.6em;counter-increment:sln}
.sl-num>div::before,.sl-num>p::before{content:counter(sln) '.';position:absolute;left:0}
.sl-empty::before{content:attr(data-ph);color:#9aa0a6;pointer-events:none}
.sl-empty.sl-bul::before{content:'• ' attr(data-ph)}
.sl-svg{position:absolute;left:0;top:0;overflow:visible}
.sl-img{width:100%;height:100%;display:block;object-fit:fill;user-select:none;-webkit-user-drag:none}
.sl-imgph{width:100%;height:100%;border:1.5px dashed #9aa0a6;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#80868b;font-size:16px;background:rgba(127,127,127,.06);cursor:pointer}
.sl-table{width:100%;height:100%;border-collapse:collapse;table-layout:fixed}
.sl-table td{padding:4px 8px;vertical-align:middle;overflow-wrap:break-word}
.sl-cell{outline:none;min-height:1em}
.sl-cell div,.sl-cell p{margin:0}
.sl-chart{width:100%;height:100%;display:block;user-select:none;-webkit-user-drag:none}
.sl-foot{position:absolute;bottom:0;left:0;right:0;height:7%;display:flex;align-items:center;justify-content:space-between;padding:0 4%;font-size:10pt;opacity:.7;pointer-events:none}
`;

export function ensureRenderCSS() {
  if (document.getElementById('sl-render-css')) return;
  const s = document.createElement('style');
  s.id = 'sl-render-css';
  s.textContent = RENDER_CSS;
  document.head.append(s);
}

export const mediaSrc = (deck, id) => (id && deck.media ? deck.media[id] : '') || '';

export function bgCss(bg, deck) {
  if (!bg) return '#ffffff';
  if (bg.type === 'gradient') return `linear-gradient(${bg.angle ?? 135}deg, ${bg.color}, ${bg.color2})`;
  if (bg.type === 'image') return `url("${mediaSrc(deck, bg.mediaId)}") center/cover no-repeat, ${bg.color || '#fff'}`;
  return bg.color || '#ffffff';
}

export function slideBg(slide, deck) {
  return slide.bg || getTheme(deck.theme).bg;
}

/** 解析文本样式（主题继承） */
export function textProps(el, deck) {
  const th = getTheme(deck.theme);
  const s = el.style || {};
  const isTitle = el.role === 'title';
  return {
    fontFamily: s.fontFamily || (isTitle ? th.titleFont : th.bodyFont),
    fontSize: s.fontSize || 18,
    color: s.color || (el.type === 'shape' ? '#ffffff' : isTitle ? th.colors.title : th.colors.text),
    bold: !!s.bold, italic: !!s.italic, underline: !!s.underline, strike: !!s.strike,
    align: s.align || 'left',
    lineHeight: s.lineHeight || 1.3,
    valign: s.valign || 'top',
    bullet: s.bullet || null,
    effect: s.effect || null,
    vertical: !!s.vertical,
  };
}

export function shapeColors(el, deck) {
  const th = getTheme(deck.theme);
  const a = th.colors.accent[0];
  const fill = el.fill || { type: 'solid' };
  const stroke = el.stroke || {};
  return {
    fill: fill.type === 'none' ? 'none' : fill.color || a,
    fill2: fill.color2 || shade(fill.color || a, -0.35),
    stroke: stroke.color || (isLine(el.shape) ? a : shade(fill.color || a, -0.3)),
  };
}

export const WORDART = [
  { id: 'none', name: '无效果', css: '' },
  { id: 'shadow', name: '阴影', css: 'text-shadow:3px 3px 4px rgba(0,0,0,.45);' },
  { id: 'outline', name: '空心描边', css: '-webkit-text-stroke:1.5px currentColor;color:transparent !important;' },
  { id: 'glow', name: '发光', css: 'text-shadow:0 0 8px rgba(255,200,40,.95),0 0 16px rgba(255,170,0,.7);' },
  { id: 'grad-fire', name: '火焰渐变', css: 'background:linear-gradient(180deg,#fde047,#f97316,#dc2626);-webkit-background-clip:text;background-clip:text;color:transparent !important;' },
  { id: 'grad-ocean', name: '海洋渐变', css: 'background:linear-gradient(90deg,#06b6d4,#3b82f6,#8b5cf6);-webkit-background-clip:text;background-clip:text;color:transparent !important;' },
  { id: 'grad-gold', name: '金属金', css: 'background:linear-gradient(180deg,#fef3c7,#d97706 55%,#92400e);-webkit-background-clip:text;background-clip:text;color:transparent !important;text-shadow:none;' },
  { id: '3d', name: '立体', css: 'text-shadow:1px 1px 0 #999,2px 2px 0 #888,3px 3px 0 #777,4px 4px 0 #666,5px 5px 6px rgba(0,0,0,.4);' },
  { id: 'neon', name: '霓虹', css: 'color:#fff !important;text-shadow:0 0 4px #fff,0 0 10px #f0f,0 0 20px #f0f,0 0 30px #0ff;' },
];
const wordartCss = (id) => (WORDART.find((w) => w.id === id) || WORDART[0]).css;

function textBlock(el, deck, mode, extraPad) {
  const p = textProps(el, deck);
  const empty = isTextEmpty(el.html);
  const showPh = mode === 'edit' && empty && el.placeholder;
  const cls = ['sl-txt', p.bullet === 'disc' ? 'sl-bul' : p.bullet === 'decimal' ? 'sl-num' : '', showPh ? 'sl-empty' : ''].join(' ');
  const jc = p.valign === 'middle' ? 'center' : p.valign === 'bottom' ? 'flex-end' : 'flex-start';
  const style = `font-family:'${p.fontFamily}';font-size:${p.fontSize}pt;color:${p.color};line-height:${p.lineHeight};text-align:${p.align};` +
    `${p.bold ? 'font-weight:bold;' : ''}${p.italic ? 'font-style:italic;' : ''}${p.underline || p.strike ? `text-decoration:${p.underline ? 'underline ' : ''}${p.strike ? 'line-through' : ''};` : ''}` +
    wordartCss(p.effect) + (p.vertical ? 'writing-mode:vertical-rl;' : '');
  const pad = extraPad != null ? `padding:${extraPad};` : '';
  return `<div class="sl-tb" style="justify-content:${jc};${pad}"><div class="${cls}" data-ph="${esc(el.placeholder || '')}" style="${style}">${el.html || ''}</div></div>`;
}

let seq = 0;
function shapeSVG(el, deck) {
  const { w, h } = el;
  const rid = el.id + '-' + (++seq).toString(36);
  const c = shapeColors(el, deck);
  const st = el.stroke || {};
  const sw = st.width || 0;
  const dash = st.dash === 'dash' ? `stroke-dasharray="${sw * 4} ${sw * 2}"` : st.dash === 'dot' ? `stroke-dasharray="${sw} ${sw * 1.5}" stroke-linecap="round"` : '';
  const shadow = el.shadow ? 'filter:drop-shadow(3px 4px 4px rgba(0,0,0,.35));' : '';
  if (isLine(el.shape)) {
    const lw = sw || 2;
    const mid = `sl-arr-${rid}`;
    return `<svg class="sl-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="${shadow}">` +
      (el.shape === 'arrowLine' ? `<defs><marker id="${mid}" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0 0 L6 3 L0 6 Z" fill="${c.stroke}"/></marker></defs>` : '') +
      `<line x1="0" y1="${h / 2}" x2="${el.shape === 'arrowLine' ? w - lw * 3 : w}" y2="${h / 2}" stroke="${c.stroke}" stroke-width="${lw}" ${dash} ${el.shape === 'arrowLine' ? `marker-end="url(#${mid})"` : ''}/></svg>`;
  }
  const fill = el.fill || {};
  let defs = '', fillAttr = c.fill;
  if (fill.type === 'gradient') {
    const gid = `sl-g-${rid}`;
    const a = ((fill.angle ?? 90) - 90) * Math.PI / 180;
    const x2 = 50 + 50 * Math.cos(a), y2 = 50 + 50 * Math.sin(a);
    defs = `<defs><linearGradient id="${gid}" x1="${100 - x2}%" y1="${100 - y2}%" x2="${x2}%" y2="${y2}%"><stop offset="0" stop-color="${c.fill}"/><stop offset="1" stop-color="${c.fill2}"/></linearGradient></defs>`;
    fillAttr = `url(#${gid})`;
  }
  const d = shapePath(el.shape, w, h);
  return `<svg class="sl-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="${shadow}">${defs}<path d="${d}" fill="${fillAttr}" stroke="${sw ? c.stroke : 'none'}" stroke-width="${sw}" ${dash} stroke-linejoin="round"/></svg>`;
}

export function isDarkTheme(th) {
  const n = parseInt(th.colors.text.slice(1, 7), 16);
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.6;
}

export function tableColors(el, deck) {
  const th = getTheme(deck.theme);
  const ts = el.tableStyle || {};
  const base = ts.color || th.colors.accent[0];
  if (isDarkTheme(th)) return { head: shade(base, -0.25), band: shade(base, -0.72), band2: shade(base, -0.82), border: ts.border || shade(base, -0.45) };
  return { head: base, band: shade(base, 0.85), band2: shade(base, 0.93), border: ts.border || shade(base, 0.55) };
}

function tableHTML(el, deck, mode) {
  const p = textProps(el, deck);
  const ts = el.tableStyle || { header: true, banded: true };
  const col = tableColors(el, deck);
  const total = el.colW.reduce((a, b) => a + b, 0);
  const cols = el.colW.map((w) => `<col style="width:${(w / total) * 100}%">`).join('');
  const rows = el.rows.map((row, r) => {
    const isHead = ts.header && r === 0;
    const rowBg = isHead ? col.head : ts.banded ? (r % 2 ? col.band : col.band2) : 'transparent';
    return `<tr>${row.map((cell, c) => {
      const bg = cell.fill || rowBg;
      const color = isHead ? '#ffffff' : p.color;
      return `<td data-r="${r}" data-c="${c}" style="background:${bg};color:${color};border:1px solid ${col.border};${isHead ? 'font-weight:bold;' : ''}text-align:${cell.align || 'left'}"><div class="sl-cell">${cell.html || ''}</div></td>`;
    }).join('')}</tr>`;
  }).join('');
  return `<table class="sl-table" style="font-family:'${p.fontFamily}';font-size:${p.fontSize}pt;line-height:${p.lineHeight}"><colgroup>${cols}</colgroup>${rows}</table>`;
}

export function chartColorsFor(deck) {
  const th = getTheme(deck.theme);
  return { colors: th.colors.accent, text: th.colors.text };
}

export function elementHTML(el, deck, mode = 'edit') {
  const empty = (el.type === 'text' && isTextEmpty(el.html)) || (el.type === 'image' && !el.mediaId);
  if (mode !== 'edit' && el.placeholder && empty) return '';
  let inner = '';
  switch (el.type) {
    case 'text': inner = textBlock(el, deck, mode); break;
    case 'shape':
      inner = shapeSVG(el, deck) + (isLine(el.shape) ? '' : textBlock(el, deck, mode, el.shape === 'wedgeRectCallout' ? '5px 10px 22% 10px' : null));
      break;
    case 'image': {
      if (!el.mediaId) {
        inner = mode === 'edit'
          ? `<div class="sl-imgph" data-action="pick-image"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg><span>${esc(el.placeholder || '单击添加图片')}</span></div>`
          : '';
      } else {
        const b = el.border && el.border.width ? `border:${el.border.width}px solid ${el.border.color || '#000'};` : '';
        const r = el.radius ? `border-radius:${el.radius}px;` : '';
        const sh = el.shadow ? 'box-shadow:4px 5px 10px rgba(0,0,0,.35);' : '';
        const fl = el.flipH || el.flipV ? `transform:scale(${el.flipH ? -1 : 1},${el.flipV ? -1 : 1});` : '';
        const filt = el.filter ? `filter:${el.filter};` : '';
        inner = `<img class="sl-img" draggable="false" src="${mediaSrc(deck, el.mediaId)}" style="${b}${r}${sh}${fl}${filt}object-fit:${el.fit || 'fill'}">`;
      }
      break;
    }
    case 'table': inner = tableHTML(el, deck, mode); break;
    case 'chart': {
      const cc = chartColorsFor(deck);
      inner = `<img class="sl-chart" draggable="false" src="${chartSrc(el, cc.colors, cc.text)}">`;
      break;
    }
  }
  const tr = el.rot ? `transform:rotate(${el.rot}deg);` : '';
  const op = el.opacity != null && el.opacity < 1 ? `opacity:${el.opacity};` : '';
  return `<div class="sl-el sl-t-${el.type}" data-id="${el.id}" style="left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;${tr}${op}">${inner}</div>`;
}

function footerHTML(slide, deck, index) {
  const f = deck.footer || {};
  if (!(f.showNumber || f.showDate || f.text)) return '';
  if (f.notOnTitle && slide.layout === 'title') return '';
  const th = getTheme(deck.theme);
  const date = f.showDate ? (f.dateText || new Date().toLocaleDateString('zh-CN')) : '';
  return `<div class="sl-foot" style="color:${th.colors.text};font-family:'${th.bodyFont}'"><span>${esc(date)}</span><span>${esc(f.text || '')}</span><span>${f.showNumber ? index + 1 : ''}</span></div>`;
}

export function slideHTML(slide, deck, { mode = 'edit', index = 0, elements = true } = {}) {
  const { w, h } = dims(deck);
  const th = getTheme(deck.theme);
  const bg = slideBg(slide, deck);
  const decor = slide.bg ? '' : th.decor(w, h, isCoverLayout(slide.layout));
  const els = elements ? slide.elements.map((e) => elementHTML(e, deck, mode)).join('') : '';
  return `<div class="sl-slide" style="width:${w}px;height:${h}px;background:${bgCss(bg, deck)}">${decor ? `<div class="sl-decor">${decor}</div>` : ''}${els}${footerHTML(slide, deck, index)}</div>`;
}

/** 创建一个按比例缩放到 targetW 宽度的幻灯片 DOM（缩略图用） */
export function slideThumb(slide, deck, targetW, index = 0) {
  const { w, h } = dims(deck);
  const s = targetW / w;
  const outer = document.createElement('div');
  outer.className = 'sl-thumb-box';
  outer.style.cssText = `width:${targetW}px;height:${Math.round(h * s)}px;position:relative;overflow:hidden`;
  outer.innerHTML = slideHTML(slide, deck, { mode: 'thumb', index });
  const inner = outer.firstElementChild;
  inner.style.transform = `scale(${s})`;
  inner.style.transformOrigin = '0 0';
  inner.style.pointerEvents = 'none';
  return outer;
}
