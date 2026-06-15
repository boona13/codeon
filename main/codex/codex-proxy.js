/**
 * Codex translation proxy.
 *
 * Lets CODEON's Claude Code SDK subprocess use ChatGPT-subscription Codex
 * models without changing the agent loop. The subprocess is pointed at this
 * local server via ANTHROPIC_BASE_URL; the server speaks the Anthropic Messages
 * API on the inbound side and the ChatGPT Codex Responses API on the outbound
 * side, translating requests and streaming responses in both directions.
 *
 * Because the Anthropic Messages API is stateless (the full conversation is
 * sent every turn), each request is translated from scratch — we do not need
 * to persist/replay OpenAI reasoning items across turns.
 *
 * Endpoints implemented (the surface the `claude` binary actually uses):
 *   POST /v1/messages               -> streamed (or buffered) Codex turn
 *   POST /v1/messages/count_tokens  -> approximate token count
 */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const {
  ORIGINATOR,
  CODEX_BASE,
  parseCodexSlug,
  getCodexAccessToken,
} = require('./codex-auth');

const CODEX_URL = `${CODEX_BASE}/responses`;
const IDLE_TIMEOUT_MS = 240_000;

// ---------------------------------------------------------------------------
// Generated images
//
// Codex returns generated images inline as base64 in an `image_generation_call`
// output item. The Anthropic Messages API has no assistant-side image content
// block, so (like the Codex CLI) we persist the bytes to disk and surface the
// path back to the agent as text/markdown. The agent can then reference or move
// the file with its normal file tools. Override the directory with
// CODEX_IMAGE_DIR (e.g. set it to the active project root).
// ---------------------------------------------------------------------------
function generatedImageDir() {
  const base = (typeof process.env.CODEX_IMAGE_DIR === 'string' && process.env.CODEX_IMAGE_DIR.trim())
    ? process.env.CODEX_IMAGE_DIR.trim()
    : path.join(os.homedir(), '.ai-agent', 'generated-images');
  try { fs.mkdirSync(base, { recursive: true }); } catch { /* best effort */ }
  return base;
}

// Chroma-key transparency lives in a shared module so the OpenRouter image tool
// can reuse the exact same keying. See main/imagegen/chroma.js for details.
const { keyOutChroma } = require('../imagegen/chroma');

function saveGeneratedImage(b64, fmt) {
  const raw = Buffer.from(b64, 'base64');
  let ext = (typeof fmt === 'string' && /^(png|webp|jpe?g)$/i.test(fmt))
    ? fmt.toLowerCase().replace('jpeg', 'jpg')
    : 'png';

  let out = raw;
  let transparent = false;
  if (ext === 'png') {
    const keyed = keyOutChroma(raw);
    if (keyed) { out = keyed; transparent = true; }
  }

  const file = path.join(generatedImageDir(), `codex-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`);
  fs.writeFileSync(file, out);
  return { path: file, ext, transparent };
}

/** The text we inject into the assistant turn to surface a generated image. */
function imageAnnouncement(filePath, transparent) {
  const note = transparent
    ? '_Image generated with a transparent background (chroma-keyed) and saved to'
    : '_Image generated and saved to';
  return `\n\n![Generated image](${filePath})\n\n${note} \`${filePath}\`_\n`;
}

let _server = null;
let _baseUrl = null;
let _starting = null;

// ===========================================================================
// Request translation: Anthropic Messages -> ChatGPT Responses
// ===========================================================================

function systemToInstructions(system) {
  if (!system) return 'You are a helpful coding agent.';
  if (typeof system === 'string') return system || 'You are a helpful coding agent.';
  if (Array.isArray(system)) {
    const text = system.map((b) => (b && b.type === 'text' ? b.text : (typeof b === 'string' ? b : ''))).join('');
    return text || 'You are a helpful coding agent.';
  }
  return 'You are a helpful coding agent.';
}

