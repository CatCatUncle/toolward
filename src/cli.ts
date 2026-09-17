#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { collect } from "./collect/collect.js";
import { detectHosts, knownHosts } from "./collect/hosts.js";
import { loadConfig, isSeverity } from "./core/config.js";
import { parseJsonc } from "./core/parse.js";
import { atOrAbove } from "./core/score.js";
import type { Lang, Severity } from "./core/types.js";
import { buildLock, verifyLock, type LockFile } from "./lock.js";
import { renderCompact, renderJson, renderMarkdown, renderRuleCatalogue, renderSarif } from "./report/formats.js";
import { renderTerminal, supportsColor } from "./report/terminal.js";
import { helpZh, translate } from "./i18n/index.js";
import { LOCK_FILENAME } from "./rules/governance.js";
import { buildBaseline, resultFrom, scan } from "./scan.js";

const VERSION = readVersion();

function readVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    return String((JSON.parse(raw) as { version?: string }).version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}

interface Args {
  command: string;
  positionals: string[];
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  let command = "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg.startsWith("--")) {
      const [name, inline] = arg.slice(2).split("=", 2);
      const key = name ?? "";
      if (inline !== undefined) {
        flags.set(key, inline);
        continue;
      }
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        flags.set(key, next);
        i += 1;
      } else {
        flags.set(key, true);
      }
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      const key = arg.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        flags.set(key, next);
        i += 1;
      } else {
        flags.set(key, true);
      }
      continue;
    }
    if (!command) command = arg;
    else positionals.push(arg);
  }
  return { command, positionals, flags };
}

function flagString(args: Args, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = args.flags.get(name);
    if (typeof value === "string") return value;
  }
  return undefined;
}

function flagBool(args: Args, ...names: string[]): boolean {
  for (const name of names) {
    const value = args.flags.get(name);
    if (value === true || value === "true") return true;
  }
  return false;
}

/** `--lang` wins, then TOOLWARD_LANG; English is the default so CI logs stay portable. */
function langOf(args: Args): Lang {
  const value = flagString(args, "lang", "l") ?? process.env["TOOLWARD_LANG"] ?? "";
  if (/^(zh|cn)/i.test(value)) return "zh";
  return "en";
}

const HELP_EN = `
Toolward ${VERSION} — security auditor for AI agent extensions.

USAGE
  toolward <command> [paths...] [options]

COMMANDS
  scan [paths...]        Audit MCP servers, skills, plugins and connectors (default)
  lock [paths...]        Record the current tool surface to ${LOCK_FILENAME}
  verify [paths...]      Compare the current surface against the lock file
  baseline [paths...]    Write current findings to a baseline so CI starts green
  hosts                  List the agent hosts installed on this machine
  rules                  Print the rule catalogue
  help                   Show this message

OPTIONS
  --format <fmt>         pretty | json | md | sarif | compact   (default: pretty)
  --out <file>           Write the report to a file instead of stdout
  --lang <en|zh>         Report language                        (default: en)
  --fail-on <severity>   critical | high | medium | low | none  (default: high)
  --min-severity <sev>   Hide findings below this severity
  --only <ids>           Comma-separated rule ids to run
  --exclude <globs>      Comma-separated extra ignore patterns
  --hosts                Scan every detected agent host instead of a path
  --config <file>        Path to toolward.config.json
  --baseline <file>      Path to a baseline file
  --lock <file>          Lock file path for lock/verify
  --compact              Omit remediation lines in pretty output
  --no-color             Disable ANSI colour
  --quiet                Print nothing; rely on the exit code
  --version              Print the version

EXIT CODES
  0  no findings at or above --fail-on
  1  findings at or above --fail-on
  2  usage or runtime error

Toolward performs static analysis only. It never starts a server, never installs
a package, and never executes the code it audits.

Free for personal, non-commercial use. Company or commercial use requires a
licence: https://github.com/CatCatUncle/toolward/blob/main/LICENSING.md
`;

function emit(text: string, out: string | undefined, quiet: boolean, lang: Lang): void {
  if (out) {
    const target = resolve(out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text, "utf8");
    if (!quiet) process.stderr.write(`${translate(lang, "report written to {path}", { path: target })}\n`);
    return;
  }
  if (!quiet) process.stdout.write(text);
}

function severityFlag(args: Args, name: string, fallback: Severity | "none"): Severity | "none" {
  const value = flagString(args, name);
  if (!value) return fallback;
  if (value === "none") return "none";
  if (isSeverity(value)) return value;
  throw new Error(`invalid --${name} value: ${value}`);
}

function render(
  result: ReturnType<typeof scan>["result"],
  args: Args,
  lang: Lang,
): string {
  const format = flagString(args, "format", "f") ?? "pretty";
  switch (format) {
    case "json":
      return renderJson(result);
    case "md":
    case "markdown":
      return renderMarkdown(result, lang);
    case "sarif":
      return renderSarif(result, VERSION);
    case "compact":
      return renderCompact(result, lang);
    case "pretty":
      return renderTerminal(result, {
        lang,
        color: !flagBool(args, "no-color") && supportsColor(),
        compact: flagBool(args, "compact"),
        version: VERSION,
      });
    default:
      throw new Error(`unknown --format value: ${format}`);
  }
}

function exitCodeFor(result: ReturnType<typeof scan>["result"], failOn: Severity | "none"): number {
  if (failOn === "none") return 0;
  return result.findings.some((finding) => atOrAbove(finding.severity, failOn)) ? 1 : 0;
}

