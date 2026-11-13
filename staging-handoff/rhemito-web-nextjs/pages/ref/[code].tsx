import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { Box, Button, Flex, Select, Spinner, Text } from "@chakra-ui/react";
import api from "@/utils/apiClient";
import { apiData, apiField, apiMessage, apiSucceeded } from "@/utils/apiResult";
import { flagOn } from "@/utils/rewardsGate";
import { toastrMsg } from "@/utils/toastrMsg";
import {
  APPLE_APP_STORE_URL,
  buildGooglePlayReferralUrl,
  clearReferral,
  getOrCreateVisitorId,
  normaliseReferralCode,
  REFERRAL_CODE_REGEX,
  saveReferral,
  type StoredReferralOffer,
} from "@/utils/referralStore";

type PlatformKind = "desktop" | "android" | "ios";

type NormalizedOffer = StoredReferralOffer & {
  ruleId?: number | null;
  sendCurrency: string;
  receiveCurrency: string | null;
  referrerBonus: number;
  refereeBonus: number;
  minTransfer: number;
  benefitType: "BOTH" | "REFEREE_ONLY" | "REFERRER_ONLY";
  headline: string;
  conditionText: string;
  capReached: boolean;
};

const SYMBOLS: Record<string, string> = {
  GBP: "£",
  USD: "$",
  EUR: "€",
  NGN: "₦",
  CAD: "C$",
  GHS: "GH₵",
  KES: "KSh ",
  INR: "₹",
  JPY: "¥",
};

