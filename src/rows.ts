import { setIcon } from "obsidian";

import { countOf, projectTasks, type Group } from "./core/groups";
import { localToday } from "./core/dates";
import { linkedFile, placeOf, type Project, type Snapshot, type Todo } from "./core/model";
import { showUrl } from "./core/draft";
import type ThingsBridge from "./main";

export const DAY = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

export function dayLabel(iso: string): string {
	return DAY.format(new Date(`${iso}T12:00:00`));
}

export interface RowOptions {
	large?: boolean;
	/** Replaces the deadline in the meta line, e.g. "In 2 days · Fri 14 Mar". */
	when?: string;
	/** Leave the project/area out of the meta line (it's already the heading). */
	hidePlace?: boolean;
	/** Leave the deadline out (a heading already gives the date). */
	hideDeadline?: boolean;
}

/**
 * One to-do: tick to complete in Things (with a few seconds to undo), title to show it in Things,
 * right-click for Things' usual actions, a chip for its linked note. A project scheduled for
 * today opens its project tab instead.
 */
export function renderRow(plugin: ThingsBridge, parent: HTMLElement, t: Todo, o: RowOptions = {}): void {
	const row = parent.createDiv({ cls: o.large ? "things-bridge-row is-large" : "things-bridge-row" });
	if (t.isProject) {
		const icon = row.createSpan({ cls: "things-bridge-project-icon" });
		setIcon(icon, "folder-open");
		const text = row.createDiv({ cls: "things-bridge-text" });
		const title = text.createEl("a", { cls: "things-bridge-title", text: t.title || "Untitled project", attr: { "aria-label": "Open this project" } });
		title.addEventListener("click", () => void plugin.showProject(t.id, t.title));
		text.createDiv({ cls: "things-bridge-meta", text: ["Project scheduled for today", t.area].filter(Boolean).join(" · ") });
		return;
	}
	row.addEventListener("contextmenu", (e) => {
		e.preventDefault();
		plugin.todoMenu(e, t);
	});
	const doneAt = plugin.justDone.get(t.id);
	const box = row.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox", attr: { "aria-label": `Complete “${t.title}” in Things` } });
	box.checked = doneAt !== undefined;
	box.addEventListener("change", () => void plugin.toggle(t, box.checked));
	const text = row.createDiv({ cls: "things-bridge-text" });
	const title = text.createEl("a", { cls: "things-bridge-title", text: t.title || "Untitled", attr: { "aria-label": "Show in Things. Right-click for more." } });
	if (doneAt !== undefined) row.addClass("is-done");
	title.addEventListener("click", () => plugin.openUrl(showUrl(t.id)));
	const meta = text.createDiv({ cls: "things-bridge-meta" });
	if (o.when) meta.createSpan({ text: o.when });
	else if (t.deadline && !o.hideDeadline) meta.createSpan({ cls: "things-bridge-deadline", text: `Due ${dayLabel(t.deadline)}` });
	const place = placeOf(t);
	if (place && !o.hidePlace) {
		const p = meta.createEl(t.project ? "a" : "span", { cls: t.project ? "things-bridge-place" : "", text: place });
		if (t.project) {
			p.setAttr("aria-label", "Open this project");
			p.addEventListener("click", () => void plugin.showProjectByTitle(t.project as string));
		}
	}
	const note = linkedFile(t, plugin.app.vault.getName());
	if (note) {
		const chip = meta.createEl("a", { cls: "things-bridge-chip", text: note.split("/").pop() ?? note, attr: { "aria-label": "Open the linked note" } });
		chip.addEventListener("click", () => void plugin.openNote(note));
	}
	if (doneAt !== undefined) {
		const undo = meta.createEl("a", { cls: "things-bridge-undo", text: "Undo" });
		undo.addEventListener("click", () => void plugin.toggle(t, false));
	}
}

/** Groups as foldable sections; a project group has a button that opens its project tab. */
export function renderGroups(plugin: ThingsBridge, parent: HTMLElement, groups: Group[], open: boolean, depth = 0): void {
	for (const g of groups) {
		const sec = parent.createEl("details", { cls: `things-bridge-group depth-${depth}` });
		sec.open = open;
		const summary = sec.createEl("summary");
		summary.createSpan({ cls: "things-bridge-group-title", text: g.title });
		summary.createSpan({ cls: "things-bridge-count", text: String(countOf(g)) });
		if (g.kind === "project") {
			const b = summary.createEl("button", { cls: "clickable-icon things-bridge-open", attr: { "aria-label": `Open ${g.title}` } });
			setIcon(b, "panel-right-open");
			b.addEventListener("click", (e) => {
				e.preventDefault();
				void plugin.showProject(g.projectId, g.title);
			});
		}
		const body = sec.createDiv({ cls: "things-bridge-rows" });
		for (const t of g.todos) renderRow(plugin, body, t, { hidePlace: g.kind === "project" || g.kind === "area" });
		if (g.children.length) renderGroups(plugin, sec, g.children, open, depth + 1);
	}
}

