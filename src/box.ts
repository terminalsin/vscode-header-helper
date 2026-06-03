import * as vscode from "vscode";
import {
  BoxAlign,
  BoxOverrides,
  parseOverrides,
  resolveBoxOptions,
  ResolvedBoxOptions,
  serializeOverrides,
} from "./overrides";

export type { BoxAlign, BoxOverrides, ResolvedBoxOptions };
export { parseOverrides, serializeOverrides, resolveBoxOptions };

/** `>[text]`, `> text`, or `>[text]{opts}` */
const MARKER_CORE_RE = /^>\s*(?:\[([^\]]*)\]|(.+?))(?:\{([^}]*)\})?\s*$/;

export const BOX_TOP_RE = /^\s*(\/\/|#|\/\*)\s*╔═+╗\s*$/;
export const BOX_MID_RE = /^\s*(\/\/|#|\/\*)\s*║(.*)║\s*$/;
export const BOX_BOT_RE = /^\s*(\/\/|#|\/\*)\s*╚═+╝\s*$/;

export type CommentStyle = "//" | "#" | "/*";

export interface BoxBlock {
  startLine: number;
  endLine: number;
  style: CommentStyle;
  lines: string[];
  overrides?: BoxOverrides;
}

export interface ParsedMarker {
  style: CommentStyle;
  text: string;
  overrides?: BoxOverrides;
}

function getConfig() {
  return vscode.workspace.getConfiguration("headerHelper");
}

export function getBoxLength(): number {
  const cfg = getConfig();
  return cfg.get<number>("length", cfg.get<number>("innerWidth", 70));
}

export const getInnerWidth = getBoxLength;

export function getBoxAlign(): BoxAlign {
  return resolveBoxOptions().align;
}

export function shouldUppercase(): boolean {
  return resolveBoxOptions().uppercase;
}

export function formatLabel(text: string, width: number, align: BoxAlign): string {
  const t = text.length > width ? text.slice(0, width) : text;
  const pad = width - t.length;
  if (align === "left") {
    return t + " ".repeat(pad);
  }
  if (align === "right") {
    return " ".repeat(pad) + t;
  }
  const left = Math.floor(pad / 2);
  return " ".repeat(left) + t + " ".repeat(pad - left);
}

export function labelStartInInner(width: number, labelLength: number, align: BoxAlign): number {
  const len = Math.min(labelLength, width);
  if (align === "left") {
    return 0;
  }
  if (align === "right") {
    return width - len;
  }
  return Math.floor((width - len) / 2);
}

export function commentAffixes(style: CommentStyle): { prefix: string; suffix: string } {
  if (style === "//") {
    return { prefix: "// ", suffix: "" };
  }
  if (style === "#") {
    return { prefix: "# ", suffix: "" };
  }
  return { prefix: "/* ", suffix: " */" };
}

export function renderBoxLines(
  lines: string[],
  style: CommentStyle,
  overrides?: BoxOverrides
): string[] {
  const { length: innerWidth, align, uppercase } = resolveBoxOptions(overrides);
  const bar = "═".repeat(innerWidth);
  const { prefix, suffix } = commentAffixes(style);
  const mids = lines.map((line) => {
    const raw = line.trim();
    const label = uppercase ? raw.toUpperCase() : raw;
    return `${prefix}║${formatLabel(label, innerWidth, align)}║${suffix}`;
  });
  return [`${prefix}╔${bar}╗${suffix}`, ...mids, `${prefix}╚${bar}╝${suffix}`];
}

/** Collapsed marker prefix with an open `[` for typing (e.g. `// >[`). */
export function markerLineBase(style: CommentStyle): string {
  if (style === "/*") {
    return "/* >[";
  }
  const { prefix } = commentAffixes(style);
  return `${prefix}>[`;
}

export function markerLineCloseSuffix(style: CommentStyle): string {
  return style === "/*" ? "] */" : "]";
}

/** Full blank marker row with closing bracket (e.g. `// >[]`). */
export function newMarkerLineTemplate(style: CommentStyle): {
  line: string;
  cursorCol: number;
} {
  const base = markerLineBase(style);
  return {
    line: base + markerLineCloseSuffix(style),
    cursorCol: markerBraceCursorColumn(base),
  };
}

/** Cursor column just inside the `[` on a marker base line. */
export function markerBraceCursorColumn(base: string): number {
  const open = base.lastIndexOf("[");
  return open < 0 ? base.length : open + 1;
}

/** Strip stray brackets mistakenly captured as title text. */
export function normalizeMarkerTitle(text: string): string {
  return text.replace(/^\[+/, "").replace(/\]+$/, "").trim();
}

/** Insert `]` before `{opts}` when the marker row is still open. */
export function ensureMarkerCloseBracket(lineText: string): string {
  const open = lineText.indexOf("[");
  if (open < 0) {
    return lineText;
  }
  if (lineText.indexOf("]", open + 1) >= 0) {
    return lineText;
  }
  const optsMatch = lineText.match(/(\{[^}]*\})\s*$/);
  const head = optsMatch ? lineText.slice(0, lineText.length - optsMatch[0].length) : lineText;
  const suffix = optsMatch ? optsMatch[0] : markerLineCloseSuffix(
    detectCommentStyle(lineText) ?? "//"
  );
  if (optsMatch) {
    return head.trimEnd() + "]" + suffix;
  }
  return head.trimEnd() + suffix;
}

export function markerLines(
  lines: string[],
  style: CommentStyle,
  overrides?: BoxOverrides
): string[] {
  const { prefix, suffix } = commentAffixes(style);
  const opts = serializeOverrides(overrides);
  return lines.map((text, i) => {
    const optSuffix = i === lines.length - 1 ? opts : "";
    const title = normalizeMarkerTitle(text);
    return `${prefix}>[${title}]${optSuffix}${suffix}`;
  });
}

/** @deprecated Use markerLines */
export function markerLine(
  text: string,
  style: CommentStyle,
  overrides?: BoxOverrides
): string {
  return markerLines([text], style, overrides)[0];
}

function parseMarkerCore(core: string, style: CommentStyle): ParsedMarker | null {
  const m = core.match(MARKER_CORE_RE);
  if (m) {
    const raw = m[1] !== undefined ? m[1] : (m[2] ?? "");
    return {
      style,
      text: normalizeMarkerTitle(raw),
      overrides: parseOverrides(m[3]),
    };
  }
  const open = core.match(/^>\s*\[([^\]]*)(?:\{([^}]*)\})?\s*$/);
  if (open) {
    return {
      style,
      text: normalizeMarkerTitle(open[1]),
      overrides: parseOverrides(open[2]),
    };
  }
  return null;
}

export function parseMarkerLine(line: string): ParsedMarker | null {
  const fixed = ensureMarkerCloseBracket(line);
  const trimmed = fixed.trim();
  if (trimmed.startsWith("//")) {
    return parseMarkerCore(trimmed.slice(2).trimStart(), "//");
  }
  if (trimmed.startsWith("#")) {
    return parseMarkerCore(trimmed.slice(1).trimStart(), "#");
  }
  if (trimmed.startsWith("/*") && trimmed.endsWith("*/")) {
    return parseMarkerCore(trimmed.slice(2, -2).trim(), "/*");
  }
  return null;
}

/** Editable character range for one marker line's content (inside brackets or after `>`). */
export function markerContentRange(lineText: string): { start: number; end: number } | null {
  const open = lineText.indexOf("[");
  if (open >= 0) {
    const close = lineText.indexOf("]", open + 1);
    if (close > open) {
      return { start: open + 1, end: close };
    }
    let end = lineText.length;
    const brace = lineText.indexOf("{", open + 1);
    if (brace >= 0) {
      end = brace;
    }
    while (end > open + 1 && lineText[end - 1] === " ") {
      end--;
    }
    return { start: open + 1, end };
  }
  const gt = lineText.indexOf(">");
  if (gt < 0) {
    return null;
  }
  let start = gt + 1;
  while (start < lineText.length && lineText[start] === " ") {
    start++;
  }
  let end = lineText.length;
  const brace = lineText.indexOf("{", start);
  if (brace >= 0) {
    end = brace;
  }
  while (end > start && lineText[end - 1] === " ") {
    end--;
  }
  return { start, end };
}

export function salvageMarkerFromLine(line: string): ParsedMarker | null {
  const parsed = parseMarkerLine(line);
  if (parsed) {
    return parsed;
  }
  const trimmed = line.trim();
  let style: CommentStyle = "//";
  let core = trimmed;
  if (core.startsWith("//")) {
    core = core.slice(2).trimStart();
  } else if (core.startsWith("#")) {
    style = "#";
    core = core.slice(1).trimStart();
  } else if (core.startsWith("/*")) {
    style = "/*";
    core = core.replace(/^\/\*/, "").replace(/\*\/$/, "").trim();
  } else {
    return null;
  }
  if (!core.startsWith(">")) {
    return null;
  }
  const range = markerContentRange(line);
  if (!range) {
    return null;
  }
  const text = normalizeMarkerTitle(line.slice(range.start, range.end));
  const opts = core.match(/\{([^}]*)\}/);
  return {
    style,
    text,
    overrides: parseOverrides(opts?.[1]),
  };
}

