/**
 * Request Service — unified Request Money lifecycle.
 *
 * Server-authoritative: eligibility, verified payout-account ownership,
 * corridor enforcement, secure token generation, provider intents, signed
 * webhook processing (the ONLY path that funds a request), payout submission,
 * cancellation/rotation/extension, expiry sweeps and email delivery via the
 * provider interface.
 *
 * The provider adapters are development stubs (see server/providers.ts). No
 * simulated behaviour here is presented as a real bank/email/KYC integration.
 */

import { randomUUID, randomBytes, createHash } from "crypto";
import { storage } from "./storage";
import { serverConfig, demoModeEnabled, buildCheckoutUrl, buildEmailCheckoutUrl } from "./config";
import { getFxRate } from "./fxService";
import {
  devPayinProvider,
  devPayoutProvider,
  devEmailProvider,
  verifyWebhookSignature,
  signWebhookPayload,
  recordMailjetWebhookEvent,
  type PayinWebhookEvent,
  type MailjetWebhookEvent,
} from "./providers";
import { postFundingEntries, postPayoutEntry, payoutTotalMinor } from "./walletService";
import { dispatchNotification } from "./notificationService";
import { onMoneyRequestPaid, onMoneyRequestRefunded } from "./rewardsService";
import * as promo from "./promo";
import { findCorridor, validateCorridor, type CorridorConfig } from "./corridors";
import {
  toMinorUnits,
  fromMinorUnits,
  feeMinorOf,
  senderPaysMinorOf,
  netMinorOf,
  applyFxMarkup,
  convertMinor,
  maskAccountNumber,
  maskEmail,
} from "@shared/money";
import {
  formatDocumentNumber,
  dateInTz,
  EXPIRY_TIMEZONE,
  formatHumanDate,
  validateInvoiceDates,
} from "@shared/invoice-logic";
import { DEMO_PAYER_CREDENTIALS } from "@shared/schema";
import type {
  MoneyRequest,
  CreateMoneyRequestPayload,
  RequestStatus,
  PaymentAttempt,
  RequestRenewalRequest,
} from "@shared/schema";
import bcrypt from "bcryptjs";

export class RequestError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const SWEEP_INTERVAL_MS = 60 * 1000;

// ─── Eligibility ──────────────────────────────────────────────────────────────

export interface EligibilityResult {
  authenticated: true;
  accountStatus: string;
  kycStatus: string;
  country: string;
  eligible: boolean;
  reasons: string[];
}

export async function checkEligibility(userId: string): Promise<EligibilityResult> {
  const user = await storage.getAuthUserById(userId);
  const reasons: string[] = [];

  if (!user) {
    throw new RequestError(401, "UNAUTHENTICATED", "Sign in to request money.");
  }

  const accountOk = user.status === "active";
  const kycOk = user.kycStatus === "passed";

  if (!accountOk) reasons.push(`Your Rhemito account is ${user.status}.`);
  if (!kycOk) reasons.push("You must complete mini-KYC before requesting money.");

  const accounts = await storage.listPayoutAccountsByOwner(userId);
  const hasVerified = accounts.some((a) => a.verificationStatus === "verified");
  if (!hasVerified) reasons.push("Add and verify a payout bank account to receive requests.");

  return {
    authenticated: true,
    accountStatus: user.status,
    kycStatus: user.kycStatus,
    country: user.country,
    eligible: accountOk && kycOk && hasVerified,
    reasons,
  };
}

// ─── Creation ─────────────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function displayNameOf(userId: string): Promise<string> {
  const user = await storage.getAuthUserById(userId);
  if (!user) throw new RequestError(401, "UNAUTHENTICATED", "Sign in to request money.");
  const name =
    user.accountType === "business"
      ? user.businessName
      : [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" ");
  return name || user.email;
}

export interface QuoteSnapshot {
  feeMinor: number;
  senderPaysMinor: number;
  payoutAmountMinor: number | null;
  fxRate: number | null;
  fxRateIsIndicative: boolean;
  fxMarkupApplied: number;
}

/** Fee + indicative FX quote. Never silently 1:1 — getFxRate throws on unknown pairs. */
export async function computeQuote(
  corridor: CorridorConfig,
  payInAmountMinor: number,
  absorbFee = true,
): Promise<QuoteSnapshot> {
  const feeMinor = feeMinorOf(payInAmountMinor, serverConfig.feeRate);
  const netMinor = netMinorOf(payInAmountMinor, feeMinor, absorbFee);

  if (corridor.payInCurrency === corridor.payoutCurrency) {
    return {
      feeMinor,
      senderPaysMinor: senderPaysMinorOf(payInAmountMinor, feeMinor, absorbFee),
      payoutAmountMinor: netMinor,
      fxRate: null,
      fxRateIsIndicative: true,
      fxMarkupApplied: 0,
    };
  }

  const midRate = await getFxRate(corridor.payInCurrency, corridor.payoutCurrency);
  const customerRate = applyFxMarkup(midRate, serverConfig.fxMarkup);
  return {
    feeMinor,
    senderPaysMinor: senderPaysMinorOf(payInAmountMinor, feeMinor, absorbFee),
    payoutAmountMinor: convertMinor(netMinor, customerRate),
    fxRate: customerRate,
    fxRateIsIndicative: true,
    fxMarkupApplied: serverConfig.fxMarkup,
  };
}

