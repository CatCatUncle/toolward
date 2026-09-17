import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { scan } from "../dist/scan.js";
import { allRules } from "../dist/rules/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vulnerable = scan({ targets: [join(root, "examples/vulnerable")] }).result;
const safeScan = scan({ targets: [join(root, "examples/safe")] });
const safe = safeScan.result;
const ids = new Set(vulnerable.findings.map((finding) => finding.ruleId));

test("every rule id is unique and well formed", () => {
  const seen = new Set();
  for (const rule of allRules) {
    assert.match(rule.id, /^TW[1-6]\d\d$/, `${rule.id} is not a TWnnn id`);
    assert.equal(seen.has(rule.id), false, `${rule.id} is declared twice`);
    seen.add(rule.id);
    assert.ok(rule.title.length > 0 && rule.description.length > 0, `${rule.id} has no prose`);
    assert.ok(rule.remediation.template.length > 0, `${rule.id} has no remediation`);
  }
});

test("the vulnerable example trips one rule from every category", () => {
  const categories = new Set(vulnerable.findings.map((finding) => finding.category));
  for (const category of ["injection", "supply-chain", "secrets", "execution", "network", "governance"]) {
    assert.ok(categories.has(category), `no ${category} finding`);
  }
});

const expected = [
  "TW101", // instruction override in a tool description
  "TW106", // exfiltration instruction
  "TW107", // cross-tool shadowing
  "TW108", // secrecy instruction
  "TW109", // fake <IMPORTANT> authority marker
  "TW201", // unpinned npx package
  "TW203", // curl | sh
  "TW205", // plaintext http remote server
  "TW301", // credential in an agent config
  "TW402", // permission bypass flag
  "TW403", // blanket auto-approval
  "TW404", // broad hook matcher
  "TW406", // filesystem scope of /
  "TW501", // egress to a data-drop host
  "TW502", // hard-coded IP address
  "TW606", // no lock file
];

for (const id of expected) {
  test(`${id} fires on the vulnerable example`, () => {
    assert.ok(ids.has(id), `${id} did not fire`);
  });
}

test("the vulnerable example fails the grade", () => {
  assert.equal(vulnerable.grade, "F");
  assert.ok(vulnerable.counts.critical > 0);
});

// The safe fixture is the regression test for noise, which only works if its
// benign-looking prose is actually read. An ignore pattern once hid its README
// and the guard below silently stopped guarding anything.
test("the safe example's benign prose is actually scanned", () => {
  const subjects = safeScan.ctx.prompts
    .filter((chunk) => chunk.origin === "markdown")
    .map((chunk) => chunk.subject);
  assert.ok(subjects.includes("README.md"), `markdown chunks: ${subjects.join(", ") || "none"}`);
  assert.match(safeScan.ctx.prompts.find((c) => c.subject === "README.md").text, /security@example\.com/);
});

test("the safe example produces nothing above info", () => {
  const noisy = safe.findings.filter((finding) => finding.severity !== "info");
  assert.deepEqual(
    noisy.map((finding) => `${finding.ruleId} ${finding.file}`),
    [],
  );
  assert.equal(safe.grade, "A");
});

test("every finding carries a location and a stable fingerprint", () => {
  const seen = new Set();
  for (const finding of vulnerable.findings) {
    assert.ok(finding.file, `${finding.ruleId} has no file`);
    assert.match(finding.fingerprint, /^[0-9a-f]{16}$/);
    assert.equal(seen.has(finding.fingerprint), false, "duplicate fingerprint");
    seen.add(finding.fingerprint);
  }
});

test("scanning twice gives identical fingerprints", () => {
  const again = scan({ targets: [join(root, "examples/vulnerable")] }).result;
  assert.deepEqual(
    again.findings.map((finding) => finding.fingerprint),
    vulnerable.findings.map((finding) => finding.fingerprint),
  );
});

test("--only narrows the run to the rules asked for", () => {
  const onlyInjection = scan({ targets: [join(root, "examples/vulnerable")], only: ["TW101"] }).result;
  assert.deepEqual([...new Set(onlyInjection.findings.map((f) => f.ruleId))], ["TW101"]);
});

test("min-severity filters low-signal findings out", () => {
  const criticalOnly = scan({
    targets: [join(root, "examples/vulnerable")],
    minSeverity: "critical",
  }).result;
  assert.ok(criticalOnly.findings.length > 0);
  assert.ok(criticalOnly.findings.every((finding) => finding.severity === "critical"));
});
