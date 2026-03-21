import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'

import { isPathInside, isNotFoundPathError, shortenPath } from './path-guards'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BoundaryPathIntent = 'read' | 'write' | 'create' | 'delete' | 'stat'

export interface BoundaryPathAliasPolicy {
  allowFinalSymlinkForUnlink?: boolean
  allowFinalHardlinkForUnlink?: boolean
}

export interface ResolvedBoundaryPath {
  absolutePath: string
  canonicalPath: string
  rootPath: string
  rootCanonicalPath: string
  relativePath: string
  exists: boolean
  kind: 'missing' | 'file' | 'directory' | 'symlink' | 'other'
}

export interface ResolveBoundaryPathParams {
  absolutePath: string
  rootPath: string
  intent: BoundaryPathIntent
  boundaryLabel: string
  policy?: BoundaryPathAliasPolicy
}

// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------

class BoundaryEscapeError extends Error {
  constructor(label: string, detail: string) {
    super(`${detail} escapes ${label}`)
    this.name = 'BoundaryEscapeError'
  }
}

function throwEscape(label: string, kind: string, targetPath: string): never {
  throw new BoundaryEscapeError(label, `${kind} at ${shortenPath(targetPath)}`)
}

// ---------------------------------------------------------------------------
// resolvePathViaExistingAncestor
// ---------------------------------------------------------------------------

/**
 * For a path that may not fully exist, walk upward to the nearest existing
 * ancestor, resolve it via realpath, then re-append the missing tail segments.
 */
async function resolvePathViaExistingAncestor(targetPath: string): Promise<string> {
  const missing: string[] = []
  let cursor = targetPath
  for (;;) {
    try {
      const real = await fsp.realpath(cursor)
      return missing.reduceRight((acc, seg) => path.join(acc, seg), real)
    } catch (err: unknown) {
      if (!isNotFoundPathError(err)) throw err
      missing.push(path.basename(cursor))
      const parent = path.dirname(cursor)
      if (parent === cursor) return targetPath
      cursor = parent
    }
  }
}

function resolvePathViaExistingAncestorSync(targetPath: string): string {
  const missing: string[] = []
  let cursor = targetPath
  for (;;) {
    try {
      const real = fs.realpathSync(cursor)
      return missing.reduceRight((acc, seg) => path.join(acc, seg), real)
    } catch (err: unknown) {
      if (!isNotFoundPathError(err)) throw err
      missing.push(path.basename(cursor))
      const parent = path.dirname(cursor)
      if (parent === cursor) return targetPath
      cursor = parent
    }
  }
}

// ---------------------------------------------------------------------------
// Kind helper
// ---------------------------------------------------------------------------

function statsToKind(stats: fs.Stats): ResolvedBoundaryPath['kind'] {
  if (stats.isSymbolicLink()) return 'symlink'
  if (stats.isFile()) return 'file'
  if (stats.isDirectory()) return 'directory'
  return 'other'
}

// ---------------------------------------------------------------------------
// Core algorithm (async)
// ---------------------------------------------------------------------------

export async function resolveBoundaryPath(
  params: ResolveBoundaryPathParams
): Promise<ResolvedBoundaryPath> {
  const { absolutePath, rootPath, boundaryLabel, policy } = params

  // --- Step 1: lexical fast-path ---
  const lexicalOk = isPathInside(rootPath, absolutePath)

  // --- Step 2: canonical root ---
  let rootCanonical: string
  try {
    rootCanonical = await fsp.realpath(rootPath)
  } catch {
    rootCanonical = rootPath
  }

  // --- Step 3: if lexical check failed, try canonical ---
  if (!lexicalOk) {
    const targetCanonical = await resolvePathViaExistingAncestor(absolutePath)
    if (!isPathInside(rootCanonical, targetCanonical)) {
      throwEscape(boundaryLabel, 'Path', absolutePath)
    }
  }

  // --- Step 4: split into segments ---
  const relFromRoot = path.relative(rootPath, absolutePath)
  const segments = relFromRoot.split(path.sep).filter(Boolean)

  // --- Step 5: segment-by-segment walk ---
  let lexicalCursor = rootPath
  let canonicalCursor = rootCanonical
  let preserveFinalSymlink = false

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    lexicalCursor = path.join(lexicalCursor, segment)

    let stats: fs.Stats
    try {
      stats = await fsp.lstat(lexicalCursor)
    } catch (err: unknown) {
      if (isNotFoundPathError(err)) {
        // Append remaining segments and do a boundary check
        const remaining = segments.slice(i)
        const tail = remaining.join(path.sep)
        canonicalCursor = path.join(canonicalCursor, tail)

        if (!isPathInside(rootCanonical, canonicalCursor)) {
          throwEscape(boundaryLabel, 'Path', absolutePath)
        }

        return {
          absolutePath,
          canonicalPath: canonicalCursor,
          rootPath,
          rootCanonicalPath: rootCanonical,
          relativePath: path.relative(rootCanonical, canonicalCursor),
          exists: false,
          kind: 'missing',
        }
      }
      throw err
    }

    const isLastSegment = i === segments.length - 1

    if (stats.isSymbolicLink()) {
      if (isLastSegment && policy?.allowFinalSymlinkForUnlink) {
        preserveFinalSymlink = true
        canonicalCursor = path.join(canonicalCursor, segment)
        break
      }

      // Resolve the link and check if it stays inside the boundary
      const linkCanonical = await fsp.realpath(lexicalCursor)
      if (!isPathInside(rootCanonical, linkCanonical)) {
        throwEscape(boundaryLabel, `Symlink at ${shortenPath(lexicalCursor)}`, absolutePath)
      }
      canonicalCursor = linkCanonical
    } else {
      canonicalCursor = path.resolve(canonicalCursor, segment)
      if (!isPathInside(rootCanonical, canonicalCursor)) {
        throwEscape(boundaryLabel, 'Path', absolutePath)
      }
    }
  }

  // --- Step 6: final boundary check ---
  if (!isPathInside(rootCanonical, canonicalCursor)) {
    throwEscape(boundaryLabel, 'Path', absolutePath)
  }

  // Determine kind
  let kind: ResolvedBoundaryPath['kind']
  let exists: boolean
  if (preserveFinalSymlink) {
    kind = 'symlink'
    exists = true
  } else {
    try {
      const finalStats = await fsp.lstat(absolutePath)
      kind = statsToKind(finalStats)
      exists = true
    } catch (err: unknown) {
      if (isNotFoundPathError(err)) {
        kind = 'missing'
        exists = false
      } else {
        throw err
      }
    }
  }

  return {
    absolutePath,
    canonicalPath: canonicalCursor,
    rootPath,
    rootCanonicalPath: rootCanonical,
    relativePath: path.relative(rootCanonical, canonicalCursor),
    exists,
    kind,
  }
}

