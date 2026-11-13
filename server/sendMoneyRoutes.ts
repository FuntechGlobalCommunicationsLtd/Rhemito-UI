/**
 * Send Money routes — the server-owned transaction store behind the wizard and
 * the Dashboard unified Transactions table.
 *
 * Follows the conventions of requestRoutes.ts: strict session auth with the
 * prototype demo-user stand-in (demo mode only), { error: { code, message } }
 * errors, { data } success envelope, and amounts in integer minor units.
 */

import type { Express, Request, Response } from "express";
import { randomUUID } from "crypto";
import { storage } from "./storage";
import { demoModeEnabled } from "./config";
import { dispatchNotification } from "./notificationService";
import { onTransferEvent, syncCustomer } from "./rewardsService";
import * as promo from "./promo";
import * as bonus from "./bonus";
import { toMinorUnits, fromMinorUnits } from "@shared/money";
import { formatDocumentNumber } from "@shared/invoice-logic";
import {
  createSendMoneyTransactionSchema,
  paySendMoneyTransactionSchema,
  statusForPaymentMethod,
  type SendMoneyService,
  type SendMoneyTransaction,
  type SendMoneyTransactionView,
} from "@shared/sendMoney";
import {
  DEFAULT_MITO_SENDER_USER_ID,
  createMitoBeneficiary,
  createMitoKycJourney,
  deleteMitoBeneficiary,
  updateMitoBeneficiary,
  MitoBeneficiaryCreationError,
  currencyToCountryIso3,
  getMitoAffiliateRates,
  getMitoBeneficiaries,
  getDeletedMitoBeneficiariesSnapshot,
  getMitoBeneficiaryRequirements,
  getMitoJourneyStatus,
  getMitoLookupTypes,
  getMitoProviders,
  getMitoUserIdForUser,
  getMitoWebhookInspectorLogs,
  getMitoWebhookUrl,
  initiateMitoHostedTransaction,
  isMitoRetailConfigured,
  lockMitoExchangeRate,
  recordMitoWebhookInspectorLog,
  registerOrSyncMitoRetailUser,
  resolveRhemitoUserIdFromMitoUserId,
  saveMitoBeneficiaryLatestTxnDetails,
  sendMitoTransaction,
  serviceToMitoCollectionMode,
  signMitoWebhookPayload,
  toCountryIso3,
  verifyMitoWebhookSignature,
  type MitoSendMoneyPaymentMethod,
} from "./mitoRetail";

class SendMoneyError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requireStrictAuth(req: Request): string {
  const userId = req.session?.userId;
  if (userId) return userId;
  // Dashboard demo experience: in prototype demo mode the seeded demo user
  // stands in for an anonymous dashboard visitor so the wizard keeps working
  // without a sign-in prompt (same policy as the Request Money routes).
  if (demoModeEnabled) {
    return "user_123";
  }
  throw new SendMoneyError(401, "UNAUTHENTICATED", "Please sign in to continue.");
}

function firstZodMessage(err: { issues: { message: string }[] }): string {
  return err.issues[0]?.message ?? "Invalid request.";
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof SendMoneyError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error("[sendMoneyRoutes] unexpected error:", err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } });
}

const SERVICE_LABELS: Record<SendMoneyService, string> = {
  bank_deposit: "Bank Deposit",
  mobile_money: "Mobile Money",
  cash_pickup: "Cash Pickup",
};

function toView(tx: SendMoneyTransaction): SendMoneyTransactionView {
  return {
    id: tx.id,
    reference: tx.reference,
    recipientName: tx.recipientName,
    service: tx.service,
    paymentMethod: tx.paymentMethod,
    sendCurrency: tx.sendCurrency,
    sendAmount: fromMinorUnits(tx.sendAmountMinor, tx.sendCurrency),
    receiveCurrency: tx.receiveCurrency,
    receiveAmount: fromMinorUnits(tx.receiveAmountMinor, tx.receiveCurrency),
    fee: fromMinorUnits(tx.feeMinor, tx.sendCurrency),
    exchangeRate: tx.exchangeRate,
    promoCode: tx.promoCode,
    promoDiscount: tx.promoDiscountMinor ? fromMinorUnits(tx.promoDiscountMinor, tx.sendCurrency) : null,
    ...(tx.promoAppliesTo === "amount" ? { promoAppliesTo: "amount" as const } : {}),
    bonusCredit: tx.bonusCreditMinor ? fromMinorUnits(tx.bonusCreditMinor, tx.sendCurrency) : null,
    bonusCreditMode: tx.bonusCreditMinor ? tx.bonusCreditMode ?? null : null,
    ...(tx.mitoUserId ? { mitoUserId: tx.mitoUserId } : {}),
    ...(tx.mitoBeneficiaryId ? { mitoBeneficiaryId: tx.mitoBeneficiaryId } : {}),
    ...(typeof tx.mitoBeneficiaryCreated === "boolean" ? { mitoBeneficiaryCreated: tx.mitoBeneficiaryCreated } : {}),
    ...(tx.mitoProviderId ? { mitoProviderId: tx.mitoProviderId } : {}),
    ...(tx.mitoProviderCode ? { mitoProviderCode: tx.mitoProviderCode } : {}),
    ...(tx.mitoRateId ? { mitoRateId: tx.mitoRateId } : {}),
    ...(tx.mitoKycUrl !== undefined ? { mitoKycUrl: tx.mitoKycUrl } : {}),
    ...(typeof tx.mitoIsTransactionAllowed === "boolean" ? { mitoIsTransactionAllowed: tx.mitoIsTransactionAllowed } : {}),
    ...(typeof tx.mitoIsKycRequired === "boolean" ? { mitoIsKycRequired: tx.mitoIsKycRequired } : {}),
    ...(typeof tx.mitoIsProfileUpdateRequired === "boolean" ? { mitoIsProfileUpdateRequired: tx.mitoIsProfileUpdateRequired } : {}),
    ...(tx.mitoTransactionId ? { mitoTransactionId: tx.mitoTransactionId } : {}),
    ...(tx.mitoReference ? { mitoReference: tx.mitoReference } : {}),
    ...(tx.mitoRequiredAction ? { mitoRequiredAction: tx.mitoRequiredAction } : {}),
    ...(tx.mitoHostedUrl ? { mitoHostedUrl: tx.mitoHostedUrl } : {}),
    ...(tx.mitoHostedPayload ? { mitoHostedPayload: tx.mitoHostedPayload } : {}),
    ...(tx.mitoPaymentUrl ? { mitoPaymentUrl: tx.mitoPaymentUrl } : {}),
    ...(tx.mitoPaymentSession ? { mitoPaymentSession: tx.mitoPaymentSession } : {}),
    ...(tx.mitoLinkToken ? { mitoLinkToken: tx.mitoLinkToken } : {}),
    ...(tx.mitoPaymentReference ? { mitoPaymentReference: tx.mitoPaymentReference } : {}),
    ...(tx.mitoCheckoutPublicKey ? { mitoCheckoutPublicKey: tx.mitoCheckoutPublicKey } : {}),
    ...(tx.mitoSendMoneyPayload ? { mitoSendMoneyPayload: tx.mitoSendMoneyPayload } : {}),
    ...(tx.sendCountryIso3 ? { sendCountryIso3: tx.sendCountryIso3 } : {}),
    ...(tx.receiveCountryIso3 ? { receiveCountryIso3: tx.receiveCountryIso3 } : {}),
    ...(tx.relationship ? { relationship: tx.relationship } : {}),
    ...(tx.relationId ? { relationId: tx.relationId } : {}),
    ...(tx.reasonCode ? { reasonCode: tx.reasonCode } : {}),
    ...(tx.reasonId ? { reasonId: tx.reasonId } : {}),
    ...(tx.otherReason ? { otherReason: tx.otherReason } : {}),
    ...(tx.sourceOfFundCode ? { sourceOfFundCode: tx.sourceOfFundCode } : {}),
    ...(tx.paymentNarration ? { paymentNarration: tx.paymentNarration } : {}),
    status: tx.status,
    createdAt: tx.createdAt.toISOString(),
    paidAt: tx.paidAt ? tx.paidAt.toISOString() : null,
    cancelledAt: tx.cancelledAt ? tx.cancelledAt.toISOString() : null,
  };
}

/** Notification payloads keep the exact shape the client used to dispatch itself. */
function notificationData(tx: SendMoneyTransaction) {
  return {
    txnId: tx.reference,
    recipientName: tx.recipientName,
    amount: `${tx.sendCurrency} ${fromMinorUnits(tx.sendAmountMinor, tx.sendCurrency)}`,
    service: SERVICE_LABELS[tx.service],
  };
}

async function getOwnedTransaction(idOrReference: string, userId: string): Promise<SendMoneyTransaction> {
  const direct = await storage.getSendMoneyTransactionById(idOrReference);
  const tx = direct ?? (await storage.listSendMoneyTransactionsByOwner(userId)).find((t) => t.reference === idOrReference);
  if (!tx || tx.ownerId !== userId) {
    throw new SendMoneyError(404, "NOT_FOUND", "Transaction not found.");
  }
  return tx;
}

