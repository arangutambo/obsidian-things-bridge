/**
 * The JavaScript for Automation scripts run with `osascript -l JavaScript`. Reading goes through
 * Things' scripting dictionary (one Automation prompt); its database is TCC-protected (T5).
 *
 * Every script checks `running()` first: touching any property launches Things, so the window
 * never opens Things by itself. Arguments arrive as `argv`, never spliced into the source.
 */

const APP = `Application("com.culturedcode.ThingsMac")`;

/**
 * Today (in Things' own order) and every open to-do, with dates as local YYYY-MM-DD.
 *
 * Shaped by timing on a real Mac (2026-11-10, 272 open to-dos): each property read on the Today
 * list makes Things rebuild Today (about 250 ms), and reading every to-do's notes costs ~1.7 s.
 * So Today gives only its order; details come from batched reads over all to-dos; and notes are
 * read only for to-dos that link back to Obsidian, which Things filters itself.
 */
export const READ_SCRIPT = `
function run(argv) {
	const app = ${APP};
	if (!app.running() && argv[0] !== "force") return JSON.stringify({ v: 1, running: false });
	const pad = (n) => (n < 10 ? "0" : "") + n;
	const iso = (d) => (d ? d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) : null);
	const today = app.lists.byId("TMTodayListSource").toDos.id();
	const all = app.toDos;
	const ids = all.id();
	const safe = (f) => { try { return f(); } catch (e) { return ids.map(() => null); } };
	const name = all.name(), due = all.dueDate(), act = all.activationDate(), tags = all.tagNames();
	const project = safe(() => all.project.name()), area = safe(() => all.area.name());
	const notes = {};
	try {
		const linked = app.toDos.whose({ notes: { _contains: "obsidian://" } });
		const lid = linked.id(), lnotes = linked.notes();
		lid.forEach((id, i) => { notes[id] = lnotes[i]; });
	} catch (e) {}
	const rows = ids.map((id, i) => ({ id: id, title: name[i], notes: notes[id] || "", when: iso(act[i]), deadline: iso(due[i]), tags: tags[i], project: project[i], area: area[i] }));
	const known = {};
	rows.forEach((r) => { known[r.id] = true; });
	// A project scheduled for today is in Today but not among the to-dos.
	today.filter((id) => !known[id]).forEach((id) => {
		try {
			const p = app.projects.byId(id);
			rows.push({ id: id, title: p.name(), notes: "", when: iso(p.activationDate()), deadline: iso(p.dueDate()), tags: p.tagNames(), project: null, area: p.area() ? p.area().name() : null, isProject: true });
		} catch (e) {}
	});
	// Projects (with their area and dates), Someday, and tag parents: ~350 ms together.
	const pr = app.projects;
	const pid = pr.id();
	const pname = pr.name(), pdue = pr.dueDate(), pact = pr.activationDate(), ptags = pr.tagNames(), pstatus = pr.status();
	let parea;
	try { parea = pr.area.name(); } catch (e) { parea = pid.map(() => null); }
	const projects = pid.map((id, i) => ({ id: id, title: pname[i], area: parea[i], when: iso(pact[i]), deadline: iso(pdue[i]), tags: ptags[i], open: pstatus[i] === "open" })).filter((p) => p.open);
	let someday = [];
	try { someday = app.lists.byId("TMSomedayListSource").toDos.id(); } catch (e) {}
	const tagParents = {};
	try {
		const tg = app.tags;
		const tn = tg.name();
		let tp;
		try { tp = tg.parentTag.name(); } catch (e) { tp = tn.map(() => null); }
		tn.forEach((n, i) => { tagParents[n] = tp[i] || null; });
	} catch (e) {}
	let areas = [];
	try { areas = app.areas.name(); } catch (e) {}
	return JSON.stringify({ v: 1, running: true, todayIds: today, all: rows, projects: projects, somedayIds: someday, tagParents: tagParents, areas: areas });
}`;

/** Open projects (with their area), areas and tags, for the send draft. */
export const LISTS_SCRIPT = `
function run(argv) {
	const app = ${APP};
	if (!app.running() && argv[0] !== "force") return JSON.stringify({ v: 1, running: false });
	const p = app.projects;
	const names = p.name(), status = p.status();
	let areas;
	try { areas = p.area.name(); } catch (e) { areas = names.map(() => null); }
	const projects = names.map((title, i) => ({ title: title, area: areas[i], open: status[i] === "open" })).filter((x) => x.open).map((x) => ({ title: x.title, area: x.area }));
	return JSON.stringify({ v: 1, running: true, projects: projects, areas: app.areas.name(), tags: app.tags.name() });
}`;

