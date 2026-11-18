/**
 * Support Service — Rhemito (DEC-2026-11-18-SUPPORT-MODULE, Direction A)
 *
 * Prototype implementation of the FURP `/api/v1/Support/*` + `/api/v1/Account/Faqs` contract using
 * in-memory state with a dev-only JSON snapshot (`.dev-state/support-snapshot.json`), matching the
 * rest of the server-side architecture.
 *
 * - Customer name / email are ALWAYS resolved from the signed-in auth user at read/write time
 *   (REF-18) — no customer personal names are stored or hard-coded here.
 * - Each user is lazily seeded (idempotently) with 4 realistic tickets on first access so the
 *   module is demonstrable out of the box; one seeded `Awaiting Client` ticket carries an unread
 *   `support_ticket_reply` notification that drives the Support sidebar badge.
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  SUPPORT_MAX_FILE_BYTES,
  createSupportTicketFormSchema,
  replySupportTicketFormSchema,
  sanitizeSupportFaqCopy,
  type CreateSupportTicketResult,
  type SupportFaqGroup,
  type SupportStatusCountItem,
  type SupportStatusShortcode,
  type SupportStatusWireLabel,
  type SupportTicketDetailData,
  type SupportTicketMessageItem,
  type SupportTicketsListResponse,
  type SupportTicketSummaryItem,
  type UpdateSupportTicketResult,
} from "@shared/support";
import { storage } from "./storage";
import { dispatchNotification, markSupportNotificationsReadByReference } from "./notificationService";

// ─── Errors ──────────────────────────────────────────────────────────────────

export class SupportError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SupportError";
    this.status = status;
  }
}

// ─── FAQs (retail customer groups — verbatim from FURP staging, Sentence-case group names) ─────

const FAQ_GROUPS: SupportFaqGroup[] = [
  {
    "groupName": "Getting started",
    "description": "Account setup, first login, and basics",
    "sequence": 1,
    "faq": [
      {
        "question": "How do I create an account?",
        "answer": "Sign up with your email and mobile number, verify your email, then complete identity verification before sending money or making payments.",
        "autoNumber": "1003",
        "sequence": "1"
      },
      {
        "question": "Why can't I send money yet?",
        "answer": "Sending is enabled after identity verification and any required payment checks are complete. Open Profile to see pending steps.",
        "autoNumber": "1004",
        "sequence": "2"
      },
      {
        "question": "Which countries can I send money to?",
        "answer": "Available destinations appear when you get a rate quote. Corridors are added over time — check the app for the latest list.",
        "autoNumber": "1005",
        "sequence": "3"
      },
      {
        "question": "Is there a mobile app?",
        "answer": "Yes. Download the app, log in with the same credentials, and complete verification on mobile if prompted.",
        "autoNumber": "1006",
        "sequence": "4"
      },
      {
        "question": "How do I contact support?",
        "answer": "Use Help / Support in the app, include your transaction number if relevant, and choose the closest category.",
        "autoNumber": "1007",
        "sequence": "5"
      }
    ]
  },
  {
    "groupName": "Identity verification",
    "description": "Documents, approval, and failed KYC",
    "sequence": 2,
    "faq": [
      {
        "question": "What documents do I need?",
        "answer": "A valid government-issued photo ID and proof of address. Exact requirements depend on your country and verification level.",
        "autoNumber": "1008",
        "sequence": "1"
      },
      {
        "question": "How long does verification take?",
        "answer": "Most verifications complete within minutes to 24 hours. You will be notified when approved or if more information is needed.",
        "autoNumber": "1009",
        "sequence": "2"
      },
      {
        "question": "My verification failed — what should I do?",
        "answer": "Ensure photos are clear, documents are valid, and details match your profile. Resubmit or contact support with your reference.",
        "autoNumber": "1010",
        "sequence": "3"
      },
      {
        "question": "Why was I asked to verify again?",
        "answer": "Re-verification may be required after profile changes, regulatory updates, or periodic compliance reviews.",
        "autoNumber": "1011",
        "sequence": "4"
      },
      {
        "question": "Can I use the service while KYC is pending?",
        "answer": "Some features are limited until verification is approved. Check the app for what is available in your current status.",
        "autoNumber": "1012",
        "sequence": "5"
      }
    ]
  },
  {
    "groupName": "Send money",
    "description": "Rates, fees, delivery, and corridors",
    "sequence": 3,
    "faq": [
      {
        "question": "How is the exchange rate calculated?",
        "answer": "Rates combine market pricing and corridor configuration. The rate shown at confirmation is the rate applied to your transfer.",
        "autoNumber": "1013",
        "sequence": "1"
      },
      {
        "question": "What fees will I pay?",
        "answer": "Fees depend on corridor, amount, and payment method. The total cost is shown before you confirm the transaction.",
        "autoNumber": "1014",
        "sequence": "2"
      },
      {
        "question": "How long does a transfer take?",
        "answer": "Delivery time depends on destination and payout method. Track status in your transaction history using your transaction number.",
        "autoNumber": "1015",
        "sequence": "3"
      },
      {
        "question": "Can I cancel a transfer?",
        "answer": "Cancellation may be possible only before processing starts. Contact support with your transaction number if you need help.",
        "autoNumber": "1016",
        "sequence": "4"
      },
      {
        "question": "What is a transaction number?",
        "answer": "A unique reference for your transfer. Use it when checking status or contacting support.",
        "autoNumber": "1017",
        "sequence": "5"
      }
    ]
  },
  {
    "groupName": "Wallet & balance",
    "description": "Top-up, balance, and currencies",
    "sequence": 4,
    "faq": [
      {
        "question": "What is my wallet balance?",
        "answer": "Your available balance per currency is shown on Account or Wallet. It reflects completed credits minus debits.",
        "autoNumber": "1018",
        "sequence": "1"
      },
      {
        "question": "How do I add money to my wallet?",
        "answer": "Use supported payment methods such as card or bank transfer where available in your region.",
        "autoNumber": "1019",
        "sequence": "2"
      },
      {
        "question": "Why is my balance lower than expected?",
        "answer": "Pending transactions, fees, or currency conversion may affect balance. Review recent activity in transaction history.",
        "autoNumber": "1020",
        "sequence": "3"
      },
      {
        "question": "Can I hold multiple currencies?",
        "answer": "Yes, where supported. Each currency has its own wallet balance.",
        "autoNumber": "1021",
        "sequence": "4"
      },
      {
        "question": "When does a settlement credit my wallet?",
        "answer": "Affiliate users receive wallet credits after settlement runs complete. Timing follows your payout schedule.",
        "autoNumber": "1022",
        "sequence": "5"
      }
    ]
  },
  {
    "groupName": "Payments",
    "description": "Card, bank transfer, and payment status",
    "sequence": 5,
    "faq": [
      {
        "question": "Which payment methods are supported?",
        "answer": "Supported methods depend on your country and product. Options are shown at checkout or funding.",
        "autoNumber": "1023",
        "sequence": "1"
      },
      {
        "question": "My card payment failed — why?",
        "answer": "Common causes include insufficient funds, bank decline, or 3D Secure not completed. Try again or use another method.",
        "autoNumber": "1024",
        "sequence": "2"
      },
      {
        "question": "What does payment pending mean?",
        "answer": "The payment is being processed. Status updates automatically — check back or wait for a notification.",
        "autoNumber": "1025",
        "sequence": "3"
      },
      {
        "question": "How do I pay by bank transfer?",
        "answer": "Follow the funding instructions shown, including reference number. Funds are credited after the bank confirms receipt.",
        "autoNumber": "1026",
        "sequence": "4"
      },
      {
        "question": "Will I get a receipt?",
        "answer": "Yes. Transaction details and status are available in your history and may be emailed depending on settings.",
        "autoNumber": "1027",
        "sequence": "5"
      }
    ]
  },
  {
    "groupName": "Bill payments",
    "description": "Pay bills, references, and failures",
    "sequence": 6,
    "faq": [
      {
        "question": "How do I pay a bill?",
        "answer": "Select bill payment, choose the biller, enter required details, and confirm payment.",
        "autoNumber": "1028",
        "sequence": "1"
      },
      {
        "question": "What is a biller reference number?",
        "answer": "The reference from your bill or invoice. Enter it exactly as shown to avoid failed payments.",
        "autoNumber": "1029",
        "sequence": "2"
      },
      {
        "question": "My bill payment failed — what now?",
        "answer": "Check reference, amount, and biller details. If correct, retry or contact support with your transaction number.",
        "autoNumber": "1030",
        "sequence": "3"
      },
      {
        "question": "How long until the biller receives payment?",
        "answer": "Most bill payments process quickly. Status is shown in transaction history.",
        "autoNumber": "1031",
        "sequence": "4"
      },
      {
        "question": "Can I save a favourite biller?",
        "answer": "Where supported, save beneficiaries for faster repeat payments.",
        "autoNumber": "1032",
        "sequence": "5"
      }
    ]
  },
  {
    "groupName": "Account & security",
    "description": "Password, profile, and close account",
    "sequence": 7,
    "faq": [
      {
        "question": "How do I reset my password?",
        "answer": "Use Forgot Password on the login screen and follow the email link to set a new password.",
        "autoNumber": "1033",
        "sequence": "1"
      },
      {
        "question": "How do I update my profile?",
        "answer": "Go to Profile / Settings to update contact details. Some changes may trigger re-verification.",
        "autoNumber": "1034",
        "sequence": "2"
      },
      {
        "question": "How do I keep my account secure?",
        "answer": "Use a strong unique password, do not share login details, and log out on shared devices.",
        "autoNumber": "1035",
        "sequence": "3"
      },
      {
        "question": "How do I close my account?",
        "answer": "Contact support to request closure. Ensure no pending transactions or balances remain.",
        "autoNumber": "1036",
        "sequence": "4"
      },
      {
        "question": "I did not authorise a transaction — what do I do?",
        "answer": "Contact support immediately with your transaction number and account details.",
        "autoNumber": "1037",
        "sequence": "5"
      }
    ]
  }
];

export function getSupportFaqs(): SupportFaqGroup[] {
  return FAQ_GROUPS.slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((g) => ({
      ...g,
      faq: g.faq.map((f) => ({
        ...f,
        question: sanitizeSupportFaqCopy(f.question),
        answer: sanitizeSupportFaqCopy(f.answer),
      })),
    }));
}

// ─── State ───────────────────────────────────────────────────────────────────

interface StoredMessage {
  id: string;
  role: "Account Holder" | "BackOffice User";
  /** Only set for BackOffice messages; customer messages resolve the current auth user's name. */
  userName?: string;
  note: string;
  lastactivity: string;
  /** Raw base64 payload, exactly like FURP (`data:image/<ext>;base64,<fileAttachment>` on the client). */
  fileAttachment: string | null;
  fileExtension: string;
  fileName?: string;
}

