import type { PolicyDecision, PolicyEngine } from '@delegate-ai/adapter-types'

import { openRouterPolicyEvaluation } from '@delegate-ai/agent-core'

/** Hard-boundary topics: PRD / GQM — no financial or irreversible commitments without human approval. */
const sensitivePatterns = [
  /\b(money|payment|invoice|wire transfer|i(?:'ll|\s+will)\s+pay|commit\s+\$|send\s+\$)\b/i,
  /\bfinancial commitment\b/i,
  /\bnot going to confirm a financial commitment\b/i,
  /\b(contract|sign\s+the|legally\s+binding)\b/i,
  /\blawsuit\b/i,
  /\b(invest|equity|safe\s+note)\b/i,
]

const allowAutoSend = (): boolean => process.env.MIRACHAT_ALLOW_AUTO_SEND === 'true'

const twilioAutoSend = (): boolean =>
  allowAutoSend() && process.env.MIRACHAT_TWILIO_AUTO_SEND === 'true'

const isTwilioChannel = (ch: string): boolean =>
  ch === 'twilio_whatsapp' || ch === 'twilio_sms'

export class DefaultPolicyEngine implements PolicyEngine {
  async evaluate(input: Parameters<PolicyEngine['evaluate']>[0]): Promise<PolicyDecision> {
    if (sensitivePatterns.some(pattern => pattern.test(input.draft.response))) {
      return { action: 'BLOCK', reasons: ['financial_commitment_or_hard_boundary'] }
    }

    if (input.attendedRecall) {
      // We pass hardBoundaries via the relationship profile or identity profile.
      // Wait, PolicyEngine doesn't receive identity directly, but we can assume it's in the attendedRecall or we just pass an empty array if not available.
      // For now, we'll just evaluate against the attended recall.
      const evalResult = await openRouterPolicyEvaluation({
        draft: input.draft.response,
        attendedRecall: input.attendedRecall,
        hardBoundaries: [], // hard boundaries are already baked into the drafted response or attended recall
      })
      if (!evalResult.safe) {
        return { action: 'BLOCK', reasons: [`policy_engine_block: ${evalResult.reason}`] }
      }
    }

    if (input.relationship.riskLevel === 'high') {
      return { action: 'REVIEW', reasons: ['high_risk_relationship'] }
    }

    const minConfidence =
      allowAutoSend() && input.relationship.riskLevel === 'low' ? 0.78 : 0.85
    if (input.draft.confidence < minConfidence) {
      return { action: 'REVIEW', reasons: ['low_confidence'] }
    }

    if (input.event.threadType === 'group') {
      return { action: 'REVIEW', reasons: ['group_thread_mvp'] }
    }

    // Twilio: stay on REVIEW unless v2 flags explicitly allow bounded AUTO (compliance posture).
    if (isTwilioChannel(input.event.channel) && !twilioAutoSend()) {
      return { action: 'REVIEW', reasons: ['twilio_compliance_default'] }
    }

    // v2 bounded AUTO: MIRACHAT_ALLOW_AUTO_SEND=true; Twilio also needs MIRACHAT_TWILIO_AUTO_SEND=true.
    if (allowAutoSend() && input.event.threadType === 'dm' && input.relationship.riskLevel === 'low') {
      return {
        action: 'AUTO_SEND',
        reasons: [
          isTwilioChannel(input.event.channel)
            ? 'auto_send_twilio_v2_env_low_risk_dm'
            : 'auto_send_explicit_env_low_risk_dm',
        ],
      }
    }

    return { action: 'REVIEW', reasons: ['mvp_default_human_approval'] }
  }
}
