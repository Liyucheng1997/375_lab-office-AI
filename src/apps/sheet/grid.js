// Canvas 网格渲染：几何计算、冻结窗格、虚拟滚动、单元格/选区/表头绘制、命中测试
import { h } from '../../core/ui.js';
import { colName, key, MAX_ROWS, MAX_COLS } from './refs.js';
import { formatValue, isErr } from './format.js';
import { DEFAULT_COL_W, DEFAULT_ROW_H, DEFAULT_FONT, DEFAULT_FS } from './model.js';
import { buildCF } from './cf.js';

const GRID_COLOR = '#ebebef';
const HEAD_BG = '#fafafc';
const HEAD_BORDER = '#e5e5ea';
const HEAD_TEXT = '#86868b';
const SEL_FILL = 'rgba(0,113,227,0.08)';
const ACCENT = '#0071e3';
const REF_COLORS = ['#0071e3', '#c93400', '#8944ab', '#248a3d', '#d70015', '#a37b00', '#0e8f9e'];

export class Grid {
  constructor(ed, host) {
    this.ed = ed;
    this.canvas = h('canvas', { class: 'ss-canvas' });
    this.spacer = h('div', { class: 'ss-spacer' });
    this.scroller = h('div', { class: 'ss-scroller', tabindex: -1 }, this.spacer);
    this.objInner = h('div', { class: 'ss-obj-inner' });
    this.objLayer = h('div', { class: 'ss-obj-layer' }, this.objInner);
    host.append(this.canvas, this.scroller, this.objLayer);
    this.ctx = this.canvas.getContext('2d');
    this.W = 0; this.H = 0;
    this.geoKey = '';
    this.scroller.addEventListener('scroll', () => this.onScroll());
    this.objLayer.addEventListener('wheel', (e) => { this.scroller.scrollBy(e.deltaX, e.deltaY); }, { passive: true });
    this.wrapCache = new Map();
    this.geometry();
  }

  get sheet() { return this.ed.sheet; }
  get z() { return this.ed.zoom / 100; }
  get hw() { return this.sheet.showHeaders ? Math.round(Math.max(40, String(this.sheet.rows).length * 8 + 18) * this.z) : 0; }
  get hh() { return this.sheet.showHeaders ? Math.round(24 * this.z) : 0; }

  /* ---------- 几何 ---------- */
  colW(c) {
    const s = this.sheet;
    if (s.hiddenCols[c]) return 0;
    return s.colW[c] ?? DEFAULT_COL_W;
  }
  rowH(r) {
    const s = this.sheet;
    if (s.hiddenRows[r] || (s.filterHidden && s.filterHidden[r])) return 0;
    return s.rowH[r] ?? DEFAULT_ROW_H;
  }
  /** 重新计算行列坐标前缀和（仅在尺寸改变时） */
  geometry() {
    const s = this.sheet;
    const k = s.id + '|' + s.rows + '|' + s.cols + '|' + this.ed.layoutVer;
    if (k === this.geoKey) return;
    this.geoKey = k;
    const cx = new Float64Array(s.cols + 1);
    for (let c = 0; c < s.cols; c++) cx[c + 1] = cx[c] + this.colW(c);
    const ry = new Float64Array(s.rows + 1);
    for (let r = 0; r < s.rows; r++) ry[r + 1] = ry[r] + this.rowH(r);
    this.cx = cx; this.ry = ry;
    this.updateSpacer();
  }
  X(c) { return this.cx[Math.min(c, this.cx.length - 1)]; }
  Y(r) { return this.ry[Math.min(r, this.ry.length - 1)]; }
  /** 某个 sheet 坐标所在的列（二分） */
  colAt(x) { return bsearch(this.cx, x); }
  rowAt(y) { return bsearch(this.ry, y); }

  updateSpacer() {
    const z = this.z;
    this.spacer.style.width = this.hw + this.cx[this.cx.length - 1] * z + 'px';
    this.spacer.style.height = this.hh + this.ry[this.ry.length - 1] * z + 'px';
  }

  resize() {
    const r = this.scroller.getBoundingClientRect();
    const W = this.scroller.clientWidth, H = this.scroller.clientHeight;
    if (!r.width) return false;
    const dpr = window.devicePixelRatio || 1;
    if (W !== this.W || H !== this.H || dpr !== this.dpr) {
      this.W = W; this.H = H; this.dpr = dpr;
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
      this.canvas.style.width = W + 'px';
      this.canvas.style.height = H + 'px';
      this.objLayer.style.width = W + 'px';
      this.objLayer.style.height = H + 'px';
    }
    return true;
  }

