# Things Bridge

A [Things 3](https://culturedcode.com/things/) window in Obsidian, so a task is never far from
its note and a note never strands a commitment. Things stays the single source of truth.

Designed for ADHD and autistic brains: one to-do shown large, sending a to-do takes seconds,
nothing changes in Things that you haven't seen, and there are no counters or streaks.

## The window

Open it from the ribbon or **Open Things window**. It has two tabs.

**Today**

- **Now:** the first to-do in your Today, in the order you arranged it in Things.
- **Next:** the few after it (three by default), still in your order.
- **The rest of today**, grouped the way you choose in settings: by project, by area then project,
  by tag (under its parent tag), or not at all. Groups start folded to their names and counts, so
  the top tasks stay the focus; each sits where its first to-do is in Today.
- **Due in the next 7 days:** deadlines not already in Today.
- **Linked to this note:** to-dos whose notes link back to the note you have open.

**Projects**

Every project with something in Today, with how many of its to-dos are in Today, how many are open,
and its nearest deadline. Click one to open its **project view**: its to-dos under Today, Upcoming
(by start date), Anytime, and Someday folded away, with a button to add a to-do to it. Other active
projects are listed by area below. **Open a Things project…** opens any project's view directly.

Tick a to-do to complete it in Things (it stays on screen with an Undo for a few seconds). Click a
title to show it in Things, a project name to open its view, and the note chip to open the linked
note.

## Send to Things

**Send to Things…** opens a draft prefilled from the note: the title from your selection (or the
heading you're under, or the note's name), a link back to the note, and the course's project and
tag when the note belongs to a course (a `things-project` property, or a `course` link to a note
that has one). Pick When, a deadline (When is then set a few days earlier, as a start reminder)
and an optional first tiny step, which becomes the first checklist item. Enter adds it.

Afterwards it asks you to say the first step out loud once: rehearsing an if-then plan
strengthens it, writing it down alone doesn't (Sheeran et al., 2024).

## Settings

- **Top tasks after Now**, and how the **rest of Today is grouped** (project; area, then project;
  tag; or Things' plain order). Whether groups **start open**.
- Whether **project views** open in a new tab or a split beside your note.
- How far ahead **deadlines** are listed, how often the window **refreshes** while visible, and the
  default **start reminder** before a deadline.

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

macOS with [Things 3](https://culturedcode.com/things/) for the window. Sending to Things works on
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
