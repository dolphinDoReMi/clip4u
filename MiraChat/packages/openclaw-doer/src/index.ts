import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

export interface OpenClawDoerConfig {
  openclawDir: string
  openclawEntry: string
  nodeBin: string
  defaultAgentId?: string
  defaultSessionId?: string
  defaultTo?: string
  defaultTimeoutSeconds: number
}

export interface OpenClawDoerRunInput {
  task: string
  agentId?: string
  sessionId?: string
  to?: string
  thinking?: string
  timeoutSeconds?: number
  deliver?: boolean
  channel?: string
  replyTo?: string
  replyChannel?: string
  replyAccount?: string
}

export interface OpenClawDoerPayload {
  text?: string
  mediaUrl?: string | null
  mediaUrls?: string[]
}

export interface OpenClawDoerRunResult {
  ok: true
  cwd: string
  command: string[]
  selector: {
    agentId?: string
    sessionId?: string
    to?: string
  }
  stdout: string
  stderr: string
  summary: string
  payloads: OpenClawDoerPayload[]
  raw: unknown
}

export interface OpenClawDoer {
  getConfig(): OpenClawDoerConfig
  run(input: OpenClawDoerRunInput): Promise<OpenClawDoerRunResult>
}

type SpawnLike = typeof spawn

const trimOptional = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

const readPositiveInt = (value: unknown, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`OpenClaw doer returned invalid JSON: ${detail}`)
  }
}

const summarizePayloads = (payloads: OpenClawDoerPayload[]): string =>
  payloads
    .map(payload => payload.text?.trim())
    .filter((value): value is string => Boolean(value))
    .join('\n\n')

const parseNodeSemver = (value: string): { major: number; minor: number; patch: number } | null => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim())
  if (!match) {
    return null
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

const isSupportedNodeVersion = (value: string): boolean => {
  const parsed = parseNodeSemver(value)
  if (!parsed) {
    return false
  }
  return parsed.major > 22 || (parsed.major === 22 && parsed.minor >= 12)
}

const detectPreferredNodeBin = (): string => {
  if (isSupportedNodeVersion(process.version)) {
    return process.execPath
  }

  const home = trimOptional(process.env.HOME)
  if (!home) {
    return 'node'
  }

  const versionsDir = path.join(home, '.nvm', 'versions', 'node')
  if (!existsSync(versionsDir)) {
    return 'node'
  }

  const candidates = readdirSync(versionsDir)
    .map(dirName => ({
      dirName,
      parsed: parseNodeSemver(dirName),
    }))
    .filter(
      (entry): entry is { dirName: string; parsed: { major: number; minor: number; patch: number } } =>
        Boolean(entry.parsed),
    )
    .filter(entry => isSupportedNodeVersion(entry.dirName))
    .sort((a, b) => {
      if (a.parsed.major !== b.parsed.major) return b.parsed.major - a.parsed.major
      if (a.parsed.minor !== b.parsed.minor) return b.parsed.minor - a.parsed.minor
      return b.parsed.patch - a.parsed.patch
    })

  const best = candidates[0]
  if (!best) {
    return 'node'
  }

  return path.join(versionsDir, best.dirName, 'bin', 'node')
}

const resolveConfig = (overrides: Partial<OpenClawDoerConfig> = {}): OpenClawDoerConfig => {
  const openclawDir =
    overrides.openclawDir ??
    trimOptional(process.env.MIRACHAT_OPENCLAW_DIR) ??
    '/home/dennis/openclaw'
  const openclawEntry =
    overrides.openclawEntry ??
    trimOptional(process.env.MIRACHAT_OPENCLAW_ENTRY) ??
    path.join(openclawDir, 'openclaw.mjs')
  return {
    openclawDir,
    openclawEntry,
    nodeBin:
      overrides.nodeBin ?? trimOptional(process.env.MIRACHAT_OPENCLAW_NODE_BIN) ?? detectPreferredNodeBin(),
    defaultAgentId:
      overrides.defaultAgentId ?? trimOptional(process.env.MIRACHAT_OPENCLAW_AGENT_ID),
    defaultSessionId:
      overrides.defaultSessionId ?? trimOptional(process.env.MIRACHAT_OPENCLAW_SESSION_ID),
    defaultTo:
      overrides.defaultTo ?? trimOptional(process.env.MIRACHAT_OPENCLAW_TO),
    defaultTimeoutSeconds: readPositiveInt(
      overrides.defaultTimeoutSeconds ?? process.env.MIRACHAT_OPENCLAW_TIMEOUT_SECONDS,
      600,
    ),
  }
}

const resolveSelector = (
  input: OpenClawDoerRunInput,
  config: OpenClawDoerConfig,
): { agentId?: string; sessionId?: string; to?: string } => {
  const selector = {
    agentId: trimOptional(input.agentId) ?? config.defaultAgentId,
    sessionId: trimOptional(input.sessionId) ?? config.defaultSessionId,
    to: trimOptional(input.to) ?? config.defaultTo,
  }
  if (!selector.agentId && !selector.sessionId && !selector.to) {
    throw new Error(
      'OpenClaw doer needs agentId, sessionId, or to (or set MIRACHAT_OPENCLAW_AGENT_ID / SESSION_ID / TO).',
    )
  }
  return selector
}

const runCommand = async (
  spawnImpl: SpawnLike,
  command: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> =>
  await new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { cwd, stdio: 'pipe' }) as ChildProcessWithoutNullStreams
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', code => {
      resolve({ stdout, stderr, exitCode: code ?? 0 })
    })
  })