function toolResultOutput(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p && p.type === 'text') return p.text || '';
        // Tool results can embed images; Responses function_call_output is text-only.
        if (p && p.type === 'image') return '[image]';
        return '';
      })
      .join('');
  }
  if (content == null) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function imageBlockToInputImage(block) {
  const src = block && block.source ? block.source : null;
  if (!src) return null;
  if (src.type === 'base64' && src.data) {
    const mt = src.media_type || 'image/png';
    return { type: 'input_image', image_url: `data:${mt};base64,${src.data}`, detail: 'auto' };
  }
  if (src.type === 'url' && src.url) {
    return { type: 'input_image', image_url: src.url, detail: 'auto' };
  }
  return null;
}

/**
 * Convert Anthropic messages (+system) into Responses { instructions, input }.
 */
function anthropicToResponsesInput(system, messages) {
  const instructions = systemToInstructions(system);
  const input = [];

  for (const msg of Array.isArray(messages) ? messages : []) {
    const role = msg && msg.role;
    const content = msg ? msg.content : '';

    if (role === 'user') {
      if (typeof content === 'string') {
        input.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: content }] });
        continue;
      }
      const parts = [];
      const blocks = Array.isArray(content) ? content : [];
      for (const b of blocks) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'text') {
          parts.push({ type: 'input_text', text: b.text || '' });
        } else if (b.type === 'image') {
          const img = imageBlockToInputImage(b);
          if (img) parts.push(img);
        } else if (b.type === 'tool_result') {
          // Flush any accumulated user parts as a message before the tool output.
          if (parts.length) {
            input.push({ type: 'message', role: 'user', content: parts.splice(0, parts.length) });
          }
          input.push({
            type: 'function_call_output',
            call_id: b.tool_use_id || '',
            output: toolResultOutput(b.content),
          });
        }
      }
      if (parts.length) {
        input.push({ type: 'message', role: 'user', content: parts });
      }
      continue;
    }

    if (role === 'assistant') {
      if (typeof content === 'string') {
        if (content) {
          input.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: content }] });
        }
        continue;
      }
      const blocks = Array.isArray(content) ? content : [];
      const textParts = [];
      const calls = [];
      for (const b of blocks) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'text') {
          textParts.push({ type: 'output_text', text: b.text || '' });
        } else if (b.type === 'tool_use') {
          let args = '{}';
          try {
            args = JSON.stringify(b.input ?? {});
          } catch { args = '{}'; }
          calls.push({ type: 'function_call', name: b.name || '', arguments: args, call_id: b.id || '' });
        }
        // 'thinking' blocks are dropped — the encrypted reasoning chain isn't replayable here.
      }
      if (textParts.length) {
        input.push({ type: 'message', role: 'assistant', content: textParts });
      }
      for (const c of calls) input.push(c);
      continue;
    }
  }

  return { instructions, input };
}

function anthropicToolsToResponses(tools) {
  if (!Array.isArray(tools)) return [];
  const out = [];
  for (const t of tools) {
    if (!t || typeof t !== 'object') continue;
    // Skip Anthropic server/built-in tools (they carry a `type` and no usable schema for Codex).
    if (t.type && !t.input_schema) continue;
    const name = t.name;
    if (!name) continue;
    out.push({
      type: 'function',
      name,
      description: t.description || '',
      parameters: t.input_schema || { type: 'object', properties: {} },
      strict: false,
    });
  }
  return out;
}

function anthropicToolChoiceToResponses(tc) {
  if (!tc) return 'auto';
  if (typeof tc === 'string') return tc;
  if (tc.type === 'auto') return 'auto';
  if (tc.type === 'any') return 'required';
  if (tc.type === 'tool' && tc.name) return { type: 'function', name: tc.name };
  return 'auto';
}

/**
 * Resolve the outbound Codex model + effort from the inbound model id.
 *
 * The Claude Code binary issues some calls (title/summary generation, the
 * haiku token-count fallback, quota checks) with hardcoded Claude model ids
 * like "claude-haiku-4-5-...". The ChatGPT Codex backend rejects any non-GPT
 * model, so anything that isn't a recognizable Codex/GPT/o-series slug is
 * remapped to the default Codex model.
 */
function resolveCodexModel(rawModel) {
  const { model, effort } = parseCodexSlug(rawModel || '');
  const looksCodex = /gpt|codex/i.test(model) || /^o\d/i.test(model);
  if (!model || /^claude/i.test(model) || !looksCodex) {
    return { model: 'gpt-5.5', effort };
  }
  return { model, effort };
}

