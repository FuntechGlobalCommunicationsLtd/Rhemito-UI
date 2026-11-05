import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Check, ChevronDown, ChevronUp, Copy, RefreshCw, Share2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatMoney, referralCodeForCurrency, buildReferralShareMessage, buildReferralShareTitle, type RewardOffer, type MyReferral } from "@/lib/rewards";

interface ReferEarnCardProps {
  offer: RewardOffer | null;
  offers?: RewardOffer[];
  sendCurrencies?: string[];
  referrals: MyReferral[];
  /** Totals across every referral, so the card stays the same height however many friends join. */
  summary?: { joined: number; earned_count: number; total_earned: Record<string, number> };
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  highlighted?: boolean;
  /** Whether the Refer & Earn card starts collapsed on the Dashboard (expands on click or when highlighted). */
  defaultCollapsed?: boolean;
}

function formatBoldAmounts(text: string) {
  const parts = text.split(/((?:£|\$|€|₦|₹|¥|A\$|C\$|R|KSh |GH₵|AED )\d[\d,]*(?:\.\d{2})?)/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={i} className="text-slate-900">{p}</strong> : <span key={i}>{p}</span>));
}

/** Renders the offer sentence with the money amounts in bold. */
function OfferSentence({ text }: { text: string }) {
  return (
    <p className="text-sm leading-relaxed text-slate-600" data-testid="refer-offer-text">
      {formatBoldAmounts(text)}
    </p>
  );
}

