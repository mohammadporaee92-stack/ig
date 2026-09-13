/**
 * Keyword Engine — منطق خالص، بدون I/O.
 *
 * ویژگی‌ها:
 *  - Case insensitive (پیش‌فرض)
 *  - چند کلیدواژه برای یک Automation
 *  - حالت تطبیق: exact | contains (هم در سطح Automation، هم override در سطح Keyword)
 *  - نرمال‌سازی فارسی/عربی: ی/ك، اعداد فارسی/عربی، اعراب، ZWNJ، فاصله‌های تکراری
 *  - کلیدواژهٔ منفی (negative) → اگر حاضر باشد، اجرا لغو می‌شود
 */

export type MatchMode = 'contains' | 'exact';

export interface KeywordSpec {
  id: string;
  keyword: string;
  /** null ⇒ ارث‌بری از automation */
  matchMode?: MatchMode | null;
  isNegative?: boolean;
}

export interface KeywordMatchOptions {
  defaultMatchMode: MatchMode;
  caseSensitive: boolean;
}

export interface KeywordMatchResult {
  matched: boolean;
  keyword?: string;
  keywordId?: string;
  matchMode?: MatchMode;
  /** اگر به‌خاطر کلیدواژهٔ منفی رد شد */
  blockedBy?: string;
}

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const ZWNJ = /[\u200B-\u200F\u202A-\u202E\uFEFF]/g;

const DIGIT_MAP: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

const LETTER_MAP: Record<string, string> = {
  'ك': 'ک',
  'ي': 'ی',
  'ى': 'ی',
  'ﻯ': 'ی',
  'ة': 'ه',
  'أ': 'ا',
  'إ': 'ا',
  'آ': 'ا',
  'ٱ': 'ا',
  'ؤ': 'و',
  'ئ': 'ی',
};

/** نرمال‌سازی یکسان برای هم متن کامنت و هم کلیدواژه */
export function normalizeText(input: string, caseSensitive = false): string {
  let s = input ?? '';
  s = s.normalize('NFKC');
  s = s.replace(ZWNJ, ' ');
  s = s.replace(ARABIC_DIACRITICS, '');
  s = s.replace(/[۰-۹٠-٩]/g, (d) => DIGIT_MAP[d] ?? d);
  s = s.replace(/[كيىﻯةأإآٱؤئ]/g, (c) => LETTER_MAP[c] ?? c);
  if (!caseSensitive) s = s.toLowerCase();
  // یکنواخت‌سازی نشانه‌گذاری متداول
  s = s.replace(/[.,!?;:()[\]{}"'«»؛،؟\\/|]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** شکستن به توکن‌ها برای تطبیق exact کلمه‌به‌کلمه */
function tokenize(normalized: string): string[] {
  return normalized.length ? normalized.split(' ') : [];
}

function matchesOne(normComment: string, tokens: string[], normKeyword: string, mode: MatchMode): boolean {
  if (!normKeyword) return false;
  if (mode === 'exact') {
    // exact = کل متن دقیقاً کلیدواژه است، یا کلیدواژه به‌عنوان یک «کلمهٔ کامل» حاضر است
    if (normComment === normKeyword) return true;
    const kwTokens = tokenize(normKeyword);
    if (kwTokens.length === 1) return tokens.includes(normKeyword);
    // کلیدواژهٔ چندکلمه‌ای: دنبالهٔ کامل توکن‌ها
    for (let i = 0; i + kwTokens.length <= tokens.length; i++) {
      let ok = true;
      for (let j = 0; j < kwTokens.length; j++) {
        if (tokens[i + j] !== kwTokens[j]) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  }
  return normComment.includes(normKeyword);
}

export function matchKeywords(
  commentText: string,
  keywords: readonly KeywordSpec[],
  options: KeywordMatchOptions,
): KeywordMatchResult {
  const cs = options.caseSensitive;
  const normComment = normalizeText(commentText, cs);
  const tokens = tokenize(normComment);

  // ۱) کلیدواژه‌های منفی اولویت دارند
  for (const kw of keywords) {
    if (!kw.isNegative) continue;
    const mode = kw.matchMode ?? options.defaultMatchMode;
    if (matchesOne(normComment, tokens, normalizeText(kw.keyword, cs), mode)) {
      return { matched: false, blockedBy: kw.keyword };
    }
  }

  // ۲) تطبیق مثبت — طولانی‌ترین کلیدواژه اولویت دارد (خاص‌تر = دقیق‌تر)
  const positives = keywords
    .filter((k) => !k.isNegative)
    .slice()
    .sort((a, b) => normalizeText(b.keyword, cs).length - normalizeText(a.keyword, cs).length);

  for (const kw of positives) {
    const mode = kw.matchMode ?? options.defaultMatchMode;
    const norm = normalizeText(kw.keyword, cs);
    if (matchesOne(normComment, tokens, norm, mode)) {
      return { matched: true, keyword: kw.keyword, keywordId: kw.id, matchMode: mode };
    }
  }

  return { matched: false };
}
