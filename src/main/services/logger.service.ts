import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'
import type { Trace } from './trace.service'

// ==================== Types ====================

/**
 * Legacy log entry - kept for backward compatibility with the UI log viewer
 */
interface LogEntry {
  timestamp: number
  level: 'log' | 'info' | 'warn' | 'error'
  message: string
}

/**
 * Structured log entry written to persistent files
 */
export interface StructuredLogEntry {
  timestamp: string        // ISO 8601
  level: 'debug' | 'info' | 'warn' | 'error'
  event: string            // dot-notation: 'agent.llm.call', 'tool.discord.send'
  traceId?: string
  durationMs?: number
  data?: Record<string, unknown>
  error?: string
}

// ==================== Service ====================

/**
 * Logger Service - Captures console output for in-app viewing
 * Uses Winston with daily log rotation for persistent structured logging
 */
class LoggerService {
  private logs: LogEntry[] = []
  private maxLogs = 1000
  private initialized = false
  private observabilityEnabled = true
  private auditDir = ''
  private tracesDir = ''
  private winstonLogger: winston.Logger | null = null

  /**
   * 模块名和上下文，由 withContext() 绑定
   * 仿照 cherry-studio 的 LoggerService.withContext 模式
   */
  private module: string = ''
  private context: Record<string, unknown> = {}

  /**
   * 系统信息快照，在 initialize 时采集一次
   * 自动附加到所有 warn/error 日志，方便售后排查
   */
  private sysInfo: Record<string, string> = {}

  /**
   * Initialize logger - sets up Winston with daily rotation
   */
  initialize(): void {
    if (this.initialized) return
    this.initialized = true

    const userDataPath = app.getPath('userData')
    this.auditDir = path.join(userDataPath, 'logs', 'audit')
    this.tracesDir = path.join(userDataPath, 'logs', 'traces')

    fs.mkdirSync(this.auditDir, { recursive: true })
    fs.mkdirSync(this.tracesDir, { recursive: true })

    // 采集系统信息，附加到 warn/error 日志
    this.sysInfo = {
      platform: os.platform(),
      arch: os.arch(),
      osRelease: os.release(),
      nodeVersion: process.versions.node,
      appVersion: app.getVersion(),
      totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024).toString()
    }

