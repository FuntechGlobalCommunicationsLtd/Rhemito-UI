/**
 * Beneficiary requirement templates, field ordering and section classification shared by the server
 * (offline / empty-upstream fallback) and the client (Step 2 vs Step 3 split).
 *
 * DEC-2026-11-19-BENEFICIARY-JOURNEY-PARITY. Purely additive: nothing here changes an existing contract.
 */

export type BeneficiaryRequirementSection = "Personal" | "Identification" | "Banking";

/** Compatible with `MitoBeneficiaryRequirementField` (server + client), plus an optional `section`. */
export interface BeneficiaryRequirementField {
  label: string;
  name: string;
  order: number;
  type: string;
  format?: string | null;
  columnDataType: string;
  isRequired: boolean;
  isDisplayable: boolean;
  section?: BeneficiaryRequirementSection;
  fieldInformation?: string | null;
  dropdownOptions?: Array<{ name: string; id: string }>;
}

export const COUNTRY_ISO3_BY_NAME: Record<string, string> = {
  "united kingdom": "GBR",
  uk: "GBR",
  "great britain": "GBR",
  "united states": "USA",
  "united states of america": "USA",
  usa: "USA",
  nigeria: "NGA",
  canada: "CAN",
  ghana: "GHA",
  kenya: "KEN",
  "south africa": "ZAF",
  germany: "DEU",
  france: "FRA",
  india: "IND",
  china: "CHN",
  "united arab emirates": "ARE",
  uae: "ARE",
  australia: "AUS",
  japan: "JPN",
};

export const COUNTRY_ISO2_BY_ISO3: Record<string, string> = {
  GBR: "GB",
  USA: "US",
  NGA: "NG",
  CAN: "CA",
  GHA: "GH",
  KEN: "KE",
  ZAF: "ZA",
  DEU: "DE",
  FRA: "FR",
  IND: "IN",
  CHN: "CN",
  ARE: "AE",
  AUS: "AU",
  JPN: "JP",
};

export const DIAL_CODE_BY_ISO3: Record<string, string> = {
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
  AUS: "+61",
  JPN: "+81",
};

const COUNTRY_ISO3_BY_CURRENCY: Record<string, string> = {
  NGN: "NGA",
  GBP: "GBR",
  EUR: "DEU",
  USD: "USA",
  CAD: "CAN",
  GHS: "GHA",
  KES: "KEN",
  ZAR: "ZAF",
  INR: "IND",
  CNY: "CHN",
  AED: "ARE",
  AUD: "AUS",
  JPY: "JPN",
};

/** Countries whose bank accounts are identified by an IBAN. */
const IBAN_COUNTRIES = new Set(["GBR", "DEU", "FRA", "ARE"]);

/** Normalised (lower-case, alphanumerics only) names of banking-step fields. */
const BANKING_FIELD_KEYS = new Set([
  "acctnumber",
  "accountnumber",
  "sortcode",
  "iban",
  "bicswift",
  "swift",
  "bic",
  "aba",
  "ifsc",
  "bsbcode",
  "bsb",
  "branchcode",
  "bankcode",
  "clabe",
  "cnaps",
  "routingnumber",
  "bankname",
]);

const IDENTIFICATION_KEY_PATTERN = /dob|birth|nationality|gender|passport|identification|id_?number|id_?type|id_?document/i;

