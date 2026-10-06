import type * as github from "@actions/github";

export type ActionContext = Pick<
	typeof github.context,
	"apiUrl" | "eventName" | "payload" | "repo"
>;

export type Octokit = ReturnType<typeof github.getOctokit>;
