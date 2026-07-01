/**
 * Bridge layer that replaces @tauri-apps/api/{core,event,window}
 * and @tauri-apps/plugin-store.
 *
 * Detects whether we are running inside pywebview (Python) or Tauri (Rust)
 * and routes calls to the appropriate backend.
 *
 * This is the ONLY file that imports pywebview or Tauri APIs directly.
 * All other frontend code imports from this module or uses the
 * vite.config.ts aliases that redirect @tauri-apps/api/* → this file.
 *
 * NOTE: In pywebview, window.__TAURI_INTERNALS__ is injected by Python
 * at startup so that existing isTauriEnv() checks pass. The actual
 * backend is pywebview, but the Tauri-compatible API surface is provided
 * here via the bridge.
 */

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

export function isPywebview(): boolean {
  return (
    typeof window !== "undefined" &&
    "pywebview" in window &&
    (window as any).pywebview !== undefined
  );
}

function isTauri(): boolean {
  // In pywebview, we inject __TAURI_INTERNALS__ so this returns true.
  // The bridge handles all API calls regardless.
  return (
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
  );
}

// ---------------------------------------------------------------------------
// Pywebview API helpers
// ---------------------------------------------------------------------------

function pywebviewApi(): any {
  return (window as any).pywebview.api;
}

// ---------------------------------------------------------------------------
// invoke() — replaces @tauri-apps/api/core::invoke
// ---------------------------------------------------------------------------

/**
 * Call a backend command and return its result.
 *
 * In pywebview:  args are passed as a single object to match the JsApi
 *                method signature (each JsApi method receives a dict).
 *                For methods that take primitive args (like delete_model),
 *                the args dict is unwrapped automatically.
 *
 * In Tauri:      standard invoke(cmd, args) behavior.
 */
export async function invoke<T = any>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  if (isPywebview()) {
    const api = pywebviewApi();
    // Map snake_case command to camelCase method (pywebview convention)
    // e.g. "get_app_dir" -> "getAppDir"
    const method = cmd.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

    if (typeof api[method] === "function") {
      try {
        // Some methods take a dict, some take a single value.
        // We pass args dict and let Python handle unwrapping.
        const result = api[method](args || {});
        // pywebview returns values synchronously, but may return a promise in
        // some configurations. Handle both.
        return result instanceof Promise ? await result : result;
      } catch (e: any) {
        throw new Error(e?.message || String(e));
      }
    }

    // Fallback: if no camelCase method, try direct snake_case
    if (typeof api[cmd] === "function") {
      try {
        const result = api[cmd](args || {});
        return result instanceof Promise ? await result : result;
      } catch (e: any) {
        throw new Error(e?.message || String(e));
      }
    }

    throw new Error(`Backend method not found: ${method} (${cmd})`);
  }

  // Tauri fallback
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke(cmd, args);
  }

  throw new Error("No backend available (not pywebview, not Tauri)");
}

// ---------------------------------------------------------------------------
// listen() — replaces @tauri-apps/api/event::listen
// ---------------------------------------------------------------------------

interface UnlistenFn {
  (): void;
}

/**
 * Listen for events emitted by the Python backend.
 *
 * In pywebview: polls window.pywebview.api.poll_events(eventName)
 *               every 100ms. Returns an unlisten function that
 *               clears the polling interval.
 *
 * In Tauri:     uses Tauri's native event system.
 */
