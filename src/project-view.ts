import type { ViewStateResult, WorkspaceLeaf } from "obsidian";

import { ThingsBase } from "./base";
import { localToday } from "./core/dates";
import { projectTasks } from "./core/groups";
import type { Snapshot } from "./core/model";
import type ThingsBridge from "./main";
import { dayLabel, renderRow } from "./rows";

export const PROJECT_VIEW_TYPE = "things-bridge-project";

/** One project's to-dos: Today first, then Upcoming by date, Anytime, and Someday folded away. */
export class ProjectView extends ThingsBase {
	projectId: string | null = null;
	title = "";

	constructor(leaf: WorkspaceLeaf, protected readonly plugin: ThingsBridge) {
		super(leaf);
	}

	getViewType(): string {
		return PROJECT_VIEW_TYPE;
	}
	getDisplayText(): string {
		return this.title || "Things project";
	}
	override getIcon(): string {
		return "folder-open";
	}

	override getState(): Record<string, unknown> {
		return { ...super.getState(), id: this.projectId, title: this.title };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const s = (state ?? {}) as { id?: unknown; title?: unknown };
		this.projectId = typeof s.id === "string" ? s.id : null;
		this.title = typeof s.title === "string" ? s.title : "";
		await super.setState(state, result);
		this.render();
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass("things-bridge-window", "things-bridge-project");
		await super.onOpen();
	}

	protected renderHead(c: HTMLElement): void {
		const head = c.createDiv({ cls: "things-bridge-head" });
		head.createEl("h3", { text: this.title || "Project" });
		const tools = head.createDiv({ cls: "things-bridge-tools" });
		this.addTool(tools, "plus", "Add a to-do to this project", () => this.plugin.sendTo(this.title));
		this.addTool(tools, this.busy ? "loader" : "refresh-cw", "Refresh", () => void this.refresh(true));
		if (this.projectId) this.addTool(tools, "external-link", "Show in Things", () => this.plugin.openUrl(`things:///show?id=${encodeURIComponent(this.projectId as string)}`));
	}

	protected renderBody(c: HTMLElement, s: Snapshot): void {
		const project = s.projects.find((p) => p.id === this.projectId) ?? s.projects.find((p) => p.title === this.title) ?? null;
		if (project && project.title !== this.title) this.title = project.title;
		const meta = c.createDiv({ cls: "things-bridge-meta things-bridge-project-meta" });
		if (project?.area) meta.createSpan({ text: project.area });
		if (project?.deadline) meta.createSpan({ cls: "things-bridge-deadline", text: `Project due ${dayLabel(project.deadline)}` });
		if (project?.someday) meta.createSpan({ text: "In Someday" });
		if (!project && !s.all.some((t) => t.project === this.title)) {
			c.createEl("p", { cls: "things-bridge-muted", text: "This project isn't open in Things any more. It may have been completed, renamed or deleted." });
			return;
		}
		const today = localToday();
		const tasks = projectTasks(s, this.title, today);
		const section = (title: string, rows: typeof tasks.today, when?: (t: (typeof tasks.today)[number]) => string | undefined) => {
			if (!rows.length) return;
			const sec = c.createDiv({ cls: "things-bridge-section" });
			sec.createEl("h4", { text: `${title} (${rows.length})` });
			const list = sec.createDiv({ cls: "things-bridge-rows" });
			for (const t of rows) renderRow(this.plugin, list, t, { hidePlace: true, when: when?.(t) });
		};
		section("Today", tasks.today);
		section("Upcoming", tasks.upcoming, (t) => [t.when ? `Starts ${dayLabel(t.when)}` : null, t.deadline ? `due ${dayLabel(t.deadline)}` : null].filter(Boolean).join(", "));
		section("Anytime", tasks.anytime);
		if (tasks.someday.length) {
			const more = c.createEl("details", { cls: "things-bridge-section" });
			more.createEl("summary", { text: `Someday (${tasks.someday.length})` });
			const list = more.createDiv({ cls: "things-bridge-rows" });
			for (const t of tasks.someday) renderRow(this.plugin, list, t, { hidePlace: true });
		}
		if (!tasks.today.length && !tasks.upcoming.length && !tasks.anytime.length && !tasks.someday.length) {
			c.createEl("p", { cls: "things-bridge-muted", text: "Nothing open in this project." });
		}
	}
}
