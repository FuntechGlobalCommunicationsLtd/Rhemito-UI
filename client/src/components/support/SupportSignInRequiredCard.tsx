import { useLocation } from "wouter";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SupportSignInRequiredCardProps {
  redirectPath?: string;
}

export function SupportSignInRequiredCard({
  redirectPath = "/support/my-tickets",
}: SupportSignInRequiredCardProps) {
  const [, navigate] = useLocation();

  return (
    <div
      data-testid="card-support-signin-required"
      className="mt-8 flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-[#F9F9FA] px-6 py-14 text-center"
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
        <LifeBuoy className="h-8 w-8 text-[#2e5bff]" />
      </div>

      <h2 className="font-display text-lg font-semibold text-[#323130] md:text-xl">
        Sign in to manage your support tickets
      </h2>

      <p className="mt-2 max-w-md text-sm leading-relaxed text-[#605E5C]">
        Sign in with your Rhemito account to view live tickets, create new
        enquiries, and reply to customer support.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button
          type="button"
          data-testid="button-support-signin"
          onClick={() => navigate(`/sign-in-sign-up?redirect=${redirectPath}`)}
          className="h-10 cursor-pointer rounded-full bg-[#2e5bff] px-6 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Sign in
        </Button>

        <Button
          type="button"
          variant="outline"
          data-testid="button-support-browse-faqs"
          onClick={() => navigate("/support/faq")}
          className="h-10 cursor-pointer rounded-full border-slate-300 bg-white px-6 text-sm font-medium text-[#323130] hover:bg-slate-50"
        >
          Browse FAQs
        </Button>
      </div>
    </div>
  );
}
