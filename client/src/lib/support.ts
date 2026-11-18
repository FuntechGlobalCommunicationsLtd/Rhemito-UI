import type { QueryClient } from "@tanstack/react-query";
import type {
  CreateSupportTicketResult,
  SupportFaqGroup,
  SupportFaqsResponse,
  SupportStatusShortcode,
  SupportTicketDetailData,
  SupportTicketDetailResponse,
  SupportTicketsListResponse,
  UpdateSupportTicketResult,
} from "@shared/support";

export const SUPPORT_FAQS_QUERY_KEY = ["/api/v1/Account/Faqs"] as const;
export const SUPPORT_TICKETS_QUERY_KEY = "/api/v1/Support/GetSupportTickets" as const;
export const SUPPORT_TICKET_DETAIL_QUERY_KEY = "/api/v1/Support/GetSupportTicket" as const;
export const SUPPORT_UNREAD_COUNT_QUERY_KEY = ["/api/support/unread-count"] as const;

/**
 * Preserved feature flag for SendMoneyReceiptDialog & BonusBlockedNotice
 * (pinned by tests/e2e/receipt.spec.js non-regression contract).
 */
export const SUPPORT_LINK_ENABLED = false;

export function supportHref(topic?: string): string {
  if (!topic) return "/support/create-ticket";
  return `/support/create-ticket?topic=${encodeURIComponent(topic)}`;
}

export class SupportApiError extends Error {
  readonly status: number;
  readonly requiresFurpAuth: boolean;

  constructor(message: string, status = 500, requiresFurpAuth = false) {
    super(message);
    this.name = "SupportApiError";
    this.status = status;
    this.requiresFurpAuth = requiresFurpAuth;
  }
}

export function isSupportFurpAuthRequiredError(err: unknown): boolean {
  if (err instanceof SupportApiError) {
    return err.requiresFurpAuth;
  }
  if (err && typeof err === "object" && "requiresFurpAuth" in err) {
    return Boolean((err as { requiresFurpAuth?: unknown }).requiresFurpAuth);
  }
  return false;
}

export interface FetchSupportTicketsParams {
  pageNo?: number;
  pageSize?: number;
  status?: SupportStatusShortcode | "ALL" | "";
  searchingText?: string;
}

async function extractResponseError(
  res: Response,
  fallbackMessage: string,
): Promise<SupportApiError> {
  const text = await res.text();
  if (text) {
    try {
      const parsed = JSON.parse(text) as {
        message?: string;
        requiresFurpAuth?: boolean;
        error?: { message?: string; requiresFurpAuth?: boolean };
      };
      const requiresFurpAuth = Boolean(
        parsed?.requiresFurpAuth || parsed?.error?.requiresFurpAuth,
      );
      const clean = parsed?.message ?? parsed?.error?.message;
      if (clean || requiresFurpAuth) {
        return new SupportApiError(
          clean || fallbackMessage,
          res.status,
          requiresFurpAuth,
        );
      }
    } catch {
      // fall through to status/raw text
    }
  }
  return new SupportApiError(
    text || res.statusText || fallbackMessage,
    res.status,
    false,
  );
}

