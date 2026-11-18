/**
 * Send Money API client — the server-owned transaction store behind the
 * wizard and the Dashboard unified Transactions table.
 */

import { apiRequest } from "@/lib/queryClient";
import { formatShortDate } from "@shared/invoice-logic";
import type { SendMoneyPaymentMethod, SendMoneyService, SendMoneyTransactionView } from "@shared/sendMoney";

export interface CreateSendMoneyInput {
  recipientName: string;
  service: SendMoneyService;
  sendCurrency: string;
  sendAmount: string;
  receiveCurrency: string;
  receiveAmount: string;
  fee: string;
  exchangeRate: string;
  promoCode?: string;
  /** Fee before the promo discount (the server re-checks the discount when the transfer is paid). */
  feeBeforePromo?: string;
  /** Fixed amount promos only: the discount comes off the whole amount to pay, and this is what the customer was shown. */
  promoAppliesTo?: "fee" | "amount";
  promoDiscount?: string;
  /** Optional recipient & Mito Retail Sandbox fields from Step 3. */
  beneficiaryType?: "individual" | "business";
  companyName?: string;
  recipientFirstName?: string;
  recipientLastName?: string;
  relationship?: string;
  relationId?: string;
  nickName?: string;
  reason?: string;
  reasonId?: string;
  otherReason?: string;
  narration?: string;
  address?: string;
  city?: string;
  postcode?: string;
  stateOrProvince?: string;
  mobileNo?: string;
  bankName?: string;
  accountNumber?: string;
  sortCode?: string;
  iban?: string;
  swift?: string;
  aba?: string;
  ifsc?: string;
  bsbCode?: string;
  branchCode?: string;
  countryIso3?: string;
  country?: string;
  beneficiaryId?: string;
  providerId?: string;
  providerCode?: string;
  affiliateRateId?: string;
  /** Beneficiary-journey parity (DEC-2026-11-19) - additive, optional. */
  isInternational?: boolean;
  dob?: string;
  gender?: string;
  addressLine2?: string;
  otherRelationship?: string;
  bankCode?: string;
  clabe?: string;
  cnaps?: string;
  accountHolderName?: string;
}

export interface MitoBeneficiaryRequirementField {
  label: string;
  name: string;
  order: number;
  type: string;
  format?: string | null;
  columnDataType: string;
  isRequired: boolean;
  isDisplayable: boolean;
  /** Which journey step the field belongs to: Step 2 (Personal / Identification) or Step 3 (Banking). */
  section?: "Personal" | "Identification" | "Banking";
  fieldInformation?: string | null;
  dropdownOptions?: Array<{ name: string; id: string }>;
}

export interface MitoBeneficiaryItem {
  beneficiaryId: string;
  name: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
  beneficiaryNickname: string | null;
  legalEntityType: "individual" | "business";
  countryIso3: string;
  country: string;
  currency: string;
  serviceCode: string;
  collectionMode: string;
  providerId: string | null;
  bankName: string;
  acctNumber: string;
  sortCode: string;
  iban: string;
  bicSwift: string;
  aba: string;
  ifsc: string;
  bsbCode: string;
  branchCode: string;
  address: string;
  city: string;
  postcode: string;
  stateOrProvince: string;
  mobileNo: string;
  relationId: string | null;
  reasonId: string | null;
  relationship?: string | null;
  relationDescription?: string | null;
  reason?: string | null;
  reasonDescription?: string | null;
  otherReason?: string | null;
  narration?: string | null;
  /** Beneficiary-journey parity (DEC-2026-11-19) - additive, optional. */
  addressLine2?: string | null;
  otherRelation?: string | null;
  dob?: string | null;
  gender?: string | null;
  bankCode?: string | null;
  clabe?: string | null;
  cnaps?: string | null;
  isInternational?: boolean | null;
  accountHolderName?: string | null;
  createdAt: string | null;
}

const DELETED_BENEFICIARIES_STORAGE_KEY = "rhemito_deleted_beneficiaries_v1";

interface DeletedBeneficiariesStore {
  ids: string[];
  sigs: string[];
}

