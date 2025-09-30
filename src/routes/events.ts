'use strict';
import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { expandWindow, type EventOut } from '../expansion/expand.js';

const eventsPlugin: FastifyPluginCallback = (fastify, _opts, done) => {
	const qSchema = z.object({
		start: z.string().refine((s) => DateTime.fromISO(s).isValid, 'Invalid ISO start'),
		end: z.string().refine((s) => DateTime.fromISO(s).isValid, 'Invalid ISO end'),
		includeCancelled: z
			.string()
			.optional()
			.transform((v) => (v ? v.toLowerCase() === 'true' : false)),
		clientZone: z.string().optional(),
	});

	fastify.get('/v1/events', async (req, reply) => {
		const parsed = qSchema.safeParse(req.query);
		if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.message });
		const { start, end, includeCancelled, clientZone } = parsed.data;
		const events = await expandWindow(start, end, includeCancelled);
		const mapped = clientZone
			? events.map((e) => ({
					...e,
					start: DateTime.fromISO(e.start, { zone: 'utc' }).setZone(clientZone).toISO(),
					end: DateTime.fromISO(e.end, { zone: 'utc' }).setZone(clientZone).toISO(),
				}))
			: events;
		return mapped;
	});

	fastify.get('/v1/freebusy', async (req, reply) => {
		const parsed = qSchema.omit({ includeCancelled: true, clientZone: true }).safeParse(req.query);
		if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.message });
		const { start, end } = parsed.data;
		const events = await expandWindow(start, end, false);
		const byCal = new Map<string, { start: string; end: string }[]>();
		for (const e of events) {
			const arr = byCal.get(e.calendarId) ?? [];
			arr.push({ start: e.start, end: e.end });
			byCal.set(e.calendarId, arr);
		}
		const coalesce = (intervals: { start: string; end: string }[]) => {
			const sorted = intervals
				.map((i) => ({ s: DateTime.fromISO(i.start), e: DateTime.fromISO(i.end) }))
				.sort((a, b) => a.s.toMillis() - b.s.toMillis());
			const out: { start: string; end: string }[] = [];
			for (const iv of sorted) {
				if (out.length === 0) {
					out.push({ start: iv.s.toISO()!, end: iv.e.toISO()! });
					continue;
				}
				const last = out[out.length - 1]!;
				const lastS = DateTime.fromISO(last.start);
				const lastE = DateTime.fromISO(last.end);
				if (iv.s <= lastE) {
					const newEnd = iv.e > lastE ? iv.e : lastE;
					last.end = newEnd.toISO()!;
				} else {
					out.push({ start: iv.s.toISO()!, end: iv.e.toISO()! });
				}
			}
			return out;
		};
		const calendars: Record<string, { start: string; end: string }[]> = {};
		for (const [calId, ints] of byCal.entries()) calendars[calId] = coalesce(ints);
		// overall merged
		const merged = coalesce(events.map((e) => ({ start: e.start, end: e.end })));
		return { calendars, merged };
	});

	done();
};

export default fp(eventsPlugin);
