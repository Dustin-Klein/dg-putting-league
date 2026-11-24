import { cn } from '@/lib/utils/utils';

/** The dark scoreboard panel that heads a league page, matching the admin event header. */
export function LeagueBoard({
  kicker,
  title,
  subtitle,
  actions,
  aside,
  className,
}: {
  kicker: string;
  title: string;
  subtitle?: React.ReactNode;
  /** Buttons under the subtitle. */
  actions?: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label="League"
      className={cn(
        'dark flex flex-col justify-between gap-6 rounded-[18px] border bg-board px-5 py-6 text-foreground sm:flex-row sm:flex-wrap sm:items-center sm:px-[30px] sm:py-[26px]',
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase">{kicker}</span>
        <h1 className="font-score text-5xl leading-[0.95] font-bold text-balance sm:text-[64px]">{title}</h1>
        {subtitle && <p className="text-base text-foreground/80">{subtitle}</p>}
        {actions && <div className="mt-2.5 flex flex-wrap gap-2.5">{actions}</div>}
      </div>
      {aside}
    </section>
  );
}
