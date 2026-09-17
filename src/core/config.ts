import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseJsonc } from "./parse.js";
import type { ToolwardConfig, ResolvedConfig, Severity } from "./types.js";

export const CONFIG_FILENAMES = ["toolward.config.json", ".toolwardrc", ".toolwardrc.json"];

export const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  ".nuxt",
  ".cache",
  ".turbo",
  "coverage",
  ".pytest_cache",
  ".mypy_cache",
];

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

export function isSeverity(value: string): value is Severity {
  return (SEVERITIES as string[]).includes(value);
}

/** Walk up from `start` looking for a config file. */
export function findConfigFile(start: string): string | null {
  let dir = resolve(start);
  for (let depth = 0; depth < 12; depth += 1) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function loadConfig(start: string, explicitPath?: string): ResolvedConfig {
  const file = explicitPath ? resolve(explicitPath) : findConfigFile(start);
  let raw: ToolwardConfig = {};
  if (file && existsSync(file)) {
    const parsed = parseJsonc(readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object") raw = parsed as ToolwardConfig;
  }
  return resolveConfig(raw, file);
}

export function resolveConfig(raw: ToolwardConfig, file: string | null): ResolvedConfig {
  const baseDir = file ? dirname(file) : process.cwd();
  const baseline = raw.baseline
    ? isAbsolute(raw.baseline)
      ? raw.baseline
      : join(baseDir, raw.baseline)
    : null;
  return {
    ignore: [...DEFAULT_IGNORE, ...(raw.ignore ?? [])],
    rules: raw.rules ?? {},
    allowHosts: (raw.allowHosts ?? []).map((h) => h.toLowerCase()),
    allowPackages: raw.allowPackages ?? [],
    maxFileSizeKb: raw.maxFileSizeKb ?? 512,
    hosts: raw.hosts ?? [],
    baseline,
    configFile: file,
  };
}

export const EMPTY_CONFIG: ResolvedConfig = resolveConfig({}, null);
