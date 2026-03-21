import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { BatchSpanProcessor, SpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { context, trace, SpanStatusCode, Context, Span, Attributes } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import * as fs from 'fs'
import * as path from 'path'

// ==================== Legacy Types (kept for logger/metrics compatibility) ====================

export interface TokenUsage {
  input: number
  output: number
  total: number
}

export interface LegacySpan {
  spanId: string
  parentSpanId?: string
  name: string
  startTime: number
  endTime?: number
  durationMs?: number
  status: 'ok' | 'error'
  attributes: Record<string, unknown>
  error?: string
  tokenUsage?: TokenUsage
}

export interface Trace {
  traceId: string
  platform: string
  userId?: string
  chatId?: string
  startTime: number
  endTime?: number
  durationMs?: number
  success?: boolean
  spans: LegacySpan[]
}

// Re-export as Span for backward compat
export type { LegacySpan as Span }

// ==================== FileSpanExporter ====================

/**
 * Exports completed spans to daily JSONL files.
 * Converts OTEL ReadableSpan format to our Trace/Span format for backward compatibility.
 * Mirrors cherry-studio's SpanCacheService file persistence pattern.
 */
class FileSpanExporter implements SpanExporter {
  private tracesDir = ''
  // traceId → 收集中的 Trace（含子 Span，等待根 Span 到来）
  private pendingTraces: Map<string, Trace> = new Map()
  // traceId → flush timer（根 Span 到来后等 1s 让晚到的子 Span 补入）
  private flushTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private onTraceComplete?: (trace: Trace) => void
  // spanId → token usage，用于递归向上累加
  private spanTokenMap: Map<string, TokenUsage> = new Map()
  // spanId → parentSpanId，用于找父节点
  private spanParentMap: Map<string, string> = new Map()

  setTracesDir(dir: string): void {
    this.tracesDir = dir
    fs.mkdirSync(dir, { recursive: true })
  }

  setOnTraceComplete(cb: (trace: Trace) => void): void {
    this.onTraceComplete = cb
  }

  export(spans: ReadableSpan[], resultCallback: (result: { code: number; error?: Error }) => void): void {
    if (!this.tracesDir) {
      resultCallback({ code: 0 })
      return
    }

    try {
      for (const span of spans) {
        const traceId = span.spanContext().traceId
        const parentSpanId = span.parentSpanContext?.spanId
        const isRoot = !parentSpanId || parentSpanId === '0000000000000000'

        const startMs = span.startTime[0] * 1e3 + Math.floor(span.startTime[1] / 1e6)
        const endMs = span.endTime[0] * 1e3 + Math.floor(span.endTime[1] / 1e6)
        const spanId = span.spanContext().spanId

        if (parentSpanId) {
          this.spanParentMap.set(spanId, parentSpanId)
        }

        const inputTokens = Number(span.attributes['inputTokens'] ?? 0)
        const outputTokens = Number(span.attributes['outputTokens'] ?? 0)
        const totalTokens = inputTokens + outputTokens
        let tokenUsage: TokenUsage | undefined
        if (totalTokens > 0) {
          tokenUsage = { input: inputTokens, output: outputTokens, total: totalTokens }
          this.spanTokenMap.set(spanId, tokenUsage)
          this._propagateTokens(spanId, tokenUsage)
        }

        const legacySpan: LegacySpan = {
          spanId,
          parentSpanId: parentSpanId || undefined,
          name: span.name,
          startTime: startMs,
          endTime: endMs,
          durationMs: Math.max(0, endMs - startMs),
          status: span.status.code === SpanStatusCode.ERROR ? 'error' : 'ok',
          attributes: { ...span.attributes },
          error: span.status.message || undefined,
          tokenUsage
        }

        // 所有 span 先堆进 pendingTraces
        let traceRecord = this.pendingTraces.get(traceId)
        if (!traceRecord) {
          traceRecord = { traceId, platform: 'unknown', startTime: startMs, spans: [] }
          this.pendingTraces.set(traceId, traceRecord)
        }

        if (isRoot) {
          // 根 Span 到来：回填 platform、endTime、success，并插到 spans 最前面
          const platform = String(span.attributes['platform'] ?? 'unknown')
          traceRecord.platform = platform
          traceRecord.userId = span.attributes['userId'] as string | undefined
          traceRecord.chatId = span.attributes['chatId'] as string | undefined
          traceRecord.endTime = endMs
          traceRecord.durationMs = Math.max(0, endMs - traceRecord.startTime)
          traceRecord.success = legacySpan.status === 'ok'
          const rootTokenUsage = this.spanTokenMap.get(spanId)
          if (rootTokenUsage) legacySpan.tokenUsage = rootTokenUsage
          traceRecord.spans.unshift(legacySpan)

          // 等 1s 让同批次或下一批次晚到的子 Span 补入，再 flush
          const existing = this.flushTimers.get(traceId)
          if (existing) clearTimeout(existing)
          const timer = setTimeout(() => {
            this.flushTimers.delete(traceId)
            this.pendingTraces.delete(traceId)
            this.spanTokenMap.delete(spanId)
            this._flushTrace(traceRecord)
            this.onTraceComplete?.(traceRecord)
          }, 1000)
          this.flushTimers.set(traceId, timer)
        } else {
          traceRecord.spans.push(legacySpan)
        }
      }

      resultCallback({ code: 0 })
    } catch (err) {
      resultCallback({ code: 1, error: err instanceof Error ? err : new Error(String(err)) })
    }
  }

  private _propagateTokens(spanId: string, usage: TokenUsage): void {
    const parentId = this.spanParentMap.get(spanId)
    if (!parentId) return
    const existing = this.spanTokenMap.get(parentId)
    if (existing) {
      existing.input += usage.input
      existing.output += usage.output
      existing.total += usage.total
    } else {
      this.spanTokenMap.set(parentId, { ...usage })
    }
    this._propagateTokens(parentId, usage)
  }

  private _flushTrace(trace: Trace): void {
    if (!this.tracesDir) return
    const date = new Date().toISOString().slice(0, 10)
    const filePath = path.join(this.tracesDir, `${date}.jsonl`)
    try {
      fs.appendFileSync(filePath, JSON.stringify(trace) + '\n', 'utf-8')
    } catch {
      // Silently ignore write errors
    }
  }

  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}

// ==================== TraceService ====================

class TraceService {
  private provider: NodeTracerProvider | null = null
  private exporter: FileSpanExporter = new FileSpanExporter()
  private initialized = false
  private _activeRootSpans: Map<string, { span: Span; ctx: Context }> = new Map()
  private _activeChildSpans: Map<string, Span> = new Map()

  initialize(userDataPath: string, onTraceComplete?: (trace: Trace) => void): void {
    if (this.initialized) return
    this.initialized = true

    const tracesDir = path.join(userDataPath, 'logs', 'traces')
    this.exporter.setTracesDir(tracesDir)
    if (onTraceComplete) {
      this.exporter.setOnTraceComplete(onTraceComplete)
    }

    const contextManager = new AsyncLocalStorageContextManager()

    this.provider = new NodeTracerProvider({
      resource: resourceFromAttributes({ 'service.name': 'memUBot' }),
      spanProcessors: [
        new BatchSpanProcessor(this.exporter, {
          scheduledDelayMillis: 1000,
          maxExportBatchSize: 50
        })
      ]
    })

    this.provider.register({ contextManager })
  }

  getTracer(name = 'memUBot') {
    return trace.getTracer(name)
  }

  getCurrentContext(): Context {
    return context.active()
  }

  async forceFlush(): Promise<void> {
    await this.provider?.forceFlush()
  }

  async shutdown(): Promise<void> {
    await this.provider?.shutdown()
  }

  // ==================== Legacy API (backward-compat shim) ====================

  startTrace(platform: string, userId?: string, chatId?: string): string {
    const span = this.getTracer().startSpan(`message.${platform}`, {
      attributes: { platform, userId: userId ?? '', chatId: chatId ?? '' }
    })
    const ctx = trace.setSpan(context.active(), span)
    const traceId = span.spanContext().traceId
    this._activeRootSpans.set(traceId, { span, ctx })
    return traceId
  }

  endTrace(traceId: string, success: boolean): Trace | null {
    const entry = this._activeRootSpans.get(traceId)
    if (!entry) return null
    entry.span.setStatus({ code: success ? SpanStatusCode.OK : SpanStatusCode.ERROR })
    entry.span.end()
    this._activeRootSpans.delete(traceId)
    return null  // actual data written asynchronously by FileSpanExporter
  }

  getContext(traceId: string): Context {
    return this._activeRootSpans.get(traceId)?.ctx ?? context.active()
  }

  startSpan(
    traceId: string,
    name: string,
    attributes: Record<string, string | number | boolean> = {},
    _parentSpanId?: string
  ): string {
    const ctx = this.getContext(traceId)
    const span = this.getTracer().startSpan(name, { attributes: attributes as Attributes }, ctx)
    const spanId = span.spanContext().spanId
    this._activeChildSpans.set(spanId, span)
    return spanId
  }

  endSpan(
    _traceId: string,
    spanId: string,
    status: 'ok' | 'error' = 'ok',
    extraAttributes: Record<string, string | number | boolean> = {},
    error?: string
  ): void {
    const span = this._activeChildSpans.get(spanId)
    if (!span) return
    span.setAttributes(extraAttributes as Attributes)
    span.setStatus({
      code: status === 'error' ? SpanStatusCode.ERROR : SpanStatusCode.OK,
      message: error
    })
    if (error) span.recordException(new Error(error))
    span.end()
    this._activeChildSpans.delete(spanId)
  }

  getTrace(_traceId: string): Trace | undefined {
    return undefined
  }
}

export const traceService = new TraceService()
