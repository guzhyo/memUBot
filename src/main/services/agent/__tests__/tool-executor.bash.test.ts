import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../tools/computer.executor', () => ({
  executeComputerTool: vi.fn(),
  executeBashTool: vi.fn(),
  executeTextEditorTool: vi.fn(),
  executeDownloadFileTool: vi.fn(),
  executeWebSearchTool: vi.fn(),
}))

vi.mock('../../../tools/macos/definitions', () => ({
  isMacOS: () => false,
}))

vi.mock('../../../tools/macos/executor', () => ({
  executeMacOSLaunchAppTool: vi.fn(),
  executeMacOSMailTool: vi.fn(),
  executeMacOSCalendarTool: vi.fn(),
  executeMacOSContactsTool: vi.fn(),
}))

vi.mock('../../../tools/macos/visual.executor', () => ({
  executeMacOSShowTool: vi.fn(),
  executeMacOSCloseTool: vi.fn(),
}))

vi.mock('../../../tools/telegram.executor', () => ({ executeTelegramTool: vi.fn() }))
vi.mock('../../../tools/discord.executor', () => ({ executeDiscordTool: vi.fn() }))
vi.mock('../../../tools/whatsapp.executor', () => ({ executeWhatsAppTool: vi.fn() }))
vi.mock('../../../tools/slack.executor', () => ({ executeSlackTool: vi.fn() }))
vi.mock('../../../tools/line.executor', () => ({ executeLineTool: vi.fn() }))
vi.mock('../../../tools/feishu.executor', () => ({ executeFeishuTool: vi.fn() }))
vi.mock('../../../tools/service.executor', () => ({ executeServiceTool: vi.fn() }))
vi.mock('../../../tools/memu.executor', () => ({ executeMemuTool: vi.fn() }))

vi.mock('../../bash-tool-access', () => ({
  getBashToolAccessDecision: vi.fn(),
}))

vi.mock('../../mcp.service', () => ({
  mcpService: {
    isMcpTool: vi.fn(() => false),
    executeTool: vi.fn(),
  },
}))

import { executeBashTool, executeWebSearchTool } from '../../../tools/computer.executor'
import { getBashToolAccessDecision } from '../../bash-tool-access'
import { executeTool } from '../tool-executor'
import type { ToolExecutionContext } from '../types'

const mockedExecuteBashTool = vi.mocked(executeBashTool)
const mockedExecuteWebSearchTool = vi.mocked(executeWebSearchTool)
const mockedGetBashToolAccessDecision = vi.mocked(getBashToolAccessDecision)

const messageContext: ToolExecutionContext = {
  platform: 'telegram',
  source: 'message',
  userId: '123456',
}

describe('agent tool executor bash access control', () => {
  beforeEach(() => {
    mockedExecuteBashTool.mockReset()
    mockedExecuteWebSearchTool.mockReset()
    mockedGetBashToolAccessDecision.mockReset()
  })

  it('blocks bash execution when access is denied', async () => {
    mockedGetBashToolAccessDecision.mockResolvedValue({
      allowed: false,
      reason: 'Bash tool is disabled',
    })

    const result = await executeTool('bash', { command: 'pwd' }, 'telegram', messageContext)

    expect(result).toEqual({
      success: false,
      error: 'Bash tool is disabled',
    })
    expect(mockedExecuteBashTool).not.toHaveBeenCalled()
  })

  it('allows bash execution when access is granted', async () => {
    mockedGetBashToolAccessDecision.mockResolvedValue({ allowed: true })
    mockedExecuteBashTool.mockResolvedValue({ success: true, data: 'ok' })

    const result = await executeTool('bash', { command: 'pwd' }, 'telegram', messageContext)

    expect(mockedExecuteBashTool).toHaveBeenCalledWith({ command: 'pwd' })
    expect(result).toEqual({ success: true, data: 'ok' })
  })

  it('does not affect non-bash tools', async () => {
    mockedExecuteWebSearchTool.mockResolvedValue({
      success: true,
      data: { query: 'memu', resultCount: 1 },
    })

    const result = await executeTool('web_search', { query: 'memu' }, 'telegram', messageContext)

    expect(mockedGetBashToolAccessDecision).not.toHaveBeenCalled()
    expect(mockedExecuteWebSearchTool).toHaveBeenCalledWith({ query: 'memu' })
    expect(result).toEqual({
      success: true,
      data: { query: 'memu', resultCount: 1 },
    })
  })
})
