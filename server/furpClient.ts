/**
 * FURP client — Rhemito (DEC-2026-11-18-MITOVIEW-AND-REAL-FURP-APIS)
 *
 * Thin server-side client for the live `furp02-staging` API used by the Support and MitoView modules
 * and by the additive FURP customer-auth bridge in `auth.ts`.
 *
 * - The partner `apiKey` and partner/customer JWTs never leave the server.
 * - Customer FURP JWTs are kept in memory (+ dev-only `.dev-state/furp-tokens.json`, which is git-ignored),
 *   keyed by the local Rhemito user id, and rejected once their JWT `exp` has passed.
 * - Everything is disabled under VITEST (unless MITO_RETAIL_ALLOW_IN_VITEST=1) and when FURP_LIVE=0,
 *   so offline fixtures / the local prototype store are used instead.
 */

import fs from "fs";
import path from "path";
import type { Request } from "express";
import {
  getMitoRetailToken,
  isMitoRetailConfigured,
  loadMitoRetailCredentials,
} from "./mitoRetail";

declare module "express-session" {
  interface SessionData {
    /** The signed-in customer's own FURP JWT (set by the auth bridge, cleared on logout). */
    furpAccessToken?: string;
  }
}

// ─── Live switch ─────────────────────────────────────────────────────────────

export function isRealFurpLiveEnabled(): boolean {
  if (process.env.VITEST && process.env.MITO_RETAIL_ALLOW_IN_VITEST !== "1") return false;
  if (process.env.FURP_LIVE === "0") return false;
  if (process.env.FURP_BASE_URL === "") return false;
  return isMitoRetailConfigured();
}

function baseUrlAndKey(): { baseUrl: string; apiKey: string } {
  const creds = loadMitoRetailCredentials();
  if (!creds) throw new Error("FURP credentials are not configured.");
  return { baseUrl: creds.baseUrl, apiKey: creds.apiKey };
}

// ─── Customer token store ────────────────────────────────────────────────────

interface StoredFurpToken {
  token: string;
  expiresOn?: string;
  refreshToken?: string;
}

const TOKENS_FILE = path.resolve(process.cwd(), ".dev-state", "furp-tokens.json");
const tokenStore = new Map<string, StoredFurpToken>();
let tokensLoaded = false;

const diskEnabled = () => process.env.NODE_ENV !== "production" && !process.env.VITEST;

