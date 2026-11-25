// AI drafts of picture descriptions (issue #87), through Anthropic's Messages API with the
// official SDK (@anthropic-ai/sdk, a dev dependency: the published MCP server never loads it).
//
// The request follows the documentation, read 2026-11-25 (claude-api skill, cached
// 2026-11-03, and https://platform.claude.com/docs/en/build-with-claude/vision):
//   - one user message: an `image` block with a base64 source (`media_type` image/jpeg, png,
//     gif or webp; BMP files are converted to PNG first), then a `text` block with the context;
//   - per image: at most 8000x8000 px and 10 MB base64 on the Claude API. Larger images are
//     downscaled by the server, not refused, so nothing is resized here; the largest used
//     image is 3559x4024 px and 1.35 MB (July 2026);
//   - JSON output through `output_config.format` ({ type: "json_schema", schema }), and
//     `output_config.effort`;
//   - the SDK sends the key as `Authorization: Bearer` with anthropic-version 2026-10-21, which
//     rejects temperature, top_p and top_k (never sent here);
//   - no `thinking` field: on Claude Fable 5.2 and Claude Opus 5.5 thinking is always on, and
//     sending a disabled or budgeted thinking config is a 400;
//   - on models that can decline a request for safety reasons and accept server-side
//     fallbacks (FALLBACK_MODELS), `fallbacks: "default"` with the beta
//     `server-side-fallback-2026-07-01`, on `client.beta.messages.create`. A refusal comes back
//     as HTTP 200 with stop_reason "refusal"; it is reported, and nothing is stored.
//
// No request is ever sent without --yes. Tests replace the HTTP layer through the SDK's own
// `fetch` option.

import Anthropic from "@anthropic-ai/sdk";
import { displayable } from "./image-info.js";
import { imageBytes } from "./inventory.js";
import { readStore, saveDraft } from "./store.js";

export const DEFAULT_MODEL = "claude-fable-5-2";
export const DEFAULT_EFFORT = "high";
export const MAX_TOKENS = 16000;
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
// Models whose docs recommend the server-side fallback (claude-api skill, 2026-11-03).
export const FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

// List prices in US dollars per million tokens (input, output), from the claude-api skill's
// table cached 2026-11-03. Used only for the estimate printed before a run.
export const PRICES = {
  "claude-fable-5-2": [8, 40],
  "claude-fable-5-1": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};
// Output per picture assumed for the estimate, thinking included (thinking is billed as
// output). A guess, not a measurement: the first real run should replace it.
export const ASSUMED_OUTPUT_TOKENS = 3000;
const MAX_LONG_EDGE = 2576;
const MAX_VISUAL_TOKENS = 4784;

export const SYSTEM_PROMPT = `You write text alternatives for pictures in New York City's laws (the Administrative Code and the Rules of the City of New York), for BetaNYC's Law Reader. People who cannot see the picture will read or hear your text in place of it, inside the law.

Return JSON with three fields:
- alt: the alt text.
- long: a longer description, or "" when the alt text is enough.
- unsure: what you could not read or are not sure of, or "" when there is nothing.

How to write them:
- If the picture sits inside a sentence (the request says "inline"), the alt text must read as part of that sentence. Read the sentence with your alt text in place of [this picture] and make sure it still makes sense. For example, in "Warning: [this picture] indicates that the sodium (salt) content...", the alt text is "the sodium warning icon (a salt shaker in a triangle)", not a sentence of its own.
- If the picture is a symbol or a few letters or characters, the alt text is exactly those characters (for example "Ψ").
- If the picture is text, a sign, or a form, give its words exactly as written, in reading order.
- For a map, diagram, chart, graph, or a table drawn as a picture, keep the alt text short (at most about 150 characters: what it is and what it shows) and put the content in long: every label, number, unit and dimension that matters, and tables row by row with their column headings.
- Do not repeat a caption or figure number the surrounding text already gives; you may refer to it.
- Never invent text, numbers, or labels you cannot read. Write [illegible] in their place and say so in unsure.
- If the picture and the surrounding text disagree (for example a different number), describe what the picture shows and note the difference in unsure. Do not correct it.
- Do not start with "Image of" or "Picture of". Use plain language and American English.
- Do not name or identify any person shown.`;

export const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    alt: { type: "string" },
    long: { type: "string" },
    unsure: { type: "string" },
  },
  required: ["alt", "long", "unsure"],
  additionalProperties: false,
};

const BOOK_NAMES = { admin_code: "New York City Administrative Code", rules: "Rules of the City of New York" };
export const MAX_USES_IN_PROMPT = 3;

/** The text block that goes with the image. */
export function contextText(book, image) {
  const uses = image.uses.slice(0, MAX_USES_IN_PROMPT);
  const parts = [
    `Book: ${BOOK_NAMES[book] ?? book}`,
    `The same picture is used ${image.uses.length} time${image.uses.length === 1 ? "" : "s"}${image.uses.length > uses.length ? `; the first ${uses.length} are shown` : ""}. Write one description that works in each place.`,
  ];
  uses.forEach((u, i) => {
    parts.push(
      "",
      `--- Use ${i + 1}: ${!u.heading || u.heading.startsWith(u.citation) ? u.heading || u.citation : `${u.citation} — ${u.heading}`} ---`,
      u.inline ? "Placement: inline (the picture sits inside a sentence)." : "Placement: on its own line.",
      `Paragraph holding the picture: ${u.paragraph}`,
      "",
      "Text before:",
      u.before || "(none)",
      "",
      "Text after:",
      u.after || "(none)",
    );
  });
  return parts.join("\n");
}

