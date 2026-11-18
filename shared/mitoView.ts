export type MitoViewArticleLayout = "river" | "split" | "editorial";
export type MitoViewImageSize = "sm" | "md" | "lg" | "banner";

export type MitoViewBodyBlock =
  | { type: "kicker"; text: string }
  | { type: "h2"; text: string }
  | { type: "p"; text: string }
  | { type: "img"; src: string; alt: string; size?: MitoViewImageSize }
  | { type: "cta"; label: string; href: string };

export interface MitoViewPost {
  slug: string;
  title: string;
  excerpt: string;
  editionSummary: string;
  publishedAt: string;
  category: string;
  articleLayout: MitoViewArticleLayout;
  heroSize: MitoViewImageSize;
  audience: string;
  status?: "draft" | "published" | "archived";
  featured: boolean;
  heroTint: string;
  heroSrc: string;
  heroAlt: string;
  offerCta: {
    label: string;
    path: string;
  };
  socialSnippet: string;
  body: MitoViewBodyBlock[];
}

export interface MitoViewListResponse {
  succeeded?: boolean;
  code?: number;
  message?: string | null;
  responseType?: string;
  data: Record<string, unknown>[];
}

export interface MitoViewSingleResponse {
  succeeded?: boolean;
  code?: number;
  message?: string | null;
  responseType?: string;
  data: Record<string, unknown> | null;
}

export interface MitoViewActionResponse {
  succeeded?: boolean;
  code?: number;
  message?: string | null;
  responseType?: string;
  data?: unknown;
}

const IMAGE_SIZES: MitoViewImageSize[] = ["sm", "md", "lg", "banner"];
const ARTICLE_LAYOUTS: MitoViewArticleLayout[] = ["editorial", "split", "river"];

export function resolveImageSize(raw?: string | null): MitoViewImageSize {
  const clean = String(raw || "").trim().toLowerCase() as MitoViewImageSize;
  return IMAGE_SIZES.includes(clean) ? clean : "lg";
}

export function resolveArticleLayout(raw?: string | null): MitoViewArticleLayout {
  const clean = String(raw || "").trim().toLowerCase() as MitoViewArticleLayout;
  return ARTICLE_LAYOUTS.includes(clean) ? clean : "river";
}

export function mapApiPost(raw: Record<string, any> | null | undefined): MitoViewPost | null {
  if (!raw || typeof raw !== "object") return null;
  let parsedBody: any[] = [];
  const rawBody = raw.bodyJson ?? raw.BodyJson;
  if (Array.isArray(rawBody)) {
    parsedBody = rawBody;
  } else if (typeof rawBody === "string" && rawBody.trim()) {
    try {
      const candidate = JSON.parse(rawBody);
      if (Array.isArray(candidate)) parsedBody = candidate;
    } catch {
      parsedBody = [];
    }
  }

  const body: MitoViewBodyBlock[] = parsedBody
    .map((block: any): MitoViewBodyBlock | null => {
      if (!block || typeof block !== "object") return null;
      const t = String(block.type || "").trim().toLowerCase();
      if (t === "img") {
        return {
          type: "img",
          src: String(block.src || ""),
          alt: String(block.alt || ""),
          size: resolveImageSize(block.size ?? block.Size),
        };
      }
      if (t === "cta") {
        return {
          type: "cta",
          label: String(block.label || "Continue"),
          href: String(block.href || "/"),
        };
      }
      if (t === "kicker" || t === "h2" || t === "p") {
        return {
          type: t,
          text: String(block.text || ""),
        };
      }
      return null;
    })
    .filter((b): b is MitoViewBodyBlock => b !== null);

  const publishedRaw = raw.publishedAt ?? raw.PublishedAt;
  const statusRaw = String(raw.status ?? raw.Status ?? "").trim().toLowerCase();
  const slug = String(raw.slug ?? raw.Slug ?? "").trim();
  const title = String(raw.title ?? raw.Title ?? "").trim();
  if (!slug || !title) return null;

  return {
    slug,
    title,
    excerpt: String(raw.excerpt ?? raw.Excerpt ?? ""),
    editionSummary: String(raw.editionSummary ?? raw.EditionSummary ?? ""),
    publishedAt: typeof publishedRaw === "string" ? publishedRaw.slice(0, 10) : "",
    category: String(raw.category ?? raw.Category ?? ""),
    articleLayout: resolveArticleLayout(
      raw.articleLayout ?? raw.ArticleLayout ?? raw.layout ?? raw.Layout,
    ),
    heroSize: resolveImageSize(raw.heroSize ?? raw.HeroSize),
    audience: String(raw.audience ?? raw.Audience ?? "both"),
    status:
      statusRaw === "draft" || statusRaw === "published" || statusRaw === "archived"
        ? statusRaw
        : undefined,
    featured: Boolean(raw.featured ?? raw.Featured),
    heroTint: String(raw.heroTint ?? raw.HeroTint ?? "sky"),
    heroSrc: String(raw.heroSrc ?? raw.HeroSrc ?? ""),
    heroAlt: String(raw.heroAlt ?? raw.HeroAlt ?? ""),
    offerCta: {
      label: String(raw.offerCtaLabel ?? raw.OfferCtaLabel ?? "Continue"),
      path: String(raw.offerCtaPath ?? raw.OfferCtaPath ?? "/"),
    },
    socialSnippet: String(raw.socialSnippet ?? raw.SocialSnippet ?? ""),
    body,
  };
}

