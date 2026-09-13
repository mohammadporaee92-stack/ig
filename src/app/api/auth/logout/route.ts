import { NextResponse } from 'next/server';
import { clearSessionCookie } from '~/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  await clearSessionCookie();
  return NextResponse.json({ ok: true, redirect: '/login' });
}
