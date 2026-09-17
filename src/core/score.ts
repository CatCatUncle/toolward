import type { Finding, Severity } from "./types.js";

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/**
 * Risk weights. Deliberately steep: one critical finding (a live exfiltration
 * path, a plaintext key, an executable rug-pull) should not be averaged away by
 * a hundred clean files.
 */
const WEIGHT: Record<Severity, number> = {
  critical: 40,
  high: 15,
  medium: 5,
  low: 1.5,
  info: 0,
};

export type Grade = "A" | "B" | "C" | "D" | "F";

export function emptyCounts(): Record<Severity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts = emptyCounts();
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

export function scoreOf(findings: Finding[]): number {
  const penalty = findings.reduce((sum, f) => sum + WEIGHT[f.severity], 0);
  return Math.max(0, Math.round((100 - penalty) * 10) / 10);
}

export function gradeOf(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 65) return "C";
  if (score >= 45) return "D";
  return "F";
}

export function atOrAbove(severity: Severity, threshold: Severity): boolean {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[threshold];
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
    if (bySeverity !== 0) return bySeverity;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    const byLine = (a.line ?? 0) - (b.line ?? 0);
    if (byLine !== 0) return byLine;
    return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
  });
}
