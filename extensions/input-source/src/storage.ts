/**
 * `jarvis.storage` 里的三样：规则、你在每个应用里手动用过的输入法、默认输入法。读出来的东西一律验形状：
 * 存储是扩展自己的，但它活得比任何一个版本都久——上一版写坏的一条不该让这一版起不来。
 */
import { jarvis } from "@fusionseek/jarvis-extension-sdk";
import type { Rule, Rules } from "./model.js";

export const storageKeys = {
  rules: "rules",
  lastUsed: "lastUsed",
  fallbackSource: "fallbackSource",
} as const;

function isRule(value: unknown): value is Rule {
  if (typeof value !== "object" || value === null) return false;
  const rule = value as Record<string, unknown>;
  if (typeof rule.name !== "string") return false;
  if (rule.mode === "fixed") return typeof rule.source === "string" && rule.source.length > 0;
  // 上一版的「不管它」（`ignore`）合进了「无规则」（jarvis-mac `specs/20261030-194903-input-source-cards-orb-flash` C-5）：读到就丢掉，等于没有规则。
  return rule.mode === "remember";
}

/**
 * 规则表；坏掉的条目、上一版的 `ignore` 丢掉。
 * @returns 规则。
 */
export async function readRules(): Promise<Rules> {
  const raw = await jarvis.storage.get<unknown>(storageKeys.rules).catch(() => null);
  const rules: Rules = {};
  if (typeof raw === "object" && raw !== null) {
    for (const [bundleId, rule] of Object.entries(raw as Record<string, unknown>)) if (isRule(rule)) rules[bundleId] = rule;
  }
  return rules;
}

/**
 * 每个应用上次手动用的输入法。
 * @returns bundle id → 输入法 id。
 */
export async function readLastUsed(): Promise<Record<string, string>> {
  const raw = await jarvis.storage.get<unknown>(storageKeys.lastUsed).catch(() => null);
  const lastUsed: Record<string, string> = {};
  if (typeof raw === "object" && raw !== null) {
    for (const [bundleId, source] of Object.entries(raw as Record<string, unknown>)) if (typeof source === "string" && source) lastUsed[bundleId] = source;
  }
  return lastUsed;
}

/**
 * 默认输入法。
 * @returns 输入法 id；没定过为 `undefined`。
 */
export async function readFallback(): Promise<string | undefined> {
  const raw = await jarvis.storage.get<unknown>(storageKeys.fallbackSource).catch(() => null);
  return typeof raw === "string" && raw ? raw : undefined;
}
