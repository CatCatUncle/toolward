import type { Rule } from "../core/types.js";
import { executionRules } from "./execution.js";
import { governanceRules } from "./governance.js";
import { injectionRules } from "./injection.js";
import { networkRules } from "./network.js";
import { secretRules } from "./secrets.js";
import { supplyChainRules } from "./supplychain.js";

/** Rules that run during `toolward scan`. */
export const allRules: Rule[] = [
  ...injectionRules,
  ...supplyChainRules,
  ...secretRules,
  ...executionRules,
  ...networkRules,
  ...governanceRules,
];

export const ruleById = new Map(allRules.map((rule) => [rule.id, rule]));

export {
  executionRules,
  governanceRules,
  injectionRules,
  networkRules,
  secretRules,
  supplyChainRules,
};
