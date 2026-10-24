// 导入导出：PPTX 导出(pptxgenjs)、PPTX 导入(JSZip 解析)、打印/PDF、PNG 图片。
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { printHTML, download } from '../../core/ui.js';
import { dims, newDeck, uid, baseEl, textEl, shapeEl, esc, isCoverLayout } from './model.js';
import { slideHTML, RENDER_CSS, textProps, shapeColors, tableColors, mediaSrc, slideBg, chartColorsFor } from './render.js';
import { getTheme } from './themes.js';
import { SHAPES, isLine } from './shapes.js';
import { defaultChartData } from './chart.js';

/* ---------------- 栅格化（SVG foreignObject） ---------------- */

export async function htmlToPng(html, w, h, scale = 2, type = 'image/png') {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const xhtml = new XMLSerializer().serializeToString(holder.firstElementChild);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}"><foreignObject x="0" y="0" width="${w * scale}" height="${h * scale}"><div xmlns="http://www.w3.org/1999/xhtml" style="transform:scale(${scale});transform-origin:0 0;width:${w}px;height:${h}px"><style>${RENDER_CSS}</style>${xhtml}</div></foreignObject></svg>`;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png');
}

export async function slideToPng(slide, deck, index, scale = 2) {
  const { w, h } = dims(deck);
  return htmlToPng(slideHTML(slide, deck, { mode: 'show', index }), w, h, scale);
}

export async function exportPng(deck, index, name) {
  const url = await slideToPng(deck.slides[index], deck, index, 2);
  download(url, `${name}-第${index + 1}张.png`);
}

/* ---------------- 打印 / PDF ---------------- */

export function printDeck(deck, name, { notes = false } = {}) {
  const { w, h } = dims(deck);
  const slides = deck.slides.map((s, i) => [s, i]).filter(([s]) => !s.hidden);
  if (!notes) {
    const pages = slides.map(([s, i]) => `<div class="pg">${slideHTML(s, deck, { mode: 'show', index: i })}</div>`).join('');
    const css = RENDER_CSS + `@page{size:${w / 96}in ${h / 96}in;margin:0}html,body{margin:0;padding:0}.pg{width:${w}px;height:${h}px;overflow:hidden;break-after:page;page-break-after:always}.pg:last-child{break-after:auto;page-break-after:auto}`;
    printHTML(pages, css, name);
    return;
  }
  const sc = 640 / w;
  const pages = slides.map(([s, i]) => `<div class="pg"><div class="num">第 ${i + 1} 张</div><div class="sw" style="width:${w * sc}px;height:${h * sc}px"><div style="transform:scale(${sc});transform-origin:0 0">${slideHTML(s, deck, { mode: 'show', index: i })}</div></div><div class="notes">${esc(s.notes || '').replace(/\n/g, '<br>') || '<span style="color:#999">（无备注）</span>'}</div></div>`).join('');
  const css = RENDER_CSS + `@page{size:A4 portrait;margin:14mm}body{margin:0;font-family:'Microsoft YaHei',sans-serif}.pg{break-after:page;page-break-after:always}.pg:last-child{break-after:auto}.num{color:#666;font-size:12px;margin-bottom:6px}.sw{overflow:hidden;border:1px solid #ccc;margin:0 auto}.notes{margin-top:18px;font-size:14px;line-height:1.8;white-space:normal}`;
  printHTML(pages, css, name);
}

/* ---------------- PPTX 导出 ---------------- */

