import type { AddressInfo } from "node:net";

import * as http from "node:http";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	type BlobResponse,
	downloadRecord,
	getBlobWithHttpClient,
} from "./downloadRecord.ts";
import { InvalidRecordError } from "./InvalidRecordError.ts";
import {
	createContext,
	createMockOctokit,
	createRequestError,
} from "./testUtils.ts";

const context = createContext("workflow_run", {});
const location = "https://blob.example.com/record?sig=abc";

function createArtifact(overrides: Record<string, unknown> = {}) {
	return {
		expired: false,
		id: 123,
		name: "pr-review-labels-record.json",
		size_in_bytes: 30,
		...overrides,
	};
}

function createBlob(
	...chunks: (string | Uint8Array)[]
): () => Promise<BlobResponse> {
	return () =>
		Promise.resolve({
			body: toAsyncIterable(
				chunks.map((chunk) =>
					typeof chunk === "string" ? Buffer.from(chunk) : chunk,
				),
			),
			statusCode: 200,
		});
}

async function runDownload(
	artifacts: ReturnType<typeof createArtifact>[],
	getBlob: Mock<(url: string) => Promise<BlobResponse>> = vi.fn(
		createBlob(`{"pullRequest":1,"review":2}`),
	),
	downloadHeaders: Record<string, string> = { location },
) {
	const { mocks, octokit } = createMockOctokit();
	mocks.listWorkflowRunArtifacts.mockResolvedValue({ data: { artifacts } });
	mocks.downloadArtifact.mockResolvedValue({
		headers: downloadHeaders,
		status: 302,
	});

	const result = await downloadRecord({
		context,
		getBlob,
		octokit,
		runId: 456,
	});

	return { getBlob, mocks, result };
}

function toAsyncIterable(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
	return {
		[Symbol.asyncIterator]() {
			const iterator = chunks[Symbol.iterator]();
			return { next: () => Promise.resolve(iterator.next()) };
		},
	};
}