interface StoredTicket {
  ticketNo: string;
  subject: string;
  supportArea: string;
  transactionReference: string | null;
  statusCode: SupportStatusShortcode;
  requested: string;
  lastactivity: string;
  messages: StoredMessage[];
}

const SNAPSHOT_DIR = path.resolve(process.cwd(), ".dev-state");
const SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, "support-snapshot.json");
const persistenceEnabled = () =>
  process.env.NODE_ENV !== "production" && !process.env.VITEST;

const DEMO_USER_ID = "user_123";
const DEMO_FIRST_TICKET_SEQ = 6441;

let ticketsByUser: Record<string, StoredTicket[]> = {};
let nextTicketSeq = 6445;
const seededNotificationUsers = new Set<string>();
const seedingInFlight = new Map<string, Promise<void>>();

function loadSnapshot(): void {
  if (!persistenceEnabled()) return;
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
    if (raw?.ticketsByUser && typeof raw.ticketsByUser === "object") ticketsByUser = raw.ticketsByUser;
    if (Number.isFinite(raw?.nextTicketSeq)) nextTicketSeq = Number(raw.nextTicketSeq);
    if (Array.isArray(raw?.seededNotificationUsers)) {
      for (const id of raw.seededNotificationUsers) seededNotificationUsers.add(String(id));
    }
  } catch (err) {
    console.warn("[supportService] could not load support snapshot:", err);
  }
}

