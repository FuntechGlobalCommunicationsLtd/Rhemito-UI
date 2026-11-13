# Master Developer Handoff Plan: Staging (`staging_next_js` + `furp02-core` `Staging`) → Live Production

This runbook provides the exact, step-by-step instructions to deploy and verify the **Refer & Earn, Bonus Credit Wallet, and Promo Code Customer-Choice** release on **Staging** first, followed by a **zero-code-edit promotion** to **Live Production**.

---

## Architecture & Environment Topology

| Layer | Staging Branch | Azure Pipeline | Staging Public URL | Live Branch | Live Azure Pipeline(s) | Live Public URL |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Customer Web (`Rhemito-web`)** | `staging_next_js` | Heroku Dev (`NEXT_PUBLIC__ENV=dev`) | `https://rhemito-web-nextjs-dev.herokuapp.com/` | `prod_main` | **Pipeline 95** (`NEXT_PUBLIC__ENV=prod`) | `https://www.rhemito.com/` |
| **Core API (`furp02-core`)** | `Staging` | **Pipeline 33** | `https://furp02-staging.funtechcom.com/api/v1/` | `pri_prod` | **Pipelines 99 + 49** (ship together) | `https://furp02-pre-pord.funtechcom.com/api/v1/` |
| **Admin Hub (`mito-admin`)** | `staging` | **Pipeline 74** | Staging MITO Admin | `prod` | **Pipeline 65** (`mito-admin`) | `https://admin.mito.money/` |
| **Web Widget (`mito-money-web-widget`)** | `staging` | **Pipeline 81** | `https://trust.mito.money/` | `prod-dynamic-subdomain` & `prod_main` | **Pipelines 80 & 89** | Vanity hosts & `https://widget.mito.money/` |
| **Hosted Checkout (`MitoHostedModel`)** | `Uat` | **Pipeline 106** | `mito-checkout` (**Preview only**) | `main` | **Pipeline 106** (**LOCKED**) | `mito-link` (`https://link.mito.money/`) |

---

## Step 1 — Copy `staging-handoff/rhemito-web-nextjs/` into `Rhemito-web` (`staging_next_js`)

All drop-in files under `Rhemito-UI/staging-handoff/rhemito-web-nextjs/` are mapped **1-to-1** to the directory layout of `Rhemito-web` (Next.js 15.5 Pages Router + Chakra UI 2.5).

### 1.1 Copy Drop-In Files Directly

From the `Rhemito-UI` repository root, copy the following files into your local `Rhemito-web` (`staging_next_js` branch) working tree:

