// AI 助手侧边面板（三个应用共用）。应用只需提供：系统提示、文档上下文、工具、快捷操作。
//
// createAssistant({
//   appName: '文字',
//   systemPrompt: '应用专属说明（稳定，不要放会变的内容）',
//   getContext: () => '当前文档状态的简短描述：标题、大小、选区…（每次发送时附带）',
//   tools: [{ name, description, input_schema, run(input) => string|object, label?(input) => '显示给用户的动作名' }],
//   quickActions: [{ label, icon, prompt: string | () => string, needsSelection? }],
//   messageActions: [{ label, icon, run(text) }],   // 回复下方的按钮，如"插入到文档"
//   placeholder: '输入框提示',
// }) -> { el, open(prompt?, { send }), close(), toggle(), isOpen() }
import { h, icon, toast } from '../core/ui.js';
import { runAgent, describeError } from './agent.js';
import { getSettings, hasKey, openSettings, onSettingsChanged, modelLabel } from './settings.js';
import { renderMarkdown } from './markdown.js';
import './ai.css';

const BASE_SYSTEM = `你是"云办公 Office"里的 AI 办公助手，帮用户直接完成文档、表格、演示文稿里的工作。

工作方式：
- 用户要求修改文档时，直接调用工具完成，不要只给建议或让用户自己动手；需要了解内容时先用读取类工具。
- 每次修改都可以被用户撤销（Ctrl+Z），所以按用户意图大胆执行；只有在意图确实不明确、且做错代价大时才先问。
- 完成后用一两句话说明做了什么，不要复述大段内容。
- 回答用户的语言（默认简体中文），语气专业、简洁。
- 内容要真实可靠：不确定的数据不要编造，示例数据要标明是示例。
- 文档状态以每条消息附带的 <document_state> 为准，它反映发送时的最新情况。`;

