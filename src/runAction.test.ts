import * as core from "@actions/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyLabel } from "./applyLabel.ts";
import { downloadRecord } from "./downloadRecord.ts";
import { recordReview } from "./recordReview.ts";
import { removeLabel } from "./removeLabel.ts";
import { runAction } from "./runAction.ts";
import { createContext } from "./testUtils.ts";

vi.mock("@actions/artifact", () => ({
	DefaultArtifactClient: vi.fn(),
}));
vi.mock("@actions/core");
vi.mock("@actions/github", () => ({
	getOctokit: vi.fn((token: string) => ({ token })),
}));
vi.mock("./applyLabel.ts");
vi.mock("./downloadRecord.ts");
vi.mock("./recordReview.ts");
vi.mock("./removeLabel.ts");

describe(runAction, () => {
	beforeEach(() => {
		vi.mocked(core.getInput).mockImplementation((name) =>
			name === "label" ? "test-label" : "test-token",
		);
	});

	it.each(["pull_request", "pull_request_target"])(
		"removes the label on %s",
		async (eventName) => {
			const context = createContext(eventName, {});

			await runAction(context);

			expect(removeLabel).toHaveBeenCalledWith({
				context,
				label: "test-label",
				octokit: { token: "test-token" },
			});
		},
	);

	it("records the review on pull_request_review without reading inputs", async () => {
		const context = createContext("pull_request_review", {});

		await runAction(context);

		expect(recordReview).toHaveBeenCalledWith(context, expect.any(Object));
		expect(core.getInput).not.toHaveBeenCalled();
	});

	it("applies the label on workflow_run", async () => {
		const context = createContext("workflow_run", {});

		await runAction(context);

		expect(applyLabel).toHaveBeenCalledWith({
			context,
			downloadRecord: expect.any(Function),
			label: "test-label",
			octokit: { token: "test-token" },
		});

		await vi.mocked(applyLabel).mock.calls[0][0].downloadRecord(456);

		expect(downloadRecord).toHaveBeenCalledWith({
			context,
			octokit: { token: "test-token" },
			runId: 456,
			token: "test-token",
		});
	});

	it("throws on unsupported events", async () => {
		await expect(runAction(createContext("push", {}))).rejects.toThrow(
			"Unsupported event: push.",
		);
	});
});
