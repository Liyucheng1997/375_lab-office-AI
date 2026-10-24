// 导入（docx / txt / md / html）与导出（docx / html / md / txt）
import { download, readFileAs } from '../../core/ui.js';
import { CONTENT_CSS, injectContentCss } from './content-css.js';
import { makeContent, defaultPage } from './templates.js';

export const PAPER_SIZES = {
  A4: { w: 210, h: 297, label: 'A4 (21 × 29.7 厘米)' },
  A3: { w: 297, h: 420, label: 'A3 (29.7 × 42 厘米)' },
  A5: { w: 148, h: 210, label: 'A5 (14.8 × 21 厘米)' },
  B5: { w: 182, h: 257, label: 'B5 (18.2 × 25.7 厘米)' },
  Letter: { w: 215.9, h: 279.4, label: 'Letter (21.59 × 27.94 厘米)' },
  Legal: { w: 215.9, h: 355.6, label: 'Legal (21.59 × 35.56 厘米)' },
};

export function pageDims(page) {
  const s = PAPER_SIZES[page.size] || PAPER_SIZES.A4;
  const land = page.orientation === 'landscape';
  return { w: land ? s.h : s.w, h: land ? s.w : s.h };
}
export const mm2px = (mm) => (mm * 96) / 25.4;
export const px2mm = (px) => (px * 25.4) / 96;

/* ---------------- HTML 清洗 ---------------- */

const ALLOWED_TAGS = new Set('P BR B STRONG I EM U S STRIKE DEL SUB SUP SPAN A H1 H2 H3 H4 H5 H6 UL OL LI TABLE THEAD TBODY TFOOT TR TD TH IMG BLOCKQUOTE PRE CODE HR DIV FONT CAPTION COLGROUP COL MARK'.split(' '));
const DROP_TAGS = new Set('SCRIPT STYLE META LINK TITLE HEAD IFRAME OBJECT EMBED NOSCRIPT TEMPLATE BUTTON INPUT SELECT TEXTAREA FORM SVG CANVAS VIDEO AUDIO'.split(' '));
const ALLOWED_STYLES = ['color', 'background-color', 'background', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'font-size', 'font-family', 'text-align', 'vertical-align', 'text-indent', 'line-height', 'margin-left', 'padding-left', 'width', 'height', 'float', 'border', 'border-top', 'border-bottom', 'border-left', 'border-right', 'list-style-type', 'letter-spacing'];

export function sanitizeHTML(html, { keepClasses = true } = {}) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 8) { child.remove(); continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toUpperCase();
      if (DROP_TAGS.has(tag) || tag.includes(':')) {
        // Word 的 <o:p> 等命名空间标签：保留子内容
        if (tag.includes(':')) { walk(child); child.replaceWith(...child.childNodes); } else child.remove();
        continue;
      }
      walk(child);
      if (!ALLOWED_TAGS.has(tag)) {
        // 语义块元素转为 div/p，其余展开
        if (/^(SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|NAV|FIGURE|FIGCAPTION|ADDRESS|DL|DT|DD)$/.test(tag)) {
          const d = document.createElement(tag === 'DT' || tag === 'DD' || tag === 'FIGCAPTION' ? 'p' : 'div');
          d.append(...child.childNodes);
          child.replaceWith(d);
        } else child.replaceWith(...child.childNodes);
        continue;
      }
      if (tag === 'FONT') {
        const span = document.createElement('span');
        if (child.color) span.style.color = child.color;
        if (child.face) span.style.fontFamily = child.face;
        const sz = { 1: '8pt', 2: '10pt', 3: '12pt', 4: '14pt', 5: '18pt', 6: '24pt', 7: '36pt' }[child.size];
        if (sz) span.style.fontSize = sz;
        span.append(...child.childNodes);
        child.replaceWith(span);
        cleanAttrs(span, keepClasses);
        continue;
      }
      cleanAttrs(child, keepClasses);
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

function cleanAttrs(el, keepClasses) {
  for (const attr of [...el.attributes]) {
    const n = attr.name.toLowerCase();
    const v = attr.value;
    if (n === 'style') {
      const keep = [];
      for (const prop of ALLOWED_STYLES) {
        const val = el.style.getPropertyValue(prop);
        if (val && !/mso-|expression/i.test(val)) keep.push(`${prop}:${val}`);
      }
      if (keep.length) el.setAttribute('style', keep.join(';')); else el.removeAttribute('style');
    } else if (n === 'href') {
      if (/^\s*javascript:/i.test(v)) el.removeAttribute('href');
    } else if (n === 'src') {
      if (!/^(data:image\/|https?:|blob:)/i.test(v)) el.removeAttribute('src');
    } else if (n === 'class') {
      const cls = keepClasses ? v.split(/\s+/).filter((c) => c.startsWith('wr-')).join(' ') : '';
      if (cls) el.setAttribute('class', cls); else el.removeAttribute('class');
    } else if (['colspan', 'rowspan', 'alt', 'title', 'id', 'data-cid', 'data-fn', 'contenteditable', 'target', 'width', 'height'].includes(n)) {
      if (n === 'contenteditable' && !(el.className || '').includes('wr-')) el.removeAttribute(n);
    } else el.removeAttribute(attr.name);
  }
}

/* ---------------- Markdown -> HTML ---------------- */

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function mdInline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<img alt="$1" src="$2">');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>');
  s = s.replace(/(\*\*|__)(.+?)\1/g, '<b>$2</b>');
  s = s.replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<i>$2</i>');
  s = s.replace(/(^|[^_\w])_(?!\s)(.+?)_(?!\w)/g, '$1<i>$2</i>');
  s = s.replace(/~~(.+?)~~/g, '<s>$1</s>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
  return s;
}

