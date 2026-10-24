// 函数库
import { ERR, FErr, isErr, dateToSerial, serialToDate, todaySerial, nowSerial, formatValue } from './format.js';
import { evaluate, toNum, toStr, toBool, compareValues, isMatrix, tokenize, parseRefBody } from './formula.js';
import { MAX_ROWS, MAX_COLS } from './refs.js';

/* ---------- 工具 ---------- */
const flat = (v) => (isMatrix(v) ? v.flat() : [v]);

/** 按 SUM 规则收集数字：区域内仅取数字，直接参数强制转换 */
function nums(args, { includeText = false } = {}) {
  const out = [];
  for (const a of args) {
    if (isMatrix(a)) {
      for (const row of a) for (const v of row) {
        if (isErr(v)) throw v;
        if (typeof v === 'number') out.push(v);
        else if (includeText && v != null && v !== '') out.push(typeof v === 'boolean' ? (v ? 1 : 0) : 0);
      }
    } else if (a == null) continue;
    else if (isErr(a)) throw a;
    else out.push(toNum(a));
  }
  return out;
}

function matrixOf(v) {
  if (isMatrix(v)) return v;
  return [[v]];
}
function scalar(v) {
  return isMatrix(v) ? v[0][0] : v;
}
const num = (v) => toNum(scalar(v));
const str = (v) => toStr(scalar(v));
function optNum(v, d) { return v == null ? d : num(v); }
function checkNum(n) { if (!isFinite(n) || Number.isNaN(n)) throw ERR.NUM; return n; }

function wildcardRegex(s) {
  let re = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '~' && i + 1 < s.length) { re += s[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i');
}

/** 条件匹配（COUNTIF 等） */
export function makeCriteria(crit) {
  crit = scalar(crit);
  if (typeof crit === 'number') return (v) => (typeof v === 'number' ? v === crit : typeof v === 'string' && v.trim() !== '' && !isNaN(v) && +v === crit);
  if (typeof crit === 'boolean') return (v) => v === crit;
  if (crit == null) return (v) => v == null || v === '';
  const s = String(crit);
  const m = s.match(/^(<=|>=|<>|<|>|=)?(.*)$/s);
  const op = m[1] || '=';
  const rest = m[2];
  const isNumeric = rest.trim() !== '' && !isNaN(rest);
  if (isNumeric) {
    const n = +rest;
    return (v) => {
      let x = v;
      if (typeof x === 'string' && op === '=' && x.trim() !== '' && !isNaN(x)) x = +x;
      if (typeof x !== 'number') return op === '<>';
      switch (op) {
        case '=': return x === n; case '<>': return x !== n; case '<': return x < n;
        case '>': return x > n; case '<=': return x <= n; case '>=': return x >= n;
      }
    };
  }
  if (rest === '') {
    if (op === '=') return (v) => v == null || v === '';
    if (op === '<>') return (v) => v != null && v !== '';
  }
  const low = rest.toLowerCase();
  if (op === '=' || op === '<>') {
    const re = /[*?~]/.test(rest) ? wildcardRegex(rest) : null;
    const eq = (v) => (v == null ? false : re ? re.test(toStr(v)) : toStr(v).toLowerCase() === low);
    return op === '=' ? eq : (v) => !eq(v);
  }
  return (v) => {
    if (typeof v !== 'string') return false;
    const c = v.toLowerCase() < low ? -1 : v.toLowerCase() > low ? 1 : 0;
    return op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
  };
}

function lookupEq(v, target) {
  if (typeof target === 'string' && /[*?~]/.test(target)) return typeof v === 'string' && wildcardRegex(target).test(v);
  if (v == null) return target == null || target === '';
  return typeof v === typeof target && compareValues(v, target) === 0;
}

/** 近似匹配：返回 <= target 的最后一个位置（假定已升序） */
function approxIndex(arr, target) {
  let idx = -1;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v == null || typeof v !== typeof target) continue;
    if (compareValues(v, target) <= 0) idx = i;
    else break;
  }
  return idx;
}

function ifsPairs(args, fromIndex) {
  // args: [range1, crit1, range2, crit2, ...]
  const conds = [];
  for (let i = fromIndex; i < args.length; i += 2) conds.push({ rg: matrixOf(args[i]), pred: makeCriteria(args[i + 1]) });
  return conds;
}
function ifsMatch(conds, i, j) {
  return conds.every((c) => {
    const row = c.rg[i];
    return row && c.pred(row[j]);
  });
}

function stdev(arr, sample) {
  const n = arr.length;
  if (n < (sample ? 2 : 1)) throw ERR.DIV0;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const ss = arr.reduce((a, b) => a + (b - mean) ** 2, 0);
  return ss / (sample ? n - 1 : n);
}

function roundTo(n, d, mode) {
  const f = Math.pow(10, d);
  const x = n * f;
  let r;
  if (mode === 'up') r = Math.sign(x) * Math.ceil(Math.abs(x) - 1e-9);
  else if (mode === 'down') r = Math.sign(x) * Math.floor(Math.abs(x) + 1e-9);
  else r = Math.sign(x) * Math.round(Math.abs(x) + 1e-9);
  return r / f;
}

function dateParts(v) {
  const n = num(v);
  if (n < 0) throw ERR.NUM;
  return serialToDate(n);
}

function toDateNum(v) {
  v = scalar(v);
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/);
    if (m) return dateToSerial(+m[1], +m[2], +m[3]);
  }
  return Math.floor(toNum(v));
}

function resultMatrix(rows) {
  if (!rows.length) throw ERR.CALC || ERR.VALUE;
  return rows.length === 1 && rows[0].length === 1 ? rows[0][0] : rows;
}

