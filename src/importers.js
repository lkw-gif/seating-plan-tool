import mammoth from "mammoth";
import Papa from "papaparse";
import * as XLSX from "xlsx";

const fieldAliases = {
  number: [
    "學號",
    "座號",
    "班號",
    "studentno",
    "studentnumber",
    "studentid",
    "classno",
    "number",
    "no",
    "編號",
  ],
  chineseName: [
    "中文名",
    "中文姓名",
    "姓名中文",
    "學生中文姓名",
    "姓名",
    "chinesename",
    "chname",
    "namechinese",
    "namechi",
  ],
  englishName: [
    "英文名",
    "英文姓名",
    "姓名英文",
    "學生英文姓名",
    "englishname",
    "enname",
    "nameenglish",
    "nameeng",
    "english",
  ],
  gender: ["性別", "gender", "sex"],
  className: ["班別", "班級", "class", "classname"],
};

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_().／/\\-]+/g, "");
}

function findColumn(headers, aliases) {
  return headers.findIndex((header) =>
    aliases.some((alias) => header === alias || header.includes(alias)),
  );
}

function cleanGender(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (["男", "m", "male", "boy"].includes(text)) return "男";
  if (["女", "f", "female", "girl"].includes(text)) return "女";
  return text ? String(value).trim() : "";
}

function isRecognizedGender(value) {
  return ["男", "女", "m", "f", "male", "female", "boy", "girl"].includes(
    String(value ?? "").trim().toLowerCase(),
  );
}

export function rowsToStudents(rawRows) {
  const rows = rawRows
    .map((row) => (Array.isArray(row) ? row : Object.values(row)))
    .map((row) => row.map((cell) => String(cell ?? "").trim()))
    .filter((row) => row.some(Boolean));

  if (!rows.length) throw new Error("名單內沒有可讀取的學生資料。 ");

  const normalizedHeaders = rows[0].map(normalize);
  const looksLikeHeader = Object.values(fieldAliases).some((aliases) =>
    normalizedHeaders.some((header) => aliases.some((alias) => header.includes(alias))),
  );
  const firstRow = rows[0] ?? [];
  const isHeaderlessSchoolRoster =
    !looksLikeHeader &&
    firstRow.length >= 5 &&
    Boolean(firstRow[0]) &&
    /^\d+$/.test(firstRow[1]) &&
    Boolean(firstRow[2] || firstRow[3]) &&
    isRecognizedGender(firstRow[4]);
  const headers = looksLikeHeader
    ? normalizedHeaders
    : (isHeaderlessSchoolRoster
        ? ["班別", "學號", "中文名", "英文名", "性別"]
        : ["學號", "中文名", "英文名", "性別"]
      ).map(normalize);
  const dataRows = looksLikeHeader ? rows.slice(1) : rows;
  const columns = Object.fromEntries(
    Object.entries(fieldAliases).map(([field, aliases]) => [
      field,
      findColumn(headers, aliases),
    ]),
  );

  const students = dataRows
    .map((row, index) => {
      const pick = (field, fallbackIndex) => {
        const column = columns[field];
        return row[column >= 0 ? column : fallbackIndex] ?? "";
      };
      const chineseName = pick("chineseName", 1);
      const englishName = pick("englishName", 2);
      const number = pick("number", 0) || String(index + 1).padStart(2, "0");
      return {
        id: `imported-${Date.now()}-${index}`,
        number: String(number).padStart(2, "0"),
        chineseName,
        englishName,
        gender: cleanGender(pick("gender", 3)),
        tags: [],
        className: pick("className", -1),
      };
    })
    .filter((student) => student.chineseName || student.englishName);

  if (!students.length) {
    throw new Error("找不到中文名或英文名欄位，請檢查名單格式。 ");
  }

  return students;
}

export function parseRosterText(text) {
  const result = Papa.parse(String(text).trim(), {
    delimiter: "",
    skipEmptyLines: true,
  });
  return rowsToStudents(result.data);
}

function workbookToStudents(buffer) {
  const workbook = XLSX.read(buffer, { type: "array" });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
    raw: false,
  }).map((row) => row.slice(0, 5));
  return rowsToStudents(rows);
}

export async function parseRosterFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (["xlsx", "xls"].includes(extension)) {
    return workbookToStudents(await file.arrayBuffer());
  }
  if (["csv", "tsv", "txt"].includes(extension)) {
    return parseRosterText(await file.text());
  }
  if (extension === "docx") {
    const result = await mammoth.extractRawText({
      arrayBuffer: await file.arrayBuffer(),
    });
    return parseRosterText(result.value.replace(/\t+/g, ","));
  }
  if (extension === "doc") {
    throw new Error("舊式 .doc 暫未能直接讀取，請先另存為 .docx。 ");
  }

  throw new Error("請上載 Excel、CSV、文字檔或 Word .docx 名單。 ");
}

function googleExportUrl(rawUrl) {
  const url = new URL(rawUrl);
  const sheetMatch = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (sheetMatch) {
    return `https://docs.google.com/spreadsheets/d/${sheetMatch[1]}/export?format=xlsx`;
  }
  const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
  if (fileMatch) {
    return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}`;
  }
  return rawUrl;
}

export async function loadGoogleDriveRoster(rawUrl) {
  let exportUrl;
  try {
    exportUrl = googleExportUrl(rawUrl.trim());
  } catch {
    throw new Error("Google Drive 連結格式不正確。 ");
  }

  const response = await fetch(exportUrl);
  if (!response.ok) {
    throw new Error("未能讀取檔案，請確認連結已設為知道連結可檢視。 ");
  }
  const contentType = response.headers.get("content-type") ?? "";
  let students;
  if (
    contentType.includes("spreadsheet") ||
    contentType.includes("octet-stream")
  ) {
    students = workbookToStudents(await response.arrayBuffer());
  } else {
    students = parseRosterText(await response.text());
  }

  const classedStudents = students.filter((student) => student.className);
  const classes = [...new Set(
    classedStudents.map((student) => student.className),
  )].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (!classes.length) {
    throw new Error(
      "找不到班別資料。請按 A 至 E 排列：班別、學號、中文名、英文名、性別；可以有或沒有表頭。 ",
    );
  }

  return { students: classedStudents, classes };
}
