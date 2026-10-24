// 浮动对象：图表（Chart.js）与图片，支持拖动、缩放、右键菜单
import { Chart, registerables } from 'chart.js';
import { h, icon, toast, formBox, contextMenu, pickFile, readFileAs, promptBox } from '../../core/ui.js';
import { oid } from './model.js';
import { formatValue, isErr } from './format.js';
import { rangeStr, parseRange, colName } from './refs.js';
import { currentRegion } from './commands.js';

Chart.register(...registerables);

export const CHART_TYPES = [
  { id: 'bar', label: '柱形图', icon: 'chart-column' },
  { id: 'hbar', label: '条形图', icon: 'chart-bar' },
  { id: 'stacked', label: '堆积柱形图', icon: 'chart-column-stacked' },
  { id: 'line', label: '折线图', icon: 'chart-line' },
  { id: 'area', label: '面积图', icon: 'chart-area' },
  { id: 'pie', label: '饼图', icon: 'chart-pie' },
  { id: 'doughnut', label: '圆环图', icon: 'circle-dot' },
  { id: 'scatter', label: '散点图', icon: 'chart-scatter' },
  { id: 'radar', label: '雷达图', icon: 'radar' },
];
const PALETTE = ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47', '#264478', '#9e480e', '#636363', '#997300'];

export class ObjectLayer {
  constructor(ed) {
    this.ed = ed;
    this.layer = ed.grid.objInner;
    this.views = new Map(); // id -> { el, chart, sig }
    this.selected = null;
  }

  get list() { return this.ed.sheet.objects || (this.ed.sheet.objects = []); }

  /** 渲染当前工作表的所有对象 */
  render() {
    const z = this.ed.zoom / 100;
    const ids = new Set(this.list.map((o) => o.id));
    for (const [id, v] of this.views) {
      if (!ids.has(id) || v.sheetId !== this.ed.sheet.id) { v.chart && v.chart.destroy(); v.el.remove(); this.views.delete(id); }
    }
    for (const o of this.list) {
      let v = this.views.get(o.id);
      if (!v) {
        v = this.create(o);
        this.views.set(o.id, v);
      }
      v.obj = o;
      Object.assign(v.el.style, { left: o.x * z + 'px', top: o.y * z + 'px', width: o.w * z + 'px', height: o.h * z + 'px', zIndex: o.z || 1 });
      v.el.classList.toggle('selected', this.selected === o.id);
      if (o.kind === 'chart') this.updateChart(v, o);
      else if (o.kind === 'image' && v.img.src !== o.src) v.img.src = o.src;
    }
  }

