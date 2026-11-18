import Link from "next/link";
import pkg from "@/package.json";

export function SiteFooter() {
  return (
    <footer className="w-full border-t">
      <div className="mx-auto flex max-w-[1200px] items-center justify-center gap-3 px-4 py-3 text-xs text-muted-foreground md:px-6">
        <span data-app-version className="tabular-nums">v{pkg.version}</span>
        <span aria-hidden="true">·</span>
        <Link href="/whats-new" className="underline-offset-4 hover:text-foreground hover:underline">
          What&apos;s new?
        </Link>
      </div>
    </footer>
  );
}
