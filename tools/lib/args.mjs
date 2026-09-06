import fs from "node:fs";
import path from "node:path";
import { COMMANDS, EXIT } from "./constants.mjs";
import { ToolError } from "./fs-atomic.mjs";
import { PROJECT_ROOT } from "./dictionary.mjs";

const COMMAND_FLAGS = {
  doctor: new Set(["--json", "--server-dir"]),
  status: new Set(["--json", "--server-dir"]),
  verify: new Set(["--json", "--server-dir"]),
  apply: new Set(["--json", "--dry-run", "--server-dir", "--with-panel-resize", "--without-panel-resize", "--force-baseline"]),
  reapply: new Set(["--json", "--dry-run", "--server-dir", "--with-panel-resize", "--without-panel-resize"]),
  revert: new Set(["--json", "--dry-run", "--server-dir", "--force"]),
  extract: new Set(["--json", "--output", "--live", "--server-dir"]),
  report: new Set(["--json", "--output", "--server-dir", "--route-matrix"]),
  install: new Set(["--json", "--dry-run", "--server-dir", "--install-dir", "--source-dir", "--release-version", "--repo", "--asset", "--skip-apply"]),
  update: new Set(["--json", "--dry-run", "--server-dir", "--install-dir", "--source-dir", "--release-version", "--repo", "--asset"]),
  uninstall: new Set(["--json", "--dry-run", "--server-dir", "--install-dir"]),
  help: new Set(["--json"]),
};

export function usageText() {
  return [
    "Использование: paperclip-ru <команда> [флаги]",
    "",
    "Команды:",
    "  doctor     [--json] [--server-dir <path>]",
    "  status     [--json] [--server-dir <path>]",
    "  verify     [--json] [--server-dir <path>]",
    "  apply      [--dry-run] [--json] [--server-dir <path>] [--with-panel-resize|--without-panel-resize] [--force-baseline]",
    "  reapply    [--dry-run] [--json] [--server-dir <path>] [--with-panel-resize|--without-panel-resize]",
    "  revert     [--dry-run] [--json] [--server-dir <path>] [--force]",
    "  extract    [--output <path>] [--json] [--server-dir <path>] [--live]",
    "  report     [--output <path>] [--json] [--server-dir <path>]",
    "  install    [--dry-run] [--json] [--release-version <ver|stable>] [--source-dir <path>] [--install-dir <path>] [--server-dir <path>]",
    "  update     [--dry-run] [--json] [--release-version <ver|stable>] [--source-dir <path>] [--install-dir <path>] [--server-dir <path>]",
    "  uninstall  [--dry-run] [--json] [--install-dir <path>] [--server-dir <path>]",
    "  help",
    "",
    "Коды возврата: 0 успех, 1 ошибка, 2 аргументы, 3 Paperclip не найден,",
    "  4 неподдерживаемая сборка, 5 конфликт хешей, 6 недостаточно прав.",
  ].join("\n");
}

function readValue(flag, tokens) {
  const value = tokens.shift();
  if (!value || value.startsWith("-")) {
    throw new ToolError(`Флаг ${flag} требует значение.`, { exitCode: EXIT.USAGE });
  }
  return value;
}

