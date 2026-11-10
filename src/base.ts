import { ItemView, setIcon } from "obsidian";

import type { Snapshot } from "./core/model";
import { canRead, explain } from "./mac";
import type ThingsBridge from "./main";

/**
 * What every Things view shares: read only while visible and never at startup, keep showing the
 * last copy while refreshing, and say plainly when Things can't be read.
 */
export abstract class ThingsBase extends ItemView {
	protected error: string | null = null;
	protected busy = false;

	protected abstract readonly plugin: ThingsBridge;
	protected abstract renderBody(c: HTMLElement, s: Snapshot, at: number): void;
	protected abstract renderHead(c: HTMLElement): void;

	override async onOpen(): Promise<void> {
		this.render();
		this.app.workspace.onLayoutReady(() => {
			window.setTimeout(() => void this.refresh(false), 2000);
		});
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => void this.refresh(false)));
		this.registerInterval(window.setInterval(() => void this.refresh(false), this.plugin.prefs.refreshMinutes * 60_000));
	}

	/** Reads Things if this view is visible and the copy is stale (or `force`). */
	async refresh(force: boolean, launch = false): Promise<void> {
		if (!this.contentEl.isShown() || this.busy || !canRead()) {
			if (!canRead()) this.render();
			return;
		}
		this.busy = true;
		this.render();
		try {
			await this.plugin.read({ maxAge: force ? 0 : 60_000, launch });
			this.error = null;
		} catch (e) {
			this.error = explain(e);
		} finally {
			this.busy = false;
			this.plugin.renderViews();
		}
	}

	render(): void {
		const c = this.contentEl;
		c.empty();
		this.renderHead(c);
		if (!canRead()) {
			c.createEl("p", { cls: "things-bridge-muted", text: "Reading Things needs the Mac desktop app. Send to Things still works here." });
			return;
		}
		const snap = this.plugin.snapshot;
		if (this.error) c.createDiv({ cls: "things-bridge-note", text: this.error });
		if (!snap) {
			if (!this.error) c.createDiv({ cls: "things-bridge-muted", text: this.busy ? "Reading Things…" : "Not read yet." });
			return;
		}
		if (!snap.data.running) {
			const note = c.createDiv({ cls: "things-bridge-note" });
			note.createEl("p", { text: "Things isn't open, so this waits rather than opening it." });
			const b = note.createEl("button", { text: "Open Things and read" });
			b.addEventListener("click", () => void this.refresh(true, true));
			return;
		}
		const mins = Math.round((Date.now() - snap.at) / 60_000);
		c.createDiv({ cls: "things-bridge-muted things-bridge-age", text: this.busy ? "Refreshing…" : mins < 1 ? "Up to date" : `Read ${mins} min ago` });
		this.renderBody(c, snap.data, snap.at);
	}

	protected addTool(parent: HTMLElement, icon: string, label: string, onClick: () => void): void {
		const b = parent.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
		setIcon(b, icon);
		b.addEventListener("click", onClick);
	}
}
