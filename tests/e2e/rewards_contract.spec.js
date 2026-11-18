import { test, expect } from '@playwright/test';

/**
 * Rewards contract tests (UI rules) — Promo Code, Bonus and Referral behaviour in the browser.
 * Companion to client/src/__tests__/contracts/*.contract.test.ts; only rules the existing specs
 * (bonus, rewards, promo_payment, receipt, payment_failure, welcome_name) do not already cover.
 *
 * If one of these fails, read the "CONTRACT" comment above the test: it says WHY the rule exists and
 * WHERE it is implemented. Only change a contract when the product owner (Mohammad) changed the rule,
 * and update the test in the same PR with the reason (see "Rewards contract tests" in CLAUDE.md).
 *
 * Mito and the rewards APIs are mocked with page.route, so no Mito service is needed.
 */

const inDays = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
};

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const offer = {
    rule_id: 81, currency: 'GBP', reward_type: 'BOTH', referrer_reward: 5, referee_reward: 10, floor: 50,
    qualification_window_days: 30, bonus_validity_days: 90, min_redeem_amount: 0,
    text: 'Invite friends with your link. You get £5.00 and your friend gets £10.00 in bonus credit when they send £50.00 or more within 30 days of joining.',
    referral_code: 'JOHN2880', referral_link: 'http://localhost:5000/ref/JOHN2880', cap_reached: false,
};

const friends = [
    { id: 'R3', friend: 'Musa I.', joined_on: '2026-09-25T10:00:00Z', status: 'REGISTERED', status_label: 'Joined', currency: 'GBP', floor: 50, qualification_deadline: inDays(22), reward: 5, credited: 0 },
    { id: 'R2', friend: 'Kemi L.', joined_on: '2026-09-24T10:00:00Z', status: 'PENDING', status_label: 'In progress', currency: 'GBP', floor: 50, qualification_deadline: inDays(21), reward: 5, credited: 0 },
    { id: 'R1', friend: 'Sarah S.', joined_on: '2026-09-20T10:00:00Z', status: 'REWARDED', status_label: 'Earned', currency: 'GBP', floor: 50, qualification_deadline: inDays(17), reward: 5, credited: 5 },
];

const history = [
    { id: 'h1', created_at: '2026-10-05T10:00:00Z', type: 'EARNED', reason_code: 'REFERRAL_REWARD', amount: 10, currency: 'GBP', notes: 'Referrer reward – referred Sarah S.', transfer_id: null, source_credit_id: null, credit_source: 'REFERRAL', credit_source_label: 'Referral bonus – Sarah S.' },
    { id: 'h2', created_at: '2026-10-04T10:00:00Z', type: 'EARNED', reason_code: 'MANUAL_CREDIT', amount: 5, currency: 'GBP', notes: 'Goodwill', transfer_id: null, source_credit_id: null, credit_source: 'MANUAL', credit_source_label: 'Goodwill credit from Rhemito' },
    { id: 'h3', created_at: '2026-10-03T10:00:00Z', type: 'APPLIED', reason_code: 'BONUS_REDEMPTION', amount: -4, currency: 'GBP', notes: '', transfer_id: 'TXN-202610-00001', source_credit_id: 'h1', credit_source: 'REFERRAL' },
    { id: 'h4', created_at: '2026-10-02T10:00:00Z', type: 'EXPIRED', reason_code: 'BONUS_EXPIRED', amount: -2, currency: 'GBP', notes: '', transfer_id: null, source_credit_id: 'h2', credit_source: 'MANUAL' },
    { id: 'h5', created_at: '2026-10-01T10:00:00Z', type: 'VOIDED', reason_code: 'TRANSFER_CANCELLED', amount: -3, currency: 'GBP', notes: '', transfer_id: 'TXN-X', source_credit_id: null, credit_source: 'SCHEME' },
    // Repayment bookkeeping rows are never shown as bonus activity
    { id: 'h6', created_at: '2026-09-30T10:00:00Z', type: 'CLAWBACK', reason_code: 'CLAWBACK', amount: -1, currency: 'GBP', notes: 'Clawback bookkeeping row', transfer_id: 'TXN-X', source_credit_id: null, credit_source: 'SCHEME' },
];

function summary({ gbp = 7, usd = 0, referrals = friends, referralSummary, hist = [], blocked = false, balances: customBalances, unused = [], referredBy } = {}) {
    const balances = customBalances ?? [];
    if (!customBalances) {
        if (gbp > 0) balances.push({ currency: 'GBP', available: gbp, earned: gbp + 8, used: 4, expired: 2, used_transfer_count: 1, referral_credit_count: 1, other_credit_count: 1, by_source: [{ credit_source: 'REFERRAL', label: 'Referrals', earned: gbp + 8, used: 8, expired: 0, removed: 0, available: gbp }] });
        if (usd > 0) balances.push({ currency: 'USD', available: usd, earned: usd, used: 0, expired: 0, used_transfer_count: 0, referral_credit_count: 0, other_credit_count: 1 });
    }
    return {
        customer: { id: 'user_123', referralCode: 'JOHN2880', currency: 'GBP', ...(referredBy ? { referredBy } : {}) },
        ...(referredBy ? { referredBy } : {}),
        currency: 'GBP',
        offer,
        wallet: { bonus_blocked: blocked, balances, unused, credits: unused, history: hist, promo_redemptions: [] },
        referrals: { data: referrals, summary: referralSummary ?? { joined: 3, earned_count: 1, total_earned: { GBP: 5 } } },
        latestOffer: null,
    };
}

async function mockRewards(page, opts = {}) {
    const data = summary(opts);
    await page.route('**/api/rewards/summary**', (route) => route.fulfill(json({ data })));
    await page.route('**/api/promocodes/savings**', (route) => route.fulfill(json({ data: { items: [], saved: {} } })));
    await page.route('**/api/bonus/summary**', (route) => route.fulfill(json({ data: { currency: 'GBP', currencies: ['GBP'], blocked: opts.blocked ?? false, offers: [], wallet: data.wallet } })));
    await page.route('**/api/send-money/mito/beneficiaries**', (route) =>
        route.fulfill(
            json({
                data: {
                    configured: true,
                    beneficiaries: [
                        {
                            beneficiaryId: '11111111-2222-3333-4444-555555555555',
                            name: 'Akshita',
                            firstName: 'Akshita',
                            lastName: 'Sharma',
                            legalEntityType: 'individual',
                            providerId: 'e3af932a-0326-4b65-b5f4-e8f753a69d4d',
                            bankName: 'United Bank for Africa Plc (UBA)',
                            acctNumber: '1018316888',
                            relationship: 'FRIEND',
                            reason: 'FOROWNEXPENDITURES',
                            narration: 'Family allowance',
                            address: '12 Marina Road',
                            city: 'Lagos',
                            postcode: '100001',
                            stateOrProvince: 'Lagos',
                            mobileNo: '08031234567',
                            currency: 'NGN',
                            country: 'Nigeria',
                            countryIso3: 'NGA',
                        },
                    ],
                },
            }),
        ),
    );
}