function persist(): void {
  if (!persistenceEnabled()) return;
  try {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(
      SNAPSHOT_FILE,
      JSON.stringify(
        {
          ticketsByUser,
          nextTicketSeq,
          seededNotificationUsers: Array.from(seededNotificationUsers),
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.warn("[supportService] could not write support snapshot:", err);
  }
}

loadSnapshot();

// ─── Status maps ─────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<SupportStatusShortcode, SupportStatusWireLabel> = {
  NEW: "New",
  AWAITINGADMIN: "Awaiting Admin",
  AWAITINGCLIENT: "Awaiting Client",
  RESOLVED: "Resolved",
};

const SUPPORT_STAFF_NAME = "Rhemito Support";

// ─── Customer resolution (REF-18) ────────────────────────────────────────────

async function resolveCustomer(userId: string): Promise<{ name: string; email: string }> {
  let user: Awaited<ReturnType<typeof storage.getAuthUserById>>;
  try {
    user = await storage.getAuthUserById(userId);
  } catch {
    user = undefined;
  }
  if (!user) return { name: "Account holder", email: "" };
  const email = user.email ?? "";
  const name =
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.businessName ||
    (email ? email.split("@")[0] : "") ||
    "Account holder";
  return { name, email };
}

// ─── Seeding ─────────────────────────────────────────────────────────────────

const iso = (d: Date) => d.toISOString();
const ago = (ms: number) => new Date(Date.now() - ms);
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function msg(
  role: StoredMessage["role"],
  note: string,
  at: Date,
): StoredMessage {
  return {
    id: randomUUID(),
    role,
    userName: role === "BackOffice User" ? SUPPORT_STAFF_NAME : undefined,
    note,
    lastactivity: iso(at),
    fileAttachment: null,
    fileExtension: "",
  };
}

function buildSeedTickets(firstSeq: number): StoredTicket[] {
  const t = (n: number) => String(firstSeq + n);

  const resolvedCreated = ago(14 * DAY);
  const resolved: StoredTicket = {
    ticketNo: t(0),
    subject: "Address verification document review",
    supportArea: "KYC and Compliance",
    transactionReference: null,
    statusCode: "RESOLVED",
    requested: iso(resolvedCreated),
    lastactivity: iso(ago(12 * DAY)),
    messages: [
      msg(
        "Account Holder",
        "I uploaded a new proof of address but it still shows as pending. Could you please review it?",
        resolvedCreated,
      ),
      msg(
        "BackOffice User",
        "Thanks for getting in touch. We have reviewed your proof of address and your verification is now complete. This ticket has been marked as resolved.",
        ago(12 * DAY),
      ),
    ],
  };

  const awaitingClientCreated = ago(3 * DAY);
  const awaitingClient: StoredTicket = {
    ticketNo: t(1),
    subject: "Card payment declined on transfer #22505771",
    supportArea: "Failed Transaction",
    transactionReference: "22505771",
    statusCode: "AWAITINGCLIENT",
    requested: iso(awaitingClientCreated),
    lastactivity: iso(ago(5 * HOUR)),
    messages: [
      msg(
        "Account Holder",
        "My card payment for transfer #22505771 was declined, but my bank says no payment was attempted. What should I do?",
        awaitingClientCreated,
      ),
      msg(
        "BackOffice User",
        "We can see the payment was interrupted at the 3D Secure step. Please retry the payment and approve the 3D Secure prompt in your banking app, then reply here to confirm the result.",
        ago(5 * HOUR),
      ),
    ],
  };

  const awaitingAdminCreated = ago(6 * DAY);
  const awaitingAdmin: StoredTicket = {
    ticketNo: t(2),
    subject: "Update recipient bank sort code details",
    supportArea: "Recipients",
    transactionReference: null,
    statusCode: "AWAITINGADMIN",
    requested: iso(awaitingAdminCreated),
    lastactivity: iso(ago(1 * DAY)),
    messages: [
      msg(
        "Account Holder",
        "The sort code saved for one of my recipients is out of date. Please can you help me update it?",
        awaitingAdminCreated,
      ),
      msg(
        "BackOffice User",
        "Thanks for letting us know. Please send us the new sort code and the last four digits of the account number so we can verify the change.",
        ago(5 * DAY),
      ),
      msg(
        "Account Holder",
        "The new sort code is 20-45-67 and the account number ends in 4821. Thank you.",
        ago(1 * DAY),
      ),
    ],
  };

  const newCreated = ago(2 * HOUR);
  const fresh: StoredTicket = {
    ticketNo: t(3),
    subject: "Transfer status stuck in awaiting payment",
    supportArea: "Failed Transaction",
    transactionReference: "22505606",
    statusCode: "NEW",
    requested: iso(newCreated),
    lastactivity: iso(newCreated),
    messages: [
      msg(
        "Account Holder",
        "My transfer #22505606 has been showing as awaiting payment for a while even though I have already paid.",
        newCreated,
      ),
    ],
  };

  return [resolved, awaitingClient, awaitingAdmin, fresh];
}

async function seedUser(userId: string): Promise<void> {
  if ((ticketsByUser[userId]?.length ?? 0) > 0) return;

  let firstSeq: number;
  if (userId === DEMO_USER_ID) {
    firstSeq = DEMO_FIRST_TICKET_SEQ;
  } else {
    firstSeq = nextTicketSeq;
    nextTicketSeq += 4;
  }
  const seeded = buildSeedTickets(firstSeq);
  ticketsByUser[userId] = seeded;

  if (!seededNotificationUsers.has(userId)) {
    seededNotificationUsers.add(userId);
    const awaitingClient = seeded[1];
    try {
      await dispatchNotification({
        userId,
        type: "support_ticket_reply",
        data: {
          referenceNumber: awaitingClient.ticketNo,
          txnId: awaitingClient.ticketNo,
          subject: awaitingClient.subject,
        },
      });
    } catch (err) {
      console.warn("[supportService] could not dispatch seed notification:", err);
    }
  }
  persist();
}

/** Lazily seed (once, idempotently) a user's tickets on first access. */
export function ensureUserSupportSeeded(userId: string): Promise<void> {
  if ((ticketsByUser[userId]?.length ?? 0) > 0) return Promise.resolve();
  const inFlight = seedingInFlight.get(userId);
  if (inFlight) return inFlight;
  const p = seedUser(userId).finally(() => seedingInFlight.delete(userId));
  seedingInFlight.set(userId, p);
  return p;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function userTickets(userId: string): StoredTicket[] {
  return ticketsByUser[userId] ?? [];
}

function paginate<T>(items: T[], pageNo: number, pageSize: number) {
  const size = Math.min(Math.max(Math.floor(pageSize) || 10, 1), 100);
  const totalCount = items.length;
  const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / size);
  const currentPage = Math.max(Math.floor(pageNo) || 1, 1);
  const start = (currentPage - 1) * size;
  return {
    data: items.slice(start, start + size),
    currentPage,
    totalPages,
    totalCount,
    pageSize: size,
    hasPreviousPage: currentPage > 1,
    hasNextPage: currentPage < totalPages,
  };
}

function normaliseReference(referenceNumber: string): string {
  return String(referenceNumber ?? "").trim().replace(/^#/, "");
}

function statusShortcodeFromFilter(raw: string | undefined): SupportStatusShortcode | null {
  const key = String(raw ?? "").trim().toUpperCase().replace(/[\s_-]+/g, "");
  if (key === "NEW" || key === "AWAITINGADMIN" || key === "AWAITINGCLIENT" || key === "RESOLVED") {
    return key;
  }
  return null;
}

function buildStatusCounts(tickets: StoredTicket[]): SupportStatusCountItem[] {
  const count = (code: SupportStatusShortcode) =>
    tickets.filter((t) => t.statusCode === code).length;
  // Same order as FURP staging.
  return [
    { status: "All", count: tickets.length, shortcode: "" },
    { status: "Blocked", count: 0, shortcode: "BLOCKED" },
    { status: "Awaiting Admin", count: count("AWAITINGADMIN"), shortcode: "AWAITINGADMIN" },
    { status: "New", count: count("NEW"), shortcode: "NEW" },
    { status: "Spam", count: 0, shortcode: "SPAM" },
    { status: "Resolved", count: count("RESOLVED"), shortcode: "RESOLVED" },
    { status: "Awaiting Client", count: count("AWAITINGCLIENT"), shortcode: "AWAITINGCLIENT" },
  ];
}

// ─── Attachment validation ───────────────────────────────────────────────────

export interface SupportAttachmentInput {
  buffer: Buffer;
  filename?: string;
  mimeType?: string;
}

/** Validates size + magic bytes (PNG / JPEG / PDF only). Returns the canonical extension. */
export function validateAttachmentBuffer(
  buffer: Buffer,
  _filename?: string,
  _mimeType?: string,
): { ext: "png" | "jpg" | "pdf" } {
  if (buffer.length > SUPPORT_MAX_FILE_BYTES) {
    throw new SupportError(413, "File size must not exceed 2MB.");
  }
  const startsWith = (sig: number[]) =>
    buffer.length >= sig.length && sig.every((b, i) => buffer[i] === b);
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: "png" };
  if (startsWith([0xff, 0xd8, 0xff])) return { ext: "jpg" };
  if (startsWith([0x25, 0x50, 0x44, 0x46])) return { ext: "pdf" };
  throw new SupportError(400, "Selected file type is not allowed. Please upload PNG, JPG, or PDF.");
}

function safeFileName(name: string | undefined, ext: string): string {
  const base = String(name ?? "")
    .replace(/[\\/]/g, "_")
    .replace(/[^\w.\- ]+/g, "")
    .slice(0, 120)
    .trim();
  return base || `attachment.${ext}`;
}

function buildAttachmentFields(attachment: SupportAttachmentInput | undefined): {
  fileAttachment: string | null;
  fileExtension: string;
  fileName?: string;
} {
  if (!attachment || !attachment.buffer || attachment.buffer.length === 0) {
    return { fileAttachment: null, fileExtension: "" };
  }
  const { ext } = validateAttachmentBuffer(attachment.buffer, attachment.filename, attachment.mimeType);
  return {
    fileAttachment: attachment.buffer.toString("base64"),
    fileExtension: ext,
    fileName: safeFileName(attachment.filename, ext),
  };
}

function firstIssue(err: { issues: { message: string }[] }): string {
  return err.issues[0]?.message ?? "Invalid request";
}

// ─── List ────────────────────────────────────────────────────────────────────

export async function listSupportTickets(
  userId: string,
  opts: { Status?: string; SearchingText?: string; PageNo?: number; PageSize?: number } = {},
): Promise<SupportTicketsListResponse> {
  await ensureUserSupportSeeded(userId);
  const { name } = await resolveCustomer(userId);
  const all = userTickets(userId);

  const wanted = statusShortcodeFromFilter(opts.Status);
  const q = String(opts.SearchingText ?? "").trim().toLowerCase();

  const filtered = all
    .filter((t) => (wanted ? t.statusCode === wanted : true))
    .filter((t) => {
      if (!q) return true;
      return [t.ticketNo, `#${t.ticketNo}`, t.subject, t.supportArea, t.transactionReference ?? ""]
        .some((v) => v.toLowerCase().includes(q));
    })
    .sort((a, b) => Date.parse(b.lastactivity) - Date.parse(a.lastactivity));

  const page = paginate(filtered, opts.PageNo ?? 1, opts.PageSize ?? 10);
  const data: SupportTicketSummaryItem[] = page.data.map((t) => ({
    ticketNo: t.ticketNo,
    date: t.lastactivity,
    name,
    subject: t.subject,
    status: STATUS_LABELS[t.statusCode],
    supportArea: t.supportArea,
    transactionReference: t.transactionReference,
  }));

  return {
    supportTickets: { ...page, data },
    statusCounts: buildStatusCounts(all),
  };
}

// ─── Detail ──────────────────────────────────────────────────────────────────

export async function getSupportTicketDetail(
  userId: string,
  referenceNumber: string,
  pageNo = 1,
  pageSize = 10,
): Promise<SupportTicketDetailData | null> {
  await ensureUserSupportSeeded(userId);
  const ref = normaliseReference(referenceNumber);
  const ticket = userTickets(userId).find((t) => t.ticketNo === ref);
  if (!ticket) return null;

  markSupportNotificationsReadByReference(userId, ticket.ticketNo);

  const customer = await resolveCustomer(userId);
  const page = paginate(ticket.messages, pageNo, pageSize);
  const data: SupportTicketMessageItem[] = page.data.map((m) => ({
    id: m.id,
    userName: m.role === "Account Holder" ? customer.name : (m.userName ?? SUPPORT_STAFF_NAME),
    role: m.role,
    note: m.note,
    lastactivity: m.lastactivity,
    fileAttachment: m.fileAttachment,
    fileExtension: m.fileExtension,
    ...(m.fileName ? { fileName: m.fileName } : {}),
  }));

  return {
    referenceNumber: ticket.ticketNo,
    summary: ticket.subject,
    requested: ticket.requested,
    lastactivity: ticket.lastactivity,
    statusCode: ticket.statusCode,
    status: STATUS_LABELS[ticket.statusCode],
    name: customer.name,
    email: customer.email,
    userType: "Account Holder",
    platform: "Rhemito",
    subject: ticket.subject,
    createdByName: customer.email ? `${customer.name} (${customer.email})` : customer.name,
    supportArea: ticket.supportArea,
    transactionReference: ticket.transactionReference,
    transactionId: ticket.transactionReference,
    createdFrom: "Rhemito web",
    tickets: { ...page, data },
  };
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createSupportTicket(
  userId: string,
  input: {
    supportTicketArea?: unknown;
    transactionReference?: unknown;
    subject?: unknown;
    message?: unknown;
    attachment?: SupportAttachmentInput;
  },
): Promise<NonNullable<CreateSupportTicketResult["data"]>> {
  await ensureUserSupportSeeded(userId);

  const parsed = createSupportTicketFormSchema.safeParse({
    supportTicketArea: input.supportTicketArea,
    transactionReference: input.transactionReference ?? "",
    subject: input.subject,
    message: input.message,
  });
  if (!parsed.success) throw new SupportError(400, firstIssue(parsed.error));
  const values = parsed.data;

  const attachmentFields = buildAttachmentFields(input.attachment);

  const now = new Date();
  const ticketNo = String(nextTicketSeq++);
  const message: StoredMessage = {
    id: randomUUID(),
    role: "Account Holder",
    note: values.message,
    lastactivity: iso(now),
    ...attachmentFields,
  };
  const ticket: StoredTicket = {
    ticketNo,
    subject: values.subject,
    supportArea: values.supportTicketArea,
    transactionReference: values.transactionReference ? values.transactionReference : null,
    statusCode: "NEW",
    requested: iso(now),
    lastactivity: iso(now),
    messages: [message],
  };
  (ticketsByUser[userId] ??= []).push(ticket);
  persist();

  return { referenceNumber: ticketNo, ticketNo, status: "New" };
}

// ─── Reply ───────────────────────────────────────────────────────────────────

export async function replySupportTicket(
  userId: string,
  referenceNumber: string,
  input: { message?: unknown; attachment?: SupportAttachmentInput },
): Promise<NonNullable<UpdateSupportTicketResult["data"]>> {
  await ensureUserSupportSeeded(userId);

  const parsed = replySupportTicketFormSchema.safeParse({ message: input.message });
  if (!parsed.success) throw new SupportError(400, firstIssue(parsed.error));

  const ref = normaliseReference(referenceNumber);
  const ticket = userTickets(userId).find((t) => t.ticketNo === ref);
  if (!ticket) throw new SupportError(404, "Support ticket not found.");

  const attachmentFields = buildAttachmentFields(input.attachment);

  const now = iso(new Date());
  ticket.messages.push({
    id: randomUUID(),
    role: "Account Holder",
    note: parsed.data.message,
    lastactivity: now,
    ...attachmentFields,
  });
  ticket.lastactivity = now;
  // Customer replies (including on Resolved tickets) hand the ticket back to support, as on staging.
  ticket.statusCode = "AWAITINGADMIN";

  markSupportNotificationsReadByReference(userId, ticket.ticketNo);
  persist();

  return { referenceNumber: ticket.ticketNo, status: STATUS_LABELS[ticket.statusCode] };
}
