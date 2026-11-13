import {
  ReactElement,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import {
  Badge,
  Box,
  Button,
  Flex,
  Input,
  Progress,
  Select,
  SimpleGrid,
  Text,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import PrivateRoute from "@/components/layout/PrivateRoute";
import PageTitle from "@/components/layout/PageTitle";
import api from "@/utils/apiClient";
import { apiData, apiField } from "@/utils/apiResult";
import { savePromoDraft } from "@/utils/promoCodeDraft";
import { flagOn } from "@/utils/rewardsGate";
import { toastrMsg } from "@/utils/toastrMsg";

type RewardKind = {
  kind: string;
  title: string;
  summary: string;
  enabled: boolean;
};

type CurrencyOffer = {
  currency: string;
  receiveCurrency: string;
  ruleId: number | null;
  referralCode: string;
  offerText: string;
  capReached: boolean;
  referrerBonus: number;
  refereeBonus: number;
  minTransfer: number;
};

type HistoryKind = "earned" | "used" | "expired" | "promo";

type HistoryRow = {
  id: string;
  date: string;
  description: string;
  kind: HistoryKind;
  amount: number;
  currency: string;
  status?: string;
  returned?: boolean;
  creditSource: string;
};

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "history", label: "History" },
  { id: "referrals", label: "My referrals" },
];

const HISTORY_FILTERS: { id: "all" | HistoryKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "earned", label: "Bonus earned" },
  { id: "used", label: "Bonus used" },
  { id: "expired", label: "Bonus expired" },
  { id: "promo", label: "Promo codes" },
];

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

const SOURCE_LABEL: Record<string, string> = {
  REFERRAL: "Referrals",
  SCHEME: "Bonus offers",
  MANUAL: "From Rhemito",
  PROMO: "Promo code",
};

const CREDIT_STATUS: Record<string, string> = {
  UNUSED: "Unused",
  PARTLY_USED: "Partly used",
  USED: "Used",
  EXPIRED: "Expired",
  REVERSED: "Reversed",
};

const REFERRAL_STATUS: Record<string, string> = {
  REGISTERED: "Joined",
  PENDING: "In progress",
  REWARDED: "Earned",
  EXPIRED: "Expired",
  NOT_ELIGIBLE: "Not eligible",
  REVERSED: "Reversed",
};

const REFERRAL_STEPS = [
  "Friend signed up",
  "Sends qualifying transfer",
  "Bonus credited",
];

const fallbackKinds: RewardKind[] = [
  {
    kind: "REFERRAL",
    title: "Refer & Earn",
    summary:
      "Invite a friend. You, they, or both of you can earn bonus credit when their first qualifying transfer goes through.",
    enabled: true,
  },
  {
    kind: "BONUS_SCHEME",
    title: "Bonus schemes",
    summary:
      "Extra credit for a large transfer, loyalty after several transfers, or a bonus when someone pays a request.",
    enabled: true,
  },
  {
    kind: "PROMO",
    title: "Promo codes",
    summary: "Enter a code on the payment step of Send Money. It comes off what you pay or boosts payout.",
    enabled: true,
  },
];

const textOf = (row: any, name: string) => {
  const value = apiField(row, name);
  return value == null ? "" : String(value);
};

