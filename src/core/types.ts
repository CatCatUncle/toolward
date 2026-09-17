/**
 * Core type definitions for Toolward.
 *
 * Everything the scanner knows about a target is normalised into a ScanContext,
 * and every rule is a pure function over that context.
 */

export type Lang = "en" | "zh";

/**
 * A translatable sentence: an English template plus its parameters.
 * Source code stays English-only; translations live in `src/i18n/<lang>.ts`,
 * keyed by the English template exactly as it is written here.
 */
export interface Message {
  template: string;
  params?: Record<string, string | number>;
}

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type Category =
  | "injection"
  | "supply-chain"
  | "secrets"
  | "execution"
  | "network"
  | "governance";

export interface SourceFile {
  /** Absolute path on disk. */
  abs: string;
  /** Path relative to the scan root, always with forward slashes. */
  rel: string;
  /** File contents, UTF-8. */
  text: string;
  /** Lowercase extension including the dot, e.g. ".json". */
  ext: string;
  /** Basename, e.g. "SKILL.md". */
  base: string;
  size: number;
}

/** A single MCP server entry from an agent host configuration file. */
export interface McpServerDef {
  name: string;
  file: SourceFile;
  command?: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  headers: Record<string, string>;
  transport: "stdio" | "http" | "sse" | "unknown";
  /** Cline/Roo style auto-approval lists. */
  autoApprove: string[];
  disabled: boolean;
  raw: Record<string, unknown>;
}

/** A tool advertised by a server/connector, from a `tools/list` dump or manifest. */
export interface ToolDef {
  name: string;
  description: string;
  server?: string;
  file: SourceFile;
  /** Stringified input schema, scanned for injected instructions in field docs. */
  schemaText: string;
  raw: unknown;
}

export interface SkillDef {
  name: string;
  description: string;
  file: SourceFile;
  dir: string;
  frontmatter: Record<string, unknown>;
  body: string;
  allowedTools: string[];
}

export interface PluginDef {
  name: string;
  file: SourceFile;
  dir: string;
  raw: Record<string, unknown>;
}

export interface HookDef {
  event: string;
  matcher: string;
  type: string;
  command: string;
  file: SourceFile;
}

export interface SettingsDef {
  file: SourceFile;
  raw: Record<string, unknown>;
}

export interface AgentDef {
  kind: "agent" | "command";
  name: string;
  file: SourceFile;
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Any natural-language text that can reach the model's context window.
 * Injection rules iterate over these uniformly, which is the whole point:
 * a poisoned tool description and a poisoned SKILL.md are the same attack.
 */
export interface PromptChunk {
  origin:
    | "tool-description"
    | "tool-schema"
    | "skill"
    | "agent"
    | "command"
    | "server-name"
    | "plugin"
    | "markdown";
  subject: string;
  text: string;
  file: SourceFile;
}

export interface ScanContext {
  root: string;
  files: SourceFile[];
  servers: McpServerDef[];
  tools: ToolDef[];
  skills: SkillDef[];
  plugins: PluginDef[];
  hooks: HookDef[];
  settings: SettingsDef[];
  agents: AgentDef[];
  prompts: PromptChunk[];
  config: ResolvedConfig;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  category: Category;
  title: string;
  message: Message;
  remediation: Message;
  file: string;
  line?: number;
  snippet?: string;
  subject?: string;
  references: string[];
  /** Stable id used by baselines and diffing. */
  fingerprint: string;
}

export interface ReportInput {
  file: string;
  line?: number;
  snippet?: string;
  subject?: string;
  message: Message;
  severity?: Severity;
  remediation?: Message;
}

export interface RuleContext {
  ctx: ScanContext;
  report(input: ReportInput): void;
}

export interface Rule {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  remediation: Message;
  references?: string[];
  run(rc: RuleContext): void;
}

export interface ToolwardConfig {
  /** Glob patterns of paths to skip entirely. */
  ignore?: string[];
  /** Per-rule severity override, or "off" to disable. */
  rules?: Record<string, Severity | "off">;
  /** Hosts considered known-good for egress rules. */
  allowHosts?: string[];
  /** Package specs that may stay unpinned (e.g. your own internal scope). */
  allowPackages?: string[];
  /** Skip files larger than this. Default 512. */
  maxFileSizeKb?: number;
  /** Path to a baseline file of accepted findings. */
  baseline?: string;
  /**
   * Extra agent hosts for `toolward hosts` and `--hosts`, for anything not in
   * the built-in table — a self-hosted runner, an in-house agent, a new client.
   */
  hosts?: { name: string; paths: string[] }[];
}

export interface ResolvedConfig extends Required<Omit<ToolwardConfig, "baseline">> {
  baseline: string | null;
  configFile: string | null;
}

export interface ScanResult {
  root: string;
  startedAt: string;
  durationMs: number;
  findings: Finding[];
  suppressed: number;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  counts: Record<Severity, number>;
  stats: {
    files: number;
    servers: number;
    tools: number;
    skills: number;
    plugins: number;
    hooks: number;
    agents: number;
  };
}
