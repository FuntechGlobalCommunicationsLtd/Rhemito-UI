import {
  articleStandfirst,
  dedupeSectionLabels,
  formatMitoViewDate,
  isPublicNewsletterPost,
  mapApiPost,
  postVisibleOnBrand,
  prepareArticleMedia,
  resolveArticleLayout,
  resolveImageSize,
  searchNewsletterPosts,
  toSentenceCaseKicker,
  type MitoViewActionResponse,
  type MitoViewArticleLayout,
  type MitoViewBodyBlock,
  type MitoViewImageSize,
  type MitoViewListResponse,
  type MitoViewPost,
  type MitoViewSingleResponse,
} from "@shared/mitoView";

export {
  articleStandfirst,
  dedupeSectionLabels,
  formatMitoViewDate,
  isPublicNewsletterPost,
  mapApiPost,
  postVisibleOnBrand,
  prepareArticleMedia,
  resolveArticleLayout,
  resolveImageSize,
  searchNewsletterPosts,
  toSentenceCaseKicker,
  type MitoViewActionResponse,
  type MitoViewArticleLayout,
  type MitoViewBodyBlock,
  type MitoViewImageSize,
  type MitoViewListResponse,
  type MitoViewPost,
  type MitoViewSingleResponse,
};

export const MITOVIEW_POSTS_QUERY_KEY = [
  "/api/v1/MitoView/posts",
  { brand: "rhemito", includeDrafts: false },
] as const;

export const MITOVIEW_POST_DETAIL_QUERY_KEY = "/api/v1/MitoView/posts" as const;

function extractActionText(payload: unknown): string {
  if (typeof payload === "string") return payload.trim();
  if (!payload || typeof payload !== "object") return "";
  const rec = payload as Record<string, unknown>;
  const candidate =
    rec.data ?? rec.Data ?? rec.message ?? rec.Message ?? (rec.error as { message?: string } | undefined)?.message ?? "";
  return typeof candidate === "string" ? candidate.trim() : "";
}

function isActionFailed(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const rec = payload as Record<string, unknown>;
  if (rec.succeeded === false || rec.Succeeded === false) return true;
  if (String(rec.responseType ?? "").toLowerCase() === "error") return true;
  return false;
}

export async function fetchMitoViewPosts(): Promise<MitoViewPost[]> {
  const res = await fetch(
    "/api/v1/MitoView/posts?brand=rhemito&includeDrafts=false",
    {
      method: "GET",
      credentials: "include",
    },
  );
  if (!res.ok) {
    throw new Error("Unable to load MitoView posts.");
  }

  const body = (await res.json()) as
    | MitoViewListResponse
    | Record<string, unknown>[]
    | Record<string, unknown>;

  if (!Array.isArray(body) && isActionFailed(body)) {
    return [];
  }

  const rawItems = Array.isArray(body)
    ? body
    : Array.isArray((body as MitoViewListResponse).data)
      ? (body as MitoViewListResponse).data
      : Array.isArray((body as { Data?: Record<string, unknown>[] }).Data)
        ? ((body as { Data: Record<string, unknown>[] }).Data)
        : [];

  return rawItems
    .map((item) => mapApiPost(item))
    .filter((post): post is MitoViewPost => post !== null)
    .filter((post) => isPublicNewsletterPost(post))
    .filter((post) => postVisibleOnBrand(post, "rhemito"));
}

export async function fetchMitoViewPostBySlug(
  slug: string,
): Promise<MitoViewPost | null> {
  const cleanSlug = String(slug || "").trim();
  if (!cleanSlug) return null;

  const res = await fetch(
    `/api/v1/MitoView/posts/${encodeURIComponent(cleanSlug)}?brand=rhemito`,
    {
      method: "GET",
      credentials: "include",
    },
  );

  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error("Unable to load MitoView edition.");
  }

  const body = (await res.json()) as
    | MitoViewSingleResponse
    | Record<string, unknown>;

  if (isActionFailed(body)) {
    return null;
  }

  const rawPost =
    "data" in body && body.data && typeof body.data === "object"
      ? (body.data as Record<string, unknown>)
      : "Data" in body && body.Data && typeof body.Data === "object"
        ? (body.Data as Record<string, unknown>)
        : "slug" in body || "Slug" in body
          ? (body as Record<string, unknown>)
          : null;

  const mapped = mapApiPost(rawPost);
  if (!mapped) return null;
  if (!isPublicNewsletterPost(mapped) || !postVisibleOnBrand(mapped, "rhemito")) {
    return null;
  }
  return mapped;
}

export async function subscribeMitoView(
  email: string,
): Promise<{ message: string; alreadySubscribed: boolean }> {
  const cleanEmail = email.trim();
  const res = await fetch("/api/v1/MitoView/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email: cleanEmail }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok || isActionFailed(payload)) {
    const errText = extractActionText(payload);
    throw new Error(errText || "Could not subscribe right now. Please try again.");
  }

  const rawText = extractActionText(payload);
  const alreadySubscribed = /already have you/i.test(rawText);
  return {
    message: alreadySubscribed
      ? "We already have you on our list"
      : "Thank you for subscribing",
    alreadySubscribed,
  };
}

export async function requestMitoViewUnsubscribe(
  email: string,
): Promise<{ message: string }> {
  const cleanEmail = email.trim();
  const res = await fetch("/api/v1/MitoView/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email: cleanEmail }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok || isActionFailed(payload)) {
    const errText = extractActionText(payload);
    throw new Error(errText || "Could not send the confirm email. Try again.");
  }

  const msg = extractActionText(payload);
  return {
    message:
      msg ||
      "Check your email to confirm. If you are on this list, we sent a link.",
  };
}

export async function confirmMitoViewUnsubscribe(
  token: string,
): Promise<{ message: string }> {
  const cleanToken = token.trim();
  const res = await fetch("/api/v1/MitoView/unsubscribe/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token: cleanToken }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok || isActionFailed(payload)) {
    const errText = extractActionText(payload);
    throw new Error(
      errText || "This confirm link is invalid or has expired.",
    );
  }

  const msg = extractActionText(payload);
  return {
    message: msg || "You are unsubscribed for www.rhemito.com.",
  };
}

/** Smart object-position classes matching MitoView editorial photography crops. */
export function getMitoViewImagePositionClass(src: string): string {
  const lower = (src || "").toLowerCase();
  if (lower.includes("partners") || lower.includes("onepipe")) {
    return "object-[50%_12%]";
  }
  if (lower.includes("rhemi")) {
    return "object-[16%_42%]";
  }
  return "object-center";
}

/** Resolves post thumbnail media (heroSrc -> first body image -> Rhemito logo fallback). */
export function resolveMitoViewCardMedia(post: MitoViewPost): {
  src: string;
  alt: string;
  isLogoFallback: boolean;
} {
  if (post.heroSrc?.trim()) {
    return {
      src: post.heroSrc.trim(),
      alt: post.heroAlt?.trim() || post.title,
      isLogoFallback: false,
    };
  }
  for (const block of post.body || []) {
    if (block.type === "img" && block.src?.trim()) {
      return {
        src: block.src.trim(),
        alt: block.alt?.trim() || post.title || "MitoView",
        isLogoFallback: false,
      };
    }
  }
  return {
    src: "/Rhemito-logo.svg",
    alt: "Rhemito",
    isLogoFallback: true,
  };
}
