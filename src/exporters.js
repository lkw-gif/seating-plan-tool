import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  PageOrientation,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const thinBorder = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: "B8C0C7",
};

const boardBorder = {
  style: BorderStyle.SINGLE,
  size: 8,
  color: "244A39",
};

const doorBorder = {
  style: BorderStyle.SINGLE,
  size: 6,
  color: "B58B4A",
};

const noBorders = {
  top: { style: BorderStyle.NONE },
  bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE },
  right: { style: BorderStyle.NONE },
};

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function textParagraph(text, options = {}) {
  return new Paragraph({
    alignment: options.alignment ?? AlignmentType.CENTER,
    spacing: { before: 0, after: options.after ?? 30, line: 240 },
    children: [
      new TextRun({
        text,
        bold: options.bold ?? false,
        size: options.size ?? 20,
        font: options.font ?? "Microsoft JhengHei",
        color: options.color ?? "1F2933",
      }),
    ],
  });
}

function studentCell(seat, student, width) {
  const children = [];
  if (seat.disabled) {
    children.push(textParagraph("不可用", { color: "7B8794", size: 18 }));
  } else if (student) {
    children.push(
      textParagraph(student.chineseName || " ", { bold: true, size: 20 }),
      textParagraph(student.englishName || " ", { size: 18 }),
      textParagraph(student.number || " ", { size: 17, color: "52606D" }),
    );
  } else {
    children.push(textParagraph(" "));
  }

  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 90, bottom: 90, left: 70, right: 70 },
    shading: seat.disabled
      ? { fill: "F1F3F5", type: ShadingType.CLEAR, color: "auto" }
      : student?.gender === "男"
        ? { fill: "EAF4FF", type: ShadingType.CLEAR, color: "auto" }
        : student?.gender === "女"
          ? { fill: "FDEEF4", type: ShadingType.CLEAR, color: "auto" }
          : undefined,
    borders: {
      top: thinBorder,
      bottom: thinBorder,
      left: thinBorder,
      right: thinBorder,
    },
    children,
  });
}

function aisleCell(width) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
    },
    children: [new Paragraph("")],
  });
}

