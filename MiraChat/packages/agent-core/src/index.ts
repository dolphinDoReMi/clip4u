import { InMemoryApprovalStore } from '@delegate-ai/approval'
import { AssistService } from '@delegate-ai/assist-core'
import { AdapterRegistry, type ApprovalStore, type AssistRequest, type ChannelAdapter, type ContextBundle, type DelegateDraft, type IdentityService, type MemoryService, type MessageEvent, type PolicyEngine } from '@delegate-ai/adapter-types'
import { InMemoryIdentityService } from '@delegate-ai/identity'
import { InMemoryMemoryService } from '@delegate-ai/memory'
import { DefaultPolicyEngine } from '@delegate-ai/policy-engine'
import { buildContextBundle, runCognitivePipeline } from './cognitive.js'

export { buildContextBundle, classifyIntent, runCognitivePipeline } from './cognitive.js'
export {
  MIRACHAT_INGEST_SUGGESTED_REPLY_MARKER,
  buildIngestSuggestedReplyMemoryChunk,
  extractLatestIngestSuggestedReply,
  isOpenRouterPrimaryDraftEnabled,
  openRouterAnalysisAssist,
  openRouterDesktopContextAnalysis,
  openRouterPrimaryReplyDraft,
  parseOpenRouterDesktopContextJson,
} from './openrouter-assist.js'
export type { OpenRouterDesktopContextInput, OpenRouterDesktopContextResult } from './openrouter-assist.js'
export { inferImageMimeFromBase64, isOpenRouterVisionImageMime } from './image-mime-sniff.js'
export {
  OPENROUTER_VISION_MAX_BASE64_CHARS_DEFAULT,
  buildDataUrlForOpenRouterVision,
  buildOpenRouterMultimodalUserContent,
  isOpenRouterVisionModelAllowed,
  parseOpenRouterChatCompletionContent,
  validateOpenRouterImageUrl,
  validateVisionBase64PayloadLength,
} from './openrouter-vision-schema.js'
export type {
  OpenRouterImageUrlContentPart,
  OpenRouterMultimodalUserContentPart,
  OpenRouterTextContentPart,
} from './openrouter-vision-schema.js'
export {
  OPENROUTER_PROMPT_OS_VERSION,
  buildAnalysisAssistSystemPrompt,
  buildDesktopContextSystemPrompt,
  buildPrimaryReplySystemPrompt,
  buildPrdReplyOptionsSystemPrompt,
  buildThreadSummarySystemPrompt,
} from './openrouter-prompt-os.js'
export type { PrimaryReplyPromptParams } from './openrouter-prompt-os.js'
export {
  buildAssistSuggestions,
  buildReplyOptions,
  buildThreadSummary,
  fallbackReplyOptions,
  fallbackThreadSummary,
  linesForSummaryTranscript,
  shorterDirectFromPrimary,
  type PrdReplyOption,
} from './prd-delegate.js'
export type { IntentSignal } from './cognitive.js'

export interface DelegateRuntimeDeps {
  identityService: IdentityService
  memoryService: MemoryService
  approvalStore: ApprovalStore
  policyEngine: PolicyEngine
  adapterRegistry: AdapterRegistry
  assistService: AssistService
}

export class DelegateRuntime {
  constructor(private readonly deps: DelegateRuntimeDeps) {}

  registerAdapter(adapter: ChannelAdapter): void {
    this.deps.adapterRegistry.register(adapter)
  }

  async handleAssistRequest(request: AssistRequest) {
    const identity = await this.deps.identityService.getIdentity(request.userId)
    const relationship = await this.deps.identityService.getRelationship(request.userId, request.sourceEvent?.senderId ?? request.userId)
    return this.deps.assistService.suggestReplies({ request, identity, relationship })
  }

  async handleMessage(event: MessageEvent) {
    await this.deps.memoryService.recordIncoming(event)
    const context = await this.buildContext(event)
    const draft = await this.runAgent(context)
    const decision = await this.deps.policyEngine.evaluate({
      event,
      draft,
      relationship: context.relationship,
    })

    if (decision.action === 'BLOCK') {
      return { decision, draft, approval: undefined }
    }

    if (decision.action === 'AUTO_SEND') {
      const command = {
        channel: event.channel,
        accountId: event.accountId,
        userId: event.userId,
        threadId: event.threadId,
        text: draft.response,
      }
      await this.deps.adapterRegistry.send(command)
      await this.deps.memoryService.recordOutgoing(command)
      return { decision, draft, approval: undefined }
    }

    const approval = await this.deps.approvalStore.createApproval({ event, draft })
    return { decision, draft, approval }
  }

  get approvalStore(): ApprovalStore {
    return this.deps.approvalStore
  }

  async buildContextForEvent(event: MessageEvent): Promise<ContextBundle> {
    return buildContextBundle(
      { identityService: this.deps.identityService, memoryService: this.deps.memoryService },
      event,
    )
  }

  private async buildContext(event: MessageEvent): Promise<ContextBundle> {
    return this.buildContextForEvent(event)
  }

  private async runAgent(context: ContextBundle): Promise<DelegateDraft> {
    return runCognitivePipeline(context)
  }
}

export const createInMemoryRuntime = (): DelegateRuntime => new DelegateRuntime({
  identityService: new InMemoryIdentityService(),
  memoryService: new InMemoryMemoryService(),
  approvalStore: new InMemoryApprovalStore(),
  policyEngine: new DefaultPolicyEngine(),
  adapterRegistry: new AdapterRegistry(),
  assistService: new AssistService(),
})
