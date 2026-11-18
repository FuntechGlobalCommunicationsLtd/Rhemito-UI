import { useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Send, Receipt, ArrowRight, Gift, Copy, Check, Sparkles, Search, 
  ArrowUpRight, ArrowDownLeft, ChevronLeft, ChevronRight, Mail, 
  XCircle, FilePlus2, FileText, Users, CreditCard, Wallet, 
  Building2, X, MoreVertical 
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CancelTransactionModal, type TransactionDetails } from "@/components/CancelTransactionModal";
import { CancelMoneyRequestDialog } from "@/components/transactions/CancelMoneyRequestDialog";
import { MoneyRequestDetailsDialog } from "@/components/transactions/MoneyRequestDetailsDialog";
import { CancelInvoiceDialog } from "@/components/invoices/CancelInvoiceDialog";
import { cancelRequest, getRequests, resendEmail, type MoneyRequestView } from "@/lib/requests";
import { invoiceListUrl, resendInvoiceNotificationRequest, type InvoiceListItem, type InvoiceListResponse } from "@/lib/invoices";
import { fetchCampaigns } from "@/lib/groupPay";
import { cancelSendMoneyTransaction, getSendMoneyTransactions, toSendMoneyRow } from "@/lib/sendMoney";
import { CURRENCY_SYMBOLS } from "@shared/currencies";
import {
  DEMO_GBP_COLLECTION_BALANCE,
  DEMO_GBP_TOTAL_SENT,
  DEMO_GBP_WALLET_BALANCE,
  formatAccountAmount,
} from "@/data/collectionAccounts";
import {
  TYPE_BADGES,
  fromCampaign,
  fromInvoice,
  fromMoneyRequest,
  invoiceActionable,
  moneyRequestAwaiting,
  moneyRequestLinkShareable,
  sendMoneyDateSort,
  type TransactionType,
  type UnifiedTransactionRow,
} from "@/lib/unifiedTransactions";
import { useToast } from "@/hooks/use-toast";
import { useRewards } from "@/hooks/use-rewards";
import {
  BONUS_COPY,
  BonusBlockedNotice,
  BonusCreditPill,
  balanceFor,
  daysUntil,
  expiringSoon,
  formatMoney,
  formatUkDate,
} from "@/features/bonus";
import { ReferEarnCard } from "@/components/rewards/ReferEarnCard";
import { OfferBanner } from "@/components/rewards/OfferBanner";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { LegalStrip } from "@/components/layout/LegalStrip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { welcomeName } from "@/lib/userDisplay";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const recentRecipients = [
  { id: 1, name: "John", initials: "JD", color: "bg-[#d3e9ff] text-[#323130]" },
  { id: 2, name: "Ademade", initials: "AO", color: "bg-[#e3fdde] text-[#323130]" },
  { id: 3, name: "Brown", initials: "JB", color: "bg-[#ffd1b2] text-[#323130]" },
  { id: 4, name: "Mendoza", initials: "TM", color: "bg-[#d3e9ff] text-[#323130]" },
];

const scheduledTransactions = [
  {
    id: "SCH001",
    recipient: "Monthly Rent",
    service: "Bank Transfer",
    date: "01 Nov 2025",
    amount: "GBP 800.00",
    status: "scheduled",
  },
];

/** Shape shared by the send-money prototype rows (recent + scheduled). */
interface SendMoneyTx {
  id: string;
  recipient: string;
  service: string;
  date: string;
  amount: string;
  status: string;
}

type TypeFilter = "all" | TransactionType;

/** Unified transactions table page size — 20 records max per page. */
const TRANSACTIONS_PAGE_SIZE = 20;

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "send_money", label: "Send money" },
  { value: "receive_money", label: "Receive money" },
  { value: "invoice", label: "Invoices" },
  { value: "campaign", label: "Campaigns" },
];

/** One entry per row of the unified transactions table, sorted by dateSort. */
type MergedRow =
  | { kind: "send_money"; scheduled: boolean; dateSort: number; tx: SendMoneyTx }
  | { kind: "receive_money" | "invoice" | "campaign"; dateSort: number; row: UnifiedTransactionRow };

