import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'

import { isNotFoundPathError, shortenPath } from './path-guards'
import type { ResolvedBoundaryPath, BoundaryPathAliasPolicy } from './boundary-path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssertNoHardlinkParams {
  absolutePath: string
  boundaryLabel: string
  resolvedPath: ResolvedBoundaryPath
  policy?: BoundaryPathAliasPolicy
}

// ---------------------------------------------------------------------------
// Async
// ---------------------------------------------------------------------------

export async function assertNoHardlinkedFinalPath(
  params: AssertNoHardlinkParams
): Promise<void> {
  const { absolutePath, boundaryLabel, resolvedPath, policy } = params

  if (policy?.allowFinalHardlinkForUnlink) return

  if (!resolvedPath.exists) return

  try {
    const stats = await fsp.stat(absolutePath)
    if (stats.isFile() && stats.nlink > 1) {
      throw new Error(
        `Hard-linked file at ${shortenPath(absolutePath)} escapes ${boundaryLabel} ` +
          `(nlink=${stats.nlink})`
      )
    }
  } catch (err: unknown) {
    if (isNotFoundPathError(err)) return
    throw err
  }
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export function assertNoHardlinkedFinalPathSync(
  params: AssertNoHardlinkParams
): void {
  const { absolutePath, boundaryLabel, resolvedPath, policy } = params

  if (policy?.allowFinalHardlinkForUnlink) return

  if (!resolvedPath.exists) return

  try {
    const stats = fs.statSync(absolutePath)
    if (stats.isFile() && stats.nlink > 1) {
      throw new Error(
        `Hard-linked file at ${shortenPath(absolutePath)} escapes ${boundaryLabel} ` +
          `(nlink=${stats.nlink})`
      )
    }
  } catch (err: unknown) {
    if (isNotFoundPathError(err)) return
    throw err
  }
}
