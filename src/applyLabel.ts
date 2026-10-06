import * as core from "@actions/core";

import type { ReviewRecord } from "./record.ts";
import type { ActionContext, Octokit } from "./types.ts";

import { InvalidRecordError } from "./downloadRecord.ts";
import { isNotFound } from "./isNotFound.ts";

const maintainerAssociations = new Set(["COLLABORATOR", "MEMBER", "OWNER"]);

export interface ApplyLabelSettings {
	context: ActionContext;
	downloadRecord: (runId: number) => Promise<ReviewRecord | undefined>;
	label: string;
	octokit: Octokit;
}

interface TimelineEvent {
	event?: string;
	id?: number;
	state?: string;
	user?: null | { id: number };
}

/**
 * Runs in the privileged workflow_run workflow.
 * Treats the record as untrusted: the label is only added if GitHub's API confirms
 * a maintainer's review requesting changes on that PR, for the commit the recording
 * run ran on, with no newer review request or decision from that reviewer.
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

	if (!maintainerAssociations.has(review.author_association)) {
		core.info(
			`Review ${record.review} on PR #${record.pullRequest} is from a ${review.author_association} reviewer, not a collaborator, member, or owner.`,
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

	const timeline: TimelineEvent[] = await octokit.paginate(
		octokit.rest.issues.listEventsForTimeline,
		{
			...context.repo,
			issue_number: record.pullRequest,
			per_page: 100,
		},
	);
	const reviewIndex = timeline.findIndex(
		(event) => event.event === "reviewed" && event.id === review.id,
	);

	if (reviewIndex === -1) {
		core.warning(
			`Review ${record.review} is not in PR #${record.pullRequest}'s timeline.`,
		);
		return;
	}

	const newerEvent = timeline
		.slice(reviewIndex + 1)
		.find(
			(event) =>
				event.event === "review_requested" ||
				(event.event === "reviewed" &&
					event.user?.id === review.user?.id &&
					event.state?.toLowerCase() !== "commented"),
		);

	if (newerEvent) {
		core.info(
			`PR #${record.pullRequest} has a newer ${String(newerEvent.event)} event than review ${record.review}, so it won't be labeled.`,
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