export interface StripItem {
	id: string;
	label: string;
	/** A small number after the label (to-dos today); hidden when 0. */
	count?: number;
	/** Marks something scheduled for today. */
	dot?: boolean;
}

/**
 * A row of tabs that scrolls sideways (the finance hub's pattern): no scrollbar, the selected tab
 * kept in view, and a mouse wheel scrolls it sideways too.
 */
export function renderStrip(parent: HTMLElement, cls: string, items: StripItem[], selected: string, onSelect: (id: string) => void): HTMLElement {
	const strip = parent.createDiv({ cls: `things-bridge-strip ${cls}`, attr: { role: "tablist" } });
	let active: HTMLElement | null = null;
	for (const it of items) {
		const on = it.id === selected;
		const b = strip.createEl("button", { cls: on ? "things-bridge-tab is-active" : "things-bridge-tab", attr: { role: "tab", "aria-selected": String(on) } });
		if (it.dot) b.createSpan({ cls: "things-bridge-dot", attr: { "aria-label": "Scheduled for today" } });
		b.createSpan({ text: it.label });
		if (it.count) b.createSpan({ cls: "things-bridge-badge", text: String(it.count) });
		b.addEventListener("click", () => onSelect(it.id));
		if (on) active = b;
	}
	strip.addEventListener(
		"wheel",
		(e) => {
			if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && strip.scrollWidth > strip.clientWidth) {
				strip.scrollLeft += e.deltaY;
				e.preventDefault();
			}
		},
		{ passive: false },
	);
	const target: HTMLElement | null = active;
	if (target) window.requestAnimationFrame(() => target.scrollIntoView({ block: "nearest", inline: "nearest" }));
	return strip;
}

/** One project's to-dos: Today, Upcoming by date, Anytime, Someday folded away. */
export function renderProjectTasks(plugin: ThingsBridge, c: HTMLElement, s: Snapshot, project: Project | null, title: string): void {
	const meta = c.createDiv({ cls: "things-bridge-meta things-bridge-project-meta" });
	if (project?.area) meta.createSpan({ text: project.area });
	if (project?.deadline) meta.createSpan({ cls: "things-bridge-deadline", text: `Project due ${dayLabel(project.deadline)}` });
	if (project?.someday) meta.createSpan({ text: "In Someday" });
	if (!project && !s.all.some((t) => t.project === title)) {
		c.createEl("p", { cls: "things-bridge-muted", text: "This project isn't open in Things any more. It may have been completed, renamed or deleted." });
		return;
	}
	const tasks = projectTasks(s, title, localToday());
	const section = (heading: string, rows: Todo[], when?: (t: Todo) => string | undefined) => {
		if (!rows.length) return;
		const sec = c.createDiv({ cls: "things-bridge-section" });
		sec.createEl("h4", { text: `${heading} (${rows.length})` });
		const list = sec.createDiv({ cls: "things-bridge-rows" });
		for (const t of rows) renderRow(plugin, list, t, { hidePlace: true, when: when?.(t) });
	};
	section("Today", tasks.today);
	section("Upcoming", tasks.upcoming, (t) => [t.when ? `Starts ${dayLabel(t.when)}` : null, t.deadline ? `due ${dayLabel(t.deadline)}` : null].filter(Boolean).join(", "));
	section("Anytime", tasks.anytime);
	if (tasks.someday.length) {
		const more = c.createEl("details", { cls: "things-bridge-section" });
		more.createEl("summary", { text: `Someday (${tasks.someday.length})` });
		const list = more.createDiv({ cls: "things-bridge-rows" });
		for (const t of tasks.someday) renderRow(plugin, list, t, { hidePlace: true });
	}
	if (!tasks.today.length && !tasks.upcoming.length && !tasks.anytime.length && !tasks.someday.length) {
		c.createEl("p", { cls: "things-bridge-muted", text: project && s.today.some((t) => t.isProject && t.id === project.id) ? "Scheduled for today, with no open to-dos." : "Nothing open in this project." });
	}
}
