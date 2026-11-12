import { useState, useRef, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Upload, FileText, X, Check, Copy, CheckCircle2, Send, Search,
  User, Building2, AlertCircle, Loader2, ShieldAlert, CalendarClock, Sparkles,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { knownSenders, type KnownSender } from "@/data/knownSenders";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { PayoutAccountSelector } from "@/components/payout/PayoutAccountSelector";
import type { PayoutAccountView } from "@/lib/requests";
import { DIALING_CODES } from "@/data/dialing-codes";import {
  uploadInvoiceDocument,
  confirmAndSendInvoice,
  type ConfirmInvoicePayload,
} from "@/lib/invoices";
import {
  InvoiceItemsBuilder,
  newBuilderItem,
  builderTotals,
  areItemsValid,
  itemDiscountOf,
  type BuilderItem,
  type BuilderDiscountType,
} from "@/components/invoices/InvoiceItemsBuilder";
import {
  EXPIRY_TIMEZONE,
  EXPIRY_TIMEZONE_LABEL,
  computeExpiry,
  computeInvoiceFees,
  dateInTz,
  formatHumanDate,
} from "@shared/invoice-logic";
import type { InvoiceExpiry } from "@shared/schema";

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "£",
  USD: "$",
  EUR: "€",
  NGN: "₦",
};

const EXPIRY_OPTIONS = [
  { label: "7 days", value: "7" },
  { label: "14 days", value: "14" },
  { label: "30 days", value: "30" },
  { label: "60 days", value: "60" },
  { label: "Custom date", value: "custom" },
];

type ExpiryPeriod = "7" | "14" | "30" | "60" | "custom";

interface FormData {
  invoiceFile: File | null;
  invoiceAmount: string;
  currency: string;
  absorbFee: boolean;
  recipientType: "individual" | "business";
  recipientFirstName: string;
  recipientMiddleName: string;
  recipientLastName: string;
  recipientBusinessName: string;
  recipientEmail: string;
  countryCode: string;
  recipientPhone: string;
  dueDate: string;
  expiryPeriod: ExpiryPeriod;
  customExpiryDate: string;
}

const initialFormData: FormData = {
  invoiceFile: null,
  invoiceAmount: "",
  currency: "GBP",
  absorbFee: false,
  recipientType: "individual",
  recipientFirstName: "",
  recipientMiddleName: "",
  recipientLastName: "",
  recipientBusinessName: "",
  recipientEmail: "",
  countryCode: "+44",
  recipientPhone: "",
  dueDate: "",
  expiryPeriod: "30",
  customExpiryDate: "",
};

const ALLOWED_DOC_TYPES = ["application/pdf", "image/png", "image/jpeg"];
const MAX_DOC_BYTES = 10 * 1024 * 1024;

/**
 * Two mutually exclusive ways to create an invoice: generate it on the go from
 * line items (PayPal-style), or upload a ready-made document. The active tab
 * decides which fields render and which payload is sent — the API rejects any
 * request that mixes the two.
 */
type InvoiceMode = "generate" | "upload";

interface GenerateData {
  items: BuilderItem[];
  taxRate: string;
  discountType: BuilderDiscountType;
  discountValue: string;
  notes: string;
}

const createInitialGenerateData = (): GenerateData => ({
  items: [newBuilderItem()],
  taxRate: "",
  discountType: "none",
  discountValue: "",
  notes: "",
});

