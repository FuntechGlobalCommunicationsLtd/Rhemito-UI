import React, {
  createContext,
  useContext,
  useCallback,
  type ReactNode,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationType =
  | "payment_received"
  | "awaiting_payment"
  | "payment_failed"
  | "transaction_complete"
  | "transaction_failed"
  | "transaction_cancelled_customer"
  | "transaction_cancelled_admin"
  | "transaction_cancelled_timeout"
  | "auto_cancel_reminder_15"
  | "auto_cancel_reminder_5"
  | "refund_processed"
  | "under_review"
  | "review_complete"
  | "document_required"
  | "document_received"
  | "maintenance_scheduled"
  | "maintenance_complete"
  | "preferences_updated"
  // Funding stories 16–18
  | "funding_received_matched"
  | "funding_received_unmatched"
  | "funding_allocated_single"
  | "funding_allocated_multi"
  | "funding_allocated_partial"
  // Send Invoice MVP1
  | "invoice_paid"
  | "invoice_cancelled"
  | "invoice_expired"
  | "invoice_new_link_requested"
  // Receive Money Link (Money Request)
  | "money_request_paid"
  | "money_request_cancelled"
  | "money_request_expired"
  | "money_request_new_link_requested"
  // Funding Campaigns (GroupPay)
  | "campaign_contribution_received"
  | "campaign_target_reached"
  | "campaign_status_changed"
  // Referral & Bonus (Refer & Earn)
  | "reward_offer"
  | "reward_friend_joined"
  | "reward_earned"
  | "reward_bonus_used"
  | "reward_bonus_expiring"
  | "reward_bonus_expired"
  | "reward_bonus_reversed"
  | "bonus_earned"
  | "bonus_used"
  | "bonus_returned"
  | "bonus_expiring"
  | "bonus_expired"
  | "bonus_reversed"
  | "bonus_unblocked"
  // Support tickets
  | "support_ticket_reply"
  | "support_ticket_resolved";

export type NotificationEventType = NotificationType;

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  txnId?: string;
}

export interface NotificationsResponse {
  // API returns { data: [...], meta: { page, pageSize, unreadCount } }
  data: Notification[];
  meta: { page: number; pageSize: number; unreadCount: number };
}

export interface UnreadCountResponse {
  count: number;
}

export interface NotificationPreferences {
  channels: {
    inApp: boolean;
    browserPush: boolean;
    email: boolean;
    mobilePush: boolean;
  };
  eventTypes: {
    payment: boolean;
    transactionStatus: boolean;
    refund: boolean;
    kyc: boolean;
    security: boolean;
    system: boolean;
    marketing: boolean;
  };
  quietHours: {
    enabled: boolean;
    from: string;
    to: string;
    timezone: string;
  };
}

// ─── Context Shape ────────────────────────────────────────────────────────────

interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  preferences: NotificationPreferences | null;
  isLoading: boolean;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  refetch: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const NotificationContext = createContext<NotificationContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

interface NotificationContextProviderProps {
  children: ReactNode;
}

export function NotificationContextProvider({
  children,
}: NotificationContextProviderProps): React.JSX.Element {
  const qc = useQueryClient();

  const { data: notifData, isLoading, refetch: refetchNotifs } = useQuery<NotificationsResponse>({
    queryKey: ["/api/notifications"],
    queryFn: getQueryFn<NotificationsResponse>({ on401: "returnNull" }),
    refetchInterval: 30_000,
    staleTime: 30_000,
  });

  const { data: countData, refetch: refetchCount } = useQuery<UnreadCountResponse>({
    queryKey: ["/api/notifications/unread-count"],
    queryFn: getQueryFn<UnreadCountResponse>({ on401: "returnNull" }),
    refetchInterval: 30_000,
    staleTime: 30_000,
  });

  const { data: preferencesData } = useQuery<NotificationPreferences>({
    queryKey: ["/api/notifications/preferences"],
    queryFn: getQueryFn<NotificationPreferences>({ on401: "returnNull" }),
    staleTime: 30_000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/notifications"] });
      qc.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      qc.invalidateQueries({ queryKey: ["/api/support/unread-count"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/notifications/read-all");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/notifications"] });
      qc.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      qc.invalidateQueries({ queryKey: ["/api/support/unread-count"] });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/notifications/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/notifications"] });
      qc.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      qc.invalidateQueries({ queryKey: ["/api/support/unread-count"] });
    },
  });

  const markRead = useCallback(
    (id: string) => markReadMutation.mutate(id),
    [markReadMutation]
  );

  const markAllRead = useCallback(
    () => markAllReadMutation.mutate(),
    [markAllReadMutation]
  );

  const dismiss = useCallback(
    (id: string) => dismissMutation.mutate(id),
    [dismissMutation]
  );

  const refetch = useCallback(() => {
    void refetchNotifs();
    void refetchCount();
  }, [refetchNotifs, refetchCount]);

  const value: NotificationContextValue = {
    notifications: notifData?.data ?? [],
    unreadCount: countData?.count ?? 0,
    preferences: preferencesData ?? null,
    isLoading,
    markRead,
    markAllRead,
    dismiss,
    refetch,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error(
      "useNotifications must be used inside NotificationContextProvider"
    );
  }
  return ctx;
}
