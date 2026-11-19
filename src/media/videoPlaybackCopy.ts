import type { Output as MediaOutput } from 'mediabunny';

/** Copy compressed packets into a container with identity video transformations. */
export async function normalizeVideoPlayback(blob: Blob, signal: AbortSignal): Promise<Blob> {
  const { Input, MP4, WEBM, BlobSource, Output, BufferTarget, Mp4OutputFormat, WebMOutputFormat,
    EncodedPacketSink, EncodedVideoPacketSource, EncodedAudioPacketSource } = await import('mediabunny');
  signal.throwIfAborted();
  const input = new Input({ formats: [MP4, WEBM], source: new BlobSource(blob) });
  const target = new BufferTarget();
  let output: MediaOutput | undefined;
  const cancel = () => {
    input.dispose();
    if (output) void output.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    const mp4 = await input.getFormat() === MP4;
    signal.throwIfAborted();
    output = new Output({ format: mp4 ? new Mp4OutputFormat() : new WebMOutputFormat(), target });
    const pumps: Array<() => Promise<void>> = [];
    const videos = await input.getVideoTracks();
    if (!videos.length) throw new Error('VIDEO_ORIENTATION_EMPTY_COPY');
    for (const track of videos) {
      const codec = await track.getCodec();
      const decoderConfig = await track.getDecoderConfig();
      if (!codec || !decoderConfig) throw new Error('VIDEO_ORIENTATION_COPY_UNAVAILABLE');
      const source = new EncodedVideoPacketSource(codec);
      // Do not forward the input matrix, including for square or mirrored tracks.
      output.addVideoTrack(source, { rotation: 0 });
      pumps.push(async () => {
        let first = true;
        for await (const packet of new EncodedPacketSink(track).packets()) {
          signal.throwIfAborted();
          await source.add(packet, first ? { decoderConfig } : undefined);
          first = false;
        }
        source.close();
      });
    }
    for (const track of await input.getAudioTracks()) {
      const codec = await track.getCodec();
      const decoderConfig = await track.getDecoderConfig();
      if (!codec || !decoderConfig) throw new Error('VIDEO_ORIENTATION_COPY_UNAVAILABLE');
      const source = new EncodedAudioPacketSource(codec);
      output.addAudioTrack(source);
      pumps.push(async () => {
        let first = true;
        for await (const packet of new EncodedPacketSink(track).packets()) {
          signal.throwIfAborted();
          await source.add(packet, first ? { decoderConfig } : undefined);
          first = false;
        }
        source.close();
      });
    }
    await output.start();
    await Promise.all(pumps.map(pump => pump()));
    await output.finalize();
    signal.throwIfAborted();
    if (!target.buffer?.byteLength) throw new Error('VIDEO_ORIENTATION_EMPTY_COPY');
    const result = new Blob([target.buffer], { type: mp4 ? 'video/mp4' : 'video/webm' });
    const check = new Input({ formats: [MP4, WEBM], source: new BlobSource(result) });
    try {
      const tracks = await check.getVideoTracks();
      if (tracks.length !== videos.length) throw new Error('VIDEO_ORIENTATION_EMPTY_COPY');
      for (const track of tracks) {
        if (await track.getRotation() !== 0 || await track.getFlip()) throw new Error('VIDEO_ORIENTATION_NOT_NEUTRAL');
      }
    } finally { check.dispose(); }
    signal.throwIfAborted();
    return result;
  } catch (reason) {
    if (output) await output.cancel().catch(() => {});
    throw reason;
  } finally {
    signal.removeEventListener('abort', cancel);
    input.dispose();
  }
}

/** The caller supplies only the URL already selected by the authorized media resolver. */
export async function loadVideoPlaybackCopy(src: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(src, { signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
  if (!response.ok || response.status === 206) throw new Error('VIDEO_ORIENTATION_DOWNLOAD_FAILED');
  const blob = await response.blob();
  signal.throwIfAborted();
  return normalizeVideoPlayback(blob, signal);
}
