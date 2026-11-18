import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  MITOVIEW_POSTS_QUERY_KEY,
  fetchMitoViewPosts,
  formatMitoViewDate,
  getMitoViewImagePositionClass,
  resolveMitoViewCardMedia,
  searchNewsletterPosts,
  subscribeMitoView,
} from "@/lib/mitoView";
import { cn } from "@/lib/utils";
import { MitoViewShell } from "./MitoViewShell";

const POSTS_PER_PAGE = 6;

function buildMitoViewUrl(page: number, query: string): string {
  const qs = new URLSearchParams();
  if (page > 1) {
    qs.set("page", String(page));
  }
  const cleanQuery = query.trim();
  if (cleanQuery) {
    qs.set("q", cleanQuery);
  }
  const serialized = qs.toString();
  return serialized ? `/mitoview?${serialized}` : "/mitoview";
}

export default function MitoViewHome() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const { toast } = useToast();

  const { activeQuery, requestedPage } = useMemo(() => {
    const params = new URLSearchParams(searchString);
    const q = params.get("q") ?? "";
    const parsedPage = Number.parseInt(params.get("page") ?? "1", 10);
    return {
      activeQuery: q,
      requestedPage: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    };
  }, [searchString]);

  const [searchDraft, setSearchDraft] = useState(activeQuery);
  const [subscribeEmail, setSubscribeEmail] = useState("");
  const [subscribeStatus, setSubscribeStatus] = useState("");

  useEffect(() => {
    setSearchDraft(activeQuery);
  }, [activeQuery]);

  const {
    data: posts = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: MITOVIEW_POSTS_QUERY_KEY,
    queryFn: fetchMitoViewPosts,
    staleTime: 60_000,
  });

  const filteredPosts = useMemo(
    () => searchNewsletterPosts(posts, activeQuery),
    [posts, activeQuery],
  );

  const pageCount = Math.max(1, Math.ceil(filteredPosts.length / POSTS_PER_PAGE));
  const currentPage = Math.min(Math.max(requestedPage, 1), pageCount);
  const pagePosts = useMemo(
    () =>
      filteredPosts.slice(
        (currentPage - 1) * POSTS_PER_PAGE,
        currentPage * POSTS_PER_PAGE,
      ),
    [filteredPosts, currentPage],
  );

  const subscribeMutation = useMutation({
    mutationFn: (email: string) => subscribeMitoView(email),
    onSuccess: (res) => {
      setSubscribeStatus(res.message);
      setSubscribeEmail("");
      toast({
        title: res.alreadySubscribed ? "Already subscribed" : "Subscribed",
        description: res.message,
      });
    },
    onError: (err) => {
      toast({
        variant: "destructive",
        title: "Subscription failed",
        description:
          err instanceof Error
            ? err.message
            : "Could not subscribe right now. Please try again.",
      });
    },
  });

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(buildMitoViewUrl(1, searchDraft));
  };

  const handleClearSearch = () => {
    setSearchDraft("");
    navigate("/mitoview");
  };

  const handlePageSelect = (nextPage: number) => {
    navigate(buildMitoViewUrl(nextPage, activeQuery));
  };

  const handleSubscribeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = subscribeEmail.trim();
    if (!clean) return;
    subscribeMutation.mutate(clean);
  };

  const trimmedActiveQuery = activeQuery.trim();

  return (
    <MitoViewShell brandBarAsH1>
      {({ isEmbedded }) => (
        <div data-testid="page-mitoview-home" className="w-full pb-12">
          {isEmbedded && (
            <h1 className="font-display mb-7 text-2xl font-light tracking-tight text-[#323130] md:text-[30px]">
              MitoView
            </h1>
          )}

          <div className={cn("w-full", isEmbedded && "max-w-[780px]")}>
            {/* Pill search form */}
            <form
              onSubmit={handleSearchSubmit}
              className="mb-3 flex flex-col gap-2.5 sm:flex-row sm:items-center"
            >
              <label htmlFor="mitoview-search-input" className="sr-only">
                Search posts
              </label>
              <input
                id="mitoview-search-input"
                type="search"
                name="q"
                autoComplete="off"
                placeholder="Search posts"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                data-testid="input-mitoview-search"
                className="h-10 min-w-0 flex-1 rounded-full bg-[#f4f5f7] px-4 text-sm text-[#090039] placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#2e5bff]"
              />
              <button
                type="submit"
                data-testid="button-mitoview-search"
                className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#2e5bff] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#001489]"
              >
                Search
              </button>
            </form>

            {/* Search match count + Clear */}
            {trimmedActiveQuery && (
              <p
                data-testid="mitoview-search-status"
                className="mb-6 text-sm font-semibold text-[#4A5568]"
              >
                {filteredPosts.length === 0
                  ? `No posts match “${trimmedActiveQuery}”.`
                  : `${filteredPosts.length} post${filteredPosts.length === 1 ? "" : "s"} match “${trimmedActiveQuery}”.`}{" "}
                <button
                  type="button"
                  data-testid="button-mitoview-search-clear"
                  onClick={handleClearSearch}
                  className="cursor-pointer font-semibold text-[#2e5bff] hover:underline"
                >
                  Clear
                </button>
              </p>
            )}

            {/* Loading state */}
            {isLoading && (
              <div
                data-testid="mitoview-loading-skeleton"
                className="my-6 space-y-4"
              >
                {[0, 1, 2].map((idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-[88px_1fr] items-center gap-4 sm:grid-cols-[112px_1fr]"
                  >
                    <Skeleton className="aspect-[16/10] w-full rounded-[10px]" />
                    <div className="space-y-2">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-5 w-3/4" />
                      <Skeleton className="h-4 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Error state */}
            {isError && !isLoading && (
              <div
                data-testid="mitoview-error-state"
                className="my-6 flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50/70 px-6 py-10 text-center"
              >
                <AlertCircle className="mb-3 h-9 w-9 text-destructive" />
                <p className="text-sm font-semibold text-[#090039]">
                  {error instanceof Error
                    ? error.message
                    : "Unable to load MitoView posts."}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void refetch()}
                  data-testid="button-retry-mitoview"
                  className="mt-4 cursor-pointer"
                >
                  Try again
                </Button>
              </div>
            )}

            {/* Post list or empty state */}
            {!isLoading && !isError && (
              <>
                {pagePosts.length === 0 ? (
                  <p
                    data-testid="mitoview-empty-state"
                    className="my-8 text-base font-semibold text-[#4A5568]"
                  >
                    {trimmedActiveQuery
                      ? "Try another word, or clear the search."
                      : "No MitoView posts yet."}
                  </p>
                ) : (
                  <ol className="mt-4 mb-7 list-none space-y-1 p-0">
                    {pagePosts.map((post) => {
                      const media = resolveMitoViewCardMedia(post);
                      return (
                        <li key={post.slug}>
                          <Link
                            href={`/mitoview/${encodeURIComponent(post.slug)}`}
                            data-testid={`card-mitoview-post-${post.slug}`}
                            className={cn(
                              "group grid cursor-pointer grid-cols-[88px_minmax(0,1fr)] items-center gap-3 rounded-xl p-3 transition-colors hover:bg-[#f6f7f9] sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-4",
                              !isEmbedded && "-mx-3",
                            )}
                          >
                            <div
                              className={cn(
                                "aspect-[16/10] overflow-hidden rounded-[10px]",
                                media.isLogoFallback
                                  ? "flex items-center justify-center border border-slate-100 bg-white p-3"
                                  : "bg-[#f3f4f6]",
                              )}
                            >
                              <img
                                src={media.src}
                                alt={media.alt}
                                className={cn(
                                  "transition-transform duration-200 group-hover:scale-[1.04]",
                                  media.isLogoFallback
                                    ? "max-h-[70%] max-w-[80%] object-contain"
                                    : cn(
                                        "block h-full w-full object-cover",
                                        getMitoViewImagePositionClass(media.src),
                                      ),
                                )}
                              />
                            </div>

                            <div className="min-w-0">
                              <p className="mb-1 text-[11px] font-semibold tracking-wide text-[#4A5568]">
                                {formatMitoViewDate(post.publishedAt)}
                              </p>
                              <h2 className="mb-1 text-base font-semibold leading-snug tracking-tight text-[#090039] transition-colors group-hover:text-[#2e5bff]">
                                {post.title}
                              </h2>
                              <p className="line-clamp-2 text-[13.5px] leading-[1.45] text-[#4A5568]">
                                {post.excerpt}
                              </p>
                              <span className="mt-1.5 inline-block text-[13px] font-semibold text-[#2e5bff] opacity-80 transition-opacity group-hover:opacity-100">
                                Read →
                              </span>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                )}

                {/* Pagination */}
                {pageCount > 1 && (
                  <nav
                    aria-label="MitoView pages"
                    data-testid="mitoview-pagination"
                    className="mt-2 mb-9 flex flex-wrap items-center justify-between gap-4 text-[13px] font-semibold text-[#090039]"
                  >
                    {currentPage > 1 ? (
                      <button
                        type="button"
                        data-testid="button-mitoview-prev"
                        onClick={() => handlePageSelect(currentPage - 1)}
                        className="inline-flex h-9 cursor-pointer items-center justify-center px-2.5 transition-colors hover:text-[#2e5bff]"
                      >
                        Previous
                      </button>
                    ) : (
                      <span className="inline-flex h-9 items-center justify-center px-2.5 text-[#b4b8c0]">
                        Previous
                      </span>
                    )}

                    <ol className="flex list-none items-center gap-1.5 p-0">
                      {Array.from({ length: pageCount }, (_, i) => i + 1).map(
                        (pageNumber) => (
                          <li key={pageNumber}>
                            {pageNumber === currentPage ? (
                              <span
                                aria-current="page"
                                className="inline-flex h-9 min-w-9 items-center justify-center border-b-2 border-[#2e5bff] px-2.5 text-[#2e5bff]"
                              >
                                {pageNumber}
                              </span>
                            ) : (
                              <button
                                type="button"
                                data-testid={`button-mitoview-page-${pageNumber}`}
                                onClick={() => handlePageSelect(pageNumber)}
                                className="inline-flex h-9 min-w-9 cursor-pointer items-center justify-center px-2.5 transition-colors hover:text-[#2e5bff]"
                              >
                                {pageNumber}
                              </button>
                            )}
                          </li>
                        ),
                      )}
                    </ol>

                    {currentPage < pageCount ? (
                      <button
                        type="button"
                        data-testid="button-mitoview-next"
                        onClick={() => handlePageSelect(currentPage + 1)}
                        className="inline-flex h-9 cursor-pointer items-center justify-center px-2.5 transition-colors hover:text-[#2e5bff]"
                      >
                        Next
                      </button>
                    ) : (
                      <span className="inline-flex h-9 items-center justify-center px-2.5 text-[#b4b8c0]">
                        Next
                      </span>
                    )}
                  </nav>
                )}
              </>
            )}

            {/* Newsletter subscribe card */}
            <div
              data-testid="card-mitoview-subscribe"
              className="mt-6 grid grid-cols-1 items-center gap-5 rounded-[14px] bg-[#f6f7f9] p-5 sm:px-6 md:grid-cols-[1.1fr_1fr]"
            >
              <div>
                <h2 className="text-lg font-bold tracking-tight text-[#090039]">
                  Are you subscribed?
                </h2>
                <p className="mt-0.5 text-[13px] font-medium text-[#4A5568]">
                  If you are not, subscribe to MitoView
                </p>
                <p className="mt-1.5 text-[11px] leading-snug text-[#4A5568]">
                  <Link
                    href="/mitoview/unsubscribe"
                    data-testid="link-mitoview-unsubscribe"
                    className="underline underline-offset-2 hover:text-[#2e5bff]"
                  >
                    Unsubscribe any time
                  </Link>
                </p>
              </div>

              {subscribeStatus ? (
                <p
                  data-testid="mitoview-subscribe-status"
                  className="text-sm font-bold text-[#090039]"
                >
                  {subscribeStatus}
                </p>
              ) : (
                <form
                  onSubmit={handleSubscribeSubmit}
                  className="flex flex-col gap-2.5 sm:flex-row sm:items-center"
                >
                  <label htmlFor="mitoview-subscribe-email" className="sr-only">
                    Email address
                  </label>
                  <input
                    id="mitoview-subscribe-email"
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    placeholder="you@email.com"
                    value={subscribeEmail}
                    onChange={(e) => setSubscribeEmail(e.target.value)}
                    data-testid="input-mitoview-subscribe-email"
                    className="h-10 min-w-0 flex-1 rounded-full border border-slate-200/80 bg-white px-4 text-sm text-[#090039] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2e5bff]"
                  />
                  <button
                    type="submit"
                    disabled={subscribeMutation.isPending}
                    data-testid="button-mitoview-subscribe"
                    className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#2e5bff] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#001489] disabled:opacity-60"
                  >
                    {subscribeMutation.isPending && (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    )}
                    Subscribe
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </MitoViewShell>
  );
}
