// AI 设置：API Key、模型、思考强度、可选的 API 地址（代理）。只保存在本浏览器 localStorage。
import { h, icon, modal, toast } from '../core/ui.js';

const KEY = 'office-ai-settings';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', desc: '最强，适合写作、分析、生成整份文档（默认）' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', desc: '更快更省，日常办公足够' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', desc: '最快最便宜，适合简单改写、翻译' },
];
export const EFFORTS = [
  { id: 'low', label: '快速' },
  { id: 'medium', label: '标准' },
  { id: 'high', label: '深入' },
];

const DEFAULTS = { apiKey: '', model: MODELS[0].id, effort: 'medium', baseURL: '' };
const listeners = new Set();

export function getSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function saveSettings(patch) {
  const s = { ...getSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(s));
  listeners.forEach((fn) => fn(s));
  return s;
}
export function onSettingsChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const hasKey = () => !!getSettings().apiKey.trim();
export const modelLabel = (id) => MODELS.find((m) => m.id === id)?.label || id;

/** 打开设置对话框；返回保存后的设置或 null */
export async function openSettings() {
  const s = getSettings();
  const keyInput = h('input', { class: 'input', type: 'password', value: s.apiKey, placeholder: 'sk-ant-...', autocomplete: 'off', spellcheck: false });
  const eye = h('button', { class: 'icon-btn ai-eye', type: 'button', title: '显示/隐藏', onclick: () => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
    eye.replaceChildren(icon(keyInput.type === 'password' ? 'eye' : 'eye-off', 16));
  } }, icon('eye', 16));
  const custom = !MODELS.some((m) => m.id === s.model);
  const modelSel = h('select', { class: 'input' },
    MODELS.map((m) => h('option', { value: m.id, selected: m.id === s.model }, m.label)),
    h('option', { value: '__custom', selected: custom }, '其他模型 ID…'));
  const modelCustom = h('input', { class: 'input', value: custom ? s.model : '', placeholder: '例如 claude-opus-5-5', style: { display: custom ? '' : 'none', marginTop: '8px' } });
  const modelDesc = h('div', { class: 'ai-hint' });
  const syncModel = () => {
    modelCustom.style.display = modelSel.value === '__custom' ? '' : 'none';
    modelDesc.textContent = MODELS.find((m) => m.id === modelSel.value)?.desc || '填写 Anthropic 提供的模型 ID';
  };
  modelSel.addEventListener('change', syncModel);
  syncModel();
  let effort = s.effort;
  const effortSeg = h('div', { class: 'seg' }, EFFORTS.map((e) => h('button', { type: 'button', class: e.id === effort ? 'active' : '', onclick: (ev) => {
    effort = e.id;
    effortSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === ev.currentTarget));
  } }, e.label)));
  const baseInput = h('input', { class: 'input', value: s.baseURL, placeholder: '留空 = 直连 https://api.anthropic.com' });
  const status = h('div', { class: 'ai-test-status' });

  const read = () => ({
    apiKey: keyInput.value.trim(),
    model: modelSel.value === '__custom' ? modelCustom.value.trim() || DEFAULTS.model : modelSel.value,
    effort,
    baseURL: baseInput.value.trim().replace(/\/+$/, ''),
  });

  const body = h('div', { class: 'ai-settings' },
    h('div', { class: 'ai-field' }, h('label', { class: 'form-label' }, 'Claude API Key'),
      h('div', { class: 'ai-key-row' }, keyInput, eye),
      h('div', { class: 'ai-hint' }, '在 ', h('a', { href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noopener' }, 'Anthropic 控制台'), ' 创建。Key 只保存在你这台电脑的浏览器里，请求从浏览器直接发往 Anthropic，不经过任何其他服务器。')),
    h('div', { class: 'ai-field' }, h('label', { class: 'form-label' }, '模型'), modelSel, modelCustom, modelDesc),
    h('div', { class: 'ai-field' }, h('label', { class: 'form-label' }, '思考强度'), effortSeg,
      h('div', { class: 'ai-hint' }, '越深入回答越好，但更慢、花费更多。')),
    h('details', { class: 'ai-adv', open: !!s.baseURL }, h('summary', null, '高级：API 地址'),
      baseInput, h('div', { class: 'ai-hint' }, '所在网络无法直连 Anthropic 时，可填写兼容 Anthropic 接口的代理地址。')),
    status);

  const r = await modal({
    title: 'AI 设置',
    width: 460,
    body,
    buttons: [
      { label: '测试连接', onClick: async () => { await testConnection(read(), status); return false; } },
      { label: '取消', value: null },
      { label: '保存', primary: true, onClick: () => read() },
    ],
  });
  if (!r) return null;
  const saved = saveSettings(r);
  toast(saved.apiKey ? 'AI 设置已保存' : '已清除 API Key', 'success');
  return saved;
}

async function testConnection(cfg, statusEl) {
  if (!cfg.apiKey) { statusEl.className = 'ai-test-status err'; statusEl.textContent = '请先填写 API Key'; return; }
  statusEl.className = 'ai-test-status';
  statusEl.textContent = '正在连接…';
  try {
    const { makeClient, describeError } = await import('./agent.js');
    const client = await makeClient(cfg);
    // 查询模型信息：能验证 Key 和模型 ID，且不消耗 token
    const m = await client.models.retrieve(cfg.model);
    statusEl.className = 'ai-test-status ok';
    statusEl.textContent = `连接成功：${m.display_name || m.id}`;
  } catch (e) {
    const { describeError } = await import('./agent.js');
    statusEl.className = 'ai-test-status err';
    statusEl.textContent = describeError(e);
  }
}
