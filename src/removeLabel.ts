import * as core from "@actions/core";

import type { ActionContext, Octokit } from "./types.ts";

import { isNotFound } from "./isNotFound.ts";

export interface RemoveLabelSettings {
	context: ActionContext;
	label: string;
	octokit: Octokit;
}

/**
 * Runs in the privileged pull_request_target workflow when a review is requested.
 */
export async function removeLabel({
	context,
	label,
	octokit,
}: RemoveLabelSettings) {
	const { action, pull_request } = context.payload;

	if (action !== "review_requested") {
		core.info(`Ignoring ${context.eventName} action: ${String(action)}.`);
		return;
	}

	if (!pull_request) {
		throw new Error(
			`The ${context.eventName} payload is missing its pull_request.`,
		);
	}

	const issueNumber = pull_request.number;

	try {
		await octokit.rest.issues.removeLabel({
			...context.repo,
			issue_number: issueNumber,
			name: label,
		});
	} catch (error) {
		if (isNotFound(error)) {
			core.info(`PR #${issueNumber} doesn't have '${label}'.`);
			return;
		}

		throw error;
	}

	core.info(`Removed '${label}' from PR #${issueNumber}.`);
}
