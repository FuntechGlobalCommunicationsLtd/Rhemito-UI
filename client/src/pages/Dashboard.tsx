import { useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Send, Receipt, ArrowRight, Gift, Copy, Check, Sparkles, Search, 
  ArrowUpRight, ArrowDownLeft, ChevronLeft, ChevronRight, Mail, 
  XCircle, FilePlus2, FileText, Users, CreditCard, Wallet, 
  Building2, X 
} from "lucide-react";
import { CancelTransactionModal, type TransactionDetails } from "@/components/CancelTransactionModal";
import { CancelMoneyRequestDialog } from "@/components/transactions/CancelMoneyRequestDialog";
import { MoneyRequestDetailsDialog } from "@/components/transactions/MoneyRequestDetailsDialog";
import { CancelInvoiceDialog } from "@/components/invoices/CancelInvoiceDialog";
import { cancelRequest, getRequests, resendEmail, type MoneyRequestView } from "@/lib/requests";
import { invoiceListUrl, resendInvoiceNotificationRequest, type InvoiceListItem, type InvoiceListResponse } from "@/lib/invoices";
import { fetchCampaigns } from "@/lib/groupPay";
import { cancelSendMoneyTransaction, getSendMoneyTransactions, toSendMoneyRow } from "@/lib/sendMoney";
import {
  TYPE_BADGES,
  fromCampaign,
  fromInvoice,
  fromMoneyRequest,
  invoiceActionable,
  moneyRequestAwaiting,
  moneyRequestLinkShareable,
  type TransactionType,
  type UnifiedTransactionRow,
} from "@/lib/unifiedTransactions";
import { useToast } from "@/hooks/use-toast";
import { useRewards } from "@/hooks/use-rewards";
import { balanceFor, formatMoney } from "@/features/bonus";
import { ReferEarnCard } from "@/components/rewards/ReferEarnCard";
import { BonusBlockedNotice, BonusCreditPill } from "@/features/bonus";
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
  { id: 1, name: "Oluwas...", initials: "OA", color: "bg-blue-500" },
  { id: 2, name: "Profilea", initials: "PL", color: "bg-purple-500" },
  { id: 3, name: "Testing...", initials: "T", color: "bg-gray-400" },
  { id: 4, name: "Steve", initials: "SS", color: "bg-teal" },
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
  { value: "send_money", label: "Send Money" },
  { value: "receive_money", label: "Receive Money" },
  { value: "invoice", label: "Invoices" },
  { value: "campaign", label: "Campaigns" },
];

/** One entry per row of the unified transactions table, sorted by dateSort. */
type MergedRow =
  | { kind: "send_money"; scheduled: boolean; dateSort: number; tx: SendMoneyTx }
  | { kind: "receive_money" | "invoice" | "campaign"; dateSort: number; row: UnifiedTransactionRow };

