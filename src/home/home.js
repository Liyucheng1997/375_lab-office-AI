// 首页：问候 + 搜索胶囊、新建、模板横条、文档列表（最近/星标/回收站）、拖拽导入、流体背景。
import { h, icon, toast, confirmBox, promptBox, contextMenu, showMenu, modal } from '../core/ui.js';
import { APPS, loadApp, formatTime, formatSize } from '../core/apps.js';
import * as store from '../core/store.js';
import { createFluid } from './fluid.js';

function greeting() {
  const hr = new Date().getHours();
  if (hr < 5) return '夜深了';
  if (hr < 11) return '早上好';
  if (hr < 13) return '中午好';
  if (hr < 18) return '下午好';
  return '晚上好';
}

export function mountHome(root, { openFile, newFile, importLocal, newWithAI }) {
  let view = 'recent'; // recent | starred | trash
  let typeFilter = 'all';
  let tplFilter = 'all';
  let query = '';

  /* 背景：流体 + 巨型水印字 */
  const fluidCanvas = h('canvas', { class: 'home-fluid', 'aria-hidden': 'true' });
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let fluid = null;
  try { if (!reduceMotion) fluid = createFluid(fluidCanvas, root); } catch (e) { console.warn('流体背景不可用', e); }

  /* 顶部：问候、标题、搜索 */
  const search = h('input', { class: 'home-search', placeholder: '搜索文档…', oninput: () => { query = search.value.trim().toLowerCase(); renderList(); } });
  const hero = h('div', { class: 'home-hero' },
    h('div', { class: 'home-hi' }, greeting(), h('span', { class: 'wave' }, '👋')),
    h('h1', { class: 'home-title' }, '今天想', h('span', { class: 'accent-text' }, '创作'), '点什么？'),
    h('div', { class: 'home-sub' }, h('b', null, '文字'), ' · ', h('b', null, '表格'), ' · ', h('b', null, '演示'), '　一切都安静地保存在你的浏览器里'));
  const searchBar = h('div', { class: 'home-search-wrap glass' },
    icon('search', 17), search, h('span', { class: 'kbd' }, '/'),
    h('button', { class: 'search-ai', onclick: () => aiCreate() }, icon('sparkles', 15), 'AI 新建'),
    h('button', { class: 'search-open', onclick: () => importLocal() }, icon('arrow-up-from-line', 15), '打开文件'));

  /* 新建卡片 */
  const create = h('div', { class: 'home-create' }, Object.values(APPS).map((a) =>
    h('button', { class: 'create-card glass', style: { '--c': a.color }, onclick: () => newFile(a.type) },
      h('div', { class: 'cc-ico', style: { background: a.color } }, icon(a.icon, 26, { strokeWidth: 1.8 })),
      h('div', { class: 'cc-text' }, h('div', { class: 'cc-name' }, a.name), h('div', { class: 'cc-desc' }, '新建空白' + a.full)),
      h('span', { class: 'cc-plus' }, icon('plus', 16)))));

  /* 模板横条 */
  const tplTrack = h('div', { class: 'tpl-track' });
  const tplStrip = h('div', { class: 'tpl-strip' }, tplTrack);
  const tplSeg = segmented([['all', '全部'], ...Object.values(APPS).map((a) => [a.type, a.name])], () => tplFilter, (v) => { tplFilter = v; renderTemplates(); });
  enableDragScroll(tplStrip);
  const tplSec = h('div', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('div', null, h('div', { class: 'sec-tag' }, 'TEMPLATES'), h('div', { class: 'sec-title' }, '从模板开始')), h('div', { class: 'sec-tools' }, tplSeg.el)),
    tplStrip);

  /* 文档列表 */
  const viewSeg = segmented([['recent', '最近', 'clock'], ['starred', '星标', 'star'], ['trash', '回收站', 'trash-2']], () => view, (v) => { view = v; renderList(); });
  const typeSeg = segmented([['all', '全部'], ...Object.values(APPS).map((a) => [a.type, a.name])], () => typeFilter, (v) => { typeFilter = v; renderList(); });
  const trashBtn = h('button', { class: 'btn btn-sm', style: 'display:none', onclick: async () => {
    if (await confirmBox('确定清空回收站吗？此操作不可撤销。', '清空回收站', '清空')) { await store.emptyTrash(); toast('回收站已清空'); }
  } }, icon('trash', 13), '清空');
  const listHost = h('div', { class: 'file-list glass' });
  const docSec = h('div', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('div', null, h('div', { class: 'sec-tag' }, 'DOCUMENTS'), h('div', { class: 'sec-title' }, '我的文档')),
      h('div', { class: 'sec-tools' }, trashBtn, typeSeg.el, viewSeg.el)),
    listHost);

  const dropMask = h('div', { class: 'drop-mask' }, icon('upload', 44), h('div', null, '松开即可导入'), h('div', { style: 'font-size:12px;font-weight:500;opacity:.7' }, 'docx · txt · md · html · xlsx · xls · csv · pptx'));
  root.append(fluidCanvas, h('div', { class: 'home-watermark' }, 'OFFICE'),
    h('div', { class: 'home-scroll' }, h('div', { class: 'home-inner' }, hero, searchBar, create, tplSec, docSec,
      h('div', { class: 'home-foot' }, '拖拽文件到此处即可导入 · Ctrl+O 打开本地文件 · Ctrl+S 保存'))),
    dropMask);

  const AI_EXAMPLES = {
    doc: ['写一份新产品上线的项目周报', '起草一封给客户的延期交付致歉信', '写一篇 800 字的"数字化转型"主题演讲稿'],
    sheet: ['做一张 2026 年家庭月度收支表，带合计公式', '生成 20 名员工的工资表，含个税和实发工资公式', '做一个项目甘特进度表，12 个任务'],
    slide: ['做一份 8 页的年度工作总结 PPT', '为"智能家居新品"做产品发布会演示文稿', '做一份 6 页的光合作用教学课件'],
  };
  async function aiCreate() {
    let type = 'doc';
    const ta = h('textarea', { class: 'input', rows: 4, placeholder: '描述你想要的文档，越具体越好…', style: 'width:100%' });
    const ex = h('div', { class: 'ai-quick', style: 'justify-content:flex-start' });
    const renderEx = () => ex.replaceChildren(...AI_EXAMPLES[type].map((t) => h('button', { class: 'ai-chip', type: 'button', onclick: () => { ta.value = t; ta.focus(); } }, t)));
    const seg = h('div', { class: 'seg' }, Object.values(APPS).map((a) => h('button', { type: 'button', class: a.type === type ? 'active' : '', onclick: (e) => {
      type = a.type;
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.currentTarget));
      renderEx();
    } }, h('span', { class: 'tpl-dot', style: { background: a.color } }), a.name)));
    renderEx();
    const prompt = await modal({
      title: 'AI 新建',
      width: 520,
      body: h('div', { class: 'form' }, seg, ta, h('div', { class: 'form-label' }, '试试这些'), ex),
      buttons: [{ label: '取消', value: null }, { label: '开始生成', primary: true, onClick: () => ta.value.trim() || false }],
    });
    if (prompt) newWithAI(type, prompt);
  }

  // "/" 聚焦搜索
  document.addEventListener('keydown', (e) => {
    if (!root.classList.contains('active') || e.key !== '/' || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    e.preventDefault();
    search.focus();
  });

  // 拖拽导入
  let dragDepth = 0;
  root.addEventListener('dragenter', (e) => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; root.classList.add('dragging'); } });
  root.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; root.classList.remove('dragging'); } });
  root.addEventListener('dragover', (e) => e.preventDefault());
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    root.classList.remove('dragging');
    if (e.dataTransfer.files.length) importLocal([...e.dataTransfer.files]);
  });

  async function renderTemplates() {
    tplSeg.sync();
    tplTrack.replaceChildren();
    for (const a of Object.values(APPS)) {
      if (tplFilter !== 'all' && tplFilter !== a.type) continue;
      const app = await loadApp(a.type);
      for (const t of app.templates.filter((t) => t.id !== 'blank')) {
        tplTrack.append(h('button', { class: 'tpl-card', style: { '--c': a.color }, onclick: () => newFile(a.type, t.id) },
          h('div', { class: 'tpl-thumb' }, t.preview ? t.preview() : icon(a.icon, 36)),
          h('div', { class: 'tpl-name' }, h('span', { class: 'tpl-dot' }), t.name, h('span', { class: 'tpl-kind' }, a.name))));
      }
    }
    tplStrip.scrollLeft = 0;
  }

  async function renderList() {
    viewSeg.sync();
    typeSeg.sync();
    trashBtn.style.display = view === 'trash' ? '' : 'none';
    let files = await store.listFiles({ onlyTrashed: view === 'trash' });
    if (view === 'starred') files = files.filter((f) => f.starred);
    if (typeFilter !== 'all') files = files.filter((f) => f.type === typeFilter);
    if (query) files = files.filter((f) => f.name.toLowerCase().includes(query));
    if (view === 'recent') files = files.slice(0, 60);
    listHost.replaceChildren();
    if (!files.length) {
      const msg = view === 'trash' ? '回收站是空的' : view === 'starred' ? '还没有星标文档' : query ? '没有找到匹配的文档' : '还没有文档，从上面新建一个吧';
      listHost.append(h('div', { class: 'empty' }, icon(view === 'trash' ? 'trash-2' : view === 'starred' ? 'star' : 'file', 34, { strokeWidth: 1.4 }), h('div', null, msg)));
      return;
    }
    files.forEach((f, i) => {
      const a = APPS[f.type];
      const actions = view === 'trash'
        ? [
          { label: '还原', icon: 'undo-2', onClick: async () => { await store.restoreFile(f.id); toast('已还原', 'success'); } },
          { label: '彻底删除', icon: 'trash', onClick: async () => { if (await confirmBox(`彻底删除"${f.name}"？此操作不可撤销。`)) await store.deleteFileForever(f.id); } },
        ]
        : [
          { label: '打开', icon: 'external-link', onClick: () => openFile(f.id) },
          { label: f.starred ? '取消星标' : '添加星标', icon: 'star', onClick: () => store.updateFile(f.id, { starred: !f.starred }) },
          { label: '重命名', icon: 'pencil', onClick: async () => { const n = await promptBox('重命名', '文件名', f.name); if (n && n.trim()) store.updateFile(f.id, { name: n.trim() }); } },
          { label: '创建副本', icon: 'copy', onClick: () => store.duplicateFile(f.id) },
          '-',
          { label: '移到回收站', icon: 'trash-2', onClick: () => store.trashFile(f.id).then(() => toast('已移到回收站')) },
        ];
      listHost.append(h('div', {
        class: 'fl-row',
        style: { animationDelay: Math.min(i, 12) * 0.025 + 's' },
        onclick: (e) => { if (view !== 'trash' && !e.target.closest('button')) openFile(f.id); },
        oncontextmenu: (e) => contextMenu(e, actions),
      },
        h('div', { class: 'fl-name' },
          h('span', { class: 'fl-ico', style: { background: a.color } }, icon(a.icon, 17, { strokeWidth: 1.9 })),
          h('div', { style: 'min-width:0' }, h('div', { class: 'fl-title' }, f.name), h('div', { class: 'fl-meta' }, a.full)),
          f.starred ? h('span', { class: 'fl-star' }, icon('star', 13)) : null),
        h('div', { class: 'fl-time' }, formatTime(f.updatedAt)),
        h('div', { class: 'fl-size' }, formatSize(f.size)),
        h('div', { class: 'fl-act' },
          view !== 'trash' ? h('button', { class: 'icon-btn' + (f.starred ? ' starred' : ''), title: '星标', onclick: () => store.updateFile(f.id, { starred: !f.starred }) }, icon('star', 15)) : null,
          h('button', { class: 'icon-btn', title: '更多', onclick: (e) => showMenu(e.currentTarget, actions) }, icon('ellipsis', 16)))));
    });
  }

  store.onFilesChanged(() => { if (root.classList.contains('active')) renderList(); });
  renderTemplates();
  renderList();

  return {
    refresh: renderList,
    setActive(on) {
      if (!fluid) return;
      if (on) fluid.start();
      else fluid.stop();
    },
  };
}

/** 分段控件：items = [[value, label, icon?]] */
function segmented(items, get, set) {
  const btns = items.map(([v, label, ic]) => h('button', { dataset: { v }, onclick: () => { set(v); sync(); } }, ic ? icon(ic, 13) : null, label));
  const el = h('div', { class: 'seg' }, btns);
  const sync = () => btns.forEach((b) => b.classList.toggle('active', b.dataset.v === get()));
  sync();
  return { el, sync };
}

/** 横向拖拽滚动（鼠标按住拖动模板条） */
function enableDragScroll(el) {
  let startX = 0, startLeft = 0, down = false, moved = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    down = true; moved = false; startX = e.clientX; startLeft = el.scrollLeft;
  });
  addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) > 5) { moved = true; el.classList.add('dragging'); }
    if (moved) el.scrollLeft = startLeft - dx;
  });
  addEventListener('pointerup', () => {
    if (!down) return;
    down = false;
    setTimeout(() => el.classList.remove('dragging'), 0);
  });
}
