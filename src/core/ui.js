// 共享 UI 组件库：元素创建、图标、功能区(Ribbon)、对话框、取色器、菜单、提示等。
// 三个应用（文字/表格/演示）都通过这里构建界面，以保持统一的 WPS 风格。
import { createElement as lucideCreate, icons as lucideIcons } from 'lucide';

/* ---------------- 基础 ---------------- */

/**
 * h('div', { class: 'x', onclick: fn, style: {...}, dataset: {...} }, child1, 'text', [more])
 * attrs 以 on 开头的作为事件；class/className 设置类名；style 可为对象或字符串。
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') el.className = v;
      else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText = v;
        else for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const toPascal = (s) => s.replace(/(^|[-_ ])(\w)/g, (_, __, c) => c.toUpperCase());

/** lucide 图标，name 用 kebab-case，如 'bold'、'align-left'、'table-2'。 */
export function icon(name, size = 16, attrs = {}) {
  const node = lucideIcons[toPascal(name)] || lucideIcons.Square;
  const svg = lucideCreate(node);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('stroke-width', attrs.strokeWidth || 1.75);
  svg.classList.add('ico');
  return svg;
}

export function debounce(fn, ms = 300) {
  let t;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function download(blobOrUrl, filename) {
  const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  const a = h('a', { href: url, download: filename, style: 'display:none' });
  document.body.append(a);
  a.click();
  a.remove();
  if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** 让用户选择本地文件，返回 File 或 null */
export function pickFile(accept = '*', multiple = false) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: 'display:none' });
    if (multiple) input.multiple = true;
    input.addEventListener('change', () => {
      resolve(multiple ? [...input.files] : input.files[0] || null);
      input.remove();
    });
    // 用户取消时不会触发 change；用 focus 兜底
    window.addEventListener('focus', () => setTimeout(() => { if (!input.files.length) resolve(null); }, 600), { once: true });
    document.body.append(input);
    input.click();
  });
}

export function readFileAs(file, as = 'dataURL') {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    if (as === 'dataURL') r.readAsDataURL(file);
    else if (as === 'text') r.readAsText(file);
    else r.readAsArrayBuffer(file);
  });
}

