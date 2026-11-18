import { COUNTRY_ISO3_BY_NAME } from "@shared/beneficiaryRequirements";
import type { Contact } from "@/data/contacts";
import { countries } from "@/data/countries";
import { currencyForCountry } from "@/lib/recipients";
import { isMitoBeneficiaryDeleted, type MitoBeneficiaryItem } from "@/lib/sendMoney";

export const STATIC_GBP_FALLBACK_RATES: Record<string, number> = {
  GBP: 1.0,
  NGN: 2050.5,
  USD: 1.27,
  EUR: 1.18,
  CAD: 1.76,
  GHS: 19.4,
  KES: 164.5,
  ZAR: 23.1,
  INR: 106.8,
  CNY: 9.18,
  AED: 4.67,
};

const ISO3_TO_COUNTRY_NAME: Record<string, string> = {
  GBR: "United Kingdom",
  UK: "United Kingdom",
  USA: "United States",
  NGA: "Nigeria",
  CAN: "Canada",
  GHA: "Ghana",
  KEN: "Kenya",
  ZAF: "South Africa",
  DEU: "Germany",
  FRA: "France",
  IND: "India",
  CHN: "China",
  ARE: "United Arab Emirates",
};

export function isSyntheticBeneficiaryEmail(email?: string | null): boolean {
  if (!email) return false;
  return /@beneficiary\.rhemito\.local$/i.test(email.trim());
}

export function displayBeneficiaryEmail(email?: string | null): string {
  if (!email || !email.trim() || isSyntheticBeneficiaryEmail(email)) {
    return "—";
  }
  return email.trim();
}

export function editableBeneficiaryEmail(email?: string | null): string {
  if (!email || !email.trim() || isSyntheticBeneficiaryEmail(email)) {
    return "";
  }
  return email.trim();
}

export function countryToIso3(countryName: string): string {
  const clean = String(countryName || "").trim().toLowerCase();
  return COUNTRY_ISO3_BY_NAME[clean] || "NGA";
}

export function iso3ToCountryName(iso3?: string | null, fallbackCountry?: string | null): string {
  const upper = String(iso3 || "").trim().toUpperCase();
  if (upper && ISO3_TO_COUNTRY_NAME[upper]) {
    return ISO3_TO_COUNTRY_NAME[upper];
  }
  if (fallbackCountry && fallbackCountry.trim()) {
    const f = fallbackCountry.trim();
    if (f.toUpperCase() === "UK") return "United Kingdom";
    const matched = countries.find((c) => c.name.toLowerCase() === f.toLowerCase());
    if (matched) return matched.name;
    return f;
  }
  return "Nigeria";
}

export function countryFlagCode(countryName: string): string {
  const matched = countries.find((c) => c.name.toLowerCase() === String(countryName || "").trim().toLowerCase());
  return (matched?.code || "ng").toLowerCase();
}

export function countryDialCode(countryName: string): string {
  const matched = countries.find((c) => c.name.toLowerCase() === String(countryName || "").trim().toLowerCase());
  return matched?.dialCode || "+234";
}

export function makeCodeFromId(id: string): string {
  let hash = 0;
  const clean = String(id || "");
  for (let i = 0; i < clean.length; i++) {
    hash = (hash * 31 + clean.charCodeAt(i)) % 900000;
  }
  return String(100000 + Math.abs(hash));
}

export function computeBeneficiaryInitials(
  recipientType: "individual" | "business",
  firstName: string,
  lastName: string,
  businessName: string,
): string {
  if (recipientType === "business") {
    return String(businessName || "").trim().slice(0, 2).toUpperCase() || "BU";
  }
  const f = String(firstName || "").trim().charAt(0);
  const l = String(lastName || "").trim().charAt(0);
  return `${f}${l}`.toUpperCase() || "RE";
}

export interface ExtendedBeneficiaryMeta {
  nickName?: string;
  relationship?: string;
  relationId?: string;
  otherRelationship?: string;
  reason?: string;
  reasonId?: string;
  otherReason?: string;
  narration?: string;
  mobileNo?: string;
  address?: string;
  addressLine2?: string;
  city?: string;
  stateOrProvince?: string;
  postcode?: string;
  dob?: string;
  gender?: string;
  providerId?: string;
  providerCode?: string;
  isInternational?: boolean;
  accountHolderName?: string;
  aba?: string;
  ifsc?: string;
  bsbCode?: string;
  branchCode?: string;
  bankCode?: string;
  clabe?: string;
  cnaps?: string;
}

const EXTENDED_META_STORAGE_KEY = "rhemito_beneficiary_extended_meta_v1";

