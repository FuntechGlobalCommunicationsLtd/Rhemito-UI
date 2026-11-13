/**
 * Promo Code contracts (PROMO-*). Promo codes belong to Mito; Rhemito forwards checks, records the use at payment
 * and shows the result. These rules pin how the discount is applied, when it is re-checked, and how errors surface.
 *
 * The browser hook (usePromoCode) is run against the real Rhemito routes, which talk to a stub Mito service.
 */
import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, vi } from "vitest";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bootContractApp, flush, resetContractApp, routeBrowserFetchTo, wait, type ContractApp } from "./_mitoStub";
import { countMatches, rule, source } from "./_contract";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }), toast }));

import { PromoCodeField, PROMO_COPY, usePromoCode } from "@/features/promo";
import { effectiveFee, isCodeFormatOk, normaliseCode, shouldRevalidate, totalToPay } from "@/features/promo/lib/promo";
import { paySendMoneyTransaction } from "@/lib/sendMoney";

let ctx: ContractApp;
let restoreFetch: () => void;
beforeAll(async () => {
  ctx = await bootContractApp();
  restoreFetch = routeBrowserFetchTo(ctx.base);
});
afterAll(async () => { restoreFetch(); await ctx.close(); });
beforeEach(async () => { await resetContractApp(ctx); toast.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); });

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
};
const INPUT = { amount: 100, fee: 3, sendCurrency: "GBP", receiveCurrency: "NGN", paymentMethod: null as string | null };
const validateCalls = () => ctx.stub.to("/api/promocodes/validate");
const pay = (id: string, body: Record<string, unknown>) => ctx.api("POST", `/api/send-money/transactions/${id}/pay`, body);

/** Types a code and presses Apply; resolves when the hook has settled. */
async function applyCode(hook: ReturnType<typeof renderHook<ReturnType<typeof usePromoCode>, typeof INPUT>>, code = "SAVE5") {
  act(() => hook.result.current.setCode(code));
  await act(async () => { await hook.result.current.apply(); });
}
const mount = (input = INPUT) => renderHook((p: typeof INPUT) => usePromoCode(p), { initialProps: input, wrapper });

