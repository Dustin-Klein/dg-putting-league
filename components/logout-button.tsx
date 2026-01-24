"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  const logout = async () => {
    const supabase = createClient();
    try {
      await supabase.auth.signOut();
    } catch {
      // Proceed to login page regardless - session will expire eventually
    }
    router.push("/auth/login");
  };

  return <Button onClick={logout}>Logout</Button>;
}
