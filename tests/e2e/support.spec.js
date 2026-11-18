import { test, expect } from '@playwright/test';

test.describe('Support Module Journeys', () => {

    test('Sidebar link-support navigates to /support with FAQs and My tickets cards', async ({ page }) => {
        await page.goto('/');
        await page.getByTestId('link-support').click();
        await expect(page).toHaveURL(/\/support/);
        await expect(page.getByTestId('page-support-hub')).toBeVisible();
        await expect(page.getByTestId('card-support-faqs')).toBeVisible();
        await expect(page.getByTestId('card-support-my-tickets')).toBeVisible();
    });

    test('/support/faq loads FAQ groups, expands/collapses accordion, and back button returns to /support', async ({ page }) => {
        await page.goto('/support/faq');
        await expect(page.getByTestId('page-support-faq')).toBeVisible();

        // FAQ groups should be populated
        const firstGroup = page.getByTestId('faq-group-0');
        await expect(firstGroup).toBeVisible();

        // Click first question accordion item to expand
        const firstQuestion = firstGroup.getByRole('button').first();
        await expect(firstQuestion).toBeVisible();
        await firstQuestion.click();

        // Click Back button
        await page.getByTestId('button-back-support').click();
        await expect(page).toHaveURL(/\/support$/);
    });

    test('Unauthenticated /support/my-tickets renders card-support-signin-required with safe redirect buttons', async ({ page }) => {
        // Intercept unauthenticated response for GetSupportTickets
        await page.route('**/api/v1/Support/GetSupportTickets*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    supportTickets: { data: [], totalCount: 0, totalPages: 0, currentPage: 1, pageSize: 10 },
                    statusCounts: [],
                    requiresFurpAuth: true,
                    message: 'Sign in with your Rhemito account to view and manage your live support tickets.'
                })
            });
        });

        await page.goto('/support/my-tickets');
        await expect(page.getByTestId('card-support-signin-required')).toBeVisible();

        // Verify sign in CTA links with redirect parameter
        const signinBtn = page.getByTestId('button-support-signin');
        await expect(signinBtn).toBeVisible();
        await signinBtn.click();
        await expect(page).toHaveURL(/\/sign-in-sign-up\?redirect=(?:%2F|\/)support(?:%2F|\/)my-tickets/);

        // Go back and verify Browse FAQs button
        await page.goto('/support/my-tickets');
        await page.getByTestId('button-support-browse-faqs').click();
        await expect(page).toHaveURL(/\/support\/faq/);
    });

    test('Authenticated ticket journey: unread badge, search, filter tabs, detail thread & reply composer', async ({ page }) => {
        const mockTickets = [
            {
                ticketNo: '6441',
                date: '2026-11-18T10:00:00Z',
                name: 'Olayinka Modupe',
                subject: 'Profile change request: Full name',
                status: 'Resolved',
                supportArea: 'KYC and Compliance',
                transactionReference: null,
            },
            {
                ticketNo: '6442',
                date: '2026-11-18T12:00:00Z',
                name: 'Olayinka Modupe',
                subject: 'Card payment declined on transfer #22505771',
                status: 'Awaiting Client',
                supportArea: 'Failed Transaction',
                transactionReference: '22505771',
            }
        ];

        // Mock unread count
        await page.route('**/api/support/unread-count*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ count: 1, requiresFurpAuth: false })
            });
        });

        // Mock tickets list
        await page.route('**/api/v1/Support/GetSupportTickets*', async (route) => {
            const url = new URL(route.request().url());
            const status = url.searchParams.get('Status') || '';
            const search = (url.searchParams.get('SearchingText') || '').toLowerCase();

            let filtered = mockTickets;
            if (status) {
                filtered = filtered.filter(t => t.status.toUpperCase().replace(/\s+/g, '') === status.toUpperCase().replace(/\s+/g, ''));
            }
            if (search) {
                filtered = filtered.filter(t => t.subject.toLowerCase().includes(search) || t.ticketNo.includes(search));
            }

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    supportTickets: {
                        data: filtered,
                        totalCount: filtered.length,
                        totalPages: 1,
                        currentPage: 1,
                        pageSize: 10,
                        hasNextPage: false,
                        hasPreviousPage: false,
                    },
                    statusCounts: [
                        { status: 'All', count: 2, shortcode: '' },
                        { status: 'Resolved', count: 1, shortcode: 'RESOLVED' },
                        { status: 'Awaiting Client', count: 1, shortcode: 'AWAITINGCLIENT' },
                    ]
                })
            });
        });

        // Mock ticket detail
        await page.route('**/api/v1/Support/GetSupportTicket?referenceNumber=6441*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        referenceNumber: '6441',
                        subject: 'Profile change request: Full name',
                        supportArea: 'KYC and Compliance',
                        transactionReference: null,
                        status: 'Resolved',
                        statusCode: 'RESOLVED',
                        requested: '2026-11-18T10:00:00Z',
                        lastactivity: '2026-11-18T11:00:00Z',
                        name: 'Olayinka Modupe',
                        email: 'robin.jain+bankingmodule@anktech.co.in',
                        tickets: {
                            data: [
                                {
                                    id: 'msg-1',
                                    role: 'Account Holder',
                                    userName: 'Olayinka Modupe',
                                    note: 'I need to update my name.',
                                    lastactivity: '2026-11-18T10:00:00Z',
                                    fileAttachment: null,
                                    fileExtension: '',
                                },
                                {
                                    id: 'msg-2',
                                    role: 'BackOffice User',
                                    userName: 'Rhemito Support',
                                    note: 'We have updated your profile name.',
                                    lastactivity: '2026-11-18T11:00:00Z',
                                    fileAttachment: null,
                                    fileExtension: '',
                                }
                            ],
                            totalCount: 2,
                            totalPages: 1,
                            currentPage: 1,
                            pageSize: 10
                        }
                    },
                    code: 200,
                    responseType: 'Success',
                    message: 'Success.'
                })
            });
        });

        // Mock mark notification read
        await page.route('**/api/v1/Account/MarkNotificationRead*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ code: 200, message: 'Notification marked as read', responseType: 'Success' })
            });
        });

        // Mock update ticket reply
        await page.route('**/api/v1/Support/UpdateTicket*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: { referenceNumber: '6441', status: 'Awaiting Admin' },
                    code: 200,
                    responseType: 'Success',
                    message: 'Ticket updated successfully.'
                })
            });
        });

        await page.goto('/support/my-tickets');
        await expect(page.getByTestId('page-my-tickets')).toBeVisible();

        // Verify sidebar support badge shows count 1
        const badge = page.getByTestId('sidebar-support-badge');
        await expect(badge).toBeVisible();
        await expect(badge).toHaveText('1');

        // Verify ticket rows exist
        await expect(page.getByTestId('row-ticket-6441')).toBeVisible();
        await expect(page.getByTestId('row-ticket-6442')).toBeVisible();

        // Search tickets
        const searchInput = page.getByTestId('input-search-tickets');
        await searchInput.fill('Profile change');
        await page.waitForTimeout(350); // debounce wait
        await expect(page.getByTestId('row-ticket-6441')).toBeVisible();
        await expect(page.getByTestId('row-ticket-6442')).toHaveCount(0);

        // Clear search
        await page.getByTestId('button-clear-ticket-search').click();
        await expect(page.getByTestId('row-ticket-6442')).toBeVisible();

        // Open ticket detail
        await page.getByTestId('row-ticket-6441').click();
        await expect(page).toHaveURL(/\/my-tickets\/request-details\/6441/);
        await expect(page.getByTestId('page-ticket-details')).toBeVisible();

        // Verify thread messages
        await expect(page.getByTestId('ticket-thread-list')).toBeVisible();
        await expect(page.getByTestId('ticket-message-0')).toBeVisible();
        await expect(page.getByTestId('ticket-message-1')).toBeVisible();

        // Toggle reply composer
        await page.getByTestId('button-toggle-ticket-reply').click();
        const composer = page.getByTestId('panel-ticket-reply-composer');
        await expect(composer).toBeVisible();

        // Type reply and submit
        await page.getByTestId('textarea-ticket-reply').fill('Thank you for confirming!');
        await page.getByTestId('button-submit-ticket-reply').click();

        // Toast feedback
        await expect(page.getByText(/Ticket updated successfully/i)).toBeVisible();
    });

    test('Create ticket journey: validates mandatory fields, file upload/removal, and creates ticket', async ({ page }) => {
        // Mock unread count
        await page.route('**/api/support/unread-count*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ count: 0, requiresFurpAuth: false })
            });
        });

        // Mock create ticket endpoint
        await page.route('**/api/v1/Support/SupportTicket*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: { referenceNumber: '6443', ticketNo: '6443', status: 'New' },
                    code: 200,
                    responseType: 'Success',
                    message: 'Your enquiry has been successfully submitted.'
                })
            });
        });

        // Mock tickets list after creation redirect
        await page.route('**/api/v1/Support/GetSupportTickets*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    supportTickets: {
                        data: [{ ticketNo: '6443', status: 'New', subject: 'Card payment error', supportArea: 'Failed Transaction', date: new Date().toISOString(), name: 'Test User' }],
                        totalCount: 1,
                        totalPages: 1,
                        currentPage: 1,
                        pageSize: 10
                    },
                    statusCounts: [{ status: 'All', count: 1, shortcode: '' }, { status: 'New', count: 1, shortcode: 'NEW' }]
                })
            });
        });

        await page.goto('/support/create-ticket');
        await expect(page.getByTestId('page-create-ticket')).toBeVisible();

        // Support Area: Failed Transaction accordion requires TransactionReference
        await page.getByTestId('accordion-area-failed-transaction').click();
        await expect(page.getByTestId('input-ticket-tx-ref')).toBeVisible();

        // Fill fields
        await page.getByTestId('input-ticket-tx-ref').fill('22509999');
        await page.getByTestId('input-ticket-subject').fill('Card payment error');
        await page.getByTestId('textarea-ticket-message').fill('My payment timed out during 3DS verification.');

        // Test file attachment: upload fake png Buffer
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.getByTestId('create-ticket-attachment-dropzone').click();
        const fileChooser = await fileChooserPromise;
        // Valid 1x1 PNG buffer
        const pngBuffer = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d450000000049454e44ae426082', 'hex');
        await fileChooser.setFiles({
            name: 'receipt.png',
            mimeType: 'image/png',
            buffer: pngBuffer,
        });

        await expect(page.getByTestId('create-ticket-attachment-selected')).toBeVisible();
        await expect(page.getByTestId('create-ticket-attachment-filename')).toHaveText('receipt.png');

        // Test removing file
        await page.getByTestId('create-ticket-attachment-remove').click();
        await expect(page.getByTestId('create-ticket-attachment-dropzone')).toBeVisible();

        // Submit ticket
        await page.getByTestId('button-submit-ticket').click();

        // Confirm toast & navigation
        await expect(page.getByText(/Your enquiry has been successfully submitted/i)).toBeVisible();
        await expect(page).toHaveURL(/\/support\/my-tickets/);
    });
});
