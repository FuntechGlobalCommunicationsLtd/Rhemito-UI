import { test, expect } from '@playwright/test';

/**
 * Send Invoice MVP1 — end-to-end journeys.
 *
 * Tests are self-contained: every test registers its own sender (register +
 * OTP activation starts a session with mini-KYC passed), adds a verified
 * payout account through the same server-owned store Request Payment uses,
 * and creates invoices with unique client data. The payout account is only
 * ever referenced by id — the browser never supplies raw bank details.
 */

const uniqueSuffix = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Registers "John Doe", activates via OTP — the page context becomes the sender. */
async function setupSender(page) {
  const request = page.context().request;
  const email = `inv-${uniqueSuffix()}@example.com`;
  const register = await request.post('/api/auth/register', {
    data: {
      email,
      accountType: 'individual',
      country: 'GB',
      firstName: 'John',
      lastName: 'Doe',
      dateOfBirth: '1990-05-05',
      gender: 'male',
      mobileCode: '+44',
      mobileNumber: '7700900123',
      password: 'Passw0rd!x',
      confirmPassword: 'Passw0rd!x',
    },
  });
  expect(register.ok()).toBeTruthy();
  const verify = await request.post('/api/auth/verify-otp', { data: { email, code: '123456' } });
  expect(verify.ok()).toBeTruthy();
  return { request, email };
}

/** Adds and (dev-stub) verifies a Barclays GBP payout account owned by the session user. */
async function addVerifiedAccount(request) {
  const res = await request.post('/api/request-money/payout-accounts', {
    data: {
      holderName: 'John Doe',
      country: 'GB',
      bankName: 'Barclays',
      accountNumber: `123${Math.floor(1000000 + Math.random() * 9000000)}`,
      currency: 'GBP',
    },
  });
  expect(res.ok()).toBeTruthy();
  const { data } = await res.json();
  const verify = await request.post(`/api/dev/payout-accounts/${data.id}/verify`, { data: {} });
  expect(verify.ok()).toBeTruthy();
  return data.id;
}

async function uploadDocument(request) {
  const res = await request.post('/api/invoices/documents?fileName=e2e-invoice.pdf&mimeType=application/pdf', {
    headers: { 'Content-Type': 'application/octet-stream' },
    data: Buffer.from('%PDF-1.4 e2e test invoice document'),
  });
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  return json.data.documentId;
}

async function createInvoiceViaApi(request, overrides = {}) {
  const suffix = uniqueSuffix();
  const payload = {
    documentId: await uploadDocument(request),
    invoiceAmount: '150.00',
    currency: 'GBP',
    absorbFee: false,
    payoutAccountId: await addVerifiedAccount(request),
    clientType: 'individual',
    clientFirstName: 'Ella',
    clientLastName: `Testee-${suffix}`,
    clientEmail: `ella-${suffix}@example.com`,
    expiry: { type: 'preset', days: 14 },
    idempotencyKey: `e2e-${suffix}`,
    ...overrides,
  };
  const res = await request.post('/api/invoices', { data: payload });
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  return {
    invoice: json.data.invoice,
    paymentLink: json.data.paymentLink,
    token: json.data.paymentLink.split('/invoice/')[1],
  };
}

