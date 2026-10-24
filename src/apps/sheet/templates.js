// 表格模板
import { h } from '../../core/ui.js';
import { newWorkbook, newSheet, fillRows, styleRange, borderAll, oid } from './model.js';
import { key } from './refs.js';
import { dateToSerial } from './format.js';

function preview(head, rows, accent) {
  return () => h('div', { class: 'ss-tpl-prev' },
    h('div', { class: 'ss-tpl-title', style: { color: accent } }, head),
    ...rows.map((r, i) => h('div', { class: 'ss-tpl-row', style: i === 0 ? { background: accent, color: '#fff' } : i % 2 ? { background: accent + '18' } : {} },
      ...r.map((c) => h('span', null, c)))));
}

const TITLE = (color = '#1f4e79') => ({ fs: 18, b: true, fc: color, ha: 'center' });
const HEAD = (bg) => ({ bg, fc: '#ffffff', b: true, ha: 'center' });

function account() {
  const wb = newWorkbook();
  const s = wb.sheets[0];
  s.name = '收支明细';
  fillRows(s, 0, 0, [['个人记账本']]);
  s.merges.push({ r1: 0, c1: 0, r2: 0, c2: 6 });
  styleRange(s, 0, 0, 0, 0, TITLE('#c55a11'));
  s.rowH[0] = 44;
  fillRows(s, 1, 0, [['日期', '类别', '摘要', '收入', '支出', '余额', '备注']]);
  styleRange(s, 1, 0, 1, 6, HEAD('#ed7d31'));
  const rows = [
    [dateToSerial(2026, 10, 1), '工资', '10月工资', 12000, null, null, ''],
    [dateToSerial(2026, 10, 2), '餐饮', '早餐+午餐', null, 45.5, null, ''],
    [dateToSerial(2026, 10, 3), '交通', '地铁月卡', null, 150, null, ''],
    [dateToSerial(2026, 10, 5), '购物', '日用品', null, 268.8, null, '超市'],
    [dateToSerial(2026, 10, 8), '房租', '10月房租', null, 3500, null, ''],
    [dateToSerial(2026, 10, 12), '理财', '基金收益', 356.2, null, null, ''],
    [dateToSerial(2026, 10, 15), '娱乐', '电影票', null, 90, null, '周末'],
    [dateToSerial(2026, 10, 20), '餐饮', '朋友聚餐', null, 420, null, ''],
  ];
  fillRows(s, 2, 0, rows);
  for (let i = 0; i < rows.length; i++) {
    const r = 2 + i;
    s.cells[key(r, 5)] = { f: i === 0 ? `D${r + 1}-E${r + 1}` : `F${r}+D${r + 1}-E${r + 1}` };
  }
  const end = 2 + rows.length;
  fillRows(s, end, 0, [['合计', '', '', `=SUM(D3:D${end})`, `=SUM(E3:E${end})`, `=D${end + 1}-E${end + 1}`, '']]);
  styleRange(s, end, 0, end, 6, { b: true, bg: '#fbe5d6' });
  styleRange(s, 2, 0, end - 1, 0, { nf: 'yyyy/m/d', ha: 'center' });
  styleRange(s, 2, 1, end, 1, { ha: 'center' });
  styleRange(s, 2, 3, end, 5, { nf: '#,##0.00' });
  for (let r = 2; r < end; r++) if ((r - 2) % 2) styleRange(s, r, 0, r, 6, { bg: '#fdf3ec' });
  borderAll(s, 1, 0, end, 6, '#f4b183');
  Object.assign(s.colW, { 0: 100, 1: 80, 2: 150, 3: 100, 4: 100, 5: 110, 6: 120 });
  s.dv.push({ range: { r1: 2, c1: 1, r2: 100, c2: 1 }, type: 'list', list: '工资,理财,餐饮,交通,购物,房租,娱乐,医疗,其他', dropdown: true });
  s.cf.push({ id: 'cf1', range: { r1: 2, c1: 4, r2: end - 1, c2: 4 }, type: 'cell', op: 'gt', a: '400', style: { bg: '#ffc7ce', fc: '#9c0006' } });
  s.freeze = { r: 2, c: 0 };
  // 分类汇总表
  const s2 = newSheet('分类统计');
  fillRows(s2, 0, 0, [['类别', '支出合计', '占比']]);
  styleRange(s2, 0, 0, 0, 2, HEAD('#ed7d31'));
  const cats = ['餐饮', '交通', '购物', '房租', '娱乐'];
  cats.forEach((c, i) => fillRows(s2, i + 1, 0, [[c, `=SUMIF(收支明细!B:B,A${i + 2},收支明细!E:E)`, `=B${i + 2}/SUM($B$2:$B$${cats.length + 1})`]]));
  styleRange(s2, 1, 1, cats.length, 1, { nf: '#,##0.00' });
  styleRange(s2, 1, 2, cats.length, 2, { nf: '0.0%' });
  borderAll(s2, 0, 0, cats.length, 2, '#f4b183');
  Object.assign(s2.colW, { 0: 90, 1: 110, 2: 90 });
  s2.objects.push({ id: oid(), kind: 'chart', type: 'doughnut', src: { r1: 0, c1: 0, r2: cats.length, c2: 1 }, title: '支出构成', legend: 'right', x: 320, y: 10, w: 420, h: 280, z: 1 });
  wb.sheets.push(s2);
  return wb;
}

