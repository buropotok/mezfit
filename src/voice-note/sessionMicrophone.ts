// Keep permission in this WebView session, with capture disabled between clips.
let stream: MediaStream | undefined;
let pending: Promise<MediaStream> | undefined;

function releaseSession() {
  pending = undefined;
  stream?.getTracks().forEach(track => track.stop());
  stream = undefined;
}

export function hasSessionMicrophone() {
  return stream?.getAudioTracks().some(track => track.readyState === 'live') ?? false;
}

/** Preserve the microphone grant already obtained by video recording. */
export function retainSessionMicrophone(camera: MediaStream) {
  if (hasSessionMicrophone() || pending) return;
  const tracks = camera.getTracks().filter(track => track.kind === 'audio');
  if (!tracks.length) return;
  releaseSession();
  stream = new MediaStream(tracks.map(track => track.clone()));
  stream.getTracks().forEach(track => { track.enabled = false; });
  window.addEventListener('pagehide', releaseSession, { once: true });
}

export async function acquireSessionMicrophone(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (!hasSessionMicrophone()) {
    if (!pending) {
      releaseSession();
      window.addEventListener('pagehide', releaseSession, { once: true });
      const request = navigator.mediaDevices.getUserMedia(constraints).then(result => {
        if (pending !== request) {
          result.getTracks().forEach(track => track.stop());
          throw new DOMException('Microphone session closed', 'AbortError');
        }
        result.getAudioTracks().forEach(track => { track.enabled = false; });
        stream = result;
        return result;
      }).finally(() => {
        if (pending === request) {
          pending = undefined;
          if (!stream) window.removeEventListener('pagehide', releaseSession);
        }
      });
      pending = request;
    }
    await pending;
  }
  if (!stream) throw new DOMException('Microphone session closed', 'AbortError');
  const recordingStream = stream.clone();
  recordingStream.getAudioTracks().forEach(track => { track.enabled = true; });
  return recordingStream;
}
