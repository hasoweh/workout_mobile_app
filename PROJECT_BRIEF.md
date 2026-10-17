# Workout Tracker — Project Brief

A personal workout tracking app for my Android phone (Samsung Galaxy). I log workouts at the gym, all data stays on the phone, and the app shows me how I'm progressing over time.

This is a rough starting point. Work out the details (structure, data model, UI) as you go.

## The idea

- A simple, fast app for logging workouts while I'm training.
- **Local only**: no accounts, no backend, no cloud sync. Data lives on the device.
- Analysis built in: trends, progress and personal records, so I don't need a spreadsheet.

## Stack

**Progressive Web App (PWA)**, installed on the phone via Chrome → "Install app" / "Add to Home screen".

- Plain HTML/CSS/JavaScript or a light framework (e.g. Vite + vanilla JS / Preact). Keep it simple.
- **Storage:** IndexedDB (a small wrapper like Dexie.js is fine).
- **Charts:** Chart.js or similar.
- **Offline:** service worker + web app manifest so it works with no signal at the gym.
- **Hosting:** any free static host (GitHub Pages / Netlify) just to serve the app files. No user data goes there.
- Call `navigator.storage.persist()` so the browser doesn't evict the data.

Why a PWA rather than native: quick to build and change, no Android Studio or Play Store, and good enough for a personal tool. Native (Kotlin) or Flutter is an option later if the PWA falls short.

## Features

### Must have (v1)
- Start a workout, add exercises, log sets (reps, weight, optional notes).
- Exercise list I can add to (name, muscle group, type: strength / cardio).
- Cardio entries (distance, duration).
- Workout history: list of past workouts, tap to view or edit.
- "Repeat last workout" or prefill from the last time I did an exercise.
- **Export / import** all data as JSON (and ideally CSV) for backups.

### Analysis
- Per-exercise trend chart: top weight, estimated 1RM and volume over time.
- Personal records (best weight, best estimated 1RM, most reps at a weight).
- Weekly volume / sets per muscle group.
- Workout frequency / consistency (calendar heatmap or streaks).

### Nice to have (later)
- Rest timer between sets.
- Workout templates / routines.
- Bodyweight tracking with a trend line.
- Dark mode.

## How I'd use it

1. Open the app from my home screen at the gym, often with bad or no signal.
2. Start a workout, pick exercises and log each set as I go, one-handed, with big tap targets and minimal typing (prefilled values from last time).
3. Finish the workout. It's saved locally.
4. Every now and then, check the trends and PRs to see if I'm progressing.
5. Occasionally export a backup file to my Google Drive or PC.

## Getting started

1. Scaffold the PWA (manifest, service worker, basic page structure).
2. Set up the IndexedDB schema (exercises, workouts, sets).
3. Build the logging flow first, then history, then charts.
4. Test on the phone (serve it locally over the network, or deploy to GitHub Pages).
