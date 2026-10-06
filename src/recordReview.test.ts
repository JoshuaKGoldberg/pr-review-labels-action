import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { recordReview } from "./recordReview.ts";
import { createContext } from "./testUtils.ts";

vi.mock("@actions/core");

function createUploader() {
	const contents: string[] = [];
	const uploadArtifact = vi.fn(
		async (_name: string, files: string[], rootDirectory: string) => {
			expect(files.map((file) => path.dirname(file))).toEqual([rootDirectory]);
			contents.push(await fs.readFile(files[0], "utf8"));
		},
	);

	return { contents, uploader: { uploadArtifact } };
}

describe(recordReview, () => {
	it("does nothing when the action is not submitted", async () => {
		const { uploader } = createUploader();

		await recordReview(
			createContext("pull_request_review", {
				action: "edited",
				pull_request: { number: 1 },
				review: { id: 2, state: "changes_requested" },
			}),
			uploader,
		);

		expect(uploader.uploadArtifact).not.toHaveBeenCalled();
	});

	it.each([
		"approved",
		"commented",
		"dismissed",
		"CHANGES_REQUESTED",
		undefined,
	])("does nothing when the review state is %s", async (state) => {
		const { uploader } = createUploader();

		await recordReview(
			createContext("pull_request_review", {
				action: "submitted",
				pull_request: { number: 1 },
				review: { id: 2, state },
			}),
			uploader,
		);

		expect(uploader.uploadArtifact).not.toHaveBeenCalled();
	});

	it("does nothing when the review is missing", async () => {
		const { uploader } = createUploader();

		await recordReview(
			createContext("pull_request_review", {
				action: "submitted",
				pull_request: { number: 1 },
			}),
			uploader,
		);

		expect(uploader.uploadArtifact).not.toHaveBeenCalled();
	});

	it("throws when the pull request is missing", async () => {
		const { uploader } = createUploader();

		await expect(
			recordReview(
				createContext("pull_request_review", {
					action: "submitted",
					review: { id: 2, state: "changes_requested" },
				}),
				uploader,
			),
		).rejects.toThrow("missing its pull_request");
	});

	it("uploads an unzipped record when the review requested changes", async () => {
		const { contents, uploader } = createUploader();

		await recordReview(
			createContext("pull_request_review", {
				action: "submitted",
				pull_request: { number: 1 },
				review: { id: 2, state: "changes_requested" },
			}),
			uploader,
		);

		expect(uploader.uploadArtifact).toHaveBeenCalledWith(
			"pr-review-labels-record.json",
			[expect.stringMatching(/pr-review-labels-record\.json$/)],
			expect.any(String),
			{ retentionDays: 1, skipArchive: true },
		);
		expect(contents).toEqual([`{"pullRequest":1,"review":2}`]);
	});
});
