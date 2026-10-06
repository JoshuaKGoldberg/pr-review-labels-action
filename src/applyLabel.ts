import * as core from "@actions/core";

import type { ReviewRecord } from "./record.ts";
import type { ActionContext, Octokit } from "./types.ts";

import { InvalidRecordError } from "./InvalidRecordError.ts";
import { isNotFound } from "./isNotFound.ts";

const maintainerPermissions = new Set(["admin", "write"]);

const newerReviewStates = new Set([
	"APPROVED",
	"CHANGES_REQUESTED",
	"DISMISSED",
]);

export interface ApplyLabelSettings {
	context: ActionContext;
	downloadRecord: (runId: number) => Promise<ReviewRecord | undefined>;
	label: string;
	octokit: Octokit;
}

/**
 * Runs in the privileged workflow_run workflow.
 * Treats the record as untrusted: the label is only added if GitHub's API confirms
 * a review requesting changes on that PR from someone with write access, for the
 * commit the recording run ran on, with nothing newer that would undo it.
 */
export async function applyLabel({
	context,
	downloadRecord,
	label,
	octokit,
}: ApplyLabelSettings) {
	const run = context.payload.workflow_run as
		| undefined
		| {
				conclusion: null | string;
				event: string;
				head_sha: string;
				id: number;
		  };

	if (run?.event !== "pull_request_review") {
		core.info(
			`Ignoring a workflow run triggered by ${String(run?.event)}, not pull_request_review.`,
		);
		return;
	}

	if (run.conclusion !== "success") {
		core.info(
			`Ignoring a workflow run that concluded with ${String(run.conclusion)}.`,
		);
		return;
	}

	let record: ReviewRecord | undefined;

	try {
		record = await downloadRecord(run.id);
	} catch (error) {
		if (error instanceof InvalidRecordError) {
			core.warning(error.message);
			return;
		}

		throw error;
	}

	if (!record) {
		core.info(
			"The workflow run didn't record a review, so there's nothing to label.",
		);
		return;
	}

	const pullRequest = await getOrUndefined(() =>
		octokit.rest.pulls.get({
			...context.repo,
			pull_number: record.pullRequest,
		}),
	);

	if (!pullRequest) {
		core.warning(`Recorded PR #${record.pullRequest} does not exist.`);
		return;
	}

	if (pullRequest.state !== "open") {
		core.info(
			`PR #${record.pullRequest} is ${pullRequest.state}, so it won't be labeled.`,
		);
		return;
	}

	const review = await getOrUndefined(() =>
		octokit.rest.pulls.getReview({
			...context.repo,
			pull_number: record.pullRequest,
			review_id: record.review,
		}),
	);

	if (review?.pull_request_url !== pullRequest.url) {
		core.warning(
			`Recorded review ${record.review} does not exist on PR #${record.pullRequest}.`,
		);
		return;
	}

	if (review.state !== "CHANGES_REQUESTED") {
		core.info(
			`Review ${record.review} on PR #${record.pullRequest} is ${review.state}, not CHANGES_REQUESTED.`,
		);
		return;
	}

	if (!review.user || !review.submitted_at) {
		core.info(
			`Review ${record.review} on PR #${record.pullRequest} has no reviewer or submission time.`,
		);
		return;
	}

	if (
		review.commit_id !== run.head_sha &&
		pullRequest.head.sha !== run.head_sha
	) {
		core.info(
			`Neither review ${record.review} nor PR #${record.pullRequest} is on commit ${run.head_sha}, which the workflow run ran on.`,
		);
		return;
	}

	const reviewer = review.user;
	const permission = await getOrUndefined(() =>
		octokit.rest.repos.getCollaboratorPermissionLevel({
			...context.repo,
			username: reviewer.login,
		}),
	);

	if (!maintainerPermissions.has(permission?.permission ?? "none")) {
		core.info(
			`Review ${record.review} on PR #${record.pullRequest} is from a reviewer without write access.`,
		);
		return;
	}

	const submittedAt = Date.parse(review.submitted_at);
	const isSinceReview = (time: null | string | undefined) =>
		!!time && Date.parse(time) >= submittedAt;

	const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
		...context.repo,
		per_page: 100,
		pull_number: record.pullRequest,
	});

	if (
		reviews.some(
			(other) =>
				other.id !== review.id &&
				other.user?.id === reviewer.id &&
				newerReviewStates.has(other.state) &&
				isSinceReview(other.submitted_at),
		)
	) {
		core.info(
			`The reviewer submitted a newer review on PR #${record.pullRequest} than review ${record.review}, so it won't be labeled.`,
		);
		return;
	}

	const events = await octokit.paginate(octokit.rest.issues.listEvents, {
		...context.repo,
		issue_number: record.pullRequest,
		per_page: 100,
	});
	const newerEvent = events.find(
		(event) =>
			isSinceReview(event.created_at) &&
			(event.event === "review_requested" ||
				(event.event === "unlabeled" &&
					"label" in event &&
					event.label.name === label)),
	);

	if (newerEvent) {
		core.info(
			`PR #${record.pullRequest} has a newer event (${newerEvent.event}) than review ${record.review}, so it won't be labeled.`,
		);
		return;
	}

	await octokit.rest.issues.addLabels({
		...context.repo,
		issue_number: record.pullRequest,
		labels: [label],
	});

	core.info(`Added '${label}' to PR #${record.pullRequest}.`);
}

async function getOrUndefined<T>(request: () => Promise<{ data: T }>) {
	try {
		return (await request()).data;
	} catch (error) {
		if (isNotFound(error)) {
			return undefined;
		}

		throw error;
	}
}
