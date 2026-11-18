/**
 * Unified Transactions mapping — normalises the three server-backed money-in
 * record types (money requests, invoices, funding campaigns) into the row
 * shape the Dashboard transactions table renders alongside the send-money
 * prototype rows. Labels and pill styles mirror each record's dedicated page
 * so the unified table never reinterprets a status. The table also hosts the
 * requester/invoice actions of the removed standalone pages, so each row
 * carries its raw server record.
 */

import { CURRENCY_SYMBOLS } from "@shared/currencies";
import { formatShortDate } from "@shared/invoice-logic";
import type { MoneyRequestView } from "@/lib/requests";
import type { InvoiceListItem } from "@/lib/invoices";
import type { CampaignWithSummary } from "@/lib/groupPay";

export type TransactionType = "send_money" | "receive_money" | "invoice" | "campaign";

export interface UnifiedTransactionRow {
  key: string;
  type: Exclude<TransactionType, "send_money">;
  ref: string;
  name: string;
  email: string | null;
  service: string;
  dateLabel: string;
  dateSort: number;
  amountLabel: string;
  subNote: string | null;
  statusLabel: string;
  statusClass: string;
  dotClass: string;
  viewHref: string;
  /** Raw server records — power the row's contextual actions in the table. */
  moneyRequest?: MoneyRequestView;
  invoice?: InvoiceListItem;
}

// Requester-side action rules, ported from the removed Money Requests page:
// cancel/resend are offered only while the sender can still pay (active/viewed);
// the payment link stays shareable until the money lands or the request dies.
export const moneyRequestAwaiting = (status: string): boolean =>
  status === "active" || status === "viewed";

export const moneyRequestLinkShareable = (status: string): boolean =>
  ["active", "viewed", "authorisation_in_progress", "payment_processing", "payment_pending", "failed"].includes(status);

// Invoice notifications can be resent and the invoice cancelled only while it
// is awaiting payment (mirrors the removed Sent Invoices page).
export const invoiceActionable = (status: string): boolean =>
  status === "sent" || status === "overdue";

/** Status pill info for a raw money request (details dialog). */
export function moneyRequestStatusInfo(status: string): { label: string; pill: string; dot: string } {
  return REQUEST_STATUS[status] ?? { ...FALLBACK_STATUS, label: status };
}

/** Compact type badge shown under the counterparty name in the unified table. */
export const TYPE_BADGES: Record<TransactionType, { label: string; dot: string }> = {
  send_money: { label: "Send Money", dot: "bg-blue-500" },
  receive_money: { label: "Receive Money", dot: "bg-teal-500" },
  invoice: { label: "Invoice", dot: "bg-purple-500" },
  campaign: { label: "Campaign", dot: "bg-indigo-500" },
};

// Mirrors PaymentRequests.tsx STATUS_LABELS / STATUS_STYLES (plus dot colours).
// Traffic-light scheme (RM-02): green = completed (only a confirmed payout),
// amber = in progress / awaiting, red = failed, cancelled or expired. The text
// label always stays visible so meaning never depends on colour alone.
const TL_GREEN = { pill: "bg-transparent text-[#019B3E] border-transparent", dot: "bg-[#019B3E]" };
const TL_AMBER = { pill: "bg-transparent text-[#A79032] border-transparent", dot: "bg-[#A79032]" };
const TL_RED = { pill: "bg-transparent text-[#850707] border-transparent", dot: "bg-[#850707]" };

const REQUEST_STATUS: Record<string, { label: string; pill: string; dot: string }> = {
  active: { label: "Sent", ...TL_AMBER },
  viewed: { label: "Viewed", ...TL_AMBER },
  authorisation_in_progress: { label: "Authorisation in Progress", ...TL_AMBER },
  payment_processing: { label: "Payment Processing", ...TL_AMBER },
  payment_pending: { label: "Payment Pending", ...TL_AMBER },
  funded: { label: "Funded", ...TL_AMBER },
  payout_pending: { label: "Paying Out", ...TL_AMBER },
  paid_out: { label: "Paid Out", ...TL_GREEN },
  failed: { label: "Failed", ...TL_RED },
  expired: { label: "Expired", ...TL_RED },
  cancelled: { label: "Cancelled", ...TL_RED },
  refunded: { label: "Refunded", pill: "bg-slate-100 text-slate-600 border-slate-200", dot: "bg-slate-400" },
};

// Mirrors components/invoices/InvoiceStatusBadge.tsx.
const INVOICE_STATUS: Record<string, { label: string; pill: string; dot: string }> = {
  sent: { label: "Sent", ...TL_AMBER },
  overdue: { label: "Overdue", ...TL_RED },
  payment_processing: { label: "Payment Processing", ...TL_AMBER },
  paid: { label: "Paid", ...TL_GREEN },
  expired: { label: "Expired", ...TL_RED },
  cancelled: { label: "Cancelled", ...TL_RED },
};

// Mirrors the GroupPayDashboard status pill colours.
const CAMPAIGN_STATUS: Record<string, { label: string; pill: string; dot: string }> = {
  active: { label: "Active", ...TL_AMBER },
  completed: { label: "Completed", ...TL_GREEN },
  paused: { label: "Paused", ...TL_AMBER },
  cancelled: { label: "Cancelled", ...TL_RED },
};