| Source (`Rhemito-UI/staging-handoff/rhemito-web-nextjs/`) | Destination (`Rhemito-web/` on `staging_next_js`) | Purpose |
| :--- | :--- | :--- |
| `utils/apiResult.ts` | `utils/apiResult.ts` | Envelope helpers (`apiData`, `apiField`, `apiSucceeded`, `apiMessage`) — missing on `staging_next_js`. |
| `utils/referralStore.ts` | `utils/referralStore.ts` | 30-day browser attribution store (`saveReferral`, `readReferral`, `readReferralForUser`, `bindReferralEmail`, `clearReferral`, `getOrCreateVisitorId` + `prod_main` aliases). |
| `utils/promoCodeDraft.ts` | `utils/promoCodeDraft.ts` | 24h promo code draft handoff (`savePromoDraft`, `readPromoDraft`, `clearPromoDraft` + `prod_main` aliases). |
| `utils/rewardsGate.ts` | `utils/rewardsGate.ts` | Evaluates `enabled` & `kinds` flags (`REFERRAL`, `PROMO`, `BONUS_SCHEME`) from `Account/Rewards`. |
| `pages/ref/[code].tsx` | `pages/ref/[code].tsx` | Public referral landing page: validates code, guards signed-in users, calls `Account/Rewards/Visit`, and branches Desktop / Android / iOS. |
| `pages/refer/[code].tsx` | `pages/refer/[code].tsx` | Public alias route re-exporting `pages/ref/[code].tsx`. |
| `pages/rewards/index.tsx` | `pages/rewards/index.tsx` | Upgraded `Reward$` hub: multi-currency offer switcher, dynamic `${window.location.origin}/ref/${code}`, `capReached` hide/badge (`AC-2.1.6`), 14-day expiry warning pill, and 3-step referral progress stepper. |
| `components/transactions/payment-methods/RewardAtPayment.tsx` | `components/transactions/payment-methods/RewardAtPayment.tsx` | Upgraded checkout widget: `REDUCE_SEND` vs `INCREASE_RECEIVE` Chakra `RadioGroup`, post-promo bonus cap (`postPromoPayable - minPayableFloor`), partial bonus input, floor/corridor warnings, 400ms debounce, and `locked` submit freeze. |
| `patches/middleware.ts` | `middleware.ts` | Skips `www.` redirect on `localhost` and `*.herokuapp.com` (fixes Heroku SSL error), preserves `?ref=`/`?to=`/`?rule=` query strings on all redirects, and marks `/rewards` `Cache-Control: no-store, private` while keeping `/ref/` & `/refer/` public. |
| `patches/clientConfig.staging-example.ts` | `clientConfig.ts` | Points `dev` (`NEXT_PUBLIC__ENV=dev`) to `https://furp02-staging.funtechcom.com/api/v1/` and Sandbox Checkout.com while keeping `prod` (`NEXT_PUBLIC__ENV=prod`) pointed at Live. |

```powershell
# PowerShell copy helper (set $RhemitoWeb to your local Rhemito-web checkout on branch `staging_next_js`)
$Handoff = "c:\Users\Khan1\OneDrive\Desktop\drive_d_data\Rhemito-UI\staging-handoff\rhemito-web-nextjs"
$RhemitoWeb = "C:\path\to\Rhemito-web"

Copy-Item "$Handoff\utils\*" "$RhemitoWeb\utils\" -Force
New-Item -ItemType Directory -Force -Path "$RhemitoWeb\pages\ref", "$RhemitoWeb\pages\refer", "$RhemitoWeb\pages\rewards" | Out-Null
Copy-Item "$Handoff\pages\ref\[code].tsx" "$RhemitoWeb\pages\ref\[code].tsx" -Force
Copy-Item "$Handoff\pages\refer\[code].tsx" "$RhemitoWeb\pages\refer\[code].tsx" -Force
Copy-Item "$Handoff\pages\rewards\index.tsx" "$RhemitoWeb\pages\rewards\index.tsx" -Force
New-Item -ItemType Directory -Force -Path "$RhemitoWeb\components\transactions\payment-methods" | Out-Null
Copy-Item "$Handoff\components\transactions\payment-methods\RewardAtPayment.tsx" "$RhemitoWeb\components\transactions\payment-methods\RewardAtPayment.tsx" -Force
Copy-Item "$Handoff\patches\middleware.ts" "$RhemitoWeb\middleware.ts" -Force
Copy-Item "$Handoff\patches\clientConfig.staging-example.ts" "$RhemitoWeb\clientConfig.ts" -Force
```

---

### 1.2 Apply the 4 Surgical Wiring Snippets in `Rhemito-web`

#### Wiring Snippet 1 — `components/auth/sign-up/PrimarySignUp.tsx` (Capture `?ref=` & Bind Email + Offer Banner)
Note: In `Rhemito-web`, if `!userEmail` on `/signup`, `PrimarySignUp.tsx` routes to `/login` so the customer enters their email first. Because `/ref/[code]` saves the attribution record in `localStorage` (`rewards.referral`, 30-day TTL) **before** redirecting, the stored referral survives `/login` → `/signup` → email activation! Adding the `useEffect` below also handles direct visits to `/signup?ref=CODE` and binds the submitted email on registration:

```tsx
// 1. Add imports at top of `components/auth/sign-up/PrimarySignUp.tsx`:
import {
  bindReferralEmail,
  readReferral,
  saveReferral,
} from "@/utils/referralStore";

// 2. Inside `PrimarySignUp`, read `?ref=`, `?to=`, `?rule=` if user landed directly on `/signup?ref=...`:
const storedReferral = typeof window !== "undefined" ? readReferral() : null;

useEffect(() => {
  if (!router.isReady) return;
  const qRef = Array.isArray(router.query.ref) ? router.query.ref[0] : router.query.ref;
  const qTo = Array.isArray(router.query.to) ? router.query.to[0] : router.query.to;
  const qRule = Array.isArray(router.query.rule) ? router.query.rule[0] : router.query.rule;
  if (qRef) {
    saveReferral({
      code: String(qRef),
      receiveCurrency: qTo ? String(qTo) : undefined,
      ruleId: qRule ? Number(qRule) : undefined,
    });
  }
}, [router.isReady, router.query.ref, router.query.to, router.query.rule]);

// 3. Inside `onSubmit` (right before `individualSignup` / `companySignUp`), bind the registered email:
bindReferralEmail(values.email || userEmail);

// 4. Optional UI banner above the Formik heading when `storedReferral?.offer?.headline` is present:
{storedReferral?.code && (
  <Box
    maxW="500px"
    w="100%"
    mx="auto"
    mt="12px"
    p="12px 16px"
    bg="teal.50"
    border="1px solid"
    borderColor="teal.200"
    borderRadius="12px"
  >
    <Text fontSize="14px" fontWeight="700" color="teal.900">
      {storedReferral.offer?.headline || `Referral code ${storedReferral.code} applied`}
    </Text>
    {storedReferral.offer?.summary && (
      <Text fontSize="13px" color="teal.800" mt="2px">
        {storedReferral.offer.summary}
      </Text>
    )}
  </Box>
)}
```

#### Wiring Snippet 2 — `pages/overview/index.tsx` (Post-Login `POST Account/Rewards/Link`)
Once the newly registered customer activates their email and lands on `/overview` for the first time, link their account to the stored referral attribution (`code`, `trackingId`, `visitorId`, `receiveCurrency`, `ruleId`):

```tsx
// 1. Add imports at top of `pages/overview/index.tsx`:
import api from "@/utils/apiClient";
import {
  clearReferral,
  getOrCreateVisitorId,
  readReferralForUser,
} from "@/utils/referralStore";

// 2. Inside `Overview` component (where `userData` from Redux is available):
useEffect(() => {
  const signedInEmail = userData?.email || userData?.userName || null;
  if (!userData?.uid && !signedInEmail) return;

  const pending = readReferralForUser(signedInEmail);
  if (!pending?.code) return;

  let cancelled = false;
  api
    .post("Account/Rewards/Link", {
      data: {
        code: pending.code,
        trackingId: pending.trackingId || undefined,
        visitorId: pending.visitorId || getOrCreateVisitorId(),
        receiveCurrency: pending.receiveCurrency || undefined,
        ruleId: pending.ruleId || undefined,
        attributionMethod: pending.trackingId ? "LINK" : "MANUAL_CODE",
      },
    })
    .then(() => {
      if (!cancelled) clearReferral();
    })
    .catch((err: any) => {
      // Clear non-retryable business rejections (already linked, self-referral, existing transfers);
      // keep record only on transient 5xx/network outage so next load retries automatically.
      const status = Number(err?.status || err?.code || 0);
      if (!cancelled && status >= 400 && status < 500) {
        clearReferral();
      }
    });

  return () => {
    cancelled = true;
  };
}, [userData?.uid, userData?.email]);
```

#### Wiring Snippet 3 — `components/transactions/payment-methods/PaymentMethods.tsx` & `PaymentMethodSummary.tsx`
Wire `promoApply`, `receiveBoostSendCurrency`, `exchangeRate`, and `locked={loading}` into `PaymentMethods.tsx`:

```tsx
// 1. Update `rewardChoice` ref & `rewardUi` state in `PaymentMethods.tsx`:
const rewardChoice = useRef({
  promoCode: "",
  promoDiscount: 0,
  promoApply: "REDUCE_SEND" as "REDUCE_SEND" | "INCREASE_RECEIVE",
  receiveBoostSendCurrency: 0,
  bonusAmount: 0,
  blocked: false,
});
const [rewardUi, setRewardUi] = useState({
  promoCode: "",
  promoDiscount: 0,
  promoApply: "REDUCE_SEND" as "REDUCE_SEND" | "INCREASE_RECEIVE",
  receiveBoostSendCurrency: 0,
  bonusAmount: 0,
});

// 2. In `sendPayment` payload (around line 221 of `PaymentMethods.tsx`), add `promoApply`:
promoCode: rewardChoice.current.promoCode || undefined,
promoApply: rewardChoice.current.promoCode
  ? rewardChoice.current.promoApply
  : undefined,
bonusAmount: rewardChoice.current.bonusAmount || undefined,

// 3. In `<RewardAtPayment ... />` (around line 771 of `PaymentMethods.tsx`):
<RewardAtPayment
  amount={Number(validateRateValue?.sendAmount || 0)}
  fee={Number(validateRateValue?.commission || 0)}
  currency={validateRateValue?.fromCurrency}
  receiveCurrency={validateRateValue?.toCurrency}
  exchangeRate={Number(validateRateValue?.rate || 0)}
  paymentMethod={value == null ? undefined : String(value)}
  locked={loading}
  onChange={(choice) => {
    rewardChoice.current = choice;
    setRewardUi({
      promoCode: choice.promoCode || "",
      promoDiscount: Number(choice.promoDiscount) || 0,
      promoApply: choice.promoApply || "REDUCE_SEND",
      receiveBoostSendCurrency: Number(choice.receiveBoostSendCurrency) || 0,
      bonusAmount: Number(choice.bonusAmount) || 0,
    });
  }}
/>

// 4. Pass `promoApply` & `receiveBoostSendCurrency` to `<PaymentMethodSummary />` (around line 887):
<PaymentMethodSummary
  amountSent={amountSent}
  promoCode={rewardUi.promoCode}
  promoDiscount={rewardUi.promoDiscount}
  promoApply={rewardUi.promoApply}
  receiveBoostSendCurrency={rewardUi.receiveBoostSendCurrency}
  bonusAmount={rewardUi.bonusAmount}
/>

// 5. Inside `PaymentMethodSummary.tsx`, render the green payout boost row when `promoApply === "INCREASE_RECEIVE"`:
{promoApply === "INCREASE_RECEIVE" && receiveBoostSendCurrency > 0 && (
  <Flex justify="space-between" align="center" py="6px">
    <Text fontSize="14px" color="green.700" fontWeight="600">
      Promo payout boost ({promoCode})
    </Text>
    <Text fontSize="14px" color="green.700" fontWeight="700">
      +{(receiveBoostSendCurrency * Number(validateRateValue?.rate || 1)).toFixed(2)}{" "}
      {validateRateValue?.toCurrency}
    </Text>
  </Flex>
)}
```

#### Wiring Snippet 4 — Authenticated Sidebar Navigation (`components/layout/Sidebar.tsx`)
Ensure `Reward$` is visible in the signed-in customer sidebar on `staging_next_js` (matching `prod_main`):

```tsx
// Add to the authenticated navigation items array in `components/layout/Sidebar.tsx`:
{
  label: "Reward$",
  href: "/rewards",
  // Reuse gift/star icon from existing icon set (e.g. FiGift from "react-icons/fi")
}
```

---

## Step 2 — Pair with `PromoCode/staging-handoff/furp02-core/` on `furp02-core` (`Staging` Pipeline 33)

