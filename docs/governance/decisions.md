# Governance Decisions Register (`decisions.md`)

> **Standard:** Universal AI Agent Governance Standard (v1.0) — §03, §08, §09  
> **Repository:** `Rhemito-UI` & `PromoCode` (Mito Money Admin / Referral & Bonus Engine)

---

## Active Approved Decisions

### `DEC-2026-11-16-REFEREE-SIGNUP-BONUS` — Referee Instant Sign-Up Bonus & First-Transaction Redemption

- **Date Approved:** 16 November 2026 (`2026-11-16`)
- **Decision Owner / Approver:** Mohammad Mumtaz (Product Owner)
- **Status:** `Human-Approved` (Active Baseline)
- **Affected Repositories & Modules:**
  - `PromoCode` (`server/referral.js`, `server/bonus/wallet.js`, `server/tests/contracts/referral.contract.test.js`, `Docs/Requirements/*.md`)
  - `Rhemito-UI` (`client/src/components/rewards/ReferralSignup.tsx`, `client/src/lib/rewards.ts`, `client/src/pages/Dashboard.tsx`, `client/src/pages/ReferralLanding.tsx`, `client/src/components/rewards/ReferEarnCard.tsx`, `client/src/components/rewards/ExistingUserReferralCard.tsx`, `server/referralOpenGraph.ts`, `docs/requirements/*.md`)

#### 1. Business Decision Summary
1. **Instant Referee Welcome Credit on Sign-Up (`REGISTERED`):**
   - A referee who registers via a referral link or referral code receives their welcome bonus credit (`referee_reward`) **immediately upon signing up** (`status = 'REGISTERED'`) when the matched rule rewards the referee (`reward_type === 'BOTH'` or `'REFEREE'`, `referee_reward > 0`) and the referee is not blocked by `eligibilityGuard`.
   - Referee welcome credit issuance is **no longer gated on `referee.kyc_status === 'PASSED'`** at registration or rule-upgrade backfill (`createReferral`, `updateRule`, `tryAward`), because bonus credit is non-withdrawable and Rhemito enforces mandatory KYC verification before any Send Money transfer can be paid.
   - Referrer reward (`referrer_reward`) continues to be issued **only when the referee's first qualifying transfer reaches `COMPLETED`** AND continues to require the referrer to have passed KYC (`status_reason = 'Awaiting referrer KYC'` when `referrer.kyc_status !== 'PASSED'`).
2. **Redemption on First Valid Qualifying Transaction:**
   - The referee can redeem their welcome bonus credit (`Pay less` or `Send more`) on their **first valid transaction** that meets the referral rule's **Floor** (`min_transaction_threshold`, `BELOW_FLOOR`) and **Corridor** (`receive_currency`, `WRONG_CORRIDOR`) within the qualification/validity window.
   - Redeeming the referee bonus on that first qualifying transaction still reports the full pre-discount `sendAmount` (`amount >= floor`) to `POST /api/referral/transfer-events`, transitioning the referral `REGISTERED → PENDING → REWARDED` and crediting the referrer (`referrer_reward`) without double-crediting the referee (`!refereeCreditId` / idempotent `<referralId>:referee`).
   - If the first transaction is `CANCELLED` or `FAILED`, `releaseBonus` restores the referee's welcome bonus credit and `handleTransferEvent` returns the referral to `REGISTERED`.
   - If a completed qualifying transfer where the referee redeemed their sign-up bonus is subsequently `REFUNDED` (`REFERRAL_REVERSAL`), `voidCredit` and `releaseBonus` ensure any returned `BONUS_RETURNED` child credit is voided and subtracted from `spent` so both `BONUS_CLAWBACK=on` and `BONUS_CLAWBACK=off` (in either event arrival order) leave `available = 0` and `outstanding_debt = 0`.
3. **UI Copy & Layout (Direction A + Dashboard Option 1):**
   - **Direction A (Referral Signup, Landing, Share, Refer & Earn, OpenGraph):**
     - `ReferralInviteStrip` headline: `<Name> invited you – get <referee_reward> bonus credit on joining via link.`
     - `ReferralInviteStrip` 3-step bar (`BOTH`): `1. Join` → `2. Send <floor>+[ to <RCV>] in <QW> days` → `3. <Name> gets <referrer_reward>` (and `1. Join` → `2. Get <referee_reward> on sign-up` → `3. Send <floor>+...` for `REFEREE`-only).
     - `ReferralInviteStrip` 3rd bullet: `<referee_reward> welcome bonus credit added automatically when you sign up using the link`.
     - `ReferralCodeField` applied hook (`referral-code-hook`): `You get <referee_reward> on sign-up (<Name> gets <referrer_reward> on your first successful transaction)`.
     - `referralHelpText("REGISTERED")`: `Waiting for their first successful transfer of <floor> or more · <n> day(s) left`.
   - **Dashboard Option 1 (`Dashboard.tsx` `rewards-section-bonus-banners`):**
     - Responsive `xl:flex-row` outer layout + `whitespace-nowrap` on `referral-bonus-earned-pill` so `Welcome bonus · Invited by <Name>` always renders on a single line without wrapping.

#### 2. Alternatives Evaluated
| Option | Summary | Outcome |
| :--- | :--- | :--- |
| **Direction A (Selected)** | Preserves `Join` · `Send <floor>+ to <RCV> in <QW> days` · `<Name> gets <referrer_reward>` matching Product Owner red-markup annotations and existing E2E step-2 pattern while stating instant sign-up credit in headline & bullet 3. | **Approved by Mohammad (2026-11-16)** |
| **Direction B** | Changes Step 1 to `Join & get £21.00` and Step 2 to `Redeem on £50.00+...`. | Rejected (denser mobile wrapping, diverges from red markup). |
| **Dashboard Option 1 (Selected)** | Keep `Welcome bonus · Invited by John Doe` in `referral-bonus-earned-pill` and prevent 2-line wrapping via `xl:flex-row` + `whitespace-nowrap`. | **Approved by Mohammad (2026-11-16)** |
| **Dashboard Option 2** | Move `Invited by John Doe` into the subtitle paragraph below the pill. | Rejected in favour of Option 1. |

#### 3. Superseded Baseline Rules (Preserved for Audit History — §09)
- `REF-MITO-v1.1` (08/10/2026) `D5` (*"Credit is issued only when the qualifying transfer reaches COMPLETED"*) → Superseded for referee credit (`REGISTERED`); retained for referrer credit (`COMPLETED`).
- `REF-MITO-v1.1` (08/10/2026) `D8` / `BR-34` (*"Both parties must have passed KYC before their credit is issued"* / `Awaiting referee KYC`) → Superseded for referee credit; retained for referrer credit (`Awaiting referrer KYC`).
- `REFERRAL-13` (`PromoCode/server/tests/contracts/referral.contract.test.js`) → Updated 2026-11-16 to assert immediate referee credit on sign-up with `kyc_status: 'PENDING'` and referrer hold on `Awaiting referrer KYC`.

---

### `DEC-2026-11-17-HIDE-WAYS-TO-EARN` — Hide `Ways to earn` Section on `Reward$` Overview
- **Date Approved:** 17 November 2026 (`2026-11-17`)
- **Decision Owner / Approver:** Mohammad Mumtaz (Product Owner)
- **Status:** `Human-Approved` (`Option 1 — Hide completely`)
- **Affected Files (`Rhemito-UI`):** `client/src/pages/BonusAndDiscounts.tsx`, `docs/requirements/BONUS_MODULE_SPEC_RHEMITO.md` (plus `REF-23` / `bonus.spec.js` test sync after live URL confirmation)
- **Summary & Superseded Baseline:** `<WaysToEarn />` (`data-testid="ways-to-earn"`) is no longer rendered on `/bonus-discounts` (`Reward$` → `Overview`), superseding `BONUS_MODULE_SPEC_RHEMITO.md` §7.4 while keeping `WaysToEarn.tsx` and all backend bonus scheme awarding intact.

---

