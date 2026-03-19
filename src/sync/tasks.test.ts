'use strict';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Inline pure helpers (mirrors tasks.ts logic; no module-level side effects)
// ---------------------------------------------------------------------------

type GoogleTask = {
	id: string;
	title?: string;
	notes?: string;
	status?: string;
	due?: string;
	completed?: string;
	deleted?: boolean;
	hidden?: boolean;
	position?: string;
	parent?: string;
	updated?: string;
};

type RawTaskRow = {
	task_list_id: string;
	task_id: string;
	title: string | null;
	notes: string | null;
	status: string;
	due_iso: string | null;
	completed_iso: string | null;
	deleted: number;
	hidden: number;
	position: string | null;
	parent: string | null;
	updated_ts: number;
	source_json: string;
};

const mapGoogleTask = (taskListId: string, gt: GoogleTask): RawTaskRow => {
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

// ---------------------------------------------------------------------------
// mapGoogleTask — field mapping
// ---------------------------------------------------------------------------

describe('mapGoogleTask — status normalization', () => {
	it('maps status "needsAction" correctly', () => {
		const row = mapGoogleTask('gtlist_abc', {
			id: 'task1',
			status: 'needsAction',
			updated: '2024-03-01T12:00:00.000Z',
		});
		expect(row.status).toBe('needsAction');
	});

	it('maps status "completed" correctly', () => {
		const row = mapGoogleTask('gtlist_abc', {
			id: 'task1',
			status: 'completed',
			updated: '2024-03-01T12:00:00.000Z',
		});
		expect(row.status).toBe('completed');
	});

	it('defaults unknown status to "needsAction"', () => {
		const row = mapGoogleTask('gtlist_abc', {
			id: 'task1',
			status: 'someOtherValue',
			updated: '2024-03-01T12:00:00.000Z',
		});
		expect(row.status).toBe('needsAction');
	});

	it('defaults missing status to "needsAction"', () => {
		const row = mapGoogleTask('gtlist_abc', {
			id: 'task1',
			updated: '2024-03-01T12:00:00.000Z',
		});
		expect(row.status).toBe('needsAction');
	});
});

describe('mapGoogleTask — due date', () => {
	it('stores due_iso as-is from Google', () => {
		const row = mapGoogleTask('gtlist_abc', {
			id: 'task1',
			due: '2024-06-15T00:00:00.000Z',
			updated: '2024-03-01T12:00:00.000Z',
		});
		expect(row.due_iso).toBe('2024-06-15T00:00:00.000Z');
	});

	it('stores null due_iso when not provided', () => {
		const row = mapGoogleTask('gtlist_abc', {
			id: 'task1',
			updated: '2024-03-01T12:00:00.000Z',
		});
		expect(row.due_iso).toBeNull();
	});
});

describe('mapGoogleTask — notes', () => {
	it('stores notes when present', () => {
		const row = mapGoogleTask('gtlist_abc', {
			id: 'task1',
			notes: 'Some task notes',
			updated: '2024-03-01T12:00:00.000Z',
		});
		expect(row.notes).toBe('Some task notes');
	});

	it('stores null notes when not provided', () => {
		const row = mapGoogleTask('gtlist_abc', {
			id: 'task1',
			updated: '2024-03-01T12:00:00.000Z',
		});
		expect(row.notes).toBeNull();
	});
});

describe('mapGoogleTask — deleted flag', () => {
	it('sets deleted=1 when task.deleted is true', () => {
		const row = mapGoogleTask('gtlist_abc', {
			id: 'task1',
			deleted: true,
			updated: '2024-03-01T12:00:00.000Z',
		});
		expect(row.deleted).toBe(1);
	});

	it('sets deleted=0 when task.deleted is false', () => {
		const row = mapGoogleTask('gtlist_abc', {
			id: 'task1',
			deleted: false,
			updated: '2024-03-01T12:00:00.000Z',
		});
		expect(row.deleted).toBe(0);
	});

	it('sets deleted=0 when task.deleted is absent', () => {
		const row = mapGoogleTask('gtlist_abc', {
			id: 'task1',
			updated: '2024-03-01T12:00:00.000Z',
		});
		expect(row.deleted).toBe(0);
	});
});

describe('mapGoogleTask — hidden flag', () => {
	it('sets hidden=1 when task.hidden is true', () => {
		const row = mapGoogleTask('gtlist_abc', {
			id: 'task1',
			hidden: true,
			updated: '2024-03-01T12:00:00.000Z',
		});
		expect(row.hidden).toBe(1);
	});

	it('sets hidden=0 when absent', () => {
		const row = mapGoogleTask('gtlist_abc', {
			id: 'task1',
			updated: '2024-03-01T12:00:00.000Z',
		});
		expect(row.hidden).toBe(0);
	});
});

describe('mapGoogleTask — subtask parent field', () => {
	it('stores parent task ID for subtasks', () => {
		const row = mapGoogleTask('gtlist_abc', {
			id: 'task2',
			parent: 'task1',
			updated: '2024-03-01T12:00:00.000Z',
		});
		expect(row.parent).toBe('task1');
	});

	it('stores null parent for top-level tasks', () => {
		const row = mapGoogleTask('gtlist_abc', {
			id: 'task1',
			updated: '2024-03-01T12:00:00.000Z',
		});
		expect(row.parent).toBeNull();
	});
});

describe('mapGoogleTask — updated_ts', () => {
	it('converts RFC 3339 updated to epoch ms', () => {
		const row = mapGoogleTask('gtlist_abc', {
			id: 'task1',
			updated: '2024-03-01T12:00:00.000Z',
		});
		expect(row.updated_ts).toBe(Date.parse('2024-03-01T12:00:00.000Z'));
	});

	it('uses Date.now() fallback when updated is absent', () => {
		const before = Date.now();
		const row = mapGoogleTask('gtlist_abc', { id: 'task1' });
		const after = Date.now();
		expect(row.updated_ts).toBeGreaterThanOrEqual(before);
		expect(row.updated_ts).toBeLessThanOrEqual(after);
	});
});

describe('mapGoogleTask — source_json', () => {
	it('stores the raw Google Task object as JSON', () => {
		const gt = { id: 'task1', title: 'My task', updated: '2024-03-01T12:00:00.000Z' };
		const row = mapGoogleTask('gtlist_abc', gt);
		expect(JSON.parse(row.source_json)).toEqual(gt);
	});
});

describe('mapGoogleTask — identifiers', () => {
	it('assigns task_list_id from argument', () => {
		const row = mapGoogleTask('gtlist_xyzzy', {
			id: 'task99',
			updated: '2024-03-01T12:00:00.000Z',
		});
		expect(row.task_list_id).toBe('gtlist_xyzzy');
	});

	it('assigns task_id from Google task id field', () => {
		const row = mapGoogleTask('gtlist_abc', {
			id: 'Xyz123',
			updated: '2024-03-01T12:00:00.000Z',
		});
		expect(row.task_id).toBe('Xyz123');
	});
});

// ---------------------------------------------------------------------------
// hasTasksScope — scope string parsing
// ---------------------------------------------------------------------------

describe('hasTasksScope logic', () => {
	// Inline the same logic used in oauth.ts to test it independently
	const checkScope = (scope: string | undefined): boolean => {
		if (!scope) return false;
		return scope.includes('tasks');
	};

	it('returns true when scope includes "tasks"', () => {
		expect(
			checkScope(
				'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/tasks',
			),
		).toBe(true);
	});

	it('returns true when scope is only tasks', () => {
		expect(checkScope('https://www.googleapis.com/auth/tasks')).toBe(true);
	});

	it('returns false when scope only has calendar.readonly', () => {
		expect(checkScope('https://www.googleapis.com/auth/calendar.readonly')).toBe(false);
	});

	it('returns false when scope is undefined', () => {
		expect(checkScope(undefined)).toBe(false);
	});

	it('returns false when scope is empty string', () => {
		expect(checkScope('')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// projectTasksToEvents — task-to-EventOut projection
// ---------------------------------------------------------------------------

describe('task-to-EventOut projection', () => {
	// Inline the same projection logic used in expand.ts to test independently
	const nextDayIso = (dateIso: string): string => {
		const dt = new Date(dateIso);
		dt.setUTCDate(dt.getUTCDate() + 1);
		return dt.toISOString().replace('.000Z', '.000Z');
	};

	const projectTask = (row: {
		task_list_id: string;
		task_id: string;
		title: string | null;
		notes: string | null;
		status: string;
		due_iso: string;
		updated_ts: number;
	}) => ({
		allDay: true,
		calendarId: row.task_list_id,
		description: row.notes,
		end: nextDayIso(row.due_iso),
		location: null,
		recurrence: { isRecurring: false },
		source: { type: 'google-tasks' as const, id: row.task_id },
		start: new Date(row.due_iso).toISOString(),
		status: row.status,
		summary: row.title,
		timeTransparency: {
			blocksTime: false,
			value: 'transparent' as const,
			source: { provider: 'google-tasks' as const, rawValue: null },
		},
		uid: `gtask_${row.task_list_id}_${row.task_id}`,
	});

	it('produces allDay=true', () => {
		const e = projectTask({
			task_list_id: 'gtlist_abc',
			task_id: 'task1',
			title: 'Buy milk',
			notes: null,
			status: 'needsAction',
			due_iso: '2024-06-15T00:00:00.000Z',
			updated_ts: 0,
		});
		expect(e.allDay).toBe(true);
	});

	it('sets end to due_iso + 1 day', () => {
		const e = projectTask({
			task_list_id: 'gtlist_abc',
			task_id: 'task1',
			title: 'Buy milk',
			notes: null,
			status: 'needsAction',
			due_iso: '2024-06-15T00:00:00.000Z',
			updated_ts: 0,
		});
		expect(e.end).toBe('2024-06-16T00:00:00.000Z');
	});

	it('sets source.type to "google-tasks"', () => {
		const e = projectTask({
			task_list_id: 'gtlist_abc',
			task_id: 'task1',
			title: 'Task',
			notes: null,
			status: 'needsAction',
			due_iso: '2024-06-15T00:00:00.000Z',
			updated_ts: 0,
		});
		expect(e.source.type).toBe('google-tasks');
	});

	it('sets timeTransparency.blocksTime to false', () => {
		const e = projectTask({
			task_list_id: 'gtlist_abc',
			task_id: 'task1',
			title: 'Task',
			notes: null,
			status: 'needsAction',
			due_iso: '2024-06-15T00:00:00.000Z',
			updated_ts: 0,
		});
		expect(e.timeTransparency.blocksTime).toBe(false);
		expect(e.timeTransparency.value).toBe('transparent');
	});

	it('produces correct uid format', () => {
		const e = projectTask({
			task_list_id: 'gtlist_abc',
			task_id: 'taskXYZ',
			title: 'Task',
			notes: null,
			status: 'needsAction',
			due_iso: '2024-06-15T00:00:00.000Z',
			updated_ts: 0,
		});
		expect(e.uid).toBe('gtask_gtlist_abc_taskXYZ');
	});

	it('maps notes to description', () => {
		const e = projectTask({
			task_list_id: 'gtlist_abc',
			task_id: 'task1',
			title: 'Task',
			notes: 'Remember to check expiry',
			status: 'needsAction',
			due_iso: '2024-06-15T00:00:00.000Z',
			updated_ts: 0,
		});
		expect(e.description).toBe('Remember to check expiry');
	});

	it('sets location to null', () => {
		const e = projectTask({
			task_list_id: 'gtlist_abc',
			task_id: 'task1',
			title: 'Task',
			notes: null,
			status: 'needsAction',
			due_iso: '2024-06-15T00:00:00.000Z',
			updated_ts: 0,
		});
		expect(e.location).toBeNull();
	});
});
