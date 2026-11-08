// Obsidian (Electron) expone `window`; Node no. El código del plugin usa
// `window.setTimeout` / `window.crypto` por compatibilidad con ventanas
// popout, así que en los tests `window` apunta al global de Node.
// Se asigna sobre `globalThis` para que `vi.useFakeTimers()` siga
// interceptando `window.setTimeout`.
const g = globalThis as unknown as { window?: typeof globalThis };
g.window ??= globalThis;