function SendMoneyRow({ tx, scheduled, onCancel }: { tx: SendMoneyTx; scheduled: boolean; onCancel: (tx: SendMoneyTx) => void }) {
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
          <span className="tracking-tight">{tx.id}</span>
        </div>
        <div className="text-xs font-bold text-gray-900 mt-0.5 sm:hidden pl-7">{tx.amount}</div>
      </TableCell>
      <TableCell className="text-slate-500 text-[13px] hidden sm:table-cell py-4">
        <span>{tx.date}</span>
      </TableCell>
      <TableCell className="text-[13px] font-medium text-slate-700 py-4">
        <div>{tx.recipient}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-medium text-slate-400">
          <span className={cn("w-1.5 h-1.5 rounded-full", TYPE_BADGES.send_money.dot)} />
          {TYPE_BADGES.send_money.label}
        </div>
      </TableCell>
      <TableCell className="text-slate-500 text-[13px] hidden md:table-cell py-4">
        <span>{tx.service}</span>
      </TableCell>
      <TableCell className="text-slate-600 text-[13px] font-normal py-4 hidden sm:table-cell">
        <span>{tx.amount}</span>
      </TableCell>
      <TableCell className="text-center py-4">
        {scheduled ? (
          <div className="flex items-center justify-center gap-2">
            <span title="Scheduled" className="status-light inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 shadow-2xs">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
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
                  className="status-light inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200 shadow-2xs"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  Cancelled
                </motion.span>
              ) : tx.status === "completed" ? (
                <motion.span title="Completed"
                  key="completed"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="status-light inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Completed
                </motion.span>
              ) : tx.status === "awaiting_payment" ? (
                <motion.span title="Awaiting Payment"
                  key="awaiting_payment"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="status-light inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 shadow-2xs"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Awaiting Payment
                </motion.span>
              ) : (
                <motion.span title="Pending"
                  key="pending"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="status-light inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 shadow-2xs"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Pending
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        )}
      </TableCell>
      <TableCell className="text-center py-4 pr-4 sm:pr-6">
        {scheduled ? (
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-5 text-xs font-medium rounded-full border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-all active:scale-95"
            data-testid={`button-cancel-${tx.id}`}
          >
            Cancel
          </Button>
        ) : (
          (() => {
            if (!isTerminal && !canCancel) {
              return <span className="text-gray-300 text-sm">—</span>;
            }
            return (
              <div className="flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2">
                {isTerminal && (
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-white h-8 w-full sm:w-auto px-6 text-xs font-medium rounded-full shadow-2xs transition-all active:scale-95"
                    data-testid={`button-resend-${tx.id}`}
                  >
                    Resend
                  </Button>
                )}
                <AnimatePresence>
                  {canCancel && (
                    <motion.div
                      key={`cancel-btn-${tx.id}`}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.15 }}
                      className="w-full sm:w-auto"
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        className={cn(
                          "h-8 w-full sm:w-auto px-5 text-xs font-medium rounded-full",
                          "text-red-500 border border-red-200 bg-white",
                          "hover:bg-red-50 hover:border-red-300 hover:text-red-600",
                          "active:bg-red-100 active:border-red-400",
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
              </div>
            );
          })()
        )}
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
  const badge = TYPE_BADGES[row.type];
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
          <span className="tracking-tight">{row.ref}</span>
        </div>
        <div className="text-xs font-bold text-gray-900 mt-0.5 sm:hidden pl-7">{row.amountLabel}</div>
      </TableCell>
      <TableCell className="text-slate-500 text-[13px] hidden sm:table-cell py-4">
        <span>{row.dateLabel}</span>
      </TableCell>
      <TableCell className="text-[13px] font-medium text-slate-700 py-4">
        <div>{row.name}</div>
        {row.email ? <div className="text-xs text-slate-400 mt-0.5">{row.email}</div> : null}
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-medium text-slate-400">
          <span className={cn("w-1.5 h-1.5 rounded-full", badge.dot)} />
          {badge.label}
        </div>
      </TableCell>
      <TableCell className="text-slate-500 text-[13px] hidden md:table-cell py-4">
        <span>{row.service}</span>
      </TableCell>
      <TableCell className="text-slate-600 text-[13px] font-normal py-4 hidden sm:table-cell">
        <span>{row.amountLabel}</span>
        {row.subNote ? <div className="text-xs font-normal text-slate-400 mt-0.5">{row.subNote}</div> : null}
      </TableCell>
      <TableCell className="text-center py-4">
        <div className="flex items-center justify-center gap-2">
          <span title={row.statusLabel} className={cn("status-light inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border shadow-2xs", row.statusClass)}>
            <span className={cn("w-1.5 h-1.5 rounded-full", row.dotClass)} />
            {row.statusLabel}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-center py-4 pr-4 sm:pr-6">
        <div className="flex items-center justify-center gap-1.5 flex-wrap">
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white h-8 w-full sm:w-auto px-6 text-xs font-medium rounded-full shadow-2xs transition-all active:scale-95"
            data-testid={`button-view-${row.ref}`}
            onClick={() => (req ? onRequestDetails(req) : onView(row.viewHref))}
          >
            View
          </Button>
          {req && moneyRequestAwaiting(req.status) &&
            iconAction("Resend email", `button-resend-${row.ref}`, false, false, () => onRequestResend(req), <Mail className="w-4 h-4" />)}
          {req && moneyRequestLinkShareable(req.status) &&
            iconAction("Copy payment link", `button-copy-link-${row.ref}`, false, false, () => onRequestCopyLink(req), <Copy className="w-4 h-4" />)}
          {req && moneyRequestAwaiting(req.status) &&
            iconAction("Cancel request", `button-cancel-${row.ref}`, true, false, () => onRequestCancel(req), <XCircle className="w-4 h-4" />)}
          {invoice && invoiceActionable(invoice.status) &&
            iconAction("Resend Notification", `button-resend-${row.ref}`, false, resendingInvoiceId === invoice.id, () => onInvoiceResend(invoice), <Mail className="w-4 h-4" />)}
          {invoice && invoiceActionable(invoice.status) &&
            iconAction("Cancel Invoice", `button-cancel-${row.ref}`, true, false, () => onInvoiceCancel(invoice), <XCircle className="w-4 h-4" />)}
          {invoice?.status === "expired" && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs font-medium rounded-full border-gray-200 hover:border-blue-300 hover:text-blue-600 active:scale-95"
              data-testid={`button-create-new-${row.ref}`}
              onClick={() => onView("/send-invoice")}
            >
              <FilePlus2 className="w-3.5 h-3.5 mr-1.5" />
              Create New Invoice
            </Button>
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
            <span title="Scheduled" className="status-light inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              Scheduled
            </span>
          ) : tx.status === "cancelled" ? (
            <span title="Cancelled" className="status-light inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-700 border border-red-200">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              Cancelled
            </span>
          ) : tx.status === "completed" ? (
            <span title="Completed" className="status-light inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Completed
            </span>
          ) : tx.status === "awaiting_payment" ? (
            <span title="Awaiting Payment" className="status-light inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Awaiting Payment
            </span>
          ) : (
            <span title="Pending" className="status-light inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
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
  const { isLoading: isAuthLoading } = useAuth();
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
      ...(sendMoneyQuery.data ?? []).map(toSendMoneyRow).map((tx) => ({ kind: "send_money" as const, scheduled: false, dateSort: Date.parse(tx.date) || 0, tx })),
      ...(isDemoUser
        ? scheduledTransactions.map((tx) => ({ kind: "send_money" as const, scheduled: true, dateSort: Date.parse(tx.date) || 0, tx }))
        : []),
    ];
    const moneyInRows: MergedRow[] = [
      ...(requestsQuery.data ?? []).map(fromMoneyRequest),
      ...(invoicesQuery.data ?? []).map(fromInvoice),
      ...(campaignsQuery.data ?? []).map(fromCampaign),
    ].map((row) => ({ kind: row.type, dateSort: row.dateSort, row }));
    return [...sendRows, ...moneyInRows].sort((a, b) => b.dateSort - a.dateSort);
  }, [sendMoneyQuery.data, requestsQuery.data, invoicesQuery.data, campaignsQuery.data, isDemoUser]);

  const totalSentFormatted = useMemo(() => {
    if (isDemoUser) return "750,895.75";
    const totalSentMajor = (sendMoneyQuery.data ?? [])
      .filter((tx) => tx.status === "completed")
      .reduce((sum, tx) => sum + Number(tx.sendAmount || 0), 0);
    return totalSentMajor.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }, [isDemoUser, sendMoneyQuery.data]);
  const walletBalanceFormatted = isDemoUser ? "253,007.92" : "0.00";
  const collectionBalanceFormatted = isDemoUser ? "4,357,384.08" : "0.00";

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
              className="shrink-0 text-xl font-normal tracking-tight text-slate-800 md:text-[22px]"
            >
              <span data-testid="dashboard-welcome">Welcome{welcomeName(user) ? ` ${welcomeName(user)}` : ""}</span>
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

        {/* Account Summary Section — 3 Pastel Cards matching reference screenshot */}
        <motion.div variants={itemVariants} data-testid="section-account-summary">
          <h2 className="text-lg md:text-xl font-bold text-slate-800 tracking-tight mb-3">
            Account Summary
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Total Sent Card */}
            <div className="rounded-2xl bg-[#E8F0FE] px-5 py-5 flex flex-col justify-between min-h-[104px]">
              <span className="text-xs font-medium text-slate-500">
                Total Sent
              </span>
              <div className="flex items-center justify-between gap-2 mt-2">
                <span data-testid="summary-total-sent" className="text-lg md:text-xl font-bold text-slate-700 tracking-tight whitespace-nowrap tabular-nums">
                  {totalSentFormatted}
                </span>
                <Select defaultValue="GBP">
                  <SelectTrigger className="h-8 w-[84px] rounded-full text-xs bg-white border-0 shadow-2xs font-medium text-slate-600 px-3">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Wallet Balance Card */}
            <div className="rounded-2xl bg-[#DFEEFB] px-5 py-5 flex flex-col justify-between min-h-[104px]">
              <span className="text-xs font-medium text-slate-500">
                Wallet Balance
              </span>
              <div className="flex items-center justify-between gap-2 mt-2">
                <span data-testid="summary-wallet-balance" className="text-lg md:text-xl font-bold text-slate-700 tracking-tight whitespace-nowrap tabular-nums">
                  {walletBalanceFormatted}
                </span>
                <Select defaultValue="GBP">
                  <SelectTrigger className="h-8 w-[84px] rounded-full text-xs bg-white border-0 shadow-2xs font-medium text-slate-600 px-3">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Collection / Payment Account Card */}
            <div className="rounded-2xl bg-[#DFEFE0] px-5 py-5 flex flex-col justify-between min-h-[104px]">
              <span className="text-xs font-medium text-slate-500">
                Collection Account
              </span>
              <div className="flex items-center justify-between gap-2 mt-2">
                <span data-testid="summary-collection-account" className="text-lg md:text-xl font-bold text-slate-700 tracking-tight whitespace-nowrap tabular-nums">
                  {collectionBalanceFormatted}
                </span>
                <Select defaultValue="GBP">
                  <SelectTrigger className="h-8 w-[84px] rounded-full text-xs bg-white border-0 shadow-2xs font-medium text-slate-600 px-3">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Quick Services Horizontal Pill Bar matching reference screenshot */}
        <motion.div variants={itemVariants}>
          <Card className="rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
            <CardContent className="px-5 py-4">
              <h3 className="text-sm font-bold text-slate-700 mb-3">
                Quick Services
              </h3>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setLocation("/send-money")}
                  data-testid="button-send-money"
                  className="h-9 px-7 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-2xs transition-all active:scale-95 cursor-pointer"
                >
                  Send Money
                </button>
                <button
                  type="button"
                  onClick={() => setLocation("/request-payment")}
                  data-testid="button-request-payment"
                  className="h-9 px-7 rounded-full border border-blue-500 bg-white hover:bg-blue-50 text-blue-600 text-xs font-semibold transition-all active:scale-95 cursor-pointer"
                >
                  Receive Money
                </button>
                <button
                  type="button"
                  onClick={() => setLocation("/bonus-discounts")}
                  data-testid="button-bonus-discounts"
                  className="h-9 px-7 rounded-full border border-blue-400 bg-blue-50/80 hover:bg-blue-100/80 text-blue-600 text-xs font-semibold transition-all active:scale-95 cursor-pointer"
                >
                  Reward$
                </button>
                <button
                  type="button"
                  onClick={() => setLocation("/send-invoice")}
                  data-testid="button-send-invoice"
                  className="h-9 px-7 rounded-full border border-blue-500 bg-white hover:bg-blue-50 text-blue-600 text-xs font-semibold transition-all active:scale-95 cursor-pointer"
                >
                  Send Invoice
                </button>
                <button
                  type="button"
                  onClick={() => setLocation("/group-pay/create")}
                  data-testid="button-funding-campaigns"
                  className="h-9 px-7 rounded-full border border-blue-500 bg-white hover:bg-blue-50 text-blue-600 text-xs font-semibold transition-all active:scale-95 cursor-pointer"
                >
                  Funding Campaigns
                </button>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Your bonus credits + Refer & Earn side-by-side cards underneath Quick Services */}
        {(rewards.data?.wallet.bonus_blocked ||
          rewards.data?.offer ||
          rewards.isLoading ||
          rewards.isError ||
          displayBonusBalances.length > 0) && (
          <motion.div variants={itemVariants} className="flex flex-col gap-4">
            {rewards.data?.wallet.bonus_blocked && <BonusBlockedNotice />}
            <div
              className={cn(
                "grid grid-cols-1 gap-4 items-stretch",
                displayBonusBalances.length > 0 &&
                  Boolean(rewards.data?.offer || rewards.isLoading || rewards.isError) &&
                  "lg:grid-cols-2",
              )}
            >
              {displayBonusBalances.length > 0 && (
                <Card
                  data-testid="rewards-section-bonus-banners"
                  className="h-full rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs flex flex-col justify-between gap-4"
                >
                  <div className="flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900 leading-tight">
                          Your bonus credits
                        </h2>
                        <p className="text-sm text-slate-500 mt-0.5">Earned and ready to use.</p>
                      </div>
                      <div
                        data-testid="dashboard-total-unused-bonus"
                        className="flex items-center gap-3 rounded-2xl bg-[#F3EEFF] px-4 py-2.5 shrink-0"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          aria-hidden="true"
                          className="h-5 w-5 text-purple-600 shrink-0"
                        >
                          <ellipse cx="10" cy="7" rx="6" ry="2.5" stroke="currentColor" strokeWidth="1.8" />
                          <path
                            d="M4 7v4c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V7"
                            stroke="currentColor"
                            strokeWidth="1.8"
                          />
                          <path
                            d="M4 11v4c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5v-4"
                            stroke="currentColor"
                            strokeWidth="1.8"
                          />
                          <path
                            d="M16 10.2c2.3.4 4 1.28 4 2.3v4c0 1.38-2.69 2.5-6 2.5-1.9 0-3.6-.37-4.7-.95"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                          />
                        </svg>
                        <div>
                          <p className="font-display text-lg sm:text-xl font-bold text-slate-900 leading-tight">
                            {totalUnusedText}
                          </p>
                          <p className="text-xs font-medium text-slate-500">Available credit</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2.5">
                      {displayBonusBalances.map((bal) => {
                        const floorForCur =
                          rewards.data?.offers?.find((o) => o.currency === bal.currency)?.floor ??
                          (rewards.data?.offer?.currency === bal.currency || !rewards.data?.offer?.currency
                            ? rewards.data?.offer?.floor
                            : undefined);
                        return (
                          <BonusCreditPill
                            key={`bonus-pill-${bal.currency}`}
                            balance={bal}
                            unused={rewards.data?.wallet.unused}
                            referralFloor={floorForCur}
                            onCreateTransaction={(rewardType) => {
                              const params = new URLSearchParams();
                              if (rewardType) params.set("reward", rewardType);
                              if (bal.currency && bal.currency !== "GBP") params.set("currency", bal.currency);
                              const qs = params.toString();
                              setLocation(qs ? `/send-money?${qs}` : "/send-money");
                            }}
                          />
                        );
                      })}
                    </div>

                    {/* Fintech Redemption Modes Split Box — Pay less vs. Send more */}
                    <div className="flex flex-col gap-1.5" data-testid="dashboard-bonus-redemption-modes">
                      <p className="text-xs sm:text-[13px] font-semibold text-slate-600">
                        Two ways to redeem your {totalUnusedText} credit on Step 1 of Send Money:
                      </p>
                      <div className="rounded-2xl bg-[#EEF4FF] border border-blue-100/80 p-3.5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-0 sm:divide-x sm:divide-slate-200/90">
                          <button
                            type="button"
                            onClick={() => setLocation("/send-money")}
                            className="text-left sm:pr-3.5 group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-blue-700">
                                <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
                                Pay less
                              </span>
                              <span className="rounded-full bg-white/90 border border-blue-200/80 px-2 py-0.5 text-[11px] font-bold text-blue-700 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                Save {totalUnusedText}
                              </span>
                            </div>
                            <p className="mt-1.5 text-xs sm:text-[13px] leading-relaxed text-slate-600">
                              Deduct <strong className="font-semibold text-slate-900">{totalUnusedText}</strong> straight off the total amount you pay at checkout.
                            </p>
                          </button>

                          <button
                            type="button"
                            onClick={() => setLocation("/send-money")}
                            className="text-left sm:pl-3.5 pt-2.5 sm:pt-0 border-t sm:border-t-0 border-slate-200/80 group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-teal-800">
                                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                                Send more
                              </span>
                              <span className="rounded-full bg-white/90 border border-teal-200/80 px-2 py-0.5 text-[11px] font-bold text-teal-700 group-hover:bg-teal-700 group-hover:text-white transition-colors">
                                +{totalUnusedText} extra
                              </span>
                            </div>
                            <p className="mt-1.5 text-xs sm:text-[13px] leading-relaxed text-slate-600">
                              Add <strong className="font-semibold text-slate-900">{totalUnusedText}</strong> on top so your recipient receives extra at no cost to you.
                            </p>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2.5 pt-1" data-testid="dashboard-bonus-footer">
                    <div className="grid grid-cols-2 gap-2.5" data-testid="dashboard-bonus-stats">
                      <div className="rounded-xl bg-slate-50 px-3.5 py-2.5">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Total bonus earned
                        </p>
                        <p
                          className="mt-0.5 font-display text-xl font-bold leading-none text-slate-900"
                          data-testid="dashboard-bonus-total-earned"
                        >
                          {totalBonusEarnedText}
                        </p>
                      </div>
                      <div className="rounded-xl bg-teal-50 px-3.5 py-2.5">
                        <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">
                          Saved with rewards
                        </p>
                        <p
                          className="mt-0.5 font-display text-xl font-bold leading-none text-teal-700"
                          data-testid="dashboard-bonus-total-saved"
                        >
                          {totalRewardsSavedText}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-slate-500">
                        Select your preferred option on Step 1 when sending money
                      </p>
                      <button
                        type="button"
                        onClick={() => setLocation("/bonus-discounts")}
                        className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
                      >
                        <span>Manage in Reward$</span>
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </Card>
              )}

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
          <Card className="rounded-2xl border border-slate-200/80 bg-white shadow-2xs overflow-hidden">
            <CardContent className="p-0">
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 md:px-6 pt-5 pb-3">
                  <div className="flex items-center gap-2.5">
                    <h2 className="font-display font-bold text-base md:text-lg text-slate-800 tracking-tight">
                      Recent Transactions
                    </h2>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="relative w-full sm:w-72">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                      <Input
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setPage(1);
                        }}
                        placeholder="Search by ref, name, email or service…"
                        className="pl-9 pr-8 h-8 text-xs rounded-full bg-slate-50/70 border-slate-200 shadow-none focus-visible:ring-blue-500"
                        data-testid="input-search-transactions"
                      />
                      {search && (
                        <button
                          type="button"
                          onClick={() => {
                            setSearch("");
                            setPage(1);
                          }}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded-md"
                          aria-label="Clear search"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setLocation("/transactions")}
                      className="text-xs font-semibold text-slate-500 hover:text-blue-600 shrink-0 transition-colors cursor-pointer"
                    >
                      See All
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
                          <TableHead className="text-xs font-bold text-slate-600 py-3.5 pl-4 sm:pl-6">
                            Order No
                          </TableHead>
                          <TableHead className="text-xs font-bold text-slate-600 hidden sm:table-cell py-3.5">
                            Date / Time GMT
                          </TableHead>
                          <TableHead className="text-xs font-bold text-slate-600 py-3.5">
                            Name
                          </TableHead>
                          <TableHead className="text-xs font-bold text-slate-600 hidden md:table-cell py-3.5">
                            Service Type
                          </TableHead>
                          <TableHead className="text-xs font-bold text-slate-600 py-3.5 hidden sm:table-cell">
                            Amount
                          </TableHead>
                          <TableHead className="text-xs font-bold text-slate-600 text-center py-3.5">
                            Status
                          </TableHead>
                          <TableHead className="text-xs font-bold text-slate-600 text-center py-3.5 pr-4 sm:pr-6">
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

