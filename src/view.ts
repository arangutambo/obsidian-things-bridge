import type { WorkspaceLeaf } from "obsidian";

import { ThingsBase } from "./base";
import { localToday } from "./core/dates";
import { groupTodos, otherProjects, projectsToday } from "./core/groups";
import { linkedTo, windowOf, type Snapshot } from "./core/model";
import type ThingsBridge from "./main";
import { dayLabel, renderGroups, renderRow } from "./rows";

export const VIEW_TYPE = "things-bridge-window";

const GROUP_WORDS = { none: "", project: "by project", area: "by area and project", tag: "by tag" } as const;

/**
 * The Things window. **Today**: one to-do large, the next few in your Things order, then the rest
 * grouped the way you choose, the week's deadlines and the to-dos linked to the open note.
 * **Projects**: every project with something today, each opening its own view.
 */
export class ThingsView extends ThingsBase {
	constructor(leaf: WorkspaceLeaf, protected readonly plugin: ThingsBridge) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE;
	}
	getDisplayText(): string {
		return "Things";
	}
	override getIcon(): string {
		return "check-circle";
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass("things-bridge-window");
		await super.onOpen();
	}

	protected renderHead(c: HTMLElement): void {
		const head = c.createDiv({ cls: "things-bridge-head" });
		const tabs = head.createDiv({ cls: "things-bridge-tabs" });
		for (const [id, label] of [["today", "Today"], ["projects", "Projects"]] as const) {
			const b = tabs.createEl("button", { text: label, cls: this.plugin.prefs.tab === id ? "is-active" : "" });
			b.addEventListener("click", () => {
				this.plugin.prefs.tab = id;
				void this.plugin.save();
				this.render();
			});
		}
		const tools = head.createDiv({ cls: "things-bridge-tools" });
		this.addTool(tools, this.busy ? "loader" : "refresh-cw", "Refresh", () => void this.refresh(true));
		this.addTool(tools, "external-link", "Open Things", () => this.plugin.openUrl("things:///show?id=today"));
	}

	protected renderBody(c: HTMLElement, s: Snapshot): void {
		if (this.plugin.prefs.tab === "projects") this.renderProjects(c, s);
		else this.renderToday(c, s);
	}

	private renderToday(c: HTMLElement, s: Snapshot): void {
		const p = this.plugin.prefs;
		const w = windowOf(s, localToday(), p.deadlineDays, p.nextCount);
		if (w.now) {
			const card = c.createDiv({ cls: "things-bridge-now" });
			card.createDiv({ cls: "things-bridge-muted", text: "Now" });
			renderRow(this.plugin, card, w.now, { large: true });
		} else {
			c.createEl("p", { cls: "things-bridge-muted", text: "Today is empty in Things." });
		}
		if (w.next.length) {
			const next = c.createDiv({ cls: "things-bridge-rows" });
			for (const t of w.next) renderRow(this.plugin, next, t);
		}
		if (w.later.length) {
			const groups = groupTodos(w.later, p.groupBy, s);
			if (groups.length) {
				const sec = c.createDiv({ cls: "things-bridge-section" });
				sec.createEl("h4", { text: `The rest of today, ${GROUP_WORDS[p.groupBy]} (${w.later.length})` });
				renderGroups(this.plugin, sec, groups, p.groupsOpen);
			} else {
				const later = c.createEl("details", { cls: "things-bridge-section" });
				later.open = p.groupsOpen;
				later.createEl("summary", { text: `Later today (${w.later.length})` });
				const rows = later.createDiv({ cls: "things-bridge-rows" });
				for (const t of w.later) renderRow(this.plugin, rows, t);
			}
		}
		if (w.deadlines.length) {
			const sec = c.createDiv({ cls: "things-bridge-section" });
			sec.createEl("h4", { text: `Due in the next ${p.deadlineDays} days` });
			const rows = sec.createDiv({ cls: "things-bridge-rows" });
			for (const t of w.deadlines) renderRow(this.plugin, rows, t, { when: `${t.days === 1 ? "Tomorrow" : `In ${t.days} days`} · ${dayLabel(t.deadline as string)}` });
		}
		const active = this.app.workspace.getActiveFile();
		if (active) {
			const linked = linkedTo(s.all, this.app.vault.getName(), active.path);
			if (linked.length) {
				const sec = c.createDiv({ cls: "things-bridge-section" });
				sec.createEl("h4", { text: "Linked to this note" });
				const rows = sec.createDiv({ cls: "things-bridge-rows" });
				for (const t of linked) renderRow(this.plugin, rows, t);
			}
		}
	}

	private renderProjects(c: HTMLElement, s: Snapshot): void {
		const today = projectsToday(s);
		const sec = c.createDiv({ cls: "things-bridge-section" });
		sec.createEl("h4", { text: "Projects with something today" });
		if (!today.length) sec.createEl("p", { cls: "things-bridge-muted", text: "Nothing in Today belongs to a project." });
		const list = sec.createDiv({ cls: "things-bridge-rows" });
		for (const p of today) {
			const row = list.createDiv({ cls: "things-bridge-project-row" });
			const title = row.createEl("a", { cls: "things-bridge-title", text: p.title, attr: { "aria-label": "Open this project's view" } });
			title.addEventListener("click", () => void this.plugin.openProject(p.project?.id ?? null, p.title));
			const meta = row.createDiv({ cls: "things-bridge-meta" });
			if (p.area) meta.createSpan({ text: p.area });
			meta.createSpan({ text: p.scheduled && !p.today.length ? "Scheduled for today" : `${p.today.length} today` });
			meta.createSpan({ text: `${p.open} open` });
			if (p.nextDeadline) meta.createSpan({ cls: "things-bridge-deadline", text: `Due ${dayLabel(p.nextDeadline)}` });
			if (p.today.length) {
				const peek = row.createDiv({ cls: "things-bridge-peek" });
				for (const t of p.today.slice(0, 3)) peek.createDiv({ cls: "things-bridge-muted", text: `· ${t.title}` });
				if (p.today.length > 3) peek.createDiv({ cls: "things-bridge-muted", text: `· and ${p.today.length - 3} more` });
			}
		}
		const others = otherProjects(s, new Set(today.map((p) => p.title)));
		if (others.length) {
			const more = c.createEl("details", { cls: "things-bridge-section" });
			more.createEl("summary", { text: `Other active projects (${others.reduce((n, g) => n + g.projects.length, 0)})` });
			for (const g of others) {
				more.createEl("h4", { cls: "things-bridge-area", text: g.area ?? "No area" });
				const rows = more.createDiv({ cls: "things-bridge-rows" });
				for (const p of g.projects) {
					const a = rows.createEl("a", { cls: "things-bridge-title", text: p.title });
					a.addEventListener("click", () => void this.plugin.openProject(p.id, p.title));
				}
			}
		}
	}
}