export class OpenClawDoerClient implements OpenClawDoer {
  private readonly config: OpenClawDoerConfig

  constructor(config: Partial<OpenClawDoerConfig> = {}, private readonly spawnImpl: SpawnLike = spawn) {
    this.config = resolveConfig(config)
  }

  getConfig(): OpenClawDoerConfig {
    return this.config
  }

  async run(input: OpenClawDoerRunInput): Promise<OpenClawDoerRunResult> {
    const task = trimOptional(input.task)
    if (!task) {
      throw new Error('task is required')
    }

    const selector = resolveSelector(input, this.config)
    const timeoutSeconds = readPositiveInt(input.timeoutSeconds, this.config.defaultTimeoutSeconds)
    const args = [
      this.config.openclawEntry,
      'agent',
      '--message',
      task,
      '--json',
      '--timeout',
      String(timeoutSeconds),
    ]

    if (selector.agentId) {
      args.push('--agent', selector.agentId)
    }
    if (selector.sessionId) {
      args.push('--session-id', selector.sessionId)
    }
    if (selector.to) {
      args.push('--to', selector.to)
    }

    const thinking = trimOptional(input.thinking)
    if (thinking) {
      args.push('--thinking', thinking)
    }
    if (input.deliver === true) {
      args.push('--deliver')
    }

    const channel = trimOptional(input.channel)
    if (channel) {
      args.push('--channel', channel)
    }
    const replyTo = trimOptional(input.replyTo)
    if (replyTo) {
      args.push('--reply-to', replyTo)
    }
    const replyChannel = trimOptional(input.replyChannel)
    if (replyChannel) {
      args.push('--reply-channel', replyChannel)
    }
    const replyAccount = trimOptional(input.replyAccount)
    if (replyAccount) {
      args.push('--reply-account', replyAccount)
    }
    const { stdout, stderr, exitCode } = await runCommand(
      this.spawnImpl,
      this.config.nodeBin,
      args,
      this.config.openclawDir,
    )

    if (exitCode !== 0) {
      const detail = stderr.trim() || stdout.trim() || `exit ${exitCode}`
      throw new Error(`OpenClaw doer failed: ${detail}`)
    }

    const raw = parseJson(stdout.trim())
    const payloads =
      typeof raw === 'object' &&
      raw !== null &&
      'result' in raw &&
      typeof raw.result === 'object' &&
      raw.result !== null &&
      'payloads' in raw.result &&
      Array.isArray(raw.result.payloads)
        ? (raw.result.payloads as OpenClawDoerPayload[])
        : []

    return {
      ok: true,
      cwd: this.config.openclawDir,
      command: [this.config.nodeBin, ...args],
      selector,
      stdout,
      stderr,
      summary: summarizePayloads(payloads),
      payloads,
      raw,
    }
  }
}

export const createOpenClawDoer = (
  config: Partial<OpenClawDoerConfig> = {},
  spawnImpl?: SpawnLike,
): OpenClawDoer =>
  new OpenClawDoerClient(config, spawnImpl)
