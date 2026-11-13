/**
 * Promo code draft handoff between `/rewards` (or campaign landing) and
 * `/transactions/sendmoney` (`RewardAtPayment.tsx`).
 *
 * Exports both `savePromoDraft` / `readPromoDraft` / `clearPromoDraft` and
 * the `prod_main` aliases `writePromoCodeDraft` / `readPromoCodeDraft` / `clearPromoCodeDraft`.
 */

const DRAFT_KEY = "rewards.promoDraft";
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export type PromoApplyMode = "REDUCE_SEND" | "INCREASE_RECEIVE";

export interface PromoCodeDraft {
  code: string;
  discount: number;
  currency?: string;
  note?: string;
  discountBasis?: "VALUE" | "FEE" | "PAYABLE";
  customerChoice?: boolean;
  promoApply?: PromoApplyMode;
  savedAt: number;
}

export interface SavePromoDraftInput {
  code: string;
  discount?: number;
  currency?: string;
  note?: string;
  discountBasis?: "VALUE" | "FEE" | "PAYABLE";
  customerChoice?: boolean;
  promoApply?: PromoApplyMode;
}

export function savePromoDraft(input: SavePromoDraftInput): PromoCodeDraft | null {
  const code = String(input.code || "")
    .trim()
    .toUpperCase();
  if (!code || !/^[A-Z0-9_-]{1,20}$/.test(code)) return null;

  const draft: PromoCodeDraft = {
    code,
    discount: Math.max(0, Number(input.discount) || 0),
    currency: input.currency ? String(input.currency).trim().toUpperCase() : undefined,
    note: input.note ? String(input.note).trim() : undefined,
    discountBasis: input.discountBasis,
    customerChoice: Boolean(input.customerChoice),
    promoApply: input.promoApply || "REDUCE_SEND",
    savedAt: Date.now(),
  };

  if (typeof window !== "undefined") {
    const serialized = JSON.stringify(draft);
    try {
      window.sessionStorage.setItem(DRAFT_KEY, serialized);
    } catch {
      // Ignore sessionStorage errors
    }
    try {
      window.localStorage.setItem(DRAFT_KEY, serialized);
    } catch {
      // Ignore localStorage errors
    }
  }

  return draft;
}

export function readPromoDraft(): PromoCodeDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      window.sessionStorage.getItem(DRAFT_KEY) ||
      window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const code = String(parsed?.code || "")
      .trim()
      .toUpperCase();
    const savedAt = Number(parsed?.savedAt || 0);
    if (!code || !savedAt) return null;
    if (Date.now() - savedAt > DRAFT_TTL_MS) {
      clearPromoDraft();
      return null;
    }
    return {
      code,
      discount: Math.max(0, Number(parsed.discount) || 0),
      currency: parsed.currency ? String(parsed.currency).toUpperCase() : undefined,
      note: parsed.note ? String(parsed.note) : undefined,
      discountBasis: parsed.discountBasis,
      customerChoice: Boolean(parsed.customerChoice),
      promoApply:
        parsed.promoApply === "INCREASE_RECEIVE" ? "INCREASE_RECEIVE" : "REDUCE_SEND",
      savedAt,
    };
  } catch {
    return null;
  }
}

export function clearPromoDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Ignore sessionStorage errors
  }
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Ignore localStorage errors
  }
}

// ─── Backward-Compatible Aliases (`Rhemito-web` `prod_main`) ─────────────────

export const writePromoCodeDraft = savePromoDraft;
export const readPromoCodeDraft = readPromoDraft;
export const clearPromoCodeDraft = clearPromoDraft;
