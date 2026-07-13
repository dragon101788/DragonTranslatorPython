import type { TranslationSession, HistoryExport } from "../types";

export function exportSessionsAsJson(sessions: TranslationSession[]): void {
  const data: HistoryExport = {
    version: 1,
    exportedAt: Date.now(),
    sessions,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dragon-translator-history-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportSessionsAsMarkdown(sessions: TranslationSession[]): void {
  let md = "# DragonTranslator 翻译历史\n\n";
  md += `导出时间: ${new Date().toLocaleString("zh-CN")}\n\n---\n\n`;

  for (const session of sessions) {
    const title =
      session.sourceText.length > 80
        ? session.sourceText.slice(0, 80) + "..."
        : session.sourceText;
    md += `## ${title}\n\n`;
    md += `- **时间**: ${new Date(session.timestamp).toLocaleString("zh-CN")}\n`;
    md += `- **语言**: ${session.sourceLang} → ${session.targetLang}\n`;
    md += `- **结果数**: ${session.results.length}\n`;
    if (session.isFavorite) {
      md += `- **收藏**: ⭐\n`;
    }
    md += "\n### 原文\n\n";
    md += `> ${session.sourceText.replace(/\n/g, "\n> ")}\n\n`;

    for (const r of session.results) {
      md += `### ${r.providerName} (${r.model}) — ${r.latency}ms\n\n`;
      md += `${r.translatedText}\n\n`;
    }
    md += "---\n\n";
  }

  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dragon-translator-history-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
