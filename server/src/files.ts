// Sends files from disk with Range support. Game archives and engine builds
// run to hundreds of megabytes, and the page resumes broken downloads with
// Range requests, so this must get partial responses and their validators
// exactly right: a resumed download that mixes two versions of a file is
// silently corrupt.

import { createReadStream, type Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from './errors.ts';

const CONTENT_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    // instantiateStreaming refuses wasm served under any other type.
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.zip': 'application/zip',
    '.7z': 'application/x-7z-compressed',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.xz': 'application/x-xz',
};

export function contentTypeFor(path: string): string {
    return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/** The file's stats if it is a regular file, else null. */
export async function statFile(path: string): Promise<Stats | null> {
    try {
        const stats = await stat(path);
        return stats.isFile() ? stats : null;
    } catch {
        return null;
    }
}

/**
 * Maps a request path below a mount point onto a file under root, or null
 * when it would leave root or name a hidden file such as .env.
 */
export function resolveInside(root: string, requestPath: string): string | null {
    let decoded: string;
    try {
        decoded = decodeURIComponent(requestPath);
    } catch {
        return null;
    }
    if (decoded.includes('\0')) return null;
    const segments = decoded.split('/').filter((segment) => segment !== '');
    if (segments.some((segment) => segment.startsWith('.'))) return null;
    const full = resolve(root, ...segments);
    return full === root || full.startsWith(root + sep) ? full : null;
}

/** The path part of a request URL, still percent-encoded. */
export function requestPath(request: FastifyRequest): string {
    const url = request.url;
    const query = url.indexOf('?');
    return query === -1 ? url : url.slice(0, query);
}

export type ByteRange = { start: number; end: number };

/**
 * Reads a Range header against a file of `size` bytes. Null means "send the
 * whole file": no header, a unit other than bytes, a malformed one, or
 * several ranges (which RFC 9110 lets a server ignore, and the page never
 * asks for).
 */
export function parseRange(header: string | undefined, size: number): ByteRange | 'unsatisfiable' | null {
    if (header === undefined) return null;
    const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
    if (!match) return null;
    const [, first = '', last = ''] = match;
    if (first === '' && last === '') return null;

    if (first === '') {
        // A suffix: the last N bytes.
        const length = Number(last);
        if (length === 0 || size === 0) return 'unsatisfiable';
        return { start: Math.max(0, size - length), end: size - 1 };
    }

    const start = Number(first);
    // last-pos below first-pos is malformed, not merely out of reach.
    if (last !== '' && Number(last) < start) return null;
    if (start >= size) return 'unsatisfiable';
    return { start, end: last === '' ? size - 1 : Math.min(Number(last), size - 1) };
}

function etagOf(stats: Stats): string {
    // Strong, so that If-Range can use it: a resumed download only continues
    // while the file is unchanged.
    return `"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
}

function stripWeak(tag: string): string {
    return tag.startsWith('W/') ? tag.slice(2) : tag;
}

function matchesNoneMatch(header: string, etag: string): boolean {
    if (header.trim() === '*') return true;
    return header.split(',').some((tag) => stripWeak(tag.trim()) === etag);
}

/** Whether to honour Range given If-Range; any doubt sends the whole file. */
function rangeStillValid(ifRange: string | undefined, etag: string, lastModified: string): boolean {
    if (ifRange === undefined) return true;
    const value = ifRange.trim();
    if (value.startsWith('"') || value.startsWith('W/')) return value === etag;
    return value === lastModified;
}

function notModifiedSince(header: string | undefined, stats: Stats): boolean {
    if (header === undefined) return false;
    const since = Date.parse(header);
    return !Number.isNaN(since) && Math.floor(stats.mtimeMs / 1000) * 1000 <= since;
}

export interface SendFileOptions {
    cacheControl: string;
}

/** Answers a GET or HEAD with the file, honouring Range and conditional headers. */
export function sendFile(
    request: FastifyRequest,
    reply: FastifyReply,
    path: string,
    stats: Stats,
    options: SendFileOptions,
): FastifyReply {
    const size = stats.size;
    const etag = etagOf(stats);
    const lastModified = stats.mtime.toUTCString();
    reply.header('accept-ranges', 'bytes');
    reply.header('etag', etag);
    reply.header('last-modified', lastModified);
    reply.header('cache-control', options.cacheControl);

    const ifNoneMatch = request.headers['if-none-match'];
    const fresh =
        ifNoneMatch !== undefined
            ? matchesNoneMatch(ifNoneMatch, etag)
            : notModifiedSince(request.headers['if-modified-since'], stats);
    if (fresh) return reply.code(304).send();

    reply.header('content-type', contentTypeFor(path));

    let range: ByteRange | 'unsatisfiable' | null = null;
    if (rangeStillValid(stringHeader(request.headers['if-range']), etag, lastModified)) {
        range = parseRange(stringHeader(request.headers.range), size);
    }
    if (range === 'unsatisfiable') {
        reply.header('content-range', `bytes */${size}`);
        throw new HttpError(416, 'range_not_satisfiable', `The file is ${size} bytes long; the requested range lies outside it.`);
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    const length = size === 0 ? 0 : end - start + 1;
    if (range) {
        reply.code(206);
        reply.header('content-range', `bytes ${start}-${end}/${size}`);
    }
    reply.header('content-length', String(length));

    // An empty stream rather than no payload: Fastify would otherwise
    // rewrite Content-Length to 0 on HEAD.
    if (request.method === 'HEAD' || length === 0) return reply.send(Readable.from([]));
    return reply.send(createReadStream(path, { start, end }));
}

function stringHeader(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}
