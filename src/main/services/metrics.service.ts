import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { Trace } from './trace.service'

// ==================== Types ====================

export interface ToolMetrics {
  callCount: number
  errorCount: number
  totalDurationMs: number
  avgDurationMs: number
}

export interface LLMMetrics {
  callCount: number
  errorCount: number
  totalInputTokens: number
  totalOutputTokens: number
  totalDurationMs: number
  avgDurationMs: number
  p95DurationMs: number
}

export interface PlatformMetrics {
  received: number
  processed: number
  errors: number
}

export interface MetricsSnapshot {
  window: string                          // 快照生成时间 ISO 8601
  messageCount: number                    // 本窗口内处理的消息总数
  successCount: number
  errorCount: number
  avgDurationMs: number                   // 消息平均处理时长
  p95DurationMs: number                   // 消息 P95 处理时长
  llm: LLMMetrics
  tools: Record<string, ToolMetrics>
  platforms: Record<string, PlatformMetrics>
}

// ==================== Service ====================

class MetricsService {
  private intervalHandle: NodeJS.Timeout | null = null
  private metricsDir = ''
  private initialized = false

  // 当前窗口内收集的 trace（60s 后聚合一次）
  private windowTraces: Trace[] = []

  initialize(): void {
    if (this.initialized) return
    this.initialized = true

    const userDataPath = app.getPath('userData')
    this.metricsDir = path.join(userDataPath, 'logs', 'metrics')
    fs.mkdirSync(this.metricsDir, { recursive: true })

    // 每 60 秒聚合一次
    this.intervalHandle = setInterval(() => this.flush(), 60 * 1000)

    console.log('[Metrics] Service initialized, aggregating every 60s')
  }

  /**
   * 由 traceService 的 onTraceComplete 回调直接推送完成的 trace
   * 避免从文件读取，消除时序风险
   */
  onTraceComplete(trace: Trace): void {
    this.windowTraces.push(trace)
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
    this.flush()
  }

  // ==================== 聚合 ====================

  private flush(): void {
    if (this.windowTraces.length === 0) return
    const snapshot = this.aggregate(this.windowTraces)
    this.writeSnapshot(snapshot)
    this.windowTraces = []
    console.log(`[Metrics] Snapshot written: ${snapshot.messageCount} msgs, avg ${snapshot.avgDurationMs}ms, llm calls ${snapshot.llm.callCount}`)
  }

  private aggregate(traces: Trace[]): MetricsSnapshot {
    const platforms: Record<string, PlatformMetrics> = {}
    const tools: Record<string, ToolMetrics> = {}
    const msgDurations: number[] = []
    const llmDurations: number[] = []

    let successCount = 0
    let errorCount = 0
    let llmCallCount = 0
    let llmErrorCount = 0
    let llmInputTokens = 0
    let llmOutputTokens = 0
    let llmTotalDuration = 0

    for (const trace of traces) {
      // 平台统计
      if (!platforms[trace.platform]) {
        platforms[trace.platform] = { received: 0, processed: 0, errors: 0 }
      }
      platforms[trace.platform].received++
      if (trace.success) {
        platforms[trace.platform].processed++
        successCount++
      } else {
        platforms[trace.platform].errors++
        errorCount++
      }

      if (trace.durationMs) msgDurations.push(trace.durationMs)

      // Span 级别统计
      for (const span of trace.spans ?? []) {
        const dur = span.durationMs ?? 0

        if (span.name.startsWith('llm.call')) {
          llmCallCount++
          llmTotalDuration += dur
          llmDurations.push(dur)
          if (span.status === 'error') llmErrorCount++
          if (span.attributes?.inputTokens) llmInputTokens += span.attributes.inputTokens as number
          if (span.attributes?.outputTokens) llmOutputTokens += span.attributes.outputTokens as number
        } else if (span.name.startsWith('tool.')) {
          const toolName = span.name.replace('tool.', '')
          if (!tools[toolName]) {
            tools[toolName] = { callCount: 0, errorCount: 0, totalDurationMs: 0, avgDurationMs: 0 }
          }
          tools[toolName].callCount++
          tools[toolName].totalDurationMs += dur
          if (span.status === 'error') tools[toolName].errorCount++
        }
      }
    }

    // 计算工具平均耗时
    for (const t of Object.values(tools)) {
      t.avgDurationMs = t.callCount > 0 ? Math.round(t.totalDurationMs / t.callCount) : 0
    }

    return {
      window: new Date().toISOString(),
      messageCount: traces.length,
      successCount,
      errorCount,
      avgDurationMs: this.avg(msgDurations),
      p95DurationMs: this.percentile(msgDurations, 95),
      llm: {
        callCount: llmCallCount,
        errorCount: llmErrorCount,
        totalInputTokens: llmInputTokens,
        totalOutputTokens: llmOutputTokens,
        totalDurationMs: llmTotalDuration,
        avgDurationMs: llmCallCount > 0 ? Math.round(llmTotalDuration / llmCallCount) : 0,
        p95DurationMs: this.percentile(llmDurations, 95)
      },
      tools,
      platforms
    }
  }

