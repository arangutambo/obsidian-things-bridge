import { describe, expect, it } from "vitest";
import { countOf, groupTodos, otherProjects, projectsToday, projectTasks } from "../src/core/groups";
import { parseSnapshot } from "../src/core/model";

// Shaped like READ_SCRIPT's reply (2026-11-10), invented content.
const t = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `To-do ${id}`, notes: "", when: null, deadline: null, tags: "", project: null, area: null, ...extra });
const s = parseSnapshot(
	JSON.stringify({
		v: 1,
		running: true,
		todayIds: ["a", "b", "P2", "c", "d", "e"],
		all: [
			t("a", { project: "🔬 BIO1000", tags: "🔬 BIO1000" }),
			t("b", { area: "🏠 Home", tags: "Errand" }),
			t("c", { project: "🩺 MED1", tags: "🩺 MED1, Reading" }),
			t("d", { project: "🔬 BIO1000" }),
			t("e", { project: "🩺 MED1" }),
			t("P2", { title: "🎤 Talk", area: "🎓 Uni", isProject: true }),
			t("f", { project: "🔬 BIO1000", when: "2027-03-14" }),
			t("g", { project: "🔬 BIO1000", when: "2027-03-12", deadline: "2027-03-20" }),
			t("h", { project: "🔬 BIO1000" }),
			t("i", { project: "🔬 BIO1000" }),
			t("j", { project: "📦 Side", deadline: "2027-04-01" }),
		],
		projects: [
			{ id: "P1", title: "🔬 BIO1000", area: "🎓 Uni", deadline: "2027-03-18", tags: "" },
			{ id: "P2", title: "🎤 Talk", area: "🎓 Uni", tags: "" },
			{ id: "P3", title: "🩺 MED1", area: "🎓 Uni", tags: "" },
			{ id: "P4", title: "📦 Side", area: "🤑 Work", tags: "" },
			{ id: "P5", title: "💤 Maybe", area: "🤑 Work", tags: "" },
		],
		somedayIds: ["i", "P5"],
		tagParents: { "🔬 BIO1000": "🎓 Courses", "🩺 MED1": "🎓 Courses", Errand: null, Reading: null },
	}),
);

describe("grouping Today below the top tasks", () => {
	const rest = s.today.slice(1);
	const titles = (gs: ReturnType<typeof groupTodos>) => gs.map((g) => `${g.title}(${countOf(g)})`);

	it("reads projects, Someday and tag parents, keeping a scheduled project in Today only", () => {
		expect(s.projects.find((p) => p.id === "P5")?.someday).toBe(true);
		expect(s.today.map((x) => x.id)).toEqual(["a", "b", "P2", "c", "d", "e"]);
		expect(s.all.some((x) => x.id === "P2")).toBe(false);
	});
	it("by project, in Today's order, with areas and loose to-dos as their own groups", () => {
		const g = groupTodos(rest, "project", s);
		expect(titles(g)).toEqual(["🏠 Home(1)", "🎤 Talk(1)", "🩺 MED1(2)", "🔬 BIO1000(1)"]);
		expect(g.find((x) => x.title === "🩺 MED1")?.projectId).toBe("P3");
	});
	it("by area, then project", () => {
		const g = groupTodos(s.today, "area", s);
		expect(titles(g)).toEqual(["🎓 Uni(5)", "🏠 Home(1)"]);
		expect(titles(g[0].children)).toEqual(["🔬 BIO1000(2)", "🎤 Talk(1)", "🩺 MED1(2)"]);
		expect(g[1].todos.map((x) => x.id)).toEqual(["b"]);
	});
	it("by tag, under parent tags when they have one", () => {
		const g = groupTodos(s.today, "tag", s);
		expect(titles(g)).toEqual(["🎓 Courses(2)", "Errand(1)", "No tag(3)"]);
		expect(titles(g[0].children)).toEqual(["🔬 BIO1000(1)", "🩺 MED1(1)"]);
	});
	it("not at all, when you'd rather keep Things' plain order", () => {
		expect(groupTodos(rest, "none", s)).toEqual([]);
	});
});

describe("projects", () => {
	it("lists the projects with something today, with counts and the nearest deadline", () => {
		const p = projectsToday(s);
		expect(p.map((x) => [x.title, x.today.length, x.scheduled, x.open, x.nextDeadline])).toEqual([
			["🔬 BIO1000", 2, false, 6, "2027-03-18"],
			["🎤 Talk", 0, true, 0, null],
			["🩺 MED1", 2, false, 2, null],
		]);
	});
	it("lists the other active projects by area, leaving Someday out", () => {
		const others = otherProjects(s, new Set(projectsToday(s).map((x) => x.title)));
		expect(others).toEqual([{ area: "🤑 Work", projects: [expect.objectContaining({ title: "📦 Side" })] }]);
	});
	it("splits a project's to-dos into Today, Upcoming, Anytime and Someday", () => {
		const p = projectTasks(s, "🔬 BIO1000", "2027-03-10");
		expect(p.today.map((x) => x.id)).toEqual(["a", "d"]);
		expect(p.upcoming.map((x) => x.id)).toEqual(["g", "f"]);
		expect(p.anytime.map((x) => x.id)).toEqual(["h"]);
		expect(p.someday.map((x) => x.id)).toEqual(["i"]);
	});
});
