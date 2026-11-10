/**
 * Things Bridge's public API, for companion plugins such as Course Desk. Copy this file into your
 * plugin and call `getThingsBridgeApi(app)`. `apiVersion` follows semver: minor versions only add.
 */
import type { App } from "obsidian";

export const THINGS_BRIDGE_PLUGIN_ID = "things-bridge";
export const THINGS_BRIDGE_API_VERSION = "1.0.0";
export const THINGS_BRIDGE_API_MEMBERS = ["apiVersion", "canRead", "today", "deadlines", "lists", "createTodo", "createProject"] as const;

export interface TodoInfo {
	id: string;
	title: string;
	when: string | null;
	deadline: string | null;
	tags: string[];
	project: string | null;
	area: string | null;
	/** The vault path (without .md) the to-do links back to, if any. */
	note: string | null;
}

export interface TodoDraft {
	title: string;
	notes: string;
	/** Project or area title; null for the Inbox. */
	list: string | null;
	/** YYYY-MM-DD, or "today" / "tomorrow" / "evening" / "someday". */
	when: string | null;
	deadline: string | null;
	tags: string[];
	checklist: string[];
}

export interface ThingsBridgeApi {
	readonly apiVersion: string;
	/** True on the Mac desktop app, where Things can be read. Adding works everywhere. */
	canRead(): boolean;
	/** Today, in Things' order. Null when Things can't be read (not a Mac, no permission, or closed and `launch` is false). */
	today(launch?: boolean): Promise<TodoInfo[] | null>;
	/** Open to-dos with a deadline in the next `days` days (today included). */
	deadlines(days: number, launch?: boolean): Promise<TodoInfo[] | null>;
	/** Open projects (with their area), areas and tags. */
	lists(launch?: boolean): Promise<{ projects: { title: string; area: string | null }[]; areas: string[]; tags: string[] } | null>;
	/** Adds a to-do straight away. Show the user the draft first (nothing changes in Things unseen). */
	createTodo(draft: TodoDraft): void;
	/** Asks the user to confirm, then makes the project. Resolves true if it was made. */
	createProject(project: { title: string; area: string | null; notes?: string }): Promise<boolean>;
}

/** Null if Things Bridge is missing, disabled, still loading, or on another major version. */
export function getThingsBridgeApi(app: App): ThingsBridgeApi | null {
	const plugins = (app as unknown as { plugins?: { getPlugin?(id: string): unknown } }).plugins;
	const api = (plugins?.getPlugin?.(THINGS_BRIDGE_PLUGIN_ID) as { api?: ThingsBridgeApi } | null | undefined)?.api;
	if (!api || typeof api.apiVersion !== "string") return null;
	return api.apiVersion.split(".")[0] === THINGS_BRIDGE_API_VERSION.split(".")[0] ? api : null;
}
