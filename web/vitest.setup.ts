// A deterministic in-memory localStorage for tests, so the mock feature slices
// (which persist to localStorage) round-trip reliably regardless of the jsdom
// version's storage implementation.
class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

Object.defineProperty(globalThis, "localStorage", { value: new MemStorage(), writable: true });
Object.defineProperty(window, "localStorage", { value: globalThis.localStorage, writable: true });
