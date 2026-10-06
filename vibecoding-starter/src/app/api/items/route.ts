import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse, parsePagination } from '@/lib/api';
import { executeQuery } from '@/lib/db';
import { queue } from '@/lib/queue';

const createItemSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  processInBackground: z.boolean().optional().default(true),
});

/**
 * GET /api/items
 * List items, newest first, with pagination
 */
export async function GET(request: NextRequest) {
  try {
    const { limit, offset } = parsePagination(request.nextUrl.searchParams);

    const [items, totalResult] = await Promise.all([
      executeQuery(
        `SELECT * FROM items ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      executeQuery<{ count: number }>(`SELECT COUNT(*)::int AS count FROM items`),
    ]);
    const total = totalResult[0].count;

    return NextResponse.json({
      items,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch items');
  }
}

/**
 * POST /api/items
 * Create a new item and optionally enqueue background processing
 */
export async function POST(request: NextRequest) {
  try {
    const data = createItemSchema.parse(await request.json());

    const [item] = await executeQuery<{ id: string }>(
      `INSERT INTO items (id, name, description) VALUES ($1, $2, $3) RETURNING *`,
      [randomUUID(), data.name, data.description ?? null]
    );

    if (data.processInBackground) {
      await queue.enqueue('process-item', { itemId: item.id });
    }

    return NextResponse.json(
      {
        item,
        backgroundJobEnqueued: data.processInBackground,
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error, 'Failed to create item');
  }
}
