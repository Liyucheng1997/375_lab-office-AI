// AI 对话循环：浏览器直连 Anthropic Messages API，流式输出 + 工具调用（手动循环）。
// 文档操作由各应用以"工具"的形式提供，循环负责：发请求 → 流式显示 → 执行工具 → 回传结果 → 直到结束。
import { getSettings, MODELS } from './settings.js';

let SDK = null; // 懒加载，首页不需要时不打包进首屏

export async function makeClient(cfg = getSettings()) {
  if (!SDK) SDK = (await import('@anthropic-ai/sdk')).default;
  return new SDK({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL || undefined,
    // Key 由用户自己在本机填写、只存于本机浏览器，请求直接发往 Anthropic，因此允许浏览器直连
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
  });
}

/** 把 SDK 错误翻译成用户能看懂的中文 */
export function describeError(e) {
  if (!SDK || !(e instanceof SDK.APIError)) return '出错了：' + (e?.message || e);
  if (e instanceof SDK.AuthenticationError) return 'API Key 无效或已失效，请在 AI 设置里检查。';
  if (e instanceof SDK.PermissionDeniedError) return '这个 API Key 没有权限使用所选模型。';
  if (e instanceof SDK.NotFoundError) return '找不到所选模型，请在 AI 设置里换一个模型。';
  if (e instanceof SDK.RateLimitError) return '请求太频繁或额度不足，请稍后再试，或检查账户余额。';
  if (e instanceof SDK.BadRequestError) return '请求被拒绝：' + (e.error?.error?.message || e.message);
  if (e instanceof SDK.APIConnectionError) return '连不上 Anthropic。请检查网络；如果所在网络无法直连，可在 AI 设置里填写代理 API 地址。';
  if (e instanceof SDK.InternalServerError) return 'Anthropic 服务暂时繁忙，请稍后重试。';
  return `出错了（${e.status ?? '未知'}）：${e.message}`;
}

const MAX_TURNS = 24;

/** 开发用的假流：把 __aiMock 返回的消息按 stream 的接口形状交出去 */
function mockStream(fn, params, turn) {
  const handlers = { text: [], streamEvent: [] };
  return {
    on(ev, cb) { (handlers[ev] ||= []).push(cb); return this; },
    abort() {},
    async finalMessage() {
      const msg = await fn({ params: structuredClone(params), turn });
      for (const b of msg.content) if (b.type === 'text') handlers.text.forEach((cb) => cb(b.text, b.text));
      return { role: 'assistant', stop_reason: 'end_turn', ...msg };
    },
  };
}

/** 校验工具输入（启用流式工具输入后服务端不再校验，需要自己检查必填字段和类型） */
function validateInput(schema, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return '输入必须是对象';
  for (const k of schema.required || []) if (!(k in input)) return `缺少必填字段 ${k}`;
  for (const [k, def] of Object.entries(schema.properties || {})) {
    if (!(k in input) || input[k] == null) continue;
    const v = input[k];
    const t = def.type;
    const ok = !t
      || (t === 'string' && typeof v === 'string')
      || (t === 'number' && typeof v === 'number')
      || (t === 'integer' && Number.isInteger(v))
      || (t === 'boolean' && typeof v === 'boolean')
      || (t === 'array' && Array.isArray(v))
      || (t === 'object' && typeof v === 'object' && !Array.isArray(v));
    if (!ok) return `字段 ${k} 类型应为 ${t}`;
    if (def.enum && !def.enum.includes(v)) return `字段 ${k} 只能是 ${def.enum.join(' / ')}`;
  }
  return null;
}

/**
 * 运行一轮 AI 对话（可能包含多次工具调用）。
 * @param {object} p
 * @param {string} p.system   稳定的系统提示（会被缓存）
 * @param {Array}  p.tools    [{ name, description, input_schema, run(input) => string|object }]
 * @param {Array}  p.messages 对话历史（Anthropic 消息格式），本函数会把 assistant / tool_result 追加进去
 * @param {(ev) => void} p.onEvent
 *   { type: 'thinking' } | { type: 'text', text } | { type: 'tool_start', id, name, input }
 *   | { type: 'tool_end', id, name, ok, result } | { type: 'refusal' }
 * @param {{ cancelled: boolean, abort?: () => void }} p.control  外部置 cancelled=true 并调用 abort() 停止
 * @returns {Promise<'end'|'cancelled'|'refusal'|'max_tokens'|'turn_limit'>}
 */
