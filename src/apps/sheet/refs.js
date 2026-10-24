// 单元格地址工具
export const MAX_ROWS = 1048576;
export const MAX_COLS = 16384;

export function colName(c) {
  let s = '';
  c += 1;
  while (c > 0) {
    const m = (c - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
}
export function colIndex(name) {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export const key = (r, c) => r + ',' + c;
export function unkey(k) {
  const i = k.indexOf(',');
  return [+k.slice(0, i), +k.slice(i + 1)];
}
export const addr = (r, c) => colName(c) + (r + 1);

export function rangeStr(rg) {
  const a = addr(rg.r1, rg.c1);
  if (rg.r1 === rg.r2 && rg.c1 === rg.c2) return a;
  return a + ':' + addr(rg.r2, rg.c2);
}

/** 解析 "A1" 或 "A1:B3"（可带 $） -> {r1,c1,r2,c2} 或 null */
export function parseRange(s) {
  s = s.trim().replace(/\$/g, '').toUpperCase();
  let m = s.match(/^([A-Z]{1,3})(\d+)(?::([A-Z]{1,3})(\d+))?$/);
  if (m) {
    const r1 = +m[2] - 1, c1 = colIndex(m[1]);
    const r2 = m[3] ? +m[4] - 1 : r1, c2 = m[3] ? colIndex(m[3]) : c1;
    if (r1 < 0 || r2 < 0) return null;
    return norm({ r1, c1, r2, c2 });
  }
  m = s.match(/^([A-Z]{1,3}):([A-Z]{1,3})$/);
  if (m) return norm({ r1: 0, c1: colIndex(m[1]), r2: MAX_ROWS - 1, c2: colIndex(m[2]) });
  m = s.match(/^(\d+):(\d+)$/);
  if (m) return norm({ r1: +m[1] - 1, c1: 0, r2: +m[2] - 1, c2: MAX_COLS - 1 });
  return null;
}

export function norm(rg) {
  return { r1: Math.min(rg.r1, rg.r2), c1: Math.min(rg.c1, rg.c2), r2: Math.max(rg.r1, rg.r2), c2: Math.max(rg.c1, rg.c2) };
}
export const inRange = (rg, r, c) => r >= rg.r1 && r <= rg.r2 && c >= rg.c1 && c <= rg.c2;
export const intersects = (a, b) => a.r1 <= b.r2 && a.r2 >= b.r1 && a.c1 <= b.c2 && a.c2 >= b.c1;

export function quoteSheet(name) {
  return /^[A-Za-z_一-龥][\w一-龥.]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) ? name : "'" + name.replace(/'/g, "''") + "'";
}
