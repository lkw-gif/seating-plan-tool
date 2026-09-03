import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Cloud,
  CloudUpload,
  DoorOpen,
  Download,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  GripVertical,
  Info,
  Link2,
  Lock,
  LockOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Printer,
  Redo2,
  Search,
  Save,
  Shuffle,
  Trash2,
  Undo2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { exportPlanDocx, exportPlanPdf } from "./exporters.js";
import {
  loadGoogleDriveHomeroomTeachers,
  loadGoogleDriveRoster,
  parseRosterFile,
  parseRosterText,
} from "./importers.js";
import {
  createCloudPlan,
  deleteCloudPlan,
  getCloudPlan,
  listCloudPlans,
  updateCloudPlan,
} from "./cloudPlans.js";
import {
  autoArrangeSeats,
  clearSeatAssignments,
  createEmptySeats,
  createInitialSeats,
  getUnassignedStudents,
  resizeSeats,
} from "./seating.js";

const defaultConfig = {
  method: "rules",
};

const methodLabels = {
  rules: "隨機編排",
  "number-row-left": "依學號橫排（左至右）",
  "number-row-right": "依學號橫排（右至左）",
  "number-column-left": "依學號直排（左至右）",
  "number-column-right": "依學號直排（右至左）",
};

const DEFAULT_HOMEROOM_TEACHERS_URL =
  "https://docs.google.com/spreadsheets/d/18nw6bnE-TRKrXOlOEagTb_FQbxjsv5_q/edit?usp=sharing";

function normalizeClassCode(value) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

function formatMonitorName(student) {
  return student.chineseName;
}

function formatMonitorOption(student) {
  return [student.number, student.chineseName]
    .filter(Boolean)
    .join(" · ");
}

function formatCloudError(error) {
  if (error?.code === "sign-in-required" || error?.status === 401) {
    return "請先登入私人新版網站，才可以使用雲端方案。";
  }
  if (error?.code === "cloud-not-configured" || error?.status === 503) {
    return "目前網址未啟用雲端儲存，請使用私人新版網站。";
  }
  return error?.message || "雲端服務暫時未能使用，請稍後再試。";
}

function clampGridValue(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, Math.round(number)))
    : fallback;
}

function loadSavedPlan() {
  try {
    return JSON.parse(localStorage.getItem("seat-planner-v1")) ?? {};
  } catch {
    return {};
  }
}

function loadDriveRosterSession() {
  try {
    return JSON.parse(sessionStorage.getItem("seat-planner-drive-roster"));
  } catch {
    return null;
  }
}

function createDefaultColumnGaps(cols) {
  const defaultAisles = cols >= 7 ? new Set([1, 4]) : cols >= 5 ? new Set([1, 3]) : new Set();
  return Array.from({ length: Math.max(0, cols - 1) }, (_, index) =>
    defaultAisles.has(index),
  );
}

function normalizeColumnGaps(columnGaps, cols) {
  const defaults = createDefaultColumnGaps(cols);
  return defaults.map((defaultValue, index) =>
    typeof columnGaps?.[index] === "boolean" ? columnGaps[index] : defaultValue,
  );
}

function getAisleAfter(columnGaps) {
  return new Set(
    columnGaps
      .map((separated, index) => (separated ? index : null))
      .filter((index) => index !== null),
  );
}

function buildSeatGridTemplate(cols, columnGaps, seatTrack, aisleTrack) {
  const tracks = [];
  for (let col = 0; col < cols; col += 1) {
    tracks.push(seatTrack);
    if (columnGaps[col]) tracks.push(aisleTrack);
  }
  return tracks.join(" ");
}

function getSeatGridColumn(col, aisleAfter) {
  const aislesBefore = [...aisleAfter].filter((aisleCol) => aisleCol < col).length;
  return col + aislesBefore + 1;
}

function IconButton({ label, children, className = "", ...props }) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}

function StepRail({ activeStep, onStepChange }) {
  const steps = [
    { number: 1, label: "名單來源" },
    { number: 2, label: "編排座位" },
    { number: 3, label: "預覽與匯出" },
  ];
  return (
    <aside className="step-rail" aria-label="座位表製作步驟">
      {steps.map((step) => (
        <button
          type="button"
          key={step.number}
          className={`step-item ${activeStep === step.number ? "active" : ""} ${activeStep > step.number ? "done" : ""}`}
          onClick={() => onStepChange(step.number)}
        >
          <span className="step-number">
            {activeStep > step.number ? <Check size={16} /> : step.number}
          </span>
          <span className="step-copy">
            <strong>{step.label}</strong>
            <small>
              {activeStep === step.number
                ? "進行中"
                : activeStep > step.number
                  ? "已完成"
                  : "尚未開始"}
            </small>
          </span>
        </button>
      ))}
    </aside>
  );
}