async function openSendMoney(page, amount) {
    await page.goto('/send-money');
    await page.getByPlaceholder('0.00').first().fill(amount);
}

async function advanceFromAmountToPayment(page) {
    const promoModal = page.getByTestId('step1-promo-modal');
    if (await promoModal.isVisible().catch(() => false)) {
        await page.getByRole('button', { name: 'Close promo code modal' }).click();
    }
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText('Akshita', { exact: true }).first().click();
    await expect(page.getByText(/Recipient details/i).first()).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('beneficiary-review-summary')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Continue' }).click();
}

async function toPayment(page, amount) {
    await openSendMoney(page, amount);
    await advanceFromAmountToPayment(page);
}

const num = async (locator) => Number((await locator.innerText()).replace(/[^0-9.]/g, ''));

test.describe('Rewards contract — bonus panel', () => {
    /**
     * CONTRACT BONUS-10: the bonus panel is selected on the Amount step and carries to the Payment step summary and into the pay request.
     * WHY: customers select their reward on Step 1, and the choice must carry to payment and into the pay request.
     * CODE: client/src/pages/SendMoney.tsx.
     */
    test('[BONUS-10] a choice made on the Amount step is still selected on the Payment step and is sent with the payment', async ({ page }) => {
        await mockRewards(page);
        let sent = null;
        await page.route('**/api/send-money/transactions/*/pay', async (route) => {
            sent = route.request().postDataJSON();
            await route.fulfill(json({ data: { id: 'tx1', reference: 'RH-C1', status: 'completed', paidAt: new Date().toISOString() } }));
        });

        await openSendMoney(page, '500');
        await page.getByTestId('step1-use-referral-btn').click();
        const panel1 = page.getByTestId('bonus-redemption');
        await expect(panel1).toContainText('£7.00 available', { timeout: 15000 });
        await expect(page.getByRole('radio', { name: /Pay less/ })).not.toBeChecked();
        await expect(page.getByRole('radio', { name: /Send more/ })).not.toBeChecked();
        await page.getByRole('radio', { name: /Send more/ }).check();
        await expect(page.getByTestId('summary-bonus-step1')).toContainText('+ £7.00');

        await advanceFromAmountToPayment(page);

        await expect(page.getByTestId('summary-bonus')).toContainText('Bonus credit (to recipient)');
        await expect(page.getByTestId('summary-bonus')).toContainText('+ £7.00');

        await page.getByText('Credit/Debit Card').click();
        await expect.poll(() => sent).not.toBeNull();
        expect(sent.paymentMethod).toBe('card');
        expect(sent.bonusCredit).toEqual({ mode: 'send_more', amount: '7.00' });
    });

    /**
     * CONTRACT BONUS-01: the bonus balance is per currency — only the transfer's currency (GBP) counts.
     * WHY: £ bonus cannot pay a $ transfer; and with 0 balance the panel stays hidden on both steps.
     * CODE: client/src/pages/SendMoney.tsx (balanceFor(wallet, SEND_CURRENCY)), client/src/features/bonus/components/UseBonusCredit.tsx.
     */
    test('[BONUS-01] a balance in another currency does not show the bonus panel, on either step', async ({ page }) => {
        await mockRewards(page, { gbp: 0, usd: 50 });
        await openSendMoney(page, '500');
        await expect(page.getByRole('heading', { name: 'Send money' })).toBeVisible();
        await expect(page.getByTestId('bonus-redemption')).toHaveCount(0);
        await expect(page.getByTestId('summary-bonus-step1')).toHaveCount(0);
        await advanceFromAmountToPayment(page);
        await expect(page.getByText('How would you like to pay?')).toBeVisible();
        await expect(page.getByTestId('bonus-redemption')).toHaveCount(0);
    });

    /**
     * CONTRACT BONUS-11: when the server says the bonus service is unavailable the choice is KEPT (the customer may retry),
     * the transfer is not paid, and a destructive toast explains.
     * WHY: the choice is still valid; only the service is down. CODE: client/src/pages/SendMoney.tsx bonusRefused().
     */
    test('[BONUS-11] BONUS_UNAVAILABLE keeps the choice and shows a destructive toast', async ({ page }) => {
        await mockRewards(page);
        const message = `Bonus credit can't be used right now. Choose "Don't use bonus" to continue, or try again shortly.`;
        await page.route('**/api/send-money/transactions/*/pay', (route) => route.fulfill(json({ error: { code: 'BONUS_UNAVAILABLE', message } }, 503)));
        await openSendMoney(page, '500');
        await page.getByTestId('step1-use-referral-btn').click();
        await expect(page.getByTestId('bonus-redemption')).toContainText('£7.00 available', { timeout: 15000 });
        await page.getByRole('radio', { name: /Pay less/ }).check();
        await advanceFromAmountToPayment(page);
        await page.getByText('Credit/Debit Card').click();
        const toast = page.locator('.destructive').filter({ hasText: 'Bonus not applied' });
        await expect(toast).toBeVisible();
        await expect(toast).toContainText("Choose \"Don't use bonus\" to continue");
        await expect(page.getByTestId('summary-bonus')).toBeVisible();
        await expect(page.getByText('Success!')).toHaveCount(0);
    });
});