export async function createMoneyRequest(params: {
  userId: string;
  payload: CreateMoneyRequestPayload;
}): Promise<{ request: MoneyRequest; token: string; emailToken: string; checkoutUrl: string; emailCheckoutUrl: string; alreadyExisted: boolean }> {
  const { userId, payload } = params;

  // Idempotent submissions return the original request.
  const existing = await storage.getMoneyRequestByIdempotencyKey(userId, payload.idempotencyKey);
  if (existing) {
    const emailTok = existing.emailToken || existing.token;
    return {
      request: existing,
      token: existing.token,
      emailToken: emailTok,
      checkoutUrl: buildCheckoutUrl(existing.token),
      emailCheckoutUrl: buildEmailCheckoutUrl(emailTok),
      alreadyExisted: true,
    };
  }

  const eligibility = await checkEligibility(userId);
  if (!eligibility.eligible) {
    throw new RequestError(403, "NOT_ELIGIBLE", eligibility.reasons[0] ?? "You cannot create requests yet.");
  }

  const corridor = findCorridor(payload.corridorId);
  if (!corridor) {
    throw new RequestError(400, "CORRIDOR_NOT_FOUND", "Select a supported corridor.");
  }

  const user = (await storage.getAuthUserById(userId))!;
  const account = await storage.getPayoutAccountById(payload.payoutAccountId);
  if (!account || account.ownerId !== userId) {
    throw new RequestError(403, "ACCOUNT_NOT_OWNED", "Select one of your own payout accounts.");
  }
  if (account.verificationStatus !== "verified") {
    throw new RequestError(403, "ACCOUNT_NOT_VERIFIED", "Select a verified payout account.");
  }

  let payInAmountMinor: number;
  try {
    payInAmountMinor = toMinorUnits(payload.payInAmount, corridor.payInCurrency);
  } catch {
    throw new RequestError(400, "VALIDATION_ERROR", "Enter a valid amount.");
  }

  const corridorCheck = validateCorridor({
    corridor,
    requesterCountry: user.country,
    payoutAccountCountry: account.country,
    payoutAccountCurrency: account.currency,
    amountMinor: payInAmountMinor,
  });
  if (!corridorCheck.ok) {
    throw new RequestError(400, "CORRIDOR_UNAVAILABLE", corridorCheck.reason ?? "Corridor unavailable.");
  }

  const quote = await computeQuote(corridor, payInAmountMinor, payload.absorbFee);
  const now = new Date();

  // Due Date / Payment Link Expiry follow the invoice contract: the link
  // expires at the end (11:59:59 p.m. UK) of the chosen day, and preset
  // periods count from the Due Date when one is set. Client validation is
  // mirrored for UX only — this check is authoritative.
  const dateCheck = validateInvoiceDates(payload.dueDate, payload.expiry, now);
  if (dateCheck.errors.length > 0) {
    throw new RequestError(400, "VALIDATION_ERROR", dateCheck.errors[0]);
  }

  const sequence = await storage.nextMoneyRequestSequence();
  const yearMonth = dateInTz(now, EXPIRY_TIMEZONE).slice(0, 7);

  // Dual secure tokens: clean copyable link token + recipient-specific email link token
  const token = randomBytes(24).toString("hex"); // 192 bits of entropy for copyable link
  const tokenHash = hashToken(token);
  const emailToken = randomBytes(24).toString("hex"); // 192 bits of entropy for email notification link
  const emailTokenHash = hashToken(emailToken);
  const requesterName = await displayNameOf(userId);
  const recipientEmailMasked = payload.senderEmail ? maskEmail(payload.senderEmail) : null;

  const requestId = randomUUID();
  // Optional Receive Money promo code: Mito checks it and reserves one use; the bonus is credited on payout.
  let promoApplied: promo.PromoAtRequest | null = null;
  if (payload.promoCode) {
    if (quote.payoutAmountMinor === null) {
      throw new RequestError(503, "PROMO_UNAVAILABLE", "Promo codes are unavailable right now. Please try again shortly.");
    }
    try {
      promoApplied = await promo.applyForRequest({
        userId,
        requestId,
        code: payload.promoCode,
        receiveAmountMinor: quote.payoutAmountMinor,
        receiveCurrency: corridor.payoutCurrency,
      });
    } catch (err) {
      if (err instanceof promo.PromoPaymentError) throw new RequestError(err.status, err.code, err.message);
      throw err;
    }
  }

  const request: MoneyRequest = {
    id: requestId,
    requestNumber: formatDocumentNumber("RM", sequence, yearMonth),
    requesterId: userId,
    requesterName,
    requesterCountry: user.country,
    corridorId: corridor.id,
    senderCountry: corridor.senderCountry,
    payInCurrency: corridor.payInCurrency,
    payInAmountMinor,
    payoutCurrency: corridor.payoutCurrency,
    feeMinor: quote.feeMinor,
    absorbFee: payload.absorbFee,
    payoutAmountMinor: quote.payoutAmountMinor,
    fxRate: quote.fxRate !== null ? String(quote.fxRate) : null,
    fxRateIsIndicative: quote.fxRateIsIndicative,
    fxMarkupApplied: String(quote.fxMarkupApplied),
    payoutAccountId: account.id,
    payoutAccountMasked: maskAccountNumber(account.accountNumber),
    payoutAccountBankName: account.bankName,
    payoutAccountHolderName: account.holderName,
    payoutAccountCountry: account.country,
    senderType: payload.senderType,
    senderName: payload.senderName ?? null,
    senderEmail: payload.senderEmail ? payload.senderEmail.toLowerCase() : null,
    senderPhone: payload.senderPhone ?? null,
    senderDob: payload.senderDob ?? null,
    purpose: payload.purpose,
    senderId: payload.senderId ?? null,
    payerSourceBankName: (payload.payerAccountNumber || payload.payerBankName) ? (payload.payerBankName ?? null) : null,
    payerSourceAccountMasked: payload.payerAccountNumber ? partiallyMaskSenderAccount(payload.payerAccountNumber) : null,
    payerSourceOrigin: (payload.payerAccountNumber || payload.payerBankName) ? (payload.senderId ? "saved_sender" : "requester") : null,
    reference: payload.reference ?? null,
    status: "active",
    token,
    tokenHash,
    emailToken,
    emailTokenHash,
    recipientEmailMasked,
    payerUserId: null,
    payerName: null,
    payerEmail: null,
    payerEmailMasked: null,
    activeSessionId: null,
    sessionExpiresAt: null,
    reservedAttemptId: null,
    dueDate: payload.dueDate ?? null,
    expiresAt: dateCheck.computation.expiresAt,
    expiryExtendedOnce: false,
    viewedAt: null,
    paymentInitiatedAt: null,
    fundedAt: null,
    payoutSubmittedAt: null,
    paidOutAt: null,
    cancelledAt: null,
    failureReason: null,
    payinIntentId: null,
    providerPaymentRef: null,
    payoutProviderRef: null,
    paymentMethod: null,
    idempotencyKey: payload.idempotencyKey,
    promoCode: promoApplied?.promoCode ?? null,
    promoBonusMinor: promoApplied?.bonusMinor ?? null,
    createdAt: now,
  };

  try {
    await storage.createMoneyRequest(request);
  } catch (err) {
    if (promoApplied) await promo.releaseForRequest(requestId);
    throw err;
  }
  if (payload.payerAccountNumber) {
    const maskedForSender = partiallyMaskSenderAccount(payload.payerAccountNumber);
    requestPayerFullAccountById.set(request.id, maskedForSender);
    if (request.senderEmail && payload.payerBankName) {
      savePayerBankAccountForEmail(request.senderEmail, {
        bankName: payload.payerBankName,
        accountNumber: maskedForSender,
        accountName: request.senderName || request.senderEmail,
      });
    }
  }
  await ensureDemoPayerForRequest(request);
  // No email is sent at creation: the requester chooses to send one (Send email),
  // so creating a link never implies that an email went out.
  return {
    request,
    token,
    emailToken,
    checkoutUrl: buildCheckoutUrl(token),
    emailCheckoutUrl: buildEmailCheckoutUrl(emailToken),
    alreadyExisted: false,
  };
}

export interface PayerSavedBankAccount {
  id: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
}

/**
 * Partially masks a sender bank account number provided by the requester
 * so the sender can recognise which account to pay from without exposing
 * the full raw number (e.g. "3661883153" -> "36****3153", "12345678" -> "12**5678").
 */
export function partiallyMaskSenderAccount(accountNumber: string): string {
  const trimmed = accountNumber.trim();
  if (!trimmed) return "";
  if (trimmed.includes("*")) return trimmed;
  if (trimmed.length >= 7) {
    const middleStars = "*".repeat(Math.max(2, trimmed.length - 6));
    return `${trimmed.slice(0, 2)}${middleStars}${trimmed.slice(-4)}`;
  }
  return maskAccountNumber(trimmed);
}

const requestPayerFullAccountById = new Map<string, string>();
const autoSeededPlaceholderEmails = new Set<string>();
const verifiedSenderEmails = new Set<string>([
  "payer@rhemito.com",
  "demo@rhemito.com",
  "john.adeyemi@email.com",
  "sarah.w@company.co.uk",
  "m.chen@business.com",
  "emma.t@mail.com",
  "david.o@gmail.com",
]);

const payerSavedAccountsByEmail = new Map<string, PayerSavedBankAccount[]>([
  [
    "payer@rhemito.com",
    [
      {
        id: "acc_paga_3153",
        bankName: "Paga Mobile Money",
        accountNumber: "36****3153",
        accountName: "Firopo Akintayo Akin-Agunbiade",
      },
    ],
  ],
  [
    "demo@rhemito.com",
    [
      {
        id: "acc_paga_3153",
        bankName: "Paga Mobile Money",
        accountNumber: "36****3153",
        accountName: "Firopo Akintayo Akin-Agunbiade",
      },
    ],
  ],
  [
    "john.adeyemi@email.com",
    [
      {
        id: "acc_john_6789",
        bankName: "Access Bank Nigeria Plc",
        accountNumber: "01****6789",
        accountName: "John Oluwaseun Adeyemi",
      },
    ],
  ],
  [
    "david.o@gmail.com",
    [
      {
        id: "acc_david_7890",
        bankName: "Guaranty Trust Bank (GTBank)",
        accountNumber: "02****7890",
        accountName: "David Chukwu Okonkwo",
      },
    ],
  ],
  [
    "sarah.w@company.co.uk",
    [
      {
        id: "acc_sarah_5678",
        bankName: "Barclays",
        accountNumber: "12**5678",
        accountName: "Sarah Williams",
      },
    ],
  ],
  [
    "emma.t@mail.com",
    [
      {
        id: "acc_emma_4321",
        bankName: "HSBC UK",
        accountNumber: "87**4321",
        accountName: "Emma Grace Thompson",
      },
    ],
  ],
]);

export function getPayerSavedAccounts(email?: string | null, request?: MoneyRequest): PayerSavedBankAccount[] {
  const list: PayerSavedBankAccount[] = [];
  if (request && (request.payerSourceBankName || request.payerSourceAccountMasked || requestPayerFullAccountById.get(request.id))) {
    const rawOrMasked = requestPayerFullAccountById.get(request.id) || request.payerSourceAccountMasked || "";
    const accNum = rawOrMasked ? partiallyMaskSenderAccount(rawOrMasked) : "****";
    list.push({
      id: `req_acc_${request.id}`,
      bankName: request.payerSourceBankName || "Your specified bank",
      accountNumber: accNum,
      accountName: request.senderName || request.payerName || "Verified Sender",
    });
  }
  if (email) {
    const normalized = email.trim().toLowerCase();
    const saved = payerSavedAccountsByEmail.get(normalized) ?? [];
    for (const item of saved) {
      if (!list.some((x) => x.accountNumber === item.accountNumber && x.bankName === item.bankName)) {
        list.push(item);
      }
    }
  }
  return list;
}

export function savePayerBankAccountForEmail(
  email: string,
  account: { bankName: string; accountNumber: string; accountName: string },
): PayerSavedBankAccount {
  const normalized = email.trim().toLowerCase();
  const current = payerSavedAccountsByEmail.get(normalized) ?? [];
  const existing = current.find(
    (a) => a.accountNumber === account.accountNumber && a.bankName.toLowerCase() === account.bankName.toLowerCase(),
  );
  if (existing) {
    existing.accountName = account.accountName || existing.accountName;
    return existing;
  }
  const created: PayerSavedBankAccount = {
    id: `acc_${randomBytes(4).toString("hex")}`,
    bankName: account.bankName,
    accountNumber: account.accountNumber,
    accountName: account.accountName,
  };
  payerSavedAccountsByEmail.set(normalized, [created, ...current]);
  return created;
}

