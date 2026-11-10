import { setIcon } from "obsidian";

import { countOf, type Group } from "./core/groups";
import { linkedFile, placeOf, type Todo } from "./core/model";
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
}

/**
 * One to-do: tick to complete in Things (with a few seconds to undo), title to show it in Things,
 * a chip for its linked note. A project scheduled for today opens its project view instead.
 */
export function renderRow(plugin: ThingsBridge, parent: HTMLElement, t: Todo, o: RowOptions = {}): void {
	const row = parent.createDiv({ cls: o.large ? "things-bridge-row is-large" : "things-bridge-row" });
	if (t.isProject) {
		const icon = row.createSpan({ cls: "things-bridge-project-icon" });
		setIcon(icon, "folder-open");
		const text = row.createDiv({ cls: "things-bridge-text" });
		const title = text.createEl("a", { cls: "things-bridge-title", text: t.title || "Untitled project", attr: { "aria-label": "Open this project's view" } });
		title.addEventListener("click", () => void plugin.openProject(t.id, t.title));
		text.createDiv({ cls: "things-bridge-meta", text: ["Project scheduled for today", t.area].filter(Boolean).join(" · ") });
		return;
	}
	const doneAt = plugin.justDone.get(t.id);
	const box = row.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox", attr: { "aria-label": `Complete “${t.title}” in Things` } });
	box.checked = doneAt !== undefined;
	box.addEventListener("change", () => void plugin.toggle(t, box.checked));
	const text = row.createDiv({ cls: "things-bridge-text" });
	const title = text.createEl("a", { cls: "things-bridge-title", text: t.title || "Untitled", attr: { "aria-label": "Show in Things" } });
	if (doneAt !== undefined) row.addClass("is-done");
	title.addEventListener("click", () => plugin.openUrl(showUrl(t.id)));
	const meta = text.createDiv({ cls: "things-bridge-meta" });
	if (o.when) meta.createSpan({ text: o.when });
	else if (t.deadline) meta.createSpan({ cls: "things-bridge-deadline", text: `Due ${dayLabel(t.deadline)}` });
	const place = placeOf(t);
	if (place && !o.hidePlace) {
		const p = meta.createEl(t.project ? "a" : "span", { cls: t.project ? "things-bridge-place" : "", text: place });
		if (t.project) {
			p.setAttr("aria-label", "Open this project's view");
			p.addEventListener("click", () => void plugin.openProjectByTitle(t.project as string));
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

/** Groups as foldable sections; a project group has a button that opens its project view. */
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
				void plugin.openProject(g.projectId, g.title);
			});
		}
		const body = sec.createDiv({ cls: "things-bridge-rows" });
		for (const t of g.todos) renderRow(plugin, body, t, { hidePlace: g.kind === "project" || g.kind === "area" });
		if (g.children.length) renderGroups(plugin, sec, g.children, open, depth + 1);
	}
}