function SeatGrid({
  cols,
  columnGaps,
  seats,
  studentMap,
  selectedSeat,
  onSelect,
  onDragStart,
  onDrop,
}) {
  const aisleAfter = getAisleAfter(columnGaps);
  return (
    <div
      className="seat-grid"
      style={{
        "--seat-template": buildSeatGridTemplate(
          cols,
          columnGaps,
          "minmax(74px, 1fr)",
          "9px",
        ),
      }}
    >
      {seats.map((seat, index) => {
        const student = studentMap.get(seat.studentId);
        const col = index % cols;
        const classes = [
          "seat-card",
          selectedSeat === index ? "selected" : "",
          seat.locked ? "locked" : "",
          seat.disabled ? "disabled" : "",
          !student && !seat.disabled ? "empty" : "",
          student?.gender === "男" ? "gender-male" : "",
          student?.gender === "女" ? "gender-female" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            type="button"
            key={index}
            className={classes}
            style={{
              gridColumn: getSeatGridColumn(col, aisleAfter),
              gridRow: Math.floor(index / cols) + 1,
            }}
            onClick={() => onSelect(index)}
            draggable={Boolean(student) && !seat.locked && !seat.disabled}
            onDragStart={() => onDragStart({ type: "seat", index })}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              onDrop(index);
            }}
            aria-label={
              seat.disabled
                ? `座位 ${index + 1} 不可用`
                : student
                  ? `${student.chineseName} ${student.englishName} 學號 ${student.number}`
                  : `座位 ${index + 1} 空位`
            }
          >
            {seat.locked && <Lock className="seat-lock" size={14} />}
            {student ? (
              <>
                <span className="seat-number">{student.number}</span>
                <strong>{student.chineseName}</strong>
                <span className="english-name">{student.englishName}</span>
              </>
            ) : seat.disabled ? (
              <>
                <Ban size={17} />
                <span>不可用</span>
              </>
            ) : (
              <span>空位</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ClassroomPlan({
  rows,
  cols,
  columnGaps,
  seats,
  studentMap,
  selectedSeat,
  onSelect,
  onDragStart,
  onDrop,
}) {
  return (
    <section className="classroom-stage" aria-label="課室座位畫布">
      <div className="classroom-front">
        <div className="door-marker">
          <DoorOpen size={18} />
          <span>門口</span>
        </div>
        <div className="blackboard">黑板</div>
      </div>
      <div className="teacher-desk">教師桌</div>
      <div className="gender-legend" aria-label="座位顏色圖例">
        <span><i className="male-swatch" />男同學</span>
        <span><i className="female-swatch" />女同學</span>
      </div>
      <div className="seat-grid-scroll">
        <SeatGrid
          rows={rows}
          cols={cols}
          columnGaps={columnGaps}
          seats={seats}
          studentMap={studentMap}
          selectedSeat={selectedSeat}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onDrop={onDrop}
        />
      </div>
      <div className="canvas-hint">
        <Info size={15} />
        先點學生卡再點座位，或直接拖放；已入座學生可先後點選兩個座位互換。
      </div>
    </section>
  );
}

function RulesPanel({
  config,
  setConfig,
  rows,
  cols,
  columnGaps,
  onRowsChange,
  onColsChange,
  onColumnGapChange,
  selectedSeat,
  selectedSeatData,
  selectedStudent,
  onToggleLock,
  onToggleDisabled,
  onClearSeat,
  onArrange,
  onClose,
}) {
  return (
    <aside className="rules-panel" aria-label="編排條件">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">設定</span>
          <h2>編排條件</h2>
        </div>
        <IconButton label="收起編排條件" onClick={onClose}>
          <PanelRightClose size={19} />
        </IconButton>
      </div>

      <label className="field-label">
        編排方式
        <select
          value={config.method}
          onChange={(event) =>
            setConfig((current) => ({ ...current, method: event.target.value }))
          }
        >
          {Object.entries(methodLabels).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <button type="button" className="primary-button rules-arrange-button" onClick={onArrange}>
        <Shuffle size={18} />
        重新編排
      </button>

      <div className="settings-group">
        <h3>課室格局</h3>
        <div className="number-fields">
          <label>
            行數
            <input
              type="number"
              min="2"
              max="10"
              value={rows}
              onChange={(event) => onRowsChange(Number(event.target.value))}
            />
          </label>
          <label>
            列數
            <input
              type="number"
              min="2"
              max="10"
              value={cols}
              onChange={(event) => onColsChange(Number(event.target.value))}
            />
          </label>
        </div>
        {columnGaps.length > 0 && (
          <div className="column-gap-settings">
            <h4>列與列之間</h4>
            {columnGaps.map((separated, index) => (
              <div className="column-gap-row" key={`${cols}-${index}`}>
                <span>第 {index + 1}、{index + 2} 列</span>
                <div className="segmented-control" aria-label={`第 ${index + 1} 與 ${index + 2} 列的間距`}>
                  <button
                    type="button"
                    className={!separated ? "active" : ""}
                    aria-pressed={!separated}
                    onClick={() => onColumnGapChange(index, false)}
                  >
                    相連
                  </button>
                  <button
                    type="button"
                    className={separated ? "active" : ""}
                    aria-pressed={separated}
                    onClick={() => onColumnGapChange(index, true)}
                  >
                    隔開
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="settings-group seat-inspector">
        <h3>已選座位</h3>
        {selectedSeat === null ? (
          <p className="muted-copy">在座位畫布點選一個位置。</p>
        ) : (
          <>
            <div className="selected-seat-summary">
              <span>座位 {selectedSeat + 1}</span>
              <strong>{selectedStudent?.chineseName ?? "空位"}</strong>
              {selectedStudent && <small>{selectedStudent.englishName}</small>}
            </div>
            <div className="seat-actions">
              <button type="button" onClick={onToggleLock}>
                {selectedSeatData.locked ? <LockOpen size={16} /> : <Lock size={16} />}
                {selectedSeatData.locked ? "解除鎖定" : "鎖定座位"}
              </button>
              <button type="button" onClick={onToggleDisabled}>
                <Ban size={16} />
                {selectedSeatData.disabled ? "恢復座位" : "設為不可用"}
              </button>
              <button type="button" onClick={onClearSeat} disabled={!selectedStudent}>
                <X size={16} />
                清空座位
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function ImportDialog({
  open,
  onClose,
  onImportFile,
  onLoadDrive,
  onSelectDriveClass,
  driveRoster,
  onImportText,
  onAddStudent,
  busy,
  error,
}) {
  const [tab, setTab] = useState("drive");
  const [driveUrl, setDriveUrl] = useState("");
  const [selectedDriveClass, setSelectedDriveClass] = useState("");
  const [text, setText] = useState(
    "學號,中文名,英文名,性別\n01,陳大文,Chan Tai Man,男",
  );
  const [manual, setManual] = useState({
    number: "",
    chineseName: "",
    englishName: "",
    gender: "",
  });

  useEffect(() => {
    if (
      driveRoster?.classes.length &&
      !driveRoster.classes.includes(selectedDriveClass)
    ) {
      setSelectedDriveClass(driveRoster.classes[0]);
    }
  }, [driveRoster, selectedDriveClass]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">學生名單</span>
            <h2 id="import-title">匯入或新增學生</h2>
          </div>
          <IconButton label="關閉" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>

        <div className="dialog-tabs" role="tablist">
          {[
            ["drive", "Google Drive", Cloud],
            ["upload", "上載檔案", Upload],
            ["paste", "貼上名單", FileText],
            ["manual", "新增一人", Plus],
          ].map(([value, label, Icon]) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? "active" : ""}
              key={value}
              onClick={() => setTab(value)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>

        <div className="dialog-body">
          {tab === "upload" && (
            <div className="upload-panel">
              <div className="format-example" aria-label="名單格式範例">
                <strong>請按以下次序排列名單欄位</strong>
                <div className="format-row format-head">
                  <span>學號</span><span>中文名</span><span>英文名</span><span>性別</span>
                </div>
                <div className="format-row">
                  <span>01</span><span>陳大文</span><span>Chan Tai Man</span><span>男</span>
                </div>
              </div>
              <label className="file-drop">
                <FileSpreadsheet size={28} />
                <strong>選擇 Excel、CSV 或 Word 名單</strong>
                <span>.xlsx、.xls、.csv、.txt、.docx</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.tsv,.txt,.docx,.doc"
                  onChange={(event) => onImportFile(event.target.files?.[0])}
                />
              </label>
            </div>
          )}

          {tab === "drive" && (
            <div className="dialog-form">
              <label>
                Google Sheets 或 Drive 共用連結
                <input
                  type="url"
                  placeholder="請貼上你的 Google Sheets 或 Drive 連結"
                  value={driveUrl}
                  onChange={(event) => setDriveUrl(event.target.value)}
                />
              </label>
              <p className="field-help">
                請輸入你有權限讀取的名單；系統會讀取 A 至 E 欄：班別、學號、中文名、英文名、性別；可以有或沒有表頭。
              </p>
              <button
                type="button"
                className="secondary-button"
                disabled={!driveUrl || busy}
                onClick={() => onLoadDrive(driveUrl)}
              >
                <Link2 size={17} />
                {busy ? "正在讀取 A 至 E 欄..." : "讀取全校名單"}
              </button>
              {!busy && driveRoster?.classes.length > 0 && (
                <div className="drive-class-picker">
                  <div className="drive-result">
                    <Check size={17} />
                    已讀取 {driveRoster.students.length} 位學生，共 {driveRoster.classes.length} 個班別
                  </div>
                  <label>
                    選擇班別
                    <select
                      value={selectedDriveClass}
                      onChange={(event) => setSelectedDriveClass(event.target.value)}
                    >
                      {driveRoster.classes.map((classCode) => (
                        <option value={classCode} key={classCode}>
                          {classCode}（{driveRoster.students.filter((student) => student.className === classCode).length} 位）
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!selectedDriveClass || busy}
                    onClick={() => onSelectDriveClass(selectedDriveClass)}
                  >
                    <Users size={17} />
                    載入 {selectedDriveClass} 名單
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === "paste" && (
            <div className="dialog-form">
              <label>
                貼上 CSV 或逐行名單
                <textarea
                  rows="9"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="primary-button"
                disabled={!text.trim() || busy}
                onClick={() => onImportText(text)}
              >
                <FileText size={17} />
                讀取貼上內容
              </button>
            </div>
          )}

          {tab === "manual" && (
            <form
              className="manual-form"
              onSubmit={(event) => {
                event.preventDefault();
                onAddStudent(manual);
                setManual({ number: "", chineseName: "", englishName: "", gender: "" });
              }}
            >
              <label>
                學號
                <input
                  required
                  value={manual.number}
                  onChange={(event) => setManual({ ...manual, number: event.target.value })}
                />
              </label>
              <label>
                中文名
                <input
                  required
                  value={manual.chineseName}
                  onChange={(event) => setManual({ ...manual, chineseName: event.target.value })}
                />
              </label>
              <label>
                英文名
                <input
                  value={manual.englishName}
                  onChange={(event) => setManual({ ...manual, englishName: event.target.value })}
                />
              </label>
              <label>
                性別
                <select
                  value={manual.gender}
                  onChange={(event) => setManual({ ...manual, gender: event.target.value })}
                >
                  <option value="">未指定</option>
                  <option value="男">男</option>
                  <option value="女">女</option>
                </select>
              </label>
              <button type="submit" className="primary-button manual-wide">
                <Plus size={17} />
                新增學生
              </button>
            </form>
          )}

          {error && (
            <div className="dialog-error" role="alert">
              <CircleAlert size={17} />
              {error}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function CloudPlanDialog({
  open,
  onClose,
  plans,
  planTitle,
  onPlanTitleChange,
  onSave,
  onLoad,
  onDelete,
  onNew,
  currentPlanId,
  loading,
  saving,
  status,
  error,
}) {
  if (!open) return null;

  const statusMessage =
    status === "sign-in-required"
      ? "請先登入平台帳戶；登入後方案會只與你的帳戶連結。"
      : "目前網址未啟用雲端儲存，請使用私人新版網站登入後使用此功能。";

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="plan-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">雲端儲存</span>
            <h2 id="plan-title">儲存及載入方案</h2>
          </div>
          <IconButton label="關閉" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>

        <div className="dialog-body">
          {status !== "ready" ? (
            <div className="cloud-unavailable" role="status">
              <Cloud size={22} />
              <div>
                <strong>雲端儲存未能使用</strong>
                <p>{loading ? "正在檢查雲端服務..." : statusMessage}</p>
              </div>
            </div>
          ) : (
            <>
              <p className="cloud-plan-note">
                方案會儲存座位、名單、班長及版面設定，並只供目前登入帳戶使用。
              </p>
              <div className="plan-save-form">
                <label>
                  方案名稱
                  <input
                    value={planTitle}
                    onChange={(event) => onPlanTitleChange(event.target.value)}
                    placeholder="例如：2B 第一課節座位表"
                    maxLength="80"
                  />
                </label>
                <div className="plan-save-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={onSave}
                    disabled={loading || saving || !planTitle.trim()}
                  >
                    <Save size={17} />
                    {saving ? "正在儲存..." : currentPlanId ? "更新方案" : "儲存方案"}
                  </button>
                  {currentPlanId && (
                    <button type="button" className="secondary-button" onClick={onNew} disabled={saving}>
                      <Plus size={17} />
                      另存新方案
                    </button>
                  )}
                </div>
              </div>

              <div className="plan-list">
                <div className="plan-list-heading">
                  <h3>我的方案</h3>
                  <button type="button" className="icon-button" onClick={onNew} title="建立新方案" aria-label="建立新方案">
                    <Plus size={17} />
                  </button>
                </div>
                {loading ? (
                  <p className="muted-copy">正在讀取已儲存方案...</p>
                ) : plans.length ? (
                  plans.map((plan) => (
                    <div className={`plan-row ${currentPlanId === plan.id ? "active" : ""}`} key={plan.id}>
                      <div>
                        <strong>{plan.title}</strong>
                        <small>最後更新：{new Date(plan.updatedAt).toLocaleString("zh-HK")}</small>
                      </div>
                      <div className="plan-row-actions">
                        <button type="button" className="secondary-button" onClick={() => onLoad(plan.id)} disabled={saving}>
                          <FolderOpen size={15} />
                          載入
                        </button>
                        <IconButton label={`刪除 ${plan.title}`} onClick={() => onDelete(plan)} disabled={saving}>
                          <Trash2 size={16} />
                        </IconButton>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted-copy">尚未儲存方案。輸入名稱後按「儲存方案」。</p>
                )}
              </div>
            </>
          )}

          {error && (
            <div className="dialog-error" role="alert">
              <CircleAlert size={17} />
              {error}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function RosterStep({
  students,
  search,
  setSearch,
  sourceLabel,
  onOpenImport,
  onClearRoster,
  onDeleteStudent,
  onContinue,
}) {
  const filtered = students.filter((student) =>
    `${student.number} ${student.chineseName} ${student.englishName}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className="roster-step">
      <div className="page-heading">
        <div>
          <span className="eyebrow">第 1 步</span>
          <h1>學生名單</h1>
          <p>選擇全校名單來源，再確認今次要編排的班別。</p>
        </div>
        <div className="roster-heading-actions">
          <button
            type="button"
            className="secondary-button clear-roster-button"
            onClick={onClearRoster}
            disabled={!students.length}
          >
            <Trash2 size={18} />
            清空所有名單
          </button>
          <button type="button" className="primary-button" onClick={onOpenImport}>
            <Plus size={18} />
            匯入或新增學生
          </button>
        </div>
      </div>

      <div className="source-band">
        <div>
          <Cloud size={22} />
          <span>
            <small>目前來源</small>
            <strong>{sourceLabel}</strong>
          </span>
        </div>
        <p className="source-guidance">
          <Info size={16} />
          請按「匯入或新增學生」，在 Google Drive 讀取全校名單
        </p>
      </div>

      <div className="roster-toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜尋姓名或學號"
          />
        </label>
        <span>{students.length} 位學生</span>
      </div>

      <div className="roster-table-wrap">
        <table className="roster-table">
          <thead>
            <tr>
              <th>學號</th>
              <th>中文名</th>
              <th>英文名</th>
              <th>性別</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {filtered.length ? (
              filtered.map((student) => (
                <tr key={student.id}>
                  <td>{student.number}</td>
                  <td><strong>{student.chineseName}</strong></td>
                  <td>{student.englishName}</td>
                  <td>{student.gender || "—"}</td>
                  <td>
                    <IconButton label={`刪除 ${student.chineseName}`} onClick={() => onDeleteStudent(student.id)}>
                      <Trash2 size={16} />
                    </IconButton>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="roster-empty-state" colSpan="5">
                  {students.length ? "找不到符合條件的學生" : "名單已清空"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="step-footer">
        <span />
        <button type="button" className="primary-button" onClick={onContinue}>
          開始編排
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}

function PrintPlan({
  className,
  teachers,
  maleMonitor,
  femaleMonitor,
  rows,
  cols,
  columnGaps,
  seats,
  studentMap,
  innerRef,
}) {
  const aisleAfter = getAisleAfter(columnGaps);
  return (
    <div className="print-sheet" ref={innerRef}>
      <header className="print-header">
        <strong>班別：{className}</strong>
        <h2>課室座位表&nbsp; Seating Plan</h2>
        <span className="print-staff">
          <span>班主任：{teachers}</span>
          <span>男班長：{maleMonitor}</span>
          <span>女班長：{femaleMonitor}</span>
        </span>
      </header>
      <div className="print-front">
        <div className="print-door">門口</div>
        <div className="print-board">黑板</div>
      </div>
      <div className="print-teacher-desk">教師桌</div>
      <div className="print-gender-legend">
        <span><i className="male-swatch" />男同學</span>
        <span><i className="female-swatch" />女同學</span>
      </div>
      <div
        className="print-seat-grid"
        style={{
          "--seat-template": buildSeatGridTemplate(
            cols,
            columnGaps,
            "minmax(70px, 1fr)",
            "16px",
          ),
        }}
      >
        {seats.map((seat, index) => {
          const student = studentMap.get(seat.studentId);
          const col = index % cols;
          return (
            <div
              className={`print-seat ${seat.disabled ? "disabled" : ""} ${student?.gender === "男" ? "gender-male" : ""} ${student?.gender === "女" ? "gender-female" : ""} ${aisleAfter.has(col) || col === cols - 1 ? "row-end" : ""}`}
              key={index}
              style={{
                gridColumn: getSeatGridColumn(col, aisleAfter),
                gridRow: Math.floor(index / cols) + 1,
              }}
            >
              {seat.disabled ? (
                <span>不可用</span>
              ) : student ? (
                <>
                  <strong>{student.chineseName}</strong>
                  <span>{student.englishName}</span>
                  <small>{student.number}</small>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function App() {
  const saved = useMemo(loadSavedPlan, []);
  const savedDemoRoster = saved.sourceLabel === "示範名單";
  const savedStudents =
    savedDemoRoster
      ? []
      : Array.isArray(saved.students)
        ? saved.students
        : [];
  const initialSourceLabel =
    savedDemoRoster || !savedStudents.length
      ? "尚未載入名單"
      : saved.sourceLabel ?? "尚未載入名單";
  const [activeStep, setActiveStep] = useState(savedStudents.length ? 2 : 1);
  const [students, setStudents] = useState(savedStudents);
  const [rows, setRows] = useState(saved.rows ?? 5);
  const [cols, setCols] = useState(saved.cols ?? 7);
  const [columnGaps, setColumnGaps] = useState(() =>
    normalizeColumnGaps(saved.columnGaps, saved.cols ?? 7),
  );
  const [seats, setSeats] = useState(
    savedDemoRoster
      ? createInitialSeats(savedStudents, saved.rows ?? 5, saved.cols ?? 7)
      : saved.seats ?? createInitialSeats(savedStudents, saved.rows ?? 5, saved.cols ?? 7),
  );
  const [config, setConfig] = useState({
    ...defaultConfig,
    method: saved.config?.method ?? defaultConfig.method,
  });
  const [className, setClassName] = useState(saved.className ?? "2D");
  const [teachers, setTeachers] = useState(saved.teachers ?? "張老師、朱老師");
  const [maleMonitor, setMaleMonitor] = useState(
    saved.maleMonitor ?? saved.monitor ?? "",
  );
  const [maleMonitor2, setMaleMonitor2] = useState(saved.maleMonitor2 ?? "");
  const [femaleMonitor, setFemaleMonitor] = useState(saved.femaleMonitor ?? "");
  const [femaleMonitor2, setFemaleMonitor2] = useState(
    saved.femaleMonitor2 ?? "",
  );
  const [sourceLabel, setSourceLabel] = useState(initialSourceLabel);
  const [currentPlanId, setCurrentPlanId] = useState(saved.currentPlanId ?? "");
  const [planTitle, setPlanTitle] = useState(
    saved.planTitle ?? (saved.className ? `${saved.className} 座位表` : ""),
  );
  const [driveRoster, setDriveRoster] = useState(loadDriveRosterSession);
  const [homeroomTeachers, setHomeroomTeachers] = useState({});
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [rulesOpen, setRulesOpen] = useState(true);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [toast, setToast] = useState("");
  const [unassignedOpen, setUnassignedOpen] = useState(true);
  const [selectedUnassignedStudentId, setSelectedUnassignedStudentId] =
    useState(null);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [cloudPlans, setCloudPlans] = useState([]);
  const [cloudStatus, setCloudStatus] = useState("unknown");
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudSaving, setCloudSaving] = useState(false);
  const [cloudError, setCloudError] = useState("");
  const dragPayload = useRef(null);
  const toastTimer = useRef(null);
  const printRef = useRef(null);

  const studentMap = useMemo(
    () => new Map(students.map((student) => [student.id, student])),
    [students],
  );
  const unassigned = useMemo(
    () => getUnassignedStudents(students, seats),
    [students, seats],
  );
  const classStatistics = useMemo(() => {
    const total = students.length;
    const male = students.filter((student) => student.gender === "男").length;
    const female = students.filter((student) => student.gender === "女").length;
    const percentage = (count) => (total ? Math.round((count / total) * 100) : 0);
    return {
      total,
      male,
      female,
      malePercentage: percentage(male),
      femalePercentage: percentage(female),
    };
  }, [students]);
  const maleMonitorOptions = useMemo(
    () => students.filter(
      (student) => student.gender === "男" && student.chineseName,
    ),
    [students],
  );
  const femaleMonitorOptions = useMemo(
    () => students.filter(
      (student) => student.gender === "女" && student.chineseName,
    ),
    [students],
  );
  const maleMonitorNames = [maleMonitor, maleMonitor2].filter(Boolean).join("、");
  const femaleMonitorNames = [femaleMonitor, femaleMonitor2]
    .filter(Boolean)
    .join("、");
  const selectedSeatData = selectedSeat === null ? null : seats[selectedSeat];
  const selectedStudent = selectedSeatData
    ? studentMap.get(selectedSeatData.studentId)
    : null;
  const selectedUnassignedStudent = selectedUnassignedStudentId
    ? studentMap.get(selectedUnassignedStudentId)
    : null;

  useEffect(() => {
    localStorage.setItem(
      "seat-planner-v1",
      JSON.stringify({
        students,
        rows,
        cols,
        columnGaps,
        seats,
        config,
        className,
        teachers,
        maleMonitor,
        maleMonitor2,
        femaleMonitor,
        femaleMonitor2,
        sourceLabel,
        currentPlanId,
        planTitle,
      }),
    );
  }, [
    students,
    rows,
    cols,
    columnGaps,
    seats,
    config,
    className,
    teachers,
    maleMonitor,
    maleMonitor2,
    femaleMonitor,
    femaleMonitor2,
    sourceLabel,
    currentPlanId,
    planTitle,
  ]);

  useEffect(() => {
    if (driveRoster) {
      sessionStorage.setItem(
        "seat-planner-drive-roster",
        JSON.stringify(driveRoster),
      );
    }
  }, [driveRoster]);

  useEffect(() => {
    let cancelled = false;
    loadGoogleDriveHomeroomTeachers(DEFAULT_HOMEROOM_TEACHERS_URL)
      .then((result) => {
        if (!cancelled) setHomeroomTeachers(result);
      })
      .catch(() => {
        // Keep the saved/manual value when the shared file is temporarily unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const defaultTeachers = homeroomTeachers[normalizeClassCode(className)];
    if (defaultTeachers) setTeachers(defaultTeachers);
  }, [className, homeroomTeachers]);

  useEffect(() => {
    const maleNames = new Set(maleMonitorOptions.map(formatMonitorName));
    const femaleNames = new Set(femaleMonitorOptions.map(formatMonitorName));
    setMaleMonitor((current) =>
      current && !maleNames.has(current) ? "" : current,
    );
    setMaleMonitor2((current) =>
      current && !maleNames.has(current) ? "" : current,
    );
    setFemaleMonitor((current) =>
      current && !femaleNames.has(current) ? "" : current,
    );
    setFemaleMonitor2((current) =>
      current && !femaleNames.has(current) ? "" : current,
    );
  }, [maleMonitorOptions, femaleMonitorOptions]);

  const showToast = (message) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(""), 3000);
  };

  const commitSeats = (next) => {
    setPast((history) => [...history.slice(-29), seats]);
    setFuture([]);
    setSeats(next);
  };

  const undo = () => {
    if (!past.length) return;
    const previous = past[past.length - 1];
    setPast((history) => history.slice(0, -1));
    setFuture((history) => [seats, ...history]);
    setSeats(previous);
  };

  const redo = () => {
    if (!future.length) return;
    const next = future[0];
    setFuture((history) => history.slice(1));
    setPast((history) => [...history, seats]);
    setSeats(next);
  };

  const arrange = () => {
    commitSeats(autoArrangeSeats({ seats, students, rows, cols, config }));
    setSelectedSeat(null);
    setSelectedUnassignedStudentId(null);
    showToast("座位已按目前條件重新編排");
  };

  const clearAllSeats = () => {
    const assignedCount = students.length - unassigned.length;
    if (!assignedCount) return;
    commitSeats(clearSeatAssignments(seats));
    setSelectedSeat(null);
    setSelectedUnassignedStudentId(null);
    setUnassignedOpen(true);
    showToast(`已清空 ${assignedCount} 個座位，學生已返回待編排名單`);
  };

  const changeRows = (value) => {
    const nextRows = Math.min(10, Math.max(2, value || 2));
    commitSeats(resizeSeats(seats, rows, cols, nextRows, cols));
    setRows(nextRows);
    setSelectedSeat(null);
  };

  const changeCols = (value) => {
    const nextCols = Math.min(10, Math.max(2, value || 2));
    commitSeats(resizeSeats(seats, rows, cols, rows, nextCols));
    setCols(nextCols);
    setColumnGaps((current) => normalizeColumnGaps(current, nextCols));
    setSelectedSeat(null);
  };

  const changeColumnGap = (index, separated) => {
    setColumnGaps((current) =>
      current.map((value, gapIndex) =>
        gapIndex === index ? separated : value,
      ),
    );
  };

  const onDrop = (targetIndex) => {
    const payload = dragPayload.current;
    dragPayload.current = null;
    if (!payload || seats[targetIndex].locked || seats[targetIndex].disabled) return;
    const next = seats.map((seat) => ({ ...seat }));
    if (payload.type === "seat") {
      const sourceIndex = payload.index;
      if (sourceIndex === targetIndex || seats[sourceIndex].locked) return;
      [next[sourceIndex].studentId, next[targetIndex].studentId] = [
        next[targetIndex].studentId,
        next[sourceIndex].studentId,
      ];
    } else {
      next[targetIndex].studentId = payload.studentId;
    }
    commitSeats(next);
    setSelectedSeat(targetIndex);
    setSelectedUnassignedStudentId(null);
  };

  const handleSeatSelect = (targetIndex) => {
    if (selectedUnassignedStudentId && selectedUnassignedStudent) {
      const target = seats[targetIndex];
      if (target.locked || target.disabled) {
        showToast(target.disabled ? "這個座位不可用" : "請先解除座位鎖定");
        return;
      }
      const displacedStudent = studentMap.get(target.studentId);
      commitSeats(
        seats.map((seat, index) =>
          index === targetIndex
            ? { ...seat, studentId: selectedUnassignedStudentId }
            : { ...seat },
        ),
      );
      setSelectedSeat(targetIndex);
      setSelectedUnassignedStudentId(null);
      showToast(
        displacedStudent
          ? `${selectedUnassignedStudent.chineseName} 已入座，${displacedStudent.chineseName} 返回待編排名單`
          : `${selectedUnassignedStudent.chineseName} 已入座`,
      );
      return;
    }

    if (selectedSeat === null || selectedSeat === targetIndex) {
      setSelectedSeat(selectedSeat === targetIndex ? null : targetIndex);
      return;
    }

    const source = seats[selectedSeat];
    const target = seats[targetIndex];
    if (source.locked || source.disabled || target.locked || target.disabled) {
      setSelectedSeat(targetIndex);
      return;
    }

    const next = seats.map((seat) => ({ ...seat }));
    [next[selectedSeat].studentId, next[targetIndex].studentId] = [
      next[targetIndex].studentId,
      next[selectedSeat].studentId,
    ];
    commitSeats(next);
    setSelectedSeat(targetIndex);
    showToast("座位已互換");
  };

  const handleUnassignedStudentSelect = (studentId) => {
    setSelectedSeat(null);
    setSelectedUnassignedStudentId((current) =>
      current === studentId ? null : studentId,
    );
  };

  const handleDragStart = (payload) => {
    dragPayload.current = payload;
    setSelectedUnassignedStudentId(
      payload.type === "student" ? payload.studentId : null,
    );
  };

  const updateSelectedSeat = (changes) => {
    if (selectedSeat === null) return;
    commitSeats(
      seats.map((seat, index) =>
        index === selectedSeat ? { ...seat, ...changes } : { ...seat },
      ),
    );
  };

  const applyRoster = (nextStudents, label) => {
    const rosterClass = nextStudents.find((student) => student.className)?.className;
    setStudents(nextStudents);
    if (rosterClass) setClassName(rosterClass);
    const blankSeats = createEmptySeats(rows, cols);
    setSeats(
      autoArrangeSeats({
        seats: blankSeats,
        students: nextStudents,
        rows,
        cols,
        config,
      }),
    );
    setPast([]);
    setFuture([]);
    setSourceLabel(label);
    setSelectedUnassignedStudentId(null);
    setImportOpen(false);
    setImportError("");
    setActiveStep(2);
    showToast(`已載入 ${nextStudents.length} 位學生`);
  };

  const importFile = async (file) => {
    if (!file) return;
    setImportBusy(true);
    setImportError("");
    try {
      applyRoster(await parseRosterFile(file), file.name);
    } catch (error) {
      setImportError(error.message);
    } finally {
      setImportBusy(false);
    }
  };

  const loadDrive = async (url) => {
    setImportBusy(true);
    setImportError("");
    setDriveRoster(null);
    sessionStorage.removeItem("seat-planner-drive-roster");
    try {
      const result = await loadGoogleDriveRoster(url);
      setDriveRoster(result);
      showToast(`已讀取 ${result.classes.length} 個班別`);
      return result;
    } catch (error) {
      setImportError(
        error instanceof TypeError
          ? "瀏覽器未能連接該 Drive 檔案，請檢查分享權限或下載後上載。 "
          : error.message,
      );
      return null;
    } finally {
      setImportBusy(false);
    }
  };

  const selectDriveClass = (classCode) => {
    const classStudents = driveRoster?.students.filter(
      (student) => student.className === classCode,
    ) ?? [];
    if (!classStudents.length) {
      setImportError(`找不到 ${classCode} 的學生資料。`);
      return;
    }
    applyRoster(classStudents, `Google Drive · ${classCode}`);
  };

  const importText = (text) => {
    setImportBusy(true);
    setImportError("");
    try {
      applyRoster(parseRosterText(text), "貼上名單");
    } catch (error) {
      setImportError(error.message);
    } finally {
      setImportBusy(false);
    }
  };

  const addStudent = (student) => {
    setStudents((current) => [
      ...current,
      {
        id: `manual-${Date.now()}`,
        number: String(student.number).padStart(2, "0"),
        chineseName: student.chineseName.trim(),
        englishName: student.englishName.trim(),
        gender: student.gender,
        tags: [],
        className,
      },
    ]);
    setImportOpen(false);
    showToast("學生已加入未編排名單");
  };

  const deleteStudent = (studentId) => {
    setStudents((current) => current.filter((student) => student.id !== studentId));
    commitSeats(
      seats.map((seat) =>
        seat.studentId === studentId ? { ...seat, studentId: null } : { ...seat },
      ),
    );
    showToast("學生已從名單移除");
  };

  const clearRoster = () => {
    if (!window.confirm("確定要清空所有學生名單？此操作不能復原。")) return;
    setStudents([]);
    setSeats(createEmptySeats(rows, cols));
    setDriveRoster(null);
    sessionStorage.removeItem("seat-planner-drive-roster");
    setMaleMonitor("");
    setMaleMonitor2("");
    setFemaleMonitor("");
    setFemaleMonitor2("");
    setSourceLabel("尚未載入名單");
    setSelectedSeat(null);
    setSelectedUnassignedStudentId(null);
    setPast([]);
    setFuture([]);
    showToast("已清空所有學生名單");
  };

  const createPlanSnapshot = () => ({
    version: 1,
    students,
    rows,
    cols,
    columnGaps,
    seats,
    config,
    className,
    teachers,
    maleMonitor,
    maleMonitor2,
    femaleMonitor,
    femaleMonitor2,
    sourceLabel,
  });

  const restorePlanSnapshot = (data) => {
    const nextRows = clampGridValue(data?.rows, 2, 10, 5);
    const nextCols = clampGridValue(data?.cols, 2, 10, 7);
    const nextStudents = Array.isArray(data?.students) ? data.students : [];
    const nextSeats =
      Array.isArray(data?.seats) && data.seats.length === nextRows * nextCols
        ? data.seats.map((seat) => ({
            studentId: seat.studentId ?? null,
            locked: Boolean(seat.locked),
            disabled: Boolean(seat.disabled),
          }))
        : createEmptySeats(nextRows, nextCols);
    const nextMethod = Object.hasOwn(methodLabels, data?.config?.method)
      ? data.config.method
      : defaultConfig.method;

    setStudents(nextStudents);
    setRows(nextRows);
    setCols(nextCols);
    setColumnGaps(normalizeColumnGaps(data?.columnGaps, nextCols));
    setSeats(nextSeats);
    setConfig({ ...defaultConfig, method: nextMethod });
    setClassName(typeof data?.className === "string" && data.className ? data.className : "2D");
    setTeachers(typeof data?.teachers === "string" ? data.teachers : "");
    setMaleMonitor(typeof data?.maleMonitor === "string" ? data.maleMonitor : "");
    setMaleMonitor2(typeof data?.maleMonitor2 === "string" ? data.maleMonitor2 : "");
    setFemaleMonitor(typeof data?.femaleMonitor === "string" ? data.femaleMonitor : "");
    setFemaleMonitor2(typeof data?.femaleMonitor2 === "string" ? data.femaleMonitor2 : "");
    setSourceLabel(
      typeof data?.sourceLabel === "string" && data.sourceLabel
        ? data.sourceLabel
        : "尚未載入名單",
    );
    setDriveRoster(null);
    sessionStorage.removeItem("seat-planner-drive-roster");
    setSelectedSeat(null);
    setSelectedUnassignedStudentId(null);
    setPast([]);
    setFuture([]);
    setSearch("");
    setUnassignedOpen(true);
    setActiveStep(nextStudents.length ? 2 : 1);
  };

  const refreshCloudPlans = async () => {
    setCloudLoading(true);
    setCloudError("");
    try {
      const result = await listCloudPlans();
      setCloudPlans(result?.plans ?? []);
      setCloudStatus("ready");
    } catch (error) {
      setCloudStatus(error?.code === "sign-in-required" ? "sign-in-required" : "unavailable");
      setCloudError(formatCloudError(error));
    } finally {
      setCloudLoading(false);
    }
  };

  const openPlanDialog = () => {
    setPlanDialogOpen(true);
    refreshCloudPlans();
  };

  const saveCloudPlan = async () => {
    const nextTitle = planTitle.trim();
    if (!nextTitle) return;
    setCloudSaving(true);
    setCloudError("");
    try {
      const result = currentPlanId
        ? await updateCloudPlan(currentPlanId, nextTitle, createPlanSnapshot())
        : await createCloudPlan(nextTitle, createPlanSnapshot());
      const savedPlan = result.plan;
      setCurrentPlanId(savedPlan.id);
      setPlanTitle(savedPlan.title);
      setCloudStatus("ready");
      await refreshCloudPlans();
      showToast(`已儲存「${savedPlan.title}」`);
    } catch (error) {
      setCloudError(formatCloudError(error));
    } finally {
      setCloudSaving(false);
    }
  };

  const loadSavedCloudPlan = async (planId) => {
    setCloudLoading(true);
    setCloudError("");
    try {
      const result = await getCloudPlan(planId);
      const savedPlan = result.plan;
      restorePlanSnapshot(savedPlan.data);
      setCurrentPlanId(savedPlan.id);
      setPlanTitle(savedPlan.title);
      setPlanDialogOpen(false);
      showToast(`已載入「${savedPlan.title}」`);
    } catch (error) {
      setCloudError(formatCloudError(error));
    } finally {
      setCloudLoading(false);
    }
  };

  const deleteSavedCloudPlan = async (plan) => {
    if (!window.confirm(`確定要刪除「${plan.title}」？此操作不能復原。`)) return;
    setCloudSaving(true);
    setCloudError("");
    try {
      await deleteCloudPlan(plan.id);
      setCloudPlans((current) => current.filter((item) => item.id !== plan.id));
      if (currentPlanId === plan.id) {
        setCurrentPlanId("");
        setPlanTitle(`${className} 座位表`);
      }
      showToast(`已刪除「${plan.title}」`);
    } catch (error) {
      setCloudError(formatCloudError(error));
    } finally {
      setCloudSaving(false);
    }
  };

  const startNewCloudPlan = () => {
    setCurrentPlanId("");
    setPlanTitle(`${className} 座位表`);
    setCloudError("");
  };

  const handleDocxExport = async () => {
    try {
      await exportPlanDocx({
        className,
        teachers,
        maleMonitor: maleMonitorNames,
        femaleMonitor: femaleMonitorNames,
        rows,
        cols,
        columnGaps,
        seats,
        students,
      });
      showToast("DOCX 座位表已匯出");
    } catch {
      showToast("未能匯出 DOCX，請再試一次");
    }
  };

  const handlePdfExport = async () => {
    if (!printRef.current) return;
    try {
      await exportPlanPdf(printRef.current, `${className}-座位表.pdf`);
      showToast("PDF 座位表已匯出");
    } catch {
      showToast("未能匯出 PDF，請再試一次");
    }
  };

  const arrangeToolbar = activeStep === 2 && (
    <div className="header-actions">
      <span className="save-status"><Check size={15} /> 已儲存</span>
      <IconButton label="復原" onClick={undo} disabled={!past.length}>
        <Undo2 size={19} />
      </IconButton>
      <IconButton label="重做" onClick={redo} disabled={!future.length}>
        <Redo2 size={19} />
      </IconButton>
    </div>
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-mark"><Users size={21} /></div>
          <strong>同學各位找個位</strong>
        </div>
        <label className="class-switcher">
          <span>班別</span>
          <select
            aria-label="選擇班別"
            value={
              driveRoster?.classes.includes(className)
                ? className
                : (driveRoster?.classes[0] ?? className)
            }
            onChange={(event) => {
              const nextClass = event.target.value;
              if (driveRoster?.classes.includes(nextClass)) {
                selectDriveClass(nextClass);
              } else {
                setClassName(nextClass);
              }
            }}
          >
            {(driveRoster?.classes.length ? driveRoster.classes : [className]).map((classCode) => (
              <option value={classCode} key={classCode}>{classCode}</option>
            ))}
          </select>
        </label>
        <div className="cloud-toolbar">
          <button
            type="button"
            className="secondary-button"
            aria-label="儲存及載入雲端方案"
            title="儲存及載入雲端方案"
            onClick={openPlanDialog}
          >
            <CloudUpload size={17} />
            <span>儲存方案</span>
          </button>
        </div>
        <div className="source-chip"><Cloud size={16} /> {sourceLabel}</div>
        {arrangeToolbar}
      </header>

      <div className="app-shell">
        <StepRail activeStep={activeStep} onStepChange={setActiveStep} />
        <main className="main-content">
          {activeStep === 1 && (
            <RosterStep
              students={students}
              search={search}
              setSearch={setSearch}
              sourceLabel={sourceLabel}
              onOpenImport={() => setImportOpen(true)}
              onClearRoster={clearRoster}
              onDeleteStudent={deleteStudent}
              onContinue={() => setActiveStep(2)}
            />
          )}

          {activeStep === 2 && (
            <div className={`arrange-step ${rulesOpen ? "with-rules" : ""}`}>
              <div className="arrange-main">
                <div className="workspace-meta">
                  <div>
                    <span>{rows} 行 × {cols} 列</span>
                    <span>{methodLabels[config.method]}</span>
                  </div>
                  <div className="workspace-actions">
                    <button
                      type="button"
                      className="secondary-button clear-seats-button"
                      onClick={clearAllSeats}
                      disabled={!students.length || unassigned.length === students.length}
                    >
                      <Trash2 size={17} />
                      清空全部座位
                    </button>
                    {!rulesOpen && (
                      <button type="button" className="secondary-button" onClick={() => setRulesOpen(true)}>
                        <PanelRightOpen size={17} />
                        顯示條件
                      </button>
                    )}
                  </div>
                </div>

                <div className="class-statistics" aria-label="班別人數統計">
                  <span><Users size={16} /> 全班人數：<strong>{classStatistics.total}</strong> 人</span>
                  <span>男：<strong>{classStatistics.male}</strong> 人（{classStatistics.malePercentage}%）</span>
                  <span>女：<strong>{classStatistics.female}</strong> 人（{classStatistics.femalePercentage}%）</span>
                </div>

                <div className={`unassigned-tray ${unassignedOpen ? "open" : ""}`}>
                  <button type="button" className="tray-heading" onClick={() => setUnassignedOpen((open) => !open)}>
                    <span>待編排學生（按學號） <strong>{unassigned.length}</strong></span>
                    {unassignedOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                  </button>
                  {unassignedOpen && (
                    <>
                      <p className="tray-help">
                        {selectedUnassignedStudent
                          ? `已選 ${selectedUnassignedStudent.number} ${selectedUnassignedStudent.chineseName}，請點選或拖到座位。`
                          : "點選學生後再點座位，或直接把學生卡拖到適當位置。"}
                      </p>
                      <div className="student-chip-row" aria-live="polite">
                        {unassigned.length ? unassigned.map((student) => (
                          <button
                            type="button"
                            draggable
                            aria-pressed={selectedUnassignedStudentId === student.id}
                            className={`student-chip ${selectedUnassignedStudentId === student.id ? "selected" : ""}`}
                            key={student.id}
                            onClick={() => handleUnassignedStudentSelect(student.id)}
                            onDragStart={() => handleDragStart({ type: "student", studentId: student.id })}
                          >
                            <GripVertical size={15} />
                            <span className="student-chip-number">{student.number}</span>
                            <span className="student-chip-names">
                              <strong>{student.chineseName}</strong>
                              <small>{student.englishName}</small>
                            </span>
                          </button>
                        )) : <span className="all-assigned"><Check size={15} /> 所有學生已編排</span>}
                      </div>
                    </>
                  )}
                </div>

                <ClassroomPlan
                  rows={rows}
                  cols={cols}
                  columnGaps={columnGaps}
                  seats={seats}
                  studentMap={studentMap}
                  selectedSeat={selectedSeat}
                  onSelect={handleSeatSelect}
                  onDragStart={handleDragStart}
                  onDrop={onDrop}
                />

                <div className="step-footer arrange-footer">
                  <button type="button" className="secondary-button" onClick={() => setActiveStep(1)}>
                    <ArrowLeft size={18} />
                    返回名單
                  </button>
                  <button type="button" className="primary-button" onClick={() => setActiveStep(3)}>
                    預覽及匯出
                    <ArrowRight size={18} />
                  </button>
                </div>
              </div>

              {rulesOpen && (
                <RulesPanel
                  config={config}
                  setConfig={setConfig}
                  rows={rows}
                  cols={cols}
                  columnGaps={columnGaps}
                  onRowsChange={changeRows}
                  onColsChange={changeCols}
                  onColumnGapChange={changeColumnGap}
                  selectedSeat={selectedSeat}
                  selectedSeatData={selectedSeatData}
                  selectedStudent={selectedStudent}
                  onToggleLock={() => updateSelectedSeat({ locked: !selectedSeatData.locked })}
                  onToggleDisabled={() =>
                    updateSelectedSeat({
                      disabled: !selectedSeatData.disabled,
                      locked: false,
                      studentId: selectedSeatData.disabled ? selectedSeatData.studentId : null,
                    })
                  }
                  onClearSeat={() => updateSelectedSeat({ studentId: null })}
                  onArrange={arrange}
                  onClose={() => setRulesOpen(false)}
                />
              )}
            </div>
          )}

          {activeStep === 3 && (
            <div className="preview-step">
              <div className="page-heading preview-heading">
                <div>
                  <span className="eyebrow">第 3 步</span>
                  <h1>預覽與匯出</h1>
                  <p>輸出會保留黑板、教師桌、門口及學生中英文姓名與學號。</p>
                </div>
                <div className="export-actions">
                  <button type="button" className="secondary-button" onClick={() => window.print()}>
                    <Printer size={17} />
                    列印
                  </button>
                  <button type="button" className="secondary-button" onClick={handleDocxExport}>
                    <FileText size={17} />
                    匯出 DOCX
                  </button>
                  <button type="button" className="primary-button" onClick={handlePdfExport}>
                    <Download size={17} />
                    匯出 PDF
                  </button>
                </div>
              </div>

              <div className="preview-canvas">
                <PrintPlan
                  className={className}
                  teachers={teachers}
                  maleMonitor={maleMonitorNames}
                  femaleMonitor={femaleMonitorNames}
                  rows={rows}
                  cols={cols}
                  columnGaps={columnGaps}
                  seats={seats}
                  studentMap={studentMap}
                  innerRef={printRef}
                />
              </div>

              <div className="preview-meta">
                <label>
                  班別
                  <input value={className} onChange={(event) => setClassName(event.target.value)} />
                </label>
                <label>
                  班主任
                  <input value={teachers} onChange={(event) => setTeachers(event.target.value)} />
                </label>
                <label>
                  男班長（一）
                  <select
                    value={maleMonitor}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setMaleMonitor(nextValue);
                      if (nextValue === maleMonitor2) setMaleMonitor2("");
                    }}
                  >
                    <option value="">未選擇</option>
                    {maleMonitorOptions.map((student) => (
                      <option value={formatMonitorName(student)} key={student.id}>
                        {formatMonitorOption(student)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  男班長（二）
                  <select
                    value={maleMonitor2}
                    onChange={(event) => setMaleMonitor2(event.target.value)}
                  >
                    <option value="">未選擇</option>
                    {maleMonitorOptions
                      .filter((student) => formatMonitorName(student) !== maleMonitor)
                      .map((student) => (
                        <option value={formatMonitorName(student)} key={student.id}>
                          {formatMonitorOption(student)}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  女班長（一）
                  <select
                    value={femaleMonitor}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setFemaleMonitor(nextValue);
                      if (nextValue === femaleMonitor2) setFemaleMonitor2("");
                    }}
                  >
                    <option value="">未選擇</option>
                    {femaleMonitorOptions.map((student) => (
                      <option value={formatMonitorName(student)} key={student.id}>
                        {formatMonitorOption(student)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  女班長（二）
                  <select
                    value={femaleMonitor2}
                    onChange={(event) => setFemaleMonitor2(event.target.value)}
                  >
                    <option value="">未選擇</option>
                    {femaleMonitorOptions
                      .filter((student) => formatMonitorName(student) !== femaleMonitor)
                      .map((student) => (
                        <option value={formatMonitorName(student)} key={student.id}>
                          {formatMonitorOption(student)}
                        </option>
                      ))}
                  </select>
                </label>
              </div>

              <div className="step-footer">
                <button type="button" className="secondary-button" onClick={() => setActiveStep(2)}>
                  <ArrowLeft size={18} />
                  返回編排
                </button>
                <span className="export-note"><Check size={15} /> 檔案會下載到瀏覽器預設資料夾</span>
              </div>
            </div>
          )}
        </main>
      </div>

      <ImportDialog
        open={importOpen}
        onClose={() => { setImportOpen(false); setImportError(""); }}
        onImportFile={importFile}
        onLoadDrive={loadDrive}
        onSelectDriveClass={selectDriveClass}
        driveRoster={driveRoster}
        onImportText={importText}
        onAddStudent={addStudent}
        busy={importBusy}
        error={importError}
      />

      <CloudPlanDialog
        open={planDialogOpen}
        onClose={() => {
          setPlanDialogOpen(false);
          setCloudError("");
        }}
        plans={cloudPlans}
        planTitle={planTitle}
        onPlanTitleChange={setPlanTitle}
        onSave={saveCloudPlan}
        onLoad={loadSavedCloudPlan}
        onDelete={deleteSavedCloudPlan}
        onNew={startNewCloudPlan}
        currentPlanId={currentPlanId}
        loading={cloudLoading}
        saving={cloudSaving}
        status={cloudStatus}
        error={cloudError}
      />

      {toast && <div className="toast" role="status"><Check size={17} /> {toast}</div>}
    </div>
  );
}
