import { Menu, Modal, Notice, Plugin, PluginSettingTab, SecretComponent, Setting, SuggestModal, TFile, addIcon, type App, type Editor, type WorkspaceLeaf, type WorkspaceSplit } from "obsidian";

import { THINGS_BRIDGE_API_VERSION, type ThingsBridgeApi, type TodoInfo } from "./api-types";
import { ThingsBase } from "./base";
import { addDays, isIsoDate, localToday } from "./core/dates";
import { addProjectUrl, addUrl, updateUrl, type DraftContext, type TodoDraft } from "./core/draft";
import type { GroupBy } from "./core/groups";
import { LISTS_SCRIPT, READ_SCRIPT, STATUS_SCRIPT, actionCall, type TodoAction } from "./core/jxa";
import { filterByArea, linkedFile, obsidianLink, parseLists, parseSnapshot, type Lists, type Project, type Snapshot, type Todo } from "./core/model";
import { canRead, explain, openThingsUrl, runJxa, runScript } from "./mac";
import { PROJECT_VIEW_TYPE, ProjectView } from "./project-view";
import type { StripItem } from "./rows";
import { SendModal } from "./send";
import { areaIconSvg, planAreaTabs, wantedAreas } from "./core/area-tabs";
import { AREA_VIEW_TYPE, AreaView, ThingsView, VIEW_TYPE, areaTab } from "./view";

interface Prefs {
	/** How far ahead Today lists deadlines (0: none; the Deadlines tab lists them all). */
	deadlineDays: number;
	/** Minutes between refreshes while a view is visible. */
	refreshMinutes: number;
	/** Default days between a to-do's start reminder (When) and its deadline. */
	leadDays: number;
	/** To-dos shown after "Now", in your Things order, before the groups start. */
	nextCount: number;
	/** How the rest of Today is grouped. */
	groupBy: GroupBy;
	/** Whether those groups start unfolded. */
	groupsOpen: boolean;
	/** Show projects scheduled for today among Today's to-dos (otherwise in their project tabs). */
	projectsInToday: boolean;
	/** Where a project opened "in its own tab" goes. */
	projectsOpenIn: "tab" | "split";
	/** The last top tab, used by a newly opened window. */
	tab: string;
	/** The project tab last picked in each top tab. */
	selectedProject: Record<string, string>;
	showToday: boolean;
	showDeadlines: boolean;
	showProjects: boolean;
	/** A tab per Things area. */
	areaTabs: boolean;
	/** Those tabs sit in the sidebar beside the general Things tab, not in its top row. */
	areaSidebarTabs: boolean;
	/** Areas whose sidebar tab has been added, so one you close stays closed. */
	placedAreas: string[];
	/** Areas left out of the tabs. */
	hiddenAreas: string[];
	/** Things' areas as last read, so their commands exist before Things is next read. */
	knownAreas: string[];
	/** Project tabs: those with something today first, or Things' order. */
	projectOrder: "today-first" | "things";
	/** Where the Things window opens. */
	openIn: "right" | "main";
	/** Each tab's command opens its own window (several side by side), instead of switching one. */
	separateWindows: boolean;
	/** The id of the secret holding Things' URL token (in Obsidian's secure storage). */
	tokenSecret: string;
}

const DEFAULTS: Prefs = {
	deadlineDays: 7,
	refreshMinutes: 3,
	leadDays: 2,
	nextCount: 3,
	groupBy: "project",
	groupsOpen: false,
	projectsInToday: false,
	projectsOpenIn: "tab",
	tab: "today",
	selectedProject: {},
	showToday: true,
	showDeadlines: true,
	showProjects: true,
	areaTabs: true,
	areaSidebarTabs: true,
	placedAreas: [],
	hiddenAreas: [],
	knownAreas: [],
	projectOrder: "today-first",
	openIn: "right",
	separateWindows: false,
	tokenSecret: "things-url-token",
};

/** Extra context for a draft: the course it belongs to, so the right project can be found. */
export interface SendContext extends DraftContext {
	code: string | null;
}

