import { Link, useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MITOVIEW_POST_DETAIL_QUERY_KEY,
  articleStandfirst,
  fetchMitoViewPostBySlug,
  formatMitoViewDate,
  getMitoViewImagePositionClass,
  prepareArticleMedia,
  resolveArticleLayout,
  resolveImageSize,
  toSentenceCaseKicker,
  type MitoViewArticleLayout,
  type MitoViewImageSize,
} from "@/lib/mitoView";
import { cn } from "@/lib/utils";
import { MitoViewShell } from "./MitoViewShell";

function MitoViewFigure({
  src,
  alt,
  size,
  layout = "river",
  isLead = false,
  bleed = false,
}: {
  src: string;
  alt: string;
  size: MitoViewImageSize;
  layout?: MitoViewArticleLayout;
  isLead?: boolean;
  bleed?: boolean;
}) {
  const sizeClasses = (() => {
    if (size === "sm") {
      return "w-full sm:max-w-[280px] aspect-[4/3] rounded-[14px]";
    }
    if (size === "md") {
      return "w-full sm:max-w-[440px] aspect-[16/10] rounded-[14px]";
    }
    if (size === "banner") {
      if (bleed) {
        return "w-full aspect-[16/7] md:aspect-[21/8] max-h-[200px] md:max-h-[280px] rounded-none";
      }
      if (layout === "split") {
        return "w-full aspect-[21/8] max-h-[240px] rounded-[14px]";
      }
      return "w-full aspect-[16/7] md:aspect-[21/8] max-h-[200px] md:max-h-[280px] rounded-[14px]";
    }
    // lg
    if (isLead && layout === "river") {
      return "w-full aspect-[16/7] max-h-[380px] rounded-[14px]";
    }
    return "w-full aspect-[16/9] max-h-[420px] rounded-[14px]";
  })();

  return (
    <figure
      className={cn(
        "overflow-hidden bg-[#eef0f3]",
        !bleed && layout !== "split" && "mx-auto mb-7",
        sizeClasses,
      )}
    >
      <img
        src={src}
        alt={alt}
        className={cn(
          "block h-full w-full object-cover",
          getMitoViewImagePositionClass(src),
        )}
      />
    </figure>
  );
}

function resolveSafeMitoViewCtaHref(rawHref: string, isEmbedded: boolean): {
  href: string;
  external: boolean;
} {
  const clean = (rawHref || "/").trim();
  const lower = clean.toLowerCase();

  if (
    lower === "/signup" ||
    lower === "/register" ||
    lower.startsWith("/signup?") ||
    lower === "https://www.rhemito.com/signup"
  ) {
    return {
      href: isEmbedded ? "/send-money" : "/sign-in-sign-up",
      external: false,
    };
  }
  if (lower === "/login" || lower === "/signin") {
    return {
      href: isEmbedded ? "/" : "/sign-in-sign-up",
      external: false,
    };
  }
  if (/^https?:\/\//i.test(clean) || clean.startsWith("mailto:")) {
    return { href: clean, external: true };
  }
  if (
    clean.startsWith("/") &&
    !clean.startsWith("//") &&
    !clean.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(clean) &&
    !/^\/%(?:2f|5c)/i.test(clean)
  ) {
    return { href: clean, external: false };
  }
  return { href: isEmbedded ? "/" : "/home", external: false };
}

