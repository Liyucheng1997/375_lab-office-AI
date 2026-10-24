// 表格的 AI 助手接入：把工作簿操作包装成工具，交给共享的助手面板
import { h, toast } from '../../core/ui.js';
import { createAssistant } from '../../ai/panel.js';
import { key, addr, rangeStr, parseRange, colIndex, colName, intersects, MAX_ROWS, MAX_COLS } from './refs.js';
import { formatValue, isErr, NUMBER_FORMATS } from './format.js';
import { shiftFormula } from './formula.js';
import { FUNCTIONS } from './functions.js';
import { newSheet, oid } from './model.js';
import { CF_STYLES } from './cf.js';
import * as cmd from './commands.js';

const READ_LIMIT = 2000; // 每次读取的单元格上限，超出时分页
const CHART_MAP = { column: 'bar', bar: 'hbar', stacked: 'stacked', line: 'line', area: 'area', pie: 'pie', doughnut: 'doughnut', scatter: 'scatter', radar: 'radar' };
const CHART_NAMES = { column: '柱形图', bar: '条形图', stacked: '堆积柱形图', line: '折线图', area: '面积图', pie: '饼图', doughnut: '圆环图', scatter: '散点图', radar: '雷达图' };
const NF_ALIASES = { 常规: 'General', 数值: '0.00', 整数: '0', 千分位: '#,##0', 货币: '¥#,##0.00', 会计专用: NUMBER_FORMATS.find((f) => f.id === 'accounting').fmt, 日期: 'yyyy/m/d', 短日期: 'yyyy/m/d', 长日期: 'yyyy"年"m"月"d"日"', 时间: 'h:mm:ss', 百分比: '0.00%', 分数: '# ?/?', 科学记数: '0.00E+00', 文本: '@' };

