import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Landmark,
  Loader2,
  Send,
  Smartphone,
  User,
  UserPlus,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BeneficiaryDetailsFormSection,
  BeneficiaryReviewSummary,
  DeliveryAndProviderPicker,
  STATIC_GBP_FALLBACK_RATES,
  buildBankVerificationParams,
  countryDialCode,
  countryFlagCode,
  countryToIso3,
  createEmptyBeneficiaryDraft,
  resolveEffectiveCorridorRequirements,
  saveExtendedBeneficiaryMeta,
  useBankVerification,
  useNicknameValidation,
  validateBeneficiaryDraft,
  type BeneficiaryDraftValues,
} from "@/components/beneficiary";
import { useContacts } from "@/contexts/ContactsContext";
import { countries } from "@/data/countries";
import { useToast } from "@/hooks/use-toast";
import { currencyForCountry, generateUniqueCode } from "@/lib/recipients";
import {
  createMitoBeneficiaryClient,
  fetchMitoAffiliateRate,
  fetchMitoBeneficiaryRequirements,
  fetchMitoLookups,
  fetchMitoProvidersDetailed,
  fetchMitoProvinces,
  type MitoBeneficiaryRequirementField,
  type MitoLookupTypeOption,
  type MitoProviderOption,
  type MitoProvinceOption,
} from "@/lib/sendMoney";
import { cn } from "@/lib/utils";

type WizardStage = 1 | 2 | 3 | 4;
type Stage2SubView = "provider" | "details";

const WIZARD_STEPS = [
  { id: 1, label: "1. Select service" },
  { id: 2, label: "2. Details" },
  { id: 3, label: "3. Summary" },
] as const;

interface SavedBeneficiarySummary {
  savedId: string;
  uniqueCode: string;
  fullName: string;
  bankOrOperator: string;
  currency: string;
  country: string;
}

