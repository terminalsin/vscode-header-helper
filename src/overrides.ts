import * as vscode from "vscode";

export type BoxAlign = "center" | "left" | "right";

export interface BoxOverrides {
  length?: number;
  align?: BoxAlign;
  uppercase?: boolean;
}

export interface ResolvedBoxOptions {
  length: number;
  align: BoxAlign;
  uppercase: boolean;
}

const MIN_LENGTH = 20;
const MAX_LENGTH = 120;

export function clampLength(n: number): number {
  return Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, n));
}

export function parseOverrides(raw: string | undefined): BoxOverrides | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  const o: BoxOverrides = {};
  for (const part of raw.split(",")) {
    const colon = part.indexOf(":");
    if (colon < 0) {
      continue;
    }
    const key = part.slice(0, colon).trim().toLowerCase();
    const val = part.slice(colon + 1).trim();
    const valLower = val.toLowerCase();
    if (key === "length" || key === "width") {
      const n = parseInt(val, 10);
      if (!isNaN(n)) {
        o.length = clampLength(n);
      }
    } else if (key === "align" && (valLower === "left" || valLower === "right" || valLower === "center")) {
      o.align = valLower as BoxAlign;
    } else if (key === "uppercase") {
      o.uppercase = valLower === "true" || valLower === "1" || valLower === "yes";
    }
  }
  return Object.keys(o).length > 0 ? o : undefined;
}

export function serializeOverrides(o?: BoxOverrides): string {
  if (!o) {
    return "";
  }
  const parts: string[] = [];
  if (o.length != null) {
    parts.push(`length:${o.length}`);
  }
  if (o.align != null) {
    parts.push(`align:${o.align}`);
  }
  if (o.uppercase != null) {
    parts.push(`uppercase:${o.uppercase}`);
  }
  return parts.length ? `{${parts.join(",")}}` : "";
}

function getConfig() {
  return vscode.workspace.getConfiguration("headerHelper");
}

function getBoxLength(): number {
  const cfg = getConfig();
  return cfg.get<number>("length", cfg.get<number>("innerWidth", 70));
}

function getBoxAlign(): BoxAlign {
  const align = getConfig().get<string>("align", "center");
  if (align === "left" || align === "right") {
    return align;
  }
  return "center";
}

function shouldUppercase(): boolean {
  return getConfig().get<boolean>("uppercase", false);
}

export function resolveBoxOptions(overrides?: BoxOverrides): ResolvedBoxOptions {
  return {
    length: clampLength(overrides?.length ?? getBoxLength()),
    align: overrides?.align ?? getBoxAlign(),
    uppercase: overrides?.uppercase ?? shouldUppercase(),
  };
}
