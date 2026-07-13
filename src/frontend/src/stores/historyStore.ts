import { create } from "zustand";
import type { TranslationSession } from "../types";

interface HistoryStore {
  sessions: TranslationSession[];
  searchQuery: string;
  filterProvider: string;
  showFavoritesOnly: boolean;
  selectedSessionIds: Set<string>;

  // Core actions
  addSession: (session: TranslationSession) => void;
  deleteSession: (id: string) => void;
  deleteSessions: (ids: string[]) => void;
  clearAll: () => void;
  toggleFavorite: (id: string) => void;
  updateSession: (id: string, updates: Partial<TranslationSession>) => void;
  setSessions: (sessions: TranslationSession[]) => void;

  // Filter actions
  setSearchQuery: (query: string) => void;
  setFilterProvider: (providerId: string) => void;
  setShowFavoritesOnly: (show: boolean) => void;

  // Selection actions
  toggleSessionSelection: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;

  // Computed
  getFilteredSessions: () => TranslationSession[];
  getFavoriteSessions: () => TranslationSession[];
  getTimeGroupedSessions: () => {
    today: TranslationSession[];
    yesterday: TranslationSession[];
    earlier: TranslationSession[];
  };
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  sessions: [],
  searchQuery: "",
  filterProvider: "",
  showFavoritesOnly: false,
  selectedSessionIds: new Set<string>(),

  // ---- Core actions ----

  addSession: (session) =>
    set((state) => ({
      sessions: [session, ...state.sessions].slice(0, 1000), // Keep max 1000
    })),

  deleteSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      selectedSessionIds: (() => {
        const next = new Set(state.selectedSessionIds);
        next.delete(id);
        return next;
      })(),
    })),

  deleteSessions: (ids) => {
    const idSet = new Set(ids);
    set((state) => ({
      sessions: state.sessions.filter((s) => !idSet.has(s.id)),
      selectedSessionIds: new Set<string>(),
    }));
  },

  clearAll: () => set({ sessions: [], selectedSessionIds: new Set() }),

  toggleFavorite: (id) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, isFavorite: !s.isFavorite } : s
      ),
    })),

  updateSession: (id, updates) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      ),
    })),

  setSessions: (sessions) => set({ sessions, selectedSessionIds: new Set() }),

  // ---- Filter actions ----

  setSearchQuery: (query) => set({ searchQuery: query }),

  setFilterProvider: (providerId) => set({ filterProvider: providerId }),

  setShowFavoritesOnly: (show) => set({ showFavoritesOnly: show }),

  // ---- Selection actions ----

  toggleSessionSelection: (id) =>
    set((state) => {
      const next = new Set(state.selectedSessionIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selectedSessionIds: next };
    }),

  selectAll: () =>
    set((state) => {
      const filtered = state.getFilteredSessions();
      return { selectedSessionIds: new Set(filtered.map((s) => s.id)) };
    }),

  deselectAll: () => set({ selectedSessionIds: new Set<string>() }),

  // ---- Computed ----

  getFilteredSessions: () => {
    const state = get();
    let sessions = state.sessions;

    if (state.showFavoritesOnly) {
      sessions = sessions.filter((s) => s.isFavorite);
    }

    if (state.filterProvider) {
      sessions = sessions.filter((s) =>
        s.results.some((r) => r.providerId === state.filterProvider)
      );
    }

    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      sessions = sessions.filter(
        (s) =>
          s.sourceText.toLowerCase().includes(q) ||
          s.results.some((r) => r.translatedText.toLowerCase().includes(q))
      );
    }

    return sessions;
  },

  getFavoriteSessions: () => get().sessions.filter((s) => s.isFavorite),

  getTimeGroupedSessions: () => {
    const sessions = get().getFilteredSessions();
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();
    const yesterdayStart = todayStart - 86400000;

    return {
      today: sessions.filter((s) => s.timestamp >= todayStart),
      yesterday: sessions.filter(
        (s) => s.timestamp >= yesterdayStart && s.timestamp < todayStart
      ),
      earlier: sessions.filter((s) => s.timestamp < yesterdayStart),
    };
  },
}));
