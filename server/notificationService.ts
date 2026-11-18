/**
 * Notification Service — Rhemito
 *
 * Prototype implementation using in-memory storage, matching the rest of the
 * server-side architecture. All channel dispatchers beyond in_app are stubs
 * that console.log — ready to be replaced with real providers (SendGrid,
 * Firebase FCM, Web Push API) without changing the public interface.
 */

import { randomUUID } from "crypto";
import { storage } from "./storage";
import { devEmailProvider } from "./providers";
import type {
  Notification,
  NotificationPreferences,
  NotificationDeliveryLog,
  NotificationEventType,
  NotificationChannel,
} from "@shared/schema";

// ─── In-memory stores ─────────────────────────────────────────────────────────

const notificationsStore = new Map<string, Notification>();
const preferencesStore = new Map<string, NotificationPreferences>();
const deliveryLogStore = new Map<string, NotificationDeliveryLog>();

// ─── Active reminder timers (keyed by txnId) ─────────────────────────────────

const activeTimers = new Map<string, NodeJS.Timeout[]>();

// ─── Critical types — cannot be suppressed by preferences or quiet hours ──────

export const CRITICAL_TYPES: NotificationEventType[] = [
  "payment_failed",
  "transaction_cancelled_admin",
  "document_required",
  "under_review",
];

// ─── Event → category mapping (for preference gating) ────────────────────────

type EventCategory =
  | "paymentEvents"
  | "transactionEvents"
  | "refundEvents"
  | "kycEvents"
  | "securityEvents"
  | "maintenanceEvents"
  | "marketingEvents";

const EVENT_CATEGORY_MAP: Record<NotificationEventType, EventCategory> = {
  payment_received: "paymentEvents",
  awaiting_payment: "paymentEvents",
  payment_failed: "paymentEvents",
  transaction_complete: "transactionEvents",
  transaction_failed: "transactionEvents",
  transaction_cancelled_customer: "transactionEvents",
  transaction_cancelled_admin: "transactionEvents",
  transaction_cancelled_timeout: "transactionEvents",
  auto_cancel_reminder_15: "transactionEvents",
  auto_cancel_reminder_5: "transactionEvents",
  refund_processed: "refundEvents",
  under_review: "kycEvents",
  review_complete: "kycEvents",
  document_required: "kycEvents",
  document_received: "kycEvents",
  maintenance_scheduled: "maintenanceEvents",
  maintenance_complete: "maintenanceEvents",
  preferences_updated: "securityEvents",
  // Funding events — treated as payment events so they respect the same category toggle
  funding_received_matched: "paymentEvents",
  funding_received_unmatched: "paymentEvents",
  funding_allocated_single: "paymentEvents",
  funding_allocated_multi: "paymentEvents",
  funding_allocated_partial: "paymentEvents",
  // Send Invoice MVP1 — invoice lifecycle events for the sender
  invoice_paid: "paymentEvents",
  invoice_cancelled: "paymentEvents",
  invoice_expired: "paymentEvents",
  invoice_new_link_requested: "paymentEvents",
  // Receive Money Link (Money Request) events
  money_request_paid: "paymentEvents",
  money_request_cancelled: "paymentEvents",
  money_request_expired: "paymentEvents",
  money_request_new_link_requested: "paymentEvents",
  // Funding Campaigns (GroupPay) events
  campaign_contribution_received: "paymentEvents",
  campaign_target_reached: "paymentEvents",
  campaign_status_changed: "paymentEvents",
  // Referral & Bonus — account activity, on by default. The offer itself is
  // promotional: always shown in the bell, other channels only with marketing on.
  reward_offer: "marketingEvents",
  reward_friend_joined: "transactionEvents",
  reward_earned: "transactionEvents",
  reward_bonus_used: "transactionEvents",
  reward_bonus_expiring: "transactionEvents",
  reward_bonus_expired: "transactionEvents",
  reward_bonus_reversed: "transactionEvents",
  bonus_earned: "transactionEvents",
  bonus_used: "transactionEvents",
  bonus_returned: "transactionEvents",
  bonus_expiring: "transactionEvents",
  bonus_expired: "transactionEvents",
  bonus_reversed: "transactionEvents",
  bonus_unblocked: "transactionEvents",
  // Support tickets — replies/resolutions from Rhemito Support
  support_ticket_reply: "transactionEvents",
  support_ticket_resolved: "transactionEvents",
};