export function parseArgv(argv) {
  const tokens = [...argv];
  const usedFlags = new Set();
  const flags = {
    json: false,
    dryRun: false,
    help: false,
    version: false,
    panelResize: null,
    forceBaseline: false,
    force: false,
    live: false,
    skipApply: false,
    serverDir: null,
    output: null,
    installDir: null,
    sourceDir: null,
    releaseVersion: "stable",
    repo: null,
    asset: null,
    routeMatrix: null,
  };
  const positionals = [];

  while (tokens.length) {
    const tok = tokens.shift();
    if (tok === "--") {
      positionals.push(...tokens);
      break;
    }
    const eq = tok.indexOf("=");
    if (tok.startsWith("--") && eq > 0) {
      const name = tok.slice(0, eq);
      const value = tok.slice(eq + 1);
      tokens.unshift(name, value);
      continue;
    }
    if (tok.startsWith("--") && tok !== "--help" && tok !== "--version") usedFlags.add(tok);
    if (tok === "--json") {
      flags.json = true;
      continue;
    }
    if (tok === "--dry-run") {
      flags.dryRun = true;
      continue;
    }
    if (tok === "--help" || tok === "-h") {
      flags.help = true;
      continue;
    }
    if (tok === "--version") {
      flags.version = true;
      continue;
    }
    if (tok === "--with-panel-resize") {
      flags.panelResize = true;
      continue;
    }
    if (tok === "--without-panel-resize") {
      flags.panelResize = false;
      continue;
    }
    if (tok === "--force-baseline") {
      flags.forceBaseline = true;
      continue;
    }
    if (tok === "--force") {
      flags.force = true;
      continue;
    }
    if (tok === "--live") {
      flags.live = true;
      continue;
    }
    if (tok === "--skip-apply") {
      flags.skipApply = true;
      continue;
    }
    if (tok === "--server-dir") {
      flags.serverDir = readValue(tok, tokens);
      continue;
    }
    if (tok === "--output") {
      flags.output = readValue(tok, tokens);
      continue;
    }
    if (tok === "--install-dir") {
      flags.installDir = readValue(tok, tokens);
      continue;
    }
    if (tok === "--source-dir") {
      flags.sourceDir = readValue(tok, tokens);
      continue;
    }
    if (tok === "--release-version") {
      const raw = readValue(tok, tokens);
      if (raw !== "stable" && !/^\d+\.\d+\.\d+$/.test(raw.replace(/^v/, ""))) {
        throw new ToolError("--release-version принимает только stable, v<semver> или <semver>.", { exitCode: EXIT.USAGE });
      }
      flags.releaseVersion = raw;
      continue;
    }
    if (tok === "--repo") {
      const releaseRuntime = fs.existsSync(path.join(PROJECT_ROOT, "artifact-manifest.json"));
      if (releaseRuntime || process.env.PAPERCLIP_RU_DEV !== "1") {
        throw new ToolError("--repo недоступен вне PAPERCLIP_RU_DEV=1 и недоступен в release artifact.", { exitCode: EXIT.USAGE });
      }
      flags.repo = readValue(tok, tokens);
      continue;
    }
    if (tok === "--asset") {
      flags.asset = readValue(tok, tokens);
      continue;
    }
    if (tok === "--route-matrix") {
      flags.routeMatrix = readValue(tok, tokens);
      continue;
    }
    if (tok.startsWith("-")) {
      throw new ToolError(`Неизвестный аргумент: ${tok}`, { exitCode: EXIT.USAGE });
    }
    positionals.push(tok);
  }

  if (usedFlags.has("--with-panel-resize") && usedFlags.has("--without-panel-resize")) {
    throw new ToolError("--with-panel-resize и --without-panel-resize нельзя указывать вместе.", { exitCode: EXIT.USAGE });
  }
  let command = positionals.shift() ?? null;
  if (flags.help && !command) command = "help";
  if (flags.version && !command) {
    if ([...usedFlags].some((flag) => flag !== "--json")) throw new ToolError("--version поддерживает только --json.", { exitCode: EXIT.USAGE });
    return { command: "version", flags, positionals };
  }
  if (!command) {
    throw new ToolError(usageText(), { exitCode: EXIT.USAGE });
  }
  if (!COMMANDS.includes(command)) {
    throw new ToolError(`Неизвестная команда: ${command}\n${usageText()}`, { exitCode: EXIT.USAGE });
  }

  const allowed = COMMAND_FLAGS[command] || new Set();
  for (const flag of usedFlags) {
    if (!allowed.has(flag)) {
      throw new ToolError(`Команда ${command} не поддерживает ${flag}.`, { exitCode: EXIT.USAGE });
    }
  }
  if (positionals.length) {
    throw new ToolError(`Неожиданный аргумент: ${positionals[0]}`, { exitCode: EXIT.USAGE });
  }

  return { command, flags, positionals };
}
