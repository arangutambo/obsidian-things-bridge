/** Which sidebar tabs the Things areas should have, and how each one is drawn. Pure. */

export function wantedAreas(areas: string[], hidden: string[], enabled: boolean): string[] {
	return enabled ? areas.filter((a) => !hidden.includes(a)) : [];
}

export interface AreaTabPlan {
	close: string[];
	add: string[];
	/** Areas that have had their tab: one you close afterwards stays closed. */
	placed: string[];
}

/**
 * A tab is added once, the first time an area is wanted. Closing it is respected (its command
 * reopens it); hiding the area in settings, or it leaving Things, forgets that, so showing it
 * again brings the tab back.
 */
export function planAreaTabs(wanted: string[], open: string[], placed: string[]): AreaTabPlan {
	const add = wanted.filter((a) => !open.includes(a) && !placed.includes(a));
	return {
		close: open.filter((a) => !wanted.includes(a)),
		add,
		placed: wanted.filter((a) => placed.includes(a) || open.includes(a) || add.includes(a)),
	};
}

function escapeXml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** What a tab shows for an area: its leading emoji, or else its first letter. */
export function areaGlyph(area: string): string {
	const name = area.trim();
	const emoji = /^\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/u.exec(name);
	return emoji ? emoji[0] : Array.from(name)[0]?.toUpperCase() ?? "?";
}

/** Sidebar tabs show only an icon, so each area's is drawn from its own emoji (100×100 box). */
export function areaIconSvg(area: string): string {
	return `<text x="50" y="80" font-size="82" text-anchor="middle" fill="currentColor" stroke="none">${escapeXml(areaGlyph(area))}</text>`;
}
