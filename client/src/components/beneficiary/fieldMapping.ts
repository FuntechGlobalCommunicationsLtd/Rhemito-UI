import type { MitoBeneficiaryRequirementField } from "@/lib/sendMoney";
import {
  classifyRequirementSection,
  getFallbackBeneficiaryRequirements,
  sortFieldsMandatoryFirst,
} from "@shared/beneficiaryRequirements";
import { bankFieldsFor } from "@/lib/recipients";

export type CanonicalPersonalFieldKey =
  | "firstName"
  | "lastName"
  | "companyName"
  | "relationship"
  | "reason"
  | "mobileNo"
  | "address"
  | "addressLine2"
  | "city"
  | "stateOrProvince"
  | "postcode"
  | "dob"
  | "gender"
  | "narration"
  | "nickName";

export type CanonicalBankingFieldKey =
  | "accountNumber"
  | "sortCode"
  | "iban"
  | "swift"
  | "aba"
  | "ifsc"
  | "bsbCode"
  | "branchCode"
  | "bankCode"
  | "clabe"
  | "cnaps"
  | "bankName";

export function normalizeReqKey(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function mapPersonalRequirementKey(rawName: string): CanonicalPersonalFieldKey | null {
  const k = normalizeReqKey(rawName);
  const stripped = k.startsWith("beneficiary") ? k.slice("beneficiary".length) : k;
  if (stripped === "firstname") return "firstName";
  if (stripped === "lastname") return "lastName";
  if (stripped === "companyname" || stripped === "businessname") return "companyName";
  if (stripped === "relation" || stripped === "relationid" || stripped === "relationship") return "relationship";
  if (stripped === "reason" || stripped === "reasonid") return "reason";
  if (stripped === "mobile" || stripped === "mobileno" || stripped === "mobilenumber" || stripped === "phone") return "mobileNo";
  if (stripped === "address" || stripped === "addressline1" || stripped === "street") return "address";
  if (stripped === "addressline2") return "addressLine2";
  if (stripped === "city" || stripped === "town") return "city";
  if (stripped === "state" || stripped === "stateorprovince" || stripped === "province") return "stateOrProvince";
  if (stripped === "postcode" || stripped === "postalcode" || stripped === "zip" || stripped === "zipcode") return "postcode";
  if (stripped === "dob" || stripped === "dateofbirth" || stripped === "birthdate") return "dob";
  if (stripped === "gender" || stripped === "sex") return "gender";
  if (stripped === "narration" || stripped === "remarks") return "narration";
  if (stripped === "nickname") return "nickName";
  return null;
}

export function mapBankingRequirementKey(rawName: string): CanonicalBankingFieldKey | null {
  const k = normalizeReqKey(rawName);
  const stripped = k.startsWith("beneficiary") ? k.slice("beneficiary".length) : k;
  if (stripped === "acctnumber" || stripped === "accountnumber") return "accountNumber";
  if (stripped === "sortcode") return "sortCode";
  if (stripped === "iban") return "iban";
  if (stripped === "bicswift" || stripped === "swift" || stripped === "bic") return "swift";
  if (stripped === "aba" || stripped === "routingnumber") return "aba";
  if (stripped === "ifsc") return "ifsc";
  if (stripped === "bsbcode" || stripped === "bsb") return "bsbCode";
  if (stripped === "branchcode") return "branchCode";
  if (stripped === "bankcode") return "bankCode";
  if (stripped === "clabe") return "clabe";
  if (stripped === "cnaps") return "cnaps";
  if (stripped === "bankname") return "bankName";
  return null;
}

/**
 * Resolves effective corridor requirement fields (Personal/Identification vs Banking),
 * falling back cleanly to `getFallbackBeneficiaryRequirements` and `bankFieldsFor` when
 * upstream requirements are empty or omit banking fields.
 */
export function resolveEffectiveCorridorRequirements(params: {
  upstream: MitoBeneficiaryRequirementField[];
  currencyCode: string;
  countryIso3: string;
  countryName?: string;
  entityType: "I" | "B";
  service: "bank_deposit" | "mobile_money" | "cash_pickup";
  isInternational?: boolean;
}): {
  personalFields: MitoBeneficiaryRequirementField[];
  bankingFields: MitoBeneficiaryRequirementField[];
} {
  const fallback = getFallbackBeneficiaryRequirements({
    currencyCode: params.currencyCode,
    countryIso3: params.countryIso3,
    entityType: params.entityType,
    service: params.service,
    isInternational: params.isInternational,
  });

  const base = params.upstream.length > 0 ? params.upstream : fallback;

  const personalRaw = base.filter(
    (f) => f.isDisplayable && (f.section || classifyRequirementSection(f.name)) !== "Banking",
  );
  const personalSource =
    personalRaw.length > 0
      ? personalRaw
      : fallback.filter((f) => (f.section || classifyRequirementSection(f.name)) !== "Banking");

  let bankingSource: MitoBeneficiaryRequirementField[] = [];
  if (params.service === "bank_deposit") {
    const upstreamBanking = base.filter(
      (f) => f.isDisplayable && (f.section || classifyRequirementSection(f.name)) === "Banking",
    );
    bankingSource =
      upstreamBanking.length > 0
        ? [...upstreamBanking]
        : fallback.filter((f) => (f.section || classifyRequirementSection(f.name)) === "Banking");

    // Ensure `bankFieldsFor` fallback coverage if countryName demands a routing field missing from upstream
    if (params.countryName && !params.isInternational) {
      const legacyCfg = bankFieldsFor(
        params.countryName === "UK" ? "United Kingdom" : params.countryName,
      );
      const hasKey = (target: CanonicalBankingFieldKey) =>
        bankingSource.some((b) => mapBankingRequirementKey(b.name) === target);
      if (legacyCfg.sortCode && !hasKey("sortCode")) {
        bankingSource.push({
          label: "Sort code",
          name: "sort_code",
          order: 50,
          type: "text",
          columnDataType: "string",
          isRequired: true,
          isDisplayable: true,
          section: "Banking",
          fieldInformation: "6-digit UK sort code",
        });
      }
      if (legacyCfg.iban && !hasKey("iban") && !hasKey("accountNumber")) {
        bankingSource.push({
          label: "IBAN",
          name: "iban",
          order: 51,
          type: "text",
          columnDataType: "string",
          isRequired: true,
          isDisplayable: true,
          section: "Banking",
          fieldInformation: "International Bank Account Number (IBAN)",
        });
      }
    }
  }

  return {
    personalFields: sortFieldsMandatoryFirst(personalSource),
    bankingFields: sortFieldsMandatoryFirst(bankingSource),
  };
}
