import { describe, it, expect } from "vitest";
import type { VaultNoteRef, VaultAdapter } from "../src/data/VaultAdapter";
import { ProjectTaskRepository } from "../src/data/ProjectTaskRepository";
import { DEFAULT_SETTINGS, type PluginSettings } from "../src/settings";
import {
  DEFAULT_TEMPLATE_CONTENT,
  TEMPLATE_FILE_NAMES,
} from "../src/domain/templates";
import type { CalendarEventRecord } from "../src/domain/types";

// ---------------------------------------------------------------------------
// In-memory fake VaultAdapter for calendar repository tests.
//
// A lean, self-contained fake that supports the load() + CRUD surface the
// calendar feature needs: folder creation, markdown files, frontmatter
// patches, trash, link resolution and subfolder listing.
// ---------------------------------------------------------------------------

interface FakeVaultState {
  files: Map<string, string>;
  folders: Set<string>;
}

function createFakeVault(): FakeVaultState & VaultAdapter {
  const files = new Map<string, string>();
  const folders = new Set<string>();

  const adapter: VaultAdapter = {
    listMarkdownFiles(folderPath: string): VaultNoteRef[] {
      const prefix = `${folderPath}/`;
      const refs: VaultNoteRef[] = [];
      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) continue;
        if (path.slice(prefix.length).includes("/")) continue;
        const basename = path.slice(path.lastIndexOf("/") + 1);
        refs.push({ path, basename });
      }
      return refs.sort((a, b) => a.path.localeCompare(b.path));
    },

    listFiles(): VaultNoteRef[] {
      return [];
    },

    async read(note: VaultNoteRef): Promise<string> {
      const content = files.get(note.path);
      if (content === undefined) {
        throw new Error(`Fake vault: file not found: ${note.path}`);
      }
      return content;
    },

    async createFolder(path: string): Promise<void> {
      const segments = path.split("/");
      let current = "";
      for (const seg of segments) {
        current = current.length === 0 ? seg : `${current}/${seg}`;
        folders.add(current);
      }
    },

    async createMarkdown(
      path: string,
      content: string,
    ): Promise<VaultNoteRef> {
      const dir = path.includes("/")
        ? path.slice(0, path.lastIndexOf("/"))
        : "";
      if (dir.length > 0) folders.add(dir);
      files.set(path, content);
      const basename = path.slice(path.lastIndexOf("/") + 1);
      return { path, basename };
    },

    async createBinary(): Promise<VaultNoteRef> {
      throw new Error("Fake vault: createBinary not implemented");
    },

    async rename(note: VaultNoteRef, newPath: string): Promise<VaultNoteRef> {
      const content = files.get(note.path);
      if (content === undefined) {
        throw new Error(`Fake vault: cannot rename missing file: ${note.path}`);
      }
      files.delete(note.path);
      files.set(newPath, content);
      const dir = newPath.includes("/")
        ? newPath.slice(0, newPath.lastIndexOf("/"))
        : "";
      if (dir.length > 0) folders.add(dir);
      const basename = newPath.slice(newPath.lastIndexOf("/") + 1);
      return { path: newPath, basename };
    },

    async processFrontMatter(
      note: VaultNoteRef,
      update: (frontmatter: Record<string, unknown>) => void,
    ): Promise<void> {
      const content = files.get(note.path);
      if (content === undefined) {
        throw new Error(
          `Fake vault: cannot processFrontMatter on missing file: ${note.path}`,
        );
      }
      const normalized = content.replace(/\r\n/g, "\n");
      const parsed = parseFrontmatter(normalized);
      const obj = parsed.frontmatter ?? {};
      update(obj);
      const rebuilt = rebuildFrontmatter(normalized, obj, parsed.body);
      files.set(note.path, rebuilt);
    },

    resolveLink(linkPath: string): VaultNoteRef | null {
      const normalized = stripLinkAlias(linkPath);
      const candidates: string[] = [];
      const tryAdd = (candidate: string): void => {
        if (files.has(candidate) && !candidates.includes(candidate)) {
          candidates.push(candidate);
        }
      };
      if (normalized.endsWith(".md")) {
        tryAdd(normalized);
      } else {
        tryAdd(`${normalized}.md`);
      }
      if (!normalized.includes("/")) {
        for (const path of files.keys()) {
          if (path.endsWith(`/${normalized}.md`)) tryAdd(path);
        }
      }
      if (candidates.length === 0) return null;
      const chosen = candidates[0];
      const basename = chosen.slice(chosen.lastIndexOf("/") + 1);
      return { path: chosen, basename };
    },

    listSubfolders(folderPath: string): string[] {
      const out: string[] = [];
      for (const path of folders) {
        const lastSlash = path.lastIndexOf("/");
        const parent = lastSlash >= 0 ? path.slice(0, lastSlash) : "";
        if (parent !== folderPath) continue;
        if (path.slice(lastSlash + 1).startsWith(".")) continue;
        out.push(path);
      }
      return out.sort();
    },

    exists(path: string): boolean {
      return files.has(path) || folders.has(path);
    },

    async renameFolder(): Promise<void> {
      throw new Error("Fake vault: renameFolder not implemented");
    },

    async trash(note: VaultNoteRef): Promise<void> {
      if (!files.has(note.path)) {
        throw new Error(`Fake vault: cannot trash missing file: ${note.path}`);
      }
      files.delete(note.path);
    },
  };

  return { files, folders, ...adapter };
}

