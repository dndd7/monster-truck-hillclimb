import Matter from 'matter-js';

const { Bodies, Vertices, Composite } = Matter;

const SEGMENT_WIDTH = 24;
const CHUNK_SEGMENTS = 20;
const CHUNK_WIDTH = SEGMENT_WIDTH * CHUNK_SEGMENTS;
const GROUND_DEPTH = 600;
const GENERATE_AHEAD = 1800;
const KEEP_BEHIND = 500;
const FLAT_START = 260;

export const BASE_GROUND_Y = 420;

interface WaveConfig {
  freq: number;
  amp: number;
}

export interface TerrainProfile {
  name: string;
  description: string;
  waves: WaveConfig[];
  /** Distance in px over which terrain roughness ramps from 35% to 100%. */
  difficultyDistance: number;
  /** Distance in px between launch-ramp features; null disables them. */
  jumpSpacing: number | null;
  jumpHeight: number;
  jumpWidth: number;
  jumpDropDepth: number;
}

export const TERRAIN_PROFILES: Record<string, TerrainProfile> = {
  plains: {
    name: 'Plains',
    description: 'Gentle rolling hills. No jumps.',
    waves: [
      { freq: 0.0045, amp: 28 },
      { freq: 0.012, amp: 12 },
      { freq: 0.028, amp: 6 },
      { freq: 0.0018, amp: 20 },
    ],
    difficultyDistance: 12000,
    jumpSpacing: null,
    jumpHeight: 0,
    jumpWidth: 0,
    jumpDropDepth: 0,
  },
  hills: {
    name: 'Hills',
    description: 'Steeper terrain, occasional jumps.',
    waves: [
      { freq: 0.0045, amp: 55 },
      { freq: 0.012, amp: 22 },
      { freq: 0.028, amp: 10 },
      { freq: 0.0018, amp: 40 },
    ],
    difficultyDistance: 7000,
    jumpSpacing: 3400,
    jumpHeight: 48,
    jumpWidth: 620,
    jumpDropDepth: 60,
  },
  offroad: {
    name: 'Offroad',
    description: 'Rough and steep, frequent launch ramps.',
    waves: [
      { freq: 0.005, amp: 65 },
      { freq: 0.014, amp: 28 },
      { freq: 0.03, amp: 14 },
      { freq: 0.002, amp: 50 },
    ],
    difficultyDistance: 6500,
    jumpSpacing: 2000,
    jumpHeight: 62,
    jumpWidth: 750,
    jumpDropDepth: 85,
  },
};

/** Base-terrain slope (ignoring any ramp) above which a candidate jump site is skipped. */
const MAX_BASE_SLOPE_FOR_JUMP = 0.4;

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

interface Wave extends WaveConfig {
  phase: number;
}

export class Terrain {
  private waves: Wave[];
  private profile: TerrainProfile;
  private chunks = new Map<number, Matter.Body[]>();
  private world: Matter.World;
  private flatStart = FLAT_START;

  constructor(world: Matter.World, profile: TerrainProfile) {
    this.world = world;
    this.profile = profile;
    this.waves = profile.waves.map((w) => ({ ...w, phase: Math.random() * Math.PI * 2 }));
  }

  heightAt(x: number): number {
    if (x < this.flatStart) return BASE_GROUND_Y;
    return this.baseHeightAt(x) + this.jumpDeltaAt(x);
  }

  /** The rolling terrain height with no jump-ramp features applied. */
  private baseHeightAt(x: number): number {
    if (x < this.flatStart) return BASE_GROUND_Y;
    const t = x - this.flatStart;
    const difficulty = Math.min(1, t / this.profile.difficultyDistance);
    let y = BASE_GROUND_Y;
    for (const w of this.waves) {
      y += Math.sin(t * w.freq + w.phase) * w.amp * (0.35 + 0.65 * difficulty);
    }
    return y;
  }

