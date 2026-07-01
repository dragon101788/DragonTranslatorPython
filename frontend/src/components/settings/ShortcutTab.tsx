import { useState, useCallback, useEffect, useRef } from "react";

interface ShortcutTabProps {
  modifiers: string[];
  keyCode: string;
  onSave: (modifiers: string[], keyCode: string) => void;
}

const KEY_LABELS: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Escape: "Esc",
  Tab: "Tab",
};
for (let i = 1; i <= 12; i++) KEY_LABELS[`F${i}`] = `F${i}`;
for (let i = 0; i <= 9; i++) KEY_LABELS[`Digit${i}`] = String(i);

const MODIFIER_KEYS = ["Ctrl", "Alt", "Shift", "Win"] as const;

// Which keys are "printable" and won't fire keypress naturally
const PRINTABLE_KEY_MAP: Record<string, string> = {
  " ": "Space",
};
for (let c = 65; c <= 90; c++) PRINTABLE_KEY_MAP[String.fromCharCode(c)] = String.fromCharCode(c);
for (let i = 0; i <= 9; i++) PRINTABLE_KEY_MAP[String(i)] = String(i);

function keyLabel(code: string): string {
  return KEY_LABELS[code] ?? code;
}

export default function ShortcutTab({ modifiers, keyCode, onSave }: ShortcutTabProps) {
  const [localMods, setLocalMods] = useState<string[]>([...modifiers]);
  const [localKey, setLocalKey] = useState(keyCode);
  const [status, setStatus] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  // Sync from props
  useEffect(() => {
    setLocalMods([...modifiers]);
    setLocalKey(keyCode);
  }, [modifiers, keyCode]);

  // ---- Recording key listener ----
  const recordingRef = useRef(false);
  recordingRef.current = recording;

  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setRecording(false);
        setStatus(null);
        e.preventDefault();
        return;
      }
      // Prevent trigger from reaching Tauri global shortcut
      e.preventDefault();
      e.stopPropagation();

      const mods: string[] = [];
      if (e.ctrlKey) mods.push("Ctrl");
      if (e.altKey) mods.push("Alt");
      if (e.shiftKey) mods.push("Shift");
      if (e.metaKey) mods.push("Win");

      // Determine main key (ignore pure modifier presses)
      const { key, code } = e;
      let mainKey = "";

      if (key.length === 1 && key >= "a" && key <= "z") {
        mainKey = key.toUpperCase();
      } else if (key === " ") {
        mainKey = "Space";
      } else if (key === "Escape") {
        return;
      } else if (code.startsWith("F") && code.length <= 4) {
        mainKey = code;
      } else if (["Control", "Shift", "Alt", "Meta", "OS", "CapsLock"].includes(key)) {
        return; // modifier-only, ignore
      } else if (key.length === 1) {
        mainKey = key.toUpperCase();
      } else {
        mainKey = key; // Enter, Tab, etc.
      }

      if (mainKey && mods.length > 0) {
        setLocalMods(mods);
        setLocalKey(mainKey);
        setRecording(false);
        // Auto-save on capture
        handleLocalSave(mods, mainKey);
      } else if (mainKey && mods.length === 0) {
        setStatus("⚠️ 请配合修饰键使用 (Ctrl/Alt/Shift/Win)");
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recording]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLocalSave = useCallback(
    async (mods: string[], key: string) => {
      if (!mods.length || !key) {
        setStatus("❌ 请选择修饰键和主键");
        return;
      }
      setStatus("⏳ 注册中...");
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("configure_shortcut", { modifiers: mods, key });
        onSave(mods, key);
        setStatus(`✅ ${mods.join("+")}+${keyLabel(key)}`);
      } catch (e: any) {
        setStatus(`❌ ${e}`);
      }
    },
    [onSave]
  );

  const handleStartRecording = useCallback(() => {
    setRecording(true);
    setStatus("⌨️ 按你的快捷键组合...");
  }, []);

  const toggleMod = useCallback((mod: string) => {
    setLocalMods((prev) =>
      prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]
    );
  }, []);

  const handleManualSave = useCallback(() => {
    handleLocalSave(localMods, localKey);
  }, [localMods, localKey, handleLocalSave]);

  // ---- Manual key picker ----
  const [showKeyPicker, setShowKeyPicker] = useState(false);

  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const FUNCTION_KEYS = ["F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12"];
  const SPECIAL_KEYS = ["Space", "Enter", "Tab", "Escape"];

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-lexi-text">全局快捷键</h3>
      <p className="text-sm text-lexi-text-muted">
        使用全局快捷键在任何应用中快速呼出 龙腾翻译 窗口。默认 Ctrl+Alt+X。
      </p>

      {/* Key display + recorder trigger */}
      <div className="p-5 bg-lexi-input/50 rounded-xl border border-lexi-border text-center">
        <div
          className={`inline-flex items-center gap-2 px-5 py-3 rounded-xl border transition-all select-none cursor-pointer ${
            recording
              ? "bg-lexi-accent/20 border-lexi-accent animate-pulse-glow"
              : "bg-lexi-card border-lexi-border hover:border-lexi-accent/40"
          }`}
          tabIndex={0}
          onClick={handleStartRecording}
        >
          {recording ? (
            <span className="text-sm text-lexi-accent-hover font-medium animate-pulse">
              ...
            </span>
          ) : localMods.length === 0 && !localKey ? (
            <span className="text-sm text-lexi-text-muted">点击录制</span>
          ) : (
            <>
              {localMods.map((m) => (
                <kbd
                  key={m}
                  className="px-3 py-1.5 bg-lexi-input border border-lexi-border rounded-lg text-sm font-mono text-lexi-text"
                >
                  {m}
                </kbd>
              ))}
              <span className="text-lexi-text-muted">+</span>
              {localKey && (
                <kbd className="px-3 py-1.5 bg-lexi-accent/20 border border-lexi-accent/40 rounded-lg text-sm font-mono text-lexi-accent-hover font-semibold">
                  {keyLabel(localKey)}
                </kbd>
              )}
            </>
          )}
        </div>
        <p className="text-xs text-lexi-text-muted mt-2">
          {recording ? "按下组合键 (Esc 取消)" : "点击上方区域开始录制"}
        </p>
      </div>

      {/* Manual: modifier toggles + key picker */}
      <div>
        <p className="text-xs text-lexi-text-muted mb-2">修饰键：</p>
        <div className="flex gap-2 mb-3">
          {MODIFIER_KEYS.map((mod) => (
            <button
              key={mod}
              onClick={() => toggleMod(mod)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all border ${
                localMods.includes(mod)
                  ? "bg-lexi-accent/20 border-lexi-accent/40 text-lexi-accent-hover"
                  : "bg-lexi-input border-lexi-border text-lexi-text-muted hover:text-lexi-text"
              }`}
            >
              {mod}
            </button>
          ))}
        </div>

        <p className="text-xs text-lexi-text-muted mb-2">主键：</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowKeyPicker(!showKeyPicker)}
            className={`px-3 py-1.5 rounded-lg text-sm font-mono border transition-all min-w-[4rem] ${
              localKey
                ? "bg-lexi-accent/20 border-lexi-accent/40 text-lexi-accent-hover"
                : "bg-lexi-input border-lexi-border text-lexi-text-muted"
            }`}
          >
            {localKey ? keyLabel(localKey) : "选择"}
          </button>
          <button
            onClick={handleManualSave}
            disabled={!localMods.length || !localKey}
            className="px-4 py-1.5 rounded-lg bg-lexi-accent/20 hover:bg-lexi-accent/30 disabled:opacity-30 disabled:cursor-not-allowed text-lexi-accent-hover text-sm font-medium transition-all"
          >
            应用
          </button>
          {status && (
            <span
              className={`text-sm animate-fade-in ${
                status.startsWith("✅")
                  ? "text-green-400"
                  : status.startsWith("❌")
                    ? "text-red-400"
                    : "text-lexi-text-muted"
              }`}
            >
              {status}
            </span>
          )}
        </div>

        {showKeyPicker && (
          <div className="mt-3 p-3 bg-lexi-input rounded-lg border border-lexi-border">
            <div className="mb-2">
              <span className="text-xs text-lexi-text-muted">字母</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {LETTERS.split("").map((l) => (
                  <button
                    key={l}
                    onClick={() => { setLocalKey(l); setShowKeyPicker(false); }}
                    className={`w-8 h-8 text-xs font-mono rounded ${
                      localKey === l
                        ? "bg-lexi-accent/20 text-lexi-accent-hover"
                        : "bg-lexi-card text-lexi-text-muted hover:text-lexi-text"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-2">
              <span className="text-xs text-lexi-text-muted">功能键</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {FUNCTION_KEYS.map((k) => (
                  <button
                    key={k}
                    onClick={() => { setLocalKey(k); setShowKeyPicker(false); }}
                    className={`px-2 h-8 text-xs font-mono rounded ${
                      localKey === k
                        ? "bg-lexi-accent/20 text-lexi-accent-hover"
                        : "bg-lexi-card text-lexi-text-muted hover:text-lexi-text"
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="text-xs text-lexi-text-muted">特殊</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {SPECIAL_KEYS.map((k) => (
                  <button
                    key={k}
                    onClick={() => { setLocalKey(k); setShowKeyPicker(false); }}
                    className={`px-2 h-8 text-xs font-mono rounded ${
                      localKey === k
                        ? "bg-lexi-accent/20 text-lexi-accent-hover"
                        : "bg-lexi-card text-lexi-text-muted hover:text-lexi-text"
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
