import './style.css';
import Matter from 'matter-js';
import { Terrain, BASE_GROUND_Y } from './terrain';
import { Truck, CHASSIS_WIDTH, WHEEL_RADIUS } from './truck';

const { Engine, Events } = Matter;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const distanceEl = document.getElementById('distance')!;
const resetButton = document.getElementById('reset')!;
const overlay = document.getElementById('overlay')!;
const overlayText = document.getElementById('overlay-text')!;
const overlayRetry = document.getElementById('overlay-retry')!;
const btnGas = document.getElementById('btn-gas')!;
const btnReverse = document.getElementById('btn-reverse')!;

const PIXELS_PER_METER = 30;
const SPAWN_X = 100;
const FLIP_ANGLE = 2.15;
const CRASH_HOLD_MS = 700;
const FALL_KILL_DISTANCE = 500;

const engine = Engine.create();
engine.gravity.y = 1;

const terrain = new Terrain(engine.world);
const truck = new Truck(engine.world, SPAWN_X, BASE_GROUND_Y - 90);

let bestDistanceM = 0;
let crashed = false;
let crashTimerMs = 0;

// --- contact tracking (airborne detection) ---
let rearContacts = 0;
let frontContacts = 0;

function isWheelGroundPair(bodyA: Matter.Body, bodyB: Matter.Body) {
  const labels = [bodyA.label, bodyB.label];
  return labels.includes('wheel') && labels.includes('ground');
}

function wheelOf(bodyA: Matter.Body, bodyB: Matter.Body) {
  return bodyA.label === 'wheel' ? bodyA : bodyB;
}

Events.on(engine, 'collisionStart', (event) => {
  for (const pair of event.pairs) {
    if (!isWheelGroundPair(pair.bodyA, pair.bodyB)) continue;
    const wheel = wheelOf(pair.bodyA, pair.bodyB);
    if (wheel === truck.wheelRear) rearContacts++;
    else if (wheel === truck.wheelFront) frontContacts++;
  }
});

Events.on(engine, 'collisionEnd', (event) => {
  for (const pair of event.pairs) {
    if (!isWheelGroundPair(pair.bodyA, pair.bodyB)) continue;
    const wheel = wheelOf(pair.bodyA, pair.bodyB);
    if (wheel === truck.wheelRear) rearContacts = Math.max(0, rearContacts - 1);
    else if (wheel === truck.wheelFront) frontContacts = Math.max(0, frontContacts - 1);
  }
});

// --- input ---
let inputDirection: -1 | 0 | 1 = 0;
let rightHeld = false;
let leftHeld = false;
let facing: 1 | -1 = 1;

function updateDirection() {
  inputDirection = rightHeld === leftHeld ? 0 : rightHeld ? 1 : -1;
  if (inputDirection !== 0) facing = inputDirection;
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.key === 'ArrowRight') {
    rightHeld = true;
    updateDirection();
  } else if (e.key === 'ArrowLeft') {
    leftHeld = true;
    updateDirection();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowRight') {
    rightHeld = false;
    updateDirection();
  } else if (e.key === 'ArrowLeft') {
    leftHeld = false;
    updateDirection();
  }
});