const FALLBACK_STATUS = { label: "", pill: "bg-gray-50 text-gray-600 border-gray-200", dot: "bg-gray-400" };

function toDisplayDate(iso: string | null): { label: string; sort: number } {
  if (!iso) return { label: "—", sort: 0 };
  const sort = Date.parse(iso);
  return { label: formatShortDate(iso.slice(0, 10)), sort: Number.isNaN(sort) ? 0 : sort };
}

/**
 * Full-precision sort timestamp for a Send Money transaction (`paidAt` / `createdAt`),
 * preventing `toSendMoneyRow`'s display-only `"16 Nov 2026"` string from truncating
 * same-day transfers to `00:00:00` midnight below same-day campaigns/invoices/requests.
 */
export function sendMoneyDateSort(
  view: { createdAt?: string | null; paidAt?: string | null },
  fallbackDateLabel?: string,
): number {
  const paid = view.paidAt ? Date.parse(view.paidAt) : NaN;
  const created = view.createdAt ? Date.parse(view.createdAt) : NaN;
  if (!Number.isNaN(paid) && !Number.isNaN(created)) return Math.max(paid, created);
  if (!Number.isNaN(paid)) return paid;
  if (!Number.isNaN(created)) return created;
  const fallback = fallbackDateLabel ? Date.parse(fallbackDateLabel) : NaN;
  return Number.isNaN(fallback) ? 0 : fallback;
}

export function fromMoneyRequest(req: MoneyRequestView): UnifiedTransactionRow {
  const status = REQUEST_STATUS[req.status] ?? { ...FALLBACK_STATUS, label: req.status };
  return {
    key: `receive_money-${req.requestNumber}`,
    type: "receive_money",
    ref: req.requestNumber,
    name: req.senderName ?? "Any payer",
    email: req.senderEmail ?? "",
    service: "Money Request",
    dateLabel: toDisplayDate(req.createdAt).label,
    dateSort: toDisplayDate(req.createdAt).sort,
    amountLabel: `${CURRENCY_SYMBOLS[req.payoutCurrency] ?? ""}${req.payoutAmount ?? req.payInAmount} ${req.payoutCurrency}`,
    subNote: req.feeAmount
      ? req.absorbFee
        ? `after ${req.feeAmount} fee`
        : `${req.feeAmount} fee charged to sender`
      : null,
    statusLabel: status.label,
    statusClass: status.pill,
    dotClass: status.dot,
    // The /payment-requests page was consolidated into this table — the row's
    // View button opens the request details dialog instead of navigating.
    viewHref: "",
    moneyRequest: req,
  };
}

export function fromInvoice(inv: InvoiceListItem): UnifiedTransactionRow {
  const status = INVOICE_STATUS[inv.status] ?? INVOICE_STATUS.sent;
  const sent = toDisplayDate(inv.sentAt);
  return {
    key: `invoice-${inv.invoiceNumber}`,
    type: "invoice",
    ref: inv.invoiceNumber,
    name: inv.clientName,
    email: inv.clientEmail,
    service: "Invoice",
    dateLabel: sent.label,
    dateSort: sent.sort,
    amountLabel: `${CURRENCY_SYMBOLS[inv.currency] ?? ""}${inv.fees.invoiceAmount.toFixed(2)} ${inv.currency}`,
    subNote: inv.dueDate ? `Due ${formatShortDate(inv.dueDate.slice(0, 10))}` : null,
    statusLabel: status.label,
    statusClass: status.pill,
    dotClass: status.dot,
    viewHref: `/sent-invoices/${inv.id}`,
    invoice: inv,
  };
}

export function fromCampaign(c: CampaignWithSummary): UnifiedTransactionRow {
  const status = CAMPAIGN_STATUS[c.status] ?? { ...FALLBACK_STATUS, label: c.status.charAt(0).toUpperCase() + c.status.slice(1) };
  const created = toDisplayDate(c.createdAt.toISOString());
  const raisedPct = c.targetAmount > 0 ? Math.min(100, Math.round((c.summary.totalRaised / c.targetAmount) * 100)) : 0;
  return {
    key: `campaign-${c.id}`,
    type: "campaign",
    ref: c.id.slice(0, 8),
    name: c.name,
    email: null,
    service: "Funding Campaign",
    dateLabel: created.label,
    dateSort: created.sort,
    // targetAmount is stored as the raw fee-inclusive float computed at
    // creation (e.g. 102.87179487179488) — always render money at 2dp.
    amountLabel: `${CURRENCY_SYMBOLS[c.currency] ?? ""}${c.targetAmount.toFixed(2)} ${c.currency}`,
    subNote: `${raisedPct}% raised · ${c.summary.contributorCount} contributor${c.summary.contributorCount === 1 ? "" : "s"}`,
    statusLabel: status.label,
    statusClass: status.pill,
    dotClass: status.dot,
    viewHref: `/group-pay/${c.id}`,
  };
}
