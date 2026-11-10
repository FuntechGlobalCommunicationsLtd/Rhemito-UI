import { Card } from "@/components/ui/card";
import { BONUS_COPY } from "../lib/copy";
import { formatUkDate, type BonusOffer } from "../lib/bonus";
import { cn } from "@/lib/utils";

/** Bonus & Discounts: live bonus offers in the customer's currency (7.4). Hidden when none, or when blocked. */
export function WaysToEarn({ offers, blocked }: { offers: BonusOffer[]; blocked?: boolean }) {
  if (blocked || offers.length === 0) return null;
  return (
    <section className="rounded-2xl border border-[#cfcece] bg-white p-4 space-y-4" aria-labelledby="ways-to-earn-title" data-testid="ways-to-earn">
      <div className="space-y-1">
        <h2 id="ways-to-earn-title" className="text-[15px] font-semibold text-[#323130]">{BONUS_COPY.waysToEarn}</h2>
        <p className="text-xs text-[#605e5c]">{BONUS_COPY.waysToEarnSub}</p>
      </div>
      <ul className="grid gap-3.5 sm:grid-cols-2">
        {offers.map((o, idx) => (
          <li key={o.id}>
            <Card
              className={cn(
                "relative flex min-h-[140px] h-full items-center justify-between gap-3 overflow-hidden rounded-2xl border-0 p-5 text-white shadow-none",
                idx % 2 === 0
                  ? "bg-[linear-gradient(222deg,#bedfff_18%,#2e5bff_89%)]"
                  : "bg-[linear-gradient(222deg,#d1f4ca_18%,#019b3e_75%)]",
              )}
              data-testid="offer-card"
            >
              <div className="relative z-10 flex min-w-0 max-w-[65%] flex-col gap-1.5">
                <span className="text-lg sm:text-xl font-semibold leading-tight text-white">{o.name}</span>
                <span className="text-xs leading-4 text-white/95">{o.summary}</span>
                {(o.end_date_display || o.end_date) && (
                  <span className="text-[11px] font-medium text-white/90">{BONUS_COPY.ends(o.end_date_display || formatUkDate(o.end_date))}</span>
                )}
              </div>
              <img
                src="/referral-gift-box.png"
                alt=""
                aria-hidden="true"
                className="pointer-events-none h-24 w-24 shrink-0 object-contain drop-shadow-md"
              />
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