/* ---------- 函数定义 ---------- */
// 每项：{ fn(args, ctx), raw?: 参数为 AST, errOk?: 允许错误值参数 }
export const FUNCTIONS = {
  /* ===== 数学 ===== */
  SUM: { fn: (a) => nums(a).reduce((x, y) => x + y, 0) },
  SUMSQ: { fn: (a) => nums(a).reduce((x, y) => x + y * y, 0) },
  PRODUCT: { fn: (a) => nums(a).reduce((x, y) => x * y, 1) },
  ROUND: { fn: ([n, d]) => roundTo(num(n), optNum(d, 0)) },
  ROUNDUP: { fn: ([n, d]) => roundTo(num(n), optNum(d, 0), 'up') },
  ROUNDDOWN: { fn: ([n, d]) => roundTo(num(n), optNum(d, 0), 'down') },
  TRUNC: { fn: ([n, d]) => roundTo(num(n), optNum(d, 0), 'down') },
  INT: { fn: ([n]) => Math.floor(num(n)) },
  MOD: { fn: ([n, d]) => { const x = num(n), y = num(d); if (y === 0) throw ERR.DIV0; return x - y * Math.floor(x / y); } },
  QUOTIENT: { fn: ([n, d]) => { const y = num(d); if (y === 0) throw ERR.DIV0; return Math.trunc(num(n) / y); } },
  ABS: { fn: ([n]) => Math.abs(num(n)) },
  SIGN: { fn: ([n]) => Math.sign(num(n)) },
  SQRT: { fn: ([n]) => { const x = num(n); if (x < 0) throw ERR.NUM; return Math.sqrt(x); } },
  POWER: { fn: ([a, b]) => checkNum(Math.pow(num(a), num(b))) },
  EXP: { fn: ([n]) => Math.exp(num(n)) },
  LN: { fn: ([n]) => { const x = num(n); if (x <= 0) throw ERR.NUM; return Math.log(x); } },
  LOG: { fn: ([n, b]) => { const x = num(n), base = optNum(b, 10); if (x <= 0 || base <= 0 || base === 1) throw ERR.NUM; return Math.log(x) / Math.log(base); } },
  LOG10: { fn: ([n]) => { const x = num(n); if (x <= 0) throw ERR.NUM; return Math.log10(x); } },
  PI: { fn: () => Math.PI },
  RAND: { fn: () => Math.random(), volatile: true },
  RANDBETWEEN: { fn: ([a, b]) => { const lo = Math.ceil(num(a)), hi = Math.floor(num(b)); if (lo > hi) throw ERR.NUM; return lo + Math.floor(Math.random() * (hi - lo + 1)); }, volatile: true },
  CEILING: { fn: ([n, s]) => { const x = num(n), sig = optNum(s, 1); if (sig === 0) return 0; return Math.ceil(x / sig - 1e-12) * sig; } },
  'CEILING.MATH': { fn: ([n, s]) => { const x = num(n), sig = Math.abs(optNum(s, 1)) || 1; return Math.ceil(x / sig - 1e-12) * sig; } },
  FLOOR: { fn: ([n, s]) => { const x = num(n), sig = optNum(s, 1); if (sig === 0) throw ERR.DIV0; return Math.floor(x / sig + 1e-12) * sig; } },
  'FLOOR.MATH': { fn: ([n, s]) => { const x = num(n), sig = Math.abs(optNum(s, 1)) || 1; return Math.floor(x / sig + 1e-12) * sig; } },
  MROUND: { fn: ([n, m]) => { const x = num(n), y = num(m); if (y === 0) return 0; return Math.round(x / y) * y; } },
  EVEN: { fn: ([n]) => { const x = num(n); const r = Math.ceil(Math.abs(x) / 2) * 2; return x < 0 ? -r : r; } },
  ODD: { fn: ([n]) => { const x = num(n); let r = Math.ceil(Math.abs(x)); if (r % 2 === 0) r++; return x < 0 ? -r : r; } },
  FACT: { fn: ([n]) => { let x = Math.floor(num(n)); if (x < 0) throw ERR.NUM; let r = 1; while (x > 1) r *= x--; return r; } },
  COMBIN: { fn: ([n, k]) => { const a = Math.floor(num(n)), b = Math.floor(num(k)); if (b > a || b < 0) throw ERR.NUM; let r = 1; for (let i = 1; i <= b; i++) r = (r * (a - b + i)) / i; return Math.round(r); } },
  GCD: { fn: (a) => nums(a).map((x) => Math.floor(x)).reduce((x, y) => { while (y) [x, y] = [y, x % y]; return x; }, 0) },
  LCM: { fn: (a) => nums(a).map((x) => Math.floor(x)).reduce((x, y) => { if (!x || !y) return 0; let g = x, h = y; while (h) [g, h] = [h, g % h]; return (x * y) / g; }, 1) },
  SIN: { fn: ([n]) => Math.sin(num(n)) }, COS: { fn: ([n]) => Math.cos(num(n)) }, TAN: { fn: ([n]) => Math.tan(num(n)) },
  ASIN: { fn: ([n]) => checkNum(Math.asin(num(n))) }, ACOS: { fn: ([n]) => checkNum(Math.acos(num(n))) }, ATAN: { fn: ([n]) => Math.atan(num(n)) },
  ATAN2: { fn: ([x, y]) => Math.atan2(num(y), num(x)) },
  DEGREES: { fn: ([n]) => (num(n) * 180) / Math.PI }, RADIANS: { fn: ([n]) => (num(n) * Math.PI) / 180 },
  SUMPRODUCT: {
    fn: (args) => {
      const ms = args.map(matrixOf);
      const rows = ms[0].length, cols = ms[0][0].length;
      if (ms.some((m) => m.length !== rows || m[0].length !== cols)) throw ERR.VALUE;
      let s = 0;
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        let p = 1;
        for (const m of ms) { const v = m[i][j]; if (isErr(v)) throw v; p *= typeof v === 'number' ? v : typeof v === 'boolean' && ms.length === 1 ? 0 : typeof v === 'boolean' ? (v ? 1 : 0) : 0; }
        s += p;
      }
      return s;
    },
  },
  SUMIF: {
    fn: ([rg, crit, sumRg]) => {
      const R = matrixOf(rg), S = sumRg != null ? matrixOf(sumRg) : R, pred = makeCriteria(crit);
      let s = 0;
      R.forEach((row, i) => row.forEach((v, j) => { if (pred(v)) { const x = S[i]?.[j]; if (typeof x === 'number') s += x; } }));
      return s;
    },
  },
  SUMIFS: {
    fn: (args) => {
      const S = matrixOf(args[0]), conds = ifsPairs(args, 1);
      let s = 0;
      S.forEach((row, i) => row.forEach((x, j) => { if (typeof x === 'number' && ifsMatch(conds, i, j)) s += x; }));
      return s;
    },
  },
  SUBTOTAL: {
    fn: ([code, ...rest]) => {
      const c = num(code) % 100;
      const map = { 1: 'AVERAGE', 2: 'COUNT', 3: 'COUNTA', 4: 'MAX', 5: 'MIN', 6: 'PRODUCT', 7: 'STDEV', 8: 'STDEVP', 9: 'SUM', 10: 'VAR', 11: 'VARP' };
      const f = FUNCTIONS[map[c]];
      if (!f) throw ERR.VALUE;
      return f.fn(rest);
    },
  },
  SEQUENCE: {
    fn: ([r, c, start, step]) => {
      const rows = num(r), cols = optNum(c, 1), s0 = optNum(start, 1), st = optNum(step, 1);
      const out = [];
      for (let i = 0; i < rows; i++) { const row = []; for (let j = 0; j < cols; j++) row.push(s0 + (i * cols + j) * st); out.push(row); }
      return resultMatrix(out);
    },
  },

  /* ===== 统计 ===== */
  AVERAGE: { fn: (a) => { const n = nums(a); if (!n.length) throw ERR.DIV0; return n.reduce((x, y) => x + y, 0) / n.length; } },
  AVERAGEA: { fn: (a) => { const n = nums(a, { includeText: true }); if (!n.length) throw ERR.DIV0; return n.reduce((x, y) => x + y, 0) / n.length; } },
  COUNT: {
    errOk: true,
    fn: (args) => {
      let n = 0;
      for (const a of args) {
        if (isMatrix(a)) { for (const v of a.flat()) if (typeof v === 'number') n++; }
        else if (typeof a === 'number' || typeof a === 'boolean' || (typeof a === 'string' && a.trim() !== '' && !isNaN(a))) n++;
      }
      return n;
    },
  },
  COUNTA: { errOk: true, fn: (args) => args.reduce((n, a) => n + (isMatrix(a) ? a.flat().filter((v) => v != null && v !== '').length : a == null ? 0 : 1), 0) },
  COUNTBLANK: { fn: (args) => args.reduce((n, a) => n + flat(a).filter((v) => v == null || v === '').length, 0) },
  MAX: { fn: (a) => { const n = nums(a); return n.length ? Math.max(...n) : 0; } },
  MIN: { fn: (a) => { const n = nums(a); return n.length ? Math.min(...n) : 0; } },
  MAXA: { fn: (a) => { const n = nums(a, { includeText: true }); return n.length ? Math.max(...n) : 0; } },
  MINA: { fn: (a) => { const n = nums(a, { includeText: true }); return n.length ? Math.min(...n) : 0; } },
  MEDIAN: {
    fn: (a) => {
      const n = nums(a).sort((x, y) => x - y);
      if (!n.length) throw ERR.NUM;
      const m = n.length >> 1;
      return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2;
    },
  },
  MODE: {
    fn: (a) => {
      const n = nums(a), cnt = new Map();
      let best = null, bc = 1;
      for (const x of n) { const c = (cnt.get(x) || 0) + 1; cnt.set(x, c); if (c > bc) { bc = c; best = x; } }
      if (best == null) throw ERR.NA;
      return best;
    },
  },
  STDEV: { fn: (a) => Math.sqrt(stdev(nums(a), true)) },
  STDEVP: { fn: (a) => Math.sqrt(stdev(nums(a), false)) },
  VAR: { fn: (a) => stdev(nums(a), true) },
  VARP: { fn: (a) => stdev(nums(a), false) },
  LARGE: { fn: ([rg, k]) => { const n = nums([matrixOf(rg)]).sort((x, y) => y - x); const i = Math.ceil(num(k)) - 1; if (i < 0 || i >= n.length) throw ERR.NUM; return n[i]; } },
  SMALL: { fn: ([rg, k]) => { const n = nums([matrixOf(rg)]).sort((x, y) => x - y); const i = Math.ceil(num(k)) - 1; if (i < 0 || i >= n.length) throw ERR.NUM; return n[i]; } },
  RANK: {
    fn: ([v, rg, order]) => {
      const x = num(v), n = nums([matrixOf(rg)]);
      if (!n.includes(x)) throw ERR.NA;
      const asc = optNum(order, 0) !== 0;
      return 1 + n.filter((y) => (asc ? y < x : y > x)).length;
    },
  },
  PERCENTILE: {
    fn: ([rg, k]) => {
      const n = nums([matrixOf(rg)]).sort((x, y) => x - y), p = num(k);
      if (!n.length || p < 0 || p > 1) throw ERR.NUM;
      const pos = (n.length - 1) * p, lo = Math.floor(pos);
      return n[lo] + (n[Math.min(lo + 1, n.length - 1)] - n[lo]) * (pos - lo);
    },
  },
  QUARTILE: { fn: ([rg, q]) => FUNCTIONS.PERCENTILE.fn([rg, Math.floor(num(q)) / 4]) },
  CORREL: {
    fn: ([a, b]) => {
      const A = flat(a), B = flat(b), xs = [], ys = [];
      A.forEach((x, i) => { if (typeof x === 'number' && typeof B[i] === 'number') { xs.push(x); ys.push(B[i]); } });
      const n = xs.length; if (n < 2) throw ERR.DIV0;
      const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
      return sxy / Math.sqrt(sxx * syy);
    },
  },
  COUNTIF: { fn: ([rg, crit]) => { const p = makeCriteria(crit); return flat(rg).filter((v) => p(v)).length; } },
  COUNTIFS: {
    fn: (args) => {
      const conds = ifsPairs(args, 0), R = conds[0].rg;
      let n = 0;
      R.forEach((row, i) => row.forEach((_, j) => { if (ifsMatch(conds, i, j)) n++; }));
      return n;
    },
  },
  AVERAGEIF: {
    fn: ([rg, crit, avgRg]) => {
      const R = matrixOf(rg), S = avgRg != null ? matrixOf(avgRg) : R, p = makeCriteria(crit);
      let s = 0, n = 0;
      R.forEach((row, i) => row.forEach((v, j) => { if (p(v)) { const x = S[i]?.[j]; if (typeof x === 'number') { s += x; n++; } } }));
      if (!n) throw ERR.DIV0;
      return s / n;
    },
  },
  AVERAGEIFS: {
    fn: (args) => {
      const S = matrixOf(args[0]), conds = ifsPairs(args, 1);
      let s = 0, n = 0;
      S.forEach((row, i) => row.forEach((x, j) => { if (typeof x === 'number' && ifsMatch(conds, i, j)) { s += x; n++; } }));
      if (!n) throw ERR.DIV0;
      return s / n;
    },
  },
  MAXIFS: {
    fn: (args) => {
      const S = matrixOf(args[0]), conds = ifsPairs(args, 1), v = [];
      S.forEach((row, i) => row.forEach((x, j) => { if (typeof x === 'number' && ifsMatch(conds, i, j)) v.push(x); }));
      return v.length ? Math.max(...v) : 0;
    },
  },
  MINIFS: {
    fn: (args) => {
      const S = matrixOf(args[0]), conds = ifsPairs(args, 1), v = [];
      S.forEach((row, i) => row.forEach((x, j) => { if (typeof x === 'number' && ifsMatch(conds, i, j)) v.push(x); }));
      return v.length ? Math.min(...v) : 0;
    },
  },

  /* ===== 逻辑 ===== */
  IF: {
    raw: true,
    fn: (args, ctx) => {
      const c = toBool(scalarEval(args[0], ctx));
      const branch = c ? args[1] : args[2];
      if (!branch) return c;
      if (branch.t === 'empty') return 0;
      return evaluate(branch, ctx);
    },
  },
  IFS: {
    raw: true,
    fn: (args, ctx) => {
      for (let i = 0; i < args.length; i += 2) if (toBool(scalarEval(args[i], ctx))) return evaluate(args[i + 1], ctx);
      throw ERR.NA;
    },
  },
  IFERROR: {
    raw: true,
    fn: ([v, alt], ctx) => {
      try {
        const r = evaluate(v, ctx);
        if (isErr(r)) return evaluate(alt, ctx);
        return r;
      } catch (e) { if (e instanceof FErr) return evaluate(alt, ctx); throw e; }
    },
  },
  IFNA: {
    raw: true,
    fn: ([v, alt], ctx) => {
      try { const r = evaluate(v, ctx); if (r === ERR.NA) return evaluate(alt, ctx); return r; }
      catch (e) { if (e === ERR.NA || (e instanceof FErr && e.code === '#N/A')) return evaluate(alt, ctx); throw e; }
    },
  },
  AND: { fn: (args) => { const v = args.flatMap(flat).filter((x) => x != null && typeof x !== 'string'); if (!v.length) throw ERR.VALUE; return v.every(toBool); } },
  OR: { fn: (args) => { const v = args.flatMap(flat).filter((x) => x != null && typeof x !== 'string'); if (!v.length) throw ERR.VALUE; return v.some(toBool); } },
  XOR: { fn: (args) => args.flatMap(flat).filter((x) => x != null && typeof x !== 'string').reduce((a, x) => a !== toBool(x), false) },
  NOT: { fn: ([v]) => !toBool(scalar(v)) },
  TRUE: { fn: () => true },
  FALSE: { fn: () => false },
  SWITCH: {
    raw: true,
    fn: (args, ctx) => {
      const v = scalarEval(args[0], ctx);
      let i = 1;
      for (; i + 1 < args.length; i += 2) if (compareValues(v, scalarEval(args[i], ctx)) === 0) return evaluate(args[i + 1], ctx);
      if (i < args.length) return evaluate(args[i], ctx);
      throw ERR.NA;
    },
  },
  CHOOSE: {
    raw: true,
    fn: (args, ctx) => {
      const i = Math.floor(num(scalarEval(args[0], ctx)));
      if (i < 1 || i >= args.length) throw ERR.VALUE;
      return evaluate(args[i], ctx);
    },
  },

  /* ===== 查找与引用 ===== */
  VLOOKUP: {
    fn: ([v, table, col, approx]) => {
      const T = matrixOf(table), c = Math.floor(num(col)) - 1, target = scalar(v);
      if (c < 0) throw ERR.VALUE;
      if (c >= T[0].length) throw ERR.REF;
      const first = T.map((r) => r[0]);
      const exact = approx != null && !toBool(scalar(approx));
      const i = exact ? first.findIndex((x) => lookupEq(x, target)) : approxIndex(first, target);
      if (i < 0) throw ERR.NA;
      return T[i][c] ?? 0;
    },
  },
  HLOOKUP: {
    fn: ([v, table, row, approx]) => {
      const T = matrixOf(table), r = Math.floor(num(row)) - 1, target = scalar(v);
      if (r < 0) throw ERR.VALUE;
      if (r >= T.length) throw ERR.REF;
      const exact = approx != null && !toBool(scalar(approx));
      const i = exact ? T[0].findIndex((x) => lookupEq(x, target)) : approxIndex(T[0], target);
      if (i < 0) throw ERR.NA;
      return T[r][i] ?? 0;
    },
  },
  MATCH: {
    fn: ([v, arr, type]) => {
      const A = flat(arr), target = scalar(v), t = optNum(type, 1);
      let i;
      if (t === 0) i = A.findIndex((x) => lookupEq(x, target));
      else if (t > 0) i = approxIndex(A, target);
      else {
        i = -1;
        for (let k = 0; k < A.length; k++) { if (A[k] != null && compareValues(A[k], target) >= 0) i = k; else break; }
      }
      if (i < 0) throw ERR.NA;
      return i + 1;
    },
  },
  XLOOKUP: {
    fn: ([v, look, ret, notFound, mode, search]) => {
      const L = flat(look), R = matrixOf(ret), target = scalar(v);
      const m = optNum(mode, 0), s = optNum(search, 1);
      const vertical = matrixOf(look).length > 1;
      const idx = [...L.keys()];
      if (s < 0) idx.reverse();
      let found = -1;
      if (m === 0 || m === 2) found = idx.find((i) => lookupEq(L[i], target)) ?? -1;
      else {
        let best = -1;
        for (const i of idx) {
          const x = L[i];
          if (x == null) continue;
          const c = compareValues(x, target);
          if (c === 0) { best = i; break; }
          if (m === -1 && c < 0 && (best < 0 || compareValues(x, L[best]) > 0)) best = i;
          if (m === 1 && c > 0 && (best < 0 || compareValues(x, L[best]) < 0)) best = i;
        }
        found = best;
      }
      if (found < 0) { if (notFound !== undefined && notFound !== null) return notFound; throw ERR.NA; }
      if (vertical) return R[found].length === 1 ? R[found][0] : [R[found]];
      return R.length === 1 ? R[0][found] : R.map((row) => [row[found]]);
    },
  },
  LOOKUP: {
    fn: ([v, look, res]) => {
      const L = flat(look), target = scalar(v);
      const i = approxIndex(L, target);
      if (i < 0) throw ERR.NA;
      return res != null ? flat(res)[i] ?? ERR.NA : L[i];
    },
  },
  INDEX: {
    fn: ([arr, r, c]) => {
      const A = matrixOf(arr);
      let ri = r == null ? 0 : Math.floor(num(r)), ci = c == null ? 0 : Math.floor(num(c));
      if (A.length === 1 && c == null) { ci = ri; ri = 1; }
      else if (A[0].length === 1 && c == null) ci = 1;
      if (ri < 0 || ci < 0 || ri > A.length || ci > A[0].length) throw ERR.REF;
      if (ri === 0) return A.map((row) => [row[ci - 1]]);
      if (ci === 0) return [A[ri - 1]];
      return A[ri - 1][ci - 1] ?? 0;
    },
  },
  ROW: { raw: true, fn: ([ref], ctx) => (ref && ref.t === 'ref' ? ref.r1 + 1 : ctx.r + 1) },
  COLUMN: { raw: true, fn: ([ref], ctx) => (ref && ref.t === 'ref' ? ref.c1 + 1 : ctx.c + 1) },
  ROWS: { raw: true, fn: ([ref], ctx) => (ref.t === 'ref' ? ref.r2 - ref.r1 + 1 : matrixOf(evaluate(ref, ctx)).length) },
  COLUMNS: { raw: true, fn: ([ref], ctx) => (ref.t === 'ref' ? ref.c2 - ref.c1 + 1 : matrixOf(evaluate(ref, ctx))[0].length) },
  OFFSET: {
    raw: true,
    fn: ([ref, rows, cols, hh, ww], ctx) => {
      if (!ref || ref.t !== 'ref') throw ERR.VALUE;
      const dr = num(scalarEval(rows, ctx)), dc = num(scalarEval(cols, ctx));
      const height = hh && hh.t !== 'empty' ? num(scalarEval(hh, ctx)) : ref.r2 - ref.r1 + 1;
      const width = ww && ww.t !== 'empty' ? num(scalarEval(ww, ctx)) : ref.c2 - ref.c1 + 1;
      const r1 = ref.r1 + dr, c1 = ref.c1 + dc;
      if (r1 < 0 || c1 < 0 || height < 1 || width < 1) throw ERR.REF;
      const si = ref.sheet == null ? ctx.sheet : ctx.engine.sheetIndex(ref.sheet);
      if (height === 1 && width === 1) return ctx.engine.getValue(si, r1, c1);
      return ctx.engine.getRange(si, r1, c1, r1 + height - 1, c1 + width - 1);
    },
  },
  INDIRECT: {
    fn: ([text], ctx) => {
      const s = str(text).trim();
      const toks = tokenize(s);
      if (toks.length !== 1 || toks[0].type !== 'ref') throw ERR.REF;
      const t = toks[0];
      const ref = parseRefBody(t.body);
      const si = t.sheet == null ? ctx.sheet : ctx.engine.sheetIndex(t.sheet);
      if (si < 0) throw ERR.REF;
      if (ref.kind === 'cell') return ctx.engine.getValue(si, ref.a.r, ref.a.c);
      const r1 = ref.kind === 'cols' ? 0 : Math.min(ref.a.r, ref.b.r), r2 = ref.kind === 'cols' ? MAX_ROWS - 1 : Math.max(ref.a.r, ref.b.r);
      const c1 = ref.kind === 'rows' ? 0 : Math.min(ref.a.c, ref.b.c), c2 = ref.kind === 'rows' ? MAX_COLS - 1 : Math.max(ref.a.c, ref.b.c);
      return ctx.engine.getRange(si, r1, c1, r2, c2);
    },
  },
  TRANSPOSE: { fn: ([a]) => { const A = matrixOf(a); return resultMatrix(A[0].map((_, j) => A.map((row) => row[j]))); } },
  UNIQUE: {
    fn: ([a]) => {
      const A = matrixOf(a), seen = new Set(), out = [];
      for (const row of A) {
        if (row.every((v) => v == null)) continue;
        const k = JSON.stringify(row.map((v) => (typeof v === 'string' ? v.toLowerCase() : v)));
        if (!seen.has(k)) { seen.add(k); out.push(row); }
      }
      return resultMatrix(out);
    },
  },
  SORT: {
    fn: ([a, idx, order]) => {
      const A = matrixOf(a).map((r) => [...r]), i = optNum(idx, 1) - 1, o = optNum(order, 1);
      A.sort((x, y) => compareValues(x[i], y[i]) * (o < 0 ? -1 : 1));
      return resultMatrix(A);
    },
  },
  FILTER: {
    fn: ([a, inc, empty]) => {
      const A = matrixOf(a), I = matrixOf(inc);
      let out;
      if (I.length === A.length) out = A.filter((_, i) => toBool(I[i][0] ?? false));
      else if (I[0].length === A[0].length) { const cols = I[0].map((v) => toBool(v ?? false)); out = A.map((r) => r.filter((_, j) => cols[j])); if (!out[0].length) out = []; }
      else throw ERR.VALUE;
      if (!out.length) { if (empty !== undefined) return empty; throw new FErr('#CALC!'); }
      return resultMatrix(out);
    },
  },

  /* ===== 文本 ===== */
  CONCAT: { fn: (args) => args.flatMap(flat).map(toStr).join('') },
  CONCATENATE: { fn: (args) => args.map((a) => str(a)).join('') },
  TEXTJOIN: {
    fn: ([d, ignore, ...rest]) => {
      const del = str(d), ig = toBool(scalar(ignore));
      return rest.flatMap(flat).map(toStr).filter((s) => !ig || s !== '').join(del);
    },
  },
  LEFT: { fn: ([s, n]) => [...str(s)].slice(0, optNum(n, 1)).join('') },
  RIGHT: { fn: ([s, n]) => { const a = [...str(s)], k = optNum(n, 1); return k ? a.slice(-k).join('') : ''; } },
  MID: { fn: ([s, st, n]) => { const p = num(st); if (p < 1) throw ERR.VALUE; return [...str(s)].slice(p - 1, p - 1 + num(n)).join(''); } },
  LEN: { fn: ([s]) => [...str(s)].length },
  LENB: { fn: ([s]) => [...str(s)].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0) },
  UPPER: { fn: ([s]) => str(s).toUpperCase() },
  LOWER: { fn: ([s]) => str(s).toLowerCase() },
  PROPER: { fn: ([s]) => str(s).toLowerCase().replace(/(^|[^a-z])([a-z])/g, (m, a, b) => a + b.toUpperCase()) },
  TRIM: { fn: ([s]) => str(s).trim().replace(/ +/g, ' ') },
  CLEAN: { fn: ([s]) => str(s).replace(/[\x00-\x1f]/g, '') },
  SUBSTITUTE: {
    fn: ([s, o, n, inst]) => {
      const text = str(s), old = str(o), nw = str(n);
      if (!old) return text;
      if (inst == null) return text.split(old).join(nw);
      const k = num(inst);
      let idx = -1;
      for (let i = 0; i < k; i++) { idx = text.indexOf(old, idx + 1); if (idx < 0) return text; }
      return text.slice(0, idx) + nw + text.slice(idx + old.length);
    },
  },
  REPLACE: { fn: ([s, st, n, nw]) => { const a = [...str(s)], p = num(st) - 1; a.splice(p, num(n), str(nw)); return a.join(''); } },
  FIND: { fn: ([f, s, st]) => { const i = str(s).indexOf(str(f), optNum(st, 1) - 1); if (i < 0) throw ERR.VALUE; return i + 1; } },
  SEARCH: {
    fn: ([f, s, st]) => {
      const text = str(s), start = optNum(st, 1) - 1;
      const re = wildcardRegex(str(f));
      const src = re.source.slice(1, -1);
      const m = new RegExp(src, 'i').exec(text.slice(start));
      if (!m) throw ERR.VALUE;
      return m.index + start + 1;
    },
  },
  REPT: { fn: ([s, n]) => { const k = num(n); if (k < 0) throw ERR.VALUE; return str(s).repeat(k); } },
  TEXT: { fn: ([v, f]) => { const x = scalar(v); const fmt = str(f); if (typeof x !== 'number' && (x == null || isNaN(x))) return toStr(x); return formatValue(toNum(x), fmt).text; } },
  VALUE: { fn: ([v]) => toNum(scalar(v)) },
  NUMBERVALUE: { fn: ([v]) => toNum(scalar(v)) },
  EXACT: { fn: ([a, b]) => str(a) === str(b) },
  CHAR: { fn: ([n]) => String.fromCharCode(num(n)) },
  UNICHAR: { fn: ([n]) => String.fromCodePoint(num(n)) },
  CODE: { fn: ([s]) => { const t = str(s); if (!t) throw ERR.VALUE; return t.codePointAt(0); } },
  T: { fn: ([v]) => (typeof scalar(v) === 'string' ? scalar(v) : '') },
  N: { fn: ([v]) => { const x = scalar(v); return typeof x === 'number' ? x : typeof x === 'boolean' ? +x : 0; } },
  FIXED: { fn: ([v, d, nc]) => { const dec = optNum(d, 2); const x = roundTo(num(v), dec); return x.toLocaleString('en-US', { minimumFractionDigits: Math.max(0, dec), maximumFractionDigits: Math.max(0, dec), useGrouping: !(nc != null && toBool(scalar(nc))) }); } },

  /* ===== 日期与时间 ===== */
  TODAY: { fn: () => todaySerial(), volatile: true },
  NOW: { fn: () => nowSerial(), volatile: true },
  DATE: { fn: ([y, m, d]) => { let yy = Math.floor(num(y)); if (yy < 1900) yy += 1900; return dateToSerial(yy, Math.floor(num(m)), Math.floor(num(d))); } },
  TIME: { fn: ([h, m, s]) => ((num(h) * 3600 + num(m) * 60 + num(s)) / 86400) % 1 },
  DATEVALUE: { fn: ([s]) => toDateNum(str(s)) },
  TIMEVALUE: { fn: ([s]) => { const m = str(s).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/); if (!m) throw ERR.VALUE; return (+m[1] * 3600 + +m[2] * 60 + +(m[3] || 0)) / 86400; } },
  YEAR: { fn: ([v]) => dateParts(toDateNum(v)).y },
  MONTH: { fn: ([v]) => dateParts(toDateNum(v)).m },
  DAY: { fn: ([v]) => dateParts(toDateNum(v)).d },
  HOUR: { fn: ([v]) => serialToDate(num(v)).hh },
  MINUTE: { fn: ([v]) => serialToDate(num(v)).mm },
  SECOND: { fn: ([v]) => serialToDate(num(v)).ss },
  WEEKDAY: {
    fn: ([v, t]) => {
      const dow = serialToDate(toDateNum(v)).dow, type = optNum(t, 1);
      if (type === 2) return dow === 0 ? 7 : dow;
      if (type === 3) return dow === 0 ? 6 : dow - 1;
      return dow + 1;
    },
  },
  WEEKNUM: {
    fn: ([v, t]) => {
      const n = toDateNum(v), d = serialToDate(n), jan1 = dateToSerial(d.y, 1, 1);
      const offset = serialToDate(jan1).dow - (optNum(t, 1) === 2 ? 1 : 0);
      return Math.floor((n - jan1 + ((offset + 7) % 7)) / 7) + 1;
    },
  },
  DAYS: { fn: ([e, s]) => toDateNum(e) - toDateNum(s) },
  DATEDIF: {
    fn: ([s, e, u]) => {
      const a = toDateNum(s), b = toDateNum(e);
      if (a > b) throw ERR.NUM;
      const A = serialToDate(a), B = serialToDate(b), unit = str(u).toUpperCase();
      let months = (B.y - A.y) * 12 + (B.m - A.m);
      if (B.d < A.d) months--;
      switch (unit) {
        case 'Y': return Math.floor(months / 12);
        case 'M': return months;
        case 'D': return b - a;
        case 'YM': return months % 12;
        case 'MD': { let d = B.d - A.d; if (d < 0) { d += new Date(Date.UTC(B.y, B.m - 1, 0)).getUTCDate(); } return d; }
        case 'YD': { let x = dateToSerial(B.y, A.m, A.d); if (x > b) x = dateToSerial(B.y - 1, A.m, A.d); return b - x; }
      }
      throw ERR.NUM;
    },
  },
  EDATE: { fn: ([s, m]) => { const d = serialToDate(toDateNum(s)); const mm = d.m + Math.floor(num(m)); const last = new Date(Date.UTC(d.y, mm, 0)).getUTCDate(); return dateToSerial(d.y, mm, Math.min(d.d, last)); } },
  EOMONTH: { fn: ([s, m]) => { const d = serialToDate(toDateNum(s)); return dateToSerial(d.y, d.m + Math.floor(num(m)) + 1, 0); } },
  NETWORKDAYS: {
    fn: ([s, e, hol]) => {
      let a = toDateNum(s), b = toDateNum(e), sign = 1;
      if (a > b) { [a, b] = [b, a]; sign = -1; }
      const H = new Set(hol != null ? flat(hol).filter((x) => typeof x === 'number').map(Math.floor) : []);
      let n = 0;
      for (let x = a; x <= b; x++) { const dow = serialToDate(x).dow; if (dow !== 0 && dow !== 6 && !H.has(x)) n++; }
      return n * sign;
    },
  },
  WORKDAY: {
    fn: ([s, days, hol]) => {
      let x = toDateNum(s), k = Math.floor(num(days));
      const H = new Set(hol != null ? flat(hol).filter((v) => typeof v === 'number').map(Math.floor) : []);
      const step = k < 0 ? -1 : 1;
      while (k !== 0) { x += step; const dow = serialToDate(x).dow; if (dow !== 0 && dow !== 6 && !H.has(x)) k -= step; }
      return x;
    },
  },

  /* ===== 信息 ===== */
  ISNUMBER: { errOk: true, fn: ([v]) => typeof scalar(v) === 'number' },
  ISTEXT: { errOk: true, fn: ([v]) => typeof scalar(v) === 'string' },
  ISNONTEXT: { errOk: true, fn: ([v]) => typeof scalar(v) !== 'string' },
  ISLOGICAL: { errOk: true, fn: ([v]) => typeof scalar(v) === 'boolean' },
  ISBLANK: { errOk: true, fn: ([v]) => scalar(v) == null },
  ISERROR: { errOk: true, fn: ([v]) => isErr(scalar(v)) },
  ISERR: { errOk: true, fn: ([v]) => isErr(scalar(v)) && scalar(v).code !== '#N/A' },
  ISNA: { errOk: true, fn: ([v]) => isErr(scalar(v)) && scalar(v).code === '#N/A' },
  ISEVEN: { fn: ([v]) => Math.floor(Math.abs(num(v))) % 2 === 0 },
  ISODD: { fn: ([v]) => Math.floor(Math.abs(num(v))) % 2 === 1 },
  ISFORMULA: { raw: true, fn: ([ref], ctx) => { if (ref.t !== 'ref') throw ERR.VALUE; const si = ref.sheet == null ? ctx.sheet : ctx.engine.sheetIndex(ref.sheet); return !!ctx.engine.getCell(si, ref.r1, ref.c1)?.f; } },
  NA: { fn: () => { throw ERR.NA; } },
  TYPE: { errOk: true, fn: ([v]) => { const x = v; return isMatrix(x) ? 64 : isErr(x) ? 16 : typeof x === 'boolean' ? 4 : typeof x === 'string' ? 2 : 1; } },

  /* ===== 财务 ===== */
  PMT: {
    fn: ([rate, nper, pv, fv, type]) => {
      const r = num(rate), n = num(nper), p = num(pv), f = optNum(fv, 0), t = optNum(type, 0);
      if (r === 0) return -(p + f) / n;
      const q = Math.pow(1 + r, n);
      return -(r * (p * q + f)) / ((1 + r * t) * (q - 1));
    },
  },
  FV: {
    fn: ([rate, nper, pmt, pv, type]) => {
      const r = num(rate), n = num(nper), m = num(pmt), p = optNum(pv, 0), t = optNum(type, 0);
      if (r === 0) return -(p + m * n);
      const q = Math.pow(1 + r, n);
      return -(p * q + (m * (1 + r * t) * (q - 1)) / r);
    },
  },
  PV: {
    fn: ([rate, nper, pmt, fv, type]) => {
      const r = num(rate), n = num(nper), m = num(pmt), f = optNum(fv, 0), t = optNum(type, 0);
      if (r === 0) return -(f + m * n);
      const q = Math.pow(1 + r, n);
      return -(f + (m * (1 + r * t) * (q - 1)) / r) / q;
    },
  },
  NPV: { fn: ([rate, ...vals]) => { const r = num(rate); return nums(vals).reduce((s, v, i) => s + v / Math.pow(1 + r, i + 1), 0); } },
  IRR: {
    fn: ([vals, guess]) => {
      const v = nums([matrixOf(vals)]);
      let r = optNum(guess, 0.1);
      for (let k = 0; k < 100; k++) {
        let f = 0, df = 0;
        v.forEach((x, i) => { f += x / Math.pow(1 + r, i); df -= (i * x) / Math.pow(1 + r, i + 1); });
        const nr = r - f / df;
        if (Math.abs(nr - r) < 1e-10) return nr;
        r = nr;
      }
      throw ERR.NUM;
    },
  },
};

