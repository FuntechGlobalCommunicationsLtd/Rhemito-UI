/**
 * Layer 1 FURP `/api/v1/` Frontend Contract Adapter (`furp02-core` ↔ `Rhemito-UI`).
 *
 * Maps between `furp02-core`'s `/api/v1/Account/Rewards*` `Result<T>` envelope
 * (`{ succeeded, code, message, data }` / `{ responseType, code, message, data }`)
 * and `Rhemito-UI`'s `RewardsSummary`, `ReferralCodeLookup`, and `PromoValidateResponse`
 * interfaces.
 *
 * Base URL resolution:
 *  - Explicit `options.baseUrl`
 *  - `import.meta.env.VITE_FURP_API_URL` (e.g. `https://furp02-staging.funtechcom.com/api/v1/`)
 *  - Same-origin `"/api/v1/"` (served by `Rhemito-UI`'s `/api/v1/Account/Rewards*` compatibility layer)
 */

import {
  APPLE_APP_STORE_URL,
  buildGooglePlayReferralUrl,
  referralCodeForCurrency,
  type MyReferral,
  type OfferAnnouncement,
  type RewardOffer,
  type RewardsSummary,
  type Wallet,
  type WalletBalance,
  type WalletCredit,
  type WalletHistoryEntry,
} from "@/lib/rewards";

export interface FurpResultEnvelope<T = unknown> {
  succeeded?: boolean;
  Succeeded?: boolean;
  responseType?: "Success" | "Error" | string;
  ResponseType?: "Success" | "Error" | string;
  code?: number | string;
  Code?: number | string;
  message?: string;
  Message?: string;
  errors?: string[] | Record<string, string[]>;
  Errors?: string[] | Record<string, string[]>;
  data?: T;
  Data?: T;
}

export class FurpApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly raw: unknown;

  constructor(message: string, status = 400, code = "FURP_API_ERROR", raw?: unknown) {
    super(message);
    this.name = "FurpApiError";
    this.status = status;
    this.code = code;
    this.raw = raw;
  }
}

export interface FurpRequestOptions {
  /** Base URL such as `https://furp02-staging.funtechcom.com/api/v1/` or `/api/v1/`. */
  baseUrl?: string;
  /** Optional Bearer JWT token for authenticated customer endpoints (`Account/Rewards`, `Link`, `Promo/Validate`). */
  token?: string | null;
  /** Optional tenant/application `ApiKey` header required by FURP `ApplicationPaymentModeByKeySpec`. */
  apiKey?: string | null;
  /** Optional `AbortSignal` for request cancellation. */
  signal?: AbortSignal;
  /** Fetch credentials policy (`"include"` by default for same-origin session compatibility). */
  credentials?: RequestCredentials;
  /** Extra request headers merged after standard headers. */
  headers?: Record<string, string>;
}

export interface ReferralCodeLookup {
  valid: boolean;
  code: string;
  referrerFirstName?: string;
  ruleId?: number;
  offer: RewardOffer | null;
  offers: RewardOffer[];
  sendCurrencies: string[];
  signedIn: boolean;
  message?: string;
}

export interface ReferralVisitInput {
  code: string;
  visitorId: string;
  receiveCurrency?: string;
  ruleId?: number;
  deviceType?: string;
  operatingSystem?: string;
  sourceChannel?: string;
  storeTarget?: string;
}

export interface ReferralVisitResponse {
  tracked: boolean;
  counted: boolean;
  trackingId: string | null;
  playStoreUrl: string | null;
  appStoreUrl: string | null;
  deviceType?: string | null;
  operatingSystem?: string | null;
  status?: string;
}

export interface ReferralLinkInput {
  code: string;
  trackingId?: string | null;
  visitorId?: string;
  receiveCurrency?: string;
  ruleId?: number | null;
  attributionMethod?: string;
}

export interface ReferralLinkResponse {
  linked: boolean;
  status: string;
  message: string;
}

export interface PromoValidateInput {
  code: string;
  amount: number;
  fee: number;
  currency: string;
  receiveCurrency?: string;
  paymentMethod?: string;
}

export interface PromoValidateResponse {
  valid: boolean;
  discount: number;
  appliedDiscount: number;
  appliesTo: "fee" | "amount";
  discountBasis: "VALUE" | "FEE" | "PAYABLE";
  customerChoice: boolean;
  displayText: string;
  currency: string;
  message?: string;
}

// ─── Internal Case-Insensitive Field Readers ─────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toSnakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function toCamelCase(name: string): string {
  return name.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