export default function AddBeneficiaryPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { contacts, upsertRecipient } = useContacts();

  const [stage, setStage] = useState<WizardStage>(1);
  const [stage2SubView, setStage2SubView] = useState<Stage2SubView>("provider");
  const [skippedProviderPicker, setSkippedProviderPicker] = useState(false);

  // Stage 1 state
  const [country, setCountry] = useState("Nigeria");
  const [collectionMethod, setCollectionMethod] = useState<"bank_deposit" | "mobile_money">(
    "bank_deposit",
  );
  const [draft, setDraft] = useState<BeneficiaryDraftValues>(() =>
    createEmptyBeneficiaryDraft("individual"),
  );
  const [stage1Loading, setStage1Loading] = useState(false);
  const [stage1Error, setStage1Error] = useState<string | null>(null);

  // Corridor providers & rates
  const [localProviders, setLocalProviders] = useState<MitoProviderOption[]>([]);
  const [internationalProviders, setInternationalProviders] = useState<MitoProviderOption[]>([]);
  const [corridorRate, setCorridorRate] = useState<number>(STATIC_GBP_FALLBACK_RATES.NGN);

  // Dynamic requirements & lookups
  const [upstreamRequirements, setUpstreamRequirements] = useState<
    MitoBeneficiaryRequirementField[]
  >([]);
  const [relationships, setRelationships] = useState<MitoLookupTypeOption[]>([]);
  const [reasons, setReasons] = useState<MitoLookupTypeOption[]>([]);
  const [provinces, setProvinces] = useState<MitoProvinceOption[]>([]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSummary, setSavedSummary] = useState<SavedBeneficiarySummary | null>(null);

  const currency = useMemo(() => currencyForCountry(country), [country]);
  const countryIso3 = useMemo(() => countryToIso3(country), [country]);
  const receiveFlag = useMemo(() => countryFlagCode(country), [country]);

  const nicknameValidation = useNicknameValidation(draft.nickName);
  const bankVerification = useBankVerification();

  // Sync resolved verified account holder name into draft
  useEffect(() => {
    const resolvedName = bankVerification.result?.accountHolderName?.trim();
    if (bankVerification.status === "resolved" && resolvedName) {
      setDraft((prev) =>
        prev.accountHolderName === resolvedName
          ? prev
          : { ...prev, accountHolderName: resolvedName },
      );
    }
  }, [bankVerification.status, bankVerification.result]);

  // Load static Mito lookups once
  useEffect(() => {
    let active = true;
    void fetchMitoLookups().then((res) => {
      if (!active) return;
      const relList = res.relationships || res.relationshipes || [];
      const rsnList = res.reason || res.purposes || [];
      setRelationships(Array.isArray(relList) ? relList : []);
      setReasons(Array.isArray(rsnList) ? rsnList : []);
    });
    return () => {
      active = false;
    };
  }, []);

  // Load corridor requirements & provinces whenever Stage 2 details context changes
  useEffect(() => {
    if (stage < 2) return;
    let active = true;
    const entityCode = draft.recipientType === "business" ? "B" : "I";
    void Promise.all([
      fetchMitoBeneficiaryRequirements({
        currencyCode: currency,
        countryIso3,
        entityType: entityCode,
        providerId: draft.providerId || undefined,
        service: collectionMethod,
        isInternational: draft.isInternational,
      }),
      fetchMitoProvinces(countryIso3),
    ]).then(([reqs, provs]) => {
      if (!active) return;
      setUpstreamRequirements(reqs);
      setProvinces(provs);
    });
    return () => {
      active = false;
    };
  }, [
    stage,
    currency,
    countryIso3,
    draft.recipientType,
    draft.providerId,
    collectionMethod,
    draft.isInternational,
  ]);

  const { personalFields, bankingFields } = useMemo(
    () =>
      resolveEffectiveCorridorRequirements({
        upstream: upstreamRequirements,
        currencyCode: currency,
        countryIso3,
        countryName: country,
        entityType: draft.recipientType === "business" ? "B" : "I",
        service: collectionMethod,
        isInternational: draft.isInternational,
      }),
    [
      upstreamRequirements,
      currency,
      countryIso3,
      country,
      draft.recipientType,
      collectionMethod,
      draft.isInternational,
    ],
  );

  const clearError = (key: string) => {
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleStage1Continue = async () => {
    if (!country.trim()) {
      setStage1Error("Please select the recipient's country.");
      return;
    }
    setStage1Error(null);
    setStage1Loading(true);
    try {
      const [provRes, rateRes] = await Promise.all([
        fetchMitoProvidersDetailed({
          countryIso3,
          currencyCode: currency,
          service: collectionMethod,
        }),
        fetchMitoAffiliateRate("GBP", currency),
      ]);

      const resolvedRate =
        (rateRes?.rate && rateRes.rate > 0 ? rateRes.rate : null) ||
        (rateRes?.partnerRate && rateRes.partnerRate > 0 ? rateRes.partnerRate : null) ||
        STATIC_GBP_FALLBACK_RATES[currency] ||
        1.0;

      setCorridorRate(resolvedRate);
      setLocalProviders(provRes.local);
      setInternationalProviders(provRes.international);
      bankVerification.reset();
      setErrors({});

      const singleGenericOnly =
        provRes.international.length === 0 &&
        provRes.local.length === 1 &&
        Boolean(provRes.local[0]?.isGeneric);

      if (singleGenericOnly) {
        const generic = provRes.local[0];
        setDraft((prev) => ({
          ...prev,
          providerId: generic.providerId,
          providerCode: generic.providerCode,
          bankName: generic.providerName,
          isInternational: false,
        }));
        setSkippedProviderPicker(true);
        setStage2SubView("details");
      } else {
        setSkippedProviderPicker(false);
        setStage2SubView("provider");
      }

      setStage(2);
    } finally {
      setStage1Loading(false);
    }
  };

  const handleSearchBankDetails = async () => {
    const bankErrs = validateBeneficiaryDraft({
      draft,
      country,
      currency,
      collectionMethod,
      personalFields,
      bankingFields,
      onlyBanking: true,
    });
    if (Object.keys(bankErrs).length > 0) {
      setErrors((prev) => ({ ...prev, ...bankErrs }));
      toast({
        title: "Missing banking details",
        description: "Please fill in the required banking fields before searching.",
        variant: "destructive",
      });
      return;
    }
    const param = buildBankVerificationParams(draft, bankingFields);
    await bankVerification.verify({
      international: draft.isInternational,
      countryIso3,
      providerId: draft.providerId || undefined,
      param,
    });
  };

  const handleStage2Continue = () => {
    if (nicknameValidation.status === "checking") return;
    if (nicknameValidation.isBlocking) {
      toast({
        title: "Check recipient nickname",
        description: nicknameValidation.message || "Please update the nickname or leave it blank.",
        variant: "destructive",
      });
      return;
    }

    const foundErrors = validateBeneficiaryDraft({
      draft,
      country,
      currency,
      collectionMethod,
      personalFields,
      bankingFields,
    });

    if (Object.keys(foundErrors).length > 0) {
      setErrors(foundErrors);
      toast({
        title: "Required details missing",
        description: "Please complete all highlighted mandatory fields before continuing.",
        variant: "destructive",
      });
      return;
    }

    if (collectionMethod === "bank_deposit" && !bankVerification.canContinue) {
      toast({
        title: "Bank check required",
        description: "Please click Search bank details to confirm the account before continuing.",
        variant: "destructive",
      });
      return;
    }

    setErrors({});
    setSaveError(null);
    setStage(3);
  };

  const fullName =
    draft.recipientType === "business"
      ? draft.businessName.trim()
      : `${draft.firstName.trim()} ${draft.lastName.trim()}`.trim();

  const handleSaveBeneficiary = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const existingCodes = contacts.map((c) => c.uniqueCode).filter(Boolean);
      const uniqueCode = generateUniqueCode(existingCodes);
      const resolvedEmail =
        draft.email.trim() || `recipient-${uniqueCode}@beneficiary.rhemito.local`;
      const serviceTypeLabel =
        collectionMethod === "mobile_money"
          ? "Mobile Money"
          : draft.isInternational
            ? "SWIFT"
            : "Bank Deposit";

      const cleanAcct = draft.accountNumber.replace(/\s+/g, "").trim();
      const cleanSortCode = draft.sortCode.replace(/\s+/g, "").trim();
      const cleanIban = draft.iban.replace(/\s+/g, "").trim();
      const cleanSwift = draft.swift.replace(/\s+/g, "").trim();
      const cleanMobile = draft.mobileNo.replace(/\s+/g, "").trim();
      const dialCode = countryDialCode(country);
      const fullMobile = cleanMobile
        ? cleanMobile.startsWith("+")
          ? cleanMobile
          : `${dialCode}${cleanMobile.replace(/^0+/, "")}`
        : "";

      const mitoRes = await createMitoBeneficiaryClient({
        recipientType: draft.recipientType,
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        businessName: draft.businessName.trim(),
        companyName: draft.businessName.trim(),
        country,
        countryIso3,
        currency,
        serviceType: serviceTypeLabel,
        collectionMode: collectionMethod === "mobile_money" ? "MOBILEMONEY" : "BANKACCOUNT",
        providerId: draft.providerId || undefined,
        providerCode: draft.providerCode || undefined,
        bankName: draft.bankName.trim(),
        accountNumber: cleanAcct || cleanMobile,
        sortCode: cleanSortCode || undefined,
        iban: cleanIban || undefined,
        swift: cleanSwift || undefined,
        aba: draft.aba.replace(/\s+/g, "").trim() || undefined,
        ifsc: draft.ifsc.replace(/\s+/g, "").trim() || undefined,
        bsbCode: draft.bsbCode.replace(/\s+/g, "").trim() || undefined,
        branchCode: draft.branchCode.replace(/\s+/g, "").trim() || undefined,
        bankCode: draft.bankCode.replace(/\s+/g, "").trim() || undefined,
        clabe: draft.clabe.replace(/\s+/g, "").trim() || undefined,
        cnaps: draft.cnaps.replace(/\s+/g, "").trim() || undefined,
        isInternational: draft.isInternational,
        accountHolderName: draft.accountHolderName.trim() || undefined,
        relationship: draft.relationship.trim() || "Personal",
        relationId: draft.relationId || undefined,
        otherRelation: draft.otherRelationship.trim() || undefined,
        otherRelationship: draft.otherRelationship.trim() || undefined,
        reason: draft.reason.trim() || undefined,
        reasonId: draft.reasonId || undefined,
        otherReason: draft.otherReason.trim() || undefined,
        narration: draft.narration.trim() || undefined,
        nickName: draft.nickName.trim() || undefined,
        beneficiaryNickname: draft.nickName.trim() || undefined,
        mobileNo: fullMobile || undefined,
        address: draft.address.trim() || undefined,
        addressLine2: draft.addressLine2.trim() || undefined,
        city: draft.city.trim() || undefined,
        stateOrProvince: draft.stateOrProvince.trim() || undefined,
        postcode: draft.postcode.trim() || undefined,
        dob: draft.dob.trim() || undefined,
        gender: draft.gender.trim() || undefined,
      });

      if (!mitoRes.ok) {
        const msg =
          mitoRes.error || "We couldn't save this recipient. Please review the details and try again.";
        setSaveError(msg);
        toast({
          title: "Could not add recipient",
          description: msg,
          variant: "destructive",
        });
        return;
      }

      const createdContact = upsertRecipient({
        id: mitoRes.beneficiaryId || undefined,
        uniqueCode,
        email: resolvedEmail,
        contactType: draft.recipientType,
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        businessName: draft.businessName.trim(),
        country,
        countryCode: dialCode,
        phone: cleanMobile,
        dob: draft.dob.trim(),
        currency,
        bankName: draft.bankName.trim(),
        accountNumber:
          collectionMethod === "mobile_money"
            ? fullMobile || cleanMobile
            : cleanAcct || cleanIban || "—",
        sortCode: cleanSortCode,
        iban: cleanIban,
        swift: cleanSwift,
        serviceType: serviceTypeLabel,
        narration: draft.narration.trim(),
        relationship: draft.relationship.trim() || "Personal",
      });

      const resolvedSavedId = mitoRes.beneficiaryId || createdContact.id;

      saveExtendedBeneficiaryMeta([resolvedSavedId, createdContact.id, uniqueCode], {
        nickName: draft.nickName.trim(),
        relationship: draft.relationship.trim(),
        relationId: draft.relationId,
        otherRelationship: draft.otherRelationship.trim(),
        reason: draft.reason.trim(),
        reasonId: draft.reasonId,
        otherReason: draft.otherReason.trim(),
        narration: draft.narration.trim(),
        mobileNo: fullMobile || cleanMobile,
        address: draft.address.trim(),
        addressLine2: draft.addressLine2.trim(),
        city: draft.city.trim(),
        stateOrProvince: draft.stateOrProvince.trim(),
        postcode: draft.postcode.trim(),
        dob: draft.dob.trim(),
        gender: draft.gender.trim(),
        providerId: draft.providerId,
        providerCode: draft.providerCode,
        isInternational: draft.isInternational,
        accountHolderName: draft.accountHolderName.trim(),
        aba: draft.aba.replace(/\s+/g, "").trim(),
        ifsc: draft.ifsc.replace(/\s+/g, "").trim(),
        bsbCode: draft.bsbCode.replace(/\s+/g, "").trim(),
        branchCode: draft.branchCode.replace(/\s+/g, "").trim(),
        bankCode: draft.bankCode.replace(/\s+/g, "").trim(),
        clabe: draft.clabe.replace(/\s+/g, "").trim(),
        cnaps: draft.cnaps.replace(/\s+/g, "").trim(),
      });

      toast({
        title: "Recipient added",
        description: `${fullName} has been added to your recipients.`,
      });

      setSavedSummary({
        savedId: resolvedSavedId,
        uniqueCode: createdContact.uniqueCode || uniqueCode,
        fullName,
        bankOrOperator: draft.bankName.trim(),
        currency,
        country,
      });
      setStage(4);
    } finally {
      setSaving(false);
    }
  };

  const handleResetForAnother = () => {
    setCountry("Nigeria");
    setCollectionMethod("bank_deposit");
    setDraft(createEmptyBeneficiaryDraft("individual"));
    setErrors({});
    setSaveError(null);
    setSavedSummary(null);
    setSkippedProviderPicker(false);
    setStage2SubView("provider");
    bankVerification.reset();
    setStage(1);
  };

  const handleCopySavedRef = async (refText: string) => {
    try {
      await navigator.clipboard.writeText(refText);
    } catch {
      // clipboard unavailable in non-secure context
    }
    toast({
      title: "Reference copied",
      description: `${refText} copied to clipboard.`,
    });
  };

  const canStage2Continue =
    nicknameValidation.status !== "checking" &&
    !nicknameValidation.isBlocking &&
    (collectionMethod === "mobile_money" || bankVerification.canContinue);

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6 pb-12" data-testid="page-add-beneficiary">
        {/* Progress Stepper (Stages 1–3) */}
        {stage < 4 && (
          <div
            className="flex items-center justify-between gap-2 rounded-xl border border-[#efefee] bg-slate-50/70 px-4 py-3"
            data-testid="beneficiary-wizard-stepper"
          >
            {WIZARD_STEPS.map((step, idx) => {
              const isCompleted = stage > step.id;
              const isCurrent = stage === step.id;
              return (
                <div key={step.id} className="flex items-center gap-2 flex-1 last:flex-none">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={cn(
                        "w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center shrink-0 transition-colors",
                        isCompleted
                          ? "bg-[#0E7A0D] text-white"
                          : isCurrent
                            ? "bg-[#2e5bff] text-white"
                            : "bg-slate-200 text-[#605E5C]",
                      )}
                    >
                      {isCompleted ? <Check className="w-3.5 h-3.5" /> : step.id}
                    </span>
                    <span
                      className={cn(
                        "text-xs sm:text-sm truncate",
                        isCurrent
                          ? "font-semibold text-[#111827]"
                          : isCompleted
                            ? "font-medium text-[#323130]"
                            : "text-[#605E5C]",
                      )}
                    >
                      {step.label.replace(/^\d+\.\s*/, "")}
                    </span>
                  </div>
                  {idx < WIZARD_STEPS.length - 1 && (
                    <div
                      className={cn(
                        "h-px flex-1 mx-1 sm:mx-2",
                        stage > step.id ? "bg-[#0E7A0D]" : "bg-slate-200",
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* STAGE 1: SELECT SERVICE */}
        {stage === 1 && (
          <div className="space-y-6" data-testid="beneficiary-stage-1">
            <div>
              <button
                type="button"
                data-testid="button-back-to-recipients"
                onClick={() => setLocation("/senders-recipients?tab=recipients")}
                className="inline-flex items-center gap-2 text-sm font-medium text-[#323130] hover:text-[#2e5bff] transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to recipients</span>
              </button>
            </div>

            <div className="space-y-1">
              <h1 className="font-display text-2xl font-bold text-[#111827]">Add recipient</h1>
              <p className="text-sm text-[#605E5C]">
                Choose the destination country, payout currency, and collection method.
              </p>
            </div>

            <Card className="rounded-xl border border-[#efefee] bg-white shadow-[-2px_4px_16px_0px_rgba(0,0,0,0.04)]">
              <CardContent className="p-5 sm:p-6 space-y-5">
                {/* Service */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-[#323130]">
                    Service <span className="text-red-500">*</span>
                  </Label>
                  <div
                    data-testid="field-service-money-transfer"
                    className="flex items-center justify-between rounded-xl border border-[#2e5bff] bg-[#ECF5FF] px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#2e5bff] text-white flex items-center justify-center shrink-0">
                        <Send className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[#111827]">Money transfer</p>
                        <p className="text-xs text-[#605E5C]">
                          International and local payouts
                        </p>
                      </div>
                    </div>
                    <Check className="w-4 h-4 text-[#2e5bff] shrink-0" />
                  </div>
                </div>

                {/* Country + Derived Currency */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2 space-y-2">
                    <Label className="text-sm font-medium text-[#323130]">
                      Country <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={country}
                      onValueChange={(val) => {
                        setStage1Error(null);
                        setCountry(val);
                        setDraft((prev) => ({
                          ...prev,
                          providerId: "",
                          providerCode: "",
                          bankName: "",
                          isInternational: false,
                          stateOrProvince: "",
                        }));
                        bankVerification.reset();
                      }}
                    >
                      <SelectTrigger data-testid="select-beneficiary-country" className="h-11">
                        <SelectValue placeholder="Select country" />
                      </SelectTrigger>
                      <SelectContent>
                        {countries.map((c) => (
                          <SelectItem key={c.code} value={c.name}>
                            <span className="inline-flex items-center gap-2">
                              <img
                                src={`https://flagcdn.com/w20/${c.code.toLowerCase()}.png`}
                                alt={c.name}
                                className="w-4 h-3 object-cover rounded-[2px]"
                              />
                              <span>{c.name}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-[#323130]">Currency</Label>
                    <div
                      data-testid="display-beneficiary-currency"
                      className="h-11 px-3.5 rounded-md border border-[#efefee] bg-slate-50 flex items-center gap-2 text-sm font-semibold text-[#111827]"
                    >
                      <img
                        src={`https://flagcdn.com/w20/${receiveFlag}.png`}
                        alt={currency}
                        className="w-4 h-3 object-cover rounded-[2px] shrink-0"
                      />
                      <span>{currency}</span>
                    </div>
                  </div>
                </div>

                {/* Collection method */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-[#323130]">
                    Collection method <span className="text-red-500">*</span>
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      data-testid="card-collection-bank-deposit"
                      onClick={() => {
                        setCollectionMethod("bank_deposit");
                        setDraft((prev) => ({
                          ...prev,
                          providerId: "",
                          providerCode: "",
                          bankName: "",
                        }));
                        bankVerification.reset();
                      }}
                      className={cn(
                        "flex items-start gap-3 rounded-xl border p-4 text-left transition-all cursor-pointer",
                        collectionMethod === "bank_deposit"
                          ? "border-[#2e5bff] bg-[#ECF5FF] ring-1 ring-[#2e5bff]/20"
                          : "border-[#efefee] bg-white hover:bg-slate-50",
                      )}
                    >
                      <div
                        className={cn(
                          "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                          collectionMethod === "bank_deposit"
                            ? "bg-[#2e5bff] text-white"
                            : "bg-[#ECF5FF] text-[#2e5bff]",
                        )}
                      >
                        <Landmark className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-[#111827]">
                            Bank deposit
                          </span>
                          {collectionMethod === "bank_deposit" && (
                            <Check className="w-4 h-4 text-[#2e5bff] shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-[#605E5C] mt-0.5">
                          Direct to local bank or Swift
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      data-testid="card-collection-mobile-money"
                      onClick={() => {
                        setCollectionMethod("mobile_money");
                        setDraft((prev) => ({
                          ...prev,
                          providerId: "",
                          providerCode: "",
                          bankName: "",
                          isInternational: false,
                        }));
                        bankVerification.reset();
                      }}
                      className={cn(
                        "flex items-start gap-3 rounded-xl border p-4 text-left transition-all cursor-pointer",
                        collectionMethod === "mobile_money"
                          ? "border-[#2e5bff] bg-[#ECF5FF] ring-1 ring-[#2e5bff]/20"
                          : "border-[#efefee] bg-white hover:bg-slate-50",
                      )}
                    >
                      <div
                        className={cn(
                          "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                          collectionMethod === "mobile_money"
                            ? "bg-[#2e5bff] text-white"
                            : "bg-[#ECF5FF] text-[#2e5bff]",
                        )}
                      >
                        <Smartphone className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-[#111827]">
                            Mobile money
                          </span>
                          {collectionMethod === "mobile_money" && (
                            <Check className="w-4 h-4 text-[#2e5bff] shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-[#605E5C] mt-0.5">
                          Instant payout to mobile wallet
                        </p>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Recipient type */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-[#323130]">
                    Recipient type <span className="text-red-500">*</span>
                  </Label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      data-testid="card-entity-individual"
                      onClick={() =>
                        setDraft((prev) => ({ ...prev, recipientType: "individual" }))
                      }
                      className={cn(
                        "flex items-center justify-center gap-2 rounded-xl border py-3 px-4 text-sm font-semibold transition-all cursor-pointer",
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
                      data-testid="card-entity-business"
                      onClick={() =>
                        setDraft((prev) => ({ ...prev, recipientType: "business" }))
                      }
                      className={cn(
                        "flex items-center justify-center gap-2 rounded-xl border py-3 px-4 text-sm font-semibold transition-all cursor-pointer",
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

                {stage1Error && (
                  <p role="alert" className="text-xs text-red-600">
                    {stage1Error}
                  </p>
                )}

                <Button
                  type="button"
                  disabled={stage1Loading}
                  data-testid="button-stage1-continue"
                  onClick={() => void handleStage1Continue()}
                  className="w-full h-11 rounded-full bg-[#2e5bff] hover:bg-blue-700 text-white font-semibold shadow-none inline-flex items-center justify-center gap-2"
                >
                  {stage1Loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Loading options...</span>
                    </>
                  ) : (
                    <>
                      <span>Continue</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* STAGE 2A: PROVIDER PICKER */}
        {stage === 2 && stage2SubView === "provider" && (
          <div className="space-y-6" data-testid="beneficiary-stage-2-provider">
            <DeliveryAndProviderPicker
              service={collectionMethod}
              localProviders={localProviders}
              internationalProviders={internationalProviders}
              loading={stage1Loading}
              isInternational={draft.isInternational}
              onChangeInternational={(intl) => {
                bankVerification.reset();
                setDraft((prev) => ({
                  ...prev,
                  isInternational: intl,
                  providerId: "",
                  providerCode: "",
                  bankName: "",
                  accountHolderName: "",
                }));
              }}
              selectedProviderId={draft.providerId || null}
              onSelectProvider={(prov) => {
                bankVerification.reset();
                setDraft((prev) => ({
                  ...prev,
                  providerId: prov.providerId,
                  providerCode: prov.providerCode,
                  bankName: prov.providerName,
                  isInternational: Boolean(prov.isInternational),
                  accountHolderName: "",
                }));
                setStage2SubView("details");
              }}
              sendCurrency="GBP"
              receiveCurrency={currency}
              sendFlagCode="gb"
              receiveFlagCode={receiveFlag}
              displayRate={corridorRate}
              onBack={() => setStage(1)}
              backLabel="Back"
            />
          </div>
        )}

        {/* STAGE 2B: RECIPIENT & BANKING DETAILS */}
        {stage === 2 && stage2SubView === "details" && (
          <div className="space-y-6" data-testid="beneficiary-stage-2-details">
            <div>
              <button
                type="button"
                data-testid="button-stage2-back"
                onClick={() => {
                  if (skippedProviderPicker) {
                    setStage(1);
                  } else {
                    setStage2SubView("provider");
                  }
                }}
                className="inline-flex items-center gap-2 text-sm font-medium text-[#323130] hover:text-[#2e5bff] transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{skippedProviderPicker ? "Back" : "Back to banks"}</span>
              </button>
            </div>

            <div className="space-y-1">
              <h1 className="font-display text-2xl font-bold text-[#111827]">
                Recipient &amp; account details
              </h1>
              <p className="text-sm text-[#605E5C]">
                Enter the recipient&apos;s details for {country} ({currency}).
              </p>
            </div>

            <BeneficiaryDetailsFormSection
              country={country}
              currency={currency}
              collectionMethod={collectionMethod}
              draft={draft}
              onChangeDraft={setDraft}
              onBankingFieldEdited={() => bankVerification.reset()}
              personalFields={personalFields}
              bankingFields={bankingFields}
              relationships={relationships}
              reasons={reasons}
              provinces={provinces}
              nicknameValidation={nicknameValidation}
              bankVerificationStatus={bankVerification.status}
              bankVerificationResult={bankVerification.result}
              onSearchBankDetails={() => void handleSearchBankDetails()}
              onChangeProvider={
                skippedProviderPicker ? undefined : () => setStage2SubView("provider")
              }
              errors={errors}
              onClearError={clearError}
            />

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                type="button"
                disabled={!canStage2Continue}
                data-testid="button-stage2-continue"
                onClick={handleStage2Continue}
                className="w-full sm:w-auto sm:min-w-[200px] h-11 rounded-full bg-[#2e5bff] hover:bg-blue-700 text-white font-semibold shadow-none inline-flex items-center justify-center gap-2"
              >
                <span>Continue</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* STAGE 3: SUMMARY */}
        {stage === 3 && (
          <div className="space-y-6" data-testid="beneficiary-stage-3-summary">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                data-testid="button-stage3-back"
                onClick={() => {
                  setStage(2);
                  setStage2SubView("details");
                }}
                className="inline-flex items-center gap-2 text-sm font-medium text-[#323130] hover:text-[#2e5bff] transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>

              <button
                type="button"
                data-testid="button-stage3-change-service"
                onClick={() => setStage(1)}
                className="text-xs font-semibold text-[#2e5bff] hover:underline cursor-pointer"
              >
                Change country or service
              </button>
            </div>

            <div className="space-y-1">
              <h1 className="font-display text-2xl font-bold text-[#111827]">
                Review recipient details
              </h1>
              <p className="text-sm text-[#605E5C]">
                Confirm everything looks right before saving this recipient.
              </p>
            </div>

            <BeneficiaryReviewSummary
              bannerText="Please review the details carefully before saving."
              recipientSummary={{
                fullName,
                entityType: draft.recipientType,
                country,
                relationship: draft.relationship,
                otherRelationship: draft.otherRelationship,
                reason: draft.reason,
                otherReason: draft.otherReason,
                narration: draft.narration,
                nickName: draft.nickName,
                mobileNo: draft.mobileNo
                  ? draft.mobileNo.startsWith("+")
                    ? draft.mobileNo
                    : `${countryDialCode(country)} ${draft.mobileNo}`
                  : undefined,
                email: draft.email.trim() || undefined,
                address: draft.address,
                addressLine2: draft.addressLine2,
                city: draft.city,
                stateOrProvince: draft.stateOrProvince,
                postcode: draft.postcode,
                dob: draft.dob,
                gender: draft.gender,
                onEdit: () => {
                  setStage(2);
                  setStage2SubView("details");
                },
              }}
              bankingSummary={{
                service: collectionMethod,
                isInternational: draft.isInternational,
                bankOrOperatorName: draft.bankName,
                accountHolderName: draft.accountHolderName || undefined,
                accountNumber: draft.accountNumber,
                sortCode: draft.sortCode,
                iban: draft.iban,
                swift: draft.swift,
                aba: draft.aba,
                ifsc: draft.ifsc,
                bsbCode: draft.bsbCode,
                branchCode: draft.branchCode,
                bankCode: draft.bankCode,
                clabe: draft.clabe,
                cnaps: draft.cnaps,
                mobileNo: draft.mobileNo
                  ? draft.mobileNo.startsWith("+")
                    ? draft.mobileNo
                    : `${countryDialCode(country)} ${draft.mobileNo}`
                  : undefined,
                onEdit: () => {
                  setStage(2);
                  setStage2SubView("details");
                },
              }}
              showTermsNotice={true}
            />

            {saveError && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
              >
                <p className="font-semibold">Unable to save recipient</p>
                <p className="text-xs text-red-800 mt-1">{saveError}</p>
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStage(2);
                  setStage2SubView("details");
                }}
                className="w-full sm:w-auto h-11 rounded-full px-6 border-[#d2d0ce]"
              >
                Back
              </Button>
              <Button
                type="button"
                disabled={saving}
                data-testid="button-save-beneficiary"
                onClick={() => void handleSaveBeneficiary()}
                className="w-full sm:w-auto sm:min-w-[200px] h-11 rounded-full bg-[#2e5bff] hover:bg-blue-700 text-white font-semibold shadow-none inline-flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>Save</span>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* STAGE 4: RECIPIENT ADDED SUCCESSFULLY */}
        {stage === 4 && savedSummary && (
          <Card
            data-testid="card-beneficiary-added-success"
            className="rounded-2xl border border-[#efefee] bg-white shadow-[-2px_4px_16px_0px_rgba(0,0,0,0.05)] overflow-hidden"
          >
            <CardContent className="p-6 sm:p-8 text-center space-y-6">
              <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-[#0E7A0D]" />
              </div>

              <div className="space-y-2">
                <h1 className="font-display text-2xl font-bold text-[#111827]">
                  Recipient added successfully
                </h1>
                <p className="text-sm text-[#605E5C]">
                  <span className="font-semibold text-[#111827]">{savedSummary.fullName}</span> is
                  now saved and ready for transfers.
                </p>
              </div>

              <div className="rounded-xl border border-[#cce3ff] bg-[#ECF5FF] p-4 max-w-md mx-auto space-y-2.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#605E5C]">Recipient</span>
                  <span className="font-semibold text-[#111827]">{savedSummary.fullName}</span>
                </div>
                {savedSummary.bankOrOperator && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[#605E5C]">
                      {collectionMethod === "mobile_money" ? "Mobile operator" : "Bank"}
                    </span>
                    <span className="font-medium text-[#111827]">
                      {savedSummary.bankOrOperator}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#605E5C]">Corridor</span>
                  <span className="font-medium text-[#111827]">
                    {savedSummary.country} ({savedSummary.currency})
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 pt-1.5 border-t border-[#cce3ff]">
                  <span className="text-[#605E5C]">Reference</span>
                  <button
                    type="button"
                    data-testid="button-copy-saved-ref"
                    onClick={() => void handleCopySavedRef(`REF/${savedSummary.uniqueCode}`)}
                    className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-[#2e5bff] bg-white px-2.5 py-1 rounded-md border border-[#cce3ff] hover:bg-slate-50 cursor-pointer"
                  >
                    <span>REF/{savedSummary.uniqueCode}</span>
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                <Button
                  type="button"
                  data-testid="button-success-send-money"
                  onClick={() =>
                    setLocation(
                      `/send-money?currency=${encodeURIComponent(savedSummary.currency)}&recipientId=${encodeURIComponent(savedSummary.savedId)}`,
                    )
                  }
                  className="w-full sm:w-auto h-11 px-6 rounded-full bg-[#2e5bff] hover:bg-blue-700 text-white font-semibold shadow-none inline-flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  <span>Send money</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  data-testid="button-success-add-another"
                  onClick={handleResetForAnother}
                  className="w-full sm:w-auto h-11 px-6 rounded-full border-[#2e5bff] text-[#2e5bff] hover:bg-[#ECF5FF] font-semibold inline-flex items-center justify-center gap-2"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Add another recipient</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  data-testid="button-success-done"
                  onClick={() => setLocation("/senders-recipients?tab=recipients")}
                  className="w-full sm:w-auto h-11 px-6 rounded-full border-[#d2d0ce] text-[#323130] font-semibold"
                >
                  Done
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
