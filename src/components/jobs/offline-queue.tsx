'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CloudOff, RefreshCw, Trash2 } from 'lucide-react';

/**
 * Kolejka offline dla pracownika w terenie.
 *
 * Zasada uczciwości: dane zapisane offline są wyraźnie oznaczone jako
 * „oczekujące wysłania”. Nic nie jest pokazywane jako zapisane na serwerze,
 * dopóki synchronizacja nie zwróci potwierdzenia.
 *
 * Kolejka mieszkana w IndexedDB (zdjęcia jako blob), a wysyłka odbywa się
 * partiami do /api/zlecenia/<id>/synchronizuj z idempotencyjnym clientId.
 */

const DB_NAME = 'serviceflow-outbox';
const STORE = 'items';

export type QueueItem = {
  clientId: string;
  kind: 'note' | 'photo' | 'status' | 'checklist' | 'time';
  createdAt: number;
  label: string;
  payload: Record<string, unknown>;
  /** blob zdjęcia (tylko kind === 'photo'), przechowywany lokalnie do czasu wysłania */
  blob?: Blob;
  fileName?: string;
  previewUrl?: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'clientId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbAll(): Promise<QueueItem[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as QueueItem[]) ?? []);
    request.onerror = () => reject(request.error);
  });
}

async function idbPut(item: QueueItem): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(clientId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(clientId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function newClientId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function OfflineQueue({ jobId }: { jobId: string }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [timerStartedAt, setTimerStartedAt] = useState<number | null>(null);
  const [pausedMs, setPausedMs] = useState(0);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const ready = useRef(false);

  // licznik działa lokalnie — działa również bez sieci
  useEffect(() => {
    if (timerStartedAt === null) return;
    const tick = () => {
      const now = Date.now();
      const pause = pausedMs + (pausedAt ? now - pausedAt : 0);
      setElapsed(Math.max(0, Math.round((now - timerStartedAt - pause) / 1000)));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [timerStartedAt, pausedMs, pausedAt]);

  const refresh = useCallback(async () => {
    try {
      const all = await idbAll();
      setItems(all.sort((a, b) => a.createdAt - b.createdAt));
    } catch {
      setError('Nie udało się odczytać lokalnej kolejki (przeglądarka blokuje IndexedDB).');
    }
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    void refresh().then(() => {
      ready.current = true;
    });
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [refresh]);

  const sync = useCallback(async () => {
    if (syncing) return;
    const pending = await idbAll();
    if (pending.length === 0) return;

    setSyncing(true);
    setError(null);

    // 1) zdjęcia najpierw wgrywamy (plik → fileId), dopiero potem wiążemy ze zleceniem
    const prepared: { item: QueueItem; payload: Record<string, unknown> }[] = [];
    for (const item of pending.sort((a, b) => a.createdAt - b.createdAt)) {
      if (item.kind === 'photo' && item.blob) {
        try {
          const form = new FormData();
          form.append('plik', item.blob, item.fileName ?? `zdjecie-${item.clientId}.jpg`);
          form.append('kind', 'JOB_PHOTO');
          form.append('jobId', jobId);

          const upload = await fetch('/api/pliki', { method: 'POST', body: form });
          if (!upload.ok) throw new Error((await upload.json().catch(() => ({}))).error ?? 'Błąd wgrywania pliku.');
          const uploaded = (await upload.json()) as { fileId: string };
          prepared.push({ item, payload: { ...item.payload, fileId: uploaded.fileId } });
        } catch (uploadError) {
          setError(uploadError instanceof Error ? uploadError.message : 'Nie udało się wysłać zdjęcia.');
          setSyncing(false);
          return;
        }
      } else {
        prepared.push({ item, payload: item.payload });
      }
    }

    // 2) jedna partia — serwer rozlicza każdą pozycję osobno (clientId = idempotencja)
    try {
      const response = await fetch(`/api/zlecenia/${jobId}/synchronizuj`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: prepared.map(({ item, payload }) => ({ clientId: item.clientId, kind: item.kind, ...payload })) }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Serwer odrzucił synchronizację (${response.status}).`);
      }

      const data = (await response.json()) as {
        ok?: number;
        duplicates?: number;
        errors?: number;
        results?: { clientId: string; status: 'ok' | 'duplicate' | 'error'; error?: string }[];
      };

      const results = data.results ?? [];
      for (const result of results) {
        if (result.status !== 'error') {
          const item = prepared.find((row) => row.item.clientId === result.clientId)?.item;
          if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
          await idbDelete(result.clientId);
        }
      }

      const failed = results.filter((row) => row.status === 'error');
      setMessage(
        failed.length > 0
          ? `Zsynchronizowano ${data.ok ?? 0}. Nie udało się wysłać ${failed.length}: ${failed.map((row) => row.error).join('; ')}`
          : `Zsynchronizowano ${data.ok ?? 0} ${(data.ok ?? 0) === 1 ? 'pozycję' : 'pozycji'}.`,
      );
      await refresh();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Nie udało się zsynchronizować.');
    } finally {
      setSyncing(false);
    }
  }, [jobId, refresh, syncing]);

  // automatyczna synchronizacja po powrocie do sieci
  useEffect(() => {
    if (online && ready.current && items.length > 0 && !syncing) void sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  async function enqueue(item: Omit<QueueItem, 'clientId' | 'createdAt'>) {
    const record: QueueItem = { ...item, clientId: newClientId(), createdAt: Date.now() };
    await idbPut(record);
    await refresh();
    setMessage('Zapisano lokalnie — wyślemy po połączeniu z siecią.');
    if (navigator.onLine) void sync();
  }

  async function addNote() {
    const body = note.trim();
    if (!body) return;
    await enqueue({ kind: 'note', label: `Notatka: ${body.slice(0, 40)}`, payload: { body } });
    setNote('');
  }

  async function addPhoto(file: File) {
    if (!file) return;
    await enqueue({
      kind: 'photo',
      label: `Zdjęcie: ${file.name}`,
      payload: { type: 'AFTER' },
      blob: file,
      fileName: file.name,
      previewUrl: URL.createObjectURL(file),
    });
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <section className="rounded-lg border border-ink-100 bg-white p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-900">Kolejka offline</h2>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${
            online ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'
          }`}
        >
          {online ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
          {online ? 'Online' : 'Brak sieci — zapis lokalny'}
        </span>
      </header>

      {message ? <p className="mb-2 text-xs text-emerald-700">{message}</p> : null}
      {error ? <p className="mb-2 text-xs text-red-700">{error}</p> : null}

      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Notatka ze zlecenia (zapiszę ją offline)"
            className="input flex-1 text-sm"
          />
          <button type="button" onClick={addNote} className="btn-secondary text-sm">
            Dodaj
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {timerStartedAt === null ? (
            <button
              type="button"
              onClick={() => {
                setTimerStartedAt(Date.now());
                setPausedMs(0);
                setPausedAt(null);
              }}
              className="btn-secondary text-sm"
            >
              ▶ Start pracy (offline)
            </button>
          ) : (
            <>
              <span className="text-sm font-medium text-ink-900 tabular-nums">
                {String(Math.floor(elapsed / 3600)).padStart(2, '0')}:
                {String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')}:
                {String(elapsed % 60).padStart(2, '0')}
              </span>
              <button
                type="button"
                onClick={() => setPausedAt(pausedAt ? null : Date.now())}
                className="btn-secondary text-sm"
              >
                {pausedAt ? 'Wznów' : 'Pauza'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const now = Date.now();
                  const pause = pausedMs + (pausedAt ? now - pausedAt : 0);
                  void enqueue({
                    kind: 'time',
                    label: `Czas pracy: ${Math.round((now - timerStartedAt - pause) / 1000)} s`,
                    payload: {
                      startedAt: new Date(timerStartedAt).toISOString(),
                      endedAt: new Date(now).toISOString(),
                      pausedMs: pause,
                    },
                  });
                  setTimerStartedAt(null);
                  setPausedMs(0);
                  setPausedAt(null);
                  setElapsed(0);
                }}
                className="btn-primary text-sm"
              >
                Zapisz czas
              </button>
            </>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void addPhoto(file);
          }}
          className="block w-full text-xs text-ink-600 file:mr-2 file:rounded-md file:border-0 file:bg-ink-100 file:px-3 file:py-2 file:text-xs"
        />
      </div>

      {items.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-ink-100 pt-3">
          {items.map((item) => (
            <li key={item.clientId} className="flex items-center justify-between gap-2 text-xs text-ink-700">
              <span className="truncate">
                <span className="mr-1 rounded bg-amber-50 px-1.5 py-0.5 text-amber-900">oczekuje</span>
                {item.label}
              </span>
              <button
                type="button"
                onClick={async () => {
                  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
                  await idbDelete(item.clientId);
                  await refresh();
                }}
                className="text-ink-400 hover:text-red-600"
                aria-label="Usuń z kolejki"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 border-t border-ink-100 pt-3 text-xs text-ink-500">Kolejka jest pusta.</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void sync()} disabled={syncing || items.length === 0} className="btn-primary text-sm">
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          {syncing ? 'Wysyłam…' : `Wyślij (${items.length})`}
        </button>
        {items.length > 0 ? (
          <button
            type="button"
            onClick={async () => {
              await idbClear();
              await refresh();
            }}
            className="btn-secondary text-sm"
          >
            Wyczyść kolejkę
          </button>
        ) : null}
      </div>
    </section>
  );
}
