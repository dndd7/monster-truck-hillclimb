import Matter from 'matter-js';

const { Bodies, Vertices, Composite } = Matter;

const SEGMENT_WIDTH = 24;
const CHUNK_SEGMENTS = 20;
const CHUNK_WIDTH = SEGMENT_WIDTH * CHUNK_SEGMENTS;
const GROUND_DEPTH = 600;
const GENERATE_AHEAD = 1800;
const KEEP_BEHIND = 500;

export const BASE_GROUND_Y = 420;

interface Wave {
  freq: number;
  amp: number;
  phase: number;
}

function makeWaves(): Wave[] {
  return [
    { freq: 0.0045, amp: 55, phase: Math.random() * Math.PI * 2 },
    { freq: 0.012, amp: 22, phase: Math.random() * Math.PI * 2 },
    { freq: 0.028, amp: 10, phase: Math.random() * Math.PI * 2 },
    { freq: 0.0018, amp: 40, phase: Math.random() * Math.PI * 2 },
  ];
}

export class Terrain {
  private waves = makeWaves();
  private chunks = new Map<number, Matter.Body[]>();
  private world: Matter.World;
  private flatStart = 260;

  constructor(world: Matter.World) {
    this.world = world;
  }

  heightAt(x: number): number {
    if (x < this.flatStart) return BASE_GROUND_Y;
    const t = x - this.flatStart;
    const difficulty = Math.min(1, t / 7000);
    let y = BASE_GROUND_Y;
    for (const w of this.waves) {
      y += Math.sin(t * w.freq + w.phase) * w.amp * (0.35 + 0.65 * difficulty);
    }
    return y;
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
}
