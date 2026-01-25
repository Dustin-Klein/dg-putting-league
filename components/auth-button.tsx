"use client";

import Link from "next/link";
import { Button } from "./ui/button";
import { createClient } from "@/lib/supabase/client";
import { LogoutButton } from "./logout-button";
import { useEffect, useState } from "react";
import { User } from "@supabase/supabase-js";

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
    return <div className="h-9 w-24" />; // Placeholder to prevent layout shift
  }

  return (
    <div className="flex items-center gap-4">
      <Button asChild variant="ghost">
        <Link href="/score">Score</Link>
      </Button>
      <Button asChild variant="ghost">
        <Link href="/players">Players</Link>
      </Button>
      {user ? (
        <>
          <Button asChild variant="ghost">
            <Link href="/admin/leagues">My Leagues</Link>
          </Button>
          Hey, {user.email}!
          <LogoutButton />
        </>
      ) : (
        <div className="flex gap-2">
          <Button asChild size="sm" variant={"outline"}>
            <Link href="/auth/login">Sign in</Link>
          </Button>
          <Button asChild size="sm" variant={"default"}>
            <Link href="/auth/sign-up">Sign up</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
