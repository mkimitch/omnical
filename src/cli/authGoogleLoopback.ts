'use strict';
import 'dotenv/config';
import http from 'node:http';
import { loadEnv } from '../config/env.js';
import { exchangeCodeForTokens } from '../google/oauth.js';
import { logger } from '../logging/logger.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const LOOPBACK_PORT = 4567;
const REDIRECT_URI = `http://localhost:${LOOPBACK_PORT}/callback`;

const main = async () => {
	const env = loadEnv();
	const clientId = env.GOOGLE_LOOPBACK_CLIENT_ID;
	const clientSecret = env.GOOGLE_LOOPBACK_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error(
			'GOOGLE_LOOPBACK_CLIENT_ID and GOOGLE_LOOPBACK_CLIENT_SECRET must be set.\n' +
			'Add your Desktop OAuth client credentials to .env and retry.',
		);
	}

	const params = new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: REDIRECT_URI,
		scope: env.GOOGLE_SCOPES,
		access_type: 'offline',
		prompt: 'consent',
	});

	const authUrl = `${AUTH_URL}?${params.toString()}`;

	console.log('\nGoogle Loopback Authorization');
	console.log('================================');
	console.log('Open this URL in your browser:\n');
	console.log(authUrl);
	console.log('\nWaiting for browser callback on port', LOOPBACK_PORT, '...\n');

	const code = await new Promise<string>((resolve, reject) => {
		const server = http.createServer((req, res) => {
			const url = new URL(req.url!, `http://localhost:${LOOPBACK_PORT}`);
			if (url.pathname !== '/callback') {
				res.writeHead(404);
				res.end('Not found');
				return;
			}

			const authCode = url.searchParams.get('code');
			const error = url.searchParams.get('error');

			if (error) {
				res.writeHead(200, { 'content-type': 'text/html' });
				res.end(
					'<html><body><h1>Authorization failed</h1><p>You may close this tab.</p></body></html>',
				);
				server.close();
				reject(new Error(`Authorization failed: ${error}`));
				return;
			}

			if (!authCode) {
				res.writeHead(400);
				res.end('Missing code');
				server.close();
				reject(new Error('No authorization code in callback'));
				return;
			}

			res.writeHead(200, { 'content-type': 'text/html' });
			res.end(
				'<html><body><h1>Authorization successful!</h1><p>You may close this tab.</p></body></html>',
			);
			server.close();
			resolve(authCode);
		});

		server.listen(LOOPBACK_PORT, 'localhost', () => {
			logger.debug({ port: LOOPBACK_PORT }, 'Loopback callback server listening');
		});

		server.on('error', (err) => {
			reject(new Error(`Loopback server error: ${(err as Error).message}`));
		});

		setTimeout(
			() => {
				server.close();
				reject(new Error('Authorization timed out after 5 minutes'));
			},
			5 * 60 * 1000,
		);
	});

	console.log('Authorization code received, exchanging for tokens...');
	const tokens = await exchangeCodeForTokens(code, REDIRECT_URI, clientId, clientSecret);
	console.log(`\nSuccess! Tokens stored.`);
	console.log(`Scopes: ${tokens.scope}`);
	logger.info(
		{ expiry: new Date(tokens.expiry_date).toISOString(), scope: tokens.scope },
		'Google tokens stored via loopback',
	);
};

main().catch((err) => {
	logger.error({ err }, 'Google loopback auth failed');
	console.error('Error:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
