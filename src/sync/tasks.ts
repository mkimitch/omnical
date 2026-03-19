'use strict';
import {
	deleteRawTask,
	getExistingTaskUpdatedTs,
	listEnabledTaskLists,
	updateTaskListSyncState,
	upsertRawTask,
	upsertTaskList,
	type RawTaskRow,
} from '../db/repo.js';
import { getValidAccessToken, hasTasksScope } from '../google/oauth.js';
import { logger } from '../logging/logger.js';

const TASKS_BASE = 'https://tasks.googleapis.com/tasks/v1';
const SYNC_OVERLAP_BUFFER_MS = 30_000; // 30-second safety buffer

type GoogleTask = {
	id: string;
	title?: string;
	notes?: string;
	status?: string; // 'needsAction' | 'completed'
	due?: string; // RFC 3339 date string
	completed?: string; // RFC 3339 datetime string
	deleted?: boolean;
	hidden?: boolean;
	position?: string;
	parent?: string;
	updated?: string; // RFC 3339 datetime string
	selfLink?: string;
	kind?: string;
};

type GoogleTaskList = {
	id: string;
	title?: string;
	kind?: string;
	selfLink?: string;
	updated?: string;
};

export const mapGoogleTask = (taskListId: string, gt: GoogleTask): RawTaskRow => {
	const updatedTs = gt.updated ? Date.parse(gt.updated) : Date.now();
	return {
		task_list_id: taskListId,
		task_id: gt.id,
		title: gt.title ?? null,
		notes: gt.notes ?? null,
		status: gt.status === 'completed' ? 'completed' : 'needsAction',
		due_iso: gt.due ?? null,
		completed_iso: gt.completed ?? null,
		deleted: gt.deleted ? 1 : 0,
		hidden: gt.hidden ? 1 : 0,
		position: gt.position ?? null,
		parent: gt.parent ?? null,
		updated_ts: updatedTs,
		source_json: JSON.stringify(gt),
	};
};

export type TaskSyncSummary = { updated: number; taskLists: string[] };

export const syncGoogleTasks = async (): Promise<TaskSyncSummary> => {
	let accessToken: string | null = null;
	try {
		accessToken = await getValidAccessToken();
	} catch {
		logger.warn('No valid Google OAuth tokens found; skipping Google Tasks sync');
		return { updated: 0, taskLists: [] };
	}

	if (!hasTasksScope()) {
		logger.warn(
			'Google Tasks scope not granted; skipping task sync. Re-run yarn auth:google to add tasks scope.',
		);
		return { updated: 0, taskLists: [] };
	}

	const authHeader = { Authorization: `Bearer ${accessToken}` };

	// Step 1: Discover all task lists and upsert them
	try {
		let listPageToken: string | undefined;
		do {
			const params = new URLSearchParams({ maxResults: '100' });
			if (listPageToken) params.set('pageToken', listPageToken);
			const res = await fetch(`${TASKS_BASE}/users/@me/lists?${params.toString()}`, {
				headers: authHeader,
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(`Task lists fetch failed: ${res.status} ${res.statusText} - ${text}`);
			}
			const json = (await res.json()) as { items?: GoogleTaskList[]; nextPageToken?: string };
			for (const tl of json.items ?? []) {
				upsertTaskList(tl.id, tl.title);
			}
			listPageToken = json.nextPageToken;
		} while (listPageToken);
	} catch (err) {
		logger.error({ err }, 'Failed to fetch Google task lists; aborting task sync');
		return { updated: 0, taskLists: [] };
	}

	// Step 2: Sync tasks for each enabled task list
	const enabledLists = listEnabledTaskLists();
	let totalUpdated = 0;
	const syncedListIds: string[] = [];

	for (const tl of enabledLists) {
		try {
			const isIncremental = tl.last_synced_at !== null;
			let maxRemoteUpdatedTs = 0;
			let updatedCount = 0;
			let pageToken: string | undefined;

			do {
				const params = new URLSearchParams({
					showDeleted: 'true',
					showHidden: 'true',
					showCompleted: 'true',
					maxResults: '100',
				});
				if (pageToken) params.set('pageToken', pageToken);
				if (isIncremental && tl.last_synced_at !== null) {
					const cursorMs = tl.last_synced_at - SYNC_OVERLAP_BUFFER_MS;
					params.set('updatedMin', new Date(cursorMs).toISOString());
				}

				const res = await fetch(
					`${TASKS_BASE}/lists/${encodeURIComponent(tl.google_task_list_id)}/tasks?${params.toString()}`,
					{ headers: authHeader },
				);
				if (!res.ok) {
					const text = await res.text();
					throw new Error(
						`Tasks fetch failed for list ${tl.id}: ${res.status} ${res.statusText} - ${text}`,
					);
				}
				const json = (await res.json()) as { items?: GoogleTask[]; nextPageToken?: string };
				const items = json.items ?? [];

				for (const gt of items) {
					const remoteTs = gt.updated ? Date.parse(gt.updated) : 0;
					if (remoteTs > maxRemoteUpdatedTs) maxRemoteUpdatedTs = remoteTs;

					if (gt.deleted) {
						deleteRawTask(tl.id, gt.id);
						updatedCount++;
						continue;
					}
					const existingTs = getExistingTaskUpdatedTs(tl.id, gt.id);
					if (existingTs !== null && existingTs >= remoteTs) continue;
					upsertRawTask(mapGoogleTask(tl.id, gt));
					updatedCount++;
				}

				// Only advance cursor when tasks were returned (guard against empty incremental passes)
				if (items.length > 0 && maxRemoteUpdatedTs > 0) {
					updateTaskListSyncState(tl.id, maxRemoteUpdatedTs);
				}

				pageToken = json.nextPageToken;
			} while (pageToken);

			totalUpdated += updatedCount;
			syncedListIds.push(tl.id);
			logger.info(
				{ taskList: tl.id, updated: updatedCount, incremental: isIncremental },
				'Google Tasks synced',
			);
		} catch (err) {
			logger.error({ taskList: tl.id, err }, 'Google Tasks sync failed for list');
		}
	}

	return { updated: totalUpdated, taskLists: syncedListIds };
};
