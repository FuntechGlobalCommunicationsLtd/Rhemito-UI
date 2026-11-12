import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Copy, CheckCircle2, Building2, Sparkles, Lock, AlertCircle, Info, Calculator, Loader2 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FEE_CONFIG } from "./mockData";
import { createCampaign } from "@/lib/groupPay";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { PayoutAccountSelector } from "@/components/payout/PayoutAccountSelector";
import type { PayoutAccountView } from "@/lib/requests";

const CURRENCIES = ["GBP", "USD", "EUR", "NGN"];
const CURRENCY_SYMBOLS: Record<string, string> = {
    GBP: "£",
    USD: "$",
    EUR: "€",
    NGN: "₦",
};

export default function CreateCampaign() {
    const [, setLocation] = useLocation();
    const { user } = useAuth();
    const { toast } = useToast();
    const requesterName = useMemo(() => {
        if (!user) return "John Doe";
        if (user.accountType === "business" && user.businessName) {
            return user.businessName;
        }
        const fullName = [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" ");
        return fullName || "John Doe";
    }, [user]);

    const [step, setStep] = useState<'form' | 'success'>('form');
    const [copied, setCopied] = useState(false);
    const [createdCampaignLink, setCreatedCampaignLink] = useState("");
    const [createdCampaignId, setCreatedCampaignId] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedPayoutAccount, setSelectedPayoutAccount] = useState<PayoutAccountView | null>(null);

    const handleSelectPayoutAccount = (account: PayoutAccountView) => {
        setSelectedPayoutAccount(account);
        setFormData(prev => ({ ...prev, bankAccountId: account.id }));
    };

    const [formData, setFormData] = useState({
        name: "",
        targetAmount: "", // This is now "Net amount you want to receive"
        currency: "GBP",
        description: "",
        bankAccountId: "",
        useFixedAmount: false,
        fixedContributionAmount: "", // Net amount per contributor (what you want per person)
    });

    // Fee calculations for Target Amount
    const targetFeeBreakdown = useMemo(() => {
        const netAmount = parseFloat(formData.targetAmount) || 0;
        if (netAmount <= 0) return { netAmount: 0, grossAmount: 0, mitoFee: 0, feePercentage: FEE_CONFIG.PERCENTAGE * 100, fixedFee: FEE_CONFIG.FIXED_FEE };

        // Formula: Gross = (Net + Fixed) / (1 - %)
        const grossAmount = (netAmount + FEE_CONFIG.FIXED_FEE) / (1 - FEE_CONFIG.PERCENTAGE);
        const mitoFee = grossAmount - netAmount;

        return {
            netAmount,
            grossAmount,
            mitoFee,
            feePercentage: (FEE_CONFIG.PERCENTAGE * 100).toFixed(1),
            fixedFee: FEE_CONFIG.FIXED_FEE
        };
    }, [formData.targetAmount]);

    // Fee calculations for Fixed Contribution Amount
    const fixedFeeBreakdown = useMemo(() => {
        const netPerContributor = parseFloat(formData.fixedContributionAmount) || 0;
        if (netPerContributor <= 0) return { netPerContributor: 0, grossPerContributor: 0, feePerContributor: 0, feePercentage: FEE_CONFIG.PERCENTAGE * 100, fixedFee: FEE_CONFIG.FIXED_FEE };

        // Formula: Gross = (Net + Fixed) / (1 - %)
        const grossPerContributor = (netPerContributor + FEE_CONFIG.FIXED_FEE) / (1 - FEE_CONFIG.PERCENTAGE);
        const feePerContributor = grossPerContributor - netPerContributor;

        return {
            netPerContributor,
            grossPerContributor,
            feePerContributor,
            feePercentage: (FEE_CONFIG.PERCENTAGE * 100).toFixed(1),
            fixedFee: FEE_CONFIG.FIXED_FEE
        };
    }, [formData.fixedContributionAmount]);

    // Validation: Fixed contribution cannot exceed target amount (net amounts)
    const fixedAmountError = useMemo(() => {
        if (!formData.useFixedAmount || !formData.fixedContributionAmount || !formData.targetAmount) {
            return null;
        }
        const fixedNet = parseFloat(formData.fixedContributionAmount);
        const targetNet = parseFloat(formData.targetAmount);
        if (fixedNet > targetNet) {
            return "Fixed contribution (net) cannot exceed the target amount";
        }
        return null;
    }, [formData.useFixedAmount, formData.fixedContributionAmount, formData.targetAmount]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (fixedAmountError || isSubmitting) return;

        setIsSubmitting(true);
        try {
            const newCampaign = await createCampaign({
                name: formData.name,
                creatorName: requesterName,
                targetAmount: targetFeeBreakdown.grossAmount, // Store gross amount as target
                currency: formData.currency,
                description: formData.description,
                bankAccountId: selectedPayoutAccount?.id || formData.bankAccountId,
                bankAccountName: selectedPayoutAccount ? `${selectedPayoutAccount.bankName} - ${selectedPayoutAccount.maskedNumber}` : "",
                fixedContributionAmount: formData.useFixedAmount && formData.fixedContributionAmount
                    ? fixedFeeBreakdown.grossPerContributor // Store gross amount per contributor
                    : undefined,
            });

            setCreatedCampaignLink(newCampaign.uniqueLink);
            setCreatedCampaignId(newCampaign.id);
            setStep('success');
        } catch (err) {
            const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
            toast({ title: "Campaign Not Created", description: message, variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCopyLink = () => {
        navigator.clipboard.writeText(createdCampaignLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const isFormValid = formData.name && formData.targetAmount && !!selectedPayoutAccount && formData.description &&
        (!formData.useFixedAmount || (formData.useFixedAmount && formData.fixedContributionAmount && !fixedAmountError));

    return (
        <DashboardLayout>
            <div className="max-w-2xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center gap-4">
                    <Link href="/group-pay">
                        <Button variant="ghost" size="icon" className="rounded-full">
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold font-display">Create Funding Campaign</h1>
                        <p className="text-muted-foreground">Set up a new funding collection</p>
                    </div>
                </div>

                <AnimatePresence mode="wait">
                    {step === 'form' ? (
                        <motion.div
                            key="form"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                        >
                            <Card>
                                <CardContent className="p-6">
                                    <form onSubmit={handleSubmit} className="space-y-6">
                                        {/* Receiving Payout Account */}
                                        <PayoutAccountSelector
                                            requesterName={requesterName}
                                            selectedAccountId={selectedPayoutAccount?.id ?? ""}
                                            onSelect={handleSelectPayoutAccount}
                                            context="campaign"
                                        />

                                        {/* Campaign Name */}
                                        <div className="space-y-2">
                                            <Label htmlFor="name">Campaign Name *</Label>
                                            <Input
                                                id="name"
                                                placeholder="e.g. Office Birthday Collection"
                                                value={formData.name}
                                                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                                required
                                            />
                                        </div>

                                        {/* Target Amount - Now "How much do you want to collect?" */}
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-3 gap-4">
                                                <div className="col-span-2 space-y-2">
                                                    <Label htmlFor="amount">How much do you want to collect? *</Label>
                                                    <Input
                                                        id="amount"
                                                        type="number"
                                                        min="1"
                                                        step="0.01"
                                                        placeholder="500.00"
                                                        value={formData.targetAmount}
                                                        onChange={(e) => setFormData(prev => ({ ...prev, targetAmount: e.target.value }))}
                                                        required
                                                    />
                                                    <p className="text-xs text-muted-foreground">This is the net amount you will receive</p>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Currency</Label>
                                                    <Select
                                                        value={formData.currency}
                                                        onValueChange={(value) => setFormData(prev => ({ ...prev, currency: value }))}
                                                    >
                                                        <SelectTrigger>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {CURRENCIES.map(currency => (
                                                                <SelectItem key={currency} value={currency}>{currency}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>

                                            {/* Target Amount Fee Breakdown */}
                                            {formData.targetAmount && parseFloat(formData.targetAmount) > 0 && (
                                                <motion.div
                                                    initial={{ opacity: 0, height: 0 }}
                                                    animate={{ opacity: 1, height: "auto" }}
                                                    className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100"
                                                >
                                                    <div className="flex items-center gap-2 text-sm font-semibold text-blue-800 mb-3">
                                                        <Calculator className="w-4 h-4" />
                                                        Campaign Target Calculation
                                                    </div>
                                                    <div className="space-y-2 text-sm">
                                                        <div className="flex justify-between">
                                                            <span className="text-gray-600">You want to receive</span>
                                                            <span className="font-medium">{CURRENCY_SYMBOLS[formData.currency] ?? "£"}{targetFeeBreakdown.netAmount.toFixed(2)}</span>
                                                        </div>
                                                        <div className="flex justify-between text-orange-600">
                                                            <span>+ Mito Fee ({targetFeeBreakdown.feePercentage}% + {CURRENCY_SYMBOLS[formData.currency] ?? "£"}{targetFeeBreakdown.fixedFee.toFixed(2)})</span>
                                                            <span className="font-medium">{CURRENCY_SYMBOLS[formData.currency] ?? "£"}{targetFeeBreakdown.mitoFee.toFixed(2)}</span>
                                                        </div>
                                                        <div className="border-t border-blue-200 pt-2 flex justify-between font-bold">
                                                            <span className="text-blue-800">Campaign Target</span>
                                                            <span className="text-blue-600">{CURRENCY_SYMBOLS[formData.currency] ?? "£"}{targetFeeBreakdown.grossAmount.toFixed(2)}</span>
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            )}
                                        </div>

                                        {/* Description */}
                                        <div className="space-y-2">
                                            <Label htmlFor="description">Description *</Label>
                                            <Textarea
                                                id="description"
                                                placeholder="Describe what this campaign is for..."
                                                rows={3}
                                                value={formData.description}
                                                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                                required
                                            />
                                        </div>

                                        {/* Fixed Contribution Amount Toggle */}
                                        <div className="space-y-4 p-4 bg-blue-50/50 rounded-xl border border-blue-100">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                                                        <Lock className="w-5 h-5 text-blue-600" />
                                                    </div>
                                                    <div>
                                                        <Label htmlFor="fixed-amount-toggle" className="text-sm font-semibold cursor-pointer">
                                                            Fixed Contribution Amount
                                                        </Label>
                                                        <p className="text-xs text-muted-foreground">
                                                            All contributors must pay the same amount
                                                        </p>
                                                    </div>
                                                </div>
                                                <Switch
                                                    id="fixed-amount-toggle"
                                                    checked={formData.useFixedAmount}
                                                    onCheckedChange={(checked) => setFormData(prev => ({
                                                        ...prev,
                                                        useFixedAmount: checked,
                                                        fixedContributionAmount: checked ? prev.fixedContributionAmount : ""
                                                    }))}
                                                />
                                            </div>

                                            {formData.useFixedAmount && (
                                                <motion.div
                                                    initial={{ opacity: 0, height: 0 }}
                                                    animate={{ opacity: 1, height: "auto" }}
                                                    exit={{ opacity: 0, height: 0 }}
                                                    className="space-y-4"
                                                >
                                                    <div className="space-y-2">
                                                        <Label htmlFor="fixed-amount">How much do you want per contributor? *</Label>
                                                        <div className="flex gap-2">
                                                            <Input
                                                                id="fixed-amount"
                                                                type="number"
                                                                min="1"
                                                                step="0.01"
                                                                placeholder="25.00"
                                                                value={formData.fixedContributionAmount}
                                                                onChange={(e) => setFormData(prev => ({ ...prev, fixedContributionAmount: e.target.value }))}
                                                                className={`flex-1 ${fixedAmountError ? 'border-red-300 focus:ring-red-200' : ''}`}
                                                                required={formData.useFixedAmount}
                                                            />
                                                            <div className="w-20 flex items-center justify-center bg-gray-100 rounded-lg text-sm font-medium text-gray-600">
                                                                {formData.currency}
                                                            </div>
                                                        </div>
                                                        <p className="text-xs text-muted-foreground">This is the net amount you receive per contributor</p>
                                                    </div>

                                                    {fixedAmountError && (
                                                        <motion.div
                                                            initial={{ opacity: 0 }}
                                                            animate={{ opacity: 1 }}
                                                            className="flex items-center gap-2 text-sm text-red-600"
                                                        >
                                                            <AlertCircle className="w-4 h-4" />
                                                            {fixedAmountError}
                                                        </motion.div>
                                                    )}

                                                    {/* Fixed Amount Fee Breakdown */}
                                                    {formData.fixedContributionAmount && parseFloat(formData.fixedContributionAmount) > 0 && !fixedAmountError && (
                                                        <motion.div
                                                            initial={{ opacity: 0 }}
                                                            animate={{ opacity: 1 }}
                                                            className="bg-white rounded-lg p-4 border border-blue-200"
                                                        >
                                                            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
                                                                <Info className="w-4 h-4 text-blue-500" />
                                                                Per Contributor Calculation
                                                            </div>
                                                            <div className="space-y-2 text-sm">
                                                                <div className="flex justify-between">
                                                                    <span className="text-gray-600">You receive per person</span>
                                                                    <span className="font-medium">{CURRENCY_SYMBOLS[formData.currency] ?? "£"}{fixedFeeBreakdown.netPerContributor.toFixed(2)}</span>
                                                                </div>
                                                                <div className="flex justify-between text-orange-600">
                                                                    <span>+ Mito Fee ({fixedFeeBreakdown.feePercentage}% + {CURRENCY_SYMBOLS[formData.currency] ?? "£"}{fixedFeeBreakdown.fixedFee.toFixed(2)})</span>
                                                                    <span className="font-medium">{CURRENCY_SYMBOLS[formData.currency] ?? "£"}{fixedFeeBreakdown.feePerContributor.toFixed(2)}</span>
                                                                </div>
                                                                <div className="border-t pt-2 flex justify-between font-bold">
                                                                    <span className="text-gray-900">Each contributor pays</span>
                                                                    <span className="text-green-600">{CURRENCY_SYMBOLS[formData.currency] ?? "£"}{fixedFeeBreakdown.grossPerContributor.toFixed(2)}</span>
                                                                </div>
                                                            </div>
                                                        </motion.div>
                                                    )}
                                                </motion.div>
                                            )}
                                        </div>

                                        {/* Submit */}
                                        <Button
                                            type="submit"
                                            disabled={!isFormValid || isSubmitting}
                                            className="w-full h-12 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-lg font-semibold"
                                        >
                                            {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
                                            Create Funding Campaign
                                        </Button>
                                    </form>
                                </CardContent>
                            </Card>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="success"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                        >
                            <Card className="overflow-hidden">
                                {/* Success Header */}
                                <div className="bg-gradient-to-br from-green-500 to-emerald-600 p-8 text-white text-center">
                                    <motion.div
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        transition={{ type: "spring", delay: 0.2 }}
                                        className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4"
                                    >
                                        <Sparkles className="w-8 h-8" />
                                    </motion.div>
                                    <h2 className="text-2xl font-bold mb-2">Campaign Created!</h2>
                                    <p className="text-green-100">Your funding campaign is ready to share</p>
                                </div>

                                <CardContent className="p-6 space-y-6">
                                    {/* Campaign Link */}
                                    <div className="space-y-2">
                                        <Label>Share this link with contributors</Label>
                                        <div className="flex gap-2">
                                            <Input
                                                value={createdCampaignLink}
                                                readOnly
                                                className="bg-gray-50 font-mono text-sm"
                                            />
                                            <Button
                                                variant="outline"
                                                size="icon"
                                                onClick={handleCopyLink}
                                                className={copied ? "bg-green-50 text-green-600 border-green-200" : ""}
                                            >
                                                {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                            </Button>
                                        </div>
                                        {copied && (
                                            <motion.p
                                                initial={{ opacity: 0, y: -10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="text-sm text-green-600 font-medium"
                                            >
                                                Link copied to clipboard!
                                            </motion.p>
                                        )}
                                    </div>

                                    {/* Actions */}
                                    <div className="flex gap-3">
                                        <Link href="/group-pay" className="flex-1">
                                            <Button variant="outline" className="w-full">
                                                Back to Dashboard
                                            </Button>
                                        </Link>
                                        <Link href={`/group-pay/${createdCampaignId}`} className="flex-1">
                                            <Button className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700">
                                                View Campaign
                                            </Button>
                                        </Link>
                                    </div>
                                </CardContent>
                            </Card>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </DashboardLayout>
    );
}
