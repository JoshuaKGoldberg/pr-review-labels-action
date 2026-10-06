import * as core from "@actions/core";
import * as github from "@actions/github";

import { runAction } from "./runAction.ts";

try {
	await runAction(github.context);
} catch (error) {
	core.setFailed(error instanceof Error ? error.message : String(error));
}