export function parseBoxMiddle(line: string): string | null {
  const m = line.match(BOX_MID_RE);
  return m ? m[2].trim() : null;
}

export function detectCommentStyle(line: string): CommentStyle | null {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("//")) {
    return "//";
  }
  if (trimmed.startsWith("#")) {
    return "#";
  }
  if (trimmed.startsWith("/*")) {
    return "/*";
  }
  return null;
}

export function isMarkerBlock(doc: vscode.TextDocument, block: BoxBlock): boolean {
  return parseMarkerLine(doc.lineAt(block.startLine).text) !== null;
}

/** True when a `[` segment on the line has a matching `]`. */
export function markerLineHasCloseBracket(lineText: string): boolean {
  const open = lineText.indexOf("[");
  if (open < 0) {
    return true;
  }
  return lineText.indexOf("]", open + 1) >= 0;
}

/** Marker rows are closed and parseable; safe to expand into a rendered box. */
export function markerBlockReadyToExpand(
  doc: vscode.TextDocument,
  block: BoxBlock
): boolean {
  if (isExpandedBox(doc, block)) {
    return false;
  }
  for (let i = block.startLine; i <= block.endLine; i++) {
    const line = doc.lineAt(i).text;
    if (!markerLineHasCloseBracket(line)) {
      return false;
    }
    if (!parseMarkerLine(line) && !salvageMarkerFromLine(line)) {
      return false;
    }
  }
  return true;
}

