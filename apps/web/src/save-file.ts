const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Hands a file to the browser to save. */
export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Hands a Word file to the browser to save. */
export function saveDocx(bytes: ArrayBuffer, fileName: string): void {
  saveFile(new Blob([bytes], { type: DOCX_TYPE }), fileName);
}