function loadDeletedBeneficiariesStore(): DeletedBeneficiariesStore {
  if (typeof window === "undefined") return { ids: [], sigs: [] };
  try {
    const raw = window.localStorage.getItem(DELETED_BENEFICIARIES_STORAGE_KEY);
    if (!raw) return { ids: [], sigs: [] };
    const parsed = JSON.parse(raw) as Partial<DeletedBeneficiariesStore>;
    return {
      ids: Array.isArray(parsed.ids) ? parsed.ids : [],
      sigs: Array.isArray(parsed.sigs) ? parsed.sigs : [],
    };
  } catch {
    return { ids: [], sigs: [] };
  }
}

function saveDeletedBeneficiariesStore(store: DeletedBeneficiariesStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      DELETED_BENEFICIARIES_STORAGE_KEY,
      JSON.stringify({
        ids: Array.from(new Set(store.ids)),
        sigs: Array.from(new Set(store.sigs)),
      }),
    );
  } catch {
    // ignore storage errors
  }
}

function makeBeneficiarySignature(name?: string | null, accountNumber?: string | null): string | null {
  const n = String(name || "").trim().toLowerCase();
  const a = String(accountNumber || "").replace(/\s+/g, "").toLowerCase();
  if (!n && (!a || a === "—")) return null;
  return `${n}|${a === "—" ? "" : a}`;
}

export function unmarkDeletedMitoBeneficiary(meta: {
  beneficiaryId?: string | null;
  name?: string | null;
  accountNumber?: string | null;
}): void {
  const store = loadDeletedBeneficiariesStore();
  const idUpper = String(meta.beneficiaryId || "").trim().toUpperCase();
  const sig = makeBeneficiarySignature(meta.name, meta.accountNumber);
  const nameOnlySig = meta.name ? `${String(meta.name).trim().toLowerCase()}|` : null;
  store.ids = store.ids.filter((id) => id !== idUpper);
  store.sigs = store.sigs.filter((s) => s !== sig && s !== nameOnlySig);
  saveDeletedBeneficiariesStore(store);
}

export function isMitoBeneficiaryDeleted(meta: {
  beneficiaryId?: string | null;
  name?: string | null;
  accountNumber?: string | null;
}): boolean {
  const store = loadDeletedBeneficiariesStore();
  const idUpper = String(meta.beneficiaryId || "").trim().toUpperCase();
  if (idUpper && store.ids.some((id) => id.toUpperCase() === idUpper)) return true;
  const sig = makeBeneficiarySignature(meta.name, meta.accountNumber);
  const nameOnlySig = meta.name ? `${String(meta.name).trim().toLowerCase()}|` : null;
  if (sig && store.sigs.includes(sig)) return true;
  if (nameOnlySig && store.sigs.includes(nameOnlySig)) return true;
  return false;
}

