import * as vscode from "vscode";
import {
  BoxBlock,
  extractLinesFromBlock,
  findBlockAtLine,
  findMarkerBlockWithPending,
  isExpandedBox,
  isMarkerBlock,
  markerBlockReadyToExpand,
  markerLines,
  selectionInMarkerBlock,
  offsetInBoxMiddleLine,
  offsetInMarkerLine,
  parseBoxMiddle,
  renderBoxLines,
  scanBoxBlocks,
  findMarkerBlockAt,
  isPendingMarkerLine,
  linesEqual,
  linesInRange,
  scanMarkerBlocks,
  titleIndexFromBoxMiddle,
  titleIndexFromMarker,
} from "./box";
import {
  registerCollapsedEnter,
  updateCollapsedEditContext,
} from "./collapsedEnter";
import { registerDeleteGuard, updateHeaderEditContext } from "./deleteGuard";
import {
  commitPendingHeaderEdits,
  registerSaveOnBlur,
  type CollapsedState,
} from "./saveOnBlur";

let applyingEdit = false;
/** Skip the next collapse-on-click (selection event right after expand places the cursor). */
let skipCollapseOnce = false;

/** URI -> collapsed marker block being edited */
const activeCollapsed = new Map<string, CollapsedState>();
/** URI -> expanded box block the cursor was last inside */
const activeBox = new Map<string, BoxBlock & { cursorLine: number; titleIndex: number }>();
/** URI -> in-file marker being typed before first expand */
const activeMarkerDraft = new Map<
  string,
  { startLine: number; endLine: number; cursorLine: number; titleIndex: number }
>();

function uriKey(doc: vscode.TextDocument): string {
  return doc.uri.toString();
}

interface CursorAnchor {
  line: number;
  titleIndex: number;
}

function captureCursorAnchor(
  doc: vscode.TextDocument,
  block: BoxBlock,
  position: vscode.Position
): CursorAnchor {
  if (isMarkerBlock(doc, block)) {
    if (position.line < block.startLine || position.line > block.endLine) {
      return { line: block.startLine, titleIndex: 0 };
    }
    return {
      line: position.line,
      titleIndex: titleIndexFromMarker(doc.lineAt(position.line).text, position.character),
    };
  }
  if (position.line <= block.startLine || position.line >= block.endLine) {
    return { line: block.startLine + 1, titleIndex: 0 };
  }
  return {
    line: position.line,
    titleIndex: titleIndexFromBoxMiddle(
      doc.lineAt(position.line).text,
      position.character,
      block.overrides
    ),
  };
}

/** Place the caret on the first line after the box bottom border. */
function placeCursorBelowBox(
  editor: vscode.TextEditor,
  block: BoxBlock
): void {
  const doc = editor.document;
  const below = block.endLine + 1;
  if (below < doc.lineCount) {
    const pos = new vscode.Position(below, 0);
    editor.selection = new vscode.Selection(pos, pos);
    return;
  }
  const endText = doc.lineAt(block.endLine).text;
  const pos = new vscode.Position(block.endLine, endText.length);
  editor.selection = new vscode.Selection(pos, pos);
}

function restoreCursor(
  editor: vscode.TextEditor,
  block: BoxBlock,
  anchor: CursorAnchor,
  target: "marker" | "middle"
): void {
  const line = anchor.line;
  if (line < 0 || line >= editor.document.lineCount) {
    return;
  }
  const text = editor.document.lineAt(line).text;
  const character =
    target === "marker"
      ? offsetInMarkerLine(text, anchor.titleIndex)
      : offsetInBoxMiddleLine(text, anchor.titleIndex, block.overrides);
  const pos = new vscode.Position(line, character);
  editor.selection = new vscode.Selection(pos, pos);
}

