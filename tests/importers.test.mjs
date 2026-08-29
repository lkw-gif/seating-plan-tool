import assert from "node:assert/strict";
import test from "node:test";
import {
  rowsToHomeroomTeachers,
  rowsToStudents,
} from "../src/importers.js";

test("reads the school roster header order", () => {
  const students = rowsToStudents([
    ["classcode", "classno", "chname", "enname", "sex"],
    ["3D", "1", "陳柏熙", "CHAN PAK HEI", "M"],
  ]);

  assert.equal(students.length, 1);
  assert.deepEqual(
    {
      className: students[0].className,
      number: students[0].number,
      chineseName: students[0].chineseName,
      englishName: students[0].englishName,
      gender: students[0].gender,
    },
    {
      className: "3D",
      number: "01",
      chineseName: "陳柏熙",
      englishName: "CHAN PAK HEI",
      gender: "男",
    },
  );
});

test("groups homeroom teachers by class and formats their initials", () => {
  const teachers = rowsToHomeroomTeachers([
    ["Initial", "ename", "cname", "Class"],
    ["LKW", "Lui Kin Wang", "雷建宏", "3D"],
    ["LYL", "Lam Yu Lun", "林宇麟", "3D"],
    ["AM", "Aamir Mushtaq", "", "1D"],
  ]);

  assert.equal(teachers["3D"], "雷建宏（LKW）、林宇麟（LYL）");
  assert.equal(teachers["1D"], "Aamir Mushtaq（AM）");
});