  // ==================== 工具函数 ====================

  private avg(values: number[]): number {
    if (values.length === 0) return 0
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length)
  }

  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const idx = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, idx)]
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10)
  }

  // ==================== 持久化 ====================

  private writeSnapshot(snapshot: MetricsSnapshot): void {
    if (!this.metricsDir) return
    const filePath = path.join(this.metricsDir, `${this.today()}.jsonl`)
    try {
      fs.appendFileSync(filePath, JSON.stringify(snapshot) + '\n', 'utf-8')
    } catch {
      // 静默忽略写入失败
    }
  }

  readMetrics(date?: string): MetricsSnapshot[] {
    const targetDate = date ?? this.today()
    const filePath = path.join(this.metricsDir, `${targetDate}.jsonl`)
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as MetricsSnapshot)
    } catch {
      return []
    }
  }

  /**
   * 返回今天所有快照合并后的汇总（用于 UI 展示）
   */
  getTodaySummary(): MetricsSnapshot | null {
    const snapshots = this.readMetrics()
    if (snapshots.length === 0) return null

    const merged: MetricsSnapshot = {
      window: new Date().toISOString(),
      messageCount: 0,
      successCount: 0,
      errorCount: 0,
      avgDurationMs: 0,
      p95DurationMs: 0,
      llm: { callCount: 0, errorCount: 0, totalInputTokens: 0, totalOutputTokens: 0, totalDurationMs: 0, avgDurationMs: 0, p95DurationMs: 0 },
      tools: {},
      platforms: {}
    }

    for (const s of snapshots) {
      merged.messageCount += s.messageCount
      merged.successCount += s.successCount
      merged.errorCount += s.errorCount
      merged.llm.callCount += s.llm.callCount
      merged.llm.errorCount += s.llm.errorCount
      merged.llm.totalInputTokens += s.llm.totalInputTokens
      merged.llm.totalOutputTokens += s.llm.totalOutputTokens
      merged.llm.totalDurationMs += s.llm.totalDurationMs

      for (const [name, tool] of Object.entries(s.tools)) {
        if (!merged.tools[name]) {
          merged.tools[name] = { callCount: 0, errorCount: 0, totalDurationMs: 0, avgDurationMs: 0 }
        }
        merged.tools[name].callCount += tool.callCount
        merged.tools[name].errorCount += tool.errorCount
        merged.tools[name].totalDurationMs += tool.totalDurationMs
      }

      for (const [name, platform] of Object.entries(s.platforms)) {
        if (!merged.platforms[name]) {
          merged.platforms[name] = { received: 0, processed: 0, errors: 0 }
        }
        merged.platforms[name].received += platform.received
        merged.platforms[name].processed += platform.processed
        merged.platforms[name].errors += platform.errors
      }
    }

    // 计算合并后的平均值
    merged.llm.avgDurationMs = merged.llm.callCount > 0
      ? Math.round(merged.llm.totalDurationMs / merged.llm.callCount)
      : 0

    for (const t of Object.values(merged.tools)) {
      t.avgDurationMs = t.callCount > 0 ? Math.round(t.totalDurationMs / t.callCount) : 0
    }

    return merged
  }
}

export const metricsService = new MetricsService()
