import {spawn as ptySpawn, type IPty} from 'node-pty';
import {execFileSync} from 'node:child_process';
import {existsSync, statSync, chmodSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';

const MAX_BUFFER_BYTES = 256 * 1024; // 256 KB scrollback
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

/**
 * When the gateway is launched from launchd / systemd / a non-login shell,
 * `process.env.PATH` often omits per-user tool installs (npm global bin,
 * `~/.claude/local/node_modules/.bin`, etc.), so `posix_spawnp('claude', …)`
 * fails with ENOENT. Capture the user's login-shell PATH once at startup so
 * agents like `claude` / `codex` resolve. Mirrors the Rust Tauri
 * `capture_login_path` fix.
 *
 * Prefers `$SHELL` (what the user actually uses), then falls back through
 * the common POSIX shells. Returns `process.env.PATH` if none are usable.
 */
function captureLoginPath(): string {
	const candidates = [
		process.env.SHELL,
		'/bin/zsh',
		'/bin/bash',
		'/bin/sh',
	].filter((s): s is string => Boolean(s && existsSync(s)));

	for (const shell of candidates) {
		try {
			const out = execFileSync(shell, ['-lc', 'printf %s "$PATH"'], {
				encoding: 'utf8',
				timeout: 3_000,
			});
			const path = out.trim();
			if (path) return path;
		} catch {
			/* try next */
		}
	}
	return process.env.PATH ?? '';
}

const LOGIN_PATH = captureLoginPath();

/**
 * node-pty's Unix `spawn(...)` execs a bundled bootstrap (`spawn-helper`)
 * which then sets up the PTY and execs the real target. If that helper isn't
 * marked executable every spawn fails with the same cryptic `posix_spawnp
 * failed.` — for `echo`, `sh`, `claude`, anything. This normally arrives
 * with mode 0755 in the npm tarball, but some installers (pnpm's
 * content-addressed store on certain filesystems, archival tools that strip
 * mode bits) drop the +x. Self-heal at boot so the user never hits that.
 */
function ensureSpawnHelperExecutable(): void {
	if (process.platform === 'win32') return;

	const plat = process.platform; // 'darwin' | 'linux'
	const arch = process.arch; // 'arm64' | 'x64'
	try {
		const req = createRequire(import.meta.url);
		const ptyPkgPath = req.resolve('node-pty/package.json');
		const ptyRoot = dirname(ptyPkgPath);
		const helper = join(
			ptyRoot,
			'prebuilds',
			`${plat}-${arch}`,
			'spawn-helper',
		);
		if (!existsSync(helper)) return;
		const mode = statSync(helper).mode;
		if ((mode & 0o111) === 0) {
			chmodSync(helper, 0o755);
		}
	} catch {
		/* best-effort — spawn errors will surface the real problem if this fails */
	}
}

ensureSpawnHelperExecutable();

/**
 * Resolve a bare command to an absolute path using `command -v` under the
 * captured login PATH. We do this before spawn so `posix_spawnp` doesn't have
 * to do its own PATH lookup — if the resolution fails we surface a clear
 * "not found on PATH" error instead of the cryptic `posix_spawnp failed`.
 */
function resolveCommand(command: string): string | null {
	// Already absolute or relative — trust the caller.
	if (command.includes('/')) return command;
	try {
		const out = execFileSync(
			'/bin/sh',
			['-c', `command -v ${command}`],
			{
				encoding: 'utf8',
				timeout: 3_000,
				env: {...process.env, PATH: LOGIN_PATH || process.env.PATH || ''},
			},
		);
		const resolved = out.trim();
		return resolved || null;
	} catch {
		return null;
	}
}

export type PtySubscriber = (data: string) => void;
export type ExitSubscriber = (info: {exitCode: number; signal?: number}) => void;

interface PtyHandle {
	pty: IPty;
	outputBuffer: Buffer;
	pendingUtf8: Buffer;
	createdAt: number;
	cancelled: boolean;
	exited: boolean;
	exitInfo?: {exitCode: number; signal?: number};
	subscribers: Set<PtySubscriber>;
	exitSubscribers: Set<ExitSubscriber>;
	lastActivityAt: number;
	meta: {
		command: string;
		args: string[];
		cwd: string;
		agent?: string;
	};
}

export interface SpawnOptions {
	sessionId: string;
	command: string;
	args: string[];
	cwd: string;
	env?: Record<string, string>;
	cols?: number;
	rows?: number;
	agent?: string;
}

export interface AttachResult {
	replayed: string;
	exited: boolean;
	exitInfo?: {exitCode: number; signal?: number};
	meta: PtyHandle['meta'];
	createdAt: number;
	pid: number;
	detach: () => void;
}

class PtyManager {
	private handles = new Map<string, PtyHandle>();

	spawn(opts: SpawnOptions): {pid: number} {
		const existing = this.handles.get(opts.sessionId);
		if (existing && !existing.exited && existing.pty) {
			throw new Error(
				`Session "${opts.sessionId}" is already running — kill it first or attach to it.`,
			);
		}
		// If there's a stale exited handle, drop it.
		if (existing) this.handles.delete(opts.sessionId);

		const env = {
			...process.env,
			// Override PATH with the login-shell PATH so per-user tool installs
			// (claude, codex, npm global bin) resolve even when the gateway was
			// launched by launchd/systemd with a minimal environment.
			PATH: LOGIN_PATH || process.env.PATH || '',
			...(opts.env ?? {}),
			TERM: 'xterm-256color',
		} as Record<string, string>;

		const resolved = resolveCommand(opts.command);
		if (!resolved) {
			throw new Error(
				`command "${opts.command}" not found on PATH (tried login shell). ` +
					`Install it or set an absolute path in the agent config.`,
			);
		}

		const pty = ptySpawn(resolved, opts.args, {
			name: 'xterm-256color',
			cols: opts.cols ?? 80,
			rows: opts.rows ?? 24,
			cwd: opts.cwd,
			env,
		});

		const handle: PtyHandle = {
			pty,
			outputBuffer: Buffer.alloc(0),
			pendingUtf8: Buffer.alloc(0),
			createdAt: Date.now(),
			cancelled: false,
			exited: false,
			subscribers: new Set(),
			exitSubscribers: new Set(),
			lastActivityAt: Date.now(),
			meta: {
				command: opts.command,
				args: opts.args,
				cwd: opts.cwd,
				agent: opts.agent,
			},
		};

		pty.onData((data) => {
			if (handle.cancelled) return;
			handle.lastActivityAt = Date.now();
			// Append raw bytes to scrollback (for future reconnects)
			const chunk = Buffer.from(data, 'utf8');
			handle.outputBuffer = Buffer.concat([handle.outputBuffer, chunk]);
			if (handle.outputBuffer.length > MAX_BUFFER_BYTES) {
				const drain = handle.outputBuffer.length - Math.floor(MAX_BUFFER_BYTES / 2);
				handle.outputBuffer = handle.outputBuffer.subarray(drain);
			}
			// node-pty already emits UTF-8 strings, but we still guard against subscriber
			// errors so one bad consumer can't kill the others.
			for (const sub of handle.subscribers) {
				try {
					sub(data);
				} catch {
					/* ignore subscriber errors */
				}
			}
		});

		pty.onExit(({exitCode, signal}) => {
			handle.exited = true;
			handle.exitInfo = {exitCode, signal};
			if (handle.cancelled) return;
			for (const sub of handle.exitSubscribers) {
				try {
					sub({exitCode, signal});
				} catch {
					/* ignore */
				}
			}
		});

		this.handles.set(opts.sessionId, handle);
		return {pid: pty.pid};
	}

	/**
	 * Attach a subscriber to an existing session. Replays scrollback synchronously,
	 * then streams new bytes via onData. Returns null if no session exists.
	 */
	attach(
		sessionId: string,
		onData: PtySubscriber,
		onExit?: ExitSubscriber,
	): AttachResult | null {
		const handle = this.handles.get(sessionId);
		if (!handle) return null;

		const replayed = handle.outputBuffer.toString('utf8');
		if (!handle.exited) {
			handle.subscribers.add(onData);
			if (onExit) handle.exitSubscribers.add(onExit);
		} else if (onExit && handle.exitInfo) {
			// Queue exit on next tick so caller can handle replay first
			const info = handle.exitInfo;
			setImmediate(() => onExit(info));
		}

		const detach = () => {
			handle.subscribers.delete(onData);
			if (onExit) handle.exitSubscribers.delete(onExit);
		};

		return {
			replayed,
			exited: handle.exited,
			exitInfo: handle.exitInfo,
			meta: handle.meta,
			createdAt: handle.createdAt,
			pid: handle.pty.pid,
			detach,
		};
	}

	write(sessionId: string, data: string): boolean {
		const handle = this.handles.get(sessionId);
		if (!handle || handle.exited) return false;
		handle.pty.write(data);
		return true;
	}

	resize(sessionId: string, cols: number, rows: number): boolean {
		const handle = this.handles.get(sessionId);
		if (!handle || handle.exited) return false;
		try {
			handle.pty.resize(cols, rows);
			return true;
		} catch {
			return false;
		}
	}

	kill(sessionId: string, signal: string = 'SIGTERM'): boolean {
		const handle = this.handles.get(sessionId);
		if (!handle) return false;
		try {
			handle.cancelled = true;
			handle.pty.kill(signal);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Kill a session and wait for the OS to reap the PTY (so a follow-up `spawn`
	 * with the same sessionId doesn't trip the "already running" guard). Falls
	 * back to dropping the handle if the exit event doesn't arrive in time —
	 * SIGKILL the underlying pid first to make sure we're not leaking a process.
	 */
	async killAndWait(
		sessionId: string,
		timeoutMs = 2000,
	): Promise<boolean> {
		const handle = this.handles.get(sessionId);
		if (!handle) return false;
		if (handle.exited) {
			this.handles.delete(sessionId);
			return true;
		}

		const exited = await new Promise<boolean>(resolve => {
			const onExit = () => {
				clearTimeout(timer);
				resolve(true);
			};
			handle.exitSubscribers.add(onExit);
			const timer = setTimeout(() => {
				handle.exitSubscribers.delete(onExit);
				resolve(false);
			}, timeoutMs);
			this.kill(sessionId, 'SIGTERM');
		});

		if (!exited) {
			try {
				handle.pty.kill('SIGKILL');
			} catch {
				/* ignore */
			}
		}
		this.handles.delete(sessionId);
		return true;
	}

	killAll(): void {
		for (const sessionId of this.handles.keys()) {
			this.kill(sessionId, 'SIGTERM');
		}
	}

	isRunning(sessionId: string): boolean {
		const handle = this.handles.get(sessionId);
		return Boolean(handle && !handle.exited);
	}

	getPid(sessionId: string): number | undefined {
		const handle = this.handles.get(sessionId);
		return handle?.pty.pid;
	}

	getLastActivity(sessionId: string): number | undefined {
		return this.handles.get(sessionId)?.lastActivityAt;
	}

	/**
	 * Drop handles that have aged out past MAX_AGE_MS and whose process has
	 * already exited. Live PTYs are never reaped — only observed as stale.
	 */
	reap(): void {
		const now = Date.now();
		for (const [id, h] of this.handles) {
			if (h.exited && now - h.createdAt > MAX_AGE_MS) {
				this.handles.delete(id);
			}
		}
	}
}

export const ptyManager = new PtyManager();
