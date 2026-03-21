import * as os from 'node:os'
import * as path from 'node:path'

import { getSetting } from '../config/settings.config'
import { assertNoPathAliasEscape } from './path-alias-guards'
import type { BoundaryPathIntent } from './boundary-path'

/**
 * Central file-boundary guard used by both agent tool executors and IPC
 * file handlers. Reads the user-configurable boundary root from settings
 * (falls back to the user's home directory) and throws a
 * BoundaryEscapeError when the resolved path escapes it.
 *
 * Returns the resolved absolute path for convenience.
 */
export async function guardFileBoundary(
  filePath: string,
  intent: BoundaryPathIntent
): Promise<string> {
  const customRoot = await getSetting('fileAccessBoundaryRoot')
  const rootPath = customRoot || os.homedir()

  let absolutePath: string
  if (filePath.startsWith('~')) {
    absolutePath = path.resolve(filePath.replace(/^~/, os.homedir()))
  } else {
    absolutePath = path.resolve(filePath)
  }

  await assertNoPathAliasEscape({
    absolutePath,
    rootPath,
    intent,
    boundaryLabel: 'file access boundary',
    policy:
      intent === 'delete'
        ? { allowFinalSymlinkForUnlink: true }
        : undefined,
  })

  return absolutePath
}
