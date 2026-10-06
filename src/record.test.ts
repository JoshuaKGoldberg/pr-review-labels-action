import { describe, expect, it } from "vitest";

import { parseRecord } from "./record.ts";

describe(parseRecord, () => {
	it("returns the record when it is exactly a valid record", () => {
		expect(parseRecord(`{"pullRequest":1,"review":2}`)).toEqual({
			pullRequest: 1,
			review: 2,
		});
	});

	it.each([
		["invalid JSON", "{"],
		["an empty string", ""],
		["null", "null"],
		["an array", "[1,2]"],
		["a number", "1"],
		["a missing review", `{"pullRequest":1}`],
		["an extra property", `{"extra":0,"pullRequest":1,"review":2}`],
		["a __proto__ property", `{"__proto__":{},"pullRequest":1,"review":2}`],
		["a string ID", `{"pullRequest":"1","review":2}`],
		["a zero ID", `{"pullRequest":0,"review":2}`],
		["a negative ID", `{"pullRequest":-1,"review":2}`],
		["a fractional ID", `{"pullRequest":1.5,"review":2}`],
		["an unsafe integer ID", `{"pullRequest":9007199254740993,"review":2}`],
		[
			"a numeric string with injection",
			`{"pullRequest":"1; rm -rf /","review":2}`,
		],
	])("returns undefined for %s", (_, text) => {
		expect(parseRecord(text)).toBeUndefined();
	});
});
