import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import {
  Box,
  Button,
  Checkbox,
  Flex,
  Input,
  Radio,
  RadioGroup,
  Stack,
  Text,
} from "@chakra-ui/react";
import api from "@/utils/apiClient";
import { apiData } from "@/utils/apiResult";
import { flagOn, normaliseRewardKindKey } from "@/utils/rewardsGate";
import { toastrMsg } from "@/utils/toastrMsg";
import {
  clearPromoCodeDraft,
  PROMO_CODE_REGEX,
  readPromoCodeDraft,
  writePromoCodeDraft,
  type PromoAppliesTo,
  type PromoApplyMode,
} from "@/utils/promoCodeDraft";

/**
 * Reward$ at pay time — shared across Rhemito Web (`staging_next_js` & `prod_main`)
 * and affiliate vanity hosts.
 *
 * Key Staging upgrades over `prod_main`:
 *  1. Supports `promoApply: "REDUCE_SEND" | "INCREASE_RECEIVE"` + `receiveBoostSendCurrency`
 *     with an accessible Chakra `RadioGroup` when `customerChoice === true` (`discountBasis === "VALUE"`).
 *  2. Fixes the live bonus over-debit math bug by capping bonus against post-promo payable
 *     minus `minPayableFloor` (`Math.max(0, postPromoPayable - minPayableFloor)`).
 *  3. Supports both full-balance checkbox toggle AND custom partial bonus credit input.
 *  4. Surfaces welcome-credit minimum transfer `floor` and `receiveCurrency` corridor warnings.
 *  5. Debounces promo re-validation (400ms) across `[amount, fee, currency, receiveCurrency, paymentMethod]`
 *     and freezes all mutations/re-validations when `locked={isSubmitting}` (`PROMO-07` / `P-20`).
 */

export type { PromoApplyMode, PromoAppliesTo };

export type Choice = {
  promoCode: string;
  promoDiscount: number;
  promoApply: PromoApplyMode;
  promoAppliesTo?: PromoAppliesTo;
  receiveBoostSendCurrency: number;
  bonusAmount: number;
  blocked: boolean;
};

export type Props = {
  amount: number;
  fee: number;
  currency?: string;
  receiveCurrency?: string;
  paymentMethod?: string;
  exchangeRate?: number;
  minPayableFloor?: number;
  flow?: "send" | "receive";
  locked?: boolean;
  onChange: (choice: Choice) => void;
};

const GATEWAY_MIN_PAYABLE_METHODS = new Set([
  "CARDCHECKOUT",
  "CARD",
  "DEBITCARD",
  "CREDITCARD",
  "CHECKOUTAPPLEPAY",
  "CHECKOUTGOOGLEPAY",
  "APPLEPAY",
  "GOOGLEPAY",
  "PLAID",
  "PAYBYBANK",
  "OPENBANKING",
  "NOKRIN",
]);

const pick = (source: any, name: string) => {
  if (!source || typeof source !== "object") return undefined;
  const want = name.toLowerCase();
  const snake = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  const key = Object.keys(source).find((item) => {
    const low = item.toLowerCase();
    return low === want || low === snake;
  });
  return key ? source[key] : undefined;
};

const roundMoney = (value: number, currency?: string): number => {
  const digits = String(currency || "").trim().toUpperCase() === "JPY" ? 0 : 2;
  const factor = digits === 0 ? 1 : 100;
  return Math.round((Number(value) || 0) * factor) / factor;
};

const defaultMinPayableFloor = (
  paymentMethod?: string,
  currency?: string,
): number => {
  const method = String(paymentMethod || "")
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, "");
  if (!method || !GATEWAY_MIN_PAYABLE_METHODS.has(method)) return 0;
  return String(currency || "").trim().toUpperCase() === "JPY" ? 100 : 1;
};

/** Parse money from API numbers/strings; also "You save GBP 100.00". */
const parseMoney = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null) return 0;
  const text = String(value).trim();
  if (!text) return 0;
  const direct = Number(text.replace(/,/g, ""));
  if (Number.isFinite(direct)) return direct;
  const matched = text.match(/([0-9]+(?:\.[0-9]+)?)/);
  return matched ? Number(matched[1]) : 0;
};

