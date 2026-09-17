import { m, matches, snippet } from "../core/text.js";
import type { Rule, SourceFile } from "../core/types.js";
import { hostOf, isLocalHost, locate } from "./helpers.js";

/**
 * Hosts whose entire purpose is to receive data you point at them. None of them
 * belong in an agent extension that is supposed to talk to a product API.
 */
const DROP_HOSTS = [
  "webhook.site",
  "requestbin.com",
  "pipedream.net",
  "requestcatcher.com",
  "beeceptor.com",
  "ngrok.io",
  "ngrok-free.app",
  "trycloudflare.com",
  "loca.lt",
  "serveo.net",
  "pastebin.com",
  "hastebin.com",
  "paste.ee",
  "termbin.com",
  "transfer.sh",
  "file.io",
  "0x0.st",
  "anonfiles.com",
  "gofile.io",
  "oast.fun",
  "oastify.com",
  "interact.sh",
  "burpcollaborator.net",
  "dnslog.cn",
  "api.telegram.org",
  "discord.com/api/webhooks",
  "discordapp.com/api/webhooks",
];

const URL_RE = /\bhttps?:\/\/[^\s"'`)\]<>]{4,200}/g;
const IP_URL_RE = /\bhttps?:\/\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?/g;

function isAllowed(host: string, allow: string[]): boolean {
  return allow.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

function isPrivateIp(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  const [a, b] = parts as [number, number];
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function scannable(file: SourceFile): boolean {
  return file.ext !== ".lock" && file.size < 400_000;
}

export const networkRules: Rule[] = [
  {
    id: "TW501",
    category: "network",
    severity: "critical",
    title: "Egress to a data-drop or tunnelling service",
    description: "These endpoints exist to collect whatever is sent to them, which makes them the default destination for stolen context.",
    remediation: m("Remove the endpoint. If you need a callback URL during development, keep it out of committed configuration."),
    run({ ctx, report }) {
      for (const file of ctx.files) {
        if (!scannable(file)) continue;
        for (const { match, line } of matches(file.text, URL_RE, 20)) {
          const url = match[0];
          const host = hostOf(url);
          if (!host) continue;
          if (isAllowed(host, ctx.config.allowHosts)) continue;
          const hit = DROP_HOSTS.find(
            (drop) => host === drop || host.endsWith(`.${drop}`) || url.includes(drop),
          );
          if (!hit) continue;
          report({
            file: file.rel,
            line,
            subject: file.base,
            snippet: snippet(url),
            message: m("{rel}:{line} points at {host}.", { rel: file.rel, line: line, host: hit }),
          });
        }
      }
    },
  },
  {
    id: "TW502",
    category: "network",
    severity: "medium",
    title: "Hard-coded IP endpoint",
    description: "A bare public IP has no certificate identity and no owner you can look up, so it cannot be reviewed like a domain.",
    remediation: m("Use a hostname with TLS, or document why the address is fixed."),
    run({ ctx, report }) {
      for (const file of ctx.files) {
        if (!scannable(file)) continue;
        for (const { match, line } of matches(file.text, IP_URL_RE, 10)) {
          const ip = match[1] ?? "";
          if (isPrivateIp(ip) || isLocalHost(ip)) continue;
          if (isAllowed(ip, ctx.config.allowHosts)) continue;
          report({
            file: file.rel,
            line,
            subject: file.base,
            snippet: snippet(match[0]),
            severity: /^https:/i.test(match[0]) ? "low" : "medium",
            message: m("{rel}:{line} connects to the hard-coded address {address}.", { rel: file.rel, line: line, address: match[0] }),
          });
        }
      }
    },
  },
  {
    id: "TW503",
    category: "network",
    severity: "high",
    title: "Obfuscated payload",
    description: "Long encoded blobs in an extension hide the very thing a reviewer needs to read.",
    remediation: m("Decode it and commit the plain source, or document exactly what the blob is and where it came from."),
    run({ ctx, report }) {
      const b64 = /\b[A-Za-z0-9+/]{160,}={0,2}\b/g;
      const hexBlob = /\b(?:\\x[0-9a-fA-F]{2}){40,}/g;
      const decodeExec =
        /(atob\s*\(|Buffer\.from\s*\([^)]{0,60}base64|base64\.b64decode\s*\(|codecs\.decode\s*\()/g;
      for (const file of ctx.files) {
        if (!scannable(file)) continue;
        if (file.ext === ".md" || file.ext === ".markdown") continue; // inline images are expected here
        for (const pattern of [b64, hexBlob]) {
          for (const { match, line } of matches(file.text, pattern, 3)) {
            const decodes = decodeExec.test(file.text);
            report({
              file: file.rel,
              line,
              subject: file.base,
              snippet: snippet(`${match[0].slice(0, 60)}… (${match[0].length} chars)`),
              severity: decodes ? "high" : "medium",
              message: decodes
                ? m("{rel}:{line} contains a {length}-character encoded blob and decodes base64 at runtime.", { rel: file.rel, line: line, length: match[0].length })
                : m("{rel}:{line} contains a {length}-character encoded blob.", { rel: file.rel, line: line, length: match[0].length }),
            });
          }
        }
      }
    },
  },
  {
    id: "TW504",
    category: "network",
    severity: "critical",
    title: "Remote content executed at runtime",
    description: "Fetching code and evaluating it means the audited version and the running version are never the same thing.",
    remediation: m("Ship the code in the package and verify it by checksum; never evaluate a network response."),
    run({ ctx, report }) {
      const fetchThenEval =
        /(fetch|axios|request|urlopen|requests\.get|http\.get)[\s\S]{0,300}?\b(eval|new\s+Function|exec)\s*\(/g;
      for (const file of ctx.files) {
        if (!scannable(file)) continue;
        if (![".js", ".mjs", ".cjs", ".ts", ".mts", ".py"].includes(file.ext)) continue;
        for (const { match, line } of matches(file.text, fetchThenEval, 3)) {
          report({
            file: file.rel,
            line,
            subject: file.base,
            snippet: snippet(match[0]),
            message: m("{rel}:{line} fetches remote content and evaluates it.", { rel: file.rel, line: line }),
          });
        }
      }
    },
  },
  {
    id: "TW505",
    category: "network",
    severity: "high",
    title: "Out-of-band exfiltration primitive",
    description: "Raw sockets, `/dev/tcp` and DNS-encoded lookups move data out of networks that block ordinary HTTP egress.",
    remediation: m("Remove it. Legitimate extensions talk to documented HTTPS APIs."),
    run({ ctx, report }) {
      const patterns = [
        /\/dev\/tcp\/[^\s"']+/g,
        /\b(?:nc|ncat|netcat)\s+(?:-[a-zA-Z]+\s+)*[\w.-]+\s+\d{2,5}\b/g,
        /\b(?:dig|nslookup|host)\s+[^\s|;]{0,80}\$\{?\w+\}?[^\s|;]{0,40}\.[a-z]{2,}\b/g,
        /\bsocket\.socket\s*\([\s\S]{0,80}SOCK_(?:STREAM|RAW)/g,
      ];
      for (const file of ctx.files) {
        if (!scannable(file)) continue;
        for (const pattern of patterns) {
          for (const { match, line } of matches(file.text, pattern, 3)) {
            report({
              file: file.rel,
              line,
              subject: file.base,
              snippet: snippet(match[0]),
              message: m("{rel}:{line} opens an out-of-band channel: {call}", { rel: file.rel, line: line, call: snippet(match[0], 60) }),
            });
          }
        }
      }
      for (const hook of ctx.hooks) {
        if (!/\/dev\/tcp\/|\bnc\s+-|\bncat\b/.test(hook.command)) continue;
        report({
          file: hook.file.rel,
          line: locate(hook.file, hook.command),
          subject: `${hook.event} hook`,
          snippet: snippet(hook.command),
          severity: "critical",
          message: m("The {event} hook opens an out-of-band channel.", { event: hook.event }),
        });
      }
    },
  },
];
