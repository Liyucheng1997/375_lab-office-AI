// 文字文档模板
import { h } from '../../core/ui.js';
import { injectContentCss } from './content-css.js';

const p = (t, style) => `<p${style ? ` style="${style}"` : ''}>${t}</p>`;
const ind = (t) => p(t, 'text-indent:2em');

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

const T = {
  blank: () => '<p><br></p>',

  report: () => [
    '<p class="wr-title">2026 年第三季度工作报告</p>',
    `<p class="wr-subtitle">产品研发部 · ${today()}</p>`,
    '<h1>一、工作概述</h1>',
    ind('本季度，产品研发部围绕"提质增效、稳中求进"的总体目标，持续推进核心产品迭代与技术平台建设。在全体成员的共同努力下，各项重点任务均按计划推进，部分指标超额完成。'),
    '<h1>二、主要工作成果</h1>',
    '<h2>（一）产品迭代</h2>',
    ind('完成核心产品 3 个大版本、12 个小版本的发布，新增功能 46 项，修复缺陷 218 个，用户满意度提升至 <b>92.6%</b>。'),
    '<h2>（二）关键指标</h2>',
    '<table class="wr-ts-blue"><tbody><tr><td>指标</td><td>目标值</td><td>完成值</td><td>完成率</td></tr><tr><td>版本发布数</td><td>12</td><td>15</td><td>125%</td></tr><tr><td>缺陷修复数</td><td>200</td><td>218</td><td>109%</td></tr><tr><td>新增用户（万）</td><td>50</td><td>57.3</td><td>115%</td></tr><tr><td>系统可用性</td><td>99.9%</td><td>99.95%</td><td>达标</td></tr></tbody></table>',
    '<h2>（三）团队建设</h2>',
    '<ul><li>组织技术分享会 8 场，参与人数 260 余人次；</li><li>新引进高级工程师 4 名，完成新员工培训 2 期；</li><li>建立代码评审与质量度量机制，线上事故同比下降 40%。</li></ul>',
    '<h1>三、存在的问题</h1>',
    '<ol><li>部分需求变更频繁，影响研发节奏；</li><li>自动化测试覆盖率仍偏低（当前 61%）；</li><li>跨部门协作流程有待进一步规范。</li></ol>',
    '<h1>四、下季度工作计划</h1>',
    ind('下季度将重点推进新一代平台架构升级，力争将自动化测试覆盖率提升至 75% 以上，并完成移动端体验优化专项。'),
    p('<br>'),
    p('产品研发部', 'text-align:right'),
    p(today(), 'text-align:right'),
  ].join(''),

  meeting: () => [
    '<p class="wr-title">会议纪要</p>',
    '<table class="wr-tb-all"><tbody>',
    '<tr><td style="background:#f2f2f2;font-weight:bold;width:18%">会议主题</td><td colspan="3">项目启动会</td></tr>',
    `<tr><td style="background:#f2f2f2;font-weight:bold">会议时间</td><td>${today()} 14:00-15:30</td><td style="background:#f2f2f2;font-weight:bold;width:18%">会议地点</td><td>3 楼第一会议室</td></tr>`,
    '<tr><td style="background:#f2f2f2;font-weight:bold">主持人</td><td>张经理</td><td style="background:#f2f2f2;font-weight:bold">记录人</td><td>李明</td></tr>',
    '<tr><td style="background:#f2f2f2;font-weight:bold">参会人员</td><td colspan="3">张经理、王工、赵工、刘设计、陈测试、李明</td></tr>',
    '</tbody></table>',
    '<h2>一、会议议题</h2>',
    '<ol><li>项目背景与目标介绍；</li><li>项目范围与里程碑确认；</li><li>团队分工与沟通机制。</li></ol>',
    '<h2>二、会议内容</h2>',
    ind('张经理介绍了项目背景：为提升客户服务效率，公司决定建设新一代客户服务平台，预计 12 月底上线一期功能。'),
    ind('与会人员对项目范围进行了讨论，一致同意一期聚焦工单管理、知识库与数据看板三大模块。'),
    '<h2>三、会议决议</h2>',
    '<table class="wr-ts-three"><tbody><tr><td>序号</td><td>事项</td><td>负责人</td><td>完成时间</td></tr><tr><td>1</td><td>输出需求规格说明书</td><td>王工</td><td>11 月 5 日</td></tr><tr><td>2</td><td>完成交互原型设计</td><td>刘设计</td><td>11 月 12 日</td></tr><tr><td>3</td><td>搭建开发与测试环境</td><td>赵工</td><td>11 月 8 日</td></tr></tbody></table>',
    '<h2>四、下次会议安排</h2>',
    ind('下次例会定于下周一 10:00，议题为需求评审。'),
  ].join(''),

  resume: () => [
    '<p style="font-family:Microsoft YaHei;font-size:26pt;font-weight:bold;margin:0;color:#1f3864">张 小 明</p>',
    '<p style="font-family:Microsoft YaHei;color:#555;margin-bottom:0.8em">求职意向：前端开发工程师　|　📞 138-0000-0000　|　✉ xiaoming@example.com　|　📍 北京</p>',
    '<h2 style="color:#1f3864;border-bottom:2px solid #1f3864;padding-bottom:2px">教育背景</h2>',
    '<p><b>北京理工大学</b>　计算机科学与技术　本科<span style="float:right">2018.09 - 2022.06</span></p>',
    '<p style="color:#555">GPA 3.7/4.0，主修课程：数据结构、操作系统、计算机网络、编译原理、软件工程</p>',
    '<h2 style="color:#1f3864;border-bottom:2px solid #1f3864;padding-bottom:2px">工作经历</h2>',
    '<p><b>某科技有限公司</b>　前端开发工程师<span style="float:right">2022.07 - 至今</span></p>',
    '<ul><li>负责公司在线办公产品的前端架构设计与核心模块开发，支撑日活 50 万用户；</li><li>主导富文本编辑器重构，渲染性能提升 60%，内存占用降低 35%；</li><li>搭建前端监控与自动化测试体系，线上缺陷率下降 45%。</li></ul>',
    '<h2 style="color:#1f3864;border-bottom:2px solid #1f3864;padding-bottom:2px">项目经验</h2>',
    '<p><b>在线表格协同编辑系统</b><span style="float:right">2023.03 - 2023.12</span></p>',
    '<ul><li>基于 Canvas 实现百万级单元格虚拟渲染，滚动帧率稳定 60fps；</li><li>实现公式计算引擎，支持 200+ 常用函数与依赖追踪。</li></ul>',
    '<h2 style="color:#1f3864;border-bottom:2px solid #1f3864;padding-bottom:2px">专业技能</h2>',
    '<ul><li>精通 JavaScript / TypeScript、HTML5、CSS3，熟悉浏览器渲染原理；</li><li>熟练使用 React、Vue、Vite、Webpack 等框架与工具；</li><li>了解 Node.js、数据库与常见后端开发技术。</li></ul>',
    '<h2 style="color:#1f3864;border-bottom:2px solid #1f3864;padding-bottom:2px">自我评价</h2>',
    ind('热爱技术，具有良好的编码习惯与团队协作能力，善于沟通，能承受一定的工作压力，乐于接受新挑战。'),
  ].join(''),

  notice: () => [
    '<p style="text-align:center;font-family:SimSun;font-size:26pt;font-weight:bold;color:#c00000;letter-spacing:4px;margin:0">××公司文件</p>',
    '<p style="text-align:center;font-family:FangSong;font-size:16pt;margin:0.5em 0">×司发〔2026〕18 号</p>',
    '<hr style="border-top:2px solid #c00000;margin:0 0 1.2em">',
    '<p style="text-align:center;font-family:SimHei;font-size:22pt;line-height:1.6">关于做好 2026 年国庆节放假安排的通知</p>',
    '<p style="font-family:FangSong;font-size:16pt">各部门、各分公司：</p>',
    '<p style="font-family:FangSong;font-size:16pt;text-indent:2em">根据国务院办公厅有关通知精神，结合公司实际，现将 2026 年国庆节放假安排及有关事项通知如下：</p>',
    '<p style="font-family:SimHei;font-size:16pt;text-indent:2em">一、放假时间</p>',
    '<p style="font-family:FangSong;font-size:16pt;text-indent:2em">10 月 1 日至 7 日放假调休，共 7 天。9 月 27 日（星期日）、10 月 10 日（星期六）上班。</p>',
    '<p style="font-family:SimHei;font-size:16pt;text-indent:2em">二、有关要求</p>',
    '<p style="font-family:FangSong;font-size:16pt;text-indent:2em">（一）各部门要妥善安排好值班和安全保卫等工作，遇有重大突发事件，要按规定及时报告并妥善处置。</p>',
    '<p style="font-family:FangSong;font-size:16pt;text-indent:2em">（二）节前要组织开展安全检查，切实做好防火、防盗等各项工作，确保节日期间安全稳定。</p>',
    '<p style="font-family:FangSong;font-size:16pt"><br></p>',
    '<p style="font-family:FangSong;font-size:16pt;text-align:right;padding-right:2em">××公司办公室</p>',
    `<p style="font-family:FangSong;font-size:16pt;text-align:right;padding-right:2em">${today()}</p>`,
  ].join(''),

  paper: () => [
    '<p class="wr-title">基于深度学习的文本分类方法研究</p>',
    '<p style="text-align:center;font-family:KaiTi">张三<sup>1</sup>，李四<sup>2</sup></p>',
    '<p style="text-align:center;font-size:10.5pt;color:#444">（1. 某某大学 计算机学院，北京 100081；2. 某某研究院，上海 200000）</p>',
    '<p style="font-size:10.5pt"><b>摘　要：</b>文本分类是自然语言处理中的基础任务之一。本文系统梳理了基于深度学习的文本分类方法，提出一种融合注意力机制的层次化分类模型，并在三个公开数据集上进行了实验。结果表明，该方法在准确率与泛化能力方面均优于现有基线方法。</p>',
    '<p style="font-size:10.5pt"><b>关键词：</b>深度学习；文本分类；注意力机制；自然语言处理</p>',
    '<h1>1 引言</h1>',
    ind('随着互联网的快速发展，文本数据呈爆炸式增长。如何高效、准确地对海量文本进行自动分类，已成为信息检索、舆情分析等领域的关键问题。'),
    '<h1>2 相关工作</h1>',
    '<h2>2.1 传统方法</h2>',
    ind('早期的文本分类主要依赖人工特征工程，例如词袋模型与 TF-IDF 加权，并结合朴素贝叶斯、支持向量机等分类器。'),
    '<h2>2.2 深度学习方法</h2>',
    ind('卷积神经网络与循环神经网络被广泛用于文本表示学习；近年来，基于 Transformer 的预训练语言模型取得了显著进展。'),
    '<h1>3 方法</h1>',
    ind('本文提出的模型由词编码层、句编码层与分类层组成，各层之间引入注意力机制以突出关键信息。'),
    '<h1>4 实验结果</h1>',
    '<p style="text-align:center;font-size:10.5pt"><b>表 1　不同方法的分类准确率（%）</b></p>',
    '<table class="wr-ts-three"><tbody><tr><td>方法</td><td>数据集 A</td><td>数据集 B</td><td>数据集 C</td></tr><tr><td>SVM</td><td>82.1</td><td>79.4</td><td>75.8</td></tr><tr><td>TextCNN</td><td>88.6</td><td>85.2</td><td>81.9</td></tr><tr><td>本文方法</td><td><b>92.3</b></td><td><b>89.7</b></td><td><b>86.4</b></td></tr></tbody></table>',
    '<h1>5 结论</h1>',
    ind('本文提出了一种融合注意力机制的层次化文本分类模型，实验验证了其有效性。未来工作将探索模型在多语言场景下的应用。'),
    '<h1>参考文献</h1>',
    '<p style="font-size:10.5pt">[1] Kim Y. Convolutional neural networks for sentence classification[C]. EMNLP, 2014: 1746-1751.</p>',
    '<p style="font-size:10.5pt">[2] Vaswani A, et al. Attention is all you need[C]. NeurIPS, 2017: 5998-6008.</p>',
  ].join(''),
};

