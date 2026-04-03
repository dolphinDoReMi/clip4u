import { describe, expect, it } from 'vitest'
import {
  OPENROUTER_PROMPT_OS_VERSION,
  buildAnalysisAssistSystemPrompt,
  buildDesktopContextSystemPrompt,
  buildPrimaryReplySystemPrompt,
  buildPrdReplyOptionsSystemPrompt,
  buildThreadSummarySystemPrompt,
} from '@delegate-ai/agent-core'

describe('OpenRouter Prompt OS', () => {
  it('exports a dotted version string for regression tracking', () => {
    expect(OPENROUTER_PROMPT_OS_VERSION).toMatch(/^\d{4}\.\d+\.\d+\.\d+$/)
  })

  it('structures analysis-assist with role, constraints, and safety', () => {
    const p = buildAnalysisAssistSystemPrompt()
    expect(p).toMatch(/## ROLE/i)
    expect(p).toMatch(/## CONSTRAINTS/i)
    expect(p).toMatch(/## SAFETY/i)
    expect(p.toLowerCase()).toMatch(/do not write/)
  })

  it('structures desktop context for vision and JSON contract', () => {
    const v = buildDesktopContextSystemPrompt(true)
    expect(v).toContain(OPENROUTER_PROMPT_OS_VERSION)
    expect(v).toMatch(/## VISION \/ SEQUENCE/i)
    expect(v).toMatch(/whatISee/i)
    expect(v).toMatch(/reasoningTrace/i)
    expect(v).toMatch(/suggestedReply/i)
    const nv = buildDesktopContextSystemPrompt(false)
    expect(nv).toMatch(/empty string/i)
  })

  it('structures primary reply with boundaries and voice', () => {
    const p = buildPrimaryReplySystemPrompt({
      boundaries: 'no promises',
      tone: 'warm',
      role: 'friend',
      riskLevel: 'low',
      displayName: 'Alex',
    })
    expect(p).toMatch(/Alex/)
    expect(p).toMatch(/user \/ sender/i)
    expect(p).toMatch(/never as the contact/i)
    expect(p).toMatch(/no promises/)
    expect(p).toMatch(/## VOICE/i)
  })

  it('structures PRD reply options and thread summary', () => {
    expect(buildPrdReplyOptionsSystemPrompt()).toMatch(/"options"/)
    expect(buildThreadSummarySystemPrompt()).toMatch(/## OUTPUT/i)
  })
})
