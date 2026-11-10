import { Modal, Notice, Plugin, PluginSettingTab, Setting, SuggestModal, TFile, type App, type Editor } from "obsidian";

import { THINGS_BRIDGE_API_VERSION, type ThingsBridgeApi, type TodoInfo } from "./api-types";
import { addDays, localToday } from "./core/dates";
import { addProjectUrl, addUrl, type DraftContext, type TodoDraft } from "./core/draft";
import { LISTS_SCRIPT, READ_SCRIPT, STATUS_SCRIPT } from "./core/jxa";
import type { GroupBy } from "./core/groups";
import { linkedFile, obsidianLink, parseLists, parseSnapshot, type Lists, type Project, type Snapshot, type Todo } from "./core/model";
import { ThingsBase } from "./base";
import { PROJECT_VIEW_TYPE, ProjectView } from "./project-view";
import { canRead, explain, runJxa } from "./mac";
import { SendModal } from "./send";
import { ThingsView, VIEW_TYPE } from "./view";

interface Prefs {
	/** How far ahead the window lists deadlines. */
	deadlineDays: number;
	/** Minutes between refreshes while the window is visible. */
	refreshMinutes: number;
	/** Default days between a to-do's start reminder (When) and its deadline. */
	leadDays: number;
	/** To-dos shown after "Now", in your Things order, before the groups start. */
	nextCount: number;
	/** How the rest of Today is grouped. */
	groupBy: GroupBy;
	/** Whether those groups start unfolded. */
	groupsOpen: boolean;
	/** Where a project's view opens. */
	projectsOpenIn: "tab" | "split";
	/** The window's last tab. */
	tab: "today" | "projects";
}

const DEFAULTS: Prefs = { deadlineDays: 7, refreshMinutes: 3, leadDays: 2, nextCount: 3, groupBy: "project", groupsOpen: false, projectsOpenIn: "tab", tab: "today" };

/** Extra context for a draft: the course it belongs to, so the right project can be found. */
export interface SendContext extends DraftContext {
	code: string | null;
}

export default class ThingsBridge extends Plugin {
	prefs: Prefs = { ...DEFAULTS };
	/** Kept in memory only; to-do text never reaches data.json. */
	snapshot: { data: Snapshot; at: number } | null = null;
	private listsCache: { data: Lists; at: number } | null = null;
	private reading: Promise<Snapshot> | null = null;
	/** To-dos ticked in the last few seconds, shown done with an Undo in every view. */
	readonly justDone = new Map<string, number>();

	/** The public API (contract in `src/api-types.ts`), reached as `app.plugins.getPlugin("things-bridge").api`. */
	readonly api: ThingsBridgeApi = {
		apiVersion: THINGS_BRIDGE_API_VERSION,
		canRead: () => canRead(),
		today: async (launch = false) => {
			const s = await this.readQuietly(launch);
			return s ? s.today.map((t) => this.info(t)) : null;
		},
		deadlines: async (days, launch = false) => {
			const s = await this.readQuietly(launch);
			if (!s) return null;
			const last = addDays(localToday(), days);
			return s.all.filter((t) => t.deadline && t.deadline <= last).sort((a, b) => (a.deadline as string).localeCompare(b.deadline as string)).map((t) => this.info(t));
		},
		lists: async (launch = false) => {
			try {
				const l = await this.lists(launch);
				return l.running ? { projects: l.projects, areas: l.areas, tags: l.tags } : null;
			} catch {
				return null;
			}
		},
		createTodo: (draft) => this.add(draft),
		createProject: (project) => this.confirmProject(project),
	};

	override async onload(): Promise<void> {
		this.prefs = { ...DEFAULTS, ...((await this.loadData()) as Partial<Prefs> | null) };
		this.addSettingTab(new BridgeSettings(this.app, this));
		this.registerView(VIEW_TYPE, (leaf) => new ThingsView(leaf, this));
		this.registerView(PROJECT_VIEW_TYPE, (leaf) => new ProjectView(leaf, this));
		this.addRibbonIcon("check-circle", "Open Things window", () => void this.openWindow());
		this.addCommand({ id: "open-window", name: "Open Things window", callback: () => void this.openWindow() });
		this.addCommand({ id: "send", name: "Send to Things…", callback: () => this.send() });
		this.addCommand({ id: "open-project", name: "Open a Things project…", callback: () => void this.pickProject() });
	}

