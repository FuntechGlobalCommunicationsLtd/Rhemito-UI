/**
 * Referral & Bonus helpers shared by the Dashboard, Bonus & Discounts page,
 * sign-up and Send Money. Pure functions only — unit tested in rewards.test.ts.
 */

export interface RewardOffer {
  rule_id: number;
  name?: string;
  currency: string;
  receive_currency?: string | null;
  corridor?: string;
  reward_type: "BOTH" | "REFERRER" | "REFEREE";
  referrer_reward: number;
  referee_reward: number;
  floor: number;
  qualification_window_days: number;
  bonus_validity_days: number;
  min_redeem_amount: number;
  text: string;
  referral_code?: string;
  referral_link?: string;
  cap_reached?: boolean;
}

export interface WalletBalance {
  currency: string;
  available: number;
  earned: number;
  used: number;
  expired: number;
  used_transfer_count: number;
  referral_credit_count: number;
  other_credit_count: number;
  /** Bonus module (one balance): money still owed from removed bonus, and the split by how it was earned. */
  outstanding_debt?: number;
  by_source?: Array<{ credit_source: "REFERRAL" | "SCHEME" | "MANUAL"; label?: string; earned: number; used: number; expired: number; removed: number; available: number; floor?: number; receive_currency?: string | null }>;
}

/** How a credit was earned — present when Mito runs the bonus module. */
export interface CreditSourceFields {
  credit_source?: "REFERRAL" | "SCHEME" | "MANUAL" | null;
  credit_source_detail?: string | null;
  credit_source_label?: string | null;
  source_label?: string | null;
}

export interface WalletCredit extends CreditSourceFields {
  id: string;
  source: string | null;
  reason_code: string;
  amount: number;
  remaining: number;
  currency: string;
  earned_on: string;
  expires_on: string | null;
  floor?: number;
  receive_currency?: string | null;
  status: "UNUSED" | "PARTLY_USED" | "USED" | "EXPIRED" | "REVERSED";
}

export interface WalletHistoryEntry extends CreditSourceFields {
  id: string;
  created_at: string;
  type: "EARNED" | "APPLIED" | "EXPIRED" | "VOIDED" | "CLAWBACK" | "CLAWBACK_SETTLED";
  reason_code: string;
  amount: number;
  currency: string;
  notes: string | null;
  transfer_id: string | null;
  source_credit_id: string | null;
}

export interface Wallet {
  /** True when the customer cannot earn bonus until support approves them. */
  bonus_blocked?: boolean;
  balances: WalletBalance[];
  unused: WalletCredit[];
  credits: Array<Pick<WalletCredit, "id" | "amount" | "remaining" | "currency" | "status"> & { expires_on: string | null; notes: string | null; reason_code: string; created_at: string }>;
  history: WalletHistoryEntry[];
  promo_redemptions: Array<{ id: string; code: string; amount: number; currency: string | null; transfer_id: string; created_at: string }>;
}

export interface MyReferral {
  id: string;
  friend: string;
  joined_on: string;
  status: "REGISTERED" | "PENDING" | "REWARDED" | "EXPIRED" | "NOT_ELIGIBLE" | "REVERSED";
  status_label: string;
  currency: string;
  floor: number | null;
  qualification_deadline: string | null;
  reward: number;
  credited: number;
}

export interface OfferAnnouncement {
  id: number;
  kind: string;
  title: string;
  message: string;
  currency?: string;
  createdAt: string;
}

/**
 * Formats the "New offer" banner copy so referral announcements match the
 * approved Refer & Earn reward wording (referrer rewarded after first successful
 * transaction; friend rewarded on sign-up).
 */
export function formatOfferAnnouncementMessage(message: string, kind?: string | null): string {
  const raw = String(message ?? "").trim();
  if (!raw || (kind && kind !== "LIVE")) return raw;

  const inviteMatch = raw.match(
    /^Invite friends and get (.+?) each time they send .+? or more(?:\s+to\s+[A-Za-z0-9]+)?\.(?:\s*Your friend gets (.+?) too\.)?$/i,
  );
  if (inviteMatch) {
    const referrerAmount = inviteMatch[1];
    const refereeAmount = inviteMatch[2];
    return `Invite friends and get ${referrerAmount} each time they sign up via your link and complete a successful transaction.${
      refereeAmount ? ` Your friend gets ${refereeAmount} too on sign-up.` : ""
    }`;
  }

  const refereeOnlyMatch = raw.match(
    /^Give friends (.+?) when they join with your link and send .+? or more(?:\s+to\s+[A-Za-z0-9]+)?\.$/i,
  );
  if (refereeOnlyMatch) {
    return `Give friends ${refereeOnlyMatch[1]} on sign-up when they join via your link.`;
  }

  return raw;
}

