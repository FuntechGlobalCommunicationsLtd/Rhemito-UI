import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { apiRequest, getQueryFn, queryClient } from "@/lib/queryClient";
import { resetDeviceId } from "@/lib/deviceId";
import { useToast } from "@/hooks/use-toast";
import {
  LayoutDashboard,
  BarChart2,
  Users,
  User,
  IdCard,
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
  filledIcon?: boolean;
  tooltip?: string;
}

/** Approved Rhemito retail sidebar order (Reward$ after Transactions). */
const navItems: NavItemData[] = [
  { icon: LayoutDashboard, label: "Overview", href: "/", enabled: true, filledIcon: true },
  { icon: BarChart2, label: "Transactions", href: "/transactions", enabled: true },
  { icon: Gift, label: "Reward$", href: "/bonus-discounts", enabled: true },
  { icon: User, label: "Recipients", href: "/senders-recipients?tab=recipients", enabled: true, filledIcon: true },
  { icon: Users, label: "Senders", href: "/senders-recipients", enabled: true, filledIcon: true },
  { icon: IdCard, label: "Compliance", href: "/compliance", enabled: true },
  { icon: LifeBuoy, label: "Support", href: "/support", enabled: true },
  { icon: Newspaper, label: "MitoView", href: "/mitoview", enabled: true },
  { icon: Bell, label: "Notifications", href: "/notifications/archive", enabled: true, filledIcon: true },
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
  const search = useSearch();
  const { data: unreadCountData } = useQuery<{ count: number } | null>({
    queryKey: ["/api/notifications/unread-count"],
    queryFn: getQueryFn<{ count: number }>({ on401: "returnNull" }),
    staleTime: 30_000,
  });
  const unreadNotifications = unreadCountData?.count ?? 0;
  const { data: unreadSupportData } = useQuery<{ count: number } | null>({
    queryKey: ["/api/support/unread-count"],
    queryFn: getQueryFn<{ count: number }>({ on401: "returnNull" }),
    staleTime: 15_000,
  });
  const unreadSupport = unreadSupportData?.count ?? 0;
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
    const isOverview = item.href === "/";
    const isReward = item.href === "/bonus-discounts";
    const isSupport = item.href === "/support";
    const isNotifications = item.href === "/notifications/archive";
    const isRecipientsItem = item.label === "Recipients";
    const isSendersItem = item.label === "Senders";
    const activeTabParam = new URLSearchParams(search).get("tab");

    const isActive = isRecipientsItem
      ? location.startsWith("/beneficiaries") ||
        (location === "/senders-recipients" && activeTabParam === "recipients")
      : isSendersItem
        ? location.startsWith("/senders/") ||
          (location === "/senders-recipients" && activeTabParam !== "recipients")
        : location === item.href ||
          (isOverview && location.startsWith("/overview")) ||
          (!isOverview && location.startsWith(item.href)) ||
          (isReward && location.startsWith("/rewards")) ||
          (isSupport && (location.startsWith("/support") || location.startsWith("/my-tickets")));

    const content = (
      <div
        className={cn(
          "flex items-center gap-5 rounded-lg px-5 py-3 text-[15px] transition-colors duration-150",
          !item.enabled && "cursor-not-allowed opacity-50",
          item.enabled && "cursor-pointer",
          isCollapsed && "justify-center px-2",
          isActive
            ? "font-medium text-[#2e5bff]"
            : "font-normal text-[#605e5c] hover:bg-slate-50 hover:text-[#2e5bff]",
          className
        )}
        data-testid={`link-${item.label.toLowerCase().replace(/\$/g, "").replace(/\s+/g, "-")}`}
      >
        <item.icon
          fill={item.filledIcon ? "currentColor" : "none"}
          strokeWidth={item.label === "Transactions" ? 2.5 : 1.9}
          className={cn(
            "h-[19px] w-[19px] shrink-0 transition-colors",
            isActive ? "text-[#2e5bff]" : "text-[#4a4a4a] group-hover:text-[#2e5bff]"
          )}
        />
        {!isCollapsed && (
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <span className="truncate">{item.label}</span>
            {isSupport && unreadSupport > 0 && (
              <span
                className="relative inline-flex shrink-0 items-center justify-center pt-1 pr-2"
                data-testid="sidebar-support-badge"
              >
                <Bell className="h-[18px] w-[18px] fill-[#2e5bff] text-[#2e5bff]" />
                <span className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#e84545] px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
                  {unreadSupport > 99 ? "99+" : unreadSupport}
                </span>
              </span>
            )}
            {isNotifications && unreadNotifications > 0 && (
              <span
                className="relative inline-flex shrink-0 items-center justify-center pt-1 pr-2"
                data-testid="sidebar-notifications-badge"
              >
                <Bell className="h-[18px] w-[18px] fill-[#605e5c] text-[#605e5c]" />
                <span className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#e84545] px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
                  {unreadNotifications > 99 ? "99+" : unreadNotifications}
                </span>
              </span>
            )}
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
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-5 pt-1">
        {navItems.map((item) => (
          <NavItem key={`${item.label}-${item.href}`} item={item} isCollapsed={isCollapsed} />
        ))}

        <button
          type="button"
          className={cn(
            "flex w-full cursor-pointer items-center gap-5 rounded-lg px-5 py-3 text-[15px] font-normal text-[#323130] transition-colors duration-150 hover:bg-red-50/60 hover:text-red-600",
            isCollapsed && "justify-center px-2"
          )}
          data-testid="button-logout"
          onClick={handleLogout}
        >
          <LogOut className="h-[19px] w-[19px] shrink-0 text-[#4a4a4a]" strokeWidth={1.9} />
          {!isCollapsed && <span>Logout</span>}
        </button>
      </nav>
    );
  };

  return (
    <>
      <aside
        className={cn(
          "fixed left-0 top-16 z-30 hidden h-[calc(100vh-4rem)] flex-col border-r border-[#f1f5f7] bg-white transition-all duration-300 lg:flex",
          collapsed ? "w-20" : "w-60"
        )}
      >
        {onToggleCollapse && (
          <div
            className={cn(
              "flex items-center pt-3 pb-1",
              collapsed ? "justify-center px-2" : "justify-end px-4"
            )}
          >
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-[#2e5bff] text-white transition-colors hover:bg-blue-700"
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4 stroke-[2.25]" />
              ) : (
                <ChevronLeft className="h-4 w-4 stroke-[2.25]" />
              )}
            </button>
          </div>
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
              className="fixed left-0 top-0 z-50 flex h-screen w-72 flex-col bg-white shadow-2xl lg:hidden"
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