  create(o) {
    const el = h('div', { class: 'ss-obj ss-obj-' + o.kind, dataset: { id: o.id } });
    const v = { el, sheetId: this.ed.sheet.id };
    if (o.kind === 'chart') {
      v.canvas = h('canvas');
      el.append(h('div', { class: 'ss-chart-box' }, v.canvas));
    } else {
      v.img = h('img', { src: o.src, draggable: false });
      el.append(v.img);
    }
    for (const pos of ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w']) {
      const hd = h('div', { class: 'ss-obj-handle ' + pos });
      hd.addEventListener('mousedown', (e) => this.startResize(e, v, pos));
      el.append(hd);
    }
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.classList.contains('ss-obj-handle')) return;
      this.startMove(e, v);
    });
    el.addEventListener('dblclick', () => { if (o.kind === 'chart') this.editChart(v.obj); });
    el.addEventListener('contextmenu', (e) => {
      this.select(v.obj.id);
      contextMenu(e, this.menu(v.obj));
    });
    this.layer.append(el);
    return v;
  }

  select(id) {
    if (this.selected === id) return;
    this.selected = id;
    for (const [oid2, v] of this.views) v.el.classList.toggle('selected', oid2 === id);
    this.ed.ribbon.setTabVisible('chart', !!(id && this.list.find((o) => o.id === id)?.kind === 'chart'));
    if (id) this.ed.input.focus({ preventScroll: true });
  }

  startMove(e, v) {
    e.preventDefault();
    e.stopPropagation();
    if (this.ed.editing) this.ed.commitEdit();
    this.select(v.obj.id);
    const z = this.ed.zoom / 100;
    const o = v.obj;
    const sx = e.clientX, sy = e.clientY, ox = o.x, oy = o.y;
    let moved = false;
    const before = this.ed.snapshot('sheet');
    const mv = (ev) => {
      const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      o.x = Math.max(0, Math.round(ox + dx));
      o.y = Math.max(0, Math.round(oy + dy));
      v.el.style.left = o.x * z + 'px';
      v.el.style.top = o.y * z + 'px';
    };
    const up = () => {
      removeEventListener('mousemove', mv);
      removeEventListener('mouseup', up);
      if (moved) this.commitRaw(before, '移动对象');
    };
    addEventListener('mousemove', mv);
    addEventListener('mouseup', up);
  }

  startResize(e, v, pos) {
    e.preventDefault();
    e.stopPropagation();
    this.select(v.obj.id);
    const z = this.ed.zoom / 100;
    const o = v.obj;
    const sx = e.clientX, sy = e.clientY;
    const start = { x: o.x, y: o.y, w: o.w, h: o.h };
    const ratio = start.w / start.h;
    const before = this.ed.snapshot('sheet');
    const mv = (ev) => {
      const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
      let { x, y, w, h: hh } = start;
      if (pos.includes('e')) w = start.w + dx;
      if (pos.includes('s')) hh = start.h + dy;
      if (pos.includes('w')) { w = start.w - dx; x = start.x + dx; }
      if (pos.includes('n')) { hh = start.h - dy; y = start.y + dy; }
      if (ev.shiftKey && pos.length === 2) hh = w / ratio;
      o.w = Math.max(40, Math.round(w));
      o.h = Math.max(30, Math.round(hh));
      o.x = Math.max(0, Math.round(Math.min(x, start.x + start.w - 40)));
      o.y = Math.max(0, Math.round(Math.min(y, start.y + start.h - 30)));
      Object.assign(v.el.style, { left: o.x * z + 'px', top: o.y * z + 'px', width: o.w * z + 'px', height: o.h * z + 'px' });
      v.chart && v.chart.resize();
    };
    const up = () => {
      removeEventListener('mousemove', mv);
      removeEventListener('mouseup', up);
      this.commitRaw(before, '调整对象大小');
    };
    addEventListener('mousemove', mv);
    addEventListener('mouseup', up);
  }

  /** 已经就地修改，补记撤销项 */
  commitRaw(before, label) {
    const ed = this.ed;
    ed.undoStack.push({ label, scope: 'sheet', si: ed.si, data: before, sel: structuredClone(ed.sel) });
    ed.redoStack = [];
    ed.ctx.markDirty();
  }

  deleteSelected() {
    const id = this.selected;
    if (!id) return;
    this.select(null);
    this.ed.change('删除对象', () => { this.ed.sheet.objects = this.list.filter((o) => o.id !== id); });
  }

  menu(o) {
    const items = [
      { label: '删除', icon: 'trash-2', onClick: () => this.deleteSelected() },
      { label: '置于顶层', icon: 'bring-to-front', onClick: () => this.ed.change('置于顶层', () => { o.z = Math.max(1, ...this.list.map((x) => x.z || 1)) + 1; }) },
      { label: '置于底层', icon: 'send-to-back', onClick: () => this.ed.change('置于底层', () => { o.z = 1; this.list.forEach((x) => { if (x !== o) x.z = (x.z || 1) + 1; }); }) },
    ];
    if (o.kind === 'chart') {
      items.unshift(
        { label: '更改图表类型', icon: 'chart-column', items: CHART_TYPES.map((t) => ({ label: t.label, checked: o.type === t.id, onClick: () => this.ed.change('图表类型', () => { o.type = t.id; }) })) },
        { label: '编辑图表...', icon: 'settings-2', onClick: () => this.editChart(o) },
        { label: '切换行/列', icon: 'arrow-left-right', onClick: () => this.ed.change('切换行列', () => { o.byRow = !o.byRow; }) },
        { label: '导出为图片', icon: 'image-down', onClick: () => this.exportChart(o) },
        '-');
    }
    return items;
  }

  /* ---------- 图表 ---------- */
  insertChart(type) {
    const ed = this.ed;
    let rg = ed.range;
    if (rg.r1 === rg.r2 && rg.c1 === rg.c2) {
      rg = currentRegion(ed, rg.r1, rg.c1);
    } else rg = ed.usedPart(rg);
    if (rg.r1 === rg.r2 && rg.c1 === rg.c2 && !ed.hasData(rg.r1, rg.c1)) { toast('请先选择包含数据的单元格区域', 'error'); return; }
    const g = ed.grid;
    const o = {
      id: oid(), kind: 'chart', type, src: rg, title: '', legend: 'bottom', byRow: false,
      x: g.X(rg.c2 + 1) + 20, y: g.Y(rg.r1), w: 480, h: 300, z: 1,
    };
    ed.change('插入图表', () => { this.list.push(o); });
    this.select(o.id);
    ed.ribbon.showTab('chart');
  }

  /** 从区域生成 Chart.js 数据 */
  chartData(o) {
    const ed = this.ed;
    const si = ed.si;
    const rg = o.src;
    const val = (r, c) => ed.engine.display(si, r, c);
    const grid = [];
    // 隐藏的行列（含筛选隐藏）不参与绘图
    const visCols = [];
    for (let c = rg.c1; c <= rg.c2; c++) if (ed.grid.colW(c) || c === rg.c1) visCols.push(c);
    for (let r = rg.r1; r <= rg.r2; r++) {
      if (!ed.grid.rowH(r) && r !== rg.r1) continue;
      grid.push(visCols.map((c) => val(r, c)));
    }
    let M = grid;
    if (o.byRow) M = grid[0].map((_, j) => grid.map((row) => row[j]));
    const rows = M.length, cols = M[0].length;
    // 首行为系列名（含文本）、首列为分类（含文本）
    const headRow = M[0].slice(1).some((v) => typeof v === 'string') || (M[0][0] == null && cols > 1);
    const headCol = M.slice(headRow ? 1 : 0).some((row) => typeof row[0] === 'string') || (cols > 1 && M.slice(1).every((row) => typeof row[0] === 'number' && Number.isInteger(row[0]) && row[0] > 1900 && row[0] < 2100));
    const r0 = headRow ? 1 : 0, c0 = headCol ? 1 : 0;
    const fmt = (v, r, c) => (v == null ? '' : typeof v === 'number' ? formatValue(v, ed.cellAt(r, c)?.s?.nf).text : String(v));
    const labels = [];
    for (let r = r0; r < rows; r++) labels.push(headCol ? fmt(M[r][0]) : String(r - r0 + 1));
    const datasets = [];
    for (let c = c0; c < cols; c++) {
      datasets.push({
        label: headRow ? fmt(M[0][c]) : '系列' + (c - c0 + 1),
        data: M.slice(r0).map((row) => (typeof row[c] === 'number' ? row[c] : row[c] == null || isErr(row[c]) ? null : Number(row[c]) || 0)),
      });
    }
    return { labels, datasets };
  }

  chartConfig(o) {
    const { labels, datasets } = this.chartData(o);
    const t = o.type;
    const pieLike = t === 'pie' || t === 'doughnut';
    const colors = o.colors || PALETTE;
    const z = this.ed.zoom / 100;
    let type = { hbar: 'bar', stacked: 'bar', area: 'line' }[t] || t;
    const ds = pieLike
      ? [{ ...datasets[0], data: datasets[0]?.data || [], backgroundColor: labels.map((_, i) => colors[i % colors.length]), borderColor: '#fff', borderWidth: 2 }]
      : datasets.map((d, i) => {
        const col = colors[i % colors.length];
        const base = { ...d, backgroundColor: t === 'area' ? col + '55' : t === 'radar' ? col + '33' : col, borderColor: col, borderWidth: t === 'line' || t === 'area' || t === 'radar' ? 2 : 0, fill: t === 'area', tension: o.smooth ? 0.35 : 0, pointRadius: t === 'scatter' ? 4 : 3 };
        if (t === 'scatter') base.data = d.data.map((y, j) => ({ x: Number(labels[j]) || j + 1, y }));
        return base;
      });
    const showLegend = o.legend !== 'none';
    const fontSize = Math.max(8, Math.round(12 * z));
    const scales = pieLike || t === 'radar' ? undefined : {
      x: { stacked: t === 'stacked', grid: { display: t === 'hbar' }, ticks: { font: { size: fontSize } }, title: o.xTitle ? { display: true, text: o.xTitle } : undefined },
      y: { stacked: t === 'stacked', beginAtZero: true, grid: { color: '#eceef1', display: t !== 'hbar' }, ticks: { font: { size: fontSize } }, title: o.yTitle ? { display: true, text: o.yTitle } : undefined },
    };
    return {
      type,
      data: { labels, datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        indexAxis: t === 'hbar' ? 'y' : 'x',
        plugins: {
          title: { display: !!o.title, text: o.title, font: { size: Math.round(16 * z), weight: 'bold' }, color: '#333' },
          legend: { display: showLegend, position: o.legend || 'bottom', labels: { font: { size: fontSize }, boxWidth: 12 * z } },
          datalabels: false,
        },
        scales,
      },
    };
  }

  updateChart(v, o) {
    const cfg = this.chartConfig(o);
    const sig = JSON.stringify([o.type, o.title, o.legend, o.byRow, o.smooth, o.colors, o.xTitle, o.yTitle, this.ed.zoom]);
    if (v.chart && v.sig === sig) {
      v.chart.data.labels = cfg.data.labels;
      v.chart.data.datasets = cfg.data.datasets;
      v.chart.update('none');
      return;
    }
    v.chart && v.chart.destroy();
    v.sig = sig;
    v.chart = new Chart(v.canvas, cfg);
  }

  async editChart(o) {
    const res = await formBox('图表设置', [
      { name: 'type', label: '图表类型', type: 'select', value: o.type, options: CHART_TYPES.map((t) => ({ value: t.id, label: t.label })) },
      { name: 'title', label: '图表标题', value: o.title || '' },
      { name: 'src', label: '数据区域', value: rangeStr(o.src) },
      { name: 'legend', label: '图例位置', type: 'select', value: o.legend || 'bottom', options: [{ value: 'bottom', label: '底部' }, { value: 'top', label: '顶部' }, { value: 'right', label: '右侧' }, { value: 'left', label: '左侧' }, { value: 'none', label: '无' }] },
      { name: 'xTitle', label: '横坐标标题', value: o.xTitle || '' },
      { name: 'yTitle', label: '纵坐标标题', value: o.yTitle || '' },
      { name: 'byRow', label: '系列产生在行', type: 'checkbox', value: !!o.byRow },
      { name: 'smooth', label: '平滑线', type: 'checkbox', value: !!o.smooth },
    ], { width: 440 });
    if (!res) return;
    const rg = parseRange(res.src);
    if (!rg) { toast('数据区域无效', 'error'); return; }
    this.ed.change('编辑图表', () => Object.assign(o, { type: res.type, title: res.title, src: rg, legend: res.legend, xTitle: res.xTitle, yTitle: res.yTitle, byRow: res.byRow, smooth: res.smooth }));
  }

  selectedChart() {
    const o = this.list.find((x) => x.id === this.selected);
    return o && o.kind === 'chart' ? o : null;
  }

  exportChart(o) {
    const v = this.views.get(o.id);
    if (!v || !v.chart) return;
    const a = h('a', { href: v.chart.toBase64Image('image/png', 1), download: (o.title || '图表') + '.png' });
    document.body.append(a);
    a.click();
    a.remove();
  }

  /* ---------- 图片 ---------- */
  async insertImage() {
    const f = await pickFile('image/*');
    if (f) this.insertImageFile(f);
  }
  async insertImageFile(f) {
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { toast('图片过大（最大 8MB）', 'error'); return; }
    const src = await readFileAs(f, 'dataURL');
    const img = new Image();
    img.src = src;
    await new Promise((r) => { img.onload = img.onerror = r; });
    let w = img.naturalWidth || 300, hh = img.naturalHeight || 200;
    const k = Math.min(1, 400 / w, 300 / hh);
    w = Math.round(w * k); hh = Math.round(hh * k);
    const g = this.ed.grid, a = this.ed.sel.active;
    const o = { id: oid(), kind: 'image', src, x: g.X(a.c), y: g.Y(a.r), w, h: hh, z: 1 };
    this.ed.change('插入图片', () => { this.list.push(o); });
    this.select(o.id);
  }

  destroy() {
    for (const v of this.views.values()) v.chart && v.chart.destroy();
    this.views.clear();
  }
}