	async save(): Promise<void> {
		await this.saveData(this.prefs);
	}

	// ----- reading -----

	/**
	 * Today and every open to-do. Cached for `maxAge`; concurrent calls share one read. With
	 * `launch` false, a closed Things stays closed (the snapshot says `running: false`).
	 */
	async read(opts: { maxAge?: number; launch?: boolean } = {}): Promise<Snapshot> {
		const maxAge = opts.maxAge ?? 60_000;
		if (this.snapshot && Date.now() - this.snapshot.at < maxAge && (this.snapshot.data.running || !opts.launch)) return this.snapshot.data;
		if (this.reading) return this.reading;
		this.reading = runJxa(READ_SCRIPT, opts.launch ? ["force"] : [])
			.then((out) => {
				const data = parseSnapshot(out);
				this.snapshot = { data, at: Date.now() };
				return data;
			})
			.finally(() => {
				this.reading = null;
			});
		return this.reading;
	}

	private async readQuietly(launch: boolean): Promise<Snapshot | null> {
		if (!canRead()) return null;
		try {
			const s = await this.read({ launch });
			return s.running ? s : null;
		} catch {
			return null;
		}
	}

	async lists(launch = false): Promise<Lists> {
		if (this.listsCache && Date.now() - this.listsCache.at < 10 * 60_000 && (this.listsCache.data.running || !launch)) return this.listsCache.data;
		const data = parseLists(await runJxa(LISTS_SCRIPT, launch ? ["force"] : []));
		this.listsCache = { data, at: Date.now() };
		return data;
	}

	private info(t: Todo): TodoInfo {
		return { id: t.id, title: t.title, when: t.when, deadline: t.deadline, tags: t.tags, project: t.project, area: t.area, note: linkedFile(t, this.app.vault.getName()) };
	}

	/**
	 * Ticks (or unticks) a to-do: shown at once in every view, written to Things in the background,
	 * and kept on screen with an Undo for a few seconds before it goes.
	 */
	async toggle(t: Todo, done: boolean): Promise<void> {
		if (done) this.justDone.set(t.id, Date.now());
		else this.justDone.delete(t.id);
		this.renderViews();
		try {
			await this.setDone(t.id, done);
		} catch (e) {
			if (done) this.justDone.delete(t.id);
			else this.justDone.set(t.id, Date.now());
			new Notice(explain(e), 8000);
			this.renderViews();
			return;
		}
		if (done) {
			window.setTimeout(() => {
				const at = this.justDone.get(t.id);
				if (at !== undefined && Date.now() - at >= 5500) {
					this.justDone.delete(t.id);
					this.refreshViews();
				}
			}, 6000);
		} else {
			this.refreshViews();
		}
	}

	/** Completes (or reopens) a to-do in the background, without bringing Things forward. */
	async setDone(id: string, done: boolean): Promise<void> {
		await runJxa(STATUS_SCRIPT, [id, done ? "completed" : "open"], 15_000);
		this.stale();
	}

	// ----- writing -----

	openUrl(url: string): void {
		window.open(url);
	}

	add(draft: TodoDraft): void {
		this.openUrl(addUrl(draft));
		this.stale();
		window.setTimeout(() => this.refreshViews(), 4000);
	}

	confirmProject(project: { title: string; area: string | null; notes?: string }): Promise<boolean> {
		return new Promise((resolve) => new ConfirmProject(this.app, project, (ok) => {
			if (ok) {
				this.openUrl(addProjectUrl(project));
				this.listsCache = null;
			}
			resolve(ok);
		}).open());
	}

	/** Marks the copy as old without throwing it away, so the window keeps showing something. */
	private stale(): void {
		if (this.snapshot) this.snapshot.at = 0;
	}

	private views(): ThingsBase[] {
		return [...this.app.workspace.getLeavesOfType(VIEW_TYPE), ...this.app.workspace.getLeavesOfType(PROJECT_VIEW_TYPE)].map((l) => l.view).filter((v): v is ThingsBase => v instanceof ThingsBase);
	}

	/** Re-reads Things for every visible view. */
	refreshViews(): void {
		for (const v of this.views()) void v.refresh(true);
	}