/**
 * Build the Responses request body from an Anthropic Messages request body.
 */
function buildResponsesBody(anthropicBody) {
  const { model, effort } = resolveCodexModel(anthropicBody.model || '');
  const { instructions, input } = anthropicToResponsesInput(anthropicBody.system, anthropicBody.messages);
  const cacheKey = createHash('sha256').update(instructions).digest('hex').slice(0, 32);

  const body = {
    model,
    store: false,
    stream: true,
    instructions,
    input,
    tool_choice: anthropicToolChoiceToResponses(anthropicBody.tool_choice),
    parallel_tool_calls: true,
    reasoning: { effort, summary: 'auto' },
    text: { verbosity: 'medium' },
    prompt_cache_key: cacheKey,
  };
  const tools = anthropicToolsToResponses(anthropicBody.tools);
  // Always expose the built-in image generator so Codex models can produce
  // images on request. The model only invokes it when the user asks; ordinary
  // coding turns are unaffected. We pin PNG output so the chroma-key
  // transparency pass (saveGeneratedImage) can always decode the result.
  tools.push({ type: 'image_generation', output_format: 'png' });
  body.tools = tools;
  return body;
}

// ===========================================================================
// Anthropic SSE event writers
// ===========================================================================

function sse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Translates a stream of Codex Responses events into Anthropic Messages SSE.
 * Returns a finalize() that should be called when the upstream ends.
 */