function hashOf(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return (h >>> 0).toString(36);
}

export default class ThingsBridge extends Plugin {
	prefs: Prefs = { ...DEFAULTS };
	/** Kept in memory only; to-do text never reaches data.json. */
	snapshot: { data: Snapshot; at: number } | null = null;
	private listsCache: { data: Lists; at: number } | null = null;
	private reading: Promise<Snapshot> | null = null;
	/** To-dos ticked in the last few seconds, shown done with an Undo in every view. */
	readonly justDone = new Map<string, number>();
	private areaCommands = new Map<string, string>();

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
		const data = ((await this.loadData()) ?? {}) as Partial<Prefs>;
		this.prefs = { ...DEFAULTS, ...data, selectedProject: { ...(data.selectedProject ?? {}) } };
		this.addSettingTab(new BridgeSettings(this.app, this));
		this.registerView(VIEW_TYPE, (leaf) => new ThingsView(leaf, this));
		this.registerView(PROJECT_VIEW_TYPE, (leaf) => new ProjectView(leaf, this));
		this.registerView(AREA_VIEW_TYPE, (leaf) => new AreaView(leaf, this));
		this.addRibbonIcon("check-circle", "Open Things", () => void this.openHub(null));
		this.addCommand({ id: "open-window", name: "Open Things", callback: () => void this.openHub(null) });
		this.addCommand({ id: "open-today", name: "Open Things: today", callback: () => void this.openHub("today") });
		this.addCommand({ id: "open-deadlines", name: "Open Things: deadlines", callback: () => void this.openHub("deadlines") });
		this.addCommand({ id: "open-projects", name: "Open Things: all projects", callback: () => void this.openHub("projects") });
		this.addCommand({ id: "open-project", name: "Open a Things project…", callback: () => void this.pickProject() });
		this.addCommand({ id: "send", name: "Send to Things…", callback: () => this.send() });
		this.syncAreaCommands(this.prefs.knownAreas);
		this.app.workspace.onLayoutReady(() => void this.syncAreaTabs());
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
				if (data.running && data.areas.join("\n") !== this.prefs.knownAreas.join("\n")) {
					this.prefs.knownAreas = data.areas;
					void this.save();
					this.syncAreaCommands(data.areas);
					void this.syncAreaTabs();
				}
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

	// ----- changing to-dos -----

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

	/** One of the right-click actions, in the background. */
	private async act(t: Todo, action: TodoAction, arg: string, done: string): Promise<void> {
		try {
			await runScript(actionCall(action, t.id, arg), 15_000);
			new Notice(done);
		} catch (e) {
			new Notice(explain(e), 8000);
		}
		this.stale();
		this.refreshViews();
	}

	private token(): string {
		return this.app.secretStorage.getSecret(this.prefs.tokenSecret) ?? "";
	}