function sales() {
  const wb = newWorkbook();
  const s = wb.sheets[0];
  s.name = '销售统计';
  fillRows(s, 0, 0, [['2026 年上半年产品销售统计表']]);
  s.merges.push({ r1: 0, c1: 0, r2: 0, c2: 8 });
  styleRange(s, 0, 0, 0, 0, TITLE('#1f4e79'));
  s.rowH[0] = 46;
  fillRows(s, 1, 0, [['产品', '1月', '2月', '3月', '4月', '5月', '6月', '合计', '月均']]);
  styleRange(s, 1, 0, 1, 8, HEAD('#4472c4'));
  const data = [
    ['笔记本电脑', 320, 280, 350, 410, 390, 450],
    ['智能手机', 860, 790, 920, 980, 1050, 1120],
    ['平板电脑', 210, 230, 190, 260, 280, 300],
    ['智能手表', 150, 170, 210, 240, 230, 280],
    ['无线耳机', 540, 610, 580, 650, 700, 760],
  ];
  data.forEach((row, i) => {
    const r = i + 2;
    fillRows(s, r, 0, [[...row, `=SUM(B${r + 1}:G${r + 1})`, `=AVERAGE(B${r + 1}:G${r + 1})`]]);
  });
  const tr = data.length + 2;
  const cols = 'BCDEFGHI';
  fillRows(s, tr, 0, [['总计', ...[...cols].map((c) => `=SUM(${c}3:${c}${tr})`)]]);
  styleRange(s, tr, 0, tr, 8, { b: true, bg: '#d9e1f2' });
  styleRange(s, 2, 1, tr, 7, { nf: '#,##0' });
  styleRange(s, 2, 8, tr, 8, { nf: '#,##0.0' });
  for (let r = 2; r < tr; r++) if (r % 2) styleRange(s, r, 0, r, 8, { bg: '#f2f6fc' });
  borderAll(s, 1, 0, tr, 8, '#8ea9db');
  s.colW[0] = 110;
  s.cf.push({ id: 'cf1', range: { r1: 2, c1: 7, r2: tr - 1, c2: 7 }, type: 'bar', color: '#5b9bd5' });
  fillRows(s, tr + 2, 0, [['最畅销产品', `=INDEX(A3:A${tr},MATCH(MAX(H3:H${tr}),H3:H${tr},0))`], ['环比增长(6月)', `=G${tr + 1}/F${tr + 1}-1`]]);
  styleRange(s, tr + 2, 0, tr + 3, 0, { b: true });
  styleRange(s, tr + 3, 1, tr + 3, 1, { nf: '0.0%' });
  s.objects.push({ id: oid(), kind: 'chart', type: 'bar', src: { r1: 1, c1: 0, r2: tr - 1, c2: 6 }, title: '月度销量对比', legend: 'bottom', x: 20, y: 24 * 13 + 20, w: 720, h: 320, z: 1 });
  return wb;
}

