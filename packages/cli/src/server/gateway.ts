import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createSession, killSession, getSessionContent, listSessions, sessionExists } from '@/utils/tmux';

interface SessionInfo {
	id: string;
	workingDir: string;
	createdAt: number;
	command: string;
}

// In-memory session tracking
const sessions = new Map<string, SessionInfo>();

function parseBody(req: IncomingMessage): Promise<any> {
	return new Promise((resolve, reject) => {
		let body = '';
		req.on('data', chunk => { body += chunk.toString(); });
		req.on('end', () => {
			try {
				resolve(body ? JSON.parse(body) : {});
			} catch (err) {
				reject(err);
			}
		});
		req.on('error', reject);
	});
}

function sendJSON(res: ServerResponse, statusCode: number, data: any) {
	res.writeHead(statusCode, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(data));
}

function generateSessionId(): string {
	return `claude-code-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
	const url = new URL(req.url || '/', `http://${req.headers.host}`);
	const method = req.method || 'GET';
	const pathname = url.pathname;

	// CORS headers
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

	if (method === 'OPTIONS') {
		res.writeHead(204);
		res.end();
		return;
	}

	try {
		// Health check
		if (pathname === '/health' && method === 'GET') {
			sendJSON(res, 200, { status: 'ok', timestamp: Date.now() });
			return;
		}

		// List sessions
		if (pathname === '/sessions' && method === 'GET') {
			const tmuxSessions = await listSessions();
			const activeSessions = Array.from(sessions.entries())
				.filter(([id]) => tmuxSessions.includes(id))
				.map(([id, info]) => ({ ...info }));
			sendJSON(res, 200, { sessions: activeSessions });
			return;
		}

		// Create session
		if (pathname === '/sessions' && method === 'POST') {
			const body = await parseBody(req);
			const { workingDir = process.cwd(), command = 'claude' } = body;

			const sessionId = generateSessionId();
			const sessionInfo: SessionInfo = {
				id: sessionId,
				workingDir,
				command,
				createdAt: Date.now(),
			};

			// Create tmux session with claude-code
			const fullCommand = `cd "${workingDir}" && ${command}`;
			await createSession(sessionId, fullCommand);

			sessions.set(sessionId, sessionInfo);

			sendJSON(res, 201, {
				success: true,
				session: sessionInfo
			});
			return;
		}

		// Get session details
		const sessionMatch = pathname.match(/^\/sessions\/([^\/]+)$/);
		if (sessionMatch && method === 'GET') {
			const sessionId = sessionMatch[1];
			const info = sessions.get(sessionId);

			if (!info) {
				sendJSON(res, 404, { error: 'Session not found' });
				return;
			}

			const exists = await sessionExists(sessionId);
			if (!exists) {
				sessions.delete(sessionId);
				sendJSON(res, 404, { error: 'Session no longer active' });
				return;
			}

			const content = await getSessionContent(sessionId);
			sendJSON(res, 200, {
				session: info,
				content,
				active: true
			});
			return;
		}

		// Delete session
		if (sessionMatch && method === 'DELETE') {
			const sessionId = sessionMatch[1];
			const info = sessions.get(sessionId);

			if (!info) {
				sendJSON(res, 404, { error: 'Session not found' });
				return;
			}

			const exists = await sessionExists(sessionId);
			if (exists) {
				await killSession(sessionId);
			}

			sessions.delete(sessionId);
			sendJSON(res, 200, { success: true, message: 'Session killed' });
			return;
		}

		// 404
		sendJSON(res, 404, { error: 'Not found' });
	} catch (error) {
		console.error('Gateway error:', error);
		sendJSON(res, 500, {
			error: 'Internal server error',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
}

export function startGatewayServer(port: number): Promise<{ server: any; port: number }> {
	return new Promise((resolve, reject) => {
		const server = createServer(handleRequest);

		server.on('error', reject);

		server.listen(port, () => {
			console.log(`Gateway server listening on port ${port}`);
			resolve({ server, port });
		});
	});
}
