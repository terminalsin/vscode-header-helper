import * as vscode from "vscode";
import {
  BoxBlock,
  findBlockAtLine,
  markerLine,
  parseBoxMiddle,
  parseMarkerLine,
  renderBoxLines,
  scanMarkers,
  BOX_BOT_RE,
  BOX_MID_RE,
  BOX_TOP_RE,
} from "./box";

let applyingEdit = false;
let suppressCollapseUntil = 0;
/** URI -> line number of collapsed marker the cursor is editing */
const activeCollapsed = new Map<string, number>();
/** URI -> multi-line box block the cursor was last inside */
const activeBox = new Map<string, BoxBlock>();

function uriKey(doc: vscode.TextDocument): string {
  return doc.uri.toString();
}

async function replaceLines(
  editor: vscode.TextEditor,
  startLine: number,
  endLine: number,
  newLines: string[]
): Promise<void> {
  const doc = editor.document;
  const endChar = doc.lineAt(endLine).text.length;
  const range = new vscode.Range(startLine, 0, endLine, endChar);
  applyingEdit = true;
  try {
    const ok = await editor.edit((eb) => {
      // Do not append a trailing newline: the range ends at end-of-line text, and
      // the document keeps the existing line break after endLine.
      eb.replace(range, newLines.join("\n"));
    });
    if (!ok) {
      return;
    }
  } finally {
    applyingEdit = false;
  }
}

async function expandBlock(editor: vscode.TextEditor, block: BoxBlock): Promise<void> {
  const key = uriKey(editor.document);
  const lines = renderBoxLines(block.text, block.style);
  await replaceLines(editor, block.startLine, block.endLine, lines);
  activeCollapsed.delete(key);
  activeBox.delete(key);
  suppressCollapseUntil = Date.now() + 400;
}

async function collapseBlock(editor: vscode.TextEditor, block: BoxBlock): Promise<void> {
  const key = uriKey(editor.document);
  const line = markerLine(block.text, block.style);
  await replaceLines(editor, block.startLine, block.endLine, [line]);
  activeBox.delete(key);
  activeCollapsed.set(key, block.startLine);
}

function selectionTouchesBlock(
  selection: vscode.Selection,
  block: BoxBlock
): boolean {
  const start = selection.start.line;
  const end = selection.end.line;
  return start <= block.endLine && end >= block.startLine;
}

function extractTextFromBlock(doc: vscode.TextDocument, block: BoxBlock): string {
  if (block.startLine === block.endLine) {
    const parsed = parseMarkerLine(doc.lineAt(block.startLine).text);
    return parsed?.text ?? block.text;
  }
  const mid = doc.lineAt(block.startLine + 1).text;
  return parseBoxMiddle(mid) ?? block.text;
}

async function onSelectionChange(e: vscode.TextEditorSelectionChangeEvent): Promise<void> {
  if (applyingEdit || e.textEditor.document.uri.scheme !== "file") {
    return;
  }

  const editor = e.textEditor;
  const doc = editor.document;
  const key = uriKey(doc);
  const sel = editor.selection;
  const cursorLine = sel.active.line;

  const prevBox = activeBox.get(key);
  if (prevBox && prevBox.startLine !== prevBox.endLine) {
    const stillInBox = selectionTouchesBlock(sel, prevBox);
    if (!stillInBox) {
      const current = findBlockAtLine(doc, prevBox.startLine);
      if (current && current.startLine !== current.endLine) {
        await onSelectionLeaveBox(editor, current);
      }
      activeBox.delete(key);
    }
  } else {
    const block = findBlockAtLine(doc, cursorLine);
    if (block && block.startLine !== block.endLine && selectionTouchesBlock(sel, block)) {
      activeBox.set(key, block);
    }
  }

  const prevCollapsedLine = activeCollapsed.get(key);
  if (prevCollapsedLine !== undefined) {
    const stillInside =
      cursorLine === prevCollapsedLine &&
      selectionTouchesBlock(sel, {
        startLine: prevCollapsedLine,
        endLine: prevCollapsedLine,
        style: "//",
        text: "",
      });
    if (!stillInside) {
      const block = findBlockAtLine(doc, prevCollapsedLine);
      if (block && block.startLine === block.endLine) {
        const text = extractTextFromBlock(doc, block);
        await expandBlock(editor, { ...block, text });
      }
      activeCollapsed.delete(key);
    }
  }

  if (Date.now() < suppressCollapseUntil) {
    return;
  }

  const block = findBlockAtLine(doc, cursorLine);
  if (!block || block.startLine === block.endLine) {
    return;
  }

  if (!selectionTouchesBlock(sel, block)) {
    return;
  }

  if (activeCollapsed.has(key)) {
    return;
  }

  const text = extractTextFromBlock(doc, block);
  await collapseBlock(editor, { ...block, text });
}

async function onSelectionLeaveBox(
  editor: vscode.TextEditor,
  block: BoxBlock
): Promise<void> {
  const text = extractTextFromBlock(editor.document, block);
  await expandBlock(editor, { ...block, text });
}

async function autoExpandMarkers(doc: vscode.TextDocument): Promise<void> {
  if (applyingEdit) {
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document !== doc) {
    return;
  }

  const key = uriKey(doc);
  if (activeCollapsed.has(key)) {
    return;
  }

  for (const hit of scanMarkers(doc)) {
    if (activeCollapsed.get(key) === hit.line) {
      continue;
    }
    const block: BoxBlock = {
      startLine: hit.line,
      endLine: hit.line,
      style: hit.style,
      text: hit.text,
    };
    await expandBlock(editor, block);
    return;
  }
}

async function normalizeOrphanBoxes(doc: vscode.TextDocument): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document !== doc || applyingEdit) {
    return;
  }

  const key = uriKey(doc);
  if (activeCollapsed.has(key)) {
    return;
  }

  for (let i = 0; i < doc.lineCount - 2; i++) {
    const top = doc.lineAt(i).text;
    const mid = doc.lineAt(i + 1).text;
    const bot = doc.lineAt(i + 2).text;
    if (!BOX_TOP_RE.test(top) || !BOX_MID_RE.test(mid) || !BOX_BOT_RE.test(bot)) {
      continue;
    }
    const block = findBlockAtLine(doc, i);
    if (!block) {
      continue;
    }
    const cursor = editor.selection.active.line;
    if (cursor >= block.startLine && cursor <= block.endLine) {
      return;
    }
    const text = extractTextFromBlock(doc, block);
    const rendered = renderBoxLines(text, block.style);
    const current = [top, mid, bot];
    if (current.join("\n") !== rendered.join("\n")) {
      await expandBlock(editor, { ...block, text });
    }
    return;
  }
}

async function onSelectionChangeWithNormalize(
  e: vscode.TextEditorSelectionChangeEvent
): Promise<void> {
  await onSelectionChange(e);
  if (applyingEdit || e.textEditor.document.uri.scheme !== "file") {
    return;
  }
  const key = uriKey(e.textEditor.document);
  if (!activeCollapsed.has(key)) {
    void normalizeOrphanBoxes(e.textEditor.document);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(onSelectionChangeWithNormalize),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (applyingEdit) {
        return;
      }
      void autoExpandMarkers(e.document);
    })
  );

  const editor = vscode.window.activeTextEditor;
  if (editor) {
    void autoExpandMarkers(editor.document);
  }
}

export function deactivate(): void {
  activeCollapsed.clear();
  activeBox.clear();
}
