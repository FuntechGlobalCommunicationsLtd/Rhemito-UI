/**
 * MitoView routes — Rhemito (DEC-2026-11-18-MITOVIEW-AND-REAL-FURP-APIS)
 *
 *   GET  /api/v1/MitoView/posts                (+ /api/mitoview/posts)
 *   GET  /api/v1/MitoView/posts/:slug          (+ /api/mitoview/posts/:slug)
 *   POST /api/v1/MitoView/subscribe            (+ /api/mitoview/subscribe)
 *   POST /api/v1/MitoView/unsubscribe          (+ /api/mitoview/unsubscribe)
 *   POST /api/v1/MitoView/unsubscribe/confirm  (+ /api/mitoview/unsubscribe/confirm)
 *
 * Live (`isRealFurpLiveEnabled()`): proxies to `furp02-staging` with the partner `apiKey`, which never reaches
 * the browser. Posts are cached in memory for 5 minutes (stale copy served if upstream is briefly down).
 * Offline (VITEST / FURP_LIVE=0): serves the verified July 2026 edition and deterministic subscribe /
 * unsubscribe responses. Additive only.
 */

import type { Express, Request, Response } from "express";
import { clientIpOf, rateLimit } from "./rateLimit";
import { furpFetchJson, isRealFurpLiveEnabled, type FurpJsonResult } from "./furpClient";

// ─── Offline fixture: the verified July 2026 edition captured from furp02-staging ───────────────

const FIXTURE_POSTS: Record<string, unknown>[] = [
  {
    "id": "a4925762-b9f4-4998-a227-c775ef761560",
    "slug": "2026-07-simplifying-transfers",
    "title": "Simplifying money transfers on Rhemito",
    "excerpt": "Unified payments on Rhemito, OnePipe collections, faster human support, and Rhemi on the way.",
    "editionSummary": "This month: one payment journey on Rhemito (card, instant bank, wallet), OnePipe collections for billers, inbox support that actually replies, and a first look at Rhemi.",
    "category": "July 2026",
    "audience": "both",
    "status": "published",
    "articleLayout": "river",
    "heroSize": "lg",
    "featured": true,
    "heroTint": "sky",
    "heroSrc": "/mitoview/july/unified-payments.jpg",
    "heroAlt": "Customer sending money on a phone",
    "offerCtaLabel": "Send money",
    "offerCtaPath": "/signup",
    "socialSnippet": "MitoView July: simpler payments on Rhemito, OnePipe for billers, and human support from your inbox.",
    "bodyJson": "[{\"type\":\"kicker\",\"text\":\"WHAT WE DO AT FUNTECH\"},{\"type\":\"h2\",\"text\":\"Simplifying money transfers on Rhemito\"},{\"type\":\"img\",\"src\":\"/mitoview/july/unified-payments.jpg\",\"alt\":\"Sending money from a phone\"},{\"type\":\"p\",\"text\":\"Funtech has opened a unified payment journey on Rhemito, our customer money-transfer app. Customers now see the payment methods that apply to them in one place — card, instant bank transfer, and digital wallet — instead of bouncing between disconnected options.\"},{\"type\":\"p\",\"text\":\"The aim is a single, clearer pay-in path worldwide, with the method that fits the corridor still first.\"},{\"type\":\"kicker\",\"text\":\"NEWS AT FUNTECH\"},{\"type\":\"h2\",\"text\":\"Funtech partners with OnePipe\"},{\"type\":\"img\",\"src\":\"/mitoview/july/onepipe.jpg\",\"alt\":\"Biller collection across Africa\"},{\"type\":\"p\",\"text\":\"Funtech’s partnership with OnePipe brings biller collection to customers and billers across Africa, so payment is faster and more reliable. Businesses spend less time chasing invoices and more time growing.\"},{\"type\":\"p\",\"text\":\"With Paywithaccount on mito.money, people living abroad can pay for goods and essential utilities back home from their existing bank account. That is more than a remittance rail — it is day-to-day life.\"},{\"type\":\"kicker\",\"text\":\"WHAT’S HAPPENING AT FUNTECH\"},{\"type\":\"h2\",\"text\":\"Newly improved customer support\"},{\"type\":\"img\",\"src\":\"/mitoview/july/support.jpg\",\"alt\":\"Customer support inbox\"},{\"type\":\"p\",\"text\":\"Whether you are new or long-standing on mito.money, you can get human-assisted support from your inbox.\"},{\"type\":\"p\",\"text\":\"Affiliates, billers and MTOs: support is faster across products. Failed payment, cancelled transfer, refund, or a quick how-to — reply to customer support and include the ticket number or transaction reference in the subject so we can pick it up immediately.\"},{\"type\":\"h2\",\"text\":\"Eager to meet Rhemi?\"},{\"type\":\"img\",\"src\":\"/mitoview/july/rhemi.jpg\",\"alt\":\"Rhemi, the digital assistant\"},{\"type\":\"p\",\"text\":\"Our digital mascot and assistant will land in your inbox and customer area soon. Rhemi is for quick answers: how-tos, transaction checks, rates, and light troubleshooting, without the jargon.\"},{\"type\":\"p\",\"text\":\"To try Rhemi, reply to any customer-support email or click the chat icon in your dashboard and say hi.\"}]",
    "publishedAt": "2026-07-29T00:00:00",
    "linkedInPostId": null,
    "linkedInPostedAt": null
  }
];

