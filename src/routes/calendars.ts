'use strict';
import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import {
	deleteCalendar,
	getCalendarById,
	listCalendars,
	updateCalendar,
	upsertCalendarGoogle,
	upsertCalendarIcs,
} from '../db/repo.js';

const serializeCalendar = (r: any) => ({
	color: r.color,
	description: r.description,
	enabled: r.enabled === 1,
	googleCalId: r.google_cal_id,
	icon: r.icon,
	icsUrl: r.ics_url,
	id: r.id,
	label: r.label,
	sortOrder: r.sort_order,
	syncToken: r.sync_token,
	type: r.type,
	updatedAt: r.updated_at,
});

const CreateIcsSchema = z.object({
	label: z.string().optional(),
	url: z.string().url(),
});

const CreateGoogleSchema = z.object({
	calendarId: z.string().min(1),
	label: z.string().optional(),
});

const UpdateCalendarSchema = z.object({
	color: z.string().nullable().optional(),
	description: z.string().nullable().optional(),
	enabled: z.boolean().optional(),
	icon: z.string().nullable().optional(),
	label: z.string().nullable().optional(),
	sortOrder: z.number().int().nullable().optional(),
});

const calendarsPlugin: FastifyPluginCallback = (fastify, _opts, done) => {
	// GET /v1/calendars - List all calendars
	fastify.get('/v1/calendars', async () => {
		const rows = listCalendars();
		return rows.map(serializeCalendar);
	});

	// GET /v1/calendars/:id - Get a single calendar
	fastify.get<{ Params: { id: string } }>('/v1/calendars/:id', async (req, reply) => {
		const cal = getCalendarById(req.params.id);
		if (!cal) {
			reply.code(404).send({ ok: false, error: 'Calendar not found' });
			return;
		}
		return serializeCalendar(cal);
	});

	// POST /v1/calendars/ics - Create ICS calendar
	fastify.post<{ Body: unknown }>('/v1/calendars/ics', async (req, reply) => {
		const parsed = CreateIcsSchema.safeParse(req.body);
		if (!parsed.success) {
			reply.code(400).send({ ok: false, error: 'Invalid request body', details: parsed.error });
			return;
		}
		const { url, label } = parsed.data;
		const cal = upsertCalendarIcs(url, label);
		reply.code(201).send(serializeCalendar(cal));
	});

	// POST /v1/calendars/google - Create Google calendar
	fastify.post<{ Body: unknown }>('/v1/calendars/google', async (req, reply) => {
		const parsed = CreateGoogleSchema.safeParse(req.body);
		if (!parsed.success) {
			reply.code(400).send({ ok: false, error: 'Invalid request body', details: parsed.error });
			return;
		}
		const { calendarId, label } = parsed.data;
		const cal = upsertCalendarGoogle(calendarId, label);
		reply.code(201).send(serializeCalendar(cal));
	});

	// PUT /v1/calendars/:id - Update calendar metadata
	fastify.put<{ Params: { id: string }; Body: unknown }>(
		'/v1/calendars/:id',
		async (req, reply) => {
			const parsed = UpdateCalendarSchema.safeParse(req.body);
			if (!parsed.success) {
				reply.code(400).send({ ok: false, error: 'Invalid request body', details: parsed.error });
				return;
			}
			const existing = getCalendarById(req.params.id);
			if (!existing) {
				reply.code(404).send({ ok: false, error: 'Calendar not found' });
				return;
			}
			const fields: any = {};
			if (parsed.data.label !== undefined) fields.label = parsed.data.label;
			if (parsed.data.color !== undefined) fields.color = parsed.data.color;
			if (parsed.data.icon !== undefined) fields.icon = parsed.data.icon;
			if (parsed.data.description !== undefined) fields.description = parsed.data.description;
			if (parsed.data.sortOrder !== undefined) fields.sort_order = parsed.data.sortOrder;
			if (parsed.data.enabled !== undefined) fields.enabled = parsed.data.enabled;

			const updated = updateCalendar(req.params.id, fields);
			return serializeCalendar(updated);
		},
	);

	// DELETE /v1/calendars/:id - Delete calendar
	fastify.delete<{ Params: { id: string } }>('/v1/calendars/:id', async (req, reply) => {
		const deleted = deleteCalendar(req.params.id);
		if (!deleted) {
			reply.code(404).send({ ok: false, error: 'Calendar not found' });
			return;
		}
		return { ok: true, message: 'Calendar deleted' };
	});

	done();
};

export default fp(calendarsPlugin);