export function isPublicNewsletterPost(post: MitoViewPost): boolean {
  if (post.status === "draft" || post.status === "archived") return false;
  if (post.status === "published") return true;
  const cat = (post.category || "").trim().toLowerCase();
  return cat !== "draft" && cat !== "aira" && (!post.status || post.status === "published");
}

export function postVisibleOnBrand(post: MitoViewPost, brandId: string): boolean {
  const aud = (post.audience || "both").trim().toLowerCase();
  return aud === "both" || aud === brandId.toLowerCase();
}

export function searchNewsletterPosts(posts: MitoViewPost[], query: string): MitoViewPost[] {
  const q = query.trim().toLowerCase();
  if (!q) return posts;
  return posts.filter((post) => {
    const bodyText = post.body
      .map((b) => ("text" in b ? b.text : "alt" in b ? b.alt : b.label))
      .join(" ");
    const haystack = [post.title, post.excerpt, post.editionSummary, bodyText]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

/** Formats YYYY-MM-DD as Sentence-case British date (e.g. "29 July 2026") per PD-04. */
export function formatMitoViewDate(isoDate: string): string {
  if (!isoDate) return "";
  const clean = isoDate.slice(0, 10);
  const dt = new Date(`${clean}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(dt);
}

/** Converts ALL-CAPS editorial kickers to Sentence case while preserving known brand/acronyms (PD-04). */
export function toSentenceCaseKicker(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  if (trimmed !== trimmed.toUpperCase()) return trimmed;
  const lower = trimmed.toLowerCase();
  const base = lower.charAt(0).toUpperCase() + lower.slice(1);
  return base
    .replace(/\bfuntech\b/gi, "Funtech")
    .replace(/\brhemito\b/gi, "Rhemito")
    .replace(/\bmito\.money\b/gi, "mito.money")
    .replace(/\bmitoview\b/gi, "MitoView")
    .replace(/\brhemi\b/gi, "Rhemi")
    .replace(/\bonepipe\b/gi, "OnePipe")
    .replace(/\buk\b/gi, "UK")
    .replace(/\bfx\b/gi, "FX")
    .replace(/\bkyc\b/gi, "KYC")
    .replace(/\bapi\b/gi, "API");
}

const META_PREFIX_PATTERN =
  "meta\\s*title|meta\\s*description|seo\\s*title|seo\\s*description|seo\\s*keywords|url\\s*slug|canonical(?:\\s*url)?|permalink|og\\s*title|og\\s*description|og\\s*image|twitter\\s*title|twitter\\s*description|brand\\s*search\\s*line|focus\\s*keyword|search\\s*title|search\\s*description|site\\s*title|site\\s*seo\\s*title|site\\s*seo\\s*description|site\\s*seo\\s*footer|hero\\s*(?:src|url|alt)|social\\s*(?:snippet|cut)|edition\\s*summary|short\\s*version|article\\s*layout|tenant\\s*slug|body\\s*json|offer\\s*cta|featured\\s*image|slug";
const META_LINE_RE = new RegExp(`^(?:${META_PREFIX_PATTERN})\\s*:`, "i");
const META_INLINE_RE = new RegExp(`(?:^|(?<=\\s))(?:${META_PREFIX_PATTERN})\\s*:`, "i");
const SEO_RE = /^(?:seo\s*title|meta)\s*:/i;
const STATUS_LINE_RE =
  /^(?:status|audience|category)\s*:\s*(draft|published|archived|both|mito|rhemito|aira|edition)\s*$/i;

function collapseWs(s?: string): string {
  return (s || "").replace(/[ \t]+/g, " ").trim();
}

function normalizeLabel(s?: string): string {
  return collapseWs(
    (s || "")
      .replace(/^#{1,6}\s*/, "")
      .replace(/[*_#>`]+/g, " ")
      .replace(/[.:]+$/, ""),
  ).toLowerCase();
}

function labelsMatch(a?: string, b?: string): boolean {
  const na = normalizeLabel(a);
  const nb = normalizeLabel(b);
  return na.length > 0 && na === nb;
}

function isSectionLabel(s?: string): boolean {
  const c = collapseWs(s);
  if (!c || /[.?!]/.test(c)) return false;
  const words = c.split(" ").filter(Boolean);
  return words.length > 0 && words.length <= 8 && c.length <= 72;
}

function firstLine(s?: string): string {
  return (
    (s || "")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) || ""
  );
}