export async function isKnownSenderEmail(email: string, request?: MoneyRequest): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  if (request?.senderEmail?.toLowerCase() === normalized && !!request.senderName?.trim()) {
    return true;
  }
  const user = await storage.getAuthUserByEmail(normalized);
  // If the logged-in requester is testing the payer flow using their own email address
  // and explicitly left "Sender Name" blank on this request, treat as an unregistered
  // sender so Mini-KYC ("New to Mito?") is shown.
  if (request && !request.senderName?.trim() && user && user.id === request.requesterId) {
    return false;
  }
  if (verifiedSenderEmails.has(normalized)) return true;
  if (
    user &&
    !autoSeededPlaceholderEmails.has(normalized) &&
    !(user.firstName === "Demo" && user.lastName === "Payer")
  ) {
    return true;
  }
  return false;
}

export function markSenderEmailKnown(email: string): void {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  verifiedSenderEmails.add(normalized);
  autoSeededPlaceholderEmails.delete(normalized);
}

/**
 * Prototype-only: register the sender email the requester provided as a demo
 * payer only when the requester also provided the sender's name (representing a
 * known sender). If no sender name was supplied, the email remains unregistered
 * so the checkout prompts for Mini-KYC ("New to Mito?").
 */
async function ensureDemoPayerForRequest(request: MoneyRequest): Promise<void> {
  if (!demoModeEnabled) return;
  const email = request.senderEmail;
  if (!email) return; // generic link: no payer registered up front
  const hasRealName = !!request.senderName?.trim();
  if (!hasRealName) {
    // Do not auto-create an authUser when no sender name was provided — this
    // ensures unregistered senders see the Mini-KYC ("New to Mito?") flow.
    return;
  }
  verifiedSenderEmails.add(email.toLowerCase());
  if (await storage.getAuthUserByEmail(email)) return;
  const [firstName, ...rest] = (request.senderName ?? "").split(" ");
  await storage.createAuthUser({
    email,
    password: bcrypt.hashSync(DEMO_PAYER_CREDENTIALS.password, 12),
    accountType: request.senderType === "business" ? "business" : "individual",
    country: request.senderCountry,
    firstName: firstName || "Verified",
    middleName: null,
    lastName: rest.join(" ") || "Sender",
    dateOfBirth: null,
    gender: null,
    mobileCode: null,
    mobileNumber: null,
    businessName: request.senderType === "business" ? request.senderName : null,
    businessRegNo: null,
    businessPhoneCode: null,
    businessPhoneNumber: null,
    directorName: null,
    status: "pending",
  });
  await storage.activateUser(email);
}

// ─── Email (provider interface, delivery states, idempotent, rate-limited) ────

async function queueRequestEmail(request: MoneyRequest, kind: "initial" | "resend"): Promise<void> {
  const recipientEmail = request.senderEmail;
  // Generic links have no payer email: nothing to send until the requester adds one.
  if (!recipientEmail) return;
  const dedupeKey = kind === "initial" ? `${request.id}:initial` : `${request.id}:resend:${Date.now()}`;

  if (kind === "initial") {
    const existing = await storage.getEmailDeliveryByDedupeKey(dedupeKey);
    if (existing) return;
  }

  const corridor = findCorridor(request.corridorId);
  const emailCheckoutUrl = buildEmailCheckoutUrl(request.emailToken || request.token);
  const expiryText = formatHumanDate(dateInTz(request.expiresAt, EXPIRY_TIMEZONE));
  const purposeText = request.purpose.replace(/_/g, " ");
  // The sender is told the total they pay — requested amount plus fee when the
  // requester does not absorb it.
  const amountValue = fromMinorUnits(
    senderPaysMinorOf(request.payInAmountMinor, request.feeMinor, request.absorbFee),
    request.payInCurrency,
  );
  const amountText = `${amountValue} ${request.payInCurrency}`;
  const displayAmount =
    request.payInCurrency === "GBP" ? `£${amountValue}` : `${request.payInCurrency} ${amountValue}`;

  const deliveryId = randomUUID();
  const customId = `delivery:${deliveryId}`;
  const eventPayload = JSON.stringify({
    type: "payment_request_link",
    requestId: request.id,
    requestNumber: request.requestNumber,
    deliveryId,
  });

  const maskedSenderAcc = request.payerSourceAccountMasked
    ? partiallyMaskSenderAccount(request.payerSourceAccountMasked)
    : null;
  const senderBankDisplay = [request.payerSourceBankName, maskedSenderAcc].filter(Boolean).join(" · ");
  const senderAccountEmailBannerHtml = senderBankDisplay
    ? `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:12px;padding:14px 16px;margin-bottom:20px;font-size:12px;color:#92400e;line-height:1.5;">
        <p style="margin:0 0 4px;font-weight:700;color:#78350f;">Bank account provided by ${request.requesterName}: <span style="font-family:monospace;font-size:13px;">${senderBankDisplay}</span></p>
        <p style="margin:0;">You should pay from the same bank account as provided to us by the requester (${senderBankDisplay}); otherwise, the requester may have to manually pair the payment with the correct sender.</p>
      </div>`
    : "";
  const senderAccountEmailBannerText = senderBankDisplay
    ? `Bank account provided by ${request.requesterName}: ${senderBankDisplay}\n` +
      `Important: You should pay from the same bank account as provided to us by the requester (${senderBankDisplay}); otherwise, the requester may have to manually pair the payment with the correct sender.\n\n`
    : "";

  const html = `
<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border:2px solid #2563eb;border-radius:16px;overflow:hidden;color:#0f172a;">
  <div style="padding:28px 24px 16px;text-align:center;">
    <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.2em;color:#2563eb;text-transform:uppercase;">Rhemito Payment</p>
    <p style="margin:12px 0 4px;font-size:14px;font-weight:600;color:#334155;">Payment Request From</p>
    <h1 style="margin:0;font-size:22px;font-weight:800;color:#0f172a;">${request.requesterName}</h1>
    <p style="margin:4px 0 0;font-size:12px;color:#64748b;">Ref ${request.requestNumber}</p>
    <p style="margin:18px 0 4px;font-size:12px;color:#64748b;">You pay</p>
    <p style="margin:0;font-size:38px;font-weight:800;color:#2563eb;">${displayAmount}</p>
  </div>
  <div style="padding:0 24px 24px;">
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:20px;font-size:13px;color:#334155;">
      <p style="margin:0 0 8px;">Hello <strong>${request.senderName ?? "there"}</strong>,</p>
      <p style="margin:0 0 12px;"><strong>${request.requesterName}</strong> has requested <strong>${amountText}</strong> through <strong>Rhemito</strong>.</p>
      <p style="margin:0 0 4px;"><strong>Sent by:</strong> Rhemito</p>
      <p style="margin:0 0 4px;"><strong>Purpose:</strong> ${purposeText}</p>
      <p style="margin:0 0 4px;"><strong>Reference:</strong> ${request.requestNumber}</p>
      <p style="margin:0;"><strong>Expires on:</strong> ${expiryText}</p>
    </div>
    ${senderAccountEmailBannerHtml}
    <div style="text-align:center;margin:24px 0;">
      <a href="${emailCheckoutUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:9999px;">
        Pay now
      </a>
    </div>
    <p style="margin:0 0 12px;font-size:12px;color:#64748b;text-align:center;">
      Or copy and paste this direct link into your browser:<br/>
      <a href="${emailCheckoutUrl}" style="color:#2563eb;word-break:break-all;">${emailCheckoutUrl}</a>
    </p>
    <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;line-height:1.5;">
      ⚠ Anti-fraud warning: Rhemito will never ask for your password or full card number by email or phone. Because this link was sent directly to your email, you will not need to enter an OTP/PIN when opening it.
    </p>
  </div>
  <div style="background:#2563eb;padding:12px;text-align:center;color:#ffffff;font-weight:700;font-size:13px;">
    rhemito
  </div>
</div>`;

  const message = {
    to: recipientEmail,
    toName: request.senderName ?? undefined,
    subject: `${request.requesterName} requests ${amountText} via Rhemito`,
    text:
      `Hello ${request.senderName ?? "there"},\n\n` +
      `${request.requesterName} has requested ${amountText} through Rhemito.\n\n` +
      `Purpose: ${purposeText}\n` +
      `Reference: ${request.requestNumber}\n` +
      `This request expires on ${expiryText}.\n\n` +
      senderAccountEmailBannerText +
      `Review and pay securely (no OTP/PIN needed via this email link):\n${emailCheckoutUrl}\n\n` +
      `⚠ Anti-fraud warning: Rhemito will never ask for your password, full card number or one-time codes by ` +
      `email or phone. If anything looks wrong, do not proceed with payment and contact Rhemito support.\n\n` +
      `Need help? Contact Rhemito support: ${serverConfig.legalEntity.supportUrl}\n\n` +
      `— Rhemito (${serverConfig.legalEntity.displayName})`,
    html,
    customId,
    eventPayload,
  };

  const delivery = {
    id: deliveryId,
    requestId: request.id,
    toEmail: recipientEmail,
    subject: message.subject,
    state: "queued",
    attempts: "0",
    dedupeKey,
    lastAttemptAt: new Date(),
    createdAt: new Date(),
  };
  const stored = await storage.addEmailDelivery(delivery);

  try {
    await devEmailProvider.send(message);
    await storage.updateEmailDelivery(stored.id, {
      state: kind === "resend" ? "resent" : "sent",
      attempts: "1",
      lastAttemptAt: new Date(),
    });
  } catch (err) {
    console.error("[requestService] email send failed:", err);
    await storage.updateEmailDelivery(stored.id, { state: "failed", attempts: "1", lastAttemptAt: new Date() });
  }
}

