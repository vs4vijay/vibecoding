import { JobsTable } from '@/components/jobs/JobsTable';
import { JobStats } from '@/components/jobs/JobStats';
import { EnqueueJobButton } from '@/components/jobs/EnqueueJobButton';
import { getJobs } from '@/lib/worker';

// Force Node.js runtime for PGlite compatibility
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const jobs = await getJobs({ limit: 100 });

  // Calculate stats
  const stats = {
    total: jobs.length,
    pending: jobs.filter((j: any) => j.status === 'pending').length,
    active: jobs.filter((j: any) => j.status === 'active').length,
    scheduled: jobs.filter((j: any) => j.status === 'scheduled').length,
    failed: jobs.filter((j: any) => j.status === 'failed').length,
  };

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
          <EnqueueJobButton />
        </div>

        {/* Stats */}
        <JobStats stats={stats} />

        {/* Jobs Table */}
        <div className="mt-8">
          <JobsTable jobs={jobs} />
        </div>
      </div>
    </div>
  );
}
