import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, jsonb, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
// Runtime import is one-directional (invoice-logic only type-imports from this
// module), so there is no runtime cycle.
import { computeInvoiceTotals } from "./invoice-logic";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const promoCodes = pgTable("promo_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(),
  type: text("type").notNull(), // 'fixed' | 'percentage'
  value: text("value").notNull(), // using text for numeric precision in sqlite/pg commonality, or integer * 100
  minAmount: text("min_amount").default("0"),
  currency: text("currency").default("GBP"),
  status: text("status").default("active"),
  usageCount: text("usage_count").default("0"),
});

export const insertPromoCodeSchema = createInsertSchema(promoCodes).pick({
  code: true,
  type: true,
  value: true,
  minAmount: true,
  currency: true,
  status: true,
});

export type InsertPromoCode = z.infer<typeof insertPromoCodeSchema>;
export type PromoCode = typeof promoCodes.$inferSelect;

// ─── Auth Users Table ───────────────────────────────────────────────
export const authUsers = pgTable("auth_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  accountType: text("account_type").notNull().default("individual"), // "individual" | "business"
  country: text("country").notNull(),
  // Individual fields
  firstName: text("first_name"),
  middleName: text("middle_name"),
  lastName: text("last_name"),
  dateOfBirth: text("date_of_birth"),
  gender: text("gender"),
  mobileCode: text("mobile_code"),
  mobileNumber: text("mobile_number"),
  // Business fields
  businessName: text("business_name"),
  businessRegNo: text("business_reg_no"),
  businessPhoneCode: text("business_phone_code"),
  businessPhoneNumber: text("business_phone_number"),
  directorName: text("director_name"),
  // Sender address & birth country fields (for POST /api/v1/mito/Users)
  buildingNumber: text("building_number"),
  buildingName: text("building_name"),
  subStreet: text("sub_street"),
  street: text("street"),
  addressCity: text("address_city"),
  addressPostcode: text("address_postcode"),
  addressCountry: text("address_country"),
  birthCountry: text("birth_country"),
  // Status
  status: text("status").notNull().default("pending"), // "pending" | "active" | "blocked"
  // Mini-KYC: set to "passed" when the in-app identity steps complete.
  kycStatus: text("kyc_status").notNull().default("pending"), // "pending" | "passed" | "failed"
  createdAt: timestamp("created_at").defaultNow(),
});

export type AuthUser = typeof authUsers.$inferSelect;
export type InsertAuthUser = typeof authUsers.$inferInsert;