export async function listen<T = any>(
  event: string,
  callback: (event: { payload: T }) => void
): Promise<UnlistenFn> {
  if (isPywebview()) {
    const api = pywebviewApi();
    const interval = setInterval(async () => {
      try {
        const events = await Promise.resolve(api.pollEvents(event));
        if (Array.isArray(events)) {
          for (const data of events) {
            callback({ payload: data });
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 100);

    return () => clearInterval(interval);
  }

  // Tauri fallback
  if (isTauri()) {
    const { listen: tauriListen } = await import("@tauri-apps/api/event");
    return tauriListen(event, callback);
  }

  // Browser fallback: no-op listener
  return () => {};
}

// ---------------------------------------------------------------------------
// getCurrentWindow() — replaces @tauri-apps/api/window::getCurrentWindow
// ---------------------------------------------------------------------------

interface WebviewWindow {
  isMaximized(): Promise<boolean>;
  onResized(callback: () => void): Promise<UnlistenFn>;
  startDragging(): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  hide(): Promise<void>;
  show(): Promise<void>;
  isVisible(): Promise<boolean>;
  isMinimized(): Promise<boolean>;
  setFocus(): Promise<void>;
  unminimize(): Promise<void>;
  onCloseRequested(callback: () => void): Promise<UnlistenFn>;
}

let _maximized = false;
let _visible = true;

export function getCurrentWindow(): WebviewWindow {
  if (isPywebview()) {
    const api = pywebviewApi();

    return {
      async isMaximized(): Promise<boolean> {
        return _maximized;
      },

      async onResized(callback: () => void): Promise<UnlistenFn> {
        // pywebview doesn't have resize events natively.
        // Poll window size to detect changes.
        let lastW = window.innerWidth;
        let lastH = window.innerHeight;
        const interval = setInterval(() => {
          if (window.innerWidth !== lastW || window.innerHeight !== lastH) {
            lastW = window.innerWidth;
            lastH = window.innerHeight;
            callback();
          }
        }, 200);
        return () => clearInterval(interval);
      },

      async startDragging(): Promise<void> {
        // CSS -webkit-app-region: drag handles this natively
        // No explicit API call needed
      },

      async minimize(): Promise<void> {
        try {
          api.minimize();
        } catch {}
      },

      async toggleMaximize(): Promise<void> {
        try {
          api.toggleMaximize();
          _maximized = !_maximized;
        } catch {}
      },

      async close(): Promise<void> {
        try {
          api.close();
        } catch {}
      },

      async hide(): Promise<void> {
        try {
          api.hide();
          _visible = false;
        } catch {}
      },

      async show(): Promise<void> {
        try {
          api.show();
          _visible = true;
        } catch {}
      },

      async isVisible(): Promise<boolean> {
        return _visible;
      },

      async isMinimized(): Promise<boolean> {
        return !_visible;
      },

      async setFocus(): Promise<void> {
        try {
          api.focus();
        } catch {}
      },

      async unminimize(): Promise<void> {
        try {
          api.restore();
          _visible = true;
        } catch {}
      },

      async onCloseRequested(callback: () => void): Promise<UnlistenFn> {
        // Hook into beforeunload
        const handler = (e: BeforeUnloadEvent) => {
          callback();
          e.preventDefault();
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
      },
    };
  }

  // Tauri fallback
  if (isTauri()) {
    const {
      getCurrentWindow: tauriGetCurrentWindow,
    } = await import("@tauri-apps/api/window");
    return tauriGetCurrentWindow();
  }

  // Browser fallback
  return {
    async isMaximized() {
      return false;
    },
    async onResized(_cb: () => void) {
      return () => {};
    },
    async startDragging() {},
    async minimize() {},
    async toggleMaximize() {},
    async close() {
      window.close();
    },
    async hide() {},
    async show() {},
    async isVisible() {
      return true;
    },
    async isMinimized() {
      return false;
    },
    async setFocus() {},
    async unminimize() {},
    async onCloseRequested(cb: () => void) {
      window.addEventListener("beforeunload", cb);
      return () => window.removeEventListener("beforeunload", cb);
    },
  };
}

// ---------------------------------------------------------------------------
// Store — replaces @tauri-apps/plugin-store
// ---------------------------------------------------------------------------

export interface Store {
  get<T = any>(key: string): Promise<T | null>;
  set(key: string, value: any): Promise<void>;
  save(): Promise<void>;
  onCloseRequested(callback: () => void): Promise<UnlistenFn>;
}

/**
 * Load (or create) a JSON store at the given path.
 *
 * In pywebview: delegates to Python backend for file I/O on config.json.
 * In Tauri:     uses the native plugin-store.
 */
export async function load(
  path: string,
  options?: { autoSave?: boolean }
): Promise<Store> {
  if (isPywebview()) {
    const api = pywebviewApi();

    // In-memory cache for the store data
    let _dirty = false;
    const autoSave = options?.autoSave ?? false;

    const store: Store = {
      async get<T = any>(key: string): Promise<T | null> {
        try {
          const result = api.configGet(key);
          const value = result instanceof Promise ? await result : result;
          return value as T | null;
        } catch {
          return null;
        }
      },

      async set(key: string, value: any): Promise<void> {
        _dirty = true;
        try {
          api.configSet({ key, value });
        } catch {
          // best effort
        }
        if (autoSave) {
          await store.save();
        }
      },

      async save(): Promise<void> {
        if (!_dirty) return;
        _dirty = false;
        try {
          api.configSave();
        } catch {
          // best effort
        }
      },

      async onCloseRequested(_callback: () => void): Promise<UnlistenFn> {
        return () => {};
      },
    };

    return store;
  }

  // Tauri fallback
  if (isTauri()) {
    const { load: tauriLoad } = await import("@tauri-apps/plugin-store");
    return tauriLoad(path, options) as Promise<Store>;
  }

  // Browser fallback: use localStorage
  const browserStore: Store = {
    async get<T = any>(key: string): Promise<T | null> {
      try {
        const raw = localStorage.getItem("dragon-translator-config");
        if (!raw) return null;
        const data = JSON.parse(raw);
        return (data[key] ?? null) as T | null;
      } catch {
        return null;
      }
    },

    async set(key: string, value: any): Promise<void> {
      try {
        const raw = localStorage.getItem("dragon-translator-config") || "{}";
        const data = JSON.parse(raw);
        data[key] = value;
        localStorage.setItem("dragon-translator-config", JSON.stringify(data));
      } catch {
        // best effort
      }
    },

    async save(): Promise<void> {
      // no-op: set already writes to localStorage
    },

    async onCloseRequested(_callback: () => void): Promise<UnlistenFn> {
      return () => {};
    },
  };
  return browserStore;
}
