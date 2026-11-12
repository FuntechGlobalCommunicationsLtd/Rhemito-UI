/**
 * Rewards service — Rhemito side of the Referral & Bonus programme.
 *
 * The referral rules, referrals and bonus wallet live in the Mito Admin
 * referral engine (Mito Admin repo: server/referral.js). This module is the
 * only place that talks to it: it keeps the customer record in sync, reports
 * transfer events, and turns the engine's results into Rhemito notifications.
 *
 * Configure the engine address with MITO_API_URL (default http://localhost:5050).
 */

import { storage } from "./storage";
import { dispatchNotification } from "./notificationService";
import { deviceForUser } from "./deviceId";
import type { NotificationEventType } from "@shared/schema";

export const MITO_API_URL = (process.env.MITO_API_URL ?? "http://localhost:5050").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.MITO_API_TIMEOUT_MS ?? 4000);

export class RewardsError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Country (ISO alpha-2) → default send currency for the supported corridors. */
export const COUNTRY_CURRENCY: Record<string, string> = {
  GB: "GBP", UK: "GBP", US: "USD", NG: "NGN", CA: "CAD", GH: "GHS", KE: "KES", ZA: "ZAR",
  DE: "EUR", FR: "EUR", IN: "INR", CN: "CNY", AE: "AED", AU: "AUD", JP: "JPY",
};

export function currencyForCountry(country: string | null | undefined): string {
  return COUNTRY_CURRENCY[String(country ?? "").toUpperCase()] ?? "GBP";
}

/** Country (ISO alpha-2) → all send currencies applicable to the location the customer registered from. */
export const COUNTRY_SEND_CURRENCIES: Record<string, string[]> = {
  GB: ["GBP", "USD", "EUR"],
  UK: ["GBP", "USD", "EUR"],
  DE: ["EUR", "GBP", "USD"],
  FR: ["EUR", "GBP", "USD"],
  US: ["USD", "GBP", "EUR"],
  CA: ["CAD", "USD", "GBP"],
  NG: ["NGN", "GBP", "USD"],
  GH: ["GHS", "GBP", "USD"],
  KE: ["KES", "GBP", "USD"],
  ZA: ["ZAR", "GBP", "USD"],
  IN: ["INR", "GBP", "USD"],
  CN: ["CNY", "USD", "GBP"],
  AE: ["AED", "USD", "GBP"],
  AU: ["AUD", "USD", "GBP"],
  JP: ["JPY", "USD", "GBP"],
};

export function sendCurrenciesForCountry(country: string | null | undefined): string[] {
  const code = String(country ?? "").toUpperCase();
  const primary = currencyForCountry(country);
  const list = COUNTRY_SEND_CURRENCIES[code] ?? [primary, "GBP", "USD", "EUR"];
  return [primary, ...list.filter((c) => c !== primary)];
}

type Json = Record<string, any>;

