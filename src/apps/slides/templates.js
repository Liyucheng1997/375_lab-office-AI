// 演示模板
import { newDeck, newSlide, fill, shapeEl, textEl, tableFrom, chartEl, linesToHtml, uid, dims } from './model.js';
import { slideThumb } from './render.js';
import { getTheme } from './themes.js';

function S(deck, layout, { title, subtitle, body, body2, notes, transition } = {}) {
  const s = newSlide(layout, deck);
  if (title != null) fill(s, 'title', title);
  if (subtitle != null) fill(s, 'subtitle', subtitle);
  if (body != null) fill(s, 'body', body, 0);
  if (body2 != null) fill(s, 'body', body2, 1);
  s.notes = notes || '';
  if (transition) s.transition = { type: transition, duration: 0.7 };
  deck.slides.push(s);
  return s;
}

function animate(slide, el, effect = 'fade', trigger = 'click', duration = 0.5) {
  slide.animations.push({ id: uid(), elId: el.id, effect, trigger, duration, delay: 0 });
}

/** 目录页：编号圆 + 文本 */
function toc(deck, title, items, transition) {
  const s = S(deck, 'titleOnly', { title, transition });
  const th = getTheme(deck.theme);
  const { w } = dims(deck);
  const cols = items.length > 4 ? 2 : 1;
  items.forEach((t, i) => {
    const col = cols === 2 ? i % 2 : 0, row = cols === 2 ? Math.floor(i / 2) : i;
    const x = 90 + col * (w / 2 - 20), y = 140 + row * 82;
    const c = shapeEl('ellipse', { x, y, w: 54, h: 54, fill: { type: 'solid', color: th.colors.accent[i % 3] }, html: `<div>0${i + 1}</div>`, style: { fontSize: 18, bold: true } });
    const tx = textEl({ x: x + 70, y: y + 4, w: 320, h: 46, html: linesToHtml(t), style: { fontSize: 22, valign: 'middle' } });
    s.elements.push(c, tx);
    animate(s, c, 'zoomIn', i ? 'after' : 'click', 0.4);
    animate(s, tx, 'flyRight', 'with', 0.5);
  });
  return s;
}

function cards(deck, title, items, transition) {
  const s = S(deck, 'titleOnly', { title, transition });
  const th = getTheme(deck.theme);
  const { w } = dims(deck);
  const n = items.length, gap = 24, cw = (w - 120 - gap * (n - 1)) / n;
  items.forEach(([head, text], i) => {
    const x = 60 + i * (cw + gap);
    const card = shapeEl('roundRect', { x, y: 140, w: cw, h: 300, fill: { type: 'solid', color: th.colors.accent[i % th.colors.accent.length] }, shadow: true, html: linesToHtml([head]), style: { fontSize: 22, bold: true, valign: 'top' } });
    card.y = 140;
    const body = textEl({ x: x + 12, y: 210, w: cw - 24, h: 200, html: linesToHtml(text), style: { fontSize: 15, color: '#ffffff', lineHeight: 1.6, align: 'center' } });
    s.elements.push(card, body);
    animate(s, card, 'floatUp', i ? 'after' : 'click', 0.5);
    animate(s, body, 'fade', 'with', 0.5);
  });
  return s;
}