// ─── OTP Codes Table ────────────────────────────────────────────────
export const otpCodes = pgTable("otp_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  code: text("code").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export type OtpCode = typeof otpCodes.$inferSelect;

// ─── Zod Validation Schemas ─────────────────────────────────────────

export const emailCheckSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least 1 uppercase letter")
  .regex(/[0-9]/, "Password must contain at least 1 number")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least 1 special character");

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

export const individualRegSchema = z.object({
  email: z.string().email(),
  accountType: z.literal("individual"),
  country: z.string().min(1, "Country is required"),
  firstName: z.string().min(2, "First name must be at least 2 characters"),
  middleName: z.string().optional(),
  lastName: z.string().min(2, "Last name must be at least 2 characters"),
  dateOfBirth: z.string().min(1, "Date of birth is required"),
  gender: z.string().min(1, "Gender is required"),
  mobileCode: z.string().min(1, "Country code is required"),
  mobileNumber: z.string().min(7, "Phone number must be at least 7 digits").max(15),
  password: passwordSchema,
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

export const businessStep1Schema = z.object({
  email: z.string().email(),
  accountType: z.literal("business"),
  country: z.string().min(1, "Country is required"),
  businessName: z.string().min(1, "Business name is required"),
  businessRegNo: z.string().min(1, "Business registration number is required"),
  businessPhoneCode: z.string().min(1, "Country code is required"),
  businessPhoneNumber: z.string().min(7, "Phone number must be at least 7 digits").max(15),
});

export const businessStep2Schema = z.object({
  directorName: z.string().min(1, "Director is required"),
  dateOfBirth: z.string().min(1, "Date of birth is required"),
  gender: z.string().min(1, "Gender is required"),
  mobileCode: z.string().min(1, "Country code is required"),
  mobileNumber: z.string().min(7, "Phone number must be at least 7 digits").max(15),
  password: passwordSchema,
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

export const otpVerifySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6, "OTP must be 6 digits"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

export const resetPasswordSchema = z
  .object({
    email: z.string().email("Please enter a valid email address"),
    code: z.string().regex(/^\d{6}$/, "PIN must be 6 digits"),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// ─── Notification Event Types ────────────────────────────────────────────────
export const NOTIFICATION_TYPES = [
  "payment_received",
  "awaiting_payment",
  "payment_failed",
  "transaction_complete",
  "transaction_failed",
  "transaction_cancelled_customer",
  "transaction_cancelled_admin",
  "transaction_cancelled_timeout",
  "auto_cancel_reminder_15",
  "auto_cancel_reminder_5",
  "refund_processed",
  "under_review",
  "review_complete",
  "document_required",
  "document_received",
  "maintenance_scheduled",
  "maintenance_complete",
  "preferences_updated",
  // Story 16 — funding matched to an existing Awaiting Payment transaction
  "funding_received_matched",
  // Story 17 — funding received without a matching transaction (unallocated balance)
  "funding_received_unmatched",
  // Story 18a — funding allocated to a single transaction
  "funding_allocated_single",
  // Story 18b — funding allocated across multiple transactions
  "funding_allocated_multi",
  // Story 18c — partial allocation, additional payment required
  "funding_allocated_partial",
  // Send Invoice MVP1 — sender-facing invoice lifecycle events
  "invoice_paid",
  "invoice_cancelled",
  "invoice_expired",
  "invoice_new_link_requested",
  // Receive Money Link (Money Request) events
  "money_request_paid",
  "money_request_cancelled",
  "money_request_expired",
  "money_request_new_link_requested",
  // Funding Campaigns (GroupPay) events
  "campaign_contribution_received",
  "campaign_target_reached",
  "campaign_status_changed",
  // Referral & Bonus (Refer & Earn) events
  "reward_offer",
  "reward_friend_joined",
  "reward_earned",
  "reward_bonus_used",
  "reward_bonus_expiring",
  "reward_bonus_expired",
  "reward_bonus_reversed",
  // Bonus credit (one balance) events
  "bonus_earned",
  "bonus_used",
  "bonus_returned",
  "bonus_expiring",
  "bonus_expired",
  "bonus_reversed",
  "bonus_unblocked",
  // Support ticket events
  "support_ticket_reply",
  "support_ticket_resolved",
] as const;

export type NotificationEventType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ["in_app", "email", "web_push", "mobile_push"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

// ─── Notifications Table ─────────────────────────────────────────────────────
export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  type: text("type").notNull(),
  channel: text("channel").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("pending"),
  isRead: boolean("is_read").notNull().default(false),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  archivedAt: timestamp("archived_at"),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;
export const insertNotificationSchema = createInsertSchema(notifications);

// ─── Notification Preferences Table ──────────────────────────────────────────
export const notificationPreferences = pgTable("notification_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  inAppEnabled: boolean("in_app_enabled").notNull().default(true),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  webPushEnabled: boolean("web_push_enabled").notNull().default(false),
  mobilePushEnabled: boolean("mobile_push_enabled").notNull().default(false),
  paymentEvents: boolean("payment_events").notNull().default(true),
  transactionEvents: boolean("transaction_events").notNull().default(true),
  refundEvents: boolean("refund_events").notNull().default(true),
  kycEvents: boolean("kyc_events").notNull().default(true),
  securityEvents: boolean("security_events").notNull().default(true),
  maintenanceEvents: boolean("maintenance_events").notNull().default(true),
  marketingEvents: boolean("marketing_events").notNull().default(false),
  quietHoursEnabled: boolean("quiet_hours_enabled").notNull().default(false),
  quietHoursStart: text("quiet_hours_start"),
  quietHoursEnd: text("quiet_hours_end"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type NotificationPreferences = typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreferences = typeof notificationPreferences.$inferInsert;
export const insertNotificationPreferencesSchema = createInsertSchema(notificationPreferences);

// ─── Notification Delivery Log Table ─────────────────────────────────────────
export const notificationDeliveryLog = pgTable("notification_delivery_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  notificationId: varchar("notification_id").notNull(),
  channel: text("channel").notNull(),
  status: text("status").notNull().default("pending"),
  attemptCount: text("attempt_count").notNull().default("0"),
  lastAttemptAt: timestamp("last_attempt_at"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type NotificationDeliveryLog = typeof notificationDeliveryLog.$inferSelect;
export type InsertNotificationDeliveryLog = typeof notificationDeliveryLog.$inferInsert;
export const insertNotificationDeliveryLogSchema = createInsertSchema(notificationDeliveryLog);

// ─── Send Invoice MVP1 ────────────────────────────────────────────────────────

export const INVOICE_STATUSES = [
  "sent",
  "overdue",
  "payment_processing",
  "paid",
  "expired",
  "cancelled",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Statuses persisted on the invoice record; "overdue" is always derived. */
export const INVOICE_STORED_STATUSES = [
  "sent",
  "payment_processing",
  "paid",
  "expired",
  "cancelled",
] as const;
export type InvoiceStoredStatus = (typeof INVOICE_STORED_STATUSES)[number];

export const INVOICE_EVENT_TYPES = [
  "invoice_generated",
  "notification_queued",
  "due_reminder_sent",
  "expiry_reminder_sent",
  "payment_initiated",
  "payment_processing",
  "payment_completed",
  "payment_failed",
  "invoice_expired",
  "new_link_requested",
  "invoice_cancelled",
] as const;
export type InvoiceEventType = (typeof INVOICE_EVENT_TYPES)[number];

export const CLIENT_EMAIL_TYPES = [
  "invoice_sent",
  "due_reminder",
  "expiry_reminder",
  "cancellation",
] as const;
export type ClientEmailType = (typeof CLIENT_EMAIL_TYPES)[number];

export const INVOICE_SOURCES = ["generated", "uploaded"] as const;
export type InvoiceSource = (typeof INVOICE_SOURCES)[number];

/**
 * Line item on a generated invoice ("generate on the go"). Stored as jsonb on
 * the invoice; line amount is always quantity × unitAmount minus the optional
 * per-item discount.
 */
export interface InvoiceItem {
  name: string;
  description: string | null;
  quantity: number;
  unitAmount: number;
  discountType?: "percent" | "fixed" | null;
  discountValue?: number | null;
}

export const invoices = pgTable("invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceNumber: text("invoice_number").notNull().unique(),
  senderId: varchar("sender_id").notNull(),
  senderName: text("sender_name").notNull(), // display-name snapshot shown on the public payment page
  clientType: text("client_type").notNull(), // "individual" | "business"
  clientFirstName: text("client_first_name"),
  clientMiddleName: text("client_middle_name"),
  clientLastName: text("client_last_name"),
  clientBusinessName: text("client_business_name"),
  clientEmail: text("client_email").notNull(),
  clientPhoneCode: text("client_phone_code"),
  clientPhoneNumber: text("client_phone_number"),
  amount: text("amount").notNull(),
  currency: text("currency").notNull(),
  absorbFee: boolean("absorb_fee").notNull().default(false),
  // Receiving payout account snapshot — immutable once the invoice is sent
  payoutAccountBank: text("payout_account_bank").notNull(),
  payoutAccountNumber: text("payout_account_number").notNull(),
  payoutAccountName: text("payout_account_name").notNull(),
  payoutAccountCurrency: text("payout_account_currency").notNull(),
  // Payment in-flight tracking (simulated provider)
  paymentInitiatedAt: timestamp("payment_initiated_at"),
  paymentMethod: text("payment_method"), // "card" | "bank_transfer"
  payerUserId: text("payer_user_id"), // auth user who identified to pay (set at payment initiation)
  dueDate: text("due_date"), // YYYY-MM-DD, optional
  expiresAt: timestamp("expires_at").notNull(), // exact UTC instant (11:59:59 p.m. on the expiry date in expiryTimezone)
  expiryTimezone: text("expiry_timezone").notNull(),
  status: text("status").notNull().default("sent"),
  paymentRef: text("payment_ref"),
  // Prototype keeps the raw token alongside its hash so the payment link can be
  // reconstructed for idempotent repeats and notification resends. A production
  // build would store only the hash and regenerate links from a cipher.
  token: text("token").notNull(),
  tokenHash: text("token_hash").notNull().unique(), // sha-256 of the public payment token
  documentId: varchar("document_id"),
  // Invoice generation ("generate on the go") — an invoice is either generated
  // from line items (source = "generated") or created from an uploaded document
  // (source = "uploaded"); the two modes are mutually exclusive. Null on
  // pre-existing rows means "uploaded".
  source: varchar("source"),
  items: jsonb("items").$type<InvoiceItem[]>(), // generated invoice line items
  taxRate: text("tax_rate"), // percentage stored as text (e.g. "20"), like amount
  discountType: varchar("discount_type"), // "percent" | "fixed"
  discountValue: text("discount_value"), // percentage or fixed amount, stored as text
  notes: text("notes"), // optional note to the client on a generated invoice
  sentAt: timestamp("sent_at").defaultNow(),
  paidAt: timestamp("paid_at"),
  expiredAt: timestamp("expired_at"),
  cancelledAt: timestamp("cancelled_at"),
  cancellationReason: text("cancellation_reason"),
  cancelledBy: varchar("cancelled_by"),
  dueReminderSentAt: timestamp("due_reminder_sent_at"),
  expiryReminderSentAt: timestamp("expiry_reminder_sent_at"),
  newLinkRequestedAt: timestamp("new_link_requested_at"),
  newLinkRequestedBy: text("new_link_requested_by"),
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = typeof invoices.$inferInsert;

export const invoiceDocuments = pgTable("invoice_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  uploaderId: varchar("uploader_id").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: text("size").notNull(), // bytes, text for consistency with other numeric columns
  data: text("data").notNull(), // base64 payload (prototype storage)
  status: text("status").notNull().default("temp"), // "temp" | "associated"
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  expiresAt: timestamp("expires_at"), // temp-upload TTL; null once associated
});

export type InvoiceDocument = typeof invoiceDocuments.$inferSelect;
export type InsertInvoiceDocument = typeof invoiceDocuments.$inferInsert;

export const invoiceEvents = pgTable("invoice_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload"),
  actor: varchar("actor"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type InvoiceEvent = typeof invoiceEvents.$inferSelect;
export type InsertInvoiceEvent = typeof invoiceEvents.$inferInsert;

export const clientEmails = pgTable("client_emails", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull(),
  toEmail: text("to_email").notNull(),
  type: text("type").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  // Invoice document attached to the email (e.g. the invoice_sent email)
  attachmentFileName: text("attachment_file_name"),
  attachmentMimeType: text("attachment_mime_type"),
  attachmentSize: text("attachment_size"),
  status: text("status").notNull().default("sent"), // "sent" | "failed"
  attemptCount: text("attempt_count").notNull().default("1"),
  lastAttemptAt: timestamp("last_attempt_at").defaultNow(),
  dedupeKey: text("dedupe_key").notNull().unique(), // idempotent sends
  createdAt: timestamp("created_at").defaultNow(),
});

export type ClientEmail = typeof clientEmails.$inferSelect;
export type InsertClientEmail = typeof clientEmails.$inferInsert;

// ─── Invoice Zod Validation ───────────────────────────────────────────────────

export const INVOICE_CURRENCIES = ["GBP", "USD", "EUR", "NGN"] as const;

export const EXPIRY_PRESET_DAYS = [7, 14, 30, 60] as const;
export type ExpiryPresetDays = (typeof EXPIRY_PRESET_DAYS)[number];

export const invoiceExpirySchema = z.union([
  z.object({
    type: z.literal("preset"),
    days: z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(60)]),
  }),
  z.object({
    type: z.literal("custom"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Select a future Payment Link Expiry Date."),
  }),
]);
export type InvoiceExpiry = z.infer<typeof invoiceExpirySchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Please enter a valid date.");

/** Mandatory receiving payout account for the invoice (name must match the verified sender). */
export const payoutAccountSchema = z.object({
  bank: z.string().min(1, "A receiving payout account is required."),
  accountNumber: z.string().min(4, "A receiving payout account is required."),
  name: z.string().min(1, "A receiving payout account is required."),
  currency: z.string().min(3, "A receiving payout account is required."),
});
export type PayoutAccountPayload = z.infer<typeof payoutAccountSchema>;

const hasAtMostTwoDecimals = (n: number) => Math.round(n * 100) === n * 100;

/** Line item payload for a generated invoice ("generate on the go"). */
export const invoiceItemInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Enter a name for every invoice item.")
      .max(100, "Item names must be 100 characters or fewer."),
    description: z
      .string()
      .trim()
      .max(500, "Item descriptions must be 500 characters or fewer.")
      .optional(),
    quantity: z
      .number()
      .positive("Enter a quantity greater than zero for every item.")
      .max(1_000_000, "Quantities must be 1,000,000 or lower.")
      .refine(hasAtMostTwoDecimals, "Quantities support up to 2 decimal places."),
    unitAmount: z
      .number()
      .positive("Enter a unit price greater than zero for every item.")
      .max(10_000_000, "Unit prices must be 10,000,000 or lower.")
      .refine(hasAtMostTwoDecimals, "Unit prices support up to 2 decimal places."),
    // Optional per-item discount (percentage of the line, or a fixed amount)
    discountType: z.enum(["percent", "fixed"]).optional(),
    discountValue: z
      .number()
      .positive("Enter the item discount value.")
      .max(10_000_000, "Item discount values must be 10,000,000 or lower.")
      .refine(hasAtMostTwoDecimals, "Item discount values support up to 2 decimal places.")
      .optional(),
  })
  .superRefine((item, ctx) => {
    if (item.discountType !== undefined && item.discountValue === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discountValue"],
        message: "Enter the item discount value.",
      });
    }
    if (item.discountType === undefined && item.discountValue !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discountType"],
        message: "Choose whether the item discount is a percentage or a fixed amount.",
      });
    }
    if (item.discountType === "percent" && (item.discountValue ?? 0) > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discountValue"],
        message: "Item discount percentages must be 100 or lower.",
      });
    }
  });
export type InvoiceItemInput = z.infer<typeof invoiceItemInputSchema>;

const percentInput = (label: string) =>
  z
    .number()
    .positive(`Enter the ${label} percentage.`)
    .max(100, `${label} percentages must be 100 or lower.`)
    .refine(hasAtMostTwoDecimals, `${label} percentages support up to 2 decimal places.`);

export const invoiceAmountInput = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid invoice amount.")
  .refine((v) => parseFloat(v) > 0, "Enter a valid invoice amount.");

/**
 * Invoice creation payload. Two mutually exclusive modes:
 * - `source: "generated"` — line items (with optional tax/discount/notes); the
 *   total is computed server-side. `documentId`/`invoiceAmount` are forbidden.
 * - no `source` (the original MVP1 contract) — an uploaded document plus a
 *   manual amount. `items`/`taxRate`/`discount*`/`notes` are forbidden.
 */
export const sendInvoiceSchema = z
  .object({
    source: z.literal("generated").optional(),
    documentId: z.string().min(1, "An invoice document must be attached before sending.").optional(),
    invoiceAmount: invoiceAmountInput.optional(),
    items: z.array(invoiceItemInputSchema).max(100, "Invoices support up to 100 items.").optional(),
    taxRate: percentInput("Tax").optional(),
    discountType: z.enum(["percent", "fixed"]).optional(),
    discountValue: z
      .number()
      .positive("Enter the discount value.")
      .max(10_000_000, "Discount values must be 10,000,000 or lower.")
      .refine(hasAtMostTwoDecimals, "Discount values support up to 2 decimal places.")
      .optional(),
    notes: z.string().trim().max(500, "Notes must be 500 characters or fewer.").optional(),
    currency: z.enum(INVOICE_CURRENCIES),
    absorbFee: z.boolean(),
    // Server-owned verified account reference — raw bank details are never
    // accepted from the browser (same rule as Request Money).
    payoutAccountId: z.string().min(1, "Select a verified payout account to receive the payout."),
    clientType: z.enum(["individual", "business"]),
    clientFirstName: z.string().optional(),
    clientMiddleName: z.string().optional(),
    clientLastName: z.string().optional(),
    clientBusinessName: z.string().optional(),
    clientEmail: z.string().email("Please enter a valid email address."),
    clientPhoneCode: z.string().optional(),
    clientPhoneNumber: z.string().optional(),
    dueDate: isoDate.optional(),
    expiry: invoiceExpirySchema,
    idempotencyKey: z.string().min(8),
  })
  .superRefine((data, ctx) => {
    if (data.clientType === "individual" && !(data.clientFirstName ?? "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clientFirstName"],
        message: "First name is required for an individual client.",
      });
    }
    if (data.clientType === "business" && !(data.clientBusinessName ?? "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clientBusinessName"],
        message: "Business name is required for a business client.",
      });
    }

    if (data.source === "generated") {
      if (data.documentId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["documentId"],
          message: "A generated invoice cannot include an attached document. Remove the document or send an uploaded invoice instead.",
        });
      }
      if (!data.items || data.items.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items"],
          message: "Add at least one invoice item to generate the invoice.",
        });
      }
    } else {
      if (!data.documentId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["documentId"],
          message: "An invoice document must be attached before sending.",
        });
      }
      if (!data.invoiceAmount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["invoiceAmount"],
          message: "Enter a valid invoice amount.",
        });
      }
      if (data.items && data.items.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items"],
          message: "An uploaded invoice cannot include generated items. Generate the invoice on the go instead, or upload a document.",
        });
      }
    }

    if (data.discountType !== undefined && data.discountValue === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discountValue"],
        message: "Enter the discount value.",
      });
    }
    if (data.discountType === undefined && data.discountValue !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discountType"],
        message: "Choose whether the discount is a percentage or a fixed amount.",
      });
    }
    if (data.discountType === "percent" && (data.discountValue ?? 0) > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discountValue"],
        message: "Discount percentages must be 100 or lower.",
      });
    }

    if (data.items && data.items.length > 0) {
      const totals = computeInvoiceTotals({
        items: data.items,
        taxRate: data.taxRate,
        discountType: data.discountType,
        discountValue: data.discountValue,
      });
      if (totals.total <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items"],
          message: "The invoice total must be greater than zero.",
        });
      }
    }
  });

