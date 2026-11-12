import { test, expect } from '@playwright/test';

/**
 * Request Money E2E — unified server-backed journey.
 *
 * Auth is real (register + OTP activation starts a session with mini-KYC
 * passed). Payment completes through the development provider simulation which
 * settles via the SAME signed webhook boundary production providers use — the
 * browser alone can never fund a request.
 */

const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const isoDaysFromNow = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const humanDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

/** Registers a user, activates via OTP (starts a session + mini-KYC passed). */
async function registerAndActivate(request, country = "GB") {
  const email = `rm-${unique()}@example.com`;
  await request.post('/api/auth/register', {
    data: {
      email,
      accountType: 'individual',
      country,
      firstName: 'Rita',
      lastName: `Money-${unique().slice(0, 4)}`,
      dateOfBirth: '1990-05-05',
      gender: 'female',
      mobileCode: '+44',
      mobileNumber: '7700900123',
      password: 'Passw0rd!x',
      confirmPassword: 'Passw0rd!x',
    },
  });
  const verify = await request.post('/api/auth/verify-otp', { data: { email, code: '123456' } });
  expect(verify.ok()).toBeTruthy();
  return { email, country };
}

/** Adds and (dev-stub) verifies a payout account matching the corridor. */
async function addVerifiedAccount(request, country, currency) {
  const res = await request.post('/api/request-money/payout-accounts', {
    data: { holderName: 'Rita Money', country, bankName: 'Barclays', accountNumber: `1234${Math.floor(1000 + Math.random() * 9000)}`, currency },
  });
  expect(res.ok()).toBeTruthy();
  const { data } = await res.json();
  const verify = await request.post(`/api/dev/payout-accounts/${data.id}/verify`, { data: {} });
  expect(verify.ok()).toBeTruthy();
  return data.id;
}

