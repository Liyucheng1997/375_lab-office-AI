// 演示应用的 AI 助手接入：把幻灯片的读写操作包装成工具，交给共享助手面板。
// 页码对模型一律从 1 开始；坐标系为 960×540（16:9）或 960×720（4:3）。
import { toast, FONT_FAMILIES } from '../../core/ui.js';
import { createAssistant } from '../../ai/panel.js';
import { newSlide, fill, textEl, shapeEl, tableFrom, chartEl, cloneSlide, dims, isTextEmpty, esc, LAYOUTS } from './model.js';
import { THEMES, getTheme } from './themes.js';
import { TRANSITIONS } from './anim.js';
import { SHAPES } from './shapes.js';
import { CHART_TYPES } from './chart.js';

/* ---------------- 文本 ⇄ HTML ---------------- */

/** 把元素 HTML 转成纯文本；缩进的子要点前面加两个空格 */
export function htmlToText(html) {
  if (!html) return '';
  const d = document.createElement('div');
  d.innerHTML = html;
  const blocks = [...d.children].filter((c) => /^(DIV|P|LI|UL|OL)$/.test(c.tagName));
  if (!blocks.length) return d.textContent.trim();
  const out = [];
  const walk = (nodes, lvl) => {
    for (const n of nodes) {
      if (n.tagName === 'UL' || n.tagName === 'OL') { walk([...n.children], lvl + 1); continue; }
      const ml = parseFloat(n.style?.marginLeft || 0);
      const level = lvl + (ml > 0 ? Math.max(1, Math.round(ml / 1.4)) : 0);
      out.push('  '.repeat(level) + n.textContent.replace(/ /g, ' ').trimEnd());
    }
  };
  walk(blocks, 0);
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join('\n');
}

/** 要点 → HTML：字符串数组（前导空格或 "- " 表示层级）或嵌套数组表示子要点 */
export function bulletsToHtml(items) {
  if (items == null) return '';
  if (typeof items === 'string') items = items.split('\n');
  const lines = [];
  const walk = (arr, lvl) => {
    for (const it of arr) {
      if (Array.isArray(it)) { walk(it, lvl + 1); continue; }
      const raw = String(it ?? '');
      const lead = raw.match(/^(\s*)/)[1].replace(/\t/g, '  ').length;
      const text = raw.trim().replace(/^([-*•·]|\d+[.)、])\s+/, '');
      lines.push({ lvl: lvl + Math.floor(lead / 2), text });
    }
  };
  walk(items, 0);
  return lines.map(({ lvl, text }) => `<div${lvl ? ` style="margin-left:${(lvl * 1.4).toFixed(1)}em"` : ''}>${text ? esc(text) : '<br>'}</div>`).join('');
}

const LAYOUT_IN = { title: 'title', title_content: 'titleContent', section: 'section', two_content: 'twoContent', comparison: 'comparison', title_only: 'titleOnly', blank: 'blank', picture_caption: 'pictureTitle' };
const LAYOUT_OUT = Object.fromEntries(Object.entries(LAYOUT_IN).map(([k, v]) => [v, k]));
const THEME_LIST = THEMES.map((t) => `${t.id}（${t.name}）`).join('、');
const TRANSITION_IDS = TRANSITIONS.map((t) => t.id);
const SHAPE_IDS = SHAPES.map((s) => s.key);
const CHART_IDS = CHART_TYPES.map((c) => c.value);

/* ---------------- 读取 ---------------- */

function elementInfo(el) {
  const o = { id: el.id, type: el.type, x: Math.round(el.x), y: Math.round(el.y), w: Math.round(el.w), h: Math.round(el.h) };
  if (el.role) o.role = el.role;
  if (el.type === 'shape') o.shape = el.shape;
  if (el.type === 'text' || el.type === 'shape') {
    const t = htmlToText(el.html);
    o.text = t;
    if (!t && el.placeholder) o.empty_placeholder = true;
    const s = el.style || {};
    o.style = { font_size: s.fontSize, ...(s.fontFamily ? { font: s.fontFamily } : {}), ...(s.color ? { color: s.color } : {}), ...(s.bold ? { bold: true } : {}), ...(s.bullet ? { bullet: s.bullet } : {}), align: s.align };
  } else if (el.type === 'table') {
    o.rows = el.rows.map((r) => r.map((c) => htmlToText(c.html)));
  } else if (el.type === 'chart') {
    o.chart = { type: el.chartType, title: el.chartTitle || '', data: el.data };
  } else if (el.type === 'image') {
    o.image = el.mediaId ? '有图片' : '空图片占位符';
  }
  return o;
}

