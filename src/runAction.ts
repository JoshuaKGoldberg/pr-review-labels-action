import { DefaultArtifactClient } from "@actions/artifact";
import * as core from "@actions/core";
import * as github from "@actions/github";

import type { ActionContext } from "./types.ts";

import { applyLabel } from "./applyLabel.ts";
import { downloadRecord } from "./downloadRecord.ts";
import { recordReview } from "./recordReview.ts";
import { removeLabel } from "./removeLabel.ts";

export async function runAction(context: ActionContext) {
	switch (context.eventName) {
		case "pull_request":
		case "pull_request_target": {
			const { label, octokit } = getPrivilegedSettings();
			await removeLabel({ context, label, octokit });
			break;
		}

		case "pull_request_review":
			await recordReview(context, new DefaultArtifactClient());
			break;

		case "workflow_run": {
			const { label, octokit, token } = getPrivilegedSettings();
			await applyLabel({
				context,
				downloadRecord: (runId) =>
					downloadRecord({ context, octokit, runId, token }),
				label,
				octokit,
			});
			break;
		}

		default:
			throw new Error(
				`Unsupported event: ${context.eventName}. Run this action on pull_request_review, pull_request_target, or workflow_run.`,
			);
	}
}

function getPrivilegedSettings() {
	const label = core.getInput("label", { required: true });
	const token = core.getInput("github-token", { required: true });

	return { label, octokit: github.getOctokit(token), token };
}
