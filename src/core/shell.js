// 外壳：顶部标签栏（首页 + 已打开文档）、编辑器页面管理、自动保存、"文件"后台视图。
import { h, icon, toast, confirmBox, promptBox, debounce, pickFile, showMenu } from './ui.js';
import { APPS, loadApp, typeForFile, formatTime, formatSize } from './apps.js';
import * as store from './store.js';
import { mountHome } from '../home/home.js';
import { openSettings as openAISettings, hasKey as aiHasKey } from '../ai/settings.js';

const OPEN_KEY = 'office-open-tabs';
const THEME_KEY = 'office-theme';

/** 已打开的文档：id -> { file, page, tabEl, instance, dirty, saveDebounced, app } */
const open = new Map();
let activeId = null; // null = 首页
let tabsEl, workspace, homePage, home, themeBtn;

export function startShell(root) {
  tabsEl = h('div', { class: 'tb-tabs' });
  const homeTab = h('button', { class: 'tb-tab tb-home active', dataset: { id: '' }, title: '首页', onclick: () => activate(null) }, icon('house', 15), h('span', { class: 'tb-tab-name' }, '首页'));
  tabsEl.append(homeTab);
  const newBtn = h('button', { class: 'tb-round', title: '新建', onclick: (e) => newMenu(e.currentTarget) }, icon('plus', 17));
  themeBtn = h('button', { class: 'tb-round', title: '切换深色/浅色主题', onclick: toggleTheme });
  const titlebar = h('div', { class: 'titlebar' },
    h('div', { class: 'tb-logo', onclick: () => activate(null) },
      h('span', { class: 'logo-mark' }, 'O'),
      h('span', { class: 'logo-text' }, h('b', null, 'Office'), h('small', null, '云办公'))),
    h('div', { class: 'tb-tabs-wrap' }, tabsEl),
    h('div', { class: 'tb-right' }, h('button', { class: 'tb-round', title: 'AI 设置', onclick: () => openAISettings() }, icon('sparkles', 16)), newBtn, themeBtn));
  workspace = h('div', { class: 'workspace' });
  homePage = h('div', { class: 'page page-home active' });
  workspace.append(homePage);
  root.append(titlebar, workspace);

  applyTheme(localStorage.getItem(THEME_KEY) || 'light');

  home = mountHome(homePage, { openFile, newFile, importLocal, newWithAI });
  home.setActive(true);

  // 全局快捷键
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); if (activeId) saveNow(activeId, true); }
    else if (k === 'o' && !e.shiftKey) { e.preventDefault(); importLocal(); }
    else if (k === 'w' && e.altKey) { e.preventDefault(); if (activeId) closeTab(activeId); }
    else if (k === 'j' && activeId) { e.preventDefault(); open.get(activeId)?.instance?.ai?.toggle(); }
  });

  window.addEventListener('beforeunload', (e) => {
    let unsaved = false;
    for (const [id, o] of open) if (o.dirty) { unsaved = true; saveNow(id); }
    if (unsaved) { e.preventDefault(); e.returnValue = ''; }
  });

  window.addEventListener('hashchange', routeFromHash);
  restoreTabs().then(routeFromHash);
}

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(THEME_KEY, t);
  if (themeBtn) themeBtn.replaceChildren(icon(t === 'dark' ? 'sun' : 'moon', 16));
}
function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

function persistTabs() {
  localStorage.setItem(OPEN_KEY, JSON.stringify([...open.keys()]));
}

async function restoreTabs() {
  let ids = [];
  try { ids = JSON.parse(localStorage.getItem(OPEN_KEY) || '[]'); } catch {}
  for (const id of ids) {
    try { await openFile(id, { activate: false }); } catch (e) { console.warn('恢复标签失败', id, e); }
  }
}

function routeFromHash() {
  const m = location.hash.match(/^#\/edit\/(.+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (activeId !== id) openFile(id);
  } else if (activeId !== null) activate(null);
}

