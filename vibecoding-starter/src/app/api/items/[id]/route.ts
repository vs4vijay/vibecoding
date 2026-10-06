import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/api';
import { executeQuery } from '@/lib/db';

const updateItemSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
});

type Context = RouteContext<'/api/items/[id]'>;

function notFound() {
  return NextResponse.json({ error: 'Item not found' }, { status: 404 });
}

/**
 * GET /api/items/[id]
 * Get a single item by ID
 */
export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const items = await executeQuery('SELECT * FROM items WHERE id = $1', [id]);

    return items.length > 0 ? NextResponse.json({ item: items[0] }) : notFound();
  } catch (error) {
    return errorResponse(error, 'Failed to fetch item');
  }
}

/**
 * PATCH /api/items/[id]
 * Update an item
 */
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const data = updateItemSchema.parse(await request.json());

    const updates: string[] = [];
    const values: unknown[] = [];

    if (data.name !== undefined) {
      values.push(data.name);
      updates.push(`name = $${values.length}`);
    }
    if (data.description !== undefined) {
      values.push(data.description);
      updates.push(`description = $${values.length}`);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    values.push(id);
    const result = await executeQuery(
      `UPDATE items SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${values.length} RETURNING *`,
      values
    );

    return result.length > 0 ? NextResponse.json({ item: result[0] }) : notFound();
  } catch (error) {
    return errorResponse(error, 'Failed to update item');
  }
}

/**
 * DELETE /api/items/[id]
 * Delete an item
 */
export async function DELETE(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const result = await executeQuery('DELETE FROM items WHERE id = $1 RETURNING id', [id]);

    return result.length > 0 ? NextResponse.json({ success: true }) : notFound();
  } catch (error) {
    return errorResponse(error, 'Failed to delete item');
  }
}