export function defaultPage() {
  return { size: 'A4', orientation: 'portrait', margins: { top: 25.4, bottom: 25.4, left: 31.8, right: 31.8 }, color: null, watermark: null, border: false };
}

export function makeContent(id) {
  const html = (T[id] || T.blank)();
  const c = {
    html,
    page: defaultPage(),
    header: { text: '', align: 'center' },
    footer: { text: '', align: 'center' },
    pageNumber: { enabled: false, pos: 'footer', align: 'center', format: '{n}' },
    comments: {},
  };
  if (id === 'paper' || id === 'report') c.pageNumber.enabled = true;
  if (id === 'paper') c.pageNumber.format = '- {n} -';
  if (id === 'resume') c.page.margins = { top: 19.1, bottom: 19.1, left: 19.1, right: 19.1 };
  if (id === 'notice') c.page.margins = { top: 37, bottom: 35, left: 28, right: 26 };
  return c;
}

function preview(id) {
  return () => {
    injectContentCss();
    const paper = h('div', { class: 'wr-doc wr-tpl-paper', html: T[id]() });
    return h('div', { class: 'wr-tpl-prev' }, paper);
  };
}

export const TEMPLATES = [
  { id: 'blank', name: '空白文档' },
  { id: 'report', name: '工作报告', preview: preview('report') },
  { id: 'meeting', name: '会议纪要', preview: preview('meeting') },
  { id: 'resume', name: '个人简历', preview: preview('resume') },
  { id: 'notice', name: '公文通知', preview: preview('notice') },
  { id: 'paper', name: '学术论文', preview: preview('paper') },
];
