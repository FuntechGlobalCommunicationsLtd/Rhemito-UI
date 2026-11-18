import { test, expect } from '@playwright/test';

test.describe('MitoView Publication Journeys', () => {

    test('Sidebar link-mitoview navigates to /mitoview, and /blog redirects to /mitoview', async ({ page }) => {
        await page.goto('/');
        await page.getByTestId('link-mitoview').click();
        await expect(page).toHaveURL(/\/mitoview/);
        await expect(page.getByTestId('page-mitoview-home')).toBeVisible();

        // Check /blog alias redirection
        await page.goto('/blog');
        await expect(page).toHaveURL(/\/mitoview$/);
    });

    test('Browse articles, search & clear, and view article details with back navigation', async ({ page }) => {
        await page.goto('/mitoview');
        await expect(page.getByTestId('page-mitoview-home')).toBeVisible();

        // Verify live/fixture post card renders
        const postCard = page.getByTestId('card-mitoview-post-2026-07-simplifying-transfers');
        await expect(postCard).toBeVisible();

        // Search for article
        const searchInput = page.getByTestId('input-mitoview-search');
        await searchInput.fill('simplifying');
        await page.getByTestId('button-mitoview-search').click();
        await expect(page.getByTestId('mitoview-search-status')).toBeVisible();
        await expect(postCard).toBeVisible();

        // Clear search
        await page.getByTestId('button-mitoview-search-clear').click();
        await expect(page.getByTestId('input-mitoview-search')).toHaveValue('');

        // Click article card to open article reader
        await postCard.click();
        await expect(page).toHaveURL(/\/mitoview\/2026-07-simplifying-transfers/);
        await expect(page.getByTestId('page-mitoview-article')).toBeVisible();

        // Verify back button navigates back to /mitoview
        await page.getByTestId('button-back-mitoview').first().click();
        await expect(page).toHaveURL(/\/mitoview$/);
    });

    test('Unknown article slug displays friendly not found message', async ({ page }) => {
        await page.goto('/mitoview/unknown-nonexistent-edition');
        await expect(page.getByTestId('mitoview-article-not-found')).toBeVisible();
        await expect(page.getByText(/That MitoView edition is not on Rhemito/i)).toBeVisible();

        await page.getByTestId('button-mitoview-not-found-back').click();
        await expect(page).toHaveURL(/\/mitoview$/);
    });

    test('Newsletter subscription on /mitoview (mocked to prevent staging spam)', async ({ page }) => {
        await page.route('**/api/v1/MitoView/subscribe*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    succeeded: true,
                    code: 200,
                    message: 'Thank you for subscribing to MitoView.'
                })
            });
        });

        await page.goto('/mitoview');
        const emailInput = page.getByTestId('input-mitoview-subscribe-email');
        await expect(emailInput).toBeVisible();
        await emailInput.fill('subscriber@example.com');
        await page.getByTestId('button-mitoview-subscribe').click();

        await expect(page.getByTestId('mitoview-subscribe-status')).toBeVisible();
    });

    test('Unsubscribe flow with direct email and token confirmation', async ({ page }) => {
        await page.route('**/api/v1/MitoView/unsubscribe/confirm*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    succeeded: true,
                    code: 200,
                    message: 'You have been unsubscribed from MitoView.'
                })
            });
        });

        await page.route('**/api/v1/MitoView/unsubscribe', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    succeeded: true,
                    code: 200,
                    message: 'We have sent you an email with a link to confirm your unsubscription.'
                })
            });
        });

        // Test with ?token= (token confirmation mode)
        await page.goto('/mitoview/unsubscribe?token=mock-token-123');
        await expect(page.getByTestId('page-mitoview-unsubscribe')).toBeVisible();
        const confirmBtn = page.getByTestId('button-mitoview-confirm-unsubscribe');
        await expect(confirmBtn).toBeVisible();
        await confirmBtn.click();
        await expect(page.getByTestId('mitoview-unsubscribe-status')).toBeVisible();

        // Test standard email input mode
        await page.goto('/mitoview/unsubscribe');
        const unsubsEmail = page.getByTestId('input-mitoview-unsubscribe-email');
        await expect(unsubsEmail).toBeVisible();
        await unsubsEmail.fill('user@example.com');
        await page.getByTestId('button-mitoview-unsubscribe').click();
        await expect(page.getByTestId('mitoview-unsubscribe-status')).toBeVisible();
    });
});
