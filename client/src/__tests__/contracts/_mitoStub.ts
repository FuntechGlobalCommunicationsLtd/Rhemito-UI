/**
 * Test harness shared by the contract tests: a stub of the Mito service plus the real Rhemito Express routes
 * (promo, bonus, rewards, send money) wired to it. The real code talks to the stub over HTTP, so the contracts
 * exercise the genuine request/response shapes, not mocks of our own modules.
 *
 * Modules are imported only after MITO_API_URL points at the stub, because they read it at import time.
 */
import http from "http";
import type { AddressInfo } from "net";
import express from "express";

export type StubReply = { status: number; body: any } | "drop";
export interface StubCall {
  seq: number;
  path: string;
  method: string;
  body: any;
  /** Whatever the test's `onCall` hook returned when the call arrived (e.g. the transaction status at that moment). */
  meta?: unknown;
}
type Replier = StubReply | ((call: StubCall) => StubReply | Promise<StubReply>);

const ok = (body: any): StubReply => ({ status: 200, body });

const defaultWallet = () => ({
  bonus_blocked: false,
  balances: [{ currency: "GBP", available: 15, earned: 20, used: 5, expired: 0, used_transfer_count: 1, referral_credit_count: 1, other_credit_count: 0, by_source: [{ credit_source: "REFERRAL", label: "Referrals", earned: 20, used: 5, expired: 0, removed: 0, available: 15 }] }],
  unused: [], credits: [], history: [], promo_redemptions: [],
});

