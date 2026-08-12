import './style.css';
import Matter from 'matter-js';
import { Terrain, BASE_GROUND_Y } from './terrain';
import { Truck, CHASSIS_WIDTH, CHASSIS_HEIGHT, WHEEL_RADIUS } from './truck';

const { Engine, Events } = Matter;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const distanceEl = document.getElementById('distance')!;
const speedEl = document.getElementById('speed')!;
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
  prevDistanceM = 0;
  displaySpeedKmh = 0;
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
let skyGradient: CanvasGradient | null = null;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewWidth = window.innerWidth;
  viewHeight = window.innerHeight;
  canvas.width = viewWidth * dpr;
  canvas.height = viewHeight * dpr;
  canvas.style.width = `${viewWidth}px`;
  canvas.style.height = `${viewHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  skyGradient = ctx.createLinearGradient(0, 0, 0, viewHeight);
  skyGradient.addColorStop(0, '#4fa8dd');
  skyGradient.addColorStop(1, '#bfe6ff');
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
window.visualViewport?.addEventListener('resize', resize);
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
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
  ctx.fillStyle = skyGradient!;
  ctx.fillRect(0, 0, viewWidth, viewHeight);
}

let terrainPoints: Matter.Vector[] = [];

function drawTerrain() {
  const startX = camera.x - 40;
  const endX = camera.x + viewWidth + 40;
  const step = 14;

  let count = 0;
  for (let x = startX; x <= endX; x += step, count++) {
    const p = terrainPoints[count] ?? (terrainPoints[count] = { x: 0, y: 0 });
    p.x = x;
    p.y = terrain.heightAt(x);
  }
  if (terrainPoints[count - 1].x < endX) {
    const p = terrainPoints[count] ?? (terrainPoints[count] = { x: 0, y: 0 });
    p.x = endX;
    p.y = terrain.heightAt(endX);
    count++;
  }
  terrainPoints.length = count;
  const points = terrainPoints;

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

const TREAD_COUNT = 12;

function drawWheel(body: Matter.Body) {
  const r = WHEEL_RADIUS;
  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);

  // tire body
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1a1c';
  ctx.fill();

  // chunky knobby tread lugs around the outer edge
  ctx.fillStyle = '#0c0c0d';
  for (let i = 0; i < TREAD_COUNT; i++) {
    const a = (i / TREAD_COUNT) * Math.PI * 2;
    ctx.save();
    ctx.rotate(a);
    ctx.fillRect(r * 0.8, -r * 0.16, r * 0.24, r * 0.32);
    ctx.restore();
  }

  // sidewall
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.74, 0, Math.PI * 2);
  ctx.fillStyle = '#26262a';
  ctx.fill();

  // metallic rim
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = '#b9bdc6';
  ctx.fill();

  ctx.strokeStyle = '#7d818a';
  ctx.lineWidth = r * 0.09;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r * 0.38, Math.sin(a) * r * 0.38);
    ctx.stroke();
  }

  // hub cap
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.13, 0, Math.PI * 2);
  ctx.fillStyle = '#4a4d54';
  ctx.fill();

  ctx.restore();
}

function drawChassis() {
  const body = truck.chassis;
  const w = CHASSIS_WIDTH;
  const h = CHASSIS_HEIGHT;

  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);

  // main body
  ctx.fillStyle = '#d8402c';
  roundRectPath(-w / 2, -h / 2, w, h, 9);
  ctx.fill();

  // racing stripe
  ctx.fillStyle = '#f2a13a';
  ctx.fillRect(-w / 2, -h * 0.18, w, h * 0.22);

  // front/rear bumpers
  ctx.fillStyle = '#2b2b2e';
  ctx.fillRect(-w / 2 - 4, h * 0.1, 10, h * 0.5);
  ctx.fillRect(w / 2 - 6, h * 0.1, 10, h * 0.5);

  // front grille (left end, between the headlight and bumper)
  ctx.fillStyle = '#9aa0aa';
  ctx.fillRect(-w / 2 - 6, -h * 0.08, 12, h * 0.32);
  ctx.strokeStyle = '#3a3a3d';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) {
    const y = -h * 0.04 + i * (h * 0.08);
    ctx.beginPath();
    ctx.moveTo(-w / 2 - 6, y);
    ctx.lineTo(-w / 2 + 6, y);
    ctx.stroke();
  }

  // headlights at both ends (either can be "front")
  ctx.fillStyle = '#ffe27a';
  ctx.beginPath();
  ctx.arc(-w / 2 + 8, -h * 0.18, 4, 0, Math.PI * 2);
  ctx.arc(w / 2 - 8, -h * 0.18, 4, 0, Math.PI * 2);
  ctx.fill();

  // cab roof
  ctx.fillStyle = '#c23222';
  roundRectPath(-w * 0.24, -h * 1.7, w * 0.48, h * 0.3, 4);
  ctx.fill();

  // angled windshield
  ctx.fillStyle = '#a9dcf5';
  ctx.beginPath();
  ctx.moveTo(-w * 0.19, -h * 1.4);
  ctx.lineTo(w * 0.19, -h * 1.4);
  ctx.lineTo(w * 0.15, -h * 0.55);
  ctx.lineTo(-w * 0.15, -h * 0.55);
  ctx.closePath();
  ctx.fill();

  // exhaust stack
  ctx.fillStyle = '#4a4d54';
  ctx.fillRect(w * 0.32, -h * 1.9, 6, h * 1.4);

  // roll cage, framing outside the cab so it stays visible over the roof
  ctx.strokeStyle = '#3a3a3d';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-w * 0.29, -h * 0.4);
  ctx.lineTo(-w * 0.29, -h * 1.85);
  ctx.lineTo(w * 0.29, -h * 1.85);
  ctx.lineTo(w * 0.29, -h * 0.4);
  ctx.stroke();

  ctx.restore();
}

function roundRectPath(x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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

let prevDistanceM = 0;
let displaySpeedKmh = 0;

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

  if (frameDt > 0) {
    const instantKmh = ((distanceM - prevDistanceM) / (frameDt / 1000)) * 3.6;
    displaySpeedKmh += (instantKmh - displaySpeedKmh) * 0.15;
  }
  prevDistanceM = distanceM;
  speedEl.textContent = `${Math.max(0, Math.round(displaySpeedKmh))} km/h`;

  requestAnimationFrame(tick);
}

terrain.update(truck.position.x);
requestAnimationFrame(tick);
