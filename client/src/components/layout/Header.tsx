import { Menu } from "lucide-react";
import { Link } from "wouter";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { useAuth } from "@/hooks/use-auth";
import { profileLabel, userInitials, welcomeName } from "@/lib/userDisplay";

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { user } = useAuth();
  const fullName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || welcomeName(user)
    : "";

  return (
    <header className="fixed top-0 left-0 right-0 h-16 bg-white border-b border-[#f1f5f7] flex items-center justify-between px-4 md:px-10 z-40">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="lg:hidden w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 active:scale-95 transition-all -ml-1 text-[#323130]"
          data-testid="button-mobile-menu"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <Link href="/" data-testid="link-logo-home">
          <div className="flex items-center gap-2.5 cursor-pointer">
            <img
              src="/Rhemito-logo.svg"
              alt="Rhemito Logo"
              className="w-[26px] h-[33px] object-contain"
            />
            <span className="font-display font-bold text-lg text-[#323130] tracking-tight">
              Rhemito
            </span>
          </div>
        </Link>
      </div>

      <div className="flex items-center gap-4 md:gap-6 ml-auto">
        <nav className="hidden md:flex items-center gap-4">
          <Link href="/home">
            <span
              className="px-2 py-1 text-sm font-semibold text-[#323130] hover:text-[#2e5bff] transition-colors cursor-pointer"
              data-testid="header-link-how-it-works"
            >
              How it works
            </span>
          </Link>
          <Link href="/sample-ticket">
            <span
              className="px-2 py-1 text-sm font-semibold text-[#323130] hover:text-[#2e5bff] transition-colors cursor-pointer"
              data-testid="header-link-help"
            >
              Help
            </span>
          </Link>
        </nav>

        <NotificationBell />

        <div
          className="flex items-center gap-2.5 cursor-pointer"
          data-testid="button-profile-menu"
        >
          <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-[#4296eb] flex items-center justify-center shadow-2xs shrink-0">
            <span
              className="text-white font-semibold text-xs leading-none"
              data-testid="header-initials"
            >
              {userInitials(user)}
            </span>
          </div>
          <div className="hidden sm:flex flex-col items-start leading-tight">
            {fullName && (
              <span className="text-xs md:text-sm font-medium text-[#323130]">
                {fullName}
              </span>
            )}
            <span
              className="text-[11px] text-slate-400 font-normal"
              data-testid="header-profile-label"
            >
              {profileLabel(user)}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

