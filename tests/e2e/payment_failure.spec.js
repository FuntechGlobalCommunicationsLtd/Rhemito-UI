import { test, expect } from '@playwright/test';

test.describe('Send Money — a payment that fails', () => {
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
    test('says so, and does not show the success message', async ({ page }) => {
        await page.route('**/api/send-money/transactions/*/pay', (route) => route.fulfill({
            status: 500, contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'The payment could not be recorded. Please try again.' } }),
        }));
        await page.goto('/send-money');
        await page.getByPlaceholder('0.00').first().fill('100');
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByText('Akshita', { exact: true }).first().click();
        await expect(page.getByText(/Recipient details/i).first()).toBeVisible();
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByTestId('beneficiary-review-summary')).toBeVisible({ timeout: 10000 });
        await page.getByRole('button', { name: 'Continue' }).click();

        await page.getByText('Instant Pay By Bank').click();
        await expect(page.getByText('Payment not completed').first()).toBeVisible();
        await expect(page.getByText('The payment could not be recorded. Please try again.').first()).toBeVisible();
        await expect(page.getByText('Success!')).toHaveCount(0);
    });
});
