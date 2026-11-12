/**
 * Rewards routes — Refer & Earn, bonus wallet and referral sign-up for the
 * Rhemito customer app. All data comes from the Mito Admin referral engine
 * through rewardsService.ts. Errors use the { error: { code, message } } shape.
 */

import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { fromMinorUnits } from "@shared/money";
import { demoModeEnabled, serverConfig } from "./config";
import {
  RewardsError,
  applyBonus,
  currencyForCountry,
  formatOfferNoticeMessage,
  sendCurrenciesForCountry,
  isOfferPollerStarted,
  mito,
  syncCustomer,
  startOfferPoller,
} from "./rewardsService";
import { registerReferralOpenGraphRoutes } from "./referralOpenGraph";

function currentUserId(req: Request): string {
  const userId = req.session?.userId;
  if (userId) return userId;
  // Same prototype policy as Send Money: the seeded demo user stands in for an
  // anonymous dashboard visitor in demo mode.
  if (demoModeEnabled) return "user_123";
  throw new RewardsError(401, "UNAUTHENTICATED", "Please sign in to continue.");
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof RewardsError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error("[rewardsRoutes] unexpected error:", err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } });
}

export function registerRewardsRoutes(app: Express): void {
  startOfferPoller();
  registerReferralOpenGraphRoutes(app);

  /**
   * Everything the Dashboard and Bonus & Discounts page need in one call:
   * the live offer (with the customer's link), all offers across the send
   * currencies applicable for the customer's registered location (e.g. GBP, USD, EUR for UK),
   * wallet, referrals and the latest offer announcements for the banner.
   */
  app.get("/api/rewards/summary", async (req: Request, res: Response) => {
    try {
      const userId = currentUserId(req);
      const customer = await syncCustomer(userId);
      const user = await storage.getAuthUserById(userId);
      const sendCurrencies = sendCurrenciesForCountry(user?.country);
      const currency = String(req.query.currency ?? currencyForCountry(user?.country)).toUpperCase();
      const id = encodeURIComponent(userId);
      const [offer, wallet, referrals, notices] = await Promise.all([
        mito(`/api/referral/offer?customer_id=${id}`),
        mito(`/api/wallet/${id}`),
        mito(`/api/referral/referrals?referrer_id=${id}`),
        mito(`/api/referral/offer-notifications?currency=${encodeURIComponent(currency)}`),
      ]);

      const publicBase = serverConfig.publicBaseUrl.replace(/\/+$/, "");
      const referralCode = customer?.referral_code ?? offer.offer?.referral_code ?? null;
      const KNOWN_CODE_CURRENCIES = ["GBP", "USD", "EUR", "NGN", "INR", "JPY", "CNY", "AUD", "CAD", "ZAR", "KES", "GHS", "AED"];
      const currencyReferralCode = (base: string | null | undefined, cur: string | null | undefined) => {
        const raw = String(base || "").trim().toUpperCase();
        const c = String(cur || "").trim().toUpperCase();
        if (!raw) return "";
        if (!c) return raw;
        for (const sfx of KNOWN_CODE_CURRENCIES) {
          if (raw.length >= 9 && raw.endsWith(sfx)) {
            return `${raw.slice(0, -sfx.length)}${c}`;
          }
        }
        return `${raw}${c}`;
      };
      const attachLink = (o: any, forceCurrencyCode = false) => {
        if (!o) return o;
        const base = o.referral_code ?? referralCode;
        const code = forceCurrencyCode && base && o.currency ? currencyReferralCode(base, o.currency) : base;
        if (code) {
          o.referral_code = code;
          o.referral_link = `${publicBase}/ref/${code}`;
        }
        return o;
      };

      if (offer.offer?.referral_code) {
        offer.offer.referral_link = `${publicBase}/ref/${offer.offer.referral_code}`;
      }

      let currencyOffers: any[] = Array.isArray(offer.currency_offers) && offer.currency_offers.length > 0
        ? offer.currency_offers.map((o: any) => attachLink({ ...o }))
        : offer.offer
          ? [attachLink({ ...offer.offer })]
          : [];

      let allNotices: any[] = [...((notices.data as any[]) ?? [])];

      // If the upstream engine did not return currency_offers yet, query the other applicable send currencies in live runtime
      if (!Array.isArray(offer.currency_offers) && isOfferPollerStarted()) {
        const extraCurrencies = sendCurrencies.filter((c) => c !== currency);
        const extraResults = await Promise.all(
          extraCurrencies.map(async (cur) => {
            try {
              const [oRes, nRes] = await Promise.all([
                mito(`/api/referral/offer?currency=${encodeURIComponent(cur)}`),
                mito(`/api/referral/offer-notifications?currency=${encodeURIComponent(cur)}`),
              ]);
              const list = Array.isArray(oRes.offers) && oRes.offers.length > 0
                ? oRes.offers
                : oRes.offer
                  ? [oRes.offer]
                  : [];
              return { offers: list.map((x: any) => attachLink({ ...x })), notices: (nRes.data as any[]) ?? [] };
            } catch {
              return { offers: [], notices: [] };
            }
          }),
        );
        for (const r of extraResults) {
          for (const o of r.offers) {
            if (!currencyOffers.some((existing) => existing.rule_id === o.rule_id && existing.currency === o.currency)) {
              currencyOffers.push(o);
            }
          }
          for (const n of r.notices) {
            if (!allNotices.some((existing) => existing.id === n.id)) {
              allNotices.push(n);
            }
          }
        }
      }

      if (currencyOffers.length > 1) {
        currencyOffers = currencyOffers.map((o) => attachLink({ ...o }, true));
        if (offer.offer) {
          attachLink(offer.offer, true);
        }
      }

      const weekAgo = Date.now() - 7 * 86_400_000;
      const recentNotices = allNotices
        .filter((n) => n.kind !== "ENDING" && new Date(n.created_at).getTime() >= weekAgo && (!n.currency || sendCurrencies.includes(String(n.currency).toUpperCase())))
        .sort((a, b) => Number(b.id) - Number(a.id));
      const latest = recentNotices[0] ?? null;
      const primaryOffer = offer.offer ?? currencyOffers[0] ?? null;

      // Ensure each currency's REFERRAL credit group and unused credit carries its rule's floor and receive_currency (corridor)
      if (wallet && Array.isArray(wallet.balances)) {
        for (const bal of wallet.balances) {
          const ruleOffer = currencyOffers.find((o) => o.currency === bal.currency) ?? (primaryOffer?.currency === bal.currency ? primaryOffer : null);
          if (ruleOffer && Array.isArray(bal.by_source)) {
            for (const src of bal.by_source) {
              if (src.credit_source === "REFERRAL") {
                if (!src.floor && ruleOffer.floor) src.floor = ruleOffer.floor;
                if (src.receive_currency === undefined) src.receive_currency = ruleOffer.receive_currency ?? null;
              }
            }
          }
        }
      }
      if (wallet && Array.isArray(wallet.unused)) {
        for (const cred of wallet.unused) {
          if (cred.credit_source === "REFERRAL") {
            const ruleOffer = currencyOffers.find((o) => o.currency === cred.currency) ?? (primaryOffer?.currency === cred.currency ? primaryOffer : null);
            if (ruleOffer) {
              if (!cred.floor && ruleOffer.floor) cred.floor = ruleOffer.floor;
              if (cred.receive_currency === undefined) cred.receive_currency = ruleOffer.receive_currency ?? null;
            }
          }
        }
      }

      const referralRows: any[] = Array.isArray(referrals.data) ? [...referrals.data] : [];
      const referralSummary: { joined: number; earned_count: number; total_earned: Record<string, number> } = {
        joined: Number(referrals.summary?.joined ?? referralRows.length),
        earned_count: Number(referrals.summary?.earned_count ?? 0),
        total_earned: { ...(referrals.summary?.total_earned ?? {}) },
      };

      // Sync check: if wallet.history has an EARNED referrer referral reward missing from referrals.data, synthesize it so History and My referrals are always in sync
      if (wallet && Array.isArray(wallet.history)) {
        for (const h of wallet.history) {
          const isReferrerEarned =
            h.type === "EARNED" &&
            (h.credit_source === "REFERRAL" || h.reason_code === "REFERRAL_REWARD") &&
            h.credit_source_detail !== "REFEREE" &&
            !/invited by/i.test(String(h.notes ?? ""));
          if (!isReferrerEarned) continue;
          const m = String(h.notes ?? "").match(/referred\s+([A-Za-z][A-Za-z0-9 .'-]*?)\.?$/i);
          const friendName = m?.[1]?.trim() ? `${m[1].trim().replace(/\.+$/, "")}.` : "Friend";
          const alreadyListed = referralRows.some(
            (r) =>
              (h.referral_id && r.id === h.referral_id) ||
              (String(r.friend || "").replace(/\.+$/, "").toLowerCase() === friendName.replace(/\.+$/, "").toLowerCase() && r.status === "REWARDED"),
          );
          if (!alreadyListed) {
            const cur = String(h.currency || currency).toUpperCase();
            const amt = Math.abs(Number(h.amount || 0));
            const ruleOffer = currencyOffers.find((o) => o.currency === cur) ?? primaryOffer;
            referralRows.push({
              id: h.referral_id || `sync_${h.id}`,
              friend: friendName,
              joined_on: h.created_at,
              status: "REWARDED",
              status_label: "Earned",
              currency: cur,
              floor: ruleOffer?.floor ?? 50,
              qualification_deadline: null,
              reward: amt,
              credited: amt,
            });
            referralSummary.joined += 1;
            referralSummary.earned_count += 1;
            referralSummary.total_earned[cur] = Number(((referralSummary.total_earned[cur] ?? 0) + amt).toFixed(2));
          }
        }
      }

      res.json({
        data: {
          customer: customer ? { id: customer.id, referralCode: customer.referral_code, currency: customer.send_currency } : null,
          currency,
          sendCurrencies,
          offer: primaryOffer,
          offers: currencyOffers,
          wallet,
          referrals: { data: referralRows, summary: referralSummary },
          latestOffer: primaryOffer && latest
            ? { id: latest.id, kind: latest.kind, title: latest.title, message: formatOfferNoticeMessage(latest.message, latest.kind), currency: latest.currency, createdAt: latest.created_at }
            : null,
          latestOffers: primaryOffer
            ? recentNotices.map((n) => ({ id: n.id, kind: n.kind, title: n.title, message: formatOfferNoticeMessage(n.message, n.kind), currency: n.currency, createdAt: n.created_at }))
            : [],
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  /** Validate a referral code from a link or the sign-up form (public). */
  app.get("/api/rewards/codes/:code", async (req: Request, res: Response) => {
    try {
      const code = String(req.params.code ?? "").trim().toUpperCase();
      const ruleId = req.query.rule_id && /^\d+$/.test(String(req.query.rule_id)) ? Number(req.query.rule_id) : undefined;
      const result = await mito(`/api/referral/codes/${encodeURIComponent(code)}${ruleId ? `?rule_id=${ruleId}` : ""}`);
      const sendCurrencies: string[] = Array.isArray(result.send_currencies) && result.send_currencies.length > 0
        ? result.send_currencies
        : ["GBP", "USD", "EUR"];
      let currencyOffers: any[] = Array.isArray(result.currency_offers) && result.currency_offers.length > 0
        ? result.currency_offers
        : result.offer
          ? [result.offer]
          : [];
      if (!ruleId && !Array.isArray(result.currency_offers) && isOfferPollerStarted()) {
        for (const cur of sendCurrencies) {
          if (currencyOffers.some((o) => o.currency === cur)) continue;
          try {
            const extra = await mito(`/api/referral/offer?currency=${encodeURIComponent(cur)}`);
            const list = Array.isArray(extra.offers) && extra.offers.length > 0 ? extra.offers : extra.offer ? [extra.offer] : [];
            for (const o of list) currencyOffers.push(o);
          } catch {
            // ignore
          }
        }
      }
      const lockedCurrency = result.currency ? String(result.currency).toUpperCase() : null;
      const lockedOffer = ruleId
        ? (currencyOffers.find((o) => Number(o.rule_id) === ruleId) ?? result.offer ?? null)
        : lockedCurrency
          ? (currencyOffers.find((o) => o.currency === lockedCurrency) ?? result.offer ?? null)
          : null;
      const effectiveRuleId = ruleId ?? (lockedCurrency && lockedOffer?.rule_id ? Number(lockedOffer.rule_id) : undefined);
      res.json({
        data: {
          code: result.code,
          referrerFirstName: result.referrer_first_name,
          ...(effectiveRuleId ? { ruleId: effectiveRuleId } : {}),
          offer: lockedOffer ?? result.offer ?? currencyOffers[0] ?? null,
          offers: lockedOffer ? [lockedOffer] : currencyOffers,
          sendCurrencies: lockedOffer ? [lockedOffer.currency] : sendCurrencies,
          signedIn: Boolean(req.session?.userId),
        },
      });
    } catch (err) {
      if (err instanceof RewardsError && err.details) {
        res.status(err.status).json({ error: { code: err.code, message: String(err.details.message ?? err.message) } });
        return;
      }
      handleError(res, err);
    }
  });

  /** Public / session-aware offers available to existing customers who click a referral link. */
  app.get("/api/rewards/existing-user-offers", async (req: Request, res: Response) => {
    try {
      const sessionUserId = req.session?.userId;
      const emailParam = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : "";
      const user = sessionUserId
        ? await storage.getAuthUserById(sessionUserId)
        : emailParam
          ? await storage.getAuthUserByEmail(emailParam)
          : undefined;
      const currency = String(
        req.query.currency ?? (user?.country ? currencyForCountry(user.country) : "GBP"),
      )
        .trim()
        .toUpperCase();

      const publicBase = serverConfig.publicBaseUrl.replace(/\/+$/, "");
      let viewerReferralCode: string | null = null;
      let viewerReferralLink: string | null = null;

      if (sessionUserId) {
        try {
          const synced = await syncCustomer(sessionUserId);
          viewerReferralCode = synced?.referral_code ?? null;
          if (viewerReferralCode) {
            viewerReferralLink = `${publicBase}/ref/${viewerReferralCode}`;
          }
        } catch {
          // non-blocking
        }
      }

      const [referralRes, bonusRes] = await Promise.all([
        mito(`/api/referral/offer?currency=${encodeURIComponent(currency)}${sessionUserId ? `&customer_id=${encodeURIComponent(sessionUserId)}` : ""}`).catch(
          (): Record<string, any> => ({}),
        ),
        mito(`/api/bonus/offers?currency=${encodeURIComponent(currency)}`).catch(
          (): Record<string, any> => ({}),
        ),
      ]);

      const referralOffer = referralRes?.offer ?? (Array.isArray(referralRes?.offers) ? referralRes.offers[0] : null) ?? null;
      const referralOffers = Array.isArray(referralRes?.currency_offers) && referralRes.currency_offers.length > 0
        ? referralRes.currency_offers
        : Array.isArray(referralRes?.offers)
          ? referralRes.offers
          : referralOffer
            ? [referralOffer]
            : [];

      if (!viewerReferralCode && referralOffer?.referral_code && sessionUserId) {
        viewerReferralCode = referralOffer.referral_code;
        viewerReferralLink = `${publicBase}/ref/${viewerReferralCode}`;
      }

      const rawBonusOffers = Array.isArray(bonusRes)
        ? bonusRes
        : Array.isArray(bonusRes?.data)
          ? bonusRes.data
          : [];

      res.json({
        data: {
          signedIn: Boolean(sessionUserId),
          currency,
          viewerFirstName: user?.firstName ?? null,
          viewerReferralCode,
          viewerReferralLink,
          referralOffer,
          referralOffers,
          bonusOffers: rawBonusOffers,
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  /** Count a referral link visit (public; repeat visits within 24h count once). */
  app.post("/api/rewards/visits", async (req: Request, res: Response) => {
    try {
      const code = String(req.body?.code ?? "").trim().toUpperCase();
      const visitorId = String(req.body?.visitorId ?? "anonymous").slice(0, 64);
      const ruleId = req.body?.ruleId && Number.isInteger(Number(req.body.ruleId)) && Number(req.body.ruleId) > 0 ? Number(req.body.ruleId) : undefined;
      const deviceType = req.body?.deviceType ? String(req.body.deviceType) : undefined;
      const operatingSystem = req.body?.operatingSystem ? String(req.body.operatingSystem) : undefined;
      const sourceChannel = req.body?.sourceChannel ? String(req.body.sourceChannel) : undefined;
      const storeTarget = req.body?.storeTarget ? String(req.body.storeTarget) : undefined;
      const uaHeader = typeof req.headers["user-agent"] === "string" ? { "User-Agent": req.headers["user-agent"] } : undefined;
      const result = await mito("/api/referral/visits", {
        method: "POST",
        headers: uaHeader,
        body: {
          code,
          visitor_id: visitorId,
          ...(ruleId ? { rule_id: ruleId } : {}),
          ...(deviceType ? { device_type: deviceType } : {}),
          ...(operatingSystem ? { operating_system: operatingSystem } : {}),
          ...(sourceChannel ? { source_channel: sourceChannel } : {}),
          ...(storeTarget ? { store_target: storeTarget } : {}),
        },
      });
      res.json({
        data: {
          counted: Boolean(result.counted),
          trackingId: result.trackingId ?? result.tracking_id ?? null,
          deviceType: result.deviceType ?? result.device_type ?? null,
          operatingSystem: result.operatingSystem ?? result.operating_system ?? null,
          status: result.status ?? "CLICKED",
          playStoreUrl: result.playStoreUrl ?? result.play_store_url ?? null,
          appStoreUrl: result.appStoreUrl ?? result.app_store_url ?? null,
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  /** Verified Android App Links (FR-03 / Section 4). */
  app.get("/.well-known/assetlinks.json", (_req: Request, res: Response) => {
    res.json([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: process.env.RHEMITO_ANDROID_PACKAGE_ID ?? "com.funtechcom.rhemito",
          sha256_cert_fingerprints: [
            process.env.RHEMITO_ANDROID_SHA256_FINGERPRINT ??
              "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C",
          ],
        },
      },
    ]);
  });

  /** Verified Apple Universal Links for iOS (FR-07 / Section 5). */
  app.get(["/.well-known/apple-app-site-association", "/apple-app-site-association"], (_req: Request, res: Response) => {
    const appId = process.env.RHEMITO_IOS_APP_ID ?? "TEAMID1234.com.funtechcom.rhemito";
    res.json({
      applinks: {
        apps: [],
        details: [
          {
            appID: appId,
            paths: ["/ref/*", "/refer/*"],
          },
        ],
      },
    });
  });

  /** FR-02 / Section 9.2: Record referral click and generate trackingId. */
  app.post(["/api/v1/referrals/clicks", "/api/rewards/clicks"], async (req: Request, res: Response) => {
    try {
      const code = String(req.body?.referralCode ?? req.body?.code ?? "").trim().toUpperCase();
      const visitorId = String(req.body?.visitorId ?? req.body?.visitor_id ?? "anonymous").slice(0, 64);
      const ruleId = req.body?.ruleId && Number.isInteger(Number(req.body.ruleId)) && Number(req.body.ruleId) > 0 ? Number(req.body.ruleId) : undefined;
      const uaHeader = typeof req.headers["user-agent"] === "string" ? { "User-Agent": req.headers["user-agent"] } : undefined;
      const result = await mito("/api/referral/clicks", {
        method: "POST",
        headers: uaHeader,
        body: {
          code,
          visitor_id: visitorId,
          ...(ruleId ? { rule_id: ruleId } : {}),
          device_type: req.body?.deviceType ?? req.body?.device_type,
          operating_system: req.body?.operatingSystem ?? req.body?.operating_system,
          source_channel: req.body?.sourceChannel ?? req.body?.source_channel ?? "LINK",
          store_target: req.body?.storeTarget ?? req.body?.store_target,
        },
      });
      res.status(201).json({ data: result, ...result });
    } catch (err) {
      handleError(res, err);
    }
  });

  /** Record store redirect / handoff (Android Google Play, iOS Option A/B, or Web). */
  app.post(["/api/v1/referrals/clicks/:trackingId/handoff", "/api/rewards/clicks/:trackingId/handoff"], async (req: Request, res: Response) => {
    try {
      const trackingId = encodeURIComponent(String(req.params.trackingId ?? "").trim().toUpperCase());
      const result = await mito(`/api/referral/clicks/${trackingId}/handoff`, {
        method: "POST",
        body: {
          store_target: req.body?.storeTarget ?? req.body?.store_target,
          attribution_status: req.body?.status ?? req.body?.attribution_status,
          operating_system: req.body?.operatingSystem ?? req.body?.operating_system,
        },
      });
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  /** FR-05 / Section 9.3: Resolve Android Play Install Referrer trackingId or Universal Link context. */
  app.post(["/api/v1/referrals/resolve", "/api/rewards/resolve"], async (req: Request, res: Response) => {
    try {
      const result = await mito("/api/referral/resolve", {
        method: "POST",
        body: {
          trackingId: req.body?.trackingId ?? req.body?.tracking_id,
          referrer: req.body?.referrer,
          channel: req.body?.channel ?? "ANDROID",
        },
      });
      res.json({ data: result, ...result });
    } catch (err) {
      handleError(res, err);
    }
  });

  /** FR-06 / Section 9.4: Validate manual referral code. */
  app.post(["/api/v1/referrals/validate", "/api/rewards/validate"], async (req: Request, res: Response) => {
    try {
      const result = await mito("/api/referral/validate", {
        method: "POST",
        body: {
          referralCode: req.body?.referralCode ?? req.body?.code,
          currency: req.body?.currency,
          receive_currency: req.body?.receiveCurrency ?? req.body?.receive_currency,
        },
      });
      res.json({ data: result, ...result });
    } catch (err) {
      handleError(res, err);
    }
  });

  /** Section 9.1: Get current customer's referral code, URL, and referrals. */
  app.get("/api/v1/referrals/me", async (req: Request, res: Response) => {
    try {
      const userId = currentUserId(req);
      const customer = await syncCustomer(userId);
      const id = encodeURIComponent(userId);
      const [offer, referrals] = await Promise.all([
        mito(`/api/referral/offer?customer_id=${id}`),
        mito(`/api/referral/referrals?referrer_id=${id}`),
      ]);
      const publicBase = serverConfig.publicBaseUrl.replace(/\/+$/, "");
      const referralCode = customer?.referral_code ?? offer.offer?.referral_code ?? null;
      res.json({
        data: {
          customerId: userId,
          referralCode,
          referralUrl: referralCode ? `${publicBase}/refer/${referralCode}` : null,
          shortReferralUrl: referralCode ? `${publicBase}/ref/${referralCode}` : null,
          offer: offer.offer ?? null,
          referrals: referrals.data ?? [],
          summary: referrals.summary ?? { joined: 0, earned_count: 0, total_earned: {} },
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  /** Section 9.5: Associate referee registration with referrer (for mobile app or direct API callers). */
  app.post("/api/v1/referrals/registrations", async (req: Request, res: Response) => {
    try {
      const result = await mito("/api/v1/referrals/registrations", {
        method: "POST",
        body: req.body ?? {},
      });
      res.status(201).json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  /** Section 9.6: Get referral details by ID. */
  app.get("/api/v1/referrals/:referralId", async (req: Request, res: Response) => {
    try {
      const id = encodeURIComponent(String(req.params.referralId ?? ""));
      const result = await mito(`/api/v1/referrals/${id}`);
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  /** Use bonus credit on a Send Money transaction (Pay less / Send more). */
  app.post("/api/rewards/apply", async (req: Request, res: Response) => {
    try {
      const userId = currentUserId(req);
      const { transactionId, amount, mode } = req.body ?? {};
      if (!transactionId || !(Number(amount) > 0) || !["pay_less", "send_more"].includes(mode)) {
        throw new RewardsError(400, "VALIDATION_ERROR", "Choose how to use your bonus and try again.");
      }
      const tx = await storage.getSendMoneyTransactionById(String(transactionId));
      if (!tx || tx.ownerId !== userId) throw new RewardsError(404, "NOT_FOUND", "Transaction not found.");
      const result = await applyBonus(userId, {
        amount: Number(amount),
        currency: tx.sendCurrency,
        ...(process.env.NODE_ENV !== "test" && tx.receiveCurrency ? { receiveCurrency: tx.receiveCurrency } : {}),
        transferId: tx.reference,
        sendAmount: Number(fromMinorUnits(tx.sendAmountMinor, tx.sendCurrency)),
      });
      res.json({ data: { applied: result.applied, available: result.available, mode } });
    } catch (err) {
      handleError(res, err);
    }
  });
}
