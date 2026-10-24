// 计算引擎：按需求值 + 全量重算、循环引用检测、动态数组溢出
import { parse, evaluate, isMatrix } from './formula.js';
import { ERR, FErr } from './format.js';
import { key, unkey } from './refs.js';

const COMPUTING = Symbol('computing');
const ARRAY_FN = /\b(UNIQUE|SORT|FILTER|SEQUENCE|TRANSPOSE)\s*\(/i;

export class Engine {
  constructor(wb) {
    this.wb = wb;
    this.version = 0;
    this.recalc();
  }

  sheetIndex(name) {
    const n = String(name).toLowerCase();
    return this.wb.sheets.findIndex((s) => s.name.toLowerCase() === n);
  }

  getCell(si, r, c) {
    return this.wb.sheets[si]?.cells[key(r, c)];
  }

  /** 单元格的计算值（数字/文本/布尔/错误/null） */
  getValue(si, r, c) {
    const sh = this.wb.sheets[si];
    if (!sh) throw ERR.REF;
    const k = key(r, c);
    const cell = sh.cells[k];
    if (!cell || cell.f == null) {
      if (cell && cell.v != null) return cell.v;
      const sp = this.spill[si] && this.spill[si].get(k);
      return sp === undefined ? null : sp;
    }
    return this.compute(si, k, r, c, cell);
  }

  /** 供渲染使用：返回值，不抛出 */
  display(si, r, c) {
    try { return this.getValue(si, r, c); } catch (e) { return e instanceof FErr ? e : ERR.VALUE; }
  }

  compute(si, k, r, c, cell) {
    const cache = this.vals[si];
    if (cache.has(k)) {
      const v = cache.get(k);
      if (v === COMPUTING) throw ERR.CIRC;
      return v;
    }
    cache.set(k, COMPUTING);
    let v;
    try {
      v = evaluate(parse(cell.f), { engine: this, sheet: si, r, c });
    } catch (e) {
      if (e instanceof FErr) v = e;
      else { console.error('公式错误', cell.f, e); v = ERR.VALUE; }
    }
    if (isMatrix(v)) v = this.spillOut(si, r, c, v);
    if (v == null) v = 0;
    cache.set(k, v);
    return v;
  }

  spillOut(si, r, c, M) {
    const sh = this.wb.sheets[si];
    const sp = this.spill[si];
    if (M.length === 1 && M[0].length === 1) return M[0][0];
    for (let i = 0; i < M.length; i++)
      for (let j = 0; j < M[i].length; j++) {
        if (!i && !j) continue;
        const k = key(r + i, c + j);
        const cell = sh.cells[k];
        if ((cell && (cell.v != null || cell.f != null)) || (sp.has(k) && this.spillSrc[si].get(k) !== key(r, c))) return ERR.SPILL;
      }
    const src = key(r, c);
    for (let i = 0; i < M.length; i++)
      for (let j = 0; j < M[i].length; j++) {
        if (!i && !j) continue;
        const k = key(r + i, c + j);
        let v = M[i][j];
        if (v == null) v = 0;
        sp.set(k, v);
        this.spillSrc[si].set(k, src);
      }
    this.spillRanges[si].push({ r1: r, c1: c, r2: r + M.length - 1, c2: c + M[0].length - 1 });
    const b = this.bounds[si];
    b.maxR = Math.max(b.maxR, r + M.length - 1);
    b.maxC = Math.max(b.maxC, c + M[0].length - 1);
    return M[0][0];
  }

  getRange(si, r1, c1, r2, c2) {
    const sh = this.wb.sheets[si];
    if (!sh) throw ERR.REF;
    const b = this.bounds[si];
    // 整列/整行或超大区域：截断到已用区域
    if (r2 - r1 > 5000) r2 = Math.max(r1, Math.min(r2, b.maxR));
    if (c2 - c1 > 500) c2 = Math.max(c1, Math.min(c2, b.maxC));
    const out = new Array(r2 - r1 + 1);
    for (let r = r1; r <= r2; r++) {
      const row = new Array(c2 - c1 + 1);
      for (let c = c1; c <= c2; c++) {
        let v;
        try { v = this.getValue(si, r, c); } catch (e) { if (e instanceof FErr) v = e; else throw e; }
        row[c - c1] = v;
      }
      out[r - r1] = row;
    }
    return out;
  }

  /** 全量重算 */
  recalc() {
    this.version++;
    const sheets = this.wb.sheets;
    this.vals = sheets.map(() => new Map());
    this.spill = sheets.map(() => new Map());
    this.spillSrc = sheets.map(() => new Map());
    this.spillRanges = sheets.map(() => []);
    this.bounds = sheets.map((sh) => {
      let maxR = 0, maxC = 0;
      for (const k in sh.cells) {
        const [r, c] = unkey(k);
        if (r > maxR) maxR = r;
        if (c > maxC) maxC = c;
      }
      return { maxR, maxC };
    });
    // 先算动态数组公式，确保溢出区域先就位
    const later = [];
    sheets.forEach((sh, si) => {
      for (const k in sh.cells) {
        const cell = sh.cells[k];
        if (cell.f == null) continue;
        const [r, c] = unkey(k);
        if (ARRAY_FN.test(cell.f)) { try { this.compute(si, k, r, c, cell); } catch {} }
        else later.push([si, k, r, c, cell]);
      }
    });
    for (const [si, k, r, c, cell] of later) { try { this.compute(si, k, r, c, cell); } catch {} }
  }

  spillSourceOf(si, r, c) {
    return this.spillSrc[si]?.get(key(r, c));
  }
}
