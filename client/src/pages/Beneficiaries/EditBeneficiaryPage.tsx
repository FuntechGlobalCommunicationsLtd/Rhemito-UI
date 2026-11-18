import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, ArrowRight, Loader2, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  resolveMergedBeneficiary,
  saveExtendedBeneficiaryMeta,
  useBankVerification,
  useNicknameValidation,
  validateBeneficiaryDraft,
  type BeneficiaryDraftValues,
} from "@/components/beneficiary";
import { useContacts } from "@/contexts/ContactsContext";
import { useToast } from "@/hooks/use-toast";
import {
  fetchMitoAffiliateRate,
  fetchMitoBeneficiaries,
  fetchMitoBeneficiaryRequirements,
  fetchMitoLookups,
  fetchMitoProvidersDetailed,
  fetchMitoProvinces,
  updateMitoBeneficiaryById,
  type MitoBeneficiaryItem,
  type MitoBeneficiaryRequirementField,
  type MitoLookupTypeOption,
  type MitoProviderOption,
  type MitoProvinceOption,
} from "@/lib/sendMoney";

type EditView = "form" | "provider" | "summary";

function stripDialPrefix(rawMobile: string, dialCode: string): string {
  const clean = String(rawMobile || "").trim();
  if (!clean) return "";
  if (dialCode && clean.startsWith(dialCode)) {
    return clean.slice(dialCode.length).trim();
  }
  return clean;
}

function normalizeBankCompare(val: string): string {
  return String(val || "").replace(/\s+/g, "").trim().toUpperCase();
}

