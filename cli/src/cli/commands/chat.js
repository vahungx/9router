/**
 * `9router chat` — talk to any model the local gateway serves, straight from the
 * terminal. No IDE, no editor extension.
 *
 * One prompt:      9router chat "explain this regex"
 * Piped input:     git diff | 9router chat "review this"
 * Interactive:     9router chat            (REPL, keeps conversation history)
 *
 * Works with every model the gateway exposes — ag/ (Antigravity), cc/ (Claude),
 * cx/ (Codex), kr/ (Kiro), combos — because it speaks the gateway's
 * OpenAI-compatible /v1/chat/completions, which is provider-agnostic.
 *
 * Responses stream token by token. The API key is read from the gateway rather
 * than a flag, so it never lands in shell history.
 */

const http = require("http");
const https = require("https");
const readline = require("readline");
const fs = require("fs");
const api = require("../api/client");

const DEFAULT_PORT = 20128;
const DEFAULT_HOST = "localhost";
const REQUEST_TIMEOUT_MS = 600000;

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
};

const HELP = `
Usage: 9router chat [prompt] [options]

Chat with any model your 9Router gateway serves, from the terminal.

Modes:
  9router chat "your question"        One-shot: print the answer and exit
  cat file | 9router chat "summarise" Piped stdin is appended to the prompt
  9router chat                        Interactive REPL (keeps history)

Options:
  -m, --model <id>    Model to use (e.g. cc/claude-sonnet-4-5, ag/gemini-3.8-flash)
                      Defaults to $NINEROUTER_MODEL, else the first model available
  -s, --system <txt>  System prompt
      --temperature <n>  Sampling temperature
      --max-tokens <n>   Cap the response length
      --no-stream     Wait for the whole reply instead of streaming it
      --models        List available models and exit
      --json          Print the raw API response (implies --no-stream)
  -p, --port <port>   Gateway port (default: ${DEFAULT_PORT})
  -h, --help          Show this message

REPL commands:
  /model <id>   Switch model          /system <txt>  Set system prompt
  /clear        Forget the history     /models        List models
  /exit         Quit (or Ctrl+D)

Examples:
  9router chat --models
  9router chat -m cc/claude-sonnet-4-5 "write a haiku about DNS"
  git diff | 9router chat "review these changes"
  9router chat -s "You reply only in Vietnamese" "what is a proxy?"
`;

/**
 * Parse argv. Everything that is not a flag becomes the prompt.
 * @param {Array<string>} argv
 * @returns {Object}
 */
function parseArgs(argv) {
  const out = {
    prompt: "", model: "", system: "", temperature: null, maxTokens: null,
    stream: true, json: false, listModels: false, port: DEFAULT_PORT, help: false,
  };
  const words = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--models") out.listModels = true;
    else if (a === "--no-stream") out.stream = false;
    else if (a === "--json") { out.json = true; out.stream = false; }
    else if (a === "-m" || a === "--model") out.model = argv[++i] || "";
    else if (a === "-s" || a === "--system") out.system = argv[++i] || "";
    else if (a === "--temperature") out.temperature = parseFloat(argv[++i]);
    else if (a === "--max-tokens") out.maxTokens = parseInt(argv[++i], 10);
    else if (a === "-p" || a === "--port") out.port = parseInt(argv[++i], 10) || DEFAULT_PORT;
    else words.push(a);
  }

  out.prompt = words.join(" ");
  return out;
}

/**
 * Read piped stdin, if any. Returns "" when attached to a terminal.
 * @returns {Promise<string>}
 */
function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

/**
 * Fetch the gateway's first API key so the user never has to pass one.
 * Distinguishes "gateway is down" from "gateway has no keys" — they need
 * different fixes, so they must not share one message.
 * @returns {Promise<{key: string|null, reachable: boolean}>}
 */
async function getApiKey() {
  const result = await api.getApiKeys();
  if (!result.success) {
    const msg = String(result.error || "");
    const unreachable = msg.startsWith("Network error") || msg === "Request timeout";
    return { key: null, reachable: !unreachable };
  }
  return { key: (result.data.keys || [])[0]?.key || null, reachable: true };
}

/**
 * List model ids the gateway currently serves.
 * @returns {Promise<Array<string>>}
 */
async function listModels() {
  const result = await api.getAvailableModels();
  if (!result.success) return [];
  return (result.data.data || []).map((m) => m.id);
}

