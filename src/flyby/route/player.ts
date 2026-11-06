// Plays a camera route over time: where the camera is and where it looks at
// any moment, and how it turns towards that, smoothly.

import * as THREE from 'three';
import type { RouteData } from '../prepare';

/** Plays one route: where the camera is and where it looks, over time. */
export interface RoutePlayer {
    duration: number;
    /** How quickly the camera turns to where the route looks, per second. */
    turnRate: number;
    sample(time: number, position: THREE.Vector3, target: THREE.Vector3): { fov: number | null; roll: number };
}

/** The pace of made-up routes, in squares a second. */
export const BASE_SPEED = 1.15;
/** Generated routes look at where they will be this far ahead, in squares, averaged. */
const LOOK_AHEAD = [1.2, 2.2, 3.2, 4.2];
/** Some flybys bank hard; a background should not. */
const MAX_ROLL = 0.2;
const GAME_FPS = 30;
const SPLINE_ONE = 65536;

function vectors(data: number[]): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i + 2 < data.length; i += 3) out.push(new THREE.Vector3(data[i], data[i + 1], data[i + 2]));
    return out;
}

/**
 * How fast to fly along a path at each step of it: as fast as `speed`, but
 * easing off through bends so the camera never swings round, and gaining or
 * losing speed gently. Returns the time at which each step is reached.
 */
export function pace(samples: THREE.Vector3[], step: number, speed: number): number[] {
    const n = samples.length;
    const reach = Math.max(1, Math.round(BEND_REACH / step));
    const limit: number[] = [];
    const before = new THREE.Vector3();
    const after = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
        const a = samples[Math.max(i - reach, 0)]!;
        const b = samples[i]!;
        const c = samples[Math.min(i + reach, n - 1)]!;
        before.subVectors(b, a);
        after.subVectors(c, b);
        const bend = before.lengthSq() > 0 && after.lengthSq() > 0 ? before.angleTo(after) / ((before.length() + after.length()) / 2) : 0;
        limit.push(bend > 0 ? Math.min(speed, Math.sqrt(MAX_SIDEWAYS / bend), MAX_TURN / bend) : speed);
    }
    // Speed may change only so fast, either way.
    const v = [...limit];
    for (let i = 1; i < n; i++) v[i] = Math.min(v[i]!, Math.sqrt(v[i - 1]! ** 2 + 2 * MAX_SPEED_CHANGE * step));
    for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i]!, Math.sqrt(v[i + 1]! ** 2 + 2 * MAX_SPEED_CHANGE * step));
    // And the change itself eases in and out.
    const window = Math.max(1, Math.round(0.6 / step));
    const smooth = v.map((_, i) => {
        let sum = 0;
        let count = 0;
        for (let k = Math.max(0, i - window); k <= Math.min(n - 1, i + window); k++) {
            sum += v[k]!;
            count++;
        }
        return Math.min(sum / count, v[i]! * 1.15);
    });
    const times = [0];
    for (let i = 1; i < n; i++) times.push(times[i - 1]! + step / Math.max((smooth[i - 1]! + smooth[i]!) / 2, 0.05));
    return times;
}

/** Bends are measured over this much path either side, in squares. */
const BEND_REACH = 0.5;
/** Squares a second², sideways, through a bend. */
const MAX_SIDEWAYS = 0.45;
/** Radians a second the path may turn. */
const MAX_TURN = 0.45;
/** Squares a second², faster or slower. */
const MAX_SPEED_CHANGE = 0.3;
/** Paths are paced in steps this long, in squares. */
const PACE_STEP = 0.05;

function generatedPlayer(route: RouteData, speed: number): RoutePlayer {
    const points = vectors(route.points);
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    // Enough steps that measuring along the curve keeps the pace even.
    curve.arcLengthDivisions = Math.max(200, points.length * 12);
    const length = curve.getLength();
    const steps = Math.max(2, Math.ceil(length / PACE_STEP));
    const step = length / steps;
    const samples: THREE.Vector3[] = [];
    for (let i = 0; i <= steps; i++) samples.push(curve.getPointAt(i / steps));
    const times = pace(samples, step, speed);
    const duration = Math.max(times[times.length - 1]!, 6);
    const end = curve.getPointAt(1);
    const endTangent = curve.getTangentAt(1);
    const ahead = new THREE.Vector3();
    const at = (distance: number, out: THREE.Vector3) => {
        if (distance <= length) return curve.getPointAt(Math.max(distance, 0) / length, out);
        // Past the end, carry on the way the route was heading.
        return out.copy(end).addScaledVector(endTangent, distance - length);
    };
    const distanceAt = (time: number) => {
        if (time >= times[times.length - 1]!) return length;
        let low = 0;
        let high = times.length - 1;
        while (high - low > 1) {
            const middle = (low + high) >> 1;
            if (times[middle]! <= time) low = middle;
            else high = middle;
        }
        const span = times[high]! - times[low]!;
        return (low + (span > 0 ? (time - times[low]!) / span : 0)) * step;
    };
    return {
        duration,
        turnRate: 2.2,
        sample(time, position, target) {
            const distance = distanceAt(Math.max(time, 0));
            at(distance, position);
            target.set(0, 0, 0);
            for (const step of LOOK_AHEAD) target.add(at(distance + step, ahead));
            target.divideScalar(LOOK_AHEAD.length);
            target.y -= 0.12; // a touch downward, to take in the floor
            return { fov: null, roll: 0 };
        },
    };
}

/** Speed near a rest, by the share of the leg left to it: full beyond 40%, easing to a crawl. */
function easeOf(remaining: number): number {
    const x = Math.min(Math.max(remaining / 0.4, 0), 1);
    return 0.12 + 0.88 * x * x * (3 - 2 * x);
}

