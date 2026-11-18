import type { ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useAuth, type AuthUser } from "@/hooks/use-auth";

export interface MitoViewShellRenderContext {
  isEmbedded: boolean;
}

export interface MitoViewShellProps {
  children: ReactNode | ((ctx: MitoViewShellRenderContext) => ReactNode);
  publicBleedHero?: ReactNode;
  brandBarAsH1?: boolean;
}

export function MitoViewShell({
  children,
  publicBleedHero,
  brandBarAsH1 = false,
}: MitoViewShellProps) {
  const { user, demoUser, isLoading } = useAuth();
  const { isPending: isDemoLoading } = useQuery<{ user?: AuthUser | null } | null>({
    queryKey: ["/api/auth/demo-user"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/auth/demo-user", { credentials: "include" });
        if (!res.ok) return null;
        return (await res.json()) as { user?: AuthUser | null };
      } catch {
        return null;
      }
    },
    enabled: !isLoading && !user,
    retry: false,
    staleTime: Infinity,
  });

  if (isLoading || (!user && isDemoLoading)) {
    return <div className="min-h-screen w-full bg-white" />;
  }

  const isEmbedded = Boolean(user || demoUser);

  const resolvedChildren =
    typeof children === "function" ? children({ isEmbedded }) : children;

  if (isEmbedded) {
    return <DashboardLayout>{resolvedChildren}</DashboardLayout>;
  }

  return (
    <div
      data-testid="mitoview-public-shell"
      className="flex min-h-screen w-full flex-col bg-white text-[#090039]"
    >
      {/* Public top header */}
      <header className="sticky top-0 z-30 border-b border-slate-100 bg-white">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/home"
            data-testid="mitoview-public-logo"
            className="flex items-center gap-2.5"
          >
            <img
              src="/Rhemito-logo.svg"
              alt="Rhemito"
              className="h-8 w-auto object-contain"
            />
            <span className="font-display text-lg font-bold tracking-tight text-[#090039]">
              Rhemito
            </span>
          </Link>

          <Link
            href="/sign-in-sign-up"
            data-testid="mitoview-public-signin"
            className="inline-flex h-9 items-center justify-center rounded-full bg-[#2e5bff] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#001489]"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* #2e5bff MitoView brand bar */}
      <div className="w-full bg-[#2e5bff]">
        <div className="mx-auto flex min-h-12 w-full max-w-[720px] items-center px-4">
          {brandBarAsH1 ? (
            <h1 className="font-display text-lg font-bold tracking-tight text-white">
              MitoView
            </h1>
          ) : (
            <p className="font-display text-lg font-bold tracking-tight text-white">
              MitoView
            </p>
          )}
        </div>
      </div>

      {publicBleedHero}

      {/* Centered reading column */}
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pt-6 pb-16">
        {resolvedChildren}
      </main>

      {/* Compact FCA regulatory footer */}
      <footer
        data-testid="mitoview-public-footer"
        className="border-t border-slate-100 bg-[#f9fcff] px-4 py-8 text-xs leading-relaxed text-[#4A5568]"
      >
        <div className="mx-auto w-full max-w-[720px] space-y-2">
          <p className="font-medium text-[#090039]">
            © 2026 Funtech Global. All rights reserved.
          </p>
          <p>
            Rhemito is a trademark owned by Funtech Global Communications Ltd.
            Devonshire House, Manor Way, Borehamwood, Herts. WD6 1QQ, United
            Kingdom. A registered payment institution in the UK with
            registration details FRN: 815146 MLR NO: 12803115.
          </p>
          <p>Rhemito is powered by mito.money.</p>
        </div>
      </footer>
    </div>
  );
}
