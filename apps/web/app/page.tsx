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
          開發基礎已建立 · Phase 0
        </h2>
        <p className="mt-3 leading-7 text-stone-600">
          目前提供本機應用與健康檢查。登入、工作空間、照片上傳及客戶挑片尚未開放。
        </p>
        <p className="mt-3 text-sm text-stone-600">
          自動刪除關閉 · 儲存 adapter 僅供本機測試 · 尚未連接雲端服務
        </p>
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