### `DEC-2026-11-17-STAGING-PAYMENT-GATEWAY` — Staging Payment Gateway Opening, Bonus/Promo Commission Alignment & Non-Silent Gateway Error Guard
- **Date Approved:** 17 November 2026 (`2026-11-17`)
- **Decision Owner / Approver:** Mohammad Mumtaz (Product Owner)
- **Status:** `Release Approved` (`Option 1 — Render Staging Rhemito-UI Fix Package` · `Verified`)
- **Affected Files (`Rhemito-UI`):** `shared/sendMoney.ts`, `server/mitoRetail/index.ts`, `server/sendMoneyRoutes.ts`, `client/src/pages/SendMoney.tsx`, `tests/e2e/staging_payment_gateway.spec.js`
- **Summary:**
  1. **Commission Alignment on Bonus & Promo Transfers:** Plain transfers (`!hasRewardOrPromo`) remain unchanged. When a Promo Code or Bonus Credit (`pay_less` or `send_more`) is applied, `sendAmountMinorForMito` reflects the payout boost (`send_more`) or net discount (`pay_less` / `fee` promo / `amount` promo, clamped `>= 100` minor units), while `commissionNum` is always aligned to `lockedRate.commission` (including on `sendMitoTransaction` retry) so `furp02-staging` (`POST /api/v1/Transaction/SendMoney`) never rejects the locked `rateId` for commission mismatch.
  2. **Newly Signed-Up Referee & `collectionMode` Beneficiary Resolution:** Step 3 (`POST /api/send-money/transactions`) persists optional recipient banking/mobile details, falls back `mitoUserId` to `DEFAULT_MITO_SENDER_USER_ID` when `registerOrSyncMitoRetailUser` returns `null`, and generates a deterministic per-user fallback phone suffix in `mapAuthUserToMitoCreatePayload` when mobile number is empty. Step 4 (`sendMitoForSendMoneyTx`) filters saved beneficiaries strictly by `collectionMode` (`BANKACCOUNT` vs `MOBILEMONEY`) and `receiveCurrency`, creates the Mito beneficiary on-demand if missing, and preserves `promoAtPayment` / `bonusCredit` (`mode` & `amount`) on `isMitoStep4Reclick`.
  3. **No Silent Fake Completion on Staging Gateway Failure:** `sendMitoTransaction` parses object or JSON-string `paymentSession` and reports `ok` / `httpStatus`. When `isMitoRetailConfigured()` is `true` and `paymentMethod` is `card` or `instant_bank`, `POST /api/send-money/transactions/:id/pay` requires a valid gateway target (`mitoPaymentSession` or `http(s)` `mitoPaymentUrl`/`mitoHostedUrl`); otherwise it releases any reserved promo/bonus (`PAY-04`), keeps `tx.status === "awaiting_payment"`, and returns `502 PAYMENT_GATEWAY_ERROR` so `SendMoney.tsx` shows the destructive `"Payment not completed"` toast (`PAY-13`) instead of faking `"Payment Successful"`.
  4. **Frontend Step 4 Fallbacks, Inline Pre-Submit Card Error & Step 1 KYC Fallback (`SendMoney.tsx`):** Supports hosted card URL & `mitoHostedUrl` fallbacks, keeps pre-ready Checkout.com SDK mount/init errors inline inside `mito-card-checkout-section` instead of unmounting the card form, uses the signed-in user's name for `cardholderName`, and triggers fallback `fetchMitoKycJourney` on Step 1 whenever `isTransactionAllowed === false || isKycRequired === true || isProfileUpdateRequired === true` with `!kycUrl`.

---

### `DEC-2026-11-17-RECENT-TRANSACTIONS-ALL-SORT` — Recent Transactions `'All'` Tab Latest-Transaction Sorting & Immediate Cache Refresh
- **Date Approved:** 17 November 2026 (`2026-11-17`)
- **Decision Owner / Approver:** Mohammad Mumtaz (Product Owner — defect fix on `fix/staging-payment-gateway`)
- **Status:** `Release Approved` (`Verified`)
- **Affected Files (`Rhemito-UI`):** `client/src/lib/unifiedTransactions.ts`, `client/src/pages/Dashboard.tsx`, `client/src/pages/Transactions.tsx`, `client/src/pages/SendMoney.tsx`, `client/src/__tests__/unified-transactions.test.ts`, `tests/e2e/staging_payment_gateway.spec.js`
- **Summary:**
  1. Added pure `sendMoneyDateSort(view, fallbackDateLabel)` helper in `unifiedTransactions.ts` computing full millisecond-precision sort timestamps (`Math.max(Date.parse(paidAt), Date.parse(createdAt))`) instead of parsing `toSendMoneyRow(view).date` (`"16 Nov 2026"`, midnight `00:00:00`), so newly completed Send Money transfers always appear at the top of `'All'` above earlier same-day Campaigns, Invoices, Money Requests, and earlier same-day Send Money transfers (preserving `toSendMoneyRow`'s contract return shape).
  2. Added deterministic `tx.id` tie-breaking in `Dashboard.tsx` and `Transactions.tsx` `mergedRows` sorting.
  3. Added `syncSendMoneyCache(txView?)` in `SendMoney.tsx` to optimistically upsert newly created/paid Send Money transactions into `["/api/send-money/transactions"]` and invalidate transaction/notification queries immediately on Step 3 creation, Step 4 payment/outcome, and manual bank transfer submission.

---

### `DEC-2026-11-17-CARD-3DS-AND-GATEWAY-CONFIRMATION` — Native Checkout.com 3DS Unblocking & Two-Phase Gateway Payment Confirmation
- **Date Approved:** 17 November 2026 (`2026-11-17`)
- **Decision Owner / Approver:** Mohammad Mumtaz (Product Owner — `Option A` approved on `fix/card-3ds-and-gateway-confirmation`)
- **Status:** `Release Approved` (`Option A — Native 3DS Unblock + Two-Phase Gateway Confirmation` · `Verified`)
- **Affected Files (`Rhemito-UI`):** `server/sendMoneyRoutes.ts`, `server/mitoRetail/index.ts`, `client/src/lib/sendMoney.ts`, `client/src/pages/SendMoney.tsx`, `client/src/__tests__/contracts/gateway-confirmation.test.ts`, `tests/e2e/staging_payment_gateway.spec.js`
- **Summary:**
  1. **Native Checkout.com 3DS Unblocking (`SendMoney.tsx`, `server/sendMoneyRoutes.ts`):** Stopped intercepting `checkout.com` / 3DS / non-terminal `data.status` `postMessage` events with `stopImmediatePropagation()` so `CheckoutWebComponents` completes 3DS2 authentication natively, authorizes/captures the Checkout.com Payment Session (`ps_...`), populates card AVS postcode in FURP, and triggers `furp02-staging` payment completion. `POST /api/send-money/mito/resolve-card-redirect` never fetches `checkout.com` interactive 3DS URLs and never defaults missing status to `"COMPSUCCESS"` (returning `status: null` instead).
  2. **Two-Phase Gateway Confirmation (`server/sendMoneyRoutes.ts`, `client/src/lib/sendMoney.ts`, `SendMoney.tsx`):** Preserves `shared/sendMoney.ts` `statusForPaymentMethod()` unchanged (`PAY-01..PAY-15` intact). When `isMitoRetailConfigured()` is `true` and `paymentMethod` is `card` or `instant_bank` with a live gateway session/URL, `POST /api/send-money/transactions/:id/pay` keeps `status: "awaiting_payment"` (`paidAt: null`, deferring `transaction_complete` and `PAID`/`COMPLETED` reward events) and skips duplicate `InitiateHostedTransaction` when `Transaction/SendMoney` succeeded. Added `POST /api/send-money/transactions/:id/confirm-gateway` (`confirmSendMoneyGateway`) + Mito webhook sync (`payment_collected`, `payment_captured`, `compsuccess`, `processed`) to idempotently complete paid sessions or release held Promo/Bonus and restore retryable `awaiting_payment` state on decline/cancel/method switch.

---

### `DEC-2026-11-17-CARD-PAYMENT-COMPLETION-SYNC` & `DEC-2026-11-17-ALL-PAYMENT-METHODS-DASHBOARD-REDIRECT` — Card 3DS Return-Origin Completion Sync & Post-Payment Dashboard Redirect Across All Payment Methods
- **Date Approved:** 17 November 2026 (`2026-11-17`)
- **Decision Owner / Approver:** Mohammad Mumtaz (Product Owner — Card defect fix + `Option A` approved on `fix/card-payment-status-sync`)
- **Status:** `Release Approved` (`Option A` · `Verified` — UI flow approved by Product Owner on `http://localhost:5000/send-money`, contract & Playwright E2E tests added)
- **Affected Files (`Rhemito-UI`):** `server/mitoRetail/index.ts`, `server/sendMoneyRoutes.ts`, `client/src/lib/sendMoney.ts`, `client/src/pages/SendMoney.tsx`, `client/src/__tests__/contracts/gateway-confirmation.test.ts`, `tests/e2e/staging_payment_gateway.spec.js`, `docs/governance/decisions.md`, `docs/governance/traceability.md`
- **Summary:**
  1. **Card `RedirectSuccessUrl` Origin Preservation (`${cleanOrigin}/send/status`) & 3DS Completion Sync:**
     - Verified live on `furp02-staging.funtechcom.com` (`tnxref=22505775`) that after Checkout.com 3DS2 capture, `furp02-staging` registers the payment (`status=COMPSUCCESS&paymentStatus=Captured`) and redirects the browser to `(RedirectSuccessUrl || "https://rhemito-web-nextjs-dev.herokuapp.com/send/status") + "?tnxref=<tnxref>&status=COMPSUCCESS&paymentStatus=Captured"`.
     - Updated `server/sendMoneyRoutes.ts` and `server/mitoRetail/index.ts` so `CARDCHECKOUT` sets `RedirectSuccessUrl` to the active caller's clean `/send/status` URL (`http://localhost:5000/send/status` locally, `https://rhemito-ui.onrender.com/send/status` on Render — never rewriting `localhost` to `onrender.com`, never omitting `RedirectSuccessUrl` to fall back to `rhemito-web-nextjs-dev.herokuapp.com`, and never pointing to `/send-money`).
     - Updated `SendMoney.tsx` (`/send/status` + nested-iframe `window.top.postMessage`) and `POST /api/send-money/mito/resolve-card-redirect` + `POST /api/send-money/transactions/:id/confirm-gateway` (`syncMitoCardPaymentStatus` in `server/mitoRetail/index.ts`) to also invoke Mito Staging's `[AllowAnonymous]` `GET /api/v1/Payment/CheckoutPaymentSatus?cko-session-id=<pay_...>` server-side (`redirect: "manual"`). Inspection of Azure DevOps `furp02-core` (`Staging` branch: `TransactionRequestHandler.cs` L522–576, `CheckoutWebhookHandler.cs` L144–154, `CheckoutRequestHandler.cs` L126–221) proved that Mito Staging stores `PaymentReference = ps_...` while Checkout.com webhooks send `data.id = pay_...` (so Mito's webhook never matches `isNewFlow: true` sessions), making `GET /api/v1/Payment/CheckoutPaymentSatus?cko-session-id=<pay_...>` (`ProcessOrder(result.Id)`) the sole handler that marks Mito Staging `PAID` / `AWAITINGPROCESSING` / `INREVIEW`. Calling it server-side captures the payment in Mito Staging while keeping the customer's browser on `Rhemito-UI`.
  2. **Post-Payment Dashboard Redirect Across All Payment Methods (`Option A`):**
     - **Credit/Debit Card, Instant Pay By Bank & Wallet:** Show the `Payment Successful` / `Payment Authorized` confirmation screen and auto-redirect to Dashboard (`/`) after the 6s countdown (`isPaidOrProcessing`), while keeping `failed` / `cancelled` / `expired` attempts on Step 4 (`redirectCountdown = null`) so the customer can retry immediately.
     - **Manual Bank Transfer:** Clicking **"I have made the Payment"** (`button-manual-transfer-made-payment`) dispatches the `"Payment confirmation received"` toast, syncs the transaction cache, and redirects directly to Dashboard (`/`).
     - *Superseded Behaviour:* Manual Bank Transfer previously stayed on the Bank Transfer Details screen swapping the button to `"Done — Go to Dashboard"` without redirecting automatically; failed/cancelled gateway status views previously started an 8s auto-redirect timer.