/** Promotional types that still appear in the bell when marketing is off (AC-6.1.6). */
// Support replies/resolutions also always reach the bell and the Support sidebar badge.
const IN_APP_EVEN_IF_CATEGORY_OFF: NotificationEventType[] = [
  "reward_offer",
  "support_ticket_reply",
  "support_ticket_resolved",
];

// ─── Refund ETA by method (AC 11.2) ─────────────────────────────────────────

function refundEtaForMethod(method: unknown): string {
  const m = String(method ?? "").toLowerCase();
  if (m.includes("card")) return "3–5 business days";
  if (m.includes("wallet") || m.includes("e-wallet") || m.includes("e_wallet")) return "within 24 hours";
  if (m.includes("bank")) return "1–2 business days";
  return "3–5 business days";
}

// ─── Notification copy templates ──────────────────────────────────────────────

interface NotificationContent {
  title: string;
  body: string;
}

export function buildNotificationContent(
  type: NotificationEventType,
  data: Record<string, unknown>
): NotificationContent {
  const txnId = String(data.txnId ?? "");
  const recipient = String(data.recipientName ?? data.recipient ?? "Recipient");
  const amount = String(data.amount ?? "");
  const currency = String(data.currency ?? "GBP");
  const reason = String(data.reason ?? "");
  const minutesLeft = String(data.minutesLeft ?? "");
  const windowStart = String(data.windowStart ?? "");
  const windowEnd = String(data.windowEnd ?? "");
  // Funding-story fields
  const amountReceived = String(data.amountReceived ?? amount);
  const amountAllocated = String(data.amountAllocated ?? amount);
  const unallocatedBalance = String(data.unallocatedBalance ?? "");
  const senderBank = String(data.senderBank ?? "");
  const txnCount = String(data.txnCount ?? "");
  const totalAllocated = String(data.totalAllocated ?? "");
  const shortfallAmount = String(data.shortfallAmount ?? "");
  // Refund-method fields
  const refundAmount = String(data.refundAmount ?? amount);
  const refundMethod = String(data.refundMethod ?? "original payment method");
  const refundEta = String(data.refundEta ?? refundEtaForMethod(data.refundMethod));
  // Send Invoice MVP1 fields
  const invoiceNumber = String(data.invoiceNumber ?? "");
  const clientName = String(data.clientName ?? "the client");
  const clientEmail = String(data.clientEmail ?? "");
  const expiredDate = String(data.expiredDate ?? "");
  const originalExpiryDate = String(data.originalExpiryDate ?? "");
  const requestDate = String(data.requestDate ?? "");
  // Receive Money Link (Money Request) fields
  const requestNumber = String(data.requestNumber ?? "");
  const senderName = String(data.senderName ?? data.payerName ?? "Sender");
  const payerName = String(data.payerName ?? data.senderName ?? "Payer");
  // Funding Campaign (GroupPay) fields
  const campaignName = String(data.campaignName ?? "Campaign");
  const contributorName = String(data.contributorName ?? "A contributor");
  const contributorCount = String(data.contributorCount ?? "");
  const targetAmount = String(data.targetAmount ?? "");
  const campaignStatus = String(data.status ?? "");
  // Support ticket fields
  const supportRef = String(data.referenceNumber ?? data.txnId ?? "");
  const supportSubject = String(data.subject ?? "");

  const templates: Record<NotificationEventType, NotificationContent> = {
    payment_received: {
      title: "Payment Received",
      body: `We've received your payment of ${amount} ${currency} for transaction ${txnId} to ${recipient}. Your transfer is now being processed.`,
    },
    awaiting_payment: {
      title: "Awaiting Your Payment",
      body: `Your transaction ${txnId} to ${recipient} is waiting for payment of ${amount} ${currency}. Please complete your bank transfer to avoid cancellation.`,
    },
    payment_failed: {
      title: "Payment Failed",
      body: `Your payment of ${amount} ${currency} for transaction ${txnId} could not be processed. Please try again or use a different payment method.`,
    },
    transaction_complete: {
      title: "Transfer Complete",
      body: `Great news! Your transfer of ${amount} ${currency} to ${recipient} (${txnId}) has been completed successfully.`,
    },
    transaction_failed: {
      title: "Transfer Failed",
      body: `Unfortunately your transfer of ${amount} ${currency} to ${recipient} (${txnId}) could not be completed.${reason ? ` Reason: ${reason}.` : ""} Please contact support if you need help.`,
    },
    transaction_cancelled_customer: {
      title: "Transfer Cancelled",
      body: `Your transfer ${txnId} to ${recipient} has been cancelled as requested. A refund will be processed within 3–5 business days.`,
    },
    transaction_cancelled_admin: {
      title: "Transfer Cancelled by Rhemito",
      body: `Your transfer ${txnId} to ${recipient} has been cancelled by our operations team.${reason ? ` Reason: ${reason}.` : ""} Please contact support for more information.`,
    },
    transaction_cancelled_timeout: {
      title: "Transfer Cancelled — Payment Not Received",
      body: `Your transfer ${txnId} to ${recipient} has been automatically cancelled because we did not receive your payment within the required window. Please create a new transfer to try again.`,
    },
    auto_cancel_reminder_15: {
      title: "Action Required — 15 Minutes Left",
      body: `Your transfer ${txnId} to ${recipient} will be automatically cancelled in 15 minutes if payment is not received. Please complete your bank transfer now.`,
    },
    auto_cancel_reminder_5: {
      title: "Urgent — 5 Minutes Left",
      body: `Your transfer ${txnId} to ${recipient} will be cancelled in just 5 minutes. Complete your payment immediately to avoid cancellation.`,
    },
    refund_processed: {
      title: "Refund Processed",
      // AC 11.2 — method-specific ETA
      body: `Your refund of ${refundAmount} ${currency} for transaction ${txnId} has been sent to your ${refundMethod}. Please allow ${refundEta} for it to appear in your account.`,
    },
    under_review: {
      title: "Transfer Under Review",
      body: `Your transfer ${txnId} is currently under review by our compliance team. We may contact you for additional information. No action is needed at this time.`,
    },
    review_complete: {
      title: "Review Complete",
      body: `The review for your transfer ${txnId} is complete. Your transfer is now being processed.`,
    },
    document_required: {
      title: "Document Required",
      body: `We need additional documents to process your transfer ${txnId}. Please log in and upload the requested documents to avoid delays.`,
    },
    document_received: {
      title: "Documents Received",
      body: `We have received your documents for transfer ${txnId}. Our team will review them shortly and update you on the status.`,
    },
    maintenance_scheduled: {
      title: "Scheduled Maintenance",
      body: `Rhemito will undergo scheduled maintenance${windowStart ? ` from ${windowStart}` : ""}${windowEnd ? ` to ${windowEnd}` : ""}. Some services may be temporarily unavailable during this period.`,
    },
    maintenance_complete: {
      title: "Maintenance Complete",
      body: "Rhemito services have been fully restored. Thank you for your patience.",
    },
    preferences_updated: {
      title: "Notification Preferences Updated",
      body: "Your notification preferences have been successfully updated.",
    },
    // ─── Story 16 — Funding matched to an existing transaction ───────────
    funding_received_matched: {
      title: "Funds Received — Transaction Now Processing",
      body: `Great news! We have received your payment of ${amountReceived} ${currency} for transaction ${txnId} to ${recipient}${senderBank ? ` from ${senderBank}` : ""}. Your transfer is now being processed.`,
    },
    // ─── Story 17 — Funding received with no matching transaction ────────
    funding_received_unmatched: {
      title: "Funds Received — Awaiting Allocation",
      body: `We have received ${amountReceived} ${currency}${senderBank ? ` from ${senderBank}` : ""} into your Rhemito funding balance. These funds will be automatically allocated to your transactions as soon as you create them.${unallocatedBalance ? ` Current unallocated balance: ${unallocatedBalance} ${currency}.` : ""}`,
    },
    // ─── Story 18a — Funding allocated to a single transaction ───────────
    funding_allocated_single: {
      title: "Funds Allocated",
      body: `We have allocated ${amountAllocated} ${currency} from your Rhemito balance to transaction ${txnId} to ${recipient}. Your transfer is now being processed.${unallocatedBalance ? ` Remaining balance: ${unallocatedBalance} ${currency}.` : ""}`,
    },
    // ─── Story 18b — Funding allocated across multiple transactions ──────
    funding_allocated_multi: {
      title: `Funds Allocated to ${txnCount} Transactions`,
      body: `We have allocated a total of ${totalAllocated} ${currency} from your Rhemito balance across ${txnCount} transactions. All affected transfers are now being processed.${unallocatedBalance ? ` Remaining balance: ${unallocatedBalance} ${currency}.` : ""}`,
    },
    // ─── Story 18c — Partial allocation, additional payment required ─────
    funding_allocated_partial: {
      title: "Partial Allocation — Payment Required",
      body: `We have applied ${amountAllocated} ${currency} from your Rhemito balance to transaction ${txnId}, but an additional ${shortfallAmount} ${currency} is still required. Please complete payment to proceed with your transfer to ${recipient}.`,
    },
    // ─── Send Invoice MVP1 — invoice lifecycle events for the sender ──────
    invoice_paid: {
      title: "Invoice Paid",
      body: `Payment of ${amount} ${currency} for invoice ${invoiceNumber} from ${clientName} has been completed successfully.`,
    },
    invoice_cancelled: {
      title: "Invoice Cancelled",
      body: `Invoice ${invoiceNumber} sent to ${clientName} for ${amount} ${currency} has been cancelled.`,
    },
    invoice_expired: {
      title: "Invoice Expired",
      body: `Invoice ${invoiceNumber} sent to ${clientName} expired without payment on ${expiredDate}.`,
    },
    invoice_new_link_requested: {
      title: "New Payment Link Requested",
      body: `${clientName} has requested a new payment link for expired invoice ${invoiceNumber}. To accept the request, create and send a new invoice.${clientEmail ? ` Client email: ${clientEmail}.` : ""}${originalExpiryDate ? ` Original expiry date: ${originalExpiryDate}.` : ""}${requestDate ? ` Requested on ${requestDate}.` : ""}`,
    },
    // ─── Receive Money Link (Money Request) events ────────────────────────
    money_request_paid: {
      title: "Money Request Paid",
      body: `Great news! ${payerName} has paid ${amount} ${currency} for money request ${requestNumber}. Your payout is now being processed.`,
    },
    money_request_cancelled: {
      title: "Money Request Cancelled",
      body: `Money request ${requestNumber} to ${senderName} for ${amount} ${currency} has been cancelled.`,
    },
    money_request_expired: {
      title: "Money Request Expired",
      body: `Money request ${requestNumber} to ${senderName} expired on ${expiredDate}.`,
    },
    money_request_new_link_requested: {
      title: "New Payment Link Requested",
      body: `${payerName} has requested a new payment link for expired money request ${requestNumber}.`,
    },
    // ─── Funding Campaigns (GroupPay) events ──────────────────────────────
    campaign_contribution_received: {
      title: "New Campaign Contribution",
      body: `${contributorName} contributed ${amount} ${currency} to your campaign '${campaignName}'.`,
    },
    campaign_target_reached: {
      title: "Campaign Goal Reached! 🎉",
      body: `Congratulations! Your campaign '${campaignName}' reached its target of ${targetAmount} ${currency}${contributorCount ? ` with ${contributorCount} contributors` : ""}.`,
    },
    campaign_status_changed: {
      title: "Campaign Status Updated",
      body: `Your campaign '${campaignName}' status is now ${campaignStatus}.`,
    },
    // ─── Referral & Bonus ─────────────────────────────────────────────────
    reward_offer: {
      title: String(data.title ?? "New offer: Refer & Earn"),
      body: String(data.message ?? "Invite friends to Rhemito and earn bonus credit."),
    },
    reward_friend_joined: {
      title: "A friend joined with your link",
      body: data.reward
        ? `${String(data.friendName ?? "Your friend")} joined Rhemito with your link. You'll earn ${String(data.reward)} when they send ${String(data.floor ?? "")} or more.`
        : `${String(data.friendName ?? "Your friend")} joined Rhemito with your link.`,
    },
    reward_earned: {
      title: `You've earned ${amount} bonus credit`,
      body: `${String(data.message ?? "")} ${amount} bonus credit is ready to use on your next transfer${data.expires ? ` by ${String(data.expires)}` : ""}.`.trim(),
    },
    reward_bonus_used: {
      title: "Bonus used",
      body: `${amount} bonus credit was used on transfer ${txnId}.`,
    },
    reward_bonus_expiring: {
      title: "Bonus expiring soon",
      body: `Your ${amount} bonus credit expires on ${String(data.expires ?? "")}. Use it on your next transfer.`,
    },
    reward_bonus_expired: {
      title: "Bonus expired",
      body: `${amount} bonus credit expired on ${String(data.expires ?? "")}.`,
    },
    reward_bonus_reversed: {
      title: "Referral bonus removed",
      body: `Your ${amount} referral bonus has been removed because the related transfer was reversed.`,
    },
    // ─── Bonus credit (title and body are written by the feed poller) ─────
    bonus_earned: { title: String(data.title ?? "Bonus credit"), body: String(data.message ?? "") },
    bonus_used: { title: String(data.title ?? "Bonus credit"), body: String(data.message ?? "") },
    bonus_returned: { title: String(data.title ?? "Bonus credit"), body: String(data.message ?? "") },
    bonus_expiring: { title: String(data.title ?? "Bonus credit"), body: String(data.message ?? "") },
    bonus_expired: { title: String(data.title ?? "Bonus credit"), body: String(data.message ?? "") },
    bonus_reversed: { title: String(data.title ?? "Bonus credit"), body: String(data.message ?? "") },
    bonus_unblocked: { title: String(data.title ?? "Bonus credit"), body: String(data.message ?? "") },
    // ─── Support tickets ──────────────────────────────────────────────────
    support_ticket_reply: {
      title: `New reply on ticket #${supportRef}`,
      body: `Rhemito Support replied to your ticket${supportSubject ? `: ${supportSubject}` : ""}.`,
    },
    support_ticket_resolved: {
      title: `Support ticket resolved #${supportRef}`,
      body: `Support ticket #${supportRef} has been resolved. Thank you for your patience.`,
    },
  };

  return templates[type] ?? { title: "Notification", body: "You have a new notification." };
}

