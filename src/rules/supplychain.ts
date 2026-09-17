import { levenshtein, m, snippet } from "../core/text.js";
import type { McpServerDef, Rule } from "../core/types.js";
import { hostOf, isLocalHost, locate } from "./helpers.js";

/** Runners that fetch and execute a package on every agent start. */
const FETCH_RUNNERS = new Set(["npx", "bunx", "pnpx", "uvx", "pipx", "dlx", "deno"]);

/** Well-known MCP packages, used as the typosquat reference set. */
const KNOWN_PACKAGES = [
  "@modelcontextprotocol/server-filesystem",
  "@modelcontextprotocol/server-github",
  "@modelcontextprotocol/server-gitlab",
  "@modelcontextprotocol/server-slack",
  "@modelcontextprotocol/server-postgres",
  "@modelcontextprotocol/server-sqlite",
  "@modelcontextprotocol/server-memory",
  "@modelcontextprotocol/server-puppeteer",
  "@modelcontextprotocol/server-brave-search",
  "@modelcontextprotocol/server-google-maps",
  "@modelcontextprotocol/server-sequential-thinking",
  "@modelcontextprotocol/server-everything",
  "@modelcontextprotocol/inspector",
  "mcp-server-fetch",
  "mcp-server-git",
  "mcp-server-time",
  "firecrawl-mcp",
  "chrome-devtools-mcp",
  "@playwright/mcp",
  "@upstash/context7-mcp",
  "@notionhq/notion-mcp-server",
  "@supabase/mcp-server-supabase",
  "figma-developer-mcp",
];

const PIN_EXEMPT = new Set(["-y", "--yes", "-q", "--quiet", "--silent", "-p", "--package"]);

interface PackageSpec {
  runner: string;
  spec: string;
  pinned: boolean;
  auto: boolean;
}

/** Find the package argument a fetch-and-run command will install. */
export function packageSpecOf(server: McpServerDef): PackageSpec | null {
  const command = (server.command ?? "").split("/").pop() ?? "";
  const runner = command.replace(/\.(cmd|exe)$/i, "").toLowerCase();
  if (!FETCH_RUNNERS.has(runner)) return null;
  const auto = server.args.some((a) => a === "-y" || a === "--yes");
  let spec: string | null = null;
  for (const arg of server.args) {
    if (arg.startsWith("-") || PIN_EXEMPT.has(arg)) continue;
    if (runner === "deno" && (arg === "run" || arg.startsWith("--"))) continue;
    spec = arg;
    break;
  }
  if (!spec) return null;
  const scoped = spec.startsWith("@");
  const versionPart = scoped ? spec.slice(1).split("@")[1] : spec.split("@")[1];
  const pythonPinned = /[=~<>]=/.test(spec);
  const pinned = Boolean(
    (versionPart && versionPart !== "latest" && /^[0-9]/.test(versionPart)) || pythonPinned,
  );
  return { runner, spec, pinned, auto };
}

function baseName(spec: string): string {
  const scoped = spec.startsWith("@");
  const at = scoped ? spec.indexOf("@", 1) : spec.indexOf("@");
  const name = at > 0 ? spec.slice(0, at) : spec;
  return name.split(/[=~<>]/)[0] ?? name;
}

