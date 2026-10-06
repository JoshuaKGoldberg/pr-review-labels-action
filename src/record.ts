export const recordFileName = "pr-review-labels-record.json";

/**
 * Records are tiny, so anything larger than this is rejected before downloading.
 */
export const recordMaximumBytes = 1024;

export interface ReviewRecord {
	pullRequest: number;
	review: number;
}

/**
 * Parses an untrusted record, returning undefined if it isn't exactly a ReviewRecord.
 */
export function parseRecord(text: string): ReviewRecord | undefined {
	let data: unknown;

	try {
		data = JSON.parse(text);
	} catch {
		return undefined;
	}

	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		return undefined;
	}

	if (Object.keys(data).sort().join() !== "pullRequest,review") {
		return undefined;
	}

	const { pullRequest, review } = data as Record<string, unknown>;

	return isId(pullRequest) && isId(review)
		? { pullRequest, review }
		: undefined;
}

function isId(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}