function slideTitleOf(s) {
  const t = s.elements.find((e) => e.role === 'title');
  return t ? htmlToText(t.html).replace(/\n/g, ' ') : '';
}

function slideInfo(s, i) {
  return {
    index: i + 1,
    layout: LAYOUT_OUT[s.layout] || s.layout || 'blank',
    ...(s.hidden ? { hidden: true } : {}),
    title: slideTitleOf(s),
    elements: s.elements.map(elementInfo),
    notes: s.notes || '',
    ...(s.transition?.type && s.transition.type !== 'none' ? { transition: s.transition.type } : {}),
  };
}

/* ---------------- 构建 ---------------- */

/** 按版式生成一页并填好占位符 */
function buildSlide(deck, spec, transition) {
  let layout = LAYOUT_IN[spec.layout] || spec.layout || 'titleContent';
  if (!LAYOUTS.some((l) => l.id === layout)) layout = 'titleContent';
  const hasBody = spec.bullets?.length || spec.left || spec.right;
  if ((layout === 'titleOnly' || layout === 'blank') && hasBody) layout = 'titleContent';
  const s = newSlide(layout, deck);
  const setRole = (role, nth, val, asBullets = false) => {
    if (val == null || (Array.isArray(val) && !val.length) || val === '') return;
    const el = s.elements.filter((e) => e.role === role)[nth];
    if (el) el.html = asBullets ? bulletsToHtml(val) : bulletsToHtml(String(val).split('\n'));
  };
  setRole('title', 0, spec.title);
  if (layout === 'title' || layout === 'section') {
    setRole('subtitle', 0, spec.subtitle ?? (spec.bullets ? spec.bullets.flat(Infinity).join('\n') : null));
  } else if (layout === 'twoContent') {
    setRole('body', 0, spec.left ?? spec.bullets, true);
    setRole('body', 1, spec.right, true);
  } else if (layout === 'comparison') {
    setRole('body', 0, spec.left_heading);
    setRole('body', 1, spec.left ?? spec.bullets, true);
    setRole('body', 2, spec.right_heading);
    setRole('body', 3, spec.right, true);
  } else {
    setRole('body', 0, spec.bullets ?? spec.left, true);
  }
  // 要点很多时把正文字号调小一点，避免溢出
  const n = (spec.bullets || spec.left || []).flat?.(Infinity).length || 0;
  if (n > 6) s.elements.filter((e) => e.role === 'body').forEach((e) => (e.style = { ...e.style, fontSize: n > 9 ? 15 : 17 }));
  s.notes = spec.notes || '';
  if (transition) s.transition = { ...transition };
  return s;
}

/** Markdown 文本 → 幻灯片规格（# 标题开新页，列表项为要点） */
export function markdownToSlides(md) {
  const slides = [];
  let curSpec = null;
  for (const raw of String(md).split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const hm = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (hm) { curSpec = { layout: 'title_content', title: hm[1].replace(/\*\*/g, '').trim(), bullets: [] }; slides.push(curSpec); continue; }
    const lm = line.match(/^(\s*)([-*+•]|\d+[.)、])\s+(.*)$/);
    const text = (lm ? lm[3] : line.trim()).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
    if (/^\|?\s*:?-{2,}/.test(line.trim())) continue; // 表格分隔线
    if (!curSpec) { curSpec = { layout: 'title_content', title: lm ? '要点' : text, bullets: [] }; slides.push(curSpec); if (!lm) continue; }
    const lvl = lm ? Math.floor(lm[1].replace(/\t/g, '  ').length / 2) : 0;
    curSpec.bullets.push('  '.repeat(lvl) + text);
  }
  return slides.map((s) => (s.bullets.length ? s : { ...s, layout: 'title_only' }));
}

/* ---------------- 助手 ---------------- */

const SLIDE_SPEC = {
  type: 'object',
  properties: {
    layout: { type: 'string', enum: Object.keys(LAYOUT_IN), description: 'title=封面(标题+副标题)；section=节标题；title_content=标题+要点（最常用）；two_content=左右两栏(left/right)；comparison=比较(left_heading/left/right_heading/right)；title_only=只有标题；blank=空白；picture_caption=图片与说明' },
    title: { type: 'string' },
    subtitle: { type: 'string', description: '封面/节标题页的副标题' },
    bullets: { type: 'array', items: {}, description: '要点列表，每项一个短句。子要点用前导两个空格，或用嵌套数组' },
    left: { type: 'array', items: {}, description: '两栏/比较版式的左栏要点' },
    right: { type: 'array', items: {}, description: '两栏/比较版式的右栏要点' },
    left_heading: { type: 'string' },
    right_heading: { type: 'string' },
    notes: { type: 'string', description: '演讲者备注' },
  },
  required: ['layout'],
};

