import { spawnSync } from 'node:child_process'

function runXprop(args) {
  const res = spawnSync('xprop', args, { encoding: 'utf8' })
  if (res.error || res.status !== 0) return null
  return res.stdout || ''
}

function firstQuotedValue(line) {
  const m = /"([^"]*)"/.exec(line)
  return m ? m[1] : null
}

function quotedValues(line) {
  return Array.from(line.matchAll(/"([^"]*)"/g), (m) => m[1]).filter(Boolean)
}

export function parseActiveWindowId(output) {
  const m = /window id # (0x[0-9a-f]+)/i.exec(output || '')
  if (!m || m[1] === '0x0') return null
  return m[1]
}

export function parseClientWindowIds(output) {
  return Array.from(new Set(Array.from((output || '').matchAll(/0x[0-9a-f]+/gi), (m) => m[0].toLowerCase())))
}

export function parseXpropWindowDetails(output) {
  const meta = {
    wmClass: [],
    wmName: null,
    netWmName: null,
    pid: null,
  }

  for (const line of String(output || '').split('\n')) {
    if (line.startsWith('WM_CLASS(')) meta.wmClass = quotedValues(line)
    else if (line.startsWith('WM_NAME(')) meta.wmName = firstQuotedValue(line)
    else if (line.startsWith('_NET_WM_NAME(')) meta.netWmName = firstQuotedValue(line)
    else if (line.startsWith('_NET_WM_PID(')) {
      const m = /=\s*(\d+)/.exec(line)
      meta.pid = m ? Number(m[1]) : null
    }
  }

  return meta
}

export function buildWindowSearchText(meta) {
  return [
    meta.id,
    ...(meta.wmClass || []),
    meta.wmName,
    meta.netWmName,
    meta.pid == null ? null : String(meta.pid),
  ]
    .filter(Boolean)
    .join(' ')
}

export function windowSummary(meta) {
  if (!meta) return '(no active X11 window)'
  const parts = []
  if (meta.id) parts.push(`id=${meta.id}`)
  if (meta.wmClass?.length) parts.push(`class=${meta.wmClass.join('/')}`)
  const name = meta.netWmName || meta.wmName
  if (name) parts.push(`name=${JSON.stringify(name)}`)
  if (meta.pid != null) parts.push(`pid=${meta.pid}`)
  return parts.join(' ') || '(active window metadata unavailable)'
}

export function windowMatches(meta, pattern) {
  if (!meta) return false
  return pattern.test(buildWindowSearchText(meta))
}

export function getX11WindowById(id) {
  if (!id || !process.env.DISPLAY?.trim()) return null
  const details = runXprop(['-id', id, 'WM_CLASS', 'WM_NAME', '_NET_WM_NAME', '_NET_WM_PID'])
  if (!details) return null
  return { id, ...parseXpropWindowDetails(details) }
}

export function getActiveX11Window() {
  if (process.platform !== 'linux' || !process.env.DISPLAY?.trim()) return null
  const root = runXprop(['-root', '_NET_ACTIVE_WINDOW'])
  const id = parseActiveWindowId(root)
  return id ? getX11WindowById(id) : null
}

export function listX11ClientWindows(limit = 10) {
  if (process.platform !== 'linux' || !process.env.DISPLAY?.trim()) return []
  const root = runXprop(['-root', '_NET_CLIENT_LIST'])
  const ids = parseClientWindowIds(root).slice(0, limit)
  return ids.map((id) => getX11WindowById(id)).filter(Boolean)
}
