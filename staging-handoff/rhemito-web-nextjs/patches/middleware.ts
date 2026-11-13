import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Authenticated & sensitive routes where browser/CDN caching must be disabled.
 * Note: `/ref/` and `/refer/` are intentionally excluded so public referral links
 * load immediately for anonymous visitors without auth redirects.
 */
const SENSITIVE_PATH_PREFIXES = [
  "/login",
  "/signup",
  "/activateaccount",
  "/passwordchange",
  "/register-activation",
  "/resentactivate",
  "/settings",
  "/overview",
  "/rewards",
  "/transactions",
  "/beneficiaries",
  "/beneficiaries-details",
  "/compliance",
  "/kyc",
  "/my-tickets",
  "/notifications",
  "/support",
  "/support-ticket",
  "/request-support",
  "/track-request",
  "/send",
  "/app",
];

function isSensitivePath(pathname: string): boolean {
  return SENSITIVE_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function applySensitiveHeaders(response: NextResponse, pathname: string): NextResponse {
  if (isSensitivePath(pathname)) {
    response.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private",
    );
    response.headers.set("Pragma", "no-cache");
  }
  return response;
}

export function middleware(request: NextRequest) {
  const rawHost = request.headers.get("host") || request.nextUrl.hostname || "";
  const hostnameOnly = rawHost.split(":")[0].toLowerCase();
  const pathname = request.nextUrl.pathname;
  const search = request.nextUrl.search || "";

  const isLocalHost =
    hostnameOnly === "localhost" ||
    hostnameOnly === "127.0.0.1" ||
    hostnameOnly === "[::1]" ||
    hostnameOnly.startsWith("[::1]");

  // Heroku `*.herokuapp.com` uses a single-level wildcard certificate (`*.herokuapp.com`),
  // so redirecting `rhemito-web-nextjs-dev.herokuapp.com` to `www.rhemito-web-nextjs-dev.herokuapp.com`
  // causes SSL handshake failure (`ERR_CERT_COMMON_NAME_INVALID`).
  const isHerokuHost = hostnameOnly.endsWith(".herokuapp.com");

  // Lowercase `/faq` only — preserve query string (`?ref=`, `?utm_*`, etc.)
  if (pathname === "/faq") {
    const faqUrl = new URL(`/FAQ${search}`, request.url);
    return NextResponse.redirect(faqUrl, 301);
  }

  if (isLocalHost) {
    return applySensitiveHeaders(NextResponse.next(), pathname);
  }

  const forwardedProto = request.headers.get("x-forwarded-proto") || "";

  if (isHerokuHost) {
    if (forwardedProto && !forwardedProto.includes("https")) {
      return NextResponse.redirect(`https://${rawHost}${pathname}${search}`, 301);
    }
    return applySensitiveHeaders(NextResponse.next(), pathname);
  }

  // Production / custom apex domain: enforce `www.` + HTTPS while preserving query parameters (`?ref=`, `?to=`, `?rule=`)
  let targetHost = rawHost;
  if (!hostnameOnly.startsWith("www.")) {
    targetHost = `www.${rawHost}`;
    return NextResponse.redirect(`https://${targetHost}${pathname}${search}`, 301);
  }

  if (!forwardedProto.includes("https")) {
    return NextResponse.redirect(`https://${targetHost}${pathname}${search}`, 301);
  }

  return applySensitiveHeaders(NextResponse.next(), pathname);
}

export const config = {
  matcher: ["/:path*"],
};