const numOf = (row: any, name: string, fallback = 0) => {
  const value = apiField(row, name);
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sourceKey = (row: any) =>
  textOf(row, "creditSource").toUpperCase() ||
  textOf(row, "credit_source").toUpperCase();

const currencyCode = (value: string) => value.replace(/\s/g, "").toUpperCase();

const sourceLabel = (source: string) => SOURCE_LABEL[source] || source || "Bonus";

const money = (amount: number, currency: string) => {
  const cur = (currency || "GBP").toUpperCase();
  const digits = cur === "JPY" ? 0 : 2;
  const formatted = Math.abs(amount).toLocaleString("en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const symbol = SYMBOLS[cur] ?? `${cur} `;
  return `${amount < 0 ? "−" : ""}${symbol}${formatted}`;
};

const when = (value: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { timeZone: "UTC" });
};

/**
 * Returns remaining whole days until `expiresAt` when within the 14-day warning window (`0..14`),
 * or `null` if further away / invalid / already past.
 */
const expiringWithin14Days = (value: string): number | null => {
  if (!value) return null;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return null;
  const diffMs = target.getTime() - Date.now();
  if (diffMs < 0) return null;
  const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  return days <= 14 ? days : null;
};

const expiryPillText = (days: number): string => {
  if (days <= 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  return `Expires in ${days} days`;
};

const listOf = (data: any, name: string) => {
  const value = apiField(data, name);
  return Array.isArray(value) ? value : [];
};

const card = {
  bg: "#fff",
  border: "1px solid",
  borderColor: "gray.200",
  borderRadius: "14px",
  p: "16px",
};

const parseCurrencyOffers = (
  data: any,
  defaultCode: string,
  defaultOfferText: string,
  defaultCurrency: string,
  defaultCapReached: boolean,
): CurrencyOffer[] => {
  const rawList =
    listOf(data, "currencyOffers").length > 0
      ? listOf(data, "currencyOffers")
      : listOf(data, "offers");

  if (rawList.length > 0) {
    return rawList.map((item: any) => {
      const cur =
        currencyCode(
          textOf(item, "currency") || textOf(item, "sendCurrency") || defaultCurrency,
        ) || "GBP";
      const rec = currencyCode(textOf(item, "receiveCurrency"));
      const ruleNum = numOf(item, "ruleId", 0);
      const itemCode =
        textOf(item, "referralCode").toUpperCase() ||
        textOf(item, "code").toUpperCase() ||
        defaultCode;
      const referrerBonus = numOf(item, "referrerBonus", numOf(item, "referrerReward", 0));
      const refereeBonus = numOf(item, "refereeBonus", numOf(item, "refereeReward", 0));
      const minTransfer = numOf(
        item,
        "minTransfer",
        numOf(item, "minSendAmount", numOf(item, "qualifyingAmount", 0)),
      );
      let offerText = textOf(item, "offerText") || textOf(item, "headline");
      if (!offerText && (referrerBonus > 0 || refereeBonus > 0)) {
        const corridorPart = rec ? ` to ${rec}` : "";
        const minPart = minTransfer > 0 ? ` when they send ${money(minTransfer, cur)}+${corridorPart}` : corridorPart;
        if (referrerBonus > 0 && refereeBonus > 0) {
          offerText = `Earn ${money(referrerBonus, cur)} and give your friend ${money(refereeBonus, cur)}${minPart}.`;
        } else if (referrerBonus > 0) {
          offerText = `Earn ${money(referrerBonus, cur)}${minPart}.`;
        } else {
          offerText = `Give your friend ${money(refereeBonus, cur)}${minPart}.`;
        }
      }
      return {
        currency: cur,
        receiveCurrency: rec,
        ruleId: ruleNum > 0 ? ruleNum : null,
        referralCode: itemCode,
        offerText: offerText || defaultOfferText,
        capReached: flagOn(item, "capReached", defaultCapReached),
        referrerBonus,
        refereeBonus,
        minTransfer,
      };
    });
  }

  const singleOfferObj = apiField(data, "offer");
  if (singleOfferObj && typeof singleOfferObj === "object") {
    const cur =
      currencyCode(textOf(singleOfferObj, "currency") || defaultCurrency) || "GBP";
    const rec = currencyCode(textOf(singleOfferObj, "receiveCurrency"));
    const ruleNum = numOf(singleOfferObj, "ruleId", 0);
    return [
      {
        currency: cur,
        receiveCurrency: rec,
        ruleId: ruleNum > 0 ? ruleNum : null,
        referralCode:
          textOf(singleOfferObj, "referralCode").toUpperCase() ||
          textOf(singleOfferObj, "code").toUpperCase() ||
          defaultCode,
        offerText:
          textOf(singleOfferObj, "offerText") ||
          textOf(singleOfferObj, "headline") ||
          defaultOfferText,
        capReached: flagOn(singleOfferObj, "capReached", defaultCapReached),
        referrerBonus: numOf(singleOfferObj, "referrerBonus"),
        refereeBonus: numOf(singleOfferObj, "refereeBonus"),
        minTransfer: numOf(singleOfferObj, "minTransfer"),
      },
    ];
  }

  return [
    {
      currency: defaultCurrency || "GBP",
      receiveCurrency: "",
      ruleId: null,
      referralCode: defaultCode,
      offerText: defaultOfferText,
      capReached: defaultCapReached,
      referrerBonus: 0,
      refereeBonus: 0,
      minTransfer: 0,
    },
  ];
};

const buildHistory = (
  history: any[],
  unused: any[],
  promos: any[],
  currency: string,
): HistoryRow[] => {
  const leftById = new Map<string, number>();
  unused.forEach((row) => {
    const id = textOf(row, "id");
    if (id) leftById.set(id, numOf(row, "remaining"));
  });
  const rows: HistoryRow[] = [];
  history.forEach((row) => {
    const type = textOf(row, "type").toUpperCase();
    if (type === "CLAWBACK" || type === "CLAWBACK_SETTLED") return;
    const cur = currencyCode(textOf(row, "currency") || currency);
    if (currency && cur !== currencyCode(currency)) return;
    const source = sourceKey(row);
    const amount = numOf(row, "amount");
    const id = textOf(row, "id") || `${type}-${textOf(row, "createdAt")}`;
    const date = textOf(row, "createdAt");
    if (type === "EARNED" || type === "RETURNED") {
      const left = leftById.get(textOf(row, "id"));
      let status = "USED";
      if (left != null && left > 0.001 && left + 0.001 < Math.abs(amount)) {
        status = "PARTLY_USED";
      } else if (left != null && left > 0.001) {
        status = "UNUSED";
      }
      rows.push({
        id,
        date,
        description: textOf(row, "label") || sourceLabel(source),
        kind: "earned",
        amount,
        currency: cur,
        status,
        returned:
          type === "RETURNED" ||
          textOf(row, "reasonCode").toUpperCase() === "BONUS_RETURNED",
        creditSource: source,
      });
      return;
    }
    if (type === "APPLIED") {
      const transfer = textOf(row, "transferId");
      rows.push({
        id,
        date,
        description: transfer
          ? `Bonus used on transfer ${transfer}`
          : "Bonus used on a transfer",
        kind: "used",
        amount,
        currency: cur,
        creditSource: source,
      });
      return;
    }
    const removed = type === "VOIDED";
    rows.push({
      id,
      date,
      kind: "expired",
      amount,
      currency: cur,
      creditSource: source,
      description: removed
        ? source && source !== "REFERRAL"
          ? "Bonus removed – transfer or request reversed"
          : "Referral bonus removed – transfer reversed"
        : "Bonus credit expired",
    });
  });
  promos.forEach((row) => {
    const cur = currencyCode(textOf(row, "currency") || currency);
    const code = textOf(row, "code");
    rows.push({
      id: textOf(row, "id") || `promo-${code}`,
      date: textOf(row, "createdAt"),
      description: code ? `Promo code ${code}` : "Promo code",
      kind: "promo",
      amount: -Math.abs(numOf(row, "amount")),
      currency: cur,
      creditSource: "PROMO",
    });
  });
  rows.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  return rows;
};

const referralLine = (row: any, currency: string) => {
  const status = textOf(row, "status").toUpperCase();
  const credited = numOf(row, "credited");
  const reward = numOf(row, "reward");
  const cur = textOf(row, "currency") || currency;
  if (status === "REWARDED") {
    return credited > 0
      ? `${money(credited, cur)} added to your bonus credit`
      : "Your friend received their bonus";
  }
  if (status === "PENDING") return "Transfer is on its way";
  if (status === "EXPIRED") return "They didn't send the minimum in time";
  if (status === "REVERSED") return "The qualifying transfer was refunded";
  if (status === "NOT_ELIGIBLE") return "This referral didn't meet the programme terms";
  const joined = when(textOf(row, "joinedOn"));
  if (status === "REGISTERED") {
    return joined
      ? `Joined on ${joined}${reward > 0 ? `. You get ${money(reward, cur)} when it completes` : ""}`
      : "Joined";
  }
  return REFERRAL_STATUS[status] || "Joined";
};

const RewardsPage = () => {
  const router = useRouter();
  const [kinds, setKinds] = useState<RewardKind[]>(fallbackKinds);
  const [code, setCode] = useState("");
  const [offer, setOffer] = useState("");
  const [currencyOffers, setCurrencyOffers] = useState<CurrencyOffer[]>([]);
  const [selectedOfferIndex, setSelectedOfferIndex] = useState(0);
  const [balancesByCur, setBalancesByCur] = useState<Record<string, any>>({});
  const [available, setAvailable] = useState(0);
  const [earned, setEarned] = useState(0);
  const [used, setUsed] = useState(0);
  const [expired, setExpired] = useState(0);
  const [usedTransfers, setUsedTransfers] = useState<number | null>(null);
  const [bonusCount, setBonusCount] = useState(0);
  const [currency, setCurrency] = useState("GBP");
  const [bySource, setBySource] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [unused, setUnused] = useState<any[]>([]);
  const [promos, setPromos] = useState<any[]>([]);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [joined, setJoined] = useState(0);
  const [referralsEarned, setReferralsEarned] = useState(0);
  const [referralsTotal, setReferralsTotal] = useState(0);
  const [debt, setDebt] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [topCapReached, setTopCapReached] = useState(false);
  const [unavailable, setUnavailable] = useState("");
  const [loading, setLoading] = useState(true);
  const [historyFilter, setHistoryFilter] = useState<"all" | HistoryKind>("all");
  const [promoDraftInput, setPromoDraftInput] = useState("");

  const tab = String(
    (Array.isArray(router.query.tab) ? router.query.tab[0] : router.query.tab) ||
      "overview",
  );
  const source = String(
    (Array.isArray(router.query.source)
      ? router.query.source[0]
      : router.query.source) || "ALL",
  ).toUpperCase();

  const setQuery = (next: { tab?: string; source?: string }) => {
    const query = { ...router.query } as Record<string, string | string[] | undefined>;
    const nextTab = next.tab ?? tab;
    const nextSource = (next.source ?? source).toUpperCase();
    if (!nextTab || nextTab === "overview") delete query.tab;
    else query.tab = nextTab;
    if (!nextSource || nextSource === "ALL") delete query.source;
    else query.source = nextSource;
    void router.replace({ pathname: router.pathname, query }, undefined, {
      shallow: true,
    });
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const body = await api.get("Account/Rewards");
        const data = apiData(body) || body;
        if (cancelled || !data) return;
        const rows = apiField(data, "kinds");
        if (Array.isArray(rows) && rows.length) {
          setKinds(
            rows.map((row: any) => ({
              kind: textOf(row, "kind"),
              title:
                textOf(row, "kind").toUpperCase() === "REFERRAL"
                  ? "Refer & Earn"
                  : textOf(row, "title"),
              summary: textOf(row, "summary"),
              enabled: flagOn(row, "enabled", true),
            })),
          );
        }
        const sources = listOf(data, "bySource");
        const cur = textOf(data, "balanceCurrency").toUpperCase() || "GBP";
        const defaultCode = textOf(data, "referralCode").toUpperCase();
        const defaultOffer = textOf(data, "offerText");
        const defaultCap = flagOn(data, "capReached", false);
        const parsedOffers = parseCurrencyOffers(
          data,
          defaultCode,
          defaultOffer,
          cur,
          defaultCap,
        );

        const rawBalances = listOf(data, "balances");
        const balanceMap: Record<string, any> = {};
        rawBalances.forEach((b: any) => {
          const bCur = currencyCode(textOf(b, "currency"));
          if (bCur) balanceMap[bCur] = b;
        });

        const sum = (name: string) =>
          sources.reduce((total, row) => total + numOf(row, name), 0);
        setCode(defaultCode);
        setOffer(defaultOffer);
        setTopCapReached(defaultCap);
        setCurrencyOffers(parsedOffers);
        setSelectedOfferIndex(0);
        setBalancesByCur(balanceMap);
        setCurrency(cur);
        setAvailable(
          apiField(data, "availableBalance") == null
            ? sum("available")
            : numOf(data, "availableBalance"),
        );
        setEarned(apiField(data, "earned") == null ? sum("earned") : numOf(data, "earned"));
        setUsed(apiField(data, "used") == null ? sum("used") : numOf(data, "used"));
        setExpired(
          apiField(data, "expired") == null ? sum("expired") : numOf(data, "expired"),
        );
        setUsedTransfers(
          apiField(data, "usedTransferCount") == null
            ? null
            : numOf(data, "usedTransferCount"),
        );
        setBonusCount(
          numOf(data, "referralCreditCount") + numOf(data, "otherCreditCount"),
        );
        setBySource(sources);
        setHistory(listOf(data, "history"));
        setUnused(listOf(data, "unused"));
        setPromos(listOf(data, "promoSavings"));
        setReferrals(listOf(data, "referrals"));
        setJoined(numOf(data, "referralsJoined"));
        setReferralsEarned(numOf(data, "referralsEarned"));
        setReferralsTotal(numOf(data, "referralsTotal"));
        setDebt(numOf(data, "outstandingDebt"));
        setBlocked(flagOn(data, "bonusBlocked", false));
        setUnavailable(
          flagOn(data, "unavailable", false)
            ? textOf(data, "unavailableMessage") ||
                "Rewards are unavailable right now. Please try again shortly."
            : "",
        );
      } catch {
        if (!cancelled) {
          setUnavailable("We couldn't load your rewards. Please try again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeOffer = currencyOffers[selectedOfferIndex] || null;
  const activeCode = activeOffer?.referralCode || code;
  const activeOfferText = activeOffer?.offerText || offer;
  const capReached = Boolean(activeOffer?.capReached ?? topCapReached);

  // Dynamic origin share link so Staging (`rhemito-web-nextjs-dev.herokuapp.com`)
  // and Live (`www.rhemito.com`) generate their exact own `/ref/<CODE>` URLs automatically.
  const shareLink = useMemo(() => {
    if (typeof window === "undefined" || !activeCode) return "";
    const base = `${window.location.origin}/ref/${encodeURIComponent(activeCode)}`;
    const params = new URLSearchParams();
    if (activeOffer?.receiveCurrency && currencyOffers.length > 1) {
      params.set("to", activeOffer.receiveCurrency);
    }
    if (activeOffer?.ruleId && currencyOffers.length > 1) {
      params.set("rule", String(activeOffer.ruleId));
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }, [activeCode, activeOffer, currencyOffers.length]);

  const handleOfferChange = (nextIdx: number) => {
    setSelectedOfferIndex(nextIdx);
    const chosen = currencyOffers[nextIdx];
    if (chosen?.currency && balancesByCur[chosen.currency]) {
      const b = balancesByCur[chosen.currency];
      setCurrency(chosen.currency);
      setAvailable(numOf(b, "available", available));
      setEarned(numOf(b, "earned", earned));
      setUsed(numOf(b, "used", used));
      setExpired(numOf(b, "expired", expired));
    }
  };

  const activity = useMemo(
    () => buildHistory(history, unused, promos, currency),
    [history, unused, promos, currency],
  );

  const earnedSources = useMemo(
    () =>
      bySource.filter((row) => {
        const rowCur = currencyCode(textOf(row, "currency") || currency);
        return (!currency || rowCur === currencyCode(currency)) && numOf(row, "earned") > 0;
      }),
    [bySource, currency],
  );
  const earnedTotal = earnedSources.reduce((sum, row) => sum + numOf(row, "earned"), 0);
  const promoSaved = promos.reduce(
    (sum, row) =>
      sum +
      (currencyCode(textOf(row, "currency") || currency) === currencyCode(currency)
        ? Math.abs(numOf(row, "amount"))
        : 0),
    0,
  );
  const bonusTotal =
    bonusCount || activity.filter((row) => row.kind === "earned").length;
  const visibleHistory = useMemo(() => {
    const sourced =
      source === "ALL" || historyFilter === "promo"
        ? activity
        : activity.filter((row) => row.creditSource === source);
    return historyFilter === "all"
      ? sourced
      : sourced.filter((row) => row.kind === historyFilter);
  }, [activity, source, historyFilter]);

  const unusedRows = useMemo(
    () =>
      unused.filter((row) => {
        const cur = (textOf(row, "currency") || currency).toUpperCase();
        if (currency && cur !== currency.toUpperCase()) return false;
        return source === "ALL" || sourceKey(row) === source;
      }),
    [unused, currency, source],
  );

  const offers = kinds.filter((kind) => kind.enabled);
  const referralEnabled = offers.some((k) => k.kind.toUpperCase() === "REFERRAL");
  const showSourceFilter = earnedSources.length > 1 || (source !== "ALL" && source !== "PROMO");

  const copy = async () => {
    if (capReached) {
      toastrMsg(
        "Reward limit reached",
        "You've earned the maximum referral bonus for this offer.",
      );
      return;
    }
    if (!shareLink) {
      toastrMsg(
        "No referral offer right now",
        "There is no Refer & Earn offer for your currency at the moment.",
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(shareLink);
      toastrMsg(
        "Referral link copied!",
        "Share it with friends to earn bonus credit.",
      );
    } catch {
      toastrMsg("Alert", "We couldn't copy the link. Please copy it manually.");
    }
  };

  const shareInvite = async () => {
    if (capReached || !shareLink) {
      await copy();
      return;
    }
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: "Join me on Rhemito",
          text: activeOfferText || "Sign up to Rhemito with my invite link!",
          url: shareLink,
        });
        return;
      } catch {
        // User cancelled native share sheet or browser rejected; fall back to copy
      }
    }
    await copy();
  };

  const handleApplyPromoDraft = () => {
    const trimmed = promoDraftInput.trim().toUpperCase();
    if (!trimmed) return;
    const saved = savePromoDraft({ code: trimmed, currency });
    if (!saved) {
      toastrMsg("Invalid code", "Enter a valid promo code using letters and numbers.");
      return;
    }
    toastrMsg(
      "Promo code saved for checkout",
      `${saved.code} will be prefilled on the payment step.`,
    );
    void router.push("/transactions/sendmoney");
  };

  const openHistory = (nextSource: string) => {
    setHistoryFilter("all");
    setQuery({ tab: "history", source: nextSource });
  };

  return (
    <Box w="100%">
      <Flex
        justify="space-between"
        align={{ base: "flex-start", sm: "center" }}
        direction={{ base: "column", sm: "row" }}
        gap="12px"
        mb="16px"
      >
        <Box>
          <PageTitle mb="4px">Reward$</PageTitle>
          <Text color="gray.600" fontSize="15px">
            Track your rewards, referrals and savings.
          </Text>
        </Box>

        {currencyOffers.length > 1 && (
          <Flex align="center" gap="8px" data-testid="rewards-offer-switcher">
            <Text fontSize="sm" fontWeight="600" color="gray.600" whiteSpace="nowrap">
              Offer currency
            </Text>
            <Select
              aria-label="Offer currency"
              value={selectedOfferIndex}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                handleOfferChange(Number(event.target.value))
              }
              h="38px"
              borderRadius="10px"
              fontSize="sm"
              bg="#fff"
              minW="150px"
            >
              {currencyOffers.map((item, idx) => {
                const label = item.receiveCurrency
                  ? `${item.currency} → ${item.receiveCurrency}`
                  : item.currency;
                return (
                  <option key={`${label}-${item.ruleId ?? idx}`} value={idx}>
                    {label}
                  </option>
                );
              })}
            </Select>
          </Flex>
        )}
      </Flex>

      <Flex
        role="tablist"
        bg="gray.200"
        p="4px"
        borderRadius="12px"
        maxW="28rem"
        gap="4px"
      >
        {TABS.map((item) => {
          const selected = tab === item.id;
          return (
            <Button
              key={item.id}
              role="tab"
              aria-selected={selected}
              flex="1"
              h="40px"
              borderRadius="9px"
              fontSize="sm"
              fontWeight="600"
              bg={selected ? "#fff" : "transparent"}
              color="gray.800"
              boxShadow={selected ? "sm" : "none"}
              _hover={{ bg: selected ? "#fff" : "blackAlpha.50" }}
              onClick={() => setQuery({ tab: item.id })}
            >
              {item.label}
            </Button>
          );
        })}
      </Flex>

      {loading ? (
        <SimpleGrid columns={{ base: 2, md: 4 }} gap="12px" mt="24px">
          {[0, 1, 2, 3].map((item) => (
            <Box key={item} {...card} h="112px" bg="gray.50" />
          ))}
        </SimpleGrid>
      ) : unavailable && activity.length === 0 ? (
        <Box {...card} mt="24px" textAlign="center">
          <Text color="gray.700">{unavailable}</Text>
          <Button
            mt="16px"
            h="44px"
            borderRadius="12px"
            bg="var(--clr1)"
            color="#fff"
            _hover={{ opacity: 0.9 }}
            onClick={() => router.reload()}
          >
            Retry
          </Button>
        </Box>
      ) : (
        <Box mt="24px">
          {tab === "history" && (
            <HistoryTab
              rows={visibleHistory}
              allCount={activity.length}
              filter={historyFilter}
              onFilter={setHistoryFilter}
              showSource={showSourceFilter}
              source={source}
              onSource={(value) => setQuery({ source: value })}
            />
          )}
          {tab === "referrals" && (
            <ReferralsTab
              rows={referrals}
              joined={joined}
              earnedCount={referralsEarned}
              total={referralsTotal}
              currency={currency}
              shareLink={shareLink}
              code={activeCode}
              capReached={capReached}
              onCopy={copy}
              onShare={shareInvite}
              onHistory={() => openHistory("REFERRAL")}
            />
          )}
          {tab !== "history" && tab !== "referrals" && (
            <Flex direction="column" gap="20px">
              {blocked && (
                <Box {...card} borderColor="orange.200" bg="orange.50">
                  <Text>
                    You&apos;re not qualified to get bonus. Please contact support
                    for more information.
                  </Text>
                </Box>
              )}
              <SimpleGrid columns={{ base: 2, md: 4 }} gap="12px">
                <Box {...card}>
                  <Text fontSize="13px" color="gray.500">
                    Available
                  </Text>
                  <Text fontSize="22px" fontWeight="800" color="#0f766e" lineHeight="1.2">
                    {money(available, currency)}
                  </Text>
                  <Text fontSize="xs" color="gray.500" mb="8px">
                    Ready for your next transfer
                  </Text>
                  {available > 0 ? (
                    <Button
                      h="44px"
                      w="100%"
                      borderRadius="12px"
                      bg="var(--clr1)"
                      color="#fff"
                      fontSize="sm"
                      _hover={{ opacity: 0.9 }}
                      onClick={() => router.push("/transactions/sendmoney")}
                    >
                      Send money
                    </Button>
                  ) : capReached ? (
                    <Badge
                      colorScheme="orange"
                      px="10px"
                      py="6px"
                      borderRadius="full"
                      fontSize="xs"
                      textTransform="none"
                      data-testid="cap-reached-badge"
                    >
                      Referral reward limit reached
                    </Badge>
                  ) : (
                    <Button
                      h="44px"
                      w="100%"
                      borderRadius="12px"
                      variant="outline"
                      borderColor="gray.300"
                      fontSize="sm"
                      onClick={copy}
                    >
                      Refer a friend
                    </Button>
                  )}
                </Box>
                <Stat
                  label="Bonus earned"
                  value={money(earned, currency)}
                  sub={`From ${bonusTotal} bonus${bonusTotal === 1 ? "" : "es"}`}
                />
                <Stat
                  label="Bonus used"
                  value={money(used, currency)}
                  sub={
                    usedTransfers == null
                      ? used > 0
                        ? "Across your transfers"
                        : "Across 0 transfers"
                      : `Across ${usedTransfers} transfer${usedTransfers === 1 ? "" : "s"}`
                  }
                />
                <Stat
                  label="Bonus expired"
                  value={money(expired, currency)}
                  sub="Use your bonus before it expires"
                />
              </SimpleGrid>

              <Text fontSize="sm" color="gray.700">
                You&apos;ve saved{" "}
                <Text as="span" fontWeight="700">
                  {money(used + promoSaved, currency)}
                </Text>{" "}
                in total with bonuses and promo codes.
              </Text>

              {debt > 0 && (
                <Text fontSize="sm" color="gray.600">
                  {money(debt, currency)} of future bonus will go towards bonus that
                  was removed after a cancelled or refunded transfer.
                </Text>
              )}

              {/* Refer & Earn Share Card on Overview */}
              {!blocked && referralEnabled && activeCode && (
                <Box {...card} data-testid="refer-earn-share-card">
                  <Flex
                    justify="space-between"
                    align={{ base: "flex-start", md: "center" }}
                    direction={{ base: "column", md: "row" }}
                    gap="14px"
                  >
                    <Box flex="1">
                      <Text fontWeight="700" fontSize="16px">
                        Refer &amp; Earn
                      </Text>
                      <Text fontSize="sm" color="gray.600" mt="2px">
                        {activeOfferText ||
                          "Share your personal invite link with friends to earn bonus credit."}
                      </Text>
                      {!capReached && shareLink && (
                        <Text
                          fontSize="xs"
                          fontFamily="mono"
                          color="gray.500"
                          mt="6px"
                          wordBreak="break-all"
                        >
                          {shareLink}
                        </Text>
                      )}
                    </Box>

                    {capReached ? (
                      <Badge
                        colorScheme="orange"
                        px="12px"
                        py="6px"
                        borderRadius="full"
                        fontSize="xs"
                        textTransform="none"
                        data-testid="overview-cap-reached-badge"
                      >
                        Reward limit reached for this offer
                      </Badge>
                    ) : (
                      <Flex gap="8px" flexShrink={0} flexWrap="wrap">
                        <Button
                          h="42px"
                          borderRadius="12px"
                          bg="var(--clr1)"
                          color="#fff"
                          fontSize="sm"
                          _hover={{ opacity: 0.9 }}
                          onClick={copy}
                        >
                          Copy referral link
                        </Button>
                        <Button
                          h="42px"
                          borderRadius="12px"
                          variant="outline"
                          borderColor="var(--clr1)"
                          color="var(--clr1)"
                          fontSize="sm"
                          onClick={shareInvite}
                        >
                          Share
                        </Button>
                      </Flex>
                    )}
                  </Flex>
                </Box>
              )}

              {earnedSources.length > 0 && (
                <Box {...card} py="12px">
                  <Text fontWeight="700" fontSize="15px" mb="4px">
                    How you earned it
                  </Text>
                  {earnedSources.length === 1 ? (
                    <Text fontSize="sm" color="gray.600">
                      All earned from{" "}
                      {textOf(earnedSources[0], "label") ||
                        sourceLabel(sourceKey(earnedSources[0]))}
                      .
                    </Text>
                  ) : (
                    earnedSources.map((row, index) => {
                      const label = textOf(row, "label") || sourceLabel(sourceKey(row));
                      const rowEarned = numOf(row, "earned");
                      const left = numOf(row, "available");
                      const share =
                        earnedTotal > 0 ? Math.min(100, (rowEarned / earnedTotal) * 100) : 0;
                      const key = sourceKey(row);
                      return (
                        <Box
                          key={key || label}
                          py="12px"
                          borderTop={index === 0 ? "none" : "1px solid"}
                          borderColor="gray.100"
                        >
                          <Flex justify="space-between" align="center" mb="4px">
                            <Text fontSize="15px" fontWeight="600">
                              {label}
                            </Text>
                            <Button
                              variant="link"
                              color="var(--clr1)"
                              fontSize="sm"
                              fontWeight="600"
                              onClick={() => openHistory(key)}
                            >
                              View
                            </Button>
                          </Flex>
                          <Text fontSize="13px" color="gray.500" mb="6px">
                            Earned {money(rowEarned, textOf(row, "currency") || currency)} ·{" "}
                            {money(left, textOf(row, "currency") || currency)} left
                          </Text>
                          <Progress
                            value={share}
                            size="xs"
                            borderRadius="full"
                            bg="gray.100"
                            sx={{ "& > div": { background: "var(--clr1)" } }}
                          />
                        </Box>
                      );
                    })
                  )}
                </Box>
              )}

              {source !== "ALL" && (
                <Flex
                  justify="space-between"
                  align="center"
                  bg="gray.100"
                  borderRadius="12px"
                  px="14px"
                  py="8px"
                  fontSize="sm"
                >
                  <Text>Showing {sourceLabel(source)} only</Text>
                  <Button
                    variant="link"
                    color="var(--clr1)"
                    fontWeight="600"
                    onClick={() => setQuery({ source: "ALL" })}
                  >
                    Show all
                  </Button>
                </Flex>
              )}

              <Box {...card} py="4px">
                <Text fontWeight="700" fontSize="15px" mt="12px" mb="4px">
                  Unused bonus
                </Text>
                {unusedRows.length === 0 ? (
                  <Text fontSize="sm" color="gray.600" pb="12px">
                    {source === "ALL"
                      ? "No unused bonus. Invite friends to earn bonus credit."
                      : `No unused bonus from ${sourceLabel(source).toLowerCase()}.`}
                  </Text>
                ) : (
                  unusedRows.map((row, index) => {
                    const amount = numOf(row, "amount");
                    const left = numOf(row, "remaining", amount);
                    const cur = textOf(row, "currency") || currency;
                    const expiresRaw = textOf(row, "expiresAt");
                    const expires = when(expiresRaw);
                    const daysLeft = expiringWithin14Days(expiresRaw);
                    const earnedOn = when(textOf(row, "createdAt"));
                    const creditFloor = numOf(row, "floor", 0);
                    const creditReceiveCur = currencyCode(textOf(row, "receiveCurrency"));
                    return (
                      <Flex
                        key={textOf(row, "id") || index}
                        py="12px"
                        gap="12px"
                        align="center"
                        borderTop={index === 0 ? "none" : "1px solid"}
                        borderColor="gray.100"
                      >
                        <Box flex="1">
                          <Flex gap="8px" align="center" flexWrap="wrap">
                            <Text fontSize="15px" fontWeight="600">
                              {textOf(row, "label") || sourceLabel(sourceKey(row))}
                            </Text>
                            <SourceBadge source={sourceKey(row)} />
                            {daysLeft !== null && (
                              <Text
                                as="span"
                                fontSize="xs"
                                fontWeight="700"
                                bg="orange.100"
                                color="orange.800"
                                borderRadius="full"
                                px="8px"
                                py="2px"
                                data-testid="expiring-soon-pill"
                              >
                                {expiryPillText(daysLeft)}
                              </Text>
                            )}
                          </Flex>
                          {left + 0.001 < amount && (
                            <Text fontSize="13px" color="gray.500">
                              {money(left, cur)} left of {money(amount, cur)}
                            </Text>
                          )}
                          {(creditFloor > 0 || creditReceiveCur) && (
                            <Text fontSize="12px" color="gray.600" mt="2px">
                              {creditFloor > 0
                                ? `Min. transfer ${money(creditFloor, cur)}`
                                : ""}
                              {creditFloor > 0 && creditReceiveCur ? " · " : ""}
                              {creditReceiveCur ? `${creditReceiveCur} transfers only` : ""}
                            </Text>
                          )}
                          <Text fontSize="13px" color="gray.500">
                            {earnedOn ? `Earned ${earnedOn}` : "Earned"}
                            {expires ? ` · expires ${expires}` : ""}
                          </Text>
                        </Box>
                        <Text fontWeight="700">{money(left, cur)}</Text>
                      </Flex>
                    );
                  })
                )}
              </Box>

              {!blocked && offers.length > 0 && (
                <Box>
                  <Text fontWeight="700" fontSize="15px">
                    Ways to earn
                  </Text>
                  <Text fontSize="13px" color="gray.500" mb="12px">
                    Live offers you can earn bonus credit from.
                  </Text>
                  <SimpleGrid columns={{ base: 1, md: 2 }} gap="12px">
                    {offers.map((kind) => {
                      const isPromoCard = kind.kind.toUpperCase() === "PROMO";
                      const isReferralCard = kind.kind.toUpperCase() === "REFERRAL";
                      return (
                        <Box key={kind.kind} {...card}>
                          <Text fontSize="15px" fontWeight="600">
                            {kind.title}
                          </Text>
                          <Text fontSize="sm" color="gray.600" mt="4px">
                            {isReferralCard && activeOfferText
                              ? activeOfferText
                              : kind.summary}
                          </Text>
                          {isPromoCard && (
                            <Flex gap="8px" mt="12px" wrap="wrap">
                              <Input
                                size="sm"
                                h="38px"
                                maxW="180px"
                                borderRadius="10px"
                                fontFamily="mono"
                                placeholder="Have a promo code?"
                                value={promoDraftInput}
                                maxLength={20}
                                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                  setPromoDraftInput(e.target.value.toUpperCase())
                                }
                                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    handleApplyPromoDraft();
                                  }
                                }}
                              />
                              <Button
                                size="sm"
                                h="38px"
                                borderRadius="10px"
                                variant="outline"
                                borderColor="var(--clr1)"
                                color="var(--clr1)"
                                isDisabled={!promoDraftInput.trim()}
                                onClick={handleApplyPromoDraft}
                              >
                                Use on transfer
                              </Button>
                            </Flex>
                          )}
                        </Box>
                      );
                    })}
                  </SimpleGrid>
                </Box>
              )}
            </Flex>
          )}
        </Box>
      )}
    </Box>
  );
};

