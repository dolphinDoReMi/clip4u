/** Canonical delegation / measurement event names — see docs/measurement-system-GQM.md */
export const DelegationEventType = {
  InboundEnqueued: 'inbound.enqueued',
  AssistGenerated: 'assist.generated',
  SummaryGenerated: 'summary.generated',
  PolicyEvaluated: 'policy.evaluated',
  DraftCreated: 'draft.created',
  DraftAutoQueued: 'draft.auto_queued',
  DraftAutoSent: 'draft.auto_sent',
  DraftApprovedAsIs: 'draft.approved_as_is',
  DraftApprovedWithEdit: 'draft.approved_with_edit',
  DraftRejected: 'draft.rejected',
  DoerStarted: 'doer.started',
  DoerCompleted: 'doer.completed',
  DoerFailed: 'doer.failed',
  OutboundSent: 'outbound.sent',
  OutboundSendFailed: 'outbound.send_failed',
  PipelineFailed: 'pipeline.failed',
  TwilioMessageStatus: 'twilio.message_status',
  OauthConnected: 'oauth.connected',
  IngestCompleted: 'ingest.completed',
  IdentityUpdated: 'identity.updated',
  RelationshipUpdated: 'relationship.updated',
  ModeChanged: 'mode.changed',
  TrustRegression: 'trust.regression',
  FeedbackSoundsLikeMe: 'feedback.sounds_like_me',
  FeedbackRegret: 'feedback.regret',
  FeedbackBoundaryViolation: 'feedback.boundary_violation',
  A2aProposal: 'a2a.proposal',
  A2aResponse: 'a2a.response',
  NegotiationTurn: 'negotiation.turn',
  PhoneCallRequested: 'phone.call.requested',
  PhoneCallPlaced: 'phone.call.placed',
  PhoneCallFailed: 'phone.call.failed',
  /** Twilio Programmable Voice status callback (includes StirVerstat when present). */
  PhoneTwilioCallStatus: 'phone.twilio.call_status',
} as const

export type DelegationEventTypeName = (typeof DelegationEventType)[keyof typeof DelegationEventType]

/** Policy engine version string stored on evaluated events (stable id for dashboards). */
export const POLICY_ENGINE_ID = 'default_v1'
