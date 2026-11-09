import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import { createShellExec } from "../src/ui/buttons/shellExec";

describe("createShellExec", () => {
  it("rechaza en móvil", async () => {
    const run = createShellExec({ isDesktop: false, defaultCwd: null });
    await expect(run("echo x")).rejects.toThrow("ctx.run sólo está disponible en escritorio");
  });

  it("captura stdout con código 0", async () => {
    const run = createShellExec({ isDesktop: true, defaultCwd: null });
    const r = await run("node -e \"process.stdout.write('hola')\"");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("hola");
  });

  it("devuelve código distinto de 0 sin rechazar", async () => {
    const run = createShellExec({ isDesktop: true, defaultCwd: null });
    const r = await run("node -e \"process.exit(3)\"");
    expect(r.code).toBe(3);
  });

  it("captura stderr", async () => {
    const run = createShellExec({ isDesktop: true, defaultCwd: null });
    const r = await run("node -e \"process.stderr.write('err')\"");
    expect(r.stderr).toBe("err");
  });

  it("respeta cwd", async () => {
    const run = createShellExec({ isDesktop: true, defaultCwd: null });
    const dir = os.tmpdir();
    const r = await run("node -e \"process.stdout.write(process.cwd())\"", { cwd: dir });
    expect(fs.realpathSync(r.stdout)).toBe(fs.realpathSync(dir));
  });

  it("usa defaultCwd si no se pasa cwd", async () => {
    const dir = os.tmpdir();
    const run = createShellExec({ isDesktop: true, defaultCwd: dir });
    const r = await run("node -e \"process.stdout.write(process.cwd())\"");
    expect(fs.realpathSync(r.stdout)).toBe(fs.realpathSync(dir));
  });

  it("rechaza por tiempo límite", async () => {
    const run = createShellExec({ isDesktop: true, defaultCwd: null });
    await expect(
      run("node -e \"setTimeout(()=>{},5000)\"", { timeoutMs: 200 })
    ).rejects.toThrow("superó el tiempo límite");
  });
});
