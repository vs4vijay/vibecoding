import { EventListSkeleton, Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-8">
      <div className="border-b border-neutral-200 dark:border-neutral-800 pb-6 mb-8 space-y-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-6 w-40 mb-4" />
      <EventListSkeleton count={3} />
    </main>
  );
}
