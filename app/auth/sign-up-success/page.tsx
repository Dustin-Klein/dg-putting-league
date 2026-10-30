import Link from "next/link";
import { Mail } from "lucide-react";
import { AuthCard, AuthPage } from "@/components/auth-card";

export default function Page() {
  return (
    <AuthPage>
      <AuthCard
        title="Thank you for signing up!"
        description="Check your email to confirm"
        icon={<Mail />}
      >
        <p className="text-[15px] leading-normal text-muted-foreground">
          You&apos;ve successfully signed up. Please check your email to
          confirm your account before signing in.
        </p>
        <Link href="/auth/login" className="text-sm text-info underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </AuthCard>
    </AuthPage>
  );
}
