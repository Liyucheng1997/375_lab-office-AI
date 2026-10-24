// 文字应用的 AI 适配层：把文档读写包装成工具交给共享的 AI 助手面板。
// 文档按"顶层块"编号（段落、标题、列表、表格……从 0 开始）；所有修改都走 E.run，每次工具调用 = 一步撤销。
import { createAssistant } from '../../ai/panel.js';
import { toast } from '../../core/ui.js';
import { markdownToHTML, htmlToMarkdown, PAPER_SIZES } from './io.js';
import * as T from './table.js';

const PAGE_CHAR_BUDGET = 30000; // get_document 单次返回的大致字数上限，超出时分页

const STYLE_ALIASES = {
  正文: 'normal', 标题: 'title', 副标题: 'subtitle', 标题1: 'h1', '标题 1': 'h1', 标题2: 'h2', '标题 2': 'h2',
  标题3: 'h3', '标题 3': 'h3', 标题4: 'h4', '标题 4': 'h4', 引用: 'quote', 代码: 'code',
};

export function setupWriterAI(E) {
  const { doc } = E;
  let lastSel = null; // 发送消息时记下的选区：用户点进 AI 面板后仍能作用于原来的选中内容

  /* ---------- 文档结构 ---------- */
  const blocks = () => [...doc.children];
  const blockIndex = (el) => blocks().indexOf(el);
  const getBlock = (i) => {
    const list = blocks();
    if (!Number.isInteger(i) || i < 0 || i >= list.length) throw new Error(`块编号 ${i} 不存在（共 ${list.length} 块，编号 0-${list.length - 1}）`);
    return list[i];
  };

  function blockText(el) {
    if (el.classList.contains('wr-pagebreak')) return '（分页符）';
    if (el.classList.contains('wr-toc')) return '（目录）';
    if (el.classList.contains('wr-footnotes')) return '脚注：' + [...el.querySelectorAll('li')].map((li, i) => `[${i + 1}] ${li.textContent.trim()}`).join('；');
    const md = htmlToMarkdown(el.outerHTML).trim()
      .replace(/!\[([^\]]*)\]\(data:[^)]*\)/g, (_, alt) => `[图片${alt ? '：' + alt : ''}]`)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => `[图片${alt ? '：' + alt : ''}]`);
    if (!md) return el.querySelector('img') ? '[图片]' : '（空段落）';
    return md;
  }

  /** 当前选区：优先实时选区，其次文档里记住的选区，最后是发送消息时记下的选区 */
  function selRange() {
    const r = E.getRange();
    if (r && !r.collapsed) return r;
    if (lastSel && !lastSel.collapsed && lastSel.startContainer.isConnected && doc.contains(lastSel.commonAncestorContainer)) return lastSel;
    return null;
  }
  const caretRange = () => E.getRange();

  function mdToNodes(md) {
    if (!String(md || '').trim()) throw new Error('内容为空');
    const tpl = document.createElement('template');
    tpl.innerHTML = markdownToHTML(String(md || ''));
    const nodes = [...tpl.content.childNodes].filter((n) => n.nodeType === 1 || n.textContent.trim());
    if (!nodes.length) throw new Error('内容为空');
    return nodes;
  }
  const isSinglePara = (nodes) => nodes.length === 1 && nodes[0].tagName === 'P';

  /** 把一个段落的内联内容插到 range 处 */
  function insertInline(range, p) {
    const frag = document.createDocumentFragment();
    while (p.firstChild) frag.append(p.firstChild);
    range.insertNode(frag);
    lastSel = null;
  }

  /** 在指定位置插入一组块 */
  function insertNodes(nodes, position = 'cursor', index) {
    const list = blocks();
    const footnotes = doc.querySelector(':scope > .wr-footnotes');
    if (position === 'start') {
      doc.prepend(...nodes);
    } else if (position === 'end') {
      const anchor = footnotes || null;
      let last = anchor ? anchor.previousElementSibling : doc.lastElementChild;
      // 文末的空段落直接替换掉
      if (last && last.tagName === 'P' && !last.textContent.trim() && !last.querySelector('img')) { last.replaceWith(...nodes); }
      else if (anchor) anchor.before(...nodes);
      else doc.append(...nodes);
    } else if (position === 'after_block') {
      getBlock(index).after(...nodes);
    } else {
      // cursor：单个段落且光标在文字块内 → 行内插入；否则作为新块插到光标所在块后面（必要时拆分段落）
      const r = caretRange();
      const inText = r && E.closestIn(r.startContainer, 'p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote');
      if (r && inText && isSinglePara(nodes)) {
        const rr = r.cloneRange();
        rr.collapse(false);
        insertInline(rr, nodes[0]);
      } else if (!r && !list.length) {
        doc.append(...nodes);
      } else {
        const first = E.insertBlock(nodes[0]);
        first.after(...nodes.slice(1));
      }
    }
    E.normalize();
  }

  const mutate = (fn) => E.run(fn, { focus: false });
  const countBlocks = (nodes) => `${nodes.length} 块内容`;

  /* ---------- 工具 ---------- */
  const tools = [
    {
      name: 'get_document',
      description: '读取文档内容。返回每个顶层块（段落/标题/列表/表格…）的编号和 Markdown 文本，以及页面设置。修改已有内容前先调用它了解结构；长文档会分页，按返回提示用 start 继续读取。',
      input_schema: {
        type: 'object',
        properties: {
          start: { type: 'integer', description: '从第几块开始（默认 0）' },
          count: { type: 'integer', description: '最多读取多少块（默认读到字数上限为止）' },
        },
        required: [],
      },
      label: (i) => (i.start ? `读取文档（从第 ${i.start} 块）` : '读取文档'),
      run({ start = 0, count }) {
        const list = blocks();
        const s = Math.max(0, start | 0);
        const end = count ? Math.min(list.length, s + Math.max(1, count | 0)) : list.length;
        const out = [];
        let chars = 0, i = s;
        for (; i < end; i++) {
          const t = blockText(list[i]);
          if (chars && chars + t.length > PAGE_CHAR_BUDGET) break;
          out.push(`[${i}] ${t}`);
          chars += t.length;
        }
        const p = E.state.page;
        const head = `共 ${list.length} 块，${E.stats().words} 字，${E.pageCount} 页。纸张 ${p.size} ${p.orientation === 'landscape' ? '横向' : '纵向'}，页边距(毫米) 上${p.margins.top} 下${p.margins.bottom} 左${p.margins.left} 右${p.margins.right}${p.watermark ? '，水印"' + p.watermark.text + '"' : ''}。`;
        const more = i < list.length ? `\n\n（还有第 ${i}-${list.length - 1} 块未显示，用 start=${i} 继续读取）` : '';
        return `${head}\n\n${out.join('\n\n') || '（没有内容）'}${more}`;
      },
    },
    {
      name: 'get_selection',
      description: '读取用户当前选中的文字以及它所在的段落。用户说"这段""选中的内容"时使用。',
      input_schema: { type: 'object', properties: {}, required: [] },
      label: () => '读取选中内容',
      run() {
        const r = selRange();
        if (!r) {
          const c = caretRange();
          const tb = c && E.topBlock(c.startContainer);
          return tb ? `没有选中内容。光标位于第 ${blockIndex(tb)} 块：${blockText(tb)}` : '没有选中内容，光标也不在文档里。';
        }
        const a = E.topBlock(r.startContainer), b = E.topBlock(r.endContainer);
        const ia = blockIndex(a), ib = blockIndex(b);
        const ctxText = ia === ib && a ? `\n\n所在段落（第 ${ia} 块）：${blockText(a)}` : `\n\n选区跨越第 ${ia}-${ib} 块。`;
        return `选中内容：\n${r.toString()}${ctxText}`;
      },
    },
    {
      name: 'insert_content',
      description: '插入新内容（Markdown：# 标题、**粗体**、*斜体*、- 列表、1. 编号、> 引用、| 表格 |、```代码```）。position：cursor=光标处（单段文字会接在光标后面，多段会作为新段落插入）、start=文首、end=文末、after_block=指定块之后。',
      input_schema: {
        type: 'object',
        properties: {
          markdown: { type: 'string', description: '要插入的 Markdown 内容' },
          position: { type: 'string', enum: ['cursor', 'start', 'end', 'after_block'], description: '插入位置，默认 cursor' },
          block_index: { type: 'integer', description: 'position=after_block 时的块编号' },
        },
        required: ['markdown'],
      },
      label: (i) => `插入内容${{ start: '到文首', end: '到文末', after_block: `到第 ${i.block_index} 块后` }[i.position] || ''}`,
      run({ markdown, position = 'cursor', block_index }) {
        if (position === 'after_block') getBlock(block_index);
        const nodes = mdToNodes(markdown);
        mutate(() => insertNodes(nodes, position, block_index));
        return `已插入 ${countBlocks(nodes)}。`;
      },
    },
    {
      name: 'replace_selection',
      description: '用新内容（Markdown）替换用户选中的文字。润色、翻译、改写选中内容时使用。没有选中内容时会报错。',
      input_schema: {
        type: 'object',
        properties: { markdown: { type: 'string', description: '替换后的内容' } },
        required: ['markdown'],
      },
      label: () => '替换选中内容',
      run({ markdown }) {
        const r = selRange();
        if (!r) throw new Error('当前没有选中内容。请改用 replace_block 指定块编号，或先让用户选中文字。');
        const nodes = mdToNodes(markdown);
        mutate(() => {
          const range = r.cloneRange();
          const startBlock = E.topBlock(range.startContainer), endBlock = E.topBlock(range.endContainer);
          // 选区正好覆盖若干整块：整块替换，避免留下空段落
          const whole = startBlock && endBlock && range.toString().trim() &&
            blocks().slice(blockIndex(startBlock), blockIndex(endBlock) + 1).map((b) => b.textContent).join('').replace(/\s/g, '') === range.toString().replace(/\s/g, '');
          if (whole && !isSinglePara(nodes)) {
            const span = blocks().slice(blockIndex(startBlock), blockIndex(endBlock) + 1);
            span[0].before(...nodes);
            span.forEach((b) => b.remove());
          } else {
            range.deleteContents();
            if (isSinglePara(nodes)) insertInline(range, nodes[0]);
            else {
              const tb = E.topBlock(range.startContainer);
              const cut = document.createRange();
              cut.setStart(range.startContainer, range.startOffset);
              if (tb) cut.setEndAfter(tb);
              const tail = tb ? cut.extractContents() : null;
              if (tb) tb.after(...nodes, ...(tail ? [tail] : []));
              else doc.append(...nodes);
              if (tb && !tb.textContent.trim() && !tb.querySelector('img')) tb.remove();
            }
          }
          lastSel = null;
          E.normalize();
          doc.querySelectorAll(':scope > p').forEach((p) => { if (!p.textContent.trim() && !p.querySelector('img,br')) p.remove(); });
        });
        return '已替换选中内容。';
      },
    },
    {
      name: 'replace_block',
      description: '用新内容（Markdown，可以是多段）替换指定编号的块。逐段润色、改写某一段时使用。',
      input_schema: {
        type: 'object',
        properties: {
          block_index: { type: 'integer', description: '要替换的块编号' },
          markdown: { type: 'string', description: '新内容' },
        },
        required: ['block_index', 'markdown'],
      },
      label: (i) => `改写第 ${i.block_index} 块`,
      run({ block_index, markdown }) {
        const el = getBlock(block_index);
        const nodes = mdToNodes(markdown);
        mutate(() => { el.replaceWith(...nodes); E.normalize(); });
        return `已替换第 ${block_index} 块为 ${countBlocks(nodes)}。`;
      },
    },
    {
      name: 'delete_blocks',
      description: '删除从 from 到 to（含）的块。',
      input_schema: {
        type: 'object',
        properties: { from: { type: 'integer' }, to: { type: 'integer', description: '默认等于 from' } },
        required: ['from'],
      },
      label: (i) => (i.to != null && i.to !== i.from ? `删除第 ${i.from}-${i.to} 块` : `删除第 ${i.from} 块`),
      run({ from, to = from }) {
        if (to < from) [from, to] = [to, from];
        getBlock(from); getBlock(to);
        mutate(() => { blocks().slice(from, to + 1).forEach((b) => b.remove()); E.normalize(); });
        return `已删除 ${to - from + 1} 块。`;
      },
    },
    {
      name: 'replace_document',
      description: '用新内容（Markdown）替换整篇文档正文。只在从零撰写、整篇重写或整篇翻译时使用；局部修改请用 replace_block / insert_content。',
      input_schema: {
        type: 'object',
        properties: { markdown: { type: 'string', description: '完整的新文档' } },
        required: ['markdown'],
      },
      label: () => '重写整篇文档',
      run({ markdown }) {
        const nodes = mdToNodes(markdown);
        mutate(() => { doc.replaceChildren(...nodes); E.normalize(); });
        lastSel = null;
        return `已写入新文档，共 ${countBlocks(nodes)}。`;
      },
    },
    {
      name: 'find_replace',
      description: '在全文中查找并替换文字（不跨格式边界）。统一术语、批量改名时使用。',
      input_schema: {
        type: 'object',
        properties: {
          find: { type: 'string' },
          replace: { type: 'string' },
          all: { type: 'boolean', description: '是否替换全部，默认 true' },
          match_case: { type: 'boolean', description: '区分大小写，默认 false' },
        },
        required: ['find', 'replace'],
      },
      label: (i) => `把"${String(i.find).slice(0, 12)}"替换为"${String(i.replace).slice(0, 12)}"`,
      run({ find, replace, all = true, match_case = false }) {
        if (!find) throw new Error('查找内容不能为空');
        const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), match_case ? 'g' : 'gi');
        let n = 0;
        mutate(() => {
          const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
          const nodes = [];
          let t;
          while ((t = walker.nextNode())) nodes.push(t);
          for (const node of nodes) {
            if (!all && n) break;
            re.lastIndex = 0;
            if (!re.test(node.data)) continue;
            re.lastIndex = 0;
            node.data = node.data.replace(re, (m) => (!all && n ? m : (n++, replace)));
          }
        });
        return n ? `已替换 ${n} 处。` : `没有找到"${find}"。`;
      },
    },
    {
      name: 'apply_style',
      description: '给段落设置样式和/或对齐方式。target 可以是 "selection"（用户选中的段落）、单个块编号如 "3"、或范围如 "3-7"。style：normal 正文、title 标题、subtitle 副标题、h1/h2/h3/h4 各级标题、quote 引用、code 代码。',
      input_schema: {
        type: 'object',
        properties: {
          target: { type: 'string', description: '"selection"、"3" 或 "3-7"' },
          style: { type: 'string', enum: ['normal', 'title', 'subtitle', 'h1', 'h2', 'h3', 'h4', 'quote', 'code'] },
          align: { type: 'string', enum: ['left', 'center', 'right', 'justify'] },
        },
        required: ['target'],
      },
      label: (i) => `设置样式${i.style ? '：' + (E.STYLES[i.style]?.label || i.style) : ''}${i.align ? '，' + { left: '左对齐', center: '居中', right: '右对齐', justify: '两端对齐' }[i.align] : ''}`,
      run({ target, style, align }) {
        const key = style && (E.STYLES[style] ? style : STYLE_ALIASES[style]);
        if (style && !key) throw new Error('未知样式 ' + style);
        if (!key && !align) throw new Error('style 和 align 至少给一个');
        let targets;
        const t = String(target).trim();
        if (t === 'selection') {
          if (!E.getRange() && !lastSel) throw new Error('当前没有选区');
          targets = E.selectedBlocks();
          if (!targets.length) throw new Error('当前没有选区');
        } else {
          const m = t.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
          if (!m) throw new Error('target 格式应为 "selection"、"3" 或 "3-7"');
          const a = +m[1], b = m[2] != null ? +m[2] : a;
          getBlock(a); getBlock(b);
          targets = blocks().slice(Math.min(a, b), Math.max(a, b) + 1);
        }
        let changed = 0;
        mutate(() => {
          for (let el of targets) {
            if (key && /^(P|H[1-6]|BLOCKQUOTE|PRE)$/.test(el.tagName)) {
              const st = E.STYLES[key];
              if (el.tagName !== st.tag.toUpperCase()) {
                const nel = document.createElement(st.tag);
                if (el.getAttribute('style')) nel.setAttribute('style', el.getAttribute('style'));
                if (el.id) nel.id = el.id;
                while (el.firstChild) nel.append(el.firstChild);
                el.replaceWith(nel);
                el = nel;
              }
              el.classList.remove('wr-title', 'wr-subtitle');
              if (st.cls) el.classList.add(st.cls);
              if (!el.className) el.removeAttribute('class');
            }
            if (align) el.style.textAlign = align;
            changed++;
          }
        });
        return `已设置 ${changed} 个段落。`;
      },
    },
    {
      name: 'set_page',
      description: '页面设置：纸张大小、方向、页边距（厘米）、水印文字（空字符串表示去掉水印）。',
      input_schema: {
        type: 'object',
        properties: {
          size: { type: 'string', enum: Object.keys(PAPER_SIZES) },
          orientation: { type: 'string', enum: ['portrait', 'landscape'] },
          margins_cm: {
            type: 'object',
            description: '页边距，单位厘米，可只给部分',
            properties: { top: { type: 'number' }, bottom: { type: 'number' }, left: { type: 'number' }, right: { type: 'number' } },
          },
          watermark: { type: 'string', description: '水印文字；"" 去掉水印' },
        },
        required: [],
      },
      label: () => '修改页面设置',
      run({ size, orientation, margins_cm, watermark }) {
        const patch = {};
        if (size) patch.size = size;
        if (orientation) patch.orientation = orientation;
        if (margins_cm) {
          const m = { ...E.state.page.margins };
          for (const k of ['top', 'bottom', 'left', 'right']) if (typeof margins_cm[k] === 'number') m[k] = Math.max(0, Math.min(100, margins_cm[k] * 10));
          patch.margins = m;
        }
        if (watermark != null) patch.watermark = watermark ? { text: watermark, size: 72, color: '#c0c0c0', opacity: 0.35, diagonal: true } : null;
        if (!Object.keys(patch).length) throw new Error('没有要修改的设置');
        E.updatePage(patch);
        return '页面设置已更新。';
      },
    },
    {
      name: 'insert_table',
      description: '插入表格。rows 是二维文字数组（第一行通常是表头）。位置参数同 insert_content。',
      input_schema: {
        type: 'object',
        properties: {
          rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: '表格内容，按行排列' },
          header: { type: 'boolean', description: '第一行是否为表头（加粗），默认 true' },
          style: { type: 'string', enum: ['grid', 'blue', 'three', 'none'], description: '样式：grid 普通网格（默认）、blue 蓝色标题行、three 三线表、none 无框线' },
          position: { type: 'string', enum: ['cursor', 'start', 'end', 'after_block'] },
          block_index: { type: 'integer' },
        },
        required: ['rows'],
      },
      label: (i) => `插入 ${i.rows?.length || 0} 行表格`,
      run({ rows, header = true, style = 'grid', position = 'cursor', block_index }) {
        if (!rows.length || !rows.every(Array.isArray)) throw new Error('rows 必须是非空的二维数组');
        if (position === 'after_block') getBlock(block_index);
        const cols = Math.max(...rows.map((r) => r.length), 1);
        const cls = { grid: '', blue: 'wr-ts-blue', three: 'wr-ts-three', none: 'wr-tb-none' }[style] || '';
        const tpl = document.createElement('template');
        tpl.innerHTML = T.tableHTML(rows.length, cols, cls);
        const table = tpl.content.firstChild;
        rows.forEach((row, r) => {
          for (let c = 0; c < cols; c++) {
            const cell = table.rows[r].cells[c];
            const v = row[c] == null ? '' : String(row[c]);
            if (!v) continue;
            cell.textContent = v;
            if (header && r === 0) cell.innerHTML = `<b>${cell.innerHTML}</b>`;
          }
        });
        mutate(() => insertNodes([table], position, block_index));
        return `已插入 ${rows.length} 行 × ${cols} 列的表格。`;
      },
    },
  ];

  /* ---------- 文档状态（每次发送时附带） ---------- */
  function getContext() {
    const r = E.getRange();
    lastSel = r && !r.collapsed ? r.cloneRange() : null;
    const list = blocks();
    const s = E.stats();
    const lines = [`文档：${E.ctx.getName() || '未命名'}`, `共 ${E.pageCount} 页，${s.words} 字，${list.length} 块（块编号从 0 开始）`];
    const tb = r && E.topBlock(r.startContainer);
    if (tb) lines.push(`光标在第 ${blockIndex(tb)} 块：${blockText(tb).slice(0, 120)}`);
    else lines.push('光标不在文档中（插入到 cursor 时会放在文末附近）');
    if (lastSel) {
      const t = lastSel.toString();
      lines.push(`用户选中了 ${t.length} 字：「${t.length > 500 ? t.slice(0, 500) + '…（已截断，完整内容用 get_selection 读取）' : t}」`);
    } else lines.push('没有选中内容');
    const hs = E.headingList().slice(0, 30);
    if (hs.length) {
      lines.push('标题大纲：');
      for (const hd of hs) lines.push(`${'  '.repeat(+hd.tagName[1] - 1)}- [${blockIndex(E.topBlock(hd))}] ${E.headingText(hd)}`);
    } else if (s.words === 0) lines.push('文档目前是空的。');
    return lines.join('\n');
  }

  const hasSel = () => !!selRange();
  const bySel = (withSel, without) => () => (hasSel() ? withSel : without);

  const ai = createAssistant({
    appName: '文字文档',
    placeholder: '让 AI 写作、改写、翻译、总结…',
    systemPrompt: `你现在在"文字"应用（类似 Word）里工作。
- 文档由顶层"块"组成（段落、标题、列表、表格等），用块编号定位。修改已有内容前先用 get_document 了解结构；用户说"这段/选中的"时用 get_selection 或 replace_selection。
- 写新内容时用 Markdown 组织：标题分层（# 一级、## 二级）、段落充实、适当使用列表和表格，写出结构完整、可直接使用的正式中文文档。
- 局部修改用 replace_block / replace_selection / insert_content；只有从零撰写或整篇重写、整篇翻译时才用 replace_document。
- 逐段改写时保留原有的标题层级和结构，不要无故删减内容。
- 修改完成后简短说明改了哪里（例如"润色了第 3-5 段"）。`,
    getContext,
    tools,
    quickActions: [
      { label: '续写', icon: 'pen-line', prompt: '根据上下文在光标处续写约 300 字，风格与前文保持一致。' },
      { label: '润色', icon: 'wand-sparkles', prompt: bySel('润色我选中的内容，让表达更流畅专业，保持原意，直接替换选中内容。', '润色全文：逐段改进表达，保持原意和结构，用 replace_block 逐块修改。') },
      { label: '翻译成英文', icon: 'languages', prompt: bySel('把我选中的内容翻译成地道的英文，直接替换选中内容。', '把全文翻译成地道的英文，保持标题层级和格式。') },
      { label: '总结全文', icon: 'list-checks', prompt: '阅读全文，用 3-5 条要点总结核心内容，直接回复给我，不要修改文档。' },
      { label: '生成大纲', icon: 'list-tree', prompt: '根据文档主题生成一份结构清晰的多级大纲（用标题层级），插入到光标处。如果文档是空的，先问我主题。' },
      { label: '扩写', icon: 'text-quote', prompt: bySel('扩写我选中的内容，补充细节和论据，篇幅约为原来的两倍，直接替换选中内容。', '扩写全文中过于简略的段落，补充细节和论据，逐块修改。') },
      { label: '精简', icon: 'scissors', prompt: bySel('精简我选中的内容，保留要点，篇幅压缩到一半左右，直接替换选中内容。', '精简全文，删去重复和冗余表达，保留要点和结构，逐块修改。') },
      { label: '纠正错别字', icon: 'spell-check', prompt: '检查全文的错别字、标点和语病，用最小改动逐块修正，最后列出改了哪些地方。' },
      { label: '改为正式语气', icon: 'briefcase', prompt: bySel('把我选中的内容改成正式、专业的书面语气，直接替换选中内容。', '把全文改成正式、专业的书面语气，保持结构，逐块修改。') },
    ],
    messageActions: [
      { label: '插入到光标处', icon: 'text-cursor-input', run: (text) => {
        try { mutate(() => insertNodes(mdToNodes(text), 'cursor')); toast('已插入', 'success', 1200); } catch (e) { toast(e.message, 'error'); }
      } },
      { label: '替换选中内容', icon: 'replace', run: (text) => {
        try { tools.find((t) => t.name === 'replace_selection').run({ markdown: text }); toast('已替换', 'success', 1200); } catch (e) { toast(e.message, 'error'); }
      } },
    ],
    onToggle: (on) => E.ribbon?.setAIActive(on),
  });
  ai._tools = tools; // 便于调试
  return ai;
}
