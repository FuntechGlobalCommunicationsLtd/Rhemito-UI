/**
 * Support routes — Rhemito (DEC-2026-11-18-SUPPORT-MODULE, Direction A)
 *
 * Mirrors the FURP wire contract the Rhemito-web (Next.js) support pages use:
 *   GET  /api/v1/Account/Faqs
 *   GET  /api/v1/Support/GetSupportTickets   (un-enveloped: { supportTickets, statusCounts })
 *   GET  /api/v1/Support/GetSupportTicket    (enveloped: { data, message, code, responseType })
 *   POST /api/v1/Support/SupportTicket       (multipart/form-data: SupportTicketArea, TransactionReference,
 *                                             Subject, Message, Attachment)
 *   POST /api/v1/Support/UpdateTicket        (multipart/form-data: ReferenceNumber, Message, Attachment)
 *   POST /api/v1/Account/MarkNotificationRead
 * plus friendlier `/api/support/*` aliases used by the Rhemito-UI client. Additive only.
 *
 * Zero extra dependencies: the multipart body is parsed by a small Buffer parser behind a
 * route-level `express.raw`. JSON bodies are also accepted (API tests).
 */

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import {
  createSupportTicketFormSchema,
  replySupportTicketFormSchema,
  sanitizeSupportFaqCopy,
  type SupportFaqGroup,
} from "@shared/support";
import { demoModeEnabled } from "./config";
import { markNotificationRead, getUnreadSupportNotificationCount, markSupportNotificationsReadByReference } from "./notificationService";
import {
  clearCustomerFurpToken,
  furpFetchJson,
  furpPostMultipart,
  getCustomerFurpToken,
  isRealFurpLiveEnabled,
  type FurpJsonResult,
} from "./furpClient";
import {
  SupportError,
  createSupportTicket,
  ensureUserSupportSeeded,
  getSupportFaqs,
  getSupportTicketDetail,
  listSupportTickets,
  replySupportTicket,
  validateAttachmentBuffer,
  type SupportAttachmentInput,
} from "./supportService";

// ─── Envelope helpers ────────────────────────────────────────────────────────

function sendOk<T>(res: Response, data: T, message = "Success."): void {
  res.status(200).json({ data, message, code: 200, responseType: "Success" });
}

function sendError(res: Response, code: number, message: string): void {
  res.status(code).json({ code, responseType: "Error", message, data: null });
}

function sendFailure(res: Response, err: unknown): void {
  if (err instanceof SupportError) {
    sendError(res, err.status, err.message);
    return;
  }
  console.error("[supportRoutes] unexpected error:", err);
  sendError(res, 500, "Something went wrong. Please try again.");
}

function sessionUserId(req: Request): string | undefined {
  return req.session?.userId ?? (demoModeEnabled ? "user_123" : undefined);
}

function requireUser(req: Request, res: Response): string | undefined {
  const userId = sessionUserId(req);
  if (!userId) sendError(res, 401, "Not authenticated");
  return userId;
}

// ─── Multipart parser (zero-dependency) ──────────────────────────────────────

export interface ParsedMultipart {
  fields: Record<string, string>;
  file?: { fieldName: string; filename: string; mimeType: string; buffer: Buffer };
}

export function parseMultipartFormData(body: Buffer, contentType: string): ParsedMultipart {
  const result: ParsedMultipart = { fields: {} };
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = m?.[1] ?? m?.[2];
  if (!boundary) throw new SupportError(400, "Invalid multipart request.");

  const delimiter = Buffer.from(`--${boundary}`);
  const CRLF = Buffer.from("\r\n");
  const HEADER_END = Buffer.from("\r\n\r\n");

  let pos = body.indexOf(delimiter);
  while (pos !== -1) {
    let start = pos + delimiter.length;
    // Closing delimiter `--boundary--`
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break;
    // Skip the CRLF that follows the delimiter line
    if (body.subarray(start, start + 2).equals(CRLF)) start += 2;

    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    // The part ends with a CRLF that belongs to the next delimiter line
    const part = body.subarray(start, Math.max(start, next - 2));
    pos = next;

    const headerEnd = part.indexOf(HEADER_END);
    if (headerEnd === -1) continue;
    const headers = part.subarray(0, headerEnd).toString("utf8");
    const content = part.subarray(headerEnd + HEADER_END.length);

    const disposition = /^content-disposition:[^\r\n]*$/im.exec(headers)?.[0] ?? "";
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
    if (!name) continue;
    const filenameMatch = /\bfilename="([^"]*)"/i.exec(disposition);

    if (filenameMatch) {
      if (content.length > 0 && !result.file) {
        const mimeType = /^content-type:\s*([^\r\n;]+)/im.exec(headers)?.[1]?.trim() ?? "";
        result.file = {
          fieldName: name,
          filename: filenameMatch[1],
          mimeType,
          buffer: Buffer.from(content),
        };
      }
    } else {
      result.fields[name] = content.toString("utf8");
    }
  }
  return result;
}