function normalizeKey(name: string): string {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Which journey step a requirement field belongs to: Step 2 (Personal / Identification) or Step 3 (Banking). */
export function classifyRequirementSection(fieldName: string): BeneficiaryRequirementSection {
  const key = normalizeKey(fieldName);
  const stripped = key.startsWith("beneficiary") ? key.slice("beneficiary".length) : key;
  if (BANKING_FIELD_KEYS.has(key) || BANKING_FIELD_KEYS.has(stripped)) return "Banking";
  if (IDENTIFICATION_KEY_PATTERN.test(String(fieldName || ""))) return "Identification";
  return "Personal";
}

function isAddressField(name: string): boolean {
  return /^(beneficiary_?)?address$/i.test(String(name || "").trim());
}

function isAddressLine2Field(name: string): boolean {
  return /^(beneficiary_?)?address_?line_?2$/i.test(String(name || "").trim());
}

/**
 * Mandatory fields first, optional fields after (CLAUDE.md: "mandatory fields on top above optional fields"),
 * preserving the relative `order` inside each group. `Address line 2` always stays directly under `Address line 1`.
 */
export function sortFieldsMandatoryFirst<T extends { name: string; isRequired: boolean; order?: number }>(fields: T[]): T[] {
  const indexed = fields.map((field, index) => ({ field, index }));
  const byOrder = (a: { field: T; index: number }, b: { field: T; index: number }) => {
    const ao = typeof a.field.order === "number" ? a.field.order : Number.MAX_SAFE_INTEGER;
    const bo = typeof b.field.order === "number" ? b.field.order : Number.MAX_SAFE_INTEGER;
    return ao - bo || a.index - b.index;
  };
  const required = indexed.filter((x) => x.field.isRequired === true).sort(byOrder).map((x) => x.field);
  const optional = indexed.filter((x) => x.field.isRequired !== true).sort(byOrder).map((x) => x.field);
  const result = [...required, ...optional];

  const addressIdx = result.findIndex((f) => isAddressField(f.name));
  const line2Idx = result.findIndex((f) => isAddressLine2Field(f.name));
  if (addressIdx >= 0 && line2Idx >= 0 && line2Idx !== addressIdx + 1) {
    const [line2] = result.splice(line2Idx, 1);
    const nextAddressIdx = result.findIndex((f) => isAddressField(f.name));
    result.splice(nextAddressIdx + 1, 0, line2);
  }
  return result;
}

const RELATION_OPTIONS: Array<{ name: string; id: string }> = [
  { name: "Family", id: "FAMILY" },
  { name: "Friend", id: "FRIEND" },
  { name: "Spouse / Partner", id: "SPOUSE" },
  { name: "Business partner", id: "BUSINESS" },
  { name: "Employee", id: "EMPLOYEE" },
  { name: "Self", id: "SELF" },
  { name: "Other", id: "OTHER" },
];

const REASON_OPTIONS: Array<{ name: string; id: string }> = [
  { name: "Family support", id: "FAMILYSUPPORT" },
  { name: "Personal expenditure", id: "FOROWNEXPENDITURES" },
  { name: "Education", id: "EDUCATION" },
  { name: "Medical expenses", id: "MEDICAL" },
  { name: "Gift", id: "GIFT" },
  { name: "Rent / Bills", id: "BILLS" },
  { name: "Savings / Investment", id: "SAVINGS" },
  { name: "Business payment", id: "BUSINESSPAYMENT" },
  { name: "Other", id: "OTHER" },
];

interface FieldSpec {
  name: string;
  label: string;
  isRequired: boolean;
  section: BeneficiaryRequirementSection;
  type?: string;
  format?: string | null;
  fieldInformation?: string | null;
  dropdownOptions?: Array<{ name: string; id: string }>;
}

function bankingSpecsFor(currency: string, iso3: string, isInternational: boolean): FieldSpec[] {
  const B = (name: string, label: string, isRequired: boolean, extra: Partial<FieldSpec> = {}): FieldSpec => ({
    name,
    label,
    isRequired,
    section: "Banking",
    ...extra,
  });

  if (isInternational) {
    const useIban = IBAN_COUNTRIES.has(iso3);
    return [
      B("iban", "IBAN", useIban, { fieldInformation: "International Bank Account Number (IBAN)" }),
      B("acct_number", "Account number", !useIban),
      B("bic_swift", "SWIFT / BIC code", true, { fieldInformation: "8 or 11-character SWIFT / BIC code of the recipient's bank" }),
      B("bank_name", "Bank name", false),
    ];
  }

  switch (currency) {
    case "NGN":
      return [
        B("acct_number", "Account number", true, {
          format: "^\\d{10}$",
          fieldInformation: "Enter 10-digit NUBAN account number",
        }),
      ];
    case "GBP":
      return [
        B("acct_number", "Account number", true, { format: "^\\d{8}$", fieldInformation: "8-digit UK account number" }),
        B("sort_code", "Sort code", true, { format: "^\\d{6}$", fieldInformation: "6-digit UK sort code" }),
      ];
    case "EUR":
      return [
        B("iban", "IBAN", true, { fieldInformation: "International Bank Account Number (IBAN)" }),
        B("bic_swift", "SWIFT / BIC code", false, { fieldInformation: "8 or 11-character SWIFT / BIC code" }),
      ];
    case "USD":
      return [
        B("acct_number", "Account number", true),
        B("aba", "ABA routing number", true, { format: "^\\d{9}$", fieldInformation: "9-digit ABA routing number" }),
      ];
    case "CAD":
      return [
        B("acct_number", "Account number", true),
        B("branch_code", "Branch / transit code", true, { fieldInformation: "Transit and institution number of the branch" }),
        B("bic_swift", "SWIFT / BIC code", false, { fieldInformation: "8 or 11-character SWIFT / BIC code" }),
      ];
    case "INR":
      return [
        B("acct_number", "Account number", true),
        B("ifsc", "IFSC code", true, { format: "^[A-Za-z]{4}0[A-Za-z0-9]{6}$", fieldInformation: "11-character IFSC code" }),
      ];
    case "AUD":
      return [
        B("acct_number", "Account number", true),
        B("bsb_code", "BSB code", true, { format: "^\\d{6}$", fieldInformation: "6-digit BSB code" }),
      ];
    case "ZAR":
    case "GHS":
    case "KES":
      return [B("acct_number", "Account number", true), B("branch_code", "Branch code", false)];
    case "CNY":
      return [
        B("acct_number", "Account number", true),
        B("cnaps", "CNAPS code", true, { fieldInformation: "12-digit China National Advanced Payment System code" }),
      ];
    case "AED":
      return [
        B("iban", "IBAN", true, { fieldInformation: "23-character UAE IBAN" }),
        B("bic_swift", "SWIFT / BIC code", false, { fieldInformation: "8 or 11-character SWIFT / BIC code" }),
      ];
    default:
      return [B("acct_number", "Account number", true)];
  }
}

/**
 * Realistic corridor requirement fields mirroring the shared web app, used when Mito is unconfigured / offline
 * or returns no (or incomplete) requirements. Always returned mandatory-first.
 */
export function getFallbackBeneficiaryRequirements(params: {
  currencyCode: string;
  countryIso3?: string;
  entityType: "I" | "B";
  service: "bank_deposit" | "mobile_money" | "cash_pickup";
  isInternational?: boolean;
}): BeneficiaryRequirementField[] {
  const currency = String(params.currencyCode || "").trim().toUpperCase();
  const iso3 =
    String(params.countryIso3 || "").trim().toUpperCase() || COUNTRY_ISO3_BY_CURRENCY[currency] || "";
  const isInternational = Boolean(params.isInternational);
  const isBusiness = params.entityType === "B";
  const isMobile = params.service === "mobile_money";

  const mobileMandatory = isMobile || ["NGN", "KES", "GHS", "INR"].includes(currency);
  const addressMandatory = isInternational || ["USD", "CAD", "EUR", "INR", "CNY"].includes(currency);
  const narrationMandatory = currency === "NGN" || iso3 === "NGA";

  const P = (
    name: string,
    label: string,
    isRequired: boolean,
    extra: Partial<FieldSpec> = {},
  ): FieldSpec => ({ name, label, isRequired, section: "Personal", ...extra });

  const specs: FieldSpec[] = [];
  if (isBusiness) {
    specs.push(P("beneficiary_company_name", "Company name", true));
  } else {
    specs.push(P("beneficiary_firstname", "First name", true));
    specs.push(P("beneficiary_lastname", "Last name", true));
  }
  specs.push(
    P("beneficiary_relation", "Relationship", true, { type: "dropdown", dropdownOptions: RELATION_OPTIONS }),
    P("beneficiary_reason", "Reason for transfer", true, { type: "dropdown", dropdownOptions: REASON_OPTIONS }),
    P("beneficiary_mobile", "Mobile number", mobileMandatory, {
      fieldInformation: `Include the country dial code${DIAL_CODE_BY_ISO3[iso3] ? ` (${DIAL_CODE_BY_ISO3[iso3]})` : ""}`,
    }),
    P("beneficiary_address", "Address line 1", addressMandatory),
    P("beneficiary_addressLine2", "Address line 2", false),
    P("beneficiary_city", "City", addressMandatory),
    P("beneficiary_state", "State / Province", addressMandatory),
    P("beneficiary_postcode", "Postcode / ZIP", addressMandatory),
    P("narration", "Narration / Remarks", narrationMandatory, {
      fieldInformation: narrationMandatory ? "Required for Nigerian beneficiaries" : null,
    }),
    P("beneficiary_nickname", "Nickname", false, {
      fieldInformation: "At least 5 letters or numbers. Helps you find this recipient later.",
    }),
  );

  if (params.service === "bank_deposit") {
    specs.push(...bankingSpecsFor(currency, iso3, isInternational));
  }

  const fields: BeneficiaryRequirementField[] = specs.map((spec, index) => ({
    label: spec.label,
    name: spec.name,
    order: index + 1,
    type: spec.type || "text",
    format: spec.format ?? null,
    columnDataType: "string",
    isRequired: spec.isRequired,
    isDisplayable: true,
    section: spec.section,
    fieldInformation: spec.fieldInformation ?? null,
    ...(spec.dropdownOptions ? { dropdownOptions: spec.dropdownOptions } : {}),
  }));

  return sortFieldsMandatoryFirst(fields);
}