/**
 * Group model ids by their provider prefix for display.
 * @param {Array<string>} ids
 * @returns {Object}
 */
function groupModels(ids) {
  const groups = {};
  for (const id of ids) {
    const prefix = id.includes("/") ? id.split("/")[0] : "other";
    (groups[prefix] = groups[prefix] || []).push(id);
  }
  return groups;
}

/**
 * POST /v1/chat/completions, streaming deltas to onDelta as they arrive.
 *
 * @param {Object} opts - { host, port, apiKey, body, stream, onDelta }
 * @returns {Promise<Object>} { status, text, raw }
 */
function chatRequest({ host, port, apiKey, body, stream, onDelta }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const mod = port === 443 ? https : http;

    const req = mod.request({
      hostname: host,
      port,
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        Authorization: `Bearer ${apiKey}`,
        Accept: stream ? "text/event-stream" : "application/json",
      },
    }, (res) => {
      // An error response is JSON even when the request asked for a stream.
      const isError = res.statusCode >= 400;

      if (!stream || isError) {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let parsed = null;
          try { parsed = data ? JSON.parse(data) : null; } catch { /* keep raw */ }
          resolve({ status: res.statusCode, raw: data, json: parsed, text: parsed?.choices?.[0]?.message?.content || "" });
        });
        return;
      }

      let buffer = "";
      let text = "";
      res.setEncoding("utf8");

      res.on("data", (chunk) => {
        buffer += chunk;
        // SSE frames are separated by a blank line; keep the tail for the next chunk.
        const frames = buffer.split("\n");
        buffer = frames.pop() || "";

        for (const line of frames) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payloadText = trimmed.slice(5).trim();
          if (!payloadText || payloadText === "[DONE]") continue;

          try {
            const evt = JSON.parse(payloadText);
            const delta = evt.choices?.[0]?.delta?.content;
            if (delta) { text += delta; onDelta?.(delta); }
          } catch { /* partial frame — the next chunk completes it */ }
        }
      });

      res.on("end", () => resolve({ status: res.statusCode, text, raw: null, json: null }));
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Turn a failed response into a sentence the user can act on.
 * @param {Object} result
 * @returns {string}
 */
function describeError(result) {
  const msg = result.json?.error?.message || result.raw || `HTTP ${result.status}`;
  if (/\[403\]/.test(msg)) {
    return `${msg}\n${C.dim}The provider refused the request. Try another model with -m, or --models to see what is available.${C.reset}`;
  }
  if (result.status === 401) {
    return "Gateway rejected the API key. Create one in the dashboard or the 9router TUI.";
  }
  return msg;
}

/**
 * Send one turn and print the reply.
 * @param {Object} ctx - { host, port, apiKey, model, messages, opts }
 * @returns {Promise<string|null>} Assistant text, or null on failure
 */
async function sendTurn(ctx) {
  const { host, port, apiKey, model, messages, opts } = ctx;

  const body = { model, messages, stream: opts.stream };
  if (opts.temperature !== null && !Number.isNaN(opts.temperature)) body.temperature = opts.temperature;
  if (opts.maxTokens && !Number.isNaN(opts.maxTokens)) body.max_tokens = opts.maxTokens;

  let result;
  try {
    result = await chatRequest({
      host, port, apiKey, body, stream: opts.stream,
      onDelta: (d) => process.stdout.write(d),
    });
  } catch (err) {
    if (/ECONNREFUSED/.test(err.message)) {
      console.error(`${C.red}Cannot reach 9Router on port ${port}. Is the gateway running?${C.reset}`);
    } else {
      console.error(`${C.red}${err.message}${C.reset}`);
    }
    return null;
  }

  if (result.status >= 400) {
    if (opts.stream) process.stdout.write("\n");
    console.error(`${C.red}${describeError(result)}${C.reset}`);
    return null;
  }

  if (opts.json) {
    console.log(result.raw);
    return result.text;
  }

  if (opts.stream) process.stdout.write("\n");
  else console.log(result.text);

  return result.text;
}

/**
 * Interactive REPL. Keeps the conversation so follow-up questions have context.
 * @param {Object} ctx
 * @returns {Promise<number>}
 */
