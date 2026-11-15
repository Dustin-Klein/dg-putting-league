import { AccessCodeForm } from '@/components/access-code-form';

export default async function ScorePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { code } = await searchParams;
  const initialCode = typeof code === 'string' && code.trim() ? code.trim() : undefined;

  return (
    <div className="bg-background px-5 pt-10 pb-6">
      <div className="mx-auto flex w-full max-w-md flex-col gap-7">
        <div className="flex flex-col gap-2">
          <h1 className="font-score text-5xl leading-[0.95] font-bold">Keep score</h1>
          <p className="text-base leading-relaxed text-muted-foreground">
            Enter the event access code. Your organizer has it, and it&apos;s on the TV at the venue.
          </p>
        </div>
        <AccessCodeForm autoFocus initialCode={initialCode} />
      </div>
    </div>
  );
}
