/**
 * Minimal JSONC reader for the files VS Code lets users comment: launch.json,
 * tasks.json. `JSON.parse` rejects both comments and trailing commas.
 *
 * Scanned rather than regex-replaced, so string contents survive: a
 * `"https://..."` value keeps its tail, and a `,}` inside a string is not read
 * as a trailing comma. Kept dependency-free (the extension ships no runtime
 * dependencies) and VS Code-free so it can be unit-tested directly.
 */

/** Strip `//` line comments and comment blocks outside of strings. */
export function stripComments(text: string): string {
  let out = "";
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      // A backslash escapes the next character, including a quote.
      if (c === "\\") {
        out += c + (text[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      out += c;
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      // Leave the newline: it keeps the remaining structure line-separated.
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Drop commas that sit directly before `}` or `]`. Expects comment-free input. */
export function stripTrailingCommas(text: string): string {
  let out = "";
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") {
        out += c + (text[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      out += c;
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      i++;
      continue;
    }
    if (c === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") {
        i++; // drop the comma, keep the whitespace for the next iteration
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

/** Parse JSONC. Returns undefined instead of throwing on malformed input. */
export function parseJsonc(text: string): unknown {
  try {
    return JSON.parse(stripTrailingCommas(stripComments(text)));
  } catch {
    return undefined;
  }
}
