import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { formatOfferAnnouncementMessage, type OfferAnnouncement, type RewardsSummary } from "@/lib/rewards";

const dismissedKey = (id: number) => `rhemito.offerDismissed.${id}`;

function isDismissed(id: number): boolean {
  try { return localStorage.getItem(dismissedKey(id)) === "1"; } catch { return false; }
}

interface OfferBannerProps {
  latestOffer: RewardsSummary["latestOffer"];
  latestOffers?: OfferAnnouncement[];
  onView: () => void;
}

/** Dismissible "New offer" banner(s) on the dashboard across the customer's applicable send currencies (AC-6.1.5, spec §1). */
export function OfferBanner({ latestOffer, latestOffers, onView }: OfferBannerProps) {
  const reduce = useReducedMotion();
  const [dismissedIds, setDismissedIds] = useState<number[]>([]);

  const items: OfferAnnouncement[] = latestOffers && latestOffers.length > 0
    ? latestOffers
    : latestOffer
      ? [latestOffer]
      : [];

  const visibleItems = items.filter((item) => !dismissedIds.includes(item.id) && !isDismissed(item.id));

  const dismiss = (id: number) => {
    try { localStorage.setItem(dismissedKey(id), "1"); } catch { /* ignore */ }
    setDismissedIds((prev) => [...prev, id]);
  };

  return (
    <AnimatePresence>
      {visibleItems.map((offer) => (
        <motion.div
          key={offer.id}
          role="status"
          data-testid="offer-banner"
          initial={reduce ? false : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 py-3.5 pl-4 pr-2"
        >
          <div className="flex flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold tracking-wide text-blue-700">
                {offer.kind === "IMPROVED" ? "BETTER OFFER" : "NEW OFFER"}
              </span>
              {offer.currency && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800">
                  {offer.currency}
                </span>
              )}
            </div>
            <span className="text-[15px] leading-[22px] text-slate-900">
              {formatOfferAnnouncementMessage(offer.message, offer.kind)}
            </span>
            <button
              type="button"
              onClick={onView}
              className="self-start text-[15px] font-semibold text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
            >
              View offer
            </button>
          </div>
          <button
            type="button"
            aria-label="Dismiss offer"
            onClick={() => dismiss(offer.id)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </motion.div>
      ))}
    </AnimatePresence>
  );
}
