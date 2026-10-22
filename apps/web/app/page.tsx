import Link from 'next/link';
export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16 sm:py-24">
      <p className="text-xs tracking-[0.3em] text-stone-500">
        KINO STUDIO / PHOTOGRAPHY WORKSPACE
      </p>
      <h1 className="mt-8 text-5xl font-semibold tracking-tight">KINO Pic</h1>
      <p className="mt-6 text-xl">讓每一次挑選，都成為作品的一部分</p>
      <section
        className="mt-12 rounded-xl border border-stone-200 bg-white p-8"
        aria-labelledby="status"
      >
        <h2 id="status" className="text-lg font-semibold">
          工作空間與專案 · Phase 1 開發中
        </h2>
        <p className="mt-3 leading-7 text-stone-600">
          目前提供本機應用與健康檢查。Google
          登入、工作空間與專案相簿管理已進入本機整合驗證，照片上傳及客戶挑片尚未開放。
        </p>
        <p className="mt-3 text-sm text-stone-600">
          自動刪除關閉 · 雲端儲存尚未開放
        </p>
        <Link
          href="/login"
          className="mt-6 mr-4 inline-block rounded-md bg-stone-900 px-4 py-2 text-white"
        >
          攝影師入口
        </Link>
        <a
          href="/api/health"
          className="mt-6 inline-block rounded-md bg-stone-900 px-4 py-2 text-white focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          查看應用健康狀態
        </a>
      </section>
    </main>
  );
}