	/** Things' usual actions on a to-do, on right-click. */
	todoMenu(e: MouseEvent, t: Todo): void {
		const menu = new Menu();
		const item = (title: string, icon: string, run: () => void, disabled = false) =>
			menu.addItem((i) => {
				i.setTitle(title).setIcon(icon).onClick(run);
				if (disabled) i.setDisabled(true);
			});
		const today = localToday();
		const hasToken = !!this.token();
		item("Today", "star", () => void this.act(t, "today", "", "Moved to Today."));
		item(hasToken ? "This evening" : "This evening (add your Things URL token in settings)", "moon", () => this.evening(t), !hasToken);
		item("Tomorrow", "sunrise", () => void this.act(t, "date", addDays(today, 1), "Moved to tomorrow."));
		item("Pick a date…", "calendar", () => new DateModal(this.app, "When", t.when ?? addDays(today, 1), (d) => d && void this.act(t, "date", d, `Moved to ${d}.`)).open());
		item("Anytime", "layers", () => void this.act(t, "anytime", "", "Moved to Anytime."));
		item("Someday", "archive", () => void this.act(t, "someday", "", "Moved to Someday."));
		menu.addSeparator();
		item(t.deadline ? "Change deadline…" : "Add a deadline…", "flag", () => new DateModal(this.app, "Deadline", t.deadline ?? addDays(today, 7), (d) => d && void this.act(t, "deadline", d, `Deadline set to ${d}.`)).open());
		if (t.deadline) item("Clear deadline", "flag-off", () => void this.act(t, "deadline", "", "Deadline cleared."));
		item("Move to…", "folder-input", () => void this.pickPlace(t));
		menu.addSeparator();
		item("Show in Things", "external-link", () => this.openUrl(`things:///show?id=${encodeURIComponent(t.id)}`));
		const note = linkedFile(t, this.app.vault.getName());
		if (note) item("Open linked note", "file-text", () => void this.openNote(note));
		menu.addSeparator();
		item("Complete", "check-circle", () => void this.toggle(t, true));
		item("Cancel", "x-circle", () => void this.act(t, "cancel", "", "Cancelled."));
		item("Move to Trash", "trash-2", () =>
			new Confirm(this.app, "Move this to-do to the Trash?", `“${t.title}”. It stays in Things' Trash until you empty it.`, "Move to Trash", () => void this.act(t, "trash", "", "Moved to the Trash.")).open(),
		);
		menu.showAtMouseEvent(e);
	}

	private evening(t: Todo): void {
		const token = this.token();
		if (!token) {
			new Notice("Moving to this evening needs Things' URL token. Add it in this plugin's settings.", 8000);
			return;
		}
		openThingsUrl(updateUrl(t.id, token, { when: "evening" }), true);
		new Notice("Moved to this evening.");
		this.stale();
		window.setTimeout(() => this.refreshViews(), 2500);
	}

	private async pickPlace(t: Todo): Promise<void> {
		const s = this.snapshot?.data ?? (await this.read({ maxAge: 5 * 60_000 }).catch(() => null));
		if (!s?.running) return;
		const places: Place[] = [...s.projects.filter((p) => !p.someday).map((p): Place => ({ kind: "project", id: p.id, title: p.title, area: p.area })), ...s.areas.map((a): Place => ({ kind: "area", id: a, title: a, area: null }))];
		new PlacePicker(this.app, places, (p) => void this.act(t, p.kind, p.id, `Moved to ${p.title}.`)).open();
	}

	// ----- writing -----

	/** Shows something in Things (brings it forward). */
	openUrl(url: string): void {
		openThingsUrl(url, false);
	}

	add(draft: TodoDraft): void {
		openThingsUrl(addUrl(draft), true);
		this.stale();
		window.setTimeout(() => this.refreshViews(), 3000);
	}

	confirmProject(project: { title: string; area: string | null; notes?: string }): Promise<boolean> {
		return new Promise((resolve) => {
			let answered = false;
			const m = new Confirm(this.app, "Make a new Things project?", `“${project.title}”${project.area ? ` in ${project.area}` : ""}. Nothing else in Things changes.`, "Make project", () => {
				answered = true;
				openThingsUrl(addProjectUrl(project), true);
				this.listsCache = null;
				resolve(true);
			});
			m.onClose = () => {
				m.contentEl.empty();
				if (!answered) resolve(false);
			};
			m.open();
		});
	}

	/** Marks the copy as old without throwing it away, so the window keeps showing something. */
	private stale(): void {
		if (this.snapshot) this.snapshot.at = 0;
	}

