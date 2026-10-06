import { type Mock, vi } from "vitest";

import type { ActionContext, Octokit } from "./types.ts";

export interface MockOctokit {
	mocks: Record<
		| "addLabels"
		| "downloadArtifact"
		| "getPullRequest"
		| "getReview"
		| "listEventsForTimeline"
		| "listWorkflowRunArtifacts"
		| "paginate"
		| "removeLabel",
		Mock
	>;
	octokit: Octokit;
}

export function createContext(
	eventName: string,
	payload: Record<string, unknown>,
): ActionContext {
	return {
		apiUrl: "https://api.github.com",
		eventName,
		payload,
		repo: { owner: "test-owner", repo: "test-repo" },
	};
}

export function createMockOctokit(): MockOctokit {
	const mocks = {
		addLabels: vi.fn(),
		downloadArtifact: vi.fn(),
		getPullRequest: vi.fn(),
		getReview: vi.fn(),
		listEventsForTimeline: vi.fn(),
		listWorkflowRunArtifacts: vi.fn(),
		paginate: vi.fn(),
		removeLabel: vi.fn(),
	};

	const octokit = {
		paginate: mocks.paginate,
		rest: {
			actions: {
				downloadArtifact: mocks.downloadArtifact,
				listWorkflowRunArtifacts: mocks.listWorkflowRunArtifacts,
			},
			issues: {
				addLabels: mocks.addLabels,
				listEventsForTimeline: mocks.listEventsForTimeline,
				removeLabel: mocks.removeLabel,
			},
			pulls: { get: mocks.getPullRequest, getReview: mocks.getReview },
		},
	} as unknown as Octokit;

	return { mocks, octokit };
}

export function createRequestError(status: number) {
	return Object.assign(new Error(`HTTP ${status}`), { status });
}
