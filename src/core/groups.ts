/**
 * Below the top tasks, the rest of Today grouped the way you choose (by project, area → project,
 * or tag → tag), and the projects that have something today. Groups keep Things' Today order: a
 * group sits where its first to-do was, so your own prioritising in Things still shows.
 */

import type { Project, Snapshot, Todo } from "./model";

export type GroupBy = "none" | "project" | "area" | "tag";

export interface Group {
	key: string;
	title: string;
	kind: "project" | "area" | "tag" | "loose";
	/** A project group's id, so its view can be opened. */
	projectId: string | null;
	todos: Todo[];
	children: Group[];
}

function group(key: string, title: string, kind: Group["kind"], projectId: string | null = null): Group {
	return { key, title, kind, projectId, todos: [], children: [] };
}

/** Adds `t` to the group `key` in `list`, creating it (in arrival order) if needed. */
function into(list: Group[], make: () => Group, key: string): Group {
	let g = list.find((x) => x.key === key);
	if (!g) {
		g = make();
		list.push(g);
	}
	return g;
}

export function groupTodos(todos: Todo[], by: GroupBy, s: Pick<Snapshot, "projects" | "tagParents">): Group[] {
	if (by === "none") return [];
	const projects = new Map(s.projects.map((p) => [p.title, p]));
	const projectGroup = (title: string) => group(`p:${title}`, title, "project", projects.get(title)?.id ?? null);
	const out: Group[] = [];
	for (const t of todos) {
		const projectTitle = t.isProject ? t.title : t.project;
		if (by === "project") {
			const g = projectTitle
				? into(out, () => projectGroup(projectTitle), `p:${projectTitle}`)
				: t.area
					? into(out, () => group(`a:${t.area as string}`, t.area as string, "area"), `a:${t.area}`)
					: into(out, () => group("loose", "No project or area", "loose"), "loose");
			g.todos.push(t);
		} else if (by === "area") {
			const area = t.area ?? (projectTitle ? (projects.get(projectTitle)?.area ?? null) : null);
			const top = area ? into(out, () => group(`a:${area}`, area, "area"), `a:${area}`) : into(out, () => group("loose", "No area", "loose"), "loose");
			if (projectTitle) into(top.children, () => projectGroup(projectTitle), `p:${projectTitle}`).todos.push(t);
			else top.todos.push(t);
		} else {
			const tag = t.tags[0];
			if (!tag) {
				into(out, () => group("loose", "No tag", "loose"), "loose").todos.push(t);
				continue;
			}
			const parent = s.tagParents[tag] ?? null;
			if (parent) {
				const top = into(out, () => group(`t:${parent}`, parent, "tag"), `t:${parent}`);
				into(top.children, () => group(`t:${tag}`, tag, "tag"), `t:${tag}`).todos.push(t);
			} else {
				into(out, () => group(`t:${tag}`, tag, "tag"), `t:${tag}`).todos.push(t);
			}
		}
	}
	return out;
}

/** How many to-dos a group holds, its subgroups included. */
export function countOf(g: Group): number {
	return g.todos.length + g.children.reduce((n, c) => n + countOf(c), 0);
}

// ----- projects -----

export interface ProjectToday {
	title: string;
	/** Null for a project name Things didn't list (it was just completed, say). */
	project: Project | null;
	area: string | null;
	/** Its to-dos in Today, in Today's order. */
	today: Todo[];
	/** The project itself is scheduled for today. */
	scheduled: boolean;
	/** All its open to-dos. */
	open: number;
	nextDeadline: string | null;
}

/**
 * Projects with something in Today, in the order they first appear there: those scheduled for
 * today first (they show here, not among Today's to-dos), then those with to-dos in Today.
 */
export function projectsToday(s: Snapshot): ProjectToday[] {
	const projects = new Map(s.projects.map((p) => [p.title, p]));
	const out: ProjectToday[] = [];
	for (const t of s.today) {
		const title = t.isProject ? t.title : t.project;
		if (!title) continue;
		let row = out.find((r) => r.title === title);
		if (!row) {
			const p = projects.get(title) ?? null;
			const own = s.all.filter((x) => x.project === title);
			const deadlines = [p?.deadline ?? null, ...own.map((x) => x.deadline)].filter((d): d is string => !!d).sort();
			row = { title, project: p, area: p?.area ?? t.area, today: [], scheduled: false, open: own.length, nextDeadline: deadlines[0] ?? null };
			out.push(row);
		}
		if (t.isProject) row.scheduled = true;
		else row.today.push(t);
	}
	return [...out.filter((r) => r.scheduled), ...out.filter((r) => !r.scheduled)];
}

