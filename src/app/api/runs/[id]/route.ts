import { error, json, withAuth } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withAuth(async ({ user, container, request }) => {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  const id = parts[2] ?? '';
  const run = await container.repos.runs.findByIdScoped(user.sub, id);
  if (!run) return error('اجرا یافت نشد', 404);
  const events = await container.repos.runEvents.listByRun(user.sub, id);
  return json({ run, events });
});