    this._initWinston(userDataPath)
  }

  /**
   * 由 settings 控制 observability 开关
   * 关闭后 warn/error 只写内存 buffer，不写文件
   */
  setObservabilityEnabled(enabled: boolean): void {
    this.observabilityEnabled = enabled
  }

  private _initWinston(userDataPath: string): void {
    const logsDir = path.join(userDataPath, 'logs')
    // Winston 轮转记录文件统一放到 .winston-audit/ 目录，不污染日志目录
    const winstonAuditDir = path.join(logsDir, '.winston-audit')
    fs.mkdirSync(winstonAuditDir, { recursive: true })

    const jsonFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )

    const transports: winston.transport[] = [
      // All logs: 10MB limit, 30 days retention
      new DailyRotateFile({
        dirname: logsDir,
        filename: 'app.%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: '10m',
        maxFiles: '30d',
        level: 'info',
        format: jsonFormat,
        auditFile: path.join(winstonAuditDir, 'app-audit.json')
      }),
      // Error/warn only: 60 days retention
      new DailyRotateFile({
        dirname: this.auditDir,
        filename: '%DATE%.jsonl',
        datePattern: 'YYYY-MM-DD',
        maxSize: '10m',
        maxFiles: '60d',
        level: 'warn',
        format: jsonFormat,
        auditFile: path.join(winstonAuditDir, 'audit-audit.json')
      })
    ]

    // Console output in development
    if (!app.isPackaged) {
      transports.push(
        new winston.transports.Console({
          level: 'warn',
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      )
    }

    this.winstonLogger = winston.createLogger({
      level: 'info',
      transports
    })
  }

  // ==================== Structured logging API ====================

  info(event: string, data?: Record<string, unknown>, traceId?: string): void {
    this.logs.push({ timestamp: Date.now(), level: 'info', message: event })
    this._trimLogs()
    if (!this.observabilityEnabled) return
    this._log('info', event, data, traceId)
  }

  warn(event: string, data?: Record<string, unknown>, traceId?: string): void {
    // warn/error 始终写内存 buffer（供 UI 查看），但文件写入受开关控制
    this.logs.push({ timestamp: Date.now(), level: 'warn', message: event })
    this._trimLogs()
    if (!this.observabilityEnabled) return
    // 自动附加系统信息（仿照 cherry-studio 的 warn/error 行为）
    this._log('warn', event, { ...data, sys: this.sysInfo }, traceId)
  }

  error(event: string, data?: Record<string, unknown>, traceId?: string): void {
    this.logs.push({ timestamp: Date.now(), level: 'error', message: event })
    this._trimLogs()
    if (!this.observabilityEnabled) return
    // 自动附加系统信息
    this._log('error', event, { ...data, sys: this.sysInfo }, traceId)
  }

  /**
   * 返回一个绑定了模块名的新 logger 实例
   * 仿照 cherry-studio 的 withContext 模式
   * 用法：this.logger = loggerService.withContext('FeishuBotService')
   */
  withContext(module: string, ctx?: Record<string, unknown>): LoggerService {
    const child = Object.create(this) as LoggerService
    child.module = module
    child.context = { ...this.context, ...ctx }
    return child
  }

  private _log(level: string, event: string, data?: Record<string, unknown>, traceId?: string): void {
    if (!this.winstonLogger) return
    const meta: Record<string, unknown> = { traceId, ...this.context, ...data }
    if (this.module) meta['module'] = this.module
    this.winstonLogger.log(level, event, meta)
  }

  private _trimLogs(): void {
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs)
    }
  }

  // ==================== Backward-compat structured entry API ====================

  writeAuditEntry(entry: StructuredLogEntry): void {
    if (!this.auditDir || !this.observabilityEnabled) return
    this._log(entry.level, entry.event, entry.data, entry.traceId)
    const filePath = path.join(this.auditDir, `${this._today()}.jsonl`)
    this._appendJsonl(filePath, entry)
  }

  writeTrace(trace: Trace): void {
    if (!this.tracesDir || !this.observabilityEnabled) return
    const filePath = path.join(this.tracesDir, `${this._today()}.jsonl`)
    this._appendJsonl(filePath, trace)
  }

  // ==================== Read / Export ====================

  readAuditLogs(date?: string): StructuredLogEntry[] {
    const targetDate = date ?? this._today()
    const filePath = path.join(this.auditDir, `${targetDate}.jsonl`)
    return this._readJsonl<StructuredLogEntry>(filePath)
  }

  readTraces(date?: string): Trace[] {
    const targetDate = date ?? this._today()
    const filePath = path.join(this.tracesDir, `${targetDate}.jsonl`)
    return this._readJsonl<Trace>(filePath)
  }

  getAvailableDates(): string[] {
    try {
      return fs
        .readdirSync(this.auditDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => f.replace('.jsonl', ''))
        .sort()
        .reverse()
    } catch {
      return []
    }
  }

  exportLogs(date?: string): string {
    const targetDate = date ?? this._today()
    const audit = this.readAuditLogs(targetDate)
    const traces = this.readTraces(targetDate)
    return JSON.stringify({ date: targetDate, audit, traces }, null, 2)
  }

  // ==================== Legacy API (unchanged) ====================

  getLogs(): LogEntry[] {
    return [...this.logs]
  }

  clearLogs(): void {
    this.logs = []
  }

  isProduction(): boolean {
    return app.isPackaged
  }

  // ==================== Private helpers ====================

  private _today(): string {
    return new Date().toISOString().slice(0, 10)
  }

  private _appendJsonl(filePath: string, entry: object): void {
    if (!this.initialized) return
    try {
      fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8')
    } catch {
      // Silently ignore write errors
    }
  }

  private _readJsonl<T>(filePath: string): T[] {
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as T)
    } catch {
      return []
    }
  }
}

export const loggerService = new LoggerService()
