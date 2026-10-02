# Fight music: drop tracks in here

Only music you have the right to use in a commercial game. A track needs a licence that
covers **video games / synchronisation**, not just streaming.

1. Put the audio files in this folder. Use `.mp4` (AAC in an MP4 container) — the artifact
   host does not serve `.m4a`. Convert with:
   `ffmpeg -i track.mp3 -c:a aac -b:a 160k -movflags +faststart track.mp4`
2. List them in `playlist.json` beside them:

```json
[
  { "file": "planes.mp4", "title": "Planes", "credit": "prod. PlayboyFlexx" }
]
```

`credit` shows next to the Next button during a fight — some licences (e.g. lxjah's)
require the credit, so fill it in when the producer asks for one.

No `playlist.json`, or an empty list, and the game stays silent and hides the button.
Keep the whole folder under ~20 MB: the artifact build has a 255-file / 64 MB cap.

Keep each purchase receipt and licence PDF in `licences/` next to the audio.
