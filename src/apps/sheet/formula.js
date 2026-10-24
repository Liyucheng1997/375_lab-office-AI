// 公式：词法分析、语法分析、引用变换（复制/插入/删除/重命名）、求值
import { FErr, ERR, isErr } from './format.js';
import { colIndex, colName, MAX_ROWS, MAX_COLS, quoteSheet } from './refs.js';
import { FUNCTIONS } from './functions.js';

/* ================= 词法分析 ================= */

const SHEET_RE = "(?:'((?:[^']|'')+)'|([A-Za-z_\\u4e00-\\u9fa5][\\w\\u4e00-\\u9fa5.]*))!";
const CELL = '\\$?[A-Za-z]{1,3}\\$?\\d+';
const RE_REF = new RegExp(`^(?:${SHEET_RE})?(${CELL}(?::${CELL})?|\\$?[A-Za-z]{1,3}:\\$?[A-Za-z]{1,3}|\\$?\\d+:\\$?\\d+)(?![\\w(.\\u4e00-\\u9fa5])`);
const RE_NUM = /^(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?/;
const RE_ERR = /^(#DIV\/0!|#N\/A|#NAME\?|#NULL!|#NUM!|#REF!|#VALUE!|#SPILL!|#CIRC!)/i;
const RE_ID = /^[A-Za-z_一-龥][\w.一-龥]*/;
const OPS = ['<>', '<=', '>=', '+', '-', '*', '/', '^', '&', '=', '<', '>', '%', ',', '(', ')', '{', '}', ';', ':'];

export function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const ch = src[i];
    if (/\s/.test(ch)) {
      const m = rest.match(/^\s+/);
      toks.push({ type: 'ws', text: m[0] });
      i += m[0].length;
      continue;
    }
    if (ch === '"') {
      let j = i + 1, s = '';
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') { s += '"'; j += 2; continue; }
          break;
        }
        s += src[j++];
      }
      toks.push({ type: 'str', text: src.slice(i, j + 1), value: s });
      i = j + 1;
      continue;
    }
    let m;
    if (ch === '#' && (m = rest.match(RE_ERR))) {
      toks.push({ type: 'err', text: m[0], value: m[0].toUpperCase() });
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(RE_REF))) {
      // 避免把函数名（如 LOG10( ）识别为引用：RE_REF 已用负向前瞻排除 '('
      const sheet = m[1] != null ? m[1].replace(/''/g, "'") : m[2] != null ? m[2] : null;
      toks.push({ type: 'ref', text: m[0], sheet, body: m[3], sheetQuoted: m[1] != null });
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(RE_NUM))) {
      toks.push({ type: 'num', text: m[0], value: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(RE_ID))) {
      const after = src.slice(i + m[0].length).match(/^\s*\(/);
      const up = m[0].toUpperCase();
      if (after) toks.push({ type: 'func', text: m[0], value: up });
      else if (up === 'TRUE' || up === 'FALSE') toks.push({ type: 'bool', text: m[0], value: up === 'TRUE' });
      else toks.push({ type: 'name', text: m[0], value: up });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => rest.startsWith(o));
    if (op) {
      toks.push({ type: 'op', text: op });
      i += op.length;
      continue;
    }
    toks.push({ type: 'unknown', text: ch });
    i++;
  }
  return toks;
}

/* ================= 引用解析 ================= */

