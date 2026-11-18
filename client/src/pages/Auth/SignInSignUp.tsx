import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import AuthLayout from "./components/AuthLayout";
import EmailStep from "./components/EmailStep";
import SignInStep from "./components/SignInStep";
import SignUpForm, { type BusinessStep1Data } from "./components/SignUpForm";
import BusinessStep2 from "./components/BusinessStep2";
import OtpStep from "./components/OtpStep";
import ForgotPassword from "./components/ForgotPassword";
import { ReferralInviteStrip } from "@/components/rewards/ReferralSignup";
import { ExistingUserReferralCard } from "@/components/rewards/ExistingUserReferralCard";
import { useToast } from "@/hooks/use-toast";
import { clearReferral, detectClientDevice, loadReferral, saveReferral, type StoredReferral } from "@/lib/rewards";
import { getSafePostAuthRedirect } from "@/lib/support";

type AuthStep = "email" | "signIn" | "signUp" | "businessStep2" | "otp" | "forgotPassword";

const headings: Record<AuthStep, string> = {
  email: "Enter your email address",
  signIn: "Sign in to your account",
  signUp: "Get started for free",
  businessStep2: "Get started for free",
  otp: "Verify your email",
  forgotPassword: "Reset your password",
};

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 40 : -40,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -40 : 40,
    opacity: 0,
  }),
};