/** Call the Mito Admin referral engine. Network failures become 503 REWARDS_UNAVAILABLE. */
export async function mito(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Json> {
  let res: globalThis.Response;
  try {
    const reqHeaders: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.body !== undefined) reqHeaders["Content-Type"] = "application/json";
    res = await fetch(`${MITO_API_URL}${path}`, {
      method: init.method ?? "GET",
      headers: Object.keys(reqHeaders).length > 0 ? reqHeaders : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new RewardsError(503, "REWARDS_UNAVAILABLE", "Rewards are unavailable right now. Please try again shortly.");
  }
  const data = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) {
    throw new RewardsError(res.status, String(data.error ?? "REWARDS_ERROR"), String(data.message ?? "Something went wrong with rewards. Please try again."), data);
  }
  return data;
}

/** Push the Rhemito customer's details to the engine (names, currency, KYC, status). */
export async function syncCustomer(userId: string): Promise<Json | null> {
  const user = await storage.getAuthUserById(userId);
  if (!user) return null;
  const phone = user.mobileNumber ? `${user.mobileCode ?? ""}${user.mobileNumber}` : null;
  const result = await mito("/api/referral/customers", {
    method: "POST",
    body: {
      id: user.id,
      first_name: user.firstName ?? user.businessName ?? null,
      last_name: user.lastName ?? null,
      email: user.email,
      phone,
      country: user.country,
      send_currency: currencyForCountry(user.country),
      kyc_status: user.kycStatus === "passed" ? "PASSED" : "PENDING",
      account_status: user.status === "blocked" ? "SUSPENDED" : "ACTIVE",
      // Hashed device ID for the self-referral check; omitted when unknown so the engine keeps its last value
      device_id: deviceForUser(user.id) ?? undefined,
    },
  });
  return result.data ?? null;
}

const fmtMoney = (amount: number, currency: string) => {
  const symbols: Record<string, string> = { GBP: "£", USD: "$", EUR: "€", NGN: "₦", INR: "₹", JPY: "¥", CNY: "¥", AUD: "A$", CAD: "C$", ZAR: "R", KES: "KSh ", GHS: "GH₵", AED: "AED " };
  const dp = currency === "JPY" ? 0 : 2;
  return `${symbols[currency] ?? `${currency} `}${Number(amount).toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
};
/** The bonus feed (server/bonus) announces scheme awards and bonus use; the old notifications stand down when it is on (B-14). */
const bonusFeedOn = () => String(process.env.BONUS_ENABLED ?? "true").toLowerCase() !== "false";
const maskName = (first?: string | null, last?: string | null) => `${first || "Your friend"}${last ? ` ${last.trim()[0].toUpperCase()}.` : ""}`;
const ukDate = (ymd?: string | null) => (ymd ? ymd.slice(0, 10).split("-").reverse().join("/") : "");

async function notify(userId: string, type: NotificationEventType, data: Record<string, unknown>): Promise<void> {
  try {
    await dispatchNotification({ userId, type, data });
  } catch (err) {
    console.error("[rewards] notification failed:", err);
  }
}

// Rewarded referrals already announced (the engine is idempotent; this keeps the bell clean)
const announcedRewards = new Set<string>();
const announcedRefereeRewards = new Set<string>();

/** Waits (ms) between attempts to record a referral that Mito could not take yet. Env override: comma-separated list. */
const referralRetryDelays = (): number[] =>
  (process.env.REFERRAL_RETRY_DELAYS_MS ?? "10000,30000,120000,300000,900000")
    .split(",").map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0);

/** Mito asleep, unreachable or failing is worth another try; a refusal (bad code, etc.) is not. */
const isTemporary = (err: unknown) => err instanceof RewardsError && err.status >= 500;

export interface ReferralAttributionMeta {
  trackingId?: string | null;
  channel?: string | null;
  attributionMethod?: string | null;
}

async function recordReferral(
  userId: string,
  referralCode: string,
  referralRuleId?: number | null,
  attributionMeta?: ReferralAttributionMeta | null,
): Promise<Json> {
  if (offerPollerStarted) await syncAdminCrudSnapshot();
  const user = await storage.getAuthUserById(userId);
  const ruleId = referralRuleId && Number.isInteger(Number(referralRuleId)) && Number(referralRuleId) > 0 ? Number(referralRuleId) : undefined;
  const trackingId = attributionMeta?.trackingId ? String(attributionMeta.trackingId).trim().toUpperCase() : undefined;
  const channel = attributionMeta?.channel ? String(attributionMeta.channel).trim().toUpperCase() : undefined;
  const attributionMethod = attributionMeta?.attributionMethod ? String(attributionMeta.attributionMethod).trim().toUpperCase() : undefined;
  const res = await mito("/api/referral/referrals", {
    method: "POST",
    body: {
      code: referralCode,
      ...(ruleId ? { rule_id: ruleId } : {}),
      ...(trackingId ? { tracking_id: trackingId } : {}),
      ...(channel ? { registration_channel: channel } : {}),
      ...(attributionMethod ? { attribution_method: attributionMethod } : {}),
      referee: { id: userId, send_currency: currencyForCountry(user?.country) },
    },
  });
  const referral = res.data as Json;
  if (referral?.status === "REGISTERED") {
    await notify(referral.referrer_id, "reward_friend_joined", {
      friendName: maskName(user?.firstName, user?.lastName),
      reward: referral.reward_type === "REFEREE" ? "" : fmtMoney(referral.referrer_reward, referral.currency),
      floor: fmtMoney(referral.floor, referral.currency),
    });
    if (Number(referral.referee_credited) > 0) {
      announcedRefereeRewards.add(referral.id);
      await notify(userId, "reward_earned", {
        amount: fmtMoney(referral.referee_credited, referral.currency),
        message: "Welcome bonus unlocked!",
        expires: expiryFor(referral),
      });
    }
  }
  return referral;
}

/** Try again later (the engine may be waking up). Gives up after the last delay and says so in the log. */
function scheduleReferralRetry(
  userId: string,
  referralCode: string,
  attempt: number,
  referralRuleId?: number | null,
  attributionMeta?: ReferralAttributionMeta | null,
): void {
  const delays = referralRetryDelays();
  if (attempt >= delays.length) {
    console.error(`[rewards] giving up recording the referral for ${userId} (${referralCode}) after ${attempt} retries`);
    return;
  }
  const timer = setTimeout(async () => {
    try {
      await syncCustomer(userId);
      await recordReferral(userId, referralCode, referralRuleId, attributionMeta);
    } catch (err) {
      console.error("[rewards] referral retry failed:", err instanceof Error ? err.message : err);
      if (isTemporary(err)) scheduleReferralRetry(userId, referralCode, attempt + 1, referralRuleId, attributionMeta);
    }
  }, delays[attempt]);
  timer.unref?.();
}

/**
 * Called when a new customer verifies their email. Creates the referral when a
 * code was given and tells the Referrer their friend joined (AC-3.1.5, AC-4.5.3).
 * If Mito cannot be reached it is retried in the background, so a sleeping engine does not lose the referral.
 */
export async function onCustomerVerified(
  userId: string,
  referralCode?: string | null,
  referralRuleId?: number | null,
  attributionMeta?: ReferralAttributionMeta | null,
): Promise<Json | null> {
  try {
    await syncCustomer(userId);
    if (!referralCode) return null;
    return await recordReferral(userId, referralCode, referralRuleId, attributionMeta);
  } catch (err) {
    console.error("[rewards] could not record referral:", err instanceof Error ? err.message : err);
    if (referralCode && isTemporary(err)) scheduleReferralRetry(userId, referralCode, 0, referralRuleId, attributionMeta);
    return null;
  }
}

/** Report a Send Money transaction status change to the engine (US-4.1, US-4.4). */
export async function onTransferEvent(
  userId: string,
  tx: { reference: string; sendAmount: number; sendCurrency: string; receiveCurrency?: string; createdAt: Date | string },
  status: "PAID" | "COMPLETED" | "CANCELLED" | "FAILED" | "REFUNDED",
): Promise<void> {
  try {
    await syncCustomer(userId);
    const res = await mito("/api/referral/transfer-events", {
      method: "POST",
      body: {
        transfer_id: tx.reference,
        customer_id: userId,
        amount: tx.sendAmount,
        currency: tx.sendCurrency,
        // The referral rule can be tied to a corridor (send → receive currency), so the engine needs to know where the money went
        receive_currency: tx.receiveCurrency,
        status,
        created_at: new Date(tx.createdAt).toISOString(),
      },
    });
    const referral = res.referral as Json | null;
    if (referral?.status === "REWARDED" && !announcedRewards.has(referral.id)) {
      announcedRewards.add(referral.id);
      const referee = await storage.getAuthUserById(referral.referee_id);
      const validUntil = expiryFor(referral);
      if (referral.referrer_credited > 0) {
        await notify(referral.referrer_id, "reward_earned", {
          amount: fmtMoney(referral.referrer_credited, referral.currency),
          message: `${maskName(referee?.firstName, referee?.lastName)} completed their first transfer.`,
          expires: validUntil,
        });
      }
      if (referral.referee_credited > 0 && !announcedRefereeRewards.has(referral.id)) {
        announcedRefereeRewards.add(referral.id);
        await notify(referral.referee_id, "reward_earned", {
          amount: fmtMoney(referral.referee_credited, referral.currency),
          message: "Welcome bonus unlocked!",
          expires: validUntil,
        });
      }
    }
  } catch (err) {
    console.error("[rewards] transfer event not recorded:", err instanceof Error ? err.message : err);
  }
}

/**
 * Report a paid money request to the engine so a Request Money bonus scheme can reward the requester.
 * Completed Send Money transfers need no separate call: the transfer event above also drives loyalty and threshold schemes.
 * Never throws – a bonus problem must not affect the payment itself.
 */
export async function onMoneyRequestPaid(
  requesterId: string,
  request: { requestNumber: string; amount: number | string; currency: string },
): Promise<void> {
  try {
    await syncCustomer(requesterId);
    const res = await mito("/api/bonus/events", {
      method: "POST",
      body: {
        type: "MONEY_REQUEST_PAID",
        customer_id: requesterId,
        event_id: request.requestNumber,
        amount: Number(request.amount),
        currency: request.currency,
      },
    });
    for (const award of (res.awards as Json[]) ?? []) {
      if (award.status !== "AWARDED" || bonusFeedOn()) continue;
      await notify(requesterId, "reward_earned", {
        amount: fmtMoney(award.amount, award.currency),
        message: `Bonus earned: ${award.scheme_name}.`,
        expires: ukDate(`${award.expires_at}T12:00:00Z`),
      });
    }
  } catch (err) {
    console.error("[rewards] money request bonus not recorded:", err instanceof Error ? err.message : err);
  }
}

/**
 * Tell the engine a paid money request was refunded so it removes the unused part of the bonus that request earned.
 * Never throws – a bonus problem must not affect the refund itself.
 */
export async function onMoneyRequestRefunded(requesterId: string, requestNumber: string): Promise<void> {
  try {
    await mito("/api/bonus/events", {
      method: "POST",
      body: { type: "MONEY_REQUEST_REFUNDED", customer_id: requesterId, event_id: requestNumber },
    });
  } catch (err) {
    console.error("[rewards] money request refund not recorded:", err instanceof Error ? err.message : err);
  }
}

/** Expiry date (DD/MM/YYYY, UK time) of a credit issued today for the referral's validity. */
function expiryFor(referral: Json): string {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(referral.bonus_validity_days ?? 90));
  return ukDate(d.toISOString());
}

/** Use bonus credit on a transfer (US-5.2, US-5.3). */
export async function applyBonus(userId: string, input: { amount: number; currency: string; receiveCurrency?: string; transferId: string; sendAmount: number }): Promise<Json> {
  await syncCustomer(userId);
  const result = await mito(`/api/wallet/${encodeURIComponent(userId)}/apply`, {
    method: "POST",
    body: {
      amount: input.amount,
      currency: input.currency,
      ...(input.receiveCurrency ? { receive_currency: input.receiveCurrency } : {}),
      transfer_id: input.transferId,
      send_amount: input.sendAmount,
    },
  });
  if (!bonusFeedOn()) await notify(userId, "reward_bonus_used", { amount: fmtMoney(input.amount, input.currency), txnId: input.transferId });
  return result;
}

// ─── Offer notifications (US-6.1) ────────────────────────────────────────────

let lastOfferNotificationId = 0;
let offerPollerStarted = false;
const cachedReferralRules = new Map<number, Json>();

/** Snapshot Mito Admin CRUD rules and auto-restore if a cold container restart reverts an updated rule. */
export async function syncAdminCrudSnapshot(): Promise<void> {
  try {
    const res = await mito("/api/referral-rules?include_archived=1");
    const rules = (res.data as Json[]) ?? [];
    const seenIds = new Set<number>();
    for (const rule of rules) {
      const id = Number(rule.id);
      if (!id) continue;
      seenIds.add(id);
      const prev = cachedReferralRules.get(id);
      if (prev && prev.updated_at && rule.updated_at && String(rule.updated_at) < String(prev.updated_at)) {
        if (prev.is_archived && !rule.is_archived) {
          await mito(`/api/referral-rules/${id}`, { method: "DELETE" });
        } else {
          await mito(`/api/referral-rules/${id}`, { method: "PUT", body: { ...prev, notify: false } });
        }
      } else {
        cachedReferralRules.set(id, rule);
      }
    }
    for (const [id, prev] of Array.from(cachedReferralRules.entries())) {
      if (!seenIds.has(id) && !prev.is_archived) {
        const created = await mito("/api/referral-rules", { method: "POST", body: { ...prev, notify: false } });
        cachedReferralRules.delete(id);
        if (created?.data?.id) cachedReferralRules.set(Number(created.data.id), created.data);
      }
    }
  } catch {
    // Engine offline: try again on the next tick
  }
}

/** Formats LIVE referral offer announcement copy to match approved Rhemito wording. */
export function formatOfferNoticeMessage(message: unknown, kind?: unknown): string {
  const raw = String(message ?? "").trim();
  const k = kind ? String(kind).toUpperCase() : "";
  if (!raw || (k && k !== "LIVE")) return raw;

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

/** Fan out new offer notifications from the engine to customers in that currency. */
export async function pollOfferNotifications(): Promise<number> {
  let delivered = 0;
  try {
    const res = await mito("/api/referral/offer-notifications");
    const items = ((res.data as Json[]) ?? []).filter((n) => Number(n.id) > lastOfferNotificationId).sort((a, b) => a.id - b.id);
    if (!items.length) return 0;
    const users = await storage.listAuthUsers();
    for (const n of items) {
      lastOfferNotificationId = Math.max(lastOfferNotificationId, Number(n.id));
      for (const u of users) {
        if (u.status !== "active" || !sendCurrenciesForCountry(u.country).includes(String(n.currency).toUpperCase())) continue;
        await notify(u.id, "reward_offer", { title: n.title, message: formatOfferNoticeMessage(n.message, n.kind), offerId: n.id });
        delivered++;
      }
    }
  } catch {
    // Engine offline: try again on the next tick
  }
  return delivered;
}

export function isOfferPollerStarted(): boolean {
  return offerPollerStarted;
}

export function startOfferPoller(): void {
  if (offerPollerStarted || process.env.NODE_ENV === "test") return;
  offerPollerStarted = true;
  // Skip notifications that already existed before this server started
  mito("/api/referral/offer-notifications")
    .then((res) => {
      const ids = ((res.data as Json[]) ?? []).map((n) => Number(n.id));
      lastOfferNotificationId = ids.length ? Math.max(...ids) : 0;
    })
    .catch(() => {})
    .finally(() => {
      void syncAdminCrudSnapshot();
      setInterval(() => {
        void pollOfferNotifications();
        void syncAdminCrudSnapshot();
      }, 60_000).unref();
    });
}

/** Test hook. */
export function __resetRewardsState(): void {
  announcedRewards.clear();
  announcedRefereeRewards.clear();
  cachedReferralRules.clear();
  lastOfferNotificationId = 0;
}

export { fmtMoney, maskName, ukDate };