export type SendInvoicePayload = z.infer<typeof sendInvoiceSchema>;

export const cancelInvoiceSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "A cancellation reason is required.")
    .max(500, "The cancellation reason must be 500 characters or fewer."),
});

export const requestNewLinkSchema = z.object({
  requesterEmail: z.string().email().optional(),
});

// ─── Request Money (unified payment requests) ────────────────────────────────

/** Public payment initiation (invoices) — the chosen method is recorded for audit. */
export const payInvoiceSchema = z.object({
  method: z.enum(["card", "bank_transfer"]).optional(),
});

export const PAYMENT_PURPOSES = [
  "invoice_payment",
  "business_payment",
  "family_support",
  "education_fees",
  "medical_expenses",
  "rent_payment",
  "gift",
  "loan_repayment",
  "other",
] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

/**
 * Prototype-only demo payer seeded on every boot and displayed on the public
 * checkout identification screen so the registered-user (password) path can be
 * demonstrated. Any other email follows the PIN + registration flow.
 */
export const DEMO_PAYER_CREDENTIALS = {
  email: "payer@rhemito.com",
  password: "Demo1234!x",
} as const;

/**
 * Prototype-only master password accepted for ANY account at password
 * verification (login + checkout step-up). Only honoured in dev/demo mode —
 * real production (no dev hooks) always rejects it.
 */