Deploy the backend Staging drop-in package before (or alongside) `Rhemito-web` `staging_next_js` so `https://furp02-staging.funtechcom.com/api/v1/` exposes the upgraded Rewards contract:

1. **Apply Staging SQL Migration (Idempotent):**
   - Run `PromoCode/staging-handoff/furp02-core/Database/Migrations/UpgradeRewardEngineStagingSync.sql` against the `furp02-staging` SQL Server database (creates `dbo.RewardReferralVisit` and adds `[Floor] DECIMAL(18,2) NULL` + `ReceiveCurrency CHAR(3) NULL` to `dbo.RewardCreditLedger`; `RewardReferralService` and `RewardWalletService` also self-heal these objects idempotently on first call).
2. **Copy `PromoCode/staging-handoff/furp02-core/` C# Drop-Ins & Apply Wiring Patches on `furp02-core` (`Staging` branch):**
   - Follow `PromoCode/staging-handoff/DEVELOPER-BACKEND-STAGING-GUIDE.md` and `PromoCode/staging-handoff/furp02-core/Furp.Application/Features/Rewards/PATCHES-AND-WIRING.md`:
     - `Furp.Application/Features/Rewards/Engine/RewardReferralService.cs` — `VisitAsync` (`dbo.RewardReferralVisit`, 24h visitor+code dedupe, `TRK-XXXXXXXX`), `ResolveTrackingAsync`, `HandoffAsync`, multi-currency `currency_offers`/`offers`, real `cap_reached` (`COUNT`/`AMOUNT`/scheme), `REFERRER_INACTIVE` guard, qualification window expiry, and referee welcome credit `[Floor]`/`ReceiveCurrency`.
     - `Furp.Application/Features/Rewards/Engine/RewardWalletService.cs` — Single-batch atomic T-SQL `sp_getapplock` wallet debit (`ApplyAtomicSql`), soonest-expiry-first ordering, `BELOW_FLOOR` / `WRONG_CORRIDOR` / `WALLET_BUSY` error codes, and `floor` + `receive_currency` fields on wallet JSON rows.
     - `Furp.Application/Features/Rewards/RewardCheckout.cs` — `MinPayableAmount` guard (`REWARD_MIN_PAYABLE_AMOUNT`), post-promo bonus cap, `transfer_amount` + `receive_currency` forwarding on wallet `/apply`, and `affiliate_id` + `site_key` forwarding on `/promocodes/redeem`.
     - Apply the surgical controller/command/handler patches in `PATCHES-AND-WIRING.md` (`RewardCustomerCommands.cs`, `AccountController.cs`, `TransactionRequestHandler.CreateTransaction.cs`, `RewardSchema.cs`, `LocalRewardEngine.cs`, `RewardPromoService.cs`). Note: `pages/ref/[code].tsx` gracefully handles both legacy `Result<bool>` and upgraded `Result<VisitDto>` from `Account/Rewards/Visit` (falling back to `buildGooglePlayReferralUrl(null, code)` when `trackingId` is absent).
3. **Verify `furp02-staging` App Settings / Environment Variables:**
   - Ensure `REWARD_MIN_PAYABLE_AMOUNT=1.00` is set if gateway rails require a £1.00 floor on `furp02-staging`.
   - Verify CORS on `furp02-staging.funtechcom.com` allows `https://rhemito-web-nextjs-dev.herokuapp.com`.
4. **Trigger Azure DevOps Pipeline 33 (`furp02-staging.funtechcom.com` on branch `Staging`):**
   - Confirm `GET https://furp02-staging.funtechcom.com/api/v1/Account/Rewards/Code/<TEST_CODE>` (with `ApiKey` header) returns HTTP 200 `{ succeeded: true, data: { valid: true, ... } }`.
5. **Verify Heroku `rhemito-web-nextjs-dev` Config Vars:**
   - Confirm `NEXT_PUBLIC__ENV=dev` is set on Heroku app `rhemito-web-nextjs-dev` so `clientConfig.ts` selects `https://furp02-staging.funtechcom.com/api/v1/` and Sandbox Checkout.com.