	private views(): ThingsBase[] {
		return [VIEW_TYPE, AREA_VIEW_TYPE, PROJECT_VIEW_TYPE].flatMap((t) => this.app.workspace.getLeavesOfType(t)).map((l) => l.view).filter((v): v is ThingsBase => v instanceof ThingsBase);
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

	/** A draft for a to-do in a given project or area, using the open note as context when there is one. */
	sendTo(listTitle: string): void {
		const file = this.app.workspace.getActiveFile();
		const ctx: SendContext =
			file && file.extension === "md"
				? { ...this.contextFor(file, this.app.workspace.activeEditor?.editor ?? null), list: listTitle }
				: { selection: "", heading: null, noteTitle: "", link: "", list: listTitle, tags: [], code: null };
		new SendModal(this, ctx).open();
	}

	// ----- tabs, windows and commands -----

	/** The top tabs, as settings choose, with today's counts. */
	visibleTabs(): StripItem[] {
		const p = this.prefs;
		const s = this.snapshot?.data.running ? this.snapshot.data : null;
		const todayCount = (snap: Snapshot) => snap.today.filter((t) => !t.isProject).length;
		const out: StripItem[] = [];
		if (p.showToday) out.push({ id: "today", label: "Today", count: s ? todayCount(s) : 0 });
		if (p.showDeadlines) {
			const soon = s ? addDays(localToday(), Math.max(1, p.deadlineDays)) : "";
			out.push({ id: "deadlines", label: "Deadlines", count: s ? s.all.filter((t) => t.deadline && t.deadline <= soon).length : 0 });
		}
		if (p.showProjects) out.push({ id: "projects", label: "Projects" });
		if (p.areaTabs && !p.areaSidebarTabs) {
			for (const area of s?.areas ?? p.knownAreas) {
				if (p.hiddenAreas.includes(area)) continue;
				out.push({ id: areaTab(area), label: area, count: s ? todayCount(filterByArea(s, area)) : 0 });
			}
		}
		if (!out.length) out.push({ id: "today", label: "Today" });
		return out;
	}

	tabLabel(id: string): string {
		if (id.startsWith("area:")) return id.slice(5);
		return { today: "Today", deadlines: "Deadlines", projects: "Projects" }[id] ?? "Things";
	}

	/** One command per area ("Open Things: 🎓 School"), kept in step with Things' areas. */
	private syncAreaCommands(areas: string[]): void {
		for (const [area, id] of this.areaCommands) {
			if (areas.includes(area)) continue;
			this.removeCommand(id);
			this.areaCommands.delete(area);
		}
		for (const area of areas) {
			this.areaIcon(area);
			if (this.areaCommands.has(area)) continue;
			const id = `open-area-${hashOf(area)}`;
			this.addCommand({ id, name: `Open Things: ${area}`, callback: () => void this.openHub(areaTab(area)) });
			this.areaCommands.set(area, id);
		}
	}

	/** The icon for an area's sidebar tab, drawn from its emoji and registered on first use. */
	areaIcon(area: string): string {
		const id = `things-area-${hashOf(area)}`;
		addIcon(id, areaIconSvg(area));
		return id;
	}

	private areaLeaves(): { leaf: WorkspaceLeaf; area: string }[] {
		return this.app.workspace.getLeavesOfType(AREA_VIEW_TYPE).flatMap((leaf) => {
			// A tab that hasn't been shown yet has no real view, but its saved state says which area.
			const tab = (leaf.getViewState().state as { tab?: unknown } | undefined)?.tab;
			return typeof tab === "string" && tab.startsWith("area:") ? [{ leaf, area: tab.slice(5) }] : [];
		});
	}

	/** A new tab for an area, at the end of the tab group holding the general Things tab. */
	private async addAreaLeaf(area: string): Promise<WorkspaceLeaf | null> {
		const { workspace } = this.app;
		const general = workspace.getLeavesOfType(VIEW_TYPE)[0];
		let leaf: WorkspaceLeaf | null;
		if (general) {
			const parent = general.parent as unknown as WorkspaceSplit & { children?: unknown[] };
			leaf = workspace.createLeafInParent(parent, parent.children?.length ?? 0);
		} else {
			leaf = workspace.getRightLeaf(false);
		}
		await leaf?.setViewState({ type: AREA_VIEW_TYPE, active: false, state: { tab: areaTab(area) } });
		return leaf;
	}

	private areaSync: Promise<void> = Promise.resolve();

	/** Brings the sidebar tabs in step with Things' areas and the settings. Never reads Things. */
	syncAreaTabs(): Promise<void> {
		// One at a time: two overlapping runs would each add the same tabs.
		this.areaSync = this.areaSync.then(() => this.runAreaSync()).catch((e) => console.error("[things-bridge] area tabs", e));
		return this.areaSync;
	}

	private async runAreaSync(): Promise<void> {
		const { workspace } = this.app;
		if (!workspace.layoutReady) return;
		const p = this.prefs;
		const wanted = wantedAreas(p.knownAreas, p.hiddenAreas, p.areaTabs && p.areaSidebarTabs);
		const open = this.areaLeaves();
		// New tabs join the general Things tab, so none are added until it exists.
		const hasGeneral = workspace.getLeavesOfType(VIEW_TYPE).length > 0;
		const plan = planAreaTabs(wanted, open.map((o) => o.area), hasGeneral ? p.placedAreas : wanted);
		for (const o of open) if (plan.close.includes(o.area)) o.leaf.detach();
		// A new tab becomes the selected one; put back whatever was showing (undocumented, so guarded).
		const group = workspace.getLeavesOfType(VIEW_TYPE)[0]?.parent as unknown as { currentTab?: number; selectTabIndex?: (index: number) => void } | undefined;
		const showing = group?.currentTab;
		for (const area of plan.add) await this.addAreaLeaf(area);
		if (plan.add.length && showing !== undefined) group?.selectTabIndex?.(showing);
		const placed = hasGeneral ? plan.placed : p.placedAreas.filter((a) => wanted.includes(a));
		if (placed.join("\n") !== p.placedAreas.join("\n")) {
			p.placedAreas = placed;
			await this.save();
		}
	}

	private async openAreaTab(area: string): Promise<ThingsView | null> {
		const leaf = this.areaLeaves().find((o) => o.area === area)?.leaf ?? (await this.addAreaLeaf(area));
		if (!leaf) return null;
		await leaf.loadIfDeferred();
		await this.app.workspace.revealLeaf(leaf);
		return leaf.view instanceof AreaView ? leaf.view : null;
	}

	/**
	 * Opens Things on a tab (or as it was, for null). With separate windows on, each tab's command
	 * opens its own window, reused next time; otherwise one window switches tab.
	 */
	async openHub(tab: string | null): Promise<ThingsView | null> {
		const { workspace } = this.app;
		if (tab?.startsWith("area:") && this.prefs.areaTabs && this.prefs.areaSidebarTabs) return this.openAreaTab(tab.slice(5));
		const leaves = workspace.getLeavesOfType(VIEW_TYPE);
		let leaf: WorkspaceLeaf | null | undefined = this.prefs.separateWindows && tab ? leaves.find((l) => l.view instanceof ThingsView && l.view.tab === tab) : leaves[0];
		if (!leaf) {
			leaf = this.prefs.openIn === "main" ? workspace.getLeaf("tab") : workspace.getRightLeaf(leaves.length > 0);
			if (!leaf) return null;
			await leaf.setViewState({ type: VIEW_TYPE, active: true, state: tab ? { tab } : {} });
		}
		await leaf.loadIfDeferred();
		const view = leaf.view instanceof ThingsView ? leaf.view : null;
		if (view && tab && view.tab !== tab) await view.showTab(tab);
		await workspace.revealLeaf(leaf);
		await this.syncAreaTabs();
		return view;
	}

	/** A project's tab: under its area's tab when there is one, otherwise under Projects. */
	async showProject(id: string | null, title: string): Promise<void> {
		const s = this.snapshot?.data;
		const project = s?.projects.find((p) => (id ? p.id === id : p.title === title)) ?? null;
		const p = this.prefs;
		const area = project?.area ?? null;
		const tab = p.areaTabs && area && !p.hiddenAreas.includes(area) ? areaTab(area) : p.showProjects ? "projects" : null;
		if (!tab || !project) {
			await this.openProject(id, title);
			return;
		}
		const view = await this.openHub(tab);
		view?.selectProject(tab, project.id);
	}

	async showProjectByTitle(title: string): Promise<void> {
		const p = this.snapshot?.data.projects.find((x) => x.title === title);
		await this.showProject(p?.id ?? null, title);
	}

	/** A project in a view of its own (a tab or a split), reused if already open. */
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
		new ProjectPicker(this.app, s.projects.filter((p) => !p.someday), (p) => void this.showProject(p.id, p.title)).open();
	}