export function markdownToHTML(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const splitRow = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  while (i < lines.length) {
    let line = lines[i];
    if (/^\s*```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre>${esc(buf.join('\n'))}</pre>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) { out.push(`<h${m[1].length}>${mdInline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      let t = '<table><tbody><tr>' + head.map((c) => `<th>${mdInline(c)}</th>`).join('') + '</tr>';
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        t += '<tr>' + splitRow(lines[i]).map((c) => `<td>${mdInline(c) || '<br>'}</td>`).join('') + '</tr>';
        i++;
      }
      out.push(t + '</tbody></table>');
      continue;
    }
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${markdownToHTML(buf.join('\n'))}</blockquote>`);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      // 列表（支持缩进嵌套）
      const items = [];
      while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const l = lines[i];
        const mm = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (mm) items.push({ indent: mm[1].replace(/\t/g, '    ').length, ordered: /\d/.test(mm[2]), text: mm[3] });
        else items[items.length - 1].text += ' ' + l.trim();
        i++;
      }
      const build = (start, indent) => {
        let html = '';
        let k = start;
        const ordered = items[start].ordered;
        html += ordered ? '<ol>' : '<ul>';
        while (k < items.length && items[k].indent >= indent) {
          if (items[k].indent === indent && items[k].ordered !== ordered) break;
          if (items[k].indent > indent) {
            const [sub, next] = build(k, items[k].indent);
            html = html.replace(/<\/li>$/, sub + '</li>');
            k = next;
            continue;
          }
          let text = items[k].text;
          const task = text.match(/^\[([ xX])\]\s+(.*)$/);
          if (task) text = (task[1] === ' ' ? '☐ ' : '☑ ') + task[2];
          html += `<li>${mdInline(text)}</li>`;
          k++;
        }
        html += ordered ? '</ol>' : '</ul>';
        return [html, k];
      };
      for (let k = 0; k < items.length;) {
        const [html, next] = build(k, items[k].indent);
        out.push(html);
        k = next > k ? next : k + 1;
      }
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*```|\s*>|\s*([-*+]|\d+[.)])\s+)/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
      if (i < lines.length && lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) break;
    }
    out.push(`<p>${buf.map((l) => mdInline(l.replace(/\s{2,}$/, ''))).join('<br>')}</p>`);
  }
  return out.join('') || '<p><br></p>';
}

/* ---------------- 导入 ---------------- */

async function docxPageSettings(arrayBuffer) {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file('word/document.xml')?.async('string');
    if (!xml) return null;
    const sect = xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g);
    if (!sect) return null;
    const s = sect[sect.length - 1];
    const attr = (tag, name) => { const m = s.match(new RegExp(`<w:${tag}\\b[^>]*\\bw:${name}="(\\d+)"`)); return m ? +m[1] : null; };
    const tw2mm = (t) => Math.round((t / 56.6929) * 10) / 10;
    const page = defaultPage();
    const w = attr('pgSz', 'w'), hh = attr('pgSz', 'h');
    if (w && hh) {
      const land = w > hh;
      const sw = tw2mm(Math.min(w, hh)), sh = tw2mm(Math.max(w, hh));
      const found = Object.entries(PAPER_SIZES).find(([, v]) => Math.abs(v.w - sw) < 2 && Math.abs(v.h - sh) < 2);
      if (found) page.size = found[0];
      page.orientation = land ? 'landscape' : 'portrait';
    }
    const mt = attr('pgMar', 'top'), mb = attr('pgMar', 'bottom'), ml = attr('pgMar', 'left'), mr = attr('pgMar', 'right');
    if (mt != null && ml != null) page.margins = { top: tw2mm(mt), bottom: tw2mm(mb ?? mt), left: tw2mm(ml), right: tw2mm(mr ?? ml) };
    return page;
  } catch (e) {
    console.warn(e);
    return null;
  }
}

