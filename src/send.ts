import { Modal, Setting, type TextComponent } from "obsidian";

import { isIsoDate, localToday } from "./core/dates";
import { courseTags, draftFrom, findProject, startFor, type TodoDraft } from "./core/draft";
import type { Lists } from "./core/model";
import { canRead } from "./mac";
import type ThingsBridge from "./main";
import type { SendContext } from "./main";

const WHEN_WORDS: Record<string, string> = { "": "Not scheduled", today: "Today", evening: "This evening", tomorrow: "Tomorrow", someday: "Someday", date: "On a date…" };

/**
 * The draft (T4): everything prefilled from the note, all of it editable, nothing sent until you
 * press Add. Afterwards, one line asking you to say the first step out loud (rehearsal raised the
 * effect of if-then plans; writing them down alone did not, Sheeran 2024).
 */
export class SendModal extends Modal {
	private draft: TodoDraft;
	private whenWord = "";
	private whenDate = "";
	private lead: number;
	private firstStep = "";
	private lists: Lists | null = null;
	private listHost!: HTMLElement;
	private tagsText: TextComponent | null = null;
	private whenDateText: TextComponent | null = null;

	constructor(private plugin: ThingsBridge, private ctx: SendContext) {
		super(plugin.app);
		this.draft = draftFrom(ctx);
		this.lead = plugin.prefs.leadDays;
	}

	override onOpen(): void {
		this.modalEl.addClass("things-bridge-send");
		this.setTitle("Send to Things");
		const c = this.contentEl;

		new Setting(c).setName("To-do").addText((t) => {
			t.setValue(this.draft.title).onChange((v) => (this.draft.title = v));
			t.inputEl.addClass("things-bridge-wide");
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !e.isComposing) {
					e.preventDefault();
					this.add();
				}
			});
			window.setTimeout(() => {
				t.inputEl.focus();
				t.inputEl.select();
			}, 0);
		});
		this.listHost = c.createDiv();
		this.renderList();

		new Setting(c)
			.setName("When")
			.addDropdown((d) => {
				for (const [k, label] of Object.entries(WHEN_WORDS)) d.addOption(k, label);
				d.setValue(this.whenWord).onChange((v) => {
					this.whenWord = v;
					this.whenDateText?.inputEl.toggleClass("things-bridge-hidden", v !== "date");
				});
			})
			.addText((t) => {
				this.whenDateText = t;
				t.inputEl.type = "date";
				t.inputEl.addClass("things-bridge-hidden");
				t.onChange((v) => (this.whenDate = v));
			});
		const leadSetting = new Setting(c).setName("Start reminder").setDesc("Days before the deadline that it shows up in Today.").addText((t) => {
			t.inputEl.type = "number";
			t.inputEl.addClass("things-bridge-days");
			t.setValue(String(this.lead)).onChange((v) => {
				const n = Number(v);
				if (Number.isInteger(n) && n >= 0) this.lead = n;
			});
		});
		leadSetting.settingEl.addClass("things-bridge-hidden");
		new Setting(c).setName("Deadline").addText((t) => {
			t.inputEl.type = "date";
			t.onChange((v) => {
				this.draft.deadline = isIsoDate(v) ? v : null;
				leadSetting.settingEl.toggleClass("things-bridge-hidden", !this.draft.deadline);
			});
		});
		new Setting(c).setName("Tags").setDesc("Comma-separated. Things ignores tags it doesn't already have.").addText((t) => {
			this.tagsText = t;
			t.setValue(this.draft.tags.join(", ")).onChange((v) => (this.draft.tags = v.split(",").map((s) => s.trim()).filter(Boolean)));
		});
		new Setting(c)
			.setName("First tiny step")
			.setDesc("Optional. The smallest physical action, like “open the slides”. It becomes the first checklist item.")
			.addText((t) => t.onChange((v) => (this.firstStep = v.trim())));
		new Setting(c).setName("Notes").addTextArea((ta) => {
			ta.inputEl.rows = 3;
			ta.setValue(this.draft.notes).onChange((v) => (this.draft.notes = v));
		});
		new Setting(c)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => b.setButtonText("Add to Things").setCta().onClick(() => this.add()));
		this.scope.register(["Mod"], "Enter", () => {
			this.add();
			return false;
		});

		if (canRead()) void this.loadLists();
	}

	private async loadLists(): Promise<void> {
		try {
			const l = await this.plugin.lists(false);
			if (!l.running) return;
			this.lists = l;
			const found = findProject(l.projects, this.draft.list, this.ctx.code);
			if (found) this.draft.list = found;
			else if (this.draft.list && !l.projects.some((p) => p.title === this.draft.list) && !l.areas.includes(this.draft.list)) this.draft.list = null;
			if (!this.draft.tags.length) {
				this.draft.tags = courseTags(l.tags, this.ctx.code);
				this.tagsText?.setValue(this.draft.tags.join(", "));
			}
			this.renderList();
		} catch {
			// Things closed or not allowed: the plain text field stays.
		}
	}

	/** A picker of your real projects and areas when Things can be read; a text field otherwise. */
	private renderList(): void {
		this.listHost.empty();
		const s = new Setting(this.listHost).setName("Project or area");
		if (this.lists) {
			s.addDropdown((d) => {
				d.addOption("", "Inbox");
				for (const area of this.lists?.areas ?? []) {
					d.addOption(area, area);
					for (const p of this.lists?.projects.filter((x) => x.area === area) ?? []) d.addOption(p.title, `    ${p.title}`);
				}
				for (const p of this.lists?.projects.filter((x) => !x.area) ?? []) d.addOption(p.title, p.title);
				d.setValue(this.draft.list ?? "").onChange((v) => (this.draft.list = v || null));
			});
		} else {
			s.setDesc("Leave empty for the Inbox. A name Things doesn't know also goes to the Inbox.").addText((t) =>
				t.setValue(this.draft.list ?? "").onChange((v) => (this.draft.list = v.trim() || null)),
			);
		}
	}

	private add(): void {
		const d: TodoDraft = { ...this.draft, title: this.draft.title.trim() };
		if (!d.title) return;
		if (this.whenWord === "date") d.when = isIsoDate(this.whenDate) ? this.whenDate : null;
		else if (this.whenWord) d.when = this.whenWord;
		else if (d.deadline) d.when = startFor(d.deadline, this.lead, localToday());
		d.checklist = this.firstStep ? [this.firstStep, ...d.checklist] : d.checklist;
		this.plugin.add(d);
		this.rehearse();
	}

	private rehearse(): void {
		const c = this.contentEl;
		c.empty();
		this.setTitle("Added to Things");
		c.createEl("p", { text: this.firstStep ? "Before you go, say it out loud once:" : "Before you go, say the first step out loud once." });
		if (this.firstStep) c.createEl("p", { cls: "things-bridge-step", text: `“I will ${this.firstStep.replace(/^I will\s+/i, "")}.”` });
		new Setting(c).addButton((b) => {
			b.setButtonText("Done").setCta().onClick(() => this.close());
			window.setTimeout(() => b.buttonEl.focus(), 0);
		});
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
