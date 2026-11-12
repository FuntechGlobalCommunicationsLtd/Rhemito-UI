import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
    ArrowLeft, Check, ChevronRight, User, Building2,
    CreditCard, Wallet, Landmark, Smartphone, Banknote, Shield,
    ChevronDown, ArrowRightLeft, BarChart3, Search, UserPlus, X,
    Copy, Loader2, Clock, Mail, AlertTriangle, CheckCircle2,
    XCircle, RefreshCw, ArrowRight, Info
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useRewards } from "@/hooks/use-rewards";
import { useContacts } from "@/contexts/ContactsContext";
import { BONUS_COPY, UseBonusCredit, balanceFor, creditToApply, eligibleBonusBalance, formatMoney, type BonusChoice } from "@/features/bonus";
import { PromoCodeField, usePromoCode, PROMO_COPY, formatPromoMoney } from "@/features/promo";
import { CancelTransactionModal, type TransactionDetails } from "@/components/CancelTransactionModal";
import AccountTypeToggle from "@/pages/Auth/components/AccountTypeToggle";
import {
    cancelSendMoneyTransaction,
    createSendMoneyTransaction,
    fetchMitoAffiliateRate,
    fetchMitoBeneficiaries,
    fetchMitoBeneficiaryRequirements,
    fetchMitoJourneyStatus,
    fetchMitoKycJourney,
    fetchMitoLookups,
    fetchMitoProviders,
    initiateHostedSendMoneyTransaction,
    type MitoBeneficiaryItem,
    type MitoBeneficiaryRequirementField,
    type MitoLookupTypeOption,
    type MitoProviderOption,
    paySendMoneyTransaction,
    SendMoneyApiError,
    validateMitoRate,
} from "@/lib/sendMoney";
import type { SendMoneyPaymentMethod, SendMoneyService } from "@shared/sendMoney";

// Mock Data
const DEFAULT_EXCHANGE_RATE = 2025.50; // 1 GBP = 2025.50 NGN (fallback)
const FEE_PERCENTAGE = 0.01; // 1%
const CURRENCY_FLAGS: Record<string, string> = {
    GBP: "gb", USD: "us", EUR: "eu", NGN: "ng", INR: "in", GHS: "gh", KES: "ke", ZAR: "za", CAD: "ca", AED: "ae", AUD: "au", CNY: "cn", JPY: "jp",
};
const CURRENCY_SYMBOLS: Record<string, string> = {
    GBP: "£", USD: "$", EUR: "€", NGN: "₦", INR: "₹", GHS: "GH₵", KES: "KSh ", ZAR: "R", CAD: "C$", AED: "AED ", AUD: "A$", CNY: "¥", JPY: "¥",
};
const RECEIVE_CURRENCIES = ["NGN", "INR", "GHS", "KES", "ZAR", "EUR", "USD", "GBP", "CAD", "AED", "AUD", "CNY", "JPY"];
const CURRENCY_TO_COUNTRY_INFO: Record<string, { country: string; countryIso3: string }> = {
    NGN: { country: "Nigeria", countryIso3: "NGA" },
    INR: { country: "India", countryIso3: "IND" },
    GHS: { country: "Ghana", countryIso3: "GHA" },
    KES: { country: "Kenya", countryIso3: "KEN" },
    ZAR: { country: "South Africa", countryIso3: "ZAF" },
    EUR: { country: "Germany", countryIso3: "DEU" },
    USD: { country: "United States", countryIso3: "USA" },
    GBP: { country: "UK", countryIso3: "GBR" },
    CAD: { country: "Canada", countryIso3: "CAN" },
    AED: { country: "United Arab Emirates", countryIso3: "ARE" },
    AUD: { country: "Australia", countryIso3: "AUS" },
    CNY: { country: "China", countryIso3: "CHN" },
    JPY: { country: "Japan", countryIso3: "JPN" },
};
const COUNTRY_NAME_TO_ISO3: Record<string, string> = {
    NIGERIA: "NGA", NGA: "NGA", NG: "NGA",
    INDIA: "IND", IND: "IND", IN: "IND",
    GHANA: "GHA", GHA: "GHA", GH: "GHA",
    KENYA: "KEN", KEN: "KEN", KE: "KEN",
    "SOUTH AFRICA": "ZAF", ZAF: "ZAF", ZA: "ZAF",
    GERMANY: "DEU", DEU: "DEU", DE: "DEU",
    "UNITED STATES": "USA", USA: "USA", US: "USA",
    UK: "GBR", "UNITED KINGDOM": "GBR", GBR: "GBR", GB: "GBR",
    CANADA: "CAN", CAN: "CAN", CA: "CAN",
    "UNITED ARAB EMIRATES": "ARE", UAE: "ARE", ARE: "ARE", AE: "ARE",
    AUSTRALIA: "AUS", AUS: "AUS", AU: "AUS",
    CHINA: "CHN", CHN: "CHN", CN: "CHN",
    JAPAN: "JPN", JPN: "JPN", JP: "JPN",
};
function resolveBeneficiaryCountryIso3(country?: string, currency?: string): string {
    const cleanCountry = (country || "").trim().toUpperCase();
    if (cleanCountry && COUNTRY_NAME_TO_ISO3[cleanCountry]) {
        return COUNTRY_NAME_TO_ISO3[cleanCountry];
    }
    const cleanCurrency = (currency || "NGN").trim().toUpperCase();
    return CURRENCY_TO_COUNTRY_INFO[cleanCurrency]?.countryIso3 || "NGA";
}

const recentRecipients = [
    { id: 1, name: "Akshita Gupta",   bank: "Barclays",        account: "12345678",  sortCode: "20-45-67", iban: "",                       swift: "",          currency: "GBP", country: "UK",            narration: "",                    initials: "AG", color: "bg-blue-100 text-blue-600" },
    { id: 2, name: "Sarah Chen",      bank: "Access Bank",     account: "87654321",  sortCode: "",         iban: "",                       swift: "",          currency: "NGN", country: "Nigeria",       narration: "Family support",      initials: "SC", color: "bg-purple-100 text-purple-600" },
    { id: 3, name: "David Okonkwo",   bank: "GTBank",          account: "11223344",  sortCode: "",         iban: "",                       swift: "",          currency: "NGN", country: "Nigeria",       narration: "Business payment",    initials: "DO", color: "bg-green-100 text-green-600" },
    { id: 4, name: "Hans Müller",     bank: "Deutsche Bank",   account: "DE89370400440532013000", sortCode: "", iban: "DE89 3704 0044 0532 0130 00", swift: "DEUTDEFF", currency: "EUR", country: "Germany", narration: "Invoice #DE-2024", initials: "HM", color: "bg-orange-100 text-orange-600" },
    { id: 5, name: "James Peterson",  bank: "Chase Bank",      account: "987654321", sortCode: "",         iban: "",                       swift: "CHASUS33",  currency: "USD", country: "United States", narration: "",                    initials: "JP", color: "bg-teal-100 text-teal-600" },
];

const steps = [
    { id: 1, title: "Amount" },
    { id: 2, title: "Recipient" },
    { id: 3, title: "Details" }, // Was "Bank" in screenshot, generalizing to Details
    { id: 4, title: "Payment" }, // Was "Payment Method"
];

export type PaymentOutcomeCategory = "completed" | "processing" | "failed" | "cancelled" | "expired";

export interface PaymentOutcomeState {
    category: PaymentOutcomeCategory;
    rawStatus: string;
    paymentStatus?: string;
    reference: string;
    paymentMethodLabel: string;
    reason?: string;
    journeyCode?: string | null;
    timestamp: string;
}

function classifyPaymentOutcome(
    rawStatus?: string | null,
    reason?: string | null,
    eventType?: string | null,
    paymentStatus?: string | null,
): PaymentOutcomeCategory {
    const s = String(rawStatus || "").trim().toUpperCase().replace(/[\s_-]+/g, "");
    const ps = String(paymentStatus || "").trim().toUpperCase().replace(/[\s_-]+/g, "");
    const r = String(reason || "").trim().toLowerCase();
    const ev = String(eventType || "").trim().toUpperCase();

    const isTokenExpired = (v: string) => v === "EXPIRED" || v === "TIMEOUT" || v === "TIMEDOUT";
    const isTokenCancelled = (v: string) =>
        v === "CANCELLED" || v === "CANCELED" || v === "ABORTED" || v === "CLOSED" || v === "USERCLOSED";
    const isTokenFailed = (v: string) =>
        v === "COMPFAILED" ||
        v === "FAILED" ||
        v === "FAIL" ||
        v === "DECLINED" ||
        v === "REJECTED" ||
        v === "ERROR" ||
        v === "INSUFFICIENTFUNDS" ||
        v === "PAYMENTFAILED" ||
        v === "CARDDECLINED" ||
        v === "3DSFAILED" ||
        v === "AUTHENTICATIONFAILED";
    const isTokenCompleted = (v: string) =>
        v === "COMPSUCCESS" ||
        v === "SUCCEEDED" ||
        v === "SUCCESSFUL" ||
        v === "SUCCESS" ||
        v === "PAID" ||
        v === "APPROVED" ||
        v === "COMPLETED" ||
        v === "PROCESSED" ||
        v === "CAPTURED" ||
        v === "AUTHORIZED" ||
        v === "SETTLED";

    if (isTokenExpired(s) || isTokenExpired(ps) || r.includes("expir") || r.includes("timeout") || r === "restart") {
        return "expired";
    }
    if (isTokenCancelled(s) || isTokenCancelled(ps) || r.includes("cancel") || r.includes("closed") || r.includes("abort")) {
        return "cancelled";
    }
    if (
        isTokenFailed(s) ||
        isTokenFailed(ps) ||
        r.includes("fail") ||
        r.includes("declin") ||
        r.includes("reject") ||
        r.includes("error")
    ) {
        return "failed";
    }
    if (isTokenCompleted(s) || isTokenCompleted(ps)) {
        return "completed";
    }
    if (
        s === "AWAITINGPAYMENT" ||
        s === "INREVIEW" ||
        s === "PENDING" ||
        s === "PROCESSING" ||
        s === "READYTOPROCESS" ||
        s === "AWAITINGAFFILIATEUPDATE" ||
        s === "INITIATED" ||
        s === "SUBMITTED" ||
        ps === "PENDING" ||
        ps === "PROCESSING"
    ) {
        return "processing";
    }
    if (ev === "MITO_LINK_SUCCESS") {
        return "completed";
    }
    if (ev === "MITO_LINK_EXIT") {
        return r ? "failed" : "cancelled";
    }
    return "processing";
}

function extractCardOutcomeFromUrl(rawUrl: string): {
    hostname: string;
    tnxref: string | null;
    status: string | null;
    paymentStatus: string | null;
    ckoSessionId: string | null;
    reason: string | null;
    journeyCode: string | null;
} | null {
    if (!rawUrl || typeof rawUrl !== "string") return null;
    try {
        const parsed = new URL(rawUrl, typeof window !== "undefined" ? window.location.origin : "http://localhost:5000");
        const paramSources: URLSearchParams[] = [parsed.searchParams];
        const nestedRedirect =
            parsed.searchParams.get("redirect") ||
            parsed.searchParams.get("returnUrl") ||
            parsed.searchParams.get("next");
        if (nestedRedirect) {
            try {
                const decoded = new URL(
                    decodeURIComponent(nestedRedirect),
                    typeof window !== "undefined" ? window.location.origin : "http://localhost:5000",
                );
                paramSources.unshift(decoded.searchParams);
            } catch {
                try {
                    const direct = new URL(
                        nestedRedirect,
                        typeof window !== "undefined" ? window.location.origin : "http://localhost:5000",
                    );
                    paramSources.unshift(direct.searchParams);
                } catch {
                    // ignore malformed nested redirect
                }
            }
        }
        const getFirst = (...keys: string[]): string | null => {
            for (const sp of paramSources) {
                for (const k of keys) {
                    const v = sp.get(k);
                    if (v && v.trim()) return v.trim();
                }
            }
            return null;
        };
        return {
            hostname: parsed.hostname.toLowerCase(),
            tnxref: getFirst(
                "tnxref",
                "orderNo",
                "txn_ref",
                "txnref",
                "reference",
                "transactionReference",
                "partnerReferenceNumber",
            ),
            status: getFirst("status", "orderStatus", "journeyStatus"),
            paymentStatus: getFirst("paymentStatus", "cko-payment-status"),
            ckoSessionId: getFirst("cko-session-id", "cko-payment-id"),
            reason: getFirst("reason", "error", "message", "declined_reason"),
            journeyCode: getFirst("journeyCode", "journey_code"),
        };
    } catch {
        return null;
    }
}

function buildMitoEmbeddedPayByBankUrl(rawUrl: string): string {
    try {
        const u = new URL(rawUrl);
        if (!u.searchParams.has("mitoEmbed")) {
            u.searchParams.set("mitoEmbed", "1");
        }
        if (!u.searchParams.has("mitoClient")) {
            u.searchParams.set("mitoClient", "web");
        }
        return u.toString();
    } catch {
        const sep = rawUrl.includes("?") ? "&" : "?";
        return `${rawUrl}${sep}mitoEmbed=1&mitoClient=web`;
    }
}

