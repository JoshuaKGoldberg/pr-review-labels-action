import { type Mock, vi } from "vitest";

import type { ActionContext, Octokit } from "./types.ts";

export interface MockOctokit {
	mocks: Record<
		| "addLabels"
		| "downloadArtifact"
		| "getCollaboratorPermissionLevel"
		| "getPullRequest"
		| "getReview"
		| "listEvents"
		| "listReviews"
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
		getCollaboratorPermissionLevel: vi.fn(),
		getPullRequest: vi.fn(),
		getReview: vi.fn(),
		listEvents: vi.fn(),
		listReviews: vi.fn(),
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
				listEvents: mocks.listEvents,
				removeLabel: mocks.removeLabel,
			},
			pulls: {
				get: mocks.getPullRequest,
				getReview: mocks.getReview,
				listReviews: mocks.listReviews,
			},
			repos: {
				getCollaboratorPermissionLevel: mocks.getCollaboratorPermissionLevel,
			},
		},
	} as unknown as Octokit;

	return { mocks, octokit };
}

export function createRequestError(status: number) {
	return Object.assign(new Error(`HTTP ${status}`), { status });
}
