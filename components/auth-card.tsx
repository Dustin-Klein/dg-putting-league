import type { ReactNode } from "react";
import { cn } from "@/lib/utils/utils";

const ICON_TONES = {
  success: "bg-success/15 text-success",
  danger: "bg-destructive/15 text-destructive",
};

/** The single card on each /auth page (Login.dc.html, AuthStates.dc.html). */
export function AuthCard({
  title,
  description,
  icon,
  iconTone = "success",
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  iconTone?: keyof typeof ICON_TONES;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-[18px] rounded-[20px] border bg-card p-6 sm:p-8", className)}>
      {icon && (
        <span
          aria-hidden="true"
          className={cn("flex size-[52px] items-center justify-center rounded-[14px] [&_svg]:size-[26px]", ICON_TONES[iconTone])}
        >
          {icon}
        </span>
      )}
      <div className="flex flex-col gap-1.5">
        <h1 className="font-score text-[40px] leading-none font-bold">{title}</h1>
        {description && <p className="text-[15px] leading-normal text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** Centers an auth card under the site header. */
export function AuthPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full justify-center px-4 py-12">
      <div className="w-full max-w-[420px]">{children}</div>
    </div>
  );
}