function schedule() {
  const wb = newWorkbook();
  const s = wb.sheets[0];
  s.name = '课程表';
  fillRows(s, 0, 0, [['高一（3）班 课程表']]);
  s.merges.push({ r1: 0, c1: 0, r2: 0, c2: 6 });
  styleRange(s, 0, 0, 0, 0, TITLE('#375623'));
  s.rowH[0] = 46;
  fillRows(s, 1, 0, [['时间', '节次', '星期一', '星期二', '星期三', '星期四', '星期五']]);
  styleRange(s, 1, 0, 1, 6, HEAD('#70ad47'));
  const lessons = [
    ['语文', '数学', '英语', '物理', '化学'], ['数学', '英语', '语文', '化学', '物理'], ['英语', '物理', '数学', '语文', '生物'], ['物理', '化学', '生物', '数学', '英语'],
    ['历史', '地理', '政治', '体育', '音乐'], ['化学', '生物', '体育', '英语', '美术'], ['自习', '自习', '班会', '自习', '自习'],
  ];
  const times = ['8:00-8:45', '8:55-9:40', '10:00-10:45', '10:55-11:40', '14:00-14:45', '14:55-15:40', '16:00-16:45'];
  lessons.forEach((row, i) => fillRows(s, i + 2 + (i >= 4 ? 1 : 0), 0, [[times[i], `第${i + 1}节`, ...row]]));
  fillRows(s, 6, 0, [['午 休']]);
  s.merges.push({ r1: 6, c1: 0, r2: 6, c2: 6 });
  styleRange(s, 6, 0, 6, 6, { bg: '#e2efda', ha: 'center', fc: '#548235', b: true });
  styleRange(s, 2, 0, 9, 6, { ha: 'center' });
  const colors = { 语文: '#fce4d6', 数学: '#ddebf7', 英语: '#fff2cc', 物理: '#e4dfec', 化学: '#e2efda', 生物: '#d9f2f2' };
  for (let r = 2; r <= 9; r++) for (let c = 2; c <= 6; c++) {
    const cell = s.cells[key(r, c)];
    if (cell && colors[cell.v]) cell.s = { ...cell.s, bg: colors[cell.v] };
  }
  styleRange(s, 2, 0, 9, 1, { fc: '#595959' });
  borderAll(s, 1, 0, 9, 6, '#a9d08e');
  for (let r = 1; r <= 9; r++) s.rowH[r] = 34;
  Object.assign(s.colW, { 0: 100, 1: 60, 2: 90, 3: 90, 4: 90, 5: 90, 6: 90 });
  return wb;
}

