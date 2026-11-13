import { describe, it, expect, beforeEach } from "vitest";
import {
  formatMoney,
  formatUkDate,
  daysUntil,
  expiryLabel,
  expiringSoon,
  balanceFor,
  referralStage,
  referralStatusText,
  referralHelpText,
  saveReferral,
  loadReferral,
  clearReferral,
  formatOfferAnnouncementMessage,
  REFERRAL_CODE_RE,
  type MyReferral,
  type WalletCredit,
} from "@/lib/rewards";
import { currencyForCountry, formatOfferNoticeMessage, sendCurrenciesForCountry } from "../../../server/rewardsService";

const NOW = new Date("2026-10-03T10:00:00Z");

const referral = (over: Partial<MyReferral>): MyReferral => ({
  id: "REF-1", friend: "Sarah S.", joined_on: "2026-10-01T10:00:00Z", status: "REGISTERED", status_label: "Joined",
  currency: "GBP", floor: 50, qualification_deadline: "2026-10-31", reward: 5, credited: 0, ...over,
});

const credit = (over: Partial<WalletCredit>): WalletCredit => ({
  id: "c1", source: "Referral", reason_code: "REFERRAL_REWARD", amount: 5, remaining: 5, currency: "GBP",
  earned_on: "2026-10-01", expires_on: "2026-12-30", status: "UNUSED", ...over,
});

describe("formatting", () => {
  it("formats money with currency symbols and UK grouping", () => {
    expect(formatMoney(5, "GBP")).toBe("£5.00");
    expect(formatMoney(14178.5, "NGN")).toBe("₦14,178.50");
    expect(formatMoney(500, "JPY")).toBe("¥500");
    expect(formatMoney(-8, "GBP")).toBe("−£8.00");
  });

  it("formats UK dates", () => {
    expect(formatUkDate("2026-10-31")).toBe("31/10/2026");
    expect(formatUkDate("")).toBe("");
  });
});

describe("expiry", () => {
  it("counts whole days until a date in UK time", () => {
    expect(daysUntil("2026-10-12", NOW)).toBe(9);
    expect(daysUntil("2026-10-03", NOW)).toBe(0);
    expect(daysUntil(null, NOW)).toBeNull();
  });

  it("labels expiry", () => {
    expect(expiryLabel("2026-10-12", NOW)).toBe("Expires in 9 days");
    expect(expiryLabel("2026-10-04", NOW)).toBe("Expires tomorrow");
    expect(expiryLabel("2026-10-03", NOW)).toBe("Expires today");
  });

  it("finds credits expiring within 14 days, soonest first", () => {
    const soon = expiringSoon([
      credit({ id: "a", expires_on: "2026-10-15" }),
      credit({ id: "b", expires_on: "2026-12-30" }),
      credit({ id: "c", expires_on: "2026-10-05" }),
      credit({ id: "d", expires_on: "2026-10-06", remaining: 0 }),
    ], NOW);
    expect(soon.map((c) => c.id)).toEqual(["c", "a"]);
  });
});

describe("wallet", () => {
  it("returns zeros for a currency without a balance", () => {
    expect(balanceFor(undefined, "EUR")).toMatchObject({ currency: "EUR", available: 0, earned: 0 });
  });
});

describe("referral journey", () => {
  it("maps statuses to progress", () => {
    expect(referralStage("REGISTERED")).toEqual({ filled: 1, tone: "primary" });
    expect(referralStage("PENDING")).toEqual({ filled: 2, tone: "primary" });
    expect(referralStage("REWARDED")).toEqual({ filled: 3, tone: "teal" });
    expect(referralStage("EXPIRED").tone).toBe("muted");
  });

  it("writes status lines", () => {
    expect(referralStatusText(referral({}), NOW)).toBe("Joined · 28 days left");
    expect(referralStatusText(referral({ status: "PENDING" }), NOW)).toBe("Transfer in progress");
    expect(referralStatusText(referral({ status: "REWARDED", credited: 5 }), NOW)).toBe("£5.00 earned");
    expect(referralHelpText(referral({}), NOW)).toBe("Waiting for their first transfer of £50.00 or more · 28 days left");
    expect(referralHelpText(referral({ status: "EXPIRED" }), NOW)).toBe("They didn't send £50.00 or more in time");
  });
});

describe("referral code storage", () => {
  beforeEach(() => localStorage.clear());

  it("keeps a code for 30 days", () => {
    const t = Date.parse("2026-10-01T00:00:00Z");
    saveReferral({ code: "OLAYINKA2025", referrerFirstName: "Olayinka" }, t);
    expect(loadReferral(t + 29 * 86_400_000)?.code).toBe("OLAYINKA2025");
    expect(loadReferral(t + 31 * 86_400_000)).toBeNull();
  });

  it("clears a code", () => {
    saveReferral({ code: "OLAYINKA2025" });
    clearReferral();
    expect(loadReferral()).toBeNull();
  });

  it("validates the code format", () => {
    expect(REFERRAL_CODE_RE.test("OLAYINKA2025")).toBe(true);
    expect(REFERRAL_CODE_RE.test("OLAYINKA2025USD")).toBe(true);
    expect(REFERRAL_CODE_RE.test("AB-12")).toBe(false);
    expect(REFERRAL_CODE_RE.test("ABCDEFGHIJKLMNOPQ")).toBe(false);
  });
});

describe("server: country to send currency", () => {
  it("maps supported countries", () => {
    expect(currencyForCountry("GB")).toBe("GBP");
    expect(currencyForCountry("ng")).toBe("NGN");
    expect(currencyForCountry("DE")).toBe("EUR");
    expect(currencyForCountry(undefined)).toBe("GBP");
    expect(sendCurrenciesForCountry("GB")).toEqual(["GBP", "USD", "EUR"]);
    expect(sendCurrenciesForCountry("DE")).toEqual(["EUR", "GBP", "USD"]);
    expect(sendCurrenciesForCountry("US")).toEqual(["USD", "GBP", "EUR"]);
  });
});

describe("offer announcement formatting", () => {
  it("formats LIVE referral announcements with corridor and both rewards", () => {
    const raw = "Invite friends and get £5.00 each time they send £50.00 or more to USD. Your friend gets £10.00 too.";
    const expected = "Invite friends and get £5.00 each time they sign up via your link and complete a successful transaction. Your friend gets £10.00 too on sign-up.";
    expect(formatOfferAnnouncementMessage(raw, "LIVE")).toBe(expected);
    expect(formatOfferNoticeMessage(raw, "LIVE")).toBe(expected);
  });

  it("formats LIVE referrer-only and referee-only announcements and preserves IMPROVED messages", () => {
    expect(
      formatOfferAnnouncementMessage("Invite friends and get A$5.00 each time they send A$50.00 or more to NGN.", "LIVE"),
    ).toBe("Invite friends and get A$5.00 each time they sign up via your link and complete a successful transaction.");

    expect(
      formatOfferAnnouncementMessage("Give friends £10.00 when they join with your link and send £50.00 or more.", "LIVE"),
    ).toBe("Give friends £10.00 on sign-up when they join via your link.");

    const improved = "Better offer: you now get £8.00 for every friend who sends £50.00 or more.";
    expect(formatOfferAnnouncementMessage(improved, "IMPROVED")).toBe(improved);
  });
});