	async openNote(path: string): Promise<void> {
		const file = this.app.metadataCache.getFirstLinkpathDest(path, "") ?? this.app.vault.getAbstractFileByPath(`${path}.md`);
		if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
		else new Notice(`The linked note “${path}” isn't in this vault any more.`);
	}
}

interface Place {
	kind: "project" | "area";
	id: string;
	title: string;
	area: string | null;
}

class PlacePicker extends SuggestModal<Place> {
	constructor(app: App, private places: Place[], private onPick: (p: Place) => void) {
		super(app);
		this.setPlaceholder("Move to which project or area?");
	}
	getSuggestions(q: string): Place[] {
		const words = q.toLowerCase().split(/\s+/).filter(Boolean);
		return this.places.filter((p) => words.every((w) => `${p.title} ${p.area ?? ""}`.toLowerCase().includes(w)));
	}
	renderSuggestion(p: Place, el: HTMLElement): void {
		el.createDiv({ text: p.title });
		el.createEl("small", { cls: "things-bridge-muted", text: p.kind === "area" ? "Area" : (p.area ?? "Project") });
	}
	onChooseSuggestion(p: Place): void {
		this.onPick(p);
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

/** A date, for When or a deadline. */
class DateModal extends Modal {
	constructor(app: App, private heading: string, private initial: string, private onPick: (date: string | null) => void) {
		super(app);
	}
	override onOpen(): void {
		this.setTitle(this.heading);
		let value = this.initial;
		new Setting(this.contentEl).setName("Date").addText((t) => {
			t.inputEl.type = "date";
			t.setValue(this.initial).onChange((v) => (value = v));
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		const done = () => {
			if (!isIsoDate(value)) return;
			this.close();
			this.onPick(value);
		};
		this.scope.register([], "Enter", () => {
			done();
			return false;
		});
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => b.setButtonText("Set").setCta().onClick(done));
	}
	override onClose(): void {
		this.contentEl.empty();
	}
}

class Confirm extends Modal {
	constructor(app: App, private heading: string, private body: string, private yes: string, private onYes: () => void) {
		super(app);
	}
	override onOpen(): void {
		this.setTitle(this.heading);
		this.contentEl.createEl("p", { text: this.body });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(this.yes)
					.setCta()
					.onClick(() => {
						this.onYes();
						this.close();
					}),
			);
	}
	override onClose(): void {
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
		const changed = async () => {
			await this.plugin.save();
			this.plugin.renderViews();
			await this.plugin.syncAreaTabs();
		};
		const num = (name: string, desc: string, key: "deadlineDays" | "refreshMinutes" | "leadDays" | "nextCount", min: number) =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((t) =>
					t.setValue(String(p[key])).onChange(async (v) => {
						const n = Number(v);
						if (Number.isInteger(n) && n >= min) {
							p[key] = n;
							await changed();
						}
					}),
				);
		const toggle = (name: string, desc: string, key: "showToday" | "showDeadlines" | "showProjects" | "areaTabs" | "areaSidebarTabs" | "separateWindows" | "groupsOpen" | "projectsInToday", redraw = false) =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addToggle((t) =>
					t.setValue(p[key]).onChange(async (v) => {
						p[key] = v;
						await changed();
						if (redraw) this.display();
					}),
				);

		new Setting(containerEl).setName("Tabs").setHeading();
		toggle("Today tab", "Today's to-dos: Now, the next few, and the rest grouped.", "showToday");
		toggle("Deadlines tab", "Every deadline, soonest first, overdue on top.", "showDeadlines");
		toggle("Projects tab", "All active projects, one tab each.", "showProjects");
		toggle("A tab for each area", "Each area's projects, one tab each. Each also gets a command, so it can have a hotkey.", "areaTabs", true);
		if (p.areaTabs) {
			toggle("Areas in the sidebar", "On: each area is its own tab in the sidebar, next to the Things tab. Off: they sit in the row of tabs at the top of Things.", "areaSidebarTabs");
			if (!p.knownAreas.length) containerEl.createDiv({ cls: "setting-item-description", text: "Your areas appear here once Things has been read." });
			for (const area of p.knownAreas) {
				new Setting(containerEl).setName(area).setClass("things-bridge-indent").addToggle((t) =>
					t.setValue(!p.hiddenAreas.includes(area)).onChange(async (v) => {
						p.hiddenAreas = v ? p.hiddenAreas.filter((a) => a !== area) : [...p.hiddenAreas, area];
						await changed();
					}),
				);
			}
		}
		new Setting(containerEl)
			.setName("Order of project tabs")
			.addDropdown((d) =>
				d
					.addOptions({ "today-first": "Projects with something today first", things: "Things' own order" })
					.setValue(p.projectOrder)
					.onChange(async (v) => {
						p.projectOrder = v === "things" ? "things" : "today-first";
						await changed();
					}),
			);

		new Setting(containerEl).setName("Windows").setHeading();
		new Setting(containerEl)
			.setName("Open Things in")
			.addDropdown((d) =>
				d
					.addOptions({ right: "The right sidebar", main: "A tab in the main area" })
					.setValue(p.openIn)
					.onChange(async (v) => {
						p.openIn = v === "main" ? "main" : "right";
						await this.plugin.save();
					}),
			);
		toggle("Each tab's command opens its own window", "On: the commands for each tab and area open separate windows, so several can sit side by side. Off: one window that switches tab.", "separateWindows");

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
						await changed();
					}),
			);
		toggle("Groups start open", "Off keeps them folded to their names and counts, so the top tasks stay the focus.", "groupsOpen");
		toggle("Show projects scheduled for today in Today", "Off: Today shows just to-dos; scheduled projects are marked with a dot on their project tabs.", "projectsInToday");
		num("Deadlines in Today (days ahead)", "A short list under Today. 0 for none; the deadlines tab lists them all.", "deadlineDays", 0);

