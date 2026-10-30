"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { User } from "@supabase/supabase-js";
import { Menu, Sun, Moon, Laptop, LogOut } from "lucide-react";
import { useTheme } from "next-themes";
import { createClient } from "@/lib/supabase/client";
import { PUBLIC_NAV_LINKS } from "@/components/nav-links";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function MobileNav() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const supabase = createClient();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    try {
      await supabase.auth.signOut();
    } catch {
      // Proceed to login page regardless - session will expire eventually
    }
    router.push("/auth/login");
  };

  if (loading || !mounted) {
    return <div className="size-11" />;
  }

  const ICON_SIZE = 16;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open menu">
          <Menu size={22} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {PUBLIC_NAV_LINKS.map((link) => (
          <DropdownMenuItem key={link.href} asChild>
            <Link href={link.href}>{link.label}</Link>
          </DropdownMenuItem>
        ))}

        {user ? (
          <>
            <DropdownMenuItem asChild>
              <Link href="/admin/leagues">My Leagues</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="font-normal text-xs text-muted-foreground truncate">
              {user.email}
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut size={ICON_SIZE} className="mr-2" />
              Logout
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/auth/login">Sign in</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/auth/sign-up">Sign up</Link>
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Theme
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light" className="flex gap-2">
            <Sun size={ICON_SIZE} className="text-muted-foreground" />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" className="flex gap-2">
            <Moon size={ICON_SIZE} className="text-muted-foreground" />
            Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" className="flex gap-2">
            <Laptop size={ICON_SIZE} className="text-muted-foreground" />
            System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
