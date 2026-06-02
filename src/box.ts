import * as vscode from "vscode";

/** Marker syntax: // >[section title] */
export const MARKER_RE = /^\s*(\/\/|#|\/\*)\s*>\[([^\]]+)\]\s*$/;

/** Expanded box: // ╔...╗ / // ║...║ / // ╚...╝ (or # / * variants) */
export const BOX_TOP_RE = /^\s*(\/\/|#|\/\*)\s*╔═+╗\s*$/;
export const BOX_MID_RE = /^\s*(\/\/|#|\/\*)\s*║(.*)║\s*$/;
export const BOX_BOT_RE = /^\s*(\/\/|#|\/\*)\s*╚═+╝\s*$/;

export type CommentStyle = "//" | "#" | "/*";

export interface BoxBlock {
  startLine: number;
  endLine: number;
  style: CommentStyle;
  text: string;
}

export function getInnerWidth(): number {
  const cfg = vscode.workspace.getConfiguration("headerHelper");
  return cfg.get<number>("innerWidth", 70);
}

export function shouldUppercase(): boolean {
  const cfg = vscode.workspace.getConfiguration("headerHelper");
  return cfg.get<boolean>("uppercase", true);
}

function centerText(text: string, width: number): string {
  const t = text.length > width ? text.slice(0, width) : text;
  const pad = width - t.length;
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return " ".repeat(left) + t + " ".repeat(right);
}

export function renderBoxLines(text: string, style: CommentStyle): string[] {
  const innerWidth = getInnerWidth();
  const label = shouldUppercase() ? text.trim().toUpperCase() : text.trim();
  const bar = "═".repeat(innerWidth);
  const middle = centerText(label, innerWidth);
  const prefix =
    style === "//" ? "// " : style === "#" ? "# " : "/* ";
  const suffix = style === "/*" ? " */" : "";
  return [
    `${prefix}╔${bar}╗${suffix}`,
    `${prefix}║${middle}║${suffix}`,
    `${prefix}╚${bar}╝${suffix}`,
  ];
}

export function markerLine(text: string, style: CommentStyle): string {
  const prefix =
    style === "//" ? "// " : style === "#" ? "# " : "/* ";
  const suffix = style === "/*" ? " */" : "";
  return `${prefix}>[${text.trim()}]${suffix}`;
}

export function parseMarkerLine(line: string): { style: CommentStyle; text: string } | null {
  const m = line.match(MARKER_RE);
  if (!m) {
    return null;
  }
  return { style: m[1] as CommentStyle, text: m[2] };
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

/** Find a 3-line box block containing `line`, or a marker on `line`. */
export function findBlockAtLine(
  doc: vscode.TextDocument,
  line: number
): BoxBlock | null {
  const total = doc.lineCount;
  if (line < 0 || line >= total) {
    return null;
  }

  const marker = parseMarkerLine(doc.lineAt(line).text);
  if (marker) {
    return {
      startLine: line,
      endLine: line,
      style: marker.style,
      text: marker.text,
    };
  }

  if (line >= 2) {
    const top = doc.lineAt(line - 2).text;
    const mid = doc.lineAt(line - 1).text;
    const bot = doc.lineAt(line).text;
    if (BOX_TOP_RE.test(top) && BOX_MID_RE.test(mid) && BOX_BOT_RE.test(bot)) {
      const text = parseBoxMiddle(mid);
      const style = detectCommentStyle(top);
      if (text !== null && style) {
        return { startLine: line - 2, endLine: line, style, text };
      }
    }
  }

  if (line + 2 < total) {
    const top = doc.lineAt(line).text;
    const mid = doc.lineAt(line + 1).text;
    const bot = doc.lineAt(line + 2).text;
    if (BOX_TOP_RE.test(top) && BOX_MID_RE.test(mid) && BOX_BOT_RE.test(bot)) {
      const text = parseBoxMiddle(mid);
      const style = detectCommentStyle(top);
      if (text !== null && style) {
        return { startLine: line, endLine: line + 2, style, text };
      }
    }
  }

  if (line >= 1 && line + 1 < total) {
    const top = doc.lineAt(line - 1).text;
    const mid = doc.lineAt(line).text;
    const bot = doc.lineAt(line + 1).text;
    if (BOX_TOP_RE.test(top) && BOX_MID_RE.test(mid) && BOX_BOT_RE.test(bot)) {
      const text = parseBoxMiddle(mid);
      const style = detectCommentStyle(top);
      if (text !== null && style) {
        return { startLine: line - 1, endLine: line + 1, style, text };
      }
    }
  }

  return null;
}

export function scanMarkers(doc: vscode.TextDocument): { line: number; style: CommentStyle; text: string }[] {
  const hits: { line: number; style: CommentStyle; text: string }[] = [];
  for (let i = 0; i < doc.lineCount; i++) {
    const parsed = parseMarkerLine(doc.lineAt(i).text);
    if (parsed) {
      hits.push({ line: i, style: parsed.style, text: parsed.text });
    }
  }
  return hits;
}
