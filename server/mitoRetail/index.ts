import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { AuthUser } from "@shared/schema";
import {
  classifyRequirementSection,
  getFallbackBeneficiaryRequirements,
  sortFieldsMandatoryFirst,
} from "@shared/beneficiaryRequirements";
import { serverConfig } from "../config";

function log(message: string, source = "mito-retail") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

export interface MitoRetailCredentials {
  baseUrl: string;
  username: string;
  password: string;
  accessAffiliateNumber: string;
  accessServiceNumber: string;
  apiKey: string;
  webhookSecretKey: string;
  publicKey: string;
  secretKey: string;
}

export interface MitoRetailUserPayload {
  countryIso3: string;
  email: string;
  phoneNumber: string;
  firstName: string;
  middleName: string;
  lastName: string;
  gender: "M" | "F";
  legalEntityType: "I" | "B";
  companyNumber: string;
  businessName: string;
  dateOfBirth: string;
  buildingNumber: string;
  buildingName: string;
  subStreet: string;
  street: string;
  addressCity: string;
  addressPostcode: string;
  addressCountryIso3: string;
  birthCountryIso3: string;
}

const ISO2_TO_ISO3: Record<string, string> = {
  GB: "GBR",
  UK: "GBR",
  US: "USA",
  NG: "NGA",
  CA: "CAN",
  GH: "GHA",
  KE: "KEN",
  ZA: "ZAF",
  DE: "DEU",
  FR: "FRA",
  IN: "IND",
  CN: "CHN",
  AE: "ARE",
};

const COUNTRY_DEFAULT_DIAL: Record<string, string> = {
  GBR: "+44",
  USA: "+1",
  NGA: "+234",
  CAN: "+1",
  GHA: "+233",
  KEN: "+254",
  ZAF: "+27",
  DEU: "+49",
  FRA: "+33",
  IND: "+91",
  CHN: "+86",
  ARE: "+971",
};

let cachedCredentials: MitoRetailCredentials | null | undefined;
let cachedToken: { token: string; userId: string; expiresAtMs: number } | null = null;

/** Maps Rhemito user.id and lowercase email -> Mito userId UUID */
const mitoUserIdByRhemitoId = new Map<string, string>();
const mitoUserIdByEmail = new Map<string, string>();
const deletedMitoBeneficiaryIds = new Set<string>();
const deletedMitoBeneficiarySignatures = new Set<string>();

const DELETED_BENEFICIARIES_FILE = path.resolve(
  process.cwd(),
  ".dev-state",
  "mito-deleted-beneficiaries.json",
);

const UPDATED_BENEFICIARIES_FILE = path.resolve(
  process.cwd(),
  ".dev-state",
  "mito-updated-beneficiaries.json",
);

const updatedMitoBeneficiariesById = new Map<string, Partial<MitoBeneficiaryItem>>();

