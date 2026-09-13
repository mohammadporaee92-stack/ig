import type { Repositories } from '~/infra/db/repositories';

/**
 * کوئری‌های خواندنی داشبورد.
 * ⚠️ همهٔ آن‌ها userId می‌گیرند و در WHERE استفاده می‌کنند (Tenant Isolation).
 */

export interface DashboardStats {
  activeAutomations: number;
  totalAutomations: number;
  commentsProcessed: number;
  dmSent: number;
  followGateRequests: number;
  successfulDeliveries: number;
  errors: number;
  awaitingInteraction: number;
  conversionRate: number;
}

export async function getDashboardStats(repos: Repositories, userId: string): Promise<DashboardStats> {
  const q = async (sql: string, params: unknown[] = []) => {
    const r = await repos.db.query<{ c: number }>(sql, [userId, ...params]);
    return Number(r.rows[0]?.c ?? 0);
  };

  const [activeAutomations, totalAutomations, commentsProcessed, dmSent, followGateRequests, successfulDeliveries, errors, awaiting] =
    await Promise.all([
      q(`SELECT count(*)::int AS c FROM automations WHERE user_id=$1 AND status='active'`),
      q(`SELECT count(*)::int AS c FROM automations WHERE user_id=$1`),
      q(`SELECT count(*)::int AS c FROM automation_runs WHERE user_id=$1`),
      q(`SELECT count(*)::int AS c FROM message_logs WHERE user_id=$1 AND channel='direct_message' AND status='sent'`),
      q(`SELECT count(*)::int AS c FROM message_logs WHERE user_id=$1 AND kind='follow_gate' AND status='sent'`),
      q(`SELECT count(*)::int AS c FROM automation_runs WHERE user_id=$1 AND delivered = TRUE`),
      q(`SELECT count(*)::int AS c FROM automation_runs WHERE user_id=$1 AND status='failed'`),
      q(`SELECT count(*)::int AS c FROM automation_runs WHERE user_id=$1 AND status IN ('awaiting_user_interaction','follow_gate_sent')`),
    ]);

  return {
    activeAutomations,
    totalAutomations,
    commentsProcessed,
    dmSent,
    followGateRequests,
    successfulDeliveries,
    errors,
    awaitingInteraction: awaiting,
    conversionRate: commentsProcessed ? successfulDeliveries / commentsProcessed : 0,
  };
}

export interface AutomationSummary {
  id: string;
  name: string;
  status: string;
  keywords: string[];
  trigger: string;
  followGate: boolean;
  publicReply: boolean;
  privateReply: boolean;
  totalRuns: number;
  lastRunAt: Date | null;
  delivered: number;
  failed: number;
}

export async function listAutomationSummaries(repos: Repositories, userId: string): Promise<AutomationSummary[]> {
  const rows = await repos.db.query<{
    id: string; name: string; status: string; trigger_type: string;
    follow_gate_enabled: boolean; public_reply_enabled: boolean; private_reply_enabled: boolean;
    total_runs: number; last_run_at: Date | null; keywords: string | null;
    delivered: number; failed: number;
  }>(
    `SELECT a.id, a.name, a.status, a.trigger_type, a.follow_gate_enabled,
            a.public_reply_enabled, a.private_reply_enabled, a.total_runs, a.last_run_at,
            (SELECT string_agg(k.keyword, ',' ORDER BY k.created_at) FROM automation_keywords k WHERE k.automation_id = a.id) AS keywords,
            (SELECT count(*)::int FROM automation_runs r WHERE r.automation_id = a.id AND r.delivered) AS delivered,
            (SELECT count(*)::int FROM automation_runs r WHERE r.automation_id = a.id AND r.status='failed') AS failed
       FROM automations a
      WHERE a.user_id = $1
      ORDER BY a.created_at DESC`,
    [userId],
  );

  return rows.rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    keywords: r.keywords ? r.keywords.split(',') : [],
    trigger: r.trigger_type,
    followGate: r.follow_gate_enabled,
    publicReply: r.public_reply_enabled,
    privateReply: r.private_reply_enabled,
    totalRuns: Number(r.total_runs),
    lastRunAt: r.last_run_at,
    delivered: Number(r.delivered),
    failed: Number(r.failed),
  }));
}