function newMenu(anchor) {
  showMenu(anchor, Object.values(APPS).map((a) => ({
    label: '新建' + a.full,
    icon: h('span', { class: 'menu-app-ico', style: { color: a.color } }, icon(a.icon, 14)),
    onClick: () => newFile(a.type, 'blank'),
  })).concat(['-', { label: '打开本地文件...', icon: 'folder-open', shortcut: 'Ctrl+O', onClick: importLocal }]));
}

/** 新建文件并打开 */
/** 新建空白文档并让 AI 按描述生成内容 */
export async function newWithAI(type, prompt) {
  if (!aiHasKey()) { const s = await openAISettings(); if (!s?.apiKey) return; }
  const file = await newFile(type, 'blank');
  const o = open.get(file.id);
  if (o?.instance?.ai) o.instance.ai.open(prompt, { send: true });
  else toast('该应用暂不支持 AI 生成', 'error');
}

export async function newFile(type, templateId = 'blank', name) {
  const app = await loadApp(type);
  const tpl = app.templates.find((t) => t.id === templateId);
  const content = await app.createContent(templateId);
  const base = name || (templateId === 'blank' || !tpl ? '新建' + APPS[type].full : tpl.name);
  const file = await store.createFile(type, await uniqueName(base), content);
  await openFile(file.id);
  return file;
}

async function uniqueName(base) {
  const names = new Set((await store.listFiles({ includeTrashed: true })).map((f) => f.name));
  if (!names.has(base)) return base;
  let i = 1;
  while (names.has(`${base} (${i})`)) i++;
  return `${base} (${i})`;
}

/** 从本地导入 docx/xlsx/pptx/csv/txt 等 */
export async function importLocal(files) {
  if (!files) {
    const accept = '.docx,.txt,.md,.html,.htm,.xlsx,.xls,.csv,.ods,.pptx';
    const picked = await pickFile(accept, true);
    if (!picked || !picked.length) return;
    files = picked;
  }
  for (const f of files) {
    const type = typeForFile(f.name);
    if (!type) { toast(`不支持的文件类型：${f.name}`, 'error'); continue; }
    try {
      const app = await loadApp(type);
      toast(`正在导入 ${f.name} ...`);
      const { name, content } = await app.importFile(f);
      const file = await store.createFile(type, await uniqueName(name || f.name.replace(/\.[^.]+$/, '')), content);
      await openFile(file.id);
    } catch (e) {
      console.error(e);
      toast(`导入失败：${f.name}（${e.message || e}）`, 'error', 4000);
    }
  }
}

/** 打开文件（已打开则切换） */
export async function openFile(id, { activate: act = true } = {}) {
  if (open.has(id)) { if (act) activate(id); return; }
  const file = await store.getFile(id);
  if (!file || file.trashed) { if (act) { toast('文件不存在或已删除', 'error'); activate(null); } return; }
  const meta = APPS[file.type];
  const page = h('div', { class: 'page page-editor', dataset: { type: file.type } });
  workspace.append(page);
  const nameSpan = h('span', { class: 'tb-tab-name' }, file.name);
  const tabEl = h('div', { class: 'tb-tab', dataset: { id }, title: file.name, onclick: () => activate(id), onauxclick: (e) => { if (e.button === 1) closeTab(id); } },
    h('span', { class: 'tb-tab-ico', style: { background: meta.color } }, icon(meta.icon, 11, { strokeWidth: 2.2 })),
    nameSpan,
    h('span', { class: 'tb-dirty' }),
    h('button', { class: 'tb-close', title: '关闭', onclick: (e) => { e.stopPropagation(); closeTab(id); } }, icon('x', 13)));
  tabsEl.append(tabEl);

  const o = { file, page, tabEl, nameSpan, instance: null, dirty: false, app: null, meta };
  o.saveDebounced = debounce(() => saveNow(id), 1500);
  open.set(id, o);
  persistTabs();
  if (act) activate(id);

  page.append(h('div', { class: 'page-loading' }, h('div', { class: 'spinner' }), '正在加载...'));
  try {
    o.app = await loadApp(file.type);
    page.replaceChildren();
    const ctx = makeCtx(id);
    o.instance = await o.app.mount(page, file, ctx);
    if (activeId === id) o.instance.onShow && o.instance.onShow();
  } catch (e) {
    console.error(e);
    page.replaceChildren(h('div', { class: 'page-loading' }, '加载失败：' + (e.message || e)));
  }
}

