export interface ShellResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ShellOptions {
  cwd?: string;
  timeoutMs?: number;
}

export type ShellExec = (cmd: string, options?: ShellOptions) => Promise<ShellResult>;

interface ExecError {
  code?: number | string | null;
  killed?: boolean;
  signal?: string | null;
  message?: string;
}

type ExecFn = (
  cmd: string,
  options: { cwd?: string; timeout?: number; windowsHide: boolean; maxBuffer: number },
  callback: (error: ExecError | null, stdout: string, stderr: string) => void
) => unknown;

export function createShellExec(opts: {
  isDesktop: boolean;
  defaultCwd: string | null;
}): ShellExec {
  return (cmd, options = {}) => {
    if (!opts.isDesktop) {
      return Promise.reject(new Error("ctx.run sólo está disponible en escritorio"));
    }
    return new Promise<ShellResult>((resolve, reject) => {
      let exec: ExecFn;
      try {
        // Carga perezosa: esbuild deja `child_process` externo y en móvil nunca se evalúa.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        exec = (require("child_process") as { exec: ExecFn }).exec;
      } catch (e) {
        reject(new Error(`No se pudo ejecutar el comando: ${(e as Error).message}`));
        return;
      }
      const cwd = options.cwd ?? opts.defaultCwd ?? undefined;
      exec(
        cmd,
        {
          cwd,
          timeout: options.timeoutMs,
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) });
            return;
          }
          if (error.killed || error.signal) {
            reject(new Error(`El comando superó el tiempo límite de ${options.timeoutMs} ms`));
            return;
          }
          if (typeof error.code === "number") {
            resolve({ code: error.code, stdout: String(stdout), stderr: String(stderr) });
            return;
          }
          reject(new Error(`No se pudo ejecutar el comando: ${error.message ?? String(error)}`));
        }
      );
    });
  };
}
