import { describe, it, expect } from "vitest";
import {
  amountConverted, availableParts, balanceFor, breakdownRows, creditToApply, daysUntil, describeCredit, expiringSoon, expiryLabel,
  formatMoney, formatUkDate, sourceGroupLabel, totalToPay, bySource,
} from "@/features/bonus";
import { BONUS_COPY } from "@/features/bonus";

const base = { currency: "GBP", used_transfer_count: 0, referral_credit_count: 0, other_credit_count: 0, used: 0, expired: 0 };
const grp = (credit_source: "REFERRAL" | "SCHEME" | "MANUAL", earned: number, available: number) => ({ credit_source, earned, used: earned - available, expired: 0, removed: 0, available });

describe("money and dates", () => {
  it("formats symbols, JPY without decimals and negatives", () => {
    expect(formatMoney(7, "GBP")).toBe("£7.00");
    expect(formatMoney(1500, "JPY")).toBe("¥1,500");
    expect(formatMoney(-2.5, "USD")).toBe("−$2.50");
    expect(formatMoney(3, "KES")).toBe("KSh 3.00");
    expect(formatMoney(3, "XYZ")).toBe("XYZ 3.00");
  });
  it("formats UK dates and counts days", () => {
    expect(formatUkDate("2026-12-31")).toBe("31/12/2026");
    expect(daysUntil("2026-10-10", new Date("2026-10-08T12:00:00Z"))).toBe(2);
    expect(expiryLabel("2026-10-09", new Date("2026-10-08T12:00:00Z"))).toBe("Expires tomorrow");
    expect(expiryLabel("2026-10-08", new Date("2026-10-08T12:00:00Z"))).toBe("Expires today");
    expect(expiryLabel("2026-10-17", new Date("2026-10-08T12:00:00Z"))).toBe("Expires in 9 days");
  });
  it("finds credits expiring within 14 days, soonest first", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const list = [
      { remaining: 1, expires_on: "2026-12-01" },
      { remaining: 2, expires_on: "2026-10-20" },
      { remaining: 3, expires_on: "2026-10-12" },
      { remaining: 0, expires_on: "2026-10-09" },
    ];
    expect(expiringSoon(list, now).map((c) => c.remaining)).toEqual([3, 2]);
  });
});

describe("using bonus on a transfer", () => {
  it("never exceeds the balance or the send amount", () => {
    expect(creditToApply(7, 100)).toBe(7);
    expect(creditToApply(70, 20)).toBe(20);
    expect(creditToApply(0, 20)).toBe(0);
    expect(creditToApply(5, 0)).toBe(0);
    expect(creditToApply(1000.4, 5000, "JPY")).toBe(1000);
  });
  it("has no minimum: a small transfer can use bonus", () => {
    expect(creditToApply(7, 1)).toBe(1);
  });
  it("total to pay never goes below zero", () => {
    expect(totalToPay(100, 3, 1, 7)).toBe(95);
    expect(totalToPay(10, 0, 0, 50)).toBe(0);
  });
  it("converts the Send more credit at the rate", () => {
    expect(amountConverted(7, 2025.5, "NGN")).toBe(14178.5);
    expect(amountConverted(0, 2025.5, "NGN")).toBe(0);
  });
});

describe("sources", () => {
  it("labels", () => {
    expect([sourceGroupLabel("REFERRAL"), sourceGroupLabel("SCHEME"), sourceGroupLabel("MANUAL"), sourceGroupLabel(null)]).toEqual(["Referrals", "Bonus offers", "From Rhemito", ""]);
  });
  it("breakdown rows add up to the tiles and shares to 100", () => {
    const b = { ...base, available: 12, earned: 20, by_source: [grp("MANUAL", 5, 5), grp("REFERRAL", 10, 4), grp("SCHEME", 5, 3)] };
    const rows = breakdownRows(b);
    expect(rows.map((r) => r.source)).toEqual(["REFERRAL", "SCHEME", "MANUAL"]);
    expect(rows.reduce((s, r) => s + r.earned, 0)).toBe(b.earned);
    expect(rows.reduce((s, r) => s + r.available, 0)).toBe(b.available);
    expect(Math.round(rows.reduce((s, r) => s + r.share, 0))).toBe(100);
  });
  it("hides sources with nothing earned and copes with no breakdown", () => {
    expect(breakdownRows({ earned: 5, by_source: [grp("REFERRAL", 0, 0), grp("SCHEME", 5, 5)] })).toHaveLength(1);
    expect(breakdownRows({ earned: 5 })).toEqual([]);
  });
  it("only describes the mix when more than one source holds credit", () => {
    expect(availableParts({ by_source: [grp("REFERRAL", 5, 5)] })).toEqual([]);
    expect(availableParts({ by_source: [grp("REFERRAL", 5, 5), grp("SCHEME", 5, 0), grp("MANUAL", 2, 2)] }).map((p) => p.source)).toEqual(["REFERRAL", "MANUAL"]);
  });
  it("filters rows by source", () => {
    const rows = [{ credit_source: "REFERRAL" }, { credit_source: "SCHEME" }, { credit_source: null }];
    expect(bySource(rows, "ALL")).toHaveLength(3);
    expect(bySource(rows, "SCHEME")).toHaveLength(1);
  });
});

describe("describeCredit", () => {
  it("prefers Mito's label", () => {
    expect(describeCredit({ credit_source_label: "Loyalty bonus – Loyal Sender", notes: "x" })).toBe("Loyalty bonus – Loyal Sender");
    expect(describeCredit({ credit_source_label: "Goodwill credit from Rhemito", reason_code: "BONUS_RETURNED" })).toBe("Goodwill credit from Rhemito (returned after a cancelled transfer)");
  });
  it("falls back to the ledger wording", () => {
    expect(describeCredit({ source: "Referrer reward – referred Sarah S." })).toBe("Referral bonus – You earned from referring Sarah S.");
    expect(describeCredit({ source: "Referee reward – invited by Olayinka A. (approved by x)" })).toBe("Welcome bonus – You earned (invited by Olayinka A.)");
    expect(describeCredit({ reason_code: "BONUS_RETURNED" })).toBe("Bonus returned – transfer cancelled");
    expect(describeCredit({})).toBe("Bonus credit");
  });
});

describe("balanceFor and copy", () => {
  it("returns zeros for a currency with nothing", () => {
    expect(balanceFor({ balances: [] }, "USD")).toMatchObject({ currency: "USD", available: 0, earned: 0 });
  });
  it("copy strings are as specified", () => {
    expect(BONUS_COPY.blocked).toBe("You're not qualified to get bonus. Please contact support for more information.");
    expect(BONUS_COPY.dontUse).toBe("Don't use bonus");
    expect(BONUS_COPY.includes(["£2.00 from referrals"])).toBe("Includes £2.00 from referrals");
    expect(BONUS_COPY.payLessSub("£7.00", "£3.00")).toBe("Save £7.00 now. £3.00 will stay in your bonus credit.");
  });
});
