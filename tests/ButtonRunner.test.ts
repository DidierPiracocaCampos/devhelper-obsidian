import { describe, expect, it, vi } from "vitest";
import {
  ButtonRunner,
  DISABLED_SCRIPTS_MESSAGE,
  runKey,
  type ButtonRunnerDeps,
} from "../src/ui/buttons/ButtonRunner";
import type { ToolbarButtonRecord, ToolbarButtonOption } from "../src/domain/toolbarButtons";

function direct(code: string): ToolbarButtonRecord {
  return { path: "Botones/a.md", label: "Label", icon: "x", order: 0, enabled: true, action: { kind: "direct", code } };
}
const opt: ToolbarButtonOption = { label: "Build", code: "" };
function menu(code: string): [ToolbarButtonRecord, ToolbarButtonOption] {
  const o = { ...opt, code };
  return [
    { path: "Botones/m.md", label: "Despliegue", icon: "x", order: 0, enabled: true, action: { kind: "menu", options: [o] } },
    o,
  ];
}

function makeDeps(over: Partial<ButtonRunnerDeps> = {}) {
  const notices: string[] = [];
  const calls: string[] = [];
  const deps = {
    app: { id: "APP" },
    obsidian: { id: "OBS" },
    isAllowed: () => true,
    notice: (m: string) => void notices.push(m),
    getProject: () => ({ path: "P/P.md", title: "P" }),
    repo: {
      load: async () => { calls.push("load"); return {}; },
      createTask: async () => {}, createNote: async () => {}, setTaskStatus: async () => {},
      renameTask: async () => {}, reassignTask: async () => {}, createCalendarEvent: async () => "",
      updateCalendarEvent: async () => {}, setCalendarEventStatus: async () => {},
    },
    exec: async (c: string) => { calls.push("exec:" + c); return { code: 0, stdout: "", stderr: "" }; },
    refresh: () => void calls.push("refresh"),
    openCalendar: (d?: string) => void calls.push("cal:" + d),
    logError: vi.fn(),
    ...over,
  } as unknown as ButtonRunnerDeps;
  return { deps, notices, calls };
}

describe("ButtonRunner", () => {
  it("bloquea con el interruptor apagado", async () => {
    const { deps, notices } = makeDeps({ isAllowed: () => false });
    const r = await new ButtonRunner(deps).run(direct('ctx.notice("x")'), null);
    expect(r).toEqual({ kind: "blocked" });
    expect(notices).toEqual([DISABLED_SCRIPTS_MESSAGE]);
  });

  it("ejecuta directa y de menú con ctx.button", async () => {
    const { deps, notices } = makeDeps();
    const code = "await Promise.resolve(); ctx.notice(ctx.button.label + '|' + ctx.button.option)";
    const runner = new ButtonRunner(deps);
    expect(await runner.run(direct(code), null)).toEqual({ kind: "ok" });
    const [b, o] = menu(code);
    expect(await runner.run(b, o)).toEqual({ kind: "ok" });
    expect(notices).toEqual(["Label|null", "Despliegue|Build"]);
  });

  it("expone project, deps, app y obsidian", async () => {
    const { deps, notices, calls } = makeDeps();
    const code = `ctx.notice(ctx.project.title); ctx.refresh(); ctx.openCalendar("2026-11-09");
      await ctx.run("x"); await ctx.repo.load(); ctx.notice(app.id + obsidian.id)`;
    expect(await new ButtonRunner(deps).run(direct(code), null)).toEqual({ kind: "ok" });
    expect(notices).toEqual(["P", "APPOBS"]);
    expect(calls).toEqual(["refresh", "cal:2026-11-09", "exec:x", "load"]);
  });

  it("errores sync con aviso y logError", async () => {
    const { deps, notices } = makeDeps();
    const [b, o] = menu('throw new Error("boom")');
    expect(await new ButtonRunner(deps).run(b, o)).toEqual({ kind: "error", message: "boom" });
    expect(notices).toEqual(["Error en «Despliegue › Build»: boom"]);
    expect(deps.logError).toHaveBeenCalledWith(expect.any(String), expect.any(Error), 'throw new Error("boom")');
  });

  it("errores async, sintaxis y no-Error", async () => {
    const { deps } = makeDeps();
    const r = new ButtonRunner(deps);
    expect((await r.run(direct('await Promise.reject(new Error("tarde"))'), null)).kind).toBe("error");
    expect((await r.run(direct("ctx.notice("), null)).kind).toBe("error");
    expect(await r.run(direct('throw "texto"'), null)).toEqual({ kind: "error", message: "texto" });
    expect(await r.run(direct("await Promise.reject(42)"), null)).toEqual({ kind: "error", message: "42" });
  });

  it("busy mientras corre y libera tras error", async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const { deps } = makeDeps({ app: { gate } });
    const runner = new ButtonRunner(deps);
    const b = direct("await app.gate; throw new Error('x')");
    const key = runKey(b, null);
    const first = runner.run(b, null);
    expect(runner.isRunning(key)).toBe(true);
    expect(await runner.run(b, null)).toEqual({ kind: "busy" });
    release();
    expect((await first).kind).toBe("error");
    expect(runner.isRunning(key)).toBe(false);
  });

  it("menú sin opción: error sin ejecutar", async () => {
    const { deps, notices } = makeDeps();
    const [b] = menu("ctx.notice('no')");
    const r = await new ButtonRunner(deps).run(b, null);
    expect(r).toEqual({ kind: "error", message: "El botón «Despliegue» es un menú: elige una opción" });
    expect(notices).toEqual(["El botón «Despliegue» es un menú: elige una opción"]);
  });

  it("ctx.repo tiene métodos ligados", async () => {
    class FakeRepo {
      marker = "M";
      async load() { return this.marker; }
      async createTask() {} async createNote() {} async setTaskStatus() {} async renameTask() {}
      async reassignTask() {} async createCalendarEvent() { return ""; }
      async updateCalendarEvent() {} async setCalendarEventStatus() {}
    }
    const { deps, notices } = makeDeps({ repo: new FakeRepo() as never });
    const code = "const { load } = ctx.repo; ctx.notice(await load());";
    expect((await new ButtonRunner(deps).run(direct(code), null)).kind).toBe("ok");
    expect(notices).toEqual(["M"]);
  });

  it("run nunca rechaza si notice/logError lanzan", async () => {
    const boom = () => { throw new Error("x"); };
    const { deps } = makeDeps({ notice: boom, logError: boom });
    expect(await new ButtonRunner(deps).run(direct("throw new Error('y')"), null)).toEqual({ kind: "error", message: "y" });
  });

  it("runKey", () => {
    const [b, o] = menu("");
    expect(runKey(direct(""), null)).toBe("Botones/a.md");
    expect(runKey(b, o)).toBe("Botones/m.md#Build");
  });

  it("isAllowed se consulta en cada run", async () => {
    let allowed = false;
    const { deps } = makeDeps({ isAllowed: () => allowed });
    const runner = new ButtonRunner(deps);
    expect((await runner.run(direct(""), null)).kind).toBe("blocked");
    allowed = true;
    expect((await runner.run(direct(""), null)).kind).toBe("ok");
  });
});