/**
 * Processes real-time Mailjet Event API webhook callbacks (`sent`, `open`, `click`,
 * `bounce`, `spam`, `blocked`, `unsub`) per https://dev.mailjet.com/docs/email-api/webhooks/webhooks-overview.
 * Mailjet sends either a single JSON event object or an array of event objects and
 * expects a `200 OK` HTTP response.
 */
export async function processMailjetWebhookEvents(
  rawPayload: unknown,
): Promise<{ accepted: true; processed: number; events: MailjetWebhookEvent[] }> {
  const list: unknown[] = Array.isArray(rawPayload)
    ? rawPayload
    : rawPayload && typeof rawPayload === "object"
      ? [rawPayload]
      : [];

  const processedEvents: MailjetWebhookEvent[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const eventType = String(raw.event ?? "sent").toLowerCase() as MailjetWebhookEvent["event"];
    const evt: MailjetWebhookEvent = {
      event: eventType,
      time: typeof raw.time === "number" ? raw.time : Math.floor(Date.now() / 1000),
      MessageID: (raw.MessageID as number | string) ?? `mj_${Date.now()}`,
      Message_GUID: typeof raw.Message_GUID === "string" ? raw.Message_GUID : undefined,
      email: typeof raw.email === "string" ? raw.email : "",
      mj_campaign_id: typeof raw.mj_campaign_id === "number" ? raw.mj_campaign_id : undefined,
      mj_contact_id: typeof raw.mj_contact_id === "number" ? raw.mj_contact_id : undefined,
      customcampaign: typeof raw.customcampaign === "string" ? raw.customcampaign : undefined,
      CustomID: typeof raw.CustomID === "string" ? raw.CustomID : undefined,
      Payload: typeof raw.Payload === "string" ? raw.Payload : undefined,
      ip: typeof raw.ip === "string" ? raw.ip : undefined,
      geo: typeof raw.geo === "string" ? raw.geo : undefined,
      agent: typeof raw.agent === "string" ? raw.agent : undefined,
      url: typeof raw.url === "string" ? raw.url : undefined,
      error_related_to: typeof raw.error_related_to === "string" ? raw.error_related_to : undefined,
      error: typeof raw.error === "string" ? raw.error : undefined,
      hard_bounce: typeof raw.hard_bounce === "boolean" ? raw.hard_bounce : undefined,
      comment: typeof raw.comment === "string" ? raw.comment : undefined,
    };

    recordMailjetWebhookEvent(evt);
    processedEvents.push(evt);

    // Correlate CustomID (`delivery:<deliveryId>` or `request:<requestId>`) or Payload JSON
    let requestId: string | undefined;
    let deliveryId: string | undefined;
    if (evt.CustomID) {
      if (evt.CustomID.startsWith("delivery:")) {
        deliveryId = evt.CustomID.slice("delivery:".length);
      } else if (evt.CustomID.startsWith("request:")) {
        const parts = evt.CustomID.split(":");
        requestId = parts[1];
        if (parts[2] === "delivery") deliveryId = parts[3];
      }
    }
    if ((!requestId || !deliveryId) && evt.Payload) {
      try {
        const parsed = JSON.parse(evt.Payload) as { requestId?: string; deliveryId?: string };
        requestId = requestId ?? parsed.requestId;
        deliveryId = deliveryId ?? parsed.deliveryId;
      } catch {
        /* ignore non-JSON payload */
      }
    }

    if (deliveryId) {
      const mappedState =
        eventType === "open"
          ? "opened"
          : eventType === "click"
            ? "clicked"
            : eventType === "bounce"
              ? "bounced"
              : eventType === "spam" || eventType === "blocked"
                ? "failed"
                : "sent";
      await storage.updateEmailDelivery(deliveryId, {
        state: mappedState,
        lastAttemptAt: new Date(evt.time * 1000),
      });
    }

    if (requestId && (eventType === "open" || eventType === "click")) {
      const reqRecord = await storage.getMoneyRequestById(requestId);
      if (reqRecord) {
        markViewed(reqRecord);
      }
    }
  }

  return { accepted: true, processed: processedEvents.length, events: processedEvents };
}

async function sendLifecycleEmail(
  request: MoneyRequest,
  toEmail: string,
  subject: string,
  text: string,
  dedupeKey: string,
): Promise<void> {
  if (await storage.getEmailDeliveryByDedupeKey(dedupeKey)) return;
  const delivery = await storage.addEmailDelivery({
    id: randomUUID(), requestId: request.id, toEmail, subject, state: "queued",
    attempts: "0", dedupeKey, lastAttemptAt: new Date(), createdAt: new Date(),
  });
  try {
    await devEmailProvider.send({ to: toEmail, subject, text });
    await storage.updateEmailDelivery(delivery.id, { state: "sent", attempts: "1", lastAttemptAt: new Date() });
  } catch (error) {
    console.error("[requestService] lifecycle email failed:", error);
    await storage.updateEmailDelivery(delivery.id, { state: "failed", attempts: "1", lastAttemptAt: new Date() });
  }
}

export async function resendRequestEmail(
  userId: string,
  requestId: string,
  payer?: { email?: string; name?: string },
): Promise<void> {
  let request = await getOwnRequest(userId, requestId);
  if (request.status !== "active" && request.status !== "viewed") {
    throw new RequestError(409, "INVALID_STATE", "Email can only be resent while the request is awaiting payment.");
  }

  const deliveries = await storage.listEmailDeliveries(requestId);
  const last = deliveries[deliveries.length - 1];
  if (last?.lastAttemptAt && Date.now() - last.lastAttemptAt.getTime() < serverConfig.emailResendCooldownMs) {
    throw new RequestError(429, "RATE_LIMITED", "Please wait a minute before resending the email.");
  }

  // The requester may add or change the payer email at send time (payer is optional at creation).
  const email = payer?.email?.trim().toLowerCase();
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      throw new RequestError(400, "INVALID_EMAIL", "Enter a valid payer email such as name@example.com.");
    }
    const patch = {
      senderEmail: email,
      recipientEmailMasked: maskEmail(email),
      senderName: payer?.name?.trim() || request.senderName,
    };
    request = { ...request, ...patch };
    await storage.updateMoneyRequest(request.id, patch);
  }
  if (!request.senderEmail) {
    throw new RequestError(400, "PAYER_EMAIL_REQUIRED", "Enter the payer's email to send this request.");
  }

  await queueRequestEmail(request, "resend");
}

// ─── Lookup / ownership helpers ────────────────────────────────────────────────

async function getOwnRequest(userId: string, requestId: string): Promise<MoneyRequest> {
  const request = await storage.getMoneyRequestById(requestId);
  if (!request || request.requesterId !== userId) {
    throw new RequestError(404, "NOT_FOUND", "Request not found.");
  }
  return request;
}

async function releaseExpiredReservationIfNeeded(request: MoneyRequest, now = new Date()): Promise<MoneyRequest> {
  if (
    !["authorisation_in_progress", "payment_processing"].includes(request.status)
    || !request.reservedAttemptId
  ) {
    return request;
  }
  const attempt = await storage.getPaymentAttemptById(request.reservedAttemptId);
  // Only auto-release pre-authorisation reservations ("authorisation_initiated") whose 10-minute session expired.
  // Never auto-release attempts where a provider has already reported "pending" or "unknown".
  if (
    !attempt
    || attempt.status !== "authorisation_initiated"
    || !attempt.sessionExpiresAt
    || now.getTime() < attempt.sessionExpiresAt.getTime()
  ) {
    return request;
  }

  const nextStatus = now.getTime() >= request.expiresAt.getTime() ? "expired" : "viewed";
  const released = await storage.compareAndUpdateMoneyRequest(
    request.id,
    ["authorisation_in_progress", "payment_processing"],
    {
      status: nextStatus,
      paymentInitiatedAt: null,
      payinIntentId: null,
      paymentMethod: null,
      reservedAttemptId: null,
      payerUserId: null,
      payerName: null,
      payerEmail: null,
      payerEmailMasked: null,
    },
  );
  if (!released) {
    return (await storage.getMoneyRequestById(request.id)) ?? request;
  }
  await storage.updatePaymentAttempt(attempt.id, {
    status: "session_expired",
    failureReason: "Payment session expired before payment completion.",
    completedAt: now,
  });
  return released;
}

export async function getRequestByToken(token: string): Promise<MoneyRequest | undefined> {
  const found = await storage.getMoneyRequestByTokenHash(hashToken(token));
  return found ? releaseExpiredReservationIfNeeded(found) : undefined;
}

export async function getRequestByTokenOrEmailToken(
  tokenOrEmailToken: string,
  isEmailLink = false,
): Promise<MoneyRequest | undefined> {
  const hash = hashToken(tokenOrEmailToken);
  const found = isEmailLink
    ? await storage.getMoneyRequestByEmailTokenHash(hash)
    : await storage.getMoneyRequestByTokenHash(hash);
  return found ? releaseExpiredReservationIfNeeded(found) : undefined;
}

