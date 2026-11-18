import { test, expect } from '@playwright/test';

test.describe('Rhemito Dashboard', () => {

    test('Dashboard loads correctly with Sentence-case headings, Welcome bold name, and Header cluster', async ({ page }) => {
        // Navigate to Dashboard
        await page.goto('/');

        // Verify page title
        await expect(page).toHaveTitle(/Rhemito/i);

        // Verify PD-03: non-bold "Welcome" (400) + bold signed-in/demo name (700)
        const welcome = page.getByTestId('dashboard-welcome');
        await expect(welcome).toBeVisible();
        await expect(welcome).toContainText('Welcome ');
        await expect(welcome).toHaveCSS('font-weight', '400');
        const boldName = welcome.locator('span.font-bold');
        await expect(boldName).toBeVisible();
        await expect(boldName).toHaveCSS('font-weight', '700');

        // Verify Account summary and Quick service widgets are visible
        await expect(page.getByTestId('section-account-summary')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Quick service' })).toBeVisible();

        // Verify Quick service buttons are present in Sentence case (preserving Reward$)
        await expect(page.getByTestId('button-send-money')).toHaveText('Send money');
        await expect(page.getByTestId('button-request-payment')).toHaveText('Receive money');
        await expect(page.getByTestId('button-bonus-discounts')).toHaveText('Reward$');

        // PD-01: Inline search box is removed from Dashboard Recent transactions header
        await expect(page.getByTestId('input-search-transactions')).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Recent transactions' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'See all' })).toBeVisible();

        // Verify unified Transactions table with its Sentence-case type filter chips
        await expect(page.getByTestId('table-transactions')).toBeVisible();
        await expect(page.getByTestId('chip-type-all')).toBeVisible();
        await expect(page.getByTestId('chip-type-send-money')).toContainText('Send money');
        await expect(page.getByTestId('chip-type-receive-money')).toContainText('Receive money');
        await expect(page.getByTestId('chip-type-invoice')).toContainText('Invoices');
        await expect(page.getByTestId('chip-type-campaign')).toContainText('Campaigns');
    });

    test('Quick Services - Send Money navigation', async ({ page }) => {
        await page.goto('/');

        // Click Send money button
        await page.getByTestId('button-send-money').click();

        // Verify navigation to Send money page
        await expect(page).toHaveURL(/\/send-money/);
    });

    test('Quick Services - Receive Money opens the payment link flow directly', async ({ page }) => {
        await page.goto('/');

        // The button leads straight to the Receive money link flow (no modal)
        await page.getByTestId('button-request-payment').click();
        await expect(page).toHaveURL(/\/request-payment/);
        await expect(page.getByRole('heading', { name: 'Receive money' })).toBeVisible();
    });

    test('Quick Services - Send Invoice and Funding Campaigns have direct buttons', async ({ page }) => {
        await page.goto('/');

        // Direct entries sit on the Quick service card beside the primary buttons
        const sendInvoice = page.getByTestId('button-send-invoice');
        const funding = page.getByTestId('button-funding-campaigns');
        await expect(sendInvoice).toHaveText('Send invoice');
        await expect(funding).toHaveText('Fund campaigns');

        // The modal no longer exists on the dashboard
        await expect(page.getByText('Ways to get paid')).toHaveCount(0);

        await sendInvoice.click();
        await expect(page).toHaveURL(/\/send-invoice/);
        await expect(page.getByRole('heading', { name: 'Send invoice' })).toBeVisible();

        await page.goto('/');
        await funding.click();
        await expect(page).toHaveURL(/\/group-pay\/create/);
    });

    test('Dashboard Recent transactions table formats Date GMT tooltip, Amount symbol, centered Actions, and See all search', async ({ page }) => {
        await page.goto('/');

        const table = page.getByTestId('table-transactions');
        await expect(table).toBeVisible();

        // Verify Sentence-case table column headers
        for (const col of ['Order no', 'Date', 'Name', 'Service', 'Amount', 'Status', 'Actions']) {
            await expect(table.getByRole('columnheader', { name: col, exact: true })).toBeVisible();
        }

        // Verify first desktop row has <Symbol> <2dp> Amount format, HH:mm GMT Date tooltip, and centered Actions
        const firstRow = table.locator('tbody tr').first();
        await expect(firstRow).toBeVisible();

        const amountCell = firstRow.locator('td').nth(4);
        await expect(amountCell).toHaveText(/^(£|\$|€|₦|CA\$|A\$)\s[\d,]+\.\d{2}$/);

        const dateTrigger = firstRow.locator('td').nth(1).locator('[tabindex="0"]');
        await dateTrigger.hover();
        await expect(page.getByRole('tooltip')).toHaveText(/^\d{2}:\d{2} GMT$/);

        const actionsHeader = table.getByRole('columnheader', { name: 'Actions', exact: true });
        await expect(actionsHeader).toHaveCSS('text-align', 'center');

        // Clicking See all opens /transactions where full search locates seeded rows
        await page.getByRole('button', { name: 'See all' }).click();
        await expect(page).toHaveURL(/\/transactions/);

        const search = page.getByTestId('input-search-transactions');
        await search.fill('22502784');
        await expect(page.getByTestId('row-transaction-22502784')).toBeVisible();

        // Verify Resend button is present on completed transaction
        await search.fill('22502785');
        await expect(page.getByTestId('button-resend-22502785')).toBeVisible();
    });

    test('Transaction type filters narrow the unified table on Dashboard and /transactions', async ({ page }) => {
        // Check Dashboard chip switching first
        await page.goto('/');
        await page.getByTestId('chip-type-send-money').click();
        await expect(page.getByTestId('chip-type-send-money')).toHaveClass(/bg-blue-600/);
        await page.getByTestId('chip-type-invoice').click();
        await expect(page.getByTestId('chip-type-invoice')).toHaveClass(/bg-blue-600/);

        // Use /transactions search + type chips so other specs' rows cannot push seeded rows off page 1
        await page.goto('/transactions');
        const search = page.getByTestId('input-search-transactions');
        await search.fill('22502784');
        await expect(page.getByTestId('row-transaction-22502784')).toBeVisible();

        // Send money chip keeps the send-money rows
        await page.getByTestId('chip-type-send-money').click();
        await expect(page.getByTestId('row-transaction-22502784')).toBeVisible();
        await search.fill('SCH001');
        await expect(page.getByTestId('row-scheduled-SCH001')).toBeVisible();

        // Invoices chip hides the send-money prototype rows
        await search.fill('22502784');
        await page.getByTestId('chip-type-invoice').click();
        await expect(page.getByTestId('row-transaction-22502784')).toBeHidden();
    });

    test('Transaction search narrows the unified table via See all (/transactions)', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('button', { name: 'See all' }).click();
        await expect(page).toHaveURL(/\/transactions/);

        await page.getByTestId('input-search-transactions').fill('Aisha Bello');
        await expect(page.getByTestId('row-transaction-22502787')).toBeVisible();
        await expect(page.getByTestId('row-transaction-22502784')).toBeHidden();

        // Searching for another seeded row brings it back (independent of paging)
        await page.getByTestId('input-search-transactions').fill('22502784');
        await expect(page.getByTestId('row-transaction-22502784')).toBeVisible();
    });

    test('Unified table paginates at 20 records max per page across all types', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId('chip-type-all')).toBeVisible();

        // Seeded demo data spans send money, receive money, invoices and campaigns (22+ rows)
        const rows = page.locator('[data-testid^="row-transaction-"], [data-testid^="row-scheduled-"], [data-testid^="row-receive_money-"], [data-testid^="row-invoice-"], [data-testid^="row-campaign-"]');
        await expect(rows).toHaveCount(20, { timeout: 10000 });
        await expect(page.getByTestId('transactions-pagination')).toContainText('Page 1 of');

        // Page 2 holds the remainder
        await page.getByTestId('button-next-page').click();
        await expect(rows.first()).toBeVisible();
        expect(await rows.count()).toBeGreaterThan(0);
        // Other specs add rows to the shared server, so only assert the page cap.
        expect(await rows.count()).toBeLessThanOrEqual(20);
        await expect(page.getByTestId('transactions-pagination')).toContainText('Page 2 of');

        // Back to page 1
        await page.getByTestId('button-prev-page').click();
        await expect(rows).toHaveCount(20);
    });

    test('Account summary uses reference pastel scheme, bold Sentence-case heading, and clean Reward$ sidebar item', async ({ page }) => {
        await page.goto('/');

        const summarySection = page.getByTestId('section-account-summary');
        await expect(summarySection).toBeVisible();

        const heading = summarySection.getByRole('heading', { name: 'Account summary' });
        await expect(heading).toHaveCSS('font-weight', '700');
        await expect(summarySection).toContainText('Total sent');
        await expect(summarySection).toContainText('Wallet balance');
        await expect(summarySection).toContainText('Payment account');

        // Verify exact reference pastel backgrounds (#FFEDE7, #E5F1FE, #E0EED6)
        const totalSentCard = summarySection.locator('> div > div').first();
        const walletCard = page.getByTestId('card-wallet-balance');
        const collectionCard = page.getByTestId('card-collection-account');
        await expect(totalSentCard).toHaveCSS('background-color', 'rgb(255, 237, 231)');
        await expect(walletCard).toHaveCSS('background-color', 'rgb(229, 241, 254)');
        await expect(collectionCard).toHaveCSS('background-color', 'rgb(224, 238, 214)');

        // Non-zero interactive summary cards highlight with surface-harmonized borders on hover (Direction 2A + Scope S1)
        await walletCard.hover();
        await expect(walletCard).toHaveCSS('border-top-color', 'rgb(91, 155, 248)');
        await collectionCard.hover();
        await expect(collectionCard).toHaveCSS('border-top-color', 'rgb(88, 169, 106)');

        // Verify 'NEW' tag and 'Rewards waiting!' subtext are removed from Sidebar Reward$
        await expect(page.getByTestId('rewards-waiting-badge')).toHaveCount(0);
        await expect(page.getByText('Rewards waiting!')).toHaveCount(0);
    });

    test('Wallet balance and Payment account cards open /overview/collectionaccount tabs cleanly', async ({ page }) => {
        await page.goto('/');

        // Interacting with GBP currency selector inside Wallet balance card does NOT navigate away
        const walletCard = page.getByTestId('card-wallet-balance');
        await walletCard.getByRole('combobox').click();
        await expect(page).toHaveURL('/');
        await page.keyboard.press('Escape');

        // Clicking Wallet balance card opens /overview/collectionaccount?tab=wallet on Wallets tab
        await walletCard.click();
        await expect(page).toHaveURL(/\/overview\/collectionaccount\?tab=wallet$/);
        await expect(page.getByTestId('heading-collection-account')).toHaveText('Payment account');
        await expect(page.getByTestId('tab-collection-accounts')).toHaveText('Payments account');
        await expect(page.getByTestId('panel-wallets')).toBeVisible();
        await expect(page.getByTestId('wallet-details-heading')).toHaveText('Below are the details of your GBP wallet');
        await expect(page.getByTestId('wallet-detail-balance')).toContainText('GBP 253,007.92');
        await expect(page.getByTestId('wallet-detail-amount-sent')).toContainText('GBP 750,895.75');
        await expect(page.getByTestId('wallet-detail-tx-count')).toHaveText('89');

        // Switching wallet currency updates right panel
        await page.getByTestId('wallet-currency-ngn').click();
        await expect(page.getByTestId('wallet-details-heading')).toHaveText('Below are the details of your NGN wallet');
        await expect(page.getByTestId('wallet-detail-balance')).toHaveText('NGN 0.00');

        // Switching to Payments account tab updates URL & shows bank details
        await page.getByTestId('tab-collection-accounts').click();
        await expect(page).toHaveURL(/\/overview\/collectionaccount$/);
        await expect(page.getByTestId('panel-collection-accounts')).toBeVisible();
        await expect(page.getByTestId('collection-details-heading')).toHaveText(
            'Below are the details of your British Pounds payments account'
        );
        await expect(page.getByText('The Currency Cloud Limited')).toBeVisible();

        // Switching collection currency to USD updates right panel
        await page.getByTestId('collection-currency-usd').click();
        await expect(page.getByTestId('collection-details-heading')).toHaveText(
            'Below are the details of your US Dollars payments account'
        );

        // Back button returns to Dashboard Overview
        await page.getByTestId('button-back-overview').click();
        await expect(page).toHaveURL('/');

        // Clicking Payment account card on Dashboard opens /overview/collectionaccount directly
        await page.getByTestId('card-collection-account').click();
        await expect(page).toHaveURL(/\/overview\/collectionaccount$/);
        await expect(page.getByTestId('panel-collection-accounts')).toBeVisible();

        // View Transaction History navigates to /transactions
        await page.getByTestId('link-view-transaction-history').click();
        await expect(page).toHaveURL(/\/transactions/);
    });

});
