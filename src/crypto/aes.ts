'use strict';
import crypto from 'node:crypto';
import { loadEnv } from '../config/env.js';

const VERSION = 'v1';

const getKey = (): Buffer => {
	const { OAUTH_ENCRYPTION_KEY } = loadEnv();
	if (!OAUTH_ENCRYPTION_KEY) {
		throw new Error('OAUTH_ENCRYPTION_KEY is required for encryption operations');
	}
	const key = Buffer.from(OAUTH_ENCRYPTION_KEY, 'base64');
	if (key.length !== 32) throw new Error('OAUTH_ENCRYPTION_KEY must decode to 32 bytes');
	return key;
};

export type EncryptedString = string; // format: v1:base64(iv):base64(ciphertext):base64(tag)

export const encryptString = (plaintext: string): EncryptedString => {
	const key = getKey();
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [
		VERSION,
		iv.toString('base64'),
		encrypted.toString('base64'),
		tag.toString('base64'),
	].join(':');
};

export const decryptString = (encrypted: EncryptedString): string => {
	const parts = encrypted.split(':');
	if (parts.length !== 4) {
		throw new Error('Invalid encrypted string format');
	}
	const [version, ivB64, dataB64, tagB64] = parts as [string, string, string, string];
	if (version !== VERSION) throw new Error(`Unsupported encryption version: ${version}`);
	const key = getKey();
	const iv = Buffer.from(ivB64, 'base64');
	const tag = Buffer.from(tagB64, 'base64');
	const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(tag);
	const decrypted = Buffer.concat([
		decipher.update(Buffer.from(dataB64, 'base64')),
		decipher.final(),
	]);
	return decrypted.toString('utf8');
};

export const encryptJson = <T>(obj: T): EncryptedString => encryptString(JSON.stringify(obj));
export const decryptJson = <T>(enc: EncryptedString): T => JSON.parse(decryptString(enc)) as T;