---

### `DEC-2026-11-17-PAY-BY-BANK-RETAIL-SETTLEMENT` — Affiliate Pay By Bank (`PLAID`) Settlement via `RetailTransaction` + `RetailCollection` + `MoveRetailToTransaction`
- **Date Approved:** 17 November 2026 (`2026-11-17`)
- **Decision Owner / Approver:** Mohammad Mumtaz (Product Owner — Pay By Bank Mito Staging capture fix verified & `approved` on `fix/card-payment-status-sync`)
- **Status:** `Release Approved` (`Verified` — live Mito Staging + Plaid Sandbox + Product Owner UI confirmation + contract & Playwright E2E suites passing)
- **Affected Files (`Rhemito-UI`):** `server/mitoRetail/index.ts`, `server/sendMoneyRoutes.ts`, `client/src/pages/SendMoney.tsx`, `client/src/__tests__/contracts/gateway-confirmation.test.ts`, `tests/e2e/staging_payment_gateway.spec.js`, `docs/governance/decisions.md`, `docs/governance/traceability.md`
- **Summary:**
  1. **Root Cause in `furp02-core` (`Staging` branch):**
     - `Rhemito-UI` authenticates with Mito Staging as Affiliate `1112` (`TestRhemitoAffiliate`). Calling `POST /api/v1/Transaction/SendMoney` (`paymentMethod: "PLAID"`) creates a `dbo.Transactions` row with `transaction.AffiliateId` populated (`TransactionRequestHandler.cs` L54 & `TransactionRequestHandler.CreateTransaction.cs` L190).
     - Although Plaid Sandbox settles the payment (`PAYMENT_STATUS_SETTLED` + `WALLET` `SETTLED`) and delivers `POST /api/v2/Payment/plaid-payment-status-webhook`, `PlaidPaymentStatusWebhookHandler` routes `PlaidPaymentSourceType.Transaction` to `CheckoutTransactionWebhookSettlementService.ApplyPaymentCapturedAsync` (`Furp.Application/Services/CheckoutTransactionWebhookSettlementService.cs` L170–173), which immediately returns (`if (transaction.AffiliateId.HasValue) return;`) without marking `PaymentStatus = PAID` or updating `TransactionStatus`.
  2. **Approved Technical Resolution:**
     - Added `initiateMitoPlaidRetailCollection()` (`server/mitoRetail/index.ts`) to initiate an Affiliate `RetailTransaction` via `POST /api/v1/mito/Transactions/InitiateHostedTransaction` (`PreferredPaymentMethod: "PLAID"`, unique `-PBB-<attempt>` `PartnerReferenceNumber`, validated Mito `reason`/`source-of-funds` shortcodes) paired with a `RetailCollection` (`journeyType: 4`, `paymentProviders: "PLAID"`) journey via `POST /api/v1/mito/Journey` (`AbortSignal.timeout(15000)`), preserving the exact `/retail-payment?journeyCode=JNY-...` Plaid modal & QR flow while routing Plaid's webhook (`PlaidPaymentSourceType.Retail`) through `RetailAffiliatePaymentSettlementService.ApplyRetailPaymentReceivedAsync` (`PlaidPaymentStatusWebhookHandler.Routing.cs` L160).
     - Added `syncMitoPlaidRetailPaymentStatus()` (`server/mitoRetail/index.ts`) wired into `POST /api/send-money/transactions/:id/confirm-gateway` (`outcome: "completed"`), sequentially handling `PaymentConfirmation` (when `AWAITINGAFFILIATEUPDATE`) and `POST /api/v1/HangFire/MoveRetailToTransaction` (when `READYTOPROCESS` / `PAID`) so Mito Staging immediately migrates the paid `RetailTransaction` into `dbo.Transactions` without waiting for the 5-minute Hangfire cron.
     - Hardened `server/sendMoneyRoutes.ts` so failed `PLAID` initiation never falls back to an un-scoped `InitiateHostedTransaction` or stale `mitoHostedUrl` (returning `502 PAYMENT_GATEWAY_ERROR` and releasing reserved Promo/Bonus), and updated `getOwnedTransaction`, `/api/webhooks/mito`, and `SendMoney.tsx` journey polling (`READYTOPROCESS`, `AWAITINGAFFILIATEUPDATE`, `PROCESSED`) to resolve `-PBB-<suffix>` references seamlessly.


---

### `DEC-2026-11-17-DASHBOARD-SUMMARY-AND-SIDEBAR-THEME` — Dashboard Account Summary Pastel Colour Scheme & Left Sidebar Reference Layout
- **Date Approved:** 17 November 2026 (`2026-11-17`)
- **Decision Owner / Approver:** Mohammad Mumtaz (Product Owner — approved options matching reference screenshots + live UI confirmed `approved` on `feature/dashboard-summary-and-sidebar-theme`)
- **Status:** `Release Approved` (`Summary Option A` + `Sidebar Option 1` · `Verified`)
- **Affected Files (`Rhemito-UI`):** `client/src/pages/Dashboard.tsx`, `client/src/components/layout/Sidebar.tsx`, `tests/e2e/dashboard.spec.js`, `docs/governance/decisions.md`, `docs/governance/traceability.md`
- **Summary:**
  1. **Dashboard `Account Summary` Pastel Colour Scheme (`Dashboard.tsx`):** Replaced borderless `bg-white` summary card fills with the approved Rhemito reference pastel palette (`#FFEDE7` Peach for *Total sent*, `#E5F1FE` Sky Blue for *Wallet Balance*, `#E0EED6` Sage Green for *Collection Account*), `text-xl font-bold` `Account Summary` heading, `rounded-xl` corners, `#605E5C` WCAG AA-compliant label and figure typography, and crisp `bg-white border-[#d2d0ce]` `GBP` selector pills while preserving existing card titles and `data-testid` attributes.
  2. **Left Sidebar Reference Layout & Cleanup (`Sidebar.tsx`):** Removed `'Rewards waiting!'` subtext and the `'NEW'` pill (`rewards-waiting-badge`) from `Reward$`; aligned the sidebar to the approved reference screenshot (`bg-white` surface, `#2e5bff` circular collapse toggle placed inside the top-right header area of the panel, `#2e5bff` active text/icon highlight without background pill fill, `IdCard` icon for `Compliance`, `#4a4a4a` inactive icons, `#605e5c` inactive labels, airy `py-3` / `gap-5` rhythm, and live unread bell + red count badge on `Notifications` via `["/api/notifications/unread-count"]`).

---

