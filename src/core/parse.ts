/**
 * Tolerant parsers. Agent host configs are hand-edited JSON with comments and
 * trailing commas (VS Code, Cursor, Cline all allow it), and skills use a small
 * YAML subset in frontmatter. Toolward must read what the host reads, so it
 * parses the same sloppy input rather than rejecting it.
 */

/** Strip // and /* *​/ comments plus trailing commas, preserving string literals. */
export function stripJsonc(input: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  let quote = "";
  while (i < input.length) {
    const ch = input[i] as string;
    const next = input[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += input[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === quote) inString = false;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

export function parseJsonc(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    try {
      return JSON.parse(stripJsonc(input));
    } catch {
      return undefined;
    }
  }
}

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
  found: boolean;
}

/**
 * Parse `---` delimited frontmatter using a deliberately small YAML subset:
 * scalars, inline arrays, block arrays and one level of nesting. Enough for
 * SKILL.md / agent / command files, with no YAML dependency to audit.
 */
export function parseFrontmatter(input: string): Frontmatter {
  const normalised = input.replace(/^﻿/, "");
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(normalised);
  if (!m) return { data: {}, body: normalised, found: false };
  const data: Record<string, unknown> = {};
  const lines = (m[1] ?? "").split(/\r?\n/);
  let currentKey: string | null = null;
  let blockList: string[] | null = null;
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && currentKey && blockList) {
      blockList.push(unquote(listItem[1] ?? ""));
      continue;
    }
    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    if (blockList && currentKey) {
      data[currentKey] = blockList;
      blockList = null;
    }
    currentKey = kv[1] ?? "";
    const rawValue = (kv[2] ?? "").trim();
    if (rawValue === "") {
      blockList = [];
      data[currentKey] = "";
      continue;
    }
    data[currentKey] = parseScalar(rawValue);
  }
  if (blockList && currentKey) data[currentKey] = blockList;
  return { data, body: normalised.slice(m[0].length), found: true };
}

function parseScalar(raw: string): unknown {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner).map((part) => unquote(part.trim()));
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return unquote(raw);
}

/** Split on commas that are not inside quotes or parentheses (`Bash(git add:*)`). */
function splitTopLevel(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let buf = "";
  for (const ch of input) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "(" || ch === "[") depth += 1;
    if (ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth <= 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

function unquote(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** Comma/space separated tool list used by `allowed-tools` frontmatter. */
export function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") return splitTopLevel(value).map((v) => unquote(v)).filter(Boolean);
  return [];
}

/** Translate a glob (supporting `**`, `*`, `?`) into an anchored RegExp. */
export function globToRegExp(pattern: string): RegExp {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i] as string;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        out += "(?:.*)";
        i += 2;
        if (pattern[i] === "/") i += 1;
        continue;
      }
      out += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    i += 1;
  }
  return new RegExp(`^${out}$`);
}

export function matchesAnyGlob(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const re = globToRegExp(pattern);
    if (re.test(path)) return true;
    // A bare directory name matches anything inside it.
    return !pattern.includes("/") && path.split("/").some((segment) => re.test(segment));
  });
}