function parsePart(s) {
  const m = s.match(/^(\$?)([A-Za-z]{1,3})?(\$?)(\d+)?$/);
  if (!m) return null;
  return {
    ca: !!m[1] && !!m[2], c: m[2] ? colIndex(m[2]) : null,
    ra: m[2] ? !!m[3] : !!m[1], r: m[4] ? +m[4] - 1 : null,
  };
}
/** body: "A1" "A1:B2" "A:B" "1:3"（可含$）-> { kind, a, b } */
export function parseRefBody(body) {
  const [x, y] = body.split(':');
  const a = parsePart(x);
  if (!y) return { kind: 'cell', a };
  const b = parsePart(y);
  if (a.c == null) return { kind: 'rows', a: { ...a, ra: x.startsWith('$') }, b: { ...b, ra: y.startsWith('$') } };
  if (a.r == null) return { kind: 'cols', a: { ...a, ca: x.startsWith('$') }, b: { ...b, ca: y.startsWith('$') } };
  return { kind: 'range', a, b };
}
function partStr(p, kind) {
  if (kind === 'rows') return (p.ra ? '$' : '') + (p.r + 1);
  if (kind === 'cols') return (p.ca ? '$' : '') + colName(p.c);
  return (p.ca ? '$' : '') + colName(p.c) + (p.ra ? '$' : '') + (p.r + 1);
}
export function refBodyStr(ref) {
  return ref.kind === 'cell' ? partStr(ref.a, 'cell') : partStr(ref.a, ref.kind) + ':' + partStr(ref.b, ref.kind);
}

/* ================= 语法分析 ================= */

const astCache = new Map();
export function parse(src) {
  let ast = astCache.get(src);
  if (ast) return ast;
  try {
    ast = new Parser(tokenize(src).filter((t) => t.type !== 'ws')).parse();
  } catch (e) {
    ast = { t: 'err', v: e instanceof FErr ? e : ERR.NAME, syntax: true, msg: e.message };
  }
  if (astCache.size > 20000) astCache.clear();
  astCache.set(src, ast);
  return ast;
}

class Parser {
  constructor(toks) { this.toks = toks; this.i = 0; }
  peek() { return this.toks[this.i]; }
  isOp(text) { const t = this.peek(); return t && t.type === 'op' && t.text === text; }
  next() { return this.toks[this.i++]; }
  expect(text) {
    if (!this.isOp(text)) throw new Error(`缺少 "${text}"`);
    this.i++;
  }
  parse() {
    if (!this.toks.length) return { t: 'empty' };
    const e = this.compare();
    if (this.i < this.toks.length) throw new Error('公式中有多余的内容：' + this.peek().text);
    return e;
  }
  compare() {
    let l = this.concat();
    while (this.peek() && this.peek().type === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(this.peek().text)) {
      const op = this.next().text;
      l = { t: 'bin', op, l, r: this.concat() };
    }
    return l;
  }
  concat() {
    let l = this.add();
    while (this.isOp('&')) { this.next(); l = { t: 'bin', op: '&', l, r: this.add() }; }
    return l;
  }
  add() {
    let l = this.mul();
    while (this.isOp('+') || this.isOp('-')) { const op = this.next().text; l = { t: 'bin', op, l, r: this.mul() }; }
    return l;
  }
  mul() {
    let l = this.pow();
    while (this.isOp('*') || this.isOp('/')) { const op = this.next().text; l = { t: 'bin', op, l, r: this.pow() }; }
    return l;
  }
  pow() {
    let l = this.unary();
    while (this.isOp('^')) { this.next(); l = { t: 'bin', op: '^', l, r: this.unary() }; }
    return l;
  }
  unary() {
    if (this.isOp('-')) { this.next(); return { t: 'neg', e: this.unary() }; }
    if (this.isOp('+')) { this.next(); return this.unary(); }
    return this.postfix();
  }
  postfix() {
    let e = this.primary();
    while (this.isOp('%')) { this.next(); e = { t: 'pct', e }; }
    return e;
  }
  primary() {
    const t = this.next();
    if (!t) throw new Error('公式不完整');
    switch (t.type) {
      case 'num': return { t: 'num', v: t.value };
      case 'str': return { t: 'str', v: t.value };
      case 'bool': return { t: 'bool', v: t.value };
      case 'err': return { t: 'err', v: errOf(t.value) };
      case 'ref': {
        const ref = parseRefBody(t.body);
        const n = { t: 'ref', sheet: t.sheet };
        if (ref.kind === 'cell') Object.assign(n, { r1: ref.a.r, c1: ref.a.c, r2: ref.a.r, c2: ref.a.c, single: true });
        else if (ref.kind === 'range') Object.assign(n, { r1: Math.min(ref.a.r, ref.b.r), c1: Math.min(ref.a.c, ref.b.c), r2: Math.max(ref.a.r, ref.b.r), c2: Math.max(ref.a.c, ref.b.c) });
        else if (ref.kind === 'cols') Object.assign(n, { r1: 0, r2: MAX_ROWS - 1, c1: Math.min(ref.a.c, ref.b.c), c2: Math.max(ref.a.c, ref.b.c), whole: 'col' });
        else Object.assign(n, { c1: 0, c2: MAX_COLS - 1, r1: Math.min(ref.a.r, ref.b.r), r2: Math.max(ref.a.r, ref.b.r), whole: 'row' });
        return n;
      }
      case 'func': {
        this.expect('(');
        const args = [];
        if (!this.isOp(')')) {
          for (;;) {
            if (this.isOp(',') || this.isOp(')')) args.push({ t: 'empty' });
            else args.push(this.compare());
            if (this.isOp(',')) { this.next(); continue; }
            break;
          }
        }
        this.expect(')');
        let name = t.value.replace(/^_XLFN\./, '');
        return { t: 'fn', name, args };
      }
      case 'name': return { t: 'name', v: t.value };
      case 'op':
        if (t.text === '(') {
          const e = this.compare();
          this.expect(')');
          return e;
        }
        if (t.text === '{') {
          const rows = [[]];
          for (;;) {
            let neg = false;
            if (this.isOp('-')) { this.next(); neg = true; }
            const x = this.next();
            if (!x) throw new Error('数组常量不完整');
            let v = x.type === 'num' ? x.value : x.type === 'str' ? x.value : x.type === 'bool' ? x.value : x.type === 'err' ? errOf(x.value) : null;
            if (neg) v = -v;
            rows[rows.length - 1].push(v);
            if (this.isOp(',')) { this.next(); continue; }
            if (this.isOp(';')) { this.next(); rows.push([]); continue; }
            break;
          }
          this.expect('}');
          return { t: 'arr', v: rows };
        }
      // fallthrough
      default:
        throw new Error('无法识别：' + t.text);
    }
  }
}