export interface RewardsSummary {
  customer: { id: string; referralCode: string; currency: string } | null;
  currency: string;
  sendCurrencies?: string[];
  offer: RewardOffer | null;
  offers?: RewardOffer[];
  wallet: Wallet;
  referrals: { data: MyReferral[]; summary: { joined: number; earned_count: number; total_earned: Record<string, number> } };
  latestOffer: OfferAnnouncement | null;
  latestOffers?: OfferAnnouncement[];
}

const SYMBOLS: Record<string, string> = {
  GBP: "£", USD: "$", EUR: "€", NGN: "₦", INR: "₹", JPY: "¥", CNY: "¥", AUD: "A$", CAD: "C$", ZAR: "R", KES: "KSh ", GHS: "GH₵", AED: "AED ",
};

export function formatMoney(amount: number, currency: string): string {
  const dp = currency === "JPY" ? 0 : 2;
  const n = Number(amount || 0);
  const sign = n < 0 ? "−" : "";
  return `${sign}${SYMBOLS[currency] ?? `${currency} `}${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

/** YYYY-MM-DD or ISO → DD/MM/YYYY (UK time). */
export function formatUkDate(value: string | null | undefined): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split("-").reverse().join("/");
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-GB", { timeZone: "Europe/London" });
}

/** Whole days from today (UK) until a YYYY-MM-DD date; negative when past. */
export function daysUntil(ymd: string | null | undefined, now: Date = new Date()): number | null {
  if (!ymd) return null;
  const today = now.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const diff = Date.parse(`${ymd.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(diff / 86_400_000);
}

/** "Expires in 9 days" / "Expires today" / "Expires tomorrow". */
export function expiryLabel(ymd: string | null | undefined, now: Date = new Date()): string {
  const d = daysUntil(ymd, now);
  if (d === null) return "";
  if (d <= 0) return "Expires today";
  if (d === 1) return "Expires tomorrow";
  return `Expires in ${d} days`;
}

/** Credits that expire within the warning window (14 days), soonest first. */
export function expiringSoon(credits: WalletCredit[], now: Date = new Date(), windowDays = 14): WalletCredit[] {
  return credits
    .filter((c) => c.remaining > 0 && c.expires_on && (daysUntil(c.expires_on, now) ?? 99) <= windowDays)
    .sort((a, b) => String(a.expires_on).localeCompare(String(b.expires_on)));
}

/** Balance for one currency (zeros when the customer has none). */
export function balanceFor(wallet: Wallet | undefined, currency: string): WalletBalance {
  return (
    wallet?.balances.find((b) => b.currency === currency) ?? {
      currency, available: 0, earned: 0, used: 0, expired: 0, used_transfer_count: 0, referral_credit_count: 0, other_credit_count: 0,
    }
  );
}

/** Progress segments filled (of 3) and tone for a referral's journey bar. */
export function referralStage(status: MyReferral["status"]): { filled: number; tone: "teal" | "primary" | "muted" } {
  switch (status) {
    case "REWARDED": return { filled: 3, tone: "teal" };
    case "PENDING": return { filled: 2, tone: "primary" };
    case "REGISTERED": return { filled: 1, tone: "primary" };
    default: return { filled: 3, tone: "muted" };
  }
}

/** Short status line shown next to a friend's name (US-2.3 table). */
export function referralStatusText(r: MyReferral, now: Date = new Date()): string {
  const floor = r.floor !== null && r.floor !== undefined ? formatMoney(r.floor, r.currency) : "";
  switch (r.status) {
    case "REWARDED": return r.credited > 0 ? `${formatMoney(r.credited, r.currency)} earned` : "Earned";
    case "PENDING": return "Transfer in progress";
    case "REGISTERED": {
      const left = daysUntil(r.qualification_deadline, now);
      return left !== null && left >= 0 ? `Joined · ${left} day${left === 1 ? "" : "s"} left` : "Joined";
    }
    case "EXPIRED": return `Didn't send ${floor || "the minimum"} in time`;
    case "NOT_ELIGIBLE": return "Not eligible";
    case "REVERSED": return "Transfer refunded";
    default: return r.status_label;
  }
}

/** Longer help line used on the My referrals tab. */
export function referralHelpText(r: MyReferral, now: Date = new Date()): string {
  const floor = r.floor !== null && r.floor !== undefined ? formatMoney(r.floor, r.currency) : "the minimum amount";
  switch (r.status) {
    case "REGISTERED": {
      const left = daysUntil(r.qualification_deadline, now);
      return `Waiting for their first transfer of ${floor} or more${left !== null && left >= 0 ? ` · ${left} day${left === 1 ? "" : "s"} left` : ""}`;
    }
    case "PENDING": return `Transfer in progress – you get ${formatMoney(r.reward, r.currency)} when it completes`;
    case "REWARDED": return r.credited > 0 ? `You earned ${formatMoney(r.credited, r.currency)} — added to your bonus credit (completed first transfer)` : "Your friend received their welcome bonus (completed first transfer)";
    case "EXPIRED": return `They didn't send ${floor} or more in time`;
    case "NOT_ELIGIBLE": return "This referral didn't meet the programme terms";
    case "REVERSED": return "The qualifying transfer was refunded";
    default: return r.status_label;
  }
}

/** Customer-facing status of a credit or history line. */
export const CREDIT_STATUS_LABEL: Record<WalletCredit["status"], string> = {
  UNUSED: "Unused", PARTLY_USED: "Partly used", USED: "Used", EXPIRED: "Expired", REVERSED: "Reversed",
};

// ─── Referral code captured from a /ref link (kept 30 days, AC-3.1.2) ────────

const REF_KEY = "rhemito.referral";
const REF_TTL_MS = 30 * 86_400_000;
export const REFERRAL_CODE_RE = /^[A-Z0-9]{6,16}$/;

const REFERRAL_CODE_CURRENCIES = ["GBP", "USD", "EUR", "NGN", "INR", "JPY", "CNY", "AUD", "CAD", "ZAR", "KES", "GHS", "AED"];

/**
 * Derive the currency-specific referral code from a customer's base code and currency
 * (e.g. JOHN5054 + USD -> JOHN5054USD). Preserves already-suffixed codes cleanly.
 */
export function referralCodeForCurrency(baseCode: string | null | undefined, currency: string | null | undefined): string {
  const raw = String(baseCode || "").trim().toUpperCase();
  const cur = String(currency || "").trim().toUpperCase();
  if (!raw) return "";
  if (!cur) return raw;
  for (const suffix of REFERRAL_CODE_CURRENCIES) {
    if (raw.length >= 9 && raw.endsWith(suffix)) {
      const stripped = raw.slice(0, -suffix.length);
      return `${stripped}${cur}`;
    }
  }
  return `${raw}${cur}`;
}

export const GOOGLE_PLAY_PACKAGE_ID = "com.funtechcom.rhemito";
export const GOOGLE_PLAY_BASE_URL = `https://play.google.com/store/apps/details?id=${GOOGLE_PLAY_PACKAGE_ID}`;
export const APPLE_APP_STORE_URL = "https://apps.apple.com/gb/app/rhemito-money-transfer/id1494717263";

export function buildGooglePlayReferralUrl(trackingId?: string | null, referralCode?: string | null): string {
  const parts: string[] = [];
  if (trackingId) parts.push(`tracking_id=${trackingId}`);
  if (referralCode) parts.push(`referral_code=${referralCode}`);
  if (!parts.length) return GOOGLE_PLAY_BASE_URL;
  return `${GOOGLE_PLAY_BASE_URL}&referrer=${encodeURIComponent(parts.join("&"))}`;
}

export function detectClientDevice(): { deviceType: "mobile" | "tablet" | "desktop"; operatingSystem: "Android" | "iOS" | "Other" } {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const isAndroid = /android/i.test(ua);
  const isIos = /ipad|iphone|ipod|ios/i.test(ua) || (typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || "") && (navigator.maxTouchPoints || 0) > 1);
  const operatingSystem: "Android" | "iOS" | "Other" = isAndroid ? "Android" : isIos ? "iOS" : "Other";
  const isTablet = /ipad|tablet/i.test(ua);
  const isMobile = !isTablet && (/mobi|android|iphone|ipod/i.test(ua) || isIos);
  const deviceType: "mobile" | "tablet" | "desktop" = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";
  return { deviceType, operatingSystem };
}

