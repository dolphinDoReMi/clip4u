import { MIRACHAT_INBOUND_QUEUE } from '@delegate-ai/db'
import type PgBoss from 'pg-boss'

/** Valid UUID unlikely to exist in inbound_messages — worker no-ops when row is missing. */
export const MIRACHAT_WORKER_READY_PROBE_INBOUND_ID = '00000000-0000-4000-8000-00000000c1a5'

/**
 * Ensures at least one mirachat inbound job can be consumed by the registered worker.
 * Sends a no-op job (unknown inbound id); the worker exits immediately without DB writes.
 */
export const waitForMirachatWorkerProbe = async (
  boss: PgBoss,
  options?: { timeoutMs?: number; pollMs?: number },
): Promise<void> => {
  const timeoutMs = options?.timeoutMs ?? 30_000
  const pollMs = options?.pollMs ?? 50
  const jobId = await boss.send(MIRACHAT_INBOUND_QUEUE, {
    inboundMessageId: MIRACHAT_WORKER_READY_PROBE_INBOUND_ID,
  })
  if (!jobId) {
    throw new Error('mirachat worker probe: boss.send returned null')
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const job = await boss.getJobById(MIRACHAT_INBOUND_QUEUE, jobId, { includeArchive: true })
    if (job?.state === 'completed') {
      return
    }
    if (job?.state === 'failed' || job?.state === 'cancelled') {
      throw new Error(`mirachat worker probe job ended in ${job.state}`)
    }
    await new Promise(r => setTimeout(r, pollMs))
  }
  throw new Error('mirachat worker probe timed out')
}
