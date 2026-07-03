import { create } from "zustand";
import type { LLMProvider, AppSettings, WebDAVConfig, BergamotConfig } from "../types";
import { DEFAULT_SETTINGS } from "../types";

interface ConfigStore {
  providers: LLMProvider[];
  activeProviderId: string | null;
  settings: AppSettings;

  // Provider actions
  setProviders: (providers: LLMProvider[]) => void;
  addProvider: (provider: LLMProvider) => void;
  updateProvider: (id: string, updates: Partial<LLMProvider>) => void;
  deleteProvider: (id: string) => void;
  setActiveProvider: (id: string) => void;
  getActiveProvider: () => LLMProvider | undefined;

  // Settings actions
  updateSettings: (updates: Partial<AppSettings>) => void;
  updateWebDAV: (updates: Partial<WebDAVConfig>) => void;
  updateBergamot: (updates: Partial<BergamotConfig>) => void;

  // Bulk
  importAll: (data: {
    providers: LLMProvider[];
    settings: AppSettings;
  }) => void;
  exportAll: () => {
    providers: LLMProvider[];
    settings: AppSettings;
  };
}

export const useConfigStore = create<ConfigStore>((set, get) => ({
  providers: [],
  activeProviderId: null,
  settings: { ...DEFAULT_SETTINGS },

  setProviders: (providers) => set({ providers }),

  addProvider: (provider) =>
    set((state) => ({
      providers: [...state.providers, provider],
      activeProviderId: state.activeProviderId ?? provider.id,
    })),

  updateProvider: (id, updates) =>
    set((state) => ({
      providers: state.providers.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      ),
    })),

  deleteProvider: (id) =>
    set((state) => {
      const filtered = state.providers.filter((p) => p.id !== id);
      return {
        providers: filtered,
        activeProviderId:
          state.activeProviderId === id
            ? filtered[0]?.id ?? null
            : state.activeProviderId,
      };
    }),

  setActiveProvider: (id) => set({ activeProviderId: id }),

  getActiveProvider: () => {
    const state = get();
    return state.providers.find((p) => p.id === state.activeProviderId);
  },

  updateSettings: (updates) =>
    set((state) => ({
      settings: { ...state.settings, ...updates },
    })),

  updateWebDAV: (updates) =>
    set((state) => ({
      settings: {
        ...state.settings,
        webdav: { ...state.settings.webdav, ...updates },
      },
    })),

  updateBergamot: (updates) =>
    set((state) => ({
      settings: {
        ...state.settings,
        bergamot: { ...state.settings.bergamot, ...updates },
      },
    })),

  importAll: (_data) => {
    // This is called after loading from WebDAV or local file
    // The actual store updates happen via the individual setters
  },

  exportAll: () => ({
    providers: get().providers,
    settings: get().settings,
  }),
}));
