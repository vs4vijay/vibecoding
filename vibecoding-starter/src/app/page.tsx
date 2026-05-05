import Link from 'next/link';
import { executeQuery } from '@/lib/db';

// Force Node.js runtime for PGlite compatibility
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function Home() {
  const result = await executeQuery<{ count: number }>('SELECT COUNT(*) as count FROM items');
  const itemCount = Number(result[0]?.count || 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-7xl mx-auto px-4 py-16 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            Postgres-for-Everything Starter
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            A full-stack Next.js starter with Prisma, PGlite, and PostgreSQL-based Job Queue.
            Everything runs on Postgres - no additional infrastructure needed.
          </p>
        </div>

        {/* Tech Stack */}
        <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">Tech Stack</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-medium text-gray-900 mb-2">Frontend</h3>
              <ul className="text-gray-600 space-y-1">
                <li>Next.js 15 (App Router)</li>
                <li>React 19</li>
                <li>Tailwind CSS</li>
                <li>TypeScript</li>
              </ul>
            </div>
            <div>
              <h3 className="font-medium text-gray-900 mb-2">Backend</h3>
              <ul className="text-gray-600 space-y-1">
                <li>Next.js API Routes</li>
                <li>Prisma ORM</li>
                <li>PostgreSQL / PGlite</li>
                <li>PostgreSQL Queue (Job Queue)</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="text-2xl mb-2">🗄️</div>
              <h3 className="font-medium text-gray-900 mb-2">Database</h3>
              <p className="text-sm text-gray-600">
                PGlite for local development, PostgreSQL for production. Same code, different environment.
              </p>
            </div>
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="text-2xl mb-2">⚡</div>
              <h3 className="font-medium text-gray-900 mb-2">Job Queue</h3>
              <p className="text-sm text-gray-600">
                Postgres-based background jobs with Graphile Worker. No Redis or additional services.
              </p>
            </div>
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="text-2xl mb-2">📊</div>
              <h3 className="font-medium text-gray-900 mb-2">Job Dashboard</h3>
              <p className="text-sm text-gray-600">
                Built-in UI to monitor job status, retries, and execution history.
              </p>
            </div>
          </div>
        </div>

        {/* Quick Links */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">Quick Links</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link
              href="/jobs"
              className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
            >
              <div>
                <h3 className="font-medium text-gray-900">Job Dashboard</h3>
                <p className="text-sm text-gray-600">Monitor background jobs</p>
              </div>
              <span className="text-blue-600">→</span>
            </Link>
            <a
              href="/api/items"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
            >
              <div>
                <h3 className="font-medium text-gray-900">Items API</h3>
                <p className="text-sm text-gray-600">
                  {itemCount} items in database
                </p>
              </div>
              <span className="text-blue-600">→</span>
            </a>
          </div>
        </div>

        {/* Getting Started */}
        <div className="mt-8 text-center">
          <p className="text-gray-600 mb-4">
            Try creating an item via the API to see background jobs in action
          </p>
          <code className="bg-gray-900 text-gray-100 px-4 py-2 rounded-lg inline-block text-sm">
            {`curl -X POST http://localhost:3000/api/items -H "Content-Type: application/json" -d '{"name":"Test Item","description":"Created via API"}'`}
          </code>
        </div>
      </div>
    </div>
  );
}
