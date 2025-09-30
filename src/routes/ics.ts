'use strict';
import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { expandWindow } from '../expansion/expand.js';

const defaultWindow = () => {
	const now = DateTime.utc();
	const end = now.plus({ days: 30 });
	return { start: now.toISO(), end: end.toISO() };
};

const icsPlugin: FastifyPluginCallback = (fastify, _opts, done) => {
	const qSchema = z.object({
		start: z.string().optional(),
		end: z.string().optional(),
	});
	fastify.get('/v1/ics', async (req, reply) => {
		const parsed = qSchema.safeParse(req.query);
		if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.message });
		const { start, end } = parsed.data;
		const win = start && end ? { start, end } : defaultWindow();
		const events = await expandWindow(win.start, win.end, false);
		let text = '';
		text += 'BEGIN:VCALENDAR\r\n';
		text += 'PRODID:-//omnical//EN\r\n';
		text += 'VERSION:2.0\r\n';
		for (const e of events) {
			text += 'BEGIN:VEVENT\r\n';
			text += `UID:${e.uid}\r\n`;
			text += `DTSTART:${DateTime.fromISO(e.start).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}\r\n`;
			text += `DTEND:${DateTime.fromISO(e.end).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}\r\n`;
			if (e.summary) text += `SUMMARY:${escapeIcs(e.summary)}\r\n`;
			if (e.location) text += `LOCATION:${escapeIcs(e.location)}\r\n`;
			if (e.description) text += `DESCRIPTION:${escapeIcs(e.description)}\r\n`;
			if (e.status) text += `STATUS:${e.status}\r\n`;
			text += 'END:VEVENT\r\n';
		}
		text += 'END:VCALENDAR\r\n';
		reply.header('Content-Type', 'text/calendar; charset=utf-8');
		return reply.send(text);
	});
	done();
};

const escapeIcs = (s: string): string =>
	s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');

export default fp(icsPlugin);
