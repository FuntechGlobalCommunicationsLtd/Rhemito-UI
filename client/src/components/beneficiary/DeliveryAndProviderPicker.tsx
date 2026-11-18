import { useEffect, useState } from "react";
import { ArrowLeft, Check, Globe, Landmark, Loader2, Search, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MitoProviderOption } from "@/lib/sendMoney";
import { cn } from "@/lib/utils";

const CURRENCY_FLAG_FALLBACK: Record<string, string> = {
  GBP: "gb",
  USD: "us",
  EUR: "eu",
  NGN: "ng",
  INR: "in",
  GHS: "gh",
  KES: "ke",
  ZAR: "za",
  CAD: "ca",
  AED: "ae",
  AUD: "au",
  CNY: "cn",
  JPY: "jp",
};

export interface DeliveryAndProviderPickerProps {
  service: "bank_deposit" | "mobile_money";
  localProviders: MitoProviderOption[];
  internationalProviders: MitoProviderOption[];
  loading?: boolean;
  isInternational: boolean;
  onChangeInternational: (isInternational: boolean) => void;
  selectedProviderId?: string | null;
  onSelectProvider: (provider: MitoProviderOption) => void;
  sendCurrency: string;
  receiveCurrency: string;
  sendFlagCode?: string;
  receiveFlagCode?: string;
  displayRate: string | number;
  onBack?: () => void;
  backLabel?: string;
}

