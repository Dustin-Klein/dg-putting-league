import type { Metadata } from 'next';
import { changelog } from '@/lib/changelog';

export const metadata: Metadata = {
  title: "What's new · DG Putting League",
};

function formatDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default function WhatsNewPage() {
  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-8 px-4 pt-10 pb-14 md:px-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-score text-5xl leading-none font-bold">What&apos;s new</h1>
        <p className="text-base text-muted-foreground">Recent changes to DG Putting League.</p>
      </div>

      {changelog.map((release) => (
        <section key={release.version} className="flex flex-col gap-5 rounded-2xl border bg-card p-[22px]">
          <div className="flex items-baseline justify-between gap-3 border-b border-muted pb-3.5">
            <h2 className="font-score text-[28px] leading-none font-bold tabular-nums">v{release.version}</h2>
            <time dateTime={release.date} className="text-sm text-muted-foreground">
              {formatDate(release.date)}
            </time>
          </div>
          {release.sections.map((section) => (
            <div key={section.title} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{section.title}</h3>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-relaxed">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
