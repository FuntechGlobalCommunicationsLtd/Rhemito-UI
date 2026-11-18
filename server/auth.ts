import type { Express, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import { storage } from "./storage";
import { demoModeEnabled, serverConfig } from "./config";
import { rateLimit, clientIpOf } from "./rateLimit";
import { devEmailProvider } from "./providers";
import {
  emailCheckSchema,
  forgotPasswordSchema,
  loginSchema,
  otpVerifySchema,
  resetPasswordSchema,
  PROTOTYPE_MASTER_PASSWORD,
  DEMO_PAYER_CREDENTIALS,
} from "@shared/schema";
import { log } from "./index";
import { onCustomerVerified, type ReferralAttributionMeta } from "./rewardsService";
import { syncCustomer as syncPromoCustomer } from "./promo";
import { rememberDevice } from "./deviceId";
import { registerOrSyncMitoRetailUser } from "./mitoRetail";
import {
  clearCustomerFurpToken,
  furpCheckCustomerEmail,
  furpLoginCustomer,
  isRealFurpLiveEnabled,
  setCustomerFurpToken,
} from "./furpClient";

function isPlaceholderUser(
  user: { id: string; email: string; firstName: string | null; lastName: string | null } | undefined,
): boolean {
  if (!user) return false;
  if (user.id === "user_demo_payer" || user.email.toLowerCase() === DEMO_PAYER_CREDENTIALS.email.toLowerCase()) {
    return false;
  }
  return user.firstName === "Demo" && user.lastName === "Payer";
}

const RESET_PIN_TTL_MS = 10 * 60 * 1000;
const RESET_PIN_RESEND_COOLDOWN_MS = 60_000;
const RESET_PIN_MAX_ATTEMPTS = 5;
const RESET_PIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/** Per-email resend cooldown and failed-attempt tracking (single-process prototype). */
const resetPinSentAt = new Map<string, number>();
const resetPinFailures = new Map<string, { count: number; windowStart: number }>();

/** Referral codes, optional rule IDs, and cross-platform attribution metadata entered at registration, kept until the email is verified (US-3.1, US-3.2). */
const pendingReferralCodes = new Map<string, string>();
const pendingReferralRuleIds = new Map<string, number>();
const pendingReferralMeta = new Map<string, ReferralAttributionMeta>();
/** New emails that were sent a 6-digit verification code at Step 1 (check-email) before filling out the registration form. */
const pendingOtpEmails = new Set<string>();
/** Emails that verified their 6-digit code at Step 2 (OtpStep) and are ready to complete Step 3 (SignUpForm -> Mito Users). */
const verifiedPreRegistrationEmails = new Set<string>();
const REFERRAL_CODE_RE = /^[A-Z0-9]{6,16}$/;

function enforceAuthRateLimit(req: Request, res: Response, name: keyof typeof serverConfig.rateLimits): boolean {
  const { limit, windowMs } = serverConfig.rateLimits[name];
  const result = rateLimit(`auth:${name}:${clientIpOf(req)}`, limit, windowMs);
  if (!result.allowed) {
    res.setHeader("Retry-After", Math.ceil(result.retryAfterMs / 1000));
    res.status(429).json({ message: "Too many attempts. Please try again shortly." });
    return false;
  }
  return true;
}

function generateOtp(): string {
  // PROTOTYPE: always use 123456 for easy testing
  return "123456";
}

const FURP_COUNTRY_ISO3_TO_ISO2: Record<string, string> = {
  GBR: "GB",
  NGA: "NG",
  USA: "US",
  CAN: "CA",
  GHA: "GH",
  KEN: "KE",
  ZAF: "ZA",
  DEU: "DE",
  FRA: "FR",
  IND: "IN",
  ARE: "AE",
};

/**
 * Additive FURP customer bridge (DEC-2026-11-18-MITOVIEW-AND-REAL-FURP-APIS).
 *
 * When live FURP is enabled and the email belongs to a real `furp02-staging` customer, the customer's own
 * password is verified against FURP, the customer is synced into local `authUsers`, and their FURP JWT is
 * stored server-side (for Support). Returns null whenever the bridge does not apply or FURP rejects the
 * credentials, so the existing local login flow runs unchanged. The password is only sent to FURP after
 * `Auth/check-email` confirms the account exists there.
 */
async function tryFurpCustomerLogin(
  req: Request,
  email: string,
  password: string,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  if (!isRealFurpLiveEnabled() || email.toLowerCase().endsWith("@example.com")) return null;

  const { existsOnFurp } = await furpCheckCustomerEmail(email);
  if (!existsOnFurp) return null;

  const furp = await furpLoginCustomer(email, password);
  if (!furp?.token) return null;

  let user = await storage.getAuthUserByEmail(email);
  if (user?.status === "blocked") {
    return {
      status: 403,
      body: { message: "Your account has been blocked. Please contact support at admin@rhemito.com" },
    };
  }
  // An unverified local registration is never adopted by the bridge — keep the existing flow.
  if (user && user.status === "pending" && !isPlaceholderUser(user)) return null;

  if (!user || isPlaceholderUser(user)) {
    const profile = (furp.profile ?? {}) as Record<string, any>;
    const nameParts = String(furp.name ?? "").trim().split(/\s+/).filter(Boolean);
    const firstName = String(profile.firstName ?? nameParts[0] ?? "") || null;
    const lastName = String(profile.lastName ?? nameParts.slice(1).join(" ") ?? "") || null;
    const iso3 = String(furp.countryIso3 ?? profile.country ?? "").toUpperCase();
    const hashed = await bcrypt.hash(password, 10);

    if (!user) {
      user = await storage.createAuthUser({
        email,
        password: hashed,
        country: FURP_COUNTRY_ISO3_TO_ISO2[iso3] ?? "GB",
        firstName,
        middleName: profile.middleName ? String(profile.middleName) : null,
        lastName,
        gender: profile.gender ? String(profile.gender) : null,
        dateOfBirth: profile.dob ? String(profile.dob).slice(0, 10) : null,
        status: "active",
        kycStatus: "passed",
      });
    } else {
      await storage.updateAuthUserPassword(email, hashed);
    }
    await storage.activateUser(email);
    user = (await storage.getAuthUserByEmail(email)) ?? user;
  }

  req.session.userId = user.id;
  req.session.furpAccessToken = furp.token;
  setCustomerFurpToken(user.id, furp.token, furp.expiresOn, furp.refreshToken);
  rememberDevice(user.id, req);

  const { password: _pw, ...safeUser } = user;
  return { status: 200, body: { user: safeUser } };
}

/** Prototype-only master password (any account) — never honoured in real production. */
function isPrototypeMasterPassword(password: string): boolean {
  return demoModeEnabled && password === PROTOTYPE_MASTER_PASSWORD;
}

export function registerAuthRoutes(app: Express) {
  // ─── Check Email ────────────────────────────────────────────────
  app.post("/api/auth/check-email", async (req: Request, res: Response) => {
    try {
      const parsed = emailCheckSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }

      const user = await storage.getAuthUserByEmail(parsed.data.email);
      const isPlaceholder = isPlaceholderUser(user);
      const isRegistered = Boolean(user && !isPlaceholder);

      // Real FURP customers (not yet known locally) go straight to the login step instead of local sign-up.
      if (!isRegistered && isRealFurpLiveEnabled()) {
        const furp = await furpCheckCustomerEmail(parsed.data.email);
        if (furp.existsOnFurp) {
          return res.json({ registered: true, status: "active" });
        }
      }

      if (!isRegistered) {
        const emailKey = parsed.data.email.trim().toLowerCase();
        const otpCode = generateOtp();
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await storage.createOtp(parsed.data.email, otpCode, expiresAt);
        pendingOtpEmails.add(emailKey);

        await devEmailProvider.send({
          to: parsed.data.email,
          subject: `${otpCode} is your Rhemito verification code`,
          text:
            `Hello,\n\n` +
            `Welcome to Rhemito! Use this 6-digit verification code to verify your email address:\n\n` +
            `${otpCode}\n\n` +
            `This code expires in 60 minutes.\n\n` +
            `— Rhemito`,
          customId: `pre_reg_otp:${emailKey}:${Date.now()}`,
          eventPayload: JSON.stringify({ type: "pre_registration_otp", email: parsed.data.email }),
        });
        log(`📧 Pre-registration OTP for ${parsed.data.email}: ${otpCode} (expires in 60 minutes)`, "auth");

        return res.json({
          registered: false,
          status: null,
          devOtp: otpCode,
        });
      }

      return res.json({
        registered: true,
        status: user!.status,
      });
    } catch (error) {
      console.error("Check email error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Login ──────────────────────────────────────────────────────
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }

      // Real FURP customer bridge — falls through to the unchanged local flow when it does not apply.
      const furpBridged = await tryFurpCustomerLogin(req, parsed.data.email, parsed.data.password);
      if (furpBridged) {
        return res.status(furpBridged.status).json(furpBridged.body);
      }

      const user = await storage.getAuthUserByEmail(parsed.data.email);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      if (user.status === "blocked") {
        return res.status(403).json({ message: "Your account has been blocked. Please contact support at admin@rhemito.com" });
      }

      if (user.status === "pending") {
        return res.status(403).json({ message: "Your account is not yet verified. Please check your email for the verification code." });
      }

      const isMatch = await bcrypt.compare(parsed.data.password, user.password);
      if (!isMatch && !isPrototypeMasterPassword(parsed.data.password)) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Set session
      req.session.userId = user.id;
      rememberDevice(user.id, req);
      await registerOrSyncMitoRetailUser(user).catch(() => null);

      const { password: _, ...safeUser } = user;
      return res.json({ user: safeUser });
    } catch (error) {
      console.error("Login error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Register ───────────────────────────────────────────────────
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const {
        confirmPassword,
        paymentRequestToken,
        isEmailLink,
        referralCode: rawReferralCode,
        referralRuleId: rawReferralRuleId,
        referralTrackingId: rawTrackingId,
        referralChannel: rawChannel,
        referralAttributionMethod: rawAttributionMethod,
        ...userData
      } = req.body;
      const referralCode = typeof rawReferralCode === "string" ? rawReferralCode.trim().toUpperCase() : "";
      const referralRuleId = rawReferralRuleId && Number.isInteger(Number(rawReferralRuleId)) && Number(rawReferralRuleId) > 0 ? Number(rawReferralRuleId) : null;
      const attributionMeta: ReferralAttributionMeta | null =
        rawTrackingId || rawChannel || rawAttributionMethod
          ? {
              trackingId: typeof rawTrackingId === "string" && rawTrackingId.trim() ? rawTrackingId.trim().toUpperCase() : null,
              channel: typeof rawChannel === "string" && rawChannel.trim() ? rawChannel.trim().toUpperCase() : null,
              attributionMethod: typeof rawAttributionMethod === "string" && rawAttributionMethod.trim() ? rawAttributionMethod.trim().toUpperCase() : null,
            }
          : null;
      if (referralCode && !REFERRAL_CODE_RE.test(referralCode)) {
        return res.status(400).json({ message: "Referral codes are 6–12 letters and numbers." });
      }
      const payerVerification = req.session.paymentRequestVerification;
      const isVerifiedPayerRegistration = Boolean(paymentRequestToken);
      if (isVerifiedPayerRegistration && (
        !payerVerification?.verified
        || payerVerification.email !== String(userData.email ?? "").toLowerCase()
        || payerVerification.token !== paymentRequestToken
        || payerVerification.isEmailLink !== Boolean(isEmailLink)
      )) {
        return res.status(403).json({ message: "Verify this email from the payment request before registering." });
      }

      // Check if email already exists
      const existing = await storage.getAuthUserByEmail(userData.email);
      if (existing) {
        return res.status(409).json({ message: "An account with this email already exists" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(userData.password, 12);

      // Create user with pending status
      const user = await storage.createAuthUser({
        ...userData,
        password: hashedPassword,
        status: "pending",
      });

      const emailKey = String(userData.email).trim().toLowerCase();
      const isPreVerifiedEmail = verifiedPreRegistrationEmails.has(emailKey);

      if (isVerifiedPayerRegistration || isPreVerifiedEmail) {
        await storage.activateUser(userData.email);
        req.session.userId = user.id;
        if (isVerifiedPayerRegistration) {
          delete req.session.paymentRequestVerification;
        }
        verifiedPreRegistrationEmails.delete(emailKey);
        pendingOtpEmails.delete(emailKey);
        rememberDevice(user.id, req);
      await registerOrSyncMitoRetailUser(user).catch(() => null);
        const mitoUserId = await registerOrSyncMitoRetailUser(user);
        const referral = await onCustomerVerified(user.id, referralCode || null, referralRuleId, attributionMeta);
        await syncPromoCustomer(user.id, { force: true }).catch(() => {});
        const activated = await storage.getAuthUserById(user.id);
        const { password: _, ...safeUser } = activated ?? user;
        return res.json({
          success: true,
          activated: true,
          message: "Registration complete.",
          user: { ...safeUser, status: "active" },
          ...(mitoUserId ? { mitoUserId } : {}),
          ...(Number(referral?.referee_credited) > 0
            ? {
                referralBonus: {
                  amount: Number(referral?.referee_credited),
                  currency: String(referral?.currency || "GBP"),
                  floor: Number(referral?.floor || 0),
                },
              }
            : {}),
        });
      }

      if (referralCode) {
        pendingReferralCodes.set(emailKey, referralCode);
        if (referralRuleId) pendingReferralRuleIds.set(emailKey, referralRuleId);
        else pendingReferralRuleIds.delete(emailKey);
        if (attributionMeta) pendingReferralMeta.set(emailKey, attributionMeta);
        else pendingReferralMeta.delete(emailKey);
      }

      // Generate & store OTP (valid for 1 hour)
      const otpCode = generateOtp();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await storage.createOtp(userData.email, otpCode, expiresAt);

      const recipientName =
        userData.accountType === "business" && userData.businessName
          ? userData.businessName
          : [userData.firstName, userData.middleName, userData.lastName].filter(Boolean).join(" ") || undefined;
      await devEmailProvider.send({
        to: userData.email,
        toName: recipientName,
        subject: `${otpCode} is your Rhemito verification code`,
        text:
          `Hello ${recipientName ?? "there"},\n\n` +
          `Welcome to Rhemito! Use this 6-digit verification code to verify your email address:\n\n` +
          `${otpCode}\n\n` +
          `This code expires in 60 minutes.\n\n` +
          `— Rhemito`,
        customId: `reg_otp:${user.id}:${Date.now()}`,
        eventPayload: JSON.stringify({ type: "registration_otp", userId: user.id, email: userData.email }),
      });

      // Log OTP to console for prototype
      log(`📧 OTP for ${userData.email}: ${otpCode} (expires in 60 minutes)`, "auth");

      return res.json({
        success: true,
        message: "Registration successful! Please check your email for the verification code.",
        devOtp: otpCode, // PROTOTYPE ONLY — remove in production
      });
    } catch (error) {
      console.error("Register error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Verify OTP ─────────────────────────────────────────────────
  app.post("/api/auth/verify-otp", async (req: Request, res: Response) => {
    try {
      const parsed = otpVerifySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }

      const { email, code } = parsed.data;
      const emailKey = email.trim().toLowerCase();

      // PROTOTYPE: verify by checking the user exists + code matches dev OTP
      if (code !== "123456") {
        return res.status(400).json({ message: "Invalid verification code. Use 123456 for this prototype." });
      }

      const user = await storage.getAuthUserByEmail(email);
      if (!user) {
        if (pendingOtpEmails.has(emailKey)) {
          verifiedPreRegistrationEmails.add(emailKey);
          return res.json({
            success: true,
            emailVerified: true,
            requiresRegistration: true,
            message: "Email verified successfully! Please complete your registration.",
          });
        }
        return res.status(404).json({ message: "No account found with this email. Please register first." });
      }

      if (user.status === "active") {
        return res.status(400).json({ message: "This account is already verified. Please sign in." });
      }

      if (user.status === "blocked") {
        return res.status(403).json({ message: "Your account has been blocked. Please contact support." });
      }

      // Activate user and start session
      await storage.activateUser(email);
      req.session.userId = user.id;
      const mitoUserId = await registerOrSyncMitoRetailUser(user);

      // Referral: the referral is created once the email is verified (AC-3.1.5)
      const pendingCode = pendingReferralCodes.get(email.toLowerCase()) ?? null;
      const pendingRuleId = pendingReferralRuleIds.get(email.toLowerCase()) ?? null;
      const pendingMeta = pendingReferralMeta.get(email.toLowerCase()) ?? null;
      pendingReferralCodes.delete(email.toLowerCase());
      pendingReferralRuleIds.delete(email.toLowerCase());
      pendingReferralMeta.delete(email.toLowerCase());
      rememberDevice(user.id, req);
      await registerOrSyncMitoRetailUser(user).catch(() => null);
      const referral = await onCustomerVerified(user.id, pendingCode, pendingRuleId, pendingMeta);
      await syncPromoCustomer(user.id, { force: true }).catch(() => {});

      const { password: _, ...safeUser } = user;
      return res.json({
        success: true,
        message: "Account activated successfully!",
        user: { ...safeUser, status: "active" },
        ...(mitoUserId ? { mitoUserId } : {}),
        ...(Number(referral?.referee_credited) > 0 ? { referralBonus: { amount: Number(referral?.referee_credited), currency: String(referral?.currency || "GBP"), floor: Number(referral?.floor || 0) } } : {}),
      });
    } catch (error) {
      console.error("Verify OTP error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Resend OTP ─────────────────────────────────────────────────
  app.post("/api/auth/resend-otp", async (req: Request, res: Response) => {
    try {
      const parsed = emailCheckSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }

      const emailKey = parsed.data.email.trim().toLowerCase();
      const user = await storage.getAuthUserByEmail(parsed.data.email);
      if (!user && !pendingOtpEmails.has(emailKey)) {
        return res.status(404).json({ message: "No account found with this email" });
      }

      // PROTOTYPE: OTP is always 123456, just log it
      const otpCode = generateOtp();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await storage.createOtp(parsed.data.email, otpCode, expiresAt);

      const recipientName =
        user?.accountType === "business" && user?.businessName
          ? user.businessName
          : user
            ? [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" ") || undefined
            : undefined;
      await devEmailProvider.send({
        to: user?.email ?? parsed.data.email,
        toName: recipientName,
        subject: `${otpCode} is your Rhemito verification code`,
        text:
          `Hello ${recipientName ?? "there"},\n\n` +
          `Use this 6-digit verification code to verify your Rhemito email address:\n\n` +
          `${otpCode}\n\n` +
          `This code expires in 60 minutes.\n\n` +
          `— Rhemito`,
        customId: `reg_otp_resend:${user?.id ?? emailKey}:${Date.now()}`,
        eventPayload: JSON.stringify({ type: "registration_otp_resend", userId: user?.id ?? null, email: parsed.data.email }),
      });
      log(`📧 OTP for ${parsed.data.email}: ${otpCode}`, "auth");

      return res.json({
        success: true,
        message: "A new verification code has been sent to your email.",
        devOtp: otpCode, // PROTOTYPE ONLY
      });
    } catch (error) {
      console.error("Resend OTP error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Forgot Password (send 6-digit PIN to registered email) ────
  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      if (!enforceAuthRateLimit(req, res, "passwordResetSend")) return;

      const parsed = forgotPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }

      const email = parsed.data.email.trim().toLowerCase();
      const user = await storage.getAuthUserByEmail(email);
      if (!user) {
        return res.status(404).json({ message: "No Rhemito account is registered with this email." });
      }
      if (user.status === "blocked") {
        return res.status(403).json({ message: "Your account has been blocked. Please contact support at admin@rhemito.com" });
      }

      const now = Date.now();
      const lastSentAt = resetPinSentAt.get(email) ?? 0;
      if (now - lastSentAt < RESET_PIN_RESEND_COOLDOWN_MS) {
        const retryAfterMs = RESET_PIN_RESEND_COOLDOWN_MS - (now - lastSentAt);
        res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000));
        return res.status(429).json({ message: `A PIN was already sent. Please wait ${Math.ceil(retryAfterMs / 1000)}s before requesting another.` });
      }

      const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
      await storage.invalidateOtps(email);
      await storage.createOtp(email, pin, new Date(now + RESET_PIN_TTL_MS));
      resetPinSentAt.set(email, now);
      resetPinFailures.delete(email);

      await devEmailProvider.send({
        to: user.email,
        subject: "Your Rhemito password reset PIN",
        text:
          `Hello,\n\n` +
          `Use this 6-digit PIN to reset your Rhemito password:\n\n${pin}\n\n` +
          `This PIN expires in 10 minutes.\n\n` +
          `⚠ Rhemito will never ask for your password, full card number or one-time codes by email or phone. ` +
          `If you did not request a password reset, ignore this email — your password remains unchanged.\n\n` +
          `— Rhemito`,
      });
      log(`🔑 Password-reset PIN for ${email}: ${pin} (expires in 10 minutes)`, "auth");

      return res.json({
        success: true,
        message: "A 6-digit PIN has been sent to your registered email address.",
        expiresInSeconds: RESET_PIN_TTL_MS / 1000,
        resendAfterSeconds: RESET_PIN_RESEND_COOLDOWN_MS / 1000,
        ...(demoModeEnabled ? { devPin: pin } : {}), // PROTOTYPE ONLY — remove in production
      });
    } catch (error) {
      console.error("Forgot password error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Reset Password (verify PIN, set new password, sign in) ─────
  app.post("/api/auth/reset-password", async (req: Request, res: Response) => {
    try {
      if (!enforceAuthRateLimit(req, res, "passwordResetVerify")) return;

      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }

      const email = parsed.data.email.trim().toLowerCase();
      const user = await storage.getAuthUserByEmail(email);
      if (!user) {
        return res.status(404).json({ message: "No Rhemito account is registered with this email." });
      }
      if (user.status === "blocked") {
        return res.status(403).json({ message: "Your account has been blocked. Please contact support at admin@rhemito.com" });
      }

      const now = Date.now();
      const failures = resetPinFailures.get(email);
      if (failures && failures.count >= RESET_PIN_MAX_ATTEMPTS && now - failures.windowStart < RESET_PIN_ATTEMPT_WINDOW_MS) {
        return res.status(429).json({ message: "Too many incorrect PIN attempts. Please request a new PIN." });
      }

      const otp = await storage.getValidOtp(email, parsed.data.code);
      if (!otp) {
        const inWindow = failures && now - failures.windowStart < RESET_PIN_ATTEMPT_WINDOW_MS;
        const count = inWindow ? failures!.count + 1 : 1;
        resetPinFailures.set(email, { count, windowStart: inWindow ? failures!.windowStart : now });
        const remaining = Math.max(0, RESET_PIN_MAX_ATTEMPTS - count);
        return res.status(400).json({
          message:
            remaining > 0
              ? `Incorrect PIN. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
              : "Incorrect PIN. Please request a new PIN.",
        });
      }

      await storage.markOtpUsed(otp.id);
      await storage.invalidateOtps(email);
      const hashedPassword = await bcrypt.hash(parsed.data.password, 12);
      await storage.updateAuthUserPassword(email, hashedPassword);
      resetPinFailures.delete(email);

      // Verifying the email PIN proves account control — sign the user in so
      // they can continue their journey (e.g. an open payment request checkout).
      req.session.userId = user.id;

      const { password: _, ...safeUser } = user;
      return res.json({
        success: true,
        message: "Password successfully reset.",
        user: safeUser,
      });
    } catch (error) {
      console.error("Reset password error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Campaign contributor identification (GroupPay share links) ──────────
  // Mirrors the request-money/invoice payer PIN flow. Campaigns live in
  // server-side storage, so the campaignId is validated against a real
  // campaign record before any PIN is issued — unknown links get a 404
  // instead of a verification session.
  app.post("/api/public/campaign-verifications/send", async (req: Request, res: Response) => {
    try {
      if (!enforceAuthRateLimit(req, res, "paymentIntent")) return;
      const parsed = emailCheckSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Enter a valid email address." } });
      }
      const campaignId = String(req.body?.campaignId ?? "").trim();
      if (!campaignId) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A campaign context is required." } });
      }
      const campaign = await storage.getGroupPayCampaignById(campaignId);
      if (!campaign) {
        return res.status(404).json({ error: { code: "CAMPAIGN_NOT_FOUND", message: "This contribution link is not valid or the campaign has ended." } });
      }
      // Contributor identification only starts for campaigns that accept contributions
      if (campaign.status !== "active") {
        return res.status(409).json({ error: { code: "CAMPAIGN_NOT_ACCEPTING", message: "This campaign is not accepting contributions right now." } });
      }
      const email = parsed.data.email.toLowerCase();
      if (await storage.getAuthUserByEmail(email)) {
        return res.status(409).json({ error: { code: "EMAIL_REGISTERED", message: "This email already has a Rhemito account. Please sign in." } });
      }
      const previous = req.session.paymentRequestVerification;
      if (previous?.email === email && Date.now() - previous.lastSentAt < 60_000) {
        res.setHeader("Retry-After", Math.ceil((60_000 - (Date.now() - previous.lastSentAt)) / 1000));
        return res.status(429).json({ error: { code: "PIN_COOLDOWN", message: "Please wait before requesting another PIN." } });
      }
      await storage.invalidateOtps(email);
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      await storage.createOtp(email, code, new Date(Date.now() + 10 * 60_000));
      req.session.paymentRequestVerification = {
        email,
        token: campaignId,
        isEmailLink: false,
        verified: false,
        failedAttempts: 0,
        lastSentAt: Date.now(),
      };

      await devEmailProvider.send({
        to: email,
        subject: `${code} is your Rhemito campaign contribution PIN`,
        text:
          `Hello,\n\n` +
          `Use this 6-digit PIN to verify your email and contribute to '${campaign.name}' (${campaign.creatorName}):\n\n` +
          `${code}\n\n` +
          `This PIN expires in 10 minutes.\n\n` +
          `— Rhemito`,
        customId: `campaign_otp:${campaign.id}:${Date.now()}`,
        eventPayload: JSON.stringify({ type: "campaign_verification_code", campaignId: campaign.id, email }),
      });

      return res.json({
        data: {
          sent: true,
          expiresInSeconds: 600,
          resendAfterSeconds: 60,
          ...(demoModeEnabled ? { devPin: code } : {}),
        },
      });
    } catch (error) {
      console.error("Campaign verification send error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/public/campaign-verifications/verify", async (req: Request, res: Response) => {
    try {
      if (!enforceAuthRateLimit(req, res, "paymentIntent")) return;
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const campaignId = String(req.body?.campaignId ?? "").trim();
      const code = String(req.body?.code ?? "").trim();
      const campaign = await storage.getGroupPayCampaignById(campaignId);
      if (!campaign) {
        return res.status(404).json({ error: { code: "CAMPAIGN_NOT_FOUND", message: "This contribution link is not valid or the campaign has ended." } });
      }
      const verification = req.session.paymentRequestVerification;
      if (!verification || verification.token !== campaignId || verification.isEmailLink !== false || verification.email !== email) {
        return res.status(400).json({ error: { code: "PIN_NOT_SENT", message: "Request a new PIN for this email address." } });
      }
      if (verification.failedAttempts >= 5) {
        return res.status(429).json({ error: { code: "PIN_LOCKED", message: "Too many incorrect attempts. Request a new PIN later." } });
      }
      const otp = code.length === 6 ? await storage.getValidOtp(email, code) : undefined;
      if (!otp) {
        verification.failedAttempts += 1;
        return res.status(400).json({ error: { code: "INVALID_PIN", message: "The PIN is invalid or has expired." } });
      }
      await storage.markOtpUsed(otp.id);
      verification.verified = true;
      return res.json({ data: { verified: true } });
    } catch (error) {
      console.error("Campaign verification verify error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Get Current User ──────────────────────────────────────────
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });
      const user = await storage.getAuthUserById(userId);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      const { password: _, ...safeUser } = user;
      return res.json({ user: safeUser });
    } catch (error) {
      console.error("Get user error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Logout ─────────────────────────────────────────────────────
  // ─── Get Demo User (Unauthenticated Prototype Preview Only) ────
  app.get("/api/auth/demo-user", async (_req: Request, res: Response) => {
    try {
      if (!demoModeEnabled) {
        return res.status(404).json({ user: null });
      }
      const user = await storage.getAuthUserById("user_123");
      if (!user) {
        return res.status(404).json({ user: null });
      }
      const { password: _, ...safeUser } = user;
      return res.json({ user: safeUser });
    } catch (error) {
      console.error("Get demo user error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Change Password (signed-in customer; demo session allowed in prototype mode) ───
  app.post("/api/auth/change-password", async (req: Request, res: Response) => {
    try {
      const userId = req.session?.userId ?? (demoModeEnabled ? "user_123" : null);
      if (!userId) return res.status(401).json({ message: "Please sign in to continue." });
      const user = await storage.getAuthUserById(userId);
      if (!user) return res.status(404).json({ message: "User not found." });

      const { existingPassword, newPassword } = (req.body ?? {}) as {
        existingPassword?: unknown;
        newPassword?: unknown;
      };
      if (
        typeof existingPassword !== "string" ||
        typeof newPassword !== "string" ||
        !existingPassword ||
        !newPassword
      ) {
        return res.status(400).json({ message: "Existing password and new password are required." });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ message: "New password must be at least 8 characters." });
      }
      if (newPassword === existingPassword) {
        return res.status(400).json({ message: "New password must be different from your existing password." });
      }
      const matches = await bcrypt.compare(existingPassword, user.password);
      if (!matches) return res.status(400).json({ message: "Existing password is incorrect." });

      const hashed = await bcrypt.hash(newPassword, 12);
      await storage.updateAuthUserPassword(user.email, hashed);
      return res.json({ success: true, message: "Password updated successfully." });
    } catch (error) {
      console.error("Change password error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    clearCustomerFurpToken(req, req.session?.userId);
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.clearCookie("connect.sid");
      return res.json({ success: true, message: "Logged out successfully" });
    });
  });
}
