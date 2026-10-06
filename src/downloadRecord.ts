import type { ActionContext, Octokit } from "./types.ts";

import {
	parseRecord,
	recordFileName,
	recordMaximumBytes,
	type ReviewRecord,
} from "./record.ts";

export interface DownloadRecordSettings {
	context: ActionContext;
	fetcher?: typeof fetch;
	octokit: Octokit;
	runId: number;
	token: string;
}

/**
 * Downloads the untrusted record uploaded by a pull_request_review workflow run.
 * Never unzips or writes to disk: the record must be a small JSON file that wasn't zipped.
 */
export async function downloadRecord({
	context,
	fetcher = fetch,
	octokit,
	runId,
	token,
}: DownloadRecordSettings): Promise<ReviewRecord | undefined> {
	const { owner, repo } = context.repo;
	const { data } = await octokit.rest.actions.listWorkflowRunArtifacts({
		name: recordFileName,
		owner,
		per_page: 100,
		repo,
		run_id: runId,
	});

	const artifacts = data.artifacts.filter(
		(artifact) => artifact.name === recordFileName,
	);

	if (!artifacts.length) {
		return undefined;
	}

	if (artifacts.length > 1) {
		throw new Error(
			`Expected one ${recordFileName} artifact, but found ${artifacts.length}.`,
		);
	}

	const [artifact] = artifacts;

	if (artifact.expired) {
		throw new Error(`The ${recordFileName} artifact has expired.`);
	}

	if (artifact.size_in_bytes > recordMaximumBytes) {
		throw new Error(`The ${recordFileName} artifact is too large.`);
	}

	const redirect = await fetcher(
		`${context.apiUrl}/repos/${owner}/${repo}/actions/artifacts/${artifact.id}/zip`,
		{
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${token}`,
			},
			redirect: "manual",
		},
	);
	const location = redirect.headers.get("location");

	if (redirect.status !== 302 || !location) {
		throw new Error(
			`Could not locate the ${recordFileName} artifact download (HTTP ${redirect.status}).`,
		);
	}

	const response = await fetcher(location);

	if (!response.ok) {
		throw new Error(
			`Could not download the ${recordFileName} artifact (HTTP ${response.status}).`,
		);
	}

	const bytes = await readLimitedBytes(response, recordMaximumBytes);

	if (!bytes) {
		throw new Error(`The ${recordFileName} artifact is too large.`);
	}

	let text: string;

	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new Error(`The ${recordFileName} artifact is not valid UTF-8.`);
	}

	const record = parseRecord(text);

	if (!record) {
		throw new Error(`The ${recordFileName} artifact is not a valid record.`);
	}

	return record;
}

async function readLimitedBytes(response: Response, maximum: number) {
	const chunks: Uint8Array[] = [];
	let total = 0;

	for await (const chunk of response.body ?? []) {
		total += chunk.byteLength;

		if (total > maximum) {
			return undefined;
		}

		chunks.push(chunk);
	}

	return Buffer.concat(chunks);
}