  onScroll() {
    // 接近末尾时自动扩展行列
    const s = this.sheet, sc = this.scroller;
    let grew = false;
    if (sc.scrollTop + sc.clientHeight > sc.scrollHeight - 300 && s.rows < MAX_ROWS) { s.rows = Math.min(MAX_ROWS, s.rows + 100); grew = true; }
    if (sc.scrollLeft + sc.clientWidth > sc.scrollWidth - 300 && s.cols < MAX_COLS) { s.cols = Math.min(MAX_COLS, s.cols + 10); grew = true; }
    if (grew) this.geometry();
    this.positionObjects();
    this.ed.onViewChange();
    this.draw();
  }

  get sx() { return this.scroller.scrollLeft; }
  get sy() { return this.scroller.scrollTop; }
  get fr() { return Math.min(this.sheet.freeze?.r || 0, this.sheet.rows); }
  get fc() { return Math.min(this.sheet.freeze?.c || 0, this.sheet.cols); }

  /** 列 c 左边界的屏幕 x */
  screenX(c) { const z = this.z; return c < this.fc ? this.hw + this.X(c) * z : this.hw + this.X(c) * z - this.sx; }
  screenY(r) { const z = this.z; return r < this.fr ? this.hh + this.Y(r) * z : this.hh + this.Y(r) * z - this.sy; }

  /** 单元格（含合并）屏幕矩形 */
  cellRect(r, c) {
    const m = this.ed.mergeAt(r, c);
    const r1 = m ? m.r1 : r, c1 = m ? m.c1 : c, r2 = m ? m.r2 : r, c2 = m ? m.c2 : c;
    const x = this.screenX(c1), y = this.screenY(r1);
    const z = this.z;
    return { x, y, w: (this.X(c2 + 1) - this.X(c1)) * z, h: (this.Y(r2 + 1) - this.Y(r1)) * z };
  }

  /** 屏幕坐标命中测试 */
  hit(x, y) {
    const z = this.z, hw = this.hw, hh = this.hh;
    const fx = hw + this.X(this.fc) * z, fy = hh + this.Y(this.fr) * z;
    const sheetX = x < fx ? (x - hw) / z : (x - hw + this.sx) / z;
    const sheetY = y < fy ? (y - hh) / z : (y - hh + this.sy) / z;
    const c = Math.max(0, Math.min(this.sheet.cols - 1, this.colAt(sheetX)));
    const r = Math.max(0, Math.min(this.sheet.rows - 1, this.rowAt(sheetY)));
    let area = 'cell';
    if (x < hw && y < hh) area = 'corner';
    else if (y < hh) area = 'colhead';
    else if (x < hw) area = 'rowhead';
    const res = { area, r, c, sheetX, sheetY };
    // 表头边界（用于拖动调整大小）
    if (area === 'colhead') {
      const right = this.screenX(c + 1), left = this.screenX(c);
      if (Math.abs(x - right) <= 4) res.resizeCol = c;
      else if (Math.abs(x - left) <= 4 && c > 0) res.resizeCol = prevVisible(c, (i) => this.colW(i));
    }
    if (area === 'rowhead') {
      const bottom = this.screenY(r + 1), top = this.screenY(r);
      if (Math.abs(y - bottom) <= 3) res.resizeRow = r;
      else if (Math.abs(y - top) <= 3 && r > 0) res.resizeRow = prevVisible(r, (i) => this.rowH(i));
    }
    return res;
  }

  ensureVisible(r, c) {
    const z = this.z, sc = this.scroller;
    const W = this.W, H = this.H;
    if (c >= this.fc) {
      const left = this.hw + this.X(c) * z - this.sx, right = left + this.colW(c) * z;
      const minX = this.hw + this.X(this.fc) * z;
      if (left < minX) sc.scrollLeft -= minX - left;
      else if (right > W) sc.scrollLeft += Math.min(right - W, left - minX);
    }
    if (r >= this.fr) {
      const top = this.hh + this.Y(r) * z - this.sy, bottom = top + this.rowH(r) * z;
      const minY = this.hh + this.Y(this.fr) * z;
      if (top < minY) sc.scrollTop -= minY - top;
      else if (bottom > H) sc.scrollTop += Math.min(bottom - H, top - minY);
    }
  }