export function saveExtendedBeneficiaryMeta(
  keys: Array<string | null | undefined>,
  meta: ExtendedBeneficiaryMeta,
): void {
  if (typeof window === "undefined") return;
  const validKeys = keys
    .map((k) => String(k || "").trim().toUpperCase())
    .filter(Boolean);
  if (validKeys.length === 0) return;
  try {
    const raw = window.localStorage.getItem(EXTENDED_META_STORAGE_KEY);
    const store: Record<string, ExtendedBeneficiaryMeta> = raw ? JSON.parse(raw) || {} : {};
    for (const k of validKeys) {
      store[k] = {
        ...(store[k] || {}),
        ...meta,
      };
    }
    window.localStorage.setItem(EXTENDED_META_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore storage quota errors
  }
}

export function loadExtendedBeneficiaryMeta(
  keys: Array<string | null | undefined>,
): ExtendedBeneficiaryMeta {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(EXTENDED_META_STORAGE_KEY);
    if (!raw) return {};
    const store = JSON.parse(raw) as Record<string, ExtendedBeneficiaryMeta>;
    if (!store || typeof store !== "object") return {};
    for (const k of keys) {
      const clean = String(k || "").trim().toUpperCase();
      if (clean && store[clean]) {
        return store[clean];
      }
    }
    return {};
  } catch {
    return {};
  }
}

export interface BeneficiaryDraftValues {
  recipientType: "individual" | "business";
  firstName: string;
  lastName: string;
  businessName: string;
  relationship: string;
  relationId: string;
  otherRelationship: string;
  reason: string;
  reasonId: string;
  otherReason: string;
  mobileNo: string;
  address: string;
  addressLine2: string;
  city: string;
  stateOrProvince: string;
  postcode: string;
  dob: string;
  gender: string;
  narration: string;
  email: string;
  nickName: string;
  providerId: string;
  providerCode: string;
  bankName: string;
  isInternational: boolean;
  accountHolderName: string;
  accountNumber: string;
  sortCode: string;
  iban: string;
  swift: string;
  aba: string;
  ifsc: string;
  bsbCode: string;
  branchCode: string;
  bankCode: string;
  clabe: string;
  cnaps: string;
}

export function createEmptyBeneficiaryDraft(
  recipientType: "individual" | "business" = "individual",
): BeneficiaryDraftValues {
  return {
    recipientType,
    firstName: "",
    lastName: "",
    businessName: "",
    relationship: "",
    relationId: "",
    otherRelationship: "",
    reason: "",
    reasonId: "",
    otherReason: "",
    mobileNo: "",
    address: "",
    addressLine2: "",
    city: "",
    stateOrProvince: "",
    postcode: "",
    dob: "",
    gender: "",
    narration: "",
    email: "",
    nickName: "",
    providerId: "",
    providerCode: "",
    bankName: "",
    isInternational: false,
    accountHolderName: "",
    accountNumber: "",
    sortCode: "",
    iban: "",
    swift: "",
    aba: "",
    ifsc: "",
    bsbCode: "",
    branchCode: "",
    bankCode: "",
    clabe: "",
    cnaps: "",
  };
}

export interface ResolvedBeneficiaryRecord {
  id: string;
  mitoId: string | null;
  contactId: string | null;
  uniqueCode: string;
  isSender: boolean;
  isRecipient: boolean;
  recipientType: "individual" | "business";
  firstName: string;
  lastName: string;
  businessName: string;
  fullName: string;
  rawEmail: string;
  displayEmail: string;
  editableEmail: string;
  country: string;
  countryIso3: string;
  currency: string;
  collectionMethod: "bank_deposit" | "mobile_money";
  serviceType: string;
  isInternational: boolean;
  providerId: string;
  providerCode: string;
  bankName: string;
  accountHolderName: string;
  accountNumber: string;
  sortCode: string;
  iban: string;
  swift: string;
  aba: string;
  ifsc: string;
  bsbCode: string;
  branchCode: string;
  bankCode: string;
  clabe: string;
  cnaps: string;
  mobileNo: string;
  relationship: string;
  relationId: string;
  otherRelationship: string;
  reason: string;
  reasonId: string;
  otherReason: string;
  narration: string;
  nickName: string;
  address: string;
  addressLine2: string;
  city: string;
  stateOrProvince: string;
  postcode: string;
  dob: string;
  gender: string;
  createdAt: string;
}

