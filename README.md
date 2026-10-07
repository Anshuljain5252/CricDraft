# CricDraft

Local-first cricket draft game with **₹0 paid API cost**.

## Current version
v5.1 — All Formats + Smart Search

## Formats
- Test
- ODI
- T20I
- IPL
- T20I + IPL

## Local cricket data
Click **DOWNLOAD / REFRESH ALL FORMATS** in the app.

CricDraft downloads Cricsheet JSON archives and builds `data/players.json` locally.

- IPL: career data across IPL history from 2008 onward
- T20I: derived from Cricsheet's T20I archive
- Test / ODI: derived from available Cricsheet ball-by-ball coverage and marked coverage-limited where older matches are unavailable
- Completed rounds are stored in `data/rounds.json`

## Smart player search
Search supports:
- first name
- middle name
- surname
- partial words
- initials
- Cricsheet name variants
- common aliases and nicknames
- alternate spellings
- fuzzy typo matching
- format-aware filtering

Examples:
- `vai`, `sur`, `suryavanshi`, `vaibhabh` → Vaibhav Sooryavanshi
- `VK`, `virat`, `kohli` → Virat Kohli
- `ABD`, `mr 360` → AB de Villiers
- `SKY`, `surya` → Suryakumar Yadav

Custom aliases can be added to `data/custom-aliases.json`.

## Run on Windows
1. Install Node.js 20.6+
2. Run `SETUP-WINDOWS.bat`
3. Run `start-cricdraft.bat`
4. Open http://localhost:3000

No OpenAI key or paid cricket API is required.
