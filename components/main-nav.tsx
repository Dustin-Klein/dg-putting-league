import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { AuthButton } from "@/components/auth-button";

export async function MainNav() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const isLoggedIn = !!data.user;

  return (
    <nav className="w-full border-b border-b-foreground/10 h-16 px-4">
      <div className="max-w-5xl mx-auto flex justify-between items-center h-full">
        <Link href="/" className="font-semibold">
          DG Putting League
        </Link>
        <div className="flex items-center gap-4">
          {isLoggedIn && (
            <Button asChild variant="ghost">
              <Link href="/leagues">My Leagues</Link>
            </Button>
          )}
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