export function resolveMergedBeneficiary(
  rawId: string,
  contacts: Contact[],
  mitoBeneficiaries: MitoBeneficiaryItem[],
): ResolvedBeneficiaryRecord | null {
  const cleanId = String(rawId || "").trim();
  if (!cleanId) return null;
  const lowerId = cleanId.toLowerCase();

  const recipientContacts = contacts.filter((c) => c.isRecipient);
  let matchedContact =
    recipientContacts.find(
      (c) =>
        c.id.toLowerCase() === lowerId ||
        (c.uniqueCode && c.uniqueCode.toLowerCase() === lowerId),
    ) || null;

  let matchedMito =
    mitoBeneficiaries.find(
      (b) =>
        b.beneficiaryId.toLowerCase() === lowerId ||
        makeCodeFromId(b.beneficiaryId).toLowerCase() === lowerId,
    ) || null;

  if (matchedContact && !matchedMito) {
    const currentContact = matchedContact;
    const cName = (
      currentContact.contactType === "business"
        ? currentContact.businessName || ""
        : `${currentContact.firstName || ""} ${currentContact.lastName || ""}`
    )
      .trim()
      .toLowerCase();
    const cAcct = (currentContact.accountNumber || currentContact.iban || "").replace(/\s+/g, "").toLowerCase();
    matchedMito =
      mitoBeneficiaries.find((b) => {
        if (b.beneficiaryId.toLowerCase() === currentContact.id.toLowerCase()) return true;
        const bName = (b.companyName || b.name || `${b.firstName} ${b.lastName}`).trim().toLowerCase();
        const bAcct = (b.acctNumber || b.iban || b.mobileNo || "").replace(/\s+/g, "").toLowerCase();
        return Boolean(cAcct && cAcct !== "—" && bAcct === cAcct && bName === cName);
      }) || null;
  } else if (matchedMito && !matchedContact) {
    const currentMito = matchedMito;
    const mName = (currentMito.companyName || currentMito.name || `${currentMito.firstName} ${currentMito.lastName}`)
      .trim()
      .toLowerCase();
    const mAcct = (currentMito.acctNumber || currentMito.iban || currentMito.mobileNo || "")
      .replace(/\s+/g, "")
      .toLowerCase();
    matchedContact =
      recipientContacts.find((c) => {
        if (c.id.toLowerCase() === currentMito.beneficiaryId.toLowerCase()) return true;
        const cName = (
          c.contactType === "business"
            ? c.businessName || ""
            : `${c.firstName || ""} ${c.lastName || ""}`
        )
          .trim()
          .toLowerCase();
        const cAcct = (c.accountNumber || c.iban || "").replace(/\s+/g, "").toLowerCase();
        return Boolean(mAcct && cAcct === mAcct && cName === mName);
      }) || null;
  }

  if (!matchedContact && !matchedMito) {
    return null;
  }

  const candidateId = matchedMito?.beneficiaryId || matchedContact?.id || cleanId;
  const candidateName =
    matchedMito?.companyName ||
    matchedMito?.name ||
    (matchedContact?.contactType === "business"
      ? matchedContact.businessName
      : `${matchedContact?.firstName || ""} ${matchedContact?.lastName || ""}`.trim());
  const candidateAcct =
    matchedMito?.acctNumber ||
    matchedMito?.iban ||
    matchedMito?.mobileNo ||
    matchedContact?.accountNumber ||
    "";

  if (
    isMitoBeneficiaryDeleted({
      beneficiaryId: candidateId,
      name: candidateName,
      accountNumber: candidateAcct,
    })
  ) {
    return null;
  }

  const uniqueCode =
    matchedContact?.uniqueCode ||
    makeCodeFromId(matchedMito?.beneficiaryId || matchedContact?.id || cleanId);

  const ext = loadExtendedBeneficiaryMeta([
    matchedMito?.beneficiaryId,
    matchedContact?.id,
    uniqueCode,
    cleanId,
  ]);

  const recipientType: "individual" | "business" =
    matchedMito?.legalEntityType || matchedContact?.contactType || "individual";

  const firstName =
    matchedMito?.firstName ||
    matchedContact?.firstName ||
    (recipientType === "individual" && matchedMito?.name ? matchedMito.name.split(" ")[0] || "" : "");
  const lastName =
    matchedMito?.lastName ||
    matchedContact?.lastName ||
    (recipientType === "individual" && matchedMito?.name
      ? matchedMito.name.split(" ").slice(1).join(" ") || ""
      : "");
  const businessName =
    matchedMito?.companyName ||
    matchedContact?.businessName ||
    (recipientType === "business" ? matchedMito?.name || "" : "");

  const fullName =
    recipientType === "business"
      ? businessName || `${firstName} ${lastName}`.trim() || "Business recipient"
      : `${firstName} ${lastName}`.trim() || matchedMito?.name || "Recipient";

  const country = iso3ToCountryName(
    matchedMito?.countryIso3,
    matchedContact?.country || matchedMito?.country || "Nigeria",
  );
  const countryIso3 = matchedMito?.countryIso3 || countryToIso3(country);
  const currency = (matchedMito?.currency || matchedContact?.currency || currencyForCountry(country)).toUpperCase();

  const isMobileMoney =
    (matchedMito?.collectionMode || "").toUpperCase() === "MOBILEMONEY" ||
    matchedContact?.serviceType === "Mobile Money";

  const isInternational = Boolean(
    matchedMito?.isInternational ??
      ext.isInternational ??
      (matchedContact?.serviceType === "SWIFT" ||
        (Boolean(matchedMito?.bicSwift || matchedContact?.swift) &&
          !matchedMito?.sortCode &&
          !matchedContact?.sortCode &&
          country !== "Nigeria" &&
          country !== "United Kingdom")),
  );

  const collectionMethod: "bank_deposit" | "mobile_money" = isMobileMoney ? "mobile_money" : "bank_deposit";
  const serviceType = isMobileMoney ? "Mobile Money" : isInternational ? "SWIFT" : "Bank Deposit";

  const rawEmail = matchedContact?.email || "";
  const rawAcct =
    matchedMito?.acctNumber ||
    (matchedContact?.accountNumber && matchedContact.accountNumber !== "—" ? matchedContact.accountNumber : "") ||
    "";
  const iban = matchedMito?.iban || matchedContact?.iban || "";
  const mobileNo =
    matchedMito?.mobileNo ||
    ext.mobileNo ||
    (matchedContact?.phone
      ? `${matchedContact.countryCode || ""} ${matchedContact.phone}`.trim()
      : isMobileMoney
        ? rawAcct
        : "");

  return {
    id: matchedMito?.beneficiaryId || matchedContact?.id || cleanId,
    mitoId: matchedMito?.beneficiaryId || null,
    contactId: matchedContact?.id || null,
    uniqueCode,
    isSender: Boolean(matchedContact?.isSender),
    isRecipient: true,
    recipientType,
    firstName,
    lastName,
    businessName,
    fullName,
    rawEmail,
    displayEmail: displayBeneficiaryEmail(rawEmail),
    editableEmail: editableBeneficiaryEmail(rawEmail),
    country,
    countryIso3,
    currency,
    collectionMethod,
    serviceType,
    isInternational,
    providerId: matchedMito?.providerId || ext.providerId || "",
    providerCode: ext.providerCode || "",
    bankName:
      matchedMito?.bankName && matchedMito.bankName !== "Bank"
        ? matchedMito.bankName
        : matchedContact?.bankName || (isMobileMoney ? "Mobile money" : "Bank transfer"),
    accountHolderName: matchedMito?.accountHolderName || ext.accountHolderName || "",
    accountNumber: rawAcct,
    sortCode: matchedMito?.sortCode || matchedContact?.sortCode || "",
    iban,
    swift: matchedMito?.bicSwift || matchedContact?.swift || "",
    aba: matchedMito?.aba || ext.aba || "",
    ifsc: matchedMito?.ifsc || ext.ifsc || "",
    bsbCode: matchedMito?.bsbCode || ext.bsbCode || "",
    branchCode: matchedMito?.branchCode || ext.branchCode || "",
    bankCode: matchedMito?.bankCode || ext.bankCode || "",
    clabe: matchedMito?.clabe || ext.clabe || "",
    cnaps: matchedMito?.cnaps || ext.cnaps || "",
    mobileNo,
    relationship:
      matchedMito?.relationship ||
      matchedMito?.relationDescription ||
      ext.relationship ||
      matchedContact?.relationship ||
      "",
    relationId: matchedMito?.relationId || ext.relationId || "",
    otherRelationship: matchedMito?.otherRelation || ext.otherRelationship || "",
    reason:
      matchedMito?.reason ||
      matchedMito?.reasonDescription ||
      ext.reason ||
      "",
    reasonId: matchedMito?.reasonId || ext.reasonId || "",
    otherReason: matchedMito?.otherReason || ext.otherReason || "",
    narration: matchedMito?.narration || ext.narration || matchedContact?.narration || "",
    nickName: matchedMito?.beneficiaryNickname || ext.nickName || "",
    address: matchedMito?.address || ext.address || "",
    addressLine2: matchedMito?.addressLine2 || ext.addressLine2 || "",
    city: matchedMito?.city || ext.city || "",
    stateOrProvince: matchedMito?.stateOrProvince || ext.stateOrProvince || "",
    postcode: matchedMito?.postcode || ext.postcode || "",
    dob: matchedMito?.dob || ext.dob || matchedContact?.dob || "",
    gender: matchedMito?.gender || ext.gender || "",
    createdAt:
      matchedMito?.createdAt ||
      matchedContact?.createdAt ||
      new Date().toISOString().slice(0, 10),
  };
}
