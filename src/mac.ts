import { Platform } from "obsidian";

import { classifyError, type JxaFailure, type ScriptCall } from "./core/jxa";

export class JxaError extends Error {
	constructor(readonly kind: JxaFailure, message: string) {
		super(message);
	}
}

/** Things can only be read on the Mac desktop app (T5). */
export function canRead(): boolean {
	return Platform.isDesktopApp && Platform.isMacOS;
}

type ExecFile = (
	file: string,
	args: string[],
	options: { timeout: number; maxBuffer: number },
	callback: (error: Error | null, stdout: string, stderr: string) => void,
) => void;

/**
 * Runs a JXA script with `osascript`, arguments passed separately (never through a shell). Node's
 * child_process is loaded on first use, on the Mac desktop app only, so mobile never touches it.
 */
export function runJxa(script: string, args: string[] = [], timeout = 20_000): Promise<string> {
	return runScript({ language: "JavaScript", lines: [script], args }, timeout);
}

/** Runs a script (JavaScript for Automation or AppleScript) with `osascript`, arguments kept apart. */
export function runScript(call: ScriptCall, timeout = 20_000): Promise<string> {
	if (Platform.isDesktop && Platform.isDesktopApp && Platform.isMacOS) {
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded lazily so mobile never touches it
		const { execFile } = require("child_process") as { execFile: ExecFile };
		return new Promise((resolve, reject) => {
			const lang = call.language === "JavaScript" ? ["-l", "JavaScript"] : [];
			execFile("osascript", [...lang, ...call.lines.flatMap((l) => ["-e", l]), ...call.args], { timeout, maxBuffer: 20_000_000 }, (error, stdout, stderr) => {
				if (error) {
					const message = stderr || error.message;
					reject(new JxaError(classifyError(message), message.trim()));
				} else {
					resolve(stdout);
				}
			});
		});
	}
	return Promise.reject(new JxaError("not-mac", "Reading Things needs the Mac desktop app."));
}

/**
 * Opens a things:/// link. On the Mac, `open -g` hands it to Things without bringing Things to the
 * front, so adding or rescheduling from Obsidian doesn't pull you out of your note.
 */
export function openThingsUrl(url: string, background: boolean): void {
	if (Platform.isDesktop && Platform.isDesktopApp && Platform.isMacOS && background) {
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded lazily so mobile never touches it
		const { execFile } = require("child_process") as { execFile: (f: string, a: string[], cb: (e: Error | null) => void) => void };
		execFile("open", ["-g", url], (error) => {
			if (error) window.open(url);
		});
		return;
	}
	window.open(url);
}

export function explain(e: unknown): string {
	const kind = e instanceof JxaError ? e.kind : "other";
	switch (kind) {
		case "not-mac":
			return "Reading Things needs the Mac desktop app. Sending to Things still works here.";
		case "no-permission":
			return "macOS hasn't allowed Obsidian to read Things. Open System Settings → Privacy & Security → Automation, find Obsidian, and turn on Things.";
		case "not-installed":
			return "Things 3 isn't installed on this Mac.";
		case "gone":
			return "That to-do isn't in Things any more. It may have been completed or deleted there.";
		case "timeout":
			return "Things took too long to answer. Try again in a moment.";
		default:
			return `Things didn't answer as expected: ${e instanceof Error ? e.message : String(e)}`;
	}
}