// ─── Quiet hours check ────────────────────────────────────────────────────────

export function isInQuietHours(prefs: NotificationPreferences): boolean {
  if (!prefs.quietHoursEnabled || !prefs.quietHoursStart || !prefs.quietHoursEnd) {
    return false;
  }

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const parseTime = (t: string): number => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m ?? 0);
  };

  const start = parseTime(prefs.quietHoursStart);
  const end = parseTime(prefs.quietHoursEnd);

  // Handle overnight range e.g. 22:00 → 08:00
  if (start > end) {
    return currentMinutes >= start || currentMinutes < end;
  }
  return currentMinutes >= start && currentMinutes < end;
}

// ─── Default preferences factory ─────────────────────────────────────────────

function defaultPreferences(userId: string): NotificationPreferences {
  return {
    id: randomUUID(),
    userId,
    inAppEnabled: true,
    emailEnabled: true,
    webPushEnabled: false,
    mobilePushEnabled: false,
    paymentEvents: true,
    transactionEvents: true,
    refundEvents: true,
    kycEvents: true,
    securityEvents: true,
    maintenanceEvents: true,
    marketingEvents: false,
    quietHoursEnabled: false,
    quietHoursStart: null,
    quietHoursEnd: null,
    updatedAt: new Date(),
  };
}