export function selectionInMarkerBlock(
  doc: vscode.TextDocument,
  selection: vscode.Selection,
  block: BoxBlock
): boolean {
  const line = selection.active.line;
  if (line >= block.startLine && line <= block.endLine) {
    return true;
  }
  if (line === block.endLine + 1 && isPendingMarkerLine(doc.lineAt(line).text)) {
    return true;
  }
  return false;
}

/** Empty or in-progress `// >` line (used while adding lines in collapsed edit). */
export function isPendingMarkerLine(lineText: string): boolean {
  const trimmed = lineText.trim();
  if (!trimmed) {
    return true;
  }
  if (parseMarkerLine(lineText)) {
    return true;
  }
  return /^\s*\/\/\s*>/.test(lineText) ||
    /^\s*#\s*>/.test(lineText) ||
    /^\s*\/\*\s*>/.test(lineText);
}

/** Marker block at `line`, or the line directly under it while editing more rows. */
export function findMarkerBlockWithPending(
  doc: vscode.TextDocument,
  line: number
): BoxBlock | null {
  for (let start = line; start >= 0 && start >= line - 50; start--) {
    const block = findMarkerBlockAt(doc, start);
    if (!block || line < block.startLine) {
      continue;
    }
    if (line <= block.endLine) {
      return block;
    }
    if (line === block.endLine + 1 && isPendingMarkerLine(doc.lineAt(line).text)) {
      return { ...block, endLine: line };
    }
  }
  return null;
}

