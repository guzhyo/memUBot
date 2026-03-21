import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../security.service', () => ({
  securityService: {
    isAuthorizedByStringId: vi.fn(),
  },
}))

vi.mock('../../config/settings.config', () => ({
  loadSettings: vi.fn(),
}))

import { getBashToolAccessDecision, evaluateBashToolAccess, type BashToolSettings } from '../bash-tool-access'
import { securityService } from '../security.service'
import type { ToolExecutionContext } from '../agent/types'

const mockedSecurityService = vi.mocked(securityService)

function createSettings(overrides: Partial<BashToolSettings> = {}): BashToolSettings {
  return {
    bashToolEnabled: true,
    bashToolRequireAuthorizedUser: true,
    bashToolAllowedPlatforms: ['telegram', 'discord', 'whatsapp', 'slack', 'line', 'feishu'],
    bashToolAllowedSources: ['message'],
    ...overrides,
  }
}

function createContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    platform: 'telegram',
    source: 'message',
    userId: '123456',
    ...overrides,
  }
}

describe('bash tool access control', () => {
  beforeEach(() => {
    mockedSecurityService.isAuthorizedByStringId.mockReset()
  })

  it('rejects any bash call when globally disabled', () => {
    const result = evaluateBashToolAccess(
      createSettings({ bashToolEnabled: false }),
      createContext(),
      true
    )

    expect(result).toEqual({
      allowed: false,
      reason: 'Bash tool is disabled',
    })
  })

  it('rejects unauthorized users when bash requires an authorized user', async () => {
    mockedSecurityService.isAuthorizedByStringId.mockResolvedValue(false)

    const result = await getBashToolAccessDecision(createContext(), createSettings())

    expect(result).toEqual({
      allowed: false,
      reason: 'Bash tool is not allowed for this user',
    })
  })

  it('allows authorized users on permitted platforms', async () => {
    mockedSecurityService.isAuthorizedByStringId.mockResolvedValue(true)

    const result = await getBashToolAccessDecision(
      createContext({ platform: 'discord', userId: '987654321' }),
      createSettings()
    )

    expect(result).toEqual({ allowed: true })
  })

  it('rejects calls from platforms outside the allow list', () => {
    const result = evaluateBashToolAccess(
      createSettings({ bashToolAllowedPlatforms: ['discord'] }),
      createContext(),
      true
    )

    expect(result).toEqual({
      allowed: false,
      reason: 'Bash tool is not allowed in this execution context',
    })
  })

  it('rejects platformless and proactive contexts by default', () => {
    const result = evaluateBashToolAccess(
      createSettings(),
      createContext({ platform: 'none', source: 'proactive', userId: undefined }),
      null
    )

    expect(result).toEqual({
      allowed: false,
      reason: 'Bash tool is not allowed in this execution context',
    })
  })
})
