export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  component: string;
  message: string;
}

type LogListener = (entry: LogEntry) => void;

class LoggerService {
  private listeners: LogListener[] = [];
  private logs: LogEntry[] = [];
  private maxLogs = 1000;

  public log(component: string, message: string, level: LogLevel = 'info') {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      component,
      message
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    this.listeners.forEach(l => l(entry));

    if (level === 'error') console.error(`[${component}] ${message}`);
    else if (level === 'warn') console.warn(`[${component}] ${message}`);
  }

  public subscribe(listener: LogListener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  public getHistory() {
    return [...this.logs];
  }

  public clear() {
    this.logs = [];
    // Notify listeners of clear if needed, for now just reset array
  }
}

export const SystemLogger = new LoggerService();
