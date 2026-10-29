import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// Keep these rules in sync with Pi's FooterComponent: only the unrelated fields
// are omitted. Context stays on the left and the model stays right-aligned.
function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

export function renderFooter(
  width: number,
  theme: Theme,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  providerCount: number,
): string[] {
  const usage = ctx.getContextUsage();
  const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
  const percentValue = usage?.percent ?? 0;
  const percent = usage?.percent !== null ? percentValue.toFixed(1) : "?";
  const auto = pi.getSettings().compaction?.enabled !== false ? " (auto)" : "";
  const display = percent === "?"
    ? `?/${formatTokens(contextWindow)}${auto}`
    : `${percent}%/${formatTokens(contextWindow)}${auto}`;
  let left = percentValue > 90
    ? theme.fg("error", display)
    : percentValue > 70 ? theme.fg("warning", display) : display;
  let leftWidth = visibleWidth(left);
  if (leftWidth > width) {
    left = truncateToWidth(left, width, "...");
    leftWidth = visibleWidth(left);
  }

  const model = ctx.model;
  const modelName = model?.id || "no-model";
  let rightWithoutProvider = modelName;
  if (model?.reasoning) {
    const level = pi.getThinkingLevel() || "off";
    rightWithoutProvider = level === "off" ? `${modelName} • thinking off` : `${modelName} • ${level}`;
  }
  let right = rightWithoutProvider;
  if (providerCount > 1 && model) {
    right = `(${model.provider}) ${rightWithoutProvider}`;
    if (leftWidth + 2 + visibleWidth(right) > width) right = rightWithoutProvider;
  }

  let line: string;
  if (leftWidth + 2 + visibleWidth(right) <= width) {
    line = left + " ".repeat(width - leftWidth - visibleWidth(right)) + right;
  } else {
    const available = width - leftWidth - 2;
    if (available > 0) {
      const truncated = truncateToWidth(right, available, "");
      line = left + " ".repeat(Math.max(0, width - leftWidth - visibleWidth(truncated))) + truncated;
    } else {
      line = left;
    }
  }
  return [theme.fg("dim", left) + theme.fg("dim", line.slice(left.length))];
}
