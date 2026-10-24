// 图表：用 Chart.js 在离屏 canvas 上绘制并缓存为图片（便于缩略图、放映、导出复用）。
import Chart from 'chart.js/auto';

export const CHART_TYPES = [
  { value: 'bar', label: '柱形图' },
  { value: 'hbar', label: '条形图' },
  { value: 'line', label: '折线图' },
  { value: 'area', label: '面积图' },
  { value: 'pie', label: '饼图' },
  { value: 'doughnut', label: '圆环图' },
  { value: 'radar', label: '雷达图' },
];

export function defaultChartData() {
  return {
    labels: ['第一季度', '第二季度', '第三季度', '第四季度'],
    series: [
      { name: '系列 1', values: [4.3, 2.5, 3.5, 4.5] },
      { name: '系列 2', values: [2.4, 4.4, 1.8, 2.8] },
      { name: '系列 3', values: [2, 2, 3, 5] },
    ],
  };
}

const cache = new Map();

function keyOf(el, colors, textColor) {
  return JSON.stringify([el.chartType, el.data, Math.round(el.w), Math.round(el.h), el.chartTitle, el.legend !== false, colors, textColor]);
}

export function chartSrcSync(el, colors, textColor) {
  return cache.get(keyOf(el, colors, textColor)) || null;
}

function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function chartSrc(el, colors, textColor = '#333') {
  const key = keyOf(el, colors, textColor);
  if (cache.has(key)) return cache.get(key);
  const w = Math.max(40, Math.round(el.w)), h = Math.max(40, Math.round(el.h));
  const canvas = document.createElement('canvas');
  canvas.width = w * 2;
  canvas.height = h * 2;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const t = el.chartType || 'bar';
  const pie = t === 'pie' || t === 'doughnut';
  const type = t === 'hbar' ? 'bar' : t === 'area' ? 'line' : t;
  const data = el.data || defaultChartData();
  const datasets = (pie ? data.series.slice(0, 1) : data.series).map((s, i) => {
    const c = colors[i % colors.length];
    return {
      label: s.name,
      data: s.values.map(Number),
      backgroundColor: pie ? data.labels.map((_, j) => colors[j % colors.length]) : t === 'area' || t === 'radar' ? alpha(c, 0.35) : c,
      borderColor: pie ? '#ffffff' : c,
      borderWidth: pie ? 2 : t === 'line' || t === 'area' || t === 'radar' ? 3 : 0,
      fill: t === 'area' || t === 'radar',
      tension: 0.3,
      pointRadius: t === 'line' ? 4 : 2,
    };
  });
  const fontSize = Math.max(10, Math.min(16, Math.round(Math.min(w, h) / 22)));
  let url;
  try {
    const chart = new Chart(canvas, {
      type,
      data: { labels: data.labels, datasets },
      options: {
        responsive: false,
        animation: false,
        devicePixelRatio: 2,
        indexAxis: t === 'hbar' ? 'y' : 'x',
        color: textColor,
        font: { size: fontSize, family: 'Microsoft YaHei' },
        plugins: {
          legend: { display: el.legend !== false, position: pie ? 'right' : 'bottom', labels: { color: textColor, font: { size: fontSize } } },
          title: { display: !!el.chartTitle, text: el.chartTitle || '', color: textColor, font: { size: fontSize + 4, weight: 'bold' } },
        },
        scales: pie ? {} : t === 'radar'
          ? { r: { ticks: { color: textColor, backdropColor: 'transparent' }, grid: { color: alpha('#888888', 0.3) }, angleLines: { color: alpha('#888888', 0.3) }, pointLabels: { color: textColor, font: { size: fontSize } } } }
          : {
            x: { ticks: { color: textColor, font: { size: fontSize } }, grid: { display: t === 'hbar', color: alpha('#888888', 0.25) } },
            y: { ticks: { color: textColor, font: { size: fontSize } }, grid: { display: t !== 'hbar', color: alpha('#888888', 0.25) }, beginAtZero: true },
          },
      },
    });
    url = canvas.toDataURL('image/png');
    chart.destroy();
  } catch (e) {
    console.error('图表渲染失败', e);
    url = '';
  }
  cache.set(key, url);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return url;
}

/** 数据 <-> 表格文本（制表符/逗号分隔），首行为类别 */
export function dataToText(data) {
  const head = ['系列', ...data.labels].join('\t');
  return [head, ...data.series.map((s) => [s.name, ...s.values].join('\t'))].join('\n');
}
export function textToData(text) {
  const rows = text.trim().split(/\r?\n/).map((r) => r.split(/\t|,/).map((c) => c.trim()));
  if (rows.length < 2) throw new Error('至少需要一行类别和一行数据');
  const labels = rows[0].slice(1);
  const series = rows.slice(1).map((r) => ({ name: r[0] || '系列', values: labels.map((_, i) => Number(r[i + 1]) || 0) }));
  return { labels, series };
}
