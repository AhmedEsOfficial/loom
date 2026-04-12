import { Worker } from "node:worker_threads";
import { createLogger } from "./logger.js";

const log = createLogger("kernel");

interface WorkerTask<T> {
  data: unknown;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export class WorkerPool<T = unknown> {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: WorkerTask<T>[] = [];
  private closed = false;

  constructor(
    private workerPath: string,
    private poolSize: number = Math.max(1, (navigator?.hardwareConcurrency ?? 4) - 1),
  ) {
    this.initWorkers();
  }

  private initWorkers(): void {
    for (let i = 0; i < this.poolSize; i++) {
      const worker = new Worker(this.workerPath);
      this.workers.push(worker);
      this.idle.push(worker);
    }
  }

  async execute(data: unknown): Promise<T> {
    if (this.closed) {
      throw new Error("WorkerPool is closed");
    }

    return new Promise<T>((resolve, reject) => {
      const task: WorkerTask<T> = { data, resolve, reject };
      const worker = this.idle.pop();

      if (worker) {
        this.runTask(worker, task);
      } else {
        this.queue.push(task);
      }
    });
  }

  private runTask(worker: Worker, task: WorkerTask<T>): void {
    const onMessage = (result: T) => {
      cleanup();
      task.resolve(result);
      this.onWorkerFree(worker);
    };

    const onError = (error: Error) => {
      cleanup();
      task.reject(error);
      this.onWorkerFree(worker);
    };

    const cleanup = () => {
      worker.removeListener("message", onMessage);
      worker.removeListener("error", onError);
    };

    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.postMessage(task.data);
  }

  private onWorkerFree(worker: Worker): void {
    if (this.closed) return;

    const next = this.queue.shift();
    if (next) {
      this.runTask(worker, next);
    } else {
      this.idle.push(worker);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    // Reject pending tasks
    for (const task of this.queue) {
      task.reject(new Error("WorkerPool closed"));
    }
    this.queue = [];

    // Terminate workers
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
    this.idle = [];
    log.info("Worker pool closed");
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get activeCount(): number {
    return this.workers.length - this.idle.length;
  }
}
