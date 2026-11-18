import { CheckCircle2, Info, Pencil, Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface BeneficiaryReviewSummaryProps {
  bannerText?: string;
  amountSummary?: {
    sendCurrency: string;
    sendSymbol: string;
    receiveCurrency: string;
    receiveSymbol: string;
    youSend: string;
    fee: string;
    exchangeRate: string;
    totalToPay: string;
    recipientGets: string;
    promoLabel?: string | null;
    promoValue?: string | null;
    bonusLabel?: string | null;
    bonusValue?: string | null;
    onEdit?: () => void;
  };
  recipientSummary: {
    fullName: string;
    entityType: "individual" | "business";
    country: string;
    relationship?: string;
    otherRelationship?: string;
    reason?: string;
    otherReason?: string;
    narration?: string;
    nickName?: string;
    mobileNo?: string;
    email?: string;
    address?: string;
    addressLine2?: string;
    city?: string;
    stateOrProvince?: string;
    postcode?: string;
    dob?: string;
    gender?: string;
    onEdit?: () => void;
  };
  bankingSummary: {
    service: "bank_deposit" | "mobile_money" | "cash_pickup";
    isInternational?: boolean;
    bankOrOperatorName?: string;
    accountHolderName?: string;
    accountNumber?: string;
    sortCode?: string;
    iban?: string;
    swift?: string;
    aba?: string;
    ifsc?: string;
    bsbCode?: string;
    branchCode?: string;
    bankCode?: string;
    clabe?: string;
    cnaps?: string;
    mobileNo?: string;
    onEdit?: () => void;
  };
  showTermsNotice?: boolean;
}

function DetailRow({
  label,
  value,
  mono = false,
  verified = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  verified?: boolean;
}) {
  const clean = String(value || "").trim();
  if (!clean) return null;
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-[#605E5C] shrink-0">{label}</span>
      <span
        className={`text-right font-medium text-[#111827] break-all ${
          mono ? "font-mono tabular-nums" : ""
        } ${verified ? "inline-flex items-center gap-1.5 text-[#0E7A0D] font-semibold" : ""}`}
      >
        {verified && <CheckCircle2 className="w-3.5 h-3.5 text-[#0E7A0D] shrink-0" />}
        <span>{clean}</span>
      </span>
    </div>
  );
}

export function BeneficiaryReviewSummary({
  bannerText = "Please review the details carefully before continuing.",
  amountSummary,
  recipientSummary,
  bankingSummary,
  showTermsNotice = true,
}: BeneficiaryReviewSummaryProps) {
  const formattedAddress = [
    recipientSummary.address,
    recipientSummary.addressLine2,
    recipientSummary.city,
    recipientSummary.stateOrProvince,
    recipientSummary.postcode,
  ]
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .join(", ");

  const relationshipDisplay =
    recipientSummary.otherRelationship?.trim()
      ? `${recipientSummary.relationship || "Other"} (${recipientSummary.otherRelationship.trim()})`
      : recipientSummary.relationship;

  const reasonDisplay =
    recipientSummary.otherReason?.trim()
      ? `${recipientSummary.reason || "Other"} (${recipientSummary.otherReason.trim()})`
      : recipientSummary.reason;

  const deliveryMethodLabel =
    bankingSummary.service === "mobile_money"
      ? "Mobile money"
      : bankingSummary.service === "cash_pickup"
        ? "Cash pickup"
        : bankingSummary.isInternational
          ? "Swift"
          : "Direct to bank";

  return (
    <div className="space-y-5" data-testid="beneficiary-review-summary">
      {/* Review Callout Banner */}
      <div
        data-testid="banner-review-summary"
        className="rounded-xl border border-[#cce3ff] bg-[#ECF5FF] px-4 py-3.5 flex items-start gap-3 text-sm text-[#1e3a5f]"
      >
        <Info className="w-4 h-4 text-[#2e5bff] shrink-0 mt-0.5" />
        <p className="font-medium leading-relaxed">{bannerText}</p>
      </div>

      {/* Optional Transfer Amount Card (Step 4 of Send Money) */}
      {amountSummary && (
        <Card
          data-testid="summary-card-amount"
          className="rounded-xl border border-[#efefee] bg-white shadow-[-2px_4px_16px_0px_rgba(0,0,0,0.04)]"
        >
          <CardHeader className="pb-3 pt-4 px-5 flex flex-row items-center justify-between space-y-0 border-b border-[#efefee]">
            <CardTitle className="text-base font-semibold text-[#323130]">
              Amount
            </CardTitle>
            {amountSummary.onEdit && (
              <button
                type="button"
                data-testid="button-edit-step-amount"
                onClick={amountSummary.onEdit}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2e5bff] hover:underline cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Edit</span>
              </button>
            )}
          </CardHeader>
          <CardContent className="px-5 py-3.5 divide-y divide-[#f5f5f4] text-sm">
            <div className="flex items-center justify-between py-1.5">
              <span className="text-[#605E5C]">You send</span>
              <span className="font-medium text-[#111827] tabular-nums">
                {amountSummary.sendSymbol}
                {amountSummary.youSend} {amountSummary.sendCurrency}
              </span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-[#605E5C]">Transfer fee</span>
              <span className="font-medium text-[#111827] tabular-nums">
                {amountSummary.sendSymbol}
                {amountSummary.fee} {amountSummary.sendCurrency}
              </span>
            </div>
            {amountSummary.promoLabel && amountSummary.promoValue && (
              <div className="flex items-center justify-between py-1.5 text-[#0E7A0D] font-medium">
                <span>{amountSummary.promoLabel}</span>
                <span className="tabular-nums">{amountSummary.promoValue}</span>
              </div>
            )}
            {amountSummary.bonusLabel && amountSummary.bonusValue && (
              <div className="flex items-center justify-between py-1.5 text-teal-700 font-medium">
                <span>{amountSummary.bonusLabel}</span>
                <span className="tabular-nums">{amountSummary.bonusValue}</span>
              </div>
            )}
            <div className="flex items-center justify-between py-1.5">
              <span className="text-[#605E5C]">Exchange rate</span>
              <span className="font-medium text-[#111827] tabular-nums">
                {amountSummary.sendSymbol}1 = {amountSummary.receiveSymbol}
                {amountSummary.exchangeRate}
              </span>
            </div>
            <div className="flex items-center justify-between py-2 font-semibold">
              <span className="text-[#111827]">Total to pay</span>
              <span className="text-base font-bold text-[#111827] tabular-nums">
                {amountSummary.sendSymbol}
                {amountSummary.totalToPay} {amountSummary.sendCurrency}
              </span>
            </div>
            <div className="flex items-center justify-between py-2 font-semibold">
              <span className="text-[#605E5C]">Recipient gets</span>
              <span className="text-base font-bold text-[#2e5bff] tabular-nums">
                {amountSummary.receiveSymbol}
                {amountSummary.recipientGets} {amountSummary.receiveCurrency}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recipient Details Card */}
      <Card
        data-testid="summary-card-recipient"
        className="rounded-xl border border-[#efefee] bg-white shadow-[-2px_4px_16px_0px_rgba(0,0,0,0.04)]"
      >
        <CardHeader className="pb-3 pt-4 px-5 flex flex-row items-center justify-between space-y-0 border-b border-[#efefee]">
          <CardTitle className="text-base font-semibold text-[#323130]">
            Recipient details
          </CardTitle>
          {recipientSummary.onEdit && (
            <button
              type="button"
              data-testid="button-edit-step-recipient"
              onClick={recipientSummary.onEdit}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2e5bff] hover:underline cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>Edit</span>
            </button>
          )}
        </CardHeader>
        <CardContent className="px-5 py-3.5 divide-y divide-[#f5f5f4]">
          <DetailRow label="Recipient name" value={recipientSummary.fullName} />
          <DetailRow
            label="Recipient type"
            value={recipientSummary.entityType === "business" ? "Business" : "Individual"}
          />
          <DetailRow label="Country" value={recipientSummary.country} />
          <DetailRow label="Relationship" value={relationshipDisplay} />
          <DetailRow label="Reason for transfer" value={reasonDisplay} />
          <DetailRow label="Mobile number" value={recipientSummary.mobileNo} mono />
          <DetailRow label="Email address" value={recipientSummary.email} />
          <DetailRow label="Address" value={formattedAddress} />
          <DetailRow label="Date of birth" value={recipientSummary.dob} />
          <DetailRow label="Gender" value={recipientSummary.gender} />
          <DetailRow label="Narration" value={recipientSummary.narration} />
          <DetailRow label="Nickname" value={recipientSummary.nickName} />
        </CardContent>
      </Card>

      {/* Banking / Mobile Money Details Card */}
      <Card
        data-testid="summary-card-banking"
        className="rounded-xl border border-[#efefee] bg-white shadow-[-2px_4px_16px_0px_rgba(0,0,0,0.04)]"
      >
        <CardHeader className="pb-3 pt-4 px-5 flex flex-row items-center justify-between space-y-0 border-b border-[#efefee]">
          <CardTitle className="text-base font-semibold text-[#323130]">
            {bankingSummary.service === "mobile_money"
              ? "Mobile money details"
              : "Banking details"}
          </CardTitle>
          {bankingSummary.onEdit && (
            <button
              type="button"
              data-testid="button-edit-step-bank"
              onClick={bankingSummary.onEdit}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2e5bff] hover:underline cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>Edit</span>
            </button>
          )}
        </CardHeader>
        <CardContent className="px-5 py-3.5 divide-y divide-[#f5f5f4]">
          <DetailRow label="Delivery method" value={deliveryMethodLabel} />
          <DetailRow
            label={bankingSummary.service === "mobile_money" ? "Mobile operator" : "Bank name"}
            value={bankingSummary.bankOrOperatorName}
          />
          <DetailRow
            label="Account holder name"
            value={bankingSummary.accountHolderName}
            verified={Boolean(bankingSummary.accountHolderName)}
          />
          {bankingSummary.service === "mobile_money" ? (
            <DetailRow
              label="Mobile number"
              value={bankingSummary.mobileNo || bankingSummary.accountNumber}
              mono
            />
          ) : (
            <>
              <DetailRow label="Account number" value={bankingSummary.accountNumber} mono />
              <DetailRow label="Sort code" value={bankingSummary.sortCode} mono />
              <DetailRow label="IBAN" value={bankingSummary.iban} mono />
              <DetailRow label="SWIFT / BIC" value={bankingSummary.swift} mono />
              <DetailRow label="ABA routing number" value={bankingSummary.aba} mono />
              <DetailRow label="IFSC code" value={bankingSummary.ifsc} mono />
              <DetailRow label="BSB code" value={bankingSummary.bsbCode} mono />
              <DetailRow label="Branch code" value={bankingSummary.branchCode} mono />
              <DetailRow label="Bank code" value={bankingSummary.bankCode} mono />
              <DetailRow label="CLABE" value={bankingSummary.clabe} mono />
              <DetailRow label="CNAPS code" value={bankingSummary.cnaps} mono />
            </>
          )}
        </CardContent>
      </Card>

      {showTermsNotice && (
        <div className="rounded-xl border border-[#efefee] bg-slate-50 px-4 py-3 flex items-start gap-2.5 text-xs text-[#605E5C]">
          <Shield className="w-4 h-4 text-[#2e5bff] shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            By continuing, you confirm that the recipient and account details above are accurate and agree to Rhemito&apos;s Terms of use and Privacy policy.
          </p>
        </div>
      )}
    </div>
  );
}
