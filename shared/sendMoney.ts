/**
 * Send Money transaction store — server-owned so the Dashboard unified
 * Transactions table, the cancel flow and notifications survive navigation and
 * live-update via polling like the money-in flows. Follows the same MemStorage
 * pattern as invoices, money requests and GroupPay campaigns.
 */

import { z } from "zod";

export const SEND_MONEY_STATUSES = ["awaiting_payment", "pending", "completed", "failed", "cancelled"] as const;
export type SendMoneyStatus = (typeof SEND_MONEY_STATUSES)[number];

export const SEND_MONEY_SERVICES = ["bank_deposit", "mobile_money", "cash_pickup"] as const;
export type SendMoneyService = (typeof SEND_MONEY_SERVICES)[number];

export const SEND_MONEY_PAYMENT_METHODS = ["instant_bank", "card", "manual_transfer", "wallet"] as const;
export type SendMoneyPaymentMethod = (typeof SEND_MONEY_PAYMENT_METHODS)[number];

/** Instant methods capture immediately (prototype); manual transfer keeps the payment window open. */
export function statusForPaymentMethod(method: SendMoneyPaymentMethod): SendMoneyStatus {
  return method === "manual_transfer" ? "awaiting_payment" : "completed";
}

export interface SendMoneyTransaction {
  id: string;
  ownerId: string;
  /** `TXN-YYYYMM-#####` (seeded demo rows keep their legacy numeric refs). */
  reference: string;
  recipientName: string;
  service: SendMoneyService;
  paymentMethod: SendMoneyPaymentMethod | null;
  sendCurrency: string;
  sendAmountMinor: number;
  receiveCurrency: string;
  receiveAmountMinor: number;
  feeMinor: number;
  /** Snapshot of the rate used, informational. */
  exchangeRate: string;
  promoCode: string | null;
  /** Fee before the promo discount, minor units. Lets the server re-check the discount with Mito Admin when the transfer is paid. */
  feeBeforePromoMinor?: number | null;
  /** Promo discount Mito recorded for this transfer (minor units) and when (PROMO-RHEMITO P-25). */
  promoDiscountMinor?: number | null;
  /** What the promo discount comes off: the fee (default, when absent) or the whole amount to pay (Fixed amount promos). */
  promoAppliesTo?: "fee" | "amount" | null;
  promoRedeemedAt?: Date | null;
  /** Bonus credit used on this transfer (minor units) and how (BONUS-RHEMITO B-24). */
  bonusCreditMinor?: number | null;
  bonusCreditMode?: "pay_less" | "send_more" | null;
  /** Optional Mito Retail Sandbox identifiers linked to this transfer. */
  mitoUserId?: string | null;
  mitoBeneficiaryId?: string | null;
  mitoBeneficiaryCreated?: boolean | null;
  mitoProviderId?: string | null;
  mitoProviderCode?: string | null;
  mitoRateId?: string | null;
  mitoKycUrl?: string | null;
  mitoIsTransactionAllowed?: boolean | null;
  mitoIsKycRequired?: boolean | null;
  mitoIsProfileUpdateRequired?: boolean | null;
  mitoTransactionId?: string | null;
  mitoReference?: string | null;
  mitoRequiredAction?: Record<string, unknown> | null;
  mitoHostedUrl?: string | null;
  mitoHostedPayload?: Record<string, unknown> | null;
  mitoPaymentUrl?: string | null;
  mitoPaymentSession?: Record<string, unknown> | null;
  mitoLinkToken?: string | null;
  mitoPaymentReference?: string | null;
  mitoCheckoutPublicKey?: string | null;
  mitoSendMoneyPayload?: Record<string, unknown> | null;
  sendCountryIso3?: string | null;
  receiveCountryIso3?: string | null;
  relationship?: string | null;
  relationId?: string | null;
  reasonCode?: string | null;
  reasonId?: string | null;
  otherReason?: string | null;
  sourceOfFundCode?: string | null;
  paymentNarration?: string | null;
  /** Optional recipient details persisted from Step 3 so Step 4 can create a Mito beneficiary on-demand if needed. */
  beneficiaryType?: "individual" | "business" | null;
  companyName?: string | null;
  recipientFirstName?: string | null;
  recipientLastName?: string | null;
  nickName?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  iban?: string | null;
  sortCode?: string | null;
  swift?: string | null;
  aba?: string | null;
  ifsc?: string | null;
  bsbCode?: string | null;
  branchCode?: string | null;
  mobileNo?: string | null;
  address?: string | null;
  city?: string | null;
  postcode?: string | null;
  stateOrProvince?: string | null;
  /** Beneficiary-journey parity (DEC-2026-11-19) - additive, optional. */
  isInternational?: boolean | null;
  dob?: string | null;
  gender?: string | null;
  addressLine2?: string | null;
  otherRelationship?: string | null;
  bankCode?: string | null;
  clabe?: string | null;
  cnaps?: string | null;
  accountHolderName?: string | null;
  status: SendMoneyStatus;
  createdAt: Date;
  paidAt: Date | null;
  cancelledAt: Date | null;
}