export default function SendInvoice() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [mode, setMode] = useState<InvoiceMode>("generate");
  const [generateData, setGenerateData] = useState<GenerateData>(createInitialGenerateData);
  const isGenerateMode = mode === "generate";
  const handleGenerateChange = (patch: Partial<GenerateData>) =>
    setGenerateData((prev) => ({ ...prev, ...patch }));

  // Receiving payout account — same selection rules as Request Payment:
  // activated accounts only, default preselected, holder name locked to the
  // verified requester name.
  const requesterName = useMemo(() => {
    if (!user) return "John Doe";
    if (user.accountType === "business" && user.businessName) {
      return user.businessName;
    }
    const fullName = [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" ");
    return fullName || "John Doe";
  }, [user]);

  // Server-owned verified accounts (same store as Request Payment): the
  // selector fetches them, offers the identical add-and-verify dialog when
  // none exist, and lifts the selection up here.
  const [selectedPayoutAccount, setSelectedPayoutAccount] = useState<PayoutAccountView | null>(null);
  const handleSelectPayoutAccount = (account: PayoutAccountView) => setSelectedPayoutAccount(account);

  const [step, setStep] = useState<"form" | "review">("form");
  const [isSuccess, setIsSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [senderSearch, setSenderSearch] = useState("");
  const [showSenderSuggestions, setShowSenderSuggestions] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Temporary document upload — associated with the invoice only after confirmation.
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docError, setDocError] = useState("");

  const [expiryTouched, setExpiryTouched] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdInvoice, setCreatedInvoice] = useState<{ invoiceNumber: string; paymentLink: string } | null>(null);

  // One idempotency key per journey — duplicate confirmations never create
  // duplicate invoices (double-click, browser retry, repeated API call).
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const senderEmail = params.get("sender");
    if (senderEmail) {
      const sender = knownSenders.find(s => s.email === senderEmail);
      if (sender) {
        setFormData(prev => ({
          ...prev,
          recipientType: sender.senderType,
          recipientFirstName: sender.firstName,
          recipientMiddleName: sender.middleName,
          recipientLastName: sender.lastName,
          recipientBusinessName: sender.businessName,
          recipientEmail: sender.email,
          countryCode: sender.countryCode,
          recipientPhone: sender.phone,
        }));
      }
    }
  }, []);

  // Default expiry selection: 7 days after Due Date, or 30 days after the sent
  // date — until the sender makes an explicit choice.
  useEffect(() => {
    if (!expiryTouched) {
      setFormData(prev => ({ ...prev, expiryPeriod: prev.dueDate ? "7" : "30" }));
    }
  }, [formData.dueDate, expiryTouched]);

  // Baseline for dirty-checking the generate tab (its default item row carries
  // a fresh random id per journey).
  const [generateInitialState, setGenerateInitialState] = useState(createInitialGenerateData);

  const isDirty =
    JSON.stringify(formData) !== JSON.stringify(initialFormData) || documentId !== null ||
    JSON.stringify(generateData) !== JSON.stringify(generateInitialState);

  // Unsaved-change warning for the incomplete journey (refresh / close / leave).
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isSuccess && isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty, isSuccess]);

  const filteredSenders = knownSenders.filter(sender => {
    const displayName = sender.senderType === "business"
      ? sender.businessName.toLowerCase()
      : `${sender.firstName} ${sender.middleName} ${sender.lastName}`.toLowerCase();
    const searchLower = senderSearch.toLowerCase();
    return displayName.includes(searchLower) || sender.email.toLowerCase().includes(searchLower);
  });

  const selectKnownSender = (sender: KnownSender) => {
    setFormData(prev => ({
      ...prev,
      recipientType: sender.senderType,
      recipientFirstName: sender.firstName,
      recipientMiddleName: sender.middleName,
      recipientLastName: sender.lastName,
      recipientBusinessName: sender.businessName,
      recipientEmail: sender.email,
      countryCode: sender.countryCode,
      recipientPhone: sender.phone,
    }));
    setSenderSearch("");
    setShowSenderSuggestions(false);
  };

  const handleInputChange = (field: keyof FormData, value: any) => {
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
  // Computed live so problems surface as the sender types, not only on submit.
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

  const handleFileChange = async (file: File | null) => {
    setDocError("");
    setDocumentId(null);

    if (!file) {
      setFormData((prev) => ({ ...prev, invoiceFile: null }));
      return;
    }

    if (!ALLOWED_DOC_TYPES.includes(file.type)) {
      setDocError("The invoice document must be a PDF, PNG or JPG file.");
      return;
    }
    if (file.size > MAX_DOC_BYTES) {
      setDocError("The invoice document must be 10MB or smaller.");
      return;
    }

    setFormData((prev) => ({ ...prev, invoiceFile: file }));
    setUploadingDoc(true);
    try {
      const id = await uploadInvoiceDocument(file);
      setDocumentId(id);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : "The document could not be uploaded.");
      setFormData((prev) => ({ ...prev, invoiceFile: null }));
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleCopyLink = () => {
    if (!createdInvoice) return;
    navigator.clipboard.writeText(createdInvoice.paymentLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Generated-invoice totals — live, shared authoritative math.
  const generateTotals = useMemo(
    () => builderTotals(generateData.items, generateData.taxRate, generateData.discountType, generateData.discountValue),
    [generateData],
  );
  const parsePositive = (value: string): number => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const generateExtrasInvalid =
    (generateData.taxRate.trim() !== "" &&
      (parsePositive(generateData.taxRate) <= 0 || parsePositive(generateData.taxRate) > 100)) ||
    (generateData.discountType !== "none" &&
      (generateData.discountValue.trim() === "" ||
        parsePositive(generateData.discountValue) <= 0 ||
        (generateData.discountType === "percent" && parsePositive(generateData.discountValue) > 100)));
  const generateValid =
    areItemsValid(generateData.items) && generateTotals.total > 0 && !generateExtrasInvalid;

  // The effective invoice amount: the computed total when generating, the manual
  // amount when uploading. Feeds the fee model and the summary card in both modes.
  const effectiveAmount = isGenerateMode ? String(generateTotals.total) : formData.invoiceAmount;
  const fees = computeInvoiceFees(effectiveAmount || "0", formData.absorbFee);
  const sym = CURRENCY_SYMBOLS[formData.currency] || "£";
  const payoutCurrencyMismatch = Boolean(
    selectedPayoutAccount && selectedPayoutAccount.currency !== formData.currency,
  );
  const clientDisplayName = formData.recipientType === "business"
    ? formData.recipientBusinessName
    : [formData.recipientFirstName, formData.recipientMiddleName, formData.recipientLastName].filter(Boolean).join(" ");

  const canReview = Boolean(
    selectedPayoutAccount &&
    (isGenerateMode
      ? generateValid
      : documentId && formData.invoiceAmount && parseFloat(formData.invoiceAmount) > 0) &&
    formData.recipientEmail &&
    (formData.recipientType === "individual" ? formData.recipientFirstName : formData.recipientBusinessName) &&
    Object.keys(dateErrors).length === 0
  );

  const handleReview = () => {
    if (Object.keys(dateErrors).length > 0) return;
    setStep("review");
  };

  const handleBackToEdit = () => {
    setStep("form");
  };

  const resetJourney = () => {
    setFormData(initialFormData);
    setDocumentId(null);
    setDocError("");
    setStep("form");
    setIsSuccess(false);
    setCreatedInvoice(null);
    setExpiryTouched(false);
    setGenerateData(createInitialGenerateData());
    setGenerateInitialState(createInitialGenerateData());
    idempotencyKeyRef.current = crypto.randomUUID();
  };

  const handleConfirmAndSend = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      // Revalidated end-to-end on the backend (authoritative).
      const commonPayload = {
        currency: formData.currency,
        absorbFee: formData.absorbFee,
        payoutAccountId: selectedPayoutAccount!.id,
        clientType: formData.recipientType,
        clientFirstName: formData.recipientFirstName || undefined,
        clientMiddleName: formData.recipientMiddleName || undefined,
        clientLastName: formData.recipientLastName || undefined,
        clientBusinessName: formData.recipientBusinessName || undefined,
        clientEmail: formData.recipientEmail,
        clientPhoneCode: formData.countryCode,
        clientPhoneNumber: formData.recipientPhone || undefined,
        dueDate: formData.dueDate || undefined,
        expiry: expirySelection,
        idempotencyKey: idempotencyKeyRef.current,
      };

      // The active mode decides the payload — a generated invoice carries line
      // items and no document, an uploaded invoice the reverse (never both).
      const payload: ConfirmInvoicePayload = isGenerateMode
        ? {
            source: "generated",
            items: generateData.items.map((item) => ({
              name: item.name.trim(),
              description: item.description.trim() || undefined,
              quantity: parseFloat(item.quantity),
              unitAmount: parseFloat(item.unitAmount),
              ...(item.discountType !== "none"
                ? { discountType: item.discountType, discountValue: parseFloat(item.discountValue) }
                : {}),
            })),
            ...(generateData.taxRate.trim()
              ? { taxRate: parseFloat(generateData.taxRate) }
              : {}),
            ...(generateData.discountType !== "none"
              ? {
                  discountType: generateData.discountType,
                  discountValue: parseFloat(generateData.discountValue),
                }
              : {}),
            ...(generateData.notes.trim() ? { notes: generateData.notes.trim() } : {}),
            ...commonPayload,
          }
        : {
            documentId: documentId!,
            invoiceAmount: formData.invoiceAmount,
            ...commonPayload,
          };

      const result = await confirmAndSendInvoice(payload);
      setCreatedInvoice({
        invoiceNumber: result.invoice.invoiceNumber,
        paymentLink: result.paymentLink,
      });
      setIsSuccess(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      // A temp document that expired (long-open form) or was lost to a server
      // restart must be re-attached — clear the stale "Attached" chip so the
      // failure is obvious and fixable instead of mysterious.
      if (/document/i.test(message)) {
        setDocumentId(null);
        setFormData((prev) => ({ ...prev, invoiceFile: null }));
        setDocError(message);
      }
      toast({
        title: "Invoice not sent",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  /** In-app navigation away from a dirty form discards everything — confirm first. */
  const confirmDiscard = (): boolean => {
    if (!isDirty) return true;
    return window.confirm("Discard this invoice? Information you have entered will be lost.");
  };

  // ─── Success screen ─────────────────────────────────────────────────────────

  if (isSuccess && createdInvoice) {
    return (
      <DashboardLayout>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-lg mx-auto mt-12"
        >
          <Card className="text-center">
            <CardContent className="pt-12 pb-8 space-y-6">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
                className="w-20 h-20 bg-primary rounded-full flex items-center justify-center mx-auto"
              >
                <CheckCircle2 className="w-10 h-10 text-white" />
              </motion.div>

              <div className="space-y-2">
                <h2 className="text-2xl font-bold font-display">Invoice Sent!</h2>
                <p className="text-sm text-muted-foreground">
                  Invoice <span className="font-semibold text-foreground">{createdInvoice.invoiceNumber}</span> and its
                  payment link have been emailed to{" "}
                  <span className="font-semibold text-foreground">{formData.recipientEmail}</span> for{" "}
                  <span className="font-semibold text-foreground">{clientDisplayName}</span>.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="text-xs text-muted-foreground">You can also share this invoice link directly:</p>
                <div className="flex items-center gap-2">
                  <Input
                    value={createdInvoice.paymentLink}
                    readOnly
                    className="text-sm bg-white"
                    data-testid="input-invoice-link"
                  />
                  <Button
                    onClick={handleCopyLink}
                    variant="outline"
                    className="shrink-0"
                    data-testid="button-copy-link"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setLocation("/")}
                  data-testid="button-back-to-dashboard"
                >
                  Back to Dashboard
                </Button>
                <Button
                  className="flex-1 bg-primary hover:bg-primary/90"
                  onClick={resetJourney}
                  data-testid="button-new-invoice"
                >
                  New Invoice
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </DashboardLayout>
    );
  }

  // ─── Review and Confirm ─────────────────────────────────────────────────────

  if (step === "review") {
    const rows: Array<{ label: string; value: React.ReactNode; testId: string }> = [
      ...(isGenerateMode
        ? [
            {
              label: "Invoice Items",
              value: `${generateData.items.length} item${generateData.items.length === 1 ? "" : "s"}`,
              testId: "review-items",
            },
            {
              label: "Subtotal",
              value: `${sym}${generateTotals.subtotal.toFixed(2)} ${formData.currency}`,
              testId: "review-subtotal",
            },
            ...(generateTotals.itemsDiscountTotal > 0
              ? [{
                  label: "Items Discount",
                  value: `-${sym}${generateTotals.itemsDiscountTotal.toFixed(2)} ${formData.currency}`,
                  testId: "review-items-discount",
                }]
              : []),
            ...(generateTotals.discountAmount > 0
              ? [{
                  label: `Discount${generateData.discountType === "percent" && generateData.discountValue ? ` (${generateData.discountValue}%)` : ""}`,
                  value: `-${sym}${generateTotals.discountAmount.toFixed(2)} ${formData.currency}`,
                  testId: "review-discount",
                }]
              : []),
            ...(generateTotals.taxAmount > 0
              ? [{
                  label: `Tax (${generateData.taxRate}%)`,
                  value: `${sym}${generateTotals.taxAmount.toFixed(2)} ${formData.currency}`,
                  testId: "review-tax",
                }]
              : []),
            {
              label: "Invoice Amount",
              value: `${sym}${generateTotals.total.toFixed(2)} ${formData.currency}`,
              testId: "review-amount",
            },
          ]
        : [
            {
              label: "Invoice Document",
              value: formData.invoiceFile?.name ?? "—",
              testId: "review-document",
            },
            {
              label: "Invoice Amount",
              value: `${sym}${fees.invoiceAmount.toFixed(2)} ${formData.currency}`,
              testId: "review-amount",
            },
          ]),
      ...(payoutCurrencyMismatch
        ? [{
            label: "FX Conversion",
            value:
              `Invoice in ${formData.currency}, paid out in ${selectedPayoutAccount?.currency} — ` +
              "converted at live FX spot rates when the payment is completed",
            testId: "review-fx-conversion",
          }]
        : []),
      {
        label: "Fee Treatment",
        value: formData.absorbFee
          ? "You absorb the 3% transaction fee"
          : "3% transaction fee added to the client's payment",
        testId: "review-fee-treatment",
      },
      {
        label: "Receiving Settlement Bank Account",
        value: selectedPayoutAccount
          ? `${selectedPayoutAccount.bankName} (${selectedPayoutAccount.maskedNumber}) • ${selectedPayoutAccount.holderName} • ${selectedPayoutAccount.currency}`
          : "—",
        testId: "review-payout-account",
      },
      {
        label: "Client Type",
        value: formData.recipientType === "business" ? "Business" : "Individual",
        testId: "review-client-type",
      },
      {
        label: "Client Name",
        value: clientDisplayName || "—",
        testId: "review-client-name",
      },
      {
        label: "Client Email",
        value: formData.recipientEmail,
        testId: "review-client-email",
      },
      {
        label: "Client Phone",
        value: formData.recipientPhone ? `${formData.countryCode} ${formData.recipientPhone}` : "Not provided",
        testId: "review-client-phone",
      },
      {
        label: "Due Date",
        value: formData.dueDate ? formatHumanDate(formData.dueDate) : "No due date",
        testId: "review-due-date",
      },
      {
        label: "Payment Link Expiry Date",
        value: `${formatHumanDate(computedExpiry!.expiryDate)} at 11:59 p.m. ${EXPIRY_TIMEZONE_LABEL} (${computedExpiry!.expiryDate})`,
        testId: "review-expiry-date",
      },
      {
        label: "Amount the Client Will Pay",
        value: `${sym}${fees.clientPays.toFixed(2)}`,
        testId: "review-client-pays",
      },
      {
        label: "Amount You Will Receive",
        value: `${sym}${fees.senderReceives.toFixed(2)}`,
        testId: "review-you-receive",
      },
      {
        label: "Applicable Fees (3%)",
        value: `${sym}${fees.fee.toFixed(2)}${formData.absorbFee ? " (absorbed by you)" : " (added to client)"}`,
        testId: "review-fees",
      },
    ];

    return (
      <DashboardLayout>
        <div className="max-w-4xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <Button
              variant="ghost"
              onClick={handleBackToEdit}
              className="mb-4 -ml-2"
              data-testid="button-review-back"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <h1 className="text-2xl font-bold font-display">Review and Confirm</h1>
            <p className="text-muted-foreground mt-1">Check every detail before the invoice is generated</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card>
              <CardHeader>
                <CardTitle className="font-display">Invoice Summary</CardTitle>
                <CardDescription>The invoice has not been created yet — nothing is saved until you confirm</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {isGenerateMode && (
                  <div className="rounded-xl border border-border overflow-hidden" data-testid="review-items-table">
                    <div className="px-4 py-3 bg-muted/50 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Invoice Items
                    </div>
                    <div className="divide-y divide-border">
                      {generateData.items.map((item, index) => (
                        <div key={item.id} className="flex items-start justify-between gap-4 px-4 py-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                            {item.description && (
                              <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                            )}
                            <p className="text-xs text-muted-foreground mt-1">
                              {item.quantity} × {sym}{parseFloat(item.unitAmount || "0").toFixed(2)}
                            </p>
                            {itemDiscountOf(item) > 0 && (
                              <p className="text-xs font-medium text-teal mt-0.5" data-testid={`review-item-discount-${index}`}>
                                Discount: -{sym}{itemDiscountOf(item).toFixed(2)}
                              </p>
                            )}
                          </div>
                          <p className="text-sm font-semibold text-foreground shrink-0" data-testid={`review-item-amount-${index}`}>
                            {sym}
                            {(Math.round(parseFloat(item.quantity || "0") * parseFloat(item.unitAmount || "0") * 100) / 100).toFixed(2)}{" "}
                            {formData.currency}
                          </p>
                        </div>
                      ))}
                      {generateData.notes.trim() && (
                        <div className="px-4 py-3 bg-muted/30">
                          <p className="text-xs font-semibold text-muted-foreground mb-1">Notes to Client</p>
                          <p className="text-sm text-foreground whitespace-pre-wrap">{generateData.notes.trim()}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl" data-testid="alert-immutability-warning">
                  <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-900 leading-relaxed">
                    Please review the invoice carefully. Once sent, the invoice details, Due Date and Payment Link
                    Expiry Date cannot be changed. If any information is incorrect after sending, you must cancel
                    this invoice and create a new one.
                  </p>
                </div>

                <div className="rounded-xl border border-border divide-y divide-border" data-testid="invoice-review-summary">
                  {rows.map((row) => (
                    <div key={row.testId} className="flex justify-between gap-4 px-4 py-3 text-sm">
                      <span className="text-muted-foreground shrink-0">{row.label}:</span>
                      <span className="font-medium text-right" data-testid={row.testId}>{row.value}</span>
                    </div>
                  ))}
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={handleBackToEdit}
                    data-testid="button-back-to-edit"
                  >
                    Back to Edit
                  </Button>
                  <Button
                    onClick={handleConfirmAndSend}
                    disabled={isSubmitting}
                    className="flex-1 bg-primary hover:bg-primary/90"
                    data-testid="button-confirm-send-invoice"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Confirm and Send Invoice
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </DashboardLayout>
    );
  }

  // ─── Form ───────────────────────────────────────────────────────────────────

  const today = dateInTz(new Date(), EXPIRY_TIMEZONE);

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <Button
            variant="ghost"
            onClick={() => { if (confirmDiscard()) setLocation("/"); }}
            className="mb-4 -ml-2"
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>

          <h1 className="text-2xl font-bold font-display">Send Invoice</h1>
          <p className="text-muted-foreground mt-1">
            {isGenerateMode
              ? "Create a professional invoice on the go and send it to your client"
              : "Upload an invoice and send it to your client"}
          </p>

          {/* Mode cards — generate on the go OR upload a document, never both */}
          <div
            className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3"
            role="tablist"
            aria-label="Invoice creation mode"
            data-testid="invoice-mode-tabs"
          >
            {([
              {
                id: "generate" as const,
                testId: "tab-generate-invoice",
                icon: Sparkles,
                title: "Generate Invoice",
                description: "Build line items on the go — items, discount and tax, totalled for you.",
              },
              {
                id: "upload" as const,
                testId: "tab-upload-document",
                icon: Upload,
                title: "Upload Document",
                description: "Attach a ready PDF, PNG or JPG invoice and send it to your client.",
              },
            ]).map((option) => {
              const active = mode === option.id;
              const Icon = option.icon;
              return (
                <motion.button
                  key={option.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.985 }}
                  onClick={() => setMode(option.id)}
                  className={`group relative text-left rounded-2xl p-[1.5px] transition-all duration-200 ${
                    active
                      ? "bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg shadow-primary/25"
                      : "bg-border hover:bg-slate-300"
                  }`}
                  data-testid={option.testId}
                >
                  <div
                    className={`flex items-start gap-3.5 rounded-[calc(1rem-1.5px)] p-4 h-full transition-all duration-200 ${
                      active
                        ? "bg-gradient-to-br from-blue-50 via-white to-indigo-50"
                        : "bg-white group-hover:bg-slate-50"
                    }`}
                  >
                    <div
                      className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-all duration-200 ${
                        active
                          ? "bg-gradient-to-br from-blue-600 to-indigo-600 shadow-md shadow-primary/30"
                          : "bg-slate-100 group-hover:bg-slate-200"
                      }`}
                    >
                      <Icon
                        className={`w-5 h-5 transition-colors duration-200 ${
                          active ? "text-white" : "text-slate-500 group-hover:text-slate-700"
                        }`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm font-bold transition-colors duration-200 ${
                          active ? "text-primary" : "text-slate-800"
                        }`}
                      >
                        {option.title}
                      </p>
                      <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                        {option.description}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5 transition-all duration-200 ${
                        active
                          ? "bg-gradient-to-br from-blue-600 to-indigo-600 scale-100 opacity-100"
                          : "bg-slate-200 scale-75 opacity-0"
                      }`}
                    >
                      <Check className="w-3 h-3 text-white" strokeWidth={3} />
                    </span>
                  </div>
                </motion.button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-3" data-testid="text-mode-hint">
            Generate an invoice on the go with line items, or attach a ready-made document — you can do one or the other, not both.
          </p>
        </motion.div>

        <Card>
          <CardHeader>
            <CardTitle className="font-display">Invoice Details</CardTitle>
            <CardDescription>
              {isGenerateMode
                ? "Build your invoice items and enter payment details"
                : "Upload your invoice and enter payment details"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <div className="lg:col-span-3 space-y-6">
                {/* Receiving Payout Account (same flow as Request Payment) */}
                <PayoutAccountSelector
                  requesterName={requesterName}
                  selectedAccountId={selectedPayoutAccount?.id ?? ""}
                  onSelect={handleSelectPayoutAccount}
                  context="invoice"
                />

                {/* Payout FX notice — same transparency as Request Payment */}
                {payoutCurrencyMismatch && (
                  <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl" data-testid="fx-conversion-notice">
                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-900 leading-relaxed">
                      Your settlement bank account is in <strong>{selectedPayoutAccount?.currency}</strong>, but this invoice
                      is in <strong>{formData.currency}</strong>. The payout amount will be converted to{" "}
                      {selectedPayoutAccount?.currency} at live FX spot rates when the payment is completed.
                    </p>
                  </div>
                )}

                {/* Currency comes first in generate mode — items are priced in the selected currency */}
                {isGenerateMode && (
                  <div className="space-y-2">
                    <Label htmlFor="currency">Currency</Label>
                    <Select
                      value={formData.currency}
                      onValueChange={(value) => handleInputChange("currency", value)}
                    >
                      <SelectTrigger data-testid="select-currency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GBP">GBP (£)</SelectItem>
                        <SelectItem value="USD">USD ($)</SelectItem>
                        <SelectItem value="EUR">EUR (€)</SelectItem>
                        <SelectItem value="NGN">NGN (₦)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {isGenerateMode ? (
                  <InvoiceItemsBuilder
                    currency={formData.currency}
                    currencySymbol={sym}
                    items={generateData.items}
                    onItemsChange={(items) => handleGenerateChange({ items })}
                    taxRate={generateData.taxRate}
                    onTaxRateChange={(taxRate) => handleGenerateChange({ taxRate })}
                    discountType={generateData.discountType}
                    onDiscountTypeChange={(discountType) => handleGenerateChange({ discountType })}
                    discountValue={generateData.discountValue}
                    onDiscountValueChange={(discountValue) => handleGenerateChange({ discountValue })}
                    notes={generateData.notes}
                    onNotesChange={(notes) => handleGenerateChange({ notes })}
                  />
                ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold text-foreground">
                      Invoice Document <span className="text-destructive">*</span>
                    </Label>
                    <span className="text-xs font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
                      Mandatory
                    </span>
                  </div>

                  <div
                    className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                      dragActive
                        ? "border-primary bg-primary/5"
                        : !formData.invoiceFile
                        ? "border-slate-300 hover:border-primary/50 bg-slate-50/50"
                        : "border-primary/40 bg-primary/5"
                    }`}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                  >
                    {formData.invoiceFile ? (
                      <div className="flex items-center justify-center gap-4">
                        <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                          <FileText className="w-6 h-6 text-primary" />
                        </div>
                        <div className="text-left">
                          <p className="font-medium text-sm text-foreground">{formData.invoiceFile.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {(formData.invoiceFile.size / 1024).toFixed(1)} KB •{" "}
                            {uploadingDoc ? "Uploading…" : documentId ? "Attached" : "Processing…"}
                          </p>
                        </div>
                        {uploadingDoc ? (
                          <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleFileChange(null)}
                            data-testid="button-remove-file"
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    ) : (
                      <>
                        <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                        <p className="font-medium text-sm text-slate-800 mb-1">
                          Drag and drop your invoice here <span className="text-destructive">*</span>
                        </p>
                        <p className="text-xs text-muted-foreground mb-4">PDF, PNG, or JPG up to 10MB (Mandatory)</p>
                        <Button
                          variant="outline"
                          onClick={() => fileInputRef.current?.click()}
                          data-testid="button-browse-files"
                          className="bg-white shadow-sm"
                        >
                          Browse Files
                        </Button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg"
                          className="hidden"
                          onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
                        />
                      </>
                    )}
                  </div>
                  {docError ? (
                    <p className="text-[11px] text-destructive flex items-center gap-1.5 pt-0.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {docError}
                    </p>
                  ) : !formData.invoiceFile ? (
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-0.5">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      An invoice document must be attached before sending.
                    </p>
                  ) : null}
                </div>
                )}

                {!isGenerateMode && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="invoiceAmount">Invoice Amount *</Label>
                      <Input
                        id="invoiceAmount"
                        type="number"
                        placeholder="0.00"
                        value={formData.invoiceAmount}
                        onChange={(e) => handleInputChange("invoiceAmount", e.target.value)}
                        data-testid="input-invoice-amount"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="currency">Currency</Label>
                      <Select
                        value={formData.currency}
                        onValueChange={(value) => handleInputChange("currency", value)}
                      >
                        <SelectTrigger data-testid="select-currency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="GBP">GBP (£)</SelectItem>
                          <SelectItem value="USD">USD ($)</SelectItem>
                          <SelectItem value="EUR">EUR (€)</SelectItem>
                          <SelectItem value="NGN">NGN (₦)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* Fee Absorption Checkbox */}
                <div className="flex items-start space-x-3 p-4 bg-slate-50 border border-slate-200 rounded-xl hover:border-slate-300 transition-colors">
                  <Checkbox
                    id="absorbFee"
                    checked={formData.absorbFee}
                    onCheckedChange={(checked) => handleInputChange("absorbFee", checked === true)}
                    data-testid="checkbox-absorb-fee"
                    className="mt-0.5"
                  />
                  <div className="grid gap-1 leading-none cursor-pointer" onClick={() => handleInputChange("absorbFee", !formData.absorbFee)}>
                    <Label
                      htmlFor="absorbFee"
                      className="text-sm font-semibold cursor-pointer text-slate-900"
                    >
                      Absorb the 3% transaction fee
                    </Label>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      The client pays the exact invoice amount requested ({sym}
                      {fees.invoiceAmount > 0 ? fees.invoiceAmount.toFixed(2) : "0.00"}), and the 3% fee is deducted from your received balance.
                    </p>
                  </div>
                </div>

                <div className="space-y-2 relative">
                  <Label>Search Existing Recipient</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      ref={searchInputRef}
                      placeholder="Type name or email to search..."
                      value={senderSearch}
                      onChange={(e) => {
                        setSenderSearch(e.target.value);
                        setShowSenderSuggestions(true);
                      }}
                      onFocus={() => setShowSenderSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowSenderSuggestions(false), 150)}
                      className="pl-9 bg-primary/5 border-primary/20"
                      data-testid="input-recipient-search"
                      autoComplete="off"
                    />
                  </div>
                  <AnimatePresence>
                    {showSenderSuggestions && senderSearch && filteredSenders.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute z-50 w-full mt-1 bg-white border border-border rounded-lg shadow-lg max-h-56 overflow-auto"
                      >
                        {filteredSenders.map((sender) => (
                          <button
                            key={sender.email}
                            type="button"
                            className="w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors flex items-center gap-3 border-b last:border-b-0"
                            onClick={() => selectKnownSender(sender)}
                            data-testid={`suggestion-recipient-${sender.email.replace(/[@.]/g, '-')}`}
                          >
                            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                              {sender.senderType === "business" ? (
                                <Building2 className="w-5 h-5 text-primary" />
                              ) : (
                                <User className="w-5 h-5 text-primary" />
                              )}
                            </div>
                            <div>
                              <p className="font-medium text-sm">
                                {sender.senderType === "business"
                                  ? sender.businessName
                                  : `${sender.firstName} ${sender.middleName} ${sender.lastName}`.trim()}
                              </p>
                              <p className="text-xs text-muted-foreground">{sender.email}</p>
                            </div>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <p className="text-xs text-muted-foreground">Select an existing recipient or enter new details below</p>
                </div>

                <div className="h-px bg-border" />

                <div className="space-y-2">
                  <Label>Recipient Type *</Label>
                  <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                    <button
                      type="button"
                      onClick={() => handleInputChange("recipientType", "individual")}
                      className={`flex-1 flex items-center justify-center sm:justify-start gap-3 p-3.5 sm:p-4 rounded-xl border-2 transition-all ${formData.recipientType === "individual"
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-muted-foreground/30"
                        }`}
                      data-testid="button-recipient-type-individual"
                    >
                      <User className={`w-5 h-5 ${formData.recipientType === "individual" ? "text-primary" : "text-muted-foreground"}`} />
                      <span className={`font-medium ${formData.recipientType === "individual" ? "text-primary font-semibold" : ""}`}>Individual</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInputChange("recipientType", "business")}
                      className={`flex-1 flex items-center justify-center sm:justify-start gap-3 p-3.5 sm:p-4 rounded-xl border-2 transition-all ${formData.recipientType === "business"
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-muted-foreground/30"
                        }`}
                      data-testid="button-recipient-type-business"
                    >
                      <Building2 className={`w-5 h-5 ${formData.recipientType === "business" ? "text-primary" : "text-muted-foreground"}`} />
                      <span className={`font-medium ${formData.recipientType === "business" ? "text-primary font-semibold" : ""}`}>Business</span>
                    </button>
                  </div>
                </div>

                {formData.recipientType === "individual" ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="recipientFirstName">First Name *</Label>
                      <Input
                        id="recipientFirstName"
                        placeholder="First name"
                        value={formData.recipientFirstName}
                        onChange={(e) => handleInputChange("recipientFirstName", e.target.value)}
                        data-testid="input-recipient-first-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="recipientMiddleName">Middle Name</Label>
                      <Input
                        id="recipientMiddleName"
                        placeholder="Middle name"
                        value={formData.recipientMiddleName}
                        onChange={(e) => handleInputChange("recipientMiddleName", e.target.value)}
                        data-testid="input-recipient-middle-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="recipientLastName">Last Name</Label>
                      <Input
                        id="recipientLastName"
                        placeholder="Last name"
                        value={formData.recipientLastName}
                        onChange={(e) => handleInputChange("recipientLastName", e.target.value)}
                        data-testid="input-recipient-last-name"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="recipientBusinessName">Business Name *</Label>
                    <Input
                      id="recipientBusinessName"
                      placeholder="Enter business name"
                      value={formData.recipientBusinessName}
                      onChange={(e) => handleInputChange("recipientBusinessName", e.target.value)}
                      data-testid="input-recipient-business-name"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="recipientEmail">Recipient Email *</Label>
                  <Input
                    id="recipientEmail"
                    type="email"
                    placeholder="Where to send the invoice"
                    value={formData.recipientEmail}
                    onChange={(e) => handleInputChange("recipientEmail", e.target.value)}
                    data-testid="input-recipient-email"
                  />
                </div>

                {/* Payment Link Expiry */}
                <div className="space-y-2">
                  <Label htmlFor="expiryPeriod">Payment Link Expiry *</Label>
                  <Select
                    value={formData.expiryPeriod}
                    onValueChange={(value) => {
                      setExpiryTouched(true);
                      handleInputChange("expiryPeriod", value as ExpiryPeriod);
                    }}
                  >
                    <SelectTrigger data-testid="select-expiry-period">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPIRY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    After this date, your client will no longer be able to start a payment using this link.
                  </p>

                  {formData.expiryPeriod === "custom" && (
                    <div className="space-y-2 pt-1">
                      <Label htmlFor="customExpiryDate">Expiry Date</Label>
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
                      This payment link will expire on {formatHumanDate(computedExpiry.expiryDate)} at 11:59 p.m.{" "}
                      {EXPIRY_TIMEZONE_LABEL}.
                    </p>
                  )}
                  {dateErrors.expiry && (
                    <p className="text-xs text-destructive" data-testid="error-expiry">{dateErrors.expiry}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="recipientPhone">Recipient Phone (Optional)</Label>
                  <div className="flex gap-2">
                    <Select
                      value={formData.countryCode}
                      onValueChange={(value) => handleInputChange("countryCode", value)}
                    >
                      <SelectTrigger className="w-28 sm:w-36 shrink-0" data-testid="select-country-code">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {DIALING_CODES.map((country) => (
                          <SelectItem key={country.value} value={country.value}>
                            {country.flag} {country.code} {country.country}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      id="recipientPhone"
                      type="tel"
                      placeholder="Mobile number"
                      value={formData.recipientPhone}
                      onChange={(e) => handleInputChange("recipientPhone", e.target.value)}
                      className="flex-1"
                      data-testid="input-recipient-phone"
                    />
                  </div>
                </div>

                {/* Due Date */}
                <div className="space-y-2">
                  <Label htmlFor="dueDate">Due Date (Optional)</Label>
                  <Input
                    id="dueDate"
                    type="date"
                    min={today}
                    value={formData.dueDate}
                    onChange={(e) => handleDueDateChange(e.target.value)}
                    data-testid="input-due-date"
                  />
                  <p className="text-xs text-muted-foreground">
                    The date by which you expect the client to make payment. Payment may still be made after this
                    date until the payment link expires.
                  </p>
                  {dateErrors.dueDate && (
                    <p className="text-xs text-destructive" data-testid="error-due-date">{dateErrors.dueDate}</p>
                  )}
                </div>

                <div className="flex gap-3 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => { if (confirmDiscard()) setLocation("/"); }}
                    className="flex-1"
                    data-testid="button-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleReview}
                    disabled={!canReview || uploadingDoc}
                    className="flex-1 bg-primary hover:bg-primary/90"
                    data-testid="button-review-invoice"
                  >
                    <Send className="w-4 h-4 mr-2" />
                    Review Invoice
                  </Button>
                </div>
              </div>

              <div className="lg:col-span-2 lg:self-start lg:sticky lg:top-24">
                <div className="border-2 border-primary/20 rounded-xl p-5 space-y-4 bg-white shadow-sm" data-testid="fee-breakdown">
                  <h3 className="font-semibold text-lg text-slate-900">Amount Summary</h3>

                  <div className="space-y-3">
                    {isGenerateMode && (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Items Subtotal:</span>
                          <span className="font-medium text-slate-800">
                            {sym}{generateTotals.subtotal.toFixed(2)}
                          </span>
                        </div>
                        {generateTotals.itemsDiscountTotal > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Items Discount:</span>
                            <span className="font-medium text-teal">
                              -{sym}{generateTotals.itemsDiscountTotal.toFixed(2)}
                            </span>
                          </div>
                        )}
                        {generateTotals.discountAmount > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Discount:</span>
                            <span className="font-medium text-teal">
                              -{sym}{generateTotals.discountAmount.toFixed(2)}
                            </span>
                          </div>
                        )}
                        {generateTotals.taxAmount > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Tax ({generateData.taxRate}%):</span>
                            <span className="font-medium text-slate-800">
                              +{sym}{generateTotals.taxAmount.toFixed(2)}
                            </span>
                          </div>
                        )}
                      </>
                    )}

                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Invoice Amount:</span>
                      <span className="font-medium text-slate-800">
                        {sym}{fees.invoiceAmount.toFixed(2)}
                      </span>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Fee (3%{formData.absorbFee ? " absorbed by you" : " added to client"}):
                      </span>
                      <span className={`font-medium ${formData.absorbFee ? "text-red-600" : "text-slate-800"}`}>
                        {formData.absorbFee ? "-" : "+"}{sym}{fees.fee.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {payoutCurrencyMismatch && (
                    <div className="flex items-center justify-between text-xs bg-amber-50 p-2.5 rounded-lg border border-amber-200 text-amber-900">
                      <span className="font-medium">FX Conversion:</span>
                      <span className="font-semibold">Live Spot Rate at Payout</span>
                    </div>
                  )}

                  <div className="h-px bg-border" />

                  <div className="flex justify-between pt-1 items-baseline">
                    <span className="font-medium text-slate-800">Client Pays:</span>
                    <span className="font-bold text-lg text-teal">
                      {sym}{fees.clientPays.toFixed(2)}
                    </span>
                  </div>

                  <div className="flex justify-between items-center bg-primary/5 -mx-5 px-5 py-3.5 -mb-5 rounded-b-xl border-t border-primary/10">
                    <div>
                      <span className="font-medium text-slate-900">You Receive:</span>
                      {formData.absorbFee && (
                        <p className="text-[10px] text-muted-foreground">Fee deducted from balance</p>
                      )}
                      {selectedPayoutAccount && (
                        <p className="text-[10px] text-muted-foreground">
                          Deposited to {selectedPayoutAccount.bankName} ({selectedPayoutAccount.currency})
                        </p>
                      )}
                    </div>
                    <span className="font-bold text-lg text-primary">
                      {sym}{fees.senderReceives.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
