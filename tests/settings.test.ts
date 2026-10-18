import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  normalizeVaultFolderPath,
  type PluginSettings,
} from "../src/settings";

describe("settings", () => {
  describe("usesDefaultFolders", () => {
    it("exposes Projects and Projects/_templates as the default folder names", () => {
      const defaults: PluginSettings = DEFAULT_SETTINGS;

      expect(defaults.projectsFolder).toBe("Projects");
      expect(defaults.templatesFolder).toBe("Projects/_templates");
    });
  });

  describe("defaultsCredentialLock", () => {
    it("locks credentials after 15 minutes with no key material by default", () => {
      const defaults: PluginSettings = DEFAULT_SETTINGS;

      expect(defaults.credentialLockTimeoutMinutes).toBe(15);
      expect(defaults.credSaltB64).toBeUndefined();
      expect(defaults.credVerifier).toBeUndefined();
    });
  });

  describe("normalizesFolderPath", () => {
    it("returns the fallback for an empty string", () => {
      expect(normalizeVaultFolderPath("", "Projects")).toBe("Projects");
    });

    it("returns the fallback for whitespace-only input", () => {
      expect(normalizeVaultFolderPath("   ", "Tasks")).toBe("Tasks");
    });

    it("trims surrounding whitespace from a valid folder name", () => {
      expect(normalizeVaultFolderPath("  Projects  ", "fallback")).toBe("Projects");
      expect(normalizeVaultFolderPath("  Tasks  ", "fallback")).toBe("Tasks");
    });
  });

  describe("backslashToSlash", () => {
    it("converts backslashes to forward slashes", () => {
      expect(normalizeVaultFolderPath("Projects\\Sub", "fallback")).toBe("Projects/Sub");
    });
  });

  describe("rejectsAbsolutePath", () => {
    it("returns the fallback for POSIX absolute paths", () => {
      expect(normalizeVaultFolderPath("/etc/Projects", "Tasks")).toBe("Tasks");
      expect(normalizeVaultFolderPath("/", "Tasks")).toBe("Tasks");
    });

    it("returns the fallback for Windows drive-letter paths", () => {
      expect(normalizeVaultFolderPath("C:\\Projects", "Tasks")).toBe("Tasks");
      expect(normalizeVaultFolderPath("D:/Projects", "Tasks")).toBe("Tasks");
    });
  });

  describe("rejectsParentTraversal", () => {
    it("returns the fallback for parent traversal segments", () => {
      expect(normalizeVaultFolderPath("..", "Tasks")).toBe("Tasks");
      expect(normalizeVaultFolderPath("../Projects", "Tasks")).toBe("Tasks");
      expect(normalizeVaultFolderPath("Projects/../etc", "Tasks")).toBe("Tasks");
      expect(normalizeVaultFolderPath("Projects/..", "Tasks")).toBe("Tasks");
    });
  });

  describe("collapsesSlashes", () => {
    it("collapses runs of forward slashes into one", () => {
      expect(normalizeVaultFolderPath("Projects//Sub///Inner", "fallback")).toBe(
        "Projects/Sub/Inner",
      );
    });

    it("collapses mixed backslashes and forward slashes", () => {
      expect(normalizeVaultFolderPath("Projects\\\\Sub//Inner", "fallback")).toBe(
        "Projects/Sub/Inner",
      );
    });
  });
});