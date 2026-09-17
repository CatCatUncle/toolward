import { dirname } from "node:path";
import { parseFrontmatter, parseJsonc, toStringList } from "../core/parse.js";
import type {
  AgentDef,
  HookDef,
  McpServerDef,
  PluginDef,
  PromptChunk,
  ResolvedConfig,
  ScanContext,
  SettingsDef,
  SkillDef,
  SourceFile,
  ToolDef,
} from "../core/types.js";
import { commonRoot, walk } from "./walk.js";
import { parseTomlLite } from "../core/toml.js";

const MAX_PROMPT_CHARS = 200_000;

const MCP_CONFIG_BASENAMES = new Set([
  "mcp.json",
  ".mcp.json",
  "mcp_settings.json",
  "claude_desktop_config.json",
  "cline_mcp_settings.json",
  "mcp-config.json",
  "mcp.servers.json",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      out[key] = String(item);
    }
  }
  return out;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string") as string[];
}

/**
 * Pull the `{ name: definition }` map of MCP servers out of any known host config shape.
 *
 * `mcpServers` / `context_servers` are unambiguous and accepted anywhere. The bare
 * `servers` key (VS Code style) is far too generic, so it is only honoured for files
 * that are actually MCP configs, otherwise every unrelated app config would be
 * misread as a server list.
 */
export function extractServerMap(raw: unknown, file?: SourceFile): Record<string, unknown> | null {
  const root = asRecord(raw);
  if (!root) return null;
  const direct = asRecord(root["mcpServers"]) ?? asRecord(root["mcp_servers"]);
  if (direct) return direct;
  // VS Code settings.json nests under "mcp", Zed under "context_servers".
  const nested = asRecord(root["mcp"]);
  if (nested) {
    const inner = asRecord(nested["servers"]);
    if (inner) return inner;
  }
  const zed = asRecord(root["context_servers"]);
  if (zed) return zed;
  if (file && isMcpConfigFile(file)) {
    const generic = asRecord(root["servers"]);
    if (generic) return generic;
  }
  return null;
}

export function isMcpConfigFile(file: SourceFile): boolean {
  if (MCP_CONFIG_BASENAMES.has(file.base)) return true;
  const dir = file.rel.split("/").slice(0, -1);
  return (dir.includes(".vscode") || dir.includes(".cursor")) && file.base.startsWith("mcp");
}

export function normaliseServer(
  name: string,
  value: unknown,
  file: SourceFile,
): McpServerDef | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const command = typeof raw["command"] === "string" ? (raw["command"] as string) : undefined;
  const url =
    typeof raw["url"] === "string"
      ? (raw["url"] as string)
      : typeof raw["serverUrl"] === "string"
        ? (raw["serverUrl"] as string)
        : typeof raw["endpoint"] === "string"
          ? (raw["endpoint"] as string)
          : undefined;
  const declared = String(raw["type"] ?? raw["transport"] ?? "").toLowerCase();
  const transport: McpServerDef["transport"] =
    declared === "stdio" || declared === "sse" || declared === "http"
      ? (declared as McpServerDef["transport"])
      : declared === "streamable-http" || declared === "streamablehttp"
        ? "http"
        : command
          ? "stdio"
          : url
            ? "http"
            : "unknown";
  return {
    name,
    file,
    command,
    args: asStringArray(raw["args"]),
    env: asStringRecord(raw["env"]),
    url,
    headers: asStringRecord(raw["headers"]),
    transport,
    autoApprove: [...asStringArray(raw["autoApprove"]), ...asStringArray(raw["alwaysAllow"])],
    disabled: raw["disabled"] === true,
    raw,
  };
}

function toolFrom(entry: unknown, file: SourceFile, server?: string): ToolDef | null {
  const raw = asRecord(entry);
  if (!raw) return null;
  // OpenAI-style wrappers: { type: "function", function: { name, description } }
  const inner = asRecord(raw["function"]) ?? raw;
  const name = inner["name"];
  if (typeof name !== "string" || !name) return null;
  const description = typeof inner["description"] === "string" ? (inner["description"] as string) : "";
  const schema = inner["inputSchema"] ?? inner["input_schema"] ?? inner["parameters"] ?? null;
  return {
    name,
    description,
    server,
    file,
    schemaText: schema ? JSON.stringify(schema) : "",
    raw: entry,
  };
}