export function setupAI(ed) {
  /* ---------- 小工具 ---------- */
  const sheetIndex = (name) => {
    if (name == null || name === '') return ed.si;
    const i = ed.wb.sheets.findIndex((s) => s.name.toLowerCase() === String(name).toLowerCase());
    if (i < 0) throw new Error(`找不到工作表"${name}"。现有：${ed.wb.sheets.map((s) => s.name).join('、')}`);
    return i;
  };
  /** 切到目标工作表（修改只作用于当前表，也让用户看到 AI 在改哪里） */
  const useSheet = (name) => {
    const i = sheetIndex(name);
    if (i !== ed.si) ed.switchSheet(i);
    return i;
  };
  const isEmpty = (si) => !Object.keys(ed.wb.sheets[si].cells).length;
  const usedRange = (si) => {
    const b = ed.engine.bounds[si];
    return isEmpty(si) ? null : { r1: 0, c1: 0, r2: b.maxR, c2: b.maxC };
  };
  const parse = (s, what = '区域') => {
    const rg = typeof s === 'string' ? parseRange(s) : null;
    if (!rg) throw new Error(`无效的${what}"${s}"，请使用 A1、A1:C10、A:C 或 2:5 这样的地址`);
    return rg;
  };
  /** 整行/整列区域裁剪到已用区域，避免处理上百万个单元格 */
  const clip = (rg, si = ed.si) => {
    const b = ed.engine.bounds[si];
    const out = { ...rg };
    if (out.r2 - out.r1 > 5000) out.r2 = Math.max(out.r1, b.maxR);
    if (out.c2 - out.c1 > 500) out.c2 = Math.max(out.c1, b.maxC);
    return out;
  };
  const grow = (rg) => {
    const s = ed.sheet;
    if (rg.r2 >= s.rows) s.rows = Math.min(MAX_ROWS, rg.r2 + 20);
    if (rg.c2 >= s.cols) s.cols = Math.min(MAX_COLS, rg.c2 + 3);
  };
  const shown = (si, r, c) => {
    const v = ed.engine.display(si, r, c);
    const cell = ed.wb.sheets[si].cells[key(r, c)];
    return formatValue(v, cell?.s?.nf).text;
  };
  /** 修改后检查区域里的公式错误，作为结果反馈给模型 */
  const errorsIn = (rg) => {
    const out = [];
    for (let r = rg.r1; r <= rg.r2 && out.length < 10; r++)
      for (let c = rg.c1; c <= rg.c2 && out.length < 10; c++) {
        const v = ed.engine.display(ed.si, r, c);
        if (isErr(v)) out.push(`${addr(r, c)}=${v.code}`);
      }
    return out.length ? `。注意以下单元格计算出错：${out.join('，')}` : '';
  };
  const colsOf = (spec) => {
    const m = String(spec).trim().toUpperCase().replace(/\$/g, '').match(/^([A-Z]{1,3})(?::([A-Z]{1,3}))?$/);
    if (!m) throw new Error(`无效的列"${spec}"，请写成 B 或 A:D`);
    const a = colIndex(m[1]), b = m[2] ? colIndex(m[2]) : a;
    const out = [];
    for (let c = Math.min(a, b); c <= Math.max(a, b); c++) out.push(c);
    return out;
  };
  const toText = (v) => (v == null ? null : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));
  const nfOf = (spec) => {
    if (spec == null) return undefined;
    if (spec in NF_ALIASES) return NF_ALIASES[spec];
    const byId = NUMBER_FORMATS.find((f) => f.id === spec || f.label === spec);
    return byId ? byId.fmt : spec;
  };

  /* ---------- 工具 ---------- */
  const tools = [
    {
      name: 'list_sheets',
      description: '列出工作簿里的所有工作表：名称、已用区域、冻结窗格、图表数量，以及当前活动的是哪一个。开始处理前、或用户提到其他工作表时使用。',
      input_schema: { type: 'object', properties: {}, required: [] },
      label: () => '查看工作表',
      run() {
        return ed.wb.sheets.map((s, i) => {
          const u = usedRange(i);
          const parts = [`${s.name}${i === ed.si ? '（当前）' : ''}`, u ? `已用区域 ${rangeStr(u)}（${u.r2 + 1} 行 × ${u.c2 + 1} 列）` : '空表'];
          if (s.freeze.r || s.freeze.c) parts.push(`冻结 ${s.freeze.r} 行 ${s.freeze.c} 列`);
          const charts = (s.objects || []).filter((o) => o.kind === 'chart').length;
          if (charts) parts.push(`${charts} 个图表`);
          if (s.merges.length) parts.push(`${s.merges.length} 处合并单元格`);
          return parts.join('，');
        }).join('\n');
      },
    },
    {
      name: 'read_range',
      description: '读取单元格内容。返回每行的值；公式显示为"=公式 → 计算结果"；附带非常规的数字格式和合并单元格。不填 range 时读取整个已用区域。数据很多时会分页，结果里会告诉你下一页该读哪个区域。',
      input_schema: {
        type: 'object',
        properties: {
          sheet: { type: 'string', description: '工作表名称，省略表示当前工作表' },
          range: { type: 'string', description: 'A1 表示法，如 "A1:F20"、"B:B"（整列）、"3:5"（整行）。省略则读取已用区域' },
        },
        required: [],
      },
      label: (i) => `读取 ${i.range || '数据'}`,
      run({ sheet, range }) {
        const si = sheetIndex(sheet);
        const sh = ed.wb.sheets[si];
        let rg = range ? clip(parse(range), si) : usedRange(si);
        if (rg && range) {
          // 超出已用区域的空白行列不返回
          const b = ed.engine.bounds[si];
          rg = { ...rg, r2: Math.min(rg.r2, Math.max(b.maxR, rg.r1)), c2: Math.min(rg.c2, Math.max(b.maxC, rg.c1)) };
        }
        if (!rg) return `工作表"${sh.name}"是空的。`;
        const cols = rg.c2 - rg.c1 + 1, rows = rg.r2 - rg.r1 + 1;
        const maxRows = Math.max(1, Math.floor(READ_LIMIT / cols));
        const r2 = Math.min(rg.r2, rg.r1 + maxRows - 1);
        const lines = [`工作表"${sh.name}" ${rangeStr({ ...rg, r2 })}（共请求 ${rows} 行 × ${cols} 列）`, '行\t' + Array.from({ length: cols }, (_, j) => colName(rg.c1 + j)).join('\t')];
        const formats = {};
        for (let r = rg.r1; r <= r2; r++) {
          const row = [];
          for (let c = rg.c1; c <= rg.c2; c++) {
            const cell = sh.cells[key(r, c)];
            let t = shown(si, r, c);
            if (cell?.f != null) t = `=${cell.f} → ${t}`;
            row.push(t.replace(/\t/g, ' ').replace(/\n/g, '⏎'));
            const nf = cell?.s?.nf;
            if (nf && nf !== 'General') (formats[nf] ||= []).push(addr(r, c));
          }
          lines.push(`${r + 1}\t${row.join('\t')}`);
        }
        const fmtLines = Object.entries(formats).map(([nf, cells]) => `${nf}: ${cells.length > 6 ? `${cells[0]} 等 ${cells.length} 个单元格` : cells.join(',')}`);
        if (fmtLines.length) lines.push('数字格式：' + fmtLines.join('；'));
        const merges = sh.merges.filter((m) => intersects(m, rg)).map(rangeStr);
        if (merges.length) lines.push('合并单元格：' + merges.join('，'));
        if (r2 < rg.r2) lines.push(`（数据较多，本次只返回到第 ${r2 + 1} 行。继续读取请用 range="${rangeStr({ ...rg, r1: r2 + 1 })}"）`);
        return lines.join('\n');
      },
    },
    {
      name: 'write_range',
      description: '从 start 单元格开始按行写入一块二维数据（可一次写入表头和数据）。字符串以 "=" 开头会作为公式；数字请直接给数字；null 表示该格保持不变，"" 表示清空。写入后会切到该工作表并选中写入区域。',
      input_schema: {
        type: 'object',
        properties: {
          sheet: { type: 'string', description: '工作表名称，省略表示当前工作表' },
          start: { type: 'string', description: '左上角单元格，如 "A1"' },
          values: { type: 'array', description: '二维数组，每个子数组是一行', items: { type: 'array', items: { type: ['string', 'number', 'boolean', 'null'] } } },
        },
        required: ['start', 'values'],
      },
      label: (i) => {
        try {
          const s = parseRange(i.start);
          const w = Math.max(1, ...(i.values || []).map((r) => (Array.isArray(r) ? r.length : 1)));
          return `写入 ${rangeStr({ r1: s.r1, c1: s.c1, r2: s.r1 + (i.values?.length || 1) - 1, c2: s.c1 + w - 1 })}`;
        } catch { return '写入数据'; }
      },
      run({ sheet, start, values }) {
        const s0 = parse(start, '起始单元格');
        if (!values.length || !values.every(Array.isArray)) throw new Error('values 必须是二维数组，例如 [["姓名","分数"],["张三",90]]');
        useSheet(sheet);
        const width = Math.max(...values.map((r) => r.length), 1);
        const rg = { r1: s0.r1, c1: s0.c1, r2: s0.r1 + values.length - 1, c2: s0.c1 + width - 1 };
        let n = 0;
        ed.change('AI 写入', () => {
          grow(rg);
          values.forEach((row, i) => row.forEach((v, j) => {
            if (v === null || v === undefined) return;
            ed.writeInput(rg.r1 + i, rg.c1 + j, toText(v));
            n++;
          }));
        });
        ed.selectRange(rg);
        return `已写入 ${rangeStr(rg)}（${n} 个单元格）${errorsIn(rg)}`;
      },
    },
    {
      name: 'set_formula',
      description: '在一个区域里填充同一个公式，像拖动填充柄一样自动调整相对引用。formula 按区域左上角单元格来写，例如在 D2:D20 填 "=B2*C2"，D3 会变成 =B3*C3；用 $ 固定引用（如 $B$1）。',
      input_schema: {
        type: 'object',
        properties: {
          sheet: { type: 'string', description: '工作表名称，省略表示当前工作表' },
          range: { type: 'string', description: '目标区域，如 "D2:D20" 或单个单元格 "E5"' },
          formula: { type: 'string', description: '以左上角单元格为准的公式，如 "=SUM(B2:C2)"' },
        },
        required: ['range', 'formula'],
      },
      label: (i) => `公式 ${i.range}`,
      run({ sheet, range, formula }) {
        useSheet(sheet);
        const rg = clip(parse(range));
        if ((rg.r2 - rg.r1 + 1) * (rg.c2 - rg.c1 + 1) > 20000) throw new Error('区域太大（超过 2 万个单元格），请缩小范围');
        const f = String(formula).trim().replace(/^=/, '');
        if (!f) throw new Error('公式为空');
        ed.change('AI 公式', () => {
          grow(rg);
          for (let r = rg.r1; r <= rg.r2; r++)
            for (let c = rg.c1; c <= rg.c2; c++) ed.writeInput(r, c, '=' + (r === rg.r1 && c === rg.c1 ? f : shiftFormula(f, r - rg.r1, c - rg.c1)));
        });
        ed.selectRange(rg);
        const sample = shown(ed.si, rg.r1, rg.c1);
        return `已在 ${rangeStr(rg)} 填充公式，${addr(rg.r1, rg.c1)} 的结果为 ${sample || '(空)'}${errorsIn(rg)}`;
      },
    },
    {
      name: 'format_range',
      description: '设置区域格式（一次可设多项）：字体、颜色、对齐、数字格式、边框、换行、合并。只传需要改的字段。颜色用 #RRGGBB；fill 传 "none" 清除底色。',
      input_schema: {
        type: 'object',
        properties: {
          sheet: { type: 'string', description: '工作表名称，省略表示当前工作表' },
          range: { type: 'string', description: '如 "A1:F1"' },
          bold: { type: 'boolean' },
          italic: { type: 'boolean' },
          underline: { type: 'boolean' },
          font: { type: 'string', description: '字体名，如 "Microsoft YaHei"' },
          font_size: { type: 'number', description: '字号（磅），默认 11' },
          color: { type: 'string', description: '文字颜色 #RRGGBB' },
          fill: { type: 'string', description: '底色 #RRGGBB，或 "none"' },
          align: { type: 'string', enum: ['left', 'center', 'right'], description: '水平对齐' },
          valign: { type: 'string', enum: ['top', 'middle', 'bottom'], description: '垂直对齐' },
          number_format: { type: 'string', description: '常规/数值/整数/千分位/货币/会计专用/日期/长日期/时间/百分比/分数/科学记数/文本，或 Excel 格式串如 "0.0%"、"#,##0.00"' },
          wrap: { type: 'boolean', description: '自动换行' },
          border: { type: 'string', enum: ['all', 'outer', 'thick_outer', 'bottom', 'none'], description: '边框' },
          border_color: { type: 'string', description: '边框颜色，默认 #BFBFBF' },
          merge: { type: 'boolean', description: 'true 合并区域（只保留左上角内容）；false 取消合并' },
        },
        required: ['range'],
      },
      label: (i) => `设置格式 ${i.range}`,
      run(p) {
        useSheet(p.sheet);
        const rg = clip(parse(p.range));
        const s = ed.sheet;
        const patch = {};
        if (p.bold != null) patch.b = p.bold || null;
        if (p.italic != null) patch.i = p.italic || null;
        if (p.underline != null) patch.u = p.underline || null;
        if (p.font) patch.ff = p.font;
        if (p.font_size) patch.fs = p.font_size;
        if (p.color) patch.fc = p.color;
        if (p.fill) patch.bg = p.fill === 'none' ? null : p.fill;
        if (p.align) patch.ha = p.align;
        if (p.valign) patch.va = p.valign;
        if (p.wrap != null) patch.wrap = p.wrap || null;
        const nf = nfOf(p.number_format);
        if (nf) patch.nf = nf === 'General' ? null : nf;
        ed.change('AI 格式', () => {
          grow(rg);
          for (let r = rg.r1; r <= rg.r2; r++)
            for (let c = rg.c1; c <= rg.c2; c++) {
              if (Object.keys(patch).length) {
                const cell = ed.ensureCell(r, c);
                const st = (cell.s = cell.s || {});
                for (const [k, v] of Object.entries(patch)) { if (v == null) delete st[k]; else st[k] = v; }
              }
              if (p.border) {
                const line = { w: 1, c: p.border_color || '#bfbfbf' };
                const thick = { ...line, w: 2 };
                const cell = ed.ensureCell(r, c);
                cell.s = cell.s || {};
                const bd = { ...(cell.s.bd || {}) };
                const set = (side, v) => { if (v) bd[side] = { ...v }; else delete bd[side]; };
                const top = r === rg.r1, bottom = r === rg.r2, left = c === rg.c1, right = c === rg.c2;
                if (p.border === 'all') { set('t', line); set('b', line); set('l', line); set('r', line); }
                else if (p.border === 'none') { set('t'); set('b'); set('l'); set('r'); }
                else if (p.border === 'bottom') { if (bottom) set('b', line); }
                else {
                  const v = p.border === 'thick_outer' ? thick : line;
                  if (top) set('t', v); if (bottom) set('b', v); if (left) set('l', v); if (right) set('r', v);
                }
                if (Object.keys(bd).length) cell.s.bd = bd; else delete cell.s.bd;
              }
              ed.cleanCell(r, c);
            }
          if (p.merge === true && (rg.r1 !== rg.r2 || rg.c1 !== rg.c2)) {
            for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) {
              if (r === rg.r1 && c === rg.c1) continue;
              const cell = ed.cellAt(r, c);
              if (cell) { delete cell.v; delete cell.f; ed.cleanCell(r, c); }
            }
            s.merges = s.merges.filter((m) => !intersects(m, rg));
            s.merges.push({ ...rg });
          } else if (p.merge === false) s.merges = s.merges.filter((m) => !intersects(m, rg));
        });
        return `已设置 ${rangeStr(rg)} 的格式`;
      },
    },
    {
      name: 'set_column_width',
      description: '设置列宽（像素，默认列宽约 80），或根据内容自动调整列宽（autofit=true）。',
      input_schema: {
        type: 'object',
        properties: {
          sheet: { type: 'string', description: '工作表名称，省略表示当前工作表' },
          columns: { type: 'string', description: '列，如 "B" 或 "A:D"' },
          width: { type: 'number', description: '列宽像素，如 120' },
          autofit: { type: 'boolean', description: 'true 时按内容自动调整，忽略 width' },
        },
        required: ['columns'],
      },
      label: (i) => `${i.autofit ? '自动调整' : '设置'}列宽 ${i.columns}`,
      run({ sheet, columns, width, autofit }) {
        useSheet(sheet);
        const cols = colsOf(columns);
        if (autofit) { cmd.autoFitCols(ed, cols); return `已自动调整 ${columns} 列宽`; }
        if (!(width > 0)) throw new Error('请提供大于 0 的 width，或设置 autofit=true');
        ed.change('AI 列宽', () => { for (const c of cols) ed.sheet.colW[c] = Math.min(1000, width); });
        return `已把 ${columns} 列宽设为 ${width}`;
      },
    },
    {
      name: 'sort_range',
      description: '按一列或多列对区域内的行排序（整行一起移动，公式会随行调整）。',
      input_schema: {
        type: 'object',
        properties: {
          sheet: { type: 'string', description: '工作表名称，省略表示当前工作表' },
          range: { type: 'string', description: '要排序的整块数据区域（含表头时设置 has_header），如 "A1:F30"' },
          by_column: { type: 'string', description: '主排序列字母，如 "C"' },
          ascending: { type: 'boolean', description: 'true 升序（默认），false 降序' },
          then_by: { type: 'array', description: '次要排序列', items: { type: 'object', properties: { column: { type: 'string' }, ascending: { type: 'boolean' } }, required: ['column'] } },
          has_header: { type: 'boolean', description: '第一行是表头时为 true（不参与排序）。省略则自动判断' },
        },
        required: ['range', 'by_column'],
      },
      label: (i) => `排序 ${i.range}`,
      run({ sheet, range, by_column, ascending = true, then_by = [], has_header }) {
        useSheet(sheet);
        const rg = ed.usedPart(clip(parse(range)));
        const keys = [{ c: colsOf(by_column)[0], asc: ascending !== false }, ...then_by.map((k) => ({ c: colsOf(k.column)[0], asc: k.ascending !== false }))];
        for (const k of keys) if (k.c < rg.c1 || k.c > rg.c2) throw new Error(`排序列 ${colName(k.c)} 不在区域 ${rangeStr(rg)} 内`);
        const header = has_header ?? cmd.guessHeader(ed, rg);
        cmd.sortRange(ed, rg, keys, header);
        return `已按 ${keys.map((k) => colName(k.c) + (k.asc ? '升序' : '降序')).join('、')} 排序 ${rangeStr(rg)}${header ? '（第一行作为表头保留）' : ''}`;
      },
    },
    {
      name: 'add_conditional_format',
      description: '添加条件格式：按数值高亮（greater/less/between/equal）、包含文本、重复值、前/后 N 项、高于/低于平均值、数据条、色阶。',
      input_schema: {
        type: 'object',
        properties: {
          sheet: { type: 'string', description: '工作表名称，省略表示当前工作表' },
          range: { type: 'string', description: '如 "C2:C50"' },
          type: { type: 'string', enum: ['greater', 'less', 'between', 'equal', 'text_contains', 'duplicate', 'unique', 'top', 'bottom', 'above_average', 'below_average', 'data_bar', 'color_scale'] },
          value: { description: '比较值；top/bottom 时为项数（默认 10）；text_contains 时为文本' },
          value2: { type: 'number', description: 'between 的上限' },
          style: { type: 'string', enum: ['red', 'yellow', 'green'], description: '高亮样式：浅红深红字 / 黄底深黄字 / 绿底深绿字，默认 red' },
          color: { type: 'string', description: '数据条颜色 #RRGGBB' },
        },
        required: ['range', 'type'],
      },
      label: (i) => `条件格式 ${i.range}`,
      run({ sheet, range, type, value, value2, style = 'red', color }) {
        useSheet(sheet);
        const rg = clip(parse(range));
        const st = CF_STYLES[{ red: 0, yellow: 1, green: 2 }[style] ?? 0].s;
        const rule = { id: Date.now().toString(36), range: rg };
        const needValue = () => { if (value == null || value === '') throw new Error(`${type} 需要提供 value`); };
        switch (type) {
          case 'greater': case 'less': case 'equal': needValue(); Object.assign(rule, { type: 'cell', op: { greater: 'gt', less: 'lt', equal: 'eq' }[type], a: String(value), style: st }); break;
          case 'between': needValue(); if (value2 == null) throw new Error('between 需要 value 和 value2'); Object.assign(rule, { type: 'cell', op: 'between', a: String(value), b: String(value2), style: st }); break;
          case 'text_contains': needValue(); Object.assign(rule, { type: 'text', a: String(value), style: st }); break;
          case 'duplicate': Object.assign(rule, { type: 'dup', style: st }); break;
          case 'unique': Object.assign(rule, { type: 'unique', style: st }); break;
          case 'top': case 'bottom': Object.assign(rule, { type, n: Number(value) || 10, percent: false, style: st }); break;
          case 'above_average': Object.assign(rule, { type: 'above', style: st }); break;
          case 'below_average': Object.assign(rule, { type: 'below', style: st }); break;
          case 'data_bar': Object.assign(rule, { type: 'bar', color: color || '#0071e3' }); break;
          case 'color_scale': Object.assign(rule, { type: 'scale3', colors: ['#f8696b', '#ffeb84', '#63be7b'] }); break;
          default: throw new Error('未知的条件格式类型 ' + type);
        }
        ed.change('AI 条件格式', () => { ed.sheet.cf.push(rule); });
        return `已为 ${rangeStr(rg)} 添加条件格式（${type}）`;
      },
    },
    {
      name: 'create_chart',
      description: '用一块数据区域生成浮动图表。区域首行为系列名、首列为分类标签时效果最好（如 A1:D7 = 表头 + 6 行数据）。',
      input_schema: {
        type: 'object',
        properties: {
          sheet: { type: 'string', description: '工作表名称，省略表示当前工作表' },
          range: { type: 'string', description: '数据区域（含表头和分类列），如 "A1:D7"' },
          type: { type: 'string', enum: Object.keys(CHART_MAP), description: 'column=柱形图，bar=条形图，stacked=堆积柱形，line=折线，area=面积，pie=饼图，doughnut=圆环，scatter=散点，radar=雷达' },
          title: { type: 'string', description: '图表标题' },
        },
        required: ['range', 'type'],
      },
      label: (i) => `插入${CHART_NAMES[i.type] || '图表'}`,
      run({ sheet, range, type, title = '' }) {
        useSheet(sheet);
        const rg = ed.usedPart(clip(parse(range)));
        if (!CHART_MAP[type]) throw new Error('不支持的图表类型 ' + type);
        let hasData = false;
        for (let r = rg.r1; r <= rg.r2 && !hasData; r++) for (let c = rg.c1; c <= rg.c2 && !hasData; c++) hasData = typeof ed.engine.display(ed.si, r, c) === 'number';
        if (!hasData) throw new Error(`区域 ${rangeStr(rg)} 里没有数值，无法绘图`);
        const g = ed.grid;
        const o = { id: oid(), kind: 'chart', type: CHART_MAP[type], src: rg, title, legend: 'bottom', byRow: false, x: g.X(rg.c2 + 1) + 20, y: g.Y(rg.r1), w: 480, h: 300, z: 1 };
        ed.change('AI 图表', () => { (ed.sheet.objects ||= []).push(o); });
        return `已插入${CHART_NAMES[type]}（数据 ${rangeStr(rg)}${title ? `，标题"${title}"` : ''}）`;
      },
    },
    {
      name: 'apply_table_style',
      description: '把一块数据套用表格样式：表头深色加粗白字、隔行底色、细边框，并可加筛选按钮。',
      input_schema: {
        type: 'object',
        properties: {
          sheet: { type: 'string', description: '工作表名称，省略表示当前工作表' },
          range: { type: 'string', description: '含表头的数据区域，如 "A1:F20"' },
          color: { type: 'string', enum: cmd.TABLE_STYLES.map((t) => t.name), description: '配色，默认 蓝灰' },
          filter: { type: 'boolean', description: '是否加筛选按钮，默认 false' },
        },
        required: ['range'],
      },
      label: (i) => `套用表格样式 ${i.range}`,
      run({ sheet, range, color = '蓝灰', filter = false }) {
        useSheet(sheet);
        const rg = ed.usedPart(clip(parse(range)));
        const ts = cmd.TABLE_STYLES.find((t) => t.name === color) || cmd.TABLE_STYLES[5];
        ed.selectRange(rg);
        cmd.applyTableStyle(ed, ts, filter);
        return `已为 ${rangeStr(rg)} 套用"${ts.name}"表格样式`;
      },
    },
    {
      name: 'clear_range',
      description: '清除区域：contents 只清内容，formats 只清格式，all 全部清除。',
      input_schema: {
        type: 'object',
        properties: {
          sheet: { type: 'string', description: '工作表名称，省略表示当前工作表' },
          range: { type: 'string', description: '如 "A10:F20"' },
          what: { type: 'string', enum: ['contents', 'formats', 'all'], description: '默认 contents' },
        },
        required: ['range'],
      },
      label: (i) => `清除 ${i.range}`,
      run({ sheet, range, what = 'contents' }) {
        useSheet(sheet);
        const rg = clip(parse(range));
        ed.selectRange(rg);
        cmd.clear(ed, what);
        return `已清除 ${rangeStr(rg)}（${{ contents: '内容', formats: '格式', all: '全部' }[what]}）`;
      },
    },
    {
      name: 'insert_rows',
      description: '在第 row 行之前插入 count 行（行号从 1 开始），其他公式引用会自动调整。',
      input_schema: { type: 'object', properties: { sheet: { type: 'string' }, row: { type: 'integer', description: '在这一行之前插入，如 5' }, count: { type: 'integer', description: '默认 1' } }, required: ['row'] },
      label: (i) => `插入 ${i.count || 1} 行`,
      run({ sheet, row, count = 1 }) {
        useSheet(sheet);
        if (row < 1 || count < 1) throw new Error('row 和 count 必须 ≥ 1');
        ed.change('AI 插入行', () => cmd.shiftStructure(ed, 'r', row - 1, count), 'book');
        return `已在第 ${row} 行前插入 ${count} 行`;
      },
    },
    {
      name: 'delete_rows',
      description: '从第 row 行开始删除 count 行（行号从 1 开始）。',
      input_schema: { type: 'object', properties: { sheet: { type: 'string' }, row: { type: 'integer' }, count: { type: 'integer', description: '默认 1' } }, required: ['row'] },
      label: (i) => `删除第 ${i.row} 行起 ${i.count || 1} 行`,
      run({ sheet, row, count = 1 }) {
        useSheet(sheet);
        if (row < 1 || count < 1) throw new Error('row 和 count 必须 ≥ 1');
        ed.change('AI 删除行', () => cmd.shiftStructure(ed, 'r', row - 1, -count), 'book');
        return `已删除第 ${row}–${row + count - 1} 行`;
      },
    },
    {
      name: 'insert_columns',
      description: '在 column 列之前插入 count 列。',
      input_schema: { type: 'object', properties: { sheet: { type: 'string' }, column: { type: 'string', description: '列字母，如 "C"' }, count: { type: 'integer', description: '默认 1' } }, required: ['column'] },
      label: (i) => `插入 ${i.count || 1} 列`,
      run({ sheet, column, count = 1 }) {
        useSheet(sheet);
        if (count < 1) throw new Error('count 必须 ≥ 1');
        const c = colsOf(column)[0];
        ed.change('AI 插入列', () => cmd.shiftStructure(ed, 'c', c, count), 'book');
        return `已在 ${colName(c)} 列前插入 ${count} 列`;
      },
    },
    {
      name: 'delete_columns',
      description: '从 column 列开始删除 count 列。',
      input_schema: { type: 'object', properties: { sheet: { type: 'string' }, column: { type: 'string' }, count: { type: 'integer', description: '默认 1' } }, required: ['column'] },
      label: (i) => `删除 ${i.column} 列起 ${i.count || 1} 列`,
      run({ sheet, column, count = 1 }) {
        useSheet(sheet);
        if (count < 1) throw new Error('count 必须 ≥ 1');
        const c = colsOf(column)[0];
        ed.change('AI 删除列', () => cmd.shiftStructure(ed, 'c', c, -count), 'book');
        return `已删除 ${colName(c)}–${colName(c + count - 1)} 列`;
      },
    },
    {
      name: 'freeze_panes',
      description: '冻结前 rows 行和前 columns 列（滚动时保持可见）。两者都为 0 表示取消冻结。',
      input_schema: { type: 'object', properties: { sheet: { type: 'string' }, rows: { type: 'integer' }, columns: { type: 'integer' } }, required: ['rows', 'columns'] },
      label: (i) => (i.rows || i.columns ? `冻结 ${i.rows} 行 ${i.columns} 列` : '取消冻结'),
      run({ sheet, rows, columns }) {
        useSheet(sheet);
        if (rows < 0 || columns < 0) throw new Error('行列数不能为负');
        ed.change('AI 冻结窗格', () => { ed.sheet.freeze = { r: rows, c: columns }; });
        return rows || columns ? `已冻结前 ${rows} 行、前 ${columns} 列` : '已取消冻结';
      },
    },
    {
      name: 'add_sheet',
      description: '新建一个工作表并切换过去。',
      input_schema: { type: 'object', properties: { name: { type: 'string', description: '名称，不超过 31 个字符，不能含 \\ / ? * [ ] :' } }, required: ['name'] },
      label: (i) => `新建工作表"${i.name}"`,
      run({ name }) {
        name = String(name).trim();
        checkSheetName(name);
        const at = ed.wb.sheets.length;
        ed.change('AI 新建工作表', () => { ed.wb.sheets.push(newSheet(name)); }, 'book');
        ed.renderTabs();
        ed.switchSheet(at);
        return `已新建并切换到工作表"${name}"`;
      },
    },
    {
      name: 'rename_sheet',
      description: '重命名工作表，引用它的公式会自动更新。',
      input_schema: { type: 'object', properties: { sheet: { type: 'string', description: '原名称，省略为当前' }, new_name: { type: 'string' } }, required: ['new_name'] },
      label: (i) => `重命名为"${i.new_name}"`,
      run({ sheet, new_name }) {
        const i = sheetIndex(sheet);
        const name = String(new_name).trim();
        checkSheetName(name, i);
        const old = ed.wb.sheets[i].name;
        cmd.renameSheet(ed, i, name);
        return `已把"${old}"重命名为"${name}"`;
      },
    },
    {
      name: 'switch_sheet',
      description: '切换到指定工作表，让用户看到它。',
      input_schema: { type: 'object', properties: { sheet: { type: 'string' } }, required: ['sheet'] },
      label: (i) => `切换到"${i.sheet}"`,
      run({ sheet }) {
        useSheet(sheet);
        return `当前工作表：${ed.sheet.name}`;
      },
    },
  ];

  function checkSheetName(name, self = -1) {
    if (!name) throw new Error('名称不能为空');
    if (/[\\/?*[\]:]/.test(name) || name.length > 31) throw new Error('工作表名称不能包含 \\ / ? * [ ] : 且不超过 31 个字符');
    if (ed.wb.sheets.some((s, j) => j !== self && s.name.toLowerCase() === name.toLowerCase())) throw new Error(`已存在名为"${name}"的工作表`);
  }

  /* ---------- 上下文 ---------- */
  function getContext() {
    const si = ed.si, sh = ed.sheet;
    const u = usedRange(si);
    const rg = ed.range;
    const { r, c } = ed.sel.active;
    const lines = [
      `当前工作表：${sh.name}（工作簿共 ${ed.wb.sheets.length} 个：${ed.wb.sheets.map((s) => s.name).join('、')}）`,
      u ? `已用区域：${rangeStr(u)}（${u.r2 + 1} 行 × ${u.c2 + 1} 列）` : '当前工作表是空的',
      `选区：${ed.sel.ranges.map(rangeStr).join('，')}；活动单元格 ${addr(r, c)}`,
    ];
    const cell = ed.cellAt(r, c);
    if (cell?.f != null) lines.push(`活动单元格公式：=${cell.f}（结果 ${shown(si, r, c)}）`);
    const part = ed.usedPart(rg);
    const items = [];
    for (let i = part.r1; i <= part.r2 && items.length < 20; i++)
      for (let j = part.c1; j <= part.c2 && items.length < 20; j++) {
        const t = shown(si, i, j);
        if (t !== '') items.push(`${addr(i, j)}=${t.slice(0, 40)}`);
      }
    if (items.length && !(rg.r1 === rg.r2 && rg.c1 === rg.c2 && cell?.f != null)) lines.push('选区内容：' + items.join('，') + (items.length >= 20 ? ' …' : ''));
    if (sh.freeze.r || sh.freeze.c) lines.push(`冻结：${sh.freeze.r} 行 ${sh.freeze.c} 列`);
    const charts = (sh.objects || []).filter((o) => o.kind === 'chart');
    if (charts.length) lines.push(`图表：${charts.map((o) => `${o.title || '无标题'}（${rangeStr(o.src)}）`).join('，')}`);
    return lines.join('\n');
  }

  const systemPrompt = `当前应用：表格（电子表格，类似 Excel）。

处理表格时：
- 分析、改写已有数据前先用 read_range 读取，不要凭 document_state 里的摘要猜数据。
- 能用公式就用公式（合计、平均、占比、排名、查找等），不要把自己算好的数字写死；写入后检查工具返回的错误提示并修正。
- 新建表格要整洁：第一行是表头并加粗、加底色；数值设合适的数字格式（金额用千分位或货币，比例用百分比）；最后用 set_column_width 自动调整列宽。一次 write_range 写入整块数据，而不是逐格写。
- 生成示例数据时，在回复里说明这是示例数据。
- 分析结论用简短要点说明，关键数字写出来；需要时可以把结论写进表格或做图表。
- 地址用 A1 表示法（列字母 + 行号，行号从 1 开始）。

公式引擎支持的函数（只用这些）：${Object.keys(FUNCTIONS).sort().join(', ')}
公式语法与 Excel 相同：引用其他工作表写作 Sheet2!A1 或 '销售 数据'!A1:B5，绝对引用用 $。`;

  /* ---------- 回复里的表格写入选区 ---------- */
  function parseTable(text) {
    const lines = text.split('\n');
    const md = lines.filter((l) => /^\s*\|.*\|\s*$/.test(l) && !/^\s*\|?\s*:?-{2,}/.test(l));
    if (md.length >= 1) return md.map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim().replace(/\*\*(.*?)\*\*/g, '$1')));
    const tsv = lines.filter((l) => l.includes('\t'));
    if (tsv.length) return tsv.map((l) => l.split('\t'));
    return null;
  }
  function writeReplyTable(text) {
    const rows = parseTable(text);
    if (!rows) { toast('回复里没有找到表格', 'error'); return; }
    const { r, c } = ed.sel.active;
    const w = Math.max(...rows.map((x) => x.length));
    const rg = { r1: r, c1: c, r2: r + rows.length - 1, c2: c + w - 1 };
    ed.change('写入 AI 表格', () => {
      grow(rg);
      rows.forEach((row, i) => row.forEach((v, j) => ed.writeInput(r + i, c + j, v)));
    });
    ed.selectRange(rg);
    toast(`已写入 ${rangeStr(rg)}`, 'success');
  }

  let ai;
  const prefill = (text) => () => { ai.open(text); return null; };
  ai = createAssistant({
    appName: '表格',
    systemPrompt,
    tools,
    getContext,
    placeholder: '让 AI 写公式、分析数据、做图表…',
    quickActions: [
      { label: '分析这些数据', icon: 'chart-no-axes-combined', prompt: '请分析当前工作表（若有选区则分析选区）的数据：先读取数据，给出关键发现、趋势和异常，用简洁的要点总结。' },
      { label: '生成公式', icon: 'sigma', prompt: prefill('请在选区写一个公式：') },
      { label: '制作图表', icon: 'chart-column', prompt: '根据当前数据（选区或已用区域）选择最合适的图表类型制作一个图表，并起一个清楚的标题。' },
      { label: '美化表格', icon: 'paintbrush', prompt: '美化当前表格：表头加粗并加底色，设置合适的数字格式、对齐和边框，自动调整列宽，保持简洁专业。' },
      { label: '汇总统计', icon: 'calculator', prompt: '为当前数据添加汇总：在合适位置加合计、平均值等汇总行或列，用公式实现而不是写死数字。' },
      { label: '清洗数据', icon: 'eraser', prompt: '清洗当前数据：去掉首尾空格、删除完全重复的行、统一日期和数字格式。完成后告诉我改了哪些。' },
      { label: '解释公式', icon: 'circle-help', prompt: '解释活动单元格里的公式是怎么计算的，用通俗的语言逐部分说明，并说明当前结果的含义。' },
      { label: '生成示例表格', icon: 'table', prompt: prefill('帮我生成一张示例表格：') },
    ],
    messageActions: [{ label: '写入到选区', icon: 'table-2', run: writeReplyTable }],
    onToggle(on) {
      ed.ribbon.setAIActive(on);
      // 网格区域宽度变了：立即重新测量绘制（ResizeObserver 也会触发，这里保证隐藏后台时也生效）
      setTimeout(() => { ed.grid.geoKey = ''; ed.grid.draw(); ed.grid.positionObjects(); ed.positionInput(); }, 0);
    },
  });

  // 布局：编辑栏 + 网格 + 工作表标签 在左，AI 面板在右
  const main = h('div', { class: 'ss-main' });
  const col = h('div', { class: 'ss-col' });
  ed.root.insertBefore(main, ed.fbar);
  col.append(ed.fbar, ed.body, ed.tabsBar);
  main.append(col, ai.el);
  ai.tools = tools; // 便于调试
  return ai;
}
