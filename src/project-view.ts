import type { ViewStateResult, WorkspaceLeaf } from "obsidian";

import { ThingsBase } from "./base";
import type { Snapshot } from "./core/model";
import type ThingsBridge from "./main";
import { renderProjectTasks } from "./rows";

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
		renderProjectTasks(this.plugin, c, s, project, this.title);
	}
}
