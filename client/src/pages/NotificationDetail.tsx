import { useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  ArrowLeftRight,
  Eye,
  Upload,
  FileCheck,
  Wrench,
  Settings,
  Banknote,
  Wallet,
  BellOff,
  Gift,
  Sparkles,
  Users,
  LifeBuoy,
} from "lucide-react";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Notification, NotificationType } from "@/contexts/NotificationContext";

// ─── Icon + colour mapping (kept local to avoid coupling with NotificationItem) ─

interface TypeConfig {
  icon: React.ElementType;
  containerClass: string;
  iconClass: string;
  label: string;
}

const TYPE_CONFIG: Record<NotificationType, TypeConfig> = {
  payment_received: { icon: CheckCircle2, containerClass: "bg-teal/10", iconClass: "text-teal", label: "Payment Received" },
  awaiting_payment: { icon: Clock, containerClass: "bg-amber/10", iconClass: "text-amber", label: "Awaiting Payment" },
  payment_failed: { icon: AlertTriangle, containerClass: "bg-destructive/10", iconClass: "text-destructive", label: "Payment Failed" },
  transaction_complete: { icon: CheckCircle2, containerClass: "bg-teal/10", iconClass: "text-teal", label: "Transfer Complete" },
  transaction_failed: { icon: AlertTriangle, containerClass: "bg-destructive/10", iconClass: "text-destructive", label: "Transfer Failed" },
  transaction_cancelled_customer: { icon: XCircle, containerClass: "bg-destructive/10", iconClass: "text-destructive", label: "Transfer Cancelled" },
  transaction_cancelled_admin: { icon: XCircle, containerClass: "bg-destructive/10", iconClass: "text-destructive", label: "Transfer Cancelled by Rhemito" },
  transaction_cancelled_timeout: { icon: XCircle, containerClass: "bg-destructive/10", iconClass: "text-destructive", label: "Transfer Cancelled — Timeout" },
  auto_cancel_reminder_15: { icon: Clock, containerClass: "bg-amber/10", iconClass: "text-amber", label: "Reminder — 15 Minutes Left" },
  auto_cancel_reminder_5: { icon: Clock, containerClass: "bg-destructive/10", iconClass: "text-destructive", label: "Urgent — 5 Minutes Left" },
  refund_processed: { icon: ArrowLeftRight, containerClass: "bg-teal/10", iconClass: "text-teal", label: "Refund Processed" },
  under_review: { icon: Eye, containerClass: "bg-purple/10", iconClass: "text-purple", label: "Under Review" },
  review_complete: { icon: CheckCircle2, containerClass: "bg-teal/10", iconClass: "text-teal", label: "Review Complete" },
  document_required: { icon: Upload, containerClass: "bg-destructive/10", iconClass: "text-destructive", label: "Document Required" },
  document_received: { icon: FileCheck, containerClass: "bg-teal/10", iconClass: "text-teal", label: "Document Received" },
  maintenance_scheduled: { icon: Wrench, containerClass: "bg-purple/10", iconClass: "text-purple", label: "Scheduled Maintenance" },
  maintenance_complete: { icon: CheckCircle2, containerClass: "bg-teal/10", iconClass: "text-teal", label: "Maintenance Complete" },
  preferences_updated: { icon: Settings, containerClass: "bg-primary/10", iconClass: "text-primary", label: "Preferences Updated" },
  // Funding Stories 16–18
  funding_received_matched: { icon: Banknote, containerClass: "bg-teal/10", iconClass: "text-teal", label: "Funds Received" },
  funding_received_unmatched: { icon: Wallet, containerClass: "bg-amber/10", iconClass: "text-amber", label: "Funds Awaiting Allocation" },
  funding_allocated_single: { icon: Banknote, containerClass: "bg-teal/10", iconClass: "text-teal", label: "Funds Allocated" },
  funding_allocated_multi: { icon: Banknote, containerClass: "bg-teal/10", iconClass: "text-teal", label: "Funds Allocated" },
  funding_allocated_partial: { icon: AlertTriangle, containerClass: "bg-amber/10", iconClass: "text-amber", label: "Partial Allocation — Payment Required" },
  // Send Invoice MVP1
  invoice_paid: { icon: CheckCircle2, containerClass: "bg-teal/10", iconClass: "text-teal", label: "Invoice Paid" },
  invoice_cancelled: { icon: XCircle, containerClass: "bg-destructive/10", iconClass: "text-destructive", label: "Invoice Cancelled" },
  invoice_expired: { icon: Clock, containerClass: "bg-amber/10", iconClass: "text-amber", label: "Invoice Expired" },
  invoice_new_link_requested: { icon: FileCheck, containerClass: "bg-primary/10", iconClass: "text-primary", label: "New Payment Link Requested" },
  // Receive Money Link (Money Request)
  money_request_paid: { icon: CheckCircle2, containerClass: "bg-teal/10", iconClass: "text-teal", label: "Money Request Paid" },
  money_request_cancelled: { icon: XCircle, containerClass: "bg-destructive/10", iconClass: "text-destructive", label: "Money Request Cancelled" },
  money_request_expired: { icon: Clock, containerClass: "bg-amber/10", iconClass: "text-amber", label: "Money Request Expired" },
  money_request_new_link_requested: { icon: FileCheck, containerClass: "bg-primary/10", iconClass: "text-primary", label: "New Payment Link Requested" },
  // Funding Campaigns (GroupPay)
  campaign_contribution_received: { icon: Banknote, containerClass: "bg-teal/10", iconClass: "text-teal", label: "Campaign Contribution Received" },
  campaign_target_reached: { icon: CheckCircle2, containerClass: "bg-teal/10", iconClass: "text-teal", label: "Campaign Target Reached" },
  campaign_status_changed: { icon: Settings, containerClass: "bg-primary/10", iconClass: "text-primary", label: "Campaign Status Updated" },
  reward_offer: { icon: Sparkles, containerClass: "bg-primary/10", iconClass: "text-primary", label: "New Offer" },
  reward_friend_joined: { icon: Users, containerClass: "bg-primary/10", iconClass: "text-primary", label: "Friend Joined" },
  reward_earned: { icon: Gift, containerClass: "bg-teal/10", iconClass: "text-teal", label: "Bonus Earned" },
  reward_bonus_used: { icon: Gift, containerClass: "bg-slate-100", iconClass: "text-slate-600", label: "Bonus Used" },
  reward_bonus_expiring: { icon: Clock, containerClass: "bg-amber/10", iconClass: "text-amber", label: "Bonus Expiring" },
  reward_bonus_expired: { icon: Clock, containerClass: "bg-slate-100", iconClass: "text-slate-600", label: "Bonus Expired" },
  reward_bonus_reversed: { icon: XCircle, containerClass: "bg-destructive/10", iconClass: "text-destructive", label: "Bonus Removed" },
  bonus_earned: { icon: Gift, containerClass: "bg-teal/10", iconClass: "text-teal", label: "Bonus Earned" },
  bonus_used: { icon: Gift, containerClass: "bg-slate-100", iconClass: "text-slate-600", label: "Bonus Used" },
  bonus_returned: { icon: Gift, containerClass: "bg-teal/10", iconClass: "text-teal", label: "Bonus Returned" },
  bonus_expiring: { icon: Clock, containerClass: "bg-amber/10", iconClass: "text-amber", label: "Bonus Expiring" },
  bonus_expired: { icon: Clock, containerClass: "bg-slate-100", iconClass: "text-slate-600", label: "Bonus Expired" },
  bonus_reversed: { icon: XCircle, containerClass: "bg-destructive/10", iconClass: "text-destructive", label: "Bonus Removed" },
  bonus_unblocked: { icon: Gift, containerClass: "bg-teal/10", iconClass: "text-teal", label: "Bonus Available" },
  support_ticket_reply: {
    icon: LifeBuoy,
    containerClass: "bg-blue-500/10",
    iconClass: "text-[#2e5bff]",
    label: "Support ticket reply",
  },
  support_ticket_resolved: {
    icon: LifeBuoy,
    containerClass: "bg-emerald-500/10",
    iconClass: "text-emerald-600",
    label: "Support ticket resolved",
  },
};

