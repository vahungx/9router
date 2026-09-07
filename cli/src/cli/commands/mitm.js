/**
 * `9router mitm start|stop|status` — drive the MITM proxy without the TUI, for
 * scripts and CI.
 *
 * MITM tools (Antigravity, Kiro) are IDEs with no endpoint setting, so 9Router
 * redirects their domain through the hosts file and terminates TLS with its own
 * root CA. Every action therefore needs elevation: run as Administrator on
 * Windows, or as root / with sudo already unlocked elsewhere.
 *
 * This talks to an already-running gateway; it never spawns one. No password is
 * read from a prompt here — a non-interactive caller passes --sudo-password, or
 * relies on the password 9Router has cached.
 */

const api = require("../api/client");
const { getMitmTool, MITM_MENU_ORDER } = require("../menus/mitmTools");

const DEFAULT_PORT = 20128;
const DEFAULT_TOOL = MITM_MENU_ORDER[0];

const HELP = `
Usage: 9router mitm <start|stop|status> [options]

Control the MITM proxy that routes closed IDEs (Antigravity, ...) through 9Router.
Requires a running 9Router gateway, and Administrator (Windows) or root/sudo.

Actions:
  status              Show server, certificate and DNS state
  start               Trust the cert if needed, start the proxy, redirect DNS
  stop                Remove the DNS redirect and stop the proxy

Options:
  --tool <id>         MITM tool to act on (default: ${DEFAULT_TOOL})
                      Available: ${MITM_MENU_ORDER.join(", ")}
  -p, --port <port>   Gateway port (default: ${DEFAULT_PORT})
  --sudo-password <s> Sudo password for macOS/Linux when it is not cached
  --force             On start, take port 443 from whatever holds it
  --json              Print machine-readable JSON instead of text
  -h, --help          Show this message

Examples:
  9router mitm status --json
  9router mitm start --tool antigravity
  9router mitm stop
`;

/**
 * Parse argv for this subcommand.
 * @param {Array<string>} argv
 * @returns {Object} { action, tool, port, sudoPassword, force, json, help }
 */
function parseArgs(argv) {
  const out = {
    action: null,
    tool: DEFAULT_TOOL,
    port: DEFAULT_PORT,
    sudoPassword: "",
    force: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a === "--force") out.force = true;
    else if (a === "--tool") out.tool = argv[++i] || out.tool;
    else if (a === "-p" || a === "--port") out.port = parseInt(argv[++i], 10) || DEFAULT_PORT;
    else if (a === "--sudo-password") out.sudoPassword = argv[++i] || "";
    else if (!a.startsWith("-") && !out.action) out.action = a;
  }
  return out;
}

/**
 * Render status as text or JSON.
 * @param {Object} status
 * @param {Object} tool
 * @param {boolean} json
 */
function printStatus(status, tool, json) {
  if (json) {
    console.log(JSON.stringify({
      tool: tool.id,
      running: !!status.running,
      pid: status.pid || null,
      certExists: !!status.certExists,
      certTrusted: !!status.certTrusted,
      dnsEnabled: !!status.dnsStatus?.[tool.id],
      domain: tool.mitmDomain,
      isAdmin: !!status.isAdmin,
      needsSudoPassword: !!status.needsSudoPassword,
    }, null, 2));
    return;
  }

  const mark = (ok) => (ok ? "yes" : "no");
  console.log(`tool:        ${tool.id}`);
  console.log(`running:     ${mark(status.running)}${status.running && status.pid ? ` (pid ${status.pid})` : ""}`);
  console.log(`cert:        ${status.certTrusted ? "trusted" : status.certExists ? "generated, not trusted" : "not generated"}`);
  console.log(`dns:         ${status.dnsStatus?.[tool.id] ? `${tool.mitmDomain} -> 127.0.0.1` : "not redirected"}`);
  console.log(`privileged:  ${mark(status.isAdmin)}`);
}

