import { Platform } from "obsidian";

import { classifyError, type JxaFailure } from "./core/jxa";

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
	if (Platform.isDesktop && Platform.isDesktopApp && Platform.isMacOS) {
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded lazily so mobile never touches it
		const { execFile } = require("child_process") as { execFile: ExecFile };
		return new Promise((resolve, reject) => {
			execFile("osascript", ["-l", "JavaScript", "-e", script, ...args], { timeout, maxBuffer: 20_000_000 }, (error, stdout, stderr) => {
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
