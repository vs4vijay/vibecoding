import { NextRequest, NextResponse } from 'next/server';
import { executeQuery, getPGliteInstance } from '@/lib/db';
import { enqueueJob } from '@/lib/worker';
import { z } from 'zod';

// Force Node.js runtime for PGlite compatibility
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Schema validation
const createItemSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  processInBackground: z.boolean().optional().default(true),
});

function generateCuid() {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 15);
  return `c${timestamp}${randomStr}`;
}

/**
 * GET /api/items
 * List all items with optional pagination
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const items = await executeQuery(
      `SELECT * FROM items ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const totalResult = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM items`
    );
    const total = Number(totalResult[0]?.count || 0);

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
    console.error('Failed to fetch items:', error);
    return NextResponse.json(
      { error: 'Failed to fetch items' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/items
 * Create a new item and optionally enqueue background processing
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = createItemSchema.parse(body);

    const id = generateCuid();
    const name = data.name;
    const description = data.description || null;

    // Create item using raw SQL
    await executeQuery(
      `INSERT INTO items (id, name, description) VALUES ($1, $2, $3)`,
      [id, name, description]
    );

    // Fetch the created item
    const items = await executeQuery(
      `SELECT * FROM items WHERE id = $1`,
      [id]
    );
    const item = items[0];

    // Enqueue background job if requested
    if (data.processInBackground) {
      await enqueueJob('process-item', {
        itemId: item.id,
        action: 'process',
      });
    }

    return NextResponse.json(
      {
        item,
        backgroundJobEnqueued: data.processInBackground,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.issues },
        { status: 400 }
      );
    }

    console.error('Failed to create item:', error);
    return NextResponse.json(
      { error: 'Failed to create item' },
      { status: 500 }
    );
  }
}