const IN = (px) => +(px / 96).toFixed(4);
function hex(c, fallback = '000000') {
  if (!c || c === 'transparent' || c === 'none') return fallback;
  if (c.startsWith('#')) {
    let x = c.slice(1);
    if (x.length === 3) x = x.split('').map((ch) => ch + ch).join('');
    return x.slice(0, 6).toUpperCase();
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(',').map((v) => parseInt(v, 10));
    return [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return fallback;
}

function parseSize(v) {
  if (!v) return null;
  const n = parseFloat(v);
  if (v.endsWith('pt')) return n;
  if (v.endsWith('px')) return n * 0.75;
  return null;
}

/** HTML -> pptxgenjs 文本运行数组 */
function htmlToRuns(html, base) {
  const holder = document.createElement('div');
  holder.innerHTML = html || '';
  const paras = [];
  let cur = [];
  const pushPara = (align) => { paras.push({ runs: cur, align }); cur = []; };
  const BLOCK = /^(DIV|P|LI|H\d|UL|OL|BLOCKQUOTE)$/;
  const walk = (node, fmt) => {
    if (node.nodeType === 3) {
      const t = node.textContent.replace(/ /g, ' ');
      if (t) cur.push({ text: t, options: { ...fmt } });
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.tagName === 'BR') { cur.push({ text: '', options: { ...fmt, softBreakBefore: false }, br: true }); return; }
    const f = { ...fmt };
    const st = node.style || {};
    if (/^(B|STRONG)$/.test(node.tagName) || st.fontWeight === 'bold' || +st.fontWeight >= 600) f.bold = true;
    if (/^(I|EM)$/.test(node.tagName) || st.fontStyle === 'italic') f.italic = true;
    if (node.tagName === 'U' || (st.textDecoration || st.textDecorationLine || '').includes('underline')) f.underline = { style: 'sng' };
    if (/^(S|STRIKE|DEL)$/.test(node.tagName) || (st.textDecoration || st.textDecorationLine || '').includes('line-through')) f.strike = 'sngStrike';
    if (st.color) f.color = hex(st.color);
    if (node.tagName === 'FONT' && node.getAttribute('color')) f.color = hex(node.getAttribute('color'));
    if (st.fontSize) { const s = parseSize(st.fontSize); if (s) f.fontSize = s; }
    if (st.fontFamily) f.fontFace = st.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    if (st.backgroundColor) f.highlight = hex(st.backgroundColor);
    if (node.tagName === 'SUP') f.superscript = true;
    if (node.tagName === 'SUB') f.subscript = true;
    if (node.tagName === 'A' && node.getAttribute('href')) f.hyperlink = { url: node.getAttribute('href') };
    const block = BLOCK.test(node.tagName) && node !== holder;
    if (block && cur.length) pushPara(fmt._align);
    if (block && st.textAlign) f._align = st.textAlign;
    node.childNodes.forEach((c) => walk(c, f));
    if (block) pushPara(f._align);
  };
  walk(holder, {});
  if (cur.length) pushPara();
  const out = [];
  const realParas = paras.filter((p, i) => p.runs.length || i < paras.length - 1);
  realParas.forEach((p, pi) => {
    const runs = p.runs.length ? p.runs : [{ text: '', options: {} }];
    runs.forEach((r, ri) => {
      const o = { ...r.options };
      delete o._align;
      delete o.softBreakBefore;
      if (p.align) o.align = p.align === 'justify' ? 'justify' : p.align === 'center' ? 'center' : p.align === 'right' ? 'right' : 'left';
      if (base.bullet === 'disc') o.bullet = true;
      if (base.bullet === 'decimal') o.bullet = { type: 'number' };
      if (r.br) { o.breakLine = true; out.push({ text: '', options: o }); return; }
      if (ri === runs.length - 1 && pi < realParas.length - 1) o.breakLine = true;
      out.push({ text: r.text, options: o });
    });
  });
  return out.length ? out : [{ text: '', options: {} }];
}

function textOpts(el, deck) {
  const p = textProps(el, deck);
  return {
    x: IN(el.x), y: IN(el.y), w: IN(el.w), h: IN(el.h),
    rotate: el.rot || 0,
    fontFace: p.fontFamily, fontSize: p.fontSize, color: hex(p.color),
    bold: p.bold, italic: p.italic, underline: p.underline ? { style: 'sng' } : undefined, strike: p.strike ? 'sngStrike' : undefined,
    align: p.align === 'justify' ? 'justify' : p.align, valign: p.valign === 'middle' ? 'middle' : p.valign,
    lineSpacingMultiple: p.lineHeight, margin: [3, 7, 3, 7], fit: 'none',
    transparency: el.opacity < 1 ? Math.round((1 - el.opacity) * 100) : undefined,
  };
}

const CHART_MAP = { bar: 'bar', hbar: 'bar', line: 'line', area: 'area', pie: 'pie', doughnut: 'doughnut', radar: 'radar' };

export async function exportPptx(deck, name, { blob = false } = {}) {
  const pptx = new PptxGenJS();
  const { w, h } = dims(deck);
  pptx.defineLayout({ name: 'DECK', width: w / 96, height: h / 96 });
  pptx.layout = 'DECK';
  pptx.title = name;
  const th = getTheme(deck.theme);
  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i];
    const s = pptx.addSlide();
    if (slide.hidden) s.hidden = true;
    const bg = slideBg(slide, deck);
    const hasDecor = !slide.bg && th.decor(w, h, isCoverLayout(slide.layout));
    if (hasDecor || bg.type === 'gradient') {
      try {
        const png = await htmlToPng(slideHTML(slide, deck, { mode: 'show', index: i, elements: false }), w, h, 1.5, 'image/jpeg');
        s.background = { data: png };
      } catch (e) { s.background = { color: hex(bg.color, 'FFFFFF') }; }
    } else if (bg.type === 'image' && mediaSrc(deck, bg.mediaId)) s.background = { data: mediaSrc(deck, bg.mediaId) };
    else s.background = { color: hex(bg.color, 'FFFFFF') };

    for (const el of slide.elements) {
      try { addElement(pptx, s, el, deck); } catch (e) { console.warn('导出元素失败', el, e); }
    }
    if (slide.notes) s.addNotes(slide.notes);
  }
  if (blob) return pptx.write({ outputType: 'blob' });
  await pptx.writeFile({ fileName: name + '.pptx' });
}

