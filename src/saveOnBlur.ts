import * as vscode from "vscode";
import {
  BoxBlock,
  extractLinesFromBlock,
  findBlockAtLine,
  findMarkerBlockAt,
  isExpandedBox,
  linesEqual,
  linesInRange,
} from "./box";

export interface CursorPlacement {
  linesBelowEnd?: number;
  character?: number;
}

function collapsedExitPlacement(
  exitPos: vscode.Position,
  collapsed: CollapsedState
): { placeCursor: "below" | "preserve"; placement?: CursorPlacement } {
  if (exitPos.line < collapsed.startLine) {
    return { placeCursor: "preserve" };
  }
  if (exitPos.line > collapsed.endLine) {
    return {
      placeCursor: "below",
      placement: {
        linesBelowEnd: exitPos.line - collapsed.endLine - 1,
        character: exitPos.character,
      },
    };
  }
  return { placeCursor: "below", placement: { linesBelowEnd: 0 } };
}

export interface CollapsedState {
  startLine: number;
  endLine: number;
  cursorLine: number;
  titleIndex: number;
  /** Marker lines written when collapsing (compare on commit to detect edits). */
  expectedMarkerLines: string[];
  /** Exact rendered box lines before collapse (restore when markers unchanged). */
  savedRendered?: string[];
  /** Document version right after collapse (only collapse edit → undo on noop commit). */
  docVersionAfterCollapse: number;
}

export interface PendingHeaderState {
  activeCollapsed: Map<string, CollapsedState>;
  activeBox: Map<string, BoxBlock & { cursorLine: number; titleIndex: number }>;
  applyingEdit: () => boolean;
  setApplyingEdit: (value: boolean) => void;
  expandBlock: (
    editor: vscode.TextEditor,
    block: BoxBlock,
    cursor?: { line: number; titleIndex: number },
    placeCursor?: boolean | "below" | "preserve",
    restoreRendered?: string[],
    placement?: CursorPlacement
  ) => Promise<void>;
  placeCursorBelowBox: (
    editor: vscode.TextEditor,
    block: BoxBlock,
    placement?: CursorPlacement
  ) => void;
  finalizeCommit: (editor: vscode.TextEditor) => void;
}

function uriKey(doc: vscode.TextDocument): string {
  return doc.uri.toString();
}

function blockFromCollapsed(
  doc: vscode.TextDocument,
  collapsed: CollapsedState
): BoxBlock | null {
  return findMarkerBlockAt(doc, collapsed.startLine);
}

/** Commit in-progress header edits (marker or box title) back to the rendered box. */
export async function commitPendingHeaderEdits(
  editor: vscode.TextEditor,
  state: PendingHeaderState
): Promise<boolean> {
  if (state.applyingEdit() || editor.document.uri.scheme !== "file") {
    return false;
  }

  const key = uriKey(editor.document);
  const doc = editor.document;
  let committed = false;

  const collapsed = state.activeCollapsed.get(key);
  if (collapsed) {
    const block = blockFromCollapsed(doc, collapsed);
    try {
      if (block) {
        const lines = extractLinesFromBlock(doc, block);
        const currentMarkers = linesInRange(
          doc,
          collapsed.startLine,
          collapsed.endLine
        );
        const markersUnchanged = linesEqual(
          currentMarkers,
          collapsed.expectedMarkerLines
        );
        const restoreRendered =
          markersUnchanged && collapsed.savedRendered?.length
            ? collapsed.savedRendered
            : undefined;

        const { placeCursor, placement } = collapsedExitPlacement(
          editor.selection.active,
          collapsed
        );

        state.setApplyingEdit(true);
        try {
          const onlyCollapseChangedDoc =
            restoreRendered &&
            doc.version === collapsed.docVersionAfterCollapse;

          if (onlyCollapseChangedDoc) {
            await vscode.commands.executeCommand("undo");
            const restored = findBlockAtLine(doc, collapsed.startLine);
            if (
              restored &&
              isExpandedBox(doc, restored) &&
              linesEqual(
                linesInRange(doc, restored.startLine, restored.endLine),
                restoreRendered
              )
            ) {
              if (placeCursor === "below") {
                state.placeCursorBelowBox(editor, restored, placement);
              }
              committed = true;
            } else {
              await state.expandBlock(
                editor,
                { ...block, lines },
                {
                  line: collapsed.cursorLine,
                  titleIndex: collapsed.titleIndex,
                },
                placeCursor,
                restoreRendered,
                placement
              );
              committed = true;
            }
          } else {
            await state.expandBlock(
              editor,
              { ...block, lines },
              {
                line: collapsed.cursorLine,
                titleIndex: collapsed.titleIndex,
              },
              placeCursor,
              restoreRendered,
              placement
            );
            committed = true;
          }
        } finally {
          state.setApplyingEdit(false);
        }
      }
    } finally {
      state.activeCollapsed.delete(key);
      state.activeBox.delete(key);
      state.finalizeCommit(editor);
    }
    return committed;
  }

  const prevBox = state.activeBox.get(key);
  if (prevBox && prevBox.startLine !== prevBox.endLine) {
    state.activeBox.delete(key);
    const current = findBlockAtLine(doc, prevBox.startLine);
    if (current && current.startLine !== current.endLine) {
      const lines = extractLinesFromBlock(doc, current);
      state.setApplyingEdit(true);
      try {
        await state.expandBlock(
          editor,
          { ...current, lines },
          { line: prevBox.cursorLine, titleIndex: prevBox.titleIndex },
          false
        );
        committed = true;
      } finally {
        state.setApplyingEdit(false);
      }
    }
  }

  return committed;
}

export function registerSaveOnBlur(
  context: vscode.ExtensionContext,
  state: PendingHeaderState
): void {
  let lastEditor = vscode.window.activeTextEditor;

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (lastEditor && lastEditor !== editor) {
        void commitPendingHeaderEdits(lastEditor, state);
      }
      lastEditor = editor;
    }),
    vscode.window.onDidChangeWindowState((e) => {
      if (!e.focused) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          void commitPendingHeaderEdits(editor, state);
        }
      }
    })
  );
}
