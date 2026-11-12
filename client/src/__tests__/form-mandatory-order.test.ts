import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const srcRoot = path.resolve(__dirname, "..");

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(srcRoot, relPath), "utf8");
}

describe("Mandatory fields on top & RequestPayment Step 2 cleanup", () => {
  it("RequestPayment: updates mode-less copy, removes Step 2 Edit amount bar, and keeps mandatory fields above optional fields", () => {
    const code = readSrc("pages/RequestPayment.tsx");

    expect(code).toContain("All the fees and commission will be charged from the amount you receive.");
    expect(code).not.toContain("The 3% fee comes out of what you receive.");
    expect(code).not.toContain('data-testid="request-summary"');
    expect(code).not.toContain('data-testid="button-edit-amount"');

    const step2Start = code.indexOf("STEP 2: PAYMENT REQUEST");
    expect(step2Start).toBeGreaterThan(-1);
    const step2 = code.slice(step2Start);

    const reasonIdx = step2.indexOf('data-testid="select-reason"');
    const expiryIdx = step2.indexOf('data-testid="select-expiry-period"');
    const emailIdx = step2.indexOf('data-testid="input-sender-email"');
    const noteIdx = step2.indexOf('data-testid="input-note"');
    const refIdx = step2.indexOf('data-testid="input-invoice-reference"');
    const payerDetailsIdx = step2.indexOf('data-testid="toggle-payer-details"');

    expect(reasonIdx).toBeGreaterThan(-1);
    expect(reasonIdx).toBeLessThan(expiryIdx);
    expect(expiryIdx).toBeLessThan(emailIdx);
    expect(emailIdx).toBeLessThan(noteIdx);
    expect(noteIdx).toBeLessThan(refIdx);
    expect(refIdx).toBeLessThan(payerDetailsIdx);
  });

  it("SendInvoice & InvoiceItemsBuilder: keeps mandatory fields above optional fields", () => {
    const invoicePage = readSrc("pages/SendInvoice.tsx");
    const emailIdx = invoicePage.indexOf('data-testid="input-recipient-email"');
    const expiryIdx = invoicePage.indexOf('data-testid="select-expiry-period"');
    const phoneIdx = invoicePage.indexOf('data-testid="input-recipient-phone"');
    const dueDateIdx = invoicePage.indexOf('data-testid="input-due-date"');

    expect(emailIdx).toBeGreaterThan(-1);
    expect(emailIdx).toBeLessThan(expiryIdx);
    expect(expiryIdx).toBeLessThan(phoneIdx);
    expect(phoneIdx).toBeLessThan(dueDateIdx);

    const builder = readSrc("components/invoices/InvoiceItemsBuilder.tsx");
    const nameIdx = builder.indexOf("input-item-name-");
    const qtyIdx = builder.indexOf("input-item-qty-");
    const unitIdx = builder.indexOf("input-item-unit-");
    const detailIdx = builder.indexOf("input-item-detail-");
    const discountIdx = builder.indexOf("select-item-discount-type-");

    expect(nameIdx).toBeGreaterThan(-1);
    expect(nameIdx).toBeLessThan(qtyIdx);
    expect(qtyIdx).toBeLessThan(unitIdx);
    expect(unitIdx).toBeLessThan(detailIdx);
    expect(detailIdx).toBeLessThan(discountIdx);
  });

  it("CreateCampaign: keeps mandatory Description above optional Fixed Contribution Amount toggle", () => {
    const code = readSrc("pages/GroupPay/CreateCampaign.tsx");
    const nameIdx = code.indexOf('htmlFor="name"');
    const amountIdx = code.indexOf('htmlFor="amount"');
    const descIdx = code.indexOf('htmlFor="description"');
    const fixedToggleIdx = code.indexOf('id="fixed-amount-toggle"');

    expect(nameIdx).toBeGreaterThan(-1);
    expect(nameIdx).toBeLessThan(amountIdx);
    expect(amountIdx).toBeLessThan(descIdx);
    expect(descIdx).toBeLessThan(fixedToggleIdx);
  });

  it("SendMoney: keeps Relationship, Reason for transfer, and Narration above Nickname (Optional)", () => {
    const code = readSrc("pages/SendMoney.tsx");
    const relIdx = code.indexOf("<Label>Relationship");
    const reasonIdx = code.indexOf("<Label>Reason for transfer");
    const narrationIdx = code.indexOf("<Label>Narration");
    const nicknameIdx = code.indexOf("<Label>Nickname (Optional)</Label>");

    expect(relIdx).toBeGreaterThan(-1);
    expect(relIdx).toBeLessThan(reasonIdx);
    expect(reasonIdx).toBeLessThan(narrationIdx);
    expect(narrationIdx).toBeLessThan(nicknameIdx);
  });
});
