import { useState } from "react";
import { Trash2, Star, Search, Clock, ChevronRight } from "lucide-react";
import { useHistoryStore } from "../../stores/historyStore";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface HistoryPanelProps {
  onClose: () => void;
}

export default function HistoryPanel(_props: HistoryPanelProps) {
  const records = useHistoryStore((s) => s.records);
  const deleteRecord = useHistoryStore((s) => s.deleteRecord);
  const toggleFavorite = useHistoryStore((s) => s.toggleFavorite);
  const clearAll = useHistoryStore((s) => s.clearAll);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [filterProvider, setFilterProvider] = useState("");

  const providerNames = [...new Set(records.map((r) => r.providerName).filter(Boolean))].sort();

  const filteredRecords = records.filter((r) => {
    if (showFavoritesOnly && !r.isFavorite) return false;
    if (filterProvider && r.providerName !== filterProvider) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        r.sourceText.toLowerCase().includes(q) ||
        r.translatedText.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const selectedRecord = selectedId
    ? records.find((r) => r.id === selectedId)
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

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="bg-lexi-card flex flex-col min-h-0 overflow-hidden h-full">
        {/* Header */}
        <div className="flex items-center px-5 py-4">
          <h2 className="text-lg font-semibold text-lexi-text">翻译历史</h2>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 px-5 py-3">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-lexi-text-muted"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索翻译记录..."
              className="w-full bg-lexi-input border border-lexi-border rounded-lg pl-9 pr-3 py-2 text-sm text-lexi-text placeholder-lexi-text-muted/40 focus:outline-none focus:ring-1 focus:ring-lexi-accent"
            />
          </div>
          {providerNames.length > 1 && (
            <select value={filterProvider} onChange={(e) => setFilterProvider(e.target.value)}
              className="bg-lexi-input border border-lexi-border rounded-lg px-2 py-2 text-xs text-lexi-text focus:outline-none focus:ring-1 focus:ring-lexi-accent">
              <option value="">全部提供者</option>
              {providerNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className={`p-2 rounded-lg transition-colors ${
              showFavoritesOnly
                ? "bg-yellow-500/20 text-yellow-400"
                : "text-lexi-text-muted hover:bg-lexi-hover"
            }`}
            title="只看收藏"
          >
            <Star size={16} />
          </button>
          {records.length > 0 && (
            <button
              onClick={() => {
                if (confirm("确定清空所有翻译历史？此操作不可恢复。")) {
                  clearAll();
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
            {filteredRecords.length === 0 ? (
              <div className="p-6 text-center text-sm text-lexi-text-muted">
                {records.length === 0
                  ? "暂无翻译记录"
                  : "没有匹配的记录"}
              </div>
            ) : (
              filteredRecords.map((record) => (
                <div
                  key={record.id}
                  onClick={() =>
                    setSelectedId(
                      selectedId === record.id ? null : record.id
                    )
                  }
                  className={`px-4 py-3 border-b border-lexi-border/30 cursor-pointer transition-colors ${
                    selectedId === record.id
                      ? "bg-lexi-accent/10"
                      : "hover:bg-lexi-hover"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-lexi-text truncate">
                        {record.sourceText}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-lexi-text-muted">
                        <span>{record.providerName}</span>
                        <span>·</span>
                        <Clock size={10} />
                        <span>{formatTime(record.timestamp)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {record.isFavorite && (
                        <Star size={12} className="text-yellow-400" fill="currentColor" />
                      )}
                      <ChevronRight
                        size={14}
                        className={`text-lexi-text-muted transition-transform ${
                          selectedId === record.id ? "rotate-90" : ""
                        }`}
                      />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Detail */}
          <div className="flex-1 overflow-y-auto p-5">
            {selectedRecord ? (
              <div className="space-y-4 animate-fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-lexi-text-muted">
                    <span>{selectedRecord.providerName}</span>
                    <span>·</span>
                    <span>{selectedRecord.model}</span>
                    <span>·</span>
                    <span>{selectedRecord.latency}ms</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleFavorite(selectedRecord.id)}
                      className={`p-1.5 rounded-lg transition-colors ${
                        selectedRecord.isFavorite
                          ? "text-yellow-400"
                          : "text-lexi-text-muted hover:text-yellow-400"
                      }`}
                    >
                      <Star
                        size={15}
                        fill={selectedRecord.isFavorite ? "currentColor" : "none"}
                      />
                    </button>
                    <button
                      onClick={() => {
                        deleteRecord(selectedRecord.id);
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
                    原文 ({selectedRecord.sourceLang})
                  </div>
                  <div className="p-3 bg-lexi-input/50 rounded-lg text-sm text-lexi-text">
                    {selectedRecord.sourceText}
                  </div>
                </div>

                {/* Translation */}
                <div>
                  <div className="text-xs text-lexi-text-muted mb-1">
                    译文 ({selectedRecord.targetLang})
                  </div>
                  <div className="p-4 bg-lexi-input/50 rounded-lg markdown-body text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {selectedRecord.translatedText}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-center text-lexi-text-muted">
                <div>
                  <div className="text-3xl mb-2">📋</div>
                  <div className="text-sm">选择一条记录查看详情</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
