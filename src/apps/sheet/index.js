// 表格应用入口
import './sheet.css';
import { SheetEditor } from './editor.js';
import { TEMPLATES } from './templates.js';
import { importFile, exportXLSX, exportCSV, exportHTML } from './io.js';
import { printSheet } from './commands.js';
import { setupAI } from './ai.js';

export default {
  templates: TEMPLATES.map(({ id, name, preview }) => ({ id, name, preview })),
  createContent(templateId = 'blank') {
    const t = TEMPLATES.find((x) => x.id === templateId) || TEMPLATES[0];
    return t.build();
  },
  accept: '.xlsx,.xls,.ods,.csv,.tsv',
  importFile,
  mount(root, file, ctx) {
    const ed = new SheetEditor(root, file, ctx);
    const ai = (ed.ai = setupAI(ed));
    return {
      getContent: () => ed.getContent(),
      onShow: () => ed.onShow(),
      onHide: () => { if (ed.editing) ed.commitEdit(); },
      destroy: () => { ai.destroy(); ed.destroy(); },
      print: () => printSheet(ed),
      exports: [
        { label: 'Excel 工作簿 (.xlsx)', icon: 'file-spreadsheet', desc: '包含所有工作表的数据、公式、合并单元格与列宽', run: (name) => exportXLSX(ed, name, 'xlsx') },
        { label: 'OpenDocument 表格 (.ods)', icon: 'file-spreadsheet', desc: '适用于 LibreOffice / WPS', run: (name) => exportXLSX(ed, name, 'ods') },
        { label: 'CSV (逗号分隔) (.csv)', icon: 'file-text', desc: '仅导出当前工作表的数据', run: (name) => exportCSV(ed, name) },
        { label: '网页 (.html)', icon: 'file-code', desc: '带格式的 HTML 表格', run: (name) => exportHTML(ed, name) },
        { label: 'PDF（通过打印）', icon: 'file-down', desc: '在打印对话框中选择"另存为 PDF"', run: () => printSheet(ed) },
      ],
      ai,
      _editor: ed,
    };
  },
};