test.describe('Rewards contract — promo code field', () => {
    async function promoStep1(page, { payReply }) {
        await mockRewards(page, { gbp: 0 });
        const validations = [];
        const payBodies = [];
        await page.route('**/api/promocodes/status', (route) => route.fulfill(json({ data: { enabled: true } })));
        await page.route('**/api/promocodes/validate', (route) => {
            validations.push(route.request().postDataJSON());
            return route.fulfill(json({ valid: true, appliedDiscount: 1, displayText: '£1.00 off your fee' }));
        });
        await page.route('**/api/send-money/transactions/*/pay', (route) => {
            payBodies.push(route.request().postDataJSON());
            return route.fulfill(payReply);
        });
        await openSendMoney(page, '500');
        await page.getByTestId('step1-use-promo-btn').click();
        return { validations, payBodies };
    }

    /**
     * CONTRACT PROMO-01/04/06: the discount shown comes from Mito's answer and comes off the FEE only (the send amount is unchanged);
     * the payment method is not sent to Mito before one is chosen; the payment carries the code and the discount that was shown.
     * CODE: client/src/features/promo/usePromoCode.ts, client/src/pages/SendMoney.tsx.
     */
    test('[PROMO-01] applying a code shows "Promo (CODE)" and lowers the total by exactly the approved fee discount', async ({ page }) => {
        const { validations } = await promoStep1(page, { payReply: json({ data: { id: 'tx1', reference: 'RH-C2', status: 'completed', paidAt: new Date().toISOString() } }) });
        await expect(page.getByTestId('promo-apply')).toBeDisabled();
        await page.getByTestId('promo-code-input').fill('save05');
        await expect(page.getByTestId('promo-apply')).toBeEnabled();
        await expect(page.getByTestId('promo-apply')).toHaveClass(/bg-blue-600/);
        await page.getByTestId('promo-apply').click();
        await expect(page.getByTestId('promo-message')).toContainText('£1.00 off your fee');
        expect(validations).toHaveLength(1);
        expect(validations[0]).toMatchObject({ code: 'SAVE05', amount: 500, currency: 'GBP' });
        expect(validations[0]).not.toHaveProperty('paymentMethod'); // no method chosen yet

        await advanceFromAmountToPayment(page);
        await expect(page.getByTestId('summary-promo')).toContainText('Promo (SAVE05)');
        await expect(page.getByTestId('summary-promo')).toContainText('£1.00');
    });

    /**
     * CONTRACT PROMO-10: a pay-time PROMO_* refusal drops the discount and a destructive "Payment not made" toast explains —
     * and the generic "Payment not completed" toast is NOT used.
     * WHY: the server re-checks the code before any money moves; the customer must be able to remove the code and continue.
     * CODE: client/src/pages/SendMoney.tsx (PROMO_ branch), client/src/features/promo/usePromoCode.ts reject().
     */
    test('[PROMO-10] a code refused at payment time is shown on the field, with a destructive "Payment not made" toast', async ({ page }) => {
        const message = 'This promo code has reached its limit. Go back and remove the promo code to continue.';
        const { payBodies } = await promoStep1(page, { payReply: json({ error: { code: 'PROMO_REJECTED', message } }, 409) });
        await page.getByTestId('promo-code-input').fill('SAVE05');
        await page.getByTestId('promo-apply').click();
        await expect(page.getByTestId('promo-message')).toContainText('£1.00 off your fee');

        await advanceFromAmountToPayment(page);
        await expect(page.getByTestId('summary-promo')).toBeVisible();

        await page.getByText('Credit/Debit Card').click();
        const toast = page.locator('.destructive').filter({ hasText: 'Payment not made' });
        await expect(toast).toBeVisible();
        await expect(toast).toContainText('This promo code has reached its limit.');
        expect(payBodies[0]).toMatchObject({ paymentMethod: 'card', promoCode: 'SAVE05', promoDiscount: '1.00' });
        await expect(page.getByTestId('summary-promo')).toHaveCount(0);
        await expect(page.getByText('Payment not completed')).toHaveCount(0);
        await expect(page.getByText('Success!')).toHaveCount(0);
    });
});

test.describe('Rewards contract — a failed payment is never silent', () => {
    /**
     * CONTRACT PAY-13: if the payment request cannot even reach the server the customer still sees a destructive
     * "Payment not completed" toast with the standard text, never the success screen, and can try again.
     * WHY: a payment once failed with no message at all. CODE: client/src/pages/SendMoney.tsx (catch around paySendMoneyTransaction).
     */
    test('[PAY-13] a network failure shows the destructive "Payment not completed" toast and allows a retry', async ({ page }) => {
        await mockRewards(page, { gbp: 0 });
        let attempts = 0;
        await page.route('**/api/send-money/transactions/*/pay', (route) => {
            attempts += 1;
            return attempts === 1 ? route.abort('connectionfailed') : route.fulfill(json({ error: { code: 'INTERNAL_ERROR', message: 'The payment could not be recorded. Please try again.' } }, 500));
        });
        await toPayment(page, '100');
        await page.getByText('Instant Pay By Bank').click();
        const toast = page.locator('.destructive').filter({ hasText: 'Payment not completed' }).first();
        await expect(toast).toBeVisible();
        await expect(toast).toContainText("We couldn't complete your payment. Please try again.");
        await expect(page.getByText('Success!')).toHaveCount(0);
        // The method is released so the customer can choose again
        await page.getByText('Instant Pay By Bank').click();
        await expect.poll(() => attempts).toBe(2);
        await expect(page.locator('.destructive').filter({ hasText: 'The payment could not be recorded.' }).first()).toBeVisible();
    });
});

