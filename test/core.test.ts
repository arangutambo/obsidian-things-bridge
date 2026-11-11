import { describe, expect, it } from "vitest";
import { actionCall, classifyError } from "../src/core/jxa";
import { linkedFile, linkedTo, noteLinks, obsidianLink, parseLists, parseSnapshot, placeOf, windowOf } from "../src/core/model";
import { addProjectUrl, addUrl, courseTags, draftFrom, findProject, startFor, updateUrl } from "../src/core/draft";

// Shaped like READ_SCRIPT's reply on a real Mac (2026-11-10), with invented content.
const t = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `To-do ${id}`, notes: "", when: null, deadline: null, tags: "", project: null, area: null, ...extra });
const REPLY = JSON.stringify({
	v: 1,
	running: true,
	todayIds: ["a", "b", "c", "d", "e", "f", "gone"],
	all: [
		t("a", { area: "🎓 School" }), t("b", { project: "🔬 BIO1000", tags: "🔬 BIO1000, Reading" }), t("c"), t("d"), t("e"), t("f"),
		t("g", { deadline: "2027-03-12", project: "🔬 BIO1000" }),
		t("h", { deadline: "2027-03-11" }),
		t("i", { deadline: "2027-03-20" }),
		t("j", { deadline: "2027-03-10" }),
		t("k", { notes: "See obsidian://open?vault=My%20Vault&file=Course%2FWeek%2003%20%C2%B7%20Chest%20pain for context" }),
		{ id: "", title: "broken" },
	],
});

describe("reading Things", () => {
	const s = parseSnapshot(REPLY);
	it("parses the reply, keeping Today's order, splitting tags and dropping malformed rows", () => {
		expect(s.today).toHaveLength(6);
		expect(s.all).toHaveLength(11);
		expect(s.today[1]).toMatchObject({ tags: ["🔬 BIO1000", "Reading"], project: "🔬 BIO1000" });
		expect(placeOf(s.today[0])).toBe("🎓 School");
		expect(parseSnapshot(JSON.stringify({ v: 1, running: false }))).toEqual({ running: false, today: [], all: [], projects: [], someday: new Set(), tagParents: {}, areas: [] });
		expect(() => parseSnapshot(JSON.stringify({ v: 2 }))).toThrow();
	});

	it("shows one thing now, three next, the rest folded, and the week's other deadlines", () => {
		const w = windowOf(s, "2027-03-10");
		expect(w.now?.id).toBe("a");
		expect(w.next.map((x) => x.id)).toEqual(["b", "c", "d"]);
		expect(w.later.map((x) => x.id)).toEqual(["e", "f"]);
		// Today's own deadline (j) is already in Things' Today; 20 March is past the 7-day window.
		expect(w.deadlines.map((x) => [x.id, x.days])).toEqual([["h", 1], ["g", 2]]);
		expect(windowOf({ running: true, today: [], all: [], projects: [], someday: new Set(), tagParents: {}, areas: [] }, "2027-03-10").now).toBeNull();
	});

	it("finds links back to notes, in this vault only", () => {
		const k = s.all.find((x) => x.id === "k")!;
		expect(noteLinks(k.notes)).toEqual([{ vault: "My Vault", file: "Course/Week 03 · Chest pain" }]);
		expect(linkedFile(k, "My Vault")).toBe("Course/Week 03 · Chest pain");
		expect(linkedFile(k, "Other vault")).toBeNull();
		expect(linkedTo(s.all, "My Vault", "Course/Week 03 · Chest pain.md").map((x) => x.id)).toEqual(["k"]);
		const link = obsidianLink("My Vault", "Course/Week 03 · Chest pain.md");
		expect(noteLinks(`notes\n\n${link}`)[0].file).toBe("Course/Week 03 · Chest pain");
	});

	it("reads projects, areas and tags", () => {
		const l = parseLists(JSON.stringify({ v: 1, running: true, projects: [{ title: "🩺 MED1 – Foundations", area: "🎓 School" }, { title: "" }], areas: ["🎓 School"], tags: ["🔬 BIO1000", 3] }));
		expect(l.projects).toEqual([{ title: "🩺 MED1 – Foundations", area: "🎓 School" }]);
		expect(l.tags).toEqual(["🔬 BIO1000"]);
	});

	it("sends each right-click action to the script that can do it", () => {
		expect(actionCall("someday", "Ab1")).toMatchObject({ language: "AppleScript", args: ["Ab1", "TMSomedayListSource"] });
		expect(actionCall("today", "Ab1").args[1]).toBe("TMTodayListSource");
		expect(actionCall("deadline", "Ab1")).toMatchObject({ language: "AppleScript", args: ["Ab1"] });
		expect(actionCall("deadline", "Ab1", "2027-03-01")).toMatchObject({ language: "JavaScript", args: ["deadline", "Ab1", "2027-03-01"] });
		expect(actionCall("project", "Ab1", "P1").language).toBe("JavaScript");
		expect(() => actionCall("today", 'x" & do shell script "')).toThrow();
	});
	it("explains osascript failures", () => {
		expect(classifyError("execution error: Not authorized to send Apple events to Things3. (-1743)")).toBe("no-permission");
		expect(classifyError("execution error: Error: Application can't be found. (-2700)")).toBe("not-installed");
		expect(classifyError("execution error: Error: Error: Not a Things id (-2700)")).toBe("other");
		expect(classifyError("execution error: Error: Error: Can't get object. (-1728)")).toBe("gone");
		expect(classifyError("Command failed: ETIMEDOUT")).toBe("timeout");
		expect(classifyError("something else")).toBe("other");
	});
});

