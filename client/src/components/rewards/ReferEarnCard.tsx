import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeftRight, ArrowRight, Check, ChevronDown, ChevronUp, Copy, RefreshCw, Share2 } from "lucide-react";
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
    <div
      id="refer-earn"
      data-testid="refer-earn-card"
      className={cn(
        "flex flex-col gap-4 transition-shadow duration-300",
        highlighted && "rounded-2xl ring-2 ring-primary ring-offset-2",
      )}
    >
      {/* Main Split Banner matching Figma 12498:26136 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* Left Blue Invite Card */}
        <div className="lg:col-span-7 rounded-2xl bg-[#ecf5ff] p-5 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {/* Currency Corridor Switcher Pills */}
            {allOffers.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="sr-only" data-testid="refer-corridor-label">
                  Referrals are available for the following currency corridors:
                </span>
                <div
                  className="inline-flex flex-wrap items-center gap-2"
                  data-testid="refer-corridor-pills"
                  aria-label="Select referral corridor rule"
                >
                  {allOffers.map((o) => {
                    const isSelected = o.rule_id === activeOffer.rule_id && o.currency === activeOffer.currency;
                    const dest = o.receive_currency ?? "ALL";
                    return (
                      <button
                        key={`corridor-${o.rule_id}-${o.currency}-${dest}`}
                        type="button"
                        onClick={() => {
                          setSelectedRuleId(o.rule_id);
                          setCopied(false);
                        }}
                        aria-pressed={isSelected}
                        aria-label={`${o.currency} → ${dest}`}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors cursor-pointer",
                          isSelected
                            ? "bg-[#2e5bff] text-white shadow-2xs"
                            : "bg-white text-[#605e5c] hover:text-[#323130]",
                        )}
                      >
                        <span>{o.currency}</span>
                        <span className="sr-only"> → </span>
                        <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>{dest}</span>
                      </button>
                    );
                  })}
                </div>
                <span className="sr-only" data-testid="refer-currency-hint">
                  Click a currency corridor to see its rewards
                </span>
              </div>
            )}

            <div className="flex items-center gap-2 ml-auto">
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => setHowOpen(true)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#2e5bff] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded cursor-pointer"
                >
                  <span>How it works</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
              {defaultCollapsed && (
                <button
                  type="button"
                  onClick={() => setCollapsed((v) => !v)}
                  aria-expanded={!collapsed}
                  data-testid="toggle-refer-earn-card"
                  className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-white hover:bg-blue-50 px-3 py-1 text-xs font-semibold text-[#2e5bff] transition-colors cursor-pointer"
                >
                  <span>{collapsed ? "Show Refer & Earn" : "Hide"}</span>
                  {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>
          </div>

          {!collapsed && (
            <>
              {activeOffer.cap_reached ? (
                <p className="text-[15px] leading-[23px] text-slate-700" data-testid="refer-cap-reached">
                  You&apos;ve reached the maximum referral rewards for this programme. Thank you for spreading the word!
                </p>
              ) : (
                <>
                  {/* Hero Text + 3D Gift Box Image */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-col items-start">
                      <h2 className="font-display text-3xl sm:text-[42px] font-bold text-[#323130] leading-[1.12] tracking-tight">
                        Invite and Get
                      </h2>
                      <p className="font-display text-3xl sm:text-[42px] font-bold text-[#323130] leading-[1.12] tracking-tight">
                        {formatMoney(activeOffer.referrer_reward, activeOffer.currency)}
                      </p>
                    </div>
                    <div className="relative h-[116px] w-[176px] sm:h-[123px] sm:w-[193px] rounded-2xl bg-white overflow-hidden shrink-0">
                      <img
                        src="/referral-gift-box.png"
                        alt="Referral reward gift"
                        className="absolute right-0 -top-2 h-[155px] w-[150px] object-cover pointer-events-none"
                      />
                    </div>
                  </div>

                  {/* Share your link Input + Embedded Copy + Pill Share Button */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="referral-link" className="text-sm font-normal text-[#323130]">
                        Share your link
                      </label>
                      {effectiveCode && (
                        <span
                          className="sr-only font-mono text-xs font-semibold text-[#2e5bff]"
                          data-testid="refer-active-code"
                        >
                          {effectiveCode}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                      <div className="flex flex-1 items-center gap-2 rounded-lg border border-[#cfcece] bg-white h-10 pl-3 pr-1.5">
                        <input
                          id="referral-link"
                          aria-label="Your referral link"
                          ref={inputRef}
                          readOnly
                          value={link.replace(/^https?:\/\//, "")}
                          onFocus={(e) => e.currentTarget.select()}
                          className="h-full flex-1 min-w-0 bg-transparent text-sm font-medium text-[#7b7b7b] focus:outline-none truncate"
                        />
                        <button
                          type="button"
                          onClick={handleCopy}
                          aria-label={copied ? "Copied" : "Copy link"}
                          className={cn(
                            "h-8 min-w-[76px] rounded-full px-4 text-sm font-semibold text-white shrink-0 transition-colors cursor-pointer",
                            copied ? "bg-teal-700 hover:bg-teal-800" : "bg-[#2e5bff] hover:bg-blue-700",
                          )}
                        >
                          {copied ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={handleShare}
                        data-testid="refer-share-btn"
                        className="inline-flex h-10 min-w-[116px] items-center justify-center gap-2 rounded-full bg-[#2e5bff] hover:bg-blue-700 px-5 text-sm font-semibold text-white shrink-0 transition-colors cursor-pointer"
                      >
                        <Share2 className="h-4 w-4" />
                        <span>Share</span>
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => setShareOpen(true)}
                        data-testid="refer-preview-marketing-btn"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#2e5bff] hover:underline cursor-pointer"
                      >
                        <span>Preview &amp; copy full invite message</span>
                        <ArrowRight className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Right Stacked Cards: You get / They get */}
        {!collapsed && !activeOffer.cap_reached && (
          <div className="lg:col-span-5 flex flex-col gap-4 justify-between">
            <div className="flex-1 rounded-lg border border-[#cfcece] bg-white p-4 flex flex-col justify-center gap-2">
              <h3 className="font-display text-xl sm:text-2xl font-semibold text-[#323130] leading-tight">
                You get {formatMoney(activeOffer.referrer_reward, activeOffer.currency)}
              </h3>
              <p className="text-sm sm:text-base text-[#323130] leading-snug">
                When you Invite friends and they sign up using your link
              </p>
            </div>
            <div className="flex-1 rounded-lg border border-[#cfcece] bg-white p-4 flex flex-col justify-center gap-2">
              <h3 className="font-display text-xl sm:text-2xl font-semibold text-[#323130] leading-tight">
                They get {formatMoney(activeOffer.referee_reward, activeOffer.currency)}
              </h3>
              <p className="text-sm sm:text-base text-[#323130] leading-snug">
                When they sign up with your link and make their first transaction
              </p>
            </div>
            {/* Contract-pinned offer sentence with bold amounts */}
            <div className="sr-only">
              <OfferSentence text={activeOffer.text} />
            </div>
          </div>
        )}
      </div>

      {/* Compact Footer Status / Totals */}
      {!collapsed && (
        <div
          className="rounded-xl border border-[#efefee] bg-white px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          data-testid="refer-latest"
        >
          {joined === 0 ? (
            <p className="text-sm text-slate-500">No referrals yet. Share your link to start earning.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-4" data-testid="refer-stats">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Friends joined</span>
                  <span className="font-display text-base font-bold text-[#323130]" data-testid="refer-count">
                    {joined}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-teal-800">Bonus earned</span>
                  <span className="font-display text-base font-bold text-teal-700" data-testid="refer-earned">
                    {earnedText}
                  </span>
                </div>
                {waiting > 0 && (
                  <p className="text-xs sm:text-sm text-slate-500" data-testid="refer-waiting">
                    {waiting} {waiting === 1 ? "friend is" : "friends are"} yet to send {formatMoney(offer.floor, offer.currency)}+
                  </p>
                )}
              </div>
              <Link
                href="/bonus-discounts?tab=referrals"
                className="inline-flex items-center gap-1 text-xs sm:text-sm font-semibold text-[#2e5bff] hover:underline shrink-0"
              >
                View all referrals
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
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
    </div>
  );
}