async function replaceLines(
  editor: vscode.TextEditor,
  block: BoxBlock,
  startLine: number,
  endLine: number,
  newLines: string[],
  cursor?: { anchor: CursorAnchor; target: "marker" | "middle" }
): Promise<void> {
  const doc = editor.document;
  const current = linesInRange(doc, startLine, endLine);
  if (linesEqual(current, newLines)) {
    if (cursor) {
      restoreCursor(editor, block, cursor.anchor, cursor.target);
    }
    return;
  }
  const endChar = doc.lineAt(endLine).text.length;
  const range = new vscode.Range(startLine, 0, endLine, endChar);
  applyingEdit = true;
  try {
    const ok = await editor.edit((eb) => {
      eb.replace(range, newLines.join("\n"));
    });
    if (!ok) {
      return;
    }
    if (cursor) {
      restoreCursor(editor, block, cursor.anchor, cursor.target);
    }
  } finally {
    applyingEdit = false;
  }
}

async function expandBlock(
  editor: vscode.TextEditor,
  block: BoxBlock,
  cursor?: CursorAnchor,
  placeCursor: boolean | "below" = true,
  restoreRendered?: string[]
): Promise<void> {
  const key = uriKey(editor.document);
  const doc = editor.document;
  const anchor =
    cursor ??
    captureCursorAnchor(doc, block, editor.selection.active);
  const rendered =
    restoreRendered && restoreRendered.length > 0
      ? restoreRendered
      : renderBoxLines(block.lines, block.style, block.overrides);
  const target: "marker" | "middle" = "middle";
  const lineOffset = Math.max(
    0,
    Math.min(anchor.line - block.startLine, block.lines.length - 1)
  );
  const middleAnchor: CursorAnchor = isMarkerBlock(doc, block)
    ? { line: block.startLine + 1 + lineOffset, titleIndex: anchor.titleIndex }
    : {
        line: Math.max(block.startLine + 1, Math.min(anchor.line, block.endLine - 1)),
        titleIndex: anchor.titleIndex,
      };
  await replaceLines(
    editor,
    block,
    block.startLine,
    block.endLine,
    rendered,
    placeCursor === true ? { anchor: middleAnchor, target } : undefined
  );
  const fresh = findBlockAtLine(doc, block.startLine);
  if (fresh && isExpandedBox(doc, fresh)) {
    if (placeCursor === "below") {
      placeCursorBelowBox(editor, fresh);
    } else if (placeCursor === true) {
      const pos = editor.selection.active;
      if (pos.line <= fresh.startLine || pos.line >= fresh.endLine) {
        restoreCursor(editor, fresh, middleAnchor, "middle");
      }
    }
  }
  skipCollapseOnce = true;
  activeCollapsed.delete(key);
  activeBox.delete(key);
  updateCollapsedEditContext(editor, activeCollapsed);
}

async function collapseBlock(
  editor: vscode.TextEditor,
  block: BoxBlock,
  cursor?: CursorAnchor
): Promise<void> {
  const key = uriKey(editor.document);
  const doc = editor.document;
  const anchor =
    cursor ??
    captureCursorAnchor(doc, block, editor.selection.active);
  const stored = activeBox.get(key);
  const overrides =
    block.overrides ??
    (stored && stored.startLine === block.startLine ? stored.overrides : undefined);
  const lines = extractLinesFromBlock(doc, block);
  const savedRendered = isExpandedBox(doc, block)
    ? linesInRange(doc, block.startLine, block.endLine)
    : undefined;
  const marker = markerLines(lines, block.style, overrides);
  const expectedMarkerLines = [...marker];
  const markerAnchor: CursorAnchor = isExpandedBox(doc, block)
    ? { line: block.startLine + (anchor.line - block.startLine - 1), titleIndex: anchor.titleIndex }
    : anchor;
  const safeMarkerLine = Math.max(
    block.startLine,
    Math.min(markerAnchor.line, block.startLine + marker.length - 1)
  );
  await replaceLines(editor, block, block.startLine, block.endLine, marker, {
    anchor: { line: safeMarkerLine, titleIndex: markerAnchor.titleIndex },
    target: "marker",
  });
  activeBox.delete(key);
  activeCollapsed.set(key, {
    startLine: block.startLine,
    endLine: block.startLine + marker.length - 1,
    cursorLine: safeMarkerLine,
    titleIndex: markerAnchor.titleIndex,
    expectedMarkerLines,
    savedRendered,
    docVersionAfterCollapse: editor.document.version,
  });
  updateCollapsedEditContext(editor, activeCollapsed);
}

