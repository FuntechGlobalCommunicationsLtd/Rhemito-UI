import { test, expect } from '@playwright/test';

test.describe('Rhemito Send Money Flow', () => {
    // Isolate from live Mito Staging beneficiaries: serve one fully-populated saved beneficiary (same shape as staging_payment_gateway.spec.js)
    test.beforeEach(async ({ page }) => {
        await page.route('**/api/send-money/mito/beneficiaries*', (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        configured: true,
                        beneficiaries: [{
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
                        }],
                    },
                }),
            });
        });
    });

    test('Navigate to Send Money page', async ({ page }) => {
        await page.goto('/send-money');

        // Verify page loaded
        await expect(page).toHaveURL(/\/send-money/);

        // Verify amount input is present
        await expect(page.getByPlaceholder('0.00').first()).toBeVisible();
    });

    test('Step 1 - Enter amount and continue', async ({ page }) => {
        await page.goto('/send-money');

        // Enter amount
        await page.getByPlaceholder('0.00').first().fill('100');

        // Click Continue
        await page.getByRole('button', { name: 'Continue' }).click();

        // Verify moved to next step (Recipient selection)
        await expect(page.getByText(/Who are you sending to/i)).toBeVisible({ timeout: 5000 });
    });

    test('Full Send Money flow - Step 1 to Step 2 (Saved list, Bank picker & Recipient details)', async ({ page }) => {
        await page.goto('/send-money');

        // Step 1: Amount
        await page.getByPlaceholder('0.00').first().fill('500');
        await page.getByRole('button', { name: 'Continue' }).click();

        // Step 2A: Saved recipient list (Direction 3A reference 2-line recipient row layout)
        await expect(page.getByText(/Who are you sending to/i)).toBeVisible();
        const recipientList = page.getByTestId('send-money-recipient-list');
        await expect(recipientList).toBeVisible();
        const row = recipientList.getByTestId('recipient-row-11111111-2222-3333-4444-555555555555');
        await expect(row).toContainText('Akshita');
        await expect(row).toContainText('United Bank for Africa Plc (UBA)');
        await expect(row).toContainText('Bank deposit');
        await expect(row).toContainText('1018316888');

        // Step 2B: Click New recipient -> opens Delivery method & Bank picker
        await page.getByTestId('button-new-recipient').click();
        await expect(page.getByText(/Please select the recipient's bank/i)).toBeVisible({ timeout: 8000 });
        await page.locator('[data-testid^="provider-option-"]').first().click();

        // Step 2C: Verify moved to Recipient details with Back to banks
        await expect(page.getByText(/Recipient details/i).first()).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('button', { name: /Back to banks/i })).toBeVisible();
    });

    test('Complete Send Money flow (5-Step: Amount -> Recipient -> Summary -> Payment method)', async ({ page }) => {
        await page.goto('/send-money');

        // Step 1: Amount
        await page.getByPlaceholder('0.00').first().fill('500');
        await page.getByRole('button', { name: 'Continue' }).click();

        // Step 2: Saved Recipient (smart-skips Step 3 Bank -> Step 4 Summary)
        await expect(page.getByText(/Who are you sending to/i)).toBeVisible();
        await page.getByText('Akshita', { exact: true }).first().click();

        // Step 2C: Recipient details (prefilled) -> Continue to Step 4 Summary
        await expect(page.getByText(/Recipient details/i).first()).toBeVisible();
        await page.getByRole('button', { name: 'Continue' }).click();

        // Step 4: Summary -> Continue submits the real server-owned transaction
        await expect(page.getByTestId('beneficiary-review-summary')).toBeVisible({ timeout: 10000 });
        await page.getByRole('button', { name: 'Continue' }).click();

        // Step 5: Payment method
        await expect(page.getByText('How would you like to pay?')).toBeVisible({ timeout: 15000 });
        await expect(page.getByText('Instant Pay By Bank')).toBeVisible();
    });

    test('Wizard transaction appears on the Dashboard and can be cancelled without a refresh', async ({ page }) => {
        await page.goto('/send-money');

        // Step 1: Amount
        await page.getByPlaceholder('0.00').first().fill('100');
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByText(/Who are you sending to/i)).toBeVisible({ timeout: 5000 });

        // Step 2: Pick a known recipient -> details -> Summary
        await page.getByText('Akshita', { exact: true }).first().click();
        await expect(page.getByText(/Recipient details/i).first()).toBeVisible();
        await page.getByRole('button', { name: 'Continue' }).click();

        // Step 4: Summary -> Continue creates the real transaction (awaiting_payment)
        await expect(page.getByTestId('beneficiary-review-summary')).toBeVisible({ timeout: 10000 });
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByText('How would you like to pay?')).toBeVisible({ timeout: 15000 });

        // The Dashboard unified table shows the new TXN row
        await page.goto('/');
        const row = page.locator('[data-testid^="row-transaction-TXN-"]').first();
        await expect(row).toBeVisible({ timeout: 15000 });
        const ref = (await row.getAttribute('data-testid')).replace('row-transaction-', '');

        // Cancel from the Dashboard — the row flips to Cancelled via the real API
        await page.getByTestId(`button-cancel-${ref}`).click();
        await page.getByTestId('button-confirm-cancel').click();
        await expect(page.getByTestId(`row-transaction-${ref}`).getByText('Cancelled')).toBeVisible({ timeout: 15000 });
    });

});