/** Reads a property from a C# PascalCase, camelCase, or snake_case object. */
export function pickFurpField(source: unknown, name: string): unknown {
  if (!isRecord(source)) return undefined;
  if (name in source && source[name] !== undefined) return source[name];
  const targets = new Set([
    name.toLowerCase(),
    toSnakeCase(name).toLowerCase(),
    toCamelCase(name).toLowerCase(),
  ]);
  for (const key of Object.keys(source)) {
    if (targets.has(key.toLowerCase()) && source[key] !== undefined) {
      return source[key];
    }
  }
  return undefined;
}

function strOf(source: unknown, name: string, fallback = ""): string {
  const val = pickFurpField(source, name);
  return val === null || val === undefined ? fallback : String(val).trim();
}

function numOf(source: unknown, name: string, fallback = 0): number {
  const val = pickFurpField(source, name);
  if (val === null || val === undefined || val === "") return fallback;
  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolOf(source: unknown, name: string, fallback = false): boolean {
  const val = pickFurpField(source, name);
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val !== 0;
  if (typeof val === "string") {
    const norm = val.trim().toLowerCase();
    if (norm === "true" || norm === "1" || norm === "yes") return true;
    if (norm === "false" || norm === "0" || norm === "no") return false;
  }
  return fallback;
}

function arrOf(source: unknown, name: string): Record<string, unknown>[] {
  const val = pickFurpField(source, name);
  return Array.isArray(val) ? (val.filter(isRecord) as Record<string, unknown>[]) : [];
}

// ─── Base URL, Headers & Envelope Unwrapping ─────────────────────────────────

/**
 * Resolves the FURP `/api/v1/` base URL with a guaranteed trailing slash.
 */
export function resolveFurpBaseUrl(override?: string): string {
  const envUrl =
    typeof import.meta !== "undefined" && import.meta.env
      ? (import.meta.env.VITE_FURP_API_URL as string | undefined)
      : undefined;
  const raw = (override || envUrl || "/api/v1/").trim();
  if (!raw) return "/api/v1/";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function readStoredAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const fromStorage =
      window.localStorage?.getItem("rhemito.furpToken") ||
      window.localStorage?.getItem("authToken") ||
      null;
    if (fromStorage) return fromStorage;
    const match = document.cookie.match(/(?:^|;\s*)(?:authToken|accessToken)=([^;]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Builds standard FURP v1 request headers (`Authorization: Bearer <jwt>`, `ApiKey`).
 */
export function buildFurpHeaders(options: FurpRequestOptions = {}): Record<string, string> {
  const envApiKey =
    typeof import.meta !== "undefined" && import.meta.env
      ? (import.meta.env.VITE_FURP_API_KEY as string | undefined)
      : undefined;
  const token = options.token !== undefined ? options.token : readStoredAuthToken();
  const apiKey = options.apiKey !== undefined ? options.apiKey : envApiKey || null;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  }
  if (apiKey) {
    headers.ApiKey = apiKey;
  }
  if (options.headers) {
    Object.assign(headers, options.headers);
  }
  return headers;
}

function extractErrorMessage(envelope: unknown, fallback: string): string {
  if (!isRecord(envelope)) return fallback;
  const direct = strOf(envelope, "message");
  if (direct && direct.toLowerCase() !== "error") return direct;
  const nestedErr = pickFurpField(envelope, "error");
  if (typeof nestedErr === "string" && nestedErr.trim()) return nestedErr.trim();
  if (isRecord(nestedErr)) {
    const nestedMsg = strOf(nestedErr, "message");
    if (nestedMsg) return nestedMsg;
  }
  const errors = pickFurpField(envelope, "errors");
  if (Array.isArray(errors) && errors.length > 0 && typeof errors[0] === "string") {
    return errors[0];
  }
  if (isRecord(errors)) {
    const firstKey = Object.keys(errors)[0];
    const firstVal = firstKey ? errors[firstKey] : undefined;
    if (Array.isArray(firstVal) && typeof firstVal[0] === "string") return firstVal[0];
  }
  return direct || fallback;
}

function classifyErrorCode(message: string, rawCode: unknown, httpStatus: number): string {
  if (typeof rawCode === "string" && rawCode.trim() && !/^\d+$/.test(rawCode.trim())) {
    return rawCode.trim().toUpperCase();
  }
  const lower = message.toLowerCase();
  if (lower.includes("no longer active") || lower.includes("referrer_inactive")) {
    return "REFERRER_INACTIVE";
  }
  if (lower.includes("sign in") || httpStatus === 401) {
    return "UNAUTHENTICATED";
  }
  if (lower.includes("unavailable") || httpStatus === 503) {
    return "REWARDS_UNAVAILABLE";
  }
  if (lower.includes("below_floor") || lower.includes("minimum transfer")) {
    return "BELOW_FLOOR";
  }
  return "FURP_API_ERROR";
}

/**
 * Unwraps a `furp02-core` `Result<T>` envelope (`{ succeeded, code, message, data }`)
 * or throws a typed `FurpApiError` when the envelope signals failure.
 */
export function unwrapFurpResult<T>(
  envelope: FurpResultEnvelope<T> | T,
  httpStatus = 200,
): T {
  if (!isRecord(envelope)) {
    if (httpStatus >= 400) {
      throw new FurpApiError("Request failed.", httpStatus, "FURP_API_ERROR", envelope);
    }
    return envelope as T;
  }

  const succeededVal = pickFurpField(envelope, "succeeded");
  const responseTypeVal = strOf(envelope, "responseType").toLowerCase();
  const envelopeCode = pickFurpField(envelope, "code");
  const numericCode = typeof envelopeCode === "number" ? envelopeCode : Number(envelopeCode);

  const explicitlyFailed =
    succeededVal === false ||
    responseTypeVal === "error" ||
    httpStatus >= 400 ||
    (Number.isFinite(numericCode) && numericCode >= 400);

  if (explicitlyFailed) {
    const message = extractErrorMessage(envelope, "Something went wrong. Please try again.");
    const status =
      httpStatus >= 400
        ? httpStatus
        : Number.isFinite(numericCode) && numericCode >= 400
          ? numericCode
          : 400;
    const errCode = classifyErrorCode(message, envelopeCode, status);
    throw new FurpApiError(message, status, errCode, envelope);
  }

  const data = pickFurpField(envelope, "data");
  if (data !== undefined) {
    return data as T;
  }
  return envelope as T;
}

async function requestFurp<T>(
  method: "GET" | "POST",
  relativePath: string,
  body?: Record<string, unknown>,
  options: FurpRequestOptions = {},
): Promise<T> {
  const baseUrl = resolveFurpBaseUrl(options.baseUrl);
  const cleanPath = relativePath.replace(/^\/+/, "");
  const isCrossOrigin = /^https?:\/\//i.test(baseUrl);
  const res = await fetch(`${baseUrl}${cleanPath}`, {
    method,
    headers: buildFurpHeaders(options),
    credentials: options.credentials ?? (isCrossOrigin ? "omit" : "include"),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const parsed = (await res.json().catch(() => ({}))) as FurpResultEnvelope<T>;
  return unwrapFurpResult<T>(parsed, res.status);
}

// ─── Domain Mappers (`furp02-core` DTOs → `Rhemito-UI` Interfaces) ───────────

function mapFurpOffer(
  raw: unknown,
  fallbackCurrency: string,
  fallbackReferralCode?: string,
): RewardOffer | null {
  if (!isRecord(raw)) return null;
  const currency = (strOf(raw, "currency") || fallbackCurrency || "GBP").toUpperCase();
  const refereeReward = numOf(raw, "refereeReward", numOf(raw, "referee_reward", 0));
  const referrerReward = numOf(raw, "referrerReward", numOf(raw, "referrer_reward", 0));
  const rawType = strOf(raw, "rewardType", strOf(raw, "reward_type", "")).toUpperCase();
  const rewardType: RewardOffer["reward_type"] =
    rawType === "REFERRER" || rawType === "REFEREE" || rawType === "BOTH"
      ? rawType
      : referrerReward > 0 && refereeReward > 0
        ? "BOTH"
        : refereeReward > 0
          ? "REFEREE"
          : "REFERRER";

  const code = (
    strOf(raw, "referralCode", strOf(raw, "referral_code")) ||
    fallbackReferralCode ||
    ""
  ).toUpperCase();

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const link =
    strOf(raw, "referralLink", strOf(raw, "referral_link")) ||
    (origin && code ? `${origin}/ref/${code}` : undefined);

  const receiveCur = strOf(raw, "receiveCurrency", strOf(raw, "receive_currency")).toUpperCase();

  return {
    rule_id: numOf(raw, "ruleId", numOf(raw, "rule_id", 1)),
    name: strOf(raw, "name") || undefined,
    currency,
    receive_currency: receiveCur || null,
    corridor: strOf(raw, "corridor") || (receiveCur ? `${currency}-${receiveCur}` : undefined),
    reward_type: rewardType,
    referrer_reward: referrerReward,
    referee_reward: refereeReward,
    floor: numOf(raw, "floor", numOf(raw, "minimumAmount", 0)),
    qualification_window_days: numOf(
      raw,
      "qualificationWindowDays",
      numOf(raw, "qualification_window_days", numOf(raw, "windowDays", 30)),
    ),
    bonus_validity_days: numOf(raw, "bonusValidityDays", numOf(raw, "bonus_validity_days", 90)),
    min_redeem_amount: numOf(raw, "minRedeemAmount", numOf(raw, "min_redeem_amount", 0)),
    text: strOf(raw, "text", strOf(raw, "offerText")),
    ...(code ? { referral_code: code } : {}),
    ...(link ? { referral_link: link } : {}),
    cap_reached: boolOf(raw, "capReached", boolOf(raw, "cap_reached", false)),
  };
}

function normaliseCreditSource(raw: string): "REFERRAL" | "SCHEME" | "MANUAL" | null {
  const upper = raw.trim().toUpperCase();
  if (upper === "REFERRAL" || upper === "SCHEME" || upper === "MANUAL") return upper;
  return null;
}

/**
 * Pure mapper converting `furp02-core`'s `RewardCatalogueDto` (`GET Account/Rewards`)
 * into `Rhemito-UI`'s `RewardsSummary` shape.
 */
export function mapFurpCatalogueToRewardsSummary(
  data: Record<string, unknown>,
  requestedCurrency?: string,
): RewardsSummary {
  const primaryCurrency = (
    requestedCurrency ||
    strOf(data, "balanceCurrency", strOf(data, "currency", "GBP"))
  )
    .trim()
    .toUpperCase();

  const referralCode = strOf(data, "referralCode").toUpperCase();
  const capReached = boolOf(data, "capReached", false);
  const offerText = strOf(data, "offerText");

  const rawOffersList = [
    ...arrOf(data, "currencyOffers"),
    ...arrOf(data, "offers"),
  ];
  const seenOfferKeys = new Set<string>();
  const offers: RewardOffer[] = [];

  for (const item of rawOffersList) {
    const mapped = mapFurpOffer(
      item,
      primaryCurrency,
      referralCode ? referralCodeForCurrency(referralCode, strOf(item, "currency") || primaryCurrency) : undefined,
    );
    if (mapped) {
      const key = `${mapped.rule_id}:${mapped.currency}`;
      if (!seenOfferKeys.has(key)) {
        seenOfferKeys.add(key);
        offers.push(mapped);
      }
    }
  }

  const directOfferObj = pickFurpField(data, "offer");
  let primaryOffer =
    (isRecord(directOfferObj)
      ? mapFurpOffer(directOfferObj, primaryCurrency, referralCode)
      : null) ??
    offers.find((o) => o.currency === primaryCurrency) ??
    null;

  if (!primaryOffer && (offerText || referralCode)) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    primaryOffer = {
      rule_id: 1,
      currency: primaryCurrency,
      receive_currency: null,
      reward_type: "BOTH",
      referrer_reward: 0,
      referee_reward: 0,
      floor: 0,
      qualification_window_days: 30,
      bonus_validity_days: 90,
      min_redeem_amount: 0,
      text: offerText,
      ...(referralCode ? { referral_code: referralCode } : {}),
      ...(origin && referralCode ? { referral_link: `${origin}/ref/${referralCode}` } : {}),
      cap_reached: capReached,
    };
    if (offers.length === 0) {
      offers.push(primaryOffer);
    }
  }

  // Map bySource rows
  const bySourceRows = arrOf(data, "bySource").map((row) => {
    const src = normaliseCreditSource(strOf(row, "creditSource")) ?? "MANUAL";
    const receiveCur = strOf(row, "receiveCurrency").toUpperCase();
    return {
      credit_source: src,
      label: strOf(row, "label") || undefined,
      earned: numOf(row, "earned"),
      used: numOf(row, "used"),
      expired: numOf(row, "expired"),
      removed: numOf(row, "removed"),
      available: numOf(row, "available"),
      ...(numOf(row, "floor", 0) > 0 ? { floor: numOf(row, "floor") } : {}),
      ...(receiveCur ? { receive_currency: receiveCur } : {}),
    };
  });

  // Map multi-currency balances if present, otherwise synthesize from flat fields
  const rawWallet = pickFurpField(data, "wallet");
  const rawBalances = isRecord(rawWallet)
    ? arrOf(rawWallet, "balances")
    : arrOf(data, "balances");

  const balances: WalletBalance[] =
    rawBalances.length > 0
      ? rawBalances.map((b) => ({
          currency: (strOf(b, "currency") || primaryCurrency).toUpperCase(),
          available: numOf(b, "available"),
          earned: numOf(b, "earned"),
          used: numOf(b, "used"),
          expired: numOf(b, "expired"),
          used_transfer_count: numOf(b, "usedTransferCount", numOf(b, "used_transfer_count")),
          referral_credit_count: numOf(b, "referralCreditCount", numOf(b, "referral_credit_count")),
          other_credit_count: numOf(b, "otherCreditCount", numOf(b, "other_credit_count")),
          outstanding_debt: numOf(b, "outstandingDebt", numOf(b, "outstanding_debt")),
          by_source: arrOf(b, "bySource").length > 0
            ? arrOf(b, "bySource").map((s) => ({
                credit_source: normaliseCreditSource(strOf(s, "creditSource")) ?? "MANUAL",
                label: strOf(s, "label") || undefined,
                earned: numOf(s, "earned"),
                used: numOf(s, "used"),
                expired: numOf(s, "expired"),
                removed: numOf(s, "removed"),
                available: numOf(s, "available"),
                ...(numOf(s, "floor", 0) > 0 ? { floor: numOf(s, "floor") } : {}),
                receive_currency: strOf(s, "receiveCurrency") || null,
              }))
            : bySourceRows,
        }))
      : [
          {
            currency: primaryCurrency,
            available: numOf(data, "availableBalance"),
            earned: numOf(data, "earned"),
            used: numOf(data, "used"),
            expired: numOf(data, "expired"),
            used_transfer_count: numOf(data, "usedTransferCount"),
            referral_credit_count: numOf(data, "referralCreditCount"),
            other_credit_count: numOf(data, "otherCreditCount"),
            outstanding_debt: numOf(data, "outstandingDebt"),
            by_source: bySourceRows,
          },
        ];

  const unused: WalletCredit[] = arrOf(data, "unused").map((row, idx) => {
    const amount = numOf(row, "amount");
    const remaining = numOf(row, "remaining", amount);
    const status: WalletCredit["status"] =
      remaining <= 0
        ? "USED"
        : remaining + 0.001 < amount
          ? "PARTLY_USED"
          : "UNUSED";
    const receiveCur = strOf(row, "receiveCurrency").toUpperCase();
    return {
      id: strOf(row, "id") || `credit_${idx}`,
      source: strOf(row, "label") || null,
      reason_code: strOf(row, "reasonCode", "BONUS_CREDIT"),
      amount,
      remaining,
      currency: (strOf(row, "currency") || primaryCurrency).toUpperCase(),
      earned_on: strOf(row, "createdAt", strOf(row, "earnedOn")),
      expires_on: strOf(row, "expiresAt", strOf(row, "expiresOn")) || null,
      ...(numOf(row, "floor", 0) > 0 ? { floor: numOf(row, "floor") } : {}),
      receive_currency: receiveCur || null,
      status,
      credit_source: normaliseCreditSource(strOf(row, "creditSource")),
      credit_source_label: strOf(row, "label") || null,
    };
  });

  const remainingById = new Map<string, number>();
  for (const c of unused) {
    remainingById.set(c.id, c.remaining);
  }

  const history: WalletHistoryEntry[] = arrOf(data, "history").map((row, idx) => {
    const rawType = strOf(row, "type").toUpperCase();
    const mappedType: WalletHistoryEntry["type"] =
      rawType === "APPLIED" ||
      rawType === "EXPIRED" ||
      rawType === "VOIDED" ||
      rawType === "CLAWBACK" ||
      rawType === "CLAWBACK_SETTLED"
        ? rawType
        : "EARNED";
    return {
      id: strOf(row, "id") || `hist_${idx}`,
      created_at: strOf(row, "createdAt"),
      type: mappedType,
      reason_code:
        rawType === "RETURNED"
          ? "BONUS_RETURNED"
          : strOf(row, "reasonCode", mappedType),
      amount: numOf(row, "amount"),
      currency: (strOf(row, "currency") || primaryCurrency).toUpperCase(),
      notes: strOf(row, "label", strOf(row, "notes")) || null,
      transfer_id: strOf(row, "transferId") || null,
      source_credit_id: strOf(row, "sourceCreditId") || null,
      credit_source: normaliseCreditSource(strOf(row, "creditSource")),
      credit_source_label: strOf(row, "label") || null,
    };
  });

  const credits = history
    .filter((h) => h.type === "EARNED")
    .map((h) => {
      const rem = remainingById.get(h.id) ?? 0;
      const status: WalletCredit["status"] =
        rem <= 0.001
          ? "USED"
          : rem + 0.001 < Math.abs(h.amount)
            ? "PARTLY_USED"
            : "UNUSED";
      return {
        id: h.id,
        amount: h.amount,
        remaining: rem,
        currency: h.currency,
        status,
        expires_on: unused.find((u) => u.id === h.id)?.expires_on ?? null,
        notes: h.notes,
        reason_code: h.reason_code,
        created_at: h.created_at,
      };
    });

  const promoRedemptions = arrOf(data, "promoSavings").map((row, idx) => ({
    id: strOf(row, "id") || `promo_${idx}`,
    code: strOf(row, "code"),
    amount: Math.abs(numOf(row, "amount")),
    currency: (strOf(row, "currency") || primaryCurrency).toUpperCase(),
    transfer_id: strOf(row, "transferId"),
    created_at: strOf(row, "createdAt"),
  }));

  const wallet: Wallet = {
    bonus_blocked: boolOf(data, "bonusBlocked", false),
    balances,
    unused,
    credits,
    history,
    promo_redemptions: promoRedemptions,
  };

  const referralItems: MyReferral[] = arrOf(data, "referrals").map((row, idx) => {
    const rawStatus = strOf(row, "status", "REGISTERED").toUpperCase();
    const status: MyReferral["status"] =
      rawStatus === "PENDING" ||
      rawStatus === "REWARDED" ||
      rawStatus === "EXPIRED" ||
      rawStatus === "NOT_ELIGIBLE" ||
      rawStatus === "REVERSED"
        ? rawStatus
        : "REGISTERED";
    return {
      id: strOf(row, "id") || `ref_${idx}`,
      friend: strOf(row, "friend", "Friend"),
      joined_on: strOf(row, "joinedOn", strOf(row, "joined_on")),
      status,
      status_label: strOf(row, "statusLabel", status),
      currency: (strOf(row, "currency") || primaryCurrency).toUpperCase(),
      floor: pickFurpField(row, "floor") != null ? numOf(row, "floor") : null,
      qualification_deadline:
        strOf(row, "qualificationDeadline", strOf(row, "qualification_deadline")) || null,
      reward: numOf(row, "reward"),
      credited: numOf(row, "credited"),
    };
  });

  const referralsTotal = numOf(data, "referralsTotal");
  const totalEarnedMap: Record<string, number> =
    referralsTotal > 0 ? { [primaryCurrency]: referralsTotal } : {};

  const rawSendCurrencies = pickFurpField(data, "sendCurrencies");
  const sendCurrencies = Array.isArray(rawSendCurrencies)
    ? rawSendCurrencies.map((c) => String(c).trim().toUpperCase()).filter(Boolean)
    : Array.from(
        new Set([
          primaryCurrency,
          ...balances.map((b) => b.currency),
          ...offers.map((o) => o.currency),
        ]),
      );

  const rawLatestOffer = pickFurpField(data, "latestOffer");
  const latestOffer: OfferAnnouncement | null = isRecord(rawLatestOffer)
    ? {
        id: numOf(rawLatestOffer, "id", 1),
        kind: strOf(rawLatestOffer, "kind", "LIVE"),
        title: strOf(rawLatestOffer, "title", "New offer"),
        message: strOf(rawLatestOffer, "message"),
        currency: strOf(rawLatestOffer, "currency") || primaryCurrency,
        createdAt: strOf(rawLatestOffer, "createdAt"),
      }
    : null;

  return {
    customer: referralCode
      ? {
          id: strOf(data, "customerId", "self"),
          referralCode,
          currency: primaryCurrency,
        }
      : null,
    currency: primaryCurrency,
    sendCurrencies,
    offer: primaryOffer,
    offers,
    wallet,
    referrals: {
      data: referralItems,
      summary: {
        joined: numOf(data, "referralsJoined", referralItems.length),
        earned_count: numOf(data, "referralsEarned"),
        total_earned: totalEarnedMap,
      },
    },
    latestOffer,
    latestOffers: latestOffer ? [latestOffer] : [],
  };
}

// ─── Public FURP `/api/v1/Account/Rewards*` Client Methods ───────────────────

/**
 * Fetches `GET ${baseUrl}Account/Rewards` and maps `Result<RewardCatalogueDto>`
 * into `Rhemito-UI`'s `RewardsSummary`.
 */
export async function fetchFurpRewardsSummary(
  params: { currency?: string } = {},
  options: FurpRequestOptions = {},
): Promise<RewardsSummary> {
  const qs = params.currency ? `?currency=${encodeURIComponent(params.currency.trim().toUpperCase())}` : "";
  const data = await requestFurp<Record<string, unknown>>(
    "GET",
    `Account/Rewards${qs}`,
    undefined,
    options,
  );
  return mapFurpCatalogueToRewardsSummary(
    isRecord(data) ? data : {},
    params.currency,
  );
}

/**
 * Validates a referral code via `GET ${baseUrl}Account/Rewards/Code/{code}` (`[AllowAnonymous]`)
 * and normalizes both `furp02-core`'s flat `ReferralCodeCheckDto` and rich multi-currency
 * `offer` / `currencyOffers` payloads into `ReferralCodeLookup`.
 */
export async function validateFurpReferralCode(
  rawCode: string,
  params: { currency?: string; ruleId?: number } = {},
  options: FurpRequestOptions = {},
): Promise<ReferralCodeLookup> {
  const cleanCode = String(rawCode || "").trim().toUpperCase();
  const queryParts: string[] = [];
  if (params.currency) queryParts.push(`currency=${encodeURIComponent(params.currency.trim().toUpperCase())}`);
  if (params.ruleId) queryParts.push(`ruleId=${encodeURIComponent(String(params.ruleId))}`);
  const qs = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";

  const data = await requestFurp<Record<string, unknown>>(
    "GET",
    `Account/Rewards/Code/${encodeURIComponent(cleanCode)}${qs}`,
    undefined,
    options,
  );

  const record = isRecord(data) ? data : {};
  const valid = boolOf(record, "valid", true);
  if (!valid) {
    throw new FurpApiError(
      strOf(record, "message", "This referral link isn't valid."),
      404,
      "INVALID_REFERRAL_CODE",
      record,
    );
  }

  const resolvedCode = (strOf(record, "code") || cleanCode).toUpperCase();
  const currency = (strOf(record, "currency") || params.currency || "GBP").toUpperCase();
  const rawNestedOffer = pickFurpField(record, "offer");

  const synthesizedOffer: RewardOffer | null = isRecord(rawNestedOffer)
    ? mapFurpOffer(rawNestedOffer, currency, resolvedCode)
    : numOf(record, "refereeReward") > 0 || strOf(record, "offerText")
      ? mapFurpOffer(
          {
            ruleId: params.ruleId ?? numOf(record, "ruleId", 1),
            currency,
            refereeReward: numOf(record, "refereeReward"),
            referrerReward: numOf(record, "referrerReward"),
            minimumAmount: numOf(record, "minimumAmount"),
            windowDays: numOf(record, "windowDays", 30),
            offerText: strOf(record, "offerText"),
            referralCode: resolvedCode,
          },
          currency,
          resolvedCode,
        )
      : null;

  const extraOffers = [
    ...arrOf(record, "currencyOffers"),
    ...arrOf(record, "offers"),
  ]
    .map((item) => mapFurpOffer(item, currency, resolvedCode))
    .filter((o): o is RewardOffer => o !== null);

  const offers =
    extraOffers.length > 0
      ? extraOffers
      : synthesizedOffer
        ? [synthesizedOffer]
        : [];

  const rawSendCurrencies = pickFurpField(record, "sendCurrencies");
  const sendCurrencies = Array.isArray(rawSendCurrencies)
    ? rawSendCurrencies.map((c) => String(c).trim().toUpperCase()).filter(Boolean)
    : offers.length > 0
      ? Array.from(new Set(offers.map((o) => o.currency)))
      : [currency];

  const ruleId = params.ruleId ?? (numOf(record, "ruleId", 0) || synthesizedOffer?.rule_id);

  return {
    valid: true,
    code: resolvedCode,
    referrerFirstName: strOf(record, "referrerFirstName") || undefined,
    ...(ruleId ? { ruleId } : {}),
    offer: synthesizedOffer ?? offers[0] ?? null,
    offers,
    sendCurrencies,
    signedIn: boolOf(record, "signedIn", false),
    message: strOf(record, "message") || undefined,
  };
}

/**
 * Records an anonymous referral link click via `POST ${baseUrl}Account/Rewards/Visit`
 * and returns tracking metadata + store redirect URLs.
 */
export async function recordFurpReferralVisit(
  input: ReferralVisitInput,
  options: FurpRequestOptions = {},
): Promise<ReferralVisitResponse> {
  const code = String(input.code || "").trim().toUpperCase();
  const payload: Record<string, unknown> = {
    code,
    visitorId: String(input.visitorId || "anonymous").slice(0, 64),
    ...(input.receiveCurrency ? { receiveCurrency: input.receiveCurrency.trim().toUpperCase() } : {}),
    ...(input.ruleId ? { ruleId: input.ruleId } : {}),
    ...(input.deviceType ? { deviceType: input.deviceType } : {}),
    ...(input.operatingSystem ? { operatingSystem: input.operatingSystem } : {}),
    ...(input.sourceChannel ? { sourceChannel: input.sourceChannel } : {}),
    ...(input.storeTarget ? { storeTarget: input.storeTarget } : {}),
  };

  const data = await requestFurp<unknown>(
    "POST",
    "Account/Rewards/Visit",
    payload,
    options,
  );

  // `furp02-core` pri_prod returns `Result<bool>` (`data: true`), while upgraded Staging returns `{ tracked, trackingId, playStoreUrl, appStoreUrl }`
  if (typeof data === "boolean") {
    return {
      tracked: data,
      counted: data,
      trackingId: null,
      playStoreUrl: buildGooglePlayReferralUrl(null, code),
      appStoreUrl: APPLE_APP_STORE_URL,
    };
  }

  const record = isRecord(data) ? data : {};
  const trackingId = strOf(record, "trackingId") || null;
  return {
    tracked: boolOf(record, "tracked", true),
    counted: boolOf(record, "counted", true),
    trackingId,
    playStoreUrl: strOf(record, "playStoreUrl") || buildGooglePlayReferralUrl(trackingId, code),
    appStoreUrl: strOf(record, "appStoreUrl") || APPLE_APP_STORE_URL,
    deviceType: strOf(record, "deviceType") || null,
    operatingSystem: strOf(record, "operatingSystem") || null,
    status: strOf(record, "status") || "CLICKED",
  };
}

/**
 * Links a pending referral code to the newly signed-in customer via `POST ${baseUrl}Account/Rewards/Link`.
 */
export async function linkFurpReferral(
  input: ReferralLinkInput,
  options: FurpRequestOptions = {},
): Promise<ReferralLinkResponse> {
  const payload: Record<string, unknown> = {
    code: String(input.code || "").trim().toUpperCase(),
    ...(input.trackingId ? { trackingId: input.trackingId } : {}),
    ...(input.visitorId ? { visitorId: input.visitorId } : {}),
    ...(input.receiveCurrency ? { receiveCurrency: input.receiveCurrency.trim().toUpperCase() } : {}),
    ...(input.ruleId ? { ruleId: input.ruleId } : {}),
    ...(input.attributionMethod ? { attributionMethod: input.attributionMethod } : {}),
  };

  const data = await requestFurp<unknown>(
    "POST",
    "Account/Rewards/Link",
    payload,
    options,
  );

  if (typeof data === "string") {
    return {
      linked: true,
      status: data || "REGISTERED",
      message: "Referral linked.",
    };
  }

  const record = isRecord(data) ? data : {};
  return {
    linked: true,
    status: strOf(record, "status", "REGISTERED"),
    message: strOf(record, "message", "Referral linked."),
  };
}

/**
 * Validates a promo code via `POST ${baseUrl}Account/Rewards/Promo/Validate` (`Result<PromoCheckDto>`).
 */
export async function validateFurpPromoCode(
  input: PromoValidateInput,
  options: FurpRequestOptions = {},
): Promise<PromoValidateResponse> {
  const currency = String(input.currency || "GBP").trim().toUpperCase();
  const payload: Record<string, unknown> = {
    code: String(input.code || "").trim().toUpperCase(),
    amount: Number(input.amount || 0),
    fee: Number(Number(input.fee || 0).toFixed(2)),
    currency,
    ...(input.receiveCurrency ? { receiveCurrency: input.receiveCurrency.trim().toUpperCase() } : {}),
    ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
  };

  const data = await requestFurp<Record<string, unknown>>(
    "POST",
    "Account/Rewards/Promo/Validate",
    payload,
    options,
  );

  const record = isRecord(data) ? data : {};
  const valid = boolOf(record, "valid", true);
  const discount = numOf(record, "discount", numOf(record, "appliedDiscount", 0));

  if (!valid || discount <= 0) {
    throw new FurpApiError(
      strOf(record, "message", "This promo code isn't valid for this transfer."),
      400,
      "INVALID_PROMO_CODE",
      record,
    );
  }

  const rawBasis = strOf(record, "discountBasis", "PAYABLE").toUpperCase();
  const discountBasis: PromoValidateResponse["discountBasis"] =
    rawBasis === "VALUE" || rawBasis === "FEE" ? rawBasis : "PAYABLE";
  const customerChoice =
    discountBasis === "VALUE" || boolOf(record, "customerChoice", false);

  const displayText =
    strOf(record, "displayText") ||
    (customerChoice
      ? `${currency} ${discount.toFixed(2)} of the send amount. Pay less, or add it to what they receive.`
      : `You save ${currency} ${discount.toFixed(2)} on the fee`);

  return {
    valid: true,
    discount,
    appliedDiscount: discount,
    appliesTo: discountBasis === "VALUE" ? "amount" : "fee",
    discountBasis,
    customerChoice,
    displayText,
    currency,
    message: strOf(record, "message") || undefined,
  };
}
