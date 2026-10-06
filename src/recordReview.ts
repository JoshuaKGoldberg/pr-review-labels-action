import * as core from "@actions/core";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { ActionContext } from "./types.ts";

import { recordFileName, type ReviewRecord } from "./record.ts";

export interface ArtifactUploader {
	uploadArtifact(
		name: string,
		files: string[],
		rootDirectory: string,
		options: { retentionDays: number; skipArchive: boolean },
	): Promise<unknown>;
}

/**
 * Runs in the unprivileged pull_request_review workflow.
 * Uploads the PR and review IDs for the privileged workflow_run workflow to verify.
 */
export async function recordReview(
	context: ActionContext,
	uploader: ArtifactUploader,
) {
	const { action, pull_request } = context.payload;
	const review = context.payload.review as
		undefined | { id: number; state: string };

	if (action !== "submitted") {
		core.info(`Ignoring pull_request_review action: ${String(action)}.`);
		return;
	}

	if (review?.state !== "changes_requested") {
		core.info(
			"The review didn't request changes, so there's nothing to record.",
		);
		return;
	}

	if (!pull_request) {
		throw new Error(
			"The pull_request_review payload is missing its pull_request.",
		);
	}

	const record: ReviewRecord = {
		pullRequest: pull_request.number,
		review: review.id,
	};

	const directory = await fs.mkdtemp(
		path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), "pr-review-labels-"),
	);
	const filePath = path.join(directory, recordFileName);

	await fs.writeFile(filePath, JSON.stringify(record));
	await uploader.uploadArtifact(recordFileName, [filePath], directory, {
		retentionDays: 1,
		skipArchive: true,
	});

	core.info(
		`Recorded review ${record.review} requesting changes on PR #${record.pullRequest}.`,
	);
}