export default function MitoViewArticle() {
  const [, params] = useRoute<{ slug: string }>("/mitoview/:slug");
  const [, navigate] = useLocation();
  const slug = decodeURIComponent(params?.slug ?? "").trim();

  const { data: post, isLoading } = useQuery({
    queryKey: [MITOVIEW_POST_DETAIL_QUERY_KEY, slug],
    queryFn: () => fetchMitoViewPostBySlug(slug),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });

  const mediaPrepared = post ? prepareArticleMedia(post) : null;
  const layout = post ? resolveArticleLayout(post.articleLayout) : "river";
  const heroSize = mediaPrepared ? mediaPrepared.heroSize : "lg";
  const hasHero = Boolean(post?.heroSrc?.trim());

  const publicBleedHero =
    post && hasHero && layout === "river" && heroSize === "banner" ? (
      <div className="mb-2 w-full">
        <MitoViewFigure
          src={post.heroSrc}
          alt={post.heroAlt || post.title}
          size="banner"
          layout="river"
          isLead
          bleed
        />
      </div>
    ) : undefined;

  return (
    <MitoViewShell publicBleedHero={publicBleedHero}>
      {({ isEmbedded }) => (
        <div data-testid="page-mitoview-article" className="w-full pb-12">
          {/* Header / Back control */}
          {isEmbedded ? (
            <div className="mb-8 flex items-center gap-3">
              <button
                type="button"
                aria-label="Back"
                data-testid="button-back-mitoview"
                onClick={() => navigate("/mitoview")}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[#323130] transition-colors hover:bg-slate-100"
              >
                <ChevronLeft className="h-6 w-6 stroke-[2.25]" />
              </button>
              <span className="font-display text-2xl font-light tracking-tight text-[#323130] md:text-[30px]">
                MitoView
              </span>
            </div>
          ) : (
            <Link
              href="/mitoview"
              data-testid="button-back-mitoview"
              className="mb-5 inline-block text-sm font-extrabold text-[#2e5bff] hover:underline"
            >
              ← All posts
            </Link>
          )}

          {/* Loading state */}
          {isLoading && (
            <div
              data-testid="mitoview-article-skeleton"
              className="max-w-[720px] space-y-5"
            >
              <Skeleton className="aspect-[16/7] w-full rounded-[14px]" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-10 w-4/5" />
              <Skeleton className="h-6 w-full" />
              <div className="space-y-3 pt-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            </div>
          )}

          {/* Not-found state */}
          {!isLoading && !post && (
            <div
              data-testid="mitoview-article-not-found"
              className="max-w-[720px] py-6"
            >
              <h1 className="font-display text-xl font-semibold text-[#323130] md:text-2xl">
                That MitoView edition is not on Rhemito.
              </h1>
              <button
                type="button"
                data-testid="button-mitoview-not-found-back"
                onClick={() => navigate("/mitoview")}
                className="mt-4 inline-block cursor-pointer text-sm font-bold text-[#2e5bff] hover:underline"
              >
                Back to MitoView
              </button>
            </div>
          )}

          {/* Article reader */}
          {!isLoading && post && mediaPrepared && (
            <article className="max-w-[720px] text-[#090039]">
              {(() => {
                const standfirst = articleStandfirst(
                  post.excerpt,
                  post.title,
                  post.slug,
                  mediaPrepared.body,
                );

                const leadFigure = hasHero ? (
                  <MitoViewFigure
                    src={post.heroSrc}
                    alt={post.heroAlt || post.title}
                    size={heroSize}
                    layout={layout}
                    isLead
                  />
                ) : null;

                const headerTextBlock = (
                  <div>
                    {post.publishedAt && (
                      <p className="mb-2.5 text-xs font-semibold tracking-wide text-[#4A5568]">
                        {formatMitoViewDate(post.publishedAt)}
                      </p>
                    )}
                    <h1 className="mb-3.5 font-serif text-[28px] font-semibold leading-[1.2] tracking-tight text-[#090039] md:text-[40px]">
                      {post.title}
                    </h1>
                    {standfirst && (
                      <p className="mb-2 font-serif text-lg leading-[1.55] text-[#4b5160] md:text-[20px]">
                        {standfirst}
                      </p>
                    )}
                  </div>
                );

                return (
                  <>
                    <header className="mb-7">
                      {layout === "river" &&
                        (isEmbedded || heroSize !== "banner") &&
                        leadFigure}

                      {layout === "split" && leadFigure ? (
                        <div className="mb-2 grid grid-cols-1 items-center gap-7 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                          {leadFigure}
                          {headerTextBlock}
                        </div>
                      ) : (
                        headerTextBlock
                      )}

                      {layout === "editorial" && (
                        <div className="mt-6">{leadFigure}</div>
                      )}
                    </header>

                    {/* Body block stream */}
                    <div className="max-w-[40em]">
                      {mediaPrepared.body.map((block, idx) => {
                        const key = `${post.slug}-${block.type}-${idx}`;

                        if (block.type === "kicker") {
                          return (
                            <p
                              key={key}
                              className="mt-8 mb-1.5 font-sans text-xs font-bold tracking-wide text-[#4A5568]"
                            >
                              {toSentenceCaseKicker(block.text)}
                            </p>
                          );
                        }

                        if (block.type === "h2") {
                          return (
                            <h2
                              key={key}
                              className="mt-10 mb-3 font-serif text-2xl font-semibold leading-tight tracking-tight text-[#090039]"
                            >
                              {block.text}
                            </h2>
                          );
                        }

                        if (block.type === "img") {
                          return (
                            <div key={key} className="my-7">
                              <MitoViewFigure
                                src={block.src}
                                alt={block.alt}
                                size={resolveImageSize(block.size)}
                                layout={layout}
                              />
                            </div>
                          );
                        }

                        if (block.type === "cta") {
                          const target = resolveSafeMitoViewCtaHref(
                            block.href,
                            isEmbedded,
                          );
                          const ctaLabel = toSentenceCaseKicker(block.label);
                          return (
                            <div key={key} className="my-6">
                              {target.external ? (
                                <a
                                  href={target.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  data-testid={`button-mitoview-cta-${idx}`}
                                  className="inline-flex h-10 items-center justify-center rounded-full bg-[#2e5bff] px-5 font-sans text-sm font-bold text-white transition-colors hover:bg-[#001489]"
                                >
                                  {ctaLabel}
                                </a>
                              ) : (
                                <Link
                                  href={target.href}
                                  data-testid={`button-mitoview-cta-${idx}`}
                                  className="inline-flex h-10 items-center justify-center rounded-full bg-[#2e5bff] px-5 font-sans text-sm font-bold text-white transition-colors hover:bg-[#001489]"
                                >
                                  {ctaLabel}
                                </Link>
                              )}
                            </div>
                          );
                        }

                        return (
                          <p
                            key={key}
                            className="mb-5 font-serif text-[17px] leading-[1.75] text-[#090039] md:text-[18px]"
                          >
                            {block.text}
                          </p>
                        );
                      })}
                    </div>

                    {/* Footer unsubscribe note */}
                    <p
                      data-testid="mitoview-article-footer-note"
                      className="mt-9 border-t border-slate-100 pt-6 text-[13px] text-[#4A5568]"
                    >
                      You are reading the Rhemito edition of MitoView.
                      Unsubscribe:{" "}
                      <Link
                        href="/mitoview/unsubscribe"
                        data-testid="link-article-unsubscribe"
                        className="font-medium text-[#2e5bff] hover:underline"
                      >
                        leave this list
                      </Link>{" "}
                      · support@rhemito.com
                    </p>
                  </>
                );
              })()}
            </article>
          )}
        </div>
      )}
    </MitoViewShell>
  );
}
