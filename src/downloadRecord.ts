import { HttpClient } from "@actions/http-client";

import type { ActionContext, Octokit } from "./types.ts";

import {
	parseRecord,
	recordFileName,
	recordMaximumBytes,
	type ReviewRecord,
} from "./record.ts";

const requestTimeout = 30_000;

/**
 * Thrown when an untrusted record artifact can't be used.
 */
export interface BlobResponse {
	body: AsyncIterable<Uint8Array>;
	statusCode: number | undefined;
}

export interface DownloadRecordSettings {
	context: ActionContext;
	getBlob?: (url: string) => Promise<BlobResponse>;
	octokit: Octokit;
	runId: number;
}

export class InvalidRecordError extends Error {}

/**
 * Downloads the untrusted record uploaded by a pull_request_review workflow run.
 * Never unzips or writes to disk: the record must be a small JSON file that wasn't zipped.
 */
export async function downloadRecord({
	context,
	getBlob = getBlobWithHttpClient,
	octokit,
	runId,
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
		throw new InvalidRecordError(
			`Expected one ${recordFileName} artifact, but found ${artifacts.length}.`,
		);
	}

	const [artifact] = artifacts;

	if (artifact.expired) {
		throw new InvalidRecordError(`The ${recordFileName} artifact has expired.`);
	}

	// The uploader reports this size, so the download is also capped below.
	if (artifact.size_in_bytes > recordMaximumBytes) {
		throw new InvalidRecordError(
			`The ${recordFileName} artifact is too large.`,
		);
	}

	const { headers, status } = await octokit.rest.actions.downloadArtifact({
		archive_format: "zip",
		artifact_id: artifact.id,
		owner,
		repo,
		request: {
			redirect: "manual",
			signal: AbortSignal.timeout(requestTimeout),
		},
	});

	if (!headers.location) {
		throw new Error(
			`Could not locate the ${recordFileName} artifact download (HTTP ${status}).`,
		);
	}

	const response = await getBlob(headers.location);

	if (response.statusCode !== 200) {
		throw new Error(
			`Could not download the ${recordFileName} artifact (HTTP ${String(response.statusCode)}).`,
		);
	}

	const bytes = await readLimitedBytes(response.body, recordMaximumBytes);

	if (!bytes) {
		throw new InvalidRecordError(
			`The ${recordFileName} artifact is too large.`,
		);
	}

	let text: string;

	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new InvalidRecordError(
			`The ${recordFileName} artifact is not valid UTF-8.`,
		);
	}

	const record = parseRecord(text);

	if (!record) {
		throw new InvalidRecordError(
			`The ${recordFileName} artifact is not a valid record.`,
		);
	}

	return record;
}

export async function getBlobWithHttpClient(
	url: string,
): Promise<BlobResponse> {
	const client = new HttpClient("pr-review-labels-action", [], {
		socketTimeout: requestTimeout,
	});
	const { message } = await client.get(url);

	return {
		body: message as AsyncIterable<Uint8Array>,
		statusCode: message.statusCode,
	};
}

async function readLimitedBytes(
	body: AsyncIterable<Uint8Array>,
	maximum: number,
) {
	const chunks: Uint8Array[] = [];
	let total = 0;

	for await (const chunk of body) {
		total += chunk.byteLength;

		if (total > maximum) {
			return undefined;
		}

		chunks.push(chunk);
	}

	return Buffer.concat(chunks);
}