export function setupSlidesAI(api) {
  const { deck, E, ctx, change, goto } = api;
  const st = () => api.state(); // { cur, sel, editingId }
  const S = (i) => {
    const s = deck.slides[i - 1];
    if (!s) throw new Error(`没有第 ${i} 页（共 ${deck.slides.length} 页）`);
    return s;
  };
  const findEl = (s, id) => {
    const el = s.elements.find((e) => e.id === id);
    if (!el) throw new Error(`第 ${deck.slides.indexOf(s) + 1} 页没有 id 为 ${id} 的元素，请先用 get_current_slide 或 get_deck 查看`);
    return el;
  };
  const curTransition = () => (deck.slides[st().cur]?.transition ? { ...deck.slides[st().cur].transition } : null);
  const mutate = (fn, then) => { const r = change(fn, { slides: true }); if (then != null) goto(then); return r; };

  function insertSpecs(specs, position) {
    const tr = curTransition();
    const built = specs.map((sp) => buildSlide(deck, sp, tr));
    const at = position === 'end' ? deck.slides.length
      : typeof position === 'number' ? Math.max(0, Math.min(deck.slides.length, position - 1))
      : st().cur + 1;
    deck.slides.splice(at, 0, ...built);
    return at;
  }

  const selectedText = () => {
    const sel = window.getSelection();
    const t = sel && sel.rangeCount && api.layer.contains(sel.anchorNode) ? sel.toString() : '';
    if (t.trim()) return t.trim();
    const s = deck.slides[st().cur];
    return s.elements.filter((e) => st().sel.has(e.id) && (e.type === 'text' || e.type === 'shape')).map((e) => htmlToText(e.html)).join('\n').trim();
  };

  const tools = [
    {
      name: 'get_deck',
      description: '读取整份演示：主题、尺寸、每页的版式、标题、所有元素（id、类型、位置、纯文本）和备注。修改已有内容前先调用。页数多时用 from/count 分页。',
      input_schema: { type: 'object', properties: { from: { type: 'integer', description: '起始页码，从 1 开始' }, count: { type: 'integer', description: '读取页数，默认 30' } } },
      label: () => '读取演示文稿',
      run: ({ from = 1, count = 30 }) => {
        const start = Math.max(1, from), end = Math.min(deck.slides.length, start + Math.max(1, count) - 1);
        const th = getTheme(deck.theme);
        return {
          name: ctx.getName(), theme: { id: th.id, name: th.name }, size: deck.size, canvas: dims(deck), slide_count: deck.slides.length,
          current_slide: st().cur + 1,
          slides: deck.slides.slice(start - 1, end).map((s, k) => slideInfo(s, start - 1 + k)),
          ...(end < deck.slides.length ? { more: `还有第 ${end + 1}–${deck.slides.length} 页，用 from=${end + 1} 继续读取` } : {}),
        };
      },
    },
    {
      name: 'get_current_slide',
      description: '读取用户当前所在的那一页，以及当前选中的元素 id 和选中的文字。',
      input_schema: { type: 'object', properties: {} },
      label: () => '读取当前页',
      run: () => ({ ...slideInfo(deck.slides[st().cur], st().cur), selected_element_ids: [...st().sel], selected_text: selectedText() }),
    },
    {
      name: 'add_slides',
      description: '按版式新增一页或多页幻灯片，自动套用当前主题，是添加内容的首选方式（比 add_element 美观）。每页 3–6 条简短要点，细节写进 notes。',
      input_schema: {
        type: 'object',
        properties: {
          slides: { type: 'array', items: SLIDE_SPEC, description: '要新增的幻灯片' },
          position: { description: '"after_current"（默认，插在当前页后）、"end"（末尾），或页码数字（新页将成为第几页）' },
        },
        required: ['slides'],
      },
      label: (i) => `新增 ${i.slides?.length || 0} 页幻灯片`,
      run: ({ slides, position = 'after_current' }) => {
        if (!slides.length) throw new Error('slides 为空');
        const at = mutate(() => insertSpecs(slides, position));
        goto(at);
        return `已新增 ${slides.length} 页（第 ${at + 1}–${at + slides.length} 页），现在共 ${deck.slides.length} 页`;
      },
    },
    {
      name: 'replace_deck',
      description: '从零生成整份演示：清空现有所有幻灯片，换成给定的幻灯片。适合"做一份关于 X 的 PPT"。通常结构：封面(title) → 目录 → 若干内容页 → 总结/致谢。可同时指定主题。',
      input_schema: {
        type: 'object',
        properties: {
          slides: { type: 'array', items: SLIDE_SPEC },
          theme_id: { type: 'string', enum: THEMES.map((t) => t.id), description: `可选主题：${THEME_LIST}` },
          transition: { type: 'string', enum: TRANSITION_IDS, description: '可选，所有页统一的切换效果' },
        },
        required: ['slides'],
      },
      label: (i) => `生成整份演示（${i.slides?.length || 0} 页）`,
      run: ({ slides, theme_id, transition }) => {
        if (!slides.length) throw new Error('slides 为空');
        mutate(() => {
          if (theme_id) deck.theme = theme_id;
          const tr = transition ? { type: transition, duration: 0.7 } : null;
          deck.slides = slides.map((sp) => buildSlide(deck, sp, tr));
          st().sel.clear();
        });
        goto(0);
        return `已生成 ${slides.length} 页演示，主题：${getTheme(deck.theme).name}`;
      },
    },
    {
      name: 'update_slide',
      description: '修改某一页的标题、副标题、要点、备注、版式或隐藏状态。只传要改的字段；传 bullets 会整体替换正文要点。',
      input_schema: {
        type: 'object',
        properties: { index: { type: 'integer', description: '页码，从 1 开始' }, ...SLIDE_SPEC.properties, layout: { ...SLIDE_SPEC.properties.layout, description: '可选：换成另一种版式（保留标题和正文）' }, hidden: { type: 'boolean' } },
        required: ['index'],
      },
      label: (i) => `修改第 ${i.index} 页`,
      run: (inp) => {
        const s = S(inp.index);
        mutate(() => {
          const idx = deck.slides.indexOf(s);
          let target = s;
          const newLayout = inp.layout && (LAYOUT_IN[inp.layout] || inp.layout);
          if (newLayout && newLayout !== s.layout) {
            // 换版式：取旧内容为默认值，重建占位符，保留非占位符元素
            const bodies = s.elements.filter((e) => e.role === 'body').map((e) => htmlToText(e.html).split('\n'));
            const spec = {
              layout: inp.layout,
              title: inp.title ?? slideTitleOf(s),
              subtitle: inp.subtitle ?? htmlToText(s.elements.find((e) => e.role === 'subtitle')?.html),
              bullets: inp.bullets ?? (bodies[0]?.[0] ? bodies[0] : undefined),
              left: inp.left, right: inp.right ?? (bodies[1]?.[0] ? bodies[1] : undefined),
              left_heading: inp.left_heading, right_heading: inp.right_heading,
              notes: inp.notes ?? s.notes,
            };
            target = buildSlide(deck, spec, s.transition);
            target.id = s.id;
            target.bg = s.bg;
            target.hidden = s.hidden;
            const extra = s.elements.filter((e) => !e.role && !e.placeholder);
            target.elements.push(...extra);
            target.animations = (s.animations || []).filter((a) => extra.some((e) => e.id === a.elId));
            deck.slides[idx] = target;
          } else {
            const setRole = (role, nth, val, bullets) => {
              if (val == null) return;
              const el = target.elements.filter((e) => e.role === role)[nth];
              if (!el) throw new Error(`第 ${inp.index} 页的版式没有${role === 'title' ? '标题' : role === 'subtitle' ? '副标题' : '正文'}占位符，可同时传 layout 换版式`);
              el.html = bullets ? bulletsToHtml(val) : bulletsToHtml(String(val).split('\n'));
            };
            setRole('title', 0, inp.title);
            setRole('subtitle', 0, inp.subtitle);
            if (s.layout === 'comparison') {
              setRole('body', 0, inp.left_heading);
              setRole('body', 1, inp.left ?? inp.bullets, true);
              setRole('body', 2, inp.right_heading);
              setRole('body', 3, inp.right, true);
            } else {
              setRole('body', 0, inp.bullets ?? inp.left, true);
              setRole('body', 1, inp.right, true);
            }
            if (inp.notes != null) target.notes = inp.notes;
          }
          if (inp.hidden != null) target.hidden = inp.hidden;
          st().sel.clear();
        }, deck.slides.indexOf(s) >= 0 ? inp.index - 1 : null);
        return `已更新第 ${inp.index} 页`;
      },
    },
    {
      name: 'set_notes',
      description: '批量写入演讲者备注（一次可写多页）。',
      input_schema: { type: 'object', properties: { notes: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, notes: { type: 'string' } }, required: ['index', 'notes'] } } }, required: ['notes'] },
      label: (i) => `写入 ${i.notes?.length || 0} 页备注`,
      run: ({ notes }) => {
        notes.forEach((n) => S(n.index));
        mutate(() => notes.forEach((n) => (deck.slides[n.index - 1].notes = n.notes)));
        return `已写入 ${notes.length} 页备注`;
      },
    },
    {
      name: 'set_element_text',
      description: '替换某个文本框或形状里的文字（保留原有字体、颜色、项目符号样式）。多行用换行符分隔，子要点用前导两个空格。',
      input_schema: { type: 'object', properties: { slide: { type: 'integer', description: '页码，从 1 开始' }, element_id: { type: 'string' }, text: { type: 'string' } }, required: ['slide', 'element_id', 'text'] },
      label: (i) => `修改第 ${i.slide} 页文字`,
      run: ({ slide, element_id, text }) => {
        const s = S(slide), el = findEl(s, element_id);
        if (el.type === 'table') {
          const rows = text.split('\n').map((r) => r.split(/\t|\s*\|\s*/).filter((c, k, a) => !(c === '' && (k === 0 || k === a.length - 1))));
          mutate(() => { el.rows = rows.map((r) => el.colW.map((_, c) => ({ html: esc(r[c] ?? '') }))); }, slide - 1);
          return '已更新表格（按行、用 | 或制表符分列）';
        }
        if (el.type !== 'text' && el.type !== 'shape') throw new Error('这个元素不含文字');
        mutate(() => { el.html = bulletsToHtml(text.split('\n')); }, slide - 1);
        return `已更新第 ${slide} 页的文字`;
      },
    },
    {
      name: 'add_element',
      description: `在某页添加单个元素（坐标系 ${'960×540'}，16:9；4:3 时高 720）。type=text 文本框；shape 形状（kind 可选：${SHAPE_IDS.join('/')}）；table 表格（rows 二维数组，首行为表头）；chart 图表（chart_type：${CHART_IDS.join('/')}，labels + series）。整页内容优先用 add_slides。`,
      input_schema: {
        type: 'object',
        properties: {
          slide: { type: 'integer' },
          type: { type: 'string', enum: ['text', 'shape', 'table', 'chart'] },
          x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' },
          text: { type: 'string', description: 'text/shape 的文字' },
          kind: { type: 'string', description: '形状种类' },
          fill: { type: 'string', description: '形状填充色，如 #0071e3' },
          color: { type: 'string', description: '文字颜色' },
          font_size: { type: 'number', description: '字号（磅）' },
          bold: { type: 'boolean' },
          align: { type: 'string', enum: ['left', 'center', 'right'] },
          bullets: { type: 'boolean', description: '文本框是否显示项目符号' },
          rows: { type: 'array', items: { type: 'array', items: {} } },
          chart_type: { type: 'string' },
          chart_title: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
          series: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, values: { type: 'array', items: { type: 'number' } } }, required: ['values'] } },
        },
        required: ['slide', 'type'],
      },
      label: (i) => `第 ${i.slide} 页添加${{ text: '文本框', shape: '形状', table: '表格', chart: '图表' }[i.type] || '元素'}`,
      run: (inp) => {
        const s = S(inp.slide);
        const { w: CW, h: CH } = dims(deck);
        const box = (dw, dh) => {
          const w = Math.max(20, Math.min(CW, inp.w ?? dw)), h = Math.max(20, Math.min(CH, inp.h ?? dh));
          return { x: Math.max(0, Math.min(CW - 20, inp.x ?? Math.round((CW - w) / 2))), y: Math.max(0, Math.min(CH - 20, inp.y ?? Math.round((CH - h) / 2))), w, h };
        };
        let el;
        const style = { ...(inp.font_size ? { fontSize: inp.font_size } : {}), ...(inp.color ? { color: inp.color } : {}), ...(inp.bold ? { bold: true } : {}), ...(inp.align ? { align: inp.align } : {}) };
        if (inp.type === 'text') {
          el = textEl({ ...box(600, 80), html: bulletsToHtml((inp.text || '').split('\n')), style: { ...style, ...(inp.bullets ? { bullet: 'disc' } : {}) } });
        } else if (inp.type === 'shape') {
          const kind = SHAPE_IDS.includes(inp.kind) ? inp.kind : 'roundRect';
          el = shapeEl(kind, { ...box(240, 140), html: inp.text ? bulletsToHtml(inp.text.split('\n')) : '', ...(inp.fill ? { fill: { type: 'solid', color: inp.fill } } : {}), style });
        } else if (inp.type === 'table') {
          const rows = (inp.rows || []).map((r) => (Array.isArray(r) ? r : [r]));
          if (!rows.length) throw new Error('表格需要 rows');
          const cols = Math.max(...rows.map((r) => r.length));
          el = tableFrom(rows.map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? '')), box(Math.min(800, cols * 160), rows.length * 40));
        } else if (inp.type === 'chart') {
          const type = CHART_IDS.includes(inp.chart_type) ? inp.chart_type : 'bar';
          if (!inp.labels?.length || !inp.series?.length) throw new Error('图表需要 labels 和 series');
          el = chartEl({ ...box(640, 360), chartType: type, chartTitle: inp.chart_title || '', data: { labels: inp.labels.map(String), series: inp.series.map((x, k) => ({ name: x.name || `系列${k + 1}`, values: x.values.map(Number) })) } });
        }
        mutate(() => { s.elements.push(el); }, inp.slide - 1);
        return `已添加，元素 id：${el.id}`;
      },
    },
    {
      name: 'update_element',
      description: '调整某个元素的位置大小或文字样式（字号、字体、颜色、加粗、对齐、形状填充色）。',
      input_schema: {
        type: 'object',
        properties: {
          slide: { type: 'integer' }, element_id: { type: 'string' },
          x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' },
          font_size: { type: 'number' }, font: { type: 'string' }, color: { type: 'string' }, bold: { type: 'boolean' },
          align: { type: 'string', enum: ['left', 'center', 'right'] }, fill: { type: 'string' },
        },
        required: ['slide', 'element_id'],
      },
      label: (i) => `调整第 ${i.slide} 页元素`,
      run: (inp) => {
        const s = S(inp.slide), el = findEl(s, inp.element_id);
        mutate(() => {
          for (const k of ['x', 'y', 'w', 'h']) if (inp[k] != null) el[k] = Math.round(inp[k]);
          el.style = { ...(el.style || {}) };
          if (inp.font_size != null) el.style.fontSize = inp.font_size;
          if (inp.font) el.style.fontFamily = inp.font;
          if (inp.color) el.style.color = inp.color;
          if (inp.bold != null) el.style.bold = inp.bold;
          if (inp.align) el.style.align = inp.align;
          if (inp.fill && el.type === 'shape') el.fill = { type: 'solid', color: inp.fill };
        }, inp.slide - 1);
        return '已调整';
      },
    },
    {
      name: 'restyle_text',
      description: `统一文字样式：把整份（或当前页）所有标题/正文设为相同字体、字号、颜色，同时清掉文字里零散的行内字体字号。常用字体：${FONT_FAMILIES.slice(0, 8).map((f) => f.value).join('、')}。`,
      input_schema: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['all', 'current'] },
          font: { type: 'string' }, title_size: { type: 'number' }, body_size: { type: 'number' },
          title_color: { type: 'string' }, body_color: { type: 'string' },
        },
        required: ['scope'],
      },
      label: (i) => (i.scope === 'current' ? '统一当前页文字样式' : '统一全部文字样式'),
      run: (inp) => {
        const targets = inp.scope === 'current' ? [deck.slides[st().cur]] : deck.slides;
        let n = 0;
        const clean = (html) => html.replace(/\s*(font-family|font-size)\s*:[^;"]*;?/gi, '').replace(/<font[^>]*>|<\/font>/gi, '').replace(/ style=""/g, '');
        mutate(() => {
          for (const s of targets) for (const el of s.elements) {
            if (el.type !== 'text' && !(el.type === 'shape' && el.html)) continue;
            const isTitle = el.role === 'title';
            el.style = { ...(el.style || {}) };
            if (inp.font) el.style.fontFamily = inp.font;
            if (isTitle && inp.title_size) el.style.fontSize = inp.title_size;
            if (!isTitle && el.type === 'text' && el.role !== 'subtitle' && inp.body_size) el.style.fontSize = inp.body_size;
            if (isTitle && inp.title_color) el.style.color = inp.title_color;
            if (!isTitle && el.type === 'text' && inp.body_color) el.style.color = inp.body_color;
            if (inp.font || inp.title_size || inp.body_size) el.html = clean(el.html || '');
            n++;
          }
        });
        return `已统一 ${n} 个文本元素的样式`;
      },
    },
    {
      name: 'delete_elements',
      description: '删除某页上的若干元素。',
      input_schema: { type: 'object', properties: { slide: { type: 'integer' }, element_ids: { type: 'array', items: { type: 'string' } } }, required: ['slide', 'element_ids'] },
      label: (i) => `删除第 ${i.slide} 页 ${i.element_ids?.length || 0} 个元素`,
      run: ({ slide, element_ids }) => {
        const s = S(slide);
        element_ids.forEach((id) => findEl(s, id));
        mutate(() => {
          const ids = new Set(element_ids);
          s.elements = s.elements.filter((e) => !ids.has(e.id));
          s.animations = (s.animations || []).filter((a) => !ids.has(a.elId));
          st().sel.clear();
        }, slide - 1);
        return `已删除 ${element_ids.length} 个元素`;
      },
    },
    {
      name: 'delete_slides',
      description: '删除若干页幻灯片（页码从 1 开始）。',
      input_schema: { type: 'object', properties: { indices: { type: 'array', items: { type: 'integer' } } }, required: ['indices'] },
      label: (i) => `删除 ${i.indices?.length || 0} 页`,
      run: ({ indices }) => {
        const set = new Set(indices);
        indices.forEach(S);
        mutate(() => {
          deck.slides = deck.slides.filter((_, i) => !set.has(i + 1));
          if (!deck.slides.length) deck.slides.push(newSlide('title', deck));
          st().sel.clear();
        });
        goto(Math.min(Math.min(...indices) - 1, deck.slides.length - 1));
        return `已删除，剩余 ${deck.slides.length} 页`;
      },
    },
    {
      name: 'move_slide',
      description: '把第 from 页移动到第 to 页的位置。',
      input_schema: { type: 'object', properties: { from: { type: 'integer' }, to: { type: 'integer' } }, required: ['from', 'to'] },
      label: (i) => `第 ${i.from} 页移到第 ${i.to} 页`,
      run: ({ from, to }) => {
        S(from);
        const t = Math.max(1, Math.min(deck.slides.length, to));
        mutate(() => { const [m] = deck.slides.splice(from - 1, 1); deck.slides.splice(t - 1, 0, m); }, t - 1);
        return `已移动到第 ${t} 页`;
      },
    },
    {
      name: 'duplicate_slide',
      description: '复制某一页，副本插在它后面。',
      input_schema: { type: 'object', properties: { index: { type: 'integer' } }, required: ['index'] },
      label: (i) => `复制第 ${i.index} 页`,
      run: ({ index }) => {
        const s = S(index);
        mutate(() => deck.slides.splice(index, 0, cloneSlide(s)), index);
        return `已复制为第 ${index + 1} 页`;
      },
    },
    {
      name: 'apply_theme',
      description: `给整份演示换主题（背景、配色、字体一起变）。可选：${THEME_LIST}。`,
      input_schema: { type: 'object', properties: { theme_id: { type: 'string', enum: THEMES.map((t) => t.id) } }, required: ['theme_id'] },
      label: (i) => `应用主题「${getTheme(i.theme_id).name}」`,
      run: ({ theme_id }) => {
        mutate(() => { deck.theme = theme_id; deck.slides.forEach((s) => (s.bg = null)); });
        return `已应用主题：${getTheme(theme_id).name}`;
      },
    },
    {
      name: 'set_transition',
      description: `设置切换效果。scope=all 应用到所有页，current 只设当前页。可选：${TRANSITIONS.map((t) => `${t.id}(${t.name})`).join('、')}。`,
      input_schema: { type: 'object', properties: { type: { type: 'string', enum: TRANSITION_IDS }, scope: { type: 'string', enum: ['all', 'current'] }, duration: { type: 'number', description: '秒，默认 0.7' } }, required: ['type'] },
      label: (i) => `设置切换效果：${TRANSITIONS.find((t) => t.id === i.type)?.name || i.type}`,
      run: ({ type, scope = 'all', duration = 0.7 }) => {
        const tr = { type, duration: Math.max(0.1, Math.min(10, duration)) };
        mutate(() => (scope === 'current' ? [deck.slides[st().cur]] : deck.slides).forEach((s) => (s.transition = { ...tr })));
        return `已设置${scope === 'current' ? '当前页' : '全部页'}的切换效果`;
      },
    },
    {
      name: 'goto_slide',
      description: '跳转到某一页，让用户看到它。',
      input_schema: { type: 'object', properties: { index: { type: 'integer' } }, required: ['index'] },
      label: (i) => `跳到第 ${i.index} 页`,
      run: ({ index }) => { S(index); goto(index - 1); return `当前在第 ${index} 页`; },
    },
  ];

  const systemPrompt = `你现在在"演示"应用里，帮用户制作和修改幻灯片（类似 PowerPoint）。

制作原则：
- 新做一整份演示用 replace_deck（或在已有内容后用 add_slides），一次性传入所有页，不要逐个 add_element 拼。
- 典型结构：封面(title 版式，副标题写汇报人/日期等) → 目录/议程 → 内容页（title_content、two_content、comparison 交替） → 总结/下一步 → 致谢。默认 6–10 页。
- 每页 3–6 条要点，每条一句话、不超过约 20 个字，不写大段文字；详细说明写进 notes（演讲者备注）。
- 新演示根据主题选择合适的配色主题（theme_id），例如商务汇报用 navy/blue，教学用 green/gray，发布会用 tech/purple。
- 修改已有页面前先用 get_deck 或 get_current_slide 读取内容和元素 id，再用 update_slide / set_element_text 修改，保持原有排版。
- 页码一律从 1 开始。坐标系宽 960，高 540（16:9）或 720（4:3）。
- 数据图表用 add_element 的 chart 类型；没有真实数据时要说明是示例数据。`;

  const placeholderName = () => /^新建演示文稿/.test(ctx.getName() || '');
  let ai;
  const quickActions = [
    {
      label: '根据主题生成整份PPT', icon: 'presentation',
      prompt: () => {
        if (placeholderName()) { ai.open('帮我做一份关于「」的演示文稿，大约 8 页，风格简洁商务'); return null; }
        return `请根据标题「${ctx.getName()}」生成一整份约 8 页的演示文稿，选择合适的主题，并为每页写演讲备注。`;
      },
    },
    { label: '优化当前页文案', icon: 'wand-sparkles', prompt: () => `请优化第 ${st().cur + 1} 页的文案：标题更有力，要点精炼成 3–6 条短句，保持原意和排版。` },
    { label: '为每页生成演讲备注', icon: 'notebook-pen', prompt: '请为每一页生成简洁口语化的演讲者备注（每页 80–150 字），用 set_notes 一次写入。' },
    { label: '新增一页总结', icon: 'list-checks', prompt: '请读取全部内容，在最后新增一页总结，提炼全篇 3–5 个核心要点。' },
    { label: '翻译成英文', icon: 'languages', prompt: '请把整份演示的所有文字（标题、要点、表格、备注）翻译成自然流畅的英文，保持版式不变。' },
    { label: '统一字体与风格', icon: 'type', prompt: '请检查整份演示的字体、字号和颜色是否统一，然后用 restyle_text 统一：标题一个字号、正文一个字号、同一种字体。' },
    {
      label: '把选中文字变成要点', icon: 'list',
      prompt: () => {
        const t = selectedText();
        if (!t) { toast('请先在幻灯片上选中文字或文本框', 'info'); return null; }
        return `把下面这段选中的文字提炼成 3–6 条简洁要点，替换掉第 ${st().cur + 1} 页里原来的这段文字：\n\n${t}`;
      },
    },
  ];

  const messageActions = [
    {
      label: '插入为新幻灯片', icon: 'gallery-vertical-end',
      run: (text) => {
        const specs = markdownToSlides(text);
        if (!specs.length) { toast('回复里没有可转换的内容', 'info'); return; }
        const at = mutate(() => insertSpecs(specs, 'after_current'));
        goto(at);
        toast(`已插入 ${specs.length} 页幻灯片`, 'success');
      },
    },
  ];

  ai = createAssistant({
    appName: '演示文稿',
    systemPrompt,
    tools,
    quickActions,
    messageActions,
    placeholder: '例如：做一份 8 页的年度总结 PPT',
    getContext: () => {
      const { cur, sel } = st();
      const s = deck.slides[cur];
      const selEls = s.elements.filter((e) => sel.has(e.id));
      const lines = [
        `文件名：${ctx.getName()}`,
        `共 ${deck.slides.length} 页，当前第 ${cur + 1} 页「${slideTitleOf(s) || '无标题'}」（版式 ${LAYOUT_OUT[s.layout] || s.layout}）`,
        `主题：${getTheme(deck.theme).name}（${deck.theme}），尺寸 ${deck.size}`,
      ];
      if (deck.slides.length === 1 && s.elements.every((e) => e.type === 'image' ? !e.mediaId : isTextEmpty(e.html))) lines.push('演示文稿目前是空白的');
      if (selEls.length) lines.push('选中元素：' + selEls.map((e) => `${e.id}(${e.type}${e.role ? '/' + e.role : ''})`).join('、'));
      const t = selectedText();
      if (t) lines.push('选中文字：' + (t.length > 1500 ? t.slice(0, 1500) + '…（已截断，可用 get_current_slide 读取全文）' : t));
      return lines.join('\n');
    },
    onToggle: (on) => { api.onToggle && api.onToggle(on); },
  });
  ai._tools = tools; // 便于调试
  return ai;
}