// ─── Envelope helpers ────────────────────────────────────────────────────────

const BRAND = "rhemito";

function ok<T>(res: Response, data: T, message: string | null = null): void {
  res.status(200).json({ succeeded: true, data, message, code: 200, responseType: "Success" });
}

function fail(res: Response, code: number, message: string): void {
  res.status(code).json({ succeeded: false, data: null, message, code, responseType: "Error" });
}

function relay(res: Response, r: FurpJsonResult): void {
  if (r.body && typeof r.body === "object") {
    res.status(r.status).json(r.body);
    return;
  }
  if (r.ok) ok(res, r.body ?? null);
  else fail(res, r.status >= 400 ? r.status : 502, UNAVAILABLE);
}

const UNAVAILABLE = "MitoView is temporarily unavailable. Please try again shortly.";

// ─── Posts (live cache + offline fixture) ────────────────────────────────────

const POSTS_TTL_MS = 5 * 60 * 1000;
let postsCache: { at: number; body: { data: Record<string, unknown>[] } & Record<string, unknown> } | null = null;

async function livePostsBody(): Promise<{ data: Record<string, unknown>[] } & Record<string, unknown>> {
  if (postsCache && Date.now() - postsCache.at < POSTS_TTL_MS) return postsCache.body;
  try {
    const r = await furpFetchJson(
      `/api/v1/MitoView/posts?brand=${BRAND}&includeDrafts=false`,
      { auth: "apiKey" },
    );
    if (r.ok && Array.isArray(r.body?.data)) {
      postsCache = { at: Date.now(), body: r.body };
      return r.body;
    }
    throw new Error(`MitoView/posts responded ${r.status}`);
  } catch (err) {
    if (postsCache) return postsCache.body; // stale is better than nothing
    throw err;
  }
}

function fixturePostsBody() {
  return { data: FIXTURE_POSTS, message: null, code: 200, responseType: "Success", succeeded: true };
}

const slugOf = (p: Record<string, unknown>) => String(p?.slug ?? p?.Slug ?? "");

// ─── Input validation ────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TOKEN_RE = /^[\w\-.~+/=]{1,512}$/;
const SLUG_RE = /^[\w\-]{1,160}$/;