/** Effective status incl. real-time expiry for pre-funding states. */
export function effectiveStatus(request: MoneyRequest, now = new Date()): RequestStatus {
  const s = request.status as RequestStatus;
  if ((s === "active" || s === "viewed") && now.getTime() >= request.expiresAt.getTime()) {
    return "expired";
  }
  return s;
}

// ─── Public projection (minimum data for the payer — no requester bank details) ─────────

export const ALREADY_PAID_MESSAGE =
  "This payment request is no longer valid because the payment is already complete (paid by someone else). Only one full payment can be made for this amount.";
export const PAYMENT_IN_PROGRESS_MESSAGE =
  "Another payer is currently completing the payment for this request. Only one full payment can be made for this amount.";

export function toPublicRequestJSON(
  request: MoneyRequest,
  isEmailLink = false,
  currentUserId?: string,
  currentUserEmail?: string,
) {
  const corridor = findCorridor(request.corridorId);
  const now = new Date();
  const effective = effectiveStatus(request, now);
  const senderPaysMinor = senderPaysMinorOf(request.payInAmountMinor, request.feeMinor, request.absorbFee);
  const isPaidStatus = ["funded", "payout_pending", "paid_out"].includes(effective);
  const isProcessingStatus = ["authorisation_in_progress", "payment_processing", "payment_pending"].includes(effective);
  const isPaidByCurrentUser =
    isPaidStatus && Boolean(currentUserId && request.payerUserId && request.payerUserId === currentUserId);
  const isReservedByCurrentUser =
    isProcessingStatus && Boolean(currentUserId && request.payerUserId && request.payerUserId === currentUserId);

  let sessionExpired = false;
  if (request.sessionExpiresAt && now.getTime() >= request.sessionExpiresAt.getTime()) {
    sessionExpired = true;
  }

  const normalizedSenderEmail = request.senderEmail?.trim().toLowerCase() ?? "";
  const isKnownSender = normalizedSenderEmail
    ? verifiedSenderEmails.has(normalizedSenderEmail) || !!request.senderName?.trim()
    : false;
  const savedAccountsEmail =
    currentUserEmail
    || (isEmailLink
      ? request.senderEmail
      : (isPaidByCurrentUser || isReservedByCurrentUser ? request.payerEmail : request.senderEmail));
  const savedAccounts = getPayerSavedAccounts(savedAccountsEmail, request);
  const numericRef = String(
    parseInt(createHash("sha256").update(request.requestNumber).digest("hex").slice(0, 8), 16) % 90_000_000 + 10_000_000,
  );

  return {
    requestNumber: request.requestNumber,
    requesterName: request.requesterName,
    requesterIdentity: "Rhemito customer",
    amount: fromMinorUnits(senderPaysMinor, request.payInCurrency),
    requestedAmount: fromMinorUnits(request.payInAmountMinor, request.payInCurrency),
    feeAmount: fromMinorUnits(request.feeMinor, request.payInCurrency),
    currency: request.payInCurrency,
    payoutCurrency: request.payoutCurrency,
    absorbFee: request.absorbFee,
    // Payment summary shown on the first screen of the link. The payout account is masked (bank + last 4 only).
    payoutAmount: request.payoutAmountMinor !== null
      ? fromMinorUnits(request.payoutAmountMinor, request.payoutCurrency)
      : null,
    fxRate: request.fxRate !== null ? Number(request.fxRate) : null,
    fxRateIsIndicative: request.fxRateIsIndicative,
    payoutBankName: request.payoutAccountBankName,
    payoutAccountMasked: request.payoutAccountMasked,
    purpose: currentUserId ? request.purpose : null,
    reference: currentUserId ? (request.reference ?? null) : null,
    dueDate: request.dueDate ?? null,
    expiresAt: request.expiresAt.toISOString(),
    expiryDate: dateInTz(request.expiresAt, EXPIRY_TIMEZONE),
    methods: currentUserId ? (corridor?.methods ?? []) : [],
    availableMethods: corridor?.methods ?? ["bank_transfer", "card"],
    estimatedDeliveryTime: currentUserId ? (corridor?.estimatedDeliveryTime ?? "") : "",
    senderFeeNote: currentUserId ? (request.absorbFee
      ? "No Rhemito fee is charged to you — the requester covers the fee."
      : `A 3% Rhemito fee of ${fromMinorUnits(request.feeMinor, request.payInCurrency)} ${request.payInCurrency} is included in the total.`
    ) : "",
    status: effectiveStatus(request, now),
    failureReason: currentUserId ? request.failureReason : null,
    legalEntity: serverConfig.legalEntity,
    isEmailLink,
    recipientEmailMasked: isEmailLink ? (request.recipientEmailMasked || (request.senderEmail ? maskEmail(request.senderEmail) : undefined)) : undefined,
    // Only expose the recipient's email when coming directly from the emailed link (/pay/e/:emailToken).
    // On a shared/copied link (/pay/:token), we do not know who opened the link, so they must enter their email and verify via OTP/PIN.
    demoPayerEmail: demoModeEnabled && isEmailLink ? (request.senderEmail ?? undefined) : undefined,
    senderName: request.senderName ?? null,
    senderType: request.senderType ?? "individual",
    isKnownSender: isEmailLink ? isKnownSender : false,
    payerSourceBankName: request.payerSourceBankName ?? null,
    payerSourceAccountMasked: request.payerSourceAccountMasked
      ? partiallyMaskSenderAccount(request.payerSourceAccountMasked)
      : null,
    payerSourceAccountNumber:
      (requestPayerFullAccountById.get(request.id) || request.payerSourceAccountMasked)
        ? partiallyMaskSenderAccount(requestPayerFullAccountById.get(request.id) || request.payerSourceAccountMasked || "")
        : null,
    payerSavedAccounts: savedAccounts,
    collectionAccount:
      (isProcessingStatus && !isReservedByCurrentUser) || (isPaidStatus && !isPaidByCurrentUser)
        ? undefined
        : {
            accountName: `PWA - MITO-${request.requesterName.toUpperCase()}`,
            bankName: request.payInCurrency === "NGN" ? "Fidelity" : request.payInCurrency === "GBP" ? "ClearBank" : "Citibank",
            accountNumber: request.payInCurrency === "NGN" ? "4580016814" : request.payInCurrency === "GBP" ? "04008291" : "8840192834",
            paymentReference: numericRef,
          },
    activeSessionId: currentUserId && !sessionExpired ? request.activeSessionId : null,
    sessionExpiresAt: currentUserId && !sessionExpired && request.sessionExpiresAt ? request.sessionExpiresAt.toISOString() : null,
    isReservedByOther: isProcessingStatus && !isReservedByCurrentUser,
    isPaidByCurrentUser,
  };
}

export function markViewed(request: MoneyRequest): void {
  if (request.status === "active") {
    void storage.updateMoneyRequest(request.id, { status: "viewed", viewedAt: new Date() });
  }
}

// ─── Payer Session (10-minute server timer after authentication & compliance) ──

export async function startPayerSession(params: {
  token: string;
  isEmailLink?: boolean;
  userId: string;
}): Promise<{
  sessionId: string;
  sessionExpiresAt: string;
  quote: QuoteSnapshot;
  payerName: string;
  payerEmail: string;
}> {
  const { token, isEmailLink = false, userId } = params;
  const request = await getRequestByTokenOrEmailToken(token, isEmailLink);
  if (!request) throw new RequestError(404, "NOT_FOUND", "This payment link is not valid.");

  const status = effectiveStatus(request);
  if (status === "paid_out" || status === "funded" || status === "payout_pending") {
    throw new RequestError(409, "ALREADY_PAID", ALREADY_PAID_MESSAGE);
  }
  if (status === "cancelled") {
    throw new RequestError(409, "CANCELLED", "This payment request was cancelled by the requester.");
  }
  if (status === "expired") {
    await materializeExpiry(request);
    throw new RequestError(410, "EXPIRED", "This payment request has expired.");
  }
  if (["authorisation_in_progress", "payment_processing", "payment_pending"].includes(status)) {
    throw new RequestError(409, "PAYMENT_IN_PROGRESS", PAYMENT_IN_PROGRESS_MESSAGE);
  }

  // Validate Payer account & KYC
  const user = await storage.getAuthUserById(userId);
  if (!user) throw new RequestError(401, "UNAUTHENTICATED", "Please sign in to proceed.");
  if (user.status === "blocked") throw new RequestError(403, "BLOCKED", "Your account is blocked. Please contact support.");
  if (user.status === "pending") throw new RequestError(403, "ACCOUNT_UNVERIFIED", "Please verify your account OTP first.");
  if (user.kycStatus === "pending") throw new RequestError(403, "KYC_PENDING", "Your identity verification is currently pending review.");
  if (user.kycStatus === "failed" || user.kycStatus === "rejected") throw new RequestError(403, "KYC_FAILED", "Your verification was unsuccessful.");

  const payerName = user.accountType === "business" && user.businessName
    ? user.businessName
    : [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" ") || user.email;
  const payerEmail = user.email;
  const payerEmailMasked = maskEmail(user.email);

  const corridor = findCorridor(request.corridorId);
  if (!corridor) throw new RequestError(400, "CORRIDOR_NOT_FOUND", "Corridor configuration missing.");

  const quote = await computeQuote(corridor, request.payInAmountMinor, request.absorbFee);
  const now = new Date();
  const sessionExpiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes
  const sessionId = randomUUID();

  const attempt: PaymentAttempt = {
    id: sessionId,
    requestId: request.id,
    requestNumber: request.requestNumber,
    payerId: userId,
    payerEmail,
    payerName,
    payerEmailMasked,
    paymentMethod: "pending",
    payCurrency: request.payInCurrency,
    payAmountMinor: senderPaysMinorOf(request.payInAmountMinor, request.feeMinor, request.absorbFee),
    feeMinor: request.feeMinor,
    absorbFee: request.absorbFee,
    fxRate: quote.fxRate !== null ? String(quote.fxRate) : null,
    status: "session_open",
    paymentReference: `PAY-${request.requestNumber}-${randomBytes(3).toString("hex").toUpperCase()}`,
    providerIntentId: null,
    providerPaymentRef: null,
    failureReason: null,
    sessionStartedAt: now,
    sessionExpiresAt,
    authorisationStartedAt: null,
    completedAt: null,
  };
  await storage.addPaymentAttempt(attempt);

  return {
    sessionId,
    sessionExpiresAt: sessionExpiresAt.toISOString(),
    quote,
    payerName,
    payerEmail,
  };
}

