import assert from "node:assert/strict";
import test from "node:test";
import { getExportLayout } from "../src/exportLayout.js";

test("reverses rows, columns, and aisle locations for blackboard-bottom exports", () => {
  const seats = ["A", "B", "C", "D", "E", "F"];
  const layout = getExportLayout({
    seats,
    rows: 2,
    cols: 3,
    columnGaps: [true, false],
    exportOrientation: "reversed",
  });

  assert.equal(layout.reversed, true);
  assert.deepEqual(layout.seats, ["F", "E", "D", "C", "B", "A"]);
  assert.deepEqual(layout.columnGaps, [false, true]);
});

test("keeps the editing layout unchanged for blackboard-top exports", () => {
  const seats = ["A", "B", "C", "D"];
  const layout = getExportLayout({
    seats,
    rows: 2,
    cols: 2,
    columnGaps: [true],
    exportOrientation: "front",
  });

  assert.equal(layout.reversed, false);
  assert.deepEqual(layout.seats, seats);
  assert.deepEqual(layout.columnGaps, [true]);
});
