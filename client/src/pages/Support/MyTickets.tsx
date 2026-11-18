import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Search,
  Ticket,
} from "lucide-react";
import type { SupportStatusShortcode } from "@shared/support";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { SupportSignInRequiredCard } from "@/components/support/SupportSignInRequiredCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  SUPPORT_TICKETS_QUERY_KEY,
  fetchSupportTickets,
  formatSupportDate,
  formatSupportStatusLabel,
  isSupportFurpAuthRequiredError,
} from "@/lib/support";
import { cn } from "@/lib/utils";

type TicketTabCode = SupportStatusShortcode | "ALL";

interface StatusTabMeta {
  code: TicketTabCode;
  label: string;
  wireStatus: string;
  testId: string;
}

const STATUS_TABS: readonly StatusTabMeta[] = [
  { code: "NEW", label: "New", wireStatus: "New", testId: "tab-tickets-new" },
  {
    code: "AWAITINGADMIN",
    label: "Awaiting admin",
    wireStatus: "Awaiting Admin",
    testId: "tab-tickets-awaiting-admin",
  },
  {
    code: "AWAITINGCLIENT",
    label: "Awaiting client",
    wireStatus: "Awaiting Client",
    testId: "tab-tickets-awaiting-client",
  },
  {
    code: "RESOLVED",
    label: "Resolved",
    wireStatus: "Resolved",
    testId: "tab-tickets-resolved",
  },
  { code: "ALL", label: "All", wireStatus: "All", testId: "tab-tickets-all" },
] as const;

function parseUrlStatusParam(searchStr: string): TicketTabCode | null {
  const params = new URLSearchParams(searchStr);
  const raw = (params.get("status") ?? "").trim().toUpperCase();
  if (
    raw === "NEW" ||
    raw === "AWAITINGADMIN" ||
    raw === "AWAITINGCLIENT" ||
    raw === "RESOLVED" ||
    raw === "ALL"
  ) {
    return raw;
  }
  return null;
}

function getStatusBadgeClasses(status: string): string {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "awaiting admin" || normalized === "awaitingadmin") {
    return "bg-[#F9AB00] text-[#1a1a1a]";
  }
  if (normalized === "awaiting client" || normalized === "awaitingclient") {
    return "bg-[#7B61FF] text-white";
  }
  if (normalized === "resolved" || normalized === "closed") {
    return "bg-[#1E8E3E] text-white";
  }
  return "bg-[#1A73E8] text-white";
}

function TicketStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-0.5 text-xs font-semibold whitespace-nowrap",
        getStatusBadgeClasses(status),
      )}
    >
      {formatSupportStatusLabel(status)}
    </span>
  );
}

