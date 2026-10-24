// 演示应用入口（类 PowerPoint）
import './slides.css';
import { ensureRenderCSS } from './render.js';
import { TEMPLATES, buildTemplate } from './templates.js';
import { createEditor } from './editor.js';
import { importPptx } from './io.js';

ensureRenderCSS();

export default {
  templates: TEMPLATES,
  createContent: (templateId) => buildTemplate(templateId),
  accept: '.pptx',
  async importFile(file) {
    if (!/\.pptx$/i.test(file.name)) throw new Error('仅支持导入 .pptx 格式（旧版 .ppt 请先另存为 .pptx）');
    const deck = await importPptx(file);
    return { name: file.name.replace(/\.[^.]+$/, ''), content: deck };
  },
  mount(root, file, ctx) {
    root.classList.add('sl-app');
    return createEditor(root, file, ctx);
  },
};