// ─── Pay-in Submission (Atomic Lock) ──────────────────────────────────────────

export async function createPayinIntent(params: {
  token: string;
  isEmailLink?: boolean;
  method: string;
  userId: string;
  sessionId: string;
}): Promise<{
  intentId: string;
  authorizationUrl: string;
  paymentReference: string;
  requestNumber: string;
}> {
  const { token, method, userId, sessionId, isEmailLink = false } = params;

  const request = await getRequestByTokenOrEmailToken(token, isEmailLink);
  if (!request) throw new RequestError(404, "NOT_FOUND", "This payment link is not valid.");

  const status = effectiveStatus(request);
  if (status === "paid_out" || status === "funded" || status === "payout_pending") {
    throw new RequestError(409, "ALREADY_PAID", ALREADY_PAID_MESSAGE);
  }
  if (status === "cancelled") {
    throw new RequestError(409, "CANCELLED", "This request was cancelled by the requester.");
  }
  if (status === "expired") {
    await materializeExpiry(request);
    throw new RequestError(410, "EXPIRED", "This request has expired.");
  }
  if (["authorisation_in_progress", "payment_processing", "payment_pending"].includes(status)) {
    throw new RequestError(409, "PAYMENT_IN_PROGRESS", PAYMENT_IN_PROGRESS_MESSAGE);
  }

  const corridor = findCorridor(request.corridorId);
  if (!corridor || !corridor.methods.includes(method as never)) {
    throw new RequestError(400, "METHOD_UNAVAILABLE", "That payment method is not available for this request.");
  }

  const user = await storage.getAuthUserById(userId);
  if (!user || user.status !== "active" || user.kycStatus !== "passed") {
    throw new RequestError(403, "NOT_ELIGIBLE", "Your account is not eligible to make this payment.");
  }
  const session = await storage.getPaymentAttemptById(sessionId);
  if (!session || session.requestId !== request.id || session.payerId !== userId || session.status !== "session_open") {
    throw new RequestError(409, "INVALID_SESSION", "Start a new payment session to continue.");
  }
  if (!session.sessionExpiresAt || session.sessionExpiresAt.getTime() <= Date.now()) {
    await storage.updatePaymentAttempt(session.id, { status: "session_expired", completedAt: new Date() });
    throw new RequestError(410, "SESSION_EXPIRED", "Your payment session has expired.");
  }
  const payerName = user.accountType === "business" && user.businessName
    ? user.businessName
    : [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" ") || user.email;
  const payerEmail = user.email;

  const paymentReference = `PAY-${request.requestNumber}-${randomBytes(3).toString("hex").toUpperCase()}`;
  const now = new Date();

  // Reserve before contacting the provider. Only one concurrent payer wins.
  const reserved = await storage.compareAndUpdateMoneyRequest(request.id, ["active", "viewed"], {
    status: "authorisation_in_progress",
    paymentInitiatedAt: now,
    paymentMethod: method,
    reservedAttemptId: session.id,
    payerUserId: userId,
    payerName,
    payerEmail,
    payerEmailMasked: maskEmail(payerEmail),
  });
  if (!reserved) {
    const latest = await storage.getMoneyRequestById(request.id);
    const latestStatus = latest ? effectiveStatus(latest) : status;
    if (latestStatus === "paid_out" || latestStatus === "funded" || latestStatus === "payout_pending") {
      throw new RequestError(409, "ALREADY_PAID", ALREADY_PAID_MESSAGE);
    }
    throw new RequestError(409, "PAYMENT_IN_PROGRESS", PAYMENT_IN_PROGRESS_MESSAGE);
  }

  let intent;
  try {
    intent = await devPayinProvider.createIntent({
      requestNumber: request.requestNumber,
      amountMinor: senderPaysMinorOf(request.payInAmountMinor, request.feeMinor, request.absorbFee),
      currency: request.payInCurrency,
      method,
      checkoutUrl: buildCheckoutUrl(request.token),
    });
  } catch (error) {
    await storage.compareAndUpdateMoneyRequest(request.id, ["authorisation_in_progress"], {
      status: effectiveStatus({ ...request, status: "viewed" }),
      paymentInitiatedAt: null,
      paymentMethod: null,
      reservedAttemptId: null,
      payerUserId: null,
      payerName: null,
      payerEmail: null,
      payerEmailMasked: null,
    });
    throw error;
  }

  await storage.updatePaymentAttempt(session.id, {
    paymentMethod: method,
    status: "authorisation_initiated",
    paymentReference,
    providerIntentId: intent.intentId,
    authorisationStartedAt: now,
  });
  await storage.updateMoneyRequest(request.id, {
    status: "payment_processing",
    payinIntentId: intent.intentId,
  });

  return {
    intentId: intent.intentId,
    authorizationUrl: intent.authorizationUrl,
    paymentReference,
    requestNumber: request.requestNumber,
  };
}

/**
 * Releases an un-settled pay-in reservation when the reserving payer backs out of
 * hosted/card authorisation or explicitly cancels before completing payment, so
 * another payer (or the same payer with another method) is not permanently blocked.
 */
export async function releasePayinIntent(params: {
  token: string;
  isEmailLink?: boolean;
  userId: string;
  intentId?: string | null;
}): Promise<{ released: boolean; sessionId: string | null }> {
  const { token, isEmailLink = false, userId, intentId } = params;
  const request = await getRequestByTokenOrEmailToken(token, isEmailLink);
  if (!request) throw new RequestError(404, "NOT_FOUND", "This payment link is not valid.");

  if (
    !["authorisation_in_progress", "payment_processing"].includes(request.status)
    || request.payerUserId !== userId
    || (intentId && request.payinIntentId && request.payinIntentId !== intentId)
  ) {
    return { released: false, sessionId: null };
  }

  const now = new Date();
  const previousAttempt = request.reservedAttemptId
    ? await storage.getPaymentAttemptById(request.reservedAttemptId)
    : undefined;

  const nextStatus = now.getTime() >= request.expiresAt.getTime() ? "expired" : "viewed";
  const released = await storage.compareAndUpdateMoneyRequest(
    request.id,
    ["authorisation_in_progress", "payment_processing"],
    {
      status: nextStatus,
      paymentInitiatedAt: null,
      payinIntentId: null,
      paymentMethod: null,
      reservedAttemptId: null,
      payerUserId: null,
      payerName: null,
      payerEmail: null,
      payerEmailMasked: null,
    },
  );
  if (!released) {
    return { released: false, sessionId: null };
  }

  if (previousAttempt) {
    await storage.updatePaymentAttempt(previousAttempt.id, {
      status: "provider_cancelled",
      failureReason: "Cancelled by payer before authorisation.",
      completedAt: now,
    });
  }

  if (
    nextStatus === "viewed"
    && previousAttempt
    && previousAttempt.sessionExpiresAt
    && previousAttempt.sessionExpiresAt.getTime() > now.getTime()
  ) {
    const newSessionId = randomUUID();
    await storage.addPaymentAttempt({
      ...previousAttempt,
      id: newSessionId,
      paymentMethod: "pending",
      status: "session_open",
      paymentReference: `PAY-${request.requestNumber}-${randomBytes(3).toString("hex").toUpperCase()}`,
      providerIntentId: null,
      providerPaymentRef: null,
      failureReason: null,
      authorisationStartedAt: null,
      completedAt: null,
    });
    return { released: true, sessionId: newSessionId };
  }

  return { released: true, sessionId: null };
}

// ─── Request New Link for Expired Requests ────────────────────────────────────