function makeCtx(id) {
  const o = () => open.get(id);
  return {
    markDirty() {
      const x = o(); if (!x) return;
      x.dirty = true;
      x.tabEl.classList.add('dirty');
      x.saveDebounced();
    },
    save: () => saveNow(id, true),
    getName: () => o()?.file.name,
    rename: (name) => renameFile(id, name),
    openBackstage: () => openBackstage(id),
    close: () => closeTab(id),
    get fileId() { return id; },
  };
}

export async function saveNow(id, notify = false) {
  const o = open.get(id);
  if (!o || !o.instance) return;
  o.saveDebounced.cancel();
  try {
    const content = await o.instance.getContent();
    o.file = await store.updateFile(id, { content });
    o.dirty = false;
    o.tabEl.classList.remove('dirty');
    if (notify) toast('已保存', 'success', 1200);
  } catch (e) {
    console.error(e);
    toast('保存失败：' + e.message, 'error');
  }
}

async function renameFile(id, name) {
  name = (name || '').trim();
  if (!name) return;
  const f = await store.updateFile(id, { name });
  const o = open.get(id);
  if (o) {
    o.file.name = f.name;
    o.nameSpan.textContent = f.name;
    o.tabEl.title = f.name;
    if (activeId === id) document.title = f.name + ' - 云办公';
  }
}

export function activate(id) {
  const prev = activeId ? open.get(activeId) : null;
  if (prev && prev.instance && prev.instance.onHide) prev.instance.onHide();
  activeId = id;
  tabsEl.querySelectorAll('.tb-tab').forEach((t) => t.classList.toggle('active', (t.dataset.id || null) === (id || null) || (!id && t.classList.contains('tb-home'))));
  homePage.classList.toggle('active', !id);
  for (const [oid, o] of open) o.page.classList.toggle('active', oid === id);
  const o = id ? open.get(id) : null;
  document.title = o ? o.file.name + ' - 云办公' : '云办公 Office';
  const want = id ? '#/edit/' + encodeURIComponent(id) : '#/';
  if (location.hash !== want) history.replaceState(null, '', want);
  if (o) {
    o.tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (o.instance && o.instance.onShow) o.instance.onShow();
  } else home.refresh();
  home.setActive(!id);
}

export async function closeTab(id) {
  const o = open.get(id);
  if (!o) return;
  if (o.dirty) await saveNow(id);
  try { o.instance && o.instance.destroy && o.instance.destroy(); } catch (e) { console.error(e); }
  o.page.remove();
  o.tabEl.remove();
  open.delete(id);
  persistTabs();
  if (activeId === id) {
    const ids = [...open.keys()];
    activate(ids.length ? ids[ids.length - 1] : null);
  }
}

/* ---------------- 文件后台视图（Backstage） ---------------- */

