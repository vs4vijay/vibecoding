import { NextResponse } from 'next/server';
import { z } from 'zod';

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function parsePagination(searchParams: URLSearchParams) {
  return paginationSchema.parse({
    limit: searchParams.get('limit') ?? undefined,
    offset: searchParams.get('offset') ?? undefined,
  });
}

/** Map a thrown error to a JSON response: 400 for bad input, 500 (logged) for everything else. */
export function errorResponse(error: unknown, message: string) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 });
  }

  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  console.error(`${message}:`, error);
  return NextResponse.json({ error: message }, { status: 500 });
}