export function dedupeSectionLabels(blocks: MitoViewBodyBlock[]): MitoViewBodyBlock[] {
  const out: MitoViewBodyBlock[] = [];
  const lastLabelIdx = (arr: MitoViewBodyBlock[]) => {
    for (let i = arr.length - 1; i >= 0; i -= 1) {
      if (arr[i].type === "kicker" || arr[i].type === "h2") return i;
    }
    return -1;
  };

  for (const block of blocks || []) {
    if (block.type === "kicker" || block.type === "h2") {
      const prev = out[out.length - 1];
      if (prev?.type === "p" && isSectionLabel(prev.text) && labelsMatch(prev.text, block.text)) {
        out.pop();
      }
      const idx = lastLabelIdx(out);
      if (idx >= 0) {
        const existing = out[idx];
        if (
          (existing.type === "kicker" || existing.type === "h2") &&
          labelsMatch(existing.text, block.text)
        ) {
          if (existing.type === "kicker" && block.type === "h2") {
            out[idx] = block;
          }
          continue;
        }
      }
      out.push(block);
      continue;
    }
    if (block.type === "p") {
      const idx = lastLabelIdx(out);
      if (idx >= 0) {
        const existing = out[idx];
        if (
          (existing.type === "kicker" || existing.type === "h2") &&
          labelsMatch(existing.text, firstLine(block.text))
        ) {
          const lines = block.text.replace(/\r\n/g, "\n").trim().split("\n");
          const rest = lines
            .slice(1)
            .join("\n")
            .replace(/^[\s\-–—:.]+/, "")
            .trim();
          if (!rest) continue;
          out.push({ ...block, text: rest });
          continue;
        }
      }
    }
    out.push(block);
  }
  return out;
}

export function prepareArticleMedia(post: MitoViewPost): {
  heroSize: MitoViewImageSize;
  body: MitoViewBodyBlock[];
} {
  const hasHero = Boolean(post.heroSrc?.trim());
  const heroSize = resolveImageSize(post.heroSize);
  let bannerCount = hasHero && heroSize === "banner" ? 1 : 0;
  const seenImages = new Set<string>();
  if (hasHero) seenImages.add(post.heroSrc.trim());

  let skippedDuplicateTitleH2 = false;
  const filtered: MitoViewBodyBlock[] = [];

  for (const block of post.body || []) {
    if (block.type === "h2" && !skippedDuplicateTitleH2 && block.text === post.title) {
      skippedDuplicateTitleH2 = true;
      continue;
    }
    if (block.type === "img") {
      const src = (block.src || "").trim();
      if (!src || seenImages.has(src) || seenImages.size >= 6) continue;
      seenImages.add(src);
      let size = resolveImageSize(block.size);
      if (size === "banner") {
        if (bannerCount >= 2) size = "lg";
        else bannerCount += 1;
      }
      filtered.push({ ...block, src, size });
      continue;
    }
    filtered.push(block);
  }

  return {
    heroSize,
    body: dedupeSectionLabels(filtered),
  };
}

export function articleStandfirst(
  excerpt: string,
  title: string,
  slug: string,
  body: MitoViewBodyBlock[],
): string {
  if (!excerpt?.trim()) return "";
  const lines = excerpt
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => collapseWs(l.replace(/[*_]{1,2}/g, "")))
    .filter(
      (l) =>
        l.length > 0 &&
        !META_LINE_RE.test(l) &&
        !SEO_RE.test(l) &&
        !STATUS_LINE_RE.test(l),
    );
  let text = lines.join(" ");
  const inlineMatch = META_INLINE_RE.exec(text);
  if (inlineMatch && inlineMatch.index !== undefined) {
    text = text.slice(0, inlineMatch.index).trim();
  }
  if (title && text.toLowerCase().startsWith(title.trim().toLowerCase())) {
    text = text
      .slice(title.trim().length)
      .replace(/^[\s\-–—:.]+/, "")
      .trim();
  }
  text = collapseWs(text);
  if (!text || (slug && text.toLowerCase() === slug.toLowerCase())) return "";
  if (text.length > 180) text = `${text.slice(0, 179).trimEnd()}…`;
  if (title && labelsMatch(text, title)) return "";

  const prefix = text.replace(/…$/, "").trim();
  for (const b of body || []) {
    if (b.type !== "kicker" && b.type !== "h2" && b.type !== "p") continue;
    if (labelsMatch(text, b.text) || labelsMatch(text, firstLine(b.text))) return "";
    if (prefix.length >= 12 && collapseWs(b.text).toLowerCase().startsWith(prefix.toLowerCase())) {
      return "";
    }
    if (b.type === "p") break;
  }
  return text;
}
