// A session name becomes a folder name under .team/sessions/ (and is deleted along with it), so it is one plain
// path segment that every OS accepts: no "." or "..", nothing that starts or ends with a dot, no Windows device names.
import { localParts } from "./local-time.ts";

const NAME = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

/** Windows treats these as devices, with or without an extension ("nul.txt"), whatever the case. */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Whether `name` can be a session name. Never throws, so it can sort the entries of a folder. */
export function isSessionName(name: string): boolean {
  return NAME.test(name) && !WINDOWS_DEVICE.test(name.split(".")[0]);
}

/** Returns `name` once it is known to be safe to put in a path, and says what is allowed when it is not. */
export function assertSessionName(name: string): string {
  if (!isSessionName(name)) {
    throw new Error(
      `invalid session name: ${JSON.stringify(name)} (use ASCII letters, digits, "_" and "-", which may be joined by single dots; not a Windows device name such as con, nul or com1)`,
    );
  }
  return name;
}

/**
 * The name `init` gives a session when none is passed: the local date and time to the minute (20261115-1355), so it
 * matches the clock the person reads, not UTC. It says nothing about the product; `--name` is for that.
 */
export function defaultSessionName(at: Date): string {
  const t = localParts(at);
  return `${t.year}${t.month}${t.day}-${t.hour}${t.minute}`;
}