function project() {
  const wb = newWorkbook();
  const s = wb.sheets[0];
  s.name = '项目进度';
  fillRows(s, 0, 0, [['产品研发项目进度跟踪表']]);
  s.merges.push({ r1: 0, c1: 0, r2: 0, c2: 7 });
  styleRange(s, 0, 0, 0, 0, TITLE('#44546a'));
  s.rowH[0] = 46;
  fillRows(s, 1, 0, [['编号', '任务名称', '负责人', '开始日期', '结束日期', '工期(天)', '完成进度', '状态']]);
  styleRange(s, 1, 0, 1, 7, HEAD('#44546a'));
  const tasks = [
    ['需求调研与分析', '张伟', [2026, 9, 1], [2026, 9, 12], 1],
    ['产品原型设计', '李娜', [2026, 9, 10], [2026, 9, 25], 1],
    ['UI 视觉设计', '王芳', [2026, 9, 20], [2026, 10, 10], 0.85],
    ['前端开发', '刘洋', [2026, 10, 1], [2026, 11, 15], 0.45],
    ['后端开发', '陈杰', [2026, 10, 1], [2026, 11, 20], 0.5],
    ['联调测试', '赵敏', [2026, 11, 16], [2026, 12, 5], 0],
    ['上线发布', '张伟', [2026, 12, 6], [2026, 12, 10], 0],
  ];
  tasks.forEach((t, i) => {
    const r = i + 2, R = r + 1;
    fillRows(s, r, 0, [[`T${String(i + 1).padStart(2, '0')}`, t[0], t[1], dateToSerial(...t[2]), dateToSerial(...t[3]), `=E${R}-D${R}+1`, t[4], `=IF(G${R}>=1,"已完成",IF(G${R}>0,"进行中","未开始"))`]]);
  });
  const end = tasks.length + 1;
  styleRange(s, 2, 3, end, 4, { nf: 'yyyy-mm-dd', ha: 'center' });
  styleRange(s, 2, 6, end, 6, { nf: '0%' });
  styleRange(s, 2, 0, end, 0, { ha: 'center' });
  styleRange(s, 2, 2, end, 2, { ha: 'center' });
  styleRange(s, 2, 5, end, 5, { ha: 'center' });
  styleRange(s, 2, 7, end, 7, { ha: 'center' });
  borderAll(s, 1, 0, end, 7, '#adb9ca');
  Object.assign(s.colW, { 0: 60, 1: 150, 2: 80, 3: 100, 4: 100, 5: 80, 6: 110, 7: 80 });
  s.cf.push({ id: 'cf1', range: { r1: 2, c1: 6, r2: end, c2: 6 }, type: 'bar', color: '#63c384' });
  s.cf.push({ id: 'cf2', range: { r1: 2, c1: 7, r2: end, c2: 7 }, type: 'text', a: '已完成', style: { bg: '#c6efce', fc: '#006100' } });
  s.cf.push({ id: 'cf3', range: { r1: 2, c1: 7, r2: end, c2: 7 }, type: 'text', a: '进行中', style: { bg: '#ffeb9c', fc: '#9c5700' } });
  fillRows(s, end + 2, 1, [['总体进度', `=AVERAGE(G3:G${end + 1})`], ['已完成任务', `=COUNTIF(H3:H${end + 1},"已完成")&" / "&COUNTA(B3:B${end + 1})`]]);
  styleRange(s, end + 2, 1, end + 3, 1, { b: true });
  styleRange(s, end + 2, 2, end + 2, 2, { nf: '0.0%', b: true, fc: '#2f75b5' });
  s.freeze = { r: 2, c: 2 };
  return wb;
}

