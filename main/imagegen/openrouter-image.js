'use strict';

// ---------------------------------------------------------------------------
// OpenRouter image-generation tool (in-process SDK MCP server).
//
// The OpenRouter provider talks to openrouter.ai directly through the Claude
// Agent SDK (no local proxy like Codex), so it has no built-in image tool. This
// module exposes a `generate_image` tool — backed by an image-capable model on
// OpenRouter (default: google/gemini-3.1-flash-image-preview) — that the agent
// can call. It generates the image, optionally keys out a magenta/green chroma
// background for transparency, saves it to disk, and returns the file path so
// the agent can place it in the project and reference it.
// ---------------------------------------------------------------------------

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const { keyOutChroma } = require('./chroma');

const DEFAULT_IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function imageDir(override) {
  const base = (typeof override === 'string' && override.trim())
    ? override.trim()
    : path.join(os.homedir(), '.ai-agent', 'generated-images');
  try { fs.mkdirSync(base, { recursive: true }); } catch { /* best effort */ }
  return base;
}

/** Sanitize a caller-supplied filename to a safe basename (no path traversal). */
function safeBasename(name, ext) {
  let base = String(name || '').trim().replace(/\\/g, '/').split('/').pop() || '';
  base = base.replace(/\.[a-z0-9]+$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!base) base = `image-${Date.now()}-${randomUUID().slice(0, 8)}`;
  return `${base}.${ext}`;
}

/** Pull a base64 PNG/JPEG payload out of an OpenRouter chat-completions reply. */
function extractImageBase64(json) {
  const msg = json && json.choices && json.choices[0] && json.choices[0].message;
  if (!msg) return null;

  // Preferred: message.images = [{ image_url: { url: 'data:image/png;base64,...' } }]
  const imgs = Array.isArray(msg.images) ? msg.images : null;
  if (imgs) {
    for (const it of imgs) {
      const url = it && (it.image_url?.url || it.url || (typeof it === 'string' ? it : null));
      const b64 = dataUrlToBase64(url);
      if (b64) return b64;
    }
  }

  // Fallback: content parts may carry an image_url.
  if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      const url = part && (part.image_url?.url || (part.type === 'output_image' && part.url));
      const b64 = dataUrlToBase64(url);
      if (b64) return b64;
    }
  }
  return null;
}

function dataUrlToBase64(url) {
  if (typeof url !== 'string' || !url) return null;
  const m = url.match(/^data:image\/[a-z+]+;base64,(.+)$/i);
  if (m) return m[1];
  // Some providers return bare base64.
  if (/^[A-Za-z0-9+/=\s]+$/.test(url) && url.length > 256) return url.replace(/\s+/g, '');
  return null;
}

/**
 * Generate one image via OpenRouter and save it to disk.
 * @returns {Promise<{ path: string, transparent: boolean }>}
 */
async function generateAndSave({ apiKey, model, prompt, filename, transparent, saveDir }) {
  const body = {
    model: model || DEFAULT_IMAGE_MODEL,
    messages: [{ role: 'user', content: String(prompt || '') }],
    modalities: ['image', 'text'],
  };

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${String(apiKey || '').trim()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://codeon.app',
      'X-Title': 'Codeon',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenRouter image request failed (HTTP ${res.status}): ${text.slice(0, 400)}`);
  }

  const json = await res.json();
  const b64 = extractImageBase64(json);
  if (!b64) {
    throw new Error('OpenRouter returned no image. Ensure the model supports image output and the prompt requests an image.');
  }

  const raw = Buffer.from(b64, 'base64');
  let out = raw;
  let isTransparent = false;
  if (transparent) {
    const keyed = keyOutChroma(raw);
    if (keyed) { out = keyed; isTransparent = true; }
  }

  const file = path.join(imageDir(saveDir), safeBasename(filename, 'png'));
  fs.writeFileSync(file, out);
  return { path: file, transparent: isTransparent };
}

/**
 * Build an in-process SDK MCP server exposing the `generate_image` tool.
 * Returns null if the SDK helpers or API key are unavailable.
 *
 * @param {Object} opts
 * @param {string} opts.apiKey   OpenRouter API key
 * @param {string} [opts.model]  image model (default google/gemini-3.1-flash-image-preview)
 * @param {string} [opts.saveDir] directory to write images into
 */
function createImageMcpServer({ apiKey, model, saveDir } = {}) {
  if (!apiKey || !String(apiKey).trim()) return null;

  let createSdkMcpServer, tool, z;
  try {
    ({ createSdkMcpServer, tool } = require('@anthropic-ai/claude-agent-sdk'));
    ({ z } = require('zod'));
  } catch {
    return null;
  }
  if (typeof createSdkMcpServer !== 'function' || typeof tool !== 'function') return null;

  const imageTool = tool(
    'generate_image',
    'Generate an original image with an AI image model and save it to disk. Use this for hero visuals, product/feature imagery, illustrations, icons, a brand mark, textures, or an OG image. Returns the saved file path; reference or move that file in your project. For a TRANSPARENT cutout, set transparent=true AND prompt the subject on a solid pure magenta (#FF00FF) background filling the canvas (flat, no gradient/shadow). State one consistent art direction in every prompt so the set looks like one family.',
    {
      prompt: z.string().describe('Detailed description of the image AND its art direction (style, palette, lighting, perspective).'),
      filename: z.string().optional().describe('Desired file name, e.g. "hero.png" or "product-chair.png". A .png extension is enforced.'),
      transparent: z.boolean().optional().describe('Set true for a cutout that needs a transparent background; you MUST also prompt a solid pure magenta (#FF00FF) backdrop.'),
    },
    async (args) => {
      try {
        const { path: file, transparent } = await generateAndSave({
          apiKey,
          model,
          prompt: args.prompt,
          filename: args.filename,
          transparent: !!args.transparent,
          saveDir,
        });
        const note = transparent
          ? ' (background keyed out to transparency)'
          : '';
        return {
          content: [{
            type: 'text',
            text: `Image saved to: ${file}${note}\nMove or copy this file into your project's asset folder (e.g. public/assets/) and reference it from there with appropriate width/height and alt text.`,
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Image generation failed: ${err?.message || String(err)}` }],
          isError: true,
        };
      }
    }
  );

  return createSdkMcpServer({
    name: 'codeon_image',
    version: '1.0.0',
    tools: [imageTool],
  });
}

module.exports = { createImageMcpServer, generateAndSave, DEFAULT_IMAGE_MODEL };
