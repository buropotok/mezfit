# Video playback orientation

The circle camera profile requests 480×488 at 30 fps. These are ideal
constraints: a device may supply other dimensions. Playback uses the actual
decoded dimensions, never the requested camera dimensions or the phone's OS.
The circular viewport continues to crop with `object-fit: cover`.

`useVideoOrientation` is shared by `DiscussionMedia` (thumbnail, preview,
viewer) and `CircularVideoPlayback` (chat and Settings). For non-square frames
it reads the original track dimensions and rotation using the pinned
Mediabunny input reader and the same resolved URL used by native playback.
When the decoded dimensions already match the rotated track, no compensation
is applied. When they match the unrotated track and its matrix specifies
90°/270°, the player applies that clockwise CSS rotation and adjusts the
contain/cover scale. Annotation capture uses the same missing rotation.

Owner decision: square frames, including existing 480×480 recordings, skip
metadata inspection and correction entirely. Unknown dimensions and 180°
rotations cannot establish whether native rotation was applied and retain
native playback. There is no calibration clip, platform allowlist, migration,
reencoding, metadata rewrite or change to stored/uploaded media bytes.

Metadata inspection is optional and has a five-second deadline, no network
retry, a bounded reader cache, source-change cancellation and stale completion
protection. Metadata/CORS failures leave native playback available. Private
R2 capabilities continue to come from the existing authorized source resolver.
No new endpoint, credentials, schema or persistence contract is introduced.

Only a compensated ordinary video uses separate UI Kit play/pause and seek
controls, so CSS rotation cannot rotate the controls. Circles keep their
existing tap control and circular seek rail. Other ordinary videos retain
native controls. Device acceptance still requires fresh recordings and playback
in Telegram on iOS and Android; a square result intentionally receives no fix.
