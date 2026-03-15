import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {getConfigPath} from '@/config/paths';

const SESSIONS_DIR = getConfigPath();
const SESSIONS_FILE = join(SESSIONS_DIR, 'sessions.json');

// Only tracks currently running sessions.
// Completed/closed sessions are deleted — source of truth is Claude's JSONL files.
export interface RunningSession {
	sessionId: string;
	agent: string;
	dir: string;
	pid?: number;
	startedAt: number;
	worktreePath?: string;
	worktreeBranch?: string;
}

interface SessionsData {
	sessions: Record<string, RunningSession>;
}

function ensureSessionsDir(): void {
	if (!existsSync(SESSIONS_DIR)) {
		mkdirSync(SESSIONS_DIR, {recursive: true});
	}
}

function loadSessions(): SessionsData {
	ensureSessionsDir();
	try {
		if (existsSync(SESSIONS_FILE)) {
			const data = readFileSync(SESSIONS_FILE, 'utf-8');
			return JSON.parse(data) as SessionsData;
		}
	} catch {
		// Ignore, return empty
	}
	return {sessions: {}};
}

function saveSessions(data: SessionsData): void {
	ensureSessionsDir();
	writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function getSession(sessionId: string): RunningSession | null {
	const data = loadSessions();
	return data.sessions[sessionId] || null;
}

export function upsertSession(session: RunningSession): void {
	const data = loadSessions();
	data.sessions[session.sessionId] = session;
	saveSessions(data);
}

export function deleteSession(sessionId: string): boolean {
	const data = loadSessions();
	if (data.sessions[sessionId]) {
		delete data.sessions[sessionId];
		saveSessions(data);
		return true;
	}
	return false;
}

export function listRunningSessions(): RunningSession[] {
	const data = loadSessions();
	return Object.values(data.sessions);
}

export function isProcessRunningByPid(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
