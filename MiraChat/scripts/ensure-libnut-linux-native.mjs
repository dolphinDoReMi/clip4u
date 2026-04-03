#!/usr/bin/env node
/**
 * @nut-tree-fork/libnut-linux publishes a prebuilt x86-64 `libnut.node` only.
 * On Linux arm64, `dlopen` fails unless we swap in a native build.
 *
 * After `npm install`, this script builds [nut-tree/libnut-core](https://github.com/nut-tree/libnut-core)
 * (tag pinned below) with cmake-js when the on-disk `.node` does not match `process.arch`.
 *
 * - Cache: `~/.cache/mirachat-libnut/<arch>-napi-<modules>/libnut.node`
 * - Opt out: `MIRACHAT_SKIP_LIBNUT_REBUILD=1` or `SKIP_LIBNUT_REBUILD=1`
 * - CI: skipped when `CI=true` unless `MIRACHAT_LIBNUT_REBUILD_IN_CI=1` (no desktop e2e in default workflows).
 * - Clear cache + retry: `MIRACHAT_CLEAR_LIBNUT_CACHE=1` (use with `npm run rebuild:libnut`).
 * - Build deps (Debian/Ubuntu): `git`, `cmake`, `g++`, plus X11 dev libs used by libnut
 *   (`libxtst-dev`, `libx11-dev`, `libpng-dev`, … — see libnut-core CMakeLists).
 * - Fail install on error: `MIRACHAT_STRICT_LIBNUT=1` (default: warn and exit 0)
 */
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const libnutPath = join(root, 'node_modules/@nut-tree-fork/libnut-linux/build/Release/libnut.node')
/** Matches @nut-tree-fork/libnut-linux@2.7.x lineage shipped by @nut-tree-fork/nut-js@4.2.x */
const LIBNUT_CORE_TAG = 'v2.7.1'

const strict = process.env.MIRACHAT_STRICT_LIBNUT === '1'
const skip =
  process.env.MIRACHAT_SKIP_LIBNUT_REBUILD === '1' || process.env.SKIP_LIBNUT_REBUILD === '1'

function done(code) {
  process.exit(code)
}

function warnOrBail(msg) {
  console.warn('[mirachat libnut]', msg)
  done(strict ? 1 : 0)
}

function elfDescription(p) {
  try {
    return execSync(`file -b "${p}"`, { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function matchesHostArch(description, hostArch) {
  if (hostArch === 'arm64') return description.includes('aarch64') || description.includes('ARM aarch64')
  if (hostArch === 'x64') return description.includes('x86-64')
  return false
}

function main() {
  if (skip || process.platform !== 'linux') return
  if (process.env.CI === 'true' && process.env.MIRACHAT_LIBNUT_REBUILD_IN_CI !== '1') return
  if (process.env.MIRACHAT_CLEAR_LIBNUT_CACHE === '1') {
    const d = join(homedir(), '.cache', 'mirachat-libnut')
    if (existsSync(d)) rmSync(d, { recursive: true, force: true })
  }
  if (!existsSync(libnutPath)) return

  const desc = elfDescription(libnutPath)
  if (matchesHostArch(desc, process.arch)) return

  if (process.arch !== 'arm64') {
    warnOrBail(
      `Bundled libnut (${desc}) does not match host ${process.arch}; automatic rebuild is only implemented for arm64.`,
    )
    return
  }

  const cacheBase = join(homedir(), '.cache', 'mirachat-libnut', `${process.arch}-napi-${process.versions.modules}`)
  const cacheFile = join(cacheBase, 'libnut.node')
  mkdirSync(cacheBase, { recursive: true })

  if (existsSync(cacheFile) && matchesHostArch(elfDescription(cacheFile), process.arch)) {
    copyFileSync(cacheFile, libnutPath)
    console.log('[mirachat libnut] Installed arm64 libnut.node from cache.')
    return
  }

  let tmp
  try {
    tmp = mkdtempSync(join(tmpdir(), 'mirachat-libnut-'))
    const cloneDir = join(tmp, 'libnut-core')
    execSync(
      `git clone --depth 1 --branch ${LIBNUT_CORE_TAG} https://github.com/nut-tree/libnut-core.git "${cloneDir}"`,
      { stdio: 'inherit' },
    )
    execSync('npm install', { cwd: cloneDir, stdio: 'inherit' })
    execSync('npx cmake-js rebuild', { cwd: cloneDir, stdio: 'inherit' })
    const built = join(cloneDir, 'build/Release/libnut.node')
    if (!existsSync(built)) {
      warnOrBail('cmake-js rebuild did not produce build/Release/libnut.node')
      return
    }
    if (!matchesHostArch(elfDescription(built), process.arch)) {
      warnOrBail(`Built binary arch mismatch: ${elfDescription(built)}`)
      return
    }
    copyFileSync(built, libnutPath)
    copyFileSync(built, cacheFile)
    console.log('[mirachat libnut] Built and installed arm64 libnut.node for @nut-tree-fork/libnut-linux.')
  } catch (e) {
    warnOrBail(`Could not rebuild libnut for arm64: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true })
  }
}

main()
