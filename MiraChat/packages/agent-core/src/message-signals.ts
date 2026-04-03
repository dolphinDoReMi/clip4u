/** Shared heuristics for inbound text salience (context bundling, OpenRouter prompts). */

const compact = (value: string): string => value.replace(/\s+/g, ' ').trim()

export const isSimpleAcknowledgement = (text: string): boolean =>
  /^\s*(thanks|thank you|got it|sounds good|ok|okay|noted)[.!]?\s*$/i.test(text)

export const isReferentialFollowUpText = (text: string): boolean => {
  const normalized = compact(text).toLowerCase()
  return /^(how about this|what about this|how about this one|what about this one|this one|this one\?|this\?|and this|how about that|what about that|that\?)$/.test(normalized)
}

/**
 * True when the latest inbound line carries little standalone meaning (short ping, ack, slash command).
 * Used to widen memory search and keep analysis-assist in the loop when primary OpenRouter draft is on.
 */
export const isLowSignalInboundText = (text: string): boolean => {
  const normalized = compact(text)
  if (!normalized) {
    return true
  }
  if (normalized.startsWith('/')) {
    return true
  }
  if (
    /^(thanks for the message|thanks for reaching out|got it|happy to coordinate this|thanks for the note)\b/i.test(
      normalized,
    )
  ) {
    return true
  }
  if (isSimpleAcknowledgement(normalized)) {
    return true
  }
  if (isReferentialFollowUpText(normalized)) {
    return true
  }
  const wordCount = normalized.split(/\s+/).length
  return wordCount < 3 && normalized.length < 18
}