// ─── Channel dispatchers ──────────────────────────────────────────────────────

function dispatchInApp(
  userId: string,
  type: NotificationEventType,
  content: NotificationContent,
  metadata: Record<string, unknown> | null
): Notification {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // +7 days

  const notification: Notification = {
    id: randomUUID(),
    userId,
    type,
    channel: "in_app",
    title: content.title,
    body: content.body,
    status: "delivered",
    isRead: false,
    metadata: metadata ?? null,
    createdAt: now,
    expiresAt,
    archivedAt: null,
  };

  notificationsStore.set(notification.id, notification);

  // Log delivery
  const logEntry: NotificationDeliveryLog = {
    id: randomUUID(),
    notificationId: notification.id,
    channel: "in_app",
    status: "delivered",
    attemptCount: "1",
    lastAttemptAt: now,
    failureReason: null,
    createdAt: now,
  };
  deliveryLogStore.set(logEntry.id, logEntry);

  return notification;
}

function dispatchEmail(
  userId: string,
  content: NotificationContent
): void {
  console.log(
    `[EMAIL STUB] To: userId=${userId} | Subject: ${content.title} | Body: ${content.body}`
  );
  void (async () => {
    try {
      const user = await storage.getAuthUserById(userId);
      if (!user?.email) return;
      const toName =
        user.accountType === "business" && user.businessName
          ? user.businessName
          : [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" ") || undefined;
      await devEmailProvider.send({
        to: user.email,
        toName,
        subject: content.title,
        text: `${content.body}\n\n— Rhemito`,
        customId: `notif:${userId}:${Date.now()}`,
        eventPayload: JSON.stringify({ type: "notification_email", userId, title: content.title }),
      });
    } catch (err) {
      console.error("[notificationService] email send failed:", err);
    }
  })();
}