export async function runAgent({ system, tools = [], messages, onEvent, control }) {
  const cfg = getSettings();
  const client = import.meta.env.DEV && window.__aiMock ? null : await makeClient(cfg);
  const direct = !cfg.baseURL; // 走代理时不启用 beta 特性，避免代理不认识而报错
  const known = MODELS.some((m) => m.id === cfg.model);
  const apiTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
    ...(direct ? { eager_input_streaming: true } : {}),
  }));
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  let jsonRetries = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (control.cancelled) return 'cancelled';
    const params = {
      model: cfg.model,
      max_tokens: 32000,
      system,
      messages,
      cache_control: { type: 'ephemeral' }, // 自动缓存系统提示、工具定义和历史前缀
      ...(apiTools.length ? { tools: apiTools } : {}),
      ...(known ? { output_config: { effort: cfg.effort } } : {}),
    };
    // 模型因安全策略拒答时，由服务端自动换推荐模型重试（Opus 5.5 / Sonnet 5.5 直连时）
    if (direct && (cfg.model === 'claude-opus-5-5' || cfg.model === 'claude-sonnet-5-5')) {
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }

    // 开发调试：window.__aiMock({ params, turn }) 返回 { content, stop_reason }，用于在没有 API Key 时测试工具
    const stream = import.meta.env.DEV && window.__aiMock ? mockStream(window.__aiMock, params, turn) : client.beta.messages.stream(params);
    control.abort = () => stream.abort();
    stream.on('streamEvent', (ev) => {
      if (ev.type === 'content_block_start' && ev.content_block.type === 'thinking') onEvent({ type: 'thinking' });
    });
    stream.on('text', (delta) => onEvent({ type: 'text', text: delta }));

    let msg;
    try {
      msg = await stream.finalMessage();
      jsonRetries = 0;
    } catch (e) {
      if (control.cancelled || (SDK && e instanceof SDK.APIUserAbortError)) return 'cancelled';
      // 只有"工具输入 JSON 无法解析"这一种情况重发本轮；API 错误直接抛出
      if ((SDK && e instanceof SDK.APIError) || jsonRetries++ >= 2) throw e;
      continue;
    }

    if (msg.stop_reason === 'refusal') { onEvent({ type: 'refusal' }); return 'refusal'; }
    if (msg.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: msg.content }); continue; }

    const uses = msg.content.filter((b) => b.type === 'tool_use');
    messages.push({ role: 'assistant', content: msg.content });
    if (!uses.length) return msg.stop_reason === 'max_tokens' ? 'max_tokens' : 'end';
    if (msg.stop_reason === 'max_tokens') {
      // 工具输入被截断：不执行，告知模型
      messages.push({ role: 'user', content: uses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: '输出被截断，工具未执行。请把操作拆成更小的几步。' })) });
      continue;
    }

    // 按顺序执行工具（文档修改有先后关系），全部结果放进同一条 user 消息
    const results = [];
    for (const u of uses) {
      if (control.cancelled) {
        results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: '用户已停止' });
        continue;
      }
      const tool = byName[u.name];
      onEvent({ type: 'tool_start', id: u.id, name: u.name, input: u.input });
      let content, ok = true;
      const bad = tool ? validateInput(tool.input_schema, u.input) : `没有名为 ${u.name} 的工具`;
      if (bad) {
        ok = false;
        content = JSON.stringify({ INVALID_INPUT: bad });
      } else {
        try {
          const r = await tool.run(u.input);
          content = typeof r === 'string' ? r : JSON.stringify(r ?? { ok: true });
        } catch (err) {
          ok = false;
          content = '执行失败：' + (err?.message || String(err));
        }
      }
      onEvent({ type: 'tool_end', id: u.id, name: u.name, ok, result: content });
      results.push({ type: 'tool_result', tool_use_id: u.id, content, ...(ok ? {} : { is_error: true }) });
    }
    messages.push({ role: 'user', content: results });
    if (control.cancelled) return 'cancelled';
  }
  return 'turn_limit';
}