const Stat = ({ label, value, sub }: { label: string; value: string; sub: string }) => (
  <Box {...card}>
    <Text fontSize="13px" color="gray.500">
      {label}
    </Text>
    <Text fontSize="22px" fontWeight="800" lineHeight="1.2">
      {value}
    </Text>
    <Text fontSize="xs" color="gray.500">
      {sub}
    </Text>
  </Box>
);

const SourceBadge = ({ source }: { source: string }) => {
  if (!source || source === "PROMO") return null;
  return (
    <Text
      as="span"
      fontSize="xs"
      fontWeight="700"
      bg="gray.100"
      color="gray.700"
      borderRadius="full"
      px="8px"
      py="2px"
    >
      {sourceLabel(source)}
    </Text>
  );
};

const statusStyle = (status: string) => {
  if (status === "UNUSED" || status === "REWARDED") return { bg: "teal.100", color: "teal.800" };
  if (status === "PARTLY_USED") return { bg: "orange.100", color: "orange.800" };
  if (status === "PENDING") return { bg: "blue.100", color: "blue.800" };
  if (status === "REVERSED") return { bg: "red.50", color: "red.700" };
  return { bg: "gray.100", color: "gray.700" };
};

const KindMark = ({ kind }: { kind: HistoryKind }) => {
  const mark =
    kind === "promo"
      ? { bg: "blue.50", color: "blue.700", label: "%" }
      : kind === "earned"
        ? { bg: "teal.50", color: "teal.700", label: "+" }
        : kind === "used"
          ? { bg: "orange.50", color: "orange.700", label: "−" }
          : { bg: "gray.100", color: "gray.600", label: "×" };
  return (
    <Flex
      w="36px"
      h="36px"
      borderRadius="full"
      bg={mark.bg}
      color={mark.color}
      align="center"
      justify="center"
      fontWeight="700"
      fontSize="14px"
      flexShrink={0}
      aria-hidden
    >
      {mark.label}
    </Flex>
  );
};

