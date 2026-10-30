import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { AuthCard, AuthPage } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { Suspense } from "react";

async function ErrorContent({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  const params = await searchParams;

  return (
    <>
      {params?.error ? (
        <p className="font-mono text-[13px] text-muted-foreground">
          Code error: {params.error}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          An unspecified error occurred.
        </p>
      )}
    </>
  );
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  return (
    <AuthPage>
      <div role="alert">
        <AuthCard
          title="Sorry, something went wrong."
          description="The link may have expired or already been used."
          icon={<AlertCircle />}
          iconTone="danger"
        >
          <Suspense>
            <ErrorContent searchParams={searchParams} />
          </Suspense>
          <Button asChild variant="outline" className="w-full">
            <Link href="/auth/login">Back to sign in</Link>
          </Button>
        </AuthCard>
      </div>
    </AuthPage>
  );
}
