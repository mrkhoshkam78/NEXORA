const BASE = 'https://api.cloudflare.com/client/v4';
export const PRIMARY = '@cf/qwen/qwen3.8-27b';

function headers(token) { return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }; }

export async function listModels(accountId, token) {
  const url = `${BASE}/accounts/${encodeURIComponent(accountId)}/ai/models/search?per_page=100&page=1`;
  const r = await fetch(url, { headers: headers(token) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.success) throw new Error(cfError(body, r.status));
  return Array.isArray(body.result) ? body.result : (body.result?.data || []);
}

export async function validateAndDiscover(accountId, token) {
  const models = await listModels(accountId, token);
  const normalized = models.map(m => ({
    id: m.name || m.id || m.model || m.slug,
    name: m.name || m.id || m.model || m.slug,
    description: m.description || '',
    task: m.task || m.task_type || '',
    function_calling: Boolean(m.properties?.function_calling || m.function_calling || m.capabilities?.includes?.('function-calling')),
    context: m.context_window || m.context_length || null,
    deprecated: Boolean(m.deprecated || m.is_deprecated)
  })).filter(m => m.id);
  const candidates = [
    PRIMARY,
    '@cf/moonshotai/kimi-k2.7-code',
    '@cf/zai-org/glm-5.2',
    '@cf/zai-org/glm-4.7-flash',
    '@cf/qwen/qwen3-30b-a3b-fp8',
    '@cf/qwen/qwen2.5-coder-32b-instruct',
    '@cf/openai/gpt-oss-20b'
  ];
  const ids = new Set(normalized.map(m => m.id));
  const fallbacks = candidates.filter(x => ids.has(x) && x !== PRIMARY);
  return { models: normalized, primaryAvailable: ids.has(PRIMARY), primary: ids.has(PRIMARY) ? PRIMARY : (fallbacks[0] || normalized[0]?.id || null), fallbacks };
}

function cfError(body, status) {
  const errors = Array.isArray(body?.errors) ? body.errors.map(e => `${e.code ?? ''} ${e.message ?? ''}`.trim()).filter(Boolean).join('; ') : '';
  return `Cloudflare API error (${status})${errors ? `: ${errors}` : ''}`;
}

export async function chatCompletion({ accountId, token, model, messages, tools, stream = false, tool_choice }) {
  const url = `${BASE}/accounts/${encodeURIComponent(accountId)}/ai/v1/chat/completions`;
  const r = await fetch(url, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ model, messages, tools, tool_choice, stream })
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    const message = cfError(body, r.status);
    const err = new Error(message);
    err.status = r.status;
    err.cf = body;
    throw err;
  }
  return r;
}

export async function testModel({ accountId, token, model }) {
  const r = await chatCompletion({
    accountId, token, model,
    messages: [
      { role: 'system', content: 'You are Nexora connectivity checker. Reply with exactly READY.' },
      { role: 'user', content: 'Connectivity test.' }
    ],
    tools: [], stream: false, tool_choice: 'none'
  });
  const body = await r.json();
  return body?.choices?.[0]?.message?.content?.trim() || JSON.stringify(body);
}
