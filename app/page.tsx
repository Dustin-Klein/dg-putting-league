import Link from 'next/link';
import { AccessCodeForm } from '@/components/access-code-form';

const LINKS = [
  {
    href: '/leagues',
    title: 'Follow a league',
    body: 'Live brackets, results and every event on the schedule.',
    cta: 'Browse leagues',
  },
  {
    href: '/players',
    title: 'Look up a player',
    body: 'Stats, handicap zone and event history by name or player number.',
    cta: 'Find players',
  },
  {
    href: '/auth/sign-up',
    title: 'Run your own putting league',
    body: 'Qualifying, pools, teams, double-elimination brackets and payouts.',
    cta: 'Sign up to get started',
  },
];

export default function Home() {
  return (
    <div className="flex flex-col">
      {/* Scoreboard band: dark in both themes, like the site header. */}
      <section className="bg-board border-b border-board dark:border-border">
        <div className="dark text-foreground mx-auto flex max-w-[1200px] flex-wrap items-center gap-12 px-4 pt-14 pb-16 md:px-6 md:pt-[72px] md:pb-20">
          <div className="flex flex-[999_1_480px] flex-col gap-[18px]">
            <span className="text-[13px] font-bold tracking-[0.1em] text-muted-foreground">
              PLAYING IN A LEAGUE TODAY?
            </span>
            <h1 className="font-score text-[clamp(48px,7vw,84px)] leading-[0.95] font-bold">Keep score from your phone.</h1>
            <p className="max-w-[520px] text-lg leading-normal text-foreground/80">
              Enter the access code your league organizer gave you. You&apos;ll see your lane, your match and
              every frame as you play.
            </p>
          </div>
          <div className="flex-[1_1_340px] rounded-[20px] border bg-card p-6">
            <AccessCodeForm label="Event access code" submitLabel="Keep score" />
          </div>
        </div>
      </section>

      <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-4 px-4 pt-10 pb-14 md:px-6">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex flex-col gap-2 rounded-2xl border bg-card p-6 transition-colors hover:border-input"
          >
            <span className="text-lg font-bold">{link.title}</span>
            <span className="text-[15px] leading-normal text-muted-foreground">{link.body}</span>
            <span className="mt-1.5 text-[15px] font-semibold text-info">{link.cta} →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