/**
 * 3-step referral progress stepper (`1. Friend signed up` → `2. Sends qualifying transfer` → `3. Bonus credited`).
 */
const ReferralProgressStepper = ({ status }: { status: string }) => {
  const upper = status.toUpperCase();
  if (upper !== "REGISTERED" && upper !== "PENDING" && upper !== "REWARDED") {
    return null;
  }

  // Step completion:
  // REGISTERED -> Step 0 done, Step 1 active, Step 2 upcoming
  // PENDING    -> Step 0 done, Step 1 in-progress (active), Step 2 upcoming
  // REWARDED   -> Steps 0, 1, 2 all done
  const completedCount = upper === "REWARDED" ? 3 : 1;
  const activeStep = upper === "REWARDED" ? -1 : 1;

  return (
    <Flex
      mt="12px"
      pt="12px"
      borderTop="1px solid"
      borderColor="gray.100"
      gap="8px"
      direction={{ base: "column", sm: "row" }}
      align={{ base: "flex-start", sm: "center" }}
      justify="space-between"
      data-testid="referral-progress-stepper"
    >
      {REFERRAL_STEPS.map((label, idx) => {
        const isDone = idx < completedCount;
        const isCurrent = idx === activeStep;
        return (
          <Flex key={label} align="center" gap="8px" flex="1">
            <Flex
              w="22px"
              h="22px"
              borderRadius="full"
              align="center"
              justify="center"
              fontSize="11px"
              fontWeight="700"
              flexShrink={0}
              bg={isDone ? "teal.600" : isCurrent ? "blue.600" : "gray.200"}
              color={isDone || isCurrent ? "#fff" : "gray.600"}
            >
              {isDone ? "✓" : idx + 1}
            </Flex>
            <Text
              fontSize="xs"
              fontWeight={isDone || isCurrent ? "700" : "500"}
              color={isDone ? "teal.800" : isCurrent ? "blue.800" : "gray.500"}
            >
              {idx + 1}. {label}
            </Text>
          </Flex>
        );
      })}
    </Flex>
  );
};