const isMultipart = (req: Request) =>
  String(req.headers["content-type"] ?? "").toLowerCase().startsWith("multipart/form-data");

const rawMultipart = express.raw({ type: (req) => isMultipart(req as Request), limit: "3mb" });
const jsonBody = express.json({ limit: "1mb" });

/** Multipart-or-JSON body parsing with a clean 413 envelope for oversized uploads. */
function bodyParsers(req: Request, res: Response, next: NextFunction): void {
  rawMultipart(req, res, (err?: unknown) => {
    if (err) {
      const e = err as { status?: number; statusCode?: number; type?: string };
      if (e.status === 413 || e.statusCode === 413 || e.type === "entity.too.large") {
        sendError(res, 413, "File size must not exceed 2MB.");
      } else {
        sendError(res, 400, "Invalid request body.");
      }
      return;
    }
    jsonBody(req, res, (jsonErr?: unknown) => {
      if (jsonErr) {
        sendError(res, 400, "Invalid request body.");
        return;
      }
      next();
    });
  });
}

interface SupportPayload {
  /** lower-cased keys → string values */
  fields: Record<string, unknown>;
  attachment?: SupportAttachmentInput;
}

function readPayload(req: Request): SupportPayload {
  const fields: Record<string, unknown> = {};
  let attachment: SupportAttachmentInput | undefined;

  if (isMultipart(req) && Buffer.isBuffer(req.body)) {
    const parsed = parseMultipartFormData(req.body, String(req.headers["content-type"]));
    for (const [k, v] of Object.entries(parsed.fields)) fields[k.toLowerCase()] = v;
    if (parsed.file) {
      attachment = {
        buffer: parsed.file.buffer,
        filename: parsed.file.filename,
        mimeType: parsed.file.mimeType,
      };
    }
  } else if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    for (const [k, v] of Object.entries(req.body as Record<string, unknown>)) fields[k.toLowerCase()] = v;
    // JSON API tests may send a base64 attachment: { attachment: { base64, filename, mimeType } }
    const a = fields["attachment"] as { base64?: string; filename?: string; mimeType?: string } | undefined;
    if (a && typeof a === "object" && typeof a.base64 === "string") {
      attachment = {
        buffer: Buffer.from(a.base64, "base64"),
        filename: a.filename,
        mimeType: a.mimeType,
      };
    }
  }
  return { fields, attachment };
}

function queryValue(req: Request, key: string): string | undefined {
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(req.query)) {
    if (k.toLowerCase() === lower) {
      const val = Array.isArray(v) ? v[0] : v;
      return typeof val === "string" ? val : undefined;
    }
  }
  return undefined;
}