describe(downloadRecord, () => {
	it("returns undefined when there is no record artifact", async () => {
		const { mocks, result } = await runDownload([]);

		expect(result).toBeUndefined();
		expect(mocks.downloadArtifact).not.toHaveBeenCalled();
	});

	it("ignores artifacts with other names", async () => {
		const { result } = await runDownload([createArtifact({ name: "other" })]);

		expect(result).toBeUndefined();
	});

	it("lists artifacts for the given workflow run", async () => {
		const { mocks } = await runDownload([createArtifact()]);

		expect(mocks.listWorkflowRunArtifacts).toHaveBeenCalledWith({
			name: "pr-review-labels-record.json",
			owner: "test-owner",
			per_page: 100,
			repo: "test-repo",
			run_id: 456,
		});
	});

	it("throws an InvalidRecordError when there are multiple record artifacts", async () => {
		await expect(
			runDownload([createArtifact(), createArtifact({ id: 124 })]),
		).rejects.toThrow(
			new InvalidRecordError(
				"Expected one pr-review-labels-record.json artifact, but found 2.",
			),
		);
	});

	it("throws an InvalidRecordError when the record artifact is expired", async () => {
		await expect(
			runDownload([createArtifact({ expired: true })]),
		).rejects.toBeInstanceOf(InvalidRecordError);
	});

	it("throws an InvalidRecordError without downloading when the artifact reports a large size", async () => {
		const getBlob = vi.fn(createBlob());

		await expect(
			runDownload([createArtifact({ size_in_bytes: 1025 })], getBlob),
		).rejects.toThrow(
			new InvalidRecordError(
				"The pr-review-labels-record.json artifact is too large.",
			),
		);
		expect(getBlob).not.toHaveBeenCalled();
	});

	it("asks the API for the download location without following the redirect", async () => {
		const { getBlob, mocks } = await runDownload([createArtifact()]);

		expect(mocks.downloadArtifact).toHaveBeenCalledWith({
			archive_format: "zip",
			artifact_id: 123,
			owner: "test-owner",
			repo: "test-repo",
			request: { redirect: "manual", signal: expect.any(AbortSignal) },
		});
		expect(getBlob).toHaveBeenCalledWith(location);
	});

	it("throws an InvalidRecordError when the API does not provide a location", async () => {
		await expect(
			runDownload([createArtifact()], undefined, {}),
		).rejects.toThrow(
			new InvalidRecordError(
				"Could not locate the pr-review-labels-record.json artifact download.",
			),
		);
	});

	it("throws an InvalidRecordError when the API cannot find the artifact", async () => {
		const { mocks, octokit } = createMockOctokit();
		mocks.listWorkflowRunArtifacts.mockResolvedValue({
			data: { artifacts: [createArtifact()] },
		});
		mocks.downloadArtifact.mockRejectedValue(createRequestError(410));

		await expect(
			downloadRecord({ context, octokit, runId: 456 }),
		).rejects.toThrow(
			new InvalidRecordError(
				"Could not locate the pr-review-labels-record.json artifact download (HTTP 410).",
			),
		);
	});

	it("rethrows server errors from the API", async () => {
		const { mocks, octokit } = createMockOctokit();
		mocks.listWorkflowRunArtifacts.mockResolvedValue({
			data: { artifacts: [createArtifact()] },
		});
		mocks.downloadArtifact.mockRejectedValue(createRequestError(500));

		await expect(
			downloadRecord({ context, octokit, runId: 456 }),
		).rejects.not.toBeInstanceOf(InvalidRecordError);
	});

	it.each([
		[403, InvalidRecordError],
		[404, InvalidRecordError],
		[500, Error],
		[undefined, Error],
	])(
		"throws when the download responds with %s",
		async (statusCode, ErrorType) => {
			const error: unknown = await runDownload(
				[createArtifact()],
				vi.fn(() => Promise.resolve({ body: toAsyncIterable([]), statusCode })),
			).catch((caught: unknown) => caught);

			expect(error).toBeInstanceOf(ErrorType);
			expect(error instanceof InvalidRecordError).toBe(
				ErrorType === InvalidRecordError,
			);
			expect(error).toHaveProperty(
				"message",
				`Could not download the pr-review-labels-record.json artifact (HTTP ${String(statusCode)}).`,
			);
		},
	);

	it("throws an InvalidRecordError when the download is larger than its reported size allows", async () => {
		await expect(
			runDownload([createArtifact()], vi.fn(createBlob("x".repeat(1025)))),
		).rejects.toThrow(
			new InvalidRecordError(
				"The pr-review-labels-record.json artifact is too large.",
			),
		);
	});

	it("stops reading a download as soon as it is too large", async () => {
		let reads = 0;
		const body: AsyncIterable<Uint8Array> = {
			[Symbol.asyncIterator]: () => ({
				next: () => {
					reads += 1;
					return Promise.resolve({ done: false, value: new Uint8Array(512) });
				},
			}),
		};
		const getBlob = () => Promise.resolve({ body, statusCode: 200 });

		await expect(
			runDownload([createArtifact()], vi.fn(getBlob)),
		).rejects.toBeInstanceOf(InvalidRecordError);
		expect(reads).toBe(3);
	});

	it("throws an InvalidRecordError when the download is not valid UTF-8", async () => {
		await expect(
			runDownload(
				[createArtifact()],
				vi.fn(createBlob(new Uint8Array([0xff, 0xfe]))),
			),
		).rejects.toThrow(
			new InvalidRecordError(
				"The pr-review-labels-record.json artifact is not valid UTF-8.",
			),
		);
	});

	it.each([
		["a zip archive", new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
		["an invalid record", `{"pullRequest":"1"}`],
		["empty", ""],
	])(
		"throws an InvalidRecordError when the download is %s",
		async (_, body) => {
			await expect(
				runDownload([createArtifact()], vi.fn(createBlob(body))),
			).rejects.toThrow(
				new InvalidRecordError(
					"The pr-review-labels-record.json artifact is not a valid record.",
				),
			);
		},
	);

	it("returns the record when the download is split across chunks", async () => {
		const { result } = await runDownload(
			[createArtifact()],
			vi.fn(createBlob(`{"pullRequest":1,`, `"review":2}`)),
		);

		expect(result).toEqual({ pullRequest: 1, review: 2 });
	});
});

describe(getBlobWithHttpClient, () => {
	let server: http.Server | undefined;

	afterEach(() => {
		server?.close();
		server = undefined;
	});

	async function serve(handler: http.RequestListener) {
		server = http.createServer(handler);
		await new Promise<void>((resolve) =>
			server?.listen(0, "127.0.0.1", resolve),
		);
		return `http://127.0.0.1:${(server.address() as AddressInfo).port}/blob`;
	}

	it("streams the response body and status code", async () => {
		const url = await serve((request, response) => {
			expect(request.headers.authorization).toBeUndefined();
			response.end(`{"pullRequest":1,"review":2}`);
		});

		const { result } = await runDownload(
			[createArtifact()],
			vi.fn(() => getBlobWithHttpClient(url)),
		);

		expect(result).toEqual({ pullRequest: 1, review: 2 });
	});

	it("reports a non-200 status code", async () => {
		const url = await serve((_, response) => {
			response.statusCode = 404;
			response.end();
		});

		await expect(getBlobWithHttpClient(url)).resolves.toMatchObject({
			statusCode: 404,
		});
	});

	it("stops reading an endless response once it is too large", async () => {
		let closed = false;
		const url = await serve((request, response) => {
			request.socket.on("close", () => {
				closed = true;
			});
			const interval = setInterval(() => {
				if (!response.write(Buffer.alloc(256, "x"))) {
					clearInterval(interval);
				}
			}, 1);
			response.on("close", () => {
				clearInterval(interval);
			});
		});

		await expect(
			runDownload(
				[createArtifact()],
				vi.fn(() => getBlobWithHttpClient(url)),
			),
		).rejects.toBeInstanceOf(InvalidRecordError);
		await vi.waitFor(() => {
			expect(closed).toBe(true);
		});
	});
});
