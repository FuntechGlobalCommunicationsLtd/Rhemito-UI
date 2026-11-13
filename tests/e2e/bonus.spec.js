import { test, expect } from '@playwright/test';

/**
 * Bonus credit (one balance, tagged by how it was earned) — BONUS_MODULE_SPEC_RHEMITO.md §7 / §9.
 * Mito is mocked: the rewards summary supplies the wallet, /api/bonus/summary the live offers.
 */

const inDays = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
};

const bySource = [
    { credit_source: 'REFERRAL', label: 'Referrals', earned: 10, used: 6, expired: 0, removed: 0, available: 4 },
    { credit_source: 'SCHEME', label: 'Bonus offers', earned: 5, used: 2, expired: 0, removed: 0, available: 3 },
];

function summary({ blocked = false, debt = 0, offer = null } = {}) {
    return {
        customer: { id: 'user_123', referralCode: 'JOHN2880', currency: 'GBP' },
        currency: 'GBP',
        offer,
        wallet: {
            bonus_blocked: blocked,
            balances: [{ currency: 'GBP', available: 7, earned: 15, used: 8, expired: 0, used_transfer_count: 2, referral_credit_count: 1, other_credit_count: 1, outstanding_debt: debt, by_source: bySource }],
            unused: [
                { id: 's1', source: 'Loyal', credit_source: 'SCHEME', credit_source_label: 'Loyalty bonus – Loyal Sender', reason_code: 'SCHEME_REWARD', amount: 5, remaining: 3, currency: 'GBP', earned_on: '2026-09-12', expires_on: inDays(5), status: 'PARTLY_USED' },
                { id: 'r1', source: 'Referrer reward – referred Sarah S.', credit_source: 'REFERRAL', credit_source_label: 'Referral bonus – Sarah S.', reason_code: 'REFERRAL_REWARD', amount: 10, remaining: 4, currency: 'GBP', earned_on: '2026-10-01', expires_on: inDays(80), status: 'PARTLY_USED' },
            ],
            credits: [],
            history: [
                { id: 'r1', created_at: '2026-10-01T10:00:00Z', type: 'EARNED', reason_code: 'REFERRAL_REWARD', amount: 10, currency: 'GBP', notes: 'Referrer reward – referred Sarah S.', transfer_id: null, source_credit_id: null, credit_source: 'REFERRAL', credit_source_label: 'Referral bonus – Sarah S.' },
                { id: 's1', created_at: '2026-09-12T10:00:00Z', type: 'EARNED', reason_code: 'SCHEME_REWARD', amount: 5, currency: 'GBP', notes: 'Loyal', transfer_id: null, source_credit_id: null, credit_source: 'SCHEME', credit_source_label: 'Loyalty bonus – Loyal Sender' },
            ],
            promo_redemptions: [],
        },
        referrals: { data: [], summary: { joined: 0, earned_count: 0, total_earned: {} } },
        latestOffer: null,
    };
}

async function mock(page, { offers = [], bonusDown = false, ...opts } = {}) {
    await page.route('**/api/send-money/mito/beneficiaries**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
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
                            currency: 'NGN',
                            country: 'Nigeria',
                            countryIso3: 'NGA',
                        },
                    ],
                },
            }),
        }),
    );
    await page.route('**/api/rewards/summary**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: summary(opts) }) }));
    await page.route('**/api/promocodes/savings**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { items: [], saved: {} } }) }));
    await page.route('**/api/bonus/summary**', (route) =>
        bonusDown
            ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'BONUS_UNAVAILABLE', message: 'down' } }) })
            : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { currency: 'GBP', currencies: ['GBP'], blocked: opts.blocked ?? false, offers, wallet: summary(opts).wallet } }) }));
}

test.describe('Dashboard', () => {
    test('separate pills for referral bonus and bonus scheme credits, with total unused bonus, minimum transfer floor and expiry warning', async ({ page }) => {
        await mock(page, { offer: { floor: 50, text: 'Invite friends and get £10.00 bonus credit.', referral_link: 'http://localhost:5000/ref/JOHN2880' } });
        await page.goto('/');
        await expect(page.getByTestId('dashboard-total-unused-bonus')).toContainText('£7.00');
        const refPill = page.getByTestId('referral-bonus-earned-pill');
        await expect(refPill).toContainText('Referral bonus');
        await expect(refPill).toContainText('£4.00');
        await expect(refPill).toContainText('Minimum transfer £50.00');
        const schemePill = page.getByTestId('bonus-earned-pill');
        await expect(schemePill).toContainText('Bonus credit');
        await expect(schemePill).toContainText('£3.00');
        await expect(page.getByTestId('bonus-pill-expiring')).toContainText('£3.00 expires in 5 days');
    });

    test('blocked customers see the notice', async ({ page }) => {
        await mock(page, { blocked: true });
        await page.goto('/');
        await expect(page.getByTestId('bonus-blocked-notice')).toContainText("You're not qualified to get bonus");
    });
});