  /**
   * Launch-ramp features: a smooth ramp up (y *decreases*, screen coordinates
   * are down-positive), a short flat lip, a steep drop into a gap, then a
   * gradual climb back out to the base terrain. Approached forward this
   * rides like a ramp into a dip; at speed it launches the truck into real
   * air time. Feature positions are derived from `x` alone (no incremental
   * state) so `heightAt` stays a pure function callable at any x, in any
   * order — chunks ahead of and behind the truck both work.
   */
  private jumpDeltaAt(x: number): number {
    const { jumpSpacing, jumpHeight, jumpWidth, jumpDropDepth } = this.profile;
    if (!jumpSpacing) return 0;

    const halfWidth = jumpWidth / 2;
    const firstCenter = this.flatStart + jumpSpacing;
    const index = Math.max(0, Math.round((x - firstCenter) / jumpSpacing));
    const centerX = firstCenter + index * jumpSpacing;
    if (x < centerX - halfWidth || x > centerX + halfWidth) return 0;

    const featureLeft = centerX - halfWidth;
    if (!this.isSafeJumpSite(featureLeft, jumpWidth)) return 0;

    const t = (x - featureLeft) / jumpWidth;
    if (t < 0.3) return -jumpHeight * smoothstep(t / 0.3);
    if (t < 0.42) return -jumpHeight;
    if (t < 0.6) return -jumpHeight + (jumpDropDepth + jumpHeight) * smoothstep((t - 0.42) / 0.18);
    return jumpDropDepth - jumpDropDepth * smoothstep((t - 0.6) / 0.4);
  }

  /**
   * Reject a jump site if the *base* terrain alone is already climbing or
   * descending too steeply across the ramp's rise or return span — otherwise
   * the ramp's own slope stacks with the base terrain's and can produce an
   * unclimbable wall. The feature is simply skipped for that cycle rather
   * than forced onto unsuitable ground.
   */
  private isSafeJumpSite(featureLeft: number, jumpWidth: number): boolean {
    const riseSlope =
      Math.abs(this.baseHeightAt(featureLeft + 0.3 * jumpWidth) - this.baseHeightAt(featureLeft)) /
      (0.3 * jumpWidth);
    const returnSlope =
      Math.abs(this.baseHeightAt(featureLeft + jumpWidth) - this.baseHeightAt(featureLeft + 0.6 * jumpWidth)) /
      (0.4 * jumpWidth);
    return riseSlope <= MAX_BASE_SLOPE_FOR_JUMP && returnSlope <= MAX_BASE_SLOPE_FOR_JUMP;
  }

  /**
   * Each segment is built as its own convex quad (two top points plus two points
   * straight down at a fixed depth). A chunk's full top edge is wavy and therefore
   * concave overall, but per-segment quads stay convex so Matter never needs
   * poly-decomp to triangulate them (and never silently falls back to a convex
   * hull, which would smear over dips in the terrain).
   */
  private buildChunk(index: number): Matter.Body[] {
    const startX = index * CHUNK_WIDTH;
    const bodies: Matter.Body[] = [];

    for (let i = 0; i < CHUNK_SEGMENTS; i++) {
      const xA = startX + i * SEGMENT_WIDTH;
      const xB = xA + SEGMENT_WIDTH;
      const yA = this.heightAt(xA);
      const yB = this.heightAt(xB);
      const bottomY = Math.max(yA, yB) + GROUND_DEPTH;

      const vertices: Matter.Vector[] = [
        { x: xA, y: yA },
        { x: xB, y: yB },
        { x: xB, y: bottomY },
        { x: xA, y: bottomY },
      ];
      const centre = Vertices.centre(vertices);
      bodies.push(
        Bodies.fromVertices(centre.x, centre.y, [vertices], {
          isStatic: true,
          friction: 1,
          frictionStatic: 1,
          label: 'ground',
        }),
      );
    }

    return bodies;
  }

  /** Ensure ground chunks exist for the range visible around `centerX`. */
  update(centerX: number) {
    const minIndex = Math.floor((centerX - KEEP_BEHIND) / CHUNK_WIDTH);
    const maxIndex = Math.ceil((centerX + GENERATE_AHEAD) / CHUNK_WIDTH);

    for (let index = minIndex; index <= maxIndex; index++) {
      if (!this.chunks.has(index)) {
        const body = this.buildChunk(index);
        this.chunks.set(index, body);
        Composite.add(this.world, body);
      }
    }

    for (const [index, body] of this.chunks) {
      if (index < minIndex || index > maxIndex) {
        Composite.remove(this.world, body);
        this.chunks.delete(index);
      }
    }
  }

  /** Remove every chunk this instance added to the world (before swapping profiles). */
  clear() {
    for (const bodies of this.chunks.values()) {
      Composite.remove(this.world, bodies);
    }
    this.chunks.clear();
  }
}
