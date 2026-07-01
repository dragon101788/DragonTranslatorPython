import { useCallback, useState, useEffect } from "react";
import { useConfigStore } from "../stores/configStore";
import { logger } from "../services/logger";

// ---------------------------------------------------------------------------
// Detect Tauri environment
// ---------------------------------------------------------------------------

function isTauriEnv(): boolean {
  return (
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
  );
}

// ---------------------------------------------------------------------------
// Global speaking state (shared across all useTTS instances)
// Since TTS playback is now background, we need a module-level flag so that
// all components see the same "is-speaking" state and the per-instance
// guard prevents concurrent calls.
// ---------------------------------------------------------------------------

let globalSpeaking = false;
const subscribers = new Set<() => void>();
let ttsEventListening = false;

function setGlobalSpeaking(v: boolean) {
  globalSpeaking = v;
  subscribers.forEach((fn) => fn());
}

// ---------------------------------------------------------------------------
// TTS hook — Piper (Tauri invoke) with Web Speech API fallback
// ---------------------------------------------------------------------------

export interface TtsState {
  isSpeaking: boolean;
  error: string | null;
}

const TAG = "[TTS-FE]";

/** Detect text language (simple heuristic: check for CJK characters) */
function detectTextLang(text: string): string {
  // If text contains mostly CJK characters, it's likely Chinese
  const cjkCount = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
  if (cjkCount > text.length * 0.3) return "zh";
  // If mostly ASCII, it's likely English
  const asciiCount = (text.match(/[a-zA-Z]/g) || []).length;
  if (asciiCount > text.length * 0.5) return "en";
  return "auto";
}

export function useTTS() {
  const [localIsSpeaking, setLocalIsSpeaking] = useState(globalSpeaking);
  const [state, setState] = useState<TtsState>({ isSpeaking: false, error: null });

  // Subscribe to global speaking state
  useEffect(() => {
    const fn = () => setLocalIsSpeaking(globalSpeaking);
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);

  // Singleton listener for tts_complete event from Rust backend
  useEffect(() => {
    if (!isTauriEnv() || ttsEventListening) return;
    ttsEventListening = true;

    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("tts_complete", () => {
        console.log(TAG, "tts_complete event received");
        setGlobalSpeaking(false);
        setState({ isSpeaking: false, error: null });
      }).then((fn) => {
        unlisten = fn;
      });
    });

    return () => {
      unlisten?.();
      ttsEventListening = false;
    };
  }, []);

  const speak = useCallback(
    async (text: string, lang?: string) => {
      if (!text || globalSpeaking) return;

      const clean = text.replace(/<[^>]*>/g, "");
      const isTauri = isTauriEnv();

      // Auto-detect language if not explicitly provided
      const effectiveLang = lang || detectTextLang(clean);
      const voice = useConfigStore.getState().settings.ttsVoice?.[effectiveLang] || null;

      console.log(TAG, "speak() called", {
        lang: lang || "(auto)",
        effectiveLang,
        textLen: clean.length,
        isTauri,
        voiceOverride: voice || "(none)",
        preview: clean.slice(0, 60) + (clean.length > 60 ? "..." : ""),
      });
      logger.info(
        `TTS speak: effectiveLang="${effectiveLang}" voice="${voice || "auto"}" text_len=${clean.length} preview="${clean.slice(0, 40)}"`
      );

      if (isTauri) {
        // ---- Piper via Tauri invoke (non-blocking, returns immediately) ----
        try {
          setGlobalSpeaking(true);
          setState({ isSpeaking: true, error: null });

          console.log(TAG, `invoking tts_speak lang="${effectiveLang}" voice="${voice || "auto"}"`);
          logger.info(`TTS invoking tts_speak lang="${effectiveLang}" voice="${voice || "auto"}"`);
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("tts_speak", {
            text: clean,
            lang: effectiveLang,
            voice,
          });
          // invoke returns immediately now (background playback)
          console.log(TAG, "tts_speak dispatched (background playback)");
        } catch (e: any) {
          setGlobalSpeaking(false);
          const msg = typeof e === "string" ? e : e?.message || String(e);
          console.error(TAG, "tts_speak FAILED:", msg);
          logger.error(`tts_speak failed (lang=${effectiveLang}): ${msg}`);
          setState({ isSpeaking: false, error: msg });

          // Fallback to Web Speech API on error
          console.warn(TAG, "falling back to Web Speech API...");
          logger.warn(`falling back to Web Speech API for lang=${effectiveLang}`);
          tryWebSpeech(clean, effectiveLang, setGlobalSpeaking, setState);
        }
      } else {
        // ---- Browser mode: Web Speech API ----
        console.log(TAG, "browser mode, using Web Speech API");
        tryWebSpeech(clean, effectiveLang, setGlobalSpeaking, setState);
      }
    },
    []
  );

  const stop = useCallback(async () => {
    console.log(TAG, "stop() called");
    setGlobalSpeaking(false);

    if (isTauriEnv()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("tts_stop");
        console.log(TAG, "tts_stop OK");
      } catch (e) {
        console.warn(TAG, "tts_stop failed:", e);
      }
    } else {
      window.speechSynthesis.cancel();
    }
    setState({ isSpeaking: false, error: null });
  }, []);

  return { speak, stop, isSpeaking: localIsSpeaking, error: state.error };
}

// ---------------------------------------------------------------------------
// Web Speech API fallback
// ---------------------------------------------------------------------------

function tryWebSpeech(
  text: string,
  lang: string | undefined,
  setGlobalSpeaking: (v: boolean) => void,
  setState: (s: TtsState) => void
) {
  const TAG_WS = "[TTS-FE:WebSpeech]";
  console.log(TAG_WS, "using system voice for lang=", lang || "(auto)");

  window.speechSynthesis.cancel();

  const langMap: Record<string, string> = {
    zh: "zh-CN",
    en: "en-US",
    ja: "ja-JP",
    ko: "ko-KR",
    fr: "fr-FR",
    de: "de-DE",
    es: "es-ES",
    ru: "ru-RU",
    pt: "pt-BR",
    ar: "ar-SA",
    th: "th-TH",
    vi: "vi-VN",
    auto: "",
  };

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = (lang && langMap[lang]) || lang || "";
  utterance.rate = 1.0;

  utterance.onstart = () => {
    console.log(TAG_WS, "speaking started");
    setGlobalSpeaking(true);
    setState({ isSpeaking: true, error: null });
  };
  utterance.onend = () => {
    console.log(TAG_WS, "speaking ended");
    setGlobalSpeaking(false);
    setState({ isSpeaking: false, error: null });
  };
  utterance.onerror = (e) => {
    console.error(TAG_WS, "speaking error:", e.error);
    setGlobalSpeaking(false);
    setState({ isSpeaking: false, error: e.error || "Speech synthesis error" });
  };

  window.speechSynthesis.speak(utterance);
}
