import { test, expect } from '@playwright/test';

// Senders and Recipients were consolidated into one page: the sidebar's
// top-level "Senders & Recipients" entry opens /senders-recipients and the
// recipients list lives behind the Recipients tab (?tab=recipients).
const RECIPIENTS_URL = '/senders-recipients?tab=recipients';

test.describe('Recipients page', () => {
    // Isolate from live Mito Staging beneficiaries: use the local (unconfigured) recipient fallback
    test.beforeEach(async ({ page }) => {
        await page.route('**/api/send-money/mito/beneficiaries*', (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ data: { configured: false, beneficiaries: [] } }),
            });
        });
    });

    test('Sidebar Recipients link opens /senders-recipients?tab=recipients directly', async ({ page }) => {
        await page.goto('/');

        await page.getByTestId('link-recipients').click();

        await expect(page).toHaveURL(/\/senders-recipients\?tab=recipients/);
        await expect(page.getByTestId('table-recipients')).toBeVisible();
    });

    test('Renders seeded recipients with name, unique code and account number', async ({ page }) => {
        await page.goto(RECIPIENTS_URL);

        await expect(page.getByTestId('table-recipients')).toBeVisible();
        const firstRow = page.getByTestId('row-recipient-rec-001');
        await expect(firstRow).toBeVisible();
        await expect(firstRow).toContainText('Ngozi Eze');
        await expect(firstRow).toContainText('482913');
        await expect(firstRow).toContainText('0123456789');
        await expect(firstRow).toContainText('Nigeria');
        await expect(firstRow).toContainText('Bank Deposit');
    });

    test('Search filters recipients by name and by country', async ({ page }) => {
        await page.goto(RECIPIENTS_URL);

        const search = page.getByTestId('input-search-recipients');
        await search.fill('Ngozi');

        await expect(page.getByTestId('row-recipient-rec-001')).toBeVisible();
        await expect(page.getByTestId('row-recipient-rec-002')).toHaveCount(0);

        await search.fill('Kenya');
        await expect(page.getByTestId('row-recipient-rec-006')).toBeVisible();
        await expect(page.getByTestId('row-recipient-rec-001')).toHaveCount(0);

        // Unknown term shows the empty state
        await search.fill('zzz-not-a-recipient');
        await expect(page.getByTestId('empty-recipients')).toBeVisible();
    });

    test('Sorting by full name reorders the table', async ({ page }) => {
        await page.goto(RECIPIENTS_URL);

        await page.getByTestId('button-sort-name').click();

        const firstRow = page.locator('[data-testid^="row-recipient-"]').first();
        await expect(firstRow).toContainText('Aisha Kimani');

        // Toggling to descending flips the order
        await page.getByTestId('button-sort-name').click();
        await expect(page.locator('[data-testid^="row-recipient-"]').first()).toContainText('Sophie Dubois');
    });

    test('Pagination pages through recipients and respects the page size selector', async ({ page }) => {
        await page.goto(RECIPIENTS_URL);

        // 12 seeded recipients at 10 per page → 2 pages
        await expect(page.locator('[data-testid^="row-recipient-"]')).toHaveCount(10);
        await expect(page.getByTestId('button-prev-page')).toBeDisabled();
        await expect(page.getByTestId('button-next-page')).toBeEnabled();

        await page.getByTestId('button-next-page').click();
        await expect(page.locator('[data-testid^="row-recipient-"]')).toHaveCount(2);
        await expect(page.getByText('Page 2 of 2')).toBeVisible();
        await expect(page.getByTestId('input-page-number')).toHaveValue('2');
        await expect(page.getByTestId('button-prev-page')).toBeEnabled();

        // Page number input jumps back to page 1
        await page.getByTestId('input-page-number').fill('1');
        await expect(page.locator('[data-testid^="row-recipient-"]')).toHaveCount(10);

        // Show 50 fits everyone on one page
        await page.getByTestId('select-page-size').click();
        await page.getByRole('option', { name: '50' }).click();
        await expect(page.locator('[data-testid^="row-recipient-"]')).toHaveCount(12);
        await expect(page.getByText('Showing 1–12 of 12 recipients')).toBeVisible();
    });

    test('Add Recipient wizard creates a new recipient with Nigeria narration & bank verification', async ({ page }) => {
        await page.goto(RECIPIENTS_URL);

        await page.getByTestId('button-add-recipient').click();
        await expect(page).toHaveURL(/\/beneficiaries\/add/);

        // Stage 1: Nigeria + Bank deposit + Individual -> Continue
        await expect(page.getByTestId('select-beneficiary-country')).toBeVisible();
        await page.getByTestId('button-stage1-continue').click();

        // Stage 2A: Provider picker -> select first Nigerian bank
        await expect(page.getByTestId('beneficiary-stage-2-provider')).toBeVisible({ timeout: 8000 });
        await page.locator('[data-testid^="provider-option-"]').first().click();

        // Stage 2B: Fill mandatory personal, relationship, reason, narration (NGN) & banking details
        await expect(page.getByTestId('beneficiary-stage-2-details')).toBeVisible();
        await page.getByTestId('input-beneficiary-first-name').fill('Test');
        await page.getByTestId('input-beneficiary-last-name').fill('Recipient');
        await page.getByTestId('select-beneficiary-relationship').click();
        await page.getByRole('option', { name: 'Family', exact: true }).click();
        await page.getByTestId('select-beneficiary-reason').click();
        await page.getByRole('option', { name: /Family support/i }).click();
        const mobileInput = page.getByTestId('input-beneficiary-mobile');
        if (await mobileInput.isVisible()) {
            await mobileInput.fill('8031234567');
        }
        await page.getByTestId('input-beneficiary-narration').fill('Test narration');
        await page.getByTestId('input-beneficiary-account-number').fill('0987654321');

        // Search bank details unlocks Continue
        await page.getByTestId('button-search-bank-details').click();
        await expect(
            page.getByTestId('card-verified-bank-holder').or(page.getByTestId('card-unverified-bank-notice')),
        ).toBeVisible({ timeout: 10000 });

        await page.getByRole('button', { name: 'Continue' }).click();

        // Stage 3: Summary -> Save
        await expect(page.getByTestId('beneficiary-review-summary')).toBeVisible({ timeout: 8000 });
        await page.getByTestId('button-save-beneficiary').click();

        // Stage 4: Recipient added successfully -> Done returns to Recipients directory
        await expect(page.getByText('Recipient added successfully')).toBeVisible({ timeout: 10000 });
        await page.getByTestId('button-success-done').click();

        await expect(page).toHaveURL(/\/senders-recipients\?tab=recipients/);
        await page.getByTestId('input-search-recipients').fill('Test Recipient');
        await expect(page.locator('[data-testid^="row-recipient-"]').first()).toContainText('Test Recipient');
    });

    test('Consolidates sender and recipient by email as a single record with dual-role badge', async ({ page }) => {
        // Fatima Hassan is seeded in both senders and recipients with email fatima.h@company.ng
        await page.goto('/senders-recipients?tab=recipients');

        // Search for Fatima in recipients panel
        await page.getByTestId('input-search-recipients').fill('Fatima');
        const fatimaRecipientRow = page.getByTestId('panel-recipients').locator('tr:has-text("Fatima Hassan")');
        await expect(fatimaRecipientRow).toBeVisible();
        await expect(fatimaRecipientRow).toContainText('Sender & Recipient');

        // Switch to senders tab
        await page.getByTestId('tab-senders').click();
        const fatimaSenderRow = page.getByTestId('panel-senders').locator('tr:has-text("Fatima Hassan")');
        await expect(fatimaSenderRow).toBeVisible();
        await expect(fatimaSenderRow).toContainText('Sender & Recipient');
    });

    test('Delete Recipient flow removes the row after confirmation', async ({ page }) => {
        await page.goto(RECIPIENTS_URL);

        await page.getByTestId('button-delete-rec-002').click();
        await expect(page.getByText('Delete Recipient?')).toBeVisible();

        await page.getByTestId('button-confirm-delete').click();

        await expect(page.getByTestId('row-recipient-rec-002')).toHaveCount(0);
        await expect(page.getByText('Recipient deleted', { exact: true })).toBeVisible();
    });

    test('View Recipient opens /beneficiaries/:id 3-column detail page and Send money navigates', async ({ page }) => {
        await page.goto(RECIPIENTS_URL);

        await page.getByTestId('button-view-rec-002').click();
        await expect(page).toHaveURL(/\/beneficiaries\/rec-002/);
        await expect(page.getByTestId('card-personal-details')).toBeVisible();
        await expect(page.getByTestId('card-banking-details')).toContainText('Barclays');
        await expect(page.getByTestId('card-banking-details')).toContainText('20-45-67');
        await expect(page.getByTestId('card-services-details')).toBeVisible();

        await page.getByTestId('button-detail-send-money').click();
        await expect(page).toHaveURL(/\/send-money/);
    });

    test('Row send action navigates to Send Money', async ({ page }) => {
        await page.goto(RECIPIENTS_URL);

        await page.getByTestId('button-send-rec-001').click();
        await expect(page).toHaveURL(/\/send-money/);
    });

    test('Add Sender creates a new sender and viewing shows their detail page with full info and DOB', async ({ page }) => {
        await page.goto('/senders-recipients?tab=senders');

        await page.getByTestId('button-add-sender').click();
        await expect(page.getByTestId('input-new-first-name')).toBeVisible();

        await page.getByTestId('input-new-first-name').fill('Sarah');
        await page.getByTestId('input-new-last-name').fill('Connor');
        await page.getByTestId('input-new-email').fill('sarah.connor@test.com');
        await page.getByTestId('input-new-phone').fill('7123456789');
        await page.getByTestId('input-new-dob').fill('1985-02-28');

        await page.getByTestId('button-confirm-add-sender').click();
        await expect(page.getByText('Sender added successfully!')).toBeVisible();

        // New sender appears in table
        const senderRow = page.locator('tr:has-text("Sarah Connor")');
        await expect(senderRow).toBeVisible();

        // Click View on newly created sender
        await page.getByTestId('button-view-sarah-connor-test-com').click();
        await expect(page).toHaveURL(/\/senders\/sarah\.connor%40test\.com$/);

        // Verify full sender detail view with DOB
        await expect(page.getByText('SARAH CONNOR')).toBeVisible();
        await expect(page.getByText('sarah.connor@test.com')).toBeVisible();
        await expect(page.getByText('1985-02-28')).toBeVisible();

        // Delete sender from detail view
        await page.getByTestId('button-delete').click();
        await expect(page.getByText('Delete Sender?')).toBeVisible();
        await page.getByTestId('button-confirm-delete').click();

        // Back on senders list and sender is removed
        await expect(page).toHaveURL(/\/senders-recipients\?tab=senders/);
        await expect(page.locator('tr:has-text("Sarah Connor")')).toHaveCount(0);
    });

});
