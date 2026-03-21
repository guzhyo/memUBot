import {
  resolveBoundaryPath,
  resolveBoundaryPathSync,
  type BoundaryPathIntent,
  type BoundaryPathAliasPolicy,
  type ResolvedBoundaryPath,
} from './boundary-path'
import {
  assertNoHardlinkedFinalPath,
  assertNoHardlinkedFinalPathSync,
} from './hardlink-guards'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssertNoPathAliasEscapeParams {
  absolutePath: string
  rootPath: string
  intent: BoundaryPathIntent
  boundaryLabel: string
  policy?: BoundaryPathAliasPolicy
}

// ---------------------------------------------------------------------------
// Async
// ---------------------------------------------------------------------------

export async function assertNoPathAliasEscape(
  params: AssertNoPathAliasEscapeParams
): Promise<ResolvedBoundaryPath> {
  const resolved = await resolveBoundaryPath(params)

  if (params.policy?.allowFinalSymlinkForUnlink && resolved.kind === 'symlink') {
    return resolved
  }

  await assertNoHardlinkedFinalPath({
    absolutePath: params.absolutePath,
    boundaryLabel: params.boundaryLabel,
    resolvedPath: resolved,
    policy: params.policy,
  })

  return resolved
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export function assertNoPathAliasEscapeSync(
  params: AssertNoPathAliasEscapeParams
): ResolvedBoundaryPath {
  const resolved = resolveBoundaryPathSync(params)

  if (params.policy?.allowFinalSymlinkForUnlink && resolved.kind === 'symlink') {
    return resolved
  }

  assertNoHardlinkedFinalPathSync({
    absolutePath: params.absolutePath,
    boundaryLabel: params.boundaryLabel,
    resolvedPath: resolved,
    policy: params.policy,
  })

  return resolved
}
