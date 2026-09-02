import './style.css';
import Matter from 'matter-js';
import { Terrain, TERRAIN_PROFILES, BASE_GROUND_Y } from './terrain';
import { Truck, CHASSIS_WIDTH, CHASSIS_HEIGHT, WHEEL_RADIUS, WHEEL_OFFSET_X, WHEEL_OFFSET_Y } from './truck';

const { Engine, Events } = Matter;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const distanceEl = document.getElementById('distance')!;
const speedEl = document.getElementById('speed')!;
const nosFillEl = document.getElementById('nos-fill')!;
const resetButton = document.getElementById('reset')!;
const modeButton = document.getElementById('mode-btn')!;
const modeSelect = document.getElementById('mode-select')!;
const modeOptions = document.querySelectorAll<HTMLButtonElement>('.mode-option');
const overlay = document.getElementById('overlay')!;
const overlayText = document.getElementById('overlay-text')!;
const overlayRetry = document.getElementById('overlay-retry')!;
const btnGas = document.getElementById('btn-gas')!;
const btnReverse = document.getElementById('btn-reverse')!;
const btnNos = document.getElementById('btn-nos')!;

const PIXELS_PER_METER = 30;
const SPAWN_X = 100;
const FLIP_ANGLE = 0.55;
const CRASH_HOLD_MS = 700;
const FALL_KILL_DISTANCE = 500;

const engine = Engine.create();
engine.gravity.y = 1;

let terrain = new Terrain(engine.world, TERRAIN_PROFILES.hills);
const truck = new Truck(engine.world, SPAWN_X, BASE_GROUND_Y - 90);

let bestDistanceM = 0;
let crashed = false;
let crashTimerMs = 0;
let started = false;

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
let nosHeld = false;
let facing: 1 | -1 = 1;

function updateDirection() {
  inputDirection = rightHeld === leftHeld ? 0 : rightHeld ? 1 : -1;
  if (inputDirection !== 0) facing = inputDirection;
}

window.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    nosHeld = true;
    return;
  }
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
  if (e.key === ' ' || e.code === 'Space') {
    nosHeld = false;
    return;
  }
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

