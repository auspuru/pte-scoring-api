'use strict';

// The owner-selected content reviewer for mocks. Provider changes are explicit;
// a failed request never silently falls back to another model or provider.
const MODEL = 'gpt-6.1-sol';
const REASONING_EFFORT = 'medium';
const configuration = () => ({ provider:'openai', model:MODEL });
const invalid = code => Object.assign(Error('Mock content assessment could not finish.'), { code });

function wireSchema(schema) {
  function visit(value) {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    // Strict OpenAI schemas do not accept a sibling description beside $ref.
    if (value.$ref && Object.keys(value).length > 1) {
      const target = value.$ref.startsWith('#/$defs/') && schema.$defs?.[value.$ref.slice(8)];
      if (!target) throw invalid('MOCK_CONTENT_SCHEMA');
      const { $ref, ...rest } = value;
      return visit({ ...target, ...rest });
    }
    // Uniqueness is checked by the existing domain validators, not decoding.
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'uniqueItems').map(([key,item]) => [key,visit(item)]));
  }
  return visit(schema);
}

function request(original) {
  const tools = original.tools || [];
  if (tools.length > 1 || tools.some(tool => !tool.name || !tool.input_schema)) throw invalid('MOCK_CONTENT_SCHEMA');
  return { model:MODEL, store:false, reasoning:{ effort:REASONING_EFFORT },
    max_output_tokens:Math.max(6000, original.max_tokens || 0),
    input:original.messages,
    ...(original.system ? { instructions:original.system } : {}),
    ...(tools.length ? {
      parallel_tool_calls:false,
      tools:tools.map(tool => ({ type:'function', name:tool.name, description:tool.description || '', strict:true, parameters:wireSchema(tool.input_schema) })),
      tool_choice:{ type:'function', name:tools[0].name }
    } : { text:{ format:{ type:'json_object' } } }) };
}

function response(value, original) {
  if (value?.status === 'incomplete') throw invalid('MOCK_CONTENT_TRUNCATED');
  if (value?.status !== 'completed' || !Array.isArray(value.output)) throw invalid('MOCK_CONTENT_OUTPUT');
  const messages = value.output.filter(item => item.type === 'message');
  if (messages.some(item => item.status !== 'completed' || (item.content || []).some(part => part.type === 'refusal'))) throw invalid('MOCK_CONTENT_REFUSAL');
  const calls = value.output.filter(item => item.type === 'function_call');
  const tool = original.tools?.[0];
  if (tool) {
    if (calls.length !== 1 || calls[0].name !== tool.name || calls[0].status !== 'completed') throw invalid('MOCK_CONTENT_OUTPUT');
    let input;
    try { input = JSON.parse(calls[0].arguments); } catch { throw invalid('MOCK_CONTENT_OUTPUT'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('MOCK_CONTENT_OUTPUT');
    return { model:MODEL, stop_reason:'tool_use', content:[{ type:'tool_use', name:tool.name, input }] };
  }
  if (calls.length) throw invalid('MOCK_CONTENT_OUTPUT');
  const text = messages.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('');
  let object;
  try { object = JSON.parse(text); } catch { throw invalid('MOCK_CONTENT_OUTPUT'); }
  if (!object || typeof object !== 'object' || Array.isArray(object)) throw invalid('MOCK_CONTENT_OUTPUT');
  return { model:MODEL, stop_reason:'end_turn', content:[{ type:'text', text }] };
}

function createProvider({ apiKey=process.env.OPENAI_API_KEY, fetch:send=fetch, onAssessment=()=>{} }={}) {
  async function call(original, { timeoutMs=90000, signal, task='content' }={}) {
    if (!apiKey) throw invalid('MOCK_CONTENT_UNAVAILABLE');
    const timeout = AbortSignal.timeout(timeoutMs);
    const started = Date.now();
    const result = await send('https://api.openai.com/v1/responses', { method:'POST',
      headers:{ Authorization:'Bearer '+apiKey, 'Content-Type':'application/json' },
      body:JSON.stringify(request(original)), signal:signal ? AbortSignal.any([signal,timeout]) : timeout });
    if (!result.ok) {
      // Provider bodies can echo input or secrets. Never log or expose them.
      await result.body?.cancel();
      throw Object.assign(invalid('MOCK_CONTENT_HTTP'), { status:result.status, retryable:![400,401,403,404].includes(result.status) });
    }
    const parsed = response(await result.json(), original);
    onAssessment({ event:'assessed', provider:'openai', model:MODEL, task, durationMs:Date.now()-started });
    return parsed;
  }
  return { call, configuration:configuration() };
}
module.exports = { MODEL, REASONING_EFFORT, configuration, wireSchema, request, response, createProvider };
