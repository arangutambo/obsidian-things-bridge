import { describe, expect, it } from "vitest";
import { areaGlyph, areaIconSvg, planAreaTabs, wantedAreas } from "../src/core/area-tabs";

describe("a sidebar tab for each area", () => {
	const areas = ["🎓School", "🏡Home", "Work"];

	it("wants the areas not hidden, and none when the setting is off", () => {
		expect(wantedAreas(areas, ["Work"], true)).toEqual(["🎓School", "🏡Home"]);
		expect(wantedAreas(areas, [], false)).toEqual([]);
	});

	it("adds each tab the first time", () => {
		expect(planAreaTabs(areas, [], [])).toEqual({ close: [], add: areas, placed: areas });
	});

	it("leaves a tab you closed closed", () => {
		expect(planAreaTabs(areas, ["🏡Home", "Work"], areas)).toEqual({ close: [], add: [], placed: areas });
	});

	it("closes the tab of an area hidden or gone, and brings it back when shown again", () => {
		const hidden = planAreaTabs(["🎓School"], ["🎓School", "Work"], ["🎓School", "Work"]);
		expect(hidden).toEqual({ close: ["Work"], add: [], placed: ["🎓School"] });
		expect(planAreaTabs(["🎓School", "Work"], ["🎓School"], hidden.placed).add).toEqual(["Work"]);
	});

	it("draws an area's own emoji, or its first letter", () => {
		expect(areaGlyph("🎓School")).toBe("🎓");
		expect(areaGlyph("🤑 Professional")).toBe("🤑");
		expect(areaGlyph("work")).toBe("W");
		expect(areaIconSvg("<Work")).toContain(">&lt;</text>");
	});
});
