import type { EncodedPacket, Input, InputVideoTrack } from 'mediabunny';
import type { VideoTrimRange } from './videoTrim';

type Media = typeof import('mediabunny');

function readAvcConfig(description: VideoDecoderConfig['description']) {
  if (!description) throw new Error('Missing AVC decoder configuration');
  const bytes = ArrayBuffer.isView(description)
    ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
    : new Uint8Array(description);
  if (bytes.length < 7 || bytes[0] !== 1) throw new Error('Invalid AVC decoder configuration');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lengthSize = (bytes[4] & 3) + 1;
  const parameterSets: Uint8Array[] = [];
  let offset = 6;
  const readSets = (count: number) => {
    for (let index = 0; index < count; index++) {
      const length = view.getUint16(offset);
      offset += 2;
      if (!length || offset + length > bytes.length) throw new Error('Invalid AVC parameter set');
      parameterSets.push(bytes.subarray(offset, offset + length));
      offset += length;
    }
  };
  const sequenceCount = bytes[5] & 31;
  readSets(sequenceCount);
  const pictureCount = view.getUint8(offset++);
  readSets(pictureCount);
  if (!sequenceCount || !pictureCount) throw new Error('Missing AVC parameter sets');
  const normalized = new Uint8Array(bytes);
  normalized[4] |= 3;
  return { lengthSize, parameterSets, normalized };
}

function avcPacketData(packet: EncodedPacket, config: ReturnType<typeof readAvcConfig>) {
  const addSets = packet.type === 'key';
  if (!addSets && config.lengthSize === 4) return packet.data;
  const units: Uint8Array[] = [];
  const { data } = packet;
  const { lengthSize, parameterSets } = config;
  for (let offset = 0; offset < data.length;) {
    if (offset + lengthSize > data.length) throw new Error('Truncated AVC packet');
    let length = 0;
    for (let index = 0; index < lengthSize; index++) length = length * 256 + data[offset++];
    if (!length || offset + length > data.length) throw new Error('Invalid AVC packet');
    units.push(data.subarray(offset, offset + length));
    offset += length;
  }
  // Keep an access-unit delimiter first when present. In avc3 the decoder
  // configuration travels with every keyframe, including after the splice.
  if (addSets) units.splice(((units[0]?.[0] ?? 0) & 31) === 9 ? 1 : 0, 0, ...parameterSets);
  const result = new Uint8Array(units.reduce((length, unit) => length + 4 + unit.length, 0));
  const view = new DataView(result.buffer);
  let offset = 0;
  for (const unit of units) {
    view.setUint32(offset, unit.length);
    result.set(unit, offset + 4);
    offset += 4 + unit.length;
  }
  return result;
}

