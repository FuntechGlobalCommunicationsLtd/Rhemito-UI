import { useRewards } from "@/hooks/use-rewards";
import { Link, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { resetDeviceId } from "@/lib/deviceId";
import { useToast } from "@/hooks/use-toast";
import {
  LayoutDashboard,
  BarChart2,
  Users,
  User,
  ShieldCheck,
  LifeBuoy,
  Settings,
  LogOut,
  X,
  Gift,
  ChevronLeft,
  ChevronRight,
  Bell,
  Newspaper,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface NavItemData {
  icon: any;
  label: string;
  href: string;
  enabled: boolean;
  tooltip?: string;
}

/** Approved Rhemito retail sidebar order (Reward$ after Transactions). */
const navItems: NavItemData[] = [
  { icon: LayoutDashboard, label: "Overview", href: "/", enabled: true },
  { icon: BarChart2, label: "Transactions", href: "/transactions", enabled: true },
  { icon: Gift, label: "Reward$", href: "/bonus-discounts", enabled: true },
  { icon: User, label: "Recipients", href: "/senders-recipients", enabled: true },
  { icon: Users, label: "Senders", href: "/senders-recipients", enabled: true },
  { icon: ShieldCheck, label: "Compliance", href: "/compliance", enabled: true },
  { icon: LifeBuoy, label: "Support", href: "/support", enabled: true },
  { icon: Newspaper, label: "MitoView", href: "/mitoview", enabled: true },
  { icon: Bell, label: "Notifications", href: "/notifications/archive", enabled: true },
  { icon: Settings, label: "Settings", href: "/settings", enabled: true },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({
  isOpen = false,
  onClose,
  collapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  const [location, setLocation] = useLocation();
  const rewards = useRewards();
  const rewardsWaiting = Boolean(
    rewards.data &&
      (rewards.data.wallet.balances.some((b) => b.available > 0) ||
        rewards.data.latestOffer)
  );
  const { toast } = useToast();

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch {
      // session may already be gone
    }
    toast({
      title: "Logged out",
      description: "You have been signed out successfully.",
    });
    resetDeviceId();
    queryClient.clear();
    setLocation("/sign-in-sign-up");
  };

  const NavItem = ({
    item,
    className,
    isCollapsed,
  }: {
    item: NavItemData;
    className?: string;
    isCollapsed: boolean;
  }) => {
    const isReward = item.href === "/bonus-discounts";
    const isActive =
      location === item.href ||
      (item.href !== "/" && location.startsWith(item.href)) ||
      (isReward && location.startsWith("/rewards"));

    const content = (
      <div
        className={cn(
          "flex items-center gap-3.5 rounded-lg px-4 py-2.5 text-[14px] transition-all duration-150",
          !item.enabled && "cursor-not-allowed opacity-50",
          item.enabled && "cursor-pointer",
          isCollapsed && "justify-center px-2",
          isActive
            ? "bg-[#e8f0fe]/90 font-semibold text-[#2e5bff]"
            : "font-medium text-[#605e5c] hover:bg-blue-50/60 hover:text-[#2e5bff]",
          className
        )}
        data-testid={`link-${item.label.toLowerCase().replace(/\$/g, "").replace(/\s+/g, "-")}`}
      >
        <item.icon
          className={cn(
            "h-[18px] w-[18px] shrink-0 transition-colors",
            isActive ? "text-[#2e5bff]" : "text-[#8a8886] group-hover:text-[#2e5bff]"
          )}
        />
        {!isCollapsed && (
          <div className="min-w-0 flex-1">
            <span className="block truncate">{item.label}</span>
            {isReward && rewardsWaiting && (
              <span className="text-[10px] font-medium text-[#2e5bff]/80">
                Rewards waiting!
              </span>
            )}
          </div>
        )}
        {isReward && rewardsWaiting && !isCollapsed && (
          <div className="flex items-center gap-1" data-testid="rewards-waiting-badge">
            <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-2xs">
              NEW
            </span>
          </div>
        )}
      </div>
    );

    const wrappedContent =
      item.tooltip || isCollapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{content}</TooltipTrigger>
          <TooltipContent side="right" className="border-0 bg-slate-900 text-white">
            <p>{item.tooltip || item.label}</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        content
      );

    if (!item.enabled) return wrappedContent;

    return (
      <Link key={`${item.label}-${item.href}`} href={item.href} onClick={onClose}>
        <div className="group">{wrappedContent}</div>
      </Link>
    );
  };

  const renderNavList = (isMobileDrawer: boolean) => {
    const isCollapsed = !isMobileDrawer && collapsed;
    return (
      <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-5">
        {navItems.map((item) => (
          <NavItem key={`${item.label}-${item.href}`} item={item} isCollapsed={isCollapsed} />
        ))}

        <button
          type="button"
          className={cn(
            "flex w-full cursor-pointer items-center gap-3.5 rounded-lg px-4 py-2.5 text-[14px] font-medium text-[#605e5c] transition-all duration-150 hover:bg-red-50/60 hover:text-red-600",
            isCollapsed && "justify-center px-2"
          )}
          data-testid="button-logout"
          onClick={handleLogout}
        >
          <LogOut className="h-[18px] w-[18px] shrink-0 text-[#8a8886]" />
          {!isCollapsed && <span>Logout</span>}
        </button>
      </nav>
    );
  };

  return (
    <>
      <aside
        className={cn(
          "fixed left-0 top-16 z-30 hidden h-[calc(100vh-4rem)] flex-col border-r border-[#f1f5f7] bg-[#f9fcff] transition-all duration-300 lg:flex",
          collapsed ? "w-20" : "w-60"
        )}
      >
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="absolute -right-3.5 top-7 z-40 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-[#2e5bff] text-white shadow-md transition-colors hover:bg-blue-700"
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        )}
        {renderNavList(false)}
      </aside>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm lg:hidden"
              onClick={onClose}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed left-0 top-0 z-50 flex h-screen w-72 flex-col bg-[#f9fcff] shadow-2xl lg:hidden"
            >
              <div className="flex items-center justify-between border-b border-[#f1f5f7] bg-white p-4">
                <div className="flex items-center gap-2.5">
                  <img
                    src="/Rhemito-logo.svg"
                    alt="Rhemito Logo"
                    className="h-[33px] w-[26px] object-contain"
                  />
                  <span className="font-display text-lg font-bold text-[#323130]">
                    Rhemito
                  </span>
                </div>
                <button
                  onClick={onClose}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700"
                  data-testid="button-collapse-sidebar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {renderNavList(true)}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
