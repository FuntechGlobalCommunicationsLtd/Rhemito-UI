/**
 * Browser attribution & storage helper for Refer & Earn across:
 *   `/ref/[code]` → `/signup` (or `/login` email step → `/signup`) → email activation → `/overview` (`Account/Rewards/Link`).
 *
 * Preserves full attribution context (`code`, `trackingId`, `visitorId`, `ruleId`,
 * `receiveCurrency`, `referrerFirstName`, `intendedEmail`, `offer`, store URLs) for 30 days
 * while remaining 100% backward-compatible with `prod_main` `Rhemito-web` exports
 * (`saveReferralCode`, `readReferralCode`, `readReferralCodeForUser`, `clearReferralCode`, `referralVisitorId`).
 */

const CODE_KEY = "rewards.referral";
const VISITOR_KEY = "rewards.visitor";
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

export const REFERRAL_CODE_REGEX = /^[A-Z0-9]{6,16}$/;
export const REFERRAL_CODE_MESSAGE = "Referral codes are 6–16 letters and numbers.";
export const SUPPORTED_REFERRAL_CURRENCIES = [
  "GBP",
  "USD",
  "EUR",
  "NGN",
  "CAD",
  "AUD",
  "JPY",
  "CNY",
  "INR",
  "ZAR",
  "KES",
  "GHS",
  "AED",
] as const;

export const GOOGLE_PLAY_PACKAGE_ID = "com.funtechcom.rhemito";
export const GOOGLE_PLAY_BASE_URL = `https://play.google.com/store/apps/details?id=${GOOGLE_PLAY_PACKAGE_ID}`;
export const APPLE_APP_STORE_URL =
  "https://apps.apple.com/gb/app/rhemito-money-transfer/id1494717263";

export interface StoredReferralOffer {
  referrerBonus?: number;
  refereeBonus?: number;
  minTransfer?: number;
  currency?: string;
  receiveCurrency?: string | null;
  benefitType?: "BOTH" | "REFEREE_ONLY" | "REFERRER_ONLY" | string;
  headline?: string;
  summary?: string;
  capReached?: boolean;
}

export interface StoredReferralRecord {
  code: string;
  savedAt: number;
  trackingId?: string | null;
  visitorId?: string | null;
  ruleId?: number | null;
  receiveCurrency?: string | null;
  referrerFirstName?: string | null;
  intendedEmail?: string | null;
  offer?: StoredReferralOffer | null;
  playStoreUrl?: string | null;
  appStoreUrl?: string | null;
}

export type SaveReferralInput =
  | string
  | (Omit<Partial<StoredReferralRecord>, "code" | "savedAt"> & { code: string });

export function normaliseReferralCode(raw: string | null | undefined): string | null {
  const cleaned = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!cleaned || !REFERRAL_CODE_REGEX.test(cleaned)) return null;
  return cleaned;
}

/**
 * Derives the currency-specific referral code from a customer's base code and send currency
 * (e.g. `JOHN5054` + `USD` -> `JOHN5054USD`). Replaces any existing currency suffix cleanly.
 */
