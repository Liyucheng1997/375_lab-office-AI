// 侧边窗格：导航（标题大纲）、查找替换、批注；字数统计对话框
import { h, icon, modal, toast } from '../../core/ui.js';

export function createPanes(E, { navPane, sidePane }) {
  const doc = E.doc;

  /* ---------- 导航窗格 ---------- */
  const navList = h('div', { class: 'wr-nav-list' });
  navPane.append(
    h('div', { class: 'side-pane-head' }, h('span', null, '导航'), h('button', { class: 'icon-btn', title: '关闭', onclick: () => toggleNav(false) }, icon('x', 15))),
    navList);
  function toggleNav(v) {
    const onv = v ?? !E.state.view.nav;
    E.state.view.nav = onv;
    navPane.classList.toggle('open', onv);
    if (onv) refreshNav();
    E.syncRibbon && E.syncRibbon();
    requestAnimationFrame(() => E.paginate());
  }
  function refreshNav() {
    if (!E.state.view.nav) return;
    const hs = [...doc.querySelectorAll('h1,h2,h3,h4,.wr-title')].filter((x) => !x.closest('.wr-toc') && x.textContent.trim());
    navList.replaceChildren(...(hs.length ? hs.map((hd) => {
      const lvl = hd.classList.contains('wr-title') ? 0 : +hd.tagName[1];
      return h('div', { class: `wr-nav-item wr-nav-l${lvl}`, title: E.headingText(hd), onclick: () => { hd.scrollIntoView({ block: 'start', behavior: 'smooth' }); E.caretInto(hd); } }, E.headingText(hd));
    }) : [h('div', { class: 'wr-nav-empty' }, '文档中没有标题。', h('br'), '使用"开始 → 样式"中的标题样式后，标题会显示在这里。')]));
  }

  /* ---------- 右侧窗格 ---------- */
  let sideKind = null;
  const sideTitle = h('span');
  const sideBody = h('div', { class: 'side-pane-body' });
  sidePane.append(h('div', { class: 'side-pane-head' }, sideTitle, h('button', { class: 'icon-btn', title: '关闭', onclick: () => closeSide() }, icon('x', 15))), sideBody);
  function openSide(kind, title) {
    sideKind = kind;
    sideTitle.textContent = title;
    sidePane.classList.add('open');
    requestAnimationFrame(() => E.paginate());
  }
  function closeSide() {
    if (sideKind === 'find') clearHighlights();
    sideKind = null;
    sidePane.classList.remove('open');
    requestAnimationFrame(() => E.paginate());
  }

  /* ---------- 查找替换 ---------- */
  const findInput = h('input', { class: 'input', placeholder: '查找内容' });
  const replInput = h('input', { class: 'input', placeholder: '替换为' });
  const caseBox = h('input', { type: 'checkbox' });
  const wholeBox = h('input', { type: 'checkbox' });
  const info = h('div', { class: 'wr-find-info' });
  const replRow = h('div', { class: 'wr-find-repl' }, replInput,
    h('div', { class: 'wr-find-btns' },
      h('button', { class: 'btn btn-sm', onclick: () => replaceOne() }, '替换'),
      h('button', { class: 'btn btn-sm', onclick: () => replaceAll() }, '全部替换')));
  const findUI = h('div', { class: 'wr-find' },
    findInput,
    h('div', { class: 'wr-find-opts' }, h('label', { class: 'form-check' }, caseBox, '区分大小写'), h('label', { class: 'form-check' }, wholeBox, '全字匹配')),
    h('div', { class: 'wr-find-btns' },
      h('button', { class: 'btn btn-sm', onclick: () => step(-1) }, icon('chevron-up', 14), '上一个'),
      h('button', { class: 'btn btn-sm btn-primary', onclick: () => step(1) }, icon('chevron-down', 14), '下一个')),
    info,
    replRow);
  let matches = [];
  let cur = -1;

  function textMap() {
    const nodes = [];
    let text = '';
    const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      nodes.push({ node: n, start: text.length });
      text += n.data;
    }
    return { nodes, text };
  }
  function pos(map, idx) {
    let lo = 0, hi = map.nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (map.nodes[mid].start <= idx) lo = mid; else hi = mid - 1;
    }
    const it = map.nodes[lo];
    return [it.node, idx - it.start];
  }
  function search() {
    const q = findInput.value;
    matches = [];
    cur = -1;
    if (!q) { info.textContent = ''; clearHighlights(); return; }
    const map = textMap();
    const flags = caseBox.checked ? 'g' : 'gi';
    const escq = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(wholeBox.checked ? `(?<![A-Za-z0-9_])${escq}(?![A-Za-z0-9_])` : escq, flags);
    let m;
    while ((m = re.exec(map.text))) {
      if (!m[0].length) { re.lastIndex++; continue; }
      const [sn, so] = pos(map, m.index);
      const [en, eo] = pos(map, m.index + m[0].length - 1);
      const r = document.createRange();
      r.setStart(sn, so);
      r.setEnd(en, eo + 1);
      matches.push(r);
    }
    // 从光标位置之后的第一个开始
    const sel = E.getRange();
    if (sel && matches.length) {
      cur = matches.findIndex((r) => r.compareBoundaryPoints(Range.START_TO_START, sel) >= 0) - 1;
      if (cur < -1) cur = -1;
    }
    highlight();
  }
  function highlight() {
    if (!window.CSS?.highlights) return;
    CSS.highlights.set('wr-find', new Highlight(...matches));
    if (matches[cur]) CSS.highlights.set('wr-find-cur', new Highlight(matches[cur]));
    else CSS.highlights.delete('wr-find-cur');
    info.textContent = matches.length ? `第 ${cur + 1 > 0 ? cur + 1 : '-'} 处，共 ${matches.length} 处` : '未找到匹配项';
  }
  function clearHighlights() {
    if (window.CSS?.highlights) { CSS.highlights.delete('wr-find'); CSS.highlights.delete('wr-find-cur'); }
  }
  function step(dir) {
    if (!matches.length) search();
    if (!matches.length) { highlight(); return; }
    cur = (cur + dir + matches.length) % matches.length;
    const r = matches[cur];
    E.setRange(r.cloneRange());
    const rect = r.getBoundingClientRect();
    const cr = E.canvas.getBoundingClientRect();
    if (rect.top < cr.top + 30 || rect.bottom > cr.bottom - 30) E.canvas.scrollTop += rect.top - cr.top - cr.height / 3;
    highlight();
  }
  function replaceOne() {
    const r = matches[cur];
    if (!r) { step(1); return; }
    E.setRange(r.cloneRange());
    E.run(() => E.exec('insertText', replInput.value));
    search();
    step(1);
  }
  function replaceAll() {
    search();
    const n = matches.length;
    if (!n) return;
    E.run(() => {
      for (let i = matches.length - 1; i >= 0; i--) {
        const r = matches[i];
        const start = r.startContainer, so = r.startOffset;
        r.deleteContents();
        if (start.nodeType === 3) start.insertData(so, replInput.value);
        else r.insertNode(document.createTextNode(replInput.value));
      }
    }, { focus: false });
    search();
    toast(`已完成 ${n} 处替换`, 'success');
  }
  findInput.addEventListener('input', () => search());
  caseBox.addEventListener('change', search);
  wholeBox.addEventListener('change', search);
  findInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') closeSide(); });
  replInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } });

  function openFind(withReplace) {
    openSide('find', withReplace ? '查找和替换' : '查找');
    replRow.style.display = withReplace ? '' : 'none';
    sideBody.replaceChildren(findUI);
    const r = E.getRange();
    const sel = r && !r.collapsed ? r.toString() : '';
    if (sel && sel.length < 80 && !sel.includes('\n')) findInput.value = sel;
    findInput.focus();
    findInput.select();
    search();
  }

  /* ---------- 批注 ---------- */
  function openComments() {
    openSide('comments', '批注');
    refreshComments();
  }
  function refreshComments() {
    if (sideKind !== 'comments') return;
    const spans = [...doc.querySelectorAll('.wr-comment[data-cid]')];
    const seen = new Set();
    const list = [];
    for (const s of spans) {
      const id = s.dataset.cid;
      if (seen.has(id)) continue;
      seen.add(id);
      const c = E.state.comments[id];
      if (!c) continue;
      const quote = spans.filter((x) => x.dataset.cid === id).map((x) => x.textContent).join('');
      const ta = h('textarea', { class: 'input wr-cmt-text', rows: 2 }, c.text);
      ta.addEventListener('change', () => { c.text = ta.value; spans.filter((x) => x.dataset.cid === id).forEach((x) => (x.title = ta.value)); E.ctx.markDirty(); });
      list.push(h('div', { class: 'wr-cmt', onclick: (e) => {
        if (e.target.closest('textarea,button')) return;
        s.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const r = document.createRange();
        r.selectNodeContents(s);
        E.setRange(r);
        doc.querySelectorAll('.wr-comment.flash').forEach((x) => x.classList.remove('flash'));
        spans.filter((x) => x.dataset.cid === id).forEach((x) => x.classList.add('flash'));
      } },
        h('div', { class: 'wr-cmt-head' }, h('span', { class: 'wr-cmt-avatar' }, (c.author || '我')[0]), h('b', null, c.author || '我'), h('span', { class: 'muted' }, new Date(c.time).toLocaleString()),
          h('button', { class: 'icon-btn', title: '删除批注', onclick: () => E.deleteComment(id) }, icon('trash-2', 14))),
        h('div', { class: 'wr-cmt-quote' }, quote.length > 60 ? quote.slice(0, 60) + '…' : quote),
        ta));
    }
    sideBody.replaceChildren(
      h('button', { class: 'btn btn-sm', style: 'margin-bottom:10px', onclick: E.newComment }, icon('message-square-plus', 14), '新建批注'),
      ...(list.length ? list : [h('div', { class: 'muted', style: 'padding:20px 0;text-align:center' }, '暂无批注。选中文字后点击"新建批注"。')]));
  }

  /* ---------- 字数统计 ---------- */
  function wordCountDialog() {
    const s = E.stats();
    const row = (k, v) => h('tr', null, h('td', null, k), h('td', { style: 'text-align:right;font-weight:600' }, String(v)));
    modal({
      title: '字数统计',
      width: 340,
      body: h('table', { class: 'wr-wc' }, row('页数', s.pages), row('字数', s.words), row('字符数（不计空格）', s.noSpace), row('字符数（计空格）', s.withSpace), row('段落数', s.paras), row('中文字符', s.cjk), row('非中文单词', s.eng)),
      buttons: [{ label: '关闭', primary: true }],
    });
  }

  return { toggleNav, refreshNav, openFind, openComments, refreshComments, closeSide, wordCountDialog };
}
