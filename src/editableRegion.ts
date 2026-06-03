import * as vscode from "vscode";
import {
  BoxBlock,
  findBlockAtLine,
  isExpandedBox,
  isMarkerBlock,
  isPendingMarkerLine,
  markerContentRange,
  offsetInBoxMiddleLine,
  parseBoxMiddle,
  parseMarkerLine,
  salvageMarkerFromLine,
} from "./box";

export interface HeaderEditRegion {
  range: vscode.Range;
  block: BoxBlock;
}

export function getHeaderEditRegion(
  doc: vscode.TextDocument,
  position: vscode.Position
): HeaderEditRegion | null {
  const block = findBlockAtLine(doc, position.line);
  if (!block) {
    return null;
  }

  if (isMarkerBlock(doc, block)) {
    if (position.line < block.startLine || position.line > block.endLine) {
      return null;
    }
    const lineText = doc.lineAt(position.line).text;
    if (!isPendingMarkerLine(lineText) && !parseMarkerLine(lineText) && !salvageMarkerFromLine(lineText)) {
      return null;
    }
    const content = markerContentRange(lineText);
    if (content) {
      if (
        position.character < content.start ||
        position.character > content.end
      ) {
        return null;
      }
      return {
        block,
        range: new vscode.Range(
          position.line,
          content.start,
          position.line,
          content.end
        ),
      };
    }
    return {
      block,
      range: new vscode.Range(position.line, 0, position.line, lineText.length),
    };
  }

  if (!isExpandedBox(doc, block)) {
    return null;
  }

  if (position.line <= block.startLine || position.line >= block.endLine) {
    return null;
  }

  const lineText = doc.lineAt(position.line).text;
  const parsed = parseBoxMiddle(lineText);
  if (!parsed) {
    return null;
  }
  const start = offsetInBoxMiddleLine(lineText, 0, block.overrides);
  const end = offsetInBoxMiddleLine(lineText, parsed.length, block.overrides);
  if (position.character < start || position.character > end) {
    return null;
  }
  return {
    block,
    range: new vscode.Range(position.line, start, position.line, end),
  };
}

function comparePos(a: vscode.Position, b: vscode.Position): number {
  if (a.line !== b.line) {
    return a.line - b.line;
  }
  return a.character - b.character;
}

export function selectionInEditable(
  selection: vscode.Selection,
  region: HeaderEditRegion
): vscode.Range | null {
  const r = region.range;
  const startLine = Math.max(selection.start.line, r.start.line);
  const endLine = Math.min(selection.end.line, r.end.line);
  if (startLine > endLine) {
    return null;
  }

  let startChar = selection.start.character;
  let endChar = selection.end.character;
  if (selection.start.line < r.start.line) {
    startChar = r.start.character;
  } else if (selection.start.line === r.start.line) {
    startChar = Math.max(startChar, r.start.character);
  }
  if (selection.end.line > r.end.line) {
    endChar = r.end.character;
  } else if (selection.end.line === r.end.line) {
    endChar = Math.min(endChar, r.end.character);
  }

  const start = new vscode.Position(startLine, startChar);
  const end = new vscode.Position(endLine, endChar);
  if (comparePos(start, end) > 0) {
    return null;
  }
  if (comparePos(start, end) === 0 && !selection.isEmpty) {
    return null;
  }
  return new vscode.Range(start, end);
}

export function clampPositionToEditable(
  pos: vscode.Position,
  region: HeaderEditRegion
): vscode.Position {
  const r = region.range;
  if (comparePos(pos, r.start) < 0) {
    return r.start;
  }
  if (comparePos(pos, r.end) > 0) {
    return r.end;
  }
  return pos;
}