/** The game's spline: Catmull-Rom through four knots, t from 0 to 1 between the middle two. */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
    return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
}

/**
 * TR4's flyby cameras, timed as the game times them: each leg between two
 * cameras runs from 0 to 65536, advancing each frame (30 a second) by the
 * cameras' speed, itself eased along the spline; cameras that hold make the
 * camera rest there.
 */
function scriptedPlayer(route: RouteData, speed: number): RoutePlayer {
    const points = vectors(route.points);
    const targets = vectors(route.targets ?? route.points);
    const count = points.length;
    const legs = count - 1;
    const speeds = route.speeds ?? points.map(() => 655);
    const holds = route.holds ?? points.map(() => 0);
    const knot = (leg: number, slot: number) => Math.min(Math.max(leg - 1 + slot, 0), count - 1);
    const along = (values: readonly number[], leg: number, t: number) =>
        catmullRom(values[knot(leg, 0)]!, values[knot(leg, 1)]!, values[knot(leg, 2)]!, values[knot(leg, 3)]!, t);

    // Where along the route the camera is on each of the game's frames, as
    // leg + fraction.
    const frames = [0];
    let g = 0;
    while (g < legs && frames.length < GAME_FPS * 900) {
        const leg = Math.min(Math.floor(g), legs - 1);
        const arrival = leg + 1;
        const hold = holds[arrival] ?? 0;
        // The game stops dead at a camera that holds, and sets off again at
        // full speed; a background eases into the rest and out of it.
        const t = g - leg;
        const ease = Math.min(hold > 0 ? easeOf(1 - t) : 1, (holds[leg] ?? 0) > 0 ? easeOf(t) : 1);
        const step = (Math.max(along(speeds, leg, t), 64) / SPLINE_ONE) * ease;
        let next = g + step;
        if (next >= arrival && (hold > 0 || arrival === legs)) {
            next = arrival;
            for (let i = Math.round(hold * GAME_FPS); i > 0; i--) frames.push(arrival);
        }
        frames.push(Math.min(next, legs));
        g = next;
    }
    const pace = speed / BASE_SPEED;
    const duration = (frames.length - 1) / GAME_FPS / pace;
    const vectorAlong = (list: THREE.Vector3[], leg: number, t: number, out: THREE.Vector3) => {
        const a = list[knot(leg, 0)]!;
        const b = list[knot(leg, 1)]!;
        const c = list[knot(leg, 2)]!;
        const d = list[knot(leg, 3)]!;
        return out.set(catmullRom(a.x, b.x, c.x, d.x, t), catmullRom(a.y, b.y, c.y, d.y, t), catmullRom(a.z, b.z, c.z, d.z, t));
    };
    return {
        duration,
        turnRate: 6,
        sample(time, position, target) {
            const f = Math.min(Math.max(time * pace * GAME_FPS, 0), frames.length - 1);
            const i = Math.floor(f);
            const g = frames[i]! + ((frames[Math.min(i + 1, frames.length - 1)] ?? 0) - frames[i]!) * (f - i);
            const leg = Math.min(Math.floor(g), legs - 1);
            const t = g - leg;
            vectorAlong(points, leg, t, position);
            vectorAlong(targets, leg, t, target);
            const roll = route.roll === null ? 0 : along(route.roll, leg, t);
            return {
                fov: route.fov === null ? null : along(route.fov, leg, t),
                roll: Math.max(-MAX_ROLL, Math.min(MAX_ROLL, roll)),
            };
        },
    };
}

export function createPlayer(route: RouteData, speed: number): RoutePlayer {
    return route.kind === 'scripted' ? scriptedPlayer(route, speed) : generatedPlayer(route, speed);
}

const FORWARD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);

/** Turns the camera towards where a route looks, easing the turn. */
export class CameraAim {
    readonly quaternion = new THREE.Quaternion();
    private readonly look = new THREE.Matrix4();
    private readonly wanted = new THREE.Quaternion();
    private readonly rollQuaternion = new THREE.Quaternion();
    private started = false;

    reset(): void {
        this.started = false;
    }

    update(dt: number, position: THREE.Vector3, target: THREE.Vector3, roll: number, rate = 2.2): THREE.Quaternion {
        this.look.lookAt(position, target, UP);
        this.wanted.setFromRotationMatrix(this.look);
        if (roll !== 0) this.wanted.multiply(this.rollQuaternion.setFromAxisAngle(FORWARD, roll));
        if (!this.started) {
            this.quaternion.copy(this.wanted);
            this.started = true;
        } else {
            this.quaternion.slerp(this.wanted, 1 - Math.exp(-dt * rate));
        }
        return this.quaternion;
    }
}

/** How fast a route pans, in degrees a second: the 95th percentile and the most. */
export function panSpeed(route: RouteData): { typical: number; most: number } {
    const player = createPlayer(route, BASE_SPEED);
    const position = new THREE.Vector3();
    const target = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const previous = new THREE.Vector3();
    const speeds: number[] = [];
    const dt = 1 / GAME_FPS;
    for (let time = 0; time <= player.duration; time += dt) {
        player.sample(time, position, target);
        direction.subVectors(target, position).normalize();
        if (time > 0) speeds.push(THREE.MathUtils.radToDeg(direction.angleTo(previous)) / dt);
        previous.copy(direction);
    }
    speeds.sort((a, b) => a - b);
    return { typical: speeds[Math.floor((speeds.length - 1) * 0.95)] ?? 0, most: speeds[speeds.length - 1] ?? 0 };
}