function selectionTouchesBlock(
  selection: vscode.Selection,
  block: BoxBlock
): boolean {
  const start = selection.start.line;
  const end = selection.end.line;
  return start <= block.endLine && end >= block.startLine;
}

/** True when the cursor is on a middle row (not the top/bottom border lines). */
function selectionOnBoxMiddleRow(
  doc: vscode.TextDocument,
  selection: vscode.Selection,
  block: BoxBlock
): boolean {
  if (!isExpandedBox(doc, block) || !selectionTouchesBlock(selection, block)) {
    return false;
  }
  const line = selection.active.line;
  if (line <= block.startLine || line >= block.endLine) {
    return false;
  }
  return parseBoxMiddle(doc.lineAt(line).text) !== null;
}

function syncCollapsedEndLine(doc: vscode.TextDocument, collapsed: CollapsedState): void {
  const block = findMarkerBlockAt(doc, collapsed.startLine);
  if (block) {
    collapsed.endLine = block.endLine;
    return;
  }
  const pending = collapsed.endLine + 1;
  if (pending < doc.lineCount && isPendingMarkerLine(doc.lineAt(pending).text)) {
    return;
  }
}

function collapsedStillInside(
  doc: vscode.TextDocument,
  sel: vscode.Selection,
  collapsed: CollapsedState
): boolean {
  const line = sel.active.line;
  if (line >= collapsed.startLine && line <= collapsed.endLine) {
    return true;
  }
  if (line === collapsed.endLine + 1 && isPendingMarkerLine(doc.lineAt(line).text)) {
    return true;
  }
  return false;
}

function headerState() {
  return {
    activeCollapsed,
    activeBox,
    applyingEdit: () => applyingEdit,
    setApplyingEdit: (v: boolean) => {
      applyingEdit = v;
    },
    expandBlock,
    placeCursorBelowBox,
    finalizeCommit: (ed: vscode.TextEditor) => updateEditorContexts(ed),
  };
}

