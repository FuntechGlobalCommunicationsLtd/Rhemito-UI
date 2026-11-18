import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  confirmMitoViewUnsubscribe,
  requestMitoViewUnsubscribe,
} from "@/lib/mitoView";
import { MitoViewShell } from "./MitoViewShell";

export default function MitoViewUnsubscribe() {
  const searchString = useSearch();
  const { toast } = useToast();

  const { initialEmail, token } = useMemo(() => {
    const params = new URLSearchParams(searchString);
    return {
      initialEmail: params.get("email") ?? "",
      token: (params.get("token") ?? "").trim(),
    };
  }, [searchString]);

  const [email, setEmail] = useState(initialEmail);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (initialEmail) {
      setEmail((prev) => prev || initialEmail);
    }
  }, [initialEmail]);

  const requestMutation = useMutation({
    mutationFn: (targetEmail: string) => requestMitoViewUnsubscribe(targetEmail),
    onSuccess: (res) => {
      setErrorMessage("");
      setStatusMessage(res.message);
      toast({
        title: "Confirmation email sent",
        description: res.message,
      });
    },
    onError: (err) => {
      const msg =
        err instanceof Error
          ? err.message
          : "Could not send the confirm email. Try again.";
      setErrorMessage(msg);
      toast({
        variant: "destructive",
        title: "Request failed",
        description: msg,
      });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (confirmToken: string) =>
      confirmMitoViewUnsubscribe(confirmToken),
    onSuccess: (res) => {
      setErrorMessage("");
      setStatusMessage(res.message);
      toast({
        title: "Unsubscribed",
        description: res.message,
      });
    },
    onError: (err) => {
      const msg =
        err instanceof Error
          ? err.message
          : "This confirm link is invalid or has expired.";
      setErrorMessage(msg);
      toast({
        variant: "destructive",
        title: "Confirmation failed",
        description: msg,
      });
    },
  });

  const handleRequestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = email.trim();
    if (!clean) return;
    requestMutation.mutate(clean);
  };

  const handleConfirmSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    confirmMutation.mutate(token);
  };

  return (
    <MitoViewShell>
      <div
        data-testid="page-mitoview-unsubscribe"
        className="w-full max-w-[720px] pb-12"
      >
        <Link
          href="/mitoview"
          data-testid="link-back-all-posts"
          className="mb-5 inline-block text-sm font-extrabold text-[#2e5bff] hover:underline"
        >
          ← All posts
        </Link>

        <header className="mb-9">
          <p className="mb-2.5 text-sm font-extrabold tracking-wide text-[#2e5bff]">
            Unsubscribe
          </p>
          <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tight text-[#090039] md:text-4xl">
            Leave the MitoView list
          </h1>
          <p className="mt-3.5 text-lg font-bold leading-snug text-[#4A5568]">
            This stops MitoView email for www.rhemito.com. It does not close a
            Mito, Basketmouth or Rhemito account.
          </p>
        </header>

        {statusMessage ? (
          <p
            data-testid="mitoview-unsubscribe-status"
            className="text-base font-bold text-[#090039]"
          >
            {statusMessage}
          </p>
        ) : token ? (
          <form onSubmit={handleConfirmSubmit} className="max-w-[480px] space-y-3">
            <button
              type="submit"
              disabled={confirmMutation.isPending}
              data-testid="button-mitoview-confirm-unsubscribe"
              className="inline-flex h-10 cursor-pointer items-center justify-center rounded-full bg-[#2e5bff] px-6 text-sm font-bold text-white transition-colors hover:bg-[#001489] disabled:opacity-60"
            >
              {confirmMutation.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              Confirm unsubscribe
            </button>

            {errorMessage && (
              <p
                data-testid="mitoview-unsubscribe-error"
                className="text-sm font-medium text-destructive"
              >
                {errorMessage}
              </p>
            )}
          </form>
        ) : (
          <form onSubmit={handleRequestSubmit} className="max-w-[480px] space-y-3">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <label htmlFor="mitoview-unsub-email" className="sr-only">
                Email on the list
              </label>
              <input
                id="mitoview-unsub-email"
                type="email"
                name="email"
                autoComplete="email"
                required
                placeholder="Email on the list"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-mitoview-unsubscribe-email"
                className="h-10 min-w-0 flex-1 rounded-full border border-slate-200 bg-[#f4f5f7] px-4 text-sm text-[#090039] placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#2e5bff]"
              />
              <button
                type="submit"
                disabled={requestMutation.isPending}
                data-testid="button-mitoview-unsubscribe"
                className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#2e5bff] px-6 text-sm font-bold text-white transition-colors hover:bg-[#001489] disabled:opacity-60"
              >
                {requestMutation.isPending && (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                )}
                Unsubscribe
              </button>
            </div>

            {errorMessage && (
              <p
                data-testid="mitoview-unsubscribe-error"
                className="text-sm font-medium text-destructive"
              >
                {errorMessage}
              </p>
            )}
          </form>
        )}
      </div>
    </MitoViewShell>
  );
}
