import { useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { ArrowLeft, Check, Circle, Copy, Loader2 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useRewards } from "@/hooks/use-rewards";
import { BonusBlockedNotice, BonusBreakdown, BONUS_COPY, SourceChip, WaysToEarn, describeCredit, isCreditSource, sourceGroupLabel, useBonusSummary, type CreditSource } from "@/features/bonus";
import { usePromoSavings, PROMO_COPY } from "@/features/promo";
import { cn } from "@/lib/utils";
import {
  CREDIT_STATUS_LABEL,
  balanceFor,
  expiryLabel,
  daysUntil,
  formatMoney,
  formatUkDate,
  referralHelpText,
  type MyReferral,
  type RewardsSummary,
  type WalletCredit,
} from "@/lib/rewards";

type Tab = "overview" | "history" | "referrals";
type HistoryFilter = "all" | "earned" | "used" | "expired" | "promo";

const STATUS_PILL: Record<WalletCredit["status"], string> = {
  UNUSED: "bg-teal-100 text-teal-800",
  PARTLY_USED: "bg-amber-100 text-amber-800",
  USED: "bg-slate-100 text-slate-700",
  EXPIRED: "bg-slate-100 text-slate-700",
  REVERSED: "bg-red-50 text-red-700",
};

const REFERRAL_PILL: Record<MyReferral["status"], { label: string; cls: string }> = {
  REGISTERED: { label: "Joined", cls: "bg-slate-100 text-slate-700" },
  PENDING: { label: "In progress", cls: "bg-blue-100 text-blue-800" },
  REWARDED: { label: "Earned", cls: "bg-teal-100 text-teal-800" },
  EXPIRED: { label: "Expired", cls: "bg-slate-100 text-slate-700" },
  NOT_ELIGIBLE: { label: "Not eligible", cls: "bg-slate-100 text-slate-700" },
  REVERSED: { label: "Reversed", cls: "bg-red-50 text-red-700" },
};

interface HistoryRow {
  id: string;
  date: string;
  description: string;
  kind: Exclude<HistoryFilter, "all">;
  amount: number;
  currency: string;
  status?: WalletCredit["status"];
  returned?: boolean;
  credit_source?: string | null;
}

type PromoRow = { id: string; code: string; amount: number; currency: string | null; created_at: string };

function buildHistory(data: RewardsSummary, currency: string, promoRows: PromoRow[]): HistoryRow[] {
  const statusById = new Map(data.wallet.credits.map((c) => [c.id, c.status]));
  const rows: HistoryRow[] = data.wallet.history
    // Repayment rows (CLAWBACK) are not shown as bonus activity; they are explained by the outstanding-repayment line
    .filter((h) => h.currency === currency && h.type !== "CLAWBACK" && h.type !== "CLAWBACK_SETTLED")
    .map((h): HistoryRow => {
      const credit_source = h.credit_source ?? null;
      if (h.type === "EARNED") {
        const returned = h.reason_code === "BONUS_RETURNED";
        return { id: h.id, date: h.created_at, description: describeCredit({ credit_source_label: h.credit_source_label, notes: h.notes, reason_code: h.reason_code }), kind: "earned", amount: h.amount, currency: h.currency, status: statusById.get(h.id), returned, credit_source };
      }
      if (h.type === "APPLIED") {
        return { id: h.id, date: h.created_at, description: `Bonus used on transfer ${h.transfer_id ?? ""}`.trim(), kind: "used", amount: h.amount, currency: h.currency, credit_source };
      }
      return {
        id: h.id, date: h.created_at, kind: "expired", amount: h.amount, currency: h.currency, credit_source,
        description: h.type === "VOIDED" ? (credit_source && credit_source !== "REFERRAL" ? "Bonus removed – transfer or request reversed" : "Referral bonus removed – transfer reversed") : "Bonus credit expired",
      };
    });
  for (const p of promoRows) {
    if ((p.currency ?? currency) !== currency) continue;
    rows.push({ id: p.id, date: p.created_at, description: PROMO_COPY.savingsRow(p.code), kind: "promo", amount: -Math.abs(p.amount), currency, credit_source: "PROMO" });
  }
  return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function StatTile({ label, value, sub, accent, children }: { label: string; value: string; sub: string; accent?: boolean; children?: React.ReactNode }) {
  return (
    <Card className="rounded-lg border border-[#efefee] bg-white p-3.5 shadow-none flex flex-col justify-between gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-[#323130]">{label}</span>
        <span className={cn("font-display text-base sm:text-xl font-semibold tracking-tight", accent ? "text-[#323130]" : "text-[#323130]")}>{value}</span>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[11px] sm:text-xs text-[#605e5c]">{sub}</span>
        {children}
      </div>
    </Card>
  );
}

function ReferralTimeline({ r }: { r: MyReferral }) {
  const steps = [
    { label: `Joined on ${formatUkDate(r.joined_on)}`, state: "done" as const },
    { label: "Transfer is on its way", state: "current" as const },
    { label: `You get ${formatMoney(r.reward, r.currency)} when it completes`, state: "upcoming" as const },
  ];
  return (
    <ol className="flex flex-col gap-2.5" aria-label={`${r.friend} progress`}>
      {steps.map((s) => (
        <li key={s.label} className="flex items-center gap-2.5">
          {s.state === "done" ? (
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-teal"><Check className="h-3 w-3 text-slate-900" strokeWidth={3} /></span>
          ) : (
            <span className={cn("h-[22px] w-[22px] rounded-full border-2", s.state === "current" ? "border-primary" : "border-slate-300")} />
          )}
          <span className={cn("text-sm", s.state === "upcoming" ? "text-slate-500" : "text-slate-800")}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

export default function BonusAndDiscounts() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const rewards = useRewards();
  const initialTab = (new URLSearchParams(search).get("tab") as Tab) || "overview";
  const [tab, setTab] = useState<Tab>(["overview", "history", "referrals"].includes(initialTab) ? initialTab : "overview");
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [pickedCurrency, setPickedCurrency] = useState<string | null>(null);
  // ?source=REFERRAL|SCHEME|MANUAL preselects the source filter (the referral screens link here)
  const sourceParam = new URLSearchParams(search).get("source")?.toUpperCase();
  const [source, setSource] = useState<CreditSource | "ALL">(isCreditSource(sourceParam) ? sourceParam : "ALL");
  const promoSavings = usePromoSavings();
  // Live bonus offers (Ways to earn). Hidden when the bonus service is not reachable.
  const bonusSummary = useBonusSummary(pickedCurrency ?? undefined);

  const data = rewards.data;
  const currencies = useMemo(() => {
    const set = new Set<string>([data?.currency ?? "GBP", ...(data?.sendCurrencies ?? []), ...(data?.wallet.balances.map((b) => b.currency) ?? [])]);
    return Array.from(set);
  }, [data]);
  const currency = pickedCurrency ?? data?.currency ?? "GBP";
  const balance = balanceFor(data?.wallet, currency);
  const unused = (data?.wallet.unused ?? []).filter((c) => c.currency === currency && (source === "ALL" || c.credit_source === source)).sort((a, b) => String(a.expires_on).localeCompare(String(b.expires_on)));
  // Promo savings come from the promo module (PROMO-RHEMITO P-50); until Mito serves them, fall back to the wallet field (P-53)
  const promoRows: PromoRow[] = promoSavings.notAvailable || (!promoSavings.savings && !promoSavings.isError)
    ? (data?.wallet.promo_redemptions ?? []).map((p) => ({ id: p.id, code: p.code, amount: p.amount, currency: p.currency, created_at: p.created_at }))
    : (promoSavings.savings?.items ?? []).map((p) => ({ id: p.id, code: p.code, amount: p.amount, currency: p.currency, created_at: p.createdAt }));
  const history = data ? buildHistory(data, currency, promoRows) : [];
  // The source filter narrows the lists only; the tiles always show the whole balance
  const bySourceRows = source === "ALL" || filter === "promo" ? history : history.filter((h) => h.credit_source === source);
  const filtered = filter === "all" ? bySourceRows : bySourceRows.filter((h) => h.kind === filter);
  const showSourceFilter = (balance.by_source?.length ?? 0) > 1 || source !== "ALL";
  const viewSource = (next: CreditSource) => {
    setSource(next);
    setFilter("all");
    setTab("history");
    setLocation(`/bonus-discounts?tab=history&source=${next}`, { replace: true });
  };
  const promoSaved = promoRows.filter((p) => (p.currency ?? currency) === currency).reduce((s, p) => s + Math.abs(p.amount), 0);
  const referrals = data?.referrals.data ?? [];
  const referralSummary = data?.referrals.summary;

  const changeTab = (value: string) => {
    setTab(value as Tab);
    setLocation(value === "overview" ? "/bonus-discounts" : `/bonus-discounts?tab=${value}`, { replace: true });
  };

  const copyLink = async () => {
    const allOffers = data?.offers && data.offers.length > 0 ? data.offers : data?.offer ? [data.offer] : [];
    const matchedOffer = allOffers.find((o) => o.currency === currency) ?? data?.offer;
    const baseLink = (matchedOffer?.referral_link ?? data?.offer?.referral_link ?? "").split("?")[0];
    const link = baseLink || (matchedOffer?.referral_link ?? data?.offer?.referral_link);


    if (!link) {
      toast({ title: "No referral offer right now", description: "There is no Refer & Earn offer for your currency at the moment." });
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: "Referral link copied!", description: "Share it with friends to earn bonus credit." });
    } catch {
      toast({ title: "We couldn't copy the link", description: `Please copy it manually: ${link}`, variant: "destructive" });
    }
  };

  return (
    <DashboardLayout>
      <div className="w-full space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Button
              variant="ghost"
              onClick={() => {
                if (tab !== "overview") {
                  setSource("ALL");
                  setFilter("all");
                  changeTab("overview");
                } else {
                  setLocation("/");
                }
              }}
              className="mb-1.5 -ml-2 h-8 px-2 text-sm text-slate-600 hover:text-slate-900"
              data-testid="button-rewards-back"
            >
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              {tab !== "overview" ? "Back to Overview" : "Back"}
            </Button>
            {/* Approved Rhemito page title (PageTitle / Reward$) — do not use Bonus & Discounts */}
            <h1 className="text-[28px] font-light tracking-tight text-slate-900 sm:text-[32px] xl:text-[40px]">
              Reward$
            </h1>
            <p className="mt-1 text-[15px] text-slate-600">Track your rewards, referrals and savings.</p>
          </div>
          {currencies.length > 1 && (
            <Select value={currency} onValueChange={setPickedCurrency}>
              <SelectTrigger className="h-9 w-[120px] rounded-full border-[#d2d0ce]" aria-label="Currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>

        <Tabs value={tab} onValueChange={changeTab}>
          <TabsList className="grid h-10 w-full grid-cols-3 rounded-lg bg-[#efefee] p-1 sm:max-w-[390px]">
            <TabsTrigger value="overview" className="h-8 rounded-[4px] text-xs sm:text-sm font-normal text-[#605e5c] data-[state=active]:bg-white data-[state=active]:font-semibold data-[state=active]:text-[#323130] data-[state=active]:shadow-none">Overview</TabsTrigger>
            <TabsTrigger value="history" className="h-8 rounded-[4px] text-xs sm:text-sm font-normal text-[#605e5c] data-[state=active]:bg-white data-[state=active]:font-semibold data-[state=active]:text-[#323130] data-[state=active]:shadow-none">History</TabsTrigger>
            <TabsTrigger value="referrals" className="h-8 rounded-[4px] text-xs sm:text-sm font-normal text-[#605e5c] data-[state=active]:bg-white data-[state=active]:font-semibold data-[state=active]:text-[#323130] data-[state=active]:shadow-none">My referrals</TabsTrigger>
          </TabsList>

          {rewards.isLoading ? (
            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="rewards-loading">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
            </div>
          ) : rewards.isError ? (
            <Card className="mt-6 rounded-xl border border-[#efefee] p-6 text-center shadow-none" data-testid="rewards-error">
              <p className="text-[15px] text-[#323130]">We couldn&apos;t load your rewards. Please try again.</p>
              <Button className="mt-4 h-10 rounded-full bg-[#2e5bff] hover:bg-blue-700" onClick={() => rewards.refetch()} disabled={rewards.isFetching}>
                {rewards.isFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Retry
              </Button>
            </Card>
          ) : (
            <>
              <TabsContent value="overview" className="mt-6 space-y-5">
                {data?.wallet.bonus_blocked && <BonusBlockedNotice />}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="bonus-totals">
                  <StatTile label="Available" value={formatMoney(balance.available, currency)} sub="Ready for your next transfer" accent>
                    {balance.available > 0 ? (
                      <Button className="mt-1 h-8 rounded-full bg-[#2e5bff] text-xs font-semibold text-white hover:bg-blue-700 shadow-none" onClick={() => setLocation("/send-money")}>Send money</Button>
                    ) : (
                      <Button variant="secondary" className="mt-1 h-8 rounded-full bg-[#efefee] text-xs font-normal text-[#605e5c] hover:bg-slate-200 border-0 shadow-none" onClick={copyLink}>Refer a friend</Button>
                    )}
                  </StatTile>
                  <StatTile
                    label="Bonus earned"
                    value={formatMoney(balance.earned, currency)}
                    sub={BONUS_COPY.tilesEarnedSub(balance.referral_credit_count + balance.other_credit_count)}
                  />
                  <StatTile label="Bonus used" value={formatMoney(balance.used, currency)} sub={`Across ${balance.used_transfer_count} transfer${balance.used_transfer_count === 1 ? "" : "s"}`} />
                  <StatTile label="Bonus expired" value={formatMoney(balance.expired, currency)} sub="Use your bonus before it expires" />
                </div>

                <p className="rounded-lg border border-[#87c2fc] bg-[#ecf5ff] p-4 text-sm sm:text-base text-[#323130]" data-testid="total-saved">
                  You&apos;ve saved <strong className="font-semibold text-[#323130]">{formatMoney(balance.used + promoSaved, currency)}</strong> in total with bonuses and promo codes.
                </p>

                <BonusBreakdown balance={balance} currency={currency} activeSource={source} onView={viewSource} />

                {source !== "ALL" && (
                  <p className="flex items-center justify-between gap-3 rounded-lg bg-[#efefee] px-3.5 py-2 text-sm text-[#323130]" data-testid="source-filter-note">
                    <span>{BONUS_COPY.sourceFilterShowing(sourceGroupLabel(source))}</span>
                    <button type="button" onClick={() => setSource("ALL")} className="font-semibold text-[#2e5bff] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded">{BONUS_COPY.clearFilter}</button>
                  </p>
                )}

                <Card className="rounded-xl border border-[#efefee] bg-white px-4 shadow-none">
                  <h2 className="mb-1 mt-3 text-[15px] font-semibold text-[#323130]">Unused bonus</h2>
                  {unused.length === 0 ? (
                    <p className="pb-4 pt-1 text-sm text-[#605e5c]">
                      {source === "ALL" ? "No unused bonus. Invite friends to earn bonus credit." : `No unused bonus from ${sourceGroupLabel(source).toLowerCase()}.`}
                    </p>
                  ) : (
                    <ul data-testid="unused-bonus">
                      {unused.map((c, i) => {
                        const left = daysUntil(c.expires_on);
                        return (
                          <li key={c.id} className={cn("flex items-center gap-3 py-3", i < unused.length - 1 && "border-b border-[#efefee]")}>
                            <div className="flex flex-1 flex-col gap-1">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="text-[15px] font-semibold text-[#323130]">{describeCredit({ credit_source_label: c.credit_source_label, source: c.source, reason_code: c.reason_code })}</span>
                                <SourceChip source={c.credit_source} />
                              </span>
                              {c.status === "PARTLY_USED" && <span className="text-[13px] text-[#605e5c]">{formatMoney(c.remaining, c.currency)} left of {formatMoney(c.amount, c.currency)}</span>}
                              <span className="text-[13px] text-[#605e5c]">Earned {formatUkDate(c.earned_on)}{c.expires_on ? ` · expires ${formatUkDate(c.expires_on)}` : ""}</span>
                              {left !== null && left <= 14 && (
                                <span className="self-start rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">{expiryLabel(c.expires_on)}</span>
                              )}
                            </div>
                            <span className="text-[15px] font-bold text-[#323130]">{formatMoney(c.remaining, c.currency)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>

                <WaysToEarn offers={bonusSummary.data?.offers ?? []} blocked={data?.wallet.bonus_blocked || bonusSummary.data?.blocked} />
              </TabsContent>

              <TabsContent value="history" className="mt-6 space-y-4">
                <div className="flex flex-wrap gap-2" role="group" aria-label="Filter history">
                  {([["all", "All"], ["earned", "Bonus earned"], ["used", "Bonus used"], ["expired", "Bonus expired"], ["promo", "Promo codes"]] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={filter === key}
                      onClick={() => setFilter(key)}
                      className={cn(
                        "h-8 rounded-full px-3.5 text-xs sm:text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 transition-colors",
                        filter === key ? "bg-[#2e5bff] text-white font-semibold" : "border border-[#d2d0ce] bg-white text-[#605e5c] hover:bg-slate-50",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {showSourceFilter && (
                  <div className="flex flex-wrap items-center gap-2" data-testid="source-filter">
                    <label htmlFor="bonus-source" className="text-sm font-medium text-[#605e5c]">{BONUS_COPY.sourceFilter}</label>
                    {source !== "ALL" && (
                      <div className="order-last flex items-center gap-3 ml-1">
                        <button
                          type="button"
                          onClick={() => setSource("ALL")}
                          className="text-xs font-semibold text-[#2e5bff] hover:underline cursor-pointer"
                          data-testid="button-clear-source-filter"
                        >
                          {BONUS_COPY.clearFilter}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSource("ALL");
                            setFilter("all");
                            changeTab("overview");
                          }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#605e5c] hover:text-[#323130] cursor-pointer"
                          data-testid="button-history-back-overview"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                          Back to Overview
                        </button>
                      </div>
                    )}
                    <Select value={source} onValueChange={(v) => setSource(v as CreditSource | "ALL")}>
                      <SelectTrigger id="bonus-source" className="h-8 w-[170px] rounded-full border-[#d2d0ce]" aria-label={BONUS_COPY.sourceFilter}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">{BONUS_COPY.allSources}</SelectItem>
                        <SelectItem value="REFERRAL">{sourceGroupLabel("REFERRAL")}</SelectItem>
                        <SelectItem value="SCHEME">{sourceGroupLabel("SCHEME")}</SelectItem>
                        <SelectItem value="MANUAL">{sourceGroupLabel("MANUAL")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Card className="rounded-xl border border-[#efefee] bg-white px-4 shadow-none">
                  {filter === "promo" && promoSavings.isError ? (
                    <p className="py-6 text-center text-sm text-[#605e5c]" role="alert">
                      {PROMO_COPY.savingsError}{" "}
                      <button type="button" className="font-semibold text-[#2e5bff] underline" onClick={() => void promoSavings.refetch()}>{PROMO_COPY.tryAgain}</button>
                    </p>
                  ) : filtered.length === 0 ? (
                    <p className="py-6 text-center text-sm text-[#605e5c]">
                      {history.length === 0 ? "No rewards yet. Invite friends or use a promo code to start saving." : filter === "used" ? "You haven't used any bonus credit yet. You can use it when you pay for a transfer." : "Nothing to show for this filter."}
                    </p>
                  ) : (
                    <ul data-testid="bonus-history">
                      {filtered.map((h, i) => (
                        <li key={h.id} className={cn("flex items-center gap-3 py-3.5", i < filtered.length - 1 && "border-b border-[#efefee]")}>
                          <div className="flex flex-1 flex-col gap-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-[15px] font-semibold text-[#323130]">{h.description}</span>
                              <SourceChip source={h.credit_source} />
                            </span>
                            <span className="text-[13px] text-[#605e5c]">{formatUkDate(h.date)}</span>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className={cn("text-[15px] font-bold", h.amount >= 0 ? "text-teal-700" : "text-[#323130]")}>
                              {h.amount >= 0 ? "+" : ""}{formatMoney(h.amount, h.currency)}
                            </span>
                            {h.returned ? (
                              <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-bold text-teal-800">Returned</span>
                            ) : (
                              h.status && <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", STATUS_PILL[h.status])}>{CREDIT_STATUS_LABEL[h.status]}</span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </TabsContent>

              <TabsContent value="referrals" className="mt-6 space-y-3.5">
                {referrals.length === 0 ? (
                  <Card className="rounded-xl border border-[#efefee] p-6 text-center shadow-none">
                    <p className="text-[15px] text-[#323130]">No referrals yet. Share your link to start earning.</p>
                    <Button className="mt-4 h-10 rounded-full bg-[#2e5bff] hover:bg-blue-700 shadow-none" onClick={copyLink}>
                      <Copy className="mr-2 h-4 w-4" /> Copy referral link
                    </Button>
                  </Card>
                ) : (
                  <>
                    <p className="text-sm text-[#323130]" data-testid="referral-summary">
                      Joined: {referralSummary?.joined ?? referrals.length} · Earned: {referralSummary?.earned_count ?? 0} · Total earned:{" "}
                      {Object.entries(referralSummary?.total_earned ?? {}).map(([c, v]) => formatMoney(v, c)).join(", ") || formatMoney(0, currency)}
                    </p>
                    <button type="button" className="self-start text-[15px] font-semibold text-[#2e5bff] hover:underline" data-testid="referral-view-credits" onClick={() => viewSource("REFERRAL")}>
                      View referral bonus in your history
                    </button>
                    {referrals.map((r) => (
                      <Card key={r.id} className="rounded-xl border border-[#efefee] bg-white p-4 flex flex-col gap-3 shadow-none" data-testid={`referral-card-${r.id}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-base font-bold text-[#323130]">{r.friend}</span>
                          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold", REFERRAL_PILL[r.status].cls)}>{REFERRAL_PILL[r.status].label}</span>
                        </div>
                        {r.status === "PENDING" ? <ReferralTimeline r={r} /> : (
                          <span className="flex items-center gap-2 text-sm text-[#605e5c]">
                            {r.status === "REWARDED" ? <Check className="h-4 w-4 text-teal-700" /> : <Circle className="h-3 w-3 text-slate-400" />}
                            {referralHelpText(r)}
                          </span>
                        )}
                      </Card>
                    ))}
                  </>
                )}
              </TabsContent>
            </>
          )}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
