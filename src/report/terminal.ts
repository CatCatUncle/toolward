import { relative } from "node:path";
import { say, translate } from "../i18n/index.js";
import type { Finding, Lang, ScanResult, Severity } from "../core/types.js";

const ANSI = {
  reset: "[0m",
  bold: "[1m",
  dim: "[2m",
  red: "[31m",
  brightRed: "[91m",
  yellow: "[33m",
  blue: "[34m",
  cyan: "[36m",
  green: "[32m",
  grey: "[90m",
};

export interface TerminalOptions {
  lang: Lang;
  color: boolean;
  /** Hide the per-finding remediation line. */
  compact?: boolean;
  version: string;
}

const SEVERITY_COLOR: Record<Severity, keyof typeof ANSI> = {
  critical: "brightRed",
  high: "red",
  medium: "yellow",
  low: "blue",
  info: "grey",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
  info: "INFO",
};

export function renderTerminal(result: ScanResult, options: TerminalOptions): string {
  const { lang } = options;
  const paint = (text: string, ...styles: Array<keyof typeof ANSI>): string => {
    if (!options.color) return text;
    return `${styles.map((style) => ANSI[style]).join("")}${text}${ANSI.reset}`;
  };
  const say_ = (text: string): string => translate(lang, text);

  const out: string[] = [];
  out.push("");
  out.push(
    `  ${paint("Toolward", "bold", "cyan")} ${paint(`v${options.version}`, "dim")}  ${paint(
      `${say_("scanning")} ${result.root}`,
      "dim",
    )}`,
  );

  // Counted nouns keep the number inside the template so a translation can put
  // it wherever its grammar wants, and so "tool" as a count never collides with
  // "tool" as a label elsewhere.
  const counted = (count: number, one: string, many: string): string =>
    translate(lang, count === 1 ? one : many, { count });
  const stats = [
    counted(result.stats.files, "{count} file", "{count} files"),
    counted(result.stats.servers, "{count} MCP server", "{count} MCP servers"),
    counted(result.stats.tools, "{count} tool", "{count} tools"),
    counted(result.stats.skills, "{count} skill", "{count} skills"),
    counted(result.stats.plugins, "{count} plugin", "{count} plugins"),
    counted(result.stats.hooks, "{count} hook", "{count} hooks"),
  ];
  out.push(`  ${paint(stats.join(" · "), "dim")}`);
  out.push("");

  if (result.findings.length === 0) {
    out.push(`  ${paint("✓", "green")} ${say_("No findings. Nothing in this target tripped a rule.")}`);
  }

  for (const finding of result.findings) {
    out.push(renderFinding(finding, result.root, options, paint, say_));
  }

  const counts = result.counts;
  const countLine = (["critical", "high", "medium", "low", "info"] as Severity[])
    .filter((severity) => counts[severity] > 0)
    .map((severity) =>
      paint(`${say_(SEVERITY_LABEL[severity]).toLowerCase()} ${counts[severity]}`, SEVERITY_COLOR[severity]),
    )
    .join(paint(" · ", "dim"));

  out.push("");
  out.push(`  ${paint(`── ${say_("Summary")} ${"─".repeat(Math.max(0, 46 - say_("Summary").length))}`, "dim")}`);
  out.push(`  ${countLine || paint(say_("no findings"), "green")}`);
  const gradeColor: keyof typeof ANSI =
    result.grade === "A" ? "green" : result.grade === "B" ? "cyan" : result.grade === "C" ? "yellow" : "red";
  out.push(
    `  ${say_("Risk score")} ${paint(`${result.score}/100`, "bold", gradeColor)} ${paint(
      `(${say_("grade")} ${result.grade})`,
      "dim",
    )}  ${paint(`${say_("in")} ${result.durationMs}ms`, "dim")}`,
  );
  if (result.suppressed > 0) {
    out.push(`  ${paint(`${result.suppressed} ${say_("suppressed by baseline")}`, "dim")}`);
  }
  out.push("");
  return out.join("\n");
}

function renderFinding(
  finding: Finding,
  root: string,
  options: TerminalOptions,
  paint: (text: string, ...styles: Array<keyof typeof ANSI>) => string,
  say_: (text: string) => string,
): string {
  const color = SEVERITY_COLOR[finding.severity];
  const label = say_(SEVERITY_LABEL[finding.severity]).padEnd(8, " ");
  const where = `${displayPath(finding.file, root)}${finding.line ? `:${finding.line}` : ""}`;
  const lines: string[] = [];
  lines.push(
    `  ${paint(label, "bold", color)} ${paint(finding.ruleId, "dim")}  ${paint(say_(finding.title), "bold")}`,
  );
  lines.push(
    `    ${paint(where, "cyan")}${finding.subject ? paint(`  ·  ${finding.subject}`, "dim") : ""}`,
  );
  lines.push(`    ${say(options.lang, finding.message)}`);
  if (finding.snippet) lines.push(`    ${paint(`↳ ${finding.snippet}`, "dim")}`);
  if (!options.compact) {
    lines.push(`    ${paint(`${say_("fix")}`, "green")} ${paint(say(options.lang, finding.remediation), "dim")}`);
  }
  lines.push("");
  return lines.join("\n");
}

function displayPath(file: string, root: string): string {
  if (!file.startsWith("/")) return file;
  const rel = relative(root, file);
  return rel && !rel.startsWith("..") ? rel : file;
}

export function supportsColor(): boolean {
  if (process.env["NO_COLOR"] !== undefined) return false;
  if (process.env["FORCE_COLOR"] !== undefined) return process.env["FORCE_COLOR"] !== "0";
  return Boolean(process.stdout.isTTY);
}
