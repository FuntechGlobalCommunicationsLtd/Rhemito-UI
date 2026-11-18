import { test, expect } from '@playwright/test';

test.describe('Compliance Verification Journeys', () => {

    test('Sidebar link-compliance navigates to /compliance and renders AML address verification', async ({ page }) => {
        await page.goto('/');
        await page.getByTestId('link-compliance').click();
        await expect(page).toHaveURL(/\/compliance/);
        await expect(page.getByTestId('compliance-page')).toBeVisible();

        // Mode A (AML Address Verified) view
        await expect(page.getByTestId('compliance-aml-verified')).toBeVisible();

        // PD-04 Sentence case sections and dynamic profile fields
        await expect(page.getByText('AML address verification')).toBeVisible();
        await expect(page.getByText('Personal information')).toBeVisible();
        await expect(page.getByTestId('compliance-field-full-name')).toBeVisible();
        await expect(page.getByTestId('compliance-field-country')).toBeVisible();

        // Confirm legacy refresh button count is 0
        await expect(page.getByTestId('button-refresh-compliance')).toHaveCount(0);
    });

    test('Full document KYC verified state renders Already verified badge card', async ({ page }) => {
        await page.route('**/api/compliance/overview*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    source: 'furp',
                    kyc: {
                        status: 'SUCCESSFUL',
                        type: 'DOC',
                        isTransactionAllowed: true,
                        attempt: 1,
                    },
                    profile: {
                        uid: '2bcec023-bf78-46d1-8d80-748d438ca447',
                        isBusinessProfile: false,
                        fullName: 'Olayinka Modupe',
                        occupation: 'Advertising And Marketing',
                        dateOfBirth: '1973-02-14T00:00:00.000+00:00',
                        gender: 'Female',
                        address: '1,E 62 Abul Fazal Enclave Part 1 Jamia Nagar',
                        city: 'London',
                        postCode: 'WES234',
                        residentCountry: 'UK',
                        identificationType: 'DRIVINGLICENSE',
                        documentNo: 'MODUP702149OL99',
                        issuingCountry: 'GBR',
                    },
                    journeyRecommended: false,
                })
            });
        });

        await page.goto('/compliance');
        await expect(page.getByTestId('compliance-page')).toBeVisible();

        // Mode B (Full Document Identity Verification) view
        await expect(page.getByTestId('compliance-identity-verified')).toBeVisible();
        await expect(page.getByTestId('compliance-already-verified-badge')).toBeVisible();
        await expect(page.getByText('Already verified')).toBeVisible();
        await expect(page.getByText('Identity verification')).toBeVisible();
    });

    test('Under review KYC state renders review message and Continue button to home', async ({ page }) => {
        await page.route('**/api/compliance/overview*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    source: 'furp',
                    kyc: {
                        status: 'UNDERREVIEW',
                        type: 'AMLADDR',
                        isTransactionAllowed: false,
                        attempt: 1,
                    },
                    profile: {
                        uid: 'test-uid',
                        isBusinessProfile: false,
                        fullName: 'Jane Doe',
                    },
                    journeyRecommended: false,
                })
            });
        });

        await page.goto('/compliance');
        await expect(page.getByTestId('compliance-under-review-card')).toBeVisible();
        await expect(page.getByText(/Your KYC is under review/i)).toBeVisible();

        // Click Continue
        await page.getByTestId('button-compliance-continue').click();
        await expect(page).toHaveURL('/');
    });
});