### `DEC-2026-11-17-COLLECTION-ACCOUNT-AND-WALLETS-PAGE` — `/overview/collectionaccount` Multi-Tab Page (`Collection Accounts` & `Wallets`) & Dashboard Card Navigation
- **Date Approved:** 17 November 2026 (`2026-11-17`)
- **Decision Owner / Approver:** Mohammad Mumtaz (Product Owner — `Option A` + live UI confirmed `approved` on `feature/dashboard-summary-and-sidebar-theme`)
- **Status:** `Release Approved` (`Option A` · `Verified`)
- **Affected Files (`Rhemito-UI`):** `client/src/data/collectionAccounts.ts`, `client/src/pages/CollectionAccount.tsx`, `client/src/pages/Dashboard.tsx`, `client/src/components/layout/Sidebar.tsx`, `client/src/App.tsx`, `tests/e2e/dashboard.spec.js`, `docs/governance/decisions.md`, `docs/governance/traceability.md`
- **Summary:**
  1. **Dashboard Summary Card Navigation (`Option A`, `Dashboard.tsx`):** Clicking the **Wallet Balance** card (`card-wallet-balance`) opens `/overview/collectionaccount?tab=wallet`, and clicking the **Collection Account** card (`card-collection-account`) opens `/overview/collectionaccount`, while stopping click/keyboard propagation on the `GBP` `<Select>` pill so currency selection never triggers navigation.
  2. **`/overview/collectionaccount` Page (`CollectionAccount.tsx` & `collectionAccounts.ts`):** Implemented the two-tab reference layout inside `DashboardLayout` (`Overview` kept active in `Sidebar.tsx` on `/overview/*`), featuring `← Back` (`/`), URL-synced `Collection Accounts` and `Wallets` underline tabs, rectangular `flagcdn` currency rails with `#2e5bff` left active indicator, `#ECF5FF` detail panels (`Regular Payments` bank details with clipboard copy + toast on `Collection Accounts`; `Wallet Balance`, `Amount Sent`, and `Number Of Transactions` on `Wallets`), `Send Money` CTA (`/send-money?currency=<CODE>`), and `View Transaction History` (`/transactions`), sharing a single balance source with `Dashboard.tsx`.

---

### `DEC-2026-11-18-DASHBOARD-REFINEMENTS-AND-SENTENCE-CASE` — Dashboard Header, Summary, Quick Service & Table Refinements + Application-Wide Sentence Case Headings (`PD-01..PD-04`)
- **Date Approved:** 18 November 2026 (`2026-11-18`)
- **Decision Owner / Approver:** Mohammad Mumtaz (Product Owner — approved `PD-01`, `PD-02 Option A`, `PD-03 Recommended`, `PD-04 Option 2`, plus Dashboard/Header refinements on `fix/welcome-heading-font-weight`)
- **Status:** `UI Approved by Product Owner (E2E Specs Synced — Pending Full E2E Suite Execution)`
- **Affected Files (`Rhemito-UI`):**
  - Core & Rewards (`Slice 1`): `server/auth.ts` (`GET /api/auth/demo-user`), `client/src/hooks/use-auth.ts` (`demoUser`), `client/src/pages/Dashboard.tsx`, `client/src/components/layout/Header.tsx`, `client/src/components/layout/LegalStrip.tsx`, `client/src/components/notifications/NotificationBell.tsx`, `client/src/pages/CollectionAccount.tsx`, `client/src/pages/Transactions.tsx`, `client/src/components/rewards/ReferEarnCard.tsx`, `client/src/components/rewards/ExistingUserReferralCard.tsx`, `client/src/features/promo/PromoCodeField.tsx`, `client/src/pages/Auth/Login.tsx`, `client/src/pages/LandingPage.tsx`, `client/src/pages/Marketing.tsx`, `client/src/pages/not-found.tsx`, `client/src/__tests__/contracts/referral.contract.test.ts` (`REF-17`)
  - Flows, Dialogs & Panels (`Slice 2`): `SendMoney.tsx`, `BankTransferDesigns.tsx`, `TestCheckout.tsx`, `MobilePaymentSimulator.tsx`, `RequestPayment.tsx`, `RequestCheckout.tsx`, `Invoices.tsx`, `InvoiceView.tsx`, `SendInvoice.tsx`, `SentInvoiceDetails.tsx`, `GroupPay/*.tsx`, `Compliance.tsx`, `PayoutAccounts.tsx`, `SenderDetail.tsx`, `SendersRecipients.tsx`, `NotificationArchive.tsx`, `NotificationDetail.tsx`, `NotificationPreferences.tsx`, `components/{contacts,invoices,modals,notifications,payout,transactions}/*.tsx`, `CancelTransactionModal.tsx`, `SampleTicket.tsx`
- **Summary:**
  1. **Dashboard Table, Header, Quick Service & Summary Refinements (`02ed47d`..`d77c44e`):**
     - Removed `"Rhemito"` wordmark text next to the `Rhemito-logo.svg` emblem (`082e581`) and removed the `How it works` (`header-link-how-it-works`) and `Help` (`header-link-help`) top navigation links from `Header.tsx` (leaving `/home` and `/sample-ticket` routes intact in `App.tsx`).
     - Renamed Dashboard third summary card label from `Collection Account` to `Payment account` (`4eb956d` + `PD-04`), renamed the first underline tab (`tab-collection-accounts`) on `/overview/collectionaccount` (`CollectionAccount.tsx`) from `Collection Accounts` to `Payments account` (`aria-label="Payments account and Wallets"`), and updated Quick service button label to `Reward$` (`b02b6d4`).
     - Refined Dashboard `Recent transactions` table: vertical three-dots (`MoreVertical`) action menu & bold `See all` link (`b632b13`), symmetric `Actions` column centering (`px-8 sm:px-10` on `Actions` `TableHead` & `TableCell`, centered `88px` `[View]`/`[Cancel]`/`[Resend]` buttons with floating `absolute left-full ml-1.5` overflow menu in `Dashboard.tsx` & `Transactions.tsx`), `Date` column with 24h `HH:mm GMT` hover tooltip (`be57fda`), counterparty-only `Name` column (`742ca80`), standardized `<symbol> <2dp>` `Amount` column without fee subnote (`2c5f0d7`), `Service` column heading (`a16f59d`), responsive compact `Order no` (`2 chars + ...` below `@4xl` with full reference tooltip) (`afe8666`), and removed inline search box from Dashboard `Recent transactions` header while preserving full search on `/transactions` (`PD-01`, `d77c44e`).
  2. **Reference Header Right-Cluster (`NotificationBell.tsx` & `Header.tsx` — Superseding `PD-02 Option A`):**
     - Styled the notification trigger (`button-notifications`) in `NotificationBell.tsx` as a solid blue rounded-square (`w-9 h-9 rounded-[10px] bg-[#3682df] hover:bg-[#2b72cc]`) with a solid white filled `<Bell />` (`fill-white text-white`) and `99+`-capped red unread pill badge (`bg-[#e04343]`), preserving desktop `Popover` and mobile `Drawer` behavior.
     - Updated the `Header.tsx` profile trigger (`button-profile-menu`) to match the exact left-to-right reference layout (`Individual Profile` / `Business Profile` bold label → `#3b88eb` initials pill → `ChevronDown`) wrapped in a `<DropdownMenu>` displaying the active user's `fullName` (`header-dropdown-name`), `My Account` (`/compliance`), and `Log Out` (`POST /api/auth/logout`, `resetDeviceId()`, `queryClient.clear()`, `/sign-in-sign-up`), with zero hard-coded names (`REF-17` & `REF-18` preserved).
     - *Superseded Rule:* Earlier `PD-02 Option A` (hollow `#2e5bff` outline bell without filled button background) and inline top-bar `fullName` stack superseded by Product Owner's reference screenshot approval (`2026-11-18`).
  3. **`PD-03` (`Recommended` — Non-Bold `"Welcome"` + Bold `<Name>`, Unauthenticated Demo Fallback & `REF-17` Contract Update):**
     - Added `GET /api/auth/demo-user` (`server/auth.ts`, returning `user_123` only when `demoModeEnabled` is true and `404` otherwise, keeping `GET /api/auth/me` strictly `401` when unauthenticated) and exposed `demoUser` on `useAuth()` (`client/src/hooks/use-auth.ts`, keeping `user` `null` and `isAuthenticated` `false` when signed out).
     - Updated `Dashboard.tsx` (`data-testid="dashboard-welcome"`) and `Header.tsx` to derive `activeUser = user ?? demoUser`, so `"Welcome"` stays `font-normal` and `<span className="font-bold">{welcomeName(activeUser)}</span>` renders the signed-in user's name (or seeded demo user `"John"` on unauthenticated `localhost:5000` preview), keeping `REF-18` intact (`welcomeName(null) === ""`, zero hard-coded names in client code) and updating `REF-17` in `client/src/__tests__/contracts/referral.contract.test.ts`.
     - *Superseded Rule:* Commit `02ed47d` made the entire `Welcome <Name>` string `font-normal`; superseded by `PD-03` (`Welcome` `font-normal` + `<Name>` `font-bold`).
  4. **`PD-04` (`Option 2` — Sentence Case for All Headings + Dashboard Quick Service, Filter Chips & `Refer & earn` Card):**
     - Standardized headings (`h1`–`h6`, `CardTitle`, `DialogTitle`, `AlertDialogTitle`, `SheetTitle`, `DrawerTitle`, `<TableHead>` / `<th>`, Dashboard `Wallet balance` / `Payment account` labels, and `See all`) to **Sentence case** across Slice 1 and Slice 2 while preserving proper nouns, brand names (`Rhemito`, `Mito`, `Mito.money`, `MitoView`, `GroupPay`, `Reward$`), currency/country names, acronyms (`UK`, `USA`, `GBP`, `USD`, `NGN`, `KYC`, `PIN`, `OTP`, `QR`, `PDF`, `IBAN`, `SWIFT`, `BIC`, `GMT`, `UTC`, `3DS`), toast messages, and contract-pinned copy (`Use your Referral Credit` in `BONUS-19`; `"There is no Refer & Earn offer..."` in `REF-23`).
     - Per Product Owner follow-up screenshot approvals on Dashboard, also converted Quick service pill buttons (`Send money`, `Receive money`, `Reward$`, `Send invoice`, `Fund campaigns`), `Recent transactions` filter chips (`All`, `Send money`, `Receive money`, `Invoices`, `Campaigns`), `ReferEarnCard.tsx` heading (`Refer & earn` / `Show Refer & earn`), and `LegalStrip.tsx` (`Privacy policy` matching `Terms of use`) to Sentence case while keeping all `data-testid`s and `TYPE_BADGES` intact.


