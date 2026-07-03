/**
 * Bridge layer — invoke/listen/getCurrentWindow for pywebview.
 * Routes calls to the Python backend via window.pywebview.api.
 */

// ---------------------------------------------------------------------------
// Pywebview API helpers
// ---------------------------------------------------------------------------

function pywebviewApi(): any {
  return (window as any).pywebview?.api;
}

/**
 * Wait for pywebview API to be ready.
 * On startup there's a brief window where the page script runs before
 * pywebview finishes injecting its JS bridge.
 */
async function waitForPywebviewApi(timeoutMs = 5000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const api = pywebviewApi();
    if (api) return api;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

/** Cached API reference — resolves once and reused. */
let _pywebviewApiReady: Promise<any> | null = null;
function getPywebviewApi(): Promise<any> {
  if (!_pywebviewApiReady) {
    _pywebviewApiReady = waitForPywebviewApi();
  }
  return _pywebviewApiReady;
}

// ---------------------------------------------------------------------------
// invoke() — call backend command
// ---------------------------------------------------------------------------

/**
 * Call a backend command and return its result.
 *
 * In pywebview:  args are passed as a single object to match the JsApi
 *                method signature (each JsApi method receives a dict).
 *                For methods that take primitive args (like delete_model),
 *                the args dict is unwrapped automatically.
 *
 * In browser:    falls back to console.warn.
 */
export async function invoke<T = any>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  // Always wait for pywebview API — it may not be injected yet at page load
  const api = await getPywebviewApi();
  if (api) {
    // Map snake_case command to camelCase method (pywebview convention)
    // e.g. "get_app_dir" -> "getAppDir"
    const method = cmd.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

    if (typeof api[method] === "function") {
      try {
        const hasArgs = args != null && Object.keys(args).length > 0;
        const result = hasArgs ? api[method](args) : api[method]();
        return result instanceof Promise ? await result : result;
      } catch (e: any) {
        throw new Error(e?.message || String(e));
      }
    }

    // Fallback: if no camelCase method, try direct snake_case
    if (typeof api[cmd] === "function") {
      try {
        const hasArgs = args != null && Object.keys(args).length > 0;
        const result = hasArgs ? api[cmd](args) : api[cmd]();
        return result instanceof Promise ? await result : result;
      } catch (e: any) {
        throw new Error(e?.message || String(e));
      }
    }

    throw new Error(`Backend method not found: ${method} (${cmd})`);
  }

  throw new Error(
    `Backend not available. Command "${cmd}" cannot be executed.`
  );
}

// ---------------------------------------------------------------------------
// listen() — subscribe to backend events
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
 * In browser:   no-op listener.
 */
export async function listen<T = any>(
  event: string,
  callback: (event: { payload: T }) => void
): Promise<UnlistenFn> {
  const interval = setInterval(async () => {
    try {
      const api = pywebviewApi();
      if (!api) return;
      const pollFn = api.poll_events || api.pollEvents;
      const events = pollFn ? await Promise.resolve(pollFn(event)) : [];
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

// ---------------------------------------------------------------------------
// getCurrentWindow() — window control
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
  // Resolve API on each call — pywebview.api may not be injected yet
  // when this is called during React useEffect on mount.
  const _api = () => pywebviewApi();

  return {
      async isMaximized(): Promise<boolean> {
        return _maximized;
      },

      async onResized(callback: () => void): Promise<UnlistenFn> {
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
        // CSS pywebview-drag-region handles this natively
      },

      async minimize(): Promise<void> {
        const a = _api();
        if (!a) throw new Error("pywebview API not ready");
        // Use unique name to avoid shadowing pywebview's built-in minimize
        a.window_minimize();
      },

      async toggleMaximize(): Promise<void> {
        const a = _api();
        if (!a) throw new Error("pywebview API not ready");
        a.window_toggle_maximize();
        _maximized = !_maximized;
      },

      async close(): Promise<void> {
        const a = _api();
        if (!a) throw new Error("pywebview API not ready");
        a.window_close();
      },

      async hide(): Promise<void> {
        const a = _api();
        if (!a) throw new Error("pywebview API not ready");
        a.hide();
        _visible = false;
      },

      async show(): Promise<void> {
        const a = _api();
        if (!a) throw new Error("pywebview API not ready");
        a.show();
        _visible = true;
      },

      async isVisible(): Promise<boolean> {
        return _visible;
      },

      async isMinimized(): Promise<boolean> {
        return !_visible;
      },

      async setFocus(): Promise<void> {
        const a = _api();
        if (!a) throw new Error("pywebview API not ready");
        a.focus();
      },

      async unminimize(): Promise<void> {
        const a = _api();
        if (!a) throw new Error("pywebview API not ready");
        a.restore();
        _visible = true;
      },

      async onCloseRequested(callback: () => void): Promise<UnlistenFn> {
        const handler = (e: BeforeUnloadEvent) => {
          callback();
          e.preventDefault();
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
      },
  };
}