export function DeliveryAndProviderPicker({
  service,
  localProviders,
  internationalProviders,
  loading = false,
  isInternational,
  onChangeInternational,
  selectedProviderId,
  onSelectProvider,
  sendCurrency,
  receiveCurrency,
  sendFlagCode,
  receiveFlagCode,
  displayRate,
  onBack,
  backLabel = "Back to recipients",
}: DeliveryAndProviderPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(10);

  useEffect(() => {
    setVisibleCount(10);
  }, [isInternational, service, receiveCurrency, searchQuery]);

  const hasInternational = service === "bank_deposit" && internationalProviders.length > 0;
  const rawList =
    hasInternational && isInternational ? internationalProviders : localProviders;
  const nonGeneric = rawList.filter((p) => !p.isGeneric);
  const effectiveProviders = nonGeneric.length > 0 ? nonGeneric : rawList;

  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? effectiveProviders.filter(
        (p) =>
          p.providerName.toLowerCase().includes(q) ||
          p.providerCode.toLowerCase().includes(q),
      )
    : effectiveProviders;

  const visibleProviders = filtered.slice(0, visibleCount);

  const fromCur = (sendCurrency || "GBP").toUpperCase();
  const toCur = (receiveCurrency || "NGN").toUpperCase();
  const fromFlag = (sendFlagCode || CURRENCY_FLAG_FALLBACK[fromCur] || "gb").toLowerCase();
  const toFlag = (receiveFlagCode || CURRENCY_FLAG_FALLBACK[toCur] || "ng").toLowerCase();
  const numericRate = typeof displayRate === "number" ? displayRate : parseFloat(String(displayRate || "0"));
  const formattedRate = Number.isFinite(numericRate) && numericRate > 0 ? numericRate.toFixed(2) : String(displayRate || "0.00");

  return (
    <div className="space-y-6" data-testid="delivery-and-provider-picker">
      {onBack && (
        <div>
          <button
            type="button"
            onClick={onBack}
            data-testid="button-provider-picker-back"
            className="inline-flex items-center gap-2 text-sm font-medium text-[#323130] hover:text-[#2e5bff] transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{backLabel}</span>
          </button>
        </div>
      )}

      {hasInternational && (
        <div className="space-y-3" data-testid="delivery-method-rail-section">
          <h3 className="font-display text-base font-semibold text-[#323130]">
            Delivery method
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              data-testid="card-delivery-direct"
              onClick={() => {
                if (isInternational) {
                  setSearchQuery("");
                  onChangeInternational(false);
                }
              }}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-4 text-left transition-all cursor-pointer",
                !isInternational
                  ? "border-[#2e5bff] bg-[#ECF5FF] ring-1 ring-[#2e5bff]/20"
                  : "border-[#efefee] bg-white hover:bg-slate-50",
              )}
            >
              <div
                className={cn(
                  "w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                  !isInternational
                    ? "bg-[#2e5bff] text-white"
                    : "bg-[#ECF5FF] text-[#2e5bff]",
                )}
              >
                <Landmark className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[#111827]">
                    Direct to bank
                  </span>
                  {!isInternational && (
                    <Check className="w-4 h-4 text-[#2e5bff] shrink-0" />
                  )}
                </div>
                <p className="text-xs text-[#605E5C] mt-0.5 leading-snug">
                  Local transfers · Usually within 30 mins
                </p>
              </div>
            </button>

            <button
              type="button"
              data-testid="card-delivery-swift"
              onClick={() => {
                if (!isInternational) {
                  setSearchQuery("");
                  onChangeInternational(true);
                }
              }}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-4 text-left transition-all cursor-pointer",
                isInternational
                  ? "border-[#2e5bff] bg-[#ECF5FF] ring-1 ring-[#2e5bff]/20"
                  : "border-[#efefee] bg-white hover:bg-slate-50",
              )}
            >
              <div
                className={cn(
                  "w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                  isInternational
                    ? "bg-[#2e5bff] text-white"
                    : "bg-[#ECF5FF] text-[#2e5bff]",
                )}
              >
                <Globe className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[#111827]">
                    Swift
                  </span>
                  {isInternational && (
                    <Check className="w-4 h-4 text-[#2e5bff] shrink-0" />
                  )}
                </div>
                <p className="text-xs text-[#605E5C] mt-0.5 leading-snug">
                  International transfers · Usually within 24 hrs
                </p>
              </div>
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="font-display text-lg font-semibold text-[#323130]">
          {service === "mobile_money"
            ? "Please select the mobile operator"
            : "Please select the recipient's bank"}
        </h2>

        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            data-testid="input-search-providers"
            placeholder={
              service === "mobile_money"
                ? "Search mobile operator..."
                : "Search bank name..."
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-11 pl-10 pr-9 rounded-xl border border-[#d2d0ce] bg-white text-sm text-[#323130] focus:ring-2 focus:ring-[#2e5bff]/20 focus:border-[#2e5bff] outline-none transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {loading ? (
          <div
            data-testid="provider-picker-loading"
            className="py-10 flex items-center justify-center gap-2.5 text-sm text-[#605E5C]"
          >
            <Loader2 className="w-5 h-5 text-[#2e5bff] animate-spin" />
            <span>Loading available options...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-8 px-4 text-center rounded-xl border border-dashed border-gray-200 text-sm text-[#605E5C]">
            {searchQuery.trim()
              ? `No matching option found for "${searchQuery.trim()}".`
              : "No providers available for this corridor right now."}
          </div>
        ) : (
          <div
            className="divide-y divide-[#efefee] rounded-xl border border-[#efefee] bg-white overflow-hidden"
            data-testid="provider-options-list"
          >
            {visibleProviders.map((prov) => {
              const isSelected = Boolean(selectedProviderId && selectedProviderId === prov.providerId);
              const IconComp = service === "mobile_money" ? Smartphone : prov.isInternational ? Globe : Landmark;
              return (
                <button
                  key={`${prov.providerId}-${prov.providerCode}`}
                  type="button"
                  data-testid={`provider-option-${prov.providerId}`}
                  onClick={() => onSelectProvider(prov)}
                  className={cn(
                    "w-full flex items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors cursor-pointer",
                    isSelected
                      ? "bg-[#ECF5FF]"
                      : "hover:bg-[#F5F9FF]/80 active:bg-[#ECF5FF]",
                  )}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-[#DCEBFA] text-[#2e5bff] flex items-center justify-center shrink-0">
                      <IconComp className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold text-[#111827] leading-snug truncate">
                        {prov.providerName}
                      </div>
                      <div className="text-xs text-[#605E5C] mt-0.5 truncate">
                        {service === "mobile_money"
                          ? "Mobile wallet"
                          : prov.isInternational
                            ? "Swift international transfer"
                            : "Direct to bank"}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0 tabular-nums space-y-0.5">
                    <div className="inline-flex items-center justify-end gap-1.5 text-xs font-medium text-[#605E5C] w-full">
                      <img
                        src={`https://flagcdn.com/w20/${fromFlag}.png`}
                        alt={fromCur}
                        className="w-4 h-3 object-cover rounded-[2px] shrink-0"
                      />
                      <span>{fromCur} 1.00</span>
                    </div>
                    <div className="inline-flex items-center justify-end gap-1.5 text-xs sm:text-sm font-semibold text-[#111827] w-full">
                      <img
                        src={`https://flagcdn.com/w20/${toFlag}.png`}
                        alt={toCur}
                        className="w-4 h-3 object-cover rounded-[2px] shrink-0"
                      />
                      <span>
                        {toCur} {formattedRate}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {visibleCount < filtered.length && (
          <Button
            type="button"
            variant="outline"
            data-testid="button-show-more-providers"
            onClick={() => setVisibleCount((prev) => prev + 10)}
            className="w-full h-11 rounded-full border-[#d2d0ce] text-[#323130] font-semibold hover:bg-slate-50"
          >
            Show more
          </Button>
        )}
      </div>
    </div>
  );
}