---

### `DEC-2026-11-18-SETTINGS-MY-ACCOUNT-PAGE` — 5-Tab `/settings` (`My Account`) Page (`Option A` + `PD-04` Sentence Case)
- **Date Approved:** 18 November 2026 (`2026-11-18`)
- **Decision Owner / Approver:** Mohammad Mumtaz (Product Owner — approved `Option A` 5-tab `/settings` page + `PD-04` Sentence case)
- **Status:** `UI Approved by Product Owner (E2E Specs Synced — Pending Full E2E Suite Execution)`
- **Affected Files (`Rhemito-UI`):**
  - Frontend: `client/src/pages/Settings.tsx`, `client/src/hooks/use-auth.ts`, `client/src/components/layout/Header.tsx`, `client/src/App.tsx`, `client/src/lib/requests.ts`
  - Backend: `server/auth.ts` (`POST /api/auth/change-password`), `server/storage.ts` (`seedDemoUser` address fields + `deletePayoutAccount`), `server/requestRoutes.ts` (`DELETE /api/request-money/payout-accounts/:id`, `PATCH /api/request-money/payout-accounts/:id/default`)
- **Summary:**
  1. **Routing & Navigation (`App.tsx`, `Header.tsx`, `Sidebar.tsx`):**
     - Registered `<Route path="/settings" component={Settings} />` in `App.tsx` (preserving `/settings/notifications` ahead of `/settings` in `<Switch>`), wired Sidebar `Settings` (`/settings` → defaults to `Edit profile` tab), and updated Header profile menu `My Account` (`header-menu-my-account`) from `/compliance` to `/settings?tab=accounts` (while keeping `/compliance` accessible via Sidebar `Compliance`).
  2. **5 URL-Synced Tabs in `Settings.tsx` (`PD-04` Sentence Case, Zero Hard-Coded Customer Names per `REF-18`, Tailwind CSS Only):**
     - **Tab 1 — `Edit profile` (`?tab=profile` / `/settings`):** `Display timezone` `<Select>` persisted in `localStorage` (`rhemito_display_timezone`) with `<Home />` default reset button and UTC helper caption, plus KYC-locked `Profile details` rows (`Full name`, `Email`, `Mobile number`, `Country of residence`, `Date of birth`, `Address`) dynamically derived from `activeUser = user ?? demoUser` with dismissible `Request profile change` modal + toast feedback.
     - **Tab 2 — `Accounts` (`?tab=accounts`):** `Account summary` displaying deterministic 6-digit `Account number` (`235324` for demo user `user_123`), top `Amount sent` (`GBP`/`USD`/`NGN` sharing `DEMO_GBP_TOTAL_SENT` and `sendMoneyQuery` totals), and 2-column `Wallet` (`GBP`/`NGN` via `WALLET_CURRENCY_ACCOUNTS`) and `Payment account` (`GBP`/`USD`/`NGN` via `COLLECTION_CURRENCY_ACCOUNTS`) summary cards.
     - **Tab 3 — `Change password` (`?tab=password`):** Validated `Existing password`, `New password`, and `Confirm new password` fields with `Eye`/`EyeOff` visibility toggles, backed by `POST /api/auth/change-password` (`bcrypt` verification + 12-round hash update) with toast feedback.
     - **Tab 4 — `My cards` (`?tab=cards`):** Responsive 3-column grid of saved Visa & Mastercard cards (`localStorage` `rhemito_saved_cards_${activeUser?.id ?? "demo"}`) with EMV chip SVG, contactless icon, scheme badges, masked PANs, dynamic uppercase cardholder name from `activeUser`, expiry, and dismissible `Remove card?` confirmation dialog + toast.
     - **Tab 5 — `My bank accounts` (`?tab=banks`):** KYC payout bank accounts table (`Bank` with `Primary` badge / `Set primary` action, `Holder`, `Account`, ISO-3 `Country`, `Currency`, and `Remove` confirmation dialog) + `Add your bank account` modal (mandatory fields above optional fields) wired to `/api/request-money/payout-accounts` (`GET`, `POST`, `PATCH /:id/default`, `DELETE /:id`).
  3. **Superseded Rule:** Earlier `Header.tsx` `header-menu-my-account` temporary target (`/compliance`) superseded by `/settings?tab=accounts`.

---

### `DEC-2026-11-18-REMOVE-OVERVIEW-REDEMPTION-MODE-PILLS` — Remove `Pay less` / `Send more` Pills & Step 1 Caption on Overview + Sentence-Case `Redeem on send money` (`PD-05` / `BONUS-18`)
- **Date Approved:** 18 November 2026 (`2026-11-18`)
- **Decision Owner / Approver:** Mohammad Mumtaz (Product Owner — explicitly approved `PD-05` + Sentence-case `Redeem on send money` CTA)
- **Status:** `UI Approved by Product Owner (E2E Specs Synced — Pending Full E2E Suite Execution)`
- **Affected Files (`Rhemito-UI`):**
  - `client/src/pages/Dashboard.tsx`
  - `client/src/__tests__/contracts/bonus.contract.test.ts` (`BONUS-18`)
- **Summary:**
  1. **Overview Earned Bonus Card (`Dashboard.tsx` — `rewards-section-bonus-banners`):**
     - Removed `dashboard-bonus-redemption-modes` (`Pay less` and `Send more` pills plus `"Pick on Step 1 of Send Money (used separately from Promo Codes)."` caption) and its left divider on Overview while keeping Zone A (earned balance, source pills, guardrails) and Zone B (`Redeem on send money` CTA + `Details in Reward$` link) intact.
     - Updated `dashboard-redeem-send-money-cta` button label from `Redeem on Send Money` to Sentence case `Redeem on send money` (`PD-04`), and removed the inline `· Soonest-expiring used first` note from the Overview guardrail row (`2026-11-18`).
  2. **Contract Sync (`bonus.contract.test.ts` — `BONUS-18`):**
     - Updated `BONUS-18` in both `bonus.contract.test.ts` and `tests/e2e/rewards_contract.spec.js` to assert zero `dashboard-bonus-redemption-modes` pills and `Redeem on send money` on Overview while preserving all balance, guardrail, referee strip, and `/send-money?reward=...` deep-link assertions (following Product Owner live UI `approved` confirmation on `2026-11-18`).
  3. **Superseded Rule:** Earlier `BONUS-18` Overview requirement displaying `Pay less` / `Send more` pills inside `rewards-section-bonus-banners` superseded by `PD-05` (`2026-11-18`).

---

### `DEC-2026-11-18-TRANSACTIONS-PAGE-TABLE-ALIGNMENT` — Align `/transactions` Page Table Design & Layout with Overview `Recent transactions` (`Option 1`)
- **Date Approved:** 18 November 2026 (`2026-11-18`)
- **Decision Owner / Approver:** Mohammad Mumtaz (Product Owner — approved via reference screenshot `"Follow this design and layout"` on `feature/align-transactions-page-table`)
- **Status:** `Release Approved` (`Verified` — Product Owner UI confirmation `approved` on `http://localhost:5000/transactions`, `@verifier` PASS, `82/82` contracts, `319/319` Vitest, `154/154` Playwright E2E green)
- **Affected Files (`Rhemito-UI`):** `client/src/pages/Transactions.tsx`, `tests/e2e/receipt.spec.js`, `tests/e2e/transactions-navigation.spec.js`, `docs/governance/decisions.md`, `docs/governance/traceability.md`
- **Summary:**
  1. **Card Surface, Header & Filter Chips (`Transactions.tsx`):**
     - Removed legacy `max-w-7xl mx-auto` wrapper (`DashboardLayout.tsx` full-width layout) and aligned the `<Card>` surface 1:1 with Overview (`@container rounded-2xl border border-[#efefee] bg-white shadow-[-2px_4px_16px_0px_rgba(0,0,0,0.04)] overflow-hidden`).
     - Styled `Transactions` `<h1>` heading to match Overview `Recent transactions` (`font-display font-bold text-base md:text-lg text-[#605e5c] tracking-tight`) while preserving the dedicated right-aligned `input-search-transactions` search box (`PD-01`, including in-memory `row.email` search matching).
     - Aligned filter chips to Sentence case (`All`, `Send money`, `Receive money`, `Invoices`, `Campaigns`) on white `border-b border-slate-100` (`px-3 py-1 rounded-full text-xs font-medium`).
  2. **7-Column Table Layout, Formatting & Symmetric `Actions` (`Option 1`):**
     - Standardized desktop columns to `Order no` (blue circular `ArrowUpRight` / `ArrowDownLeft` + `@4xl` `<OrderNoCell>` tooltip), `Date` (`<DateCellWithGmtTooltip>` `HH:mm GMT` tooltip), `Name` (clean counterparty-only), `Service`, `Amount` (`formatDashboardAmount()` `<Symbol> <2dp>` `tabular-nums`, no `subNote`), `Status` (`.status-light` traffic-light indicators including explicit `failed` state on `SendMoneyRow`), and `Actions` (`px-8 sm:px-10` centered `88px` pills).
     - Preserved `<SendMoneyReceiptDialog>` non-regressively (`Option 1`): paid Send Money desktop rows display the centered `w-[88px]` `Resend` pill (`#2e5bff`) + floating `MoreVertical` (`⋮`, `button-actions-more-${tx.id}`) containing `View receipt` (`button-receipt-${tx.id}`), matching the `[View] + ⋮` pattern on `Receive money` and `Invoices`; mobile cards retain paired `[Receipt]` + `[Resend]` pills.
     - Aligned empty state (`Reset filters`), loading `<Skeleton>` rows/cards, `enabled: !isAuthLoading` query gating, `scheduledTransactions` UTC date sort, `transactions-pagination` footer (`Showing X–Y of Z transactions • Page P of T` + `button-prev-page` / `button-next-page`), and regulatory footer note with `Dashboard.tsx`.
  3. **Superseded Behaviour:** Earlier `/transactions` column order (`Ref no. → Recipient / sender → Service → Date → Amount`), desktop email/type-badge sublines, ISO-code `Amount` + `subNote`, `MoreHorizontal` overflow icon, Title-Case filter chips, and side-by-side desktop `[Receipt] [Resend]` buttons superseded by the unified Overview table layout.

