export enum PollingState {
  Idle = "idle",
  Polling = "polling",
  Waiting = "waiting",
  Paused = "paused",
  Stopped = "stopped",
}

type PollingOptions<Result> = {
  request: () => Promise<Result>;
  onResult: (result: Result) => boolean;
  onError: (error: unknown) => boolean;
  delays: { normal: number; retry: number };
};

/** Callbacks return whether to poll again. A disposed lifecycle cannot be restarted. */
export class PollingLifecycle<Result> {
  private state = PollingState.Idle;
  private pending = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private options: PollingOptions<Result>) {}

  start() {
    if (
      this.state === PollingState.Stopped ||
      this.state === PollingState.Polling ||
      this.state === PollingState.Waiting
    )
      return;
    this.state = PollingState.Polling;
    if (!this.pending) void this.poll();
  }

  /** Keep an in-flight result, but do not schedule another request while paused. */
  pause() {
    if (this.stopped()) return;
    clearTimeout(this.timer);
    this.state = PollingState.Paused;
  }

  dispose() {
    clearTimeout(this.timer);
    this.state = PollingState.Stopped;
  }

  private stopped() {
    return this.state === PollingState.Stopped;
  }

  private async poll() {
    this.pending = true;
    let repeat = false;
    let delay = this.options.delays.normal;
    try {
      const result = await this.options.request();
      if (!this.stopped()) repeat = this.options.onResult(result);
    } catch (error) {
      if (!this.stopped()) repeat = this.options.onError(error);
      delay = this.options.delays.retry;
    } finally {
      this.pending = false;
    }
    if (this.stopped()) return;
    if (!repeat) {
      this.state = PollingState.Idle;
      return;
    }
    if (this.state === PollingState.Paused) return;
    this.state = PollingState.Waiting;
    this.timer = setTimeout(() => {
      this.state = PollingState.Polling;
      void this.poll();
    }, delay);
  }
}