export async function requestNewPaymentLink(
  token: string,
  isEmailLink = false,
  payerEmail?: string,
): Promise<{ success: true; message: string }> {
  const request = await getRequestByTokenOrEmailToken(token, isEmailLink);
  if (!request) throw new RequestError(404, "NOT_FOUND", "This payment link is not valid.");

  if (request.status === "paid_out" || request.status === "funded" || request.status === "payout_pending") {
    throw new RequestError(409, "ALREADY_PAID", "This request has already been paid.");
  }
  if (request.status === "cancelled") {
    throw new RequestError(409, "CANCELLED", "This request was cancelled.");
  }

  const status = effectiveStatus(request);
  if (status !== "expired") {
    throw new RequestError(400, "NOT_EXPIRED", "This request has not expired yet.");
  }

  const resolvedPayerEmail = payerEmail || request.senderEmail;
  if (!resolvedPayerEmail) {
    throw new RequestError(400, "PAYER_EMAIL_REQUIRED", "Enter your email to ask for a new link.");
  }
  const normalizedPayerEmail = resolvedPayerEmail.toLowerCase();
  const existingRenewal = (await storage.listRenewalRequests(request.id))
    .find((item) => item.payerEmail?.toLowerCase() === normalizedPayerEmail);
  if (existingRenewal) {
    return { success: true, message: "The requester has already been notified to issue a new payment link." };
  }

  const renewal: RequestRenewalRequest = {
    id: randomUUID(),
    requestId: request.id,
    requestNumber: request.requestNumber,
    requesterId: request.requesterId,
    payerEmail: normalizedPayerEmail,
    requestedAt: new Date(),
  };
  await storage.addRenewalRequest(renewal);

  const requester = await storage.getAuthUserById(request.requesterId);
  if (requester?.email) {
    try {
      await devEmailProvider.send({
        to: requester.email,
        subject: `New payment link requested for ${request.requestNumber}`,
        text:
          `Hello ${request.requesterName},\n\n` +
          `A payer has requested a new payment link for expired request ${request.requestNumber} (${request.payInCurrency} ${fromMinorUnits(request.payInAmountMinor, request.payInCurrency)}).\n\n` +
          `You can generate a new payment request from your Rhemito Dashboard:\n${serverConfig.publicBaseUrl}/request-payment\n\n` +
          `— Rhemito Team`,
      });
    } catch (err) {
      console.error("[requestService] failed to send renewal notification:", err);
    }
  }

  await dispatchNotification({
    userId: request.requesterId,
    type: "money_request_new_link_requested",
    data: {
      requestNumber: request.requestNumber,
      payerName: normalizedPayerEmail,
      amount: fromMinorUnits(request.payInAmountMinor, request.payInCurrency),
      currency: request.payInCurrency,
    },
  });

  return { success: true, message: "A notification has been sent to the requester to issue a new payment link." };
}

// ─── Webhook processing — the ONLY path that funds a request ──────────────────

export async function processPayinWebhook(rawBody: Buffer, signature: string): Promise<{ accepted: true }> {
  if (!verifyWebhookSignature(rawBody, signature)) {
    throw new RequestError(401, "BAD_SIGNATURE", "Invalid webhook signature.");
  }

  let event: PayinWebhookEvent;
  try {
    event = JSON.parse(rawBody.toString("utf8")) as PayinWebhookEvent;
  } catch {
    throw new RequestError(400, "BAD_PAYLOAD", "Malformed webhook payload.");
  }
  if (!event.eventId || !event.type || !event.requestNumber) {
    throw new RequestError(400, "BAD_PAYLOAD", "Webhook payload missing required fields.");
  }

  // Idempotent processing.
  const seen = await storage.getWebhookEvent("payin", event.eventId);
  if (seen) return { accepted: true };
  await storage.addWebhookEvent({
    id: randomUUID(),
    provider: "payin",
    eventId: event.eventId,
    eventType: event.type,
    processedAt: new Date(),
    requestNumber: event.requestNumber,
  });

  const request = Array.from(
    (await storage.listAllMoneyRequestsRaw()).filter((r) => r.requestNumber === event.requestNumber),
  )[0];
  if (!request) return { accepted: true }; // unknown request: acknowledge, ignore

  if (event.type === "payment.succeeded") {
    // Validate the webhook against the request before funding anything.
    if (request.payinIntentId !== event.intentId) return { accepted: true };
    const senderPaysMinor = senderPaysMinorOf(request.payInAmountMinor, request.feeMinor, request.absorbFee);
    if (event.amountMinor !== senderPaysMinor || event.currency !== request.payInCurrency) {
      console.error(`[requestService] webhook amount mismatch for ${request.requestNumber} — ignored`);
      return { accepted: true };
    }
    if (!["authorisation_in_progress", "payment_processing", "payment_pending"].includes(request.status)) return { accepted: true };

    const fundedAt = new Date();
    const funded = await storage.compareAndUpdateMoneyRequest(
      request.id,
      ["authorisation_in_progress", "payment_processing", "payment_pending"],
      {
        status: "funded",
        fundedAt,
        providerPaymentRef: event.providerPaymentRef,
      },
    );
    if (!funded) return { accepted: true };

    if (request.reservedAttemptId) {
      await storage.updatePaymentAttempt(request.reservedAttemptId, {
        status: "successful",
        providerPaymentRef: event.providerPaymentRef,
        completedAt: fundedAt,
      });
    }

    // Close any other concurrent open payer sessions so only one full payment is ever valid.
    const otherAttempts = await storage.listPaymentAttempts(request.id);
    await Promise.all(
      otherAttempts
        .filter((attempt) => attempt.id !== request.reservedAttemptId && attempt.status === "session_open")
        .map((attempt) =>
          storage.updatePaymentAttempt(attempt.id, {
            status: "session_expired",
            failureReason: "Request was already paid by another payer.",
            completedAt: fundedAt,
          }),
        ),
    );
    await postFundingEntries(request, event.providerPaymentRef);
    const requester = await storage.getAuthUserById(request.requesterId);
    if (request.payerEmail) {
      await sendLifecycleEmail(
        request, request.payerEmail, `Payment successful: ${request.requestNumber}`,
        `Your payment to ${request.requesterName} was successful. Payment reference: ${request.reservedAttemptId ?? request.requestNumber}.`,
        `${request.id}:payer:successful`,
      );
    }
    if (requester?.email) {
      await sendLifecycleEmail(
        request, requester.email, `Payment received: ${request.requestNumber}`,
        `Your payment request has been paid successfully.`, `${request.id}:requester:paid`,
      );
    }

    await dispatchNotification({
      userId: request.requesterId,
      type: "money_request_paid",
      data: {
        requestNumber: request.requestNumber,
        payerName: request.payerName ?? "Payer",
        amount: fromMinorUnits(request.payInAmountMinor, request.payInCurrency),
        currency: request.payInCurrency,
      },
    });
    // A paid request can earn the requester a Request Money bonus (decided by Mito Admin's scheme rules)
    void onMoneyRequestPaid(request.requesterId, {
      requestNumber: request.requestNumber,
      amount: fromMinorUnits(request.payInAmountMinor, request.payInCurrency),
      currency: request.payInCurrency,
    });

    // Payout eligibility passed (single-tier prototype): submit to the payout provider.
    const payout = await devPayoutProvider.submitPayout({
      requestNumber: request.requestNumber,
      amountMinor: payoutTotalMinor(request),
      currency: request.payoutCurrency,
      maskedAccount: request.payoutAccountMasked,
    });
    await storage.updateMoneyRequest(request.id, {
      status: "payout_pending",
      payoutSubmittedAt: new Date(),
      payoutProviderRef: payout.payoutRef,
    });

    // Development stub: simulate the bank's settlement webhook through the
    // same signed boundary. A real provider calls /api/webhooks/payout.
    const settlement: PayinWebhookEvent = {
      eventId: `payoutsettle_${payout.payoutRef}`,
      type: "payout.succeeded",
      intentId: payout.payoutRef,
      requestNumber: request.requestNumber,
      amountMinor: payoutTotalMinor(request),
      currency: request.payoutCurrency,
      providerPaymentRef: payout.payoutRef,
    };
    const settlementBody = Buffer.from(JSON.stringify(settlement), "utf8");
    const settlementSignature = signWebhookPayload(settlementBody);
    setTimeout(() => {
      void processPayoutWebhook(settlementBody, settlementSignature).catch((err) =>
        console.error("[requestService] simulated payout webhook failed:", err),
      );
    }, serverConfig.devProvider.payoutSettlementDelayMs);
  } else if (event.type === "payment.failed" || event.type === "payment.cancelled") {
    if (["authorisation_in_progress", "payment_processing", "payment_pending"].includes(request.status)) {
      if (request.payinIntentId !== event.intentId) return { accepted: true };
      const completedAt = new Date();
      if (request.reservedAttemptId) {
        await storage.updatePaymentAttempt(request.reservedAttemptId, {
          status: event.type === "payment.cancelled" ? "provider_cancelled" : "failed",
          providerPaymentRef: event.providerPaymentRef,
          failureReason: "The payment was not completed.",
          completedAt,
        });
      }
      if (request.payerEmail) {
        await sendLifecycleEmail(
          request, request.payerEmail, `Payment not completed: ${request.requestNumber}`,
          "Your payment was not completed. You may try again if the request remains active.",
          `${request.id}:${request.reservedAttemptId ?? event.intentId}:payer:failed`,
        );
      }
      await storage.updateMoneyRequest(request.id, {
        status: completedAt.getTime() >= request.expiresAt.getTime() ? "expired" : "viewed",
        paymentInitiatedAt: null,
        payinIntentId: null,
        reservedAttemptId: null,
        payerUserId: null,
        payerName: null,
        payerEmail: null,
        payerEmailMasked: null,
        failureReason: "Payment failed at the provider.",
      });
    }
  } else if (event.type === "payment.refunded") {
    // Money that was received is being returned to the payer: the request is no longer a completed payment,
    // and any Request Money bonus it earned is taken back.
    if (["funded", "payout_pending", "paid_out"].includes(request.status) && request.providerPaymentRef === event.providerPaymentRef) {
      await storage.updateMoneyRequest(request.id, { status: "refunded", failureReason: "Payment refunded to the payer." });
      promo.onRequestStatus(request, "REFUNDED");
      void onMoneyRequestRefunded(request.requesterId, request.requestNumber);
    }
  } else if (event.type === "payment.pending" || event.type === "payment.unknown") {
    if (request.payinIntentId === event.intentId && ["authorisation_in_progress", "payment_processing", "payment_pending"].includes(request.status)) {
      await storage.updateMoneyRequest(request.id, { status: "payment_processing" });
      if (request.reservedAttemptId) {
        await storage.updatePaymentAttempt(request.reservedAttemptId, {
          status: event.type === "payment.pending" ? "pending" : "unknown",
          providerPaymentRef: event.providerPaymentRef,
        });
      }
    }
  }

  return { accepted: true };
}