function emailFrom(req: Request): string | null {
  const email = String((req.body as Record<string, unknown> | undefined)?.email ?? "").trim();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

function allow(req: Request, res: Response, name: string): boolean {
  const result = rateLimit(`mitoview:${name}:${clientIpOf(req)}`, 10, 60_000);
  if (!result.allowed) {
    res.setHeader("Retry-After", Math.ceil(result.retryAfterMs / 1000));
    fail(res, 429, "Too many attempts. Please try again shortly.");
    return false;
  }
  return true;
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerMitoViewRoutes(app: Express): void {
  const listHandler = async (_req: Request, res: Response) => {
    if (!isRealFurpLiveEnabled()) {
      res.status(200).json(fixturePostsBody());
      return;
    }
    try {
      res.status(200).json(await livePostsBody());
    } catch (err) {
      console.error("[mitoViewRoutes] posts failed:", err instanceof Error ? err.message : err);
      fail(res, 502, UNAVAILABLE);
    }
  };
  app.get("/api/v1/MitoView/posts", listHandler);
  app.get("/api/mitoview/posts", listHandler);

  const singleHandler = async (req: Request, res: Response) => {
    const slug = String(req.params.slug ?? "").trim();
    if (!SLUG_RE.test(slug)) {
      fail(res, 404, "That MitoView edition is not on Rhemito.");
      return;
    }
    const notFound = () => fail(res, 404, "That MitoView edition is not on Rhemito.");

    if (!isRealFurpLiveEnabled()) {
      const post = FIXTURE_POSTS.find((p) => slugOf(p) === slug);
      if (post) ok(res, post);
      else notFound();
      return;
    }

    try {
      const r = await furpFetchJson(
        `/api/v1/MitoView/posts/${encodeURIComponent(slug)}?brand=${BRAND}`,
        { auth: "apiKey" },
      );
      if (r.ok && r.body?.data && typeof r.body.data === "object" && !Array.isArray(r.body.data)) {
        res.status(200).json(r.body);
        return;
      }
      // Single-slug lookup missing/empty upstream → fall back to the cached/live list.
      const list = await livePostsBody();
      const post = list.data.find((p) => slugOf(p) === slug);
      if (post) ok(res, post);
      else notFound();
    } catch (err) {
      console.error("[mitoViewRoutes] post failed:", err instanceof Error ? err.message : err);
      fail(res, 502, UNAVAILABLE);
    }
  };
  app.get("/api/v1/MitoView/posts/:slug", singleHandler);
  app.get("/api/mitoview/posts/:slug", singleHandler);

  const emailAction =
    (action: "subscribe" | "unsubscribe") => async (req: Request, res: Response) => {
      if (!allow(req, res, action)) return;
      const email = emailFrom(req);
      if (!email) {
        fail(res, 400, "Enter a valid email address.");
        return;
      }
      if (!isRealFurpLiveEnabled()) {
        ok(
          res,
          null,
          action === "subscribe"
            ? "You are subscribed to MitoView."
            : "Check your inbox for a link to confirm you want to leave the MitoView list.",
        );
        return;
      }
      try {
        relay(res, await furpFetchJson(`/api/v1/MitoView/${action}`, { method: "POST", auth: "apiKey", body: { email } }));
      } catch (err) {
        console.error(`[mitoViewRoutes] ${action} failed:`, err instanceof Error ? err.message : err);
        fail(res, 502, UNAVAILABLE);
      }
    };
  app.post("/api/v1/MitoView/subscribe", emailAction("subscribe"));
  app.post("/api/mitoview/subscribe", emailAction("subscribe"));
  app.post("/api/v1/MitoView/unsubscribe", emailAction("unsubscribe"));
  app.post("/api/mitoview/unsubscribe", emailAction("unsubscribe"));

  const confirmHandler = async (req: Request, res: Response) => {
    if (!allow(req, res, "confirm")) return;
    const token = String((req.body as Record<string, unknown> | undefined)?.token ?? "").trim();
    if (!TOKEN_RE.test(token)) {
      fail(res, 400, "This unsubscribe link is not valid.");
      return;
    }
    if (!isRealFurpLiveEnabled()) {
      if (token === "invalid-token") fail(res, 400, "This unsubscribe link is not valid or has expired.");
      else ok(res, null, "You have left the MitoView list.");
      return;
    }
    try {
      relay(res, await furpFetchJson("/api/v1/MitoView/unsubscribe/confirm", { method: "POST", auth: "apiKey", body: { token } }));
    } catch (err) {
      console.error("[mitoViewRoutes] unsubscribe confirm failed:", err instanceof Error ? err.message : err);
      fail(res, 502, UNAVAILABLE);
    }
  };
  app.post("/api/v1/MitoView/unsubscribe/confirm", confirmHandler);
  app.post("/api/mitoview/unsubscribe/confirm", confirmHandler);
}
