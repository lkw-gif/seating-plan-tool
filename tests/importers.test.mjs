import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  parseSchoolWorkbook,
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

test("reads the four-column personal roster format", () => {
  const students = rowsToStudents([
    ["01", "陳大文", "Chan Tai Man", "男"],
  ]);

  assert.deepEqual(
    {
      className: students[0].className,
      number: students[0].number,
      chineseName: students[0].chineseName,
      englishName: students[0].englishName,
      gender: students[0].gender,
    },
    {
      className: "",
      number: "01",
      chineseName: "陳大文",
      englishName: "Chan Tai Man",
      gender: "男",
    },
  );
});

test("reads students from A:E and homeroom teachers from G:J", () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["classcode", "classno", "chname", "enname", "sex", "", "Initial", "ename", "cname", "Class"],
    ["1A", "1", "陳浩天", "CHAN HO TIN", "M", "", "MKY", "Man Kam Yin", "文錦燕", "1A"],
    ["1A", "2", "陳怡樺", "CHAN YI WA", "F", "", "TST", "Tam Siu Tak Jeffrey", "譚紹德", "1A"],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Students");
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });

  const result = parseSchoolWorkbook(buffer);
  assert.deepEqual(result.classes, ["1A"]);
  assert.equal(result.students.length, 2);
  assert.equal(result.students[0].number, "01");
  assert.equal(result.students[1].gender, "女");
  assert.equal(result.teachersByClass["1A"], "文錦燕（MKY）、譚紹德（TST）");
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