export function isExpandedBox(doc: vscode.TextDocument, block: BoxBlock): boolean {
  if (block.startLine >= doc.lineCount) {
    return false;
  }
  return BOX_TOP_RE.test(doc.lineAt(block.startLine).text);
}

export function findMarkerBlockAt(
  doc: vscode.TextDocument,
  line: number
): BoxBlock | null {
  const first = parseMarkerLine(doc.lineAt(line).text);
  if (!first) {
    return null;
  }
  const contentLines = [first.text];
  let end = line;
  let overrides = first.overrides;
  for (let i = line + 1; i < doc.lineCount; i++) {
    const next = parseMarkerLine(doc.lineAt(i).text);
    if (!next || next.style !== first.style) {
      break;
    }
    contentLines.push(next.text);
    end = i;
    if (next.overrides) {
      overrides = next.overrides;
    }
  }
  return {
    startLine: line,
    endLine: end,
    style: first.style,
    lines: contentLines,
    overrides,
  };
}

function inferOverridesFromExpanded(
  top: string,
  middleLineTexts: string[],
  contentLines: string[]
): BoxOverrides | undefined {
  const bar = top.match(/╔(═+)╗/);
  if (!bar || middleLineTexts.length === 0 || contentLines.length === 0) {
    return undefined;
  }
  const length = bar[1].length;
  const global = resolveBoxOptions();
  const o: BoxOverrides = {};
  if (length !== global.length) {
    o.length = length;
  }
  const raw = contentLines[0].trim();
  const mid = middleLineTexts[0];
  const inner = mid.match(BOX_MID_RE)?.[1] ?? "";
  for (const align of ["left", "right", "center"] as BoxAlign[]) {
    for (const uc of [false, true]) {
      const label = uc ? raw.toUpperCase() : raw;
      if (inner === formatLabel(label, length, align)) {
        if (align !== global.align) {
          o.align = align;
        }
        if (uc !== global.uppercase) {
          o.uppercase = uc;
        }
        return Object.keys(o).length > 0 ? o : undefined;
      }
    }
  }
  return Object.keys(o).length > 0 ? o : undefined;
}

export function findExpandedBoxAt(
  doc: vscode.TextDocument,
  line: number
): BoxBlock | null {
  for (let top = line; top >= 0 && top >= line - 50; top--) {
    const topText = doc.lineAt(top).text;
    if (!BOX_TOP_RE.test(topText)) {
      continue;
    }
    const style = detectCommentStyle(topText);
    if (!style) {
      continue;
    }
    const contentLines: string[] = [];
    const middleLineTexts: string[] = [];
    let i = top + 1;
    while (i < doc.lineCount) {
      const t = doc.lineAt(i).text;
      if (BOX_BOT_RE.test(t)) {
        if (line < top || line > i) {
          break;
        }
        return {
          startLine: top,
          endLine: i,
          style,
          lines: contentLines,
          overrides: inferOverridesFromExpanded(topText, middleLineTexts, contentLines),
        };
      }
      if (BOX_MID_RE.test(t)) {
        const text = parseBoxMiddle(t);
        if (text === null) {
          break;
        }
        contentLines.push(text);
        middleLineTexts.push(t);
        i++;
        continue;
      }
      break;
    }
  }
  return null;
}

export function findBlockAtLine(
  doc: vscode.TextDocument,
  line: number
): BoxBlock | null {
  if (line < 0 || line >= doc.lineCount) {
    return null;
  }
  const marker = findMarkerBlockWithPending(doc, line);
  if (marker) {
    return marker;
  }
  return findExpandedBoxAt(doc, line);
}

export function titleIndexFromMarker(lineText: string, offset: number): number {
  const range = markerContentRange(lineText);
  if (!range) {
    return 0;
  }
  const idx = offset - range.start;
  if (idx <= 0) {
    return 0;
  }
  const len = range.end - range.start;
  if (idx >= len) {
    return len;
  }
  return idx;
}