		new Setting(containerEl).setName("Projects").setHeading();
		new Setting(containerEl)
			.setName("Open a project in its own tab in")
			.setDesc("From the button on a project's tab, or when its area and the projects tab are both hidden.")
			.addDropdown((d) =>
				d
					.addOptions({ tab: "A new tab", split: "A split beside the current note" })
					.setValue(p.projectsOpenIn)
					.onChange(async (v) => {
						p.projectsOpenIn = v === "split" ? "split" : "tab";
						await this.plugin.save();
					}),
			);

		new Setting(containerEl).setName("Things").setHeading();
		num("Refresh every (minutes)", "While a view is visible. Things is never read while it's hidden or closed.", "refreshMinutes", 1);
		num("Start reminder (days before a deadline)", "When you give a to-do a deadline, its When is set this many days earlier. You can change it in each draft.", "leadDays", 0);
		const token = new Setting(containerEl)
			.setName("Things URL token")
			.setDesc("Only for moving a to-do to this evening from the right-click menu, which Things' scripting can't do. Copy it in Things from the general settings, under the option to enable Things URLs. It's kept in Obsidian's secure storage, never in this plugin's settings file.");
		token.addComponent((el) =>
			new SecretComponent(this.app, el).setValue(p.tokenSecret).onChange(async (v) => {
				p.tokenSecret = (v ?? "").trim() || "things-url-token";
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
						status.setText(`Things answered: ${s.today.length} in Today, ${s.all.length} open to-dos, ${s.areas.length} areas.`);
						this.display();
					} catch (e) {
						status.setText(explain(e));
					}
				}),
			);
	}
}
