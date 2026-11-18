import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Copy,
  Landmark,
  Loader2,
  Pencil,
  Send,
  ShieldCheck,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  computeBeneficiaryInitials,
  countryFlagCode,
  isSyntheticBeneficiaryEmail,
  resolveMergedBeneficiary,
} from "@/components/beneficiary";
import { useContacts } from "@/contexts/ContactsContext";
import { useToast } from "@/hooks/use-toast";
import { serviceTypeStyle } from "@/lib/recipients";
import {
  deleteMitoBeneficiaryById,
  fetchMitoBeneficiaries,
  type MitoBeneficiaryItem,
} from "@/lib/sendMoney";

function formatDetailDate(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return isoDate || "—";
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function InfoField({
  label,
  value,
  mono = false,
  testId,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  testId?: string;
}) {
  const display = value && String(value).trim() ? String(value).trim() : "—";
  return (
    <div className="py-2.5 flex items-start justify-between gap-4 text-sm">
      <span className="text-[#605E5C] shrink-0">{label}</span>
      <span
        data-testid={testId}
        className={`text-right font-medium text-[#111827] break-all ${
          mono && display !== "—" ? "font-mono tabular-nums" : ""
        }`}
      >
        {display}
      </span>
    </div>
  );
}

export default function BeneficiaryDetailPage() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const rawId = decodeURIComponent(params.id || "").trim();
  const { toast } = useToast();
  const { contacts, deleteContactRole } = useContacts();

  const [mitoBeneficiaries, setMitoBeneficiaries] = useState<MitoBeneficiaryItem[]>([]);
  const [mitoLoading, setMitoLoading] = useState(true);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    setMitoLoading(true);
    void fetchMitoBeneficiaries()
      .then((list) => {
        if (!active) return;
        setMitoBeneficiaries(list);
      })
      .finally(() => {
        if (active) setMitoLoading(false);
      });
    return () => {
      active = false;
    };
  }, [rawId]);

  const record = useMemo(
    () => resolveMergedBeneficiary(rawId, contacts, mitoBeneficiaries),
    [rawId, contacts, mitoBeneficiaries],
  );

  if (!record && mitoLoading) {
    return (
      <DashboardLayout>
        <div
          data-testid="beneficiary-detail-loading"
          className="py-20 flex items-center justify-center gap-2.5 text-sm text-[#605E5C]"
        >
          <Loader2 className="w-5 h-5 text-[#2e5bff] animate-spin" />
          <span>Loading recipient details...</span>
        </div>
      </DashboardLayout>
    );
  }

  if (!record) {
    return (
      <DashboardLayout>
        <div className="max-w-xl mx-auto py-12 space-y-6" data-testid="beneficiary-not-found">
          <div>
            <button
              type="button"
              data-testid="button-back-to-recipients"
              onClick={() => setLocation("/senders-recipients?tab=recipients")}
              className="inline-flex items-center gap-2 text-sm font-medium text-[#323130] hover:text-[#2e5bff] transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to recipients</span>
            </button>
          </div>

          <Card className="rounded-2xl border border-[#efefee] bg-white shadow-[-2px_4px_16px_0px_rgba(0,0,0,0.04)]">
            <CardContent className="p-8 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto">
                <Users className="w-6 h-6 text-[#605E5C]" />
              </div>
              <div className="space-y-1">
                <h1 className="font-display text-xl font-bold text-[#111827]">
                  Recipient not found
                </h1>
                <p className="text-sm text-[#605E5C]">
                  This recipient could not be found or may have been removed from your directory.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation("/senders-recipients?tab=recipients")}
                className="rounded-full px-6"
              >
                Back to recipients
              </Button>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const avatarInitials = computeBeneficiaryInitials(
    record.recipientType,
    record.firstName,
    record.lastName,
    record.businessName,
  );
  const flagIso2 = countryFlagCode(record.country);
  const svcStyle = serviceTypeStyle(record.serviceType);
  const refLabel = `REF/${record.uniqueCode}`;
  const deliveryMethodLabel =
    record.collectionMethod === "mobile_money"
      ? "Mobile money"
      : record.isInternational
        ? "Swift"
        : "Direct to bank";

  const formattedAddress = [
    record.address,
    record.addressLine2,
    record.city,
    record.stateOrProvince,
    record.postcode,
  ]
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .join(", ");

  const sendMoneyHref = `/send-money?currency=${encodeURIComponent(record.currency)}&recipientId=${encodeURIComponent(record.id)}`;

  const handleCopyRef = async () => {
    try {
      await navigator.clipboard.writeText(refLabel);
    } catch {
      // clipboard unavailable in insecure context
    }
    toast({
      title: "Reference copied",
      description: `${refLabel} copied to clipboard.`,
    });
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      const acctForDelete = record.accountNumber || record.iban || record.mobileNo || "";
      await deleteMitoBeneficiaryById(record.mitoId || record.id, {
        name: record.fullName,
        accountNumber: acctForDelete,
      });

      if (record.rawEmail) {
        deleteContactRole(record.rawEmail, "recipient", {
          name: record.fullName,
          accountNumber: acctForDelete,
        });
      }
      if (record.contactId && record.contactId !== record.rawEmail) {
        deleteContactRole(record.contactId, "recipient", {
          name: record.fullName,
          accountNumber: acctForDelete,
        });
      }
      if (record.id && record.id !== record.contactId && record.id !== record.rawEmail) {
        deleteContactRole(record.id, "recipient", {
          name: record.fullName,
          accountNumber: acctForDelete,
        });
      }

      setShowDeleteModal(false);
      toast({
        title: "Recipient removed",
        description: `${record.fullName} has been removed from your recipients.`,
      });
      setLocation("/senders-recipients?tab=recipients");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 pb-12" data-testid="page-beneficiary-detail">
        {/* Back Link */}
        <div>
          <button
            type="button"
            data-testid="button-back-to-recipients"
            onClick={() => setLocation("/senders-recipients?tab=recipients")}
            className="inline-flex items-center gap-2 text-sm font-medium text-[#323130] hover:text-[#2e5bff] transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to recipients</span>
          </button>
        </div>

        {/* #ECF5FF Header Banner */}
        <div
          data-testid="beneficiary-detail-header"
          className="rounded-2xl border border-[#cce3ff] bg-[#ECF5FF] p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5"
        >
          <div className="flex items-start sm:items-center gap-4 min-w-0">
            {/* 56px #DCEBFA Circle Avatar + #0E7A0D Active Dot */}
            <div className="relative w-14 h-14 rounded-full bg-[#DCEBFA] text-[#2e5bff] flex items-center justify-center shrink-0">
              {record.recipientType === "business" ? (
                <Building2 className="w-6 h-6" aria-hidden="true" />
              ) : (
                <span className="text-base font-bold">{avatarInitials}</span>
              )}
              <span
                aria-hidden="true"
                className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-[#0E7A0D] ring-2 ring-[#ECF5FF]"
              />
            </div>

            <div className="min-w-0 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <h1
                  data-testid="beneficiary-detail-name"
                  className="font-display text-xl sm:text-2xl font-bold text-[#111827] truncate"
                >
                  {record.fullName}
                </h1>
                {record.isSender && record.isRecipient && (
                  <span
                    data-testid="badge-beneficiary-dual-role"
                    className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200"
                  >
                    Sender &amp; Recipient
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 flex-wrap text-xs sm:text-sm text-[#605E5C]">
                <button
                  type="button"
                  data-testid="button-copy-beneficiary-ref"
                  onClick={() => void handleCopyRef()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-[#cce3ff] font-mono text-xs font-semibold text-[#2e5bff] hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <span>{refLabel}</span>
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <span>Added {formatDetailDate(record.createdAt)}</span>
                {record.isSender &&
                  record.rawEmail &&
                  !isSyntheticBeneficiaryEmail(record.rawEmail) && (
                    <button
                      type="button"
                      data-testid="button-view-linked-sender"
                      onClick={() =>
                        setLocation(`/senders/${encodeURIComponent(record.rawEmail)}`)
                      }
                      className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:underline cursor-pointer"
                    >
                      <User className="w-3.5 h-3.5" />
                      <span>View sender profile</span>
                    </button>
                  )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap shrink-0">
            <Button
              type="button"
              data-testid="button-detail-send-money"
              onClick={() => setLocation(sendMoneyHref)}
              className="h-10 px-5 rounded-full bg-[#2e5bff] hover:bg-blue-700 text-white font-semibold shadow-none inline-flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              <span>Send money</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              data-testid="button-detail-edit"
              onClick={() => setLocation(`/beneficiaries/${encodeURIComponent(record.id)}/edit`)}
              className="h-10 px-4 rounded-full bg-white border-[#d2d0ce] text-[#323130] hover:bg-slate-50 font-semibold inline-flex items-center gap-1.5"
            >
              <Pencil className="w-4 h-4" />
              <span>Edit</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              data-testid="button-detail-delete"
              onClick={() => setShowDeleteModal(true)}
              className="h-10 px-4 rounded-full bg-white border-red-200 text-red-600 hover:bg-red-50 font-semibold inline-flex items-center gap-1.5"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete</span>
            </Button>
          </div>
        </div>

        {/* 3-Column Responsive Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Column 1: Personal details */}
          <Card
            data-testid="card-personal-details"
            className="rounded-xl border border-[#efefee] bg-white shadow-[-2px_4px_16px_0px_rgba(0,0,0,0.04)]"
          >
            <CardHeader className="pb-3 pt-5 px-5 border-b border-[#efefee]">
              <CardTitle className="font-display text-base font-semibold text-[#323130] flex items-center gap-2">
                <User className="w-4 h-4 text-[#2e5bff]" />
                <span>Personal details</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 py-2 divide-y divide-[#f5f5f4]">
              <InfoField
                label="Recipient type"
                value={record.recipientType === "business" ? "Business" : "Individual"}
              />
              <InfoField
                label={record.recipientType === "business" ? "Business name" : "Full name"}
                value={record.fullName}
              />
              <InfoField label="Nickname" value={record.nickName} />
              <InfoField
                label="Relationship"
                value={
                  record.otherRelationship
                    ? `${record.relationship || "Other"} (${record.otherRelationship})`
                    : record.relationship
                }
              />
              <InfoField label="Mobile number" value={record.mobileNo} mono />
              <InfoField
                label="Email"
                value={record.displayEmail}
                testId="detail-beneficiary-email"
              />
              <div className="py-2.5 flex items-center justify-between gap-4 text-sm">
                <span className="text-[#605E5C] shrink-0">Country</span>
                <span className="inline-flex items-center gap-2 font-medium text-[#111827]">
                  <img
                    src={`https://flagcdn.com/w20/${flagIso2}.png`}
                    alt={record.country}
                    className="w-4 h-3 object-cover rounded-[2px] shrink-0"
                  />
                  <span>{record.country}</span>
                </span>
              </div>
              {formattedAddress && <InfoField label="Address" value={formattedAddress} />}
              {record.dob && <InfoField label="Date of birth" value={record.dob} />}
            </CardContent>
          </Card>

          {/* Column 2: Banking details */}
          <Card
            data-testid="card-banking-details"
            className="rounded-xl border border-[#efefee] bg-white shadow-[-2px_4px_16px_0px_rgba(0,0,0,0.04)]"
          >
            <CardHeader className="pb-3 pt-5 px-5 border-b border-[#efefee]">
              <CardTitle className="font-display text-base font-semibold text-[#323130] flex items-center gap-2">
                <Landmark className="w-4 h-4 text-[#2e5bff]" />
                <span>Banking details</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 py-2 divide-y divide-[#f5f5f4]">
              <InfoField label="Delivery method" value={deliveryMethodLabel} />
              <InfoField
                label={
                  record.collectionMethod === "mobile_money" ? "Mobile operator" : "Bank name"
                }
                value={record.bankName}
              />
              {record.accountHolderName && (
                <InfoField label="Account holder name" value={record.accountHolderName} />
              )}
              {record.collectionMethod === "mobile_money" ? (
                <InfoField
                  label="Mobile wallet number"
                  value={record.mobileNo || record.accountNumber}
                  mono
                />
              ) : (
                <>
                  <InfoField label="Account number" value={record.accountNumber} mono />
                  {record.sortCode && <InfoField label="Sort code" value={record.sortCode} mono />}
                  {record.iban && <InfoField label="IBAN" value={record.iban} mono />}
                  {record.swift && <InfoField label="SWIFT / BIC" value={record.swift} mono />}
                  {record.aba && <InfoField label="ABA routing" value={record.aba} mono />}
                  {record.ifsc && <InfoField label="IFSC code" value={record.ifsc} mono />}
                  {record.bsbCode && <InfoField label="BSB code" value={record.bsbCode} mono />}
                  {record.branchCode && (
                    <InfoField label="Branch code" value={record.branchCode} mono />
                  )}
                  {record.bankCode && <InfoField label="Bank code" value={record.bankCode} mono />}
                  {record.clabe && <InfoField label="CLABE" value={record.clabe} mono />}
                  {record.cnaps && <InfoField label="CNAPS code" value={record.cnaps} mono />}
                </>
              )}
              <InfoField label="Narration" value={record.narration} />
            </CardContent>
          </Card>

          {/* Column 3: Services */}
          <Card
            data-testid="card-services-details"
            className="rounded-xl border border-[#efefee] bg-white shadow-[-2px_4px_16px_0px_rgba(0,0,0,0.04)] flex flex-col justify-between"
          >
            <div>
              <CardHeader className="pb-3 pt-5 px-5 border-b border-[#efefee]">
                <CardTitle className="font-display text-base font-semibold text-[#323130] flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#2e5bff]" />
                  <span>Services</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 py-3 divide-y divide-[#f5f5f4]">
                <div className="py-2.5 flex items-center justify-between gap-4 text-sm">
                  <span className="text-[#605E5C]">Money transfer</span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-[#0E7A0D] border border-emerald-200">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Active</span>
                  </span>
                </div>

                <div className="py-2.5 flex items-center justify-between gap-4 text-sm">
                  <span className="text-[#605E5C]">Currency</span>
                  <span className="inline-flex items-center gap-2 font-semibold text-[#111827]">
                    <img
                      src={`https://flagcdn.com/w20/${flagIso2}.png`}
                      alt={record.currency}
                      className="w-4 h-3 object-cover rounded-[2px] shrink-0"
                    />
                    <span>{record.currency}</span>
                  </span>
                </div>

                <div className="py-2.5 flex items-center justify-between gap-4 text-sm">
                  <span className="text-[#605E5C]">Collection method</span>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${svcStyle.pillClass}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${svcStyle.dotClass}`} />
                    <span>{record.serviceType}</span>
                  </span>
                </div>
              </CardContent>
            </div>

            <div className="p-5 pt-2">
              <Button
                type="button"
                data-testid="button-services-send-money"
                onClick={() => setLocation(sendMoneyHref)}
                className="w-full h-11 rounded-full bg-[#2e5bff] hover:bg-blue-700 text-white font-semibold shadow-none inline-flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                <span>Send money</span>
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Dismissible Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
              onClick={() => !deleting && setShowDeleteModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-sm"
              data-testid="modal-delete-beneficiary"
            >
              <Card className="rounded-2xl border border-[#efefee] shadow-xl">
                <CardContent className="p-6 relative text-center space-y-4">
                  <button
                    type="button"
                    aria-label="Close"
                    data-testid="button-close-delete-modal"
                    onClick={() => !deleting && setShowDeleteModal(false)}
                    className="absolute right-4 top-4 w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-[#605E5C] transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>

                  <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto">
                    <Trash2 className="w-6 h-6 text-red-600" />
                  </div>

                  <div className="space-y-1.5">
                    <h2 className="font-display text-lg font-bold text-[#111827]">
                      Delete recipient?
                    </h2>
                    <p className="text-sm text-[#605E5C]">
                      Are you sure you want to remove{" "}
                      <span className="font-semibold text-[#111827]">{record.fullName}</span>? This
                      action cannot be undone.
                    </p>
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={deleting}
                      onClick={() => setShowDeleteModal(false)}
                      className="flex-1 rounded-full"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={deleting}
                      data-testid="button-confirm-delete"
                      onClick={() => void handleConfirmDelete()}
                      className="flex-1 rounded-full"
                    >
                      {deleting ? "Removing..." : "Delete"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
}
