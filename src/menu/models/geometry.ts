// Geometry helpers shared by the artifacts: lathe profiles (round, faceted or
// square, with crisp corners), tapered tubes along curves, thick 2D strokes
// and beveled extrusions, in-place transforms, and merging parts into one
// draw call per material.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** A lathe profile point: [radius, height], or [radius, height, 1] for a crisp corner. */
export type ProfilePoint = readonly [number, number] | readonly [number, number, 1];

/**
 * Revolves a profile around +Y. Unlike THREE.LatheGeometry it supports crisp
 * corners (engraved grooves, bezels), proper pole normals, and an optional
 * angular modulation of the radius (fluting, facets). θ = 0 faces +Z.
 *
 * Profiles are traced top to bottom along the outside (like drawing the
 * silhouette's right half downwards); faces then point away from the axis.
 */
export function revolve(
    profile: readonly ProfilePoint[],
    segments: number,
    modulate?: (theta: number, r: number, y: number) => number,
): THREE.BufferGeometry {
    type Row = { r: number; y: number; connect: boolean; pole: number };
    const rows: Row[] = [];
    profile.forEach((p, i) => {
        const sharp = p.length === 3 && i > 0 && i < profile.length - 1;
        if (sharp) rows.push({ r: p[0], y: p[1], connect: false, pole: 0 });
        rows.push({ r: p[0], y: p[1], connect: i < profile.length - 1, pole: 0 });
    });
    // Poles get an exact ±Y normal, pointing away from their neighbour row.
    const first = rows[0];
    const second = rows[1];
    const last = rows[rows.length - 1];
    const beforeLast = rows[rows.length - 2];
    if (first && second && first.r === 0) first.pole = Math.sign(first.y - second.y);
    if (last && beforeLast && last.r === 0) last.pole = Math.sign(last.y - beforeLast.y);

    const positions = new Float32Array(rows.length * segments * 3);
    rows.forEach((row, k) => {
        for (let j = 0; j < segments; j++) {
            const theta = (j / segments) * Math.PI * 2;
            const r = modulate && row.r > 0 ? modulate(theta, row.r, row.y) : row.r;
            const o = (k * segments + j) * 3;
            positions[o] = r * Math.sin(theta);
            positions[o + 1] = row.y;
            positions[o + 2] = r * Math.cos(theta);
        }
    });
    const index: number[] = [];
    rows.forEach((row, k) => {
        if (!row.connect || k === rows.length - 1) return;
        for (let j = 0; j < segments; j++) {
            const a = k * segments + j;
            const b = k * segments + ((j + 1) % segments);
            const c = (k + 1) * segments + j;
            const d = (k + 1) * segments + ((j + 1) % segments);
            index.push(a, c, b, b, c, d);
        }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const normals = geo.getAttribute('normal') as THREE.BufferAttribute;
    rows.forEach((row, k) => {
        if (row.pole === 0) return;
        for (let j = 0; j < segments; j++) normals.setXYZ(k * segments + j, 0, row.pole, 0);
    });
    return geo;
}

/**
 * Like `revolve`, but with `sides` flat facets around the axis (an octagonal
 * relic rather than a round one): each facet is its own strip, so normals are
 * smooth along the profile but crisp at every facet edge. `phase` turns the
 * facets about the axis.
 */
export function facetedRevolve(profile: readonly ProfilePoint[], sides: number, phase = 0): THREE.BufferGeometry {
    type Row = { r: number; y: number; connect: boolean };
    const rows: Row[] = [];
    profile.forEach((p, i) => {
        const sharp = p.length === 3 && i > 0 && i < profile.length - 1;
        if (sharp) rows.push({ r: p[0], y: p[1], connect: false });
        rows.push({ r: p[0], y: p[1], connect: i < profile.length - 1 });
    });
    const strips: THREE.BufferGeometry[] = [];
    for (let s = 0; s < sides; s++) {
        const a0 = phase + (s / sides) * Math.PI * 2;
        const a1 = phase + ((s + 1) / sides) * Math.PI * 2;
        const positions: number[] = [];
        for (const row of rows) positions.push(row.r * Math.sin(a0), row.y, row.r * Math.cos(a0), row.r * Math.sin(a1), row.y, row.r * Math.cos(a1));
        const index: number[] = [];
        rows.forEach((row, k) => {
            if (!row.connect || k === rows.length - 1) return;
            const a = k * 2;
            const b = k * 2 + 1;
            const c = (k + 1) * 2;
            const d = (k + 1) * 2 + 1;
            index.push(a, c, b, b, c, d);
        });
        const strip = new THREE.BufferGeometry();
        strip.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        strip.setIndex(index);
        strip.computeVertexNormals();
        strips.push(strip);
    }
    return merge(strips);
}

/**
 * A square-sectioned, flat-shaded solid from a stepped profile of
 * [half-width, height] points (top to bottom), for plinths with crisp
 * chamfers. `depth` scales the z half-width relative to x.
 */
export function squareProfile(profile: readonly (readonly [number, number])[], depth = 1): THREE.BufferGeometry {
    // Four lathe segments make a diamond whose corner radius is √2 × half-width;
    // turning it 45° squares it up with the axes.
    const indexed = revolve(
        profile.map(([w, y]) => [w * Math.SQRT2, y] as const),
        4,
    );
    const geo = indexed.toNonIndexed();
    indexed.dispose();
    geo.rotateY(Math.PI / 4);
    geo.scale(1, 1, depth);
    geo.computeVertexNormals();
    return geo;
}

/**
 * A tube along `curve` whose radius varies along its length (0 → 1), with
 * the ends closed. Used for curls, tails, wraps and fingers.
 */
export function taperedTube(
    curve: THREE.Curve<THREE.Vector3>,
    lengthSegments: number,
    radialSegments: number,
    radius: (t: number) => number,
    squash = 1,
): THREE.BufferGeometry {
    const frames = curve.computeFrenetFrames(lengthSegments, false);
    const positions: number[] = [];
    const index: number[] = [];
    const p = new THREE.Vector3();
    for (let i = 0; i <= lengthSegments; i++) {
        const t = i / lengthSegments;
        curve.getPointAt(t, p);
        const n = frames.normals[i]!;
        const b = frames.binormals[i]!;
        const r = Math.max(radius(t), 1e-4);
        for (let j = 0; j < radialSegments; j++) {
            const a = (j / radialSegments) * Math.PI * 2;
            const cx = Math.cos(a) * r;
            const sy = Math.sin(a) * r * squash;
            positions.push(p.x + n.x * cx + b.x * sy, p.y + n.y * cx + b.y * sy, p.z + n.z * cx + b.z * sy);
        }
    }
    for (let i = 0; i < lengthSegments; i++) {
        for (let j = 0; j < radialSegments; j++) {
            const a = i * radialSegments + j;
            const b = i * radialSegments + ((j + 1) % radialSegments);
            const c = (i + 1) * radialSegments + j;
            const d = (i + 1) * radialSegments + ((j + 1) % radialSegments);
            index.push(a, b, c, b, d, c);
        }
    }
    // End caps: a centre vertex fanned to the end ring.
    const capStart = positions.length / 3;
    curve.getPointAt(0, p);
    positions.push(p.x, p.y, p.z);
    const capEnd = capStart + 1;
    curve.getPointAt(1, p);
    positions.push(p.x, p.y, p.z);
    const lastRing = lengthSegments * radialSegments;
    for (let j = 0; j < radialSegments; j++) {
        const j1 = (j + 1) % radialSegments;
        index.push(capStart, j1, j);
        index.push(capEnd, lastRing + j, lastRing + j1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    return geo;
}

/**
 * Outline of a thick stroke along `points` with half-width `width(t)`,
 * t ∈ [0, 1] along the stroke. Width 0 at an end gives a sharp point.
 */
export function strokeShape(points: readonly THREE.Vector2[], width: (t: number) => number): THREE.Shape {
    const left: THREE.Vector2[] = [];
    const right: THREE.Vector2[] = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const prev = points[Math.max(0, i - 1)]!;
        const next = points[Math.min(n - 1, i + 1)]!;
        const tangent = next.clone().sub(prev).normalize();
        const normal = new THREE.Vector2(-tangent.y, tangent.x);
        const w = width(i / (n - 1));
        const p = points[i]!;
        left.push(p.clone().addScaledVector(normal, w));
        right.push(p.clone().addScaledVector(normal, -w));
    }
    const outline = [...left, ...right.reverse()];
    // Drop coincident points where the width is zero at the ends.
    const clean = outline.filter((p, i) => i === 0 || p.distanceTo(outline[i - 1]!) > 1e-5);
    return new THREE.Shape(clean);
}

/** Samples a smooth 2D curve through `points` into `count` evenly spaced points. */
export function spline2(points: readonly [number, number][], count: number): THREE.Vector2[] {
    const curve = new THREE.SplineCurve(points.map(([x, y]) => new THREE.Vector2(x, y)));
    return curve.getSpacedPoints(count - 1);
}

export interface ExtrudeOptions {
    depth: number;
    bevel: number;
    bevelSegments?: number;
    curveSegments?: number;
}

/**
 * Extrudes shapes into a beveled slab centred on z = 0 (front face at
 * +depth/2 + bevel). Bevels catch the light and make thin gold read as cast metal.
 */
export function extrude(shapes: THREE.Shape | THREE.Shape[], o: ExtrudeOptions): THREE.BufferGeometry {
    const geo = new THREE.ExtrudeGeometry(shapes, {
        depth: o.depth,
        bevelEnabled: o.bevel > 0,
        bevelThickness: o.bevel,
        bevelSize: o.bevel,
        bevelSegments: o.bevelSegments ?? 2,
        curveSegments: o.curveSegments ?? 12,
        steps: 1,
    });
    geo.translate(0, 0, -o.depth / 2);
    geo.clearGroups();
    return geo;
}

/** Applies translate / rotate (Euler, radians) / scale to a geometry in place. */
export function place(
    geo: THREE.BufferGeometry,
    position: readonly [number, number, number] = [0, 0, 0],
    rotation: readonly [number, number, number] = [0, 0, 0],
    scale: number | readonly [number, number, number] = 1,
): THREE.BufferGeometry {
    const s = typeof scale === 'number' ? [scale, scale, scale] : scale;
    const m = new THREE.Matrix4().compose(
        new THREE.Vector3(...position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
        new THREE.Vector3(s[0], s[1], s[2]),
    );
    geo.applyMatrix4(m);
    return geo;
}

/**
 * Merges geometries into one draw call. Mixed indexed/non-indexed inputs are
 * de-indexed, and only attributes every input has are kept.
 */
export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const names = ['position', 'normal', 'uv', 'color'].filter((name) => geos.every((g) => g.hasAttribute(name)));
    const mixed = geos.some((g) => g.index) && geos.some((g) => !g.index);
    const prepared = geos.map((g) => {
        let h = mixed && g.index ? g.toNonIndexed() : g;
        if (h === g) h = g.clone();
        for (const name of Object.keys(h.attributes)) if (!names.includes(name)) h.deleteAttribute(name);
        h.morphAttributes = {};
        h.clearGroups();
        return h;
    });
    const merged = mergeGeometries(prepared, false);
    for (const g of [...geos, ...prepared]) g.dispose();
    if (!merged) throw new Error('merge failed');
    return merged;
}