export function titleIndexFromBoxMiddle(
  lineText: string,
  offset: number,
  overrides?: BoxOverrides
): number {
  const parsed = parseBoxMiddle(lineText);
  if (!parsed) {
    return 0;
  }
  const { align } = resolveBoxOptions(overrides);
  const firstPipe = lineText.indexOf("║");
  const lastPipe = lineText.lastIndexOf("║");
  if (firstPipe < 0 || lastPipe <= firstPipe) {
    return 0;
  }
  const contentStart = firstPipe + 1;
  const inner = lineText.slice(contentStart, lastPipe);
  const labelStart = labelStartInInner(inner.length, parsed.length, align);
  const idxInLabel = offset - contentStart - labelStart;
  if (idxInLabel <= 0) {
    return 0;
  }
  if (idxInLabel >= parsed.length) {
    return parsed.length;
  }
  return idxInLabel;
}

export function offsetInMarkerLine(lineText: string, titleIndex: number): number {
  const range = markerContentRange(lineText);
  if (!range) {
    return 0;
  }
  const len = range.end - range.start;
  const idx = Math.max(0, Math.min(titleIndex, len));
  return range.start + idx;
}

export function offsetInBoxMiddleLine(
  lineText: string,
  titleIndex: number,
  overrides?: BoxOverrides
): number {
  const parsed = parseBoxMiddle(lineText);
  if (!parsed) {
    return 0;
  }
  const { align } = resolveBoxOptions(overrides);
  const firstPipe = lineText.indexOf("║");
  const lastPipe = lineText.lastIndexOf("║");
  if (firstPipe < 0 || lastPipe <= firstPipe) {
    return 0;
  }
  const inner = lineText.slice(firstPipe + 1, lastPipe);
  const labelStart = labelStartInInner(inner.length, parsed.length, align);
  const idxInLabel = Math.max(0, Math.min(titleIndex, parsed.length));
  return firstPipe + 1 + labelStart + idxInLabel;
}

export function scanBoxBlocks(doc: vscode.TextDocument): BoxBlock[] {
  const blocks: BoxBlock[] = [];
  for (let i = 0; i < doc.lineCount; i++) {
    const block = findExpandedBoxAt(doc, i);
    if (block && block.startLine === i) {
      blocks.push(block);
      i = block.endLine;
    }
  }
  return blocks;
}

export function linesInRange(
  doc: vscode.TextDocument,
  startLine: number,
  endLine: number
): string[] {
  const lines: string[] = [];
  for (let i = startLine; i <= endLine; i++) {
    lines.push(doc.lineAt(i).text);
  }
  return lines;
}

export function linesEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

export function extractLinesFromBlock(
  doc: vscode.TextDocument,
  block: BoxBlock
): string[] {
  if (isMarkerBlock(doc, block)) {
    const lines: string[] = [];
    for (let i = block.startLine; i <= block.endLine; i++) {
      const salvaged = salvageMarkerFromLine(doc.lineAt(i).text);
      lines.push(salvaged?.text ?? block.lines[i - block.startLine] ?? "");
    }
    return lines;
  }
  const lines: string[] = [];
  for (let i = block.startLine + 1; i < block.endLine; i++) {
    const t = parseBoxMiddle(doc.lineAt(i).text);
    if (t !== null) {
      lines.push(t);
    }
  }
  return lines.length > 0 ? lines : [...block.lines];
}

/** @deprecated Use extractLinesFromBlock */
export function extractTextFromBlock(
  doc: vscode.TextDocument,
  block: BoxBlock
): string {
  return extractLinesFromBlock(doc, block).join("\n");
}

export function scanMarkerBlocks(doc: vscode.TextDocument): BoxBlock[] {
  const blocks: BoxBlock[] = [];
  for (let i = 0; i < doc.lineCount; i++) {
    const block = findMarkerBlockAt(doc, i);
    if (block && block.startLine === i) {
      blocks.push(block);
      i = block.endLine;
    }
  }
  return blocks;
}

/** @deprecated Use scanMarkerBlocks */
export function scanMarkers(
  doc: vscode.TextDocument
): { line: number; style: CommentStyle; text: string; overrides?: BoxOverrides }[] {
  return scanMarkerBlocks(doc).map((b) => ({
    line: b.startLine,
    style: b.style,
    text: b.lines.join("\n"),
    overrides: b.overrides,
  }));
}
