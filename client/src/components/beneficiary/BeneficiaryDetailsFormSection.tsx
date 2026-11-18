import { Building2, Globe, Info, Landmark, Smartphone, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { genderOptions } from "@/data/countries";
import { requiresNarration } from "@/lib/recipients";
import type {
  MitoBankVerificationClientResult,
  MitoBeneficiaryRequirementField,
  MitoLookupTypeOption,
  MitoProvinceOption,
} from "@/lib/sendMoney";
import { cn } from "@/lib/utils";
import { BankVerificationCard } from "./BankVerificationCard";
import {
  countryDialCode,
  countryFlagCode,
  type BeneficiaryDraftValues,
} from "./beneficiaryHelpers";
import {
  mapBankingRequirementKey,
  mapPersonalRequirementKey,
  type CanonicalBankingFieldKey,
  type CanonicalPersonalFieldKey,
} from "./fieldMapping";
import { NicknameFieldWithCheck } from "./NicknameFieldWithCheck";
import type { BankVerificationStatus } from "./useBankVerification";
import type { NicknameValidationState } from "./useNicknameValidation";

const DEFAULT_RELATIONSHIP_OPTIONS = [
  { code: "family", name: "Family", id: "family" },
  { code: "friend", name: "Friend", id: "friend" },
  { code: "business", name: "Business", id: "business" },
  { code: "self", name: "Self", id: "self" },
  { code: "other", name: "Other", id: "other" },
];

const DEFAULT_REASON_OPTIONS = [
  { code: "family_support", name: "Family support", id: "family_support" },
  { code: "education", name: "Education / tuition", id: "education" },
  { code: "property", name: "Property / rent", id: "property" },
  { code: "savings", name: "Personal savings", id: "savings" },
  { code: "business_payment", name: "Business / invoice", id: "business_payment" },
  { code: "medical", name: "Medical expenses", id: "medical" },
  { code: "other", name: "Other", id: "other" },
];

const BANKING_FIELD_META: Record<
  Exclude<CanonicalBankingFieldKey, "bankName">,
  { label: string; placeholder: string; testId: string }
> = {
  accountNumber: {
    label: "Account number",
    placeholder: "Enter account number",
    testId: "input-beneficiary-account-number",
  },
  sortCode: {
    label: "Sort code",
    placeholder: "e.g. 204567",
    testId: "input-beneficiary-sort-code",
  },
  iban: {
    label: "IBAN",
    placeholder: "e.g. DE89370400440532013000",
    testId: "input-beneficiary-iban",
  },
  swift: {
    label: "SWIFT / BIC",
    placeholder: "e.g. BARCGB22",
    testId: "input-beneficiary-swift",
  },
  aba: {
    label: "ABA routing number",
    placeholder: "9-digit routing number",
    testId: "input-beneficiary-aba",
  },
  ifsc: {
    label: "IFSC code",
    placeholder: "11-character IFSC code",
    testId: "input-beneficiary-ifsc",
  },
  bsbCode: {
    label: "BSB code",
    placeholder: "6-digit BSB code",
    testId: "input-beneficiary-bsb",
  },
  branchCode: {
    label: "Branch code",
    placeholder: "Enter branch code",
    testId: "input-beneficiary-branch-code",
  },
  bankCode: {
    label: "Bank code",
    placeholder: "Enter bank code",
    testId: "input-beneficiary-bank-code",
  },
  clabe: {
    label: "CLABE",
    placeholder: "18-digit CLABE",
    testId: "input-beneficiary-clabe",
  },
  cnaps: {
    label: "CNAPS code",
    placeholder: "12-digit CNAPS code",
    testId: "input-beneficiary-cnaps",
  },
};

export function getEffectiveBankingFieldList(
  bankingFields: MitoBeneficiaryRequirementField[],
): Array<{
  key: Exclude<CanonicalBankingFieldKey, "bankName">;
  isRequired: boolean;
  label: string;
  placeholder: string;
  testId: string;
  info?: string | null;
}> {
  const seen = new Set<string>();
  const items: Array<{
    key: Exclude<CanonicalBankingFieldKey, "bankName">;
    isRequired: boolean;
    label: string;
    placeholder: string;
    testId: string;
    info?: string | null;
  }> = [];

  for (const field of bankingFields) {
    const mapped = mapBankingRequirementKey(field.name);
    if (!mapped || mapped === "bankName" || seen.has(mapped)) continue;
    seen.add(mapped);
    const meta = BANKING_FIELD_META[mapped];
    items.push({
      key: mapped,
      isRequired: Boolean(field.isRequired),
      label: meta.label,
      placeholder: meta.placeholder,
      testId: meta.testId,
      info: field.fieldInformation,
    });
  }

  if (items.length === 0) {
    items.push({
      key: "accountNumber",
      isRequired: true,
      label: BANKING_FIELD_META.accountNumber.label,
      placeholder: BANKING_FIELD_META.accountNumber.placeholder,
      testId: BANKING_FIELD_META.accountNumber.testId,
    });
  }

  // Strictly guarantee mandatory banking fields precede optional banking fields
  return [
    ...items.filter((i) => i.isRequired),
    ...items.filter((i) => !i.isRequired),
  ];
}

export function buildBankVerificationParams(
  draft: BeneficiaryDraftValues,
  bankingFields: MitoBeneficiaryRequirementField[],
): Array<{ parameter: string; value: string }> {
  const params: Array<{ parameter: string; value: string }> = [];
  const add = (parameter: string, raw: string) => {
    const clean = raw.replace(/\s+/g, "").trim();
    if (clean) params.push({ parameter, value: clean });
  };
  const keys = new Set(getEffectiveBankingFieldList(bankingFields).map((f) => f.key));
  if (keys.has("accountNumber") || draft.accountNumber.trim()) {
    add("acct_number", draft.accountNumber);
  }
  if (keys.has("sortCode") || draft.sortCode.trim()) {
    add("sort_code", draft.sortCode.replace(/-/g, ""));
  }
  if (keys.has("iban") || draft.iban.trim()) {
    add("iban", draft.iban);
  }
  if (keys.has("swift") || draft.swift.trim()) {
    add("bic_swift", draft.swift);
  }
  if (keys.has("aba") || draft.aba.trim()) {
    add("aba", draft.aba);
  }
  if (keys.has("ifsc") || draft.ifsc.trim()) {
    add("ifsc", draft.ifsc);
  }
  if (keys.has("bsbCode") || draft.bsbCode.trim()) {
    add("bsb_code", draft.bsbCode);
  }
  if (keys.has("branchCode") || draft.branchCode.trim()) {
    add("branch_code", draft.branchCode);
  }
  if (keys.has("bankCode") || draft.bankCode.trim()) {
    add("bank_code", draft.bankCode);
  }
  if (keys.has("clabe") || draft.clabe.trim()) {
    add("clabe", draft.clabe);
  }
  if (keys.has("cnaps") || draft.cnaps.trim()) {
    add("cnaps", draft.cnaps);
  }
  return params;
}

export function validateBeneficiaryDraft(params: {
  draft: BeneficiaryDraftValues;
  country: string;
  currency: string;
  collectionMethod: "bank_deposit" | "mobile_money";
  personalFields: MitoBeneficiaryRequirementField[];
  bankingFields: MitoBeneficiaryRequirementField[];
  onlyBanking?: boolean;
}): Record<string, string> {
  const {
    draft,
    country,
    currency,
    collectionMethod,
    personalFields,
    bankingFields,
    onlyBanking = false,
  } = params;
  const errors: Record<string, string> = {};

  if (!onlyBanking) {
    if (draft.recipientType === "individual") {
      if (!draft.firstName.trim()) errors.firstName = "First name is required.";
      if (!draft.lastName.trim()) errors.lastName = "Last name is required.";
    } else {
      if (!draft.businessName.trim()) errors.businessName = "Company name is required.";
    }

    const reqMap = new Map<CanonicalPersonalFieldKey, boolean>();
    for (const f of personalFields) {
      const k = mapPersonalRequirementKey(f.name);
      if (k) {
        reqMap.set(k, Boolean(reqMap.get(k) || f.isRequired));
      }
    }

    const isRelRequired = reqMap.get("relationship") ?? true;
    if (isRelRequired && !draft.relationship.trim()) {
      errors.relationship = "Please select your relationship with the recipient.";
    }
    if (draft.relationship.toLowerCase() === "other" && !draft.otherRelationship.trim()) {
      errors.otherRelationship = "Please specify the relationship.";
    }

    if (reqMap.get("reason") && !draft.reason.trim()) {
      errors.reason = "Please select a reason for transfer.";
    }
    if (draft.reason.toLowerCase() === "other" && !draft.otherReason.trim()) {
      errors.otherReason = "Please specify the reason.";
    }

    const isMobileRequired =
      collectionMethod === "mobile_money" || Boolean(reqMap.get("mobileNo"));
    if (isMobileRequired && !draft.mobileNo.replace(/\s+/g, "").trim()) {
      errors.mobileNo = "Mobile number is required.";
    }

    if (reqMap.get("address") && !draft.address.trim()) {
      errors.address = "Address line 1 is required.";
    }
    if (reqMap.get("city") && !draft.city.trim()) {
      errors.city = "City is required.";
    }
    if (reqMap.get("stateOrProvince") && !draft.stateOrProvince.trim()) {
      errors.stateOrProvince = "State or province is required.";
    }
    if (reqMap.get("postcode") && !draft.postcode.trim()) {
      errors.postcode = "Postcode is required.";
    }
    if (reqMap.get("dob") && !draft.dob.trim()) {
      errors.dob = "Date of birth is required.";
    }
    if (reqMap.get("gender") && !draft.gender.trim()) {
      errors.gender = "Please select gender.";
    }

    const narrationMandatory =
      requiresNarration(country) ||
      currency.toUpperCase() === "NGN" ||
      Boolean(reqMap.get("narration"));
    if (narrationMandatory && !draft.narration.trim()) {
      errors.narration = "Narration is required for this corridor.";
    }

    if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
      errors.email = "Please enter a valid email address or leave this field blank.";
    }
  }

  if (collectionMethod === "bank_deposit") {
    if (!draft.bankName.trim()) {
      errors.bankName = "Please select a bank.";
    }
    const effectiveBanking = getEffectiveBankingFieldList(bankingFields);
    for (const bf of effectiveBanking) {
      if (!bf.isRequired) continue;
      const val = String(draft[bf.key] || "").replace(/\s+/g, "").trim();
      if (!val) {
        errors[bf.key] = `${bf.label} is required.`;
      }
    }
  }

  return errors;
}