export default function SignInSignUp() {
  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState("");
  const [direction, setDirection] = useState(1);
  const [businessStep1Data, setBusinessStep1Data] = useState<BusinessStep1Data | null>(null);
  const [devOtp, setDevOtp] = useState<string | undefined>();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  // Referral captured from a /ref link, Android Play Install Referrer, or typed on the sign-up form
  const [referral, setReferral] = useState<StoredReferral | null>(() => loadReferral());
  const [existingReferralNotice, setExistingReferralNotice] = useState<StoredReferral | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams(search || (typeof window !== "undefined" ? window.location.search : ""));
    const trackingId = qs.get("tracking_id") ?? qs.get("trackingId");
    const referrerRaw = qs.get("referrer");
    const channelParam = (qs.get("channel") || "ANDROID").toUpperCase();
    if (!trackingId && !referrerRaw) return;
    (async () => {
      try {
        const res = await fetch("/api/v1/referrals/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ trackingId, referrer: referrerRaw, channel: channelParam }),
        });
        const body = await res.json().catch(() => ({}));
        const data = body?.data ?? body;
        if (res.ok && data?.valid && data?.referralCode) {
          const resolved: Omit<StoredReferral, "savedAt"> = {
            code: data.referralCode,
            referrerFirstName: data.referrerFirstName,
            trackingId: data.trackingId ?? trackingId ?? null,
            referralContextId: data.referralContextId ?? null,
            channel: (["WEB", "ANDROID", "IOS"].includes(channelParam) ? channelParam : "ANDROID") as "WEB" | "ANDROID" | "IOS",
            attributionMethod: channelParam === "ANDROID" ? "PLAY_INSTALL_REFERRER" : "UNIVERSAL_LINK",
            ruleId: data.ruleId ?? undefined,
            offer: data.offer ?? null,
            offers: data.offers,
            sendCurrencies: data.send_currencies,
          };
          saveReferral(resolved);
          setReferral(loadReferral());
        }
      } catch {
        // Fallback: manual referral code entry remains available on SignUpForm
      }
    })();
  }, [search]);

  const goTo = (newStep: AuthStep, dir: number = 1) => {
    setDirection(dir);
    setStep(newStep);
  };

  const handleRegistered = (emailValue: string) => {
    setEmail(emailValue);
    if (referral) {
      setExistingReferralNotice(referral);
      clearReferral();
      setReferral(null);
      toast({
        title: "Welcome offer is for new customers only",
        description: "Since you're already with Rhemito, see the existing member offers below!",
      });
    }
    goTo("signIn");
  };

  const handleNew = (emailValue: string, otpCode?: string) => {
    setEmail(emailValue);
    setDevOtp(otpCode || "123456");
    if (existingReferralNotice && !referral) {
      saveReferral(existingReferralNotice);
      setReferral(loadReferral());
      setExistingReferralNotice(null);
    }
    goTo("otp");
  };

  const handleBackToEmail = () => {
    setEmail("");
    goTo("email", -1);
  };

  const handleBusinessStep2 = (data: BusinessStep1Data) => {
    setBusinessStep1Data(data);
    goTo("businessStep2");
  };

  const handlePending = (emailValue: string) => {
    // Pending user: original registration OTP (123456) is still valid.
    // Do NOT call resend-otp here — that would invalidate the existing code.
    setEmail(emailValue);
    setDevOtp("123456");
    setDirection(1);
    setStep("otp");
  };

  const handleOtp = (_email: string, otpCode?: string) => {
    setDevOtp(otpCode);
    setDirection(1);
    setStep("otp");
  };

  const handleChangeEmailFromOtp = () => {
    setEmail("");
    goTo("email", -1);
  };

  const handleForgotComplete = () => {
    // reset-password signs the user in automatically — honor safe ?redirect= or go home.
    setLocation(getSafePostAuthRedirect(search));
  };

  return (
    <AuthLayout heading={headings[step]}>
      {(step === "email" || step === "signIn") && existingReferralNotice && (
        <ExistingUserReferralCard
          referrerFirstName={existingReferralNotice.referrerFirstName}
          clickedCode={existingReferralNotice.code}
          initialOffer={existingReferralNotice.offer}
          initialOffers={existingReferralNotice.offers}
          email={email || undefined}
          signedIn={false}
          platform={detectClientDevice().operatingSystem}
          variant="embedded"
          onSignInClick={() => {
            const passwordInput = document.querySelector<HTMLInputElement>('input[type="password"]');
            passwordInput?.focus();
          }}
          onBackToNewUser={
            step === "email"
              ? () => {
                  saveReferral(existingReferralNotice);
                  setReferral(loadReferral());
                  setExistingReferralNotice(null);
                }
              : undefined
          }
        />
      )}
      {(step === "email" || step === "otp" || step === "signUp") && !existingReferralNotice && (
        <ReferralInviteStrip
          referral={referral}
          onAlreadyMember={() => {
            if (referral) {
              setExistingReferralNotice(referral);
              clearReferral();
              setReferral(null);
            }
          }}
        />
      )}
      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          key={step}
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.25, ease: "easeInOut" }}
        >
          {step === "email" && (
            <EmailStep onRegistered={handleRegistered} onNew={handleNew} onPending={handlePending} />
          )}

          {step === "signIn" && (
            <SignInStep email={email} onBack={handleBackToEmail} onForgotPassword={() => goTo("forgotPassword")} />
          )}

          {step === "signUp" && (
            <SignUpForm
              email={email}
              onBack={handleBackToEmail}
              onOtp={handleOtp}
              onBusinessStep2={handleBusinessStep2}
              referral={referral}
              onReferralChange={setReferral}
            />
          )}

          {step === "businessStep2" && businessStep1Data && (
            <BusinessStep2
              step1Data={businessStep1Data}
              onBack={() => goTo("signUp", -1)}
              onOtp={handleOtp}
            />
          )}

          {step === "otp" && (
            <OtpStep
              email={email}
              onChangeEmail={handleChangeEmailFromOtp}
              devOtp={devOtp}
              onVerifiedForRegistration={() => goTo("signUp")}
            />
          )}

          {step === "forgotPassword" && (
            <ForgotPassword
              initialEmail={email}
              onCancel={() => goTo("signIn", -1)}
              onResetComplete={handleForgotComplete}
              cancelLabel="Back to sign in"
              successToast={{
                title: "Password Successfully Reset",
                description: "Welcome back! You are now signed in.",
              }}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </AuthLayout>
  );
}