export function registerSendMoneyRoutes(app: Express): void {
  /**
   * Step 1: Live corridor rate from `GET {{base_url}}/api/v1/mito/Exchange/affiliateRates`.
   */
  app.get("/api/send-money/mito/affiliate-rates", async (req: Request, res: Response) => {
    try {
      const fromCurrency = String(req.query.fromCurrency || "GBP").trim().toUpperCase();
      const toCurrency = String(req.query.toCurrency || "NGN").trim().toUpperCase();
      const fromCountry = req.query.fromCountry ? String(req.query.fromCountry).trim().toUpperCase() : undefined;
      const toCountry = req.query.toCountry ? String(req.query.toCountry).trim().toUpperCase() : undefined;

      const rates = await getMitoAffiliateRates({
        fromCurrency,
        toCurrency,
        fromCountry,
        toCountry,
      });

      let matched =
        rates.find(
          (r) =>
            r.fromCurrency.toUpperCase() === fromCurrency &&
            r.toCurrency.toUpperCase() === toCurrency &&
            r.rateMoneyTransfer > 0,
        ) ||
        rates.find(
          (r) =>
            r.fromCurrency.toUpperCase() === fromCurrency &&
            r.toCurrency.toUpperCase() === toCurrency,
        );

      if (!matched) {
        const allRates = await getMitoAffiliateRates();
        matched =
          allRates.find(
            (r) =>
              r.fromCurrency.toUpperCase() === fromCurrency &&
              r.toCurrency.toUpperCase() === toCurrency &&
              r.rateMoneyTransfer > 0,
          ) ||
          allRates.find(
            (r) =>
              r.fromCurrency.toUpperCase() === fromCurrency &&
              r.toCurrency.toUpperCase() === toCurrency,
          );
      }

      return res.json({
        data: {
          fromCurrency,
          toCurrency,
          rateId: matched?.rateId ?? null,
          rate: matched && matched.rateMoneyTransfer > 0 ? matched.rateMoneyTransfer : null,
          partnerRate: matched && matched.partnerRateMoneyTransfer > 0 ? matched.partnerRateMoneyTransfer : null,
          rateExpiry: matched?.rateExpiry ?? null,
          rates,
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * Step 3: Beneficiary bank providers from `GET {{base_url}}/api/v1/mito/Lookups/provider`.
   * Query parameters: `countryIso3`, `serviceCode`, `collectionMode` (BANKACCOUNT | MOBILEMONEY), `CurrencyCode`.
   */
  app.get("/api/send-money/mito/providers", async (req: Request, res: Response) => {
    try {
      const rawCurrency = req.query.CurrencyCode || req.query.currencyCode || req.query.currency;
      const currencyCode = rawCurrency ? String(rawCurrency).trim().toUpperCase() : "NGN";
      const countryIso3 = req.query.countryIso3 || req.query.country
        ? toCountryIso3(String(req.query.countryIso3 || req.query.country))
        : currencyToCountryIso3(currencyCode);
      const serviceCode = String(req.query.serviceCode || "MONEYTRANSFER").trim().toUpperCase();
      const collectionMode = serviceToMitoCollectionMode(
        String(req.query.collectionMode || req.query.service || "BANKACCOUNT"),
      );

      const providers = await getMitoProviders({
        countryIso3,
        currencyCode,
        serviceCode,
        collectionMode,
      });

      return res.json({
        data: {
          countryIso3,
          currencyCode,
          serviceCode,
          collectionMode,
          providers,
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * Step 3: Dynamic Beneficiary Requirements by country/currency/provider/entityType
   * from `GET {{base_url}}/api/v1/mito/Beneficiaries/requirements`.
   */
  app.get("/api/send-money/mito/beneficiary-requirements", async (req: Request, res: Response) => {
    try {
      const toCurrencyCode = String(req.query.toCurrencyCode || req.query.CurrencyCode || req.query.currencyCode || req.query.currency || "NGN")
        .trim()
        .toUpperCase();
      const toCountry = req.query.toCountry || req.query.countryIso3
        ? toCountryIso3(String(req.query.toCountry || req.query.countryIso3))
        : currencyToCountryIso3(toCurrencyCode);
      const entityTypeRaw = String(req.query.entityType || "I").trim().toUpperCase();
      const entityType: "I" | "B" = entityTypeRaw === "B" || entityTypeRaw === "BUSINESS" ? "B" : "I";
      const collectionMode = serviceToMitoCollectionMode(
        String(req.query.collectionMode || req.query.service || "BANKACCOUNT"),
      );

      let providerId = String(req.query.providerId || "").trim();
      if (!providerId) {
        const providers = await getMitoProviders({
          countryIso3: toCountry,
          currencyCode: toCurrencyCode,
          serviceCode: "MONEYTRANSFER",
          collectionMode,
        });
        providerId = providers[0]?.providerId || "";
      }

      const requirements = providerId
        ? await getMitoBeneficiaryRequirements({
            providerId,
            toCountry,
            toCurrencyCode,
            entityType,
            serviceCode: "MONEYTRANSFER",
            collectionMode,
          })
        : [];

      return res.json({
        data: {
          providerId,
          toCountry,
          toCurrencyCode,
          entityType,
          collectionMode,
          requirements,
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * Step 2: Fetch sender's beneficiaries from `GET {{base_url}}/api/v1/mito/Beneficiaries?userId={{userId}}`.
   */
  app.get("/api/send-money/mito/beneficiaries", async (req: Request, res: Response) => {
    try {
      const userId = requireStrictAuth(req);
      let mitoUserId: string | null = req.query.userId ? String(req.query.userId).trim() : null;

      if (!mitoUserId) {
        const authUser = await storage.getAuthUserById(userId);
        if (authUser) {
          mitoUserId =
            getMitoUserIdForUser(authUser.id, authUser.email) ||
            (await registerOrSyncMitoRetailUser(authUser));
        }
      }

      if (!mitoUserId) {
        return res.json({ data: { userId: null, configured: isMitoRetailConfigured(), beneficiaries: [] } });
      }

      const serviceCode = req.query.serviceCode ? String(req.query.serviceCode).trim().toUpperCase() : undefined;
      const collectionMode = req.query.collectionMode
        ? serviceToMitoCollectionMode(String(req.query.collectionMode))
        : req.query.service
          ? serviceToMitoCollectionMode(String(req.query.service))
          : undefined;
      const legalEntityType = req.query.legalEntityType ? String(req.query.legalEntityType).trim() : undefined;
      const currencyIso = req.query.currencyIso || req.query.currency
        ? String(req.query.currencyIso || req.query.currency).trim().toUpperCase()
        : undefined;
      const countryIso3 = req.query.countryIso3
        ? toCountryIso3(String(req.query.countryIso3))
        : currencyIso
          ? currencyToCountryIso3(currencyIso)
          : undefined;
      const providerId = req.query.providerId ? String(req.query.providerId).trim() : undefined;
      const pageNo = req.query.PageNo || req.query.pageNo ? Number(req.query.PageNo || req.query.pageNo) : undefined;
      const searchingText = req.query.SearchingText || req.query.search
        ? String(req.query.SearchingText || req.query.search).trim()
        : undefined;

      const beneficiaries = await getMitoBeneficiaries({
        userId: mitoUserId,
        serviceCode,
        collectionMode,
        legalEntityType,
        countryIso3,
        currencyIso,
        providerId,
        pageNo,
        searchingText,
      });

      const userTxns = await storage.listSendMoneyTransactionsByOwner(userId);
      const sortedTxns = [...userTxns].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      const enrichedBeneficiaries = beneficiaries.map((b) => {
        const idUpper = String(b.beneficiaryId || "").trim().toUpperCase();
        const nameLower = String(b.name || "").trim().toLowerCase();
        const latestTx = sortedTxns.find(
          (tx) =>
            (idUpper && tx.mitoBeneficiaryId && tx.mitoBeneficiaryId.trim().toUpperCase() === idUpper) ||
            (nameLower && tx.recipientName.trim().toLowerCase() === nameLower),
        );
        if (!latestTx) return b;
        return {
          ...b,
          relationship:
            latestTx.relationship ||
            b.relationship ||
            b.relationDescription ||
            "FRIEND",
          relationId: latestTx.relationId || b.relationId,
          reason:
            latestTx.reasonCode ||
            b.reason ||
            b.reasonDescription ||
            null,
          reasonId: latestTx.reasonId || b.reasonId,
          otherReason: latestTx.otherReason || b.otherReason || null,
          narration:
            latestTx.paymentNarration ||
            b.narration ||
            null,
        };
      });

      const deletedSnapshot = getDeletedMitoBeneficiariesSnapshot();

      return res.json({
        data: {
          userId: mitoUserId,
          configured: isMitoRetailConfigured(),
          beneficiaries: enrichedBeneficiaries,
          deletedIds: deletedSnapshot.ids,
          deletedSignatures: deletedSnapshot.sigs,
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * Create a beneficiary directly in Mito Sandbox via `POST {{base_url}}/api/v1/mito/Beneficiaries`
   * (used by the Senders & Recipients -> Add Recipient modal).
   */
  app.post("/api/send-money/mito/beneficiaries", async (req: Request, res: Response) => {
    try {
      const userId = requireStrictAuth(req);
      const body = (req.body ?? {}) as Record<string, any>;

      if (!isMitoRetailConfigured()) {
        return res.status(201).json({ data: { beneficiaryId: null, configured: false } });
      }

      let mitoUserId: string | null = body.userId ? String(body.userId).trim() : null;
      if (!mitoUserId) {
        const authUser = await storage.getAuthUserById(userId);
        if (authUser) {
          mitoUserId =
            getMitoUserIdForUser(authUser.id, authUser.email) ||
            (await registerOrSyncMitoRetailUser(authUser));
        }
      }
      if (!mitoUserId) {
        return res.status(201).json({ data: { beneficiaryId: null, configured: true } });
      }

      const rawCurrency = String(body.currencyIso || body.currency || "NGN").trim().toUpperCase();
      const countryIso3 = body.countryIso3
        ? toCountryIso3(String(body.countryIso3))
        : body.country
          ? toCountryIso3(String(body.country))
          : currencyToCountryIso3(rawCurrency);
      const collectionMode = serviceToMitoCollectionMode(
        String(body.collectionMode || body.serviceType || body.service || "BANKACCOUNT"),
      );
      const isBusiness =
        String(body.legalEntityType || body.recipientType || "individual").toLowerCase() === "business" ||
        String(body.legalEntityType || "").toUpperCase() === "B";
      const legalEntityType: "I" | "B" = isBusiness ? "B" : "I";

      let providerId = String(body.providerId || "").trim();
      let providerCode = body.providerCode ? String(body.providerCode).trim() : undefined;
      if (!providerId) {
        const providers = await getMitoProviders({
          countryIso3,
          currencyCode: rawCurrency,
          serviceCode: "MONEYTRANSFER",
          collectionMode,
        });
        const bankSearch = String(body.bankName || "").trim().toLowerCase();
        const matched =
          (bankSearch &&
            providers.find(
              (p) =>
                p.providerName.toLowerCase() === bankSearch ||
                p.providerName.toLowerCase().includes(bankSearch) ||
                bankSearch.includes(p.providerName.toLowerCase()),
            )) ||
          providers[0];
        if (matched) {
          providerId = matched.providerId;
          providerCode = matched.providerCode;
        }
      }

      if (!providerId) {
        throw new SendMoneyError(
          400,
          "PROVIDER_REQUIRED",
          collectionMode === "MOBILEMONEY"
            ? "Please select a valid mobile operator for the chosen country and currency."
            : "Please select a valid bank for the chosen country and currency.",
        );
      }

      const resolvedMobile = String(body.mobileNo || (collectionMode === "MOBILEMONEY" ? body.accountNumber || "" : "")).trim();
      const created = await createMitoBeneficiary({
        userId: mitoUserId,
        serviceCode: "MONEYTRANSFER",
        collectionMode,
        legalEntityType,
        countryIso3,
        currencyIso: rawCurrency,
        providerId,
        providerCode,
        companyName: isBusiness ? String(body.companyName || body.businessName || "Business").trim() : undefined,
        firstName: isBusiness
          ? String(body.companyName || body.businessName || "Business").trim()
          : String(body.firstName || "Recipient").trim(),
        lastName: isBusiness
          ? "Business"
          : String(body.lastName || "Beneficiary").trim(),
        acctNumber: String(body.accountNumber || body.acctNumber || body.mobileNo || body.iban || "").trim(),
        bankName: String(body.bankName || (collectionMode === "MOBILEMONEY" ? "Mobile Operator" : "Bank")).trim(),
        sortCode: body.sortCode ? String(body.sortCode).trim() : undefined,
        iban: body.iban ? String(body.iban).trim() : undefined,
        bicSwift: body.swift || body.bicSwift ? String(body.swift || body.bicSwift).trim() : undefined,
        relationship: String(body.relationship || (isBusiness ? "BUSINESS" : "FAMILY")).toUpperCase(),
        beneficiaryNickname: body.nickName ? String(body.nickName).trim() : undefined,
        mobileNo: resolvedMobile || undefined,
      });

      return res.status(201).json({
        data: {
          beneficiaryId: created?.beneficiaryId ?? null,
          providerId: created?.providerId ?? providerId,
          createdNew: created?.createdNew ?? false,
          configured: true,
        },
      });
    } catch (err) {
      if (err instanceof MitoBeneficiaryCreationError) {
        res.status(err.status).json({ error: { code: "BENEFICIARY_CREATE_FAILED", message: err.message } });
        return;
      }
      handleError(res, err);
    }
  });

  /**
   * Delete a beneficiary via `DELETE /api/send-money/mito/beneficiaries/:id`.
   */
  app.delete("/api/send-money/mito/beneficiaries/:id", async (req: Request, res: Response) => {
    try {
      const userId = requireStrictAuth(req);
      const beneficiaryId = String(req.params.id || "").trim();
      const name = String(req.query.name || req.body?.name || "").trim() || null;
      const acctNumber = String(req.query.accountNumber || req.body?.accountNumber || "").trim() || null;
      if (!beneficiaryId && !name && !acctNumber) {
        throw new SendMoneyError(400, "VALIDATION_ERROR", "Beneficiary ID is required.");
      }

      let mitoUserId: string | null = null;
      const authUser = await storage.getAuthUserById(userId);
      if (authUser) {
        mitoUserId = getMitoUserIdForUser(authUser.id, authUser.email) || null;
      }

      await deleteMitoBeneficiary({
        beneficiaryId,
        userId: mitoUserId,
        name,
        acctNumber,
      });
      return res.json({ data: { deleted: true, beneficiaryId } });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * Update a beneficiary via `PUT /api/send-money/mito/beneficiaries/:id`.
   */
  app.put("/api/send-money/mito/beneficiaries/:id", async (req: Request, res: Response) => {
    try {
      const userId = requireStrictAuth(req);
      const beneficiaryId = String(req.params.id || "").trim();
      const body = req.body ?? {};
      if (!beneficiaryId) {
        throw new SendMoneyError(400, "VALIDATION_ERROR", "Beneficiary ID is required.");
      }

      let mitoUserId: string | null = null;
      const authUser = await storage.getAuthUserById(userId);
      if (authUser) {
        mitoUserId = getMitoUserIdForUser(authUser.id, authUser.email) || null;
      }

      const rawCountry = String(body.countryIso3 || body.country || "").trim();
      const rawCurrency = String(body.currency || "NGN").trim().toUpperCase();
      const countryIso3 = rawCountry
        ? rawCountry.length === 3
          ? rawCountry.toUpperCase()
          : toCountryIso3(rawCountry)
        : currencyToCountryIso3(rawCurrency);
      const isBusiness =
        String(body.recipientType || body.legalEntityType || "individual").toLowerCase() === "business" ||
        String(body.legalEntityType || "").toUpperCase() === "B";
      const rawService = String(body.serviceType || body.collectionMode || "BANKACCOUNT").toLowerCase();
      const collectionMode: "BANKACCOUNT" | "MOBILEMONEY" = rawService.includes("mobile")
        ? "MOBILEMONEY"
        : "BANKACCOUNT";

      const updated = await updateMitoBeneficiary({
        beneficiaryId,
        userId: mitoUserId,
        legalEntityType: isBusiness ? "business" : "individual",
        firstName: isBusiness
          ? String(body.companyName || body.businessName || body.firstName || "Business").trim()
          : String(body.firstName || "Recipient").trim(),
        lastName: isBusiness ? "Business" : String(body.lastName || "Beneficiary").trim(),
        companyName: isBusiness ? String(body.companyName || body.businessName || "Business").trim() : null,
        country: body.country ? String(body.country).trim() : undefined,
        countryIso3,
        currency: rawCurrency,
        collectionMode,
        providerId: body.providerId ? String(body.providerId).trim() : undefined,
        bankName: body.bankName !== undefined ? String(body.bankName).trim() : undefined,
        acctNumber: String(body.accountNumber || body.acctNumber || body.mobileNo || body.iban || "").replace(/\s+/g, ""),
        sortCode: body.sortCode !== undefined ? String(body.sortCode).replace(/\s+/g, "") : undefined,
        iban: body.iban !== undefined ? String(body.iban).replace(/\s+/g, "") : undefined,
        bicSwift:
          body.swift !== undefined || body.bicSwift !== undefined
            ? String(body.swift ?? body.bicSwift ?? "").replace(/\s+/g, "")
            : undefined,
        mobileNo:
          body.mobileNo !== undefined
            ? String(body.mobileNo).replace(/\s+/g, "")
            : collectionMode === "MOBILEMONEY"
              ? String(body.accountNumber || "").replace(/\s+/g, "")
              : undefined,
      });

      return res.json({ data: { updated: true, beneficiaryId, beneficiary: updated } });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * Step 3: Lookup types (`reason`, `source-of-funds`, `relationships`) from `GET {{base_url}}/api/v1/mito/Lookups/types`.
   */
  app.get("/api/send-money/mito/lookups", async (_req: Request, res: Response) => {
    try {
      const lookups = await getMitoLookupTypes("reason,source-of-funds,relationships");
      return res.json({ data: lookups });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * Step 4: Live Journey & Payment Status from `GET {{base_url}}/api/v1/mito/Journey/status?journeyCode=<journeyCode>`.
   */
  app.get("/api/send-money/mito/journey-status", async (req: Request, res: Response) => {
    try {
      const journeyCode = String(req.query.journeyCode || "").trim();
      if (!journeyCode) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "journeyCode is required." } });
      }
      const status = await getMitoJourneyStatus(journeyCode);
      return res.json({ data: status });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * Mini KYC / Compliance Journey from `POST {{base_url}}/api/v1/mito/Journey` (`journeyType: 1`),
   * matching `rhemito-web-nextjs-dev.herokuapp.com/compliance`.
   */
  app.post("/api/send-money/mito/kyc/journey", async (req: Request, res: Response) => {
    try {
      const userId = requireStrictAuth(req);
      const body = (req.body ?? {}) as Record<string, any>;
      let mitoUserId: string | null = body.userId ? String(body.userId).trim() : null;

      if (!mitoUserId) {
        const authUser = await storage.getAuthUserById(userId);
        if (authUser) {
          mitoUserId =
            getMitoUserIdForUser(authUser.id, authUser.email) ||
            (await registerOrSyncMitoRetailUser(authUser));
        }
      }

      if (!mitoUserId) {
        return res.json({
          data: {
            userId: null,
            configured: isMitoRetailConfigured(),
            journeyId: null,
            journeyCode: null,
            qrCodeUrl: null,
            hostedUrl: null,
            kycFlow: "Flow_No_Action_Required",
            kycStatus: "SUCCESSFUL",
            kycType: "AMLADDR",
          },
        });
      }

      const journey = await createMitoKycJourney({
        userId: mitoUserId,
        returnUrl: body.returnUrl ? String(body.returnUrl).trim() : undefined,
        journeyType: typeof body.journeyType === "number" ? body.journeyType : 1,
      });

      return res.json({
        data: {
          userId: mitoUserId,
          configured: isMitoRetailConfigured(),
          ...(journey ?? {
            journeyId: null,
            journeyCode: null,
            qrCodeUrl: null,
            hostedUrl: null,
            expiryDate: null,
            kycFlow: null,
            kycStatus: null,
            kycType: null,
            message: null,
          }),
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * Validates rate and checks Mini KYC allowance via `POST {{base_url}}/api/v1/Rate/validateRate`.
   */
  app.post("/api/send-money/mito/validate-rate", async (req: Request, res: Response) => {
    try {
      const userId = requireStrictAuth(req);
      const body = (req.body ?? {}) as Record<string, any>;
      let mitoUserId: string | null = body.userId ? String(body.userId).trim() : null;

      if (!mitoUserId) {
        const authUser = await storage.getAuthUserById(userId);
        if (authUser) {
          mitoUserId =
            getMitoUserIdForUser(authUser.id, authUser.email) ||
            (await registerOrSyncMitoRetailUser(authUser));
        }
      }

      if (!mitoUserId || !isMitoRetailConfigured()) {
        return res.json({
          data: {
            userId: mitoUserId,
            isTransactionAllowed: true,
            isKycRequired: false,
            kycUrl: null,
          },
        });
      }

      const fromCurrency = String(body.fromCurrency || body.sourceCurrency || "GBP").trim().toUpperCase();
      const toCurrency = String(body.toCurrency || body.destinationCurrency || "NGN").trim().toUpperCase();
      const fromCountry = body.fromCountry ? toCountryIso3(String(body.fromCountry)) : currencyToCountryIso3(fromCurrency);
      const toCountry = body.toCountry ? toCountryIso3(String(body.toCountry)) : currencyToCountryIso3(toCurrency);
      const collectionMode = serviceToMitoCollectionMode(
        String(body.service || body.deliveryMethod || body.collectionMode || "BANKACCOUNT"),
      );
      let providerId = String(body.providerId || "").trim();
      if (!providerId) {
        const providers = await getMitoProviders({
          countryIso3: toCountry,
          currencyCode: toCurrency,
          serviceCode: "MONEYTRANSFER",
          collectionMode,
        });
        providerId = providers[0]?.providerId || "";
      }

      const result = providerId
        ? await lockMitoExchangeRate({
            userId: mitoUserId,
            collectionMode,
            fromCountry,
            toCountry,
            fromCurrency,
            toCurrency,
            amount: Number(body.amount || 100),
            direction: body.direction === "R" ? "R" : "S",
            providerId,
            returnUrl: body.returnUrl ? String(body.returnUrl).trim() : undefined,
          })
        : null;

      return res.json({
        data: {
          userId: mitoUserId,
          rateId: result?.rateId ?? null,
          rate: result?.rate ?? null,
          commission: result?.commission ?? null,
          receiveAmount: result?.receiveAmount ?? null,
          isKycRequired: result?.isKycRequired ?? false,
          isTransactionAllowed: result?.isTransactionAllowed ?? true,
          kycUrl: result?.kycUrl ?? null,
          isProfileUpdateRequired: result?.isProfileUpdateRequired ?? false,
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * Step 4: Proxies Checkout.com Payment Session submission (`POST https://api.sandbox.checkout.com/payment-sessions/:id/submit`)
   * server-side so browser CORS/network restrictions never block the "Pay" button on the Credit/Debit Card flow.
   */
  app.post("/api/send-money/mito/card-session-submit", async (req: Request, res: Response) => {
    try {
      const sessionId = String(req.body?.sessionId || "").trim();
      const sessionSecret = String(req.body?.sessionSecret || "").trim();
      const sessionData = String(req.body?.sessionData || req.body?.session_data || "").trim();
      const amount = typeof req.body?.amount === "number" ? req.body.amount : undefined;
      const reference = String(req.body?.reference || "").trim();

      if (!sessionId || !sessionData) {
        return res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "sessionId and session_data are required." },
        });
      }

      const payload: Record<string, unknown> = {
        session_data: sessionData,
        payment_type: "Regular",
        ...(typeof amount === "number" && amount > 0 ? { amount } : {}),
        ...(reference ? { reference } : {}),
      };

      const ckoRes = await fetch(
        `https://api.sandbox.checkout.com/payment-sessions/${encodeURIComponent(sessionId)}/submit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(sessionSecret ? { "cko-payment-session-secret": sessionSecret } : {}),
          },
          body: JSON.stringify(payload),
        },
      );

      const ckoBody = (await ckoRes.json().catch(() => ({}))) as Record<string, unknown>;
      return res.status(ckoRes.status).json(ckoBody);
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * Step 4: Resolves a Checkout.com / Mito 3DS redirect URL server-side so the browser never navigates
   * away to an external domain (such as rhemito-web-nextjs-dev.herokuapp.com) after card payment.
   */
  app.post("/api/send-money/mito/resolve-card-redirect", async (req: Request, res: Response) => {
    try {
      const rawUrl = String(req.body?.url || "").trim();
      const paymentId = String(req.body?.paymentId || "").trim();
      const sessionId = String(req.body?.sessionId || "").trim();
      const redirectReason = String(req.body?.redirectReason || "").trim();

      const extractOutcomeFromUrlString = (urlStr: string) => {
        try {
          const parsed = new URL(urlStr, "http://localhost:5000");
          const searchParamsList: URLSearchParams[] = [parsed.searchParams];
          const nestedRedirect =
            parsed.searchParams.get("redirect") ||
            parsed.searchParams.get("returnUrl") ||
            parsed.searchParams.get("next");
          if (nestedRedirect) {
            try {
              const nestedParsed = new URL(decodeURIComponent(nestedRedirect), "http://localhost:5000");
              searchParamsList.unshift(nestedParsed.searchParams);
            } catch {
              try {
                const nestedParsed = new URL(nestedRedirect, "http://localhost:5000");
                searchParamsList.unshift(nestedParsed.searchParams);
              } catch {
                // ignore malformed nested redirect
              }
            }
          }

          const getParam = (...keys: string[]): string | null => {
            for (const sp of searchParamsList) {
              for (const k of keys) {
                const val = sp.get(k);
                if (val && val.trim()) return val.trim();
              }
            }
            return null;
          };

          return {
            hostname: parsed.hostname.toLowerCase(),
            pathname: parsed.pathname,
            tnxref: getParam(
              "tnxref",
              "orderNo",
              "txn_ref",
              "txnref",
              "reference",
              "transactionReference",
              "partnerReferenceNumber",
            ),
            status: getParam("status", "orderStatus", "journeyStatus"),
            paymentStatus: getParam("paymentStatus", "cko-payment-status"),
            ckoSessionId: getParam("cko-session-id", "cko-payment-id"),
            reason: getParam("reason", "error", "message", "declined_reason"),
            journeyCode: getParam("journeyCode", "journey_code"),
          };
        } catch {
          return null;
        }
      };

      let currentUrl = rawUrl;
      let outcome = currentUrl ? extractOutcomeFromUrlString(currentUrl) : null;

      // Follow server-side callback redirects on checkout.com / funtechcom.com so Mito records the 3DS outcome
      // without redirecting the customer's browser to another domain.
      for (let hop = 0; hop < 5 && currentUrl; hop++) {
        const info = extractOutcomeFromUrlString(currentUrl);
        if (info) {
          outcome = {
            hostname: info.hostname,
            pathname: info.pathname,
            tnxref: info.tnxref || outcome?.tnxref || null,
            status: info.status || outcome?.status || null,
            paymentStatus: info.paymentStatus || outcome?.paymentStatus || null,
            ckoSessionId: info.ckoSessionId || outcome?.ckoSessionId || null,
            reason: info.reason || outcome?.reason || null,
            journeyCode: info.journeyCode || outcome?.journeyCode || null,
          };
        }

        const host = info?.hostname || "";
        const isCallbackHost =
          host.endsWith("checkout.com") ||
          host.endsWith("funtechcom.com") ||
          host.endsWith("mito.money");

        if (!isCallbackHost || (outcome?.status && outcome?.tnxref && !isCallbackHost)) {
          break;
        }

        try {
          const hopRes = await fetch(currentUrl, {
            method: "GET",
            redirect: "manual",
            headers: {
              Accept: "text/html,application/xhtml+xml,application/json,*/*",
            },
          });
          const locationHeader = hopRes.headers.get("location");
          if (locationHeader) {
            const resolvedNext = new URL(locationHeader, currentUrl).toString();
            currentUrl = resolvedNext;
            const nextInfo = extractOutcomeFromUrlString(currentUrl);
            if (nextInfo) {
              outcome = {
                hostname: nextInfo.hostname,
                pathname: nextInfo.pathname,
                tnxref: nextInfo.tnxref || outcome?.tnxref || null,
                status: nextInfo.status || outcome?.status || null,
                paymentStatus: nextInfo.paymentStatus || outcome?.paymentStatus || null,
                ckoSessionId: nextInfo.ckoSessionId || outcome?.ckoSessionId || null,
                reason: nextInfo.reason || outcome?.reason || null,
                journeyCode: nextInfo.journeyCode || outcome?.journeyCode || null,
              };
            }
          } else {
            break;
          }
        } catch {
          break;
        }
      }

      const effectiveStatus =
        outcome?.status ||
        outcome?.paymentStatus ||
        (redirectReason.toLowerCase().includes("fail") || redirectReason.toLowerCase().includes("declin")
          ? "COMPFAILED"
          : redirectReason.toLowerCase().includes("cancel")
          ? "CANCELLED"
          : "COMPSUCCESS");

      return res.json({
        tnxref: outcome?.tnxref || null,
        status: effectiveStatus,
        paymentStatus: outcome?.paymentStatus || null,
        ckoSessionId: outcome?.ckoSessionId || sessionId || paymentId || null,
        reason: outcome?.reason || null,
        journeyCode: outcome?.journeyCode || null,
        redirectReason: redirectReason || null,
        finalUrl: currentUrl || null,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/send-money/transactions", async (req: Request, res: Response) => {
    try {
      const userId = requireStrictAuth(req);
      const parsed = createSendMoneyTransactionSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new SendMoneyError(400, "VALIDATION_ERROR", firstZodMessage(parsed.error));
      }
      const input = parsed.data;
      const feeMinor = toMinorUnits(input.fee, input.sendCurrency);
      const feeBeforePromoMinor = input.promoCode && input.feeBeforePromo ? toMinorUnits(input.feeBeforePromo, input.sendCurrency) : null;
      if (feeBeforePromoMinor !== null && feeBeforePromoMinor < feeMinor) {
        throw new SendMoneyError(400, "VALIDATION_ERROR", "The fee before the promo cannot be less than the fee charged.");
      }
      const amountPromo = Boolean(input.promoCode) && input.promoAppliesTo === "amount";
      const sendAmountMinor = toMinorUnits(input.sendAmount, input.sendCurrency);
      const amountPromoDiscountMinor = amountPromo ? Math.min(toMinorUnits(input.promoDiscount ?? "0", input.sendCurrency), sendAmountMinor) : 0;
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const reference = formatDocumentNumber("TXN", await storage.nextSendMoneySequence(), yearMonth);

      let mitoUserId: string | null = null;
      let mitoBeneficiaryId: string | null = input.beneficiaryId ?? null;
      let mitoBeneficiaryCreated = false;
      let mitoProviderId: string | null = input.providerId ?? null;
      let mitoProviderCode: string | null = input.providerCode ?? null;
      let mitoRateId: string | null = input.affiliateRateId ?? null;
      let mitoKycUrl: string | null = null;
      let mitoIsTransactionAllowed: boolean | null = null;
      let mitoIsKycRequired: boolean | null = null;
      let mitoIsProfileUpdateRequired: boolean | null = null;
      const sendCurrencyUpper = input.sendCurrency.toUpperCase();
      const receiveCurrencyUpper = input.receiveCurrency.toUpperCase();
      let resolvedSendCountryIso3: string = input.sendCountryIso3
        ? toCountryIso3(input.sendCountryIso3)
        : currencyToCountryIso3(sendCurrencyUpper);
      let resolvedReceiveCountryIso3: string = input.countryIso3
        ? toCountryIso3(input.countryIso3)
        : input.country
          ? toCountryIso3(input.country)
          : currencyToCountryIso3(receiveCurrencyUpper);
      let resolvedReasonCode: string = input.reasonId || input.reason || "FOROWNEXPENDITURES";
      let resolvedSourceOfFundCode: string = input.sourceOfFundCode || "TRADING";
      const resolvedPaymentNarration: string = (input.narration || "").trim() || "Money transfer";

      if (isMitoRetailConfigured()) {
        try {
          const authUser = await storage.getAuthUserById(userId);
          if (authUser) {
            mitoUserId = getMitoUserIdForUser(authUser.id, authUser.email) || (await registerOrSyncMitoRetailUser(authUser));
          }

          const sendCurrency = sendCurrencyUpper;
          const receiveCurrency = receiveCurrencyUpper;
          const fromCountry = input.sendCountryIso3
            ? toCountryIso3(input.sendCountryIso3)
            : authUser?.country
              ? toCountryIso3(authUser.country)
              : currencyToCountryIso3(sendCurrency);
          const toCountry = resolvedReceiveCountryIso3;
          resolvedSendCountryIso3 = fromCountry;
          const collectionMode = serviceToMitoCollectionMode(input.service);

          // 1. Resolve provider (providerCode & providerId for the beneficiary bank) from GET /api/v1/mito/Lookups/provider
          if (!mitoProviderId || !mitoProviderCode) {
            const providers = await getMitoProviders({
              countryIso3: toCountry,
              currencyCode: receiveCurrency,
              serviceCode: "MONEYTRANSFER",
              collectionMode,
            });
            const bankSearch = (input.bankName || "").trim().toLowerCase();
            const matchedProvider =
              (input.providerId && providers.find((p) => p.providerId === input.providerId)) ||
              (input.providerCode && providers.find((p) => p.providerCode === input.providerCode)) ||
              (bankSearch &&
                providers.find(
                  (p) =>
                    p.providerName.toLowerCase() === bankSearch ||
                    p.providerName.toLowerCase().includes(bankSearch) ||
                    bankSearch.includes(p.providerName.toLowerCase()),
                )) ||
              providers[0];

            if (matchedProvider) {
              mitoProviderId = matchedProvider.providerId;
              mitoProviderCode = matchedProvider.providerCode;
            }
          }

          // 2. Create Beneficiary in Mito Sandbox (POST /api/v1/mito/Beneficiaries) if not already selected
          if (mitoUserId && mitoProviderId && !mitoBeneficiaryId) {
            const isBusinessBeneficiary = input.beneficiaryType === "business";
            const legalEntityType: "I" | "B" = isBusinessBeneficiary ? "B" : "I";
            const nameParts = input.recipientName.trim().split(/\s+/);
            const companyName = isBusinessBeneficiary
              ? (input.companyName || input.recipientName || "Business").trim()
              : undefined;
            const firstName = isBusinessBeneficiary
              ? companyName || "Business"
              : input.recipientFirstName || nameParts[0] || "Recipient";
            const lastName = isBusinessBeneficiary
              ? "Business"
              : input.recipientLastName || nameParts.slice(1).join(" ") || "Beneficiary";

            const createdBen = await createMitoBeneficiary({
              userId: mitoUserId,
              serviceCode: "MONEYTRANSFER",
              collectionMode,
              legalEntityType,
              countryIso3: toCountry,
              currencyIso: receiveCurrency,
              providerId: mitoProviderId,
              providerCode: mitoProviderCode ?? undefined,
              companyName,
              firstName,
              lastName,
              acctNumber: input.accountNumber || input.iban || "0123456789",
              bankName: input.bankName || "Bank",
              sortCode: input.sortCode,
              iban: input.iban,
              bicSwift: input.swift,
              aba: input.aba,
              ifsc: input.ifsc,
              bsbCode: input.bsbCode,
              branchCode: input.branchCode,
              relationship: input.relationship || (isBusinessBeneficiary ? "BUSINESS" : "FAMILY"),
              relationId: input.relationId,
              reasonId: input.reasonId,
              beneficiaryNickname: input.nickName,
              address: input.address,
              city: input.city,
              postcode: input.postcode,
              stateOrProvince: input.stateOrProvince,
              mobileNo: input.mobileNo,
            });
            if (createdBen?.beneficiaryId) {
              mitoBeneficiaryId = createdBen.beneficiaryId;
              mitoBeneficiaryCreated = Boolean(createdBen.createdNew);
            }
          }

          // 3. Resolve lookup codes (reasonCode & sourceOfFundCode) from GET /api/v1/mito/Lookups/types
          const lookups = await getMitoLookupTypes("reason,source-of-funds,relationships");
          const requestedReason = (input.reasonId || input.reason || "").trim().toLowerCase();
          const matchedReason = requestedReason
            ? lookups.reason?.find(
                (r) =>
                  (r.id && r.id.toLowerCase() === requestedReason) ||
                  r.code.toLowerCase() === requestedReason ||
                  r.name.toLowerCase() === requestedReason,
              )
            : undefined;
          resolvedReasonCode =
            matchedReason?.id ||
            matchedReason?.code ||
            lookups.reason?.[0]?.id ||
            lookups.reason?.[0]?.code ||
            "FOROWNEXPENDITURES";

          const requestedSof = (input.sourceOfFundCode || "").trim().toLowerCase();
          const matchedSof = requestedSof
            ? lookups.sourceOfFunds?.find(
                (s) =>
                  (s.id && s.id.toLowerCase() === requestedSof) ||
                  s.code.toLowerCase() === requestedSof ||
                  s.name.toLowerCase() === requestedSof,
              )
            : undefined;
          resolvedSourceOfFundCode =
            matchedSof?.id ||
            matchedSof?.code ||
            lookups.sourceOfFunds?.[0]?.id ||
            lookups.sourceOfFunds?.[0]?.code ||
            "TRADING";

          // 4. Lock/resolve the exchange rate via POST /api/v1/mito/Exchange/rates so rateId is ready for Step 4
          if (mitoUserId && mitoProviderId) {
            const lockedRate = await lockMitoExchangeRate({
              userId: mitoUserId,
              serviceCode: "MONEYTRANSFER",
              collectionMode,
              fromCountry,
              toCountry,
              fromCurrency: sendCurrency,
              toCurrency: receiveCurrency,
              amount: Number(input.sendAmount),
              direction: "S",
              providerId: mitoProviderId,
              providerCode: mitoProviderCode ?? undefined,
            });
            if (lockedRate?.rateId) {
              mitoRateId = lockedRate.rateId;
            }
            if (lockedRate?.kycUrl !== undefined) {
              mitoKycUrl = lockedRate.kycUrl;
            }
            if (typeof lockedRate?.isTransactionAllowed === "boolean") {
              mitoIsTransactionAllowed = lockedRate.isTransactionAllowed;
            }
            if (typeof lockedRate?.isKycRequired === "boolean") {
              mitoIsKycRequired = lockedRate.isKycRequired;
            }
            if (typeof lockedRate?.isProfileUpdateRequired === "boolean") {
              mitoIsProfileUpdateRequired = lockedRate.isProfileUpdateRequired;
            }
          }
        } catch (mitoErr) {
          if (mitoErr instanceof MitoBeneficiaryCreationError) {
            throw new SendMoneyError(mitoErr.status, "BENEFICIARY_CREATE_FAILED", mitoErr.message);
          }
          console.warn("[sendMoneyRoutes] Mito Sandbox sync warning:", mitoErr);
        }
      }

      const transaction: SendMoneyTransaction = {
        id: randomUUID(),
        ownerId: userId,
        reference,
        recipientName: input.recipientName,
        service: input.service,
        paymentMethod: null,
        sendCurrency: sendCurrencyUpper,
        sendAmountMinor,
        receiveCurrency: receiveCurrencyUpper,
        receiveAmountMinor: toMinorUnits(input.receiveAmount, input.receiveCurrency),
        feeMinor,
        exchangeRate: input.exchangeRate,
        promoCode: input.promoCode ?? null,
        feeBeforePromoMinor,
        ...(amountPromo ? { promoAppliesTo: "amount" as const, promoDiscountMinor: amountPromoDiscountMinor } : {}),
        ...(mitoUserId ? { mitoUserId } : {}),
        ...(mitoBeneficiaryId ? { mitoBeneficiaryId } : {}),
        ...(mitoBeneficiaryCreated ? { mitoBeneficiaryCreated: true } : {}),
        ...(mitoProviderId ? { mitoProviderId } : {}),
        ...(mitoProviderCode ? { mitoProviderCode } : {}),
        ...(mitoRateId ? { mitoRateId } : {}),
        ...(mitoKycUrl !== null ? { mitoKycUrl } : {}),
        ...(mitoIsTransactionAllowed !== null ? { mitoIsTransactionAllowed } : {}),
        ...(mitoIsKycRequired !== null ? { mitoIsKycRequired } : {}),
        ...(mitoIsProfileUpdateRequired !== null ? { mitoIsProfileUpdateRequired } : {}),
        sendCountryIso3: resolvedSendCountryIso3,
        receiveCountryIso3: resolvedReceiveCountryIso3,
        ...(input.relationship ? { relationship: input.relationship } : {}),
        ...(input.relationId ? { relationId: input.relationId } : {}),
        reasonCode: input.reason || resolvedReasonCode,
        ...(input.reasonId ? { reasonId: input.reasonId } : {}),
        ...(input.otherReason ? { otherReason: input.otherReason } : {}),
        sourceOfFundCode: resolvedSourceOfFundCode,
        paymentNarration: resolvedPaymentNarration,
        status: "awaiting_payment",
        createdAt: now,
        paidAt: null,
        cancelledAt: null,
      };
      saveMitoBeneficiaryLatestTxnDetails({
        beneficiaryId: mitoBeneficiaryId || input.beneficiaryId || null,
        name: input.recipientName,
        acctNumber: input.accountNumber || input.iban || input.mobileNo || null,
        relationship: input.relationship || null,
        relationId: input.relationId || null,
        reason: input.reason || resolvedReasonCode,
        reasonId: input.reasonId || null,
        otherReason: input.otherReason ?? null,
        narration: input.narration || resolvedPaymentNarration,
        beneficiaryNickname: input.nickName || null,
      });
      await storage.createSendMoneyTransaction(transaction);
      return res.status(201).json({ data: toView(transaction) });
    } catch (err) {
      handleError(res, err);
    }
  });

  async function initiateHostedForSendMoneyTx(
    tx: SendMoneyTransaction,
    userId: string,
    req: Request,
  ): Promise<Partial<SendMoneyTransaction>> {
    if (!isMitoRetailConfigured()) return {};
    try {
      let mitoUserId = tx.mitoUserId ?? null;
      const authUser = await storage.getAuthUserById(userId);
      if (!mitoUserId && authUser) {
        mitoUserId = getMitoUserIdForUser(authUser.id, authUser.email) || (await registerOrSyncMitoRetailUser(authUser));
      }

      const sendCurrency = tx.sendCurrency.toUpperCase();
      const receiveCurrency = tx.receiveCurrency.toUpperCase();
      const sendCountryIso3 =
        tx.sendCountryIso3 ||
        (authUser?.country ? toCountryIso3(authUser.country) : currencyToCountryIso3(sendCurrency));
      const receiveCountryIso3 = tx.receiveCountryIso3 || currencyToCountryIso3(receiveCurrency);
      const collectionMode = serviceToMitoCollectionMode(tx.service);

      let mitoProviderId = tx.mitoProviderId ?? null;
      let mitoProviderCode = tx.mitoProviderCode ?? null;
      if (!mitoProviderId) {
        const providers = await getMitoProviders({
          countryIso3: receiveCountryIso3,
          currencyCode: receiveCurrency,
          serviceCode: "MONEYTRANSFER",
          collectionMode,
        });
        if (providers[0]) {
          mitoProviderId = providers[0].providerId;
          mitoProviderCode = providers[0].providerCode;
        }
      }

      let mitoRateId = tx.mitoRateId ?? null;
      const sendAmountNum = Number(fromMinorUnits(tx.sendAmountMinor, tx.sendCurrency));
      const receiveAmountNum = Number(fromMinorUnits(tx.receiveAmountMinor, tx.receiveCurrency));
      const rateNum = Number(tx.exchangeRate);
      const commissionNum = Number(fromMinorUnits(tx.feeMinor, tx.sendCurrency));

      if (mitoUserId && mitoProviderId && !mitoRateId) {
        const lockedRate = await lockMitoExchangeRate({
          userId: mitoUserId,
          serviceCode: "MONEYTRANSFER",
          collectionMode,
          fromCountry: sendCountryIso3,
          toCountry: receiveCountryIso3,
          fromCurrency: sendCurrency,
          toCurrency: receiveCurrency,
          amount: sendAmountNum,
          direction: "S",
          providerId: mitoProviderId,
          providerCode: mitoProviderCode ?? undefined,
        });
        if (lockedRate?.rateId) {
          mitoRateId = lockedRate.rateId;
        }
      }

      let reasonCode = tx.reasonCode || "";
      let sourceOfFundCode = tx.sourceOfFundCode || "";
      if (!reasonCode || !sourceOfFundCode) {
        const lookups = await getMitoLookupTypes("reason,source-of-funds");
        if (!reasonCode) {
          reasonCode =
            lookups.reason?.[0]?.id ||
            lookups.reason?.[0]?.code ||
            "FOROWNEXPENDITURES";
        }
        if (!sourceOfFundCode) {
          sourceOfFundCode =
            lookups.sourceOfFunds?.[0]?.id ||
            lookups.sourceOfFunds?.[0]?.code ||
            "TRADING";
        }
      }

      const hostHeader = req.get("host") || "localhost:5000";
      const protocol = req.protocol || "http";
      const rawRedirectUrl = `${protocol}://${hostHeader}/send-money`;
      const redirectUrl = /localhost|127\.0\.0\.1/i.test(rawRedirectUrl)
        ? "https://rhemito-ui.onrender.com/send-money"
        : rawRedirectUrl;

      if (mitoUserId && mitoProviderId) {
        const initiated = await initiateMitoHostedTransaction({
          serviceCode: "MONEYTRANSFER",
          collectionMode,
          sendCountryIso3,
          receiveCountryIso3,
          sendCurrency,
          receiveCurrency,
          sendAmount: sendAmountNum,
          receiveAmount: receiveAmountNum,
          providerId: mitoProviderId,
          rate: Number.isFinite(rateNum) && rateNum > 0 ? rateNum : undefined,
          rateId: mitoRateId ?? undefined,
          userId: mitoUserId,
          redirectUrl,
          partnerReferenceNumber: tx.reference,
          reasonCode,
          sourceOfFundCode,
          paymentNarration: tx.paymentNarration || "Money transfer",
          webhookUrl: getMitoWebhookUrl(),
          beneficiaryId: tx.mitoBeneficiaryId ?? undefined,
          commission: Number.isFinite(commissionNum) && commissionNum >= 0 ? commissionNum : undefined,
        });

        return {
          ...(mitoUserId ? { mitoUserId } : {}),
          ...(mitoProviderId ? { mitoProviderId } : {}),
          ...(mitoProviderCode ? { mitoProviderCode } : {}),
          ...(mitoRateId ? { mitoRateId } : {}),
          sendCountryIso3,
          receiveCountryIso3,
          reasonCode,
          sourceOfFundCode,
          ...(initiated?.retailTransactionId ? { mitoTransactionId: initiated.retailTransactionId } : {}),
          ...(initiated?.reference ? { mitoReference: initiated.reference } : {}),
          ...(initiated?.requiredAction ? { mitoRequiredAction: initiated.requiredAction } : {}),
          ...(initiated?.hostedUrl ? { mitoHostedUrl: initiated.hostedUrl } : {}),
          ...(initiated?.requestPayload ? { mitoHostedPayload: initiated.requestPayload } : {}),
        };
      }
    } catch (err) {
      console.warn("[sendMoneyRoutes] InitiateHostedTransaction warning:", err);
    }
    return {};
  }

  function mapPaymentMethodToMito(method: string): MitoSendMoneyPaymentMethod {
    if (method === "card") return "CARDCHECKOUT";
    if (method === "instant_bank") return "PLAID";
    if (method === "wallet") return "TUNACCOUNT";
    return "BANKPAYMENT";
  }

  async function sendMitoForSendMoneyTx(
    tx: SendMoneyTransaction,
    userId: string,
    paymentMethod: string,
    promoCode?: string | null,
    bonusAmount?: number | null,
    req?: Request,
    promoAtPayment?: promo.PromoAtPayment | null,
    bonusAtPayment?: bonus.BonusAtPayment | null,
  ): Promise<Partial<SendMoneyTransaction>> {
    if (!isMitoRetailConfigured()) return {};
    try {
      const authUser = await storage.getAuthUserById(userId);
      const mitoUserId =
        tx.mitoUserId ||
        (authUser ? getMitoUserIdForUser(authUser.id, authUser.email) : null) ||
        DEFAULT_MITO_SENDER_USER_ID;

      const sendCurrency = tx.sendCurrency.toUpperCase();
      const receiveCurrency = tx.receiveCurrency.toUpperCase();
      const sendCountryIso3 =
        tx.sendCountryIso3 ||
        (authUser?.country ? toCountryIso3(authUser.country) : currencyToCountryIso3(sendCurrency));
      const receiveCountryIso3 = tx.receiveCountryIso3 || currencyToCountryIso3(receiveCurrency);
      const collectionMode = serviceToMitoCollectionMode(tx.service);

      let mitoProviderId = tx.mitoProviderId ?? null;
      let mitoProviderCode = tx.mitoProviderCode ?? null;
      if (!mitoProviderId) {
        const providers = await getMitoProviders({
          countryIso3: receiveCountryIso3,
          currencyCode: receiveCurrency,
          serviceCode: "MONEYTRANSFER",
          collectionMode,
        });
        if (providers[0]) {
          mitoProviderId = providers[0].providerId;
          mitoProviderCode = providers[0].providerCode;
        }
      }

      let mitoBeneficiaryId = tx.mitoBeneficiaryId ?? null;
      if (!mitoBeneficiaryId && mitoUserId) {
        const userBens = await getMitoBeneficiaries({
          userId: mitoUserId,
          collectionMode,
        });
        const matchedBen =
          userBens.find(
            (b) =>
              b.name.toLowerCase() === tx.recipientName.trim().toLowerCase() ||
              b.currency.toUpperCase() === receiveCurrency,
          ) || userBens[0];
        if (matchedBen?.beneficiaryId) {
          mitoBeneficiaryId = matchedBen.beneficiaryId;
          if (!mitoProviderId && matchedBen.providerId) {
            mitoProviderId = matchedBen.providerId;
          }
        }
      }

      // Manage Rhemito Promo Code & Referral/Bonus adjustments in our current flow:
      // - Fee promo reduces the commission charged.
      // - Fixed-amount promo or Pay-less bonus reduces the net amount collected from the sender.
      // - Send-more bonus increases the send amount converted for the recipient.
      const effectiveFeeMinor = promoAtPayment ? promoAtPayment.feeMinor : tx.feeMinor;
      const effectivePromoAppliesTo = promoAtPayment?.promoAppliesTo ?? tx.promoAppliesTo;
      const effectivePromoDiscountMinor = promoAtPayment
        ? promoAtPayment.promoDiscountMinor
        : tx.promoDiscountMinor ?? 0;
      const effectiveBonusMinor = bonusAtPayment
        ? bonusAtPayment.amountMinor
        : tx.bonusCreditMinor ?? 0;
      const effectiveBonusMode = bonusAtPayment
        ? bonusAtPayment.mode
        : tx.bonusCreditMode ?? null;

      const hasRewardOrPromo =
        Boolean(promoAtPayment || tx.promoCode || effectiveBonusMinor > 0 || (bonusAmount && bonusAmount > 0));

      let sendAmountMinorForMito = tx.sendAmountMinor;
      let feeMinorForMito = effectiveFeeMinor;

      if (effectiveBonusMode === "send_more" && effectiveBonusMinor > 0) {
        sendAmountMinorForMito += effectiveBonusMinor;
      } else {
        const totalOffsetMinor =
          (effectivePromoAppliesTo === "amount" ? effectivePromoDiscountMinor : 0) +
          (effectiveBonusMode === "pay_less" ? effectiveBonusMinor : 0);
        if (totalOffsetMinor > 0) {
          const feeReduction = Math.min(feeMinorForMito, totalOffsetMinor);
          feeMinorForMito -= feeReduction;
          const remainingReduction = totalOffsetMinor - feeReduction;
          if (remainingReduction > 0) {
            sendAmountMinorForMito = Math.max(100, sendAmountMinorForMito - remainingReduction);
          }
        }
      }

      const sendAmountNum = Number(fromMinorUnits(sendAmountMinorForMito, tx.sendCurrency));
      let commissionNum = Number(fromMinorUnits(feeMinorForMito, tx.sendCurrency));
      let mitoRateId = tx.mitoRateId ?? null;

      if (mitoUserId && mitoProviderId) {
        const lockedRate = await lockMitoExchangeRate({
          userId: mitoUserId,
          serviceCode: "MONEYTRANSFER",
          collectionMode,
          fromCountry: sendCountryIso3,
          toCountry: receiveCountryIso3,
          fromCurrency: sendCurrency,
          toCurrency: receiveCurrency,
          amount: sendAmountNum,
          direction: "S",
          providerId: mitoProviderId,
          providerCode: mitoProviderCode ?? undefined,
        });
        if (lockedRate?.rateId) {
          mitoRateId = lockedRate.rateId;
        }
        if (
          !hasRewardOrPromo &&
          typeof lockedRate?.commission === "number" &&
          Number.isFinite(lockedRate.commission)
        ) {
          commissionNum = lockedRate.commission;
        }
      }

      if (mitoUserId && mitoProviderId && mitoRateId && mitoBeneficiaryId) {
        const mitoPaymentMethod = mapPaymentMethodToMito(paymentMethod);
        const origin =
          (req && typeof req.headers.origin === "string" && req.headers.origin) ||
          (req && req.get("host") ? `${req.protocol}://${req.get("host")}` : "http://localhost:5000");
        const rawRedirectSuccessUrl = `${origin.replace(/\/+$/, "")}/send-money`;
        const redirectSuccessUrl = /localhost|127\.0\.0\.1/i.test(rawRedirectSuccessUrl)
          ? "https://rhemito-ui.onrender.com/send-money"
          : rawRedirectSuccessUrl;

        const sent = await sendMitoTransaction({
          userId: mitoUserId,
          reasonId: tx.reasonCode,
          paymentMethod: mitoPaymentMethod,
          sendCountryIso3,
          receiveCountryIso3,
          sendCurrency,
          receiveCurrency,
          sendAmount: sendAmountNum,
          commission: commissionNum,
          rateId: mitoRateId,
          providerId: mitoProviderId,
          collectionMode,
          beneficiaryId: mitoBeneficiaryId,
          paymentNarration: tx.paymentNarration ?? "",
          direction: "S",
          redirectSuccessUrl,
          promoCode,
          bonusAmount,
        });

        return {
          mitoUserId,
          mitoProviderId,
          ...(mitoProviderCode ? { mitoProviderCode } : {}),
          mitoRateId,
          mitoBeneficiaryId,
          sendCountryIso3,
          receiveCountryIso3,
          ...(sent?.tnxref ? { mitoTransactionId: sent.tnxref, mitoReference: sent.tnxref } : {}),
          ...(sent?.paymentUrl !== undefined ? { mitoPaymentUrl: sent.paymentUrl } : {}),
          ...(sent?.paymentSession !== undefined ? { mitoPaymentSession: sent.paymentSession } : {}),
          ...(sent?.linkToken !== undefined ? { mitoLinkToken: sent.linkToken } : {}),
          ...(sent?.paymentReference !== undefined ? { mitoPaymentReference: sent.paymentReference } : {}),
          ...(sent?.checkoutPublicKey ? { mitoCheckoutPublicKey: sent.checkoutPublicKey } : {}),
          ...(sent?.requestPayload ? { mitoSendMoneyPayload: sent.requestPayload } : {}),
        };
      }
    } catch (err) {
      console.warn("[sendMoneyRoutes] Transaction/SendMoney warning:", err);
    }
    return {};
  }

  app.get("/api/send-money/transactions", async (req: Request, res: Response) => {
    try {
      const userId = requireStrictAuth(req);
      const transactions = await storage.listSendMoneyTransactionsByOwner(userId);
      return res.json({ data: transactions.map(toView), meta: { total: transactions.length } });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * Step 4 (Payment) — Initiates the Mito Hosted Transaction via
   * `POST /api/v1/mito/Transactions/InitiateHostedTransaction`.
   */
  app.post("/api/send-money/transactions/:id/initiate-hosted", async (req: Request, res: Response) => {
    try {
      const userId = requireStrictAuth(req);
      const tx = await getOwnedTransaction(req.params.id, userId);
      const mitoPatch = await initiateHostedForSendMoneyTx(tx, userId, req);
      const updated = (await storage.updateSendMoneyTransaction(tx.id, mitoPatch)) ?? tx;
      return res.json({ data: toView(updated) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/send-money/transactions/:id/pay", async (req: Request, res: Response) => {
    try {
      const userId = requireStrictAuth(req);
      const tx = await getOwnedTransaction(req.params.id, userId);
      const parsed = paySendMoneyTransactionSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new SendMoneyError(400, "VALIDATION_ERROR", firstZodMessage(parsed.error));
      }
      const isMitoStep4Reclick =
        isMitoRetailConfigured() &&
        tx.status === "completed" &&
        Boolean(tx.mitoPaymentSession || tx.mitoPaymentUrl || tx.mitoTransactionId);

      if (tx.status !== "awaiting_payment" && !isMitoStep4Reclick) {
        throw new SendMoneyError(409, "INVALID_STATE", "Only a transaction awaiting payment can be paid.");
      }

      if (isMitoStep4Reclick) {
        const mitoSendPatch = await sendMitoForSendMoneyTx(
          tx,
          userId,
          parsed.data.paymentMethod,
          parsed.data.promoCode ?? tx.promoCode,
          parsed.data.bonusCredit ? Number(parsed.data.bonusCredit.amount) : null,
          req,
        );
        const reUpdated =
          (await storage.updateSendMoneyTransaction(tx.id, {
            ...mitoSendPatch,
            paymentMethod: parsed.data.paymentMethod,
          })) ?? tx;
        return res.json({ data: toView(reUpdated) });
      }

      // If the customer switched from a Step-1 promo code to a Step-4 bonus credit, drop the draft promo
      const switchedPromoToBonus = Boolean(tx.promoCode && parsed.data.bonusCredit && !parsed.data.promoCode);
      const effectiveTx: SendMoneyTransaction = switchedPromoToBonus
        ? {
            ...tx,
            promoCode: null,
            promoDiscountMinor: null,
            promoAppliesTo: undefined,
            feeMinor: tx.feeBeforePromoMinor ?? tx.feeMinor,
            feeBeforePromoMinor: null,
          }
        : tx;

      // Promo codes belong to Mito Money: the code is re-checked for this customer and payment method and its use
      // recorded once (against the transfer reference) before any money moves (PROMO-RHEMITO P-20 – P-25).
      let promoAtPayment: promo.PromoAtPayment | null = null;
      try {
        promoAtPayment = await promo.applyForPayment(effectiveTx, userId, parsed.data.paymentMethod, { code: parsed.data.promoCode, shownDiscount: parsed.data.promoDiscount });
      } catch (err) {
        if (err instanceof promo.PromoPaymentError) throw new SendMoneyError(err.status, err.code, err.message);
        throw err;
      }
      // Bonus credit (one balance, Mito Money): re-checked and used once for this transfer before any money moves
      // (BONUS-RHEMITO B-20 – B-23). If it fails, the promo use taken above is given back and the transfer stays unpaid.
      let bonusAtPayment: bonus.BonusAtPayment | null = null;
      try {
        bonusAtPayment = await bonus.applyForPayment(effectiveTx, userId, parsed.data.bonusCredit);
      } catch (err) {
        if (promoAtPayment) await promo.releaseForPayment(tx.reference);
        if (err instanceof bonus.BonusPaymentError) throw new SendMoneyError(err.status, err.code, err.message);
        throw err;
      }

      // Submit Transaction in Mito Retail Sandbox on Step 4 Payment (POST /api/v1/Transaction/SendMoney)
      const mitoSendPatch = await sendMitoForSendMoneyTx(
        effectiveTx,
        userId,
        parsed.data.paymentMethod,
        promoAtPayment?.promoCode ?? effectiveTx.promoCode,
        bonusAtPayment ? Number(fromMinorUnits(bonusAtPayment.amountMinor, tx.sendCurrency)) : null,
        req,
        promoAtPayment,
        bonusAtPayment,
      );
      const mitoPatch = {
        ...(tx.mitoTransactionId ? {} : await initiateHostedForSendMoneyTx(effectiveTx, userId, req)),
        ...mitoSendPatch,
      };

      const status = statusForPaymentMethod(parsed.data.paymentMethod);
      const now = new Date();
      const receiveAmountPatch: Partial<SendMoneyTransaction> = (() => {
        const rateNum = Number(tx.exchangeRate);
        if (!Number.isFinite(rateNum) || rateNum <= 0) return {};
        const extraMinor = bonusAtPayment?.mode === "send_more" && bonusAtPayment.amountMinor > 0 ? bonusAtPayment.amountMinor : 0;
        const decimals = tx.receiveCurrency.toUpperCase() === "JPY" ? 0 : 2;
        const expectedReceiveMinor = toMinorUnits(
          (Number(fromMinorUnits(tx.sendAmountMinor + extraMinor, tx.sendCurrency)) * rateNum).toFixed(decimals),
          tx.receiveCurrency,
        );
        if (extraMinor === 0 && tx.receiveAmountMinor === expectedReceiveMinor) return {};
        // Update when send_more is chosen on Step 4 OR when Step 1 send_more was switched to pay_less/none on Step 4
        if (extraMinor > 0 || tx.receiveAmountMinor > expectedReceiveMinor) {
          return { receiveAmountMinor: expectedReceiveMinor };
        }
        return {};
      })();
      let updated: SendMoneyTransaction | undefined;
      try {
        updated = await storage.updateSendMoneyTransaction(tx.id, {
          ...mitoPatch,
          ...receiveAmountPatch,
          paymentMethod: parsed.data.paymentMethod,
          status,
          paidAt: status === "completed" ? now : null,
          ...(switchedPromoToBonus
            ? { promoCode: null, feeBeforePromoMinor: null, feeMinor: effectiveTx.feeMinor, promoDiscountMinor: null, promoAppliesTo: undefined }
            : {}),
          ...(promoAtPayment
            ? { promoCode: promoAtPayment.promoCode, feeBeforePromoMinor: promoAtPayment.feeBeforePromoMinor, feeMinor: promoAtPayment.feeMinor, promoDiscountMinor: promoAtPayment.promoDiscountMinor, ...(promoAtPayment.promoAppliesTo === "amount" ? { promoAppliesTo: "amount" as const } : {}), promoRedeemedAt: now }
            : {}),
          ...(bonusAtPayment ? { bonusCreditMinor: bonusAtPayment.amountMinor, bonusCreditMode: bonusAtPayment.mode } : {}),
        });
      } catch (err) {
        if (promoAtPayment) await promo.releaseForPayment(tx.reference);
        if (bonusAtPayment) await bonus.releaseForPayment(userId, tx.reference);
        throw err;
      }
      if (!updated) {
        if (promoAtPayment) await promo.releaseForPayment(tx.reference);
        if (bonusAtPayment) await bonus.releaseForPayment(userId, tx.reference);
        throw new SendMoneyError(500, "INTERNAL_ERROR", "The payment could not be recorded. Please try again.");
      }
      if (status === "completed") {
        await dispatchNotification({ userId, type: "transaction_complete", data: notificationData(updated) });
        // Referral programme: a completed transfer may qualify a referral (US-4.1)
        const event = { reference: updated.reference, sendAmount: Number(fromMinorUnits(updated.sendAmountMinor, updated.sendCurrency)), sendCurrency: updated.sendCurrency, receiveCurrency: updated.receiveCurrency, createdAt: updated.createdAt };
        void onTransferEvent(userId, event, "PAID").then(() => onTransferEvent(userId, event, "COMPLETED"));
        promo.onTransferStatus(userId, updated, "PAID");
        promo.onTransferStatus(userId, updated, "COMPLETED");
        bonus.onTransferStatus(userId, updated, "PAID");
        bonus.onTransferStatus(userId, updated, "COMPLETED");
      }
      return res.json({ data: toView(updated) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/send-money/transactions/:id/cancel", async (req: Request, res: Response) => {
    try {
      const userId = requireStrictAuth(req);
      const tx = await getOwnedTransaction(req.params.id, userId);
      if (tx.status !== "awaiting_payment" && tx.status !== "pending") {
        throw new SendMoneyError(409, "INVALID_STATE", "Only a transaction awaiting payment can be cancelled.");
      }
      const updated = await storage.updateSendMoneyTransaction(tx.id, {
        status: "cancelled",
        cancelledAt: new Date(),
      });
      if (!updated) {
        throw new SendMoneyError(500, "INTERNAL_ERROR", "The transaction could not be cancelled. Please try again.");
      }
      await dispatchNotification({ userId, type: "transaction_cancelled_customer", data: notificationData(updated) });
      // Releases any bonus used on this transfer (AC-5.2.10) and un-pends a referral (AC-4.4.1)
      void onTransferEvent(userId, { reference: updated.reference, sendAmount: Number(fromMinorUnits(updated.sendAmountMinor, updated.sendCurrency)), sendCurrency: updated.sendCurrency, receiveCurrency: updated.receiveCurrency, createdAt: updated.createdAt }, "CANCELLED");
      // Gives the promo code use back (PROMO-RHEMITO P-30); the rewards path above also does, both are idempotent (P-33)
      promo.onTransferStatus(userId, updated, "CANCELLED");
      // Bonus module: gives back any bonus used and removes what this transfer earned (BONUS-RHEMITO B-10)
      bonus.onTransferStatus(userId, updated, "CANCELLED");
      return res.json({ data: toView(updated) });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ─── Mito Retail Sandbox Webhook Handler & Inspector ──────────────────────

  async function handleMitoWebhookRequest(
    req: Request,
    res: Response,
    overridePayload?: { rawBody: string; parsedBody: Record<string, any> },
  ) {
    try {
      let rawBodyStr = overridePayload
        ? overridePayload.rawBody
        : Buffer.isBuffer(req.rawBody)
          ? req.rawBody.toString("utf8")
          : typeof req.rawBody === "string"
            ? req.rawBody
            : JSON.stringify(req.body ?? {});

      let parsedBody: Record<string, any> = overridePayload
        ? overridePayload.parsedBody
        : (req.body ?? {}) as Record<string, any>;

      // Support replaying a captured inspector log object directly: { Id, Body: "{\"eventId\":...}", ... }
      if (
        parsedBody &&
        typeof parsedBody.Body === "string" &&
        !parsedBody.eventId &&
        !parsedBody.eventType &&
        parsedBody.Body.trim().startsWith("{")
      ) {
        try {
          rawBodyStr = parsedBody.Body;
          parsedBody = JSON.parse(parsedBody.Body) as Record<string, any>;
        } catch {
          // keep original parsedBody
        }
      }

      const headersFlat: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers ?? {})) {
        headersFlat[k] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
      }

      const sigCheck = verifyMitoWebhookSignature(rawBodyStr, parsedBody, req.headers);
      const skipVerify = String(req.query.skipVerify || "").toLowerCase() === "true";
      const requireSignature = String(req.query.requireSignature || "").toLowerCase() === "true";

      if (!skipVerify && ((sigCheck.hasSignature && !sigCheck.valid) || (requireSignature && !sigCheck.valid))) {
        recordMitoWebhookInspectorLog({
          Id: randomUUID(),
          ReceivedAtUtc: new Date().toISOString(),
          Environment: process.env.NODE_ENV || "Development",
          Method: req.method || "POST",
          Path: req.path || "/api/webhooks/mito",
          QueryString: req.originalUrl?.includes("?") ? `?${req.originalUrl.split("?")[1]}` : "",
          Headers: headersFlat,
          ContentType: String(req.headers["content-type"] || "application/json"),
          ContentLength: Buffer.byteLength(rawBodyStr, "utf8"),
          RemoteIp: String(req.ip || req.socket?.remoteAddress || "127.0.0.1"),
          SignatureHeader:
            String(
              req.headers["x-mito-signature"] ||
                req.headers["x-webhook-signature"] ||
                parsedBody?.signature ||
                "",
            ) || null,
          SignatureResult: sigCheck.reason,
          ReturnedStatusCode: 401,
          Body: rawBodyStr,
          EventId: parsedBody?.eventId ? String(parsedBody.eventId) : null,
          EventType: parsedBody?.eventType ? String(parsedBody.eventType) : null,
          Data: parsedBody?.data && typeof parsedBody.data === "object" ? parsedBody.data : null,
          Outcome: { error: "INVALID_SIGNATURE", reason: sigCheck.reason },
        });
        return res.status(401).json({
          error: {
            code: "INVALID_SIGNATURE",
            message: "Webhook signature verification failed.",
          },
        });
      }

      const explicitEventId = parsedBody?.eventId || parsedBody?.id ? String(parsedBody.eventId || parsedBody.id).trim() : "";
      const eventId = explicitEventId || randomUUID();
      const data = (
        parsedBody?.data && typeof parsedBody.data === "object" ? parsedBody.data : parsedBody
      ) as Record<string, any>;
      const eventType = String(
        parsedBody?.eventType || parsedBody?.type || parsedBody?.event || data?.status || "unknown",
      ).trim();
      const allowDuplicate = String(req.query.allowDuplicate || "").toLowerCase() === "true";

      if (explicitEventId && !allowDuplicate) {
        const existingEvent = await storage.getWebhookEvent("mito", explicitEventId);
        if (existingEvent) {
          const dupOutcome = {
            status: "ok",
            duplicate: true,
            eventId: explicitEventId,
            eventType,
            signatureVerified: sigCheck.valid,
          };
          recordMitoWebhookInspectorLog({
            Id: explicitEventId,
            ReceivedAtUtc: new Date().toISOString(),
            Environment: process.env.NODE_ENV || "Development",
            Method: req.method || "POST",
            Path: req.path || "/api/webhooks/mito",
            QueryString: req.originalUrl?.includes("?") ? `?${req.originalUrl.split("?")[1]}` : "",
            Headers: headersFlat,
            ContentType: String(req.headers["content-type"] || "application/json"),
            ContentLength: Buffer.byteLength(rawBodyStr, "utf8"),
            RemoteIp: String(req.ip || req.socket?.remoteAddress || "127.0.0.1"),
            SignatureHeader: parsedBody?.signature ? String(parsedBody.signature) : null,
            SignatureResult: sigCheck.hasSignature ? sigCheck.reason : "Skipped (no signature header configured)",
            ReturnedStatusCode: 200,
            Body: rawBodyStr,
            EventId: explicitEventId,
            EventType: eventType,
            Data: data,
            Outcome: dupOutcome,
          });
          return res.status(200).json(dupOutcome);
        }
      }

      const eventTypeLower = eventType.toLowerCase();
      const dataStatusLower = String(data?.status || "").trim().toLowerCase();
      const kycStatusField = String(data?.kycStatus || data?.verificationStatus || "").trim().toLowerCase();
      const isKycEvent =
        eventTypeLower.includes("kyc") ||
        eventTypeLower.includes("verification") ||
        eventTypeLower.startsWith("user_") ||
        Boolean(kycStatusField);

      let matchedTransaction: SendMoneyTransaction | undefined;
      let transactionTransition: string | null = null;
      let matchedUserId: string | null = null;
      let kycTransition: string | null = null;

      // 1. Transaction / Payment Status Handling
      const partnerRef = String(
        data?.partnerRef || data?.PartnerReferenceNumber || data?.partnerReferenceNumber || data?.reference || "",
      ).trim();
      const transactionRef = String(
        data?.transactionRef || data?.tnxref || data?.retailTransactionId || "",
      ).trim();
      const paymentReference = String(data?.paymentReference || "").trim();

      if (!isKycEvent || partnerRef || transactionRef || paymentReference) {
        const allTxs = await storage.listAllSendMoneyTransactions();
        matchedTransaction = allTxs.find((t) => {
          if (partnerRef && (t.reference === partnerRef || t.id === partnerRef)) return true;
          if (
            transactionRef &&
            (String(t.mitoTransactionId || "") === transactionRef ||
              String(t.mitoReference || "") === transactionRef ||
              t.reference === transactionRef)
          ) {
            return true;
          }
          if (paymentReference && String(t.mitoPaymentReference || "") === paymentReference) {
            return true;
          }
          return false;
        });

        if (matchedTransaction) {
          const effectiveStatus = dataStatusLower || eventTypeLower;
          const txPatch: Partial<Omit<SendMoneyTransaction, "id">> = {
            ...(transactionRef
              ? {
                  mitoTransactionId: transactionRef,
                  mitoReference: matchedTransaction.mitoReference || transactionRef,
                }
              : {}),
            ...(data?.userId && !matchedTransaction.mitoUserId ? { mitoUserId: String(data.userId) } : {}),
          };

          if (
            effectiveStatus === "transaction_completed" ||
            effectiveStatus === "transaction_paid" ||
            effectiveStatus === "payment_received" ||
            effectiveStatus === "completed" ||
            effectiveStatus === "paid" ||
            effectiveStatus === "successful" ||
            effectiveStatus === "settled" ||
            effectiveStatus === "success"
          ) {
            const wasCompleted = matchedTransaction.status === "completed";
            const updatedTx =
              (await storage.updateSendMoneyTransaction(matchedTransaction.id, {
                ...txPatch,
                status: "completed",
                paidAt: matchedTransaction.paidAt ?? new Date(),
              })) ?? matchedTransaction;
            matchedTransaction = updatedTx;
            transactionTransition = "completed";

            if (!wasCompleted) {
              await dispatchNotification({
                userId: updatedTx.ownerId,
                type: "transaction_complete",
                data: notificationData(updatedTx),
              });
              const transferEvt = {
                reference: updatedTx.reference,
                sendAmount: Number(fromMinorUnits(updatedTx.sendAmountMinor, updatedTx.sendCurrency)),
                sendCurrency: updatedTx.sendCurrency,
                receiveCurrency: updatedTx.receiveCurrency,
                createdAt: updatedTx.createdAt,
              };
              void onTransferEvent(updatedTx.ownerId, transferEvt, "PAID").then(() =>
                onTransferEvent(updatedTx.ownerId, transferEvt, "COMPLETED"),
              );
              promo.onTransferStatus(updatedTx.ownerId, updatedTx, "PAID");
              promo.onTransferStatus(updatedTx.ownerId, updatedTx, "COMPLETED");
              bonus.onTransferStatus(updatedTx.ownerId, updatedTx, "PAID");
              bonus.onTransferStatus(updatedTx.ownerId, updatedTx, "COMPLETED");
            }
          } else if (
            effectiveStatus === "transaction_cancelled" ||
            effectiveStatus === "cancelled" ||
            effectiveStatus === "canceled" ||
            effectiveStatus === "voided" ||
            effectiveStatus === "expired"
          ) {
            const wasCancelled = matchedTransaction.status === "cancelled";
            const updatedTx =
              (await storage.updateSendMoneyTransaction(matchedTransaction.id, {
                ...txPatch,
                status: "cancelled",
                cancelledAt: matchedTransaction.cancelledAt ?? new Date(),
              })) ?? matchedTransaction;
            matchedTransaction = updatedTx;
            transactionTransition = "cancelled";

            if (!wasCancelled) {
              await dispatchNotification({
                userId: updatedTx.ownerId,
                type: "transaction_cancelled_admin",
                data: {
                  ...notificationData(updatedTx),
                  reason: data?.failureReason || data?.resolution || undefined,
                },
              });
              const transferEvt = {
                reference: updatedTx.reference,
                sendAmount: Number(fromMinorUnits(updatedTx.sendAmountMinor, updatedTx.sendCurrency)),
                sendCurrency: updatedTx.sendCurrency,
                receiveCurrency: updatedTx.receiveCurrency,
                createdAt: updatedTx.createdAt,
              };
              void onTransferEvent(updatedTx.ownerId, transferEvt, "CANCELLED");
              promo.onTransferStatus(updatedTx.ownerId, updatedTx, "CANCELLED");
              bonus.onTransferStatus(updatedTx.ownerId, updatedTx, "CANCELLED");
            }
          } else if (
            !isKycEvent &&
            (effectiveStatus === "transaction_failed" ||
              effectiveStatus === "payment_failed" ||
              effectiveStatus === "failed" ||
              effectiveStatus === "declined" ||
              effectiveStatus === "rejected")
          ) {
            const wasFailed = matchedTransaction.status === "failed";
            const updatedTx =
              (await storage.updateSendMoneyTransaction(matchedTransaction.id, {
                ...txPatch,
                status: "failed",
              })) ?? matchedTransaction;
            matchedTransaction = updatedTx;
            transactionTransition = "failed";

            if (!wasFailed) {
              await dispatchNotification({
                userId: updatedTx.ownerId,
                type: effectiveStatus === "payment_failed" ? "payment_failed" : "transaction_failed",
                data: {
                  ...notificationData(updatedTx),
                  reason: data?.failureReason || data?.resolution || undefined,
                },
              });
              const transferEvt = {
                reference: updatedTx.reference,
                sendAmount: Number(fromMinorUnits(updatedTx.sendAmountMinor, updatedTx.sendCurrency)),
                sendCurrency: updatedTx.sendCurrency,
                receiveCurrency: updatedTx.receiveCurrency,
                createdAt: updatedTx.createdAt,
              };
              void onTransferEvent(updatedTx.ownerId, transferEvt, "FAILED");
              promo.onTransferStatus(updatedTx.ownerId, updatedTx, "FAILED");
              bonus.onTransferStatus(updatedTx.ownerId, updatedTx, "FAILED");
            }
          } else if (
            effectiveStatus === "transaction_refunded" ||
            effectiveStatus === "refunded" ||
            effectiveStatus === "recalled" ||
            effectiveStatus === "chargeback" ||
            effectiveStatus === "transaction_chargeback" ||
            Boolean(data?.chargebackReason)
          ) {
            const rewardStatus: "REFUNDED" | "RECALLED" | "CHARGEBACK" =
              effectiveStatus.includes("chargeback") || Boolean(data?.chargebackReason)
                ? "CHARGEBACK"
                : effectiveStatus.includes("recall")
                  ? "RECALLED"
                  : "REFUNDED";
            const updatedTx =
              (await storage.updateSendMoneyTransaction(matchedTransaction.id, {
                ...txPatch,
                status: "cancelled",
                cancelledAt: matchedTransaction.cancelledAt ?? new Date(),
              })) ?? matchedTransaction;
            matchedTransaction = updatedTx;
            transactionTransition = rewardStatus.toLowerCase();

            await dispatchNotification({
              userId: updatedTx.ownerId,
              type: "refund_processed",
              data: {
                ...notificationData(updatedTx),
                refundAmount: fromMinorUnits(updatedTx.sendAmountMinor, updatedTx.sendCurrency),
                currency: updatedTx.sendCurrency,
                refundMethod: updatedTx.paymentMethod || data?.paymentMethod || "original payment method",
              },
            });
            const transferEvt = {
              reference: updatedTx.reference,
              sendAmount: Number(fromMinorUnits(updatedTx.sendAmountMinor, updatedTx.sendCurrency)),
              sendCurrency: updatedTx.sendCurrency,
              receiveCurrency: updatedTx.receiveCurrency,
              createdAt: updatedTx.createdAt,
            };
            void onTransferEvent(updatedTx.ownerId, transferEvt, "REFUNDED");
            promo.onTransferStatus(updatedTx.ownerId, updatedTx, rewardStatus);
            bonus.onTransferStatus(updatedTx.ownerId, updatedTx, rewardStatus);
          } else if (
            effectiveStatus === "transaction_initiated" ||
            effectiveStatus === "initiated" ||
            effectiveStatus === "pending" ||
            effectiveStatus === "processing" ||
            effectiveStatus === "in_review" ||
            effectiveStatus === "awaiting_payment"
          ) {
            const updatedTx =
              (await storage.updateSendMoneyTransaction(matchedTransaction.id, txPatch)) ??
              matchedTransaction;
            matchedTransaction = updatedTx;
            transactionTransition = effectiveStatus;
          }
        }
      }

      // 2. KYC / User Verification Status Handling
      if (isKycEvent) {
        const rawUserId = String(data?.userId || data?.id || "").trim();
        const rawEmail = String(data?.email || "").trim().toLowerCase();

        let targetUser =
          (rawUserId ? await storage.getAuthUserById(rawUserId) : undefined) ||
          (rawUserId && resolveRhemitoUserIdFromMitoUserId(rawUserId)
            ? await storage.getAuthUserById(resolveRhemitoUserIdFromMitoUserId(rawUserId)!)
            : undefined) ||
          (rawEmail ? await storage.getAuthUserByEmail(rawEmail) : undefined);

        if (!targetUser && rawUserId) {
          const allTxs = await storage.listAllSendMoneyTransactions();
          const txForMitoUser = allTxs.find(
            (t) => String(t.mitoUserId || "").toLowerCase() === rawUserId.toLowerCase(),
          );
          if (txForMitoUser) {
            targetUser = await storage.getAuthUserById(txForMitoUser.ownerId);
          }
        }

        if (!targetUser && demoModeEnabled) {
          targetUser = await storage.getAuthUserById("user_123");
        }

        if (targetUser) {
          matchedUserId = targetUser.id;
          const rawKyc = (kycStatusField || dataStatusLower || eventTypeLower).toLowerCase();

          if (
            rawKyc.includes("approved") ||
            rawKyc.includes("verified") ||
            rawKyc.includes("passed") ||
            rawKyc.includes("completed") ||
            rawKyc === "active"
          ) {
            await storage.updateAuthUserKycStatus(targetUser.id, "passed", "active");
            kycTransition = "passed";
            void syncCustomer(targetUser.id).catch(() => {});
            await dispatchNotification({
              userId: targetUser.id,
              type: "review_complete",
              data: {
                txnId: partnerRef || transactionRef || "KYC Verification",
                kycStatus: "passed",
              },
            });
          } else if (
            rawKyc.includes("rejected") ||
            rawKyc.includes("failed") ||
            rawKyc.includes("declined")
          ) {
            await storage.updateAuthUserKycStatus(targetUser.id, "failed");
            kycTransition = "failed";
            void syncCustomer(targetUser.id).catch(() => {});
            await dispatchNotification({
              userId: targetUser.id,
              type: "document_required",
              data: {
                txnId: partnerRef || transactionRef || "KYC Verification",
                reason: data?.failureReason || data?.reason || "Additional verification required",
                kycStatus: "failed",
              },
            });
          } else if (
            rawKyc.includes("pending") ||
            rawKyc.includes("review") ||
            rawKyc.includes("document")
          ) {
            await storage.updateAuthUserKycStatus(targetUser.id, "pending");
            kycTransition = "pending";
            void syncCustomer(targetUser.id).catch(() => {});
            await dispatchNotification({
              userId: targetUser.id,
              type: rawKyc.includes("document") ? "document_required" : "under_review",
              data: {
                txnId: partnerRef || transactionRef || "KYC Verification",
                kycStatus: "pending",
              },
            });
          }
        }
      }

      await storage.addWebhookEvent({
        id: randomUUID(),
        provider: "mito",
        eventId,
        eventType,
        processedAt: new Date(),
        requestNumber: matchedTransaction?.reference || partnerRef || transactionRef || null,
      });

      const outcome = {
        status: "ok",
        duplicate: false,
        eventId,
        eventType,
        signatureVerified: sigCheck.valid,
        signatureResult: sigCheck.hasSignature ? sigCheck.reason : "Skipped (no signature header configured)",
        matchedTransaction: matchedTransaction
          ? {
              id: matchedTransaction.id,
              reference: matchedTransaction.reference,
              mitoTransactionId: matchedTransaction.mitoTransactionId ?? (transactionRef || null),
              status: matchedTransaction.status,
              transition: transactionTransition,
            }
          : null,
        unmatchedTransactionRef: !matchedTransaction ? transactionRef || partnerRef || null : null,
        matchedUser: matchedUserId
          ? {
              id: matchedUserId,
              kycStatus: kycTransition,
            }
          : null,
      };

      recordMitoWebhookInspectorLog({
        Id: eventId,
        ReceivedAtUtc: new Date().toISOString(),
        Environment: process.env.NODE_ENV || "Development",
        Method: req.method || "POST",
        Path: req.path || "/api/webhooks/mito",
        QueryString: req.originalUrl?.includes("?") ? `?${req.originalUrl.split("?")[1]}` : "",
        Headers: headersFlat,
        ContentType: String(req.headers["content-type"] || "application/json"),
        ContentLength: Buffer.byteLength(rawBodyStr, "utf8"),
        RemoteIp: String(req.ip || req.socket?.remoteAddress || "127.0.0.1"),
        SignatureHeader: parsedBody?.signature ? String(parsedBody.signature) : null,
        SignatureResult: sigCheck.hasSignature ? sigCheck.reason : "Skipped (no signature header configured)",
        ReturnedStatusCode: 200,
        Body: rawBodyStr,
        EventId: eventId,
        EventType: eventType,
        Data: data,
        Outcome: outcome,
      });

      return res.status(200).json(outcome);
    } catch (err) {
      handleError(res, err);
    }
  }

  app.post("/api/webhooks/mito", (req: Request, res: Response) => {
    void handleMitoWebhookRequest(req, res);
  });

  app.post("/webhook", (req: Request, res: Response) => {
    void handleMitoWebhookRequest(req, res);
  });

  app.get("/api/webhooks/mito", (req: Request, res: Response) => {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const events = getMitoWebhookInspectorLogs(Number.isFinite(limit) ? limit : 50);
    return res.json({
      data: {
        webhookUrl: getMitoWebhookUrl(),
        alternateWebhookPath: "/webhook",
        total: events.length,
        events,
      },
    });
  });

  app.get("/api/webhooks/mito/events", (req: Request, res: Response) => {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const events = getMitoWebhookInspectorLogs(Number.isFinite(limit) ? limit : 50);
    return res.json({
      data: {
        webhookUrl: getMitoWebhookUrl(),
        alternateWebhookPath: "/webhook",
        total: events.length,
        events,
      },
    });
  });

  /**
   * Simulates an authentic signed Mito Retail Sandbox webhook (`POST /api/webhooks/mito/simulate`)
   * for Transaction status or KYC status so developers/QA can test all webhook transitions.
   */
  app.post("/api/webhooks/mito/simulate", async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, any>;
      const eventType = String(body.eventType || body.status || "transaction_completed").trim();
      const nowIso = new Date().toISOString();
      const eventId = String(body.eventId || randomUUID()).trim();

      const unsignedPayload = {
        eventId,
        eventType,
        timestamp: String(body.timestamp || nowIso),
        data: {
          transactionRef: body.transactionRef ?? body.mitoTransactionId ?? "100877",
          partnerRef: body.partnerRef ?? body.reference ?? "TXN-SANDBOX-001",
          amount: typeof body.amount === "number" ? body.amount : Number(body.amount || 5.0),
          currency: String(body.currency || "GBP"),
          paymentMethod: body.paymentMethod ?? null,
          status: String(body.status || eventType),
          ...(body.kycStatus ? { kycStatus: String(body.kycStatus) } : {}),
          ...(body.email ? { email: String(body.email) } : {}),
          userId: String(body.userId || DEFAULT_MITO_SENDER_USER_ID),
          createdAt: String(body.createdAt || nowIso),
          updatedAt: nowIso,
          confirmationCode: body.confirmationCode ?? null,
          failureReason: body.failureReason ?? null,
          chargebackReason: body.chargebackReason ?? null,
          resolution: body.resolution ?? null,
        },
      };

      const signedPayload = signMitoWebhookPayload(unsignedPayload);
      const rawBody = JSON.stringify(signedPayload);
      return await handleMitoWebhookRequest(req, res, {
        rawBody,
        parsedBody: signedPayload,
      });
    } catch (err) {
      handleError(res, err);
    }
  });
}
