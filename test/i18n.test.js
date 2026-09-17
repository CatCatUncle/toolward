import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { say, translate } from "../dist/i18n/index.js";
import { zh } from "../dist/i18n/zh.js";
import { allRules } from "../dist/rules/index.js";
import { driftRule } from "../dist/lock.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...sources(abs));
    else if (entry.endsWith(".ts")) out.push(abs);
  }
  return out;
}

const ESCAPES = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" };

/** Decode a TypeScript double-quoted string literal body. */
function unescapeLiteral(body) {
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, seq) => {
    if (seq.startsWith("u{")) return String.fromCodePoint(parseInt(seq.slice(2, -1), 16));
    if (seq[0] === "u" || seq[0] === "x") return String.fromCharCode(parseInt(seq.slice(1), 16));
    return ESCAPES[seq] ?? seq;
  });
}

const placeholders = (text) => [...text.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map((hit) => hit[1]);

test("source files outside src/i18n contain no non-English text", () => {
  const offenders = sources(join(root, "src"))
    .filter((file) => !file.includes(`${join("src", "i18n")}`))
    .filter((file) => /[一-鿿぀-ヿ가-힯]/.test(readFileSync(file, "utf8")))
    .map((file) => file.slice(root.length + 1));
  assert.deepEqual(offenders, []);
});

test("every translated string keeps the placeholders of its English original", () => {
  for (const [english, translated] of Object.entries(zh)) {
    assert.deepEqual(
      placeholders(translated).sort(),
      placeholders(english).sort(),
      `placeholders differ for: ${english}`,
    );
  }
});

test("every rule's prose is translated", () => {
  for (const rule of [...allRules, driftRule]) {
    assert.ok(zh[rule.title], `no translation for title of ${rule.id}: ${rule.title}`);
    assert.ok(zh[rule.description], `no translation for description of ${rule.id}`);
    assert.ok(zh[rule.remediation.template], `no translation for remediation of ${rule.id}`);
  }
});

test("every message template in the rules has a translation", () => {
  const missing = [];
  for (const file of sources(join(root, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const hit of text.matchAll(/\bm\("((?:[^"\\]|\\.)*)"/g)) {
      // TypeScript string literals may escape characters JSON does not know (e.g. \`).
      const template = unescapeLiteral(hit[1]);
      if (!zh[template]) missing.push(`${file.slice(root.length + 1)}: ${template}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("an unknown string falls back to English instead of breaking", () => {
  assert.equal(translate("zh", "not in the catalogue"), "not in the catalogue");
  assert.equal(translate("en", "Findings"), "Findings");
});

test("parameters are interpolated in both languages", () => {
  const message = { template: "{count} tools", params: { count: 3 } };
  assert.equal(say("en", message), "3 tools");
  assert.equal(say("zh", message), "3 个工具");
});

test("string parameters are themselves translated", () => {
  const message = {
    template: 'The {origin} "{subject}" contains instruction-override wording.',
    params: { origin: "tool description", subject: "get_invoice" },
  };
  assert.match(say("zh", message), /工具描述/);
  assert.match(say("zh", message), /get_invoice/);
});