test.describe('Bonus & Discounts', () => {
    test('shows how the balance was earned, adding up to the tiles', async ({ page }) => {
        await mock(page);
        await page.goto('/bonus-discounts');
        const rows = page.getByTestId('bonus-breakdown');
        await expect(rows.getByTestId('breakdown-REFERRAL')).toContainText('Earned £10.00 · £4.00 left');
        await expect(rows.getByTestId('breakdown-SCHEME')).toContainText('Earned £5.00 · £3.00 left');
        await expect(page.getByTestId('bonus-totals')).toContainText('From 2 bonuses');
        await expect(page.getByTestId('unused-bonus')).toContainText('Loyalty bonus – Loyal Sender');
        await expect(page.getByTestId('unused-bonus').getByTestId('source-chip').first()).toContainText('Bonus offers');
    });

    test('View applies a source filter to the lists but never to the tiles', async ({ page }) => {
        await mock(page);
        await page.goto('/bonus-discounts');
        await page.getByRole('button', { name: 'View Referrals' }).click();
        const list = page.getByTestId('bonus-history');
        await expect(list).toContainText('Referral bonus – You earned from referring Sarah S.');
        await expect(list).not.toContainText('Loyalty bonus');
        await page.getByRole('tab', { name: 'Overview' }).click();
        await expect(page.getByTestId('bonus-totals')).toContainText('£15.00');
        await expect(page.getByTestId('source-filter-note')).toContainText('Showing Referrals only');
        await page.getByRole('button', { name: 'Show all' }).click();
        await expect(page.getByTestId('unused-bonus')).toContainText('Loyalty bonus');
    });

    test('?source=REFERRAL preselects the filter', async ({ page }) => {
        await mock(page);
        await page.goto('/bonus-discounts?tab=history&source=REFERRAL');
        const list = page.getByTestId('bonus-history');
        await expect(list).toContainText('Referral bonus – You earned from referring Sarah S.');
        await expect(list).not.toContainText('Loyalty bonus');
    });

    test('outstanding repayment line', async ({ page }) => {
        await mock(page, { debt: 3 });
        await page.goto('/bonus-discounts');
        await expect(page.getByTestId('bonus-outstanding')).toContainText('£3.00 of future bonus will go towards bonus that was removed');
    });

    test('Ways to earn lists live offers, and is hidden when the service is down or the customer is blocked', async ({ page }) => {
        const offers = [{ id: 1, name: 'Send 3, get £10', type: 'LOYALTY', currency: 'GBP', summary: 'Complete 3 transfers within 30 days and get £10.00 bonus credit.', end_date: '2027-01-31', end_date_display: '31/01/2027' }];
        await mock(page, { offers });
        await page.goto('/bonus-discounts');
        const ways = page.getByTestId('ways-to-earn');
        await expect(ways).toContainText('Complete 3 transfers within 30 days and get £10.00 bonus credit.');
        await expect(ways).toContainText('Ends 31/01/2027');

        await page.unroute('**/api/bonus/summary**');
        await mock(page, { offers, blocked: true });
        await page.goto('/bonus-discounts');
        await expect(page.getByTestId('bonus-blocked-notice')).toBeVisible();
        await expect(page.getByTestId('ways-to-earn')).toHaveCount(0);
    });

    test('still renders when the bonus service is down', async ({ page }) => {
        await mock(page, { bonusDown: true });
        await page.goto('/bonus-discounts');
        await expect(page.getByTestId('bonus-totals')).toContainText('£7.00');
        await expect(page.getByTestId('ways-to-earn')).toHaveCount(0);
    });
});

test.describe('Send Money — use your bonus', () => {
    test('shows what the balance is made of, has no minimum, and labels the summary row', async ({ page }) => {
        await mock(page);
        await page.goto('/send-money');
        await page.getByPlaceholder('0.00').first().fill('5');
        await page.getByTestId('step1-use-bonus-btn').click();
        const card = page.getByTestId('bonus-redemption');
        await expect(card).toContainText('£3.00 available', { timeout: 15000 });
        await expect(card).toContainText('Bonus offer credit');
        await expect(page.getByTestId('bonus-below-min')).toHaveCount(0);
        await expect(card).toContainText('Save £3.00 now');
        await page.getByRole('radio', { name: /Pay less/ }).check();
        await expect(page.getByTestId('summary-bonus-step1')).toContainText('£3.00');
        await page.getByRole('radio', { name: /Send more/ }).check();
        await expect(page.getByTestId('summary-bonus-step1')).toContainText('+ £3.00');
    });

    test('the choice travels with the payment, and a changed balance stops it', async ({ page }) => {
        await mock(page);
        await page.route('**/api/send-money/transactions/*/pay', async (route) => {
            const sent = route.request().postDataJSON();
            expect(sent.bonusCredit).toEqual({ mode: 'pay_less', amount: '3.00' });
            await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'BONUS_CHANGED', message: 'Your bonus balance has changed. Please review your transfer.' } }) });
        });
        await page.goto('/send-money');
        await page.getByPlaceholder('0.00').first().fill('500');
        await page.getByTestId('step1-use-bonus-btn').click();
        await expect(page.getByTestId('bonus-redemption')).toContainText('£3.00 available', { timeout: 15000 });
        await page.getByRole('radio', { name: /Pay less/ }).check();
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByText('Akshita', { exact: true }).first().click();
        await expect(page.getByText('Recipient Details').first()).toBeVisible();
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByText('Credit/Debit Card').click();
        await expect(page.getByText('Your bonus balance has changed. Please review your transfer.').first()).toBeVisible();
        await expect(page.getByTestId('summary-bonus')).toHaveCount(0);
    });
});

test.describe('Send money — bonus on landing', () => {
    test('bonus is offered on the Amount step and the choice reaches payment', async ({ page }) => {
        await mock(page);
        await page.goto('/send-money');
        await page.getByTestId('step1-use-referral-btn').click();
        const panel = page.getByTestId('bonus-redemption');
        await expect(panel).toBeVisible();
        await expect(panel).toContainText('£4.00 available');
        await panel.getByText('Pay less').click();
        await expect(page.getByTestId('summary-bonus-step1')).toContainText('- £4.00');
    });
});
