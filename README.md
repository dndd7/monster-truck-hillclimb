# Monster Truck Hillclimb

A side-view 2D physics driving game in the spirit of Hill Climb Racing — drive a
monster truck over procedurally generated, endless hilly terrain. Built with
[Matter.js](https://brm.io/matter-js/) for real rigid-body physics: momentum,
suspension, and wheelies all come from the simulation, not scripted animation.

Play it in any modern browser, no install required.

## Controls

| Action              | Keyboard      | Touch            |
| -------------------- | ------------- | ---------------- |
| Drive forward / gas   | Right arrow   | Right on-screen button |
| Reverse / brake       | Left arrow    | Left on-screen button  |
| Tilt truck mid-air    | Hold either arrow while airborne | Hold either button while airborne |
| Reset run             | Reset button (top right) | Reset button (top right) |

Flipping the truck onto its roof and staying there ends the run — hit **Retry**
to try again. Your best distance for the session is shown on the crash screen.

## How it's built

- **Chassis + wheels** are separate rigid bodies connected by spring
  constraints, so the truck has real (if bouncy) suspension travel rather than
  a rigidly pinned axle.
- **Driving** applies bounded motor *torque* to both wheels (4WD) rather than
  setting their spin directly — this keeps the simulation numerically stable
  even at full throttle on steep terrain.
- **Terrain** is generated from a sum of sine waves that gets rougher the
  further you drive, and is built as many small convex ground segments (rather
  than one long concave strip) so physics collision always matches what's
  rendered, without needing a polygon-decomposition library.
- Everything renders on a single `<canvas>` with a camera that follows the
  truck; there's no game engine beyond Matter.js for physics.

## Development

```bash
npm install
npm run dev      # start the dev server
npm run build    # type-check and produce a production build in dist/
```

This is a static site — `npm run build` output can be hosted anywhere. A
GitHub Actions workflow (`.github/workflows/deploy.yml`) is included to
auto-deploy `dist/` to GitHub Pages on every push to `main`; enable Pages for
the repo (Settings → Pages → Source: GitHub Actions) to use it.

## License

MIT — see [LICENSE](LICENSE).