test.describe('Rewards contract — Bonus & Discounts', () => {
    /**
     * CONTRACT BONUS-15: the tiles and History filters use "Bonus earned", "Bonus used", "Bonus expired" (and "Promo codes");
     * earned = EARNED, used = APPLIED, expired = EXPIRED/VOIDED; repayment (CLAWBACK) rows are never listed; each row shows
     * a source chip (Referrals / Bonus offers / From Rhemito) from credit_source.
     * CODE: client/src/pages/BonusAndDiscounts.tsx, client/src/features/bonus/components/SourceChip.tsx.
     */
    test('[BONUS-15] tile and History labels, filters by kind, source chips, and no repayment rows', async ({ page }) => {
        await mockRewards(page, { hist: history });
        await page.goto('/bonus-discounts');
        const tiles = page.getByTestId('bonus-totals');
        await expect(tiles).toContainText('Bonus earned');
        await expect(tiles).toContainText('Bonus used');
        await expect(tiles).toContainText('Bonus expired');

        await page.getByRole('tab', { name: 'History' }).click();
        for (const name of ['All', 'Bonus earned', 'Bonus used', 'Bonus expired', 'Promo codes']) {
            await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
        }
        const rows = page.getByTestId('bonus-history').locator('li');
        await expect(rows).toHaveCount(5); // the CLAWBACK row is not shown
        await expect(page.getByTestId('bonus-history')).not.toContainText('Clawback bookkeeping row');

        await page.getByRole('button', { name: 'Bonus earned', exact: true }).click();
        await expect(rows).toHaveCount(2);
        await expect(rows.nth(0).getByTestId('source-chip')).toHaveText('Referrals');
        await expect(rows.nth(1).getByTestId('source-chip')).toHaveText('From Rhemito');
        await expect(rows.nth(1)).toContainText('Goodwill credit from Rhemito');

        await page.getByRole('button', { name: 'Bonus used', exact: true }).click();
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText('Bonus used on transfer TXN-202610-00001');

        await page.getByRole('button', { name: 'Bonus expired', exact: true }).click();
        await expect(rows).toHaveCount(2);
        await expect(page.getByTestId('bonus-history')).toContainText('Bonus credit expired');
        await expect(page.getByTestId('bonus-history')).toContainText('Bonus removed – transfer or request reversed');
    });

    /**
     * CONTRACT BONUS-18: Dashboard surfaces the Earned Bonus & Quick Redeem card when bonus > 0, showing
     * referee welcome attribution ("Invited by John Doe"), guardrails (without Step 1 redemption-mode pills on Overview
     * per DEC-2026-11-18-REMOVE-OVERVIEW-REDEMPTION-MODE-PILLS), and a 1-click "Redeem on send money" CTA that navigates
     * to /send-money?reward=referral with Step 1 bonus credit open.
     * WHY: newly invited referees must immediately see their welcome credit and redeem it in one click.
     * CODE: client/src/pages/Dashboard.tsx, client/src/pages/SendMoney.tsx.
     */
    test('[BONUS-18] Dashboard Earned Bonus & Quick Redeem card deep-links to Send Money Step 1 bonus credit', async ({ page }) => {
        await mockRewards(page, {
            referredBy: 'John Doe',
            balances: [
                {
                    currency: 'GBP',
                    available: 5,
                    earned: 5,
                    used: 0,
                    expired: 0,
                    used_transfer_count: 0,
                    referral_credit_count: 1,
                    other_credit_count: 0,
                    by_source: [
                        {
                            credit_source: 'REFERRAL',
                            label: 'Referrals',
                            earned: 5,
                            used: 0,
                            expired: 0,
                            removed: 0,
                            available: 5,
                            floor: 50,
                            receive_currency: null,
                        },
                    ],
                },
            ],
            unused: [
                {
                    id: 'cr_welcome_1',
                    source: 'Welcome bonus – invited by John Doe',
                    source_label: 'Welcome bonus – invited by John Doe',
                    credit_source_label: 'Welcome bonus – invited by John Doe',
                    credit_source: 'REFERRAL',
                    reason_code: 'REFEREE',
                    amount: 5,
                    remaining: 5,
                    currency: 'GBP',
                    earned_on: '2026-11-13',
                    expires_on: '2027-02-11',
                    floor: 50,
                    receive_currency: null,
                    status: 'UNUSED',
                },
            ],
        });

        await page.goto('/');
        const card = page.getByTestId('rewards-section-bonus-banners');
        await expect(card).toBeVisible();
        await expect(page.getByTestId('dashboard-total-unused-bonus')).toContainText('£5.00');
        await expect(page.getByTestId('referral-bonus-earned-pill')).toContainText('Welcome bonus');
        await expect(page.getByTestId('referral-bonus-earned-pill')).toContainText('Invited by John Doe');
        await expect(card).toContainText('Min. transfer £50.00');
        await expect(card).toContainText('GBP → All corridors');
        await expect(card).toContainText('Expires 11/02/2027');
        await expect(page.getByTestId('dashboard-bonus-redemption-modes')).toHaveCount(0);
        await expect(card).not.toContainText('Soonest-expiring used first');
        await expect(page.getByTestId('dashboard-redeem-send-money-cta')).toContainText('Redeem on send money');

        await page.getByTestId('dashboard-redeem-send-money-cta').click();
        await expect(page).toHaveURL(/\/send-money\?reward=referral/);
        const bonusPanel = page.getByTestId('bonus-redemption');
        await expect(bonusPanel).toBeVisible();
        await expect(bonusPanel).toContainText('Use your Referral Credit');
        await expect(bonusPanel).toContainText('£5.00 available');
    });

    /**
     * CONTRACT BONUS-20: when a verified referee returns from /kyc directly onto Step 4 (resumeStep: 4),
     * Step 4 surfaces step4-rewards-card with their Referral Credit auto-open, and selecting Pay less updates
     * both summary-bonus / summary-total and the payment method row ("You pay GBP ...").
     * WHY: newly registered users complete KYC between Step 1/2/3 and Step 4 and must be able to see and apply
     * their welcome bonus right on Step 4 without losing it across the KYC redirect.
     * CODE: client/src/pages/SendMoney.tsx, server/sendMoneyRoutes.ts.
     */
    test('[BONUS-20] post-KYC resume onto Step 4 surfaces earned referral credit and applies Pay less to payment total', async ({ page }) => {
        await mockRewards(page, {
            referredBy: 'John Doe',
            balances: [
                {
                    currency: 'GBP',
                    available: 5,
                    earned: 5,
                    used: 0,
                    expired: 0,
                    used_transfer_count: 0,
                    referral_credit_count: 1,
                    other_credit_count: 0,
                    by_source: [
                        {
                            credit_source: 'REFERRAL',
                            label: 'Referrals',
                            earned: 5,
                            used: 0,
                            expired: 0,
                            removed: 0,
                            available: 5,
                            floor: 50,
                            receive_currency: null,
                        },
                    ],
                },
            ],
            unused: [
                {
                    id: 'cr_kyc_step4_1',
                    source: 'Welcome bonus – invited by John Doe',
                    source_label: 'Welcome bonus – invited by John Doe',
                    credit_source_label: 'Welcome bonus – invited by John Doe',
                    credit_source: 'REFERRAL',
                    reason_code: 'REFEREE',
                    amount: 5,
                    remaining: 5,
                    currency: 'GBP',
                    earned_on: '2026-11-13',
                    expires_on: '2027-02-11',
                    floor: 50,
                    receive_currency: null,
                    status: 'UNUSED',
                },
            ],
        });

        await page.goto('/');
        await page.evaluate(() => {
            window.sessionStorage.setItem('rhemito_kyc_just_completed', 'true');
            window.localStorage.setItem(
                'kyc_context',
                JSON.stringify({
                    resumeStep: 4,
                    amount: '100',
                    sendCurrencyState: 'GBP',
                    receiveCurrency: 'NGN',
                }),
            );
        });
        await page.goto('/send-money');

        const step4Card = page.getByTestId('step4-rewards-card');
        await expect(step4Card).toBeVisible();
        const step4BonusPanel = step4Card.getByTestId('bonus-redemption');
        await expect(step4BonusPanel).toBeVisible();
        await expect(step4BonusPanel).toContainText('Use your Referral Credit');
        await expect(step4BonusPanel).toContainText('£5.00 available');

        const totalBefore = await num(page.getByTestId('summary-total'));
        await step4BonusPanel.getByRole('radio', { name: /Pay less/ }).check();
        await expect(page.getByTestId('summary-bonus')).toContainText('- £5.00');
        await expect.poll(async () => await num(page.getByTestId('summary-total'))).toBe(totalBefore - 5);
        const expectedTotal = (totalBefore - 5).toFixed(2);
        await expect(page.getByText(`You pay GBP ${expectedTotal}`).first()).toBeVisible();
    });
});

