/**
 * FURP `/api/v1/Account/Rewards*` wire-contract mirror (Layer 1).
 *
 * Exposes the exact endpoints `furp02-core` serves (`RewardCustomerCommands.cs`, `RewardAccountController`)
 * and answers with FURP's `Result<T>` envelope:
 *
 *   { succeeded: boolean, code: number, message: string, data: T }
 *
 * so that the Rhemito-web (Next.js) rewards pages can be pointed at this prototype server
 * (`apiUrl = http://localhost:5000/api/v1/`) and later at `furp02-staging` / `furp02-pre-pord`
 * with ZERO frontend edits.
 *
 * Additive only: nothing here changes an existing `/api/rewards/*`, `/api/promocodes/*` or
 * `/api/v1/referrals/*` route. All data comes from the same Mito Admin referral engine through
 * rewardsService.ts / promo/client.ts.
 */

import type { Express, Request, Response } from "express";
import { demoModeEnabled } from "./config";
import {
  MITO_API_URL,
  RewardsError,
  currencyForCountry,
  mito,
  syncCustomer,
} from "./rewardsService";
import { callMito, promoEnabled, validatePromo } from "./promo/client";
import { storage } from "./storage";

type Json = Record<string, any>;

// ─── Result<T> envelope ──────────────────────────────────────────────────────

interface FurpResult<T> {
  succeeded: boolean;
  code: number;
  message: string;
  data: T | null;
}

function succeed<T>(res: Response, data: T, message = "Success"): void {
  const body: FurpResult<T> = { succeeded: true, code: 200, message, data };
  res.status(200).json(body);
}

function fail(res: Response, message: string, code = 400): void {
  const body: FurpResult<null> = { succeeded: false, code, message, data: null };
  res.status(code).json(body);
}

