import { clearReferral, formatMoney, loadReferral } from "@/lib/rewards";
import { getSafePostAuthRedirect } from "@/lib/support";
import React, { useState, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Loader2, CheckCircle2, ExternalLink } from "lucide-react";

interface OtpStepProps {
  email: string;
  onChangeEmail: () => void;
  devOtp?: string;
  onVerifiedForRegistration?: () => void;
}

export default function OtpStep({ email, onChangeEmail, devOtp, onVerifiedForRegistration }: OtpStepProps) {
  const [code, setCode] = useState("");
  const [isVerified, setIsVerified] = useState(false);
  const [postSignupStoreUrl, setPostSignupStoreUrl] = useState<string | null>(null);
  const [currentDevOtp, setCurrentDevOtp] = useState(devOtp);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Sync devOtp prop changes
  useEffect(() => {
    if (devOtp) setCurrentDevOtp(devOtp);
  }, [devOtp]);

  // 60-minute countdown for OTP expiry
  const [expirySeconds, setExpirySeconds] = useState(60 * 60); // 60 minutes
  // 60-second cooldown for resend
  const [resendCooldown, setResendCooldown] = useState(60);

  // Countdown timers
  useEffect(() => {
    const interval = setInterval(() => {
      setExpirySeconds((prev) => (prev > 0 ? prev - 1 : 0));
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = useCallback((totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }, []);

  const verifyOtp = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/verify-otp", { email, code });
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.requiresRegistration && onVerifiedForRegistration) {
        toast({
          title: "Email Verified!",
          description: "Your email has been verified. Please complete your registration details.",
        });
        onVerifiedForRegistration();
        return;
      }
      const pendingStoreRedirect = loadReferral()?.postSignupAppStoreUrl ?? null;
      setPostSignupStoreUrl(pendingStoreRedirect);
      setIsVerified(true);
      clearReferral(); // the referral is now recorded on the server
      queryClient.clear();
      const bonus = data?.referralBonus as { amount: number; currency: string; floor: number } | null | undefined;
      if (bonus && Number(bonus.amount) > 0) {
        const amt = formatMoney(bonus.amount, bonus.currency);
        const floorText = Number(bonus.floor) > 0
          ? ` Use it on transfers of ${formatMoney(bonus.floor, bonus.currency)} or more.`
          : "";
        toast({
          title: "Account Activated & Bonus Unlocked!",
          description: `Welcome to Rhemito! You have earned ${amt} Referral Bonus credit.${floorText}`,
        });
      } else {
        toast({
          title: "Account Activated!",
          description: pendingStoreRedirect
            ? "Your referral is permanently linked! Redirecting to the Apple App Store..."
            : "Your account has been successfully activated. Welcome to Rhemito!",
        });
      }
      // Redirect to Apple App Store (if iOS Option A was chosen) or dashboard after short delay
      setTimeout(() => {
        if (pendingStoreRedirect) {
          window.location.href = pendingStoreRedirect;
        } else {
          setLocation(getSafePostAuthRedirect());
        }
      }, 2000);
    },
    onError: (error: Error) => {
      toast({
        title: "Verification Failed",
        description: error.message || "Invalid or expired verification code",
        variant: "destructive",
      });
    },
  });

  const resendOtp = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/resend-otp", { email });
      return res.json();
    },
    onSuccess: (data) => {
      setResendCooldown(60); // Reset 60s cooldown
      setExpirySeconds(60 * 60); // Reset 60-min expiry
      setCode(""); // Clear input
      if (data.devOtp) setCurrentDevOtp(data.devOtp);
      toast({
        title: "New Code Sent",
        description: data.message || "A new verification code has been sent. The previous code is now invalid.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Resend Failed",
        description: error.message || "Failed to resend code. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6 || isVerified) return;
    verifyOtp.mutate();
  };

  return (
    <div className="w-full">
      {/* Info banner */}
      <div className="w-full mb-4 bg-blue-50 text-blue-800 text-sm py-2.5 px-4 rounded flex items-start text-left border border-blue-200">
        <span className="mr-2 text-base flex-shrink-0">📧</span>
        <p>
          We've sent a 6-digit verification code to your email. Please also check your SPAM folder.
        </p>
      </div>

      <div className="w-full bg-white rounded-lg shadow-sm border border-slate-100 px-4 py-5 sm:px-8 sm:py-6">
        <p className="text-sm text-slate-500 mb-1">
          Code sent to <span className="font-semibold text-slate-700">{email}</span>
        </p>
        <button
          type="button"
          onClick={onChangeEmail}
          className="text-blue-600 font-medium text-xs mb-4 hover:underline"
        >
          Change email
        </button>

        {/* DEV TIP — Prototype only */}
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <p className="text-xs text-amber-700">
            <span className="font-semibold">Prototype tip:</span> Use code{" "}
            <span className="font-mono font-bold text-amber-900 bg-amber-100 px-1.5 py-0.5 rounded">
              {currentDevOtp || "123456"}
            </span>
          </p>
        </div>

        {/* Expiry countdown */}
        {expirySeconds > 0 && !isVerified && (
          <p className="text-xs text-slate-400 mb-4">
            OTP expires in{" "}
            <span className="font-mono font-medium text-slate-600">{formatTime(expirySeconds)}</span>
          </p>
        )}
        {expirySeconds === 0 && !isVerified && (
          <p className="text-xs text-red-500 mb-4 font-medium">
            Your verification code has expired. Please request a new one.
          </p>
        )}

        <form onSubmit={handleSubmit}>
          {isVerified ? (
            <div className="space-y-3">
              <div className="w-full bg-green-50 text-green-700 font-medium py-3 px-4 rounded text-sm flex items-center justify-center border border-green-200">
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Your account has been successfully activated!
              </div>
              {postSignupStoreUrl && (
                <a
                  href={postSignupStoreUrl}
                  data-testid="otp-verified-appstore-btn"
                  className="w-full inline-flex items-center justify-center gap-2 rounded bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
                >
                  <ExternalLink className="w-4 h-4" />
                  Download Rhemito on Apple App Store Now
                </a>
              )}
            </div>
          ) : (
            <>
              <div className="mb-5">
                <label className="block text-sm text-slate-500 mb-1">
                  Verification Code<span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className="block w-full px-3 py-2.5 border border-slate-200 rounded focus:ring-blue-500 focus:border-blue-500 text-sm tracking-[0.5em] font-mono text-slate-700 text-center"
                  placeholder="000000"
                  required
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={code.length !== 6 || verifyOtp.isPending || expirySeconds === 0}
                className="w-full text-white font-medium py-2.5 px-4 rounded disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors text-sm flex items-center justify-center"
                style={{ background: "#4f56e8" }}
              >
                {verifyOtp.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify Code"
                )}
              </button>

              {/* Resend */}
              <div className="mt-4 text-center">
                {resendCooldown > 0 ? (
                  <p className="text-xs text-slate-400">
                    Didn't receive code? Resend available in{" "}
                    <span className="font-mono font-medium">{resendCooldown}s</span>
                  </p>
                ) : (
                  <p className="text-xs text-slate-400">
                    Didn't receive code?{" "}
                    <button
                      type="button"
                      onClick={() => resendOtp.mutate()}
                      disabled={resendOtp.isPending}
                      className="text-blue-600 font-medium hover:underline disabled:opacity-50"
                    >
                      {resendOtp.isPending ? "Sending..." : "Resend"}
                    </button>
                  </p>
                )}
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
