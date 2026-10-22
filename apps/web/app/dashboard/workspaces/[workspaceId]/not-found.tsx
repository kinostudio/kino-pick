import Link from 'next/link';
export default function WorkspaceNotFound() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold">無法開啟工作空間</h1>
      <p className="mt-4 text-stone-600">工作空間不存在或你沒有存取權限。</p>
      <Link href="/dashboard" className="mt-6 inline-block underline">
        返回攝影工作台
      </Link>
    </main>
  );
}