export const PROTOTYPE_MASTER_PASSWORD = "Master1234!x";

/**
 * Rich request lifecycle. "funded" (money received into Rhemito) is strictly
 * separate from "paid_out" (settled to the requester's bank).
 */
export const REQUEST_STATUSES = [
  "active",
  "viewed",
  "authorisation_in_progress",
  "payment_processing",
  "payment_pending",
  "funded",
  "payout_pending",
  "paid_out",
  "failed",
  "expired",
  "cancelled",
  "refunded",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Statuses a requester may cancel from (payment has not begun). */
export const CANCELLABLE_STATUSES: ReadonlyArray<RequestStatus> = ["active", "viewed"];

export const PAYOUT_ACCOUNT_VERIFICATION_STATUSES = [
  "pending",
  "verified",
  "failed",
  "disabled",
] as const;
export type PayoutAccountVerificationStatus = (typeof PAYOUT_ACCOUNT_VERIFICATION_STATUSES)[number];

// ─── Verified payout accounts (server-owned) ──────────────────────────────────

export const payoutAccountsTable = pgTable("payout_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerId: varchar("owner_id").notNull(),
  holderName: text("holder_name").notNull(), // locked to the verified owner name
  country: text("country").notNull(), // ISO alpha-2
  bankName: text("bank_name").notNull(),
  accountNumber: text("account_number").notNull(), // full value stored server-side only
  routingNumber: text("routing_number"),
  currency: text("currency").notNull(),
  verificationStatus: text("verification_status").notNull().default("pending"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  verifiedAt: timestamp("verified_at"),
});

export type PayoutAccountRecord = typeof payoutAccountsTable.$inferSelect;

// ─── Money requests (authoritative lifecycle record) ─────────────────────────

export const moneyRequests = pgTable("money_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  requestNumber: text("request_number").notNull().unique(), // RM-YYYYMM-#####
  requesterId: varchar("requester_id").notNull(),
  requesterName: text("requester_name").notNull(),
  requesterCountry: text("requester_country").notNull(),
  // Corridor + money (integer minor units; JPY-style zero-decimal handled)
  corridorId: text("corridor_id").notNull(),
  senderCountry: text("sender_country").notNull(),
  payInCurrency: text("pay_in_currency").notNull(),
  payInAmountMinor: bigint("pay_in_amount_minor", { mode: "number" }).notNull(),
  payoutCurrency: text("payout_currency").notNull(),
  feeMinor: bigint("fee_minor", { mode: "number" }).notNull(),
  // Fee is 3% of the requested amount; when true the requester absorbs it
  // (sender pays exactly the requested amount), when false it is added to
  // the sender's payment.
  absorbFee: boolean("absorb_fee").notNull().default(true),
  payoutAmountMinor: bigint("payout_amount_minor", { mode: "number" }),
  // FX quote snapshot (indicative unless locked at payment)
  fxRate: text("fx_rate"),
  fxRateIsIndicative: boolean("fx_rate_is_indicative").notNull().default(true),
  fxMarkupApplied: text("fx_markup_applied"),
  // Verified payout account snapshot (masked externally)
  payoutAccountId: varchar("payout_account_id").notNull(),
  payoutAccountMasked: text("payout_account_masked").notNull(),
  payoutAccountBankName: text("payout_account_bank_name").notNull(),
  payoutAccountHolderName: text("payout_account_holder_name").notNull(),
  payoutAccountCountry: text("payout_account_country").notNull(),
  // Sender
  senderType: text("sender_type").notNull(),
  // Payer details are optional: a generic payment link can be created with no payer.
  senderName: text("sender_name"),
  senderEmail: text("sender_email"),
  senderPhone: text("sender_phone"),
  senderDob: text("sender_dob"),
  purpose: text("purpose").notNull(),
  // Optional payer details supplied by the requester (help matching; do not verify the payer).
  senderId: varchar("sender_id"),
  payerSourceBankName: text("payer_source_bank_name"),
  payerSourceAccountMasked: text("payer_source_account_masked"),
  payerSourceOrigin: text("payer_source_origin"), // "requester" | "saved_sender"
  reference: text("reference"),
  // Dual secure link tokens
  token: text("token").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  emailToken: text("email_token"),
  emailTokenHash: text("email_token_hash"),
  recipientEmailMasked: text("recipient_email_masked"),
  // Authenticated Payer (once identified)
  payerUserId: varchar("payer_user_id"),
  payerName: text("payer_name"),
  payerEmail: text("payer_email"),
  payerEmailMasked: text("payer_email_masked"),
  // 10-minute server-controlled payment session
  activeSessionId: text("active_session_id"),
  sessionExpiresAt: timestamp("session_expires_at"),
  reservedAttemptId: text("reserved_attempt_id"),
  // Lifecycle
  status: text("status").notNull().default("active"),
  // Optional date (YYYY-MM-DD) the requester expects payment by — the link
  // stays payable until expiresAt regardless (same semantics as invoices).
  dueDate: text("due_date"),
  expiresAt: timestamp("expires_at").notNull(),
  expiryExtendedOnce: boolean("expiry_extended_once").notNull().default(false),
  viewedAt: timestamp("viewed_at"),
  paymentInitiatedAt: timestamp("payment_initiated_at"),
  fundedAt: timestamp("funded_at"),
  payoutSubmittedAt: timestamp("payout_submitted_at"),
  paidOutAt: timestamp("paid_out_at"),
  cancelledAt: timestamp("cancelled_at"),
  failureReason: text("failure_reason"),
  // Provider references (pay-in intent, provider payment id, payout ref)
  payinIntentId: text("payin_intent_id"),
  providerPaymentRef: text("provider_payment_ref"),
  payoutProviderRef: text("payout_provider_ref"),
  paymentMethod: text("payment_method"),
  idempotencyKey: text("idempotency_key"),
  // Receive Money promo code (bonus from Mito) and the bonus reserved for the requester, minor units of payoutCurrency
  promoCode: text("promo_code"),
  promoBonusMinor: bigint("promo_bonus_minor", { mode: "number" }),
  createdAt: timestamp("created_at").defaultNow(),
});