/** Sets one to-do's status: argv = [id, "completed" | "open"]. Runs in the background. */
export const STATUS_SCRIPT = `
function run(argv) {
	const id = argv[0];
	if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error("Not a Things id");
	const app = ${APP};
	app.toDos.byId(id).status = argv[1] === "open" ? "open" : "completed";
	return JSON.stringify({ v: 1, ok: true });
}`;

/**
 * The right-click actions that work through JavaScript for Automation, in the background:
 * argv = [action, id, arg?]. Dates are local YYYY-MM-DD. Moving between Things' lists and clearing
 * a deadline go through AppleScript instead (see `actionCall`), and "This evening" isn't in
 * Things' scripting dictionary at all, so it goes by URL.
 */
export const ACTION_SCRIPT = `
function run(argv) {
	const action = argv[0], id = argv[1], arg = argv[2] || "";
	if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error("Not a Things id");
	if (arg && !/^[A-Za-z0-9 -]+$/.test(arg) && action !== "area") throw new Error("Bad argument");
	const app = ${APP};
	const t = app.toDos.byId(id);
	const day = (s) => { const p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); };
	switch (action) {
		case "complete": t.status = "completed"; break;
		case "reopen": t.status = "open"; break;
		case "cancel": t.status = "canceled"; break;
		case "date": app.schedule(t, { for: day(arg) }); break;
		// Never empty here: JXA turns "no date" into 1 Jan 1904. Clearing goes through AppleScript.
		case "deadline": if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(arg)) throw new Error("No date"); t.dueDate = day(arg); break;
		case "project": t.project = app.projects.byId(arg); break;
		case "area": t.area = app.areas.byName(arg); break;
		case "trash": app.delete(t); break;
		default: throw new Error("Unknown action " + action);
	}
	return JSON.stringify({ v: 1, ok: true });
}`;

/**
 * Tested on a real to-do (2026-11-11): JXA's `move` fails for Things' lists ("Can't convert
 * types"), and JXA can't clear a date. AppleScript does both, addressed by Things' internal list
 * ids so it works whatever language Things is in.
 */
const MOVE_TO_LIST = ["on run argv", 'tell application id "com.culturedcode.ThingsMac" to move to do id (item 1 of argv) to list id (item 2 of argv)', "end run"];
const CLEAR_DEADLINE = ["on run argv", 'tell application id "com.culturedcode.ThingsMac" to delete due date of to do id (item 1 of argv)', "end run"];
const LIST_IDS: Record<string, string> = { today: "TMTodayListSource", anytime: "TMNextListSource", someday: "TMSomedayListSource" };

export interface ScriptCall {
	language: "JavaScript" | "AppleScript";
	/** One `-e` argument per line. */
	lines: string[];
	args: string[];
}

/** Which script does an action, and with what arguments. Rejects anything that isn't a Things id. */
export function actionCall(action: TodoAction, id: string, arg = ""): ScriptCall {
	if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error("Not a Things id");
	if (LIST_IDS[action]) return { language: "AppleScript", lines: MOVE_TO_LIST, args: [id, LIST_IDS[action]] };
	if (action === "deadline" && !arg) return { language: "AppleScript", lines: CLEAR_DEADLINE, args: [id] };
	return { language: "JavaScript", lines: [ACTION_SCRIPT], args: [action, id, arg] };
}

export type TodoAction = "complete" | "reopen" | "cancel" | "today" | "anytime" | "someday" | "date" | "deadline" | "project" | "area" | "trash";

export type JxaFailure = "not-mac" | "no-permission" | "not-installed" | "gone" | "timeout" | "other";

/** Turns osascript's error text into something the window can explain. */
export function classifyError(message: string): JxaFailure {
	if (/-1743|not authori[sz]ed|Not allowed to send Apple events/i.test(message)) return "no-permission";
	// -2700 is any thrown error, so the app-missing case is told apart by its text.
	if (/-10814|Application can.t be found|Can.t get application/i.test(message)) return "not-installed";
	if (/Can.t get object|-1728/i.test(message)) return "gone";
	if (/ETIMEDOUT|timed out|killed/i.test(message)) return "timeout";
	return "other";
}
