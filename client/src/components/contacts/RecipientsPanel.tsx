import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Plus,
  Send,
  Eye,
  Pencil,
  Trash2,
  User,
  Building2,
  Users,
  X,
  Copy,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { countries } from "@/data/countries";
import { useContacts } from "@/contexts/ContactsContext";
import { toKnownRecipient } from "@/data/contacts";
import { type KnownRecipient } from "@/data/recipients";
import { deleteMitoBeneficiaryById, fetchMitoBeneficiaries, fetchMitoBeneficiariesWithMeta, fetchMitoProviders, isMitoBeneficiaryDeleted, unmarkDeletedMitoBeneficiary, updateMitoBeneficiaryById, type MitoBeneficiaryItem, type MitoProviderOption } from "@/lib/sendMoney";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { displayBeneficiaryEmail, isSyntheticBeneficiaryEmail } from "@/components/beneficiary";
import {
  SERVICE_TYPES,
  bankFieldsFor,
  currencyForCountry,
  displayName,
  generateUniqueCode,
  initials,
  paginateRecipients,
  requiresNarration,
  searchRecipients,
  serviceTypeStyle,
  sortRecipients,
  type RecipientSortField,
  type SortDirection,
} from "@/lib/recipients";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

interface NewRecipientForm {
  recipientType: "individual" | "business";
  email: string;
  firstName: string;
  lastName: string;
  businessName: string;
  country: string;
  bankName: string;
  accountNumber: string;
  sortCode: string;
  iban: string;
  swift: string;
  serviceType: string;
  narration: string;
}

const emptyNewRecipient: NewRecipientForm = {
  recipientType: "individual",
  email: "",
  firstName: "",
  lastName: "",
  businessName: "",
  country: "",
  bankName: "",
  accountNumber: "",
  sortCode: "",
  iban: "",
  swift: "",
  serviceType: "",
  narration: "",
};

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Recipients panel — rendered inside the consolidated SendersRecipients page.
 * Connected to unified ContactsContext with dual-role and email consolidation.
 */