  /** 可见行列范围（滚动区） */
  visibleRange() {
    const z = this.z;
    return {
      r1: this.rowAt(this.Y(this.fr) + this.sy / z), r2: Math.min(this.sheet.rows - 1, this.rowAt((this.H - this.hh + this.sy) / z)),
      c1: this.colAt(this.X(this.fc) + this.sx / z), c2: Math.min(this.sheet.cols - 1, this.colAt((this.W - this.hw + this.sx) / z)),
    };
  }

  positionObjects() {
    this.objLayer.style.left = this.hw + 'px';
    this.objLayer.style.top = this.hh + 'px';
    this.objLayer.style.width = Math.max(0, this.W - this.hw) + 'px';
    this.objLayer.style.height = Math.max(0, this.H - this.hh) + 'px';
    this.objInner.style.transform = `translate(${-this.sx}px, ${-this.sy}px)`;
  }

  /* ---------- 绘制 ---------- */
  invalidate() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  draw() {
    if (!this.resize()) return;
    this.geometry();
    const ctx = this.ctx, dpr = this.dpr, z = this.z;
    const W = this.W, H = this.H, hw = this.hw, hh = this.hh;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    this.cf = buildCF(this.ed.engine, this.ed.si, this.sheet);
    const fr = this.fr, fc = this.fc;
    const fx = hw + this.X(fc) * z, fy = hh + this.Y(fr) * z;
    const vr = this.visibleRange();
    // 四个象限：[行范围, 列范围, 裁剪区, 偏移]
    const quads = [
      [vr.r1, vr.r2, vr.c1, vr.c2, { x: fx, y: fy, w: W - fx, h: H - fy }, this.sx, this.sy],
    ];
    if (fr > 0) quads.push([0, fr - 1, vr.c1, vr.c2, { x: fx, y: hh, w: W - fx, h: fy - hh }, this.sx, 0]);
    if (fc > 0) quads.push([vr.r1, vr.r2, 0, fc - 1, { x: hw, y: fy, w: fx - hw, h: H - fy }, 0, this.sy]);
    if (fr > 0 && fc > 0) quads.push([0, fr - 1, 0, fc - 1, { x: hw, y: hh, w: fx - hw, h: fy - hh }, 0, 0]);
    for (const q of quads) this.drawQuad(...q);
    if (this.sheet.showHeaders) this.drawHeaders(vr, fx, fy);
    // 冻结线
    ctx.strokeStyle = '#9aa0a8';
    ctx.lineWidth = 1;
    if (fr > 0) { ctx.beginPath(); ctx.moveTo(0, Math.round(fy) + 0.5); ctx.lineTo(W, Math.round(fy) + 0.5); ctx.stroke(); }
    if (fc > 0) { ctx.beginPath(); ctx.moveTo(Math.round(fx) + 0.5, 0); ctx.lineTo(Math.round(fx) + 0.5, H); ctx.stroke(); }
  }

  drawQuad(r1, r2, c1, c2, clip, offX, offY) {
    if (clip.w <= 0 || clip.h <= 0 || r2 < r1 || c2 < c1) return;
    const ctx = this.ctx, z = this.z, s = this.sheet, ed = this.ed;
    const hw = this.hw, hh = this.hh;
    const sx = (c) => hw + this.X(c) * z - offX;
    const sy = (r) => hh + this.Y(r) * z - offY;
    ctx.save();
    ctx.beginPath();
    ctx.rect(clip.x, clip.y, clip.w, clip.h);
    ctx.clip();

    // 网格线
    if (s.showGrid) {
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const top = sy(r1), bottom = sy(r2 + 1), left = sx(c1), right = sx(c2 + 1);
      for (let c = c1; c <= c2 + 1; c++) { if (c <= c2 && !this.colW(c)) continue; const x = Math.round(sx(c)) - 0.5; ctx.moveTo(x, top); ctx.lineTo(x, bottom); }
      for (let r = r1; r <= r2 + 1; r++) { if (r <= r2 && !this.rowH(r)) continue; const y = Math.round(sy(r)) - 0.5; ctx.moveTo(left, y); ctx.lineTo(right, y); }
      ctx.stroke();
    }

    const merges = s.merges.filter((m) => m.r2 >= r1 && m.r1 <= r2 && m.c2 >= c1 && m.c1 <= c2);
    const inMerge = (r, c) => merges.some((m) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2);
    const texts = [];
    const cf = this.cf;

    // 背景
    for (let r = r1; r <= r2; r++) {
      const rh = this.rowH(r) * z;
      if (!rh) continue;
      const y = sy(r);
      for (let c = c1; c <= c2; c++) {
        const cw = this.colW(c) * z;
        if (!cw) continue;
        if (merges.length && inMerge(r, c)) continue;
        const cell = s.cells[key(r, c)];
        const cfs = cf && cf(r, c);
        const x = sx(c);
        this.paintCell(r, c, cell, cfs, x, y, cw, rh, texts, c2, sx);
      }
    }
    // 合并单元格
    for (const m of merges) {
      const x = sx(m.c1), y = sy(m.r1);
      const w = (this.X(m.c2 + 1) - this.X(m.c1)) * z, hgt = (this.Y(m.r2 + 1) - this.Y(m.r1)) * z;
      const cell = s.cells[key(m.r1, m.c1)];
      ctx.fillStyle = '#fff';
      ctx.fillRect(x, y, w - 1, hgt - 1);
      const cfs = cf && cf(m.r1, m.c1);
      this.paintCell(m.r1, m.c1, cell, cfs, x, y, w, hgt, texts, m.c2, sx, true);
    }
    // 文本
    for (const t of texts) this.drawText(t);
    // 边框
    this.drawBorders(r1, r2, c1, c2, sx, sy, merges);
    // 选区等覆盖层
    this.drawOverlays(r1, r2, c1, c2, sx, sy);
    ctx.restore();
  }