export async function importWriterFile(file) {
  const name = file.name.replace(/\.[^.]+$/, '');
  const ext = file.name.toLowerCase().split('.').pop();
  const content = makeContent('blank');
  if (ext === 'docx') {
    const mammoth = (await import('mammoth/mammoth.browser.js')).default || window.mammoth;
    const buf = await readFileAs(file, 'arrayBuffer');
    const res = await mammoth.convertToHtml({ arrayBuffer: buf }, {
      styleMap: [
        "p[style-name='Title'] => p.wr-title:fresh",
        "p[style-name='标题'] => p.wr-title:fresh",
        "p[style-name='Subtitle'] => p.wr-subtitle:fresh",
        "p[style-name='副标题'] => p.wr-subtitle:fresh",
        "p[style-name='Quote'] => blockquote:fresh",
        'u => u',
        'strike => s',
      ],
    });
    content.html = sanitizeHTML(res.value) || '<p><br></p>';
    const page = await docxPageSettings(buf);
    if (page) content.page = page;
  } else if (ext === 'doc') {
    throw new Error('不支持旧版 .doc 格式，请另存为 .docx 后再导入');
  } else if (ext === 'md' || ext === 'markdown') {
    content.html = markdownToHTML(await readFileAs(file, 'text'));
  } else if (ext === 'html' || ext === 'htm') {
    const text = await readFileAs(file, 'text');
    const doc = new DOMParser().parseFromString(text, 'text/html');
    content.html = sanitizeHTML(doc.body.innerHTML) || '<p><br></p>';
  } else {
    const text = await readFileAs(file, 'text');
    content.html = text.replace(/\r\n?/g, '\n').split('\n').map((l) => `<p>${esc(l) || '<br>'}</p>`).join('');
  }
  return { name, content };
}

/* ---------------- 导出辅助 ---------------- */

