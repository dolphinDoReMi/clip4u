import {
  getInboundMessage,
  getMemoryEnrichmentRun,
  getMemoryNarrativeSnapshot,
  getRelationshipHintsForContact,
  insertMemoryEvents,
  listRecentMemoryEventSummaries,
  upsertMemoryEntities,
  upsertMemoryEnrichmentRun,
  upsertMemoryNarrativeFromEnrichment,
} from '@delegate-ai/db'
import { isLowSignalInboundText, openRouterMemoryEnrichment } from '@delegate-ai/agent-core'
import type { Pool } from 'pg'

const skipMemoryEnqueue = (): boolean => process.env.MIRACHAT_MEMORY_ENRICHMENT?.trim() === '0'

export { skipMemoryEnqueue }

/**
 * Async structured memory: OpenRouter batched JSON → entities, events, narrative snapshot.
 */
export async function processMemoryEnrichJob(pool: Pool, inboundMessageId: string): Promise<void> {
  const row = await getInboundMessage(pool, inboundMessageId)
  if (!row || row.status !== 'DONE') {
    return
  }

  const prev = await getMemoryEnrichmentRun(pool, row.user_id, inboundMessageId)
  if (prev?.status === 'success' || prev?.status === 'skipped') {
    return
  }

  if (isLowSignalInboundText(row.raw_text)) {
    await upsertMemoryEnrichmentRun(pool, {
      userId: row.user_id,
      sourceInboundId: inboundMessageId,
      status: 'skipped',
      detail: 'low_signal',
    })
    return
  }

  const key = process.env.OPENROUTER_API_KEY?.trim()
  if (!key) {
    await upsertMemoryEnrichmentRun(pool, {
      userId: row.user_id,
      sourceInboundId: inboundMessageId,
      status: 'skipped',
      detail: 'no_openrouter_key',
    })
    return
  }

  try {
    const hintsRow = await getRelationshipHintsForContact(pool, row.user_id, row.sender_id)
    const knownContactHints: string[] = []
    if (hintsRow) {
      knownContactHints.push(`contact_id=${hintsRow.contact_id} type=${hintsRow.relationship_type}`)
      for (const n of hintsRow.notes ?? []) {
        const t = n?.trim()
        if (t) {
          knownContactHints.push(t)
        }
      }
    } else {
      knownContactHints.push(`contact_id=${row.sender_id} (no relationship row)`)
    }

    const narrative = await getMemoryNarrativeSnapshot(pool, row.user_id)
    const recentEvents = await listRecentMemoryEventSummaries(pool, row.user_id, 6)

    const parsed = await openRouterMemoryEnrichment({
      userId: row.user_id,
      threadId: row.thread_id,
      inboundMessageId,
      rawText: row.raw_text,
      knownContactHints,
      priorNarrativeInternal: narrative?.internal_summary ?? '',
      recentEventSummaries: recentEvents,
    })

    if (!parsed) {
      await upsertMemoryEnrichmentRun(pool, {
        userId: row.user_id,
        sourceInboundId: inboundMessageId,
        status: 'failed',
        detail: 'openrouter_null',
      })
      return
    }

    await upsertMemoryEntities(
      pool,
      parsed.entities.map(e => ({
        userId: row.user_id,
        threadId: row.thread_id,
        sourceInboundId: inboundMessageId,
        surfaceForm: e.surfaceForm,
        entityType: e.entityType,
        canonicalLabel: e.canonicalLabel,
        confidence: e.confidence,
        contactId: e.contactId,
        notes: e.notes,
      })),
    )

    await insertMemoryEvents(
      pool,
      parsed.events.map(ev => ({
        userId: row.user_id,
        threadId: row.thread_id,
        sourceInboundId: inboundMessageId,
        kind: ev.kind,
        summary: ev.summary,
        entitiesTouched: ev.entitiesTouched,
        orderingHint: ev.orderingHint,
        recurrence: ev.recurrence,
        dueHint: ev.dueHint,
        confidence: ev.confidence,
      })),
    )

    if (parsed.narrativeDelta) {
      const nd = parsed.narrativeDelta
      const hasConflicts = Array.isArray(nd.conflicts) && nd.conflicts.length > 0
      const ok = await upsertMemoryNarrativeFromEnrichment(pool, {
        userId: row.user_id,
        narrativeMarkdown: nd.narrativeMarkdown,
        internalSummary: nd.internalSummary,
        pendingConflicts: hasConflicts ? nd.conflicts : null,
        expectedVersion: narrative?.version ?? 0,
      })
      if (!ok) {
        console.warn(`[memory] narrative upsert skipped due to version conflict for user ${row.user_id}`)
      }
    }

    await upsertMemoryEnrichmentRun(pool, {
      userId: row.user_id,
      sourceInboundId: inboundMessageId,
      status: 'success',
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await upsertMemoryEnrichmentRun(pool, {
      userId: row.user_id,
      sourceInboundId: inboundMessageId,
      status: 'failed',
      detail: message.slice(0, 2000),
    })
  }
}