describe("How the discount is applied", () => {
  rule("PROMO-01", "A promo discount comes off the FEE only (never the send amount) and never exceeds the fee", {
    why: "Promo codes are fee promotions. Taking money off the send amount would change what the recipient gets; a discount bigger than the fee would pay the customer to send.",
    fix: "Client: effectiveFee = max(0, fee - discount) (features/promo/lib/promo.ts, SendMoney.tsx). Server: promo.applyForPayment stores feeMinor = feeBefore - min(shownDiscount, feeBefore) and promoDiscountMinor = min(...); sendAmount is untouched.",
    where: ["client/src/features/promo/lib/promo.ts", "client/src/pages/SendMoney.tsx", "server/promo/hooks.ts"],
  }, async () => {
    expect(effectiveFee(3, 1)).toBe(2);
    expect(effectiveFee(1, 5)).toBe(0);
    expect(totalToPay(100, 3, 1)).toBe(102);
    expect(source("client/src/pages/SendMoney.tsx")).toMatch(/const effectiveFee = Math\.max\(0, fee - \(promoApplied(?: && !promoOnAmount)? \? promoDiscount : 0\)\)/);

    // Mito approves a £10 discount on a £3 fee: only the £3 fee can be discounted
    ctx.stub.on("/api/promocodes/validate", { status: 200, body: { valid: true, appliedDiscount: 10 } });
    const tx = await ctx.newTx();
    const r = await pay(tx.id, { paymentMethod: "card", promoCode: "BIG", promoDiscount: "10.00" });
    expect(r.body.data).toMatchObject({ sendAmount: "100.00", fee: "0.00", promoDiscount: "3.00", promoCode: "BIG" });
  });

  rule("PROMO-02", "The server only honours a discount Mito approves at payment time: a bigger discount than approved stops the payment (PROMO_CHANGED)", {
    why: "The customer saw a price with a discount. If Mito now approves less, charging a different price silently would be wrong, and honouring a larger one would give away money.",
    fix: "promo.applyForPayment re-validates with Mito, compares the discount the customer was shown with appliedDiscount and throws PromoPaymentError(409, 'PROMO_CHANGED') when shown > approved, BEFORE redeemPromo. A smaller shown discount is recorded as shown.",
    where: ["server/promo/hooks.ts"],
  }, async () => {
    ctx.stub.on("/api/promocodes/validate", { status: 200, body: { valid: true, appliedDiscount: 0.5 } });
    const tx = await ctx.newTx();
    const r = await pay(tx.id, { paymentMethod: "card", promoCode: "SAVE5", promoDiscount: "1.00" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("PROMO_CHANGED");
    expect(ctx.stub.to("/api/promocodes/redeem")).toHaveLength(0);

    ctx.stub.reset();
    ctx.stub.on("/api/promocodes/validate", { status: 200, body: { valid: true, appliedDiscount: 2 } });
    const r2 = await pay(tx.id, { paymentMethod: "card", promoCode: "SAVE5", promoDiscount: "1.00" });
    expect(r2.body.data).toMatchObject({ promoDiscount: "1.00", fee: "2.00" });
  });

  rule("PROMO-03", "Promo fails closed: when Mito cannot be reached no code is accepted, at validate time or at payment", {
    why: "An unreachable Mito cannot confirm the code is real, unused and eligible. Accepting it would give out discounts that may not exist.",
    fix: "server/promo/client.ts callMito turns a network failure into { ok:false, status:503, code:'PROMO_UNAVAILABLE' }. The validate route returns that status; applyForPayment throws PromoPaymentError(503, 'PROMO_REJECTED', '<unavailable text> Go back and remove the promo code to continue.') and the transfer stays unpaid.",
    where: ["server/promo/client.ts", "server/promo/routes.ts", "server/promo/hooks.ts"],
  }, async () => {
    ctx.stub.on("/api/promocodes/validate", "drop");
    const v = await ctx.api("POST", "/api/promocodes/validate", { code: "SAVE5", amount: 100, fee: 3 });
    expect(v.status).toBe(503);
    expect(v.body).toMatchObject({ code: "PROMO_UNAVAILABLE", error: PROMO_COPY.unavailable });

    const tx = await ctx.newTx();
    const r = await pay(tx.id, { paymentMethod: "card", promoCode: "SAVE5", promoDiscount: "1.00" });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("PROMO_REJECTED");
    expect(r.body.error.message).toContain("Go back and remove the promo code to continue.");
    expect((await ctx.storage.getSendMoneyTransactionById(tx.id))!.status).toBe("awaiting_payment");
  });

  rule("PROMO-04", "The discount and message shown come from Mito's answer; the browser never works out a discount itself", {
    why: "Promo rules (percent, cap, eligibility, payment-method limits) live in Mito. A locally computed discount would drift from what Mito charges at payment.",
    fix: "usePromoCode.validateCode posts to /api/promocodes/validate and uses body.appliedDiscount and body.displayText as the discount and message; it shows the 'Promo code applied' toast.",
    where: ["client/src/features/promo/usePromoCode.ts", "server/promo/routes.ts"],
  }, async () => {
    ctx.stub.on("/api/promocodes/validate", { status: 200, body: { valid: true, appliedDiscount: 1.75, appliesTo: "fee", displayText: "17.5% off your fee", currency: "GBP" } });
    const hook = mount();
    await applyCode(hook, "save5");
    expect(hook.result.current).toMatchObject({ state: "applied", applied: true, appliedCode: "SAVE5", discount: 1.75, message: "17.5% off your fee" });
    expect(toast).toHaveBeenCalledWith({ title: PROMO_COPY.appliedToast, description: "17.5% off your fee" });
    expect(validateCalls()[0].body).toMatchObject({ code: "SAVE5", amount: 100, fee: 3, currency: "GBP", destCurrency: "NGN", userId: "user_123" });
  });
});

describe("Re-validation, and the lock that prevents 'already used'", () => {
  rule("PROMO-05", "An applied code is re-validated (debounced) when amount, fee, currency or payment method changes; if Mito now refuses it the discount is dropped with a destructive 'Promo code removed' toast", {
    why: "A promo can depend on the amount, corridor or payment method. If the transfer changes after applying, the customer must not keep a discount that no longer applies.",
    fix: "usePromoCode has an effect that, while state === 'applied' and not locked, calls run(code, inputs, { revalidate: true }) 400 ms after shouldRevalidate() says an input changed. On rejection it sets discount 0 and toasts { title: PROMO_COPY.removedToast, variant: 'destructive' }.",
    where: ["client/src/features/promo/usePromoCode.ts", "client/src/features/promo/lib/promo.ts"],
    timeout: 10_000,
  }, async () => {
    const base = { amount: 100, fee: 3, sendCurrency: "GBP", receiveCurrency: "NGN", paymentMethod: null };
    expect(shouldRevalidate(base, { ...base, amount: 50 })).toBe(true);
    expect(shouldRevalidate(base, { ...base, fee: 2 })).toBe(true);
    expect(shouldRevalidate(base, { ...base, sendCurrency: "USD" })).toBe(true);
    expect(shouldRevalidate(base, { ...base, receiveCurrency: "GHS" })).toBe(true);
    expect(shouldRevalidate(base, { ...base, paymentMethod: "card" })).toBe(true);
    expect(shouldRevalidate(base, { ...base })).toBe(false);

    const hook = mount();
    await applyCode(hook);
    expect(validateCalls()).toHaveLength(1);
    ctx.stub.on("/api/promocodes/validate", { status: 400, body: { error: "This code is not valid for card payments.", code: "PAYMENT_METHOD_NOT_ALLOWED" } });
    hook.rerender({ ...INPUT, paymentMethod: "card" });
    await waitFor(() => expect(hook.result.current.state).toBe("rejected"), { timeout: 3000 });
    expect(hook.result.current.discount).toBe(0);
    expect(hook.result.current.message).toBe("This code is not valid for card payments.");
    expect(toast).toHaveBeenCalledWith({ title: PROMO_COPY.removedToast, description: "This code is not valid for card payments.", variant: "destructive" });
  });

  rule("PROMO-06", "The payment method is sent to Mito only once the customer has chosen one", {
    why: "Some codes are limited to certain payment methods. Before a method is chosen there is nothing to check, and sending an empty method could wrongly reject the code.",
    fix: "usePromoCode.validateCode spreads { paymentMethod } into the request only when input.paymentMethod is set; server/promo/routes.ts forwards it only when present. On change, the re-validation includes it.",
    where: ["client/src/features/promo/usePromoCode.ts", "server/promo/routes.ts"],
    timeout: 10_000,
  }, async () => {
    const hook = mount();
    await applyCode(hook);
    expect(validateCalls()[0].body).not.toHaveProperty("paymentMethod");
    hook.rerender({ ...INPUT, paymentMethod: "card" });
    await waitFor(() => expect(validateCalls()).toHaveLength(2), { timeout: 3000 });
    expect(validateCalls()[1].body).toMatchObject({ paymentMethod: "card" });
  });

  rule("PROMO-07", "Once payment starts the code is LOCKED: it is not re-validated, because the server redeems it at pay time", {
    why: "Choosing a payment method pays the transfer, and the server records the promo use. A browser re-check after that would see the code as already used by this very payment and wrongly remove the discount.",
    fix: "usePromoCode exposes lock(); SendMoney.tsx calls `if (promoApplied) promo.lock()` immediately before EVERY paySendMoneyTransaction call (payment-method click and manual-transfer confirm). While locked the re-validation effect returns early. remove(), setCode() and reject() unlock.",
    where: ["client/src/features/promo/usePromoCode.ts", "client/src/pages/SendMoney.tsx"],
    timeout: 10_000,
  }, async () => {
    const hook = mount();
    await applyCode(hook);
    act(() => hook.result.current.lock());
    hook.rerender({ ...INPUT, paymentMethod: "card" });
    await wait(900); // longer than the 400 ms debounce
    expect(validateCalls()).toHaveLength(1);
    expect(hook.result.current.state).toBe("applied");

    // reject() (server refused at pay time) unlocks, so a re-applied code is re-validated again
    act(() => hook.result.current.reject("This promo code can no longer be used."));
    expect(hook.result.current).toMatchObject({ state: "rejected", discount: 0, appliedCode: null, message: "This promo code can no longer be used." });
    await act(async () => { await hook.result.current.apply(); });
    expect(hook.result.current.state).toBe("applied");
    const before = validateCalls().length;
    hook.rerender({ ...INPUT, paymentMethod: "instant_bank" });
    await waitFor(() => expect(validateCalls().length).toBe(before + 1), { timeout: 3000 });

    const page = source("client/src/pages/SendMoney.tsx");
    const paySites = countMatches(page, /await paySendMoneyTransaction\(/);
    expect(
      countMatches(
        page,
        /if \(promoApplied\) promo\.lock\(\);\s*(?:[A-Za-z_$][\w$]*\s*=\s*)?await paySendMoneyTransaction\(/,
      ),
    ).toBe(paySites);
  });

  rule("PROMO-08", "NEGATIVE (fixed bug): a promo used for the first time never shows 'You have already used this promo code' after the customer picks a payment method", {
    why: "Mito records the use at payment. The page used to re-validate the code afterwards, Mito answered ALREADY_USED, and the customer saw an error and lost the discount on a payment that succeeded.",
    fix: "Keep promo.lock() before paying (see PROMO-07) and never validate a locked code. The server validates once and redeems once per payment (validate -> redeem), so Mito sees the code as unused when asked.",
    where: ["client/src/features/promo/usePromoCode.ts", "client/src/pages/SendMoney.tsx", "server/promo/hooks.ts"],
    timeout: 10_000,
  }, async () => {
    let used = false;
    ctx.stub.on("/api/promocodes/redeem", () => { used = true; return { status: 200, body: { success: true, discount: 1 } }; });
    ctx.stub.on("/api/promocodes/validate", () => (used
      ? { status: 400, body: { error: "You have already used this promo code.", code: "ALREADY_USED" } }
      : { status: 200, body: { valid: true, appliedDiscount: 1, displayText: "£1.00 off your fee" } }));

    const hook = mount();
    await applyCode(hook);
    const tx = await ctx.newTx();
    act(() => hook.result.current.lock());
    // same sequence the page runs when a payment method is clicked
    const paid = await paySendMoneyTransaction(tx.id, "card", { code: hook.result.current.appliedCode!, discount: hook.result.current.discount });
    expect(paid.status).toBe("completed");
    expect(used).toBe(true);
    toast.mockClear();
    hook.rerender({ ...INPUT, paymentMethod: "card" });
    await wait(900);
    expect(hook.result.current).toMatchObject({ state: "applied", discount: 1 });
    expect(hook.result.current.message).not.toMatch(/already used/i);
    expect(toast).not.toHaveBeenCalled();
    // exactly one check before the redeem (apply) and one at pay time; none afterwards
    expect(validateCalls()).toHaveLength(2);
  });
});

describe("Errors and messages", () => {
  rule("PROMO-09", "Mito's refusal is shown as the customer's message: 503 = 'unavailable', other errors = 'rejected', network failure = the standard unavailable text", {
    why: "Customers need to know whether the code is wrong (change it) or the service is down (try later). The message text is written by Mito, so it must be passed through unchanged.",
    fix: "usePromoCode.validateCode: body.error string (or body.error.message) is the message; status 503 -> state 'unavailable', other statuses -> 'rejected'; a thrown fetch -> { status:503, message: PROMO_COPY.unavailable }. server/promo/routes.ts returns { error: <Mito text>, code } with Mito's status.",
    where: ["client/src/features/promo/usePromoCode.ts", "server/promo/routes.ts", "server/promo/client.ts"],
    timeout: 10_000,
  }, async () => {
    ctx.stub.on("/api/promocodes/validate", { status: 400, body: { error: "This promo code has expired.", code: "EXPIRED" } });
    const a = mount();
    await applyCode(a, "OLD");
    expect(a.result.current).toMatchObject({ state: "rejected", message: "This promo code has expired.", discount: 0 });

    ctx.stub.reset();
    ctx.stub.on("/api/promocodes/validate", "drop");
    const b = mount();
    await applyCode(b, "SAVE5");
    expect(b.result.current).toMatchObject({ state: "unavailable", message: PROMO_COPY.unavailable });

    // a browser that cannot reach Rhemito at all
    const real = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new TypeError("offline"))) as typeof fetch;
    try {
      const c = mount();
      await applyCode(c, "SAVE5");
      expect(c.result.current).toMatchObject({ state: "unavailable", message: PROMO_COPY.unavailable });
    } finally {
      globalThis.fetch = real;
    }
  });

  rule("PROMO-10", "Pay-time promo errors always carry a PROMO_* code; the page turns them into a rejected field and a destructive 'Payment not made' toast", {
    why: "The page recognises promo problems by the PROMO_ prefix (so it can show them on the promo field and let the customer remove the code). Any other code would fall into the generic 'Payment not completed' handler and lose that guidance.",
    fix: "Server: PromoPaymentError codes are PROMO_REJECTED (409, or 503 when Mito is unreachable) and PROMO_CHANGED (409). Browser: SendMoney.tsx catches SendMoneyApiError with code.startsWith('PROMO_') -> promo.reject(message), setPaymentMethod(''), toast({ title: 'Payment not made', variant: 'destructive' }).",
    where: ["server/promo/hooks.ts", "client/src/pages/SendMoney.tsx", "client/src/features/promo/usePromoCode.ts"],
  }, async () => {
    const tx = await ctx.newTx();
    ctx.stub.on("/api/promocodes/validate", { status: 400, body: { error: "This promo code has expired.", code: "EXPIRED" } });
    const rejected = await pay(tx.id, { paymentMethod: "card", promoCode: "OLD", promoDiscount: "1.00" });
    expect(rejected.body.error.code).toBe("PROMO_REJECTED");
    ctx.stub.reset();
    ctx.stub.on("/api/promocodes/validate", { status: 200, body: { valid: true, appliedDiscount: 0.1 } });
    const changed = await pay(tx.id, { paymentMethod: "card", promoCode: "OLD", promoDiscount: "1.00" });
    expect(changed.body.error.code).toBe("PROMO_CHANGED");
    ctx.stub.reset();
    ctx.stub.on("/api/promocodes/redeem", { status: 409, body: { error: "This promo code has reached its limit.", code: "FULLY_REDEEMED" } });
    const redeemRefused = await pay(tx.id, { paymentMethod: "card", promoCode: "OLD", promoDiscount: "1.00" });
    expect(redeemRefused.body.error.code).toBe("PROMO_REJECTED");
    expect(redeemRefused.body.error.message).toBe("This promo code has reached its limit. Go back and remove the promo code to continue.");

    const page = source("client/src/pages/SendMoney.tsx");
    expect(countMatches(page, /promo\.reject\(e\.message\)/)).toBeGreaterThanOrEqual(2);
  });

  rule("PROMO-11", "Editing the code clears the applied discount; Remove clears everything and tells the customer", {
    why: "A discount must always belong to the code currently in the box. Leaving it applied after the text changed would charge a discount for a different (unchecked) code.",
    fix: "usePromoCode.setCode upper-cases the text and resets state to 'idle' with discount 0 when a code was applied; remove() resets all state, unlocks and toasts PROMO_COPY.removedToast.",
    where: ["client/src/features/promo/usePromoCode.ts"],
  }, async () => {
    const hook = mount();
    await applyCode(hook);
    expect(hook.result.current.discount).toBe(1);
    act(() => hook.result.current.setCode("SAVE50"));
    expect(hook.result.current).toMatchObject({ state: "idle", discount: 0, appliedCode: null, code: "SAVE50" });
    await act(async () => { await hook.result.current.apply(); });
    toast.mockClear();
    act(() => hook.result.current.remove());
    expect(hook.result.current).toMatchObject({ state: "idle", discount: 0, code: "" });
    expect(toast).toHaveBeenCalledWith({ title: PROMO_COPY.removedToast });
  });

  rule("PROMO-12", "An empty or badly formatted code is rejected in the browser without calling Mito", {
    why: "Saves a round trip and protects Mito's rate limit; the message tells the customer what to fix.",
    fix: "usePromoCode.run: empty -> PROMO_COPY.empty; not matching /^[A-Z0-9-]{1,20}$/ -> 'Enter a valid promo code.'. Codes are trimmed and upper-cased (normaliseCode).",
    where: ["client/src/features/promo/usePromoCode.ts", "client/src/features/promo/lib/promo.ts"],
  }, async () => {
    expect(normaliseCode("  save-20 ")).toBe("SAVE-20");
    expect(isCodeFormatOk("save-20")).toBe(true);
    expect(isCodeFormatOk("bad code")).toBe(false);
    expect(isCodeFormatOk("A".repeat(21))).toBe(false);
    const hook = mount();
    await applyCode(hook, "bad code!");
    expect(hook.result.current).toMatchObject({ state: "rejected", message: "Enter a valid promo code." });
    act(() => hook.result.current.setCode(""));
    await act(async () => { await hook.result.current.apply(); });
    expect(hook.result.current.message).toBe(PROMO_COPY.empty);
    expect(validateCalls()).toHaveLength(0);
  });
});

describe("Server rules for validate, flag and savings", () => {
  rule("PROMO-13", "Validate uses the signed-in customer (never the body), checks input before calling Mito, and is rate limited to 20 per minute", {
    why: "A customer must not validate codes as someone else, and an attacker must not be able to guess codes quickly.",
    fix: "server/promo/routes.ts POST /api/promocodes/validate: userId = session user (demo user in prototype), CODE_RE /^[A-Z0-9-]{1,20}$/, amount must be > 0, rateLimited() allows 20 per user per minute then returns 429 RATE_LIMITED.",
    where: ["server/promo/routes.ts"],
  }, async () => {
    const r = await ctx.api("POST", "/api/promocodes/validate", { code: "save5", amount: 100, fee: 3, currency: "gbp", userId: "HACKER" });
    expect(r.status).toBe(200);
    expect(ctx.stub.to("/api/promocodes/validate")[0].body).toMatchObject({ code: "SAVE5", userId: "user_123", currency: "GBP" });
    expect((await ctx.api("POST", "/api/promocodes/validate", { code: "bad code", amount: 100 })).body.error).toBe("Enter a valid promo code.");
    expect((await ctx.api("POST", "/api/promocodes/validate", { code: "OK", amount: 0 })).body.error).toBe("Enter the amount you're sending first.");
    let last = { status: 0 };
    for (let i = 0; i < 21; i++) last = await ctx.api("POST", "/api/promocodes/validate", { code: "OK", amount: 10 });
    expect(last.status).toBe(429);
  });

  rule("PROMO-14", "When promo codes are switched off the field is hidden, validate is 404 and a pay request's promo fields are ignored", {
    why: "PROMO_ENABLED is the kill switch. A hidden feature must not still discount payments.",
    fix: "server/promo/client.ts promoEnabled(); /api/promocodes/status returns { enabled }; validate returns 404 PROMO_DISABLED; promo.applyForPayment returns null; PromoCodeField returns null when promo.enabled is false.",
    where: ["server/promo/client.ts", "server/promo/routes.ts", "server/promo/hooks.ts", "client/src/features/promo/PromoCodeField.tsx"],
  }, async () => {
    process.env.PROMO_ENABLED = "false";
    expect((await ctx.api("GET", "/api/promocodes/status")).body.data.enabled).toBe(false);
    expect((await ctx.api("POST", "/api/promocodes/validate", { code: "SAVE5", amount: 100 })).status).toBe(404);
    const tx = await ctx.newTx();
    const r = await pay(tx.id, { paymentMethod: "card", promoCode: "SAVE5", promoDiscount: "1.00" });
    expect(r.body.data).toMatchObject({ promoCode: null, fee: "3.00" });
    expect(ctx.stub.to("/api/promocodes/redeem")).toHaveLength(0);

    const hidden = render(React.createElement(PromoCodeField, { promo: { enabled: false } as any }));
    expect(hidden.container.innerHTML).toBe("");
    hidden.unmount();
    const shown = render(React.createElement(PromoCodeField, { promo: { enabled: true, state: "rejected", code: "X", message: "Nope", applied: false, setCode: () => {}, apply: () => {}, remove: () => {} } as any }));
    expect(shown.getByTestId("promo-code-input")).toBeTruthy();
    expect(shown.getByRole("alert").textContent).toContain("Nope");
    shown.unmount();
  });

  rule("PROMO-15", "A code saved on the transaction is re-checked against the fee BEFORE the promo, and a fee-before-promo lower than the fee charged is refused", {
    why: "The stored fee is already discounted. Sending that smaller fee to Mito would make it compute a smaller discount, and a 'before promo' fee below the charged fee would be nonsense data.",
    fix: "POST /api/send-money/transactions returns 400 VALIDATION_ERROR when feeBeforePromo < fee. applyForPayment uses tx.feeBeforePromoMinor (falling back to feeMinor) as the fee sent to Mito and as the base of the stored discount.",
    where: ["server/sendMoneyRoutes.ts", "server/promo/hooks.ts"],
  }, async () => {
    const bad = await ctx.api("POST", "/api/send-money/transactions", {
      recipientName: "Ada Obi", service: "bank_deposit", sendCurrency: "GBP", sendAmount: "100.00", receiveCurrency: "NGN",
      receiveAmount: "202550.00", fee: "3.00", exchangeRate: "2025.50", promoCode: "SAVE5", feeBeforePromo: "2.00",
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");

    const tx = await ctx.newTx({ fee: "2.00", promoCode: "SAVE5", feeBeforePromo: "3.00" });
    const r = await pay(tx.id, { paymentMethod: "instant_bank" });
    expect(ctx.stub.to("/api/promocodes/validate")[0].body.fee).toBe(3);
    expect(r.body.data).toMatchObject({ promoCode: "SAVE5", fee: "2.00", promoDiscount: "1.00" });
  });

  rule("PROMO-16", "Bonus & Discounts lists only promo uses that are Redeemed (released or failed uses are not savings)", {
    why: "A use given back after a failed payment did not save the customer anything; listing it would overstate savings.",
    fix: "server/promo/routes.ts GET /api/promocodes/savings keeps rows with status === 'Redeemed' and maps them to { id, code, amount, currency, transferId, createdAt }.",
    where: ["server/promo/routes.ts"],
  }, async () => {
    ctx.stub.on(/^\/api\/promocodes\/customers\//, { status: 200, body: { data: [
      { id: "a", code: "SAVE5", transaction_id: "T1", discount: 5, currency: "GBP", status: "Redeemed", created_at: "2026-10-01T10:00:00Z" },
      { id: "b", code: "OLD", transaction_id: "T2", discount: 2, currency: "GBP", status: "Released", created_at: "2026-10-02T10:00:00Z" },
    ], summary: { saved: { GBP: 5 } } } });
    const r = await ctx.api("GET", "/api/promocodes/savings");
    expect(r.body.data.items.map((i: any) => i.code)).toEqual(["SAVE5"]);
    expect(r.body.data.items[0]).toEqual({ id: "a", code: "SAVE5", amount: 5, currency: "GBP", transferId: "T1", createdAt: "2026-10-01T10:00:00Z" });
    await flush();
  });
});
