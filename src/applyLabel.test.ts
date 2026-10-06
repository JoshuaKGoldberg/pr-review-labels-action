import * as core from "@actions/core";
import { describe, expect, it, vi } from "vitest";

import { applyLabel } from "./applyLabel.ts";
import { InvalidRecordError } from "./downloadRecord.ts";
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
const reviewer = { id: 10 };
const recordedReviewEvent = {
	event: "reviewed",
	id: 2,
	state: "changes_requested",
	user: reviewer,
};

interface Scenario {
	pullRequest?: Error | Record<string, unknown>;
	record?: Error | Record<string, unknown>;
	review?: Error | Record<string, unknown>;
	timeline?: Record<string, unknown>[];
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
		review = {},
		timeline = [recordedReviewEvent],
	} = scenario;
	const record =
		"record" in scenario ? scenario.record : { pullRequest: 1, review: 2 };
	const workflowRun =
		"workflowRun" in scenario ? scenario.workflowRun : createWorkflowRun();
	const { mocks, octokit } = createMockOctokit();
	const downloadRecord = vi.fn(() =>
		record instanceof Error ? Promise.reject(record) : Promise.resolve(record),
	);

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
				author_association: "OWNER",
				commit_id: headSha,
				id: 2,
				pull_request_url: pullRequestUrl,
				state: "CHANGES_REQUESTED",
				user: reviewer,
				...review,
			},
		});
	}

	mocks.paginate.mockResolvedValue(timeline);

	await applyLabel({
		context: createContext("workflow_run", { workflow_run: workflowRun }),
		downloadRecord: downloadRecord as never,
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

	it.each(["action_required", "cancelled", "failure", "skipped", null])(
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

	it("warns without failing when the record is invalid", async () => {
		const { mocks } = await runApplyLabel({
			record: new InvalidRecordError("Invalid!"),
		});

		expect(core.warning).toHaveBeenCalledWith("Invalid!");
		expect(mocks.getPullRequest).not.toHaveBeenCalled();
		expect(mocks.addLabels).not.toHaveBeenCalled();
	});

	it("rethrows other errors from downloading the record", async () => {
		await expect(
			runApplyLabel({ record: new Error("Network!") }),
		).rejects.toThrow("Network!");
	});

	it("does nothing when the recorded pull request does not exist", async () => {
		const { mocks } = await runApplyLabel({
			pullRequest: createRequestError(404),
		});

		expect(mocks.getReview).not.toHaveBeenCalled();
		expect(mocks.addLabels).not.toHaveBeenCalled();
	});

	it("rethrows non-404 errors from getting the pull request", async () => {
		await expect(
			runApplyLabel({ pullRequest: createRequestError(500) }),
		).rejects.toThrow("HTTP 500");
	});

	it("does nothing when the pull request is closed", async () => {
		const { mocks } = await runApplyLabel({
			pullRequest: { head: { sha: otherSha }, state: "closed" },
		});

		expect(core.warning).not.toHaveBeenCalled();
		expect(mocks.getReview).not.toHaveBeenCalled();
		expect(mocks.addLabels).not.toHaveBeenCalled();
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

	it.each([
		"CONTRIBUTOR",
		"FIRST_TIME_CONTRIBUTOR",
		"FIRST_TIMER",
		"MANNEQUIN",
		"NONE",
	])(
		"does nothing when the reviewer's association is %s",
		async (author_association) => {
			const { mocks } = await runApplyLabel({ review: { author_association } });

			expect(mocks.addLabels).not.toHaveBeenCalled();
		},
	);

	it.each(["COLLABORATOR", "MEMBER", "OWNER"])(
		"adds the label when the reviewer's association is %s",
		async (author_association) => {
			const { mocks } = await runApplyLabel({ review: { author_association } });

			expect(mocks.addLabels).toHaveBeenCalled();
		},
	);

	it("does nothing when neither the review nor the pull request is on the workflow run's commit", async () => {
		const { mocks } = await runApplyLabel({
			pullRequest: { head: { sha: otherSha } },
			review: { commit_id: otherSha },
		});

		expect(mocks.addLabels).not.toHaveBeenCalled();
	});

	it("does nothing when the review has no commit and the pull request moved on", async () => {
		const { mocks } = await runApplyLabel({
			pullRequest: { head: { sha: otherSha } },
			review: { commit_id: null },
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

	it("reads the pull request's timeline", async () => {
		const { mocks } = await runApplyLabel();

		expect(mocks.paginate).toHaveBeenCalledWith(mocks.listEventsForTimeline, {
			issue_number: 1,
			owner: "test-owner",
			per_page: 100,
			repo: "test-repo",
		});
	});

	it("does nothing when the review is not in the timeline", async () => {
		const { mocks } = await runApplyLabel({
			timeline: [{ ...recordedReviewEvent, id: 3 }],
		});

		expect(mocks.addLabels).not.toHaveBeenCalled();
	});

	it("does nothing when a review was requested after the review", async () => {
		const { mocks } = await runApplyLabel({
			timeline: [recordedReviewEvent, { event: "review_requested" }],
		});

		expect(mocks.addLabels).not.toHaveBeenCalled();
	});

	it.each(["approved", "changes_requested", "dismissed"])(
		"does nothing when the reviewer submitted a newer %s review",
		async (state) => {
			const { mocks } = await runApplyLabel({
				timeline: [
					recordedReviewEvent,
					{ event: "reviewed", id: 3, state, user: reviewer },
				],
			});

			expect(mocks.addLabels).not.toHaveBeenCalled();
		},
	);

	it("adds the label when the reviewer only commented afterwards", async () => {
		const { mocks } = await runApplyLabel({
			timeline: [
				recordedReviewEvent,
				{ event: "reviewed", id: 3, state: "commented", user: reviewer },
			],
		});

		expect(mocks.addLabels).toHaveBeenCalled();
	});

	it("adds the label when another reviewer reviewed afterwards", async () => {
		const { mocks } = await runApplyLabel({
			timeline: [
				recordedReviewEvent,
				{ event: "reviewed", id: 3, state: "approved", user: { id: 11 } },
			],
		});

		expect(mocks.addLabels).toHaveBeenCalled();
	});

	it("adds the label when a review was requested before the review", async () => {
		const { mocks } = await runApplyLabel({
			timeline: [
				{ event: "review_requested" },
				recordedReviewEvent,
				{ event: "commented" },
				{ event: "labeled" },
			],
		});

		expect(mocks.addLabels).toHaveBeenCalled();
	});

	it("adds the label when a maintainer requested changes on the workflow run's commit", async () => {
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
