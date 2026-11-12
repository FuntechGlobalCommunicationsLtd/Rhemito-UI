import { test, expect } from '@playwright/test';

test.describe('Funding Campaigns', () => {

    test('Navigate to Funding Campaigns', async ({ page }) => {
        await page.goto('/group-pay');

        // Verify URL and Title
        await expect(page).toHaveURL(/\/group-pay/);
        await expect(page.getByRole('heading', { name: 'Funding Campaigns', exact: true })).toBeVisible();
    });

    test('Create a new campaign', async ({ page }) => {
        await page.goto('/group-pay');

        // Click Create button
        await page.getByRole('button', { name: 'Create Funding Campaign' }).first().click();
        await expect(page).toHaveURL(/\/group-pay\/create/);

        // Fill form
        await page.getByLabel('Campaign Name').fill('Test Office Party');
        await page.getByLabel('Description').fill('End to end test description');

        // Handle Target Amount
        await page.getByLabel('How much do you want to collect?').fill('100');

        // If payout account dialog is open or needs bank details
        const saveAccountBtn = page.getByTestId('button-save-account');
        if (await saveAccountBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await page.getByTestId('input-account-bank').fill('Barclays');
            await page.getByTestId('input-account-number').fill('12345678');
            await saveAccountBtn.click();
            await expect(saveAccountBtn).toBeHidden({ timeout: 10000 });
        }

        // Submit
        const submitBtn = page.getByRole('button', { name: 'Create Funding Campaign' });
        await expect(submitBtn).toBeEnabled({ timeout: 10000 });
        await submitBtn.click();

        // Should show success view
        await expect(page.getByRole('heading', { name: 'Campaign Created!' })).toBeVisible({ timeout: 10000 });
        await expect(page.getByRole('button', { name: 'View Campaign' })).toBeVisible();
    });

    test('Search and functionality', async ({ page }) => {
        await page.goto('/group-pay');

        // Verify Search input exists
        const searchInput = page.getByPlaceholder('Search campaigns...');
        await expect(searchInput).toBeVisible();

        // Type non-existent name
        await searchInput.fill('NonExistentCampaignXYZ');

        // Verify empty state
        // Note: Typo fixed in code "matching"
        await expect(page.getByText('No matching campaigns')).toBeVisible();

        // Clear search
        await page.getByRole('button', { name: 'Clear Filters' }).click();

        // Verify header is visible again. Using strict heading role to avoid matching text in other elements
        await expect(page.getByRole('heading', { name: 'Funding Campaigns', exact: true })).toBeVisible();
    });

    test('View Campaign Details', async ({ page }) => {
        await page.goto('/group-pay');

        // Wait for grid to load by ensuring header is present
        await expect(page.getByRole('heading', { name: 'Funding Campaigns', exact: true })).toBeVisible();

        // Click on the first "View" button found
        const viewButton = page.getByRole('button', { name: 'View' }).first();

        // Check if any campaign exists. If so, test the view.
        if (await viewButton.isVisible()) {
            await viewButton.click();
            await expect(page).toHaveURL(/\/group-pay\/.+/);
            // Check for the "Funds Overview" header card we added
            await expect(page.getByText('Funds Overview')).toBeVisible();
        }
    });

    test('Created campaign auto-reflects in the list without a refresh', async ({ page }) => {
        const api = page.context().request;
        const email = `gp-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
        await api.post('/api/auth/register', { data: {
            email, accountType: 'individual', country: 'GB', firstName: 'Gina', lastName: 'Pay',
            dateOfBirth: '1990-05-05', gender: 'female', mobileCode: '+44', mobileNumber: '7700900123',
            password: 'Passw0rd!x', confirmPassword: 'Passw0rd!x',
        } });
        const verify = await api.post('/api/auth/verify-otp', { data: { email, code: '123456' } });
        expect(verify.ok()).toBeTruthy();
        const account = await api.post('/api/request-money/payout-accounts', { data: {
            holderName: 'Gina Pay', country: 'GB', bankName: 'Barclays',
            accountNumber: `1234${Math.floor(1000 + Math.random() * 9000)}`, currency: 'GBP',
        } });
        expect(account.ok()).toBeTruthy();
        const accountId = (await account.json()).data.id;

        await page.goto('/group-pay');
        await expect(page.getByRole('heading', { name: 'Funding Campaigns', exact: true })).toBeVisible();

        // Campaign created out-of-band (as if from another tab or device)
        const campaignName = `Auto Reflect ${Date.now()}`;
        const res = await api.post('/api/group-pay/campaigns', { data: {
            name: campaignName,
            creatorName: 'Gina Pay',
            targetAmount: 250,
            currency: 'GBP',
            description: 'Auto-update e2e',
            bankAccountId: accountId,
            bankAccountName: 'Barclays',
        } });
        expect(res.ok()).toBeTruthy();

        // The already-open list picks the new campaign up via polling — no reload.
        await expect(page.getByRole('heading', { name: campaignName, exact: true })).toBeVisible({ timeout: 15000 });
    });

    test('Mandatory fields appear above optional Fixed Contribution Amount toggle', async ({ page }) => {
        const api = page.context().request;
        const email = `gp-order-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
        await api.post('/api/auth/register', { data: {
            email, accountType: 'individual', country: 'GB', firstName: 'Gina', lastName: 'Order',
            dateOfBirth: '1990-05-05', gender: 'female', mobileCode: '+44', mobileNumber: '7700900123',
            password: 'Passw0rd!x', confirmPassword: 'Passw0rd!x',
        } });
        await api.post('/api/auth/verify-otp', { data: { email, code: '123456' } });
        const account = await api.post('/api/request-money/payout-accounts', { data: {
            holderName: 'Gina Order', country: 'GB', bankName: 'Barclays',
            accountNumber: `1234${Math.floor(1000 + Math.random() * 9000)}`, currency: 'GBP',
        } });
        const accountId = (await account.json()).data.id;
        await api.post(`/api/dev/payout-accounts/${accountId}/verify`, { data: {} });

        await page.goto('/group-pay/create');
        await expect(page.getByRole('heading', { name: 'Create Funding Campaign' })).toBeVisible();

        const nameBox = await page.getByLabel('Campaign Name *').boundingBox();
        const amountBox = await page.getByLabel('How much do you want to collect? *').boundingBox();
        const descBox = await page.getByLabel('Description *').boundingBox();
        const fixedToggleBox = await page.locator('#fixed-amount-toggle').boundingBox();

        expect(nameBox.y).toBeLessThan(amountBox.y);
        expect(amountBox.y).toBeLessThan(descBox.y);
        expect(descBox.y).toBeLessThan(fixedToggleBox.y);
    });

});
