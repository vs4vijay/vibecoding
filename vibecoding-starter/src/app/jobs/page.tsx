import { JobsTable } from '@/components/jobs/JobsTable';
import { JobStats } from '@/components/jobs/JobStats';
import { EnqueueJobButton } from '@/components/jobs/EnqueueJobButton';
import { queue } from '@/lib/queue';
import { tasks } from '@/workers/tasks';

// Always read live queue state instead of prerendering at build time.
export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const [jobs, counts] = await Promise.all([queue.getJobs({ limit: 100 }), queue.countJobs()]);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Background Jobs</h1>
            <p className="text-gray-600 mt-2">
              Monitor and manage your background job queue powered by PostgreSQL
            </p>
          </div>
          <EnqueueJobButton taskNames={Object.keys(tasks)} />
        </div>

        {/* Stats */}
        <JobStats counts={counts} />

        {/* Jobs Table */}
        <div className="mt-8">
          <JobsTable jobs={jobs} />
        </div>
      </div>
    </div>
  );
}