interface Sliced {
  frontmatter: Record<string, unknown> | null;
  body: string;
}

function parseFrontmatter(content: string): Sliced {
  if (!content.startsWith("---\n")) return { frontmatter: null, body: content };
  const lines = content.split("\n");
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      const yaml = lines.slice(1, i).join("\n");
      const body = lines.slice(i + 1).join("\n");
      const obj: Record<string, unknown> = {};
      for (const line of yaml.split("\n")) {
        const idx = line.indexOf(":");
        if (idx < 0) continue;
        const key = line.slice(0, idx).trim();
        const raw = line.slice(idx + 1).trim();
        if (raw.length === 0) {
          obj[key] = null;
        } else if (raw === "true") {
          obj[key] = true;
        } else if (raw === "false") {
          obj[key] = false;
        } else if (/^-?\d+$/.test(raw)) {
          obj[key] = Number(raw);
        } else if (
          (raw.startsWith('"') && raw.endsWith('"')) ||
          (raw.startsWith("'") && raw.endsWith("'"))
        ) {
          obj[key] = raw.slice(1, -1);
        } else {
          obj[key] = raw;
        }
      }
      return { frontmatter: obj, body };
    }
  }
  return { frontmatter: null, body: content };
}

function rebuildFrontmatter(
  original: string,
  obj: Record<string, unknown>,
  body: string,
): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      lines.push(`${key}:`);
      continue;
    }
    if (typeof value === "string") {
      lines.push(`${key}: ${formatYamlString(value)}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      lines.push(`${key}: ${String(value)}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push("---");
  const bodyWithBreak = body.startsWith("\n") ? body : `\n${body}`;
  return `${lines.join("\n")}${bodyWithBreak}`;
}

function formatYamlString(value: string): string {
  if (/^[A-Za-z0-9 _.-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function stripLinkAlias(link: string): string {
  const pipe = link.indexOf("|");
  const head = pipe >= 0 ? link.slice(0, pipe) : link;
  const hash = head.indexOf("#");
  return hash >= 0 ? head.slice(0, hash) : head;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRepo(
  fake: FakeVaultState & VaultAdapter,
  settings: PluginSettings = { ...DEFAULT_SETTINGS },
): ProjectTaskRepository {
  return new ProjectTaskRepository(fake, settings);
}

function seedFile(
  fake: FakeVaultState & VaultAdapter,
  path: string,
  content: string,
): void {
  fake.files.set(path, content);
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  if (dir.length > 0) fake.folders.add(dir);
}

function seedProjectTemplates(
  fake: FakeVaultState & VaultAdapter,
  templatesFolder: string = DEFAULT_SETTINGS.templatesFolder,
): void {
  const projectKinds = ["project", "task", "note", "credentials"] as const;
  for (const kind of projectKinds) {
    seedFile(
      fake,
      `${templatesFolder}/${TEMPLATE_FILE_NAMES[kind]}`,
      DEFAULT_TEMPLATE_CONTENT[kind],
    );
  }
}

function projectNote(props: Record<string, unknown> = {}): string {
  const merged: Record<string, unknown> = {
    status: "active",
    created: "2026-01-15",
    tags: [],
    description: "",
    client: "",
    ...props,
  };
  const lines = ["---", "type: project"];
  for (const [key, value] of Object.entries(merged)) {
    lines.push(`${key}: ${formatValue(value)}`);
  }
  lines.push("---", "# Project", "", "Body.");
  return lines.join("\n");
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return `"${value.replace(/"/g, '\\"')}"`;
  if (Array.isArray(value)) return JSON.stringify(value);
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Calendar repository tests
// ---------------------------------------------------------------------------

describe("ProjectTaskRepository calendar", () => {
  it("seeds calendar folder and template on first load", async () => {
    const fake = createFakeVault();
    seedProjectTemplates(fake);
    const repo = makeRepo(fake);

    await repo.load();

    expect(fake.folders.has("Calendario")).toBe(true);
    expect(fake.folders.has("Calendario/_templates")).toBe(true);
    expect(fake.files.has("Calendario/_templates/evento.md")).toBe(true);
  });

  it("create returns Calendario/Fiesta.md and load lists it", async () => {
    const fake = createFakeVault();
    seedProjectTemplates(fake);
    const repo = makeRepo(fake);

    await repo.load();
    const path = await repo.createCalendarEvent({
      title: "Fiesta",
      kind: "evento",
      date: "2026-11-04",
    });

    expect(path).toBe("Calendario/Fiesta.md");

    const data = await repo.load();
    expect(data.calendarEvents).toHaveLength(1);
    const event = data.calendarEvents![0]!;
    expect(event.path).toBe("Calendario/Fiesta.md");
    expect(event.title).toBe("Fiesta");
    expect(event.kind).toBe("evento");
    expect(event.date).toBe("2026-11-04");
    expect(event.allDay).toBe(true);
    expect(event.recurrence).toBe("none");
    expect(event.status).toBe("open");
  });

  it("update changes time via processFrontMatter preserving body", async () => {
    const fake = createFakeVault();
    seedProjectTemplates(fake);
    const repo = makeRepo(fake);

    await repo.load();
    const path = await repo.createCalendarEvent({
      title: "Reunión",
      kind: "reunion",
      date: "2026-11-04",
      allDay: false,
      time: "10:00",
      body: "Llevar informe.",
    });

    await repo.updateCalendarEvent(path, { time: "11:30" });

    const data = await repo.load();
    const event = data.calendarEvents![0]!;
    expect(event.time).toBe("11:30");

    const content = fake.files.get(path)!;
    expect(content).toContain("Llevar informe.");
  });

  it("setCalendarEventStatus updates status atomically", async () => {
    const fake = createFakeVault();
    seedProjectTemplates(fake);
    const repo = makeRepo(fake);

    await repo.load();
    const path = await repo.createCalendarEvent({
      title: "Recordatorio",
      kind: "aviso",
      date: "2026-11-05",
    });

    await repo.setCalendarEventStatus(path, "done");

    const data = await repo.load();
    expect(data.calendarEvents![0]!.status).toBe("done");
  });

  it("deleteCalendarEvent moves to trash and removes from load", async () => {
    const fake = createFakeVault();
    seedProjectTemplates(fake);
    const repo = makeRepo(fake);

    await repo.load();
    const path = await repo.createCalendarEvent({
      title: "Borrar",
      kind: "evento",
      date: "2026-11-06",
    });

    await repo.deleteCalendarEvent(path);

    const data = await repo.load();
    expect(data.calendarEvents).toHaveLength(0);
    expect(fake.files.has(path)).toBe(false);
  });

  it("endDate before date surfaces as issue", async () => {
    const fake = createFakeVault();
    seedProjectTemplates(fake);
    seedFile(
      fake,
      "Calendario/Roto.md",
      ["---", "type: calendar-event", "kind: evento", "date: 2026-11-10", "endDate: 2026-11-09", "allDay: true", "recurrence: none", "created: 2026-11-01", "status: open", "---", ""].join("\n"),
    );
    const repo = makeRepo(fake);

    const data = await repo.load();

    expect(data.calendarEvents).toHaveLength(0);
    expect(
      data.issues.some((i) =>
        i.path === "Calendario/Roto.md" &&
        i.message.includes("endDate") &&
        i.message.includes("date"),
      ),
    ).toBe(true);
  });

  it("templates directory is excluded from calendar scan", async () => {
    const fake = createFakeVault();
    seedProjectTemplates(fake);
    const repo = makeRepo(fake);

    await repo.load();
    // Add an extra file inside the templates folder; it must not count as event.
    seedFile(fake, "Calendario/_templates/extra.md", "---\ntype: calendar-event\nkind: evento\ndate: 2026-11-04\nallDay: true\nrecurrence: none\ncreated: 2026-11-01\nstatus: open\n---\n");

    const data = await repo.load();
    expect(
      data.calendarEvents?.some((e) => e.path === "Calendario/_templates/extra.md"),
    ).toBe(false);
  });

  it("projectLink is optional and resolves to projectPath", async () => {
    const fake = createFakeVault();
    seedProjectTemplates(fake);
    seedFile(
      fake,
      "Projects/Web/Web.md",
      projectNote({ description: "Web project" }),
    );
    const repo = makeRepo(fake);

    await repo.load();
    const withProject = await repo.createCalendarEvent({
      title: "Sprint",
      kind: "reunion",
      date: "2026-11-07",
      projectLink: "Projects/Web/Web.md",
    });
    const withoutProject = await repo.createCalendarEvent({
      title: "Global",
      kind: "aviso",
      date: "2026-11-08",
    });

    const data = await repo.load();
    const events = new Map(data.calendarEvents!.map((e) => [e.path, e]));
    expect(events.get(withProject)!.projectPath).toBe("Projects/Web/Web.md");
    expect(events.get(withoutProject)!.projectPath).toBeUndefined();
  });
});