function dispatchWebPush(
  userId: string,
  content: NotificationContent
): void {
  console.log(
    `[WEB PUSH STUB] To: userId=${userId} | Title: ${content.title} | Body: ${content.body}`
  );
}

function dispatchMobilePush(
  userId: string,
  content: NotificationContent
): void {
  console.log(
    `[MOBILE PUSH STUB] To: userId=${userId} | Title: ${content.title} | Body: ${content.body}`
  );
}

// ─── Demo seed data ───────────────────────────────────────────────────────────
//
// Stable, human-readable IDs so demo URLs like /notifications/demo-notification-1
// always render real content on a freshly started server — mirroring how
// /contribute/demo-campaign-1 works for Group Pay. Idempotent: re-running on an
// already-seeded store is a no-op.

const DEMO_USER_ID = "user_123"; // matches requireAuth() fallback in routes.ts

const DEMO_NOTIFICATIONS: Array<{
  id: string;
  type: NotificationEventType;
  data: Record<string, unknown>;
  ageMinutes: number;
}> = [
  {
    id: "demo-notification-1",
    type: "payment_received",
    data: { txnId: "TXN-DEMO-001", amount: "250.00", currency: "GBP", recipientName: "Jane Carter" },
    ageMinutes: 12,
  },
  {
    id: "demo-notification-2",
    type: "transaction_complete",
    data: { txnId: "TXN-DEMO-002", amount: "1,200.00", currency: "GBP", recipientName: "Marco Silva" },
    ageMinutes: 95,
  },
  {
    id: "demo-notification-3",
    type: "document_required",
    data: { txnId: "TXN-DEMO-003" },
    ageMinutes: 240,
  },
  {
    id: "demo-notification-4",
    type: "funding_allocated_multi",
    data: {
      currency: "GBP",
      txnCount: "3",
      totalAllocated: "750.00",
      unallocatedBalance: "120.00",
    },
    ageMinutes: 30,
  },
  {
    id: "demo-notification-5",
    type: "money_request_paid",
    data: {
      requestNumber: "RM-202608-00001",
      amount: "300.70",
      currency: "GBP",
      payerName: "Ngozi Okafor",
    },
    ageMinutes: 15,
  },
  {
    id: "demo-notification-6",
    type: "invoice_paid",
    data: {
      invoiceNumber: "INV-202608-00001",
      clientName: "Dev Patel",
      amount: "750.00",
      currency: "GBP",
    },
    ageMinutes: 60,
  },
  {
    id: "demo-notification-7",
    type: "campaign_contribution_received",
    data: {
      campaignName: "Wedding Gift Fund",
      contributorName: "Samuel Jackson",
      amount: "150.00",
      currency: "GBP",
    },
    ageMinutes: 120,
  },
  {
    id: "demo-notification-8",
    type: "campaign_target_reached",
    data: {
      campaignName: "Community Soccer Team",
      targetAmount: "1,500.00",
      currency: "GBP",
      contributorCount: "12",
    },
    ageMinutes: 280,
  },
];