export interface AutomationAnalytics {
  automationId: string;
  name: string;
  comments: number;
  matches: number;
  dmSent: number;
  followGate: number;
  followChecked: number;
  following: number;
  notFollowing: number;
  unknownFollow: number;
  success: number;
  failed: number;
  awaiting: number;
  conversionRate: number;
}

export async function getAnalytics(repos: Repositories, userId: string): Promise<AutomationAnalytics[]> {
  const rows = await repos.db.query<Record<string, unknown>>(
    `SELECT a.id AS automation_id, a.name,
            count(r.id)::int                                                        AS matches,
            count(r.id) FILTER (WHERE r.status <> 'skipped')::int                   AS comments,
            (SELECT count(*)::int FROM message_logs m WHERE m.run_id IN (SELECT id FROM automation_runs WHERE automation_id=a.id) AND m.channel='direct_message' AND m.status='sent') AS dm_sent,
            count(r.id) FILTER (WHERE r.status = 'follow_gate_sent')::int           AS follow_gate,
            count(r.id) FILTER (WHERE r.follow_status IS NOT NULL)::int             AS follow_checked,
            count(r.id) FILTER (WHERE r.follow_status = 'following')::int           AS following,
            count(r.id) FILTER (WHERE r.follow_status = 'not_following')::int       AS not_following,
            count(r.id) FILTER (WHERE r.follow_status = 'unknown')::int             AS unknown_follow,
            count(r.id) FILTER (WHERE r.delivered)::int                             AS success,
            count(r.id) FILTER (WHERE r.status = 'failed')::int                     AS failed,
            count(r.id) FILTER (WHERE r.status = 'awaiting_user_interaction')::int  AS awaiting
       FROM automations a
       LEFT JOIN automation_runs r ON r.automation_id = a.id AND r.user_id = $1
      WHERE a.user_id = $1
      GROUP BY a.id, a.name
      ORDER BY count(r.id) DESC`,
    [userId],
  );

  return rows.rows.map((r) => {
    const matches = Number(r.matches ?? 0);
    const success = Number(r.success ?? 0);
    return {
      automationId: String(r.automation_id),
      name: String(r.name),
      comments: Number(r.comments ?? 0),
      matches,
      dmSent: Number(r.dm_sent ?? 0),
      followGate: Number(r.follow_gate ?? 0),
      followChecked: Number(r.follow_checked ?? 0),
      following: Number(r.following ?? 0),
      notFollowing: Number(r.not_following ?? 0),
      unknownFollow: Number(r.unknown_follow ?? 0),
      success,
      failed: Number(r.failed ?? 0),
      awaiting: Number(r.awaiting ?? 0),
      conversionRate: matches ? success / matches : 0,
    };
  });
}

export async function getRecentRuns(repos: Repositories, userId: string, limit = 10) {
  const rows = await repos.db.query<{
    id: string; username: string | null; comment_text: string | null; matched_keyword: string | null;
    status: string; follow_status: string | null; delivered: boolean; started_at: Date; automation_name: string;
  }>(
    `SELECT r.id, r.username, r.comment_text, r.matched_keyword, r.status, r.follow_status,
            r.delivered, r.started_at, a.name AS automation_name
       FROM automation_runs r
       JOIN automations a ON a.id = r.automation_id
      WHERE r.user_id = $1
      ORDER BY r.started_at DESC
      LIMIT $2`,
    [userId, Math.min(limit, 100)],
  );
  return rows.rows;
}

export async function getDailySeries(repos: Repositories, userId: string, days = 14) {
  const rows = await repos.db.query<{ d: string; runs: number; delivered: number; failed: number }>(
    `SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS d,
            count(*)::int AS runs,
            count(*) FILTER (WHERE delivered)::int AS delivered,
            count(*) FILTER (WHERE status='failed')::int AS failed
       FROM automation_runs
      WHERE user_id = $1 AND started_at > now() - ($2 || ' days')::interval
      GROUP BY 1 ORDER BY 1`,
    [userId, String(days)],
  );
  return rows.rows.map((r) => ({ date: r.d, runs: Number(r.runs), delivered: Number(r.delivered), failed: Number(r.failed) }));
}