export type MoneyRequest = typeof moneyRequests.$inferSelect;

export const paymentAttempts = pgTable("payment_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  requestId: varchar("request_id").notNull(),
  requestNumber: text("request_number").notNull(),
  payerId: varchar("payer_id"),
  payerEmail: text("payer_email").notNull(),
  payerName: text("payer_name").notNull(),
  payerEmailMasked: text("payer_email_masked").notNull(),
  paymentMethod: text("payment_method").notNull(),
  payCurrency: text("pay_currency").notNull(),
  payAmountMinor: bigint("pay_amount_minor", { mode: "number" }).notNull(),
  feeMinor: bigint("fee_minor", { mode: "number" }).notNull(),
  absorbFee: boolean("absorb_fee").notNull(),
  fxRate: text("fx_rate"),
  status: text("status").notNull().default("session_open"),
  paymentReference: text("payment_reference").notNull(),
  providerIntentId: text("provider_intent_id"),
  providerPaymentRef: text("provider_payment_ref"),
  failureReason: text("failure_reason"),
  sessionStartedAt: timestamp("session_started_at").defaultNow(),
  sessionExpiresAt: timestamp("session_expires_at"),
  authorisationStartedAt: timestamp("authorisation_started_at"),
  completedAt: timestamp("completed_at"),
});