export interface StoredReferral {
  code: string;
  ruleId?: number | null;
  referrerFirstName?: string;
  savedAt: number;
  offer?: RewardOffer | null;
  offers?: RewardOffer[];
  sendCurrencies?: string[];
  trackingId?: string | null;
  referralContextId?: string | null;
  channel?: "WEB" | "ANDROID" | "IOS";
  attributionMethod?: string;
  playStoreUrl?: string;
  appStoreUrl?: string;
  postSignupAppStoreUrl?: string | null;
}

export function saveReferral(ref: Omit<StoredReferral, "savedAt">, now = Date.now()): void {
  try { localStorage.setItem(REF_KEY, JSON.stringify({ ...ref, savedAt: now })); } catch { /* storage unavailable */ }
}

export function loadReferral(now = Date.now()): StoredReferral | null {
  try {
    const raw = localStorage.getItem(REF_KEY);
    if (!raw) return null;
    const ref = JSON.parse(raw) as StoredReferral;
    if (!ref.code || now - ref.savedAt > REF_TTL_MS) {
      localStorage.removeItem(REF_KEY);
      return null;
    }
    return ref;
  } catch {
    return null;
  }
}

export function clearReferral(): void {
  try { localStorage.removeItem(REF_KEY); } catch { /* ignore */ }
}

