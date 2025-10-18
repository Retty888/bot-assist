export type NotificationSeverity = "info" | "warning" | "critical";

export type NotificationType = "risk-guard" | "exchange-error" | "telemetry";

export interface NotificationEvent {
  readonly type: NotificationType;
  readonly severity: NotificationSeverity;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export interface NotificationServiceOptions {
  readonly webhookUrl?: string;
  readonly consoleLevel?: "log" | "warn" | "error";
}

export class NotificationService {
  constructor(private readonly options: NotificationServiceOptions = {}) {}

  async notify(event: NotificationEvent): Promise<void> {
    const tasks: Array<Promise<void>> = [this.emitConsole(event)];
    if (this.options.webhookUrl) {
      tasks.push(this.emitWebhook(event));
    }
    await Promise.all(tasks.map((task) => task.catch((error) => {
      console.warn("[notify] failed to emit notification", error);
    })));
  }

  private async emitConsole(event: NotificationEvent): Promise<void> {
    const level = this.options.consoleLevel ?? (event.severity === "critical" ? "error" : "warn");
    const payload = { ...event, timestamp: new Date().toISOString() };
    const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    logger.call(console, `[notify] ${event.type}`, payload);
  }

  private async emitWebhook(event: NotificationEvent): Promise<void> {
    const url = this.options.webhookUrl;
    if (!url) {
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...event, timestamp: new Date().toISOString() }),
        signal: controller.signal,
      });
    } catch (error) {
      console.warn("[notify] webhook delivery failed", error);
    } finally {
      clearTimeout(timeout);
    }
  }
}