describe("sending to Things", () => {
	const ctx = { selection: "", heading: null, noteTitle: "Week 03 · Case Chest pain", link: "obsidian://open?vault=V&file=W", list: "🔬 BIO1000", tags: [] };

	it("titles the draft from the selection, then the heading, then the note", () => {
		const d = draftFrom({ ...ctx, selection: "- [ ] Read the troponin chapter\n  pages 40-52\n" });
		expect(d).toMatchObject({ title: "Read the troponin chapter", notes: "pages 40-52\n\nobsidian://open?vault=V&file=W", list: "🔬 BIO1000" });
		expect(draftFrom({ ...ctx, heading: "ECG basics" }).title).toBe("ECG basics");
		expect(draftFrom(ctx)).toMatchObject({ title: "Week 03 · Case Chest pain", notes: "obsidian://open?vault=V&file=W" });
	});

	it("starts work some days before a deadline, never in the past", () => {
		expect(startFor("2027-03-20", 3, "2027-03-10")).toBe("2027-03-17");
		expect(startFor("2027-03-11", 3, "2027-03-10")).toBe("2027-03-10");
	});

	it("builds add URLs Things understands", () => {
		const url = addUrl({ title: "Pre-read: ECG", notes: "n", list: "🔬 BIO1000", when: "2027-03-17", deadline: "2027-03-20", tags: ["🔬 BIO1000"], checklist: ["Open the slides", "Skim"] });
		expect(url).toBe("things:///add?title=Pre-read%3A%20ECG&notes=n&when=2027-03-17&deadline=2027-03-20&tags=%F0%9F%94%AC%20BIO1000&list=%F0%9F%94%AC%20BIO1000&checklist-items=Open%20the%20slides%0ASkim");
		expect(addUrl({ title: "x", notes: "", list: null, when: null, deadline: null, tags: [], checklist: [] })).toBe("things:///add?title=x");
		expect(updateUrl("Ab1", "t0k/en", { when: "evening" })).toBe("things:///update?id=Ab1&auth-token=t0k%2Fen&when=evening");
		expect(addProjectUrl({ title: "🩺 MED1", area: "🎓 School" })).toBe("things:///add-project?title=%F0%9F%A9%BA%20MED1&area=%F0%9F%8E%93%20School");
	});

	it("finds a course's existing project and tags by its code", () => {
		const projects = [{ title: "🩺 ABCD10001 – Clinical Foundations" }, { title: "🎤 ABCD10003 – Student Conference" }, { title: "🔬 BIO2000" }];
		expect(findProject(projects, "🩺 ABCD10001", "ABCD10001")).toBe("🩺 ABCD10001 – Clinical Foundations");
		expect(findProject(projects, "🔬 BIO2000", null)).toBe("🔬 BIO2000");
		expect(findProject(projects, null, "ABCD1000")).toBeNull();
		expect(courseTags(["🔬 BIO2000", "BIO20001", "Reading"], "BIO2000")).toEqual(["🔬 BIO2000"]);
	});
});
