type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  module: string;
  message: string;
  timestamp: string;
  hotelId?: string;
  shiftDate?: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, module: string, message: string, meta: Record<string, unknown> = {}): void {
  const entry: LogEntry = {
    level,
    module,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  };
  // Structured JSON line — easy for another builder or AI agent to parse
  console.log(JSON.stringify(entry));
}

export const log = {
  info: (module: string, message: string, meta?: Record<string, unknown>) =>
    emit('info', module, message, meta),
  warn: (module: string, message: string, meta?: Record<string, unknown>) =>
    emit('warn', module, message, meta),
  error: (module: string, message: string, meta?: Record<string, unknown>) =>
    emit('error', module, message, meta),
};