async function openBackstage(id) {
  const o = open.get(id);
  if (!o) return;
  const meta = o.meta;
  const right = h('div', { class: 'bs-main' });
  const close = () => {
    bs.classList.add('closing');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => bs.remove(), 180);
  };
  const item = (ic, label, fn, key) => {
    const el = h('button', { class: 'bs-item' + (key === 'danger' ? ' danger' : ''), dataset: { key: key || '' }, onclick: () => fn(el) }, icon(ic, 17), h('span', null, label));
    return el;
  };
  const select = (el) => { nav.querySelectorAll('.bs-item').forEach((x) => x.classList.toggle('active', x === el)); };

  const showInfo = (el) => {
    select(el);
    right.replaceChildren(
      h('div', { class: 'bs-tag' }, 'INFO'),
      h('h2', null, '文档信息'),
      h('div', { class: 'bs-info' },
        h('div', { class: 'bs-info-ico', style: { background: meta.color } }, icon(meta.icon, 34, { strokeWidth: 1.6 })),
        h('div', { class: 'bs-info-name' }, o.file.name),
        h('div', { class: 'bs-info-grid' },
          ...[['类型', meta.full], ['创建时间', new Date(o.file.createdAt).toLocaleString()], ['修改时间', new Date(o.file.updatedAt).toLocaleString()],
            ['大小', formatSize(o.file.size)], ['存储位置', '浏览器本地']].map(([k, v]) =>
            h('div', { class: 'bs-info-cell' }, h('div', { class: 'bs-info-k' }, k), h('div', { class: 'bs-info-v' }, v))))));
  };
  const showNew = async (el) => {
    select(el);
    right.replaceChildren(h('div', { class: 'bs-tag' }, 'NEW'), h('h2', null, '新建文档'));
    for (const a of Object.values(APPS)) {
      const app = await loadApp(a.type);
      right.append(h('h3', { class: 'bs-sub' }, a.full),
        h('div', { class: 'bs-tpl-row' }, app.templates.map((t) =>
          h('button', { class: 'bs-tpl', onclick: () => { close(); newFile(a.type, t.id); } },
            h('div', { class: 'bs-tpl-thumb' }, t.preview ? t.preview() : icon(a.icon, 28)),
            h('div', { class: 'bs-tpl-name' }, t.name)))));
    }
  };
  const showExport = (el) => {
    select(el);
    const exps = (o.instance && o.instance.exports) || [];
    right.replaceChildren(h('div', { class: 'bs-tag' }, 'EXPORT'), h('h2', null, '导出为其他格式'),
      h('div', { class: 'bs-export-list' }, exps.length ? exps.map((ex) =>
        h('button', { class: 'bs-export', onclick: async () => { close(); try { await ex.run(o.file.name); } catch (e) { console.error(e); toast('导出失败：' + e.message, 'error'); } } },
          h('span', { class: 'bs-export-ico' }, icon(ex.icon || 'file-down', 20)),
          h('div', { style: 'flex:1' }, h('div', { class: 'bs-export-label' }, ex.label), ex.desc ? h('div', { class: 'bs-export-desc' }, ex.desc) : null),
          icon('chevron-right', 16)))
        : h('div', { class: 'muted' }, '该文档暂无可用导出格式')));
  };

  const nav = h('div', { class: 'bs-nav' },
    h('div', { class: 'bs-head' },
      h('span', { class: 'bs-head-ico', style: { background: meta.color } }, icon(meta.icon, 14, { strokeWidth: 2 })),
      h('span', { class: 'bs-head-name' }, o.file.name)),
    item('info', '信息', showInfo, 'info'),
    item('file-plus', '新建', showNew, 'new'),
    item('folder-open', '打开', () => { close(); importLocal(); }),
    item('save', '保存', () => { close(); saveNow(id, true); }),
    item('copy', '另存为副本', async () => {
      close();
      await saveNow(id);
      const name = await promptBox('另存为副本', '新文件名', o.file.name + ' - 副本');
      if (name) { const f = await store.duplicateFile(id, name); openFile(f.id); }
    }),
    item('pencil', '重命名', async () => {
      close();
      const name = await promptBox('重命名', '文件名', o.file.name);
      if (name) renameFile(id, name);
    }),
    item('file-output', '导出', showExport, 'export'),
    item('printer', '打印', () => { close(); o.instance && o.instance.print ? o.instance.print() : window.print(); }),
    h('div', { class: 'bs-spacer' }),
    item('trash-2', '移到回收站', async () => {
      if (!(await confirmBox(`确定将"${o.file.name}"移到回收站吗？`))) return;
      close();
      await closeTab(id);
      await store.trashFile(id);
      toast('已移到回收站');
    }, 'danger'),
    item('x', '关闭', () => { close(); closeTab(id); }));
  const card = h('div', { class: 'bs-card' }, nav, right,
    h('button', { class: 'modal-x bs-x', title: '返回 (Esc)', onclick: close }, icon('x', 15)));
  const bs = h('div', { class: 'backstage', onmousedown: (e) => { if (e.target === bs) close(); } }, card);
  o.page.append(bs);
  showInfo(nav.querySelector('[data-key=info]'));
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
}