export default function EditBeneficiaryPage() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const rawId = decodeURIComponent(params.id || "").trim();
  const { toast } = useToast();
  const { contacts, upsertRecipient } = useContacts();

  const [mitoBeneficiaries, setMitoBeneficiaries] = useState<MitoBeneficiaryItem[]>([]);
  const [mitoLoading, setMitoLoading] = useState(true);

  const [view, setView] = useState<EditView>("form");
  const [draft, setDraft] = useState<BeneficiaryDraftValues>(() =>
    createEmptyBeneficiaryDraft("individual"),
  );
  const [initialNickname, setInitialNickname] = useState("");
  const [initialBankingSig, setInitialBankingSig] = useState("");
  const initializedForIdRef = useRef<string | null>(null);

  // Corridor providers & lookups
  const [localProviders, setLocalProviders] = useState<MitoProviderOption[]>([]);
  const [internationalProviders, setInternationalProviders] = useState<MitoProviderOption[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [corridorRate, setCorridorRate] = useState<number>(1);
  const [upstreamRequirements, setUpstreamRequirements] = useState<
    MitoBeneficiaryRequirementField[]
  >([]);
  const [relationships, setRelationships] = useState<MitoLookupTypeOption[]>([]);
  const [reasons, setReasons] = useState<MitoLookupTypeOption[]>([]);
  const [provinces, setProvinces] = useState<MitoProvinceOption[]>([]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const nicknameValidation = useNicknameValidation(draft.nickName, initialNickname);
  const bankVerification = useBankVerification();

  useEffect(() => {
    let active = true;
    setMitoLoading(true);
    void fetchMitoBeneficiaries()
      .then((list) => {
        if (!active) return;
        setMitoBeneficiaries(list);
      })
      .finally(() => {
        if (active) setMitoLoading(false);
      });
    return () => {
      active = false;
    };
  }, [rawId]);

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

  const record = useMemo(
    () => resolveMergedBeneficiary(rawId, contacts, mitoBeneficiaries),
    [rawId, contacts, mitoBeneficiaries],
  );

  const computeBankingSignature = (d: BeneficiaryDraftValues): string =>
    [
      normalizeBankCompare(d.providerId),
      normalizeBankCompare(d.bankName),
      d.isInternational ? "INTL" : "LOCAL",
      normalizeBankCompare(d.accountNumber),
      normalizeBankCompare(d.sortCode),
      normalizeBankCompare(d.iban),
      normalizeBankCompare(d.swift),
      normalizeBankCompare(d.aba),
      normalizeBankCompare(d.ifsc),
      normalizeBankCompare(d.bsbCode),
      normalizeBankCompare(d.branchCode),
      normalizeBankCompare(d.bankCode),
      normalizeBankCompare(d.clabe),
      normalizeBankCompare(d.cnaps),
    ].join("|");

  // Populate draft once record loads (and enrich if Mito arrives slightly after local contact)
  useEffect(() => {
    if (!record) return;
    const syncKey = `${record.id}:${mitoLoading ? "pending" : "ready"}`;
    if (initializedForIdRef.current === syncKey) return;
    // Only overwrite user edits on initial hydrate (not after user already started typing unless transitioning from pending -> ready with untouched form)
    if (initializedForIdRef.current && initializedForIdRef.current.startsWith(`${record.id}:`)) {
      return;
    }
    initializedForIdRef.current = syncKey;

    const dial = countryDialCode(record.country);
    const hydrated: BeneficiaryDraftValues = {
      recipientType: record.recipientType,
      firstName: record.firstName,
      lastName: record.lastName,
      businessName: record.businessName,
      relationship: record.relationship || "Personal",
      relationId: record.relationId,
      otherRelationship: record.otherRelationship,
      reason: record.reason,
      reasonId: record.reasonId,
      otherReason: record.otherReason,
      mobileNo: stripDialPrefix(record.mobileNo, dial),
      address: record.address,
      addressLine2: record.addressLine2,
      city: record.city,
      stateOrProvince: record.stateOrProvince,
      postcode: record.postcode,
      dob: record.dob,
      gender: record.gender,
      narration: record.narration,
      email: record.editableEmail,
      nickName: record.nickName,
      providerId: record.providerId,
      providerCode: record.providerCode,
      bankName:
        record.bankName === "Bank transfer" || record.bankName === "Bank Transfer"
          ? ""
          : record.bankName,
      isInternational: record.isInternational,
      accountHolderName: record.accountHolderName,
      accountNumber: record.accountNumber === "—" ? "" : record.accountNumber,
      sortCode: record.sortCode,
      iban: record.iban,
      swift: record.swift,
      aba: record.aba,
      ifsc: record.ifsc,
      bsbCode: record.bsbCode,
      branchCode: record.branchCode,
      bankCode: record.bankCode,
      clabe: record.clabe,
      cnaps: record.cnaps,
    };

    setDraft(hydrated);
    setInitialNickname(record.nickName || "");
    setInitialBankingSig(computeBankingSignature(hydrated));
  }, [record, mitoLoading]);

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

  const country = record?.country || "Nigeria";
  const currency = record?.currency || "NGN";
  const countryIso3 = record?.countryIso3 || countryToIso3(country);
  const collectionMethod = record?.collectionMethod || "bank_deposit";
  const receiveFlag = countryFlagCode(country);

  // Load corridor requirements & provinces
  useEffect(() => {
    if (!record) return;
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
    record,
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

  const bankingFieldsChanged = useMemo(
    () => Boolean(initialBankingSig) && computeBankingSignature(draft) !== initialBankingSig,
    [draft, initialBankingSig],
  );

  const clearError = (key: string) => {
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleOpenProviderPicker = async () => {
    setLoadingProviders(true);
    setView("provider");
    try {
      const [provRes, rateRes] = await Promise.all([
        fetchMitoProvidersDetailed({
          countryIso3,
          currencyCode: currency,
          service: collectionMethod,
        }),
        fetchMitoAffiliateRate("GBP", currency),
      ]);
      setLocalProviders(provRes.local);
      setInternationalProviders(provRes.international);
      const resolvedRate =
        (rateRes?.rate && rateRes.rate > 0 ? rateRes.rate : null) ||
        (rateRes?.partnerRate && rateRes.partnerRate > 0 ? rateRes.partnerRate : null) ||
        STATIC_GBP_FALLBACK_RATES[currency] ||
        1.0;
      setCorridorRate(resolvedRate);
    } finally {
      setLoadingProviders(false);
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

  const requiresBankCheckToContinue =
    collectionMethod === "bank_deposit" && bankingFieldsChanged;

  const canContinueToSummary =
    nicknameValidation.status !== "checking" &&
    !nicknameValidation.isBlocking &&
    (!requiresBankCheckToContinue || bankVerification.canContinue);

  const handleContinueToSummary = () => {
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

    if (requiresBankCheckToContinue && !bankVerification.canContinue) {
      toast({
        title: "Bank check required",
        description:
          "Since banking details changed, please click Search bank details before continuing.",
        variant: "destructive",
      });
      return;
    }

    setErrors({});
    setSaveError(null);
    setView("summary");
  };

  if (!record && mitoLoading) {
    return (
      <DashboardLayout>
        <div
          data-testid="edit-beneficiary-loading"
          className="py-20 flex items-center justify-center gap-2.5 text-sm text-[#605E5C]"
        >
          <Loader2 className="w-5 h-5 text-[#2e5bff] animate-spin" />
          <span>Loading recipient details...</span>
        </div>
      </DashboardLayout>
    );
  }

  if (!record) {
    return (
      <DashboardLayout>
        <div className="max-w-xl mx-auto py-12 space-y-6" data-testid="edit-beneficiary-not-found">
          <div>
            <button
              type="button"
              onClick={() => setLocation("/senders-recipients?tab=recipients")}
              className="inline-flex items-center gap-2 text-sm font-medium text-[#323130] hover:text-[#2e5bff] transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to recipients</span>
            </button>
          </div>

          <Card className="rounded-2xl border border-[#efefee] bg-white shadow-[-2px_4px_16px_0px_rgba(0,0,0,0.04)]">
            <CardContent className="p-8 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto">
                <Users className="w-6 h-6 text-[#605E5C]" />
              </div>
              <div className="space-y-1">
                <h1 className="font-display text-xl font-bold text-[#111827]">
                  Recipient not found
                </h1>
                <p className="text-sm text-[#605E5C]">
                  This recipient could not be found or may have been removed.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation("/senders-recipients?tab=recipients")}
                className="rounded-full px-6"
              >
                Back to recipients
              </Button>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const resolvedId = record.id;
  const fullName =
    draft.recipientType === "business"
      ? draft.businessName.trim()
      : `${draft.firstName.trim()} ${draft.lastName.trim()}`.trim();

  const handleUpdateBeneficiary = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const dialCode = countryDialCode(country);
      const cleanAcct = draft.accountNumber.replace(/\s+/g, "").trim();
      const cleanSortCode = draft.sortCode.replace(/\s+/g, "").trim();
      const cleanIban = draft.iban.replace(/\s+/g, "").trim();
      const cleanSwift = draft.swift.replace(/\s+/g, "").trim();
      const cleanMobile = draft.mobileNo.replace(/\s+/g, "").trim();
      const fullMobile = cleanMobile
        ? cleanMobile.startsWith("+")
          ? cleanMobile
          : `${dialCode}${cleanMobile.replace(/^0+/, "")}`
        : "";

      const serviceTypeLabel =
        collectionMethod === "mobile_money"
          ? "Mobile Money"
          : draft.isInternational
            ? "SWIFT"
            : "Bank Deposit";

      const resolvedEmail =
        draft.email.trim() ||
        record.rawEmail ||
        `recipient-${record.uniqueCode}@beneficiary.rhemito.local`;

      await updateMitoBeneficiaryById(record.mitoId || resolvedId, {
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

      upsertRecipient({
        id: resolvedId,
        originalId: record.contactId || resolvedId,
        originalEmail: record.rawEmail || undefined,
        uniqueCode: record.uniqueCode,
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

      saveExtendedBeneficiaryMeta([resolvedId, record.mitoId, record.contactId, record.uniqueCode], {
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
        title: "Recipient updated",
        description: `${fullName} has been updated.`,
      });

      setLocation(`/beneficiaries/${encodeURIComponent(resolvedId)}`);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "We couldn't update this recipient. Please try again.";
      setSaveError(msg);
      toast({
        title: "Could not update recipient",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6 pb-12" data-testid="page-edit-beneficiary">
        {view === "provider" && (
          <DeliveryAndProviderPicker
            service={collectionMethod}
            localProviders={localProviders}
            internationalProviders={internationalProviders}
            loading={loadingProviders}
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
              setView("form");
            }}
            sendCurrency="GBP"
            receiveCurrency={currency}
            sendFlagCode="gb"
            receiveFlagCode={receiveFlag}
            displayRate={corridorRate}
            onBack={() => setView("form")}
            backLabel="Back to edit"
          />
        )}

        {view === "form" && (
          <div className="space-y-6">
            <div>
              <button
                type="button"
                data-testid="button-back-to-detail"
                onClick={() => setLocation(`/beneficiaries/${encodeURIComponent(resolvedId)}`)}
                className="inline-flex items-center gap-2 text-sm font-medium text-[#323130] hover:text-[#2e5bff] transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to recipient</span>
              </button>
            </div>

            <div className="space-y-1">
              <h1 className="font-display text-2xl font-bold text-[#111827]">Edit recipient</h1>
              <p className="text-sm text-[#605E5C]">
                Update personal or account details for {record.fullName} ({country} · {currency}).
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
              onChangeProvider={() => void handleOpenProviderPicker()}
              errors={errors}
              onClearError={clearError}
            />

            <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation(`/beneficiaries/${encodeURIComponent(resolvedId)}`)}
                className="w-full sm:w-auto h-11 rounded-full px-6 border-[#d2d0ce]"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!canContinueToSummary}
                data-testid="button-edit-continue"
                onClick={handleContinueToSummary}
                className="w-full sm:w-auto sm:min-w-[200px] h-11 rounded-full bg-[#2e5bff] hover:bg-blue-700 text-white font-semibold shadow-none inline-flex items-center justify-center gap-2"
              >
                <span>Continue</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {view === "summary" && (
          <div className="space-y-6" data-testid="edit-beneficiary-summary">
            <div>
              <button
                type="button"
                data-testid="button-back-to-edit-form"
                onClick={() => setView("form")}
                className="inline-flex items-center gap-2 text-sm font-medium text-[#323130] hover:text-[#2e5bff] transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to edit</span>
              </button>
            </div>

            <div className="space-y-1">
              <h1 className="font-display text-2xl font-bold text-[#111827]">Review changes</h1>
              <p className="text-sm text-[#605E5C]">
                Confirm the updated recipient details before saving.
              </p>
            </div>

            <BeneficiaryReviewSummary
              bannerText="Please review your changes carefully before saving."
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
                onEdit: () => setView("form"),
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
                onEdit: () => setView("form"),
              }}
              showTermsNotice={true}
            />

            {saveError && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
              >
                <p className="font-semibold">Unable to update recipient</p>
                <p className="text-xs text-red-800 mt-1">{saveError}</p>
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setView("form")}
                className="w-full sm:w-auto h-11 rounded-full px-6 border-[#d2d0ce]"
              >
                Back
              </Button>
              <Button
                type="button"
                disabled={saving}
                data-testid="button-update-beneficiary"
                onClick={() => void handleUpdateBeneficiary()}
                className="w-full sm:w-auto sm:min-w-[200px] h-11 rounded-full bg-[#2e5bff] hover:bg-blue-700 text-white font-semibold shadow-none inline-flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving changes...</span>
                  </>
                ) : (
                  <span>Save changes</span>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