export interface BeneficiaryDetailsFormSectionProps {
  country: string;
  currency: string;
  collectionMethod: "bank_deposit" | "mobile_money";
  draft: BeneficiaryDraftValues;
  onChangeDraft: (updater: (prev: BeneficiaryDraftValues) => BeneficiaryDraftValues) => void;
  onBankingFieldEdited: () => void;
  personalFields: MitoBeneficiaryRequirementField[];
  bankingFields: MitoBeneficiaryRequirementField[];
  relationships: MitoLookupTypeOption[];
  reasons: MitoLookupTypeOption[];
  provinces: MitoProvinceOption[];
  nicknameValidation: NicknameValidationState;
  bankVerificationStatus: BankVerificationStatus;
  bankVerificationResult: MitoBankVerificationClientResult | null;
  onSearchBankDetails: () => void;
  onChangeProvider?: () => void;
  allowRecipientTypeSwitch?: boolean;
  errors: Record<string, string>;
  onClearError: (key: string) => void;
}

function FieldInfoPopover({ text }: { text?: string | null }) {
  if (!text || !text.trim()) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Field information"
          className="inline-flex items-center justify-center rounded-full p-0.5 text-[#605E5C] hover:text-[#2e5bff] transition-colors cursor-pointer"
        >
          <Info className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 rounded-xl border border-[#cce3ff] bg-[#ECF5FF] p-3 text-xs leading-relaxed text-[#1e3a5f] shadow-md"
      >
        {text.trim()}
      </PopoverContent>
    </Popover>
  );
}

