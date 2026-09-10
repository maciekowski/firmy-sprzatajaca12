'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Bell } from 'lucide-react';
import { markAllNotificationsReadAction } from '@/app/(app)/actions';

export function NotificationBell({ unread }: { unread: number }) {
  const [pending, startTransition] = useTransition();
  const [count, setCount] = useState(unread);
  const router = useRouter();

  return (
    <div className="relative">
      <Link
        href="/powiadomienia"
        className="relative grid h-9 w-9 place-items-center rounded-lg text-ink-600 hover:bg-ink-100 hover:text-ink-900"
        aria-label={`Powiadomienia (${count})`}
      >
        <Bell className="h-5 w-5" />
        {count > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {count > 9 ? '9+' : count}
          </span>
        ) : null}
      </Link>
      {count > 0 ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              await markAllNotificationsReadAction();
              setCount(0);
              router.refresh();
            });
          }}
          className="sr-only"
        >
          Oznacz jako przeczytane
        </button>
      ) : null}
    </div>
  );
}
