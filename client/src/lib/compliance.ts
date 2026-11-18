import type { ComplianceOverviewResponse } from "@shared/compliance";

export const COMPLIANCE_OVERVIEW_QUERY_KEY = "/api/compliance/overview" as const;

export async function fetchComplianceOverview(
  returnUrl?: string,
): Promise<ComplianceOverviewResponse | null> {
  const qs = new URLSearchParams();
  if (returnUrl && returnUrl.trim()) {
    qs.set("returnUrl", returnUrl.trim());
  }
  const url = qs.toString()
    ? `${COMPLIANCE_OVERVIEW_QUERY_KEY}?${qs.toString()}`
    : COMPLIANCE_OVERVIEW_QUERY_KEY;

  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
  });

  if (res.status === 401) {
    return null;
  }

  if (!res.ok) {
    const text = await res.text();
    let msg = "Unable to load compliance status.";
    if (text) {
      try {
        const parsed = JSON.parse(text) as {
          message?: string;
          error?: { message?: string };
        };
        msg = parsed?.message ?? parsed?.error?.message ?? msg;
      } catch {
        msg = text;
      }
    }
    throw new Error(msg);
  }

  return (await res.json()) as ComplianceOverviewResponse;
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Formats `YYYY-MM-DD...` or ISO date into `DD MMM YYYY` (e.g. `14 Feb 1973`, UTC-safe). */
export function formatComplianceDate(
  isoOrDate: string | null | undefined,
): string {
  const raw = String(isoOrDate ?? "").trim();
  if (!raw) return "—";

  const datePrefixMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  const dt = datePrefixMatch
    ? new Date(`${datePrefixMatch[1]}-${datePrefixMatch[2]}-${datePrefixMatch[3]}T00:00:00Z`)
    : new Date(raw);

  if (Number.isNaN(dt.getTime())) {
    return raw;
  }

  const day = String(dt.getUTCDate()).padStart(2, "0");
  const month = SHORT_MONTHS[dt.getUTCMonth()] ?? "";
  const year = dt.getUTCFullYear();
  return `${day} ${month} ${year}`;
}
