"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "./ui/button";
import { createClient } from "@/lib/supabase/client";
import { LogoutButton } from "./logout-button";
import { useEffect, useState } from "react";
import { User } from "@supabase/supabase-js";

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const current = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Button
      asChild
      variant="ghost"
      className={current ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground"}
    >
      <Link href={href} aria-current={current ? "page" : undefined}>
        {children}
      </Link>
    </Button>
  );
}

export function AuthButton() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    // Get initial user
    supabase.auth
      .getUser()
      .then(({ data }) => {
        setUser(data.user);
      })
      .catch(() => {
        // If this fails, treat as signed out so the UI is usable.
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return <div className="h-10 w-24" />; // Placeholder to prevent layout shift
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-1">
        <NavLink href="/score">Score</NavLink>
        <NavLink href="/players">Players</NavLink>
        {user && <NavLink href="/admin/leagues">My Leagues</NavLink>}
      </div>
      {user ? (
        <>
          <span className="text-sm text-muted-foreground">Hey, {user.email}!</span>
          <LogoutButton />
        </>
      ) : (
        <div className="flex gap-2">
          <Button asChild variant={"outline"} className="h-10">
            <Link href="/auth/login">Sign in</Link>
          </Button>
          <Button asChild variant={"default"} className="h-10">
            <Link href="/auth/sign-up">Sign up</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
