import { z } from "zod";

export const SUPPORT_TICKET_AREAS = [
  "Failed Transaction",
  "Recipients",
  "KYC and Compliance",
] as const;

export type SupportTicketArea = (typeof SUPPORT_TICKET_AREAS)[number];

export const SUPPORT_STATUS_SHORTCODES = [
  "NEW",
  "AWAITINGADMIN",
  "AWAITINGCLIENT",
  "RESOLVED",
] as const;

export type SupportStatusShortcode = (typeof SUPPORT_STATUS_SHORTCODES)[number];

export type SupportStatusWireLabel =
  | "New"
  | "Awaiting Admin"
  | "Awaiting Client"
  | "Resolved";

export interface SupportFaqItem {
  question: string;
  answer: string;
  autoNumber: string;
  sequence: string;
}

export interface SupportFaqGroup {
  groupName: string;
  description: string;
  sequence: number;
  faq: SupportFaqItem[];
}

export interface SupportFaqsResponse {
  data: SupportFaqGroup[];
  message: string;
  code: number;
  responseType: "Success" | "Error";
}

export interface SupportTicketSummaryItem {
  ticketNo: string;
  date: string;
  name: string;
  subject: string;
  status: SupportStatusWireLabel | string;
  supportArea?: string;
  transactionReference?: string | null;
}

export interface SupportStatusCountItem {
  status: string;
  count: number;
  shortcode: string;
}

export interface SupportPaginatedSlice<T> {
  data: T[];
  currentPage: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

export interface SupportTicketsListResponse {
  supportTickets: SupportPaginatedSlice<SupportTicketSummaryItem>;
  statusCounts: SupportStatusCountItem[];
  requiresFurpAuth?: boolean;
  message?: string;
}

export interface SupportTicketMessageItem {
  id?: string;
  userName: string;
  role: "Account Holder" | "BackOffice User";
  note: string;
  lastactivity: string;
  fileAttachment: string | null;
  fileExtension: string;
  fileName?: string;
}

export interface SupportTicketDetailData {
  referenceNumber: string;
  summary: string;
  requested: string;
  lastactivity: string;
  statusCode: SupportStatusShortcode | string;
  status: SupportStatusWireLabel | "Closed" | "Opened" | string;
  name: string;
  email: string;
  userType: string;
  platform: string;
  subject: string;
  createdByName: string;
  supportArea: string;
  transactionReference: string | null;
  transactionId: string | null;
  createdFrom: string;
  tickets: SupportPaginatedSlice<SupportTicketMessageItem>;
}

export interface SupportTicketDetailResponse {
  data: SupportTicketDetailData;
  message: string;
  code: number;
  responseType: "Success" | "Error";
}

export interface CreateSupportTicketResult {
  data: {
    referenceNumber: string;
    ticketNo: string;
    status: SupportStatusWireLabel;
  } | null;
  message: string;
  code: number;
  responseType: "Success" | "Error";
}

export interface UpdateSupportTicketResult {
  data: {
    referenceNumber: string;
    status: SupportStatusWireLabel;
  } | null;
  message: string;
  code: number;
  responseType: "Success" | "Error";
}

export const SUPPORT_MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB
export const SUPPORT_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "application/pdf",
] as const;

export const SUPPORT_ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "pdf"] as const;

export const createSupportTicketFormSchema = z
  .object({
    supportTicketArea: z.enum(SUPPORT_TICKET_AREAS),
    transactionReference: z.string().trim().max(80).optional().default(""),
    subject: z
      .string()
      .trim()
      .min(1, "Subject is required")
      .max(160, "Subject must be 160 characters or fewer"),
    message: z
      .string()
      .trim()
      .min(1, "Message is required")
      .max(4000, "Message must be 4,000 characters or fewer"),
  })
  .superRefine((val, ctx) => {
    if (
      val.supportTicketArea === "Failed Transaction" &&
      !val.transactionReference.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transactionReference"],
        message: "Transaction reference is required",
      });
    }
  });

export type CreateSupportTicketFormValues = z.infer<
  typeof createSupportTicketFormSchema
>;

export const replySupportTicketFormSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Description is required")
    .max(4000, "Description must be 4,000 characters or fewer"),
});

export type ReplySupportTicketFormValues = z.infer<
  typeof replySupportTicketFormSchema
>;

/** Rewrites legacy FURP internal terminology in FAQ copy to mito.money, matching staging. */
export function sanitizeSupportFaqCopy(text: string): string {
  if (!text) return "";
  const trademarks: string[] = [];
  let out = text.replace(
    /(?:FURP|Rhemito|Mito(?:\.Money)?|MITO(?:\.Money)?)\s+is a trademark owned by Funtech Global Communications Ltd\.[^<]*/gi,
    (m) => {
      trademarks.push(m);
      return `@@TM${trademarks.length - 1}@@`;
    },
  );
  const emails: string[] = [];
  out = out
    .replace(/[A-Z0-9._%+\-]+@rhemito\.com/gi, (m) => {
      emails.push(m);
      return `@@EM${emails.length - 1}@@`;
    })
    .replace(/powered by Rhemito/gi, "powered by mito.money")
    .replace(/powered by FURP/gi, "powered by mito.money")
    .replace(
      /powered by Funtechs?[’']?\s+Universal Remittance Portal\s*\(FURP\)(?:,?\s*which is built to manage[^.<]*)?/gi,
      "powered by mito.money",
    )
    .replace(/\bFURP team\b/gi, "mito.money team")
    .replace(/\bFURP\b/g, "mito.money");

  trademarks.forEach((tm, idx) => {
    out = out.replace(`@@TM${idx}@@`, tm);
  });
  emails.forEach((em, idx) => {
    out = out.replace(`@@EM${idx}@@`, em);
  });
  return out;
}