export function RecipientsPanel() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { recipients: contactsRecipients, upsertRecipient, deleteContactRole } = useContacts();

  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<RecipientSortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingRecipient, setEditingRecipient] = useState<KnownRecipient | null>(null);
  const [viewingRecipient, setViewingRecipient] = useState<KnownRecipient | null>(null);
  const [deletingRecipient, setDeletingRecipient] = useState<KnownRecipient | null>(null);
  const [newRecipient, setNewRecipient] = useState<NewRecipientForm>(emptyNewRecipient);

  const [mitoBeneficiaries, setMitoBeneficiaries] = useState<MitoBeneficiaryItem[]>([]);
  const [mitoConfigured, setMitoConfigured] = useState(false);
  const [mitoProviders, setMitoProviders] = useState<MitoProviderOption[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<{ providerId: string; providerCode: string } | null>(null);
  const [addRecipientError, setAddRecipientError] = useState<string | null>(null);
  const [addingRecipient, setAddingRecipient] = useState(false);

  // Load sender's saved beneficiaries from GET /api/v1/mito/Beneficiaries?userId={{userId}}
  useEffect(() => {
    let active = true;
    void fetchMitoBeneficiariesWithMeta().then((res) => {
      if (!active) return;
      setMitoBeneficiaries(res.beneficiaries);
      setMitoConfigured(res.configured);
    });
    return () => {
      active = false;
    };
  }, []);

  // Load bank providers from GET /api/v1/mito/Lookups/provider when country or serviceType changes in Add Recipient modal
  useEffect(() => {
    if (!showAddModal || !newRecipient.country) {
      setMitoProviders([]);
      setSelectedProvider(null);
      return;
    }
    let active = true;
    const countryIso3Map: Record<string, string> = {
      "United Kingdom": "GBR",
      "United States": "USA",
      Nigeria: "NGA",
      Canada: "CAN",
      Ghana: "GHA",
      Kenya: "KEN",
      "South Africa": "ZAF",
      Germany: "DEU",
      France: "FRA",
      India: "IND",
      China: "CHN",
      "United Arab Emirates": "ARE",
    };
    const countryIso3 = countryIso3Map[newRecipient.country] || "NGA";
    const currencyCode = currencyForCountry(newRecipient.country);
    const collectionMode = newRecipient.serviceType === "Mobile Money" ? "MOBILEMONEY" : "BANKACCOUNT";
    void fetchMitoProviders({
      countryIso3,
      currencyCode,
      serviceCode: "MONEYTRANSFER",
      collectionMode,
    }).then((list) => {
      if (!active) return;
      setMitoProviders(list);
      const currentBank = newRecipient.bankName.trim().toLowerCase();
      if (currentBank) {
        const matched = list.find((p) => p.providerName.trim().toLowerCase() === currentBank);
        setSelectedProvider(
          matched ? { providerId: matched.providerId, providerCode: matched.providerCode } : null,
        );
      } else {
        setSelectedProvider(null);
      }
    });
    return () => {
      active = false;
    };
  }, [showAddModal, newRecipient.country, newRecipient.serviceType]);

  const recipients: KnownRecipient[] = useMemo(() => {
    const localList: KnownRecipient[] = contactsRecipients
      .map((c) => ({
        ...toKnownRecipient(c),
        email: c.email,
        isSender: c.isSender,
      }))
      .filter(
        (loc) =>
          !isMitoBeneficiaryDeleted({
            beneficiaryId: loc.id,
            name: displayName(loc),
            accountNumber: loc.accountNumber,
          }),
      );

    const iso3ToCountryName: Record<string, string> = {
      GBR: "United Kingdom",
      UK: "United Kingdom",
      USA: "United States",
      NGA: "Nigeria",
      CAN: "Canada",
      GHA: "Ghana",
      KEN: "Kenya",
      ZAF: "South Africa",
      DEU: "Germany",
      FRA: "France",
      IND: "India",
      CHN: "China",
      ARE: "United Arab Emirates",
    };

    const makeCodeFromId = (id: string) => {
      let hash = 0;
      for (let i = 0; i < id.length; i++) {
        hash = (hash * 31 + id.charCodeAt(i)) % 900000;
      }
      return String(100000 + Math.abs(hash));
    };

    const mitoMapped: KnownRecipient[] = mitoBeneficiaries.map((b) => {
      const normalizedCountry =
        iso3ToCountryName[(b.countryIso3 || "").toUpperCase()] ||
        (b.country === "UK" ? "United Kingdom" : b.country) ||
        "Nigeria";
      const serviceType =
        (b.collectionMode || "").toUpperCase() === "MOBILEMONEY"
          ? "Mobile Money"
          : b.bicSwift && !b.sortCode && normalizedCountry !== "Nigeria" && normalizedCountry !== "United Kingdom"
            ? "SWIFT"
            : "Bank Deposit";
      const matchedLoc = localList.find(
        (loc) => loc.id.toLowerCase() === b.beneficiaryId.toLowerCase(),
      );
      return {
        id: b.beneficiaryId,
        email: matchedLoc?.email || `${b.beneficiaryId.toLowerCase()}@beneficiary.rhemito.local`,
        isSender: Boolean(matchedLoc?.isSender),
        recipientType: b.legalEntityType,
        firstName: b.firstName || b.name.split(" ")[0] || "",
        lastName: b.lastName || b.name.split(" ").slice(1).join(" ") || "",
        businessName: b.companyName || (b.legalEntityType === "business" ? b.name : ""),
        country: normalizedCountry,
        currency: (b.currency || currencyForCountry(normalizedCountry)).toUpperCase(),
        bankName: b.bankName && b.bankName !== "Bank" ? b.bankName : "Bank Transfer",
        accountNumber: b.acctNumber || b.iban || b.mobileNo || "—",
        sortCode: b.sortCode || "",
        iban: b.iban || "",
        swift: b.bicSwift || "",
        serviceType,
        uniqueCode: matchedLoc?.uniqueCode || makeCodeFromId(b.beneficiaryId),
        narration: b.narration || matchedLoc?.narration || "",
        relationship: b.relationship || matchedLoc?.relationship || "Personal",
        createdAt: b.createdAt ? b.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
      };
    });

    // Merge Mito Sandbox beneficiaries at the top, deduplicating by beneficiaryId or (accountNumber + name)
    if (mitoConfigured) {
      return mitoMapped;
    }
    const merged: KnownRecipient[] = [...mitoMapped];
    for (const loc of localList) {
      const locName = displayName(loc).trim().toLowerCase();
      const locAcct = (loc.accountNumber || "").trim().toLowerCase();
      const alreadyInMito = mitoMapped.some((m) => {
        if (m.id === loc.id) return true;
        const mName = displayName(m).trim().toLowerCase();
        const mAcct = (m.accountNumber || "").trim().toLowerCase();
        if (locAcct && locAcct !== "—" && mAcct === locAcct && mName === locName) return true;
        if (mName === locName && (!mAcct || mAcct === "—")) return true;
        return false;
      });
      if (!alreadyInMito) {
        merged.push(loc);
      }
    }
    return merged;
  }, [contactsRecipients, mitoBeneficiaries, mitoConfigured]);

  const filtered = useMemo(
    () => searchRecipients(recipients, searchQuery),
    [recipients, searchQuery]
  );
  const sorted = useMemo(
    () => sortRecipients(filtered, sortField, sortDirection),
    [filtered, sortField, sortDirection]
  );
  const pagination = useMemo(
    () => paginateRecipients(sorted, page, pageSize),
    [sorted, page, pageSize]
  );

  const toggleSort = (field: RecipientSortField) => {
    setPage(1);
    if (sortField === field) {
      setSortDirection((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const sortIcon = (field: RecipientSortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3.5 h-3.5 opacity-40" aria-hidden="true" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
    );
  };

  const ariaSortValue = (field: RecipientSortField): "ascending" | "descending" | "none" => {
    if (sortField !== field) return "none";
    return sortDirection === "asc" ? "ascending" : "descending";
  };

  const newFormBankFields = bankFieldsFor(newRecipient.country);
  const narrationRequired = requiresNarration(newRecipient.country);

  const newRecipientIsValid =
    Boolean(newRecipient.email.trim()) &&
    Boolean(newRecipient.country.trim()) &&
    Boolean(newRecipient.serviceType.trim()) &&
    (newRecipient.recipientType === "individual"
      ? Boolean(newRecipient.firstName.trim() && newRecipient.lastName.trim())
      : Boolean(newRecipient.businessName.trim())) &&
    Boolean(newRecipient.bankName.trim() && newRecipient.accountNumber.trim()) &&
    (!narrationRequired || Boolean(newRecipient.narration.trim()));

  const handleOpenEditRecipient = (recipient: KnownRecipient) => {
    setAddRecipientError(null);
    setEditingRecipient(recipient);
    setNewRecipient({
      recipientType: recipient.recipientType,
      email: recipient.email || `${recipient.id.toLowerCase()}@beneficiary.rhemito.local`,
      firstName: recipient.firstName || "",
      lastName: recipient.lastName || "",
      businessName: recipient.businessName || "",
      country: recipient.country || "Nigeria",
      bankName: recipient.bankName === "Bank Transfer" ? "" : recipient.bankName || "",
      accountNumber: recipient.accountNumber === "—" ? "" : (recipient.accountNumber || "").replace(/\s+/g, ""),
      sortCode: recipient.sortCode || "",
      iban: recipient.iban || "",
      swift: recipient.swift || "",
      serviceType: recipient.serviceType || "Bank Deposit",
      narration:
        recipient.narration || (requiresNarration(recipient.country) ? "Money transfer" : ""),
    });
    setShowAddModal(true);
  };

  const handleCloseRecipientModal = () => {
    setShowAddModal(false);
    setEditingRecipient(null);
    setNewRecipient(emptyNewRecipient);
    setSelectedProvider(null);
    setAddRecipientError(null);
  };

  const handleAddRecipient = async () => {
    setAddRecipientError(null);
    setAddingRecipient(true);
    try {
      const cleanAcct = newRecipient.accountNumber.replace(/\s+/g, "");
      const cleanSortCode =
        newFormBankFields.sortCode && newRecipient.serviceType !== "Mobile Money"
          ? newRecipient.sortCode.replace(/\s+/g, "")
          : "";
      const cleanIban =
        newFormBankFields.iban && newRecipient.serviceType !== "Mobile Money"
          ? newRecipient.iban.replace(/\s+/g, "")
          : "";
      const cleanSwift =
        newFormBankFields.swift && newRecipient.serviceType !== "Mobile Money"
          ? newRecipient.swift.replace(/\s+/g, "")
          : "";

      if (editingRecipient) {
        await updateMitoBeneficiaryById(editingRecipient.id, {
          recipientType: newRecipient.recipientType,
          firstName: newRecipient.firstName.trim(),
          lastName: newRecipient.lastName.trim(),
          businessName: newRecipient.businessName.trim(),
          companyName: newRecipient.businessName.trim(),
          country: newRecipient.country,
          currency: currencyForCountry(newRecipient.country),
          bankName: newRecipient.bankName.trim(),
          providerId: selectedProvider?.providerId,
          providerCode: selectedProvider?.providerCode,
          accountNumber: cleanAcct,
          sortCode: cleanSortCode || undefined,
          iban: cleanIban || undefined,
          swift: cleanSwift || undefined,
          serviceType: newRecipient.serviceType,
          narration: newRecipient.narration.trim(),
        });

        const updatedContact = upsertRecipient({
          id: editingRecipient.id,
          originalId: editingRecipient.id,
          originalEmail: editingRecipient.email,
          email: newRecipient.email.trim(),
          contactType: newRecipient.recipientType,
          firstName: newRecipient.firstName.trim(),
          lastName: newRecipient.lastName.trim(),
          businessName: newRecipient.businessName.trim(),
          country: newRecipient.country,
          currency: currencyForCountry(newRecipient.country),
          bankName: newRecipient.bankName.trim(),
          accountNumber: cleanAcct,
          sortCode: cleanSortCode,
          iban: cleanIban,
          swift: cleanSwift,
          serviceType: newRecipient.serviceType,
          narration: newRecipient.narration.trim(),
          relationship: editingRecipient.relationship || "Personal",
        });

        const fullName =
          newRecipient.recipientType === "business"
            ? newRecipient.businessName.trim()
            : `${newRecipient.firstName.trim()} ${newRecipient.lastName.trim()}`.trim();

        setMitoBeneficiaries((prev) =>
          prev.map((b) =>
            b.beneficiaryId.toUpperCase() === editingRecipient.id.toUpperCase()
              ? {
                  ...b,
                  name: fullName,
                  firstName:
                    newRecipient.recipientType === "business"
                      ? newRecipient.businessName.trim()
                      : newRecipient.firstName.trim(),
                  lastName:
                    newRecipient.recipientType === "business"
                      ? "Business"
                      : newRecipient.lastName.trim(),
                  companyName:
                    newRecipient.recipientType === "business"
                      ? newRecipient.businessName.trim()
                      : null,
                  legalEntityType: newRecipient.recipientType,
                  country: newRecipient.country,
                  currency: currencyForCountry(newRecipient.country),
                  collectionMode:
                    newRecipient.serviceType === "Mobile Money" ? "MOBILEMONEY" : "BANKACCOUNT",
                  bankName: newRecipient.bankName.trim(),
                  acctNumber: cleanAcct,
                  sortCode: cleanSortCode,
                  iban: cleanIban,
                  bicSwift: cleanSwift,
                }
              : b,
          ),
        );

        void fetchMitoBeneficiariesWithMeta().then((res) => {
          setMitoBeneficiaries(res.beneficiaries);
      setMitoConfigured(res.configured);
        });

        handleCloseRecipientModal();
        toast({
          title: "Recipient updated",
          description: `${displayName(toKnownRecipient(updatedContact))} has been updated.`,
        });
        return;
      }

      const res = await fetch("/api/send-money/mito/beneficiaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          recipientType: newRecipient.recipientType,
          firstName: newRecipient.firstName.trim(),
          lastName: newRecipient.lastName.trim(),
          businessName: newRecipient.businessName.trim(),
          country: newRecipient.country,
          currency: currencyForCountry(newRecipient.country),
          bankName: newRecipient.bankName.trim(),
          providerId: selectedProvider?.providerId,
          providerCode: selectedProvider?.providerCode,
          accountNumber: cleanAcct,
          sortCode: cleanSortCode || undefined,
          iban: cleanIban || undefined,
          swift: cleanSwift || undefined,
          serviceType: newRecipient.serviceType,
          narration: newRecipient.narration.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json?.error?.message || "We couldn't create this beneficiary. Please check the details and try again.";
        setAddRecipientError(msg);
        toast({
          title: "Could not create beneficiary",
          description: msg,
          variant: "destructive",
        });
        return;
      }

      const created = upsertRecipient({
        id: json?.data?.beneficiaryId || undefined,
        email: newRecipient.email.trim(),
        contactType: newRecipient.recipientType,
        firstName: newRecipient.firstName.trim(),
        lastName: newRecipient.lastName.trim(),
        businessName: newRecipient.businessName.trim(),
        country: newRecipient.country,
        currency: currencyForCountry(newRecipient.country),
        bankName: newRecipient.bankName.trim(),
        accountNumber: cleanAcct,
        sortCode: cleanSortCode,
        iban: cleanIban,
        swift: cleanSwift,
        serviceType: newRecipient.serviceType,
        narration: newRecipient.narration.trim(),
        relationship: "Personal",
      });

      unmarkDeletedMitoBeneficiary({
        beneficiaryId: json?.data?.beneficiaryId || null,
        name:
          newRecipient.recipientType === "business"
            ? newRecipient.businessName.trim()
            : `${newRecipient.firstName.trim()} ${newRecipient.lastName.trim()}`.trim(),
        accountNumber: cleanAcct,
      });

      void fetchMitoBeneficiariesWithMeta().then((res) => {
        setMitoBeneficiaries(res.beneficiaries);
      setMitoConfigured(res.configured);
      });

      handleCloseRecipientModal();
      setPage(1);
      toast({
        title: "Beneficiary created successfully",
        description: `${displayName(toKnownRecipient(created))} has been created and is ready to receive payouts.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "We couldn't create this beneficiary. Please try again.";
      setAddRecipientError(msg);
      toast({
        title: editingRecipient ? "Could not update recipient" : "Could not create beneficiary",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setAddingRecipient(false);
    }
  };

  const handleDeleteRecipient = () => {
    if (!deletingRecipient) return;
    const target = deletingRecipient;
    const removedName = displayName(target);
    const cleanTargetAcct = (target.accountNumber || "").replace(/\s+/g, "").toLowerCase();
    const cleanTargetName = removedName.trim().toLowerCase();
    const cleanTargetId = (target.id || "").trim().toUpperCase();

    // 1. Remove from ContactsContext (by email, id, accountNumber, and name)
    deleteContactRole(target.email || target.id || "", "recipient", {
      name: removedName,
      accountNumber: target.accountNumber,
    });
    if (target.id && target.id !== target.email) {
      deleteContactRole(target.id, "recipient", {
        name: removedName,
        accountNumber: target.accountNumber,
      });
    }

    // 2. Remove from Mito beneficiaries state & server (including any duplicate Sandbox entries) so it disappears immediately and stays deleted
    const matchingIds = new Set<string>();
    if (cleanTargetId) matchingIds.add(cleanTargetId);
    for (const b of mitoBeneficiaries) {
      const bId = (b.beneficiaryId || "").trim().toUpperCase();
      const bAcct = (b.acctNumber || b.iban || b.mobileNo || "").replace(/\s+/g, "").toLowerCase();
      const bName = (b.name || "").trim().toLowerCase();
      if (
        (cleanTargetId && bId === cleanTargetId) ||
        (cleanTargetAcct && cleanTargetAcct !== "—" && bAcct === cleanTargetAcct && bName === cleanTargetName) ||
        (cleanTargetName && bName === cleanTargetName && (!cleanTargetAcct || cleanTargetAcct === "—" || !bAcct))
      ) {
        if (b.beneficiaryId) matchingIds.add(b.beneficiaryId);
      }
    }

    setMitoBeneficiaries((prev) =>
      prev.filter((b) => {
        const bId = (b.beneficiaryId || "").trim().toUpperCase();
        const bAcct = (b.acctNumber || b.iban || b.mobileNo || "").replace(/\s+/g, "").toLowerCase();
        const bName = (b.name || "").trim().toLowerCase();
        if (cleanTargetId && bId === cleanTargetId) return false;
        if (cleanTargetAcct && cleanTargetAcct !== "—" && bAcct === cleanTargetAcct && bName === cleanTargetName) {
          return false;
        }
        if (cleanTargetName && bName === cleanTargetName && (!cleanTargetAcct || cleanTargetAcct === "—" || !bAcct)) {
          return false;
        }
        return true;
      }),
    );

    if (matchingIds.size > 0) {
      for (const idToDelete of Array.from(matchingIds)) {
        void deleteMitoBeneficiaryById(idToDelete, {
          name: removedName,
          accountNumber: target.accountNumber,
        });
      }
    } else {
      void deleteMitoBeneficiaryById(target.id || "local", {
        name: removedName,
        accountNumber: target.accountNumber,
      });
    }

    setDeletingRecipient(null);
    toast({
      title: "Recipient deleted",
      description: `${removedName} was removed from your recipients.`,
    });
  };

  const handleCopyUniqueCode = async (recipient: KnownRecipient) => {
    try {
      await navigator.clipboard.writeText(recipient.uniqueCode);
    } catch {
      // Clipboard can be unavailable in insecure contexts — still confirm to the user.
    }
    toast({
      title: "Unique code copied",
      description: `${recipient.uniqueCode} copied to clipboard.`,
    });
  };

  const SortableHeader = ({
    field,
    label,
    className,
    testId,
  }: {
    field: RecipientSortField;
    label: string;
    className?: string;
    testId: string;
  }) => (
    <TableHead className={className} aria-sort={ariaSortValue(field)}>
      <button
        type="button"
        onClick={() => toggleSort(field)}
        className="inline-flex items-center gap-1.5 tracking-wider hover:text-foreground transition-colors"
        data-testid={testId}
      >
        {label}
        {sortIcon(field)}
      </button>
    </TableHead>
  );

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="space-y-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold font-display">Recipients</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Manage the beneficiaries you send money to.
            </p>
          </div>
          <Button
            onClick={() => setLocation("/beneficiaries/add")}
            className="gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
            data-testid="button-add-recipient"
          >
            <Plus className="w-4 h-4" />
            Add recipient
          </Button>
        </div>

        <Card>
          <CardContent className="p-4 md:p-6">
            <div className="mb-6">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or country"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  className="pl-9"
                  data-testid="input-search-recipients"
                />
              </div>
            </div>

            <div className="overflow-x-auto" data-testid="table-recipients">
              {isMobile ? (
                <div className="p-2 space-y-3">
                  {pagination.rows.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground" data-testid="empty-recipients">
                      <Users className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" aria-hidden="true" />
                      <p className="text-muted-foreground">No recipients found</p>
                      <p className="text-xs text-muted-foreground/70 mt-1">
                        Try a different name or country, or add a new recipient.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setLocation("/beneficiaries/add")}
                        className="mt-4 gap-1.5"
                        data-testid="button-empty-add-recipient"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add recipient
                      </Button>
                    </div>
                  ) : (
                    pagination.rows.map((recipient) => {
                      const name = displayName(recipient);
                      const style = serviceTypeStyle(recipient.serviceType);
                      const countryMeta = countries.find((c) => c.name === recipient.country);

                      return (
                        <div
                          key={recipient.id}
                          className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-2xs space-y-3"
                          data-testid={`row-recipient-${recipient.id}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                {recipient.recipientType === "business" ? (
                                  <Building2 className="w-4 h-4 text-primary" aria-hidden="true" />
                                ) : (
                                  <span className="text-xs font-bold text-primary">
                                    {initials(recipient)}
                                  </span>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-bold text-slate-900 text-sm truncate">{name}</span>
                                  {recipient.isSender && (
                                    <span
                                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200"
                                      data-testid={`badge-dual-role-${recipient.id}`}
                                    >
                                      Sender &amp; Recipient
                                    </span>
                                  )}
                                </div>
                                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 flex-wrap">
                                  <span className="inline-flex items-center gap-1 text-slate-600">
                                    <span aria-hidden="true">{countryMeta?.flag ?? "🌍"}</span>
                                    {recipient.country}
                                  </span>
                                  <span className="text-slate-300">•</span>
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${style.pillClass}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${style.dotClass}`} />
                                    {recipient.serviceType}
                                  </span>
                                </div>
                                {(recipient.bankName || recipient.accountNumber) && (
                                  <div className="mt-1 text-xs text-slate-400 font-mono truncate">
                                    {recipient.bankName ? `${recipient.bankName} • ` : ""}
                                    {recipient.accountNumber}
                                  </div>
                                )}
                                <div className="mt-0.5 text-xs text-slate-400 truncate">
                                  Email: {displayBeneficiaryEmail(recipient.email)}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="pt-2.5 border-t border-slate-100 flex items-center gap-2 justify-end flex-wrap">
                            <Button
                              size="sm"
                              onClick={() =>
                                setLocation(
                                  `/send-money?currency=${encodeURIComponent(recipient.currency)}&recipientId=${encodeURIComponent(recipient.id)}`,
                                )
                              }
                              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white h-8 px-3 text-xs font-medium rounded-lg shadow-sm active:scale-95 transition-all"
                              data-testid={`button-send-${recipient.id}`}
                              aria-label={`Send money to ${name}`}
                            >
                              <Send className="w-3.5 h-3.5 mr-1" />
                              Send money
                            </Button>

                            {recipient.isSender && !isSyntheticBeneficiaryEmail(recipient.email) && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setLocation(`/senders/${encodeURIComponent(recipient.email || "")}`)}
                                className="h-8 px-2.5 text-xs text-indigo-700 bg-indigo-50 border-indigo-200 hover:bg-indigo-100 active:scale-95"
                                data-testid={`button-view-sender-dual-${recipient.id}`}
                                aria-label={`View sender profile for ${name}`}
                              >
                                <User className="w-3.5 h-3.5 mr-1" />
                                Sender
                              </Button>
                            )}

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setLocation(`/beneficiaries/${encodeURIComponent(recipient.id)}`)
                              }
                              className="h-8 px-2.5 text-xs active:scale-95"
                              data-testid={`button-view-${recipient.id}`}
                              aria-label={`View ${name}`}
                            >
                              <Eye className="w-3.5 h-3.5 mr-1" />
                              View
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setLocation(
                                  `/beneficiaries/${encodeURIComponent(recipient.id)}/edit`,
                                )
                              }
                              className="h-8 px-2.5 text-xs active:scale-95"
                              data-testid={`button-edit-${recipient.id}`}
                              aria-label={`Edit ${name}`}
                            >
                              <Pencil className="w-3.5 h-3.5 mr-1" />
                              Edit
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setDeletingRecipient(recipient)}
                              className="h-8 px-2.5 text-xs text-red-600 hover:bg-red-50 border-red-200 active:scale-95"
                              data-testid={`button-delete-${recipient.id}`}
                              aria-label={`Delete ${name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5 text-red-500" />
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <SortableHeader field="name" label="Full name" testId="button-sort-name" />
                      <SortableHeader field="country" label="Country" testId="button-sort-country" />
                      <SortableHeader
                        field="serviceType"
                        label="Service type"
                        className="hidden sm:table-cell"
                        testId="button-sort-service-type"
                      />
                      <TableHead className="text-left text-xs font-semibold text-muted-foreground tracking-wider hidden lg:table-cell">
                        Unique code
                      </TableHead>
                      <TableHead className="text-left text-xs font-semibold text-muted-foreground tracking-wider hidden md:table-cell">
                        Account number
                      </TableHead>
                      <TableHead className="text-right text-xs font-semibold text-muted-foreground tracking-wider">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagination.rows.map((recipient) => {
                      const name = displayName(recipient);
                      const style = serviceTypeStyle(recipient.serviceType);
                      const countryMeta = countries.find((c) => c.name === recipient.country);

                      return (
                        <TableRow
                          key={recipient.id}
                          className="hover:bg-blue-50/50 transition-colors"
                          data-testid={`row-recipient-${recipient.id}`}
                        >
                          <TableCell className="py-4 px-4">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                                {recipient.recipientType === "business" ? (
                                  <Building2 className="w-4 h-4 text-primary" aria-hidden="true" />
                                ) : (
                                  <span className="text-xs font-medium text-primary">
                                    {initials(recipient)}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-medium truncate">{name}</span>
                                  {recipient.isSender && (
                                    <span
                                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200"
                                      data-testid={`badge-dual-role-${recipient.id}`}
                                    >
                                      Sender &amp; Recipient
                                    </span>
                                  )}
                                </div>
                                {recipient.recipientType === "business" && (
                                  <span className="text-xs text-muted-foreground">Business</span>
                                )}
                                {recipient.bankName && (
                                  <span className="text-xs text-muted-foreground truncate">
                                    {recipient.bankName}
                                    {displayBeneficiaryEmail(recipient.email) !== "—"
                                      ? ` · ${displayBeneficiaryEmail(recipient.email)}`
                                      : ""}
                                  </span>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-4 px-4">
                            <span className="inline-flex items-center gap-2 text-muted-foreground whitespace-nowrap">
                              <span aria-hidden="true">{countryMeta?.flag ?? "🌍"}</span>
                              {recipient.country}
                            </span>
                          </TableCell>
                          <TableCell className="py-4 px-4 hidden sm:table-cell">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${style.pillClass}`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${style.dotClass}`}
                                aria-hidden="true"
                              />
                              {recipient.serviceType}
                            </span>
                          </TableCell>
                          <TableCell className="py-4 px-4 hidden lg:table-cell">
                            <span className="font-mono text-sm text-muted-foreground">
                              {recipient.uniqueCode}
                            </span>
                          </TableCell>
                          <TableCell className="py-4 px-4 hidden md:table-cell">
                            <span className="font-mono text-sm">{recipient.accountNumber}</span>
                          </TableCell>
                          <TableCell className="py-4 px-4">
                            <div className="flex items-center justify-end gap-2">
                              {recipient.isSender && !isSyntheticBeneficiaryEmail(recipient.email) && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      onClick={() => setLocation(`/senders/${encodeURIComponent(recipient.email || "")}`)}
                                      className="w-8 h-8 rounded-lg bg-indigo-50 hover:bg-indigo-100 flex items-center justify-center transition-colors text-indigo-600"
                                      aria-label={`View sender profile for ${name}`}
                                      data-testid={`button-view-sender-dual-${recipient.id}`}
                                    >
                                      <User className="w-4 h-4" aria-hidden="true" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>Sender profile</TooltipContent>
                                </Tooltip>
                              )}

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() =>
                                      setLocation(
                                        `/send-money?currency=${encodeURIComponent(recipient.currency)}&recipientId=${encodeURIComponent(recipient.id)}`,
                                      )
                                    }
                                    className="w-8 h-8 rounded-lg bg-primary/10 hover:bg-primary/20 flex items-center justify-center transition-colors"
                                    aria-label={`Send money to ${name}`}
                                    data-testid={`button-send-${recipient.id}`}
                                  >
                                    <Send className="w-4 h-4 text-primary" aria-hidden="true" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Send money</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() =>
                                      setLocation(`/beneficiaries/${encodeURIComponent(recipient.id)}`)
                                    }
                                    className="w-8 h-8 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors"
                                    aria-label={`View ${name}`}
                                    data-testid={`button-view-${recipient.id}`}
                                  >
                                    <Eye className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>View recipient</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() =>
                                      setLocation(
                                        `/beneficiaries/${encodeURIComponent(recipient.id)}/edit`,
                                      )
                                    }
                                    className="w-8 h-8 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors"
                                    aria-label={`Edit ${name}`}
                                    data-testid={`button-edit-${recipient.id}`}
                                  >
                                    <Pencil className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Edit recipient</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => setDeletingRecipient(recipient)}
                                    className="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 flex items-center justify-center transition-colors"
                                    aria-label={`Delete ${name}`}
                                    data-testid={`button-delete-${recipient.id}`}
                                  >
                                    <Trash2 className="w-4 h-4 text-red-500" aria-hidden="true" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Delete recipient</TooltipContent>
                              </Tooltip>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}

                    {pagination.rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="py-12" data-testid="empty-recipients">
                          <div className="text-center">
                            <Users className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" aria-hidden="true" />
                            <p className="text-muted-foreground">No recipients found</p>
                            <p className="text-xs text-muted-foreground/70 mt-1">
                              Try a different name or country, or add a new recipient.
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setLocation("/beneficiaries/add")}
                              className="mt-4 gap-1.5"
                              data-testid="button-empty-add-recipient"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Add recipient
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </div>

            <div
              className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 mt-4 border-t border-border"
              data-testid="recipients-pagination"
            >
              <p className="text-sm text-muted-foreground">
                Showing {pagination.start}–{pagination.end} of {pagination.total} recipients
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pagination.safePage <= 1}
                  aria-label="Previous page"
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                </Button>
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  Page {pagination.safePage} of {pagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={pagination.safePage >= pagination.totalPages}
                  aria-label="Next page"
                  data-testid="button-next-page"
                >
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </Button>
                <Input
                  type="number"
                  min={1}
                  max={pagination.totalPages}
                  value={pagination.safePage}
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value, 10);
                    if (!Number.isNaN(parsed)) {
                      setPage(Math.min(Math.max(1, parsed), pagination.totalPages));
                    }
                  }}
                  className="w-14 h-8 text-center"
                  aria-label="Go to page"
                  data-testid="input-page-number"
                />
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Show</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(value) => {
                      setPageSize(Number(value));
                      setPage(1);
                    }}
                  >
                    <SelectTrigger
                      className="w-[70px] h-8"
                      aria-label="Rows per page"
                      data-testid="select-page-size"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <SelectItem key={size} value={String(size)}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Add Recipient Modal */}
      <AnimatePresence>
        {showAddModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
              onClick={handleCloseRecipientModal}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-lg"
            >
              <Card>
                <CardContent className="p-4 sm:p-6 max-h-[85vh] overflow-y-auto">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold font-display">
                      {editingRecipient ? "Edit recipient" : "Add new recipient"}
                    </h2>
                    <button
                      type="button"
                      onClick={handleCloseRecipientModal}
                      className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors"
                      aria-label="Close"
                      data-testid="button-close-add-recipient"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Recipient Type *</Label>
                      <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setNewRecipient((prev) => ({ ...prev, recipientType: "individual" }))
                          }
                          className={`flex-1 flex items-center gap-2 p-3 rounded-lg border-2 transition-colors ${
                            newRecipient.recipientType === "individual"
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-muted-foreground/30"
                          }`}
                          data-testid="button-new-recipient-type-individual"
                        >
                          <User
                            className={`w-4 h-4 ${
                              newRecipient.recipientType === "individual"
                                ? "text-primary"
                                : "text-muted-foreground"
                            }`}
                            aria-hidden="true"
                          />
                          <span
                            className={`text-sm font-medium ${
                              newRecipient.recipientType === "individual" ? "text-primary" : ""
                            }`}
                          >
                            Individual
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setNewRecipient((prev) => ({ ...prev, recipientType: "business" }))
                          }
                          className={`flex-1 flex items-center gap-2 p-3 rounded-lg border-2 transition-colors ${
                            newRecipient.recipientType === "business"
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-muted-foreground/30"
                          }`}
                          data-testid="button-new-recipient-type-business"
                        >
                          <Building2
                            className={`w-4 h-4 ${
                              newRecipient.recipientType === "business"
                                ? "text-primary"
                                : "text-muted-foreground"
                            }`}
                            aria-hidden="true"
                          />
                          <span
                            className={`text-sm font-medium ${
                              newRecipient.recipientType === "business" ? "text-primary" : ""
                            }`}
                          >
                            Business
                          </span>
                        </button>
                      </div>
                    </div>

                    {newRecipient.recipientType === "individual" ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>First Name *</Label>
                          <Input
                            value={newRecipient.firstName}
                            onChange={(e) =>
                              setNewRecipient((prev) => ({ ...prev, firstName: e.target.value }))
                            }
                            placeholder="First name"
                            data-testid="input-new-first-name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Last Name *</Label>
                          <Input
                            value={newRecipient.lastName}
                            onChange={(e) =>
                              setNewRecipient((prev) => ({ ...prev, lastName: e.target.value }))
                            }
                            placeholder="Last name"
                            data-testid="input-new-last-name"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label>Business Name *</Label>
                        <Input
                          value={newRecipient.businessName}
                          onChange={(e) =>
                            setNewRecipient((prev) => ({ ...prev, businessName: e.target.value }))
                          }
                          placeholder="Enter business name"
                          data-testid="input-new-business-name"
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>Email Address *</Label>
                      <Input
                        type="email"
                        value={newRecipient.email}
                        onChange={(e) =>
                          setNewRecipient((prev) => ({ ...prev, email: e.target.value }))
                        }
                        placeholder="e.g. name@example.com"
                        data-testid="input-new-recipient-email"
                      />
                      <p className="text-xs text-muted-foreground">
                        Used to uniquely identify contacts across senders and recipients.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Country *</Label>
                      <Select
                        value={newRecipient.country}
                        onValueChange={(value) =>
                          setNewRecipient((prev) => ({ ...prev, country: value }))
                        }
                      >
                        <SelectTrigger data-testid="select-new-country">
                          <SelectValue placeholder="Select country" />
                        </SelectTrigger>
                        <SelectContent>
                          {countries.map((country) => (
                            <SelectItem key={country.code} value={country.name}>
                              {country.flag} {country.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Payout currency: {currencyForCountry(newRecipient.country)}
                      </p>
                    </div>

                    {addRecipientError && (
                      <div
                        role="alert"
                        className="p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800"
                      >
                        <p className="font-semibold text-red-900">Unable to save beneficiary</p>
                        <p className="mt-0.5">{addRecipientError}</p>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>{newRecipient.serviceType === "Mobile Money" ? "Mobile Operator *" : "Bank Name *"}</Label>
                      {(newRecipient.serviceType === "Mobile Money" ? mitoProviders.length > 0 : mitoProviders.some((p) => !p.isGeneric)) ? (
                        <SearchableSelect
                          autoPopulate
                          value={selectedProvider?.providerId || ""}
                          placeholder={
                            newRecipient.serviceType === "Mobile Money"
                              ? "Select a mobile operator or start typing"
                              : "Select a bank or start typing"
                          }
                          options={(
                            mitoProviders.some((p) => !p.isGeneric)
                              ? mitoProviders.filter((p) => !p.isGeneric)
                              : mitoProviders
                          ).map((p) => ({
                            value: p.providerId,
                            label: p.providerName,
                          }))}
                          onValueChange={(val) => {
                            setAddRecipientError(null);
                            if (!val) {
                              setSelectedProvider(null);
                              setNewRecipient((prev) => ({ ...prev, bankName: "" }));
                              return;
                            }
                            const found = mitoProviders.find((p) => p.providerId === val);
                            if (found) {
                              setSelectedProvider({ providerId: found.providerId, providerCode: found.providerCode });
                              setNewRecipient((prev) => ({ ...prev, bankName: found.providerName }));
                            }
                          }}
                          data-testid="input-new-bank-name"
                        />
                      ) : (
                        <Input
                          value={newRecipient.bankName}
                          onChange={(e) => {
                            setAddRecipientError(null);
                            setNewRecipient((prev) => ({ ...prev, bankName: e.target.value }));
                          }}
                          placeholder={
                            newRecipient.serviceType === "Mobile Money"
                              ? "e.g. MTN, M-Pesa, Airtel"
                              : "e.g. GTBank, Barclays, Access Bank"
                          }
                          data-testid="input-new-bank-name"
                        />
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>{newRecipient.serviceType === "Mobile Money" ? "Mobile Number *" : "Account Number *"}</Label>
                      <Input
                        value={newRecipient.accountNumber}
                        onChange={(e) =>
                          setNewRecipient((prev) => ({
                            ...prev,
                            accountNumber: e.target.value.replace(/\s+/g, ""),
                          }))
                        }
                        placeholder={
                          newRecipient.serviceType === "Mobile Money"
                            ? "e.g. +2348012345678 or 08012345678"
                            : "Account number"
                        }
                        data-testid="input-new-account-number"
                      />
                    </div>

                    {newRecipient.serviceType !== "Mobile Money" && newFormBankFields.sortCode && (
                      <div className="space-y-2">
                        <Label>Sort Code *</Label>
                        <Input
                          value={newRecipient.sortCode}
                          onChange={(e) =>
                            setNewRecipient((prev) => ({ ...prev, sortCode: e.target.value.replace(/\s+/g, "") }))
                          }
                          placeholder="e.g. 20-45-67"
                          data-testid="input-new-sort-code"
                        />
                      </div>
                    )}

                    {newRecipient.serviceType !== "Mobile Money" && newFormBankFields.iban && (
                      <div className="space-y-2">
                        <Label>IBAN *</Label>
                        <Input
                          value={newRecipient.iban}
                          onChange={(e) =>
                            setNewRecipient((prev) => ({ ...prev, iban: e.target.value.replace(/\s+/g, "") }))
                          }
                          placeholder="e.g. DE89 3704 0044 0532 0130 00"
                          data-testid="input-new-iban"
                        />
                      </div>
                    )}

                    {newRecipient.serviceType !== "Mobile Money" && newFormBankFields.swift && (
                      <div className="space-y-2">
                        <Label>SWIFT / BIC *</Label>
                        <Input
                          value={newRecipient.swift}
                          onChange={(e) =>
                            setNewRecipient((prev) => ({ ...prev, swift: e.target.value.replace(/\s+/g, "") }))
                          }
                          placeholder="e.g. WFBIUS6S"
                          data-testid="input-new-swift"
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>Service Type *</Label>
                      <Select
                        value={newRecipient.serviceType}
                        onValueChange={(value) => {
                          setSelectedProvider(null);
                          setNewRecipient((prev) => ({ ...prev, serviceType: value, bankName: "" }));
                        }}
                      >
                        <SelectTrigger data-testid="select-new-service-type">
                          <SelectValue placeholder="Select service type" />
                        </SelectTrigger>
                        <SelectContent>
                          {SERVICE_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>
                        Narration (TXN remarks)
                        {narrationRequired ? " *" : ""}
                      </Label>
                      <Input
                        value={newRecipient.narration}
                        onChange={(e) =>
                          setNewRecipient((prev) => ({ ...prev, narration: e.target.value }))
                        }
                        placeholder="Purpose of transfer, e.g. School fees"
                        data-testid="input-new-narration"
                      />
                      {narrationRequired && (
                        <p className="text-xs text-amber-600">
                          Narration is mandatory for Nigerian beneficiaries.
                        </p>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      A unique payout code will be generated automatically.
                    </p>
                  </div>

                  <div className="flex gap-3 mt-6">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={handleCloseRecipientModal}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
                      onClick={handleAddRecipient}
                      disabled={!newRecipientIsValid || addingRecipient}
                      data-testid="button-confirm-add-recipient"
                    >
                      {editingRecipient ? "Save Changes" : "Add Recipient"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* View Recipient Modal */}
      <AnimatePresence>
        {viewingRecipient && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
              onClick={() => setViewingRecipient(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-md"
              data-testid="modal-view-recipient"
            >
              <Card>
                <CardContent className="p-6 max-h-[85vh] overflow-y-auto">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold font-display">Recipient details</h2>
                    <button
                      type="button"
                      onClick={() => setViewingRecipient(null)}
                      className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors"
                      aria-label="Close"
                      data-testid="button-close-view-recipient"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      {viewingRecipient.recipientType === "business" ? (
                        <Building2 className="w-5 h-5 text-primary" aria-hidden="true" />
                      ) : (
                        <span className="text-sm font-medium text-primary">
                          {initials(viewingRecipient)}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold truncate">
                        {displayName(viewingRecipient)}
                      </span>
                      <span className="text-xs text-muted-foreground capitalize">
                        {viewingRecipient.recipientType} · Added {formatDate(viewingRecipient.createdAt)}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                          Country
                        </p>
                        <p className="text-sm font-medium">
                          {countries.find((c) => c.name === viewingRecipient.country)?.flag ?? "🌍"}{" "}
                          {viewingRecipient.country}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                          Payout Currency
                        </p>
                        <p className="text-sm font-medium">{viewingRecipient.currency}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                          Service Type
                        </p>
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${serviceTypeStyle(viewingRecipient.serviceType).pillClass}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${serviceTypeStyle(viewingRecipient.serviceType).dotClass}`}
                            aria-hidden="true"
                          />
                          {viewingRecipient.serviceType}
                        </span>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                          Relationship
                        </p>
                        <p className="text-sm font-medium">{viewingRecipient.relationship}</p>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                        Unique Code
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{viewingRecipient.uniqueCode}</span>
                        <button
                          type="button"
                          onClick={() => handleCopyUniqueCode(viewingRecipient)}
                          className="w-7 h-7 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center text-muted-foreground transition-colors"
                          aria-label="Copy unique code"
                          data-testid={`button-copy-code-${viewingRecipient.id}`}
                        >
                          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <div className="border-t border-border pt-4 space-y-3">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                          Bank Details
                        </p>
                        <p className="text-sm font-medium">{viewingRecipient.bankName}</p>
                        <p className="text-sm font-mono text-muted-foreground">
                          {viewingRecipient.accountNumber}
                        </p>
                        {viewingRecipient.sortCode && (
                          <p className="text-sm font-mono text-muted-foreground">
                            Sort code: {viewingRecipient.sortCode}
                          </p>
                        )}
                        {viewingRecipient.iban && (
                          <p className="text-sm font-mono text-muted-foreground">
                            IBAN: {viewingRecipient.iban}
                          </p>
                        )}
                        {viewingRecipient.swift && (
                          <p className="text-sm font-mono text-muted-foreground">
                            SWIFT: {viewingRecipient.swift}
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                          Narration
                        </p>
                        <p className="text-sm italic text-muted-foreground">
                          {viewingRecipient.narration
                            ? `"${viewingRecipient.narration}"`
                            : "—"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3 mt-6">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setViewingRecipient(null)}
                    >
                      Close
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        const target = viewingRecipient;
                        setViewingRecipient(null);
                        handleOpenEditRecipient(target);
                      }}
                      data-testid="button-modal-edit-recipient"
                    >
                      <Pencil className="w-4 h-4 mr-2" aria-hidden="true" />
                      Edit
                    </Button>
                    <Button
                      className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
                      onClick={() => setLocation("/send-money")}
                      data-testid="button-modal-send-money"
                    >
                      <Send className="w-4 h-4 mr-2" aria-hidden="true" />
                      Send Money
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Delete Recipient Confirmation Modal */}
      <AnimatePresence>
        {deletingRecipient && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
              onClick={() => setDeletingRecipient(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-sm"
            >
              <Card>
                <CardContent className="p-6 text-center relative">
                  <button
                    type="button"
                    aria-label="Close"
                    data-testid="button-close-delete-recipient"
                    onClick={() => setDeletingRecipient(null)}
                    className="absolute right-4 top-4 w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Trash2 className="w-6 h-6 text-red-600" aria-hidden="true" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Delete recipient?</h3>
                  <p className="text-muted-foreground text-sm mb-6">
                    Are you sure you want to delete{" "}
                    <span className="font-medium text-foreground">
                      {displayName(deletingRecipient)}
                    </span>
                    ? This action cannot be undone.
                  </p>
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setDeletingRecipient(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      className="flex-1"
                      onClick={handleDeleteRecipient}
                      data-testid="button-confirm-delete"
                    >
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
