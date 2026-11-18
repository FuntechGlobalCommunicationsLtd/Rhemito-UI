import { describe, it, expect } from "vitest";
import {
  createSupportTicketFormSchema,
  replySupportTicketFormSchema,
  sanitizeSupportFaqCopy,
} from "@shared/support";
import {
  mapApiPost,
  prepareArticleMedia,
  articleStandfirst,
  dedupeSectionLabels,
  toSentenceCaseKicker,
  formatMitoViewDate,
  searchNewsletterPosts,
  type MitoViewPost,
  type MitoViewBodyBlock,
} from "@shared/mitoView";
import { getSafePostAuthRedirect } from "../lib/support";
import { formatComplianceDate } from "../lib/compliance";

describe("Support Validation & Helpers", () => {
  describe("createSupportTicketFormSchema", () => {
    it("requires transactionReference when supportTicketArea is Failed Transaction", () => {
      const result = createSupportTicketFormSchema.safeParse({
        supportTicketArea: "Failed Transaction",
        transactionReference: "",
        subject: "Transfer stuck",
        message: "Payment did not go through",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Transaction reference is required");
      }

      const valid = createSupportTicketFormSchema.safeParse({
        supportTicketArea: "Failed Transaction",
        transactionReference: "22505606",
        subject: "Transfer stuck",
        message: "Payment did not go through",
      });
      expect(valid.success).toBe(true);
    });

    it("allows optional transactionReference for Recipients and KYC and Compliance", () => {
      const recipientRes = createSupportTicketFormSchema.safeParse({
        supportTicketArea: "Recipients",
        transactionReference: "",
        subject: "Update bank details",
        message: "Please help change the account number",
      });
      expect(recipientRes.success).toBe(true);

      const kycRes = createSupportTicketFormSchema.safeParse({
        supportTicketArea: "KYC and Compliance",
        transactionReference: "",
        subject: "Proof of address",
        message: "Uploaded my passport",
      });
      expect(kycRes.success).toBe(true);
    });

    it("rejects invalid supportTicketArea", () => {
      const result = createSupportTicketFormSchema.safeParse({
        supportTicketArea: "General Inquiry",
        transactionReference: "",
        subject: "General question",
        message: "Can I get help?",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("replySupportTicketFormSchema", () => {
    it("validates non-empty message and trims", () => {
      const invalid = replySupportTicketFormSchema.safeParse({ message: "   " });
      expect(invalid.success).toBe(false);

      const valid = replySupportTicketFormSchema.safeParse({ message: "Thank you for the update" });
      expect(valid.success).toBe(true);
      if (valid.success) {
        expect(valid.data.message).toBe("Thank you for the update");
      }
    });
  });

  describe("sanitizeSupportFaqCopy", () => {
    it("replaces FURP references with mito.money while preserving email addresses and brand text", () => {
      const input = "Log into FURP or contact support@rhemito.com for help with the FURP platform.";
      const output = sanitizeSupportFaqCopy(input);
      expect(output).toContain("mito.money");
      expect(output).not.toContain("FURP");
      expect(output).toContain("support@rhemito.com");
    });
  });

  describe("getSafePostAuthRedirect", () => {
    it("accepts valid relative application paths from query string", () => {
      expect(getSafePostAuthRedirect("?redirect=/support/my-tickets")).toBe("/support/my-tickets");
      expect(getSafePostAuthRedirect("?redirect=/compliance")).toBe("/compliance");
      expect(getSafePostAuthRedirect("?redirect=/mitoview")).toBe("/mitoview");
      expect(getSafePostAuthRedirect("?redirect=/support/faq")).toBe("/support/faq");
    });

    it("rejects malicious, protocol-relative, and external URLs (falls back to /)", () => {
      expect(getSafePostAuthRedirect("?redirect=//evil.com")).toBe("/");
      expect(getSafePostAuthRedirect("?redirect=/\\evil.com")).toBe("/");
      expect(getSafePostAuthRedirect("?redirect=/%2fevil.com")).toBe("/");
      expect(getSafePostAuthRedirect("?redirect=/\t/evil.com")).toBe("/");
      expect(getSafePostAuthRedirect("?redirect=https://evil.com")).toBe("/");
      expect(getSafePostAuthRedirect("?redirect=javascript:alert(1)")).toBe("/");
    });

    it("rejects auth loops (falls back to /)", () => {
      expect(getSafePostAuthRedirect("?redirect=/login")).toBe("/");
      expect(getSafePostAuthRedirect("?redirect=/sign-in-sign-up")).toBe("/");
      expect(getSafePostAuthRedirect("")).toBe("/");
      expect(getSafePostAuthRedirect(undefined)).toBe("/");
    });
  });
});

describe("MitoView Processing & Helpers", () => {
  const sampleRawPost = {
    slug: "2026-07-simplifying-transfers",
    title: "Simplifying Money Transfers on Rhemito",
    category: "Product update",
    publishedAt: "2026-07-29T12:00:00Z",
    heroSrc: "/mitoview/july/unified-payments.jpg",
    heroAlt: "Hero illustration",
    excerpt: "Learn how Rhemito makes cross-border payments easier and faster.",
    bodyJson: [
      { type: "h2", text: "Simplifying Money Transfers on Rhemito" }, // duplicate of title
      { type: "img", src: "/mitoview/july/unified-payments.jpg", alt: "Duplicate hero" }, // duplicate of heroSrc
      { type: "p", text: "Paragraph 1 explaining the new flow." },
      { type: "kicker", text: "KEY HIGHLIGHTS" },
      { type: "h2", text: "Key highlights" }, // duplicate label with previous kicker
      { type: "p", text: "Paragraph 2 with key features." },
    ],
  };

  it("mapApiPost maps raw API post into clean MitoViewPost", () => {
    const post = mapApiPost(sampleRawPost);
    expect(post).not.toBeNull();
    expect(post?.slug).toBe("2026-07-simplifying-transfers");
    expect(post?.title).toBe("Simplifying Money Transfers on Rhemito");
    expect(post?.heroSrc).toBe("/mitoview/july/unified-payments.jpg");
    expect(post?.body.length).toBe(6);
  });

  it("prepareArticleMedia dedupes identical hero images from section body and title h2", () => {
    const post = mapApiPost(sampleRawPost) as MitoViewPost;
    const prepared = prepareArticleMedia(post);
    // Duplicate title h2 should be stripped
    expect(prepared.body.some((b) => b.type === "h2" && b.text === post.title)).toBe(false);
    // Duplicate hero image in body should be filtered
    expect(prepared.body.some((b) => b.type === "img" && b.src === post.heroSrc)).toBe(false);
    expect(prepared.body.length).toBeLessThan(post.body.length);
  });

  it("articleStandfirst extracts clean standfirst from excerpt or first paragraph", () => {
    const post = mapApiPost(sampleRawPost) as MitoViewPost;
    const sf = articleStandfirst(post.excerpt, post.title, post.slug, post.body);
    expect(sf).toBe("Learn how Rhemito makes cross-border payments easier and faster.");
  });

  it("dedupeSectionLabels ensures distinct sequential labels", () => {
    const blocks: MitoViewBodyBlock[] = [
      { type: "kicker", text: "Key highlights" },
      { type: "h2", text: "Key highlights" },
      { type: "p", text: "First paragraph" },
    ];
    const deduped = dedupeSectionLabels(blocks);
    // When kicker is followed by h2 with same label, h2 replaces kicker
    expect(deduped.length).toBe(2);
    expect(deduped[0].type).toBe("h2");
  });

  it("toSentenceCaseKicker converts kicker to Sentence case while preserving protected brand names", () => {
    expect(toSentenceCaseKicker("FUNTECH RHEMITO ONEPIPE UK KYC UPDATES")).toBe(
      "Funtech Rhemito OnePipe UK KYC updates"
    );
    expect(toSentenceCaseKicker("PRODUCT UPDATE")).toBe("Product update");
  });

  it("formatMitoViewDate formats ISO strings into readable British date format", () => {
    const formatted = formatMitoViewDate("2026-07-29T12:00:00Z");
    expect(formatted).toBe("29 July 2026");
  });

  it("searchNewsletterPosts filters posts by query in title, excerpt, and body", () => {
    const post = mapApiPost(sampleRawPost) as MitoViewPost;
    const posts: MitoViewPost[] = [post];

    const matchTitle = searchNewsletterPosts(posts, "transfers");
    expect(matchTitle.length).toBe(1);

    const matchBody = searchNewsletterPosts(posts, "cross-border");
    expect(matchBody.length).toBe(1);

    const noMatch = searchNewsletterPosts(posts, "nonexistent keyword");
    expect(noMatch.length).toBe(0);
  });
});

describe("Compliance Helpers", () => {
  describe("formatComplianceDate", () => {
    it("formats ISO timestamps to DD MMM YYYY in UTC", () => {
      expect(formatComplianceDate("1973-02-14T00:00:00.000+00:00")).toBe("14 Feb 1973");
      expect(formatComplianceDate("1990-01-01")).toBe("01 Jan 1990");
      expect(formatComplianceDate(null)).toBe("—");
      expect(formatComplianceDate(undefined)).toBe("—");
      expect(formatComplianceDate("")).toBe("—");
      expect(formatComplianceDate("invalid-date")).toBe("invalid-date");
    });
  });
});