function staff() {
  const wb = newWorkbook();
  const s = wb.sheets[0];
  s.name = '员工信息';
  fillRows(s, 0, 0, [['工号', '姓名', '性别', '部门', '职位', '入职日期', '工龄(年)', '月薪', '联系电话']]);
  styleRange(s, 0, 0, 0, 8, HEAD('#2f75b5'));
  const people = [
    ['E001', '张伟', '男', '技术部', '技术总监', [2015, 3, 2], 28000, '138****1234'],
    ['E002', '李娜', '女', '产品部', '产品经理', [2018, 7, 16], 18500, '139****2345'],
    ['E003', '王芳', '女', '设计部', 'UI设计师', [2020, 5, 11], 13000, '137****3456'],
    ['E004', '刘洋', '男', '技术部', '前端工程师', [2019, 9, 1], 16000, '136****4567'],
    ['E005', '陈杰', '男', '技术部', '后端工程师', [2017, 11, 20], 19000, '135****5678'],
    ['E006', '赵敏', '女', '测试部', '测试工程师', [2021, 2, 22], 12000, '186****6789'],
    ['E007', '孙磊', '男', '市场部', '市场专员', [2022, 6, 6], 9500, '187****7890'],
    ['E008', '周婷', '女', '人事部', 'HR 经理', [2016, 4, 18], 15000, '188****8901'],
    ['E009', '吴强', '男', '财务部', '会计', [2019, 3, 25], 11000, '189****9012'],
    ['E010', '郑丽', '女', '市场部', '市场经理', [2018, 1, 8], 17000, '158****0123'],
  ];
  people.forEach((p, i) => {
    const R = i + 2;
    fillRows(s, i + 1, 0, [[p[0], p[1], p[2], p[3], p[4], dateToSerial(...p[5]), `=DATEDIF(F${R},TODAY(),"Y")`, p[6], p[7]]]);
  });
  const end = people.length;
  styleRange(s, 1, 5, end, 5, { nf: 'yyyy/m/d' });
  styleRange(s, 1, 7, end, 7, { nf: '¥#,##0' });
  styleRange(s, 1, 0, end, 2, { ha: 'center' });
  styleRange(s, 1, 6, end, 6, { ha: 'center' });
  for (let r = 1; r <= end; r++) if (r % 2 === 0) styleRange(s, r, 0, r, 8, { bg: '#ddebf7' });
  borderAll(s, 0, 0, end, 8, '#9bc2e6');
  Object.assign(s.colW, { 0: 64, 1: 70, 2: 50, 3: 80, 4: 100, 5: 100, 6: 70, 7: 90, 8: 120 });
  s.filter = { r1: 0, c1: 0, r2: end, c2: 8, conds: {} };
  s.freeze = { r: 1, c: 0 };
  s.dv.push({ range: { r1: 1, c1: 2, r2: 200, c2: 2 }, type: 'list', list: '男,女', dropdown: true });
  s.dv.push({ range: { r1: 1, c1: 3, r2: 200, c2: 3 }, type: 'list', list: '技术部,产品部,设计部,测试部,市场部,人事部,财务部', dropdown: true });
  // 统计页
  const s2 = newSheet('部门统计');
  fillRows(s2, 0, 0, [['部门', '人数', '平均月薪', '最高月薪']]);
  styleRange(s2, 0, 0, 0, 3, HEAD('#2f75b5'));
  const depts = ['技术部', '产品部', '设计部', '测试部', '市场部', '人事部', '财务部'];
  depts.forEach((d, i) => fillRows(s2, i + 1, 0, [[d, `=COUNTIF(员工信息!D:D,A${i + 2})`, `=IFERROR(AVERAGEIF(员工信息!D:D,A${i + 2},员工信息!H:H),0)`, `=MAXIFS(员工信息!H:H,员工信息!D:D,A${i + 2})`]]));
  styleRange(s2, 1, 2, depts.length, 3, { nf: '¥#,##0' });
  borderAll(s2, 0, 0, depts.length, 3, '#9bc2e6');
  Object.assign(s2.colW, { 0: 80, 1: 60, 2: 100, 3: 100 });
  s2.objects.push({ id: oid(), kind: 'chart', type: 'pie', src: { r1: 0, c1: 0, r2: depts.length, c2: 1 }, title: '各部门人数', legend: 'right', x: 380, y: 10, w: 400, h: 260, z: 1 });
  wb.sheets.push(s2);
  return wb;
}

export const TEMPLATES = [
  { id: 'blank', name: '空白表格', build: newWorkbook },
  { id: 'account', name: '个人记账本', build: account, preview: preview('个人记账本', [['日期', '类别', '收入', '支出'], ['10/1', '工资', '12000', ''], ['10/2', '餐饮', '', '45.5'], ['10/3', '交通', '', '150']], '#ed7d31') },
  { id: 'sales', name: '销售数据统计', build: sales, preview: preview('销售统计表', [['产品', '1月', '2月', '合计'], ['电脑', '320', '280', '600'], ['手机', '860', '790', '1650'], ['平板', '210', '230', '440']], '#4472c4') },
  { id: 'schedule', name: '课程表', build: schedule, preview: preview('课程表', [['节次', '周一', '周二', '周三'], ['1', '语文', '数学', '英语'], ['2', '数学', '英语', '语文'], ['3', '英语', '物理', '数学']], '#70ad47') },
  { id: 'project', name: '项目进度表', build: project, preview: preview('项目进度跟踪', [['任务', '负责人', '进度', '状态'], ['需求', '张伟', '100%', '完成'], ['设计', '王芳', '85%', '进行'], ['开发', '刘洋', '45%', '进行']], '#44546a') },
  { id: 'staff', name: '员工信息表', build: staff, preview: preview('员工信息表', [['工号', '姓名', '部门', '月薪'], ['E001', '张伟', '技术部', '28000'], ['E002', '李娜', '产品部', '18500'], ['E003', '王芳', '设计部', '13000']], '#2f75b5') },
];