async function onSelectionChange(e: vscode.TextEditorSelectionChangeEvent): Promise<void> {
  if (applyingEdit || e.textEditor.document.uri.scheme !== "file") {
    return;
  }

  const editor = e.textEditor;
  try {
  const doc = editor.document;
  const key = uriKey(doc);
  const sel = editor.selection;
  const cursorLine = sel.active.line;

  const prevCollapsed = activeCollapsed.get(key);
  if (prevCollapsed !== undefined) {
    if (collapsedStillInside(doc, sel, prevCollapsed)) {
      syncCollapsedEndLine(doc, prevCollapsed);
      const collapsedBlock = findBlockAtLine(doc, sel.active.line);
      if (collapsedBlock) {
        const anchor = captureCursorAnchor(doc, collapsedBlock, sel.active);
        prevCollapsed.cursorLine = anchor.line;
        prevCollapsed.titleIndex = anchor.titleIndex;
      }
    } else {
      await commitPendingHeaderEdits(editor, headerState());
    }
  }

  if (!activeCollapsed.has(key)) {
    const prevDraft = activeMarkerDraft.get(key);
    if (prevDraft) {
      const draftBlock =
        findMarkerBlockWithPending(doc, prevDraft.startLine) ??
        findMarkerBlockAt(doc, prevDraft.startLine);
      if (draftBlock && selectionInMarkerBlock(doc, sel, draftBlock)) {
        prevDraft.endLine = draftBlock.endLine;
        const anchor = captureCursorAnchor(doc, draftBlock, sel.active);
        prevDraft.cursorLine = anchor.line;
        prevDraft.titleIndex = anchor.titleIndex;
      } else {
        const block = findMarkerBlockAt(doc, prevDraft.startLine);
        if (block && markerBlockReadyToExpand(doc, block)) {
          await expandBlock(editor, block, undefined, "below");
        }
        activeMarkerDraft.delete(key);
      }
    }

    const atMarker = findMarkerBlockWithPending(doc, cursorLine);
    if (
      atMarker &&
      !isExpandedBox(doc, atMarker) &&
      (isMarkerBlock(doc, atMarker) ||
        isPendingMarkerLine(doc.lineAt(cursorLine).text))
    ) {
      const anchor = captureCursorAnchor(doc, atMarker, sel.active);
      activeMarkerDraft.set(key, {
        startLine: atMarker.startLine,
        endLine: atMarker.endLine,
        cursorLine: anchor.line,
        titleIndex: anchor.titleIndex,
      });
    }
  }

  const prevBox = activeBox.get(key);
  if (prevBox && isExpandedBox(doc, prevBox)) {
    const stillInBox = selectionTouchesBlock(sel, prevBox);
    if (stillInBox) {
      const anchor = captureCursorAnchor(doc, prevBox, sel.active);
      prevBox.cursorLine = anchor.line;
      prevBox.titleIndex = anchor.titleIndex;
    } else {
      await commitPendingHeaderEdits(editor, headerState());
    }
  }

  const block = findBlockAtLine(doc, cursorLine);
  const clickingExpandedBox =
    block &&
    !isMarkerBlock(doc, block) &&
    isExpandedBox(doc, block) &&
    selectionOnBoxMiddleRow(doc, sel, block) &&
    !activeCollapsed.has(key);

  if (clickingExpandedBox) {
    if (skipCollapseOnce) {
      skipCollapseOnce = false;
    } else {
      const lines = extractLinesFromBlock(doc, block);
      await collapseBlock(editor, { ...block, lines });
      return;
    }
  }

  if (
    block &&
    isExpandedBox(doc, block) &&
    selectionOnBoxMiddleRow(doc, sel, block) &&
    !activeCollapsed.has(key)
  ) {
    const anchor = captureCursorAnchor(doc, block, sel.active);
    activeBox.set(key, {
      ...block,
      cursorLine: anchor.line,
      titleIndex: anchor.titleIndex,
    });
  }
  } finally {
    updateEditorContexts(editor);
  }
}

async function commitMarkerDraftIfNeeded(
  editor: vscode.TextEditor
): Promise<void> {
  if (applyingEdit || editor.document.uri.scheme !== "file") {
    return;
  }
  const key = uriKey(editor.document);
  if (activeCollapsed.has(key)) {
    return;
  }
  const draft = activeMarkerDraft.get(key);
  if (!draft) {
    return;
  }
  activeMarkerDraft.delete(key);
  const doc = editor.document;
  const block = findMarkerBlockAt(doc, draft.startLine);
  if (block && markerBlockReadyToExpand(doc, block)) {
    await expandBlock(editor, block, undefined, "below");
  }
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
  if (activeCollapsed.has(key) || activeMarkerDraft.has(key)) {
    return;
  }

  for (const block of scanMarkerBlocks(doc)) {
    if (!markerBlockReadyToExpand(doc, block)) {
      continue;
    }
    if (selectionInMarkerBlock(doc, editor.selection, block)) {
      continue;
    }
    await expandBlock(editor, block, undefined, false);
    return;
  }
}