/** Translate any thrown error into a Result.Fail so the wire contract never leaks `{ error: {...} }`. */
function failFrom(res: Response, err: unknown, fallback = "Something went wrong. Please try again."): void {
  if (err instanceof RewardsError) {
    const detailMsg = err.details && typeof err.details.message === "string" ? err.details.message : undefined;
    fail(res, detailMsg ?? err.message ?? fallback, err.status >= 400 ? err.status : 400);
    return;
  }
  console.error("[furpV1CompatRoutes] unexpected error:", err);
  fail(res, fallback, 500);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const UNAVAILABLE = "Rewards are unavailable right now. Please try again shortly.";
const CODE_RE = /^[A-Z0-9-]{3,32}$/;
const PROMO_RE = /^[A-Z0-9-]{1,20}$/;

function sessionUserId(req: Request): string | undefined {
  return req.session?.userId ?? (demoModeEnabled ? "user_123" : undefined);
}

function normaliseCode(raw: unknown): string | null {
  const code = String(raw ?? "").trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

const cur = (v: unknown): string | undefined => {
  const s = String(v ?? "").trim().toUpperCase().slice(0, 3);
  return s.length === 3 ? s : undefined;
};

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const money = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

/** `shareUrl` is always built from the request origin so Staging shares Staging links and Live shares Live links. */
function shareUrlFor(req: Request, code: string | null | undefined): string | null {
  if (!code) return null;
  return `${req.protocol}://${req.get("host")}/ref/${code}`;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export function registerFurpV1CompatRoutes(app: Express): void {
  /**
   * RewardCatalogueDto — everything the `/rewards` hub needs in one call.
   * GET /api/v1/Account/Rewards?currency=GBP
   */
  app.get("/api/v1/Account/Rewards", async (req: Request, res: Response) => {
    try {
      const userId = sessionUserId(req);
      if (!userId) return fail(res, "Please sign in to continue.", 401);

      const customer = await syncCustomer(userId);
      const user = await storage.getAuthUserById(userId);
      const currency = (cur(req.query.currency) ?? currencyForCountry(user?.country)).toUpperCase();
      const id = encodeURIComponent(userId);

      const [offerRes, wallet, referralsRes, savingsRes] = await Promise.all([
        mito(`/api/referral/offer?customer_id=${id}`),
        mito(`/api/wallet/${id}`),
        mito(`/api/referral/referrals?referrer_id=${id}`),
        promoEnabled()
          ? callMito(`/api/promocodes/customers/${id}/redemptions`, { method: "GET" })
          : Promise.resolve({ ok: false, status: 404, body: {} as Json }),
      ]);

      const referralCode: string | null =
        customer?.referral_code ?? offerRes.offer?.referral_code ?? null;

      // Offers for the requested currency first; keep every corridor offer for the switcher.
      const currencyOffers: Json[] =
        Array.isArray(offerRes.currency_offers) && offerRes.currency_offers.length > 0
          ? offerRes.currency_offers
          : offerRes.offers ?? (offerRes.offer ? [offerRes.offer] : []);
      const offer: Json | null =
        offerRes.offer ??
        currencyOffers.find((o) => String(o.currency).toUpperCase() === currency) ??
        currencyOffers[0] ??
        null;

      const balance: Json =
        (Array.isArray(wallet.balances) ? wallet.balances : []).find(
          (b: Json) => String(b.currency).toUpperCase() === currency,
        ) ?? {};

      // promoSavings counts REDEEMED rows only (never HELD / RELEASED). Engine casing differs (Redeemed / REDEEMED).
      const savingsRows: Json[] = savingsRes.ok && Array.isArray(savingsRes.body.data) ? savingsRes.body.data : [];
      const promoSavings = money(
        savingsRows
          .filter(
            (r) =>
              String(r.status ?? "").toUpperCase() === "REDEEMED" &&
              String(r.currency ?? currency).toUpperCase() === currency,
          )
          .reduce((sum, r) => sum + Number(r.discount ?? r.discount_amount ?? 0), 0),
      );

      const kinds: string[] = [];
      if (offer || referralCode) kinds.push("REFERRAL");
      if (String(process.env.BONUS_ENABLED ?? "true").toLowerCase() !== "false") kinds.push("BONUS");
      if (promoEnabled()) kinds.push("PROMO");

      const onCurrency = (row: Json) => !row.currency || String(row.currency).toUpperCase() === currency;

      succeed(res, {
        enabled: kinds.length > 0,
        kinds,
        balanceCurrency: currency,
        availableBalance: money(balance.available),
        earnedTotal: money(balance.earned),
        usedTotal: money(balance.used),
        expiredTotal: money(balance.expired),
        promoSavings,
        referralCode,
        shareUrl: shareUrlFor(req, referralCode),
        offer,
        currencyOffers,
        referrals: {
          data: Array.isArray(referralsRes.data) ? referralsRes.data : [],
          summary: referralsRes.summary ?? { joined: 0, earned_count: 0, total_earned: {} },
        },
        history: (Array.isArray(wallet.history) ? wallet.history : []).filter(onCurrency),
        unusedCredits: (Array.isArray(wallet.unused) ? wallet.unused : []).filter(onCurrency),
        bySource: Array.isArray(balance.by_source) ? balance.by_source : [],
        bonusBlocked: Boolean(wallet.bonus_blocked),
        outstandingDebt: money(balance.outstanding_debt),
      });
    } catch (err) {
      failFrom(res, err, UNAVAILABLE);
    }
  });

  /**
   * ReferralCodeCheckDto (anonymous). GET /api/v1/Account/Rewards/Code/:code?currency=GBP
   */
  app.get("/api/v1/Account/Rewards/Code/:code", async (req: Request, res: Response) => {
    try {
      const code = normaliseCode(req.params.code);
      if (!code) return fail(res, "Referral codes are 3–32 letters, numbers and dashes.");

      const currency = cur(req.query.currency) ?? "GBP";
      const receive = cur(req.query.receiveCurrency ?? req.query.receive_currency ?? req.query.to);
      const ruleId = req.query.ruleId ?? req.query.rule_id;
      const qs =
        `?currency=${encodeURIComponent(currency)}` +
        (receive ? `&receive_currency=${encodeURIComponent(receive)}` : "") +
        (ruleId && /^\d+$/.test(String(ruleId)) ? `&rule_id=${Number(ruleId)}` : "");

      let result: Json;
      try {
        result = await mito(`/api/referral/codes/${encodeURIComponent(code)}${qs}`);
      } catch (err) {
        if (err instanceof RewardsError && err.status < 500) {
          const hint = String(err.details?.error ?? err.code ?? "");
          if (/REFERRER_INACTIVE/i.test(hint) || /inactive|no longer active/i.test(err.message)) {
            return fail(res, "This referral link is no longer active. You can still sign up.", 404);
          }
          const msg =
            typeof err.details?.message === "string"
              ? err.details.message
              : "We couldn't find this referral code. Check it or leave the field blank.";
          return fail(res, msg, err.status);
        }
        throw err;
      }

      const offer: Json | null = result.offer ?? (Array.isArray(result.offers) ? result.offers[0] : null) ?? null;
      succeed(res, {
        valid: result.valid === undefined ? true : Boolean(result.valid),
        code: result.code ?? code,
        referrerFirstName: result.referrer_first_name ?? null,
        offerText: offer?.text ?? null,
        refereeReward: money(offer?.referee_reward),
        referrerReward: money(offer?.referrer_reward),
        minimumAmount: money(offer?.floor),
        windowDays: Math.trunc(Number(offer?.qualification_window_days ?? 0)) || 0,
        currency: offer?.currency ?? currency,
        receiveCurrency: offer?.receive_currency ?? receive ?? null,
        ruleId: result.rule_id ?? offer?.rule_id ?? null,
      });
    } catch (err) {
      failFrom(res, err, UNAVAILABLE);
    }
  });

  /**
   * Record a referral link visit (anonymous). Never fails the page: unknown codes / engine outages answer tracked=false.
   * POST /api/v1/Account/Rewards/Visit  { code, visitorId, receiveCurrency, ruleId? }
   */
  app.post("/api/v1/Account/Rewards/Visit", async (req: Request, res: Response) => {
    const code = normaliseCode(req.body?.code);
    const untracked = () =>
      succeed(res, { tracked: false, trackingId: null, playStoreUrl: null, appStoreUrl: null });
    if (!code) return untracked();
    try {
      const visitorId = String(req.body?.visitorId ?? req.body?.visitor_id ?? "anonymous").trim().slice(0, 64) || "anonymous";
      const receive = cur(req.body?.receiveCurrency ?? req.body?.receive_currency);
      const ruleId =
        req.body?.ruleId && Number.isInteger(Number(req.body.ruleId)) && Number(req.body.ruleId) > 0
          ? Number(req.body.ruleId)
          : undefined;
      const uaHeader =
        typeof req.headers["user-agent"] === "string" ? { "User-Agent": req.headers["user-agent"] } : undefined;
      const result = await mito("/api/referral/visits", {
        method: "POST",
        headers: uaHeader,
        body: {
          code,
          visitor_id: visitorId,
          ...(receive ? { receive_currency: receive } : {}),
          ...(ruleId ? { rule_id: ruleId } : {}),
          ...(req.body?.deviceType ? { device_type: String(req.body.deviceType) } : {}),
          ...(req.body?.operatingSystem ? { operating_system: String(req.body.operatingSystem) } : {}),
          ...(req.body?.sourceChannel ? { source_channel: String(req.body.sourceChannel) } : {}),
          ...(req.body?.storeTarget ? { store_target: String(req.body.storeTarget) } : {}),
        },
      });
      succeed(res, {
        tracked: true,
        trackingId: result.trackingId ?? result.tracking_id ?? null,
        playStoreUrl: result.playStoreUrl ?? result.play_store_url ?? null,
        appStoreUrl: result.appStoreUrl ?? result.app_store_url ?? null,
      });
    } catch (err) {
      console.error("[furpV1CompatRoutes] visit not recorded:", err instanceof Error ? err.message : err);
      untracked();
    }
  });

  /**
   * Link the signed-in customer to a referrer after login (existing customer / mobile hand-off).
   * POST /api/v1/Account/Rewards/Link  { code, trackingId?, receiveCurrency?, ruleId? }
   */
  app.post("/api/v1/Account/Rewards/Link", async (req: Request, res: Response) => {
    try {
      const code = normaliseCode(req.body?.code);
      if (!code) return fail(res, "Referral codes are 3–32 letters, numbers and dashes.");
      const userId = sessionUserId(req);
      if (!userId) return fail(res, "Please sign in to continue.", 401);

      const user = await storage.getAuthUserById(userId);
      if (!user) return fail(res, "Please sign in to continue.", 401);
      await syncCustomer(userId);

      const trackingId = req.body?.trackingId ? String(req.body.trackingId).trim().toUpperCase() : undefined;
      const receive = cur(req.body?.receiveCurrency ?? req.body?.receive_currency);
      const ruleId =
        req.body?.ruleId && Number.isInteger(Number(req.body.ruleId)) && Number(req.body.ruleId) > 0
          ? Number(req.body.ruleId)
          : undefined;
      const sendCurrency = currencyForCountry(user.country);

      const linked = await mito("/api/referral/referrals", {
        method: "POST",
        body: {
          code,
          referee_id: userId,
          customer_id: userId,
          ...(trackingId ? { tracking_id: trackingId } : {}),
          ...(ruleId ? { rule_id: ruleId } : {}),
          registration_channel: "WEB",
          referee: {
            id: userId,
            send_currency: sendCurrency,
            ...(receive ? { receive_currency: receive } : {}),
          },
        },
      });

      const status: string = linked.data?.status ?? "REGISTERED";
      succeed(res, status, "Referral linked.");
    } catch (err) {
      failFrom(res, err, "We couldn't use this referral code.");
    }
  });

  /**
   * PromoCheckDto. POST /api/v1/Account/Rewards/Promo/Validate
   * { code, amount, fee, currency, receiveCurrency, paymentMethod }
   */
  app.post("/api/v1/Account/Rewards/Promo/Validate", async (req: Request, res: Response) => {
    try {
      if (!promoEnabled()) return fail(res, "Promo codes are not switched on for this site.", 404);
      const code = String(req.body?.code ?? "").trim().toUpperCase();
      if (!code) return fail(res, "Enter a promo code.");
      if (!PROMO_RE.test(code)) return fail(res, "Enter a valid promo code.");
      const amount = num(req.body?.amount);
      const fee = num(req.body?.fee);
      if (amount === undefined || !(amount > 0) || (fee !== undefined && fee < 0)) {
        return fail(res, "Enter the amount you're sending first.");
      }

      const currency = cur(req.body?.currency) ?? "GBP";
      const receive = cur(req.body?.receiveCurrency ?? req.body?.receive_currency);
      const userId = sessionUserId(req);
      if (userId) void syncCustomer(userId).catch(() => {});

      const result = await validatePromo({
        code,
        amount,
        fee,
        currency,
        userId,
        sourceCurrency: currency,
        destCurrency: receive,
        paymentMethod: req.body?.paymentMethod ? String(req.body.paymentMethod) : undefined,
      });
      if (!result.ok) {
        return fail(res, result.error ?? "This promo code isn't valid. Check it and try again.", result.status >= 400 ? result.status : 400);
      }
      const body = result.body;
      if (body.valid !== undefined && !body.valid) {
        return fail(res, String(body.message ?? "This promo code isn't valid. Check it and try again."));
      }

      let discount = money(body.appliedDiscount ?? body.applied_discount ?? body.discount);
      if (amount > 0 && discount > amount) discount = amount;
      if (discount <= 0) return fail(res, "This promo code isn't valid for this transfer.");

      const basis = String(body.discount_basis ?? body.discountBasis ?? "PAYABLE").trim().toUpperCase();
      const customerChoice = basis === "VALUE" || Boolean(body.customer_choice ?? body.customerChoice);
      succeed(res, {
        valid: true,
        discount,
        displayText:
          body.displayText ??
          body.display_text ??
          (customerChoice
            ? `${currency} ${discount.toFixed(2)} of the send amount. Pay less, or add it to what they receive.`
            : `You save ${currency} ${discount.toFixed(2)} on the fee`),
        discountBasis: basis,
        customerChoice,
      });
    } catch (err) {
      failFrom(res, err, "Failed to validate promo code");
    }
  });

  /**
   * Live schema / API sync manifest for developers: which SQL tables and endpoints this wire contract mirrors.
   * GET /api/v1/Account/Rewards/SyncManifest
   */
  app.get("/api/v1/Account/Rewards/SyncManifest", async (_req: Request, res: Response) => {
    let engineReachable = false;
    try {
      await mito("/api/referral/offer-notifications");
      engineReachable = true;
    } catch {
      engineReachable = false;
    }
    succeed(res, {
      generatedAt: new Date().toISOString(),
      source: { repo: "furp02-core", staging: "Staging (Pipeline 33)", live: "pri_prod (Pipelines 99 + 49)" },
      engine: { baseUrl: MITO_API_URL, reachable: engineReachable, promoEnabled: promoEnabled() },
      sql: {
        rewardTables: [
          "dbo.RewardCustomer",
          "dbo.RewardCreditLedger",
          "dbo.RewardBonusBlock",
          "dbo.RewardBonusStrike",
          "dbo.RewardReferralRule",
          "dbo.RewardReferral",
          "dbo.RewardBonusScheme",
          "dbo.RewardPromoCode",
          "dbo.RewardPromoRedemption",
          "dbo.RewardUserSegment",
          "dbo.RewardTransferFact",
          "dbo.RewardFeed",
          "dbo.RewardRateAuditLog",
        ],
        newTables: ["dbo.RewardReferralVisit"],
        furpCoreTables: [
          "dbo.Transaction",
          "dbo.RetailTransaction",
          "dbo.Journey",
          "dbo.LookUpApplication",
          "dbo.AffiliateAllowedService",
          "dbo.User",
          "dbo.DiscountCode",
        ],
        additiveChanges: [
          "dbo.RewardCreditLedger.Floor DECIMAL(18,2) NULL",
          "dbo.RewardCreditLedger.ReceiveCurrency CHAR(3) NULL",
          "dbo.RewardTransferFact.PaymentMethod NVARCHAR(50) NULL",
          "UX_RewardPromoRedemption_Code_Transfer_Redeemed (filtered unique)",
          "IX_RewardPromoRedemption_CodeStatusUser",
        ],
        migration: "furp02-core/Database/Migrations/UpgradeRewardEngineStagingSync.sql",
      },
      endpoints: [
        { method: "GET", path: "/api/v1/Account/Rewards", auth: true, engine: ["GET /api/referral/offer", "GET /api/wallet/:id", "GET /api/referral/referrals", "GET /api/promocodes/customers/:id/redemptions"], dto: "RewardCatalogueDto" },
        { method: "GET", path: "/api/v1/Account/Rewards/Code/:code", auth: false, engine: ["GET /api/referral/codes/:code"], dto: "ReferralCodeCheckDto" },
        { method: "POST", path: "/api/v1/Account/Rewards/Visit", auth: false, engine: ["POST /api/referral/visits"], dto: "{ tracked, trackingId, playStoreUrl, appStoreUrl }" },
        { method: "POST", path: "/api/v1/Account/Rewards/Link", auth: true, engine: ["POST /api/referral/referrals"], dto: "string (referral status)" },
        { method: "POST", path: "/api/v1/Account/Rewards/Promo/Validate", auth: false, engine: ["POST /api/promocodes/validate"], dto: "PromoCheckDto" },
        { method: "GET", path: "/api/v1/Account/Rewards/SyncManifest", auth: false, engine: [], dto: "this document" },
      ],
      envelope: "{ succeeded: boolean, code: number, message: string, data: T }",
    });
  });
}