export type PaymentAttempt = typeof paymentAttempts.$inferSelect;

export const requestRenewalRequests = pgTable("request_renewal_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  requestId: varchar("request_id").notNull(),
  requestNumber: text("request_number").notNull(),
  requesterId: varchar("requester_id").notNull(),
  payerEmail: text("payer_email"),
  requestedAt: timestamp("requested_at").defaultNow(),
});

export type RequestRenewalRequest = typeof requestRenewalRequests.$inferSelect;

// ─── Double-entry ledger ──────────────────────────────────────────────────────

export const LEDGER_ENTRY_TYPES = [
  "gross_received", // funds received from the sender
  "rhemito_fee", // fee deducted from requester proceeds
  "fx_conversion", // FX debit/credit pair for cross-currency payouts
  "net_wallet_credit", // net credit to the requester's Rhemito wallet
  "payout_debit", // debit when net funds leave the wallet to the bank
  "promo_bonus", // Receive Money promo bonus paid to the requester's bank on top, funded by Mito
  "refund",
  "reversal",
  "loss_adjustment",
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export const ledgerEntries = pgTable("ledger_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  requestId: varchar("request_id").notNull(),
  type: text("type").notNull(),
  account: text("account").notNull(), // e.g. "wallet:<userId>", "fee:rhemito", "payout_clearing:<userId>"
  direction: text("direction").notNull(), // "debit" | "credit"
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  providerRef: text("provider_ref"),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type LedgerEntry = typeof ledgerEntries.$inferSelect;

// ─── Provider webhook idempotency ─────────────────────────────────────────────

export const webhookEvents = pgTable("webhook_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: text("provider").notNull(),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at").defaultNow(),
  requestNumber: text("request_number"),
});

