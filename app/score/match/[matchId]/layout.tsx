export default function MatchScoringLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-background overflow-hidden touch-manipulation md:static md:z-auto md:overflow-visible">
      {children}
    </div>
  );
}