export async function fetchSupportFaqs(): Promise<SupportFaqGroup[]> {
  const res = await fetch("/api/v1/Account/Faqs", {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) {
    throw await extractResponseError(res, "Failed to load FAQs");
  }
  const body = (await res.json()) as SupportFaqsResponse | SupportFaqGroup[];
  if (Array.isArray(body)) {
    return body;
  }
  if (body?.responseType === "Error") {
    throw new SupportApiError(body.message || "Failed to load FAQs", res.status);
  }
  return Array.isArray(body?.data) ? body.data : [];
}

export async function fetchSupportTickets(
  params: FetchSupportTicketsParams = {},
): Promise<SupportTicketsListResponse> {
  const pageNo = params.pageNo ?? 1;
  const pageSize = params.pageSize ?? 10;
  const qs = new URLSearchParams();
  qs.set("PageNo", String(pageNo));
  qs.set("PageSize", String(pageSize));

  if (params.status && params.status !== "ALL") {
    qs.set("Status", params.status);
  }
  if (params.searchingText && params.searchingText.trim()) {
    qs.set("SearchingText", params.searchingText.trim());
  }

  const res = await fetch(`${SUPPORT_TICKETS_QUERY_KEY}?${qs.toString()}`, {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) {
    throw await extractResponseError(res, "Failed to load support tickets");
  }
  const raw = (await res.json()) as
    | SupportTicketsListResponse
    | {
        data?: SupportTicketsListResponse;
        responseType?: string;
        message?: string;
        requiresFurpAuth?: boolean;
      };

  const requiresFurpAuth = Boolean(
    ("requiresFurpAuth" in raw && raw.requiresFurpAuth) ||
      ("data" in raw && raw.data?.requiresFurpAuth),
  );

  if ("responseType" in raw && raw.responseType === "Error" && !requiresFurpAuth) {
    throw new SupportApiError(
      raw.message || "Failed to load support tickets",
      res.status,
      false,
    );
  }

  const unwrapped =
    "data" in raw && raw.data && "supportTickets" in raw.data
      ? raw.data
      : (raw as SupportTicketsListResponse);

  return {
    supportTickets: unwrapped?.supportTickets ?? {
      data: [],
      currentPage: pageNo,
      totalPages: 1,
      totalCount: 0,
      pageSize,
      hasPreviousPage: false,
      hasNextPage: false,
    },
    statusCounts: Array.isArray(unwrapped?.statusCounts) ? unwrapped.statusCounts : [],
    requiresFurpAuth,
    message:
      ("message" in raw && typeof raw.message === "string"
        ? raw.message
        : unwrapped?.message) || undefined,
  };
}

export async function fetchSupportTicketDetail(
  referenceNumber: string,
  pageNo = 1,
  pageSize = 10,
): Promise<SupportTicketDetailData> {
  const cleanRef = String(referenceNumber ?? "").replace(/^#/, "").trim();
  const qs = new URLSearchParams({
    referenceNumber: cleanRef,
    PageNo: String(pageNo),
    PageSize: String(pageSize),
  });

  const res = await fetch(`${SUPPORT_TICKET_DETAIL_QUERY_KEY}?${qs.toString()}`, {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) {
    throw await extractResponseError(res, "Failed to load ticket details");
  }

  const body = (await res.json()) as
    | (SupportTicketDetailResponse & { requiresFurpAuth?: boolean })
    | SupportTicketDetailData;
  if ("responseType" in body && body.responseType === "Error") {
    throw new SupportApiError(
      body.message || "Failed to load ticket details",
      res.status,
      Boolean(body.requiresFurpAuth),
    );
  }

  const detail =
    "data" in body && body.data && "referenceNumber" in body.data
      ? body.data
      : (body as SupportTicketDetailData);
  if (!detail || !detail.referenceNumber) {
    throw new SupportApiError("Ticket not found", 404, false);
  }
  return detail;
}

export async function submitNewSupportTicket(
  formData: FormData,
): Promise<CreateSupportTicketResult> {
  const res = await fetch("/api/v1/Support/SupportTicket", {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  if (!res.ok) {
    throw await extractResponseError(res, "Failed to submit support request");
  }
  const body = (await res.json()) as CreateSupportTicketResult & {
    requiresFurpAuth?: boolean;
  };
  if (body?.responseType === "Error" || !body?.data) {
    throw new SupportApiError(
      body?.message || "Failed to submit support request",
      res.status,
      Boolean(body?.requiresFurpAuth),
    );
  }
  return body;
}

export async function submitSupportTicketReply(
  formData: FormData,
): Promise<UpdateSupportTicketResult> {
  const res = await fetch("/api/v1/Support/UpdateTicket", {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  if (!res.ok) {
    throw await extractResponseError(res, "Failed to update support ticket");
  }
  const body = (await res.json()) as UpdateSupportTicketResult & {
    requiresFurpAuth?: boolean;
  };
  if (body?.responseType === "Error") {
    throw new SupportApiError(
      body?.message || "Failed to update support ticket",
      res.status,
      Boolean(body?.requiresFurpAuth),
    );
  }
  return body;
}

export async function markSupportTicketRead(referenceNumber: string): Promise<void> {
  const cleanRef = String(referenceNumber ?? "").replace(/^#/, "").trim();
  if (!cleanRef) return;
  const qs = new URLSearchParams({ referenceNumber: cleanRef });
  const res = await fetch(`/api/v1/Account/MarkNotificationRead?${qs.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ referenceNumber: cleanRef }),
    credentials: "include",
  });
  if (!res.ok) {
    throw await extractResponseError(res, "Failed to mark ticket notification read");
  }
}

export async function invalidateSupportQueries(
  queryClient: QueryClient,
  referenceNumber?: string,
): Promise<void> {
  const tasks: Array<Promise<unknown>> = [
    queryClient.invalidateQueries({ queryKey: [SUPPORT_TICKETS_QUERY_KEY] }),
    queryClient.invalidateQueries({ queryKey: [SUPPORT_TICKET_DETAIL_QUERY_KEY] }),
    queryClient.invalidateQueries({ queryKey: ["/api/support/unread-count"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] }),
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] }),
  ];

  if (referenceNumber) {
    const cleanRef = referenceNumber.replace(/^#/, "").trim();
    if (cleanRef) {
      tasks.push(
        queryClient.invalidateQueries({
          queryKey: [SUPPORT_TICKET_DETAIL_QUERY_KEY, cleanRef],
        }),
      );
    }
  }

  await Promise.all(tasks);
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Formats an ISO timestamp as `DD MMM YYYY` (e.g. `06 Oct 2026`). */
export function formatSupportDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const month = SHORT_MONTHS[parsed.getUTCMonth()] ?? "";
  const year = parsed.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

/** Formats an ISO timestamp into relative human copy (`just now`, `5 minutes ago`, `2 days ago`). */
export function formatRelativeSupportTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return `${years} year${years > 1 ? "s" : ""} ago`;
  if (months > 0) return `${months} month${months > 1 ? "s" : ""} ago`;
  if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  return "just now";
}

/** Maps wire status strings to Sentence-case display labels (`PD-04`). */
export function formatSupportStatusLabel(status: string | null | undefined): string {
  const raw = String(status ?? "").trim();
  const normalized = raw.toLowerCase();
  if (normalized === "new") return "New";
  if (normalized === "awaiting admin" || normalized === "awaitingadmin") return "Awaiting admin";
  if (normalized === "awaiting client" || normalized === "awaitingclient") return "Awaiting client";
  if (normalized === "resolved") return "Resolved";
  if (normalized === "closed") return "Closed";
  if (normalized === "opened") return "Opened";
  return raw || "New";
}

/** Extracts up to 2 uppercase initials dynamically from a display name. */
export function getInitialsFromName(name: string | null | undefined): string {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "RS";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Resolves a safe internal relative `?redirect=/...` target after authentication. */
export function getSafePostAuthRedirect(searchStr?: string): string {
  const rawSearch =
    searchStr ?? (typeof window !== "undefined" ? window.location.search : "");
  const qs = new URLSearchParams(rawSearch);
  const candidate = (qs.get("redirect") ?? "").trim();
  if (
    candidate.startsWith("/") &&
    !candidate.startsWith("//") &&
    !candidate.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(candidate) &&
    !/^\/%(?:2f|5c)/i.test(candidate) &&
    !candidate.startsWith("/sign-in-sign-up") &&
    !candidate.startsWith("/login")
  ) {
    return candidate;
  }
  return "/";
}