const BUILDERS = {
  blank() {
    const d = newDeck('office');
    S(d, 'title');
    return d;
  },
  report() {
    const d = newDeck('blue');
    S(d, 'title', { title: '2026 年度工作汇报', subtitle: '汇报人：张三　|　市场部　|　2026 年 12 月', transition: 'fade' });
    toc(d, '目录', ['年度工作概述', '重点项目回顾', '数据与成果', '问题与不足', '明年工作计划'], 'push');
    const s1 = S(d, 'titleContent', { title: '年度工作概述', body: ['全年完成销售额 3,280 万元，同比增长 26%', '新增签约客户 128 家，客户续约率达到 92%', '完成 3 个重点产品的市场推广与渠道建设', '团队规模由 12 人扩展至 18 人，人均效能提升 15%'], transition: 'push', notes: '重点强调增长率与客户续约率。' });
    animate(s1, s1.elements[1], 'floatUp');
    const s2 = S(d, 'titleOnly', { title: '季度业绩对比', transition: 'push' });
    s2.elements.push(chartEl({ x: 80, y: 120, w: 800, h: 380, chartType: 'bar', data: { labels: ['第一季度', '第二季度', '第三季度', '第四季度'], series: [{ name: '2025 年', values: [520, 610, 680, 790] }, { name: '2026 年', values: [650, 780, 860, 990] }] }, chartTitle: '销售额（万元）' }));
    cards(d, '重点项目回顾', [['项目 A', '完成华东区渠道布局\n覆盖 6 个城市'], ['项目 B', '线上商城改版上线\n转化率提升 35%'], ['项目 C', '会员体系升级\n活跃会员 +4.2 万']], 'push');
    S(d, 'twoContent', { title: '问题与不足', body: ['跨部门协作效率有待提升', '新品上市节奏偏慢', '数据分析能力不足'], body2: ['建立周例会与项目看板机制', '优化产品立项与评审流程', '引入 BI 工具，开展数据培训'], transition: 'push' });
    S(d, 'section', { title: '谢谢观看', subtitle: '欢迎各位领导批评指正', transition: 'fade' });
    return d;
  },
  plan() {
    const d = newDeck('navy');
    S(d, 'title', { title: '商业计划书', subtitle: '智慧零售 SaaS 平台　·　A 轮融资', transition: 'fade' });
    toc(d, 'CONTENTS 目录', ['市场痛点', '解决方案', '商业模式', '竞争优势', '财务预测', '融资计划'], 'fade');
    S(d, 'comparison', { title: '市场痛点 vs 解决方案', transition: 'fade' });
    const cmp = d.slides[d.slides.length - 1];
    fill(cmp, 'body', ['行业痛点'], 0);
    fill(cmp, 'body', ['中小商家数字化成本高', '库存与会员数据割裂', '营销手段单一，复购率低'], 1);
    fill(cmp, 'body', ['我们的方案'], 2);
    fill(cmp, 'body', ['开箱即用的一体化 SaaS', '进销存 + 会员 + 营销打通', 'AI 驱动的精准营销推荐'], 3);
    const t = S(d, 'titleOnly', { title: '财务预测（单位：万元）', transition: 'fade' });
    t.elements.push(tableFrom([['指标', '2026', '2027', '2028'], ['营业收入', '1,200', '3,600', '8,500'], ['毛利率', '62%', '68%', '72%'], ['付费客户数', '2,000', '6,500', '15,000'], ['净利润', '-300', '450', '2,100']], { x: 100, y: 130, w: 760, h: 300, style: { fontSize: 16 } }));
    const c = S(d, 'titleOnly', { title: '收入增长预测', transition: 'fade' });
    c.elements.push(chartEl({ x: 100, y: 120, w: 760, h: 380, chartType: 'line', data: { labels: ['2026', '2027', '2028', '2029'], series: [{ name: '营业收入', values: [1200, 3600, 8500, 15000] }, { name: '净利润', values: [-300, 450, 2100, 4800] }] } }));
    S(d, 'titleContent', { title: '融资计划', body: ['本轮融资：3,000 万元人民币，出让 15% 股权', '40% 用于产品研发与 AI 能力建设', '35% 用于市场拓展与渠道建设', '25% 用于团队建设与日常运营'], transition: 'fade' });
    S(d, 'section', { title: '感谢聆听', subtitle: 'contact@example.com', transition: 'fade' });
    return d;
  },
  course() {
    const d = newDeck('green');
    S(d, 'title', { title: '光合作用', subtitle: '初中生物 · 第三单元 第五节', transition: 'wipe' });
    const g = S(d, 'titleContent', { title: '学习目标', body: ['说出光合作用的概念和场所', '理解光合作用的原料、产物和条件', '能设计简单的探究实验'], transition: 'wipe' });
    animate(g, g.elements[1], 'flyLeft');
    const s = S(d, 'titleOnly', { title: '光合作用的过程', transition: 'wipe' });
    const th = getTheme('green');
    const steps = ['二氧化碳 + 水', '光能 · 叶绿体', '有机物 + 氧气'];
    steps.forEach((t, i) => {
      const el = shapeEl(i === 1 ? 'ellipse' : 'roundRect', { x: 70 + i * 290, y: 220, w: 230, h: 110, fill: { type: 'solid', color: th.colors.accent[i] }, html: linesToHtml(t), style: { fontSize: 20, bold: true }, shadow: true });
      s.elements.push(el);
      animate(s, el, 'zoomIn', i ? 'after' : 'click');
      if (i < 2) {
        const a = shapeEl('rightArrow', { x: 305 + i * 290, y: 255, w: 50, h: 40, fill: { type: 'solid', color: '#94a3b8' } });
        s.elements.push(a);
        animate(s, a, 'wipeIn', 'after', 0.4);
      }
    });
    s.elements.push(textEl({ x: 70, y: 380, w: 820, h: 60, html: linesToHtml('公式：6CO₂ + 6H₂O →（光照、叶绿体）C₆H₁₂O₆ + 6O₂'), style: { fontSize: 20, align: 'center', color: '#166534', bold: true } }));
    S(d, 'pictureTitle', { title: '叶绿体结构', body: ['叶绿体是光合作用的场所', '主要由外膜、内膜、基粒和基质组成', '基粒上含有叶绿素，能吸收光能'], transition: 'wipe' });
    S(d, 'titleContent', { title: '课堂练习', body: ['1. 光合作用的场所是________。', '2. 光合作用的原料是________和________。', '3. 设计实验：验证光是光合作用的必要条件。'], transition: 'wipe' });
    S(d, 'section', { title: '课堂小结', subtitle: '光合作用 = 原料 + 条件 + 场所 + 产物', transition: 'wipe' });
    return d;
  },
  launch() {
    const d = newDeck('tech');
    S(d, 'title', { title: 'NOVA X1', subtitle: '重新定义智能 · 2026 新品发布会', transition: 'zoom' });
    const h = S(d, 'section', { title: '一块屏幕，无限可能', subtitle: '6.8 英寸 2K 自适应刷新率屏幕', transition: 'cube' });
    animate(h, h.elements[0], 'zoomIn', 'after', 0.8);
    cards(d, '核心亮点', [['极速芯片', '3nm 旗舰处理器\n性能提升 40%'], ['影像系统', '2 亿像素主摄\n全焦段夜景'], ['超长续航', '6000mAh 电池\n120W 快充'], ['AI 助手', '端侧大模型\n离线可用']], 'cube');
    const c = S(d, 'titleOnly', { title: '性能跑分对比', transition: 'cube' });
    c.elements.push(chartEl({ x: 100, y: 120, w: 760, h: 380, chartType: 'hbar', data: { labels: ['上代产品', '竞品 A', '竞品 B', 'NOVA X1'], series: [{ name: '综合跑分（万）', values: [168, 195, 203, 248] }] }, legend: false }));
    S(d, 'section', { title: '¥ 4999 起', subtitle: '即日起开启预约 · 12 月 12 日正式开售', transition: 'flip' });
    return d;
  },
  defense() {
    const d = newDeck('gray');
    S(d, 'title', { title: '基于深度学习的图像识别研究', subtitle: '答辩人：李明　　指导教师：王教授\n计算机科学与技术学院　2026 年 6 月', transition: 'fade' });
    toc(d, '汇报提纲', ['研究背景与意义', '相关工作', '研究方法', '实验与分析', '总结与展望'], 'fade');
    S(d, 'titleContent', { title: '研究背景与意义', body: ['图像识别是计算机视觉领域的核心任务之一', '现有方法在小样本场景下泛化能力不足', '本文提出一种轻量级注意力网络，兼顾精度与效率'], transition: 'fade' });
    const m = S(d, 'titleOnly', { title: '研究方法', transition: 'fade' });
    const th = getTheme('gray');
    ['数据预处理', '特征提取', '注意力融合', '分类输出'].forEach((t, i) => {
      const el = shapeEl('homePlate', { x: 60 + i * 215, y: 230, w: 200, h: 90, fill: { type: 'solid', color: th.colors.accent[i] }, html: linesToHtml(t), style: { fontSize: 18, bold: true } });
      m.elements.push(el);
      animate(m, el, 'flyLeft', i ? 'after' : 'click', 0.4);
    });
    const e = S(d, 'titleOnly', { title: '实验结果', transition: 'fade' });
    e.elements.push(tableFrom([['方法', '准确率', '参数量', '推理速度'], ['ResNet-50', '76.1%', '25.6M', '12 ms'], ['MobileNetV3', '75.2%', '5.4M', '4 ms'], ['本文方法', '78.4%', '6.1M', '5 ms']], { x: 80, y: 130, w: 800, h: 220, style: { fontSize: 16 } }));
    e.elements.push(textEl({ x: 80, y: 380, w: 800, h: 50, html: linesToHtml('本文方法在保持轻量化的同时，准确率提升 2.3 个百分点'), style: { fontSize: 18, color: '#0f766e', bold: true, align: 'center' } }));
    S(d, 'titleContent', { title: '总结与展望', body: ['提出轻量级注意力网络，在多个数据集上取得领先效果', '模型可部署于移动端，具有实际应用价值', '未来将探索自监督预训练与多模态融合'], transition: 'fade' });
    S(d, 'section', { title: '恳请各位老师批评指正', subtitle: '谢谢！', transition: 'fade' });
    return d;
  },
};

export const TEMPLATES = [
  { id: 'blank', name: '空白演示' },
  { id: 'report', name: '工作汇报' },
  { id: 'plan', name: '商务计划书' },
  { id: 'course', name: '教学课件' },
  { id: 'launch', name: '产品发布会' },
  { id: 'defense', name: '毕业答辩' },
].map((t) => ({
  ...t,
  preview: () => {
    const deck = BUILDERS[t.id]();
    const box = slideThumb(deck.slides[0], deck, 160);
    box.style.borderRadius = '3px';
    box.style.boxShadow = '0 1px 4px rgba(0,0,0,.15)';
    return box;
  },
}));

export function buildTemplate(id) {
  return (BUILDERS[id] || BUILDERS.blank)();
}
