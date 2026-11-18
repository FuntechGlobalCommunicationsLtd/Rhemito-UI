import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { MitoBankVerificationClientResult } from "@/lib/sendMoney";
import type { BankVerificationStatus } from "./useBankVerification";

export interface BankVerificationCardProps {
  status: BankVerificationStatus;
  result: MitoBankVerificationClientResult | null;
  disabled?: boolean;
  onSearchBankDetails: () => void;
  enteredRecipientName?: string;
  onSyncVerifiedName?: (verifiedName: string) => void;
  bankSummaryLabel?: string;
  accountSummaryLabel?: string;
}

function normalizeNameForCompare(value?: string | null): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function BankVerificationCard({
  status,
  result,
  disabled = false,
  onSearchBankDetails,
  enteredRecipientName,
  onSyncVerifiedName,
  bankSummaryLabel,
  accountSummaryLabel,
}: BankVerificationCardProps) {
  const { toast } = useToast();

  const verifiedHolderName = result?.accountHolderName?.trim() || "";
  const hasNameMismatch =
    status === "resolved" &&
    Boolean(verifiedHolderName) &&
    Boolean(onSyncVerifiedName) &&
    normalizeNameForCompare(enteredRecipientName) !== normalizeNameForCompare(verifiedHolderName);

  const resolvedBankLabel =
    result?.details?.bank_name?.trim() ||
    result?.details?.bankName?.trim() ||
    bankSummaryLabel?.trim() ||
    "";
  const resolvedAcctLabel =
    result?.details?.account_number?.trim() ||
    result?.details?.iban?.trim() ||
    accountSummaryLabel?.trim() ||
    "";

  return (
    <div className="space-y-4">
      <Button
        type="button"
        variant={status === "idle" ? "default" : "outline"}
        disabled={disabled || status === "verifying"}
        data-testid="button-search-bank-details"
        onClick={onSearchBankDetails}
        className={
          status === "idle"
            ? "w-full h-11 rounded-full bg-[#2e5bff] hover:bg-blue-700 text-white font-semibold shadow-none inline-flex items-center justify-center gap-2"
            : "w-full h-11 rounded-full border-[#2e5bff] text-[#2e5bff] hover:bg-[#ECF5FF] font-semibold inline-flex items-center justify-center gap-2"
        }
      >
        {status === "verifying" ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Search bank details</span>
          </>
        ) : (
          <>
            <Search className="w-4 h-4" />
            <span>Search bank details</span>
          </>
        )}
      </Button>

      {status === "verifying" && (
        <div
          role="status"
          data-testid="card-verifying-bank-details"
          className="rounded-xl border border-[#cce3ff] bg-[#ECF5FF] p-4 flex items-center gap-3 text-sm text-[#1e3a5f]"
        >
          <Loader2 className="w-5 h-5 text-[#2e5bff] animate-spin shrink-0" />
          <span className="font-medium">
            Just a moment — We&apos;re confirming the bank details...
          </span>
        </div>
      )}

      {status === "resolved" && (verifiedHolderName || resolvedBankLabel) && (
        <div
          data-testid="card-verified-bank-holder"
          className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#0E7A0D]">
              <CheckCircle2 className="w-5 h-5 text-[#0E7A0D] shrink-0" />
              <span>Bank details confirmed</span>
            </div>
          </div>

          <div className="rounded-lg bg-white/90 border border-emerald-100 p-3 space-y-2 text-sm">
            {verifiedHolderName && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#605E5C]">Account holder name</span>
                <span className="font-semibold text-[#111827] text-right">
                  {verifiedHolderName}
                </span>
              </div>
            )}
            {resolvedBankLabel && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#605E5C]">Bank</span>
                <span className="font-medium text-[#111827] text-right truncate">
                  {resolvedBankLabel}
                </span>
              </div>
            )}
            {result?.details?.bic_swift && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#605E5C]">SWIFT / BIC</span>
                <span className="font-mono font-medium text-[#111827] tabular-nums text-right">
                  {result.details.bic_swift}
                </span>
              </div>
            )}
            {result?.details?.bank_address && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#605E5C]">Branch address</span>
                <span className="font-medium text-[#111827] text-right">
                  {result.details.bank_address}
                </span>
              </div>
            )}
            {resolvedAcctLabel && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#605E5C]">Account</span>
                <span className="font-mono font-medium text-[#111827] tabular-nums text-right break-all">
                  {resolvedAcctLabel}
                </span>
              </div>
            )}
          </div>

          {hasNameMismatch && onSyncVerifiedName && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-lg bg-[#ECF5FF] border border-[#cce3ff] px-3 py-2.5 text-xs text-[#1e3a5f]">
              <span>
                {enteredRecipientName?.trim()
                  ? `Differs from "${enteredRecipientName.trim()}". Sync recipient name with bank record?`
                  : "Apply verified account holder name to recipient details?"}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="button-use-verified-name"
                onClick={() => {
                  onSyncVerifiedName(verifiedHolderName);
                  toast({
                    title: "Recipient name updated",
                    description: `Updated recipient name to ${verifiedHolderName}.`,
                  });
                }}
                className="h-8 rounded-lg border-[#2e5bff] bg-white text-[#2e5bff] hover:bg-[#ECF5FF] text-xs font-semibold shrink-0 inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Use verified name</span>
              </Button>
            </div>
          )}
        </div>
      )}

      {status === "unavailable" && (
        <div
          role="status"
          data-testid="card-unverified-bank-notice"
          className="rounded-xl border border-amber-200 bg-[#FFF8EB] p-4 flex items-start gap-3 text-sm text-amber-950"
        >
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-950">
              Account verification unavailable right now
            </p>
            <p className="text-xs sm:text-sm text-amber-900 leading-relaxed">
              {result?.message ||
                "Automatic account name verification isn't available for this bank right now. Please double-check the account details and click Continue."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