function bindHoldButton(el: Element, onDown: () => void, onUp: () => void) {
  const down = (e: Event) => {
    e.preventDefault();
    el.classList.add('active');
    onDown();
  };
  const up = (e: Event) => {
    e.preventDefault();
    el.classList.remove('active');
    onUp();
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointerleave', up);
  el.addEventListener('pointercancel', up);
}

bindHoldButton(
  btnGas,
  () => {
    rightHeld = true;
    updateDirection();
  },
  () => {
    rightHeld = false;
    updateDirection();
  },
);

bindHoldButton(
  btnReverse,
  () => {
    leftHeld = true;
    updateDirection();
  },
  () => {
    leftHeld = false;
    updateDirection();
  },
);

function resetRun() {
  crashed = false;
  crashTimerMs = 0;
  rearContacts = 0;
  frontContacts = 0;
  truck.reset();
  overlay.classList.add('hidden');
}

resetButton.addEventListener('click', resetRun);
overlayRetry.addEventListener('click', resetRun);

function triggerCrash() {
  if (crashed) return;
  crashed = true;
  const distanceM = Math.max(0, (truck.position.x - SPAWN_X) / PIXELS_PER_METER);
  bestDistanceM = Math.max(bestDistanceM, distanceM);
  overlayText.textContent = `Crashed! Distance: ${Math.round(distanceM)} m (best ${Math.round(bestDistanceM)} m)`;
  overlay.classList.remove('hidden');
}

// --- canvas sizing ---
let viewWidth = 0;
let viewHeight = 0;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewWidth = window.innerWidth;
  viewHeight = window.innerHeight;
  canvas.width = viewWidth * dpr;
  canvas.height = viewHeight * dpr;
  canvas.style.width = `${viewWidth}px`;
  canvas.style.height = `${viewHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', resize);
resize();

// --- camera ---
const camera = { x: 0, y: 0 };

function updateCamera() {
  const targetX = truck.position.x - viewWidth / 2 + facing * 90;
  const targetY = truck.position.y - viewHeight * 0.58;
  camera.x += (targetX - camera.x) * 0.08;
  camera.y += (targetY - camera.y) * 0.08;
}

// --- rendering ---
function drawSky() {
  const gradient = ctx.createLinearGradient(0, 0, 0, viewHeight);
  gradient.addColorStop(0, '#4fa8dd');
  gradient.addColorStop(1, '#bfe6ff');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, viewWidth, viewHeight);
}

function drawTerrain() {
  const startX = camera.x - 40;
  const endX = camera.x + viewWidth + 40;
  const step = 14;

  const points: Matter.Vector[] = [];
  for (let x = startX; x <= endX; x += step) {
    points.push({ x, y: terrain.heightAt(x) });
  }
  if (points[points.length - 1].x < endX) {
    points.push({ x: endX, y: terrain.heightAt(endX) });
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const p of points) ctx.lineTo(p.x, p.y);
  const bottom = camera.y + viewHeight + 80;
  ctx.lineTo(endX, bottom);
  ctx.lineTo(startX, bottom);
  ctx.closePath();

  const dirtGradient = ctx.createLinearGradient(0, camera.y, 0, bottom);
  dirtGradient.addColorStop(0, '#7a5636');
  dirtGradient.addColorStop(1, '#3d2b1c');
  ctx.fillStyle = dirtGradient;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const p of points) ctx.lineTo(p.x, p.y);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#4f9a3c';
  ctx.stroke();
}

function drawWheel(body: Matter.Body) {
  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);
  ctx.beginPath();
  ctx.arc(0, 0, WHEEL_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = '#1b1b1f';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, WHEEL_RADIUS * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = '#8a8f9a';
  ctx.fill();
  ctx.strokeStyle = '#55595f';
  ctx.lineWidth = 4;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * WHEEL_RADIUS * 0.85, Math.sin(a) * WHEEL_RADIUS * 0.85);
    ctx.stroke();
  }
  ctx.restore();
}

function drawChassis() {
  const body = truck.chassis;
  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);

  ctx.fillStyle = '#e8543e';
  ctx.beginPath();
  const w = CHASSIS_WIDTH;
  const h = 34;
  const r = 8;
  ctx.moveTo(-w / 2 + r, -h / 2);
  ctx.arcTo(w / 2, -h / 2, w / 2, h / 2, r);
  ctx.arcTo(w / 2, h / 2, -w / 2, h / 2, r);
  ctx.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r);
  ctx.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#bfe6ff';
  ctx.fillRect(-w * 0.12, -h * 1.55, w * 0.34, h * 1.1);

  ctx.fillStyle = '#c23f2c';
  ctx.fillRect(-w * 0.16, -h * 1.6, w * 0.42, h * 0.32);

  ctx.restore();
}

function render() {
  drawSky();
  ctx.save();
  ctx.translate(-camera.x, -camera.y);
  drawTerrain();
  drawWheel(truck.wheelRear);
  drawWheel(truck.wheelFront);
  drawChassis();
  ctx.restore();
}

// --- main loop ---
const FIXED_DT = 1000 / 60;
let accumulator = 0;
let lastTime = performance.now();

function normalizeAngle(angle: number) {
  let a = angle % (Math.PI * 2);
  if (a < -Math.PI) a += Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  return a;
}

function checkCrash(dt: number) {
  const angle = Math.abs(normalizeAngle(truck.angle));
  const speed = truck.chassis.speed;
  if (angle > FLIP_ANGLE && speed < 2) {
    crashTimerMs += dt;
    if (crashTimerMs > CRASH_HOLD_MS) triggerCrash();
  } else {
    crashTimerMs = Math.max(0, crashTimerMs - dt * 2);
  }

  if (truck.position.y > terrain.heightAt(truck.position.x) + FALL_KILL_DISTANCE) {
    triggerCrash();
  }
}

function tick(now: number) {
  const frameDt = Math.min(100, now - lastTime);
  lastTime = now;
  accumulator += frameDt;

  while (accumulator >= FIXED_DT) {
    if (!crashed) {
      const airborne = rearContacts === 0 && frontContacts === 0;
      truck.applyInput(inputDirection, airborne);
      Engine.update(engine, FIXED_DT);
      checkCrash(FIXED_DT);
    }
    accumulator -= FIXED_DT;
  }

  if (!crashed) terrain.update(truck.position.x);
  updateCamera();
  render();

  const distanceM = Math.max(0, (truck.position.x - SPAWN_X) / PIXELS_PER_METER);
  distanceEl.textContent = `${Math.round(distanceM)} m`;

  requestAnimationFrame(tick);
}

terrain.update(truck.position.x);
requestAnimationFrame(tick);
