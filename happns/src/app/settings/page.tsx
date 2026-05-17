import { cookies } from "next/headers";
import { SourceToggleList } from "@/components/SourceToggleList";
import {
  DISABLED_SOURCES_COOKIE,
  parseDisabledSources,
} from "@/lib/sourcePrefs";
import { SOURCES } from "@/lib/sources/registry";

export const metadata = {
  title: "Settings · happns",
};

export default async function SettingsPage() {
  const store = await cookies();
  const disabled = parseDisabledSources(store.get(DISABLED_SOURCES_COOKIE)?.value);

  const items = SOURCES.map((s) => ({
    id: s.id,
    label: s.label,
    description: s.description,
  }));

  return (
    <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-10">
      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-1">
          Settings
        </h1>
        <p className="text-[var(--muted)]">
          Choose which sources show up in your event feed. Preferences are
          stored in a cookie on this device.
        </p>
      </header>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-xs uppercase tracking-wide font-semibold text-[var(--muted)] mb-4">
          Event sources
        </h2>
        <SourceToggleList
          sources={items}
          initialDisabled={[...disabled]}
        />
      </section>
    </main>
  );
}
