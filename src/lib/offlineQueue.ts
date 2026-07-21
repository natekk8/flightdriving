// Persists lap records that failed to sync to Convex (e.g. lost connection
// mid-ride) so they aren't silently dropped, and retries them once the
// connection is back.

const STORAGE_KEY = 'flightdriving_pending_laps';

type PendingLap = Record<string, unknown> & { _queueId: string };

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
  queue.push({ ...lap, _queueId: `${Date.now()}-${Math.random().toString(36).slice(2)}` });
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
    const { _queueId, ...lapArgs } = item;
    try {
      await recordLap(lapArgs);
    } catch {
      stillPending.push(item);
    }
  }

  writeQueue(stillPending);
  return stillPending.length;
}