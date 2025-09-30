'use strict';
import { DateTime } from 'luxon';
import { loadEnv } from '../config/env.js';
import { getTokenPayload, saveTokenPayload } from '../db/tokens.js';
import { logger } from '../logging/logger.js';

const DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export type GoogleTokenSet = {
	access_token: string;
	expires_in: number; // seconds
	expiry_date: number; // epoch ms
	refresh_token?: string;
	scope?: string;
	token_type: 'Bearer' | string;
};

export type DeviceCodeResponse = {
	device_code: string;
	user_code: string;
	verification_url: string;
	expires_in: number; // seconds
	interval?: number; // seconds
};

const save = (tokens: GoogleTokenSet) => saveTokenPayload<GoogleTokenSet>('google', tokens);
const load = (): GoogleTokenSet | null => getTokenPayload<GoogleTokenSet>('google');

export const startDeviceAuth = async (): Promise<DeviceCodeResponse> => {
	const env = loadEnv();
	if (!env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID is required');
	const body = new URLSearchParams({
		client_id: env.GOOGLE_CLIENT_ID,
		scope: env.GOOGLE_SCOPES,
	});
	const res = await fetch(DEVICE_CODE_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body,
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Device code request failed: ${res.status} ${res.statusText} - ${text}`);
	}
	const json = (await res.json()) as DeviceCodeResponse;
	return json;
};

export const pollForToken = async (
	deviceCode: string,
	intervalSec: number,
): Promise<GoogleTokenSet> => {
	const env = loadEnv();
	if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
		throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required');
	}
	let waitMs = Math.max(5000, intervalSec * 1000);
	const paramsBase = {
		client_id: env.GOOGLE_CLIENT_ID,
		client_secret: env.GOOGLE_CLIENT_SECRET,
		device_code: deviceCode,
		grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
	};
	const start = Date.now();
	// eslint-disable-next-line no-constant-condition
	while (true) {
		await new Promise((r) => setTimeout(r, waitMs));
		const res = await fetch(TOKEN_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams(paramsBase as Record<string, string>),
		});
		const json = (await res.json()) as any;
		if (res.ok) {
			const expiryDate = Date.now() + (json.expires_in ?? 3600) * 1000;
			const tokens: GoogleTokenSet = {
				access_token: json.access_token,
				expires_in: json.expires_in,
				expiry_date: expiryDate,
				refresh_token: json.refresh_token,
				scope: json.scope,
				token_type: json.token_type,
			};
			save(tokens);
			return tokens;
		}
		if (json.error === 'authorization_pending') {
			logger.debug('Authorization pending; will poll again');
			continue;
		}
		if (json.error === 'slow_down') {
			waitMs += 5000;
			logger.debug({ waitMs }, 'Received slow_down; increasing polling interval');
			continue;
		}
		if (json.error === 'access_denied') {
			throw new Error('User denied access');
		}
		if (json.error === 'expired_token') {
			throw new Error('Device code expired; start again');
		}
		throw new Error(`Unexpected token polling error: ${JSON.stringify(json)}`);
	}
	// Unreachable
	// eslint-disable-next-line no-unreachable
	throw new Error('Unreachable');
};

export const refreshAccessToken = async (): Promise<GoogleTokenSet> => {
	const env = loadEnv();
	const existing = load();
	if (!existing?.refresh_token) throw new Error('No stored refresh_token');
	const body = new URLSearchParams({
		client_id: env.GOOGLE_CLIENT_ID!,
		client_secret: env.GOOGLE_CLIENT_SECRET!,
		refresh_token: existing.refresh_token,
		grant_type: 'refresh_token',
	});
	const res = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body,
	});
	const json = (await res.json()) as any;
	if (!res.ok) {
		throw new Error(
			`Refresh token failed: ${res.status} ${res.statusText} - ${JSON.stringify(json)}`,
		);
	}
	const expiryDate = Date.now() + (json.expires_in ?? 3600) * 1000;
	const tokens: GoogleTokenSet = {
		access_token: json.access_token,
		expires_in: json.expires_in,
		expiry_date: expiryDate,
		refresh_token: existing.refresh_token, // Google may omit refresh_token on refresh
		scope: json.scope ?? existing.scope,
		token_type: json.token_type ?? existing.token_type,
	};
	save(tokens);
	return tokens;
};

export const getValidAccessToken = async (): Promise<string> => {
	const existing = load();
	if (!existing) throw new Error('No Google tokens stored');
	const now = DateTime.utc().toMillis();
	if (existing.expiry_date - now < 60_000) {
		const refreshed = await refreshAccessToken();
		return refreshed.access_token;
	}
	return existing.access_token;
};
