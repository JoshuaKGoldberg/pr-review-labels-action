import { describe, expect, it } from "vitest";

import { isNotFound } from "./isNotFound.ts";
import { createRequestError } from "./testUtils.ts";

describe(isNotFound, () => {
	it("returns true for a 404 error", () => {
		expect(isNotFound(createRequestError(404))).toBe(true);
	});

	it.each([
		["a 403 error", createRequestError(403)],
		["an error without a status", new Error("Oops")],
		["null", null],
		["a string", "404"],
	])("returns false for %s", (_, error) => {
		expect(isNotFound(error)).toBe(false);
	});
});