/** Every other active project (not in Someday), by area in the order Things lists them. */
export function otherProjects(s: Snapshot, exclude: Set<string>): { area: string | null; projects: Project[] }[] {
	const out: { area: string | null; projects: Project[] }[] = [];
	for (const p of s.projects) {
		if (p.someday || exclude.has(p.title)) continue;
		let g = out.find((x) => x.area === p.area);
		if (!g) {
			g = { area: p.area, projects: [] };
			out.push(g);
		}
		g.projects.push(p);
	}
	return out;
}

export interface ProjectTasks {
	today: Todo[];
	/** Scheduled for a later day, soonest first. */
	upcoming: Todo[];
	anytime: Todo[];
	someday: Todo[];
}

/** One project's open to-dos, split the way Things splits them. */
export function projectTasks(s: Snapshot, title: string, today: string): ProjectTasks {
	const order = new Map(s.today.map((t, i) => [t.id, i]));
	const out: ProjectTasks = { today: [], upcoming: [], anytime: [], someday: [] };
	for (const t of s.all) {
		if (t.project !== title) continue;
		if (order.has(t.id)) out.today.push(t);
		else if (s.someday.has(t.id)) out.someday.push(t);
		else if (t.when && t.when > today) out.upcoming.push(t);
		else out.anytime.push(t);
	}
	out.today.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
	out.upcoming.sort((a, b) => (a.when as string).localeCompare(b.when as string) || (a.deadline ?? "9").localeCompare(b.deadline ?? "9"));
	return out;
}

// ----- tabs -----

export interface ProjectTab {
	project: Project;
	/** Its to-dos in Today. */
	today: number;
	/** The project itself is scheduled for today. */
	scheduled: boolean;
}

/**
 * The projects a row of tabs shows: every active project (or one area's), Someday left out. With
 * `todayFirst`, projects with something today come first; otherwise Things' own order.
 */
export function projectTabs(s: Snapshot, area: string | null, todayFirst: boolean): ProjectTab[] {
	const inToday = new Map<string, { today: number; scheduled: boolean }>();
	for (const t of s.today) {
		const title = t.isProject ? t.title : t.project;
		if (!title) continue;
		const e = inToday.get(title) ?? { today: 0, scheduled: false };
		if (t.isProject) e.scheduled = true;
		else e.today++;
		inToday.set(title, e);
	}
	const tabs = s.projects
		.filter((p) => !p.someday && (area === null || p.area === area))
		.map((p) => ({ project: p, today: inToday.get(p.title)?.today ?? 0, scheduled: inToday.get(p.title)?.scheduled ?? false }));
	if (!todayFirst) return tabs;
	const busy = (t: ProjectTab) => t.scheduled || t.today > 0;
	return [...tabs.filter(busy), ...tabs.filter((t) => !busy(t))];
}

/** An area's own to-dos, the ones in no project. */
export function looseTodos(s: Snapshot, area: string): Todo[] {
	return s.all.filter((t) => !t.project && t.area === area);
}

export interface DeadlineItem {
	date: string;
	/** Days from today; negative when overdue. */
	days: number;
	todo: Todo | null;
	/** Set when the deadline is a project's own. */
	project: Project | null;
}

/** Every deadline, to-dos' and projects', soonest first; overdue ones on top. */
export function deadlineList(s: Snapshot, today: string): DeadlineItem[] {
	const day = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
	const items: DeadlineItem[] = [
		...s.all.filter((t) => t.deadline && !s.someday.has(t.id)).map((t) => ({ date: t.deadline as string, days: day(t.deadline as string), todo: t, project: null })),
		...s.projects.filter((p) => p.deadline && !p.someday).map((p) => ({ date: p.deadline as string, days: day(p.deadline as string), todo: null, project: p })),
	];
	return items.sort((a, b) => a.days - b.days || (a.project ? 0 : 1) - (b.project ? 0 : 1) || (a.todo?.title ?? a.project?.title ?? "").localeCompare(b.todo?.title ?? b.project?.title ?? ""));
}
