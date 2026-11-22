export function downloadLocalFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Give the browser time to start reading the object after the click.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
