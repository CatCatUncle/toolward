import type { Lang, Message } from "../core/types.js";
import { zh } from "./zh.js";

/**
 * Translation lookup.
 *
 * Every user-facing string in Toolward is written in English at its call site.
 * A catalogue maps that English source string to a translation; anything the
 * catalogue does not cover falls back to the English original, so adding a
 * language can never break a report.
 */
const CATALOGUES: Record<string, Record<string, string>> = { zh };

const PLACEHOLDER = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export function translate(
  lang: Lang,
  template: string,
  params?: Record<string, string | number>,
): string {
  const catalogue = CATALOGUES[lang];
  const resolved = catalogue?.[template] ?? template;
  if (!params) return resolved;
  return resolved.replace(PLACEHOLDER, (whole, key: string) => {
    const value = params[key];
    if (value === undefined) return whole;
    // String parameters are themselves translatable (e.g. "tool description").
    return typeof value === "string" ? catalogue?.[value] ?? value : String(value);
  });
}

export function say(lang: Lang, message: Message): string {
  return translate(lang, message.template, message.params);
}

/** The languages that have a catalogue; English is always available. */
export function locales(): string[] {
  return ["en", ...Object.keys(CATALOGUES)];
}

export { zh, helpZh } from "./zh.js";
