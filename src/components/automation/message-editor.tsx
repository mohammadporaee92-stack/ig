'use client';

import { useRef } from 'react';
import { Badge, Button, Input, Label, Textarea } from '~/components/ui';
import type { MessageDraft, QuickReplyDraft } from './types';
import { VARIABLES } from './types';

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function MessageEditor({
  value,
  onChange,
  label,
  help,
  maxBytes = 1000,
  allowQuickReplies = false,
  allowAttachments = false,
  allowVariables = true,
  placeholder,
}: {
  value: MessageDraft;
  onChange: (v: MessageDraft) => void;
  label: string;
  help?: React.ReactNode;
  maxBytes?: number;
  allowQuickReplies?: boolean;
  allowAttachments?: boolean;
  allowVariables?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const bytes = byteLength(value.body);
  const over = bytes > maxBytes;

  function insert(token: string) {
    const el = ref.current;
    if (!el) { onChange({ ...value, body: value.body + token }); return; }
    const start = el.selectionStart ?? value.body.length;
    const end = el.selectionEnd ?? start;
    const next = value.body.slice(0, start) + token + value.body.slice(end);
    onChange({ ...value, body: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function setQr(i: number, patch: Partial<QuickReplyDraft>) {
    const next = value.quickReplies.map((q, idx) => (idx === i ? { ...q, ...patch } : q));
    onChange({ ...value, quickReplies: next });
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="mb-0">{label}</Label>
        <span className={`tabular text-xs ${over ? 'font-semibold text-red-600' : 'text-slate-400'}`}>
          {bytes} / {maxBytes} بایت
        </span>
      </div>

      {help ? <p className="text-xs leading-6 text-slate-500">{help}</p> : null}

      <Textarea
        ref={ref}
        rows={5}
        value={value.body}
        placeholder={placeholder}
        onChange={(e) => onChange({ ...value, body: e.target.value })}
        className={over ? 'border-red-300 focus-visible:ring-red-400' : undefined}
      />

      {over ? (
        <p className="text-xs text-red-600">
          ⚠️ اینستاگرام متن پیام را حداکثر {maxBytes} بایت می‌پذیرد. متن طولانی‌تر رد می‌شود.
        </p>
      ) : null}

      {allowVariables ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-500">متغیرها:</span>
          {VARIABLES.map((v) => (
            <button
              key={v.token}
              type="button"
              onClick={() => insert(v.token)}
              title={v.label}
              dir="ltr"
              className="rounded-md bg-brand-50 px-2 py-0.5 font-mono text-xs text-brand-700 transition-colors hover:bg-brand-100"
            >
              {v.token}
            </button>
          ))}
        </div>
      ) : null}

      {allowQuickReplies ? (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-slate-700">دکمه‌های سریع (Quick Replies)</span>
            <Badge variant="muted">حداکثر ۱۳ دکمه · عنوان ۲۰ کاراکتر</Badge>
          </div>
          <p className="text-xs leading-6 text-slate-500">
            این دکمه‌ها ضروری‌اند: تا کاربر یکی را لمس نکند، طبق قوانین رسمی Meta «رضایت» ثبت نمی‌شود و
            امکان بررسی فالو یا ارسال پیام دوم وجود ندارد.
          </p>
          {value.quickReplies.map((q, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={q.title}
                maxLength={20}
                placeholder="عنوان دکمه"
                onChange={(e) => setQr(i, { title: e.target.value })}
              />
              <span className="tabular w-10 shrink-0 text-xs text-slate-400">{q.title.length}/20</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange({ ...value, quickReplies: value.quickReplies.filter((_, idx) => idx !== i) })}
              >
                ✕
              </Button>
            </div>
          ))}
          {value.quickReplies.length < 13 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange({ ...value, quickReplies: [...value.quickReplies, { title: '' }] })}
            >
              + افزودن دکمه
            </Button>
          ) : null}
        </div>
      ) : null}

      {allowAttachments ? (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-slate-700">پیوست (Attachment)</span>
            <Badge variant="muted">تصویر ≤۸MB · ویدیو/صوت/PDF ≤۲۵MB</Badge>
          </div>
          <p className="text-xs leading-6 text-slate-500">
            فایل باید روی یک URL عمومی و قابل دسترس میزبانی شده باشد؛ اینستاگرام خودش آن را دریافت می‌کند.
            فرمت <code dir="ltr">file</code> فقط PDF را می‌پذیرد.
          </p>
          {value.attachments.map((a, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select
                value={a.type}
                onChange={(e) => {
                  const next = [...value.attachments];
                  next[i] = { ...a, type: e.target.value as typeof a.type };
                  onChange({ ...value, attachments: next });
                }}
                className="h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm"
              >
                <option value="image">تصویر</option>
                <option value="video">ویدیو</option>
                <option value="audio">صوت</option>
                <option value="file">PDF</option>
              </select>
              <Input
                dir="ltr"
                className="flex-1"
                value={a.url}
                placeholder="https://cdn.example.com/file.pdf"
                onChange={(e) => {
                  const next = [...value.attachments];
                  next[i] = { ...a, url: e.target.value };
                  onChange({ ...value, attachments: next });
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange({ ...value, attachments: value.attachments.filter((_, idx) => idx !== i) })}
              >
                ✕
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange({ ...value, attachments: [...value.attachments, { type: 'image', url: '' }] })}
          >
            + افزودن پیوست
          </Button>
        </div>
      ) : null}
    </div>
  );
}
