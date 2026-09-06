import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

// Run with Node to regenerate the standalone SVG and check its geometry.
const duration = 8;
const samples = 96;
const tau = Math.PI * 2;
const angle = (time) => Math.PI / 4 + time * tau;
const round = (value) => Number(value.toFixed(3));

function project([x, y, z], time) {
  const a = angle(time);
  return [
    32 + (x * Math.cos(a) - z * Math.sin(a)) * 10.5 * Math.SQRT2,
    32 + (x * Math.sin(a) + z * Math.cos(a)) * 7 * Math.SQRT2 - (y - 0.5) * 20,
  ].map(round);
}

function box(x0, x1, y0, y1, z0, z1, top = false) {
  const faces = [
    {
      normal: [-1, 0, 0],
      points: [
        [x0, y0, z0],
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0],
      ],
    },
    {
      normal: [1, 0, 0],
      points: [
        [x1, y0, z1],
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
      ],
    },
    {
      normal: [0, 0, -1],
      points: [
        [x1, y0, z0],
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z0],
      ],
    },
    {
      normal: [0, 0, 1],
      points: [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
    },
  ];
  if (top)
    faces.push({
      normal: [0, 1, 0],
      points: [
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
    });
  return faces;
}

const left = box(-1, 0, 0, 0.94, 0.94, 1);
const right = box(0.94, 1, 0, 0.94, -1, 1);
const top = box(-1, 1, 0.94, 1, -1, 1, true);

function visibleFaces(time) {
  const a = angle(time);
  // The supports are separated along x. Draw the farther support first;
  // the tabletop is always above both with this fixed elevated camera.
  const supports = Math.sin(a) > 0 ? [...left, ...right] : [...right, ...left];
  return [...supports, ...top].filter(
    ({ normal: [x, y, z] }) => x * Math.sin(a) + z * Math.cos(a) + y > 1e-8,
  );
}

function path(face, time) {
  return (
    face.points
      .map((point, index) => `${index ? "L" : "M"}${project(point, time).join(" ")}`)
      .join("") + "Z"
  );
}

function shade({ normal: [x, y, z] }, time) {
  const value = y
    ? 163
    : Math.round(50 + 42 * (x * Math.cos(angle(time)) - z * Math.sin(angle(time))));
  return `#${value.toString(16).padStart(2, "0").repeat(3)}`;
}

function animate(attribute, values, times, discrete = false) {
  return `<animate attributeName="${attribute}" dur="${duration}s" repeatCount="indefinite" calcMode="${discrete ? "discrete" : "linear"}" keyTimes="${times.map((time) => Number(time.toFixed(6))).join(";")}" values="${values.join(";")}"/>`;
}

// Switch draw order only at edge-on angles, where the affected face has zero area.
const breaks = [0, 0.125, 0.375, 0.625, 0.875, 1];
const still = visibleFaces(0)
  .map((face) => `<path d="${path(face, 0)}" fill="${shade(face, 0)}"/>`)
  .join("\n");
const segments = breaks
  .slice(0, -1)
  .map((start, index) => {
    const end = breaks[index + 1];
    const times = Array.from(
      { length: Math.round((end - start) * samples) + 1 },
      (_, step) => start + step / samples,
    );
    if (start > 0) times.unshift(0);
    if (end < 1) times.push(1);
    const visibility = breaks.map((_, step) =>
      step === index || (step === breaks.length - 1 && index === 0) ? "visible" : "hidden",
    );
    const paths = visibleFaces((start + end) / 2)
      .map((face) => {
        const frames = times.map((time) => Math.min(end, Math.max(start, time)));
        return `<path d="${path(face, start)}" fill="${shade(face, start)}">\n${animate(
          "d",
          frames.map((time) => path(face, time)),
          times,
        )}\n${animate(
          "fill",
          frames.map((time) => shade(face, time)),
          times,
        )}\n</path>`;
      })
      .join("\n");
    return `<g visibility="${index === 0 ? "visible" : "hidden"}">\n${animate("visibility", visibility, breaks, true)}\n${paths}\n</g>`;
  })
  .join("\n");

// Check the accepted front silhouette, seamless loop, bounds, and quarter-turn depth.
assert.deepEqual(project([-1, 1, -1], 0), [32, 8]);
assert.deepEqual(project([-1, 1, 1], 0), [11, 22]);
assert.deepEqual(project([1, 0, 1], 0), [32, 56]);
for (const face of [...left, ...right, ...top]) {
  assert.equal(path(face, 0), path(face, 1));
  assert.equal(shade(face, 0), shade(face, 1));
  for (let frame = 0; frame <= samples; frame++) {
    for (const point of face.points) {
      assert(project(point, frame / samples).every((value) => value >= 0 && value <= 64));
    }
  }
}
for (const time of [0.125, 0.375, 0.625, 0.875]) {
  const points = visibleFaces(time).flatMap((face) =>
    face.points.map((point) => project(point, time)),
  );
  assert(Math.max(...points.map(([x]) => x)) - Math.min(...points.map(([x]) => x)) > 29);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="pi-spatial-rotation-title">
<title id="pi-spatial-rotation-title">Pi Workbench</title>
<!-- Generated by generate-spatial-rotation.mjs. Three-dimensional projection, no runtime script. -->
<style>
  .still { display: none; }
  @media (prefers-reduced-motion: reduce) {
    .motion { display: none; }
    .still { display: inline; }
  }
</style>
<g class="still">${still}</g>
<g class="motion">${segments}</g>
</svg>
`;
await writeFile(new URL("./pi-workbench-spatial-rotation.svg", import.meta.url), svg);
console.log(`Geometry checks passed; wrote ${Buffer.byteLength(svg)} bytes (${duration}s loop).`);
