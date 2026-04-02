import type { PolicyDecision, PolicyEngine } from '@delegate-ai/adapter-types'

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
