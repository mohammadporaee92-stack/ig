import { describe, expect, it } from 'vitest';
import { matchKeywords, normalizeText } from '~/domain/keyword/engine';

const opts = { defaultMatchMode: 'contains' as const, caseSensitive: false };
const kws = (...list: string[]) => list.map((k, i) => ({ id: `k${i}`, keyword: k }));

describe('Keyword Engine', () => {
  describe('normalizeText', () => {
    it('حروف عربی را به فارسی نرمال می‌کند', () => {
      expect(normalizeText('كتاب يا')).toBe('کتاب یا');
    });
    it('اعداد فارسی/عربی را به لاتین تبدیل می‌کند', () => {
      expect(normalizeText('کد ۱۲۳')).toBe('کد 123');
    });
    it('اعراب و نشانه‌گذاری را حذف می‌کند', () => {
      expect(normalizeText('سَلام! (خوبی؟)')).toBe('سلام خوبی');
    });
  });

  describe('Exact match', () => {
    it('کلمهٔ کامل را تطبیق می‌دهد', () => {
      const r = matchKeywords('AI', kws('AI'), { ...opts, defaultMatchMode: 'exact' });
      expect(r.matched).toBe(true);
      expect(r.keyword).toBe('AI');
    });
    it('کلمهٔ کامل داخل جمله را تطبیق می‌دهد', () => {
      const r = matchKeywords('لطفا AI رو بفرست', kws('AI'), { ...opts, defaultMatchMode: 'exact' });
      expect(r.matched).toBe(true);
    });
    it('زیررشته را در حالت exact تطبیق نمی‌دهد', () => {
      const r = matchKeywords('AIRPLANE', kws('AI'), { ...opts, defaultMatchMode: 'exact' });
      expect(r.matched).toBe(false);
    });
    it('کلیدواژهٔ چندکلمه‌ای exact', () => {
      const r = matchKeywords('میخوام free course بگیرم', kws('free course'), { ...opts, defaultMatchMode: 'exact' });
      expect(r.matched).toBe(true);
    });
  });

  describe('Case insensitive', () => {
    it('حروف بزرگ و کوچک فرقی ندارند', () => {
      expect(matchKeywords('chatgpt', kws('CHATGPT'), opts).matched).toBe(true);
      expect(matchKeywords('ChatGPT', kws('chatgpt'), opts).matched).toBe(true);
      expect(matchKeywords('CHATGPT', kws('ChatGpt'), opts).matched).toBe(true);
    });
    it('در حالت caseSensitive تفاوت دارد', () => {
      const r = matchKeywords('chatgpt', kws('CHATGPT'), { ...opts, caseSensitive: true });
      expect(r.matched).toBe(false);
    });
  });

  describe('Partial / contains match', () => {
    it('مثال اصلی صورت‌مسئله: «لطفاً CHATGPT رو بفرست»', () => {
      const r = matchKeywords('لطفاً CHATGPT رو بفرست', kws('CHATGPT'), opts);
      expect(r.matched).toBe(true);
      expect(r.keyword).toBe('CHATGPT');
    });
    it('کلیدواژهٔ فارسی', () => {
      expect(matchKeywords('سلام، آموزش رو میخوام', kws('آموزش'), opts).matched).toBe(true);
      expect(matchKeywords('فايل رو بفرست', kws('فایل'), opts).matched).toBe(true);
    });
  });

  describe('Multiple keywords', () => {
    it('هر کدام از چند کلیدواژه را تطبیق می‌دهد', () => {
      const list = kws('CHATGPT', 'AI', 'PDF', 'COURSE', 'PROMPT', 'آموزش', 'فایل');
      expect(matchKeywords('PDF لطفا', list, opts).keyword).toBe('PDF');
      expect(matchKeywords('برام prompt بفرست', list, opts).keyword).toBe('PROMPT');
      expect(matchKeywords('فایل میخوام', list, opts).keyword).toBe('فایل');
    });
    it('طولانی‌ترین (خاص‌ترین) کلیدواژه اولویت دارد', () => {
      const list = kws('AI', 'AI COURSE');
      expect(matchKeywords('من AI COURSE میخوام', list, opts).keyword).toBe('AI COURSE');
    });
  });

  describe('Negative keywords', () => {
    it('کلیدواژهٔ منفی اجرا را متوقف می‌کند', () => {
      const list = [
        { id: 'a', keyword: 'AI' },
        { id: 'b', keyword: 'رایگان نیست', isNegative: true },
      ];
      const r = matchKeywords('AI رایگان نیست؟', list, opts);
      expect(r.matched).toBe(false);
      expect(r.blockedBy).toBe('رایگان نیست');
    });
  });

  describe('No match', () => {
    it('متن بی‌ربط تطبیق نمی‌یابد', () => {
      expect(matchKeywords('چه پست قشنگی', kws('CHATGPT'), opts).matched).toBe(false);
    });
    it('متن خالی', () => {
      expect(matchKeywords('', kws('CHATGPT'), opts).matched).toBe(false);
    });
  });
});