/** Dashboard Refer & Earn card — side-by-side companion to "Your bonus credits". */
export function ReferEarnCard({
  offer,
  offers,
  referrals,
  summary,
  isLoading,
  isError,
  onRetry,
  highlighted,
  defaultCollapsed = false,
}: ReferEarnCardProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [selectedRuleId, setSelectedRuleId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (highlighted) {
      setCollapsed(false);
    }
  }, [highlighted]);

  if (isLoading) {
    return (
      <Card className="h-full rounded-2xl border border-slate-200/80 bg-white p-5 flex flex-col gap-4 shadow-2xs" data-testid="refer-earn-loading">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="h-full rounded-2xl border border-slate-200/80 bg-white p-5 flex flex-col shadow-2xs" data-testid="refer-earn-error">
        <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900">Refer &amp; Earn</h2>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center" role="alert">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <RefreshCw className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="max-w-[240px] text-sm text-slate-600">
            We couldn&apos;t load your referral details. Please check your connection and try again.
          </p>
          <Button type="button" variant="outline" onClick={onRetry} className="min-h-[44px] rounded-xl px-6 font-semibold">
            Try again
          </Button>
        </div>
      </Card>
    );
  }

  // No active rule for the customer's currency → no card (AC-2.1.5)
  if (!offer) return null;

  const additionalOffers = (offers ?? []).filter((o) => o.rule_id !== offer.rule_id || o.currency !== offer.currency);
  const allOffers = [offer, ...additionalOffers];
  const activeOffer = (selectedRuleId !== null ? allOffers.find((o) => o.rule_id === selectedRuleId) : null) ?? offer;

  const isMultiCurrency = allOffers.length > 1;
  const rawCode = activeOffer.referral_code ?? offer.referral_code ?? "";
  const effectiveCode = isMultiCurrency && rawCode
    ? referralCodeForCurrency(rawCode, activeOffer.currency)
    : rawCode;
  const rawBaseLink = (activeOffer.referral_link ?? offer.referral_link ?? "").split("?")[0];
  const link = isMultiCurrency && effectiveCode && rawBaseLink.includes("/ref/")
    ? `${rawBaseLink.replace(/\/ref\/[^/]+$/, "")}/ref/${effectiveCode}`
    : rawBaseLink || (activeOffer.referral_link ?? offer.referral_link ?? "");
  const joined = summary?.joined ?? referrals.length;
  const waiting = Math.max(0, joined - (summary?.earned_count ?? 0));
  const earnedText =
    Object.entries(summary?.total_earned ?? {}).filter(([, v]) => v > 0).map(([c, v]) => formatMoney(v, c)).join(" + ") ||
    formatMoney(0, activeOffer.currency);

  const shareTitle = buildReferralShareTitle({ offer: activeOffer, code: effectiveCode, link });
  const shareHook = buildReferralShareMessage({ offer: activeOffer, code: effectiveCode, link, includeUrl: false });
  const fullMarketingMessage = buildReferralShareMessage({ offer: activeOffer, code: effectiveCode, link, includeUrl: true });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2500);
      toast({ title: "Referral link copied!", description: "Share it with friends to earn bonus credit." });
    } catch {
      inputRef.current?.select();
      toast({ title: "We couldn't copy the link", description: "Please copy it manually.", variant: "destructive" });
    }
  };

  const handleCopyMarketingMessage = async () => {
    try {
      await navigator.clipboard.writeText(fullMarketingMessage);
      setCopiedMessage(true);
      setTimeout(() => setCopiedMessage(false), 2500);
      toast({
        title: "Invite message & link copied!",
        description: "Paste it into WhatsApp, SMS, or email to invite your friends.",
      });
    } catch {
      toast({ title: "We couldn't copy the message", description: "Please copy it manually.", variant: "destructive" });
    }
  };

  const handleShare = async () => {
    if (canShare) {
      try {
        await navigator.share({ title: shareTitle, text: shareHook, url: link });
        return;
      } catch {
        // Share sheet closed by the customer — nothing to do
        return;
      }
    }
    setShareOpen(true);
  };

  return (
    <Card
      id="refer-earn"
      data-testid="refer-earn-card"
      className={cn(
        "h-full rounded-2xl border border-slate-200/80 bg-white p-5 flex flex-col justify-between gap-4 shadow-2xs transition-shadow duration-300",
        highlighted && "ring-2 ring-primary ring-offset-2",
      )}
    >
      <div className="flex flex-col gap-4">
        {/* Card Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900 leading-tight">Refer &amp; Earn</h2>
            <p className="text-sm text-slate-500 mt-0.5">Share a little. Earn a little.</p>
          </div>
          <div className="flex items-center gap-2">
            {!collapsed && (
              <button
                type="button"
                onClick={() => setHowOpen(true)}
                className="inline-flex items-center gap-1 text-[13px] sm:text-sm font-semibold text-blue-600 hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded cursor-pointer"
              >
                <span>How it works</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            {defaultCollapsed && (
              <button
                type="button"
                onClick={() => setCollapsed((v) => !v)}
                aria-expanded={!collapsed}
                data-testid="toggle-refer-earn-card"
                className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3.5 py-1.5 text-[13px] sm:text-sm font-semibold text-blue-700 transition-colors cursor-pointer"
              >
                <span>{collapsed ? "Show Refer & Earn" : "Hide"}</span>
                {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </button>
            )}
          </div>
        </div>

        {/* Currency Corridor Switcher Pills — only applicable rules */}
        {!collapsed && allOffers.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex flex-wrap items-center gap-1 rounded-full bg-slate-100 p-1"
              data-testid="refer-corridor-pills"
              aria-label="Select referral corridor rule"
            >
              {allOffers.map((o) => {
                const isSelected = o.rule_id === activeOffer.rule_id && o.currency === activeOffer.currency;
                const label = o.receive_currency
                  ? `${o.currency} → ${o.receive_currency}`
                  : `${o.currency} → ALL`;
                return (
                  <button
                    key={`corridor-${o.rule_id}-${o.currency}-${o.receive_currency ?? "ALL"}`}
                    type="button"
                    onClick={() => {
                      setSelectedRuleId(o.rule_id);
                      setCopied(false);
                    }}
                    aria-pressed={isSelected}
                    className={cn(
                      "rounded-full px-4 py-1 text-[13px] sm:text-sm font-semibold transition-colors cursor-pointer",
                      isSelected ? "bg-blue-600 text-white shadow-2xs" : "text-slate-600 hover:text-slate-900",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <span className="sr-only" data-testid="refer-currency-hint">
              Click a currency corridor to see its rewards
            </span>
          </div>
        )}

        {!collapsed && (
          <>
            {activeOffer.cap_reached ? (
              <p className="text-[15px] leading-[23px] text-slate-700" data-testid="refer-cap-reached">
                You&apos;ve reached the maximum referral rewards for this programme. Thank you for spreading the word!
              </p>
            ) : (
              <>
                {/* Soft Blue Split Offer Box */}
                <div className="rounded-2xl bg-[#EEF4FF] border border-blue-100/80 p-4">
                  <div className="grid grid-cols-2 divide-x divide-slate-200/90">
                    <div className="pr-3">
                      <p className="text-sm font-medium text-slate-600">You get</p>
                      <p className="font-display text-2xl sm:text-[28px] font-bold text-slate-900 tracking-tight mt-0.5">
                        {formatMoney(activeOffer.referrer_reward, activeOffer.currency)}
                      </p>
                    </div>
                    <div className="pl-4">
                      <p className="text-sm font-medium text-slate-600">Your friend gets</p>
                      <p className="font-display text-2xl sm:text-[28px] font-bold text-slate-900 tracking-tight mt-0.5">
                        {formatMoney(activeOffer.referee_reward, activeOffer.currency)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2.5">
                    <OfferSentence text={activeOffer.text} />
                  </div>
                </div>

                {/* Referral Link + Integrated Copy Button */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="referral-link" className="text-sm font-semibold text-slate-700">
                      Your referral link
                    </label>
                    {effectiveCode && (
                      <span
                        className="font-mono text-[13px] sm:text-sm font-semibold text-blue-600"
                        data-testid="refer-active-code"
                      >
                        {effectiveCode}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-1 pl-3.5">
                    <input
                      id="referral-link"
                      ref={inputRef}
                      readOnly
                      value={link.replace(/^https?:\/\//, "")}
                      onFocus={(e) => e.currentTarget.select()}
                      className="h-10 flex-1 min-w-0 bg-transparent text-sm font-semibold text-slate-800 focus:outline-none truncate"
                    />
                    <Button
                      type="button"
                      onClick={handleCopy}
                      className={cn(
                        "h-10 rounded-lg px-4 text-sm font-semibold text-white shrink-0",
                        copied ? "bg-teal-700 hover:bg-teal-800" : "bg-blue-600 hover:bg-blue-700",
                      )}
                    >
                      {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
                      {copied ? "Copied" : "Copy link"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleShare}
                      data-testid="refer-share-btn"
                      className="h-10 rounded-lg border-slate-300 px-3.5 text-sm font-semibold text-slate-900 shrink-0"
                    >
                      <Share2 className="mr-1.5 h-4 w-4" />
                      Share
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setShareOpen(true)}
                      data-testid="refer-preview-marketing-btn"
                      className="inline-flex items-center gap-1 text-[13px] sm:text-sm font-semibold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
                    >
                      <span>Preview &amp; copy full invite message</span>
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Footer Status / Totals */}
      {!collapsed && (
        <div className="flex flex-col gap-2.5 pt-1" data-testid="refer-latest">
          {joined === 0 ? (
            <p className="text-sm text-slate-500">No referrals yet. Share your link to start earning.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2.5" data-testid="refer-stats">
                <div className="rounded-xl bg-slate-50 px-3.5 py-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Friends joined</p>
                  <p className="mt-0.5 font-display text-xl font-bold leading-none text-slate-900" data-testid="refer-count">
                    {joined}
                  </p>
                </div>
                <div className="rounded-xl bg-teal-50 px-3.5 py-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">Bonus earned</p>
                  <p className="mt-0.5 font-display text-xl font-bold leading-none text-teal-700" data-testid="refer-earned">
                    {earnedText}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {waiting > 0 && (
                  <p className="text-sm text-slate-500" data-testid="refer-waiting">
                    {waiting} {waiting === 1 ? "friend is" : "friends are"} yet to send {formatMoney(offer.floor, offer.currency)}+
                  </p>
                )}
                <Link
                  href="/bonus-discounts?tab=referrals"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline"
                >
                  View all referrals
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </>
          )}
        </div>
      )}

      <Dialog open={howOpen} onOpenChange={setHowOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">How Refer &amp; Earn works</DialogTitle>
            <DialogDescription>{offer.text}</DialogDescription>
          </DialogHeader>
          {additionalOffers.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Applicable referral rules by currency corridor
              </p>
              {allOffers.map((o) => (
                <div key={`dialog-${o.rule_id}-${o.currency}-${o.receive_currency ?? "ALL"}`} className="flex items-start gap-2 text-sm text-slate-700">
                  <span className="mt-0.5 shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-bold text-blue-800">
                    {o.receive_currency ? `${o.currency} → ${o.receive_currency}` : `${o.currency} → ALL`}
                  </span>
                  <span>{o.text}</span>
                </div>
              ))}
            </div>
          )}
          <ol className="flex flex-col gap-3 text-[15px] text-slate-700">
            <li><strong className="text-slate-900">1.</strong> Share your universal link. Your friend signs up with it and verifies their email.</li>
            <li><strong className="text-slate-900">2.</strong> They send {formatMoney(offer.floor, offer.currency)} or more within {offer.qualification_window_days} days of joining.</li>
            <li><strong className="text-slate-900">3.</strong> When that transfer completes, the bonus credit is added. Use it within {offer.bonus_validity_days} days.</li>
          </ol>
          <p className="text-sm text-slate-500">Each friend can be rewarded once. Self-referrals and duplicate accounts are not rewarded.</p>
        </DialogContent>
      </Dialog>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="sm:max-w-lg" data-testid="refer-share-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">Share your Rhemito invite</DialogTitle>
            <DialogDescription>
              This message clearly explains your friend&apos;s welcome bonus and why they should register and make their transfer with Rhemito.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm leading-relaxed text-slate-800 whitespace-pre-line font-sans" data-testid="refer-marketing-message-preview">
            {fullMarketingMessage}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              onClick={handleCopyMarketingMessage}
              data-testid="refer-copy-marketing-btn"
              className={cn(
                "flex-1 min-w-[170px] h-10 rounded-xl text-sm font-semibold text-white",
                copiedMessage ? "bg-teal-700 hover:bg-teal-800" : "bg-blue-600 hover:bg-blue-700",
              )}
            >
              {copiedMessage ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
              {copiedMessage ? "Invite message copied!" : "Copy full invite message"}
            </Button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(fullMarketingMessage)}`}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="refer-whatsapp-share-link"
              className="inline-flex h-10 items-center justify-center rounded-xl bg-[#25D366] hover:bg-[#1ebe5d] px-4 text-sm font-semibold text-white transition-colors"
            >
              Share on WhatsApp
            </a>
            <a
              href={`mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(fullMarketingMessage)}`}
              data-testid="refer-email-share-link"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white hover:bg-slate-50 px-3.5 text-sm font-semibold text-slate-800 transition-colors"
            >
              Email
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
