// 文档正文样式（编辑区、打印、HTML 导出共用）。作用域为 .wr-doc。
export const CONTENT_CSS = `
.wr-doc { font-family: 'SimSun', 'Songti SC', serif; font-size: 12pt; line-height: 1.6; color: #000; white-space: pre-wrap; word-wrap: break-word; tab-size: 4; text-align: justify; }
.wr-doc p { margin: 0 0 0.35em; }
.wr-doc h1, .wr-doc h2, .wr-doc h3, .wr-doc h4, .wr-doc h5, .wr-doc h6 { font-family: 'Microsoft YaHei', 'SimHei', sans-serif; font-weight: bold; line-height: 1.4; }
.wr-doc h1 { font-size: 22pt; margin: 0.6em 0 0.4em; }
.wr-doc h2 { font-size: 16pt; margin: 0.55em 0 0.35em; }
.wr-doc h3 { font-size: 14pt; margin: 0.5em 0 0.3em; }
.wr-doc h4 { font-size: 12pt; margin: 0.4em 0 0.25em; }
.wr-doc h5, .wr-doc h6 { font-size: 11pt; margin: 0.4em 0 0.25em; }
.wr-doc .wr-title { font-family: 'Microsoft YaHei', 'SimHei', sans-serif; font-size: 22pt; font-weight: bold; text-align: center; margin: 0.4em 0 0.5em; line-height: 1.4; }
.wr-doc .wr-subtitle { font-family: 'Microsoft YaHei', 'SimHei', sans-serif; font-size: 15pt; text-align: center; color: #555; margin: 0 0 0.8em; }
.wr-doc blockquote { margin: 0.5em 0; padding: 4px 14px; border-left: 4px solid #c8ccd4; color: #444; background: #f6f7f9; }
.wr-doc pre { font-family: Consolas, 'Courier New', monospace; font-size: 10.5pt; background: #f4f5f7; border: 1px solid #e1e4e8; border-radius: 3px; padding: 8px 10px; margin: 0.5em 0; white-space: pre-wrap; }
.wr-doc code { font-family: Consolas, 'Courier New', monospace; background: #f4f5f7; padding: 0 3px; border-radius: 2px; }
.wr-doc ul, .wr-doc ol { margin: 0 0 0.35em; padding-left: 2em; }
.wr-doc li { margin: 0; }
.wr-doc a { color: #0563c1; text-decoration: underline; }
.wr-doc img { max-width: 100%; vertical-align: bottom; }
.wr-doc hr { border: 0; border-top: 1px solid #999; margin: 0.8em 0; }
.wr-doc table { border-collapse: collapse; width: 100%; margin: 0.4em 0; table-layout: fixed; }
.wr-doc td, .wr-doc th { border: 1px solid #000; padding: 4px 7px; vertical-align: top; min-width: 20px; word-break: break-word; }
.wr-doc th { font-weight: bold; background: #f2f2f2; }
.wr-doc table.wr-tb-none td, .wr-doc table.wr-tb-none th { border: 1px dashed transparent; }
.wr-doc table.wr-tb-outer { border: 1px solid #000; }
.wr-doc table.wr-tb-outer td, .wr-doc table.wr-tb-outer th { border: 0; }
.wr-doc table.wr-tb-hz td, .wr-doc table.wr-tb-hz th { border-left: 0; border-right: 0; }
.wr-doc table.wr-ts-blue tr:first-child td, .wr-doc table.wr-ts-blue tr:first-child th { background: #4472c4; color: #fff; font-weight: bold; border-color: #4472c4; }
.wr-doc table.wr-ts-blue td, .wr-doc table.wr-ts-blue th { border-color: #8eaadb; }
.wr-doc table.wr-ts-blue tr:nth-child(2n+3) td { background: #d9e2f3; }
.wr-doc table.wr-ts-three { border-top: 2px solid #000; border-bottom: 2px solid #000; }
.wr-doc table.wr-ts-three td, .wr-doc table.wr-ts-three th { border: 0; }
.wr-doc table.wr-ts-three tr:first-child td, .wr-doc table.wr-ts-three tr:first-child th { border-bottom: 1px solid #000; font-weight: bold; }
.wr-doc table.wr-ts-orange tr:first-child td { background: #ed7d31; color: #fff; font-weight: bold; border-color: #ed7d31; }
.wr-doc table.wr-ts-orange td { border-color: #f4b183; }
.wr-doc table.wr-ts-orange tr:nth-child(2n+3) td { background: #fbe5d5; }
.wr-doc .wr-pagebreak { height: 0; margin: 0; border: 0; break-after: page; page-break-after: always; }
.wr-doc .wr-textbox { display: inline-block; border: 1px solid #000; padding: 6px 8px; min-width: 60px; min-height: 30px; vertical-align: top; white-space: pre-wrap; }
.wr-doc .wr-comment { background: #fff3c4; border-bottom: 2px solid #f5b400; }
.wr-doc .wr-fnref { color: #0563c1; font-size: 0.75em; vertical-align: super; line-height: 0; }
.wr-doc .wr-footnotes { margin-top: 1.5em; padding-top: 6px; border-top: 1px solid #999; font-size: 9pt; color: #333; }
.wr-doc .wr-footnotes ol { margin: 0; padding-left: 1.6em; }
.wr-doc .wr-toc { margin: 0.4em 0 0.8em; }
.wr-doc .wr-toc-title { font-family: 'Microsoft YaHei', 'SimHei', sans-serif; font-size: 16pt; font-weight: bold; text-align: center; margin-bottom: 0.4em; }
.wr-doc .wr-toc-item { display: flex; align-items: baseline; gap: 4px; line-height: 1.9; }
.wr-doc .wr-toc-item .wr-toc-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wr-doc .wr-toc-item .wr-toc-dots { flex: 1; border-bottom: 1px dotted #666; transform: translateY(-4px); min-width: 20px; }
.wr-doc .wr-toc-l2 { padding-left: 2em; }
.wr-doc .wr-toc-l3 { padding-left: 4em; }
.wr-doc .wr-cols { column-gap: 2em; }
.wr-doc .wr-cols > :first-child { margin-top: 0; }
`;

let injected = false;
export function injectContentCss() {
  if (injected) return;
  injected = true;
  const s = document.createElement('style');
  s.dataset.wr = 'content';
  s.textContent = CONTENT_CSS;
  document.head.append(s);
}
