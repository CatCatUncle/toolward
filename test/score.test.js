import { strict as assert } from "node:assert";
import { test } from "node:test";
import { atOrAbove, countBySeverity, gradeOf, scoreOf, sortFindings } from "../dist/core/score.js";

const finding = (severity, ruleId = "TW101", file = "a.json") => ({
  ruleId,
  severity,
  category: "injection",
  title: "t",
  message: { template: "m" },
  remediation: { template: "r" },
  file,
  references: [],
  fingerprint: `${ruleId}${severity}${file}`,
});

test("countBySeverity tallies each level", () => {
  const counts = countBySeverity([finding("critical"), finding("low", "TW201"), finding("low", "TW202")]);
  assert.equal(counts.critical, 1);
  assert.equal(counts.low, 2);
  assert.equal(counts.info, 0);
});

test("a clean scan scores 100 and grades A", () => {
  assert.equal(scoreOf([]), 100);
  assert.equal(gradeOf(100), "A");
});

test("one critical finding is enough to fail the grade", () => {
  const score = scoreOf([finding("critical")]);
  assert.equal(score, 60);
  assert.equal(gradeOf(score), "D");
});

test("the score floors at zero instead of going negative", () => {
  const many = Array.from({ length: 20 }, (_, i) => finding("critical", "TW101", `f${i}.json`));
  assert.equal(scoreOf(many), 0);
  assert.equal(gradeOf(0), "F");
});

test("info findings never move the score", () => {
  assert.equal(scoreOf([finding("info")]), 100);
});

test("atOrAbove compares severities by rank, not alphabetically", () => {
  assert.ok(atOrAbove("critical", "high"));
  assert.ok(atOrAbove("high", "high"));
  assert.equal(atOrAbove("low", "high"), false);
});

test("findings sort most severe first", () => {
  const sorted = sortFindings([finding("low"), finding("critical"), finding("medium")]);
  assert.deepEqual(sorted.map((f) => f.severity), ["critical", "medium", "low"]);
});
