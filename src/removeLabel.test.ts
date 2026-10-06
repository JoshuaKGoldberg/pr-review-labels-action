import { describe, expect, it, vi } from "vitest";

import { removeLabel } from "./removeLabel.ts";
import {
	createContext,
	createMockOctokit,
	createRequestError,
} from "./testUtils.ts";

vi.mock("@actions/core");

describe(removeLabel, () => {
	it.each(["opened", "synchronize", "review_request_removed"])(
		"does nothing when the action is %s",
		async (action) => {
			const { mocks, octokit } = createMockOctokit();

			await removeLabel({
				context: createContext("pull_request_target", {
					action,
					pull_request: { number: 1 },
				}),
				label: "status: waiting for author",
				octokit,
			});

			expect(mocks.removeLabel).not.toHaveBeenCalled();
		},
	);

	it("throws when the pull request is missing", async () => {
		const { octokit } = createMockOctokit();

		await expect(
			removeLabel({
				context: createContext("pull_request_target", {
					action: "review_requested",
				}),
				label: "status: waiting for author",
				octokit,
			}),
		).rejects.toThrow("missing its pull_request");
	});

	it("removes the label when a review is requested", async () => {
		const { mocks, octokit } = createMockOctokit();

		await removeLabel({
			context: createContext("pull_request_target", {
				action: "review_requested",
				pull_request: { number: 1 },
			}),
			label: "status: waiting for author",
			octokit,
		});

		expect(mocks.removeLabel).toHaveBeenCalledWith({
			issue_number: 1,
			name: "status: waiting for author",
			owner: "test-owner",
			repo: "test-repo",
		});
	});

	it("does not throw when the label is not on the pull request", async () => {
		const { mocks, octokit } = createMockOctokit();
		mocks.removeLabel.mockRejectedValue(createRequestError(404));

		await expect(
			removeLabel({
				context: createContext("pull_request_target", {
					action: "review_requested",
					pull_request: { number: 1 },
				}),
				label: "status: waiting for author",
				octokit,
			}),
		).resolves.toBeUndefined();
	});

	it("rethrows other errors", async () => {
		const { mocks, octokit } = createMockOctokit();
		mocks.removeLabel.mockRejectedValue(createRequestError(403));

		await expect(
			removeLabel({
				context: createContext("pull_request_target", {
					action: "review_requested",
					pull_request: { number: 1 },
				}),
				label: "status: waiting for author",
				octokit,
			}),
		).rejects.toThrow("HTTP 403");
	});
});
