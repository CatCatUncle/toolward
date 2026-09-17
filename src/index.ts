/**
 * Programmatic API.
 *
 * ```ts
 * import { scan } from "toolward";
 * const { result } = scan({ targets: ["./.mcp.json"] });
 * console.log(result.grade, result.findings.length);
 * ```
 */
export { scan, resultFrom, buildBaseline, loadBaseline } from "./scan.js";
export type { ScanOptions, FullScan, BaselineFile } from "./scan.js";
export { collect } from "./collect/collect.js";
export { walk, commonRoot, readSourceFile } from "./collect/walk.js";
export { knownHosts, detectHosts, expandHome } from "./collect/hosts.js";
export type { KnownHost, DetectedHost } from "./collect/hosts.js";
export { runRules } from "./core/engine.js";
export { loadConfig, resolveConfig, DEFAULT_IGNORE } from "./core/config.js";
export { parseFrontmatter, parseJsonc, stripJsonc, globToRegExp } from "./core/parse.js";
export { atOrAbove, countBySeverity, gradeOf, scoreOf, sortFindings, SEVERITY_ORDER } from "./core/score.js";
export { allRules, ruleById } from "./rules/index.js";
export { buildLock, verifyLock, driftRule, LOCK_VERSION } from "./lock.js";
export type { LockEntry, LockFile } from "./lock.js";
export { LOCK_FILENAME } from "./rules/governance.js";
export { renderJson, renderMarkdown, renderSarif, renderCompact, renderRuleCatalogue } from "./report/formats.js";
export { renderTerminal, supportsColor } from "./report/terminal.js";
export { translate, say, locales } from "./i18n/index.js";
export type {
  AgentDef,
  Category,
  ToolwardConfig,
  Finding,
  HookDef,
  Lang,
  McpServerDef,
  PluginDef,
  PromptChunk,
  ResolvedConfig,
  Rule,
  RuleContext,
  ScanContext,
  ScanResult,
  Severity,
  SettingsDef,
  SkillDef,
  SourceFile,
  Message,
  ToolDef,
} from "./core/types.js";