async function refreshAllBoxes(editor: vscode.TextEditor): Promise<void> {
  if (activeCollapsed.has(uriKey(editor.document))) {
    return;
  }
  const doc = editor.document;
  const blocks = scanBoxBlocks(doc);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const fresh = findBlockAtLine(editor.document, block.startLine);
    if (!fresh || !isExpandedBox(editor.document, fresh)) {
      continue;
    }
    const lines = extractLinesFromBlock(editor.document, fresh);
    const rendered = renderBoxLines(lines, fresh.style, fresh.overrides);
    const current: string[] = [];
    for (let l = fresh.startLine; l <= fresh.endLine; l++) {
      current.push(editor.document.lineAt(l).text);
    }
    if (current.join("\n") !== rendered.join("\n")) {
      await expandBlock(editor, { ...fresh, lines }, undefined, false);
    }
  }
}

/** Middle-row titles match content lines (box may differ only in bar width/padding). */
function expandedTitlesMatchContent(
  doc: vscode.TextDocument,
  block: BoxBlock,
  contentLines: string[]
): boolean {
  const mids: string[] = [];
  for (let l = block.startLine + 1; l < block.endLine; l++) {
    const t = parseBoxMiddle(doc.lineAt(l).text);
    if (t === null) {
      return false;
    }
    mids.push(t);
  }
  return (
    mids.length === contentLines.length &&
    mids.every((t, i) => t === contentLines[i])
  );
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

  for (const block of scanBoxBlocks(doc)) {
    const cursor = editor.selection.active.line;
    if (cursor >= block.startLine && cursor <= block.endLine) {
      return;
    }
    const lines = extractLinesFromBlock(doc, block);
    const rendered = renderBoxLines(lines, block.style, block.overrides);
    const current: string[] = [];
    for (let l = block.startLine; l <= block.endLine; l++) {
      current.push(doc.lineAt(l).text);
    }
    if (current.join("\n") === rendered.join("\n")) {
      return;
    }
    if (expandedTitlesMatchContent(doc, block, lines)) {
      return;
    }
    await expandBlock(editor, { ...block, lines });
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

function configAffectsHeaderHelper(e: vscode.ConfigurationChangeEvent): boolean {
  return (
    e.affectsConfiguration("headerHelper.uppercase") ||
    e.affectsConfiguration("headerHelper.length") ||
    e.affectsConfiguration("headerHelper.innerWidth") ||
    e.affectsConfiguration("headerHelper.align")
  );
}

function updateEditorContexts(editor: vscode.TextEditor | undefined): void {
  updateHeaderEditContext(editor);
  updateCollapsedEditContext(editor, activeCollapsed);
}

export function activate(context: vscode.ExtensionContext): void {
  registerDeleteGuard(context);
  registerCollapsedEnter(context, {
    activeCollapsed,
    isApplyingEdit: () => applyingEdit,
    setApplyingEdit: (v) => {
      applyingEdit = v;
    },
    syncCollapsedEndLine,
  });
  registerSaveOnBlur(context, headerState());
  let lastEditor = vscode.window.activeTextEditor;
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (lastEditor && lastEditor !== editor) {
        void commitMarkerDraftIfNeeded(lastEditor);
      }
      lastEditor = editor;
    }),
    vscode.window.onDidChangeWindowState((e) => {
      if (!e.focused) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          void commitMarkerDraftIfNeeded(editor);
        }
      }
    }),
    vscode.window.onDidChangeTextEditorSelection(onSelectionChangeWithNormalize),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (applyingEdit) {
        return;
      }
      const editor = vscode.window.activeTextEditor;
      if (editor?.document === e.document) {
        const collapsed = activeCollapsed.get(uriKey(e.document));
        if (collapsed) {
          syncCollapsedEndLine(e.document, collapsed);
        }
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!configAffectsHeaderHelper(e)) {
        return;
      }
      const editor = vscode.window.activeTextEditor;
      if (editor?.document.uri.scheme === "file") {
        void refreshAllBoxes(editor);
      }
    })
  );

  const editor = vscode.window.activeTextEditor;
  if (editor) {
    void autoExpandMarkers(editor.document);
    updateEditorContexts(editor);
  }
}

export function deactivate(): void {
  activeCollapsed.clear();
  activeBox.clear();
  activeMarkerDraft.clear();
}
