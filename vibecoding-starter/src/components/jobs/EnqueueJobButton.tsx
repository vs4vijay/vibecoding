'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface EnqueueJobButtonProps {
  taskNames: string[];
}

export function EnqueueJobButton({ taskNames }: EnqueueJobButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskName, setTaskName] = useState(taskNames[0] ?? '');
  const [payload, setPayload] = useState('{\n  "itemId": "test-id"\n}');

  const close = () => {
    setIsOpen(false);
    setError(null);
  };

  const handleEnqueue = async () => {
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(payload);
    } catch {
      setError('Payload is not valid JSON');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskName, payload: parsedPayload }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Failed to enqueue job');
      }

      close();
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
      >
        Enqueue Test Job
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="enqueue-job-title"
            className="bg-white rounded-lg p-6 max-w-md w-full mx-4"
          >
            <h3 id="enqueue-job-title" className="text-lg font-semibold text-gray-900 mb-4">
              Enqueue Test Job
            </h3>

            <div className="space-y-4">
              <div>
                <label htmlFor="enqueue-job-task" className="block text-sm font-medium text-gray-700 mb-1">
                  Task Name
                </label>
                <select
                  id="enqueue-job-task"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {taskNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="enqueue-job-payload" className="block text-sm font-medium text-gray-700 mb-1">
                  Payload (JSON)
                </label>
                <textarea
                  id="enqueue-job-payload"
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {error && (
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              )}
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={handleEnqueue}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                {loading ? 'Enqueueing...' : 'Enqueue Job'}
              </button>
              <button
                onClick={close}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
