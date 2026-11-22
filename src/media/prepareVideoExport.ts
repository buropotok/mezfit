/** The browser recorder can leave duration zero in a fragmented MP4 header. */
async function isFragmentedMp4(file: Blob, signal: AbortSignal): Promise<boolean> {
  for (let offset = 0; offset + 8 <= file.size;) {
    signal.throwIfAborted();
    const header = new DataView(await file.slice(offset, offset + 16).arrayBuffer());
    let size = header.getUint32(0);
    if (size === 1) {
      if (header.byteLength < 16) return false;
      size = Number(header.getBigUint64(8));
      if (size < 16) return false;
    }
    if (size === 0) size = file.size - offset;
    if (!Number.isSafeInteger(size) || size < 8 || size > file.size - offset) return false;
    if (header.getUint32(4) === 0x6d6f6f66) return true; // moof
    offset += size;
  }
  return false;
}

export async function prepareVideoExport(file: File, signal: AbortSignal): Promise<File> {
  signal.throwIfAborted();
  const mimeType = file.type.split(';', 1)[0];
  if (mimeType !== 'video/mp4' || !await isFragmentedMp4(file, signal)) return file;
  const { Input, MP4, BlobSource, Conversion, Output, Mp4OutputFormat, BufferTarget } = await import('mediabunny');
  signal.throwIfAborted();
  const input = new Input({ formats: [MP4], source: new BlobSource(file) });
  const target = new BufferTarget();
  const abortInput = () => input.dispose();
  signal.addEventListener('abort', abortInput, { once: true });
  try {
    const conversion = await Conversion.init({
      input,
      output: new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target }),
      tracks: 'all',
      copy: { mode: 'forced' },
      showWarnings: false,
    });
    signal.throwIfAborted();
    if (!conversion.isValid || conversion.discardedTracks.length) throw new Error('VIDEO_EXPORT_COPY_UNAVAILABLE');
    const cancel = () => { void conversion.cancel().catch(() => undefined); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      await conversion.execute();
      signal.throwIfAborted();
      if (!target.buffer?.byteLength) throw new Error('VIDEO_EXPORT_EMPTY');
      return new File([target.buffer], file.name, { type: mimeType, lastModified: file.lastModified });
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  } finally {
    signal.removeEventListener('abort', abortInput);
    input.dispose();
  }
}
