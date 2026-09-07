// MITM tool registry for the terminal UI.
//
// Mirrors MITM_TOOLS in src/shared/constants/cliTools.js. The dashboard's copy is
// ESM inside the Next app; the CLI ships as its own CJS package (see cli/package.json
// "files"), so it cannot import across that boundary and keeps a copy here instead.
// Keep the two in sync when a tool's domain or model list changes.

const MITM_TOOLS = {
  antigravity: {
    id: "antigravity",
    name: "Antigravity",
    description: "Google Antigravity IDE with MITM",
    mitmDomain: "daily-cloudcode-pa.googleapis.com",
    // The IDE also resolves cloudcode-pa.googleapis.com; the server redirects both.
    defaultModels: [
      { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)", alias: "gemini-3.8-flash-high" },
      { id: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)", alias: "gemini-3.8-flash-medium" },
      { id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)", alias: "gemini-3.8-flash-low" },
      { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)", alias: "gemini-3.7-flash-high" },
      { id: "gemini-3.7-flash-medium", name: "Gemini 3.7 Flash (Medium)", alias: "gemini-3.7-flash-medium" },
      { id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)", alias: "gemini-3.7-flash-low" },
      { id: "gemini-3.6-flash-high", name: "Gemini 3.6 Flash (High)", alias: "gemini-3.6-flash-high" },
      { id: "gemini-3.6-flash-medium", name: "Gemini 3.6 Flash (Medium)", alias: "gemini-3.6-flash-medium" },
      { id: "gemini-3.6-flash-low", name: "Gemini 3.6 Flash (Low)", alias: "gemini-3.6-flash-low" },
      { id: "gemini-3.5-flash-low", name: "Gemini 3.5 Flash (Medium) / Default", alias: "gemini-3.5-flash-low", mandatory: true },
      { id: "gemini-3-flash-agent", name: "Gemini 3.5 Flash (High)", alias: "gemini-3-flash-agent" },
      { id: "gemini-3.5-flash-extra-low", name: "Gemini 3.5 Flash (Low)", alias: "gemini-3.5-flash-extra-low" },
      { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)", alias: "gemini-3.1-pro-low" },
      { id: "gemini-pro-agent", name: "Gemini 3.1 Pro (High)", alias: "gemini-pro-agent" },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)", alias: "claude-sonnet-4-6" },
      { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)", alias: "claude-opus-4-6-thinking" },
      { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)", alias: "gpt-oss-120b-medium" },
      { id: "gemini-3-flash", name: "Gemini 3 Flash (Command)", alias: "gemini-3-flash" },
    ],
  },
  kiro: {
    id: "kiro",
    name: "Kiro",
    description: "Kiro IDE with MITM",
    mitmDomain: "runtime.us-east-1.kiro.dev",
    defaultModels: [
      // Kiro's agent mode sends "auto" for the main turn and "simple-task" for
      // background sub-tasks — both need a slot or the call falls through to AWS.
      { id: "auto", name: "Auto (Kiro Agent)", alias: "auto" },
      { id: "claude-sonnet-5", name: "Claude Sonnet 5", alias: "claude-sonnet-5" },
      { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", alias: "claude-sonnet-4.5" },
      { id: "claude-sonnet-4", name: "Claude Sonnet 4", alias: "claude-sonnet-4" },
      { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", alias: "claude-haiku-4.5" },
      { id: "deepseek-3.2", name: "DeepSeek 3.2", alias: "deepseek-3.2" },
      { id: "minimax-m2.1", name: "MiniMax M2.1", alias: "minimax-m2.1" },
      { id: "gpt-5.6-sol", name: "GPT 5.6 Sol", alias: "gpt-5.6-sol" },
      { id: "gpt-5.6-terra", name: "GPT 5.6 Terra", alias: "gpt-5.6-terra" },
      { id: "gpt-5.6-luna", name: "GPT 5.6 Luna", alias: "gpt-5.6-luna" },
      { id: "simple-task", name: "Qwen3 Coder Next", alias: "simple-task" },
    ],
  },
};

// Tools the terminal menu offers, in the order the dashboard lists them.
// Kiro is registered above but not exposed yet — its menu is identical, so adding
// it here is all that is needed once its MITM path has been verified end to end.
const MITM_MENU_ORDER = ["antigravity"];

/**
 * Get one MITM tool definition
 * @param {string} id
 * @returns {Object|null}
 */
function getMitmTool(id) {
  return MITM_TOOLS[id] || null;
}

/**
 * Tools to show in the CLI Tools menu, in display order
 * @returns {Array<Object>}
 */
function listMitmTools() {
  return MITM_MENU_ORDER.map(id => MITM_TOOLS[id]).filter(Boolean);
}

module.exports = { MITM_TOOLS, MITM_MENU_ORDER, getMitmTool, listMitmTools };
