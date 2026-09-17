import { m, matches, snippet } from "../core/text.js";
import type { Rule, SourceFile } from "../core/types.js";
import { locate } from "./helpers.js";

const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx", ".py", ".rb"]);
const SHELL_EXT = new Set([".sh", ".bash", ".zsh"]);

function isCode(file: SourceFile): boolean {
  return CODE_EXT.has(file.ext);
}

/** Flags that turn off the confirmation layer an agent host depends on. */
const BYPASS_FLAGS = [
  "--dangerously-skip-permissions",
  "--dangerously-allow-browser",
  "--dangerously-bypass-approvals-and-sandbox",
  "--yolo",
  "--no-sandbox",
  "--disable-web-security",
  "--allow-all",
  "--auto-approve",
  "--skip-permissions",
  "--trust-all",
];

const PERSISTENCE =
  /(~\/\.(bash|zsh)rc|~\/\.(bash_profile|profile|zprofile)|\/etc\/cron|crontab\s+-|launchctl\s+(load|bootstrap)|LaunchAgents|systemctl\s+enable|\.claude\/settings(\.local)?\.json|registry\s+add\s+HKCU)/i;

export const executionRules: Rule[] = [
  {
    id: "TW401",
    category: "execution",
    severity: "high",
    title: "Shell command built from untrusted input",
    description: "String-interpolated shell calls inside an extension turn any model-controlled argument into arbitrary command execution.",
    remediation: m("Use argv-array APIs (`execFile`, `spawn` without `shell: true`, `subprocess.run([...])`) and validate inputs."),
    references: ["https://cwe.mitre.org/data/definitions/78.html"],
    run({ ctx, report }) {
      const patterns: RegExp[] = [
        /\b(?:child_process\.)?exec(?:Sync)?\s*\(\s*[`"'][^`"'\n]{0,200}(?:\$\{|"\s*\+|'\s*\+)/g,
        /\bspawn(?:Sync)?\s*\([^)\n]{0,200}shell\s*:\s*true/g,
        /\bos\.system\s*\(\s*(?:f["']|["'][^"'\n]{0,120}["']\s*[%+]|.{0,40}\+)/g,
        /\bsubprocess\.(?:run|call|Popen|check_output)\s*\([^)\n]{0,200}shell\s*=\s*True/g,
      ];
      for (const file of ctx.files) {
        if (!isCode(file)) continue;
        for (const pattern of patterns) {
          for (const { match, line } of matches(file.text, pattern, 5)) {
            report({
              file: file.rel,
              line,
              subject: file.base,
              snippet: snippet(match[0]),
              message: m("{rel}:{line} builds a shell command from interpolated input.", { rel: file.rel, line: line }),
            });
          }
        }
      }
    },
  },
  {
    id: "TW402",
    category: "execution",
    severity: "critical",
    title: "Permission or sandbox bypass flag",
    description: "These flags disable the human confirmation and sandboxing the agent host relies on for every dangerous action.",
    remediation: m("Remove the flag. If a workflow truly needs it, isolate it in a disposable container, never on a developer machine."),
    run({ ctx, report }) {
      const check = (text: string, file: string, line: number | undefined, subject: string) => {
        for (const flag of BYPASS_FLAGS) {
          if (!text.includes(flag)) continue;
          report({
            file,
            line,
            subject,
            snippet: snippet(text),
            message: m("\"{subject}\" uses {flag}.", { subject: subject, flag: flag }),
          });
          return;
        }
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
        if (!isCode(file) && !SHELL_EXT.has(file.ext) && file.ext !== ".md" && file.ext !== ".json") continue;
        for (const flag of BYPASS_FLAGS) {
          const idx = file.text.indexOf(flag);
          if (idx < 0) continue;
          const line = file.text.slice(0, idx).split("\n").length;
          report({
            file: file.rel,
            line,
            subject: file.base,
            snippet: snippet(file.text.slice(Math.max(0, idx - 60), idx + 80)),
            severity: file.ext === ".md" ? "medium" : "critical",
            message: m("{rel}:{line} uses {flag}.", { rel: file.rel, line: line, flag: flag }),
          });
          break;
        }
      }
    },
  },
  {
    id: "TW403",
    category: "execution",
    severity: "high",
    title: "Blanket auto-approval of tool calls",
    description: "Wildcard allow lists remove the last checkpoint between a poisoned tool description and a real action on your machine.",
    remediation: m("Approve specific tools and specific command prefixes instead of `*`."),
    run({ ctx, report }) {
      const wildcard = (value: string): boolean =>
        value === "*" ||
        value === "all" ||
        /^Bash(\(\s*\*?\s*(:\s*\*)?\s*\))?$/i.test(value) ||
        /^[A-Za-z]+\(\s*\*\s*\)$/.test(value) ||
        value === "Bash(*:*)";

      for (const server of ctx.servers) {
        const hits = server.autoApprove.filter(wildcard);
        if (hits.length > 0) {
          report({
            file: server.file.rel,
            line: locate(server.file, server.name),
            subject: server.name,
            snippet: snippet(server.autoApprove.join(", ")),
            severity: "critical",
            message: m("Server \"{name}\" auto-approves every tool call ({join}).", { name: server.name, entries: hits.join(", ") }),
          });
        } else if (server.autoApprove.length >= 5) {
          report({
            file: server.file.rel,
            line: locate(server.file, server.name),
            subject: server.name,
            snippet: snippet(server.autoApprove.join(", ")),
            severity: "medium",
            message: m("Server \"{name}\" auto-approves {autoApprove} tools without confirmation.", { name: server.name, autoApprove: server.autoApprove.length }),
          });
        }
      }

      for (const setting of ctx.settings) {
        const permissions = setting.raw["permissions"];
        if (permissions && typeof permissions === "object") {
          const record = permissions as Record<string, unknown>;
          const allow = Array.isArray(record["allow"]) ? (record["allow"] as unknown[]) : [];
          const hits = allow.map(String).filter(wildcard);
          if (hits.length > 0) {
            report({
              file: setting.file.rel,
              line: locate(setting.file, String(hits[0])),
              subject: "permissions.allow",
              snippet: snippet(hits.join(", ")),
              message: m("permissions.allow contains wildcard entries ({entries}).", { entries: hits.join(", ") }),
            });
          }
          const mode = String(record["defaultMode"] ?? "");
          if (/bypass/i.test(mode) || /acceptEdits/i.test(mode)) {
            report({
              file: setting.file.rel,
              line: locate(setting.file, mode),
              subject: "permissions.defaultMode",
              snippet: snippet(mode),
              severity: /bypass/i.test(mode) ? "critical" : "medium",
              message: m("permissions.defaultMode is \"{mode}\", so actions run without asking.", { mode: mode }),
            });
          }
        }
      }

      for (const skill of ctx.skills) {
        const hits = skill.allowedTools.filter(wildcard);
        if (hits.length === 0) continue;
        report({
          file: skill.file.rel,
          line: locate(skill.file, hits[0] ?? skill.name),
          subject: skill.name,
          snippet: snippet(skill.allowedTools.join(", ")),
          severity: "medium",
          message: m("Skill \"{name}\" requests wildcard tool access ({join}).", { name: skill.name, entries: hits.join(", ") }),
        });
      }
    },
  },
  {
    id: "TW404",
    category: "execution",
    severity: "medium",
    title: "Hook runs on every event with a broad matcher",
    description: "A hook with a `*` matcher sees every tool call and its arguments, and runs before you approve anything.",
    remediation: m("Scope the matcher to the tools you actually need, and keep the hook command short and auditable."),
    run({ ctx, report }) {
      const networky = /\b(curl|wget|nc|ncat|socat|http(s)?:\/\/|requests\.|urllib|fetch\()/i;
      for (const hook of ctx.hooks) {
        const broad = hook.matcher === "*" || hook.matcher === "" || hook.matcher === ".*";
        if (!broad) continue;
        const exfil = networky.test(hook.command);
        report({
          file: hook.file.rel,
          line: locate(hook.file, hook.command),
          subject: `${hook.event} hook`,
          snippet: snippet(hook.command),
          severity: exfil ? "critical" : "medium",
          message: exfil
            ? m("The {event} hook matches every tool call and sends data over the network.", { event: hook.event })
            : m("The {event} hook matches every tool call.", { event: hook.event }),
        });
      }
    },
  },
  {
    id: "TW405",
    category: "execution",
    severity: "high",
    title: "Persistence or self-modification of agent configuration",
    description: "Writing to shell profiles, cron, launch agents or the host's own settings lets an extension survive its own removal.",
    remediation: m("Remove the write. Installation steps belong in a documented, user-run command, not in a tool call."),
    run({ ctx, report }) {
      const writeish = /\b(write|append|open\s*\(|>>|>\s*~|tee|echo\s+.{0,80}>>|fs\.(write|append))/i;
      for (const file of ctx.files) {
        if (!isCode(file) && !SHELL_EXT.has(file.ext)) continue;
        for (const { match, line } of matches(file.text, new RegExp(PERSISTENCE.source, "gi"), 5)) {
          const start = Math.max(0, match.index - 120);
          const context = file.text.slice(start, match.index + match[0].length + 60);
          if (!writeish.test(context)) continue;
          report({
            file: file.rel,
            line,
            subject: file.base,
            snippet: snippet(context),
            message: m("{rel}:{line} writes to \"{match}\", creating persistence.", { rel: file.rel, line: line, match: match[0] }),
          });
        }
      }
      for (const hook of ctx.hooks) {
        if (!PERSISTENCE.test(hook.command)) continue;
        report({
          file: hook.file.rel,
          line: locate(hook.file, hook.command),
          subject: `${hook.event} hook`,
          snippet: snippet(hook.command),
          message: m("The {event} hook touches a persistence location.", { event: hook.event }),
        });
      }
    },
  },
  {
    id: "TW406",
    category: "execution",
    severity: "high",
    title: "Overly broad filesystem scope",
    description: "Granting `/`, `$HOME` or `~` to a filesystem server exposes SSH keys, browser profiles and every other project on the machine.",
    remediation: m("Grant one project directory per server and add a second server if you truly need a second scope."),
    run({ ctx, report }) {
      const broad = new Set(["/", "~", "$HOME", "${HOME}", "%USERPROFILE%", "C:\\", "/Users", "/home"]);
      for (const server of ctx.servers) {
        for (const arg of server.args) {
          const value = arg.trim().replace(/\/$/, "") || "/";
          if (!broad.has(value) && !broad.has(arg.trim())) continue;
          report({
            file: server.file.rel,
            line: locate(server.file, arg, server.name),
            subject: server.name,
            snippet: snippet(server.args.join(" ")),
            severity: value === "/" ? "critical" : "high",
            message: m("Server \"{name}\" is granted the whole path \"{arg}\".", { name: server.name, arg: arg }),
          });
        }
      }
      for (const setting of ctx.settings) {
        const permissions = setting.raw["permissions"] as Record<string, unknown> | undefined;
        const dirs = permissions && Array.isArray(permissions["additionalDirectories"])
          ? (permissions["additionalDirectories"] as unknown[]).map(String)
          : [];
        for (const dir of dirs) {
          if (!broad.has(dir.trim().replace(/\/$/, "") || "/")) continue;
          report({
            file: setting.file.rel,
            line: locate(setting.file, dir),
            subject: "permissions.additionalDirectories",
            snippet: snippet(dir),
            message: m("additionalDirectories grants \"{dir}\".", { dir: dir }),
          });
        }
      }
    },
  },
  {
    id: "TW407",
    category: "execution",
    severity: "high",
    title: "Dynamic code evaluation",
    description: "`eval`, `new Function`, `pickle.loads` and unsafe YAML turn data into code, which is exactly what an injected payload needs.",
    remediation: m("Parse data with a data parser (`JSON.parse`, `yaml.safe_load`, `json.loads`) and drop the eval path entirely."),
    references: ["https://cwe.mitre.org/data/definitions/95.html"],
    run({ ctx, report }) {
      const patterns: RegExp[] = [
        /\beval\s*\(/g,
        /\bnew\s+Function\s*\(/g,
        /\bvm\.run(?:InNewContext|InThisContext)\s*\(/g,
        /\bpickle\.loads?\s*\(/g,
        /\byaml\.load\s*\((?![^)]*Safe)/g,
        /\bexec\s*\(\s*(?:f?["'`]|base64|codecs|compile\()/g,
      ];
      for (const file of ctx.files) {
        if (!isCode(file)) continue;
        for (const pattern of patterns) {
          for (const { match, line } of matches(file.text, pattern, 4)) {
            const start = Math.max(0, match.index - 40);
            report({
              file: file.rel,
              line,
              subject: file.base,
              snippet: snippet(file.text.slice(start, match.index + match[0].length + 60)),
              message: m("{rel}:{line} evaluates code at runtime via {call}.", { rel: file.rel, line: line, call: match[0].trim() }),
            });
          }
        }
      }
    },
  },
];
