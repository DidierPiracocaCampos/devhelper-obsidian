export const DEFAULT_TIMEOUT_MS = 60000;

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

export type ExecFn = (
  cmd: string,
  options: { cwd?: string; timeout?: number; windowsHide: boolean; maxBuffer: number },
  callback: (error: ExecError | null, stdout: string, stderr: string) => void
) => unknown;

export function createShellExec(opts: {
  isDesktop: boolean;
  defaultCwd: string | null;
  /**
   * `child_process.exec`. Lo inyecta `main.ts` sólo en escritorio (detrás de
   * `Platform.isDesktopApp`); este módulo nunca importa módulos de Node.
   */
  execImpl?: ExecFn;
}): ShellExec {
  return (cmd, options = {}) => {
    const exec = opts.execImpl;
    if (!opts.isDesktop || !exec) {
      return Promise.reject(new Error("ctx.run sólo está disponible en escritorio"));
    }
    return new Promise<ShellResult>((resolve, reject) => {
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const cwd = options.cwd ?? opts.defaultCwd ?? undefined;
      exec(
        cmd,
        {
          cwd,
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) });
            return;
          }
          if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            reject(new Error("La salida del comando superó el límite de memoria"));
            return;
          }
          if (error.killed && error.signal === "SIGTERM") {
            reject(new Error(`El comando superó el tiempo límite de ${timeoutMs} ms`));
            return;
          }
          if (error.signal) {
            reject(new Error(`El comando terminó por la señal ${error.signal}`));
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
