import { watch } from "node:fs";
import path from "node:path";

export interface WatchOptions {
  /** Quiet period before `onChange` fires, so one save triggers one rebuild. Default 150ms. */
  debounceMs?: number;
  /** Files to ignore, such as the output we write ourselves (otherwise every write re-triggers). */
  ignore?: string[];
}

/** Editor swap/backup files that change on every keystroke or save. */
const NOISE = /(^\.#|^#.*#$|~$|\.swp$|\.swx$|\.tmp$|^\.DS_Store$)/;

/**
 * Watch the input file's folder (so linked CSS, images and fonts count too, and editors
 * that save by replacing the file are handled) and call `onChange` after changes settle.
 * Returns a function that stops watching.
 */
export function watchInput(
  file: string,
  onChange: () => void,
  { debounceMs = 150, ignore = [] }: WatchOptions = {},
): () => void {
  const dir = path.dirname(path.resolve(file));
  const ignored = new Set(ignore.map((f) => path.resolve(f)));
  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(dir, (_event, name) => {
    if (name) {
      const base = String(name);
      if (NOISE.test(path.basename(base)) || ignored.has(path.resolve(dir, base))) return;
    }
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  });
  watcher.on("error", () => {});
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