export function createAssistant(opts) {
  const { appName = '', tools = [], quickActions = [], messageActions = [] } = opts;
  const system = BASE_SYSTEM + '\n\n' + (opts.systemPrompt || '');
  let messages = [];
  let running = null; // { cancelled, abort }
  let opened = false;

  const list = h('div', { class: 'ai-list' });
  const input = h('textarea', { class: 'ai-input', rows: 1, placeholder: opts.placeholder || `让 AI 帮你处理这份${appName}…` });
  const sendBtn = h('button', { class: 'ai-send', title: '发送 (Enter)', onclick: () => send() }, icon('arrow-up', 17, { strokeWidth: 2.4 }));
  const modelChip = h('button', { class: 'ai-model', title: '切换模型 / AI 设置', onclick: () => openSettings() });
  const syncModel = () => { modelChip.replaceChildren(icon('cpu', 12), modelLabel(getSettings().model).replace('Claude ', '')); };
  syncModel();
  const offSettings = onSettingsChanged(() => { syncModel(); if (!messages.length) renderEmpty(); });

  const el = h('div', { class: 'ai-pane' },
    h('div', { class: 'ai-head' },
      h('span', { class: 'ai-logo' }, icon('sparkles', 14, { strokeWidth: 2 })),
      h('span', { class: 'ai-title' }, 'AI 助手'),
      modelChip,
      h('span', { style: 'flex:1' }),
      h('button', { class: 'icon-btn', title: '新对话', onclick: () => reset() }, icon('square-pen', 16)),
      h('button', { class: 'icon-btn', title: 'AI 设置', onclick: () => openSettings() }, icon('settings-2', 16)),
      h('button', { class: 'icon-btn', title: '关闭 (Ctrl+J)', onclick: () => close() }, icon('x', 16))),
    list,
    h('div', { class: 'ai-composer' }, input, sendBtn),
    h('div', { class: 'ai-foot' }, 'AI 生成的内容可能有误，修改可用 Ctrl+Z 撤销'));

  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    // 不让应用的快捷键（如表格方向键、全选、撤销）抢走输入；全局的 Ctrl+J/S/O 照常生效
    const global = (e.ctrlKey || e.metaKey) && ['j', 's', 'o'].includes(e.key.toLowerCase());
    if (!global) e.stopPropagation();
  });
  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  }

  function renderEmpty() {
    list.replaceChildren();
    if (!hasKey()) {
      list.append(h('div', { class: 'ai-empty' },
        h('div', { class: 'ai-empty-ico' }, icon('key-round', 26)),
        h('div', { class: 'ai-empty-title' }, '先连接 Claude'),
        h('div', { class: 'ai-empty-text' }, '填写你的 Claude API Key 后，就能让 AI 写作、改写、算数据、做幻灯片。Key 只保存在本机浏览器。'),
        h('button', { class: 'btn btn-primary', onclick: () => openSettings() }, icon('settings-2', 15), '设置 API Key')));
      return;
    }
    list.append(h('div', { class: 'ai-empty' },
      h('div', { class: 'ai-empty-ico' }, icon('sparkles', 26)),
      h('div', { class: 'ai-empty-title' }, '有什么可以帮你？'),
      h('div', { class: 'ai-empty-text' }, `我可以直接读取和修改这份${appName}。试试下面的常用操作，或直接告诉我你想做什么。`),
      h('div', { class: 'ai-quick' }, quickActions.map((q) =>
        h('button', { class: 'ai-chip', onclick: () => {
          const p = typeof q.prompt === 'function' ? q.prompt() : q.prompt;
          if (p) send(p);
        } }, q.icon ? icon(q.icon, 14) : null, q.label)))));
  }

  function reset() {
    if (running) stop();
    messages = [];
    renderEmpty();
    input.focus();
  }

  function scrollDown(force) {
    const near = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    if (force || near) list.scrollTop = list.scrollHeight;
  }

  async function send(text) {
    text = (text ?? input.value).trim();
    if (!text || running) return;
    if (!hasKey()) { const s = await openSettings(); if (!s?.apiKey) return; }
    if (!messages.length) list.replaceChildren();
    input.value = '';
    autosize();

    list.append(h('div', { class: 'ai-msg ai-user' }, h('div', { class: 'ai-bubble' }, text)));
    let ctx = '';
    try { ctx = opts.getContext ? await opts.getContext() : ''; } catch (e) { console.warn(e); }
    messages.push({ role: 'user', content: [
      ...(ctx ? [{ type: 'text', text: `<document_state>\n${ctx}\n</document_state>` }] : []),
      { type: 'text', text },
    ] });

    // 助手回复容器：文字段落 + 工具动作条
    const body = h('div', { class: 'ai-body' });
    const status = h('div', { class: 'ai-status' }, h('span', { class: 'ai-dots' }, h('i'), h('i'), h('i')), h('span', null, '思考中'));
    const box = h('div', { class: 'ai-msg ai-bot' }, body, status);
    list.append(box);
    scrollDown(true);

    let curText = null, curRaw = '', fullText = '', pending = false;
    const flush = () => {
      pending = false;
      if (curText) curText.innerHTML = renderMarkdown(curRaw);
      scrollDown();
    };
    const chips = {};
    const control = (running = { cancelled: false, abort: null });
    setBusy(true);

    try {
      const result = await runAgent({
        system, tools, messages, control,
        onEvent(ev) {
          if (ev.type === 'thinking') status.lastChild.textContent = '思考中';
          else if (ev.type === 'text') {
            if (!curText) { curText = h('div', { class: 'ai-md' }); curRaw = ''; body.append(curText); }
            curRaw += ev.text;
            fullText += ev.text;
            status.lastChild.textContent = '正在输入';
            if (!pending) { pending = true; requestAnimationFrame(flush); setTimeout(() => pending && flush(), 120); }
          } else if (ev.type === 'tool_start') {
            if (curText) flush();
            curText = null;
            const t = tools.find((x) => x.name === ev.name);
            let label = ev.name;
            try { label = t?.label ? t.label(ev.input) : t?.title || ev.name; } catch {}
            const chip = h('div', { class: 'ai-tool running' }, h('span', { class: 'ai-tool-ico' }, h('span', { class: 'spinner-sm' })), h('span', null, label));
            chips[ev.id] = chip;
            body.append(chip);
            status.lastChild.textContent = '正在操作文档';
            scrollDown();
          } else if (ev.type === 'tool_end') {
            const chip = chips[ev.id];
            if (chip) {
              chip.classList.remove('running');
              chip.classList.toggle('err', !ev.ok);
              chip.firstChild.replaceChildren(icon(ev.ok ? 'check' : 'circle-alert', 13, { strokeWidth: 2.4 }));
              if (!ev.ok) chip.title = ev.result;
            }
            status.lastChild.textContent = '思考中';
          } else if (ev.type === 'refusal') {
            body.append(h('div', { class: 'ai-note' }, '这个请求被模型拒绝了，换个说法试试。'));
          }
        },
      });
      flush();
      if (result === 'cancelled') body.append(h('div', { class: 'ai-note' }, '已停止'));
      else if (result === 'max_tokens') body.append(h('div', { class: 'ai-note' }, '回复太长被截断了，可以让我"继续"。'));
      else if (result === 'turn_limit') body.append(h('div', { class: 'ai-note' }, '步骤太多，先停在这里。可以让我"继续"。'));
      if (!body.childNodes.length) body.append(h('div', { class: 'ai-md' }, h('p', null, '已完成。')));
    } catch (e) {
      console.error(e);
      flush();
      body.append(h('div', { class: 'ai-error' }, icon('circle-alert', 15), h('span', null, describeError(e)),
        h('button', { class: 'ai-link', onclick: () => openSettings() }, 'AI 设置')));
      // 出错时把这次的用户消息从历史里去掉，方便重试
      const last = messages[messages.length - 1];
      if (last && last.role === 'user' && !last.content.some?.((b) => b.type === 'tool_result')) messages.pop();
    } finally {
      status.remove();
      running = null;
      setBusy(false);
      if (fullText.trim()) body.append(actionsFor(fullText));
      scrollDown();
    }
  }

  function actionsFor(text) {
    return h('div', { class: 'ai-actions' },
      h('button', { class: 'ai-act', title: '复制', onclick: async () => {
        try { await navigator.clipboard.writeText(text); toast('已复制', 'success', 1000); } catch { toast('复制失败', 'error'); }
      } }, icon('copy', 13), '复制'),
      messageActions.map((a) => h('button', { class: 'ai-act', onclick: () => a.run(text) }, a.icon ? icon(a.icon, 13) : null, a.label)));
  }

  function stop() {
    if (!running) return;
    running.cancelled = true;
    running.abort && running.abort();
  }

  function setBusy(b) {
    el.classList.toggle('busy', b);
    sendBtn.replaceChildren(icon(b ? 'square' : 'arrow-up', b ? 13 : 17, { strokeWidth: 2.4 }));
    sendBtn.title = b ? '停止' : '发送 (Enter)';
    sendBtn.onclick = b ? stop : () => send();
  }

  function open(prompt, { send: doSend = false } = {}) {
    if (!opened) {
      opened = true;
      el.classList.add('open');
      if (!messages.length) renderEmpty();
      opts.onToggle && opts.onToggle(true);
    }
    if (prompt) {
      if (doSend) send(prompt);
      else { input.value = prompt; autosize(); }
    }
    setTimeout(() => input.focus(), 50);
  }
  function close() {
    if (!opened) return;
    opened = false;
    el.classList.remove('open');
    opts.onToggle && opts.onToggle(false);
  }

  renderEmpty();
  return {
    el,
    open,
    close,
    toggle: () => (opened ? close() : open()),
    isOpen: () => opened,
    send: (p) => { open(); return send(p); },
    destroy: () => { stop(); offSettings(); },
  };
}