async function createRequestViaApi(request, user, overrides = {}) {
  const accountId = user.accountId ?? (await addVerifiedAccount(request, user.country, user.country === 'GB' ? 'GBP' : 'NGN'));
  const res = await request.post('/api/request-money/requests', {
    data: {
      corridorId: user.country === 'GB' ? 'GB-GB-GBP' : 'NG-NG-NGN',
      payoutAccountId: accountId,
      payInAmount: '120.00',
      senderType: 'individual',
      senderName: 'Sam Sender',
      senderEmail: `sam-${unique()}@example.com`,
      purpose: 'invoice_payment',
      idempotencyKey: `e2e-${unique()}`,
      ...overrides,
    },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data;
}

test.describe('Request Money E2E', () => {

  test('Dashboard demo experience: request payment works without a sign-in prompt', async ({ page, request }) => {
    const res = await request.get('/api/request-money/eligibility');
    expect([200, 401]).toContain(res.status());

    // Outside real production the seeded demo requester stands in for an
    // anonymous dashboard visitor: the payout flow renders (seeded verified
    // account) and never asks to sign in.
    await page.goto('/request-payment');
    await expect(page.getByTestId('payout-account-card').or(page.getByTestId('payout-account-required'))).toBeVisible({ timeout: 10000 });
    expect(await page.getByTestId('payout-signin-required').count()).toBe(0);

    // The public payer side stays strict: anonymous session start is rejected.
    const session = await request.post('/api/public/requests/sometoken/session', { data: {} });
    expect(session.status()).toBe(401);
  });

  test('Eligibility blocks before a verified payout account exists', async ({ page, request, browser }) => {
    const user = await registerAndActivate(request);
    // Fresh context is logged-out; log the page in via the same session cookies
    const context = page.context();
    const pageRequest = context.request;
    const verify = await pageRequest.post('/api/auth/login', { data: { email: user.email, password: 'Passw0rd!x' } });
    expect(verify.ok()).toBeTruthy();

    await page.goto('/request-payment');
    await expect(page.getByTestId('payout-account-required')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('payout-account-required').getByText('Settlement Bank Account Required')).toBeVisible();

    // The add-and-verify dialog auto-opens when no verified account exists
    await expect(page.getByTestId('input-account-bank')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('input-account-bank').fill('Barclays');
    await page.getByTestId('input-account-number').fill('12345678');
    await page.getByTestId('button-save-account').click();
    await expect(page.getByTestId('payout-account-required')).toBeHidden({ timeout: 10000 });
  });

  test('Full requester journey: amount → payment request → create link → copy / preview / email rules', async ({ page, request }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const user = await registerAndActivate(request);
    const pageRequest = page.context().request;
    await pageRequest.post('/api/auth/login', { data: { email: user.email, password: 'Passw0rd!x' } });
    await addVerifiedAccount(pageRequest, 'GB', 'GBP');
    await page.goto('/request-payment');

    // Step 1: labels, minimum and breakdown
    await expect(page.getByText('Mandatory').first()).toBeVisible();
    await page.getByTestId('input-request-amount').fill('250');
    await expect(page.getByText('Payment breakdown').first()).toBeVisible();
    await expect(page.getByText('You receive in bank (GBP)')).toBeVisible();
    await expect(page.getByTestId('text-minimum')).toContainText('Minimum the payer can send');
    await page.getByTestId('button-step-next').click();

    // Step 2: only the purpose is mandatory; Send email is hidden without a payer email
    await expect(page.getByTestId('button-create-link')).toBeDisabled();
    await expect(page.getByTestId('button-send-email')).toHaveCount(0);
    await page.getByTestId('select-reason').click();
    await page.getByRole('option', { name: /invoice \/ services/i }).click();
    await expect(page.getByTestId('button-create-link')).toBeEnabled();
    await expect(page.getByTestId('button-send-email')).toHaveCount(0);

    // Invalid email: Send email visible but blocked, message explains why
    await page.getByTestId('input-sender-email').fill('not-an-email');
    await expect(page.getByTestId('error-payer-email')).toBeVisible();
    await expect(page.getByTestId('button-send-email')).toBeDisabled();
    await expect(page.getByTestId('button-create-link')).toBeDisabled();
    // Valid email: Send email enabled; clearing it hides the button again
    await page.getByTestId('input-sender-email').fill(`ada-${unique()}@example.com`);
    await expect(page.getByTestId('button-send-email')).toBeEnabled();
    await page.getByTestId('input-sender-email').fill('');
    await expect(page.getByTestId('button-send-email')).toHaveCount(0);

    // Optional payer details: helper text visible while collapsed
    await expect(page.getByText(/Add the payer's bank details/i)).toBeVisible();

    // Create the link with NO payer, invoice or email
    await page.getByTestId('button-create-link').click();
    await expect(page.getByTestId('banner-link-created')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('img-qr')).toBeVisible();
    await expect(page.getByTestId('input-payment-link')).toHaveValue(/\/pay\/[0-9a-f]{40,}/);
    await expect(page.getByTestId('button-preview')).toBeVisible();
    await expect(page.getByTestId('button-resend-email')).toHaveCount(0);

    // Preview opens a read-only copy and creates nothing new
    await page.getByTestId('button-preview').click();
    await expect(page.getByTestId('dialog-preview')).toBeVisible();
    await page.getByTestId('button-close-preview').click();
    await expect(page.getByTestId('dialog-preview')).toHaveCount(0);

    // Copy link: clipboard holds the URL and the message names the action
    const link = await page.getByTestId('input-payment-link').inputValue();
    await page.getByTestId('button-copy-link').click();
    await expect(page.getByText('Link copied', { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

    // The QR endpoint serves a real PNG
    const qrUrl = await page.getByTestId('img-qr').getAttribute('src');
    const qr = await pageRequest.get(qrUrl);
    expect(qr.ok()).toBeTruthy();
    expect((await qr.headers())['content-type']).toBe('image/png');

    // Server: stored without payer details, default expiry applied
    const list = await (await pageRequest.get('/api/request-money/requests')).json();
    const stored = list.data.find((r) => r.checkoutUrl === link);
    expect(stored.senderEmail).toBeNull();
    expect(stored.senderName).toBeNull();
    const days = (new Date(stored.expiresAt).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(28);
    expect(days).toBeLessThan(32);

    // Once the email is sent from the success page, the Payer email input and Send email button are hidden
    await page.getByTestId('input-payer-email-after').fill(`ada-${unique()}@example.com`);
    await expect(page.getByTestId('button-resend-email')).toBeVisible();
    await page.getByTestId('button-resend-email').click();
    await expect(page.getByTestId('input-payer-email-after')).toHaveCount(0);
    await expect(page.getByTestId('button-resend-email')).toHaveCount(0);
  });

  test('Receive exact amount mode passes the 3% fee to the payer end-to-end', async ({ page, request }) => {
    const user = await registerAndActivate(request);
    const pageRequest = page.context().request;
    await pageRequest.post('/api/auth/login', { data: { email: user.email, password: 'Passw0rd!x' } });
    user.accountId = await addVerifiedAccount(pageRequest, 'GB', 'GBP');

    await page.goto('/request-payment');

    await page.getByTestId('input-request-amount').fill('250');
    // Default "less charges": payer pays the exact amount, fee comes out of the payout
    await expect(page.getByTestId('mode-less')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('breakdown-sender-pays')).toHaveText('£250.00');
    await expect(page.getByText('-£7.50').first()).toBeVisible();

    // "Receive exact amount" → the 3% fee is added to the payer's payment
    await page.getByTestId('mode-exact').click();
    await expect(page.getByTestId('breakdown-sender-pays')).toHaveText('£257.50');
    await expect(page.getByText('+£7.50').first()).toBeVisible();
    // The "Payer sends" field agrees with the breakdown, and the receive figure is the exact amount
    await expect(page.getByTestId('input-request-amount')).toHaveValue('257.50');
    await expect(page.getByTestId('input-receive-amount')).toHaveValue('250.00');
    await page.getByTestId('button-step-next').click();

    // Step 2: purpose only, then create (no payer)
    await expect(page.getByTestId('review-sender-pays')).toHaveText('£257.50');
    await page.getByTestId('select-reason').click();
    await page.getByRole('option', { name: /invoice \/ services/i }).click();
    await page.getByTestId('button-create-link').click();
    await expect(page.getByTestId('banner-link-created')).toBeVisible({ timeout: 15000 });

    // The public checkout charges the payer the total incl. fee — identify via
    // 6-digit email code (no password prompt), open the session, then check Total to pay
    const link = await page.getByTestId('input-payment-link').inputValue();
    const token = link.split('/pay/')[1];
    const payer = await registerAndActivate(page.context().request, 'GB');
    await page.goto(`/pay/${token}`);
    // First screen (SenderScreen-1): Mito Payment summary with the real breakdown
    await expect(page.getByTestId('checkout-amount')).toContainText('£257.50');
    await expect(page.getByTestId('breakdown-fee')).toContainText('£7.50');
    await expect(page.getByTestId('breakdown-actual-sent')).toContainText('£250.00');
    // Second screen (SenderScreen-2): Email only + Send code (no password prompt)
    await page.getByTestId('button-start-pay').click();
    await page.getByTestId('input-payer-email').fill(payer.email);
    await page.getByTestId('button-check-email').click();
    // Third screen (SenderScreen-3): Confirmation code (known registered user skips New to Mito?)
    await expect(page.getByTestId('banner-code-sent')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('button-fill-dev-pin').click();
    await page.getByTestId('button-verify-pin-pay').click();
    // Desktop opens Continue on your phone (SenderScreen-5) -> Continue on this browser instead -> How would you like to pay? (SenderScreen-6)
    await expect(page.getByTestId('button-continue-browser')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('button-continue-browser').click();
    await expect(page.getByTestId('method-total-to-pay')).toContainText(/257\.50/);
  });

  test('Payer pays on mobile-width checkout after identification; funding only via webhook; link dies after payout', async ({ page, request }) => {
    const user = await registerAndActivate(request);
    const created = await createRequestViaApi(request, user);
    const token = created.checkoutUrl.split('/pay/')[1];

    // The payer identifies with a registered account (no password prompt required)
    const payer = await registerAndActivate(page.context().request, 'GB');

    // Mobile viewport — skips the desktop QR handoff screen and opens method selection directly
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto(`/pay/${token}`);

    await expect(page.getByText('Mito Payment')).toBeVisible();
    await expect(page.getByTestId('checkout-requester-name')).toBeVisible();
    await expect(page.getByTestId('payment-breakdown')).toBeVisible();
    await expect(page.getByTestId('payment-breakdown').getByText('Locked').first()).toBeVisible();
    await expect(page.getByTestId('breakdown-you-pay')).toContainText('£120.00');
    await expect(page.getByTestId('breakdown-fee')).toContainText('£3.60');
    await expect(page.getByTestId('breakdown-actual-sent')).toContainText('£116.40');
    await expect(page.getByTestId('checkout-footer')).toContainText('rhemito');
    await expect(page.getByTestId('breakdown-receive')).toBeVisible();
    await expect(page.getByTestId('breakdown-bank')).toContainText('Paid into');

    // Copyable link: identify with email + 6-digit code
    await page.getByTestId('button-start-pay').click();
    await page.getByTestId('input-payer-email').fill(payer.email);
    await page.getByTestId('button-check-email').click();
    await expect(page.getByTestId('input-pin-code')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('button-fill-dev-pin').click();
    await page.getByTestId('button-verify-pin-pay').click();

    // Mobile skips QR handoff and lands directly on "How would you like to pay?" (SenderScreen-6)
    await expect(page.getByTestId('screen-method-select')).toBeVisible({ timeout: 10000 });
    expect(await page.locator('text=/scan this with your camera/i').count()).toBe(0);

    // Select Pay by Card → Continue → Authorise Payment → settles via webhook
    await page.getByTestId('button-method-card').click();
    await page.getByTestId('button-pay-now').click();
    await expect(page.getByTestId('dev-provider-notice')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('button-authorize').click();

    // Status page follows the webhook: funded → payout → paid out
    await expect(page.getByText('Payment Successful!')).toBeVisible({ timeout: 30000 });

    // Single-use after terminal status: the paid result page shows on revisit
    await page.goto(`/pay/${token}`);
    await expect(page.getByText('Payment Successful!')).toBeVisible();
  });

  test('Security boundaries: foreign accounts rejected, unsigned webhooks rejected, disabled corridors blocked', async ({ request }) => {
    const owner = await registerAndActivate(request, 'GB');
    const accountId = await addVerifiedAccount(request, 'GB', 'GBP');

    // Another user cannot create a request against someone else's account
    const attacker = await registerAndActivate(request, 'NG');
    const res = await request.post('/api/request-money/requests', {
      data: {
        corridorId: 'GB-GB-GBP',
        payoutAccountId: accountId, // owned by `owner`, not `attacker`
        payInAmount: '50.00',
        senderType: 'individual',
        senderName: 'Mallory',
        senderEmail: 'mallory@example.com',
        purpose: 'gift',
        idempotencyKey: `e2e-foreign-${unique()}`,
      },
    });
    expect(res.status()).toBe(403);

    // An unknown corridor is rejected server-side
    const disabled = await request.post('/api/request-money/requests', {
      data: {
        corridorId: 'XX-YY-AAA-BBB',
        payoutAccountId: accountId,
        payInAmount: '50000.00',
        senderType: 'individual',
        senderName: 'Sam',
        senderEmail: 'sam2@example.com',
        purpose: 'family_support',
        idempotencyKey: `e2e-disabled-${unique()}`,
      },
    });
    expect([400, 403]).toContain(disabled.status());

    // Unsigned / forged webhooks are rejected outright
    const forged = await request.post('/api/webhooks/payin', {
      headers: { 'Content-Type': 'application/json', 'x-rhemito-signature': 'deadbeef' },
      data: { eventId: 'forge1', type: 'payment.succeeded', requestNumber: 'RM-X', intentId: 'x', amountMinor: 100, currency: 'GBP' },
    });
    expect(forged.status()).toBe(401);

    // Duplicate submissions return the SAME request through idempotency
    // (re-login as owner first — the attacker registration replaced the session)
    const relogin = await request.post('/api/auth/login', { data: { email: owner.email, password: 'Passw0rd!x' } });
    expect(relogin.ok()).toBeTruthy();
    const key = `e2e-dup-${unique()}`;
    const first = await createRequestViaApi(request, { ...owner, accountId }, { idempotencyKey: key });
    const second = await createRequestViaApi(request, { ...owner, accountId }, { idempotencyKey: key });
    expect(second.request.id).toBe(first.request.id);
  });

  test('Old QR route redirects into the unified Request Money journey', async ({ page }) => {
    await page.goto('/show-qr-code');
    await expect(page).toHaveURL(/\/request-payment/);
  });

  test('Saved sender list fills name and email; typing a different email detaches the sender', async ({ page, request }) => {
    const user = await registerAndActivate(request);
    const pageRequest = page.context().request;
    await pageRequest.post('/api/auth/login', { data: { email: user.email, password: 'Passw0rd!x' } });
    await addVerifiedAccount(pageRequest, 'GB', 'GBP');
    await page.goto('/request-payment');
    await page.getByTestId('input-request-amount').fill('150');
    await page.getByTestId('button-step-next').click();

    await page.getByTestId('button-select-sender').click();
    await expect(page.getByTestId('list-saved-senders')).toBeVisible();
    await page.getByTestId('list-saved-senders').getByRole('option').first().click();
    await expect(page.getByTestId('chip-selected-sender')).toBeVisible();
    await expect(page.getByTestId('input-sender-email')).not.toHaveValue('');

    // A different payer email clears the previous sender association
    await page.getByTestId('input-sender-email').fill(`new-${unique()}@example.com`);
    await expect(page.getByTestId('chip-selected-sender')).toHaveCount(0);

    // Payer details are optional and collapsible
    await expect(page.getByTestId('section-payer-details')).toHaveCount(0);
    await page.getByTestId('toggle-payer-details').click();
    await expect(page.getByTestId('section-payer-details')).toBeVisible();
    await page.getByTestId('input-payer-account').fill('12ab34');
    await expect(page.getByTestId('input-payer-account')).toHaveValue('1234');
    await expect(page.getByTestId('error-payer-account')).toBeVisible();
  });

  test('Reason for Payment "Other" dynamically requires a specific reason before creating the link', async ({ page, request }) => {
    const user = await registerAndActivate(request);
    const pageRequest = page.context().request;
    await pageRequest.post('/api/auth/login', { data: { email: user.email, password: 'Passw0rd!x' } });
    await addVerifiedAccount(pageRequest, 'GB', 'GBP');
    await page.goto('/request-payment');
    await page.getByTestId('input-request-amount').fill('150');
    await page.getByTestId('button-step-next').click();

    await page.getByTestId('select-reason').click();
    await page.getByRole('option', { name: /^other$/i }).click();

    await expect(page.getByTestId('container-other-reason')).toBeVisible();
    await expect(page.getByTestId('button-create-link')).toBeDisabled();

    await page.getByTestId('input-other-reason').fill('Consulting services for project');
    await expect(page.getByTestId('button-create-link')).toBeEnabled();
    await page.getByTestId('button-create-link').click();
    await expect(page.getByTestId('banner-link-created')).toBeVisible({ timeout: 15000 });

    const link = await page.getByTestId('input-payment-link').inputValue();
    const list = await (await pageRequest.get('/api/request-money/requests')).json();
    const stored = list.data.find((r) => r.checkoutUrl === link);
    expect(stored.reference).toContain('Reason: Consulting services for project');
  });

  test('Payment Link Expiry: default applied, past custom date rejected', async ({ page, request }) => {
    const user = await registerAndActivate(request);
    const pageRequest = page.context().request;
    await pageRequest.post('/api/auth/login', { data: { email: user.email, password: 'Passw0rd!x' } });
    await addVerifiedAccount(pageRequest, 'GB', 'GBP');
    await page.goto('/request-payment');
    await page.getByTestId('input-request-amount').fill('150');
    await page.getByTestId('button-step-next').click();
    await page.getByTestId('select-reason').click();
    await page.getByRole('option', { name: /invoice \/ services/i }).click();
    await expect(page.getByTestId('select-expiry-period')).toContainText('30 days');
    await expect(page.getByTestId('text-expiry-preview')).toContainText('This payment link will expire on');
    await expect(page.getByTestId('button-create-link')).toBeEnabled();

    await page.getByTestId('select-expiry-period').click();
    await page.getByRole('option', { name: 'Custom date' }).click();
    await page.getByTestId('input-custom-expiry-date').fill(isoDaysFromNow(-1));
    await expect(page.getByTestId('error-expiry')).toHaveText('Select a future Payment Link Expiry Date.');
    await expect(page.getByTestId('button-create-link')).toBeDisabled();

    await page.getByTestId('input-custom-expiry-date').fill(isoDaysFromNow(10));
    await expect(page.getByTestId('error-expiry')).toHaveCount(0);
    await expect(page.getByTestId('button-create-link')).toBeEnabled();
  });

  test('Minimum payer amount is shown and enforced', async ({ page, request }) => {
    const user = await registerAndActivate(request);
    const pageRequest = page.context().request;
    await pageRequest.post('/api/auth/login', { data: { email: user.email, password: 'Passw0rd!x' } });
    await addVerifiedAccount(pageRequest, 'GB', 'GBP');
    await page.goto('/request-payment');
    await expect(page.getByTestId('text-minimum')).toBeVisible();
    await page.getByTestId('input-request-amount').fill('0.5');
    await expect(page.getByTestId('error-minimum')).toBeVisible();
    await expect(page.getByTestId('button-step-next')).toBeDisabled();
    await page.getByTestId('input-request-amount').fill('1');
    await expect(page.getByTestId('error-minimum')).toHaveCount(0);
    await expect(page.getByTestId('button-step-next')).toBeEnabled();
  });

  test('Non-GB requester: common currencies incl. African list, home-currency corridor works end-to-end', async ({ page, request }) => {
    const user = await registerAndActivate(request, 'KE');
    const pageRequest = page.context().request;
    await pageRequest.post('/api/auth/login', { data: { email: user.email, password: 'Passw0rd!x' } });

    // Server generates same-currency demo corridors for every common currency
    // the requester's country has no reviewed corridor for
    const corridors = await (await pageRequest.get('/api/request-money/corridors')).json();
    expect(corridors.data.some((c) => c.id === 'DEMO-KE-KES' && c.enabled)).toBeTruthy();
    expect(corridors.data.some((c) => c.id === 'DEMO-KE-NGN' && c.enabled)).toBeTruthy();

    await page.goto('/request-payment');

    // The add-and-verify dialog auto-opens (no verified account yet) — add a
    // KES account (country derives to KE)
    await expect(page.getByTestId('input-account-bank')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('select-account-currency').click();
    await page.getByRole('option', { name: /KES \(KSh\) - Kenya/i }).click();
    await page.getByTestId('input-account-bank').fill('Equity Bank');
    await page.getByTestId('input-account-number').fill('12345678');
    await page.getByTestId('button-save-account').click();
    await expect(page.getByTestId('payout-account-required')).toBeHidden({ timeout: 10000 });

    // The currency dropdown lists the common set for every requester — majors
    // plus African currencies
    await page.getByTestId('select-sender-currency').click();
    for (const code of ['GBP', 'USD', 'EUR', 'NGN', 'KES', 'GHS', 'ZAR', 'EGP', 'TZS', 'UGX', 'XOF', 'RWF']) {
      await expect(page.getByRole('option', { name: new RegExp(`^${code} \\(`) })).toBeVisible();
    }
    await page.keyboard.press('Escape');

    // With a KES payout account the default GBP payer currency now has a demo
    // cross route (GBP to KES), so the corridor warning never appears
    await page.getByTestId('input-request-amount').fill('5000');
    await expect(page.getByTestId('corridor-unavailable')).toHaveCount(0);
    await expect(page.getByTestId('button-step-next')).toBeEnabled();
    await page.getByTestId('button-step-next').click();
    // GBP payer to a KES account is a cross-currency route: confirm the FX notice
    await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();

    // Complete the journey: purpose → create link
    await page.getByTestId('select-reason').click();
    await page.getByRole('option', { name: /invoice \/ services/i }).click();
    await page.getByTestId('button-create-link').click();
    await expect(page.getByTestId('banner-link-created')).toBeVisible({ timeout: 15000 });
  });

  test('Known sender email skips "New to Mito?" fields and never asks for a password', async ({ page, request }) => {
    const user = await registerAndActivate(request);
    const created = await createRequestViaApi(request, user);
    const token = created.checkoutUrl.split('/pay/')[1];
    const payer = await registerAndActivate(page.context().request, 'GB');

    await page.goto(`/pay/${token}`);
    // SenderScreen-1 -> Pay now -> SenderScreen-2: only Email + Send code initially
    await page.getByTestId('button-start-pay').click();
    await expect(page.getByTestId('ngn-verify-email')).toBeVisible();
    await expect(page.getByTestId('new-to-mito-fields')).toHaveCount(0);
    await expect(page.getByTestId('input-payer-password')).toHaveCount(0);

    await page.getByTestId('input-payer-email').fill(payer.email);
    await page.getByTestId('button-check-email').click();

    // SenderScreen-3: 6-digit Confirmation code shown, no password field, and "New to Mito?" hidden for known sender
    await expect(page.getByTestId('banner-code-sent')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('input-pin-code')).toBeVisible();
    await expect(page.getByTestId('new-to-mito-fields')).toHaveCount(0);
    await expect(page.getByTestId('input-payer-password')).toHaveCount(0);
  });

  test('Direct email link (/pay/e/:emailToken) skips 6-digit email OTP verification', async ({ page, request }) => {
    const user = await registerAndActivate(request);
    const created = await createRequestViaApi(request, user);
    const emailToken = (created.emailCheckoutUrl ?? created.request.emailCheckoutUrl).split('/pay/e/')[1];

    await page.goto(`/pay/e/${emailToken}`);
    // First screen is the payment summary (SenderScreen-1)
    await expect(page.getByTestId('payment-breakdown')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('button-start-pay').click();

    // Because the requester already supplied senderName + senderEmail on the request,
    // clicking Pay now on the emailed link proceeds straight to SenderScreen-5 without asking for a 6-digit OTP
    await expect(page.getByTestId('screen-continue-on-phone')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('input-pin-code')).toHaveCount(0);
  });

  test('NGN link: full SenderScreen-1 through SenderScreen-8 + requester-provided bank account notice + Add bank account flow', async ({ page, request }) => {
    const requester = await registerAndActivate(request, 'NG');
    const created = await createRequestViaApi(request, requester, {
      payerBankName: 'Paga Mobile Money',
      payerAccountNumber: '3661883153',
    });
    const token = created.checkoutUrl.split('/pay/')[1];

    // SenderScreen-1: Mito Payment summary + full breakdown + requester-provided bank account notice before payment
    await page.goto(`/pay/${token}`);
    await expect(page.getByText('Mito Payment')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('checkout-amount')).toContainText('NGN');
    await expect(page.getByTestId('breakdown-bank')).toContainText('Paid into');
    await expect(page.getByTestId('checkout-footer')).toContainText('rhemito');
    await expect(page.getByTestId('requester-provided-account-notice')).toBeVisible();
    await expect(page.getByTestId('requester-provided-account-masked')).toContainText('Paga Mobile Money · 36****3153');
    await expect(page.getByTestId('requester-provided-account-message')).toContainText(
      'You should pay from the same account as provided to us by the requester (Paga Mobile Money · 36****3153); otherwise, the requester may have to manually pair the payment with the correct sender.'
    );

    // SenderScreen-2: Verify Your Email To Continue (Email + Send code ONLY upfront)
    await page.getByTestId('button-start-pay').click();
    await expect(page.getByTestId('ngn-verify-email')).toBeVisible();
    await expect(page.getByText('Verify Your Email To Continue')).toBeVisible();
    await expect(page.getByTestId('requester-provided-account-notice')).toBeVisible();
    await expect(page.getByTestId('new-to-mito-fields')).toHaveCount(0);

    const newPayerEmail = `new-${Date.now()}@example.com`;
    await page.getByTestId('input-payer-email').fill(newPayerEmail);
    await page.getByTestId('button-check-email').click();

    // SenderScreen-3 & 4: Check your email banner + Confirmation code + "New to Rhemito?" fields (since email is new)
    await expect(page.getByTestId('banner-code-sent')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('input-pin-code')).toBeVisible();
    await expect(page.getByTestId('new-to-mito-fields')).toBeVisible();

    await page.getByTestId('button-ngn-account-business').click();
    await expect(page.getByTestId('input-reg-business-name')).toBeVisible();
    await page.getByTestId('button-ngn-account-individual').click();
    await page.getByTestId('input-ngn-first-name').fill('Ropo');
    await page.getByTestId('input-ngn-last-name').fill('Akin');
    await page.getByTestId('select-ngn-gender').click();
    await page.getByRole('option', { name: 'Male', exact: true }).click();
    await page.getByTestId('button-fill-dev-pin').click();
    await page.getByTestId('button-verify-pin-pay').click();

    // SenderScreen-5: Continue on your phone -> Continue on this browser instead
    await expect(page.getByTestId('screen-continue-on-phone')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('img-handoff-qr')).toBeVisible();
    await expect(page.getByTestId('requester-provided-account-notice')).toBeVisible();
    await page.getByTestId('button-continue-browser').click();

    // SenderScreen-6: How would you like to pay? (Bank transfer, Pay by Card, Interswitch / Hosted page)
    await expect(page.getByTestId('screen-method-select')).toBeVisible();
    await expect(page.getByTestId('requester-provided-account-notice')).toBeVisible();
    await expect(page.getByTestId('button-method-bank_transfer')).toBeVisible();
    await expect(page.getByTestId('button-method-card')).toBeVisible();
    await expect(page.getByTestId('button-method-interswitch')).toBeVisible();
    await page.getByTestId('button-method-bank_transfer').click();
    await page.getByTestId('button-pay-now').click();

    // SenderScreen-8: Skips "Which account will you pay from?" and shows Transfer Details with partially masked account & advisory
    await expect(page.getByTestId('screen-bank-transfer-details')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('payer-source-account-box')).toContainText('36****3153');
    await expect(page.getByTestId('payer-account-advisory')).toContainText(
      'You should pay from the same account as provided to us by the requester (Paga Mobile Money · 36****3153); otherwise, the requester may have to manually pair the payment with the correct sender.'
    );
    await expect(page.getByTestId('transfer-detail-amount')).toContainText('NGN');
    await expect(page.getByTestId('transfer-detail-accountName')).toContainText('PWA - MITO-');
    await expect(page.getByTestId('transfer-detail-bankName')).toBeVisible();
    await expect(page.getByTestId('transfer-detail-accountNumber')).toBeVisible();
    await expect(page.getByTestId('transfer-detail-reference')).toBeVisible();

    // SenderScreen-Add-bank-account: Click Change -> Add the account you'll pay from -> Save and continue
    await page.getByTestId('button-change-payer-account').click();
    await expect(page.getByTestId('screen-add-bank-account')).toBeVisible();
    await page.getByTestId('select-payer-bank').click();
    await page.getByRole('option', { name: 'Zenith Bank' }).click();
    await page.getByTestId('input-payer-bank-account-number').fill('2089123456');
    await expect(page.getByTestId('text-resolved-account-name')).toContainText('Ropo Akin', { timeout: 5000 });
    await page.getByTestId('button-save-payer-bank-account').click();

    // Back on SenderScreen-8 with updated partially masked account -> Click "I've sent the money"
    await expect(page.getByTestId('screen-bank-transfer-details')).toBeVisible();
    await expect(page.getByTestId('payer-source-account-box')).toContainText('20****3456');
    await expect(page.getByTestId('payer-source-account-box')).toContainText('Zenith Bank');
    await page.getByTestId('button-ive-sent-money').click();

    await expect(page.getByText('Payment Successful!')).toBeVisible({ timeout: 30000 });
  });

  test('GBP link: unregistered UK sender completes Mini-KYC (Name, DOB, Address) without password prompt', async ({ page, request }) => {
    const requester = await registerAndActivate(request, 'GB');
    const created = await createRequestViaApi(request, requester, {
      senderName: '',
      senderEmail: '',
      payerBankName: 'Barclays',
      payerAccountNumber: '12345678',
    });
    const token = created.checkoutUrl.split('/pay/')[1];

    await page.goto(`/pay/${token}`);
    await expect(page.getByTestId('requester-provided-account-notice')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('requester-provided-account-masked')).toContainText('Barclays · 12**5678');

    await page.getByTestId('button-start-pay').click();
    const ukPayerEmail = `uk-new-${Date.now()}@example.com`;
    await page.getByTestId('input-payer-email').fill(ukPayerEmail);
    await page.getByTestId('button-check-email').click();

    await expect(page.getByTestId('banner-code-sent')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('new-to-mito-fields')).toBeVisible();
    await expect(page.getByTestId('uk-mini-kyc-fields')).toBeVisible();
    await expect(page.getByTestId('input-payer-password')).toHaveCount(0);

    await page.getByTestId('input-ngn-first-name').fill('Oliver');
    await page.getByTestId('input-ngn-last-name').fill('Smith');
    await page.getByTestId('input-uk-dob').fill('1992-04-15');
    await page.getByTestId('input-uk-address').fill('10 Downing Street');
    await page.getByTestId('input-uk-city').fill('London');
    await page.getByTestId('input-uk-postcode').fill('SW1A 2AA');
    await page.getByTestId('button-fill-dev-pin').click();
    await page.getByTestId('button-verify-pin-pay').click();

    await expect(page.getByTestId('screen-continue-on-phone')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('requester-provided-account-notice')).toBeVisible();
  });

  test('Cancellation from the dashboard Transactions table takes confirmation before cancelling', async ({ page, request }) => {
    // Real data: register a requester, sign the page in, create a request via the API.
    const user = await registerAndActivate(request);
    const pageRequest = page.context().request;
    await pageRequest.post('/api/auth/login', { data: { email: user.email, password: 'Passw0rd!x' } });
    const created = await createRequestViaApi(pageRequest, user);

    // The removed /payments + /payment-requests pages live on in the table.
    await page.goto('/?type=receive_money');
    const row = page.getByTestId(`row-receive_money-${created.request.requestNumber}`);
    await expect(row).toBeVisible();
    await expect(row.getByText('Sent', { exact: true })).toBeVisible();

    const moreBtn = page.getByTestId(`button-actions-more-${created.request.requestNumber}`);
    await expect(moreBtn).toBeVisible();
    await moreBtn.click();

    const cancelBtn = page.getByTestId(`button-cancel-${created.request.requestNumber}`);
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    // Pre-cancellation dialog must appear with the real request's details
    const dialog = page.getByTestId('dialog-cancel-request');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Cancel Money Request?')).toBeVisible();
    await expect(dialog.getByText(created.request.senderName)).toBeVisible();
    await expect(dialog.getByText(created.request.requestNumber)).toBeVisible();

    // Dismissing keeps request
    await dialog.getByTestId('button-dialog-keep-request').click();
    await expect(dialog).toBeHidden();
    await expect(row).toBeVisible();

    // Cancel again and confirm — the row flips to Cancelled via the real cancel API
    await moreBtn.click();
    await cancelBtn.click();
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('button-dialog-confirm-cancel').click();
    await expect(row.getByText('Cancelled')).toBeVisible({ timeout: 30000 });
  });

  test('Cancel from the money request details dialog takes confirmation before cancelling', async ({ page, request }) => {
    const user = await registerAndActivate(request);
    const pageRequest = page.context().request;
    await pageRequest.post('/api/auth/login', { data: { email: user.email, password: 'Passw0rd!x' } });
    const created = await createRequestViaApi(pageRequest, user);

    await page.goto('/?type=receive_money');
    const row = page.getByTestId(`row-receive_money-${created.request.requestNumber}`);
    await expect(row).toBeVisible();

    // View opens the details dialog carrying the removed page's full data
    await row.getByTestId(`button-view-${created.request.requestNumber}`).click();
    const details = page.getByTestId('dialog-request-details');
    await expect(details).toBeVisible();
    await expect(details.getByText(created.request.senderName)).toBeVisible();
    await expect(details.getByText(created.request.senderEmail)).toBeVisible();
    await expect(details.getByTestId(`request-status-${created.request.status}`)).toBeVisible();

    // Cancelling from the details dialog hands over to the confirmation dialog
    await details.getByTestId('button-details-cancel-request').click();
    const dialog = page.getByTestId('dialog-cancel-request');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(created.request.requestNumber)).toBeVisible();
    await dialog.getByTestId('button-dialog-confirm-cancel').click();
    await expect(row.getByText('Cancelled')).toBeVisible({ timeout: 30000 });
  });

  test('Copy link action copies the checkout URL to the clipboard (replaces Rotate Link)', async ({ page, request }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const user = await registerAndActivate(request);
    const pageRequest = page.context().request;
    await pageRequest.post('/api/auth/login', { data: { email: user.email, password: 'Passw0rd!x' } });
    const created = await createRequestViaApi(pageRequest, user);

    await page.goto('/?type=receive_money');
    const moreBtn = page.getByTestId(`button-actions-more-${created.request.requestNumber}`);
    await expect(moreBtn).toBeVisible();
    await moreBtn.click();
    const copyBtn = page.getByTestId(`button-copy-link-${created.request.requestNumber}`);
    await expect(copyBtn).toBeVisible();

    // The old Rotate Link action is gone.
    await expect(page.getByTestId(`button-rotate-${created.request.requestNumber}`)).toHaveCount(0);

    await copyBtn.click();
    await expect(page.getByText('Link Copied!', { exact: true })).toBeVisible();

    // The clipboard now holds the request's shareable checkout URL.
    const clipped = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipped).toContain(created.request.checkoutUrl);

    // Once the payment is received, Copy Link must disappear from the table.
    const token = created.checkoutUrl.split('/pay/')[1];

    // Switch the browser session to a fresh payer account and pay the request via Bank Transfer.
    await pageRequest.post('/api/auth/logout', { data: {} });
    const payer = await registerAndActivate(pageRequest, 'GB');
    await page.goto(`/pay/${token}`);
    await page.getByTestId('button-start-pay').click();
    await page.getByTestId('input-payer-email').fill(payer.email);
    await page.getByTestId('button-check-email').click();
    await expect(page.getByTestId('input-pin-code')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('button-fill-dev-pin').click();
    await page.getByTestId('button-verify-pin-pay').click();
    await expect(page.getByTestId('button-continue-browser')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('button-continue-browser').click();
    await page.getByTestId('button-method-bank_transfer').click();
    await page.getByTestId('button-pay-now').click();
    await expect(page.getByTestId('button-ive-sent-money')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('button-ive-sent-money').click();
    await expect(page.getByText('Payment Successful!')).toBeVisible({ timeout: 30000 });

    // Back as the requester: the settled row no longer offers Copy Link.
    await pageRequest.post('/api/auth/logout', { data: {} });
    await pageRequest.post('/api/auth/login', { data: { email: user.email, password: 'Passw0rd!x' } });
    await page.goto('/?type=receive_money');
    await expect(page.getByTestId(`row-receive_money-${created.request.requestNumber}`)).toBeVisible();
    await expect(page.getByTestId(`row-receive_money-${created.request.requestNumber}`).getByText('Paid Out')).toBeVisible({ timeout: 30000 });
    await expect(copyBtn).toHaveCount(0);
  });

  test('Money Requests table auto-updates when the payer pays — no refresh', async ({ page, browser }) => {
    // The requester's session lives in the page context so the open table owns the request.
    const requester = await registerAndActivate(page.context().request);
    const created = await createRequestViaApi(page.context().request, requester);
    const token = created.checkoutUrl.split('/pay/')[1];

    await page.goto('/?type=receive_money');
    const row = page.getByTestId(`row-receive_money-${created.request.requestNumber}`);
    await expect(row).toBeVisible();
    await expect(row.getByText('Sent', { exact: true })).toBeVisible();

    // The payer completes payment from a completely separate browser session.
    const payerContext = await browser.newContext();
    const payerPage = await payerContext.newPage();
    const payer = await registerAndActivate(payerContext.request, 'GB');
    await payerPage.setViewportSize({ width: 375, height: 720 });
    await payerPage.goto(`/pay/${token}`);
    await payerPage.getByTestId('button-start-pay').click();
    await payerPage.getByTestId('input-payer-email').fill(payer.email);
    await payerPage.getByTestId('button-check-email').click();
    await expect(payerPage.getByTestId('input-pin-code')).toBeVisible({ timeout: 10000 });
    await payerPage.getByTestId('button-fill-dev-pin').click();
    await payerPage.getByTestId('button-verify-pin-pay').click();
    await expect(payerPage.getByTestId('screen-method-select')).toBeVisible({ timeout: 10000 });
    await payerPage.getByTestId('button-method-bank_transfer').click();
    await payerPage.getByTestId('button-pay-now').click();
    await expect(payerPage.getByTestId('button-ive-sent-money')).toBeVisible({ timeout: 10000 });
    await payerPage.getByTestId('button-ive-sent-money').click();
    await expect(payerPage.getByText('Payment Successful!')).toBeVisible({ timeout: 30000 });
    await payerContext.close();

    // The requester's already-open table reflects the payout via polling —
    // no reload, no navigation away from the dashboard.
    await expect(row.getByText('Paid Out')).toBeVisible({ timeout: 30000 });
    await expect(page).toHaveURL(/type=receive_money/);
  });

  test('Mode-less copy, removed Step 2 Edit amount bar, and mandatory fields on top', async ({ page, request }) => {
    const user = await registerAndActivate(request);
    const pageRequest = page.context().request;
    await pageRequest.post('/api/auth/login', { data: { email: user.email, password: 'Passw0rd!x' } });
    await addVerifiedAccount(pageRequest, 'GB', 'GBP');

    await page.goto('/request-payment');

    await expect(page.getByTestId('mode-less')).toContainText(
      'All the fees and commission will be charged from the amount you receive.',
    );

    await page.getByTestId('input-request-amount').fill('250');
    await page.getByTestId('button-step-next').click();

    // Step 2 summary bar ("Edit amount") is removed
    await expect(page.getByTestId('request-summary')).toHaveCount(0);
    await expect(page.getByTestId('button-edit-amount')).toHaveCount(0);

    // Mandatory / default-applied fields appear vertically above optional fields
    const reasonBox = await page.getByTestId('select-reason').boundingBox();
    const expiryBox = await page.getByTestId('select-expiry-period').boundingBox();
    const emailBox = await page.getByTestId('input-sender-email').boundingBox();
    const noteBox = await page.getByTestId('input-note').boundingBox();
    const refBox = await page.getByTestId('input-invoice-reference').boundingBox();
    const payerDetailsBox = await page.getByTestId('toggle-payer-details').boundingBox();

    expect(reasonBox.y).toBeLessThan(expiryBox.y);
    expect(expiryBox.y).toBeLessThan(emailBox.y);
    expect(emailBox.y).toBeLessThan(noteBox.y);
    expect(noteBox.y).toBeLessThan(refBox.y);
    expect(refBox.y).toBeLessThan(payerDetailsBox.y);
  });

  test('Concurrent payers (Window A & Window B): Bank Transfer locks immediately, releases on Back, and invalidates link once paid', async ({ browser, request }) => {
    test.setTimeout(60000);
    const requester = await registerAndActivate(request, 'GB');
    const created = await createRequestViaApi(request, requester, {
      senderName: '',
      senderEmail: '',
    });
    const token = created.checkoutUrl.split('/pay/')[1];
    const emailToken = (created.emailCheckoutUrl ?? created.request.emailCheckoutUrl).split('/pay/e/')[1];

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const contextC = await browser.newContext();

    try {
      const payerA = await registerAndActivate(contextA.request, 'GB');
      const payerB = await registerAndActivate(contextB.request, 'GB');

      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      await pageA.setViewportSize({ width: 375, height: 720 });
      await pageB.setViewportSize({ width: 375, height: 720 });

      // Both Payer A and Payer B open the shared Receive Money link simultaneously and verify email PIN
      await Promise.all([
        pageA.goto(`/pay/${token}`),
        pageB.goto(`/pay/${token}`),
      ]);

      for (const [p, creds] of [[pageA, payerA], [pageB, payerB]]) {
        await p.getByTestId('button-start-pay').click();
        await p.getByTestId('input-payer-email').fill(creds.email);
        await p.getByTestId('button-check-email').click();
        await expect(p.getByTestId('input-pin-code')).toBeVisible({ timeout: 10000 });
        await p.getByTestId('button-fill-dev-pin').click();
        await p.getByTestId('button-verify-pin-pay').click();
        await expect(p.getByTestId('screen-method-select')).toBeVisible({ timeout: 10000 });
      }

      // Window A selects Bank Transfer -> Continue -> locks immediately on screen-bank-transfer-details
      await pageA.getByTestId('button-method-bank_transfer').click();
      await pageA.getByTestId('button-pay-now').click();
      await expect(pageA.getByTestId('screen-bank-transfer-details')).toBeVisible({ timeout: 10000 });

      // Window B automatically transitions (via live polling) to "Payment Currently in Progress" and never sees bank account details
      await expect(pageB.getByTestId('payment-in-progress-other-card')).toBeVisible({ timeout: 10000 });
      await expect(pageB.getByText('Payment Currently in Progress')).toBeVisible();
      await expect(pageB.getByTestId('screen-bank-transfer-details')).toHaveCount(0);

      // Window A clicks Back -> releases the lock -> Window B automatically recovers back to method selection
      await pageA.getByTestId('button-back-to-methods').click();
      await expect(pageA.getByTestId('screen-method-select')).toBeVisible({ timeout: 10000 });
      await expect(pageB.getByTestId('screen-method-select')).toBeVisible({ timeout: 10000 });

      // Now Window B selects Bank Transfer -> Continue -> locks immediately, blocking Window A
      await pageB.getByTestId('button-method-bank_transfer').click();
      await pageB.getByTestId('button-pay-now').click();
      await expect(pageB.getByTestId('screen-bank-transfer-details')).toBeVisible({ timeout: 10000 });
      await expect(pageA.getByTestId('payment-in-progress-other-card')).toBeVisible({ timeout: 10000 });

      // Window B completes the single full payment ("I've sent the money")
      await pageB.getByTestId('button-ive-sent-money').click();
      await expect(pageB.getByTestId('success-card')).toBeVisible({ timeout: 30000 });
      await expect(pageB.getByText('Payment Successful!')).toBeVisible();

      // Window A automatically flips to "Payment Request No Longer Valid" (paid by someone else)
      await expect(pageA.getByTestId('already-paid-card')).toBeVisible({ timeout: 15000 });
      await expect(pageA.getByText('Payment Request No Longer Valid')).toBeVisible();
      await expect(pageA.getByTestId('already-paid-notice')).toContainText('paid by someone else');
      await expect(pageA.getByTestId('already-paid-notice')).toContainText('one full payment');
      await expect(pageA.getByTestId('success-card')).toHaveCount(0);

      // Winning Payer B reloading the link still sees their own "Payment Successful!" receipt
      await pageB.reload();
      await expect(pageB.getByTestId('success-card')).toBeVisible({ timeout: 10000 });

      // Any third visitor (Window C) opening either the share link or email link sees "Payment Request No Longer Valid"
      const pageC = await contextC.newPage();
      await pageC.goto(`/pay/${token}`);
      await expect(pageC.getByTestId('already-paid-card')).toBeVisible({ timeout: 10000 });
      await expect(pageC.getByTestId('mito-summary-card')).toHaveCount(0);

      await pageC.goto(`/pay/e/${emailToken}`);
      await expect(pageC.getByTestId('already-paid-card')).toBeVisible({ timeout: 10000 });
    } finally {
      await contextA.close();
      await contextB.close();
      await contextC.close();
    }
  });

});
