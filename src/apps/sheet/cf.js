// 条件格式
import { key } from './refs.js';
import { isErr } from './format.js';
import { parse, evaluate, shiftFormula, toBool } from './formula.js';

export const CF_STYLES = [
  { label: '浅红填充色深红色文本', s: { bg: '#ffc7ce', fc: '#9c0006' } },
  { label: '黄填充色深黄色文本', s: { bg: '#ffeb9c', fc: '#9c5700' } },
  { label: '绿填充色深绿色文本', s: { bg: '#c6efce', fc: '#006100' } },
  { label: '浅红色填充', s: { bg: '#ffc7ce' } },
  { label: '红色文本', s: { fc: '#ff0000' } },
  { label: '红色边框/加粗', s: { fc: '#c00000', b: true } },
];

function mix(c1, c2, t) {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const a = p(c1), b = p(c2);
  return '#' + a.map((x, i) => Math.round(x + (b[i] - x) * t).toString(16).padStart(2, '0')).join('');
}

/** 为工作表构建条件格式求值器：返回 (r, c) => { bg, fc, b, bar } | null */
export function buildCF(engine, si, sheet) {
  if (!sheet.cf || !sheet.cf.length) return null;
  const prepared = sheet.cf.map((rule) => {
    const rg = rule.range;
    const vals = [];
    const need = ['dup', 'unique', 'top', 'bottom', 'above', 'below', 'bar', 'scale2', 'scale3'].includes(rule.type);
    if (need) {
      const r2 = Math.min(rg.r2, engine.bounds[si].maxR), c2 = Math.min(rg.c2, engine.bounds[si].maxC);
      for (let r = rg.r1; r <= r2; r++) for (let c = rg.c1; c <= c2; c++) vals.push(engine.display(si, r, c));
    }
    const nums = vals.filter((v) => typeof v === 'number').sort((a, b) => a - b);
    const p = { rule, nums };
    if (rule.type === 'dup' || rule.type === 'unique') {
      const cnt = new Map();
      for (const v of vals) if (v != null && v !== '') { const k = typeof v === 'string' ? v.toLowerCase() : v; cnt.set(k, (cnt.get(k) || 0) + 1); }
      p.cnt = cnt;
    }
    if (rule.type === 'top' || rule.type === 'bottom') {
      let n = rule.n || 10;
      if (rule.percent) n = Math.max(1, Math.floor((nums.length * n) / 100));
      p.th = rule.type === 'top' ? nums[Math.max(0, nums.length - n)] : nums[Math.min(nums.length - 1, n - 1)];
    }
    if (rule.type === 'above' || rule.type === 'below') p.avg = nums.reduce((a, b) => a + b, 0) / (nums.length || 1);
    p.min = nums[0];
    p.max = nums[nums.length - 1];
    return p;
  });

  return (r, c) => {
    let out = null;
    for (const p of prepared) {
      const { rule } = p;
      const rg = rule.range;
      if (r < rg.r1 || r > rg.r2 || c < rg.c1 || c > rg.c2) continue;
      const v = engine.display(si, r, c);
      if (isErr(v)) continue;
      let hit = false;
      const n = typeof v === 'number' ? v : null;
      const num = (x) => (x === '' || x == null || isNaN(x) ? x : +x);
      switch (rule.type) {
        case 'cell': {
          const a = num(rule.a), b = num(rule.b);
          if (v == null || v === '') break;
          const cmp = (x, y) => (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)));
          if (typeof a === 'number' && n == null && rule.op !== 'eq' && rule.op !== 'ne') break;
          switch (rule.op) {
            case 'gt': hit = cmp(v, a) > 0; break;
            case 'lt': hit = cmp(v, a) < 0; break;
            case 'ge': hit = cmp(v, a) >= 0; break;
            case 'le': hit = cmp(v, a) <= 0; break;
            case 'eq': hit = String(v).toLowerCase() === String(rule.a).toLowerCase(); break;
            case 'ne': hit = String(v).toLowerCase() !== String(rule.a).toLowerCase(); break;
            case 'between': hit = cmp(v, Math.min(a, b)) >= 0 && cmp(v, Math.max(a, b)) <= 0; break;
          }
          break;
        }
        case 'text': hit = v != null && String(v).toLowerCase().includes(String(rule.a).toLowerCase()); break;
        case 'dup': case 'unique': {
          if (v == null || v === '') break;
          const k = typeof v === 'string' ? v.toLowerCase() : v;
          const cnt = p.cnt.get(k) || 0;
          hit = rule.type === 'dup' ? cnt > 1 : cnt === 1;
          break;
        }
        case 'top': hit = n != null && n >= p.th; break;
        case 'bottom': hit = n != null && n <= p.th; break;
        case 'above': hit = n != null && n > p.avg; break;
        case 'below': hit = n != null && n < p.avg; break;
        case 'blank': hit = v == null || v === ''; break;
        case 'formula': {
          try {
            const f = shiftFormula(rule.f.replace(/^=/, ''), r - rg.r1, c - rg.c1);
            hit = toBool(evaluate(parse(f), { engine, sheet: si, r, c }));
          } catch { hit = false; }
          break;
        }
        case 'bar':
          if (n != null && p.max != null) {
            const lo = Math.min(0, p.min), span = p.max - lo || 1;
            out = { ...(out || {}), bar: { pct: (n - lo) / span, color: rule.color || '#638ec6' } };
          }
          continue;
        case 'scale2': case 'scale3':
          if (n != null && p.max != null) {
            const cols = rule.colors || (rule.type === 'scale2' ? ['#ffffff', '#63be7b'] : ['#f8696b', '#ffeb84', '#63be7b']);
            const t = p.max === p.min ? 0.5 : (n - p.min) / (p.max - p.min);
            let bg;
            if (cols.length === 2) bg = mix(cols[0], cols[1], t);
            else bg = t < 0.5 ? mix(cols[0], cols[1], t * 2) : mix(cols[1], cols[2], (t - 0.5) * 2);
            out = { ...(out || {}), bg };
          }
          continue;
      }
      if (hit) out = { ...(out || {}), ...rule.style };
    }
    return out;
  };
}

export function describeRule(rule) {
  const opName = { gt: '大于', lt: '小于', ge: '大于或等于', le: '小于或等于', eq: '等于', ne: '不等于', between: '介于' };
  switch (rule.type) {
    case 'cell': return `单元格值 ${opName[rule.op]} ${rule.a}${rule.op === 'between' ? ' 与 ' + rule.b : ''}`;
    case 'text': return `文本包含 "${rule.a}"`;
    case 'dup': return '重复值';
    case 'unique': return '唯一值';
    case 'top': return `前 ${rule.n}${rule.percent ? '%' : ' 项'}`;
    case 'bottom': return `后 ${rule.n}${rule.percent ? '%' : ' 项'}`;
    case 'above': return '高于平均值';
    case 'below': return '低于平均值';
    case 'bar': return '数据条';
    case 'scale2': case 'scale3': return '色阶';
    case 'formula': return '公式：' + rule.f;
    case 'blank': return '空值';
  }
  return rule.type;
}
export { key };
