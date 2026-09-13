'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  Input, Label, Select, Switch,
} from '~/components/ui';
import { cn } from '~/lib/utils';
import { apiPost, apiPut } from '~/lib/api-client';
import { MessageEditor } from './message-editor';
import { FlowPreview } from './flow-preview';
import { WIZARD_STEPS, defaultDraft, type AutomationDraft } from './types';

export interface AccountOption { id: string; username: string }

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** اعتبارسنجی هر مرحله — همان قواعدی که سرور هم اعمال می‌کند */
function validateStep(step: number, d: AutomationDraft): string[] {
  const errs: string[] = [];
  if (step === 1) {
    if (!d.name.trim()) errs.push('نام اتوماسیون الزامی است');
    if (!d.instagramAccountId) errs.push('حساب اینستاگرام را انتخاب کنید');
  }
  if (step === 3) {
    if (d.keywords.length === 0) errs.push('حداقل یک کلیدواژه اضافه کنید');
  }
  if (step === 5) {
    if (d.publicReplyEnabled && !d.messages.publicReply.body.trim()) errs.push('متن پاسخ عمومی خالی است');
    if (d.privateReplyEnabled) {
      if (!d.messages.privateReply.body.trim()) errs.push('متن پیام خصوصی خالی است');
      if (byteLength(d.messages.privateReply.body) > 1000) errs.push('پیام خصوصی بیش از ۱۰۰۰ بایت است');
      if (d.messages.privateReply.quickReplies.filter((q) => q.title.trim()).length === 0) {
        errs.push('حداقل یک دکمهٔ سریع لازم است تا کاربر بتواند پاسخ دهد و «رضایت» ثبت شود');
      }
    }
    if (!d.messages.main.body.trim() && d.messages.main.attachments.length === 0) {
      errs.push('محتوای اصلی نمی‌تواند خالی باشد');
    }
    if (byteLength(d.messages.main.body) > 1000) errs.push('پیام اصلی بیش از ۱۰۰۰ بایت است');
    if (d.followGateEnabled && !d.messages.followGate.body.trim()) errs.push('متن پیام Follow Gate خالی است');
  }
  return errs;
}

