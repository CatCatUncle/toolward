import type { Lang, Rule, ScanResult, Severity } from "../core/types.js";
import { say, translate } from "../i18n/index.js";
import { allRules } from "../rules/index.js";
import { driftRule } from "../lock.js";

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
  info: "INFO",
};

/** Machine-readable output. Both languages are included so one file serves both. */
export function renderJson(result: ScanResult): string {
  return `${JSON.stringify(
    {
      tool: "toolward",
      ...result,
      findings: result.findings.map((finding) => ({
        ruleId: finding.ruleId,
        severity: finding.severity,
        category: finding.category,
        title: finding.title,
        titleZh: translate("zh", finding.title),
        message: say("en", finding.message),
        messageZh: say("zh", finding.message),
        remediation: say("en", finding.remediation),
        remediationZh: say("zh", finding.remediation),
        file: finding.file,
        line: finding.line ?? null,
        subject: finding.subject ?? null,
        snippet: finding.snippet ?? null,
        references: finding.references,
        fingerprint: finding.fingerprint,
      })),
    },
    null,
    2,
  )}\n`;
}

export function renderMarkdown(result: ScanResult, lang: Lang): string {
  const T = (text: string, params?: Record<string, string | number>): string =>
    translate(lang, text, params);
  const out: string[] = [];
  out.push(`# ${T("Toolward security report")}`);
  out.push("");
  out.push(`- ${T("Target")}: \`${result.root}\``);
  out.push(`- ${T("Scanned at")}: ${result.startedAt}`);
  out.push(`- ${T("Risk score")}: **${result.score}/100** (${T("grade")} ${result.grade})`);
  out.push("");
  out.push(`| ${T("Severity")} | ${T("Count")} |`);
  out.push("| --- | --- |");
  for (const severity of ["critical", "high", "medium", "low", "info"] as Severity[]) {
    out.push(`| ${T(SEVERITY_LABEL[severity]).toLowerCase()} | ${result.counts[severity]} |`);
  }
  out.push("");
  if (result.findings.length === 0) {
    out.push(T("No findings."));
    out.push("");
    return out.join("\n");
  }
  out.push(`## ${T("Findings")}`);
  out.push("");
  for (const finding of result.findings) {
    out.push(`### ${T(SEVERITY_LABEL[finding.severity])} · ${finding.ruleId} · ${T(finding.title)}`);
    out.push("");
    out.push(`- ${T("Location")}: \`${finding.file}${finding.line ? `:${finding.line}` : ""}\``);
    if (finding.subject) out.push(`- ${T("Subject")}: \`${finding.subject}\``);
    out.push(`- ${T("Detail")}: ${say(lang, finding.message)}`);
    if (finding.snippet) out.push(`- ${T("Evidence")}: \`${finding.snippet.replace(/`/g, "'")}\``);
    out.push(`- ${T("Fix")}: ${say(lang, finding.remediation)}`);
    if (finding.references.length > 0) {
      out.push(`- ${T("References")}: ${finding.references.map((r) => `<${r}>`).join(", ")}`);
    }
    out.push("");
  }
  return out.join("\n");
}

const SARIF_LEVEL: Record<Severity, string> = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "note",
  info: "note",
};

const SARIF_RANK: Record<Severity, number> = {
  critical: 9.5,
  high: 8,
  medium: 5,
  low: 3,
  info: 1,
};

