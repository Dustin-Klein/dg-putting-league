import { AuthButton } from "@/components/auth-button";
import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/theme-switcher";

async function NavBar() {
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

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <Suspense>
        <NavBar />
      </Suspense>
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-2xl text-center">
          <h1 className="text-4xl font-bold mb-6">Welcome to DG Putting League</h1>
          <p className="text-lg text-muted-foreground mb-8">
            Join or create disc golf putting leagues and compete with friends
          </p>
        </div>
      </main>
    </div>
  );
}
