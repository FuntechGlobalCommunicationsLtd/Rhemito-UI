import { useLocation } from "wouter";
import { ChevronRight } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

export default function SupportHub() {
  const [, navigate] = useLocation();

  return (
    <DashboardLayout>
      <div data-testid="page-support-hub" className="w-full pb-12">
        <h1 className="font-display text-2xl font-light tracking-tight text-[#323130] md:text-[30px]">
          Support
        </h1>

        <div className="mt-8 space-y-3">
          <button
            type="button"
            data-testid="card-support-faqs"
            onClick={() => navigate("/support/faq")}
            className="flex w-full cursor-pointer items-center justify-between rounded-[4px] border border-[#E1DFDD] bg-[#F9F9FA] px-5 py-4 text-left transition-colors duration-150 hover:border-[#69afe5] hover:bg-[#D3EBFF]/70"
          >
            <span className="text-[16px] font-medium text-[#323130]">FAQs</span>
            <ChevronRight className="h-5 w-5 shrink-0 text-[#9B9B9B]" />
          </button>

          <button
            type="button"
            data-testid="card-support-my-tickets"
            onClick={() => navigate("/support/my-tickets")}
            className="flex w-full cursor-pointer items-center justify-between rounded-[4px] border border-[#E1DFDD] bg-[#F9F9FA] px-5 py-4 text-left transition-colors duration-150 hover:border-[#69afe5] hover:bg-[#D3EBFF]/70"
          >
            <span className="text-[16px] font-medium text-[#323130]">
              My tickets
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-[#9B9B9B]" />
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}
