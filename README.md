# Things Bridge

A [Things 3](https://culturedcode.com/things/) window in Obsidian, so a task is never far from
its note and a note never strands a commitment. Things stays the single source of truth.

Designed for ADHD and autistic brains: one to-do shown large, sending a to-do takes seconds,
nothing changes in Things that you haven't seen, and there are no counters or streaks.

## The window

Open it from the ribbon or **Open Things**. Along the top, a row of tabs that scrolls sideways:

- **Today:** the first to-do in your Things Today shown large ("Now"), the next few in your own
  order, then the rest grouped the way you choose (by project; area, then project; tag, under its
  parent tag; or not at all), folded to their names and counts. Then deadlines in the coming days
  and the to-dos linked to the note you have open. To-dos only: projects scheduled for today are
  marked on their project tabs (a setting puts them back here if you prefer).
- **Deadlines:** every deadline, to-dos' and projects' own, soonest first, overdue on top, under a
  heading per day.
- **Projects:** all your active projects, one tab each in a second sideways row. Pick one and its
  to-dos show underneath: Today, Upcoming by start date, Anytime, and Someday folded away.
- **One sidebar tab per area**, beside the Things tab and marked with the area's emoji, with the same
  second row for that area's projects (and its to-dos that
  sit in no project).

Tabs show how many to-dos are in Today; a dot marks a project scheduled for today. Every tab has
its own command (**Open Things: today**, **Open Things: deadlines**, **Open Things: all
projects**, **Open Things: <area>**), so any of them can have a hotkey. Settings choose which tabs
show, and whether those commands switch one window or open a window each, so several can sit side
by side.

Tick a to-do to complete it in Things, in the background, with a few seconds to undo. Click a
title to show it in Things, a project name to open its tab, and the note chip to open the linked
note.

**Right-click a to-do** for Things' usual actions: When (Today, This evening, Tomorrow, a date,
Anytime, Someday), add, change or clear a deadline, move to a project or area, show in Things,
complete, cancel, or move to the Trash (after you confirm). They run in the background, without
bringing Things forward. This evening needs Things' URL token (see Settings); everything else
needs nothing.

## Send to Things

**Send to Things…** opens a draft prefilled from the note: the title from your selection (or the
heading you're under, or the note's name), a link back to the note, and the course's project and
tag when the note belongs to a course (a `things-project` property, or a `course` link to a note
that has one). Pick When, a deadline (When is then set a few days earlier, as a start reminder)
and an optional first tiny step, which becomes the first checklist item. Enter adds it.

Afterwards it asks you to say the first step out loud once: rehearsing an if-then plan
strengthens it, writing it down alone doesn't (Sheeran et al., 2024).

## Settings

- **Tabs:** Today, Deadlines, Projects, and a tab per area (each area can be left out, and areas
  can sit in the sidebar or in the top row), and
  whether project tabs put those with something today first or follow Things' order.
- **Windows:** open Things in the right sidebar or a main tab, and whether each tab's command opens
  its own window.
- **Today:** how many top tasks follow Now, how the rest is grouped, whether groups start open,
  whether scheduled projects show among the to-dos, and how many days of deadlines it lists.
- **Things URL token,** only for This evening. In Things: Settings, General, Enable Things URLs,
  Manage. It's kept in Obsidian's secure storage, never in this plugin's settings file.
- How often views **refresh** while visible, and the default **start reminder** before a deadline.

## Permissions, privacy and platforms

- **Reading** uses Things' AppleScript dictionary, so macOS asks once whether Obsidian may control
  Things (System Settings → Privacy & Security → Automation). Things' database is never opened,
  and Full Disk Access is never needed.
- **Things is read only while the window is visible**, never at startup, and never launched by
  the window: if Things is closed, the window waits until you ask.
- **Adding** uses the Things URL scheme. **Completing** uses AppleScript, so it happens in the
  background without an auth token. A new project is only ever made after you confirm it.
- To-do text is kept in memory only. Settings are the only thing saved.
- **No network.** Nothing leaves your computer.
- On iPhone and iPad, **Send to Things** works; the window needs the Mac.

## Requirements

Obsidian 1.11.4 or later. macOS with [Things 3](https://culturedcode.com/things/) for the window. Sending to Things works on
every platform Things runs on. Things Bridge is not made by or affiliated with Cultured Code.

## For plugin developers

Copy [`src/api-types.ts`](src/api-types.ts) into your plugin and call `getThingsBridgeApi(app)`:
`today()`, `deadlines(days)`, `lists()`, `createTodo(draft)` and `createProject(project)` (which
always asks the user first). `apiVersion` follows semver: minor versions only add.

## Development

```
npm install
npm test        # core tests, with Things replies as fixtures
npm run lint    # Obsidian's review rules
npm run build
```
