/**
 * Request Money routes — authenticated requester APIs, public payer APIs and
 * the signed provider webhook boundary.
 *
 * Requester endpoints use STRICT authentication: no demo-user fallback.
 * Unauthenticated callers receive 401.
 */

import type { Express, Request, Response } from "express";
import { randomInt, randomUUID } from "crypto";
import QRCode from "qrcode";
import { storage } from "./storage";
import { serverConfig, demoModeEnabled } from "./config";
import { rateLimit, clientIpOf } from "./rateLimit";
import { CORRIDORS, corridorsForRequester, findCorridor } from "./corridors";
import { computeQuote, toRequestJSON } from "./requestService";
import {
  checkEligibility,
  createMoneyRequest,
  createPayinIntent,
  releasePayinIntent,
  cancelRequest,
  extendExpiry,
  resendRequestEmail,
  getRequestByToken,
  getRequestByTokenOrEmailToken,
  toPublicRequestJSON,
  markViewed,
  effectiveStatus,
  startPayerSession,
  requestNewPaymentLink,
  processPayinWebhook,
  processPayoutWebhook,
  processMailjetWebhookEvents,
  startRequestSweep,
  RequestError,
  isKnownSenderEmail,
  markSenderEmailKnown,
  getPayerSavedAccounts,
  savePayerBankAccountForEmail,
  ALREADY_PAID_MESSAGE,
  PAYMENT_IN_PROGRESS_MESSAGE,
} from "./requestService";
import { devEmailProvider, listRecentMailjetWebhookEvents } from "./providers";
import { getFxRate } from "./fxService";
import { FxError } from "./fxService";
import { toMinorUnits, fromMinorUnits, maskAccountNumber, senderPaysMinorOf } from "@shared/money";
import {
  addPayoutAccountSchema,
  createMoneyRequestSchema,
  createPayinIntentSchema,
  emailCheckSchema,
  DEMO_PAYER_CREDENTIALS,
} from "@shared/schema";
import bcrypt from "bcryptjs";

function requireStrictAuth(req: Request): string {
  const userId = req.session?.userId;
  if (userId) return userId;
  // Dashboard demo experience: in prototype demo mode the seeded demo
  // requester stands in for an anonymous dashboard visitor, so payout-account
  // and request flows work without a sign-in prompt. The public payer
  // endpoints (payment session, pay-intent) check the session directly and
  // stay strictly authenticated.
  if (demoModeEnabled) {
    return "user_123";
  }
  throw new RequestError(401, "UNAUTHENTICATED", "Please sign in to continue.");
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof RequestError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof FxError) {
    res.status(503).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error("[requestRoutes] unexpected error:", err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } });
}

function enforceRateLimit(req: Request, res: Response, name: keyof typeof serverConfig.rateLimits): boolean {
  const { limit, windowMs } = serverConfig.rateLimits[name];
  const result = rateLimit(`${name}:${clientIpOf(req)}`, limit, windowMs);
  if (!result.allowed) {
    res.setHeader("Retry-After", Math.ceil(result.retryAfterMs / 1000));
    res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many attempts. Please slow down and try again shortly." } });
    return false;
  }
  return true;
}