---

### `DEC-2026-11-18-SUPPORT-MODULE` — 5-Screen Support Module (`/support`, `/support/faq`, `/support/my-tickets`, `/support/create-ticket`, `/my-tickets/request-details/:id`) & Sidebar Unread Support Badge (`Direction A`)
- **Date Approved:** 18 November 2026 (`2026-11-18`)
- **Decision Owner / Approver:** Mohammad Mumtaz (Product Owner — approved `Direction A` + live UI `approved` & `Push and merge` on `feature/support-module`)
- **Status:** `Release Approved` (`Verified` — Product Owner UI confirmation `approved` on `http://localhost:5000`, `@verifier` PASS, `82/82` contracts, `335/335` Vitest, `167/167` Playwright E2E green)
- **Affected Files (`Rhemito-UI`):**
  - Shared & Backend: `shared/support.ts`, `shared/schema.ts`, `server/supportService.ts`, `server/supportRoutes.ts`, `server/notificationService.ts`, `server/routes.ts`
  - Frontend: `client/src/App.tsx`, `client/src/components/layout/Sidebar.tsx`, `client/src/contexts/NotificationContext.tsx`, `client/src/components/notifications/NotificationItem.tsx`, `client/src/pages/NotificationDetail.tsx`, `client/src/pages/Auth/{SignInSignUp,Login}.tsx`, `client/src/pages/Auth/components/{SignInStep,OtpStep}.tsx`, `client/src/lib/support.ts`, `client/src/components/support/{SupportAttachmentUpload,SupportSignInRequiredCard}.tsx`, `client/src/pages/Support/{SupportHub,SupportFaq,MyTickets,CreateTicket,TicketRequestDetails}.tsx`
  - Tests: `client/src/__tests__/support-mitoview-compliance.test.ts`, `tests/e2e/support.spec.js`
- **Summary:**
  1. **5-Screen Layout & Flows (`Direction A` — Staging Fidelity + `PD-04` Sentence Case):**
     - **`/support` (`SupportHub.tsx`):** Full-width `DashboardLayout` hub with `Support` heading and stacked `FAQs` (`/support/faq`) and `My tickets` (`/support/my-tickets`) navigation cards (`#F9F9FA` surface, hover light-blue, right chevron).
     - **`/support/faq` (`SupportFaq.tsx`):** `<` Back button + `FAQs` heading + retail-scoped categorized single-toggle `+`/`−` accordions (`GET /api/v1/Account/Faqs`, rewriting internal `FURP` mentions to `mito.money`).
     - **`/support/my-tickets` (`MyTickets.tsx`):** `<` Back button, `My tickets` heading, `+ Create new ticket` primary CTA (`/support/create-ticket`), right-aligned debounced `Search tickets…` input with `×` clear button, 5 status pill tabs (`New`, `Awaiting admin`, `Awaiting client`, `Resolved`, `All` — smart-defaulting to `New` when `New > 0` else `All`), desktop table + mobile card stack (`Ticket #`, `Subject`, `Date`, `Status` badges: `New` `#1A73E8`, `Awaiting admin` `#F9AB00`, `Awaiting client` `#7B61FF`, `Resolved` `#1E8E3E`), empty state, and pagination.
     - **`/support/create-ticket` (`CreateTicket.tsx` + `/support/TicketForm` alias):** `<` Back button, `New ticket` heading, `Need help regarding` subheading, and 3 expandable issue accordions (`Failed transaction`, `Recipients`, `KYC and compliance`), each rendering an inline form with mandatory fields on top (`Transaction reference*` for Failed transaction, `Subject*`, `Message*`) above optional single-file `Attachment` dropzone (`PNG, JPG, PDF — max 2MB`) and `Submit request` button + toast feedback.
     - **`/my-tickets/request-details/:id` (`TicketRequestDetails.tsx`):** `<` Back button, `#<referenceNumber> <summary>`, date, status, `"Reply to this ticket to open it"` helper when resolved/closed, collapsible `Reply` composer (`Description*`, `Attachment`, `Cancel request` / `Submit request`), and conversation thread cards (`BackOffice User` on `#F8F8F8`, customer derived dynamically from active user per `REF-18`, image lightbox modal, PDF preview, and download).
  2. **Sidebar & Notification Integration (`Sidebar.tsx`, `notificationService.ts`):**
     - Retains `LifeBuoy` icon on `Support` (`DEC-2026-11-17-DASHBOARD-SUMMARY-AND-SIDEBAR-THEME`), highlights `Support` across both `/support*` and `/my-tickets*`, and renders `sidebar-support-badge` (blue filled bell + red count pill) when unread `support_ticket_*` notifications exist, automatically marking matching ticket notifications read when `/my-tickets/request-details/:id` is viewed.
  3. **Protected Existing Modules (`AGENTS.md` §1, §6):** `Settings.tsx` (`Request profile change`) and `SampleTicket.tsx` (`/sample-ticket`) remain untouched.

---

### `DEC-2026-11-18-MITOVIEW-AND-REAL-FURP-APIS` — MitoView Module (`/mitoview`, `/mitoview/:slug`, `/mitoview/unsubscribe`, `/blog`) & Live `furp02-staging` Real-API Integration for Support & MitoView (`Direction A` + Customer Auth Bridge)
- **Date Approved:** 18 November 2026 (`2026-11-18`)
- **Decision Owner / Approver:** Mohammad Mumtaz (Product Owner — approved `MitoView Direction A + Real FURP Customer Auth Bridge` + live UI `approved` & `Push and merge` on `feature/support-module`)
- **Status:** `Release Approved` (`Verified` — Product Owner UI confirmation `approved` on `http://localhost:5000`, `@verifier` PASS, `82/82` contracts, `335/335` Vitest, `167/167` Playwright E2E green)
- **Affected Files (`Rhemito-UI`):**
  - Shared & Assets: `shared/mitoView.ts`, `shared/support.ts`, `client/public/mitoview/july/{unified-payments,onepipe,support,rhemi}.jpg`
  - Backend: `server/furpClient.ts`, `server/auth.ts` (additive FURP `Auth/check-email` & `Auth/login` customer token bridge), `server/supportRoutes.ts` (live `furp02-staging` proxy + `FURP_LIVE=0`/`FURP_BASE_URL=''`/`VITEST` offline fallback), `server/mitoViewRoutes.ts` (live `furp02-staging` `MitoView/*` proxy + offline fallback), `server/routes.ts`
  - Frontend: `client/src/lib/mitoView.ts`, `client/src/lib/support.ts`, `client/src/pages/MitoView/{MitoViewShell,MitoViewHome,MitoViewArticle,MitoViewUnsubscribe}.tsx`, `client/src/pages/Support/{MyTickets,CreateTicket,TicketRequestDetails}.tsx`, `client/src/components/layout/Sidebar.tsx`, `client/src/App.tsx`
  - Tests: `client/src/__tests__/support-mitoview-compliance.test.ts`, `tests/e2e/mitoview.spec.js`
