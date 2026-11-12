import { useState, useRef, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  AlertTriangle,
  CheckCircle2,
  Search,
  User,
  Building2,
  Plus,
  Loader2,
  ArrowRightLeft,
  AlertCircle,
  Download,
  Mail,
  QrCode,
  Share2,
  ShieldCheck,
  CalendarClock,
  ChevronDown,
  Eye,
  MessageCircle,
  Gift,
  Sparkles,
  X
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { knownSenders, type KnownSender } from "@/data/knownSenders";
import { PayoutAccountSelector } from "@/components/payout/PayoutAccountSelector";
import {
  createRequest, getCorridors, getRequests,
  getEligibility, getQuote, resendEmail, lastSuccessfulPayerAmount,
  type Corridor, type PayoutAccountView, type Quote, type MoneyRequestView,
} from "@/lib/requests";
import { fromMinorUnits } from "@shared/money";
import { PromoCodeField, usePromoCode, formatPromoMoney } from "@/features/promo";
import { useBonusSummary, formatMoney as formatBonusMoney } from "@/features/bonus";
import {
  computeExpiry,
  dateInTz,
  formatHumanDate,
  EXPIRY_TIMEZONE,
  EXPIRY_TIMEZONE_LABEL,
} from "@shared/invoice-logic";
import type { InvoiceExpiry } from "@shared/schema";
import { useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Cross-currency requests settle at the LIVE spot rate at payment time — the
 * server quote endpoint provides indicative figures for previews only.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "£",
  USD: "$",
  EUR: "€",
  NGN: "₦",
  KES: "KSh",
  GHS: "GH₵",
  ZAR: "R",
  EGP: "E£",
  TZS: "TSh",
  UGX: "USh",
  XOF: "CFA",
  RWF: "FRw",
};

/**
 * Common currencies offered to EVERY requester — majors plus the African
 * currencies Rhemito targets. The server generates demo corridors for any of
 * these lacking a reviewed corridor for the requester's country; currencies
 * from the requester's enabled corridors are unioned in as extra options.
 */
const COMMON_CURRENCIES = [
  "GBP", "USD", "EUR",
  "NGN", "KES", "GHS", "ZAR", "EGP", "TZS", "UGX", "XOF", "RWF",
];

const EXPIRY_OPTIONS = [
  { label: "7 days", value: "7" },
  { label: "14 days", value: "14" },
  { label: "30 days", value: "30" },
  { label: "60 days", value: "60" },
  { label: "Custom date", value: "custom" },
];

type ExpiryPeriod = "7" | "14" | "30" | "60" | "custom";

interface FormData {
  requestAmount: string;
  senderCurrency: string;
  selectedPayoutAccountId: string;
  /** true = requester receives the amount less charges; false = payer covers the fee on top. */
  absorbFee: boolean;
  senderType: "individual" | "business";
  /** Saved-sender ID when the payer was picked from the saved list (never inferred from name/email). */
  senderId: string;
  payerName: string;
  senderEmail: string;
  payerBankName: string;
  payerAccountNumber: string;
  invoiceReference: string;
  note: string;
  reason: string;
  otherReason: string;
  dueDate: string;
  expiryPeriod: ExpiryPeriod;
  customExpiryDate: string;
}

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
const isValidAccountNumber = (value: string) => /^\d{6,12}$/.test(value.trim());

function FieldTag({ required }: { required?: boolean }) {
  return required ? (
    <span className="ml-1.5 inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold leading-none text-destructive">
      Mandatory
    </span>
  ) : (
    <span className="ml-1.5 inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium leading-none text-muted-foreground">
      Optional
    </span>
  );
}

// Country dialing codes come from @/data/dialing-codes (full ISO list).

const steps = [
  { id: 1, title: "Amount & Currencies", description: "Set amount & payout destination" },
  { id: 2, title: "Payment request", description: "Add optional details and share your link" },
];

export default function RequestPayment() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();

  const requesterName = useMemo(() => {
    if (!user) return "John Doe";
    if (user.accountType === "business" && user.businessName) {
      return user.businessName;
    }
    const fullName = [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" ");
    return fullName || "John Doe";
  }, [user]);

  const [currentStep, setCurrentStep] = useState(1);
  const [isSuccess, setIsSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [paymentLink, setPaymentLink] = useState("");
  const [emailPaymentLink, setEmailPaymentLink] = useState("");
  const [createdRequestId, setCreatedRequestId] = useState("");
  const [showSenderList, setShowSenderList] = useState(false);
  const [showPayerDetails, setShowPayerDetails] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [createdRequestNumber, setCreatedRequestNumber] = useState("");
  const [restoredAmount, setRestoredAmount] = useState(false);
  const [receiveDraft, setReceiveDraft] = useState<string | null>(null);
  const [payerDraft, setPayerDraft] = useState<string | null>(null);
  const [showFxNoticeModal, setShowFxNoticeModal] = useState(false);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [selectedPayoutAccount, setSelectedPayoutAccount] = useState<PayoutAccountView | null>(null);
  const [payerBankCode, setPayerBankCode] = useState<string>("");
  const [payerVerifiedName, setPayerVerifiedName] = useState<string>("");
  const [verifyingPayerAccount, setVerifyingPayerAccount] = useState<boolean>(false);
  const [payerVerifyError, setPayerVerifyError] = useState<string>("");

  const handleSelectPayoutAccount = (account: PayoutAccountView) => {
    setSelectedPayoutAccount(account);
    setFormData(prev => ({ ...prev, selectedPayoutAccountId: account.id }));
  };

  const queryClient = useQueryClient();

  // Eligibility is server-authoritative: real session, mini-KYC passed, and a
  // verified payout account owned by the requester.
  const eligibilityQuery = useQuery<{ kind: "ok"; eligible: boolean; reasons: string[]; country: string } | { kind: "unauthenticated" }>({
    queryKey: ["/api/request-money/eligibility"],
    queryFn: async () => {
      try {
        const data = await getEligibility();
        return { kind: "ok" as const, eligible: data.eligible, reasons: data.reasons, country: data.country };
      } catch (err) {
        if ((err as { status?: number }).status === 401) return { kind: "unauthenticated" } as const;
        throw err;
      }
    },
    retry: false,
    refetchOnMount: "always",
  });

  const corridorsQuery = useQuery<Corridor[] | undefined>({
    queryKey: ["/api/request-money/corridors"],
    queryFn: async () => {
      try {
        return await getCorridors();
      } catch (err) {
        if ((err as { status?: number }).status === 401) return undefined;
        throw err;
      }
    },
    enabled: eligibilityQuery.data?.kind === "ok",
    retry: false,
    refetchOnMount: "always",
  });

  const [formData, setFormData] = useState<FormData>({
    requestAmount: "",
    senderCurrency: "GBP",
    selectedPayoutAccountId: "",
    absorbFee: true,
    senderType: "individual",
    senderId: "",
    payerName: "",
    senderEmail: "",
    payerBankName: "",
    payerAccountNumber: "",
    invoiceReference: "",
    note: "",
    reason: "",
    otherReason: "",
    dueDate: "",
    expiryPeriod: "30",
    customExpiryDate: "",
  });

  // Default expiry selection: 7 days after Due Date, or 30 days after the
  // request date — until the requester makes an explicit choice.
  const [expiryTouched, setExpiryTouched] = useState(false);
  useEffect(() => {
    if (!expiryTouched) {
      setFormData(prev => ({ ...prev, expiryPeriod: prev.dueDate ? "7" : "30" }));
    }
  }, [formData.dueDate, expiryTouched]);

  // Sender currency options: the common list (majors + African currencies) for
  // every requester, unioned with any extra currencies the requester's enabled
  // corridors support.
  const enabledPayInCurrencies = useMemo(() => {
    const corridors = corridorsQuery.data ?? [];
    const seen: string[] = [];
    for (const c of corridors) {
      if (c.enabled && !seen.includes(c.payInCurrency)) seen.push(c.payInCurrency);
    }
    return seen;
  }, [corridorsQuery.data]);

  const currencyOptions = useMemo(() => {
    const options = [...COMMON_CURRENCIES];
    for (const currency of enabledPayInCurrencies) {
      if (!options.includes(currency)) options.push(currency);
    }
    return options;
  }, [enabledPayInCurrencies]);

  const knownSenderName = (sender: KnownSender) =>
    sender.senderType === "business"
      ? sender.businessName
      : [sender.firstName, sender.middleName, sender.lastName].filter(Boolean).join(" ");
  const knownSenderId = (sender: KnownSender) => sender.id ?? sender.uniqueCode ?? sender.email;

  const selectKnownSender = (sender: KnownSender) => {
    setFormData(prev => ({
      ...prev,
      senderType: sender.senderType,
      senderId: knownSenderId(sender),
      payerName: knownSenderName(sender),
      senderEmail: sender.email,
      payerBankName: sender.bankName || prev.payerBankName,
      payerAccountNumber: sender.accountNumber ? sender.accountNumber.replace(/\D/g, "") : prev.payerAccountNumber,
    }));
    setShowSenderList(false);
  };

  // Typing a different email detaches the previously selected sender so the
  // request never carries one payer's name/ID with another payer's email.
  const handlePayerEmailChange = (value: string) => {
    setFormData(prev => {
      if (!prev.senderId) return { ...prev, senderEmail: value };
      const current = knownSenders.find(s => knownSenderId(s) === prev.senderId);
      if (current && current.email.toLowerCase() === value.trim().toLowerCase()) {
        return { ...prev, senderEmail: value };
      }
      return { ...prev, senderEmail: value, senderId: "", payerName: "", senderType: "individual" };
    });
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const senderEmail = params.get("sender");
    if (senderEmail) {
      const sender = knownSenders.find(s => s.email === senderEmail);
      if (sender) selectKnownSender(sender);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const payoutCurrency = selectedPayoutAccount?.currency || "GBP";
  const senderCurrency = formData.senderCurrency;

  // Indicative quote from the server (live-first). Cross-currency previews
  // never assume 1:1 — if no quote is available the notice stays qualitative.
  const [indicativeQuote, setIndicativeQuote] = useState<Quote | null>(null);
  const corridorForSelection = useMemo(() => {
    const corridors = corridorsQuery.data ?? [];
    return corridors.find(
      (c) => c.enabled && c.payInCurrency === senderCurrency && c.payoutCurrency === payoutCurrency,
    );
  }, [corridorsQuery.data, senderCurrency, payoutCurrency]);

  // One-shot alignment once corridors AND a payout account are known: when the
  // default currency has no enabled corridor for the selected payout account,
  // prefer the account's currency (e.g. a Kenyan requester with a KES account
  // lands on KES instead of dead-ending on the GBP default). Afterwards the
  // user's explicit choice always wins — the corridor notice informs instead.
  const currencyAlignedRef = useRef(false);
  useEffect(() => {
    if (currencyAlignedRef.current || enabledPayInCurrencies.length === 0 || !selectedPayoutAccount) return;
    currencyAlignedRef.current = true;
    if (corridorForSelection) return;
    const accountCurrency = selectedPayoutAccount.currency;
    const preferred = currencyOptions.includes(accountCurrency) ? accountCurrency : currencyOptions[0];
    setFormData(prev => ({ ...prev, senderCurrency: preferred }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledPayInCurrencies.join(","), selectedPayoutAccount, corridorForSelection]);
  useEffect(() => {
    let cancelled = false;
    if (!corridorForSelection) {
      setIndicativeQuote(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const q = await getQuote(corridorForSelection.id, parseFloat(formData.requestAmount) > 0 ? formData.requestAmount : "100", formData.absorbFee);
        if (!cancelled) setIndicativeQuote(q);
      } catch {
        if (!cancelled) setIndicativeQuote(null);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [corridorForSelection?.id, formData.requestAmount, formData.absorbFee]);

  const getExchangeRate = () => {
    if (senderCurrency === payoutCurrency) return 1;
    return indicativeQuote?.fxRate ?? NaN; // NaN → show "Live Spot Rate at Payout" only
  };

  const parsedAmount = parseFloat(formData.requestAmount) || 0;
  const platformFeeRate = 0.03; // 3% fee — absorbed by the requester or added to the sender's payment
  const platformFeeAmount = parsedAmount * platformFeeRate;
  const senderPaysAmount = formData.absorbFee ? parsedAmount : parsedAmount + platformFeeAmount;
  const netBeforeFx = formData.absorbFee ? parsedAmount - platformFeeAmount : parsedAmount;
  const fxRate = getExchangeRate();
  const netPayoutAmount = Number.isFinite(fxRate) ? netBeforeFx * fxRate : 0;

  const senderSymbol = CURRENCY_SYMBOLS[senderCurrency] || "";
  const payoutSymbol = CURRENCY_SYMBOLS[payoutCurrency] || "";

  // Payer bank list for beneficiary-style verification in Step 2 (especially Nigeria NGN 10-digit NUBAN)
  const payerBankCountry = useMemo(() => {
    const map: Record<string, string> = { NGN: "NG", GBP: "GB", USD: "US", CAD: "CA" };
    return map[senderCurrency] || "NG";
  }, [senderCurrency]);

  const payerBanksQuery = useQuery<{ country: string; banks: Array<{ code: string; name: string }> }>({
    queryKey: [`/api/banks?country=${payerBankCountry}`],
    queryFn: async () => {
      const res = await fetch(`/api/banks?country=${encodeURIComponent(payerBankCountry)}`, { credentials: "include" });
      if (!res.ok) return { country: payerBankCountry, banks: [] };
      return res.json();
    },
    enabled: showPayerDetails,
    staleTime: 60_000,
  });

  useEffect(() => {
    const digits = formData.payerAccountNumber.replace(/\D/g, "");
    const bankName = formData.payerBankName.trim();
    const minLen = senderCurrency === "NGN" ? 10 : 8;
    if (!bankName || digits.length < minLen) {
      setPayerVerifiedName("");
      setPayerVerifyError("");
      setVerifyingPayerAccount(false);
      return;
    }
    let cancelled = false;
    setVerifyingPayerAccount(true);
    setPayerVerifyError("");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/banks/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            bankCode: payerBankCode || bankName,
            accountNumber: digits,
            country: payerBankCountry,
            payerNameHint: formData.payerName.trim() || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.verified && data.accountName) {
          setPayerVerifiedName(String(data.accountName));
          setFormData((prev) => ({
            ...prev,
            payerName: prev.payerName.trim() ? prev.payerName : String(data.accountName),
          }));
        } else {
          setPayerVerifiedName("");
          setPayerVerifyError(data.message || "Could not verify account details.");
        }
      } catch {
        if (!cancelled) {
          setPayerVerifiedName("");
        }
      } finally {
        if (!cancelled) setVerifyingPayerAccount(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [formData.payerBankName, formData.payerAccountNumber, payerBankCode, payerBankCountry, senderCurrency]);

  // RM-03: the minimum comes from the selected corridor (authoritative config), in the payer currency.
  const minAmount = corridorForSelection
    ? Number(fromMinorUnits(corridorForSelection.minAmountMinor, senderCurrency))
    : null;
  const belowMin = parsedAmount > 0 && minAmount !== null && parsedAmount < minAmount;
  const fxFinite = Number.isFinite(fxRate) && fxRate > 0;
  const receiveInPayout = fxFinite ? netBeforeFx * fxRate : NaN;
  const receiveDisplay = receiveDraft ?? (fxFinite && parsedAmount > 0 ? receiveInPayout.toFixed(2) : "");
  // "Payer sends" shows what the payer is actually charged (incl. the 3% fee in
  // "exact amount" mode), so it always agrees with the breakdown card.
  const payerDisplay = payerDraft ?? (parsedAmount > 0 ? senderPaysAmount.toFixed(2) : formData.requestAmount);

  // Receive Money promo code: earns a bonus on "You receive" (net, in the receiving currency). Mito works the bonus out and
  // credits it to the bonus balance once the request is paid out.
  const [showPromoModal, setShowPromoModal] = useState(false);
  const promo = usePromoCode({
    amount: fxFinite && receiveInPayout > 0 ? Number(receiveInPayout.toFixed(2)) : 0,
    fee: 0,
    sendCurrency: payoutCurrency,
    receiveCurrency: payoutCurrency,
    paymentMethod: null,
    flow: "receive",
  });
  const promoApplied = promo.applied;
  const promoBonus = promoApplied ? promo.discount : 0;
  const promoCode = promo.appliedCode ?? "";

  // RM-01: restore the payer send amount from the latest SUCCESSFUL (paid out) Receive Money request.
  const requestsQuery = useQuery<MoneyRequestView[] | undefined>({
    queryKey: ["/api/request-money/requests"],
    queryFn: async () => {
      try {
        return await getRequests();
      } catch (err) {
        if ((err as { status?: number }).status === 401) return undefined;
        throw err;
      }
    },
    enabled: eligibilityQuery.data?.kind === "ok",
    retry: false,
    refetchOnMount: "always",
  });
  const amountTouchedRef = useRef(false);
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || amountTouchedRef.current) return;
    if (!requestsQuery.data || !corridorsQuery.data) return;
    restoredRef.current = true;
    const last = lastSuccessfulPayerAmount(requestsQuery.data);
    if (!last || !currencyOptions.includes(last.currency)) return;
    currencyAlignedRef.current = true;
    setFormData((prev) => ({ ...prev, requestAmount: last.amount, senderCurrency: last.currency }));
    setRestoredAmount(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestsQuery.data, corridorsQuery.data, currencyOptions]);

  const handleAmountChange = (value: string) => {
    amountTouchedRef.current = true;
    setRestoredAmount(false);
    setReceiveDraft(null);
    setPayerDraft(value);
    const v = parseFloat(value);
    if (!Number.isFinite(v) || v <= 0) {
      handleInputChange("requestAmount", "");
      return;
    }
    handleInputChange("requestAmount", value);
  };

  // Editing "You receive" sets the base request amount and recalculates both boxes per the selected fee option.
  const handleReceiveChange = (value: string) => {
    amountTouchedRef.current = true;
    setRestoredAmount(false);
    setReceiveDraft(value);
    setPayerDraft(null);
    const v = parseFloat(value);
    if (!Number.isFinite(v) || v <= 0 || !fxFinite) {
      handleInputChange("requestAmount", "");
      return;
    }
    const baseInSender = fxRate === 1 ? value : (v / fxRate).toFixed(2);
    handleInputChange("requestAmount", baseInSender);
  };

  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  const handleInputChange = (field: keyof FormData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  /**
   * The Due Date and the custom expiry date can never conflict: moving the Due
   * Date past an existing custom expiry bumps that expiry up to the Due Date,
   * and a custom expiry entered before the Due Date is normalised up to it.
   * (The backend still validates the rule authoritatively.)
   */
  const handleDueDateChange = (value: string) => {
    setFormData((prev) => {
      const next = { ...prev, dueDate: value };
      if (
        value &&
        prev.expiryPeriod === "custom" &&
        prev.customExpiryDate &&
        prev.customExpiryDate < value
      ) {
        next.customExpiryDate = value;
      }
      return next;
    });
  };

  const handleCustomExpiryChange = (value: string) => {
    setFormData((prev) => ({
      ...prev,
      customExpiryDate: value && prev.dueDate && value < prev.dueDate ? prev.dueDate : value,
    }));
  };

  const expirySelection: InvoiceExpiry = useMemo(() => {
    if (formData.expiryPeriod === "custom") {
      return { type: "custom", date: formData.customExpiryDate };
    }
    return { type: "preset", days: Number(formData.expiryPeriod) as 7 | 14 | 30 | 60 };
  }, [formData.expiryPeriod, formData.customExpiryDate]);

  const computedExpiry = useMemo(() => {
    if (formData.expiryPeriod === "custom" && !formData.customExpiryDate) return null;
    return computeExpiry(formData.dueDate || null, expirySelection, new Date());
  }, [formData.dueDate, formData.expiryPeriod, formData.customExpiryDate, expirySelection]);

  // Client-side mirror of the backend validation (backend is authoritative).
  // Computed live so problems surface as the requester types, not only on submit.
  const dateErrors = useMemo(() => {
    const errors: { dueDate?: string; expiry?: string } = {};
    const today = dateInTz(new Date(), EXPIRY_TIMEZONE);

    if (formData.dueDate && formData.dueDate < today) {
      errors.dueDate = "The Due Date cannot be in the past.";
    }
    if (!computedExpiry) {
      errors.expiry = "Select a future Payment Link Expiry Date.";
      return errors;
    }
    if (computedExpiry.expiryDate <= today) {
      errors.expiry = "Select a future Payment Link Expiry Date.";
    } else if (formData.dueDate && computedExpiry.expiryDate < formData.dueDate) {
      // Defensive: the inputs above normalise the dates so this cannot normally
      // occur — kept as a safety net before the backend's authoritative check.
      errors.expiry = "The Payment Link Expiry Date cannot be earlier than the Due Date.";
    }
    return errors;
  }, [formData.dueDate, formData.expiryPeriod, formData.customExpiryDate, computedExpiry]);

  const today = useMemo(() => dateInTz(new Date(), EXPIRY_TIMEZONE), []);

  const emailError =
    formData.senderEmail.trim() !== "" && !isValidEmail(formData.senderEmail)
      ? "Enter a valid email such as name@example.com."
      : "";
  const accountError =
    formData.payerAccountNumber.trim() !== "" && !isValidAccountNumber(formData.payerAccountNumber)
      ? "Enter the account number using 6 to 12 digits."
      : "";
  const hasEmail = formData.senderEmail.trim() !== "";

  const canContinueStep1 =
    parsedAmount > 0 &&
    !belowMin &&
    !!selectedPayoutAccount &&
    selectedPayoutAccount.verificationStatus === "verified" &&
    !!corridorForSelection;

  // Mandatory on this step: purpose of payment (cross-border compliance) and a valid link expiry.
  // Everything else (payer, invoice, bank details) is optional.
  const canCreate =
    !!formData.reason &&
    (formData.reason !== "other" || !!formData.otherReason.trim()) &&
    !emailError &&
    !accountError &&
    Object.keys(dateErrors).length === 0 &&
    !isSubmittingRequest &&
    !isSendingEmail;
  const canSendEmail = canCreate && hasEmail;

  const describeError = (err: unknown) =>
    (err instanceof Error ? err.message : undefined) ??
    (typeof err === "string" ? err : undefined) ??
    (typeof (err as { message?: unknown })?.message === "string" ? (err as { message: string }).message : undefined) ??
    "Something went wrong. Please try again.";

  /** Creates the request once (idempotent). Returns the new/existing request id, or null on failure. */
  const createLink = async (): Promise<string | null> => {
    if (createdRequestId) return createdRequestId;
    if (isSubmittingRequest || !corridorForSelection || !selectedPayoutAccount) return null;
    setIsSubmittingRequest(true);
    if (promoApplied) promo.lock();
    try {
      const reference =
        [
          formData.note.trim() || null,
          formData.invoiceReference.trim() ? `Invoice: ${formData.invoiceReference.trim()}` : null,
          formData.reason === "other" && formData.otherReason.trim() ? `Reason: ${formData.otherReason.trim()}` : null,
        ]
          .filter(Boolean)
          .join(" | ")
          .slice(0, 140) || undefined;
      const result = await createRequest({
        corridorId: corridorForSelection.id,
        payoutAccountId: selectedPayoutAccount.id,
        payInAmount: parsedAmount.toFixed(2),
        senderType: formData.senderType,
        senderName: formData.payerName.trim() || undefined,
        senderEmail: formData.senderEmail.trim() || undefined,
        senderId: formData.senderId || undefined,
        payerBankName: formData.payerBankName.trim() || undefined,
        payerAccountNumber: formData.payerAccountNumber.trim() || undefined,
        purpose: formData.reason as never,
        reference,
        absorbFee: formData.absorbFee,
        dueDate: formData.dueDate || undefined,
        expiry: expirySelection,
        idempotencyKey: idempotencyKeyRef.current,
        ...(promoApplied && promoCode ? { promoCode } : {}),
      });
      setPaymentLink(result.checkoutUrl);
      setEmailPaymentLink(result.emailCheckoutUrl || result.checkoutUrl);
      setCreatedRequestId(result.request.id);
      setCreatedRequestNumber(result.request.requestNumber);
      void queryClient.invalidateQueries({ queryKey: ["/api/request-money/requests"] });
      return result.request.id;
    } catch (err) {
      if (promoApplied) promo.reject(describeError(err));
      toast({ title: "Payment link not created", description: describeError(err), variant: "destructive" });
      return null;
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  const sendEmailFor = async (id: string): Promise<boolean> => {
    setIsSendingEmail(true);
    try {
      await resendEmail(id, { email: formData.senderEmail.trim(), name: formData.payerName.trim() || undefined });
      setEmailSent(true);
      toast({ title: "Email sent", description: `The payment request was emailed to ${formData.senderEmail.trim()}.` });
      return true;
    } catch (err) {
      toast({
        title: "Email not sent",
        description: `${describeError(err)} Your payment link is still ready to copy.`,
        variant: "destructive",
      });
      return false;
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleCreateLink = async () => {
    const id = await createLink();
    if (!id) return;
    setIsSuccess(true);
    toast({ title: "Payment link created", description: "Copy it, share it on WhatsApp, or send it by email." });
  };

  const handleSendEmail = async () => {
    if (emailSent) return;
    if (!hasEmail || emailError) {
      toast({ title: "Check the payer email", description: emailError || "Enter the payer's email to send the request.", variant: "destructive" });
      return;
    }
    const alreadyCreated = !!createdRequestId;
    const id = await createLink();
    if (!id) return;
    await sendEmailFor(id);
    if (!alreadyCreated) {
      setIsSuccess(true);
    }
  };

  const handleNext = () => {
    if (!selectedPayoutAccount || selectedPayoutAccount.verificationStatus !== "verified") {
      toast({
        title: "Active Settlement Bank Account Required",
        description: "Please add or select a verified destination settlement bank account before proceeding.",
        variant: "destructive",
      });
      return;
    }
    if (parsedAmount <= 0) {
      toast({ title: "Amount Required", description: "Please enter an amount to request.", variant: "destructive" });
      return;
    }
    if (belowMin) {
      toast({
        title: "Amount below the minimum",
        description: `The payer must send at least ${senderSymbol}${(minAmount ?? 0).toFixed(2)}.`,
        variant: "destructive",
      });
      return;
    }
    if (!corridorForSelection) {
      toast({
        title: "Corridor Unavailable",
        description: "This currency route is currently unavailable for your account.",
        variant: "destructive",
      });
      return;
    }
    if (senderCurrency !== payoutCurrency) {
      setShowFxNoticeModal(true);
      return;
    }
    setCurrentStep(2);
  };

  const handleConfirmFxAndProceed = () => {
    setShowFxNoticeModal(false);
    setCurrentStep(2);
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    } else {
      setLocation("/");
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(paymentLink);
      setCopied(true);
      setCopyFailed(false);
      toast({ title: "Link copied", description: "The payment link is on your clipboard." });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
      toast({
        title: "Could not copy automatically",
        description: "Select the link shown below and copy it manually.",
        variant: "destructive",
      });
    }
  };

  const handleWhatsApp = () => {
    const text = `Payment request from ${requesterName}. ${paymentLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    toast({ title: "Opening WhatsApp", description: "Your payment link is ready to send." });
  };

  const handleShareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Rhemito money request", text: "Please pay this Rhemito request", url: paymentLink });
      } catch {
        // user cancelled
      }
    } else {
      void handleCopyLink();
    }
  };

  const resetForm = () => {
    setFormData({
      requestAmount: "",
      senderCurrency: "GBP",
      selectedPayoutAccountId: "",
      absorbFee: true,
      senderType: "individual",
      senderId: "",
      payerName: "",
      senderEmail: "",
      payerBankName: "",
      payerAccountNumber: "",
      invoiceReference: "",
      note: "",
      reason: "",
      otherReason: "",
      dueDate: "",
      expiryPeriod: "30",
      customExpiryDate: "",
    });
    setSelectedPayoutAccount(null);
    setCurrentStep(1);
    setIsSuccess(false);
    setEmailSent(false);
    setPaymentLink("");
    setEmailPaymentLink("");
    setCreatedRequestId("");
    setCreatedRequestNumber("");
    setShowPayerDetails(false);
    setShowSenderList(false);
    setReceiveDraft(null);
    setRestoredAmount(false);
    setCopyFailed(false);
    setExpiryTouched(false);
    amountTouchedRef.current = true; // do not re-restore the previous amount for a deliberate fresh request
    currencyAlignedRef.current = false;
    idempotencyKeyRef.current = crypto.randomUUID();
  };

  // Server-authoritative eligibility gates
  if (eligibilityQuery.isLoading) {
    return (
      <DashboardLayout>
        <div className="max-w-2xl mx-auto py-20 text-center text-muted-foreground text-sm">Checking your eligibility…</div>
      </DashboardLayout>
    );
  }



  const previewDialog = (
    <Dialog open={showPreview} onOpenChange={setShowPreview}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto" data-testid="dialog-preview">
        <DialogHeader className="items-center text-center space-y-1">
          <p className="text-xs font-extrabold tracking-[0.14em] uppercase text-primary">Rhemito Payment</p>
          <DialogTitle className="font-display text-lg text-slate-900">
            Payment request from{" "}
            <span className="block" data-testid="preview-requester-name">{requesterName}</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Ref {createdRequestNumber || "pending"} · Preview only, no new request is created
          </DialogDescription>
        </DialogHeader>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">You pay</p>
          <p className="text-3xl font-extrabold font-display text-primary tabular-nums" data-testid="preview-amount">
            {senderSymbol}{senderPaysAmount.toFixed(2)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Requested amount</span><span className="font-medium tabular-nums whitespace-nowrap">{senderSymbol}{parsedAmount.toFixed(2)}</span></div>
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Transaction fee (3%)</span><span className="font-medium tabular-nums whitespace-nowrap">{formData.absorbFee ? "Paid by requester" : `+${senderSymbol}${platformFeeAmount.toFixed(2)}`}</span></div>
          {senderCurrency !== payoutCurrency && fxFinite && (
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Exchange rate (indicative)</span><span className="font-medium tabular-nums">{fxRate.toFixed(4)} {payoutCurrency} per {senderCurrency}</span></div>
          )}
          <div className="flex justify-between gap-4 border-t border-dashed border-border pt-2 font-semibold text-primary">
            <span>They receive in bank</span>
            <span className="tabular-nums whitespace-nowrap">
              {senderCurrency === payoutCurrency
                ? `${payoutSymbol}${netBeforeFx.toFixed(2)}`
                : fxFinite ? `${payoutSymbol}${receiveInPayout.toFixed(2)}` : "Live rate at payout"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">Paid into {selectedPayoutAccount?.bankName} {selectedPayoutAccount?.maskedNumber}</p>
        </div>
        <Button disabled className="w-full h-11">Pay now</Button>
        <Button variant="outline" className="w-full" onClick={() => setShowPreview(false)} data-testid="button-close-preview">
          Close preview
        </Button>
      </DialogContent>
    </Dialog>
  );

  if (isSuccess) {
    return (
      <DashboardLayout>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl mx-auto pb-24">
          <div className="mb-4 md:mb-6">
            <h1 className="text-xl md:text-2xl font-bold font-display text-slate-900">Receive Money</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Your request is ready. Copy the link into any messaging app, or send it by email.
            </p>
          </div>

          <Card className="border-border shadow-sm">
            <CardContent className="space-y-5 p-5 md:p-6">
              <div className="flex items-center gap-2.5 rounded-xl bg-teal/10 px-3.5 py-2.5 text-sm font-semibold text-teal" role="status" data-testid="banner-link-created">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                Payment link created
              </div>

              <div>
                <h2 className="font-display text-lg font-bold text-slate-900">Payment link</h2>
                <p className="text-xs text-muted-foreground" data-testid="text-link-summary">
                  {senderSymbol}{parsedAmount.toFixed(2)} · {createdRequestNumber}
                  {computedExpiry ? ` · Expires ${formatHumanDate(computedExpiry.expiryDate)}` : ""}
                </p>
              </div>

              <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3" data-testid="qr-panel">
                <Input
                  value={paymentLink}
                  readOnly
                  onFocus={(e) => e.currentTarget.select()}
                  className="bg-card font-mono text-sm"
                  aria-label="Payment link"
                  data-testid="input-payment-link"
                />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleCopyLink} className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground" data-testid="button-copy-link">
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                  <Button variant="outline" onClick={() => setShowPreview(true)} className="gap-1.5 border-primary text-primary hover:text-primary" data-testid="button-preview">
                    <Eye className="w-4 h-4" /> Preview
                  </Button>
                  <Button onClick={handleWhatsApp} className="gap-1.5 bg-[hsl(142,70%,36%)] hover:bg-[hsl(142,70%,32%)] text-white" data-testid="button-share-whatsapp">
                    <MessageCircle className="w-4 h-4" /> Share on WhatsApp
                  </Button>
                  <Button variant="outline" onClick={handleShareLink} className="gap-1.5" data-testid="button-share">
                    <Share2 className="w-4 h-4" /> Share
                  </Button>
                </div>
                {copyFailed && (
                  <p className="text-xs text-destructive break-all" role="alert" data-testid="text-copy-fallback">
                    Copying was blocked. Select this link and copy it manually: {paymentLink}
                  </p>
                )}
                {createdRequestId && (
                  <div className="flex flex-col sm:flex-row items-center gap-4 pt-1 border-t border-border/60">
                    <img
                      src={`/api/request-money/requests/${createdRequestId}/qr.png`}
                      alt="QR code for money request"
                      className="w-28 h-28 border border-border rounded-xl bg-white"
                      data-testid="img-qr"
                    />
                    <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
                      <Button variant="outline" size="sm" onClick={() => window.open(`/api/request-money/requests/${createdRequestId}/qr.png`, "_blank")} data-testid="button-download-qr-png">
                        <Download className="w-3.5 h-3.5 mr-1.5" /> QR (PNG)
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => window.open(`/api/request-money/requests/${createdRequestId}/qr.svg`, "_blank")} data-testid="button-download-qr-svg">
                        <QrCode className="w-3.5 h-3.5 mr-1.5" /> QR (SVG)
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {!emailSent && (
                <div className="space-y-1.5">
                  <Label htmlFor="payerEmailAfter" className="text-sm font-semibold">
                    Payer email <FieldTag />
                  </Label>
                  <Input
                    id="payerEmailAfter"
                    type="email"
                    autoComplete="off"
                    placeholder="Enter Payer's email to send email request"
                    value={formData.senderEmail}
                    onChange={(e) => handlePayerEmailChange(e.target.value)}
                    aria-invalid={!!emailError}
                    data-testid="input-payer-email-after"
                  />
                  {emailError && <p className="text-xs text-destructive" role="alert" data-testid="error-payer-email-after">{emailError}</p>}
                  {hasEmail && (
                    <Button
                      onClick={handleSendEmail}
                      disabled={!!emailError || isSendingEmail}
                      className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground"
                      data-testid="button-resend-email"
                    >
                      {isSendingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                      {isSendingEmail ? "Sending…" : "Send email"}
                    </Button>
                  )}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 border-t border-border/60 pt-4 sm:flex-row">
                <Button variant="outline" className="flex-1" onClick={() => setLocation("/")} data-testid="button-back-to-dashboard">
                  Back to Dashboard
                </Button>
                <Button variant="outline" className="flex-1 border-primary text-primary hover:text-primary" onClick={resetForm} data-testid="button-new-request">
                  Create another request
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
        {previewDialog}
      </DashboardLayout>
    );
  }

  const stickyBar =
    "flex gap-3 pt-4 border-t border-border/60 sticky bottom-0 z-10 -mx-5 md:-mx-6 px-5 md:px-6 py-3 bg-background/95 backdrop-blur md:static md:bg-transparent md:backdrop-blur-none";

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto pb-24">
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="mb-4 md:mb-6">
          <Button
            variant="ghost"
            onClick={handleBack}
            className="mb-2 md:mb-3 -ml-2 text-sm text-muted-foreground hover:text-foreground"
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4 mr-1 md:mr-2" />
            Back
          </Button>
          <h1 className="text-xl md:text-2xl font-bold font-display text-slate-900">Receive Money</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Set up a request to receive money from friends, family or for an invoice, paid straight to your verified bank account.
          </p>
        </motion.div>

        {/* Step Indicator */}
        <div className="flex items-center mb-6 md:mb-8 overflow-x-auto pb-2 no-scrollbar" aria-label="Progress">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center flex-shrink-0">
              <div className="flex items-center gap-2 md:gap-3">
                <motion.div
                  initial={false}
                  animate={{
                    backgroundColor: currentStep >= step.id ? "hsl(var(--primary))" : "hsl(var(--muted))",
                    color: currentStep >= step.id ? "white" : "hsl(var(--muted-foreground))",
                  }}
                  className="w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center text-xs md:text-sm font-semibold shrink-0"
                >
                  {currentStep > step.id ? <Check className="w-3.5 h-3.5 md:w-4 md:h-4" /> : step.id}
                </motion.div>
                <div>
                  <p className={`text-xs md:text-sm font-medium leading-tight ${currentStep >= step.id ? "text-foreground" : "text-muted-foreground"}`}>
                    {step.title}
                  </p>
                  <p className="hidden sm:block text-[11px] text-muted-foreground">{step.description}</p>
                </div>
              </div>
              {index < steps.length - 1 && (
                <div className={`w-8 md:w-16 h-0.5 mx-2 md:mx-4 ${currentStep > step.id ? "bg-primary" : "bg-muted"}`} />
              )}
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 15 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -15 }}
            transition={{ duration: 0.18 }}
          >
            <Card className="border-border shadow-sm">
              <CardHeader className="px-5 md:px-6 py-4 md:py-5 border-b border-border/50">
                <CardTitle className="font-display text-base md:text-lg">{steps[currentStep - 1].title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 px-5 md:px-6 pt-6">

                {/* ================= STEP 1: AMOUNT & CURRENCIES ================= */}
                {currentStep === 1 && (
                  <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    <div className="lg:col-span-3 space-y-6">
                      <PayoutAccountSelector
                        requesterName={requesterName}
                        selectedAccountId={selectedPayoutAccount?.id ?? ""}
                        onSelect={handleSelectPayoutAccount}
                        context="request"
                      />

                      {(!selectedPayoutAccount || selectedPayoutAccount.verificationStatus !== "verified") && (
                        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-xs text-amber-900 font-medium" data-testid="alert-payout-account-required">
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-semibold text-amber-950">Active Destination Settlement Bank Account Required</p>
                            <p className="text-[11px] text-amber-900/80 mt-0.5">
                              You cannot proceed with a money request without an active, verified destination settlement bank account. Please select or add an account above.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* How should this request work? */}
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-700">How should this request work?</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="group" aria-label="Request type">
                          <button
                            type="button"
                            aria-pressed={!formData.absorbFee}
                            onClick={() => { setReceiveDraft(null); setPayerDraft(null); handleInputChange("absorbFee", false); }}
                            className={`text-left rounded-xl border-2 p-3.5 min-h-[44px] transition-colors ${!formData.absorbFee ? "border-primary bg-primary/5" : "border-border bg-card hover:border-slate-300"}`}
                            data-testid="mode-exact"
                          >
                            <span className={`block text-sm font-bold font-display ${!formData.absorbFee ? "text-primary" : "text-slate-900"}`}>Receive exact amount</span>
                            <span className="block text-xs text-muted-foreground">The payer will cover all fees and commission (3%) on top.</span>
                          </button>
                          <button
                            type="button"
                            aria-pressed={formData.absorbFee}
                            onClick={() => { setReceiveDraft(null); setPayerDraft(null); handleInputChange("absorbFee", true); }}
                            className={`text-left rounded-xl border-2 p-3.5 min-h-[44px] transition-colors ${formData.absorbFee ? "border-primary bg-primary/5" : "border-border bg-card hover:border-slate-300"}`}
                            data-testid="mode-less"
                          >
                            <span className={`block text-sm font-bold font-display ${formData.absorbFee ? "text-primary" : "text-slate-900"}`}>Receive amount less charges</span>
                            <span className="block text-xs text-muted-foreground">All the fees and commission will be charged from the amount you receive.</span>
                          </button>
                        </div>
                      </div>

                      {/* You receive */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between min-h-[28px]">
                          <Label htmlFor="receiveAmount" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-800 leading-none">
                            <span>You receive</span>
                            <span className="text-destructive">*</span>
                            <FieldTag required />
                          </Label>
                          {promo.enabled && (
                            promoApplied ? (
                              <div className="inline-flex items-center gap-2 h-7 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2.5 rounded-full" data-testid="request-promo-applied-pill">
                                <Check className="w-3.5 h-3.5 text-green-600" />
                                <span>Promo <strong className="font-mono">{promoCode}</strong> (+{formatPromoMoney(promoBonus, payoutCurrency)} bonus)</span>
                                <button type="button" onClick={() => setShowPromoModal(true)} className="text-blue-600 hover:underline ml-1">Change</button>
                                <button type="button" onClick={promo.remove} className="text-gray-500 hover:text-red-600 ml-0.5" aria-label="Remove promo code">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setShowPromoModal(true)}
                                data-testid="request-use-promo-btn"
                                className="inline-flex items-center gap-1.5 h-7 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100/80 border border-blue-200/80 px-3 rounded-full transition-colors"
                              >
                                <span>🏷️ Use Promo Code</span>
                              </button>
                            )
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="relative flex-1">
                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">{payoutSymbol}</span>
                            <Input
                              id="receiveAmount"
                              type="number"
                              min="0"
                              step="any"
                              inputMode="decimal"
                              placeholder={fxFinite ? "0.00" : !corridorForSelection ? "Route not available" : "Loading rate…"}
                              value={receiveDisplay}
                              disabled={!fxFinite}
                              onChange={(e) => handleReceiveChange(e.target.value)}
                              onKeyUp={(e) => handleReceiveChange((e.currentTarget as HTMLInputElement).value)}
                              onBlur={() => setReceiveDraft(null)}
                              className={`${payoutSymbol.length > 1 ? "pl-14" : "pl-8"} text-xl md:text-2xl font-bold tabular-nums h-12 md:h-14 bg-white shadow-sm`}
                              data-testid="input-receive-amount"
                            />
                          </div>
                          <div className="w-28 md:w-32 h-12 md:h-14 shrink-0 rounded-md border border-input bg-muted flex items-center justify-center font-bold text-base" data-testid="text-receive-currency">
                            {payoutCurrency}
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {!corridorForSelection
                            ? `No rate is available for ${senderCurrency} to ${payoutCurrency}. Choose a different payer currency or settlement account.`
                            : senderCurrency === payoutCurrency ? "Calculated from what the payer sends." : "Indicative. The live rate at payment time applies."}
                        </p>
                      </div>

                      {showPromoModal && (
                        <div
                          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                          onClick={() => setShowPromoModal(false)}
                          data-testid="request-promo-modal"
                        >
                          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between border-b pb-3">
                              <h3 className="text-base font-bold text-gray-900">Insert Promo Code</h3>
                              <button type="button" onClick={() => setShowPromoModal(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg" aria-label="Close promo code modal">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                            <p className="text-xs text-gray-500">
                              Have a promo code? Enter it below to earn a bonus on the amount you receive. The bonus is paid into your bank on top of that amount once this request is paid out.
                            </p>
                            <PromoCodeField promo={promo} bare />
                          </div>
                        </div>
                      )}

                      {/* Payer sends */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between min-h-[28px]">
                          <Label htmlFor="requestAmount" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-800 leading-none">
                            <span>Payer sends</span>
                            <span className="text-destructive">*</span>
                            <FieldTag required />
                          </Label>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="relative flex-1">
                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">{senderSymbol}</span>
                            <Input
                              id="requestAmount"
                              type="number"
                              min="1"
                              step="any"
                              inputMode="decimal"
                              placeholder="0.00"
                              value={payerDisplay}
                              onChange={(e) => handleAmountChange(e.target.value)}
                              onKeyUp={(e) => handleAmountChange((e.currentTarget as HTMLInputElement).value)}
                              onBlur={() => setPayerDraft(null)}
                              aria-invalid={belowMin}
                              aria-describedby="payer-sends-help"
                              className={`${senderSymbol.length > 1 ? "pl-14" : "pl-8"} text-xl md:text-2xl font-bold tabular-nums h-12 md:h-14 bg-white shadow-sm ${belowMin ? "border-destructive" : ""}`}
                              data-testid="input-request-amount"
                            />
                          </div>
                          <Select value={formData.senderCurrency} onValueChange={(value) => { setReceiveDraft(null); handleInputChange("senderCurrency", value); }}>
                            <SelectTrigger className="w-28 md:w-32 h-12 md:h-14 shrink-0 bg-white font-bold text-base shadow-sm" data-testid="select-sender-currency">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {currencyOptions.map((currency) => (
                                <SelectItem key={currency} value={currency}>
                                  {currency} ({CURRENCY_SYMBOLS[currency] ?? ""})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div id="payer-sends-help" className="space-y-1.5">
                          {restoredAmount && (
                            <p className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary" data-testid="chip-restored-amount">
                              <Check className="w-3.5 h-3.5" /> Restored from your last successful request. Rate and fees are current.
                            </p>
                          )}
                          {minAmount !== null && (
                            <p className="text-xs text-muted-foreground leading-relaxed" data-testid="text-minimum">
                              Minimum the payer can send: <strong className="text-foreground tabular-nums">{senderSymbol}{minAmount.toFixed(2)}</strong>
                            </p>
                          )}
                          {belowMin && minAmount !== null && (
                            <p className="flex items-start gap-1.5 text-xs text-destructive" role="alert" data-testid="error-minimum">
                              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                              The payer must send at least {senderSymbol}{minAmount.toFixed(2)}.
                            </p>
                          )}
                        </div>
                        {parsedAmount > 0 && !corridorForSelection && (
                          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5" data-testid="corridor-unavailable">
                            This payer currency / settlement bank account combination has no enabled corridor.{" "}
                            {(() => {
                              const disabled = (corridorsQuery.data ?? []).find((c) => !c.enabled && c.payInCurrency === senderCurrency && c.payoutCurrency === payoutCurrency);
                              return disabled?.unavailabilityReason ?? "Try a different currency or settlement bank account.";
                            })()}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Payment breakdown */}
                    <div className="lg:col-span-2 lg:self-start lg:sticky lg:top-24">
                      <div className="border border-border rounded-xl p-5 space-y-4 bg-card shadow-sm" data-testid="fee-breakdown">
                        <h3 className="font-semibold text-base text-slate-900 border-b pb-2">Payment breakdown</h3>
                        <div className="space-y-3 text-sm">
                          <div className="flex justify-between gap-6">
                            <span className="text-muted-foreground">Payer sends</span>
                            <span className="font-bold text-slate-800 tabular-nums whitespace-nowrap" data-testid="breakdown-sender-pays">
                              {senderSymbol}{senderPaysAmount.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between gap-6 text-muted-foreground">
                            <span>Fee (3%{formData.absorbFee ? ", taken from what you receive" : ", added for the payer"})</span>
                            <span className={`font-medium tabular-nums whitespace-nowrap ${formData.absorbFee ? "text-red-600" : "text-slate-800"}`}>
                              {formData.absorbFee ? "-" : "+"}{senderSymbol}{platformFeeAmount.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between gap-6 text-xs text-muted-foreground">
                            <span>Net before FX</span>
                            <span className="font-semibold text-slate-700 tabular-nums whitespace-nowrap">{senderSymbol}{netBeforeFx.toFixed(2)}</span>
                          </div>
                          {senderCurrency !== payoutCurrency && (
                            <div className="flex justify-between gap-6 text-xs bg-amber-50 p-2.5 rounded-lg border border-amber-200 text-amber-900">
                              <span className="font-medium">Exchange rate</span>
                              <span className="font-semibold tabular-nums">{fxFinite ? `${fxRate.toFixed(4)} ${payoutCurrency} per ${senderCurrency}` : "Live spot rate at payout"}</span>
                            </div>
                          )}
                          {promoApplied && promoBonus > 0 && (
                            <div className="flex justify-between gap-6 text-xs bg-emerald-50 p-2.5 rounded-lg border border-emerald-200 text-emerald-900" data-testid="breakdown-promo-bonus">
                              <span className="font-medium">Promo {promoCode} bonus (paid into your bank on top)</span>
                              <span className="font-semibold tabular-nums whitespace-nowrap">+{payoutSymbol}{promoBonus.toFixed(2)}</span>
                            </div>
                          )}
                        </div>
                        <div className="h-px bg-border" />
                        <div className="bg-primary/5 -mx-5 px-5 py-3.5 -mb-5 rounded-b-xl border-t border-primary/15">
                          <p className="text-xs text-muted-foreground mb-0.5">You receive in bank ({payoutCurrency})</p>
                          {senderCurrency === payoutCurrency ? (
                            <span className="text-xl md:text-2xl font-extrabold text-primary tabular-nums">{payoutSymbol}{(netBeforeFx + promoBonus).toFixed(2)}</span>
                          ) : fxFinite ? (
                            <div>
                              <span className="text-xl md:text-2xl font-extrabold text-primary tabular-nums">{payoutSymbol}{(receiveInPayout + promoBonus).toFixed(2)}</span>
                              <p className="text-[11px] font-medium text-amber-800 mt-1 leading-snug">Indicative. Converted at the live spot rate when the payer pays.</p>
                            </div>
                          ) : !corridorForSelection ? (
                            <div>
                              <span className="text-xl md:text-2xl font-extrabold text-muted-foreground">Not available</span>
                              <p className="text-[11px] font-medium text-amber-800 mt-1 leading-snug">There is no route from {senderCurrency} to {payoutCurrency}. Choose a different payer currency or settlement account.</p>
                            </div>
                          ) : (
                            <div>
                              <span className="text-xl md:text-2xl font-extrabold text-primary tabular-nums">{senderSymbol}{netBeforeFx.toFixed(2)}</span>
                              <p className="text-[11px] font-medium text-amber-800 mt-1 leading-snug">Converted to {payoutCurrency} at the live spot rate when the payer pays.</p>
                            </div>
                          )}
                          <p className="text-[10px] text-muted-foreground mt-1.5">Paid into {selectedPayoutAccount?.bankName || "your default account"}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ================= STEP 2: PAYMENT REQUEST ================= */}
                {currentStep === 2 && (
                  <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    <div className="lg:col-span-3 space-y-5">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/50 px-3.5 py-2.5 text-sm" data-testid="request-summary">
                        <span>You receive <strong className="tabular-nums whitespace-nowrap">{senderCurrency === payoutCurrency ? `${payoutSymbol}${netBeforeFx.toFixed(2)}` : fxFinite ? `${payoutSymbol}${receiveInPayout.toFixed(2)}` : `${senderSymbol}${netBeforeFx.toFixed(2)}`}</strong></span>
                        <span>Payer sends <strong className="tabular-nums whitespace-nowrap">{senderSymbol}{senderPaysAmount.toFixed(2)}</strong></span>
                        <button type="button" onClick={() => setCurrentStep(1)} className="font-semibold text-primary" data-testid="button-edit-amount">Edit amount</button>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center min-h-[24px]">
                          <Label htmlFor="note" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-800 leading-none">
                            <span>Description / Invoice Note</span>
                            <FieldTag />
                          </Label>
                        </div>
                        <Textarea
                          id="note"
                          rows={3}
                          maxLength={100}
                          placeholder="What is this payment for?"
                          value={formData.note}
                          onChange={(e) => handleInputChange("note", e.target.value)}
                          data-testid="input-note"
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center min-h-[24px]">
                          <Label htmlFor="invoiceReference" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-800 leading-none">
                            <span>Invoice Reference</span>
                            <FieldTag />
                          </Label>
                        </div>
                        <Input
                          id="invoiceReference"
                          placeholder="e.g. INV-2041"
                          maxLength={40}
                          value={formData.invoiceReference}
                          onChange={(e) => handleInputChange("invoiceReference", e.target.value)}
                          data-testid="input-invoice-reference"
                        />
                        <p className="text-xs text-muted-foreground">No invoice needed. Add a reference only if you have one.</p>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center min-h-[24px]">
                          <Label htmlFor="reason" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-800 leading-none">
                            <span>Purpose of Payment</span>
                            <span className="text-destructive">*</span>
                            <FieldTag required />
                          </Label>
                        </div>
                        <Select value={formData.reason} onValueChange={(value) => handleInputChange("reason", value)}>
                          <SelectTrigger id="reason" data-testid="select-reason">
                            <SelectValue placeholder="Select a payment category" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="invoice_payment">Invoice / Services</SelectItem>
                            <SelectItem value="business_payment">Business Payment</SelectItem>
                            <SelectItem value="family_support">Family Support</SelectItem>
                            <SelectItem value="education_fees">Education / Tuition</SelectItem>
                            <SelectItem value="medical_expenses">Medical Expenses</SelectItem>
                            <SelectItem value="rent_payment">Rent Payment</SelectItem>
                            <SelectItem value="gift">Gift / Donation</SelectItem>
                            <SelectItem value="loan_repayment">Loan Repayment</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        {formData.reason === "other" && (
                          <div className="space-y-2 pt-1" data-testid="container-other-reason">
                            <div className="flex items-center min-h-[24px]">
                              <Label htmlFor="otherReason" className="inline-flex items-center gap-1 text-xs font-medium text-slate-800 leading-none">
                                <span>Please specify</span>
                                <span className="text-destructive">*</span>
                                <FieldTag required />
                              </Label>
                            </div>
                            <Input
                              id="otherReason"
                              placeholder="e.g. Consulting services, Event sponsorship"
                              value={formData.otherReason}
                              onChange={(e) => handleInputChange("otherReason", e.target.value)}
                              data-testid="input-other-reason"
                            />
                          </div>
                        )}
                      </div>

                      {/* Payment link expiry (default applied) */}
                      <div className="space-y-2">
                        <div className="flex items-center min-h-[24px]">
                          <Label htmlFor="expiryPeriod" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-800 leading-none">
                            <span>Payment Link Expiry</span>
                            <span className="ml-1.5 text-[11px] font-medium text-muted-foreground">Default applied</span>
                          </Label>
                        </div>
                        <Select
                          value={formData.expiryPeriod}
                          onValueChange={(value) => {
                            setExpiryTouched(true);
                            handleInputChange("expiryPeriod", value as ExpiryPeriod);
                          }}
                        >
                          <SelectTrigger id="expiryPeriod" data-testid="select-expiry-period">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {EXPIRY_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {formData.expiryPeriod === "custom" && (
                          <div className="space-y-1.5 pt-1">
                            <Label htmlFor="customExpiryDate" className="text-xs font-medium">Expiry Date <span className="text-destructive">*</span></Label>
                            <Input
                              id="customExpiryDate"
                              type="date"
                              min={formData.dueDate || today}
                              value={formData.customExpiryDate}
                              onChange={(e) => handleCustomExpiryChange(e.target.value)}
                              data-testid="input-custom-expiry-date"
                            />
                          </div>
                        )}
                        {computedExpiry && (
                          <p className="text-xs font-medium text-primary flex items-center gap-1.5 pt-1" data-testid="text-expiry-preview">
                            <CalendarClock className="w-3.5 h-3.5 shrink-0" />
                            This payment link will expire on {formatHumanDate(computedExpiry.expiryDate)} at 11:59 p.m. {EXPIRY_TIMEZONE_LABEL}.
                          </p>
                        )}
                        {dateErrors.expiry && <p className="text-xs text-destructive" role="alert" data-testid="error-expiry">{dateErrors.expiry}</p>}
                      </div>

                      {/* Payer email + saved senders */}
                      <div className="space-y-2">
                        <div className="flex items-center min-h-[24px]">
                          <Label htmlFor="senderEmail" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-800 leading-none">
                            <span>Payer Email</span>
                            <FieldTag />
                          </Label>
                        </div>
                        <Input
                          id="senderEmail"
                          type="email"
                          autoComplete="off"
                          placeholder="Enter Payer's email to send email request"
                          value={formData.senderEmail}
                          onChange={(e) => handlePayerEmailChange(e.target.value)}
                          aria-invalid={!!emailError}
                          className={emailError ? "border-destructive" : ""}
                          data-testid="input-sender-email"
                        />
                        {emailError && <p className="text-xs text-destructive" role="alert" data-testid="error-payer-email">{emailError}</p>}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5 border-primary text-primary hover:text-primary"
                          aria-expanded={showSenderList}
                          onClick={() => setShowSenderList((v) => !v)}
                          data-testid="button-select-sender"
                        >
                          <User className="w-3.5 h-3.5" /> Select from saved senders
                        </Button>
                        {showSenderList && (
                          <div className="rounded-xl border border-border bg-card overflow-hidden" role="listbox" aria-label="Saved senders" data-testid="list-saved-senders">
                            {knownSenders.length === 0 && (
                              <p className="p-3 text-xs text-muted-foreground">No saved senders yet. Type the payer's email above, or create a link without a payer.</p>
                            )}
                            {knownSenders.map((sender) => (
                              <button
                                key={knownSenderId(sender)}
                                type="button"
                                role="option"
                                aria-selected={formData.senderId === knownSenderId(sender)}
                                onClick={() => selectKnownSender(sender)}
                                className="w-full px-3.5 py-3 min-h-[52px] text-left hover:bg-muted/60 transition-colors flex items-center gap-3 border-b last:border-b-0 border-border"
                                data-testid={`suggestion-sender-${sender.email.replace(/[@.]/g, "-")}`}
                              >
                                <span className="w-9 h-9 bg-primary/10 text-primary rounded-full flex items-center justify-center shrink-0">
                                  {sender.senderType === "business" ? <Building2 className="w-4 h-4" /> : <User className="w-4 h-4" />}
                                </span>
                                <span className="min-w-0">
                                  <span className="block font-medium text-sm text-foreground truncate">{knownSenderName(sender)}</span>
                                  <span className="block text-xs text-muted-foreground truncate">{sender.email}</span>
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        {formData.senderId && (
                          <p className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary" data-testid="chip-selected-sender">
                            <Check className="w-3.5 h-3.5" /> {formData.payerName}
                          </p>
                        )}
                      </div>

                      {/* Payer details (collapsible, optional) */}
                      <div className="rounded-xl border border-border">
                        <button
                          type="button"
                          className="flex w-full items-center gap-3 p-3.5 min-h-[52px] text-left"
                          aria-expanded={showPayerDetails}
                          onClick={() => setShowPayerDetails((v) => !v)}
                          data-testid="toggle-payer-details"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-bold font-display">Payer details <FieldTag /></span>
                            <span className="block text-xs text-muted-foreground">
                              Add the payer&apos;s bank details to query and verify their account (especially for corridors like Nigeria) so sender details are accurately matched and saved.
                            </span>
                          </span>
                          <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${showPayerDetails ? "rotate-180" : ""}`} />
                        </button>
                        {showPayerDetails && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-border p-3.5" data-testid="section-payer-details">
                            <div className="space-y-1.5 sm:col-span-2">
                              <Label htmlFor="payerName" className="text-xs font-medium">Person or company name</Label>
                              <Input
                                id="payerName"
                                placeholder="Full name or company"
                                value={formData.payerName}
                                onChange={(e) => handleInputChange("payerName", e.target.value)}
                                data-testid="input-payer-name"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="payerBankName" className="text-xs font-medium">Bank</Label>
                              <Input
                                id="payerBankName"
                                list="payer-bank-options"
                                placeholder={senderCurrency === "NGN" ? "Select or type Nigerian bank (e.g. GTBank, Access Bank)" : "e.g. Fidelity Bank, Barclays"}
                                value={formData.payerBankName}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  handleInputChange("payerBankName", val);
                                  const found = (payerBanksQuery.data?.banks ?? []).find(
                                    (b) => b.name.toLowerCase() === val.trim().toLowerCase() || b.code === val.trim(),
                                  );
                                  setPayerBankCode(found?.code ?? "");
                                }}
                                data-testid="input-payer-bank"
                              />
                              <datalist id="payer-bank-options">
                                {(payerBanksQuery.data?.banks ?? []).map((b) => (
                                  <option key={b.code} value={b.name} />
                                ))}
                              </datalist>
                              <span className="hidden"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="payerAccountNumber" className="text-xs font-medium">Account number</Label>
                              <Input
                                id="payerAccountNumber"
                                inputMode="numeric"
                                placeholder="6 to 12 digits"
                                value={formData.payerAccountNumber}
                                onChange={(e) => handleInputChange("payerAccountNumber", e.target.value.replace(/[^\d]/g, ""))}
                                aria-invalid={!!accountError}
                                data-testid="input-payer-account"
                              />
                              {accountError && <p className="text-xs text-destructive" role="alert" data-testid="error-payer-account">{accountError}</p>}
                              {verifyingPayerAccount && (
                                <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-0.5" data-testid="status-verifying-payer-account">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" /> Verifying payer bank account…
                                </p>
                              )}
                              {!verifyingPayerAccount && payerVerifiedName && (
                                <p className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 mt-1" data-testid="status-verified-payer-account">
                                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                  <span>Verified Account Name: <strong>{payerVerifiedName}</strong></span>
                                </p>
                              )}
                              {!verifyingPayerAccount && payerVerifyError && !accountError && (
                                <p className="text-xs text-amber-800" data-testid="error-verify-payer-account">{payerVerifyError}</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Share */}
                      <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
                        <div>
                          <p className="text-sm font-semibold">Share this request</p>
                          <p className="text-xs text-muted-foreground">Create the payment link first, then copy it, share it on WhatsApp, or send it by email.</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            onClick={handleCreateLink}
                            disabled={!canCreate}
                            className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground"
                            data-testid="button-create-link"
                          >
                            {isSubmittingRequest ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                            {isSubmittingRequest ? "Creating…" : "Create payment link"}
                          </Button>
                          {hasEmail && (
                            <Button
                              onClick={handleSendEmail}
                              disabled={!canSendEmail}
                              className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground"
                              data-testid="button-send-email"
                            >
                              {isSendingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                              {isSendingEmail ? "Sending…" : "Send email"}
                            </Button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground" data-testid="text-send-email-help">
                          {!hasEmail
                            ? "Add a payer email above to get a Send email button."
                            : emailError
                            ? "Fix the email above to send."
                            : `Creates the link and emails it to ${formData.senderEmail.trim()}.`}
                        </p>
                        {!formData.reason && (
                          <p className="text-xs text-muted-foreground" data-testid="text-purpose-required">Choose a Purpose of Payment to create the link.</p>
                        )}
                        <div className="rounded-lg bg-blue-50/70 border border-blue-200/70 px-3 py-2 text-[11px] text-slate-700 leading-relaxed flex items-start gap-2" data-testid="note-otp-vs-email-link">
                          <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                          <span>
                            <strong>Security &amp; Verification Rule:</strong> If the payer clicks <strong>&ldquo;Pay now&rdquo;</strong> directly from their email, they bypass email OTP verification. If they copy and paste the shared payment link into a browser, they must complete the 6-digit OTP email verification process.
                          </span>
                        </div>
                        {false && (null
                        )}
                      </div>
                    </div>

                    <div className="lg:col-span-2 lg:self-start lg:sticky lg:top-24">
                      <div className="border border-border rounded-xl p-5 space-y-3 bg-card shadow-sm text-sm" data-testid="request-breakdown">
                        <h3 className="font-semibold text-base text-slate-900 border-b pb-2">Payment breakdown</h3>
                        <div className="flex justify-between gap-6"><span className="text-muted-foreground">Payer sends</span><span className="font-bold tabular-nums whitespace-nowrap" data-testid="review-sender-pays">{senderSymbol}{senderPaysAmount.toFixed(2)}</span></div>
                        <div className="flex justify-between gap-6 text-muted-foreground"><span>Fee (3%)</span><span className="tabular-nums whitespace-nowrap">{formData.absorbFee ? "-" : "+"}{senderSymbol}{platformFeeAmount.toFixed(2)}</span></div>
                        {promoApplied && promoBonus > 0 && (
                          <div className="flex justify-between gap-6 text-emerald-700" data-testid="review-promo-bonus">
                            <span>Promo {promoCode} bonus (paid into your bank on top)</span>
                            <span className="tabular-nums whitespace-nowrap">+{payoutSymbol}{promoBonus.toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between gap-6 font-semibold text-primary border-t border-dashed border-border pt-2">
                          <span>You receive in bank</span>
                          <span className="tabular-nums whitespace-nowrap">
                            {senderCurrency === payoutCurrency
                              ? `${payoutSymbol}${(netBeforeFx + promoBonus).toFixed(2)}`
                              : fxFinite ? `${payoutSymbol}${(receiveInPayout + promoBonus).toFixed(2)}` : `${senderSymbol}${netBeforeFx.toFixed(2)}`}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">Paid into {selectedPayoutAccount?.bankName} {selectedPayoutAccount?.maskedNumber}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Navigation */}
                <div className={stickyBar}>
                  <Button variant="outline" onClick={handleBack} className="flex-1" data-testid="button-step-back">
                    {currentStep === 1 ? "Cancel" : "Back"}
                  </Button>
                  {currentStep === 1 && (
                    <Button
                      onClick={handleNext}
                      disabled={!canContinueStep1}
                      className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
                      data-testid="button-step-next"
                    >
                      Continue
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  )}
                </div>
                {currentStep === 1 && !canContinueStep1 && (
                  <p className="text-xs text-muted-foreground -mt-3" data-testid="text-continue-hint">
                    {belowMin ? "Enter an amount at or above the minimum to continue." : "Enter an amount to continue."}
                  </p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* FX Conversion Notice Modal */}
      <Dialog open={showFxNoticeModal} onOpenChange={setShowFxNoticeModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg text-slate-900">
              <ArrowRightLeft className="w-5 h-5 text-primary" />
              <span>FX Conversion Notice</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">Cross-currency payout information</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 text-sm">
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-900 leading-relaxed font-medium">
                  As your settlement bank account currency (<strong>{payoutCurrency}</strong>) is different from the requested amount currency (<strong>{senderCurrency}</strong>), the FX conversion will be done on the <strong>FX Spot rates at the time of payout</strong>.
                </p>
              </div>
            </div>
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between gap-6">
                <span className="text-muted-foreground">Requested Amount (Payer Pays):</span>
                <span className="font-semibold text-slate-800 whitespace-nowrap">{senderSymbol}{senderPaysAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between gap-6">
                <span className="text-muted-foreground">Fee (3%{formData.absorbFee ? " absorbed by you" : " added to payer"}):</span>
                <span className={`font-medium whitespace-nowrap ${formData.absorbFee ? "text-red-600" : "text-slate-800"}`}>
                  {formData.absorbFee ? "-" : "+"}{senderSymbol}{platformFeeAmount.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between gap-6">
                <span className="text-muted-foreground">Net Payout Amount:</span>
                <span className="font-semibold text-slate-800 whitespace-nowrap">{senderSymbol}{netBeforeFx.toFixed(2)}</span>
              </div>
              <div className="flex justify-between gap-6 pt-1 border-t border-slate-200/60">
                <span className="text-muted-foreground">Destination Settlement Bank Account:</span>
                <span className="font-semibold text-slate-800">{selectedPayoutAccount?.bankName} ({payoutCurrency})</span>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setShowFxNoticeModal(false)}>Go Back</Button>
            <Button type="button" onClick={handleConfirmFxAndProceed} className="bg-primary hover:bg-primary/90 gap-1.5">
              <span>Continue</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {previewDialog}
    </DashboardLayout>
  );
}