function addElement(pptx, s, el, deck) {
  const box = { x: IN(el.x), y: IN(el.y), w: IN(el.w), h: IN(el.h), rotate: el.rot || 0 };
  if (el.type === 'text') {
    if (el.placeholder && !(el.html || '').replace(/<[^>]+>/g, '').trim()) return;
    s.addText(htmlToRuns(el.html, textProps(el, deck)), textOpts(el, deck));
  } else if (el.type === 'shape') {
    const c = shapeColors(el, deck);
    const st = el.stroke || {};
    const line = { color: hex(c.stroke), width: (st.width || 0) * 0.75, dashType: st.dash === 'dash' ? 'dash' : st.dash === 'dot' ? 'sysDot' : 'solid' };
    if (isLine(el.shape)) {
      const lw = st.width || 2;
      s.addShape(pptx.ShapeType.line, { x: box.x, y: IN(el.y + el.h / 2), w: box.w, h: 0, rotate: box.rotate, line: { ...line, width: lw * 0.75, endArrowType: el.shape === 'arrowLine' ? 'triangle' : undefined } });
      return;
    }
    const fill = el.fill && el.fill.type === 'none' ? { type: 'none' } : { color: hex(c.fill) };
    if (el.opacity < 1 && fill.color) fill.transparency = Math.round((1 - el.opacity) * 100);
    const shapeType = pptx.ShapeType[el.shape] || pptx.ShapeType.rect;
    const opts = { ...textOpts(el, deck), shape: shapeType, fill, line: st.width ? line : { type: 'none' } };
    if (el.shadow) opts.shadow = { type: 'outer', blur: 4, offset: 3, angle: 45, color: '000000', opacity: 0.35 };
    if (el.shape === 'roundRect') opts.rectRadius = Math.min(el.w, el.h) * 0.16 / 96;
    s.addText((el.html || '').replace(/<[^>]+>/g, '').trim() ? htmlToRuns(el.html, textProps(el, deck)) : '', opts);
  } else if (el.type === 'image') {
    const src = mediaSrc(deck, el.mediaId);
    if (!src) return;
    const o = { data: src, ...box };
    if (el.flipH) o.flipH = true;
    if (el.flipV) o.flipV = true;
    s.addImage(o);
  } else if (el.type === 'table') {
    const p = textProps(el, deck);
    const col = tableColors(el, deck);
    const ts = el.tableStyle || {};
    const total = el.colW.reduce((a, b) => a + b, 0);
    const rows = el.rows.map((row, r) => row.map((cell) => {
      const head = ts.header && r === 0;
      const bg = cell.fill || (head ? col.head : ts.banded ? (r % 2 ? col.band : col.band2) : null);
      const txt = (() => { const d = document.createElement('div'); d.innerHTML = (cell.html || '').replace(/<\/(div|p)>/g, '\n</$1>').replace(/<br\s*\/?>/g, '\n'); return d.textContent.replace(/\n+$/, ''); })();
      return { text: txt, options: { fill: bg ? { color: hex(bg) } : undefined, color: head ? 'FFFFFF' : hex(p.color), bold: head, align: cell.align || 'left', valign: 'middle' } };
    }));
    s.addTable(rows, { x: box.x, y: box.y, w: box.w, colW: el.colW.map((cw) => +(IN(el.w) * cw / total).toFixed(3)), rowH: IN(el.h / el.rows.length), fontSize: p.fontSize, fontFace: p.fontFamily, border: { type: 'solid', pt: 0.75, color: hex(col.border) }, margin: 0.05 });
  } else if (el.type === 'chart') {
    const d = el.data || defaultChartData();
    const t = el.chartType || 'bar';
    const cc = chartColorsFor(deck);
    const data = (t === 'pie' || t === 'doughnut' ? d.series.slice(0, 1) : d.series).map((sr) => ({ name: sr.name, labels: d.labels, values: sr.values.map(Number) }));
    s.addChart(pptx.ChartType[CHART_MAP[t]] || pptx.ChartType.bar, data, {
      ...box, barDir: t === 'hbar' ? 'bar' : 'col', showLegend: el.legend !== false, legendPos: 'b',
      showTitle: !!el.chartTitle, title: el.chartTitle || undefined, chartColors: cc.colors.map((c) => hex(c)),
      catAxisLabelColor: hex(cc.text), valAxisLabelColor: hex(cc.text), legendColor: hex(cc.text),
    });
  }
}

