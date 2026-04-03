/**
 * Live OpenRouter multimodal check (vision image_url + text → JSON reply).
 * Uses a real ops-console screenshot fixture so we validate OCR/UI understanding, not only tiny placeholders.
 *
 * Registers **no tests** unless OPENROUTER_MULTIMODAL_VALIDATE=1 (safe for `npm test`).
 *   npm run validate:openrouter-multimodal
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { openRouterDesktopContextAnalysis } from '@delegate-ai/agent-core'

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const opsPickReplyFixture = path.join(fixtureDir, 'openrouter-ops-pick-reply-screenshot.jpg')
const mirachatInboxFixture = path.join(fixtureDir, 'openrouter-mirachat-inbox-screenshot.jpg')

const shouldRun =
  process.env.OPENROUTER_MULTIMODAL_VALIDATE === '1' && Boolean(process.env.OPENROUTER_API_KEY?.trim())

describe.runIf(shouldRun)('OpenRouter multimodal integration', () => {
  it(
    'openRouterDesktopContextAnalysis reads ops-console screenshot and returns vision-grounded analysis + reply',
    async () => {
      expect(
        existsSync(opsPickReplyFixture),
        `missing fixture ${opsPickReplyFixture} — add tests/fixtures/openrouter-ops-pick-reply-screenshot.jpg`,
      ).toBe(true)

      const screenshotImageBase64 = readFileSync(opsPickReplyFixture).toString('base64')

      const result = await openRouterDesktopContextAnalysis({
        channel: 'whatsapp',
        threadId: 'openrouter-multimodal-validation',
        contactId: 'validation',
        summary: 'MiraChat ops console: Reply in your tone / in-your-voice drafts panel (screenshot attached).',
        extractedText: [
          'Validation: ground your analysis in the attached screenshot.',
          'Required: at least one analysis bullet must quote or name a visible UI heading or section title from the image (e.g. all-caps titles, button labels).',
          'Also note any long visible paragraph text inside cards or panels (first few words are enough).',
        ].join(' '),
        identityHints: ['Ops reviewer'],
        relationshipNotes: [],
        screenshotImageBase64,
        screenshotMimeType: 'image/jpeg',
        windowTitle: 'ops-console',
        windowClass: [],
      })

      expect(result).not.toBeNull()
      expect(result!.visionAttached).toBe(true)
      expect(result!.whatISee.length).toBeGreaterThan(15)
      expect(result!.analysis.toLowerCase()).toMatch(/what i see:/)
      expect(result!.analysis.length).toBeGreaterThan(40)
      expect(typeof result!.contactAvatarIdentified).toBe('boolean')
      expect(result!.suggestedReply).toBeTruthy()
      expect(String(result!.suggestedReply).length).toBeGreaterThan(5)

      const b = `${result!.analysis}\n${result!.suggestedReply ?? ''}`.toLowerCase()
      const uiSignals = [
        /pick\s+a\s+reply/,
        /primary\s+suggestion/,
        /suggested\s+replies/,
        /thread\s+snapshot/,
        /confidence/,
        /financial|irreversible|boundaries|commitments/,
        /relationship.{0,24}first|relationship-first/,
        /openclaw/,
        /approve\s+this\s+option/,
        /thanks\s+for\s+the\s+message/,
        /clear\s+next\s+step/,
        /\bcopy\b/,
      ]
      const hitCount = uiSignals.filter(r => r.test(b)).length
      expect(hitCount, `expected OCR/UI grounding; got: ${b.slice(0, 700)}…`).toBeGreaterThanOrEqual(3)
    },
    120_000,
  )

  it(
    'openRouterDesktopContextAnalysis reads MiraChat inbox / new-conversation screenshot (whatISee + UI OCR)',
    async () => {
      expect(
        existsSync(mirachatInboxFixture),
        `missing fixture ${mirachatInboxFixture}`,
      ).toBe(true)

      const screenshotImageBase64 = readFileSync(mirachatInboxFixture).toString('base64')

      const result = await openRouterDesktopContextAnalysis({
        channel: 'whatsapp',
        threadId: 'openrouter-inbox-validation',
        contactId: 'validation',
        summary: 'MiraChat web ops console: sidebar + thread list + new conversation pane (screenshot attached).',
        extractedText:
          'Ground answers in the screenshot. whatISee must describe the layout (sidebar vs main area) and any readable headings or thread titles.',
        identityHints: ['Tester'],
        relationshipNotes: [],
        screenshotImageBase64,
        screenshotMimeType: 'image/jpeg',
        windowTitle: 'MiraChat',
        windowClass: [],
      })

      expect(result).not.toBeNull()
      expect(result!.visionAttached).toBe(true)
      expect(result!.whatISee.length).toBeGreaterThan(20)
      expect(result!.analysis.toLowerCase()).toMatch(/what i see:/)
      expect(result!.suggestedReply).toBeTruthy()

      const b = `${result!.whatISee}\n${result!.analysis}\n${result!.suggestedReply ?? ''}`.toLowerCase()
      const inboxSignals = [
        /mirachat/,
        /search\s+dms|search\s+dm/,
        /generate\s+replies|inbound\s+queue|queue/,
        /new\s+conversation/,
        /simulate|drop\s+in\s+a\s+dm/,
        /whatsapp/,
        /no\s+history|history\s+in\s+store/,
        /assist|negotiate|summarize|refresh/,
        /online|approve\s+mode|db\s+online/,
        /browser-e2e|e2e-live|cursor-ui/,
      ]
      const hits = inboxSignals.filter(r => r.test(b)).length
      expect(hits, `expected inbox UI OCR; got: ${b.slice(0, 900)}…`).toBeGreaterThanOrEqual(4)
    },
    120_000,
  )
})