function loadUpdatedBeneficiariesFromDisk(): void {
  try {
    if (!fs.existsSync(UPDATED_BENEFICIARIES_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(UPDATED_BENEFICIARIES_FILE, "utf8")) as Record<
      string,
      Partial<MitoBeneficiaryItem>
    >;
    if (raw && typeof raw === "object") {
      for (const [key, val] of Object.entries(raw)) {
        const cleanKey = String(key || "").trim().toUpperCase();
        if (cleanKey && val && typeof val === "object") {
          updatedMitoBeneficiariesById.set(cleanKey, val);
        }
      }
    }
  } catch {
    // ignore disk read errors
  }
}

function saveUpdatedBeneficiariesToDisk(): void {
  try {
    const dir = path.dirname(UPDATED_BENEFICIARIES_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const serialized: Record<string, Partial<MitoBeneficiaryItem>> = {};
    updatedMitoBeneficiariesById.forEach((val, key) => {
      serialized[key] = val;
    });
    fs.writeFileSync(UPDATED_BENEFICIARIES_FILE, JSON.stringify(serialized, null, 2), "utf8");
  } catch {
    // ignore disk write errors
  }
}

function makeDeletedSignature(name?: string | null, acctNumber?: string | null): string | null {
  const n = String(name || "").trim().toLowerCase();
  const a = String(acctNumber || "").replace(/\s+/g, "").toLowerCase();
  if (!n && (!a || a === "—")) return null;
  return `${n}|${a === "—" ? "" : a}`;
}

function loadDeletedBeneficiariesFromDisk(): void {
  try {
    if (!fs.existsSync(DELETED_BENEFICIARIES_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(DELETED_BENEFICIARIES_FILE, "utf8")) as {
      ids?: string[];
      sigs?: string[];
    };
    if (Array.isArray(raw.ids)) {
      for (const id of raw.ids) {
        const clean = String(id || "").trim().toUpperCase();
        if (clean) deletedMitoBeneficiaryIds.add(clean);
      }
    }
    if (Array.isArray(raw.sigs)) {
      for (const sig of raw.sigs) {
        const clean = String(sig || "").trim().toLowerCase();
        if (clean) deletedMitoBeneficiarySignatures.add(clean);
      }
    }
  } catch {
    // ignore disk read errors
  }
}

function saveDeletedBeneficiariesToDisk(): void {
  try {
    const dir = path.dirname(DELETED_BENEFICIARIES_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      DELETED_BENEFICIARIES_FILE,
      JSON.stringify(
        {
          ids: Array.from(deletedMitoBeneficiaryIds),
          sigs: Array.from(deletedMitoBeneficiarySignatures),
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    // ignore disk write errors
  }
}

function unmarkDeletedBeneficiaryOnServer(params: {
  beneficiaryId?: string | null;
  name?: string | null;
  acctNumber?: string | null;
}): void {
  loadDeletedBeneficiariesFromDisk();
loadUpdatedBeneficiariesFromDisk();
  const idUpper = String(params.beneficiaryId || "").trim().toUpperCase();
  if (idUpper) deletedMitoBeneficiaryIds.delete(idUpper);
  const sig = makeDeletedSignature(params.name, params.acctNumber);
  if (sig) deletedMitoBeneficiarySignatures.delete(sig);
  const nameOnlySig = params.name ? `${String(params.name).trim().toLowerCase()}|` : null;
  if (nameOnlySig) deletedMitoBeneficiarySignatures.delete(nameOnlySig);
  saveDeletedBeneficiariesToDisk();
}

export function getDeletedMitoBeneficiariesSnapshot(): { ids: string[]; sigs: string[] } {
  loadDeletedBeneficiariesFromDisk();
loadUpdatedBeneficiariesFromDisk();
  return {
    ids: Array.from(deletedMitoBeneficiaryIds),
    sigs: Array.from(deletedMitoBeneficiarySignatures),
  };
}

loadDeletedBeneficiariesFromDisk();
loadUpdatedBeneficiariesFromDisk();

export function toCountryIso3(countryRaw: string | null | undefined): string {
  const clean = String(countryRaw ?? "").trim().toUpperCase();
  if (!clean) return "GBR";
  if (clean.length === 3) return clean;
  return ISO2_TO_ISO3[clean] ?? "GBR";
}

export function loadMitoRetailCredentials(): MitoRetailCredentials | null {
  if (cachedCredentials !== undefined) {
    return cachedCredentials;
  }

  const credPath =
    process.env.MITO_RETAIL_CREDENTIALS_FILE ||
    path.resolve(process.cwd(), "docs", "Credentials", "Credentials for Retail API integration.txt");

  let fileText = "";
  try {
    if (fs.existsSync(credPath)) {
      fileText = fs.readFileSync(credPath, "utf8");
    }
  } catch {
    fileText = "";
  }

  const extractField = (label: string): string => {
    const match = fileText.match(new RegExp(`^${label}:\\s*(.+)$`, "mi"));
    return match ? match[1].trim() : "";
  };

  const baseUrl = (process.env.MITO_RETAIL_BASE_URL || "https://furp02-staging.funtechcom.com").replace(/\/+$/, "");
  const username = process.env.MITO_RETAIL_USERNAME || extractField("Username");
  const password = process.env.MITO_RETAIL_PASSWORD || extractField("Password");
  const accessAffiliateNumber = process.env.MITO_RETAIL_AFFILIATE_ID || extractField("Affiliate ID");
  const accessServiceNumber = process.env.MITO_RETAIL_SERVICE_NO || extractField("Service No");
  const apiKey = process.env.MITO_RETAIL_API_KEY || extractField("API Key");
  const webhookSecretKey = process.env.MITO_RETAIL_WEBHOOK_SECRET || extractField("Webhook Secret Key");
  const publicKey = process.env.MITO_RETAIL_PUBLIC_KEY || extractField("Public Key");
  const secretKey = process.env.MITO_RETAIL_SECRET_KEY || extractField("Secret Key");

  if (!username || !password || !accessAffiliateNumber || !accessServiceNumber || !apiKey) {
    cachedCredentials = null;
    return null;
  }

  cachedCredentials = {
    baseUrl,
    username,
    password,
    accessAffiliateNumber,
    accessServiceNumber,
    apiKey,
    webhookSecretKey,
    publicKey,
    secretKey,
  };
  return cachedCredentials;
}

export function __resetMitoRetailCacheForTests(): void {
  cachedCredentials = undefined;
  cachedToken = null;
  localMitoBeneficiariesByUser.clear();
}

export function isMitoRetailConfigured(): boolean {
  if (process.env.VITEST && process.env.MITO_RETAIL_ALLOW_IN_VITEST !== "1") return false;
  return loadMitoRetailCredentials() !== null;
}

export async function getMitoRetailToken(forceRefresh = false): Promise<{ token: string; partnerUserId: string }> {
  const creds = loadMitoRetailCredentials();
  if (!creds) {
    throw new Error("Mito Retail credentials are not configured.");
  }

  const now = Date.now();
  if (!forceRefresh && cachedToken && cachedToken.expiresAtMs - now > 120_000) {
    return { token: cachedToken.token, partnerUserId: cachedToken.userId };
  }

  const authPayload = JSON.stringify({
    username: creds.username,
    password: creds.password,
    accessServiceNumber: creds.accessServiceNumber,
    accessAffiliateNumber: creds.accessAffiliateNumber,
  });

  let res!: Response;
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetch(`${creds.baseUrl}/api/v1/mito/Auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apiKey: creds.apiKey,
      },
      body: authPayload,
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok || (res.status !== 502 && res.status !== 503 && res.status !== 504) || attempt === 1) {
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  const body = (await res.json().catch(() => ({}))) as {
    data?: { token?: string; userId?: string };
    message?: string;
    code?: number;
  };

  if (!res.ok || !body?.data?.token) {
    throw new Error(body?.message || `Mito Auth/login failed with HTTP ${res.status}`);
  }

  const token = body.data.token;
  const partnerUserId = body.data.userId || "";
  let expiresAtMs = now + 55 * 60 * 1000;
  try {
    const [, payloadB64] = token.split(".");
    if (payloadB64) {
      const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as { exp?: number };
      if (claims.exp) {
        expiresAtMs = claims.exp * 1000;
      }
    }
  } catch {
    // Keep default 55m TTL if JWT decode fails
  }

  cachedToken = { token, userId: partnerUserId, expiresAtMs };
  return { token, partnerUserId };
}

/**
 * Maps an existing Rhemito AuthUser record (created from SignUpForm or BusinessStep2)
 * directly to Mito's `POST /api/v1/mito/Users` request body without requiring any UI changes.
 */
const USER_MAPPINGS_FILE = path.resolve(process.cwd(), ".dev-state", "mito-user-mappings.json");

function loadUserMappingsFromDisk(): void {
  try {
    if (!fs.existsSync(USER_MAPPINGS_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(USER_MAPPINGS_FILE, "utf8")) as {
      byRhemitoId?: Record<string, string>;
      byEmail?: Record<string, string>;
    };
    if (raw.byRhemitoId) {
      for (const [k, v] of Object.entries(raw.byRhemitoId)) {
        if (k && v) mitoUserIdByRhemitoId.set(k, v);
      }
    }
    if (raw.byEmail) {
      for (const [k, v] of Object.entries(raw.byEmail)) {
        if (k && v) mitoUserIdByEmail.set(k.toLowerCase(), v);
      }
    }
  } catch {
    // ignore corrupt disk cache
  }
}

function saveUserMappingsToDisk(): void {
  try {
    const dir = path.dirname(USER_MAPPINGS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const byRhemitoId: Record<string, string> = {};
    mitoUserIdByRhemitoId.forEach((v, k) => {
      byRhemitoId[k] = v;
    });
    const byEmail: Record<string, string> = {};
    mitoUserIdByEmail.forEach((v, k) => {
      byEmail[k] = v;
    });
    fs.writeFileSync(USER_MAPPINGS_FILE, JSON.stringify({ byRhemitoId, byEmail }, null, 2), "utf8");
  } catch {
    // ignore write failures
  }
}

loadUserMappingsFromDisk();
// Ensure David Beckham's Rhemito account & emails map to his Mito Sandbox userId
mitoUserIdByRhemitoId.set("b7774a7e-92b8-4832-9ddc-469c77daac15", "a7f8104d-2b24-4c94-937d-819871eda661");
mitoUserIdByEmail.set("mumtaz@email.com", "a7f8104d-2b24-4c94-937d-819871eda661");
mitoUserIdByEmail.set("mumtaz.mindz+01@gmail.com", "a7f8104d-2b24-4c94-937d-819871eda661");

function isDefaultDemoUser(rhemitoUserId?: string, email?: string): boolean {
  const cleanId = String(rhemitoUserId ?? "").trim();
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  return (
    cleanId === "user_123" ||
    cleanId === "user_demo_payer" ||
    cleanEmail === "demo@rhemito.com" ||
    cleanEmail === "payer@rhemito.com"
  );
}

export function mapAuthUserToMitoCreatePayload(user: AuthUser): MitoRetailUserPayload {
  const countryIso3 = toCountryIso3(user.country);
  const addressCountryIso3 = toCountryIso3(user.addressCountry || user.country);
  const birthCountryIso3 = toCountryIso3(user.birthCountry || user.country);
  const isBusiness = user.accountType === "business";

  const dialCode = (user.mobileCode || user.businessPhoneCode || COUNTRY_DEFAULT_DIAL[countryIso3] || "+44").trim();
  const fallbackPhoneSeed = `${user.id || ""}:${(user.email || "").trim().toLowerCase()}`;
  const fallbackPhoneDigits = crypto
    .createHash("sha256")
    .update(fallbackPhoneSeed)
    .digest("hex")
    .split("")
    .map((ch) => String(parseInt(ch, 16) % 10))
    .join("")
    .slice(0, 8);
  const defaultLocalPhone = `77${fallbackPhoneDigits.padEnd(8, "0")}`;
  const rawPhone = (user.mobileNumber || user.businessPhoneNumber || defaultLocalPhone).replace(/\s+/g, "").replace(/^0+/, "");
  const phoneNumber = rawPhone.startsWith("+") ? rawPhone : `${dialCode}${rawPhone}`;

  let firstName = (user.firstName || "").trim();
  let lastName = (user.lastName || "").trim();
  if (isBusiness && (!firstName || !lastName) && user.directorName) {
    const parts = user.directorName.trim().split(/\s+/);
    firstName = firstName || parts[0] || "Director";
    lastName = lastName || parts.slice(1).join(" ") || "Account";
  }
  firstName = firstName || "Customer";
  lastName = lastName || "User";

  const genderRaw = String(user.gender ?? "").trim().toLowerCase();
  const gender: "M" | "F" = genderRaw === "female" || genderRaw === "f" ? "F" : "M";

  return {
    countryIso3,
    email: user.email.trim().toLowerCase(),
    phoneNumber,
    firstName,
    middleName: (user.middleName || "").trim(),
    lastName,
    gender,
    legalEntityType: isBusiness ? "B" : "I",
    companyNumber: isBusiness ? (user.businessRegNo || "").trim() : "",
    businessName: isBusiness ? (user.businessName || "").trim() : "",
    dateOfBirth: (user.dateOfBirth || "").trim(),
    buildingNumber: (user.buildingNumber || "").trim(),
    buildingName: (user.buildingName || "").trim(),
    subStreet: (user.subStreet || "").trim(),
    street: (user.street || "").trim(),
    addressCity: (user.addressCity || "").trim(),
    addressPostcode: (user.addressPostcode || "").trim(),
    addressCountryIso3,
    birthCountryIso3,
  };
}

/**
 * Valid, KYC-approved Mito Sandbox Sender User ID (`5887d933-28da-43e0-b171-33b949218e86`)
 * specified by the user for sending money and beneficiary operations.
 */
export const DEFAULT_MITO_SENDER_USER_ID = (
  process.env.MITO_DEFAULT_SENDER_USER_ID || "5887d933-28da-43e0-b171-33b949218e86"
).trim();

export async function findMitoRetailUserByEmail(email: string): Promise<{ userId: string; email: string } | null> {
  const creds = loadMitoRetailCredentials();
  if (!creds) return null;

  const { token } = await getMitoRetailToken();
  const cleanEmail = email.trim().toLowerCase();
  const res = await fetch(
    `${creds.baseUrl}/api/v1/mito/Users?email=${encodeURIComponent(cleanEmail)}&PageNo=1&PageSize=50`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) return null;

  const body = (await res.json().catch(() => ({}))) as {
    data?: Array<{ userId?: string; id?: string; email?: string }> | { items?: Array<{ userId?: string; id?: string; email?: string }> };
  };
  const list = Array.isArray(body.data) ? body.data : body.data?.items || [];
  const found = list.find(
    (u) => (u.userId || u.id) && String(u.email ?? "").trim().toLowerCase() === cleanEmail,
  );
  const resolvedId = found?.userId || found?.id;
  if (!resolvedId) return null;

  mitoUserIdByEmail.set(cleanEmail, resolvedId);
  saveUserMappingsToDisk();
  return { userId: resolvedId, email: cleanEmail };
}

/**
 * Registers a Rhemito user in Mito Sandbox (`POST /api/v1/mito/Users`).
 * If the email already exists in Mito Sandbox, resolves and links the existing `userId`.
 */
export interface MitoRetailUpdateUserPayload {
  userId: string;
  phoneNumber: string;
  firstName: string;
  middleName: string;
  lastName: string;
  gender: "M" | "F";
  dateOfBirth: string;
  buildingNumber: string;
  buildingName: string;
  subStreet: string;
  street: string;
  addressCity: string;
  addressPostcode: string;
  addressCountryIso3: string;
  birthCountryIso3: string;
}

export async function updateMitoRetailUser(payload: MitoRetailUpdateUserPayload): Promise<boolean> {
  if (!isMitoRetailConfigured()) return false;
  try {
    const creds = loadMitoRetailCredentials()!;
    const { token } = await getMitoRetailToken();
    const res = await fetch(`${creds.baseUrl}/api/v1/mito/Users/UpdateUser`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      log(`✅ Updated Mito Sandbox user (mitoUserId=${payload.userId})`, "mito-retail");
      return true;
    }
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    log(`⚠️ Mito POST /api/v1/mito/Users/UpdateUser returned ${res.status}: ${body?.message || "Unknown"}`, "mito-retail");
    return false;
  } catch (err) {
    log(`⚠️ Failed to update Mito user ${payload.userId}: ${(err as Error).message}`, "mito-retail");
    return false;
  }
}

export async function registerOrSyncMitoRetailUser(user: AuthUser): Promise<string | null> {
  if (!isMitoRetailConfigured()) return null;

  const cleanEmail = user.email.trim().toLowerCase();
  const cachedId = mitoUserIdByRhemitoId.get(user.id) || mitoUserIdByEmail.get(cleanEmail);
  if (cachedId) {
    mitoUserIdByRhemitoId.set(user.id, cachedId);
    saveUserMappingsToDisk();
    return cachedId;
  }

  try {
    const creds = loadMitoRetailCredentials()!;
    const { token } = await getMitoRetailToken();
  const payload = mapAuthUserToMitoCreatePayload(user);
  const preExisting = await findMitoRetailUserByEmail(cleanEmail).catch(() => null);
  if (preExisting?.userId) {
    mitoUserIdByRhemitoId.set(user.id, preExisting.userId);
    mitoUserIdByEmail.set(cleanEmail, preExisting.userId);
    saveUserMappingsToDisk();
    if (payload.street && payload.addressCity && payload.addressPostcode && payload.dateOfBirth) {
      await updateMitoRetailUser({
        userId: preExisting.userId,
        phoneNumber: payload.phoneNumber,
        firstName: payload.firstName,
        middleName: payload.middleName,
        lastName: payload.lastName,
        gender: payload.gender,
        dateOfBirth: payload.dateOfBirth,
        buildingNumber: payload.buildingNumber,
        buildingName: payload.buildingName,
        subStreet: payload.subStreet,
        street: payload.street,
        addressCity: payload.addressCity,
        addressPostcode: payload.addressPostcode,
        addressCountryIso3: payload.addressCountryIso3,
        birthCountryIso3: payload.birthCountryIso3,
      }).catch(() => false);
    }
    log(`ℹ️ Linked existing Mito Sandbox user ${cleanEmail} (mitoUserId=${preExisting.userId})`, "mito-retail");
    return preExisting.userId;
  }

    const res = await fetch(`${creds.baseUrl}/api/v1/mito/Users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const body = (await res.json().catch(() => ({}))) as {
      data?: { userId?: string };
      message?: string;
    };

    if (res.ok && body?.data?.userId) {
      const mitoUserId = body.data.userId;
      mitoUserIdByRhemitoId.set(user.id, mitoUserId);
      mitoUserIdByEmail.set(cleanEmail, mitoUserId);
      saveUserMappingsToDisk();
      log(`✅ Synced user ${cleanEmail} to Mito Sandbox (mitoUserId=${mitoUserId})`, "mito-retail");
      return mitoUserId;
    }

    // If user already exists in Mito Sandbox, look up their userId by email
    const existing = await findMitoRetailUserByEmail(cleanEmail);
    if (existing?.userId) {
      mitoUserIdByRhemitoId.set(user.id, existing.userId);
      mitoUserIdByEmail.set(cleanEmail, existing.userId);
      saveUserMappingsToDisk();
      log(`ℹ️ Linked existing Mito Sandbox user ${cleanEmail} (mitoUserId=${existing.userId})`, "mito-retail");
      return existing.userId;
    }

    log(`⚠️ Mito POST /api/v1/mito/Users returned ${res.status}: ${body?.message || "Unknown error"}`, "mito-retail");
    return isDefaultDemoUser(user.id, cleanEmail) ? DEFAULT_MITO_SENDER_USER_ID || null : null;
  } catch (err) {
    log(`⚠️ Failed to sync user ${cleanEmail} to Mito Sandbox: ${(err as Error).message}`, "mito-retail");
    return isDefaultDemoUser(user.id, cleanEmail) ? DEFAULT_MITO_SENDER_USER_ID || null : null;
  }
}

/**
 * Returns the active Mito Sender User ID (`5887d933-28da-43e0-b171-33b949218e86` by default)
 * for sending money and beneficiary operations.
 */
export function getMitoUserIdForUser(rhemitoUserId: string, email?: string): string | null {
  if (DEFAULT_MITO_SENDER_USER_ID && isDefaultDemoUser(rhemitoUserId, email)) {
    return DEFAULT_MITO_SENDER_USER_ID;
  }
  const byId = mitoUserIdByRhemitoId.get(rhemitoUserId);
  if (byId) return byId;
  if (email) {
    const byEmail = mitoUserIdByEmail.get(email.trim().toLowerCase());
    if (byEmail) return byEmail;
  }
  return null;
}

/**
 * Reverse lookup from a Mito `userId` UUID to the Rhemito `user.id` if known.
 */
export function resolveRhemitoUserIdFromMitoUserId(mitoUserId: string | null | undefined): string | null {
  const clean = String(mitoUserId ?? "").trim().toLowerCase();
  if (!clean) return null;
  for (const [rhemitoId, mappedMitoId] of Array.from(mitoUserIdByRhemitoId.entries())) {
    if (String(mappedMitoId || "").trim().toLowerCase() === clean) {
      return rhemitoId;
    }
  }
  return null;
}

/**
 * Returns the public/configured Mito Retail webhook URL.
 */
export function getMitoWebhookUrl(): string {
  const envUrl = (process.env.MITO_RETAIL_WEBHOOK_URL || "").trim();
  if (envUrl) return envUrl;
  return `${serverConfig.publicBaseUrl.replace(/\/+$/, "")}/api/webhooks/mito`;
}

const CURRENCY_TO_COUNTRY_ISO3: Record<string, string> = {
  GBP: "GBR",
  USD: "USA",
  EUR: "DEU",
  NGN: "NGA",
  INR: "IND",
  GHS: "GHA",
  KES: "KEN",
  ZAR: "ZAF",
  CAD: "CAN",
  AED: "ARE",
  AUD: "AUS",
  CNY: "CHN",
  JPY: "JPN",
  UGX: "UGA",
  SGD: "SGP",
};

export function currencyToCountryIso3(currency: string | null | undefined): string {
  const clean = String(currency ?? "").trim().toUpperCase();
  return CURRENCY_TO_COUNTRY_ISO3[clean] ?? "NGA";
}

export function serviceToMitoCollectionMode(service: string | null | undefined): "BANKACCOUNT" | "MOBILEMONEY" {
  if (service === "mobile_money" || service === "MOBILEMONEY") return "MOBILEMONEY";
  return "BANKACCOUNT";
}

export interface MitoAffiliateRate {
  rateId: string;
  fromCurrency: string;
  toCurrency: string;
  fromCountry: string;
  toCountry: string;
  rateMoneyTransfer: number;
  partnerRateMoneyTransfer: number;
  refreshFrequency: number;
  rateExpiry: string;
  rateDirection?: string;
}

export interface MitoProviderItem {
  providerCode: string;
  providerName: string;
  providerId: string;
  isGeneric: boolean;
  /** `true` for Swift / international options (from `Static/Providers`); `false` for local (direct-to-bank) providers. */
  isInternational?: boolean;
}

export interface MitoLookupTypesData {
  reason?: Array<{ name: string; code: string; id?: string }>;
  sourceOfFunds?: Array<{ name: string; code: string; id?: string }>;
  relationships?: Array<{ name: string; code: string; id?: string }>;
  identificationType?: Array<{ name: string; code: string; id?: string }>;
}

/**
 * Fetches corridor exchange rates from `GET /api/v1/mito/Exchange/affiliateRates`.
 */
export async function getMitoAffiliateRates(params?: {
  fromCurrency?: string;
  toCurrency?: string;
  fromCountry?: string;
  toCountry?: string;
  userId?: string;
}): Promise<MitoAffiliateRate[]> {
  if (!isMitoRetailConfigured()) return [];
  const creds = loadMitoRetailCredentials()!;
  const { token } = await getMitoRetailToken();

  const qs = new URLSearchParams();
  if (params?.fromCurrency) qs.set("FromCurrency", params.fromCurrency.toUpperCase());
  if (params?.toCurrency) qs.set("ToCurrency", params.toCurrency.toUpperCase());
  if (params?.fromCountry) qs.set("FromCountry", params.fromCountry.toUpperCase());
  if (params?.toCountry) qs.set("ToCountry", params.toCountry.toUpperCase());
  if (params?.userId) qs.set("userId", params.userId);

  const queryString = qs.toString();
  const url = `${creds.baseUrl}/api/v1/mito/Exchange/affiliateRates${queryString ? `?${queryString}` : ""}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];

  const body = (await res.json().catch(() => ({}))) as { data?: MitoAffiliateRate[] };
  return Array.isArray(body.data) ? body.data : [];
}

/**
 * Fetches beneficiary bank/mobile providers from `GET /api/v1/mito/Lookups/provider`
 * using `countryIso3`, `serviceCode`, `collectionMode` (BANKACCOUNT | MOBILEMONEY), and `CurrencyCode`.
 */
export async function getMitoProviders(params: {
  countryIso3: string;
  currencyCode?: string;
  serviceCode?: string;
  collectionMode?: "BANKACCOUNT" | "MOBILEMONEY";
}): Promise<MitoProviderItem[]> {
  if (!isMitoRetailConfigured()) return [];
  const creds = loadMitoRetailCredentials()!;
  const { token } = await getMitoRetailToken();

  const resolvedCountryIso3 = toCountryIso3(params.countryIso3);
  const resolvedMode = params.collectionMode === "MOBILEMONEY" ? "MOBILEMONEY" : "BANKACCOUNT";
  const qs = new URLSearchParams({
    countryIso3: resolvedCountryIso3,
    serviceCode: params.serviceCode || "MONEYTRANSFER",
    collectionMode: resolvedMode,
  });
  if (params.currencyCode) {
    qs.set("CurrencyCode", params.currencyCode.toUpperCase());
  }

  const res = await fetch(`${creds.baseUrl}/api/v1/mito/Lookups/provider?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];

  const body = (await res.json().catch(() => ({}))) as { data?: MitoProviderItem[] };
  return Array.isArray(body.data) ? body.data : [];
}

export interface MitoProvidersDetailed {
  local: MitoProviderItem[];
  international: MitoProviderItem[];
  /** `local` followed by `international`, de-duplicated by provider id. */
  providers: MitoProviderItem[];
  source: "mito" | "fallback";
}

type FallbackBankSeed = [code: string, name: string];

const FALLBACK_BANKS_BY_ISO3: Record<string, FallbackBankSeed[]> = {
  GBR: [
    ["BARCGB", "Barclays"],
    ["HSBCGB", "HSBC UK"],
    ["LOYDGB", "Lloyds Bank"],
    ["NWBKGB", "NatWest"],
    ["SANTGB", "Santander UK"],
    ["MONZGB", "Monzo"],
    ["STRLGB", "Starling Bank"],
  ],
  NGA: [
    ["ABNGNG", "Access Bank"],
    ["GTBINGLA", "Guaranty Trust Bank (GTBank)"],
    ["ZEIBNG", "Zenith Bank"],
    ["FBNINGLA", "First Bank of Nigeria"],
    ["UNAFNG", "United Bank for Africa (UBA)"],
  ],
  USA: [
    ["CHASUS", "JPMorgan Chase"],
    ["BOFAUS", "Bank of America"],
    ["WFBIUS", "Wells Fargo"],
    ["CITIUS", "Citibank"],
  ],
  CAN: [
    ["ROYCCA", "Royal Bank of Canada"],
    ["TDOMCA", "TD Canada Trust"],
    ["NOSCCA", "Scotiabank"],
    ["BOFMCA", "BMO Bank of Montreal"],
  ],
  GHA: [
    ["GHCBGH", "GCB Bank"],
    ["ECOCGH", "Ecobank Ghana"],
    ["SBICGH", "Stanbic Bank Ghana"],
    ["ABSAGH", "Absa Bank Ghana"],
  ],
  KEN: [
    ["KCBLKE", "KCB Bank"],
    ["EQBLKE", "Equity Bank"],
    ["COOPKE", "Co-operative Bank of Kenya"],
    ["ABSAKE", "Absa Bank Kenya"],
  ],
  ZAF: [
    ["SBZAZA", "Standard Bank"],
    ["FIRNZA", "First National Bank (FNB)"],
    ["ABSAZA", "Absa Bank"],
    ["NEDSZA", "Nedbank"],
  ],
  DEU: [
    ["DEUTDE", "Deutsche Bank"],
    ["COBADE", "Commerzbank"],
    ["DRESDE", "Postbank"],
  ],
  FRA: [
    ["BNPAFR", "BNP Paribas"],
    ["SOGEFR", "Société Générale"],
    ["AGRIFR", "Crédit Agricole"],
  ],
  IND: [
    ["SBININ", "State Bank of India"],
    ["HDFCIN", "HDFC Bank"],
    ["ICICIN", "ICICI Bank"],
    ["AXISIN", "Axis Bank"],
  ],
  CHN: [
    ["ICBKCN", "Industrial and Commercial Bank of China"],
    ["BKCHCN", "Bank of China"],
    ["PCBCCN", "China Construction Bank"],
  ],
  ARE: [
    ["EBILAE", "Emirates NBD"],
    ["ADCBAE", "Abu Dhabi Commercial Bank"],
    ["NBADAE", "First Abu Dhabi Bank"],
  ],
  AUS: [
    ["CTBAAU", "Commonwealth Bank"],
    ["WPACAU", "Westpac"],
    ["ANZBAU", "ANZ"],
    ["NATAAU", "National Australia Bank"],
  ],
  JPN: [
    ["BOTKJP", "MUFG Bank"],
    ["SMBCJP", "Sumitomo Mitsui Banking Corporation"],
    ["MHCBJP", "Mizuho Bank"],
  ],
};

const FALLBACK_MOBILE_OPERATORS_BY_ISO3: Record<string, FallbackBankSeed[]> = {
  NGA: [
    ["MTNNG", "MTN Mobile Money"],
    ["AIRTNG", "Airtel Money"],
  ],
  GHA: [
    ["MTNGH", "MTN Mobile Money"],
    ["VODGH", "Vodafone Cash"],
    ["AIRTGH", "AirtelTigo Money"],
  ],
  KEN: [
    ["MPESAKE", "M-Pesa"],
    ["AIRTKE", "Airtel Money"],
  ],
  ZAF: [
    ["MTNZA", "MTN MoMo"],
    ["VODZA", "Vodacom M-Pesa"],
  ],
  IND: [["PAYTMIN", "Paytm Wallet"]],
};

const DEFAULT_FALLBACK_MOBILE_OPERATORS: FallbackBankSeed[] = [
  ["MTNMM", "MTN Mobile Money"],
  ["AIRTMM", "Airtel Money"],
  ["VODMM", "Vodafone Cash"],
  ["MPESAMM", "M-Pesa"],
];

/** Id prefix of synthesized providers; they are never sent upstream to Mito as real provider ids. */
export const FALLBACK_PROVIDER_ID_PREFIX = "fallback-";

/**
 * Clean corridor fallback providers (never empty) used when Mito is offline/unconfigured/`VITEST` or has no
 * providers for the corridor, so the bank/operator picker always has something to show.
 */
export function getFallbackMitoProviders(params: {
  countryIso3: string;
  collectionMode?: "BANKACCOUNT" | "MOBILEMONEY";
}): MitoProvidersDetailed {
  const iso3 = toCountryIso3(params.countryIso3);
  const isMobile = params.collectionMode === "MOBILEMONEY";
  const seeds = isMobile
    ? FALLBACK_MOBILE_OPERATORS_BY_ISO3[iso3] ?? DEFAULT_FALLBACK_MOBILE_OPERATORS
    : FALLBACK_BANKS_BY_ISO3[iso3] ?? [[`BANK${iso3}`, "Bank"] as FallbackBankSeed];
  const local: MitoProviderItem[] = seeds.map(([code, name]) => ({
    providerCode: code,
    providerName: name,
    providerId: `${FALLBACK_PROVIDER_ID_PREFIX}${iso3.toLowerCase()}-${code.toLowerCase()}`,
    isGeneric: false,
    isInternational: false,
  }));
  const international: MitoProviderItem[] = isMobile
    ? []
    : [
        {
          providerCode: "SWIFT",
          providerName: "Swift (international bank transfer)",
          providerId: `${FALLBACK_PROVIDER_ID_PREFIX}${iso3.toLowerCase()}-swift`,
          isGeneric: true,
          isInternational: true,
        },
      ];
  return { local, international, providers: [...local, ...international], source: "fallback" };
}

function normalizeStaticProvider(raw: any, forceInternational?: boolean): MitoProviderItem | null {
  if (!raw || typeof raw !== "object") return null;
  const providerId = String(raw.providerId ?? raw.id ?? raw.ProviderId ?? "").trim();
  const providerName = String(raw.providerName ?? raw.name ?? raw.ProviderName ?? "").trim();
  if (!providerId || !providerName) return null;
  const providerCode = String(raw.providerCode ?? raw.code ?? raw.ProviderCode ?? "").trim();
  const flag = raw.isInternational ?? raw.international ?? raw.IsInternational;
  return {
    providerId,
    providerName,
    providerCode,
    isGeneric: Boolean(raw.isGeneric ?? raw.IsGeneric ?? false),
    isInternational: forceInternational ?? Boolean(flag),
  };
}

/**
 * Local (direct-to-bank) vs international (Swift) providers. Combines `GET /api/v1/mito/Lookups/provider`
 * (local) with `GET /api/v1/Static/Providers` (local + international), and never returns an empty picker:
 * when offline/unconfigured/`VITEST` (or the corridor has none) it synthesizes clean fallback providers.
 */
export async function getMitoProvidersDetailed(params: {
  countryIso3: string;
  currencyCode?: string;
  serviceCode?: string;
  collectionMode?: "BANKACCOUNT" | "MOBILEMONEY";
}): Promise<MitoProvidersDetailed> {
  const resolvedCountryIso3 = toCountryIso3(params.countryIso3);
  const resolvedMode: "BANKACCOUNT" | "MOBILEMONEY" =
    params.collectionMode === "MOBILEMONEY" ? "MOBILEMONEY" : "BANKACCOUNT";
  const fallback = () =>
    getFallbackMitoProviders({ countryIso3: resolvedCountryIso3, collectionMode: resolvedMode });

  if (!isMitoRetailConfigured() || process.env.VITEST) {
    return fallback();
  }

  let lookupProviders: MitoProviderItem[] = [];
  try {
    lookupProviders = await getMitoProviders({ ...params, countryIso3: resolvedCountryIso3, collectionMode: resolvedMode });
  } catch {
    lookupProviders = [];
  }

  let staticProviders: MitoProviderItem[] = [];
  try {
    const creds = loadMitoRetailCredentials()!;
    const qs = new URLSearchParams({
      CountryIso3: resolvedCountryIso3,
      CurrencyCode: String(params.currencyCode || "").toUpperCase(),
      ServiceCode: params.serviceCode || "MONEYTRANSFER",
      CollectionMode: resolvedMode,
    });
    const res = await fetch(`${creds.baseUrl}/api/v1/Static/Providers?${qs.toString()}`, {
      headers: { apiKey: creds.apiKey, affiliateId: creds.accessAffiliateNumber },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { data?: unknown };
      const data = body.data as any;
      const list: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.providers)
          ? data.providers
          : [];
      staticProviders = list.map((p) => normalizeStaticProvider(p)).filter((p): p is MitoProviderItem => Boolean(p));
    }
  } catch {
    staticProviders = [];
  }

  const seen = new Set<string>();
  const local: MitoProviderItem[] = [];
  const international: MitoProviderItem[] = [];
  const push = (item: MitoProviderItem, intl: boolean) => {
    const key = `${intl ? "I" : "L"}:${item.providerId.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    (intl ? international : local).push({ ...item, isInternational: intl, isGeneric: Boolean(item.isGeneric) });
  };
  lookupProviders.forEach((p) => push(p, false));
  staticProviders.forEach((p) => push(p, Boolean(p.isInternational)));

  if (local.length === 0 && international.length === 0) {
    return fallback();
  }
  return {
    local,
    international,
    providers: [...local, ...international],
    source: "mito",
  };
}

/**
 * Fetches lookup codes (`reason`, `source-of-funds`, `relationships`, `identification-types`)
 * from `GET /api/v1/mito/Lookups/types`.
 */
export async function getMitoLookupTypes(
  filter = "reason,source-of-funds,relationships",
): Promise<MitoLookupTypesData> {
  if (!isMitoRetailConfigured()) return {};
  const creds = loadMitoRetailCredentials()!;
  const { token } = await getMitoRetailToken();

  const res = await fetch(
    `${creds.baseUrl}/api/v1/mito/Lookups/types?filter=${encodeURIComponent(filter)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) return {};

  const body = (await res.json().catch(() => ({}))) as { data?: MitoLookupTypesData };
  return body.data ?? {};
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
  section?: "Personal" | "Identification" | "Banking";
  fieldInformation?: string | null;
  dropdownOptions?: Array<{ name: string; id: string }>;
}

/**
 * Fetches dynamic beneficiary field requirements for the target country/currency/provider/entityType
 * from `GET /api/v1/mito/Beneficiaries/requirements`.
 */
export async function getMitoBeneficiaryRequirements(params: {
  providerId: string;
  toCountry: string;
  toCurrencyCode: string;
  entityType: "I" | "B";
  serviceCode?: string;
  collectionMode?: "BANKACCOUNT" | "MOBILEMONEY";
  isInternational?: boolean;
}): Promise<MitoBeneficiaryRequirementField[]> {
  if (!isMitoRetailConfigured()) return [];
  const creds = loadMitoRetailCredentials()!;
  const { token } = await getMitoRetailToken();

  const qs = new URLSearchParams({
    providerId: params.providerId,
    toCountry: params.toCountry.toUpperCase(),
    toCurrencyCode: params.toCurrencyCode.toUpperCase(),
    entityType: params.entityType,
    ServiceCode: params.serviceCode || "MONEYTRANSFER",
    collectionMode: params.collectionMode || "BANKACCOUNT",
  });
  if (params.isInternational !== undefined) {
    qs.set("international", params.isInternational ? "true" : "false");
  }

  const res = await fetch(
    `${creds.baseUrl}/api/v1/mito/Beneficiaries/requirements?${qs.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) return [];

  const body = (await res.json().catch(() => ({}))) as {
    data?: MitoBeneficiaryRequirementField[];
  };
  return Array.isArray(body.data) ? body.data : [];
}

function normalizeRequirementKey(name: string): string {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Requirements for the beneficiary form: Mito's own fields when available, otherwise (offline, `VITEST`, empty
 * or missing the banking fields of a bank deposit) the corridor templates from `@shared/beneficiaryRequirements`.
 * Always tagged with a `section` and sorted mandatory-first.
 */
export async function getMitoBeneficiaryRequirementsWithFallback(params: {
  providerId?: string;
  toCountry: string;
  toCurrencyCode: string;
  entityType: "I" | "B";
  serviceCode?: string;
  collectionMode?: "BANKACCOUNT" | "MOBILEMONEY";
  isInternational?: boolean;
}): Promise<{ requirements: MitoBeneficiaryRequirementField[]; source: "mito" | "fallback" }> {
  let upstream: MitoBeneficiaryRequirementField[] = [];
  if (params.providerId && !params.providerId.startsWith(FALLBACK_PROVIDER_ID_PREFIX) && !process.env.VITEST) {
    try {
      upstream = await getMitoBeneficiaryRequirements({
        providerId: params.providerId,
        toCountry: params.toCountry,
        toCurrencyCode: params.toCurrencyCode,
        entityType: params.entityType,
        serviceCode: params.serviceCode,
        collectionMode: params.collectionMode,
        isInternational: params.isInternational,
      });
    } catch {
      upstream = [];
    }
  }

  const service: "bank_deposit" | "mobile_money" =
    params.collectionMode === "MOBILEMONEY" ? "mobile_money" : "bank_deposit";
  const fallbackFields = getFallbackBeneficiaryRequirements({
    currencyCode: params.toCurrencyCode,
    countryIso3: params.toCountry,
    entityType: params.entityType,
    service,
    isInternational: params.isInternational,
  });

  if (upstream.length === 0) {
    return { requirements: fallbackFields, source: "fallback" };
  }

  const tagged: MitoBeneficiaryRequirementField[] = upstream.map((f) => ({
    ...f,
    section: f.section ?? classifyRequirementSection(f.name),
  }));
  if (service === "bank_deposit" && !tagged.some((f) => f.section === "Banking")) {
    const have = new Set(tagged.map((f) => normalizeRequirementKey(f.name)));
    const maxOrder = tagged.reduce((m, f) => Math.max(m, Number(f.order) || 0), 0);
    fallbackFields
      .filter((f) => f.section === "Banking" && !have.has(normalizeRequirementKey(f.name)))
      .forEach((f, i) => tagged.push({ ...f, order: maxOrder + i + 1 }));
  }
  return { requirements: sortFieldsMandatoryFirst(tagged), source: "mito" };
}

export interface MitoProvinceState {
  id: string;
  name: string;
  code?: string;
}

const FALLBACK_PROVINCES_RAW: Record<string, string> = {
  USA: "Alabama:AL,Alaska:AK,Arizona:AZ,Arkansas:AR,California:CA,Colorado:CO,Connecticut:CT,Delaware:DE,District of Columbia:DC,Florida:FL,Georgia:GA,Hawaii:HI,Idaho:ID,Illinois:IL,Indiana:IN,Iowa:IA,Kansas:KS,Kentucky:KY,Louisiana:LA,Maine:ME,Maryland:MD,Massachusetts:MA,Michigan:MI,Minnesota:MN,Mississippi:MS,Missouri:MO,Montana:MT,Nebraska:NE,Nevada:NV,New Hampshire:NH,New Jersey:NJ,New Mexico:NM,New York:NY,North Carolina:NC,North Dakota:ND,Ohio:OH,Oklahoma:OK,Oregon:OR,Pennsylvania:PA,Rhode Island:RI,South Carolina:SC,South Dakota:SD,Tennessee:TN,Texas:TX,Utah:UT,Vermont:VT,Virginia:VA,Washington:WA,West Virginia:WV,Wisconsin:WI,Wyoming:WY",
  CAN: "Alberta:AB,British Columbia:BC,Manitoba:MB,New Brunswick:NB,Newfoundland and Labrador:NL,Northwest Territories:NT,Nova Scotia:NS,Nunavut:NU,Ontario:ON,Prince Edward Island:PE,Quebec:QC,Saskatchewan:SK,Yukon:YT",
  NGA: "Abia:AB,Adamawa:AD,Akwa Ibom:AK,Anambra:AN,Bauchi:BA,Bayelsa:BY,Benue:BE,Borno:BO,Cross River:CR,Delta:DE,Ebonyi:EB,Edo:ED,Ekiti:EK,Enugu:EN,Federal Capital Territory:FC,Gombe:GO,Imo:IM,Jigawa:JI,Kaduna:KD,Kano:KN,Katsina:KT,Kebbi:KE,Kogi:KO,Kwara:KW,Lagos:LA,Nasarawa:NA,Niger:NI,Ogun:OG,Ondo:ON,Osun:OS,Oyo:OY,Plateau:PL,Rivers:RI,Sokoto:SO,Taraba:TA,Yobe:YO,Zamfara:ZA",
  IND: "Andhra Pradesh:AP,Arunachal Pradesh:AR,Assam:AS,Bihar:BR,Chhattisgarh:CG,Delhi:DL,Goa:GA,Gujarat:GJ,Haryana:HR,Himachal Pradesh:HP,Jammu and Kashmir:JK,Jharkhand:JH,Karnataka:KA,Kerala:KL,Madhya Pradesh:MP,Maharashtra:MH,Manipur:MN,Meghalaya:ML,Mizoram:MZ,Nagaland:NL,Odisha:OD,Punjab:PB,Rajasthan:RJ,Sikkim:SK,Tamil Nadu:TN,Telangana:TS,Tripura:TR,Uttar Pradesh:UP,Uttarakhand:UK,West Bengal:WB",
  AUS: "Australian Capital Territory:ACT,New South Wales:NSW,Northern Territory:NT,Queensland:QLD,South Australia:SA,Tasmania:TAS,Victoria:VIC,Western Australia:WA",
};

export function getFallbackProvinceStates(countryIso3: string): MitoProvinceState[] {
  const iso3 = toCountryIso3(countryIso3);
  const raw = FALLBACK_PROVINCES_RAW[iso3];
  if (!raw) return [];
  return raw.split(",").map((entry) => {
    const idx = entry.lastIndexOf(":");
    const name = entry.slice(0, idx);
    const code = entry.slice(idx + 1);
    return { id: `${iso3}-${code}`, name, code };
  });
}

/**
 * States / provinces of a country from `GET /api/v1/Static/ProvinceState?countryiso3=...`
 * (static fallback for USA, CAN, NGA, IND, AUS when offline/unconfigured/`VITEST`/empty).
 */
export async function getMitoProvinceStates(countryIso3: string): Promise<MitoProvinceState[]> {
  const iso3 = toCountryIso3(countryIso3);
  if (!isMitoRetailConfigured() || process.env.VITEST) return getFallbackProvinceStates(iso3);
  try {
    const creds = loadMitoRetailCredentials()!;
    const res = await fetch(
      `${creds.baseUrl}/api/v1/Static/ProvinceState?countryiso3=${encodeURIComponent(iso3)}`,
      {
        headers: { apiKey: creds.apiKey, affiliateId: creds.accessAffiliateNumber },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { data?: unknown };
      const data = body.data as any;
      const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.provinces) ? data.provinces : [];
      const mapped = list
        .map((p): MitoProvinceState | null => {
          const id = String(p?.id ?? p?.stateProvinceId ?? p?.provinceStateId ?? "").trim();
          const name = String(p?.name ?? p?.stateProvinceName ?? p?.provinceStateName ?? "").trim();
          if (!name) return null;
          const code = String(p?.code ?? p?.stateProvinceCode ?? "").trim();
          return { id: id || name, name, ...(code ? { code } : {}) };
        })
        .filter((p): p is MitoProvinceState => Boolean(p));
      if (mapped.length > 0) return mapped;
    }
  } catch {
    // fall through to static fallback
  }
  return getFallbackProvinceStates(iso3);
}

/** Result of `verifyMitoBankingDetails` — never an error: `canContinue` is always `true`. */
export interface MitoBankVerificationResult {
  resolved: boolean;
  canContinue: true;
  source: "mito" | "unavailable" | "mock";
  accountHolderName: string | null;
  message: string | null;
  details?: Record<string, string>;
}

const BANK_LOOKUP_UNAVAILABLE_MESSAGE =
  "Automatic account name verification isn't available for this bank right now. Please double-check the account details and continue.";

/**
 * "Search bank details" — `POST /api/v1/Bank/GetBankingDetails` (`countryCode` is ISO3, e.g. `NGA`, `GBR`).
 * Never throws and never signals failure: unresolved lookups return `{ resolved: false, canContinue: true }`.
 */
export async function verifyMitoBankingDetails(params: {
  international?: boolean;
  countryIso3: string;
  providerId?: string;
  param: Array<{ parameter: string; value: string }>;
}): Promise<MitoBankVerificationResult> {
  const unavailable = (source: "mito" | "unavailable" = "unavailable"): MitoBankVerificationResult => ({
    resolved: false,
    canContinue: true,
    source,
    accountHolderName: null,
    message: BANK_LOOKUP_UNAVAILABLE_MESSAGE,
  });

  if (process.env.MITO_BANK_LOOKUP_MOCK === "1") {
    const details: Record<string, string> = {};
    for (const p of params.param || []) {
      if (p?.parameter && p?.value) details[String(p.parameter)] = String(p.value);
    }
    return {
      resolved: true,
      canContinue: true,
      source: "mock",
      accountHolderName: "MOCK ACCOUNT HOLDER",
      message: null,
      details,
    };
  }

  if (!isMitoRetailConfigured() || process.env.VITEST) return unavailable("unavailable");

  try {
    const creds = loadMitoRetailCredentials()!;
    const { token } = await getMitoRetailToken();
    const payload: Record<string, unknown> = {
      international: Boolean(params.international),
      countryCode: toCountryIso3(params.countryIso3).toUpperCase(),
      param: params.param,
    };
    if (params.providerId && !params.providerId.startsWith(FALLBACK_PROVIDER_ID_PREFIX)) {
      payload.providerId = params.providerId;
    }
    const res = await fetch(`${creds.baseUrl}/api/v1/Bank/GetBankingDetails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apiKey: creds.apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return unavailable("mito");

    const body = (await res.json().catch(() => ({}))) as { data?: Record<string, any> | null };
    const data = (body?.data && typeof body.data === "object" ? body.data : {}) as Record<string, any>;
    const pick = (...keys: string[]): string => {
      for (const k of keys) {
        const v = data[k];
        if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
      }
      return "";
    };
    const holder = pick("accountHolderName", "AccountHolderName", "account_name");
    const resolvedBankName = pick("bank_name", "bankName", "BankName");
    if (!holder && !resolvedBankName) return unavailable("mito");

    const details: Record<string, string> = {};
    const assign = (name: string, ...keys: string[]) => {
      const v = pick(...keys);
      if (v) details[name] = v;
    };
    assign("account_number", "account_number", "accountNumber", "AccountNumber");
    assign("bank_name", "bank_name", "bankName", "BankName");
    assign("bank_address", "bank_address", "bankAddress", "BankAddress");
    assign("bank_country", "bank_country", "bankCountry", "BankCountry");
    assign("iban", "iban", "Iban");
    assign("bic_swift", "bic_swift", "bicSwift", "BicSwift");
    assign("sort_code", "sort_code", "sortCode", "SortCode");
    assign("routing_number", "routing_number", "routingNumber", "RoutingNumber", "routing");
    assign("ifsc", "ifsc", "Ifsc");
    assign("aba", "aba", "Aba");
    assign("bsb_code", "bsb_code", "bsbCode", "BsbCode", "bsbcode");
    assign("branch_code", "branch_code", "branchCode", "BranchCode");
    assign("bank_code", "bank_code", "bankCode", "BankCode");
    assign("clabe", "clabe", "Clabe");
    assign("cnaps", "cnaps", "Cnaps");
    return {
      resolved: true,
      canContinue: true,
      source: "mito",
      accountHolderName: holder || null,
      message: null,
      details,
    };
  } catch {
    return unavailable("unavailable");
  }
}

export interface MitoBeneficiaryRecord {
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
  /** Beneficiary-journey parity (DEC-2026-11-19) — additive, optional. */
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

export type MitoBeneficiaryItem = MitoBeneficiaryRecord;

/**
 * Fetches the sender's beneficiaries from `GET /api/v1/mito/Beneficiaries?userId={{userId}}`
 * (with optional query params `serviceCode`, `collectionMode`, `legalEntityType`, `countryIso3`, `currencyIso`, `providerId`, `PageNo`)
 * and enriches each beneficiary with banking details from `GET /api/v1/mito/Beneficiaries/{beneficiaryId}`.
 */
interface MitoBeneficiaryListParams {
  userId: string;
  serviceCode?: string;
  collectionMode?: string;
  legalEntityType?: string;
  countryIso3?: string;
  currencyIso?: string;
  providerId?: string;
  pageNo?: number;
  searchingText?: string;
}

async function getMitoRemoteBeneficiaries(params: MitoBeneficiaryListParams): Promise<MitoBeneficiaryRecord[]> {
  if (!isMitoRetailConfigured() || !params.userId) return [];
  const creds = loadMitoRetailCredentials()!;
  const { token } = await getMitoRetailToken();

  const fetchSummaryList = async (searchQuery?: string) => {
    const qs = new URLSearchParams({
      userId: params.userId,
    });
    if (params.serviceCode) qs.set("serviceCode", params.serviceCode);
    if (params.collectionMode) qs.set("collectionMode", params.collectionMode);
    if (params.legalEntityType) qs.set("legalEntityType", params.legalEntityType);
    if (params.countryIso3) qs.set("countryIso3", params.countryIso3.toUpperCase());
    if (params.currencyIso) qs.set("currencyIso", params.currencyIso.toUpperCase());
    if (params.providerId) qs.set("providerId", params.providerId);
    if (params.pageNo) qs.set("PageNo", String(params.pageNo));
    if (searchQuery) qs.set("SearchingText", searchQuery);

    const res = await fetch(`${creds.baseUrl}/api/v1/mito/Beneficiaries?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];

    const body = (await res.json().catch(() => ({}))) as {
      data?: Array<{
        beneficiaryId?: string;
        countryIso3?: string;
        countryDescription?: string;
        currency?: string;
        beneficiaryFullName?: string;
        beneficiaryNickname?: string;
        legalEntityType?: string;
        serviceCode?: string;
        collectionMode?: string;
        createdAt?: string;
      }>;
    };
    return Array.isArray(body.data) ? body.data : [];
  };

  loadDeletedBeneficiariesFromDisk();
loadUpdatedBeneficiariesFromDisk();
  const isSummaryItemDeleted = (it: { beneficiaryId?: string; beneficiaryFullName?: string }) => {
    const idUpper = String(it.beneficiaryId || "").trim().toUpperCase();
    if (idUpper && deletedMitoBeneficiaryIds.has(idUpper)) return true;
    const nameOnlySig = it.beneficiaryFullName
      ? `${String(it.beneficiaryFullName).trim().toLowerCase()}|`
      : null;
    if (nameOnlySig && deletedMitoBeneficiarySignatures.has(nameOnlySig)) return true;
    return false;
  };

  const trimmedSearch = params.searchingText?.trim() || "";
  let items = (await fetchSummaryList(trimmedSearch || undefined)).filter(
    (it) => !isSummaryItemDeleted(it),
  );
  let fallbackSearchFilter = false;
  if (trimmedSearch && items.length === 0) {
    // Fallback: fetch all user beneficiaries so searching by bank name, account number, or partial name still matches
    items = (await fetchSummaryList(undefined)).filter(
      (it) => !isSummaryItemDeleted(it),
    );
    fallbackSearchFilter = true;
  }
  if (items.length === 0) return [];

  const detailed = await Promise.all(
    items.map(async (item) => {
      const beneficiaryId = String(item.beneficiaryId || "").trim();
      let detail: Record<string, any> = {};
      if (beneficiaryId) {
        try {
          const detailRes = await fetch(
            `${creds.baseUrl}/api/v1/mito/Beneficiaries/${encodeURIComponent(beneficiaryId)}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (detailRes.ok) {
            const detailJson = (await detailRes.json().catch(() => ({}))) as {
              data?: Record<string, any>;
            };
            if (detailJson.data && typeof detailJson.data === "object") {
              detail = detailJson.data;
            }
          }
        } catch {
          // keep summary fallback
        }
      }

      const rawEntity = String(detail.legalEntityType || item.legalEntityType || "I").toUpperCase();
      const isBusiness = rawEntity === "B" || rawEntity === "C" || rawEntity === "BUSINESS";
      const fullName = String(
        detail.companyName || detail.beneficiaryFullName || item.beneficiaryFullName || "Beneficiary",
      ).trim();
      const nameParts = fullName.split(/\s+/);
      const firstName = String(detail.firstName || nameParts[0] || fullName).trim();
      const lastName = String(detail.lastName || nameParts.slice(1).join(" ") || "").trim();

      const baseItem: MitoBeneficiaryItem = {
        beneficiaryId,
        name: fullName,
        firstName,
        lastName,
        companyName: isBusiness ? String(detail.companyName || fullName).trim() : null,
        beneficiaryNickname: detail.beneficiaryNickname ?? item.beneficiaryNickname ?? null,
        legalEntityType: isBusiness ? ("business" as const) : ("individual" as const),
        countryIso3: String(detail.countryIso3 || item.countryIso3 || "NGA").toUpperCase(),
        country: String(detail.countryDescription || item.countryDescription || "Nigeria"),
        currency: String(detail.currencyIso || item.currency || "NGN").toUpperCase(),
        serviceCode: String(detail.serviceCode || item.serviceCode || "MONEYTRANSFER"),
        collectionMode: String(detail.collectionMode || item.collectionMode || "BANKACCOUNT"),
        providerId: detail.providerId ? String(detail.providerId) : null,
        bankName: String(
          detail.bankName ||
            detail.providerName ||
            (String(detail.collectionMode || item.collectionMode || "").toUpperCase() === "MOBILEMONEY"
              ? "Mobile Money"
              : "Bank Transfer"),
        ),
        acctNumber: String(detail.acctNumber || detail.mobileNo || ""),
        sortCode: String(detail.sortCode || ""),
        iban: String(detail.iban || ""),
        bicSwift: String(detail.bicSwift || ""),
        aba: String(detail.aba || ""),
        ifsc: String(detail.ifsc || ""),
        bsbCode: String(detail.bsbCode || ""),
        branchCode: String(detail.branchCode || ""),
        address: String(detail.address || ""),
        city: String(detail.city || ""),
        postcode: String(detail.postcode || ""),
        stateOrProvince: String(detail.stateProvinceId || detail.stateProvinceName || ""),
        mobileNo: String(detail.mobileNo || detail.acctNumber || ""),
        relationId: detail.relationId ? String(detail.relationId) : null,
        reasonId: detail.reasonId ? String(detail.reasonId) : null,
        relationship: detail.relationship
          ? String(detail.relationship)
          : detail.relationDescription
            ? String(detail.relationDescription)
            : null,
        relationDescription: detail.relationDescription ? String(detail.relationDescription) : null,
        reason: detail.reason
          ? String(detail.reason)
          : detail.reasonDescription
            ? String(detail.reasonDescription)
            : null,
        reasonDescription: detail.reasonDescription ? String(detail.reasonDescription) : null,
        otherReason: detail.otherReason ? String(detail.otherReason) : null,
        narration:
          detail.narration || detail.paymentNarration
            ? String(detail.narration || detail.paymentNarration)
            : null,
        addressLine2: detail.addressLine2 ? String(detail.addressLine2) : null,
        otherRelation: detail.otherRelation ? String(detail.otherRelation) : null,
        bankCode: detail.bankCode ? String(detail.bankCode) : null,
        clabe: detail.clabe ? String(detail.clabe) : null,
        cnaps: detail.cnaps ? String(detail.cnaps) : null,
        createdAt: detail.createdAt ?? item.createdAt ?? null,
      };
      const sigKey = makeDeletedSignature(baseItem.name, baseItem.acctNumber || baseItem.iban || baseItem.mobileNo);
      const nameKey = baseItem.name ? `NAME:${baseItem.name.trim().toLowerCase()}` : null;
      const overrideById = beneficiaryId
        ? updatedMitoBeneficiariesById.get(beneficiaryId.toUpperCase())
        : undefined;
      const overrideBySig = sigKey
        ? updatedMitoBeneficiariesById.get(`SIG:${sigKey.toUpperCase()}`)
        : undefined;
      const overrideByName = nameKey
        ? updatedMitoBeneficiariesById.get(nameKey.toUpperCase())
        : undefined;
      const mergedOverride = {
        ...(overrideByName || {}),
        ...(overrideBySig || {}),
        ...(overrideById || {}),
      };
      return Object.keys(mergedOverride).length > 0
        ? { ...baseItem, ...mergedOverride, beneficiaryId }
        : baseItem;
    }),
  );

  const seenKeys = new Set<string>();
  const activeDetailed = detailed.filter((b) => {
    const idUpper = String(b.beneficiaryId || "").trim().toUpperCase();
    if (idUpper && deletedMitoBeneficiaryIds.has(idUpper)) return false;
    const sig = makeDeletedSignature(b.name, b.acctNumber || b.iban || b.mobileNo);
    const nameOnlySig = b.name ? `${b.name.trim().toLowerCase()}|` : null;
    if ((sig && deletedMitoBeneficiarySignatures.has(sig)) || (nameOnlySig && deletedMitoBeneficiarySignatures.has(nameOnlySig))) {
      return false;
    }
    const dedupKey = sig || idUpper;
    if (dedupKey) {
      if (seenKeys.has(dedupKey)) return false;
      seenKeys.add(dedupKey);
    }
    return true;
  });

  if (fallbackSearchFilter && trimmedSearch) {
    const q = trimmedSearch.toLowerCase();
    return activeDetailed.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.firstName.toLowerCase().includes(q) ||
        b.lastName.toLowerCase().includes(q) ||
        (b.companyName || "").toLowerCase().includes(q) ||
        (b.beneficiaryNickname || "").toLowerCase().includes(q) ||
        b.bankName.toLowerCase().includes(q) ||
        b.acctNumber.toLowerCase().includes(q),
    );
  }

  return activeDetailed;
}

/* ------------------------------------------------------------------ */
/* Locally created beneficiaries (offline / unconfigured / VITEST).    */
/* Persisted to `.dev-state/mito-local-beneficiaries.json` (in-memory  */
/* only under VITEST) and merged into `getMitoBeneficiaries`.          */
/* ------------------------------------------------------------------ */

export const LOCAL_BENEFICIARY_ID_PREFIX = "LOCAL-";

export function isLocalMitoBeneficiaryId(id: string | null | undefined): boolean {
  return String(id || "").trim().toUpperCase().startsWith(LOCAL_BENEFICIARY_ID_PREFIX);
}

const LOCAL_BENEFICIARIES_FILE = path.resolve(
  process.cwd(),
  ".dev-state",
  "mito-local-beneficiaries.json",
);
const localMitoBeneficiariesByUser = new Map<string, MitoBeneficiaryRecord[]>();
let localMitoBeneficiariesLoaded = false;

function loadLocalMitoBeneficiariesFromDisk(): void {
  if (localMitoBeneficiariesLoaded) return;
  localMitoBeneficiariesLoaded = true;
  if (process.env.VITEST) return;
  try {
    if (!fs.existsSync(LOCAL_BENEFICIARIES_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(LOCAL_BENEFICIARIES_FILE, "utf8")) as Record<
      string,
      MitoBeneficiaryRecord[]
    >;
    if (raw && typeof raw === "object") {
      for (const [userKey, list] of Object.entries(raw)) {
        if (Array.isArray(list)) localMitoBeneficiariesByUser.set(userKey, list);
      }
    }
  } catch {
    // ignore disk read errors
  }
}

function saveLocalMitoBeneficiariesToDisk(): void {
  if (process.env.VITEST) return;
  try {
    const dir = path.dirname(LOCAL_BENEFICIARIES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const serialized: Record<string, MitoBeneficiaryRecord[]> = {};
    localMitoBeneficiariesByUser.forEach((list, key) => {
      serialized[key] = list;
    });
    fs.writeFileSync(LOCAL_BENEFICIARIES_FILE, JSON.stringify(serialized, null, 2), "utf8");
  } catch {
    // ignore disk write errors
  }
}

function saveLocalMitoBeneficiary(userKey: string, record: MitoBeneficiaryRecord): void {
  loadLocalMitoBeneficiariesFromDisk();
  const list = localMitoBeneficiariesByUser.get(userKey) ?? [];
  const idUpper = record.beneficiaryId.toUpperCase();
  const next = [record, ...list.filter((r) => r.beneficiaryId.toUpperCase() !== idUpper)];
  localMitoBeneficiariesByUser.set(userKey, next);
  saveLocalMitoBeneficiariesToDisk();
}

function removeLocalMitoBeneficiary(beneficiaryId: string): void {
  loadLocalMitoBeneficiariesFromDisk();
  const idUpper = String(beneficiaryId || "").trim().toUpperCase();
  if (!idUpper) return;
  let changed = false;
  localMitoBeneficiariesByUser.forEach((list, key) => {
    const next = list.filter((r) => r.beneficiaryId.toUpperCase() !== idUpper);
    if (next.length !== list.length) {
      localMitoBeneficiariesByUser.set(key, next);
      changed = true;
    }
  });
  if (changed) saveLocalMitoBeneficiariesToDisk();
}

function listLocalMitoBeneficiaries(params: MitoBeneficiaryListParams): MitoBeneficiaryRecord[] {
  loadLocalMitoBeneficiariesFromDisk();
  loadDeletedBeneficiariesFromDisk();
  loadUpdatedBeneficiariesFromDisk();
  const all = localMitoBeneficiariesByUser.get(params.userId) ?? [];
  const wantedMode = params.collectionMode ? String(params.collectionMode).toUpperCase() : "";
  const wantedEntity = params.legalEntityType ? String(params.legalEntityType).trim().toLowerCase() : "";
  const q = (params.searchingText || "").trim().toLowerCase();
  const items = all
    .map((rec) => {
      const override = updatedMitoBeneficiariesById.get(rec.beneficiaryId.toUpperCase());
      return override ? ({ ...rec, ...override, beneficiaryId: rec.beneficiaryId } as MitoBeneficiaryRecord) : rec;
    })
    .filter((rec) => {
      if (deletedMitoBeneficiaryIds.has(rec.beneficiaryId.toUpperCase())) return false;
      if (wantedMode && String(rec.collectionMode || "").toUpperCase() !== wantedMode) return false;
      if (params.countryIso3 && rec.countryIso3.toUpperCase() !== params.countryIso3.toUpperCase()) return false;
      if (params.currencyIso && rec.currency.toUpperCase() !== params.currencyIso.toUpperCase()) return false;
      if (params.providerId && rec.providerId !== params.providerId) return false;
      if (wantedEntity) {
        const isBiz = rec.legalEntityType === "business";
        const wantBiz = wantedEntity === "b" || wantedEntity === "business";
        const wantInd = wantedEntity === "i" || wantedEntity === "individual";
        if ((wantBiz && !isBiz) || (wantInd && isBiz)) return false;
      }
      if (q) {
        const hay = [
          rec.name,
          rec.firstName,
          rec.lastName,
          rec.companyName || "",
          rec.beneficiaryNickname || "",
          rec.bankName,
          rec.acctNumber,
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  return items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

/**
 * Sender's beneficiaries: Mito's list (when configured and reachable) merged with beneficiaries created locally
 * while Mito was unconfigured/offline, de-duplicated by id and name+account signature.
 */
export async function getMitoBeneficiaries(params: MitoBeneficiaryListParams): Promise<MitoBeneficiaryRecord[]> {
  if (!params.userId) return [];
  let remote: MitoBeneficiaryRecord[] = [];
  try {
    remote = await getMitoRemoteBeneficiaries(params);
  } catch (err) {
    log(`⚠️ Could not load Mito beneficiaries, using local records only: ${String((err as Error)?.message || err)}`, "mito-retail");
    remote = [];
  }
  const local = listLocalMitoBeneficiaries(params);
  if (local.length === 0) return remote;

  const seen = new Set<string>();
  remote.forEach((b) => {
    const idUpper = String(b.beneficiaryId || "").trim().toUpperCase();
    if (idUpper) seen.add(idUpper);
    const sig = makeDeletedSignature(b.name, b.acctNumber || b.iban || b.mobileNo);
    if (sig) seen.add(sig);
  });
  const extras = local.filter((b) => {
    const sig = makeDeletedSignature(b.name, b.acctNumber || b.iban || b.mobileNo);
    if (seen.has(b.beneficiaryId.toUpperCase()) || (sig && seen.has(sig))) return false;
    if (sig) seen.add(sig);
    return true;
  });
  return [...extras, ...remote];
}

/**
 * Nickname rules: at least 5 letters/numbers (other characters are ignored) and unique among the sender's
 * saved beneficiaries; Mito's `ValidateBeneficiaryNickName` is consulted when reachable. Never throws.
 */
export async function validateMitoBeneficiaryNickname(params: {
  nickName: string;
  userId?: string;
  excludeBeneficiaryId?: string;
}): Promise<{ valid: boolean; available: boolean; source: "local" | "mito"; message: string | null; nickName: string }> {
  const clean = String(params.nickName || "").replace(/[^A-Za-z0-9]/g, "");
  if (clean.length < 5) {
    return {
      valid: false,
      available: false,
      source: "local",
      message: "Nickname must have at least 5 letters or numbers.",
      nickName: clean,
    };
  }

  const duplicateMessage = "You already have a recipient with this nickname. Please choose another.";
  const excludeId = String(params.excludeBeneficiaryId || "").trim().toUpperCase();
  const lowered = clean.toLowerCase();
  try {
    if (params.userId) {
      const saved = await Promise.race([
        getMitoBeneficiaries({ userId: params.userId }),
        new Promise<MitoBeneficiaryRecord[]>((resolve) => setTimeout(() => resolve([]), 4000)),
      ]);
      const dup = saved.some(
        (b) =>
          String(b.beneficiaryId || "").trim().toUpperCase() !== excludeId &&
          String(b.beneficiaryNickname || "").replace(/[^A-Za-z0-9]/g, "").toLowerCase() === lowered,
      );
      if (dup) {
        return { valid: true, available: false, source: "local", message: duplicateMessage, nickName: clean };
      }
    }
  } catch {
    // local duplicate check is best-effort
  }

  if (isMitoRetailConfigured() && !process.env.VITEST) {
    try {
      const creds = loadMitoRetailCredentials()!;
      const { token } = await getMitoRetailToken();
      const res = await fetch(
        `${creds.baseUrl}/api/v1/mito/Beneficiaries/ValidateBeneficiaryNickName?nickName=${encodeURIComponent(clean)}`,
        {
          headers: { Authorization: `Bearer ${token}`, apiKey: creds.apiKey },
          signal: AbortSignal.timeout(6000),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { data?: unknown; message?: string };
      if (res.ok) {
        const d = body?.data as any;
        const availableFlag =
          typeof d === "boolean" ? d : typeof d?.isAvailable === "boolean" ? d.isAvailable : typeof d?.valid === "boolean" ? d.valid : true;
        return {
          valid: true,
          available: availableFlag,
          source: "mito",
          message: availableFlag ? null : duplicateMessage,
          nickName: clean,
        };
      }
      if (/already|exist|taken|duplicate|in use/i.test(String(body?.message || ""))) {
        return { valid: true, available: false, source: "mito", message: duplicateMessage, nickName: clean };
      }
    } catch {
      // fall back gracefully below
    }
  }

  return { valid: true, available: true, source: "local", message: null, nickName: clean };
}

function makeValidMitoNickname(raw?: string, fallbackBase?: string): string {
  const cleaned = String(raw || "")
    .replace(/\s+/g, "")
    .replace(/[^A-Za-z0-9]/g, "");
  if (cleaned.length >= 5) return cleaned;
  const base =
    String(fallbackBase || "Beneficiary")
      .replace(/[^A-Za-z]/g, "")
      .slice(0, 6) || "Rhemito";
  const rand = Array.from({ length: 6 }, () =>
    String.fromCharCode(65 + Math.floor(Math.random() * 26)),
  ).join("");
  return `${base}${rand}`;
}

/**
 * Creates a beneficiary in Mito Sandbox via `POST /api/v1/mito/Beneficiaries`.
 */
export class MitoBeneficiaryCreationError extends Error {
  status: number;
  rawMessage: string;

  constructor(status: number, userFriendlyMessage: string, rawMessage: string) {
    super(userFriendlyMessage);
    this.name = "MitoBeneficiaryCreationError";
    this.status = status;
    this.rawMessage = rawMessage;
  }
}

export function formatFriendlyMitoBeneficiaryError(rawMessage?: string): string {
  const raw = String(rawMessage || "").trim();
  const lower = raw.toLowerCase();

  if (!raw) {
    return "We couldn't create this beneficiary right now. Please verify the recipient and bank details and try again.";
  }
  if (lower.includes("account") && (lower.includes("invalid") || lower.includes("length") || lower.includes("digit") || lower.includes("format") || lower.includes("not found"))) {
    return "The account number entered appears to be invalid for the selected bank. Please check the account number and try again.";
  }
  if (lower.includes("iban")) {
    return "Please enter a valid IBAN for the recipient's bank account.";
  }
  if (lower.includes("swift") || lower.includes("bic")) {
    return "Please enter a valid SWIFT / BIC code for the selected bank.";
  }
  if (lower.includes("sort code") || lower.includes("sortcode")) {
    return "Please enter a valid 6-digit UK Sort Code.";
  }
  if (lower.includes("provider") || lower.includes("bank")) {
    return "Please select a valid bank from the list and check your banking details.";
  }
  if (lower.includes("nick")) {
    return "The nickname entered is not valid. Please use letters and numbers only (at least 5 characters) or leave it blank.";
  }
  if (lower.includes("mobile") || lower.includes("phone")) {
    return "Please enter a valid mobile phone number for the recipient.";
  }
  if (lower.includes("address") || lower.includes("city") || lower.includes("postcode") || lower.includes("state")) {
    return "Please check that the recipient's address, city, state, and postcode are filled in accurately.";
  }
  if (lower.includes("relation")) {
    return "Please select a valid relationship with the recipient.";
  }
  if (lower.includes("reason")) {
    return "Please select a valid reason for the transfer.";
  }
  if (lower.includes("already exist") || lower.includes("duplicate")) {
    return "A beneficiary with these bank details already exists in your recipients list.";
  }
  // Clean up technical prefixes if present while keeping readable API messages
  const cleaned = raw
    .replace(/^error\s*[:\-]\s*/i, "")
    .replace(/^validation\s*failed\s*[:\-]\s*/i, "")
    .trim();
  if (cleaned.length > 0 && cleaned.length <= 180 && !cleaned.includes("{") && !cleaned.includes("Exception")) {
    return cleaned.endsWith(".") ? cleaned : `${cleaned}.`;
  }
  return "We couldn't verify and save this beneficiary's details with the bank. Please double-check all fields and try again.";
}

export interface CreateMitoBeneficiaryInput {
  userId: string;
  serviceCode?: string;
  collectionMode: "BANKACCOUNT" | "MOBILEMONEY";
  legalEntityType?: "I" | "B";
  countryIso3: string;
  currencyIso: string;
  providerId: string;
  providerCode?: string;
  companyName?: string;
  firstName: string;
  lastName: string;
  acctNumber?: string;
  bankName?: string;
  sortCode?: string;
  iban?: string;
  bicSwift?: string;
  aba?: string;
  ifsc?: string;
  bsbCode?: string;
  branchCode?: string;
  relationship?: string;
  relationId?: string;
  reasonId?: string;
  beneficiaryNickname?: string;
  address?: string;
  city?: string;
  postcode?: string;
  stateOrProvince?: string;
  mobileNo?: string;
  /** Beneficiary-journey parity (DEC-2026-11-19) - additive, optional. */
  addressLine2?: string;
  otherRelation?: string;
  otherReason?: string;
  narration?: string;
  dob?: string;
  gender?: string;
  bankCode?: string;
  clabe?: string;
  cnaps?: string;
  isInternational?: boolean;
  accountHolderName?: string;
}

export interface CreateMitoBeneficiaryResult {
  beneficiaryId: string;
  providerId: string;
  providerCode?: string;
  createdNew: boolean;
  /** 	rue when the beneficiary only exists locally (Mito unconfigured / offline / synthetic provider). */
  localOnly?: boolean;
}

function isNetworkFailure(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string; code?: string; cause?: { code?: string } };
  if (e instanceof TypeError) return true;
  if (e.name === "AbortError" || e.name === "TimeoutError") return true;
  if (/HTTP 5\d\d|failed with HTTP 5/i.test(String(e.message || ""))) return true;
  const code = String(e.code || e.cause?.code || "");
  return /ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|UND_ERR/i.test(code);
}

function createLocalMitoBeneficiary(input: CreateMitoBeneficiaryInput): CreateMitoBeneficiaryResult {
  const isBusiness = input.legalEntityType === "B";
  const first = String(input.firstName || "").trim();
  const last = String(input.lastName || "").trim();
  const companyName = isBusiness ? String(input.companyName || first || "Business").trim() : null;
  const fullName = isBusiness ? companyName || "Business" : [first, last].filter(Boolean).join(" ") || "Beneficiary";
  const beneficiaryId = `${LOCAL_BENEFICIARY_ID_PREFIX}${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const strip = (v?: string) => String(v || "").replace(/\s+/g, "");
  const nick = String(input.beneficiaryNickname || "").replace(/[^A-Za-z0-9]/g, "");
  const record: MitoBeneficiaryRecord = {
    beneficiaryId,
    name: fullName,
    firstName: isBusiness ? companyName || first : first,
    lastName: isBusiness ? last || "Business" : last,
    companyName,
    beneficiaryNickname: nick.length >= 5 ? nick : null,
    legalEntityType: isBusiness ? "business" : "individual",
    countryIso3: input.countryIso3.toUpperCase(),
    country: input.countryIso3.toUpperCase(),
    currency: input.currencyIso.toUpperCase(),
    serviceCode: input.serviceCode || "MONEYTRANSFER",
    collectionMode: input.collectionMode,
    providerId: input.providerId || null,
    bankName: String(input.bankName || (input.collectionMode === "MOBILEMONEY" ? "Mobile Money" : "Bank Transfer")).trim(),
    acctNumber: strip(input.acctNumber || input.mobileNo),
    sortCode: strip(input.sortCode),
    iban: strip(input.iban),
    bicSwift: strip(input.bicSwift),
    aba: strip(input.aba),
    ifsc: strip(input.ifsc),
    bsbCode: strip(input.bsbCode),
    branchCode: strip(input.branchCode),
    address: String(input.address || "").trim(),
    city: String(input.city || "").trim(),
    postcode: String(input.postcode || "").trim(),
    stateOrProvince: String(input.stateOrProvince || "").trim(),
    mobileNo: strip(input.mobileNo),
    relationId: input.relationId?.trim() || null,
    reasonId: input.reasonId?.trim() || null,
    relationship: input.relationship?.trim() || null,
    relationDescription: null,
    reason: null,
    reasonDescription: null,
    otherReason: input.otherReason?.trim() || null,
    narration: input.narration?.trim() || null,
    addressLine2: input.addressLine2?.trim() || null,
    otherRelation: input.otherRelation?.trim() || null,
    dob: input.dob?.trim() || null,
    gender: input.gender?.trim() || null,
    bankCode: strip(input.bankCode) || null,
    clabe: strip(input.clabe) || null,
    cnaps: strip(input.cnaps) || null,
    isInternational: input.isInternational ?? null,
    accountHolderName: input.accountHolderName?.trim() || null,
    createdAt: new Date().toISOString(),
  };
  saveLocalMitoBeneficiary(input.userId, record);
  log(`ℹ️ Saved beneficiary locally (beneficiaryId=${beneficiaryId}); Mito is unavailable`, "mito-retail");
  return {
    beneficiaryId,
    providerId: input.providerId,
    providerCode: input.providerCode,
    createdNew: true,
    localOnly: true,
  };
}

/**
 * Creates a beneficiary in Mito (when configured) or locally (when Mito is unconfigured/offline or the provider is a
 * synthesized fallback). Upstream validation failures still throw MitoBeneficiaryCreationError.
 */
export async function createMitoBeneficiary(
  input: CreateMitoBeneficiaryInput,
): Promise<CreateMitoBeneficiaryResult | null> {
  if (!isMitoRetailConfigured() || String(input.providerId || "").startsWith(FALLBACK_PROVIDER_ID_PREFIX)) {
    return createLocalMitoBeneficiary(input);
  }
  try {
    return await createMitoRemoteBeneficiary(input);
  } catch (err) {
    if (err instanceof MitoBeneficiaryCreationError) throw err;
    if (isNetworkFailure(err)) return createLocalMitoBeneficiary(input);
    throw err;
  }
}

async function createMitoRemoteBeneficiary(
  input: CreateMitoBeneficiaryInput,
): Promise<CreateMitoBeneficiaryResult | null> {
  if (!isMitoRetailConfigured()) return null;
  const creds = loadMitoRetailCredentials()!;
  const { token } = await getMitoRetailToken();

  const legalEntityType: "I" | "B" = input.legalEntityType === "B" ? "B" : "I";
  const baseNameForNick =
    legalEntityType === "B"
      ? input.companyName || input.firstName || "Business"
      : `${input.firstName || ""}${input.lastName || ""}`;
  const isMobileMoney = input.collectionMode === "MOBILEMONEY";
  const resolvedMobileOrAcct = (
    isMobileMoney
      ? input.mobileNo || input.acctNumber || "08012345678"
      : input.acctNumber || input.iban || "0123456789"
  ).replace(/\s+/g, "");
  const payload: Record<string, unknown> = {
    serviceCode: input.serviceCode || "MONEYTRANSFER",
    collectionMode: input.collectionMode,
    legalEntityType,
    countryIso3: input.countryIso3.toUpperCase(),
    currencyIso: input.currencyIso.toUpperCase(),
    providerId: input.providerId,
    userId: input.userId,
    firstName:
      legalEntityType === "B"
        ? (input.companyName || input.firstName || "Business").trim()
        : (input.firstName || "Beneficiary").trim(),
    lastName:
      legalEntityType === "B"
        ? (input.lastName || "Business").trim()
        : (input.lastName || "Recipient").trim(),
    acctNumber: resolvedMobileOrAcct,
    bankName: (input.bankName || (isMobileMoney ? "Mobile Operator" : "Bank")).trim(),
    relationship: (input.relationship || (legalEntityType === "B" ? "BUSINESS" : "FAMILY")).toUpperCase(),
    beneficiaryNickname: makeValidMitoNickname(input.beneficiaryNickname, baseNameForNick),
  };
  if (legalEntityType === "B") {
    payload.companyName = (input.companyName || input.firstName || "Business").trim();
  }
  if (input.relationId) payload.relationId = input.relationId.trim();
  if (input.reasonId) payload.reasonId = input.reasonId.trim();
  if (input.sortCode) payload.sortCode = input.sortCode.replace(/\s+/g, "");
  if (input.iban) payload.iban = input.iban.replace(/\s+/g, "");
  if (input.bicSwift) payload.bicSwift = input.bicSwift.replace(/\s+/g, "");
  if (input.aba) payload.aba = input.aba.replace(/\s+/g, "");
  if (input.ifsc) payload.ifsc = input.ifsc.replace(/\s+/g, "");
  if (input.bsbCode) payload.bsbCode = input.bsbCode.replace(/\s+/g, "");
  if (input.branchCode) payload.branchCode = input.branchCode.replace(/\s+/g, "");
  if (input.bankCode) payload.bankCode = input.bankCode.replace(/\s+/g, "");
  if (input.clabe) payload.clabe = input.clabe.replace(/\s+/g, "");
  if (input.cnaps) payload.cnaps = input.cnaps.replace(/\s+/g, "");
  if (input.addressLine2) payload.addressLine2 = input.addressLine2.trim();
  if (input.otherRelation) payload.otherRelation = input.otherRelation.trim();
  if (input.otherReason) payload.otherReason = input.otherReason.trim();
  if (input.narration) payload.narration = input.narration.trim();
  if (input.dob) payload.dob = input.dob.trim();
  if (input.gender) payload.gender = input.gender.trim();
  if (input.isInternational !== undefined) payload.isInternational = Boolean(input.isInternational);
  if (input.address) payload.address = input.address.trim();
  if (input.city) payload.city = input.city.trim();
  if (input.postcode) payload.postcode = input.postcode.trim();
  if (input.stateOrProvince) payload.stateOrProvince = input.stateOrProvince.trim();
  if (input.mobileNo) {
    payload.mobileNo = input.mobileNo.replace(/\s+/g, "");
  } else if (isMobileMoney) {
    payload.mobileNo = resolvedMobileOrAcct;
  }

  let res = await fetch(`${creds.baseUrl}/api/v1/mito/Beneficiaries`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  let body = (await res.json().catch(() => ({}))) as {
    data?: { beneficiaryId?: string };
    message?: string;
  };

  if (!res.ok && (body?.message || "").toLowerCase().includes("nick")) {
    payload.beneficiaryNickname = makeValidMitoNickname(undefined, baseNameForNick);
    res = await fetch(`${creds.baseUrl}/api/v1/mito/Beneficiaries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    body = (await res.json().catch(() => ({}))) as {
      data?: { beneficiaryId?: string };
      message?: string;
    };
  }

  const fullBeneficiaryName =
    input.legalEntityType === "B"
      ? String(input.companyName || input.firstName || "").trim()
      : `${String(input.firstName || "").trim()} ${String(input.lastName || "").trim()}`.trim();

  if (res.ok && body?.data?.beneficiaryId) {
    unmarkDeletedBeneficiaryOnServer({
      beneficiaryId: body.data.beneficiaryId,
      name: fullBeneficiaryName,
      acctNumber: input.acctNumber || input.iban || input.mobileNo,
    });
    log(
      `✅ Created Mito Beneficiary (beneficiaryId=${body.data.beneficiaryId}, providerCode=${input.providerCode || "-"}, providerId=${input.providerId})`,
      "mito-retail",
    );
    return {
      beneficiaryId: body.data.beneficiaryId,
      providerId: input.providerId,
      providerCode: input.providerCode,
      createdNew: true,
    };
  }

  // If the beneficiary already exists with the same details, look up the user's beneficiaries via GET /api/v1/mito/Beneficiaries
  const msgLower = (body?.message || "").toLowerCase();
  if (msgLower.includes("already exist")) {
    try {
      const listRes = await fetch(
        `${creds.baseUrl}/api/v1/mito/Beneficiaries?userId=${encodeURIComponent(input.userId)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (listRes.ok) {
        const listBody = (await listRes.json().catch(() => ({}))) as {
          data?: Array<{
            beneficiaryId?: string;
            acctNumber?: string;
            firstName?: string;
            lastName?: string;
            companyName?: string;
          }>;
        };
        const list = Array.isArray(listBody.data) ? listBody.data : [];
        const acctSearch = (input.acctNumber || input.iban || "").trim().toLowerCase();
        const found =
          (acctSearch && list.find((b) => (b.acctNumber || "").trim().toLowerCase() === acctSearch)) ||
          list.find(
            (b) =>
              (b.companyName || b.firstName || "").trim().toLowerCase() ===
              String(payload.companyName || payload.firstName || "").trim().toLowerCase(),
          ) ||
          list[0];
        if (found?.beneficiaryId) {
          unmarkDeletedBeneficiaryOnServer({
            beneficiaryId: found.beneficiaryId,
            name: fullBeneficiaryName,
            acctNumber: input.acctNumber || input.iban || input.mobileNo,
          });
          log(
            `✅ Reused existing Mito Beneficiary (beneficiaryId=${found.beneficiaryId}, providerCode=${input.providerCode || "-"}, providerId=${input.providerId})`,
            "mito-retail",
          );
          return {
            beneficiaryId: found.beneficiaryId,
            providerId: input.providerId,
            providerCode: input.providerCode,
            createdNew: false,
          };
        }
      }
    } catch {
      // fall through
    }
  }

  const rawErr = String(
    body?.message ||
      (body as any)?.error?.message ||
      (Array.isArray((body as any)?.errors) ? (body as any).errors.map((e: any) => e?.message || e).join(", ") : "") ||
      `API returned status ${res.status}`,
  ).trim();
  log(`⚠️ Mito POST /api/v1/mito/Beneficiaries returned ${res.status}: ${rawErr}`, "mito-retail");
  throw new MitoBeneficiaryCreationError(
    res.status >= 400 && res.status < 500 ? res.status : 400,
    formatFriendlyMitoBeneficiaryError(rawErr),
    rawErr,
  );
}

/**
 * Deletes a beneficiary in Mito Sandbox (if supported) and marks it deleted locally
 * (persisted to `.dev-state/mito-deleted-beneficiaries.json`) so it no longer appears in `getMitoBeneficiaries`.
 */
export async function deleteMitoBeneficiary(params: {
  beneficiaryId: string;
  userId?: string | null;
  name?: string | null;
  acctNumber?: string | null;
}): Promise<boolean> {
  loadDeletedBeneficiariesFromDisk();
loadUpdatedBeneficiariesFromDisk();
  const cleanId = String(params.beneficiaryId || "").trim().toUpperCase();
  if (cleanId && cleanId !== "LOCAL") {
    deletedMitoBeneficiaryIds.add(cleanId);
  }
  const sig = makeDeletedSignature(params.name, params.acctNumber);
  if (sig) {
    deletedMitoBeneficiarySignatures.add(sig);
  }
  if (params.name && String(params.name).trim()) {
    deletedMitoBeneficiarySignatures.add(`${String(params.name).trim().toLowerCase()}|`);
  }
  saveDeletedBeneficiariesToDisk();
  if (isLocalMitoBeneficiaryId(cleanId)) removeLocalMitoBeneficiary(cleanId);

  if (!isMitoRetailConfigured() || !cleanId || cleanId === "LOCAL" || isLocalMitoBeneficiaryId(cleanId)) return true;
  try {
    const creds = loadMitoRetailCredentials()!;
    const { token } = await getMitoRetailToken();
    // Verified furp02-core contract: GET /api/v1/mito/Beneficiaries/DeleteBeneficiary?beneficiaryId=...
    const res = await fetch(
      `${creds.baseUrl}/api/v1/mito/Beneficiaries/DeleteBeneficiary?beneficiaryId=${encodeURIComponent(String(params.beneficiaryId || "").trim())}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, apiKey: creds.apiKey },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (res.ok) {
      log(`✅ Deleted Mito Beneficiary (beneficiaryId=${cleanId})`, "mito-retail");
    } else {
      log(`ℹ️ Removed Mito Beneficiary locally (beneficiaryId=${cleanId}, upstream status=${res.status})`, "mito-retail");
    }
  } catch {
    // Keep persistent local deletion in deletedMitoBeneficiaryIds
  }
  return true;
}

/**
 * Updates an existing beneficiary in Mito Sandbox (if supported) and persists the updated fields
 * locally in `.dev-state/mito-updated-beneficiaries.json` so `getMitoBeneficiaries` returns the updated details.
 */
export async function updateMitoBeneficiary(params: {
  beneficiaryId: string;
  userId?: string | null;
  legalEntityType?: "individual" | "business";
  firstName?: string;
  lastName?: string;
  companyName?: string | null;
  country?: string;
  countryIso3?: string;
  currency?: string;
  collectionMode?: "BANKACCOUNT" | "MOBILEMONEY";
  providerId?: string | null;
  bankName?: string;
  acctNumber?: string;
  sortCode?: string;
  iban?: string;
  bicSwift?: string;
  mobileNo?: string;
  beneficiaryNickname?: string | null;
  /** Beneficiary-journey parity (DEC-2026-11-19) — additive, optional. */
  address?: string;
  addressLine2?: string;
  city?: string;
  postcode?: string;
  stateOrProvince?: string;
  relationId?: string;
  otherRelation?: string;
  reasonId?: string;
  otherReason?: string;
  narration?: string;
  aba?: string;
  ifsc?: string;
  bsbCode?: string;
  branchCode?: string;
  bankCode?: string;
  clabe?: string;
  cnaps?: string;
  nationalityCountryIso3?: string;
  birthCountryIso3?: string;
  dob?: string;
  gender?: string;
  isInternational?: boolean;
  accountHolderName?: string;
}): Promise<Partial<MitoBeneficiaryItem>> {
  loadUpdatedBeneficiariesFromDisk();
  const cleanId = String(params.beneficiaryId || "").trim().toUpperCase();
  const isBusiness = params.legalEntityType === "business";
  const firstName = String(params.firstName || "").trim();
  const lastName = String(params.lastName || "").trim();
  const companyName = isBusiness ? String(params.companyName || firstName || "Business").trim() : null;
  const fullName = isBusiness
    ? companyName || "Business"
    : [firstName, lastName].filter(Boolean).join(" ").trim() || "Beneficiary";
  const cleanAcct = String(params.acctNumber || params.mobileNo || params.iban || "").replace(/\s+/g, "");

  const existingOverride = cleanId ? updatedMitoBeneficiariesById.get(cleanId) || {} : {};
  const nextOverride: Partial<MitoBeneficiaryItem> = {
    ...existingOverride,
    name: fullName,
    firstName: isBusiness ? companyName || firstName : firstName,
    lastName: isBusiness ? lastName || "Business" : lastName,
    companyName,
    legalEntityType: isBusiness ? "business" : "individual",
    ...(params.country ? { country: params.country } : {}),
    ...(params.countryIso3 ? { countryIso3: params.countryIso3.toUpperCase() } : {}),
    ...(params.currency ? { currency: params.currency.toUpperCase() } : {}),
    ...(params.collectionMode ? { collectionMode: params.collectionMode } : {}),
    ...(params.providerId !== undefined ? { providerId: params.providerId } : {}),
    ...(params.bankName !== undefined ? { bankName: params.bankName.trim() } : {}),
    ...(cleanAcct ? { acctNumber: cleanAcct } : {}),
    ...(params.sortCode !== undefined ? { sortCode: params.sortCode.replace(/\s+/g, "") } : {}),
    ...(params.iban !== undefined ? { iban: params.iban.replace(/\s+/g, "") } : {}),
    ...(params.bicSwift !== undefined ? { bicSwift: params.bicSwift.replace(/\s+/g, "") } : {}),
    ...(params.mobileNo !== undefined ? { mobileNo: params.mobileNo.replace(/\s+/g, "") } : {}),
    ...(params.address !== undefined ? { address: params.address.trim() } : {}),
    ...(params.addressLine2 !== undefined ? { addressLine2: params.addressLine2.trim() } : {}),
    ...(params.city !== undefined ? { city: params.city.trim() } : {}),
    ...(params.postcode !== undefined ? { postcode: params.postcode.trim() } : {}),
    ...(params.stateOrProvince !== undefined ? { stateOrProvince: params.stateOrProvince.trim() } : {}),
    ...(params.relationId ? { relationId: params.relationId.trim() } : {}),
    ...(params.otherRelation !== undefined ? { otherRelation: params.otherRelation.trim() } : {}),
    ...(params.reasonId ? { reasonId: params.reasonId.trim() } : {}),
    ...(params.otherReason !== undefined ? { otherReason: params.otherReason.trim() } : {}),
    ...(params.narration !== undefined ? { narration: params.narration.trim() } : {}),
    ...(params.aba !== undefined ? { aba: params.aba.replace(/\s+/g, "") } : {}),
    ...(params.ifsc !== undefined ? { ifsc: params.ifsc.replace(/\s+/g, "") } : {}),
    ...(params.bsbCode !== undefined ? { bsbCode: params.bsbCode.replace(/\s+/g, "") } : {}),
    ...(params.branchCode !== undefined ? { branchCode: params.branchCode.replace(/\s+/g, "") } : {}),
    ...(params.bankCode !== undefined ? { bankCode: params.bankCode.replace(/\s+/g, "") } : {}),
    ...(params.clabe !== undefined ? { clabe: params.clabe.replace(/\s+/g, "") } : {}),
    ...(params.cnaps !== undefined ? { cnaps: params.cnaps.replace(/\s+/g, "") } : {}),
    ...(params.dob !== undefined ? { dob: params.dob.trim() } : {}),
    ...(params.gender !== undefined ? { gender: params.gender.trim() } : {}),
    ...(params.isInternational !== undefined ? { isInternational: Boolean(params.isInternational) } : {}),
    ...(params.accountHolderName !== undefined ? { accountHolderName: params.accountHolderName.trim() } : {}),
    ...(params.beneficiaryNickname !== undefined && params.beneficiaryNickname !== null
      ? (() => {
          const nick = String(params.beneficiaryNickname).replace(/[^A-Za-z0-9]/g, "");
          return nick.length >= 5 ? { beneficiaryNickname: nick } : {};
        })()
      : {}),
  };

  if (cleanId && cleanId !== "LOCAL") {
    updatedMitoBeneficiariesById.set(cleanId, nextOverride);
    saveUpdatedBeneficiariesToDisk();
  }

  unmarkDeletedBeneficiaryOnServer({
    beneficiaryId: cleanId,
    name: fullName,
    acctNumber: cleanAcct,
  });

  if (isMitoRetailConfigured() && cleanId && cleanId !== "LOCAL" && !isLocalMitoBeneficiaryId(cleanId)) {
    try {
      const creds = loadMitoRetailCredentials()!;
      const { token } = await getMitoRetailToken();
      const nickClean = String(params.beneficiaryNickname || "").replace(/[^A-Za-z0-9]/g, "");
      const existingNick = String(existingOverride.beneficiaryNickname || "").replace(/[^A-Za-z0-9]/g, "");
      // Verified furp02-core contract: POST /api/v1/mito/Beneficiaries/UpdateBeneficiary (camelCase UpdateBeneficiaryRequest)
      const updatePayload: Record<string, unknown> = {
        beneficiaryId: String(params.beneficiaryId || "").trim(),
        userId: params.userId || undefined,
        legalEntityType: isBusiness ? "B" : "I",
        beneficiaryNickname:
          nickClean.length >= 5
            ? nickClean
            : existingNick.length >= 5
              ? existingNick
              : makeValidMitoNickname(undefined, fullName),
        companyName: nextOverride.companyName || undefined,
        firstName: nextOverride.firstName,
        lastName: nextOverride.lastName,
        mobileNo: nextOverride.mobileNo || undefined,
        postcode: nextOverride.postcode || undefined,
        city: nextOverride.city || undefined,
        address: nextOverride.address || undefined,
        addressLine2: nextOverride.addressLine2 || undefined,
        stateOrProvince: nextOverride.stateOrProvince || undefined,
        nationalityCountryIso3: params.nationalityCountryIso3 || undefined,
        birthCountryIso3: params.birthCountryIso3 || undefined,
        reasonId: nextOverride.reasonId || undefined,
        otherReason: nextOverride.otherReason || undefined,
        relationId: nextOverride.relationId || undefined,
        otherRelation: nextOverride.otherRelation || undefined,
        narration: nextOverride.narration || undefined,
        acctNumber: nextOverride.acctNumber,
        bankName: nextOverride.bankName,
        sortCode: nextOverride.sortCode || undefined,
        iban: nextOverride.iban || undefined,
        bicSwift: nextOverride.bicSwift || undefined,
        aba: nextOverride.aba || undefined,
        ifsc: nextOverride.ifsc || undefined,
        bsbCode: nextOverride.bsbCode || undefined,
        branchCode: nextOverride.branchCode || undefined,
        bankCode: nextOverride.bankCode || undefined,
        clabe: nextOverride.clabe || undefined,
        cnaps: nextOverride.cnaps || undefined,
      };
      const res = await fetch(`${creds.baseUrl}/api/v1/mito/Beneficiaries/UpdateBeneficiary`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apiKey: creds.apiKey,
        },
        body: JSON.stringify(updatePayload),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        log(`✅ Updated Mito Beneficiary upstream (beneficiaryId=${cleanId})`, "mito-retail");
      } else {
        log(
          `ℹ️ Saved Mito Beneficiary update override locally (beneficiaryId=${cleanId}, upstream status=${res.status})`,
          "mito-retail",
        );
      }
    } catch {
      // Keep persistent local override in updatedMitoBeneficiariesById
    }
  }

  return nextOverride;
}

/**
 * Persists the latest transaction's Relationship, Reason for Transfer, Narration, and Nickname
 * for a beneficiary in `.dev-state/mito-updated-beneficiaries.json` so selecting that beneficiary
 * in future transfers pre-populates those fields automatically.
 */
export function saveMitoBeneficiaryLatestTxnDetails(params: {
  beneficiaryId?: string | null;
  name?: string | null;
  acctNumber?: string | null;
  relationship?: string | null;
  relationId?: string | null;
  relationDescription?: string | null;
  reason?: string | null;
  reasonId?: string | null;
  reasonDescription?: string | null;
  otherReason?: string | null;
  narration?: string | null;
  beneficiaryNickname?: string | null;
}): void {
  loadUpdatedBeneficiariesFromDisk();
  const patch: Partial<MitoBeneficiaryRecord> = {};
  if (params.relationship && params.relationship.trim()) {
    patch.relationship = params.relationship.trim();
  }
  if (params.relationId && params.relationId.trim()) {
    patch.relationId = params.relationId.trim();
  }
  if (params.relationDescription && params.relationDescription.trim()) {
    patch.relationDescription = params.relationDescription.trim();
  }
  if (params.reason && params.reason.trim()) {
    patch.reason = params.reason.trim();
  }
  if (params.reasonId && params.reasonId.trim()) {
    patch.reasonId = params.reasonId.trim();
  }
  if (params.reasonDescription && params.reasonDescription.trim()) {
    patch.reasonDescription = params.reasonDescription.trim();
  }
  if (params.otherReason !== undefined && params.otherReason !== null) {
    patch.otherReason = params.otherReason.trim();
  }
  if (params.narration && params.narration.trim()) {
    patch.narration = params.narration.trim();
  }
  if (params.beneficiaryNickname && params.beneficiaryNickname.trim()) {
    patch.beneficiaryNickname = params.beneficiaryNickname.trim();
  }
  if (Object.keys(patch).length === 0) return;

  const cleanId = String(params.beneficiaryId || "").trim().toUpperCase();
  if (cleanId && cleanId !== "LOCAL") {
    const existing = updatedMitoBeneficiariesById.get(cleanId) || {};
    updatedMitoBeneficiariesById.set(cleanId, { ...existing, ...patch });
  }
  const sig = makeDeletedSignature(params.name, params.acctNumber);
  if (sig) {
    const sigKey = `SIG:${sig.toUpperCase()}`;
    const existingSig = updatedMitoBeneficiariesById.get(sigKey) || {};
    updatedMitoBeneficiariesById.set(sigKey, { ...existingSig, ...patch });
  }
  if (params.name && params.name.trim()) {
    const nameKey = `NAME:${params.name.trim().toUpperCase()}`;
    const existingName = updatedMitoBeneficiariesById.get(nameKey) || {};
    updatedMitoBeneficiariesById.set(nameKey, { ...existingName, ...patch });
  }
  saveUpdatedBeneficiariesToDisk();
}

/**
 * Locks the exchange rate via `POST /api/v1/Rate/validateRate` (or `POST /api/v1/mito/Exchange/rates`)
 * once we have `providerId` (for the beneficiary bank) and user/corridor codes.
 * Falls back to `GET /api/v1/mito/Exchange/affiliateRates` if needed so `rateId` is always stored.
 */
export async function lockMitoExchangeRate(input: {
  userId: string;
  serviceCode?: string;
  collectionMode: "BANKACCOUNT" | "MOBILEMONEY";
  fromCountry: string;
  toCountry: string;
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  direction?: "S" | "R";
  providerId: string;
  providerCode?: string;
  returnUrl?: string;
}): Promise<{
  rateId: string;
  rate?: number;
  commission?: number;
  receiveAmount?: number;
  isKycRequired?: boolean;
  isTransactionAllowed?: boolean;
  kycUrl?: string | null;
  isProfileUpdateRequired?: boolean;
  source: "validate_rate" | "exchange_rates" | "affiliate_rates";
} | null> {
  if (!isMitoRetailConfigured()) return null;
  const creds = loadMitoRetailCredentials()!;
  const { token } = await getMitoRetailToken();
  const effectiveUserId = (input.userId || DEFAULT_MITO_SENDER_USER_ID).trim();

  // 1. Primary rate-lock endpoint used by the Mito web flow: POST /api/v1/Rate/validateRate
  try {
    const rawReturnCandidate = (input.returnUrl || `${serverConfig.publicBaseUrl.replace(/\/+$/, "")}/kyc/return`).trim();
    const resolvedReturnUrl =
      /localhost|127\.0\.0\.1|^http:\/\//i.test(rawReturnCandidate)
        ? "https://rhemito-ui.onrender.com/kyc/return"
        : rawReturnCandidate;

    const validatePayload = {
      userId: effectiveUserId,
      fromCountry: input.fromCountry.toUpperCase(),
      toCountry: input.toCountry.toUpperCase(),
      fromCurrency: input.fromCurrency.toUpperCase(),
      toCurrency: input.toCurrency.toUpperCase(),
      amount: input.amount,
      direction: input.direction || "S",
      service: input.collectionMode,
      providerId: input.providerId,
      isInternational: false,
      returnUrl: resolvedReturnUrl,
    };

    const valRes = await fetch(`${creds.baseUrl}/api/v1/Rate/validateRate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apiKey: creds.apiKey,
      },
      body: JSON.stringify(validatePayload),
    });

    const valBody = (await valRes.json().catch(() => ({}))) as {
      data?: {
        id?: string;
        rateId?: string;
        rate?: number;
        commission?: number;
        receiveAmount?: number;
        isKycRequired?: boolean;
        isTransactionAllowed?: boolean;
        kycUrl?: string | null;
        isProfileUpdateRequired?: boolean;
      };
      message?: string;
    };

    const validatedRateId = valBody?.data?.id || valBody?.data?.rateId;
    if (valRes.ok && validatedRateId) {
      log(
        `✅ Locked Mito rate via POST /api/v1/Rate/validateRate (rateId=${validatedRateId}, commission=${valBody.data?.commission ?? "-"}, userId=${effectiveUserId}, isTransactionAllowed=${valBody.data?.isTransactionAllowed ?? "-"}, kycUrl=${valBody.data?.kycUrl ?? "none"})`,
        "mito-retail",
      );
      return {
        rateId: validatedRateId,
        rate: valBody.data?.rate,
        commission: valBody.data?.commission,
        receiveAmount: valBody.data?.receiveAmount,
        isKycRequired: valBody.data?.isKycRequired,
        isTransactionAllowed: valBody.data?.isTransactionAllowed,
        kycUrl: valBody.data?.kycUrl ?? null,
        isProfileUpdateRequired: valBody.data?.isProfileUpdateRequired,
        source: "validate_rate",
      };
    }
  } catch (err) {
    log(`ℹ️ POST /api/v1/Rate/validateRate warning: ${(err as Error).message}`, "mito-retail");
  }

  // 2. Fallback to POST /api/v1/mito/Exchange/rates
  const payload = {
    userId: effectiveUserId,
    serviceCode: input.serviceCode || "MONEYTRANSFER",
    collectionMode: input.collectionMode,
    fromCountry: input.fromCountry.toUpperCase(),
    toCountry: input.toCountry.toUpperCase(),
    fromCurrency: input.fromCurrency.toUpperCase(),
    toCurrency: input.toCurrency.toUpperCase(),
    amount: input.amount,
    direction: input.direction || "S",
    providerId: input.providerId,
  };

  const res = await fetch(`${creds.baseUrl}/api/v1/mito/Exchange/rates`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const body = (await res.json().catch(() => ({}))) as {
    data?: {
      id?: string;
      rateId?: string;
      rate?: number;
      commission?: number;
      receiveAmount?: number;
    };
    message?: string;
  };

  const lockedId = body?.data?.id || body?.data?.rateId;
  if (res.ok && lockedId) {
    log(
      `✅ Locked Mito rate via POST /Exchange/rates (rateId=${lockedId}, providerCode=${input.providerCode || "-"}, providerId=${input.providerId})`,
      "mito-retail",
    );
    return {
      rateId: lockedId,
      rate: body.data?.rate,
      commission: body.data?.commission,
      receiveAmount: body.data?.receiveAmount,
      source: "exchange_rates",
    };
  }

  log(
    `ℹ️ Mito POST /api/v1/mito/Exchange/rates returned ${res.status} (${body?.message || "no message"}); resolving rateId from affiliateRates`,
    "mito-retail",
  );

  // 3. Fallback to affiliateRates rateId for the corridor so rateId is always captured
  const allAffiliate = await getMitoAffiliateRates();
  const matched =
    allAffiliate.find(
      (r) =>
        r.fromCurrency.toUpperCase() === input.fromCurrency.toUpperCase() &&
        r.toCurrency.toUpperCase() === input.toCurrency.toUpperCase() &&
        r.rateMoneyTransfer > 0,
    ) ||
    allAffiliate.find(
      (r) =>
        r.fromCurrency.toUpperCase() === input.fromCurrency.toUpperCase() &&
        r.toCurrency.toUpperCase() === input.toCurrency.toUpperCase(),
    );

  if (matched?.rateId) {
    return {
      rateId: matched.rateId,
      rate: matched.rateMoneyTransfer > 0 ? matched.rateMoneyTransfer : undefined,
      source: "affiliate_rates",
    };
  }

  return null;
}

export type MitoSendMoneyPaymentMethod =
  | "CARDCHECKOUT"
  | "PLAID"
  | "PAYBYBANK"
  | "TUNACCOUNT"
  | "BANKPAYMENT";

export const MITO_CHECKOUT_PUBLIC_KEY =
  process.env.MITO_CHECKOUT_PUBLIC_KEY || "pk_sbox_hxdmemjidz7nf3sfukhia4igsuf";

/**
 * Resolves a valid UUID `reasonId` from `GET /api/v1/mito/Lookups/types?lookupType=reason`
 * (or falls back to the verified Sandbox reason UUID).
 */
export async function resolveMitoReasonIdUuid(preferredReason?: string | null): Promise<string> {
  const DEFAULT_REASON_UUID = "1ba15877-5582-4076-a54e-5b10ac2a6f60";
  const raw = String(preferredReason || "").trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return raw;
  }
  if (!isMitoRetailConfigured()) return DEFAULT_REASON_UUID;
  try {
    const creds = loadMitoRetailCredentials()!;
    const { token } = await getMitoRetailToken();
    const res = await fetch(`${creds.baseUrl}/api/v1/mito/Lookups/types?lookupType=reason`, {
      headers: { Authorization: `Bearer ${token}`, apiKey: creds.apiKey },
    });
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        data?: { reason?: Array<{ id?: string; code?: string; name?: string }> };
      };
      const reasons = body?.data?.reason || [];
      const q = raw.toLowerCase();
      const matched =
        (q &&
          reasons.find(
            (r) =>
              (r.id && r.id.toLowerCase() === q) ||
              (r.code && r.code.toLowerCase() === q) ||
              (r.name && r.name.toLowerCase() === q),
          )) ||
        reasons[0];
      if (matched?.id) return matched.id;
    }
  } catch {
    // fallback below
  }
  return DEFAULT_REASON_UUID;
}

/**
 * Submits a payment transaction on Step 4 via `POST /api/v1/Transaction/SendMoney`
 * when clicking a payment method card (`CARDCHECKOUT`, `PLAID`, `PAYBYBANK`, `TUNACCOUNT`, `BANKPAYMENT`).
 */
export async function sendMitoTransaction(input: {
  userId?: string | null;
  reasonId?: string | null;
  paymentMethod: MitoSendMoneyPaymentMethod;
  sendCountryIso3: string;
  receiveCountryIso3: string;
  sendCurrency: string;
  receiveCurrency: string;
  sendAmount: number;
  commission: number;
  rateId: string;
  providerId: string;
  collectionMode: "BANKACCOUNT" | "MOBILEMONEY";
  beneficiaryId: string;
  paymentNarration?: string | null;
  direction?: "S" | "R";
  redirectSuccessUrl?: string | null;
  promoCode?: string | null;
  bonusAmount?: number | null;
}): Promise<{
  ok?: boolean;
  httpStatus?: number;
  tnxref?: string;
  status?: string;
  paymentUrl?: string | null;
  paymentSession?: Record<string, unknown> | null;
  linkToken?: string | null;
  paymentReference?: string | null;
  recipientPickupCode?: string | null;
  checkoutPublicKey?: string;
  requestPayload?: Record<string, unknown>;
  message?: string;
} | null> {
  if (!isMitoRetailConfigured()) return null;
  const creds = loadMitoRetailCredentials()!;
  const { token } = await getMitoRetailToken();

  const effectiveUserId = (input.userId || DEFAULT_MITO_SENDER_USER_ID).trim();
  const reasonId = await resolveMitoReasonIdUuid(input.reasonId);
  const rawRedirectCandidate = (
    input.redirectSuccessUrl ||
    process.env.MITO_REDIRECT_SUCCESS_URL ||
    `${serverConfig.publicBaseUrl.replace(/\/+$/, "")}/send-money`
  ).trim();
  const resolvedRedirectSuccessUrl =
    input.paymentMethod === "CARDCHECKOUT"
      ? rawRedirectCandidate
      : /localhost|127\.0\.0\.1/i.test(rawRedirectCandidate)
        ? "https://rhemito-ui.onrender.com/send-money"
        : rawRedirectCandidate;

  const buildPayload = (overrides?: {
    beneficiaryId?: string;
    rateId?: string;
    commission?: number;
    providerId?: string;
  }): Record<string, unknown> => ({
    userId: effectiveUserId,
    reasonId,
    channel: "WEB",
    service: "MONEYTRANSFER",
    paymentMethod: input.paymentMethod,
    sendCountry: input.sendCountryIso3.toUpperCase(),
    receiveCountry: input.receiveCountryIso3.toUpperCase(),
    sendCurrency: input.sendCurrency.toUpperCase(),
    receiveCurrency: input.receiveCurrency.toUpperCase(),
    sendAmount: input.sendAmount,
    commission: overrides?.commission ?? input.commission,
    rateId: overrides?.rateId || input.rateId,
    providerId: overrides?.providerId || input.providerId,
    isInternational: false,
    collectionMode: input.collectionMode,
    beneficiaryId: overrides?.beneficiaryId || input.beneficiaryId,
    paymentNarration: input.paymentNarration ?? "",
    direction: input.direction || "S",
    isScheduledTransaction: false,
    numberOfOccurences: 1,
    ...(input.paymentMethod === "PLAID"
      ? { RedirectSuccessUrl: resolvedRedirectSuccessUrl }
      : { isCardSaved: true, isNewFlow: true, RedirectSuccessUrl: resolvedRedirectSuccessUrl }),
  });

  let currentPayload = buildPayload();

  let res = await fetch(`${creds.baseUrl}/api/v1/Transaction/SendMoney`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apiKey: creds.apiKey,
    },
    body: JSON.stringify(currentPayload),
  });

  let body = (await res.json().catch(() => ({}))) as {
    status?: number;
    data?: {
      tnxref?: string;
      status?: string;
      paymentUrl?: string | null;
      paymentSession?: Record<string, unknown> | string | null;
      linkToken?: string | null;
      paymentReference?: string | null;
      recipientPickupCode?: string | null;
    };
    message?: string;
  };

  // If rateId expired or beneficiaryId belonged to a different user, refresh rateId / beneficiaryId for effectiveUserId and retry once
  if (!res.ok) {
    const errMsg = String(body?.message || "").toLowerCase();
    let retryBeneficiaryId = String(currentPayload.beneficiaryId || "");
    let retryProviderId = String(currentPayload.providerId || "");

    if (errMsg.includes("beneficiary") || !retryBeneficiaryId) {
      const userBens = await getMitoBeneficiaries({
        userId: effectiveUserId,
        collectionMode: input.collectionMode,
      });
      const modeFilteredBens = userBens.filter(
        (b) => String(b.collectionMode || "BANKACCOUNT").toUpperCase() === input.collectionMode,
      );
      const matchedBen =
        modeFilteredBens.find((b) => b.currency.toUpperCase() === input.receiveCurrency.toUpperCase()) ||
        modeFilteredBens[0];
      if (matchedBen?.beneficiaryId) {
        retryBeneficiaryId = matchedBen.beneficiaryId;
        if (matchedBen.providerId) {
          retryProviderId = matchedBen.providerId;
        }
      }
    }

    const refreshedRate = await lockMitoExchangeRate({
      userId: effectiveUserId,
      collectionMode: input.collectionMode,
      fromCountry: input.sendCountryIso3,
      toCountry: input.receiveCountryIso3,
      fromCurrency: input.sendCurrency,
      toCurrency: input.receiveCurrency,
      amount: input.sendAmount,
      direction: input.direction || "S",
      providerId: retryProviderId,
    });

    if (refreshedRate?.rateId) {
      currentPayload = buildPayload({
        beneficiaryId: retryBeneficiaryId,
        providerId: retryProviderId,
        rateId: refreshedRate.rateId,
        commission:
          typeof refreshedRate.commission === "number" && Number.isFinite(refreshedRate.commission)
            ? refreshedRate.commission
            : input.commission,
      });
      res = await fetch(`${creds.baseUrl}/api/v1/Transaction/SendMoney`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apiKey: creds.apiKey,
        },
        body: JSON.stringify(currentPayload),
      });
      body = (await res.json().catch(() => ({}))) as typeof body;
    }
  }

  let parsedPaymentSession: Record<string, unknown> | null = null;
  const rawPaymentSession = body?.data?.paymentSession;
  if (rawPaymentSession && typeof rawPaymentSession === "object" && !Array.isArray(rawPaymentSession)) {
    parsedPaymentSession = rawPaymentSession as Record<string, unknown>;
  } else if (typeof rawPaymentSession === "string" && rawPaymentSession.trim().startsWith("{")) {
    try {
      const parsedObj = JSON.parse(rawPaymentSession) as Record<string, unknown>;
      if (parsedObj && typeof parsedObj === "object" && !Array.isArray(parsedObj)) {
        parsedPaymentSession = parsedObj;
      }
    } catch {
      parsedPaymentSession = null;
    }
  }

  const rawPaymentUrl = body?.data?.paymentUrl ?? null;
  if (!parsedPaymentSession && rawPaymentUrl && typeof rawPaymentUrl === "string" && rawPaymentUrl.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(rawPaymentUrl) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && (parsed.id || parsed.payment_session_secret || parsed.payment_session_token)) {
        parsedPaymentSession = parsed;
      }
    } catch {
      parsedPaymentSession = null;
    }
  }

  if (res.ok && body?.data) {
    log(
      `✅ Mito POST /api/v1/Transaction/SendMoney succeeded (tnxref=${body.data.tnxref || "-"}, status=${body.data.status || "-"}, paymentMethod=${input.paymentMethod})`,
      "mito-retail",
    );
    return {
      ok: true,
      httpStatus: res.status,
      tnxref: body.data.tnxref,
      status: body.data.status,
      paymentUrl: rawPaymentUrl,
      paymentSession: parsedPaymentSession,
      linkToken: body.data.linkToken ?? null,
      paymentReference: body.data.paymentReference ?? null,
      recipientPickupCode: body.data.recipientPickupCode ?? null,
      checkoutPublicKey: MITO_CHECKOUT_PUBLIC_KEY,
      requestPayload: currentPayload,
      message: body.message,
    };
  }

  log(
    `⚠️ Mito POST /api/v1/Transaction/SendMoney returned ${res.status}: ${body?.message || "Unknown"}`,
    "mito-retail",
  );
  return {
    ok: false,
    httpStatus: res.status,
    checkoutPublicKey: MITO_CHECKOUT_PUBLIC_KEY,
    requestPayload: currentPayload,
    message: body?.message || `HTTP ${res.status}`,
  };
}

/**
 * Initiates a hosted transaction in Mito Sandbox (`POST /api/v1/mito/Transactions/InitiateHostedTransaction`).
 *
 * Request body fields per Mito Retail API spec:
 * - serviceCode (string, required): MONEYTRANSFER | MOBILETOPUP | BILLPAYMENT
 * - collectionMode (string, required): BANKACCOUNT | CASH | MOBILEMONEY (BANKACCOUNT or MOBILEMONEY in our app)
 * - sendCountryIso3 (string, required): Sender country ISO3
 * - receiveCountryIso3 (string, required): Payout country ISO3
 * - sendCurrency (string, required): Send currency
 * - receiveCurrency (string, required): Receive currency
 * - sendAmount (number, required): Amount to send
 * - receiveAmount (number, conditional): Own rates required; omit for MITO rates
 * - providerId (string, conditional): Own rates required; usually required for MITO rates
 * - rate (number, conditional): Own rates FX; omit for MITO rates
 * - rateId (string, conditional): MITO rates quote id from POST /Exchange/rates; omit for own rates
 * - userId (string, required): Customer user UUID from Create User
 * - redirectUrl (string, required): Return URL after hosted steps
 * - PartnerReferenceNumber (string, required): Idempotent partner reference
 * - reasonCode (string, required): Lookup id/code from GET /Lookups/types (reason)
 * - sourceOfFundCode (string, required): Lookup id/code from GET /Lookups/types (source-of-funds)
 * - paymentNarration (string, required): Payment description
 * - webhookUrl (string, required): HTTPS webhook URL
 * - beneficiaryId (string, optional): Beneficiary UUID
 * - commission (number, optional): Optional when enabled for affiliate
 */
export async function initiateMitoHostedTransaction(input: {
  userId: string;
  beneficiaryId?: string;
  providerId?: string;
  rateId?: string;
  rate?: number;
  receiveAmount?: number;
  commission?: number;
  serviceCode?: "MONEYTRANSFER" | "MOBILETOPUP" | "BILLPAYMENT" | string;
  collectionMode: "BANKACCOUNT" | "MOBILEMONEY";
  sendCountryIso3: string;
  receiveCountryIso3: string;
  sendCurrency: string;
  receiveCurrency: string;
  sendAmount: number;
  partnerReferenceNumber: string;
  reasonCode: string;
  sourceOfFundCode: string;
  paymentNarration: string;
  redirectUrl?: string;
  webhookUrl?: string;
  preferredPaymentMethod?: string;
}): Promise<{
  retailTransactionId?: string;
  reference?: string;
  status?: string;
  requiredAction?: Record<string, unknown>;
  hostedUrl?: string;
  requestPayload?: Record<string, unknown>;
  message?: string;
} | null> {
  if (!isMitoRetailConfigured()) return null;
  const creds = loadMitoRetailCredentials()!;
  const { token } = await getMitoRetailToken();

  const rawHostedRedirectUrl = (input.redirectUrl || "https://rhemito-ui.onrender.com/send-money").trim();
  const resolvedHostedRedirectUrl =
    /localhost|127\.0\.0\.1/i.test(rawHostedRedirectUrl)
      ? "https://rhemito-ui.onrender.com/send-money"
      : rawHostedRedirectUrl;

  const payload: Record<string, unknown> = {
    serviceCode: input.serviceCode || "MONEYTRANSFER",
    collectionMode: input.collectionMode,
    sendCountryIso3: input.sendCountryIso3.toUpperCase(),
    receiveCountryIso3: input.receiveCountryIso3.toUpperCase(),
    sendCurrency: input.sendCurrency.toUpperCase(),
    receiveCurrency: input.receiveCurrency.toUpperCase(),
    sendAmount: input.sendAmount,
    userId: input.userId,
    redirectUrl: resolvedHostedRedirectUrl,
    PartnerReferenceNumber: input.partnerReferenceNumber,
    reasonCode: input.reasonCode,
    sourceOfFundCode: input.sourceOfFundCode,
    paymentNarration: input.paymentNarration || "Money transfer",
    webhookUrl: input.webhookUrl || getMitoWebhookUrl(),
  };

  if (input.providerId) {
    payload.providerId = input.providerId;
  }

  // Per spec: MITO rates use rateId (omit rate & receiveAmount); Own rates use rate & receiveAmount (omit rateId)
  if (input.rateId) {
    payload.rateId = input.rateId;
  } else {
    if (typeof input.receiveAmount === "number" && Number.isFinite(input.receiveAmount)) {
      payload.receiveAmount = input.receiveAmount;
    }
    if (typeof input.rate === "number" && Number.isFinite(input.rate)) {
      payload.rate = input.rate;
    }
  }

  if (input.beneficiaryId) {
    payload.beneficiaryId = input.beneficiaryId;
  }
  if (typeof input.commission === "number" && Number.isFinite(input.commission)) {
    payload.commission = input.commission;
  }
  if (input.preferredPaymentMethod && input.preferredPaymentMethod.trim()) {
    payload.PreferredPaymentMethod = input.preferredPaymentMethod.trim().toUpperCase();
  }

  const res = await fetch(`${creds.baseUrl}/api/v1/mito/Transactions/InitiateHostedTransaction`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "Mito-Secret-Key": creds.secretKey,
    },
    body: JSON.stringify(payload),
  });

  const body = (await res.json().catch(() => ({}))) as {
    data?: {
      retailTransactionId?: string;
      reference?: string;
      status?: string;
      paymentUrl?: string;
      PaymentUrl?: string;
      requiredAction?: {
        payment?: { link?: string; url?: string; isCompleted?: boolean };
        kyc?: { link?: string; url?: string; isCompleted?: boolean };
        beneficiary?: { link?: string; url?: string; isCompleted?: boolean };
        [key: string]: unknown;
      };
    };
    message?: string;
  };

  const hostedUrl =
    body?.data?.requiredAction?.payment?.link ||
    body?.data?.requiredAction?.payment?.url ||
    body?.data?.paymentUrl ||
    body?.data?.PaymentUrl ||
    body?.data?.requiredAction?.kyc?.link ||
    body?.data?.requiredAction?.kyc?.url ||
    body?.data?.requiredAction?.beneficiary?.link ||
    body?.data?.requiredAction?.beneficiary?.url ||
    undefined;

  if (res.ok && body?.data) {
    log(
      `✅ Initiated Mito Hosted Transaction (ref=${body.data.reference || body.data.retailTransactionId})`,
      "mito-retail",
    );
    return {
      retailTransactionId: body.data.retailTransactionId,
      reference: body.data.reference,
      status: body.data.status,
      requiredAction: body.data.requiredAction,
      hostedUrl,
      requestPayload: payload,
      message: body.message,
    };
  }

  log(
    `ℹ️ Mito POST /api/v1/mito/Transactions/InitiateHostedTransaction returned ${res.status}: ${body?.message || "Unknown"}`,
    "mito-retail",
  );
  return {
    requestPayload: payload,
    message: body?.message || `HTTP ${res.status}`,
  };
}

export interface MitoKycJourneyResult {
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

/**
 * Creates or checks a Mini KYC / Compliance Journey via `POST /api/v1/mito/Journey` (`journeyType: 1`),
 * matching `rhemito-web-nextjs-dev.herokuapp.com/compliance`.
 */
export async function createMitoKycJourney(input: {
  userId: string;
  returnUrl?: string | null;
  webhookUrl?: string | null;
  journeyType?: number;
}): Promise<MitoKycJourneyResult | null> {
  if (!isMitoRetailConfigured()) return null;
  const creds = loadMitoRetailCredentials()!;
  const { token } = await getMitoRetailToken();
  const effectiveUserId = (input.userId || DEFAULT_MITO_SENDER_USER_ID).trim();

  const rawReturnCandidate = (
    input.returnUrl ||
    `${serverConfig.publicBaseUrl.replace(/\/+$/, "")}/kyc/return`
  ).trim();
  const resolvedReturnUrl =
    /localhost|127\.0\.0\.1|^http:\/\//i.test(rawReturnCandidate)
      ? "https://rhemito-ui.onrender.com/kyc/return"
      : rawReturnCandidate;

  const payload = {
    customerId: effectiveUserId,
    userId: effectiveUserId,
    returnUrl: resolvedReturnUrl,
    redirectUrl: resolvedReturnUrl,
    webhookUrl: input.webhookUrl || getMitoWebhookUrl(),
    journeyType: input.journeyType ?? 1,
  };

  try {
    const res = await fetch(`${creds.baseUrl}/api/v1/mito/Journey`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apiKey: creds.apiKey,
      },
      body: JSON.stringify(payload),
    });

    const body = (await res.json().catch(() => ({}))) as {
      data?: {
        journeyId?: string | null;
        journeyCode?: string | null;
        qrCodeUrl?: string | null;
        hostedUrl?: string | null;
        expiryDate?: string | null;
        kycFlow?: string | null;
        kycStatus?: string | null;
        kycType?: string | null;
      };
      message?: string | null;
    };

    log(
      `✅ Mito POST /api/v1/mito/Journey (userId=${effectiveUserId}, kycFlow=${body?.data?.kycFlow ?? "-"}, kycStatus=${body?.data?.kycStatus ?? "-"}, journeyCode=${body?.data?.journeyCode ?? "none"})`,
      "mito-retail",
    );

    return {
      journeyId: body?.data?.journeyId ?? null,
      journeyCode: body?.data?.journeyCode ?? null,
      qrCodeUrl: body?.data?.qrCodeUrl ?? null,
      hostedUrl: body?.data?.hostedUrl ?? null,
      expiryDate: body?.data?.expiryDate ?? null,
      kycFlow: body?.data?.kycFlow ?? null,
      kycStatus: body?.data?.kycStatus ?? null,
      kycType: body?.data?.kycType ?? null,
      message: body?.message ?? null,
    };
  } catch (err) {
    console.warn("[mito-retail] createMitoKycJourney warning:", err);
    return null;
  }
}

export interface MitoJourneyStatusResult {
  journeyId?: string | null;
  journeyCode: string;
  journeyStatus: string;
  orderNo: string | null;
  orderStatus: string | null;
  partnerReferenceNumber: string | null;
  reference: string | null;
  currency: string | null;
  amount: number | null;
  returnUrl?: string | null;
  qrCodeUrl?: string | null;
  journeyType?: string | null;
  journeySessionId?: string | null;
  modules?: Array<Record<string, unknown>>;
}

/**
 * Fetches live journey & payment status from `GET /api/v1/mito/Journey/status?journeyCode=<journeyCode>`.
 * Used by the frontend while the Instant Pay By Bank modal is open so that mobile QR payments,
 * completions, failures, cancellations, or expirations immediately close the modal and display
 * the full-page Payment Status view.
 */
export async function getMitoJourneyStatus(journeyCode: string): Promise<MitoJourneyStatusResult | null> {
  const cleanCode = String(journeyCode || "").trim();
  if (!cleanCode || !isMitoRetailConfigured()) return null;
  const creds = loadMitoRetailCredentials()!;
  try {
    const res = await fetch(
      `${creds.baseUrl}/api/v1/mito/Journey/status?journeyCode=${encodeURIComponent(cleanCode)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          apiKey: creds.apiKey,
        },
      },
    );
    if (!res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as {
      data?: {
        journeyId?: string | null;
        journeyCode?: string;
        journeyStatus?: string;
        orderNo?: string | null;
        orderStatus?: string | null;
        partnerReferenceNumber?: string | null;
        reference?: string | null;
        currency?: string | null;
        amount?: number | null;
        returnUrl?: string | null;
        qrCodeUrl?: string | null;
        journeyType?: string | null;
        journeySessionId?: string | null;
        modules?: Array<Record<string, unknown>>;
      };
    };
    if (!body?.data) return null;
    return {
      journeyId: body.data.journeyId ? String(body.data.journeyId) : null,
      journeyCode: String(body.data.journeyCode || cleanCode),
      journeyStatus: String(body.data.journeyStatus || ""),
      orderNo: body.data.orderNo ? String(body.data.orderNo) : null,
      orderStatus: body.data.orderStatus ? String(body.data.orderStatus) : null,
      partnerReferenceNumber: body.data.partnerReferenceNumber ? String(body.data.partnerReferenceNumber) : null,
      reference: body.data.reference ? String(body.data.reference) : null,
      currency: body.data.currency ? String(body.data.currency) : null,
      amount: typeof body.data.amount === "number" ? body.data.amount : null,
      returnUrl: body.data.returnUrl ? String(body.data.returnUrl) : null,
      qrCodeUrl: body.data.qrCodeUrl ? String(body.data.qrCodeUrl) : null,
      journeyType: body.data.journeyType ? String(body.data.journeyType) : null,
      journeySessionId: body.data.journeySessionId ? String(body.data.journeySessionId) : null,
      modules: Array.isArray(body.data.modules) ? body.data.modules : undefined,
    };
  } catch (err) {
    console.warn("[mito-retail] getMitoJourneyStatus warning:", err);
    return null;
  }
}

/**
 * Triggers Mito Staging's `[AllowAnonymous]` `GET /api/v1/Payment/CheckoutPaymentSatus?cko-session-id=<pay_...>`
 * server-side (`redirect: "manual"`) so Mito's `CheckoutSatusRequesttHandler` enqueues `ProcessOrder(result.Id)`
 * (setting `PaymentStatus = PAID` and `TransactionStatus = AWAITINGPROCESSING` / `INREVIEW`), while keeping the
 * customer's browser on Rhemito-UI instead of following Mito's 302 redirect to `rhemito-web-nextjs-dev`.
 */
export async function syncMitoCardPaymentStatus(ckoIdOrPaymentId: string): Promise<{
  tnxref: string | null;
  status: string | null;
  paymentStatus: string | null;
  locationUrl: string | null;
} | null> {
  const cleanId = String(ckoIdOrPaymentId || "").trim();
  if (!cleanId || cleanId.startsWith("ps_") || !isMitoRetailConfigured()) return null;
  const creds = loadMitoRetailCredentials()!;
  try {
    const res = await fetch(
      `${creds.baseUrl}/api/v1/Payment/CheckoutPaymentSatus?cko-session-id=${encodeURIComponent(cleanId)}`,
      {
        method: "GET",
        redirect: "manual",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/json,*/*",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    const locationHeader = res.headers.get("location");
    if (!locationHeader) return null;
    const parsed = new URL(locationHeader, creds.baseUrl);
    const tnxref = parsed.searchParams.get("tnxref")?.trim() || null;
    const status = parsed.searchParams.get("status")?.trim() || null;
    const paymentStatus = parsed.searchParams.get("paymentStatus")?.trim() || null;
    log(
      `✅ Mito GET /api/v1/Payment/CheckoutPaymentSatus synced (ckoId=${cleanId}, tnxref=${tnxref || "-"}, status=${status || "-"}, paymentStatus=${paymentStatus || "-"})`,
      "mito-retail",
    );
    return {
      tnxref,
      status,
      paymentStatus,
      locationUrl: locationHeader,
    };
  } catch (err) {
    log(
      `ℹ️ Mito CheckoutPaymentSatus sync warning for ${cleanId}: ${(err as Error).message}`,
      "mito-retail",
    );
    return null;
  }
}

/**
 * Initiates an Affiliate Pay By Bank (`PLAID`) RetailTransaction + `RetailCollection` (`journeyType: 4`)
 * hosted journey in Mito Staging.
 *
 * Why this path is required for Affiliate (`1112`) Pay By Bank:
 * - Calling `POST /api/v1/Transaction/SendMoney` with an Affiliate token sets `transaction.AffiliateId`,
 *   and `furp02-core`'s `CheckoutTransactionWebhookSettlementService.ApplyPaymentCapturedAsync` exits early
 *   whenever `transaction.AffiliateId.HasValue` is true — leaving Plaid `Transaction` rows permanently in
 *   `AWAITINGPAYMENT`.
 * - Creating a `RetailTransaction` (`InitiateHostedTransaction` with `PreferredPaymentMethod: "PLAID"`) paired
 *   with a `RetailCollection` journey (`POST /api/v1/mito/Journey`, `journeyType: 4`, `paymentProviders: "PLAID"`)
 *   opens the exact same `/retail-payment?journeyCode=JNY-...` Plaid modal while routing Plaid's settlement
 *   webhook (`PlaidPaymentSourceType.Retail`) through `RetailAffiliatePaymentSettlementService`, which marks
 *   the `RetailTransaction` `PAID` and migrates it into `dbo.Transactions`.
 */
export async function initiateMitoPlaidRetailCollection(input: {
  userId: string;
  beneficiaryId: string;
  providerId: string;
  rateId: string;
  commission?: number;
  serviceCode?: "MONEYTRANSFER" | "MOBILETOPUP" | "BILLPAYMENT" | string;
  collectionMode: "BANKACCOUNT" | "MOBILEMONEY";
  sendCountryIso3: string;
  receiveCountryIso3: string;
  sendCurrency: string;
  receiveCurrency: string;
  sendAmount: number;
  partnerReferenceNumber: string;
  reasonCode?: string | null;
  sourceOfFundCode?: string | null;
  paymentNarration?: string;
  redirectUrl?: string;
  webhookUrl?: string;
}): Promise<{
  ok: boolean;
  retailTransactionId?: string;
  reference?: string;
  partnerReferenceNumber: string;
  paymentUrl?: string | null;
  journeyCode?: string | null;
  qrCodeUrl?: string | null;
  requestPayload?: Record<string, unknown>;
  message?: string;
} | null> {
  if (!isMitoRetailConfigured()) return null;
  const creds = loadMitoRetailCredentials()!;
  const { token } = await getMitoRetailToken();
  const effectiveUserId = (input.userId || DEFAULT_MITO_SENDER_USER_ID).trim();

  // Ensure reasonCode and sourceOfFundCode are valid Mito lookup shortcodes (never GUIDs or UI labels)
  // so `RetailToTransactionCommandHandler.CreateTransactionObjectAsync` (`GetSourceOfFunds` / `GetPurposeByCode`) succeeds.
  let resolvedReasonCode = String(input.reasonCode || "").trim();
  let resolvedSofCode = String(input.sourceOfFundCode || "").trim();
  try {
    const lookups = await getMitoLookupTypes("reason,source-of-funds");
    const reasons = lookups.reason || [];
    const matchedReason = reasons.find(
      (r) =>
        (r.code && r.code.toUpperCase() === resolvedReasonCode.toUpperCase()) ||
        (r.id && r.id.toUpperCase() === resolvedReasonCode.toUpperCase()) ||
        (r.name && r.name.toLowerCase() === resolvedReasonCode.toLowerCase()),
    );
    resolvedReasonCode =
      matchedReason?.code ||
      reasons[0]?.code ||
      (/^[A-Z_]+$/i.test(resolvedReasonCode) ? resolvedReasonCode.toUpperCase() : "FOROWNEXPENDITURES");

    const sofs = lookups.sourceOfFunds || [];
    const matchedSof = sofs.find(
      (s) =>
        (s.code && s.code.toUpperCase() === resolvedSofCode.toUpperCase()) ||
        (s.id && s.id.toUpperCase() === resolvedSofCode.toUpperCase()) ||
        (s.name && s.name.toLowerCase() === resolvedSofCode.toLowerCase()),
    );
    resolvedSofCode =
      matchedSof?.code ||
      sofs[0]?.code ||
      (/^[A-Z_]+$/i.test(resolvedSofCode) ? resolvedSofCode.toUpperCase() : "TRADING");
  } catch {
    if (!resolvedReasonCode || resolvedReasonCode.includes("-") || resolvedReasonCode.includes(" ")) {
      resolvedReasonCode = "FOROWNEXPENDITURES";
    }
    if (!resolvedSofCode || resolvedSofCode.includes("-") || resolvedSofCode.includes(" ")) {
      resolvedSofCode = "TRADING";
    }
  }

  const basePartnerRef = String(input.partnerReferenceNumber || "").trim().replace(/-PBB-[A-Z0-9]+$/i, "");
  const attemptSuffix = Date.now().toString(36).toUpperCase();
  const uniquePartnerRef = `${basePartnerRef}-PBB-${attemptSuffix}`;

  const rawReturnUrl = (input.redirectUrl || "https://rhemito-ui.onrender.com/send-money").trim();
  const resolvedReturnUrl = /localhost|127\.0\.0\.1/i.test(rawReturnUrl)
    ? "https://rhemito-ui.onrender.com/send-money"
    : rawReturnUrl;

  const initiated = await initiateMitoHostedTransaction({
    userId: effectiveUserId,
    beneficiaryId: input.beneficiaryId,
    providerId: input.providerId,
    rateId: input.rateId,
    commission: input.commission,
    serviceCode: input.serviceCode || "MONEYTRANSFER",
    collectionMode: input.collectionMode,
    sendCountryIso3: input.sendCountryIso3,
    receiveCountryIso3: input.receiveCountryIso3,
    sendCurrency: input.sendCurrency,
    receiveCurrency: input.receiveCurrency,
    sendAmount: input.sendAmount,
    partnerReferenceNumber: uniquePartnerRef,
    reasonCode: resolvedReasonCode,
    sourceOfFundCode: resolvedSofCode,
    paymentNarration: input.paymentNarration || "Money transfer",
    redirectUrl: resolvedReturnUrl,
    webhookUrl: input.webhookUrl || getMitoWebhookUrl(),
    preferredPaymentMethod: "PLAID",
  });

  if (!initiated?.reference && !initiated?.retailTransactionId) {
    return {
      ok: false,
      partnerReferenceNumber: uniquePartnerRef,
      requestPayload: initiated?.requestPayload,
      message: initiated?.message || "Failed to initiate Mito Retail Pay By Bank transaction.",
    };
  }

  const retailRef = String(initiated.reference || "").trim();
  const totalPayableAmount = Number(
    (input.sendAmount + (typeof input.commission === "number" && Number.isFinite(input.commission) ? input.commission : 0)).toFixed(2),
  );

  // Mint a `RetailCollection` (`journeyType: 4`) journey bound to `uniquePartnerRef` so `/retail-payment`
  // opens Plaid directly in our modal and resolves `PlaidPaymentSourceType.Retail` (zero TransactionNumber collision).
  const journeyPayload = {
    customerId: effectiveUserId,
    journeyType: 4,
    skipKyc: true,
    partnerReferenceNumber: uniquePartnerRef,
    reference: retailRef || uniquePartnerRef,
    currency: input.sendCurrency.toUpperCase(),
    amount: totalPayableAmount > 0 ? totalPayableAmount : input.sendAmount,
    payingTo: "Rhemito",
    paymentProviders: "PLAID",
    returnUrl: resolvedReturnUrl,
  };

  const journeyRes = await fetch(`${creds.baseUrl}/api/v1/mito/Journey`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apiKey: creds.apiKey,
    },
    body: JSON.stringify(journeyPayload),
    signal: AbortSignal.timeout(15000),
  });

  const journeyBody = (await journeyRes.json().catch(() => ({}))) as {
    data?: {
      journeyId?: string | null;
      journeyCode?: string | null;
      hostedUrl?: string | null;
      qrCodeUrl?: string | null;
    };
    message?: string;
  };

  const hostedPaymentUrl = journeyBody?.data?.hostedUrl || initiated.hostedUrl || null;
  const journeyCode = journeyBody?.data?.journeyCode || null;

  if (!hostedPaymentUrl) {
    return {
      ok: false,
      retailTransactionId: initiated.retailTransactionId,
      reference: retailRef || undefined,
      partnerReferenceNumber: uniquePartnerRef,
      requestPayload: initiated.requestPayload,
      message: journeyBody?.message || "Failed to create Mito RetailCollection journey for Pay By Bank.",
    };
  }

  log(
    `✅ Mito Pay By Bank RetailCollection ready (retailRef=${retailRef || "-"}, partnerRef=${uniquePartnerRef}, journeyCode=${journeyCode || "-"})`,
    "mito-retail",
  );

  return {
    ok: true,
    retailTransactionId: initiated.retailTransactionId,
    reference: retailRef || undefined,
    partnerReferenceNumber: uniquePartnerRef,
    paymentUrl: hostedPaymentUrl,
    journeyCode,
    qrCodeUrl: journeyBody?.data?.qrCodeUrl ?? null,
    requestPayload: initiated.requestPayload,
    message: journeyBody?.message || initiated.message,
  };
}

/**
 * Verifies & finalizes an Affiliate Pay By Bank (`PLAID`) `RetailTransaction` in Mito Staging after
 * Plaid Link completes:
 * 1. Polls `GET /api/v1/mito/Transactions/by-reference` briefly (up to ~4.8s) if Plaid's `WALLET` `SETTLED`
 *    webhook to `furp02-staging` is still in flight.
 * 2. When `status === "AWAITINGAFFILIATEUPDATE"` (`IsProcessByAffiliate == true`), calls
 *    `GET /api/v1/mito/Transactions/PaymentConfirmation?referenceNo=<ref>&approvalStatus=Approve`.
 * 3. When `status === "READYTOPROCESS"` (`IsProcessByAffiliate == false`), triggers
 *    `POST /api/v1/HangFire/MoveRetailToTransaction` so Mito Staging immediately migrates the `PAID`
 *    `RetailTransaction` into a `PAID` `Transaction` (`INPROGRESS` / `AWAITINGPROCESSING` / `COMPSUCCESS`)
 *    without waiting for the 5-minute recurring job.
 */
export async function syncMitoPlaidRetailPaymentStatus(input: {
  partnerReferenceNumber?: string | null;
  retailReference?: string | null;
}): Promise<{
  reference: string | null;
  partnerReferenceNumber: string | null;
  status: string | null;
  paymentStatus: string | null;
} | null> {
  const partnerRef = String(input.partnerReferenceNumber || "").trim();
  const retailRef = String(input.retailReference || "").trim();
  if ((!partnerRef && !retailRef) || !isMitoRetailConfigured()) return null;

  const creds = loadMitoRetailCredentials()!;
  try {
    const { token } = await getMitoRetailToken();
    const authHeaders = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      apiKey: creds.apiKey,
    };

    const fetchRetailState = async (): Promise<{
      reference: string | null;
      partnerReferenceNumber: string | null;
      status: string | null;
      paymentStatus: string | null;
    } | null> => {
      if (partnerRef) {
        const q = new URLSearchParams({ partnerReferenceNumber: partnerRef });
        if (retailRef) q.set("reference", retailRef);
        const r = await fetch(`${creds.baseUrl}/api/v1/mito/Transactions/by-reference?${q.toString()}`, {
          method: "GET",
          headers: authHeaders,
          signal: AbortSignal.timeout(6000),
        });
        if (r.ok) {
          const b = (await r.json().catch(() => ({}))) as {
            data?: {
              reference?: string | null;
              partnerReferenceNumber?: string | null;
              status?: string | null;
              paymentStatus?: string | null;
            };
          };
          if (b?.data) {
            return {
              reference: b.data.reference ? String(b.data.reference) : retailRef || null,
              partnerReferenceNumber: b.data.partnerReferenceNumber ? String(b.data.partnerReferenceNumber) : partnerRef,
              status: b.data.status ? String(b.data.status) : null,
              paymentStatus: b.data.paymentStatus ? String(b.data.paymentStatus) : null,
            };
          }
        }
      } else if (retailRef) {
        const r = await fetch(
          `${creds.baseUrl}/api/v1/mito/Transactions/GetHostedTransactionStatus?reference=${encodeURIComponent(retailRef)}`,
          {
            method: "GET",
            headers: authHeaders,
            signal: AbortSignal.timeout(6000),
          },
        );
        if (r.ok) {
          const b = (await r.json().catch(() => ({}))) as {
            data?: {
              reference?: string | null;
              partnerReferenceNumber?: string | null;
              transactionStatus?: string | null;
            };
          };
          if (b?.data) {
            return {
              reference: b.data.reference ? String(b.data.reference) : retailRef,
              partnerReferenceNumber: b.data.partnerReferenceNumber ? String(b.data.partnerReferenceNumber) : null,
              status: b.data.transactionStatus ? String(b.data.transactionStatus) : null,
              paymentStatus: null,
            };
          }
        }
      }
      return null;
    };

    let state = await fetchRetailState();
    for (let attempt = 0; attempt < 6; attempt++) {
      const stUpper = String(state?.status || "").trim().toUpperCase();
      const psUpper = String(state?.paymentStatus || "").trim().toUpperCase();
      if (
        psUpper === "PAID" ||
        stUpper === "READYTOPROCESS" ||
        stUpper === "AWAITINGAFFILIATEUPDATE" ||
        stUpper === "INPROGRESS" ||
        stUpper === "PROCESSED"
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
      state = await fetchRetailState();
    }

    let stUpper = String(state?.status || "").trim().toUpperCase();
    const effectiveRetailRef = state?.reference || retailRef;

    if (stUpper === "AWAITINGAFFILIATEUPDATE" && effectiveRetailRef) {
      const confirmRes = await fetch(
        `${creds.baseUrl}/api/v1/mito/Transactions/PaymentConfirmation?referenceNo=${encodeURIComponent(effectiveRetailRef)}&approvalStatus=Approve`,
        {
          method: "GET",
          headers: authHeaders,
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!confirmRes.ok) {
        log(
          `⚠️ Mito PaymentConfirmation returned HTTP ${confirmRes.status} for retailRef=${effectiveRetailRef}`,
          "mito-retail",
        );
      }
      state = (await fetchRetailState()) ?? state;
      stUpper = String(state?.status || "").trim().toUpperCase();
    }

    const psAfterConfirm = String(state?.paymentStatus || "").trim().toUpperCase();
    if (
      stUpper === "READYTOPROCESS" ||
      (psAfterConfirm === "PAID" && stUpper !== "INPROGRESS" && stUpper !== "PROCESSED")
    ) {
      const moveRes = await fetch(`${creds.baseUrl}/api/v1/HangFire/MoveRetailToTransaction`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(10000),
      });
      if (!moveRes.ok) {
        log(
          `⚠️ Mito MoveRetailToTransaction returned HTTP ${moveRes.status} for retailRef=${effectiveRetailRef || "-"}`,
          "mito-retail",
        );
      }
      state = (await fetchRetailState()) ?? state;
    }

    log(
      `✅ Mito Pay By Bank RetailTransaction sync finished (retailRef=${state?.reference || retailRef || "-"}, partnerRef=${state?.partnerReferenceNumber || partnerRef || "-"}, status=${state?.status || "-"}, paymentStatus=${state?.paymentStatus || "-"})`,
      "mito-retail",
    );
    return state;
  } catch (err) {
    log(
      `ℹ️ Mito Pay By Bank RetailTransaction sync warning (${partnerRef || retailRef}): ${(err as Error).message}`,
      "mito-retail",
    );
    return null;
  }
}

// ─── Mito Retail Webhook Signing, Verification & Inspector Log ────────────────

const DEFAULT_MITO_WEBHOOK_SECRET_KEY = "f47ee7a1-aca4-4a6b-83a6-a802369bdddc";

export function getMitoWebhookSecretKey(overrideSecret?: string): string {
  if (overrideSecret && overrideSecret.trim()) return overrideSecret.trim();
  const creds = loadMitoRetailCredentials();
  if (creds?.webhookSecretKey) return creds.webhookSecretKey;
  return (process.env.MITO_RETAIL_WEBHOOK_SECRET || DEFAULT_MITO_WEBHOOK_SECRET_KEY).trim();
}

export function stripMitoSignatureFromRawJson(rawJson: string): string {
  // Trailing ,"signature":"..." before the final }
  const strippedTrailing = rawJson.replace(
    /\s*,\s*"signature"\s*:\s*"(?:\\.|[^"\\])*"\s*(\}\s*)$/,
    "$1",
  );
  if (strippedTrailing !== rawJson) return strippedTrailing;

  // Leading {"signature":"...", at the start of the JSON object
  const strippedLeading = rawJson.replace(
    /^(\s*\{\s*)"signature"\s*:\s*"(?:\\.|[^"\\])*"\s*,\s*/,
    "$1",
  );
  if (strippedLeading !== rawJson) return strippedLeading;

  // Middle ,"signature":"...", anywhere at top level
  return rawJson.replace(/,\s*"signature"\s*:\s*"(?:\\.|[^"\\])*"/, "");
}

export function computeMitoWebhookSignature(rawBodyWithoutSig: string, secret?: string): string {
  const key = getMitoWebhookSecretKey(secret);
  return crypto.createHmac("sha256", key).update(rawBodyWithoutSig, "utf8").digest("base64");
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function normalizeSignatureValue(sig: string): string {
  return String(sig || "")
    .trim()
    .replace(/^sha256=/i, "")
    .replace(/\\u002[bB]/g, "+")
    .replace(/\\u003[dD]/g, "=")
    .replace(/\\u002[fF]/g, "/");
}

export function verifyMitoWebhookSignature(
  rawBody: string | Buffer | undefined,
  parsedBody: Record<string, any>,
  headers?: Record<string, any>,
  secretOverride?: string,
): {
  valid: boolean;
  hasSignature: boolean;
  reason: string;
  computedSignature?: string;
} {
  const secret = getMitoWebhookSecretKey(secretOverride);
  const rawStr =
    typeof rawBody === "string"
      ? rawBody
      : Buffer.isBuffer(rawBody)
        ? rawBody.toString("utf8")
        : "";

  const headerSigRaw =
    headers?.["x-mito-signature"] ||
    headers?.["x-webhook-signature"] ||
    headers?.["x-signature"] ||
    headers?.["mito-signature"] ||
    "";
  const headerSecretRaw =
    headers?.["x-webhook-secret"] ||
    headers?.["webhook-secret-key"] ||
    headers?.["mito-webhook-secret"] ||
    "";

  const bodySigRaw = parsedBody && typeof parsedBody.signature === "string" ? parsedBody.signature : "";
  const providedSig = normalizeSignatureValue(bodySigRaw || String(headerSigRaw || ""));
  const providedSecret = String(headerSecretRaw || "").trim();

  // Build candidate JSON strings without the "signature" property
  const candidates: string[] = [];
  if (rawStr) {
    const stripped = stripMitoSignatureFromRawJson(rawStr);
    candidates.push(stripped);
    if (stripped !== rawStr) {
      candidates.push(rawStr);
    }
  }
  if (parsedBody && typeof parsedBody === "object") {
    const clone: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsedBody)) {
      if (k !== "signature") {
        clone[k] = v;
      }
    }
    const canonical = JSON.stringify(clone);
    if (!candidates.includes(canonical)) {
      candidates.push(canonical);
    }
  }

  const primaryComputed = candidates[0] ? computeMitoWebhookSignature(candidates[0], secret) : undefined;

  if (providedSecret && timingSafeEqualStr(providedSecret, secret)) {
    return {
      valid: true,
      hasSignature: true,
      reason: "Webhook secret header verified",
      computedSignature: primaryComputed,
    };
  }

  if (!providedSig) {
    return {
      valid: false,
      hasSignature: false,
      reason: "Missing signature",
      computedSignature: primaryComputed,
    };
  }

  for (const candidate of candidates) {
    const expectedB64 = computeMitoWebhookSignature(candidate, secret);
    if (timingSafeEqualStr(providedSig, expectedB64)) {
      return {
        valid: true,
        hasSignature: true,
        reason: "HMAC-SHA256 signature verified",
        computedSignature: expectedB64,
      };
    }
    const expectedHex = crypto.createHmac("sha256", secret).update(candidate, "utf8").digest("hex");
    if (timingSafeEqualStr(providedSig.toLowerCase(), expectedHex.toLowerCase())) {
      return {
        valid: true,
        hasSignature: true,
        reason: "HMAC-SHA256 hex signature verified",
        computedSignature: expectedB64,
      };
    }
  }

  return {
    valid: false,
    hasSignature: true,
    reason: "Signature mismatch",
    computedSignature: primaryComputed,
  };
}

export function signMitoWebhookPayload<T extends Record<string, unknown>>(
  payloadWithoutSig: T,
  secret?: string,
): T & { signature: string } {
  const clone: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payloadWithoutSig)) {
    if (k !== "signature") {
      clone[k] = v;
    }
  }
  const rawWithoutSig = JSON.stringify(clone);
  const signature = computeMitoWebhookSignature(rawWithoutSig, secret);
  return {
    ...(clone as T),
    signature,
  };
}

export interface MitoWebhookInspectorLogEntry {
  Id: string;
  ReceivedAtUtc: string;
  Environment: string;
  Method: string;
  Path: string;
  QueryString: string;
  Headers: Record<string, string>;
  ContentType: string;
  ContentLength: number;
  RemoteIp: string;
  SignatureHeader: string | null;
  SignatureResult: string;
  ReturnedStatusCode: number;
  Body: string;
  EventId?: string | null;
  EventType?: string | null;
  Data?: Record<string, unknown> | null;
  Outcome?: Record<string, unknown> | null;
}

const MITO_WEBHOOK_LOGS_FILE = path.resolve(
  process.cwd(),
  ".dev-state",
  "mito-webhook-events.json",
);

const mitoWebhookInspectorLogs: MitoWebhookInspectorLogEntry[] = [];
let loadedWebhookLogsFromDisk = false;

function ensureWebhookLogsLoaded(): void {
  if (loadedWebhookLogsFromDisk) return;
  loadedWebhookLogsFromDisk = true;
  try {
    if (!fs.existsSync(MITO_WEBHOOK_LOGS_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(MITO_WEBHOOK_LOGS_FILE, "utf8"));
    if (Array.isArray(parsed)) {
      for (const item of parsed.slice(0, 100)) {
        if (item && typeof item === "object" && item.Id) {
          mitoWebhookInspectorLogs.push(item as MitoWebhookInspectorLogEntry);
        }
      }
    }
  } catch {
    // ignore disk read errors
  }
}

export function recordMitoWebhookInspectorLog(entry: MitoWebhookInspectorLogEntry): void {
  ensureWebhookLogsLoaded();
  mitoWebhookInspectorLogs.unshift(entry);
  if (mitoWebhookInspectorLogs.length > 100) {
    mitoWebhookInspectorLogs.length = 100;
  }
  try {
    const dir = path.dirname(MITO_WEBHOOK_LOGS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(MITO_WEBHOOK_LOGS_FILE, JSON.stringify(mitoWebhookInspectorLogs, null, 2), "utf8");
  } catch {
    // ignore disk write errors
  }
}

export function getMitoWebhookInspectorLogs(limit = 50): MitoWebhookInspectorLogEntry[] {
  ensureWebhookLogsLoaded();
  return mitoWebhookInspectorLogs.slice(0, Math.max(1, Math.min(200, limit)));
}