export function AutomationWizard({
  accounts,
  initial,
  automationId,
}: {
  accounts: AccountOption[];
  initial?: AutomationDraft;
  automationId?: string;
}) {
  const router = useRouter();
  const isEdit = Boolean(automationId);
  const [draft, setDraft] = useState<AutomationDraft>(
    () => initial ?? defaultDraft(accounts[0]?.id ?? ''),
  );
  const [step, setStep] = useState(isEdit ? 6 : 1);
  const [keywordInput, setKeywordInput] = useState('');
  const [negativeInput, setNegativeInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const set = <K extends keyof AutomationDraft>(key: K, value: AutomationDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const setMsg = (key: keyof AutomationDraft['messages'], value: AutomationDraft['messages'][typeof key]) =>
    setDraft((d) => ({ ...d, messages: { ...d.messages, [key]: value } }));

  const errors = useMemo(() => validateStep(step, draft), [step, draft]);
  const allErrors = useMemo(() => [1, 3, 5].flatMap((s) => validateStep(s, draft)), [draft]);

  function addKeyword(raw: string, negative = false) {
    const parts = raw.split(/[,،\n]/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const key = negative ? 'negativeKeywords' : 'keywords';
    const current = draft[key];
    const merged = Array.from(new Set([...current, ...parts])).slice(0, 50);
    set(key, merged);
    if (negative) setNegativeInput(''); else setKeywordInput('');
  }

  async function save(activate: boolean) {
    setSaving(true);
    setServerError(null);
    const payload = { ...draft, status: activate ? 'active' : draft.status === 'active' ? 'active' : 'draft' };
    const res = isEdit
      ? await apiPut<{ id?: string }>(`/api/automations/${automationId}`, payload)
      : await apiPost<{ id?: string }>('/api/automations', payload);
    setSaving(false);
    if (!res.ok) {
      setServerError(res.error);
      return;
    }
    router.push(isEdit ? `/automations/${automationId}` : `/automations/${res.data.id}`);
    router.refresh();
  }

  if (accounts.length === 0) {
    return (
      <Alert variant="warning">
        برای ساخت اتوماسیون ابتدا باید حساب اینستاگرام خود را متصل کنید.{' '}
        <Link href="/instagram" className="font-medium underline">اتصال اینستاگرام</Link>
      </Alert>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-5">
        {/* Stepper */}
        <div className="overflow-x-auto">
          <div className="flex min-w-max items-center gap-1">
            {WIZARD_STEPS.map((s, i) => {
              const done = s.id < step;
              const active = s.id === step;
              return (
                <div key={s.id} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setStep(s.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                      active ? 'bg-brand-600 text-white' : done ? 'text-emerald-700 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-50',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                        active ? 'bg-white/20' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100',
                      )}
                    >
                      {done ? '✓' : s.id}
                    </span>
                    <span className="whitespace-nowrap font-medium">{s.title}</span>
                  </button>
                  {i < WIZARD_STEPS.length - 1 ? <span className="px-0.5 text-slate-200">—</span> : null}
                </div>
              );
            })}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              گام {step}: {WIZARD_STEPS[step - 1]?.title}
            </CardTitle>
            <CardDescription>{WIZARD_STEPS[step - 1]?.subtitle}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            {/* ───── گام ۱: نام ───── */}
            {step === 1 ? (
              <>
                <div>
                  <Label htmlFor="name">نام اتوماسیون</Label>
                  <Input
                    id="name"
                    value={draft.name}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder="مثلاً: ارسال فایل PDF دورهٔ رایگان"
                    maxLength={120}
                  />
                  <p className="mt-1 text-xs text-slate-400">فقط برای شناسایی خودتان است و به کاربر نمایش داده نمی‌شود.</p>
                </div>
                <div>
                  <Label htmlFor="account">حساب اینستاگرام</Label>
                  <Select id="account" value={draft.instagramAccountId} onChange={(e) => set('instagramAccountId', e.target.value)}>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>@{a.username}</option>
                    ))}
                  </Select>
                </div>
              </>
            ) : null}

            {/* ───── گام ۲: تریگر ───── */}
            {step === 2 ? (
              <>
                <div className="rounded-xl border-2 border-brand-200 bg-brand-50 p-4">
                  <div className="flex items-center gap-2">
                    <span>💬</span>
                    <span className="font-semibold text-slate-800">کامنت روی پست اینستاگرام</span>
                    <Badge variant="success">فعال</Badge>
                  </div>
                  <p className="mt-2 text-xs leading-6 text-slate-600">
                    وقتی کاربری زیر پست/ریلز شما کامنت بگذارد، اینستاگرام رویداد <code dir="ltr">comments</code> را
                    به Webhook ما ارسال می‌کند. این تنها تریگر رسمی پشتیبانی‌شده برای این جریان است.
                  </p>
                </div>

                <div className="rounded-xl border border-dashed border-slate-300 p-4 opacity-60">
                  <div className="flex items-center gap-2">
                    <span>📖</span>
                    <span className="font-semibold text-slate-700">پاسخ به استوری / منشن</span>
                    <Badge variant="muted">به‌زودی</Badge>
                  </div>
                </div>

                <div>
                  <Label>محدودهٔ پست‌ها</Label>
                  <Select value={draft.targetScope} onChange={(e) => set('targetScope', e.target.value as AutomationDraft['targetScope'])}>
                    <option value="all_posts">همهٔ پست‌ها</option>
                    <option value="specific_posts">فقط پست‌های مشخص</option>
                  </Select>
                </div>

                {draft.targetScope === 'specific_posts' ? (
                  <div>
                    <Label>شناسهٔ رسانه (Media ID) — با کاما جدا کنید</Label>
                    <Input
                      dir="ltr"
                      value={draft.targetMediaIds.join(',')}
                      onChange={(e) => set('targetMediaIds', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                      placeholder="17912345678901234, 17998765432109876"
                    />
                    <p className="mt-1 text-xs text-slate-400">اگر خالی بماند، همهٔ پست‌ها در نظر گرفته می‌شوند.</p>
                  </div>
                ) : null}
              </>
            ) : null}

            {/* ───── گام ۳: کلیدواژه‌ها ───── */}
            {step === 3 ? (
              <>
                <div>
                  <Label>کلیدواژه‌ها</Label>
                  <div className="flex gap-2">
                    <Input
                      value={keywordInput}
                      onChange={(e) => setKeywordInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); addKeyword(keywordInput); }
                      }}
                      placeholder="مثلاً: لینک، link، بفرست"
                    />
                    <Button type="button" variant="secondary" onClick={() => addKeyword(keywordInput)}>افزودن</Button>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">با Enter یا کاما جدا کنید. حداکثر ۵۰ کلیدواژه.</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {draft.keywords.map((k) => (
                      <span key={k} className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-xs text-brand-700">
                        {k}
                        <button type="button" onClick={() => set('keywords', draft.keywords.filter((x) => x !== k))} className="text-brand-400 hover:text-brand-700">✕</button>
                      </span>
                    ))}
                    {draft.keywords.length === 0 ? <span className="text-xs text-slate-400">هنوز کلیدواژه‌ای اضافه نشده</span> : null}
                  </div>
                </div>

                <div>
                  <Label>کلیدواژه‌های منفی (اختیاری)</Label>
                  <div className="flex gap-2">
                    <Input
                      value={negativeInput}
                      onChange={(e) => setNegativeInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); addKeyword(negativeInput, true); }
                      }}
                      placeholder="اگر کامنت شامل این کلمات بود، نادیده بگیر"
                    />
                    <Button type="button" variant="secondary" onClick={() => addKeyword(negativeInput, true)}>افزودن</Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {draft.negativeKeywords.map((k) => (
                      <span key={k} className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">
                        {k}
                        <button type="button" onClick={() => set('negativeKeywords', draft.negativeKeywords.filter((x) => x !== k))} className="text-red-400 hover:text-red-700">✕</button>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 rounded-lg bg-slate-50 p-4">
                  <div>
                    <Label>حالت تطابق</Label>
                    <Select value={draft.matchMode} onChange={(e) => set('matchMode', e.target.value as AutomationDraft['matchMode'])}>
                      <option value="contains">شامل بودن (Contains) — کلیدواژه جایی داخل کامنت باشد</option>
                      <option value="exact">تطابق دقیق (Exact) — کل کامنت دقیقاً همان کلیدواژه باشد</option>
                    </Select>
                  </div>
                  <ToggleRow
                    label="حساس به بزرگی/کوچکی حروف"
                    hint="در حالت پیش‌فرض «LINK» و «link» یکسان در نظر گرفته می‌شوند."
                    checked={draft.caseSensitive}
                    onChange={(v) => set('caseSensitive', v)}
                  />
                  <ToggleRow
                    label="فقط یک بار برای هر کاربر در هر پست"
                    hint="از ارسال چندبارهٔ پیام به کسی که چند کامنت گذاشته جلوگیری می‌کند."
                    checked={draft.oncePerUserPerPost}
                    onChange={(v) => set('oncePerUserPerPost', v)}
                  />
                </div>
              </>
            ) : null}

            {/* ───── گام ۴: Follow Gate ───── */}
            {step === 4 ? (
              <>
                <ToggleRow
                  label="فعال‌سازی Follow Gate"
                  hint="محتوای اصلی فقط برای کسانی ارسال شود که پیج شما را فالو کرده‌اند."
                  checked={draft.followGateEnabled}
                  onChange={(v) => set('followGateEnabled', v)}
                />

                <Alert variant="info">
                  <strong>این قابلیت رسمی است، اما یک شرط دارد.</strong>
                  <p className="mt-1 leading-7">
                    اینستاگرام فیلد <code dir="ltr">is_user_follow_business</code> را در User Profile API ارائه می‌دهد،
                    ولی فقط زمانی که کاربر <strong>رضایت</strong> داده باشد. طبق مستندات رسمی، رضایت فقط با
                    «ارسال پیام توسط کاربر» یا «لمس دکمهٔ Quick Reply / Icebreaker / Persistent Menu» ایجاد می‌شود.
                    صرفِ کامنت گذاشتن کافی نیست.
                    <br />
                    به همین دلیل بررسی فالو <strong>بعد از</strong> لمس دکمه در دایرکت انجام می‌شود، نه در لحظهٔ کامنت.
                    هیچ روش غیررسمی برای دور زدن این محدودیت استفاده نشده است.
                  </p>
                </Alert>

                {draft.followGateEnabled ? (
                  <>
                    <div>
                      <Label>روش بررسی فالو</Label>
                      <Select value={draft.followChecker} onChange={(e) => set('followChecker', e.target.value as AutomationDraft['followChecker'])}>
                        <option value="messaging_profile">Messaging Profile API (رسمی · پیشنهادی)</option>
                        <option value="unsupported">غیرفعال / پشتیبانی‌نشده (همیشه نامشخص)</option>
                      </Select>
                    </div>
                    <div>
                      <Label>اگر وضعیت فالو نامشخص ماند چه کنیم؟</Label>
                      <Select value={draft.followUnknownPolicy} onChange={(e) => set('followUnknownPolicy', e.target.value as AutomationDraft['followUnknownPolicy'])}>
                        <option value="deliver">محتوا را ارسال کن (کاربرپسندترین)</option>
                        <option value="gate">پیام درخواست فالو را نشان بده (سخت‌گیرانه)</option>
                        <option value="fail">اجرا را ناموفق علامت بزن (فقط برای دیباگ)</option>
                      </Select>
                    </div>
                    <div>
                      <Label>حداکثر دفعات «بررسی مجدد»</Label>
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        value={draft.followRecheckLimit}
                        onChange={(e) => set('followRecheckLimit', Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
                      />
                      <p className="mt-1 text-xs text-slate-400">برای جلوگیری از حلقهٔ بی‌پایان و مصرف بی‌مورد سهمیهٔ API.</p>
                    </div>
                  </>
                ) : (
                  <p className="rounded-lg bg-slate-50 p-4 text-sm leading-7 text-slate-600">
                    Follow Gate خاموش است: محتوای اصلی بلافاصله پس از پاسخ کاربر ارسال می‌شود و
                    <strong> هیچ درخواستی </strong> به Profile API زده نمی‌شود.
                  </p>
                )}
              </>
            ) : null}

            {/* ───── گام ۵: پیام‌ها ───── */}
            {step === 5 ? (
              <>
                <ToggleRow
                  label="پاسخ عمومی زیر کامنت"
                  hint="یک پاسخ کوتاه و عمومی زیر کامنت کاربر ثبت می‌شود (باعث دیده‌شدن بیشتر پست)."
                  checked={draft.publicReplyEnabled}
                  onChange={(v) => set('publicReplyEnabled', v)}
                />
                {draft.publicReplyEnabled ? (
                  <MessageEditor
                    label="متن پاسخ عمومی"
                    value={draft.messages.publicReply}
                    onChange={(v) => setMsg('publicReply', v)}
                    maxBytes={2200}
                    help="زیر کامنت کاربر منتشر می‌شود. کوتاه و طبیعی بنویسید."
                  />
                ) : null}

                <ToggleRow
                  label="پیام خصوصی (Private Reply)"
                  hint="پاسخ خصوصی به کامنت — تنها راه رسمی برای شروع گفتگوی دایرکت با کسی که به شما پیام نداده."
                  checked={draft.privateReplyEnabled}
                  onChange={(v) => set('privateReplyEnabled', v)}
                />
                {draft.privateReplyEnabled ? (
                  <MessageEditor
                    label="متن پیام خصوصی"
                    value={draft.messages.privateReply}
                    onChange={(v) => setMsg('privateReply', v)}
                    allowQuickReplies
                    help="فقط ۱ بار برای هر کامنت و حداکثر تا ۷ روز پس از ثبت کامنت قابل ارسال است."
                  />
                ) : (
                  <Alert variant="warning">
                    بدون پیام خصوصی، امکان ثبت رضایت کاربر و در نتیجه بررسی فالو یا ارسال محتوای اصلی در دایرکت
                    وجود نخواهد داشت.
                  </Alert>
                )}

                {draft.followGateEnabled ? (
                  <MessageEditor
                    label="پیام درخواست فالو (Follow Gate)"
                    value={draft.messages.followGate}
                    onChange={(v) => setMsg('followGate', v)}
                    allowQuickReplies
                    help="وقتی کاربر هنوز فالو نکرده نمایش داده می‌شود. حتماً یک دکمهٔ «بررسی مجدد» بگذارید."
                  />
                ) : null}

                <MessageEditor
                  label="محتوای اصلی 🎁"
                  value={draft.messages.main}
                  onChange={(v) => setMsg('main', v)}
                  allowAttachments
                  allowQuickReplies
                  help="پیام نهایی که کاربر منتظرش است. داخل پنجرهٔ ۲۴ ساعته ارسال می‌شود."
                />

                <div className="space-y-2 rounded-lg bg-slate-50 p-4">
                  <Label htmlFor="linkUrl">لینک شما (متغیر {'{{link}}'})</Label>
                  <Input
                    id="linkUrl"
                    dir="ltr"
                    placeholder="https://example.com/my-course"
                    value={draft.linkUrl}
                    onChange={(e) => set('linkUrl', e.target.value)}
                  />
                  <p className="text-xs leading-6 text-slate-500">
                    هر جا در پیام‌ها از {'{{link}}'} استفاده کنید، با این آدرس جایگزین می‌شود.
                    اگر خالی بماند، {'{{link}}'} به رشتهٔ خالی تبدیل می‌شود.
                  </p>
                </div>

                <div className="space-y-3 rounded-lg bg-slate-50 p-4">
                  <ToggleRow
                    label="اعلام خودکار بودن پاسخ (Bot Disclosure)"
                    hint="سیاست پلتفرم Meta شفافیت را الزامی می‌کند. پیشنهاد می‌شود روشن بماند."
                    checked={draft.botDisclosureEnabled}
                    onChange={(v) => set('botDisclosureEnabled', v)}
                  />
                  {draft.botDisclosureEnabled ? (
                    <Input value={draft.botDisclosureText} onChange={(e) => set('botDisclosureText', e.target.value)} maxLength={200} />
                  ) : null}
                </div>
              </>
            ) : null}

            {/* ───── گام ۶: بازبینی ───── */}
            {step === 6 ? (
              <>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <Review label="نام" value={draft.name || '—'} />
                  <Review label="حساب" value={`@${accounts.find((a) => a.id === draft.instagramAccountId)?.username ?? '—'}`} />
                  <Review label="تریگر" value="کامنت روی پست" />
                  <Review label="محدوده" value={draft.targetScope === 'all_posts' ? 'همهٔ پست‌ها' : `${draft.targetMediaIds.length} پست مشخص`} />
                  <Review label="کلیدواژه‌ها" value={draft.keywords.join('، ') || '—'} />
                  <Review label="کلیدواژه‌های منفی" value={draft.negativeKeywords.join('، ') || '—'} />
                  <Review label="حالت تطابق" value={draft.matchMode === 'exact' ? 'دقیق' : 'شامل بودن'} />
                  <Review label="دفعات مجاز" value={draft.oncePerUserPerPost ? 'یک بار برای هر کاربر در هر پست' : 'بدون محدودیت'} />
                  <Review label="پاسخ عمومی" value={draft.publicReplyEnabled ? 'فعال' : 'غیرفعال'} />
                  <Review label="پیام خصوصی" value={draft.privateReplyEnabled ? 'فعال' : 'غیرفعال'} />
                  <Review label="Follow Gate" value={draft.followGateEnabled ? `فعال (${draft.followChecker})` : 'غیرفعال'} />
                  <Review label="سیاست وضعیت نامشخص" value={{ deliver: 'ارسال محتوا', gate: 'درخواست فالو', fail: 'ناموفق' }[draft.followUnknownPolicy]} />
                </dl>

                {allErrors.length ? (
                  <Alert variant="danger">
                    <strong>قبل از فعال‌سازی این موارد را اصلاح کنید:</strong>
                    <ul className="mt-1 list-inside list-disc">
                      {allErrors.map((e) => <li key={e}>{e}</li>)}
                    </ul>
                  </Alert>
                ) : (
                  <Alert variant="success">همه‌چیز آمادهٔ فعال‌سازی است ✅</Alert>
                )}
              </>
            ) : null}

            {/* ───── گام ۷: فعال‌سازی ───── */}
            {step === 7 ? (
              <div className="space-y-5 py-4 text-center">
                <div className="text-5xl">🚀</div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">آمادهٔ فعال‌سازی</h3>
                  <p className="mx-auto mt-2 max-w-lg text-sm leading-7 text-slate-500">
                    با فعال‌سازی، از همین لحظه کامنت‌های جدید رصد می‌شوند.
                    می‌توانید هر زمان اتوماسیون را غیرفعال کنید.
                  </p>
                </div>
                {allErrors.length ? (
                  <Alert variant="danger">
                    <ul className="list-inside list-disc text-right">
                      {allErrors.map((e) => <li key={e}>{e}</li>)}
                    </ul>
                  </Alert>
                ) : null}
                {serverError ? <Alert variant="danger">{serverError}</Alert> : null}
                <div className="flex flex-wrap justify-center gap-3">
                  <Button size="lg" disabled={saving || allErrors.length > 0} onClick={() => void save(true)}>
                    {saving ? 'در حال ذخیره…' : '✅ فعال‌سازی اتوماسیون'}
                  </Button>
                  <Button size="lg" variant="outline" disabled={saving} onClick={() => void save(false)}>
                    ذخیره به‌عنوان پیش‌نویس
                  </Button>
                </div>
              </div>
            ) : null}

            {errors.length && step !== 6 && step !== 7 ? (
              <Alert variant="warning">
                <ul className="list-inside list-disc">
                  {errors.map((e) => <li key={e}>{e}</li>)}
                </ul>
              </Alert>
            ) : null}
            {serverError && step !== 7 ? <Alert variant="danger">{serverError}</Alert> : null}
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" disabled={step === 1} onClick={() => setStep((s) => Math.max(1, s - 1))}>
            → مرحلهٔ قبل
          </Button>
          <div className="flex gap-2">
            {isEdit ? (
              <Button variant="secondary" disabled={saving || allErrors.length > 0} onClick={() => void save(false)}>
                {saving ? 'در حال ذخیره…' : 'ذخیرهٔ تغییرات'}
              </Button>
            ) : null}
            {step < 7 ? (
              <Button disabled={errors.length > 0} onClick={() => setStep((s) => Math.min(7, s + 1))}>
                مرحلهٔ بعد ←
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Live preview */}
      <div className="xl:sticky xl:top-6 xl:self-start">
        <FlowPreview draft={draft} />
      </div>
    </div>
  );
}

function ToggleRow({
  label, hint, checked, onChange,
}: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">{label}</p>
        {hint ? <p className="mt-0.5 text-xs leading-6 text-slate-500">{hint}</p> : null}
      </div>
      <div className="pt-1"><Switch checked={checked} onCheckedChange={onChange} aria-label={label} /></div>
    </div>
  );
}

function Review({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-slate-800">{value}</dd>
    </div>
  );
}
