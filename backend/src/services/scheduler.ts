import { getDefaultUserId, prisma } from "../lib/prisma.js";
import { startRefreshRun, currentRun } from "./refresh.js";

// Nightly auto-update. In-process on purpose: the backend is a long-lived
// server and an OS cron would need its own auth and deployment story. The
// jitter keeps the scrapers from ever seeing a fixed-time burst.
const JITTER_MS = 30 * 60 * 1000;

export function msUntilNightly(now: Date, hour: number, jitterMs: number, random: () => number = Math.random): number {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime() + Math.floor(random() * jitterMs);
}

export async function runNightly(): Promise<void> {
  const userId = await getDefaultUserId();
  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  if (settings && settings.autoRefreshEnabled === false) return;
  startRefreshRun({ trigger: "nightly" });
  // Wait for the price run to finish before coupon ingestion (Task 9 appends it
  // here) so the scrapers are never hit by two jobs at once.
  while (currentRun()) await new Promise((r) => setTimeout(r, 5000));
}

export function startNightlyScheduler(run: () => Promise<unknown> = runNightly): { stop(): void } {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const schedule = async () => {
    if (stopped) return;
    const userId = await getDefaultUserId().catch(() => null);
    const settings = userId ? await prisma.userSettings.findUnique({ where: { userId } }).catch(() => null) : null;
    const hour = settings?.autoRefreshHour ?? 3;
    timer = setTimeout(async () => {
      try {
        await run();
      } finally {
        void schedule();
      }
    }, msUntilNightly(new Date(), hour, JITTER_MS));
  };

  void schedule();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  };
}