const HistoryTab = ({
  rows,
  allCount,
  filter,
  onFilter,
  showSource,
  source,
  onSource,
}: {
  rows: HistoryRow[];
  allCount: number;
  filter: "all" | HistoryKind;
  onFilter: (value: "all" | HistoryKind) => void;
  showSource: boolean;
  source: string;
  onSource: (value: string) => void;
}) => (
  <Flex direction="column" gap="16px">
    <Flex role="group" aria-label="Filter history" gap="8px" flexWrap="wrap">
      {HISTORY_FILTERS.map((item) => {
        const selected = filter === item.id;
        return (
          <Button
            key={item.id}
            h="36px"
            borderRadius="full"
            px="14px"
            fontSize="sm"
            fontWeight="600"
            bg={selected ? "gray.900" : "#fff"}
            color={selected ? "#fff" : "gray.700"}
            border="1px solid"
            borderColor={selected ? "gray.900" : "gray.300"}
            _hover={{ bg: selected ? "gray.800" : "gray.50" }}
            aria-pressed={selected}
            onClick={() => onFilter(item.id)}
          >
            {item.label}
          </Button>
        );
      })}
    </Flex>
    {showSource && filter !== "promo" && (
      <Flex align="center" gap="8px">
        <Text fontSize="sm" fontWeight="500" color="gray.600">
          Source
        </Text>
        <Select
          aria-label="Source"
          value={source}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            onSource(event.target.value)
          }
          maxW="180px"
          h="36px"
          borderRadius="full"
          fontSize="sm"
        >
          <option value="ALL">All sources</option>
          <option value="REFERRAL">Referrals</option>
          <option value="SCHEME">Bonus offers</option>
          <option value="MANUAL">From Rhemito</option>
        </Select>
      </Flex>
    )}
    <Box
      {...card}
      p="0"
      px="16px"
      borderRadius="16px"
      overflow="hidden"
      data-testid="bonus-history"
    >
      {rows.length === 0 ? (
        <Text py="24px" textAlign="center" fontSize="sm" color="gray.600">
          {allCount === 0
            ? "No rewards yet. Invite friends or use a promo code to start saving."
            : filter === "used"
              ? "You haven't used any bonus credit yet. You can use it when you pay for a transfer."
              : "Nothing to show for this filter."}
        </Text>
      ) : (
        <>
          <Flex
            display={{ base: "none", md: "flex" }}
            py="12px"
            gap="12px"
            align="center"
            borderBottom="1px solid"
            borderColor="gray.100"
          >
            <Box w="36px" flexShrink={0} />
            <Text
              flex="1"
              minW="0"
              fontSize="12px"
              fontWeight="700"
              color="gray.500"
              textTransform="uppercase"
            >
              Description
            </Text>
            <Text
              minW="110px"
              fontSize="12px"
              fontWeight="700"
              color="gray.500"
              textTransform="uppercase"
              textAlign="right"
            >
              Date
            </Text>
            <Text
              minW="96px"
              fontSize="12px"
              fontWeight="700"
              color="gray.500"
              textTransform="uppercase"
              textAlign="right"
            >
              Amount
            </Text>
          </Flex>
          {rows.map((row, index) => (
            <Flex
              key={row.id}
              py="14px"
              gap="12px"
              align="center"
              borderTop={index === 0 ? "none" : "1px solid"}
              borderColor="gray.100"
            >
              <KindMark kind={row.kind} />
              <Box flex="1" minW="0">
                <Flex gap="8px" align="center" flexWrap="wrap">
                  <Text fontSize="15px" fontWeight="600" noOfLines={1}>
                    {row.description}
                  </Text>
                  <SourceBadge source={row.creditSource} />
                </Flex>
                <Text display={{ base: "block", md: "none" }} fontSize="13px" color="gray.500" mt="2px">
                  {when(row.date)}
                </Text>
              </Box>
              <Text
                display={{ base: "none", md: "block" }}
                minW="110px"
                fontSize="13px"
                color="gray.500"
                whiteSpace="nowrap"
                textAlign="right"
              >
                {when(row.date)}
              </Text>
              <Flex
                direction="column"
                align="flex-end"
                gap="4px"
                flexShrink={0}
                minW="96px"
              >
                <Text
                  fontSize="15px"
                  fontWeight="700"
                  whiteSpace="nowrap"
                  color={row.amount >= 0 ? "#0f766e" : "gray.800"}
                >
                  {row.amount >= 0 ? "+" : ""}
                  {money(row.amount, row.currency)}
                </Text>
                {row.returned ? (
                  <Text
                    fontSize="xs"
                    fontWeight="700"
                    bg="teal.100"
                    color="teal.800"
                    borderRadius="full"
                    px="8px"
                  >
                    Returned
                  </Text>
                ) : row.status ? (
                  <Text
                    fontSize="xs"
                    fontWeight="700"
                    borderRadius="full"
                    px="8px"
                    {...statusStyle(row.status)}
                  >
                    {CREDIT_STATUS[row.status] || row.status}
                  </Text>
                ) : null}
              </Flex>
            </Flex>
          ))}
        </>
      )}
    </Box>
  </Flex>
);

