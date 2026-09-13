export const dynamic = 'force-dynamic';

/**
 * صفحهٔ وضعیت حذف داده.
 *
 * پاسخ `/api/instagram/data-deletion` به این آدرس لینک می‌دهد. Meta هنگام
 * App Review این لینک را باز می‌کند و انتظار دارد صفحه‌ای واقعی و مرتبط
 * ببیند — نه ۴۰۴. این یکی از دلایل رایج رد شدن بررسی است.
 */
export default async function DataDeletionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const code = params.code;

  return (
    <main
      dir="rtl"
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 640,
        margin: '0 auto',
        padding: '48px 24px',
        lineHeight: 2,
        color: '#0f172a',
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>حذف داده‌های شما</h1>

      {code ? (
        <>
          <div
            style={{
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              borderRadius: 12,
              padding: 16,
              marginTop: 16,
            }}
          >
            <p style={{ margin: 0, fontWeight: 600, color: '#065f46' }}>
              ✅ درخواست حذف داده دریافت و اجرا شد.
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 14 }}>
              کد پیگیری:{' '}
              <code style={{ background: '#fff', padding: '2px 8px', borderRadius: 6, direction: 'ltr', display: 'inline-block' }}>
                {code}
              </code>
            </p>
          </div>

          <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 32 }}>چه چیزی حذف شد</h2>
          <ul style={{ paddingRight: 20 }}>
            <li>توکن‌های دسترسی اینستاگرام</li>
            <li>اطلاعات حساب اینستاگرام متصل‌شده</li>
            <li>اتوماسیون‌ها، کلیدواژه‌ها و قالب‌های پیام</li>
            <li>سوابق اجرا، رویدادها و گزارش پیام‌ها</li>
            <li>اطلاعات کاربران اینستاگرام، پست‌ها و کامنت‌های ذخیره‌شده</li>
          </ul>

          <p style={{ fontSize: 14, color: '#475569' }}>
            حذف بلافاصله و به‌صورت دائمی انجام شده است. تنها چیزی که باقی می‌ماند، یک رکورد ممیزی
            بدون داده‌های شخصی است که صرفاً زمان انجام حذف را ثبت می‌کند.
          </p>
        </>
      ) : (
        <>
          <p>
            برای حذف داده‌های خود می‌توانید از یکی از این دو راه استفاده کنید:
          </p>

          <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>۱. از داخل اینستاگرام</h2>
          <p style={{ fontSize: 15 }}>
            تنظیمات اینستاگرام ← «Apps and Websites» ← این اپ را حذف کنید. با این کار به‌صورت
            خودکار به ما اطلاع داده می‌شود و داده‌های مرتبط پاک می‌شوند.
          </p>

          <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>۲. از داخل حساب کاربری</h2>
          <p style={{ fontSize: 15 }}>
            وارد شوید و در صفحهٔ «تنظیمات ← اینستاگرام» گزینهٔ «قطع اتصال» را بزنید.
          </p>

          <p style={{ fontSize: 14, color: '#475569', marginTop: 24 }}>
            اگر به هیچ‌کدام دسترسی ندارید، با پشتیبانی تماس بگیرید. درخواست‌ها حداکثر ظرف
            ۳۰ روز رسیدگی می‌شوند.
          </p>
        </>
      )}
    </main>
  );
}
