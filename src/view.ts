import { setIcon, type ViewStateResult, type WorkspaceLeaf } from "obsidian";

import { ThingsBase } from "./base";
import { localToday } from "./core/dates";
import { deadlineList, groupTodos, looseTodos, projectTabs } from "./core/groups";
import { linkedTo, windowOf, type Snapshot, type Todo } from "./core/model";
import type ThingsBridge from "./main";
import { dayLabel, renderGroups, renderProjectTasks, renderRow, renderStrip, type StripItem } from "./rows";

export const VIEW_TYPE = "things-bridge-window";

export function areaTab(area: string): string {
	return `area:${area}`;
}

const GROUP_WORDS = { none: "", project: "by project", area: "by area and project", tag: "by tag" } as const;

/**
 * The Things hub. A sideways-scrolling row of tabs along the top (Today, Deadlines, Projects, then
 * one per area, as set in settings); Projects and each area have a second row with one tab per
 * project, whose to-dos show underneath.
 */
export class ThingsView extends ThingsBase {
	tab: string;
	/** The project tab picked in each top tab ("loose" for an area's own to-dos). */
	private selected: Record<string, string>;

	constructor(leaf: WorkspaceLeaf, protected readonly plugin: ThingsBridge) {
		super(leaf);
		this.tab = plugin.prefs.tab || "today";
		this.selected = { ...plugin.prefs.selectedProject };
	}

	getViewType(): string {
		return VIEW_TYPE;
	}
	getDisplayText(): string {
		return this.plugin.prefs.separateWindows ? `Things · ${this.plugin.tabLabel(this.tab)}` : "Things";
	}
	override getIcon(): string {
		return "check-circle";
	}

	override getState(): Record<string, unknown> {
		return { ...super.getState(), tab: this.tab };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const s = (state ?? {}) as { tab?: unknown };
		if (typeof s.tab === "string" && s.tab) this.tab = s.tab;
		await super.setState(state, result);
		this.render();
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass("things-bridge-window");
		await super.onOpen();
	}

	async showTab(id: string): Promise<void> {
		this.tab = id;
		this.plugin.prefs.tab = id;
		await this.plugin.save();
		this.app.workspace.requestSaveLayout();
		this.render();
	}

	selectProject(scope: string, id: string): void {
		this.selected[scope] = id;
		this.plugin.prefs.selectedProject[scope] = id;
		void this.plugin.save();
		this.render();
	}

	protected renderHead(c: HTMLElement): void {
		const bar = c.createDiv({ cls: "things-bridge-tabbar" });
		const tabs = this.plugin.visibleTabs();
		if (tabs.length && !tabs.some((t) => t.id === this.tab)) this.tab = tabs[0].id;
		renderStrip(bar, "is-top", tabs, this.tab, (id) => void this.showTab(id));
		const tools = bar.createDiv({ cls: "things-bridge-tools" });
		this.addTool(tools, this.busy ? "loader" : "refresh-cw", "Refresh", () => void this.refresh(true));
		this.addTool(tools, "external-link", "Open Things", () => this.plugin.openUrl("things:///show?id=today"));
	}

	protected renderBody(c: HTMLElement, s: Snapshot): void {
		if (this.tab === "deadlines") this.renderDeadlines(c, s);
		else if (this.tab === "projects") this.renderProjects(c, s, null, "projects");
		else if (this.tab.startsWith("area:")) this.renderProjects(c, s, this.tab.slice(5), this.tab);
		else this.renderToday(c, s);
	}

	// ----- Today -----