export function visitorId(): string {
  try {
    const key = "rhemito.visitorId";
    let id = localStorage.getItem(key);
    if (!id) {
      id = `v_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return "anonymous";
  }
}

export interface ReferralShareMessageOptions {
  offer?: Partial<RewardOffer> | null;
  code?: string | null;
  link?: string | null;
  referrerFirstName?: string | null;
  /** Whether to append the link at the end of the text (true for clipboard/WhatsApp URL; false when passed separately as `url` to navigator.share). */
  includeUrl?: boolean;
}

/**
 * Builds the share title for Web Share API and social previews.
 */
export function buildReferralShareTitle(options: ReferralShareMessageOptions = {}): string {
  const { offer, referrerFirstName } = options;
  const sender = referrerFirstName?.trim() || null;
  const currency = offer?.currency || "GBP";
  const hasRefereeReward = offer && offer.reward_type !== "REFERRER" && Number(offer.referee_reward ?? 0) > 0;
  if (hasRefereeReward) {
    const reward = formatMoney(Number(offer.referee_reward), currency);
    return sender
      ? `${sender} invited you to Rhemito — Get ${reward} bonus credit on your first transfer!`
      : `Join me on Rhemito — Get ${reward} bonus credit on your first transfer!`;
  }
  return sender ? `${sender} invited you to Rhemito` : "Join me on Rhemito";
}

/**
 * Builds the full British marketing message explaining the welcome offer and
 * why the friend should register and complete their first qualifying transfer on Rhemito.
 */
export function buildReferralShareMessage(options: ReferralShareMessageOptions = {}): string {
  const { offer, code, link, includeUrl = false } = options;
  const cleanCode = String(code || offer?.referral_code || "").trim().toUpperCase();
  const cleanLink = String(link || offer?.referral_link || "").trim();
  const currency = offer?.currency || "GBP";
  const hasRefereeReward = Boolean(offer && offer.reward_type !== "REFERRER" && Number(offer.referee_reward ?? 0) > 0);
  const reward = hasRefereeReward ? formatMoney(Number(offer!.referee_reward), currency) : null;
  const floor = offer?.floor ? formatMoney(Number(offer.floor), currency) : formatMoney(100, currency);
  const windowDays = Number(offer?.qualification_window_days || offer?.bonus_validity_days || 90);
  const corridorTo = offer?.receive_currency ? ` to ${offer.receive_currency}` : "";

  const headline =
    hasRefereeReward && reward
      ? cleanCode
        ? `Join me on Rhemito with code ${cleanCode}! Get ${reward} on your first ${currency} transfer above ${floor}${corridorTo}.`
        : `Join me on Rhemito! Get ${reward} on your first ${currency} transfer above ${floor}${corridorTo}.`
      : cleanCode
        ? `Join me on Rhemito with my invite code ${cleanCode} for fast, low-cost international money transfers!`
        : "Join me on Rhemito for fast, low-cost international money transfers!";

  const whyLines = [
    "Why register & send with Rhemito:",
    "• Great exchange rates & low, transparent fees across global corridors",
    "• Fast, secure transfers straight to bank accounts, mobile wallets & cash pick-up",
    hasRefereeReward && reward
      ? `• ${reward} welcome bonus credit unlocked when you send ${floor}+${corridorTo} within ${windowDays} days`
      : "• Trusted UK money transfer service with rewards on qualifying transfers",
  ];

  const stepLines =
    hasRefereeReward && reward
      ? [
          `How to claim your ${reward} bonus in 3 simple steps:`,
          `1. Register free using my invite link${cleanCode ? ` (code: ${cleanCode})` : ""}`,
          "2. Verify your account in minutes",
          `3. Send ${floor} or more${corridorTo} within ${windowDays} days — your ${reward} bonus credit is added automatically!`,
        ]
      : [
          "How to get started in 3 simple steps:",
          `1. Register free using my invite link${cleanCode ? ` (code: ${cleanCode})` : ""}`,
          "2. Verify your account in minutes",
          `3. Enjoy fast, secure transfers${corridorTo} at great rates`,
        ];

  const blocks = [headline, whyLines.join("\n"), stepLines.join("\n")];
  if (includeUrl && cleanLink) {
    blocks.push(`Claim your welcome offer here:\n${cleanLink}`);
  } else {
    blocks.push("Claim your welcome offer here:");
  }
  return blocks.join("\n\n");
}
