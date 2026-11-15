import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSessionName, isSessionName } from "../src/session-name.ts";

// The dates are built from local parts, the way the name is read back, so these hold in any time zone.

test("the default session name is the local date and time down to the minute", () => {
  assert.equal(defaultSessionName(new Date(2026, 10, 15, 13, 55, 59)), "20261115-1355");
});

test("the default session name pads the month, day, hour and minute to two digits", () => {
  assert.equal(defaultSessionName(new Date(2026, 0, 2, 3, 4)), "20260102-0304");
  assert.equal(defaultSessionName(new Date(2026, 11, 31, 0, 0)), "20261231-0000");
});

test("the default session name is accepted as a session name", () => {
  assert.ok(isSessionName(defaultSessionName(new Date(2026, 10, 15, 13, 55))));
});
