# FlowPilot demo video

This is a standalone Remotion composition: it uses scripted, representative FlowPilot data rather than a live API, so the video is deterministic and safe to record.

```powershell
cd demos/flowpilot-video
npm run studio
npm run render
```

The composition is `FlowPilotDemo` at 1920×1080, 30 fps, and about 2 minutes 40 seconds. The guided marker is deliberately larger than a normal cursor so viewers can follow the intent, while the source still feels like the FlowPilot application.

To recreate the bundled narration on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/generate-narration.ps1
```

Edit `scripts/generate-narration.ps1` and the scene timings in `src/Demo.tsx` together when changing the spoken story.
