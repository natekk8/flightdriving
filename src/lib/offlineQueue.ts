// Persists lap records that failed to sync to Convex (e.g. lost connection
// mid-ride) so they aren't silently dropped, and retries them once the
// connection is back.

const STORAGE_KEY = 'flightdriving_pending_laps';

type PendingLap = Record<string, unknown> & { _queueId: string; _attempts?: number };

function readQueue(): PendingLap[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: PendingLap[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error('Nie udało się zapisać kolejki okrążeń offline', err);
  }
}

export function queueLap(lap: Record<string, unknown>): number {
  const queue = readQueue();
  queue.push({ ...lap, _queueId: `${Date.now()}-${Math.random().toString(36).slice(2)}`, _attempts: 0 });
  writeQueue(queue);
  return queue.length;
}

export function getQueuedLapCount(): number {
  return readQueue().length;
}

export async function flushLapQueue(
  recordLap: (args: any) => Promise<unknown>
): Promise<number> {
  const queue = readQueue();
  if (queue.length === 0) return 0;

  const stillPending: PendingLap[] = [];
  for (const item of queue) {
    const { _queueId, _attempts = 0, ...lapArgs } = item;
    try {
      await recordLap(lapArgs);
    } catch {
      const nextAttempts = _attempts + 1;
      if (nextAttempts < 5) {
        stillPending.push({ ...item, _attempts: nextAttempts });
      } else {
        console.error('Przekroczono limit prób wysłania okrążenia offline', item);
      }
    }
  }

  const currentStorage = readQueue();
  const stillPendingMap = new Map(stillPending.map(item => [item._queueId, item]));
  const originalIds = new Set(queue.map(item => item._queueId));

  const merged: PendingLap[] = [];
  const seenIds = new Set<string>();

  for (const item of currentStorage) {
    if (stillPendingMap.has(item._queueId)) {
      merged.push(stillPendingMap.get(item._queueId)!);
      seenIds.add(item._queueId);
    } else if (!originalIds.has(item._queueId)) {
      merged.push(item);
      seenIds.add(item._queueId);
    }
  }

  for (const item of stillPending) {
    if (!seenIds.has(item._queueId)) {
      merged.push(item);
      seenIds.add(item._queueId);
    }
  }

  writeQueue(merged);
  return merged.length;
}