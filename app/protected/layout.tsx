import { AuthButton } from "@/components/auth-button";
import Link from "next/link";
import { Suspense } from "react";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen flex flex-col">
      <nav className="w-full border-b border-b-foreground/10 h-16 px-4">
        <div className="max-w-5xl mx-auto flex justify-between items-center h-full">
          <Link href="/" className="font-semibold">
            DG Putting League
          </Link>
          <Suspense>
            <AuthButton />
          </Suspense>
        </div>
      </nav>
      <div className="flex-1 p-4">
        {children}
      </div>
    </main>
  );
}
