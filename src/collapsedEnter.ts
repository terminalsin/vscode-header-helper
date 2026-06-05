import * as vscode from "vscode";
import {
  blockIndent,
  findMarkerBlockAt,
  isPendingMarkerLine,
  markerLineBase,
  markerLineCloseSuffix,
  newMarkerLineTemplate,
  normalizeMarkerTitle,
} from "./box";
import type { CollapsedState } from "./saveOnBlur";

export function registerCollapsedEnter(
  context: vscode.ExtensionContext,
  state: {
    activeCollapsed: Map<string, CollapsedState>;
    isApplyingEdit: () => boolean;
    setApplyingEdit: (v: boolean) => void;
    syncCollapsedEndLine: (doc: vscode.TextDocument, collapsed: CollapsedState) => void;
  }
): void {
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      "header-helper.insertMarkerLine",
      (editor) => insertNewMarkerLine(editor, state)
    )
  );
}

export function updateCollapsedEditContext(
  editor: vscode.TextEditor | undefined,
  activeCollapsed: Map<string, CollapsedState>
): void {
  const inCollapsed =
    editor !== undefined &&
    editor.document.uri.scheme === "file" &&
    activeCollapsed.has(editor.document.uri.toString());
  void vscode.commands.executeCommand("setContext", "headerHelper.collapsedEdit", inCollapsed);
}

async function insertNewMarkerLine(
  editor: vscode.TextEditor,
  state: {
    activeCollapsed: Map<string, CollapsedState>;
    isApplyingEdit: () => boolean;
    setApplyingEdit: (v: boolean) => void;
    syncCollapsedEndLine: (doc: vscode.TextDocument, collapsed: CollapsedState) => void;
  }
): Promise<void> {
  const doc = editor.document;
  const key = doc.uri.toString();
  const collapsed = state.activeCollapsed.get(key);
  if (!collapsed || state.isApplyingEdit()) {
    await vscode.commands.executeCommand("type", { text: "\n" });
    return;
  }

  const block = findMarkerBlockAt(doc, collapsed.startLine);
  if (!block) {
    return;
  }

  const pos = editor.selection.active;
  const lineNum = pos.line;
  if (lineNum < collapsed.startLine || lineNum > collapsed.endLine + 1) {
    await vscode.commands.executeCommand("type", { text: "\n" });
    return;
  }

  const indent = blockIndent(doc, block);
  const template = newMarkerLineTemplate(block.style, indent);
  const close = markerLineCloseSuffix(block.style);
  const lineText = doc.lineAt(lineNum).text;

  state.setApplyingEdit(true);
  try {
    if (isPendingMarkerLine(lineText) && !lineText.trim()) {
      await editor.edit((eb) => {
        eb.replace(
          new vscode.Range(lineNum, 0, lineNum, lineText.length),
          template.line
        );
      });
      const anchor = new vscode.Position(lineNum, template.cursorCol);
      editor.selection = new vscode.Selection(anchor, anchor);
      collapsed.cursorLine = lineNum;
      collapsed.titleIndex = 0;
      return;
    }

    const textAfterCursor = lineText.slice(pos.character);
    const optsMatch = lineText.match(/(\{[^}]*\})\s*$/);
    const opts = optsMatch?.[1] ?? "";

    const inner = normalizeMarkerTitle(
      textAfterCursor
        .replace(/\{[^}]*\}/, "")
        .replace(/\]\s*\*\/\s*$/, "")
        .replace(/\]$/, "")
    );

    if (inner.length > 0) {
      const newLineText = `${indent}${markerLineBase(block.style)}${inner}${close}`;

      await editor.edit((eb) => {
        eb.replace(
          new vscode.Range(lineNum, pos.character, lineNum, lineText.length),
          `${close}${opts}`
        );
        eb.insert(
          new vscode.Position(lineNum, pos.character + close.length),
          `\n${newLineText}`
        );
      });
    } else {
      const open = lineText.indexOf("[");
      const needsClose =
        open >= 0 && lineText.indexOf("]", open + 1) < 0;
      const tail = needsClose ? `${close}${opts}\n${template.line}` : `\n${template.line}`;
      await editor.edit((eb) => {
        eb.insert(new vscode.Position(lineNum, lineText.length), tail);
      });
    }

    const newLine = lineNum + 1;
    const anchor = new vscode.Position(newLine, template.cursorCol);
    editor.selection = new vscode.Selection(anchor, anchor);
    collapsed.endLine = Math.max(collapsed.endLine, newLine);
    collapsed.cursorLine = newLine;
    collapsed.titleIndex = 0;
    state.syncCollapsedEndLine(doc, collapsed);
  } finally {
    state.setApplyingEdit(false);
  }
}