function errOf(code) {
  return Object.values(ERR).find((e) => e.code === code) || new FErr(code);
}

/* ================= 引用变换 ================= */

/** 对公式中的每个引用调用 fn(sheetName|null, ref) ，fn 返回新的 ref、null(=#REF!) 或 undefined(不变) */
export function mapRefs(src, fn, renameSheet) {
  const toks = tokenize(src);
  let out = '';
  for (const t of toks) {
    if (t.type !== 'ref') { out += t.text; continue; }
    const ref = parseRefBody(t.body);
    const res = fn(t.sheet, ref);
    let sheetPart = t.text.slice(0, t.text.length - t.body.length);
    if (renameSheet && t.sheet != null) {
      const nn = renameSheet(t.sheet);
      if (nn != null) sheetPart = quoteSheet(nn) + '!';
    }
    if (res === null) out += sheetPart + '#REF!';
    else if (res === undefined) out += sheetPart + t.body;
    else out += sheetPart + refBodyStr(res);
  }
  return out;
}

/** 复制粘贴/填充：相对引用平移 dr, dc */
export function shiftFormula(src, dr, dc) {
  if (!dr && !dc) return src;
  return mapRefs(src, (sheet, ref) => {
    const mv = (p, kind) => {
      const q = { ...p };
      if (kind !== 'cols' && !p.ra && p.r != null) q.r += dr;
      if (kind !== 'rows' && !p.ca && p.c != null) q.c += dc;
      if ((q.r != null && q.r < 0) || (q.c != null && q.c < 0)) throw 0;
      return q;
    };
    try {
      return { kind: ref.kind, a: mv(ref.a, ref.kind), b: ref.b && mv(ref.b, ref.kind) };
    } catch { return null; }
  });
}