export function createMitoStub() {
  const calls: StubCall[] = [];
  let seq = 0;
  let overrides: Array<{ match: string | RegExp; reply: Replier }> = [];
  let hook: ((call: StubCall) => unknown | Promise<unknown>) | undefined;
  let server: http.Server;

  const defaults = (method: string, url: string): StubReply => {
    const p = url.split("?")[0];
    if (p === "/api/promocodes/validate") return ok({ valid: true, appliedDiscount: 1, appliesTo: "fee", displayText: "GBP 1.00 off", currency: "GBP" });
    if (p === "/api/promocodes/redeem") return ok({ success: true, discount: 1 });
    if (p === "/api/promocodes/release") return ok({ success: true, released: 1 });
    if (p.startsWith("/api/promocodes/customers/") && method === "GET") return ok({ data: [], summary: { saved: {} } });
    if (/^\/api\/wallet\/[^/]+\/apply$/.test(p)) return ok({ applied: 10, available: 5 });
    if (/^\/api\/wallet\/[^/]+\/release$/.test(p)) return ok({ released: 10 });
    if (p.startsWith("/api/wallet/")) return ok(defaultWallet());
    if (p === "/api/bonus/offers") return ok([]);
    if (p === "/api/bonus/feed") return ok({ data: [], last_id: 0 });
    if (p === "/api/referral/customers") return ok({ data: { id: "user_123", referral_code: "JOHN2880", send_currency: "GBP" } });
    if (p === "/api/referral/referrals" && method === "POST") return ok({ data: { status: "REGISTERED", referrer_id: "nobody", reward_type: "BOTH", referrer_reward: 5, currency: "GBP", floor: 50 } });
    if (p === "/api/referral/referrals") return ok({ data: [], summary: { joined: 0, earned_count: 0, total_earned: {} } });
    if (p === "/api/referral/transfer-events") return ok({ referral: null });
    if (p === "/api/referral/offer") return ok({ offer: null });
    if (p === "/api/referral/offer-notifications") return ok({ data: [] });
    return ok({ success: true, awards: [] });
  };

  async function start(): Promise<string> {
    server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", async () => {
        const call: StubCall = { seq: ++seq, path: req.url ?? "", method: req.method ?? "GET", body: raw ? JSON.parse(raw) : {} };
        calls.push(call);
        try {
          if (hook) call.meta = await hook(call);
          const bare = call.path.split("?")[0];
          const found = [...overrides].reverse().find((o) => (typeof o.match === "string" ? o.match === bare || o.match === call.path : o.match.test(call.path)));
          const r = found ? (typeof found.reply === "function" ? await found.reply(call) : found.reply) : defaults(call.method, call.path);
          if (r === "drop") { req.socket.destroy(); return; }
          res.writeHead(r.status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(r.body));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  return {
    start,
    stop: () => new Promise<void>((r) => (server ? server.close(() => r()) : r())),
    calls,
    /** Calls whose path (without query) equals `p`. */
    to: (p: string) => calls.filter((c) => c.path.split("?")[0] === p),
    /** Replace the answer for a path (string = exact, RegExp = tested on the full path+query). Cleared by reset(). */
    on(match: string | RegExp, reply: Replier) { overrides.push({ match, reply }); },
    /** Run a function when each call arrives; its result is stored on `call.meta`. */
    onCall(fn: ((call: StubCall) => unknown | Promise<unknown>) | undefined) { hook = fn; },
    reset() { calls.length = 0; overrides = []; hook = undefined; },
  };
}

export type MitoStub = ReturnType<typeof createMitoStub>;

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Gives background (outbox / fire-and-forget) work time to reach the stub. */
export const flush = () => wait(150);

export interface ContractApp {
  base: string;
  stub: MitoStub;
  api: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;
  newTx: (over?: Record<string, unknown>) => Promise<any>;
  storage: typeof import("../../../../server/storage").storage;
  promo: typeof import("../../../../server/promo");
  bonus: typeof import("../../../../server/bonus");
  bonusHooks: typeof import("../../../../server/bonus/hooks");
  rewards: typeof import("../../../../server/rewardsService");
  close: () => Promise<void>;
}

/** Starts the Mito stub and a Rhemito Express app with the promo, bonus, rewards and send-money routes. */
export async function bootContractApp(): Promise<ContractApp> {
  const stub = createMitoStub();
  const mitoUrl = await stub.start();
  process.env.MITO_API_URL = mitoUrl;
  process.env.NODE_ENV = "test";

  const { storage } = await import("../../../../server/storage");
  const promo = await import("../../../../server/promo");
  const bonus = await import("../../../../server/bonus");
  const bonusHooks = await import("../../../../server/bonus/hooks");
  const rewards = await import("../../../../server/rewardsService");
  const { registerSendMoneyRoutes } = await import("../../../../server/sendMoneyRoutes");
  const { registerRewardsRoutes } = await import("../../../../server/rewardsRoutes");

  const e = express();
  e.use(express.json());
  promo.registerPromoRoutes(e);
  bonus.registerBonusRoutes(e);
  registerRewardsRoutes(e);
  registerSendMoneyRoutes(e);
  const app = e.listen(0, "127.0.0.1");
  await new Promise((r) => app.once("listening", r));
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;

  const api: ContractApp["api"] = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const newTx: ContractApp["newTx"] = async (over = {}) => {
    const res = await api("POST", "/api/send-money/transactions", {
      recipientName: "Ada Obi", service: "bank_deposit", sendCurrency: "GBP", sendAmount: "100.00", receiveCurrency: "NGN",
      receiveAmount: "202550.00", fee: "3.00", exchangeRate: "2025.50", ...over,
    });
    if (res.status !== 201) throw new Error(`could not create the test transaction: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data;
  };

  return {
    base, stub, api, newTx, storage, promo, bonus, bonusHooks, rewards,
    close: async () => { app.close(); await stub.stop(); },
  };
}

/** Resets everything a test could have changed, so rules do not depend on each other. */
export async function resetContractApp(ctx: ContractApp): Promise<void> {
  await flush(); // let the previous rule's fire-and-forget events land before the stub forgets them
  ctx.stub.reset();
  delete process.env.PROMO_ENABLED;
  delete process.env.BONUS_ENABLED;
  ctx.promo.promoOutbox.clear();
  ctx.bonus.bonusOutbox.clear();
  ctx.bonusHooks.__resetBonusSync();
  (await import("../../../../server/promo/routes")).__resetPromoRateLimit();
}

/**
 * While a test runs, relative browser URLs ("/api/...") are sent to the real Rhemito test server, so client code
 * (hooks, API helpers) is exercised against the real routes. Absolute URLs still go to the real fetch.
 * Returns a function that restores the original fetch.
 */
export function routeBrowserFetchTo(base: string): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: any, init?: any) => {
    const url = typeof input === "string" && input.startsWith("/") ? `${base}${input}` : input;
    return real(url, init);
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}
