/** The main event's lanes a second chance is borrowing. */
export function LentLanes({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
      Lanes lent
      {labels.map((label) => (
        <span
          key={label}
          className="flex h-7 min-w-[26px] items-center justify-center rounded-md border border-info bg-info/15 px-1 font-score text-[17px] font-bold text-info"
        >
          {label.replace(/^Lane\s*/i, '')}
        </span>
      ))}
    </span>
  );
}
