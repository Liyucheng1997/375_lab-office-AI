// 演示主题：背景、字体、配色与装饰图形。
// decor(W, H, cover) 返回装饰 SVG 字符串（cover=true 表示标题/节标题页）。

const svg = (W, H, inner) => `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

export const THEMES = [
  {
    id: 'office', name: '默认', bg: { type: 'solid', color: '#ffffff' },
    titleFont: 'Microsoft YaHei', bodyFont: 'Microsoft YaHei',
    colors: { title: '#1f2329', text: '#333333', accent: ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'] },
    decor: () => '',
  },
  {
    id: 'blue', name: '简约蓝', bg: { type: 'solid', color: '#ffffff' },
    titleFont: 'Microsoft YaHei', bodyFont: 'Microsoft YaHei',
    colors: { title: '#1e3a8a', text: '#334155', accent: ['#2563eb', '#0ea5e9', '#6366f1', '#14b8a6', '#f59e0b', '#64748b'] },
    decor: (W, H, cover) => cover
      ? svg(W, H, `<rect x="0" y="0" width="${W}" height="${H}" fill="#eff6ff"/><path d="M0 ${H * 0.72} Q ${W * 0.35} ${H * 0.58} ${W * 0.62} ${H * 0.78} T ${W} ${H * 0.7} V ${H} H0Z" fill="#2563eb" opacity=".9"/><path d="M0 ${H * 0.82} Q ${W * 0.4} ${H * 0.7} ${W * 0.7} ${H * 0.88} T ${W} ${H * 0.82} V ${H} H0Z" fill="#1e3a8a"/><circle cx="${W * 0.9}" cy="${H * 0.15}" r="${H * 0.09}" fill="#bfdbfe"/>`)
      : svg(W, H, `<rect x="0" y="0" width="${W * 0.012}" height="${H}" fill="#2563eb"/><rect x="0" y="${H - 6}" width="${W}" height="6" fill="#dbeafe"/><rect x="${W * 0.06}" y="${H * 0.19}" width="${W * 0.08}" height="4" fill="#2563eb"/>`),
  },
  {
    id: 'navy', name: '商务深蓝', bg: { type: 'gradient', color: '#0b1d3a', color2: '#163a6b', angle: 135 },
    titleFont: 'Microsoft YaHei', bodyFont: 'Microsoft YaHei',
    colors: { title: '#ffffff', text: '#dbe4f3', accent: ['#d4a64a', '#4f8fe6', '#7dd3fc', '#f0c674', '#94a3b8', '#60a5fa'] },
    decor: (W, H, cover) => cover
      ? svg(W, H, `<rect x="${W * 0.1}" y="${H * 0.535}" width="${W * 0.8}" height="2" fill="#d4a64a"/><polygon points="${W * 0.78},0 ${W},0 ${W},${H * 0.4}" fill="#d4a64a" opacity=".85"/><polygon points="0,${H} ${W * 0.22},${H} 0,${H * 0.6}" fill="#d4a64a" opacity=".5"/>`)
      : svg(W, H, `<rect x="${W * 0.06}" y="${H * 0.19}" width="${W * 0.88}" height="1.5" fill="#d4a64a" opacity=".8"/><polygon points="${W * 0.9},0 ${W},0 ${W},${H * 0.16}" fill="#d4a64a"/>`),
  },
  {
    id: 'orange', name: '活力橙', bg: { type: 'solid', color: '#fffaf5' },
    titleFont: 'Microsoft YaHei', bodyFont: 'Microsoft YaHei',
    colors: { title: '#c2410c', text: '#3f3f46', accent: ['#f97316', '#fb923c', '#facc15', '#ef4444', '#a3a3a3', '#0ea5e9'] },
    decor: (W, H, cover) => cover
      ? svg(W, H, `<circle cx="${W * 0.95}" cy="${H * 0.05}" r="${H * 0.45}" fill="#f97316"/><circle cx="${W * 0.82}" cy="${H * 0.12}" r="${H * 0.18}" fill="#fdba74" opacity=".9"/><circle cx="${W * 0.04}" cy="${H * 0.98}" r="${H * 0.22}" fill="#fed7aa"/>`)
      : svg(W, H, `<rect x="0" y="0" width="${W}" height="${H * 0.025}" fill="#f97316"/><circle cx="${W * 0.985}" cy="${H * 0.96}" r="${H * 0.12}" fill="#fed7aa"/>`),
  },
  {
    id: 'green', name: '清新绿', bg: { type: 'gradient', color: '#f0fdf4', color2: '#ffffff', angle: 180 },
    titleFont: 'Microsoft YaHei', bodyFont: 'Microsoft YaHei',
    colors: { title: '#166534', text: '#334155', accent: ['#22c55e', '#10b981', '#84cc16', '#14b8a6', '#eab308', '#0ea5e9'] },
    decor: (W, H, cover) => cover
      ? svg(W, H, `<ellipse cx="${W * 0.08}" cy="${H * 0.12}" rx="${W * 0.18}" ry="${H * 0.22}" fill="#bbf7d0"/><ellipse cx="${W * 0.94}" cy="${H * 0.88}" rx="${W * 0.2}" ry="${H * 0.28}" fill="#86efac" opacity=".8"/><ellipse cx="${W * 0.86}" cy="${H * 0.95}" rx="${W * 0.1}" ry="${H * 0.12}" fill="#22c55e" opacity=".6"/>`)
      : svg(W, H, `<ellipse cx="${W}" cy="${H}" rx="${W * 0.12}" ry="${H * 0.16}" fill="#bbf7d0"/><rect x="${W * 0.06}" y="${H * 0.19}" width="${W * 0.05}" height="4" rx="2" fill="#22c55e"/>`),
  },
  {
    id: 'tech', name: '科技暗黑', bg: { type: 'gradient', color: '#0f172a', color2: '#020617', angle: 160 },
    titleFont: 'Microsoft YaHei', bodyFont: 'Microsoft YaHei',
    colors: { title: '#e0f2fe', text: '#cbd5e1', accent: ['#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#fbbf24', '#60a5fa'] },
    decor: (W, H, cover) => {
      let grid = '';
      for (let x = 0; x <= W; x += 48) grid += `<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`;
      for (let y = 0; y <= H; y += 48) grid += `<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`;
      return svg(W, H, `<g stroke="#22d3ee" stroke-opacity=".07" stroke-width="1">${grid}</g>` + (cover
        ? `<circle cx="${W * 0.82}" cy="${H * 0.5}" r="${H * 0.32}" fill="none" stroke="#22d3ee" stroke-opacity=".5" stroke-width="2"/><circle cx="${W * 0.82}" cy="${H * 0.5}" r="${H * 0.22}" fill="none" stroke="#a78bfa" stroke-opacity=".5" stroke-width="1.5" stroke-dasharray="6 6"/><rect x="${W * 0.08}" y="${H * 0.62}" width="${W * 0.12}" height="3" fill="#22d3ee"/>`
        : `<rect x="${W * 0.06}" y="${H * 0.19}" width="${W * 0.1}" height="3" fill="#22d3ee"/><rect x="${W * 0.16}" y="${H * 0.19}" width="${W * 0.04}" height="3" fill="#a78bfa"/>`));
    },
  },
  {
    id: 'red', name: '典雅红', bg: { type: 'solid', color: '#fdf8f1' },
    titleFont: 'SimSun', bodyFont: 'Microsoft YaHei',
    colors: { title: '#9f1239', text: '#44403c', accent: ['#be123c', '#d97706', '#78716c', '#e11d48', '#a16207', '#57534e'] },
    decor: (W, H, cover) => cover
      ? svg(W, H, `<rect x="${W * 0.03}" y="${H * 0.05}" width="${W * 0.94}" height="${H * 0.9}" fill="none" stroke="#be123c" stroke-width="2"/><rect x="${W * 0.04}" y="${H * 0.07}" width="${W * 0.92}" height="${H * 0.86}" fill="none" stroke="#d97706" stroke-width=".8"/><rect x="0" y="${H * 0.82}" width="${W}" height="${H * 0.18}" fill="#be123c" opacity=".08"/>`)
      : svg(W, H, `<rect x="0" y="0" width="${W}" height="${H * 0.02}" fill="#be123c"/><rect x="0" y="${H * 0.02}" width="${W}" height="2" fill="#d97706"/><rect x="${W * 0.06}" y="${H * 0.19}" width="${W * 0.88}" height="1" fill="#be123c" opacity=".4"/>`),
  },
  {
    id: 'purple', name: '渐变紫', bg: { type: 'gradient', color: '#6d28d9', color2: '#db2777', angle: 135 },
    titleFont: 'Microsoft YaHei', bodyFont: 'Microsoft YaHei',
    colors: { title: '#ffffff', text: '#f5f3ff', accent: ['#fde047', '#f9a8d4', '#c4b5fd', '#67e8f9', '#fdba74', '#ffffff'] },
    decor: (W, H, cover) => cover
      ? svg(W, H, `<circle cx="${W * 0.88}" cy="${H * 0.2}" r="${H * 0.3}" fill="#ffffff" opacity=".1"/><circle cx="${W * 0.1}" cy="${H * 0.9}" r="${H * 0.25}" fill="#ffffff" opacity=".08"/><circle cx="${W * 0.7}" cy="${H * 0.95}" r="${H * 0.1}" fill="#fde047" opacity=".35"/>`)
      : svg(W, H, `<circle cx="${W * 0.97}" cy="${H * 0.05}" r="${H * 0.18}" fill="#ffffff" opacity=".1"/><rect x="${W * 0.06}" y="${H * 0.19}" width="${W * 0.06}" height="4" rx="2" fill="#fde047"/>`),
  },
  {
    id: 'gray', name: '学术灰', bg: { type: 'solid', color: '#f5f5f4' },
    titleFont: 'Georgia', bodyFont: 'Microsoft YaHei',
    colors: { title: '#1c1917', text: '#44403c', accent: ['#0f766e', '#b45309', '#475569', '#7c3aed', '#be123c', '#0369a1'] },
    decor: (W, H, cover) => cover
      ? svg(W, H, `<rect x="0" y="0" width="${W * 0.35}" height="${H}" fill="#0f766e"/><rect x="${W * 0.35}" y="0" width="6" height="${H}" fill="#b45309"/>`)
      : svg(W, H, `<rect x="0" y="${H - H * 0.06}" width="${W}" height="${H * 0.06}" fill="#0f766e"/><rect x="${W * 0.06}" y="${H * 0.19}" width="${W * 0.88}" height="1" fill="#a8a29e"/>`),
  },
  {
    id: 'mono', name: '极简黑白', bg: { type: 'solid', color: '#111111' },
    titleFont: 'Microsoft YaHei', bodyFont: 'Microsoft YaHei',
    colors: { title: '#ffffff', text: '#d4d4d4', accent: ['#ffffff', '#a3a3a3', '#facc15', '#737373', '#e5e5e5', '#525252'] },
    decor: (W, H, cover) => cover
      ? svg(W, H, `<rect x="${W * 0.1}" y="${H * 0.7}" width="${W * 0.06}" height="6" fill="#facc15"/>`)
      : svg(W, H, `<rect x="${W * 0.94}" y="${H * 0.06}" width="${W * 0.02}" height="${W * 0.02}" fill="#facc15"/>`),
  },
];

export function getTheme(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

/** 在主题强调色上做明暗变化 */
export function shade(hex, amt) {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  r = f(r); g = f(g); b = f(b);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