bindHoldButton(
  btnNos,
  () => {
    nosHeld = true;
  },
  () => {
    nosHeld = false;
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

function selectMode(key: string) {
  const profile = TERRAIN_PROFILES[key];
  if (!profile) return;
  terrain.clear();
  terrain = new Terrain(engine.world, profile);
  resetRun();
  terrain.update(truck.position.x);
  started = true;
  modeSelect.classList.add('hidden');
}

modeButton.addEventListener('click', () => {
  started = false;
  modeSelect.classList.remove('hidden');
});

for (const option of modeOptions) {
  option.addEventListener('click', () => selectMode(option.dataset.mode!));
}

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

function drawCloud(cx: number, cy: number, scale: number) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, 30 * scale, 13 * scale, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + 22 * scale, cy + 3 * scale, 20 * scale, 11 * scale, 0, 0, Math.PI * 2);
  ctx.ellipse(cx - 20 * scale, cy + 4 * scale, 18 * scale, 10 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawClouds() {
  const scrollX = camera.x * 0.1;
  const spacing = 280;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  const first = Math.floor((scrollX - 100) / spacing) - 1;
  const last = Math.ceil((scrollX + viewWidth + 100) / spacing) + 1;
  for (let i = first; i <= last; i++) {
    const cx = i * spacing - scrollX;
    const cy = 60 + ((i % 3) + 3) * 18;
    drawCloud(cx, cy, 1 + ((i % 2) * 0.3));
  }
}

function drawParallaxRidge(scrollFactor: number, baseY: number, amp: number, freq: number, phase: number, color: string) {
  const scrollX = camera.x * scrollFactor;
  const step = 24;
  ctx.beginPath();
  ctx.moveTo(0, viewHeight);
  for (let x = 0; x <= viewWidth; x += step) {
    const y = baseY + Math.sin((x + scrollX) * freq + phase) * amp;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(viewWidth, baseY + Math.sin((viewWidth + scrollX) * freq + phase) * amp);
  ctx.lineTo(viewWidth, viewHeight);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawBackground() {
  drawSky();
  drawClouds();
  drawParallaxRidge(0.25, viewHeight * 0.62, viewHeight * 0.09, 0.0022, 0.6, '#9fb6d9');
  drawParallaxRidge(0.45, viewHeight * 0.72, viewHeight * 0.11, 0.0032, 2.1, '#7f9dc4');
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
  const bottom = camera.y + viewHeight * 3;
  ctx.lineTo(endX, bottom);
  ctx.lineTo(startX, bottom);
  ctx.closePath();

  // gradient depth is stretched well past the visible screen so the deep
  // "rock" tone stays a rare glimpse rather than dominating ordinary dirt
  const dirtGradient = ctx.createLinearGradient(0, camera.y, 0, bottom);
  dirtGradient.addColorStop(0, '#7a5636');
  dirtGradient.addColorStop(0.15, '#5c3f26');
  dirtGradient.addColorStop(0.35, '#4a3320');
  dirtGradient.addColorStop(0.55, '#3a2a1c');
  dirtGradient.addColorStop(1, '#1e1611');
  ctx.fillStyle = dirtGradient;
  ctx.fill();

  drawGroundSpeckles(points);

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const p of points) ctx.lineTo(p.x, p.y);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#4f9a3c';
  ctx.stroke();
}

function hash01(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function drawGroundSpeckles(points: Matter.Vector[]) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  for (let i = 0; i < points.length; i += 2) {
    const p = points[i];
    const h = hash01(Math.floor(p.x / 10));
    if (h > 0.4) continue;
    const depth = 8 + h * 55;
    const size = 3 + h * 5;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + depth, size, size * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

const TREAD_COUNT = 14;
const MUD_SPECKS = [
  { a: 0.5, d: 0.62, s: 1 },
  { a: 2.1, d: 0.7, s: 0.8 },
  { a: 3.4, d: 0.58, s: 0.9 },
  { a: 5.0, d: 0.66, s: 0.7 },
];

function drawWheel(body: Matter.Body) {
  const r = WHEEL_RADIUS;
  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);

  // tire body
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#18181a';
  ctx.fill();

  // deep, aggressive off-road tread lugs around the outer edge
  ctx.fillStyle = '#0a0a0b';
  for (let i = 0; i < TREAD_COUNT; i++) {
    const a = (i / TREAD_COUNT) * Math.PI * 2;
    ctx.save();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(r * 0.72, -r * 0.19);
    ctx.lineTo(r * 1.04, -r * 0.13);
    ctx.lineTo(r * 1.04, r * 0.13);
    ctx.lineTo(r * 0.72, r * 0.19);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // mud flecks on the tread, rotating with the wheel for movement feedback
  ctx.fillStyle = 'rgba(122, 86, 54, 0.85)';
  for (const m of MUD_SPECKS) {
    ctx.beginPath();
    ctx.ellipse(Math.cos(m.a) * r * m.d, Math.sin(m.a) * r * m.d, 3.2 * m.s, 2.2 * m.s, m.a, 0, Math.PI * 2);
    ctx.fill();
  }

  // sidewall
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
  ctx.fillStyle = '#242428';
  ctx.fill();

  // sidewall bolt pattern
  ctx.fillStyle = '#131315';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58, r * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }

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

  // lug nuts
  ctx.fillStyle = '#5a5d63';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 5;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.22, Math.sin(a) * r * 0.22, r * 0.04, 0, Math.PI * 2);
    ctx.fill();
  }

  // hub cap
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.13, 0, Math.PI * 2);
  ctx.fillStyle = '#4a4d54';
  ctx.fill();

  ctx.restore();
}

function drawFenderArch(cx: number, cy: number) {
  const r = WHEEL_RADIUS + 13;
  ctx.strokeStyle = '#8f2c1f';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
}

function drawFlameDecal(w: number, h: number) {
  ctx.fillStyle = 'rgba(255, 200, 60, 0.92)';
  ctx.beginPath();
  ctx.moveTo(-w * 0.46, h * 0.02);
  ctx.quadraticCurveTo(-w * 0.34, -h * 0.16, -w * 0.22, h * 0.0);
  ctx.quadraticCurveTo(-w * 0.1, -h * 0.14, w * 0.04, h * 0.04);
  ctx.quadraticCurveTo(-w * 0.08, h * 0.1, -w * 0.22, h * 0.12);
  ctx.quadraticCurveTo(-w * 0.36, h * 0.1, -w * 0.46, h * 0.24);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(232, 84, 62, 0.9)';
  ctx.beginPath();
  ctx.moveTo(-w * 0.44, h * 0.1);
  ctx.quadraticCurveTo(-w * 0.33, -h * 0.02, -w * 0.2, h * 0.08);
  ctx.quadraticCurveTo(-w * 0.3, h * 0.18, -w * 0.44, h * 0.22);
  ctx.closePath();
  ctx.fill();
}

function drawChassis() {
  const body = truck.chassis;
  const w = CHASSIS_WIDTH;
  const h = CHASSIS_HEIGHT;

  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);

  // fender arches, drawn before the body so the body's bottom edge overlaps them
  drawFenderArch(-WHEEL_OFFSET_X, WHEEL_OFFSET_Y);
  drawFenderArch(WHEEL_OFFSET_X, WHEEL_OFFSET_Y);

  // angled pickup body: sloped hood at the front (left), flat cab-to-bed line,
  // bed sitting a touch lower than the cab at the rear (right)
  ctx.fillStyle = '#d8402c';
  ctx.beginPath();
  ctx.moveTo(-w * 0.52, h * 0.5);
  ctx.lineTo(-w * 0.52, h * 0.12);
  ctx.lineTo(-w * 0.46, -h * 0.18);
  ctx.lineTo(-w * 0.2, -h * 0.5);
  ctx.lineTo(w * 0.02, -h * 0.5);
  ctx.lineTo(w * 0.09, -h * 0.32);
  ctx.lineTo(w * 0.52, -h * 0.32);
  ctx.lineTo(w * 0.54, -h * 0.02);
  ctx.lineTo(w * 0.54, h * 0.5);
  ctx.closePath();
  ctx.fill();

  drawFlameDecal(w, h);

  // frame rail along the bottom edge
  ctx.fillStyle = '#2b2b2e';
  ctx.fillRect(-w * 0.52, h * 0.34, w * 1.06, h * 0.16);

  // front/rear bumpers
  ctx.fillStyle = '#2b2b2e';
  ctx.fillRect(-w / 2 - 4, h * 0.1, 10, h * 0.5);
  ctx.fillRect(w / 2 - 6, h * 0.1, 10, h * 0.5);

  // prominent chrome front grille on the sloped hood
  ctx.fillStyle = '#b6bcc6';
  ctx.beginPath();
  ctx.moveTo(-w * 0.52, -h * 0.05);
  ctx.lineTo(-w * 0.46, -h * 0.22);
  ctx.lineTo(-w * 0.34, -h * 0.22);
  ctx.lineTo(-w * 0.38, -h * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#3a3a3d';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    ctx.beginPath();
    ctx.moveTo(-w * 0.52 + t * (w * 0.06 - t * 0.02), -h * 0.05 - t * (h * 0.14));
    ctx.lineTo(-w * 0.34 - t * 0.01, -h * 0.22 + t * (h * 0.02));
    ctx.stroke();
  }

  // headlights at both ends (either can be "front")
  ctx.fillStyle = '#ffe27a';
  ctx.beginPath();
  ctx.arc(-w * 0.44, -h * 0.14, 4.2, 0, Math.PI * 2);
  ctx.arc(w * 0.47, -h * 0.16, 4, 0, Math.PI * 2);
  ctx.fill();

  // cab roof
  ctx.fillStyle = '#c23222';
  roundRectPath(-w * 0.24, -h * 1.7, w * 0.48, h * 0.3, 4);
  ctx.fill();

  // roof light bar
  ctx.fillStyle = '#fff3c4';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(-w * 0.13 + i * (w * 0.09), -h * 1.75, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

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

// Shock and control-arm frame mounts are shifted toward the rear of the
// truck (+x, the exhaust end) so each strut runs diagonally behind its wheel
// rather than straight down through the tire face.
const SHOCK_REAR_OFFSET = 18;
const SHOCK_FRAME_Y = -CHASSIS_HEIGHT * 0.05;
const ARM_REAR_OFFSET = 9;
const ARM_FRAME_Y = CHASSIS_HEIGHT * 0.4;
const MAX_STRUT_LENGTH = WHEEL_RADIUS * 2.2;

function toWorld(chassis: Matter.Body, localX: number, localY: number) {
  const cos = Math.cos(chassis.angle);
  const sin = Math.sin(chassis.angle);
  return {
    x: chassis.position.x + localX * cos - localY * sin,
    y: chassis.position.y + localX * sin + localY * cos,
  };
}

function drawStrut(mountX: number, mountY: number, wheel: Matter.Body, color: string, lineWidth: number) {
  const dx = wheel.position.x - mountX;
  const dy = wheel.position.y - mountY;
  const dist = Math.min(MAX_STRUT_LENGTH, Math.hypot(dx, dy) || 1);
  const ux = dx / (Math.hypot(dx, dy) || 1);
  const uy = dy / (Math.hypot(dx, dy) || 1);
  const endX = mountX + ux * dist;
  const endY = mountY + uy * dist;

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(mountX, mountY);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  return { ux, uy, len: dist, endX, endY };
}

function drawSuspension(wheelLocalX: number, wheel: Matter.Body) {
  const chassis = truck.chassis;
  const shockMount = toWorld(chassis, wheelLocalX + SHOCK_REAR_OFFSET, SHOCK_FRAME_Y);
  const armMount = toWorld(chassis, wheelLocalX + ARM_REAR_OFFSET, ARM_FRAME_Y);

  // frame brackets where the struts meet the body
  ctx.fillStyle = '#2b2b2e';
  ctx.beginPath();
  ctx.arc(shockMount.x, shockMount.y, 5, 0, Math.PI * 2);
  ctx.arc(armMount.x, armMount.y, 5, 0, Math.PI * 2);
  ctx.fill();

  // lower control arm, from a frame-rail bracket to the wheel hub
  drawStrut(armMount.x, armMount.y, wheel, '#2b2b2e', 6);

  // heavy-duty coil-over shock, from higher on the frame down to the wheel hub
  const shock = drawStrut(shockMount.x, shockMount.y, wheel, '#f2c230', 9);

  // coiled spring wound around the shock body
  const coils = 6;
  ctx.strokeStyle = '#d7dae0';
  ctx.lineWidth = 2.6;
  for (let i = 1; i < coils; i++) {
    const t = i / coils;
    const cxp = shockMount.x + shock.ux * shock.len * t;
    const cyp = shockMount.y + shock.uy * shock.len * t;
    ctx.beginPath();
    ctx.ellipse(cxp, cyp, 8, 3.6, Math.atan2(shock.uy, shock.ux), 0, Math.PI * 2);
    ctx.stroke();
  }

  // lower shock eyelet at the wheel hub
  ctx.fillStyle = '#3a3a3d';
  ctx.beginPath();
  ctx.arc(shock.endX, shock.endY, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawNosFlame() {
  const body = truck.chassis;
  const w = CHASSIS_WIDTH;
  const h = CHASSIS_HEIGHT;
  const time = performance.now();

  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);

  const tipX = w * 0.32 + 3;
  const tipY = -h * 1.9;
  const pulse = 0.75 + 0.25 * Math.sin(time * 0.04);
  const jitter = (Math.sin(time * 0.11) + Math.sin(time * 0.23)) * 0.5;
  const len = h * (1.3 + 0.5 * pulse);
  const baseWidth = 5 + jitter * 1.5;

  ctx.fillStyle = 'rgba(255, 140, 40, 0.9)';
  ctx.beginPath();
  ctx.moveTo(tipX - baseWidth, tipY);
  ctx.quadraticCurveTo(tipX - baseWidth * 0.3, tipY - len * 0.6, tipX + jitter * 3, tipY - len);
  ctx.quadraticCurveTo(tipX + baseWidth * 0.3, tipY - len * 0.6, tipX + baseWidth, tipY);
  ctx.closePath();
  ctx.fill();

  const innerLen = len * 0.55;
  const innerWidth = baseWidth * 0.5;
  ctx.fillStyle = 'rgba(255, 240, 180, 0.95)';
  ctx.beginPath();
  ctx.moveTo(tipX - innerWidth, tipY);
  ctx.quadraticCurveTo(tipX, tipY - innerLen * 0.6, tipX + jitter * 1.5, tipY - innerLen);
  ctx.quadraticCurveTo(tipX + innerWidth * 0.5, tipY - innerLen * 0.6, tipX + innerWidth, tipY);
  ctx.closePath();
  ctx.fill();

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
  drawBackground();
  ctx.save();
  ctx.translate(-camera.x, -camera.y);
  drawTerrain();
  drawWheel(truck.wheelRear);
  drawWheel(truck.wheelFront);
  drawSuspension(-WHEEL_OFFSET_X, truck.wheelRear);
  drawSuspension(WHEEL_OFFSET_X, truck.wheelFront);
  drawChassis();
  if (started && truck.isNosActive) drawNosFlame();
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
    if (!crashed && started) {
      const airborne = rearContacts === 0 && frontContacts === 0;
      truck.applyInput(inputDirection, airborne, nosHeld, FIXED_DT);
      Engine.update(engine, FIXED_DT);
      checkCrash(FIXED_DT);
    }
    accumulator -= FIXED_DT;
  }

  if (!crashed && started) terrain.update(truck.position.x);
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

  nosFillEl.style.width = `${Math.round(truck.nosFuelLevel * 100)}%`;
  nosFillEl.classList.toggle('empty', truck.nosFuelLevel <= 0);

  requestAnimationFrame(tick);
}

terrain.update(truck.position.x);
requestAnimationFrame(tick);
