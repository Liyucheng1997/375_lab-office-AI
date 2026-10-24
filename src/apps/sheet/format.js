// 数字格式、日期序列号、输入解析
import { SSF } from 'xlsx';

export class FErr {
  constructor(code) { this.code = code; }
  toString() { return this.code; }
}
export const ERR = {
  DIV0: new FErr('#DIV/0!'), REF: new FErr('#REF!'), NAME: new FErr('#NAME?'), VALUE: new FErr('#VALUE!'),
  NA: new FErr('#N/A'), NUM: new FErr('#NUM!'), NULL: new FErr('#NULL!'), CIRC: new FErr('#CIRC!'), SPILL: new FErr('#SPILL!'),
};
export const isErr = (v) => v instanceof FErr;

/* ---------- 日期序列号（1900 日期系统） ---------- */
const EPOCH = Date.UTC(1899, 11, 30);
export function dateToSerial(y, m, d, hh = 0, mm = 0, ss = 0) {
  return (Date.UTC(y, m - 1, d, hh, mm, ss) - EPOCH) / 86400000;
}
export function serialToDate(serial) {
  const ms = Math.round(serial * 86400000) + EPOCH;
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes(), ss: d.getUTCSeconds(), dow: d.getUTCDay() };
}
export function nowSerial() {
  const n = new Date();
  return dateToSerial(n.getFullYear(), n.getMonth() + 1, n.getDate(), n.getHours(), n.getMinutes(), n.getSeconds());
}
export function todaySerial() {
  const n = new Date();
  return dateToSerial(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

/* ---------- 数字格式 ---------- */
export const NUMBER_FORMATS = [
  { id: 'General', label: '常规', fmt: 'General' },
  { id: 'number', label: '数值', fmt: '0.00' },
  { id: 'currency', label: '货币', fmt: '¥#,##0.00' },
  { id: 'accounting', label: '会计专用', fmt: '_ ¥* #,##0.00_ ;_ ¥* -#,##0.00_ ;_ ¥* "-"??_ ;_ @_ ' },
  { id: 'shortDate', label: '短日期', fmt: 'yyyy/m/d' },
  { id: 'longDate', label: '长日期', fmt: 'yyyy"年"m"月"d"日"' },
  { id: 'time', label: '时间', fmt: 'h:mm:ss' },
  { id: 'percent', label: '百分比', fmt: '0.00%' },
  { id: 'fraction', label: '分数', fmt: '# ?/?' },
  { id: 'scientific', label: '科学记数', fmt: '0.00E+00' },
  { id: 'text', label: '文本', fmt: '@' },
];

export function isDateFormat(nf) {
  if (!nf || nf === 'General' || nf === '@') return false;
  const s = nf.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  return /[ymdhs]/i.test(s) && !/[0#?]/.test(s.replace(/[ymdhs]+/gi, ''));
}

function formatGeneral(n) {
  if (!isFinite(n)) return '#NUM!';
  if (Number.isInteger(n) && Math.abs(n) < 1e11) return String(n);
  const a = Math.abs(n);
  if (a !== 0 && (a >= 1e11 || a < 1e-9)) return expo(n);
  // 最多 11 位有效数字
  const s = Number(n.toPrecision(11)).toString();
  return s.includes('e') ? expo(n) : s;
}
function expo(n) {
  let [mant, exp] = n.toExponential(5).split('e');
  if (mant.includes('.')) mant = mant.replace(/\.?0+$/, '');
  const e = +exp;
  return mant + 'E' + (e < 0 ? '-' : '+') + String(Math.abs(e)).padStart(2, '0');
}

const fmtCache = new Map();
/** SSF 不识别格式串中未加引号的非 ASCII 字符（如 ¥、中文），这里自动加引号；[红色] 转为 [Red] */
function sanitizeFmt(nf) {
  let out = fmtCache.get(nf);
  if (out) return out;
  out = '';
  let q = false, br = false;
  for (const ch of nf.replace(/\[红色\]/g, '[Red]')) {
    if (ch === '"' && !br) q = !q;
    else if (ch === '[' && !q) br = true;
    else if (ch === ']' && !q) br = false;
    if (!q && !br && ch.charCodeAt(0) > 127) out += '"' + ch + '"';
    else out += ch;
  }
  fmtCache.set(nf, out);
  return out;
}
/** 返回 { text, color } */
export function formatValue(v, nf) {
  if (v == null || v === '') return { text: '' };
  if (isErr(v)) return { text: v.code };
  if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE' };
  if (typeof v === 'string') return { text: v };
  if (typeof v === 'number') {
    if (!nf || nf === 'General') return { text: formatGeneral(v) };
    if (nf === '@') return { text: formatGeneral(v) };
    try {
      const text = SSF.format(sanitizeFmt(nf), v);
      let color;
      const secs = nf.split(';');
      const sec = v < 0 && secs.length > 1 ? secs[1] : v === 0 && secs.length > 2 ? secs[2] : secs[0];
      if (/\[(red|红色)\]/i.test(sec) || (v < 0 && secs.length === 1 && /\[(red|红色)\]/i.test(nf))) color = '#e00000';
      return { text, color };
    } catch {
      return { text: formatGeneral(v) };
    }
  }
  if (Array.isArray(v)) return formatValue(v[0]?.[0], nf);
  return { text: String(v) };
}

/** 调整小数位：返回新的格式串 */
export function adjustDecimals(nf, delta, sampleValue) {
  if (!nf || nf === 'General') {
    // 依据值当前的小数位
    let dec = 0;
    if (typeof sampleValue === 'number') {
      const s = formatGeneral(sampleValue);
      const i = s.indexOf('.');
      dec = i >= 0 ? s.length - i - 1 : 0;
    }
    dec = Math.max(0, dec + delta);
    return dec ? '0.' + '0'.repeat(dec) : '0';
  }
  return nf.split(';').map((sec) => {
    // 找到第一个数字占位块
    return sec.replace(/([0#?](?:[0#?,]*))(\.([0#?]*))?/, (m, int, _d, decs) => {
      let n = (decs || '').length + delta;
      if (n < 0) n = 0;
      return int + (n ? '.' + '0'.repeat(n) : '');
    });
  }).join(';');
}

export function toggleThousands(nf) {
  if (!nf || nf === 'General') return '#,##0';
  if (nf.includes('#,##')) return nf.replace(/#,##0/g, '0');
  return nf.replace(/(^|[^0#.])0(?=[.;%]|$|[^0-9])/, '$1#,##0');
}

/* ---------- 输入解析 ---------- */
/** 把用户输入的文本解析为值，可能附带推荐格式。返回 { v, f?, nf? } */
export function parseInput(text) {
  if (text == null) return { v: null };
  if (typeof text !== 'string') return { v: text };
  if (text === '') return { v: null };
  if (text[0] === '=' && text.length > 1) return { f: text.slice(1) };
  if (text[0] === "'") return { v: text.slice(1), nf: undefined, forceText: true };
  const t = text.trim();
  const up = t.toUpperCase();
  if (up === 'TRUE') return { v: true };
  if (up === 'FALSE') return { v: false };
  // 数字（含千分位、货币、百分比）
  let m = t.match(/^([-+])?([¥$€£])?\s?([-+])?((\d{1,3}(,\d{3})+|\d+)(\.\d*)?|\.\d+)([eE][-+]?\d+)?(%)?$/);
  if (m) {
    const sign = (m[1] === '-' || m[3] === '-') ? -1 : 1;
    let n = parseFloat(m[4].replace(/,/g, '') + (m[8] || '')) * sign;
    let nf;
    if (m[9]) { n /= 100; nf = m[4].includes('.') ? '0.00%' : '0%'; }
    else if (m[2]) nf = m[2] + '#,##0' + (m[7] && m[7].length > 1 ? '.00' : '');
    else if (m[4].includes(',')) nf = '#,##0' + (m[7] && m[7].length > 1 ? '.' + '0'.repeat(m[7].length - 1) : '');
    return { v: n, nf };
  }
  // 日期 yyyy-m-d / yyyy/m/d / yyyy年m月d日 [hh:mm[:ss]]
  m = t.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const hasTime = m[4] != null;
      const v = dateToSerial(y, mo, d, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
      return { v, nf: hasTime ? 'yyyy/m/d h:mm' : t.includes('年') ? 'yyyy"年"m"月"d"日"' : 'yyyy/m/d' };
    }
  }
  m = t.match(/^(\d{1,2})月(\d{1,2})日$/) || t.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (m && +m[1] <= 12 && +m[2] <= 31) {
    const y = new Date().getFullYear();
    return { v: dateToSerial(y, +m[1], +m[2]), nf: 'm"月"d"日"' };
  }
  // 时间
  m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (m) {
    let hh = +m[1];
    if (m[4]) { if (/pm/i.test(m[4]) && hh < 12) hh += 12; if (/am/i.test(m[4]) && hh === 12) hh = 0; }
    if (hh < 24 && +m[2] < 60) return { v: (hh * 3600 + +m[2] * 60 + +(m[3] || 0)) / 86400, nf: m[3] ? 'h:mm:ss' : 'h:mm' };
  }
  return { v: text };
}

/** 单元格原始值转编辑文本 */
export function valueToEditText(cell) {
  if (!cell) return '';
  if (cell.f != null) return '=' + cell.f;
  const v = cell.v;
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    const nf = cell.s && cell.s.nf;
    if (nf && isDateFormat(nf)) {
      const d = serialToDate(v);
      const hasDate = v >= 1;
      const hasTime = Math.abs(v % 1) > 1e-9;
      const pad = (n) => String(n).padStart(2, '0');
      let s = hasDate ? `${d.y}/${d.m}/${d.d}` : '';
      if (hasTime) s += (s ? ' ' : '') + `${d.hh}:${pad(d.mm)}:${pad(d.ss)}`;
      return s || '0';
    }
    if (nf && nf.includes('%')) return formatGeneral(+(v * 100).toPrecision(12)) + '%';
    return formatGeneral(v);
  }
  if (typeof v === 'string' && cell.forceText && /^[=\d+-]/.test(v)) return "'" + v;
  return String(v);
}

export { formatGeneral };
