import { loadSettings, type AppSettings } from '../config/settings.config'
import { securityService, type Platform } from './security.service'
import type { ToolExecutionContext } from './agent/types'

export type BashToolSettings = Pick<
  AppSettings,
  | 'bashToolEnabled'
  | 'bashToolRequireAuthorizedUser'
  | 'bashToolAllowedPlatforms'
  | 'bashToolAllowedSources'
>

export interface BashToolAccessDecision {
  allowed: boolean
  reason?: string
}

const BASH_DISABLED_MESSAGE = 'Bash tool is disabled'
const BASH_USER_DENIED_MESSAGE = 'Bash tool is not allowed for this user'
const BASH_CONTEXT_DENIED_MESSAGE = 'Bash tool is not allowed in this execution context'

function isBoundUserPlatform(platform: ToolExecutionContext['platform']): platform is Platform {
  return platform !== 'none'
}

async function resolveAuthorizedUser(context: ToolExecutionContext): Promise<boolean | null> {
  if (context.userId && isBoundUserPlatform(context.platform)) {
    return await securityService.isAuthorizedByStringId(context.userId, context.platform)
  }

  if (context.isAuthorizedUser !== undefined) {
    return context.isAuthorizedUser
  }

  return null
}

export function evaluateBashToolAccess(
  settings: BashToolSettings,
  context: ToolExecutionContext,
  isAuthorizedUser: boolean | null
): BashToolAccessDecision {
  if (!settings.bashToolEnabled) {
    return { allowed: false, reason: BASH_DISABLED_MESSAGE }
  }

  if (!settings.bashToolAllowedSources.includes(context.source)) {
    return { allowed: false, reason: BASH_CONTEXT_DENIED_MESSAGE }
  }

  if (!settings.bashToolAllowedPlatforms.includes(context.platform)) {
    return { allowed: false, reason: BASH_CONTEXT_DENIED_MESSAGE }
  }

  if (settings.bashToolRequireAuthorizedUser && isAuthorizedUser !== true) {
    return { allowed: false, reason: BASH_USER_DENIED_MESSAGE }
  }

  return { allowed: true }
}

export async function getBashToolAccessDecision(
  context: ToolExecutionContext,
  settingsOverride?: BashToolSettings
): Promise<BashToolAccessDecision> {
  const settings = settingsOverride ?? await loadSettings()
  const isAuthorizedUser = await resolveAuthorizedUser(context)
  return evaluateBashToolAccess(settings, context, isAuthorizedUser)
}
