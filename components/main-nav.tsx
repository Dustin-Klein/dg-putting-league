import Link from "next/link";
import { Suspense } from "react";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { AuthButton } from "@/components/auth-button";
import { MobileNav } from "@/components/mobile-nav";

function LeagueMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

/**
 * The scoreboard band at the top of every page (Nav.dc.html). It is dark in both
 * themes, so its contents use the dark tokens; menus it opens are portaled out and
 * follow the page theme.
 */
export function MainNav() {
  return (
    <nav aria-label="Main" className="w-full bg-board border-b border-board dark:border-border">
      <div className="dark text-foreground max-w-5xl mx-auto flex justify-between items-center h-16 px-4">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <LeagueMark />
          <span className="font-score text-[22px] font-bold uppercase tracking-[0.03em] leading-none">
            DG Putting League
          </span>
        </Link>

        {/* Desktop navigation */}
        <div className="hidden md:flex items-center gap-4">
          <div className="flex items-center gap-2">
            <ThemeSwitcher />
            <Suspense>
              <AuthButton />
            </Suspense>
          </div>
        </div>

        {/* Mobile navigation */}
        <div className="flex md:hidden">
          <MobileNav />
        </div>
      </div>
    </nav>
  );
}
