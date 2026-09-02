import Matter from 'matter-js';

const { Bodies, Body, Composite, Constraint } = Matter;

const CHASSIS_WIDTH = 136;
const CHASSIS_HEIGHT = 34;
const WHEEL_RADIUS = 38;
const WHEEL_OFFSET_X = CHASSIS_WIDTH * 0.36;
const WHEEL_OFFSET_Y = CHASSIS_HEIGHT * 0.55 + WHEEL_RADIUS * 0.55;
const MAX_WHEEL_SPEED = 22;
const MOTOR_TORQUE = 0.32;
const MAX_AIR_TILT_SPEED = 3.5;
const AIR_TILT_TORQUE = 0.02;

// NOS boosts climbing torque only, not top speed — so once it runs out there's
// no lingering extra speed to coast on, and it settles back to normal quickly.
const NOS_TORQUE_BOOST = 0.3;
const NOS_DEPLETE_PER_MS = 1 / 2200;
const NOS_REFILL_PER_MS = 1 / 24000;

export class Truck {
  readonly chassis: Matter.Body;
  readonly wheelRear: Matter.Body;
  readonly wheelFront: Matter.Body;
  private readonly constraintRear: Matter.Constraint;
  private readonly constraintFront: Matter.Constraint;
  private readonly spawnX: number;
  private readonly spawnY: number;
  private nosFuel = 1;
  private nosActive = false;
  private nosLockedOut = false;

  constructor(world: Matter.World, x: number, y: number) {
    this.spawnX = x;
    this.spawnY = y;

    const group = Body.nextGroup(true);

    this.chassis = Bodies.rectangle(x, y, CHASSIS_WIDTH, CHASSIS_HEIGHT, {
      density: 0.0018,
      friction: 0.4,
      frictionAir: 0.018,
      chamfer: { radius: 8 },
      collisionFilter: { group },
      label: 'chassis',
    });

    const wheelOptions = {
      density: 0.0022,
      friction: 1.2,
      frictionAir: 0.012,
      restitution: 0.05,
      collisionFilter: { group },
      label: 'wheel',
    };

    const restY = y + WHEEL_OFFSET_Y;
    this.wheelRear = Bodies.circle(x - WHEEL_OFFSET_X, restY, WHEEL_RADIUS, wheelOptions);
    this.wheelFront = Bodies.circle(x + WHEEL_OFFSET_X, restY, WHEEL_RADIUS, wheelOptions);

    const suspension = { stiffness: 0.45, damping: 0.07, length: 0 };

    this.constraintRear = Constraint.create({
      bodyA: this.chassis,
      pointA: { x: -WHEEL_OFFSET_X, y: WHEEL_OFFSET_Y },
      bodyB: this.wheelRear,
      ...suspension,
    });

    this.constraintFront = Constraint.create({
      bodyA: this.chassis,
      pointA: { x: WHEEL_OFFSET_X, y: WHEEL_OFFSET_Y },
      bodyB: this.wheelFront,
      ...suspension,
    });

    Composite.add(world, [
      this.chassis,
      this.wheelRear,
      this.wheelFront,
      this.constraintRear,
      this.constraintFront,
    ]);
  }

  /** Drive the wheels (4WD) via bounded motor torque, or tilt the chassis in mid-air. */
  applyInput(direction: -1 | 0 | 1, airborne: boolean, nosRequested: boolean, dtMs: number) {
    if (!nosRequested) this.nosLockedOut = false;
    this.nosActive = nosRequested && !this.nosLockedOut && this.nosFuel > 0;
    if (this.nosActive) {
      this.nosFuel = Math.max(0, this.nosFuel - NOS_DEPLETE_PER_MS * dtMs);
      if (this.nosFuel === 0) this.nosLockedOut = true;
    } else {
      this.nosFuel = Math.min(1, this.nosFuel + NOS_REFILL_PER_MS * dtMs);
    }

    const torque = MOTOR_TORQUE + (this.nosActive ? NOS_TORQUE_BOOST : 0);

    if (direction !== 0) {
      for (const wheel of [this.wheelRear, this.wheelFront]) {
        const governor = Math.max(0, 1 - Math.abs(wheel.angularVelocity) / MAX_WHEEL_SPEED);
        wheel.torque += direction * torque * governor;
      }
    }

    if (airborne && direction !== 0) {
      const governor = Math.max(0, 1 - Math.abs(this.chassis.angularVelocity) / MAX_AIR_TILT_SPEED);
      this.chassis.torque += direction * AIR_TILT_TORQUE * governor;
    }
  }

  get position() {
    return this.chassis.position;
  }

  get angle() {
    return this.chassis.angle;
  }

  /** NOS fuel remaining, 0 to 1. */
  get nosFuelLevel() {
    return this.nosFuel;
  }

  get isNosActive() {
    return this.nosActive;
  }

  reset() {
    for (const body of [this.chassis, this.wheelRear, this.wheelFront]) {
      Body.setVelocity(body, { x: 0, y: 0 });
      Body.setAngularVelocity(body, 0);
    }
    Body.setAngle(this.chassis, 0);
    Body.setPosition(this.chassis, { x: this.spawnX, y: this.spawnY });
    const restY = this.spawnY + WHEEL_OFFSET_Y;
    Body.setPosition(this.wheelRear, { x: this.spawnX - WHEEL_OFFSET_X, y: restY });
    Body.setPosition(this.wheelFront, { x: this.spawnX + WHEEL_OFFSET_X, y: restY });
    this.nosFuel = 1;
    this.nosActive = false;
    this.nosLockedOut = false;
  }
}

export { CHASSIS_WIDTH, CHASSIS_HEIGHT, WHEEL_RADIUS, WHEEL_OFFSET_X, WHEEL_OFFSET_Y };