export default function MyTickets() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const urlStatus = useMemo(() => parseUrlStatusParam(searchString), [searchString]);

  const [activeTab, setActiveTab] = useState<TicketTabCode>(() => urlStatus ?? "NEW");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const hasAppliedSmartDefault = useRef(Boolean(urlStatus));

  useEffect(() => {
    if (urlStatus) {
      hasAppliedSmartDefault.current = true;
      setActiveTab((prev) => {
        if (prev !== urlStatus) {
          setPageNo(1);
        }
        return urlStatus;
      });
    }
  }, [urlStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPageNo(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [
      SUPPORT_TICKETS_QUERY_KEY,
      { status: activeTab, searchingText: debouncedSearch, pageNo, pageSize },
    ],
    queryFn: () =>
      fetchSupportTickets({
        status: activeTab,
        searchingText: debouncedSearch,
        pageNo,
        pageSize,
      }),
    staleTime: 15_000,
  });

  const countByTab = useMemo(() => {
    const map: Record<TicketTabCode, number> = {
      NEW: 0,
      AWAITINGADMIN: 0,
      AWAITINGCLIENT: 0,
      RESOLVED: 0,
      ALL: 0,
    };
    const counts = data?.statusCounts ?? [];
    for (const item of counts) {
      const sc = String(item.shortcode ?? "").trim().toUpperCase();
      const st = String(item.status ?? "").trim().toLowerCase();
      if (sc === "NEW" || st === "new") map.NEW = item.count;
      else if (sc === "AWAITINGADMIN" || st === "awaiting admin")
        map.AWAITINGADMIN = item.count;
      else if (sc === "AWAITINGCLIENT" || st === "awaiting client")
        map.AWAITINGCLIENT = item.count;
      else if (sc === "RESOLVED" || st === "resolved") map.RESOLVED = item.count;
      else if (sc === "ALL" || st === "all") map.ALL = item.count;
    }
    return map;
  }, [data?.statusCounts]);

  useEffect(() => {
    if (hasAppliedSmartDefault.current || urlStatus) return;
    if (!data?.statusCounts || data.statusCounts.length === 0) return;
    hasAppliedSmartDefault.current = true;
    if (countByTab.NEW === 0 && countByTab.ALL > 0) {
      setActiveTab("ALL");
      setPageNo(1);
    }
  }, [urlStatus, data?.statusCounts, countByTab.NEW, countByTab.ALL]);

  const handleSelectTab = (nextCode: TicketTabCode) => {
    hasAppliedSmartDefault.current = true;
    setActiveTab(nextCode);
    setPageNo(1);
    navigate(`/support/my-tickets?status=${nextCode}`, { replace: true });
  };

  const handleClearSearch = () => {
    setSearchInput("");
    setDebouncedSearch("");
    setPageNo(1);
  };

  const tickets = data?.supportTickets?.data ?? [];
  const totalPages = Math.max(1, data?.supportTickets?.totalPages ?? 1);
  const currentPage = data?.supportTickets?.currentPage ?? pageNo;
  const hasPrev = Boolean(data?.supportTickets?.hasPreviousPage) || currentPage > 1;
  const hasNext = Boolean(data?.supportTickets?.hasNextPage) || currentPage < totalPages;
  const requiresFurpAuth =
    Boolean(data?.requiresFurpAuth) || isSupportFurpAuthRequiredError(error);

  return (
    <DashboardLayout>
      <div data-testid="page-my-tickets" className="w-full pb-12">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-4">
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
              My tickets
            </h1>
          </div>

          {!requiresFurpAuth && (
            <Button
              type="button"
              data-testid="button-create-new-ticket"
              onClick={() => navigate("/support/create-ticket")}
              className="h-10 cursor-pointer rounded-[5px] bg-[#2e5bff] px-4 text-sm font-medium text-white hover:bg-blue-700"
            >
              <CirclePlus className="mr-1.5 h-4 w-4" />
              Create new ticket
            </Button>
          )}
        </div>

        {!isLoading && requiresFurpAuth ? (
          <SupportSignInRequiredCard />
        ) : (
          <>
            {/* Right-aligned search box */}
            <div className="mt-6 flex justify-end">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              type="text"
              data-testid="input-search-tickets"
              placeholder="Search tickets…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="h-10 border-slate-200 bg-white pl-9 pr-9 text-sm"
            />
            {searchInput.length > 0 && (
              <button
                type="button"
                aria-label="Clear search"
                data-testid="button-clear-ticket-search"
                onClick={handleClearSearch}
                className="absolute top-1/2 right-2.5 flex h-5 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-slate-200 text-sm font-bold leading-none text-slate-600 transition-colors hover:bg-slate-400 hover:text-white"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Status filter pills */}
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {STATUS_TABS.map((tab) => {
            const isSelected = activeTab === tab.code;
            const count = countByTab[tab.code];
            return (
              <button
                key={tab.code}
                type="button"
                data-testid={tab.testId}
                onClick={() => handleSelectTab(tab.code)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors",
                  isSelected
                    ? "bg-[#2e5bff] text-white"
                    : "bg-[#EFEFEF] text-[#323130] hover:bg-slate-200",
                )}
              >
                <span>{tab.label}</span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none",
                    isSelected
                      ? "bg-white/20 text-white"
                      : "bg-white/80 text-[#323130]",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="mt-6 space-y-3" data-testid="tickets-loading-skeleton">
            {[0, 1, 2, 3].map((idx) => (
              <Skeleton key={idx} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        )}

        {/* Error state */}
        {isError && !isLoading && (
          <div
            className="mt-6 flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50/70 px-6 py-12 text-center"
            data-testid="tickets-error-state"
          >
            <AlertCircle className="mb-3 h-10 w-10 text-destructive" />
            <h2 className="text-base font-semibold text-[#323130]">
              Unable to load support tickets
            </h2>
            <p className="mt-1 max-w-md text-sm text-[#605E5C]">
              {error instanceof Error
                ? error.message
                : "We encountered an issue fetching your support tickets."}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void refetch()}
              data-testid="button-retry-tickets"
              className="mt-4 cursor-pointer"
            >
              Try again
            </Button>
          </div>
        )}

        {/* Empty or populated list */}
        {!isLoading && !isError && (
          <>
            {tickets.length === 0 ? (
              <div
                data-testid="empty-my-tickets"
                className="flex flex-col items-center justify-center px-4 py-16 text-center"
              >
                <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-blue-50">
                  <Ticket className="h-10 w-10 text-[#2e5bff]" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-slate-700">
                  No tickets found
                </h3>
                <p className="max-w-[290px] text-sm leading-relaxed text-slate-400">
                  There are no tickets matching your current filter. Try a
                  different status tab or clear your search.
                </p>
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="mt-6 hidden overflow-hidden rounded-lg border border-slate-100 bg-white md:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b border-slate-100 bg-white hover:bg-white">
                        <TableHead className="px-4 py-3.5 text-xs font-semibold normal-case text-[#605E5C]">
                          Ticket #
                        </TableHead>
                        <TableHead className="px-4 py-3.5 text-xs font-semibold normal-case text-[#605E5C]">
                          Subject
                        </TableHead>
                        <TableHead className="px-4 py-3.5 text-xs font-semibold normal-case text-[#605E5C]">
                          Date
                        </TableHead>
                        <TableHead className="px-4 py-3.5 text-xs font-semibold normal-case text-[#605E5C]">
                          Status
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tickets.map((t, idx) => (
                        <TableRow
                          key={t.ticketNo || idx}
                          data-testid={`row-ticket-${t.ticketNo}`}
                          onClick={() =>
                            navigate(
                              `/my-tickets/request-details/${encodeURIComponent(t.ticketNo)}`,
                            )
                          }
                          className={cn(
                            "cursor-pointer border-b border-slate-100 transition-colors hover:bg-blue-50/50",
                            idx % 2 === 1 ? "bg-slate-50/40" : "bg-white",
                          )}
                        >
                          <TableCell className="px-4 py-4">
                            <span className="text-sm font-bold text-[#2e5bff] underline underline-offset-4">
                              #{t.ticketNo}
                            </span>
                          </TableCell>
                          <TableCell className="px-4 py-4">
                            <span className="text-sm text-[#323130]">
                              {t.subject}
                            </span>
                          </TableCell>
                          <TableCell className="px-4 py-4 whitespace-nowrap">
                            <span className="text-sm text-[#605E5C]">
                              {formatSupportDate(t.date)}
                            </span>
                          </TableCell>
                          <TableCell className="px-4 py-4">
                            <TicketStatusBadge status={t.status} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile card stack */}
                <div className="mt-4 space-y-3 md:hidden">
                  {tickets.map((t, idx) => (
                    <div
                      key={t.ticketNo || idx}
                      role="button"
                      tabIndex={0}
                      data-testid={`card-ticket-${t.ticketNo}`}
                      onClick={() =>
                        navigate(
                          `/my-tickets/request-details/${encodeURIComponent(t.ticketNo)}`,
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          navigate(
                            `/my-tickets/request-details/${encodeURIComponent(t.ticketNo)}`,
                          );
                        }
                      }}
                      className="cursor-pointer rounded-xl border border-slate-200 bg-white p-4 shadow-2xs transition-colors hover:border-blue-300"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-[#2e5bff] underline underline-offset-4">
                          #{t.ticketNo}
                        </span>
                        <TicketStatusBadge status={t.status} />
                      </div>
                      <p className="line-clamp-1 text-sm font-semibold text-slate-800">
                        {t.subject}
                      </p>
                      <p className="mt-1.5 text-xs text-slate-400">
                        {formatSupportDate(t.date)}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Pagination footer */}
                {totalPages > 1 && (
                  <div
                    data-testid="tickets-pagination"
                    className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4"
                  >
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!hasPrev}
                      data-testid="button-tickets-prev"
                      onClick={() => setPageNo((prev) => Math.max(1, prev - 1))}
                      className="cursor-pointer"
                    >
                      <ChevronLeft className="mr-1 h-4 w-4" />
                      Prev
                    </Button>

                    <div className="flex flex-wrap items-center gap-3 text-sm text-[#323130]">
                      <span>
                        Page <strong className="font-semibold">{currentPage}</strong>{" "}
                        of <strong className="font-semibold">{totalPages}</strong>
                      </span>

                      <Select
                        value={String(pageSize)}
                        onValueChange={(val) => {
                          setPageSize(Number(val));
                          setPageNo(1);
                        }}
                      >
                        <SelectTrigger
                          className="h-8 w-28 text-xs"
                          data-testid="select-tickets-page-size"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[5, 10, 20, 50].map((sz) => (
                            <SelectItem key={sz} value={String(sz)}>
                              Show {sz}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!hasNext}
                      data-testid="button-tickets-next"
                      onClick={() =>
                        setPageNo((prev) => Math.min(totalPages, prev + 1))
                      }
                      className="cursor-pointer"
                    >
                      Next
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </>
        )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
