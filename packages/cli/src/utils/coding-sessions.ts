import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {getConfigPath} from '@/config/paths';

// Sessions file path - uses same directory as config
const SESSIONS_DIR = getConfigPath();
const SESSIONS_FILE = join(SESSIONS_DIR, 'sessions.json');

// Session status
export type SessionStatus = 'running' | 'completed' | 'error' | 'closed';

// Stored session data
export interface StoredSession {
	sessionId: string;
	agent: string;
	prompt: string;
	dir: string;
	status: SessionStatus;
	output?: string;
	error?: string;
	startedAt: number;
	updatedAt: number;
}

export interface SessionsData {
	sessions: Record<string, StoredSession>;
}

/**
 * Ensure sessions directory exists
 */
export function ensureSessionsDir(): void {
	if (!existsSync(SESSIONS_DIR)) {
		mkdirSync(SESSIONS_DIR, {recursive: true});
	}
}

/**
 * Load all sessions from disk
 */
export function loadSessions(): SessionsData {
	ensureSessionsDir();
	try {
		if (existsSync(SESSIONS_FILE)) {
			const data = readFileSync(SESSIONS_FILE, 'utf-8');
			return JSON.parse(data) as SessionsData;
		}
	} catch {
		// Ignore errors, return empty
	}
	return {sessions: {}};
}

/**
 * Save all sessions to disk
 */
export function saveSessions(data: SessionsData): void {
	ensureSessionsDir();
	writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Get a single session by ID
 */
export function getSession(sessionId: string): StoredSession | null {
	const data = loadSessions();
	return data.sessions[sessionId] || null;
}

/**
 * Create or update a session
 */
export function updateSession(session: StoredSession): void {
	const data = loadSessions();
	data.sessions[session.sessionId] = session;
	saveSessions(data);
}

/**
 * Delete a session by ID
 */
export function deleteSession(sessionId: string): boolean {
	const data = loadSessions();
	if (data.sessions[sessionId]) {
		delete data.sessions[sessionId];
		saveSessions(data);
		return true;
	}
	return false;
}

/**
 * List all sessions
 */
export function listSessions(): StoredSession[] {
	const data = loadSessions();
	return Object.values(data.sessions);
}

/**
 * Create a new session object
 */
export function createSession(params: {
	sessionId: string;
	agent: string;
	prompt: string;
	dir: string;
}): StoredSession {
	return {
		sessionId: params.sessionId,
		agent: params.agent,
		prompt: params.prompt,
		dir: params.dir,
		status: 'running',
		startedAt: Date.now(),
		updatedAt: Date.now(),
	};
}

/**
 * Mark session as completed with output
 */
export function completeSession(
	sessionId: string,
	output: string,
	success: boolean,
	error?: string,
): void {
	const session = getSession(sessionId);
	if (session) {
		session.output = output;
		session.status = success ? 'completed' : 'error';
		session.error = error;
		session.updatedAt = Date.now();
		updateSession(session);
	}
}

/**
 * Mark session as closed
 */
export function closeSession(sessionId: string): boolean {
	const session = getSession(sessionId);
	if (session) {
		session.status = 'closed';
		session.updatedAt = Date.now();
		updateSession(session);
		return true;
	}
	return false;
}