export const supplyChainRules: Rule[] = [
  {
    id: "TW201",
    category: "supply-chain",
    severity: "medium",
    title: "Unpinned package executed on every agent start",
    description: "npx/uvx style runners re-resolve the package each launch, so a later malicious release lands on your machine without any action from you.",
    remediation: m("Pin an exact version (e.g. `pkg@1.4.2`, `pkg==1.4.2`) and bump it deliberately after review."),
    references: ["https://owasp.org/www-project-top-ten/"],
    run({ ctx, report }) {
      for (const server of ctx.servers) {
        const pkg = packageSpecOf(server);
        if (!pkg || pkg.pinned) continue;
        if (ctx.config.allowPackages.includes(baseName(pkg.spec))) continue;
        report({
          file: server.file.rel,
          line: locate(server.file, pkg.spec, server.name),
          subject: server.name,
          snippet: snippet(`${server.command} ${server.args.join(" ")}`),
          severity: pkg.auto ? "high" : "medium",
          message: m("Server \"{name}\" runs \`{runner} {spec}\` with no version pin{install}.", { name: server.name, runner: pkg.runner, spec: pkg.spec, install: pkg.auto ? " and auto-confirms the install" : "" }),
        });
      }
    },
  },
  {
    id: "TW202",
    category: "supply-chain",
    severity: "high",
    title: "Package installed from a non-registry source",
    description: "Git URLs, tarballs and local paths bypass registry checks, provenance and yanking.",
    remediation: m("Publish to a registry you control, or vendor the code into your repo so it is reviewable in diffs."),
    run({ ctx, report }) {
      const suspicious =
        /(^|\s)(git\+|https?:\/\/[^\s]+\.(tgz|tar\.gz|zip)|github:|gitlab:|file:)/i;
      for (const server of ctx.servers) {
        const line = `${server.command ?? ""} ${server.args.join(" ")}`;
        if (!suspicious.test(line)) continue;
        report({
          file: server.file.rel,
          line: locate(server.file, server.name),
          subject: server.name,
          snippet: snippet(line),
          message: m("Server \"{name}\" installs from a non-registry source.", { name: server.name }),
        });
      }
    },
  },
  {
    id: "TW203",
    category: "supply-chain",
    severity: "critical",
    title: "Remote script piped into a shell",
    description: "`curl … | sh` hands arbitrary, unreviewed, unversioned code full execution rights on the developer machine.",
    remediation: m("Download, pin by checksum, review, then execute as a separate committed step."),
    run({ ctx, report }) {
      const pipeToShell =
        /\b(curl|wget|iwr|Invoke-WebRequest)\b[^|;&\n]{0,200}\|\s*(sudo\s+)?(ba|z|k|fi|da)?sh\b|Invoke-Expression|\biex\b\s*\(/i;
      const check = (text: string, file: string, line: number | undefined, subject: string) => {
        if (!pipeToShell.test(text)) return;
        report({
          file,
          line,
          subject,
          snippet: snippet(text),
          message: m("\"{subject}\" pipes a remotely fetched script straight into a shell.", { subject: subject }),
        });
      };
      for (const server of ctx.servers) {
        check(
          `${server.command ?? ""} ${server.args.join(" ")}`,
          server.file.rel,
          locate(server.file, server.name),
          server.name,
        );
      }
      for (const hook of ctx.hooks) {
        check(hook.command, hook.file.rel, locate(hook.file, hook.command), `${hook.event} hook`);
      }
      for (const file of ctx.files) {
        if (![".sh", ".bash", ".zsh", ".py", ".js", ".mjs", ".cjs", ".ts"].includes(file.ext)) continue;
        const m = pipeToShell.exec(file.text);
        if (!m) continue;
        check(m[0], file.rel, file.text.slice(0, m.index).split("\n").length, file.rel);
      }
    },
  },
  {
    id: "TW204",
    category: "supply-chain",
    severity: "high",
    title: "Possible typosquat of a well-known MCP package",
    description: "The package name is one or two edits away from a popular MCP server, the classic install-time hijack.",
    remediation: m("Compare the name against the upstream project's README and check the publisher before installing."),
    run({ ctx, report }) {
      for (const server of ctx.servers) {
        const pkg = packageSpecOf(server);
        if (!pkg) continue;
        const name = baseName(pkg.spec);
        if (KNOWN_PACKAGES.includes(name)) continue;
        for (const known of KNOWN_PACKAGES) {
          const distance = levenshtein(name, known, 2);
          if (distance === 0 || distance > 2) continue;
          report({
            file: server.file.rel,
            line: locate(server.file, pkg.spec, server.name),
            subject: server.name,
            snippet: snippet(pkg.spec),
            message: m("Package \"{name}\" is {distance} edit(s) away from \"{known}\".", { name: name, distance: distance, known: known }),
          });
          break;
        }
      }
    },
  },
  {
    id: "TW205",
    category: "supply-chain",
    severity: "high",
    title: "Remote MCP server reached over plaintext HTTP",
    description: "Tool descriptions, arguments and auth headers all cross the network in clear text and can be rewritten in transit.",
    remediation: m("Use https://, or keep the server on localhost."),
    run({ ctx, report }) {
      for (const server of ctx.servers) {
        if (!server.url || !/^http:\/\//i.test(server.url)) continue;
        const host = hostOf(server.url);
        if (isLocalHost(host)) continue;
        report({
          file: server.file.rel,
          line: locate(server.file, server.url, server.name),
          subject: server.name,
          snippet: snippet(server.url),
          severity: Object.keys(server.headers).length > 0 ? "critical" : "high",
          message: m("Server \"{name}\" connects to {url} over plaintext HTTP{headers}.", { name: server.name, url: server.url, headers: Object.keys(server.headers).length ? " while sending headers" : "" }),
        });
      }
    },
  },
  {
    id: "TW206",
    category: "supply-chain",
    severity: "medium",
    title: "Marketplace or plugin source is unpinned",
    description: "A plugin source that tracks a moving branch installs whatever that branch holds at install time.",
    remediation: m("Reference a tag or commit SHA instead of a branch name."),
    run({ ctx, report }) {
      for (const plugin of ctx.plugins) {
        const source = plugin.raw["source"];
        const text = typeof source === "string" ? source : JSON.stringify(source ?? "");
        if (!text || text === '""') continue;
        const pinned = /\b[0-9a-f]{7,40}\b/.test(text) || /"?(ref|tag|version)"?\s*[:=]/.test(text);
        if (pinned) continue;
        report({
          file: plugin.file.rel,
          line: locate(plugin.file, plugin.name),
          subject: plugin.name,
          snippet: snippet(text),
          message: m("Plugin \"{name}\" resolves its source without a tag or commit pin.", { name: plugin.name }),
        });
      }
    },
  },
];