  paintCell(r, c, cell, cfs, x, y, w, hgt, texts, cMax, sx, merged) {
    const ctx = this.ctx, z = this.z, s = this.sheet, ed = this.ed;
    const st = cell && cell.s;
    const bg = (cfs && cfs.bg) || (st && st.bg);
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(x - 1, y - 1, w + 1, hgt + 1); }
    if (cfs && cfs.bar) {
      const bw = Math.max(0, Math.min(1, cfs.bar.pct)) * (w - 4);
      // 纯色数据条（半透明，压在文字下面不抢眼），圆角
      ctx.fillStyle = cfs.bar.color + '55';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x + 2, y + 3, bw, hgt - 7, 3) : ctx.rect(x + 2, y + 3, bw, hgt - 7);
      ctx.fill();
    }
    let v = ed.engine.display(ed.si, r, c);
    const showF = ed.showFormulas && cell && cell.f != null;
    if (v == null && !showF) {
      // 筛选按钮仍需绘制
      if (s.filter && r === s.filter.r1 && c >= s.filter.c1 && c <= s.filter.c2) texts.push({ filterBtn: true, x, y, w, h: hgt, c });
      if (cell && cell.cm) texts.push({ comment: true, x, y, w, h: hgt });
      return;
    }
    const nf = st && st.nf;
    let { text, color } = showF ? { text: '=' + cell.f } : formatValue(v, nf);
    let ha = st && st.ha;
    if (!ha || ha === 'general') ha = showF ? 'left' : typeof v === 'number' ? 'right' : typeof v === 'boolean' || isErr(v) ? 'center' : 'left';
    const fs = ((st && st.fs) || DEFAULT_FS) * (4 / 3) * z;
    const font = `${st && st.i ? 'italic ' : ''}${(cfs && cfs.b) || (st && st.b) ? 'bold ' : ''}${fs.toFixed(1)}px "${(st && st.ff) || DEFAULT_FONT}", "Microsoft YaHei", sans-serif`;
    // 文本溢出到右侧空单元格
    let clipW = w;
    const wrap = st && st.wrap;
    if (!merged && !wrap && ha === 'left' && typeof v === 'string' && text) {
      ctx.font = font;
      const tw = ctx.measureText(text).width + 6;
      if (tw > w) {
        let cc = c + 1;
        while (clipW < tw && cc <= cMax + 20 && cc < s.cols) {
          const nc = s.cells[key(r, cc)];
          if ((nc && (nc.v != null || nc.f != null)) || ed.engine.spill[ed.si]?.has(key(r, cc)) || ed.mergeAt(r, cc)) break;
          const cw = this.colW(cc) * z;
          if (!(nc && nc.s && nc.s.bg)) { ctx.fillStyle = '#fff'; ctx.fillRect(x + clipW - 1, y, cw + 1, hgt - 1); }
          clipW += cw;
          cc++;
        }
      }
    }
    if (typeof v === 'number' && !showF && !wrap) {
      ctx.font = font;
      if (ctx.measureText(text).width + 4 > w && text.length) {
        const n = Math.max(1, Math.floor((w - 4) / ctx.measureText('#').width));
        text = '#'.repeat(n);
      }
    }
    texts.push({
      x, y, w, h: hgt, clipW, text, font, fs, ha, va: (st && st.va) || 'middle', wrap,
      color: (cfs && cfs.fc) || color || (st && st.fc) || (isErr(v) ? '#c00000' : cell && cell.link ? '#0563c1' : '#1f2329'),
      u: (st && st.u) || (cell && cell.link), st: st && st.st, indent: (st && st.indent) || 0,
      filterBtn: s.filter && r === s.filter.r1 && c >= s.filter.c1 && c <= s.filter.c2, c,
      comment: cell && cell.cm,
    });
  }

  drawText(t) {
    const ctx = this.ctx, z = this.z;
    if (t.text) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(t.x, t.y, t.clipW - 1, t.h - 1);
      ctx.clip();
      ctx.font = t.font;
      ctx.fillStyle = t.color;
      ctx.textBaseline = 'middle';
      const pad = 3 * z + t.indent * 10 * z;
      const lineH = t.fs * 1.3;
      let lines = t.wrap ? this.wrapLines(t.text, t.w - 6 * z) : t.text.split('\n').slice(0, t.wrap ? 999 : 1);
      if (!t.wrap && t.text.includes('\n')) lines = [t.text.replace(/\n/g, ' ')];
      const total = lines.length * lineH;
      let y0;
      if (t.va === 'top') y0 = t.y + 2 * z + lineH / 2;
      else if (t.va === 'bottom') y0 = t.y + t.h - 3 * z - total + lineH / 2;
      else y0 = t.y + (t.h - total) / 2 + lineH / 2;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const tw = ctx.measureText(line).width;
        let x;
        if (t.ha === 'center' || t.ha === 'centerAcross') x = t.x + (t.w - tw) / 2;
        else if (t.ha === 'right') x = t.x + t.w - pad - tw - (t.filterBtn ? 16 * z : 0);
        else x = t.x + pad;
        const y = y0 + i * lineH;
        ctx.fillText(line, x, y);
        if (t.u || t.st) {
          ctx.strokeStyle = t.color;
          ctx.lineWidth = Math.max(1, z);
          ctx.beginPath();
          if (t.u) { ctx.moveTo(x, y + t.fs * 0.5); ctx.lineTo(x + tw, y + t.fs * 0.5); }
          if (t.st) { ctx.moveTo(x, y); ctx.lineTo(x + tw, y); }
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    if (t.comment) {
      ctx.fillStyle = '#e03b3b';
      ctx.beginPath();
      ctx.moveTo(t.x + t.w - 7 * z, t.y);
      ctx.lineTo(t.x + t.w - 1, t.y);
      ctx.lineTo(t.x + t.w - 1, t.y + 6 * z);
      ctx.fill();
    }
    if (t.filterBtn) this.drawFilterBtn(t.x + t.w - 17 * z, t.y + (t.h - 15 * z) / 2, 15 * z, t.c);
  }

  drawFilterBtn(x, y, s, c) {
    const ctx = this.ctx;
    const active = this.sheet.filter?.conds?.[c];
    ctx.fillStyle = active ? '#e8f2fd' : '#fff';
    ctx.strokeStyle = active ? ACCENT : '#a8adb5';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, s, s);
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(s) - 1, Math.round(s) - 1);
    ctx.fillStyle = active ? ACCENT : '#555';
    ctx.beginPath();
    if (active) {
      // 漏斗
      ctx.moveTo(x + s * 0.25, y + s * 0.3); ctx.lineTo(x + s * 0.75, y + s * 0.3); ctx.lineTo(x + s * 0.55, y + s * 0.55);
      ctx.lineTo(x + s * 0.55, y + s * 0.75); ctx.lineTo(x + s * 0.45, y + s * 0.75); ctx.lineTo(x + s * 0.45, y + s * 0.55);
    } else {
      ctx.moveTo(x + s * 0.3, y + s * 0.4); ctx.lineTo(x + s * 0.7, y + s * 0.4); ctx.lineTo(x + s * 0.5, y + s * 0.65);
    }
    ctx.fill();
  }

  wrapLines(text, maxW) {
    const ctx = this.ctx;
    const ck = ctx.font + '|' + maxW + '|' + text;
    const cached = this.wrapCache.get(ck);
    if (cached) return cached;
    const out = [];
    for (const para of text.split('\n')) {
      let line = '';
      // 以"单词"为单位（英文按空格，中文按字符）
      const tokens = para.match(/[\x21-\x7e]+|\s+|./gu) || [''];
      for (const tok of tokens) {
        const test = line + tok;
        if (ctx.measureText(test).width > maxW && line) {
          out.push(line.trimEnd());
          line = tok.trimStart();
          // 超长单词强制断开
          while (ctx.measureText(line).width > maxW && line.length > 1) {
            let i = line.length;
            while (i > 1 && ctx.measureText(line.slice(0, i)).width > maxW) i--;
            out.push(line.slice(0, i));
            line = line.slice(i);
          }
        } else line = test;
      }
      out.push(line);
    }
    if (this.wrapCache.size > 5000) this.wrapCache.clear();
    this.wrapCache.set(ck, out);
    return out;
  }

  drawBorders(r1, r2, c1, c2, sx, sy, merges) {
    const ctx = this.ctx, s = this.sheet, z = this.z;
    const line = (x1, y1, x2, y2, b) => {
      ctx.strokeStyle = b.c || '#000';
      ctx.lineWidth = Math.max(1, (b.w || 1) * (b.w > 1 ? z : 1));
      ctx.setLineDash(b.d === 'dashed' ? [4, 3] : b.d === 'dotted' ? [1, 2] : []);
      ctx.beginPath();
      const off = ctx.lineWidth % 2 ? 0.5 : 0;
      if (x1 === x2) { const x = Math.round(x1) - (off ? 0.5 : 0); ctx.moveTo(x, y1 - 1); ctx.lineTo(x, y2); }
      else { const y = Math.round(y1) - (off ? 0.5 : 0); ctx.moveTo(x1 - 1, y); ctx.lineTo(x2, y); }
      ctx.stroke();
    };
    for (let r = Math.max(0, r1 - 1); r <= r2 + 1; r++) {
      if (!this.rowH(r)) continue;
      for (let c = Math.max(0, c1 - 1); c <= c2 + 1; c++) {
        const cell = s.cells[key(r, c)];
        const bd = cell && cell.s && cell.s.bd;
        if (!bd || !this.colW(c)) continue;
        let m = this.ed.mergeAt(r, c);
        let x = sx(c), y = sy(r), w = this.colW(c) * z, hh = this.rowH(r) * z;
        if (m) { if (m.r1 !== r || m.c1 !== c) continue; x = sx(m.c1); y = sy(m.r1); w = (this.X(m.c2 + 1) - this.X(m.c1)) * z; hh = (this.Y(m.r2 + 1) - this.Y(m.r1)) * z; }
        if (bd.t) line(x, y, x + w, y, bd.t);
        if (bd.b) line(x, y + hh, x + w, y + hh, bd.b);
        if (bd.l) line(x, y, x, y + hh, bd.l);
        if (bd.r) line(x + w, y, x + w, y + hh, bd.r);
      }
    }
    ctx.setLineDash([]);
  }

  rangeRect(rg, sx, sy) {
    const x = sx(rg.c1), y = sy(rg.r1);
    return { x, y, w: sx(rg.c2 + 1) - x, h: sy(rg.r2 + 1) - y };
  }

  drawOverlays(r1, r2, c1, c2, sx, sy) {
    const ctx = this.ctx, ed = this.ed, z = this.z;
    const sel = ed.sel;
    // 选区填充
    ctx.fillStyle = SEL_FILL;
    const act = ed.activeRect();
    const A0 = this.rangeRect(act, sx, sy);
    for (const rg of sel.ranges) {
      if (rg.r1 === rg.r2 && rg.c1 === rg.c2 && sel.ranges.length === 1) continue;
      const R = this.rangeRect(rg, sx, sy);
      // 活动单元格保持不填充（evenodd 挖空）
      ctx.beginPath();
      ctx.rect(R.x, R.y, R.w, R.h);
      if (act.r1 >= rg.r1 && act.r2 <= rg.r2 && act.c1 >= rg.c1 && act.c2 <= rg.c2) ctx.rect(A0.x, A0.y, A0.w, A0.h);
      ctx.fill('evenodd');
    }
    // 溢出区域
    const sp = ed.engine.spillRanges[ed.si] || [];
    for (const rg of sp) {
      if (rg.r1 === sel.active.r && rg.c1 === sel.active.c) {
        const R = this.rangeRect(rg, sx, sy);
        ctx.strokeStyle = '#3b7ddd';
        ctx.setLineDash([3, 2]);
        ctx.lineWidth = 1;
        ctx.strokeRect(R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1);
        ctx.setLineDash([]);
      }
    }
    // 公式编辑时的引用高亮
    if (ed.editRefs) {
      ed.editRefs.forEach((ref, i) => {
        if (ref.si !== ed.si) return;
        const R = this.rangeRect(ref, sx, sy);
        const col = REF_COLORS[i % REF_COLORS.length];
        ctx.fillStyle = col + '18';
        ctx.fillRect(R.x, R.y, R.w, R.h);
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.strokeRect(R.x, R.y, R.w - 1, R.h - 1);
      });
    }
    // 选区边框
    const last = sel.ranges[sel.ranges.length - 1];
    ctx.strokeStyle = ACCENT;
    if (sel.ranges.length > 1) {
      ctx.lineWidth = 1;
      for (const rg of sel.ranges.slice(0, -1)) { const R = this.rangeRect(rg, sx, sy); ctx.strokeRect(R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1); }
    }
    const L = this.rangeRect(last, sx, sy);
    ctx.lineWidth = 2;
    ctx.strokeRect(L.x, L.y, L.w - 1, L.h - 1);
    if (!ed.editing && ed.mode !== 'refpick') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(L.x + L.w - 5, L.y + L.h - 5, 8, 8);
      ctx.fillStyle = ACCENT;
      ctx.fillRect(L.x + L.w - 4, L.y + L.h - 4, 6, 6);
    }
    // 活动单元格边框（多选时）
    if (sel.ranges.length > 1 || last.r1 !== last.r2 || last.c1 !== last.c2) {
      const A = this.rangeRect(act, sx, sy);
      ctx.lineWidth = 1;
      ctx.strokeRect(A.x + 0.5, A.y + 0.5, A.w - 2, A.h - 2);
    }
    // 复制虚线框
    if (ed.clip && ed.clip.si === ed.si && ed.clip.marquee) {
      const R = this.rangeRect(ed.clip.range, sx, sy);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.lineDashOffset = -(ed.marchOffset || 0);
      ctx.strokeRect(R.x, R.y, R.w - 1, R.h - 1);
      ctx.setLineDash([]);
    }
    // 填充柄拖动预览
    if (ed.fillPreview) {
      const R = this.rangeRect(ed.fillPreview, sx, sy);
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1);
      ctx.setLineDash([]);
    }
    // 数据验证下拉箭头
    const dv = ed.validationAt(sel.active.r, sel.active.c);
    if (dv && dv.type === 'list' && dv.dropdown !== false && !ed.editing) {
      const A = this.rangeRect(act, sx, sy);
      const bx = A.x + A.w + 1, by = A.y + A.h - 18 * z;
      ctx.fillStyle = '#f2f3f5';
      ctx.strokeStyle = '#a8adb5';
      ctx.fillRect(bx, by, 16 * z, 17 * z);
      ctx.strokeRect(Math.round(bx) + 0.5, Math.round(by) + 0.5, 16 * z - 1, 17 * z - 1);
      ctx.fillStyle = '#444';
      ctx.beginPath();
      ctx.moveTo(bx + 4 * z, by + 7 * z); ctx.lineTo(bx + 12 * z, by + 7 * z); ctx.lineTo(bx + 8 * z, by + 11 * z);
      ctx.fill();
      this.dvBtn = { x: bx, y: by, w: 16 * z, h: 17 * z };
    } else this.dvBtn = null;
  }

  drawHeaders(vr, fx, fy) {
    const ctx = this.ctx, z = this.z, s = this.sheet, ed = this.ed;
    const W = this.W, H = this.H, hw = this.hw, hh = this.hh;
    const selCols = new Set(), selRows = new Set(), fullCols = new Set(), fullRows = new Set();
    for (const rg of ed.sel.ranges) {
      for (let c = Math.max(rg.c1, vr.c1 < this.fc ? 0 : 0); c <= Math.min(rg.c2, vr.c2); c++) { selCols.add(c); if (rg.r1 === 0 && rg.r2 >= s.rows - 1) fullCols.add(c); }
      for (let r = rg.r1; r <= Math.min(rg.r2, vr.r2); r++) { selRows.add(r); if (rg.c1 === 0 && rg.c2 >= s.cols - 1) fullRows.add(r); }
    }
    ctx.font = `500 ${(11.5 * z).toFixed(1)}px -apple-system, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    // 列头
    const drawColHead = (c, clipX, clipW, offX) => {
      const w = this.colW(c) * z;
      if (!w) return;
      const x = hw + this.X(c) * z - offX;
      const sel = selCols.has(c);
      ctx.fillStyle = fullCols.has(c) ? '#d6e7fb' : sel ? '#eef5fd' : HEAD_BG;
      ctx.fillRect(x, 0, w, hh);
      ctx.fillStyle = sel ? ACCENT : HEAD_TEXT;
      ctx.fillText(colName(c), x + w / 2, hh / 2 + 0.5);
      ctx.fillStyle = HEAD_BORDER;
      ctx.fillRect(Math.round(x + w) - 1, 0, 1, hh);
      if (sel) { ctx.fillStyle = ACCENT; ctx.fillRect(x, hh - 2, w, 2); }
    };
    const drawRowHead = (r, offY) => {
      const hgt = this.rowH(r) * z;
      if (!hgt) return;
      const y = hh + this.Y(r) * z - offY;
      const sel = selRows.has(r);
      ctx.fillStyle = fullRows.has(r) ? '#d6e7fb' : sel ? '#eef5fd' : HEAD_BG;
      ctx.fillRect(0, y, hw, hgt);
      ctx.fillStyle = sel ? ACCENT : HEAD_TEXT;
      ctx.fillText(String(r + 1), hw / 2, y + hgt / 2 + 0.5);
      ctx.fillStyle = HEAD_BORDER;
      ctx.fillRect(0, Math.round(y + hgt) - 1, hw, 1);
      if (sel) { ctx.fillStyle = ACCENT; ctx.fillRect(hw - 2, y, 2, hgt); }
    };
    ctx.save();
    ctx.beginPath(); ctx.rect(fx, 0, W - fx, hh); ctx.clip();
    for (let c = vr.c1; c <= vr.c2; c++) drawColHead(c, 0, 0, this.sx);
    ctx.restore();
    if (this.fc) { ctx.save(); ctx.beginPath(); ctx.rect(hw, 0, fx - hw, hh); ctx.clip(); for (let c = 0; c < this.fc; c++) drawColHead(c, 0, 0, 0); ctx.restore(); }
    ctx.save();
    ctx.beginPath(); ctx.rect(0, fy, hw, H - fy); ctx.clip();
    for (let r = vr.r1; r <= vr.r2; r++) drawRowHead(r, this.sy);
    ctx.restore();
    if (this.fr) { ctx.save(); ctx.beginPath(); ctx.rect(0, hh, hw, fy - hh); ctx.clip(); for (let r = 0; r < this.fr; r++) drawRowHead(r, 0); ctx.restore(); }
    // 分隔线 + 角
    ctx.fillStyle = HEAD_BORDER;
    ctx.fillRect(0, hh - 1, W, 1);
    ctx.fillRect(hw - 1, 0, 1, H);
    ctx.fillStyle = HEAD_BG;
    ctx.fillRect(0, 0, hw - 1, hh - 1);
    ctx.fillStyle = '#d1d1d6';
    ctx.beginPath();
    ctx.moveTo(hw - 4, hh - 4); ctx.lineTo(hw - 4, hh - 4 - 10 * z); ctx.lineTo(hw - 4 - 10 * z, hh - 4);
    ctx.fill();
    ctx.textAlign = 'left';
  }

  /** 测量单元格文本宽度（自动列宽用） */
  measureCell(r, c) {
    const ed = this.ed, s = this.sheet;
    const cell = s.cells[key(r, c)];
    const v = ed.engine.display(ed.si, r, c);
    if (v == null) return 0;
    const st = cell && cell.s;
    const text = formatValue(v, st && st.nf).text;
    const fs = ((st && st.fs) || DEFAULT_FS) * (4 / 3);
    this.ctx.font = `${st && st.b ? 'bold ' : ''}${fs}px "${(st && st.ff) || DEFAULT_FONT}", sans-serif`;
    return Math.max(...text.split('\n').map((l) => this.ctx.measureText(l).width)) + 12 + (s.filter && r === s.filter.r1 ? 18 : 0);
  }
}

function bsearch(arr, x) {
  let lo = 0, hi = arr.length - 2;
  if (x <= 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  // 跳过隐藏（宽度为 0）的行列
  while (lo < arr.length - 2 && arr[lo + 1] === arr[lo] && arr[lo + 1] <= x) lo++;
  return lo;
}
function prevVisible(i, size) {
  let j = i - 1;
  while (j > 0 && !size(j)) j--;
  return j;
}
