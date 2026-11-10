/** Record the same center crop as the live preview when the camera ignores orientation. */
export function orientedRecordingStream(
  source: MediaStream, video: HTMLVideoElement | null, width: number, height: number,
): { stream: MediaStream; dispose: () => void } | null {
  if (!video || video.srcObject !== source || !video.videoWidth || !video.videoHeight || video.readyState < 2) {
    throw new Error('Камера ещё подключается. Попробуйте начать запись снова.');
  }
  if ((video.videoWidth < video.videoHeight) === (width < height) && video.videoWidth !== video.videoHeight) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context || typeof canvas.captureStream !== 'function') {
    throw new Error('На этом устройстве не удалось записать видео в выбранной ориентации.');
  }

  function draw() {
    if (!video || !context || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
    const frameWidth = video.videoWidth * scale;
    const frameHeight = video.videoHeight * scale;
    context.drawImage(video, (width - frameWidth) / 2, (height - frameHeight) / 2, frameWidth, frameHeight);
  }

  draw();
  const stream = canvas.captureStream(30);
  if (!stream.getVideoTracks().length) {
    throw new Error('На этом устройстве не удалось записать видео в выбранной ориентации.');
  }
  source.getAudioTracks().forEach(track => stream.addTrack(track));
  const timer = window.setInterval(draw, 1000 / 30);
  return {
    stream,
    dispose: () => {
      window.clearInterval(timer);
      stream.getVideoTracks().forEach(track => track.stop());
    },
  };
}
