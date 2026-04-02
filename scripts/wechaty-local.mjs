import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { MemoryCard } from 'memory-card'

import { WechatyBuilder, ScanStatus } from '../src/mods/mod.js'

function printUsage() {
  console.log(`Usage:
  scripts/wechaty-local.sh watch [--bot BOT_NAME]
  scripts/wechaty-local.sh send (--room ROOM | --contact CONTACT) --text TEXT [--bot BOT_NAME]
`)
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {
    botName: 'mirachat-wechat',
    contact: '',
    room: '',
    text: '',
  }

  if (!command || command === '--help' || command === '-h') {
    return { command: 'help', options }
  }

  if (command !== 'watch' && command !== 'send') {
    throw new Error(`Unknown command: ${command}`)
  }

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    const value = rest[i + 1]

    switch (arg) {
      case '--bot':
        options.botName = value || options.botName
        i += 1
        break
      case '--contact':
        options.contact = value || ''
        i += 1
        break
      case '--room':
        options.room = value || ''
        i += 1
        break
      case '--text':
        options.text = value || ''
        i += 1
        break
      case '--help':
      case '-h':
        return { command: 'help', options }
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return { command, options }
}

function getStateDir() {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, 'wechaty')
  }
  return path.join(os.homedir(), '.config', 'wechaty')
}

async function acquireLock(lockDir) {
  await mkdir(path.dirname(lockDir), { recursive: true })

  for (;;) {
    try {
      await mkdir(lockDir)
      await writeFile(path.join(lockDir, 'pid'), `${process.pid}\n`, 'utf8')
      return async () => {
        await rm(lockDir, { recursive: true, force: true })
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error
      }

      const pidFile = path.join(lockDir, 'pid')
      let stale = true

      try {
        const pidText = await readFile(pidFile, 'utf8')
        const pid = Number.parseInt(pidText.trim(), 10)
        if (Number.isInteger(pid) && pid > 0) {
          process.kill(pid, 0)
          stale = false
        }
      } catch {
        stale = true
      }

      if (!stale) {
        throw new Error(`Another Wechaty process is already using lock ${lockDir}`)
      }

      await rm(lockDir, { recursive: true, force: true })
    }
  }
}

async function resolveRoom(bot, topic) {
  const exact = await bot.Room.find({ topic })
  if (exact) {
    return exact
  }

  const rooms = await bot.Room.findAll()
  for (const room of rooms) {
    try {
      const roomTopic = await room.topic()
      if (roomTopic.includes(topic)) {
        return room
      }
    } catch {}
  }

  return undefined
}

async function resolveContact(bot, contactQuery) {
  let contact = await bot.Contact.find({ name: contactQuery })
  if (contact) {
    return contact
  }

  contact = await bot.Contact.find({ alias: contactQuery })
  if (contact) {
    return contact
  }

  const contacts = await bot.Contact.findAll()
  for (const item of contacts) {
    try {
      await item.sync()
    } catch {}

    let alias = ''
    try {
      alias = (await item.alias()) || ''
    } catch {}

    const name = item.name() || ''
    if (name.includes(contactQuery) || alias.includes(contactQuery)) {
      return item
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

  const { command, options } = parsed

  if (!command || command === 'help') {
    printUsage()
    process.exit(command ? 0 : 1)
  }

  if (command === 'send' && !options.text) {
    console.error('Missing --text for send command.')
    printUsage()
    process.exit(1)
  }

  if (command === 'send' && !options.room && !options.contact) {
    console.error('Provide either --room or --contact for send command.')
    printUsage()
    process.exit(1)
  }

  const stateDir = getStateDir()
  const sessionBase = path.join(stateDir, options.botName)
  const lockDir = path.join(stateDir, `${options.botName}.lock`)
  const releaseLock = await acquireLock(lockDir)

  const cleanup = async () => {
    try {
      await releaseLock()
    } catch {}
  }

  process.on('exit', () => {
    void cleanup()
  })

  const memory = new MemoryCard({
    name: sessionBase,
    storageOptions: { type: 'file' },
  })
  await memory.load()

  const bot = WechatyBuilder.build({
    memory,
    name: options.botName,
  })

  const stopBot = async (code = 0) => {
    try {
      await bot.stop()
    } catch {}
    try {
      await memory.save()
    } catch {}
    await cleanup()
    process.exit(code)
  }

  process.once('SIGINT', () => {
    void stopBot(0)
  })
  process.once('SIGTERM', () => {
    void stopBot(0)
  })

  bot.on('scan', (qrcode, status) => {
    const url = `https://wechaty.js.org/qrcode/${encodeURIComponent(qrcode)}`
    console.log('SCAN', ScanStatus[status], status, url)
  })

  bot.on('login', async user => {
    console.log('LOGIN', user.name())

    if (command !== 'send') {
      return
    }

    try {
      if (options.room) {
        const room = await resolveRoom(bot, options.room)
        if (!room) {
          console.error('ROOM_NOT_FOUND', options.room)
          await stopBot(1)
          return
        }
        await room.say(options.text)
        console.log('MESSAGE_SENT', 'room', options.room, options.text)
        await stopBot(0)
        return
      }

      const contact = await resolveContact(bot, options.contact)
      if (!contact) {
        console.error('CONTACT_NOT_FOUND', options.contact)
        await stopBot(1)
        return
      }

      await contact.say(options.text)
      console.log('MESSAGE_SENT', 'contact', contact.name(), options.text)
      await stopBot(0)
    } catch (error) {
      console.error('SEND_FAIL', error)
      await stopBot(1)
    }
  })

  bot.on('logout', user => {
    console.log('LOGOUT', user.name())
  })

  bot.on('error', error => {
    console.error('BOT_ERROR', error)
  })

  if (command === 'watch') {
    bot.on('message', message => {
      console.log('MESSAGE', message.toString())
    })
    console.log('Starting Wechaty watch bot...')
  } else {
    console.log('Starting Wechaty send bot...')
    setTimeout(() => {
      console.error('TIMEOUT waiting for login')
      void stopBot(1)
    }, 120_000)
  }

  try {
    await bot.start()
  } catch (error) {
    console.error('START_FAIL', error)
    await stopBot(1)
  }
}

await main()