/**
 * 插入/删除行列：axis 'r'|'c'，at 起始索引，n>0 插入 n 个，n<0 删除 -n 个。
 * hostSheet: 公式所在工作表名，target: 被修改的工作表名
 */
export function adjustFormula(src, hostSheet, target, axis, at, n) {
  return mapRefs(src, (sheet, ref) => {
    const sh = sheet == null ? hostSheet : sheet;
    if (sh.toLowerCase() !== target.toLowerCase()) return undefined;
    const k = axis; // 'r' or 'c'
    if ((k === 'r' && ref.kind === 'cols') || (k === 'c' && ref.kind === 'rows')) return undefined;
    const a = { ...ref.a }, b = ref.b ? { ...ref.b } : null;
    if (n > 0) {
      if (a[k] >= at) a[k] += n;
      if (b && b[k] >= at) b[k] += n;
      return { kind: ref.kind, a, b };
    }
    const del = -n, end = at + del - 1;
    if (!b) {
      if (a[k] >= at && a[k] <= end) return null;
      if (a[k] > end) a[k] -= del;
      return { kind: ref.kind, a };
    }
    let lo = Math.min(a[k], b[k]), hi = Math.max(a[k], b[k]);
    if (lo >= at && hi <= end) return null;
    const f = (x, isLo) => {
      if (x < at) return x;
      if (x > end) return x - del;
      return isLo ? at : at - 1;
    };
    const nlo = f(lo, true), nhi = f(hi, false);
    if (a[k] <= b[k]) { a[k] = nlo; b[k] = nhi; } else { b[k] = nlo; a[k] = nhi; }
    return { kind: ref.kind, a, b };
  });
}

export function renameSheetInFormula(src, oldName, newName) {
  return mapRefs(src, () => undefined, (s) => (s.toLowerCase() === oldName.toLowerCase() ? newName : null));
}

/** 公式中所有引用（用于编辑时彩色高亮） */
export function listRefs(src) {
  const out = [];
  let pos = 0;
  for (const t of tokenize(src)) {
    if (t.type === 'ref') {
      const ref = parseRefBody(t.body);
      out.push({ sheet: t.sheet, ref, start: pos, end: pos + t.text.length });
    }
    pos += t.text.length;
  }
  return out;
}

/* ================= 求值 ================= */

/** 矩阵：二维数组 rows[cols] */
export const isMatrix = (v) => Array.isArray(v);

/**
 * ctx: { engine, sheet(索引), r, c }
 * engine: getValue(si, r, c), getRange(si, r1,c1,r2,c2), sheetIndex(name), usedBounds(si)
 */
export function evaluate(node, ctx) {
  switch (node.t) {
    case 'num': case 'str': case 'bool': return node.v;
    case 'err': throw node.v;
    case 'empty': return null;
    case 'arr': return node.v;
    case 'name': throw ERR.NAME;
    case 'ref': {
      const si = node.sheet == null ? ctx.sheet : ctx.engine.sheetIndex(node.sheet);
      if (si < 0) throw ERR.REF;
      if (node.single) return ctx.engine.getValue(si, node.r1, node.c1);
      return ctx.engine.getRange(si, node.r1, node.c1, node.r2, node.c2);
    }
    case 'neg': return unaryMap(evaluate(node.e, ctx), (x) => -toNum(x));
    case 'pct': return unaryMap(evaluate(node.e, ctx), (x) => toNum(x) / 100);
    case 'bin': return binary(node.op, evaluate(node.l, ctx), evaluate(node.r, ctx));
    case 'fn': {
      const def = FUNCTIONS[node.name];
      if (!def) throw ERR.NAME;
      if (def.raw) return def.fn(node.args, ctx);
      const args = node.args.map((a) => {
        try { return evaluate(a, ctx); } catch (e) { if (e instanceof FErr) return e; throw e; }
      });
      if (!def.errOk) for (const a of args) if (isErr(a)) throw a;
      return def.fn(args, ctx);
    }
  }
  throw ERR.VALUE;
}

