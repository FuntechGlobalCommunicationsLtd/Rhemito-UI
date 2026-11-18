import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ComplianceProfileData } from "@shared/compliance";
import { ComplianceVerifiedView } from "@/components/compliance/ComplianceVerifiedView";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  COMPLIANCE_OVERVIEW_QUERY_KEY,
  fetchComplianceOverview,
} from "@/lib/compliance";
import { fetchMitoKycJourney } from "@/lib/sendMoney";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Loader2,
} from "lucide-react";

const ALLOWED_KYC_STATUSES = [
  "Pending",
  "FAILED",
  "UNRESOLVED",
  "UNDERREVIEW",
  "SUCCESSFUL",
  "IDEXPIRED",
  "AMLEXPIRED",
  "IDPASSED",
  "IDBLOCKED",
] as const;

function extractJourneyCodeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.searchParams.get("journeyCode") || parsed.searchParams.get("journey_code") || null;
  } catch {
    const match = String(url).match(/[?&]journeyCode=([^&#]+)/i);
    return match ? decodeURIComponent(match[1]) : null;
  }
}

function normalizeKycStatus(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (upper === "COMPLETED" || upper === "APPROVED" || upper === "PASSED" || upper === "COMPSUCCESS") {
    return "SUCCESSFUL";
  }
  if (upper === "MANUALREVIEW" || upper === "INREVIEW" || upper === "IN_REVIEW") {
    return "UNDERREVIEW";
  }
  const matched = ALLOWED_KYC_STATUSES.find((s) => s.toUpperCase() === upper);
  return matched || null;
}

/**
 * Checks whether all modules and submodules in a Mito Journey (`ProfileUpdate`,
 * `AddressVerification`, `IdVerificationAml`, `BusinessIdVerificationAml`, etc.)
 * have reached `Completed` or `Approved` status.
 * Prevents premature redirect after `ProfileUpdate` when `IdVerificationAml` (Full/Extended KYC) is still pending.
 */
function areAllJourneyModulesCompleted(
  modules?: Array<{ moduleStatus?: string | null; subModules?: any[] | null }> | null,
): boolean {
  if (!Array.isArray(modules) || modules.length === 0) return true;
  return modules.every((m) => {
    const status = String(m?.moduleStatus || "").trim().toUpperCase();
    const selfDone = status === "COMPLETED" || status === "APPROVED";
    const subs = Array.isArray(m?.subModules) ? m.subModules : [];
    const subsDone = subs.length === 0 || areAllJourneyModulesCompleted(subs);
    return selfDone && subsDone;
  });
}

const EMPTY_COMPLIANCE_PROFILE: ComplianceProfileData = {
  uid: null,
  isBusinessProfile: false,
  fullName: "",
  occupation: null,
  dateOfBirth: null,
  gender: null,
  birthCountry: null,
  address: null,
  city: null,
  postCode: null,
  residentCountry: null,
  nationality: null,
  identificationType: null,
  documentNo: null,
  issuingCountry: null,
  issueDate: null,
  expiryDate: null,
  imageUrl: null,
  company: null,
};

export function CompliancePage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const returnUrl = useMemo(() => {
    if (typeof window === "undefined") return "/kyc/return";
    return `${window.location.origin}/kyc/return`;
  }, []);

  const [iframeLoading, setIframeLoading] = useState<boolean>(false);
  const [completedStatus, setCompletedStatus] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const sp = new URLSearchParams(window.location.search);
    return normalizeKycStatus(sp.get("orderStatus") || sp.get("status"));
  });

  const { data: overview, isLoading: isOverviewLoading } = useQuery({
    queryKey: [COMPLIANCE_OVERVIEW_QUERY_KEY, returnUrl],
    queryFn: () => fetchComplianceOverview(returnUrl),
    staleTime: 15_000,
  });

  const shouldFetchLocalJourney = Boolean(
    overview?.source === "local" &&
      overview?.journeyRecommended &&
      !completedStatus,
  );

  const { data: localJourney, isLoading: isLocalJourneyLoading } = useQuery({
    queryKey: ["/api/send-money/mito/kyc-journey", returnUrl],
    queryFn: () => fetchMitoKycJourney({ returnUrl, journeyType: 1 }),
    enabled: shouldFetchLocalJourney,
    staleTime: 15_000,
  });

  const hostedUrl = useMemo(() => {
    const raw =
      overview?.source === "furp"
        ? overview.hostedUrl
        : localJourney?.hostedUrl ?? overview?.hostedUrl;
    return typeof raw === "string" && raw.trim() ? raw.trim() : null;
  }, [overview, localJourney]);

  useEffect(() => {
    if (hostedUrl) {
      setIframeLoading(true);
    }
  }, [hostedUrl]);

  const journeyCode = useMemo(() => {
    const rawCode =
      overview?.source === "furp"
        ? overview.journeyCode
        : localJourney?.journeyCode ?? overview?.journeyCode;
    return rawCode || extractJourneyCodeFromUrl(hostedUrl);
  }, [overview, localJourney, hostedUrl]);

  const kycFlow =
    (overview?.source === "furp"
      ? overview.kycFlow
      : localJourney?.kycFlow ?? overview?.kycFlow) || null;

  const kycStatus =
    normalizeKycStatus(overview?.kyc?.status) ||
    normalizeKycStatus(localJourney?.kycStatus) ||
    overview?.kyc?.status ||
    localJourney?.kycStatus ||
    null;

  const effectiveKycType =
    overview?.kyc?.type || localJourney?.kycType || "AMLADDR";

  // Safety timeout so spinner over iframe never stays stuck
  useEffect(() => {
    if (!iframeLoading) return;
    const t = setTimeout(() => setIframeLoading(false), 12000);
    return () => clearTimeout(t);
  }, [iframeLoading]);

  const handleBlocked = useCallback(() => {
    toast({
      title: "Account blocked",
      description:
        "Your KYC has been blocked! Please contact the administrator for further assistance with your KYC verification.",
      variant: "destructive",
    });
    setLocation("/login");
  }, [toast, setLocation]);

  const markCompletedAndRefresh = useCallback(
    (nextStatus: string) => {
      setCompletedStatus(nextStatus);
      void queryClient.invalidateQueries({
        queryKey: [COMPLIANCE_OVERVIEW_QUERY_KEY],
      });
    },
    [queryClient],
  );

  // Listen for postMessage from hosted KYC iframe or /kyc/return
  useEffect(() => {
    if (!hostedUrl || completedStatus) return;
    const onMessage = (event: MessageEvent) => {
      try {
        const data =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (!data || typeof data !== "object") return;

        if (data.type === "MITO_LINK_SUCCESS") {
          const st =
            normalizeKycStatus(
              data.payload?.status || data.metadata?.status || "SUCCESSFUL",
            ) || "SUCCESSFUL";
          markCompletedAndRefresh(st);
          return;
        }

        const candidate = normalizeKycStatus(data.orderStatus || data.status);
        if (
          (data.type === "KYC_COMPLETE" || candidate) &&
          candidate &&
          candidate !== "Pending"
        ) {
          if (candidate === "IDBLOCKED") {
            handleBlocked();
            return;
          }
          markCompletedAndRefresh(candidate);
        }
      } catch {
        // ignore non-JSON messages
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [hostedUrl, completedStatus, handleBlocked, markCompletedAndRefresh]);

  // Poll GET /api/send-money/mito/journey-status?journeyCode=... every 2.5s while iframe is open
  useEffect(() => {
    if (!journeyCode || completedStatus) return;
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/send-money/mito/journey-status?journeyCode=${encodeURIComponent(journeyCode)}`,
          { credentials: "include" },
        );
        if (!res.ok || !active) return;
        const json = (await res.json()) as {
          data?: {
            journeyStatus?: string;
            orderStatus?: string | null;
            modules?: Array<{
              moduleStatus?: string | null;
              subModules?: any[] | null;
            }> | null;
          } | null;
        };
        const st = json.data;
        if (!st || !active) return;
        const jStatusUpper = String(st.journeyStatus || "").trim().toUpperCase();
        const allModulesDone = areAllJourneyModulesCompleted(st.modules);
        const isJourneyTerminal =
          jStatusUpper === "COMPLETED" ||
          jStatusUpper === "APPROVED" ||
          jStatusUpper === "FAILED" ||
          jStatusUpper === "CANCELLED" ||
          jStatusUpper === "CANCELED" ||
          jStatusUpper === "EXPIRED";
        if (!isJourneyTerminal && !allModulesDone) return;

        const normalizedOrder = normalizeKycStatus(st.orderStatus);
        const normalizedJourney = normalizeKycStatus(st.journeyStatus);
        const resolved =
          normalizedOrder && normalizedOrder !== "Pending"
            ? normalizedOrder
            : normalizedJourney && normalizedJourney !== "Pending"
              ? normalizedJourney
              : null;
        if (resolved) {
          if (resolved === "IDBLOCKED") {
            handleBlocked();
            return;
          }
          markCompletedAndRefresh(resolved);
        }
      } catch {
        // ignore transient poll errors
      }
    };
    const timer = setInterval(() => void poll(), 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [journeyCode, completedStatus, handleBlocked, markCompletedAndRefresh]);

  const effectiveStatus = completedStatus || kycStatus;
  const isVerified =
    completedStatus === "SUCCESSFUL" ||
    completedStatus === "IDPASSED" ||
    effectiveStatus === "SUCCESSFUL" ||
    effectiveStatus === "IDPASSED";
  const isUnderReview =
    completedStatus === "UNDERREVIEW" || effectiveStatus === "UNDERREVIEW";
  const isFailedOrContactAdmin =
    completedStatus === "FAILED" ||
    completedStatus === "UNRESOLVED" ||
    effectiveStatus === "FAILED" ||
    effectiveStatus === "UNRESOLVED" ||
    kycFlow === "Flow_Contact_Admin";

  const isLoading =
    isOverviewLoading || (shouldFetchLocalJourney && isLocalJourneyLoading);

  return (
    <DashboardLayout>
      <div className="w-full pb-12" data-testid="compliance-page">
        <h1 className="font-display mb-8 text-2xl font-light tracking-tight text-[#323130] md:text-[30px]">
          Compliance
        </h1>

        {isLoading ? (
          <div
            data-testid="compliance-loading-skeleton"
            className="w-full space-y-6 lg:pr-12"
          >
            <Skeleton className="h-6 w-56" />
            <div className="h-px w-full bg-[#e1dfdd]" />
            <Skeleton className="h-6 w-48" />
            <div className="space-y-4 pt-1">
              {[0, 1, 2, 3, 4, 5, 6].map((idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-6"
                >
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-4 w-44" />
                </div>
              ))}
            </div>
          </div>
        ) : isVerified ? (
          <ComplianceVerifiedView
            profile={overview?.profile ?? EMPTY_COMPLIANCE_PROFILE}
            kycType={effectiveKycType}
          />
        ) : isUnderReview ? (
          <div
            data-testid="compliance-under-review-card"
            className="mx-auto flex max-w-[600px] flex-col items-center py-6 text-center"
          >
            <AlertTriangle className="mx-auto my-8 h-[72px] w-[72px] text-[#DBA800]" />
            <p className="text-[15px] leading-relaxed text-[#323130]">
              Your KYC is under review, but you can still proceed with the
              transaction. The transaction will then be verified by the admin
              for further processing.
            </p>
            <Button
              type="button"
              onClick={() => setLocation("/")}
              data-testid="button-compliance-continue"
              className="mt-8 h-11 w-full max-w-[600px] cursor-pointer bg-[#2e5bff] text-sm font-medium text-white hover:bg-blue-700"
            >
              Continue
            </Button>
          </div>
        ) : isFailedOrContactAdmin ? (
          <div
            data-testid="compliance-failed-card"
            className="mx-auto flex max-w-[600px] flex-col items-center py-6 text-center"
          >
            <AlertTriangle className="mx-auto my-8 h-[72px] w-[72px] text-destructive" />
            <p className="text-[15px] leading-relaxed text-[#323130]">
              {effectiveStatus === "FAILED"
                ? "KYC verification failed. Please contact the administrator for further assistance with your KYC verification."
                : "Please contact the administrator for further assistance with your KYC verification."}
            </p>
            <Button
              type="button"
              onClick={() => setLocation("/")}
              data-testid="button-compliance-done"
              className="mt-8 h-11 w-full max-w-[600px] cursor-pointer bg-[#2e5bff] text-sm font-medium text-white hover:bg-blue-700"
            >
              Done
            </Button>
          </div>
        ) : hostedUrl ? (
          <div
            className="relative h-[calc(100dvh-180px)] min-h-[560px] w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs"
            data-testid="compliance-iframe-container"
          >
            {iframeLoading && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/90">
                <Loader2 className="h-8 w-8 animate-spin text-[#2e5bff]" />
                <p className="text-sm text-[#605e5c]">
                  Loading secure KYC verification...
                </p>
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={hostedUrl}
              title="KYC address verification"
              className={cn(
                "h-full w-full border-0 transition-opacity duration-300",
                iframeLoading ? "opacity-0" : "opacity-100",
              )}
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation allow-popups-to-escape-sandbox allow-modals"
              allow="camera; microphone; geolocation; fullscreen; clipboard-write"
              onLoad={() => setIframeLoading(false)}
              data-testid="compliance-kyc-iframe"
            />
          </div>
        ) : overview?.profile ? (
          <ComplianceVerifiedView
            profile={overview.profile}
            kycType={effectiveKycType}
          />
        ) : (
          <div className="py-6">
            <p className="text-[15px] text-[#605e5c]">
              {localJourney?.message ||
                "No additional KYC verification is currently required for your account."}
            </p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

/**
 * `/kyc` page — used when `POST /api/v1/Rate/validateRate` returns `kycUrl && !isTransactionAllowed`
 * during Send Money (matching `rhemito-web-nextjs-dev.herokuapp.com/kyc?url=...`).
 */
export function KycVerificationPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const searchParams = useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, []);

  const kycUrl = searchParams.get("url") || null;
  const initialOrderStatus = normalizeKycStatus(searchParams.get("orderStatus") || searchParams.get("status"));
  const journeyCode = useMemo(() => extractJourneyCodeFromUrl(kycUrl), [kycUrl]);

  const [status, setStatus] = useState<string | null>(initialOrderStatus);
  const [showContactAdmin, setShowContactAdmin] = useState<boolean>(false);
  const [iframeLoading, setIframeLoading] = useState<boolean>(Boolean(kycUrl));
  const handledRedirectRef = useRef<boolean>(false);

  const handleSuccessRedirect = useCallback(
    (resolvedOutcome?: string) => {
      if (handledRedirectRef.current) return;
      handledRedirectRef.current = true;
      toast({
        title: resolvedOutcome === "UNDERREVIEW" ? "KYC Under Review" : "KYC Verification Complete",
        description:
          resolvedOutcome === "UNDERREVIEW"
            ? "Your KYC is under review, but you can still proceed with the transaction. The transaction will then be verified by the admin for further processing."
            : "Your details have been verified. Resuming your money transfer...",
      });
      try {
        sessionStorage.setItem("rhemito_kyc_just_completed", "true");
      } catch {
        // ignore storage errors
      }
      setLocation("/send-money");
    },
    [toast, setLocation],
  );

  const handleCancelledRedirect = useCallback(() => {
    if (handledRedirectRef.current) return;
    handledRedirectRef.current = true;
    try {
      sessionStorage.setItem("rhemito_kyc_cancelled", "true");
    } catch {
      // ignore storage errors
    }
    setLocation("/send-money");
  }, [setLocation]);

  const handleFailedRedirect = useCallback(() => {
    if (handledRedirectRef.current) return;
    handledRedirectRef.current = true;
    toast({
      title: "KYC Verification Failed",
      description:
        "KYC verification failed! Please contact the administrator for further assistance with your KYC verification.",
      variant: "destructive",
    });
    setLocation("/send-money");
  }, [toast, setLocation]);

  const handleBlockedRedirect = useCallback(() => {
    if (handledRedirectRef.current) return;
    handledRedirectRef.current = true;
    toast({
      title: "Account Blocked",
      description:
        "Your account has been blocked! Please contact the administrator for further assistance with your KYC verification.",
      variant: "destructive",
    });
    setLocation("/login");
  }, [toast, setLocation]);

  const processStatusOutcome = useCallback(
    (incomingRaw: string | null | undefined) => {
      const rawUpper = String(incomingRaw || "").trim().toUpperCase();
      if (rawUpper === "CLOSED" || rawUpper === "CANCELLED" || rawUpper === "CANCELED") {
        handleCancelledRedirect();
        return;
      }
      const normalized = normalizeKycStatus(incomingRaw);
      if (!normalized || normalized === "Pending") return;
      setStatus(normalized);
      if (normalized === "SUCCESSFUL" || normalized === "UNDERREVIEW" || normalized === "IDPASSED") {
        handleSuccessRedirect(normalized);
      } else if (normalized === "FAILED") {
        handleFailedRedirect();
      } else if (normalized === "IDBLOCKED") {
        handleBlockedRedirect();
      } else {
        setShowContactAdmin(true);
      }
    },
    [handleSuccessRedirect, handleCancelledRedirect, handleFailedRedirect, handleBlockedRedirect],
  );

  useEffect(() => {
    if (!kycUrl && !initialOrderStatus) {
      setLocation("/");
      return;
    }
    if (initialOrderStatus) {
      processStatusOutcome(initialOrderStatus);
    }
  }, [kycUrl, initialOrderStatus, processStatusOutcome, setLocation]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (!data || typeof data !== "object") return;
        if (data.type === "MITO_LINK_SUCCESS") {
          processStatusOutcome(data.payload?.status || data.metadata?.status || "SUCCESSFUL");
          return;
        }
        if (data.type === "MITO_LINK_EXIT") {
          const exitStatus = data.error?.status || data.metadata?.status || "Closed";
          processStatusOutcome(exitStatus);
          return;
        }
        if (data.type === "KYC_COMPLETE" && (data.orderStatus || data.status)) {
          processStatusOutcome(data.orderStatus || data.status);
          return;
        }
        if (data.status || data.orderStatus) {
          processStatusOutcome(data.orderStatus || data.status);
        }
      } catch {
        // ignore non-JSON messages
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [processStatusOutcome]);

  // Poll journey status every 2.5s so completion inside the iframe triggers redirect immediately
  useEffect(() => {
    if (!journeyCode || status) return;
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/send-money/mito/journey-status?journeyCode=${encodeURIComponent(journeyCode)}`,
          { credentials: "include" },
        );
        if (!res.ok || !active) return;
        const json = (await res.json()) as {
          data?: {
            journeyStatus?: string;
            orderStatus?: string | null;
            modules?: Array<{ moduleStatus?: string | null; subModules?: any[] | null }> | null;
          } | null;
        };
        const st = json.data;
        if (!st || !active) return;
        const jStatusUpper = String(st.journeyStatus || "").trim().toUpperCase();
        const allModulesDone = areAllJourneyModulesCompleted(st.modules);
        const isJourneyTerminal =
          jStatusUpper === "COMPLETED" ||
          jStatusUpper === "APPROVED" ||
          jStatusUpper === "FAILED" ||
          jStatusUpper === "CANCELLED" ||
          jStatusUpper === "CANCELED" ||
          jStatusUpper === "EXPIRED";
        if (!isJourneyTerminal && !allModulesDone) return;

        const normalizedOrder = normalizeKycStatus(st.orderStatus);
        const normalizedJourney = normalizeKycStatus(st.journeyStatus);
        const resolved =
          normalizedOrder && normalizedOrder !== "Pending"
            ? normalizedOrder
            : normalizedJourney && normalizedJourney !== "Pending"
              ? normalizedJourney
              : null;
        if (resolved) {
          processStatusOutcome(resolved);
        }
      } catch {
        // ignore transient poll errors
      }
    };
    const timer = setInterval(() => void poll(), 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [journeyCode, status, processStatusOutcome]);

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto py-4 space-y-4" data-testid="kyc-verification-page">
        {showContactAdmin ? (
          <Card className="border-slate-200 bg-white shadow-xs">
            <CardContent className="p-8 space-y-4">
              <h1 className="text-2xl font-bold text-slate-900">Verification</h1>
              <h3 className="text-lg font-semibold text-slate-800">KYC verification status</h3>
              <p className="text-sm text-slate-600">
                Please contact the administrator for further assistance with your KYC verification.
              </p>
              <Button onClick={() => setLocation("/")} className="bg-blue-600 hover:bg-blue-700 text-white min-w-[140px]">
                Ok
              </Button>
            </CardContent>
          </Card>
        ) : !kycUrl || status ? (
          <Card className="border-slate-200 bg-white shadow-xs">
            <CardContent className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              <p className="text-sm text-slate-600">Completing KYC verification...</p>
            </CardContent>
          </Card>
        ) : (
          <div
            className="relative w-full rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs"
            style={{ height: "calc(100dvh - 160px)", minHeight: "560px" }}
            data-testid="kyc-iframe-container"
          >
            {iframeLoading && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/90 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                <p className="text-sm text-slate-600">Loading KYC verification...</p>
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={kycUrl}
              title="KYC Verification"
              className="w-full h-full border-0"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation allow-popups-to-escape-sandbox allow-modals"
              allow="camera; microphone; geolocation; fullscreen; clipboard-write"
              onLoad={() => setIframeLoading(false)}
              style={{
                opacity: iframeLoading ? 0 : 1,
                transition: "opacity 0.3s ease-in-out",
              }}
              data-testid="kyc-iframe"
            />
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

/**
 * `/kyc/return` and `/kyc/status` callback page — receives `?orderStatus=SUCCESSFUL` from `mito-checkout`,
 * posts `{ type: "KYC_COMPLETE", status, orderStatus, data, timestamp }` to `window.opener` or `window.parent`,
 * or redirects to `/kyc?orderStatus=...` if opened top-level.
 */
export function KycReturnPage() {
  const [, setLocation] = useLocation();
  const [state, setState] = useState<"sending" | "sent" | "missing_status">("sending");
  const [resolvedStatus, setResolvedStatus] = useState<string | null>(null);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const paramsObj: Record<string, string> = {};
    sp.forEach((value, key) => {
      paramsObj[key] = value;
    });

    const rawStatus = paramsObj.orderStatus || paramsObj.status;
    if (!rawStatus) {
      setState("missing_status");
      return;
    }

    const validStatus = normalizeKycStatus(rawStatus) || "Pending";
    setResolvedStatus(validStatus);

    const payload = {
      type: "KYC_COMPLETE",
      status: validStatus,
      orderStatus: validStatus,
      data: paramsObj,
      timestamp: new Date().toISOString(),
    };

    if (window.opener) {
      window.opener.postMessage(JSON.stringify(payload), "*");
      setState("sent");
      setTimeout(() => {
        window.close();
      }, 2000);
    } else if (window.parent !== window) {
      window.parent.postMessage(JSON.stringify(payload), "*");
      setState("sent");
    } else {
      const qs = new URLSearchParams({ ...paramsObj, orderStatus: validStatus }).toString();
      setLocation(`/kyc?${qs}`);
    }
  }, [setLocation]);

  return (
    <div className="min-h-screen bg-[#EDEBE9] flex items-center justify-center p-6" data-testid="kyc-return-page">
      <div className="max-w-lg text-center space-y-4">
        {state === "sent" && (
          <h2 className="text-2xl font-light text-slate-900">
            {resolvedStatus === "SUCCESSFUL" || resolvedStatus === "UNDERREVIEW"
              ? "Verification complete! You can now start sending money securely."
              : "Please contact the administrator for further assistance with your KYC verification."}
          </h2>
        )}
        {state === "missing_status" && (
          <p className="text-red-600 text-sm">KYC status parameter is missing. Please contact support.</p>
        )}
      </div>
    </div>
  );
}

export default CompliancePage;