function loadTokens(): void {
  if (tokensLoaded) return;
  tokensLoaded = true;
  if (!diskEnabled()) return;
  try {
    if (!fs.existsSync(TOKENS_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8")) as Record<string, StoredFurpToken>;
    for (const [userId, v] of Object.entries(raw)) {
      if (v?.token && !isJwtExpired(v.token)) tokenStore.set(userId, v);
    }
  } catch {
    // ignore a corrupt dev snapshot
  }
}

function saveTokens(): void {
  if (!diskEnabled()) return;
  try {
    fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(Object.fromEntries(tokenStore), null, 2));
  } catch {
    // dev convenience only
  }
}

/** True when the JWT `exp` claim is in the past (or within 30s). Tokens without a readable `exp` are treated as valid. */
function isJwtExpired(token: string): boolean {
  try {
    const [, payloadB64] = token.split(".");
    if (!payloadB64) return false;
    const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as { exp?: number };
    if (typeof claims.exp === "number") return claims.exp * 1000 <= Date.now() + 30_000;
  } catch {
    // fall through
  }
  return false;
}

export function setCustomerFurpToken(
  userId: string,
  token: string,
  expiresOnIso?: string,
  refreshToken?: string,
): void {
  loadTokens();
  tokenStore.set(userId, { token, expiresOn: expiresOnIso, refreshToken });
  saveTokens();
}

/** The signed-in customer's live FURP JWT, or null when absent/expired. */
export function getCustomerFurpToken(req: Request, userId?: string): string | null {
  loadTokens();
  const uid = userId ?? req.session?.userId;
  const candidates: Array<string | undefined> = [
    req.session?.furpAccessToken,
    uid ? tokenStore.get(uid)?.token : undefined,
  ];
  for (const t of candidates) {
    if (t && !isJwtExpired(t)) return t;
  }
  return null;
}

export function clearCustomerFurpToken(req: Request, userId?: string): void {
  loadTokens();
  const uid = userId ?? req.session?.userId;
  if (uid && tokenStore.delete(uid)) saveTokens();
  if (req.session) delete req.session.furpAccessToken;
}

// ─── Customer auth (Auth/check-email, Auth/login) ────────────────────────────

const AUTOMATED_TEST_DOMAINS = ["@example.com", "@test.com", "@rhemito.test"];

export const isAutomatedTestEmail = (email: string): boolean => {
  const e = String(email ?? "").trim().toLowerCase();
  return AUTOMATED_TEST_DOMAINS.some((d) => e.endsWith(d));
};

export async function furpCheckCustomerEmail(
  email: string,
): Promise<{ existsOnFurp: boolean; userName?: string }> {
  if (isAutomatedTestEmail(email)) return { existsOnFurp: false };
  try {
    const { baseUrl, apiKey } = baseUrlAndKey();
    const res = await fetch(`${baseUrl}/api/v1/Auth/check-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apiKey },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(4000),
    });
    const body = (await res.json().catch(() => ({}))) as { data?: { status?: string; userName?: string } };
    return {
      existsOnFurp: Boolean(res.ok && String(body?.data?.status ?? "").toLowerCase() === "login"),
      userName: body?.data?.userName,
    };
  } catch {
    return { existsOnFurp: false };
  }
}

export interface FurpLoginResult {
  token: string;
  refreshToken?: string;
  expiresOn?: string;
  furpUserId?: string;
  name?: string;
  countryIso3?: string;
  profile?: Record<string, any> | null;
}

/** Returns null on any failure (wrong password, unknown account, network) so callers fall back to local login. */
export async function furpLoginCustomer(email: string, password: string): Promise<FurpLoginResult | null> {
  try {
    const { baseUrl, apiKey } = baseUrlAndKey();
    const res = await fetch(`${baseUrl}/api/v1/Auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apiKey },
      body: JSON.stringify({ email, password, rememberMe: false }),
      signal: AbortSignal.timeout(6000),
    });
    const body = (await res.json().catch(() => ({}))) as { data?: Record<string, any> };
    const data = body?.data;
    if (!res.ok || !data?.token) return null;

    let profile: Record<string, any> | null = null;
    try {
      const pr = await fetch(`${baseUrl}/api/v1/Account/profile`, {
        headers: { Authorization: `Bearer ${data.token}`, apiKey },
        signal: AbortSignal.timeout(3500),
      });
      if (pr.ok) {
        const pb = (await pr.json().catch(() => ({}))) as { data?: Record<string, any> };
        profile = pb?.data ?? null;
      }
    } catch {
      // best effort
    }

    return {
      token: String(data.token),
      refreshToken: data.refreshToken ? String(data.refreshToken) : undefined,
      expiresOn: data.expiresOn ? String(data.expiresOn) : undefined,
      furpUserId: data.id ? String(data.id) : undefined,
      name: data.name ? String(data.name) : undefined,
      countryIso3: data.countryIso3 ? String(data.countryIso3) : undefined,
      profile,
    };
  } catch {
    return null;
  }
}

// ─── Generic JSON / multipart helpers ────────────────────────────────────────

export interface FurpJsonResult<T = any> {
  ok: boolean;
  status: number;
  body: T;
}

export async function furpFetchJson<T = any>(
  pathWithQuery: string,
  opts: {
    method?: string;
    auth: "apiKey" | "partner" | "customer";
    customerToken?: string;
    body?: unknown;
    timeoutMs?: number;
  },
): Promise<FurpJsonResult<T>> {
  const { baseUrl, apiKey } = baseUrlAndKey();
  const url = `${baseUrl}${pathWithQuery.startsWith("/") ? "" : "/"}${pathWithQuery}`;

  const send = async (bearer?: string): Promise<FurpJsonResult<T>> => {
    const headers: Record<string, string> = { apiKey };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10000),
    });
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { message: text.slice(0, 300) };
      }
    }
    return { ok: res.ok, status: res.status, body: parsed as T };
  };

  if (opts.auth === "customer") return send(opts.customerToken);
  if (opts.auth === "partner") {
    const first = await send((await getMitoRetailToken()).token);
    if (first.status !== 401) return first;
    return send((await getMitoRetailToken(true)).token);
  }
  return send();
}

export async function furpPostMultipart<T = any>(
  pathWithQuery: string,
  customerToken: string,
  fields: Record<string, string>,
  attachment?: { buffer: Buffer; filename: string; contentType: string },
): Promise<FurpJsonResult<T>> {
  const { baseUrl, apiKey } = baseUrlAndKey();
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (attachment) {
    const blob = new Blob([new Uint8Array(attachment.buffer)], { type: attachment.contentType });
    form.append("Attachment", blob, attachment.filename);
  }
  const res = await fetch(`${baseUrl}${pathWithQuery.startsWith("/") ? "" : "/"}${pathWithQuery}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${customerToken}`, apiKey },
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text.slice(0, 300) };
    }
  }
  return { ok: res.ok, status: res.status, body: parsed as T };
}
