import { m, matches, snippet, visualise } from "../core/text.js";
import type { PromptChunk, Rule, Severity } from "../core/types.js";
import { isToolSurface, locate, originLabel, stepDown } from "./helpers.js";

const REF_TOOL_POISONING = "https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks";
const REF_TROJAN_SOURCE = "https://trojansource.codes/";
const REF_OWASP_LLM01 = "https://genai.owasp.org/llmrisk/llm01-prompt-injection/";

/** Severity for a hit, scaled by how directly the text reaches the model as authority. */
function scaled(origin: PromptChunk["origin"], base: Severity): Severity {
  if (isToolSurface(origin)) return base;
  if (origin === "server-name") return base;
  return stepDown(base);
}

const OVERRIDE_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier|preceding|system)\s+(instruction|prompt|rule|message|direction)s?\b/i,
  /\byou\s+are\s+now\s+(in\s+)?(developer|dev|god|admin|root|sudo|unrestricted|jailbreak)\s*mode\b/i,
  /\b(new|updated|revised)\s+(system\s+)?(instructions?|prompt)\s*:/i,
  /\bthis\s+(instruction|rule|directive)\s+(overrides|supersedes|takes\s+precedence\s+over)\b/i,
  /\bdo\s+not\s+follow\s+(the\s+)?(previous|earlier|system|user)\s+(instructions?|rules?)\b/i,
];