/** 在隐藏 iframe 中打印一段 HTML（用于打印 / 导出 PDF） */
export function printHTML(bodyHTML, css = '', title = '打印') {
  const iframe = h('iframe', { style: 'position:fixed;right:0;bottom:0;width:0;height:0;border:0' });
  document.body.append(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body>${bodyHTML}</body></html>`);
  doc.close();
  const go = () => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => iframe.remove(), 1000);
  };
  const imgs = [...doc.images];
  if (imgs.every((i) => i.complete)) setTimeout(go, 100);
  else Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; }))).then(go);
}

/** 浮层挂载点：全屏（如幻灯片放映）时挂到全屏元素内，否则挂到 body */
export function layerRoot() {
  return document.fullscreenElement || document.body;
}

/* ---------------- 提示 ---------------- */

let toastHost;
export function toast(msg, type = 'info', ms = 2200) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host' });
  }
  if (toastHost.parentNode !== layerRoot()) layerRoot().append(toastHost);
  const t = h('div', { class: `toast toast-${type}` }, msg);
  toastHost.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

/* ---------------- 浮层 / 菜单 ---------------- */

let openPopups = [];
function closeAllPopups(except) {
  openPopups.filter((p) => p !== except).forEach((p) => p.close());
}
document.addEventListener('mousedown', (e) => {
  openPopups.slice().forEach((p) => {
    if (p.srcEvent === e) return;
    if (!p.el.contains(e.target) && !(p.anchor && p.anchor.contains(e.target))) p.close();
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openPopups.length) openPopups[openPopups.length - 1].close();
});

/**
 * 浮层：在 anchor 元素下方（或 {x,y} 坐标处）显示 content。
 * 返回 { el, close }。点击外部或 Esc 自动关闭。
 */
export function popover(anchorOrPoint, content, { className = '', onClose, keepOthers = false } = {}) {
  const el = h('div', { class: 'popover ' + className }, content);
  // srcEvent：打开浮层的那次 mousedown 不应立即把它关掉
  const p = { el, anchor: anchorOrPoint instanceof Element ? anchorOrPoint : null, close, srcEvent: window.event };
  if (!keepOthers) closeAllPopups();
  layerRoot().append(el);
  openPopups.push(p);
  // 定位
  let x, y;
  if (anchorOrPoint instanceof Element) {
    const r = anchorOrPoint.getBoundingClientRect();
    x = r.left;
    y = r.bottom + 2;
  } else {
    x = anchorOrPoint.x;
    y = anchorOrPoint.y;
  }
  const er = el.getBoundingClientRect();
  if (x + er.width > innerWidth - 4) x = Math.max(4, innerWidth - er.width - 4);
  if (y + er.height > innerHeight - 4) {
    const top = anchorOrPoint instanceof Element ? anchorOrPoint.getBoundingClientRect().top - er.height - 2 : y - er.height;
    y = Math.max(4, top);
  }
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    el.remove();
    openPopups = openPopups.filter((q) => q !== p);
    onClose && onClose();
  }
  return p;
}

/**
 * 菜单项：{ label, icon, shortcut, onClick, disabled, checked, items: [...子菜单] } 或 '-' 分隔线
 */
function buildMenu(items, close) {
  const menu = h('div', { class: 'menu' });
  for (const it of items) {
    if (it === '-' || it.type === 'separator') {
      menu.append(h('div', { class: 'menu-sep' }));
      continue;
    }
    if (it.type === 'header') {
      menu.append(h('div', { class: 'menu-header' }, it.label));
      continue;
    }
    const row = h(
      'div',
      { class: 'menu-item' + (it.disabled ? ' disabled' : '') + (it.items ? ' has-sub' : '') },
      h('span', { class: 'menu-icon' }, it.checked ? icon('check', 14) : it.icon ? (typeof it.icon === 'string' ? icon(it.icon, 14) : it.icon) : null),
      h('span', { class: 'menu-label' }, it.label),
      it.shortcut ? h('span', { class: 'menu-shortcut' }, it.shortcut) : null,
      it.items ? icon('chevron-right', 12) : null
    );
    if (it.items) {
      let sub;
      row.addEventListener('mouseenter', () => {
        if (sub) return;
        const r = row.getBoundingClientRect();
        sub = popover({ x: r.right - 2, y: r.top - 4 }, buildMenu(it.items, close), { keepOthers: true, onClose: () => (sub = null) });
        const leave = (e) => {
          if (!sub) return;
          if (!row.contains(e.relatedTarget) && !sub.el.contains(e.relatedTarget)) {
            sub.close();
          }
        };
        row.addEventListener('mouseleave', leave);
        sub.el.addEventListener('mouseleave', leave);
      });
    } else if (!it.disabled) {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        close();
        it.onClick && it.onClick();
      });
    }
    menu.append(row);
  }
  return menu;
}

export function showMenu(anchorOrPoint, items) {
  const holder = { close: () => {} };
  const closeAll = () => closeAllPopups();
  const p = popover(anchorOrPoint, buildMenu(items, closeAll));
  holder.close = p.close;
  return p;
}

export function contextMenu(event, items) {
  event.preventDefault();
  return showMenu({ x: event.clientX, y: event.clientY }, items);
}

/* ---------------- 颜色 ---------------- */

const THEME_COLORS = [
  ['#ffffff', '#000000', '#e7e6e6', '#44546a', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'],
  ['#f2f2f2', '#7f7f7f', '#d0cece', '#d6dce4', '#d9e2f3', '#fbe5d5', '#ededed', '#fff2cc', '#deebf6', '#e2efd9'],
  ['#d8d8d8', '#595959', '#aeabab', '#adb9ca', '#b4c6e7', '#f7cbac', '#dbdbdb', '#fee599', '#bdd7ee', '#c5e0b3'],
  ['#bfbfbf', '#3f3f3f', '#757070', '#8496b0', '#8eaadb', '#f4b183', '#c9c9c9', '#ffd965', '#9cc3e5', '#a8d08d'],
  ['#a5a5a5', '#262626', '#3a3838', '#323f4f', '#2f5496', '#c55a11', '#7b7b7b', '#bf9000', '#2e75b5', '#538135'],
  ['#7f7f7f', '#0c0c0c', '#171616', '#222a35', '#1f3864', '#833c0b', '#525252', '#7f6000', '#1e4e79', '#375623'],
];
const STD_COLORS = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];

/** 弹出 Office 风格取色器。onPick(color|null)；allowNone 时显示"无颜色" */
export function colorPicker(anchor, onPick, { allowNone = false, noneLabel = '无颜色', autoLabel } = {}) {
  let p;
  const swatch = (c) =>
    h('button', { class: 'swatch', title: c, style: { background: c }, onclick: () => { p.close(); onPick(c); } });
  const content = h(
    'div',
    { class: 'color-picker' },
    autoLabel ? h('button', { class: 'cp-wide', onclick: () => { p.close(); onPick('auto'); } }, h('span', { class: 'swatch', style: 'background:#000' }), autoLabel) : null,
    allowNone ? h('button', { class: 'cp-wide', onclick: () => { p.close(); onPick(null); } }, icon('ban', 14), noneLabel) : null,
    h('div', { class: 'cp-title' }, '主题颜色'),
    h('div', { class: 'cp-grid' }, THEME_COLORS[0].map(swatch)),
    h('div', { class: 'cp-grid cp-shades' }, THEME_COLORS.slice(1).flat().map(swatch)),
    h('div', { class: 'cp-title' }, '标准色'),
    h('div', { class: 'cp-grid' }, STD_COLORS.map(swatch)),
    h('label', { class: 'cp-wide cp-custom' }, icon('palette', 14), '其他颜色...',
      h('input', { type: 'color', onchange: (e) => { p.close(); onPick(e.target.value); } }))
  );
  p = popover(anchor, content);
  return p;
}

/* ---------------- 对话框 ---------------- */

/**
 * modal({ title, body: Node|string, buttons: [{ label, primary, value, onClick }], width })
 * 返回 Promise，resolve 为按钮的 value（或 onClick 返回值）。onClick 返回 false 可阻止关闭。
 */
export function modal({ title, body, buttons = [{ label: '确定', primary: true, value: true }], width = 420, onOpen } = {}) {
  return new Promise((resolve) => {
    const close = (v) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const footer = h('div', { class: 'modal-footer' });
    for (const b of buttons) {
      footer.append(
        h('button', {
          class: 'btn' + (b.primary ? ' btn-primary' : ''),
          onclick: async () => {
            const r = b.onClick ? await b.onClick() : b.value;
            if (r === false) return;
            close(b.onClick ? r : b.value);
          },
        }, b.label)
      );
    }
    const dialog = h('div', { class: 'modal', style: { width: typeof width === 'number' ? width + 'px' : width } },
      h('div', { class: 'modal-header' }, h('span', null, title || ''), h('button', { class: 'modal-x', onclick: () => close(undefined) }, icon('x', 16))),
      h('div', { class: 'modal-body' }, typeof body === 'string' ? h('div', { html: body }) : body),
      buttons.length ? footer : null
    );
    const overlay = h('div', { class: 'modal-overlay' }, dialog);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(undefined); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        const primary = footer.querySelector('.btn-primary');
        if (primary) { e.preventDefault(); primary.click(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    layerRoot().append(overlay);
    // 拖动标题栏
    const header = dialog.firstChild;
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      const r = dialog.getBoundingClientRect();
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      dialog.style.position = 'fixed';
      const move = (ev) => { dialog.style.left = ev.clientX - ox + 'px'; dialog.style.top = ev.clientY - oy + 'px'; dialog.style.margin = 0; };
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    });
    onOpen && onOpen(dialog, close);
    const first = dialog.querySelector('input,select,textarea');
    if (first) setTimeout(() => { first.focus(); first.select && first.select(); }, 0);
  });
}

export function alertBox(message, title = '提示') {
  return modal({ title, body: h('div', { class: 'modal-msg' }, message) });
}

export async function confirmBox(message, title = '确认', okLabel = '确定') {
  const r = await modal({ title, body: h('div', { class: 'modal-msg' }, message), buttons: [{ label: '取消', value: false }, { label: okLabel, primary: true, value: true }] });
  return !!r;
}

export async function promptBox(title, label, defaultValue = '', { type = 'text', placeholder = '' } = {}) {
  const input = h('input', { class: 'input', type, value: defaultValue, placeholder, style: 'width:100%' });
  const r = await modal({
    title,
    body: h('div', { class: 'form' }, label ? h('label', { class: 'form-label' }, label) : null, input),
    buttons: [{ label: '取消', value: null }, { label: '确定', primary: true, onClick: () => input.value }],
  });
  return r == null ? null : r;
}

/**
 * 表单对话框：fields = [{ name, label, type: 'text'|'number'|'select'|'checkbox'|'color'|'textarea', value, options: [{value,label}]|[str], min, max, step }]
 * 返回 { name: value } 或 null
 */
export async function formBox(title, fields, { width = 420, okLabel = '确定' } = {}) {
  const inputs = {};
  const rows = fields.map((f) => {
    let input;
    if (f.type === 'select') {
      input = h('select', { class: 'input' }, (f.options || []).map((o) => {
        const opt = typeof o === 'object' ? o : { value: o, label: o };
        return h('option', { value: opt.value, selected: String(opt.value) === String(f.value) }, opt.label);
      }));
    } else if (f.type === 'checkbox') {
      input = h('input', { type: 'checkbox', checked: !!f.value });
    } else if (f.type === 'textarea') {
      input = h('textarea', { class: 'input', rows: f.rows || 4 }, f.value || '');
    } else {
      input = h('input', { class: 'input', type: f.type || 'text', value: f.value ?? '', min: f.min, max: f.max, step: f.step, placeholder: f.placeholder || '' });
    }
    inputs[f.name] = input;
    return f.type === 'checkbox'
      ? h('label', { class: 'form-check' }, input, f.label)
      : h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, f.label), input);
  });
  const r = await modal({
    title,
    width,
    body: h('div', { class: 'form' }, rows),
    buttons: [{ label: '取消', value: null }, {
      label: okLabel, primary: true,
      onClick: () => {
        const out = {};
        for (const f of fields) {
          const i = inputs[f.name];
          out[f.name] = f.type === 'checkbox' ? i.checked : f.type === 'number' ? Number(i.value) : i.value;
        }
        return out;
      },
    }],
  });
  return r || null;
}

/* ---------------- 功能区 Ribbon ---------------- */

/**
 * createRibbon({ tabs, onFile, accent })
 *  tabs: [{ id, label, groups: [{ label, items: [Item...] }], contextual?: true }]
 *  Item 类型：
 *   { type:'button', id, icon, label, title, size:'large'|'small'(默认), onClick, toggle:true, showLabel }
 *   { type:'split', id, icon, label, title, size, onClick, menu: () => [菜单项] }      主按钮+下拉
 *   { type:'dropdown', id, icon, label, title, size, menu: () => [菜单项] | (anchor)=>void }
 *   { type:'select', id, options:[{value,label}]|[str], width, title, onChange(value), editable:true }
 *   { type:'color', id, icon, title, color, onClick(color), allowNone, noneLabel }  图标下带颜色条，右侧箭头弹出取色器
 *   { type:'col', items:[...] }   竖排小按钮（最多 3 行）
 *   { type:'row', items:[...] }   横排一组紧凑按钮
 *   { type:'sep' }
 *   { type:'custom', el }
 * 返回 api：{ el, setActive(id,bool), setValue(id,v), setDisabled(id,bool), setColor(id,c), get(id), showTab(id), setTabVisible(id,bool) }
 */
export function createRibbon({ tabs, onFile, accent, defaultTab, onAI } = {}) {
  const registry = {};
  const tabBar = h('div', { class: 'ribbon-tabs' });
  const panelHost = h('div', { class: 'ribbon-panels' });
  const root = h('div', { class: 'ribbon', style: accent ? { '--accent': accent } : null }, tabBar, panelHost);
  const tabEls = {};
  let current;
  let collapsed = false;

  if (onFile) {
    tabBar.append(h('button', { class: 'ribbon-tab ribbon-file', onclick: onFile }, '文件'));
  }

  for (const tab of tabs) {
    const btn = h('button', { class: 'ribbon-tab' + (tab.contextual ? ' contextual' : ''), onclick: () => api.showTab(tab.id), ondblclick: () => toggleCollapse() }, tab.label);
    const panel = h('div', { class: 'ribbon-panel' });
    for (const g of tab.groups) {
      const content = h('div', { class: 'rg-content' }, g.items.map(renderItem));
      panel.append(h('div', { class: 'ribbon-group' }, content, g.label ? h('div', { class: 'rg-label' }, g.label) : null));
    }
    tabEls[tab.id] = { btn, panel, tab };
    if (tab.hidden) btn.style.display = 'none';
    tabBar.append(btn);
    panelHost.append(panel);
  }
  tabBar.append(h('div', { class: 'ribbon-spacer' }));
  // AI 助手入口（应用传入 onAI 时显示）
  let aiBtn = null;
  if (onAI) {
    aiBtn = h('button', { class: 'ribbon-ai', title: 'AI 助手 (Ctrl+J)', onmousedown: (e) => e.preventDefault(), onclick: onAI }, icon('sparkles', 15, { strokeWidth: 2 }), 'AI 助手');
    tabBar.append(aiBtn);
  }
  const collapseBtn = h('button', { class: 'ribbon-collapse', title: '折叠/展开功能区', onclick: () => toggleCollapse() }, icon('chevron-up', 14));
  tabBar.append(collapseBtn);

  function toggleCollapse() {
    collapsed = !collapsed;
    root.classList.toggle('collapsed', collapsed);
    collapseBtn.replaceChildren(icon(collapsed ? 'chevron-down' : 'chevron-up', 14));
    window.dispatchEvent(new Event('resize'));
  }

  function iconOf(it, size) {
    if (!it.icon) return null;
    return typeof it.icon === 'string' ? icon(it.icon, size) : it.icon.cloneNode(true);
  }

  function renderItem(it) {
    switch (it.type || 'button') {
      case 'sep':
        return h('div', { class: 'rb-sep' });
      case 'custom':
        return it.el;
      case 'col':
        return h('div', { class: 'rb-col' }, it.items.map(renderItem));
      case 'row':
        return h('div', { class: 'rb-row' }, it.items.map(renderItem));
      case 'select': {
        const opts = (it.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }));
        let el;
        if (it.editable) {
          const listId = 'dl-' + Math.random().toString(36).slice(2);
          el = h('input', { class: 'rb-select rb-combo', title: it.title || '', list: listId, value: it.value ?? '', style: { width: (it.width || 80) + 'px' } });
          const dl = h('datalist', { id: listId }, opts.map((o) => h('option', { value: o.value }, o.label)));
          const commit = () => it.onChange && it.onChange(el.value);
          el.addEventListener('change', commit);
          el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
          el.addEventListener('mousedown', (e) => e.stopPropagation());
          const wrap = h('span', { class: 'rb-combo-wrap' }, el, dl);
          registry[it.id] = { it, el, wrap, setValue: (v) => { if (document.activeElement !== el) el.value = v ?? ''; } };
          return wrap;
        }
        el = h('select', { class: 'rb-select', title: it.title || '', style: { width: (it.width || 80) + 'px' }, onchange: () => it.onChange && it.onChange(el.value) },
          opts.map((o) => h('option', { value: o.value }, o.label)));
        if (it.value != null) el.value = it.value;
        if (it.id) registry[it.id] = { it, el, setValue: (v) => { el.value = v ?? ''; } };
        return el;
      }
      case 'color': {
        let color = it.color || '#ff0000';
        const bar = h('span', { class: 'rb-colorbar', style: { background: color } });
        const main = h('button', { class: 'rb-btn rb-small rb-color-main', title: it.title || it.label || '', onmousedown: (e) => e.preventDefault(), onclick: () => it.onClick && it.onClick(color) },
          h('span', { class: 'rb-color-ico' }, iconOf(it, 16), bar), it.label && it.showLabel ? h('span', { class: 'rb-label' }, it.label) : null);
        const arrow = h('button', { class: 'rb-btn rb-arrow', title: '选择颜色', onmousedown: (e) => e.preventDefault(), onclick: () => colorPicker(arrow, (c) => { if (c !== 'auto') { color = c; bar.style.background = c || 'transparent'; } it.onClick && it.onClick(c); }, { allowNone: it.allowNone, noneLabel: it.noneLabel, autoLabel: it.autoLabel }) }, icon('chevron-down', 10));
        const wrap = h('span', { class: 'rb-split' }, main, arrow);
        if (it.id) registry[it.id] = { it, el: wrap, setColor: (c) => { color = c; bar.style.background = c || 'transparent'; } };
        return wrap;
      }
      case 'split':
      case 'dropdown':
      case 'button':
      default: {
        const large = it.size === 'large';
        const isDrop = it.type === 'dropdown';
        const isSplit = it.type === 'split';
        const showLabel = large || it.showLabel;
        const btn = h('button', {
          class: 'rb-btn ' + (large ? 'rb-large' : 'rb-small'),
          title: it.title || it.label || '',
          // 阻止按钮抢走编辑区焦点/选区
          onmousedown: (e) => { if (!it.allowFocus) e.preventDefault(); },
        },
          iconOf(it, large ? 26 : 16),
          showLabel && it.label ? h('span', { class: 'rb-label' }, it.label, isDrop && large ? icon('chevron-down', 10) : null) : null,
          isDrop && !large ? icon('chevron-down', 10) : null
        );
        const openMenu = (anchor) => {
          if (typeof it.menu === 'function') {
            const r = it.menu(anchor);
            if (Array.isArray(r)) showMenu(anchor, r);
          }
        };
        let el = btn;
        if (isDrop) btn.addEventListener('click', () => openMenu(btn));
        else btn.addEventListener('click', () => it.onClick && it.onClick());
        if (isSplit) {
          const arrow = h('button', { class: 'rb-btn rb-arrow' + (large ? ' rb-arrow-large' : ''), onmousedown: (e) => e.preventDefault(), onclick: () => openMenu(el) }, icon('chevron-down', 10));
          el = h('span', { class: 'rb-split' + (large ? ' rb-split-large' : '') }, btn, arrow);
        }
        if (it.id) registry[it.id] = { it, el, btn };
        return el;
      }
    }
  }

  const api = {
    el: root,
    get: (id) => registry[id],
    setActive(id, on) { const r = registry[id]; if (r) (r.btn || r.el).classList.toggle('active', !!on); },
    setDisabled(id, off) { const r = registry[id]; if (r) { (r.btn || r.el).disabled = !!off; r.el.classList.toggle('disabled', !!off); } },
    setValue(id, v) { const r = registry[id]; if (r && r.setValue) r.setValue(v); },
    setColor(id, c) { const r = registry[id]; if (r && r.setColor) r.setColor(c); },
    showTab(id) {
      const t = tabEls[id];
      if (!t) return;
      if (collapsed && current === id) { toggleCollapse(); return; }
      Object.values(tabEls).forEach((x) => { x.btn.classList.remove('active'); x.panel.classList.remove('active'); });
      t.btn.classList.add('active');
      t.panel.classList.add('active');
      current = id;
    },
    setTabVisible(id, visible) {
      const t = tabEls[id];
      if (!t) return;
      t.btn.style.display = visible ? '' : 'none';
      if (!visible && current === id) api.showTab(tabs.find((x) => !x.hidden && !x.contextual).id);
    },
    get currentTab() { return current; },
    /** AI 助手面板打开时高亮入口按钮 */
    setAIActive(on) { if (aiBtn) aiBtn.classList.toggle('active', !!on); },
  };
  // 面板过宽时：滚轮横向滚动，两侧渐隐提示还有内容
  const updateFade = () => {
    const p = tabEls[current]?.panel;
    if (!p) return;
    panelHost.classList.toggle('can-left', p.scrollLeft > 2);
    panelHost.classList.toggle('can-right', p.scrollLeft + p.clientWidth < p.scrollWidth - 2);
  };
  for (const { panel } of Object.values(tabEls)) {
    panel.addEventListener('wheel', (e) => {
      if (panel.scrollWidth <= panel.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      panel.scrollLeft += e.deltaY;
    }, { passive: false });
    panel.addEventListener('scroll', updateFade, { passive: true });
  }
  if (window.ResizeObserver) new ResizeObserver(updateFade).observe(panelHost);
  const show = api.showTab;
  api.showTab = (id) => { show(id); updateFade(); };
  api.showTab(defaultTab || tabs[0].id);
  return api;
}

/* ---------------- 其他小组件 ---------------- */

/** 网格选择器（插入表格用）：返回 Node，onPick(rows, cols) */
export function gridPicker(onPick, maxR = 8, maxC = 10) {
  const label = h('div', { class: 'gp-label' }, '插入表格');
  const grid = h('div', { class: 'gp-grid', style: { gridTemplateColumns: `repeat(${maxC}, 16px)` } });
  const cells = [];
  for (let r = 0; r < maxR; r++)
    for (let c = 0; c < maxC; c++) {
      const cell = h('div', { class: 'gp-cell' });
      cell.addEventListener('mouseenter', () => {
        cells.forEach((x) => x.el.classList.toggle('on', x.r <= r && x.c <= c));
        label.textContent = `${r + 1} 行 × ${c + 1} 列`;
      });
      cell.addEventListener('click', () => onPick(r + 1, c + 1));
      cells.push({ el: cell, r, c });
      grid.append(cell);
    }
  return h('div', { class: 'grid-picker' }, label, grid);
}

/** 状态栏缩放控件：返回 { el, set(z) }；zoom 为百分比数字 */
export function zoomControl(initial, onChange, { min = 10, max = 400 } = {}) {
  let z = initial;
  const label = h('span', { class: 'zoom-label' }, z + '%');
  const range = h('input', { type: 'range', min, max, value: z, class: 'zoom-range', oninput: () => set(+range.value, true) });
  const set = (v, fire) => {
    z = Math.max(min, Math.min(max, Math.round(v)));
    range.value = z;
    label.textContent = z + '%';
    if (fire) onChange(z);
  };
  const el = h('div', { class: 'zoom-ctl' },
    h('button', { class: 'sb-btn', title: '缩小', onclick: () => set(z - 10, true) }, icon('minus', 14)),
    range,
    h('button', { class: 'sb-btn', title: '放大', onclick: () => set(z + 10, true) }, icon('plus', 14)),
    label);
  label.addEventListener('click', async () => {
    const v = await promptBox('缩放', '缩放比例 (%)', String(z), { type: 'number' });
    if (v) set(+v, true);
  });
  return { el, set: (v) => set(v, false), get: () => z };
}

/** 符号选择面板 */
export const SYMBOLS = '©®™°±×÷≈≠≤≥∞√∑∏∫∂∆∇πΩαβγδεθλμσφψω€£¥¢§¶†‡•…‰′″←↑→↓↔↕⇒⇔∀∃∈∉∩∪⊂⊃⊆⊇∧∨¬★☆●○◆◇■□▲△▼▽♠♣♥♦♪♫☀☁☂☎☑☒✓✔✗✘①②③④⑤⑥⑦⑧⑨⑩ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ「」『』【】〔〕《》〈〉※々〇'.split('');
export function symbolPicker(anchor, onPick) {
  let p;
  const grid = h('div', { class: 'sym-grid' }, SYMBOLS.map((s) => h('button', { class: 'sym', onmousedown: (e) => e.preventDefault(), onclick: () => { p.close(); onPick(s); } }, s)));
  p = popover(anchor, h('div', { class: 'sym-panel' }, h('div', { class: 'cp-title' }, '符号'), grid));
  return p;
}

export const FONT_FAMILIES = [
  { value: 'Microsoft YaHei', label: '微软雅黑' },
  { value: 'SimSun', label: '宋体' },
  { value: 'SimHei', label: '黑体' },
  { value: 'KaiTi', label: '楷体' },
  { value: 'FangSong', label: '仿宋' },
  { value: 'DengXian', label: '等线' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Calibri', label: 'Calibri' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Verdana', label: 'Verdana' },
  { value: 'Courier New', label: 'Courier New' },
  { value: 'Consolas', label: 'Consolas' },
  { value: 'Impact', label: 'Impact' },
];
export const FONT_SIZES = [
  { value: '42', label: '初号' }, { value: '36', label: '小初' }, { value: '26', label: '一号' }, { value: '24', label: '小一' },
  { value: '22', label: '二号' }, { value: '18', label: '小二' }, { value: '16', label: '三号' }, { value: '15', label: '小三' },
  { value: '14', label: '四号' }, { value: '12', label: '小四' }, { value: '10.5', label: '五号' }, { value: '9', label: '小五' },
  ...[8, 10, 11, 20, 28, 32, 40, 48, 54, 60, 72, 96].map((n) => ({ value: String(n), label: String(n) })),
].sort((a, b) => a.value - b.value);