export function seedDemoNotifications(): void {
  const now = new Date();

  for (const seed of DEMO_NOTIFICATIONS) {
    // Skip if already present (idempotent — survives HMR / multiple boots)
    if (notificationsStore.has(seed.id)) continue;

    const content = buildNotificationContent(seed.type, seed.data);
    const createdAt = new Date(now.getTime() - seed.ageMinutes * 60 * 1000);

    const notification: Notification = {
      id: seed.id,
      userId: DEMO_USER_ID,
      type: seed.type,
      channel: "in_app",
      title: content.title,
      body: content.body,
      status: "delivered",
      isRead: false,
      metadata: Object.keys(seed.data).length > 0 ? seed.data : null,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000), // +7 days
      archivedAt: null,
    };

    notificationsStore.set(notification.id, notification);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Dispatch a notification to a user across their enabled channels.
 * Critical event types bypass preference and quiet-hours checks.
 */
export async function dispatchNotification(params: {
  userId: string;
  type: NotificationEventType;
  data: Record<string, unknown>;
}): Promise<void> {
  const { userId, type, data } = params;
  const prefs = await getUserPreferences(userId);
  const content = buildNotificationContent(type, data);
  const isCritical = CRITICAL_TYPES.includes(type);
  const category = EVENT_CATEGORY_MAP[type];
  const categoryEnabled = prefs[category as keyof NotificationPreferences] as boolean;
  const quietHours = isInQuietHours(prefs);
  const metadata = Object.keys(data).length > 0 ? data : null;

  // Suppress non-critical events if the category is disabled
  if (!isCritical && !categoryEnabled) {
    if (IN_APP_EVEN_IF_CATEGORY_OFF.includes(type) && prefs.inAppEnabled) {
      dispatchInApp(userId, type, content, metadata);
    }
    return;
  }

  // In-app: always deliver (not gated on quiet hours)
  if (prefs.inAppEnabled || isCritical) {
    dispatchInApp(userId, type, content, metadata);
  }

  // Email: suppress during quiet hours unless critical
  if (prefs.emailEnabled && (isCritical || !quietHours)) {
    dispatchEmail(userId, content);
  }

  // Web push: suppress during quiet hours unless critical
  if (prefs.webPushEnabled && (isCritical || !quietHours)) {
    dispatchWebPush(userId, content);
  }

  // Mobile push: suppress during quiet hours unless critical
  if (prefs.mobilePushEnabled && (isCritical || !quietHours)) {
    dispatchMobilePush(userId, content);
  }
}

/** Mark a single notification as read (only if it belongs to the user). */
export async function markNotificationRead(
  notificationId: string,
  userId: string
): Promise<void> {
  const n = notificationsStore.get(notificationId);
  if (!n || n.userId !== userId) return;
  notificationsStore.set(notificationId, { ...n, isRead: true });
}

/** Mark all active notifications as read for a user. */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  for (const [id, n] of Array.from(notificationsStore.entries())) {
    if (n.userId === userId && !n.isRead && !n.archivedAt) {
      notificationsStore.set(id, { ...n, isRead: true });
    }
  }
}

