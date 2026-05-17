import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <main className="flex-1">
      <article className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <Skeleton className="w-full h-64 sm:h-80 rounded-xl" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-3/4" />
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </article>
    </main>
  );
}