---

## Step 3 — End-to-End Staging QA Checklist (`https://rhemito-web-nextjs-dev.herokuapp.com/`)

Run through every check below on Staging before approving Live promotion:

- [ ] **Middleware & SSL Sanity:**
  - Opening `https://rhemito-web-nextjs-dev.herokuapp.com/ref/TESTCODE?to=NGN` loads directly over valid HTTPS **without** redirecting to `www.rhemito-web-nextjs-dev.herokuapp.com` and preserves `?to=NGN`.
  - Inspecting response headers on `/rewards` shows `Cache-Control: no-store, no-cache, must-revalidate, private`, while `/ref/TESTCODE` loads publicly in an incognito window without redirecting to `/login`.
- [ ] **Referral Landing (`/ref/[code]` & `/refer/[code]`):**
  - **Desktop (`?platform=desktop`):** Validates code via `GET Account/Rewards/Code/{code}`, fires `POST Account/Rewards/Visit`, stores `{ code, trackingId, visitorId, offer }` in `localStorage["rewards.referral"]`, and redirects cleanly to `/signup?ref={code}`.
  - **Android (`?platform=android`):** Displays branded Rhemito invite card + **"Get it on Google Play"** button (`referrer=tracking_id%3D...`) + **"Continue on Web"**.
  - **iOS (`?platform=ios`):** Displays branded Rhemito invite card + one-tap **"Copy referral code"** button (copies code + toast) + **"Download on the App Store"** + **"Continue on Web"**.
  - **Signed-In Guard:** Visiting `/ref/{code}` while logged into an existing Rhemito session clears `rewards.referral`, displays `"Referral links are for new customers only"`, and links to `/rewards`.
  - **Invalid / Inactive Code:** Visiting `/ref/INVALID999` shows a friendly error card with `"Continue to sign up without a referral"`.
- [ ] **Registration Email Binding → Post-Activation `/overview` Link:**
  - Complete new-customer signup from `/ref/{code}` → verify `localStorage["rewards.referral"].intendedEmail` matches registered email → activate account → land on `/overview` → verify `POST Account/Rewards/Link` fires once and `rewards.referral` is cleared.
  - Verify referee welcome bonus (when rule is `BOTH` or `REFEREE_ONLY`) appears in `/rewards` under `Unused bonus` with its `Min. transfer` floor and corridor label.
- [ ] **`Reward$` Hub (`/rewards`):**
  - Verify dynamic share URL starts with `https://rhemito-web-nextjs-dev.herokuapp.com/ref/...`.
  - When multiple send-currency rules exist, switch **Offer currency** dropdown and verify offer headline, referral code/link, and wallet currency update cleanly.
  - Verify `capReached === true` hides Copy/Share buttons and renders the `"Reward limit reached"` badge (`AC-2.1.6`).
  - Verify unused credits expiring within `<= 14` days show the orange `Expires in N days` / `Expires tomorrow` / `Expires today` warning pill.
  - In **My referrals**, verify `REGISTERED`, `PENDING`, and `REWARDED` rows render the 3-step progress stepper (`1. Friend signed up` → `2. Sends qualifying transfer` → `3. Bonus credited`).
  - Enter a promo code in the `Ways to earn` Promo card → click **Use on transfer** → confirm it navigates to `/transactions/sendmoney` with the promo prefilled on the payment step.