/** Recognise `tools/list` dumps, connector manifests and OpenAI function arrays. */
export function extractTools(raw: unknown, file: SourceFile): ToolDef[] {
  const out: ToolDef[] = [];
  const push = (list: unknown, server?: string): void => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      const tool = toolFrom(entry, file, server);
      if (tool) out.push(tool);
    }
  };
  if (Array.isArray(raw)) {
    push(raw);
    return out;
  }
  const root = asRecord(raw);
  if (!root) return out;
  const server =
    typeof root["server"] === "string"
      ? (root["server"] as string)
      : typeof root["name"] === "string" && Array.isArray(root["tools"])
        ? (root["name"] as string)
        : undefined;
  push(root["tools"], server);
  push(root["functions"], server);
  const result = asRecord(root["result"]);
  if (result) push(result["tools"], server);
  return out;
}

/** Both the modern `{matcher, hooks:[{type,command}]}` shape and the flat legacy one. */
export function extractHooks(raw: unknown, file: SourceFile): HookDef[] {
  const container = asRecord(raw);
  if (!container) return [];
  const hooksRoot = asRecord(container["hooks"]) ?? container;
  const out: HookDef[] = [];
  for (const [event, value] of Object.entries(hooksRoot)) {
    if (!Array.isArray(value)) continue;
    for (const groupRaw of value) {
      const group = asRecord(groupRaw);
      if (!group) continue;
      const matcher = typeof group["matcher"] === "string" ? (group["matcher"] as string) : "*";
      const nested = group["hooks"];
      if (Array.isArray(nested)) {
        for (const hookRaw of nested) {
          const hook = asRecord(hookRaw);
          if (!hook) continue;
          const command = hook["command"];
          if (typeof command !== "string") continue;
          out.push({
            event,
            matcher,
            type: String(hook["type"] ?? "command"),
            command,
            file,
          });
        }
        continue;
      }
      if (typeof group["command"] === "string") {
        out.push({
          event,
          matcher,
          type: String(group["type"] ?? "command"),
          command: group["command"] as string,
          file,
        });
      }
    }
  }
  return out;
}

function isPluginManifest(file: SourceFile, raw: Record<string, unknown>): boolean {
  if (file.rel.includes(".claude-plugin/")) return true;
  if (file.base !== "plugin.json") return false;
  return typeof raw["name"] === "string" && ("description" in raw || "author" in raw);
}

function isSettingsFile(file: SourceFile, raw: Record<string, unknown>): boolean {
  if (!/^settings(\.local)?\.json$/.test(file.base)) return false;
  return (
    "permissions" in raw || "hooks" in raw || "env" in raw || "mcpServers" in raw || "model" in raw
  );
}

function agentKind(file: SourceFile): AgentDef["kind"] | null {
  const parts = file.rel.split("/");
  if (parts.includes("agents") || parts.includes("subagents")) return "agent";
  if (parts.includes("commands")) return "command";
  return null;
}

export interface CollectOptions {
  /** Extra files to treat as tool dumps regardless of shape heuristics. */
  toolDumps?: string[];
}

