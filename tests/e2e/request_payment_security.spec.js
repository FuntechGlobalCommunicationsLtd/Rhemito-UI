import { test, expect, request as apiRequest } from '@playwright/test';

const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:5000';
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

async function registerActive(context, label) {
  const email = `${label}-${unique()}@example.com`;
  const password = 'Passw0rd!x';
  const registration = await context.post('/api/auth/register', { data: {
    email, password, confirmPassword: password, accountType: 'individual', country: 'GB',
    firstName: label, lastName: 'Payer', dateOfBirth: '1990-05-05', gender: 'female',
    mobileCode: '+44', mobileNumber: '7700900123',
  } });
  expect(registration.ok()).toBeTruthy();
  const verification = await context.post('/api/auth/verify-otp', { data: { email, code: '123456' } });
  expect(verification.ok()).toBeTruthy();
  return { email, password };
}

async function createPaymentRequest(context) {
  const account = await context.post('/api/request-money/payout-accounts', { data: {
    holderName: 'Request Owner', country: 'GB', bankName: 'Barclays',
    accountNumber: `12${Math.floor(100000 + Math.random() * 900000)}`, currency: 'GBP',
  } });
  expect(account.ok()).toBeTruthy();
  const accountId = (await account.json()).data.id;
  expect((await context.post(`/api/dev/payout-accounts/${accountId}/verify`, { data: {} })).ok()).toBeTruthy();
  const created = await context.post('/api/request-money/requests', { data: {
    corridorId: 'GB-GB-GBP', payoutAccountId: accountId, payInAmount: '120.00',
    senderType: 'individual', senderName: 'Original Recipient',
    senderEmail: `recipient-${unique()}@example.com`, purpose: 'invoice_payment',
    reference: 'private requester note', absorbFee: true, idempotencyKey: `security-${unique()}`,
  } });
  expect(created.ok()).toBeTruthy();
  return (await created.json()).data;
}

