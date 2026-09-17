import { existsSync, readFileSync } from "node:fs";
import { collect } from "./collect/collect.js";
import { loadConfig } from "./core/config.js";
import { runRules } from "./core/engine.js";
import { say } from "./i18n/index.js";
import { parseJsonc } from "./core/parse.js";
import { atOrAbove, countBySeverity, gradeOf, scoreOf, sortFindings } from "./core/score.js";
import type { Finding, ScanContext, ScanResult, Severity } from "./core/types.js";
import { allRules } from "./rules/index.js";

export interface BaselineFile {
  version: number;
  generatedAt: string;
  accepted: Array<{ fingerprint: string; ruleId: string; file: string; note?: string }>;
}

export interface ScanOptions {
  targets: string[];
  configPath?: string;
  baselinePath?: string;
  /** Drop findings below this severity from the result. */
  minSeverity?: Severity;
  /** Only run these rule ids. */
  only?: string[];
  /** Extra ignore globs, merged with the config file's. */
  exclude?: string[];
}

export interface FullScan {
  ctx: ScanContext;
  result: ScanResult;
}

export function loadBaseline(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  const parsed = parseJsonc(readFileSync(path, "utf8")) as BaselineFile | undefined;
  if (!parsed || !Array.isArray(parsed.accepted)) return new Set();
  return new Set(parsed.accepted.map((entry) => entry.fingerprint));
}

export function buildBaseline(findings: Finding[]): BaselineFile {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    accepted: findings.map((finding) => ({
      fingerprint: finding.fingerprint,
      ruleId: finding.ruleId,
      file: finding.file,
      note: say("en", finding.message),
    })),
  };
}

/** Collect, run every enabled rule, then apply baseline and severity filtering. */
export function scan(options: ScanOptions): FullScan {
  const startedAt = new Date();
  const started = Date.now();
  const targets = options.targets.length > 0 ? options.targets : [process.cwd()];
  const config = loadConfig(targets[0] as string, options.configPath);
  if (options.exclude?.length) config.ignore = [...config.ignore, ...options.exclude];

  const ctx = collect(targets, config);
  const selected = options.only?.length
    ? allRules.filter((rule) => options.only?.includes(rule.id))
    : allRules;

  const raw = runRules(ctx, selected);

  const baselinePath = options.baselinePath ?? config.baseline;
  const accepted = baselinePath ? loadBaseline(baselinePath) : new Set<string>();
  let suppressed = 0;
  let findings = raw.filter((finding) => {
    if (accepted.has(finding.fingerprint)) {
      suppressed += 1;
      return false;
    }
    return true;
  });
  if (options.minSeverity) {
    const threshold = options.minSeverity;
    findings = findings.filter((finding) => atOrAbove(finding.severity, threshold));
  }
  findings = sortFindings(findings);

  const score = scoreOf(findings);
  const result: ScanResult = {
    root: ctx.root,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - started,
    findings,
    suppressed,
    score,
    grade: gradeOf(score),
    counts: countBySeverity(findings),
    stats: {
      files: ctx.files.length,
      servers: ctx.servers.length,
      tools: ctx.tools.length,
      skills: ctx.skills.length,
      plugins: ctx.plugins.length,
      hooks: ctx.hooks.length,
      agents: ctx.agents.length,
    },
  };

  return { ctx, result };
}

/** Wrap a list of findings (e.g. from `verify`) in the same result envelope. */
export function resultFrom(ctx: ScanContext, findings: Finding[], startedAt: Date): ScanResult {
  const sorted = sortFindings(findings);
  const score = scoreOf(sorted);
  return {
    root: ctx.root,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    findings: sorted,
    suppressed: 0,
    score,
    grade: gradeOf(score),
    counts: countBySeverity(sorted),
    stats: {
      files: ctx.files.length,
      servers: ctx.servers.length,
      tools: ctx.tools.length,
      skills: ctx.skills.length,
      plugins: ctx.plugins.length,
      hooks: ctx.hooks.length,
      agents: ctx.agents.length,
    },
  };
}
