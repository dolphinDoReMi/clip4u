import type { Window } from '@nut-tree-fork/nut-js'

/** nut.js entry (dynamic import so default `npm test` never loads native libnut). */
export type NutModule = typeof import('@nut-tree-fork/nut-js')

export async function findWindowByTitlePattern(
  nut: NutModule,
  pattern: RegExp,
): Promise<Window | null> {
  const wins = await nut.getWindows()
  for (const w of wins) {
    if (pattern.test(await w.title)) return w
  }
  return null
}

export async function focusWeChatWindow(
  nut: NutModule,
  titlePattern: RegExp,
): Promise<Window> {
  const w = await findWindowByTitlePattern(nut, titlePattern)
  if (!w) {
    throw new Error(
      `No window title matched ${titlePattern}. Open WeChat (desktop) and adjust WECHAT_WINDOW_TITLE_REGEX if needed.`,
    )
  }
  await w.focus()
  await nut.sleep(350)
  return w
}

/** Default WeChat (Linux/Windows): open universal search / finder (Ctrl+F). */
export async function openWeChatSearchShortcut(nut: NutModule): Promise<void> {
  const { keyboard, Key, sleep } = nut
  await keyboard.pressKey(Key.LeftControl, Key.F)
  await keyboard.releaseKey(Key.LeftControl, Key.F)
  await sleep(450)
}

export async function typeAndMaybeSend(
  nut: NutModule,
  text: string,
  commitSend: boolean,
): Promise<void> {
  const { keyboard, Key, sleep } = nut
  await keyboard.type(text)
  await sleep(150)
  if (commitSend) {
    await keyboard.type(Key.Enter)
  }
}