/** 在屏幕外创建与编辑区同样式的 DOM，便于读取计算样式 */
async function offscreenDoc(html, page) {
  injectContentCss();
  const { w } = pageDims(page);
  const m = page.margins;
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${mm2px(w - m.left - m.right)}px;opacity:0;pointer-events:none;z-index:-1;`;
  const el = document.createElement('div');
  el.className = 'wr-doc';
  el.innerHTML = html;
  host.append(el);
  document.body.append(host);
  await Promise.all([...el.querySelectorAll('img')].map((i) => (i.complete ? null : i.decode().catch(() => {}))));
  return { el, remove: () => host.remove() };
}

function rgbToHex(c) {
  if (!c) return null;
  const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  if (m[4] != null && +m[4] === 0) return null;
  return [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('').toUpperCase();
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'BLOCKQUOTE', 'PRE', 'HR', 'TBODY', 'THEAD', 'TR', 'TD', 'TH', 'CAPTION']);
const isBlock = (n) => n.nodeType === 1 && (BLOCK_TAGS.has(n.tagName) || (n.classList.contains('wr-textbox') === false && getComputedStyle(n).display === 'block' && n.tagName !== 'IMG'));

async function imageBytes(img) {
  const src = img.getAttribute('src') || '';
  let m = src.match(/^data:image\/(png|jpe?g|gif|bmp);base64,(.*)$/i);
  if (m) {
    const bin = atob(m[2]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return { data: arr, type: m[1].toLowerCase().replace('jpeg', 'jpg') };
  }
  // 其他格式（svg/webp/远程）：绘制到 canvas 转 PNG
  try {
    const nw = img.naturalWidth || img.width || 300, nh = img.naturalHeight || img.height || 150;
    const scale = Math.min(1, 2000 / Math.max(nw, nh)) * (src.startsWith('data:image/svg') ? 2 : 1);
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(nw * scale));
    cv.height = Math.max(1, Math.round(nh * scale));
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    return { data: new Uint8Array(await blob.arrayBuffer()), type: 'png' };
  } catch {
    return null;
  }
}

/* ---------------- 导出：DOCX ---------------- */

export async function exportDocx(content, name) {
  const D = await import('docx');
  const { el, remove } = await offscreenDoc(content.html, content.page);
  try {
    const page = content.page;
    const dims = pageDims(page);
    const tw = (mm) => Math.round(mm * 56.6929);
    const contentWidthTw = tw(dims.w - page.margins.left - page.margins.right);
    const contentWidthPx = mm2px(dims.w - page.margins.left - page.margins.right);
    const ctx = { listInstance: 0, footnotes: {}, fnIndex: new Map(), comments: [], commentIds: new Map() };

    // 脚注
    el.querySelectorAll('.wr-footnotes li[data-fn]').forEach((li) => {
      const n = ctx.fnIndex.size + 1;
      ctx.fnIndex.set(li.dataset.fn, n);
      ctx.footnotes[n] = { children: [new D.Paragraph({ children: [new D.TextRun(li.textContent.trim())] })] };
    });

    const ALIGN = { left: D.AlignmentType.LEFT, start: D.AlignmentType.LEFT, center: D.AlignmentType.CENTER, right: D.AlignmentType.RIGHT, end: D.AlignmentType.RIGHT, justify: D.AlignmentType.JUSTIFIED };
    const HEADINGS = { H1: D.HeadingLevel.HEADING_1, H2: D.HeadingLevel.HEADING_2, H3: D.HeadingLevel.HEADING_3, H4: D.HeadingLevel.HEADING_4, H5: D.HeadingLevel.HEADING_5, H6: D.HeadingLevel.HEADING_6 };

    const borderOf = (cs, side) => {
      const st = cs[`border${side}Style`];
      const w = parseFloat(cs[`border${side}Width`]) || 0;
      if (st === 'none' || st === 'hidden' || w === 0 || cs[`border${side}Color`].includes('rgba(0, 0, 0, 0)')) return { style: D.BorderStyle.NONE, size: 0, color: 'auto' };
      const style = st === 'dashed' ? D.BorderStyle.DASHED : st === 'dotted' ? D.BorderStyle.DOTTED : st === 'double' ? D.BorderStyle.DOUBLE : D.BorderStyle.SINGLE;
      return { style, size: Math.max(2, Math.round(w * 6)), color: rgbToHex(cs[`border${side}Color`]) || '000000' };
    };

    function decorations(node, stop) {
      let underline = false, strike = false;
      for (let e = node; e && e !== stop && e !== el; e = e.parentElement) {
        const d = getComputedStyle(e).textDecorationLine || '';
        if (d.includes('underline')) underline = true;
        if (d.includes('line-through')) strike = true;
      }
      return { underline, strike };
    }
    function inlineBg(node, stop) {
      for (let e = node; e && e !== stop && e !== el; e = e.parentElement) {
        const bg = rgbToHex(getComputedStyle(e).backgroundColor);
        if (bg) return bg;
      }
      return null;
    }

    function runOpts(parent, block) {
      const cs = getComputedStyle(parent);
      const deco = decorations(parent, block);
      const o = {
        bold: parseInt(cs.fontWeight, 10) >= 600,
        italics: cs.fontStyle === 'italic',
        strike: deco.strike,
        color: rgbToHex(cs.color) || undefined,
        size: Math.round(parseFloat(cs.fontSize) * 0.75 * 2),
        font: (cs.fontFamily.split(',')[0] || '').replace(/["']/g, '').trim() || undefined,
      };
      if (deco.underline) o.underline = {};
      const bg = inlineBg(parent, block);
      if (bg) o.shading = { type: D.ShadingType.CLEAR, fill: bg, color: 'auto' };
      for (let e = parent; e && e !== block; e = e.parentElement) {
        const va = getComputedStyle(e).verticalAlign;
        if (va === 'super') { o.superScript = true; break; }
        if (va === 'sub') { o.subScript = true; break; }
      }
      return o;
    }

    async function inlineRuns(node, block, out) {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) {
          const text = n.data.replace(/​/g, '');
          if (!text) continue;
          const opts = runOpts(n.parentElement, block);
          const parts = text.split('\n');
          parts.forEach((t, i) => {
            const segs = t.split('\t');
            segs.forEach((s, j) => {
              if (j > 0) out.push(new D.TextRun({ ...opts, children: [new D.Tab()] }));
              if (s || (i > 0 && j === 0)) out.push(new D.TextRun({ ...opts, text: s, break: i > 0 && j === 0 ? 1 : undefined }));
            });
          });
        } else if (n.nodeType === 1) {
          const tag = n.tagName;
          if (tag === 'BR') out.push(new D.TextRun({ break: 1 }));
          else if (tag === 'IMG') {
            const b = await imageBytes(n);
            if (b) {
              let w = n.getBoundingClientRect().width || n.naturalWidth || 200;
              let hgt = n.getBoundingClientRect().height || n.naturalHeight || 150;
              if (w > contentWidthPx) { hgt = (hgt * contentWidthPx) / w; w = contentWidthPx; }
              out.push(new D.ImageRun({ type: b.type, data: b.data, transformation: { width: Math.round(w), height: Math.round(hgt) } }));
            }
          } else if (n.classList.contains('wr-fnref')) {
            const idx = ctx.fnIndex.get(n.dataset.fn);
            if (idx) out.push(new D.FootnoteReferenceRun(idx));
          } else if (tag === 'A' && n.getAttribute('href') && !n.getAttribute('href').startsWith('#')) {
            const kids = [];
            await inlineRuns(n, block, kids);
            out.push(new D.ExternalHyperlink({ link: n.href, children: kids.length ? kids : [new D.TextRun(n.textContent)] }));
          } else if (n.classList.contains('wr-comment') && n.dataset.cid && content.comments?.[n.dataset.cid]) {
            let id = ctx.commentIds.get(n.dataset.cid);
            if (id == null) {
              id = ctx.comments.length;
              ctx.commentIds.set(n.dataset.cid, id);
              const c = content.comments[n.dataset.cid];
              ctx.comments.push({ id, author: c.author || '用户', date: new Date(c.time || Date.now()), children: [new D.Paragraph(c.text || '')] });
            }
            out.push(new D.CommentRangeStart(id));
            await inlineRuns(n, block, out);
            out.push(new D.CommentRangeEnd(id));
            out.push(new D.TextRun({ children: [new D.CommentReference(id)] }));
          } else if (isBlock(n) && tag !== 'SPAN') {
            // 行内上下文中的块元素：拍平为文本
            await inlineRuns(n, block, out);
            out.push(new D.TextRun({ break: 1 }));
          } else {
            await inlineRuns(n, block, out);
          }
        }
      }
      return out;
    }

    function paraOpts(block, extra = {}) {
      const cs = getComputedStyle(block);
      const fs = parseFloat(cs.fontSize) || 16;
      const o = { ...extra };
      o.alignment = ALIGN[cs.textAlign] || undefined;
      if (HEADINGS[block.tagName]) o.heading = HEADINGS[block.tagName];
      if (block.classList?.contains('wr-title')) o.heading = D.HeadingLevel.TITLE;
      const lh = parseFloat(cs.lineHeight);
      o.spacing = {
        before: Math.round((parseFloat(cs.marginTop) || 0) * 15),
        after: Math.round((parseFloat(cs.marginBottom) || 0) * 15),
      };
      if (lh) o.spacing.line = Math.round((lh / (fs * 1.17)) * 240);
      const ti = parseFloat(cs.textIndent) || 0;
      const left = (parseFloat(cs.paddingLeft) || 0) + (block.tagName === 'LI' ? 0 : parseFloat(cs.marginLeft) || 0);
      const right = (parseFloat(cs.paddingRight) || 0);
      if (ti || left || right) {
        o.indent = {};
        if (ti > 0) o.indent.firstLine = Math.round(ti * 15);
        if (ti < 0) o.indent.hanging = Math.round(-ti * 15);
        if (left && !extra.numbering) o.indent.left = Math.round(left * 15);
        if (right) o.indent.right = Math.round(right * 15);
      }
      const bg = rgbToHex(cs.backgroundColor);
      if (bg) o.shading = { type: D.ShadingType.CLEAR, fill: bg, color: 'auto' };
      const b = {};
      for (const side of ['Top', 'Bottom', 'Left', 'Right']) {
        const bb = borderOf(cs, side);
        if (bb.style !== D.BorderStyle.NONE) b[side.toLowerCase()] = { ...bb, space: 2 };
      }
      if (Object.keys(b).length) o.border = b;
      return o;
    }

    /** 把容器的子节点转为 docx 块（段落 / 表格） */
    async function convertChildren(container, out, listCtx) {
      let inlineBuf = [];
      const flush = async () => {
        if (!inlineBuf.length) return;
        const holder = inlineBuf;
        inlineBuf = [];
        if (holder.every((n) => n.nodeType === 3 && !n.data.trim())) return;
        const runs = [];
        // 直接在原节点上转换，避免移动节点
        await inlineRuns({ childNodes: holder }, container, runs);
        out.push(new D.Paragraph({ ...paraOpts(container, listCtx?.numbering ? { numbering: listCtx.numbering } : {}), children: runs }));
      };
      for (const n of container.childNodes) {
        if (n.nodeType === 1 && (isBlock(n) || n.classList.contains('wr-pagebreak'))) {
          await flush();
          await convertBlock(n, out, listCtx);
        } else inlineBuf.push(n);
      }
      await flush();
    }

    async function convertBlock(b, out, listCtx) {
      const tag = b.tagName;
      if (b.classList.contains('wr-pagebreak')) { out.push(new D.Paragraph({ children: [new D.PageBreak()] })); return; }
      if (b.classList.contains('wr-footnotes')) return;
      if (b.classList.contains('wr-toc')) {
        const title = b.querySelector('.wr-toc-title');
        if (title) out.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 120 }, children: [new D.TextRun({ text: title.textContent, bold: true, size: 32, font: 'Microsoft YaHei' })] }));
        b.querySelectorAll('.wr-toc-item').forEach((it) => {
          const lvl = it.classList.contains('wr-toc-l3') ? 2 : it.classList.contains('wr-toc-l2') ? 1 : 0;
          out.push(new D.Paragraph({
            indent: { left: lvl * 420 },
            tabStops: [{ type: D.TabStopType.RIGHT, position: contentWidthTw, leader: D.LeaderType.DOT }],
            children: [new D.TextRun({ text: it.querySelector('.wr-toc-text')?.textContent || '', size: 24 }), new D.TextRun({ children: [new D.Tab(), it.querySelector('.wr-toc-page')?.textContent || ''], size: 24 })],
          }));
        });
        return;
      }
      if (tag === 'HR') {
        out.push(new D.Paragraph({ border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } }, children: [] }));
        return;
      }
      if (tag === 'UL' || tag === 'OL') {
        const level = listCtx?.level != null ? listCtx.level + 1 : 0;
        const instance = level === 0 ? ++ctx.listInstance : listCtx.instance;
        const reference = tag === 'OL' ? 'wr-num' : 'wr-bullet';
        for (const li of b.children) {
          if (li.tagName !== 'LI') { await convertBlock(li, out, listCtx); continue; }
          await convertChildren(li, out, { level, instance, numbering: { reference, level: Math.min(level, 8), instance } });
        }
        return;
      }
      if (tag === 'TABLE') {
        const table = await convertTable(b);
        if (table) out.push(table);
        return;
      }
      if (tag === 'TBODY' || tag === 'THEAD') return;
      // DIV 或块容器：若含块级子元素则递归
      const hasBlockChild = [...b.children].some((c) => isBlock(c));
      if (hasBlockChild && !/^H\d$/.test(tag)) {
        await convertChildren(b, out, listCtx && tag === 'LI' ? listCtx : undefined);
        return;
      }
      const runs = await inlineRuns(b, b, []);
      out.push(new D.Paragraph({ ...paraOpts(b, listCtx?.numbering ? { numbering: listCtx.numbering } : {}), children: runs }));
    }

    async function convertTable(t) {
      const rows = [...t.rows];
      if (!rows.length) return null;
      const tcs = getComputedStyle(t);
      const tableBorder = {};
      for (const side of ['Top', 'Bottom', 'Left', 'Right']) tableBorder[side] = borderOf(tcs, side);
      let cols = 0;
      rows[0] && [...rows[0].cells].forEach((c) => (cols += c.colSpan || 1));
      const colW = Math.floor(contentWidthTw / Math.max(1, cols));
      const outRows = [];
      for (let ri = 0; ri < rows.length; ri++) {
        const tr = rows[ri];
        const cells = [];
        for (const td of tr.cells) {
          const cs = getComputedStyle(td);
          const kids = [];
          await convertChildren(td, kids);
          if (!kids.length) kids.push(new D.Paragraph(''));
          const bg = rgbToHex(cs.backgroundColor);
          const borders = {};
          for (const side of ['Top', 'Bottom', 'Left', 'Right']) {
            let bb = borderOf(cs, side);
            if (bb.style === D.BorderStyle.NONE && tableBorder[side].style !== D.BorderStyle.NONE) {
              const edge = (side === 'Top' && ri === 0) || (side === 'Bottom' && ri + (td.rowSpan || 1) >= rows.length) || (side === 'Left' && td.cellIndex === 0) || (side === 'Right' && !td.nextElementSibling);
              if (edge) bb = tableBorder[side];
            }
            borders[side.toLowerCase()] = bb;
          }
          cells.push(new D.TableCell({
            children: kids,
            columnSpan: td.colSpan > 1 ? td.colSpan : undefined,
            rowSpan: td.rowSpan > 1 ? td.rowSpan : undefined,
            shading: bg ? { type: D.ShadingType.CLEAR, fill: bg, color: 'auto' } : undefined,
            verticalAlign: cs.verticalAlign === 'middle' ? D.VerticalAlign.CENTER : cs.verticalAlign === 'bottom' ? D.VerticalAlign.BOTTOM : D.VerticalAlign.TOP,
            borders,
            margins: { top: 40, bottom: 40, left: 100, right: 100 },
          }));
        }
        if (cells.length) outRows.push(new D.TableRow({ children: cells }));
      }
      return new D.Table({ rows: outRows, width: { size: 100, type: D.WidthType.PERCENTAGE }, columnWidths: Array(cols).fill(colW) });
    }

    const children = [];
    await convertChildren(el, children);
    if (!children.length) children.push(new D.Paragraph(''));

    // 页眉页脚 / 页码
    const hfPara = (part, isFooter) => {
      const pn = content.pageNumber || {};
      const showPN = pn.enabled && (pn.pos === 'footer') === isFooter;
      const text = part?.text || '';
      if (!text && !showPN) return null;
      const kids = [];
      if (text) kids.push(new D.Paragraph({ alignment: ALIGN[part.align] || D.AlignmentType.CENTER, children: [new D.TextRun({ text, size: 18, color: '555555' })] }));
      if (showPN) {
        const fmt = pn.format || '{n}';
        const pieces = [];
        fmt.split(/(\{n\}|\{total\})/).forEach((s) => {
          if (s === '{n}') pieces.push(D.PageNumber.CURRENT);
          else if (s === '{total}') pieces.push(D.PageNumber.TOTAL_PAGES);
          else if (s) pieces.push(s);
        });
        kids.push(new D.Paragraph({ alignment: ALIGN[pn.align] || D.AlignmentType.CENTER, children: [new D.TextRun({ children: pieces, size: 18 })] }));
      }
      return kids;
    };
    const headerKids = hfPara(content.header, false);
    const footerKids = hfPara(content.footer, true);

    const levels = (fmt) => Array.from({ length: 9 }, (_, i) => ({
      level: i,
      format: fmt === 'bullet' ? D.LevelFormat.BULLET : [D.LevelFormat.DECIMAL, D.LevelFormat.LOWER_LETTER, D.LevelFormat.LOWER_ROMAN][i % 3],
      text: fmt === 'bullet' ? ['●', '○', '■'][i % 3] : `%${i + 1}.`,
      alignment: D.AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 420 * (i + 1), hanging: 360 } } },
    }));

    const doc = new D.Document({
      creator: '云办公',
      title: name,
      background: page.color ? { color: page.color.replace('#', '') } : undefined,
      numbering: { config: [{ reference: 'wr-bullet', levels: levels('bullet') }, { reference: 'wr-num', levels: levels('num') }] },
      footnotes: ctx.footnotes,
      comments: ctx.comments.length ? { children: ctx.comments } : undefined,
      styles: { default: { document: { run: { font: 'SimSun', size: 24 } } } },
      sections: [{
        properties: {
          page: {
            size: { width: tw(PAPER_SIZES[page.size]?.w || 210), height: tw(PAPER_SIZES[page.size]?.h || 297), orientation: page.orientation === 'landscape' ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT },
            margin: { top: tw(page.margins.top), bottom: tw(page.margins.bottom), left: tw(page.margins.left), right: tw(page.margins.right) },
          },
        },
        headers: headerKids ? { default: new D.Header({ children: headerKids }) } : undefined,
        footers: footerKids ? { default: new D.Footer({ children: footerKids }) } : undefined,
        children,
      }],
    });
    const blob = await D.Packer.toBlob(doc);
    download(blob, name + '.docx');
  } finally {
    remove();
  }
}

/* ---------------- 导出：HTML / TXT / MD ---------------- */

export function buildStandaloneHTML(content, name) {
  const { w, h } = pageDims(content.page);
  const m = content.page.margins;
  const css = `${CONTENT_CSS}
body { margin: 0; background: #e9ebef; }
.wr-doc { width: ${w}mm; min-height: ${h}mm; box-sizing: border-box; margin: 24px auto; padding: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; background: ${content.page.color || '#fff'}; box-shadow: 0 2px 12px rgba(0,0,0,.15); }
@media print { body { background: none; } .wr-doc { margin: 0; box-shadow: none; width: auto; min-height: 0; padding: 0; } @page { size: ${w}mm ${h}mm; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; } }`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(name)}</title><style>${css}</style></head><body><div class="wr-doc">${content.html}</div></body></html>`;
}

export function exportHTML(content, name) {
  download(new Blob([buildStandaloneHTML(content, name)], { type: 'text/html;charset=utf-8' }), name + '.html');
}

export async function exportText(content, name) {
  const { el, remove } = await offscreenDoc(content.html, content.page);
  try {
    el.querySelectorAll('.wr-pagebreak').forEach((p) => p.replaceWith(document.createTextNode('\n')));
    const text = el.innerText.replace(/​/g, '').replace(/\n{3,}/g, '\n\n');
    download(new Blob([text], { type: 'text/plain;charset=utf-8' }), name + '.txt');
  } finally {
    remove();
  }
}

export function htmlToMarkdown(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const inline = (node) => {
    let s = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { s += n.data.replace(/​/g, '').replace(/([*_`\\])/g, '\\$1'); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      const inner = inline(n);
      const st = n.getAttribute('style') || '';
      if (tag === 'BR') s += '  \n';
      else if (tag === 'B' || tag === 'STRONG' || /font-weight:\s*(bold|[6-9]00)/.test(st)) s += inner.trim() ? `**${inner}**` : inner;
      else if (tag === 'I' || tag === 'EM' || /font-style:\s*italic/.test(st)) s += inner.trim() ? `*${inner}*` : inner;
      else if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || /line-through/.test(st)) s += `~~${inner}~~`;
      else if (tag === 'CODE') s += '`' + n.textContent + '`';
      else if (tag === 'A') s += `[${inner}](${n.getAttribute('href') || ''})`;
      else if (tag === 'IMG') s += `![${n.getAttribute('alt') || ''}](${n.getAttribute('src') || ''})`;
      else if (n.classList.contains('wr-fnref')) s += `[^${n.textContent}]`;
      else s += inner;
    }
    return s;
  };
  const lines = [];
  const block = (node, depth = 0) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { if (n.data.trim()) lines.push(n.data.trim(), ''); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (/^H[1-6]$/.test(tag)) lines.push('#'.repeat(+tag[1]) + ' ' + inline(n).trim(), '');
      else if (n.classList.contains('wr-title')) lines.push('# ' + inline(n).trim(), '');
      else if (n.classList.contains('wr-pagebreak')) lines.push('---', '');
      else if (n.classList.contains('wr-toc')) lines.push('[TOC]', '');
      else if (n.classList.contains('wr-footnotes')) {
        n.querySelectorAll('li').forEach((li, i) => lines.push(`[^${i + 1}]: ${li.textContent.trim()}`));
        lines.push('');
      } else if (tag === 'HR') lines.push('---', '');
      else if (tag === 'PRE') lines.push('```', n.textContent, '```', '');
      else if (tag === 'BLOCKQUOTE') {
        const sub = htmlToMarkdown(n.innerHTML).trim().split('\n').map((l) => '> ' + l);
        lines.push(...sub, '');
      } else if (tag === 'UL' || tag === 'OL') {
        const list = (ul, d) => {
          let i = 1;
          for (const li of ul.children) {
            const own = document.createElement('div');
            for (const c of li.childNodes) if (!(c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL'))) own.append(c.cloneNode(true));
            lines.push('  '.repeat(d) + (ul.tagName === 'OL' ? `${i++}. ` : '- ') + inline(own).trim());
            for (const c of li.children) if (c.tagName === 'UL' || c.tagName === 'OL') list(c, d + 1);
          }
        };
        list(n, depth);
        lines.push('');
      } else if (tag === 'TABLE') {
        const rows = [...n.querySelectorAll('tr')];
        rows.forEach((tr, i) => {
          const cells = [...tr.cells].map((c) => inline(c).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim());
          lines.push('| ' + cells.join(' | ') + ' |');
          if (i === 0) lines.push('|' + cells.map(() => ' --- ').join('|') + '|');
        });
        lines.push('');
      } else if (tag === 'DIV' && [...n.children].some((c) => /^(P|H\d|UL|OL|TABLE|DIV|PRE|BLOCKQUOTE)$/.test(c.tagName))) block(n, depth);
      else {
        const t = inline(n).trim();
        if (t) lines.push(t, '');
      }
    }
  };
  block(tpl.content);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function exportMarkdown(content, name) {
  download(new Blob([htmlToMarkdown(content.html)], { type: 'text/markdown;charset=utf-8' }), name + '.md');
}
