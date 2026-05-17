import { EventListSkeleton, Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-8">
      <div className="mb-8 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-full max-w-md" />
      </div>
      <EventListSkeleton />
    </main>
  );
}