// ---------------------------------------------------------------------------
// Core algorithm (sync)
// ---------------------------------------------------------------------------

export function resolveBoundaryPathSync(
  params: ResolveBoundaryPathParams
): ResolvedBoundaryPath {
  const { absolutePath, rootPath, boundaryLabel, policy } = params

  const lexicalOk = isPathInside(rootPath, absolutePath)

  let rootCanonical: string
  try {
    rootCanonical = fs.realpathSync(rootPath)
  } catch {
    rootCanonical = rootPath
  }

  if (!lexicalOk) {
    const targetCanonical = resolvePathViaExistingAncestorSync(absolutePath)
    if (!isPathInside(rootCanonical, targetCanonical)) {
      throwEscape(boundaryLabel, 'Path', absolutePath)
    }
  }

  const relFromRoot = path.relative(rootPath, absolutePath)
  const segments = relFromRoot.split(path.sep).filter(Boolean)

  let lexicalCursor = rootPath
  let canonicalCursor = rootCanonical
  let preserveFinalSymlink = false

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    lexicalCursor = path.join(lexicalCursor, segment)

    let stats: fs.Stats
    try {
      stats = fs.lstatSync(lexicalCursor)
    } catch (err: unknown) {
      if (isNotFoundPathError(err)) {
        const remaining = segments.slice(i)
        const tail = remaining.join(path.sep)
        canonicalCursor = path.join(canonicalCursor, tail)

        if (!isPathInside(rootCanonical, canonicalCursor)) {
          throwEscape(boundaryLabel, 'Path', absolutePath)
        }

        return {
          absolutePath,
          canonicalPath: canonicalCursor,
          rootPath,
          rootCanonicalPath: rootCanonical,
          relativePath: path.relative(rootCanonical, canonicalCursor),
          exists: false,
          kind: 'missing',
        }
      }
      throw err
    }

    const isLastSegment = i === segments.length - 1

    if (stats.isSymbolicLink()) {
      if (isLastSegment && policy?.allowFinalSymlinkForUnlink) {
        preserveFinalSymlink = true
        canonicalCursor = path.join(canonicalCursor, segment)
        break
      }

      const linkCanonical = fs.realpathSync(lexicalCursor)
      if (!isPathInside(rootCanonical, linkCanonical)) {
        throwEscape(boundaryLabel, `Symlink at ${shortenPath(lexicalCursor)}`, absolutePath)
      }
      canonicalCursor = linkCanonical
    } else {
      canonicalCursor = path.resolve(canonicalCursor, segment)
      if (!isPathInside(rootCanonical, canonicalCursor)) {
        throwEscape(boundaryLabel, 'Path', absolutePath)
      }
    }
  }

  if (!isPathInside(rootCanonical, canonicalCursor)) {
    throwEscape(boundaryLabel, 'Path', absolutePath)
  }

  let kind: ResolvedBoundaryPath['kind']
  let exists: boolean
  if (preserveFinalSymlink) {
    kind = 'symlink'
    exists = true
  } else {
    try {
      const finalStats = fs.lstatSync(absolutePath)
      kind = statsToKind(finalStats)
      exists = true
    } catch (err: unknown) {
      if (isNotFoundPathError(err)) {
        kind = 'missing'
        exists = false
      } else {
        throw err
      }
    }
  }

  return {
    absolutePath,
    canonicalPath: canonicalCursor,
    rootPath,
    rootCanonicalPath: rootCanonical,
    relativePath: path.relative(rootCanonical, canonicalCursor),
    exists,
    kind,
  }
}
