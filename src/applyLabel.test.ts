import { describe, expect, it, vi } from "vitest";

import type { ReviewRecord } from "./record.ts";

import { applyLabel } from "./applyLabel.ts";
import {
	createContext,
	createMockOctokit,
	createRequestError,
} from "./testUtils.ts";

vi.mock("@actions/core");

const headSha = "a".repeat(40);
const otherSha = "b".repeat(40);
const pullRequestUrl =
	"https://api.github.com/repos/test-owner/test-repo/pulls/1";

interface Scenario {
	pullRequest?: Error | Record<string, unknown>;
	record?: ReviewRecord;
	review?: Error | Record<string, unknown>;
	workflowRun?: Record<string, unknown>;
}

function createWorkflowRun(overrides: Record<string, unknown> = {}) {
	return {
		conclusion: "success",
		event: "pull_request_review",
		head_sha: headSha,
		id: 456,
		...overrides,
	};
}

async function runApplyLabel(scenario: Scenario = {}) {
	const {
		pullRequest = {},
		record = { pullRequest: 1, review: 2 },
		review = {},
		workflowRun = createWorkflowRun(),
	} = scenario;
	const { mocks, octokit } = createMockOctokit();
	const downloadRecord = vi
		.fn()
		.mockResolvedValue("record" in scenario ? scenario.record : record);

	if (pullRequest instanceof Error) {
		mocks.getPullRequest.mockRejectedValue(pullRequest);
	} else {
		mocks.getPullRequest.mockResolvedValue({
			data: {
				head: { sha: headSha },
				state: "open",
				url: pullRequestUrl,
				...pullRequest,
			},
		});
	}

	if (review instanceof Error) {
		mocks.getReview.mockRejectedValue(review);
	} else {
		mocks.getReview.mockResolvedValue({
			data: {
				commit_id: headSha,
				pull_request_url: pullRequestUrl,
				state: "CHANGES_REQUESTED",
				...review,
			},
		});
	}

	await applyLabel({
		context: createContext("workflow_run", {
			workflow_run:
				"workflowRun" in scenario ? scenario.workflowRun : workflowRun,
		}),
		downloadRecord,
		label: "status: waiting for author",
		octokit,
	});

	return { downloadRecord, mocks };
}

describe(applyLabel, () => {
	it("does nothing when there is no workflow run", async () => {
		const { downloadRecord, mocks } = await runApplyLabel({
			workflowRun: undefined,
		});

		expect(downloadRecord).not.toHaveBeenCalled();
		expect(mocks.addLabels).not.toHaveBeenCalled();
	});

	it.each(["pull_request", "pull_request_target", "push", "workflow_run"])(
		"does nothing when the workflow run was triggered by %s",
		async (event) => {
			const { downloadRecord, mocks } = await runApplyLabel({
				workflowRun: createWorkflowRun({ event }),
			});

			expect(downloadRecord).not.toHaveBeenCalled();
			expect(mocks.addLabels).not.toHaveBeenCalled();
		},
	);

	it.each(["failure", "skipped", "cancelled", null])(
		"does nothing when the workflow run concluded with %s",
		async (conclusion) => {
			const { downloadRecord, mocks } = await runApplyLabel({
				workflowRun: createWorkflowRun({ conclusion }),
			});

			expect(downloadRecord).not.toHaveBeenCalled();
			expect(mocks.addLabels).not.toHaveBeenCalled();
		},
	);

	it("downloads the record from the workflow run", async () => {
		const { downloadRecord } = await runApplyLabel();

		expect(downloadRecord).toHaveBeenCalledWith(456);
	});

	it("does nothing when the workflow run did not record a review", async () => {
		const { mocks } = await runApplyLabel({ record: undefined });

		expect(mocks.getPullRequest).not.toHaveBeenCalled();
		expect(mocks.addLabels).not.toHaveBeenCalled();
	});

	it("does nothing when the recorded pull request does not exist", async () => {
		const { mocks } = await runApplyLabel({
			pullRequest: createRequestError(404),
		});

		expect(mocks.addLabels).not.toHaveBeenCalled();
	});

	it("rethrows non-404 errors from getting the pull request", async () => {
		await expect(
			runApplyLabel({ pullRequest: createRequestError(500) }),
		).rejects.toThrow("HTTP 500");
	});

	it("does nothing when the recorded review does not exist", async () => {
		const { mocks } = await runApplyLabel({ review: createRequestError(404) });

		expect(mocks.addLabels).not.toHaveBeenCalled();
	});

	it("rethrows non-404 errors from getting the review", async () => {
		await expect(
			runApplyLabel({ review: createRequestError(500) }),
		).rejects.toThrow("HTTP 500");
	});

	it("does nothing when the recorded review is on a different pull request", async () => {
		const { mocks } = await runApplyLabel({
			review: {
				pull_request_url:
					"https://api.github.com/repos/test-owner/test-repo/pulls/2",
			},
		});

		expect(mocks.addLabels).not.toHaveBeenCalled();
	});

	it.each([
		"APPROVED",
		"COMMENTED",
		"DISMISSED",
		"PENDING",
		"changes_requested",
	])("does nothing when the recorded review state is %s", async (state) => {
		const { mocks } = await runApplyLabel({ review: { state } });

		expect(mocks.addLabels).not.toHaveBeenCalled();
	});

	it("does nothing when neither the review nor the pull request is on the workflow run's commit", async () => {
		const { mocks } = await runApplyLabel({
			pullRequest: { head: { sha: otherSha } },
			review: { commit_id: otherSha },
		});

		expect(mocks.addLabels).not.toHaveBeenCalled();
	});

	it("adds the label when only the review is on the workflow run's commit", async () => {
		const { mocks } = await runApplyLabel({
			pullRequest: { head: { sha: otherSha } },
		});

		expect(mocks.addLabels).toHaveBeenCalled();
	});

	it("adds the label when only the pull request is on the workflow run's commit", async () => {
		const { mocks } = await runApplyLabel({ review: { commit_id: otherSha } });

		expect(mocks.addLabels).toHaveBeenCalled();
	});

	it("does nothing when the pull request is closed", async () => {
		const { mocks } = await runApplyLabel({ pullRequest: { state: "closed" } });

		expect(mocks.addLabels).not.toHaveBeenCalled();
	});

	it("adds the label when the review requested changes on the workflow run's commit", async () => {
		const { mocks } = await runApplyLabel();

		expect(mocks.getPullRequest).toHaveBeenCalledWith({
			owner: "test-owner",
			pull_number: 1,
			repo: "test-repo",
		});
		expect(mocks.getReview).toHaveBeenCalledWith({
			owner: "test-owner",
			pull_number: 1,
			repo: "test-repo",
			review_id: 2,
		});
		expect(mocks.addLabels).toHaveBeenCalledWith({
			issue_number: 1,
			labels: ["status: waiting for author"],
			owner: "test-owner",
			repo: "test-repo",
		});
	});
});
