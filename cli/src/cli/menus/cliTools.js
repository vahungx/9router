const api = require("../api/client");
const { pause, confirm, promptPassword } = require("../utils/input");
const { showStatus } = require("../utils/display");
const { selectModelFromList } = require("../utils/modelSelector");
const { showMenuWithBack } = require("../utils/menuHelper");
const { getEndpoint } = require("../utils/endpoint");
const { listMitmTools } = require("./mitmTools");

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m"
};

// Claude model types with defaults (matching Web UI)
const CLAUDE_MODEL_TYPES = [
  { id: "sonnet", name: "Sonnet", envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL", defaultValue: "cc/claude-sonnet-4-5-20250929" },
  { id: "opus",   name: "Opus",   envKey: "ANTHROPIC_DEFAULT_OPUS_MODEL",   defaultValue: "cc/claude-opus-4-5-20251101" },
  { id: "haiku",  name: "Haiku",  envKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL",  defaultValue: "cc/claude-haiku-4-5-20251001" },
];

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Get first available API key from server
 * @returns {Promise<string|null>}
 */
async function getFirstApiKey() {
  const result = await api.getApiKeys();
  const keys = result.success ? (result.data.keys || []) : [];
  return keys.length > 0 ? keys[0].key : null;
}

// ─── Claude Code ──────────────────────────────────────────────────────────────

/**
 * Build header showing current Claude config status
 * @returns {Promise<string>}
 */
async function buildClaudeHeader() {
  const result = await api.getCliToolSettings("claude");
  if (!result.success) return `  ${COLORS.red}Failed to load settings${COLORS.reset}`;

  const settings = result.data.settings;
  const currentUrl = settings?.env?.ANTHROPIC_BASE_URL;
  const currentKey = settings?.env?.ANTHROPIC_AUTH_TOKEN;
  const lines = [];

  if (currentUrl) {
    lines.push(`Status:   ${COLORS.green}✓ Configured${COLORS.reset}`);
    lines.push(`Endpoint: ${COLORS.cyan}${currentUrl}${COLORS.reset}`);
    if (currentKey) {
      lines.push(`API Key:  ${COLORS.dim}${currentKey.substring(0, 10)}...${COLORS.reset}`);
    }
  } else {
    lines.push(`Status:   ${COLORS.red}✗ Not configured${COLORS.reset}`);
    lines.push(`${COLORS.dim}Run "Quick Setup" to configure${COLORS.reset}`);
  }

  return lines.join("\n");
}

/**
 * Get current Claude model from settings
 * @param {string} envKey
 * @returns {Promise<string>}
 */
async function getClaudeModel(envKey) {
  const result = await api.getCliToolSettings("claude");
  return result.success ? (result.data.settings?.env?.[envKey] || "Not set") : "Not set";
}

/**
 * Quick setup for Claude Code — sets endpoint, key, and all default models
 * @param {number} port
 */
async function claudeQuickSetup(port) {
  const { endpoint } = await getEndpoint(port);
  const apiKey = await getFirstApiKey();

  if (!apiKey) {
    showStatus("No API keys found. Create one in API Keys menu first.", "error");
    await pause();
    return;
  }

  const env = { ANTHROPIC_BASE_URL: endpoint, ANTHROPIC_AUTH_TOKEN: apiKey, API_TIMEOUT_MS: "600000" };
  CLAUDE_MODEL_TYPES.forEach(t => { env[t.envKey] = t.defaultValue; });

  const result = await api.applyCliToolSettings("claude", { env });
  showStatus(result.success ? "Quick Setup completed!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Select and save a specific Claude model type
 * @param {Object} modelType
 * @param {number} port
 */
async function claudeSelectModel(modelType, port) {
  const current = await getClaudeModel(modelType.envKey);
  const selected = await selectModelFromList(`Select ${modelType.name} Model`, current, { excludeCombos: true });
  if (!selected) return;

  const env = { [modelType.envKey]: selected };

  // Also set base URL if not configured yet
  const settingsResult = await api.getCliToolSettings("claude");
  if (!settingsResult.data?.settings?.env?.ANTHROPIC_BASE_URL) {
    const { endpoint } = await getEndpoint(port);
    const apiKey = await getFirstApiKey();
    env.ANTHROPIC_BASE_URL = endpoint;
    env.API_TIMEOUT_MS = "600000";
    if (apiKey) env.ANTHROPIC_AUTH_TOKEN = apiKey;
  }

  const result = await api.applyCliToolSettings("claude", { env });
  showStatus(result.success ? `${modelType.name} → ${selected} saved!` : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Reset Claude Code settings
 */
async function claudeReset() {
  const result = await api.resetCliToolSettings("claude");
  showStatus(result.success ? "Settings reset successfully!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Claude Code submenu
 * @param {number} port
 * @param {Array<string>} breadcrumb
 */
async function showClaudeCodeMenu(port, breadcrumb = []) {
  await showMenuWithBack({
    title: "🔧 Claude Code Settings",
    breadcrumb,
    headerContent: buildClaudeHeader,
    refresh: async () => ({
      sonnet: await getClaudeModel("ANTHROPIC_DEFAULT_SONNET_MODEL"),
      opus:   await getClaudeModel("ANTHROPIC_DEFAULT_OPUS_MODEL"),
      haiku:  await getClaudeModel("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
    }),
    items: [
      {
        label: "⚡ Quick Setup (recommended)",
        action: async () => { await claudeQuickSetup(port); return true; }
      },
      {
        label: (d) => `Sonnet → ${d.sonnet}`,
        action: async () => { await claudeSelectModel(CLAUDE_MODEL_TYPES[0], port); return true; }
      },
      {
        label: (d) => `Opus → ${d.opus}`,
        action: async () => { await claudeSelectModel(CLAUDE_MODEL_TYPES[1], port); return true; }
      },
      {
        label: (d) => `Haiku → ${d.haiku}`,
        action: async () => { await claudeSelectModel(CLAUDE_MODEL_TYPES[2], port); return true; }
      },
      {
        label: "Reset to Default",
        action: async () => { await claudeReset(); return true; }
      }
    ]
  });
}

// ─── Codex CLI ────────────────────────────────────────────────────────────────

/**
 * Build header showing current Codex config status
 * @returns {Promise<string>}
 */
async function buildCodexHeader() {
  const result = await api.getCliToolSettings("codex");
  if (!result.success) return `  ${COLORS.red}Failed to load settings${COLORS.reset}`;

  const { installed, has9Router, config } = result.data;
  if (!installed) return `Status:   ${COLORS.red}✗ Codex CLI not installed${COLORS.reset}`;

  if (!has9Router) {
    return [
      `Status:   ${COLORS.red}✗ Not configured${COLORS.reset}`,
      `${COLORS.dim}Run "Quick Setup" to configure${COLORS.reset}`
    ].join("\n");
  }

  // Parse base_url and model from raw TOML string
  const baseUrlMatch = config && config.match(/base_url\s*=\s*"([^"]+)"/);
  const modelMatch = config && config.match(/^model\s*=\s*"([^"]+)"/m);
  const baseUrl = baseUrlMatch ? baseUrlMatch[1] : "";
  const model = modelMatch ? modelMatch[1] : "";

  const lines = [`Status:   ${COLORS.green}✓ Configured${COLORS.reset}`];
  if (baseUrl) lines.push(`Endpoint: ${COLORS.cyan}${baseUrl}${COLORS.reset}`);
  if (model)   lines.push(`Model:    ${COLORS.dim}${model}${COLORS.reset}`);
  return lines.join("\n");
}

/**
 * Quick setup for Codex CLI
 * @param {number} port
 */
async function codexQuickSetup(port) {
  const { endpoint } = await getEndpoint(port);
  const apiKey = await getFirstApiKey();

  if (!apiKey) {
    showStatus("No API keys found. Create one in API Keys menu first.", "error");
    await pause();
    return;
  }

  // Get model selection
  const model = await selectModelFromList("Select Codex Model", "cx/claude-sonnet-4-5-20250929", { excludeCombos: true });
  if (!model) return;

  const result = await api.applyCliToolSettings("codex", { baseUrl: endpoint, apiKey, model });
  showStatus(result.success ? "Codex setup completed!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Reset Codex CLI settings
 */
async function codexReset() {
  const result = await api.resetCliToolSettings("codex");
  showStatus(result.success ? "Codex settings reset!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Codex CLI submenu
 * @param {number} port
 * @param {Array<string>} breadcrumb
 */
async function showCodexMenu(port, breadcrumb = []) {
  await showMenuWithBack({
    title: "🤖 Codex CLI Settings",
    breadcrumb,
    headerContent: buildCodexHeader,
    refresh: async () => ({}),
    items: [
      {
        label: "⚡ Quick Setup",
        action: async () => { await codexQuickSetup(port); return true; }
      },
      {
        label: "Reset to Default",
        action: async () => { await codexReset(); return true; }
      }
    ]
  });
}

// ─── Factory Droid ────────────────────────────────────────────────────────────

/**
 * Build header showing current Droid config status
 * @returns {Promise<string>}
 */
async function buildDroidHeader() {
  const result = await api.getCliToolSettings("droid");
  if (!result.success) return `  ${COLORS.red}Failed to load settings${COLORS.reset}`;

  const { installed, has9Router, settings } = result.data;
  if (!installed) return `Status:   ${COLORS.red}✗ Factory Droid not installed${COLORS.reset}`;

  if (!has9Router) {
    return [
      `Status:   ${COLORS.red}✗ Not configured${COLORS.reset}`,
      `${COLORS.dim}Run "Quick Setup" to configure${COLORS.reset}`
    ].join("\n");
  }

  // Extract 9Router custom model config
  const custom = settings?.customModels?.find(m => m.id === "custom:9Router-0");
  const lines = [`Status:   ${COLORS.green}✓ Configured${COLORS.reset}`];
  if (custom?.baseUrl) lines.push(`Endpoint: ${COLORS.cyan}${custom.baseUrl}${COLORS.reset}`);
  if (custom?.model)   lines.push(`Model:    ${COLORS.dim}${custom.model}${COLORS.reset}`);
  return lines.join("\n");
}

/**
 * Quick setup for Factory Droid
 * @param {number} port
 */
async function droidQuickSetup(port) {
  const { endpoint } = await getEndpoint(port);
  const apiKey = await getFirstApiKey();

  if (!apiKey) {
    showStatus("No API keys found. Create one in API Keys menu first.", "error");
    await pause();
    return;
  }

  const model = await selectModelFromList("Select Droid Model", "cc/claude-sonnet-4-5-20250929", { excludeCombos: true });
  if (!model) return;

  const result = await api.applyCliToolSettings("droid", { baseUrl: endpoint, apiKey, model });
  showStatus(result.success ? "Factory Droid setup completed!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Reset Factory Droid settings
 */
async function droidReset() {
  const result = await api.resetCliToolSettings("droid");
  showStatus(result.success ? "Factory Droid settings reset!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Factory Droid submenu
 * @param {number} port
 * @param {Array<string>} breadcrumb
 */
async function showDroidMenu(port, breadcrumb = []) {
  await showMenuWithBack({
    title: "🤖 Factory Droid Settings",
    breadcrumb,
    headerContent: buildDroidHeader,
    refresh: async () => ({}),
    items: [
      {
        label: "⚡ Quick Setup",
        action: async () => { await droidQuickSetup(port); return true; }
      },
      {
        label: "Reset to Default",
        action: async () => { await droidReset(); return true; }
      }
    ]
  });
}

// ─── Open Claw ────────────────────────────────────────────────────────────────

/**
 * Build header showing current OpenClaw config status
 * @returns {Promise<string>}
 */
async function buildOpenClawHeader() {
  const result = await api.getCliToolSettings("openclaw");
  if (!result.success) return `  ${COLORS.red}Failed to load settings${COLORS.reset}`;

  const { installed, has9Router, settings } = result.data;
  if (!installed) return `Status:   ${COLORS.red}✗ Open Claw not installed${COLORS.reset}`;

  if (!has9Router) {
    return [
      `Status:   ${COLORS.red}✗ Not configured${COLORS.reset}`,
      `${COLORS.dim}Run "Quick Setup" to configure${COLORS.reset}`
    ].join("\n");
  }

  // Extract 9Router provider config
  const provider = settings?.models?.providers?.["9router"];
  const primary = settings?.agents?.defaults?.model?.primary || "";
  const model = primary.startsWith("9router/") ? primary.replace("9router/", "") : (provider?.models?.[0]?.id || "");
  const lines = [`Status:   ${COLORS.green}✓ Configured${COLORS.reset}`];
  if (provider?.baseUrl) lines.push(`Endpoint: ${COLORS.cyan}${provider.baseUrl}${COLORS.reset}`);
  if (model)             lines.push(`Model:    ${COLORS.dim}${model}${COLORS.reset}`);
  return lines.join("\n");
}

/**
 * Quick setup for Open Claw
 * @param {number} port
 */
async function openClawQuickSetup(port) {
  const { endpoint } = await getEndpoint(port);
  const apiKey = await getFirstApiKey();

  if (!apiKey) {
    showStatus("No API keys found. Create one in API Keys menu first.", "error");
    await pause();
    return;
  }

  const model = await selectModelFromList("Select OpenClaw Model", "cc/claude-sonnet-4-5-20250929", { excludeCombos: true });
  if (!model) return;

  const result = await api.applyCliToolSettings("openclaw", { baseUrl: endpoint, apiKey, model });
  showStatus(result.success ? "Open Claw setup completed!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Reset Open Claw settings
 */
async function openClawReset() {
  const result = await api.resetCliToolSettings("openclaw");
  showStatus(result.success ? "Open Claw settings reset!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Open Claw submenu
 * @param {number} port
 * @param {Array<string>} breadcrumb
 */
async function showOpenClawMenu(port, breadcrumb = []) {
  await showMenuWithBack({
    title: "🦞 Open Claw Settings",
    breadcrumb,
    headerContent: buildOpenClawHeader,
    refresh: async () => ({}),
    items: [
      {
        label: "⚡ Quick Setup",
        action: async () => { await openClawQuickSetup(port); return true; }
      },
      {
        label: "Reset to Default",
        action: async () => { await openClawReset(); return true; }
      }
    ]
  });
}

// ─── OpenCode CLI ─────────────────────────────────────────────────────────────

async function buildOpenCodeHeader() {
  const result = await api.getCliToolSettings("opencode");
  if (!result.success) return `  ${COLORS.red}Failed to load settings${COLORS.reset}`;

  const { installed, has9Router, opencode } = result.data;
  if (!installed) return `Status:   ${COLORS.red}✗ OpenCode CLI not installed${COLORS.reset}`;

  if (!has9Router) {
    return [
      `Status:   ${COLORS.red}✗ Not configured${COLORS.reset}`,
      `${COLORS.dim}Run "Quick Setup" to configure${COLORS.reset}`
    ].join("\n");
  }

  const lines = [`Status:   ${COLORS.green}✓ Configured${COLORS.reset}`];
  if (opencode?.baseURL) lines.push(`Endpoint: ${COLORS.cyan}${opencode.baseURL}${COLORS.reset}`);
  if (opencode?.activeModel) lines.push(`Active:   ${COLORS.dim}${opencode.activeModel}${COLORS.reset}`);
  if (Array.isArray(opencode?.models) && opencode.models.length > 0) {
    lines.push(`Models:   ${COLORS.dim}${opencode.models.join(", ")}${COLORS.reset}`);
  }
  return lines.join("\n");
}

async function openCodeQuickSetup(port) {
  const { endpoint } = await getEndpoint(port);
  const apiKey = await getFirstApiKey();

  if (!apiKey) {
    showStatus("No API keys found. Create one in API Keys menu first.", "error");
    await pause();
    return;
  }

  // Pick first model (also becomes active model by default)
  const firstModel = await selectModelFromList("Select Active Model (OpenCode)", "", { excludeCombos: true });
  if (!firstModel) return;

  const models = [firstModel];

  // Optionally add more models
  while (true) {
    const more = await confirm(`Add another model? (current: ${models.length})`);
    if (!more) break;
    const next = await selectModelFromList(`Add Model #${models.length + 1}`, models.join(", "), { excludeCombos: true });
    if (!next) break;
    if (!models.includes(next)) models.push(next);
  }

  // Optional subagent model
  let subagentModel = firstModel;
  const wantSubagent = await confirm(`Set a different subagent model? (default: ${firstModel})`);
  if (wantSubagent) {
    const picked = await selectModelFromList("Select Subagent Model", firstModel, { excludeCombos: true });
    if (picked) subagentModel = picked;
  }

  const result = await api.applyCliToolSettings("opencode", {
    baseUrl: endpoint,
    apiKey,
    models,
    activeModel: firstModel,
    subagentModel,
  });
  showStatus(result.success ? "OpenCode setup completed!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

async function openCodeReset() {
  const result = await api.resetCliToolSettings("opencode");
  showStatus(result.success ? "OpenCode settings reset!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

async function showOpenCodeMenu(port, breadcrumb = []) {
  await showMenuWithBack({
    title: "💻 OpenCode CLI Settings",
    breadcrumb,
    headerContent: buildOpenCodeHeader,
    refresh: async () => ({}),
    items: [
      { label: "⚡ Quick Setup", action: async () => { await openCodeQuickSetup(port); return true; } },
      { label: "Reset to Default", action: async () => { await openCodeReset(); return true; } }
    ]
  });
}

// ─── Hermes Agent ─────────────────────────────────────────────────────────────

async function buildHermesHeader() {
  const result = await api.getCliToolSettings("hermes");
  if (!result.success) return `  ${COLORS.red}Failed to load settings${COLORS.reset}`;

  const { installed, has9Router, settings } = result.data;
  if (!installed) return `Status:   ${COLORS.red}✗ Hermes Agent not installed${COLORS.reset}`;

  if (!has9Router) {
    return [
      `Status:   ${COLORS.red}✗ Not configured${COLORS.reset}`,
      `${COLORS.dim}Run "Quick Setup" to configure${COLORS.reset}`
    ].join("\n");
  }

  const model = settings?.model || {};
  const lines = [`Status:   ${COLORS.green}✓ Configured${COLORS.reset}`];
  if (model.base_url) lines.push(`Endpoint: ${COLORS.cyan}${model.base_url}${COLORS.reset}`);
  if (model.default)  lines.push(`Model:    ${COLORS.dim}${model.default}${COLORS.reset}`);
  return lines.join("\n");
}

async function hermesQuickSetup(port) {
  const { endpoint } = await getEndpoint(port);
  const apiKey = await getFirstApiKey();

  if (!apiKey) {
    showStatus("No API keys found. Create one in API Keys menu first.", "error");
    await pause();
    return;
  }

  const model = await selectModelFromList("Select Hermes Model", "", { excludeCombos: true });
  if (!model) return;

  const result = await api.applyCliToolSettings("hermes", { baseUrl: endpoint, apiKey, model });
  showStatus(result.success ? "Hermes setup completed!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

async function hermesReset() {
  const result = await api.resetCliToolSettings("hermes");
  showStatus(result.success ? "Hermes settings reset!" : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

async function showHermesMenu(port, breadcrumb = []) {
  await showMenuWithBack({
    title: "⚡ Hermes Agent Settings",
    breadcrumb,
    headerContent: buildHermesHeader,
    refresh: async () => ({}),
    items: [
      { label: "⚡ Quick Setup", action: async () => { await hermesQuickSetup(port); return true; } },
      { label: "Reset to Default", action: async () => { await hermesReset(); return true; } }
    ]
  });
}

// ─── MITM Tools (Antigravity) ─────────────────────────────────────────────────
//
// Unlike the tools above, a MITM tool is not configured by writing its settings
// file — the IDE has no endpoint setting. 9Router points the tool's domain at
// 127.0.0.1 via the hosts file and terminates TLS with its own root CA, so every
// action here needs elevation: Administrator on Windows, root/sudo elsewhere.

/**
 * Resolve the privilege the MITM endpoints need for this platform.
 * Windows takes no password — the process is either elevated or it is not.
 * @param {Object} status - Payload from api.getMitmStatus()
 * @returns {{ok: boolean, needsPassword: boolean, reason: string}}
 */
function checkMitmPrivilege(status) {
  if (status.isAdmin) return { ok: true, needsPassword: false, reason: "" };
  if (status.isWin) {
    return { ok: false, needsPassword: false, reason: "Administrator required — restart 9Router as Administrator" };
  }
  if (status.hasCachedPassword || !status.needsSudoPassword) {
    return { ok: true, needsPassword: false, reason: "" };
  }
  return { ok: true, needsPassword: true, reason: "" };
}

/**
 * Fetch MITM status, reporting a stopped server as guidance rather than a stack trace.
 * @returns {Promise<Object|null>} Status payload, or null when unreachable
 */
async function loadMitmStatus() {
  const result = await api.getMitmStatus();
  if (result.success) return result.data;

  const msg = String(result.error || "");
  if (msg.startsWith("Network error") || msg === "Request timeout") {
    showStatus("Cannot reach 9Router server. Is it running?", "error");
  } else {
    showStatus(`Failed to load MITM status: ${result.error}`, "error");
  }
  return null;
}

/**
 * Ask for the sudo password when the platform needs one, retrying on rejection.
 * Returns "" on Windows and wherever sudo is already unlocked.
 * @param {Object} status
 * @returns {Promise<string|null>} Password, "" if not needed, null if cancelled
 */
async function resolveSudoPassword(status) {
  const priv = checkMitmPrivilege(status);
  if (!priv.ok) {
    showStatus(priv.reason, "error");
    await pause();
    return null;
  }
  if (!priv.needsPassword) return "";

  const pwd = await promptPassword(`${COLORS.dim}Sudo password (input hidden): ${COLORS.reset}`);
  if (!pwd) {
    showStatus("Cancelled — no password entered.", "info");
    await pause();
    return null;
  }
  return pwd;
}

/**
 * Run one MITM call, re-prompting on a rejected sudo password (up to 3 tries).
 * @param {Object} status
 * @param {(pwd: string) => Promise<Object>} call - Receives the password, returns an api result
 * @returns {Promise<Object|null>} The successful api result, or null if it gave up
 */
async function withSudoRetry(status, call) {
  let pwd = await resolveSudoPassword(status);
  if (pwd === null) return null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await call(pwd);
    if (result.success) return result;

    // A wrong password comes back as 400/403 from the sudo layer; anything else is fatal.
    const retriable = !status.isWin && (result.statusCode === 400 || result.statusCode === 403);
    if (!retriable || attempt === 3) {
      showStatus(`Failed: ${result.error}`, "error");
      await pause();
      return null;
    }

    showStatus(`${result.error} — try again (${attempt}/3)`, "error");
    pwd = await promptPassword(`${COLORS.dim}Sudo password (input hidden): ${COLORS.reset}`);
    if (!pwd) return null;
  }
  return null;
}

/**
 * Start the MITM server, offering to reclaim port 443 when something else holds it.
 * @param {Object} tool
 * @param {Object} status
 * @param {number} port
 * @returns {Promise<boolean>} Whether the server ended up running
 */
async function mitmStart(tool, status, port) {
  const apiKey = await getFirstApiKey();
  if (!apiKey) {
    showStatus("No API keys found. Create one in API Keys menu first.", "error");
    await pause();
    return false;
  }

  const pwd = await resolveSudoPassword(status);
  if (pwd === null) return false;

  const routerBaseUrl = status.mitmRouterBaseUrl || `http://localhost:${port}`;
  const body = { apiKey, sudoPassword: pwd, mitmRouterBaseUrl: routerBaseUrl };

  showStatus("Starting MITM server...", "info");
  let result = await api.startMitm(body);

  // 409 carries the process currently bound to :443 — let the user decide.
  if (!result.success && result.statusCode === 409) {
    showStatus(`Port 443 is in use: ${result.error}`, "error");
    const force = await confirm("Stop that process and take port 443?");
    if (!force) return false;
    result = await api.startMitm({ ...body, forceKillPort443: true });
  }

  if (!result.success) {
    showStatus(`Failed to start: ${result.error}`, "error");
    await pause();
    return false;
  }

  showStatus(`MITM server started (pid ${result.data.pid || "?"})`, "success");
  return true;
}

/**
 * Stop the MITM server. The server clears every DNS entry before it exits.
 * @param {Object} status
 * @returns {Promise<boolean>}
 */
async function mitmStop(status) {
  const result = await withSudoRetry(status, pwd => api.stopMitm(pwd));
  if (!result) return false;
  showStatus("MITM server stopped.", "success");
  return true;
}

/**
 * Enable or disable the hosts-file redirect for one tool.
 * @param {Object} tool
 * @param {Object} status
 * @param {"enable"|"disable"} action
 * @returns {Promise<boolean>}
 */
async function mitmToggleDns(tool, status, action) {
  const result = await withSudoRetry(status, pwd =>
    api.patchMitm({ tool: tool.id, action, sudoPassword: pwd })
  );
  if (!result) return false;

  if (action === "enable") {
    showStatus(`DNS redirect enabled — restart ${tool.name} to apply.`, "success");
  } else {
    showStatus("DNS redirect disabled.", "success");
  }
  return true;
}

/**
 * Install the 9Router root CA into the system trust store.
 * @param {Object} tool
 * @param {Object} status
 * @returns {Promise<boolean>}
 */
async function mitmTrustCert(tool, status) {
  const result = await withSudoRetry(status, pwd =>
    api.patchMitm({ tool: tool.id, action: "trust-cert", sudoPassword: pwd })
  );
  if (!result) return false;
  showStatus("Root certificate trusted.", "success");
  return true;
}

/**
 * One-shot path: trust cert → start server → enable DNS.
 * @param {Object} tool
 * @param {number} port
 */
async function mitmQuickSetup(tool, port) {
  const status = await loadMitmStatus();
  if (!status) { await pause(); return; }

  const priv = checkMitmPrivilege(status);
  if (!priv.ok) {
    showStatus(priv.reason, "error");
    await pause();
    return;
  }

  console.log(`\n${COLORS.dim}This edits your hosts file and installs a root certificate.${COLORS.reset}`);
  console.log(`${COLORS.dim}${tool.mitmDomain} will resolve to 127.0.0.1 while enabled.${COLORS.reset}\n`);
  if (!await confirm("Continue?")) return;

  if (!status.certTrusted && !await mitmTrustCert(tool, status)) return;

  const fresh = (await loadMitmStatus()) || status;
  if (!fresh.running && !await mitmStart(tool, fresh, port)) return;

  const afterStart = (await loadMitmStatus()) || fresh;
  if (!afterStart.dnsStatus?.[tool.id] && !await mitmToggleDns(tool, afterStart, "enable")) return;

  showStatus(`Quick Setup completed! Restart ${tool.name} to apply.`, "success");
  await pause();
}

/**
 * Turn everything off: DNS entry first, then the server.
 * @param {Object} tool
 */
async function mitmReset(tool) {
  const status = await loadMitmStatus();
  if (!status) { await pause(); return; }

  if (status.dnsStatus?.[tool.id]) {
    const afterDns = await mitmToggleDns(tool, status, "disable");
    if (!afterDns) return;
  }
  if (status.running && !await mitmStop(status)) return;

  showStatus(`${tool.name} MITM reset.`, "success");
  await pause();
}

/**
 * Edit which 9Router model each of the tool's built-in model names maps to.
 * The alias endpoint replaces the whole map, so the current one is merged
 * with the single edit before saving.
 * @param {Object} tool
 */
async function mitmModelMapping(tool) {
  const status = await loadMitmStatus();
  if (!status) { await pause(); return; }

  // The server rejects alias writes while the tool's DNS is off — say so here
  // instead of letting the user pick a model and then hit a 403.
  if (!status.dnsStatus?.[tool.id]) {
    showStatus(`Enable DNS redirect for ${tool.name} before editing model mappings.`, "error");
    await pause();
    return;
  }

  const aliasResult = await api.getMitmAliases(tool.id);
  const current = aliasResult.success ? (aliasResult.data.aliases || {}) : {};

  const items = tool.defaultModels.map(m => ({
    label: `${m.name}${m.mandatory ? " *" : ""}  ${COLORS.dim}→ ${current[m.alias] || "not mapped"}${COLORS.reset}`,
    action: async () => {
      const selected = await selectModelFromList(
        `Map "${m.name}" to`,
        current[m.alias] || "",
        { excludeCombos: false }
      );
      if (!selected) return true;

      const merged = { ...current, [m.alias]: selected };
      const saved = await api.saveMitmAliases(tool.id, merged);
      if (saved.success) {
        current[m.alias] = selected;
        showStatus(`${m.name} → ${selected} saved!`, "success");
      } else {
        showStatus(`Failed: ${saved.error}`, "error");
      }
      await pause();
      return true;
    }
  }));

  await showMenuWithBack({
    title: `🎯 ${tool.name} Model Mapping`,
    breadcrumb: [],
    headerContent: `Map each ${tool.name} model to a 9Router model\n${COLORS.dim}* = required by the IDE's default mode${COLORS.reset}`,
    items
  });
}

/**
 * Header showing server, certificate, DNS and privilege state.
 * @param {Object} tool
 * @returns {Promise<string>}
 */
function buildMitmHeader(tool) {
  return async () => {
    const status = await loadMitmStatus();
    if (!status) return `  ${COLORS.red}Server unreachable${COLORS.reset}`;

    const on = (label) => `${COLORS.green}✓ ${label}${COLORS.reset}`;
    const off = (label) => `${COLORS.red}✗ ${label}${COLORS.reset}`;
    const dnsOn = !!status.dnsStatus?.[tool.id];

    const lines = [
      `Server:   ${status.running ? on(`Running (pid ${status.pid || "?"})`) : off("Stopped")}`,
      `Cert:     ${status.certTrusted ? on("Trusted") : (status.certExists ? `${COLORS.red}✗ Not trusted${COLORS.reset}` : off("Not generated"))}`,
      `DNS:      ${dnsOn ? on(`${tool.mitmDomain} → 127.0.0.1`) : off("Not redirected")}`,
    ];

    const priv = checkMitmPrivilege(status);
    if (!priv.ok) {
      lines.push(`Access:   ${COLORS.red}✗ ${priv.reason}${COLORS.reset}`);
    } else if (priv.needsPassword) {
      lines.push(`Access:   ${COLORS.dim}sudo password required per action${COLORS.reset}`);
    } else {
      lines.push(`Access:   ${on(status.isWin ? "Administrator" : "root/sudo")}`);
    }

    if (!status.running && !dnsOn) {
      lines.push(`${COLORS.dim}Run "Quick Setup" to configure${COLORS.reset}`);
    }
    return lines.join("\n");
  };
}

/**
 * Menu for one MITM tool.
 * @param {Object} tool - Entry from mitmTools.js
 * @param {number} port
 * @param {Array<string>} breadcrumb
 */
async function showMitmToolMenu(tool, port, breadcrumb = []) {
  await showMenuWithBack({
    title: `🛰️  ${tool.name} (MITM)`,
    breadcrumb,
    headerContent: buildMitmHeader(tool),
    refresh: async () => (await loadMitmStatus()) || {},
    items: [
      {
        label: "⚡ Quick Setup",
        action: async () => { await mitmQuickSetup(tool, port); return true; }
      },
      {
        label: (d) => d?.running ? "Stop MITM Server" : "Start MITM Server",
        action: async () => {
          const status = await loadMitmStatus();
          if (!status) { await pause(); return true; }
          if (status.running) { if (await mitmStop(status)) await pause(); }
          else if (await mitmStart(tool, status, port)) await pause();
          return true;
        }
      },
      {
        label: (d) => d?.dnsStatus?.[tool.id] ? "Disable DNS Redirect" : "Enable DNS Redirect",
        action: async () => {
          const status = await loadMitmStatus();
          if (!status) { await pause(); return true; }
          const action = status.dnsStatus?.[tool.id] ? "disable" : "enable";
          if (await mitmToggleDns(tool, status, action)) await pause();
          return true;
        }
      },
      {
        label: "Trust Root Certificate",
        action: async () => {
          const status = await loadMitmStatus();
          if (!status) { await pause(); return true; }
          if (await mitmTrustCert(tool, status)) await pause();
          return true;
        }
      },
      {
        label: "Model Mapping",
        action: async () => { await mitmModelMapping(tool); return true; }
      },
      {
        label: "Reset (disable DNS + stop server)",
        action: async () => { await mitmReset(tool); return true; }
      }
    ]
  });
}

// ─── Main CLI Tools Menu ──────────────────────────────────────────────────────

/**
 * Main CLI Tools menu
 * @param {number} port
 * @param {Array<string>} breadcrumb
 */
async function showCliToolsMenu(port, breadcrumb = []) {
  const { endpoint } = await getEndpoint(port);
  await showMenuWithBack({
    title: "🔧 CLI Tools",
    breadcrumb,
    headerContent: `Configure CLI tools to use 9Router\nEndpoint: ${endpoint}`,
    items: [
      // MITM tools first, mirroring the dashboard's ordering.
      ...listMitmTools().map(tool => ({
        label: `${tool.name} (MITM)`,
        action: async () => {
          await showMitmToolMenu(tool, port, [...breadcrumb, tool.name]);
          return true;
        }
      })),
      {
        label: "Claude Code",
        action: async () => { await showClaudeCodeMenu(port, [...breadcrumb, "Claude Code"]); return true; }
      },
      {
        label: "Codex CLI",
        action: async () => { await showCodexMenu(port, [...breadcrumb, "Codex CLI"]); return true; }
      },
      {
        label: "Factory Droid",
        action: async () => { await showDroidMenu(port, [...breadcrumb, "Factory Droid"]); return true; }
      },
      {
        label: "Open Claw",
        action: async () => { await showOpenClawMenu(port, [...breadcrumb, "Open Claw"]); return true; }
      },
      {
        label: "OpenCode",
        action: async () => { await showOpenCodeMenu(port, [...breadcrumb, "OpenCode"]); return true; }
      },
      {
        label: "Hermes",
        action: async () => { await showHermesMenu(port, [...breadcrumb, "Hermes"]); return true; }
      }
    ]
  });
}

module.exports = { showCliToolsMenu };
