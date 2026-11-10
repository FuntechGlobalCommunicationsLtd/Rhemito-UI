import { Card } from "@/components/ui/card";
import { BONUS_COPY } from "../lib/copy";
import { breakdownRows, formatMoney, sourceGroupLabel, type BonusBalance, type CreditSource } from "../lib/bonus";
import { cn } from "@/lib/utils";

const BAR: Record<CreditSource, string> = { REFERRAL: "fill-blue-500", SCHEME: "fill-purple-500", MANUAL: "fill-slate-500" };

interface BonusBreakdownProps {
  balance: BonusBalance;
  currency: string;
  activeSource: CreditSource | "ALL";
  onView: (source: CreditSource) => void;
}

/** Bonus & Discounts: "How you earned it" — one row per source, from `by_source` (7.3). Hidden when Mito sends no breakdown. */
export function BonusBreakdown({ balance, currency, activeSource, onView }: BonusBreakdownProps) {
  const rows = breakdownRows(balance);
  if (rows.length === 0) return null;
  const debt = balance.outstanding_debt ?? 0;
  return (
    <div className="space-y-3" data-testid="bonus-breakdown">
      <Card className="rounded-xl border border-[#efefee] bg-white px-4 py-3 shadow-none">
        <h2 className="mb-1 text-[15px] font-semibold text-[#323130]">{BONUS_COPY.howEarned}</h2>
        {rows.length === 1 ? (
          <p className="pb-1 text-sm text-[#605e5c]" data-testid="breakdown-single">{BONUS_COPY.allFrom(rows[0].label)}</p>
        ) : (
          <ul>
            {rows.map((r, i) => (
              <li key={r.source} className={cn("flex flex-col gap-1.5 py-3", i < rows.length - 1 && "border-b border-[#efefee]")} data-testid={`breakdown-${r.source}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[15px] font-semibold text-[#323130]">{r.label}</span>
                  <button
                    type="button"
                    onClick={() => onView(r.source)}
                    aria-pressed={activeSource === r.source}
                    aria-label={`${BONUS_COPY.view} ${r.label}`}
                    className="min-h-[32px] rounded px-1 text-sm font-semibold text-[#2e5bff] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {BONUS_COPY.view}
                  </button>
                </div>
                <span className="text-[13px] text-[#605e5c]">{BONUS_COPY.earnedLeft(formatMoney(r.earned, currency), formatMoney(r.available, currency))}</span>
                <svg className="h-1.5 w-full overflow-hidden rounded-full" role="presentation" aria-hidden>
                  <rect width="100%" height="100%" className="fill-slate-100" />
                  <rect width={`${r.available > 0 && r.earned > 0 ? Math.min(100, Math.max(2, Math.round((r.available / r.earned) * 100))) : 0}%`} height="100%" className={BAR[r.source]} />
                </svg>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {debt > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] leading-5 text-amber-900" data-testid="bonus-outstanding">
          {BONUS_COPY.outstanding(formatMoney(debt, currency))}
        </p>
      )}
    </div>
  );
}

export { sourceGroupLabel };