function scalarEval(node, ctx) {
  if (!node || node.t === 'empty') return null;
  const v = evaluate(node, ctx);
  if (isErr(v)) throw v;
  return isMatrix(v) ? v[0][0] : v;
}

// 别名
const ALIASES = {
  'STDEV.S': 'STDEV', 'STDEV.P': 'STDEVP', 'VAR.S': 'VAR', 'VAR.P': 'VARP', 'RANK.EQ': 'RANK', 'MODE.SNGL': 'MODE',
  'PERCENTILE.INC': 'PERCENTILE', 'QUARTILE.INC': 'QUARTILE', 'CEILING.PRECISE': 'CEILING.MATH', 'FLOOR.PRECISE': 'FLOOR.MATH',
};
for (const [a, b] of Object.entries(ALIASES)) FUNCTIONS[a] = FUNCTIONS[b];

/* ---------- 函数说明（自动完成 / 插入函数对话框） ---------- */
const C = { math: '数学和三角', stat: '统计', logic: '逻辑', lookup: '查找与引用', text: '文本', date: '日期与时间', info: '信息', fin: '财务' };
export const CATEGORIES = Object.values(C);
const META_LIST = [
  ['SUM', C.math, 'number1, [number2], ...', '返回所有参数的和'],
  ['SUMIF', C.math, 'range, criteria, [sum_range]', '对满足条件的单元格求和'],
  ['SUMIFS', C.math, 'sum_range, criteria_range1, criteria1, ...', '对满足多个条件的单元格求和'],
  ['SUMPRODUCT', C.math, 'array1, [array2], ...', '返回对应数组元素乘积之和'],
  ['SUMSQ', C.math, 'number1, [number2], ...', '返回参数的平方和'],
  ['PRODUCT', C.math, 'number1, [number2], ...', '返回所有参数的乘积'],
  ['ROUND', C.math, 'number, num_digits', '按指定位数四舍五入'],
  ['ROUNDUP', C.math, 'number, num_digits', '向上舍入（远离零）'],
  ['ROUNDDOWN', C.math, 'number, num_digits', '向下舍入（靠近零）'],
  ['TRUNC', C.math, 'number, [num_digits]', '截尾取整'],
  ['INT', C.math, 'number', '向下取整为最接近的整数'],
  ['MOD', C.math, 'number, divisor', '返回两数相除的余数'],
  ['QUOTIENT', C.math, 'numerator, denominator', '返回商的整数部分'],
  ['ABS', C.math, 'number', '返回绝对值'],
  ['SIGN', C.math, 'number', '返回数字的符号'],
  ['SQRT', C.math, 'number', '返回平方根'],
  ['POWER', C.math, 'number, power', '返回乘幂'],
  ['EXP', C.math, 'number', '返回 e 的 n 次方'],
  ['LN', C.math, 'number', '返回自然对数'],
  ['LOG', C.math, 'number, [base]', '按指定底数返回对数'],
  ['LOG10', C.math, 'number', '返回以 10 为底的对数'],
  ['PI', C.math, '', '返回圆周率'],
  ['RAND', C.math, '', '返回 0 到 1 之间的随机数'],
  ['RANDBETWEEN', C.math, 'bottom, top', '返回指定范围内的随机整数'],
  ['CEILING', C.math, 'number, significance', '向上舍入为基数的倍数'],
  ['FLOOR', C.math, 'number, significance', '向下舍入为基数的倍数'],
  ['MROUND', C.math, 'number, multiple', '舍入到指定倍数'],
  ['EVEN', C.math, 'number', '向上舍入为最接近的偶数'],
  ['ODD', C.math, 'number', '向上舍入为最接近的奇数'],
  ['FACT', C.math, 'number', '返回阶乘'],
  ['COMBIN', C.math, 'number, number_chosen', '返回组合数'],
  ['GCD', C.math, 'number1, [number2], ...', '返回最大公约数'],
  ['LCM', C.math, 'number1, [number2], ...', '返回最小公倍数'],
  ['SIN', C.math, 'number', '正弦'], ['COS', C.math, 'number', '余弦'], ['TAN', C.math, 'number', '正切'],
  ['ASIN', C.math, 'number', '反正弦'], ['ACOS', C.math, 'number', '反余弦'], ['ATAN', C.math, 'number', '反正切'],
  ['ATAN2', C.math, 'x_num, y_num', '根据坐标返回反正切'],
  ['DEGREES', C.math, 'angle', '弧度转角度'], ['RADIANS', C.math, 'angle', '角度转弧度'],
  ['SUBTOTAL', C.math, 'function_num, ref1, ...', '返回分类汇总'],
  ['SEQUENCE', C.math, 'rows, [columns], [start], [step]', '生成数字序列'],
  ['AVERAGE', C.stat, 'number1, [number2], ...', '返回参数的平均值'],
  ['AVERAGEA', C.stat, 'value1, [value2], ...', '返回平均值（含文本与逻辑值）'],
  ['AVERAGEIF', C.stat, 'range, criteria, [average_range]', '返回满足条件的平均值'],
  ['AVERAGEIFS', C.stat, 'average_range, criteria_range1, criteria1, ...', '返回满足多个条件的平均值'],
  ['COUNT', C.stat, 'value1, [value2], ...', '计算包含数字的单元格个数'],
  ['COUNTA', C.stat, 'value1, [value2], ...', '计算非空单元格个数'],
  ['COUNTBLANK', C.stat, 'range', '计算空白单元格个数'],
  ['COUNTIF', C.stat, 'range, criteria', '计算满足条件的单元格个数'],
  ['COUNTIFS', C.stat, 'criteria_range1, criteria1, ...', '计算满足多个条件的单元格个数'],
  ['MAX', C.stat, 'number1, [number2], ...', '返回最大值'],
  ['MIN', C.stat, 'number1, [number2], ...', '返回最小值'],
  ['MAXIFS', C.stat, 'max_range, criteria_range1, criteria1, ...', '返回满足条件的最大值'],
  ['MINIFS', C.stat, 'min_range, criteria_range1, criteria1, ...', '返回满足条件的最小值'],
  ['MEDIAN', C.stat, 'number1, [number2], ...', '返回中位数'],
  ['MODE', C.stat, 'number1, [number2], ...', '返回出现频率最高的值'],
  ['STDEV', C.stat, 'number1, [number2], ...', '样本标准差'],
  ['STDEVP', C.stat, 'number1, [number2], ...', '总体标准差'],
  ['VAR', C.stat, 'number1, [number2], ...', '样本方差'],
  ['VARP', C.stat, 'number1, [number2], ...', '总体方差'],
  ['LARGE', C.stat, 'array, k', '返回第 k 个最大值'],
  ['SMALL', C.stat, 'array, k', '返回第 k 个最小值'],
  ['RANK', C.stat, 'number, ref, [order]', '返回数字在列表中的排位'],
  ['PERCENTILE', C.stat, 'array, k', '返回第 k 个百分点值'],
  ['QUARTILE', C.stat, 'array, quart', '返回四分位数'],
  ['CORREL', C.stat, 'array1, array2', '返回相关系数'],
  ['IF', C.logic, 'logical_test, [value_if_true], [value_if_false]', '根据条件返回不同的值'],
  ['IFS', C.logic, 'logical_test1, value_if_true1, ...', '检查多个条件，返回第一个为真的值'],
  ['IFERROR', C.logic, 'value, value_if_error', '如果出错则返回指定值'],
  ['IFNA', C.logic, 'value, value_if_na', '如果为 #N/A 则返回指定值'],
  ['AND', C.logic, 'logical1, [logical2], ...', '所有参数为真时返回 TRUE'],
  ['OR', C.logic, 'logical1, [logical2], ...', '任一参数为真时返回 TRUE'],
  ['NOT', C.logic, 'logical', '对逻辑值求反'],
  ['XOR', C.logic, 'logical1, [logical2], ...', '返回逻辑异或'],
  ['SWITCH', C.logic, 'expression, value1, result1, ..., [default]', '按值匹配返回结果'],
  ['TRUE', C.logic, '', '返回逻辑值 TRUE'], ['FALSE', C.logic, '', '返回逻辑值 FALSE'],
  ['VLOOKUP', C.lookup, 'lookup_value, table_array, col_index_num, [range_lookup]', '在表格首列查找并返回指定列的值'],
  ['HLOOKUP', C.lookup, 'lookup_value, table_array, row_index_num, [range_lookup]', '在表格首行查找并返回指定行的值'],
  ['XLOOKUP', C.lookup, 'lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode]', '在区域中查找并返回对应项'],
  ['LOOKUP', C.lookup, 'lookup_value, lookup_vector, [result_vector]', '在向量中查找值'],
  ['MATCH', C.lookup, 'lookup_value, lookup_array, [match_type]', '返回查找值在区域中的位置'],
  ['INDEX', C.lookup, 'array, row_num, [column_num]', '返回区域中指定行列的值'],
  ['CHOOSE', C.lookup, 'index_num, value1, [value2], ...', '从参数列表中选择值'],
  ['ROW', C.lookup, '[reference]', '返回行号'], ['COLUMN', C.lookup, '[reference]', '返回列号'],
  ['ROWS', C.lookup, 'array', '返回区域的行数'], ['COLUMNS', C.lookup, 'array', '返回区域的列数'],
  ['OFFSET', C.lookup, 'reference, rows, cols, [height], [width]', '返回偏移后的引用'],
  ['INDIRECT', C.lookup, 'ref_text', '返回文本指定的引用'],
  ['TRANSPOSE', C.lookup, 'array', '转置数组'],
  ['UNIQUE', C.lookup, 'array', '返回唯一值列表'],
  ['SORT', C.lookup, 'array, [sort_index], [sort_order]', '对区域排序'],
  ['FILTER', C.lookup, 'array, include, [if_empty]', '按条件筛选区域'],
  ['CONCAT', C.text, 'text1, [text2], ...', '合并文本'],
  ['CONCATENATE', C.text, 'text1, [text2], ...', '合并文本'],
  ['TEXTJOIN', C.text, 'delimiter, ignore_empty, text1, ...', '用分隔符合并文本'],
  ['LEFT', C.text, 'text, [num_chars]', '从左侧截取字符'],
  ['RIGHT', C.text, 'text, [num_chars]', '从右侧截取字符'],
  ['MID', C.text, 'text, start_num, num_chars', '从中间截取字符'],
  ['LEN', C.text, 'text', '返回文本长度'], ['LENB', C.text, 'text', '返回文本字节数'],
  ['UPPER', C.text, 'text', '转为大写'], ['LOWER', C.text, 'text', '转为小写'], ['PROPER', C.text, 'text', '首字母大写'],
  ['TRIM', C.text, 'text', '删除多余空格'], ['CLEAN', C.text, 'text', '删除不可打印字符'],
  ['SUBSTITUTE', C.text, 'text, old_text, new_text, [instance_num]', '替换文本'],
  ['REPLACE', C.text, 'old_text, start_num, num_chars, new_text', '按位置替换文本'],
  ['FIND', C.text, 'find_text, within_text, [start_num]', '查找文本位置（区分大小写）'],
  ['SEARCH', C.text, 'find_text, within_text, [start_num]', '查找文本位置（支持通配符）'],
  ['REPT', C.text, 'text, number_times', '重复文本'],
  ['TEXT', C.text, 'value, format_text', '按格式将数字转为文本'],
  ['VALUE', C.text, 'text', '将文本转为数字'],
  ['EXACT', C.text, 'text1, text2', '比较两个文本是否完全相同'],
  ['FIXED', C.text, 'number, [decimals], [no_commas]', '按固定小数位格式化'],
  ['CHAR', C.text, 'number', '返回编码对应的字符'], ['CODE', C.text, 'text', '返回首字符编码'],
  ['TODAY', C.date, '', '返回今天的日期'], ['NOW', C.date, '', '返回当前日期和时间'],
  ['DATE', C.date, 'year, month, day', '返回指定日期'], ['TIME', C.date, 'hour, minute, second', '返回指定时间'],
  ['DATEVALUE', C.date, 'date_text', '文本转日期'], ['TIMEVALUE', C.date, 'time_text', '文本转时间'],
  ['YEAR', C.date, 'serial_number', '返回年份'], ['MONTH', C.date, 'serial_number', '返回月份'], ['DAY', C.date, 'serial_number', '返回日'],
  ['HOUR', C.date, 'serial_number', '返回小时'], ['MINUTE', C.date, 'serial_number', '返回分钟'], ['SECOND', C.date, 'serial_number', '返回秒'],
  ['WEEKDAY', C.date, 'serial_number, [return_type]', '返回星期几'],
  ['WEEKNUM', C.date, 'serial_number, [return_type]', '返回一年中的第几周'],
  ['DAYS', C.date, 'end_date, start_date', '返回两日期间天数'],
  ['DATEDIF', C.date, 'start_date, end_date, unit', '计算两日期之差（Y/M/D/YM/MD/YD）'],
  ['EDATE', C.date, 'start_date, months', '返回若干月之前/后的日期'],
  ['EOMONTH', C.date, 'start_date, months', '返回若干月后的月末日期'],
  ['NETWORKDAYS', C.date, 'start_date, end_date, [holidays]', '返回工作日天数'],
  ['WORKDAY', C.date, 'start_date, days, [holidays]', '返回若干工作日后的日期'],
  ['ISNUMBER', C.info, 'value', '是否为数字'], ['ISTEXT', C.info, 'value', '是否为文本'], ['ISBLANK', C.info, 'value', '是否为空'],
  ['ISERROR', C.info, 'value', '是否为错误值'], ['ISERR', C.info, 'value', '是否为除 #N/A 外的错误'], ['ISNA', C.info, 'value', '是否为 #N/A'],
  ['ISLOGICAL', C.info, 'value', '是否为逻辑值'], ['ISEVEN', C.info, 'number', '是否为偶数'], ['ISODD', C.info, 'number', '是否为奇数'],
  ['ISFORMULA', C.info, 'reference', '是否包含公式'], ['NA', C.info, '', '返回 #N/A'], ['N', C.info, 'value', '将值转为数字'], ['TYPE', C.info, 'value', '返回值类型'],
  ['PMT', C.fin, 'rate, nper, pv, [fv], [type]', '计算贷款每期付款额'],
  ['FV', C.fin, 'rate, nper, pmt, [pv], [type]', '计算投资未来值'],
  ['PV', C.fin, 'rate, nper, pmt, [fv], [type]', '计算投资现值'],
  ['NPV', C.fin, 'rate, value1, [value2], ...', '计算净现值'],
  ['IRR', C.fin, 'values, [guess]', '计算内部收益率'],
];
export const FUNC_META = Object.fromEntries(META_LIST.map(([n, cat, sig, desc]) => [n, { name: n, cat, sig, desc }]));
export const VOLATILE = new Set(Object.entries(FUNCTIONS).filter(([, f]) => f.volatile).map(([n]) => n));
