'use strict';
import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import {
	deleteRawTask,
	disableTaskList,
	getTaskByIds,
	getTaskListById,
	listRawTasks,
	listTaskLists,
	updateTaskList,
	upsertRawTask,
	type RawTaskRow,
} from '../db/repo.js';
import { getValidAccessToken, hasTasksScope } from '../google/oauth.js';
import { logger } from '../logging/logger.js';
import { mapGoogleTask } from '../sync/tasks.js';

const TASKS_BASE = 'https://tasks.googleapis.com/tasks/v1';

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

const serializeTaskList = (r: any) => ({
	id: r.id,
	googleTaskListId: r.google_task_list_id,
	label: r.label,
	color: r.color,
	enabled: r.enabled === 1,
	sortOrder: r.sort_order,
	lastSyncedAt: r.last_synced_at,
	updatedAt: r.updated_at,
});

const serializeTask = (r: RawTaskRow) => ({
	id: `${r.task_list_id}/${r.task_id}`,
	taskListId: r.task_list_id,
	taskId: r.task_id,
	title: r.title,
	notes: r.notes,
	status: r.status as 'needsAction' | 'completed',
	dueIso: r.due_iso,
	completedIso: r.completed_iso,
	deleted: r.deleted === 1,
	hidden: r.hidden === 1,
	position: r.position,
	parent: r.parent,
	updatedAt: r.updated_ts,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const requireTasksScope = async (reply: any): Promise<boolean> => {
	if (!hasTasksScope()) {
		reply.code(503).send({
			ok: false,
			error: 'Google Tasks scope not authorized. Re-run: yarn auth:google',
		});
		return false;
	}
	return true;
};

const getAuthHeader = async (reply: any): Promise<string | null> => {
	try {
		const token = await getValidAccessToken();
		return `Bearer ${token}`;
	} catch (err) {
		logger.warn({ err }, 'No valid Google OAuth token for Tasks write op');
		reply.code(503).send({ ok: false, error: 'No valid Google OAuth token available' });
		return null;
	}
};

const refetchAndPersistTask = async (
	googleListId: string,
	googleTaskId: string,
	taskListId: string,
	authHeader: string,
): Promise<RawTaskRow | null> => {
	try {
		const res = await fetch(
			`${TASKS_BASE}/lists/${encodeURIComponent(googleListId)}/tasks/${encodeURIComponent(googleTaskId)}`,
			{ headers: { Authorization: authHeader } },
		);
		if (!res.ok) throw new Error(`Re-fetch failed: ${res.status} ${res.statusText}`);
		const gt = (await res.json()) as any;
		const row = mapGoogleTask(taskListId, gt);
		upsertRawTask(row);
		return row;
	} catch (err) {
		logger.warn({ err, googleTaskId }, 'Task re-fetch after mutation failed; using mutation response');
		return null;
	}
};

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const UpdateTaskListSchema = z.object({
	color: z.string().nullable().optional(),
	enabled: z.boolean().optional(),
	label: z.string().nullable().optional(),
	sortOrder: z.number().int().nullable().optional(),
});

const ListTasksQuerySchema = z.object({
	taskListId: z.string().optional(),
	status: z.enum(['needsAction', 'completed', 'all']).default('needsAction'),
	dueBefore: z.string().optional(),
	dueAfter: z.string().optional(),
	showSubtasks: z
		.string()
		.optional()
		.transform((v) => v === 'true'),
	showHidden: z
		.string()
		.optional()
		.transform((v) => v === 'true'),
	order: z.enum(['position', 'due']).default('position'),
	limit: z.coerce.number().int().positive().max(500).default(100),
	offset: z.coerce.number().int().min(0).default(0),
});

const CreateTaskSchema = z.object({
	taskListId: z.string().min(1),
	title: z.string().min(1),
	notes: z.string().optional(),
	due: z.string().optional(), // RFC 3339 date
});

const UpdateTaskSchema = z.object({
	title: z.string().optional(),
	notes: z.string().nullable().optional(),
	status: z.enum(['needsAction', 'completed']).optional(),
	due: z.string().nullable().optional(), // RFC 3339 date or null to clear
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const tasksPlugin: FastifyPluginCallback = (fastify, _opts, done) => {
	// GET /v1/task-lists
	fastify.get('/v1/task-lists', async () => {
		return listTaskLists().map(serializeTaskList);
	});

	// GET /v1/task-lists/:id
	fastify.get<{ Params: { id: string } }>('/v1/task-lists/:id', async (req, reply) => {
		const tl = getTaskListById(req.params.id);
		if (!tl) return reply.code(404).send({ ok: false, error: 'Task list not found' });
		return serializeTaskList(tl);
	});

	// PUT /v1/task-lists/:id — update metadata (label, color, enabled, sortOrder)
	fastify.put<{ Params: { id: string }; Body: unknown }>(
		'/v1/task-lists/:id',
		async (req, reply) => {
			const parsed = UpdateTaskListSchema.safeParse(req.body);
			if (!parsed.success) {
				return reply
					.code(400)
					.send({ ok: false, error: 'Invalid request body', details: parsed.error });
			}
			const existing = getTaskListById(req.params.id);
			if (!existing) return reply.code(404).send({ ok: false, error: 'Task list not found' });

			const fields: Parameters<typeof updateTaskList>[1] = {};
			if (parsed.data.label !== undefined) fields.label = parsed.data.label;
			if (parsed.data.color !== undefined) fields.color = parsed.data.color;
			if (parsed.data.sortOrder !== undefined) fields.sort_order = parsed.data.sortOrder;
			if (parsed.data.enabled !== undefined) fields.enabled = parsed.data.enabled;

			const updated = updateTaskList(req.params.id, fields);
			return serializeTaskList(updated);
		},
	);

	// DELETE /v1/task-lists/:id — soft-disable (does NOT drop the row or tasks)
	fastify.delete<{ Params: { id: string } }>('/v1/task-lists/:id', async (req, reply) => {
		const existing = getTaskListById(req.params.id);
		if (!existing) return reply.code(404).send({ ok: false, error: 'Task list not found' });
		disableTaskList(req.params.id);
		return { ok: true, message: 'Task list disabled' };
	});

	// GET /v1/tasks
	fastify.get<{ Querystring: unknown }>('/v1/tasks', async (req, reply) => {
		const parsed = ListTasksQuerySchema.safeParse(req.query);
		if (!parsed.success) {
			return reply.code(400).send({ ok: false, error: 'Invalid query params', details: parsed.error });
		}
		const { taskListId, status, dueBefore, dueAfter, showSubtasks, showHidden, order, limit, offset } =
			parsed.data;

		if (!taskListId) {
			// Return tasks across all enabled task lists
			const allLists = listTaskLists().filter((tl) => tl.enabled === 1);
			const tasks: RawTaskRow[] = [];
			for (const tl of allLists) {
				const rows = listRawTasks(tl.id, { status, dueBefore, dueAfter, showSubtasks, showHidden, order, limit, offset });
				tasks.push(...rows);
			}
			return tasks.map(serializeTask);
		}

		const tl = getTaskListById(taskListId);
		if (!tl) return reply.code(404).send({ ok: false, error: 'Task list not found' });

		const rows = listRawTasks(taskListId, { status, dueBefore, dueAfter, showSubtasks, showHidden, order, limit, offset });
		return rows.map(serializeTask);
	});

	// GET /v1/tasks/:taskListId/:taskId
	fastify.get<{ Params: { taskListId: string; taskId: string } }>(
		'/v1/tasks/:taskListId/:taskId',
		async (req, reply) => {
			const task = getTaskByIds(req.params.taskListId, req.params.taskId);
			if (!task) return reply.code(404).send({ ok: false, error: 'Task not found' });
			return serializeTask(task);
		},
	);

	// POST /v1/tasks — create task
	fastify.post<{ Body: unknown }>('/v1/tasks', async (req, reply) => {
		if (!(await requireTasksScope(reply))) return;

		const parsed = CreateTaskSchema.safeParse(req.body);
		if (!parsed.success) {
			return reply
				.code(400)
				.send({ ok: false, error: 'Invalid request body', details: parsed.error });
		}

		const { taskListId, title, notes, due } = parsed.data;
		const tl = getTaskListById(taskListId);
		if (!tl) return reply.code(404).send({ ok: false, error: 'Task list not found' });

		const auth = await getAuthHeader(reply);
		if (!auth) return;

		const body: Record<string, string> = { title };
		if (notes) body.notes = notes;
		if (due) body.due = due;

		const res = await fetch(
			`${TASKS_BASE}/lists/${encodeURIComponent(tl.google_task_list_id)}/tasks`,
			{
				method: 'POST',
				headers: { Authorization: auth, 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			},
		);
		if (!res.ok) {
			const text = await res.text();
			logger.error({ status: res.status, body: text }, 'Google Tasks create failed');
			return reply.code(502).send({ ok: false, error: 'Google Tasks API error', details: text });
		}
		const created = (await res.json()) as any;

		// Re-fetch authoritative state before persisting
		const row =
			(await refetchAndPersistTask(tl.google_task_list_id, created.id, tl.id, auth)) ??
			mapGoogleTask(tl.id, created);
		if (!getTaskByIds(tl.id, row.task_id)) upsertRawTask(row);

		reply.code(201).send(serializeTask(row));
	});

	// PATCH /v1/tasks/:taskListId/:taskId — update task
	fastify.patch<{ Params: { taskListId: string; taskId: string }; Body: unknown }>(
		'/v1/tasks/:taskListId/:taskId',
		async (req, reply) => {
			if (!(await requireTasksScope(reply))) return;

			const parsed = UpdateTaskSchema.safeParse(req.body);
			if (!parsed.success) {
				return reply
					.code(400)
					.send({ ok: false, error: 'Invalid request body', details: parsed.error });
			}

			const { taskListId, taskId } = req.params;
			const tl = getTaskListById(taskListId);
			if (!tl) return reply.code(404).send({ ok: false, error: 'Task list not found' });

			const existing = getTaskByIds(taskListId, taskId);
			if (!existing) return reply.code(404).send({ ok: false, error: 'Task not found' });

			const auth = await getAuthHeader(reply);
			if (!auth) return;

			const patchBody: Record<string, string | null> = {};
			if (parsed.data.title !== undefined) patchBody.title = parsed.data.title;
			if (parsed.data.notes !== undefined) patchBody.notes = parsed.data.notes;
			if (parsed.data.status !== undefined) patchBody.status = parsed.data.status;
			if (parsed.data.due !== undefined) patchBody.due = parsed.data.due;

			const res = await fetch(
				`${TASKS_BASE}/lists/${encodeURIComponent(tl.google_task_list_id)}/tasks/${encodeURIComponent(taskId)}`,
				{
					method: 'PATCH',
					headers: { Authorization: auth, 'Content-Type': 'application/json' },
					body: JSON.stringify(patchBody),
				},
			);
			if (!res.ok) {
				const text = await res.text();
				logger.error({ status: res.status, body: text, taskId }, 'Google Tasks patch failed');
				return reply.code(502).send({ ok: false, error: 'Google Tasks API error', details: text });
			}
			const patched = (await res.json()) as any;

			// Re-fetch authoritative state before persisting
			const row =
				(await refetchAndPersistTask(tl.google_task_list_id, taskId, tl.id, auth)) ??
				mapGoogleTask(tl.id, patched);
			upsertRawTask(row);

			return serializeTask(row);
		},
	);

	// DELETE /v1/tasks/:taskListId/:taskId
	fastify.delete<{ Params: { taskListId: string; taskId: string } }>(
		'/v1/tasks/:taskListId/:taskId',
		async (req, reply) => {
			if (!(await requireTasksScope(reply))) return;

			const { taskListId, taskId } = req.params;
			const tl = getTaskListById(taskListId);
			if (!tl) return reply.code(404).send({ ok: false, error: 'Task list not found' });

			const existing = getTaskByIds(taskListId, taskId);
			if (!existing) return reply.code(404).send({ ok: false, error: 'Task not found' });

			const auth = await getAuthHeader(reply);
			if (!auth) return;

			const res = await fetch(
				`${TASKS_BASE}/lists/${encodeURIComponent(tl.google_task_list_id)}/tasks/${encodeURIComponent(taskId)}`,
				{ method: 'DELETE', headers: { Authorization: auth } },
			);
			if (!res.ok && res.status !== 204) {
				const text = await res.text();
				logger.error({ status: res.status, body: text, taskId }, 'Google Tasks delete failed');
				return reply.code(502).send({ ok: false, error: 'Google Tasks API error', details: text });
			}

			deleteRawTask(taskListId, taskId);
			return { ok: true, message: 'Task deleted' };
		},
	);

	done();
};

export default fp(tasksPlugin);
