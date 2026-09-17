/**
 * A deliberately small TOML reader.
 *
 * Toolward only needs enough TOML to find an MCP server table in a host config
 * such as Codex CLI's `~/.codex/config.toml`:
 *
 *     [mcp_servers.docs]
 *     command = "npx"
 *     args = ["-y", "@acme/docs@1.2.3"]
 *     env = { API_KEY = "..." }
 *
 * Dates, multi-line strings and arrays of tables are not supported: a config
 * that uses them still gets scanned as raw text, it just does not contribute a
 * structured server. Pulling in a full TOML library would mean a runtime
 * dependency, and this tool does not have any.
 */

type Table = Record<string, unknown>;

/** Decode the escape sequences TOML allows inside a basic string. */
function unescapeBasic(body: string): string {
  return body.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_, seq: string) => {
    if (seq[0] === "u" || seq[0] === "U") return String.fromCodePoint(parseInt(seq.slice(1), 16));
    const simple: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\" };
    return simple[seq] ?? seq;
  });
}

/** Read one value starting at `i`; returns the value and the index after it. */
function readValue(src: string, i: number): { value: unknown; next: number } {
  while (i < src.length && /\s/.test(src[i] as string)) i += 1;
  const ch = src[i];

  if (ch === '"' || ch === "'") {
    const quote = ch;
    let out = "";
    let j = i + 1;
    while (j < src.length) {
      const c = src[j] as string;
      if (c === "\\" && quote === '"') {
        out += c + (src[j + 1] ?? "");
        j += 2;
        continue;
      }
      if (c === quote) break;
      out += c;
      j += 1;
    }
    return { value: quote === '"' ? unescapeBasic(out) : out, next: j + 1 };
  }

  if (ch === "[") {
    const items: unknown[] = [];
    let j = i + 1;
    while (j < src.length) {
      while (j < src.length && /[\s,]/.test(src[j] as string)) j += 1;
      if (src[j] === "#") {
        while (j < src.length && src[j] !== "\n") j += 1;
        continue;
      }
      if (src[j] === "]" || j >= src.length) break;
      const item = readValue(src, j);
      items.push(item.value);
      j = item.next;
    }
    return { value: items, next: j + 1 };
  }

  if (ch === "{") {
    const table: Table = {};
    let j = i + 1;
    while (j < src.length && src[j] !== "}") {
      while (j < src.length && /[\s,]/.test(src[j] as string)) j += 1;
      if (src[j] === "}") break;
      let key = "";
      while (j < src.length && !/[=\s]/.test(src[j] as string)) {
        key += src[j];
        j += 1;
      }
      while (j < src.length && src[j] !== "=") j += 1;
      const item = readValue(src, j + 1);
      table[key.replace(/^["']|["']$/g, "")] = item.value;
      j = item.next;
    }
    return { value: table, next: j + 1 };
  }

  // Bare scalar: runs to end of line or a comment.
  let raw = "";
  let j = i;
  while (j < src.length && src[j] !== "\n" && src[j] !== "#") {
    raw += src[j];
    j += 1;
  }
  const text = raw.trim();
  if (text === "true") return { value: true, next: j };
  if (text === "false") return { value: false, next: j };
  if (/^[+-]?\d[\d_]*$/.test(text)) return { value: Number(text.replace(/_/g, "")), next: j };
  if (/^[+-]?\d[\d_]*\.\d+$/.test(text)) return { value: Number(text.replace(/_/g, "")), next: j };
  return { value: text, next: j };
}

/** Split `a.b."c.d"` into path segments, honouring quoted keys. */
function splitKeyPath(key: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of key.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ".") {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}

function descend(root: Table, path: string[]): Table {
  let node = root;
  for (const part of path) {
    const existing = node[part];
    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
      node = existing as Table;
    } else {
      const created: Table = {};
      node[part] = created;
      node = created;
    }
  }
  return node;
}

export function parseTomlLite(text: string): Table {
  const root: Table = {};
  let current = root;
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] as string).trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("[")) {
      // `[[x]]` (array of tables) is not modelled; treat it as a plain table so
      // the keys inside are still visible to the rules.
      const name = line.replace(/^\[+/, "").replace(/\]+.*$/, "");
      current = descend(root, splitKeyPath(name));
      continue;
    }

    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const path = splitKeyPath(line.slice(0, eq));
    if (path.length === 0) continue;

    // A value may span lines (arrays, inline tables), so parse from the raw
    // remainder of the document rather than from this single line.
    const rest = lines.slice(index).join("\n");
    const offset = rest.indexOf("=") + 1;
    const { value } = readValue(rest, offset);
    const leaf = path.pop() as string;
    descend(current, path)[leaf] = value;

    // Skip the lines a multi-line value consumed.
    const consumed = rest.slice(0, offset) + String(rest.slice(offset));
    void consumed;
    if (/[[{]\s*$/.test(line) || (line.includes("[") && !line.includes("]"))) {
      let depth = 0;
      let j = index;
      do {
        const l = lines[j] as string;
        for (const ch of l) {
          if (ch === "[" || ch === "{") depth += 1;
          if (ch === "]" || ch === "}") depth -= 1;
        }
        j += 1;
      } while (j < lines.length && depth > 0);
      index = j - 1;
    }
  }

  return root;
}
