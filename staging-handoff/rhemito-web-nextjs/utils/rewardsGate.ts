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

function normaliseKindKey(raw: unknown): string {
  const norm = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (norm === "BONUSSCHEME" || norm === "SCHEME") return "BONUS_SCHEME";
  if (norm === "PROMOCODE" || norm === "PROMO_CODE") return "PROMO";
  return norm;
}

/**
 * Evaluates the top-level `enabled` flag and per-kind catalogue flags (`referral`, `promo`, `bonusScheme`)
 * from an `Account/Rewards` response (either wrapped or unwrapped).
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
      const match = kinds.find(
        (row: any) => normaliseKindKey(apiField(row, "kind")) === target,
      );
      return match ? masterEnabled && flagOn(match, "enabled", true) : false;
    };
    referral = findKind("REFERRAL");
    promo = findKind("PROMO");
    bonusScheme = findKind("BONUS_SCHEME");
  } else if (kinds && typeof kinds === "object" && !Array.isArray(kinds)) {
    // Supports object-shaped `{ referral: boolean, promo: boolean, bonusScheme: boolean }`
    referral = masterEnabled && flagOn(kinds, "referral", true);
    promo = masterEnabled && flagOn(kinds, "promo", true);
    bonusScheme = masterEnabled && flagOn(kinds, "bonusScheme", true);
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