	/** Redraws every view from the copy in memory, without asking Things. */
	renderViews(): void {
		for (const v of this.views()) v.render();
	}

	// ----- sending a note -----

	send(): void {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") {
			new Notice("Open a note to send it to Things.");
			return;
		}
		new SendModal(this, this.contextFor(file, this.app.workspace.activeEditor?.editor ?? null)).open();
	}

	/** Title, notes, project and tags as the note suggests them. */
	contextFor(file: TFile, editor: Editor | null): SendContext {
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
		const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
		// A subject hub names its course and project; a case or lecture note links to its hub.
		let code = str(fm["course-code"]);
		let list = str(fm["things-project"]);
		const course = str(fm.course);
		if (course) {
			const target = /^\[\[([^\]|#]+)/.exec(course)?.[1] ?? course;
			const hub = this.app.metadataCache.getFirstLinkpathDest(target, file.path);
			const hubFm = hub ? ((this.app.metadataCache.getFileCache(hub)?.frontmatter ?? {}) as Record<string, unknown>) : {};
			code ??= str(hubFm["course-code"]) ?? target.split("/").pop() ?? null;
			list ??= str(hubFm["things-project"]);
		}
		let heading: string | null = null;
		let selection = "";
		if (editor) {
			selection = editor.getSelection();
			const line = editor.getCursor("from").line;
			heading = [...(cache?.headings ?? [])].reverse().find((h) => h.position.start.line <= line)?.heading ?? null;
		}
		return { selection, heading: selection ? null : heading, noteTitle: file.basename, link: obsidianLink(this.app.vault.getName(), file.path), list, tags: [], code };
	}

	/** A draft for a to-do in a given project, using the open note as context when there is one. */
	sendTo(projectTitle: string): void {
		const file = this.app.workspace.getActiveFile();
		const ctx: SendContext =
			file && file.extension === "md"
				? { ...this.contextFor(file, this.app.workspace.activeEditor?.editor ?? null), list: projectTitle }
				: { selection: "", heading: null, noteTitle: "", link: "", list: projectTitle, tags: [], code: null };
		new SendModal(this, ctx).open();
	}

	// ----- window and project views -----

	/** Opens a project's view, reusing one already open for it. */
	async openProject(id: string | null, title: string): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(PROJECT_VIEW_TYPE).find((l) => {
			const v = l.view;
			return v instanceof ProjectView && (id ? v.projectId === id : v.title === title);
		});
		if (existing) {
			await workspace.revealLeaf(existing);
			return;
		}
		const leaf = workspace.getLeaf(this.prefs.projectsOpenIn === "split" ? "split" : "tab");
		await leaf.setViewState({ type: PROJECT_VIEW_TYPE, state: { id, title }, active: true });
		await workspace.revealLeaf(leaf);
	}

	async openProjectByTitle(title: string): Promise<void> {
		const p = this.snapshot?.data.projects.find((x) => x.title === title);
		await this.openProject(p?.id ?? null, title);
	}

	private async pickProject(): Promise<void> {
		let s: Snapshot;
		try {
			s = await this.read({ maxAge: 5 * 60_000 });
		} catch (e) {
			new Notice(explain(e), 8000);
			return;
		}
		if (!s.running) {
			new Notice("Things isn't open. Open it, then try again.");
			return;
		}
		new ProjectPicker(this.app, s.projects.filter((p) => !p.someday), (p) => void this.openProject(p.id, p.title)).open();
	}

	async openWindow(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (!leaf) {
			const right = workspace.getRightLeaf(false);
			if (!right) return;
			await right.setViewState({ type: VIEW_TYPE, active: true });
			leaf = right;
		}
		await workspace.revealLeaf(leaf);
	}

	async openNote(path: string): Promise<void> {
		const file = this.app.metadataCache.getFirstLinkpathDest(path, "") ?? this.app.vault.getAbstractFileByPath(`${path}.md`);
		if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
		else new Notice(`The linked note “${path}” isn't in this vault any more.`);
	}
}

class ProjectPicker extends SuggestModal<Project> {
	constructor(app: App, private projects: Project[], private onPick: (p: Project) => void) {
		super(app);
		this.setPlaceholder("Which project?");
	}
	getSuggestions(q: string): Project[] {
		const words = q.toLowerCase().split(/\s+/).filter(Boolean);
		return this.projects.filter((p) => words.every((w) => `${p.title} ${p.area ?? ""}`.toLowerCase().includes(w)));
	}
	renderSuggestion(p: Project, el: HTMLElement): void {
		el.createDiv({ text: p.title });
		if (p.area) el.createEl("small", { cls: "things-bridge-muted", text: p.area });
	}
	onChooseSuggestion(p: Project): void {
		this.onPick(p);
	}
}

/** Making a Things project always needs a yes (charter: never a new project without asking). */
class ConfirmProject extends Modal {
	private answered = false;

	constructor(app: App, private project: { title: string; area: string | null }, private done: (ok: boolean) => void) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle("Make a new Things project?");
		this.contentEl.createEl("p", { text: `“${this.project.title}”${this.project.area ? ` in ${this.project.area}` : ""}. Nothing else in Things changes.` });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Make project")
					.setCta()
					.onClick(() => {
						this.answered = true;
						this.done(true);
						this.close();
					}),
			);
	}

	override onClose(): void {
		if (!this.answered) this.done(false);
		this.contentEl.empty();
	}
}

