import * as path from 'node:path'
import * as os from 'node:os'

/**
 * Strip Windows extended-length path prefix (\\?\) and normalize UNC paths.
 */
function stripWin32Prefix(p: string): string {
  if (p.startsWith('\\\\?\\UNC\\')) {
    return '\\\\' + p.slice(8)
  }
  if (p.startsWith('\\\\?\\')) {
    return p.slice(4)
  }
  return p
}

/**
 * Determine whether `target` is located inside (or equal to) `root`.
 * Pure lexical check — no I/O. On win32 the comparison is case-insensitive
 * and \\?\ / UNC prefixes are stripped before comparison.
 */
export function isPathInside(root: string, target: string): boolean {
  let resolvedRoot = path.resolve(root)
  let resolvedTarget = path.resolve(target)

  if (process.platform === 'win32') {
    resolvedRoot = stripWin32Prefix(resolvedRoot).toLowerCase()
    resolvedTarget = stripWin32Prefix(resolvedTarget).toLowerCase()
  }

  if (resolvedTarget === resolvedRoot) return true

  const rel = path.relative(resolvedRoot, resolvedTarget)
  if (rel === '') return true
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}

interface NodeErrnoLike {
  code?: string
}

/**
 * Return true when `err` is an ENOENT or ENOTDIR filesystem error —
 * the two codes that indicate "path does not exist".
 */
export function isNotFoundPathError(err: unknown): boolean {
  if (err === null || err === undefined) return false
  if (typeof err !== 'object') return false
  const code = (err as NodeErrnoLike).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

const homeDir = os.homedir()

/**
 * Replace the leading homedir portion of a path with `~` for
 * friendlier error messages.
 */
export function shortenPath(p: string): string {
  if (homeDir && p.startsWith(homeDir)) {
    return '~' + p.slice(homeDir.length)
  }
  return p
}