function unaryMap(v, f) {
  if (isMatrix(v)) return v.map((row) => row.map((x) => { try { return f(x); } catch (e) { if (e instanceof FErr) return e; throw e; } }));
  return f(v);
}

function binary(op, a, b) {
  if (isMatrix(a) || isMatrix(b)) {
    const A = isMatrix(a) ? a : [[a]], B = isMatrix(b) ? b : [[b]];
    const rows = Math.max(A.length, B.length), cols = Math.max(A[0].length, B[0].length);
    const out = [];
    for (let i = 0; i < rows; i++) {
      const row = [];
      for (let j = 0; j < cols; j++) {
        const x = pick(A, i, j), y = pick(B, i, j);
        try { row.push(binScalar(op, x, y)); } catch (e) { if (e instanceof FErr) row.push(e); else throw e; }
      }
      out.push(row);
    }
    return out;
  }
  return binScalar(op, a, b);
}
function pick(M, i, j) {
  const r = M.length === 1 ? M[0] : M[i];
  if (!r) return ERR.NA;
  const v = r.length === 1 ? r[0] : r[j];
  return v === undefined ? ERR.NA : v;
}

function binScalar(op, a, b) {
  if (isErr(a)) throw a;
  if (isErr(b)) throw b;
  switch (op) {
    case '+': return toNum(a) + toNum(b);
    case '-': return toNum(a) - toNum(b);
    case '*': return toNum(a) * toNum(b);
    case '/': { const d = toNum(b); if (d === 0) throw ERR.DIV0; return toNum(a) / d; }
    case '^': { const r = Math.pow(toNum(a), toNum(b)); if (!isFinite(r)) throw ERR.NUM; return r; }
    case '&': return toStr(a) + toStr(b);
    default: {
      const c = compareValues(a, b);
      switch (op) {
        case '=': return c === 0;
        case '<>': return c !== 0;
        case '<': return c < 0;
        case '>': return c > 0;
        case '<=': return c <= 0;
        case '>=': return c >= 0;
      }
    }
  }
  throw ERR.VALUE;
}

/** Excel 比较：数字 < 文本 < 布尔；文本不区分大小写；空值视为 0 或 "" */
export function compareValues(a, b) {
  if (a == null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b == null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const rank = (v) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 1) {
    const x = a.toLowerCase(), y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (ra === 2) return (a ? 1 : 0) - (b ? 1 : 0);
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ---------- 类型转换 ---------- */
export function toNum(v) {
  if (typeof v === 'number') return v;
  if (v == null || v === '') return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isErr(v)) throw v;
  if (isMatrix(v)) return toNum(v[0][0]);
  if (typeof v === 'string') {
    const s = v.trim().replace(/,/g, '');
    if (s !== '' && !isNaN(s)) return parseFloat(s);
    const pm = s.match(/^(-?[\d.]+)%$/);
    if (pm) return parseFloat(pm[1]) / 100;
    const dm = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (dm) return (Date.UTC(+dm[1], +dm[2] - 1, +dm[3]) - Date.UTC(1899, 11, 30)) / 86400000;
  }
  throw ERR.VALUE;
}
export function toStr(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toPrecision(15));
  if (isErr(v)) throw v;
  if (isMatrix(v)) return toStr(v[0][0]);
  return String(v);
}
export function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v == null) return false;
  if (isErr(v)) throw v;
  if (isMatrix(v)) return toBool(v[0][0]);
  if (typeof v === 'string') {
    const u = v.toUpperCase();
    if (u === 'TRUE') return true;
    if (u === 'FALSE') return false;
  }
  throw ERR.VALUE;
}