export async function encodeTrimStart(
  media: Media, track: InputVideoTrack, start: number, end: number, signal: AbortSignal,
) {
  const { BufferTarget, Mp4OutputFormat, Output, VideoSampleSink, VideoSampleSource } = media;
  const config = await track.getDecoderConfig();
  if (!config?.codec.match(/^avc[13]\./) || !(await track.canDecode())) {
    throw new Error('AVC decoding is unavailable');
  }
  signal.throwIfAborted();
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const source = new VideoSampleSource({
    codec: 'avc',
    fullCodecString: config.codec.replace(/^avc3/, 'avc1'),
    bitrate: 1_000_000,
    latencyMode: 'quality',
  });
  output.addVideoTrack(source);
  const abort = () => { void output.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    await output.start();
    for await (const sample of new VideoSampleSink(track).samples(start, end)) {
      try {
        signal.throwIfAborted();
        const timestamp = sample.timestamp;
        sample.setTimestamp(Math.max(0, timestamp - start));
        sample.setDuration(Math.max(0, Math.min(sample.duration, end - timestamp)));
        await source.add(sample);
      } finally {
        sample.close();
      }
    }
    await output.finalize();
    signal.throwIfAborted();
    if (!target.buffer?.byteLength) throw new Error('Empty encoded video segment');
    return target.buffer;
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

export async function writeTrimWithEncodedStart(
  media: Media, input: Input, track: InputVideoTrack, prefix: ArrayBuffer,
  range: VideoTrimRange, join: EncodedPacket | null, signal: AbortSignal,
) {
  const { BufferSource, BufferTarget, Conversion, EncodedPacketSink, EncodedVideoPacketSource,
    Input, MP4, Mp4OutputFormat, Output } = media;
  const encoded = new Input({ formats: [MP4], source: new BufferSource(prefix) });
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const abort = () => { void output.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const head = await encoded.getPrimaryVideoTrack();
    const headDecoder = await head?.getDecoderConfig();
    const tailDecoder = await track.getDecoderConfig();
    if (!head || !headDecoder || !tailDecoder
      || headDecoder.codedWidth !== tailDecoder.codedWidth || headDecoder.codedHeight !== tailDecoder.codedHeight) {
      throw new Error('Encoded video segment does not match the recording dimensions');
    }
    const headConfig = readAvcConfig(headDecoder.description);
    const tailConfig = join ? readAvcConfig(tailDecoder.description) : null;
    const decoderConfig = {
      ...headDecoder,
      displayAspectWidth: tailDecoder.displayAspectWidth,
      displayAspectHeight: tailDecoder.displayAspectHeight,
      ...(tailConfig && { codec: headDecoder.codec.replace(/^avc1/, 'avc3'), description: headConfig.normalized }),
    };
    const source = new EncodedVideoPacketSource('avc');
    output.addVideoTrack(source, { rotation: await track.getRotation() });
    const audio = (await input.getAudioTracks()).length > 0 ? await Conversion.init({
      input,
      output,
      composable: true,
      video: { discard: true },
      trim: range,
      copy: { mode: 'forced', boundaryPolicy: 'shrink', boundaryTolerance: 0.05 },
      showWarnings: false,
    }) : null;
    if (audio && (!audio.isValid || audio.discardedTracks.some(({ track }) => track.isAudioTrack()))) {
      throw new Error('Cannot copy all audio tracks');
    }

    const writeVideo = async () => {
      const headEnd = (join?.timestamp ?? range.end) - range.start;
      let hasFirstPacket = false;
      for await (const packet of new EncodedPacketSink(head).packets()) {
        signal.throwIfAborted();
        if (packet.timestamp >= headEnd) break;
        if (!hasFirstPacket && (packet.type !== 'key' || Math.abs(packet.timestamp) > 0.000001)) {
          throw new Error('Encoded segment does not begin at the selected frame');
        }
        hasFirstPacket = true;
        await source.add(packet.clone({
          data: tailConfig ? avcPacketData(packet, headConfig) : packet.data,
          duration: Math.min(packet.duration, headEnd - packet.timestamp),
        }), { decoderConfig });
      }
      if (!hasFirstPacket) throw new Error('Encoded video segment has no frames');
      if (join && tailConfig) {
        for await (const packet of new EncodedPacketSink(track).packets(join, undefined, { verifyKeyPackets: true })) {
          signal.throwIfAborted();
          if (packet.timestamp >= range.end) break;
          if (packet.timestamp < join.timestamp) continue;
          await source.add(packet.clone({
            data: avcPacketData(packet, tailConfig),
            timestamp: packet.timestamp - range.start,
            duration: Math.min(packet.duration, range.end - packet.timestamp),
          }));
        }
      }
      source.close();
    };

    signal.throwIfAborted();
    await output.start();
    await Promise.all([writeVideo(), audio?.execute()]);
    signal.throwIfAborted();
    await output.finalize();
    if (!target.buffer?.byteLength) throw new Error('Empty trimmed video');
    return new Blob([target.buffer], { type: 'video/mp4' });
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    encoded.dispose();
  }
}
