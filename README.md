# Unicaria

Local music notation for Windows with harmonic scrubbing, General MIDI playback, MusicXML import, and MIDI export.

Open `Unicaria.exe` from the portable folder. Keep its accompanying files together.

Choose a note duration, then click or drag onto a staff. Hold Space and move across the score to hear the harmony. Save editable scores as `.unicaria`. Keyboard shortcuts are available in Help.

## Development

Use Node.js 24 or later: `npm ci`, `npm test`, `npm run build`, then `npm start`. Use `npm run dev` for browser development and `npm run package` after building to create the Windows app.

Third-party licenses are in `public/THIRD-PARTY-NOTICES.txt` and `public/GeneralUser-LICENSE.txt`.
