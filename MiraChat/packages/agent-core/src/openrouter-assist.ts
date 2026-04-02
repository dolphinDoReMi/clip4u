const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

const truncate = (s: string, max: number): string => {
  if (s.length <= max) {
    return s
  }
  return `${s.slice(0, max)}\n…`
}

const formatMessages = (label: string, messages: { threadId: string; direction: string; content: string }[]): string => {
  if (messages.length === 0) {
    return `${label}: (none)`
  }
  return `${label}:\n${messages
    .map(m => `[${m.direction} ${m.threadId.slice(0, 12)}…] ${m.content}`)
    .join('\n')}`
}

export interface OpenRouterAnalysisInput {
  latestUserText: string
  recentMessages: { threadId: string; direction: string; content: string }[]
  searchMatches: { threadId: string; direction: string; content: string }[]
}

/**
 * Optional chat-model assist (e.g. GLM via OpenRouter) for intent/context analysis only.
 * Set OPENROUTER_API_KEY; OPENROUTER_MODEL defaults to a GLM-class route on OpenRouter.
 */
export async function openRouterAnalysisAssist(input: OpenRouterAnalysisInput): Promise<string | null> {
  const key = process.env.OPENROUTER_API_KEY?.trim()
  if (!key) {
    return null
  }

  const model =
    process.env.OPENROUTER_MODEL?.trim() ||
    'zhipuai/glm-4-flash'

  const threadExcerpt = truncate(
    formatMessages('Current thread', input.recentMessages),
    12000,
  )
  const searchExcerpt = truncate(
    formatMessages('Search hits (other threads / history)', input.searchMatches),
    12000,
  )

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(process.env.OPENROUTER_HTTP_REFERER
        ? { 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER }
        : {}),
      'X-Title': 'MiraChat analysis assist',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You help a bounded communication delegate. Output 3–8 short bullet lines: intent, entities, tone, risks, and what the human should consider. Do not write the reply message itself.',
        },
        {
          role: 'user',
          content: `Latest inbound:\n${truncate(input.latestUserText, 8000)}\n\n${threadExcerpt}\n\n${searchExcerpt}`,
        },
      ],
      max_tokens: 500,
      temperature: 0.2,
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('OpenRouter analysis assist failed', res.status, errText)
    return null
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = data.choices?.[0]?.message?.content?.trim()
  return text || null
}