/** SARIF 2.1.0, so GitHub code scanning can ingest the result directly. */
export function renderSarif(result: ScanResult, version: string): string {
  const used = new Map<string, Rule>();
  const catalogue = [...allRules, driftRule];
  for (const finding of result.findings) {
    const rule = catalogue.find((entry) => entry.id === finding.ruleId);
    if (rule) used.set(rule.id, rule);
  }
  const ruleIndex = new Map([...used.keys()].map((id, index) => [id, index]));

  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Toolward",
            informationUri: "https://github.com/CatCatUncle/toolward",
            version,
            rules: [...used.values()].map((rule) => ({
              id: rule.id,
              name: rule.id,
              shortDescription: { text: rule.title },
              fullDescription: { text: rule.description },
              help: {
                text: `${rule.description}\n\nFix: ${say("en", rule.remediation)}`,
                markdown: `${rule.description}\n\n**Fix:** ${say("en", rule.remediation)}`,
              },
              properties: {
                category: rule.category,
                tags: ["security", "ai-agent", rule.category],
                "security-severity": String(SARIF_RANK[rule.severity]),
              },
            })),
          },
        },
        results: result.findings.map((finding) => ({
          ruleId: finding.ruleId,
          ruleIndex: ruleIndex.get(finding.ruleId) ?? 0,
          level: SARIF_LEVEL[finding.severity],
          message: { text: say("en", finding.message) },
          properties: {
            subject: finding.subject ?? "",
            fingerprint: finding.fingerprint,
            "security-severity": String(SARIF_RANK[finding.severity]),
          },
          partialFingerprints: { toolwardFingerprint: finding.fingerprint },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: finding.file },
                region: { startLine: Math.max(1, finding.line ?? 1) },
              },
            },
          ],
        })),
      },
    ],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}

/** Terse one-line-per-finding output for grepping and CI logs. */
export function renderCompact(result: ScanResult, lang: Lang): string {
  return `${result.findings
    .map(
      (finding) =>
        `${finding.file}:${finding.line ?? 0}: ${finding.severity} ${finding.ruleId} ${say(
          lang,
          finding.message,
        )}`,
    )
    .join("\n")}\n`;
}

const CATEGORY_TITLE: Record<string, string> = {
  injection: "Prompt injection & tool poisoning",
  "supply-chain": "Supply chain",
  secrets: "Secrets & credentials",
  execution: "Execution & privilege",
  network: "Network & exfiltration",
  governance: "Governance & hygiene",
};

export function renderRuleCatalogue(lang: Lang, format: "md" | "json"): string {
  const catalogue = [...allRules, driftRule];
  if (format === "json") {
    return `${JSON.stringify(
      catalogue.map((rule) => ({
        id: rule.id,
        category: rule.category,
        severity: rule.severity,
        title: rule.title,
        titleZh: translate("zh", rule.title),
        description: rule.description,
        descriptionZh: translate("zh", rule.description),
        remediation: say("en", rule.remediation),
        remediationZh: say("zh", rule.remediation),
        references: rule.references ?? [],
      })),
      null,
      2,
    )}\n`;
  }
  const T = (text: string): string => translate(lang, text);
  const out: string[] = [];
  out.push(`# ${T("Toolward rule catalogue")}`);
  out.push("");
  out.push(T("Generated by `toolward rules --format md`. Do not edit by hand."));
  out.push("");
  for (const category of [...new Set(catalogue.map((rule) => rule.category))]) {
    out.push(`## ${T(CATEGORY_TITLE[category] ?? category)}`);
    out.push("");
    out.push(`| ${T("Rule")} | ${T("Default severity")} | ${T("Title")} |`);
    out.push("| --- | --- | --- |");
    for (const rule of catalogue.filter((entry) => entry.category === category)) {
      out.push(`| \`${rule.id}\` | ${T(SEVERITY_LABEL[rule.severity]).toLowerCase()} | ${T(rule.title)} |`);
    }
    out.push("");
    for (const rule of catalogue.filter((entry) => entry.category === category)) {
      out.push(`### ${rule.id} — ${T(rule.title)}`);
      out.push("");
      out.push(T(rule.description));
      out.push("");
      out.push(`**${T("Fix")}:** ${say(lang, rule.remediation)}`);
      if (rule.references?.length) {
        out.push("");
        out.push(`**${T("References")}:** ${rule.references.map((r) => `<${r}>`).join(" · ")}`);
      }
      out.push("");
    }
  }
  return out.join("\n");
}