export async function exportPlanDocx({
  className,
  teachers,
  maleMonitor,
  femaleMonitor,
  rows,
  cols,
  columnGaps,
  seats,
  students,
}) {
  const studentMap = new Map(students.map((student) => [student.id, student]));
  const aisleAfter = new Set(
    columnGaps
      .map((separated, index) => (separated ? index : null))
      .filter((index) => index !== null),
  );
  const aisleWidth = 320;
  const usableWidth = 14700;
  const seatWidth = Math.floor(
    (usableWidth - aisleAfter.size * aisleWidth) / cols,
  );
  const columnWidths = [];
  for (let col = 0; col < cols; col += 1) {
    columnWidths.push(seatWidth);
    if (aisleAfter.has(col)) columnWidths.push(aisleWidth);
  }

  const seatRows = Array.from({ length: rows }, (_, row) => {
    const cells = [];
    for (let col = 0; col < cols; col += 1) {
      const seat = seats[row * cols + col];
      cells.push(studentCell(seat, studentMap.get(seat.studentId), seatWidth));
      if (aisleAfter.has(col)) cells.push(aisleCell(aisleWidth));
    }
    return new TableRow({
      height: { value: 1180, rule: HeightRule.ATLEAST },
      children: cells,
    });
  });

  const document = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Microsoft JhengHei", size: 20, color: "1F2933" },
          paragraph: { spacing: { after: 0 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906,
              height: 16838,
              orientation: PageOrientation.LANDSCAPE,
            },
            margin: { top: 420, right: 560, bottom: 420, left: 560 },
          },
        },
        children: [
          new Table({
            width: { size: usableWidth, type: WidthType.DXA },
            columnWidths: [4200, 6300, 4200],
            borders: {
              top: { style: BorderStyle.NONE },
              bottom: { style: BorderStyle.NONE },
              left: { style: BorderStyle.NONE },
              right: { style: BorderStyle.NONE },
              insideHorizontal: { style: BorderStyle.NONE },
              insideVertical: { style: BorderStyle.NONE },
            },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [
                      textParagraph(`班別：${className}`, {
                        alignment: AlignmentType.LEFT,
                        bold: true,
                        size: 30,
                      }),
                    ],
                  }),
                  new TableCell({
                    children: [
                      textParagraph("課室座位表  Seating Plan", {
                        bold: true,
                        size: 25,
                      }),
                    ],
                  }),
                  new TableCell({
                    children: [
                      textParagraph(`班主任：${teachers || ""}`, {
                        alignment: AlignmentType.RIGHT,
                        size: 20,
                      }),
                      textParagraph(`男班長：${maleMonitor || ""}`, {
                        alignment: AlignmentType.RIGHT,
                        size: 20,
                      }),
                      textParagraph(`女班長：${femaleMonitor || ""}`, {
                        alignment: AlignmentType.RIGHT,
                        size: 20,
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
          new Paragraph({ spacing: { after: 90 } }),
          new Table({
            alignment: AlignmentType.CENTER,
            width: { size: usableWidth, type: WidthType.DXA },
            columnWidths: [1500, 2050, 7600, 2050, 1500],
            borders: {
              top: { style: BorderStyle.NONE },
              bottom: { style: BorderStyle.NONE },
              left: { style: BorderStyle.NONE },
              right: { style: BorderStyle.NONE },
              insideHorizontal: { style: BorderStyle.NONE },
              insideVertical: { style: BorderStyle.NONE },
            },
            rows: [
              new TableRow({
                height: { value: 520, rule: HeightRule.ATLEAST },
                children: [
                  new TableCell({
                    width: { size: 1500, type: WidthType.DXA },
                    verticalAlign: VerticalAlign.CENTER,
                    shading: { fill: "FFF7E6", type: ShadingType.CLEAR, color: "auto" },
                    borders: {
                      top: doorBorder,
                      bottom: doorBorder,
                      left: doorBorder,
                      right: doorBorder,
                    },
                    margins: { top: 80, bottom: 80, left: 80, right: 80 },
                    children: [
                      textParagraph("門口", {
                        alignment: AlignmentType.CENTER,
                        bold: true,
                        size: 20,
                      }),
                    ],
                  }),
                  new TableCell({
                    width: { size: 2050, type: WidthType.DXA },
                    borders: noBorders,
                    children: [new Paragraph("")],
                  }),
                  new TableCell({
                    width: { size: 7600, type: WidthType.DXA },
                    verticalAlign: VerticalAlign.CENTER,
                    shading: { fill: "315C47", type: ShadingType.CLEAR, color: "auto" },
                    borders: {
                      top: boardBorder,
                      bottom: boardBorder,
                      left: boardBorder,
                      right: boardBorder,
                    },
                    margins: { top: 80, bottom: 80, left: 80, right: 80 },
                    children: [textParagraph("黑板", { color: "FFFFFF", bold: true, size: 22 })],
                  }),
                  new TableCell({
                    width: { size: 2050, type: WidthType.DXA },
                    borders: noBorders,
                    children: [new Paragraph("")],
                  }),
                  new TableCell({
                    width: { size: 1500, type: WidthType.DXA },
                    borders: noBorders,
                    children: [new Paragraph("")],
                  }),
                ],
              }),
            ],
          }),
          new Paragraph({ spacing: { after: 40 } }),
          new Table({
            alignment: AlignmentType.CENTER,
            width: { size: 2500, type: WidthType.DXA },
            columnWidths: [2500],
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    shading: { fill: "E6CAA0", type: ShadingType.CLEAR, color: "auto" },
                    borders: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder },
                    children: [textParagraph("教師桌", { bold: true, size: 19 })],
                  }),
                ],
              }),
            ],
          }),
          new Paragraph({ spacing: { after: 90 } }),
          new Table({
            alignment: AlignmentType.CENTER,
            width: { size: usableWidth, type: WidthType.DXA },
            columnWidths,
            rows: seatRows,
          }),
        ],
      },
    ],
  });

  downloadBlob(await Packer.toBlob(document), `${className}-座位表.docx`);
}

export async function exportPlanPdf(element, filename) {
  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
  });
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const ratio = Math.min(
    (pageWidth - margin * 2) / canvas.width,
    (pageHeight - margin * 2) / canvas.height,
  );
  const width = canvas.width * ratio;
  const height = canvas.height * ratio;
  pdf.addImage(
    canvas.toDataURL("image/png"),
    "PNG",
    (pageWidth - width) / 2,
    (pageHeight - height) / 2,
    width,
    height,
  );
  pdf.save(filename);
}