async function runRepl(ctx) {
  const { model: startModel, opts } = ctx;
  let model = startModel;
  let system = opts.system;
  const messages = system ? [{ role: "system", content: system }] : [];

  console.log(`${C.bold}9Router chat${C.reset} ${C.dim}— ${model}${C.reset}`);
  console.log(`${C.dim}/model /system /clear /models /exit${C.reset}\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  for (;;) {
    const line = (await ask(`${C.cyan}you ${C.reset}`)).trim();

    if (line === "" ) continue;
    if (line === "/exit" || line === "/quit") break;

    if (line === "/clear") {
      messages.length = 0;
      if (system) messages.push({ role: "system", content: system });
      console.log(`${C.dim}history cleared${C.reset}\n`);
      continue;
    }

    if (line === "/models") {
      const groups = groupModels(await listModels());
      for (const [prefix, ids] of Object.entries(groups)) {
        console.log(`${C.dim}[${prefix}]${C.reset} ${ids.join(", ")}`);
      }
      console.log();
      continue;
    }

    if (line.startsWith("/model")) {
      const next = line.slice(6).trim();
      if (!next) { console.log(`${C.dim}current: ${model}${C.reset}\n`); continue; }
      model = next;
      console.log(`${C.dim}model → ${model}${C.reset}\n`);
      continue;
    }

    if (line.startsWith("/system")) {
      system = line.slice(7).trim();
      const idx = messages.findIndex((m) => m.role === "system");
      if (idx >= 0) messages[idx].content = system;
      else messages.unshift({ role: "system", content: system });
      console.log(`${C.dim}system prompt set${C.reset}\n`);
      continue;
    }

    if (line.startsWith("/")) {
      console.log(`${C.yellow}Unknown command. Try /model /system /clear /models /exit${C.reset}\n`);
      continue;
    }

    messages.push({ role: "user", content: line });
    process.stdout.write(`${C.green}ai  ${C.reset}`);

    const reply = await sendTurn({ ...ctx, model, messages, opts });
    if (reply === null) {
      messages.pop();       // drop the turn that failed so history stays valid
      console.log();
      continue;
    }
    messages.push({ role: "assistant", content: reply });
    console.log();
  }

  rl.close();
  return 0;
}

/**
 * Entry point.
 * @param {Array<string>} argv - Arguments after `chat`
 * @returns {Promise<number>} Exit code
 */
async function run(argv) {
  const opts = parseArgs(argv);

  if (opts.help) {
    console.log(HELP.trim());
    return 0;
  }

  api.configure({ port: opts.port });
  const host = DEFAULT_HOST;

  if (opts.listModels) {
    const ids = await listModels();
    if (ids.length === 0) {
      console.error(`Cannot reach 9Router on port ${opts.port}, or no models are configured.`);
      return 1;
    }
    for (const [prefix, list] of Object.entries(groupModels(ids))) {
      console.log(`${C.bold}[${prefix}]${C.reset}`);
      for (const id of list) console.log(`  ${id}`);
    }
    return 0;
  }

  const { key: apiKey, reachable } = await getApiKey();
  if (!reachable) {
    console.error(`Cannot reach 9Router on port ${opts.port}. Is the gateway running?`);
    return 1;
  }
  if (!apiKey) {
    console.error("No API key found. Create one in the dashboard or run `9router` → API Keys.");
    return 1;
  }

  // Model precedence: flag → env → first model the gateway offers.
  let model = opts.model || process.env.NINEROUTER_MODEL || "";
  if (!model) {
    const ids = await listModels();
    if (ids.length === 0) {
      console.error(`Cannot reach 9Router on port ${opts.port}. Is the gateway running?`);
      return 1;
    }
    model = ids[0];
  }

  const piped = await readStdin();
  const prompt = [opts.prompt, piped].filter((s) => s && s.trim()).join("\n\n");

  // No prompt and a terminal attached → interactive. Piped-but-empty is an error,
  // since a script that meant to send something should not silently open a REPL.
  if (!prompt) {
    if (!process.stdin.isTTY) {
      console.error("No prompt given on stdin.");
      return 1;
    }
    return runRepl({ host, port: opts.port, apiKey, model, opts });
  }

  const messages = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });

  const reply = await sendTurn({ host, port: opts.port, apiKey, model, messages, opts });
  return reply === null ? 1 : 0;
}

module.exports = { run, parseArgs, groupModels, describeError };
