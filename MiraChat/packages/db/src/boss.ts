import PgBoss from 'pg-boss'

export const MIRACHAT_INBOUND_QUEUE = 'mirachat-process-inbound'

export const MIRACHAT_MEMORY_ENRICH_QUEUE = 'mirachat-memory-enrich'

export type InboundJobData = { inboundMessageId: string }

export type MemoryEnrichJobData = { inboundMessageId: string }

export const createBoss = (connectionString: string): PgBoss => new PgBoss(connectionString)

export const startMirachatBoss = async (boss: PgBoss): Promise<void> => {
  await boss.start()
  await boss.createQueue(MIRACHAT_INBOUND_QUEUE)
  await boss.createQueue(MIRACHAT_MEMORY_ENRICH_QUEUE)
}

export const enqueueInboundProcessing = async (boss: PgBoss, inboundMessageId: string): Promise<void> => {
  await boss.send(MIRACHAT_INBOUND_QUEUE, { inboundMessageId } satisfies InboundJobData)
}

export const enqueueMemoryEnrichment = async (boss: PgBoss, inboundMessageId: string): Promise<void> => {
  await boss.send(MIRACHAT_MEMORY_ENRICH_QUEUE, { inboundMessageId } satisfies MemoryEnrichJobData)
}
