import { fingerprint, m } from "./text.js";
import type { Finding, Message, Rule, ScanContext, Severity } from "./types.js";

const MAX_FINDINGS_PER_RULE = 200;

/** Run every enabled rule over the context and normalise what they emit. */
export function runRules(ctx: ScanContext, rules: Rule[]): Finding[] {
  const findings: Finding[] = [];
  const overrides = ctx.config.rules ?? {};

  for (const rule of rules) {
    const override = overrides[rule.id];
    if (override === "off") continue;
    let emitted = 0;
    const seen = new Set<string>();

    const report = (input: {
      file: string;
      line?: number;
      snippet?: string;
      subject?: string;
      message: Message;
      severity?: Severity;
      remediation?: Message;
    }): void => {
      if (emitted >= MAX_FINDINGS_PER_RULE) return;
      // A config override wins over the per-finding severity a rule may pick.
      const severity: Severity = override ?? input.severity ?? rule.severity;
      const fp = fingerprint([
        rule.id,
        input.file,
        input.subject,
        input.snippet,
        input.message.template,
        JSON.stringify(input.message.params ?? {}),
      ]);
      if (seen.has(fp)) return;
      seen.add(fp);
      emitted += 1;
      const finding: Finding = {
        ruleId: rule.id,
        severity,
        category: rule.category,
        title: rule.title,
        message: input.message,
        remediation: input.remediation ?? rule.remediation,
        file: input.file,
        references: rule.references ?? [],
        fingerprint: fp,
      };
      if (input.line !== undefined) finding.line = input.line;
      if (input.snippet !== undefined) finding.snippet = input.snippet;
      if (input.subject !== undefined) finding.subject = input.subject;
      findings.push(finding);
    };

    try {
      rule.run({ ctx, report });
    } catch (error) {
      // A broken rule must never take the whole scan down; surface it instead.
      findings.push({
        ruleId: "TW000",
        severity: "info",
        category: "governance",
        title: "Rule execution error",
        message: m("Rule {rule} threw: {error}", { rule: rule.id, error: (error as Error).message }),
        remediation: m("Please report this at https://github.com/CatCatUncle/toolward/issues"),
        file: ctx.root,
        references: [],
        fingerprint: fingerprint(["TW000", rule.id, (error as Error).message]),
      });
    }
  }

  return findings;
}