const ReferralsTab = ({
  rows,
  joined,
  earnedCount,
  total,
  currency,
  shareLink,
  code,
  capReached,
  onCopy,
  onShare,
  onHistory,
}: {
  rows: any[];
  joined: number;
  earnedCount: number;
  total: number;
  currency: string;
  shareLink: string;
  code: string;
  capReached: boolean;
  onCopy: () => void;
  onShare: () => void;
  onHistory: () => void;
}) => {
  if (rows.length === 0) {
    return (
      <Box {...card} textAlign="center" py="24px">
        <Text fontSize="15px" color="gray.700">
          No referrals yet. Share your link to start earning.
        </Text>
        {code ? (
          <Text fontSize="sm" color="gray.500" mt="8px">
            Your code {code}
          </Text>
        ) : null}
        {capReached ? (
          <Box mt="14px">
            <Badge
              colorScheme="orange"
              px="12px"
              py="6px"
              borderRadius="full"
              fontSize="xs"
              textTransform="none"
              data-testid="referrals-cap-reached-badge"
            >
              Reward limit reached — you&apos;ve earned the maximum referral bonus for this offer
            </Badge>
          </Box>
        ) : (
          <>
            {shareLink ? (
              <Text fontSize="sm" wordBreak="break-all" mt="8px" mb="16px">
                {shareLink}
              </Text>
            ) : (
              <Box mb="16px" />
            )}
            <Flex justify="center" gap="8px" flexWrap="wrap">
              <Button
                h="44px"
                borderRadius="12px"
                bg="var(--clr1)"
                color="#fff"
                _hover={{ opacity: 0.9 }}
                onClick={onCopy}
              >
                Copy referral link
              </Button>
              <Button
                h="44px"
                borderRadius="12px"
                variant="outline"
                borderColor="var(--clr1)"
                color="var(--clr1)"
                onClick={onShare}
              >
                Share
              </Button>
            </Flex>
          </>
        )}
      </Box>
    );
  }

  return (
    <Flex direction="column" gap="14px">
      <Text fontSize="sm" color="gray.700">
        Joined: {joined || rows.length} · Earned: {earnedCount} · Total earned:{" "}
        {money(total, currency)}
      </Text>
      <Button
        variant="link"
        alignSelf="flex-start"
        color="var(--clr1)"
        fontWeight="600"
        onClick={onHistory}
      >
        View referral bonus in your history
      </Button>
      {capReached ? (
        <Badge
          alignSelf="flex-start"
          colorScheme="orange"
          px="12px"
          py="6px"
          borderRadius="full"
          fontSize="xs"
          textTransform="none"
          data-testid="referrals-cap-reached-badge"
        >
          Reward limit reached — you&apos;ve earned the maximum referral bonus for this offer
        </Badge>
      ) : shareLink ? (
        <Flex gap="8px" flexWrap="wrap">
          <Button
            h="44px"
            borderRadius="12px"
            bg="var(--clr1)"
            color="#fff"
            _hover={{ opacity: 0.9 }}
            onClick={onCopy}
          >
            Copy referral link
          </Button>
          <Button
            h="44px"
            borderRadius="12px"
            variant="outline"
            borderColor="var(--clr1)"
            color="var(--clr1)"
            onClick={onShare}
          >
            Share
          </Button>
        </Flex>
      ) : null}
      {rows.map((row, idx) => {
        const status = textOf(row, "status").toUpperCase() || "REGISTERED";
        return (
          <Box key={textOf(row, "id") || `${status}-${idx}`} {...card}>
            <Flex justify="space-between" align="center" mb="8px">
              <Text fontWeight="700">{textOf(row, "friend") || "Friend"}</Text>
              <Text
                fontSize="xs"
                fontWeight="700"
                borderRadius="full"
                px="10px"
                py="2px"
                {...statusStyle(status)}
              >
                {REFERRAL_STATUS[status] || status}
              </Text>
            </Flex>
            <Text fontSize="sm" color="gray.600">
              {referralLine(row, currency)}
            </Text>
            <ReferralProgressStepper status={status} />
          </Box>
        );
      })}
    </Flex>
  );
};

export default RewardsPage;

RewardsPage.getLayout = function getLayout(page: ReactElement) {
  return <PrivateRoute>{page}</PrivateRoute>;
};
