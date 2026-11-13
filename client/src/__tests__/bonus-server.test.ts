// @vitest-environment node
/**
 * Rhemito bonus server module (BONUS_MODULE_SPEC_RHEMITO.md §5) against a stub Mito service.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import express from "express";

type Call = { path: string; method: string; body: any; headers: http.IncomingHttpHeaders };
const calls: Call[] = [];
let applyReply: { status: number; body: any } = { status: 200, body: { applied: 10, available: 5 } };
let walletReply: any = {};
let feedReply: any = { data: [], last_id: 0 };
let mito: http.Server;
let app: http.Server;
let base = "";

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const flush = () => new Promise((r) => setTimeout(r, 150));
const to = (p: string) => calls.filter((c) => c.path === p);

let storage: typeof import("../../../server/storage").storage;
let bonus: typeof import("../../../server/bonus");
let feed: typeof import("../../../server/bonus/feed");
let hooks: typeof import("../../../server/bonus/hooks");

beforeAll(async () => {
  mito = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      calls.push({ path: req.url ?? "", method: req.method ?? "", body, headers: req.headers });
      const send = (status: number, b: any) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(b)); };
      if (req.url?.endsWith("/apply")) return send(applyReply.status, applyReply.body);
      if (req.url?.endsWith("/release")) return send(200, { released: 10 });
      if (req.url?.startsWith("/api/wallet/")) return send(200, walletReply);
      if (req.url?.startsWith("/api/bonus/offers")) return send(200, [{ id: 1, name: "Send £50, get £5", type: "THRESHOLD", currency: "GBP", summary: "Send £50 or more", end_date: null, end_date_display: null }]);
      if (req.url?.startsWith("/api/bonus/feed")) {
        const since = Number(new URL(req.url, "http://x").searchParams.get("since_id") ?? 0);
        const data = (feedReply.data as any[]).filter((i) => i.id > since);
        return send(200, { data, last_id: data.length ? data[data.length - 1].id : since });
      }
      return send(200, { success: true, awards: [] });
    });
  });
  await new Promise<void>((r) => mito.listen(0, r));
  process.env.MITO_API_URL = `http://127.0.0.1:${(mito.address() as AddressInfo).port}`;
  process.env.NODE_ENV = "test";

  ({ storage } = await import("../../../server/storage"));
  bonus = await import("../../../server/bonus");
  feed = await import("../../../server/bonus/feed");
  hooks = await import("../../../server/bonus/hooks");
  const { registerSendMoneyRoutes } = await import("../../../server/sendMoneyRoutes");
  const e = express();
  e.use(express.json());
  bonus.registerBonusRoutes(e);
  registerSendMoneyRoutes(e);
  app = e.listen(0);
  await new Promise((r) => app.once("listening", r));
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});
afterAll(() => { app?.close(); mito?.close(); });

beforeEach(() => {
  calls.length = 0;
  applyReply = { status: 200, body: { applied: 10, available: 5 } };
  walletReply = {
    bonus_blocked: false,
    balances: [{ currency: "GBP", available: 15, earned: 20, used: 5, expired: 0, by_source: [{ credit_source: "REFERRAL", label: "Referrals", earned: 5, used: 0, expired: 0, removed: 0, available: 5 }] }, { currency: "USD", available: 0, earned: 0 }],
    unused: [], credits: [], history: [], promo_redemptions: [],
  };
  feedReply = { data: [], last_id: 0 };
  delete process.env.BONUS_ENABLED;
  bonus.bonusOutbox.clear();
  hooks.__resetBonusSync();
  feed.__resetFeed();
});

async function newTx(over: Record<string, unknown> = {}) {
  const res = await api("POST", "/api/send-money/transactions", {
    recipientName: "Ada Obi", service: "bank_deposit", sendCurrency: "GBP", sendAmount: "100.00", receiveCurrency: "NGN",
    receiveAmount: "202550.00", fee: "3.00", exchangeRate: "2025.50", ...over,
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

describe("B-10 transfer events", () => {
  it("sends PAID then COMPLETED when a transfer is paid, with the agreed body", async () => {
    const tx = await newTx();
    await api("POST", `/api/send-money/transactions/${tx.id}/pay`, { paymentMethod: "card" });
    await flush();
    const events = to("/api/bonus/transfer-events").map((c) => c.body);
    expect(events.map((e) => e.status)).toEqual(["PAID", "COMPLETED"]);
    expect(events[0]).toMatchObject({ transfer_id: tx.reference, customer_id: "user_123", amount: 100, currency: "GBP", receive_currency: "NGN" });
  });

  it("B-13 still sends the old referral event", async () => {
    const tx = await newTx();
    await api("POST", `/api/send-money/transactions/${tx.id}/pay`, { paymentMethod: "card" });
    await flush();
    expect(to("/api/referral/transfer-events").length).toBeGreaterThan(0);
  });

  it("sends CANCELLED when a transfer is cancelled", async () => {
    const tx = await newTx();
    await api("POST", `/api/send-money/transactions/${tx.id}/cancel`);
    await flush();
    expect(to("/api/bonus/transfer-events").map((c) => c.body.status)).toEqual(["CANCELLED"]);
  });

  it("sends nothing when the module is switched off", async () => {
    process.env.BONUS_ENABLED = "false";
    const tx = await newTx();
    await api("POST", `/api/send-money/transactions/${tx.id}/pay`, { paymentMethod: "card" });
    await flush();
    expect(to("/api/bonus/transfer-events")).toHaveLength(0);
  });
});

describe("B-20 – B-24 pay with bonus", () => {
  it("uses the bonus once, in the transfer's currency, and saves it on the transaction", async () => {
    const tx = await newTx();
    const r = await api("POST", `/api/send-money/transactions/${tx.id}/pay`, { paymentMethod: "card", bonusCredit: { mode: "pay_less", amount: "10.00" } });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: "completed", bonusCredit: "10.00", bonusCreditMode: "pay_less" });
    const apply = to("/api/wallet/user_123/apply")[0].body;
    expect(apply).toEqual({ amount: 10, currency: "GBP", transfer_id: tx.reference, send_amount: 100 });
  });

  it("does not call Mito when no bonus is chosen", async () => {
    const tx = await newTx();
    const r = await api("POST", `/api/send-money/transactions/${tx.id}/pay`, { paymentMethod: "card" });
    expect(r.body.data.bonusCredit).toBeNull();
    expect(to("/api/wallet/user_123/apply")).toHaveLength(0);
  });

  it("BALANCE_CHANGED stops the payment with BONUS_CHANGED", async () => {
    applyReply = { status: 409, body: { error: "BALANCE_CHANGED", message: "x", available: 3 } };
    const tx = await newTx();
    const r = await api("POST", `/api/send-money/transactions/${tx.id}/pay`, { paymentMethod: "card", bonusCredit: { mode: "pay_less", amount: "10.00" } });
    expect(r.status).toBe(409);
    expect(r.body.error).toEqual({ code: "BONUS_CHANGED", message: "Your bonus balance has changed. Please review your transfer." });
    expect((await storage.getSendMoneyTransactionById(tx.id))!.status).toBe("awaiting_payment");
  });

  it("ALREADY_APPLIED is treated as success (retry)", async () => {
    applyReply = { status: 409, body: { error: "ALREADY_APPLIED", message: "done" } };
    const tx = await newTx();
    const r = await api("POST", `/api/send-money/transactions/${tx.id}/pay`, { paymentMethod: "card", bonusCredit: { mode: "send_more", amount: "10.00" } });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ bonusCredit: "10.00", bonusCreditMode: "send_more" });
  });

  it("refuses a bonus bigger than the send amount without calling Mito", async () => {
    const tx = await newTx();
    const r = await api("POST", `/api/send-money/transactions/${tx.id}/pay`, { paymentMethod: "card", bonusCredit: { mode: "pay_less", amount: "100.01" } });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toBe("Bonus cannot be more than the amount you send.");
    expect(to("/api/wallet/user_123/apply")).toHaveLength(0);
  });

  it("Mito down: 503 with the choose-another-option text and the transfer stays unpaid", async () => {
    const saved = process.env.MITO_API_URL;
    const tx = await newTx();
    mito.close();
    const r = await api("POST", `/api/send-money/transactions/${tx.id}/pay`, { paymentMethod: "card", bonusCredit: { mode: "pay_less", amount: "10.00" } });
    expect(r.status).toBe(503);
    expect(r.body.error.message).toBe(`Bonus credit can't be used right now. Choose "Don't use bonus" to continue, or try again shortly.`);
    expect((await storage.getSendMoneyTransactionById(tx.id))!.status).toBe("awaiting_payment");
    await new Promise<void>((resolve) => mito.listen(Number(new URL(saved!).port), resolve));
  });
});

describe("B-50 / B-51 browser endpoints", () => {
  it("summary returns the wallet, the currencies with any balance, blocked flag and offers", async () => {
    const r = await api("GET", "/api/bonus/summary?currency=GBP");
    expect(r.status).toBe(200);
    expect(r.body.data.currency).toBe("GBP");
    expect(r.body.data.currencies).toEqual(["GBP"]);
    expect(r.body.data.blocked).toBe(false);
    expect(r.body.data.wallet.balances[0].by_source[0].credit_source).toBe("REFERRAL");
    expect(r.body.data.offers[0].name).toBe("Send £50, get £5");
  });

  it("the source filter goes to Mito and totals still come from an unfiltered call", async () => {
    const r = await api("GET", "/api/bonus/summary?currency=GBP&source=REFERRAL");
    expect(r.status).toBe(200);
    const walletCalls = calls.filter((c) => c.path.startsWith("/api/wallet/user_123")).map((c) => c.path);
    expect(walletCalls).toContain("/api/wallet/user_123?currency=GBP&credit_source=REFERRAL");
    expect(walletCalls).toContain("/api/wallet/user_123");
  });

  it("checks input", async () => {
    expect((await api("GET", "/api/bonus/summary?source=NOPE")).status).toBe(400);
    expect((await api("GET", "/api/bonus/summary?currency=POUNDS")).status).toBe(400);
    expect((await api("GET", "/api/bonus/wallet?currency=12")).status).toBe(400);
  });

  it("wallet returns Mito's wallet and flags the module switch", async () => {
    expect((await api("GET", "/api/bonus/wallet?currency=GBP")).body.data.balances).toHaveLength(2);
    process.env.BONUS_ENABLED = "false";
    expect((await api("GET", "/api/bonus/wallet")).status).toBe(404);
  });
});

describe("B-30 customer sync", () => {
  it("sends the customer once and debounces repeats", async () => {
    await hooks.syncCustomer("user_123");
    await hooks.syncCustomer("user_123");
    await flush();
    expect(to("/api/bonus/customers")).toHaveLength(1);
    expect(to("/api/bonus/customers")[0].body).toMatchObject({ id: "user_123", send_currency: "GBP" });
  });
});

describe("B-40 – B-41 feed", () => {
  const item = (id: number, type: string, payload: any) => ({ id, customer_id: "user_123", type, payload, created_at: "2026-10-01T10:00:00Z" });

  it("copy for each feed type, with the referral line only when mixed", () => {
    const earned = feed.noteFor(item(1, "BONUS_EARNED", { credit_source: "SCHEME", scheme_name: "Spring", amount: 5, currency: "GBP", expires_on: "2026-12-31" }))!;
    expect(earned).toEqual({ type: "bonus_earned", title: "You've earned £5.00 bonus credit", body: "Bonus earned: Spring. £5.00 bonus credit is ready to use on your next transfer by 31/12/2026." });
    expect(feed.noteFor(item(2, "BONUS_EARNED", { credit_source: "MANUAL", amount: 5, currency: "GBP", expires_on: "2026-12-31" }))!.body).toBe("Rhemito has added £5.00 bonus credit to your account. Use it by 31/12/2026.");
    const used = feed.noteFor(item(3, "BONUS_USED", { amount: 10, currency: "GBP", transfer_id: "TXN-1", by_source: [{ credit_source: "REFERRAL", amount: 4 }, { credit_source: "SCHEME", amount: 6 }] }))!;
    expect(used.body).toBe("£10.00 bonus credit was used on transfer TXN-1. Includes £4.00 from referrals.");
    expect(feed.noteFor(item(4, "BONUS_USED", { amount: 10, currency: "GBP", transfer_id: "TXN-1", by_source: [{ credit_source: "SCHEME", amount: 10 }] }))!.body).toBe("£10.00 bonus credit was used on transfer TXN-1.");
    expect(feed.noteFor(item(5, "BONUS_BLOCK_LIFTED", {}))!.type).toBe("bonus_unblocked");
    expect(feed.noteFor(item(6, "SOMETHING_NEW", {}))).toBeNull();
  });

  it("does not replay history on first start, then notifies new items once", async () => {
    feedReply = { data: [item(1, "BONUS_USED", { amount: 1, currency: "GBP", transfer_id: "T0" })], last_id: 1 };
    expect(await feed.pollFeed()).toBe(0); // first start: cursor jumps to the end
    feedReply.data.push(item(2, "BONUS_EXPIRED", { amount: 2, currency: "GBP", expired_on: "2026-10-01" }));
    expect(await feed.pollFeed()).toBe(1);
    expect(await feed.pollFeed()).toBe(0);
  });
});
