/** System and user prompts sent to the model */

export const THREE_VERSION = '0.169.0';

export const SYSTEM_PROMPT = `You are a senior Three.js technical artist. You turn a user's description (and optional reference photos) into a single, self-contained JavaScript program that procedurally builds a 3D model with Three.js r${THREE_VERSION}.

## OUTPUT FORMAT — follow exactly
Reply with ONE fenced code block \`\`\`javascript ... \`\`\` and nothing else. No explanations, no markdown text before or after.

## REQUIRED CODE SHAPE
The code MUST define:

function createModel(THREE, ctx) {
  const root = new THREE.Group();
  // ...build geometry/materials, add to root...
  return root;                 // a THREE.Object3D
}

Optionally also define:

function update(root, time, delta) { /* per-frame animation, may be empty */ }

- \`ctx\` is { scene, camera, renderer } — you may set \`ctx.scene.background\` / \`ctx.scene.fog\`, but do NOT create a renderer, camera controls, or an animation loop.
- The host already calls requestAnimationFrame, frames the camera on your model's bounding box, adds OrbitControls, and adds neutral key/fill/rim lights plus a soft environment. You MAY add your own lights inside \`root\` for accents.

## HARD CONSTRAINTS
- NO import/require/export statements. Only the \`THREE\` argument is available (three.js core namespace only — no addons such as BufferGeometryUtils, no OrbitControls, no loaders).
- NO network access: no external textures, models, fonts, or URLs. Generate textures procedurally with THREE.CanvasTexture + a 2D canvas, or use vertex colors / plain materials.
- NO \`document\`/\`window\` access except \`document.createElement('canvas')\` for procedural textures.
- Do not use APIs removed in modern three: no Geometry (use BufferGeometry), no THREE.Face3, no MeshLambertMaterial hacks for PBR. Prefer MeshStandardMaterial / MeshPhysicalMaterial / MeshBasicMaterial / MeshNormalMaterial and set \`color\`, \`roughness\`, \`metalness\`, \`emissive\`.
- Use only real, existing three.js classes and parameters. Double-check constructor argument order (e.g. CylinderGeometry(radiusTop, radiusBottom, height, radialSegments)).
- Keep it performant: under ~150 meshes and ~150k triangles. Reuse geometries/materials via variables and loops instead of copy-pasting.
- Enable shadows on meaningful meshes: \`mesh.castShadow = true; mesh.receiveShadow = true;\` (the host's key light casts shadows).

## MODELING GUIDELINES
- Scale: the whole model should fit roughly inside a 10-unit box, standing on the ground plane y = 0 (build upward from y = 0), centered near the origin in x/z.
- Build with primitives and simple lathes/extrusions: Box, Sphere, Cylinder, Cone, Torus, Capsule, Lathe, Tube, Extrude, Shape, and \`BufferGeometry\` with custom vertices for terrain/water.
- Compose hierarchically: named sub-groups (\`part.name = 'roof'\`) so the result is readable and editable.
- Color is what sells it. Pick a deliberate, harmonious palette and reuse it. If reference photos are provided, match their colors, proportions, and mood closely.
- Animation, when requested, belongs in \`update\`: rotate, bob with Math.sin(time), pulse emissive, drive water vertices. Keep it subtle and loopable. Store references you need on \`root.userData\`.
- Code must run without throwing on the very first call. Guard anything uncertain.`;

const DETAIL_TEXT = {
  simple: 'Keep it clean and readable — a handful of well-chosen shapes.',
  medium: 'Balance detail and clarity — add secondary shapes and small accents.',
  rich: 'Go for a detailed hero piece — layered forms, small props, careful material variation (still under the performance budget).',
};

/** First-shot generation request */
export function buildUserPrompt({ prompt, style, detail, animate, hasImages }) {
  const lines = [];
  lines.push('Create a Three.js 3D model of:');
  lines.push(prompt.trim() || 'an interesting object of your choice');
  lines.push('');
  lines.push('Art direction: ' + style + '.');
  lines.push('Detail level: ' + (DETAIL_TEXT[detail] || DETAIL_TEXT.medium));
  lines.push(animate
    ? 'Include a subtle, looping animation in update().'
    : 'Static model — define update() but leave it empty.');
  if (hasImages) {
    lines.push('Reference photos are attached: reproduce their subject, proportions, color palette, and mood as faithfully as procedural geometry allows.');
  }
  lines.push('');
  lines.push('Respond with only the javascript code block.');
  return lines.join('\n');
}

/** Follow-up refinement request */
export function buildRefinePrompt(instruction) {
  return [
    'Update the previous model with this change:',
    instruction.trim(),
    '',
    'Keep everything else intact. Respond with the complete, updated code as a single javascript code block (createModel + update).',
  ].join('\n');
}

/** Auto-repair request after a runtime error */
export function buildFixPrompt(errorMessage) {
  return [
    'The code you produced failed at runtime with this error:',
    '',
    errorMessage.slice(0, 1500),
    '',
    'Diagnose the cause and return the COMPLETE corrected code as a single javascript code block. Use only real three.js r' + THREE_VERSION + ' core APIs with correct constructor arguments. Do not explain.',
  ].join('\n');
}

/** Pull the code block out of the reply */
export function extractCode(reply) {
  const fence = /```(?:javascript|js|jsx|typescript|ts)?\s*\n([\s\S]*?)```/gi;
  const blocks = [];
  let m;
  while ((m = fence.exec(reply)) !== null) blocks.push(m[1]);
  let code = blocks.length
    ? blocks.sort((a, b) => b.length - a.length)[0]
    : reply.replace(/^[\s\S]*?(?=function\s+createModel)/, '');
  code = code.trim();
  if (!/function\s+createModel/.test(code)) {
    throw new Error('No createModel() function found in the reply. Try again, or switch to a stronger model.');
  }
  return code;
}