function targetsOf(args: Args, hostPaths?: string[]): string[] {
  if (hostPaths && hostPaths.length > 0) return hostPaths;
  const list = args.positionals.length > 0 ? args.positionals : [process.cwd()];
  for (const target of list) {
    if (!existsSync(target)) throw new Error(`path not found: ${target}`);
  }
  return list;
}

function main(argv: string[]): number {
  const args = parseArgs(argv);
  const lang = langOf(args);
  const quiet = flagBool(args, "quiet", "q");

  if (flagBool(args, "version", "v")) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (!args.command || args.command === "help" || flagBool(args, "help", "h")) {
    process.stdout.write(lang === "zh" ? helpZh(VERSION, LOCK_FILENAME) : HELP_EN);
    return 0;
  }

  if (args.command === "hosts") {
    const config = loadConfig(process.cwd(), flagString(args, "config"));
    const detected = detectHosts(config.hosts);
    if (flagString(args, "format", "f") === "json") {
      emit(`${JSON.stringify(detected, null, 2)}\n`, flagString(args, "out", "o"), quiet, lang);
      return 0;
    }
    const lines = [
      "",
      `  ${translate(lang, "Agent hosts found on this machine")}`,
      "",
    ];
    for (const host of detected) {
      lines.push(`  ${host.name}`);
      for (const path of host.found) lines.push(`    ${path}`);
      if (host.note) lines.push(`    ${translate(lang, "note")}: ${translate(lang, host.note)}`);
      lines.push("");
    }
    const missing = knownHosts().length + config.hosts.length - detected.length;
    lines.push(
      `  ${translate(lang, "{found} of {total} known hosts detected. Scan them all with `toolward scan --hosts`.", {
        found: detected.length,
        total: knownHosts().length + config.hosts.length,
      })}`,
      "",
    );
    void missing;
    emit(`${lines.join("\n")}\n`, flagString(args, "out", "o"), quiet, lang);
    return 0;
  }

  if (args.command === "rules") {
    const format = flagString(args, "format", "f") === "json" ? "json" : "md";
    emit(renderRuleCatalogue(lang, format), flagString(args, "out", "o"), quiet, lang);
    return 0;
  }

  // Commands below all operate on a scan target.
  const knownCommands = new Set(["scan", "lock", "verify", "baseline"]);
  if (!knownCommands.has(args.command)) {
    // Treat `toolward ./path` as `toolward scan ./path`.
    args.positionals.unshift(args.command);
    args.command = "scan";
  }
  const hostPaths = flagBool(args, "hosts")
    ? detectHosts(loadConfig(process.cwd(), flagString(args, "config")).hosts).flatMap((host) => host.found)
    : undefined;
  if (flagBool(args, "hosts") && (!hostPaths || hostPaths.length === 0)) {
    process.stderr.write(`${translate(lang, "No known agent host configuration found on this machine.")}\n`);
    return 2;
  }
  const targets = targetsOf(args, hostPaths);

  if (args.command === "lock" || args.command === "verify") {
    const config = loadConfig(targets[0] as string, flagString(args, "config"));
    const extraIgnore = flagString(args, "exclude");
    if (extraIgnore) config.ignore = [...config.ignore, ...extraIgnore.split(",").map((s) => s.trim())];
    const ctx = collect(targets, config);
    const lockPath = resolve(flagString(args, "lock") ?? `${ctx.root}/${LOCK_FILENAME}`);

    if (args.command === "lock") {
      const lock = buildLock(ctx);
      writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
      if (!quiet) {
        process.stdout.write(
          `${translate(lang, "Locked {count} entries (servers/tools/skills) → {path}", {
            count: lock.entries.length,
            path: lockPath,
          })}\n`,
        );
      }
      return 0;
    }

    if (!existsSync(lockPath)) {
      process.stderr.write(
        `${translate(lang, "Lock file not found at {path}. Run `toolward lock` first.", { path: lockPath })}\n`,
      );
      return 2;
    }
    const lock = parseJsonc(readFileSync(lockPath, "utf8")) as LockFile | undefined;
    if (!lock || !Array.isArray(lock.entries)) throw new Error(`invalid lock file: ${lockPath}`);
    const findings = verifyLock(ctx, lock);
    const result = resultFrom(ctx, findings, new Date());
    emit(render(result, args, lang), flagString(args, "out", "o"), quiet, lang);
    return exitCodeFor(result, severityFlag(args, "fail-on", "medium"));
  }

  const only = flagString(args, "only");
  const exclude = flagString(args, "exclude");
  const minSeverityFlag = severityFlag(args, "min-severity", "none");
  const { result } = scan({
    targets,
    ...(flagString(args, "config") ? { configPath: flagString(args, "config") } : {}),
    ...(flagString(args, "baseline") ? { baselinePath: flagString(args, "baseline") } : {}),
    ...(minSeverityFlag !== "none" ? { minSeverity: minSeverityFlag } : {}),
    ...(only ? { only: only.split(",").map((value) => value.trim().toUpperCase()) } : {}),
    ...(exclude ? { exclude: exclude.split(",").map((value) => value.trim()) } : {}),
  });

  if (args.command === "baseline") {
    const path = resolve(flagString(args, "out", "o") ?? ".toolward-baseline.json");
    writeFileSync(path, `${JSON.stringify(buildBaseline(result.findings), null, 2)}\n`, "utf8");
    if (!quiet) {
      process.stdout.write(
        `${translate(lang, "Accepted {count} findings into the baseline → {path}", {
          count: result.findings.length,
          path,
        })}\n`,
      );
    }
    return 0;
  }

  emit(render(result, args, lang), flagString(args, "out", "o"), quiet, lang);
  return exitCodeFor(result, severityFlag(args, "fail-on", "high"));
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`toolward: ${(error as Error).message}\n`);
  process.exitCode = 2;
}
