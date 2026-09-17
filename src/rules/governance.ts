import { existsSync } from "node:fs";
import { join } from "node:path";
import { m, snippet } from "../core/text.js";
import type { Rule } from "../core/types.js";
import { locate } from "./helpers.js";

/** Tool names that shadow a host's own built-ins in most agent runtimes. */
const HOST_BUILTINS = new Set([
  "read",
  "write",
  "edit",
  "bash",
  "glob",
  "grep",
  "task",
  "webfetch",
  "websearch",
  "read_file",
  "write_file",
  "edit_file",
  "list_files",
  "run_command",
  "execute_command",
  "str_replace_editor",
  "computer",
]);

export const LOCK_FILENAME = ".toolward.lock.json";

export const governanceRules: Rule[] = [
  {
    id: "TW601",
    category: "governance",
    severity: "low",
    title: "Extension has no provenance metadata",
    description: "Without an author, repository or licence there is no one to notify when the extension turns out to be malicious.",
    remediation: m("Add `author`, `repository`/`homepage` and `license` to the manifest, and `name` + `description` to skill frontmatter."),
    run({ ctx, report }) {
      for (const plugin of ctx.plugins) {
        const missing = ["author", "version", "license"].filter((key) => {
          const value = plugin.raw[key];
          if (key === "license" && (plugin.raw["repository"] || plugin.raw["homepage"])) {
            return !value;
          }
          return value === undefined || value === null || value === "";
        });
        if (missing.length === 0) continue;
        report({
          file: plugin.file.rel,
          line: locate(plugin.file, plugin.name),
          subject: plugin.name,
          snippet: snippet(missing.join(", ")),
          message: m("Plugin \"{name}\" is missing: {join}.", { name: plugin.name, join: missing.join(", ") }),
        });
      }
      for (const skill of ctx.skills) {
        const missing: string[] = [];
        if (!skill.frontmatter["name"]) missing.push("name");
        if (!skill.description.trim()) missing.push("description");
        if (missing.length === 0) continue;
        report({
          file: skill.file.rel,
          line: 1,
          subject: skill.name,
          snippet: snippet(missing.join(", ")),
          message: m("Skill \"{name}\" frontmatter is missing: {join}.", { name: skill.name, join: missing.join(", ") }),
        });
      }
    },
  },
  {
    id: "TW603",
    category: "governance",
    severity: "medium",
    title: "Duplicate tool name across servers",
    description: "When two servers expose the same tool name the agent picks one by ordering, so a later install can silently take over an existing call site.",
    remediation: m("Namespace your tool names, or remove one of the two servers."),
    run({ ctx, report }) {
      const byName = new Map<string, typeof ctx.tools>();
      for (const tool of ctx.tools) {
        const list = byName.get(tool.name) ?? [];
        list.push(tool);
        byName.set(tool.name, list);
      }
      for (const [name, list] of byName) {
        const servers = new Set(list.map((tool) => tool.server ?? tool.file.rel));
        if (servers.size < 2) continue;
        const first = list[0];
        if (!first) continue;
        report({
          file: first.file.rel,
          line: locate(first.file, name),
          subject: name,
          snippet: snippet([...servers].join(", ")),
          message: m("Tool \"{name}\" is exposed by {size} different sources: {join}.", { name: name, size: servers.size, join: [...servers].join(", ") }),
        });
      }
    },
  },
  {
    id: "TW604",
    category: "governance",
    severity: "medium",
    title: "Tool name shadows a host built-in",
    description: "A tool called `read_file` or `bash` competes with the host's own tool of that name and can capture calls intended for it.",
    remediation: m("Prefix tool names with your product, e.g. `acme_read_file`."),
    run({ ctx, report }) {
      for (const tool of ctx.tools) {
        if (!HOST_BUILTINS.has(tool.name.toLowerCase())) continue;
        report({
          file: tool.file.rel,
          line: locate(tool.file, tool.name),
          subject: tool.name,
          snippet: snippet(tool.name),
          message: m("Tool \"{name}\" uses the same name as a common host built-in.", { name: tool.name }),
        });
      }
    },
  },
  {
    id: "TW605",
    category: "governance",
    severity: "low",
    title: "Skill grants itself execution without declaring it",
    description: "A skill whose body runs shell commands but declares no `allowed-tools` inherits whatever the session already has.",
    remediation: m("Declare the minimum `allowed-tools` the skill needs, e.g. `Bash(git status:*), Read`."),
    run({ ctx, report }) {
      const runsCommands = /```(?:bash|sh|zsh|shell)\b|\brun\s+`|\bexecute\s+the\s+command\b/i;
      for (const skill of ctx.skills) {
        if (skill.allowedTools.length > 0) continue;
        if (!runsCommands.test(skill.body)) continue;
        report({
          file: skill.file.rel,
          line: 1,
          subject: skill.name,
          snippet: snippet(skill.description || skill.name),
          message: m("Skill \"{name}\" runs shell commands but declares no allowed-tools.", { name: skill.name }),
        });
      }
    },
  },
  {
    id: "TW606",
    category: "governance",
    severity: "info",
    title: "Tool surface is not pinned against silent changes",
    description: "Without a lock file there is nothing to compare against, so a server that changes its tool descriptions after you approve it (a rug pull) goes unnoticed.",
    remediation: m("Run `toolward lock` to record the current surface, commit the lock file, then run `toolward verify` in CI."),
    run({ ctx, report }) {
      if (ctx.tools.length === 0 && ctx.servers.length === 0) return;
      if (existsSync(join(ctx.root, LOCK_FILENAME))) return;
      report({
        file: LOCK_FILENAME,
        subject: "lockfile",
        message: m("No {lockFile} found for {servers} server(s) and {tools} tool(s).", { lockFile: LOCK_FILENAME, servers: ctx.servers.length, tools: ctx.tools.length }),
      });
    },
  },
];
