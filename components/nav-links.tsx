"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/utils";

export const PUBLIC_NAV_LINKS = [
  { href: "/score", label: "Score" },
  { href: "/leagues", label: "Leagues" },
  { href: "/players", label: "Players" },
];

function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Score / Leagues / Players beside the logo, with the current section marked. */
export function NavLinks() {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-1 text-[15px] font-semibold">
      {PUBLIC_NAV_LINKS.map((link) => {
        const current = isCurrent(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-2 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              current ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