export function BeneficiaryDetailsFormSection({
  country,
  currency,
  collectionMethod,
  draft,
  onChangeDraft,
  onBankingFieldEdited,
  personalFields,
  bankingFields,
  relationships,
  reasons,
  provinces,
  nicknameValidation,
  bankVerificationStatus,
  bankVerificationResult,
  onSearchBankDetails,
  onChangeProvider,
  allowRecipientTypeSwitch = true,
  errors,
  onClearError,
}: BeneficiaryDetailsFormSectionProps) {
  const flagIso2 = countryFlagCode(country);
  const dialCode = countryDialCode(country);

  const reqPresence = new Map<
    CanonicalPersonalFieldKey,
    { present: boolean; required: boolean; info?: string | null; dropdownOptions?: Array<{ name: string; id: string }> }
  >();
  for (const f of personalFields) {
    const key = mapPersonalRequirementKey(f.name);
    if (!key) continue;
    const prev = reqPresence.get(key);
    reqPresence.set(key, {
      present: true,
      required: Boolean(prev?.required || f.isRequired),
      info: f.fieldInformation || prev?.info,
      dropdownOptions: f.dropdownOptions?.length ? f.dropdownOptions : prev?.dropdownOptions,
    });
  }

  const relOptions =
    reqPresence.get("relationship")?.dropdownOptions?.length
      ? reqPresence.get("relationship")!.dropdownOptions!.map((o) => ({
          code: o.name,
          name: o.name,
          id: o.id,
        }))
      : relationships.length > 0
        ? relationships
        : DEFAULT_RELATIONSHIP_OPTIONS;

  const reasonOptions =
    reqPresence.get("reason")?.dropdownOptions?.length
      ? reqPresence.get("reason")!.dropdownOptions!.map((o) => ({
          code: o.name,
          name: o.name,
          id: o.id,
        }))
      : reasons.length > 0
        ? reasons
        : DEFAULT_REASON_OPTIONS;

  const isRelMandatory = reqPresence.get("relationship")?.required ?? true;
  const hasReason = Boolean(reqPresence.get("reason")?.present);
  const isReasonMandatory = Boolean(reqPresence.get("reason")?.required);
  const isMobileMandatory =
    collectionMethod === "mobile_money" || Boolean(reqPresence.get("mobileNo")?.required);
  const hasAddress = Boolean(reqPresence.get("address")?.present);
  const isAddressMandatory = Boolean(reqPresence.get("address")?.required);
  const hasCity = Boolean(reqPresence.get("city")?.present);
  const isCityMandatory = Boolean(reqPresence.get("city")?.required);
  const hasState = Boolean(reqPresence.get("stateOrProvince")?.present);
  const isStateMandatory = Boolean(reqPresence.get("stateOrProvince")?.required);
  const hasPostcode = Boolean(reqPresence.get("postcode")?.present);
  const isPostcodeMandatory = Boolean(reqPresence.get("postcode")?.required);
  const hasDob = Boolean(reqPresence.get("dob")?.present);
  const isDobMandatory = Boolean(reqPresence.get("dob")?.required);
  const hasGender = Boolean(reqPresence.get("gender")?.present);
  const isGenderMandatory = Boolean(reqPresence.get("gender")?.required);
  const isNarrationMandatory =
    requiresNarration(country) ||
    currency.toUpperCase() === "NGN" ||
    Boolean(reqPresence.get("narration")?.required);

  const effectiveBankingFields = getEffectiveBankingFieldList(bankingFields);
  const areMandatoryBankingFilled = effectiveBankingFields
    .filter((f) => f.isRequired)
    .every((f) => Boolean(String(draft[f.key] || "").replace(/\s+/g, "").trim()));

  const enteredRecipientName =
    draft.recipientType === "business"
      ? draft.businessName.trim()
      : `${draft.firstName.trim()} ${draft.lastName.trim()}`.trim();

  const handleSyncVerifiedName = (verifiedName: string) => {
    const clean = verifiedName.trim();
    if (!clean) return;
    onChangeDraft((prev) => {
      if (prev.recipientType === "business") {
        return {
          ...prev,
          businessName: clean,
          accountHolderName: clean,
        };
      }
      const parts = clean.split(/\s+/);
      const firstName = parts[0] || prev.firstName;
      const lastName = parts.slice(1).join(" ") || prev.lastName;
      return {
        ...prev,
        firstName,
        lastName,
        accountHolderName: clean,
      };
    });
    onClearError("firstName");
    onClearError("lastName");
    onClearError("businessName");
  };

  const renderMobileInput = (mandatory: boolean) => (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Label className="text-sm font-medium text-[#323130]">
          {collectionMethod === "mobile_money" ? "Mobile wallet number" : "Mobile number"}
          {mandatory ? (
            <span className="text-red-500 ml-0.5">*</span>
          ) : (
            <span className="text-muted-foreground font-normal ml-1">(optional)</span>
          )}
        </Label>
        <FieldInfoPopover text={reqPresence.get("mobileNo")?.info} />
      </div>
      <div className="flex items-center gap-2">
        <div className="h-10 px-3 rounded-md border border-input bg-slate-50 inline-flex items-center gap-2 text-sm text-[#323130] shrink-0 font-mono tabular-nums">
          <img
            src={`https://flagcdn.com/w20/${flagIso2}.png`}
            alt={country}
            className="w-4 h-3 object-cover rounded-[2px]"
          />
          <span>{dialCode}</span>
        </div>
        <Input
          type="tel"
          data-testid="input-beneficiary-mobile"
          placeholder="8012345678"
          value={draft.mobileNo}
          onChange={(e) => {
            onClearError("mobileNo");
            onChangeDraft((prev) => ({ ...prev, mobileNo: e.target.value }));
          }}
          className={cn(
            "font-mono tabular-nums",
            errors.mobileNo && "border-red-500 focus-visible:ring-red-500",
          )}
        />
      </div>
      {errors.mobileNo && <p className="text-xs text-red-600">{errors.mobileNo}</p>}
    </div>
  );

  const renderRelationshipSelect = (mandatory: boolean) => (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label className="text-sm font-medium text-[#323130]">
          Relationship
          {mandatory ? (
            <span className="text-red-500 ml-0.5">*</span>
          ) : (
            <span className="text-muted-foreground font-normal ml-1">(optional)</span>
          )}
        </Label>
        <Select
          value={draft.relationship}
          onValueChange={(val) => {
            onClearError("relationship");
            const matched = relOptions.find(
              (o) => o.code.toLowerCase() === val.toLowerCase() || o.name.toLowerCase() === val.toLowerCase(),
            );
            onChangeDraft((prev) => ({
              ...prev,
              relationship: matched?.name || val,
              relationId: matched?.id || matched?.code || "",
            }));
          }}
        >
          <SelectTrigger
            data-testid="select-beneficiary-relationship"
            className={cn(errors.relationship && "border-red-500")}
          >
            <SelectValue placeholder="Select relationship" />
          </SelectTrigger>
          <SelectContent>
            {relOptions.map((opt) => (
              <SelectItem key={`${opt.code}-${opt.name}`} value={opt.name}>
                {opt.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.relationship && <p className="text-xs text-red-600">{errors.relationship}</p>}
      </div>

      {draft.relationship.toLowerCase() === "other" && (
        <div className="space-y-2">
          <Label className="text-sm font-medium text-[#323130]">
            Specify relationship <span className="text-red-500">*</span>
          </Label>
          <Input
            data-testid="input-beneficiary-other-relationship"
            placeholder="Describe your relationship"
            value={draft.otherRelationship}
            onChange={(e) => {
              onClearError("otherRelationship");
              onChangeDraft((prev) => ({ ...prev, otherRelationship: e.target.value }));
            }}
            className={cn(errors.otherRelationship && "border-red-500")}
          />
          {errors.otherRelationship && (
            <p className="text-xs text-red-600">{errors.otherRelationship}</p>
          )}
        </div>
      )}
    </div>
  );

  const renderReasonSelect = (mandatory: boolean) => (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label className="text-sm font-medium text-[#323130]">
          Reason for transfer
          {mandatory ? (
            <span className="text-red-500 ml-0.5">*</span>
          ) : (
            <span className="text-muted-foreground font-normal ml-1">(optional)</span>
          )}
        </Label>
        <Select
          value={draft.reason}
          onValueChange={(val) => {
            onClearError("reason");
            const matched = reasonOptions.find(
              (o) => o.code.toLowerCase() === val.toLowerCase() || o.name.toLowerCase() === val.toLowerCase(),
            );
            onChangeDraft((prev) => ({
              ...prev,
              reason: matched?.name || val,
              reasonId: matched?.id || matched?.code || "",
            }));
          }}
        >
          <SelectTrigger
            data-testid="select-beneficiary-reason"
            className={cn(errors.reason && "border-red-500")}
          >
            <SelectValue placeholder="Select reason for transfer" />
          </SelectTrigger>
          <SelectContent>
            {reasonOptions.map((opt) => (
              <SelectItem key={`${opt.code}-${opt.name}`} value={opt.name}>
                {opt.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.reason && <p className="text-xs text-red-600">{errors.reason}</p>}
      </div>

      {draft.reason.toLowerCase() === "other" && (
        <div className="space-y-2">
          <Label className="text-sm font-medium text-[#323130]">
            Specify reason <span className="text-red-500">*</span>
          </Label>
          <Input
            data-testid="input-beneficiary-other-reason"
            placeholder="Describe the transfer reason"
            value={draft.otherReason}
            onChange={(e) => {
              onClearError("otherReason");
              onChangeDraft((prev) => ({ ...prev, otherReason: e.target.value }));
            }}
            className={cn(errors.otherReason && "border-red-500")}
          />
          {errors.otherReason && <p className="text-xs text-red-600">{errors.otherReason}</p>}
        </div>
      )}
    </div>
  );

  const renderAddressBlock = (mandatory: boolean) => (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label className="text-sm font-medium text-[#323130]">
          Address line 1
          {mandatory ? (
            <span className="text-red-500 ml-0.5">*</span>
          ) : (
            <span className="text-muted-foreground font-normal ml-1">(optional)</span>
          )}
        </Label>
        <Input
          data-testid="input-beneficiary-address1"
          placeholder="Street address or P.O. box"
          value={draft.address}
          onChange={(e) => {
            onClearError("address");
            onChangeDraft((prev) => ({ ...prev, address: e.target.value }));
          }}
          className={cn(errors.address && "border-red-500")}
        />
        {errors.address && <p className="text-xs text-red-600">{errors.address}</p>}
      </div>

      {/* Address line 2 always stays directly under Address line 1 per CLAUDE.md */}
      <div className="space-y-2">
        <Label className="text-sm font-medium text-[#323130]">
          Address line 2 <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input
          data-testid="input-beneficiary-address2"
          placeholder="Apartment, suite, unit, building, floor"
          value={draft.addressLine2}
          onChange={(e) => onChangeDraft((prev) => ({ ...prev, addressLine2: e.target.value }))}
        />
      </div>
    </div>
  );

  const renderCityField = (mandatory: boolean) => (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-[#323130]">
        City
        {mandatory ? (
          <span className="text-red-500 ml-0.5">*</span>
        ) : (
          <span className="text-muted-foreground font-normal ml-1">(optional)</span>
        )}
      </Label>
      <Input
        data-testid="input-beneficiary-city"
        placeholder="Enter city"
        value={draft.city}
        onChange={(e) => {
          onClearError("city");
          onChangeDraft((prev) => ({ ...prev, city: e.target.value }));
        }}
        className={cn(errors.city && "border-red-500")}
      />
      {errors.city && <p className="text-xs text-red-600">{errors.city}</p>}
    </div>
  );

  const renderStateField = (mandatory: boolean) => (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-[#323130]">
        State / province
        {mandatory ? (
          <span className="text-red-500 ml-0.5">*</span>
        ) : (
          <span className="text-muted-foreground font-normal ml-1">(optional)</span>
        )}
      </Label>
      {provinces.length > 0 ? (
        <Select
          value={draft.stateOrProvince}
          onValueChange={(val) => {
            onClearError("stateOrProvince");
            onChangeDraft((prev) => ({ ...prev, stateOrProvince: val }));
          }}
        >
          <SelectTrigger
            data-testid="select-beneficiary-state"
            className={cn(errors.stateOrProvince && "border-red-500")}
          >
            <SelectValue placeholder="Select state or province" />
          </SelectTrigger>
          <SelectContent>
            {provinces.map((prov) => (
              <SelectItem key={`${prov.id}-${prov.name}`} value={prov.name}>
                {prov.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          data-testid="input-beneficiary-state"
          placeholder="Enter state or province"
          value={draft.stateOrProvince}
          onChange={(e) => {
            onClearError("stateOrProvince");
            onChangeDraft((prev) => ({ ...prev, stateOrProvince: e.target.value }));
          }}
          className={cn(errors.stateOrProvince && "border-red-500")}
        />
      )}
      {errors.stateOrProvince && <p className="text-xs text-red-600">{errors.stateOrProvince}</p>}
    </div>
  );

  const renderPostcodeField = (mandatory: boolean) => (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-[#323130]">
        Postcode
        {mandatory ? (
          <span className="text-red-500 ml-0.5">*</span>
        ) : (
          <span className="text-muted-foreground font-normal ml-1">(optional)</span>
        )}
      </Label>
      <Input
        data-testid="input-beneficiary-postcode"
        placeholder="Enter postal or ZIP code"
        value={draft.postcode}
        onChange={(e) => {
          onClearError("postcode");
          onChangeDraft((prev) => ({ ...prev, postcode: e.target.value }));
        }}
        className={cn(errors.postcode && "border-red-500")}
      />
      {errors.postcode && <p className="text-xs text-red-600">{errors.postcode}</p>}
    </div>
  );

  const renderDobField = (mandatory: boolean) => (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-[#323130]">
        Date of birth
        {mandatory ? (
          <span className="text-red-500 ml-0.5">*</span>
        ) : (
          <span className="text-muted-foreground font-normal ml-1">(optional)</span>
        )}
      </Label>
      <Input
        type="date"
        data-testid="input-beneficiary-dob"
        value={draft.dob}
        onChange={(e) => {
          onClearError("dob");
          onChangeDraft((prev) => ({ ...prev, dob: e.target.value }));
        }}
        className={cn(errors.dob && "border-red-500")}
      />
      {errors.dob && <p className="text-xs text-red-600">{errors.dob}</p>}
    </div>
  );

  const renderGenderField = (mandatory: boolean) => (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-[#323130]">
        Gender
        {mandatory ? (
          <span className="text-red-500 ml-0.5">*</span>
        ) : (
          <span className="text-muted-foreground font-normal ml-1">(optional)</span>
        )}
      </Label>
      <Select
        value={draft.gender}
        onValueChange={(val) => {
          onClearError("gender");
          onChangeDraft((prev) => ({ ...prev, gender: val }));
        }}
      >
        <SelectTrigger
          data-testid="select-beneficiary-gender"
          className={cn(errors.gender && "border-red-500")}
        >
          <SelectValue placeholder="Select gender" />
        </SelectTrigger>
        <SelectContent>
          {genderOptions.map((g) => (
            <SelectItem key={g.value} value={g.label}>
              {g.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {errors.gender && <p className="text-xs text-red-600">{errors.gender}</p>}
    </div>
  );

  const renderNarrationField = (mandatory: boolean) => (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-[#323130]">
        Narration
        {mandatory ? (
          <span className="text-red-500 ml-0.5">*</span>
        ) : (
          <span className="text-muted-foreground font-normal ml-1">(optional)</span>
        )}
      </Label>
      <Input
        data-testid="input-beneficiary-narration"
        placeholder="Payment reference or remark"
        value={draft.narration}
        onChange={(e) => {
          onClearError("narration");
          onChangeDraft((prev) => ({ ...prev, narration: e.target.value }));
        }}
        className={cn(errors.narration && "border-red-500")}
      />
      {errors.narration ? (
        <p className="text-xs text-red-600">{errors.narration}</p>
      ) : mandatory ? (
        <p className="text-xs text-[#605E5C]">
          Narration is required for payouts to {country}.
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Personal & identification details */}
      <Card className="rounded-xl border border-[#efefee] bg-white shadow-[-2px_4px_16px_0px_rgba(0,0,0,0.04)]">
        <CardHeader className="pb-4 pt-5 px-5 sm:px-6 border-b border-[#efefee]">
          <CardTitle className="font-display text-base font-semibold text-[#323130]">
            Recipient details
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5 sm:p-6 space-y-5">
          {allowRecipientTypeSwitch && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#323130]">
                Recipient type <span className="text-red-500">*</span>
              </Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  data-testid="toggle-beneficiary-individual"
                  onClick={() =>
                    onChangeDraft((prev) => ({ ...prev, recipientType: "individual" }))
                  }
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-xl border py-2.5 px-3 text-sm font-semibold transition-all cursor-pointer",
                    draft.recipientType === "individual"
                      ? "border-[#2e5bff] bg-[#ECF5FF] text-[#2e5bff]"
                      : "border-[#efefee] bg-white text-[#605E5C] hover:bg-slate-50",
                  )}
                >
                  <User className="w-4 h-4" />
                  <span>Individual</span>
                </button>
                <button
                  type="button"
                  data-testid="toggle-beneficiary-business"
                  onClick={() =>
                    onChangeDraft((prev) => ({ ...prev, recipientType: "business" }))
                  }
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-xl border py-2.5 px-3 text-sm font-semibold transition-all cursor-pointer",
                    draft.recipientType === "business"
                      ? "border-[#2e5bff] bg-[#ECF5FF] text-[#2e5bff]"
                      : "border-[#efefee] bg-white text-[#605E5C] hover:bg-slate-50",
                  )}
                >
                  <Building2 className="w-4 h-4" />
                  <span>Business</span>
                </button>
              </div>
            </div>
          )}

          {/* ── MANDATORY PERSONAL FIELDS AT TOP ── */}
          {draft.recipientType === "individual" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium text-[#323130]">
                  First name <span className="text-red-500">*</span>
                </Label>
                <Input
                  data-testid="input-beneficiary-first-name"
                  placeholder="Enter first name"
                  value={draft.firstName}
                  onChange={(e) => {
                    onClearError("firstName");
                    onChangeDraft((prev) => ({ ...prev, firstName: e.target.value }));
                  }}
                  className={cn(errors.firstName && "border-red-500")}
                />
                {errors.firstName && <p className="text-xs text-red-600">{errors.firstName}</p>}
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium text-[#323130]">
                  Last name <span className="text-red-500">*</span>
                </Label>
                <Input
                  data-testid="input-beneficiary-last-name"
                  placeholder="Enter last name"
                  value={draft.lastName}
                  onChange={(e) => {
                    onClearError("lastName");
                    onChangeDraft((prev) => ({ ...prev, lastName: e.target.value }));
                  }}
                  className={cn(errors.lastName && "border-red-500")}
                />
                {errors.lastName && <p className="text-xs text-red-600">{errors.lastName}</p>}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#323130]">
                Company name <span className="text-red-500">*</span>
              </Label>
              <Input
                data-testid="input-beneficiary-company-name"
                placeholder="Enter registered business name"
                value={draft.businessName}
                onChange={(e) => {
                  onClearError("businessName");
                  onChangeDraft((prev) => ({ ...prev, businessName: e.target.value }));
                }}
                className={cn(errors.businessName && "border-red-500")}
              />
              {errors.businessName && <p className="text-xs text-red-600">{errors.businessName}</p>}
            </div>
          )}

          {isRelMandatory && renderRelationshipSelect(true)}
          {hasReason && isReasonMandatory && renderReasonSelect(true)}
          {isMobileMandatory && renderMobileInput(true)}
          {hasAddress && isAddressMandatory && renderAddressBlock(true)}

          {(isCityMandatory || isStateMandatory || isPostcodeMandatory) && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {hasCity && isCityMandatory && renderCityField(true)}
              {hasState && isStateMandatory && renderStateField(true)}
              {hasPostcode && isPostcodeMandatory && renderPostcodeField(true)}
            </div>
          )}

          {(isDobMandatory || isGenderMandatory) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {hasDob && isDobMandatory && renderDobField(true)}
              {hasGender && isGenderMandatory && renderGenderField(true)}
            </div>
          )}

          {isNarrationMandatory && renderNarrationField(true)}

          {/* ── OPTIONAL PERSONAL FIELDS STRICTLY BELOW MANDATORY FIELDS ── */}
          <div className="pt-3 border-t border-[#f3f2f1] space-y-5">
            {!isRelMandatory && renderRelationshipSelect(false)}
            {hasReason && !isReasonMandatory && renderReasonSelect(false)}
            {!isMobileMandatory && renderMobileInput(false)}
            {hasAddress && !isAddressMandatory && renderAddressBlock(false)}

            {((hasCity && !isCityMandatory) ||
              (hasState && !isStateMandatory) ||
              (hasPostcode && !isPostcodeMandatory)) && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {hasCity && !isCityMandatory && renderCityField(false)}
                {hasState && !isStateMandatory && renderStateField(false)}
                {hasPostcode && !isPostcodeMandatory && renderPostcodeField(false)}
              </div>
            )}

            {((hasDob && !isDobMandatory) || (hasGender && !isGenderMandatory)) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {hasDob && !isDobMandatory && renderDobField(false)}
                {hasGender && !isGenderMandatory && renderGenderField(false)}
              </div>
            )}

            {!isNarrationMandatory && renderNarrationField(false)}

            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#323130]">
                Email address <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                type="email"
                data-testid="input-beneficiary-email"
                placeholder="name@example.com"
                value={draft.email}
                onChange={(e) => {
                  onClearError("email");
                  onChangeDraft((prev) => ({ ...prev, email: e.target.value }));
                }}
                className={cn(errors.email && "border-red-500")}
              />
              {errors.email ? (
                <p className="text-xs text-red-600">{errors.email}</p>
              ) : (
                <p className="text-xs text-[#605E5C]">
                  Optional — links sender &amp; recipient history if shared
                </p>
              )}
            </div>

            <NicknameFieldWithCheck
              value={draft.nickName}
              onChange={(val) => onChangeDraft((prev) => ({ ...prev, nickName: val }))}
              validation={nicknameValidation}
            />
          </div>
        </CardContent>
      </Card>

      {/* Selected Mobile Operator Banner when Mobile Money */}
      {collectionMethod === "mobile_money" && draft.bankName && (
        <Card className="rounded-xl border border-[#efefee] bg-white shadow-[-2px_4px_16px_0px_rgba(0,0,0,0.04)]">
          <CardContent className="p-5 sm:px-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-[#DCEBFA] text-[#2e5bff] flex items-center justify-center shrink-0">
                <Smartphone className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-[#605E5C]">Mobile operator</p>
                <p className="text-sm font-semibold text-[#111827] truncate">{draft.bankName}</p>
              </div>
            </div>
            {onChangeProvider && (
              <button
                type="button"
                data-testid="button-change-provider"
                onClick={onChangeProvider}
                className="text-xs font-semibold text-[#2e5bff] hover:underline shrink-0 cursor-pointer"
              >
                Change operator
              </button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Banking Details + Search Bank Details Card when Bank Deposit */}
      {collectionMethod === "bank_deposit" && (
        <Card className="rounded-xl border border-[#efefee] bg-white shadow-[-2px_4px_16px_0px_rgba(0,0,0,0.04)]">
          <CardHeader className="pb-4 pt-5 px-5 sm:px-6 border-b border-[#efefee] flex flex-row items-center justify-between space-y-0 gap-3">
            <div className="space-y-1 min-w-0">
              <CardTitle className="font-display text-base font-semibold text-[#323130]">
                Banking details
              </CardTitle>
              {draft.bankName && (
                <div className="inline-flex items-center gap-1.5 text-xs text-[#605E5C]">
                  {draft.isInternational ? (
                    <Globe className="w-3.5 h-3.5 text-[#38A3A5]" />
                  ) : (
                    <Landmark className="w-3.5 h-3.5 text-[#2e5bff]" />
                  )}
                  <span className="font-medium text-[#111827]">{draft.bankName}</span>
                  <span>·</span>
                  <span className="text-[#38A3A5] font-medium">
                    {draft.isInternational ? "Swift" : "Direct to bank"}
                  </span>
                </div>
              )}
            </div>
            {onChangeProvider && (
              <button
                type="button"
                data-testid="button-change-provider"
                onClick={onChangeProvider}
                className="text-xs font-semibold text-[#2e5bff] hover:underline shrink-0 cursor-pointer"
              >
                Change bank
              </button>
            )}
          </CardHeader>
          <CardContent className="p-5 sm:p-6 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {effectiveBankingFields.map((bf) => (
                <div
                  key={bf.key}
                  className={cn(
                    "space-y-2",
                    effectiveBankingFields.length === 1 && "sm:col-span-2",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <Label className="text-sm font-medium text-[#323130]">
                      {bf.label}
                      {bf.isRequired ? (
                        <span className="text-red-500 ml-0.5">*</span>
                      ) : (
                        <span className="text-muted-foreground font-normal ml-1">(optional)</span>
                      )}
                    </Label>
                    <FieldInfoPopover text={bf.info} />
                  </div>
                  <Input
                    data-testid={bf.testId}
                    placeholder={bf.placeholder}
                    value={draft[bf.key]}
                    onChange={(e) => {
                      onClearError(bf.key);
                      onBankingFieldEdited();
                      onChangeDraft((prev) => ({
                        ...prev,
                        [bf.key]: e.target.value,
                        accountHolderName: "",
                      }));
                    }}
                    className={cn(
                      "font-mono tabular-nums",
                      errors[bf.key] && "border-red-500 focus-visible:ring-red-500",
                    )}
                  />
                  {errors[bf.key] && <p className="text-xs text-red-600">{errors[bf.key]}</p>}
                </div>
              ))}
            </div>

            <BankVerificationCard
              status={bankVerificationStatus}
              result={bankVerificationResult}
              disabled={!areMandatoryBankingFilled}
              onSearchBankDetails={onSearchBankDetails}
              enteredRecipientName={enteredRecipientName}
              onSyncVerifiedName={handleSyncVerifiedName}
              bankSummaryLabel={draft.bankName}
              accountSummaryLabel={draft.accountNumber || draft.iban}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
