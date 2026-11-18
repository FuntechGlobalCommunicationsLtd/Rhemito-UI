import React from "react";
import { CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { NicknameValidationState } from "./useNicknameValidation";
import { cn } from "@/lib/utils";

export interface NicknameFieldWithCheckProps {
  value: string;
  onChange: (value: string) => void;
  validation: NicknameValidationState;
  /** Optional custom `<Label>` element (e.g. `<Label>Nickname (Optional)</Label>` in `SendMoney.tsx`). */
  labelSlot?: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  errorMessage?: string;
}

export function NicknameFieldWithCheck({
  value,
  onChange,
  validation,
  labelSlot,
  placeholder = "e.g. FamilySavings",
  disabled = false,
  errorMessage,
}: NicknameFieldWithCheckProps) {
  const hasError = Boolean(errorMessage) || validation.isBlocking;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        {labelSlot ?? (
          <Label className="text-sm font-medium text-[#323130]">
            Nickname <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="button-nickname-info"
              aria-label="About recipient nickname"
              className="inline-flex items-center justify-center rounded-full p-0.5 text-[#605E5C] hover:text-[#2e5bff] transition-colors cursor-pointer"
            >
              <Info className="w-4 h-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-80 rounded-xl border border-[#cce3ff] bg-[#ECF5FF] p-3.5 text-xs leading-relaxed text-[#1e3a5f] shadow-md"
          >
            Assigning a nickname lets you fund your Rhemito Payment account directly with that nickname as the payment reference to auto-pay this recipient.
          </PopoverContent>
        </Popover>
      </div>

      <div className="relative">
        <Input
          data-testid="input-recipient-nickname"
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "pr-9",
            hasError && "border-red-500 focus-visible:ring-red-500",
            validation.status === "available" && !errorMessage && "border-emerald-500 focus-visible:ring-emerald-500/30",
          )}
        />
        {validation.status === "checking" && (
          <Loader2 className="w-4 h-4 text-[#2e5bff] animate-spin absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        )}
        {validation.status === "available" && !errorMessage && (
          <CheckCircle2 className="w-4 h-4 text-[#0E7A0D] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        )}
        {(validation.status === "invalid" || validation.status === "unavailable" || Boolean(errorMessage)) && (
          <XCircle className="w-4 h-4 text-red-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        )}
      </div>

      {errorMessage ? (
        <p data-testid="nickname-validation-status" className="text-xs text-red-600">
          {errorMessage}
        </p>
      ) : validation.status === "checking" ? (
        <p data-testid="nickname-validation-status" className="text-xs text-[#2e5bff]">
          Checking availability...
        </p>
      ) : validation.status === "available" ? (
        <p data-testid="nickname-validation-status" className="text-xs font-medium text-[#0E7A0D]">
          Nickname is available
        </p>
      ) : validation.status === "invalid" || validation.status === "unavailable" ? (
        <p data-testid="nickname-validation-status" className="text-xs text-red-600">
          {validation.message}
        </p>
      ) : (
        <p className="text-xs text-[#605E5C]">
          Optional · At least 5 letters or numbers for direct Payment account auto-payouts.
        </p>
      )}
    </div>
  );
}