test.describe('Rewards contract — Refer & Earn card', () => {
    /**
     * CONTRACT REF-13/14: the card shows the friends-joined count and the total earned (several currencies joined with " + "),
     * the money amounts in the offer sentence are bold, and it NEVER lists individual friends — they are on the Referrals tab,
     * which the "View all referrals" link opens.
     * WHY: the Dashboard card is collapsed by default and keeps its height however many friends join. CODE: client/src/components/rewards/ReferEarnCard.tsx.
     */
    test('[REF-13] totals only on the card, bold offer amounts, friends listed only after "View all referrals"', async ({ page }) => {
        await mockRewards(page, { referralSummary: { joined: 3, earned_count: 1, total_earned: { GBP: 5, USD: 3 } } });
        await page.goto('/');
        const card = page.getByTestId('refer-earn-card');
        await expect(card).toBeVisible();
        await expect(card.getByText('Friends joined')).toBeVisible();
        await expect(card.getByText('Bonus earned')).toBeVisible();
        await expect(card.getByTestId('refer-count')).toHaveText('3');
        await expect(card.getByTestId('refer-earned')).toHaveText('£5.00 + $3.00');
        const bold = card.getByTestId('refer-offer-text').locator('strong');
        await expect(bold).toHaveText(['£5.00', '£10.00', '£50.00']);
        for (const f of friends) await expect(card.getByText(f.friend)).toHaveCount(0);

        await card.getByRole('link', { name: /View all referrals/i }).click();
        await expect(page).toHaveURL(/\/bonus-discounts\?tab=referrals/);
        await expect(page.getByTestId('referral-card-R3')).toContainText('Musa I.');
        await expect(page.getByTestId('referral-card-R2')).toContainText('Kemi L.');
    });

    /**
     * CONTRACT REF-01: opening /ref/:code validates the code with the server, remembers it in the browser (localStorage
     * "rhemito.referral"), redirects desktop straight to sign-up, and shows only the matching mobile OS on Android/iOS.
     * CODE: client/src/pages/ReferralLanding.tsx, client/src/lib/rewards.ts.
     */
    test('[REF-01] a referral link stores the code for sign-up', async ({ page }) => {
        await page.route('**/api/rewards/codes/**', (route) => route.fulfill(json({ data: { code: 'JOHN2880', referrerFirstName: 'John', offer, signedIn: false } })));
        await page.route('**/api/rewards/visits', (route) => route.fulfill(json({ data: { counted: true } })));
        await page.goto('/ref/john2880');
        await expect(page).toHaveURL(/sign-in-sign-up/);
        await expect(page.getByTestId('referral-invite')).toContainText('John invited you');
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('rhemito.referral') || 'null'));
        expect(stored).toMatchObject({ code: 'JOHN2880', referrerFirstName: 'John' });
    });

    /**
     * CONTRACT REF-21: an applied referral code on the Sign-Up form is strictly read-only for the referee —
     * there is NO "Remove" button whether the code came from a /ref/:code invite link or manual entry.
     * WHY: product owner rule (2026-11-16) — referees cannot remove an applied referral code.
     * CODE: client/src/components/rewards/ReferralSignup.tsx, client/src/pages/Auth/components/SignUpForm.tsx.
     */
    test('[REF-21] applied referral code on Sign-Up is read-only with no Remove button (link and manual entry)', async ({ page }) => {
        await page.route('**/api/rewards/codes/**', (route) => route.fulfill(json({ data: { code: 'JOHN2880', referrerFirstName: 'John', offer, signedIn: false } })));
        await page.route('**/api/rewards/visits', (route) => route.fulfill(json({ data: { counted: true } })));

        // 1. Via /ref/:code invite link
        await page.goto('/ref/john2880');
        await expect(page).toHaveURL(/sign-in-sign-up/);
        await page.getByPlaceholder('e.g. jamescollor@email.com').fill(`referee.lock.${Date.now()}@example.com`);
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByPlaceholder('000000').fill('123456');
        await page.getByRole('button', { name: 'Verify Code' }).click();

        const applied = page.getByTestId('referral-code-applied');
        await expect(applied).toBeVisible();
        await expect(applied).toContainText('Referral code JOHN2880');
        await expect(applied).toContainText('Code applied – invited by John');
        await expect(applied.getByRole('button', { name: /remove/i })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);

        // 2. Via manual "Have a referral code?" entry on Sign-Up
        await page.evaluate(() => localStorage.removeItem('rhemito.referral'));
        await page.goto('/sign-in-sign-up?mode=signup');
        await page.getByPlaceholder('e.g. jamescollor@email.com').fill(`referee.manual.${Date.now()}@example.com`);
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByPlaceholder('000000').fill('123456');
        await page.getByRole('button', { name: 'Verify Code' }).click();

        await page.getByRole('button', { name: 'Have a referral code?' }).click();
        const codeInput = page.locator('#referral-code');
        await codeInput.fill('john2880');
        await codeInput.blur();

        await expect(applied).toBeVisible();
        await expect(applied).toContainText('Referral code JOHN2880');
        await expect(applied.getByRole('button', { name: /remove/i })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
    });

    /**
     * CONTRACT REF-03: when an existing user opens a referral link on Web, Android, or iOS, the page tells them clearly in a
     * friendly British tone that the offer is for new users only, clears any stored code, and shows the existing-user offers
     * (Refer & Earn, Bonus Schemes, Promo Codes) and how they benefit from each.
     * CODE: client/src/pages/ReferralLanding.tsx, client/src/components/rewards/ExistingUserReferralCard.tsx, client/src/pages/Auth/SignInSignUp.tsx.
     */
    test('[REF-03] existing user clicking a referral link sees the British notice and existing-user offers across Web, Android, and iOS', async ({ page }) => {
        await page.route('**/api/rewards/codes/**', (route) => route.fulfill(json({ data: { code: 'JOHN2880', referrerFirstName: 'John', offer, signedIn: true } })));
        await page.route('**/api/rewards/existing-user-offers**', (route) => route.fulfill(json({
            data: {
                signedIn: true,
                currency: 'GBP',
                viewerFirstName: 'Sarah',
                viewerReferralCode: 'SARAH100',
                viewerReferralLink: 'http://localhost:5000/ref/SARAH100',
                referralOffer: offer,
                referralOffers: [offer],
                bonusOffers: [{ id: 1, name: 'GBP Loyalty Bonus', type: 'LOYALTY_CREDIT', currency: 'GBP', summary: 'Complete 3 transfers within 30 days and get £10.00 bonus credit.' }],
            },
        })));

        for (const query of ['', '?platform=android', '?platform=ios']) {
            await page.goto(`/ref/john2880${query}`);
            await expect(page.getByTestId('existing-user-referral-view')).toBeVisible();
            await expect(page.getByTestId('existing-user-heading')).toContainText('Lovely to see you again');
            await expect(page.getByTestId('existing-user-explanation')).toContainText('exclusively for new users');
            await expect(page.getByTestId('existing-offer-refer-earn')).toContainText('How you benefit from Refer & Earn');
            await expect(page.getByTestId('existing-offer-bonus-schemes')).toContainText('How you benefit from each Bonus Scheme');
            await expect(page.getByTestId('existing-offer-promo-codes')).toContainText('How you benefit from Promo Codes');
            const stored = await page.evaluate(() => localStorage.getItem('rhemito.referral'));
            expect(stored).toBeNull();
        }
    });
/**
     * CONTRACT REF-20: sharing a referral link provides a clear marketing message explaining why to register
     * and make a transfer, renders the official Rhemito SVG logo, and reconciles referrer-earned history with My referrals.
     * CODE: client/src/lib/rewards.ts, client/src/components/rewards/ReferEarnCard.tsx, client/src/pages/ReferralLanding.tsx, client/src/components/rewards/ReferralSignup.tsx.
     */
    test('[REF-20] referral link sharing and landing show the marketing message, why to register and transfer, and the official Rhemito logo', async ({ page }) => {
        await page.route('**/api/rewards/codes/**', (route) => route.fulfill(json({ data: { code: 'JOHN2880', referrerFirstName: 'John', offer, signedIn: false } })));
        await page.route('**/api/rewards/visits', (route) => route.fulfill(json({ data: { counted: true } })));

        // a) On /ref/john2880?platform=android, referral-landing-why-register is visible with "Why register & send with Rhemito" and rhemito-official-logo is visible
        await page.goto('/ref/john2880?platform=android');
        const whyLanding = page.getByTestId('referral-landing-why-register');
        await expect(whyLanding).toBeVisible();
        await expect(whyLanding).toContainText('Why register & send with Rhemito');
        await expect(page.getByTestId('rhemito-official-logo')).toBeVisible();

        // b) On /ref/john2880 (desktop redirect to /sign-in-sign-up?mode=signup), referral-invite-why-register is visible with "Why register & send with Rhemito"
        await page.goto('/ref/john2880');
        await expect(page).toHaveURL(/sign-in-sign-up/);
        const whyInvite = page.getByTestId('referral-invite-why-register');
        await expect(whyInvite).toBeVisible();
        await expect(whyInvite).toContainText('Why register & send with Rhemito');

        // c) On / (Dashboard), clicking refer-preview-marketing-btn opens refer-share-dialog with refer-marketing-message-preview containing "Why register & send with Rhemito:"
        await mockRewards(page, { balances: [{ currency: 'GBP', available: 0, earned: 0, used: 0, expired: 0 }] });
        await page.goto('/');
        await expect(page.getByTestId('rewards-section-bonus-banners')).toHaveCount(0);
        await page.getByTestId('refer-preview-marketing-btn').click();
        const dialog = page.getByTestId('refer-share-dialog');
        await expect(dialog).toBeVisible();
        const preview = page.getByTestId('refer-marketing-message-preview');
        await expect(preview).toBeVisible();
        await expect(preview).toContainText('Why register & send with Rhemito:');
    });

    /**
     * CONTRACT REF-23: the Reward$ currency selector (rewards-currency-select) filters Overview, History, and My referrals
     * consistently across currencies (GBP, USD, EUR) without cross-currency leakage, persists across tab switches, and
     * pre-selects the active corridor currency from the Dashboard "View all referrals" link.
     * CODE: client/src/pages/BonusAndDiscounts.tsx, client/src/components/rewards/ReferEarnCard.tsx.
     */
    test('[REF-23] currency selector filters Overview, History, and My referrals consistently across GBP, USD, and EUR', async ({ page }) => {
        const gbpOffer = {
            ...offer,
            rule_id: 81,
            currency: 'GBP',
            referral_code: 'JOHN2880GBP',
            referral_link: 'http://localhost:5000/ref/JOHN2880GBP',
        };
        const usdOffer = {
            ...offer,
            rule_id: 82,
            currency: 'USD',
            referrer_reward: 10,
            referee_reward: 20,
            floor: 100,
            text: 'Invite friends with your link. You get $10.00 and your friend gets $20.00 in bonus credit when they send $100.00 or more within 30 days of joining.',
            referral_code: 'JOHN2880USD',
            referral_link: 'http://localhost:5000/ref/JOHN2880USD',
        };
        const multiData = {
            customer: { id: 'user_123', referralCode: 'JOHN2880', currency: 'GBP' },
            currency: 'GBP',
            sendCurrencies: ['GBP', 'USD', 'EUR'],
            offer: gbpOffer,
            offers: [gbpOffer, usdOffer],
            wallet: {
                bonus_blocked: false,
                balances: [
                    {
                        currency: 'GBP',
                        available: 7,
                        earned: 15,
                        used: 8,
                        expired: 0,
                        used_transfer_count: 1,
                        referral_credit_count: 1,
                        other_credit_count: 0,
                        by_source: [{ credit_source: 'REFERRAL', label: 'Referrals', earned: 15, used: 8, expired: 0, removed: 0, available: 7 }],
                    },
                    {
                        currency: 'USD',
                        available: 10,
                        earned: 10,
                        used: 0,
                        expired: 0,
                        used_transfer_count: 0,
                        referral_credit_count: 1,
                        other_credit_count: 0,
                        by_source: [{ credit_source: 'REFERRAL', label: 'Referrals', earned: 10, used: 0, expired: 0, removed: 0, available: 10 }],
                    },
                ],
                unused: [
                    { id: 'u_gbp', source: 'Referrer reward – referred Sarah S.', credit_source: 'REFERRAL', credit_source_label: 'Referral bonus – Sarah S.', reason_code: 'REFERRAL_REWARD', amount: 15, remaining: 7, currency: 'GBP', earned_on: '2026-10-01', expires_on: inDays(80), status: 'PARTLY_USED' },
                    { id: 'u_usd', source: 'Referrer reward – referred Alex M.', credit_source: 'REFERRAL', credit_source_label: 'Referral bonus – Alex M.', reason_code: 'REFERRAL_REWARD', amount: 10, remaining: 10, currency: 'USD', earned_on: '2026-10-05', expires_on: inDays(85), status: 'UNUSED' },
                ],
                credits: [
                    { id: 'u_gbp', amount: 15, remaining: 7, currency: 'GBP', status: 'PARTLY_USED', expires_on: inDays(80), notes: '', reason_code: 'REFERRAL_REWARD', created_at: '2026-10-01' },
                    { id: 'u_usd', amount: 10, remaining: 10, currency: 'USD', status: 'UNUSED', expires_on: inDays(85), notes: '', reason_code: 'REFERRAL_REWARD', created_at: '2026-10-05' },
                ],
                history: [
                    { id: 'u_gbp', created_at: '2026-10-01T10:00:00Z', type: 'EARNED', reason_code: 'REFERRAL_REWARD', amount: 15, currency: 'GBP', notes: 'Referrer reward – referred Sarah S.', transfer_id: null, source_credit_id: null, credit_source: 'REFERRAL', credit_source_label: 'Referral bonus – Sarah S.' },
                    { id: 'u_usd', created_at: '2026-10-05T10:00:00Z', type: 'EARNED', reason_code: 'REFERRAL_REWARD', amount: 10, currency: 'USD', notes: 'Referrer reward – referred Alex M.', transfer_id: null, source_credit_id: null, credit_source: 'REFERRAL', credit_source_label: 'Referral bonus – Alex M.' },
                ],
                promo_redemptions: [
                    { id: 'p_legacy_null', code: 'LEGACY5', amount: -5, currency: null, transfer_id: 'TXN-LEG', created_at: '2026-10-02T10:00:00Z' },
                    { id: 'p_usd_4', code: 'USDSAVE4', amount: -4, currency: 'USD', transfer_id: 'TXN-USD', created_at: '2026-10-06T10:00:00Z' },
                ],
            },
            referrals: {
                data: [
                    { id: 'R_GBP_1', friend: 'Sarah S.', joined_on: '2026-09-20T10:00:00Z', status: 'REWARDED', status_label: 'Earned', currency: 'GBP', floor: 50, qualification_deadline: inDays(17), reward: 5, credited: 5 },
                    { id: 'R_GBP_2', friend: 'Musa I.', joined_on: '2026-09-25T10:00:00Z', status: 'REGISTERED', status_label: 'Joined', currency: 'GBP', floor: 50, qualification_deadline: inDays(22), reward: 5, credited: 0 },
                    { id: 'R_USD_1', friend: 'Alex M.', joined_on: '2026-10-04T10:00:00Z', status: 'REWARDED', status_label: 'Earned', currency: 'USD', floor: 100, qualification_deadline: inDays(25), reward: 10, credited: 10 },
                ],
                summary: { joined: 3, earned_count: 2, total_earned: { GBP: 5, USD: 10 } },
            },
            latestOffer: null,
        };

        await page.route('**/api/rewards/summary**', (route) => route.fulfill(json({ data: multiData })));
        await page.route('**/api/promocodes/savings**', (route) =>
            route.fulfill(
                json({
                    data: {
                        items: [
                            { id: 'p_legacy_null', code: 'LEGACY5', amount: 5, currency: null, transferId: 'TXN-LEG', createdAt: '2026-10-02T10:00:00Z' },
                            { id: 'p_usd_4', code: 'USDSAVE4', amount: 4, currency: 'USD', transferId: 'TXN-USD', createdAt: '2026-10-06T10:00:00Z' },
                        ],
                        saved: { GBP: 5, USD: 4 },
                    },
                }),
            ),
        );
        await page.route('**/api/bonus/summary**', (route) =>
            route.fulfill(
                json({
                    data: {
                        currency: 'GBP',
                        currencies: ['GBP', 'USD', 'EUR'],
                        blocked: false,
                        offers: [{ id: 1, name: 'Send 3, get £10', type: 'LOYALTY', currency: 'GBP', summary: 'Complete 3 transfers and get £10.00.' }],
                        wallet: multiData.wallet,
                    },
                }),
            ),
        );

        // 1. Dashboard USD corridor pill -> "View all referrals" deep-links to ?tab=referrals&currency=USD
        await page.goto('/');
        const card = page.getByTestId('refer-earn-card');
        await card.getByRole('button', { name: 'USD → ALL' }).click();
        await card.getByRole('link', { name: /View all referrals/i }).click();
        await expect(page).toHaveURL(/\/bonus-discounts\?tab=referrals&currency=USD/);
        await expect(page.getByTestId('rewards-currency-select')).toContainText('USD');

        // 2. My referrals (USD): only USD referrals & per-currency summary
        await expect(page.getByTestId('referral-summary')).toContainText('Joined: 1 · Earned: 1 · Total earned: $10.00');
        await expect(page.getByTestId('referral-card-R_USD_1')).toContainText('Alex M.');
        await expect(page.getByTestId('referral-card-R_GBP_1')).toHaveCount(0);
        await expect(page.getByTestId('referral-card-R_GBP_2')).toHaveCount(0);

        // 3. Overview & History (USD persists across tabs; legacy null-currency promo does not leak into USD)
        await page.getByRole('tab', { name: 'Overview' }).click();
        await expect(page.getByTestId('rewards-currency-select')).toContainText('USD');
        await expect(page.getByTestId('bonus-totals')).toContainText('$10.00');
        await expect(page.getByTestId('total-saved')).toContainText('$4.00');
        await expect(page.getByTestId('unused-bonus')).toContainText('Alex M.');
        await expect(page.getByTestId('unused-bonus')).not.toContainText('Sarah S.');
        await expect(page.getByTestId('ways-to-earn')).toHaveCount(0);

        await page.getByRole('tab', { name: 'History' }).click();
        await expect(page.getByTestId('rewards-currency-select')).toContainText('USD');
        await expect(page.getByTestId('bonus-history')).toContainText('Alex M.');
        await expect(page.getByTestId('bonus-history')).toContainText('Promo code USDSAVE4');
        await expect(page.getByTestId('bonus-history')).not.toContainText('Sarah S.');
        await expect(page.getByTestId('bonus-history')).not.toContainText('Promo code LEGACY5');

        // 4. Switch selector to GBP: legacy null-currency promo attributes to GBP, GBP referrals show, WaysToEarn stays hidden
        await page.getByTestId('rewards-currency-select').click();
        await page.getByRole('option', { name: 'GBP', exact: true }).click();
        await expect(page.getByTestId('bonus-history')).toContainText('Sarah S.');
        await expect(page.getByTestId('bonus-history')).toContainText('Promo code LEGACY5');
        await expect(page.getByTestId('bonus-history')).not.toContainText('Alex M.');

        await page.getByRole('tab', { name: 'Overview' }).click();
        await expect(page.getByTestId('bonus-totals')).toContainText('£7.00');
        await expect(page.getByTestId('total-saved')).toContainText('£13.00');
        await expect(page.getByTestId('ways-to-earn')).toHaveCount(0);

        await page.getByRole('tab', { name: 'My referrals' }).click();
        await expect(page.getByTestId('referral-summary')).toContainText('Joined: 2 · Earned: 1 · Total earned: £5.00');
        await expect(page.getByTestId('referral-card-R_GBP_1')).toContainText('Sarah S.');
        await expect(page.getByTestId('referral-card-R_GBP_2')).toContainText('Musa I.');
        await expect(page.getByTestId('referral-card-R_USD_1')).toHaveCount(0);

        // 5. Switch selector to EUR (0 referrals, 0 balance): clean empty states across all 3 tabs
        await page.getByTestId('rewards-currency-select').click();
        await page.getByRole('option', { name: 'EUR', exact: true }).click();
        await expect(page.getByTestId('referral-summary')).toHaveCount(0);
        await expect(page.getByText('No referrals yet. Share your link to start earning.')).toBeVisible();

        await page.getByRole('tab', { name: 'Overview' }).click();
        await expect(page.getByTestId('bonus-totals')).toContainText('€0.00');
        await expect(page.getByTestId('total-saved')).toContainText('€0.00');

        await page.getByRole('tab', { name: 'History' }).click();
        await expect(page.getByTestId('bonus-history')).toHaveCount(0);
        await expect(page.getByText('No rewards yet. Invite friends or use a promo code to start saving.')).toBeVisible();
    });

    test('[REF-24] Referee welcome bonus copy, referral code hook, and referralHelpText matching DEC-2026-11-16-REFEREE-SIGNUP-BONUS', async ({ page }) => {
        // 1. Visit /ref/JOHN2880 with mocked valid referral code (on desktop, /ref/:code redirects straight to /sign-in-sign-up?mode=signup)
        await page.route('**/api/rewards/codes/**', (route) => route.fulfill(json({
            data: {
                code: 'JOHN2880',
                referrerFirstName: 'John',
                ruleId: 81,
                offer: {
                    rule_id: 81,
                    name: 'UK DEfault',
                    currency: 'GBP',
                    reward_type: 'BOTH',
                    referrer_reward: 10,
                    referee_reward: 5,
                    floor: 50,
                    qualification_window_days: 90,
                    bonus_validity_days: 90,
                },
                offers: [{
                    rule_id: 81,
                    name: 'UK DEfault',
                    currency: 'GBP',
                    reward_type: 'BOTH',
                    referrer_reward: 10,
                    referee_reward: 5,
                    floor: 50,
                    qualification_window_days: 90,
                    bonus_validity_days: 90,
                }],
                sendCurrencies: ['GBP'],
                signedIn: false,
            }
        })));
        await page.route('**/api/rewards/visits', (route) => route.fulfill(json({ data: { counted: true } })));

        await page.goto('/ref/JOHN2880');
        await expect(page).toHaveURL(/sign-in-sign-up.*mode=signup/);

        // Verify headline: John invited you – get £5.00 bonus credit on joining via link.
        const invite = page.getByTestId('referral-invite');
        await expect(invite).toBeVisible();
        await expect(invite).toContainText('John invited you');
        await expect(invite).toContainText('bonus credit on joining via link');

        // Verify 3-step strip: Join · Send £50.00+ in 90 days · John gets £10.00
        await expect(invite).toContainText('Join');
        await expect(invite).toContainText('Send £50.00+ in 90 days');
        await expect(invite).toContainText('John gets £10.00');

        // Verify 3rd bullet
        await expect(invite).toContainText('£5.00 welcome bonus credit added automatically when you sign up using the link');

        // Verify referral-code-hook text in ReferralCodeField after email verification
        await page.getByPlaceholder('e.g. jamescollor@email.com').fill(`referee.hook.${Date.now()}@example.com`);
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByPlaceholder('000000').fill('123456');
        await page.getByRole('button', { name: 'Verify Code' }).click();

        await expect(page.getByTestId('referral-code-applied')).toBeVisible();
        await expect(page.getByTestId('referral-code-hook')).toContainText('You get £5.00 on sign-up (John gets £10.00 on your first successful transaction)');
    });
});
