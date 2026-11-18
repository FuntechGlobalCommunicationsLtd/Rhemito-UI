import { test, expect } from '@playwright/test';

const json = (body, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
});

async function mockBeneficiaries(page) {
    await page.route('**/api/send-money/mito/beneficiaries*', (route) =>
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

test.describe('Staging Payment Gateway & Recent Transactions Sorting E2E', () => {
    test('Step 4 502 PAYMENT_GATEWAY_ERROR guard stays on Step 4, shows error toast, and never fakes Payment Successful', async ({ page }) => {
        await mockBeneficiaries(page);

        await page.route('**/api/send-money/transactions/*/pay', (route) =>
            route.fulfill(
                json(
                    {
                        error: {
                            code: 'PAYMENT_GATEWAY_ERROR',
                            message: 'We could not open the payment gateway right now. Please try again or choose another payment method.',
                        },
                    },
                    502,
                ),
            ),
        );

        await page.goto('/send-money');
        await page.getByPlaceholder('0.00').first().fill('100');
        await page.getByRole('button', { name: 'Continue' }).click();

        await page.getByText('Akshita', { exact: true }).first().click();
        await expect(page.getByText(/Recipient details/i).first()).toBeVisible();
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByTestId('beneficiary-review-summary')).toBeVisible({ timeout: 10000 });
        await page.getByRole('button', { name: 'Continue' }).click();

        await expect(page.getByText('How would you like to pay?')).toBeVisible({ timeout: 15000 });
        await page.getByText('Instant Pay By Bank').click();

        const toast = page.locator('.destructive').filter({ hasText: 'Payment not completed' }).first();
        await expect(toast).toBeVisible();
        await expect(toast).toContainText('We could not open the payment gateway right now.');

        await expect(page.getByText('Payment Successful')).toHaveCount(0);
        await expect(page.getByText('How would you like to pay?')).toBeVisible();
    });

    test('Recent Transactions All tab displays newly completed Send Money transfer at Row #1 above earlier same-day items', async ({ page }) => {
        const nowIso = new Date().toISOString();

        await page.route('**/api/send-money/transactions', async (route) => {
            if (route.request().method() === 'GET') {
                await route.fulfill(
                    json({
                        data: [
                            {
                                id: 'tx-latest-today-1',
                                reference: 'TXN-LATEST-TODAY',
                                recipientName: 'Zainab Ahmed',
                                service: 'bank_deposit',
                                paymentMethod: 'card',
                                sendCurrency: 'GBP',
                                sendAmount: '150.00',
                                receiveCurrency: 'NGN',
                                receiveAmount: '274500.00',
                                fee: '2.00',
                                exchangeRate: '1830.00',
                                status: 'completed',
                                createdAt: nowIso,
                                paidAt: nowIso,
                            },
                        ],
                        meta: { total: 1 },
                    }),
                );
            } else {
                await route.continue();
            }
        });

        await page.goto('/');
        await expect(page.getByTestId('table-transactions')).toBeVisible();
        await expect(page.getByTestId('chip-type-all')).toBeVisible();

        const rows = page.locator(
            '[data-testid^="row-transaction-"], [data-testid^="row-scheduled-"], [data-testid^="row-receive_money-"], [data-testid^="row-invoice-"], [data-testid^="row-campaign-"]',
        );
        await expect(rows.first()).toBeVisible({ timeout: 10000 });
        await expect(rows.first()).toHaveAttribute('data-testid', 'row-transaction-TXN-LATEST-TODAY');
    });

    test('Option A two-phase gateway ignores 3DS redirect/Pending postMessages and confirms via confirm-gateway on completion', async ({ page }) => {
        await mockBeneficiaries(page);

        let confirmGatewayPayload = null;
        await page.route('**/api/send-money/transactions/*/pay', (route) =>
            route.fulfill(
                json({
                    data: {
                        id: 'tx-e2e-2phase-1',
                        reference: 'TXN-E2E-2PHASE-1',
                        recipientName: 'Akshita',
                        service: 'bank_deposit',
                        paymentMethod: 'instant_bank',
                        sendCurrency: 'GBP',
                        sendAmount: '100.00',
                        receiveCurrency: 'NGN',
                        receiveAmount: '183000.00',
                        fee: '2.00',
                        exchangeRate: '1830.00',
                        status: 'awaiting_payment',
                        paidAt: null,
                        mitoPaymentUrl: 'https://mito-checkout-1cca8e18297e.herokuapp.com/retail-payment?journeyCode=JNY-E2E-2PHASE',
                    },
                }),
            ),
        );

        await page.route('**/api/send-money/transactions/*/confirm-gateway', async (route) => {
            confirmGatewayPayload = route.request().postDataJSON();
            await route.fulfill(
                json({
                    data: {
                        id: 'tx-e2e-2phase-1',
                        reference: 'TXN-E2E-2PHASE-1',
                        recipientName: 'Akshita',
                        service: 'bank_deposit',
                        paymentMethod: 'instant_bank',
                        sendCurrency: 'GBP',
                        sendAmount: '100.00',
                        receiveCurrency: 'NGN',
                        receiveAmount: '183000.00',
                        fee: '2.00',
                        exchangeRate: '1830.00',
                        status: 'completed',
                        paidAt: new Date().toISOString(),
                    },
                }),
            );
        });

        await page.goto('/send-money');
        await page.getByPlaceholder('0.00').first().fill('100');
        await page.getByRole('button', { name: 'Continue' }).click();

        await page.getByText('Akshita', { exact: true }).first().click();
        await expect(page.getByText(/Recipient details/i).first()).toBeVisible();
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByTestId('beneficiary-review-summary')).toBeVisible({ timeout: 10000 });
        await page.getByRole('button', { name: 'Continue' }).click();

        await expect(page.getByText('How would you like to pay?')).toBeVisible({ timeout: 15000 });
        await page.getByText('Instant Pay By Bank').click();

        await expect(page.getByTestId('mito-pay-by-bank-modal')).toBeVisible({ timeout: 10000 });
        await expect(page.getByText('Payment Successful')).toHaveCount(0);

        // Simulated checkout.com 3DS redirect postMessage must NOT prematurely complete or call confirm-gateway
        await page.evaluate(() => {
            window.postMessage({ type: 'redirect', payload: { url: 'https://3ds.sandbox.checkout.com/challenge' } }, '*');
        });
        await page.waitForTimeout(300);
        await expect(page.getByText('Payment Successful')).toHaveCount(0);
        expect(confirmGatewayPayload).toBeNull();

        // Gateway completion triggers confirm-gateway with outcome: 'completed' and renders Payment Successful
        await page.evaluate(() => {
            window.postMessage({ type: 'MITO_LINK_SUCCESS' }, '*');
        });
        await expect.poll(() => confirmGatewayPayload?.outcome).toBe('completed');
        await expect(page.getByText('Payment Successful').first()).toBeVisible({ timeout: 10000 });
    });

    test('Card 3DS return to /send/status marks transfer completed, stays off /send-money, hydrates receipt, and auto-redirects to Dashboard', async ({ page }) => {
        const paidIso = new Date().toISOString();
        let confirmedTargetId = null;
        let confirmPayload = null;

        await page.route('**/api/send-money/transactions/*/confirm-gateway', async (route) => {
            const urlParts = route.request().url().split('/');
            confirmedTargetId = urlParts[urlParts.length - 2];
            confirmPayload = route.request().postDataJSON();
            await route.fulfill(
                json({
                    data: {
                        id: 'tx-card-paid-1',
                        reference: 'TXN-CARD-PAID-1',
                        recipientName: 'Akshita Sharma',
                        service: 'bank_deposit',
                        paymentMethod: 'card',
                        sendCurrency: 'GBP',
                        sendAmount: '250.00',
                        receiveCurrency: 'NGN',
                        receiveAmount: '457502.50',
                        fee: '2.00',
                        exchangeRate: '1830.01',
                        bankName: 'United Bank for Africa Plc (UBA)',
                        accountNumber: '1018316888',
                        mitoTransactionId: '22505775',
                        status: 'completed',
                        createdAt: paidIso,
                        paidAt: paidIso,
                    },
                }),
            );
        });

        await page.route('**/api/send-money/transactions', async (route) => {
            if (route.request().method() === 'GET') {
                await route.fulfill(
                    json({
                        data: [
                            {
                                id: 'tx-card-paid-1',
                                reference: 'TXN-CARD-PAID-1',
                                recipientName: 'Akshita Sharma',
                                service: 'bank_deposit',
                                paymentMethod: 'card',
                                sendCurrency: 'GBP',
                                sendAmount: '250.00',
                                receiveCurrency: 'NGN',
                                receiveAmount: '457502.50',
                                fee: '2.00',
                                exchangeRate: '1830.01',
                                status: 'completed',
                                createdAt: paidIso,
                                paidAt: paidIso,
                            },
                        ],
                        meta: { total: 1 },
                    }),
                );
            } else {
                await route.continue();
            }
        });

        await page.goto('/send/status?tnxref=22505775&status=COMPSUCCESS&paymentStatus=Captured');

        await expect.poll(() => confirmPayload?.outcome).toBe('completed');
        expect(confirmedTargetId).toBe('22505775');
        expect(new URL(page.url()).pathname).toBe('/send/status');

        const statusView = page.getByTestId('payment-status-view');
        await expect(statusView).toBeVisible({ timeout: 10000 });
        await expect(statusView).toHaveAttribute('data-status-category', 'completed');
        await expect(statusView).toContainText('Payment successful');
        await expect(statusView).toContainText('TXN-CARD-PAID-1');
        await expect(statusView).toContainText('250.00');
        await expect(statusView).toContainText('Akshita Sharma');

        // Option A: auto-redirects to Dashboard ("/") after the 6s countdown
        await expect(page).toHaveURL(/\/$/, { timeout: 12000 });
        await expect(page.getByTestId('row-transaction-TXN-CARD-PAID-1')).toBeVisible({ timeout: 10000 });
    });

    test('Option A Manual Bank Transfer "I have made the Payment" confirms toast and redirects to Dashboard', async ({ page }) => {
        await mockBeneficiaries(page);

        await page.goto('/send-money');
        await page.getByPlaceholder('0.00').first().fill('100');
        await page.getByRole('button', { name: 'Continue' }).click();

        await page.getByText('Akshita', { exact: true }).first().click();
        await expect(page.getByText(/Recipient details/i).first()).toBeVisible();
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByTestId('beneficiary-review-summary')).toBeVisible({ timeout: 10000 });
        await page.getByRole('button', { name: 'Continue' }).click();

        await expect(page.getByText('How would you like to pay?')).toBeVisible({ timeout: 15000 });
        await page.getByText('Manual Bank Transfer').click();
        await page.getByRole('button', { name: 'Proceed' }).click();

        const madePaymentBtn = page.getByTestId('button-manual-transfer-made-payment');
        await expect(madePaymentBtn).toBeVisible({ timeout: 10000 });
        await madePaymentBtn.click();

        await expect(page.getByText('Payment confirmation received').first()).toBeVisible({ timeout: 10000 });
        await expect(page).toHaveURL(/\/$/, { timeout: 10000 });
    });

    test('Instant Pay By Bank completes on RetailCollection READYTOPROCESS journey poll, confirms gateway, and auto-redirects to Dashboard', async ({ page }) => {
        await mockBeneficiaries(page);

        const paidIso = new Date().toISOString();
        let confirmPayload = null;

        await page.route('https://mito-checkout-1cca8e18297e.herokuapp.com/retail-payment*', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'text/html',
                body: '<html><body><p>Plaid RetailCollection Stub</p></body></html>',
            }),
        );

        await page.route('**/api/send-money/transactions/*/pay', (route) =>
            route.fulfill(
                json({
                    data: {
                        id: 'tx-pbb-paid-1',
                        reference: 'TXN-PBB-PAID-1',
                        recipientName: 'Akshita Sharma',
                        service: 'bank_deposit',
                        paymentMethod: 'instant_bank',
                        sendCurrency: 'GBP',
                        sendAmount: '100.00',
                        receiveCurrency: 'NGN',
                        receiveAmount: '183001.00',
                        fee: '0.00',
                        exchangeRate: '1830.01',
                        mitoTransactionId: '102635',
                        mitoReference: '102635',
                        mitoPaymentReference: 'TXN-PBB-PAID-1-PBB-STUB1',
                        mitoPaymentUrl: 'https://mito-checkout-1cca8e18297e.herokuapp.com/retail-payment?journeyCode=JNY-PBB-RC01',
                        status: 'awaiting_payment',
                        createdAt: paidIso,
                        paidAt: null,
                    },
                }),
            ),
        );

        await page.route('**/api/send-money/mito/journey-status*', (route) =>
            route.fulfill(
                json({
                    data: {
                        journeyCode: 'JNY-PBB-RC01',
                        journeyStatus: 'Completed',
                        orderNo: '102635',
                        orderStatus: 'READYTOPROCESS',
                        partnerReferenceNumber: 'TXN-PBB-PAID-1-PBB-STUB1',
                        reference: '102635',
                        currency: 'GBP',
                        amount: 100,
                        journeyType: 'RetailCollection',
                    },
                }),
            ),
        );

        await page.route('**/api/send-money/transactions/*/confirm-gateway', async (route) => {
            confirmPayload = route.request().postDataJSON();
            await route.fulfill(
                json({
                    data: {
                        id: 'tx-pbb-paid-1',
                        reference: 'TXN-PBB-PAID-1',
                        recipientName: 'Akshita Sharma',
                        service: 'bank_deposit',
                        paymentMethod: 'instant_bank',
                        sendCurrency: 'GBP',
                        sendAmount: '100.00',
                        receiveCurrency: 'NGN',
                        receiveAmount: '183001.00',
                        fee: '0.00',
                        exchangeRate: '1830.01',
                        bankName: 'United Bank for Africa Plc (UBA)',
                        accountNumber: '1018316888',
                        mitoTransactionId: '102635',
                        mitoReference: '102635',
                        mitoPaymentReference: 'TXN-PBB-PAID-1-PBB-STUB1',
                        status: 'completed',
                        createdAt: paidIso,
                        paidAt: paidIso,
                    },
                }),
            );
        });

        await page.goto('/send-money');
        await page.getByPlaceholder('0.00').first().fill('100');
        await page.getByRole('button', { name: 'Continue' }).click();

        await page.getByText('Akshita', { exact: true }).first().click();
        await expect(page.getByText(/Recipient details/i).first()).toBeVisible();
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByTestId('beneficiary-review-summary')).toBeVisible({ timeout: 10000 });
        await page.getByRole('button', { name: 'Continue' }).click();

        await expect(page.getByText('How would you like to pay?')).toBeVisible({ timeout: 15000 });
        await page.getByText('Instant Pay By Bank').click();

        await expect.poll(() => confirmPayload?.outcome).toBe('completed');
        expect(confirmPayload?.rawStatus).toBe('READYTOPROCESS');
        expect(confirmPayload?.journeyCode).toBe('JNY-PBB-RC01');

        const statusView = page.getByTestId('payment-status-view');
        await expect(statusView).toBeVisible({ timeout: 10000 });
        await expect(statusView).toHaveAttribute('data-status-category', 'completed');
        await expect(statusView).toContainText('Payment successful');
        await expect(statusView).toContainText('TXN-PBB-PAID-1');

        await expect(page).toHaveURL(/\/$/, { timeout: 12000 });
    });
});
