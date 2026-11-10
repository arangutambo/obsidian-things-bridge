import { describe, expect, it } from "vitest";
import { THINGS_BRIDGE_API_MEMBERS, THINGS_BRIDGE_API_VERSION, getThingsBridgeApi } from "../src/api-types";

describe("Things Bridge public API v1", () => {
	it("is frozen: changing the members needs a deliberate version bump", () => {
		expect(THINGS_BRIDGE_API_VERSION).toBe("1.0.0");
		expect([...THINGS_BRIDGE_API_MEMBERS]).toEqual(["apiVersion", "canRead", "today", "deadlines", "lists", "createTodo", "createProject"]);
	});
	it("degrades to null when missing or on another major version", () => {
		const app = (api: unknown) => ({ plugins: { getPlugin: (id: string) => (id === "things-bridge" ? { api } : null) } }) as never;
		expect(getThingsBridgeApi({} as never)).toBeNull();
		expect(getThingsBridgeApi(app({ apiVersion: "2.0.0" }))).toBeNull();
		const v1 = { apiVersion: "1.2.0" };
		expect(getThingsBridgeApi(app(v1))).toBe(v1);
	});
});
