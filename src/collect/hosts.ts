import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Where the agent hosts people actually run keep the things Toolward audits.
 *
 * This table is a convenience, not a dependency: Toolward finds MCP servers by
 * structure, so pointing it at any directory works even for a host that is not
 * listed here. The list exists so `toolward hosts` can tell you what is
 * installed on this machine without you having to remember eleven paths.
 */
export interface KnownHost {
  id: string;
  name: string;
  /** Config surfaces, in the order a reader would expect to see them. */
  paths: string[];
  note?: string;
}

function appSupport(home: string, platform: NodeJS.Platform, appDir: string): string {
  if (platform === "darwin") return join(home, "Library", "Application Support", appDir);
  if (platform === "win32") return join(process.env["APPDATA"] ?? join(home, "AppData", "Roaming"), appDir);
  return join(home, ".config", appDir);
}

export function knownHosts(home = homedir(), platform: NodeJS.Platform = process.platform): KnownHost[] {
  const code = appSupport(home, platform, "Code");
  return [
    {
      id: "claude-code",
      name: "Claude Code",
      paths: [
        join(home, ".claude.json"),
        join(home, ".claude", "settings.json"),
        join(home, ".claude", "skills"),
        join(home, ".claude", "agents"),
        join(home, ".claude", "commands"),
        join(home, ".claude", "plugins"),
      ],
      note: "also scan each project's .mcp.json and .claude/",
    },
    {
      id: "claude-desktop",
      name: "Claude Desktop",
      paths: [join(appSupport(home, platform, "Claude"), "claude_desktop_config.json")],
    },
    {
      id: "codex",
      name: "Codex CLI",
      paths: [join(home, ".codex", "config.toml")],
    },
    {
      id: "cursor",
      name: "Cursor",
      paths: [join(home, ".cursor", "mcp.json")],
      note: "per project: .cursor/mcp.json",
    },
    {
      id: "windsurf",
      name: "Windsurf",
      paths: [join(home, ".codeium", "windsurf", "mcp_config.json")],
    },
    {
      id: "vscode",
      name: "VS Code",
      paths: [join(code, "User", "mcp.json"), join(code, "User", "settings.json")],
      note: "per project: .vscode/mcp.json",
    },
    {
      id: "cline",
      name: "Cline / Roo Code",
      paths: [
        join(code, "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
        join(code, "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "mcp_settings.json"),
      ],
    },
    {
      id: "zed",
      name: "Zed",
      paths: [join(home, ".config", "zed", "settings.json")],
    },
    {
      id: "gemini-cli",
      name: "Gemini CLI",
      paths: [join(home, ".gemini", "settings.json")],
    },
    {
      id: "continue",
      name: "Continue",
      paths: [join(home, ".continue", "config.json"), join(home, ".continue", "mcpServers")],
    },
    {
      id: "goose",
      name: "Goose",
      paths: [join(home, ".config", "goose", "config.yaml")],
    },
    {
      id: "lmstudio",
      name: "LM Studio",
      paths: [join(home, ".lmstudio", "mcp.json")],
    },
    {
      id: "openworkbuddy",
      name: "OpenWorkBuddy",
      paths: [join(home, ".openworkbuddy")],
      note: "per workspace: .openworkbuddy/",
    },
  ];
}

/** `~/x` in a user-supplied host path, so config files stay portable. */
export function expandHome(path: string, home = homedir()): string {
  if (path === "~") return home;
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(home, path.slice(2));
  return path;
}

export interface DetectedHost extends KnownHost {
  found: string[];
}

/** The subset of `knownHosts()` that actually has files on this machine. */
export function detectHosts(
  extra: { name: string; paths: string[] }[] = [],
  home?: string,
): DetectedHost[] {
  const custom: KnownHost[] = extra.map((host) => ({
    id: host.name.toLowerCase().replace(/\s+/g, "-"),
    name: host.name,
    paths: host.paths.map((path) => expandHome(path, home)),
  }));
  const out: DetectedHost[] = [];
  for (const host of [...knownHosts(home), ...custom]) {
    const found = host.paths.filter((path) => existsSync(path));
    if (found.length > 0) out.push({ ...host, found });
  }
  return out;
}
