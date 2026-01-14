import 'server-only';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Outputs a structured JSON log line to the console.
 * @param level - Log severity level
 * @param message - Log message
 * @param meta - Optional metadata object to include
 */
function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    level,
    message,
    timestamp: new Date().toISOString(),
  };
  if (meta && Object.keys(meta).length) payload.meta = meta;

  const line = JSON.stringify(payload);
  switch (level) {
    case 'debug':
    case 'info':
      console.log(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    case 'error':
      console.error(line);
      break;
  }
}

/**
 * Structured JSON logger for server-side logging.
 * Each log entry includes timestamp, level, message, and optional metadata.
 */
export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
};
