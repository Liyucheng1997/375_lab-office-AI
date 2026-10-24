# 云办公 Office

一个运行在浏览器里的 Office 全家桶：一个窗口里同时打开 **文字**、**表格**、**演示** 三类文档，用标签页切换。所有文档保存在浏览器本地（IndexedDB），不依赖后端服务。

当前版本：**1.0.0** · 在线体验：<https://liyucheng1997.github.io/cloud-office/>（推送 main 后由 GitHub Actions 自动部署）

界面采用苹果式简约设计语言：只用一个主题色（苹果蓝）加中性灰，纯色无渐变，白底大圆角卡片，胶囊控件，系统字体，支持深色模式。规范整理在 [.claude/skills/apple-minimal-design](.claude/skills/apple-minimal-design/SKILL.md)，可复用到其他项目。

## 运行

```bash
npm install
npm run dev        # 开发模式，默认 http://localhost:5173
npm run build      # 生产构建，输出到 dist/
npm run preview    # 预览生产构建
```

## 功能概览

| 模块 | 说明 |
| --- | --- |
| 首页 | 新建三类文档、推荐模板、最近文档、我的文档、星标、回收站、搜索、拖拽导入本地文件 |
| 外壳 | 顶部多标签（同时打开多个文档）、自动保存、Ctrl+S 保存、"文件"后台视图（信息/新建/打开/另存为副本/重命名/导出/打印/删除）、深色主题 |
| 文字 | 类 Word 的页面视图、富文本排版、表格、图片、目录、页眉页脚、页面设置、导入 docx/txt/md/html，导出 docx/PDF/HTML/TXT/MD |
| 表格 | Canvas 渲染的电子表格、公式引擎（80+ 函数）、格式、排序筛选、条件格式、图表、多工作表、导入 xlsx/csv，导出 xlsx/csv/PDF |
| 演示 | 幻灯片编辑（文本/形状/图片/表格）、主题与版式、切换与动画、全屏放映、导入/导出 pptx、导出 PDF |

## 目录结构

```
src/
  main.js              入口
  core/
    shell.js           顶部标签、编辑页管理、自动保存、文件后台视图
    store.js           IndexedDB 文件存储
    apps.js            应用注册表与公共工具
    ui.js              共享 UI 组件：功能区 Ribbon、对话框、取色器、菜单、提示等
  home/home.js         首页
  apps/
    writer/            文字
    sheet/             表格
    slides/            演示
  styles/              全局样式（base / shell / ribbon）
```

## 应用模块约定

每个应用（`src/apps/*/index.js`）默认导出：

```js
export default {
  templates: [{ id: 'blank', name: '空白', preview() {} }],
  createContent(templateId),          // 返回可 JSON 序列化的初始内容
  accept: '.docx,.txt',
  async importFile(file),             // 返回 { name, content }
  mount(root, file, ctx),             // 返回实例 { getContent, onShow, onHide, destroy, print, exports }
};
```

`ctx` 提供 `markDirty()`、`save()`、`rename(name)`、`getName()`、`openBackstage()`、`close()`。外壳负责保存和标签管理，应用只需在内容变化时调用 `ctx.markDirty()`。