export function collect(
  targets: string[],
  config: ResolvedConfig,
  options: CollectOptions = {},
): ScanContext {
  const root = commonRoot(targets);
  const files = walk(targets, root, config);
  const forcedToolDumps = new Set(options.toolDumps ?? []);

  const servers: McpServerDef[] = [];
  const tools: ToolDef[] = [];
  const skills: SkillDef[] = [];
  const plugins: PluginDef[] = [];
  const hooks: HookDef[] = [];
  const settings: SettingsDef[] = [];
  const agents: AgentDef[] = [];
  const prompts: PromptChunk[] = [];
  const consumedMarkdown = new Set<string>();

  for (const file of files) {
    const structured =
      file.ext === ".json" || file.ext === ".jsonc" || file.ext === ".json5"
        ? parseJsonc(file.text)
        : file.ext === ".toml"
          ? parseTomlLite(file.text)
          : undefined;
    if (structured !== undefined) {
      const raw = structured;
      const record = asRecord(raw);

      const serverMap = extractServerMap(raw, file);
      if (serverMap) {
        for (const [name, value] of Object.entries(serverMap)) {
          const server = normaliseServer(name, value, file);
          if (server) servers.push(server);
        }
      }

      if (record) {
        if (isPluginManifest(file, record)) {
          plugins.push({
            name: String(record["name"] ?? file.rel),
            file,
            dir: dirname(file.abs),
            raw: record,
          });
        }
        if (isSettingsFile(file, record)) {
          settings.push({ file, raw: record });
        }
        if ("hooks" in record || file.base === "hooks.json") {
          hooks.push(...extractHooks(record, file));
        }
        const marketplacePlugins = record["plugins"];
        if (file.base === "marketplace.json" && Array.isArray(marketplacePlugins)) {
          for (const entry of marketplacePlugins) {
            const plugin = asRecord(entry);
            if (!plugin) continue;
            plugins.push({
              name: String(plugin["name"] ?? "unnamed"),
              file,
              dir: dirname(file.abs),
              raw: plugin,
            });
          }
        }
      }

      const looksLikeToolDump =
        forcedToolDumps.has(file.abs) ||
        Array.isArray(raw) ||
        (record && (Array.isArray(record["tools"]) || Array.isArray(record["functions"]))) ||
        (record && asRecord(record["result"]) !== null);
      if (looksLikeToolDump) tools.push(...extractTools(raw, file));
      continue;
    }

    if (file.base === "SKILL.md") {
      const { data, body } = parseFrontmatter(file.text);
      skills.push({
        name: String(data["name"] ?? dirname(file.rel).split("/").pop() ?? file.rel),
        description: String(data["description"] ?? ""),
        file,
        dir: dirname(file.abs),
        frontmatter: data,
        body,
        allowedTools: toStringList(data["allowed-tools"] ?? data["allowedTools"] ?? data["tools"]),
      });
      consumedMarkdown.add(file.abs);
      continue;
    }

    if (file.ext === ".md" || file.ext === ".markdown" || file.ext === ".mdx") {
      const kind = agentKind(file);
      if (kind) {
        const { data, body, found } = parseFrontmatter(file.text);
        if (found) {
          agents.push({
            kind,
            name: String(data["name"] ?? file.base.replace(/\.[^.]+$/, "")),
            file,
            frontmatter: data,
            body,
          });
          consumedMarkdown.add(file.abs);
        }
      }
    }
  }

  // Prompt chunks: every piece of text that can reach the model's context.
  const add = (chunk: PromptChunk): void => {
    if (!chunk.text.trim()) return;
    prompts.push({ ...chunk, text: chunk.text.slice(0, MAX_PROMPT_CHARS) });
  };

  for (const tool of tools) {
    add({
      origin: "tool-description",
      subject: tool.server ? `${tool.server}/${tool.name}` : tool.name,
      text: tool.description,
      file: tool.file,
    });
    if (tool.schemaText) {
      add({
        origin: "tool-schema",
        subject: tool.server ? `${tool.server}/${tool.name}` : tool.name,
        text: tool.schemaText,
        file: tool.file,
      });
    }
  }
  for (const skill of skills) {
    add({
      origin: "skill",
      subject: skill.name,
      text: `${skill.description}\n${skill.body}`,
      file: skill.file,
    });
  }
  for (const agent of agents) {
    add({
      origin: agent.kind,
      subject: agent.name,
      text: `${String(agent.frontmatter["description"] ?? "")}\n${agent.body}`,
      file: agent.file,
    });
  }
  for (const plugin of plugins) {
    add({
      origin: "plugin",
      subject: plugin.name,
      text: String(plugin.raw["description"] ?? ""),
      file: plugin.file,
    });
  }
  for (const server of servers) {
    add({ origin: "server-name", subject: server.name, text: server.name, file: server.file });
  }
  for (const file of files) {
    if (consumedMarkdown.has(file.abs)) continue;
    if (file.ext === ".md" || file.ext === ".markdown" || file.ext === ".mdx") {
      add({ origin: "markdown", subject: file.rel, text: file.text, file });
    }
  }

  return { root, files, servers, tools, skills, plugins, hooks, settings, agents, prompts, config };
}
