'use strict';

const DEFAULT_TIMEOUT_MS = 60_000;

export const fetchWithTimeout = async (
	input: RequestInfo | URL,
	init: RequestInit = {},
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
	try {
		return await fetch(input, { ...init, signal });
	} finally {
		clearTimeout(timeout);
	}
};