export function registerRequestMoneyRoutes(app: Express): void {
  // Security headers for the public checkout document and APIs (token-bearing pages).
  app.use(["/pay", "/r"], (_req, res, next) => {
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex");
    next();
  });

  // ─── Eligibility & corridors (authenticated) ────────────────────────────────

  app.get("/api/request-money/eligibility", async (req, res) => {
    try {
      const userId = requireStrictAuth(req);
      res.json({ data: await checkEligibility(userId) });
    } catch (err) {
      return handleError(res, err);
    }
  });

  app.get("/api/request-money/corridors", async (req, res) => {
    try {
      const userId = requireStrictAuth(req);
      const user = await storage.getAuthUserById(userId);
      const country = user?.country ?? "";
      const list = (corridorsForRequester(country) ?? []).map((c) => ({
        id: c.id,
        senderCountry: c.senderCountry,
        requesterCountry: c.requesterCountry,
        payInCurrency: c.payInCurrency,
        payoutCurrency: c.payoutCurrency,
        methods: c.methods,
        minAmountMinor: c.minAmountMinor,
        maxAmountMinor: c.maxAmountMinor,
        estimatedDeliveryTime: c.estimatedDeliveryTime,
        enabled: c.enabled,
        unavailabilityReason: c.unavailabilityReason ?? null,
        // Development corridor configuration — not production approval.
        devOnly: true,
      }));
      res.json({ data: list });
    } catch (err) {
      return handleError(res, err);
    }
  });

  app.get("/api/request-money/quote", async (req, res) => {
    try {
      const userId = requireStrictAuth(req);
      void userId;
      const corridor = findCorridor(String(req.query.corridorId ?? ""));
      if (!corridor || !corridor.enabled) {
        return res.status(400).json({ error: { code: "CORRIDOR_UNAVAILABLE", message: "Select a supported corridor." } });
      }
      let amountMinor: number;
      try {
        amountMinor = toMinorUnits(String(req.query.amount ?? ""), corridor.payInCurrency);
      } catch {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Enter a valid amount." } });
      }
      const absorbFee = String(req.query.absorbFee ?? "true") !== "false";
      const quote = await computeQuote(corridor, amountMinor, absorbFee);
      res.json({
        data: {
          feeRate: serverConfig.feeRate,
          fxMarkup: serverConfig.fxMarkup,
          indicative: true,
          ...quote,
        },
      });
    } catch (err) {
      return handleError(res, err);
    }
  });

  // ─── Payout accounts (verified, server-owned) ───────────────────────────────

  app.get("/api/request-money/payout-accounts", async (req, res) => {
    try {
      const userId = requireStrictAuth(req);
      const accounts = await storage.listPayoutAccountsByOwner(userId);
      res.json({
        data: accounts.map((a) => ({
          id: a.id,
          holderName: a.holderName,
          country: a.country,
          bankName: a.bankName,
          maskedNumber: maskAccountNumber(a.accountNumber),
          currency: a.currency,
          verificationStatus: a.verificationStatus,
          isDefault: a.isDefault,
        })),
      });
    } catch (err) {
      return handleError(res, err);
    }
  });

  app.post("/api/request-money/payout-accounts", async (req, res) => {
    try {
      const userId = requireStrictAuth(req);
      let user = await storage.getAuthUserById(userId);
      if (!user) {
        user = await storage.getAuthUserById("user_123");
      }
      if (!user) throw new RequestError(401, "UNAUTHENTICATED", "Sign in to continue.");

      const parsed = addPayoutAccountSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid account details." } });
      }

      const holderName =
        user.accountType === "business"
          ? user.businessName ?? parsed.data.holderName ?? user.email
          : [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" ") || parsed.data.holderName || user.email;

      const accounts = await storage.listPayoutAccountsByOwner(userId);
      const account = {
        id: randomUUID(),
        ownerId: userId,
        holderName,
        country: parsed.data.country,
        bankName: parsed.data.bankName,
        accountNumber: parsed.data.accountNumber,
        routingNumber: parsed.data.routingNumber ?? null,
        currency: parsed.data.currency,
        verificationStatus: "verified",
        isDefault: accounts.length === 0,
        createdAt: new Date(),
        verifiedAt: new Date(),
      };
      await storage.createPayoutAccount(account);

      res.status(201).json({
        data: {
          id: account.id,
          maskedNumber: maskAccountNumber(account.accountNumber),
          verificationStatus: account.verificationStatus,
        },
      });
    } catch (err) {
      return handleError(res, err);
    }
  });

  // ─── Requests (authenticated) ───────────────────────────────────────────────

  app.post("/api/request-money/requests", async (req, res) => {
    try {
      const userId = requireStrictAuth(req);
      const parsed = createMoneyRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request." } });
      }
      const result = await createMoneyRequest({ userId, payload: parsed.data });
      res.status(result.alreadyExisted ? 200 : 201).json({
        data: {
          request: toRequestJSON(result.request),
          checkoutUrl: result.checkoutUrl,
          emailCheckoutUrl: result.emailCheckoutUrl,
          qrUrl: `/api/request-money/requests/${result.request.id}/qr.png`,
          alreadyExisted: result.alreadyExisted,
        },
      });
    } catch (err) {
      return handleError(res, err);
    }
  });

  app.get("/api/request-money/requests", async (req, res) => {
    try {
      const userId = requireStrictAuth(req);
      const list = await storage.listMoneyRequests(userId);
      res.json({ data: list.map(toRequestJSON), meta: { total: list.length } });
    } catch (err) {
      return handleError(res, err);
    }
  });

  app.get("/api/request-money/requests/:id", async (req, res) => {
    try {
      const userId = requireStrictAuth(req);
      const request = await storage.getMoneyRequestById(req.params.id);
      if (!request || request.requesterId !== userId) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Request not found." } });
      }
      const [ledger, emails] = await Promise.all([
        storage.listLedgerEntries(request.id),
        storage.listEmailDeliveries(request.id),
      ]);
      res.json({
        data: {
          ...toRequestJSON(request),
          ledger: ledger.map((e) => ({
            type: e.type,
            account: e.account,
            direction: e.direction,
            amountMinor: e.amountMinor,
            currency: e.currency,
            createdAt: e.createdAt?.toISOString() ?? null,
          })),
          emails: emails.map((e) => ({ state: e.state, lastAttemptAt: e.lastAttemptAt?.toISOString() ?? null })),
        },
      });
    } catch (err) {
      return handleError(res, err);
    }
  });

  app.post("/api/request-money/requests/:id/cancel", async (req, res) => {
    try {
      const userId = requireStrictAuth(req);
      await cancelRequest(userId, req.params.id);
      res.json({ success: true });
    } catch (err) {
      return handleError(res, err);
    }
  });

  app.post("/api/request-money/requests/:id/extend-expiry", async (req, res) => {
    try {
      const userId = requireStrictAuth(req);
      const expiresAt = await extendExpiry(userId, req.params.id);
      res.json({ data: { expiresAt: expiresAt.toISOString() } });
    } catch (err) {
      return handleError(res, err);
    }
  });

  app.post("/api/request-money/requests/:id/resend-email", async (req, res) => {
    try {
      const userId = requireStrictAuth(req);
      const body = (req.body ?? {}) as { email?: unknown; name?: unknown };
      await resendRequestEmail(userId, req.params.id, {
        email: typeof body.email === "string" ? body.email : undefined,
        name: typeof body.name === "string" ? body.name : undefined,
      });
      res.json({ success: true });
    } catch (err) {
      return handleError(res, err);
    }
  });

  // QR code — the ONLY thing encoded is the canonical checkout URL built from
  // the trusted configured base URL (never request headers). ECC level M with
  // the standard quiet zone.
  const qrOptions: QRCode.QRCodeToStringOptions = { errorCorrectionLevel: "M", margin: 4, width: 512 };

  app.get("/api/request-money/requests/:id/qr.png", async (req, res) => {
    try {
      const userId = requireStrictAuth(req);
      const request = await storage.getMoneyRequestById(req.params.id);
      if (!request || request.requesterId !== userId) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Request not found." } });
      }
      const png = await QRCode.toBuffer(`${serverConfig.publicBaseUrl.replace(/\/$/, "")}${serverConfig.checkoutPath}${request.token}`, {
        ...qrOptions,
        type: "png",
      } as QRCode.QRCodeToBufferOptions);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store");
      return res.send(png);
    } catch (err) {
      return handleError(res, err);
    }
  });

  app.get("/api/request-money/requests/:id/qr.svg", async (req, res) => {
    try {
      const userId = requireStrictAuth(req);
      const request = await storage.getMoneyRequestById(req.params.id);
      if (!request || request.requesterId !== userId) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Request not found." } });
      }
      const svg = await QRCode.toString(`${serverConfig.publicBaseUrl.replace(/\/$/, "")}${serverConfig.checkoutPath}${request.token}`, {
        ...qrOptions,
        type: "svg",
      } as QRCode.QRCodeToStringOptions);
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "no-store");
      return res.send(svg);
    } catch (err) {
      return handleError(res, err);
    }
  });

  // ─── Public payer APIs (rate-limited, minimal data) ─────────────────────────

  // 1. Copyable link lookup
  app.get("/api/public/requests/:token", async (req, res) => {
    try {
      if (!enforceRateLimit(req, res, "publicLookup")) return;
      const request = await getRequestByTokenOrEmailToken(req.params.token, false);
      if (!request) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "This payment link is not valid." } });
      }
      markViewed(request);
      const currentUserId = req.session?.userId;
      const currentUser = currentUserId ? await storage.getAuthUserById(currentUserId) : undefined;
      return res.json({ data: toPublicRequestJSON(request, false, currentUserId, currentUser?.email) });
    } catch (err) {
      return handleError(res, err);
    }
  });

  // 2. Email-notification link lookup (displays masked recipient email)
  app.get("/api/public/requests/e/:emailToken", async (req, res) => {
    try {
      if (!enforceRateLimit(req, res, "publicLookup")) return;
      const request = await getRequestByTokenOrEmailToken(req.params.emailToken, true);
      if (!request) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "This payment link is not valid." } });
      }
      markViewed(request);
      const currentUserId = req.session?.userId;
      const currentUser = currentUserId ? await storage.getAuthUserById(currentUserId) : undefined;
      return res.json({ data: toPublicRequestJSON(request, true, currentUserId, currentUser?.email) });
    } catch (err) {
      return handleError(res, err);
    }
  });

  app.get("/api/request-money/requests/:id/payment-attempts", async (req, res) => {
    try {
      const userId = requireStrictAuth(req);
      const request = await storage.getMoneyRequestById(req.params.id);
      if (!request || request.requesterId !== userId) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Request not found." } });
      }
      const submitted = (await storage.listPaymentAttempts(request.id))
        .filter((attempt) => !!attempt.authorisationStartedAt)
        .map((attempt) => ({
          payerName: attempt.payerName,
          payerEmailMasked: attempt.payerEmailMasked,
          status: attempt.status,
          requestedAmount: fromMinorUnits(request.payInAmountMinor, request.payInCurrency),
          requestedCurrency: request.payInCurrency,
          payerPaymentCurrency: attempt.payCurrency,
          payerPaymentAmount: fromMinorUnits(attempt.payAmountMinor, attempt.payCurrency),
          feeAmount: fromMinorUnits(attempt.feeMinor, attempt.payCurrency),
          feeAbsorbedBy: attempt.absorbFee ? "requester" : "payer",
          fxRate: attempt.fxRate ? Number(attempt.fxRate) : null,
          paymentReference: attempt.paymentReference,
          submittedAt: attempt.authorisationStartedAt?.toISOString() ?? null,
          finalStatusAt: attempt.completedAt?.toISOString() ?? null,
        }));
      return res.json({ data: submitted });
    } catch (err) {
      return handleError(res, err);
    }
  });

  const ensurePayerUserSession = async (
    req: Request,
    request: Awaited<ReturnType<typeof getRequestByTokenOrEmailToken>>,
    email: string,
    profile?: {
      accountType?: "individual" | "business";
      firstName?: string;
      lastName?: string;
      businessName?: string;
      gender?: string;
      dateOfBirth?: string;
      address?: string;
      city?: string;
      postcode?: string;
    },
  ) => {
    const normalized = email.trim().toLowerCase();
    let user = await storage.getAuthUserByEmail(normalized);
    const firstName = profile?.firstName?.trim();
    const lastName = profile?.lastName?.trim();
    const businessName = profile?.businessName?.trim();
    const accountType = profile?.accountType === "business" ? "business" : "individual";

    if (!user) {
      const [reqFirst, ...reqRest] = (request?.senderName ?? "").split(" ");
      user = await storage.createAuthUser({
        email: normalized,
        password: bcrypt.hashSync(DEMO_PAYER_CREDENTIALS.password, 12),
        accountType,
        country: request?.senderCountry || (request?.payInCurrency === "GBP" ? "GB" : "NG"),
        firstName: firstName || reqFirst || "Verified",
        middleName: null,
        lastName: lastName || reqRest.join(" ") || "Sender",
        dateOfBirth: profile?.dateOfBirth || null,
        gender: profile?.gender || null,
        mobileCode: null,
        mobileNumber: null,
        businessName: accountType === "business" ? (businessName || request?.senderName || "Business Sender") : null,
        businessRegNo: null,
        businessPhoneCode: null,
        businessPhoneNumber: null,
        directorName: null,
        status: "pending",
      });
    } else if (firstName || lastName || businessName || profile?.dateOfBirth || profile?.gender) {
      // Update placeholder or new sender details when provided
      user.accountType = accountType;
      if (firstName) user.firstName = firstName;
      if (lastName) user.lastName = lastName;
      if (profile?.gender) user.gender = profile.gender;
      if (profile?.dateOfBirth) user.dateOfBirth = profile.dateOfBirth;
      if (accountType === "business" && businessName) {
        user.businessName = businessName;
      }
    }

    await storage.activateUser(normalized);
    const updated = (await storage.getAuthUserByEmail(normalized)) ?? user;
    markSenderEmailKnown(normalized);
    req.session.userId = updated.id;

    const payerName =
      updated.accountType === "business" && updated.businessName
        ? updated.businessName
        : [updated.firstName, updated.middleName, updated.lastName].filter(Boolean).join(" ") || normalized;

    if (
      request
      && ["active", "viewed"].includes(effectiveStatus(request))
      && profile?.dateOfBirth
      && !request.senderDob
    ) {
      await storage.updateMoneyRequest(request.id, {
        senderDob: profile.dateOfBirth,
      });
    }

    return { user: updated, payerName };
  };

  const rejectIfRequestUnavailableForPayer = (
    request: NonNullable<Awaited<ReturnType<typeof getRequestByTokenOrEmailToken>>>,
    res: Response,
    allowReservingUserId?: string,
  ): boolean => {
    const status = effectiveStatus(request);
    if (status === "paid_out" || status === "funded" || status === "payout_pending") {
      res.status(409).json({ error: { code: "ALREADY_PAID", message: ALREADY_PAID_MESSAGE } });
      return true;
    }
    if (["authorisation_in_progress", "payment_processing", "payment_pending"].includes(status)) {
      if (allowReservingUserId && request.payerUserId === allowReservingUserId) {
        return false;
      }
      res.status(409).json({ error: { code: "PAYMENT_IN_PROGRESS", message: PAYMENT_IN_PROGRESS_MESSAGE } });
      return true;
    }
    if (status === "cancelled") {
      res.status(409).json({ error: { code: "CANCELLED", message: "This payment request was cancelled by the requester." } });
      return true;
    }
    if (status === "expired") {
      res.status(410).json({ error: { code: "EXPIRED", message: "This payment request has expired." } });
      return true;
    }
    return false;
  };

  // When a payer pastes or clicks a shared link (/pay/:token), we do not know their
  // email — they must verify ownership of the entered email via a 6-digit OTP/PIN.
  // In no case do we ask for a password or login.
  const handleSendPayerPin = async (req: Request, res: Response, isEmailLink: boolean) => {
    try {
      if (!enforceRateLimit(req, res, "paymentIntent")) return;
      const parsed = emailCheckSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Enter a valid email address." } });
      }
      const token = req.params.token || req.params.emailToken || String(req.body?.token ?? "");
      const request = await getRequestByTokenOrEmailToken(token, isEmailLink);
      if (!request) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "This payment link is not valid." } });
      }
      if (rejectIfRequestUnavailableForPayer(request, res)) {
        return;
      }
      const email = parsed.data.email.toLowerCase();
      const allowRegistered = req.body?.allowRegistered !== false;
      if (!allowRegistered && (await storage.getAuthUserByEmail(email))) {
        return res.status(409).json({ error: { code: "EMAIL_REGISTERED", message: "This email already has a Rhemito account. Please sign in." } });
      }
      const previous = req.session.paymentRequestVerification;
      if (previous?.email === email && Date.now() - previous.lastSentAt < 60_000 && !demoModeEnabled) {
        res.setHeader("Retry-After", Math.ceil((60_000 - (Date.now() - previous.lastSentAt)) / 1000));
        return res.status(429).json({ error: { code: "PIN_COOLDOWN", message: "Please wait before requesting another PIN." } });
      }
      await storage.invalidateOtps(email);
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      await storage.createOtp(email, code, new Date(Date.now() + 30 * 60_000));
      req.session.paymentRequestVerification = {
        email, token, isEmailLink, verified: false, failedAttempts: 0, lastSentAt: Date.now(),
      };
      const isKnownSender = await isKnownSenderEmail(email, request);
      const existingUser = await storage.getAuthUserByEmail(email);
      const knownSenderName = isKnownSender
        ? (request.senderEmail?.toLowerCase() === email && request.senderName)
          || (existingUser ? [existingUser.firstName, existingUser.lastName].filter(Boolean).join(" ") : null)
        : null;

      const amountValue = fromMinorUnits(
        senderPaysMinorOf(request.payInAmountMinor, request.feeMinor, request.absorbFee),
        request.payInCurrency,
      );
      const displayAmount =
        request.payInCurrency === "GBP" ? `£${amountValue}` : `${request.payInCurrency} ${amountValue}`;

      // Send the 6-digit confirmation code via Mailjet (when accessed via shared link /pay/:token)
      const otpCustomId = `otp:${request.id}:${Date.now()}`;
      const otpPayload = JSON.stringify({
        type: "payer_verification_code",
        requestId: request.id,
        requestNumber: request.requestNumber,
        email,
      });
      const otpHtml = `
<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border:2px solid #2563eb;border-radius:16px;overflow:hidden;color:#0f172a;">
  <div style="padding:28px 24px 16px;text-align:center;">
    <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.2em;color:#2563eb;text-transform:uppercase;">Rhemito Payment</p>
    <p style="margin:12px 0 4px;font-size:14px;font-weight:600;color:#334155;">Payment Request From</p>
    <h1 style="margin:0;font-size:22px;font-weight:800;color:#0f172a;">${request.requesterName}</h1>
    <p style="margin:4px 0 0;font-size:12px;color:#64748b;">Ref ${request.requestNumber} · ${displayAmount}</p>
  </div>
  <div style="padding:0 24px 24px;text-align:center;">
    <p style="margin:0 0 12px;font-size:14px;color:#334155;">
      Enter this 6-digit confirmation code to verify your email and continue with your payment:
    </p>
    <div style="margin:16px auto;max-width:240px;background:#eff6ff;border:2px solid #2563eb;border-radius:12px;padding:16px 24px;font-size:32px;font-weight:800;letter-spacing:0.25em;color:#1d4ed8;font-family:monospace;">
      ${code}
    </div>
    <p style="margin:12px 0 0;font-size:12px;color:#64748b;">
      This code expires in 30 minutes.
    </p>
  </div>
  <div style="background:#2563eb;padding:12px;text-align:center;color:#ffffff;font-weight:700;font-size:13px;">
    rhemito
  </div>
</div>`;

      await devEmailProvider.send({
        to: email,
        toName: knownSenderName ?? undefined,
        subject: `${code} is your Rhemito payment confirmation code (${request.requestNumber})`,
        text:
          `Hello ${knownSenderName ?? "there"},\n\n` +
          `Use this 6-digit confirmation code to verify your email for payment request ${request.requestNumber} (${displayAmount}) from ${request.requesterName}:\n\n` +
          `${code}\n\n` +
          `This code expires in 30 minutes.\n\n` +
          `— Rhemito`,
        html: otpHtml,
        customId: otpCustomId,
        eventPayload: otpPayload,
      });

      return res.json({ data: {
        sent: true,
        isKnownSender,
        senderName: knownSenderName,
        savedAccounts: getPayerSavedAccounts(email, request),
        expiresInSeconds: 1800,
        resendAfterSeconds: 60,
        ...(demoModeEnabled ? { devPin: code } : {}),
      } });
    } catch (err) {
      return handleError(res, err);
    }
  };

  const handleVerifyPayerPin = async (req: Request, res: Response, isEmailLink: boolean) => {
    try {
      if (!enforceRateLimit(req, res, "paymentIntent")) return;
      const token = req.params.token || req.params.emailToken || String(req.body?.token ?? "");
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const code = String(req.body?.code ?? "").trim();
      const verification = req.session.paymentRequestVerification;
      if (!verification || verification.token !== token || verification.isEmailLink !== isEmailLink || verification.email !== email) {
        return res.status(400).json({ error: { code: "PIN_NOT_SENT", message: "Request a new PIN for this email address." } });
      }
      if (verification.failedAttempts >= 5) {
        return res.status(429).json({ error: { code: "PIN_LOCKED", message: "Too many incorrect attempts. Request a new PIN later." } });
      }
      const request = await getRequestByTokenOrEmailToken(token, isEmailLink);
      if (request && rejectIfRequestUnavailableForPayer(request, res)) {
        return;
      }
      const otp = code.length === 6 ? await storage.getValidOtp(email, code) : undefined;
      if (!otp) {
        verification.failedAttempts += 1;
        return res.status(400).json({ error: { code: "INVALID_PIN", message: "The PIN is invalid or has expired." } });
      }
      await storage.markOtpUsed(otp.id);
      verification.verified = true;

      if (req.body?.authenticatePayer && request) {
        const { payerName } = await ensurePayerUserSession(req, request, email, {
          accountType: req.body?.accountType,
          firstName: req.body?.firstName,
          lastName: req.body?.lastName,
          businessName: req.body?.businessName,
          gender: req.body?.gender,
          dateOfBirth: req.body?.dateOfBirth,
          address: req.body?.address,
          city: req.body?.city,
          postcode: req.body?.postcode,
        });
        return res.json({
          data: {
            verified: true,
            payerName,
            savedAccounts: getPayerSavedAccounts(email, request),
          },
        });
      }

      return res.json({ data: { verified: true } });
    } catch (err) {
      return handleError(res, err);
    }
  };

  // Email-link direct continuation: when the payer arrives via /pay/e/:emailToken,
  // their email ownership was already established by opening the emailed link.
  const handleEmailLinkContinue = async (req: Request, res: Response) => {
    try {
      if (!enforceRateLimit(req, res, "paymentIntent")) return;
      const emailToken = req.params.emailToken || String(req.body?.token ?? "");
      const request = await getRequestByTokenOrEmailToken(emailToken, true);
      if (!request) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "This payment link is not valid." } });
      }
      if (rejectIfRequestUnavailableForPayer(request, res)) {
        return;
      }
      const email = String(req.body?.email || request.senderEmail || "").trim().toLowerCase();
      if (!email) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Enter your email address to continue." } });
      }
      const { payerName } = await ensurePayerUserSession(req, request, email, {
        accountType: req.body?.accountType,
        firstName: req.body?.firstName,
        lastName: req.body?.lastName,
        businessName: req.body?.businessName,
        gender: req.body?.gender,
        dateOfBirth: req.body?.dateOfBirth,
        address: req.body?.address,
        city: req.body?.city,
        postcode: req.body?.postcode,
      });
      return res.json({
        data: {
          verified: true,
          payerName,
          payerEmail: email,
          savedAccounts: getPayerSavedAccounts(email, request),
        },
      });
    } catch (err) {
      return handleError(res, err);
    }
  };

  const handleSavePayerBankAccount = async (req: Request, res: Response, isEmailLink: boolean) => {
    try {
      const token = req.params.token || req.params.emailToken || String(req.body?.token ?? "");
      const request = await getRequestByTokenOrEmailToken(token, isEmailLink);
      if (!request) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "This payment link is not valid." } });
      }
      if (rejectIfRequestUnavailableForPayer(request, res, req.session?.userId)) {
        return;
      }
      const bankName = String(req.body?.bankName ?? "").trim();
      const accountNumber = String(req.body?.accountNumber ?? "").trim().replace(/\D/g, "");
      const accountName = String(req.body?.accountName ?? "").trim() || request.payerName || request.senderName || "Verified Sender";
      const email = String(req.body?.email || request.payerEmail || request.senderEmail || "").trim().toLowerCase();
      const saveToProfile = req.body?.saveToProfile !== false;

      if (!bankName || accountNumber.length < 6) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Select a bank and enter a valid account number." } });
      }

      // Never overwrite requester-provided bank details or leak across concurrent payers
      if (
        request.payerSourceOrigin !== "requester"
        && !request.payerSourceBankName
        && !request.payerSourceAccountMasked
      ) {
        await storage.updateMoneyRequest(request.id, {
          payerSourceBankName: bankName,
          payerSourceAccountMasked: maskAccountNumber(accountNumber),
        });
      }

      let savedAccount = {
        id: `acc_${Date.now()}`,
        bankName,
        accountNumber,
        accountName,
      };
      if (email && saveToProfile) {
        savedAccount = savePayerBankAccountForEmail(email, { bankName, accountNumber, accountName });
      }

      return res.json({
        data: {
          account: savedAccount,
          savedAccounts: getPayerSavedAccounts(email, request),
        },
      });
    } catch (err) {
      return handleError(res, err);
    }
  };

  app.post("/api/public/requests/:token/verification/send", (req, res) => handleSendPayerPin(req, res, false));
  app.post("/api/public/requests/e/:emailToken/verification/send", (req, res) => handleSendPayerPin(req, res, true));
  app.post("/api/public/requests/:token/verification/verify", (req, res) => handleVerifyPayerPin(req, res, false));
  app.post("/api/public/requests/e/:emailToken/verification/verify", (req, res) => handleVerifyPayerPin(req, res, true));
  app.post("/api/public/request-verifications/:token/send", (req, res) => handleSendPayerPin(req, res, false));
  app.post("/api/public/request-verifications/e/:emailToken/send", (req, res) => handleSendPayerPin(req, res, true));
  app.post("/api/public/request-verifications/:token/verify", (req, res) => handleVerifyPayerPin(req, res, false));
  app.post("/api/public/request-verifications/e/:emailToken/verify", (req, res) => handleVerifyPayerPin(req, res, true));
  app.post("/api/public/request-verifications/send", (req, res) => handleSendPayerPin(req, res, Boolean(req.body?.isEmailLink)));
  app.post("/api/public/request-verifications/verify", (req, res) => handleVerifyPayerPin(req, res, Boolean(req.body?.isEmailLink)));
  app.post("/api/public/requests/e/:emailToken/email-continue", handleEmailLinkContinue);
  app.post("/api/public/requests/:token/payer-bank-account", (req, res) => handleSavePayerBankAccount(req, res, false));
  app.post("/api/public/requests/e/:emailToken/payer-bank-account", (req, res) => handleSavePayerBankAccount(req, res, true));

  // 3. Start Payer 10-Minute Session
  const handleStartSession = async (req: Request, res: Response, isEmailLink: boolean) => {
    try {
      if (!enforceRateLimit(req, res, "paymentIntent")) return;
      const token = req.params.token || req.params.emailToken;
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Please sign in to continue." } });
      }
      const session = await startPayerSession({
        token,
        isEmailLink,
        userId,
      });
      return res.json({ data: session });
    } catch (err) {
      return handleError(res, err);
    }
  };

  app.post("/api/public/requests/:token/session", (req, res) => handleStartSession(req, res, false));
  app.post("/api/public/requests/e/:emailToken/session", (req, res) => handleStartSession(req, res, true));

  // 4. Pay Intent / Submission (Atomic lock)
  const handlePayIntent = async (req: Request, res: Response, isEmailLink: boolean) => {
    try {
      if (!enforceRateLimit(req, res, "paymentIntent")) return;
      const parsed = createPayinIntentSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Select a payment method." } });
      }
      const token = req.params.token || req.params.emailToken;
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Please sign in to continue." } });
      }
      const intent = await createPayinIntent({
        token,
        isEmailLink,
        method: parsed.data.method,
        userId,
        sessionId: String(req.body?.sessionId ?? ""),
      });
      return res.json({ data: intent });
    } catch (err) {
      return handleError(res, err);
    }
  };

  app.post("/api/public/requests/:token/pay-intent", (req, res) => handlePayIntent(req, res, false));
  app.post("/api/public/requests/e/:emailToken/pay-intent", (req, res) => handlePayIntent(req, res, true));
  app.post("/api/public/requests/:token/intent", (req, res) => handlePayIntent(req, res, false));

  // 4B. Release un-settled Pay Intent when reserving payer backs out or cancels
  const handleReleaseIntent = async (req: Request, res: Response, isEmailLink: boolean) => {
    try {
      if (!enforceRateLimit(req, res, "paymentIntent")) return;
      const token = req.params.token || req.params.emailToken;
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Please sign in to continue." } });
      }
      const result = await releasePayinIntent({
        token,
        isEmailLink,
        userId,
        intentId: typeof req.body?.intentId === "string" ? req.body.intentId : null,
      });
      return res.json({ data: result });
    } catch (err) {
      return handleError(res, err);
    }
  };

  app.post("/api/public/requests/:token/release-intent", (req, res) => handleReleaseIntent(req, res, false));
  app.post("/api/public/requests/e/:emailToken/release-intent", (req, res) => handleReleaseIntent(req, res, true));

  // 5. Request New Payment Link (Expired request renewal)
  const handleRequestNewLink = async (req: Request, res: Response, isEmailLink: boolean) => {
    try {
      if (!enforceRateLimit(req, res, "reportRequest")) return;
      const token = req.params.token || req.params.emailToken;
      const payerEmail = req.body?.payerEmail as string | undefined;
      const result = await requestNewPaymentLink(token, isEmailLink, payerEmail);
      return res.json({ data: result });
    } catch (err) {
      return handleError(res, err);
    }
  };

  app.post("/api/public/requests/:token/request-new-link", (req, res) => handleRequestNewLink(req, res, false));
  app.post("/api/public/requests/e/:emailToken/request-new-link", (req, res) => handleRequestNewLink(req, res, true));

  // ─── Provider webhooks (signed, idempotent) ────────────────────────────────

  app.post("/api/webhooks/payin", (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : (req.rawBody as Buffer ?? Buffer.from(JSON.stringify(req.body ?? {})));
    processPayinWebhook(raw, String(req.headers["x-rhemito-signature"] ?? ""))
      .then((result) => res.json(result))
      .catch((err) => handleError(res, err));
  });

  app.post("/api/webhooks/payout", (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : (req.rawBody as Buffer ?? Buffer.from(JSON.stringify(req.body ?? {})));
    processPayoutWebhook(raw, String(req.headers["x-rhemito-signature"] ?? ""))
      .then((result) => res.json(result))
      .catch((err) => handleError(res, err));
  });

  // Mailjet Event API Webhook receiver (https://dev.mailjet.com/docs/email-api/webhooks/webhooks-overview)
  // Receives real-time HTTP POST event notifications (sent, open, click, bounce, spam, blocked, unsub)
  // and returns 200 OK so Mailjet does not retry every 30s.
  app.post("/api/webhooks/mailjet", async (req, res) => {
    try {
      const { webhookUser, webhookPass } = serverConfig.mailjet;
      if (webhookUser && webhookPass) {
        const authHeader = String(req.headers.authorization ?? "");
        const expected = `Basic ${Buffer.from(`${webhookUser}:${webhookPass}`).toString("base64")}`;
        if (authHeader !== expected) {
          return res.status(401).json({ error: "Unauthorized webhook request" });
        }
      }
      const result = await processMailjetWebhookEvents(req.body);
      return res.status(200).json({ status: "ok", ...result });
    } catch (err) {
      return handleError(res, err);
    }
  });

  app.get("/api/webhooks/mailjet/events", (_req, res) => {
    return res.status(200).json({ data: listRecentMailjetWebhookEvents() });
  });

  app.post("/api/webhooks/mailjet/simulate", async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        event?: string;
        email?: string;
        requestId?: string;
        deliveryId?: string;
        MessageID?: string | number;
      };
      const simulated = {
        event: body.event ?? "open",
        time: Math.floor(Date.now() / 1000),
        MessageID: body.MessageID ?? `sim_mj_${Date.now()}`,
        email: body.email ?? "sender@example.com",
        CustomID:
          body.requestId && body.deliveryId
            ? `request:${body.requestId}:delivery:${body.deliveryId}`
            : body.requestId
              ? `request:${body.requestId}`
              : undefined,
        Payload: JSON.stringify({
          requestId: body.requestId,
          deliveryId: body.deliveryId,
          simulated: true,
        }),
      };
      const result = await processMailjetWebhookEvents(simulated);
      return res.status(200).json({ status: "ok", ...result });
    } catch (err) {
      return handleError(res, err);
    }
  });

  // ─── Development-only hooks (404 in production) ────────────────────────────

  const devEnabled = () => true;

  const devOnly = (handler: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response) => {
      if (!devEnabled()) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found." } });
      }
      try {
        await handler(req, res);
      } catch (err) {
        return handleError(res, err);
      }
    };

  // Complete the (stub) bank-account verification for a payout account.
  app.post("/api/dev/payout-accounts/:id/verify", devOnly(async (req, res) => {
    const userId = requireStrictAuth(req);
    const account = await storage.getPayoutAccountById(req.params.id);
    if (!account || account.ownerId !== userId) {
      throw new RequestError(404, "NOT_FOUND", "Account not found.");
    }
    await storage.updatePayoutAccount(account.id, { verificationStatus: "verified", verifiedAt: new Date() });
    res.json({ success: true });
  }));

  // Simulate the provider authorisation completing and the SIGNED webhook
  // arriving — the same boundary a real provider uses. The browser alone can
  // never fund a request.
  app.post("/api/dev/payin/:intentId/authorize", devOnly(async (req, res) => {
    const request = Array.from(
      (await storage.listAllMoneyRequestsRaw()).filter((r) => r.payinIntentId === req.params.intentId),
    )[0];
    if (!request) throw new RequestError(404, "NOT_FOUND", "Intent not found.");

    const { buildSignedDevWebhook } = await import("./providers");
    const event = {
      eventId: `devauth_${req.params.intentId}_${Date.now()}`,
      type: "payment.succeeded" as const,
      intentId: req.params.intentId,
      requestNumber: request.requestNumber,
      amountMinor: senderPaysMinorOf(request.payInAmountMinor, request.feeMinor, request.absorbFee),
      currency: request.payInCurrency,
      providerPaymentRef: `devpay_${req.params.intentId}`,
    };
    const signed = buildSignedDevWebhook(event);
    await processPayinWebhook(signed.rawBody, signed.signature);
    res.json({ success: true, note: "Development provider simulation — settlement via signed webhook." });
  }));

  startRequestSweep();
}

export { CORRIDORS, getFxRate };