/* ---------------- PPTX 导入 ---------------- */

const EMU = 914400;
const PRST = new Set(SHAPES.map((s) => s.key));
const firstTag = (el, name) => (el ? el.getElementsByTagName(name)[0] : null);
const kids = (el, name) => (el ? [...el.children].filter((c) => c.tagName === name) : []);
const kid = (el, name) => kids(el, name)[0] || null;

function schemeColor(val) {
  const map = { accent1: '#4472c4', accent2: '#ed7d31', accent3: '#a5a5a5', accent4: '#ffc000', accent5: '#5b9bd5', accent6: '#70ad47', dk1: '#000000', tx1: '#000000', lt1: '#ffffff', bg1: '#ffffff', dk2: '#44546a', tx2: '#44546a', lt2: '#e7e6e6', bg2: '#e7e6e6', hlink: '#0563c1' };
  return map[val] || null;
}
function colorOf(fillParent) {
  if (!fillParent) return null;
  const solid = kid(fillParent, 'a:solidFill') || (fillParent.tagName === 'a:solidFill' ? fillParent : null);
  if (!solid) return null;
  const srgb = kid(solid, 'a:srgbClr');
  if (srgb) return '#' + srgb.getAttribute('val');
  const sch = kid(solid, 'a:schemeClr');
  if (sch) return schemeColor(sch.getAttribute('val'));
  const sys = kid(solid, 'a:sysClr');
  if (sys) return '#' + (sys.getAttribute('lastClr') || '000000');
  return null;
}

