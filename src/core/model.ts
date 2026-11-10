/** Things data as the window uses it. Pure: fed with the JXA scripts' JSON. */

import { daysBetween } from "./dates";

export interface Todo {
	id: string;
	title: string;
	notes: string;
	/** Things' "When" (start date), YYYY-MM-DD. */
	when: string | null;
	deadline: string | null;
	tags: string[];
	project: string | null;
	area: string | null;
	/** A project scheduled for today shows in Today as a row of its own. */
	isProject?: boolean;
}

export interface Project {
	id: string;
	title: string;
	area: string | null;
	when: string | null;
	deadline: string | null;
	tags: string[];
	/** In Things' Someday list. */
	someday: boolean;
}

export interface Snapshot {
	running: boolean;
	/** Today, in the order you arranged it in Things. */
	today: Todo[];
	/** Every open to-do. */
	all: Todo[];
	/** Open projects. */
	projects: Project[];
	/** Ids of to-dos and projects in Someday. */
	someday: Set<string>;
	/** Each tag's parent tag, for tag hierarchies. */
	tagParents: Record<string, string | null>;
	/** Area names, in Things' order. */
	areas: string[];
}

export interface Lists {
	running: boolean;
	projects: { title: string; area: string | null }[];
	areas: string[];
	tags: string[];
}

function str(v: unknown): string | null {
	return typeof v === "string" && v !== "" ? v : null;
}

function todo(raw: unknown): Todo | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	const id = str(r.id);
	if (!id) return null;
	const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
	return {
		id,
		title: typeof r.title === "string" ? r.title : "",
		notes: typeof r.notes === "string" ? r.notes : "",
		when: date(r.when),
		deadline: date(r.deadline),
		tags: typeof r.tags === "string" ? r.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
		project: str(r.project),
		area: str(r.area),
		...(r.isProject === true ? { isProject: true } : {}),
	};
}

export function parseSnapshot(json: string): Snapshot {
	const o = JSON.parse(json) as Record<string, unknown>;
	if (o.v !== 1) throw new Error("Unexpected reply from Things");
	const list = (v: unknown) => (Array.isArray(v) ? v.map(todo).filter((t): t is Todo => t !== null) : []);
	const all = list(o.all);
	const byId = new Map(all.map((t) => [t.id, t]));
	const today = Array.isArray(o.todayIds) ? o.todayIds.flatMap((id) => (typeof id === "string" && byId.has(id) ? [byId.get(id) as Todo] : [])) : [];
	const someday = new Set(Array.isArray(o.somedayIds) ? o.somedayIds.filter((x): x is string => typeof x === "string") : []);
	const projects = Array.isArray(o.projects)
		? o.projects.flatMap((p: unknown): Project[] => {
				const t = todo(p);
				return t ? [{ id: t.id, title: t.title, area: t.area, when: t.when, deadline: t.deadline, tags: t.tags, someday: someday.has(t.id) }] : [];
			})
		: [];
	const tagParents: Record<string, string | null> = {};
	if (o.tagParents && typeof o.tagParents === "object") {
		for (const [k, v] of Object.entries(o.tagParents as Record<string, unknown>)) tagParents[k] = typeof v === "string" && v ? v : null;
	}
	// Today's other rows are to-dos; Things only keeps them out of `all` when they are projects.
	const areas = Array.isArray(o.areas) ? o.areas.filter((x): x is string => typeof x === "string" && x !== "") : [];
	return { running: o.running === true, today, all: all.filter((t) => !t.isProject), projects, someday, tagParents, areas };
}

export function parseLists(json: string): Lists {
	const o = JSON.parse(json) as Record<string, unknown>;
	if (o.v !== 1) throw new Error("Unexpected reply from Things");
	const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
	const projects = Array.isArray(o.projects)
		? o.projects.flatMap((p: unknown) => {
				const r = p as Record<string, unknown>;
				const title = str(r?.title);
				return title ? [{ title, area: str(r.area) }] : [];
			})
		: [];
	return { running: o.running === true, projects, areas: strings(o.areas), tags: strings(o.tags) };
}

// ----- links back to notes -----

export interface NoteLink {
	vault: string | null;
	/** Vault path without the .md extension, as `obsidian://open` writes it. */
	file: string;
}

/** `obsidian://open?vault=…&file=…` links in a to-do's notes. */
export function noteLinks(notes: string): NoteLink[] {
	const out: NoteLink[] = [];
	for (const m of notes.matchAll(/obsidian:\/\/open\?([^\s)\]>"]+)/g)) {
		const params = new Map<string, string>();
		for (const pair of m[1].split("&")) {
			const at = pair.indexOf("=");
			if (at < 0) continue;
			try {
				params.set(pair.slice(0, at), decodeURIComponent(pair.slice(at + 1).replace(/\+/g, "%20")));
			} catch {
				// A malformed escape: skip this parameter.
			}
		}
		const file = params.get("file");
		if (file) out.push({ vault: params.get("vault") ?? null, file: file.replace(/\.md$/, "") });
	}
	return out;
}

/** The note in this vault a to-do links to (vault path without .md), if any. */
export function linkedFile(t: Todo, vault: string): string | null {
	return noteLinks(t.notes).find((l) => l.vault === null || l.vault === vault)?.file ?? null;
}

/** Open to-dos that link to `path` (with or without .md) in this vault. */
export function linkedTo(all: Todo[], vault: string, path: string): Todo[] {
	const target = path.replace(/\.md$/, "");
	return all.filter((t) => noteLinks(t.notes).some((l) => (l.vault === null || l.vault === vault) && l.file === target));
}

export function obsidianLink(vault: string, path: string): string {
	return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(path.replace(/\.md$/, ""))}`;
}

// ----- the window -----

export interface Window {
	/** The first to-do in Today: one thing, shown large (D1). */
	now: Todo | null;
	next: Todo[];
	later: Todo[];
	/** Deadlines in the coming days that aren't already in Today, soonest first. */
	deadlines: (Todo & { days: number })[];
}

export function windowOf(s: Snapshot, today: string, days = 7, nextCount = 3, withProjects = false): Window {
	const inToday = new Set(s.today.map((t) => t.id));
	// To-dos only, unless you choose otherwise: a project scheduled for today shows in the Projects tab.
	const todos = withProjects ? s.today : s.today.filter((t) => !t.isProject);
	const deadlines = s.all
		.filter((t) => t.deadline && !inToday.has(t.id))
		.map((t) => ({ ...t, days: daysBetween(today, t.deadline as string) }))
		.filter((t) => t.days >= 1 && t.days <= days)
		.sort((a, b) => a.days - b.days || a.title.localeCompare(b.title));
	return { now: todos[0] ?? null, next: todos.slice(1, 1 + nextCount), later: todos.slice(1 + nextCount), deadlines };
}

/** The area a to-do belongs to: its own, or its project's. */
export function areaOf(t: Todo, projects: Map<string, Project>): string | null {
	return t.area ?? (t.project ? (projects.get(t.project)?.area ?? null) : null);
}

/** The snapshot as one area sees it: its to-dos (directly or through a project) and its projects. */
export function filterByArea(s: Snapshot, area: string | null): Snapshot {
	if (!area) return s;
	const projects = new Map(s.projects.map((p) => [p.title, p]));
	const keep = (t: Todo) => areaOf(t, projects) === area;
	return { ...s, today: s.today.filter(keep), all: s.all.filter(keep), projects: s.projects.filter((p) => p.area === area) };
}

/** Where a to-do lives, for its subtitle. */
export function placeOf(t: Todo): string | null {
	return t.project ?? t.area;
}
