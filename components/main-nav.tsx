import Link from "next/link";
import { Suspense } from "react";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { AuthButton } from "@/components/auth-button";

export function MainNav() {
  return (
    <nav className="w-full border-b border-b-foreground/10 h-16 px-4">
      <div className="max-w-5xl mx-auto flex justify-between items-center h-full">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-semibold">
            DG Putting League
          </Link>
          <Link
            href="/players"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Players
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <ThemeSwitcher />
            <Suspense>
              <AuthButton />
            </Suspense>
          </div>
        </div>
      </div>
    </nav>
  );
}
