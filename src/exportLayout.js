export function isReversedExport(exportOrientation) {
  return exportOrientation === "reversed";
}

export function getExportLayout({
  seats,
  rows,
  cols,
  columnGaps,
  exportOrientation,
}) {
  const reversed = isReversedExport(exportOrientation);
  const seatCount = Math.max(0, Number(rows) || 0) * Math.max(0, Number(cols) || 0);
  const sourceSeats = Array.isArray(seats) ? seats : [];
  const sourceGaps = Array.isArray(columnGaps) ? columnGaps : [];

  return {
    reversed,
    seats: reversed
      ? Array.from({ length: seatCount }, (_, index) => sourceSeats[seatCount - 1 - index])
      : sourceSeats,
    columnGaps: reversed ? [...sourceGaps].reverse() : sourceGaps,
  };
}
