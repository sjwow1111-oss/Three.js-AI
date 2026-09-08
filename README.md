# 🧊 Three.js AI Studio

Send a prompt and a few photos to the AI of your choice, and it writes **Three.js code that builds a 3D model** — rendered right there in the browser for you to explore, export, and keep refining.

You pick the AI. On the first screen you enter an **OpenAI- or Anthropic-compatible endpoint**, your API key, and a model.

```
[Connect] ──▶ [Prompt + photos] ──▶ [AI writes Three.js code] ──▶ [Live render in a sandboxed viewer]
```

## Features

| | |
|---|---|
| **Bring your own AI** | OpenAI · Anthropic · OpenRouter · Groq · Together · DeepSeek · Mistral · Ollama · LM Studio · vLLM — anything speaking either protocol |
| **Model discovery** | Lists available models via `GET /models`, or type a model ID by hand |
| **Prompt + reference photos** | Attach up to 4 images (drag, pick, or paste). With a vision model the shapes and palette carry over |
| **Live streaming** | Watch the code being written, token by token |
| **Sandboxed execution** | Generated code runs only inside an iframe **without** `allow-same-origin`, so it can never reach your API key or the page around it |
| **Automatic repair** | If the code throws at runtime, the error goes back to the AI and it patches itself once |
| **Conversational refinement** | "Make the roof red" — keep iterating on the same model |
| **View & export** | Orbit, zoom, auto-rotate, wireframe and grid toggles · **PNG capture**, **GLB export**, code download |
| **Gallery** | Everything you generate is saved locally with a thumbnail and can be reloaded any time |

## Getting started

No build step — it is plain static files.

```bash
git clone https://github.com/sjwow1111-oss/Three.js-AI.git
cd Three.js-AI
npm start            # → http://localhost:5173
```

`npm start` runs a dependency-free Node static server (`server/serve.mjs`). Any other static server works too.

> Opening the files over `file://` will not work — ES modules need to be served over HTTP.

## How to use it

1. **Connection screen**
   - Pick a preset or type the endpoint yourself — everything up to `/chat/completions`, e.g. `https://api.openai.com/v1`.
   - Choose the API format. Most services are **OpenAI-compatible**; only Anthropic's own API uses **Anthropic-compatible**.
   - Enter your API key (local servers such as Ollama can be left blank), hit **Load models**, pick one, and confirm with **Test connection**.
   - Click **Open studio**.
2. **Studio**
   - Describe what you want (or click an example chip) and attach reference photos if you have them.
   - Choose style, detail level, and whether it should animate, then hit **✨ Generate 3D model** (`Ctrl/⌘ + Enter`).
   - Orbit around the result, save it as PNG or GLB, or keep shaping it with **Keep refining**.

## Where does my API key go?

- It stays **in your browser** and is sent only to the endpoint you configured. Nothing is collected anywhere else.
- Ticking *Remember this key* stores it in `localStorage`. Leave it off on shared machines.
- Because calls are made straight from the browser, the endpoint must **allow CORS**:
  - OpenAI, Anthropic, OpenRouter, Groq and friends do. (For Anthropic the `anthropic-dangerous-direct-browser-access` header is added for you.)
  - Ollama may need `OLLAMA_ORIGINS=*`.
  - For endpoints that block CORS, turn on **Advanced → Route through the local proxy**. The server started by `npm start` relays the request at `/api/proxy`; your key only passes through its headers and is never stored.

## The generated-code contract

The AI is instructed to return exactly this shape, which you can read and save from the Code tab:

```js
function createModel(THREE, ctx) {
  const root = new THREE.Group();
  // ... build geometry and materials ...
  return root;                        // any THREE.Object3D
}

function update(root, time, delta) {  // optional per-frame animation
  root.rotation.y = time * 0.2;
}
```

- Camera framing, OrbitControls, lighting, shadows and the render loop are the viewer's job.
- `import` statements and network access are forbidden; textures are generated procedurally with `CanvasTexture`.
- The runtime is three.js **r0.169**, core namespace only — no addons.

## Project layout

```
index.html         Connection screen + studio UI
styles.css         All styling
sandbox.html       The isolated 3D viewer — the only place generated code runs
js/
  main.js          Screen flow, generation pipeline, gallery
  providers.js     OpenAI / Anthropic adapters (model listing, SSE streaming)
  prompts.js       System prompt, refine/repair prompts, code extraction
  viewer.js        postMessage bridge to the sandbox iframe
  store.js         Settings, API key, and gallery persistence (localStorage)
server/serve.mjs   Static server + optional /api/proxy (no dependencies)
```

## Notes

- The viewer loads three.js from a CDN (unpkg). On an air-gapped network, drop the `three` package into `vendor/` and point the import map in `sandbox.html` at `/vendor/three.module.js` and `/vendor/jsm/`. (`server/serve.mjs` already sends CORS headers on static files for exactly this.)
- Output quality depends heavily on how good your model is at writing code — stronger coding models produce noticeably better geometry.

## License

MIT
