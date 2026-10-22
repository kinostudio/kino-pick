'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { workspaceSchema, type Workspace } from '@kino-pic/contracts';
import { Button } from '@kino-pic/ui';
const roles = {
  workspace_owner: '擁有者',
  workspace_editor: '編輯者',
  photographer: '攝影師',
  retoucher: '修圖師',
};
export function WorkspacePanel({
  workspaces,
  nextCursor,
  hasCursor,
}: {
  workspaces: Workspace[];
  nextCursor: string | null;
  hasCursor: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState<{
    name: string;
    requestId: string;
  } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    const value = name.trim();
    const input =
      attempt?.name === value
        ? attempt
        : { name: value, requestId: crypto.randomUUID() };
    setAttempt(input);
    try {
      const response = await fetch('/api/v1/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = z
          .object({ error: z.object({ message: z.string() }) })
          .safeParse(await response.json());
        throw new Error(
          body.success ? body.data.error.message : '無法建立工作空間，請重試',
        );
      }
      z.object({ workspace: workspaceSchema }).parse(await response.json());
      setName('');
      setAttempt(null);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error && e.message.startsWith('無法')
          ? e.message
          : '建立未完成，請重試；相同內容重試不會重複建立',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <section aria-labelledby="workspace-list" className="mt-10">
        <h2 id="workspace-list" className="text-xl font-semibold">
          我的工作空間
        </h2>
        {workspaces.length === 0 ? (
          <p className="mt-4 text-stone-600">
            尚無工作空間，建立第一個工作空間開始整理作品。
          </p>
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {workspaces.map((w) => (
              <li
                key={w.id}
                className="rounded-lg border border-stone-200 bg-white p-6"
              >
                <h3 className="text-lg font-semibold">{w.name}</h3>
                <p className="mt-2 text-sm text-stone-600">{roles[w.role]}</p>
                <Link
                  href={`/dashboard/workspaces/${w.id}`}
                  aria-label={`查看 ${w.name} 的專案`}
                  className="mt-3 inline-block text-sm underline"
                >
                  查看專案
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <nav aria-label="工作空間分頁" className="mt-6 flex gap-6 text-sm">
        {hasCursor && (
          <Link href="/dashboard" className="underline">
            返回第一頁
          </Link>
        )}
        {nextCursor && (
          <Link
            href={'/dashboard?cursor=' + encodeURIComponent(nextCursor)}
            className="underline"
          >
            下一頁工作空間
          </Link>
        )}
      </nav>
      <section
        className="mt-10 rounded-lg border border-stone-200 bg-white p-6"
        aria-labelledby="create-title"
      >
        <h2 id="create-title" className="text-lg font-semibold">
          建立工作空間
        </h2>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <label className="block text-sm" htmlFor="workspace-name">
            工作空間名稱
          </label>
          <input
            id="workspace-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            disabled={pending}
            className="w-full rounded-md border border-stone-300 p-3"
            autoComplete="organization"
          />
          {error && (
            <p role="alert" className="text-sm text-red-800">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending ? '建立中…' : '建立工作空間'}
          </Button>
        </form>
      </section>
    </>
  );
}