export function referralCodeForCurrency(
  baseCode: string | null | undefined,
  currency: string | null | undefined,
): string {
  const raw = String(baseCode || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const cur = String(currency || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!raw) return "";
  if (!cur) return raw;
  for (const suffix of SUPPORTED_REFERRAL_CURRENCIES) {
    if (raw.length >= 9 && raw.endsWith(suffix)) {
      const stripped = raw.slice(0, -suffix.length);
      return `${stripped}${cur}`;
    }
  }
  return `${raw}${cur}`;
}

function normaliseEmail(raw?: string | null): string | null {
  const email = String(raw || "").trim().toLowerCase();
  return email.includes("@") ? email : null;
}

function normaliseCurrency(raw?: string | null): string | null {
  const cur = String(raw || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(cur) ? cur : null;
}

/**
 * Generates or returns the persistent browser visitor ID used for `Account/Rewards/Visit`
 * and `Account/Rewards/Link` deduplication.
 */
export function getOrCreateVisitorId(): string {
  if (typeof window === "undefined") return "anonymous";
  try {
    let id = window.localStorage.getItem(VISITOR_KEY);
    if (!id) {
      const randomPart =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
          : `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
      id = `v_${randomPart}`;
      window.localStorage.setItem(VISITOR_KEY, id);
    }
    return id.slice(0, 64);
  } catch {
    return "anonymous";
  }
}

/**
 * Builds an Android Google Play Install Referrer URL embedding `tracking_id` and `referral_code`
 * (matching `RewardReferralService.cs` and `client/src/lib/rewards.ts`).
 */
export function buildGooglePlayReferralUrl(
  trackingId?: string | null,
  code?: string | null,
  packageId = GOOGLE_PLAY_PACKAGE_ID,
): string {
  const baseUrl = `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageId)}`;
  const parts: string[] = [];
  if (trackingId) parts.push(`tracking_id=${encodeURIComponent(trackingId)}`);
  if (code) parts.push(`referral_code=${encodeURIComponent(code)}`);
  if (parts.length === 0) return baseUrl;
  const referrerParam = encodeURIComponent(parts.join("&"));
  return `${baseUrl}&referrer=${referrerParam}`;
}

/**
 * Reads the full stored referral attribution record if still within the 30-day window.
 */
export function readReferral(): StoredReferralRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CODE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.code || !parsed?.savedAt) return null;
    if (Date.now() - Number(parsed.savedAt) > THIRTY_DAYS) {
      window.localStorage.removeItem(CODE_KEY);
      return null;
    }
    const code = normaliseReferralCode(String(parsed.code));
    if (!code) return null;
    const ruleNum = parsed.ruleId != null ? Number(parsed.ruleId) : null;
    return {
      code,
      savedAt: Number(parsed.savedAt),
      trackingId: parsed.trackingId ? String(parsed.trackingId) : null,
      visitorId: parsed.visitorId ? String(parsed.visitorId) : null,
      ruleId: ruleNum != null && Number.isFinite(ruleNum) && ruleNum > 0 ? ruleNum : null,
      receiveCurrency: normaliseCurrency(parsed.receiveCurrency),
      referrerFirstName: parsed.referrerFirstName ? String(parsed.referrerFirstName) : null,
      intendedEmail: normaliseEmail(parsed.intendedEmail),
      offer: parsed.offer && typeof parsed.offer === "object" ? parsed.offer : null,
      playStoreUrl: parsed.playStoreUrl ? String(parsed.playStoreUrl) : null,
      appStoreUrl: parsed.appStoreUrl ? String(parsed.appStoreUrl) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Saves or merges referral attribution metadata into `localStorage` (`rewards.referral`).
 * Preserves previously saved `trackingId`, `offer`, `ruleId`, or `intendedEmail` when updating the same code.
 */
export function saveReferral(input: SaveReferralInput): StoredReferralRecord | null {
  const payload = typeof input === "string" ? { code: input } : input;
  const code = normaliseReferralCode(payload.code);
  if (!code) return null;

  const existing = readReferral();
  const sameCode = existing?.code === code;
  const record: StoredReferralRecord = {
    code,
    savedAt: Date.now(),
    trackingId:
      payload.trackingId !== undefined
        ? payload.trackingId
        : sameCode
          ? existing?.trackingId ?? null
          : null,
    visitorId:
      payload.visitorId !== undefined
        ? payload.visitorId
        : sameCode
          ? existing?.visitorId ?? getOrCreateVisitorId()
          : getOrCreateVisitorId(),
    ruleId:
      payload.ruleId !== undefined
        ? payload.ruleId
        : sameCode
          ? existing?.ruleId ?? null
          : null,
    receiveCurrency:
      payload.receiveCurrency !== undefined
        ? normaliseCurrency(payload.receiveCurrency)
        : sameCode
          ? existing?.receiveCurrency ?? null
          : null,
    referrerFirstName:
      payload.referrerFirstName !== undefined
        ? payload.referrerFirstName
        : sameCode
          ? existing?.referrerFirstName ?? null
          : null,
    intendedEmail:
      normaliseEmail(payload.intendedEmail) ||
      (sameCode ? existing?.intendedEmail ?? null : null),
    offer:
      payload.offer !== undefined
        ? payload.offer
        : sameCode
          ? existing?.offer ?? null
          : null,
    playStoreUrl:
      payload.playStoreUrl !== undefined
        ? payload.playStoreUrl
        : sameCode
          ? existing?.playStoreUrl ?? null
          : null,
    appStoreUrl:
      payload.appStoreUrl !== undefined
        ? payload.appStoreUrl
        : sameCode
          ? existing?.appStoreUrl ?? null
          : null,
  };

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CODE_KEY, JSON.stringify(record));
    } catch {
      // Ignore storage quota / private-mode write errors
    }
  }
  return record;
}

/**
 * Binds the stored referral to the email address that registered with it so
 * another customer signing in on the same shared browser cannot claim the welcome credit.
 */
export function bindReferralEmail(email: string | null | undefined): void {
  if (typeof window === "undefined") return;
  const record = readReferral();
  if (!record?.code) return;
  const next = normaliseEmail(email);
  if (!next) return;
  try {
    window.localStorage.setItem(
      CODE_KEY,
      JSON.stringify({
        ...record,
        intendedEmail: next,
        savedAt: record.savedAt || Date.now(),
      }),
    );
  } catch {
    // Ignore storage write errors
  }
}

/**
 * Returns the full referral record only when it belongs to `signedInEmail` (or was not yet email-bound).
 */
export function readReferralForUser(signedInEmail?: string | null): StoredReferralRecord | null {
  const record = readReferral();
  if (!record?.code) return null;
  const session = normaliseEmail(signedInEmail);
  if (record.intendedEmail && session && record.intendedEmail !== session) {
    return null;
  }
  return record;
}

/**
 * Clears any stored referral attribution from `localStorage`.
 */
export function clearReferral(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CODE_KEY);
  } catch {
    // Ignore storage errors
  }
}

// ─── Backward-Compatible Aliases (`Rhemito-web` `prod_main`) ─────────────────

export function saveReferralCode(
  raw: string,
  intendedEmail?: string | null,
  meta?: Omit<Partial<StoredReferralRecord>, "code" | "savedAt" | "intendedEmail">,
): string | null {
  const saved = saveReferral({
    ...(meta || {}),
    code: raw,
    intendedEmail: intendedEmail ?? undefined,
  });
  return saved?.code ?? normaliseReferralCode(raw);
}

export function readReferralCode(): string | null {
  return readReferral()?.code ?? null;
}

export function readReferralCodeForUser(signedInEmail?: string | null): string | null {
  return readReferralForUser(signedInEmail)?.code ?? null;
}

export function clearReferralCode(): void {
  clearReferral();
}

export function referralVisitorId(): string {
  return getOrCreateVisitorId();
}

export const referralStorageKey = CODE_KEY;