class BridgeSettings extends PluginSettingTab {
	constructor(app: App, private plugin: ThingsBridge) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const p = this.plugin.prefs;
		const num = (name: string, desc: string, key: "deadlineDays" | "refreshMinutes" | "leadDays" | "nextCount", min: number) =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((t) =>
					t.setValue(String(p[key])).onChange(async (v) => {
						const n = Number(v);
						if (Number.isInteger(n) && n >= min) {
							p[key] = n;
							await this.plugin.save();
						}
					}),
				);
		num("Deadlines ahead (days)", "The window lists deadlines this many days ahead, besides Today.", "deadlineDays", 1);
		num("Refresh every (minutes)", "While the window is visible. Things is never read while it's hidden or closed.", "refreshMinutes", 1);
		num("Start reminder (days before a deadline)", "When you give a to-do a deadline, its When is set this many days earlier. You can change it in each draft.", "leadDays", 0);

		new Setting(containerEl).setName("Today").setHeading();
		num("Top tasks after Now", "Shown in your Things order, ungrouped, right under Now. The rest of Today is grouped below them.", "nextCount", 0);
		new Setting(containerEl)
			.setName("Group the rest of Today by")
			.setDesc("Groups keep your Things order: each sits where its first to-do is in Today.")
			.addDropdown((d) =>
				d
					.addOptions({ project: "Project", area: "Area, then project", tag: "Tag, under its parent tag", none: "Nothing (Things' order)" })
					.setValue(p.groupBy)
					.onChange(async (v) => {
						p.groupBy = v as GroupBy;
						await this.plugin.save();
						this.plugin.renderViews();
					}),
			);
		new Setting(containerEl)
			.setName("Groups start open")
			.setDesc("Off keeps them folded to their names and counts, so the top tasks stay the focus.")
			.addToggle((t) =>
				t.setValue(p.groupsOpen).onChange(async (v) => {
					p.groupsOpen = v;
					await this.plugin.save();
					this.plugin.renderViews();
				}),
			);

		new Setting(containerEl).setName("Projects").setHeading();
		new Setting(containerEl)
			.setName("Open project views in")
			.setDesc("A project's view lists its to-dos: Today, Upcoming, Anytime, and Someday folded away.")
			.addDropdown((d) =>
				d
					.addOptions({ tab: "A new tab", split: "A split beside the current note" })
					.setValue(p.projectsOpenIn)
					.onChange(async (v) => {
						p.projectsOpenIn = v === "split" ? "split" : "tab";
						await this.plugin.save();
					}),
			);

		const status = containerEl.createDiv({ cls: "things-bridge-muted" });
		new Setting(containerEl)
			.setName("Check access to Things")
			.setDesc("Reads Things once (opening it if needed). The first time, macOS asks whether Obsidian may control Things.")
			.addButton((b) =>
				b.setButtonText("Check").onClick(async () => {
					status.setText("Asking Things…");
					try {
						const s = await this.plugin.read({ maxAge: 0, launch: true });
						status.setText(`Things answered: ${s.today.length} in Today, ${s.all.length} open to-dos.`);
					} catch (e) {
						status.setText(explain(e));
					}
				}),
			);
	}
}
