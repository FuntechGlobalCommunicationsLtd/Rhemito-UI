/**
 * Compliance routes — Rhemito (DEC-2026-11-18-COMPLIANCE-REFERENCE-LAYOUT, Direction A)
 *
 *   GET /api/compliance/overview            -> ComplianceOverviewResponse (BFF used by /compliance)
 *   GET /api/v1/Account/profile             -> wire-compatible read proxy (live customer) / synthesized (local)
 *   GET /api/v1/KYC/Status                  -> wire-compatible read proxy (live customer) / synthesized (local)
 *
 * Branch 1 (live FURP customer session): the signed-in customer's own FURP profile + KYC status.
 * Branch 2 (local session / demo preview): derived dynamically from the local auth user (REF-18: no
 * hard-coded names). Read-only; no existing route, contract or journey flow is changed.
 */

import type { Express, Request, Response } from "express";
import type {
  ComplianceCompanyDetails,
  ComplianceKycSummary,
  ComplianceOverviewResponse,
  ComplianceProfileData,
} from "@shared/compliance";
import type { AuthUser } from "@shared/schema";
import { demoModeEnabled, serverConfig } from "./config";
import { storage } from "./storage";
import {
  clearCustomerFurpToken,
  furpFetchJson,
  getCustomerFurpToken,
  isRealFurpLiveEnabled,
  isRealFurpSubmitEnabled,
  type FurpJsonResult,
} from "./furpClient";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

