'use strict';
import { decryptJson, encryptJson } from '../crypto/aes.js';
import { getDb } from './conn.js';

export type OAuthProvider = 'google';

export const saveTokenPayload = <T>(provider: OAuthProvider, payload: T): void => {
	const { sqlite } = getDb();
	const encrypted = encryptJson(payload);
	sqlite
		.prepare(
			`INSERT INTO oauth_tokens (provider, payload_encrypted, updated_at)
			 VALUES (@provider, @payload_encrypted, @updated_at)
			 ON CONFLICT(provider) DO UPDATE SET payload_encrypted = excluded.payload_encrypted,
			 updated_at = excluded.updated_at`,
		)
		.run({ provider, payload_encrypted: encrypted, updated_at: Date.now() });
};

export const getTokenPayload = <T>(provider: OAuthProvider): T | null => {
	const { sqlite } = getDb();
	const row = sqlite
		.prepare('SELECT payload_encrypted FROM oauth_tokens WHERE provider = ?')
		.get(provider) as { payload_encrypted: string } | undefined;
	if (!row) return null;
	return decryptJson<T>(row.payload_encrypted);
};