export async function fetchMitoBeneficiaries(params?: {
  currencyIso?: string;
  countryIso3?: string;
  service?: SendMoneyService;
  legalEntityType?: string;
  providerId?: string;
  pageNo?: number;
  searchingText?: string;
}): Promise<MitoBeneficiaryItem[]> {
  try {
    const qs = new URLSearchParams();
    if (params?.currencyIso) qs.set("currencyIso", params.currencyIso.toUpperCase());
    if (params?.countryIso3) qs.set("countryIso3", params.countryIso3.toUpperCase());
    if (params?.service) qs.set("service", params.service);
    if (params?.legalEntityType) qs.set("legalEntityType", params.legalEntityType);
    if (params?.providerId) qs.set("providerId", params.providerId);
    if (params?.pageNo) qs.set("PageNo", String(params.pageNo));
    if (params?.searchingText?.trim()) qs.set("SearchingText", params.searchingText.trim());

    const query = qs.toString();
    const res = await fetch(`/api/send-money/mito/beneficiaries${query ? `?${query}` : ""}`, {
      credentials: "include",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: {
        configured?: boolean;
        beneficiaries?: MitoBeneficiaryItem[];
        deletedIds?: string[];
        deletedSignatures?: string[];
      };
    };
    const rawItems = json.data?.beneficiaries ?? [];
    const deletedStore = loadDeletedBeneficiariesStore();
    if (Array.isArray(json.data?.deletedIds) || Array.isArray(json.data?.deletedSignatures)) {
      if (Array.isArray(json.data?.deletedIds)) {
        deletedStore.ids.push(...json.data.deletedIds.map((i) => String(i || "").trim().toUpperCase()).filter(Boolean));
      }
      if (Array.isArray(json.data?.deletedSignatures)) {
        deletedStore.sigs.push(...json.data.deletedSignatures.map((s) => String(s || "").trim().toLowerCase()).filter(Boolean));
      }
      saveDeletedBeneficiariesStore(deletedStore);
    }
    const deletedIdSet = new Set(deletedStore.ids.map((i) => i.toUpperCase()));
    const deletedSigSet = new Set(deletedStore.sigs);

    const seenSigs = new Set<string>();
    const items = rawItems.filter((item) => {
      const idUpper = String(item.beneficiaryId || "").trim().toUpperCase();
      if (idUpper && deletedIdSet.has(idUpper)) return false;
      const sig = makeBeneficiarySignature(item.name, item.acctNumber || item.iban || item.mobileNo);
      const nameOnlySig = item.name ? `${item.name.trim().toLowerCase()}|` : null;
      if ((sig && deletedSigSet.has(sig)) || (nameOnlySig && deletedSigSet.has(nameOnlySig))) {
        return false;
      }
      const dedupKey = sig || idUpper;
      if (dedupKey) {
        if (seenSigs.has(dedupKey)) return false;
        seenSigs.add(dedupKey);
      }
      return true;
    });

    return Object.assign(items, { configured: Boolean(json.data?.configured) });
  } catch {
    return [];
  }
}

export async function fetchMitoBeneficiariesWithMeta(
  params?: Parameters<typeof fetchMitoBeneficiaries>[0],
): Promise<{ configured: boolean; beneficiaries: MitoBeneficiaryItem[] }> {
  const list = (await fetchMitoBeneficiaries(params)) as MitoBeneficiaryItem[] & { configured?: boolean };
  return {
    configured: Boolean(list.configured),
    beneficiaries: Array.from(list),
  };
}

export async function deleteMitoBeneficiaryById(
  beneficiaryId: string,
  meta?: { name?: string; accountNumber?: string },
): Promise<boolean> {
  const cleanId = String(beneficiaryId || "").trim();
  const store = loadDeletedBeneficiariesStore();
  if (cleanId) {
    store.ids.push(cleanId.toUpperCase());
  }
  const sig = makeBeneficiarySignature(meta?.name, meta?.accountNumber);
  if (sig) {
    store.sigs.push(sig);
  }
  if (meta?.name?.trim()) {
    store.sigs.push(`${meta.name.trim().toLowerCase()}|`);
  }
  saveDeletedBeneficiariesStore(store);

  try {
    const qs = new URLSearchParams();
    if (meta?.name?.trim()) qs.set("name", meta.name.trim());
    if (meta?.accountNumber?.trim()) qs.set("accountNumber", meta.accountNumber.replace(/\s+/g, ""));
    const query = qs.toString();
    const res = await fetch(
      `/api/send-money/mito/beneficiaries/${encodeURIComponent(cleanId || "local")}${query ? `?${query}` : ""}`,
      {
        method: "DELETE",
        credentials: "include",
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function updateMitoBeneficiaryById(
  beneficiaryId: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const cleanId = String(beneficiaryId || "").trim();
  const fullName = String(
    payload.companyName ||
      payload.businessName ||
      `${payload.firstName || ""} ${payload.lastName || ""}`,
  ).trim();
  const acct = String(payload.accountNumber || payload.acctNumber || payload.mobileNo || payload.iban || "").replace(
    /\s+/g,
    "",
  );
  unmarkDeletedMitoBeneficiary({ beneficiaryId: cleanId, name: fullName, accountNumber: acct });

  try {
    const res = await fetch(`/api/send-money/mito/beneficiaries/${encodeURIComponent(cleanId || "local")}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchMitoBeneficiaryRequirements(params: {
  currencyCode: string;
  countryIso3?: string;
  entityType: "I" | "B";
  providerId?: string;
  service?: SendMoneyService;
  isInternational?: boolean;
}): Promise<MitoBeneficiaryRequirementField[]> {
  try {
    const qs = new URLSearchParams({
      currencyCode: params.currencyCode.toUpperCase(),
      entityType: params.entityType,
      service: params.service || "bank_deposit",
    });
    if (params.countryIso3) qs.set("countryIso3", params.countryIso3.toUpperCase());
    if (params.providerId) qs.set("providerId", params.providerId);
    if (params.isInternational !== undefined) qs.set("isInternational", params.isInternational ? "true" : "false");

    const res = await fetch(`/api/send-money/mito/beneficiary-requirements?${qs.toString()}`, {
      credentials: "include",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: { requirements?: MitoBeneficiaryRequirementField[] };
    };
    return json.data?.requirements ?? [];
  } catch {
    return [];
  }
}

export interface MitoAffiliateRateResult {
  fromCurrency: string;
  toCurrency: string;
  rateId: string | null;
  rate: number | null;
  partnerRate: number | null;
  rateExpiry: string | null;
}

export interface MitoProviderOption {
  providerCode: string;
  providerName: string;
  providerId: string;
  isGeneric: boolean;
  /** `true` for Swift / international options; `false` for local (direct-to-bank) providers. */
  isInternational?: boolean;
}

export interface MitoLookupTypeOption {
  name: string;
  code: string;
  id?: string;
}

export interface MitoLookupTypesResult {
  reason?: MitoLookupTypeOption[] | null;
  purposes?: MitoLookupTypeOption[] | null;
  relationships?: MitoLookupTypeOption[] | null;
  relationshipes?: MitoLookupTypeOption[] | null;
  sourceOfFunds?: MitoLookupTypeOption[] | null;
}

export async function fetchMitoLookups(): Promise<MitoLookupTypesResult> {
  try {
    const res = await fetch("/api/send-money/mito/lookups", {
      credentials: "include",
    });
    if (!res.ok) return {};
    const json = (await res.json()) as { data?: MitoLookupTypesResult };
    return json.data ?? {};
  } catch {
    return {};
  }
}

export interface MitoJourneyStatusResult {
  journeyCode: string;
  journeyStatus: string;
  orderNo: string | null;
  orderStatus: string | null;
  partnerReferenceNumber: string | null;
  reference: string | null;
  currency: string | null;
  amount: number | null;
}

export async function fetchMitoJourneyStatus(journeyCode: string): Promise<MitoJourneyStatusResult | null> {
  const cleanCode = String(journeyCode || "").trim();
  if (!cleanCode) return null;
  try {
    const res = await fetch(
      `/api/send-money/mito/journey-status?journeyCode=${encodeURIComponent(cleanCode)}`,
      { credentials: "include" },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: MitoJourneyStatusResult | null };
    return json.data ?? null;
  } catch {
    return null;
  }
}

export async function fetchMitoAffiliateRate(
  fromCurrency: string,
  toCurrency: string,
): Promise<MitoAffiliateRateResult | null> {
  try {
    const qs = new URLSearchParams({
      fromCurrency: fromCurrency.toUpperCase(),
      toCurrency: toCurrency.toUpperCase(),
    });
    const res = await fetch(`/api/send-money/mito/affiliate-rates?${qs.toString()}`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: MitoAffiliateRateResult };
    return json.data ?? null;
  } catch {
    return null;
  }
}

export interface MitoProvidersDetailed {
  configured: boolean;
  providers: MitoProviderOption[];
  local: MitoProviderOption[];
  international: MitoProviderOption[];
}

type MitoProvidersQuery = {
  countryIso3: string;
  currencyCode?: string;
  serviceCode?: string;
  collectionMode?: "BANKACCOUNT" | "MOBILEMONEY";
  service?: SendMoneyService;
};

async function requestMitoProviders(
  paramsOrCurrency: string | MitoProvidersQuery,
  serviceArg?: SendMoneyService,
  countryIso3Arg?: string,
): Promise<MitoProvidersDetailed> {
  const empty: MitoProvidersDetailed = { configured: false, providers: [], local: [], international: [] };
  try {
    const params =
      typeof paramsOrCurrency === "string"
        ? {
            countryIso3: countryIso3Arg || "",
            currencyCode: paramsOrCurrency,
            serviceCode: "MONEYTRANSFER",
            collectionMode:
              serviceArg === "mobile_money" ? ("MOBILEMONEY" as const) : ("BANKACCOUNT" as const),
          }
        : paramsOrCurrency;

    const collectionMode =
      params.collectionMode ||
      (params.service === "mobile_money" ? "MOBILEMONEY" : "BANKACCOUNT");
    const qs = new URLSearchParams({
      serviceCode: (params.serviceCode || "MONEYTRANSFER").toUpperCase(),
      collectionMode,
    });
    if (params.countryIso3) {
      qs.set("countryIso3", params.countryIso3.trim().toUpperCase());
    }
    if (params.currencyCode) {
      qs.set("CurrencyCode", params.currencyCode.trim().toUpperCase());
    }

    const res = await fetch(`/api/send-money/mito/providers?${qs.toString()}`, {
      credentials: "include",
    });
    if (!res.ok) return empty;
    const json = (await res.json()) as {
      data?: {
        configured?: boolean;
        providers?: MitoProviderOption[];
        local?: MitoProviderOption[];
        international?: MitoProviderOption[];
      };
    };
    const providers = json.data?.providers ?? [];
    const international = json.data?.international ?? providers.filter((p) => p.isInternational === true);
    const local = json.data?.local ?? providers.filter((p) => p.isInternational !== true);
    return { configured: Boolean(json.data?.configured), providers, local, international };
  } catch {
    return empty;
  }
}

/** Providers split into `local` (direct-to-bank) and `international` (Swift) options. */
export async function fetchMitoProvidersDetailed(params: MitoProvidersQuery): Promise<MitoProvidersDetailed> {
  return requestMitoProviders(params);
}

export async function fetchMitoProviders(
  paramsOrCurrency: string | MitoProvidersQuery,
  serviceArg?: SendMoneyService,
  countryIso3Arg?: string,
): Promise<MitoProviderOption[]> {
  return (await requestMitoProviders(paramsOrCurrency, serviceArg, countryIso3Arg)).providers;
}

/** Creates a recipient (Mito, or locally when Mito is unavailable) via `POST /api/send-money/mito/beneficiaries`. */
export async function createMitoBeneficiaryClient(
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; beneficiaryId?: string; beneficiary?: MitoBeneficiaryItem; error?: string }> {
  try {
    const res = await fetch("/api/send-money/mito/beneficiaries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: { beneficiaryId?: string | null; beneficiary?: MitoBeneficiaryItem };
      error?: { message?: string };
    };
    if (!res.ok) {
      return { ok: false, error: String(json?.error?.message || "We couldn't save this recipient. Please try again.") };
    }
    const beneficiaryId = json.data?.beneficiaryId ? String(json.data.beneficiaryId) : undefined;
    const fullName = String(
      payload.companyName || payload.businessName || `${payload.firstName || ""} ${payload.lastName || ""}`,
    ).trim();
    unmarkDeletedMitoBeneficiary({
      beneficiaryId,
      name: fullName,
      accountNumber: String(payload.accountNumber || payload.acctNumber || payload.mobileNo || payload.iban || ""),
    });
    let beneficiary = json.data?.beneficiary;
    if (!beneficiary && beneficiaryId) {
      try {
        const list = await fetchMitoBeneficiaries();
        beneficiary = list.find((b) => String(b.beneficiaryId || "").toUpperCase() === beneficiaryId.toUpperCase());
      } catch {
        beneficiary = undefined;
      }
    }
    return { ok: true, beneficiaryId, ...(beneficiary ? { beneficiary } : {}) };
  } catch {
    return { ok: false, error: "We couldn't reach the server. Please check your connection and try again." };
  }
}

export interface MitoBankVerificationClientResult {
  resolved: boolean;
  canContinue: boolean;
  source: "mito" | "unavailable" | "mock";
  accountHolderName: string | null;
  message: string | null;
  details?: Record<string, string>;
}

const BANK_VERIFICATION_UNAVAILABLE: MitoBankVerificationClientResult = {
  resolved: false,
  canContinue: true,
  source: "unavailable",
  accountHolderName: null,
  message:
    "Automatic account name verification isn't available for this bank right now. Please double-check the account details and continue.",
};

/** "Search bank details" — `POST /api/send-money/mito/bank-details`. Never blocks: `canContinue` is always true. */
export async function verifyMitoBankDetails(params: {
  international?: boolean;
  countryIso3: string;
  providerId?: string;
  param: Array<{ parameter: string; value: string }>;
}): Promise<MitoBankVerificationClientResult> {
  try {
    const res = await fetch("/api/send-money/mito/bank-details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(params),
    });
    if (!res.ok) return { ...BANK_VERIFICATION_UNAVAILABLE };
    const json = (await res.json()) as { data?: MitoBankVerificationClientResult };
    return json.data ? { ...json.data, canContinue: true } : { ...BANK_VERIFICATION_UNAVAILABLE };
  } catch {
    return { ...BANK_VERIFICATION_UNAVAILABLE };
  }
}

export interface MitoNicknameValidationResult {
  valid: boolean;
  available: boolean;
  source: "local" | "mito";
  message: string | null;
}

/** Live nickname check (min 5 letters/numbers + availability) via `GET /api/send-money/mito/validate-nickname`. */
export async function validateMitoNickname(nickName: string): Promise<MitoNicknameValidationResult> {
  try {
    const res = await fetch(`/api/send-money/mito/validate-nickname?nickName=${encodeURIComponent(nickName)}`, {
      credentials: "include",
    });
    if (!res.ok) return { valid: true, available: true, source: "local", message: null };
    const json = (await res.json()) as { data?: MitoNicknameValidationResult };
    return json.data ?? { valid: true, available: true, source: "local", message: null };
  } catch {
    return { valid: true, available: true, source: "local", message: null };
  }
}

export interface MitoProvinceOption {
  id: string;
  name: string;
  code?: string;
}

/** States / provinces for a country via `GET /api/send-money/mito/provinces`. */
export async function fetchMitoProvinces(countryIso3: string): Promise<MitoProvinceOption[]> {
  try {
    const res = await fetch(`/api/send-money/mito/provinces?countryIso3=${encodeURIComponent(countryIso3.trim().toUpperCase())}`, {
      credentials: "include",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { provinces?: MitoProvinceOption[] } };
    return json.data?.provinces ?? [];
  } catch {
    return [];
  }
}

function isTransientFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = (err.message || "").toLowerCase();
  return (
    err.name === "TypeError" &&
    (msg.includes("failed to fetch") || msg.includes("load failed") || msg.includes("networkerror"))
  );
}

export async function createSendMoneyTransaction(input: CreateSendMoneyInput): Promise<SendMoneyTransactionView> {
  const isJsdom = typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent);
  const retryDelaysMs = isJsdom ? [] : [600, 1200];
  let lastErr: unknown;
  let res: Response | undefined;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    try {
      res = await apiRequest("POST", "/api/send-money/transactions", input);
      break;
    } catch (err) {
      lastErr = err;
      if (!isTransientFetchError(err) || attempt === retryDelaysMs.length) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
    }
  }
  if (!res) throw lastErr;
  const data = ((await res.json()) as { data: SendMoneyTransactionView }).data;
  unmarkDeletedMitoBeneficiary({
    beneficiaryId: data.mitoBeneficiaryId,
    name: input.recipientName,
    accountNumber: input.accountNumber || input.iban || input.mobileNo,
  });
  return data;
}

export async function getSendMoneyTransactions(): Promise<SendMoneyTransactionView[]> {
  const res = await apiRequest("GET", "/api/send-money/transactions");
  return ((await res.json()) as { data: SendMoneyTransactionView[] }).data;
}

/** A Send Money API error with its machine code (e.g. PROMO_REJECTED, PROMO_CHANGED). */
export class SendMoneyApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Step 4 (Payment) — Initiates the Mito Hosted Transaction via
 * `POST /api/v1/mito/Transactions/InitiateHostedTransaction`.
 */
export async function initiateHostedSendMoneyTransaction(id: string): Promise<SendMoneyTransactionView | null> {
  try {
    const res = await fetch(`/api/send-money/transactions/${encodeURIComponent(id)}/initiate-hosted`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: SendMoneyTransactionView };
    return json.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Pay a transaction. A promo code applied on the payment step travels with the request, together with the
 * discount the customer was shown, so the server can re-check and record it before any money moves (PROMO-RHEMITO P-20).
 */
export async function paySendMoneyTransaction(
  id: string,
  paymentMethod: SendMoneyPaymentMethod,
  promo?: { code: string; discount: number } | null,
  bonus?: { mode: "pay_less" | "send_more"; amount: number } | null,
): Promise<SendMoneyTransactionView> {
  const body: Record<string, unknown> = { paymentMethod };
  // Bonus credit travels with the payment so the server re-checks and uses it before any money moves (BONUS-RHEMITO B-20)
  if (bonus && bonus.amount > 0) body.bonusCredit = { mode: bonus.mode, amount: bonus.amount.toFixed(2) };
  if (promo?.code) {
    body.promoCode = promo.code;
    body.promoDiscount = Math.max(0, promo.discount).toFixed(2);
  }
  const res = await fetch(`/api/send-money/transactions/${encodeURIComponent(id)}/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new SendMoneyApiError(res.status, String(json?.error?.code ?? "PAY_FAILED"), String(json?.error?.message ?? "The payment could not be recorded. Please try again."));
  }
  return (json as { data: SendMoneyTransactionView }).data;
}

export interface ConfirmGatewayInput {
  outcome: "completed" | "processing" | "failed" | "cancelled" | "expired";
  rawStatus?: string;
  paymentStatus?: string;
  paymentId?: string;
  sessionId?: string;
  tnxref?: string;
  journeyCode?: string;
  reason?: string;
}

export async function confirmSendMoneyGateway(
  id: string,
  input: ConfirmGatewayInput,
): Promise<SendMoneyTransactionView> {
  const res = await fetch(`/api/send-money/transactions/${encodeURIComponent(id)}/confirm-gateway`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    keepalive: true,
    body: JSON.stringify(input),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new SendMoneyApiError(
      res.status,
      String(json?.error?.code ?? "CONFIRM_GATEWAY_FAILED"),
      String(json?.error?.message ?? "The payment confirmation could not be recorded. Please try again."),
    );
  }
  return (json as { data: SendMoneyTransactionView }).data;
}

export async function cancelSendMoneyTransaction(id: string): Promise<void> {
  await apiRequest("POST", `/api/send-money/transactions/${encodeURIComponent(id)}/cancel`, {});
}

export interface MitoKycJourneyClientResponse {
  userId: string | null;
  configured: boolean;
  journeyId: string | null;
  journeyCode: string | null;
  qrCodeUrl: string | null;
  hostedUrl: string | null;
  expiryDate: string | null;
  kycFlow: string | null;
  kycStatus: string | null;
  kycType: string | null;
  message: string | null;
}

export async function fetchMitoKycJourney(params?: {
  returnUrl?: string;
  journeyType?: number;
  userId?: string;
}): Promise<MitoKycJourneyClientResponse | null> {
  try {
    const res = await fetch("/api/send-money/mito/kyc/journey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(params ?? {}),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: MitoKycJourneyClientResponse };
    return json.data ?? null;
  } catch {
    return null;
  }
}

export interface MitoValidateRateClientResponse {
  userId: string | null;
  rateId: string | null;
  rate: number | null;
  commission: number | null;
  receiveAmount: number | null;
  isKycRequired: boolean;
  isTransactionAllowed: boolean;
  kycUrl: string | null;
  isProfileUpdateRequired: boolean;
}

export async function validateMitoRate(params: {
  fromCurrency: string;
  toCurrency: string;
  fromCountry?: string;
  toCountry?: string;
  amount: number;
  direction?: "S" | "R";
  service?: SendMoneyService | string;
  providerId?: string;
  returnUrl?: string;
}): Promise<MitoValidateRateClientResponse | null> {
  try {
    const res = await fetch("/api/send-money/mito/validate-rate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(params),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: MitoValidateRateClientResponse };
    return json.data ?? null;
  } catch {
    return null;
  }
}

/** Dashboard unified-table row shape for send money (display strings, 2dp). */
export interface SendMoneyRow {
  id: string;
  recipient: string;
  service: string;
  date: string;
  amount: string;
  status: string;
  /** Full record, present once the transfer has been paid; powers the receipt. */
  receipt?: SendMoneyTransactionView;
}

const SERVICE_LABELS: Record<SendMoneyService, string> = {
  bank_deposit: "Bank Deposit",
  mobile_money: "Mobile Money",
  cash_pickup: "Cash Pickup",
};

export function toSendMoneyRow(view: SendMoneyTransactionView): SendMoneyRow {
  return {
    id: view.reference,
    recipient: view.recipientName,
    service: SERVICE_LABELS[view.service] ?? view.service,
    date: formatShortDate(view.createdAt.slice(0, 10)),
    amount: `${view.sendCurrency} ${view.sendAmount}`,
    status: view.status,
    ...(view.paidAt ? { receipt: view } : {}),
  };
}

export interface ReceiptLine {
  key: "send" | "fee" | "promo" | "bonus_pay_less" | "bonus_send_more" | "total" | "receive";
  label: string;
  /** Signed display amount, e.g. "−GBP 5.00". */
  value: string;
  tone?: "discount" | "total";
}

/**
 * Money lines of a paid transfer (PROMO/BONUS-RHEMITO). The stored fee is the fee after the promo discount,
 * so the fee line shows it before the discount and the promo line takes the discount off. Pay-less bonus
 * reduces the total paid; Send-more bonus adds to the amount converted and leaves the total unchanged.
 */
export function receiptLines(v: SendMoneyTransactionView): ReceiptLine[] {
  const num = (x?: string | null) => (x ? Number(x) : 0);
  const cur = v.sendCurrency;
  const money = (n: number) => `${cur} ${n.toFixed(2)}`;
  const send = num(v.sendAmount);
  const fee = num(v.fee);
  const promo = num(v.promoDiscount);
  const bonus = num(v.bonusCredit);
  const payLess = v.bonusCreditMode === "pay_less" ? bonus : 0;
  const sendMore = v.bonusCreditMode === "send_more" ? bonus : 0;
  const amountPromo = v.promoAppliesTo === "amount" ? promo : 0;
  const lines: ReceiptLine[] = [
    { key: "send", label: "You send", value: money(send) },
    { key: "fee", label: "Transfer fee", value: money(v.promoAppliesTo === "amount" ? fee : fee + promo) },
  ];
  if (promo > 0) lines.push({ key: "promo", label: v.promoCode ? `Promo code ${v.promoCode}` : "Promo code", value: `−${money(promo)}`, tone: "discount" });
  if (payLess > 0) lines.push({ key: "bonus_pay_less", label: "Bonus credit used", value: `−${money(payLess)}`, tone: "discount" });
  if (sendMore > 0) lines.push({ key: "bonus_send_more", label: "Bonus added to your transfer", value: `+${money(sendMore)}`, tone: "discount" });
  lines.push({ key: "total", label: "Total paid", value: money(Math.max(0, send + fee - amountPromo - payLess)), tone: "total" });
  lines.push({ key: "receive", label: "Recipient gets", value: `${v.receiveCurrency} ${num(v.receiveAmount).toFixed(2)}` });
  return lines;
}