function formatGmtTime24(timestampMs: number, dateLabel: string): string | null {
  if (!dateLabel || dateLabel === "—") return null;
  const ms = timestampMs > 0 ? timestampMs : Date.parse(`${dateLabel} 00:00:00 GMT`);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} GMT`;
}

function formatDashboardAmount(rawAmount: string): string {
  const codeMatch = rawAmount.match(/\b([A-Z]{3})\b/);
  const code = codeMatch?.[1];
  let symbol = code ? CURRENCY_SYMBOLS[code] : undefined;
  if (!symbol && code) {
    try {
      const parts = new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: code,
        currencyDisplay: "narrowSymbol",
      }).formatToParts(0);
      symbol = parts.find((p) => p.type === "currency")?.value;
    } catch {
      symbol = undefined;
    }
  }
  const numMatch = rawAmount.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!numMatch) return rawAmount;
  const formattedNum = formatAccountAmount(Number(numMatch[0]));
  return symbol ? `${symbol} ${formattedNum}` : formattedNum;
}

function DateCellWithGmtTooltip({ dateLabel, timestampMs }: { dateLabel: string; timestampMs: number }) {
  const gmtTime = formatGmtTime24(timestampMs, dateLabel);
  if (!gmtTime) {
    return <span>{dateLabel}</span>;
  }
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="cursor-default border-b border-dotted border-transparent hover:border-slate-400 transition-colors focus-visible:outline-none"
        >
          {dateLabel}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="bg-foreground text-background px-2.5 py-1 text-xs font-medium shadow-sm tabular-nums"
      >
        {gmtTime}
      </TooltipContent>
    </Tooltip>
  );
}

function OrderNoCell({ orderNo }: { orderNo: string }) {
  const compact = orderNo.length > 2 ? `${orderNo.slice(0, 2)}...` : orderNo;
  return (
    <>
      <span className="hidden @4xl:inline tracking-tight whitespace-nowrap">
        {orderNo}
      </span>
      <Tooltip delayDuration={150}>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="inline @4xl:hidden tracking-tight whitespace-nowrap cursor-default border-b border-dotted border-transparent hover:border-slate-400 transition-colors focus-visible:outline-none"
          >
            {compact}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="bg-foreground text-background px-2.5 py-1 text-xs font-medium shadow-sm tabular-nums"
        >
          {orderNo}
        </TooltipContent>
      </Tooltip>
    </>
  );
}

function SendMoneyRow({
  tx,
  dateSort,
  scheduled,
  onCancel,
}: {
  tx: SendMoneyTx;
  dateSort: number;
  scheduled: boolean;
  onCancel: (tx: SendMoneyTx) => void;
}) {
  // Resend is offered ONLY for terminal (settled) statuses.
  // Terminal = completed (successful), failed, cancelled (aborted).
  // In-flight states (awaiting_payment, pending, scheduled) never show Resend.
  // Cancel is offered ONLY while awaiting_payment.
  const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;
  const isTerminal = (TERMINAL_STATUSES as readonly string[]).includes(tx.status);
  const canCancel = tx.status === "awaiting_payment";
  return (
    <TableRow
      data-testid={scheduled ? `row-scheduled-${tx.id}` : `row-transaction-${tx.id}`}
      className={cn(
        "hover:bg-slate-50/80 transition-colors duration-150 group border-b border-slate-100 last:border-b-0",
        tx.status === "awaiting_payment" && "border-l-2 border-l-amber-400 bg-amber-50/15"
      )}
    >
      <TableCell className="text-[13px] font-medium text-slate-700 py-4 pl-4 sm:pl-6">
        <div className="flex items-center gap-2.5">
          <span className="w-5 h-5 rounded-full border border-blue-500 text-blue-600 flex items-center justify-center shrink-0">
            <ArrowUpRight className="w-3 h-3" aria-hidden />
          </span>
          <OrderNoCell orderNo={tx.id} />
        </div>
        <div className="text-xs font-bold text-gray-900 mt-0.5 sm:hidden pl-7 tabular-nums">{formatDashboardAmount(tx.amount)}</div>
      </TableCell>
      <TableCell className="text-slate-500 text-[13px] hidden sm:table-cell py-4">
        <DateCellWithGmtTooltip dateLabel={tx.date} timestampMs={dateSort} />
      </TableCell>
      <TableCell className="text-[13px] font-medium text-slate-700 py-4">
        <div>{tx.recipient}</div>
      </TableCell>
      <TableCell className="text-slate-500 text-[13px] hidden md:table-cell py-4">
        <span>{tx.service}</span>
      </TableCell>
      <TableCell className="text-slate-600 text-[13px] font-normal py-4 hidden sm:table-cell">
        <span className="tabular-nums whitespace-nowrap">{formatDashboardAmount(tx.amount)}</span>
      </TableCell>
      <TableCell className="text-center py-4">
        {scheduled ? (
          <div className="flex items-center justify-center gap-2">
            <span title="Scheduled" className="status-light inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-[#a79032] border border-amber-200 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-[#a79032] animate-pulse" />
              Scheduled
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2">
            <AnimatePresence mode="wait">
              {tx.status === "cancelled" ? (
                <motion.span title="Cancelled"
                  key="cancelled"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="status-light inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-[#850707] border border-red-200 shadow-2xs"
                >
                  <span className="w-2 h-2 rounded-full bg-[#850707]" />
                  Cancelled
                </motion.span>
              ) : tx.status === "failed" ? (
                <motion.span title="Failed"
                  key="failed"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="status-light inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-[#850707] border border-red-200 shadow-2xs"
                >
                  <span className="w-2 h-2 rounded-full bg-[#850707]" />
                  Failed
                </motion.span>
              ) : tx.status === "completed" ? (
                <motion.span title="Completed"
                  key="completed"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="status-light inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-[#019b3e] border border-emerald-200 shadow-2xs"
                >
                  <span className="w-2 h-2 rounded-full bg-[#019b3e]" />
                  Completed
                </motion.span>
              ) : tx.status === "awaiting_payment" ? (
                <motion.span title="Awaiting Payment"
                  key="awaiting_payment"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="status-light inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-50 text-[#ff7013] border border-orange-200 shadow-2xs"
                >
                  <span className="w-2 h-2 rounded-full bg-[#ff7013]" />
                  Awaiting Payment
                </motion.span>
              ) : (
                <motion.span title="Pending"
                  key="pending"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="status-light inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-[#a79032] border border-amber-200 shadow-2xs"
                >
                  <span className="w-2 h-2 rounded-full bg-[#a79032]" />
                  Pending
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        )}
      </TableCell>
      <TableCell className="text-center py-4 px-8 sm:px-10">
        <div className="inline-flex items-center justify-center">
          {scheduled ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-[88px] px-0 text-xs font-semibold rounded-full border-[#b10909] text-[#b10909] hover:bg-red-50 hover:text-[#b10909] transition-all active:scale-95"
              data-testid={`button-cancel-${tx.id}`}
            >
              Cancel
            </Button>
          ) : !isTerminal && !canCancel ? (
            <span className="inline-flex h-7 w-[88px] items-center justify-center text-gray-300 text-sm">—</span>
          ) : isTerminal ? (
            <Button
              size="sm"
              className="bg-[#2e5bff] hover:bg-blue-700 text-white h-7 w-[88px] px-0 text-xs font-semibold rounded-full shadow-2xs transition-all active:scale-95"
              data-testid={`button-resend-${tx.id}`}
            >
              Resend
            </Button>
          ) : (
            <AnimatePresence>
              {canCancel && (
                <motion.div
                  key={`cancel-btn-${tx.id}`}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.15 }}
                >
                  <Button
                    size="sm"
                    variant="outline"
                    className={cn(
                      "h-7 w-[88px] px-0 text-xs font-semibold rounded-full",
                      "text-[#b10909] border border-[#b10909] bg-white",
                      "hover:bg-red-50 hover:border-red-700 hover:text-red-700",
                      "active:bg-red-100 active:border-red-800",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400",
                      "transition-colors duration-150"
                    )}
                    aria-label={`Cancel transaction ${tx.id}`}
                    data-testid={`button-cancel-${tx.id}`}
                    onClick={() => onCancel(tx)}
                  >
                    Cancel
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

interface UnifiedRowProps {
  row: UnifiedTransactionRow;
  onView: (href: string) => void;
  onRequestDetails: (req: MoneyRequestView) => void;
  onRequestResend: (req: MoneyRequestView) => void;
  onRequestCopyLink: (req: MoneyRequestView) => void;
  onRequestCancel: (req: MoneyRequestView) => void;
  onInvoiceResend: (invoice: InvoiceListItem) => void;
  onInvoiceCancel: (invoice: InvoiceListItem) => void;
  resendingInvoiceId: string | null;
}

function UnifiedRow({
  row,
  onView,
  onRequestDetails,
  onRequestResend,
  onRequestCopyLink,
  onRequestCancel,
  onInvoiceResend,
  onInvoiceCancel,
  resendingInvoiceId,
}: UnifiedRowProps) {
  const req = row.moneyRequest;
  const invoice = row.invoice;
  // Ghost icon action for the money-request/invoice rows — the same compact
  // icon buttons the removed Money Requests / Sent Invoices pages used, so
  // their actions live on in this table.
  const iconAction = (
    title: string,
    testid: string,
    destructive: boolean,
    disabled: boolean,
    onClick: () => void,
    children: ReactNode,
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn(
            "h-8 w-8 p-0 transition-colors rounded-lg",
            destructive
              ? "text-red-600 hover:bg-red-50 hover:text-red-700"
              : "text-slate-500 hover:bg-blue-50 hover:text-blue-600",
          )}
          aria-label={title}
          data-testid={testid}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{title}</p>
      </TooltipContent>
    </Tooltip>
  );

  return (
    <TableRow
      data-testid={`row-${row.type}-${row.ref}`}
      className="hover:bg-slate-50/80 transition-colors duration-150 group border-b border-slate-100 last:border-b-0"
    >
      <TableCell className="text-[13px] font-medium text-slate-700 py-4 pl-4 sm:pl-6">
        <div className="flex items-center gap-2.5">
          <span className="w-5 h-5 rounded-full border border-blue-500 text-blue-600 flex items-center justify-center shrink-0">
            <ArrowDownLeft className="w-3 h-3" aria-hidden />
          </span>
          <OrderNoCell orderNo={row.ref} />
        </div>
        <div className="text-xs font-bold text-gray-900 mt-0.5 sm:hidden pl-7 tabular-nums">{formatDashboardAmount(row.amountLabel)}</div>
      </TableCell>
      <TableCell className="text-slate-500 text-[13px] hidden sm:table-cell py-4">
        <DateCellWithGmtTooltip dateLabel={row.dateLabel} timestampMs={row.dateSort} />
      </TableCell>
      <TableCell className="text-[13px] font-medium text-slate-700 py-4">
        <div>{row.name}</div>
      </TableCell>
      <TableCell className="text-slate-500 text-[13px] hidden md:table-cell py-4">
        <span>{row.service}</span>
      </TableCell>
      <TableCell className="text-slate-600 text-[13px] font-normal py-4 hidden sm:table-cell">
        <span className="tabular-nums whitespace-nowrap">{formatDashboardAmount(row.amountLabel)}</span>
      </TableCell>
      <TableCell className="text-center py-4">
        <div className="flex items-center justify-center gap-2">
          <span title={row.statusLabel} className={cn("status-light inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border shadow-2xs", row.statusClass)}>
            <span className={cn("w-1.5 h-1.5 rounded-full", row.dotClass)} />
            {row.statusLabel}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-center py-4 px-8 sm:px-10">
        <div className="relative inline-flex items-center justify-center">
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white h-8 w-[88px] px-0 text-xs font-medium rounded-full shadow-2xs transition-all active:scale-95"
            data-testid={`button-view-${row.ref}`}
            onClick={() => (req ? onRequestDetails(req) : onView(row.viewHref))}
          >
            View
          </Button>
          {((req && (moneyRequestAwaiting(req.status) || moneyRequestLinkShareable(req.status))) ||
            (invoice && (invoiceActionable(invoice.status) || invoice.status === "expired"))) && (
            <div className="absolute left-full ml-1.5 flex items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 data-[state=open]:bg-slate-100 data-[state=open]:text-slate-900 transition-colors cursor-pointer"
                    aria-label={`More actions for ${row.ref}`}
                    data-testid={`button-actions-more-${row.ref}`}
                  >
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 rounded-xl p-1.5 shadow-lg border-slate-200/90">
                  {req && moneyRequestAwaiting(req.status) && (
                    <DropdownMenuItem
                      data-testid={`button-resend-${row.ref}`}
                      onClick={() => onRequestResend(req)}
                      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-700 cursor-pointer"
                    >
                      <Mail className="w-4 h-4 text-slate-500" />
                      <span>Resend email</span>
                    </DropdownMenuItem>
                  )}
                  {req && moneyRequestLinkShareable(req.status) && (
                    <DropdownMenuItem
                      data-testid={`button-copy-link-${row.ref}`}
                      onClick={() => onRequestCopyLink(req)}
                      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-700 cursor-pointer"
                    >
                      <Copy className="w-4 h-4 text-slate-500" />
                      <span>Copy payment link</span>
                    </DropdownMenuItem>
                  )}
                  {req && moneyRequestAwaiting(req.status) && (
                    <>
                      <DropdownMenuSeparator className="my-1" />
                      <DropdownMenuItem
                        data-testid={`button-cancel-${row.ref}`}
                        onClick={() => onRequestCancel(req)}
                        className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-red-600 focus:bg-red-50 focus:text-red-700 cursor-pointer"
                      >
                        <XCircle className="w-4 h-4 text-red-600" />
                        <span>Cancel request</span>
                      </DropdownMenuItem>
                    </>
                  )}
                  {invoice && invoiceActionable(invoice.status) && (
                    <DropdownMenuItem
                      disabled={resendingInvoiceId === invoice.id}
                      data-testid={`button-resend-${row.ref}`}
                      onClick={() => onInvoiceResend(invoice)}
                      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-700 cursor-pointer"
                    >
                      <Mail className="w-4 h-4 text-slate-500" />
                      <span>Resend notification</span>
                    </DropdownMenuItem>
                  )}
                  {invoice && invoiceActionable(invoice.status) && (
                    <>
                      <DropdownMenuSeparator className="my-1" />
                      <DropdownMenuItem
                        data-testid={`button-cancel-${row.ref}`}
                        onClick={() => onInvoiceCancel(invoice)}
                        className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-red-600 focus:bg-red-50 focus:text-red-700 cursor-pointer"
                      >
                        <XCircle className="w-4 h-4 text-red-600" />
                        <span>Cancel invoice</span>
                      </DropdownMenuItem>
                    </>
                  )}
                  {invoice?.status === "expired" && (
                    <DropdownMenuItem
                      data-testid={`button-create-new-${row.ref}`}
                      onClick={() => onView("/send-invoice")}
                      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-blue-600 focus:bg-blue-50 focus:text-blue-700 cursor-pointer"
                    >
                      <FilePlus2 className="w-4 h-4 text-blue-600" />
                      <span>Create New Invoice</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function MobileSendMoneyCard({
  tx,
  scheduled,
  onCancel,
}: {
  tx: SendMoneyTx;
  scheduled?: boolean;
  onCancel: (tx: SendMoneyTx) => void;
}) {
  const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;
  const isTerminal = (TERMINAL_STATUSES as readonly string[]).includes(tx.status);
  const canCancel = tx.status === "awaiting_payment";

  return (
    <div
      data-testid={scheduled ? `row-scheduled-${tx.id}` : `row-transaction-${tx.id}`}
      className={cn(
        "p-4 rounded-2xl bg-white transition-all my-2 border border-slate-200/80 shadow-2xs hover:shadow-xs space-y-3",
        tx.status === "awaiting_payment" && "border-l-4 border-l-amber-400 bg-amber-50/10"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-full bg-blue-100/80 text-blue-700 font-bold text-xs flex items-center justify-center shrink-0 shadow-2xs">
            {tx.recipient.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-slate-900 text-sm truncate">{tx.recipient}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 flex-wrap">
              <span className="inline-flex items-center gap-1 font-medium text-slate-600">
                <span className={cn("w-1.5 h-1.5 rounded-full", TYPE_BADGES.send_money.dot)} />
                {TYPE_BADGES.send_money.label}
              </span>
              <span className="text-slate-300">•</span>
              <span className="font-mono text-[11px] text-blue-600 font-semibold">{tx.id}</span>
              {tx.date && (
                <>
                  <span className="text-slate-300">•</span>
                  <span className="text-[11px] text-slate-400">{tx.date}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="text-right shrink-0 flex flex-col items-end gap-1">
          <span className="font-bold text-base text-slate-900 tracking-tight whitespace-nowrap">
            {tx.amount}
          </span>
          {scheduled ? (
            <span title="Scheduled" className="status-light inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-transparent text-[#A79032] border-transparent">
              <span className="w-2 h-2 rounded-full bg-[#A79032]" />
              Scheduled
            </span>
          ) : tx.status === "cancelled" ? (
            <span title="Cancelled" className="status-light inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-transparent text-[#850707] border-transparent">
              <span className="w-2 h-2 rounded-full bg-[#850707]" />
              Cancelled
            </span>
          ) : tx.status === "completed" ? (
            <span title="Completed" className="status-light inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-transparent text-[#019B3E] border-transparent">
              <span className="w-2 h-2 rounded-full bg-[#019B3E]" />
              Completed
            </span>
          ) : tx.status === "awaiting_payment" ? (
            <span title="Awaiting Payment" className="status-light inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-transparent text-[#FF7013] border-transparent">
              <span className="w-2 h-2 rounded-full bg-[#FF7013]" />
              Awaiting Payment
            </span>
          ) : (
            <span title="Pending" className="status-light inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-transparent text-[#A79032] border-transparent">
              <span className="w-2 h-2 rounded-full bg-[#A79032]" />
              Pending
            </span>
          )}
        </div>
      </div>

      {(scheduled || isTerminal || canCancel) && (
        <div className="pt-2.5 border-t border-slate-100 flex items-center gap-2 justify-end">
          {scheduled ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-4 text-xs font-medium rounded-lg border-slate-200 text-red-600 hover:bg-red-50 hover:border-red-200 active:scale-95 transition-all w-full"
              data-testid={`button-cancel-${tx.id}`}
            >
              Cancel
            </Button>
          ) : (
            <>
              {isTerminal && (
                <Button
                  size="sm"
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white h-8 flex-1 text-xs font-medium rounded-lg shadow-sm transition-all active:scale-95"
                  data-testid={`button-resend-${tx.id}`}
                >
                  Resend
                </Button>
              )}
              {canCancel && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 flex-1 text-xs font-medium rounded-lg text-red-500 border border-red-200 bg-white hover:bg-red-50 hover:border-red-300 hover:text-red-600 active:scale-95 transition-all"
                  data-testid={`button-cancel-${tx.id}`}
                  onClick={() => onCancel(tx)}
                >
                  Cancel
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MobileUnifiedCard({
  row,
  onView,
  onRequestDetails,
  onRequestResend,
  onRequestCopyLink,
  onRequestCancel,
  onInvoiceResend,
  onInvoiceCancel,
  resendingInvoiceId,
}: UnifiedRowProps) {
  const badge = TYPE_BADGES[row.type];
  const req = row.moneyRequest;
  const invoice = row.invoice;

  return (
    <div
      data-testid={`row-${row.type}-${row.ref}`}
      className="p-4 rounded-2xl bg-white transition-all my-2 border border-slate-200/80 shadow-2xs hover:shadow-xs space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-full bg-teal/10 text-teal font-bold text-xs flex items-center justify-center shrink-0 shadow-2xs">
            {row.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-slate-900 text-sm truncate">{row.name}</div>
            {row.email ? <div className="text-xs text-slate-400 truncate">{row.email}</div> : null}
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 flex-wrap">
              <span className="inline-flex items-center gap-1 font-medium text-slate-600">
                <span className={cn("w-1.5 h-1.5 rounded-full", badge.dot)} />
                {badge.label}
              </span>
              <span className="text-slate-300">•</span>
              <span className="font-mono text-[11px] text-blue-600 font-semibold">{row.ref}</span>
              {row.dateLabel && (
                <>
                  <span className="text-slate-300">•</span>
                  <span className="text-[11px] text-slate-400">{row.dateLabel}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="text-right shrink-0 flex flex-col items-end gap-1">
          <span className="font-bold text-base text-slate-900 tracking-tight whitespace-nowrap">
            {row.amountLabel}
          </span>
          <span title={row.statusLabel} className={cn("status-light inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border shadow-2xs", row.statusClass)}>
            <span className={cn("w-1.5 h-1.5 rounded-full", row.dotClass)} />
            {row.statusLabel}
          </span>
        </div>
      </div>

      <div className="pt-2.5 border-t border-slate-100 flex items-center gap-2 flex-wrap justify-end">
        <Button
          size="sm"
          className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white h-8 px-4 text-xs font-medium rounded-lg shadow-sm transition-all active:scale-95"
          data-testid={`button-view-${row.ref}`}
          onClick={() => (req ? onRequestDetails(req) : onView(row.viewHref))}
        >
          View
        </Button>

        {req && moneyRequestAwaiting(req.status) && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs font-medium rounded-lg text-slate-700 hover:bg-slate-50 border-slate-200 active:scale-95"
            data-testid={`button-resend-${row.ref}`}
            onClick={() => onRequestResend(req)}
          >
            <Mail className="w-3.5 h-3.5 mr-1" />
            Resend
          </Button>
        )}

        {req && moneyRequestLinkShareable(req.status) && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs font-medium rounded-lg text-blue-600 hover:bg-blue-50 border-blue-200 active:scale-95"
            data-testid={`button-copy-link-${row.ref}`}
            onClick={() => onRequestCopyLink(req)}
          >
            <Copy className="w-3.5 h-3.5 mr-1" />
            Copy Link
          </Button>
        )}

        {req && moneyRequestAwaiting(req.status) && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs font-medium rounded-lg text-red-600 hover:bg-red-50 border-red-200 active:scale-95"
            data-testid={`button-cancel-${row.ref}`}
            onClick={() => onRequestCancel(req)}
          >
            <XCircle className="w-3.5 h-3.5 mr-1" />
            Cancel
          </Button>
        )}

        {invoice && invoiceActionable(invoice.status) && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs font-medium rounded-lg text-slate-700 hover:bg-slate-50 border-slate-200 active:scale-95"
            data-testid={`button-resend-${row.ref}`}
            disabled={resendingInvoiceId === invoice.id}
            onClick={() => onInvoiceResend(invoice)}
          >
            <Mail className="w-3.5 h-3.5 mr-1" />
            Resend
          </Button>
        )}

        {invoice && invoiceActionable(invoice.status) && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs font-medium rounded-lg text-red-600 hover:bg-red-50 border-red-200 active:scale-95"
            data-testid={`button-cancel-${row.ref}`}
            onClick={() => onInvoiceCancel(invoice)}
          >
            <XCircle className="w-3.5 h-3.5 mr-1" />
            Cancel
          </Button>
        )}

        {invoice?.status === "expired" && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 text-xs font-medium rounded-lg border-gray-200 hover:border-blue-300 hover:text-blue-600 active:scale-95"
            data-testid={`button-create-new-${row.ref}`}
            onClick={() => onView("/send-invoice")}
          >
            <FilePlus2 className="w-3.5 h-3.5 mr-1.5" />
            Create New Invoice
          </Button>
        )}
      </div>
    </div>
  );
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: {
      duration: 0.35,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  },
};

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const searchParams = useSearch();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { demoUser, isLoading: isAuthLoading } = useAuth();
  const activeUser = user ?? demoUser;
  // Referral & Bonus — live offer, wallet and referrals from the rewards API
  const rewards = useRewards();
  const rewardsCurrency = rewards.data?.currency ?? "GBP";
  const bonusBalance = balanceFor(rewards.data?.wallet, rewardsCurrency);
  const allWalletBalances = rewards.data?.wallet.balances ?? [];
  const availableBalances = allWalletBalances.filter((b) => b.available > 0);
  const displayBonusBalances = availableBalances.length > 0 ? availableBalances : bonusBalance.available > 0 ? [bonusBalance] : [];
  const totalUnusedText = displayBonusBalances.map((b) => formatMoney(b.available, b.currency)).join(" + ");
  // Compute earned & used strictly from actual wallet credits (fallback to balance fields only when credits array is empty)
  const walletCredits = rewards.data?.wallet.credits ?? [];
  const activeWalletCredits = walletCredits.filter((c) => c.status !== "REVERSED");
  const earnedByCur: Record<string, number> = {};
  const usedByCur: Record<string, number> = {};
  if (activeWalletCredits.length > 0) {
    for (const c of activeWalletCredits) {
      const cur = c.currency || rewardsCurrency;
      earnedByCur[cur] = Number(((earnedByCur[cur] ?? 0) + Number(c.amount || 0)).toFixed(2));
      if (c.status === "USED" || c.status === "PARTLY_USED") {
        const usedAmt = Math.max(0, Number(c.amount || 0) - Number(c.remaining || 0));
        usedByCur[cur] = Number(((usedByCur[cur] ?? 0) + usedAmt).toFixed(2));
      } else if (!(cur in usedByCur)) {
        usedByCur[cur] = 0;
      }
    }
  } else {
    for (const b of displayBonusBalances) {
      earnedByCur[b.currency] = b.earned || b.available || 0;
      usedByCur[b.currency] = b.used || 0;
    }
  }
  const earnedEntries = Object.entries(earnedByCur).filter(([, v]) => v > 0);
  const totalBonusEarnedText =
    earnedEntries.length > 0
      ? earnedEntries.map(([c, v]) => formatMoney(v, c)).join(" + ")
      : totalUnusedText || formatMoney(0, rewardsCurrency);
  const promoRedemptions = (
    (rewards.data?.wallet as { promo_redemptions?: { id?: string; amount?: number; currency?: string; transfer_id?: string }[] } | undefined)
      ?.promo_redemptions ?? []
  ).filter((p) => p.id !== "pr_1" && p.id !== "pr_2" && p.transfer_id !== "txn_promo_1" && p.transfer_id !== "txn_promo_2");
  const savedByCur: Record<string, number> = { ...usedByCur };
  for (const p of promoRedemptions) {
    const cur = (p.currency ?? rewardsCurrency).toUpperCase();
    const amt = Math.abs(Number(p.amount ?? 0));
    if (amt > 0) {
      savedByCur[cur] = Number(((savedByCur[cur] ?? 0) + amt).toFixed(2));
    }
  }
  const savedEntries = Object.entries(savedByCur).filter(([, v]) => v > 0);
  const totalRewardsSavedText =
    savedEntries.length > 0
      ? savedEntries.map(([c, v]) => formatMoney(v, c)).join(" + ")
      : formatMoney(0, displayBonusBalances[0]?.currency ?? rewardsCurrency);
  const [referHighlighted, setReferHighlighted] = useState(false);
  const [selectedBonusCurrency, setSelectedBonusCurrency] = useState<string>("");
  const [dismissedRefereeStrip, setDismissedRefereeStrip] = useState<boolean>(false);
  const activeBonusBalance =
    displayBonusBalances.find((b) => b.currency === selectedBonusCurrency) ??
    displayBonusBalances[0] ??
    null;
  const refereeReferredBy = String(
    (rewards.data as { referredBy?: string; referred_by?: string } | undefined)?.referredBy ??
      (rewards.data as { referredBy?: string; referred_by?: string } | undefined)?.referred_by ??
      (rewards.data?.customer as { referredBy?: string; referred_by?: string } | null | undefined)?.referredBy ??
      (rewards.data?.customer as { referredBy?: string; referred_by?: string } | null | undefined)?.referred_by ??
      "",
  ).trim();
  const showRefereeZeroBalanceStrip =
    displayBonusBalances.length === 0 && Boolean(refereeReferredBy) && !dismissedRefereeStrip;
  const viewReferOffer = () => {
    document.getElementById("refer-earn")?.scrollIntoView({ behavior: "smooth", block: "center" });
    setReferHighlighted(true);
    window.setTimeout(() => setReferHighlighted(false), 2000);
  };
  const [cancelTarget, setCancelTarget] = useState<TransactionDetails | null>(null);
  // Money-request / invoice actions merged from the removed standalone pages.
  const [requestDetails, setRequestDetails] = useState<MoneyRequestView | null>(null);
  const [requestToCancel, setRequestToCancel] = useState<MoneyRequestView | null>(null);
  const [invoiceToCancel, setInvoiceToCancel] = useState<InvoiceListItem | null>(null);
  const [resendingInvoiceId, setResendingInvoiceId] = useState<string | null>(null);
  const { toast } = useToast();
  const isMobile = useIsMobile();

  // Unified Transactions table — server-backed money-in records (money
  // requests, invoices, campaigns) merged with the send-money prototype rows.
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const transactionsSectionRef = useRef<HTMLDivElement>(null);
  const isDemoUser = !isAuthLoading && (!user || user.id === "user_123");

  const requestsQuery = useQuery({
    queryKey: ["/api/request-money/requests", user?.id ?? "demo"],
    queryFn: getRequests,
    enabled: !isAuthLoading,
    refetchOnMount: "always",
    refetchInterval: 5000,
  });
  const sendMoneyQuery = useQuery({
    queryKey: ["/api/send-money/transactions", user?.id ?? "demo"],
    queryFn: getSendMoneyTransactions,
    enabled: !isAuthLoading,
    refetchOnMount: "always",
    refetchInterval: 5000,
  });
  const invoicesQuery = useQuery({
    queryKey: ["/api/invoices", "dashboard", user?.id ?? "demo"],
    queryFn: async () => {
      const res = await apiRequest("GET", invoiceListUrl({}));
      return ((await res.json()) as InvoiceListResponse).data;
    },
    enabled: !isAuthLoading,
    refetchOnMount: "always",
    refetchInterval: 5000,
  });
  const campaignsQuery = useQuery({
    queryKey: ["/api/group-pay/campaigns", user?.id ?? "demo"],
    queryFn: fetchCampaigns,
    enabled: !isAuthLoading,
    refetchOnMount: "always",
    refetchInterval: 5000,
  });

  const mergedRows = useMemo<MergedRow[]>(() => {
    const sendRows: MergedRow[] = [
      ...(sendMoneyQuery.data ?? []).map((view) => {
        const tx = toSendMoneyRow(view);
        return {
          kind: "send_money" as const,
          scheduled: false,
          dateSort: sendMoneyDateSort(view, tx.date),
          tx,
        };
      }),
      ...(isDemoUser
        ? scheduledTransactions.map((tx) => ({
            kind: "send_money" as const,
            scheduled: true,
            dateSort: Date.parse(`${tx.date} 00:00:00 GMT`) || 0,
            tx,
          }))
        : []),
    ];
    const moneyInRows: MergedRow[] = [
      ...(requestsQuery.data ?? []).map(fromMoneyRequest),
      ...(invoicesQuery.data ?? []).map(fromInvoice),
      ...(campaignsQuery.data ?? []).map(fromCampaign),
    ].map((row) => ({ kind: row.type, dateSort: row.dateSort, row }));
    return [...sendRows, ...moneyInRows].sort((a, b) => {
      if (b.dateSort !== a.dateSort) return b.dateSort - a.dateSort;
      if (a.kind === "send_money" && b.kind === "send_money") {
        return b.tx.id.localeCompare(a.tx.id);
      }
      return 0;
    });
  }, [sendMoneyQuery.data, requestsQuery.data, invoicesQuery.data, campaignsQuery.data, isDemoUser]);

  const totalSentFormatted = useMemo(() => {
    if (isDemoUser) return formatAccountAmount(DEMO_GBP_TOTAL_SENT);
    const totalSentMajor = (sendMoneyQuery.data ?? [])
      .filter((tx) => tx.status === "completed")
      .reduce((sum, tx) => sum + Number(tx.sendAmount || 0), 0);
    return formatAccountAmount(totalSentMajor);
  }, [isDemoUser, sendMoneyQuery.data]);
  const walletBalanceAmount = isDemoUser ? DEMO_GBP_WALLET_BALANCE : 0;
  const collectionBalanceAmount = isDemoUser ? DEMO_GBP_COLLECTION_BALANCE : 0;
  const walletBalanceFormatted = formatAccountAmount(walletBalanceAmount);
  const collectionBalanceFormatted = formatAccountAmount(collectionBalanceAmount);
  const isWalletNonZero = walletBalanceAmount > 0;
  const isCollectionNonZero = collectionBalanceAmount > 0;

  const searchLower = search.trim().toLowerCase();
  const searchedRows = useMemo(() => {
    if (!searchLower) return mergedRows;
    return mergedRows.filter((row) => {
      const fields =
        row.kind === "send_money"
          ? [row.tx.id, row.tx.recipient, row.tx.service, row.tx.amount]
          : [row.row.ref, row.row.name, row.row.email ?? "", row.row.service, row.row.amountLabel];
      return fields.some((value) => value.toLowerCase().includes(searchLower));
    });
  }, [mergedRows, searchLower]);

  const typeCounts = useMemo(() => {
    const counts: Record<TypeFilter, number> = { all: searchedRows.length, send_money: 0, receive_money: 0, invoice: 0, campaign: 0 };
    for (const row of searchedRows) counts[row.kind] += 1;
    return counts;
  }, [searchedRows]);

  const visibleRows = typeFilter === "all" ? searchedRows : searchedRows.filter((row) => row.kind === typeFilter);
  const totalPages = Math.max(1, Math.ceil(visibleRows.length / TRANSACTIONS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = visibleRows.slice((safePage - 1) * TRANSACTIONS_PAGE_SIZE, safePage * TRANSACTIONS_PAGE_SIZE);
  const anyQueryLoading = requestsQuery.isLoading || invoicesQuery.isLoading || campaignsQuery.isLoading || sendMoneyQuery.isLoading;

  // Sidebar "Transactions" deep link (/?type=<filter>): apply the matching
  // type filter and center the transactions table in the viewport. Re-runs
  // on query changes, so it also works when the Dashboard is already open,
  // and waits for the table data so the centered position is final.
  useEffect(() => {
    const type = new URLSearchParams(searchParams).get("type");
    if (!TYPE_FILTERS.some((filter) => filter.value === type)) return;
    setTypeFilter(type as TypeFilter);
    setPage(1);
    if (anyQueryLoading) return;
    const timer = window.setTimeout(() => {
      transactionsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchParams, anyQueryLoading]);

  const handleCancelClick = (tx: SendMoneyTx): void => {
    setCancelTarget({
      id: tx.id,
      recipient: tx.recipient,
      amount: tx.amount,
      service: tx.service,
    });
  };

  const handleCancelConfirm = async (transactionId: string): Promise<void> => {
    // Cancel the real server-owned transaction (the endpoint accepts the row
    // reference) — the bell notification is dispatched server-side with the
    // same payload shape this page used to send, and polling brings the
    // cancelled row back into the table.
    try {
      await cancelSendMoneyTransaction(transactionId);
    } catch {
      // Non-blocking — the table refreshes via polling either way.
    }
    setCancelTarget(null);
    void queryClient.invalidateQueries({ queryKey: ["/api/send-money/transactions"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    toast({
      title: "Transaction cancelled",
      description: `Ref ${transactionId} has been cancelled successfully. A confirmation has been sent to your registered email address.`,
      duration: 6000,
    });
  };

  const handleCancelModalClose = (): void => {
    setCancelTarget(null);
  };

  // ── Money-request actions (ported from the removed /payment-requests page) ──
  const runRequestAction = async (action: string, fn: () => Promise<unknown>, successMessage: string) => {
    try {
      await fn();
      toast({ title: successMessage });
      void queryClient.invalidateQueries({ queryKey: ["/api/request-money/requests"] });
    } catch (err) {
      toast({
        title: `${action} failed`,
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleResendRequestEmail = (req: MoneyRequestView): void => {
    void runRequestAction("Resend", () => resendEmail(req.id), "Email resent.");
  };

  const handleCopyRequestLink = (req: MoneyRequestView): void => {
    navigator.clipboard.writeText(req.checkoutUrl).then(
      () => toast({ title: "Link Copied!", description: "Payment link copied to clipboard — share it whenever you want." }),
      () => toast({ title: "Copy Failed", description: "Could not copy the link. Please try again.", variant: "destructive" })
    );
  };

  const handleRequestCancel = (req: MoneyRequestView): void => {
    setRequestDetails(null);
    setRequestToCancel(req);
  };

  const handleCancelRequestConfirm = async (req: MoneyRequestView): Promise<void> => {
    setRequestToCancel(null);
    await runRequestAction("Cancel", () => cancelRequest(req.id), "Money request cancelled successfully.");
  };

  // ── Invoice actions (ported from the removed /sent-invoices page) ──
  const handleInvoiceResend = async (invoice: InvoiceListItem): Promise<void> => {
    setResendingInvoiceId(invoice.id);
    try {
      await resendInvoiceNotificationRequest(invoice.id);
      toast({
        title: "Notification resent",
        description: `The invoice email was resent to ${invoice.clientEmail} using the same payment link.`,
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    } catch (err) {
      toast({
        title: "Resend failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setResendingInvoiceId(null);
    }
  };

  return (
    <DashboardLayout hideLegalStrip>
      <CancelTransactionModal
        open={cancelTarget !== null}
        transaction={cancelTarget}
        onConfirm={handleCancelConfirm}
        onCancel={handleCancelModalClose}
      />
      <MoneyRequestDetailsDialog
        request={requestDetails}
        open={requestDetails !== null}
        onOpenChange={(open) => { if (!open) setRequestDetails(null); }}
        onResendEmail={handleResendRequestEmail}
        onCopyPaymentLink={handleCopyRequestLink}
        onCancelRequest={handleRequestCancel}
      />
      <CancelMoneyRequestDialog
        request={requestToCancel}
        open={requestToCancel !== null}
        onOpenChange={(open) => { if (!open) setRequestToCancel(null); }}
        onConfirm={handleCancelRequestConfirm}
      />
      <CancelInvoiceDialog
        invoice={invoiceToCancel}
        open={invoiceToCancel !== null}
        onOpenChange={(open) => { if (!open) setInvoiceToCancel(null); }}
      />
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-5 md:space-y-6"
      >
        {/* Top Welcome, Bonus Credit Pills & Legal Strip Row */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 md:gap-4 flex-1 min-w-0">
            <motion.h1
              variants={itemVariants}
              className="shrink-0 text-2xl font-normal tracking-tight text-[#323130] md:text-[28px]"
            >
              <span data-testid="dashboard-welcome">Welcome{welcomeName(activeUser) ? <> <span className="font-bold">{welcomeName(activeUser)}</span></> : ""}</span>
            </motion.h1>

            {false && bonusBalance.available > 0 && (
              <motion.div variants={itemVariants} className="min-w-0">
                <BonusCreditPill
                  balance={bonusBalance}
                  unused={rewards.data?.wallet.unused}
                  referralFloor={rewards.data?.offer?.floor}
                  onCreateTransaction={(rewardType) => setLocation(rewardType ? `/send-money?reward=${rewardType}` : "/send-money")}
                />
              </motion.div>
            )}
          </div>

          <motion.div
            variants={itemVariants}
            className="shrink-0 self-end md:self-start md:pt-1.5 flex flex-wrap items-center justify-end gap-2.5"
          >
            <LegalStrip className="mb-0 w-auto" />
          </motion.div>
        </div>

        <OfferBanner
          latestOffer={rewards.data?.latestOffer ?? null}
          latestOffers={rewards.data?.latestOffers}
          onView={viewReferOffer}
        />

        {/* Account Summary Section — 3 Pastel Cards matching Rhemito Reference Palette */}
        <motion.div variants={itemVariants} data-testid="section-account-summary">
          <h2 className="text-xl font-bold text-[#323130] tracking-tight mb-3">
            Account summary
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Total Sent Card — live Account / Sent opens Settings → Accounts */}
            <div
              role="button"
              tabIndex={0}
              data-testid="card-total-sent"
              onClick={() => setLocation("/settings?tab=accounts")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setLocation("/settings?tab=accounts");
                }
              }}
              className="group rounded-xl bg-[#FFEDE7] px-5 py-4 flex flex-col justify-between min-h-[82px] cursor-pointer transition-shadow hover:shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2e5bff]"
            >
              <span className="text-xs font-normal text-[#605E5C] group-hover:underline">
                Total sent
              </span>
              <div className="flex items-center justify-between gap-2 mt-2">
                <span data-testid="summary-total-sent" className="text-xl font-bold text-[#605E5C] tracking-tight whitespace-nowrap tabular-nums">
                  {totalSentFormatted}
                </span>
                <div
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                <Select defaultValue="GBP">
                  <SelectTrigger className="h-7 w-[76px] rounded-full text-xs bg-white border border-[#d2d0ce] shadow-none font-medium text-[#323130] px-2.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
                </div>
              </div>
            </div>

            {/* Wallet Balance Card */}
            <div
              role="button"
              tabIndex={0}
              data-testid="card-wallet-balance"
              onClick={() => setLocation("/overview/collectionaccount?tab=wallet")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setLocation("/overview/collectionaccount?tab=wallet");
                }
              }}
              className={cn(
                "group rounded-xl bg-[#E5F1FE] border border-transparent px-5 py-4 flex flex-col justify-between min-h-[82px] cursor-pointer transition-[border-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2e5bff]",
                isWalletNonZero &&
                  "hover:border-[#5B9BF8] hover:shadow-[0_8px_20px_-6px_rgba(46,91,255,0.16),0_0_0_1px_rgba(91,155,248,0.22)] hover:-translate-y-[1px]",
              )}
            >
              <span className="text-xs font-normal text-[#605E5C] group-hover:underline">
                Wallet balance
              </span>
              <div className="flex items-center justify-between gap-2 mt-2">
                <span data-testid="summary-wallet-balance" className="text-xl font-bold text-[#605E5C] tracking-tight whitespace-nowrap tabular-nums">
                  {walletBalanceFormatted}
                </span>
                <div
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Select defaultValue="GBP">
                    <SelectTrigger className="h-7 w-[76px] rounded-full text-xs bg-white border border-[#d2d0ce] shadow-none font-medium text-[#323130] px-2.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GBP">GBP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Payment Account Card */}
            <div
              role="button"
              tabIndex={0}
              data-testid="card-collection-account"
              onClick={() => setLocation("/overview/collectionaccount")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setLocation("/overview/collectionaccount");
                }
              }}
              className={cn(
                "group rounded-xl bg-[#E0EED6] border border-transparent px-5 py-4 flex flex-col justify-between min-h-[82px] cursor-pointer transition-[border-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2e5bff]",
                isCollectionNonZero &&
                  "hover:border-[#58A96A] hover:shadow-[0_8px_20px_-6px_rgba(59,143,82,0.16),0_0_0_1px_rgba(88,169,106,0.22)] hover:-translate-y-[1px]",
              )}
            >
              <span className="text-xs font-normal text-[#605E5C] group-hover:underline">
                Payment account
              </span>
              <div className="flex items-center justify-between gap-2 mt-2">
                <span data-testid="summary-collection-account" className="text-xl font-bold text-[#605E5C] tracking-tight whitespace-nowrap tabular-nums">
                  {collectionBalanceFormatted}
                </span>
                <div
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Select defaultValue="GBP">
                    <SelectTrigger className="h-7 w-[76px] rounded-full text-xs bg-white border border-[#d2d0ce] shadow-none font-medium text-[#323130] px-2.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GBP">GBP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Quick Service Full-Width Row matching Figma 12498:26082 */}
        <motion.div variants={itemVariants}>
          <Card className="rounded-lg border border-[#efefee] bg-white shadow-none">
            <CardContent className="p-4">
              <h3 className="text-base font-semibold text-[#323130] mb-3.5">
                Quick service
                <span className="sr-only">Quick Services</span>
              </h3>
              <div className="flex flex-wrap items-center gap-3.5">
                <button
                  type="button"
                  onClick={() => setLocation("/send-money")}
                  data-testid="button-send-money"
                  className="h-10 min-w-[150px] px-6 rounded-full bg-[#2e5bff] hover:bg-blue-700 text-white text-sm sm:text-base font-semibold transition-all active:scale-95 cursor-pointer"
                >
                  Send money
                </button>
                <button
                  type="button"
                  onClick={() => setLocation("/request-payment")}
                  data-testid="button-request-payment"
                  className="h-10 min-w-[150px] px-6 rounded-full border border-[#2e5bff] bg-white hover:bg-blue-50 text-[#2e5bff] text-sm sm:text-base font-semibold transition-all active:scale-95 cursor-pointer"
                >
                  Receive money
                </button>
                <button
                  type="button"
                  onClick={() => setLocation("/bonus-discounts")}
                  data-testid="button-bonus-discounts"
                  className="h-10 min-w-[150px] px-6 rounded-full border border-[#2e5bff] bg-white hover:bg-blue-50 text-[#2e5bff] text-sm sm:text-base font-semibold transition-all active:scale-95 cursor-pointer"
                >
                  Reward$
                </button>
                <button
                  type="button"
                  onClick={() => setLocation("/send-invoice")}
                  data-testid="button-send-invoice"
                  className="h-10 min-w-[150px] px-6 rounded-full border border-[#2e5bff] bg-white hover:bg-blue-50 text-[#2e5bff] text-sm sm:text-base font-semibold transition-all active:scale-95 cursor-pointer"
                >
                  Send invoice
                </button>
                <button
                  type="button"
                  onClick={() => setLocation("/group-pay/create")}
                  data-testid="button-funding-campaigns"
                  className="h-10 min-w-[150px] px-6 rounded-full border border-[#2e5bff] bg-white hover:bg-blue-50 text-[#2e5bff] text-sm sm:text-base font-semibold transition-all active:scale-95 cursor-pointer"
                >
                  Fund campaigns
                </button>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Earned Bonus & Quick Redeem card (when available > 0) + Refer & Earn banner underneath Quick Service */}
        {(rewards.data?.wallet.bonus_blocked ||
          rewards.data?.offer ||
          rewards.isLoading ||
          rewards.isError ||
          displayBonusBalances.length > 0 ||
          showRefereeZeroBalanceStrip) && (
          <motion.div variants={itemVariants} className="flex flex-col gap-4">
            {rewards.data?.wallet.bonus_blocked && <BonusBlockedNotice />}
            <div className="grid grid-cols-1 gap-4 items-stretch">
              {showRefereeZeroBalanceStrip && (
                <div
                  data-testid="referee-linked-info-strip"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-2.5 text-xs sm:text-[13px] text-teal-900"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Sparkles className="h-4 w-4 text-teal-600 shrink-0" aria-hidden="true" />
                    <span>
                      Referral link connected —{" "}
                      {rewards.data?.offer?.floor && rewards.data.offer.floor > 0
                        ? `send ${formatMoney(rewards.data.offer.floor, rewards.data.offer.currency || rewardsCurrency)}+ to unlock your friend's reward, or check Reward$ for active offers.`
                        : "complete a qualifying transfer to unlock your friend's reward, or check Reward$ for active offers."}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-auto">
                    <button
                      type="button"
                      onClick={() => setLocation("/bonus-discounts")}
                      className="font-semibold text-[#2e5bff] hover:text-blue-700 hover:underline cursor-pointer"
                    >
                      Details in Reward$
                    </button>
                    <button
                      type="button"
                      onClick={() => setDismissedRefereeStrip(true)}
                      aria-label="Dismiss referral notice"
                      className="rounded-md p-1 text-teal-700 hover:bg-teal-100 cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}

              {activeBonusBalance && (() => {
                const activeCur = activeBonusBalance.currency;
                const activeAmountText = formatMoney(activeBonusBalance.available, activeCur);
                const activeUnused = (rewards.data?.wallet.unused ?? []).filter(
                  (c) => c.currency === activeCur && c.remaining > 0,
                );
                const bySource = activeBonusBalance.by_source ?? [];
                const referralGroup = bySource.find((s) => s.credit_source === "REFERRAL");
                const schemeGroups = bySource.filter(
                  (s) => s.credit_source === "SCHEME" || s.credit_source === "MANUAL",
                );
                const referralAvailable = referralGroup?.available ?? 0;
                const schemeAvailable = schemeGroups.reduce((sum, s) => sum + (s.available || 0), 0);
                const hasSourceSplit = referralAvailable + schemeAvailable > 0;

                const ruleOfferForCur =
                  rewards.data?.offers?.find((o) => o.currency === activeCur) ??
                  (rewards.data?.offer?.currency === activeCur || !rewards.data?.offer?.currency
                    ? rewards.data?.offer
                    : undefined);

                const resolvedReferralFloor =
                  referralGroup?.floor ||
                  ruleOfferForCur?.floor ||
                  activeUnused.find((c) => c.credit_source === "REFERRAL" && (c.floor ?? 0) > 0)?.floor ||
                  0;

                const resolvedSchemeFloor = Math.max(
                  0,
                  ...schemeGroups.map((s) => s.floor || 0),
                  ...activeUnused
                    .filter((c) => c.credit_source !== "REFERRAL")
                    .map((c) => c.floor || 0),
                );

                const displayFloor =
                  referralAvailable > 0 && schemeAvailable === 0
                    ? resolvedReferralFloor
                    : schemeAvailable > 0 && referralAvailable === 0
                      ? resolvedSchemeFloor
                      : Math.max(resolvedReferralFloor, resolvedSchemeFloor);

                const resolvedReceiveCurrency =
                  referralGroup?.receive_currency ||
                  activeUnused.find((c) => c.credit_source === "REFERRAL" && c.receive_currency)
                    ?.receive_currency ||
                  ruleOfferForCur?.receive_currency ||
                  null;

                const referralUnused = activeUnused.filter((c) => c.credit_source === "REFERRAL");
                const welcomeCredit = referralUnused.find(
                  (c) =>
                    c.reason_code === "REFEREE" ||
                    /^(Welcome bonus|Referee reward)/i.test(
                      String(c.credit_source_label ?? c.source_label ?? c.source ?? ""),
                    ),
                );
                const rawWelcomeLabel = String(
                  welcomeCredit?.credit_source_label ??
                    welcomeCredit?.source_label ??
                    welcomeCredit?.source ??
                    "",
                );
                const inviterMatch = rawWelcomeLabel.match(/invited by\s+([^()]+?)(?:\)|$)/i);
                const inviterName = inviterMatch?.[1]?.trim().replace(/\.+$/, "") || "";

                const soonestUrgent = expiringSoon(activeUnused)[0];
                const urgentDays = soonestUrgent
                  ? Math.max(0, daysUntil(soonestUrgent.expires_on) ?? 0)
                  : null;
                const soonestAny = [...activeUnused]
                  .filter((c) => Boolean(c.expires_on))
                  .sort((a, b) => String(a.expires_on).localeCompare(String(b.expires_on)))[0];

                const handleRedeemOnSendMoney = (preferredReward?: "referral" | "bonus") => {
                  const targetReward =
                    preferredReward ?? (referralAvailable > 0 ? "referral" : "bonus");
                  const params = new URLSearchParams();
                  params.set("reward", targetReward);
                  if (activeCur && activeCur !== "GBP") {
                    params.set("currency", activeCur);
                  }
                  if (targetReward === "referral" && resolvedReceiveCurrency) {
                    params.set("to", resolvedReceiveCurrency.toUpperCase());
                  }
                  setLocation(`/send-money?${params.toString()}`);
                };

                return (
                  <Card
                    data-testid="rewards-section-bonus-banners"
                    className="rounded-xl border border-[#87c2fc]/70 border-l-4 border-l-teal-500 bg-white p-4 shadow-2xs"
                  >
                    <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                      {/* Zone A — What you earned & eligibility guardrails */}
                      <div className="flex-1 min-w-0 xl:min-w-[340px] space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div
                            data-testid="dashboard-total-unused-bonus"
                            className="inline-flex items-center gap-2"
                          >
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-600 shrink-0">
                              <Gift className="h-4 w-4" aria-hidden="true" />
                            </span>
                            <span className="font-display text-xl sm:text-[22px] font-bold tracking-tight text-[#323130] leading-none">
                              {activeAmountText}
                            </span>
                            <span className="text-xs font-semibold text-teal-800">
                              available
                            </span>
                          </div>

                          {displayBonusBalances.length > 1 && (
                            <div
                              className="inline-flex items-center gap-1 rounded-full bg-slate-100 p-0.5"
                              role="group"
                              aria-label="Bonus currency"
                            >
                              {displayBonusBalances.map((bal) => {
                                const isActive = bal.currency === activeCur;
                                return (
                                  <button
                                    key={bal.currency}
                                    type="button"
                                    onClick={() => setSelectedBonusCurrency(bal.currency)}
                                    className={cn(
                                      "rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors cursor-pointer",
                                      isActive
                                        ? "bg-white text-[#323130] shadow-2xs"
                                        : "text-[#605e5c] hover:text-[#323130]",
                                    )}
                                  >
                                    {bal.currency} {formatMoney(bal.available, bal.currency)}
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {referralAvailable > 0 && (
                            <span
                              data-testid="referral-bonus-earned-pill"
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap max-w-full overflow-hidden text-ellipsis",
                                welcomeCredit
                                  ? "border-teal-200 bg-teal-50 text-teal-800"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-700",
                              )}
                            >
                              <span className="whitespace-nowrap shrink-0">{welcomeCredit ? "Welcome bonus" : "Referral bonus"}</span>
                              {schemeAvailable > 0 ? (
                                <span className="whitespace-nowrap shrink-0">· {formatMoney(referralAvailable, activeCur)}</span>
                              ) : (
                                <span className="sr-only">
                                  {" "}
                                  {formatMoney(referralAvailable, activeCur)}
                                </span>
                              )}
                              {welcomeCredit && inviterName && (
                                <span className="font-medium text-teal-700 truncate">
                                  · Invited by {inviterName}
                                </span>
                              )}
                              {resolvedReferralFloor > 0 && (
                                <span className="sr-only">
                                  {" "}
                                  Minimum transfer {formatMoney(resolvedReferralFloor, activeCur)}
                                </span>
                              )}
                            </span>
                          )}

                          {(schemeAvailable > 0 || !hasSourceSplit) && (
                            <span
                              data-testid="bonus-earned-pill"
                              className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-800 whitespace-nowrap"
                            >
                              <span>Bonus offer</span>
                              <span className="sr-only"> Bonus credit</span>
                              {hasSourceSplit && referralAvailable > 0 ? (
                                <span>· {formatMoney(schemeAvailable, activeCur)}</span>
                              ) : (
                                <span className="sr-only">
                                  {" "}
                                  {formatMoney(
                                    hasSourceSplit ? schemeAvailable : activeBonusBalance.available,
                                    activeCur,
                                  )}
                                </span>
                              )}
                            </span>
                          )}
                        </div>

                        {/* Inline Guardrail Pills */}
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] sm:text-xs">
                          <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-medium text-[#323130] whitespace-nowrap">
                            {displayFloor > 0
                              ? `Min. transfer ${formatMoney(displayFloor, activeCur)}`
                              : "No min. transfer"}
                          </span>
                          <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-medium text-[#323130] whitespace-nowrap">
                            {activeCur} →{" "}
                            {resolvedReceiveCurrency
                              ? resolvedReceiveCurrency.toUpperCase()
                              : "All corridors"}
                          </span>
                          {soonestUrgent && urgentDays !== null ? (
                            <span
                              data-testid="bonus-pill-expiring"
                              className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 whitespace-nowrap"
                            >
                              {urgentDays === 0
                                ? BONUS_COPY.pillExpiringToday(
                                    formatMoney(soonestUrgent.remaining, soonestUrgent.currency),
                                  )
                                : BONUS_COPY.pillExpiring(
                                    formatMoney(soonestUrgent.remaining, soonestUrgent.currency),
                                    urgentDays,
                                  )}
                            </span>
                          ) : soonestAny?.expires_on ? (
                            <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-medium text-[#605e5c] whitespace-nowrap">
                              Expires {formatUkDate(soonestAny.expires_on)}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {/* Zone B — 1-click CTAs */}
                      <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-1.5 shrink-0">
                        {!rewards.data?.wallet.bonus_blocked && (
                          <Button
                            type="button"
                            data-testid="dashboard-redeem-send-money-cta"
                            onClick={() => handleRedeemOnSendMoney()}
                            className="h-9 rounded-full bg-[#2e5bff] hover:bg-blue-700 px-4 text-xs sm:text-[13px] font-semibold text-white shadow-none cursor-pointer"
                          >
                            <span>Redeem on send money</span>
                            <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        )}
                        <button
                          type="button"
                          onClick={() => setLocation("/bonus-discounts")}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#2e5bff] hover:text-blue-700 hover:underline cursor-pointer"
                        >
                          <span>Details in Reward$</span>
                        </button>
                      </div>
                    </div>
                  </Card>
                );
              })()}

              <ReferEarnCard
                offer={rewards.data?.offer ?? null}
                offers={rewards.data?.offers}
                sendCurrencies={rewards.data?.sendCurrencies}
                referrals={rewards.data?.referrals.data ?? []}
                summary={rewards.data?.referrals.summary}
                isLoading={rewards.isLoading}
                isError={rewards.isError}
                onRetry={() => rewards.refetch()}
                highlighted={referHighlighted}
                defaultCollapsed={false}
                userId={!isAuthLoading ? (activeUser?.id ?? rewards.data?.customer?.id ?? "demo") : undefined}
              />
            </div>
          </motion.div>
        )}

        {/* Recent Transactions Card matching reference screenshot */}
        <motion.div
          variants={itemVariants}
          ref={transactionsSectionRef}
          data-testid="section-transactions"
        >
          <Card className="@container rounded-2xl border border-[#efefee] bg-white shadow-[-2px_4px_16px_0px_rgba(0,0,0,0.04)] overflow-hidden">
            <CardContent className="p-0">
              <div>
                <div className="flex items-center justify-between gap-3 px-5 md:px-6 pt-5 pb-3">
                  <div className="flex items-center gap-2.5">
                    <h2 className="font-display font-bold text-base md:text-lg text-[#605e5c] tracking-tight">
                      Recent transactions
                    </h2>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setLocation("/transactions")}
                      className="text-xs font-bold text-slate-500 hover:text-blue-600 shrink-0 transition-colors cursor-pointer"
                    >
                      See all
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 px-4 sm:px-6 py-2.5 border-b border-slate-100 overflow-x-auto no-scrollbar scroll-smooth">
                  {TYPE_FILTERS.map((filter) => (
                    <button
                      key={filter.value}
                      type="button"
                      onClick={() => {
                        setTypeFilter(filter.value);
                        setPage(1);
                      }}
                      data-testid={`chip-type-${filter.value.replace(/_/g, "-")}`}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all active:scale-95 shrink-0 whitespace-nowrap",
                        typeFilter === filter.value
                          ? "bg-blue-600 text-white border-blue-600 shadow-2xs"
                          : "bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600"
                      )}
                    >
                      {filter.label}
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-px text-[10px] font-semibold",
                          typeFilter === filter.value
                            ? "bg-white/20 text-white"
                            : "bg-slate-100 text-slate-500"
                        )}
                      >
                        {typeCounts[filter.value]}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="overflow-x-auto" data-testid="table-transactions">
                  {isMobile ? (
                    <div className="p-3 space-y-2">
                      {visibleRows.length === 0 && !anyQueryLoading ? (
                        <div
                          className="py-12 text-center text-sm text-slate-400"
                          data-testid="empty-transactions"
                        >
                          <div className="flex flex-col items-center justify-center gap-2">
                            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-1">
                              <Search className="w-5 h-5" />
                            </div>
                            <span className="font-medium text-slate-600">
                              No transactions match your search or filters.
                            </span>
                            {(search || typeFilter !== "all") && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 text-xs mt-1 rounded-lg"
                                onClick={() => {
                                  setSearch("");
                                  setTypeFilter("all");
                                  setPage(1);
                                }}
                              >
                                Reset filters
                              </Button>
                            )}
                          </div>
                        </div>
                      ) : (
                        pageRows.map((row) =>
                          row.kind === "send_money" ? (
                            <MobileSendMoneyCard
                              key={row.tx.id}
                              tx={row.tx}
                              scheduled={row.scheduled}
                              onCancel={handleCancelClick}
                            />
                          ) : (
                            <MobileUnifiedCard
                              key={row.row.key}
                              row={row.row}
                              onView={setLocation}
                              onRequestDetails={setRequestDetails}
                              onRequestResend={handleResendRequestEmail}
                              onRequestCopyLink={handleCopyRequestLink}
                              onRequestCancel={handleRequestCancel}
                              onInvoiceResend={handleInvoiceResend}
                              onInvoiceCancel={setInvoiceToCancel}
                              resendingInvoiceId={resendingInvoiceId}
                            />
                          )
                        )
                      )}
                      {anyQueryLoading && (
                        <div className="py-2 space-y-2">
                          <Skeleton className="h-20 w-full rounded-2xl" />
                          <Skeleton className="h-20 w-full rounded-2xl" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent border-b border-slate-100">
                          <TableHead className="text-xs font-bold text-[#323130] whitespace-nowrap py-3.5 pl-4 sm:pl-6">
                            Order no
                          </TableHead>
                          <TableHead className="text-xs font-bold text-[#323130] hidden sm:table-cell py-3.5">
                            Date
                          </TableHead>
                          <TableHead className="text-xs font-bold text-[#323130] py-3.5">
                            Name
                          </TableHead>
                          <TableHead className="text-xs font-bold text-[#323130] hidden md:table-cell py-3.5">
                            Service
                          </TableHead>
                          <TableHead className="text-xs font-bold text-[#323130] py-3.5 hidden sm:table-cell">
                            Amount
                          </TableHead>
                          <TableHead className="text-xs font-bold text-[#323130] text-center py-3.5">
                            Status
                          </TableHead>
                          <TableHead className="text-xs font-bold text-[#323130] text-center py-3.5 px-8 sm:px-10">
                            Actions
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleRows.length === 0 && !anyQueryLoading ? (
                          <TableRow>
                            <TableCell
                              colSpan={7}
                              className="py-14 text-center text-sm text-slate-400"
                              data-testid="empty-transactions"
                            >
                              <div className="flex flex-col items-center justify-center gap-2">
                                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-1">
                                  <Search className="w-5 h-5" />
                                </div>
                                <span className="font-medium text-slate-600">
                                  No transactions match your search or filters.
                                </span>
                                {(search || typeFilter !== "all") && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 text-xs mt-1 rounded-lg"
                                    onClick={() => {
                                      setSearch("");
                                      setTypeFilter("all");
                                      setPage(1);
                                    }}
                                  >
                                    Reset filters
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : (
                          pageRows.map((row) =>
                            row.kind === "send_money" ? (
                              <SendMoneyRow
                                key={row.tx.id}
                                tx={row.tx}
                                dateSort={row.dateSort}
                                scheduled={row.scheduled}
                                onCancel={handleCancelClick}
                              />
                            ) : (
                              <UnifiedRow
                                key={row.row.key}
                                row={row.row}
                                onView={setLocation}
                                onRequestDetails={setRequestDetails}
                                onRequestResend={handleResendRequestEmail}
                                onRequestCopyLink={handleCopyRequestLink}
                                onRequestCancel={handleRequestCancel}
                                onInvoiceResend={handleInvoiceResend}
                                onInvoiceCancel={setInvoiceToCancel}
                                resendingInvoiceId={resendingInvoiceId}
                              />
                            )
                          )
                        )}
                        {anyQueryLoading && (
                          <TableRow>
                            <TableCell colSpan={7} className="py-4">
                              <Skeleton className="h-9 w-full rounded-lg" />
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  )}
                </div>

                {visibleRows.length > 0 && (
                  <div
                    className="flex flex-col sm:flex-row items-center justify-between gap-2 px-5 md:px-6 py-3.5 border-t border-slate-100 bg-slate-50/30"
                    data-testid="transactions-pagination"
                  >
                    <p className="text-xs text-slate-500 font-medium">
                      Showing{" "}
                      {Math.min(
                        visibleRows.length,
                        (safePage - 1) * TRANSACTIONS_PAGE_SIZE + 1
                      )}
                      –
                      {Math.min(
                        safePage * TRANSACTIONS_PAGE_SIZE,
                        visibleRows.length
                      )}{" "}
                      of {visibleRows.length} transactions • Page {safePage} of{" "}
                      {totalPages}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={safePage <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="h-8 px-3 text-xs rounded-full border-slate-200 hover:bg-white active:scale-95"
                        data-testid="button-prev-page"
                      >
                        <ChevronLeft className="w-4 h-4 mr-1" />
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={safePage >= totalPages}
                        onClick={() =>
                          setPage((p) => Math.min(totalPages, p + 1))
                        }
                        className="h-8 px-3 text-xs rounded-full border-slate-200 hover:bg-white active:scale-95"
                        data-testid="button-next-page"
                      >
                        Next
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Regulatory Footer Note matching reference screenshot */}
        <footer className="pt-2 pb-4 text-[11px] leading-relaxed text-slate-400">
          Mito.money is a trademark owned by Funtech Global Communications Ltd.
          Devonshire House, Manor way, Borehamwood, Herts. WD6 1QQ, United
          Kingdom. A registered Payment institution in the UK with registration
          details FRN: 815146 MLR NO: 12803115
        </footer>
      </motion.div>
    </DashboardLayout>
  );
}