- **Summary:**
  1. **Live `furp02-staging.funtechcom.com` Real-API Integration (Superseding Local-Only Prototype Store in `DEC-2026-11-18-SUPPORT-MODULE`):**
     - **MitoView (`server/mitoViewRoutes.ts`):** Proxies `GET /api/v1/MitoView/posts`, `GET /api/v1/MitoView/posts/:slug`, `POST /api/v1/MitoView/subscribe`, `POST /api/v1/MitoView/unsubscribe`, and `POST /api/v1/MitoView/unsubscribe/confirm` directly to `furp02-staging.funtechcom.com` keeping `apiKey` strictly server-side (5-minute GET cache; local fixture fallback only when `VITEST` or `FURP_LIVE=0`).
     - **Support & FURP Customer Auth Bridge (`server/auth.ts`, `server/furpClient.ts`, `server/supportRoutes.ts`):** `POST /api/auth/check-email` and `POST /api/auth/login` bridge real `furp02-staging` customer accounts (`/api/v1/Auth/check-email` & `/api/v1/Auth/login`), syncing the customer into local `authUsers` and storing their FURP customer JWT (`furpAccessToken`, cleared on logout) while leaving local/Playwright test accounts unbroken. `GET /api/v1/Account/Faqs` fetches live FAQs from `furp02-staging` (via customer JWT or `getMitoRetailToken()`), and `Support/*` + `Account/GetNotifications?unreadOnly=true` + `Account/MarkNotificationRead` proxy per-customer tickets directly to `furp02-staging` using the signed-in customer's FURP JWT (showing a clean `Sign in` prompt when no customer FURP JWT is active, never leaking a shared partner account's tickets).
  2. **MitoView 3-Screen UX (`Direction A` — Tailwind CSS Only, `PD-04` Sentence Case):**
     - **`/mitoview` (`MitoViewHome.tsx`):** Adaptive signed-in (`DashboardLayout`, omitting Staging's duplicate marketing `HomeFooter` while keeping `Sidebar` `MitoView` active) and signed-out public shell; pill search bar (`?q=...`), `16:10` media cards, pagination, and `Are you subscribed?` card (`Subscribe` + `Unsubscribe any time` + `useToast()` feedback).
     - **`/mitoview/:slug` (`MitoViewArticle.tsx` + `/blog` redirects):** Back navigation to `/mitoview`, Georgia serif editorial reader supporting `river`, `split`, and `editorial` layouts, `sm`/`md`/`lg`/`banner` figures, `bodyJson` block stream (`kicker`, `h2`, `p`, `img`, `cta`), and edition-not-found state.
     - **`/mitoview/unsubscribe` (`MitoViewUnsubscribe.tsx`):** `← All posts` link, `Leave the MitoView list`, visible bordered pill email input (fixing Staging's white-on-white input defect), and `?token=...` confirmation mode.

---

### `DEC-2026-11-18-COMPLIANCE-REFERENCE-LAYOUT` — Full-Width Reference `/compliance` Page & Live `furp02-staging` Profile/KYC Hydration (`Direction A` — `PD-04` Sentence Case)
- **Date Approved:** 18 November 2026 (`2026-11-18`)
- **Decision Owner / Approver:** Mohammad Mumtaz (Product Owner — approved `Direction A` from uploaded `/compliance` reference screenshot + live UI `approved` & `Push and merge` on `feature/support-module`)
- **Status:** `Release Approved` (`Verified` — Product Owner UI confirmation `approved` on `http://localhost:5000/compliance`, `@verifier` PASS, `82/82` contracts, `335/335` Vitest, `167/167` Playwright E2E green)
- **Affected Files (`Rhemito-UI`):**
  - Shared & Backend: `shared/compliance.ts`, `server/complianceRoutes.ts`, `server/routes.ts`
  - Frontend: `client/src/lib/compliance.ts`, `client/src/components/compliance/ComplianceVerifiedView.tsx`, `client/src/pages/Compliance.tsx` (`CompliancePage` only; `KycVerificationPage` & `KycReturnPage` untouched)
  - Tests: `client/src/__tests__/support-mitoview-compliance.test.ts`, `tests/e2e/compliance.spec.js`
- **Summary:**
  1. **Reference `/compliance` Layout (`Direction A` + `PD-04` Sentence Case, Tailwind CSS Only):**
     - Replaced the legacy centered `max-w-4xl` emerald `<Card>` (`compliance-verified-card`) and its `Refresh Status` / `Send Money` / `Back to Overview` buttons in `CompliancePage` with the full-width `DashboardLayout` compliance sheet (`Compliance` heading -> `AML address verification` -> `1px` `#e1dfdd` rule -> `Personal information` two-column rows: `Full name`, `Occupation`, `Date of birth`, `Gender`, `Address`, `City`, `Post code` in clean uppercase, `Resident country`; plus `Business verification`, Full Document KYC `Identity verification` + `Photo verification` + right-side bordered `Already verified` card, `Under review`, `Failed`, and pure-Tailwind `hostedUrl` KYC `<iframe>`).
  2. **Live `furp02-staging` Hydration & Non-Regression:**
     - `GET /api/compliance/overview` (`server/complianceRoutes.ts`) fetches live `GET /api/v1/Account/profile` and `GET /api/v1/KYC/Status?api-version=2` from `furp02-staging.funtechcom.com` when a customer `furpAccessToken` is active (launching customer FURP `POST /api/v1/Journey` only when KYC action is required), and falls back cleanly to the signed-in / demo user's server-stored `authUsers` profile + Mito KYC Journey when local (zero hardcoded names per `REF-18`; `/kyc` & `/kyc/return` untouched).
  3. **Superseded Behaviour:** Legacy centered `compliance-verified-card` and `Refresh Status` / `Send Money` / `Back to Overview` buttons on `/compliance` superseded by `Direction A` reference layout (`2026-11-18`).

---

### `DEC-2026-11-18-DASHBOARD-REFER-COLLAPSIBLE-AND-SUMMARY-HOVER` — Premium Collapsible `Refer & earn` (`Direction 1A`) & Non-Zero `Account summary` Hover Border (`Direction 2A` + `Scope S1`)
- **Date Approved:** 18 November 2026 (`2026-11-18`)
- **Decision Owner / Approver:** Mohammad Mumtaz (Product Owner — explicitly replied `approved` & `push and merge` on `feature/dashboard-referral-and-summary-ux`)
- **Status:** `Release Approved` (`Verified` — Product Owner UI confirmation + `@qa-verifier` PASS, `82/82` contracts, `335/335` Vitest, `168/168` Playwright E2E green)
- **Affected Files (`Rhemito-UI`):**
  - `client/src/components/rewards/ReferEarnCard.tsx`
  - `client/public/referral-gift-box.png` (alpha-matted transparent RGBA background + `bg-transparent` container)
  - `client/src/pages/Dashboard.tsx`
  - Tests: `tests/e2e/rewards.spec.js`, `tests/e2e/dashboard.spec.js`
- **Summary:**
  1. **`Refer & earn` Collapsible Section (`Direction 1A` — Unified Outer Shell + Pinned Top-Right Toggle + Actionable Collapsed Bar):**
     - Open by default (`collapsed = false`) whenever a valid/applicable referral rule exists (`Boolean(offer) && !offer.cap_reached`; hidden when `!offer` per `REF-15`); manual collapse persisted per rule (`rhemito_refer_collapsed_${userId ?? "demo"}_${offer.rule_id}`) so any brand-new referral rule auto-opens, and `highlighted` (`OfferBanner`) auto-expands.
     - Unified outer shell (`rounded-2xl border border-[#e6eef8] bg-white p-3.5 sm:p-4`) with persistent full-width header bar (`Refer & earn` + corridor pills left; `How it works` + `toggle-refer-earn-card` pinned at `100%` top-right in both states with `180°` rotating chevron and zero cursor teleportation).
     - Smooth Framer Motion `AnimatePresence` + `motion.div` `height`/`opacity` choreography (`duration: 0.28`, `ease: [0.22, 1, 0.36, 1]`, respecting `useReducedMotion()`).
     - Actionable collapsed bar (~58px single row) retaining Sentence-case stats (`Friends joined`, `Bonus earned`, or `"No referrals yet. Share your link to start earning."`), corridor & reward summary (`You <X> · Friend <Y>`), and 1-click `Copy link` + `Share` pills while preserving 100% of `REF-11..REF-23` contracts.
  2. **`Account summary` Non-Zero Hover Border (`Direction 2A` + `Scope S1`):**
     - Applies to interactive **`Wallet balance`** (`card-wallet-balance`, `#E5F1FE`) and **`Payment account`** (`card-collection-account`, `#E0EED6`) cards on Overview (`Total sent` and `/settings?tab=accounts` untouched).
     - Reserves `border border-transparent` at rest (`0px` layout shift) and applies surface-harmonized chromatic hover borders + soft ambient glow + `-translate-y-[1px]` **only when the numeric value is `> 0`** (`Wallet balance`: `hover:border-[#5B9BF8]`; `Payment account`: `hover:border-[#58A96A]`; `0.00` remains `border-transparent` with no glow/lift).

---

### `DEC-2026-11-18-SEND-MONEY-RECIPIENT-LIST-REDESIGN` — `/send-money` Step 2 Recipient List Reference Layout (`Direction 3A`)
- **Date Approved:** 18 November 2026 (`2026-11-18`)
- **Decision Owner / Approver:** Mohammad Mumtaz (Product Owner — confirmed via reference screenshot + `push and merge` on `feature/dashboard-referral-and-summary-ux`)
- **Status:** `Release Approved` (`Verified` — Product Owner UI confirmation + `@qa-verifier` PASS, `82/82` contracts, `335/335` Vitest, `168/168` Playwright E2E green)
- **Affected Files (`Rhemito-UI`):**
  - `client/src/pages/SendMoney.tsx` (`currentStep === 2` recipient list, `mapBeneficiaryToRecipient`, & Step 3 network error resilience)
  - `client/src/lib/sendMoney.ts` (`createSendMoneyTransaction` transient network retry)
  - Tests: `tests/e2e/send_money.spec.js`
- **Summary:**
  1. **Reference 2-Line Recipient Row Layout (`Direction 3A` — Tailwind CSS Only, `PD-04` Harmonized):**
     - Replaced Step 2 rainbow `AVATAR_COLORS`, multi-line colored `Acct:`/`Sort:`/`IBAN:`/`SWIFT:` pill chips, italic `"narration"` subline, and right-side currency code with clean `divide-y divide-[#efefee]` 2-line rows matching the uploaded reference screenshot:
       - **Avatar (`44px`):** Soft ice-blue circle (`bg-[#DCEBFA] text-[#323130] text-[13px] sm:text-sm font-normal`) + bottom-right solid green dot (`bg-[#0E7A0D] w-2.5 h-2.5 rounded-full ring-[1.5px] ring-white`), harmonized across Step 2 `Recent Recipients` and search suggestions so recipient avatars stay visually consistent on the screen.
       - **Left 2-Line Stack:** Semibold recipient name (`text-[15px] sm:text-base font-semibold text-[#111827]`) over muted bank/provider name (`text-[13px] sm:text-sm font-normal text-[#605E5C]`).
       - **Right 2-Line Stack:** Dynamic teal delivery-method label (`#38A3A5`, `Bank deposit` / `Mobile money` / `Cash pickup` from `collectionMode` / `serviceCode` / `deliveryMethod`, harmonized with `PD-04` Sentence case) over proportional `tabular-nums` account identifier (`text-[13px] sm:text-sm font-normal text-[#605E5C] tabular-nums` using `r.account || compactIban(r.iban) || r.mobileNo || r.sortCode || r.currency`).
  2. **Non-Regression:** Step 3 (`Recipient details`) and Right Sticky Summary continue to prefill and display all saved fields (`account`, `sortCode`, `iban`, `swift`, `narration`, `currency`), and keyboard/click selection (`setSelectedRecipient(r); handleNext()`) remains unchanged.
  3. **Superseded Behaviour:** Earlier Step 2 recipient row rainbow avatar colors, `Acct:/Sort:/IBAN:/SWIFT:` chips, italic narration subline, and right-side `NGN` currency line superseded by `Direction 3A` (`2026-11-18`).

---

### `DEC-2026-11-19-BENEFICIARY-JOURNEY-PARITY` — Shared-Application Beneficiary Journey & Form Parity Across `/send-money` (5-Step Flow) & Standalone `/beneficiaries/*` Pages (`Direction A`)
- **Date Approved:** 19 November 2026 (`2026-11-19`)
- **Decision Owner / Approver:** Mohammad Mumtaz (Product Owner — explicitly replied `recommendations approved` on `2026-11-19`)
- **Status:** `Verified` (`Direction A` — Product Owner UI confirmation `approved` on `http://localhost:5000`, `@verifier` PASS, `0` TS errors, `82/82` contracts, `335/335` Vitest, `63/63` Send Money/Recipients/Rewards/Bonus/Promo/Gateway E2E green on `feature/beneficiary-journey-parity`; pending explicit `git push` approval)
- **Affected Files (`Rhemito-UI`):**
  - Shared & Backend: `shared/beneficiaryRequirements.ts`, `shared/sendMoney.ts`, `server/mitoRetail/index.ts`, `server/sendMoneyRoutes.ts`
  - Frontend: `client/src/lib/sendMoney.ts`, `client/src/components/beneficiary/{DeliveryAndProviderPicker,BankVerificationCard,NicknameFieldWithCheck,BeneficiaryReviewSummary,useNicknameValidation,useBankVerification}.ts(x)`, `client/src/pages/SendMoney.tsx`, `client/src/pages/Beneficiaries/{AddBeneficiaryPage,BeneficiaryDetailPage,EditBeneficiaryPage}.tsx`, `client/src/components/contacts/RecipientsPanel.tsx`, `client/src/components/layout/Sidebar.tsx`, `client/src/App.tsx`
- **Summary:**
  1. **`/send-money` 5-Step Beneficiary & Transfer Journey (`Direction A`, `SendMoney.tsx`):**
     - Expanded `/send-money` stepper from 4 steps to 5 steps (`1. Amount` → `2. Recipient` → `3. Bank` → `4. Summary` → `5. Payment method`) using named step constants (`STEP_AMOUNT = 1` .. `STEP_PAYMENT = 5`), remapping all Payment, Card 3DS (`/send/status`), Plaid, Manual Bank Transfer, and Promo/Referral/Bonus (`step4-rewards-card`) logic intact to Step 5.
     - **Step 2 (`Recipient` inline sub-steps):**
       - *2A (Saved list):* Preserves approved `Direction 3A` 2-line rows (`DEC-2026-11-18-SEND-MONEY-RECIPIENT-LIST-REDESIGN`), `Recent recipients` avatars, search bar + `New recipient` (`Add recipient` when empty), and functional `+10` `Show more` pagination.
       - *2B (Delivery method & Provider picker):* `← Back to recipients`, `Delivery method` cards (`Direct to bank` vs `Swift` when international providers exist via `Static/Providers`), and searchable bank/operator list showing live corridor rate (`<FromFlag> GBP 1.00 / <ToFlag> <CUR> <rate>`) + `Show more` (auto-skipping if only a generic provider exists).
       - *2C (`Recipient details`):* `← Back to banks` / `← Back to recipients`, `Individual` / `Business` entity toggle, dynamic corridor `Personal` & `Identification` fields ordered strictly **mandatory above optional** (`CLAUDE.md` L38, keeping `Address line 2` under `Address line 1`), and optional `Nickname (Optional)` with live `400ms` debounced min-5-char + `ValidateBeneficiaryNickName` availability check & Collection Account `<Info />` popover. Complete saved recipients and `Mobile money` transfers smart-skip Step 3 (`Bank`) straight to Step 4 (`Summary`); `Cash pickup` deferred until Step 1 supports it.
     - **Step 3 (`Bank`):** Selected bank banner + dynamic `Banking` fields (`acct_number`, `sort_code`, `iban`, `bic_swift`, `aba`, `ifsc`, `bsb_code`, `branch_code`, `bank_code`, `clabe`, `cnaps`, with tooltips) + **`Search bank details`** (`POST /api/send-money/mito/bank-details` → `POST /api/v1/Bank/GetBankingDetails`), showing verified `Account holder name` card (with 1-click name sync) when resolved or a non-blocking amber notice unlocking `Continue` when unresolved/offline.
     - **Step 4 (`Summary`):** `#ECF5FF` review banner + `Amount`, `Recipient`, and `Banking / provider` sections (with `Edit` jump links) + Terms notice + `Save` / `Continue` creating the Mito beneficiary & `awaiting_payment` transaction before advancing to Step 5 (`Payment method`).
  2. **Standalone Recipients Pages (`/beneficiaries/add`, `/beneficiaries/:id`, `/beneficiaries/:id/edit`):**
     - `RecipientsPanel.tsx` (`Add recipient`, `View`, `Edit`) navigates to dedicated full-page routes sharing `client/src/components/beneficiary/*`: 4-stage `AddBeneficiaryPage` wizard (including `Recipient added successfully` screen with `Send money`, `Add another recipient`, and `Done`, and optional `Email address` synthesizing `@beneficiary.rhemito.local` when blank), 3-column `BeneficiaryDetailPage` (`Personal details`, `Banking details`, `Services`, `#ECF5FF` header banner, `REF/<code>` copy chip, `Send money` / `Edit` / `Delete`), and `EditBeneficiaryPage`.
     - Updated `Sidebar.tsx` `Recipients` link from `/senders-recipients` to `/senders-recipients?tab=recipients` while keeping `Recipients` active across `/beneficiaries*` and `tab=recipients`.
  3. **Backend Mito API Alignment & Defect Repairs (`server/mitoRetail/index.ts`, `server/sendMoneyRoutes.ts`):**
     - Repaired upstream Mito `deleteMitoBeneficiary` (`GET /api/v1/mito/Beneficiaries/DeleteBeneficiary?beneficiaryId=...`) and `updateMitoBeneficiary` (`POST /api/v1/mito/Beneficiaries/UpdateBeneficiary`) while retaining `.dev-state` fallback.
     - Added `POST /api/send-money/mito/bank-details`, `GET /api/send-money/mito/validate-nickname`, `GET /api/send-money/mito/provinces` (`Static/ProvinceState`), `Static/Providers` `local` vs `international` classification, full field forwarding on beneficiary create/update, and static corridor requirement templates (`shared/beneficiaryRequirements.ts`).
  4. **Superseded Behaviour:** Earlier 4-step `/send-money` stepper (combining Recipient + Bank without `Summary` step), modal-only `Add recipient` / `View` / `Edit` dialogs in `RecipientsPanel.tsx`, required `Email` in standalone recipient creation, and wrong HTTP verbs on upstream Mito beneficiary update/delete superseded by `DEC-2026-11-19-BENEFICIARY-JOURNEY-PARITY`.
