import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse, parsePagination } from '@/lib/api';
import { queue } from '@/lib/queue';
import { tasks } from '@/workers/tasks';

const enqueueJobSchema = z.object({
  taskName: z.string().refine((name) => Object.hasOwn(tasks, name), 'Unknown task'),
  payload: z.record(z.string(), z.unknown()).default({}),
  runAt: z.iso.datetime().optional(),
  maxAttempts: z.number().int().min(1).max(100).optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
});

/**
 * GET /api/jobs
 * List jobs, newest first, with their status
 */
export async function GET(request: NextRequest) {
  try {
    const pagination = parsePagination(request.nextUrl.searchParams);
    const jobs = await queue.getJobs(pagination);

    return NextResponse.json({ jobs, pagination });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch jobs');
  }
}

/**
 * POST /api/jobs
 * Manually enqueue a job for testing
 */
export async function POST(request: NextRequest) {
  try {
    const data = enqueueJobSchema.parse(await request.json());

    const job = await queue.enqueue(data.taskName, data.payload, {
      runAt: data.runAt ? new Date(data.runAt) : undefined,
      maxAttempts: data.maxAttempts,
      priority: data.priority,
    });

    return NextResponse.json({ success: true, job }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Failed to enqueue job');
  }
}
