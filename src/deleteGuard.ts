import * as vscode from "vscode";
import {
  clampPositionToEditable,
  getHeaderEditRegion,
  HeaderEditRegion,
  selectionInEditable,
} from "./editableRegion";

const CONTEXT_FOCUS = "headerHelper.focusInHeader";

export function updateHeaderEditContext(editor: vscode.TextEditor | undefined): void {
  const focused =
    editor !== undefined &&
    editor.document.uri.scheme === "file" &&
    getHeaderEditRegion(editor.document, editor.selection.active) !== null;
  void vscode.commands.executeCommand("setContext", CONTEXT_FOCUS, focused);
}

async function applyDelete(
  editor: vscode.TextEditor,
  range: vscode.Range
): Promise<void> {
  if (range.isEmpty) {
    return;
  }
  await editor.edit((eb) => eb.delete(range));
}

async function runGuardedDelete(
  editor: vscode.TextEditor,
  mode: "left" | "right" | "allLeft" | "allRight" | "wordLeft" | "wordRight"
): Promise<void> {
  const region = getHeaderEditRegion(editor.document, editor.selection.active);
  if (!region) {
    await fallbackDelete(mode);
    return;
  }

  const sel = editor.selection;
  if (!sel.isEmpty) {
    const del = selectionInEditable(sel, region);
    if (!del || del.isEmpty) {
      await fallbackDelete(mode);
      return;
    }
    await applyDelete(editor, del);
    return;
  }

  const pos = clampPositionToEditable(sel.active, region);
  const r = region.range;

  switch (mode) {
    case "left": {
      if (pos.isEqual(r.start)) {
        await fallbackDelete(mode);
        return;
      }
      const left = pos.translate(0, -1);
      if (comparePos(left, r.start) < 0) {
        return;
      }
      await applyDelete(editor, new vscode.Range(left, pos));
      return;
    }
    case "right": {
      if (pos.isEqual(r.end)) {
        await fallbackDelete(mode);
        return;
      }
      const right = pos.translate(0, 1);
      if (comparePos(right, r.end) > 0) {
        return;
      }
      await applyDelete(editor, new vscode.Range(pos, right));
      return;
    }
    case "allLeft":
      if (pos.isEqual(r.start)) {
        await fallbackDelete(mode);
        return;
      }
      await applyDelete(editor, new vscode.Range(r.start, pos));
      return;
    case "allRight":
      if (pos.isEqual(r.end)) {
        await fallbackDelete(mode);
        return;
      }
      await applyDelete(editor, new vscode.Range(pos, r.end));
      return;
    case "wordLeft": {
      const wordStart = findWordStart(editor.document, pos, region);
      if (wordStart.isEqual(pos)) {
        await fallbackDelete(mode);
        return;
      }
      await applyDelete(editor, new vscode.Range(wordStart, pos));
      return;
    }
    case "wordRight": {
      const wordEnd = findWordEnd(editor.document, pos, region);
      if (wordEnd.isEqual(pos)) {
        await fallbackDelete(mode);
        return;
      }
      await applyDelete(editor, new vscode.Range(pos, wordEnd));
      return;
    }
  }
}

function comparePos(a: vscode.Position, b: vscode.Position): number {
  if (a.line !== b.line) {
    return a.line - b.line;
  }
  return a.character - b.character;
}

function findWordStart(
  doc: vscode.TextDocument,
  pos: vscode.Position,
  region: HeaderEditRegion
): vscode.Position {
  const line = doc.lineAt(pos.line).text;
  let col = pos.character;
  const min = region.range.start.character;
  while (col > min) {
    const ch = line[col - 1];
    if (!/\w/.test(ch)) {
      break;
    }
    col--;
  }
  return new vscode.Position(pos.line, col);
}

function findWordEnd(
  doc: vscode.TextDocument,
  pos: vscode.Position,
  region: HeaderEditRegion
): vscode.Position {
  const line = doc.lineAt(pos.line).text;
  let col = pos.character;
  const max = region.range.end.character;
  while (col < max) {
    const ch = line[col];
    if (!ch || !/\w/.test(ch)) {
      break;
    }
    col++;
  }
  return new vscode.Position(pos.line, col);
}

async function fallbackDelete(
  mode: "left" | "right" | "allLeft" | "allRight" | "wordLeft" | "wordRight"
): Promise<void> {
  const map: Record<typeof mode, string> = {
    left: "deleteLeft",
    right: "deleteRight",
    allLeft: "deleteAllLeft",
    allRight: "deleteAllRight",
    wordLeft: "deleteWordPartLeft",
    wordRight: "deleteWordPartRight",
  };
  await vscode.commands.executeCommand(map[mode]);
}

export function registerDeleteGuard(context: vscode.ExtensionContext): void {
  const cmds: [string, Parameters<typeof runGuardedDelete>[1]][] = [
    ["header-helper.deleteLeft", "left"],
    ["header-helper.deleteRight", "right"],
    ["header-helper.deleteAllLeft", "allLeft"],
    ["header-helper.deleteAllRight", "allRight"],
    ["header-helper.deleteWordLeft", "wordLeft"],
    ["header-helper.deleteWordRight", "wordRight"],
  ];

  for (const [id, mode] of cmds) {
    context.subscriptions.push(
      vscode.commands.registerTextEditorCommand(id, (editor) => runGuardedDelete(editor, mode))
    );
  }

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor.document.uri.scheme === "file") {
        updateHeaderEditContext(e.textEditor);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateHeaderEditContext(editor);
    })
  );

  updateHeaderEditContext(vscode.window.activeTextEditor);
}
