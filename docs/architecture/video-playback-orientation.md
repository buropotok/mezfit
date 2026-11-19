# Video playback orientation

`useVideoOrientation` is shared by `DiscussionMedia` (chat thumbnail, selection
preview, viewer) and `CircularVideoPlayback` (chat and Settings). Once native
metadata is available it reads the original track dimensions, clockwise rotation
and flip using the pinned Mediabunny reader. Square tracks, including existing
480×480 recordings, follow exactly the same path. The previous dimension-based
native-rotation heuristic and square-frame exception are retired by owner decision.

For a nonzero rotation or flip, `videoPlaybackCopy` downloads the already-resolved
source and writes a temporary local container using EncodedVideoPacketSource and
EncodedAudioPacketSource. Every encoded packet is copied with its original data
and timestamps; no decoder, encoder or canvas capture participates. Every output
video track has an identity transformation. MP4 stays MP4; WebM stays WebM. The
result is checked for neutral track transformations before exposure. Originals,
uploaded objects and the original IndexedDB cache remain unchanged.

Mezfit applies the saved rotation/flip to that neutral source exactly once in
all three ordinary-video modes and in circular playback. A zero-transformation
source retains native streaming without an unnecessary full download. The video
surface stays hidden until inspection/preparation completes, preventing a wrong
thumbnail from flashing before correction. The preparation message is app-owned
Caption typography. Existing UI Kit playback controls stay upright. Annotation
capture applies the same transformation as the visible video.

Each mounted player owns cancellation, a 60-second preparation deadline, stale
completion rejection, resize observation and object-URL revocation. Source/mode
changes invalidate preparation. Switching to the local copy restores the paused
position and attempts to resume only if playback was active at that switch.
Metadata reads retain their own five-second deadline and no network retry.
Preparation failure does not expose the uncorrected source: ordinary videos use
the existing retry/R2 fallback path; circular playback reports through its existing
error callback. R2 capability authorization remains with the existing source
resolver. No endpoint, credentials, schema, ACL or migration changes are needed.

The circle camera still requests ideal 480×488 at 30 fps; orientation correctness
no longer depends on whether the camera honors that size. All circle viewports
retain their circular cover crop. Remote rotated videos require a complete source
download before playback, so preparation adds latency and temporary memory use.
Device acceptance requires repeated thumbnail/viewer/circle playback on Telegram
iOS and Android with both cached and remote copies of the same recordings.
