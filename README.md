# Tunnel Slot Planner

A small web app for allocating wind tunnel time to teams. It installs on an iPhone home screen and works offline.

**App:** https://juvehu.github.io/WindTunnelSlots/

## What it does

- Up to 10 teams, each with 1–4 flyers and a total tunnel time in 15-minute steps.
- Half-hour periods from 08:00 to 22:00, each with two 15-minute slots (A and B).
- Mark slots unavailable, fix a team into a specific slot, then press **Allocate**.
- Rest rule: a flyer in the 10:00 period can fly again from 11:30 at the earliest. Flyers are matched by name across teams.
- The allocator gives every team its time first, then keeps each team's sessions as close to the 1:30 rhythm as possible.
- Share or copy the plan as a picture.

## Saved events

Each tunnel day is an **event** (name + date) with its own teams, slots, fixes and plan. Use **Event…** to create, duplicate, rename, delete, export or import events. Changes save automatically.

Events are stored **on the device only**, in the app's own storage. Nothing is sent anywhere.

- Removing the app from the home screen deletes its events. Use **Export all events** for a backup (save the file to iCloud Drive or Files).
- The installed app and the same address opened in Safari keep separate data.
- To move events to another device, export them and import the file there.

## Install on iPhone

1. Open the app address in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Open it from the new icon.

## Updating

Push changes to `main`. GitHub Pages republishes in about a minute, and the app picks up the new version the next time it is opened with a connection. Saved events are kept.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure |
| `styles.css` | Layout and theme (phone tabs, desktop three-pane view) |
| `app.js` | Events, allocation, picture export |
| `sw.js` | Offline support |
| `manifest.webmanifest`, `icons/` | Home-screen install |
