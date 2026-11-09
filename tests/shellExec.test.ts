import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import { exec as nodeExec } from "node:child_process";
import { createShellExec, DEFAULT_TIMEOUT_MS, type ExecFn } from "../src/ui/buttons/shellExec";

describe("createShellExec", () => {
  it("rechaza en móvil", async () => {
    const run = createShellExec({ isDesktop: false, defaultCwd: null });
    await expect(run("echo x")).rejects.toThrow("ctx.run sólo está disponible en escritorio");
  });

  it("rechaza en escritorio si no se inyectó exec", async () => {
    const run = createShellExec({ isDesktop: true, defaultCwd: null });
    await expect(run("echo x")).rejects.toThrow("ctx.run sólo está disponible en escritorio");
  });

  it("captura stdout con código 0", async () => {
    const run = createShellExec({ isDesktop: true, defaultCwd: null, execImpl: nodeExec as unknown as ExecFn });
    const r = await run("node -e \"process.stdout.write('hola')\"");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("hola");
  });

  it("devuelve código distinto de 0 sin rechazar", async () => {
    const run = createShellExec({ isDesktop: true, defaultCwd: null, execImpl: nodeExec as unknown as ExecFn });
    const r = await run("node -e \"process.exit(3)\"");
    expect(r.code).toBe(3);
  });

  it("captura stderr", async () => {
    const run = createShellExec({ isDesktop: true, defaultCwd: null, execImpl: nodeExec as unknown as ExecFn });
    const r = await run("node -e \"process.stderr.write('err')\"");
    expect(r.stderr).toBe("err");
  });

  it("respeta cwd", async () => {
    const run = createShellExec({ isDesktop: true, defaultCwd: null, execImpl: nodeExec as unknown as ExecFn });
    const dir = os.tmpdir();
    const r = await run("node -e \"process.stdout.write(process.cwd())\"", { cwd: dir });
    expect(fs.realpathSync(r.stdout)).toBe(fs.realpathSync(dir));
  });

  it("usa defaultCwd si no se pasa cwd", async () => {
    const dir = os.tmpdir();
    const run = createShellExec({ isDesktop: true, defaultCwd: dir, execImpl: nodeExec as unknown as ExecFn });
    const r = await run("node -e \"process.stdout.write(process.cwd())\"");
    expect(fs.realpathSync(r.stdout)).toBe(fs.realpathSync(dir));
  });

  it("rechaza por tiempo límite", async () => {
    const run = createShellExec({ isDesktop: true, defaultCwd: null, execImpl: nodeExec as unknown as ExecFn });
    await expect(
      run("node -e \"setTimeout(()=>{},5000)\"", { timeoutMs: 200 })
    ).rejects.toThrow("superó el tiempo límite");
  });

  it("aplica el tiempo límite por defecto de 60000 ms", async () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(60000);
    let seen: number | undefined;
    const execImpl: ExecFn = (_cmd, o, cb) => {
      seen = o.timeout;
      cb(null, "", "");
      return undefined;
    };
    const run = createShellExec({ isDesktop: true, defaultCwd: null, execImpl });
    await run("x");
    expect(seen).toBe(60000);
  });

  it("rechaza si la salida supera el búfer", async () => {
    const run = createShellExec({ isDesktop: true, defaultCwd: null, execImpl: nodeExec as unknown as ExecFn });
    await expect(
      run("node -e \"process.stdout.write('a'.repeat(11*1024*1024))\"")
    ).rejects.toThrow("La salida del comando superó el límite de memoria");
  });

  it("informa señales externas", async () => {
    const execImpl: ExecFn = (_cmd, _o, cb) => {
      cb({ killed: false, signal: "SIGKILL" }, "", "");
      return undefined;
    };
    const run = createShellExec({ isDesktop: true, defaultCwd: null, execImpl });
    await expect(run("x")).rejects.toThrow("El comando terminó por la señal SIGKILL");
  });
});
