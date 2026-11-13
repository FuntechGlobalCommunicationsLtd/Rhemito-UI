/**
 * Evaluates affiliate/programme feature flags (`enabled`, `kinds`, `bonusBlocked`, `unavailable`)
 * returned by `GET Account/Rewards`.
 */

import { apiData, apiField } from "@/utils/apiResult";

export type RewardKindKey = "REFERRAL" | "PROMO" | "BONUS_SCHEME";

export interface RewardsGateState {
  enabled: boolean;
  referral: boolean;
  promo: boolean;
  bonusScheme: boolean;
  bonusBlocked: boolean;
  unavailable: boolean;
  unavailableMessage: string;
}

/**
 * Case-insensitive boolean reader supporting `true/false`, `1/0`, and `"true"/"false"/"yes"/"no"`.
 */
export function flagOn(source: any, name: string, fallback = false): boolean {
  const value = apiField(source, name);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const norm = value.trim().toLowerCase();
    if (norm === "true" || norm === "1" || norm === "yes" || norm === "on") return true;
    if (norm === "false" || norm === "0" || norm === "no" || norm === "off") return false;
  }
  return fallback;
}

export function normaliseRewardKindKey(raw: unknown): string {
  const norm = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (
    norm === "BONUS" ||
    norm === "BONUSSCHEME" ||
    norm === "SCHEME" ||
    norm === "BONUS_SCHEMES"
  ) {
    return "BONUS_SCHEME";
  }
  if (
    norm === "PROMOCODE" ||
    norm === "PROMO_CODE" ||
    norm === "PROMOS" ||
    norm === "PROMO_CODES"
  ) {
    return "PROMO";
  }
  if (norm === "REFERRALS" || norm === "REFER_AND_EARN") {
    return "REFERRAL";
  }
  return norm;
}

/**
 * Evaluates the top-level `enabled` flag and per-kind catalogue flags (`referral`, `promo`, `bonusScheme`)
 * from an `Account/Rewards` response (either wrapped or unwrapped).
 * Supports `kinds` as an object array (`[{ kind, enabled }]`), a string array (`["REFERRAL", "BONUS", "PROMO"]`
 * where presence means enabled and `"BONUS"` maps to `"BONUS_SCHEME"`), or an object map.
 */
export function evaluateRewardsGate(bodyOrData: any): RewardsGateState {
  const data = apiData(bodyOrData) || bodyOrData;
  if (!data || typeof data !== "object") {
    return {
      enabled: true,
      referral: true,
      promo: true,
      bonusScheme: true,
      bonusBlocked: false,
      unavailable: false,
      unavailableMessage: "",
    };
  }

  const masterEnabled = flagOn(data, "enabled", true);
  const bonusBlocked = flagOn(data, "bonusBlocked", false);
  const unavailable = flagOn(data, "unavailable", false);
  const unavailableMessage = String(apiField(data, "unavailableMessage") || "").trim();

  let referral = masterEnabled;
  let promo = masterEnabled;
  let bonusScheme = masterEnabled;

  const kinds = apiField<any>(data, "kinds");
  if (Array.isArray(kinds) && kinds.length > 0) {
    const findKind = (target: RewardKindKey): boolean => {
      const match = kinds.find((row: any) => {
        if (typeof row === "string") {
          return normaliseRewardKindKey(row) === target;
        }
        return normaliseRewardKindKey(apiField(row, "kind")) === target;
      });
      if (match === undefined) return false;
      if (typeof match === "string") return masterEnabled;
      return masterEnabled && flagOn(match, "enabled", true);
    };
    referral = findKind("REFERRAL");
    promo = findKind("PROMO");
    bonusScheme = findKind("BONUS_SCHEME");
  } else if (kinds && typeof kinds === "object" && !Array.isArray(kinds)) {
    // Supports object-shaped `{ referral: boolean, promo: boolean, bonusScheme: boolean }`
    referral = masterEnabled && flagOn(kinds, "referral", true);
    promo = masterEnabled && flagOn(kinds, "promo", true);
    const hasBonusSchemeKey = apiField(kinds, "bonusScheme") !== undefined;
    bonusScheme =
      masterEnabled &&
      (hasBonusSchemeKey
        ? flagOn(kinds, "bonusScheme", true)
        : flagOn(kinds, "bonus", true));
  }

  return {
    enabled: masterEnabled && (referral || promo || bonusScheme),
    referral,
    promo,
    bonusScheme,
    bonusBlocked,
    unavailable,
    unavailableMessage,
  };
}

export function isRewardKindEnabled(bodyOrData: any, kind: RewardKindKey): boolean {
  const gate = evaluateRewardsGate(bodyOrData);
  if (kind === "REFERRAL") return gate.referral;
  if (kind === "PROMO") return gate.promo;
  return gate.bonusScheme;
}

/**
 * Checks whether the Rewards UI surface is enabled (honouring both optional
 * `NEXT_PUBLIC_REWARDS_UI_ENABLED` / `NEXT_PUBLIC_ENABLE_REWARDS` env kill-switches
 * and, when provided, the `GET Account/Rewards` programme gate).
 */
export function isRewardsUiEnabled(bodyOrData?: any): boolean {
  if (typeof process !== "undefined" && process.env) {
    const rawEnv =
      process.env.NEXT_PUBLIC_REWARDS_UI_ENABLED ??
      process.env.NEXT_PUBLIC_ENABLE_REWARDS;
    if (typeof rawEnv === "string" && rawEnv.trim() !== "") {
      const norm = rawEnv.trim().toLowerCase();
      if (norm === "false" || norm === "0" || norm === "no" || norm === "off") {
        return false;
      }
    }
  }
  if (bodyOrData === undefined || bodyOrData === null) {
    return true;
  }
  const gate = evaluateRewardsGate(bodyOrData);
  return gate.enabled && !gate.unavailable;
}