/** The Messages API request for one image (`bytes` is the file from the zip). */
export function buildRequest({ book, image, bytes, model = DEFAULT_MODEL, effort = DEFAULT_EFFORT, fallbacks = true }) {
  const shown = displayable(bytes);
  const base64 = shown.bytes.toString("base64");
  if (image.width > 8000 || image.height > 8000) throw new Error(`${image.file} is larger than 8000 px; resize it first`);
  if (base64.length > 10 * 1024 * 1024) throw new Error(`${image.file} is over 10 MB in base64; resize it first`);
  const req = {
    model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    output_config: { effort, format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: shown.mediaType, data: base64 } },
          { type: "text", text: contextText(book, image) },
        ],
      },
    ],
  };
  if (fallbacks && FALLBACK_MODELS.has(model)) {
    req.betas = [FALLBACK_BETA];
    req.fallbacks = "default";
  }
  return req;
}

/** Visual tokens for an image: ⌈w/28⌉ × ⌈h/28⌉ after the server's downscale (vision docs). */
export function visualTokens(width, height) {
  if (!width || !height) return MAX_VISUAL_TOKENS;
  let s = Math.min(1, MAX_LONG_EDGE / Math.max(width, height));
  let w = Math.max(1, Math.floor(width * s));
  let h = Math.max(1, Math.floor(height * s));
  let t = Math.ceil(w / 28) * Math.ceil(h / 28);
  if (t > MAX_VISUAL_TOKENS) {
    s = Math.sqrt(MAX_VISUAL_TOKENS / t);
    w = Math.floor(w * s);
    h = Math.floor(h * s);
    t = Math.min(MAX_VISUAL_TOKENS, Math.ceil(w / 28) * Math.ceil(h / 28));
  }
  return t;
}

/** A rough estimate for a list of { book, image } jobs: tokens in and out, and dollars. */
export function estimate(jobs, model = DEFAULT_MODEL) {
  let input = 0;
  for (const { book, image } of jobs) {
    const text = SYSTEM_PROMPT.length + contextText(book, image).length;
    input += visualTokens(image.width, image.height) + Math.ceil(text / 3.5);
  }
  const output = jobs.length * ASSUMED_OUTPUT_TOKENS;
  const price = PRICES[model];
  const dollars = price ? (input * price[0] + output * price[1]) / 1e6 : null;
  return { requests: jobs.length, input, output, dollars };
}

/** Which images still need a draft. */
export function pendingJobs(inventories, storeDir, { force = false, limit = Infinity, only = null } = {}) {
  const jobs = [];
  for (const inv of inventories) {
    const store = readStore(storeDir, inv.book);
    for (const image of inv.images) {
      if (only && !image.image_ids.some((id) => only.includes(id)) && !only.includes(image.sha256)) continue;
      if (!force && store.images[image.sha256]?.draft) continue;
      jobs.push({ book: inv.book, image });
    }
  }
  return jobs.slice(0, limit);
}

/** Parse a Messages API response into { draft } or { error }. */
export function readResponse(message) {
  if (message.stop_reason === "refusal") {
    const cat = message.stop_details?.category;
    return { error: `declined by the model (refusal${cat ? `, ${cat}` : ""})` };
  }
  if (message.stop_reason === "max_tokens") return { error: "ran out of output tokens (max_tokens)" };
  const text = (message.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    return { error: "the answer was not JSON" };
  }
  if (typeof out?.alt !== "string" || typeof out?.long !== "string") return { error: "the answer is missing alt or long" };
  return { draft: { alt: out.alt.trim(), long: out.long.trim(), unsure: String(out.unsure ?? "").trim() } };
}

export function makeClient({ apiKey, fetch } = {}) {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  return new Anthropic({ apiKey, ...(fetch ? { fetch } : {}), maxRetries: 2 });
}

/**
 * Draft each job and store it as it arrives. Returns { done, failed, usage }. `log` gets one
 * line per picture; it never sees the API key.
 */
export async function runDrafts({ jobs, sources, storeDir, client, model = DEFAULT_MODEL, effort = DEFAULT_EFFORT, fallbacks = true, concurrency = 2, log = console.log }) {
  const usage = { input: 0, output: 0 };
  let done = 0;
  const failed = [];
  let next = 0;
  let stop = null;
  const one = async (job) => {
    const label = `${job.book} ${job.image.image_ids[0]} (${job.image.uses[0]?.citation ?? ""})`;
    try {
      const bytes = imageBytes(sources[job.book], job.image);
      const req = buildRequest({ book: job.book, image: job.image, bytes, model, effort, fallbacks });
      const message = await client.beta.messages.create(req);
      usage.input += message.usage?.input_tokens ?? 0;
      usage.output += message.usage?.output_tokens ?? 0;
      const r = readResponse(message);
      if (r.error) {
        failed.push({ ...job, error: r.error });
        log(`  ✗ ${label}: ${r.error}`);
        return;
      }
      await saveDraft(storeDir, job.book, job.image, { draft: r.draft, model: message.model ?? model });
      done++;
      log(`  ✓ ${label}${message.model && message.model !== model ? ` (answered by ${message.model})` : ""}`);
    } catch (e) {
      const status = e instanceof Anthropic.APIError ? e.status : undefined;
      const msg = e instanceof Anthropic.AuthenticationError ? "the API key was refused" : e instanceof Anthropic.APIError ? `API error ${status ?? ""}`.trim() : e.message;
      failed.push({ ...job, error: msg });
      log(`  ✗ ${label}: ${msg}`);
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) stop = msg;
    }
  };
  const worker = async () => {
    while (next < jobs.length && !stop) await one(jobs[next++]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, worker));
  return { done, failed, usage, stopped: stop };
}