export async function importPptx(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const parser = new DOMParser();
  const xml = async (p) => { const f = zip.file(p); return f ? parser.parseFromString(await f.async('string'), 'application/xml') : null; };
  const relsOf = async (path) => {
    const dir = path.slice(0, path.lastIndexOf('/'));
    const name = path.slice(path.lastIndexOf('/') + 1);
    const doc = await xml(`${dir}/_rels/${name}.rels`);
    const map = {};
    if (doc) for (const r of doc.getElementsByTagName('Relationship')) map[r.getAttribute('Id')] = { target: resolvePath(dir, r.getAttribute('Target')), type: r.getAttribute('Type') || '', external: r.getAttribute('TargetMode') === 'External', raw: r.getAttribute('Target') };
    return map;
  };
  const pres = await xml('ppt/presentation.xml');
  if (!pres) throw new Error('不是有效的 PPTX 文件');
  const sz = firstTag(pres, 'p:sldSz');
  const cx = +(sz?.getAttribute('cx') || 12192000), cy = +(sz?.getAttribute('cy') || 6858000);
  const deck = newDeck('office', cy / cx < 0.66 ? '16:9' : '4:3');
  const { w: W, h: H } = dims(deck);
  const sx = W / cx, sy = H / cy;
  const presRels = await relsOf('ppt/presentation.xml');
  const ids = [...pres.getElementsByTagName('p:sldId')].map((n) => n.getAttribute('r:id'));

  const layoutCache = {};
  async function phMap(path) {
    if (layoutCache[path]) return layoutCache[path];
    const doc = await xml(path);
    const map = {};
    if (doc) for (const sp of doc.getElementsByTagName('p:sp')) {
      const ph = firstTag(sp, 'p:ph');
      const xf = firstTag(firstTag(sp, 'p:spPr'), 'a:xfrm');
      if (!ph || !xf) continue;
      const box = xfrmBox(xf);
      const sz = firstTag(firstTag(sp, 'a:lstStyle'), 'a:defRPr')?.getAttribute('sz');
      const rec = { box, sz: sz ? +sz / 100 : null };
      const type = ph.getAttribute('type') || 'body';
      map['t:' + type] = map['t:' + type] || rec;
      if (ph.getAttribute('idx')) map['i:' + ph.getAttribute('idx')] = rec;
    }
    const bgColor = colorOf(firstTag(firstTag(doc, 'p:bg'), 'p:bgPr'));
    layoutCache[path] = { map, bgColor, doc };
    return layoutCache[path];
  }
  function xfrmBox(xf) {
    const off = kid(xf, 'a:off'), ext = kid(xf, 'a:ext');
    return {
      x: (+off?.getAttribute('x') || 0) * sx, y: (+off?.getAttribute('y') || 0) * sy,
      w: (+ext?.getAttribute('cx') || 0) * sx, h: (+ext?.getAttribute('cy') || 0) * sy,
      rot: (+xf.getAttribute('rot') || 0) / 60000,
    };
  }
  async function media(rels, rid) {
    const r = rels[rid];
    if (!r || r.external) return null;
    const f = zip.file(r.target);
    if (!f) return null;
    const ext = r.target.split('.').pop().toLowerCase();
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', webp: 'image/webp' }[ext];
    if (!mime) return null;
    const id = uid();
    deck.media[id] = `data:${mime};base64,` + (await f.async('base64'));
    return id;
  }

  function txBodyToHtml(tx) {
    const sizes = {};
    let html = '';
    let firstAlign = null, bullet = null;
    for (const p of kids(tx, 'a:p')) {
      const pPr = kid(p, 'a:pPr');
      const algn = pPr?.getAttribute('algn');
      const align = { ctr: 'center', r: 'right', just: 'justify', l: 'left' }[algn] || null;
      if (firstAlign == null && align) firstAlign = align;
      if (pPr && kid(pPr, 'a:buAutoNum')) bullet = 'decimal';
      else if (pPr && kid(pPr, 'a:buChar') && !bullet) bullet = 'disc';
      let inner = '';
      for (const r of [...p.children]) {
        if (r.tagName === 'a:br') { inner += '<br>'; continue; }
        if (r.tagName !== 'a:r' && r.tagName !== 'a:fld') continue;
        const t = kid(r, 'a:t')?.textContent || '';
        if (!t) continue;
        const rPr = kid(r, 'a:rPr');
        let st = '';
        if (rPr) {
          const s = rPr.getAttribute('sz');
          if (s) { st += `font-size:${+s / 100}pt;`; sizes[+s / 100] = (sizes[+s / 100] || 0) + t.length; }
          if (rPr.getAttribute('b') === '1') st += 'font-weight:bold;';
          if (rPr.getAttribute('i') === '1') st += 'font-style:italic;';
          const u = rPr.getAttribute('u');
          if (u && u !== 'none') st += 'text-decoration:underline;';
          const c = colorOf(rPr);
          if (c) st += `color:${c};`;
          const latin = kid(rPr, 'a:ea') || kid(rPr, 'a:latin');
          const face = latin?.getAttribute('typeface');
          if (face && !face.startsWith('+')) st += `font-family:'${face}';`;
        }
        inner += st ? `<span style="${st}">${esc(t)}</span>` : esc(t);
      }
      html += `<div${align && align !== firstAlign ? ` style="text-align:${align}"` : ''}>${inner || '<br>'}</div>`;
    }
    const main = Object.entries(sizes).sort((a, b) => b[1] - a[1])[0];
    return { html, align: firstAlign, bullet, mainSize: main ? +main[0] : null };
  }

  async function shapesFrom(container, rels, layout, out, group) {
    for (const node of [...container.children]) {
      const tag = node.tagName;
      if (tag === 'p:grpSp') {
        const xf = firstTag(kid(node, 'p:grpSpPr'), 'a:xfrm');
        let g = group;
        if (xf) {
          const off = kid(xf, 'a:off'), ext = kid(xf, 'a:ext'), choff = kid(xf, 'a:chOff'), chext = kid(xf, 'a:chExt');
          if (off && ext && choff && chext) {
            const k = { ox: +off.getAttribute('x'), oy: +off.getAttribute('y'), cx: +choff.getAttribute('x'), cy: +choff.getAttribute('y'), fx: (+ext.getAttribute('cx') || 1) / (+chext.getAttribute('cx') || 1), fy: (+ext.getAttribute('cy') || 1) / (+chext.getAttribute('cy') || 1) };
            g = { k, parent: group };
          }
        }
        await shapesFrom(node, rels, layout, out, g);
        continue;
      }
      const mapBox = (b) => {
        let gg = group;
        while (gg) {
          const k = gg.k;
          b = { ...b, x: (k.ox + (b.x / sx - k.cx) * k.fx) * sx, y: (k.oy + (b.y / sy - k.cy) * k.fy) * sy, w: b.w * k.fx, h: b.h * k.fy };
          gg = gg.parent;
        }
        return b;
      };
      if (tag === 'p:sp') {
        const spPr = kid(node, 'p:spPr');
        const ph = firstTag(kid(node, 'p:nvSpPr'), 'p:ph');
        const xf = kid(spPr, 'a:xfrm');
        let box = xf ? xfrmBox(xf) : null;
        let phRec = null;
        if (ph) {
          const type = ph.getAttribute('type') || 'body', idx = ph.getAttribute('idx');
          phRec = (idx && layout.map['i:' + idx]) || layout.map['t:' + type] || (layout.master && ((idx && layout.master.map['i:' + idx]) || layout.master.map['t:' + type]));
          if (!box && phRec) box = { ...phRec.box };
          if (!box) {
            box = type === 'title' || type === 'ctrTitle' ? { x: W * 0.06, y: H * 0.05, w: W * 0.88, h: H * 0.15, rot: 0 } : { x: W * 0.06, y: H * 0.24, w: W * 0.88, h: H * 0.68, rot: 0 };
          }
        }
        if (!box) continue;
        box = mapBox(box);
        const tx = kid(node, 'p:txBody');
        const t = tx ? txBodyToHtml(tx) : { html: '', align: null, bullet: null, mainSize: null };
        const hasText = t.html && t.html.replace(/<[^>]+>/g, '').trim();
        const prst = firstTag(spPr, 'a:prstGeom')?.getAttribute('prst') || 'rect';
        const noFill = !!kid(spPr, 'a:noFill');
        const fillColor = colorOf(spPr);
        const ln = kid(spPr, 'a:ln');
        const lnColor = ln ? colorOf(ln) : null;
        const lnW = ln?.getAttribute('w') ? +ln.getAttribute('w') / 9525 : (lnColor ? 1 : 0);
        const bodyPr = tx ? kid(tx, 'a:bodyPr') : null;
        const anchor = bodyPr?.getAttribute('anchor');
        const valign = anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top';
        const isTitle = ph && /title|ctrTitle/i.test(ph.getAttribute('type') || '');
        const fontSize = t.mainSize || phRec?.sz || (isTitle ? 32 : 18);
        const style = { fontSize, align: t.align || (ph?.getAttribute('type') === 'ctrTitle' ? 'center' : 'left'), valign, bullet: t.bullet, lineHeight: 1.2 };
        const rect = { x: Math.round(box.x), y: Math.round(box.y), w: Math.max(10, Math.round(box.w)), h: Math.max(10, Math.round(box.h)), rot: Math.round(box.rot || 0) };
        if ((prst === 'line' || prst === 'straightConnector1') && !hasText) {
          out.push(shapeEl(prst === 'line' ? 'line' : 'arrowLine', { ...rect, h: Math.max(rect.h, 10), stroke: { color: lnColor || '#000000', width: lnW || 1.5, dash: 'solid' } }));
          continue;
        }
        const plainBox = (prst === 'rect' && (noFill || !fillColor) && !lnColor) || ph;
        if (plainBox) {
          if (!hasText) continue;
          const el = textEl({ ...rect, html: t.html, role: isTitle ? 'title' : null, autoFit: false, style: { ...style, color: '#000000' } });
          if (fillColor && !noFill) { el.type = 'shape'; el.shape = 'rect'; el.fill = { type: 'solid', color: fillColor }; el.stroke = { width: 0 }; el.style.color = '#000000'; }
          out.push(el);
        } else {
          out.push(shapeEl(PRST.has(prst) ? prst : prst === 'flowChartProcess' ? 'rect' : prst === 'flowChartDecision' ? 'diamond' : prst === 'flowChartTerminator' ? 'roundRect' : 'rect', {
            ...rect, html: t.html,
            fill: noFill ? { type: 'none' } : { type: 'solid', color: fillColor || '#4472c4' },
            stroke: { color: lnColor, width: lnColor ? lnW : 0, dash: 'solid' },
            style: { ...style, color: '#000000', valign: anchor ? valign : 'middle', align: t.align || 'center' },
          }));
        }
      } else if (tag === 'p:pic') {
        const blip = firstTag(node, 'a:blip');
        const rid = blip?.getAttribute('r:embed');
        const xf = firstTag(kid(node, 'p:spPr'), 'a:xfrm');
        if (!rid || !xf) continue;
        const mid = await media(rels, rid);
        if (!mid) continue;
        const b = mapBox(xfrmBox(xf));
        out.push(baseEl('image', { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h), rot: Math.round(b.rot), mediaId: mid, border: null, radius: 0 }));
      } else if (tag === 'p:graphicFrame') {
        const tbl = firstTag(node, 'a:tbl');
        const xf = kid(node, 'p:xfrm');
        if (!tbl || !xf) continue;
        const b = mapBox(xfrmBox(xf));
        const colW = [...tbl.getElementsByTagName('a:gridCol')].map((g) => +g.getAttribute('w') || 1);
        const rows = [...tbl.getElementsByTagName('a:tr')].map((tr) => kids(tr, 'a:tc').map((tc) => {
          const tb = kid(tc, 'a:txBody');
          const fill = colorOf(kid(tc, 'a:tcPr'));
          return { html: tb ? txBodyToHtml(tb).html : '', fill: fill || null };
        }));
        if (!rows.length) continue;
        const nc = Math.max(...rows.map((r) => r.length));
        rows.forEach((r) => { while (r.length < nc) r.push({ html: '' }); });
        out.push(baseEl('table', { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h), rows, colW: colW.length === nc ? colW : Array(nc).fill(1), tableStyle: { header: true, banded: true, color: null }, style: { fontSize: 14, lineHeight: 1.2 } }));
      }
    }
  }

  let masterCache = null;
  for (const rid of ids) {
    const rel = presRels[rid];
    if (!rel) continue;
    const doc = await xml(rel.target);
    if (!doc) continue;
    const rels = await relsOf(rel.target);
    const layoutRel = Object.values(rels).find((r) => r.type.endsWith('/slideLayout'));
    let layout = { map: {}, bgColor: null };
    if (layoutRel) {
      layout = await phMap(layoutRel.target);
      const lrels = await relsOf(layoutRel.target);
      const masterRel = Object.values(lrels).find((r) => r.type.endsWith('/slideMaster'));
      if (masterRel) { masterCache = masterCache || await phMap(masterRel.target); layout = { ...layout, master: masterCache }; }
    }
    const slide = { id: uid(), layout: 'blank', elements: [], bg: null, notes: '', transition: { type: 'none', duration: 0.7 }, animations: [], hidden: doc.documentElement.getAttribute('show') === '0' };
    const bgPr = firstTag(firstTag(doc, 'p:bg'), 'p:bgPr');
    const bgColor = colorOf(bgPr) || layout.bgColor || layout.master?.bgColor || '#ffffff';
    const bgBlip = bgPr ? firstTag(bgPr, 'a:blip') : null;
    if (bgBlip) {
      const mid = await media(rels, bgBlip.getAttribute('r:embed'));
      slide.bg = mid ? { type: 'image', mediaId: mid, color: bgColor } : { type: 'solid', color: bgColor };
    } else slide.bg = { type: 'solid', color: bgColor };
    const tree = firstTag(doc, 'p:spTree');
    if (tree) await shapesFrom(tree, rels, layout, slide.elements, null);
    const notesRel = Object.values(rels).find((r) => r.type.endsWith('/notesSlide'));
    if (notesRel) {
      const nd = await xml(notesRel.target);
      if (nd) {
        for (const sp of nd.getElementsByTagName('p:sp')) {
          const ph = firstTag(sp, 'p:ph');
          if (ph && ph.getAttribute('type') === 'body') {
            slide.notes = [...sp.getElementsByTagName('a:p')].map((p) => [...p.getElementsByTagName('a:t')].map((t) => t.textContent).join('')).join('\n').trim();
          }
        }
      }
    }
    deck.slides.push(slide);
  }
  if (!deck.slides.length) throw new Error('未找到幻灯片');
  return deck;
}

function resolvePath(dir, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = dir.split('/');
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}
