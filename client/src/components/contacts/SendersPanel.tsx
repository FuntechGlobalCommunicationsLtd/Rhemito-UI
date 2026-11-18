import { useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Plus, Send, Eye, Pencil, Trash2, User, Building2, CheckCircle2, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { WaysToGetPaidModal } from "@/components/modals/WaysToGetPaidModal";
import { useContacts } from "@/contexts/ContactsContext";
import { toKnownSender } from "@/data/contacts";
import { resolveNarration, type KnownSender } from "@/data/knownSenders";
import { useIsMobile } from "@/hooks/use-mobile";

const COUNTRY_CODES = [
  { code: "+234", country: "Nigeria", flag: "🇳🇬" },
  { code: "+44", country: "UK", flag: "🇬🇧" },
  { code: "+1", country: "USA", flag: "🇺🇸" },
  { code: "+49", country: "Germany", flag: "🇩🇪" },
  { code: "+33", country: "France", flag: "🇫🇷" },
];

const COUNTRIES = [
  "Nigeria", "United Kingdom", "United States", "Germany", "France", "Kenya", "Ghana"
];

/**
 * Senders panel — rendered inside the consolidated SendersRecipients page.
 * Connected to unified ContactsContext so senders & recipients are unified by email.
 */
export function SendersPanel() {
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const { senders: contactsSenders, upsertSender, deleteContactRole } = useContacts();
  const [searchQuery, setSearchQuery] = useState("");
  const senders: KnownSender[] = contactsSenders.map(toKnownSender);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSender, setEditingSender] = useState<KnownSender | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showWaysModal, setShowWaysModal] = useState(false);
  const [selectedSenderEmail, setSelectedSenderEmail] = useState<string>("");
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [successMessageText, setSuccessMessageText] = useState("Sender added successfully!");
  const emptySenderForm = {
    senderType: "individual" as "individual" | "business",
    firstName: "",
    middleName: "",
    lastName: "",
    businessName: "",
    email: "",
    countryCode: "",
    phone: "",
    dob: "",
    country: "",
    bankName: "",
    accountNumber: "",
    narration: "",
  };
  const [newSender, setNewSender] = useState(emptySenderForm);

  const filteredSenders = senders.filter(sender => {
    const displayName = sender.senderType === "business" 
      ? sender.businessName.toLowerCase() 
      : `${sender.firstName} ${sender.middleName} ${sender.lastName}`.toLowerCase();
    const searchLower = searchQuery.toLowerCase();
    return displayName.includes(searchLower) || sender.country.toLowerCase().includes(searchLower);
  });

  const handleRequestPayment = (email: string) => {
    setSelectedSenderEmail(email);
    setShowWaysModal(true);
  };

  const handleViewSender = (email: string) => {
    setLocation(`/senders/${encodeURIComponent(email)}`);
  };

  const handleDeleteSender = (email: string) => {
    deleteContactRole(email, "sender");
    setShowDeleteConfirm(null);
  };

  const handleOpenEditSender = (sender: KnownSender) => {
    setEditingSender(sender);
    setNewSender({
      senderType: sender.senderType,
      firstName: sender.firstName || "",
      middleName: sender.middleName || "",
      lastName: sender.lastName || "",
      businessName: sender.businessName || "",
      email: sender.email || "",
      countryCode: sender.countryCode || "",
      phone: sender.phone || "",
      dob: sender.dob || "",
      country: sender.country || "",
      bankName: sender.bankName || "",
      accountNumber: sender.accountNumber || "",
      narration: sender.narration || "",
    });
    setShowAddModal(true);
  };

  const handleCloseSenderModal = () => {
    setShowAddModal(false);
    setEditingSender(null);
    setNewSender(emptySenderForm);
  };

  const handleAddSender = () => {
    const isEditing = Boolean(editingSender);
    upsertSender({
      originalEmail: editingSender?.email,
      contactType: newSender.senderType,
      firstName: newSender.firstName.trim(),
      middleName: newSender.middleName.trim(),
      lastName: newSender.lastName.trim(),
      businessName: newSender.businessName.trim(),
      email: newSender.email.trim(),
      countryCode: newSender.countryCode,
      phone: newSender.phone.trim(),
      dob: newSender.senderType === "individual" ? newSender.dob : "",
      country: newSender.country,
      currency: newSender.country === "Nigeria" ? "NGN" : newSender.country === "United Kingdom" ? "GBP" : "USD",
      bankName: newSender.bankName.trim(),
      accountNumber: newSender.accountNumber.replace(/\s+/g, ""),
      narration: newSender.narration.trim(),
      relationship: editingSender?.relationship || "Personal",
    });
    handleCloseSenderModal();
    setSuccessMessageText(isEditing ? "Sender updated successfully!" : "Sender added successfully!");
    setShowSuccessMessage(true);
    setTimeout(() => setShowSuccessMessage(false), 4000);
  };

  return (
    <>
      <div className="space-y-6">
        <AnimatePresence>
          {showSuccessMessage && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3"
            >
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <p className="text-green-800 font-medium">{successMessageText}</p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold font-display">Senders</h2>
          <Button
            onClick={() => {
              setEditingSender(null);
              setNewSender(emptySenderForm);
              setShowAddModal(true);
            }}
            className="gap-2"
            data-testid="button-add-sender"
          >
            <Plus className="w-4 h-4" />
            Add Sender
          </Button>
        </div>

        <Card>
          <CardContent className="p-6">
            <div className="mb-6">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or country"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-senders"
                />
              </div>
            </div>

            <div className="overflow-x-auto" data-testid="table-senders">
              {isMobile ? (
                <div className="p-2 space-y-3">
                  {filteredSenders.length === 0 ? (
                    <div className="text-center py-12" data-testid="empty-senders">
                      <User className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
                      <p className="text-muted-foreground">No senders found</p>
                    </div>
                  ) : (
                    filteredSenders.map((sender) => {
                      const displayName = sender.senderType === "business" 
                        ? sender.businessName 
                        : `${sender.firstName} ${sender.middleName} ${sender.lastName}`.trim();
                      const initials = sender.senderType === "business" 
                        ? sender.businessName.substring(0, 2).toUpperCase()
                        : `${sender.firstName[0]}${sender.lastName[0]}`.toUpperCase();

                      return (
                        <div
                          key={sender.email}
                          className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-2xs space-y-3"
                          data-testid={`row-sender-${sender.email.replace(/[@.]/g, '-')}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                {sender.senderType === "business" ? (
                                  <Building2 className="w-4 h-4 text-primary" />
                                ) : (
                                  <span className="text-xs font-bold text-primary">{initials}</span>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-bold text-slate-900 text-sm truncate">{displayName}</span>
                                  {sender.isRecipient && (
                                    <span
                                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200"
                                      data-testid={`badge-dual-role-${sender.email.replace(/[@.]/g, '-')}`}
                                    >
                                      Sender &amp; Recipient
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-slate-400 truncate">{sender.email}</div>
                                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 flex-wrap">
                                  <span>{sender.country}</span>
                                  {sender.accountNumber && (
                                    <>
                                      <span className="text-slate-300">•</span>
                                      <span className="font-mono text-[11px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                                        Acct: {sender.accountNumber}
                                      </span>
                                    </>
                                  )}
                                </div>
                                {sender.narration && (
                                  <div className="mt-1 text-xs text-slate-400 italic">
                                    "{resolveNarration(sender.narration, sender.relationship)}"
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="pt-2.5 border-t border-slate-100 flex items-center gap-2 justify-end flex-wrap">
                            <Button
                              size="sm"
                              onClick={() => handleRequestPayment(sender.email)}
                              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white h-8 px-3 text-xs font-medium rounded-lg shadow-sm active:scale-95 transition-all"
                              data-testid={`button-request-${sender.email.replace(/[@.]/g, '-')}`}
                            >
                              <Send className="w-3.5 h-3.5 mr-1" />
                              Receive Money
                            </Button>

                            {sender.isRecipient && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setLocation(`/send-money?recipientEmail=${encodeURIComponent(sender.email)}`)}
                                className="h-8 px-2.5 text-xs text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100 active:scale-95"
                                data-testid={`button-send-money-dual-${sender.email.replace(/[@.]/g, '-')}`}
                              >
                                <Send className="w-3.5 h-3.5 mr-1" />
                                Send
                              </Button>
                            )}

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleViewSender(sender.email)}
                              className="h-8 px-2.5 text-xs active:scale-95"
                              data-testid={`button-view-${sender.email.replace(/[@.]/g, '-')}`}
                            >
                              <Eye className="w-3.5 h-3.5 mr-1" />
                              View
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenEditSender(sender)}
                              className="h-8 px-2.5 text-xs active:scale-95"
                              data-testid={`button-edit-${sender.email.replace(/[@.]/g, '-')}`}
                            >
                              <Pencil className="w-3.5 h-3.5 mr-1" />
                              Edit
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setShowDeleteConfirm(sender.email)}
                              className="h-8 px-2.5 text-xs text-red-600 hover:bg-red-50 border-red-200 active:scale-95"
                              data-testid={`button-delete-${sender.email.replace(/[@.]/g, '-')}`}
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
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Full name</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Country</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Account details</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Service type</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSenders.map((sender) => {
                      const displayName = sender.senderType === "business" 
                        ? sender.businessName 
                        : `${sender.firstName} ${sender.middleName} ${sender.lastName}`.trim();
                      const initials = sender.senderType === "business" 
                        ? sender.businessName.substring(0, 2).toUpperCase()
                        : `${sender.firstName[0]}${sender.lastName[0]}`.toUpperCase();
                      
                      return (
                        <tr key={sender.email} className="border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors">
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                                {sender.senderType === "business" ? (
                                  <Building2 className="w-4 h-4 text-primary" />
                                ) : (
                                  <span className="text-xs font-medium text-primary">{initials}</span>
                                )}
                              </div>
                              <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-medium">{displayName}</span>
                                  {sender.isRecipient && (
                                    <span
                                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200"
                                      data-testid={`badge-dual-role-${sender.email.replace(/[@.]/g, '-')}`}
                                    >
                                      Sender &amp; Recipient
                                    </span>
                                  )}
                                </div>
                                {sender.senderType === "business" && (
                                  <span className="text-xs text-muted-foreground">Business</span>
                                )}
                                {sender.bankName && (
                                  <span className="text-xs text-muted-foreground">{sender.bankName}</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-4 text-muted-foreground">{sender.country}</td>
                          {/* Account Details column */}
                          <td className="py-4 px-4">
                            <div className="flex flex-col gap-1">
                              {sender.accountNumber && (
                                <div className="flex flex-wrap gap-1">
                                  <span className="inline-flex items-center text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-mono">
                                    Acct: {sender.accountNumber}
                                  </span>
                                  {sender.sortCode && (
                                    <span className="inline-flex items-center text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-mono">
                                      Sort: {sender.sortCode}
                                    </span>
                                  )}
                                  {sender.iban && (
                                    <span className="inline-flex items-center text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-mono">
                                      IBAN: {sender.iban.slice(0, 12)}…
                                    </span>
                                  )}
                                  {sender.swift && (
                                    <span className="inline-flex items-center text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full font-mono">
                                      SWIFT: {sender.swift}
                                    </span>
                                  )}
                                </div>
                              )}
                              <span className="text-xs text-muted-foreground italic">
                                "{resolveNarration(sender.narration, sender.relationship)}"
                              </span>
                            </div>
                          </td>
                          <td className="py-4 px-4 text-muted-foreground">{sender.serviceType || "Bank deposit"}</td>
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-2">
                              {sender.isRecipient && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      onClick={() => setLocation(`/send-money?recipientEmail=${encodeURIComponent(sender.email)}`)}
                                      className="w-8 h-8 rounded-lg bg-emerald-50 hover:bg-emerald-100 flex items-center justify-center transition-colors text-emerald-600"
                                      data-testid={`button-send-money-dual-${sender.email.replace(/[@.]/g, '-')}`}
                                    >
                                      <Send className="w-4 h-4" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>Send Money (Recipient)</TooltipContent>
                                </Tooltip>
                              )}

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => handleRequestPayment(sender.email)}
                                    className="w-8 h-8 rounded-lg bg-primary/10 hover:bg-primary/20 flex items-center justify-center transition-colors"
                                    data-testid={`button-request-${sender.email.replace(/[@.]/g, '-')}`}
                                  >
                                    <Send className="w-4 h-4 text-primary" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Receive Money</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => handleViewSender(sender.email)}
                                    className="w-8 h-8 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors"
                                    data-testid={`button-view-${sender.email.replace(/[@.]/g, '-')}`}
                                  >
                                    <Eye className="w-4 h-4 text-muted-foreground" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>View Sender</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => handleOpenEditSender(sender)}
                                    className="w-8 h-8 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors"
                                    aria-label={`Edit ${displayName}`}
                                    data-testid={`button-edit-${sender.email.replace(/[@.]/g, '-')}`}
                                  >
                                    <Pencil className="w-4 h-4 text-muted-foreground" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Edit Sender</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => setShowDeleteConfirm(sender.email)}
                                    className="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 flex items-center justify-center transition-colors"
                                    data-testid={`button-delete-${sender.email.replace(/[@.]/g, '-')}`}
                                  >
                                    <Trash2 className="w-4 h-4 text-red-500" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Delete Sender</TooltipContent>
                              </Tooltip>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {filteredSenders.length === 0 && !isMobile && (
                <div className="text-center py-12">
                  <User className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
                  <p className="text-muted-foreground">No senders found</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <WaysToGetPaidModal 
        isOpen={showWaysModal} 
        onClose={() => setShowWaysModal(false)} 
        senderEmail={selectedSenderEmail}
      />

      <AnimatePresence>
        {showAddModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
              onClick={handleCloseSenderModal}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-lg"
            >
              <Card>
                <CardContent className="p-6 max-h-[85vh] overflow-y-auto">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold font-display">
                      {editingSender ? "Edit sender" : "Add new sender"}
                    </h2>
                    <button
                      type="button"
                      onClick={handleCloseSenderModal}
                      className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors"
                      aria-label="Close"
                      data-testid="button-close-add-sender"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Sender Type *</Label>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => setNewSender(prev => ({ ...prev, senderType: "individual" }))}
                          className={`flex-1 flex items-center gap-2 p-3 rounded-lg border-2 transition-colors ${
                            newSender.senderType === "individual"
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-muted-foreground/30"
                          }`}
                          data-testid="button-new-sender-type-individual"
                        >
                          <User className={`w-4 h-4 ${newSender.senderType === "individual" ? "text-primary" : "text-muted-foreground"}`} />
                          <span className={`text-sm font-medium ${newSender.senderType === "individual" ? "text-primary" : ""}`}>Individual</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewSender(prev => ({ ...prev, senderType: "business", dob: "" }))}
                          className={`flex-1 flex items-center gap-2 p-3 rounded-lg border-2 transition-colors ${
                            newSender.senderType === "business"
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-muted-foreground/30"
                          }`}
                          data-testid="button-new-sender-type-business"
                        >
                          <Building2 className={`w-4 h-4 ${newSender.senderType === "business" ? "text-primary" : "text-muted-foreground"}`} />
                          <span className={`text-sm font-medium ${newSender.senderType === "business" ? "text-primary" : ""}`}>Business</span>
                        </button>
                      </div>
                    </div>

                    {newSender.senderType === "individual" ? (
                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-2">
                          <Label>First Name *</Label>
                          <Input
                            value={newSender.firstName}
                            onChange={(e) => setNewSender(prev => ({ ...prev, firstName: e.target.value }))}
                            placeholder="First name"
                            data-testid="input-new-first-name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Middle Name</Label>
                          <Input
                            value={newSender.middleName}
                            onChange={(e) => setNewSender(prev => ({ ...prev, middleName: e.target.value }))}
                            placeholder="Middle name"
                            data-testid="input-new-middle-name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Last Name *</Label>
                          <Input
                            value={newSender.lastName}
                            onChange={(e) => setNewSender(prev => ({ ...prev, lastName: e.target.value }))}
                            placeholder="Last name"
                            data-testid="input-new-last-name"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label>Business Name *</Label>
                        <Input
                          value={newSender.businessName}
                          onChange={(e) => setNewSender(prev => ({ ...prev, businessName: e.target.value }))}
                          placeholder="Enter business name"
                          data-testid="input-new-business-name"
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>Email *</Label>
                      <Input
                        type="email"
                        value={newSender.email}
                        onChange={(e) => setNewSender(prev => ({ ...prev, email: e.target.value }))}
                        placeholder="email@example.com"
                        data-testid="input-new-email"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Phone Number</Label>
                      <div className="flex gap-2">
                        <Select 
                          value={newSender.countryCode} 
                          onValueChange={(value) => setNewSender(prev => ({ ...prev, countryCode: value }))}
                        >
                          <SelectTrigger className="w-28">
                            <SelectValue placeholder="Code" />
                          </SelectTrigger>
                          <SelectContent>
                            {COUNTRY_CODES.map((cc) => (
                              <SelectItem key={cc.code} value={cc.code}>
                                {cc.flag} {cc.code}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          value={newSender.phone}
                          onChange={(e) => setNewSender(prev => ({ ...prev, phone: e.target.value }))}
                          placeholder="Phone number"
                          className="flex-1"
                          data-testid="input-new-phone"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Country *</Label>
                      <Select 
                          value={newSender.country} 
                          onValueChange={(value) => setNewSender(prev => ({ ...prev, country: value }))}
                      >
                        <SelectTrigger data-testid="select-new-country">
                          <SelectValue placeholder="Select country" />
                        </SelectTrigger>
                        <SelectContent>
                          {COUNTRIES.map((country) => (
                            <SelectItem key={country} value={country}>{country}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {newSender.senderType === "individual" && (
                      <div className="space-y-2">
                        <Label>Date of Birth</Label>
                        <Input
                          type="date"
                          value={newSender.dob}
                          onChange={(e) => setNewSender(prev => ({ ...prev, dob: e.target.value }))}
                          data-testid="input-new-dob"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Bank Name</Label>
                        <Input
                          value={newSender.bankName}
                          onChange={(e) => setNewSender(prev => ({ ...prev, bankName: e.target.value }))}
                          placeholder="e.g. GTBank, Barclays"
                          data-testid="input-new-sender-bank-name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Account Number</Label>
                        <Input
                          value={newSender.accountNumber}
                          onChange={(e) =>
                            setNewSender(prev => ({
                              ...prev,
                              accountNumber: e.target.value.replace(/\s+/g, ""),
                            }))
                          }
                          placeholder="Account number"
                          data-testid="input-new-sender-account-number"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Narration (TXN remarks)</Label>
                      <Input
                        value={newSender.narration}
                        onChange={(e) => setNewSender(prev => ({ ...prev, narration: e.target.value }))}
                        placeholder="Purpose of collection, e.g. Invoice payment"
                        data-testid="input-new-sender-narration"
                      />
                    </div>
                  </div>

                  <div className="flex gap-3 mt-6">
                    <Button variant="outline" className="flex-1" onClick={handleCloseSenderModal}>
                      Cancel
                    </Button>
                    <Button 
                      className="flex-1" 
                      onClick={handleAddSender}
                      disabled={newSender.senderType === "individual" ? (!newSender.firstName || !newSender.lastName || !newSender.email) : (!newSender.businessName || !newSender.email)}
                      data-testid="button-confirm-add-sender"
                    >
                      {editingSender ? "Save Changes" : "Add Sender"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDeleteConfirm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
              onClick={() => setShowDeleteConfirm(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm"
            >
              <Card>
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Trash2 className="w-6 h-6 text-red-600" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Delete sender?</h3>
                  <p className="text-muted-foreground text-sm mb-6">
                    Are you sure you want to delete this sender? This action cannot be undone.
                  </p>
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1" onClick={() => setShowDeleteConfirm(null)}>
                      Cancel
                    </Button>
                    <Button 
                      variant="destructive" 
                      className="flex-1"
                      onClick={() => handleDeleteSender(showDeleteConfirm)}
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