export type WebhookEvent = typeof webhookEvents.$inferSelect;

// ─── Email delivery log (Request Money) ───────────────────────────────────────

export const EMAIL_DELIVERY_STATES = ["queued", "sent", "delivered", "failed", "resent"] as const;

export const emailDeliveries = pgTable("email_deliveries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  requestId: varchar("request_id").notNull(),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  state: text("state").notNull().default("queued"),
  attempts: text("attempts").notNull().default("0"),
  dedupeKey: text("dedupe_key").notNull().unique(),
  lastAttemptAt: timestamp("last_attempt_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type EmailDelivery = typeof emailDeliveries.$inferSelect;

// ─── Request Money Zod validation ─────────────────────────────────────────────

export const addPayoutAccountSchema = z.object({
  // Optional from the client — the server locks the holder name to the
  // requester's verified profile name.
  holderName: z.string().trim().optional(),
  country: z.string().regex(/^[A-Z]{2}$/, "Select the account country."),
  bankName: z.string().trim().min(2, "Bank name is required."),
  accountNumber: z.string().trim().min(4, "Account number is required.").max(34),
  routingNumber: z.string().trim().max(34).optional(),
  currency: z.string().min(3, "Select the account currency."),
});

export const createMoneyRequestSchema = z
  .object({
    corridorId: z.string().min(1, "Select a supported corridor."),
    payoutAccountId: z.string().min(1, "Select a verified payout account."),
    payInAmount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount.")
      .refine((v) => parseFloat(v) > 0, "Enter a valid amount."),
    senderType: z.enum(["individual", "business"]).optional().default("individual"),
    // Payer details are optional; blank strings are treated as "not provided".
    senderName: z.string().trim().min(2, "Payer name must be at least 2 characters.").optional().or(z.literal("")).transform((v) => v || undefined),
    senderEmail: z.string().trim().email("Please enter a valid email address.").optional().or(z.literal("")).transform((v) => v || undefined),
    senderPhone: z.string().trim().optional(),
    senderDob: isoDate.optional(),
    senderId: z.string().trim().max(64).optional(),
    payerBankName: z.string().trim().max(80).optional(),
    payerAccountNumber: z.string().trim().regex(/^\d{6,12}$/, "Enter the payer account number using digits only.").optional().or(z.literal("")).transform((v) => v || undefined),
    purpose: z.enum(PAYMENT_PURPOSES, {
      errorMap: () => ({ message: "Select a purpose for this payment." }),
    }),
    reference: z.string().trim().max(140).optional(),
    // Absent callers keep the historical behavior: requester absorbs the fee.
    absorbFee: z.boolean().optional().default(true),
    dueDate: isoDate.optional(),
    // Same link-expiry contract as invoices; absent callers keep the
    // historical 30-day preset (the UI always sends an explicit choice).
    expiry: invoiceExpirySchema.optional().default({ type: "preset", days: 30 }),
    idempotencyKey: z.string().min(8),
    // Optional Receive Money promo code: the requester earns a bonus (Mito) once the request is paid out.
    promoCode: z.string().trim().max(20).optional().or(z.literal("")).transform((v) => v || undefined),
  });

export type CreateMoneyRequestPayload = z.infer<typeof createMoneyRequestSchema>;

export const createPayinIntentSchema = z.object({
  method: z.enum(["pay_by_bank", "card", "bank_transfer", "wallet"]),
});