const SECRECY_PATTERNS: RegExp[] = [
  /\b(do\s+not|don'?t|never|avoid)\s+(tell|telling|inform|informing|mention|mentioning|reveal|revealing|show|showing|display|displaying|disclose|disclosing)\s+(this\s+|it\s+|that\s+)?(to\s+)?(the\s+)?(user|human|operator)\b/i,
  /\bwithout\s+(asking|informing|notifying|telling|alerting|confirming\s+with)\s+(the\s+)?(user|human|operator)\b/i,
  /\b(hide|conceal|suppress)\s+(this|the\s+\w{1,20})\s+from\s+(the\s+)?(user|human|output|logs?)\b/i,
  /\bdo\s+not\s+(log|record|report)\b[^.\n]{0,40}\b(this|the\s+call|the\s+request)\b/i,
  /\bthe\s+user\s+(will\s+not|won'?t|does\s+not|doesn'?t)\s+(see|notice|be\s+shown)\b/i,
];

const EXFIL_PATTERNS: RegExp[] = [
  /\b(read|open|cat|load|include|attach|fetch)\b[^.\n]{0,60}(~\/\.ssh|id_rsa|id_ed25519|\.aws\/credentials|\.env\b|\.git-credentials|\.npmrc|keychain|kubeconfig|passwd\b)/i,
  // A verb and a destination are not enough: "send the report to security@example.com"
  // is ordinary English. Exfiltration needs either a sensitive OBJECT or a hostile SINK.
  // Object is sensitive, destination is anywhere off-box:
  /\b(send|post|upload|forward|transmit|relay|exfiltrat\w+|leak)\b[^.\n]{0,40}\b(contents?|outputs?|results?|files?|env|environment|api[_\s-]?keys?|tokens?|secrets?|credentials?|passwords?|conversation|chat\s+history|clipboard)\b[^.\n]{0,60}\b(to|at|via)\b[^.\n]{0,50}(https?:\/\/|webhook|endpoint|telegram|discord|[\w.+-]+@[\w-]+\.[a-z]{2,})/i,
  // Destination is a drop host, whatever the object is:
  /\b(send|post|upload|forward|transmit|relay|exfiltrat\w+|report\s+back)\b[^.\n]{0,70}\b(to|at|via)\b[^.\n]{0,50}(webhook|requestbin|pipedream|ngrok|pastebin|hastebin|telegram|discord|bot\s*token|c2\b)/i,
  /\b(pass|include|append|put|embed)\b[^.\n]{0,50}\b(content|contents|file|key|token|secret|credential)s?\b[^.\n]{0,50}\bas\s+(the\s+)?(a\s+)?(parameter|argument|field|value|query)/i,
  /\bconcatenat\w+\b[^.\n]{0,50}\b(api[_\s-]?key|token|secret|password)\b/i,
];

const SHADOW_PATTERNS: RegExp[] = [
  /\bbefore\s+(using|calling|invoking|running)\s+(any\s+)?(other\s+)?tools?\b/i,
  /\bwhen(ever)?\s+(the\s+)?(user\s+)?(asks|requests|calls|invokes)[^.\n]{0,50}\b(always\s+)?(call|use|invoke)\s+this\s+tool\b/i,
  /\balways\s+(call|use|invoke|run)\s+this\s+(tool|function|skill)\s+(first|before|instead)\b/i,
  /\b(instead\s+of|rather\s+than)\s+(using|calling)\s+[`"']?\w{2,40}[`"']?\s*,?\s*(use|call)\s+this\b/i,
  /\bdo\s+not\s+use\s+(the\s+)?[`"']?\w{2,40}[`"']?\s+tool\b/i,
];

const FAKE_AUTHORITY_PATTERNS: RegExp[] = [
  /<\s*\/?\s*(IMPORTANT|SYSTEM|SYSTEM_PROMPT|INSTRUCTIONS?|ADMIN|OVERRIDE|SECRET|CRITICAL)\s*>/i,
  /\[\s*(SYSTEM|ADMIN|OVERRIDE|IMPORTANT)\s*(MESSAGE|PROMPT|NOTE)?\s*\]/i,
  /#{2,}\s*(SYSTEM|ADMIN|OVERRIDE)\s*(INSTRUCTIONS?|PROMPT)\s*#{2,}/i,
  /\bsidenote\s*:/i,
];

const INVISIBLE_RE =
  /[​-‏⁠-⁤﻿­᠎]|[\u{e0000}-\u{e007f}]/u;
const BIDI_RE = /[‪-‮⁦-⁩]/;

function scanPatterns(
  chunk: PromptChunk,
  patterns: RegExp[],
): Array<{ text: string; line: number | undefined }> {
  const hits: Array<{ text: string; line: number | undefined }> = [];
  for (const pattern of patterns) {
    for (const { match } of matches(chunk.text, pattern, 3)) {
      const start = Math.max(0, match.index - 40);
      const context = chunk.text.slice(start, match.index + match[0].length + 60);
      hits.push({ text: context, line: locate(chunk.file, match[0], chunk.subject) });
      break; // one hit per pattern is enough to make the point
    }
  }
  return hits;
}

export const injectionRules: Rule[] = [
  {
    id: "TW101",
    category: "injection",
    severity: "high",
    title: "Instruction-override text in agent-visible content",
    description: "Text that tries to overrule the host's system prompt was found in content the agent ingests as authority.",
    remediation: m("Remove the override wording. Tool descriptions and skills should describe capability, never redefine the agent's rules."),
    references: [REF_OWASP_LLM01, REF_TOOL_POISONING],
    run({ ctx, report }) {
      for (const chunk of ctx.prompts) {
        for (const hit of scanPatterns(chunk, OVERRIDE_PATTERNS)) {
          report({
            file: chunk.file.rel,
            line: hit.line,
            subject: chunk.subject,
            snippet: snippet(hit.text),
            severity: scaled(chunk.origin, "high"),
            message: m("The {origin} \"{subject}\" contains instruction-override wording.", { origin: originLabel(chunk.origin), subject: chunk.subject }),
          });
        }
      }
    },
  },
  {
    id: "TW102",
    category: "injection",
    severity: "high",
    title: "Invisible Unicode characters",
    description: "Zero-width, soft-hyphen or Unicode tag characters can carry instructions that a human reviewer literally cannot see.",
    remediation: m("Strip the characters and re-review the plain text. Legitimate tool descriptions never need them."),
    references: [REF_TOOL_POISONING],
    run({ ctx, report }) {
      for (const chunk of ctx.prompts) {
        const found = INVISIBLE_RE.exec(chunk.text);
        if (!found) continue;
        const count = (chunk.text.match(new RegExp(INVISIBLE_RE.source, "gu")) ?? []).length;
        const start = Math.max(0, found.index - 50);
        report({
          file: chunk.file.rel,
          line: locate(chunk.file, chunk.text.slice(found.index - 10, found.index + 10), chunk.subject),
          subject: chunk.subject,
          snippet: snippet(visualise(chunk.text.slice(start, found.index + 60))),
          severity: scaled(chunk.origin, "high"),
          message: m("{count} invisible character(s) found in the {origin} \"{subject}\".", { count: count, origin: originLabel(chunk.origin), subject: chunk.subject }),
        });
      }
    },
  },
  {
    id: "TW103",
    category: "injection",
    severity: "critical",
    title: "Bidirectional control characters (Trojan Source)",
    description: "Bidi overrides make rendered text differ from the bytes the machine reads, so a reviewed description is not the executed one.",
    remediation: m("Remove all U+202A-U+202E and U+2066-U+2069 characters and re-read the file."),
    references: [REF_TROJAN_SOURCE],
    run({ ctx, report }) {
      for (const file of ctx.files) {
        const found = BIDI_RE.exec(file.text);
        if (!found) continue;
        const start = Math.max(0, found.index - 50);
        report({
          file: file.rel,
          line: file.text.slice(0, found.index).split("\n").length,
          snippet: snippet(visualise(file.text.slice(start, found.index + 60))),
          message: m("File contains bidirectional control characters at offset {index}.", { index: found.index }),
        });
      }
    },
  },
  {
    id: "TW104",
    category: "injection",
    severity: "high",
    title: "Mixed-script name (homoglyph risk)",
    description: "A tool or server name mixing Latin with Cyrillic/Greek letters can impersonate a trusted name character-for-character.",
    remediation: m("Rename using ASCII only, and confirm you installed the package you meant to install."),
    run({ ctx, report }) {
      const check = (name: string, file: string, kind: string): void => {
        const hasLatin = /[A-Za-z]/.test(name);
        const hasCyrillic = /[Ѐ-ӿ]/.test(name);
        const hasGreek = /[Ͱ-Ͽ]/.test(name);
        if (!hasLatin || (!hasCyrillic && !hasGreek)) return;
        report({
          file,
          subject: name,
          snippet: snippet(name),
          message: m("The {kind} \"{name}\" mixes Latin with {script} characters.", { kind: kind, name: name, script: hasCyrillic ? "Cyrillic" : "Greek" }),
        });
      };
      for (const server of ctx.servers) check(server.name, server.file.rel, "MCP server");
      for (const tool of ctx.tools) check(tool.name, tool.file.rel, "tool");
      for (const skill of ctx.skills) check(skill.name, skill.file.rel, "skill");
    },
  },
  {
    id: "TW105",
    category: "injection",
    severity: "medium",
    title: "Instructions hidden in comments or invisible markup",
    description: "HTML comments and zero-size or same-colour markup are invisible when rendered but fully visible to the model.",
    remediation: m("Delete the hidden block. If the text is genuinely needed, put it in plain visible prose."),
    references: [REF_OWASP_LLM01],
    run({ ctx, report }) {
      const imperative =
        /\b(you\s+must|you\s+should|always|never|ignore|execute|run|call\s+the|send\s+the|do\s+not\s+tell|instead\s+of)\b/i;
      for (const chunk of ctx.prompts) {
        for (const { match, line } of matches(chunk.text, /<!--([\s\S]{0,1500}?)-->/g, 8)) {
          const body = match[1] ?? "";
          if (!imperative.test(body)) continue;
          report({
            file: chunk.file.rel,
            line: locate(chunk.file, match[0].slice(0, 60)) ?? line,
            subject: chunk.subject,
            snippet: snippet(body),
            severity: scaled(chunk.origin, "medium"),
            message: m("An HTML comment in \"{subject}\" contains imperative instructions aimed at the model.", { subject: chunk.subject }),
          });
        }
        for (const { match, line } of matches(
          chunk.text,
          /(font-size\s*:\s*0|color\s*:\s*#?(fff(fff)?|white)\s*;?[^>]{0,40}background|display\s*:\s*none|opacity\s*:\s*0)/gi,
          4,
        )) {
          report({
            file: chunk.file.rel,
            line,
            subject: chunk.subject,
            snippet: snippet(match[0]),
            severity: scaled(chunk.origin, "medium"),
            message: m("\"{subject}\" hides text from human readers with CSS while leaving it in the model's context.", { subject: chunk.subject }),
          });
        }
      }
    },
  },
  {
    id: "TW106",
    category: "injection",
    severity: "critical",
    title: "Exfiltration instruction in agent-visible content",
    description: "The text instructs the agent to read local secrets or forward data to a third party — the core of a tool-poisoning attack.",
    remediation: m("Do not install this extension. If it is yours, remove the instruction and move any real data flow behind an explicit, documented parameter."),
    references: [REF_TOOL_POISONING, REF_OWASP_LLM01],
    run({ ctx, report }) {
      for (const chunk of ctx.prompts) {
        for (const hit of scanPatterns(chunk, EXFIL_PATTERNS)) {
          report({
            file: chunk.file.rel,
            line: hit.line,
            subject: chunk.subject,
            snippet: snippet(hit.text),
            severity: scaled(chunk.origin, "critical"),
            message: m("The {origin} \"{subject}\" instructs the agent to read or forward sensitive data.", { origin: originLabel(chunk.origin), subject: chunk.subject }),
          });
        }
      }
    },
  },
  {
    id: "TW107",
    category: "injection",
    severity: "high",
    title: "Cross-tool shadowing instruction",
    description: "The text tries to change how the agent uses other tools, letting one extension hijack calls meant for another.",
    remediation: m("A tool description must only describe its own behaviour. Remove references to other tools' invocation order."),
    references: [REF_TOOL_POISONING],
    run({ ctx, report }) {
      for (const chunk of ctx.prompts) {
        if (chunk.origin === "markdown") continue;
        for (const hit of scanPatterns(chunk, SHADOW_PATTERNS)) {
          report({
            file: chunk.file.rel,
            line: hit.line,
            subject: chunk.subject,
            snippet: snippet(hit.text),
            message: m("The {origin} \"{subject}\" tries to control when other tools are used.", { origin: originLabel(chunk.origin), subject: chunk.subject }),
          });
        }
      }
    },
  },
  {
    id: "TW108",
    category: "injection",
    severity: "high",
    title: "Instruction to conceal behaviour from the user",
    description: "Extensions that ask the agent to act silently defeat the human-in-the-loop that every agent host relies on.",
    remediation: m("Remove the secrecy wording. Anything worth doing silently is worth a confirmation prompt."),
    references: [REF_TOOL_POISONING],
    run({ ctx, report }) {
      for (const chunk of ctx.prompts) {
        for (const hit of scanPatterns(chunk, SECRECY_PATTERNS)) {
          report({
            file: chunk.file.rel,
            line: hit.line,
            subject: chunk.subject,
            snippet: snippet(hit.text),
            severity: scaled(chunk.origin, "high"),
            message: m("The {origin} \"{subject}\" tells the agent to hide something from the user.", { origin: originLabel(chunk.origin), subject: chunk.subject }),
          });
        }
      }
    },
  },
  {
    id: "TW109",
    category: "injection",
    severity: "high",
    title: "Fake system/authority markers",
    description: "Tags such as <IMPORTANT> or [SYSTEM] impersonate the host's own prompt structure to borrow its authority.",
    remediation: m("Remove pseudo-system tags from descriptions and skill bodies."),
    references: [REF_TOOL_POISONING],
    run({ ctx, report }) {
      for (const chunk of ctx.prompts) {
        if (chunk.origin === "markdown") continue;
        for (const hit of scanPatterns(chunk, FAKE_AUTHORITY_PATTERNS)) {
          report({
            file: chunk.file.rel,
            line: hit.line,
            subject: chunk.subject,
            snippet: snippet(hit.text),
            message: m("The {origin} \"{subject}\" uses a pseudo-system marker to claim authority.", { origin: originLabel(chunk.origin), subject: chunk.subject }),
          });
        }
      }
    },
  },
  {
    id: "TW110",
    category: "injection",
    severity: "low",
    title: "Oversized tool description",
    description: "Very long descriptions are both a context-budget tax and a convenient place to bury an instruction.",
    remediation: m("Keep tool descriptions under ~1000 characters and move detail into documentation."),
    run({ ctx, report }) {
      for (const tool of ctx.tools) {
        if (tool.description.length <= 2000) continue;
        report({
          file: tool.file.rel,
          line: locate(tool.file, tool.name),
          subject: tool.name,
          snippet: snippet(tool.description, 100),
          message: m("Tool \"{name}\" has a {description}-character description.", { name: tool.name, description: tool.description.length }),
        });
      }
    },
  },
];
