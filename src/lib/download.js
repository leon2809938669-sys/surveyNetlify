export function downloadJson(data, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadExcel(rows, filename) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const headers = [...new Set(rows.flatMap(Object.keys))];
  const data = [
    headers.map((header) => ({ value: header, type: String, fontWeight: "bold", backgroundColor: "#eaf0e6" })),
    ...rows.map((row) => headers.map((header) => {
      const value = row[header];
      // Explicit string cells prevent spreadsheet formula injection.
      return typeof value === "number" ? { value, type: Number } : { value: value == null ? "" : String(value), type: String };
    }))
  ];
  await writeExcelFile(data, { sheet: "responses", stickyRowsCount: 1, columns: headers.map(() => ({ width: 24 })) }).toFile(filename);
}
