export function createEmptySeats(rows, cols) {
  return Array.from({ length: rows * cols }, () => ({
    studentId: null,
    locked: false,
    disabled: false,
  }));
}

export function createInitialSeats(students, rows, cols) {
  return createEmptySeats(rows, cols).map((seat, index) => ({
    ...seat,
    studentId: students[index]?.id ?? null,
  }));
}

export function resizeSeats(seats, oldRows, oldCols, newRows, newCols) {
  const next = createEmptySeats(newRows, newCols);
  const rowsToCopy = Math.min(oldRows, newRows);
  const colsToCopy = Math.min(oldCols, newCols);

  for (let row = 0; row < rowsToCopy; row += 1) {
    for (let col = 0; col < colsToCopy; col += 1) {
      next[row * newCols + col] = { ...seats[row * oldCols + col] };
    }
  }

  return next;
}

function shuffled(items) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}

function byNumber(a, b) {
  return String(a.number).localeCompare(String(b.number), undefined, {
    numeric: true,
  });
}

function seatOrder(rows, cols, method) {
  const indices = [];

  if (method.startsWith("number-column")) {
    const columns = Array.from({ length: cols }, (_, index) => index);
    if (method.endsWith("right")) columns.reverse();
    columns.forEach((col) => {
      for (let row = 0; row < rows; row += 1) {
        indices.push(row * cols + col);
      }
    });
    return indices;
  }

  for (let row = 0; row < rows; row += 1) {
    const columns = Array.from({ length: cols }, (_, index) => index);
    if (method.endsWith("right")) columns.reverse();
    columns.forEach((col) => indices.push(row * cols + col));
  }
  return indices;
}

export function autoArrangeSeats({ seats, students, rows, cols, config }) {
  const lockedStudentIds = new Set(
    seats
      .filter((seat) => seat.locked && seat.studentId)
      .map((seat) => seat.studentId),
  );
  const method = config.method;
  let pool = students.filter((student) => !lockedStudentIds.has(student.id));

  if (method === "rules") {
    pool = shuffled(pool);
  } else {
    pool = [...pool].sort(byNumber);
  }

  const order = seatOrder(
    rows,
    cols,
    method === "rules" ? "number-row-left" : method,
  ).filter((index) => !seats[index].disabled && !seats[index].locked);

  const next = seats.map((seat) => ({
    ...seat,
    studentId: seat.locked ? seat.studentId : null,
  }));

  const remainingIndices = [...order];
  const place = (student) => {
    if (!remainingIndices.length) return;
    const [seatIndex] = remainingIndices.splice(0, 1);
    next[seatIndex].studentId = student.id;
  };

  pool.forEach(place);

  return next;
}

export function getUnassignedStudents(students, seats) {
  const assigned = new Set(
    seats.map((seat) => seat.studentId).filter(Boolean),
  );
  return students.filter((student) => !assigned.has(student.id));
}
