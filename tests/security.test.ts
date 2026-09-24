import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  signState,
  verifyPassword,
  verifyState,
  verifyWebhookSignature,
} from '~/lib/crypto';
import { redact } from '~/lib/logger';
import { createHmac } from 'node:crypto';
import { createWorld, createAutomation, type TestWorld } from './helpers';
import { createRepositories } from '~/infra/db/repositories';
import { authenticate, registerUser } from '~/server/auth';

describe('Security', () => {
  describe('رمزنگاری توکن (Encrypt at rest)', () => {
    it('رفت و برگشت درست است', () => {
      const token = 'IGQVJXaccess_token_super_secret_value';
      const enc = encryptSecret(token);
      expect(enc).not.toContain(token);
      expect(enc.startsWith('v1.')).toBe(true);
      expect(decryptSecret(enc)).toBe(token);
    });

    it('هر بار ciphertext متفاوت است (IV تصادفی)', () => {
      expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
    });

    it('دستکاری ciphertext باعث خطا می‌شود (GCM auth tag)', () => {
      const enc = encryptSecret('secret-value');
      const parts = enc.split('.');
      const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${Buffer.from('evil').toString('base64')}`;
      expect(() => decryptSecret(tampered)).toThrow();
    });
  });

  describe('رمز عبور', () => {
    it('hash و verify کار می‌کند', () => {
      const h = hashPassword('Passw0rd!123');
      expect(h).not.toContain('Passw0rd');
      expect(verifyPassword('Passw0rd!123', h)).toBe(true);
      expect(verifyPassword('wrong', h)).toBe(false);
    });
    it('salt برای هر hash متفاوت است', () => {
      expect(hashPassword('same')).not.toBe(hashPassword('same'));
    });
  });

  describe('امضای Webhook', () => {
    const secret = 'test-app-secret';
    const body = JSON.stringify({ object: 'instagram', entry: [] });

    it('امضای معتبر پذیرفته می‌شود', () => {
      const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
      expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
    });
    it('امضای نامعتبر رد می‌شود', () => {
      expect(verifyWebhookSignature(body, 'sha256=deadbeef', secret)).toBe(false);
    });
    it('نبود هدر رد می‌شود', () => {
      expect(verifyWebhookSignature(body, null, secret)).toBe(false);
    });
    it('امضای بدنهٔ متفاوت رد می‌شود', () => {
      const sig = `sha256=${createHmac('sha256', secret).update('other body').digest('hex')}`;
      expect(verifyWebhookSignature(body, sig, secret)).toBe(false);
    });
  });

  describe('CSRF — state امضاشده در OAuth', () => {
    it('state معتبر تأیید می‌شود', () => {
      const s = signState({ uid: 'usr_1', purpose: 'ig_connect' });
      expect(verifyState<{ uid: string }>(s)?.uid).toBe('usr_1');
    });
    it('state دستکاری‌شده رد می‌شود', () => {
      const s = signState({ uid: 'usr_1' });
      const [b64] = s.split('.');
      const evil = Buffer.from(JSON.stringify({ uid: 'usr_ATTACKER', exp: 9e9 })).toString('base64url');
      expect(verifyState(`${evil}.${s.split('.')[1]}`)).toBeNull();
      expect(verifyState(`${b64}.badsignature`)).toBeNull();
    });
    it('state منقضی رد می‌شود', () => {
      expect(verifyState(signState({ uid: 'x' }, -10))).toBeNull();
    });
  });

  describe('عدم افشای توکن در لاگ', () => {
    it('کلیدهای حساس redact می‌شوند', () => {
      const out = redact({
        access_token: 'IGQVJsecret',
        password: 'hunter2',
        nested: { client_secret: 'abc', safe: 'visible' },
      }) as Record<string, unknown>;
      expect(out.access_token).toBe('[REDACTED]');
      expect(out.password).toBe('[REDACTED]');
      expect((out.nested as Record<string, unknown>).client_secret).toBe('[REDACTED]');
      expect((out.nested as Record<string, unknown>).safe).toBe('visible');
    });
    it('الگوی توکن داخل رشته هم redact می‌شود', () => {
      const out = redact('خطا برای توکن IGQVJWabcdefghijklmnopqrstuvwxyz123 رخ داد') as string;
      expect(out).not.toContain('IGQVJWabcdefghijklmnopqrstuvwxyz123');
      expect(out).toContain('[REDACTED]');
    });
    it('کلید API زرنيو داخل رشته هم redact می‌شود', () => {
      const key = `sk_${'a'.repeat(64)}`;
      expect(redact(`Authorization: Bearer ${key}`)).toBe('Authorization: Bearer [REDACTED]');
    });
  });

  describe('SQL Injection', () => {
    let world: TestWorld;
    beforeEach(async () => { world = await createWorld(); });
    afterEach(async () => { await world.close(); });

    it('ورودی مخرب به‌عنوان داده تلقی می‌شود نه SQL', async () => {
      const repos = createRepositories(world.db);
      const evil = "'; DROP TABLE users; --";
      const a = await createAutomation(world, { name: evil, keywords: [evil] });
      const found = await repos.automations.findById(world.userId, a.id);
      expect(found?.name).toBe(evil);
      // جدول users هنوز سالم است
      const users = await world.db.query('SELECT count(*)::int AS c FROM users');
      expect((users.rows[0] as { c: number }).c).toBe(1);
    });

    it('ایمیل مخرب در جست‌وجو بی‌اثر است', async () => {
      const repos = createRepositories(world.db);
      const res = await repos.users.findByEmail("' OR '1'='1");
      expect(res).toBeNull();
    });
  });

  describe('Tenant Isolation', () => {
    let world: TestWorld;
    beforeEach(async () => { world = await createWorld(); });
    afterEach(async () => { await world.close(); });

    it('کاربر B نمی‌تواند اتوماسیون کاربر A را بخواند یا تغییر دهد', async () => {
      const repos = createRepositories(world.db);
      const automationA = await createAutomation(world);

      const userB = await repos.users.create({ email: 'b@example.com', passwordHash: hashPassword('Passw0rd!123') });

      expect(await repos.automations.findById(userB.id, automationA.id)).toBeNull();
      expect(await repos.automations.update(userB.id, automationA.id, { name: 'HACKED' })).toBeNull();
      expect(await repos.automations.delete(userB.id, automationA.id)).toBe(false);

      // هنوز سالم است
      const still = await repos.automations.findById(world.userId, automationA.id);
      expect(still?.name).toBe('Free ChatGPT Course');
    });

    it('لیست اتوماسیون‌ها بین tenantها نشت نمی‌کند', async () => {
      const repos = createRepositories(world.db);
      await createAutomation(world, { name: 'A-1' });
      const userB = await repos.users.create({ email: 'b2@example.com', passwordHash: hashPassword('x') });
      expect((await repos.automations.listByUser(userB.id)).length).toBe(0);
      expect((await repos.automations.listByUser(world.userId)).length).toBe(1);
    });

    it('حساب اینستاگرام کاربر A برای کاربر B قابل دسترسی نیست', async () => {
      const repos = createRepositories(world.db);
      const userB = await repos.users.create({ email: 'b3@example.com', passwordHash: hashPassword('x') });
      expect(await repos.accounts.findById(userB.id, world.accountId)).toBeNull();
      expect(await repos.accounts.getPrimary(userB.id)).toBeNull();
    });

    it('Runها بین tenantها جدا هستند', async () => {
      const repos = createRepositories(world.db);
      const a = await createAutomation(world);
      await repos.runs.createIfAbsent({
        userId: world.userId, instagramAccountId: world.accountId, automationId: a.id,
        commentId: 'c_iso', mediaId: 'm1', igsid: 'u1',
      });
      const userB = await repos.users.create({ email: 'b4@example.com', passwordHash: hashPassword('x') });
      expect((await repos.runs.listByUser(userB.id)).length).toBe(0);
      expect((await repos.runs.listByUser(world.userId)).length).toBe(1);
    });
  });

  describe('احراز هویت', () => {
    let world: TestWorld;
    beforeEach(async () => { world = await createWorld(); });
    afterEach(async () => { await world.close(); });

    it('ایمیل تکراری رد می‌شود', async () => {
      const repos = createRepositories(world.db);
      const r = await registerUser(repos, { email: 'OWNER@example.com', password: 'Passw0rd!123' });
      expect(r.ok).toBe(false);
    });
    it('رمز اشتباه با پیام عمومی رد می‌شود', async () => {
      const repos = createRepositories(world.db);
      const r = await authenticate(repos, 'owner@example.com', 'wrong-password');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).not.toContain('وجود ندارد');
    });
    it('کاربر ناموجود همان پیام عمومی را می‌گیرد', async () => {
      const repos = createRepositories(world.db);
      const r1 = await authenticate(repos, 'nobody@example.com', 'x');
      const r2 = await authenticate(repos, 'owner@example.com', 'x');
      expect(r1.ok).toBe(false);
      expect(r2.ok).toBe(false);
      if (!r1.ok && !r2.ok) expect(r1.error).toBe(r2.error);
    });
  });
});
