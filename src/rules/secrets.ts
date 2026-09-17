import { entropy, m, matches, redact, snippet } from "../core/text.js";
import type { Rule, SourceFile } from "../core/types.js";
import { locate } from "./helpers.js";

interface SecretPattern {
  name: string;
  re: RegExp;
}

/** High-confidence provider token shapes. Prefix-anchored to keep noise down. */
const SECRET_PATTERNS: SecretPattern[] = [
  { name: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{24,}/g },
  { name: "OpenAI API key", re: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  { name: "GitHub token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}/g },
  { name: "GitHub fine-grained token", re: /\bgithub_pat_[A-Za-z0-9_]{60,}/g },
  { name: "GitLab token", re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { name: "AWS access key id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: "Slack webhook", re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/+_-]{20,}/g },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "Hugging Face token", re: /\bhf_[A-Za-z0-9]{30,}/g },
  { name: "Stripe secret key", re: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}/g },
  { name: "DigitalOcean token", re: /\bdop_v1_[a-f0-9]{64}\b/g },
  { name: "Telegram bot token", re: /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/g },
  { name: "Private key block", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { name: "JSON Web Token", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
];

const SECRET_KEY_NAME = /(api[_-]?key|apikey|secret|token|password|passwd|pwd|credential|auth)/i;

const PLACEHOLDER =
  /^(\$\{|\$[A-Z_]+$|<|\{\{|your[_-]?|my[_-]?|example|sample|test|dummy|placeholder|changeme|redacted|xxx|\*{3,}|\.{3}|todo|none|null|undefined|insert)/i;

export function looksLikePlaceholder(value: string): boolean {
  if (!value) return true;
  if (PLACEHOLDER.test(value.trim())) return true;
  if (/^\$\{[^}]+\}$/.test(value.trim())) return true;
  if (/YOUR[_-]?[A-Z]/.test(value)) return true;
  if (/^[a-z_]+$/.test(value) && value.length < 24) return true;
  return false;
}

/** A value that is long, dense and not a placeholder is probably a live credential. */
export function looksLikeSecretValue(key: string, value: string): boolean {
  if (!SECRET_KEY_NAME.test(key)) return false;
  const trimmed = value.trim();
  if (trimmed.length < 16 || trimmed.length > 500) return false;
  if (looksLikePlaceholder(trimmed)) return false;
  if (/\s/.test(trimmed)) return false;
  if (/^(https?|file):\/\//i.test(trimmed)) return false;
  return entropy(trimmed) >= 3.4;
}

function scanFileForPatterns(
  file: SourceFile,
  emit: (name: string, value: string, line: number) => void,
): void {
  for (const pattern of SECRET_PATTERNS) {
    for (const { match, line } of matches(file.text, pattern.re, 10)) {
      emit(pattern.name, match[0], line);
    }
  }
}

export const secretRules: Rule[] = [
  {
    id: "TW301",
    category: "secrets",
    severity: "critical",
    title: "Hard-coded credential in an agent configuration",
    description: "Agent configs are committed, synced and shared far more casually than .env files; a live key here is effectively published.",
    remediation: m("Move the value into an environment variable reference (`${VAR}`) or your OS keychain, then rotate the exposed key."),
    run({ ctx, report }) {
      const configFiles = new Set<string>();
      for (const server of ctx.servers) configFiles.add(server.file.abs);
      for (const setting of ctx.settings) configFiles.add(setting.file.abs);
      // Credentials already reported from a parsed entry, so the raw-text sweep
      // below does not report the same value a second time.
      const seen = new Set<string>();

      for (const server of ctx.servers) {
        const pairs: Array<[string, string, string]> = [
          ...Object.entries(server.env).map(([k, v]) => [k, v, "env"] as [string, string, string]),
          ...Object.entries(server.headers).map(
            ([k, v]) => [k, v, "header"] as [string, string, string],
          ),
        ];
        for (const [key, rawValue, kind] of pairs) {
          const value = kind === "header" ? rawValue.replace(/^Bearer\s+/i, "") : rawValue;
          let detected: string | null = null;
          for (const pattern of SECRET_PATTERNS) {
            if (new RegExp(pattern.re.source).test(value)) {
              detected = pattern.name;
              break;
            }
          }
          if (!detected && looksLikeSecretValue(key, value)) detected = "high-entropy secret";
          if (!detected) continue;
          seen.add(`${server.file.abs}|${redact(value)}`);
          report({
            file: server.file.rel,
            line: locate(server.file, rawValue, server.name),
            subject: `${server.name}.${key}`,
            snippet: `${key}=${redact(value)}`,
            message: m("{detected} in {kind} \"{key}\" of server \"{name}\" ({value}).", { detected: detected, kind: kind, key: key, name: server.name, value: redact(value) }),
          });
        }
      }

      // Argument lists are the other place keys get pasted.
      for (const server of ctx.servers) {
        for (const arg of server.args) {
          for (const pattern of SECRET_PATTERNS) {
            const found = new RegExp(pattern.re.source).exec(arg);
            if (!found) continue;
            seen.add(`${server.file.abs}|${redact(found[0])}`);
            report({
              file: server.file.rel,
              line: locate(server.file, arg, server.name),
              subject: server.name,
              snippet: redact(found[0]),
              message: m("{kind} passed on the command line of server \"{name}\" ({value}).", { kind: pattern.name, name: server.name, value: redact(found[0]) }),
            });
            break;
          }
        }
      }

      // Whole-file sweep, minus anything already reported from a parsed server entry.
      for (const file of ctx.files) {
        if (!configFiles.has(file.abs)) continue;
        scanFileForPatterns(file, (name, value, line) => {
          if (seen.has(`${file.abs}|${redact(value)}`)) return;
          report({
            file: file.rel,
            line,
            subject: file.base,
            snippet: redact(value),
            message: m("{name} found in {base} ({value}).", { name: name, base: file.base, value: redact(value) }),
          });
        });
      }
    },
  },
  {
    id: "TW302",
    category: "secrets",
    severity: "high",
    title: "Credential in source, skill or documentation file",
    description: "Keys committed anywhere in the repository are retrievable from history forever, even after the file is deleted.",
    remediation: m("Rotate the credential first, then purge it from git history — deleting the line is not enough."),
    run({ ctx, report }) {
      const configFiles = new Set<string>();
      for (const server of ctx.servers) configFiles.add(server.file.abs);
      for (const setting of ctx.settings) configFiles.add(setting.file.abs);
      // Credentials already reported from a parsed entry, so the raw-text sweep
      // below does not report the same value a second time.
      const seen = new Set<string>();
      for (const file of ctx.files) {
        if (configFiles.has(file.abs)) continue; // covered by TW301
        scanFileForPatterns(file, (name, value, line) => {
          report({
            file: file.rel,
            line,
            subject: file.base,
            snippet: redact(value),
            message: m("{name} found in {rel} ({value}).", { name: name, rel: file.rel, value: redact(value) }),
          });
        });
      }
    },
  },
  {
    id: "TW303",
    category: "secrets",
    severity: "high",
    title: "Extension reads sensitive local files",
    description: "SSH keys, cloud credentials, browser cookies and shell history are the standard loot of a compromised extension.",
    remediation: m("Remove the access. If a credential really is needed, take it as an explicit parameter with a documented scope."),
    run({ ctx, report }) {
      const sensitive =
        /(~\/\.ssh\/|\/\.ssh\/id_|id_rsa|id_ed25519|\.aws\/credentials|\.config\/gcloud|\.kube\/config|\.git-credentials|\.npmrc|\.pypirc|\.netrc|Login Data|Cookies\.binarycookies|Library\/Keychains|\.docker\/config\.json|\.bash_history|\.zsh_history|\/etc\/shadow)/;
      for (const file of ctx.files) {
        for (const { match, line } of matches(file.text, new RegExp(sensitive.source, "g"), 6)) {
          const start = Math.max(0, match.index - 60);
          report({
            file: file.rel,
            line,
            subject: file.base,
            snippet: snippet(file.text.slice(start, match.index + match[0].length + 40)),
            message: m("{rel} references the sensitive path \"{path}\".", { rel: file.rel, path: match[0] }),
          });
        }
      }
      for (const server of ctx.servers) {
        const joined = server.args.join(" ");
        const found = sensitive.exec(joined);
        if (!found) continue;
        report({
          file: server.file.rel,
          line: locate(server.file, found[0], server.name),
          subject: server.name,
          snippet: snippet(joined),
          severity: "critical",
          message: m("Server \"{name}\" is given access to \"{path}\" through its arguments.", { name: server.name, path: found[0] }),
        });
      }
    },
  },
  {
    id: "TW304",
    category: "secrets",
    severity: "medium",
    title: "Whole environment forwarded to a server",
    description: "Passing the full process environment hands every unrelated key in your shell to that server.",
    remediation: m("List only the variables the server actually needs."),
    run({ ctx, report }) {
      for (const server of ctx.servers) {
        for (const [key, value] of Object.entries(server.env)) {
          const broad =
            key === "*" ||
            /^\$\{?(process\.)?env\}?$/i.test(value.trim()) ||
            value.trim() === "${env}" ||
            value.trim() === "*";
          if (!broad) continue;
          report({
            file: server.file.rel,
            line: locate(server.file, server.name),
            subject: server.name,
            snippet: snippet(`${key}: ${value}`),
            message: m("Server \"{name}\" forwards the entire environment ({key}).", { name: server.name, key: key }),
          });
        }
        if (server.args.some((a) => /--(env|pass)-all|--inherit-env/.test(a))) {
          report({
            file: server.file.rel,
            line: locate(server.file, server.name),
            subject: server.name,
            snippet: snippet(server.args.join(" ")),
            message: m("Server \"{name}\" inherits the full environment via its arguments.", { name: server.name }),
          });
        }
      }
    },
  },
];
