import { describe, expect, it, vi } from "vitest";

import { downloadRecord } from "./downloadRecord.ts";
import { createContext, createMockOctokit } from "./testUtils.ts";

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

function createFetcher(
	body: BodyInit | null,
	redirect: { location?: string; status?: number } = {},
	status = 200,
) {
	return vi.fn<typeof fetch>((url) =>
		Promise.resolve(
			url === location
				? new Response(body, { status })
				: new Response(null, {
						headers:
							redirect.location === undefined && "location" in redirect
								? {}
								: { location: redirect.location ?? location },
						status: redirect.status ?? 302,
					}),
		),
	);
}

async function runDownload(
	artifacts: ReturnType<typeof createArtifact>[],
	fetcher: typeof fetch = createFetcher(`{"pullRequest":1,"review":2}`),
) {
	const { mocks, octokit } = createMockOctokit();
	mocks.listWorkflowRunArtifacts.mockResolvedValue({ data: { artifacts } });

	const result = await downloadRecord({
		context,
		fetcher,
		octokit,
		runId: 456,
		token: "secret-token",
	});

	return { mocks, result };
}

describe(downloadRecord, () => {
	it("returns undefined when there is no record artifact", async () => {
		const fetcher = createFetcher(null);

		const { result } = await runDownload([], fetcher);

		expect(result).toBeUndefined();
		expect(fetcher).not.toHaveBeenCalled();
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

	it("throws when there are multiple record artifacts", async () => {
		await expect(
			runDownload([createArtifact(), createArtifact({ id: 124 })]),
		).rejects.toThrow(
			"Expected one pr-review-labels-record.json artifact, but found 2.",
		);
	});

	it("throws when the record artifact is expired", async () => {
		await expect(
			runDownload([createArtifact({ expired: true })]),
		).rejects.toThrow("has expired");
	});

	it("throws without downloading when the artifact reports a large size", async () => {
		const fetcher = createFetcher(null);

		await expect(
			runDownload([createArtifact({ size_in_bytes: 1025 })], fetcher),
		).rejects.toThrow("is too large");
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("only sends the token to the GitHub API, not to the download location", async () => {
		const fetcher = createFetcher(`{"pullRequest":1,"review":2}`);

		await runDownload([createArtifact()], fetcher);

		expect(fetcher.mock.calls).toEqual([
			[
				"https://api.github.com/repos/test-owner/test-repo/actions/artifacts/123/zip",
				{
					headers: {
						Accept: "application/vnd.github+json",
						Authorization: "Bearer secret-token",
					},
					redirect: "manual",
				},
			],
			[location],
		]);
	});

	it("throws when the API does not redirect", async () => {
		await expect(
			runDownload([createArtifact()], createFetcher(null, { status: 404 })),
		).rejects.toThrow(
			"Could not locate the pr-review-labels-record.json artifact download (HTTP 404).",
		);
	});

	it("throws when the redirect has no location", async () => {
		await expect(
			runDownload(
				[createArtifact()],
				createFetcher(null, { location: undefined }),
			),
		).rejects.toThrow("Could not locate");
	});

	it("throws when the download fails", async () => {
		await expect(
			runDownload([createArtifact()], createFetcher("", {}, 403)),
		).rejects.toThrow(
			"Could not download the pr-review-labels-record.json artifact (HTTP 403).",
		);
	});

	it("throws when the download is larger than its reported size allows", async () => {
		await expect(
			runDownload([createArtifact()], createFetcher("x".repeat(1025))),
		).rejects.toThrow("is too large");
	});

	it("stops reading a download as soon as it is too large", async () => {
		let pulls = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulls += 1;
				controller.enqueue(new Uint8Array(512));
			},
		});

		await expect(
			runDownload([createArtifact()], createFetcher(body)),
		).rejects.toThrow("is too large");
		expect(pulls).toBeLessThan(5);
	});

	it("throws when the download is not valid UTF-8", async () => {
		await expect(
			runDownload(
				[createArtifact()],
				createFetcher(new Uint8Array([0xff, 0xfe])),
			),
		).rejects.toThrow("is not valid UTF-8");
	});

	it("throws when the download is a zip archive", async () => {
		await expect(
			runDownload(
				[createArtifact()],
				createFetcher(new Uint8Array([0x50, 0x4b, 0x03, 0x04])),
			),
		).rejects.toThrow("is not a valid record");
	});

	it("throws when the download is not a valid record", async () => {
		await expect(
			runDownload([createArtifact()], createFetcher(`{"pullRequest":"1"}`)),
		).rejects.toThrow("is not a valid record");
	});

	it("throws when the download is empty", async () => {
		await expect(
			runDownload([createArtifact()], createFetcher(null)),
		).rejects.toThrow("is not a valid record");
	});

	it("returns the record when the download is valid", async () => {
		const { result } = await runDownload([createArtifact()]);

		expect(result).toEqual({ pullRequest: 1, review: 2 });
	});
});