function extractJourneyCodeFromUrl(rawUrl?: string | null): string | null {
    if (!rawUrl) return null;
    try {
        const u = new URL(rawUrl);
        return u.searchParams.get("journeyCode") || u.searchParams.get("journey_code") || null;
    } catch {
        const match = rawUrl.match(/[?&]journeyCode=([^&#]+)/i);
        return match?.[1] ? decodeURIComponent(match[1]) : null;
    }
}

export default function SendMoney() {
    const [, setLocation] = useLocation();
    const searchParams = useSearch();
    const parsedSearch = new URLSearchParams(
        searchParams || (typeof window !== "undefined" ? window.location.search : ""),
    );
    const initialRewardParam = parsedSearch.get("reward");
    const initialCurrencyParam = parsedSearch.get("currency")?.toUpperCase();
    const { toast } = useToast();
    const { upsertRecipient } = useContacts();
    const queryClient = useQueryClient();
    const [currentStep, setCurrentStep] = useState(1);

    // Form State
    const [sendCurrencyState, setSendCurrencyState] = useState<string>(
        initialCurrencyParam && ["GBP", "USD", "EUR"].includes(initialCurrencyParam)
            ? initialCurrencyParam
            : "GBP",
    );
    const SEND_CURRENCY = sendCurrencyState;
    const [amount, setAmount] = useState<string>("500");
    const [receiveAmount, setReceiveAmount] = useState<string>("");
    const [deliveryMethod, setDeliveryMethod] = useState("bank_deposit");

    const [selectedRecipient, setSelectedRecipient] = useState<any>(null);
    const [senderBeneficiaries, setSenderBeneficiaries] = useState<MitoBeneficiaryItem[]>([]);
    const [recipientSearch, setRecipientSearch] = useState<string>("");
    const [mitoBeneficiariesConfigured, setMitoBeneficiariesConfigured] = useState<boolean>(true);
    const [searchedBeneficiaries, setSearchedBeneficiaries] = useState<MitoBeneficiaryItem[] | null>(null);
    const [searchingBeneficiaries, setSearchingBeneficiaries] = useState<boolean>(false);
    const [recipientSearchOpen, setRecipientSearchOpen] = useState<boolean>(false);
    const [beneficiaryType, setBeneficiaryType] = useState<"individual" | "business">("individual");
    const [beneficiaryRequirements, setBeneficiaryRequirements] = useState<MitoBeneficiaryRequirementField[]>([]);
    const [recipientDetails, setRecipientDetails] = useState({
        firstName: "",
        lastName: "",
        companyName: "",
        relationship: "",
        relationId: "",
        nickName: "",
        reason: "",
        reasonId: "",
        otherReason: "",
        address: "",
        city: "",
        postcode: "",
        stateOrProvince: "",
        mobileNo: "",
        // Banking fields
        bankName: "",
        accountNumber: "",
        sortCode: "",
        iban: "",
        swift: "",
        aba: "",
        ifsc: "",
        bsbCode: "",
        branchCode: "",
        currency: "NGN",
        country: "Nigeria",
        narration: ""
    });

    const [paymentMethod, setPaymentMethod] = useState("");
    const [showConfirmation, setShowConfirmation] = useState(false);

    // Transaction submission state
    const [transactionSubmitted, setTransactionSubmitted] = useState(false);
    const [submittingTransaction, setSubmittingTransaction] = useState(false);
    const [transactionId, setTransactionId] = useState<string | null>(null);
    const [transactionRef, setTransactionRef] = useState("");
    const [exchangeRateState, setExchangeRateState] = useState<number>(DEFAULT_EXCHANGE_RATE);
    const EXCHANGE_RATE = exchangeRateState;
    const [affiliateRateId, setAffiliateRateId] = useState<string | null>(null);
    const [lockedRateId, setLockedRateId] = useState<string | null>(null);
    const [mitoBeneficiaryId, setMitoBeneficiaryId] = useState<string | null>(null);
    const [mitoProviders, setMitoProviders] = useState<MitoProviderOption[]>([]);
    const [selectedProvider, setSelectedProvider] = useState<{ providerId: string; providerCode: string } | null>(null);
    const [sendCurrencyDropdownOpen, setSendCurrencyDropdownOpen] = useState(false);
    const [receiveCurrencyDropdownOpen, setReceiveCurrencyDropdownOpen] = useState(false);
    const [sendCurrencySearch, setSendCurrencySearch] = useState("");
    const [receiveCurrencySearch, setReceiveCurrencySearch] = useState("");
    const sendCurrencyDropdownRef = useRef<HTMLDivElement>(null);
    const receiveCurrencyDropdownRef = useRef<HTMLDivElement>(null);
    const sendCurrencySearchInputRef = useRef<HTMLInputElement>(null);
    const receiveCurrencySearchInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            if (sendCurrencyDropdownRef.current && !sendCurrencyDropdownRef.current.contains(event.target as Node)) {
                setSendCurrencyDropdownOpen(false);
                setSendCurrencySearch("");
            }
            if (receiveCurrencyDropdownRef.current && !receiveCurrencyDropdownRef.current.contains(event.target as Node)) {
                setReceiveCurrencyDropdownOpen(false);
                setReceiveCurrencySearch("");
            }
        };
        document.addEventListener("mousedown", handleOutsideClick);
        return () => document.removeEventListener("mousedown", handleOutsideClick);
    }, []);

    useEffect(() => {
        if (sendCurrencyDropdownOpen) {
            const t = setTimeout(() => sendCurrencySearchInputRef.current?.focus(), 10);
            return () => clearTimeout(t);
        }
    }, [sendCurrencyDropdownOpen]);

    useEffect(() => {
        if (receiveCurrencyDropdownOpen) {
            const t = setTimeout(() => receiveCurrencySearchInputRef.current?.focus(), 10);
            return () => clearTimeout(t);
        }
    }, [receiveCurrencyDropdownOpen]);
    const [step3Errors, setStep3Errors] = useState<Record<string, string>>({});
    const [beneficiaryApiError, setBeneficiaryApiError] = useState<string | null>(null);
    const [beneficiaryCreatedSuccess, setBeneficiaryCreatedSuccess] = useState<string | null>(null);
    const clearStep3Error = (field: string) => {
        setBeneficiaryApiError(null);
        setStep3Errors((prev) => {
            if (!prev[field]) return prev;
            const next = { ...prev };
            delete next[field];
            return next;
        });
    };
    const [mitoLookupReasons, setMitoLookupReasons] = useState<MitoLookupTypeOption[]>([]);
    const [mitoLookupRelationships, setMitoLookupRelationships] = useState<MitoLookupTypeOption[]>([]);

    // Cancel transaction modal
    const [cancelTarget, setCancelTarget] = useState<TransactionDetails | null>(null);

    // Bank transfer inline page
    const [showBankTransferPage, setShowBankTransferPage] = useState(false);
    const [copiedField, setCopiedField] = useState<string | null>(null);

    // Payment countdown (30 minutes for bank transfer)
    const [paymentTimeLeft, setPaymentTimeLeft] = useState(1800); // 30 min
    const [paymentTimerActive, setPaymentTimerActive] = useState(false);
    const [transferComplete, setTransferComplete] = useState(false);

    // Session timer (rate lock countdown)
    const [sessionTimeLeft, setSessionTimeLeft] = useState(523); // ~8:43
    const [showExtendPopup, setShowExtendPopup] = useState(false);
    const [extendDismissed, setExtendDismissed] = useState(false);

    // Step 4 Mito Card Checkout (Checkout.com Web Components Flow) & PayByBank state
    const [mitoCardPaymentSession, setMitoCardPaymentSession] = useState<Record<string, unknown> | null>(null);
    const [mitoCheckoutPublicKey, setMitoCheckoutPublicKey] = useState<string>("pk_sbox_hxdmemjidz7nf3sfukhia4igsuf");
    const [mitoPayByBankUrl, setMitoPayByBankUrl] = useState<string | null>(null);
    const [paymentOutcome, setPaymentOutcome] = useState<PaymentOutcomeState | null>(null);
    const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null);
    const [refreshingJourneyStatus, setRefreshingJourneyStatus] = useState<boolean>(false);
    const [loadingPaymentMethod, setLoadingPaymentMethod] = useState<string | null>(null);
    const [checkoutFlowMounting, setCheckoutFlowMounting] = useState(false);
    const [checkoutFlowError, setCheckoutFlowError] = useState<string | null>(null);
    const checkoutFlowContainerRef = useRef<HTMLDivElement | null>(null);

    const applyPaymentOutcome = useCallback(
        (params: {
            rawStatus?: string | null;
            paymentStatus?: string | null;
            reason?: string | null;
            eventType?: string | null;
            reference?: string | null;
            methodLabel?: string;
            journeyCode?: string | null;
            autoRedirectHome?: boolean;
        }) => {
            const category = classifyPaymentOutcome(
                params.rawStatus,
                params.reason,
                params.eventType,
                params.paymentStatus,
            );
            const resolvedRef = (params.reference || transactionRef || "").trim();
            if (resolvedRef) {
                setTransactionRef(resolvedRef);
            }
            setMitoPayByBankUrl(null);
            setMitoCardPaymentSession(null);
            setShowConfirmation(false);
            setCurrentStep(4);
            const effectiveMethodLabel =
                params.methodLabel ||
                (paymentMethod === "card"
                    ? "Credit / Debit Card"
                    : paymentMethod === "wallet"
                    ? "Wallet Balance"
                    : paymentMethod === "manual_transfer"
                    ? "Manual Bank Transfer"
                    : "Instant Pay By Bank");
            setPaymentOutcome({
                category,
                rawStatus: String(params.rawStatus || category).toUpperCase(),
                paymentStatus: params.paymentStatus ? String(params.paymentStatus) : undefined,
                reference: resolvedRef || "PENDING",
                paymentMethodLabel: effectiveMethodLabel,
                reason: params.reason || undefined,
                journeyCode: params.journeyCode || extractJourneyCodeFromUrl(mitoPayByBankUrl),
                timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            });
            const shouldAutoRedirect =
                params.autoRedirectHome !== undefined ? params.autoRedirectHome : true;
            const countdownSeconds =
                category === "completed" || category === "processing" ? 6 : 8;
            setRedirectCountdown(shouldAutoRedirect ? countdownSeconds : null);
        },
        [mitoPayByBankUrl, paymentMethod, transactionRef],
    );

    const applyPaymentOutcomeRef = useRef(applyPaymentOutcome);
    applyPaymentOutcomeRef.current = applyPaymentOutcome;
    const transactionRefRef = useRef(transactionRef);
    transactionRefRef.current = transactionRef;
    const mountedSessionKeyRef = useRef<string>("");

    // After showing the Payment Status screen, count down so the customer can clearly see
    // the payment status before redirecting to the Home page ("/").
    useEffect(() => {
        if (redirectCountdown === null) return;
        if (redirectCountdown <= 0) {
            setRedirectCountdown(null);
            setLocation("/");
            return;
        }
        const timer = window.setTimeout(() => {
            setRedirectCountdown((prev) => (prev !== null ? prev - 1 : null));
        }, 1000);
        return () => window.clearTimeout(timer);
    }, [redirectCountdown, setLocation]);

    useEffect(() => {
        if (!mitoCardPaymentSession || currentStep !== 4) {
            mountedSessionKeyRef.current = "";
            return;
        }
        const sessionKey = String(
            (mitoCardPaymentSession as any)?.id ||
                (mitoCardPaymentSession as any)?.longId ||
                (mitoCardPaymentSession as any)?.payment_session_token ||
                "",
        );
        if (sessionKey && mountedSessionKeyRef.current === sessionKey) {
            return;
        }
        mountedSessionKeyRef.current = sessionKey;

        let cancelled = false;
        let flowInstance: any = null;
        setCheckoutFlowMounting(true);
        setCheckoutFlowError(null);

        const loadCheckoutScript = (): Promise<any> =>
            new Promise((resolve, reject) => {
                const win = window as any;
                if (typeof win.CheckoutWebComponents === "function") {
                    resolve(win.CheckoutWebComponents);
                    return;
                }
                const existing = document.querySelector(
                    'script[src="https://checkout-web-components.checkout.com/index.js"]',
                ) as HTMLScriptElement | null;
                if (existing) {
                    existing.addEventListener("load", () => resolve((window as any).CheckoutWebComponents));
                    existing.addEventListener("error", () => reject(new Error("Failed to load Checkout.com SDK")));
                    return;
                }
                const script = document.createElement("script");
                script.id = "checkout-web-components-sdk";
                script.src = "https://checkout-web-components.checkout.com/index.js";
                script.async = true;
                script.onload = () => resolve((window as any).CheckoutWebComponents);
                script.onerror = () => reject(new Error("Failed to load Checkout.com SDK"));
                document.body.appendChild(script);
            });

        const handleReady = () => {
            if (!cancelled) setCheckoutFlowMounting(false);
        };

        void loadCheckoutScript()
            .then(async (CheckoutWebComponents) => {
                if (cancelled || !CheckoutWebComponents) return;
                const container = document.getElementById("mito-checkout-flow-container");
                if (container) {
                    container.innerHTML = "";
                }
                const checkout = await CheckoutWebComponents({
                    publicKey: mitoCheckoutPublicKey || "pk_sbox_hxdmemjidz7nf3sfukhia4igsuf",
                    paymentSession: mitoCardPaymentSession,
                    environment: "sandbox",
                    componentOptions: {
                        card: {
                            displayCardholderName: "bottom",
                            data: {
                                cardholderName: "Mohammad Khan",
                            },
                        },
                        stored_card: {
                            captureCardCvv: true,
                        },
                    },
                    onReady: handleReady,
                    onPaymentCompleted: (
                        _component: unknown,
                        paymentResponse: {
                            id?: string;
                            status?: string;
                            declined_reason?: string;
                            response_summary?: string;
                        },
                    ) => {
                        if (cancelled) return;
                        setCheckoutFlowMounting(false);
                        setMitoCardPaymentSession(null);
                        const rawCardStatus = String(paymentResponse?.status || "Approved");
                        const normalizedStatus =
                            rawCardStatus === "Approved" ||
                            rawCardStatus === "APPROVED" ||
                            rawCardStatus === "Authorized" ||
                            rawCardStatus === "Captured" ||
                            rawCardStatus === "Paid"
                                ? "COMPSUCCESS"
                                : rawCardStatus;
                        const category = classifyPaymentOutcome(
                            normalizedStatus,
                            paymentResponse?.declined_reason || paymentResponse?.response_summary,
                            undefined,
                            rawCardStatus,
                        );
                        applyPaymentOutcomeRef.current({
                            rawStatus: normalizedStatus,
                            paymentStatus: rawCardStatus === "Approved" ? "Captured" : rawCardStatus,
                            reference: transactionRefRef.current || paymentResponse?.id || "",
                            methodLabel: "Credit / Debit Card",
                            reason:
                                paymentResponse?.declined_reason ||
                                paymentResponse?.response_summary ||
                                (category === "failed"
                                    ? "Your card payment was declined by the issuing bank."
                                    : undefined),
                            autoRedirectHome: true,
                        });
                    },
                    onError: (
                        componentOrErr: unknown,
                        errorArg?: {
                            message?: string;
                            code?: string;
                            errorCode?: string;
                            details?: { reason?: string };
                        },
                    ) => {
                        if (cancelled) return;
                        setCheckoutFlowMounting(false);
                        const errObj: any = errorArg || componentOrErr;
                        const code =
                            typeof errObj === "string"
                                ? errObj
                                : String(errObj?.code || errObj?.errorCode || "");
                        if (code.toLowerCase() === "component_invalid") {
                            // Form inputs (such as CVV) are incomplete/invalid; allow inline validation inside Flow
                            return;
                        }
                        const msg =
                            typeof errObj === "string"
                                ? errObj
                                : String(errObj?.details?.reason || errObj?.message || "").trim();
                        const inferredStatus =
                            code.toLowerCase().includes("expir") || msg.toLowerCase().includes("expired")
                                ? "EXPIRED"
                                : code.toLowerCase().includes("cancel") || msg.toLowerCase().includes("cancel")
                                ? "CANCELLED"
                                : "COMPFAILED";
                        applyPaymentOutcomeRef.current({
                            rawStatus: inferredStatus,
                            paymentStatus:
                                inferredStatus === "EXPIRED"
                                    ? "Expired"
                                    : inferredStatus === "CANCELLED"
                                    ? "Cancelled"
                                    : "Declined",
                            reference: transactionRefRef.current,
                            methodLabel: "Credit / Debit Card",
                            reason:
                                msg ||
                                "Your card payment could not be completed by the card processor. Please check your card details or try another payment method.",
                            autoRedirectHome: true,
                        });
                    },
                });
                if (cancelled) return;
                const flowComponent = checkout.create("flow", { onReady: handleReady });
                const isAvailable =
                    typeof flowComponent.isAvailable !== "function" || (await flowComponent.isAvailable());
                if (cancelled) {
                    if (typeof flowComponent.unmount === "function") {
                        flowComponent.unmount();
                    }
                    return;
                }
                if (isAvailable && document.getElementById("mito-checkout-flow-container")) {
                    flowInstance = flowComponent;
                    flowComponent.mount("#mito-checkout-flow-container");
                } else {
                    setCheckoutFlowError("Card checkout component is currently unavailable.");
                }
                setCheckoutFlowMounting(false);
            })
            .catch((err) => {
                if (cancelled) return;
                setCheckoutFlowMounting(false);
                setCheckoutFlowError(
                    err instanceof Error ? err.message : "Unable to load card checkout component.",
                );
            });

        return () => {
            cancelled = true;
            if (flowInstance && typeof flowInstance.unmount === "function") {
                try {
                    flowInstance.unmount();
                } catch {
                    // ignore unmount errors
                }
            }
            mountedSessionKeyRef.current = "";
        };
    }, [mitoCardPaymentSession, mitoCheckoutPublicKey, currentStep]);

    // Intercept Checkout.com 3DS redirect messages in the CAPTURE phase so Checkout.com's SDK never calls
    // window.location.replace(...) to an external domain (such as rhemito-web-nextjs-dev.herokuapp.com),
    // and instead resolves and displays the Payment Status screen directly on our domain.
    useEffect(() => {
        if (!mitoCardPaymentSession || currentStep !== 4) return;
        const handleCard3dsMessage = (event: MessageEvent) => {
            let data = event?.data;
            if (typeof data === "string") {
                try {
                    data = JSON.parse(data);
                } catch {
                    return;
                }
            }
            if (!data || typeof data !== "object") return;

            const isCheckoutRedirectMsg =
                data.type === "redirect" ||
                typeof data.payload?.url === "string" ||
                (typeof data.url === "string" && (data.payment_id || data.payment_session_id));

            if (isCheckoutRedirectMsg) {
                event.stopImmediatePropagation();
                event.stopPropagation();

                const redirectUrl = String(data.payload?.url || data.url || "").trim();
                const paymentId = String(data.payload?.payment_id || data.payment_id || "").trim();
                const sessionId = String(data.payload?.payment_session_id || data.payment_session_id || "").trim();
                const redirectReason = String(data.payload?.redirect_reason || data.redirect_reason || "").trim();
                const parsedLocal = extractCardOutcomeFromUrl(redirectUrl);
                const host = parsedLocal?.hostname || "";
                const needsServerCallback =
                    host.endsWith("checkout.com") ||
                    host.endsWith("funtechcom.com") ||
                    host.endsWith("mito.money") ||
                    (!parsedLocal?.status && !parsedLocal?.paymentStatus && Boolean(redirectUrl));

                if (!needsServerCallback && (parsedLocal?.status || parsedLocal?.paymentStatus)) {
                    applyPaymentOutcomeRef.current({
                        rawStatus: parsedLocal.status || parsedLocal.paymentStatus || "COMPSUCCESS",
                        paymentStatus: parsedLocal.paymentStatus || undefined,
                        reference:
                            parsedLocal.tnxref ||
                            transactionRefRef.current ||
                            parsedLocal.ckoSessionId ||
                            paymentId,
                        methodLabel: "Credit / Debit Card",
                        reason: parsedLocal.reason || undefined,
                        journeyCode: parsedLocal.journeyCode || undefined,
                        autoRedirectHome: true,
                    });
                    return;
                }

                void fetch("/api/send-money/mito/resolve-card-redirect", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        url: redirectUrl,
                        paymentId,
                        sessionId,
                        redirectReason,
                    }),
                })
                    .then((r) => r.json().catch(() => ({})))
                    .then((resolved: any) => {
                        const effectiveStatus =
                            resolved?.status ||
                            parsedLocal?.status ||
                            resolved?.paymentStatus ||
                            parsedLocal?.paymentStatus ||
                            (redirectReason.toLowerCase().includes("fail") ||
                            redirectReason.toLowerCase().includes("declin")
                                ? "COMPFAILED"
                                : redirectReason.toLowerCase().includes("cancel")
                                ? "CANCELLED"
                                : "COMPSUCCESS");
                        const effectivePaymentStatus =
                            resolved?.paymentStatus ||
                            parsedLocal?.paymentStatus ||
                            (classifyPaymentOutcome(effectiveStatus, resolved?.reason || redirectReason) === "completed"
                                ? "Captured"
                                : undefined);
                        applyPaymentOutcomeRef.current({
                            rawStatus: effectiveStatus,
                            paymentStatus: effectivePaymentStatus,
                            reference:
                                resolved?.tnxref ||
                                parsedLocal?.tnxref ||
                                transactionRefRef.current ||
                                resolved?.ckoSessionId ||
                                paymentId,
                            methodLabel: "Credit / Debit Card",
                            reason: resolved?.reason || parsedLocal?.reason || undefined,
                            journeyCode: resolved?.journeyCode || parsedLocal?.journeyCode || undefined,
                            autoRedirectHome: true,
                        });
                    })
                    .catch(() => {
                        applyPaymentOutcomeRef.current({
                            rawStatus: parsedLocal?.status || "COMPSUCCESS",
                            paymentStatus: parsedLocal?.paymentStatus || "Captured",
                            reference: parsedLocal?.tnxref || transactionRefRef.current || paymentId,
                            methodLabel: "Credit / Debit Card",
                            reason: parsedLocal?.reason || undefined,
                            autoRedirectHome: true,
                        });
                    });
                return;
            }

            if (typeof data.status === "string" && data.status.trim()) {
                const raw = data.status.trim();
                const mapped = raw.toUpperCase() === "APPROVED" ? "COMPSUCCESS" : raw;
                applyPaymentOutcomeRef.current({
                    rawStatus: mapped,
                    paymentStatus: typeof data.paymentStatus === "string" ? data.paymentStatus : undefined,
                    reference: data.tnxref || data.id || transactionRefRef.current,
                    methodLabel: "Credit / Debit Card",
                    reason: data.reason || data.message || undefined,
                    autoRedirectHome: true,
                });
            }
        };
        window.addEventListener("message", handleCard3dsMessage, true);
        return () => window.removeEventListener("message", handleCard3dsMessage, true);
    }, [mitoCardPaymentSession, currentStep]);

    // If Mito redirects back to our returnUrl with ?tnxref=...&status=... (either in an iframe or top-level window),
    // forward it to the parent window if in an iframe, or display the full-page Payment Status view if top-level.
    useEffect(() => {
        if (typeof window === "undefined") return;
        const extracted = extractCardOutcomeFromUrl(window.location.href);
        const tnxref = extracted?.tnxref || null;
        const status = extracted?.status || extracted?.paymentStatus || null;
        const paymentStatus = extracted?.paymentStatus || null;
        const ckoSessionId = extracted?.ckoSessionId || null;
        const reason = extracted?.reason || null;
        const journeyCodeParam = extracted?.journeyCode || null;
        const isCardCallbackPath =
            window.location.pathname.toLowerCase() === "/send/status" || Boolean(paymentStatus);

        if (window.parent !== window) {
            if (status || tnxref || journeyCodeParam || ckoSessionId) {
                window.parent.postMessage(
                    {
                        status: status || (ckoSessionId ? "AUTHORIZED" : undefined),
                        paymentStatus: paymentStatus || undefined,
                        tnxref: tnxref || ckoSessionId,
                        reason,
                        journeyCode: journeyCodeParam,
                        methodLabel: isCardCallbackPath || ckoSessionId ? "Credit / Debit Card" : undefined,
                    },
                    "*",
                );
            }
            return;
        }

        if (status || ckoSessionId) {
            applyPaymentOutcome({
                rawStatus: status || "AUTHORIZED",
                paymentStatus: paymentStatus || (ckoSessionId ? "Captured" : undefined),
                reason,
                reference: tnxref || ckoSessionId,
                journeyCode: journeyCodeParam,
                methodLabel: isCardCallbackPath || ckoSessionId ? "Credit / Debit Card" : undefined,
            });
            try {
                window.history.replaceState({}, "", "/send-money");
            } catch {
                // ignore history errors
            }
        } else if (journeyCodeParam) {
            void fetchMitoJourneyStatus(journeyCodeParam).then((jStatus) => {
                if (!jStatus) return;
                const effectiveStatus = jStatus.orderStatus || jStatus.journeyStatus || "PROCESSING";
                applyPaymentOutcome({
                    rawStatus: effectiveStatus,
                    reference: jStatus.orderNo || jStatus.partnerReferenceNumber || jStatus.reference || tnxref,
                    journeyCode: jStatus.journeyCode,
                });
            });
        }
    }, [applyPaymentOutcome]);

    // Restore pending transfer context when returning from Mini / Full / Extended KYC (/kyc)
    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const justCompleted = sessionStorage.getItem("rhemito_kyc_just_completed");
            const justCancelled = sessionStorage.getItem("rhemito_kyc_cancelled");
            const rawCtx = localStorage.getItem("kyc_context");
            if ((justCompleted === "true" || justCancelled === "true") && rawCtx) {
                sessionStorage.removeItem("rhemito_kyc_just_completed");
                sessionStorage.removeItem("rhemito_kyc_cancelled");
                localStorage.removeItem("kyc_context");
                const ctx = JSON.parse(rawCtx) as Record<string, any>;
                const restoredAmount = typeof ctx.amount === "string" ? ctx.amount : "100";
                const restoredSendCur = typeof ctx.sendCurrencyState === "string" ? ctx.sendCurrencyState : "GBP";
                const restoredRecvCur = typeof ctx.receiveCurrency === "string" ? ctx.receiveCurrency : "NGN";
                const restoredDelivery = typeof ctx.deliveryMethod === "string" ? ctx.deliveryMethod : "bank_deposit";
                setAmount(restoredAmount);
                setSendCurrencyState(restoredSendCur);
                const nextCountry = CURRENCY_TO_COUNTRY_INFO[restoredRecvCur]?.country || "Nigeria";
                setRecipientDetails((prev) => ({ ...prev, currency: restoredRecvCur, country: nextCountry }));
                setDeliveryMethod(restoredDelivery);
                if (ctx.lockedRateId) {
                    setLockedRateId(String(ctx.lockedRateId));
                    setAffiliateRateId(String(ctx.lockedRateId));
                }
                if (justCompleted === "true") {
                    setCurrentStep(typeof ctx.resumeStep === "number" ? ctx.resumeStep : 2);
                    // Re-validate and lock rate post-KYC so the verified user has a fresh active rateId
                    void validateMitoRate({
                        fromCurrency: restoredSendCur,
                        toCurrency: restoredRecvCur,
                        amount: parseFloat(restoredAmount || "100") || 100,
                        direction: "S",
                        service: restoredDelivery as SendMoneyService,
                        providerId: typeof ctx.providerId === "string" ? ctx.providerId : undefined,
                        returnUrl: `${window.location.origin}/kyc/return`,
                    }).then((revalidated) => {
                        if (revalidated?.rateId) {
                            setLockedRateId(revalidated.rateId);
                            setAffiliateRateId(revalidated.rateId);
                        }
                    });
                } else {
                    setCurrentStep(1);
                }
            }
        } catch {
            // ignore storage errors
        }
    }, []);

    // Listen for postMessage events from the Mito Plaid / Pay by Bank iframe (including MITO_LINK_SUCCESS & MITO_LINK_EXIT)
    useEffect(() => {
        if (!mitoPayByBankUrl || currentStep !== 4) return;
        const handleMessage = (event: MessageEvent) => {
            let payload = event?.data;
            if (typeof payload === "string") {
                try {
                    payload = JSON.parse(payload);
                } catch {
                    return;
                }
            }
            if (!payload || typeof payload !== "object") return;
            const eventType = String(payload.type || "").trim().toUpperCase();
            const reason = String(
                payload.reason ||
                payload.error?.reason ||
                payload.metadata?.reason ||
                payload.error?.message ||
                ""
            ).trim();
            const rawStatus = String(
                payload.status ||
                payload.orderStatus ||
                payload.paymentStatus ||
                payload.payload?.status ||
                payload.metadata?.status ||
                payload.error?.status ||
                (eventType === "MITO_LINK_SUCCESS" ? "COMPSUCCESS" : "") ||
                (eventType === "MITO_LINK_EXIT" ? (reason || "CANCELLED") : "")
            ).trim().toUpperCase();
            if (!rawStatus && eventType !== "MITO_LINK_SUCCESS" && eventType !== "MITO_LINK_EXIT") return;
            const ref = String(
                payload.tnxref ||
                payload.orderNo ||
                payload.payload?.transactionReference ||
                payload.metadata?.transactionReference ||
                payload.payload?.partnerReferenceNumber ||
                payload.metadata?.partnerReferenceNumber ||
                transactionRef ||
                ""
            ).trim();

            applyPaymentOutcome({
                rawStatus: rawStatus || eventType,
                reason: reason || undefined,
                eventType,
                reference: ref,
                methodLabel: "Instant Pay By Bank",
                journeyCode: extractJourneyCodeFromUrl(mitoPayByBankUrl),
            });
        };
        window.addEventListener("message", handleMessage, false);
        return () => window.removeEventListener("message", handleMessage, false);
    }, [mitoPayByBankUrl, currentStep, transactionRef, applyPaymentOutcome]);

    // Poll live Mito Journey status (`GET /api/send-money/mito/journey-status?journeyCode=...`) every 2.5s
    // while the Instant Pay By Bank modal is open. As soon as payment completes, fails, cancels, or expires
    // (including when the user scans the QR code and pays on their mobile phone), immediately close the modal
    // and transition to the full-page Payment Status view.
    useEffect(() => {
        if (!mitoPayByBankUrl || currentStep !== 4) return;
        const journeyCode = extractJourneyCodeFromUrl(mitoPayByBankUrl);
        if (!journeyCode) return;

        let cancelled = false;
        const checkStatus = async () => {
            const statusData = await fetchMitoJourneyStatus(journeyCode);
            if (cancelled || !statusData) return;

            const jStatus = String(statusData.journeyStatus || "").trim().toUpperCase();
            const oStatus = String(statusData.orderStatus || "").trim().toUpperCase();
            const resolvedRef =
                statusData.orderNo ||
                statusData.partnerReferenceNumber ||
                statusData.reference ||
                transactionRef;

            const isTerminalOrCompletedJourney =
                jStatus === "COMPLETED" ||
                jStatus === "FAILED" ||
                jStatus === "CANCELLED" ||
                jStatus === "CANCELED" ||
                jStatus === "EXPIRED";

            const isTerminalOrCompletedOrder =
                oStatus === "SUCCEEDED" ||
                oStatus === "SUCCESSFUL" ||
                oStatus === "PAID" ||
                oStatus === "COMPLETED" ||
                oStatus === "COMPSUCCESS" ||
                oStatus === "APPROVED" ||
                oStatus === "IN_REVIEW" ||
                oStatus === "INREVIEW" ||
                oStatus === "FAILED" ||
                oStatus === "COMPFAILED" ||
                oStatus === "DECLINED" ||
                oStatus === "REJECTED" ||
                oStatus === "CANCELLED" ||
                oStatus === "CANCELED" ||
                oStatus === "EXPIRED";

            if (isTerminalOrCompletedJourney || isTerminalOrCompletedOrder) {
                applyPaymentOutcome({
                    rawStatus: oStatus || jStatus,
                    reference: resolvedRef,
                    methodLabel: "Instant Pay By Bank",
                    journeyCode,
                });
            }
        };

        void checkStatus();
        const intervalId = window.setInterval(() => {
            void checkStatus();
        }, 2500);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [mitoPayByBankUrl, currentStep, transactionRef, applyPaymentOutcome]);

    // Manual Bank Transfer Confirmation
    const [showManualTransferConfirm, setShowManualTransferConfirm] = useState(false);
    const [isSubmittingTransaction, setIsSubmittingTransaction] = useState(false);
    const [showExpiryPopup, setShowExpiryPopup] = useState(false);
    const [expiryCountdown, setExpiryCountdown] = useState(5);
    const [showPromoModal, setShowPromoModal] = useState(false);
    const [bonusPanelOpen, setBonusPanelOpen] = useState(
        initialRewardParam === "referral" || initialRewardParam === "bonus",
    );
    const [activeRewardTab, setActiveRewardTab] = useState<"referral" | "bonus">(
        initialRewardParam === "bonus" ? "bonus" : "referral",
    );

    // Referral bonus — live wallet from the rewards API (US-5.2 / US-5.3)
    const rewards = useRewards();
    const activeOffer =
        rewards.data?.offers?.find(
            (o) =>
                o.currency === SEND_CURRENCY &&
                (!o.receive_currency || o.receive_currency.toUpperCase() === (recipientDetails.currency || "NGN").toUpperCase()),
        ) ??
        rewards.data?.offers?.find((o) => o.currency === SEND_CURRENCY) ??
        (rewards.data?.offer?.currency === SEND_CURRENCY ? rewards.data?.offer : rewards.data?.offer);
    // One bonus balance, in the currency of this transfer; no minimum to use it (BONUS-RHEMITO 7.5)
    const bonusWallet = balanceFor(rewards.data?.wallet, SEND_CURRENCY);

    useEffect(() => {
        const qs = new URLSearchParams(
            searchParams || (typeof window !== "undefined" ? window.location.search : ""),
        );
        const rewardParam = qs.get("reward");
        const curParam = qs.get("currency")?.toUpperCase();
        if (rewardParam === "referral" || rewardParam === "bonus") {
            setActiveRewardTab(rewardParam);
            setBonusPanelOpen(true);
        }
        if (curParam && ["GBP", "USD", "EUR"].includes(curParam)) {
            setSendCurrencyState(curParam);
        }
    }, [searchParams]);
    const bonusBalance = eligibleBonusBalance(
        bonusWallet,
        parseFloat(amount || "0"),
        activeOffer?.floor,
        recipientDetails.currency || "NGN",
        activeOffer?.receive_currency,
        activeRewardTab,
    );
    const [bonusChoice, setBonusChoiceState] = useState<BonusChoice>("none");
    const useBonus = bonusChoice !== "none" && bonusBalance > 0;
    const bonusType: 'pay_less' | 'send_more' = bonusChoice === "send_more" ? "send_more" : "pay_less";

    useEffect(() => {
        if (bonusChoice !== "none" && bonusBalance <= 0) {
            setBonusChoiceState("none");
        }
    }, [bonusBalance, bonusChoice]);

    // Calculations
    const fee = parseFloat(amount || "0") * FEE_PERCENTAGE;

    // Promo codes are validated by Mito Money; the discount it approves comes off the fee (features/promo).
    const promo = usePromoCode({
        amount: parseFloat(amount || "0"),
        fee,
        sendCurrency: SEND_CURRENCY,
        receiveCurrency: recipientDetails.currency || "NGN",
        paymentMethod: paymentMethod || null,
    });
    const promoApplied = promo.applied;
    useEffect(() => {
        if (promoApplied && bonusChoice !== "none") {
            setBonusChoiceState("none");
        }
    }, [promoApplied, bonusChoice]);
    const promoDiscount = promo.discount;
    const promoCode = promo.appliedCode ?? "";
    const promoOnAmount = promoApplied && promo.appliesTo === "amount";
    // Fee promos reduce the fee (never below 0); a Fixed amount promo comes off the whole amount to pay instead
    const effectiveFee = Math.max(0, fee - (promoApplied && !promoOnAmount ? promoDiscount : 0));
    const amountPromoDiscount = promoOnAmount ? Math.min(promoDiscount, parseFloat(amount || "0")) : 0;

    // Bonus Calculations
    const bonusAmount = useBonus ? creditToApply(bonusBalance, parseFloat(amount || "0"), SEND_CURRENCY) : 0;
    const setBonusChoice = (choice: BonusChoice) => {
        setBonusChoiceState(choice);
        const value = formatMoney(creditToApply(bonusBalance, parseFloat(amount || "0"), SEND_CURRENCY), SEND_CURRENCY);
        if (choice === "pay_less") toast(BONUS_COPY.toastPayLess(value));
        if (choice === "send_more") toast(BONUS_COPY.toastSendMore(value));
    };
    /** The server refused the bonus: reset the choice and reload the balance (BONUS-RHEMITO 7.5). */
    const bonusRefused = (e: SendMoneyApiError) => {
        if (e.code !== "BONUS_UNAVAILABLE") setBonusChoiceState("none");
        void rewards.refetch();
        toast({ title: e.code === "BONUS_CHANGED" ? BONUS_COPY.changedTitle : "Bonus not applied", description: e.message, variant: "destructive" });
    };

    // Total Pay = You Send + fee (after promo) - (Pay Less bonus). Never below 0 (AC-5.2.7)
    const totalPay = Math.max(0, (parseFloat(amount || "0") + effectiveFee) - amountPromoDiscount - (useBonus && bonusType === 'pay_less' ? bonusAmount : 0));

    // Amount Summary rows:
    //   You Send     = amount the customer entered (never includes fee or bonus)
    //   Amount Sent  = GBP actually converted for the recipient
    //                  (Pay Less: = You Send; Send More: = You Send + bonus)
    //   They Receive = Amount Sent x rate
    //   Total to Pay = You Send + fee - promo - (Pay Less bonus)
    const youSendAmount = parseFloat(amount || "0");
    const amountSentGBP = youSendAmount + (useBonus && bonusType === 'send_more' ? bonusAmount : 0);
    const finalReceiveAmount = (amountSentGBP * EXCHANGE_RATE).toFixed(2);
    const sendSymbol = CURRENCY_SYMBOLS[SEND_CURRENCY] ?? "£";
    const receiveSymbol = CURRENCY_SYMBOLS[recipientDetails.currency || "NGN"] ?? "₦";



    useEffect(() => {
        // Auto-calculate receive amount
        const val = parseFloat(amount || "0");
        setReceiveAmount((val * EXCHANGE_RATE).toFixed(2));
    }, [amount, EXCHANGE_RATE]);

    // Fetch live exchange rate for the selected corridor from GET /api/v1/mito/Exchange/affiliateRates
    useEffect(() => {
        let active = true;
        const recvCur = recipientDetails.currency || "NGN";
        void fetchMitoAffiliateRate(SEND_CURRENCY, recvCur).then((res) => {
            if (!active || !res) return;
            if (res.rate && res.rate > 0) {
                setExchangeRateState(res.rate);
            }
            if (res.rateId) {
                setAffiliateRateId(res.rateId);
            }
        });
        return () => {
            active = false;
        };
    }, [SEND_CURRENCY, recipientDetails.currency]);

    // Fetch beneficiary bank providers from GET /api/v1/mito/Lookups/provider
    // using countryIso3, serviceCode=MONEYTRANSFER, collectionMode (BANKACCOUNT | MOBILEMONEY), and CurrencyCode
    useEffect(() => {
        let active = true;
        const recvCur = (recipientDetails.currency || "NGN").toUpperCase();
        const countryIso3 = resolveBeneficiaryCountryIso3(
            selectedRecipient?.countryIso3 || recipientDetails.country,
            recvCur,
        );
        const collectionMode = deliveryMethod === "mobile_money" ? "MOBILEMONEY" : "BANKACCOUNT";
        void fetchMitoProviders({
            countryIso3,
            currencyCode: recvCur,
            serviceCode: "MONEYTRANSFER",
            collectionMode,
        }).then((list) => {
            if (!active) return;
            setMitoProviders(list);
            if (list.length === 0) {
                setSelectedProvider(null);
                return;
            }
            // Do NOT preselect any bank on the new beneficiary creation form.
            // Only restore the bank if the user selected an existing saved beneficiary from Step 2.
            if (selectedRecipient) {
                const byId = selectedRecipient.providerId
                    ? list.find((p) => p.providerId === selectedRecipient.providerId)
                    : undefined;
                const bankLower = (selectedRecipient.bank || "").trim().toLowerCase();
                const byName =
                    bankLower && bankLower !== "bank" && bankLower !== "bank transfer"
                        ? list.find(
                              (p) =>
                                  !p.isGeneric &&
                                  (p.providerName.toLowerCase() === bankLower ||
                                      p.providerName.toLowerCase().includes(bankLower) ||
                                      bankLower.includes(p.providerName.toLowerCase())),
                          )
                        : undefined;
                const matched = byId || byName;
                if (matched) {
                    setSelectedProvider({ providerId: matched.providerId, providerCode: matched.providerCode });
                    if (!matched.isGeneric) {
                        setRecipientDetails((prev) => ({
                            ...prev,
                            bankName: matched.providerName,
                        }));
                    }
                    return;
                }
            }
            setSelectedProvider(null);
        });
        return () => {
            active = false;
        };
    }, [recipientDetails.currency, recipientDetails.country, selectedRecipient, deliveryMethod]);

    // Fetch lookup types (Reason for transfer & Relationship) from GET /api/v1/mito/Lookups/types
    useEffect(() => {
        let active = true;
        void fetchMitoLookups().then((lookups) => {
            if (!active) return;
            const reasons = lookups.reason || lookups.purposes || [];
            const relationships = lookups.relationships || lookups.relationshipes || [];
            if (reasons.length > 0) {
                setMitoLookupReasons(reasons);
            }
            if (relationships.length > 0) {
                setMitoLookupRelationships(relationships);
            }
        });
        return () => {
            active = false;
        };
    }, []);

    // Fetch dynamic beneficiary requirements based on country/currency, entityType (I or B), and provider
    useEffect(() => {
        let active = true;
        const recvCur = (recipientDetails.currency || "NGN").toUpperCase();
        const countryIso3 = resolveBeneficiaryCountryIso3(
            selectedRecipient?.countryIso3 || recipientDetails.country,
            recvCur,
        );
        void fetchMitoBeneficiaryRequirements({
            currencyCode: recvCur,
            countryIso3,
            entityType: beneficiaryType === "business" ? "B" : "I",
            providerId: selectedProvider?.providerId || mitoProviders[0]?.providerId,
            service: deliveryMethod as SendMoneyService,
        }).then((reqs) => {
            if (!active) return;
            setBeneficiaryRequirements(reqs);
        });
        return () => {
            active = false;
        };
    }, [recipientDetails.currency, recipientDetails.country, selectedRecipient?.countryIso3, beneficiaryType, selectedProvider?.providerId, mitoProviders, deliveryMethod]);

    // Fetch sender's saved beneficiaries from GET /api/v1/mito/Beneficiaries?userId={{userId}}
    useEffect(() => {
        let active = true;
        void fetchMitoBeneficiaries({
            service: deliveryMethod as SendMoneyService,
        }).then((list) => {
            if (!active) return;
            const configuredAttr = (list as MitoBeneficiaryItem[] & { configured?: boolean }).configured;
            if (typeof configuredAttr === "boolean") {
                setMitoBeneficiariesConfigured(configuredAttr);
            }
            setSenderBeneficiaries(list);
        });
        return () => {
            active = false;
        };
    }, [deliveryMethod, currentStep]);

    // Step 4 (Payment) — Initiate Hosted Transaction via POST /api/v1/mito/Transactions/InitiateHostedTransaction
    useEffect(() => {
        if (currentStep !== 4 || !transactionId) return;
        let active = true;
        void initiateHostedSendMoneyTransaction(transactionId).then((res) => {
            if (!active || !res) return;
            if (res.mitoRateId) setLockedRateId(res.mitoRateId);
            if (res.mitoBeneficiaryId) setMitoBeneficiaryId(res.mitoBeneficiaryId);
            if (res.mitoReference) setTransactionRef(res.mitoReference);
        });
        return () => {
            active = false;
        };
    }, [currentStep, transactionId]);

    // Search sender's created beneficiaries via GET /api/v1/mito/Beneficiaries?userId={{userId}}&SearchingText=...
    useEffect(() => {
        const q = recipientSearch.trim();
        if (!q) {
            setSearchedBeneficiaries(null);
            setSearchingBeneficiaries(false);
            return;
        }
        let active = true;
        setSearchingBeneficiaries(true);
        const timer = setTimeout(() => {
            void fetchMitoBeneficiaries({
                service: deliveryMethod as SendMoneyService,
                searchingText: q,
            }).then((list) => {
                if (!active) return;
                setSearchedBeneficiaries(list);
                setSearchingBeneficiaries(false);
            });
        }, 180);
        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [recipientSearch, deliveryMethod]);

    const BENEFICIARY_LAST_TXN_STORAGE_KEY = "rhemito_beneficiary_last_txn_v1";

    const readSavedBeneficiaryTxnMeta = useCallback((meta: {
        beneficiaryId?: string | number | null;
        name?: string | null;
        account?: string | null;
    }): {
        relationship?: string;
        relationId?: string;
        reason?: string;
        reasonId?: string;
        otherReason?: string;
        narration?: string;
        nickName?: string;
    } | null => {
        if (typeof window === "undefined") return null;
        try {
            const raw = window.localStorage.getItem(BENEFICIARY_LAST_TXN_STORAGE_KEY);
            if (!raw) return null;
            const store = JSON.parse(raw) as Record<string, any>;
            if (!store || typeof store !== "object") return null;
            const idKey = meta.beneficiaryId ? `id:${String(meta.beneficiaryId).trim().toUpperCase()}` : "";
            const acctKey = meta.account ? `acct:${String(meta.account).replace(/\s+/g, "").toUpperCase()}` : "";
            const nameKey = meta.name ? `name:${String(meta.name).trim().toUpperCase()}` : "";
            return (
                (idKey && store[idKey]) ||
                (acctKey && store[acctKey]) ||
                (nameKey && store[nameKey]) ||
                null
            );
        } catch {
            return null;
        }
    }, []);

    const saveBeneficiaryTxnMeta = useCallback((
        meta: {
            beneficiaryId?: string | number | null;
            name?: string | null;
            account?: string | null;
        },
        details: {
            relationship?: string;
            relationId?: string;
            reason?: string;
            reasonId?: string;
            otherReason?: string;
            narration?: string;
            nickName?: string;
        },
    ) => {
        if (typeof window === "undefined") return;
        try {
            const raw = window.localStorage.getItem(BENEFICIARY_LAST_TXN_STORAGE_KEY);
            const store: Record<string, any> = raw ? JSON.parse(raw) || {} : {};
            const idKey = meta.beneficiaryId ? `id:${String(meta.beneficiaryId).trim().toUpperCase()}` : "";
            const acctKey = meta.account ? `acct:${String(meta.account).replace(/\s+/g, "").toUpperCase()}` : "";
            const nameKey = meta.name ? `name:${String(meta.name).trim().toUpperCase()}` : "";
            const keys = [idKey, acctKey, nameKey].filter(Boolean);
            if (keys.length === 0) return;
            for (const key of keys) {
                const existing = store[key] || {};
                store[key] = {
                    ...existing,
                    ...(details.relationship ? { relationship: details.relationship } : {}),
                    ...(details.relationId ? { relationId: details.relationId } : {}),
                    ...(details.reason ? { reason: details.reason } : {}),
                    ...(details.reasonId ? { reasonId: details.reasonId } : {}),
                    ...(details.otherReason !== undefined ? { otherReason: details.otherReason } : {}),
                    ...(details.narration ? { narration: details.narration } : {}),
                    ...(details.nickName ? { nickName: details.nickName } : {}),
                    updatedAt: Date.now(),
                };
            }
            window.localStorage.setItem(BENEFICIARY_LAST_TXN_STORAGE_KEY, JSON.stringify(store));
        } catch {
            // ignore storage errors
        }
    }, []);

    const resolveRelationshipOptionValue = useCallback((
        rawRelationship?: string | null,
        rawRelationId?: string | null,
    ): string => {
        const options = mitoLookupRelationships.length > 0
            ? mitoLookupRelationships.map((rel) => ({ value: rel.code, label: rel.name }))
            : [
                  { value: "family", label: "Family" },
                  { value: "friend", label: "Friend" },
                  { value: "business", label: "Business Service" },
              ];
        const candidates: string[] = [];
        if (rawRelationship && String(rawRelationship).trim()) {
            candidates.push(String(rawRelationship).trim());
        }
        if (rawRelationId && String(rawRelationId).trim()) {
            const relIdClean = String(rawRelationId).trim().toLowerCase();
            const relOpts = beneficiaryRequirements.find((r) => r.name === "beneficiaryRelationId")?.dropdownOptions || [];
            const matchedReq = relOpts.find((o) => o.id.toLowerCase() === relIdClean);
            if (matchedReq?.name) {
                candidates.push(matchedReq.name.trim());
            }
            const matchedLookupById = mitoLookupRelationships.find((r) => r.id && r.id.toLowerCase() === relIdClean);
            if (matchedLookupById) {
                candidates.push(matchedLookupById.code, matchedLookupById.name);
            }
        }
        for (const cand of candidates) {
            const candLower = cand.toLowerCase();
            const candAlpha = candLower.replace(/[^a-z0-9]/g, "");
            const exact = options.find(
                (o) =>
                    o.value.toLowerCase() === candLower ||
                    o.label.toLowerCase() === candLower ||
                    o.value.toLowerCase().replace(/[^a-z0-9]/g, "") === candAlpha ||
                    o.label.toLowerCase().replace(/[^a-z0-9]/g, "") === candAlpha,
            );
            if (exact) return exact.value;
            const partial = options.find(
                (o) =>
                    o.label.toLowerCase().includes(candLower) ||
                    candLower.includes(o.label.toLowerCase()) ||
                    o.value.toLowerCase().includes(candAlpha),
            );
            if (partial) return partial.value;
        }
        return rawRelationship ? String(rawRelationship).trim() : "";
    }, [mitoLookupRelationships, beneficiaryRequirements]);

    const resolveReasonOptionValue = useCallback((
        rawReason?: string | null,
        rawReasonId?: string | null,
    ): string => {
        const options = mitoLookupReasons.length > 0
            ? mitoLookupReasons.map((rsn) => ({ value: rsn.code, label: rsn.name }))
            : [
                  { value: "family_support", label: "Family Support" },
                  { value: "education", label: "Education" },
                  { value: "bills", label: "Bills" },
                  { value: "medical", label: "Medical Expenses" },
                  { value: "other", label: "Other" },
              ];
        const candidates: string[] = [];
        if (rawReason && String(rawReason).trim()) {
            candidates.push(String(rawReason).trim());
        }
        if (rawReasonId && String(rawReasonId).trim()) {
            const rsnIdClean = String(rawReasonId).trim().toLowerCase();
            const rsnOpts = beneficiaryRequirements.find((r) => r.name === "beneficiaryReasonId")?.dropdownOptions || [];
            const matchedReq = rsnOpts.find((o) => o.id.toLowerCase() === rsnIdClean);
            if (matchedReq?.name) {
                candidates.push(matchedReq.name.trim());
            }
            const matchedLookupById = mitoLookupReasons.find((r) => r.id && r.id.toLowerCase() === rsnIdClean);
            if (matchedLookupById) {
                candidates.push(matchedLookupById.code, matchedLookupById.name);
            }
        }
        for (const cand of candidates) {
            const candLower = cand.toLowerCase();
            const candAlpha = candLower.replace(/[^a-z0-9]/g, "");
            const exact = options.find(
                (o) =>
                    o.value.toLowerCase() === candLower ||
                    o.label.toLowerCase() === candLower ||
                    o.value.toLowerCase().replace(/[^a-z0-9]/g, "") === candAlpha ||
                    o.label.toLowerCase().replace(/[^a-z0-9]/g, "") === candAlpha,
            );
            if (exact) return exact.value;
            const partial = options.find(
                (o) =>
                    o.label.toLowerCase().includes(candLower) ||
                    candLower.includes(o.label.toLowerCase()) ||
                    o.value.toLowerCase().includes(candAlpha),
            );
            if (partial) return partial.value;
            // Map common Mito reason descriptions (e.g. "Family Support") to the closest lookup option
            if (candLower.includes("family") || candLower.includes("support") || candLower.includes("upkeep") || candLower.includes("allowance")) {
                const famOpt = options.find(
                    (o) =>
                        o.label.toLowerCase().includes("family") ||
                        o.label.toLowerCase().includes("support") ||
                        o.label.toLowerCase().includes("expenditure") ||
                        o.value.toLowerCase().includes("expenditure"),
                );
                if (famOpt) return famOpt.value;
            }
        }
        if (candidates.length > 0 && options.length > 0) {
            return options[0].value;
        }
        return rawReason ? String(rawReason).trim() : "";
    }, [mitoLookupReasons, beneficiaryRequirements]);

    // Pre-fill banking and latest transaction details (Relationship, Reason for Transfer, Narration) from selected recipient
    useEffect(() => {
        if (selectedRecipient) {
            if (selectedRecipient.legalEntityType === "business" || selectedRecipient.legalEntityType === "individual") {
                setBeneficiaryType(selectedRecipient.legalEntityType);
            }
            if (selectedRecipient.providerId) {
                const foundProv = mitoProviders.find((p) => p.providerId === selectedRecipient.providerId);
                setSelectedProvider({
                    providerId: selectedRecipient.providerId,
                    providerCode: foundProv?.providerCode || "1203",
                });
            }
            const savedMeta = readSavedBeneficiaryTxnMeta({
                beneficiaryId: selectedRecipient.beneficiaryId || selectedRecipient.id,
                name: selectedRecipient.name,
                account: selectedRecipient.account,
            });
            const rawRelationship =
                savedMeta?.relationship ||
                selectedRecipient.relationship ||
                selectedRecipient.relationDescription ||
                "";
            const rawRelationId =
                savedMeta?.relationId ||
                selectedRecipient.relationId ||
                "";
            const rawReason =
                savedMeta?.reason ||
                selectedRecipient.reason ||
                selectedRecipient.reasonDescription ||
                "";
            const rawReasonId =
                savedMeta?.reasonId ||
                selectedRecipient.reasonId ||
                "";
            const resolvedRelationship = resolveRelationshipOptionValue(rawRelationship, rawRelationId);
            const resolvedReason = resolveReasonOptionValue(rawReason, rawReasonId);
            const resolvedNarration =
                savedMeta?.narration ||
                selectedRecipient.narration ||
                "";
            const resolvedOtherReason =
                savedMeta?.otherReason ??
                selectedRecipient.otherReason ??
                "";
            setRecipientDetails(prev => ({
                ...prev,
                firstName: selectedRecipient.firstName || selectedRecipient.name?.split(' ')[0] || prev.firstName,
                lastName: selectedRecipient.lastName || selectedRecipient.name?.split(' ').slice(1).join(' ') || prev.lastName,
                companyName: selectedRecipient.companyName || (selectedRecipient.legalEntityType === "business" ? selectedRecipient.name : prev.companyName) || prev.companyName,
                nickName: savedMeta?.nickName || selectedRecipient.beneficiaryNickname || prev.nickName,
                relationship: resolvedRelationship || prev.relationship,
                relationId: rawRelationId || prev.relationId,
                reason: resolvedReason || prev.reason,
                reasonId: rawReasonId || prev.reasonId,
                otherReason: resolvedOtherReason || prev.otherReason,
                address: selectedRecipient.address || prev.address,
                city: selectedRecipient.city || prev.city,
                postcode: selectedRecipient.postcode || prev.postcode,
                stateOrProvince: selectedRecipient.stateOrProvince || prev.stateOrProvince,
                mobileNo: selectedRecipient.mobileNo || prev.mobileNo,
                bankName: selectedRecipient.bank || prev.bankName,
                accountNumber: selectedRecipient.account || prev.accountNumber,
                sortCode: selectedRecipient.sortCode || prev.sortCode,
                iban: selectedRecipient.iban || prev.iban,
                swift: selectedRecipient.swift || prev.swift,
                aba: selectedRecipient.aba || prev.aba,
                ifsc: selectedRecipient.ifsc || prev.ifsc,
                bsbCode: selectedRecipient.bsbCode || prev.bsbCode,
                branchCode: selectedRecipient.branchCode || prev.branchCode,
                currency: selectedRecipient.currency || prev.currency,
                country: selectedRecipient.country || prev.country,
                narration: resolvedNarration || prev.narration,
            }));
        }
    }, [
        selectedRecipient,
        mitoProviders,
        mitoLookupRelationships,
        mitoLookupReasons,
        beneficiaryRequirements,
        readSavedBeneficiaryTxnMeta,
        resolveRelationshipOptionValue,
        resolveReasonOptionValue,
    ]);

    const AVATAR_COLORS = [
        "bg-blue-100 text-blue-600",
        "bg-purple-100 text-purple-600",
        "bg-green-100 text-green-600",
        "bg-orange-100 text-orange-600",
        "bg-teal-100 text-teal-600",
    ];

    const mapBeneficiaryToRecipient = (b: MitoBeneficiaryItem, idx: number) => {
        const words = (b.name || "Beneficiary").trim().split(/\s+/);
        const initials = words.length >= 2
            ? `${words[0][0] || ""}${words[1][0] || ""}`.toUpperCase()
            : (words[0].slice(0, 2) || "BN").toUpperCase();
        const matchedBank = b.providerId
            ? mitoProviders.find((p) => p.providerId === b.providerId)?.providerName
            : undefined;
        const savedMeta = readSavedBeneficiaryTxnMeta({
            beneficiaryId: b.beneficiaryId,
            name: b.name,
            account: b.acctNumber,
        });
        return {
            id: b.beneficiaryId || idx + 1,
            beneficiaryId: b.beneficiaryId,
            name: b.name,
            firstName: b.firstName,
            lastName: b.lastName,
            companyName: b.companyName,
            beneficiaryNickname: savedMeta?.nickName || b.beneficiaryNickname,
            legalEntityType: b.legalEntityType,
            providerId: b.providerId,
            bank: (b.bankName && b.bankName !== "Bank" ? b.bankName : matchedBank) || b.bankName || "Bank Transfer",
            account: b.acctNumber || "",
            sortCode: b.sortCode || "",
            iban: b.iban || "",
            swift: b.bicSwift || "",
            aba: b.aba || "",
            ifsc: b.ifsc || "",
            bsbCode: b.bsbCode || "",
            branchCode: b.branchCode || "",
            address: b.address || "",
            city: b.city || "",
            postcode: b.postcode || "",
            stateOrProvince: b.stateOrProvince || "",
            mobileNo: b.mobileNo || "",
            relationship: savedMeta?.relationship || b.relationship || b.relationDescription || "",
            relationDescription: b.relationDescription || "",
            relationId: savedMeta?.relationId || b.relationId || "",
            reason: savedMeta?.reason || b.reason || b.reasonDescription || "",
            reasonDescription: b.reasonDescription || "",
            reasonId: savedMeta?.reasonId || b.reasonId || "",
            otherReason: savedMeta?.otherReason || b.otherReason || "",
            currency: b.currency || "NGN",
            country: b.country || "Nigeria",
            countryIso3: b.countryIso3 || resolveBeneficiaryCountryIso3(b.country, b.currency),
            narration: savedMeta?.narration || b.narration || "",
            initials,
            color: AVATAR_COLORS[idx % AVATAR_COLORS.length],
        };
    };

    const mappedSenderRecipients = senderBeneficiaries.map(mapBeneficiaryToRecipient);
    const mappedSearchedRecipients = searchedBeneficiaries
        ? searchedBeneficiaries.map(mapBeneficiaryToRecipient)
        : null;
    const baseRecipientsList = (mitoBeneficiariesConfigured || mappedSenderRecipients.length > 0)
        ? mappedSenderRecipients
        : recentRecipients;
    const localFilteredRecipients = recipientSearch.trim()
        ? baseRecipientsList.filter((r) => {
              const q = recipientSearch.trim().toLowerCase();
              return (
                  r.name.toLowerCase().includes(q) ||
                  ((r as any).beneficiaryNickname || "").toLowerCase().includes(q) ||
                  (r.bank || "").toLowerCase().includes(q) ||
                  (r.account || "").toLowerCase().includes(q)
              );
          })
        : baseRecipientsList;
    const displayRecipients = recipientSearch.trim()
        ? (mappedSearchedRecipients && mappedSearchedRecipients.length > 0
              ? mappedSearchedRecipients
              : localFilteredRecipients)
        : baseRecipientsList;




    const [validatingStep1Rate, setValidatingStep1Rate] = useState(false);

    const handleNext = async () => {
        if (currentStep === 1) {
            setValidatingStep1Rate(true);
            try {
                const recvCurrency = recipientDetails.currency || "NGN";
                const activeProviderId = selectedProvider?.providerId || mitoProviders[0]?.providerId;
                const returnUrl = typeof window !== "undefined" ? `${window.location.origin}/kyc/return` : undefined;
                const validated = await validateMitoRate({
                    fromCurrency: SEND_CURRENCY,
                    toCurrency: recvCurrency,
                    amount: parseFloat(amount || "100") || 100,
                    direction: "S",
                    service: deliveryMethod as SendMoneyService,
                    providerId: activeProviderId,
                    returnUrl,
                });
                if (validated?.rateId) {
                    setLockedRateId(validated.rateId);
                    setAffiliateRateId(validated.rateId);
                }

                const needsHostedKyc =
                    Boolean(validated?.kycUrl) &&
                    (validated?.isTransactionAllowed === false ||
                        validated?.isKycRequired === true ||
                        validated?.isProfileUpdateRequired === true);

                let targetKycUrl: string | null = needsHostedKyc ? (validated?.kycUrl ?? null) : null;

                if (!targetKycUrl && validated && validated.isTransactionAllowed === false) {
                    const fallbackJourney = await fetchMitoKycJourney({
                        returnUrl,
                        journeyType: 1,
                    });
                    if (fallbackJourney?.hostedUrl) {
                        targetKycUrl = fallbackJourney.hostedUrl;
                    } else {
                        toast({
                            title: "Transaction Not Allowed",
                            description: "You are not allowed to make this transaction!! Please contact admin",
                            variant: "destructive",
                        });
                        return;
                    }
                }

                if (targetKycUrl) {
                    try {
                        localStorage.setItem(
                            "kyc_context",
                            JSON.stringify({
                                resumeStep: 2,
                                amount,
                                sendCurrencyState: SEND_CURRENCY,
                                receiveCurrency: recvCurrency,
                                deliveryMethod,
                                providerId: activeProviderId,
                                lockedRateId: validated?.rateId || affiliateRateId,
                            }),
                        );
                    } catch {
                        // ignore storage errors
                    }
                    toast({
                        title: "Your KYC is pending!!",
                        description: "You are being redirected to Compliance",
                    });
                    setLocation(`/kyc?url=${encodeURIComponent(targetKycUrl)}`);
                    return;
                }
            } finally {
                setValidatingStep1Rate(false);
            }
            setCurrentStep(2);
            return;
        }
        if (currentStep < 4) setCurrentStep((prev) => prev + 1);
        else setLocation("/"); // Finish
    };

    const handleBack = () => {
        if (currentStep > 1) setCurrentStep((prev) => prev - 1);
        else setLocation("/");
    };

    // Format seconds to MM:SS
    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        return { minutes: m, seconds: s };
    };

    // Session countdown timer
    useEffect(() => {
        if (sessionTimeLeft <= 0) return;
        const interval = setInterval(() => {
            setSessionTimeLeft((prev) => {
                const next = prev - 1;
                if (next === 30 && !extendDismissed) {
                    setShowExtendPopup(true);
                }
                if (next <= 0) {
                    clearInterval(interval);
                    setLocation("/");
                }
                return next;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [sessionTimeLeft <= 0, extendDismissed]);

    // Copy to clipboard helper
    const handleCopy = (value: string, fieldName: string) => {
        navigator.clipboard.writeText(value);
        setCopiedField(fieldName);
        setTimeout(() => setCopiedField(null), 2000);
    };

    // Copy all bank details
    const handleCopyAll = () => {
        const allDetails = `Amount to Pay: GBP ${totalPay.toFixed(2)}\nPayee Name: Rhemito – Firopo Akin-Agunbiade\nAccount Number: 20739483\nSort Code: 04-14-04\nPayment Reference: 20092400804\nTransaction Ref: ${transactionRef}`;
        navigator.clipboard.writeText(allDetails);
        setCopiedField('all');
        setTimeout(() => setCopiedField(null), 2000);
    };

    // Handle transaction submission on Step 3 Continue — creates the real
    // server-owned transaction (status awaiting_payment) so the Dashboard
    // unified table, cancel flow and notifications all work off server state.
    const handleSubmitTransaction = async () => {
        const recvCur = (recipientDetails.currency || "NGN").toUpperCase();
        const countryIso3 = resolveBeneficiaryCountryIso3(
            selectedRecipient?.countryIso3 || recipientDetails.country,
            recvCur,
        );
        const bankLower = (recipientDetails.bankName || "").trim().toLowerCase();
        const matchedProv =
            (selectedProvider && mitoProviders.find((p) => p.providerId === selectedProvider.providerId)) ||
            (bankLower &&
                mitoProviders.find(
                    (p) =>
                        p.providerName.toLowerCase() === bankLower ||
                        p.providerName.toLowerCase().includes(bankLower) ||
                        bankLower.includes(p.providerName.toLowerCase()),
                )) ||
            (mitoProviders.length === 1 && mitoProviders[0].isGeneric ? mitoProviders[0] : undefined);

        const errors: Record<string, string> = {};
        if (beneficiaryType === "business") {
            if (!recipientDetails.companyName.trim()) {
                errors.companyName = "Company name is required.";
            }
        } else {
            if (!recipientDetails.firstName.trim()) {
                errors.firstName = "First name is required.";
            }
            if (!recipientDetails.lastName.trim()) {
                errors.lastName = "Last name is required.";
            }
        }

        if (!recipientDetails.relationship.trim()) {
            errors.relationship = "Relationship is required.";
        }
        if (!recipientDetails.reason.trim()) {
            errors.reason = "Reason for transfer is required.";
        }
        if ((recipientDetails.reason === "other" || recipientDetails.reason === "OTHERS") && !recipientDetails.otherReason.trim()) {
            errors.otherReason = "Please specify the reason for transfer.";
        }

        const isReqFieldRequired = (name: string) =>
            beneficiaryRequirements.some((r) => r.isDisplayable && r.isRequired && r.name === name);

        if (isReqFieldRequired("beneficiary_address") && !recipientDetails.address.trim()) {
            errors.address = "Address is required.";
        }
        if (isReqFieldRequired("beneficiary_city") && !recipientDetails.city.trim()) {
            errors.city = "City is required.";
        }
        if (isReqFieldRequired("beneficiary_state_or_province") && !recipientDetails.stateOrProvince.trim()) {
            errors.stateOrProvince = "State / Province is required.";
        }
        if (isReqFieldRequired("beneficiary_postcode") && !recipientDetails.postcode.trim()) {
            errors.postcode = "Postcode is required.";
        }
        if (deliveryMethod !== "mobile_money" && isReqFieldRequired("beneficiary_MobileNo") && !recipientDetails.mobileNo.trim()) {
            errors.mobileNo = "Mobile number is required.";
        }

        if (recvCur === "NGN" && !recipientDetails.narration.trim()) {
            errors.narration = "Narration is required for Nigerian accounts.";
        }

        const normalizedAcct = recipientDetails.accountNumber.replace(/\s+/g, "");
        const normalizedIban = recipientDetails.iban.replace(/\s+/g, "");
        const normalizedMobile = recipientDetails.mobileNo.replace(/\s+/g, "");
        const normalizedSwift = recipientDetails.swift.replace(/\s+/g, "");
        const normalizedSortCode = recipientDetails.sortCode.trim();
        if (
            normalizedAcct !== recipientDetails.accountNumber ||
            normalizedIban !== recipientDetails.iban ||
            normalizedMobile !== recipientDetails.mobileNo ||
            normalizedSwift !== recipientDetails.swift ||
            normalizedSortCode !== recipientDetails.sortCode
        ) {
            setRecipientDetails((prev) => ({
                ...prev,
                accountNumber: normalizedAcct,
                iban: normalizedIban,
                mobileNo: normalizedMobile,
                swift: normalizedSwift,
                sortCode: normalizedSortCode,
            }));
        }

        if (deliveryMethod === "mobile_money") {
            const hasSelectableOperators = mitoProviders.length > 0;
            if ((hasSelectableOperators && !matchedProv && !selectedProvider?.providerId) || !recipientDetails.bankName.trim()) {
                errors.bankName = "Please select a mobile operator.";
            }
            const mobileVal = (normalizedMobile || normalizedAcct).trim();
            if (!mobileVal) {
                errors.mobileNo = "Mobile number is required.";
            }
        } else {
            const hasSelectableBanks = mitoProviders.some((p) => !p.isGeneric);
            if ((hasSelectableBanks && !matchedProv && !selectedProvider?.providerId) || !recipientDetails.bankName.trim()) {
                errors.bankName = "Please select a bank name.";
            }

            if (recvCur === "NGN") {
                const acct = normalizedAcct;
                if (!acct) {
                    errors.accountNumber = "Account number is required.";
                } else if (!/^\d{10}$/.test(acct)) {
                    errors.accountNumber = "Please enter a valid 10-digit account number.";
                }
            } else if (recvCur === "GBP") {
                const acct = normalizedAcct;
                if (!acct) {
                    errors.accountNumber = "Account number is required.";
                } else if (!/^\d{8}$/.test(acct)) {
                    errors.accountNumber = "Please enter a valid 8-digit account number.";
                }
                if (!normalizedSortCode) {
                    errors.sortCode = "Sort code is required.";
                }
            } else {
                const ibanOrAcct = (normalizedIban || normalizedAcct).trim();
                if (!ibanOrAcct) {
                    errors.iban = "IBAN / Account Number is required.";
                }
                if (!normalizedSwift) {
                    errors.swift = "SWIFT / BIC is required.";
                }
            }

            if (isReqFieldRequired("aba") && !recipientDetails.aba.replace(/\s+/g, "")) {
                errors.aba = "ABA routing number is required.";
            }
            if (isReqFieldRequired("ifsc") && !recipientDetails.ifsc.replace(/\s+/g, "")) {
                errors.ifsc = "IFSC code is required.";
            }
            if (isReqFieldRequired("bsb_code") && !recipientDetails.bsbCode.replace(/\s+/g, "")) {
                errors.bsbCode = "BSB code is required.";
            }
            if (isReqFieldRequired("branch_code") && !recipientDetails.branchCode.replace(/\s+/g, "")) {
                errors.branchCode = "Branch code is required.";
            }
        }

        if (Object.keys(errors).length > 0) {
            setStep3Errors(errors);
            const firstMessage = Object.values(errors)[0];
            toast({
                title: "Mandatory fields required",
                description: firstMessage || "Please fill in all mandatory (*) fields before continuing.",
                variant: "destructive",
            });
            return;
        }

        setStep3Errors({});
        setBeneficiaryApiError(null);
        setBeneficiaryCreatedSuccess(null);
        setSubmittingTransaction(true);
        try {
            const existingMitoBeneficiaryId =
                selectedRecipient?.beneficiaryId && String(selectedRecipient.beneficiaryId).includes("-")
                    ? String(selectedRecipient.beneficiaryId)
                    : undefined;
            const isCreatingNewBeneficiary = !existingMitoBeneficiaryId;
            const recipientName = beneficiaryType === "business"
                ? recipientDetails.companyName.trim()
                : `${recipientDetails.firstName.trim()} ${recipientDetails.lastName.trim()}`.trim();

            const created = await createSendMoneyTransaction({
                recipientName,
                service: deliveryMethod as SendMoneyService,
                sendCurrency: SEND_CURRENCY,
                sendAmount: parseFloat(amount || "0").toFixed(2),
                receiveCurrency: recvCur,
                receiveAmount: finalReceiveAmount,
                fee: effectiveFee.toFixed(2),
                exchangeRate: String(EXCHANGE_RATE),
                beneficiaryType,
                companyName: beneficiaryType === "business" ? (recipientDetails.companyName.trim() || recipientName) : undefined,
                recipientFirstName: beneficiaryType === "individual" ? (recipientDetails.firstName || selectedRecipient?.name?.split(" ")[0] || "Recipient") : undefined,
                recipientLastName: beneficiaryType === "individual" ? (recipientDetails.lastName || selectedRecipient?.name?.split(" ").slice(1).join(" ") || "Beneficiary") : undefined,
                relationship: recipientDetails.relationship,
                relationId: recipientDetails.relationId || undefined,
                nickName: recipientDetails.nickName || undefined,
                reason: recipientDetails.reason,
                reasonId: recipientDetails.reasonId || undefined,
                otherReason: recipientDetails.otherReason || undefined,
                narration: recipientDetails.narration || undefined,
                address: recipientDetails.address || undefined,
                city: recipientDetails.city || undefined,
                postcode: recipientDetails.postcode || undefined,
                stateOrProvince: recipientDetails.stateOrProvince || undefined,
                mobileNo: (normalizedMobile || (deliveryMethod === "mobile_money" ? normalizedAcct : "")) || undefined,
                bankName: matchedProv && !matchedProv.isGeneric ? matchedProv.providerName : (recipientDetails.bankName.trim() || selectedRecipient?.bank || matchedProv?.providerName || undefined),
                accountNumber: (deliveryMethod === "mobile_money" ? (normalizedMobile || normalizedAcct) : normalizedAcct) || selectedRecipient?.account?.replace(/\s+/g, "") || undefined,
                sortCode: normalizedSortCode || undefined,
                iban: normalizedIban || undefined,
                swift: normalizedSwift || undefined,
                aba: recipientDetails.aba.replace(/\s+/g, "") || undefined,
                ifsc: recipientDetails.ifsc.replace(/\s+/g, "") || undefined,
                bsbCode: recipientDetails.bsbCode.replace(/\s+/g, "") || undefined,
                branchCode: recipientDetails.branchCode.replace(/\s+/g, "") || undefined,
                countryIso3,
                country: recipientDetails.country || CURRENCY_TO_COUNTRY_INFO[recvCur]?.country || undefined,
                beneficiaryId: existingMitoBeneficiaryId,
                providerId: matchedProv?.providerId || selectedProvider?.providerId || mitoProviders[0]?.providerId,
                providerCode: matchedProv?.providerCode || selectedProvider?.providerCode || mitoProviders[0]?.providerCode,
                affiliateRateId: affiliateRateId || undefined,
                ...(promoApplied && promoCode ? { promoCode, feeBeforePromo: fee.toFixed(2), ...(promoOnAmount ? { promoAppliesTo: "amount" as const, promoDiscount: amountPromoDiscount.toFixed(2) } : {}) } : {}),
            });
            setTransactionId(created.id);
            setTransactionRef(created.reference);
            if (created.mitoRateId) setLockedRateId(created.mitoRateId);
            if (created.mitoBeneficiaryId) setMitoBeneficiaryId(created.mitoBeneficiaryId);
            saveBeneficiaryTxnMeta(
                {
                    beneficiaryId: created.mitoBeneficiaryId || existingMitoBeneficiaryId || selectedRecipient?.beneficiaryId || selectedRecipient?.id,
                    name: recipientName,
                    account: (deliveryMethod === "mobile_money" ? (normalizedMobile || normalizedAcct) : normalizedAcct) || selectedRecipient?.account,
                },
                {
                    relationship: recipientDetails.relationship,
                    relationId: recipientDetails.relationId || undefined,
                    reason: recipientDetails.reason,
                    reasonId: recipientDetails.reasonId || undefined,
                    otherReason: recipientDetails.otherReason || undefined,
                    narration: recipientDetails.narration || undefined,
                    nickName: recipientDetails.nickName || undefined,
                },
            );
            if (isCreatingNewBeneficiary || created.mitoBeneficiaryCreated) {
                const resolvedBankName =
                    matchedProv && !matchedProv.isGeneric
                        ? matchedProv.providerName
                        : recipientDetails.bankName || selectedRecipient?.bank || matchedProv?.providerName || "Bank Transfer";
                const resolvedCountryName =
                    recipientDetails.country === "UK"
                        ? "United Kingdom"
                        : recipientDetails.country || CURRENCY_TO_COUNTRY_INFO[recvCur]?.country || "Nigeria";
                const syntheticEmail = `${(created.mitoBeneficiaryId || recipientName.toLowerCase().replace(/[^a-z0-9]/g, ".") || Date.now()).toString().toLowerCase()}@beneficiary.rhemito.local`;
                upsertRecipient({
                    id: created.mitoBeneficiaryId || undefined,
                    email: syntheticEmail,
                    contactType: beneficiaryType,
                    firstName: beneficiaryType === "individual" ? recipientDetails.firstName.trim() : "",
                    lastName: beneficiaryType === "individual" ? recipientDetails.lastName.trim() : "",
                    businessName: beneficiaryType === "business" ? recipientDetails.companyName.trim() : "",
                    country: resolvedCountryName,
                    currency: recvCur,
                    bankName: resolvedBankName,
                    accountNumber: (recipientDetails.accountNumber || recipientDetails.iban || "").trim(),
                    sortCode: recipientDetails.sortCode.trim(),
                    iban: recipientDetails.iban.trim(),
                    swift: recipientDetails.swift.trim(),
                    serviceType: deliveryMethod === "mobile_money" ? "Mobile Money" : "Bank Deposit",
                    narration: recipientDetails.narration.trim(),
                    relationship: recipientDetails.relationship || "Family",
                });
                const successMsg = `${recipientName} has been added to your beneficiaries.`;
                setBeneficiaryCreatedSuccess(successMsg);
                toast({
                    title: "Beneficiary created successfully",
                    description: successMsg,
                });
            }
            void fetchMitoBeneficiaries({
                service: deliveryMethod as SendMoneyService,
            }).then((list) => {
                setSenderBeneficiaries(list);
            });
            setTransactionSubmitted(true);
            setCurrentStep(4);
        } catch (err) {
            const friendlyMsg = err instanceof Error && err.message
                ? err.message
                : "We couldn't create the beneficiary with the provided details. Please check the information and try again.";
            setBeneficiaryApiError(friendlyMsg);
            toast({
                title: "Could not create beneficiary",
                description: friendlyMsg,
                variant: "destructive",
            });
        } finally {
            setSubmittingTransaction(false);
        }
    };

    // Payment countdown timer (30 min for bank transfer page)
    useEffect(() => {
        if (!paymentTimerActive || paymentTimeLeft <= 0) return;
        const interval = setInterval(() => {
            setPaymentTimeLeft((prev) => {
                if (prev <= 1) {
                    clearInterval(interval);
                    setPaymentTimerActive(false);
                    setShowExpiryPopup(true);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [paymentTimerActive, paymentTimeLeft <= 0]);

    // Auto-redirect countdown when expiry popup is shown
    useEffect(() => {
        if (!showExpiryPopup) return;
        setExpiryCountdown(5);
        const interval = setInterval(() => {
            setExpiryCountdown((prev) => {
                if (prev <= 1) {
                    clearInterval(interval);
                    handleExpiryRedirect();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [showExpiryPopup]);

    const handleExpiryRedirect = useCallback(() => {
        setShowExpiryPopup(false);
        setShowBankTransferPage(false);
        setPaymentTimerActive(false);
        setPaymentTimeLeft(1800);
        setExpiryCountdown(5);
        setPaymentMethod("");
        setLocation("/");
        // Show toast after redirect so it's visible on the dashboard
        setTimeout(() => {
            toast({
                title: "Transaction Aborted",
                description: "Your transaction has been aborted due to payment timeout. An email notification has been sent to your registered email address.",
                variant: "destructive",
            });
        }, 500);
    }, [setLocation, toast]);

    const handleCancelClick = () => {
        const serviceLabels: Record<string, string> = {
            bank_deposit: "Bank Deposit",
            mobile_money: "Mobile Money",
            cash_pickup: "Cash Pickup",
        };
        setCancelTarget({
            id: transactionRef,
            recipient: selectedRecipient?.name
                ?? (`${recipientDetails.firstName} ${recipientDetails.lastName}`.trim() || "Unknown"),
            amount: `GBP ${totalPay.toFixed(2)}`,
            service: serviceLabels[deliveryMethod] ?? deliveryMethod ?? "Bank Transfer",
        });
    };

    const handleCancelConfirm = async (_transactionId: string): Promise<void> => {
        // Cancel the real server-owned transaction — the bell notification is
        // dispatched server-side with the same payload shape this page used to
        // send itself, and the Dashboard picks the change up via polling.
        if (transactionId) {
            try {
                await cancelSendMoneyTransaction(transactionId);
            } catch {
                // Already cancelled or store unavailable — continue with the UX flow.
            }
        }
        void queryClient.invalidateQueries({ queryKey: ["/api/send-money/transactions"] });
        void queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
        void queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });

        setCancelTarget(null);
        setShowBankTransferPage(false);
        setPaymentTimerActive(false);
        setPaymentTimeLeft(1800);
        setPaymentMethod("");
        toast({
            title: "Transaction Cancelled",
            description: `Ref #${transactionRef} has been cancelled successfully. A confirmation has been sent to your registered email address.`,
            variant: "destructive",
        });
        setLocation("/");
    };

    const handleCancelModalClose = () => setCancelTarget(null);

    const formatPaymentTime = (seconds: number) => {
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    const timerDisplay = formatTime(sessionTimeLeft);

    return (
        <DashboardLayout>
            <div className="max-w-5xl mx-auto pb-10">
                {/* Header */}
                <div className="mb-4 flex items-center justify-between">
                    <h1 className="text-xl font-semibold text-[#323130]">Send Money</h1>
                    <div className="text-sm text-[#605e5c]">Step {currentStep} of {steps.length}</div>
                </div>

                {/* Stepper — hidden on Bank Transfer payment screen per design spec */}
                {!(currentStep === 4 && showBankTransferPage) && (
                    <div className="flex items-center justify-between mb-6 px-1 sm:px-4 md:px-12 relative overflow-hidden">
                        <div className="absolute left-6 right-6 top-4 h-0.5 bg-[#efefee] -z-10" />
                        {steps.map((step) => (
                            <div key={step.id} className="flex flex-col items-center bg-background px-1 sm:px-2 z-10">
                                <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-semibold mb-1.5 transition-colors ${currentStep >= step.id ? "bg-[#2e5bff] text-white shadow-xs" : "bg-[#efefee] text-[#605e5c]"
                                    }`}>
                                    {currentStep > step.id ? <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : step.id}
                                </div>
                                <span className={`text-[11px] sm:text-xs text-center leading-tight ${currentStep >= step.id ? "text-[#2e5bff] font-semibold" : "text-[#605e5c]"}`}>
                                    {step.title}
                                </span>
                            </div>
                        ))}
                    </div>
                )}

                <div className={currentStep >= 1 && currentStep <= steps.length ? "block w-full" : "grid grid-cols-1 lg:grid-cols-3 gap-8"}>
                    {/* Main Content Area */}
                    <div className={currentStep >= 1 && currentStep <= steps.length ? "w-full space-y-6" : "lg:col-span-2 space-y-6"}>

                        {/* Step 1: Amount */}
                        {currentStep === 1 && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="grid grid-cols-1 lg:grid-cols-5 gap-6 w-full"
                            >
                                <div className="lg:col-span-3 space-y-5">
                                    <div className="space-y-2">
                                        <div className="flex flex-wrap items-center justify-between gap-2 min-h-[28px]">
                                            <Label className="text-gray-500 shrink-0">You Send</Label>
                                            <div className="flex flex-wrap items-center justify-end gap-2">
                                                {promo.enabled && (
                                                    promoApplied ? (
                                                        <div className="inline-flex items-center gap-2 h-7 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 rounded-full shadow-2xs" data-testid="step1-promo-applied-pill">
                                                            <Check className="w-3.5 h-3.5 text-green-600" />
                                                            <span>Promo <strong className="font-mono">{promoCode}</strong> (−{formatPromoMoney(promoDiscount, SEND_CURRENCY).replace(/^−/, "")})</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => setShowPromoModal(true)}
                                                                className="text-blue-600 hover:underline ml-1"
                                                            >
                                                                Change
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={promo.remove}
                                                                className="text-gray-500 hover:text-red-600 ml-0.5"
                                                                aria-label="Remove promo code"
                                                            >
                                                                <X className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            disabled={useBonus}
                                                            title={useBonus ? "You can only use one reward at a time" : undefined}
                                                            onClick={() => setShowPromoModal(true)}
                                                            data-testid="step1-use-promo-btn"
                                                            className={`inline-flex items-center gap-1.5 h-7 text-xs font-semibold px-3 rounded-full shadow-2xs transition-all ${useBonus ? "bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed" : "text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100/80 border border-blue-200/80 cursor-pointer"}`}
                                                        >
                                                            <span>🏷️ Use Promo Code</span>
                                                        </button>
                                                    )
                                                )}
                                                <button
                                                    type="button"
                                                    disabled={promoApplied || (useBonus && activeRewardTab === "bonus")}
                                                    title={promoApplied || (useBonus && activeRewardTab === "bonus") ? "You can only use one reward at a time" : undefined}
                                                    onClick={() => {
                                                        if (activeRewardTab !== "referral") setBonusChoiceState("none");
                                                        setActiveRewardTab("referral");
                                                        setBonusPanelOpen(true);
                                                    }}
                                                    data-testid="step1-use-referral-btn"
                                                    className={`inline-flex items-center gap-1.5 h-7 text-xs font-semibold px-3 rounded-full shadow-2xs transition-all ${promoApplied || (useBonus && activeRewardTab === "bonus") ? "bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed" : activeRewardTab === "referral" && bonusPanelOpen ? "bg-teal-600 text-white border border-teal-600 cursor-pointer" : "text-teal-700 hover:text-teal-800 bg-teal-50 hover:bg-teal-100/80 border border-teal-200/80 cursor-pointer"}`}
                                                >
                                                    <span>🎁 Use Referral</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={promoApplied || (useBonus && activeRewardTab === "referral")}
                                                    title={promoApplied || (useBonus && activeRewardTab === "referral") ? "You can only use one reward at a time" : undefined}
                                                    onClick={() => {
                                                        if (activeRewardTab !== "bonus") setBonusChoiceState("none");
                                                        setActiveRewardTab("bonus");
                                                        setBonusPanelOpen(true);
                                                    }}
                                                    data-testid="step1-use-bonus-btn"
                                                    className={`inline-flex items-center gap-1.5 h-7 text-xs font-semibold px-3 rounded-full shadow-2xs transition-all ${promoApplied || (useBonus && activeRewardTab === "referral") ? "bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed" : activeRewardTab === "bonus" && bonusPanelOpen ? "bg-indigo-600 text-white border border-indigo-600 cursor-pointer" : "text-indigo-700 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100/80 border border-indigo-200/80 cursor-pointer"}`}
                                                >
                                                    <span>✨ Use Bonus</span>
                                                </button>
                                            </div>
                                        </div>
                                        {(promoApplied || useBonus) && (
                                            <p className="text-[11px] font-medium text-slate-500 text-right" data-testid="one-reward-at-a-time-note">
                                                You can only use one reward at a time.
                                            </p>
                                        )}
                                        <div className="relative flex bg-white border rounded-xl h-12 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all shadow-2xs">
                                            <div ref={sendCurrencyDropdownRef} className="relative flex shrink-0">
                                                <button
                                                    type="button"
                                                    aria-label="Send currency"
                                                    data-testid="send-currency-select"
                                                    onClick={() => {
                                                        setReceiveCurrencyDropdownOpen(false);
                                                        setReceiveCurrencySearch("");
                                                        setSendCurrencyDropdownOpen((prev) => {
                                                            if (prev) setSendCurrencySearch("");
                                                            return !prev;
                                                        });
                                                    }}
                                                    className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 bg-gray-50 border-r rounded-l-xl min-w-[95px] sm:min-w-[120px] h-full cursor-pointer"
                                                >
                                                    <img src={`https://flagcdn.com/w40/${CURRENCY_FLAGS[SEND_CURRENCY] ?? "gb"}.png`} alt={SEND_CURRENCY} className="w-6 sm:w-8 h-4 sm:h-6 object-cover rounded shadow-2xs" />
                                                    <span className="font-semibold text-base">{SEND_CURRENCY}</span>
                                                    <ChevronDown className={`w-3.5 h-3.5 text-gray-400 ml-auto transition-transform ${sendCurrencyDropdownOpen ? "rotate-180" : ""}`} />
                                                </button>
                                                {sendCurrencyDropdownOpen && (
                                                    <div
                                                        role="listbox"
                                                        className="absolute top-full left-0 mt-1 z-50 w-56 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden"
                                                    >
                                                        {/* First component on droplist: Search input box */}
                                                        <div className="p-2 border-b border-gray-100 bg-white sticky top-0 z-10">
                                                            <div className="relative flex items-center">
                                                                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 pointer-events-none" />
                                                                <input
                                                                    ref={sendCurrencySearchInputRef}
                                                                    type="text"
                                                                    value={sendCurrencySearch}
                                                                    placeholder="Search currency..."
                                                                    onChange={(e) => setSendCurrencySearch(e.target.value)}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === "Escape") {
                                                                            setSendCurrencyDropdownOpen(false);
                                                                            setSendCurrencySearch("");
                                                                        } else if (e.key === "Enter") {
                                                                            e.preventDefault();
                                                                            const list = (rewards.data?.sendCurrencies?.length ? rewards.data.sendCurrencies : ["GBP", "USD", "EUR"]).filter((c) => {
                                                                                const q = sendCurrencySearch.trim().toLowerCase();
                                                                                if (!q) return true;
                                                                                const country = (CURRENCY_TO_COUNTRY_INFO[c]?.country || "").toLowerCase();
                                                                                return c.toLowerCase().includes(q) || country.includes(q);
                                                                            });
                                                                            if (list[0]) {
                                                                                setSendCurrencyState(list[0]);
                                                                                setSendCurrencyDropdownOpen(false);
                                                                                setSendCurrencySearch("");
                                                                            }
                                                                        }
                                                                    }}
                                                                    className="w-full h-8 pl-8 pr-7 text-xs rounded-lg border border-gray-200 bg-gray-50/70 focus:bg-white focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none transition-colors"
                                                                />
                                                                {sendCurrencySearch && (
                                                                    <button
                                                                        type="button"
                                                                        tabIndex={-1}
                                                                        onClick={() => {
                                                                            setSendCurrencySearch("");
                                                                            sendCurrencySearchInputRef.current?.focus();
                                                                        }}
                                                                        className="absolute right-2 text-gray-400 hover:text-gray-600 p-0.5"
                                                                        aria-label="Clear search"
                                                                    >
                                                                        <X className="w-3 h-3" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="max-h-52 overflow-y-auto overscroll-contain p-1">
                                                            {(() => {
                                                                const allSend = rewards.data?.sendCurrencies?.length ? rewards.data.sendCurrencies : ["GBP", "USD", "EUR"];
                                                                const q = sendCurrencySearch.trim().toLowerCase();
                                                                const filteredSend = q
                                                                    ? allSend.filter((cur) => {
                                                                          const country = (CURRENCY_TO_COUNTRY_INFO[cur]?.country || "").toLowerCase();
                                                                          return cur.toLowerCase().includes(q) || country.includes(q);
                                                                      })
                                                                    : allSend;
                                                                if (filteredSend.length === 0) {
                                                                    return (
                                                                        <div className="py-3 px-2 text-center text-xs text-gray-500">
                                                                            No matching currency found
                                                                        </div>
                                                                    );
                                                                }
                                                                return filteredSend.map((cur) => {
                                                                    const isSelected = SEND_CURRENCY === cur;
                                                                    const countryLabel = CURRENCY_TO_COUNTRY_INFO[cur]?.country || "";
                                                                    return (
                                                                        <div
                                                                            key={cur}
                                                                            role="option"
                                                                            aria-selected={isSelected}
                                                                            onMouseDown={(e) => {
                                                                                e.preventDefault();
                                                                                setSendCurrencyState(cur);
                                                                                setSendCurrencyDropdownOpen(false);
                                                                                setSendCurrencySearch("");
                                                                            }}
                                                                            className={`flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${isSelected ? "bg-blue-50 text-blue-900 font-semibold" : "text-gray-900 hover:bg-gray-50"}`}
                                                                        >
                                                                            <div className="flex items-center gap-2.5 min-w-0">
                                                                                <img src={`https://flagcdn.com/w40/${CURRENCY_FLAGS[cur] ?? "gb"}.png`} alt={cur} className="w-6 h-4 object-cover rounded shadow-2xs shrink-0" />
                                                                                <span className="font-semibold">{cur}</span>
                                                                                {countryLabel && (
                                                                                    <span className="text-xs text-gray-500 truncate">{countryLabel}</span>
                                                                                )}
                                                                            </div>
                                                                            {isSelected && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
                                                                        </div>
                                                                    );
                                                                });
                                                            })()}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <input
                                                type="number"
                                                value={amount}
                                                onChange={e => setAmount(e.target.value)}
                                                className="flex-1 min-w-0 px-3 sm:px-4 text-base font-medium outline-none bg-transparent rounded-r-xl"
                                                placeholder="0.00"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between min-h-[28px]">
                                            <Label className="text-gray-500">They Receive</Label>
                                        </div>
                                        <div className="relative flex bg-white border rounded-xl h-12 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all shadow-2xs">
                                            <div ref={receiveCurrencyDropdownRef} className="relative flex shrink-0">
                                                <button
                                                    type="button"
                                                    aria-label="Receive currency"
                                                    data-testid="receive-currency-select"
                                                    onClick={() => {
                                                        setSendCurrencyDropdownOpen(false);
                                                        setSendCurrencySearch("");
                                                        setReceiveCurrencyDropdownOpen((prev) => {
                                                            if (prev) setReceiveCurrencySearch("");
                                                            return !prev;
                                                        });
                                                    }}
                                                    className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 bg-gray-50 border-r rounded-l-xl min-w-[95px] sm:min-w-[120px] h-full cursor-pointer"
                                                >
                                                    <img src={`https://flagcdn.com/w40/${CURRENCY_FLAGS[recipientDetails.currency || "NGN"] ?? "ng"}.png`} alt={recipientDetails.currency || "NGN"} className="w-6 sm:w-8 h-4 sm:h-6 object-cover rounded shadow-2xs" />
                                                    <span className="font-semibold text-base">{recipientDetails.currency || "NGN"}</span>
                                                    <ChevronDown className={`w-3.5 h-3.5 text-gray-400 ml-auto transition-transform ${receiveCurrencyDropdownOpen ? "rotate-180" : ""}`} />
                                                </button>
                                                {receiveCurrencyDropdownOpen && (
                                                    <div
                                                        role="listbox"
                                                        className="absolute top-full left-0 mt-1 z-50 w-64 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden"
                                                    >
                                                        {/* First component on droplist: Search input box */}
                                                        <div className="p-2 border-b border-gray-100 bg-white sticky top-0 z-10">
                                                            <div className="relative flex items-center">
                                                                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 pointer-events-none" />
                                                                <input
                                                                    ref={receiveCurrencySearchInputRef}
                                                                    type="text"
                                                                    value={receiveCurrencySearch}
                                                                    placeholder="Search currency or country..."
                                                                    onChange={(e) => setReceiveCurrencySearch(e.target.value)}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === "Escape") {
                                                                            setReceiveCurrencyDropdownOpen(false);
                                                                            setReceiveCurrencySearch("");
                                                                        } else if (e.key === "Enter") {
                                                                            e.preventDefault();
                                                                            const list = RECEIVE_CURRENCIES.filter((c) => {
                                                                                const q = receiveCurrencySearch.trim().toLowerCase();
                                                                                if (!q) return true;
                                                                                const country = (CURRENCY_TO_COUNTRY_INFO[c]?.country || "").toLowerCase();
                                                                                return c.toLowerCase().includes(q) || country.includes(q);
                                                                            });
                                                                            if (list[0]) {
                                                                                const nextCur = list[0];
                                                                                const nextCountry = CURRENCY_TO_COUNTRY_INFO[nextCur]?.country || "Nigeria";
                                                                                setSelectedProvider(null);
                                                                                setStep3Errors({});
                                                                                setRecipientDetails((prev) => ({
                                                                                    ...prev,
                                                                                    currency: nextCur,
                                                                                    country: nextCountry,
                                                                                    bankName: "",
                                                                                }));
                                                                                setReceiveCurrencyDropdownOpen(false);
                                                                                setReceiveCurrencySearch("");
                                                                            }
                                                                        }
                                                                    }}
                                                                    className="w-full h-8 pl-8 pr-7 text-xs rounded-lg border border-gray-200 bg-gray-50/70 focus:bg-white focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none transition-colors"
                                                                />
                                                                {receiveCurrencySearch && (
                                                                    <button
                                                                        type="button"
                                                                        tabIndex={-1}
                                                                        onClick={() => {
                                                                            setReceiveCurrencySearch("");
                                                                            receiveCurrencySearchInputRef.current?.focus();
                                                                        }}
                                                                        className="absolute right-2 text-gray-400 hover:text-gray-600 p-0.5"
                                                                        aria-label="Clear search"
                                                                    >
                                                                        <X className="w-3 h-3" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="max-h-52 overflow-y-auto overscroll-contain p-1">
                                                            {(() => {
                                                                const q = receiveCurrencySearch.trim().toLowerCase();
                                                                const filteredReceive = q
                                                                    ? RECEIVE_CURRENCIES.filter((cur) => {
                                                                          const countryLabel = (CURRENCY_TO_COUNTRY_INFO[cur]?.country || "").toLowerCase();
                                                                          return cur.toLowerCase().includes(q) || countryLabel.includes(q);
                                                                      })
                                                                    : RECEIVE_CURRENCIES;
                                                                if (filteredReceive.length === 0) {
                                                                    return (
                                                                        <div className="py-3 px-2 text-center text-xs text-gray-500">
                                                                            No matching currency found
                                                                        </div>
                                                                    );
                                                                }
                                                                return filteredReceive.map((cur) => {
                                                                    const isSelected = (recipientDetails.currency || "NGN") === cur;
                                                                    const countryLabel = CURRENCY_TO_COUNTRY_INFO[cur]?.country || "";
                                                                    return (
                                                                        <div
                                                                            key={cur}
                                                                            role="option"
                                                                            aria-selected={isSelected}
                                                                            onMouseDown={(e) => {
                                                                                e.preventDefault();
                                                                                const nextCountry = CURRENCY_TO_COUNTRY_INFO[cur]?.country || "Nigeria";
                                                                                setSelectedProvider(null);
                                                                                setStep3Errors({});
                                                                                setRecipientDetails((prev) => ({
                                                                                    ...prev,
                                                                                    currency: cur,
                                                                                    country: nextCountry,
                                                                                    bankName: "",
                                                                                }));
                                                                                setReceiveCurrencyDropdownOpen(false);
                                                                                setReceiveCurrencySearch("");
                                                                            }}
                                                                            className={`flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${isSelected ? "bg-blue-50 text-blue-900 font-semibold" : "text-gray-900 hover:bg-gray-50"}`}
                                                                        >
                                                                            <div className="flex items-center gap-2.5 min-w-0">
                                                                                <img src={`https://flagcdn.com/w40/${CURRENCY_FLAGS[cur] ?? "ng"}.png`} alt={cur} className="w-6 h-4 object-cover rounded shadow-2xs shrink-0" />
                                                                                <span className="font-semibold">{cur}</span>
                                                                                {countryLabel && (
                                                                                    <span className="text-xs text-gray-500 truncate">{countryLabel}</span>
                                                                                )}
                                                                            </div>
                                                                            {isSelected && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
                                                                        </div>
                                                                    );
                                                                });
                                                            })()}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <input
                                                readOnly
                                                value={receiveAmount}
                                                className="flex-1 min-w-0 px-3 sm:px-4 text-base font-medium outline-none bg-gray-50/70 text-gray-500 rounded-r-xl"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <h3 className="font-semibold text-base text-[#323130]">How will they receive the money?</h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                                            {[
                                                { id: "bank_deposit", label: "Bank Deposit", icon: Landmark },
                                                { id: "mobile_money", label: "Mobile Money", icon: Smartphone },
                                            ].map((method) => (
                                                <div
                                                    key={method.id}
                                                    onClick={() => {
                                                        if (deliveryMethod !== method.id) {
                                                            setDeliveryMethod(method.id);
                                                            setSelectedProvider(null);
                                                            setStep3Errors({});
                                                            setRecipientDetails((prev) => ({ ...prev, bankName: "" }));
                                                        }
                                                    }}
                                                    className={`
                                                        flex items-center justify-center sm:justify-start gap-2.5 px-4 py-3 rounded-lg cursor-pointer transition-all font-medium text-sm active:scale-[0.98]
                                                        ${deliveryMethod === method.id
                                                            ? "bg-[#ecf5ff] text-[#2e5bff] border border-[#2e5bff]"
                                                            : "bg-white text-[#605e5c] hover:bg-gray-50 border border-[#efefee]"}
                                                    `}
                                                >
                                                    <method.icon className={`w-4 h-4 sm:w-5 sm:h-5 shrink-0 ${deliveryMethod === method.id ? "text-[#2e5bff]" : "text-[#605e5c]"}`} />
                                                    <span className="truncate">{method.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Bonus is offered as soon as the customer lands on Step 1 (one reward at a time) */}
                                    {bonusPanelOpen && !promoApplied && (
                                        <UseBonusCredit
                                            balance={bonusWallet}
                                            unused={rewards.data?.wallet.unused}
                                            currency={SEND_CURRENCY}
                                            sendAmount={parseFloat(amount || "0")}
                                            receiveCurrency={recipientDetails.currency || "NGN"}
                                            exchangeRate={EXCHANGE_RATE}
                                            choice={bonusChoice}
                                            onChoice={setBonusChoice}
                                            onClose={() => setBonusPanelOpen(false)}
                                            activeTab={activeRewardTab}
                                            blocked={rewards.data?.wallet.bonus_blocked}
                                            referralFloor={activeOffer?.floor}
                                            referralReceiveCurrency={activeOffer?.receive_currency}
                                        />
                                    )}


                                    <div className="space-y-1 pt-2 lg:hidden">
                                        <div className="flex items-center justify-between py-2">
                                            <div className="flex items-center gap-3 text-gray-600">
                                                <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                                                    <Wallet className="w-4 h-4" />
                                                </div>
                                                <span>Amount Sent</span>
                                            </div>
                                            <span className="font-medium whitespace-nowrap">{sendSymbol}{(parseFloat(amount) - effectiveFee).toFixed(2)}</span>
                                        </div>
                                        <div className="flex items-center justify-between py-2">
                                            <div className="flex items-center gap-3 text-gray-600">
                                                <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                                                    <BarChart3 className="w-4 h-4" />
                                                </div>
                                                <span>Fee</span>
                                            </div>
                                            <span className="font-medium whitespace-nowrap">{sendSymbol}{fee.toFixed(2)}</span>
                                        </div>
                                        {promoApplied && (
                                            <div className="flex items-center justify-between py-2 text-green-600 font-medium">
                                                <span>Promo ({promoCode})</span>
                                                <span className="whitespace-nowrap">- {formatPromoMoney(promoDiscount, SEND_CURRENCY).replace(/^−/, "")}</span>
                                            </div>
                                        )}
                                        <div className="flex items-center justify-between py-2 bg-blue-50 px-4 rounded-lg -mx-4">
                                            <div className="flex items-center gap-3 text-gray-600">
                                                <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-blue-600">
                                                    <ArrowRightLeft className="w-4 h-4" />
                                                </div>
                                                <span>Exchange Rate</span>
                                            </div>
                                            <span className="font-medium text-gray-900 whitespace-nowrap">{sendSymbol}1 = {receiveSymbol}{EXCHANGE_RATE.toFixed(2)}</span>
                                        </div>
                                    </div>

                                    <div className="pt-2 flex gap-3">
                                        <Button
                                            variant="outline"
                                            onClick={handleBack}
                                            className="flex-1 h-12 text-base rounded-full border-[#d2d0ce] text-[#323130]"
                                        >
                                            Back
                                        </Button>
                                        <Button
                                            onClick={handleNext}
                                            className="flex-1 h-12 text-base bg-[#2e5bff] hover:bg-blue-700 text-white font-semibold rounded-full shadow-none"
                                        >
                                            Continue
                                        </Button>
                                    </div>
                                </div>

                                {/* Right Column: Sticky Summary */}
                                <div className="lg:col-span-2 hidden lg:block">
                                    <div className="sticky top-6">
                                        <Card className="rounded-xl border border-[#efefee] bg-white shadow-[-2px_4px_16px_0px_rgba(0,0,0,0.04)]">
                                            <CardHeader className="pb-4 bg-white border-b border-[#efefee]">
                                                <CardTitle className="text-base font-semibold text-[#323130]">Amount Summary</CardTitle>
                                            </CardHeader>
                                            <CardContent className="space-y-3 text-sm pt-4">
                                                {promoApplied && promoDiscount > 0 && (
                                                    <div className="flex justify-between font-medium text-green-700" data-testid="summary-promo-step1">
                                                        <span>{PROMO_COPY.summaryLabel(promoCode)}</span>
                                                        <span className="whitespace-nowrap">−{formatPromoMoney(promoDiscount, SEND_CURRENCY).replace(/^−/, "")}</span>
                                                    </div>
                                                )}
                                                {useBonus && (
                                                    <div className="flex justify-between font-medium text-teal-700 bg-teal-50 px-2 py-1 -mx-2 rounded" data-testid="summary-bonus-step1">
                                                        <span>{bonusType === "pay_less" ? BONUS_COPY.summaryPayLess : BONUS_COPY.summarySendMore}</span>
                                                        <span className="whitespace-nowrap">{bonusType === "pay_less" ? "-" : "+"} {sendSymbol}{bonusAmount.toFixed(2)}</span>
                                                    </div>
                                                )}
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">You Send</span>
                                                    <span className="font-medium text-gray-900 whitespace-nowrap">{sendSymbol}{youSendAmount.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Amount Sent</span>
                                                    <span className="font-medium text-gray-900 whitespace-nowrap">{sendSymbol}{amountSentGBP.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">They Receive</span>
                                                    <span className="font-medium text-gray-900 whitespace-nowrap">
                                                        {receiveSymbol}{finalReceiveAmount}
                                                        {useBonus && bonusType === "send_more" && (
                                                            <span className="text-xs text-green-600 ml-2 font-bold">(+Bonus)</span>
                                                        )}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Transaction Fee</span>
                                                    <span className="font-medium text-gray-900 whitespace-nowrap">{sendSymbol}{effectiveFee.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Exchange Rate</span>
                                                    <span className="font-medium text-gray-900 whitespace-nowrap">{sendSymbol}1 = {receiveSymbol}{EXCHANGE_RATE.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between pt-2">
                                                    <span className="text-gray-600">Connection Method</span>
                                                    <span className="font-medium text-right capitalize">{deliveryMethod.replace('_', ' ')}</span>
                                                </div>

                                                <div className="pt-4 mt-2 border-t">
                                                    <div className="flex justify-between items-center pt-2">
                                                        <span className="text-gray-900 font-bold text-base">Total to Pay</span>
                                                        <span className="font-bold text-lg text-gray-900 whitespace-nowrap">{sendSymbol}{Math.max(0, totalPay).toFixed(2)}</span>
                                                    </div>
                                                    {(promoApplied || useBonus) && (
                                                        <p className="text-xs text-green-600 font-medium mt-1">
                                                            Includes {promoApplied && "promo code"}{promoApplied && useBonus && " & "}{useBonus && (bonusType === 'pay_less' ? "Bonus Discount" : "Bonus Credit")}
                                                        </p>
                                                    )}
                                                </div>

                                                {selectedRecipient && (
                                                    <div className="pt-4 mt-3 border-t space-y-2.5">
                                                        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                                            Recipient Details
                                                        </div>
                                                        <div className="flex justify-between gap-2">
                                                            <span className="text-gray-600 shrink-0">Recipient Name</span>
                                                            <span className="font-medium text-gray-900 text-right truncate">
                                                                {selectedRecipient.name || "—"}
                                                            </span>
                                                        </div>
                                                        <div className="flex justify-between gap-2">
                                                            <span className="text-gray-600 shrink-0">
                                                                {deliveryMethod === "mobile_money" ? "Mobile Operator" : "Bank Name"}
                                                            </span>
                                                            <span className="font-medium text-gray-900 text-right truncate">
                                                                {selectedRecipient.bank || "—"}
                                                            </span>
                                                        </div>
                                                        <div className="flex justify-between gap-2">
                                                            <span className="text-gray-600 shrink-0">
                                                                {deliveryMethod === "mobile_money" ? "Mobile Number" : "Account Number"}
                                                            </span>
                                                            <span className="font-mono font-medium text-gray-900 text-right break-all">
                                                                {selectedRecipient.account || selectedRecipient.iban || selectedRecipient.mobileNo || "—"}
                                                            </span>
                                                        </div>
                                                    </div>
                                                )}
                                            </CardContent>
                                        </Card>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {/* Step 1 Promo Code Modal */}
                        {showPromoModal && (
                            <div
                                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                                onClick={() => setShowPromoModal(false)}
                                data-testid="step1-promo-modal"
                            >
                                <div
                                    className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-md p-6 space-y-4"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div className="flex items-center justify-between border-b pb-3">
                                        <h3 className="text-base font-bold text-gray-900">Insert Promo Code</h3>
                                        <button
                                            type="button"
                                            onClick={() => setShowPromoModal(false)}
                                            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
                                            aria-label="Close promo code modal"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <p className="text-xs text-gray-500">
                                        Have a promotional discount code? Enter it below to see your discount reflected immediately in your transfer summary.
                                    </p>
                                    <PromoCodeField promo={promo} bare />
                                </div>
                            </div>
                        )}

                        {/* Step 2: Recipient */}
                        {/* Step 2: Recipient */}
                        {currentStep === 2 && (
                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="grid grid-cols-1 lg:grid-cols-5 gap-6 w-full"
                            >
                                {/* Left Column: Recipient Selection */}
                                <div className="lg:col-span-3 space-y-5">
                                    <div className="space-y-6">
                                        <Button
                                            variant="outline"
                                            onClick={handleBack}
                                            className="gap-2 text-gray-600 hover:text-gray-900"
                                        >
                                            <ArrowLeft className="w-4 h-4" />
                                            Back
                                        </Button>
                                        <h2 className="text-lg font-bold text-gray-900">Who are you sending to?</h2>

                                        {/* Recent Recipients - Circles */}
                                        <div className="space-y-4">
                                            <Label className="text-gray-500 font-medium">Recent Recipients</Label>
                                            <div className="flex gap-6 overflow-x-auto pb-4">
                                                {baseRecipientsList.slice(0, 5).map(r => (
                                                    <div key={r.id} className="flex flex-col items-center gap-2 cursor-pointer group min-w-[80px]" onClick={() => { setSelectedRecipient(r); handleNext(); }}>
                                                        <div className={`w-14 h-14 rounded-full flex items-center justify-center font-bold text-lg ${r.color} group-hover:ring-2 ring-primary ring-offset-2 transition-all`}>
                                                            {r.initials}
                                                        </div>
                                                        <span className="text-xs font-medium text-gray-600 text-center truncate w-full">{r.name.split(' ')[0]}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Search and New Recipient */}
                                        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                                            <div className="relative flex-1">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                                                <input
                                                    type="text"
                                                    placeholder="Search recipient by name, bank, or account number"
                                                    value={recipientSearch}
                                                    onFocus={() => setRecipientSearchOpen(true)}
                                                    onBlur={() => setTimeout(() => setRecipientSearchOpen(false), 180)}
                                                    onChange={(e) => {
                                                        setRecipientSearch(e.target.value);
                                                        setRecipientSearchOpen(true);
                                                    }}
                                                    className="w-full h-11 pl-10 pr-8 rounded-xl border focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm"
                                                />
                                                {recipientSearch && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setRecipientSearch("");
                                                            setSearchedBeneficiaries(null);
                                                        }}
                                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                                                        aria-label="Clear recipient search"
                                                    >
                                                        <X className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                                {recipientSearchOpen && recipientSearch.trim().length > 0 && (
                                                    <div className="absolute top-full left-0 right-0 mt-1 z-50 max-h-60 overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white shadow-lg p-1">
                                                        {searchingBeneficiaries ? (
                                                            <div className="py-3 px-3 text-xs text-gray-500 flex items-center gap-2">
                                                                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                                                                <span>Searching created beneficiaries...</span>
                                                            </div>
                                                        ) : displayRecipients.length > 0 ? (
                                                            displayRecipients.map((r) => (
                                                                <div
                                                                    key={`suggest-${r.id}`}
                                                                    onMouseDown={(e) => {
                                                                        e.preventDefault();
                                                                        setRecipientSearchOpen(false);
                                                                        setSelectedRecipient(r);
                                                                        handleNext();
                                                                    }}
                                                                    className="flex items-center justify-between px-3 py-2.5 hover:bg-blue-50/70 rounded-lg cursor-pointer transition-colors"
                                                                >
                                                                    <div className="flex items-center gap-3 min-w-0">
                                                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${r.color} flex-shrink-0`}>
                                                                            {r.initials}
                                                                        </div>
                                                                        <div className="min-w-0">
                                                                            <div className="text-sm font-semibold text-gray-900 truncate">{r.name}</div>
                                                                            <div className="text-xs text-gray-500 truncate">
                                                                                {r.bank}{r.account ? ` • ${r.account}` : ""}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                    <span className="text-xs font-mono text-gray-500 ml-2 flex-shrink-0">{r.currency}</span>
                                                                </div>
                                                            ))
                                                        ) : (
                                                            <div className="py-3 px-3 text-xs text-gray-500 text-center">
                                                                No matching beneficiary found for "{recipientSearch.trim()}"
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                            <Button
                                                variant="outline"
                                                className="gap-2 h-11 whitespace-nowrap bg-white hover:bg-gray-50 text-gray-700 border-gray-200 shadow-xs rounded-xl"
                                                onClick={() => {
                                                    setSelectedRecipient(null);
                                                    setSelectedProvider(null);
                                                    setStep3Errors({});
                                                    setBeneficiaryApiError(null);
                                                    setBeneficiaryCreatedSuccess(null);
                                                    setRecipientDetails((prev) => ({
                                                        ...prev,
                                                        firstName: "",
                                                        lastName: "",
                                                        companyName: "",
                                                        relationship: "",
                                                        relationId: "",
                                                        nickName: "",
                                                        reason: "",
                                                        reasonId: "",
                                                        otherReason: "",
                                                        address: "",
                                                        city: "",
                                                        postcode: "",
                                                        stateOrProvince: "",
                                                        mobileNo: "",
                                                        bankName: "",
                                                        accountNumber: "",
                                                        sortCode: "",
                                                        iban: "",
                                                        swift: "",
                                                        aba: "",
                                                        ifsc: "",
                                                        bsbCode: "",
                                                        branchCode: "",
                                                    }));
                                                    handleNext();
                                                }}
                                            >
                                                <UserPlus className="w-4 h-4" />
                                                New Recipient
                                            </Button>
                                        </div>

                                        {/* All Recipients List */}
                                        <div className="space-y-1">
                                            {displayRecipients.length === 0 && (
                                                <div className="py-8 px-4 text-center rounded-xl border border-dashed border-gray-200 text-sm text-gray-500">
                                                    {recipientSearch.trim()
                                                        ? `No created beneficiaries match "${recipientSearch.trim()}".`
                                                        : "No saved beneficiaries found yet. Click 'New Recipient' to add one."}
                                                </div>
                                            )}
                                            {displayRecipients.map(r => (
                                                <div
                                                    key={r.id}
                                                    onClick={() => { setSelectedRecipient(r); handleNext(); }}
                                                    className="flex items-center justify-between p-4 hover:bg-gray-50 rounded-xl cursor-pointer transition-colors group"
                                                >
                                                    <div className="flex items-center gap-4">
                                                        <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm ${r.color} relative flex-shrink-0`}>
                                                            {r.initials}
                                                            <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="font-bold text-gray-900">{r.name}</div>
                                                            <div className="text-sm text-gray-500">{r.bank}</div>
                                                            {/* Banking detail chips */}
                                                            <div className="flex flex-wrap gap-1.5 mt-1">
                                                                {r.account && (
                                                                    <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-mono">
                                                                        Acct: {r.account.length > 16 ? `${r.account.slice(0, 4)}…${r.account.slice(-4)}` : r.account}
                                                                    </span>
                                                                )}
                                                                {r.sortCode && (
                                                                    <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-mono">
                                                                        Sort: {r.sortCode}
                                                                    </span>
                                                                )}
                                                                {r.iban && (
                                                                    <span className="inline-flex items-center gap-1 text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-mono">
                                                                        IBAN: {r.iban.slice(0, 12)}…
                                                                    </span>
                                                                )}
                                                                {r.swift && (
                                                                    <span className="inline-flex items-center gap-1 text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full font-mono">
                                                                        SWIFT: {r.swift}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {/* Narration */}
                                                            {(r.narration || r.currency === "NGN") && (
                                                                <div className="text-xs text-gray-400 italic mt-0.5 truncate max-w-[220px]">
                                                                    "{r.narration || (r.currency === "NGN" ? "Money transfer" : "")}"
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="text-right text-sm flex-shrink-0 ml-2">
                                                        <div className="text-blue-500 font-medium">Bank Deposit</div>
                                                        <div className="text-gray-400 font-mono">{r.currency}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        <Button className="w-full h-12 bg-[#2e5bff] hover:bg-blue-700 text-white font-semibold rounded-full shadow-none">
                                            Show More
                                        </Button>
                                    </div>
                                </div>

                                {/* Right Column: Sticky Summary */}
                                <div className="lg:col-span-2 hidden lg:block">
                                    <div className="sticky top-6">
                                        <Card className="rounded-xl border border-[#efefee] bg-white shadow-[-2px_4px_16px_0px_rgba(0,0,0,0.04)]">
                                            <CardHeader className="pb-4 bg-white border-b border-[#efefee]">
                                                <div className="flex justify-between items-center">
                                                    <CardTitle className="text-base font-semibold text-[#323130]">Amount Summary</CardTitle>
                                                    {/* Session Timer */}
                                                    <div className={`flex gap-1 font-mono text-sm px-2 py-1 rounded ${sessionTimeLeft <= 60 ? 'text-red-600 bg-red-50 animate-pulse' : 'text-blue-600 bg-blue-50'}`}>
                                                        <span>{timerDisplay.minutes}</span>:<span>{timerDisplay.seconds}</span>
                                                    </div>
                                                </div>
                                            </CardHeader>
                                            <CardContent className="space-y-3 text-sm pt-4">
                                                {promoApplied && promoDiscount > 0 && (
                                                    <div className="flex justify-between font-medium text-green-700">
                                                        <span>{PROMO_COPY.summaryLabel(promoCode)}</span>
                                                        <span className="whitespace-nowrap">−{formatPromoMoney(promoDiscount, SEND_CURRENCY).replace(/^−/, "")}</span>
                                                    </div>
                                                )}
                                                {useBonus && (
                                                    <div className="flex justify-between font-medium text-teal-700 bg-teal-50 px-2 py-1 -mx-2 rounded">
                                                        <span>{bonusType === "pay_less" ? BONUS_COPY.summaryPayLess : BONUS_COPY.summarySendMore}</span>
                                                        <span className="whitespace-nowrap">{bonusType === "pay_less" ? "-" : "+"} {sendSymbol}{bonusAmount.toFixed(2)}</span>
                                                    </div>
                                                )}
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">You Send</span>
                                                    <span className="font-medium text-gray-900 whitespace-nowrap">{sendSymbol}{youSendAmount.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Amount Sent</span>
                                                    <span className="font-medium text-gray-900 whitespace-nowrap">{sendSymbol}{amountSentGBP.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">They Receive</span>
                                                    <span className="font-medium text-gray-900 whitespace-nowrap">
                                                        {receiveSymbol}{finalReceiveAmount}
                                                        {useBonus && bonusType === "send_more" && (
                                                            <span className="text-xs text-green-600 ml-2 font-bold">(+Bonus)</span>
                                                        )}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Transaction Fee</span>
                                                    <span className="font-medium text-gray-900 whitespace-nowrap">{sendSymbol}{effectiveFee.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Exchange Rate</span>
                                                    <span className="font-medium text-gray-900 whitespace-nowrap">{sendSymbol}1 = {receiveSymbol}{EXCHANGE_RATE.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between pt-2">
                                                    <span className="text-gray-600">Connection Method</span>
                                                    <span className="font-medium text-right capitalize">{deliveryMethod.replace('_', ' ')}</span>
                                                </div>

                                                <div className="pt-4 mt-2 border-t">
                                                    <div className="flex justify-between items-center pt-2">
                                                        <span className="text-gray-900 font-bold text-base">Total to Pay</span>
                                                        <span className="font-bold text-lg text-gray-900 whitespace-nowrap">{sendSymbol}{Math.max(0, totalPay).toFixed(2)}</span>
                                                    </div>
                                                    {(promoApplied || useBonus) && (
                                                        <p className="text-xs text-green-600 font-medium mt-1">
                                                            Includes {promoApplied && "promo code"}{promoApplied && useBonus && " & "}{useBonus && (bonusType === 'pay_less' ? "Bonus Discount" : "Bonus Credit")}
                                                        </p>
                                                    )}
                                                </div>

                                                {selectedRecipient && (
                                                    <div className="pt-4 mt-3 border-t space-y-2.5">
                                                        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                                            Recipient Details
                                                        </div>
                                                        <div className="flex justify-between gap-2">
                                                            <span className="text-gray-600 shrink-0">Recipient Name</span>
                                                            <span className="font-medium text-gray-900 text-right truncate">
                                                                {selectedRecipient.name || "—"}
                                                            </span>
                                                        </div>
                                                        <div className="flex justify-between gap-2">
                                                            <span className="text-gray-600 shrink-0">
                                                                {deliveryMethod === "mobile_money" ? "Mobile Operator" : "Bank Name"}
                                                            </span>
                                                            <span className="font-medium text-gray-900 text-right truncate">
                                                                {selectedRecipient.bank || "—"}
                                                            </span>
                                                        </div>
                                                        <div className="flex justify-between gap-2">
                                                            <span className="text-gray-600 shrink-0">
                                                                {deliveryMethod === "mobile_money" ? "Mobile Number" : "Account Number"}
                                                            </span>
                                                            <span className="font-mono font-medium text-gray-900 text-right break-all">
                                                                {selectedRecipient.account || selectedRecipient.iban || selectedRecipient.mobileNo || "—"}
                                                            </span>
                                                        </div>
                                                    </div>
                                                )}
                                            </CardContent>
                                        </Card>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {/* Step 3: Details */}
                        {currentStep === 3 && (
                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="grid grid-cols-1 lg:grid-cols-5 gap-6 w-full"
                            >
                                {/* Left Column: Form Details */}
                                <div className="lg:col-span-3 space-y-5">
                                    {beneficiaryApiError && (
                                        <div
                                            role="alert"
                                            data-testid="step3-beneficiary-api-error"
                                            className="flex items-start gap-3 p-4 rounded-xl border border-red-200 bg-red-50 text-red-900 shadow-2xs"
                                        >
                                            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                                            <div className="flex-1 text-sm">
                                                <p className="font-semibold text-red-900">Unable to save beneficiary</p>
                                                <p className="text-red-700 mt-0.5">{beneficiaryApiError}</p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setBeneficiaryApiError(null)}
                                                className="text-red-400 hover:text-red-700 p-1"
                                                aria-label="Dismiss error"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    )}
                                    <Card>
                                        <CardHeader>
                                            <CardTitle className="text-base">Recipient Details</CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <AccountTypeToggle
                                                value={beneficiaryType}
                                                onChange={(type) => {
                                                    setBeneficiaryType(type);
                                                    setStep3Errors({});
                                                }}
                                            />

                                            {beneficiaryType === "business" ? (
                                                <div className="space-y-2">
                                                    <Label>
                                                        {beneficiaryRequirements.find((r) => r.name === "beneficiary_company_name")?.label || "Company Name"} <span className="text-red-500">*</span>
                                                    </Label>
                                                    <Input
                                                        placeholder="e.g. Acme Global Ltd"
                                                        value={recipientDetails.companyName}
                                                        className={step3Errors.companyName ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                        onChange={e => {
                                                            clearStep3Error("companyName");
                                                            setRecipientDetails({ ...recipientDetails, companyName: e.target.value });
                                                        }}
                                                    />
                                                    {step3Errors.companyName && <p className="text-xs text-red-500">{step3Errors.companyName}</p>}
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                                    <div className="space-y-2">
                                                        <Label>First Name <span className="text-red-500">*</span></Label>
                                                        <Input
                                                            placeholder="Recipient first name"
                                                            value={recipientDetails.firstName}
                                                            className={step3Errors.firstName ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                            onChange={e => {
                                                                clearStep3Error("firstName");
                                                                setRecipientDetails({ ...recipientDetails, firstName: e.target.value });
                                                            }}
                                                        />
                                                        {step3Errors.firstName && <p className="text-xs text-red-500">{step3Errors.firstName}</p>}
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label>Last Name <span className="text-red-500">*</span></Label>
                                                        <Input
                                                            placeholder="Recipient last name"
                                                            value={recipientDetails.lastName}
                                                            className={step3Errors.lastName ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                            onChange={e => {
                                                                clearStep3Error("lastName");
                                                                setRecipientDetails({ ...recipientDetails, lastName: e.target.value });
                                                            }}
                                                        />
                                                        {step3Errors.lastName && <p className="text-xs text-red-500">{step3Errors.lastName}</p>}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                                <div className="space-y-2">
                                                    <Label>Relationship <span className="text-red-500">*</span></Label>
                                                    <SearchableSelect
                                                        value={recipientDetails.relationship}
                                                        placeholder="Select or type relationship"
                                                        className={step3Errors.relationship ? "[&>div]:border-red-500" : ""}
                                                        options={
                                                            mitoLookupRelationships.length > 0
                                                                ? mitoLookupRelationships.map((rel) => ({ value: rel.code, label: rel.name }))
                                                                : [
                                                                      { value: "family", label: "Family" },
                                                                      { value: "friend", label: "Friend" },
                                                                      { value: "business", label: "Business Service" },
                                                                  ]
                                                        }
                                                        onValueChange={(val) => {
                                                            clearStep3Error("relationship");
                                                            const relOpts = beneficiaryRequirements.find((r) => r.name === "beneficiaryRelationId")?.dropdownOptions || [];
                                                            const matchedLookup = mitoLookupRelationships.find((r) => r.code === val || r.name.toLowerCase() === val.toLowerCase());
                                                            const matchedReq = relOpts.find(
                                                                (o) =>
                                                                    o.id === val ||
                                                                    o.name.toLowerCase() === val.toLowerCase() ||
                                                                    (matchedLookup && o.name.toLowerCase() === matchedLookup.name.toLowerCase()),
                                                            );
                                                            setRecipientDetails(prev => ({
                                                                ...prev,
                                                                relationship: val,
                                                                relationId: matchedReq ? matchedReq.id : prev.relationId,
                                                            }));
                                                            if (selectedRecipient) {
                                                                saveBeneficiaryTxnMeta(
                                                                    {
                                                                        beneficiaryId: selectedRecipient.beneficiaryId || selectedRecipient.id,
                                                                        name: selectedRecipient.name,
                                                                        account: selectedRecipient.account,
                                                                    },
                                                                    {
                                                                        relationship: val,
                                                                        relationId: matchedReq ? matchedReq.id : recipientDetails.relationId,
                                                                    },
                                                                );
                                                            }
                                                        }}
                                                    />
                                                    {step3Errors.relationship && <p className="text-xs text-red-500">{step3Errors.relationship}</p>}
                                                </div>

                                                <div className="space-y-2">
                                                    <Label>Reason for transfer <span className="text-destructive">*</span></Label>
                                                    <SearchableSelect
                                                        value={recipientDetails.reason}
                                                        placeholder="Select or type reason for transfer"
                                                        className={step3Errors.reason ? "[&>div]:border-red-500" : ""}
                                                        options={
                                                            mitoLookupReasons.length > 0
                                                                ? mitoLookupReasons.map((rsn) => ({ value: rsn.code, label: rsn.name }))
                                                                : [
                                                                      { value: "family_support", label: "Family Support" },
                                                                      { value: "education", label: "Education" },
                                                                      { value: "bills", label: "Bills" },
                                                                      { value: "medical", label: "Medical Expenses" },
                                                                      { value: "other", label: "Other" },
                                                                  ]
                                                        }
                                                        onValueChange={(val) => {
                                                            clearStep3Error("reason");
                                                            const rsnOpts = beneficiaryRequirements.find((r) => r.name === "beneficiaryReasonId")?.dropdownOptions || [];
                                                            const matchedLookup = mitoLookupReasons.find((r) => r.code === val || r.name.toLowerCase() === val.toLowerCase());
                                                            const matchedReq = rsnOpts.find(
                                                                (o) =>
                                                                    o.id === val ||
                                                                    o.name.toLowerCase() === val.toLowerCase() ||
                                                                    (matchedLookup && o.name.toLowerCase() === matchedLookup.name.toLowerCase()),
                                                            );
                                                            setRecipientDetails(prev => ({
                                                                ...prev,
                                                                reason: val,
                                                                reasonId: matchedReq ? matchedReq.id : prev.reasonId,
                                                            }));
                                                            if (selectedRecipient) {
                                                                saveBeneficiaryTxnMeta(
                                                                    {
                                                                        beneficiaryId: selectedRecipient.beneficiaryId || selectedRecipient.id,
                                                                        name: selectedRecipient.name,
                                                                        account: selectedRecipient.account,
                                                                    },
                                                                    {
                                                                        reason: val,
                                                                        reasonId: matchedReq ? matchedReq.id : recipientDetails.reasonId,
                                                                    },
                                                                );
                                                            }
                                                        }}
                                                    />
                                                    {step3Errors.reason && <p className="text-xs text-red-500">{step3Errors.reason}</p>}
                                                </div>
                                            </div>

                                            {(recipientDetails.reason === "other" || recipientDetails.reason === "OTHERS") && (
                                                <div className="space-y-2">
                                                    <Label>Please specify reason <span className="text-destructive">*</span></Label>
                                                    <Input
                                                        placeholder="e.g. Consulting, Event sponsorship, etc."
                                                        value={recipientDetails.otherReason}
                                                        className={step3Errors.otherReason ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                        onChange={e => {
                                                            clearStep3Error("otherReason");
                                                            setRecipientDetails(prev => ({ ...prev, otherReason: e.target.value }));
                                                        }}
                                                        required
                                                    />
                                                    {step3Errors.otherReason && <p className="text-xs text-red-500">{step3Errors.otherReason}</p>}
                                                </div>
                                            )}

                                            {/* Country-specific required beneficiary address / contact fields from GET /api/v1/mito/Beneficiaries/requirements */}
                                            {beneficiaryRequirements.some((r) => r.isDisplayable && ["beneficiary_address", "beneficiary_city", "beneficiary_postcode", "beneficiary_state_or_province", "beneficiary_MobileNo"].includes(r.name)) && (
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 pt-1">
                                                    {beneficiaryRequirements.some((r) => r.isDisplayable && r.name === "beneficiary_address") && (
                                                        <div className="space-y-2 sm:col-span-2">
                                                            <Label>
                                                                {beneficiaryRequirements.find((r) => r.name === "beneficiary_address")?.label || "Address"}
                                                                {beneficiaryRequirements.find((r) => r.name === "beneficiary_address")?.isRequired && <span className="text-red-500 ml-1">*</span>}
                                                            </Label>
                                                            <Input
                                                                placeholder="Street address"
                                                                value={recipientDetails.address}
                                                                className={step3Errors.address ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                                onChange={e => {
                                                                    clearStep3Error("address");
                                                                    setRecipientDetails({ ...recipientDetails, address: e.target.value });
                                                                }}
                                                            />
                                                            {step3Errors.address && <p className="text-xs text-red-500">{step3Errors.address}</p>}
                                                        </div>
                                                    )}
                                                    {beneficiaryRequirements.some((r) => r.isDisplayable && r.name === "beneficiary_city") && (
                                                        <div className="space-y-2">
                                                            <Label>
                                                                {beneficiaryRequirements.find((r) => r.name === "beneficiary_city")?.label || "City"}
                                                                {beneficiaryRequirements.find((r) => r.name === "beneficiary_city")?.isRequired && <span className="text-red-500 ml-1">*</span>}
                                                            </Label>
                                                            <Input
                                                                placeholder="City"
                                                                value={recipientDetails.city}
                                                                className={step3Errors.city ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                                onChange={e => {
                                                                    clearStep3Error("city");
                                                                    setRecipientDetails({ ...recipientDetails, city: e.target.value });
                                                                }}
                                                            />
                                                            {step3Errors.city && <p className="text-xs text-red-500">{step3Errors.city}</p>}
                                                        </div>
                                                    )}
                                                    {beneficiaryRequirements.some((r) => r.isDisplayable && r.name === "beneficiary_state_or_province") && (
                                                        <div className="space-y-2">
                                                            <Label>
                                                                {beneficiaryRequirements.find((r) => r.name === "beneficiary_state_or_province")?.label || "State / Province"}
                                                                {beneficiaryRequirements.find((r) => r.name === "beneficiary_state_or_province")?.isRequired && <span className="text-red-500 ml-1">*</span>}
                                                            </Label>
                                                            {(beneficiaryRequirements.find((r) => r.name === "beneficiary_state_or_province")?.dropdownOptions?.length ?? 0) > 0 ? (
                                                                <SearchableSelect
                                                                    value={recipientDetails.stateOrProvince}
                                                                    placeholder="Select or type state"
                                                                    className={step3Errors.stateOrProvince ? "[&>div]:border-red-500" : ""}
                                                                    options={(beneficiaryRequirements.find((r) => r.name === "beneficiary_state_or_province")?.dropdownOptions || []).map((opt) => ({
                                                                        value: opt.id,
                                                                        label: opt.name,
                                                                    }))}
                                                                    onValueChange={(val) => {
                                                                        clearStep3Error("stateOrProvince");
                                                                        setRecipientDetails({ ...recipientDetails, stateOrProvince: val });
                                                                    }}
                                                                />
                                                            ) : (
                                                                <Input
                                                                    placeholder="State / Province"
                                                                    value={recipientDetails.stateOrProvince}
                                                                    className={step3Errors.stateOrProvince ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                                    onChange={e => {
                                                                        clearStep3Error("stateOrProvince");
                                                                        setRecipientDetails({ ...recipientDetails, stateOrProvince: e.target.value });
                                                                    }}
                                                                />
                                                            )}
                                                            {step3Errors.stateOrProvince && <p className="text-xs text-red-500">{step3Errors.stateOrProvince}</p>}
                                                        </div>
                                                    )}
                                                    {beneficiaryRequirements.some((r) => r.isDisplayable && r.name === "beneficiary_postcode") && (
                                                        <div className="space-y-2">
                                                            <Label>
                                                                {beneficiaryRequirements.find((r) => r.name === "beneficiary_postcode")?.label || "Postcode"}
                                                                {beneficiaryRequirements.find((r) => r.name === "beneficiary_postcode")?.isRequired && <span className="text-red-500 ml-1">*</span>}
                                                            </Label>
                                                            <Input
                                                                placeholder="Postcode / ZIP"
                                                                value={recipientDetails.postcode}
                                                                className={step3Errors.postcode ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                                onChange={e => {
                                                                    clearStep3Error("postcode");
                                                                    setRecipientDetails({ ...recipientDetails, postcode: e.target.value });
                                                                }}
                                                            />
                                                            {step3Errors.postcode && <p className="text-xs text-red-500">{step3Errors.postcode}</p>}
                                                        </div>
                                                    )}
                                                    {deliveryMethod !== "mobile_money" && beneficiaryRequirements.some((r) => r.isDisplayable && r.name === "beneficiary_MobileNo") && (
                                                        <div className="space-y-2">
                                                            <Label>
                                                                {beneficiaryRequirements.find((r) => r.name === "beneficiary_MobileNo")?.label || "Mobile Number"}
                                                                {beneficiaryRequirements.find((r) => r.name === "beneficiary_MobileNo")?.isRequired && <span className="text-red-500 ml-1">*</span>}
                                                            </Label>
                                                            <Input
                                                                placeholder="e.g. +447911123456"
                                                                value={recipientDetails.mobileNo}
                                                                className={step3Errors.mobileNo ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                                onChange={e => {
                                                                    clearStep3Error("mobileNo");
                                                                    setRecipientDetails({ ...recipientDetails, mobileNo: e.target.value.replace(/\s+/g, "") });
                                                                }}
                                                            />
                                                            {step3Errors.mobileNo && <p className="text-xs text-red-500">{step3Errors.mobileNo}</p>}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            <div className="space-y-2">
                                                <Label>Narration
                                                    {recipientDetails.currency === "NGN"
                                                        ? <span className="text-red-500 ml-1">*</span>
                                                        : <span className="text-muted-foreground font-normal"> (Optional)</span>
                                                    }
                                                </Label>
                                                <Textarea
                                                    placeholder="e.g. Monthly allowance for February"
                                                    value={recipientDetails.narration}
                                                    onChange={e => {
                                                        clearStep3Error("narration");
                                                        const nextNarration = e.target.value;
                                                        setRecipientDetails({ ...recipientDetails, narration: nextNarration });
                                                        if (selectedRecipient) {
                                                            saveBeneficiaryTxnMeta(
                                                                {
                                                                    beneficiaryId: selectedRecipient.beneficiaryId || selectedRecipient.id,
                                                                    name: selectedRecipient.name,
                                                                    account: selectedRecipient.account,
                                                                },
                                                                {
                                                                    narration: nextNarration,
                                                                },
                                                            );
                                                        }
                                                    }}
                                                    className={`resize-none ${step3Errors.narration ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                                                    rows={3}
                                                />
                                                {step3Errors.narration ? (
                                                    <p className="text-xs text-red-500">{step3Errors.narration}</p>
                                                ) : (
                                                    recipientDetails.currency === "NGN" && (
                                                        <p className="text-xs text-amber-600">Narration is required for Nigerian accounts.</p>
                                                    )
                                                )}
                                            </div>

                                            <div className="space-y-2">
                                                <Label>Nickname (Optional)</Label>
                                                <Input
                                                    placeholder="e.g. My Brother"
                                                    value={recipientDetails.nickName}
                                                    onChange={e => setRecipientDetails({ ...recipientDetails, nickName: e.target.value })}
                                                />
                                            </div>
                                        </CardContent>
                                    </Card>

                                    {/* Banking Details / Mobile Operator Details Card — conditional by deliveryMethod & destination */}
                                    <Card>
                                        <CardHeader>
                                            <CardTitle className="text-base">
                                                {deliveryMethod === "mobile_money" ? "Mobile Operator Details" : "Banking Details"}
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            {deliveryMethod === "mobile_money" ? (
                                                <>
                                                    <div className="space-y-2">
                                                        <Label>Mobile Operator <span className="text-red-500">*</span></Label>
                                                        {mitoProviders.length > 0 ? (
                                                            <SearchableSelect
                                                                autoPopulate
                                                                data-testid="mobile-operator-select"
                                                                value={selectedProvider?.providerId || ""}
                                                                placeholder="Select a mobile operator or start typing"
                                                                className={step3Errors.bankName ? "[&>div]:border-red-500" : ""}
                                                                options={(
                                                                    mitoProviders.some((prov) => !prov.isGeneric)
                                                                        ? mitoProviders.filter((prov) => !prov.isGeneric)
                                                                        : mitoProviders
                                                                ).map((prov) => ({
                                                                    value: prov.providerId,
                                                                    label: prov.providerName,
                                                                }))}
                                                                onValueChange={(val) => {
                                                                    if (!val) {
                                                                        setSelectedProvider(null);
                                                                        setRecipientDetails((prev) => ({ ...prev, bankName: "" }));
                                                                        return;
                                                                    }
                                                                    const found = mitoProviders.find((p) => p.providerId === val);
                                                                    if (found) {
                                                                        clearStep3Error("bankName");
                                                                        setSelectedProvider({ providerId: found.providerId, providerCode: found.providerCode });
                                                                        setRecipientDetails((prev) => ({ ...prev, bankName: found.providerName }));
                                                                    }
                                                                }}
                                                            />
                                                        ) : (
                                                            <Input
                                                                data-testid="mobile-operator-input"
                                                                placeholder="Select or enter a mobile operator (e.g. MTN, M-Pesa, Airtel)"
                                                                value={recipientDetails.bankName}
                                                                className={step3Errors.bankName ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                                onChange={e => {
                                                                    const val = e.target.value;
                                                                    if (val.trim()) clearStep3Error("bankName");
                                                                    setRecipientDetails({ ...recipientDetails, bankName: val });
                                                                }}
                                                            />
                                                        )}
                                                        {step3Errors.bankName ? (
                                                            <p className="text-xs text-red-500">{step3Errors.bankName}</p>
                                                        ) : (
                                                            mitoProviders.length > 0 && !selectedProvider?.providerId && (
                                                                <p className="text-xs text-muted-foreground">
                                                                    Please select a mobile operator or start typing to filter.
                                                                </p>
                                                            )
                                                        )}
                                                    </div>

                                                    <div className="space-y-2">
                                                        <Label>
                                                            {beneficiaryRequirements.find((r) => r.name === "beneficiary_MobileNo")?.label === "MobileNumber"
                                                                ? "Mobile Number"
                                                                : beneficiaryRequirements.find((r) => r.name === "beneficiary_MobileNo")?.label || "Mobile Number"}
                                                            {" "}
                                                            <span className="text-red-500">*</span>
                                                        </Label>
                                                        <Input
                                                            data-testid="mobile-money-number-input"
                                                            placeholder="e.g. +2348012345678 or 08012345678"
                                                            value={recipientDetails.mobileNo || recipientDetails.accountNumber}
                                                            className={(step3Errors.mobileNo || step3Errors.accountNumber) ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                            onChange={e => {
                                                                const cleaned = e.target.value.replace(/\s+/g, "");
                                                                clearStep3Error("mobileNo");
                                                                clearStep3Error("accountNumber");
                                                                setRecipientDetails({
                                                                    ...recipientDetails,
                                                                    mobileNo: cleaned,
                                                                    accountNumber: cleaned,
                                                                });
                                                            }}
                                                        />
                                                        {(step3Errors.mobileNo || step3Errors.accountNumber) && (
                                                            <p className="text-xs text-red-500">{step3Errors.mobileNo || step3Errors.accountNumber}</p>
                                                        )}
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="space-y-2">
                                                        <Label>Bank Name <span className="text-red-500">*</span></Label>
                                                        {mitoProviders.some((p) => !p.isGeneric) ? (
                                                            <SearchableSelect
                                                                autoPopulate
                                                                data-testid="bank-name-select"
                                                                value={selectedProvider?.providerId || ""}
                                                                placeholder="Select a bank or start typing (e.g. Access Bank, UBA)"
                                                                className={step3Errors.bankName ? "[&>div]:border-red-500" : ""}
                                                                options={mitoProviders
                                                                    .filter((prov) => !prov.isGeneric)
                                                                    .map((prov) => ({
                                                                        value: prov.providerId,
                                                                        label: prov.providerName,
                                                                    }))}
                                                                onValueChange={(val) => {
                                                                    if (!val) {
                                                                        setSelectedProvider(null);
                                                                        setRecipientDetails((prev) => ({ ...prev, bankName: "" }));
                                                                        return;
                                                                    }
                                                                    const found = mitoProviders.find((p) => p.providerId === val);
                                                                    if (found) {
                                                                        clearStep3Error("bankName");
                                                                        setSelectedProvider({ providerId: found.providerId, providerCode: found.providerCode });
                                                                        setRecipientDetails((prev) => ({ ...prev, bankName: found.providerName }));
                                                                    }
                                                                }}
                                                            />
                                                        ) : (
                                                            <Input
                                                                data-testid="bank-name-input"
                                                                placeholder="Select or enter a bank (e.g. Barclays, Access Bank)"
                                                                value={recipientDetails.bankName}
                                                                className={step3Errors.bankName ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                                onChange={e => {
                                                                    const val = e.target.value;
                                                                    if (val.trim()) clearStep3Error("bankName");
                                                                    if (mitoProviders.length === 1 && mitoProviders[0].isGeneric) {
                                                                        setSelectedProvider({
                                                                            providerId: mitoProviders[0].providerId,
                                                                            providerCode: mitoProviders[0].providerCode,
                                                                        });
                                                                    }
                                                                    setRecipientDetails({ ...recipientDetails, bankName: val });
                                                                }}
                                                            />
                                                        )}
                                                        {step3Errors.bankName ? (
                                                            <p className="text-xs text-red-500">{step3Errors.bankName}</p>
                                                        ) : (
                                                            mitoProviders.some((p) => !p.isGeneric) && !selectedProvider?.providerId && (
                                                                <p className="text-xs text-muted-foreground">
                                                                    Please select a bank or start typing to auto-populate the bank name.
                                                                </p>
                                                            )
                                                        )}
                                                    </div>

                                                    {/* Nigeria (NGN): account number only */}
                                                    {recipientDetails.currency === "NGN" && (
                                                        <div className="space-y-2">
                                                            <Label>Account Number <span className="text-red-500">*</span></Label>
                                                            <Input
                                                                placeholder="10-digit account number"
                                                                value={recipientDetails.accountNumber}
                                                                className={step3Errors.accountNumber ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                                onChange={e => {
                                                                    clearStep3Error("accountNumber");
                                                                    const cleaned = e.target.value.replace(/\s+/g, "").slice(0, 10);
                                                                    setRecipientDetails({ ...recipientDetails, accountNumber: cleaned });
                                                                }}
                                                            />
                                                            {step3Errors.accountNumber && <p className="text-xs text-red-500">{step3Errors.accountNumber}</p>}
                                                        </div>
                                                    )}

                                                    {/* UK (GBP): account number + sort code */}
                                                    {recipientDetails.currency === "GBP" && (
                                                        <>
                                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                                                <div className="space-y-2">
                                                                    <Label>Account Number <span className="text-red-500">*</span></Label>
                                                                    <Input
                                                                        placeholder="8-digit number"
                                                                        value={recipientDetails.accountNumber}
                                                                        className={step3Errors.accountNumber ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                                        onChange={e => {
                                                                            clearStep3Error("accountNumber");
                                                                            const cleaned = e.target.value.replace(/\s+/g, "").slice(0, 8);
                                                                            setRecipientDetails({ ...recipientDetails, accountNumber: cleaned });
                                                                        }}
                                                                    />
                                                                    {step3Errors.accountNumber && <p className="text-xs text-red-500">{step3Errors.accountNumber}</p>}
                                                                </div>
                                                                <div className="space-y-2">
                                                                    <Label>Sort Code <span className="text-red-500">*</span></Label>
                                                                    <Input
                                                                        placeholder="e.g. 20-45-67"
                                                                        value={recipientDetails.sortCode}
                                                                        className={step3Errors.sortCode ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                                        onChange={e => {
                                                                            clearStep3Error("sortCode");
                                                                            setRecipientDetails({ ...recipientDetails, sortCode: e.target.value.replace(/\s+/g, "") });
                                                                        }}
                                                                        maxLength={8}
                                                                    />
                                                                    {step3Errors.sortCode && <p className="text-xs text-red-500">{step3Errors.sortCode}</p>}
                                                                </div>
                                                            </div>
                                                        </>
                                                    )}

                                                    {/* International (EUR / USD / other): IBAN + SWIFT */}
                                                    {recipientDetails.currency !== "NGN" && recipientDetails.currency !== "GBP" && (
                                                        <>
                                                            <div className="space-y-2">
                                                                <Label>IBAN / Account Number <span className="text-red-500">*</span></Label>
                                                                <Input
                                                                    placeholder="e.g. DE89 3704 0044 0532 0130 00"
                                                                    value={recipientDetails.iban || recipientDetails.accountNumber}
                                                                    className={step3Errors.iban ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                                    onChange={e => {
                                                                        const cleaned = e.target.value.replace(/\s+/g, "");
                                                                        clearStep3Error("iban");
                                                                        setRecipientDetails({ ...recipientDetails, iban: cleaned, accountNumber: cleaned });
                                                                    }}
                                                                />
                                                                {step3Errors.iban && <p className="text-xs text-red-500">{step3Errors.iban}</p>}
                                                            </div>
                                                            <div className="space-y-2">
                                                                <Label>SWIFT / BIC <span className="text-red-500">*</span></Label>
                                                                <Input
                                                                    placeholder="e.g. DEUTDEFF"
                                                                    value={recipientDetails.swift}
                                                                    className={step3Errors.swift ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                                    onChange={e => {
                                                                        clearStep3Error("swift");
                                                                        setRecipientDetails({ ...recipientDetails, swift: e.target.value.replace(/\s+/g, "").slice(0, 11) });
                                                                    }}
                                                                />
                                                                {step3Errors.swift && <p className="text-xs text-red-500">{step3Errors.swift}</p>}
                                                            </div>
                                                        </>
                                                    )}

                                                    {/* Country-specific bank routing fields returned by GET /api/v1/mito/Beneficiaries/requirements */}
                                                    {beneficiaryRequirements.some((r) => r.isDisplayable && r.name === "aba") && (
                                                        <div className="space-y-2">
                                                            <Label>
                                                                {beneficiaryRequirements.find((r) => r.name === "aba")?.label || "ABA Routing Number"}
                                                                {beneficiaryRequirements.find((r) => r.name === "aba")?.isRequired && <span className="text-red-500 ml-1">*</span>}
                                                            </Label>
                                                            <Input
                                                                placeholder="9-digit ABA routing number"
                                                                value={recipientDetails.aba}
                                                                className={step3Errors.aba ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                                onChange={e => {
                                                                    clearStep3Error("aba");
                                                                    setRecipientDetails({ ...recipientDetails, aba: e.target.value.replace(/\s+/g, "").slice(0, 9) });
                                                                }}
                                                            />
                                                            {step3Errors.aba && <p className="text-xs text-red-500">{step3Errors.aba}</p>}
                                                        </div>
                                                    )}
                                                    {beneficiaryRequirements.some((r) => r.isDisplayable && r.name === "ifsc") && (
                                                        <div className="space-y-2">
                                                            <Label>
                                                                {beneficiaryRequirements.find((r) => r.name === "ifsc")?.label || "IFSC Code"}
                                                                {beneficiaryRequirements.find((r) => r.name === "ifsc")?.isRequired && <span className="text-red-500 ml-1">*</span>}
                                                            </Label>
                                                            <Input
                                                                placeholder="11-character IFSC code"
                                                                value={recipientDetails.ifsc}
                                                                className={step3Errors.ifsc ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                                onChange={e => {
                                                                    clearStep3Error("ifsc");
                                                                    setRecipientDetails({ ...recipientDetails, ifsc: e.target.value.replace(/\s+/g, "").slice(0, 11) });
                                                                }}
                                                            />
                                                            {step3Errors.ifsc && <p className="text-xs text-red-500">{step3Errors.ifsc}</p>}
                                                        </div>
                                                    )}
                                                    {beneficiaryRequirements.some((r) => r.isDisplayable && r.name === "bsb_code") && (
                                                        <div className="space-y-2">
                                                            <Label>
                                                                {beneficiaryRequirements.find((r) => r.name === "bsb_code")?.label || "BSB Code"}
                                                                {beneficiaryRequirements.find((r) => r.name === "bsb_code")?.isRequired && <span className="text-red-500 ml-1">*</span>}
                                                            </Label>
                                                            <Input
                                                                placeholder="BSB code"
                                                                value={recipientDetails.bsbCode}
                                                                className={step3Errors.bsbCode ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                                onChange={e => {
                                                                    clearStep3Error("bsbCode");
                                                                    setRecipientDetails({ ...recipientDetails, bsbCode: e.target.value.replace(/\s+/g, "") });
                                                                }}
                                                            />
                                                            {step3Errors.bsbCode && <p className="text-xs text-red-500">{step3Errors.bsbCode}</p>}
                                                        </div>
                                                    )}
                                                    {beneficiaryRequirements.some((r) => r.isDisplayable && r.name === "branch_code") && (
                                                        <div className="space-y-2">
                                                            <Label>
                                                                {beneficiaryRequirements.find((r) => r.name === "branch_code")?.label || "Branch Code"}
                                                                {beneficiaryRequirements.find((r) => r.name === "branch_code")?.isRequired && <span className="text-red-500 ml-1">*</span>}
                                                            </Label>
                                                            <Input
                                                                placeholder="Branch code"
                                                                value={recipientDetails.branchCode}
                                                                className={step3Errors.branchCode ? "border-red-500 focus-visible:ring-red-500" : ""}
                                                                onChange={e => {
                                                                    clearStep3Error("branchCode");
                                                                    setRecipientDetails({ ...recipientDetails, branchCode: e.target.value.replace(/\s+/g, "") });
                                                                }}
                                                            />
                                                            {step3Errors.branchCode && <p className="text-xs text-red-500">{step3Errors.branchCode}</p>}
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </CardContent>
                                    </Card>

                                    <div className="pt-4 flex gap-3">
                                        <Button
                                            variant="outline"
                                            onClick={handleBack}
                                            className="flex-1 h-12 text-base rounded-full border-[#d2d0ce] text-[#323130]"
                                            disabled={submittingTransaction}
                                        >
                                            Back
                                        </Button>
                                        <Button
                                            onClick={handleSubmitTransaction}
                                            disabled={submittingTransaction}
                                            className="flex-1 h-12 text-base bg-[#2e5bff] hover:bg-blue-700 text-white font-semibold rounded-full shadow-none"
                                        >
                                            {submittingTransaction ? (
                                                <div className="flex items-center gap-2">
                                                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                    <span>Processing...</span>
                                                </div>
                                            ) : "Continue"}
                                        </Button>
                                    </div>
                                </div>

                                {/* Right Column: Sticky Summary */}
                                <div className="lg:col-span-2">
                                    <div className="sticky top-6">
                                        <Card className="rounded-xl border border-[#efefee] bg-white shadow-[-2px_4px_16px_0px_rgba(0,0,0,0.04)]">
                                            <CardHeader className="pb-4 bg-white border-b border-[#efefee]">
                                                <div className="flex justify-between items-center">
                                                    <CardTitle className="text-base font-semibold text-[#323130]">Amount Summary</CardTitle>
                                                    {/* Session Timer */}
                                                    <div className={`flex gap-1 font-mono text-sm px-2 py-1 rounded ${sessionTimeLeft <= 60 ? 'text-red-600 bg-red-50 animate-pulse' : 'text-blue-600 bg-blue-50'}`}>
                                                        <span>{timerDisplay.minutes}</span>:<span>{timerDisplay.seconds}</span>
                                                    </div>
                                                </div>
                                            </CardHeader>
                                            <CardContent className="space-y-3 text-sm pt-4">
                                                {promoApplied && promoDiscount > 0 && (
                                                    <div className="flex justify-between font-medium text-green-700">
                                                        <span>{PROMO_COPY.summaryLabel(promoCode)}</span>
                                                        <span className="whitespace-nowrap">−{formatPromoMoney(promoDiscount, SEND_CURRENCY).replace(/^−/, "")}</span>
                                                    </div>
                                                )}
                                                {useBonus && (
                                                    <div className="flex justify-between font-medium text-teal-700 bg-teal-50 px-2 py-1 -mx-2 rounded">
                                                        <span>{bonusType === "pay_less" ? BONUS_COPY.summaryPayLess : BONUS_COPY.summarySendMore}</span>
                                                        <span className="whitespace-nowrap">{bonusType === "pay_less" ? "-" : "+"} {sendSymbol}{bonusAmount.toFixed(2)}</span>
                                                    </div>
                                                )}
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">You Send</span>
                                                    <span className="font-medium text-gray-900 whitespace-nowrap">{sendSymbol}{youSendAmount.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Amount Sent</span>
                                                    <span className="font-medium text-gray-900 whitespace-nowrap">{sendSymbol}{amountSentGBP.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">They Receive</span>
                                                    <span className="font-medium text-gray-900 whitespace-nowrap">
                                                        {receiveSymbol}{finalReceiveAmount}
                                                        {useBonus && bonusType === "send_more" && (
                                                            <span className="text-xs text-green-600 ml-2 font-bold">(+Bonus)</span>
                                                        )}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Transaction Fee</span>
                                                    <span className="font-medium text-gray-900 whitespace-nowrap">{sendSymbol}{effectiveFee.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Exchange Rate</span>
                                                    <span className="font-medium text-gray-900 whitespace-nowrap">{sendSymbol}1 = {receiveSymbol}{EXCHANGE_RATE.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between pt-2">
                                                    <span className="text-gray-600">Connection Method</span>
                                                    <span className="font-medium text-right capitalize">{deliveryMethod.replace('_', ' ')}</span>
                                                </div>

                                                <div className="pt-4 mt-2 border-t">
                                                    <div className="flex justify-between items-center pt-2">
                                                        <span className="text-gray-900 font-bold text-base">Total to Pay</span>
                                                        <span className="font-bold text-lg text-gray-900 whitespace-nowrap">{sendSymbol}{Math.max(0, totalPay).toFixed(2)}</span>
                                                    </div>
                                                    {(promoApplied || useBonus) && (
                                                        <p className="text-xs text-green-600 font-medium mt-1">
                                                            Includes {promoApplied && "promo code"}{promoApplied && useBonus && " & "}{useBonus && (bonusType === 'pay_less' ? "Bonus Discount" : "Bonus Credit")}
                                                        </p>
                                                    )}
                                                </div>

                                                {/* Recipient / Beneficiary Details Section under Amount Summary */}
                                                <div className="pt-4 mt-3 border-t space-y-2.5" data-testid="step3-summary-recipient-details">
                                                    <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                                        Recipient Details
                                                    </div>
                                                    <div className="flex justify-between gap-2">
                                                        <span className="text-gray-600 shrink-0">Recipient Name</span>
                                                        <span className="font-medium text-gray-900 text-right truncate">
                                                            {beneficiaryType === "business"
                                                                ? (recipientDetails.companyName.trim() || selectedRecipient?.name || "—")
                                                                : ([recipientDetails.firstName.trim(), recipientDetails.lastName.trim()].filter(Boolean).join(" ") || selectedRecipient?.name || "—")}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between gap-2">
                                                        <span className="text-gray-600 shrink-0">
                                                            {deliveryMethod === "mobile_money" ? "Mobile Operator" : "Bank Name"}
                                                        </span>
                                                        <span className="font-medium text-gray-900 text-right truncate">
                                                            {recipientDetails.bankName.trim() || selectedRecipient?.bank || "—"}
                                                        </span>
                                                    </div>
                                                    {deliveryMethod === "mobile_money" ? (
                                                        <div className="flex justify-between gap-2">
                                                            <span className="text-gray-600 shrink-0">Mobile Number</span>
                                                            <span className="font-mono font-medium text-gray-900 text-right">
                                                                {recipientDetails.mobileNo.trim() || recipientDetails.accountNumber.trim() || selectedRecipient?.mobileNo || selectedRecipient?.account || "—"}
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <div className="flex justify-between gap-2">
                                                                <span className="text-gray-600 shrink-0">
                                                                    {recipientDetails.iban.trim() && !recipientDetails.accountNumber.trim() ? "IBAN" : "Account Number"}
                                                                </span>
                                                                <span className="font-mono font-medium text-gray-900 text-right break-all">
                                                                    {recipientDetails.accountNumber.trim() || recipientDetails.iban.trim() || selectedRecipient?.account || selectedRecipient?.iban || "—"}
                                                                </span>
                                                            </div>
                                                            {(recipientDetails.sortCode.trim() || selectedRecipient?.sortCode) && (
                                                                <div className="flex justify-between gap-2">
                                                                    <span className="text-gray-600 shrink-0">Sort Code</span>
                                                                    <span className="font-mono font-medium text-gray-900 text-right">
                                                                        {recipientDetails.sortCode.trim() || selectedRecipient?.sortCode}
                                                                    </span>
                                                                </div>
                                                            )}
                                                            {(recipientDetails.swift.trim() || selectedRecipient?.swift) && (
                                                                <div className="flex justify-between gap-2">
                                                                    <span className="text-gray-600 shrink-0">SWIFT / BIC</span>
                                                                    <span className="font-mono font-medium text-gray-900 text-right">
                                                                        {recipientDetails.swift.trim() || selectedRecipient?.swift}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {/* Step 4: Payment Method */}
                        {currentStep === 4 && !showBankTransferPage && (
                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="grid grid-cols-1 lg:grid-cols-5 gap-6 pb-24"
                            >
                                {/* Left Column: Input Sections (or Full-Width World-Class Status View when paymentOutcome is active) */}
                                <div className={paymentOutcome ? "lg:col-span-5 max-w-4xl mx-auto w-full space-y-6" : "lg:col-span-3 space-y-6"}>

                                    {/* Promo & Bonus are selected on Step 1 and summarized in the right-hand Amount Summary */}


                                    {/* Promo Code Section (features/promo) */}


                                    {beneficiaryCreatedSuccess && !paymentOutcome && (
                                        <div
                                            role="status"
                                            data-testid="step4-beneficiary-created-banner"
                                            className="flex items-start gap-3 p-4 rounded-xl border border-green-200 bg-green-50 text-green-900 shadow-2xs"
                                        >
                                            <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                                            <div className="flex-1 text-sm">
                                                <p className="font-semibold text-green-900">Beneficiary created successfully</p>
                                                <p className="text-green-700 mt-0.5">{beneficiaryCreatedSuccess}</p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setBeneficiaryCreatedSuccess(null)}
                                                className="text-green-500 hover:text-green-800 p-1"
                                                aria-label="Dismiss notification"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    )}

                                    {/* Payment Outcome Full-Page Status View OR Payment Method Selection */}
                                    {paymentOutcome ? (
                                        <motion.div
                                            initial={{ opacity: 0, y: 12 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.35, ease: "easeOut" }}
                                            data-testid="payment-status-view"
                                            data-status-category={paymentOutcome.category}
                                            className="space-y-6"
                                        >
                                            {/* Executive Fintech Status Hero & Receipt Card */}
                                            <div className="rounded-3xl border border-slate-200/90 bg-white shadow-xl shadow-slate-900/5 overflow-hidden">
                                                {/* Top Gradient Hero Banner */}
                                                <div
                                                    className={`relative px-6 sm:px-10 pt-8 pb-7 text-white overflow-hidden ${
                                                        paymentOutcome.category === "completed"
                                                            ? "bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800"
                                                            : paymentOutcome.category === "processing"
                                                            ? "bg-gradient-to-br from-blue-600 via-indigo-700 to-slate-900"
                                                            : paymentOutcome.category === "failed"
                                                            ? "bg-gradient-to-br from-rose-600 via-red-700 to-slate-900"
                                                            : paymentOutcome.category === "cancelled"
                                                            ? "bg-gradient-to-br from-amber-600 via-orange-600 to-slate-900"
                                                            : "bg-gradient-to-br from-slate-700 via-slate-800 to-slate-950"
                                                    }`}
                                                >
                                                    {/* Subtle Decorative Radial Glows */}
                                                    <div className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-white/10 blur-3xl" />
                                                    <div className="pointer-events-none absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-black/10 blur-3xl" />

                                                    {/* Top Bar: Live Status Pill + Copyable Reference Chip */}
                                                    <div className="relative flex flex-wrap items-center justify-between gap-3 mb-6">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-white/15 backdrop-blur-md border border-white/25 text-white shadow-2xs">
                                                                <span
                                                                    className={`w-2 h-2 rounded-full ${
                                                                        paymentOutcome.category === "completed"
                                                                            ? "bg-emerald-300 animate-pulse"
                                                                            : paymentOutcome.category === "processing"
                                                                            ? "bg-blue-300 animate-ping"
                                                                            : paymentOutcome.category === "failed"
                                                                            ? "bg-rose-300"
                                                                            : "bg-amber-300"
                                                                    }`}
                                                                />
                                                                {paymentOutcome.category === "completed"
                                                                    ? `Payment Successful${
                                                                          paymentOutcome.paymentStatus
                                                                              ? ` • ${paymentOutcome.paymentStatus}`
                                                                              : " • Captured"
                                                                      }`
                                                                    : paymentOutcome.category === "processing"
                                                                    ? "Payment Authorized • Verifying"
                                                                    : paymentOutcome.category === "failed"
                                                                    ? `Payment Declined${
                                                                          paymentOutcome.paymentStatus
                                                                              ? ` • ${paymentOutcome.paymentStatus}`
                                                                              : ""
                                                                      }`
                                                                    : paymentOutcome.category === "cancelled"
                                                                    ? "Payment Cancelled"
                                                                    : "Session Expired"}
                                                            </span>
                                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-black/15 border border-white/15 text-white/90">
                                                                <Shield className="w-3.5 h-3.5 text-white/80" />
                                                                <span>3DS 2.0 Protected</span>
                                                            </span>
                                                        </div>

                                                        {/* Copyable Transaction Reference Pill */}
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                const refVal = paymentOutcome.reference || transactionRef;
                                                                if (refVal && navigator?.clipboard) {
                                                                    void navigator.clipboard.writeText(refVal);
                                                                    setCopiedField("status-tnxref");
                                                                    setTimeout(() => setCopiedField(null), 2000);
                                                                }
                                                            }}
                                                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 transition-colors border border-white/20 text-xs font-mono text-white cursor-pointer"
                                                            title="Click to copy transaction reference"
                                                        >
                                                            <span className="text-white/75 font-sans">Transaction Ref:</span>
                                                            <strong className="font-bold tracking-wide">
                                                                #{paymentOutcome.reference || transactionRef || "PENDING"}
                                                            </strong>
                                                            {copiedField === "status-tnxref" ? (
                                                                <span className="inline-flex items-center gap-1 text-[11px] font-sans font-semibold text-emerald-200">
                                                                    <Check className="w-3.5 h-3.5" />
                                                                    Copied
                                                                </span>
                                                            ) : (
                                                                <Copy className="w-3.5 h-3.5 text-white/80" />
                                                            )}
                                                        </button>
                                                    </div>

                                                    {/* Main Hero Icon + Headline + Subtitle */}
                                                    <div className="relative flex flex-col sm:flex-row items-start sm:items-center gap-5">
                                                        <div className="relative shrink-0">
                                                            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white/15 backdrop-blur-md border border-white/30 flex items-center justify-center shadow-lg">
                                                                {paymentOutcome.category === "completed" ? (
                                                                    <CheckCircle2 className="w-10 h-10 text-white stroke-[2.2]" />
                                                                ) : paymentOutcome.category === "processing" ? (
                                                                    <Clock className="w-10 h-10 text-white stroke-[2.2]" />
                                                                ) : paymentOutcome.category === "failed" ? (
                                                                    <XCircle className="w-10 h-10 text-white stroke-[2.2]" />
                                                                ) : (
                                                                    <AlertTriangle className="w-10 h-10 text-white stroke-[2.2]" />
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="space-y-2 flex-1">
                                                            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                                                                {paymentOutcome.category === "completed"
                                                                    ? "Payment Successful — Transaction in Progress"
                                                                    : paymentOutcome.category === "processing"
                                                                    ? "Payment Authorized — Finalizing Verification"
                                                                    : paymentOutcome.category === "failed"
                                                                    ? "Payment Could Not Be Completed"
                                                                    : paymentOutcome.category === "cancelled"
                                                                    ? "Payment Authorization Was Cancelled"
                                                                    : "Payment Security Session Timed Out"}
                                                            </h2>
                                                            <p className="text-sm sm:text-base text-white/90 leading-relaxed max-w-2xl">
                                                                {paymentOutcome.category === "completed"
                                                                    ? "Your payment has been securely captured. We are now dispatching the payout to your recipient's bank account and will email you the final settlement confirmation in a few minutes."
                                                                    : paymentOutcome.category === "processing"
                                                                    ? "Your payment instruction has been authorized and is being confirmed with your bank. We will email you the final status of your transaction within a few minutes."
                                                                    : paymentOutcome.category === "failed"
                                                                    ? "Your card issuer or bank declined this payment request. No funds have been debited from your account, and your transfer details remain safely saved so you can retry immediately."
                                                                    : paymentOutcome.category === "cancelled"
                                                                    ? "The payment authorization window was closed before completion. No money has been taken from your account — you can resume with the same or another payment method below."
                                                                    : "The 3D Secure verification window expired before authorization was completed. No funds were debited from your account."}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    {/* Currency Corridor Showcase Bar inside Hero */}
                                                    <div className="relative mt-7 rounded-2xl bg-black/20 backdrop-blur-md border border-white/15 p-4 sm:p-5 overflow-hidden">
                                                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 md:gap-6">
                                                            {/* Left: You Paid / Amount */}
                                                            <div className="min-w-0 flex-1 space-y-1">
                                                                <span className="text-[11px] font-semibold uppercase tracking-wider text-white/70 block">
                                                                    {paymentOutcome.category === "completed"
                                                                        ? "Total Paid"
                                                                        : paymentOutcome.category === "processing"
                                                                        ? "Amount Authorized"
                                                                        : "Transfer Amount"}
                                                                </span>
                                                                <div className="flex flex-wrap items-baseline gap-2">
                                                                    <span className="text-xl sm:text-2xl font-extrabold tabular-nums text-white whitespace-nowrap">
                                                                        {sendSymbol}
                                                                        {Math.max(0, totalPay).toFixed(2)}
                                                                    </span>
                                                                    <span className="text-xs font-bold uppercase px-2 py-0.5 rounded bg-white/15 text-white/90 shrink-0">
                                                                        {SEND_CURRENCY}
                                                                    </span>
                                                                </div>
                                                                <span className="text-xs text-white/75 block truncate">
                                                                    via {paymentOutcome.paymentMethodLabel}
                                                                </span>
                                                            </div>

                                                            {/* Center: Exchange Rate Pill */}
                                                            <div className="shrink-0 flex md:flex-col items-center justify-between md:justify-center gap-1.5 border-y md:border-y-0 md:border-x border-white/15 py-2.5 md:py-1 md:px-5">
                                                                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 border border-white/20 text-xs font-semibold text-white whitespace-nowrap">
                                                                    <ArrowRightLeft className="w-3.5 h-3.5 text-white/80 shrink-0" />
                                                                    <span>
                                                                        {sendSymbol}1 = {receiveSymbol}
                                                                        {EXCHANGE_RATE.toFixed(2)}
                                                                    </span>
                                                                </div>
                                                                <span className="text-[11px] text-white/70 font-medium whitespace-nowrap">
                                                                    Locked Guaranteed Rate
                                                                </span>
                                                            </div>

                                                            {/* Right: Recipient Receives */}
                                                            <div className="min-w-0 flex-1 md:text-right space-y-1">
                                                                <span className="text-[11px] font-semibold uppercase tracking-wider text-white/70 block">
                                                                    Recipient Gets
                                                                </span>
                                                                <div className="flex flex-wrap md:justify-end items-baseline gap-2">
                                                                    <span className="text-xl sm:text-2xl font-extrabold tabular-nums text-emerald-200 whitespace-nowrap">
                                                                        {receiveSymbol}
                                                                        {finalReceiveAmount}
                                                                    </span>
                                                                    <span className="text-xs font-bold uppercase px-2 py-0.5 rounded bg-emerald-400/20 border border-emerald-300/30 text-emerald-100 shrink-0">
                                                                        {recipientDetails.currency || "NGN"}
                                                                    </span>
                                                                </div>
                                                                <span className="text-xs text-white/80 block truncate">
                                                                    To{" "}
                                                                    {beneficiaryType === "business"
                                                                        ? recipientDetails.companyName.trim() ||
                                                                          selectedRecipient?.name ||
                                                                          "Recipient"
                                                                        : [
                                                                              recipientDetails.firstName.trim(),
                                                                              recipientDetails.lastName.trim(),
                                                                          ]
                                                                              .filter(Boolean)
                                                                              .join(" ") ||
                                                                          selectedRecipient?.name ||
                                                                          "Recipient"}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Card Body: Live 4-Stage Settlement Stepper + Two-Column Receipt & Bank Details */}
                                                <div className="p-6 sm:p-8 space-y-7 bg-gradient-to-b from-slate-50/60 to-white">
                                                    {/* 4-Stage Settlement Timeline */}
                                                    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-6 shadow-2xs">
                                                        <div className="flex items-center justify-between mb-4">
                                                            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                                                Live Settlement Progress
                                                            </span>
                                                            <span className="text-xs font-medium text-slate-500">
                                                                Updated at {paymentOutcome.timestamp}
                                                            </span>
                                                        </div>
                                                        <div className="grid grid-cols-4 gap-2 sm:gap-4 text-center relative">
                                                            {[
                                                                {
                                                                    label: "Order Created",
                                                                    sublabel: `Ref #${paymentOutcome.reference || transactionRef || "—"}`,
                                                                    completed: true,
                                                                    active: false,
                                                                    error: false,
                                                                },
                                                                {
                                                                    label: "3DS & Bank Auth",
                                                                    sublabel:
                                                                        paymentOutcome.category === "completed" ||
                                                                        paymentOutcome.category === "processing"
                                                                            ? "Verified"
                                                                            : paymentOutcome.category === "cancelled"
                                                                            ? "Cancelled"
                                                                            : paymentOutcome.category === "expired"
                                                                            ? "Timed Out"
                                                                            : "Declined",
                                                                    completed:
                                                                        paymentOutcome.category === "completed" ||
                                                                        paymentOutcome.category === "processing",
                                                                    active: false,
                                                                    error:
                                                                        paymentOutcome.category === "failed" ||
                                                                        paymentOutcome.category === "cancelled" ||
                                                                        paymentOutcome.category === "expired",
                                                                },
                                                                {
                                                                    label:
                                                                        paymentOutcome.category === "completed"
                                                                            ? "Payment Captured"
                                                                            : paymentOutcome.category === "processing"
                                                                            ? "Verifying Funds"
                                                                            : paymentOutcome.category === "failed"
                                                                            ? "Payment Failed"
                                                                            : paymentOutcome.category === "cancelled"
                                                                            ? "Not Charged"
                                                                            : "Session Expired",
                                                                    sublabel:
                                                                        paymentOutcome.category === "completed"
                                                                            ? paymentOutcome.paymentStatus || "Captured"
                                                                            : paymentOutcome.category === "processing"
                                                                            ? "In Progress"
                                                                            : "No Funds Debited",
                                                                    completed: paymentOutcome.category === "completed",
                                                                    active: paymentOutcome.category === "processing",
                                                                    error:
                                                                        paymentOutcome.category === "failed" ||
                                                                        paymentOutcome.category === "cancelled" ||
                                                                        paymentOutcome.category === "expired",
                                                                },
                                                                {
                                                                    label: "Recipient Payout",
                                                                    sublabel:
                                                                        paymentOutcome.category === "completed"
                                                                            ? "Dispatched"
                                                                            : paymentOutcome.category === "processing"
                                                                            ? "Queued"
                                                                            : "On Hold",
                                                                    completed: false,
                                                                    active: paymentOutcome.category === "completed",
                                                                    error: false,
                                                                },
                                                            ].map((stage, idx) => (
                                                                <div key={idx} className="flex flex-col items-center gap-1.5">
                                                                    <div
                                                                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all border-2 ${
                                                                            stage.completed
                                                                                ? "bg-emerald-50 border-emerald-500 text-emerald-600 shadow-xs"
                                                                                : stage.error
                                                                                ? "bg-red-50 border-red-400 text-red-600"
                                                                                : stage.active
                                                                                ? "bg-blue-50 border-blue-500 text-blue-600 ring-4 ring-blue-100"
                                                                                : "bg-slate-50 border-slate-200 text-slate-400"
                                                                        }`}
                                                                    >
                                                                        {stage.completed ? (
                                                                            <Check className="w-4 h-4 stroke-[2.75]" />
                                                                        ) : stage.error ? (
                                                                            <X className="w-4 h-4 stroke-[2.75]" />
                                                                        ) : stage.active ? (
                                                                            <Loader2 className="w-4 h-4 animate-spin" />
                                                                        ) : (
                                                                            <ArrowRightLeft className="w-4 h-4" />
                                                                        )}
                                                                    </div>
                                                                    <span
                                                                        className={`text-xs sm:text-sm leading-tight ${
                                                                            stage.completed
                                                                                ? "font-bold text-slate-900"
                                                                                : stage.error
                                                                                ? "font-bold text-red-600"
                                                                                : stage.active
                                                                                ? "font-bold text-blue-600"
                                                                                : "font-medium text-slate-400"
                                                                        }`}
                                                                    >
                                                                        {stage.label}
                                                                    </span>
                                                                    <span className="text-[11px] text-slate-500 hidden sm:block">
                                                                        {stage.sublabel}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* Promo Code / Referral Bonus Banner */}
                                                    {(promoApplied || useBonus) && (
                                                        <div
                                                            data-testid="payment-status-reward-banner"
                                                            className={`rounded-2xl p-4 flex items-start gap-3 text-xs sm:text-sm ${
                                                                paymentOutcome.category === "completed" ||
                                                                paymentOutcome.category === "processing"
                                                                    ? "bg-emerald-50/90 border border-emerald-200 text-emerald-950"
                                                                    : "bg-teal-50/90 border border-teal-200 text-teal-950"
                                                            }`}
                                                        >
                                                            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                                                            <div className="space-y-0.5">
                                                                <p className="font-bold">
                                                                    {paymentOutcome.category === "completed" ||
                                                                    paymentOutcome.category === "processing"
                                                                        ? "Rewards & Savings Applied"
                                                                        : "Your Rewards Are Safely Preserved"}
                                                                </p>
                                                                <p className="text-slate-700">
                                                                    {paymentOutcome.category === "completed" ||
                                                                    paymentOutcome.category === "processing"
                                                                        ? promoApplied && useBonus
                                                                            ? `Your promo code (${promoCode}) and Bonus ${
                                                                                  bonusType === "pay_less" ? "discount" : "credit"
                                                                              } have been applied to this transfer.`
                                                                            : promoApplied
                                                                            ? `Your promo code (${promoCode}) saved you ${formatPromoMoney(
                                                                                  promoDiscount,
                                                                                  SEND_CURRENCY,
                                                                              ).replace(/^−/, "")} on this transfer.`
                                                                            : `Bonus ${
                                                                                  bonusType === "pay_less" ? "discount" : "credit"
                                                                              } (${sendSymbol}${bonusAmount.toFixed(
                                                                                  2,
                                                                              )}) has been applied to this transfer.`
                                                                        : promoApplied
                                                                        ? `Your promo code (${promoCode}) remains attached to this transfer and will automatically apply when you retry.`
                                                                        : `Your Referral / Bonus ${
                                                                              bonusType === "pay_less" ? "discount" : "credit"
                                                                          } (${sendSymbol}${bonusAmount.toFixed(
                                                                              2,
                                                                          )}) remains attached to this transfer and will automatically apply when you retry.`}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Diagnostic / Bank Reason Detail Banner (when applicable) */}
                                                    {paymentOutcome.reason && (
                                                        <div className="rounded-2xl bg-amber-50/80 border border-amber-200/90 p-4 flex items-start gap-3 text-xs sm:text-sm text-amber-950">
                                                            <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                                                            <div>
                                                                <span className="font-bold">Processor Message: </span>
                                                                <span>{paymentOutcome.reason}</span>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Two-Column Executive Receipt & Beneficiary Details */}
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                                        {/* Left Box: Financial Breakdown */}
                                                        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 space-y-3.5 shadow-2xs">
                                                            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                                                                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                                                    Payment Summary
                                                                </span>
                                                                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                                                                    <CreditCard className="w-3.5 h-3.5 text-blue-600" />
                                                                    {paymentOutcome.paymentMethodLabel}
                                                                </span>
                                                            </div>

                                                            <div className="space-y-2.5 text-sm">
                                                                <div className="flex items-center justify-between">
                                                                    <span className="text-slate-500">You Send</span>
                                                                    <span className="font-semibold text-slate-900 tabular-nums">
                                                                        {sendSymbol}
                                                                        {youSendAmount.toFixed(2)} {SEND_CURRENCY}
                                                                    </span>
                                                                </div>
                                                                <div className="flex items-center justify-between">
                                                                    <span className="text-slate-500">Transfer Fee</span>
                                                                    <span className="font-semibold text-slate-900 tabular-nums">
                                                                        {sendSymbol}
                                                                        {effectiveFee.toFixed(2)} {SEND_CURRENCY}
                                                                    </span>
                                                                </div>
                                                                {promoApplied && promoDiscount > 0 && (
                                                                    <div className="flex items-center justify-between font-semibold text-emerald-700">
                                                                        <span>{PROMO_COPY.summaryLabel(promoCode)}</span>
                                                                        <span className="tabular-nums">
                                                                            −{formatPromoMoney(promoDiscount, SEND_CURRENCY).replace(/^−/, "")}
                                                                        </span>
                                                                    </div>
                                                                )}
                                                                {useBonus && bonusType === "pay_less" && (
                                                                    <div className="flex items-center justify-between font-semibold text-teal-700">
                                                                        <span>{BONUS_COPY.summaryPayLess}</span>
                                                                        <span className="tabular-nums">
                                                                            −{sendSymbol}
                                                                            {bonusAmount.toFixed(2)}
                                                                        </span>
                                                                    </div>
                                                                )}
                                                                {useBonus && bonusType === "send_more" && (
                                                                    <div className="flex items-center justify-between font-semibold text-teal-700">
                                                                        <span>{BONUS_COPY.summarySendMore}</span>
                                                                        <span className="tabular-nums">
                                                                            +{sendSymbol}
                                                                            {bonusAmount.toFixed(2)}
                                                                        </span>
                                                                    </div>
                                                                )}
                                                                <div className="pt-2.5 border-t border-slate-200/80 flex items-center justify-between">
                                                                    <span className="font-bold text-slate-900">
                                                                        {paymentOutcome.category === "completed"
                                                                            ? "Total Paid"
                                                                            : "Total Amount"}
                                                                    </span>
                                                                    <span className="text-base font-extrabold text-slate-950 tabular-nums">
                                                                        {sendSymbol}
                                                                        {Math.max(0, totalPay).toFixed(2)} {SEND_CURRENCY}
                                                                    </span>
                                                                </div>
                                                                <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                                                                    <span className="text-slate-500">Recipient Receives</span>
                                                                    <span className="font-extrabold text-blue-600 tabular-nums">
                                                                        {receiveSymbol}
                                                                        {finalReceiveAmount} {recipientDetails.currency || "NGN"}
                                                                        {useBonus && bonusType === "send_more" && (
                                                                            <span className="text-xs text-emerald-600 ml-1.5 font-bold">
                                                                                (+Bonus)
                                                                            </span>
                                                                        )}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Right Box: Recipient & Settlement Destination */}
                                                        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 space-y-3.5 shadow-2xs flex flex-col justify-between">
                                                            <div className="space-y-3.5">
                                                                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                                                                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                                                        Beneficiary Settlement
                                                                    </span>
                                                                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full capitalize">
                                                                        {deliveryMethod.replace("_", " ")}
                                                                    </span>
                                                                </div>

                                                                <div className="space-y-2.5 text-sm">
                                                                    <div className="flex items-center justify-between gap-2">
                                                                        <span className="text-slate-500 shrink-0">Recipient</span>
                                                                        <span className="font-bold text-slate-900 text-right truncate">
                                                                            {beneficiaryType === "business"
                                                                                ? recipientDetails.companyName.trim() ||
                                                                                  selectedRecipient?.name ||
                                                                                  "—"
                                                                                : [
                                                                                      recipientDetails.firstName.trim(),
                                                                                      recipientDetails.lastName.trim(),
                                                                                  ]
                                                                                      .filter(Boolean)
                                                                                      .join(" ") ||
                                                                                  selectedRecipient?.name ||
                                                                                  "—"}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex items-center justify-between gap-2">
                                                                        <span className="text-slate-500 shrink-0">
                                                                            {deliveryMethod === "mobile_money"
                                                                                ? "Mobile Operator"
                                                                                : "Bank Name"}
                                                                        </span>
                                                                        <span className="font-medium text-slate-900 text-right truncate">
                                                                            {recipientDetails.bankName.trim() ||
                                                                                selectedRecipient?.bank ||
                                                                                "—"}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex items-center justify-between gap-2">
                                                                        <span className="text-slate-500 shrink-0">
                                                                            {deliveryMethod === "mobile_money"
                                                                                ? "Mobile Number"
                                                                                : recipientDetails.iban.trim() &&
                                                                                  !recipientDetails.accountNumber.trim()
                                                                                ? "IBAN"
                                                                                : "Account Number"}
                                                                        </span>
                                                                        <span className="font-mono font-bold text-slate-900 text-right">
                                                                            {deliveryMethod === "mobile_money"
                                                                                ? recipientDetails.mobileNo.trim() ||
                                                                                  recipientDetails.accountNumber.trim() ||
                                                                                  selectedRecipient?.mobileNo ||
                                                                                  selectedRecipient?.account ||
                                                                                  "—"
                                                                                : recipientDetails.accountNumber.trim() ||
                                                                                  recipientDetails.iban.trim() ||
                                                                                  selectedRecipient?.account ||
                                                                                  selectedRecipient?.iban ||
                                                                                  "—"}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Email Notification Assurance Pill */}
                                                            <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3 flex items-center gap-2.5 text-xs text-slate-600">
                                                                <Mail className="w-4 h-4 text-blue-600 shrink-0" />
                                                                <span>
                                                                    We will email you the final status and official payout receipt in a few minutes.
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Auto-Redirect to Home Page Countdown Banner (All Payment Outcomes) */}
                                                    {redirectCountdown !== null && redirectCountdown > 0 && (
                                                        <div
                                                            data-testid="payment-status-redirect-banner"
                                                            className="rounded-2xl bg-slate-900 text-white px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs sm:text-sm shadow-md"
                                                        >
                                                            <div className="flex items-center gap-2.5">
                                                                <Loader2 className="w-4 h-4 text-emerald-400 animate-spin shrink-0" />
                                                                <span>
                                                                    Taking you back to your Rhemito Dashboard in{" "}
                                                                    <strong className="font-extrabold text-emerald-300 tabular-nums">
                                                                        {redirectCountdown}s
                                                                    </strong>
                                                                    ...
                                                                </span>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => setRedirectCountdown(null)}
                                                                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors shrink-0 self-start sm:self-auto"
                                                            >
                                                                Stay on Receipt
                                                            </button>
                                                        </div>
                                                    )}

                                                    {/* Primary & Secondary Action Buttons */}
                                                    <div className="pt-1 flex flex-col sm:flex-row gap-3">
                                                        {paymentOutcome.category === "completed" ||
                                                        paymentOutcome.category === "processing" ? (
                                                            <>
                                                                <Button
                                                                    type="button"
                                                                    data-testid="button-status-go-dashboard"
                                                                    onClick={() => {
                                                                        setRedirectCountdown(null);
                                                                        setLocation("/");
                                                                    }}
                                                                    className="flex-1 h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm inline-flex items-center justify-center gap-2"
                                                                >
                                                                    <span>Done — Return to Dashboard</span>
                                                                    <ArrowRight className="w-4 h-4" />
                                                                </Button>
                                                                <Button
                                                                    type="button"
                                                                    variant="outline"
                                                                    data-testid="button-status-view-transactions"
                                                                    onClick={() => {
                                                                        setRedirectCountdown(null);
                                                                        setLocation("/transactions");
                                                                    }}
                                                                    className="flex-1 h-12 rounded-xl font-semibold border-slate-300 hover:bg-slate-50"
                                                                >
                                                                    View in Transactions
                                                                </Button>
                                                                {paymentOutcome.category === "processing" &&
                                                                    paymentOutcome.journeyCode && (
                                                                        <Button
                                                                            type="button"
                                                                            variant="outline"
                                                                            disabled={refreshingJourneyStatus}
                                                                            onClick={async () => {
                                                                                if (!paymentOutcome.journeyCode) return;
                                                                                setRedirectCountdown(null);
                                                                                setRefreshingJourneyStatus(true);
                                                                                const latest = await fetchMitoJourneyStatus(
                                                                                    paymentOutcome.journeyCode,
                                                                                );
                                                                                setRefreshingJourneyStatus(false);
                                                                                if (latest) {
                                                                                    applyPaymentOutcome({
                                                                                        rawStatus:
                                                                                            latest.orderStatus ||
                                                                                            latest.journeyStatus ||
                                                                                            "PROCESSING",
                                                                                        reference:
                                                                                            latest.orderNo ||
                                                                                            latest.partnerReferenceNumber ||
                                                                                            latest.reference ||
                                                                                            paymentOutcome.reference,
                                                                                        methodLabel: paymentOutcome.paymentMethodLabel,
                                                                                        journeyCode: latest.journeyCode,
                                                                                    });
                                                                                }
                                                                            }}
                                                                            className="h-12 rounded-xl font-semibold inline-flex items-center gap-2"
                                                                        >
                                                                            <RefreshCw
                                                                                className={`w-4 h-4 ${
                                                                                    refreshingJourneyStatus ? "animate-spin" : ""
                                                                                }`}
                                                                            />
                                                                            <span>Check Status</span>
                                                                        </Button>
                                                                    )}
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Button
                                                                    type="button"
                                                                    data-testid="button-status-retry-payment"
                                                                    onClick={() => {
                                                                        setRedirectCountdown(null);
                                                                        setPaymentOutcome(null);
                                                                        setMitoPayByBankUrl(null);
                                                                        setMitoCardPaymentSession(null);
                                                                    }}
                                                                    className="flex-1 h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm inline-flex items-center justify-center gap-2"
                                                                >
                                                                    <RefreshCw className="w-4 h-4" />
                                                                    <span>Try Again / Choose Another Payment Method</span>
                                                                </Button>
                                                                <Button
                                                                    type="button"
                                                                    variant="outline"
                                                                    data-testid="button-status-go-dashboard"
                                                                    onClick={() => {
                                                                        setRedirectCountdown(null);
                                                                        setLocation("/");
                                                                    }}
                                                                    className="h-12 rounded-xl font-semibold border-slate-300 hover:bg-slate-50"
                                                                >
                                                                    Return to Dashboard
                                                                </Button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </motion.div>
                                    ) : (
                                    <Card>
                                        <CardHeader>
                                            <CardTitle className="text-base">
                                                {mitoCardPaymentSession ? "Card Details" : "How would you like to pay?"}
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            {mitoCardPaymentSession ? (
                                                <div className="space-y-4" data-testid="mito-card-checkout-section">
                                                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-gray-100">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setMitoCardPaymentSession(null);
                                                                setCheckoutFlowError(null);
                                                            }}
                                                            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
                                                        >
                                                            <ArrowLeft className="w-4 h-4" />
                                                            <span>Change payment method</span>
                                                        </button>
                                                        {transactionRef && (
                                                            <span className="text-xs font-mono text-gray-500">
                                                                Ref: {transactionRef}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {checkoutFlowMounting && (
                                                        <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-600">
                                                            <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                                                            <span>Loading secure card checkout...</span>
                                                        </div>
                                                    )}

                                                    {checkoutFlowError && (
                                                        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                                                            {checkoutFlowError}
                                                        </div>
                                                    )}

                                                    <div
                                                        id="mito-checkout-flow-container"
                                                        ref={checkoutFlowContainerRef}
                                                        className="min-h-[220px]"
                                                    />
                                                </div>
                                            ) : (
                                                [
                                                    { id: "instant_bank", title: "Instant Pay By Bank", desc: `You pay GBP ${totalPay.toFixed(2)}`, icon: Landmark },
                                                    { id: "card", title: "Credit/Debit Card", desc: `You pay GBP ${totalPay.toFixed(2)}`, icon: CreditCard },
                                                    { id: "manual_transfer", title: "Manual Bank Transfer", desc: "Send to our local account (Pay within 30 minutes)", icon: Building2 },
                                                ].map((method) => (
                                                    <div
                                                        key={method.id}
                                                        onClick={async () => {
                                                            if (loadingPaymentMethod) return;
                                                            setPaymentMethod(method.id);
                                                            setMitoPayByBankUrl(null);
                                                            setPaymentOutcome(null);
                                                            setRedirectCountdown(null);
                                                            if (method.id === "manual_transfer") {
                                                                setShowManualTransferConfirm(true);
                                                                return;
                                                            }
                                                            let paidTx: Awaited<ReturnType<typeof paySendMoneyTransaction>> | null = null;
                                                            // Record the payment method on the server-owned
                                                            // transaction and call POST /api/v1/Transaction/SendMoney.
                                                            if (transactionId) {
                                                                setLoadingPaymentMethod(method.id);
                                                                try {
                                                                    if (promoApplied) promo.lock();
                                                                    paidTx = await paySendMoneyTransaction(
                                                                        transactionId,
                                                                        method.id as SendMoneyPaymentMethod,
                                                                        promoApplied ? { code: promoCode, discount: promoDiscount } : null,
                                                                        useBonus ? { mode: bonusType, amount: bonusAmount } : null,
                                                                    );
                                                                    if (paidTx?.mitoReference) {
                                                                        setTransactionRef(paidTx.mitoReference);
                                                                    }
                                                                    if (paidTx?.mitoCheckoutPublicKey) {
                                                                        setMitoCheckoutPublicKey(paidTx.mitoCheckoutPublicKey);
                                                                    }
                                                                } catch (e) {
                                                                    setLoadingPaymentMethod(null);
                                                                    // The bonus is used with the payment; if it can't be, the transfer is not paid (BONUS-RHEMITO B-23)
                                                                    if (e instanceof SendMoneyApiError && e.code.startsWith("BONUS_")) {
                                                                        bonusRefused(e);
                                                                        setPaymentMethod("");
                                                                        return;
                                                                    }
                                                                    // A promo code that can no longer be used stops the payment before any money moves (PROMO-RHEMITO §6.4)
                                                                    if (e instanceof SendMoneyApiError && e.code.startsWith("PROMO_")) {
                                                                        promo.reject(e.message);
                                                                        setPaymentMethod("");
                                                                        toast({ title: "Payment not made", description: e.message, variant: "destructive" });
                                                                        return;
                                                                    }
                                                                    console.error("Failed to record payment method", e);
                                                                    const description = e instanceof SendMoneyApiError ? e.message : "We couldn't complete your payment. Please try again.";
                                                                    toast({ title: "Payment not completed", description, variant: "destructive" });
                                                                    setPaymentMethod("");
                                                                    return;
                                                                }
                                                                setLoadingPaymentMethod(null);
                                                            }
                                                            void rewards.refetch();
                                                            if (method.id === "card" && paidTx?.mitoPaymentSession) {
                                                                setMitoCardPaymentSession(paidTx.mitoPaymentSession);
                                                                return;
                                                            }
                                                            if (
                                                                method.id === "instant_bank" &&
                                                                paidTx?.mitoPaymentUrl &&
                                                                paidTx.mitoPaymentUrl.startsWith("http")
                                                            ) {
                                                                setMitoPayByBankUrl(paidTx.mitoPaymentUrl);
                                                                return;
                                                            }
                                                            applyPaymentOutcome({
                                                                rawStatus: paidTx?.status || "COMPLETED",
                                                                reference: paidTx?.mitoReference || paidTx?.reference || transactionRef,
                                                                methodLabel: method.title,
                                                            });
                                                        }}
                                                        className={`p-4 border rounded-xl cursor-pointer flex items-center gap-4 transition-all ${paymentMethod === method.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-gray-300"
                                                            }`}
                                                    >
                                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center bg-white border ${paymentMethod === method.id ? "text-primary border-primary" : "text-gray-500 border-gray-200"
                                                            }`}>
                                                            {loadingPaymentMethod === method.id ? (
                                                                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                                                            ) : (
                                                                <method.icon className="w-5 h-5" />
                                                            )}
                                                        </div>
                                                        <div>
                                                            <div className="font-medium">{method.title}</div>
                                                            <div className="text-xs text-muted-foreground">{method.desc}</div>
                                                        </div>
                                                        {paymentMethod === method.id && <div className="ml-auto text-primary"><Check className="w-5 h-5" /></div>}
                                                    </div>
                                                ))
                                            )}

                                            {mitoPayByBankUrl && !mitoCardPaymentSession && typeof document !== "undefined" && createPortal(
                                                <div
                                                    data-testid="mito-pay-by-bank-modal"
                                                    className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 sm:p-6"
                                                >
                                                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[420px] h-[min(680px,calc(100dvh-48px))] max-h-[calc(100dvh-32px)] flex flex-col overflow-hidden border border-slate-200">
                                                        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 bg-slate-50/70">
                                                            <div className="min-w-0">
                                                                <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                                                                    <Landmark className="w-4 h-4 text-primary shrink-0" />
                                                                    <span>Instant Pay By Bank</span>
                                                                </div>
                                                                {transactionRef && (
                                                                    <div className="text-[11px] text-slate-500 truncate">
                                                                        Ref: <span className="font-mono font-medium text-slate-700">{transactionRef}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-1.5 shrink-0">
                                                                <a
                                                                    href={mitoPayByBankUrl}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="px-2.5 py-1 rounded-md text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                                                                >
                                                                    Open in new tab
                                                                </a>
                                                                <button
                                                                    type="button"
                                                                    aria-label="Close Pay by Bank modal"
                                                                    data-testid="button-close-pay-by-bank-modal"
                                                                    onClick={() => {
                                                                        applyPaymentOutcome({
                                                                            rawStatus: "CANCELLED",
                                                                            reference: transactionRef,
                                                                            methodLabel: "Instant Pay By Bank",
                                                                            journeyCode: extractJourneyCodeFromUrl(mitoPayByBankUrl),
                                                                        });
                                                                    }}
                                                                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
                                                                >
                                                                    <X className="w-4 h-4" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <iframe
                                                            title="Pay by bank"
                                                            allow="encrypted-media"
                                                            src={buildMitoEmbeddedPayByBankUrl(mitoPayByBankUrl)}
                                                            className="w-full flex-1 border-0 bg-white"
                                                        />
                                                        <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between gap-2">
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => {
                                                                    applyPaymentOutcome({
                                                                        rawStatus: "CANCELLED",
                                                                        reference: transactionRef,
                                                                        methodLabel: "Instant Pay By Bank",
                                                                        journeyCode: extractJourneyCodeFromUrl(mitoPayByBankUrl),
                                                                    });
                                                                }}
                                                            >
                                                                Cancel
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                data-testid="button-complete-pay-by-bank"
                                                                onClick={async () => {
                                                                    const jCode = extractJourneyCodeFromUrl(mitoPayByBankUrl);
                                                                    if (jCode) {
                                                                        const latest = await fetchMitoJourneyStatus(jCode);
                                                                        if (latest) {
                                                                            applyPaymentOutcome({
                                                                                rawStatus:
                                                                                    latest.orderStatus ||
                                                                                    latest.journeyStatus ||
                                                                                    "PROCESSING",
                                                                                reference:
                                                                                    latest.orderNo ||
                                                                                    latest.partnerReferenceNumber ||
                                                                                    latest.reference ||
                                                                                    transactionRef,
                                                                                methodLabel: "Instant Pay By Bank",
                                                                                journeyCode: latest.journeyCode,
                                                                            });
                                                                            return;
                                                                        }
                                                                    }
                                                                    applyPaymentOutcome({
                                                                        rawStatus: "PROCESSING",
                                                                        reference: transactionRef,
                                                                        methodLabel: "Instant Pay By Bank",
                                                                        journeyCode: jCode,
                                                                    });
                                                                }}
                                                            >
                                                                I&apos;ve Completed Payment
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>,
                                                document.body
                                            )}
                                        </CardContent>
                                    </Card>
                                    )}


                                    {!paymentOutcome && (
                                        <div className="mt-6 flex items-start gap-2 p-4 bg-yellow-50 rounded-lg text-yellow-800 text-sm">
                                            <Shield className="w-4 h-4 mt-0.5 shrink-0" />
                                            <p>By selecting a payment option, you agree to our Terms of Use and Privacy Policy. Funds are usually delivered within minutes.</p>
                                        </div>
                                    )}
                                </div>

                                {/* Right Column: Amount Summary (Sticky) */}
                                {!paymentOutcome && (
                                <div className="lg:col-span-2">
                                    <div className="sticky top-6 space-y-6">
                                        <Card className="rounded-xl border border-[#efefee] bg-white shadow-[-2px_4px_16px_0px_rgba(0,0,0,0.04)]">
                                            <CardHeader className="pb-4 bg-white border-b border-[#efefee]">
                                                <CardTitle className="text-base font-semibold text-[#323130]">Amount Summary</CardTitle>
                                            </CardHeader>
                                            <CardContent className="space-y-3 text-sm pt-4">
                                                {/* Promo Discount Row (shown when a code is applied) */}
                                                {promoApplied && promoDiscount > 0 && (
                                                    <div className="flex justify-between font-medium text-green-700" data-testid="summary-promo">
                                                        <span>{PROMO_COPY.summaryLabel(promoCode)}</span>
                                                        <span className="whitespace-nowrap">−{formatPromoMoney(promoDiscount, SEND_CURRENCY).replace(/^−/, "")}</span>
                                                    </div>
                                                )}

                                                {/* Bonus Applied Row - Pay Less */}
                                                {useBonus && bonusType === "pay_less" && (
                                                    <div className="flex justify-between font-medium text-teal-700 bg-teal-50 px-2 py-1 -mx-2 rounded" data-testid="summary-bonus">
                                                        <span>{BONUS_COPY.summaryPayLess}</span>
                                                        <span className="whitespace-nowrap">- {sendSymbol}{bonusAmount.toFixed(2)}</span>
                                                    </div>
                                                )}

                                                {/* Bonus Applied Row - Send More */}
                                                {useBonus && bonusType === "send_more" && (
                                                    <div className="flex justify-between font-medium text-teal-700 bg-teal-50 px-2 py-1 -mx-2 rounded" data-testid="summary-bonus">
                                                        <span>{BONUS_COPY.summarySendMore}</span>
                                                        <span className="whitespace-nowrap">+ {sendSymbol}{bonusAmount.toFixed(2)}</span>
                                                    </div>
                                                )}

                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">You Send</span>
                                                    <span className="font-medium whitespace-nowrap">{sendSymbol}{youSendAmount.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Amount Sent</span>
                                                    <span className="font-medium whitespace-nowrap">{sendSymbol}{amountSentGBP.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">They Receive</span>
                                                    <span className="font-medium whitespace-nowrap">
                                                        {receiveSymbol}{finalReceiveAmount}
                                                        {useBonus && bonusType === "send_more" && (
                                                            <span className="text-xs text-green-600 ml-2 font-bold">(+Bonus)</span>
                                                        )}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Transaction Fee</span>
                                                    <span className="font-medium whitespace-nowrap">{sendSymbol}{effectiveFee.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Exchange Rate</span>
                                                    <span className="font-medium whitespace-nowrap">{sendSymbol}1 = {receiveSymbol}{EXCHANGE_RATE.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between pt-2">
                                                    <span className="text-gray-600">Connection Method</span>
                                                    <span className="font-medium text-right capitalize">
                                                        {deliveryMethod.replace('_', ' ')}
                                                    </span>
                                                </div>

                                                <div className="pt-4 mt-2 border-t">
                                                    <div className="flex justify-between items-center pt-2">
                                                        <span className="text-gray-900 font-bold text-base">Total to Pay</span>
                                                        <span className="font-bold text-lg text-gray-900 whitespace-nowrap" data-testid="summary-total">{sendSymbol}{Math.max(0, totalPay).toFixed(2)}</span>
                                                    </div>
                                                    {(promoApplied || useBonus) && (
                                                        <p className="text-xs text-green-600 font-medium mt-1">
                                                            Includes {promoApplied && "promo code"}{promoApplied && useBonus && " & "}{useBonus && (bonusType === 'pay_less' ? "Bonus Discount" : "Bonus Credit")}
                                                        </p>
                                                    )}
                                                </div>

                                                {/* Recipient / Beneficiary Details Section under Amount Summary */}
                                                <div className="pt-4 mt-3 border-t space-y-2.5" data-testid="summary-recipient-details">
                                                    <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                                        Recipient Details
                                                    </div>
                                                    <div className="flex justify-between gap-2">
                                                        <span className="text-gray-600 shrink-0">Recipient Name</span>
                                                        <span className="font-medium text-gray-900 text-right truncate" data-testid="summary-recipient-name">
                                                            {beneficiaryType === "business"
                                                                ? (recipientDetails.companyName.trim() || selectedRecipient?.name || "—")
                                                                : ([recipientDetails.firstName.trim(), recipientDetails.lastName.trim()].filter(Boolean).join(" ") || selectedRecipient?.name || "—")}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between gap-2">
                                                        <span className="text-gray-600 shrink-0">
                                                            {deliveryMethod === "mobile_money" ? "Mobile Operator" : "Bank Name"}
                                                        </span>
                                                        <span className="font-medium text-gray-900 text-right truncate" data-testid="summary-recipient-bank">
                                                            {recipientDetails.bankName.trim() || selectedRecipient?.bank || "—"}
                                                        </span>
                                                    </div>
                                                    {deliveryMethod === "mobile_money" ? (
                                                        <div className="flex justify-between gap-2">
                                                            <span className="text-gray-600 shrink-0">Mobile Number</span>
                                                            <span className="font-mono font-medium text-gray-900 text-right" data-testid="summary-recipient-account">
                                                                {recipientDetails.mobileNo.trim() || recipientDetails.accountNumber.trim() || selectedRecipient?.mobileNo || selectedRecipient?.account || "—"}
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <div className="flex justify-between gap-2">
                                                                <span className="text-gray-600 shrink-0">
                                                                    {recipientDetails.iban.trim() && !recipientDetails.accountNumber.trim() ? "IBAN" : "Account Number"}
                                                                </span>
                                                                <span className="font-mono font-medium text-gray-900 text-right break-all" data-testid="summary-recipient-account">
                                                                    {recipientDetails.accountNumber.trim() || recipientDetails.iban.trim() || selectedRecipient?.account || selectedRecipient?.iban || "—"}
                                                                </span>
                                                            </div>
                                                            {(recipientDetails.sortCode.trim() || selectedRecipient?.sortCode) && (
                                                                <div className="flex justify-between gap-2">
                                                                    <span className="text-gray-600 shrink-0">Sort Code</span>
                                                                    <span className="font-mono font-medium text-gray-900 text-right">
                                                                        {recipientDetails.sortCode.trim() || selectedRecipient?.sortCode}
                                                                    </span>
                                                                </div>
                                                            )}
                                                            {(recipientDetails.swift.trim() || selectedRecipient?.swift) && (
                                                                <div className="flex justify-between gap-2">
                                                                    <span className="text-gray-600 shrink-0">SWIFT / BIC</span>
                                                                    <span className="font-mono font-medium text-gray-900 text-right">
                                                                        {recipientDetails.swift.trim() || selectedRecipient?.swift}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </div>
                                </div>
                                )}
                            </motion.div>
                        )}

                        {/* Step 4 — Bank Transfer Details (Inline Page — Payment Brief 05/06 Web & 06/06 Mobile) */}
                        {currentStep === 4 && showBankTransferPage && (
                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="w-full max-w-3xl mx-auto space-y-5 pb-10"
                            >
                                {/* Back Button */}
                                <button
                                    onClick={() => { setShowBankTransferPage(false); setPaymentTimerActive(false); }}
                                    className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors group"
                                >
                                    <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                                    <span className="text-sm font-medium">Back to Payment Methods</span>
                                </button>

                                {/* 4-Stage Status Card */}
                                <div className="rounded-2xl border border-slate-200/80 bg-white px-3 sm:px-6 py-4 shadow-2xs">
                                    <div className="grid grid-cols-4 gap-2 text-center">
                                        {[
                                            { label: "Transaction\nCreated", icon: Check, active: false, completed: true },
                                            { label: "Awaiting\nPayment", icon: Clock, active: !transferComplete, completed: transferComplete },
                                            { label: "Payment\nReceived", icon: Banknote, active: false, completed: transferComplete },
                                            { label: "Processing\nTransfer", icon: ArrowRightLeft, active: false, completed: transferComplete },
                                        ].map((step, idx) => (
                                            <div key={idx} className="flex flex-col items-center gap-1.5">
                                                <div
                                                    className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                                                        step.completed
                                                            ? "bg-emerald-50 text-emerald-600"
                                                            : step.active
                                                            ? "bg-blue-50 text-[#2563EB]"
                                                            : "bg-slate-100 text-slate-500"
                                                    }`}
                                                >
                                                    {step.completed ? (
                                                        <Check className="w-4 h-4 stroke-[2.5]" />
                                                    ) : (
                                                        <step.icon className="w-4 h-4" />
                                                    )}
                                                </div>
                                                <span
                                                    className={`text-[11px] sm:text-xs leading-tight whitespace-pre-line ${
                                                        step.completed
                                                            ? "font-medium text-slate-700"
                                                            : step.active
                                                            ? "font-bold text-[#2563EB]"
                                                            : "font-medium text-slate-500"
                                                    }`}
                                                >
                                                    {step.label}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Unified Mint "Transaction created" + Timer Banner */}
                                <motion.div
                                    initial={{ opacity: 0, y: -6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="rounded-2xl bg-[#EAFBF3] border border-emerald-200/80 p-4 sm:p-5 space-y-2"
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-2.5">
                                            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                                            <span className="text-sm sm:text-base font-bold text-emerald-900">
                                                Transaction created
                                            </span>
                                        </div>
                                        <span
                                            className={`text-lg sm:text-2xl font-extrabold tabular-nums tracking-tight ${
                                                paymentTimeLeft <= 300 ? "text-red-700" : "text-[#92400E]"
                                            }`}
                                        >
                                            {formatPaymentTime(paymentTimeLeft)} left
                                        </span>
                                    </div>
                                    <div className="pl-0 sm:pl-7 space-y-1">
                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm sm:text-base font-extrabold text-emerald-950">
                                            <span>Ref: {transactionRef || "TXN-202610-00001"}</span>
                                            <span>Amount: GBP {totalPay.toFixed(2)}</span>
                                        </div>
                                        <p className="text-xs sm:text-sm text-emerald-800 leading-relaxed">
                                            Pay within 30 minutes to complete your transfer. Unpaid transfers are automatically cancelled.
                                        </p>
                                    </div>
                                </motion.div>

                                {/* Main Payment Brief Card (05/06 Web 2-Col Split & 06/06 Mobile Stacked) */}
                                <div className="rounded-2xl border border-slate-200/90 bg-white shadow-xs overflow-hidden">
                                    {/* Top Header Row inside Card */}
                                    <div className="px-5 sm:px-6 py-5 border-b border-slate-100 flex items-start justify-between gap-4">
                                        <div>
                                            <p className="text-[11px] sm:text-xs font-bold uppercase tracking-widest text-slate-500">
                                                PAY BY BANK TRANSFER
                                            </p>
                                            <p className="text-3xl sm:text-[34px] font-extrabold text-slate-950 tabular-nums tracking-tight mt-1">
                                                GBP {totalPay.toFixed(2)}
                                            </p>
                                            <p className="text-xs sm:text-sm text-slate-500 mt-1">
                                                Send the exact amount to this account.
                                            </p>
                                        </div>
                                        <button
                                            onClick={handleCopyAll}
                                            className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors shrink-0 shadow-2xs"
                                            title="Copy all details"
                                        >
                                            {copiedField === "all" ? (
                                                <>
                                                    <Check className="w-4 h-4 text-emerald-600" />
                                                    <span className="text-emerald-700">Copied!</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Copy className="w-4 h-4 text-slate-600" />
                                                    <span>Copy All</span>
                                                </>
                                            )}
                                        </button>
                                    </div>

                                    {/* Split Body: Left Blue Panel + Right White Details Panel (Stacks on Mobile) */}
                                    <div className="grid grid-cols-1 md:grid-cols-12 border-b border-slate-100">
                                        {/* Left Royal Blue Payee Panel */}
                                        <div className="md:col-span-6 bg-[#2563EB] text-white p-5 sm:p-6 flex flex-col justify-between">
                                            <div>
                                                <p className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-blue-100">
                                                    USE THIS ACCOUNT / PAYEE NAME
                                                </p>
                                                <span className="inline-block mt-2.5 px-2.5 py-1 rounded-md bg-white/15 border border-white/25 text-xs font-semibold text-white">
                                                    Type exactly as shown
                                                </span>
                                                <p className="mt-3.5 text-2xl sm:text-[28px] font-extrabold leading-tight text-white break-words">
                                                    Rhemito – Firopo Akin-Agunbiade
                                                </p>
                                                <p className="mt-3 text-xs sm:text-sm text-blue-50 leading-relaxed">
                                                    Enter this exact name as the payee in your banking app.
                                                </p>
                                                <p className="mt-2.5 text-xs sm:text-sm text-blue-100/95 leading-relaxed">
                                                    (Ensure you enter this name as is in your bank account — this is your dedicated Rhemito funding account, not your personal savings.)
                                                </p>
                                            </div>
                                            <div className="mt-5 pt-1">
                                                <button
                                                    onClick={() => handleCopy("Rhemito – Firopo Akin-Agunbiade", "name")}
                                                    className="px-4 py-2.5 rounded-xl bg-white hover:bg-blue-50 text-[#2563EB] text-xs sm:text-sm font-bold inline-flex items-center gap-2 transition-colors shadow-2xs"
                                                >
                                                    {copiedField === "name" ? (
                                                        <>
                                                            <Check className="w-4 h-4 text-emerald-600" />
                                                            <span className="text-emerald-700">Copied payee name!</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Copy className="w-4 h-4" />
                                                            <span>Copy payee name</span>
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        </div>

                                        {/* Right White Account / Sort Code / Payment Reference Panel */}
                                        <div className="md:col-span-6 bg-white p-5 sm:p-6 flex flex-col justify-between divide-y divide-slate-100">
                                            {/* Account number */}
                                            <div className="pb-4 flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-xs sm:text-sm text-slate-500 font-medium">Account number</p>
                                                    <p className="text-xl sm:text-2xl font-extrabold text-slate-950 font-mono tabular-nums mt-0.5">
                                                        20739483
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={() => handleCopy("20739483", "account")}
                                                    className="w-10 h-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600 transition-colors shrink-0"
                                                    title="Copy Account number"
                                                >
                                                    {copiedField === "account" ? (
                                                        <Check className="w-4 h-4 text-emerald-600" />
                                                    ) : (
                                                        <Copy className="w-4 h-4" />
                                                    )}
                                                </button>
                                            </div>

                                            {/* Sort code */}
                                            <div className="py-4 flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-xs sm:text-sm text-slate-500 font-medium">Sort code</p>
                                                    <p className="text-xl sm:text-2xl font-extrabold text-slate-950 font-mono tabular-nums mt-0.5">
                                                        04-14-04
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={() => handleCopy("04-14-04", "sort")}
                                                    className="w-10 h-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600 transition-colors shrink-0"
                                                    title="Copy Sort code"
                                                >
                                                    {copiedField === "sort" ? (
                                                        <Check className="w-4 h-4 text-emerald-600" />
                                                    ) : (
                                                        <Copy className="w-4 h-4" />
                                                    )}
                                                </button>
                                            </div>

                                            {/* Payment reference */}
                                            <div className="pt-4">
                                                <div className="rounded-2xl bg-[#EEF5FF] p-4 flex items-center justify-between gap-3">
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs sm:text-sm font-bold text-[#2563EB]">
                                                                Payment reference
                                                            </span>
                                                            <span className="px-2 py-0.5 rounded-md bg-white text-[#2563EB] text-[11px] font-semibold shadow-2xs">
                                                                Required
                                                            </span>
                                                        </div>
                                                        <p className="text-xl sm:text-2xl font-extrabold text-slate-950 font-mono tabular-nums mt-1">
                                                            20092400804
                                                        </p>
                                                    </div>
                                                    <button
                                                        onClick={() => handleCopy("20092400804", "ref")}
                                                        className="w-10 h-10 rounded-xl border border-blue-100 bg-white hover:bg-blue-50 flex items-center justify-center text-slate-700 transition-colors shrink-0"
                                                        title="Copy Payment reference"
                                                    >
                                                        {copiedField === "ref" ? (
                                                            <Check className="w-4 h-4 text-emerald-600" />
                                                        ) : (
                                                            <Copy className="w-4 h-4" />
                                                        )}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Bottom Section inside Main Card */}
                                    <div className="p-5 sm:p-6 space-y-4">
                                        {/* Email Confirmation Banner */}
                                        <div className="rounded-2xl bg-[#F2F7FF] px-4 py-3.5 flex items-start gap-3">
                                            <Mail className="w-4 h-4 text-[#2563EB] shrink-0 mt-0.5" />
                                            <div>
                                                <p className="text-xs sm:text-sm font-bold text-slate-900">
                                                    Bank details sent to your email
                                                </p>
                                                <p className="text-xs text-slate-600 mt-0.5">
                                                    These details are also available in your registered email.
                                                </p>
                                            </div>
                                        </div>

                                        {/* Completed your bank transfer? + Instant verification */}
                                        <div className="pt-1 flex flex-wrap items-center justify-center gap-2 text-center">
                                            <span className="text-sm sm:text-base font-bold text-slate-900">
                                                Completed your bank transfer?
                                            </span>
                                            <span className="px-2.5 py-0.5 rounded-md bg-[#EEF5FF] text-[#2563EB] text-xs font-semibold">
                                                Instant verification
                                            </span>
                                        </div>

                                        {/* Primary CTA: I have made the Payment */}
                                        {!transferComplete ? (
                                            <button
                                                onClick={() => {
                                                    setTransferComplete(true);
                                                    setPaymentTimerActive(false);
                                                    toast({
                                                        title: "Payment confirmation received",
                                                        description: "We are verifying your bank transfer and processing your transaction.",
                                                    });
                                                }}
                                                className="w-full py-3.5 px-6 rounded-xl bg-[#2563EB] hover:bg-blue-700 active:scale-[0.99] text-white font-bold text-sm sm:text-base shadow-xs transition-all text-center cursor-pointer"
                                            >
                                                I have made the Payment
                                            </button>
                                        ) : (
                                            <motion.div
                                                initial={{ opacity: 0, y: 6 }}
                                                animate={{ opacity: 1, y: 0 }}
                                            >
                                                <button
                                                    onClick={() => setLocation("/")}
                                                    className="w-full py-3.5 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm sm:text-base shadow-xs transition-all text-center cursor-pointer"
                                                >
                                                    Done — Go to Dashboard
                                                </button>
                                            </motion.div>
                                        )}

                                        {/* Secondary CTA: I've noted the details — take me to Dashboard */}
                                        {!transferComplete && (
                                            <button
                                                onClick={() => setLocation("/")}
                                                className="w-full py-3.5 px-6 rounded-xl bg-white hover:bg-slate-50 text-slate-900 font-semibold text-sm border border-slate-200 transition-colors text-center cursor-pointer"
                                            >
                                                I've noted the details — take me to Dashboard
                                            </button>
                                        )}

                                        {/* Footer helper text + Cancel Transaction + Currency Cloud */}
                                        <div className="pt-1 text-center space-y-2.5">
                                            {!transferComplete && (
                                                <p className="text-xs text-slate-500">
                                                    I'll complete the payment within 30 minutes
                                                </p>
                                            )}

                                            {!transferComplete && (
                                                <div>
                                                    <button
                                                        onClick={handleCancelClick}
                                                        className="text-xs sm:text-sm font-semibold text-red-600 hover:text-red-700 transition-colors cursor-pointer"
                                                    >
                                                        Cancel Transaction
                                                    </button>
                                                </div>
                                            )}

                                            <p className="text-xs text-slate-500 pt-1">
                                                (Payment account solution provided by Currency Cloud)
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Simulate Expiry - Demo Only */}
                                <div className="flex justify-center">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-xs text-slate-400 hover:text-red-500"
                                        onClick={() => setPaymentTimeLeft(3)}
                                    >
                                        Simulate Expiry (Demo)
                                    </Button>
                                </div>
                            </motion.div>
                        )}


                    </div>
                </div>
            </div>

            {/* Session Extend Popup */}
            <AnimatePresence>
                {showExtendPopup && (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full text-center space-y-4"
                        >
                            <div className="w-14 h-14 mx-auto rounded-full bg-amber-100 flex items-center justify-center">
                                <AlertTriangle className="w-7 h-7 text-amber-600" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900">Rate Expiring Soon</h3>
                            <p className="text-sm text-gray-600">
                                Your exchange rate will expire in <span className="font-bold text-red-600">{sessionTimeLeft}</span> seconds. Would you like to extend your session?
                            </p>
                            <div className="flex gap-3 pt-2">
                                <Button
                                    variant="outline"
                                    className="flex-1 rounded-xl"
                                    onClick={() => {
                                        setShowExtendPopup(false);
                                        setExtendDismissed(true);
                                    }}
                                >
                                    Dismiss
                                </Button>
                                <Button
                                    className="flex-1 bg-blue-600 hover:bg-blue-700 rounded-xl"
                                    onClick={() => {
                                        setSessionTimeLeft((prev) => prev + 120);
                                        setShowExtendPopup(false);
                                        setExtendDismissed(false);
                                    }}
                                >
                                    Extend 2 min
                                </Button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Promo Confirmation Popup */}
            <AnimatePresence>
                {showConfirmation && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full relative overflow-hidden"
                        >
                            <div className="absolute top-0 left-0 w-full h-2 bg-green-500" />
                            <button
                                onClick={() => setShowConfirmation(false)}
                                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
                            >
                                <X className="w-5 h-5" />
                            </button>

                            <div className="flex flex-col items-center text-center space-y-4 pt-4">
                                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center text-green-600 mb-2">
                                    <Check className="w-8 h-8" />
                                </div>
                                <h3 className="text-xl font-bold text-gray-900">Success!</h3>
                                <p className="text-gray-600 text-base">
                                    {promoApplied && useBonus
                                        ? `Your promo code and Bonus ${bonusType === 'pay_less' ? 'discount' : 'credit'} have been applied to your transaction.`
                                        : promoApplied
                                            ? "Your promo code has been applied to your transaction."
                                            : useBonus
                                                ? `Bonus ${bonusType === 'pay_less' ? 'discount' : 'credit'} has been applied to your transaction.`
                                                : "Transaction submitted successfully."
                                    }
                                </p>
                                <Button
                                    onClick={() => setShowConfirmation(false)}
                                    className="w-full bg-green-600 hover:bg-green-700 text-white mt-2"
                                >
                                    OK
                                </Button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
            {/* Manual Bank Transfer Confirmation Popup */}
            <AnimatePresence>
                {showManualTransferConfirm && (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full relative"
                        >
                            <div className="flex flex-col items-center text-center space-y-4">
                                <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center">
                                    <Building2 className="w-7 h-7 text-blue-600" />
                                </div>
                                <h3 className="text-lg font-bold text-gray-900">Confirm Payment Method</h3>
                                <p className="text-sm text-gray-600">
                                    You have selected <span className="font-semibold text-gray-900">Manual Bank Transfer. Send to our local account (Pay within 30 minutes)</span> option for payment. Do you want to proceed?
                                </p>
                                <div className="flex gap-3 w-full pt-2">
                                    <Button
                                        variant="outline"
                                        className="flex-1 rounded-xl"
                                        onClick={() => setShowManualTransferConfirm(false)}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        className="flex-1 bg-blue-600 hover:bg-blue-700 rounded-xl font-semibold text-sm"
                                        disabled={isSubmittingTransaction}
                                        onClick={async () => {
                                            setIsSubmittingTransaction(true);
                                            // Record manual transfer as the payment method — the
                                            // transaction stays awaiting_payment inside the 30-min window.
                                            if (transactionId) {
                                                try {
                                                    if (promoApplied) promo.lock();
                                                    await paySendMoneyTransaction(transactionId, "manual_transfer", promoApplied ? { code: promoCode, discount: promoDiscount } : null, useBonus ? { mode: bonusType, amount: bonusAmount } : null);
                                                } catch (e) {
                                                    if (e instanceof SendMoneyApiError && e.code.startsWith("BONUS_")) {
                                                        bonusRefused(e);
                                                        setIsSubmittingTransaction(false);
                                                        setShowManualTransferConfirm(false);
                                                        setPaymentMethod("");
                                                        return;
                                                    }
                                                    if (e instanceof SendMoneyApiError && e.code.startsWith("PROMO_")) {
                                                        promo.reject(e.message);
                                                        setIsSubmittingTransaction(false);
                                                        setShowManualTransferConfirm(false);
                                                        setPaymentMethod("");
                                                        toast({ title: "Payment not made", description: e.message, variant: "destructive" });
                                                        return;
                                                    }
                                                    console.error("Failed to record payment method", e);
                                                    const description = e instanceof SendMoneyApiError ? e.message : "We couldn't complete your payment. Please try again.";
                                                    toast({ title: "Payment not completed", description, variant: "destructive" });
                                                    setIsSubmittingTransaction(false);
                                                    setShowManualTransferConfirm(false);
                                                    setPaymentMethod("");
                                                    return;
                                                }
                                            }
                                            setIsSubmittingTransaction(false);
                                            setShowManualTransferConfirm(false);
                                            setShowBankTransferPage(true);
                                            setPaymentTimerActive(true);
                                        }}
                                    >
                                        {isSubmittingTransaction ? (
                                            <span className="flex items-center gap-2">
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Submitting Transaction...
                                            </span>
                                        ) : (
                                            "Proceed"
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Transaction Expiry Popup */}
            <AnimatePresence>
                {showExpiryPopup && (
                    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full relative"
                        >
                            <div className="flex flex-col items-center text-center space-y-4">
                                <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center">
                                    <AlertTriangle className="w-7 h-7 text-red-600" />
                                </div>
                                <h3 className="text-lg font-bold text-gray-900">Transaction Expired</h3>
                                <p className="text-sm text-gray-600">
                                    The payment time has expired. This transaction will now be <span className="font-semibold text-red-600">aborted</span>. You will be redirected to the dashboard in <span className="font-semibold text-gray-900">{expiryCountdown}s</span>.
                                </p>
                                <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                    <motion.div
                                        className="h-full bg-red-500 rounded-full"
                                        initial={{ width: "100%" }}
                                        animate={{ width: "0%" }}
                                        transition={{ duration: 5, ease: "linear" }}
                                    />
                                </div>
                                <Button
                                    className="w-full bg-red-600 hover:bg-red-700 rounded-xl font-semibold"
                                    onClick={handleExpiryRedirect}
                                >
                                    Go to Dashboard
                                </Button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            <CancelTransactionModal
                open={cancelTarget !== null}
                transaction={cancelTarget}
                onConfirm={handleCancelConfirm}
                onCancel={handleCancelModalClose}
            />

        </DashboardLayout >
    );
}
