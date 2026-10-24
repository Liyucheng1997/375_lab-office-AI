// 文字（Word 类）应用入口
import { TEMPLATES, makeContent } from './templates.js';
import { importWriterFile } from './io.js';
import { mountWriter } from './editor.js';

export default {
  templates: TEMPLATES,
  createContent: (templateId) => makeContent(templateId),
  accept: '.docx,.txt,.md,.markdown,.html,.htm',
  importFile: importWriterFile,
  mount: mountWriter,
};
