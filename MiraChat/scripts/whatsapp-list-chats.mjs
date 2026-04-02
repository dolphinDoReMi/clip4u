import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import pkg from 'whatsapp-web.js'

const { Client, LocalAuth } = pkg

function printUsage() {
  console.log(`Usage:
  MiraChat/scripts/whatsapp-list-chats.sh [--session SESSION_NAME] [--browser BROWSER_PATH] [--limit N] [--json]
`)
}

function parseArgs(argv) {
  const options = {
    browser: '',
    json: false,
    limit: 0,
    session: 'cursor-whatsapp-send',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = argv[i + 1]

    switch (arg) {
      case '--browser':
        options.browser = value || ''
        i += 1
        break
      case '--session':
        options.session = value || options.session
        i += 1
        break
      case '--limit': {
        const n = Number.parseInt(value || '0', 10)
        options.limit = Number.isFinite(n) && n > 0 ? n : 0
        i += 1
        break
      }
      case '--json':
        options.json = true
        break
      case '--help':
      case '-h':
        return { help: true, options }
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return { help: false, options }
}

function resolveChromiumPath(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.CHROME_BIN,
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/chromium',
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return undefined
}

async function main() {
  let parsed
  try {
    parsed = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    printUsage()
    process.exit(1)
  }

  if (parsed.help) {
    printUsage()
    process.exit(0)
  }

  const { options } = parsed

  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const mirachatRoot = path.resolve(scriptDir, '..')
  const authDir = path.join(mirachatRoot, '.wwebjs_auth')
  await mkdir(authDir, { recursive: true })

  const browserPath = resolveChromiumPath(options.browser)
  if (!browserPath) {
    console.error('No Chromium executable found. Set --browser or CHROME_BIN.')
    process.exit(1)
  }

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: options.session,
      dataPath: authDir,
    }),
    puppeteer: {
      executablePath: browserPath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  })

  const finish = async code => {
    try {
      await client.destroy()
    } catch {}
    process.exit(code)
  }

  client.on('qr', qr => {
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qr)}`
    console.log('QR', url)
  })

  client.on('authenticated', () => {
    console.log('AUTHENTICATED')
  })

  client.on('auth_failure', error => {
    console.error('AUTH_FAILURE', error)
    void finish(1)
  })

  client.on('ready', async () => {
    console.log('READY')

    try {
      const chats = await client.getChats()
      const sorted = [...chats].sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }),
      )
      const limited = options.limit > 0 ? sorted.slice(0, options.limit) : sorted

      if (options.json) {
        console.log(
          JSON.stringify(
            limited.map(c => ({
              name: c.name || '',
              id: c.id._serialized,
              isGroup: Boolean(c.isGroup),
            })),
            null,
            2,
          ),
        )
      } else {
        console.log('CHAT_COUNT', sorted.length)
        if (options.limit > 0 && limited.length < sorted.length) {
          console.log('LIST_LIMIT', options.limit, '(sorted by name)')
        }
        for (const c of limited) {
          const name = c.name || ''
          const id = c.id._serialized
          const kind = c.isGroup ? 'group' : 'dm'
          console.log([kind, name, id].join('\t'))
        }
      }

      await finish(0)
    } catch (error) {
      console.error('LIST_FAIL', error)
      await finish(1)
    }
  })

  setTimeout(() => {
    console.error('TIMEOUT waiting for WhatsApp ready state')
    void finish(1)
  }, 180_000)

  try {
    await client.initialize()
  } catch (error) {
    console.error('INIT_FAIL', error)
    await finish(1)
  }
}

await main()