export const createSendMoneyTransactionSchema = z.object({
  recipientName: z.string().trim().min(1).max(120),
  service: z.enum(SEND_MONEY_SERVICES),
  sendCurrency: z.string().trim().length(3).default("GBP"),
  sendAmount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid send amount"),
  receiveCurrency: z.string().trim().length(3),
  receiveAmount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid receive amount"),
  fee: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid fee"),
  exchangeRate: z.string().trim().min(1),
  promoCode: z.string().trim().max(40).optional(),
  feeBeforePromo: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid fee").optional(),
  /** Only for promos that come off the whole amount (Fixed amount): the discount shown to the customer. */
  promoAppliesTo: z.enum(["fee", "amount"]).optional(),
  promoDiscount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid discount").optional(),
  /** Optional recipient & Mito Retail Sandbox fields from Step 3. */
  beneficiaryType: z.enum(["individual", "business"]).optional(),
  companyName: z.string().trim().max(120).optional(),
  recipientFirstName: z.string().trim().max(80).optional(),
  recipientLastName: z.string().trim().max(80).optional(),
  relationship: z.string().trim().max(60).optional(),
  relationId: z.string().trim().max(80).optional(),
  nickName: z.string().trim().max(80).optional(),
  reason: z.string().trim().max(80).optional(),
  reasonId: z.string().trim().max(80).optional(),
  otherReason: z.string().trim().max(160).optional(),
  narration: z.string().trim().max(250).optional(),
  address: z.string().trim().max(180).optional(),
  city: z.string().trim().max(80).optional(),
  postcode: z.string().trim().max(40).optional(),
  stateOrProvince: z.string().trim().max(80).optional(),
  mobileNo: z.string().trim().max(40).optional(),
  bankName: z.string().trim().max(120).optional(),
  accountNumber: z.string().trim().max(60).optional(),
  sortCode: z.string().trim().max(30).optional(),
  iban: z.string().trim().max(60).optional(),
  swift: z.string().trim().max(30).optional(),
  aba: z.string().trim().max(30).optional(),
  ifsc: z.string().trim().max(30).optional(),
  bsbCode: z.string().trim().max(30).optional(),
  branchCode: z.string().trim().max(30).optional(),
  countryIso3: z.string().trim().max(10).optional(),
  sendCountryIso3: z.string().trim().max(10).optional(),
  country: z.string().trim().max(80).optional(),
  sourceOfFundCode: z.string().trim().max(80).optional(),
  beneficiaryId: z.string().trim().max(80).optional(),
  providerId: z.string().trim().max(80).optional(),
  providerCode: z.string().trim().max(40).optional(),
  affiliateRateId: z.string().trim().max(80).optional(),
  /** Beneficiary-journey parity (DEC-2026-11-19) - additive, optional. */
  isInternational: z.boolean().optional(),
  dob: z.string().trim().max(20).optional(),
  gender: z.string().trim().max(20).optional(),
  addressLine2: z.string().trim().max(180).optional(),
  otherRelationship: z.string().trim().max(160).optional(),
  bankCode: z.string().trim().max(30).optional(),
  clabe: z.string().trim().max(30).optional(),
  cnaps: z.string().trim().max(30).optional(),
  accountHolderName: z.string().trim().max(120).optional(),
});