const toInt = (v: string | undefined, fallback: number): number => {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// ─── Live furp02-staging proxy (DEC-2026-11-18-MITOVIEW-AND-REAL-FURP-APIS) ─────────────────────
//
// Active only when `isRealFurpLiveEnabled()`. Tickets are always the signed-in customer's own FURP
// tickets (their FURP JWT); with no FURP session the client gets `requiresFurpAuth` and a sign-in prompt —
// a shared partner account's tickets are never shown. Offline (VITEST / FURP_LIVE=0) the local
// `supportService` prototype store is used, unchanged.

const SIGN_IN_LIST_MESSAGE = "Sign in with your Rhemito account to view and manage your live support tickets.";
const SIGN_IN_TICKET_MESSAGE = "Please sign in with your Rhemito account to view this ticket.";
const SIGN_IN_ACTION_MESSAGE = "Please sign in with your Rhemito account to manage your support tickets.";
const UPSTREAM_UNAVAILABLE = "Support is temporarily unavailable. Please try again shortly.";

function sendRequiresFurpAuth(res: Response, message: string): void {
  res.status(401).json({ code: 401, responseType: "Error", requiresFurpAuth: true, message, data: null });
}

function emptyListRequiringAuth() {
  return {
    supportTickets: {
      data: [],
      currentPage: 1,
      totalPages: 0,
      totalCount: 0,
      pageSize: 10,
      hasPreviousPage: false,
      hasNextPage: false,
    },
    statusCounts: [],
    requiresFurpAuth: true,
    message: SIGN_IN_LIST_MESSAGE,
  };
}

/** Relays an upstream result, guaranteeing a FURP-style error envelope for non-JSON-object failures. */
function relayUpstream(res: Response, r: FurpJsonResult): void {
  const body = r.body;
  if (body && typeof body === "object") {
    res.status(r.status).json(body);
    return;
  }
  if (r.ok) {
    sendOk(res, body);
    return;
  }
  sendError(res, r.status >= 400 ? r.status : 502, UPSTREAM_UNAVAILABLE);
}

function sendLiveFailure(res: Response, err: unknown): void {
  if (err instanceof SupportError) {
    sendError(res, err.status, err.message);
    return;
  }
  console.error("[supportRoutes] live FURP request failed:", err instanceof Error ? err.message : err);
  sendError(res, 502, UPSTREAM_UNAVAILABLE);
}

/** PD-04 Sentence case for FAQ group names, preserving acronyms such as KYC / API. */
export function sentenceCaseGroupName(name: string): string {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return words
    .map((w, i) => {
      if (/^[A-Z0-9]{2,}$/.test(w)) return w; // acronym (KYC, API, FAQs handled below)
      const lower = w.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

const FAQ_CACHE_TTL_MS = 5 * 60 * 1000;
let liveFaqCache: { at: number; groups: SupportFaqGroup[] } | null = null;

async function liveFaqs(req: Request): Promise<SupportFaqGroup[]> {
  if (liveFaqCache && Date.now() - liveFaqCache.at < FAQ_CACHE_TTL_MS) return liveFaqCache.groups;
  const customerToken = getCustomerFurpToken(req);
  const r = await furpFetchJson("/api/v1/Account/Faqs", {
    auth: customerToken ? "customer" : "partner",
    customerToken: customerToken ?? undefined,
  });
  if (!r.ok || !Array.isArray(r.body?.data)) {
    throw new SupportError(r.status >= 400 ? r.status : 502, UPSTREAM_UNAVAILABLE);
  }
  const groups: SupportFaqGroup[] = (r.body.data as any[])
    .filter((g) => Array.isArray(g?.faq) && g.faq.length > 0)
    .map((g) => ({
      groupName: sentenceCaseGroupName(String(g.groupName ?? "")),
      description: String(g.description ?? ""),
      sequence: Number(g.sequence) || 0,
      faq: (g.faq as any[]).map((f) => ({
        question: sanitizeSupportFaqCopy(String(f?.question ?? "")),
        answer: sanitizeSupportFaqCopy(String(f?.answer ?? "")),
        autoNumber: String(f?.autoNumber ?? ""),
        sequence: String(f?.sequence ?? ""),
      })),
    }))
    .sort((a, b) => a.sequence - b.sequence);
  liveFaqCache = { at: Date.now(), groups };
  return groups;
}

async function liveUnreadCount(req: Request, res: Response, userId: string): Promise<void> {
  const customerToken = getCustomerFurpToken(req, userId);
  if (!customerToken) {
    res.status(200).json({ count: 0, requiresFurpAuth: true });
    return;
  }
  try {
    const r = await furpFetchJson("/api/v1/Account/GetNotifications?unreadOnly=true", {
      auth: "customer",
      customerToken,
    });
    if (r.status === 401) {
      clearCustomerFurpToken(req, userId);
      res.status(200).json({ count: 0, requiresFurpAuth: true });
      return;
    }
    const list: any[] = Array.isArray(r.body?.data?.notifications) ? r.body.data.notifications : [];
    const count = list.filter(
      (n) => String(n?.type ?? "").toLowerCase() === "supportticket" && !n?.isRead,
    ).length;
    res.status(200).json({ count });
  } catch (err) {
    console.error("[supportRoutes] live unread-count failed:", err instanceof Error ? err.message : err);
    res.status(200).json({ count: 0 });
  }
}

async function liveList(req: Request, res: Response, userId: string): Promise<void> {
  const customerToken = getCustomerFurpToken(req, userId);
  if (!customerToken) {
    res.status(200).json(emptyListRequiringAuth());
    return;
  }
  try {
    const params = new URLSearchParams();
    params.set("PageNo", String(toInt(queryValue(req, "PageNo"), 1)));
    params.set("PageSize", String(toInt(queryValue(req, "PageSize"), 10)));
    const status = queryValue(req, "Status");
    if (status) params.set("Status", status);
    const search = queryValue(req, "SearchingText") ?? queryValue(req, "search");
    if (search) params.set("SearchingText", search);
    const r = await furpFetchJson(`/api/v1/Support/GetSupportTickets?${params.toString()}`, {
      auth: "customer",
      customerToken,
    });
    if (r.status === 401) {
      clearCustomerFurpToken(req, userId);
      res.status(200).json(emptyListRequiringAuth());
      return;
    }
    relayUpstream(res, r);
  } catch (err) {
    sendLiveFailure(res, err);
  }
}

async function liveMarkRead(customerToken: string, referenceNumber: string): Promise<void> {
  const q = `/api/v1/Account/MarkNotificationRead?referenceNumber=${encodeURIComponent(referenceNumber)}`;
  // Staging serves this as GET (observed from the live web app); fall back to POST on 405.
  let r = await furpFetchJson(q, { auth: "customer", customerToken });
  if (r.status === 405) r = await furpFetchJson(q, { method: "POST", auth: "customer", customerToken });
}

async function liveDetail(req: Request, res: Response, userId: string): Promise<void> {
  const customerToken = getCustomerFurpToken(req, userId);
  if (!customerToken) {
    sendRequiresFurpAuth(res, SIGN_IN_TICKET_MESSAGE);
    return;
  }
  const referenceNumber = String(
    req.params.referenceNumber ?? queryValue(req, "referenceNumber") ?? queryValue(req, "id") ?? "",
  )
    .trim()
    .replace(/^#/, "");
  try {
    const params = new URLSearchParams({
      referenceNumber,
      PageNo: String(toInt(queryValue(req, "PageNo"), 1)),
      PageSize: String(toInt(queryValue(req, "PageSize"), 10)),
    });
    const r = await furpFetchJson(`/api/v1/Support/GetSupportTicket?${params.toString()}`, {
      auth: "customer",
      customerToken,
    });
    if (r.status === 401) {
      clearCustomerFurpToken(req, userId);
      sendRequiresFurpAuth(res, SIGN_IN_TICKET_MESSAGE);
      return;
    }
    if (r.ok && referenceNumber) {
      // Best-effort: opening a ticket clears its unread notification upstream.
      void liveMarkRead(customerToken, referenceNumber).catch(() => undefined);
    }
    relayUpstream(res, r);
  } catch (err) {
    sendLiveFailure(res, err);
  }
}

function liveAttachment(attachment: SupportAttachmentInput | undefined) {
  if (!attachment || !attachment.buffer || attachment.buffer.length === 0) return undefined;
  const { ext } = validateAttachmentBuffer(attachment.buffer, attachment.filename, attachment.mimeType);
  const contentType = ext === "png" ? "image/png" : ext === "pdf" ? "application/pdf" : "image/jpeg";
  const base = String(attachment.filename ?? "")
    .replace(/[\\/]/g, "_")
    .replace(/[^\w.\- ]+/g, "")
    .slice(0, 120)
    .trim();
  return { buffer: attachment.buffer, filename: base || `attachment.${ext}`, contentType };
}

function firstZodMessage(err: { issues: { message: string }[] }): string {
  return err.issues[0]?.message ?? "Invalid request";
}

async function liveCreate(req: Request, res: Response, userId: string): Promise<void> {
  const customerToken = getCustomerFurpToken(req, userId);
  if (!customerToken) {
    sendRequiresFurpAuth(res, SIGN_IN_ACTION_MESSAGE);
    return;
  }
  try {
    const { fields, attachment } = readPayload(req);
    const parsed = createSupportTicketFormSchema.safeParse({
      supportTicketArea: fields["supportticketarea"] ?? fields["supportarea"] ?? fields["area"],
      transactionReference: fields["transactionreference"] ?? "",
      subject: fields["subject"],
      message: fields["message"],
    });
    if (!parsed.success) throw new SupportError(400, firstZodMessage(parsed.error));
    const v = parsed.data;
    const file = liveAttachment(attachment);

    const out: Record<string, string> = {
      SupportTicketArea: v.supportTicketArea,
      Subject: v.subject,
      Message: v.message,
    };
    if (v.supportTicketArea === "Failed Transaction" && v.transactionReference) {
      out.TransactionReference = v.transactionReference;
    }
    const r = await furpPostMultipart("/api/v1/Support/SupportTicket", customerToken, out, file);
    if (r.status === 401) {
      clearCustomerFurpToken(req, userId);
      sendRequiresFurpAuth(res, SIGN_IN_ACTION_MESSAGE);
      return;
    }
    relayUpstream(res, r);
  } catch (err) {
    sendLiveFailure(res, err);
  }
}

async function liveReply(req: Request, res: Response, userId: string): Promise<void> {
  const customerToken = getCustomerFurpToken(req, userId);
  if (!customerToken) {
    sendRequiresFurpAuth(res, SIGN_IN_ACTION_MESSAGE);
    return;
  }
  try {
    const { fields, attachment } = readPayload(req);
    const referenceNumber = String(
      req.params.referenceNumber ?? fields["referencenumber"] ?? fields["ticketno"] ?? fields["id"] ?? "",
    )
      .trim()
      .replace(/^#/, "");
    if (!referenceNumber) throw new SupportError(400, "Ticket reference is required");
    const parsed = replySupportTicketFormSchema.safeParse({
      message: fields["message"] ?? fields["description"],
    });
    if (!parsed.success) throw new SupportError(400, firstZodMessage(parsed.error));
    const file = liveAttachment(attachment);

    const r = await furpPostMultipart(
      "/api/v1/Support/UpdateTicket",
      customerToken,
      { referenceNumber, message: parsed.data.message },
      file,
    );
    if (r.status === 401) {
      clearCustomerFurpToken(req, userId);
      sendRequiresFurpAuth(res, SIGN_IN_ACTION_MESSAGE);
      return;
    }
    relayUpstream(res, r);
  } catch (err) {
    sendLiveFailure(res, err);
  }
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerSupportRoutes(app: Express): void {
  // FAQs — public content, but still served behind the same user gate as the rest of the module.
  const faqsHandler = async (req: Request, res: Response) => {
    if (!requireUser(req, res)) return;
    if (isRealFurpLiveEnabled()) {
      try {
        sendOk(res, await liveFaqs(req));
      } catch (err) {
        // Upstream answered with an error → relay it; network failure/timeout → local FAQ copy.
        if (err instanceof SupportError) sendError(res, err.status, err.message);
        else sendOk(res, getSupportFaqs());
      }
      return;
    }
    sendOk(res, getSupportFaqs());
  };
  app.get("/api/v1/Account/Faqs", faqsHandler);
  app.get("/api/support/faqs", faqsHandler);

  // Ticket list
  const listHandler = async (req: Request, res: Response) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    if (isRealFurpLiveEnabled()) return liveList(req, res, userId);
    try {
      const result = await listSupportTickets(userId, {
        Status: queryValue(req, "Status"),
        SearchingText: queryValue(req, "SearchingText") ?? queryValue(req, "search"),
        PageNo: toInt(queryValue(req, "PageNo"), 1),
        PageSize: toInt(queryValue(req, "PageSize"), 10),
      });
      res.status(200).json(result);
    } catch (err) {
      sendFailure(res, err);
    }
  };
  app.get("/api/v1/Support/GetSupportTickets", listHandler);
  app.get("/api/support/tickets", listHandler);

  // Ticket detail
  const detailHandler = async (req: Request, res: Response) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    if (isRealFurpLiveEnabled()) return liveDetail(req, res, userId);
    const referenceNumber =
      req.params.referenceNumber ??
      queryValue(req, "referenceNumber") ??
      queryValue(req, "id") ??
      "";
    try {
      const detail = await getSupportTicketDetail(
        userId,
        referenceNumber,
        toInt(queryValue(req, "PageNo"), 1),
        toInt(queryValue(req, "PageSize"), 10),
      );
      if (!detail) {
        sendError(res, 404, "Support ticket not found.");
        return;
      }
      sendOk(res, detail);
    } catch (err) {
      sendFailure(res, err);
    }
  };
  app.get("/api/v1/Support/GetSupportTicket", detailHandler);
  app.get("/api/support/tickets/:referenceNumber", detailHandler);

  // Create ticket
  const createHandler = async (req: Request, res: Response) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    if (isRealFurpLiveEnabled()) return liveCreate(req, res, userId);
    try {
      const { fields, attachment } = readPayload(req);
      const created = await createSupportTicket(userId, {
        supportTicketArea: fields["supportticketarea"] ?? fields["supportarea"] ?? fields["area"],
        transactionReference: fields["transactionreference"],
        subject: fields["subject"],
        message: fields["message"],
        attachment,
      });
      sendOk(res, created, "Your enquiry has been successfully submitted.");
    } catch (err) {
      sendFailure(res, err);
    }
  };
  app.post("/api/v1/Support/SupportTicket", bodyParsers, createHandler);
  app.post("/api/support/tickets", bodyParsers, createHandler);

  // Reply to ticket
  const replyHandler = async (req: Request, res: Response) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    if (isRealFurpLiveEnabled()) return liveReply(req, res, userId);
    try {
      const { fields, attachment } = readPayload(req);
      const referenceNumber = String(
        req.params.referenceNumber ??
          fields["referencenumber"] ??
          fields["ticketno"] ??
          fields["id"] ??
          "",
      );
      const updated = await replySupportTicket(userId, referenceNumber, {
        message: fields["message"] ?? fields["description"],
        attachment,
      });
      sendOk(res, updated, "Ticket updated successfully!");
    } catch (err) {
      sendFailure(res, err);
    }
  };
  app.post("/api/v1/Support/UpdateTicket", bodyParsers, replyHandler);
  app.post("/api/support/tickets/:referenceNumber/reply", bodyParsers, replyHandler);

  // Mark notification(s) read — by ticket reference, by notification id, or all support notifications
  app.post("/api/v1/Account/MarkNotificationRead", jsonBody, async (req: Request, res: Response) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
      const lower: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body)) lower[k.toLowerCase()] = v;
      const reference = lower["referencenumber"] ?? lower["ticketno"];
      const notificationId = lower["notificationid"] ?? lower["id"];

      if (isRealFurpLiveEnabled()) {
        const customerToken = getCustomerFurpToken(req, userId);
        if (!customerToken) {
          res.status(200).json({ data: { marked: 0 }, message: "Success.", code: 200, responseType: "Success", requiresFurpAuth: true });
          return;
        }
        const ref = String(reference ?? req.query.referenceNumber ?? "").trim().replace(/^#/, "");
        if (ref) await liveMarkRead(customerToken, ref);
        sendOk(res, { marked: ref ? 1 : 0 });
        return;
      }

      let marked = 0;
      if (reference !== undefined && reference !== null && String(reference) !== "") {
        marked = markSupportNotificationsReadByReference(userId, String(reference));
      } else if (typeof notificationId === "string" && notificationId) {
        await markNotificationRead(notificationId, userId);
        marked = 1;
      }
      sendOk(res, { marked });
    } catch (err) {
      sendFailure(res, err);
    }
  });

  // Unread support notification count (Support sidebar badge)
  app.get("/api/support/unread-count", async (req: Request, res: Response) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    if (isRealFurpLiveEnabled()) return liveUnreadCount(req, res, userId);
    try {
      await ensureUserSupportSeeded(userId);
      res.status(200).json({ count: getUnreadSupportNotificationCount(userId) });
    } catch (err) {
      sendFailure(res, err);
    }
  });
}
