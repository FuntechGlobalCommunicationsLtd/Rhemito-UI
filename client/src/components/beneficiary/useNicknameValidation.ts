import { useEffect, useState } from "react";
import { validateMitoNickname } from "@/lib/sendMoney";

export type NicknameValidationStatus = "idle" | "checking" | "available" | "unavailable" | "invalid";

export interface NicknameValidationState {
  status: NicknameValidationStatus;
  message: string | null;
  isBlocking: boolean;
}

const IDLE_STATE: NicknameValidationState = {
  status: "idle",
  message: null,
  isBlocking: false,
};

/**
 * Live optional beneficiary nickname validation:
 * - Empty or unchanged from `skipWhenUnchangedFrom` -> `idle` (non-blocking).
 * - Fewer than 5 alphanumeric characters -> immediate `invalid` (`isBlocking: true`).
 * - Otherwise debounces 400ms against `GET /api/send-money/mito/validate-nickname`.
 */
export function useNicknameValidation(
  nickName: string,
  skipWhenUnchangedFrom?: string,
): NicknameValidationState {
  const [state, setState] = useState<NicknameValidationState>(IDLE_STATE);

  useEffect(() => {
    const trimmed = String(nickName || "").trim();
    const baseline = String(skipWhenUnchangedFrom || "").trim();

    if (!trimmed || (baseline && trimmed.toLowerCase() === baseline.toLowerCase())) {
      setState(IDLE_STATE);
      return;
    }

    const alphanumericCount = trimmed.replace(/[^a-zA-Z0-9]/g, "").length;
    if (alphanumericCount < 5) {
      setState({
        status: "invalid",
        message: "Nickname must contain at least 5 letters or numbers.",
        isBlocking: true,
      });
      return;
    }

    let cancelled = false;
    setState({
      status: "checking",
      message: "Checking availability...",
      isBlocking: false,
    });

    const timer = window.setTimeout(() => {
      void validateMitoNickname(trimmed).then((res) => {
        if (cancelled) return;
        if (!res.valid) {
          setState({
            status: "invalid",
            message: res.message || "Nickname must contain at least 5 letters or numbers.",
            isBlocking: true,
          });
          return;
        }
        if (res.available) {
          setState({
            status: "available",
            message: "Nickname is available",
            isBlocking: false,
          });
          return;
        }
        setState({
          status: "unavailable",
          message: res.message || "This nickname is already in use. Please choose another.",
          isBlocking: true,
        });
      });
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [nickName, skipWhenUnchangedFrom]);

  return state;
}