function formatMoney(amount: number, currency: string): string {
  const cur = String(currency || "GBP").trim().toUpperCase();
  const digits = cur === "JPY" ? 0 : Number.isInteger(amount) ? 0 : 2;
  const formatted = Math.abs(amount).toLocaleString("en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const symbol = SYMBOLS[cur] ?? `${cur} `;
  return `${symbol}${formatted}`;
}

function numOf(source: any, name: string, fallback = 0): number {
  const raw = apiField(source, name);
  if (raw == null || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function strOf(source: any, name: string, fallback = ""): string {
  const raw = apiField(source, name);
  return raw == null ? fallback : String(raw).trim();
}

function detectPlatform(overrideQuery?: string): PlatformKind {
  const override = String(overrideQuery || "").trim().toLowerCase();
  if (override === "android" || override === "ios" || override === "desktop") {
    return override;
  }
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  if (/android/i.test(ua)) return "android";
  if (
    /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  ) {
    return "ios";
  }
  return "desktop";
}

function hasActiveAuthSession(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const cookieMatch = document.cookie.match(
      /(?:^|;\s*)(?:authToken|accessToken)=([^;]+)/,
    );
    if (cookieMatch?.[1] && cookieMatch[1] !== "undefined" && cookieMatch[1] !== "null") {
      return true;
    }
    const storedToken =
      window.localStorage?.getItem("authToken") ||
      window.localStorage?.getItem("accessToken");
    if (storedToken && storedToken !== "undefined" && storedToken !== "null") {
      return true;
    }
    const persisted = window.localStorage?.getItem("persist:root");
    if (persisted) {
      const root = JSON.parse(persisted);
      const authSlice = typeof root?.auth === "string" ? JSON.parse(root.auth) : root?.auth;
      if (authSlice?.token || authSlice?.authToken || authSlice?.isAuthenticated) {
        return true;
      }
    }
  } catch {
    // Ignore cookie/storage read errors
  }
  return false;
}

function normalizeOffer(
  raw: any,
  fallbackHeadline = "",
  referrerFirstName = "",
): NormalizedOffer {
  const sendCurrency =
    strOf(raw, "currency").toUpperCase() ||
    strOf(raw, "sendCurrency").toUpperCase() ||
    "GBP";
  const receiveRaw =
    strOf(raw, "receiveCurrency").toUpperCase() ||
    strOf(raw, "receive_currency").toUpperCase();
  const receiveCurrency = /^[A-Z]{3}$/.test(receiveRaw) ? receiveRaw : null;

  const referrerBonus = numOf(raw, "referrerBonus", numOf(raw, "referrerReward", 0));
  const refereeBonus = numOf(raw, "refereeBonus", numOf(raw, "refereeReward", 0));
  const minTransfer = numOf(
    raw,
    "minTransfer",
    numOf(raw, "minSendAmount", numOf(raw, "qualifyingAmount", 0)),
  );
  const rawBenefit = strOf(raw, "benefitType").toUpperCase();
  const benefitType: NormalizedOffer["benefitType"] =
    rawBenefit === "REFEREE_ONLY" || rawBenefit === "REFERRER_ONLY" || rawBenefit === "BOTH"
      ? rawBenefit
      : refereeBonus > 0 && referrerBonus > 0
        ? "BOTH"
        : refereeBonus > 0
          ? "REFEREE_ONLY"
          : "REFERRER_ONLY";

  const capReached = flagOn(raw, "capReached", false);
  const ruleNum = numOf(raw, "ruleId", 0);

  let headline =
    strOf(raw, "headline") ||
    strOf(raw, "offerText") ||
    fallbackHeadline;

  if (!headline) {
    const inviter = referrerFirstName || "Your friend";
    if (benefitType === "BOTH" && refereeBonus > 0 && referrerBonus > 0) {
      headline =
        refereeBonus === referrerBonus
          ? `${inviter} invited you — you both get ${formatMoney(refereeBonus, sendCurrency)} bonus credit`
          : `${inviter} invited you — get ${formatMoney(refereeBonus, sendCurrency)} bonus credit`;
    } else if (refereeBonus > 0) {
      headline = `${inviter} invited you — get ${formatMoney(refereeBonus, sendCurrency)} off your first transfer`;
    } else if (referrerBonus > 0) {
      headline = `Join Rhemito with ${inviter}'s invite`;
    } else {
      headline = `Join Rhemito with ${inviter}'s referral link`;
    }
  }

  const corridorSuffix = receiveCurrency ? ` to ${receiveCurrency}` : "";
  const conditionText =
    minTransfer > 0
      ? `Send ${formatMoney(minTransfer, sendCurrency)} or more${corridorSuffix} on your first qualifying transfer.`
      : `Complete your first qualifying transfer${corridorSuffix} after signing up.`;

  return {
    ruleId: ruleNum > 0 ? ruleNum : null,
    sendCurrency,
    receiveCurrency,
    currency: sendCurrency,
    referrerBonus,
    refereeBonus,
    minTransfer,
    benefitType,
    headline,
    summary: conditionText,
    conditionText,
    capReached,
  };
}

function buildSignupHref(
  code: string,
  receiveCurrency?: string | null,
  ruleId?: number | null,
): string {
  const params = new URLSearchParams();
  params.set("ref", code);
  if (receiveCurrency) params.set("to", receiveCurrency);
  if (ruleId && ruleId > 0) params.set("rule", String(ruleId));
  return `/signup?${params.toString()}`;
}

export default function ReferralLandingPage() {
  const router = useRouter();

  const rawCodeParam = Array.isArray(router.query.code)
    ? router.query.code[0]
    : router.query.code;
  const queryTo = Array.isArray(router.query.to) ? router.query.to[0] : router.query.to;
  const queryRule = Array.isArray(router.query.rule)
    ? router.query.rule[0]
    : router.query.rule;
  const queryPlatform = Array.isArray(router.query.platform)
    ? router.query.platform[0]
    : router.query.platform;
  const queryExisting = Array.isArray(router.query.existing)
    ? router.query.existing[0]
    : router.query.existing;

  const [loading, setLoading] = useState(true);
  const [signedInOnlyError, setSignedInOnlyError] = useState(false);
  const [errorTitle, setErrorTitle] = useState("");
  const [errorDetail, setErrorDetail] = useState("");
  const [validatedCode, setValidatedCode] = useState("");
  const [referrerName, setReferrerName] = useState("");
  const [offers, setOffers] = useState<NormalizedOffer[]>([]);
  const [selectedCurrency, setSelectedCurrency] = useState("");
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [playStoreUrl, setPlayStoreUrl] = useState<string>(buildGooglePlayReferralUrl());
  const [appStoreUrl, setAppStoreUrl] = useState<string>(APPLE_APP_STORE_URL);
  const [platform, setPlatform] = useState<PlatformKind>("desktop");
  const [copiedCode, setCopiedCode] = useState(false);

  const toastShownRef = useRef(false);
  const visitRecordedRef = useRef<string>("");

  useEffect(() => {
    setPlatform(detectPlatform(queryPlatform));
  }, [queryPlatform]);

  const activeOffer = useMemo<NormalizedOffer | null>(() => {
    if (offers.length === 0) return null;
    if (selectedCurrency) {
      const byCur = offers.find((o) => o.sendCurrency === selectedCurrency);
      if (byCur) return byCur;
    }
    return offers[0];
  }, [offers, selectedCurrency]);

  const availableCurrencies = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    offers.forEach((item) => {
      if (!seen.has(item.sendCurrency)) {
        seen.add(item.sendCurrency);
        list.push(item.sendCurrency);
      }
    });
    return list;
  }, [offers]);

  useEffect(() => {
    if (!router.isReady) return;
    let cancelled = false;

    const rawTrimmed = String(rawCodeParam || "").trim().toUpperCase();
    const code = normaliseReferralCode(rawTrimmed);

    // 1. Validate code format (`/^[A-Z0-9_-]{3,32}$/`)
    if (!code || !REFERRAL_CODE_REGEX.test(code)) {
      clearReferral();
      setErrorTitle("Invalid referral link");
      setErrorDetail(
        "This referral link doesn't look right. Check the link your friend shared or continue signing up directly.",
      );
      setLoading(false);
      return;
    }

    // 2. Signed-in customer guard ("Referral links are for new customers only")
    if (queryExisting === "1" || hasActiveAuthSession()) {
      clearReferral();
      setSignedInOnlyError(true);
      setLoading(false);
      if (!toastShownRef.current) {
        toastShownRef.current = true;
        toastrMsg(
          "Referral links are for new customers only",
          "Head to Reward$ to copy and share your own referral link.",
        );
      }
      return;
    }

    const runLookupAndTrack = async () => {
      setLoading(true);
      setErrorTitle("");
      setErrorDetail("");
      setSignedInOnlyError(false);

      try {
        const lookupBody = await api.get(
          `Account/Rewards/Code/${encodeURIComponent(code)}`,
        );
        if (cancelled) return;

        const data = apiData(lookupBody) || lookupBody;
        const ok =
          apiSucceeded(lookupBody) &&
          flagOn(data, "valid", true) !== false;

        if (!ok) {
          clearReferral();
          const msg = apiMessage(
            lookupBody,
            "This referral code isn't valid or has expired.",
          );
          const inactive = msg.toLowerCase().includes("no longer active");
          setErrorTitle(
            inactive
              ? "This referral link is no longer active"
              : "Referral link unavailable",
          );
          setErrorDetail(msg);
          setLoading(false);
          return;
        }

        // Server-side signedIn flag check (if session cookie was validated by backend)
        if (flagOn(data, "signedIn", false)) {
          clearReferral();
          setSignedInOnlyError(true);
          setLoading(false);
          if (!toastShownRef.current) {
            toastShownRef.current = true;
            toastrMsg(
              "Referral links are for new customers only",
              "Head to Reward$ to copy and share your own referral link.",
            );
          }
          return;
        }

        const resolvedCode = normaliseReferralCode(strOf(data, "code") || code) || code;
        const firstName = strOf(data, "referrerFirstName");
        const topHeadline = strOf(data, "offerText") || strOf(data, "headline");
        const topRuleId = numOf(data, "ruleId", 0);

        const rawOffers =
          apiField<any[]>(data, "offers") ||
          apiField<any[]>(data, "currencyOffers") ||
          [];
        const primaryOfferRaw = apiField<any>(data, "offer") || data;

        const normalizedList: NormalizedOffer[] =
          Array.isArray(rawOffers) && rawOffers.length > 0
            ? rawOffers.map((item) => normalizeOffer(item, topHeadline, firstName))
            : [normalizeOffer(primaryOfferRaw, topHeadline, firstName)];

        // Match `?rule=` or `?to=` if provided on the shared link
        const wantedRule = queryRule ? Number(queryRule) : 0;
        const wantedTo = queryTo ? String(queryTo).trim().toUpperCase() : "";
        const matched =
          (wantedRule > 0
            ? normalizedList.find((o) => o.ruleId === wantedRule)
            : undefined) ||
          (wantedTo
            ? normalizedList.find((o) => o.receiveCurrency === wantedTo)
            : undefined) ||
          normalizedList[0];

        setValidatedCode(resolvedCode);
        setReferrerName(firstName);
        setOffers(normalizedList);
        setSelectedCurrency(matched.sendCurrency);

        const visitorId = getOrCreateVisitorId();
        const detectedPlatform = detectPlatform(queryPlatform);
        const resolvedRuleId = matched.ruleId || (topRuleId > 0 ? topRuleId : null);
        const resolvedReceiveCur =
          wantedTo || matched.receiveCurrency || undefined;

        // Pre-save referral immediately so even if Visit network call is slow, attribution is safe
        const defaultPlayUrl = buildGooglePlayReferralUrl(null, resolvedCode);
        saveReferral({
          code: resolvedCode,
          visitorId,
          ruleId: resolvedRuleId,
          receiveCurrency: resolvedReceiveCur || null,
          referrerFirstName: firstName || null,
          offer: matched,
          playStoreUrl: defaultPlayUrl,
          appStoreUrl: APPLE_APP_STORE_URL,
        });
        setPlayStoreUrl(defaultPlayUrl);

        // 3. Record visit via `POST Account/Rewards/Visit`
        if (visitRecordedRef.current !== resolvedCode) {
          visitRecordedRef.current = resolvedCode;
          try {
            const visitPayload: Record<string, unknown> = {
              code: resolvedCode,
              visitorId,
              deviceType: detectedPlatform === "desktop" ? "desktop" : "mobile",
              operatingSystem:
                detectedPlatform === "android"
                  ? "Android"
                  : detectedPlatform === "ios"
                    ? "iOS"
                    : "Desktop",
              sourceChannel: "referral_link",
            };
            if (resolvedReceiveCur) visitPayload.receiveCurrency = resolvedReceiveCur;
            if (resolvedRuleId) visitPayload.ruleId = resolvedRuleId;

            const visitBody = await api.post("Account/Rewards/Visit", {
              data: visitPayload,
            });
            if (!cancelled) {
              const visitData = apiData(visitBody) || visitBody;
              const nextTrackingId = strOf(visitData, "trackingId") || null;
              const nextPlayUrl =
                strOf(visitData, "playStoreUrl") ||
                buildGooglePlayReferralUrl(nextTrackingId, resolvedCode);
              const nextAppUrl =
                strOf(visitData, "appStoreUrl") || APPLE_APP_STORE_URL;

              setTrackingId(nextTrackingId);
              setPlayStoreUrl(nextPlayUrl);
              setAppStoreUrl(nextAppUrl);

              saveReferral({
                code: resolvedCode,
                trackingId: nextTrackingId,
                visitorId,
                ruleId: resolvedRuleId,
                receiveCurrency: resolvedReceiveCur || null,
                referrerFirstName: firstName || null,
                offer: matched,
                playStoreUrl: nextPlayUrl,
                appStoreUrl: nextAppUrl,
              });
            }
          } catch {
            // Non-blocking: attribution code + offer are already stored in `referralStore`
          }
        }
      } catch (err: any) {
        if (cancelled) return;
        clearReferral();
        const message =
          (typeof err === "string" && err) ||
          err?.message ||
          "This referral code isn't valid or has expired.";
        const inactive = message.toLowerCase().includes("no longer active");
        setErrorTitle(
          inactive
            ? "This referral link is no longer active"
            : "Referral link unavailable",
        );
        setErrorDetail(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void runLookupAndTrack();

    return () => {
      cancelled = true;
    };
  }, [router.isReady, rawCodeParam, queryTo, queryRule, queryPlatform, queryExisting]);

  // Keep stored offer synced if user switches currency offer before continuing
  useEffect(() => {
    if (!validatedCode || !activeOffer) return;
    saveReferral({
      code: validatedCode,
      trackingId,
      ruleId: activeOffer.ruleId ?? null,
      receiveCurrency:
        (queryTo ? String(queryTo).toUpperCase() : activeOffer.receiveCurrency) ?? null,
      referrerFirstName: referrerName || null,
      offer: activeOffer,
      playStoreUrl,
      appStoreUrl,
    });
  }, [
    validatedCode,
    activeOffer,
    trackingId,
    referrerName,
    playStoreUrl,
    appStoreUrl,
    queryTo,
  ]);

  const signupHref = useMemo(() => {
    if (!validatedCode) return "/signup";
    const toParam = queryTo
      ? String(queryTo).toUpperCase()
      : activeOffer?.receiveCurrency || null;
    const ruleParam = queryRule
      ? Number(queryRule)
      : activeOffer?.ruleId || null;
    return buildSignupHref(validatedCode, toParam, ruleParam);
  }, [validatedCode, queryTo, queryRule, activeOffer]);

  // 4. Desktop auto-redirect to `/signup?ref=${code}` (preserving `?to=` & `?rule=`)
  useEffect(() => {
    if (
      loading ||
      signedInOnlyError ||
      errorTitle ||
      !validatedCode ||
      platform !== "desktop" ||
      activeOffer?.capReached
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void router.replace(signupHref);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    loading,
    signedInOnlyError,
    errorTitle,
    validatedCode,
    platform,
    activeOffer?.capReached,
    signupHref,
    router,
  ]);

  const handleCopyCode = async () => {
    if (!validatedCode) return;
    try {
      await navigator.clipboard.writeText(validatedCode);
      setCopiedCode(true);
      toastrMsg(
        "Referral code copied!",
        "Paste it during sign-up in the Rhemito app.",
      );
      window.setTimeout(() => setCopiedCode(false), 3000);
    } catch {
      toastrMsg("Copy code", `Your referral code is ${validatedCode}`);
    }
  };

  const handleContinueWithoutReferral = () => {
    clearReferral();
    void router.push("/signup");
  };

  return (
    <>
      <Head>
        <title>You&apos;ve been invited to Rhemito | Reward$</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <Flex
        minH="100vh"
        bg="gray.50"
        align="center"
        justify="center"
        px="16px"
        py="32px"
      >
        <Box
          w="100%"
          maxW="480px"
          bg="#fff"
          border="1px solid"
          borderColor="gray.200"
          borderRadius="20px"
          boxShadow="md"
          overflow="hidden"
          data-testid="referral-landing-card"
        >
          {/* Branded Rhemito Header */}
          <Box bg="var(--clr1, #4c1d95)" color="#fff" px="24px" py="20px">
            <Text fontSize="xs" fontWeight="700" letterSpacing="0.08em" textTransform="uppercase" opacity={0.9}>
              Rhemito Reward$
            </Text>
            <Text fontSize="22px" fontWeight="800" mt="4px" lineHeight="1.25">
              {signedInOnlyError
                ? "New customer invite"
                : errorTitle
                  ? "Invite check"
                  : referrerName
                    ? `${referrerName} invited you to Rhemito`
                    : "You've been invited to Rhemito"}
            </Text>
          </Box>

          <Box p="24px">
            {loading ? (
              <Flex direction="column" align="center" py="28px" gap="14px">
                <Spinner size="lg" color="var(--clr1, #4c1d95)" thickness="3px" />
                <Text fontSize="15px" color="gray.600">
                  Checking your referral invite...
                </Text>
              </Flex>
            ) : signedInOnlyError ? (
              <Flex direction="column" gap="16px" data-testid="referral-existing-customer">
                <Box
                  bg="orange.50"
                  border="1px solid"
                  borderColor="orange.200"
                  borderRadius="12px"
                  p="14px"
                >
                  <Text fontSize="15px" fontWeight="700" color="orange.900">
                    Referral links are for new customers only
                  </Text>
                  <Text fontSize="14px" color="orange.800" mt="4px">
                    You&apos;re already signed in to a Rhemito account. Visit Reward$ to share your own invite link with friends.
                  </Text>
                </Box>
                <Button
                  h="46px"
                  borderRadius="12px"
                  bg="var(--clr1, #4c1d95)"
                  color="#fff"
                  _hover={{ opacity: 0.92 }}
                  onClick={() => router.push("/rewards")}
                >
                  Go to Reward$
                </Button>
                <Button
                  variant="ghost"
                  h="42px"
                  borderRadius="12px"
                  color="gray.600"
                  onClick={() => router.push("/overview")}
                >
                  Back to Overview
                </Button>
              </Flex>
            ) : errorTitle ? (
              <Flex direction="column" gap="16px" data-testid="referral-invalid-state">
                <Box
                  bg="red.50"
                  border="1px solid"
                  borderColor="red.200"
                  borderRadius="12px"
                  p="14px"
                >
                  <Text fontSize="15px" fontWeight="700" color="red.800">
                    {errorTitle}
                  </Text>
                  <Text fontSize="14px" color="red.700" mt="4px">
                    {errorDetail}
                  </Text>
                </Box>
                <Button
                  h="46px"
                  borderRadius="12px"
                  bg="var(--clr1, #4c1d95)"
                  color="#fff"
                  _hover={{ opacity: 0.92 }}
                  onClick={handleContinueWithoutReferral}
                >
                  Continue to sign up without a referral
                </Button>
              </Flex>
            ) : activeOffer ? (
              <Flex direction="column" gap="18px">
                {/* Multi-currency offer selector when referrer has multiple send-currency rules */}
                {availableCurrencies.length > 1 && (
                  <Flex align="center" justify="space-between" gap="10px">
                    <Text fontSize="13px" fontWeight="600" color="gray.600">
                      Sending currency
                    </Text>
                    <Select
                      aria-label="Sending currency"
                      size="sm"
                      maxW="120px"
                      borderRadius="10px"
                      value={selectedCurrency}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                        setSelectedCurrency(e.target.value)
                      }
                    >
                      {availableCurrencies.map((cur) => (
                        <option key={cur} value={cur}>
                          {cur}
                        </option>
                      ))}
                    </Select>
                  </Flex>
                )}

                {/* Offer Summary Card */}
                <Box
                  bg="teal.50"
                  border="1px solid"
                  borderColor="teal.200"
                  borderRadius="14px"
                  p="16px"
                >
                  <Text fontSize="17px" fontWeight="700" color="teal.900" lineHeight="1.35">
                    {activeOffer.headline}
                  </Text>
                  <Text fontSize="14px" color="teal.800" mt="6px">
                    {activeOffer.conditionText}
                  </Text>
                  {activeOffer.capReached && (
                    <Text
                      fontSize="13px"
                      fontWeight="600"
                      color="orange.800"
                      bg="orange.100"
                      borderRadius="8px"
                      px="10px"
                      py="6px"
                      mt="10px"
                    >
                      Note: Your friend has reached their referral reward limit, so bonus credit may no longer apply to this invite.
                    </Text>
                  )}
                </Box>

                {/* Referral Code Display */}
                <Flex
                  align="center"
                  justify="space-between"
                  bg="gray.50"
                  border="1px dashed"
                  borderColor="gray.300"
                  borderRadius="12px"
                  px="14px"
                  py="10px"
                >
                  <Box>
                    <Text fontSize="11px" fontWeight="700" color="gray.500" textTransform="uppercase">
                      Referral code
                    </Text>
                    <Text fontSize="17px" fontWeight="800" fontFamily="mono" color="gray.900">
                      {validatedCode}
                    </Text>
                  </Box>
                  {platform === "ios" && (
                    <Button
                      size="sm"
                      h="36px"
                      px="14px"
                      borderRadius="10px"
                      variant="outline"
                      borderColor="var(--clr1, #4c1d95)"
                      color="var(--clr1, #4c1d95)"
                      onClick={handleCopyCode}
                      data-testid="ios-copy-referral-code"
                    >
                      {copiedCode ? "Copied!" : "Copy referral code"}
                    </Button>
                  )}
                </Flex>

                {/* OS-Specific Action Branching */}
                {platform === "android" && (
                  <Flex direction="column" gap="12px" data-testid="referral-android-actions">
                    <Button
                      as="a"
                      href={playStoreUrl}
                      h="48px"
                      borderRadius="12px"
                      bg="var(--clr1, #4c1d95)"
                      color="#fff"
                      fontWeight="700"
                      _hover={{ opacity: 0.92 }}
                    >
                      Get it on Google Play
                    </Button>
                    <Button
                      variant="ghost"
                      h="42px"
                      borderRadius="12px"
                      color="var(--clr1, #4c1d95)"
                      fontWeight="600"
                      onClick={() => router.push(signupHref)}
                    >
                      Continue on Web
                    </Button>
                  </Flex>
                )}

                {platform === "ios" && (
                  <Flex direction="column" gap="12px" data-testid="referral-ios-actions">
                    <Text fontSize="13px" color="gray.600">
                      Copy your invite code above first so it&apos;s ready to paste when you open the Rhemito iOS app.
                    </Text>
                    <Button
                      as="a"
                      href={appStoreUrl}
                      h="48px"
                      borderRadius="12px"
                      bg="var(--clr1, #4c1d95)"
                      color="#fff"
                      fontWeight="700"
                      _hover={{ opacity: 0.92 }}
                    >
                      Download on the App Store
                    </Button>
                    <Button
                      variant="ghost"
                      h="42px"
                      borderRadius="12px"
                      color="var(--clr1, #4c1d95)"
                      fontWeight="600"
                      onClick={() => router.push(signupHref)}
                    >
                      Continue on Web
                    </Button>
                  </Flex>
                )}

                {platform === "desktop" && (
                  <Flex direction="column" gap="12px" data-testid="referral-desktop-actions">
                    {!activeOffer.capReached && (
                      <Flex align="center" gap="8px" color="gray.600" fontSize="13px">
                        <Spinner size="xs" color="var(--clr1, #4c1d95)" />
                        <Text>Taking you to sign up with your invite applied...</Text>
                      </Flex>
                    )}
                    <Button
                      h="48px"
                      borderRadius="12px"
                      bg="var(--clr1, #4c1d95)"
                      color="#fff"
                      fontWeight="700"
                      _hover={{ opacity: 0.92 }}
                      onClick={() => router.push(signupHref)}
                    >
                      Continue to sign up
                    </Button>
                  </Flex>
                )}
              </Flex>
            ) : null}
          </Box>
        </Box>
      </Flex>
    </>
  );
}