export const paySendMoneyTransactionSchema = z.object({
  paymentMethod: z.enum(SEND_MONEY_PAYMENT_METHODS),
  /** A promo code applied on the payment step, with the discount the customer was shown (PROMO-RHEMITO P-20). */
  promoCode: z.string().trim().max(20).optional(),
  promoDiscount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid discount").optional(),
  /** Bonus credit chosen on the payment step (BONUS-RHEMITO B-20). */
  bonusCredit: z
    .object({
      mode: z.enum(["pay_less", "send_more"]),
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid bonus amount"),
    })
    .optional(),
});

/** API shape — money as display strings (2dp) and ISO timestamps. */
export interface SendMoneyTransactionView {
  id: string;
  reference: string;
  recipientName: string;
  service: SendMoneyService;
  paymentMethod: SendMoneyPaymentMethod | null;
  sendCurrency: string;
  sendAmount: string;
  receiveCurrency: string;
  receiveAmount: string;
  fee: string;
  exchangeRate: string;
  promoCode: string | null;
  /** Promo discount recorded at payment, display string (2dp) or null. */
  promoDiscount?: string | null;
  /** "amount" when the promo came off the whole amount to pay (Fixed amount); otherwise it came off the fee. */
  promoAppliesTo?: "fee" | "amount" | null;
  /** Bonus credit used, display string (2dp), and how it was used (BONUS-RHEMITO B-24). */
  bonusCredit?: string | null;
  bonusCreditMode?: "pay_less" | "send_more" | null;
  /** Optional Mito Retail Sandbox identifiers linked to this transfer. */
  mitoUserId?: string | null;
  mitoBeneficiaryId?: string | null;
  mitoBeneficiaryCreated?: boolean | null;
  mitoProviderId?: string | null;
  mitoProviderCode?: string | null;
  mitoRateId?: string | null;
  mitoKycUrl?: string | null;
  mitoIsTransactionAllowed?: boolean | null;
  mitoIsKycRequired?: boolean | null;
  mitoIsProfileUpdateRequired?: boolean | null;
  mitoTransactionId?: string | null;
  mitoReference?: string | null;
  mitoRequiredAction?: Record<string, unknown> | null;
  mitoHostedUrl?: string | null;
  mitoHostedPayload?: Record<string, unknown> | null;
  mitoPaymentUrl?: string | null;
  mitoPaymentSession?: Record<string, unknown> | null;
  mitoLinkToken?: string | null;
  mitoPaymentReference?: string | null;
  mitoCheckoutPublicKey?: string | null;
  mitoSendMoneyPayload?: Record<string, unknown> | null;
  sendCountryIso3?: string | null;
  receiveCountryIso3?: string | null;
  relationship?: string | null;
  relationId?: string | null;
  reasonCode?: string | null;
  reasonId?: string | null;
  otherReason?: string | null;
  sourceOfFundCode?: string | null;
  paymentNarration?: string | null;
  /** Optional recipient details persisted from Step 3 so Step 4 can create a Mito beneficiary on-demand if needed. */
  beneficiaryType?: "individual" | "business" | null;
  companyName?: string | null;
  recipientFirstName?: string | null;
  recipientLastName?: string | null;
  nickName?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  iban?: string | null;
  sortCode?: string | null;
  swift?: string | null;
  aba?: string | null;
  ifsc?: string | null;
  bsbCode?: string | null;
  branchCode?: string | null;
  mobileNo?: string | null;
  address?: string | null;
  city?: string | null;
  postcode?: string | null;
  stateOrProvince?: string | null;
  /** Beneficiary-journey parity (DEC-2026-11-19) - additive, optional. */
  isInternational?: boolean | null;
  dob?: string | null;
  gender?: string | null;
  addressLine2?: string | null;
  otherRelationship?: string | null;
  bankCode?: string | null;
  clabe?: string | null;
  cnaps?: string | null;
  accountHolderName?: string | null;
  status: SendMoneyStatus;
  createdAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
}
