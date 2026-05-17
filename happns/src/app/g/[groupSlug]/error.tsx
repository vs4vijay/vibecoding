"use client";

import Link from "next/link";

export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="flex-1 max-w-2xl mx-auto px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold mb-3">
        Couldn&apos;t load this group
      </h1>
      <p className="text-neutral-600 dark:text-neutral-400 mb-6">
        Meetup didn&apos;t return a usable response. Please try again.
      </p>
      <div className="flex justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          Retry
        </button>
        <Link
          href="/"
          className="px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 text-sm font-medium"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
