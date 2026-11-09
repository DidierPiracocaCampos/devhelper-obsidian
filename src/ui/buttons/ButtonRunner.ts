import type { ProjectTaskRepository } from "../../data/ProjectTaskRepository";
import type { ToolbarButtonOption, ToolbarButtonRecord } from "../../domain/toolbarButtons";
import type { ShellExec } from "./shellExec";

export const DISABLED_SCRIPTS_MESSAGE =
  "Los botones con código están desactivados. Actívalos en Ajustes → DevHelper Dashboard.";

export type ButtonRepoApi = Pick<
  ProjectTaskRepository,
  | "load"
  | "createTask"
  | "createNote"
  | "setTaskStatus"
  | "renameTask"
  | "reassignTask"
  | "createCalendarEvent"
  | "updateCalendarEvent"
  | "setCalendarEventStatus"
>;

export interface ButtonContext {
  project: { path: string; title: string } | null;
  repo: ButtonRepoApi;
  run: ShellExec;
  notice(msg: string, ms?: number): void;
  refresh(): void;
  openCalendar(isoDate?: string): void;
  button: { label: string; option: string | null; path: string };
}

export interface ButtonRunnerDeps {
  app: unknown;
  obsidian: unknown;
  isAllowed(): boolean;
  notice(msg: string, ms?: number): void;
  getProject(): { path: string; title: string } | null;
  repo: ButtonRepoApi; // subconjunto público de ProjectTaskRepository
  exec: ShellExec; // implementación de ctx.run
  refresh(): void;
  openCalendar(isoDate?: string): void;
  logError(message: string, err: unknown, code: string): void;
}

export type RunResult =
  | { kind: "ok" }
  | { kind: "blocked" } // interruptor apagado
  | { kind: "busy" } // ya se está ejecutando esa misma clave
  | { kind: "error"; message: string };

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

export function runKey(button: ToolbarButtonRecord, option: ToolbarButtonOption | null): string {
  return option ? `${button.path}#${option.label}` : button.path;
}

export class ButtonRunner {
  private readonly running = new Set<string>();

  constructor(private readonly deps: ButtonRunnerDeps) {}

  isRunning(key: string): boolean {
    return this.running.has(key);
  }

  async run(button: ToolbarButtonRecord, option: ToolbarButtonOption | null): Promise<RunResult> {
    const d = this.deps;
    if (!d.isAllowed()) {
      d.notice(DISABLED_SCRIPTS_MESSAGE);
      return { kind: "blocked" };
    }
    const key = runKey(button, option);
    if (this.running.has(key)) return { kind: "busy" };

    const code = option
      ? option.code
      : button.action.kind === "direct"
        ? button.action.code
        : "";
    const name = option ? `${button.label} › ${option.label}` : button.label;

    this.running.add(key);
    try {
      const ctx: ButtonContext = {
        project: d.getProject(),
        repo: d.repo,
        run: (cmd, options) => d.exec(cmd, options),
        notice: (msg, ms) => d.notice(msg, ms),
        refresh: () => d.refresh(),
        openCalendar: (iso) => d.openCalendar(iso),
        button: { label: button.label, option: option ? option.label : null, path: button.path },
      };
      const fn = new AsyncFunction("app", "obsidian", "ctx", code);
      await fn(d.app, d.obsidian, ctx);
      return { kind: "ok" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      d.notice(`Error en «${name}»: ${message}`);
      d.logError(`Error en el botón «${name}»`, err, code);
      return { kind: "error", message };
    } finally {
      this.running.delete(key);
    }
  }
}
