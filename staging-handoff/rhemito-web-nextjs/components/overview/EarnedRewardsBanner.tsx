import { useEffect, useMemo, useState } from "react";
import { Badge, Box, Button, Flex, Text } from "@chakra-ui/react";
import { useRouter } from "next/router";
import api from "@/utils/apiClient";
import { apiData, apiField } from "@/utils/apiResult";
import { flagOn, isRewardsUiEnabled } from "@/utils/rewardsGate";

export interface EarnedRewardsBannerProps {
  /** Increment from parent after `POST Account/Rewards/Link` resolves (or dispatch `window.dispatchEvent(new Event("rhemito:rewards-linked"))`). */
  refreshKey?: number;
  /** Optional minimum card gateway payable floor override (defaults to 1.00 major units, 100 for JPY). */
  minPayableFloor?: number;
}

type SourceItem = {
  creditSource: string;
  available: number;
  floor: number;
  receiveCurrency: string;
};

type UnusedCreditItem = {
  id: string;
  creditSource: string;
  reasonCode: string;
  sourceLabel: string;
  remaining: number;
  currency: string;
  expiresOn: string;
  floor: number;
  receiveCurrency: string;
};

type CurrencyBalanceView = {
  currency: string;
  available: number;
  bySource: SourceItem[];
};

const SYMBOLS: Record<string, string> = {
  GBP: "£",
  USD: "$",
  EUR: "€",
  NGN: "₦",
  CAD: "C$",
  AUD: "A$",
  JPY: "¥",
  CNY: "¥",
  INR: "₹",
  ZAR: "R",
  KES: "KSh ",
  GHS: "GH₵",
  AED: "AED ",
};

const textOf = (row: any, name: string): string => {
  const value = apiField(row, name);
  return value == null ? "" : String(value).trim();
};

