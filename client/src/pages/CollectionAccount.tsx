import { useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Copy } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { welcomeName } from "@/lib/userDisplay";
import { getSendMoneyTransactions } from "@/lib/sendMoney";
import { cn } from "@/lib/utils";
import {
  COLLECTION_CURRENCY_ACCOUNTS,
  WALLET_CURRENCY_ACCOUNTS,
  formatAccountAmount,
  type CollectionCurrencyAccount,
  type WalletCurrencyAccount,
} from "@/data/collectionAccounts";

export default function CollectionAccount() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { user, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();

  const activeTab: "collection" | "wallet" = useMemo(() => {
    const params = new URLSearchParams(searchString);
    const raw = params.get("tab")?.toLowerCase();
    return raw === "wallet" || raw === "wallets" ? "wallet" : "collection";
  }, [searchString]);

  const [selectedCollectionCode, setSelectedCollectionCode] =
    useState<CollectionCurrencyAccount["code"]>("GBP");
  const [selectedWalletCode, setSelectedWalletCode] =
    useState<WalletCurrencyAccount["code"]>("GBP");

  const isDemoUser = !isAuthLoading && (!user || user.id === "user_123");

  const sendMoneyQuery = useQuery({
    queryKey: ["/api/send-money/transactions", user?.id ?? "demo"],
    queryFn: getSendMoneyTransactions,
    enabled: !isAuthLoading,
  });

  const accountHolderName = useMemo(() => {
    if (user) {
      const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
      if (full) return full;
      const fallback = welcomeName(user);
      if (fallback) return fallback;
    }
    return "John Doe";
  }, [user]);

  const selectedCollection =
    COLLECTION_CURRENCY_ACCOUNTS.find((a) => a.code === selectedCollectionCode) ??
    COLLECTION_CURRENCY_ACCOUNTS[0];

  const selectedWallet =
    WALLET_CURRENCY_ACCOUNTS.find((w) => w.code === selectedWalletCode) ??
    WALLET_CURRENCY_ACCOUNTS[0];

  const walletStatsByCurrency = useMemo(() => {
    const completedTxs = (sendMoneyQuery.data ?? []).filter(
      (tx) => tx.status === "completed"
    );
    const map: Record<
      WalletCurrencyAccount["code"],
      { balanceText: string; amountSentText: string; txCount: number }
    > = {
      GBP: { balanceText: "0.00", amountSentText: "0.00", txCount: 0 },
      NGN: { balanceText: "0.00", amountSentText: "0.00", txCount: 0 },
    };

    for (const acct of WALLET_CURRENCY_ACCOUNTS) {
      if (isDemoUser) {
        map[acct.code] = {
          balanceText: formatAccountAmount(acct.demoBalance),
          amountSentText: formatAccountAmount(acct.demoAmountSent),
          txCount: acct.demoTxCount,
        };
      } else {
        const matching = completedTxs.filter(
          (tx) => (tx.sendCurrency || "GBP").toUpperCase() === acct.code
        );
        const sumSent = matching.reduce(
          (acc, tx) => acc + Number(tx.sendAmount || 0),
          0
        );
        map[acct.code] = {
          balanceText: "0.00",
          amountSentText: formatAccountAmount(sumSent),
          txCount: matching.length,
        };
      }
    }
    return map;
  }, [isDemoUser, sendMoneyQuery.data]);

  const activeWalletStats = walletStatsByCurrency[selectedWallet.code];

  const handleCopyCollectionDetails = async () => {
    const detailsText = [
      `Currency: ${selectedCollection.name} (${selectedCollection.code})`,
      `Bank Country: ${selectedCollection.bankCountry}`,
      `Account Holder's Name: ${accountHolderName}`,
      `Bank Name: ${selectedCollection.bankName}`,
      `Account Number: ${selectedCollection.accountNumber}`,
      `Bank Address: ${selectedCollection.bankAddress}`,
      `${selectedCollection.routingLabel}: ${selectedCollection.routingValue}`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(detailsText);
      toast({
        title: "Account details copied",
        description: `${selectedCollection.name} (${selectedCollection.code}) details copied to clipboard.`,
      });
    } catch {
      toast({
        title: "Unable to copy",
        description: "Please copy the account details manually.",
        variant: "destructive",
      });
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-5xl pb-8" data-testid="page-collection-account">
        <h1
          className="text-xl md:text-[22px] font-normal text-[#323130] tracking-tight"
          data-testid="heading-collection-account"
        >
          Payment account
        </h1>

        <button
          type="button"
          onClick={() => setLocation("/")}
          data-testid="button-back-overview"
          className="mt-5 mb-5 inline-flex items-center gap-1.5 text-sm text-[#323130] hover:text-[#2e5bff] transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4 text-[#605e5c]" />
          <span>Back</span>
        </button>

        {/* Underline Tabs */}
        <div
          className="flex items-center gap-6 px-1"
          role="tablist"
          aria-label="Payments account and Wallets"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "collection"}
            data-testid="tab-collection-accounts"
            onClick={() => setLocation("/overview/collectionaccount")}
            className={cn(
              "border-b-2 pb-2 text-xs sm:text-[13px] transition-colors cursor-pointer",
              activeTab === "collection"
                ? "border-[#2e5bff] font-medium text-[#323130]"
                : "border-transparent font-normal text-[#605e5c] hover:text-[#323130]"
            )}
          >
            Payments account
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "wallet"}
            data-testid="tab-wallets"
            onClick={() => setLocation("/overview/collectionaccount?tab=wallet")}
            className={cn(
              "border-b-2 pb-2 text-xs sm:text-[13px] transition-colors cursor-pointer",
              activeTab === "wallet"
                ? "border-[#2e5bff] font-medium text-[#323130]"
                : "border-transparent font-normal text-[#605e5c] hover:text-[#323130]"
            )}
          >
            Wallets
          </button>
        </div>

        {/* Main Card Container */}
        <div className="rounded-xl border border-[#f3f2f1] bg-white p-4 sm:p-6 shadow-[0_4px_24px_rgba(0,0,0,0.05)]">
          {activeTab === "collection" ? (
            <div
              className="flex flex-col md:flex-row gap-5 md:gap-6 items-stretch"
              data-testid="panel-collection-accounts"
            >
              {/* Left Currency Rail */}
              <div className="md:w-[195px] lg:w-[215px] shrink-0 space-y-2">
                {COLLECTION_CURRENCY_ACCOUNTS.map((acct) => {
                  const isSelected = acct.code === selectedCollection.code;
                  const balanceStr = isDemoUser
                    ? formatAccountAmount(acct.demoBalance)
                    : "0.00";
                  return (
                    <button
                      key={acct.code}
                      type="button"
                      onClick={() => setSelectedCollectionCode(acct.code)}
                      data-testid={`collection-currency-${acct.code.toLowerCase()}`}
                      className={cn(
                        "w-full border-l-2 pl-3 pr-2 py-2 text-left transition-colors cursor-pointer",
                        isSelected
                          ? "border-[#2e5bff]"
                          : "border-transparent hover:bg-slate-50/80 rounded-r-md"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <img
                            src={`https://flagcdn.com/w40/${acct.flagCode}.png`}
                            alt={acct.code}
                            className="h-[18px] w-7 shrink-0 rounded-[2px] object-cover shadow-2xs"
                          />
                          <span className="truncate text-xs text-[#605e5c]">
                            {acct.name}
                          </span>
                        </div>
                        <span className="text-xs font-medium text-[#323130] shrink-0">
                          {acct.code}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-[#323130]">
                        <span>Balance:</span>
                        <span className="font-medium tabular-nums">{balanceStr}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Right Details Panel */}
              <div className="flex-1 rounded-lg bg-[#ECF5FF] p-5 sm:p-6 flex flex-col justify-between min-h-[290px]">
                <div>
                  <h2
                    className="text-sm sm:text-[15px] font-semibold text-[#1b1a19] mb-4"
                    data-testid="collection-details-heading"
                  >
                    Below are the details of your {selectedCollection.name} payments account
                  </h2>

                  <div className="rounded-xl bg-white p-5 sm:p-6 shadow-2xs">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-[13px] sm:text-sm font-semibold text-[#1b1a19]">
                        Regular payments
                      </h3>
                      <button
                        type="button"
                        onClick={handleCopyCollectionDetails}
                        data-testid="button-copy-collection-details"
                        aria-label="Copy payment account details"
                        className="rounded-md p-1.5 text-[#323130] hover:bg-slate-100 transition-colors cursor-pointer"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-xs sm:text-[13px]">
                      <div>
                        <div className="font-semibold text-[#1b1a19]">Bank country</div>
                        <div className="mt-0.5 text-[#323130]">
                          {selectedCollection.bankCountry}
                        </div>
                      </div>

                      <div>
                        <div className="font-semibold text-[#1b1a19]">
                          Account holder&apos;s name
                        </div>
                        <div className="mt-0.5 text-[#323130]">{accountHolderName}</div>
                      </div>

                      <div>
                        <div className="font-semibold text-[#1b1a19]">Bank name</div>
                        <div className="mt-0.5 text-[#323130]">
                          {selectedCollection.bankName}
                        </div>
                      </div>

                      <div>
                        <div className="font-semibold text-[#1b1a19]">Account number</div>
                        <div className="mt-0.5 text-[#323130] tabular-nums">
                          {selectedCollection.accountNumber}
                        </div>
                      </div>

                      <div>
                        <div className="font-semibold text-[#1b1a19]">Bank address</div>
                        <div className="mt-0.5 text-[#323130]">
                          {selectedCollection.bankAddress}
                        </div>
                      </div>

                      <div>
                        <div className="font-semibold text-[#1b1a19]">
                          {selectedCollection.routingLabel.charAt(0) +
                            selectedCollection.routingLabel.slice(1).toLowerCase()}
                        </div>
                        <div className="mt-0.5 text-[#323130] tabular-nums">
                          {selectedCollection.routingValue}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      setLocation(`/send-money?currency=${selectedCollection.code}`)
                    }
                    data-testid="button-collection-send-money"
                    className="text-xs font-semibold text-[#1b1a19] hover:text-[#2e5bff] transition-colors cursor-pointer"
                  >
                    Send Money
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div
              className="flex flex-col md:flex-row gap-5 md:gap-6 items-stretch"
              data-testid="panel-wallets"
            >
              {/* Left Currency Rail */}
              <div className="md:w-[195px] lg:w-[215px] shrink-0 space-y-2">
                {WALLET_CURRENCY_ACCOUNTS.map((acct) => {
                  const isSelected = acct.code === selectedWallet.code;
                  const stats = walletStatsByCurrency[acct.code];
                  return (
                    <button
                      key={acct.code}
                      type="button"
                      onClick={() => setSelectedWalletCode(acct.code)}
                      data-testid={`wallet-currency-${acct.code.toLowerCase()}`}
                      className={cn(
                        "w-full border-l-2 pl-3 pr-2 py-2 text-left transition-colors cursor-pointer",
                        isSelected
                          ? "border-[#2e5bff]"
                          : "border-transparent hover:bg-slate-50/80 rounded-r-md"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <img
                            src={`https://flagcdn.com/w40/${acct.flagCode}.png`}
                            alt={acct.code}
                            className="h-[18px] w-7 shrink-0 rounded-[2px] object-cover shadow-2xs"
                          />
                          <span className="truncate text-xs text-[#605e5c]">
                            {acct.name}
                          </span>
                        </div>
                        <span className="text-xs font-medium text-[#323130] shrink-0">
                          {acct.code}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-[#323130]">
                        <span>Balance:</span>
                        <span className="font-medium tabular-nums">
                          {stats.balanceText}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Right Wallet Details Panel */}
              <div className="flex-1 rounded-lg bg-[#ECF5FF] p-5 sm:p-6 flex flex-col justify-between min-h-[260px]">
                <div>
                  <h2
                    className="text-sm sm:text-[15px] font-semibold text-[#1b1a19]"
                    data-testid="wallet-details-heading"
                  >
                    Below are the details of your {selectedWallet.code} wallet
                  </h2>

                  <div className="mt-6 space-y-4 text-xs sm:text-[13px]">
                    <div className="space-y-0.5">
                      <div className="font-semibold text-[#1b1a19]">Wallet balance</div>
                      <div
                        className="text-[#323130] tabular-nums"
                        data-testid="wallet-detail-balance"
                      >
                        {selectedWallet.code} {activeWalletStats.balanceText}
                      </div>
                    </div>

                    <div className="space-y-0.5">
                      <div className="font-semibold text-[#1b1a19]">Amount sent</div>
                      <div
                        className="text-[#323130] tabular-nums"
                        data-testid="wallet-detail-amount-sent"
                      >
                        {selectedWallet.code} {activeWalletStats.amountSentText}
                      </div>
                    </div>

                    <div className="space-y-0.5">
                      <div className="font-semibold text-[#1b1a19]">
                        Number of transactions
                      </div>
                      <div
                        className="text-[#323130] tabular-nums"
                        data-testid="wallet-detail-tx-count"
                      >
                        {activeWalletStats.txCount}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      setLocation(`/send-money?currency=${selectedWallet.code}`)
                    }
                    data-testid="button-wallet-send-money"
                    className="text-xs font-semibold text-[#1b1a19] hover:text-[#2e5bff] transition-colors cursor-pointer"
                  >
                    Send Money
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-5">
          <button
            type="button"
            onClick={() => setLocation("/transactions")}
            data-testid="link-view-transaction-history"
            className="text-xs sm:text-[13px] font-medium text-[#2e5bff] hover:underline cursor-pointer"
          >
            View Transaction History
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}
