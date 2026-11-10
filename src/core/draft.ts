/** The "send to Things" draft (T4): prefilled from the note, edited, then added by URL. */

import { addDays } from "./dates";

export interface TodoDraft {
	title: string;
	notes: string;
	/** A project or area title; null sends it to the Inbox. */
	list: string | null;
	/** YYYY-MM-DD, or "today" / "tomorrow" / "evening" / "someday"; null leaves it unscheduled. */
	when: string | null;
	deadline: string | null;
	tags: string[];
	/** Checklist lines; the first can be the first tiny step. */
	checklist: string[];
}

export interface DraftContext {
	selection: string;
	/** The heading the cursor is under, if any. */
	heading: string | null;
	noteTitle: string;
	/** `obsidian://open…` back to the note. */
	link: string;
	list: string | null;
	tags: string[];
}

const MARKER = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|#{1,6}\s+|>\s*)/;

/** Title from the selection's first line (or the heading, or the note), the rest into notes. */
export function draftFrom(c: DraftContext): TodoDraft {
	const lines = c.selection.split("\n").map((l) => l.replace(MARKER, "").trim()).filter(Boolean);
	const title = (lines[0] ?? c.heading ?? c.noteTitle).slice(0, 200);
	const rest = lines.slice(1).join("\n");
	return { title, notes: rest ? `${rest}\n\n${c.link}` : c.link, list: c.list, when: null, deadline: null, tags: c.tags, checklist: [] };
}

/** The start reminder for a deadline: `lead` days before, but never in the past. */
export function startFor(deadline: string, lead: number, today: string): string {
	const when = addDays(deadline, -lead);
	return when < today ? today : when;
}

export function addUrl(d: TodoDraft): string {
	const q: string[] = [`title=${encodeURIComponent(d.title)}`];
	if (d.notes) q.push(`notes=${encodeURIComponent(d.notes)}`);
	if (d.when) q.push(`when=${encodeURIComponent(d.when)}`);
	if (d.deadline) q.push(`deadline=${encodeURIComponent(d.deadline)}`);
	if (d.tags.length) q.push(`tags=${encodeURIComponent(d.tags.join(","))}`);
	if (d.list) q.push(`list=${encodeURIComponent(d.list)}`);
	if (d.checklist.length) q.push(`checklist-items=${encodeURIComponent(d.checklist.join("\n"))}`);
	return `things:///add?${q.join("&")}`;
}

/** A new project (only ever after you confirm it). */
export function addProjectUrl(p: { title: string; area: string | null; notes?: string }): string {
	const q = [`title=${encodeURIComponent(p.title)}`];
	if (p.area) q.push(`area=${encodeURIComponent(p.area)}`);
	if (p.notes) q.push(`notes=${encodeURIComponent(p.notes)}`);
	return `things:///add-project?${q.join("&")}`;
}

export function showUrl(id: string): string {
	return `things:///show?id=${encodeURIComponent(id)}`;
}

function codeRe(code: string): RegExp {
	return new RegExp(`(^|[^A-Za-z0-9])${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`, "i");
}

/** An existing project for a course: the exact title, or the one naming the course code. */
export function findProject(projects: { title: string }[], wanted: string | null, code: string | null): string | null {
	if (wanted && projects.some((p) => p.title === wanted)) return wanted;
	if (code) {
		const hits = projects.filter((p) => codeRe(code).test(p.title));
		if (hits.length === 1) return hits[0].title;
	}
	return null;
}

/** Existing tags naming the course code (course tags often look like "🔬 BIO2000"). */
export function courseTags(tags: string[], code: string | null): string[] {
	return code ? tags.filter((t) => codeRe(code).test(t)) : [];
}
