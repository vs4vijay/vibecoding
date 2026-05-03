import { NextRequest, NextResponse } from 'next/server';
import { getJobs, enqueueJob } from '@/lib/worker';
import { z } from 'zod';

// Force Node.js runtime for PGlite compatibility
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const enqueueJobSchema = z.object({
  taskName: z.string(),
  payload: z.record(z.string(), z.any()),
  runAt: z.string().datetime().optional(),
  maxAttempts: z.number().int().min(1).max(100).optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
});

/**
 * GET /api/jobs
 * List all jobs with their status
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const jobs = await getJobs({ limit, offset });

    return NextResponse.json({
      jobs,
      pagination: {
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error('Failed to fetch jobs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/jobs
 * Manually enqueue a job for testing
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = enqueueJobSchema.parse(body);

    await enqueueJob(
      data.taskName,
      data.payload,
      {
        runAt: data.runAt ? new Date(data.runAt) : undefined,
        maxAttempts: data.maxAttempts,
        priority: data.priority,
      }
    );

    return NextResponse.json(
      { success: true, message: 'Job enqueued successfully' },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.issues },
        { status: 400 }
      );
    }

    console.error('Failed to enqueue job:', error);
    return NextResponse.json(
      { error: 'Failed to enqueue job' },
      { status: 500 }
    );
  }
}
