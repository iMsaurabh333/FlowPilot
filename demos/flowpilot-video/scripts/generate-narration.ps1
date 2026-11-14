param(
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\public\audio\flowpilot-narration.wav')
)

$text = @'
Welcome to FlowPilot, the operational assistant that helps integration teams move from a signal to the right action.

The workspace opens with a short, practical priority queue. It tells the team what needs attention, what has changed, and where to begin. From here, operators can go straight into health diagnostics, a focused troubleshooting session, a governed connection, or a repeatable report.

Health turns message activity into an operational picture. Choose a time window, review the volume and failure rate, and see the flows that deserve attention first. In this example, FlowPilot has isolated recurring failures in the outbound order fulfillment flow. The processing-time view provides a separate way to identify slow integrations without mixing performance signals into the failure investigation.

When a signal needs explanation, use Assistant chat in plain language. Describe the symptom and the relevant business context. FlowPilot brings together the diagnostic evidence, explains the observed pattern, and gives the operator a short, accountable list of next steps. The conversation remains private to the authenticated user, while the answer points back to the operational sources that informed it.

FlowPilot also makes connected capabilities visible and controlled. In MCP configuration, each connection shows its health, verification result, approved tools, and enabled state. A connection is verified before it becomes available, making the operational surface easier to trust and review.

For larger checks, bulk reconciliation compares a trusted file of business identifiers across selected systems. The setup makes the selected sources, identifier mapping, and comparison fields clear before it runs. The result separates matches from exceptions, so attention goes to the records that need it.

Finally, operational reports turn a useful review into a repeatable habit. Choose approved sources, schedule the report, and share a focused summary with the team. Every FlowPilot workflow is designed to keep the operational signal clear, the next action understandable, and the human operator in control.
'@

$folder = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $folder | Out-Null

# SAPI uses the desktop voices installed with Windows and can create a WAV in
# a non-interactive process, which makes this repeatable in CI or a terminal.
$speaker = New-Object -ComObject SAPI.SpVoice
$stream = New-Object -ComObject SAPI.SpFileStream
$stream.Open($OutputPath, 3, $false) # SSFMCreateForWrite
$speaker.Rate = -1
$speaker.Volume = 95
$speaker.AudioOutputStream = $stream
[void]$speaker.Speak($text)
$stream.Close()
[void][Runtime.InteropServices.Marshal]::ReleaseComObject($stream)
[void][Runtime.InteropServices.Marshal]::ReleaseComObject($speaker)
Write-Output "Created narration: $OutputPath"
