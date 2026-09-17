import { lineOf, snippet } from "../core/text.js";
import type { PromptChunk, Severity, SourceFile } from "../core/types.js";
import { SEVERITY_ORDER } from "../core/score.js";

const ORDERED: Severity[] = ["info", "low", "medium", "high", "critical"];

export function stepDown(severity: Severity, steps = 1): Severity {
  const index = Math.max(0, SEVERITY_ORDER[severity] - steps);
  return ORDERED[index] ?? "info";
}

export function stepUp(severity: Severity, steps = 1): Severity {
  const index = Math.min(ORDERED.length - 1, SEVERITY_ORDER[severity] + steps);
  return ORDERED[index] ?? "critical";
}

/**
 * Text that the host injects into the model context as authority — a poisoned
 * string here is read as an instruction, not as data.
 */
export function isToolSurface(origin: PromptChunk["origin"]): boolean {
  return (
    origin === "tool-description" ||
    origin === "tool-schema" ||
    origin === "skill" ||
    origin === "agent" ||
    origin === "command" ||
    origin === "plugin"
  );
}

/** Best-effort line lookup: the extracted text is often JSON-escaped in the file. */
export function locate(file: SourceFile, needle: string, fallback?: string): number | undefined {
  const trimmed = needle.trim();
  if (trimmed) {
    const direct = lineOf(file.text, trimmed);
    if (direct) return direct;
    const escaped = lineOf(file.text, JSON.stringify(trimmed).slice(1, -1));
    if (escaped) return escaped;
    const firstLine = trimmed.split("\n")[0]?.trim();
    if (firstLine && firstLine.length > 8) {
      const partial = lineOf(file.text, firstLine);
      if (partial) return partial;
    }
  }
  return fallback ? lineOf(file.text, fallback) : undefined;
}

/** Human-readable English name for a prompt surface; `src/i18n` translates it. */
export function originLabel(origin: PromptChunk["origin"]): string {
  switch (origin) {
    case "tool-description":
      return "tool description";
    case "tool-schema":
      return "tool input schema";
    case "skill":
      return "skill";
    case "agent":
      return "subagent definition";
    case "command":
      return "slash command";
    case "plugin":
      return "plugin manifest";
    case "server-name":
      return "MCP server name";
    case "markdown":
      return "markdown document";
    default:
      return origin;
  }
}

export function tokens(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    const m = /^[a-z0-9+.-]+:\/\/([^/\s:]+)/i.exec(url);
    return m?.[1]?.toLowerCase() ?? null;
  }
}

export function isLocalHost(host: string | null): boolean {
  if (!host) return false;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  );
}