function createStreamTranslator(res, model) {
  const messageId = `msg_${randomUUID().replace(/-/g, '')}`;
  let started = false;
  let nextBlockIndex = 0;
  // outputIndex -> { blockIndex, type: 'text'|'tool_use', argsSeen, closed }
  const byOutput = new Map();
  let sawToolUse = false;
  let stopReason = 'end_turn';
  let usage = { input_tokens: 0, output_tokens: 0 };

  function ensureStarted() {
    if (started) return;
    started = true;
    sse(res, 'message_start', {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model: model || 'codex',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  function openTextBlock(outputIndex) {
    ensureStarted();
    let st = byOutput.get(outputIndex);
    if (st && !st.closed) return st;
    const blockIndex = nextBlockIndex++;
    st = { blockIndex, type: 'text', argsSeen: false, closed: false };
    byOutput.set(outputIndex, st);
    sse(res, 'content_block_start', {
      type: 'content_block_start',
      index: blockIndex,
      content_block: { type: 'text', text: '' },
    });
    return st;
  }

  function openToolBlock(outputIndex, item) {
    ensureStarted();
    sawToolUse = true;
    let st = byOutput.get(outputIndex);
    if (st && !st.closed) return st;
    const blockIndex = nextBlockIndex++;
    st = { blockIndex, type: 'tool_use', argsSeen: false, closed: false, fullArgs: item.arguments || '' };
    byOutput.set(outputIndex, st);
    sse(res, 'content_block_start', {
      type: 'content_block_start',
      index: blockIndex,
      content_block: {
        type: 'tool_use',
        id: item.call_id || item.id || `toolu_${randomUUID().replace(/-/g, '')}`,
        name: item.name || '',
        input: {},
      },
    });
    return st;
  }

  // Emit a complete, self-contained text content block (start+delta+stop).
  // Used for synthetic content like a generated-image announcement that has no
  // streaming counterpart on the Anthropic side.
  function emitTextBlock(text) {
    ensureStarted();
    if (!text) return;
    const blockIndex = nextBlockIndex++;
    sse(res, 'content_block_start', {
      type: 'content_block_start',
      index: blockIndex,
      content_block: { type: 'text', text: '' },
    });
    sse(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: blockIndex,
      delta: { type: 'text_delta', text },
    });
    sse(res, 'content_block_stop', { type: 'content_block_stop', index: blockIndex });
  }

  function closeBlock(outputIndex) {
    const st = byOutput.get(outputIndex);
    if (!st || st.closed) return;
    // A tool call whose args never streamed: flush the complete arguments now.
    if (st.type === 'tool_use' && !st.argsSeen && st.fullArgs) {
      sse(res, 'content_block_delta', {
        type: 'content_block_delta',
        index: st.blockIndex,
        delta: { type: 'input_json_delta', partial_json: st.fullArgs },
      });
    }
    sse(res, 'content_block_stop', { type: 'content_block_stop', index: st.blockIndex });
    st.closed = true;
  }

  function handle(ev) {
    const type = typeof ev.type === 'string' ? ev.type : '';

    if (type === 'response.output_item.added') {
      const oi = typeof ev.output_index === 'number' ? ev.output_index : byOutput.size;
      const item = ev.item || {};
      if (item.type === 'function_call') {
        openToolBlock(oi, item);
      } else if (item.type === 'message') {
        // text block opened lazily on first delta
      }
      return;
    }

    if (type === 'response.output_text.delta') {
      const oi = typeof ev.output_index === 'number' ? ev.output_index : 0;
      const st = openTextBlock(oi);
      const text = typeof ev.delta === 'string' ? ev.delta : '';
      if (text) {
        sse(res, 'content_block_delta', {
          type: 'content_block_delta',
          index: st.blockIndex,
          delta: { type: 'text_delta', text },
        });
      }
      return;
    }

    if (type === 'response.function_call_arguments.delta') {
      const oi = typeof ev.output_index === 'number' ? ev.output_index : 0;
      const st = byOutput.get(oi);
      const delta = typeof ev.delta === 'string' ? ev.delta : '';
      if (st && st.type === 'tool_use' && delta) {
        st.argsSeen = true;
        sse(res, 'content_block_delta', {
          type: 'content_block_delta',
          index: st.blockIndex,
          delta: { type: 'input_json_delta', partial_json: delta },
        });
      }
      return;
    }

    if (type === 'response.output_item.done') {
      const oi = typeof ev.output_index === 'number' ? ev.output_index : 0;
      const item = ev.item || {};
      // A generated image: persist to disk and announce its path as text.
      if (item.type === 'image_generation_call' && typeof item.result === 'string' && item.result) {
        try {
          const saved = saveGeneratedImage(item.result, item.output_format);
          emitTextBlock(imageAnnouncement(saved.path, saved.transparent));
        } catch (err) {
          emitTextBlock(`\n\n_Image generation failed to save: ${err && err.message ? err.message : err}_\n`);
        }
        return;
      }
      // If a tool call arrived only in the .done event (no added/deltas), open+flush now.
      if (item.type === 'function_call' && !byOutput.has(oi)) {
        openToolBlock(oi, item);
      }
      closeBlock(oi);
      return;
    }

    if (type === 'response.completed' || type === 'response.done' || type === 'response.incomplete') {
      const r = ev.response || {};
      if (r.usage) {
        usage = {
          input_tokens: r.usage.input_tokens || 0,
          output_tokens: r.usage.output_tokens || 0,
        };
      }
      if (type === 'response.incomplete') stopReason = 'max_tokens';
      else stopReason = sawToolUse ? 'tool_use' : 'end_turn';
      // Close any still-open blocks defensively.
      for (const oi of byOutput.keys()) closeBlock(oi);
      return;
    }

    if (type === 'error' || type === 'response.failed') {
      const msg =
        (ev.message) ||
        (ev.response && ev.response.error && ev.response.error.message) ||
        'Codex stream error';
      throw new Error(String(msg));
    }
  }

  function finalize() {
    ensureStarted();
    for (const oi of byOutput.keys()) closeBlock(oi);
    sse(res, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: usage.output_tokens },
    });
    sse(res, 'message_stop', { type: 'message_stop' });
  }

  function buildNonStreamMessage() {
    // Used when the client requested a non-streaming response.
    return { messageId, model: model || 'codex', stopReason, usage };
  }

  return { handle, finalize, ensureStarted, buildNonStreamMessage, get sawToolUse() { return sawToolUse; } };
}

// ===========================================================================
// Upstream call + SSE parsing
// ===========================================================================

