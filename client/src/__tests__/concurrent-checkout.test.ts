import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../..");

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

describe("Receive Money concurrent payer & Bank Transfer locking invariants", () => {
  it("locks Bank Transfer immediately on Continue before rendering wire details", () => {
    const checkoutSrc = readRepoFile("client/src/pages/RequestCheckout.tsx");
    const methodHandlerIdx = checkoutSrc.indexOf("const handleContinueFromMethodSelect");
    expect(methodHandlerIdx).toBeGreaterThan(-1);
    const slice = checkoutSrc.slice(methodHandlerIdx, methodHandlerIdx + 1600);
    expect(slice).toContain('selectedMethod === "bank_transfer"');
    expect(slice).toContain("await createIntent(");
    expect(slice).toContain('setPaymentSubStep("bank_transfer_details")');
  });

  it("renders distinct invalidation and in-progress cards for non-winning concurrent payers", () => {
    const checkoutSrc = readRepoFile("client/src/pages/RequestCheckout.tsx");
    expect(checkoutSrc).toContain('testId="already-paid-card"');
    expect(checkoutSrc).toContain("Payment Request No Longer Valid");
    expect(checkoutSrc).toContain("There can only be one full payment for the requested amount.");
    expect(checkoutSrc).toContain('testId="payment-in-progress-other-card"');
    expect(checkoutSrc).toContain("Payment Currently in Progress");
  });

  it("hides collectionAccount wire details from concurrent non-reserving and non-winning viewers", () => {
    const serviceSrc = readRepoFile("server/requestService.ts");
    expect(serviceSrc).toContain("(isProcessingStatus && !isReservedByCurrentUser)");
    expect(serviceSrc).toContain("(isPaidStatus && !isPaidByCurrentUser)");
    expect(serviceSrc).toContain("export async function releasePayinIntent");
  });
});
