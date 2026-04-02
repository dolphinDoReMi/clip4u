import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import pkg from 'whatsapp-web.js'

const { Client, LocalAuth } = pkg

function printUsage() {
  console.log(`Usage:
  MiraChat/scripts/whatsapp-send-once.sh --target TARGET --text TEXT [--session SESSION_NAME] [--browser BROWSER_PATH]
`)
}

function parseArgs(argv) {
  const options = {
    browser: '',
    session: 'cursor-whatsapp-send',
    target: '',
    text: '',
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
      case '--target':
        options.target = value || ''
        i += 1
        break
      case '--text':
        options.text = value || ''
        i += 1
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

function normalize(text) {
  return (text || '').trim().toLowerCase()
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

async function resolveTarget(client, targetName) {
  const matchesName = value =>
    normalize(value) === normalize(targetName)
    || normalize(value).includes(normalize(targetName))

  const chats = await client.getChats()
  const chat = chats.find(item => matchesName(item.name))
  if (chat) {
    return {
      id: chat.id._serialized,
      label: chat.name,
      kind: 'chat',
    }
  }

  const contacts = await client.getContacts()
  const contact = contacts.find(item =>
    matchesName(item.name)
    || matchesName(item.pushname)
    || matchesName(item.shortName)
  )

  if (!contact) {
    return undefined
  }

  return {
    id: contact.id._serialized,
    label: contact.name || contact.pushname || contact.shortName || contact.id._serialized,
    kind: 'contact',
  }
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
  if (!options.target || !options.text) {
    console.error('Missing --target or --text.')
    printUsage()
    process.exit(1)
  }

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
      const target = await resolveTarget(client, options.target)
      if (!target) {
        console.error('TARGET_NOT_FOUND', options.target)
        await finish(1)
        return
      }

      console.log('TARGET_FOUND', target.kind, target.label, target.id)
      await client.sendMessage(target.id, options.text)
      console.log('MESSAGE_SENT', target.label, options.text)
      await finish(0)
    } catch (error) {
      console.error('SEND_FAIL', error)
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