// ─── Format timestamp — full (not relative) ──────────────────────────────────

function formatFullTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface DetailResponse {
  data: Notification;
}

export default function NotificationDetail(): React.JSX.Element {
  const [, params] = useRoute<{ id: string }>("/notifications/:id");
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const id = params?.id ?? "";

  const { data, isLoading, isError } = useQuery<DetailResponse>({
    queryKey: [`/api/notifications/${id}`],
    queryFn: getQueryFn<DetailResponse>({ on401: "throw" }),
    enabled: Boolean(id),
  });

  const notification = data?.data;

  // Auto-mark-as-read on open
  useEffect(() => {
    if (!notification || notification.isRead) return;
    void apiRequest("PATCH", `/api/notifications/${notification.id}/read`, {})
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["/api/notifications"] });
        void qc.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
        void qc.invalidateQueries({ queryKey: ["/api/support/unread-count"] });
        void qc.invalidateQueries({ queryKey: [`/api/notifications/${notification.id}`] });
      })
      .catch(() => { /* swallow — UI doesn't need to block on read receipt */ });
  }, [notification, qc]);

  const handleBack = (): void => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigate("/");
    }
  };

  const handleDismiss = async (): Promise<void> => {
    if (!notification) return;
    const deletedId = notification.id;
    // Navigate away FIRST (synchronously) so this component unmounts before
    // react-query refetches the now-deleted notification and flips into its
    // 404 "Notification not found" error state. window.history.back() is async
    // and loses the race; routing to a concrete destination is predictable.
    navigate("/");
    try {
      await apiRequest("DELETE", `/api/notifications/${deletedId}`);
    } catch {
      // ignore — UI has already navigated away
    } finally {
      void qc.invalidateQueries({ queryKey: ["/api/notifications"] });
      void qc.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      void qc.invalidateQueries({ queryKey: ["/api/support/unread-count"] });
      // Drop the deleted detail from the cache so a later back-nav doesn't
      // briefly re-render the stale (now-deleted) notification.
      void qc.removeQueries({ queryKey: [`/api/notifications/${deletedId}`] });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-card border-b border-border px-4 md:px-6 h-14 flex items-center gap-3">
        <button
          onClick={handleBack}
          className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted transition-colors"
          aria-label="Go back"
        >
          <ChevronLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <h1 className="font-display text-[16px] font-semibold text-foreground">
          Notification
        </h1>
      </div>

      {/* Body */}
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-6 md:py-10">
        {isLoading && (
          <div className="flex items-center justify-center py-24">
            <div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center gap-3 py-24">
            <BellOff className="w-12 h-12 text-muted-foreground/25" />
            <div className="text-center">
              <p className="text-sm font-semibold text-foreground">Notification not found</p>
              <p className="text-[13px] text-muted-foreground mt-1">
                It may have expired or been archived.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleBack} className="mt-2">
              Go Back
            </Button>
          </div>
        )}

        {notification && (
          <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
            {/* Type strip */}
            <div className="flex items-start gap-4 px-5 md:px-6 pt-6 pb-4 border-b border-border">
              <div
                className={cn(
                  "flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center",
                  TYPE_CONFIG[notification.type]?.containerClass ?? "bg-primary/10"
                )}
              >
                {(() => {
                  const Icon = TYPE_CONFIG[notification.type]?.icon ?? Settings;
                  return (
                    <Icon
                      className={cn(
                        "w-5 h-5",
                        TYPE_CONFIG[notification.type]?.iconClass ?? "text-primary"
                      )}
                    />
                  );
                })()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                  {TYPE_CONFIG[notification.type]?.label ?? "Notification"}
                </p>
                <h2 className="font-display text-[20px] md:text-[22px] font-semibold text-foreground mt-1 leading-tight">
                  {notification.title}
                </h2>
                <p className="text-[12px] text-muted-foreground/70 mt-2">
                  {formatFullTimestamp(notification.createdAt)}
                </p>
              </div>
            </div>

            {/* Body */}
            <div className="px-5 md:px-6 py-6">
              <p className="text-[15px] text-foreground leading-[24px] whitespace-pre-wrap">
                {notification.body}
              </p>
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-between gap-2 px-5 md:px-6 py-4 border-t border-border bg-muted/30">
              <div>
                {notification.type.startsWith("money_request_") && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate("/transactions?type=receive_money")}
                    data-testid="button-view-receive-money"
                  >
                    View in Transactions
                  </Button>
                )}
                {notification.type.startsWith("invoice_") && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate("/invoices")}
                    data-testid="button-view-invoices"
                  >
                    View Invoices
                  </Button>
                )}
                {notification.type.startsWith("campaign_") && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate("/group-pay")}
                    data-testid="button-view-campaigns"
                  >
                    View Campaigns
                  </Button>
                )}
                {(notification.type === "support_ticket_reply" ||
                  notification.type === "support_ticket_resolved") && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const meta = (notification.metadata ?? notification.data) as
                        | Record<string, unknown>
                        | undefined;
                      const ref = String(
                        meta?.referenceNumber || meta?.ticketNo || notification.txnId || ""
                      )
                        .replace(/^#/, "")
                        .trim();
                      navigate(
                        ref
                          ? `/my-tickets/request-details/${encodeURIComponent(ref)}`
                          : "/support/my-tickets"
                      );
                    }}
                    data-testid="button-view-support-ticket"
                  >
                    View ticket
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDismiss}
                  className="text-muted-foreground hover:text-destructive"
                >
                  Dismiss
                </Button>
                <Button variant="default" size="sm" onClick={handleBack}>
                  Back
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