async function* parseUpstreamSSE(upstream, rearm) {
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rearm();
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = chunk
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('\n')
          .trim();
        if (data && data !== '[DONE]') {
          try {
            yield JSON.parse(data);
          } catch { /* malformed frame */ }
        }
        idx = buffer.indexOf('\n\n');
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
}

async function callCodex(responsesBody, signal) {
  let forcedRefresh = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { access, accountId } = await getCodexAccessToken(attempt > 0 && forcedRefresh);
    const res = await fetch(CODEX_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access}`,
        'chatgpt-account-id': accountId,
        originator: ORIGINATOR,
        'OpenAI-Beta': 'responses=experimental',
        accept: 'text/event-stream',
        'content-type': 'application/json',
        'x-client-request-id': randomUUID(),
      },
      body: JSON.stringify(responsesBody),
      signal,
    });
    if (res.status === 401 && !forcedRefresh) {
      forcedRefresh = true;
      await res.text().catch(() => '');
      continue;
    }
    return res;
  }
  throw new Error('Codex authentication failed after refresh.');
}

// ===========================================================================
// HTTP handlers
// ===========================================================================

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendError(res, status, message) {
  if (res.headersSent) {
    // Mid-stream: surface as an Anthropic error event.
    try {
      sse(res, 'error', { type: 'error', error: { type: 'api_error', message } });
    } catch { /* ignore */ }
    try { res.end(); } catch { /* ignore */ }
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type: status === 401 ? 'authentication_error' : 'api_error', message } }));
}

function approxTokens(anthropicBody) {
  // Rough heuristic (chars/4) — only used so the binary's pre-flight count
  // call doesn't fail; it does not affect billing or truncation.
  let chars = 0;
  const add = (v) => { if (typeof v === 'string') chars += v.length; };
  add(typeof anthropicBody.system === 'string' ? anthropicBody.system : '');
  for (const m of Array.isArray(anthropicBody.messages) ? anthropicBody.messages : []) {
    if (typeof m.content === 'string') add(m.content);
    else if (Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b && b.type === 'text') add(b.text);
        else if (b && b.type === 'tool_result') add(toolResultOutput(b.content));
        else if (b && b.type === 'tool_use') { try { add(JSON.stringify(b.input || {})); } catch { /* ignore */ } }
      }
    }
  }
  return Math.max(1, Math.ceil(chars / 4));
}

async function handleMessages(req, res) {
  let anthropicBody;
  try {
    anthropicBody = JSON.parse(await readBody(req));
  } catch {
    return sendError(res, 400, 'Invalid JSON body.');
  }

  const wantStream = anthropicBody.stream === true;
  let responsesBody;
  try {
    responsesBody = buildResponsesBody(anthropicBody);
  } catch (err) {
    return sendError(res, 400, `Failed to translate request: ${err.message}`);
  }

  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  const rearm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  };
  req.on('close', () => { try { controller.abort(); } catch { /* ignore */ } });

  let upstream;
  try {
    upstream = await callCodex(responsesBody, controller.signal);
  } catch (err) {
    clearTimeout(timer);
    return sendError(res, 401, err.message);
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    clearTimeout(timer);
    let message = `Codex ${upstream.status}: ${text.slice(0, 600)}`;
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.error && parsed.error.message) message = parsed.error.message;
    } catch { /* keep raw */ }
    return sendError(res, upstream.status === 429 ? 429 : 500, message);
  }

  if (wantStream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
  }

  const translator = createStreamTranslator(res, anthropicBody.model);

  // For non-streaming clients, accumulate text/tool calls and emit one JSON Message.
  const collected = wantStream ? null : { text: '', toolCalls: [], usage: { input_tokens: 0, output_tokens: 0 }, stopReason: 'end_turn', sawTool: false };

  try {
    for await (const ev of parseUpstreamSSE(upstream, rearm)) {
      if (wantStream) {
        translator.handle(ev);
      } else {
        accumulateNonStream(collected, ev);
      }
    }
    clearTimeout(timer);

    if (wantStream) {
      translator.finalize();
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(buildAnthropicMessage(anthropicBody.model, collected)));
    }
  } catch (err) {
    clearTimeout(timer);
    sendError(res, 500, err.message || 'Codex stream failed');
  }
}

function accumulateNonStream(collected, ev) {
  const type = typeof ev.type === 'string' ? ev.type : '';
  if (type === 'response.output_text.delta' && typeof ev.delta === 'string') {
    collected.text += ev.delta;
  } else if (type === 'response.output_item.done') {
    const item = ev.item || {};
    if (item.type === 'function_call') {
      collected.sawTool = true;
      collected.toolCalls.push({
        id: item.call_id || `toolu_${randomUUID().replace(/-/g, '')}`,
        name: item.name || '',
        arguments: item.arguments || '{}',
      });
    } else if (item.type === 'image_generation_call' && typeof item.result === 'string' && item.result) {
      try {
        const saved = saveGeneratedImage(item.result, item.output_format);
        collected.text += imageAnnouncement(saved.path, saved.transparent);
      } catch (err) {
        collected.text += `\n\n_Image generation failed to save: ${err && err.message ? err.message : err}_\n`;
      }
    }
  } else if (type === 'response.completed' || type === 'response.done' || type === 'response.incomplete') {
    const r = ev.response || {};
    if (r.usage) collected.usage = { input_tokens: r.usage.input_tokens || 0, output_tokens: r.usage.output_tokens || 0 };
    collected.stopReason = type === 'response.incomplete' ? 'max_tokens' : (collected.sawTool ? 'tool_use' : 'end_turn');
  } else if (type === 'error' || type === 'response.failed') {
    const msg = ev.message || (ev.response && ev.response.error && ev.response.error.message) || 'Codex stream error';
    throw new Error(String(msg));
  }
}

function buildAnthropicMessage(model, collected) {
  const content = [];
  if (collected.text) content.push({ type: 'text', text: collected.text });
  for (const c of collected.toolCalls) {
    let input = {};
    try { input = JSON.parse(c.arguments || '{}'); } catch { input = {}; }
    content.push({ type: 'tool_use', id: c.id, name: c.name, input });
  }
  return {
    id: `msg_${randomUUID().replace(/-/g, '')}`,
    type: 'message',
    role: 'assistant',
    model: model || 'codex',
    content,
    stop_reason: collected.stopReason,
    stop_sequence: null,
    usage: { input_tokens: collected.usage.input_tokens, output_tokens: collected.usage.output_tokens },
  };
}

async function handleCountTokens(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendError(res, 400, 'Invalid JSON body.');
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ input_tokens: approxTokens(body) }));
}

function requestHandler(req, res) {
  const url = (req.url || '').split('?')[0];
  if (req.method === 'POST' && url === '/v1/messages') {
    handleMessages(req, res).catch((err) => sendError(res, 500, err.message || 'Internal error'));
    return;
  }
  if (req.method === 'POST' && url === '/v1/messages/count_tokens') {
    handleCountTokens(req, res).catch((err) => sendError(res, 500, err.message || 'Internal error'));
    return;
  }
  if (req.method === 'GET' && url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: `No route for ${req.method} ${url}` } }));
}

/**
 * Start the proxy (idempotent) and return its base URL, e.g.
 * "http://127.0.0.1:53124". Bound to loopback only.
 */
function ensureCodexProxy() {
  if (_baseUrl) return Promise.resolve(_baseUrl);
  if (_starting) return _starting;
  _starting = new Promise((resolve, reject) => {
    const server = http.createServer(requestHandler);
    server.on('error', (err) => {
      _starting = null;
      reject(err);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      _server = server;
      _baseUrl = `http://127.0.0.1:${addr.port}`;
      console.log('[CodexProxy] Listening on', _baseUrl);
      resolve(_baseUrl);
    });
  });
  return _starting;
}

function stopCodexProxy() {
  if (_server) {
    try { _server.close(); } catch { /* ignore */ }
  }
  _server = null;
  _baseUrl = null;
  _starting = null;
}

module.exports = {
  ensureCodexProxy,
  stopCodexProxy,
  // Exported for unit tests:
  createStreamTranslator,
  resolveCodexModel,
  anthropicToResponsesInput,
  anthropicToolsToResponses,
  anthropicToolChoiceToResponses,
  buildResponsesBody,
  buildAnthropicMessage,
};