/** Title-case words (`london` → `London`), keeping short upper-case tokens such as `UK` / `1,E`. */
export function toTitleCase(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  return s
    .split(/\s+/)
    .map((word) => {
      if (word.length <= 4 && /[A-Z]/.test(word) && /^[A-Z0-9,.\-/]+$/.test(word)) return word;
      return word
        .toLowerCase()
        .replace(/(^|[,.\-/'])([a-z])/g, (_m, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`);
    })
    .join(" ");
}

const mapGender = (raw: unknown): string | null => {
  const g = String(raw ?? "").trim().toUpperCase();
  if (g === "M" || g === "MALE") return "Male";
  if (g === "F" || g === "FEMALE") return "Female";
  return null;
};

const upperOrNull = (raw: unknown): string | null => {
  const s = String(raw ?? "").trim().toUpperCase();
  return s || null;
};

const COUNTRY_NAMES: Record<string, string> = {
  GB: "UK",
  US: "USA",
  NG: "Nigeria",
  CA: "Canada",
  GH: "Ghana",
  KE: "Kenya",
  ZA: "South Africa",
  DE: "Germany",
  FR: "France",
  IN: "India",
  AE: "UAE",
};

const mapCountry = (code: unknown): string | null => {
  const raw = str(code);
  if (!raw) return null;
  return COUNTRY_NAMES[raw.toUpperCase()] ?? raw;
};

function sessionUserId(req: Request): string | undefined {
  return req.session?.userId ?? (demoModeEnabled ? "user_123" : undefined);
}

const SUCCESS_STATUSES = ["SUCCESSFUL", "IDPASSED", "COMPLETED", "APPROVED", "PASSED", "UNDERREVIEW"];

function isJourneyRecommended(status: unknown): boolean {
  return !SUCCESS_STATUSES.includes(String(status ?? "").trim().toUpperCase());
}

/** Only trusted Rhemito/local http(s) URLs are forwarded upstream as a journey return URL. */
function safeReturnUrl(raw: unknown): string | null {
  const s = str(raw);
  if (!s || s.length > 2048) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.toLowerCase();
    let configuredHost = "";
    try {
      configuredHost = new URL(serverConfig.publicBaseUrl).hostname.toLowerCase();
    } catch {
      configuredHost = "";
    }
    const isTrusted =
      host === "localhost" ||
      host === "127.0.0.1" ||
      (configuredHost && host === configuredHost) ||
      host === "rhemito-ui.onrender.com" ||
      host === "rhemito.com" ||
      host.endsWith(".rhemito.com");
    return isTrusted ? u.toString() : null;
  } catch {
    return null;
  }
}

// ─── Branch 1: live FURP customer ────────────────────────────────────────────

function normaliseFurpProfile(data: Record<string, any>): ComplianceProfileData {
  const companyRaw = data.company && typeof data.company === "object" ? data.company : null;
  const company: ComplianceCompanyDetails | null = companyRaw
    ? {
        businessName: str(companyRaw.businessName),
        registrationNumber: str(companyRaw.companyRegNo),
        businessType: str(companyRaw.companyType),
        address: str(companyRaw.companyAddress),
        country: str(companyRaw.companyCountry),
        city: str(companyRaw.companyCity),
        postCode: upperOrNull(companyRaw.companyPostCode),
        directorName: str(companyRaw.directorName),
        directorGender: mapGender(companyRaw.directorGender),
      }
    : null;

  const documentCode = String(data.documentCode ?? "").trim().toUpperCase();
  return {
    uid: str(data.uid),
    isBusinessProfile: Boolean(data.isBusinessProfie || data.isBusinessProfile),
    fullName: [data.firstName, data.lastName].filter(Boolean).join(" ").trim(),
    occupation: str(data.occupation?.name),
    dateOfBirth: str(data.dob),
    gender: mapGender(data.gender),
    birthCountry: str(data.birthCountryDescription),
    address: toTitleCase(data.address),
    city: toTitleCase(data.city),
    postCode: upperOrNull(data.postCode),
    residentCountry: str(data.countryDescription) ?? str(data.country),
    nationality: str(data.nationalityDescription),
    identificationType: documentCode === "DRIVINGLICENSE" ? "Driving license" : documentCode ? "Passport" : null,
    documentNo: str(data.documentNo),
    issuingCountry: str(data.issueCountryDescription),
    issueDate: str(data.issueDate),
    expiryDate: str(data.expiryDate),
    imageUrl: str(data.imageUrl),
    company,
  };
}

function normaliseFurpKyc(data: Record<string, any> | null | undefined): ComplianceKycSummary | null {
  if (!data || typeof data !== "object") return null;
  return {
    status: str(data.kycStatus),
    type: str(data.kycType),
    isTransactionAllowed: Boolean(data.isTransactionAllowed),
    attempt: Number.isFinite(Number(data.attempt)) ? Number(data.attempt) : null,
  };
}

/** Returns null when the live branch does not apply (no token / expired / upstream failure). */
async function liveOverview(
  req: Request,
  userId: string,
  returnUrl: string | null,
): Promise<ComplianceOverviewResponse | null> {
  if (!isRealFurpLiveEnabled()) return null;
  const customerToken = getCustomerFurpToken(req, userId);
  if (!customerToken) return null;

  let profileRes: FurpJsonResult;
  let kycRes: FurpJsonResult;
  try {
    [profileRes, kycRes] = await Promise.all([
      furpFetchJson("/api/v1/Account/profile", { auth: "customer", customerToken }),
      furpFetchJson("/api/v1/KYC/Status?api-version=2", { auth: "customer", customerToken }),
    ]);
  } catch (err) {
    console.error("[complianceRoutes] live FURP overview failed:", err instanceof Error ? err.message : err);
    return null;
  }

  if (profileRes.status === 401 || kycRes.status === 401) {
    clearCustomerFurpToken(req, userId);
    return null;
  }
  if (!profileRes.ok || !profileRes.body?.data) return null;

  const profileData = profileRes.body.data as Record<string, any>;
  const profile = normaliseFurpProfile(profileData);
  const kyc = kycRes.ok ? normaliseFurpKyc(kycRes.body?.data) : null;
  const journeyRecommended = isJourneyRecommended(kyc?.status);

  const out: ComplianceOverviewResponse = { source: "furp", profile, kyc, journeyRecommended };

  if (journeyRecommended && profile.uid && returnUrl && isRealFurpSubmitEnabled()) {
    // Best-effort: launch the journey for the customer's OWN FURP identity (never the partner sub-user).
    try {
      const j = await furpFetchJson("/api/v1/Journey", {
        method: "POST",
        auth: "customer",
        customerToken,
        body: { customerId: profile.uid, returnUrl, journeyType: 1 },
      });
      const d = j.ok ? (j.body?.data as Record<string, any> | undefined) : undefined;
      if (d) {
        out.hostedUrl = str(d.hostedUrl);
        out.journeyCode = str(d.journeyCode);
        out.kycFlow = str(d.kycFlow);
      }
    } catch (err) {
      console.warn("[complianceRoutes] customer journey launch failed:", err instanceof Error ? err.message : err);
    }
  }
  return out;
}

// ─── Branch 2: local session / demo preview ──────────────────────────────────

function localProfile(user: AuthUser): ComplianceProfileData {
  const address = [user.buildingNumber, user.buildingName, user.subStreet, user.street]
    .filter(Boolean)
    .join(", ");
  const isBusiness = user.accountType === "business";
  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.directorName ||
    user.businessName ||
    "";
  const resident = mapCountry(user.country);
  const company: ComplianceCompanyDetails | null = isBusiness
    ? {
        businessName: str(user.businessName),
        registrationNumber: str(user.businessRegNo),
        businessType: null,
        address: str(address),
        country: resident,
        city: str(user.addressCity),
        postCode: upperOrNull(user.addressPostcode),
        directorName: str(user.directorName),
        directorGender: null,
      }
    : null;

  return {
    uid: null,
    isBusinessProfile: isBusiness,
    fullName,
    occupation: null,
    dateOfBirth: str(user.dateOfBirth),
    gender: mapGender(user.gender),
    birthCountry: str(user.birthCountry),
    address: str(address),
    city: str(user.addressCity),
    postCode: upperOrNull(user.addressPostcode),
    residentCountry: resident,
    nationality: null,
    identificationType: null,
    documentNo: null,
    issuingCountry: null,
    issueDate: null,
    expiryDate: null,
    imageUrl: null,
    company,
  };
}

function localKyc(user: AuthUser): { kyc: ComplianceKycSummary; journeyRecommended: boolean; kycFlow?: string } {
  const status = String(user.kycStatus ?? "").toLowerCase();
  if (status === "passed") {
    return {
      kyc: { status: "SUCCESSFUL", type: "AMLADDR", isTransactionAllowed: true, attempt: 1 },
      journeyRecommended: false,
      kycFlow: "Flow_No_Action_Required",
    };
  }
  return {
    kyc: {
      status: status === "failed" ? "FAILED" : "Pending",
      type: "AMLADDR",
      isTransactionAllowed: false,
      attempt: 0,
    },
    journeyRecommended: true,
  };
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerComplianceRoutes(app: Express): void {
  app.get("/api/compliance/overview", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const userId = sessionUserId(req);
    if (!userId) {
      res.status(401).json({ message: "Please sign in to continue." });
      return;
    }
    try {
      const returnUrl = safeReturnUrl(req.query.returnUrl);

      const live = await liveOverview(req, userId, returnUrl);
      if (live) {
        res.status(200).json(live);
        return;
      }

      const authUser = await storage.getAuthUserById(userId);
      if (!authUser) {
        res.status(401).json({ message: "Please sign in to continue." });
        return;
      }
      const { kyc, journeyRecommended, kycFlow } = localKyc(authUser);
      const body: ComplianceOverviewResponse = {
        source: "local",
        profile: localProfile(authUser),
        kyc,
        journeyRecommended,
        ...(kycFlow ? { kycFlow } : {}),
      };
      res.status(200).json(body);
    } catch (err) {
      console.error("[complianceRoutes] overview failed:", err);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  // Wire-compatible read proxies (live customer) with local synthesis for non-FURP sessions.
  app.get("/api/v1/Account/profile", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const userId = sessionUserId(req);
    if (!userId) {
      res.status(401).json({ code: 401, responseType: "Error", message: "Please sign in to continue.", data: null });
      return;
    }
    try {
      const customerToken = isRealFurpLiveEnabled() ? getCustomerFurpToken(req, userId) : null;
      if (customerToken) {
        const r = await furpFetchJson("/api/v1/Account/profile", { auth: "customer", customerToken });
        if (r.status === 401) {
          clearCustomerFurpToken(req, userId);
        } else if (r.body && typeof r.body === "object") {
          res.status(r.status).json(r.body);
          return;
        }
      }
      const authUser = await storage.getAuthUserById(userId);
      if (!authUser) {
        res.status(401).json({ code: 401, responseType: "Error", message: "Please sign in to continue.", data: null });
        return;
      }
      const p = localProfile(authUser);
      res.status(200).json({
        data: {
          uid: null,
          firstName: authUser.firstName,
          middleName: authUser.middleName,
          lastName: authUser.lastName,
          gender: authUser.gender,
          dob: authUser.dateOfBirth,
          country: authUser.country,
          countryDescription: p.residentCountry,
          address: p.address,
          city: p.city,
          postCode: p.postCode,
          birthCountryDescription: p.birthCountry,
          isBusinessProfie: p.isBusinessProfile,
          emailAddress: authUser.email,
        },
        message: null,
        code: 200,
        responseType: "Success",
      });
    } catch (err) {
      console.error("[complianceRoutes] profile failed:", err instanceof Error ? err.message : err);
      res.status(502).json({ code: 502, responseType: "Error", message: "Profile is temporarily unavailable.", data: null });
    }
  });

  app.get("/api/v1/KYC/Status", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const userId = sessionUserId(req);
    if (!userId) {
      res.status(401).json({ code: 401, responseType: "Error", message: "Please sign in to continue.", data: null });
      return;
    }
    try {
      const customerToken = isRealFurpLiveEnabled() ? getCustomerFurpToken(req, userId) : null;
      if (customerToken) {
        const r = await furpFetchJson("/api/v1/KYC/Status?api-version=2", { auth: "customer", customerToken });
        if (r.status === 401) {
          clearCustomerFurpToken(req, userId);
        } else if (r.body && typeof r.body === "object") {
          res.status(r.status).json(r.body);
          return;
        }
      }
      const authUser = await storage.getAuthUserById(userId);
      if (!authUser) {
        res.status(401).json({ code: 401, responseType: "Error", message: "Please sign in to continue.", data: null });
        return;
      }
      const { kyc } = localKyc(authUser);
      res.status(200).json({
        data: {
          userId: authUser.id,
          kycStatus: kyc.status,
          kycType: kyc.type,
          isTransactionAllowed: kyc.isTransactionAllowed,
          attempt: kyc.attempt,
        },
        message: null,
        code: 200,
        responseType: "Success",
      });
    } catch (err) {
      console.error("[complianceRoutes] kyc status failed:", err instanceof Error ? err.message : err);
      res.status(502).json({ code: 502, responseType: "Error", message: "KYC status is temporarily unavailable.", data: null });
    }
  });
}
