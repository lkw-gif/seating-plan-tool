import assert from "node:assert/strict";
import test from "node:test";
import { Packer } from "docx";
import JSZip from "jszip";
import { createPlanDocx } from "../src/exporters.js";

test("places seats before the classroom front in a blackboard-bottom DOCX", async () => {
  const students = [
    { id: "a", number: "30", chineseName: "余朗", englishName: "YU LONG CADEN", gender: "男" },
    { id: "b", number: "02", chineseName: "陳迪謙", englishName: "CHAN TIK HIM", gender: "男" },
    { id: "c", number: "24", chineseName: "白莉沙", englishName: "THAPA MEENISHA", gender: "女" },
    { id: "d", number: "03", chineseName: "張予蕎", englishName: "CHEUNG YU KIU", gender: "女" },
  ];
  const document = createPlanDocx({
    className: "3D",
    teachers: "雷建宏（LKW）",
    maleMonitor: "",
    femaleMonitor: "",
    rows: 2,
    cols: 2,
    columnGaps: [true],
    seats: students.map((student, index) => ({ id: `seat-${index}`, studentId: student.id })),
    students,
    exportOrientation: "reversed",
  });
  const archive = await JSZip.loadAsync(await Packer.toBuffer(document));
  const xml = await archive.file("word/document.xml").async("string");

  assert.ok(xml.includes('w:orient="landscape"'));
  assert.ok(xml.indexOf("張予蕎") < xml.indexOf("教師桌"));
  assert.ok(xml.indexOf("教師桌") < xml.indexOf("黑板"));
  assert.ok(xml.indexOf("黑板") < xml.indexOf("門口"));
  assert.ok(xml.indexOf("白莉沙") < xml.indexOf("余朗"));
});
