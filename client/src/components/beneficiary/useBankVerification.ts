import { useCallback, useRef, useState } from "react";
import {
  verifyMitoBankDetails,
  type MitoBankVerificationClientResult,
} from "@/lib/sendMoney";

export type BankVerificationStatus = "idle" | "verifying" | "resolved" | "unavailable";

export interface VerifyBankDetailsParams {
  international?: boolean;
  countryIso3: string;
  providerId?: string;
  param: Array<{ parameter: string; value: string }>;
}

export interface UseBankVerificationReturn {
  status: BankVerificationStatus;
  result: MitoBankVerificationClientResult | null;
  canContinue: boolean;
  verify: (params: VerifyBankDetailsParams) => Promise<MitoBankVerificationClientResult>;
  reset: () => void;
}

/**
 * Manages bank account holder lookup (`POST /api/send-money/mito/bank-details`).
 * Call `reset()` whenever provider or banking inputs change so stale verification is cleared.
 * `canContinue` unlocks once `status === "resolved" || status === "unavailable"`.
 */
export function useBankVerification(): UseBankVerificationReturn {
  const [status, setStatus] = useState<BankVerificationStatus>("idle");
  const [result, setResult] = useState<MitoBankVerificationClientResult | null>(null);
  const requestSeqRef = useRef<number>(0);

  const reset = useCallback(() => {
    requestSeqRef.current += 1;
    setStatus("idle");
    setResult(null);
  }, []);

  const verify = useCallback(async (params: VerifyBankDetailsParams) => {
    const seq = ++requestSeqRef.current;
    setStatus("verifying");
    setResult(null);

    const res = await verifyMitoBankDetails(params);
    if (requestSeqRef.current === seq) {
      setResult(res);
      if (res.resolved && res.accountHolderName) {
        setStatus("resolved");
      } else {
        setStatus("unavailable");
      }
    }
    return res;
  }, []);

  const canContinue = status === "resolved" || status === "unavailable";

  return {
    status,
    result,
    canContinue,
    verify,
    reset,
  };
}