	private renderToday(c: HTMLElement, s: Snapshot): void {
		const p = this.plugin.prefs;
		const w = windowOf(s, localToday(), p.deadlineDays, p.nextCount, p.projectsInToday);
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
		if (p.deadlineDays > 0 && w.deadlines.length) {
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

	// ----- Deadlines -----

	private renderDeadlines(c: HTMLElement, s: Snapshot): void {
		const items = deadlineList(s, localToday());
		if (!items.length) {
			c.createEl("p", { cls: "things-bridge-muted", text: "No deadlines in Things." });
			return;
		}
		let key = "";
		let rows: HTMLElement | null = null;
		for (const it of items) {
			const k = it.days < 0 ? "overdue" : it.date;
			if (k !== key || !rows) {
				key = k;
				const sec = c.createDiv({ cls: "things-bridge-section" });
				const heading = it.days < 0 ? "Overdue" : it.days === 0 ? `Today · ${dayLabel(it.date)}` : it.days === 1 ? `Tomorrow · ${dayLabel(it.date)}` : `${dayLabel(it.date)} · in ${it.days} days`;
				sec.createEl("h4", { cls: it.days < 0 ? "things-bridge-overdue" : "", text: heading });
				rows = sec.createDiv({ cls: "things-bridge-rows" });
			}
			if (it.todo) {
				renderRow(this.plugin, rows, it.todo, { hideDeadline: it.days >= 0, when: it.days < 0 ? `Was due ${dayLabel(it.date)}` : undefined });
			} else if (it.project) {
				const p = it.project;
				const row = rows.createDiv({ cls: "things-bridge-row" });
				setIcon(row.createSpan({ cls: "things-bridge-project-icon" }), "folder-open");
				const text = row.createDiv({ cls: "things-bridge-text" });
				const a = text.createEl("a", { cls: "things-bridge-title", text: p.title });
				a.addEventListener("click", () => void this.plugin.showProject(p.id, p.title));
				text.createDiv({ cls: "things-bridge-meta", text: ["Project deadline", p.area].filter(Boolean).join(" · ") });
			}
		}
	}

	// ----- Projects and areas -----

	private renderProjects(c: HTMLElement, s: Snapshot, area: string | null, scope: string): void {
		const p = this.plugin.prefs;
		const tabs = projectTabs(s, area, p.projectOrder === "today-first");
		const inToday = new Set(s.today.map((t) => t.id));
		const loose = area ? looseTodos(s, area) : [];
		const items: StripItem[] = [];
		if (loose.length) items.push({ id: "loose", label: "No project", count: loose.filter((t) => inToday.has(t.id)).length });
		for (const t of tabs) items.push({ id: t.project.id, label: t.project.title, count: t.today, dot: t.scheduled });
		if (!items.length) {
			c.createEl("p", { cls: "things-bridge-muted", text: area ? `No active projects in ${area}.` : "No active projects in Things." });
			return;
		}
		let sel = this.selected[scope];
		if (!items.some((i) => i.id === sel)) sel = (items.find((i) => i.count || i.dot) ?? items[0]).id;
		renderStrip(c, "is-sub", items, sel, (id) => this.selectProject(scope, id));
		const body = c.createDiv({ cls: "things-bridge-tabbody" });
		if (sel === "loose" && area) {
			this.renderLoose(body, loose, inToday, area);
			return;
		}
		const tab = tabs.find((t) => t.project.id === sel);
		if (!tab) return;
		const tools = body.createDiv({ cls: "things-bridge-project-tools" });
		this.addTool(tools, "plus", "Add a to-do to this project", () => this.plugin.sendTo(tab.project.title));
		this.addTool(tools, "external-link", "Show in Things", () => this.plugin.openUrl(`things:///show?id=${encodeURIComponent(tab.project.id)}`));
		this.addTool(tools, "panel-right-open", "Open in its own tab", () => void this.plugin.openProject(tab.project.id, tab.project.title));
		renderProjectTasks(this.plugin, body, s, tab.project, tab.project.title);
	}

	private renderLoose(c: HTMLElement, loose: Todo[], inToday: Set<string>, area: string): void {
		const today = loose.filter((t) => inToday.has(t.id));
		const other = loose.filter((t) => !inToday.has(t.id));
		const tools = c.createDiv({ cls: "things-bridge-project-tools" });
		this.addTool(tools, "plus", `Add a to-do to ${area}`, () => this.plugin.sendTo(area));
		for (const [heading, rows] of [["Today", today], ["Other", other]] as const) {
			if (!rows.length) continue;
			const sec = c.createDiv({ cls: "things-bridge-section" });
			sec.createEl("h4", { text: `${heading} (${rows.length})` });
			const list = sec.createDiv({ cls: "things-bridge-rows" });
			for (const t of rows) renderRow(this.plugin, list, t, { hidePlace: true });
		}
	}
}