test.describe('Request Payment security and concurrency', () => {
  test('dual links disclose only permitted pre-auth data and reject user-id impersonation', async () => {
    const owner = await apiRequest.newContext({ baseURL });
    await registerActive(owner, 'Owner');
    const created = await createPaymentRequest(owner);
    const shareToken = created.checkoutUrl.split('/pay/')[1];
    const emailToken = (created.emailCheckoutUrl ?? created.request.emailCheckoutUrl).split('/pay/e/')[1];

    const anonymous = await apiRequest.newContext({ baseURL });
    await anonymous.post('/api/auth/logout', { data: {} });
    const share = await anonymous.get(`/api/public/requests/${shareToken}`);
    expect(share.ok()).toBeTruthy();
    const shareView = (await share.json()).data;
    // The link opens on the Mito Payment summary: ref, fee, rate/payout and the masked bank are public.
    expect(shareView.requestNumber).toMatch(/^RM-/);
    expect(shareView.feeAmount).not.toBeNull();
    expect(shareView.payoutAccountMasked).toMatch(/\d{4}$/);
    expect(shareView.payoutAccountMasked).not.toMatch(/\d{5}/);
    // Everything else stays hidden until the payer identifies.
    expect(shareView.purpose).toBeNull();
    expect(shareView.reference).toBeNull();
    expect(shareView.methods).toEqual([]);
    expect(shareView.activeSessionId).toBeNull();
    expect(shareView.recipientEmailMasked).toBeUndefined();

    const email = await anonymous.get(`/api/public/requests/e/${emailToken}`);
    expect(email.ok()).toBeTruthy();
    expect((await email.json()).data.recipientEmailMasked).toMatch(/\*+@example\.com$/);
    expect((await anonymous.get(`/api/public/requests/${emailToken}`)).status()).toBe(404);
    expect((await anonymous.get(`/api/public/requests/e/${shareToken}`)).status()).toBe(404);

    const forged = await anonymous.post(`/api/public/requests/${shareToken}/session`, { data: { userId: 'user_123' } });
    expect(forged.status()).toBe(401);
    await anonymous.dispose();
    await owner.dispose();
  });

  test('new payer is PIN-verified before registration and payment session creation', async () => {
    const owner = await apiRequest.newContext({ baseURL });
    await registerActive(owner, 'Owner');
    const created = await createPaymentRequest(owner);
    const token = created.checkoutUrl.split('/pay/')[1];

    const payer = await apiRequest.newContext({ baseURL });
    const email = `new-payer-${unique()}@example.com`;
    const sent = await payer.post('/api/public/request-verifications/send', { data: { token, email, isEmailLink: false } });
    expect(sent.ok()).toBeTruthy();
    const pin = (await sent.json()).data.devPin;
    expect(pin).toMatch(/^\d{6}$/);
    expect((await payer.post('/api/auth/register', { data: {
      email, password: 'Passw0rd!x', accountType: 'individual', country: 'GB', firstName: 'Early', lastName: 'User',
      paymentRequestToken: token, isEmailLink: false,
    } })).status()).toBe(403);

    expect((await payer.post('/api/public/request-verifications/verify', { data: { token, email, code: pin, isEmailLink: false } })).ok()).toBeTruthy();
    const registered = await payer.post('/api/auth/register', { data: {
      email, password: 'Passw0rd!x', accountType: 'individual', country: 'GB', firstName: 'New', lastName: 'Payer',
      paymentRequestToken: token, isEmailLink: false,
    } });
    expect(registered.ok()).toBeTruthy();
    expect((await payer.post(`/api/public/requests/${token}/session`, { data: {} })).ok()).toBeTruthy();
    await payer.dispose();
    await owner.dispose();
  });

  test('multiple eligible sessions are allowed but only one submission reserves the request', async () => {
    const owner = await apiRequest.newContext({ baseURL });
    await registerActive(owner, 'Owner');
    const created = await createPaymentRequest(owner);
    const token = created.checkoutUrl.split('/pay/')[1];

    const payerA = await apiRequest.newContext({ baseURL });
    const payerB = await apiRequest.newContext({ baseURL });
    await registerActive(payerA, 'Alice');
    await registerActive(payerB, 'Bob');
    const sessionA = await payerA.post(`/api/public/requests/${token}/session`, { data: {} });
    const sessionB = await payerB.post(`/api/public/requests/${token}/session`, { data: {} });
    expect(sessionA.ok()).toBeTruthy();
    expect(sessionB.ok()).toBeTruthy();
    const idA = (await sessionA.json()).data.sessionId;
    const idB = (await sessionB.json()).data.sessionId;

    const [submitA, submitB] = await Promise.all([
      payerA.post(`/api/public/requests/${token}/pay-intent`, { data: { method: 'pay_by_bank', sessionId: idA } }),
      payerB.post(`/api/public/requests/${token}/pay-intent`, { data: { method: 'pay_by_bank', sessionId: idB } }),
    ]);
    expect([submitA.status(), submitB.status()].sort()).toEqual([200, 409]);
    const cancellation = await owner.post(`/api/request-money/requests/${created.request.id}/cancel`, { data: {} });
    expect(cancellation.status()).toBe(409);

    await payerA.dispose();
    await payerB.dispose();
    await owner.dispose();
  });

  test('bank_transfer reservation hides wire details from other payers, supports release-intent, and blocks all non-winners once paid', async () => {
    const owner = await apiRequest.newContext({ baseURL });
    await registerActive(owner, 'Owner');
    const created = await createPaymentRequest(owner);
    const token = created.checkoutUrl.split('/pay/')[1];
    const emailToken = (created.emailCheckoutUrl ?? created.request.emailCheckoutUrl).split('/pay/e/')[1];

    const payerA = await apiRequest.newContext({ baseURL });
    const payerB = await apiRequest.newContext({ baseURL });
    const anonymous = await apiRequest.newContext({ baseURL });
    await anonymous.post('/api/auth/logout', { data: {} });
    await registerActive(payerA, 'Alice');
    await registerActive(payerB, 'Bob');

    const sessionARes = await payerA.post(`/api/public/requests/${token}/session`, { data: {} });
    const sessionBRes = await payerB.post(`/api/public/requests/${token}/session`, { data: {} });
    expect(sessionARes.ok()).toBeTruthy();
    expect(sessionBRes.ok()).toBeTruthy();
    const sessionA = (await sessionARes.json()).data.sessionId;
    const sessionB = (await sessionBRes.json()).data.sessionId;

    // Payer A locks Bank Transfer immediately when opening transfer details
    const intentARes = await payerA.post(`/api/public/requests/${token}/pay-intent`, {
      data: { method: 'bank_transfer', sessionId: sessionA },
    });
    expect(intentARes.status()).toBe(200);
    const intentA = (await intentARes.json()).data.intentId;

    // Payer A sees collectionAccount and isReservedByOther === false
    const viewA = (await (await payerA.get(`/api/public/requests/${token}`)).json()).data;
    expect(viewA.isReservedByOther).toBe(false);
    expect(viewA.collectionAccount).toBeTruthy();

    // Payer B and anonymous see isReservedByOther === true and NEVER receive collectionAccount wire details
    const viewB = (await (await payerB.get(`/api/public/requests/${token}`)).json()).data;
    expect(viewB.isReservedByOther).toBe(true);
    expect(viewB.collectionAccount).toBeUndefined();

    const viewAnon = (await (await anonymous.get(`/api/public/requests/${token}`)).json()).data;
    expect(viewAnon.isReservedByOther).toBe(true);
    expect(viewAnon.collectionAccount).toBeUndefined();

    // Payer B cannot reserve or send verification PIN while locked by Payer A
    const blockedIntentB = await payerB.post(`/api/public/requests/${token}/pay-intent`, {
      data: { method: 'bank_transfer', sessionId: sessionB },
    });
    expect(blockedIntentB.status()).toBe(409);
    expect((await blockedIntentB.json()).error?.code).toBe('PAYMENT_IN_PROGRESS');

    const blockedPin = await anonymous.post('/api/public/request-verifications/send', {
      data: { token, email: `late-${unique()}@example.com`, isEmailLink: false },
    });
    expect(blockedPin.status()).toBe(409);
    expect((await blockedPin.json()).error?.code).toBe('PAYMENT_IN_PROGRESS');

    // Payer B cannot release Payer A's reservation
    const wrongRelease = await payerB.post(`/api/public/requests/${token}/release-intent`, {
      data: { intentId: intentA },
    });
    expect(wrongRelease.ok()).toBeTruthy();
    expect((await wrongRelease.json()).data.released).toBe(false);
    expect((await (await payerB.get(`/api/public/requests/${token}`)).json()).data.isReservedByOther).toBe(true);

    // Payer A goes Back / cancels -> releases reservation
    const released = await payerA.post(`/api/public/requests/${token}/release-intent`, {
      data: { intentId: intentA },
    });
    expect(released.ok()).toBeTruthy();
    expect((await released.json()).data.released).toBe(true);

    // Now Payer B can lock Bank Transfer and complete the single full payment
    const intentBRes = await payerB.post(`/api/public/requests/${token}/pay-intent`, {
      data: { method: 'bank_transfer', sessionId: sessionB },
    });
    expect(intentBRes.status()).toBe(200);
    const intentB = (await intentBRes.json()).data.intentId;

    const authorized = await payerB.post(`/api/dev/payin/${intentB}/authorize`, { data: {} });
    expect(authorized.ok()).toBeTruthy();

    // Poll briefly until auto-settlement reaches paid_out (~3s dev payout timer)
    let finalViewB = null;
    for (let i = 0; i < 35; i++) {
      finalViewB = (await (await payerB.get(`/api/public/requests/${token}`)).json()).data;
      if (finalViewB.status === 'paid_out') break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(finalViewB.status).toBe('paid_out');
    expect(finalViewB.isPaidByCurrentUser).toBe(true);

    // Non-winning Payer A, anonymous share link, and email link all report isPaidByCurrentUser === false and hide wire details
    const finalViewA = (await (await payerA.get(`/api/public/requests/${token}`)).json()).data;
    expect(finalViewA.status).toBe('paid_out');
    expect(finalViewA.isPaidByCurrentUser).toBe(false);
    expect(finalViewA.collectionAccount).toBeUndefined();

    const finalEmailView = (await (await anonymous.get(`/api/public/requests/e/${emailToken}`)).json()).data;
    expect(finalEmailView.status).toBe('paid_out');
    expect(finalEmailView.isPaidByCurrentUser).toBe(false);

    // Any subsequent session / PIN / pay-intent attempt returns 409 ALREADY_PAID
    const postPaidSession = await payerA.post(`/api/public/requests/${token}/session`, { data: {} });
    expect(postPaidSession.status()).toBe(409);
    expect((await postPaidSession.json()).error?.code).toBe('ALREADY_PAID');

    const postPaidPin = await anonymous.post('/api/public/request-verifications/send', {
      data: { token, email: `after-paid-${unique()}@example.com`, isEmailLink: false },
    });
    expect(postPaidPin.status()).toBe(409);
    expect((await postPaidPin.json()).error?.code).toBe('ALREADY_PAID');

    await anonymous.dispose();
    await payerA.dispose();
    await payerB.dispose();
    await owner.dispose();
  });
});