/** Soft-delete (archive) a notification (only if it belongs to the user). */
export async function dismissNotification(
  notificationId: string,
  userId: string
): Promise<void> {
  const n = notificationsStore.get(notificationId);
  if (!n || n.userId !== userId) return;
  notificationsStore.set(notificationId, { ...n, archivedAt: new Date() });
}

/**
 * Get active notifications for a user.
 * Active = not archived AND (expiresAt is null OR expiresAt > now).
 * Sorted by createdAt DESC. Paginated: 20 per page.
 */
export async function getActiveNotifications(
  userId: string,
  page = 1
): Promise<Notification[]> {
  const now = new Date();
  const PAGE_SIZE = 20;
  const all = Array.from(notificationsStore.values())
    .filter(
      (n) =>
        n.userId === userId &&
        n.channel === "in_app" &&
        !n.archivedAt &&
        (n.expiresAt === null || (n.expiresAt && n.expiresAt > now))
    )
    .sort((a, b) => {
      const aTime = a.createdAt ? a.createdAt.getTime() : 0;
      const bTime = b.createdAt ? b.createdAt.getTime() : 0;
      return bTime - aTime;
    });

  const offset = (page - 1) * PAGE_SIZE;
  return all.slice(offset, offset + PAGE_SIZE);
}

/**
 * Get archived notifications for a user.
 * Archived = archivedAt is set OR expiresAt is in the past.
 * Sorted by createdAt DESC. Paginated: 20 per page.
 */
export async function getArchivedNotifications(
  userId: string,
  page = 1
): Promise<Notification[]> {
  const now = new Date();
  const PAGE_SIZE = 20;
  const all = Array.from(notificationsStore.values())
    .filter(
      (n) =>
        n.userId === userId &&
        n.channel === "in_app" &&
        (n.archivedAt !== null || (n.expiresAt !== null && n.expiresAt && n.expiresAt <= now))
    )
    .sort((a, b) => {
      const aTime = a.createdAt ? a.createdAt.getTime() : 0;
      const bTime = b.createdAt ? b.createdAt.getTime() : 0;
      return bTime - aTime;
    });

  const offset = (page - 1) * PAGE_SIZE;
  return all.slice(offset, offset + PAGE_SIZE);
}

/** Get a single notification by id (only if it belongs to the user). */
export async function getNotificationById(
  notificationId: string,
  userId: string
): Promise<Notification | null> {
  const n = notificationsStore.get(notificationId);
  if (!n || n.userId !== userId) return null;
  return n;
}

/** Get unread count for a user (active, in-app, not archived). */
export async function getUnreadCount(userId: string): Promise<number> {
  const now = new Date();
  let count = 0;
  for (const n of Array.from(notificationsStore.values())) {
    if (
      n.userId === userId &&
      n.channel === "in_app" &&
      !n.isRead &&
      !n.archivedAt &&
      (n.expiresAt === null || (n.expiresAt && n.expiresAt > now))
    ) {
      count++;
    }
  }
  return count;
}