export async function processPayoutWebhook(rawBody: Buffer, signature: string): Promise<{ accepted: true }> {
  if (!verifyWebhookSignature(rawBody, signature)) {
    throw new RequestError(401, "BAD_SIGNATURE", "Invalid webhook signature.");
  }

  let event: PayinWebhookEvent;
  try {
    event = JSON.parse(rawBody.toString("utf8")) as PayinWebhookEvent;
  } catch {
    throw new RequestError(400, "BAD_PAYLOAD", "Malformed webhook payload.");
  }

  const seen = await storage.getWebhookEvent("payout", event.eventId);
  if (seen) return { accepted: true };
  await storage.addWebhookEvent({
    id: randomUUID(),
    provider: "payout",
    eventId: event.eventId,
    eventType: event.type,
    processedAt: new Date(),
    requestNumber: event.requestNumber,
  });

  const request = Array.from(
    (await storage.listAllMoneyRequestsRaw()).filter((r) => r.requestNumber === event.requestNumber),
  )[0];
  if (!request) return { accepted: true };

  if (event.type === "payout.succeeded" && request.status === "payout_pending") {
    await postPayoutEntry(request, event.providerPaymentRef);
    await storage.updateMoneyRequest(request.id, { status: "paid_out", paidOutAt: new Date() });
    promo.onRequestStatus(request, "PAID_OUT");
  } else if (event.type === "payout.failed" && request.status === "payout_pending") {
    // Funds remain credited; the failed payout stays visible and recoverable.
    await storage.updateMoneyRequest(request.id, {
      status: "failed",
      failureReason: "Bank payout failed — funds remain in your Rhemito wallet for retry.",
    });
  }

  return { accepted: true };
}

// ─── Requester actions ─────────────────────────────────────────────────────────

export async function cancelRequest(userId: string, requestId: string): Promise<void> {
  const request = await getOwnRequest(userId, requestId);
  const status = effectiveStatus(request);
  if (status !== "active" && status !== "viewed") {
    throw new RequestError(409, "INVALID_STATE", "This request can no longer be cancelled.");
  }
  await storage.updateMoneyRequest(request.id, { status: "cancelled", cancelledAt: new Date() });
  promo.onRequestStatus(request, "CANCELLED");
  const attempts = await storage.listPaymentAttempts(request.id);
  const activePayerEmails = attempts
    .filter((attempt) => attempt.status === "session_open" && !!attempt.sessionExpiresAt && attempt.sessionExpiresAt.getTime() > Date.now())
    .map((attempt) => attempt.payerEmail);
  const recipients = Array.from(new Set([request.senderEmail, ...activePayerEmails].filter((email): email is string => !!email).map((email) => email.toLowerCase())));
  await Promise.all(recipients.map((email) => sendLifecycleEmail(
    request, email, `Payment request cancelled: ${request.requestNumber}`,
    `${request.requesterName} cancelled this payment request. No payment can be submitted.`,
    `${request.id}:cancelled:${email}`,
  )));

  await dispatchNotification({
    userId,
    type: "money_request_cancelled",
    data: {
      requestNumber: request.requestNumber,
      senderName: request.senderName ?? "Any payer",
      amount: fromMinorUnits(request.payInAmountMinor, request.payInCurrency),
      currency: request.payInCurrency,
    },
  });
}

export async function extendExpiry(userId: string, requestId: string): Promise<Date> {
  const request = await getOwnRequest(userId, requestId);
  const status = effectiveStatus(request);
  if (status !== "active" && status !== "viewed") {
    throw new RequestError(409, "INVALID_STATE", "Expiry can only be extended while awaiting payment.");
  }
  if (request.expiryExtendedOnce) {
    throw new RequestError(409, "ALREADY_EXTENDED", "This request's expiry has already been extended once.");
  }
  const current = request.expiresAt.getTime();
  const now = Date.now();
  const base = Math.max(current, now);
  const extended = new Date(base + serverConfig.maxExpiryExtensionDays * 24 * 60 * 60 * 1000);
  await storage.updateMoneyRequest(request.id, { expiresAt: extended, expiryExtendedOnce: true });
  return extended;
}

// ─── Requester serialization (masked accounts) ─────────────────────────────────

export function toRequestJSON(request: MoneyRequest) {
  return {
    id: request.id,
    requestNumber: request.requestNumber,
    status: effectiveStatus(request),
    senderName: request.senderName,
    senderEmail: request.senderEmail,
    senderType: request.senderType,
    senderCountry: request.senderCountry,
    payInAmount: fromMinorUnits(request.payInAmountMinor, request.payInCurrency),
    payInCurrency: request.payInCurrency,
    senderPaysAmount: fromMinorUnits(
      senderPaysMinorOf(request.payInAmountMinor, request.feeMinor, request.absorbFee),
      request.payInCurrency,
    ),
    feeAmount: fromMinorUnits(request.feeMinor, request.payInCurrency),
    absorbFee: request.absorbFee,
    payoutAmount:
      request.payoutAmountMinor !== null
        ? fromMinorUnits(request.payoutAmountMinor, request.payoutCurrency)
        : null,
    payoutCurrency: request.payoutCurrency,
    fxRate: request.fxRate !== null ? Number(request.fxRate) : null,
    fxRateIsIndicative: request.fxRateIsIndicative,
    fxMarkupApplied: request.fxMarkupApplied !== null ? Number(request.fxMarkupApplied) : null,
    payoutAccount: {
      bankName: request.payoutAccountBankName,
      maskedNumber: request.payoutAccountMasked,
      holderName: request.payoutAccountHolderName,
      country: request.payoutAccountCountry,
    },
    purpose: request.purpose,
    reference: request.reference ?? null,
    corridorId: request.corridorId,
    paymentMethod: request.paymentMethod ?? null,
    checkoutUrl: buildCheckoutUrl(request.token),
    emailCheckoutUrl: buildEmailCheckoutUrl(request.emailToken || request.token),
    payerName: request.payerName ?? null,
    payerEmailMasked: request.payerEmailMasked ?? null,
    dueDate: request.dueDate ?? null,
    expiresAt: request.expiresAt.toISOString(),
    expiryExtendedOnce: request.expiryExtendedOnce,
    viewedAt: request.viewedAt?.toISOString() ?? null,
    fundedAt: request.fundedAt?.toISOString() ?? null,
    paidOutAt: request.paidOutAt?.toISOString() ?? null,
    cancelledAt: request.cancelledAt?.toISOString() ?? null,
    failureReason: request.failureReason ?? null,
    createdAt: request.createdAt?.toISOString() ?? null,
  };
}

// ─── Sweep ─────────────────────────────────────────────────────────────────────

async function materializeExpiry(request: MoneyRequest): Promise<void> {
  if (request.status === "active" || request.status === "viewed") {
    await storage.updateMoneyRequest(request.id, { status: "expired" });
    promo.onRequestStatus(request, "EXPIRED");
    const requester = await storage.getAuthUserById(request.requesterId);
    if (requester?.email) {
      await sendLifecycleEmail(
        request, requester.email, `Payment request expired: ${request.requestNumber}`,
        "Your payment request expired without a successful or processing payment.",
        `${request.id}:requester:expired`,
      );
    }
  }
}

async function sweepOnce(): Promise<void> {
  const now = new Date();
  for (const rawRequest of await storage.listAllMoneyRequestsRaw()) {
    try {
      const request = await releaseExpiredReservationIfNeeded(rawRequest, now);
      if (now.getTime() >= request.expiresAt.getTime()) {
        await materializeExpiry(request);
      }
      // Pending/unknown provider outcomes remain reserved until provider
      // reconciliation supplies a definitive result. Browser/session expiry is
      // never treated as a financial failure.
    } catch (err) {
      console.error(`[requestService] sweep failed for ${rawRequest.id}:`, err);
    }
  }
}

let sweepTimer: NodeJS.Timeout | null = null;

export function startRequestSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    void sweepOnce().catch((err) => console.error("[requestService] sweep error:", err));
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref();
}

