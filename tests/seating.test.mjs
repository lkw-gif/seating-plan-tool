import assert from "node:assert/strict";
import test from "node:test";

import {
  clearSeatAssignments,
  getUnassignedStudents,
} from "../src/seating.js";

test("returns unassigned students in numeric class-number order", () => {
  const students = [
    { id: "student-10", number: "10" },
    { id: "student-2", number: "2" },
    { id: "student-01", number: "01" },
  ];
  const seats = [{ studentId: "student-2" }];

  assert.deepEqual(
    getUnassignedStudents(students, seats).map((student) => student.number),
    ["01", "10"],
  );
});

test("clears every assignment and lock while preserving disabled seats", () => {
  const seats = [
    { studentId: "student-1", locked: true, disabled: false },
    { studentId: "student-2", locked: false, disabled: true },
  ];

  assert.deepEqual(clearSeatAssignments(seats), [
    { studentId: null, locked: false, disabled: false },
    { studentId: null, locked: false, disabled: true },
  ]);
  assert.equal(seats[0].studentId, "student-1");
});