// ─── Support ticket notification helpers ─────────────────────────────────────

const SUPPORT_NOTIFICATION_TYPES: string[] = ["support_ticket_reply", "support_ticket_resolved"];

function supportNotificationRef(n: Notification): string {
  const meta = (n.metadata ?? {}) as Record<string, unknown>;
  return String(meta.referenceNumber ?? meta.txnId ?? "");
}

/** Unread in-app support ticket notifications (reply / resolved) for the Support sidebar badge. */
export function getUnreadSupportNotificationCount(userId: string): number {
  let count = 0;
  for (const n of Array.from(notificationsStore.values())) {
    if (
      n.userId === userId &&
      n.channel === "in_app" &&
      !n.isRead &&
      !n.archivedAt &&
      SUPPORT_NOTIFICATION_TYPES.includes(n.type)
    ) {
      count++;
    }
  }
  return count;
}

/** Mark the user's unread support notifications for one ticket as read; returns how many were marked. */
export function markSupportNotificationsReadByReference(
  userId: string,
  referenceNumber: string,
): number {
  let marked = 0;
  const ref = String(referenceNumber).replace(/^#/, "");
  for (const [id, n] of Array.from(notificationsStore.entries())) {
    if (
      n.userId === userId &&
      !n.isRead &&
      SUPPORT_NOTIFICATION_TYPES.includes(n.type) &&
      supportNotificationRef(n) === ref
    ) {
      notificationsStore.set(id, { ...n, isRead: true });
      marked++;
    }
  }
  return marked;
}

/** Get (or create with defaults) notification preferences for a user. */
export async function getUserPreferences(
  userId: string
): Promise<NotificationPreferences> {
  const existing = preferencesStore.get(userId);
  if (existing) return existing;

  const defaults = defaultPreferences(userId);
  preferencesStore.set(userId, defaults);
  return defaults;
}

/** Update notification preferences for a user. */
export async function updateUserPreferences(
  userId: string,
  prefs: Partial<NotificationPreferences>
): Promise<NotificationPreferences> {
  const existing = await getUserPreferences(userId);
  const updated: NotificationPreferences = {
    ...existing,
    ...prefs,
    userId, // prevent overwriting userId
    id: existing.id, // prevent overwriting id
    updatedAt: new Date(),
  };
  preferencesStore.set(userId, updated);
  return updated;
}

// ─── Bank transfer reminder scheduler ────────────────────────────────────────

/**
 * Schedule automatic cancellation reminder notifications for a bank transfer.
 *
 * @param userId        The user's ID
 * @param txnId         The transaction ID
 * @param recipientName Recipient display name
 * @param amount        Amount being sent (string, e.g. "250.00")
 * @param expiryTime    Absolute Date when the payment window closes (30 min from creation)
 * @returns             A cancel function — call it when the user pays or manually cancels
 */
export function scheduleTransactionReminders(
  userId: string,
  txnId: string,
  recipientName: string,
  amount: string,
  expiryTime: Date
): () => void {
  const now = Date.now();
  const expiryMs = expiryTime.getTime();
  const windowMs = expiryMs - now; // total remaining window

  // Reminder at 15-min mark = fire when 15 min of the window remain
  const fifteenMinMark = windowMs - 15 * 60 * 1000;
  // Reminder at 5-min mark = fire when 5 min of the window remain
  const fiveMinMark = windowMs - 5 * 60 * 1000;

  const timers: NodeJS.Timeout[] = [];
  const data = { txnId, recipientName, recipient: recipientName, amount };

  if (fifteenMinMark > 0) {
    timers.push(
      setTimeout(async () => {
        await dispatchNotification({
          userId,
          type: "auto_cancel_reminder_15",
          data: { ...data, minutesLeft: "15" },
        });
      }, fifteenMinMark)
    );
  }

  if (fiveMinMark > 0) {
    timers.push(
      setTimeout(async () => {
        await dispatchNotification({
          userId,
          type: "auto_cancel_reminder_5",
          data: { ...data, minutesLeft: "5" },
        });
      }, fiveMinMark)
    );
  }

  activeTimers.set(txnId, timers);

  // Return a cancel function
  return () => {
    const existingTimers = activeTimers.get(txnId);
    if (existingTimers) {
      existingTimers.forEach((t) => clearTimeout(t));
      activeTimers.delete(txnId);
    }
  };
}