- [ ] **Checkout `RewardAtPayment` (`/transactions/sendmoney` Payment Step):**
  - **Customer Choice (`VALUE` Promo):** Apply a `VALUE`-basis promo code → verify the Chakra `RadioGroup` renders **Pay less** (`REDUCE_SEND`) vs **Add to recipient payout** (`INCREASE_RECEIVE`). Toggle between them:
    - `REDUCE_SEND`: Customer payable decreases by discount; recipient payout stays unchanged.
    - `INCREASE_RECEIVE`: Customer payable stays unchanged (`promoDiscount = 0`); summary shows green `+Promo payout boost` in recipient currency.
  - **Post-Promo Bonus Cap & Partial Bonus Input:** With both promo and bonus credit active on a card rail (`CARDCHECKOUT`), verify max bonus is capped at `Math.max(0, postPromoPayable - 1.00)` (never £0.00 card charge, never over-debiting wallet!). Test entering a custom partial bonus amount (e.g., `2.50`) and clicking `Use max`.
  - **Floor & Corridor Warnings:** With a welcome credit that has `floor = 50` or `receiveCurrency = "NGN"`, test a £30 transfer or a `GHS` transfer → verify the credit is held back from `maxBonusToApply` and the orange eligibility warning explains why.
  - **400ms Debounce & Submit Lock (`PROMO-07` / `P-20`):** Change payment method or transfer amount and confirm `Promo/Validate` re-runs once after 400ms; click Continue/Pay (`locked={true}`) and confirm inputs/radios freeze with zero mid-submit re-validation calls.

---

## Step 4 — Zero-Edit Promotion Checklist to Live Production

Because `clientConfig.ts` uses `NEXT_PUBLIC__ENV` (`dev` on Staging vs `prod` on Live), `/rewards` derives referral links from `window.location.origin`, and `middleware.ts` enforces `www.rhemito.com` + HTTPS automatically on non-Heroku hosts, **zero code edits are required when promoting from Staging to Live**.

### Promotion Sequence (Execute in Exact Order)

1. **Database & Core API (`furp02-core` → `pri_prod`):**
   - Run `PromoCode/staging-handoff/furp02-core/Database/Migrations/UpgradeRewardEngineStagingSync.sql` against the Live SQL Server database (additive `dbo.RewardReferralVisit` table + nullable `[Floor]` and `ReceiveCurrency` columns — zero table locks/downtime).
   - Merge validated `Staging` changes into **`pri_prod`**.
   - Run **Azure Pipelines 99 AND 49 together** (`furp02-pre-pord.funtechcom.com-New-Server` + legacy companion on `pri_prod`) so both live FURP surfaces stay 100% in sync.
   - Smoke-check `GET https://furp02-pre-pord.funtechcom.com/api/v1/Account/Rewards/Code/<LIVE_CODE>`.
2. **Admin Hub (`mito-admin` → `prod`, if Admin rule UI changes are included):**
   - Merge `staging` → **`prod`** and deploy via **Azure Pipeline 65** (Heroku `mito-admin` → `https://admin.mito.money/`).
3. **Customer Web (`Rhemito-web` → `prod_main`):**
   - Confirm Heroku production app has `NEXT_PUBLIC__ENV=prod`.
   - Merge `staging_next_js` changes into **`prod_main`** and deploy via **Azure Pipeline 95** (`https://www.rhemito.com/`).
   - Smoke-check `https://www.rhemito.com/ref/<LIVE_CODE>` (verifies `www.` + query preservation) and `/rewards` (verifies share URL starts with `https://www.rhemito.com/ref/...`).
4. **Affiliate Web Widgets (`mito-money-web-widget`, when promoting widget parity):**
   - Merge widget changes to **`prod-dynamic-subdomain`** (**Pipeline 80**) and **`prod_main`** (**Pipeline 89** → `https://widget.mito.money/`).
5. **Hosted Checkout (`MitoHostedModel` — HARD LOCKED PIPELINE 106):**
   - **MANDATORY SAFETY LOCK:**
     - **First:** Deploy & verify on branch **`Uat`** → **Pipeline 106** → Heroku **`mito-checkout`** (preview only).
     - **NEVER** point `Uat` at `mito-link` or override `herokuAppName` on a non-`main` branch.
     - **Then:** Merge to **`main`** → **Pipeline 106** → Heroku **`mito-link`** (`https://link.mito.money/`), and verify `Last-Modified` / `ETag` headers on `https://link.mito.money/` confirm the new bundle is live.
