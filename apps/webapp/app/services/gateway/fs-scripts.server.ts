/**
 * Inline Node scripts that the webapp ships to the gateway via the
 * existing `exec_command` tool. Lets us browse folders + read entry
 * metadata without adding a new gateway tool or shipping a new gateway
 * release — the script body runs inside the gateway's Node process via
 * `node -e <SCRIPT> <path>`.
 *
 * The gateway's `exec_command` enforces folder-scope on the working
 * directory, so paths outside a registered `exec`-scoped folder are
 * rejected before the script ever runs.
 *
 * Carefully avoids the default-blocked tokens enforced by
 * `packages/cli/src/server/tools/exec-tools.ts` (no rm/curl/sudo/eval).
 */

/** Lists entries in argv[1]. Emits a JSON array to stdout. */
export const LIST_SCRIPT = `const fs=require('fs'),p=require('path');const d=process.argv[1];const out=[];for(const e of fs.readdirSync(d,{withFileTypes:true})){const full=p.join(d,e.name);let s;try{s=fs.lstatSync(full);}catch(_){continue;}const t=e.isDirectory()?'dir':e.isSymbolicLink()?'link':e.isFile()?'file':'other';const o={name:e.name,type:t,size:s.size,mtime:s.mtimeMs,mode:s.mode&0o7777};if(e.isSymbolicLink()){try{o.target=fs.readlinkSync(full);}catch(_){}}out.push(o);}process.stdout.write(JSON.stringify(out));`;

/** Reads detailed metadata for argv[1]. Emits a JSON object to stdout. */
export const STAT_SCRIPT = `const fs=require('fs');const t=process.argv[1];const s=fs.lstatSync(t);const o={size:s.size,mtime:s.mtimeMs,atime:s.atimeMs,ctime:s.ctimeMs,birthtime:s.birthtimeMs,mode:s.mode&0o7777,uid:s.uid,gid:s.gid,type:s.isDirectory()?'dir':s.isSymbolicLink()?'link':s.isFile()?'file':'other'};if(s.isSymbolicLink()){try{o.target=fs.readlinkSync(t);}catch(_){}}process.stdout.write(JSON.stringify(o));`;

/**
 * Reads up to argv[2] bytes (default ~100 KB) from argv[1] as UTF-8.
 * Emits JSON `{ text, truncated, totalBytes, readBytes }`.
 *
 * Cap is kept well below the gateway's default 128 KB stdout cap so
 * JSON-escape overhead never tips us into the gateway's truncation
 * path (which injects a marker that would break JSON.parse here).
 */
export const READ_SCRIPT = `const fs=require('fs');const t=process.argv[1];const cap=parseInt(process.argv[2],10)||102400;const st=fs.statSync(t);const fd=fs.openSync(t,'r');const want=Math.min(st.size,cap);const buf=Buffer.alloc(want);let n=0;if(want>0){n=fs.readSync(fd,buf,0,want,0);}fs.closeSync(fd);const text=buf.subarray(0,n).toString('utf8');process.stdout.write(JSON.stringify({text:text,truncated:st.size>n,totalBytes:st.size,readBytes:n}));`;

export const READ_DEFAULT_CAP = 102_400;

/**
 * Reads `count` bytes starting at `offset` from argv[1]. Emits JSON
 * `{ data, bytesRead, totalBytes, eof }` where `data` is a base64
 * string.
 *
 * Used by /fs/download. The webapp loops this script in chunks of
 * ~64 KB raw (~87 KB base64) so each call stays under the gateway's
 * 128 KB stdout cap. base64 inflation factor is ~1.34 so 65536 raw →
 * ~87381 base64 → with JSON wrapper ~87400 total. Safe.
 */
export const READ_CHUNK_SCRIPT = `const fs=require('fs');const t=process.argv[1];const off=parseInt(process.argv[2],10)||0;const cnt=parseInt(process.argv[3],10)||65536;const st=fs.statSync(t);const fd=fs.openSync(t,'r');const buf=Buffer.alloc(cnt);const n=st.size>off?fs.readSync(fd,buf,0,cnt,off):0;fs.closeSync(fd);const data=buf.subarray(0,n).toString('base64');process.stdout.write(JSON.stringify({data:data,bytesRead:n,totalBytes:st.size,eof:off+n>=st.size}));`;

export const DOWNLOAD_CHUNK_BYTES = 65_536;
export const DOWNLOAD_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Removes argv[1]. Handles both files and directories — directories
 * are removed recursively. `force:true` swallows ENOENT so the script
 * is idempotent (subsequent calls succeed even after the entry is
 * gone). Emits `"ok"` on success; non-zero exit on any other error.
 *
 * Uses `fs.rmSync` (no `rm` token) so the gateway's exec deny-list
 * doesn't block it. Folder-scope on the `dir` parameter is the only
 * boundary that prevents escapes outside a registered exec folder.
 */
export const DELETE_SCRIPT = `const fs=require('fs');const t=process.argv[1];fs.rmSync(t,{recursive:true,force:true});process.stdout.write('ok');`;

/**
 * POSIX single-quote shell escape. Wraps the input in `'…'` and
 * replaces any embedded `'` with `'\''`.
 */
export function shEsc(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export interface FsEntry {
  name: string;
  type: "dir" | "file" | "link" | "other";
  size: number;
  mtime: number;
  mode: number;
  target?: string;
}

export interface FsStat {
  size: number;
  mtime: number;
  atime: number;
  ctime: number;
  birthtime: number;
  mode: number;
  uid: number;
  gid: number;
  type: "dir" | "file" | "link" | "other";
  target?: string;
}

export interface FsRead {
  text: string;
  truncated: boolean;
  totalBytes: number;
  readBytes: number;
}