const readRawPromoDiscount = (data: any): number => {
  const raw =
    pick(data, "discount") ??
    pick(data, "appliedDiscount") ??
    pick(data, "applied_discount") ??
    pick(data, "applieddiscount");
  let discount = parseMoney(raw);
  if (discount <= 0) {
    discount = parseMoney(
      pick(data, "displayText") ?? pick(data, "display_text"),
    );
  }
  return Math.max(0, discount);
};

const RewardAtPayment = ({
  amount,
  fee,
  currency,
  receiveCurrency,
  paymentMethod,
  exchangeRate,
  minPayableFloor,
  flow,
  locked = false,
  onChange,
}: Props) => {
  const curCode = String(currency || "GBP").trim().toUpperCase() || "GBP";
  const recCode = String(receiveCurrency || "").trim().toUpperCase();
  const digits = curCode === "JPY" ? 0 : 2;

  const [promo, setPromo] = useState("");
  const [promoNote, setPromoNote] = useState("");
  const [promoOn, setPromoOn] = useState(false);
  const [promoRejected, setPromoRejected] = useState(false);
  const [rawPromoDiscount, setRawPromoDiscount] = useState(0);
  const [customerChoice, setCustomerChoice] = useState(false);
  const [discountBasis, setDiscountBasis] = useState<"VALUE" | "FEE" | "PAYABLE">(
    "PAYABLE",
  );
  const [appliesTo, setAppliesTo] = useState<PromoAppliesTo>("fee");
  const [promoApply, setPromoApply] = useState<PromoApplyMode>("REDUCE_SEND");
  const [checking, setChecking] = useState(false);

  const [available, setAvailable] = useState(0);
  const [bySource, setBySource] = useState<any[]>([]);
  const [unusedCredits, setUnusedCredits] = useState<any[]>([]);
  const [useBonus, setUseBonus] = useState(false);
  const [customBonusText, setCustomBonusText] = useState("");
  const [customBonusTouched, setCustomBonusTouched] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [showPromo, setShowPromo] = useState(true);
  const [showBonus, setShowBonus] = useState(true);

  const asked = useRef(false);
  const validationSeq = useRef(0);
  const lastValidatedQuoteKey = useRef("");

  // Effective minimum gateway payable floor (prevents £0.00 card charge rejections)
  const resolvedMinPayable = useMemo(() => {
    if (minPayableFloor != null && Number.isFinite(Number(minPayableFloor))) {
      return Math.max(0, Number(minPayableFloor));
    }
    return defaultMinPayableFloor(paymentMethod, curCode);
  }, [minPayableFloor, paymentMethod, curCode]);

  // Evaluate per-credit minimum transfer floor & corridor restrictions (`unused` or `bySource`)
  const creditEligibility = useMemo(() => {
    const grossTransfer = Math.max(0, Number(amount) || 0);
    const warnings: string[] = [];
    const rows = unusedCredits.length > 0 ? unusedCredits : bySource;

    if (rows.length === 0) {
      return {
        eligibleAvailable: Math.max(0, available),
        warnings,
      };
    }

    let eligibleSum = 0;
    let floorHeldAmount = 0;
    let maxFloorRequired = 0;
    let corridorHeldAmount = 0;
    const heldCorridors = new Set<string>();

    rows.forEach((row) => {
      const rowCur = String(pick(row, "currency") || curCode)
        .trim()
        .toUpperCase();
      if (rowCur && rowCur !== curCode) return;

      const rowAmt = Number(
        pick(row, "remaining") ?? pick(row, "available") ?? pick(row, "amount") ?? 0,
      );
      if (rowAmt <= 0) return;

      const rowReceiveCur = String(
        pick(row, "receiveCurrency") ?? pick(row, "receive_currency") ?? "",
      )
        .trim()
        .toUpperCase();
      const rowFloor = Number(
        pick(row, "floor") ?? pick(row, "minTransferAmount") ?? 0,
      );

      if (rowReceiveCur && recCode && rowReceiveCur !== recCode) {
        corridorHeldAmount += rowAmt;
        heldCorridors.add(rowReceiveCur);
        return;
      }

      if (rowFloor > 0 && grossTransfer > 0 && grossTransfer + 0.0001 < rowFloor) {
        floorHeldAmount += rowAmt;
        if (rowFloor > maxFloorRequired) maxFloorRequired = rowFloor;
        return;
      }

      eligibleSum += rowAmt;
    });

    if (floorHeldAmount > 0 && maxFloorRequired > 0) {
      warnings.push(
        `${curCode} ${floorHeldAmount.toFixed(digits)} bonus credit requires a minimum transfer of ${curCode} ${maxFloorRequired.toFixed(digits)}.`,
      );
    }
    if (corridorHeldAmount > 0 && heldCorridors.size > 0) {
      warnings.push(
        `${curCode} ${corridorHeldAmount.toFixed(digits)} bonus credit applies only to ${Array.from(heldCorridors).join(", ")} transfers.`,
      );
    }

    const cappedEligible =
      available > 0 ? Math.min(available, eligibleSum) : eligibleSum;
    return {
      eligibleAvailable: Math.max(0, roundMoney(cappedEligible, curCode)),
      warnings,
    };
  }, [unusedCredits, bySource, available, amount, curCode, recCode, digits]);

  // Effective promo values depending on customerChoice (`REDUCE_SEND` vs `INCREASE_RECEIVE`)
  const effectiveApply: PromoApplyMode =
    promoOn && customerChoice ? promoApply : "REDUCE_SEND";

  const grossPayable = Math.max(0, Number(amount) || 0);
  const payablePromoDiscount = useMemo(() => {
    if (!promoOn || rawPromoDiscount <= 0) return 0;
    if (effectiveApply === "INCREASE_RECEIVE" || appliesTo === "bonus") return 0;
    return grossPayable > 0
      ? roundMoney(Math.min(rawPromoDiscount, grossPayable), curCode)
      : roundMoney(rawPromoDiscount, curCode);
  }, [promoOn, rawPromoDiscount, effectiveApply, appliesTo, grossPayable, curCode]);

  const receiveBoostSendCurrency = useMemo(() => {
    if (!promoOn || rawPromoDiscount <= 0) return 0;
    return effectiveApply === "INCREASE_RECEIVE"
      ? roundMoney(rawPromoDiscount, curCode)
      : 0;
  }, [promoOn, rawPromoDiscount, effectiveApply, curCode]);

  // Post-promo bonus cap: fixes live over-debit bug (`Math.max(0, postPromoPayable - minPayableFloor)`)
  const postPromoPayable = Math.max(0, grossPayable - payablePromoDiscount);
  const maxBonusToApply = useMemo(() => {
    const maxPayableRoom = Math.max(0, postPromoPayable - resolvedMinPayable);
    return roundMoney(
      Math.min(creditEligibility.eligibleAvailable, maxPayableRoom),
      curCode,
    );
  }, [creditEligibility.eligibleAvailable, postPromoPayable, resolvedMinPayable, curCode]);

  // Keep custom partial bonus input synced with maxBonusToApply unless user entered a smaller custom amount
  useEffect(() => {
    if (!useBonus) return;
    if (!customBonusTouched) {
      setCustomBonusText(maxBonusToApply > 0 ? maxBonusToApply.toFixed(digits) : "0");
      return;
    }
    const parsed = Number(customBonusText);
    if (Number.isFinite(parsed) && parsed > maxBonusToApply) {
      setCustomBonusText(maxBonusToApply.toFixed(digits));
    }
  }, [useBonus, maxBonusToApply, customBonusTouched, customBonusText, digits]);

  const resolvedBonusAmount = useMemo(() => {
    if (!useBonus || blocked || maxBonusToApply <= 0) return 0;
    if (!customBonusTouched) return maxBonusToApply;
    const parsed = Number(customBonusText);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return roundMoney(Math.min(parsed, maxBonusToApply), curCode);
  }, [
    useBonus,
    blocked,
    maxBonusToApply,
    customBonusTouched,
    customBonusText,
    curCode,
  ]);

  // Hydrate promo draft saved from `/rewards`
  useEffect(() => {
    const draft = readPromoCodeDraft();
    if (draft) {
      setPromo(draft.code);
      setCustomerChoice(Boolean(draft.customerChoice));
      if (draft.discountBasis) setDiscountBasis(draft.discountBasis);
      const draftAppliesTo: PromoAppliesTo =
        draft.appliesTo === "amount" || draft.appliesTo === "bonus"
          ? draft.appliesTo
          : "fee";
      setAppliesTo(draftAppliesTo);
      setPromoApply(
        draft.promoApply === "INCREASE_RECEIVE" ? "INCREASE_RECEIVE" : "REDUCE_SEND",
      );
      if (draft.discount > 0) {
        setPromoOn(true);
        setPromoRejected(false);
        setRawPromoDiscount(draft.discount);
        const draftCur = String(draft.currency || curCode).toUpperCase();
        setPromoNote(
          draft.note ||
            (draftAppliesTo === "amount"
              ? `${draftCur} ${draft.discount.toFixed(digits)} off transfer amount (full send amount delivered)`
              : `You save ${draftCur} ${draft.discount.toFixed(digits)}`),
        );
      }
      asked.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load wallet & programme flags from `Account/Rewards`
  useEffect(() => {
    let cancelled = false;
    api
      .get("Account/Rewards")
      .then((body: any) => {
        if (cancelled) return;
        const data = apiData(body) || body;
        const kinds = pick(data, "kinds");
        if (Array.isArray(kinds) && kinds.length > 0) {
          const enabled = (target: string) =>
            kinds.some((row: any) => {
              if (typeof row === "string") {
                return normaliseRewardKindKey(row) === target;
              }
              return (
                normaliseRewardKindKey(pick(row, "kind")) === target &&
                flagOn(row, "enabled", true)
              );
            });
          setShowPromo(enabled("PROMO"));
          setShowBonus(enabled("BONUS_SCHEME") || enabled("REFERRAL"));
        }
        setAvailable(Number(pick(data, "availableBalance") || 0));
        const sources = pick(data, "bySource") || pick(data, "by_source");
        setBySource(Array.isArray(sources) ? sources : []);
        const unused =
          pick(data, "unused") ||
          pick(data, "unusedCredits") ||
          pick(data, "credits");
        setUnusedCredits(Array.isArray(unused) ? unused : []);
        setBlocked(flagOn(data, "bonusBlocked", false));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Publish unified `Choice` to parent `PaymentMethods.tsx`
  useEffect(() => {
    if (locked) return;
    const activeCode = promoOn ? promo.trim().toUpperCase() : "";
    onChange({
      promoCode: activeCode,
      promoDiscount: payablePromoDiscount,
      promoApply: effectiveApply,
      promoAppliesTo: promoOn ? appliesTo : undefined,
      receiveBoostSendCurrency,
      bonusAmount: resolvedBonusAmount,
      blocked: Boolean(promo.trim()) && !promoOn,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    promo,
    promoOn,
    payablePromoDiscount,
    effectiveApply,
    appliesTo,
    receiveBoostSendCurrency,
    resolvedBonusAmount,
    blocked,
    locked,
  ]);

  const removePromo = () => {
    if (locked) return;
    const wasApplied = promoOn;
    asked.current = false;
    lastValidatedQuoteKey.current = "";
    validationSeq.current += 1;
    setPromo("");
    setPromoOn(false);
    setPromoRejected(false);
    setRawPromoDiscount(0);
    setCustomerChoice(false);
    setAppliesTo("fee");
    setPromoApply("REDUCE_SEND");
    setPromoNote("");
    clearPromoCodeDraft();
    onChange({
      promoCode: "",
      promoDiscount: 0,
      promoApply: "REDUCE_SEND",
      promoAppliesTo: undefined,
      receiveBoostSendCurrency: 0,
      bonusAmount: resolvedBonusAmount,
      blocked: false,
    });
    toastrMsg(
      "Promo code removed",
      wasApplied
        ? "The saving has been taken off this transfer."
        : "You can enter a different code.",
    );
  };

  const applyPromo = async (silentRevalidate = false) => {
    if (locked) return;
    const code = promo.trim().toUpperCase();
    asked.current = true;
    if (!code) {
      setPromoRejected(true);
      setPromoNote("Please enter a promo code.");
      return;
    }
    if (!PROMO_CODE_REGEX.test(code)) {
      setPromoRejected(true);
      setPromoNote("Enter a valid promo code.");
      return;
    }

    const quoteKey = `${code}|${amount}|${fee}|${curCode}|${recCode}|${paymentMethod || ""}|${flow || "send"}`;
    lastValidatedQuoteKey.current = quoteKey;
    const seq = ++validationSeq.current;
    setChecking(true);

    try {
      const payload: Record<string, unknown> = {
        code,
        amount,
        fee,
        currency: curCode,
        receiveCurrency: recCode || undefined,
      };
      if (paymentMethod) payload.paymentMethod = paymentMethod;
      if (flow) payload.flow = flow;

      const body = await api.post("Account/Rewards/Promo/Validate", {
        data: payload,
      });
      if (seq !== validationSeq.current || locked) return;

      const data = apiData(body) || body;
      const failed =
        pick(body, "succeeded") === false ||
        String(pick(body, "responseType") || pick(data, "responseType") || "")
          .toLowerCase() === "error" ||
        pick(data, "valid") === false;

      if (failed) {
        setPromoOn(false);
        setPromoRejected(true);
        setRawPromoDiscount(0);
        setCustomerChoice(false);
        setAppliesTo("fee");
        const message =
          pick(body, "message") ||
          pick(data, "message") ||
          "This promo code isn't valid. Check it and try again.";
        setPromoNote(String(message));
        return;
      }

      const discount = readRawPromoDiscount(data);
      if (discount <= 0) {
        setPromoOn(false);
        setPromoRejected(true);
        setRawPromoDiscount(0);
        setCustomerChoice(false);
        setAppliesTo("fee");
        setPromoNote("This promo code isn't valid for this transfer.");
        return;
      }

      const rawAppliesTo = String(
        pick(data, "appliesTo") ?? pick(data, "applies_to") ?? "",
      )
        .trim()
        .toLowerCase();
      const nextAppliesTo: PromoAppliesTo =
        rawAppliesTo === "amount" || rawAppliesTo === "bonus"
          ? rawAppliesTo
          : "fee";

      const rawBasis = String(pick(data, "discountBasis") || "PAYABLE")
        .trim()
        .toUpperCase();
      const nextBasis: "VALUE" | "FEE" | "PAYABLE" =
        rawBasis === "VALUE" || rawBasis === "FEE" ? rawBasis : "PAYABLE";
      const nextChoice =
        nextAppliesTo !== "amount" &&
        nextAppliesTo !== "bonus" &&
        (nextBasis === "VALUE" || flagOn(data, "customerChoice", false));
      const nextApply: PromoApplyMode = nextChoice ? promoApply : "REDUCE_SEND";

      const cappedForDisplay =
        nextApply === "REDUCE_SEND" &&
        nextAppliesTo !== "bonus" &&
        grossPayable > 0
          ? Math.min(discount, grossPayable)
          : discount;

      const serverDisplay = String(
        pick(data, "displayText") ?? pick(data, "display_text") ?? "",
      ).trim();

      const display =
        nextAppliesTo === "amount" &&
        (!serverDisplay || /on the fee/i.test(serverDisplay))
          ? `${curCode} ${cappedForDisplay.toFixed(digits)} off transfer amount (full send amount delivered)`
          : serverDisplay ||
            (nextChoice
              ? `${curCode} ${cappedForDisplay.toFixed(digits)} promo unlocked — choose how to apply it below.`
              : nextAppliesTo === "bonus"
                ? `${curCode} ${cappedForDisplay.toFixed(digits)} bonus paid into your bank with your payout`
                : `You save ${curCode} ${cappedForDisplay.toFixed(digits)} on the fee`);

      setAppliesTo(nextAppliesTo);
      setDiscountBasis(nextBasis);
      setCustomerChoice(nextChoice);
      if (!nextChoice) setPromoApply("REDUCE_SEND");
      setPromoOn(true);
      setPromoRejected(false);
      setRawPromoDiscount(discount);
      setPromoNote(String(display));

      writePromoCodeDraft({
        code,
        discount: cappedForDisplay,
        currency: curCode,
        discountBasis: nextBasis,
        appliesTo: nextAppliesTo,
        customerChoice: nextChoice,
        promoApply: nextApply,
        note:
          nextAppliesTo === "amount"
            ? `${curCode} ${cappedForDisplay.toFixed(digits)} off transfer amount (full send amount delivered)`
            : `Promo code applied: ${curCode} ${cappedForDisplay.toFixed(digits)} off`,
      });

      if (!silentRevalidate) {
        toastrMsg(
          "Promo code applied",
          `${curCode} ${cappedForDisplay.toFixed(digits)} unlocked`,
        );
      }
    } catch (error: any) {
      if (seq !== validationSeq.current || locked) return;
      setPromoOn(false);
      setPromoRejected(true);
      setRawPromoDiscount(0);
      setCustomerChoice(false);
      setAppliesTo("fee");
      const message =
        (typeof error === "string" && error) ||
        error?.message ||
        "Promo codes are unavailable right now. Please try again shortly.";
      setPromoNote(String(message));
    } finally {
      if (seq === validationSeq.current) {
        setChecking(false);
      }
    }
  };

  // Debounced (400ms) re-validation across quote/corridor/paymentMethod changes (`PROMO-07` / `P-20`)
  useEffect(() => {
    if (locked || !asked.current || !promo.trim()) return;
    const nextQuoteKey = `${promo.trim().toUpperCase()}|${amount}|${fee}|${curCode}|${recCode}|${paymentMethod || ""}|${flow || "send"}`;
    if (nextQuoteKey === lastValidatedQuoteKey.current) return;

    const timer = window.setTimeout(() => {
      if (!locked && asked.current) {
        void applyPromo(true);
      }
    }, 400);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, fee, curCode, recCode, paymentMethod, flow, locked]);

  const showRemove = promoOn || promoRejected;
  const convertedBoostPreview =
    exchangeRate && exchangeRate > 0 && recCode && rawPromoDiscount > 0
      ? ` (~${recCode} ${(rawPromoDiscount * exchangeRate).toFixed(2)})`
      : "";

  if (!showPromo && !showBonus) return null;

  return (
    <Box
      mb="24px"
      border="1px solid"
      borderColor="var(--clr1)"
      borderRadius="12px"
      p="16px"
      opacity={locked ? 0.85 : 1}
      data-testid="reward-at-payment"
    >
      <Text
        fontSize="18px"
        lineHeight="1.4"
        fontWeight="700"
        color="var(--clr1)"
        mb="8px"
      >
        Reward$
      </Text>

      {/* Bonus Credit Section */}
      {showBonus && (
        <Box mb="14px">
          {blocked ? (
            <Text fontSize="16px" lineHeight="1.5">
              You&apos;re not qualified to get bonus. Please contact support for
              more information.
            </Text>
          ) : maxBonusToApply > 0 ? (
            <Box>
              <Checkbox
                isChecked={useBonus}
                isDisabled={locked}
                colorScheme="purple"
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const checked = event.target.checked;
                  setUseBonus(checked);
                  if (checked) {
                    setCustomBonusTouched(false);
                    setCustomBonusText(maxBonusToApply.toFixed(digits));
                  }
                }}
                data-testid="use-bonus-checkbox"
              >
                <Text fontSize="16px" lineHeight="1.5">
                  Use up to {maxBonusToApply.toFixed(digits)} {curCode} bonus
                  credit on this transfer
                </Text>
              </Checkbox>

              {useBonus && (
                <Flex
                  mt="8px"
                  ml="24px"
                  gap="8px"
                  align="center"
                  flexWrap="wrap"
                  data-testid="partial-bonus-controls"
                >
                  <Text fontSize="14px" color="gray.600">
                    Amount to apply ({curCode}):
                  </Text>
                  <Input
                    type="number"
                    step={digits === 0 ? "1" : "0.01"}
                    min="0"
                    max={maxBonusToApply}
                    w="120px"
                    h="38px"
                    fontSize="15px"
                    borderColor="gray.300"
                    isDisabled={locked}
                    value={customBonusText}
                    aria-label={`Bonus amount in ${curCode}`}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      setCustomBonusTouched(true);
                      setCustomBonusText(e.target.value);
                    }}
                    onBlur={() => {
                      const parsed = Number(customBonusText);
                      if (!Number.isFinite(parsed) || parsed <= 0) {
                        setCustomBonusTouched(false);
                        setCustomBonusText(maxBonusToApply.toFixed(digits));
                        return;
                      }
                      const clamped = Math.min(parsed, maxBonusToApply);
                      setCustomBonusText(clamped.toFixed(digits));
                    }}
                  />
                  {customBonusTouched && resolvedBonusAmount < maxBonusToApply && (
                    <Button
                      size="xs"
                      variant="outline"
                      borderColor="var(--clr1)"
                      color="var(--clr1)"
                      isDisabled={locked}
                      onClick={() => {
                        setCustomBonusTouched(false);
                        setCustomBonusText(maxBonusToApply.toFixed(digits));
                      }}
                    >
                      Use max ({maxBonusToApply.toFixed(digits)})
                    </Button>
                  )}
                </Flex>
              )}

              {resolvedMinPayable > 0 &&
                creditEligibility.eligibleAvailable > maxBonusToApply && (
                  <Text fontSize="13px" color="gray.600" mt="6px">
                    Capped at {curCode} {maxBonusToApply.toFixed(digits)} so a
                    minimum card/bank payment of {curCode}{" "}
                    {resolvedMinPayable.toFixed(digits)} remains.
                  </Text>
                )}

              {bySource.filter((row) => Number(pick(row, "available") || 0) > 0)
                .length > 1 ? (
                <Text fontSize="14px" lineHeight="1.5" mt="6px" color="gray.600">
                  Includes{" "}
                  {bySource
                    .filter((row) => Number(pick(row, "available") || 0) > 0)
                    .map((row) => {
                      const src = String(
                        pick(row, "creditSource") ||
                          pick(row, "credit_source") ||
                          "",
                      ).toUpperCase();
                      const label =
                        src === "REFERRAL"
                          ? "referrals"
                          : src === "SCHEME"
                            ? "bonus offers"
                            : src === "MANUAL"
                              ? "Rhemito"
                              : String(
                                  pick(row, "label") || src || "bonus",
                                ).toLowerCase();
                      return `${Number(pick(row, "available") || 0).toFixed(digits)} from ${label}`;
                    })
                    .join(", ")}
                </Text>
              ) : null}
            </Box>
          ) : (
            <Text fontSize="16px" lineHeight="1.5" color="gray.700">
              No bonus credit available to apply on this transfer.
            </Text>
          )}

          {/* Floor & Corridor Eligibility Warnings */}
          {creditEligibility.warnings.map((warning) => (
            <Text
              key={warning}
              fontSize="13px"
              color="orange.700"
              bg="orange.50"
              border="1px solid"
              borderColor="orange.200"
              borderRadius="8px"
              px="10px"
              py="6px"
              mt="8px"
              role="status"
              data-testid="bonus-eligibility-warning"
            >
              {warning}
            </Text>
          ))}
        </Box>
      )}

      {/* Promo Code Section */}
      {showPromo && (
        <Box>
          <Text fontSize="16px" lineHeight="1.4" fontWeight="600" mb="6px">
            Promo Code
          </Text>
          <Text fontSize="15px" lineHeight="1.5" mb="8px" color="gray.600">
            {showRemove
              ? "Remove this code to enter a different one."
              : "Enter a code to take money off what you pay or boost what your recipient gets."}
          </Text>
          <Flex gap="8px" wrap="wrap" align="center">
            <Input
              maxW="220px"
              h="44px"
              fontSize="16px"
              placeholder="Enter promo code"
              value={promo}
              maxLength={20}
              fontFamily="mono"
              borderColor="var(--clr1)"
              isReadOnly={showRemove || locked}
              isDisabled={locked}
              aria-describedby="promo-code-message"
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (!showRemove && !locked) void applyPromo(false);
                }
              }}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                if (showRemove || locked) return;
                asked.current = false;
                lastValidatedQuoteKey.current = "";
                setPromo(event.target.value.toUpperCase());
                setPromoOn(false);
                setPromoRejected(false);
                setRawPromoDiscount(0);
                setCustomerChoice(false);
                setPromoNote("");
              }}
            />
            {showRemove ? (
              <Button
                variant="outline"
                borderColor="var(--clr1)"
                color="var(--clr1)"
                h="44px"
                fontSize="16px"
                isDisabled={locked}
                onClick={removePromo}
                title="Remove this code to enter a different one"
              >
                Remove
              </Button>
            ) : (
              <Button
                variant="outline"
                borderColor="var(--clr1)"
                color="var(--clr1)"
                h="44px"
                fontSize="16px"
                isDisabled={!promo.trim() || checking || locked}
                onClick={() => void applyPromo(false)}
              >
                {checking ? "Checking..." : "Apply"}
              </Button>
            )}
          </Flex>

          {promoNote ? (
            <Text
              id="promo-code-message"
              fontSize="15px"
              lineHeight="1.5"
              mt="8px"
              color={promoOn ? "green.600" : "red.500"}
              role={promoOn ? "status" : "alert"}
            >
              {promoNote}
            </Text>
          ) : null}

          {promoOn && appliesTo === "amount" && !customerChoice && (
            <Text
              fontSize="13px"
              color="teal.700"
              mt="4px"
              data-testid="promo-applies-to-amount"
            >
              Reduces your transfer amount by {curCode}{" "}
              {payablePromoDiscount.toFixed(digits)} (transfer fee unchanged).
            </Text>
          )}

          {/* Customer Choice RadioGroup (`discountBasis === "VALUE"` / `customerChoice === true`) */}
          {promoOn && customerChoice && rawPromoDiscount > 0 && (
            <Box
              mt="12px"
              p="12px"
              bg="gray.50"
              border="1px solid"
              borderColor="gray.200"
              borderRadius="10px"
              data-testid="promo-apply-radio-group"
            >
              <Text fontSize="14px" fontWeight="700" color="gray.800" mb="8px">
                How would you like to use this {curCode}{" "}
                {rawPromoDiscount.toFixed(digits)} discount?
              </Text>
              <RadioGroup
                aria-label="How would you like to apply your promo discount"
                value={promoApply}
                isDisabled={locked}
                onChange={(nextVal: string) => {
                  const mode: PromoApplyMode =
                    nextVal === "INCREASE_RECEIVE"
                      ? "INCREASE_RECEIVE"
                      : "REDUCE_SEND";
                  setPromoApply(mode);
                  writePromoCodeDraft({
                    code: promo.trim().toUpperCase(),
                    discount: rawPromoDiscount,
                    currency: curCode,
                    discountBasis,
                    customerChoice: true,
                    promoApply: mode,
                  });
                }}
              >
                <Stack direction="column" spacing="8px">
                  <Radio value="REDUCE_SEND" colorScheme="purple">
                    <Text fontSize="14px" fontWeight="600" color="gray.800">
                      Pay less{" "}
                      <Text as="span" fontWeight="400" color="gray.600">
                        — take {curCode} {payablePromoDiscount.toFixed(digits)}{" "}
                        off what you pay now
                      </Text>
                    </Text>
                  </Radio>
                  <Radio value="INCREASE_RECEIVE" colorScheme="purple">
                    <Text fontSize="14px" fontWeight="600" color="gray.800">
                      Add to recipient payout{" "}
                      <Text as="span" fontWeight="400" color="gray.600">
                        — add +{curCode} {rawPromoDiscount.toFixed(digits)}
                        {convertedBoostPreview} to what your recipient receives
                      </Text>
                    </Text>
                  </Radio>
                </Stack>
              </RadioGroup>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

export default RewardAtPayment;
