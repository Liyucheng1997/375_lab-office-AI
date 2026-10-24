// 应用注册表。每个应用模块默认导出：
// {
//   templates: [{ id, name, desc, preview? }],      // 新建模板，第一个应为 'blank'
//   createContent(templateId) -> content,           // 生成可 JSON 序列化的初始内容
//   accept: '.docx,.txt',                           // 可导入的本地文件扩展名
//   async importFile(file: File) -> { name, content },
//   mount(root: HTMLElement, file, ctx) -> instance
// }
// instance: { getContent(), onShow?(), onHide?(), destroy?(), print?(), exports?: [{ label, icon, run(name) }] }
// ctx: { markDirty(), save(), rename(name), getName(), openBackstage(), close() }

export const APPS = {
  doc: { type: 'doc', name: '文字', full: '文字文档', en: 'Write', color: '#0071e3', icon: 'file-text', ext: 'docx', load: () => import('../apps/writer/index.js') },
  sheet: { type: 'sheet', name: '表格', full: '表格', en: 'Sheet', color: '#248a3d', icon: 'sheet', ext: 'xlsx', load: () => import('../apps/sheet/index.js') },
  slide: { type: 'slide', name: '演示', full: '演示文稿', en: 'Slide', color: '#c93400', icon: 'presentation', ext: 'pptx', load: () => import('../apps/slides/index.js') },
};

const cache = {};
export async function loadApp(type) {
  if (!cache[type]) cache[type] = APPS[type].load().then((m) => m.default);
  return cache[type];
}

/** 根据文件扩展名判断用哪个应用导入 */
export function typeForFile(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  if (['docx', 'doc', 'txt', 'md', 'html', 'htm', 'rtf'].includes(ext)) return 'doc';
  if (['xlsx', 'xls', 'csv', 'ods', 'tsv'].includes(ext)) return 'sheet';
  if (['pptx', 'ppt'].includes(ext)) return 'slide';
  return null;
}

export function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return '今天 ' + hm;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return '昨天 ' + hm;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatSize(n) {
  if (!n) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
