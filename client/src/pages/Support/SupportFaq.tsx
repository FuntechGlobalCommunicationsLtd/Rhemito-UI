import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ChevronLeft, Minus, Plus } from "lucide-react";
import { sanitizeSupportFaqCopy } from "@shared/support";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SUPPORT_FAQS_QUERY_KEY, fetchSupportFaqs } from "@/lib/support";

export default function SupportFaq() {
  const [, navigate] = useLocation();
  const [openKey, setOpenKey] = useState<string | null>(null);

  const {
    data: groups,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: SUPPORT_FAQS_QUERY_KEY,
    queryFn: fetchSupportFaqs,
    staleTime: 60_000,
  });

  const sortedGroups = useMemo(() => {
    if (!Array.isArray(groups)) return [];
    return [...groups]
      .filter((group) => Array.isArray(group.faq) && group.faq.length > 0)
      .sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0))
      .map((group) => ({
        ...group,
        faq: [...group.faq].sort(
          (a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0),
        ),
      }));
  }, [groups]);

  return (
    <DashboardLayout>
      <div data-testid="page-support-faq" className="w-full pb-12">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Back"
            data-testid="button-back-support"
            onClick={() => navigate("/support")}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[#323130] transition-colors hover:bg-slate-100"
          >
            <ChevronLeft className="h-6 w-6 stroke-[2.25]" />
          </button>
          <h1 className="font-display text-2xl font-light tracking-tight text-[#323130] md:text-[30px]">
            FAQs
          </h1>
        </div>

        {isLoading && (
          <div
            className="mt-8 space-y-8"
            data-testid="faq-loading-skeleton"
          >
            {[0, 1, 2].map((sectionIdx) => (
              <div key={sectionIdx} className="space-y-2.5">
                <Skeleton className="mb-3.5 h-5 w-44" />
                {[0, 1, 2, 3].map((rowIdx) => (
                  <Skeleton key={rowIdx} className="h-13 w-full rounded-[5px]" />
                ))}
              </div>
            ))}
          </div>
        )}

        {isError && !isLoading && (
          <div
            className="mt-8 flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50/70 px-6 py-12 text-center"
            data-testid="faq-error-state"
          >
            <AlertCircle className="mb-3 h-10 w-10 text-destructive" />
            <h2 className="text-base font-semibold text-[#323130]">
              Unable to load FAQs
            </h2>
            <p className="mt-1 max-w-md text-sm text-[#605E5C]">
              {error instanceof Error
                ? error.message
                : "We encountered a temporary issue loading frequently asked questions."}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void refetch()}
              data-testid="button-retry-faqs"
              className="mt-4 cursor-pointer"
            >
              Try again
            </Button>
          </div>
        )}

        {!isLoading && !isError && (
          <div className="mt-8 space-y-8">
            {sortedGroups.map((group, groupIdx) => (
              <section
                key={`${group.groupName}-${group.sequence}`}
                data-testid={`faq-group-${groupIdx}`}
              >
                <h2 className="mb-3.5 text-[17px] font-medium text-[#323130]">
                  {sanitizeSupportFaqCopy(group.groupName)}
                </h2>

                <div>
                  {group.faq.map((item, itemIdx) => {
                    const itemKey = `${groupIdx}-${item.autoNumber || itemIdx}`;
                    const isOpen = openKey === itemKey;

                    return (
                      <div
                        key={itemKey}
                        className="mb-2 overflow-hidden rounded-[5px] bg-[#F9F9FA]"
                        data-testid={`faq-item-${groupIdx}-${itemIdx}`}
                      >
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          data-testid={`faq-toggle-${groupIdx}-${itemIdx}`}
                          onClick={() =>
                            setOpenKey((prev) =>
                              prev === itemKey ? null : itemKey,
                            )
                          }
                          className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-slate-200/40"
                        >
                          <span className="text-[15px] font-medium text-[#323130]">
                            {sanitizeSupportFaqCopy(item.question)}
                          </span>
                          {isOpen ? (
                            <Minus className="h-4 w-4 shrink-0 text-[#323130]" />
                          ) : (
                            <Plus className="h-4 w-4 shrink-0 text-[#323130]" />
                          )}
                        </button>

                        {isOpen && (
                          <div
                            className="px-5 pt-0.5 pb-4 text-sm leading-relaxed whitespace-pre-line text-[#605E5C]"
                            data-testid={`faq-answer-${groupIdx}-${itemIdx}`}
                          >
                            {sanitizeSupportFaqCopy(item.answer)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
