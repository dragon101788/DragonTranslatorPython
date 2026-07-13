import { useState } from "react";
import { Trash2, Star, Search, Clock, ChevronRight, Copy, Check, RotateCcw, Download, CheckSquare, Square, List } from "lucide-react";
import { useHistoryStore } from "../../stores/historyStore";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { exportSessionsAsJson, exportSessionsAsMarkdown } from "../../services/historyExport";

interface HistoryPanelProps {
  onClose: () => void;
  onReuseText?: (text: string) => void;
}

export default function HistoryPanel({ onClose: _onClose, onReuseText }: HistoryPanelProps) {
  const sessions = useHistoryStore((s) => s.sessions);
  const deleteSession = useHistoryStore((s) => s.deleteSession);
  const deleteSessions = useHistoryStore((s) => s.deleteSessions);
  const toggleFavorite = useHistoryStore((s) => s.toggleFavorite);
  const clearAll = useHistoryStore((s) => s.clearAll);
  const selectedSessionIds = useHistoryStore((s) => s.selectedSessionIds);
  const toggleSessionSelection = useHistoryStore((s) => s.toggleSessionSelection);
  const selectAll = useHistoryStore((s) => s.selectAll);
  const deselectAll = useHistoryStore((s) => s.deselectAll);
  const getFilteredSessions = useHistoryStore((s) => s.getFilteredSessions);
  const setSearchQuery = useHistoryStore((s) => s.setSearchQuery);
  const setFilterProvider = useHistoryStore((s) => s.setFilterProvider);
  const setShowFavoritesOnly = useHistoryStore((s) => s.setShowFavoritesOnly);
  const filterProvider = useHistoryStore((s) => s.filterProvider);
  const showFavoritesOnly = useHistoryStore((s) => s.showFavoritesOnly);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [batchMode, setBatchMode] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Gather all unique provider names for the filter dropdown
  const providerNames = [...new Set(
    sessions.flatMap((s) => s.results.map((r) => r.providerName))
  )].sort();

  // Sync local search to store filter
  const handleSearch = (q: string) => {
    setSearch(q);
    setSearchQuery(q);
  };

  const handleProviderFilter = (p: string) => {
    setFilterProvider(p);
  };

  const handleFavoritesToggle = () => {
    setShowFavoritesOnly(!showFavoritesOnly);
  };

  const filtered = getFilteredSessions();

  const selectedSession = selectedId
    ? sessions.find((s) => s.id === selectedId)
    : null;

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60_000) return "刚刚";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
    return d.toLocaleDateString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatFullTime = (ts: number) => {
    return new Date(ts).toLocaleString("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const handleCopy = async (text: string, resultId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(resultId);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  };

  const handleReuse = (text: string) => {
    onReuseText?.(text);
  };

  const handleExportJson = () => {
    exportSessionsAsJson(filtered);
    setShowExportMenu(false);
  };

  const handleExportMd = () => {
    exportSessionsAsMarkdown(filtered);
    setShowExportMenu(false);
  };

  const handleBatchDelete = () => {
    if (selectedSessionIds.size === 0) return;
    if (confirm(`确定删除选中的 ${selectedSessionIds.size} 条记录？此操作不可恢复。`)) {
      deleteSessions(Array.from(selectedSessionIds));
      setBatchMode(false);
      if (selectedId && selectedSessionIds.has(selectedId)) {
        setSelectedId(null);
      }
    }
  };

  const handleToggleBatchMode = () => {
    if (batchMode) {
      deselectAll();
    }
    setBatchMode(!batchMode);
  };

  // Render a single session list item
  const renderSessionItem = (session: typeof sessions[0]) => {
    const isSelected = selectedSessionIds.has(session.id);
    return (
      <div
        key={session.id}
        onClick={() => {
          if (batchMode) {
            toggleSessionSelection(session.id);
          } else {
            setSelectedId(selectedId === session.id ? null : session.id);
          }
        }}
        className={`px-4 py-3 border-b border-lexi-border/30 cursor-pointer transition-colors ${
          selectedId === session.id && !batchMode
            ? "bg-lexi-accent/10"
            : "hover:bg-lexi-hover"
        } ${isSelected ? "bg-lexi-accent/5 ring-1 ring-inset ring-lexi-accent/30" : ""}`}
      >
        <div className="flex items-start justify-between gap-2">
          {batchMode && (
            <div className="flex-shrink-0 mt-0.5">
              {isSelected ? (
                <CheckSquare size={16} className="text-lexi-accent" />
              ) : (
                <Square size={16} className="text-lexi-text-muted/40" />
              )}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm text-lexi-text truncate">
              {session.sourceText}
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-lexi-text-muted">
              <span>{session.results.length} 个译文</span>
              <span>·</span>
              <Clock size={10} />
              <span>{formatTime(session.timestamp)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {session.isFavorite && (
              <Star size={12} className="text-yellow-400" fill="currentColor" />
            )}
            {!batchMode && (
              <ChevronRight
                size={14}
                className={`text-lexi-text-muted transition-transform ${
                  selectedId === session.id ? "rotate-90" : ""
                }`}
              />
            )}
          </div>
        </div>
      </div>
    );
  };

  // Render time-grouped list
  const renderGroupedList = () => {
    if (filtered.length === 0) {
      return (
        <div className="p-6 text-center text-sm text-lexi-text-muted">
          {sessions.length === 0
            ? "暂无翻译记录"
            : "没有匹配的记录"}
        </div>
      );
    }

    // Recompute grouped from filtered for display
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;

    const todaySessions = filtered.filter((s) => s.timestamp >= todayStart);
    const yesterdaySessions = filtered.filter((s) => s.timestamp >= yesterdayStart && s.timestamp < todayStart);
    const earlierSessions = filtered.filter((s) => s.timestamp < yesterdayStart);

    return (
      <>
        {todaySessions.length > 0 && (
          <>
            <div className="px-4 py-1.5 text-[11px] font-semibold text-lexi-text-muted bg-lexi-bg/50 uppercase tracking-wider">
              今天
            </div>
            {todaySessions.map(renderSessionItem)}
          </>
        )}
        {yesterdaySessions.length > 0 && (
          <>
            <div className="px-4 py-1.5 text-[11px] font-semibold text-lexi-text-muted bg-lexi-bg/50 uppercase tracking-wider">
              昨天
            </div>
            {yesterdaySessions.map(renderSessionItem)}
          </>
        )}
        {earlierSessions.length > 0 && (
          <>
            <div className="px-4 py-1.5 text-[11px] font-semibold text-lexi-text-muted bg-lexi-bg/50 uppercase tracking-wider">
              更早
            </div>
            {earlierSessions.map(renderSessionItem)}
          </>
        )}
      </>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="bg-lexi-card flex flex-col min-h-0 overflow-hidden h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-lg font-semibold text-lexi-text">翻译历史</h2>
          {batchMode && (
            <div className="flex items-center gap-2">
              <button
                onClick={selectAll}
                className="text-xs text-lexi-accent hover:underline"
              >
                全选
              </button>
              <button
                onClick={deselectAll}
                className="text-xs text-lexi-text-muted hover:underline"
              >
                取消
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={selectedSessionIds.size === 0}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Trash2 size={12} />
                删除 ({selectedSessionIds.size})
              </button>
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-5 py-3">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-lexi-text-muted"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="搜索翻译记录..."
              className="w-full bg-lexi-input border border-lexi-border rounded-lg pl-9 pr-3 py-2 text-sm text-lexi-text placeholder-lexi-text-muted/40 focus:outline-none focus:ring-1 focus:ring-lexi-accent"
            />
          </div>
          {providerNames.length > 1 && (
            <select
              value={filterProvider}
              onChange={(e) => handleProviderFilter(e.target.value)}
              className="bg-lexi-input border border-lexi-border rounded-lg px-2 py-2 text-xs text-lexi-text focus:outline-none focus:ring-1 focus:ring-lexi-accent"
            >
              <option value="">全部提供者</option>
              {providerNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={handleFavoritesToggle}
            className={`p-2 rounded-lg transition-colors ${
              showFavoritesOnly
                ? "bg-yellow-500/20 text-yellow-400"
                : "text-lexi-text-muted hover:bg-lexi-hover"
            }`}
            title="只看收藏"
          >
            <Star size={16} />
          </button>
          <button
            onClick={handleToggleBatchMode}
            className={`p-2 rounded-lg transition-colors ${
              batchMode
                ? "bg-lexi-accent/20 text-lexi-accent"
                : "text-lexi-text-muted hover:bg-lexi-hover"
            }`}
            title="批量模式"
          >
            <List size={16} />
          </button>

          {/* Export dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="p-2 rounded-lg text-lexi-text-muted hover:bg-lexi-hover transition-colors"
              title="导出"
            >
              <Download size={16} />
            </button>
            {showExportMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowExportMenu(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-20 bg-lexi-card border border-lexi-border rounded-lg shadow-lg overflow-hidden min-w-[140px]">
                  <button
                    onClick={handleExportJson}
                    className="w-full text-left px-3 py-2 text-sm text-lexi-text hover:bg-lexi-hover transition-colors"
                  >
                    导出 JSON
                  </button>
                  <button
                    onClick={handleExportMd}
                    className="w-full text-left px-3 py-2 text-sm text-lexi-text hover:bg-lexi-hover transition-colors"
                  >
                    导出 Markdown
                  </button>
                </div>
              </>
            )}
          </div>

          {sessions.length > 0 && (
            <button
              onClick={() => {
                if (confirm("确定清空所有翻译历史？此操作不可恢复。")) {
                  clearAll();
                  setSelectedId(null);
                }
              }}
              className="p-2 rounded-lg text-lexi-text-muted hover:bg-red-500/10 hover:text-red-400 transition-colors"
              title="清空历史"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* List */}
          <div className="w-72 border-r border-lexi-border overflow-y-auto">
            {renderGroupedList()}
          </div>

          {/* Detail */}
          <div className="flex-1 overflow-y-auto p-5">
            {selectedSession ? (
              <div className="space-y-4 animate-fade-in">
                {/* Header actions */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-lexi-text-muted">
                    <span>{formatFullTime(selectedSession.timestamp)}</span>
                    <span>·</span>
                    <span>{selectedSession.sourceLang} → {selectedSession.targetLang}</span>
                    <span>·</span>
                    <span>{selectedSession.results.length} 个结果</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleReuse(selectedSession.sourceText)}
                      className="p-1.5 rounded-lg text-lexi-text-muted hover:text-lexi-accent hover:bg-lexi-accent/10 transition-colors"
                      title="回填原文"
                    >
                      <RotateCcw size={15} />
                    </button>
                    <button
                      onClick={() => toggleFavorite(selectedSession.id)}
                      className={`p-1.5 rounded-lg transition-colors ${
                        selectedSession.isFavorite
                          ? "text-yellow-400"
                          : "text-lexi-text-muted hover:text-yellow-400"
                      }`}
                    >
                      <Star
                        size={15}
                        fill={selectedSession.isFavorite ? "currentColor" : "none"}
                      />
                    </button>
                    <button
                      onClick={() => {
                        deleteSession(selectedSession.id);
                        setSelectedId(null);
                      }}
                      className="p-1.5 rounded-lg text-lexi-text-muted hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* Source */}
                <div>
                  <div className="text-xs text-lexi-text-muted mb-1">
                    原文 ({selectedSession.sourceLang})
                  </div>
                  <div className="p-3 bg-lexi-input/50 rounded-lg text-sm text-lexi-text whitespace-pre-wrap">
                    {selectedSession.sourceText}
                  </div>
                </div>

                {/* Results cards */}
                <div>
                  <div className="text-xs text-lexi-text-muted mb-2">
                    译文 ({selectedSession.targetLang})
                  </div>
                  <div className="space-y-3">
                    {selectedSession.results.map((result, idx) => {
                      const resultId = `${selectedSession.id}-${idx}`;
                      return (
                        <div
                          key={resultId}
                          className="bg-lexi-input/30 border border-lexi-border/50 rounded-lg overflow-hidden"
                        >
                          {/* Result header */}
                          <div className="flex items-center justify-between px-3 py-2 bg-lexi-input/50 border-b border-lexi-border/30">
                            <div className="flex items-center gap-2 text-xs text-lexi-text-muted">
                              <span className="font-medium text-lexi-text">
                                {result.providerName}
                              </span>
                              <span>·</span>
                              <span>{result.model}</span>
                              <span>·</span>
                              <span>{result.latency}ms</span>
                            </div>
                            <button
                              onClick={() => handleCopy(result.translatedText, resultId)}
                              className="flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors hover:bg-lexi-accent/10"
                              title="复制译文"
                            >
                              {copiedId === resultId ? (
                                <>
                                  <Check size={12} className="text-green-400" />
                                  <span className="text-green-400">已复制</span>
                                </>
                              ) : (
                                <>
                                  <Copy size={12} className="text-lexi-text-muted" />
                                  <span className="text-lexi-text-muted">复制</span>
                                </>
                              )}
                            </button>
                          </div>
                          {/* Result body */}
                          <div className="p-4 markdown-body text-sm">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {result.translatedText}
                            </ReactMarkdown>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-center text-lexi-text-muted">
                <div>
                  <div className="text-3xl mb-2">{sessions.length > 0 ? "📋" : "🕊️"}</div>
                  <div className="text-sm">
                    {sessions.length > 0 ? "选择一条记录查看详情" : "开始翻译吧"}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
