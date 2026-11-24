/**
 * Unit tests for DEC-2026-11-24-DISABLE-STAGING-SUBMISSIONS (Option 2):
 * - Read-only GET lookups to Mito/FURP Staging remain allowed when configured.
 * - ALL external write/submit mutations to Mito/Rhemito Staging are blocked by default
 *   and stored strictly in our own local DB/store with zero outbound write fetch calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetMitoRetailCacheForTests,
  createMitoBeneficiary,
  createMitoKycJourney,
  deleteMitoBeneficiary,
  initiateMitoHostedTransaction,
  initiateMitoPlaidRetailCollection,
  isMitoRetailConfigured,
  isMitoStagingSubmitEnabled,
  lockMitoExchangeRate,
  sendMitoTransaction,
  syncMitoCardPaymentStatus,
  syncMitoPlaidRetailPaymentStatus,
  updateMitoBeneficiary,
  updateMitoRetailUser,
} from "../../../server/mitoRetail";
import {
  furpFetchJson,
  furpPostMultipart,
  isRealFurpLiveEnabled,
  isRealFurpSubmitEnabled,
} from "../../../server/furpClient";
import {
  FurpApiError,
  fetchFurpRewardsSummary,
  linkFurpReferral,
  validateFurpPromoCode,
} from "../lib/furpApiAdapter";

const ORIGINAL_ENV = { ...process.env };

function configureMockMitoEnv() {
  process.env.MITO_RETAIL_ALLOW_IN_VITEST = "1";
  process.env.ALLOW_EXTERNAL_STAGING_SUBMIT = "0";
  process.env.MITO_RETAIL_BASE_URL = "https://furp02-staging.funtechcom.com";
  process.env.MITO_RETAIL_USERNAME = "test-user";
  process.env.MITO_RETAIL_PASSWORD = "test-password";
  process.env.MITO_RETAIL_AFFILIATE_ID = "1112";
  process.env.MITO_RETAIL_SERVICE_NO = "1";
  process.env.MITO_RETAIL_API_KEY = "test-api-key";
  delete process.env.FURP_LIVE;
  delete process.env.FURP_BASE_URL;
  __resetMitoRetailCacheForTests();
}

describe("Option 2 Staging write-blocking guard (DEC-2026-11-24)", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    configureMockMitoEnv();
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENV);
    __resetMitoRetailCacheForTests();
  });

  it("keeps read-only Staging configured while disabling all external Staging write submissions", () => {
    expect(isMitoRetailConfigured()).toBe(true);
    expect(isRealFurpLiveEnabled()).toBe(true);
    expect(isMitoStagingSubmitEnabled()).toBe(false);
    expect(isRealFurpSubmitEnabled()).toBe(false);
  });

  it("blocks all MitoRetail user, rate-lock, transaction, payment-sync, and KYC write calls with zero fetch calls", async () => {
    expect(
      await updateMitoRetailUser({
        userId: "u-1",
        phoneNumber: "+447700900000",
        firstName: "Jane",
        lastName: "Doe",
        dateOfBirth: "1990-01-01",
        street: "10 Downing St",
        addressCity: "London",
        addressPostcode: "SW1A 2AA",
        addressCountryIso3: "GBR",
        birthCountryIso3: "GBR",
      }),
    ).toBe(false);

    expect(
      await lockMitoExchangeRate({
        userId: "u-1",
        collectionMode: "BANKACCOUNT",
        fromCountry: "GBR",
        toCountry: "NGA",
        fromCurrency: "GBP",
        toCurrency: "NGN",
        amount: 100,
        providerId: "prov-1",
      }),
    ).toBeNull();

    expect(
      await sendMitoTransaction({
        userId: "u-1",
        paymentMethod: "CARDCHECKOUT",
        sendCountryIso3: "GBR",
        receiveCountryIso3: "NGA",
        sendCurrency: "GBP",
        receiveCurrency: "NGN",
        sendAmount: 100,
        commission: 2,
        rateId: "rate-1",
        providerId: "prov-1",
        collectionMode: "BANKACCOUNT",
        beneficiaryId: "ben-1",
      }),
    ).toBeNull();

    expect(
      await initiateMitoHostedTransaction({
        userId: "u-1",
        collectionMode: "BANKACCOUNT",
        sendCountryIso3: "GBR",
        receiveCountryIso3: "NGA",
        sendCurrency: "GBP",
        receiveCurrency: "NGN",
        sendAmount: 100,
        partnerReferenceNumber: "TXN-TEST-1",
        reasonCode: "FOROWNEXPENDITURES",
        sourceOfFundCode: "TRADING",
        paymentNarration: "Test",
      }),
    ).toBeNull();

    expect(await createMitoKycJourney({ userId: "u-1" })).toBeNull();
    expect(await syncMitoCardPaymentStatus("pay_test123")).toBeNull();
    expect(
      await initiateMitoPlaidRetailCollection({
        userId: "u-1",
        beneficiaryId: "ben-1",
        providerId: "prov-1",
        rateId: "rate-1",
        collectionMode: "BANKACCOUNT",
        sendCountryIso3: "GBR",
        receiveCountryIso3: "NGA",
        sendCurrency: "GBP",
        receiveCurrency: "NGN",
        sendAmount: 100,
        partnerReferenceNumber: "TXN-TEST-2",
      }),
    ).toBeNull();
    expect(await syncMitoPlaidRetailPaymentStatus({ partnerReferenceNumber: "TXN-TEST-2" })).toBeNull();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stores beneficiary create, update, and delete locally with zero Staging fetch calls", async () => {
    const created = await createMitoBeneficiary({
      userId: "u-local-1",
      collectionMode: "BANKACCOUNT",
      countryIso3: "NGA",
      currencyIso: "NGN",
      providerId: "prov-real-uuid",
      bankName: "GTBank",
      firstName: "Ada",
      lastName: "Okafor",
      acctNumber: "0123456789",
    });
    expect(created).not.toBeNull();
    expect(created!.beneficiaryId).toMatch(/^LOCAL-/i);

    await updateMitoBeneficiary({
      beneficiaryId: "REAL-REMOTE-BEN-UUID",
      userId: "u-local-1",
      firstName: "Ada",
      lastName: "Updated",
      acctNumber: "0123456789",
    });

    expect(await deleteMitoBeneficiary({ beneficiaryId: "REAL-REMOTE-BEN-UUID" })).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks furpFetchJson POST and furpPostMultipart while still allowing read-only GET", async () => {
    await expect(
      furpFetchJson("/api/v1/MitoView/subscribe", {
        method: "POST",
        auth: "apiKey",
        body: { email: "test@example.com" },
      }),
    ).rejects.toThrow(/Blocked external Staging POST submission/i);

    await expect(
      furpPostMultipart("/api/v1/Support/SupportTicket", "customer-jwt", { Subject: "Help" }),
    ).rejects.toThrow(/Blocked external Staging POST submission/i);

    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "1" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const getRes = await furpFetchJson("/api/v1/MitoView/posts", { method: "GET", auth: "apiKey" });
    expect(getRes.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("blocks cross-origin Staging POSTs in furpApiAdapter while allowing read-only GETs", async () => {
    await expect(
      validateFurpPromoCode(
        { code: "SAVE10", amount: 100, sendCurrency: "GBP" },
        { baseUrl: "https://furp02-staging.funtechcom.com/api/v1/" },
      ),
    ).rejects.toMatchObject<Partial<FurpApiError>>({
      code: "STAGING_SUBMIT_DISABLED",
      status: 403,
    });

    await expect(
      linkFurpReferral(
        { referralCode: "JOHN2880" },
        { baseUrl: "https://staging-admin.mito.money/api/v1/" },
      ),
    ).rejects.toMatchObject<Partial<FurpApiError>>({
      code: "STAGING_SUBMIT_DISABLED",
      status: 403,
    });

    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          succeeded: true,
          code: 200,
          data: { rewards: [], bonusWallet: { availableBalance: 0, currency: "GBP" } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await fetchFurpRewardsSummary("GBP", { baseUrl: "https://furp02-staging.funtechcom.com/api/v1/" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