/**
 * Fail early when the platform cannot perform a privileged action.
 * @param {Object} status
 * @param {string} sudoPassword
 * @returns {string} Error message, or "" when allowed
 */
function privilegeError(status, sudoPassword) {
  if (status.isAdmin) return "";
  if (status.isWin) return "Administrator required — run this terminal as Administrator";
  if (status.hasCachedPassword || !status.needsSudoPassword) return "";
  if (sudoPassword) return "";
  return "Sudo password required — pass --sudo-password";
}

/**
 * Entry point.
 * @param {Array<string>} argv - Arguments after `mitm`
 * @returns {Promise<number>} Process exit code
 */
async function run(argv) {
  const opts = parseArgs(argv);

  if (opts.help || !opts.action) {
    console.log(HELP.trim());
    return opts.action ? 0 : 1;
  }

  if (!["start", "stop", "status"].includes(opts.action)) {
    console.error(`Unknown action "${opts.action}". Expected start, stop or status.`);
    return 1;
  }

  const tool = getMitmTool(opts.tool);
  if (!tool) {
    console.error(`Unknown tool "${opts.tool}". Available: ${MITM_MENU_ORDER.join(", ")}`);
    return 1;
  }

  api.configure({ port: opts.port });

  const statusResult = await api.getMitmStatus();
  if (!statusResult.success) {
    const msg = String(statusResult.error || "");
    if (msg.startsWith("Network error") || msg === "Request timeout") {
      console.error(`Cannot reach 9Router on port ${opts.port}. Is the gateway running?`);
    } else {
      console.error(`Failed to read MITM status: ${statusResult.error}`);
    }
    return 1;
  }
  const status = statusResult.data;

  if (opts.action === "status") {
    printStatus(status, tool, opts.json);
    return 0;
  }

  const privErr = privilegeError(status, opts.sudoPassword);
  if (privErr) {
    console.error(privErr);
    return 1;
  }
  const pwd = opts.sudoPassword;

  if (opts.action === "stop") {
    const stopped = await api.stopMitm(pwd);
    if (!stopped.success) {
      console.error(`Failed to stop: ${stopped.error}`);
      return 1;
    }
    console.log("MITM server stopped.");
    return 0;
  }

  // start: cert -> server -> dns, skipping whatever is already in place
  if (!status.certTrusted) {
    const trusted = await api.patchMitm({ tool: tool.id, action: "trust-cert", sudoPassword: pwd });
    if (!trusted.success) {
      console.error(`Failed to trust certificate: ${trusted.error}`);
      return 1;
    }
  }

  if (!status.running) {
    const keys = await api.getApiKeys();
    const apiKey = keys.success ? (keys.data.keys || [])[0]?.key : null;
    if (!apiKey) {
      console.error("No API key found. Create one in the dashboard or `9router` TUI first.");
      return 1;
    }

    const body = {
      apiKey,
      sudoPassword: pwd,
      mitmRouterBaseUrl: status.mitmRouterBaseUrl || `http://localhost:${opts.port}`,
    };
    let started = await api.startMitm(body);

    if (!started.success && started.statusCode === 409) {
      if (!opts.force) {
        console.error(`Port 443 is in use: ${started.error}`);
        console.error("Re-run with --force to take the port.");
        return 1;
      }
      started = await api.startMitm({ ...body, forceKillPort443: true });
    }

    if (!started.success) {
      console.error(`Failed to start: ${started.error}`);
      return 1;
    }
    console.log(`MITM server started (pid ${started.data.pid || "?"}).`);
  }

  if (!status.dnsStatus?.[tool.id]) {
    const dns = await api.patchMitm({ tool: tool.id, action: "enable", sudoPassword: pwd });
    if (!dns.success) {
      console.error(`Failed to enable DNS: ${dns.error}`);
      return 1;
    }
    console.log(`DNS redirect enabled for ${tool.mitmDomain}.`);
  }

  console.log(`Ready — restart ${tool.name} to apply.`);
  return 0;
}

module.exports = { run, parseArgs, privilegeError, printStatus };
