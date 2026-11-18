import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Loader2, ArrowLeft } from "lucide-react";
import { getSafePostAuthRedirect } from "@/lib/support";
import PasswordInput from "./PasswordInput";

interface SignInStepProps {
  email: string;
  onBack: () => void;
  onForgotPassword: () => void;
}

export default function SignInStep({ email, onBack, onForgotPassword }: SignInStepProps) {
  const [password, setPassword] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const login = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/login", { email, password });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.clear();
      if (data?.user) {
        queryClient.setQueryData(["/api/auth/me"], { user: data.user });
      }
      toast({
        title: "Welcome back!",
        description: `Signed in as ${data.user.firstName || data.user.email}`,
      });
      setLocation(getSafePostAuthRedirect());
    },
    onError: (error: Error) => {
      toast({
        title: "Sign In Failed",
        description: error.message || "Invalid email or password",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    login.mutate();
  };

  return (
    <div className="w-full">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center text-sm text-slate-500 hover:text-slate-700 mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        Change email
      </button>

      <div className="w-full bg-white rounded-lg shadow-sm border border-slate-100 px-4 py-5 sm:px-8 sm:py-6">
        <form onSubmit={handleSubmit}>
          {/* Email display */}
          <div className="mb-4">
            <label className="block text-sm text-slate-500 mb-1">Email</label>
            <input
              type="email"
              value={email}
              disabled
              className="block w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded text-slate-400 text-sm cursor-not-allowed"
            />
          </div>

          {/* Password */}
          <div className="mb-5">
            <PasswordInput
              value={password}
              onChange={setPassword}
              label="Password"
              placeholder="Enter your password"
            />
          </div>

          <button
            type="submit"
            disabled={login.isPending || !password}
            className="w-full text-white font-medium py-2.5 px-4 rounded disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors text-sm flex items-center justify-center"
            style={{ background: "#4f56e8" }}
          >
            {login.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Signing in...
              </>
            ) : (
              "Sign in"
            )}
          </button>

          {/* Forgot password */}
          <div className="mt-4 text-center">
            <button
              type="button"
              className="text-sm text-blue-600 font-medium hover:underline"
              onClick={onForgotPassword}
              data-testid="button-forgot-password"
            >
              Forgot password?
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
