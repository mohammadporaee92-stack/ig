/**
 * Parser payload های رسمی Webhook اینستاگرام.
 *
 * دو شکل payload وجود دارد:
 *  1) entry[].changes[]   → فیلد `comments` (و `live_comments`, `mentions`)
 *  2) entry[].messaging[] → فیلدهای `messages`, `messaging_postbacks`, `messaging_optins`, ...
 */

export type ParsedEventType = 'comment' | 'message' | 'postback' | 'optin' | 'echo' | 'read' | 'unknown';

export interface ParsedCommentEvent {
  type: 'comment';
  /** IG_ID حساب Professional مقصد */
  igUserId: string;
  commentId: string;
  parentCommentId?: string;
  mediaId?: string;
  /** IGSID کامنت‌گذار */
  fromIgsid?: string;
  fromUsername?: string;
  text: string;
  timestamp?: Date;
  /** برای جلوگیری از self-trigger: کامنت خود صاحب پیج */
  isFromSelf: boolean;
  providerEventId: string;
}

export interface ParsedMessageEvent {
  type: 'message' | 'postback' | 'optin' | 'echo' | 'read';
  igUserId: string;
  senderIgsid: string;
  recipientId: string;
  messageId?: string;
  text?: string;
  /** payload دکمهٔ Quick Reply یا Postback — کلید ادامهٔ Flow */
  quickReplyPayload?: string;
  postbackPayload?: string;
  isEcho: boolean;
  timestamp?: Date;
  providerEventId: string;
}

export type ParsedEvent = ParsedCommentEvent | ParsedMessageEvent | { type: 'unknown'; providerEventId: string; igUserId?: string };

interface RawEntry {
  id?: string;
  time?: number;
  changes?: Array<{ field?: string; value?: Record<string, unknown> }>;
  messaging?: Array<Record<string, unknown>>;
}

export interface RawWebhookBody {
  object?: string;
  entry?: RawEntry[];
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
}

function tsToDate(v: unknown): Date | undefined {
  if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000);
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return undefined;
}

/** hash ساده برای رویدادهایی که ID طبیعی ندارند */
function fallbackId(prefix: string, parts: Array<string | undefined>): string {
  return `${prefix}:${parts.filter(Boolean).join('|')}`;
}

export function parseWebhookBody(body: RawWebhookBody): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  if (!body?.entry?.length) return out;

  for (const entry of body.entry) {
    const igUserId = asString(entry.id) ?? '';

    /* ── شکل ۱: changes[] → کامنت ── */
    for (const change of entry.changes ?? []) {
      const field = change.field ?? '';
      const value = (change.value ?? {}) as Record<string, unknown>;
      if (field !== 'comments' && field !== 'live_comments') {
        out.push({ type: 'unknown', providerEventId: fallbackId(field || 'change', [igUserId, String(entry.time)]), igUserId });
        continue;
      }

      const commentId = asString(value.id) ?? '';
      const from = (value.from ?? {}) as Record<string, unknown>;
      const media = (value.media ?? {}) as Record<string, unknown>;
      const parent = (value.parent_id ?? (value.parent as Record<string, unknown> | undefined)?.id) as unknown;
      const fromIgsid = asString(from.id);

      out.push({
        type: 'comment',
        igUserId,
        commentId,
        parentCommentId: asString(parent),
        mediaId: asString(media.id) ?? asString(value.media_id),
        fromIgsid,
        fromUsername: asString(from.username) ?? asString(value.username),
        text: asString(value.text) ?? '',
        timestamp: tsToDate(value.timestamp) ?? tsToDate(entry.time),
        // اگر IGSID فرستنده برابر IG_ID خود حساب باشد ⇒ کامنت خودِ صاحب پیج
        isFromSelf: Boolean(fromIgsid && igUserId && fromIgsid === igUserId),
        providerEventId: commentId || fallbackId('comment', [igUserId, asString(value.text), String(entry.time)]),
      });
    }

    /* ── شکل ۲: messaging[] → پیام / postback / optin ── */
    for (const m of entry.messaging ?? []) {
      const sender = (m.sender ?? {}) as Record<string, unknown>;
      const recipient = (m.recipient ?? {}) as Record<string, unknown>;
      const senderIgsid = asString(sender.id) ?? '';
      const recipientId = asString(recipient.id) ?? igUserId;
      const ts = tsToDate(m.timestamp) ?? tsToDate(entry.time);

      if (m.message) {
        const msg = m.message as Record<string, unknown>;
        const isEcho = msg.is_echo === true;
        const qr = (msg.quick_reply ?? {}) as Record<string, unknown>;
        const mid = asString(msg.mid);
        out.push({
          type: isEcho ? 'echo' : 'message',
          igUserId: recipientId,
          senderIgsid,
          recipientId,
          messageId: mid,
          text: asString(msg.text),
          quickReplyPayload: asString(qr.payload),
          isEcho,
          timestamp: ts,
          providerEventId: mid ?? fallbackId('msg', [senderIgsid, recipientId, String(m.timestamp)]),
        });
        continue;
      }

      if (m.postback) {
        const pb = m.postback as Record<string, unknown>;
        out.push({
          type: 'postback',
          igUserId: recipientId,
          senderIgsid,
          recipientId,
          messageId: asString(pb.mid),
          postbackPayload: asString(pb.payload),
          isEcho: false,
          timestamp: ts,
          providerEventId: asString(pb.mid) ?? fallbackId('pb', [senderIgsid, asString(pb.payload), String(m.timestamp)]),
        });
        continue;
      }

      if (m.optin) {
        const op = m.optin as Record<string, unknown>;
        out.push({
          type: 'optin',
          igUserId: recipientId,
          senderIgsid,
          recipientId,
          postbackPayload: asString(op.payload) ?? asString(op.ref),
          isEcho: false,
          timestamp: ts,
          providerEventId: fallbackId('optin', [senderIgsid, asString(op.ref), String(m.timestamp)]),
        });
        continue;
      }

      if (m.read) {
        out.push({
          type: 'read',
          igUserId: recipientId,
          senderIgsid,
          recipientId,
          isEcho: false,
          timestamp: ts,
          providerEventId: fallbackId('read', [senderIgsid, String(m.timestamp)]),
        });
        continue;
      }

      out.push({ type: 'unknown', providerEventId: fallbackId('messaging', [senderIgsid, String(m.timestamp)]), igUserId: recipientId });
    }
  }

  return out;
}

/** payload ثابتی که روی دکمهٔ «انجام شد» می‌گذاریم تا Flow را ادامه دهیم */
export const CONTINUE_PAYLOAD_PREFIX = 'IGFLOW_CONTINUE';
export const RECHECK_PAYLOAD_PREFIX = 'IGFLOW_RECHECK';

export function buildContinuePayload(runId: string): string {
  return `${CONTINUE_PAYLOAD_PREFIX}:${runId}`;
}
export function buildRecheckPayload(runId: string): string {
  return `${RECHECK_PAYLOAD_PREFIX}:${runId}`;
}
export function parseFlowPayload(payload: string | undefined): { kind: 'continue' | 'recheck'; runId: string } | null {
  if (!payload) return null;
  const [prefix, runId] = payload.split(':');
  if (!runId) return null;
  if (prefix === CONTINUE_PAYLOAD_PREFIX) return { kind: 'continue', runId };
  if (prefix === RECHECK_PAYLOAD_PREFIX) return { kind: 'recheck', runId };
  return null;
}
