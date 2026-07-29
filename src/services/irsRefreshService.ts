import { spawn } from "node:child_process";

let running: Promise<void> | undefined;

export function runIrsRefreshPipeline() {
  if (running) return running;
  running = new Promise<void>((resolve, reject) => {
    const child = spawn("npm", ["run", "data:refresh:irs"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`IRS refresh pipeline exited with code ${code ?? "unknown"}.`));
    });
  }).finally(() => {
    running = undefined;
  });
  return running;
}

export function startIrsRefreshScheduler() {
  if (process.env.IRS_AUTO_REFRESH_ENABLED === "false") {
    console.log("[irs] automatic source refresh is disabled");
    return () => undefined;
  }
  const interval = Math.max(
    6 * 60 * 60 * 1000,
    Number(process.env.IRS_REFRESH_INTERVAL_MS ?? 7 * 24 * 60 * 60 * 1000),
  );
  const invoke = () => {
    void runIrsRefreshPipeline().catch((error) =>
      console.error("[irs] scheduled refresh failed", error instanceof Error ? error.message : error)
    );
  };
  if (process.env.IRS_REFRESH_ON_STARTUP !== "false") invoke();
  const timer = setInterval(invoke, interval);
  timer.unref();
  console.log(`[irs] automatic source refresh scheduled every ${Math.round(interval / 3_600_000)} hours`);
  return () => clearInterval(timer);
}
