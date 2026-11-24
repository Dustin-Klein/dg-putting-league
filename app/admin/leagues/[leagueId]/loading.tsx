import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 pt-7 pb-14 md:px-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-[148px] w-full rounded-[18px]" />
      <Skeleton className="h-9 w-56" />
      <div className="flex flex-col gap-5">
        {[1, 2, 3].map((i) => (
          <div key={i} className="grid grid-cols-[52px_18px_minmax(0,1fr)] gap-x-2.5 sm:grid-cols-[96px_28px_minmax(0,1fr)] sm:gap-x-3.5">
            <Skeleton className="ml-auto h-12 w-10" />
            <Skeleton className="mx-auto mt-6 size-3.5 rounded-full" />
            <Skeleton className="h-[104px] w-full rounded-[14px]" />
          </div>
        ))}
      </div>
    </div>
  )
}