const numOf = (row: any, name: string, fallback = 0): number => {
  const value = apiField(row, name);
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const listOf = (row: any, name: string): any[] => {
  const value = apiField(row, name);
  return Array.isArray(value) ? value : [];
};

const currencyCode = (value: string): string =>
  String(value || "")
    .replace(/\s+/g, "")
    .toUpperCase();

const formatMoney = (amount: number, currency: string): string => {
  const cur = currencyCode(currency) || "GBP";
  const digits = cur === "JPY" ? 0 : 2;
  const formatted = Math.abs(Number(amount) || 0).toLocaleString("en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const symbol = SYMBOLS[cur] ?? `${cur} `;
  return `${amount < 0 ? "−" : ""}${symbol}${formatted}`;
};

const formatUkDate = (value: string): string => {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value.split("-").reverse().join("/");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", { timeZone: "Europe/London" });
};

const daysUntil = (ymd: string): number | null => {
  if (!ymd) return null;
  const isoDay = ymd.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDay)) {
    const parsed = new Date(ymd);
    if (Number.isNaN(parsed.getTime())) return null;
    const todayStr = new Date().toLocaleDateString("en-CA", {
      timeZone: "Europe/London",
    });
    const targetStr = parsed.toLocaleDateString("en-CA", {
      timeZone: "Europe/London",
    });
    return Math.round(
      (Date.parse(`${targetStr}T00:00:00Z`) -
        Date.parse(`${todayStr}T00:00:00Z`)) /
        86_400_000,
    );
  }
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Europe/London",
  });
  return Math.round(
    (Date.parse(`${isoDay}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );
};

const parseSources = (rows: any[]): SourceItem[] =>
  rows.map((row) => ({
    creditSource: (
      textOf(row, "creditSource") || textOf(row, "credit_source")
    ).toUpperCase(),
    available: numOf(row, "available", 0),
    floor: numOf(row, "floor", numOf(row, "minTransfer", 0)),
    receiveCurrency: currencyCode(textOf(row, "receiveCurrency")),
  }));

/**
 * Compact "Earned Bonus & Quick Redeem" overview card for `pages/overview/index.tsx`.
 *
 * - Hydrates from `GET Account/Rewards` on mount, on `refreshKey` changes, and whenever
 *   `"rhemito:rewards-linked"` is dispatched after `POST Account/Rewards/Link` completes.
 * - Renders `null` for zero-balance unreferred customers (preserving the clean Overview layout).
 * - Renders a slim dismissible confirmation strip if `referredBy` is set under a Referrer-Only (`0` referee bonus) rule.
 * - Surfaces exact earned credit amount, source attribution (`Welcome bonus` + inviter, `Referral bonus`, `Bonus offer`),
 *   eligibility guardrails (minimum transfer floor, corridor, 14-day expiry warning), and platform-truthful
 *   Payment-step redemption instructions (`RewardAtPayment.tsx`).
 */
export default function EarnedRewardsBanner({
  refreshKey = 0,
  minPayableFloor,
}: EarnedRewardsBannerProps) {
  const router = useRouter();
  const [reloadTick, setReloadTick] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [gateAllowed, setGateAllowed] = useState<boolean>(() =>
    isRewardsUiEnabled(),
  );
  const [bonusBlocked, setBonusBlocked] = useState(false);
  const [balances, setBalances] = useState<CurrencyBalanceView[]>([]);
  const [selectedCurrency, setSelectedCurrency] = useState("");
  const [unusedCredits, setUnusedCredits] = useState<UnusedCreditItem[]>([]);
  const [offerFloorsByCur, setOfferFloorsByCur] = useState<
    Record<string, { floor: number; receiveCurrency: string }>
  >({});
  const [referredBy, setReferredBy] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState("GBP");
  const [dismissedZeroStrip, setDismissedZeroStrip] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onLinked = () => setReloadTick((prev) => prev + 1);
    window.addEventListener("rhemito:rewards-linked", onLinked);
    return () => {
      window.removeEventListener("rhemito:rewards-linked", onLinked);
    };
  }, []);

  useEffect(() => {
    if (!isRewardsUiEnabled()) {
      setGateAllowed(false);
      setLoaded(true);
      return;
    }

    let cancelled = false;
    api
      .get("Account/Rewards")
      .then((body: any) => {
        if (cancelled) return;
        const data = apiData(body) || body;
        if (!data || typeof data !== "object" || !isRewardsUiEnabled(data)) {
          setGateAllowed(false);
          setLoaded(true);
          return;
        }

        setGateAllowed(true);
        setBonusBlocked(flagOn(data, "bonusBlocked", false));

        const primaryCur =
          currencyCode(
            textOf(data, "balanceCurrency") || textOf(data, "currency"),
          ) || "GBP";
        setDefaultCurrency(primaryCur);

        const topSources = parseSources(listOf(data, "bySource"));
        const rawBalances = listOf(data, "balances");
        const parsedBalances: CurrencyBalanceView[] = [];

        if (rawBalances.length > 0) {
          rawBalances.forEach((b: any) => {
            const cur = currencyCode(textOf(b, "currency")) || primaryCur;
            const avail = numOf(b, "available", 0);
            if (avail > 0) {
              const rowSources = parseSources(listOf(b, "bySource"));
              parsedBalances.push({
                currency: cur,
                available: avail,
                bySource:
                  rowSources.length > 0
                    ? rowSources
                    : cur === primaryCur
                      ? topSources
                      : [],
              });
            }
          });
        }

        if (parsedBalances.length === 0) {
          const fallbackAvail =
            apiField(data, "availableBalance") == null
              ? topSources.reduce((sum, s) => sum + s.available, 0)
              : numOf(data, "availableBalance", 0);
          if (fallbackAvail > 0) {
            parsedBalances.push({
              currency: primaryCur,
              available: fallbackAvail,
              bySource: topSources,
            });
          }
        }

        setBalances(parsedBalances);

        const rawUnused =
          listOf(data, "unusedCredits").length > 0
            ? listOf(data, "unusedCredits")
            : listOf(data, "unused");

        const parsedUnused: UnusedCreditItem[] = rawUnused
          .map((item: any, idx: number) => ({
            id: textOf(item, "id") || `cred-${idx}`,
            creditSource: (
              textOf(item, "creditSource") || textOf(item, "credit_source")
            ).toUpperCase(),
            reasonCode: (
              textOf(item, "reasonCode") || textOf(item, "reason_code")
            ).toUpperCase(),
            sourceLabel:
              textOf(item, "creditSourceLabel") ||
              textOf(item, "sourceLabel") ||
              textOf(item, "source") ||
              textOf(item, "notes"),
            remaining: numOf(item, "remaining", numOf(item, "amount", 0)),
            currency:
              currencyCode(textOf(item, "currency")) || primaryCur,
            expiresOn: textOf(item, "expiresOn") || textOf(item, "expiresAt"),
            floor: numOf(item, "floor", numOf(item, "minTransfer", 0)),
            receiveCurrency: currencyCode(textOf(item, "receiveCurrency")),
          }))
          .filter((item) => item.remaining > 0);
        setUnusedCredits(parsedUnused);

        const rawOffers =
          listOf(data, "currencyOffers").length > 0
            ? listOf(data, "currencyOffers")
            : listOf(data, "offers");
        const floorMap: Record<
          string,
          { floor: number; receiveCurrency: string }
        > = {};
        rawOffers.forEach((o: any) => {
          const cur =
            currencyCode(textOf(o, "currency") || textOf(o, "sendCurrency")) ||
            primaryCur;
          const fl = numOf(
            o,
            "minTransfer",
            numOf(o, "minSendAmount", numOf(o, "floor", 0)),
          );
          const rec = currencyCode(textOf(o, "receiveCurrency"));
          if (!floorMap[cur] || fl > 0) {
            floorMap[cur] = { floor: fl, receiveCurrency: rec };
          }
        });
        const singleOffer = apiField(data, "offer");
        if (singleOffer && typeof singleOffer === "object") {
          const cur =
            currencyCode(textOf(singleOffer, "currency")) || primaryCur;
          if (!floorMap[cur]) {
            floorMap[cur] = {
              floor: numOf(
                singleOffer,
                "minTransfer",
                numOf(singleOffer, "floor", 0),
              ),
              receiveCurrency: currencyCode(
                textOf(singleOffer, "receiveCurrency"),
              ),
            };
          }
        }
        setOfferFloorsByCur(floorMap);

        const refereeObj = apiField(data, "referee");
        const resolvedReferredBy =
          textOf(data, "referredBy") ||
          textOf(data, "referrerName") ||
          (refereeObj && typeof refereeObj === "object"
            ? textOf(refereeObj, "referrerName") ||
              textOf(refereeObj, "referredBy")
            : "");
        setReferredBy(resolvedReferredBy);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey, reloadTick]);

  const activeBalance = useMemo(() => {
    if (balances.length === 0) return null;
    return (
      balances.find((b) => b.currency === selectedCurrency) || balances[0]
    );
  }, [balances, selectedCurrency]);

  if (!loaded || !gateAllowed) {
    return null;
  }

  // Zero-balance handling: slim dismissible strip ONLY if referred under a Referrer-Only (0 referee bonus) rule
  if (!activeBalance || activeBalance.available <= 0) {
    if (!referredBy || dismissedZeroStrip) {
      return null;
    }
    const zeroFloor = offerFloorsByCur[defaultCurrency]?.floor || 0;
    return (
      <Flex
        data-testid="overview-referee-linked-strip"
        align="center"
        justify="space-between"
        wrap="wrap"
        gap="12px"
        bg="teal.50"
        border="1px solid"
        borderColor="teal.200"
        borderRadius="12px"
        px="16px"
        py="10px"
        mb="16px"
      >
        <Text fontSize="13px" color="teal.900" fontWeight="500">
          Referral link connected (invited by {referredBy}) —{" "}
          {zeroFloor > 0
            ? `send ${formatMoney(zeroFloor, defaultCurrency)}+ to unlock your friend's reward, or check Reward$ for active offers.`
            : "complete a qualifying transfer to unlock your friend's reward, or check Reward$ for active offers."}
        </Text>
        <Flex align="center" gap="12px" ml="auto">
          <Button
            variant="link"
            size="sm"
            color="#2e5bff"
            fontWeight="600"
            onClick={() => void router.push("/rewards")}
          >
            Details in Reward$
          </Button>
          <Button
            variant="ghost"
            size="xs"
            color="teal.800"
            aria-label="Dismiss referral notice"
            onClick={() => setDismissedZeroStrip(true)}
          >
            ✕
          </Button>
        </Flex>
      </Flex>
    );
  }

  const activeCur = activeBalance.currency;
  const activeAmountFormatted = formatMoney(activeBalance.available, activeCur);
  const activeUnused = unusedCredits.filter((c) => c.currency === activeCur);

  const referralSource = activeBalance.bySource.find(
    (s) => s.creditSource === "REFERRAL",
  );
  const schemeSources = activeBalance.bySource.filter(
    (s) =>
      s.creditSource === "SCHEME" ||
      s.creditSource === "BONUS_SCHEME" ||
      s.creditSource === "BONUS" ||
      s.creditSource === "MANUAL",
  );

  const referralAvailable = referralSource?.available ?? 0;
  const schemeAvailable = schemeSources.reduce(
    (sum, s) => sum + (s.available || 0),
    0,
  );
  const hasSourceSplit = referralAvailable + schemeAvailable > 0;

  const referralUnused = activeUnused.filter(
    (c) => c.creditSource === "REFERRAL" || c.reasonCode === "REFEREE",
  );
  const welcomeCredit = referralUnused.find(
    (c) =>
      c.reasonCode === "REFEREE" ||
      /^(Welcome bonus|Referee reward)/i.test(c.sourceLabel),
  );
  const inviterMatch = (welcomeCredit?.sourceLabel || "").match(
    /invited by\s+([^()]+?)(?:\)|$)/i,
  );
  const inviterName =
    inviterMatch?.[1]?.trim().replace(/\.+$/, "") || referredBy;

  const resolvedReferralFloor =
    referralSource?.floor ||
    referralUnused.find((c) => c.floor > 0)?.floor ||
    offerFloorsByCur[activeCur]?.floor ||
    0;

  const resolvedSchemeFloor = Math.max(
    0,
    ...schemeSources.map((s) => s.floor || 0),
    ...activeUnused
      .filter((c) => c.creditSource !== "REFERRAL")
      .map((c) => c.floor || 0),
  );

  const displayFloor =
    referralAvailable > 0 && schemeAvailable === 0
      ? resolvedReferralFloor
      : schemeAvailable > 0 && referralAvailable === 0
        ? resolvedSchemeFloor
        : Math.max(resolvedReferralFloor, resolvedSchemeFloor);

  const resolvedReceiveCurrency =
    referralSource?.receiveCurrency ||
    referralUnused.find((c) => Boolean(c.receiveCurrency))?.receiveCurrency ||
    offerFloorsByCur[activeCur]?.receiveCurrency ||
    "";

  const datedCredits = [...activeUnused]
    .filter((c) => Boolean(c.expiresOn))
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  const soonestAny = datedCredits[0] || null;
  const urgentCredits = datedCredits.filter((c) => {
    const d = daysUntil(c.expiresOn);
    return d !== null && d <= 14;
  });
  const soonestUrgent = urgentCredits[0] || null;
  const urgentDays = soonestUrgent
    ? Math.max(0, daysUntil(soonestUrgent.expiresOn) ?? 0)
    : null;

  const effectiveMinCardFloor =
    minPayableFloor !== undefined
      ? minPayableFloor
      : activeCur === "JPY"
        ? 100
        : 1;

  return (
    <Box
      data-testid="overview-earned-rewards-banner"
      bg="white"
      border="1px solid"
      borderColor="#87c2fc"
      borderLeftWidth="4px"
      borderLeftColor="teal.500"
      borderRadius="12px"
      p="16px"
      mb="16px"
      boxShadow="xs"
    >
      <Flex
        direction={{ base: "column", lg: "row" }}
        align={{ base: "stretch", lg: "center" }}
        justify="space-between"
        gap="16px"
      >
        {/* Zone A — What you earned & eligibility guardrails */}
        <Box flex="1" minW="0">
          <Flex align="center" wrap="wrap" gap="8px">
            <Text
              fontSize={{ base: "20px", md: "22px" }}
              fontWeight="700"
              color="#323130"
              lineHeight="1.15"
            >
              {activeAmountFormatted}
            </Text>
            <Text fontSize="12px" fontWeight="600" color="teal.700">
              available bonus
            </Text>

            {balances.length > 1 && (
              <Flex
                bg="gray.100"
                borderRadius="full"
                p="2px"
                gap="2px"
                role="group"
                aria-label="Bonus currency"
              >
                {balances.map((bal) => {
                  const isActive = bal.currency === activeCur;
                  return (
                    <Button
                      key={bal.currency}
                      size="xs"
                      variant={isActive ? "solid" : "ghost"}
                      bg={isActive ? "white" : "transparent"}
                      color={isActive ? "#323130" : "#605e5c"}
                      borderRadius="full"
                      px="10px"
                      h="22px"
                      fontSize="11px"
                      fontWeight="600"
                      boxShadow={isActive ? "xs" : "none"}
                      _hover={{ bg: isActive ? "white" : "gray.200" }}
                      onClick={() => setSelectedCurrency(bal.currency)}
                    >
                      {bal.currency} {formatMoney(bal.available, bal.currency)}
                    </Button>
                  );
                })}
              </Flex>
            )}

            {(referralAvailable > 0 || Boolean(welcomeCredit)) && (
              <Badge
                bg={welcomeCredit ? "teal.50" : "green.50"}
                color={welcomeCredit ? "teal.800" : "green.700"}
                border="1px solid"
                borderColor={welcomeCredit ? "teal.200" : "green.200"}
                borderRadius="full"
                px="10px"
                py="2px"
                fontSize="12px"
                fontWeight="600"
                textTransform="none"
              >
                {welcomeCredit ? "Welcome bonus" : "Referral bonus"}
                {schemeAvailable > 0 && referralAvailable > 0
                  ? ` · ${formatMoney(referralAvailable, activeCur)}`
                  : ""}
                {welcomeCredit && inviterName
                  ? ` · Invited by ${inviterName}`
                  : ""}
              </Badge>
            )}

            {(schemeAvailable > 0 ||
              (!hasSourceSplit && !welcomeCredit)) && (
              <Badge
                bg="purple.50"
                color="purple.800"
                border="1px solid"
                borderColor="purple.200"
                borderRadius="full"
                px="10px"
                py="2px"
                fontSize="12px"
                fontWeight="600"
                textTransform="none"
              >
                Bonus offer
                {hasSourceSplit && referralAvailable > 0
                  ? ` · ${formatMoney(schemeAvailable, activeCur)}`
                  : ""}
              </Badge>
            )}
          </Flex>

          <Flex align="center" wrap="wrap" gap="6px" mt="8px">
            <Badge
              bg="gray.100"
              color="#323130"
              borderRadius="6px"
              px="8px"
              py="2px"
              fontSize="11px"
              fontWeight="500"
              textTransform="none"
            >
              {displayFloor > 0
                ? `Min. transfer ${formatMoney(displayFloor, activeCur)}`
                : "No min. transfer"}
            </Badge>
            <Badge
              bg="gray.100"
              color="#323130"
              borderRadius="6px"
              px="8px"
              py="2px"
              fontSize="11px"
              fontWeight="500"
              textTransform="none"
            >
              {activeCur} → {resolvedReceiveCurrency || "All corridors"}
            </Badge>
            {soonestUrgent && urgentDays !== null ? (
              <Badge
                bg="orange.50"
                color="orange.800"
                border="1px solid"
                borderColor="orange.200"
                borderRadius="6px"
                px="8px"
                py="2px"
                fontSize="11px"
                fontWeight="600"
                textTransform="none"
              >
                {urgentDays === 0
                  ? `${formatMoney(soonestUrgent.remaining, activeCur)} expires today`
                  : urgentDays === 1
                    ? `${formatMoney(soonestUrgent.remaining, activeCur)} expires tomorrow`
                    : `${formatMoney(soonestUrgent.remaining, activeCur)} expires in ${urgentDays} days`}
              </Badge>
            ) : soonestAny?.expiresOn ? (
              <Badge
                bg="gray.100"
                color="#605e5c"
                borderRadius="6px"
                px="8px"
                py="2px"
                fontSize="11px"
                fontWeight="500"
                textTransform="none"
              >
                Expires {formatUkDate(soonestAny.expiresOn)}
              </Badge>
            ) : null}
          </Flex>
        </Box>

        {/* Zone B — Platform-truthful FURP Payment-step guidance + CTAs */}
        <Flex
          direction={{ base: "column", sm: "row" }}
          align={{ base: "stretch", sm: "center" }}
          justify="flex-end"
          gap="12px"
          pl={{ lg: "16px" }}
          borderLeftWidth={{ base: "0px", lg: "1px" }}
          borderColor="gray.100"
        >
          {bonusBlocked ? (
            <Box
              bg="orange.50"
              border="1px solid"
              borderColor="orange.200"
              borderRadius="10px"
              px="12px"
              py="8px"
              maxW={{ lg: "420px" }}
            >
              <Text fontSize="12px" color="orange.900" fontWeight="500">
                Bonus redemption is currently paused on your account. Please
                check Reward$ or contact support for assistance.
              </Text>
            </Box>
          ) : (
            <Box
              bg="#ecf5ff"
              border="1px solid"
              borderColor="#87c2fc"
              borderRadius="10px"
              px="12px"
              py="8px"
              maxW={{ lg: "460px" }}
            >
              <Text fontSize="12px" color="#323130" lineHeight="1.45">
                <Text as="span" fontWeight="700" color="#2e5bff">
                  How to redeem:
                </Text>{" "}
                Start a {activeCur} transfer
                {displayFloor > 0
                  ? ` of ${formatMoney(displayFloor, activeCur)}+`
                  : ""}
                {resolvedReceiveCurrency ? ` to ${resolvedReceiveCurrency}` : ""}{" "}
                → on the{" "}
                <Text as="span" fontWeight="600">
                  Payment step
                </Text>
                , tick{" "}
                <Text as="span" fontWeight="600">
                  Use bonus credit
                </Text>{" "}
                in Reward$ to deduct up to {activeAmountFormatted} off what you
                pay ({formatMoney(effectiveMinCardFloor, activeCur)} min card
                charge applies).
              </Text>
            </Box>
          )}

          <Flex
            direction={{ base: "row", sm: "column" }}
            align={{ base: "center", sm: "flex-end" }}
            justify="space-between"
            gap="6px"
            flexShrink={0}
          >
            {!bonusBlocked && (
              <Button
                bg="#2e5bff"
                _hover={{ bg: "#1e46e0" }}
                color="white"
                borderRadius="full"
                size="sm"
                h="36px"
                px="18px"
                fontSize="13px"
                fontWeight="600"
                onClick={() => void router.push("/transactions/sendmoney")}
              >
                Redeem on Send Money →
              </Button>
            )}
            <Button
              variant="link"
              size="xs"
              color="#2e5bff"
              fontSize="12px"
              fontWeight="600"
              onClick={() => void router.push("/rewards")}
            >
              Details in Reward$
            </Button>
          </Flex>
        </Flex>
      </Flex>
    </Box>
  );
}