test.describe('Send Invoice MVP1 E2E', () => {

  test('Account creation appears in Send Invoice when no verified payout account exists', async ({ page }) => {
    const { request, email: senderEmail } = await setupSender(page);

    await page.goto('/send-invoice');
    // CSS locator: the auto-opening dialog sets aria-hidden on the app root,
    // which hides the heading from role queries while the modal is open
    await expect(page.locator('h1:has-text("Send Invoice")')).toBeVisible({ timeout: 10000 });

    // Mandatory-account state — same account-creation path as Request Payment
    await expect(page.getByTestId('payout-account-required')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('button-add-first-payout-account')).toBeVisible();

    // The add-and-verify dialog auto-opens (identical to Request Payment)
    await expect(page.getByTestId('dialog-add-payout-account')).toBeVisible();
    await expect(page.getByTestId('dialog-add-payout-account')).toContainText('Verified Name');

    // Add + verify through the dialog (development verification stub)
    await page.getByTestId('input-account-bank').fill('NatWest');
    await page.getByTestId('input-account-number').fill('98765432');
    await page.getByTestId('button-save-account').click();
    await expect(page.getByTestId('payout-account-required')).toBeHidden({ timeout: 10000 });

    // The verified server-owned account becomes the receiving payout account
    await expect(page.getByTestId('payout-account-card')).toBeVisible();
    await expect(page.getByTestId('payout-account-card')).toContainText('Receiving Settlement Bank Account');
    await expect(page.getByTestId('payout-account-card')).toContainText('NatWest');
    await expect(page.getByTestId('payout-account-card')).toContainText('John Doe');
    await expect(page.getByTestId('payout-account-card')).toContainText('Default');

    // The account was persisted server-side (server-owned store, not local state)
    const accounts = await (await request.get('/api/request-money/payout-accounts')).json();
    expect(accounts.data.some((a) => a.bankName === 'NatWest' && a.verificationStatus === 'verified')).toBeTruthy();
  });

  test('Complete journey: form → review → back to edit → review → confirm and send', async ({ page }) => {
    const { request, email: senderEmail } = await setupSender(page);
    await addVerifiedAccount(request);
    const suffix = uniqueSuffix();
    const clientEmail = `journey-${suffix}@example.com`;

    await page.goto('/send-invoice');
    await expect(page.getByRole('heading', { name: 'Send Invoice' })).toBeVisible();

    // Upload mode — "Generate Invoice" (generate on the go) is the default tab
    await page.getByTestId('tab-upload-document').click();

    // Receiving Settlement Bank Account — default verified account preselected, same
    // flow as Request Payment
    await expect(page.getByTestId('payout-account-card')).toBeVisible();
    await expect(page.getByTestId('payout-account-card')).toContainText('Receiving Settlement Bank Account');
    await expect(page.getByTestId('payout-account-card')).toContainText('Barclays');
    await expect(page.getByTestId('payout-account-card')).toContainText('Default');
    await expect(page.getByTestId('button-toggle-change-payout')).toBeVisible();

    // Upload the mandatory invoice document
    await page.locator('input[type="file"]').setInputFiles({
      name: 'invoice.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 journey invoice'),
    });
    await expect(page.getByText('Attached')).toBeVisible({ timeout: 10000 });

    // Fill the form
    await page.getByTestId('input-invoice-amount').fill('250');
    await page.getByTestId('input-recipient-first-name').fill('Ada');
    await page.getByTestId('input-recipient-last-name').fill('Lovelace');
    await page.getByTestId('input-recipient-email').fill(clientEmail);

    // Matching currencies (GBP invoice, GBP payout account) → no FX notice
    await expect(page.getByTestId('fx-conversion-notice')).toHaveCount(0);

    // Mismatched currencies (NGN invoice, GBP payout account) → FX notice
    await page.getByTestId('select-currency').click();
    await page.getByRole('option', { name: 'NGN (₦)' }).click();
    await expect(page.getByTestId('fx-conversion-notice')).toContainText('live FX spot rates');
    await page.getByTestId('select-currency').click();
    await page.getByRole('option', { name: 'GBP (£)' }).click();
    await expect(page.getByTestId('fx-conversion-notice')).toHaveCount(0);

    const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await page.getByTestId('input-due-date').fill(dueDate);

    // Default expiry follows the due date (7 days after) and shows the preview
    await expect(page.getByTestId('select-expiry-period')).toContainText('7 days');
    await expect(page.getByTestId('text-expiry-preview')).toContainText('This payment link will expire on');
    await expect(page.getByTestId('text-expiry-preview')).toContainText('11:59 p.m.');

    // No invoice record exists before confirmation (no drafts, ever)
    const before = await (await request.get(`/api/invoices?search=${clientEmail}`)).json();
    expect(before.meta.total).toBe(0);

    // Review step
    await page.getByTestId('button-review-invoice').click();
    await expect(page.getByRole('heading', { name: 'Review and Confirm' })).toBeVisible();
    await expect(page.getByTestId('alert-immutability-warning')).toContainText(
      'Please review the invoice carefully. Once sent, the invoice details, Due Date and Payment Link Expiry Date cannot be changed.',
    );
    await expect(page.getByTestId('review-amount')).toContainText('£250.00 GBP');
    await expect(page.getByTestId('review-client-email')).toHaveText(clientEmail);
    await expect(page.getByTestId('review-client-pays')).toContainText('£257.50'); // 3% fee added
    await expect(page.getByTestId('review-you-receive')).toContainText('£250.00');
    await expect(page.getByTestId('review-payout-account')).toContainText('Barclays');
    await expect(page.getByTestId('review-payout-account')).toContainText('John Doe');
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const dueParts = dueDate.split('-').map(Number);
    const humanDueDate = `${dueParts[2]} ${MONTHS[dueParts[1] - 1]} ${dueParts[0]}`;
    await expect(page.getByTestId('review-due-date')).toContainText(humanDueDate);

    // Still no invoice record at the review step
    const atReview = await (await request.get(`/api/invoices?search=${clientEmail}`)).json();
    expect(atReview.meta.total).toBe(0);

    // Back to Edit retains everything entered during this journey
    await page.getByTestId('button-back-to-edit').click();
    await expect(page.getByTestId('input-invoice-amount')).toHaveValue('250');
    await expect(page.getByTestId('input-recipient-email')).toHaveValue(clientEmail);
    await expect(page.getByTestId('input-due-date')).toHaveValue(dueDate);

    // Review again and confirm
    await page.getByTestId('button-review-invoice').click();
    await page.getByTestId('button-confirm-send-invoice').click();
    await expect(page.getByText('Invoice Sent!')).toBeVisible({ timeout: 15000 });

    // Success screen shows the real server-generated invoice number and link
    const linkInput = page.getByTestId('input-invoice-link');
    await expect(linkInput).toHaveValue(/\/invoice\/[0-9a-f]{40,}/);

    // Exactly one invoice was created for this client
    const after = await (await request.get(`/api/invoices?search=${clientEmail}`)).json();
    expect(after.meta.total).toBe(1);
    expect(after.data[0].invoiceNumber).toMatch(/^INV-\d{6}-\d{5}$/);

    // The invoice_sent client email carries the document as an attachment
    const details = await (await request.get(`/api/invoices/${after.data[0].id}`)).json();
    const sentEmail = details.data.emails.find((e) => e.type === 'invoice_sent');
    expect(sentEmail.attachmentFileName).toContain('.pdf');
  });

  test('Date validation: past dates are rejected and the expiry never precedes the Due Date', async ({ page }) => {
    const { request, email: senderEmail } = await setupSender(page);
    await addVerifiedAccount(request);

    await page.goto('/send-invoice');

    // Upload mode — "Generate Invoice" (generate on the go) is the default tab
    await page.getByTestId('tab-upload-document').click();

    await page.locator('input[type="file"]').setInputFiles({
      name: 'invoice.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 validation invoice'),
    });
    await expect(page.getByText('Attached')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('input-invoice-amount').fill('100');
    await page.getByTestId('input-recipient-first-name').fill('Bea');
    await page.getByTestId('input-recipient-email').fill(`bea-${uniqueSuffix()}@example.com`);

    // Past Due Date is rejected with the exact message and blocks review
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await page.getByTestId('input-due-date').fill(yesterday);
    await expect(page.getByTestId('error-due-date')).toHaveText('The Due Date cannot be in the past.');
    await expect(page.getByTestId('button-review-invoice')).toBeDisabled();

    // Past custom expiry (no due date conflict) is still rejected
    await page.getByTestId('input-due-date').fill('');
    await page.getByTestId('select-expiry-period').click();
    await page.getByRole('option', { name: 'Custom date' }).click();
    await page.getByTestId('input-custom-expiry-date').fill(yesterday);
    await expect(page.getByTestId('error-expiry')).toHaveText('Select a future Payment Link Expiry Date.');
    await expect(page.getByTestId('button-review-invoice')).toBeDisabled();

    // Setting a Due Date past the custom expiry bumps the expiry up to the Due
    // Date automatically — the two fields can never conflict
    const dueDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await page.getByTestId('input-due-date').fill(dueDate);
    await expect(page.getByTestId('input-custom-expiry-date')).toHaveValue(dueDate);
    await expect(page.getByTestId('error-expiry')).toHaveCount(0);
    await expect(page.getByTestId('button-review-invoice')).toBeEnabled();

    // Entering a custom expiry before the Due Date is normalised up to it
    const earlyExpiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await page.getByTestId('input-custom-expiry-date').fill(earlyExpiry);
    await expect(page.getByTestId('input-custom-expiry-date')).toHaveValue(dueDate);
    await expect(page.getByTestId('error-expiry')).toHaveCount(0);
    await expect(page.getByTestId('button-review-invoice')).toBeEnabled();

    // A later custom expiry is kept as entered
    const validExpiry = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await page.getByTestId('input-custom-expiry-date').fill(validExpiry);
    await expect(page.getByTestId('input-custom-expiry-date')).toHaveValue(validExpiry);
    await expect(page.getByTestId('button-review-invoice')).toBeEnabled();
  });

  test('Client pays an active invoice through the public payment page', async ({ page, request: api }) => {
    const { request, email: senderEmail } = await setupSender(page);
    const { invoice, token } = await createInvoiceViaApi(request, { invoiceAmount: '120.00' });

    // A registered Rhemito account for the paying client (isolated API context)
    const payerEmail = `inv-payer-${uniqueSuffix()}@example.com`;
    await api.post('/api/auth/register', {
      data: {
        email: payerEmail,
        accountType: 'individual',
        country: 'GB',
        firstName: 'Ella',
        lastName: 'Client',
        dateOfBirth: '1990-02-02',
        gender: 'female',
        mobileCode: '+44',
        mobileNumber: '7700900123',
        password: 'Passw0rd!x',
        confirmPassword: 'Passw0rd!x',
      },
    });
    await api.post('/api/auth/verify-otp', { data: { email: payerEmail, code: '123456' } });

    await page.goto(`/invoice/${token}`);

    // Public payment page shows the required details
    await expect(page.getByTestId('public-invoice-number')).toHaveText(invoice.invoiceNumber);
    await expect(page.getByTestId('public-invoice-amount')).toContainText('£120.00');
    await expect(page.getByTestId('public-client-pays')).toContainText('£123.60'); // 3% fee
    await expect(page.getByTestId('public-invoice-status')).toContainText(/sent/i);

    // The invoice document is NOT exposed before identification
    await expect(page.getByTestId('button-view-invoice-document')).toHaveCount(0);

    // Prototype tip surfaces the registered demo login email
    await expect(page.getByTestId('demo-login-hint')).toContainText('payer@rhemito.com');

    // Identify as the payer first (registered email → password sign-in)
    await page.getByTestId('input-payer-email').fill(payerEmail);
    await page.getByTestId('button-check-email').click();
    await expect(page.getByTestId('input-payer-password')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('input-payer-password').fill('Passw0rd!x');
    await page.getByTestId('button-signin-pay').click();

    // Now identified, the client can view the invoice document behind the same token
    await expect(page.getByTestId('button-view-invoice-document')).toBeVisible({ timeout: 10000 });
    const docResponse = await request.get(`/api/public/invoices/${token}/document`);
    expect(docResponse.ok()).toBeTruthy();

    // Pay → choose method → processing → completed
    await expect(page.getByTestId('button-pay-invoice')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('button-pay-invoice').click();
    await page.getByTestId('button-pay-card').click();
    await expect(page.getByTestId('processing-card')).toBeVisible();
    await expect(page.getByTestId('paid-card')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('text-paid')).toContainText(invoice.invoiceNumber);

    // Revisit: paid invoices cannot be paid again
    await page.goto(`/invoice/${token}`);
    await expect(page.getByTestId('paid-card')).toBeVisible();
    await expect(page.getByTestId('text-paid')).toContainText('already been paid');
    await expect(page.getByTestId('button-pay-invoice')).toHaveCount(0);

    // Dashboard reflects the paid status — switch the browser session back to the sender
    const pageRequest = page.context().request;
    await pageRequest.post('/api/auth/logout', { data: {} });
    await pageRequest.post('/api/auth/login', { data: { email: senderEmail, password: 'Passw0rd!x' } });
    await page.goto('/?type=invoice');
    const row = page.getByTestId(`row-invoice-${invoice.invoiceNumber}`);
    await expect(row).toBeVisible();
    await expect(row.getByText('Paid', { exact: true })).toBeVisible();
  });

  test('Unregistered client verifies a PIN, registers (prefilled) and pays the invoice', async ({ page }) => {
    const { request } = await setupSender(page);
    const { invoice, token } = await createInvoiceViaApi(request);
    const clientEmail = `new-client-${uniqueSuffix()}@example.com`;

    await page.goto(`/invoice/${token}`);

    // Unknown email → 6-digit PIN verification (devPin surfaced in demo mode)
    await page.getByTestId('input-payer-email').fill(clientEmail);
    await page.getByTestId('button-check-email').click();
    const tip = page.getByTestId('dev-pin-hint');
    await expect(tip).toBeVisible({ timeout: 10000 });
    const pin = (await tip.innerText()).match(/\d{6}/)[0];
    await page.getByTestId('input-pin-code').fill(pin);
    await page.getByTestId('button-verify-pin').click();

    // Compact registration prefilled from the invoice client snapshot
    await expect(page.getByTestId('input-reg-first-name')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('input-reg-first-name')).toHaveValue('Ella');
    await expect(page.getByTestId('input-reg-last-name')).toHaveValue(/Testee-/);
    await page.getByTestId('select-register-country').click();
    await page.getByRole('option', { name: /United Kingdom/ }).click();
    await page.getByTestId('input-reg-dob').fill('1990-02-02');
    await page.getByTestId('select-register-gender').click();
    await page.getByRole('option', { name: 'Female' }).click();
    await page.getByPlaceholder('Contact number').fill('7700900456');
    await page.getByTestId('input-reg-password').fill('Passw0rd!x');
    await page.getByTestId('input-reg-confirm-password').fill('Passw0rd!x');
    await page.getByTestId('button-register-pay').click();

    // Identified (account activated + signed in) → pay through the normal journey
    await expect(page.getByTestId('button-pay-invoice')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('button-pay-invoice').click();
    await page.getByTestId('button-pay-card').click();
    await expect(page.getByTestId('paid-card')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('text-paid')).toContainText(invoice.invoiceNumber);
  });

  test('Invoice payment requires an identified payer (anonymous API pay returns 401)', async ({ page }) => {
    const { request } = await setupSender(page);
    const { token } = await createInvoiceViaApi(request);

    // A pristine context with no session must not be able to start a payment
    // or view the invoice document
    const anonymous = await page.context().browser().newContext();
    const res = await anonymous.request.post(`/api/public/invoices/${token}/pay`, { data: { method: 'card' } });
    expect(res.status()).toBe(401);
    const docRes = await anonymous.request.get(`/api/public/invoices/${token}/document`);
    expect(docRes.status()).toBe(401);
    await anonymous.close();
  });

  test('Sender cancels an active invoice; client is informed and payment is blocked', async ({ page }) => {
    const { request, email: senderEmail } = await setupSender(page);
    const { invoice, token } = await createInvoiceViaApi(request);

    await page.goto('/?type=invoice');
    const row = page.getByTestId(`row-invoice-${invoice.invoiceNumber}`);
    await expect(row).toBeVisible();

    // Cancel modal requires a reason and shows the mandatory warning copy
    await row.getByTestId(`button-actions-more-${invoice.invoiceNumber}`).click();
    await page.getByTestId(`button-cancel-${invoice.invoiceNumber}`).click();
    const dialog = page.getByTestId('dialog-cancel-invoice');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('cancel-summary')).toContainText(invoice.invoiceNumber);
    await expect(dialog.getByTestId('cancel-warning')).toContainText(
      'Cancelling this invoice is permanent. Your client will no longer be able to pay using this link.',
    );
    await expect(dialog.getByText('This reason will be shared with the client.')).toBeVisible();

    // Empty reason keeps the confirm button disabled
    await expect(dialog.getByTestId('button-confirm-cancel')).toBeDisabled();
    await dialog.getByTestId('input-cancel-reason').fill('Incorrect amount — a corrected invoice will follow.');
    await dialog.getByTestId('button-confirm-cancel').click();

    // Row flips to Cancelled
    await expect(row.getByText('Cancelled', { exact: true })).toBeVisible({ timeout: 10000 });

    // Client page shows the cancellation and reason, with no payment CTA
    await page.goto(`/invoice/${token}`);
    await expect(page.getByTestId('cancelled-invoice-card')).toBeVisible();
    await expect(page.getByTestId('text-cancelled')).toContainText('This invoice was cancelled by the sender on');
    await expect(page.getByTestId('text-cancellation-reason')).toContainText('Incorrect amount');
    await expect(page.getByTestId('button-pay-invoice')).toHaveCount(0);

    // Details view shows cancellation information and never offers edit/extend/reactivate
    await page.goto(`/sent-invoices/${invoice.id}`);
    await expect(page.getByTestId('cancellation-details')).toContainText('Incorrect amount');
    await expect(page.getByTestId('invoice-detail-actions')).not.toContainText('Edit');
    await expect(page.getByTestId('invoice-detail-actions')).not.toContainText('Extend');
    await expect(page.getByTestId('invoice-detail-actions')).not.toContainText('Reactivate');
  });

  test('Expired invoice blocks payment and supports Request New Payment Link', async ({ page }) => {
    const { request, email: senderEmail } = await setupSender(page);
    const { invoice, token } = await createInvoiceViaApi(request);

    // Simulate the expiry passing (dev-only hook enabled for the e2e server)
    const sim = await request.post(`/api/dev/invoices/${invoice.id}/simulate-expiry`);
    expect(sim.ok()).toBeTruthy();

    await page.goto(`/invoice/${token}`);
    await expect(page.getByTestId('expired-invoice-card')).toBeVisible();
    await expect(page.getByTestId('text-expired')).toContainText('This payment link expired on');
    await expect(page.getByTestId('text-expired')).toContainText(invoice.senderName);
    await expect(page.getByTestId('button-pay-invoice')).toHaveCount(0);

    // Direct API payment attempts cannot bypass expiry
    const payAttempt = await request.post(`/api/public/invoices/${token}/pay`, { data: {} });
    expect(payAttempt.status()).toBe(410);

    // Request a new payment link — exactly once
    await page.getByTestId('button-request-new-link').click();
    await expect(page.getByTestId('text-request-sent')).toHaveText(
      'Your request has been sent to the invoice sender.',
    );
    await expect(page.getByTestId('button-request-sent')).toBeDisabled();

    // Revisiting shows the already-requested state (no duplicate requests)
    await page.goto(`/invoice/${token}`);
    await expect(page.getByTestId('request-sent-state')).toBeVisible();

    // Sender sees the request on the expired invoice and a Create New Invoice action
    await page.goto(`/sent-invoices/${invoice.id}`);
    await expect(page.getByTestId('status-badge-expired')).toBeVisible();
    await expect(page.getByTestId('new-link-request')).toContainText('New payment link requested');
    await expect(page.getByTestId('button-create-new-detail')).toBeVisible();

    // Create New Invoice opens a fresh, unsaved Send Invoice process
    await page.getByTestId('button-create-new-detail').click();
    await expect(page.getByRole('heading', { name: 'Send Invoice' })).toBeVisible();
    await page.getByTestId('tab-upload-document').click();
    await expect(page.getByTestId('input-invoice-amount')).toHaveValue('');
  });

  test('Overdue invoice remains payable until expiry and can be cancelled', async ({ page }) => {
    const { request, email: senderEmail } = await setupSender(page);
    const dueTomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { invoice, token } = await createInvoiceViaApi(request, { dueDate: dueTomorrow });

    // Simulate the due date passing (dev-only hook)
    await request.post(`/api/dev/invoices/${invoice.id}/simulate-overdue`);

    await page.goto(`/invoice/${token}`);

    // Identify (the registered sender account of this page session) to reach the payment area
    await page.getByTestId('input-payer-email').fill(senderEmail);
    await page.getByTestId('button-check-email').click();
    await expect(page.getByTestId('input-payer-password')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('input-payer-password').fill('Passw0rd!x');
    await page.getByTestId('button-signin-pay').click();

    await expect(page.getByTestId('overdue-banner')).toContainText(
      'This invoice is overdue, but you can still make payment until',
    );
    await expect(page.getByTestId('button-pay-invoice')).toBeVisible({ timeout: 10000 });

    // Dashboard shows Overdue with the cancel action still available
    await page.goto('/?type=invoice');
    const row = page.getByTestId(`row-invoice-${invoice.invoiceNumber}`);
    await expect(row.getByText('Overdue', { exact: true })).toBeVisible();
    await row.getByTestId(`button-actions-more-${invoice.invoiceNumber}`).click();
    await expect(page.getByTestId(`button-cancel-${invoice.invoiceNumber}`)).toBeVisible();
  });

  test('Dashboard search narrows invoice rows and cancelled status is reflected', async ({ page }) => {
    const { request, email: senderEmail } = await setupSender(page);
    const emailA = `search-a-${uniqueSuffix()}@example.com`;
    const emailB = `search-b-${uniqueSuffix()}@example.com`;

    const invA = await createInvoiceViaApi(request, { clientEmail: emailA, clientFirstName: 'Zara', clientLastName: 'Search-A' });
    await createInvoiceViaApi(request, { clientEmail: emailB, clientFirstName: 'Zara', clientLastName: 'Search-B' });

    await page.goto('/?type=invoice');

    // Search by invoice number narrows to one row
    await page.getByTestId('input-search-transactions').fill(invA.invoice.invoiceNumber);
    await expect(page.getByTestId(`row-invoice-${invA.invoice.invoiceNumber}`)).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid^="row-invoice-"]')).toHaveCount(1);

    // Search by client email works too
    await page.getByTestId('input-search-transactions').fill(emailB);
    await expect(page.locator('[data-testid^="row-invoice-"]')).toHaveCount(1, { timeout: 10000 });

    // A cancelled invoice stays in the table with its cancelled status
    await request.post(`/api/invoices/${invA.invoice.id}/cancel`, { data: { reason: 'Search filter test' } });
    await page.getByTestId('input-search-transactions').fill(emailA);
    await expect(page.getByTestId(`row-invoice-${invA.invoice.invoiceNumber}`).getByText('Cancelled', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid^="row-invoice-"]')).toHaveCount(1);

    // No edit-style actions exist anywhere on the dashboard
    await expect(page.getByRole('button', { name: /^Edit$/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Extend Expiry/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Reactivate/i })).toHaveCount(0);
  });

  test('Mandatory fields appear above optional fields in Send Invoice and InvoiceItemsBuilder', async ({ page }) => {
    const { request } = await setupSender(page);
    await addVerifiedAccount(request);

    await page.goto('/send-invoice');
    await expect(page.getByRole('heading', { name: 'Send Invoice' })).toBeVisible();

    // Generate mode (default): item mandatory fields (name, qty, unit price) sit above optional detail & discount
    const itemNameBox = await page.getByTestId('input-item-name-0').boundingBox();
    const itemQtyBox = await page.getByTestId('input-item-qty-0').boundingBox();
    const itemUnitBox = await page.getByTestId('input-item-unit-0').boundingBox();
    const itemDetailBox = await page.getByTestId('input-item-detail-0').boundingBox();
    const itemDiscountBox = await page.getByTestId('select-item-discount-type-0').boundingBox();

    expect(itemNameBox.y).toBeLessThan(itemDetailBox.y);
    expect(itemQtyBox.y).toBeLessThan(itemDetailBox.y);
    expect(itemUnitBox.y).toBeLessThan(itemDetailBox.y);
    expect(itemDetailBox.y).toBeLessThan(itemDiscountBox.y);

    // Recipient & dates section: mandatory Email & Payment Link Expiry sit above optional Phone & Due Date
    const emailBox = await page.getByTestId('input-recipient-email').boundingBox();
    const expiryBox = await page.getByTestId('select-expiry-period').boundingBox();
    const phoneBox = await page.getByTestId('input-recipient-phone').boundingBox();
    const dueDateBox = await page.getByTestId('input-due-date').boundingBox();

    expect(emailBox.y).toBeLessThan(expiryBox.y);
    expect(expiryBox.y).toBeLessThan(phoneBox.y);
    expect(phoneBox.y).toBeLessThan(dueDateBox.y);
  });

});
