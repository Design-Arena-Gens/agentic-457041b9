import { NodeCatalog } from './nodes.js';

// ----- Editor state -----
const viewportEl = document.getElementById('viewport');
const workspaceEl = document.getElementById('workspace');
const nodesLayerEl = document.getElementById('nodes-layer');
const wiresEl = document.getElementById('wires');
const tempWireEl = document.getElementById('temp-wire');
const contextMenuEl = document.getElementById('context-menu');

const addNodeBtn = document.getElementById('add-node-btn');
const addNodeMenu = document.getElementById('add-node-menu');
const resetViewBtn = document.getElementById('reset-view-btn');
const exportBtn = document.getElementById('export-btn');
const importBtn = document.getElementById('import-btn');
const importFile = document.getElementById('import-file');
const helpBtn = document.getElementById('help-btn');
const helpDialog = document.getElementById('help-dialog');

let worldScale = 1.0;
let worldX = 2000, worldY = 2000; // centered area within large workspace

let nodes = new Map(); // id -> { id, type, x, y, params }
let edges = new Map(); // id -> { id, from: {nodeId, port}, to: {nodeId, port} }
let selection = { nodeId: null, edgeId: null };

let connecting = null; // { fromNodeId, fromPort, startX, startY }

// ----- Utilities -----
function uid(prefix = 'id') { return `${prefix}_${Math.random().toString(36).slice(2,9)}`; }
function toWorld(clientX, clientY) {
  const rect = viewportEl.getBoundingClientRect();
  const x = (clientX - rect.left) / worldScale - worldX;
  const y = (clientY - rect.top) / worldScale - worldY;
  return { x, y };
}
function applyTransform() {
  workspaceEl.style.transform = `translate(${worldX}px, ${worldY}px) scale(${worldScale})`;
  renderAll();
}
function setSelection({ nodeId=null, edgeId=null }) {
  selection.nodeId = nodeId; selection.edgeId = edgeId;
  renderSelection();
}
function renderSelection() {
  for (const el of nodesLayerEl.querySelectorAll('.node')) {
    const id = el.getAttribute('data-id');
    el.classList.toggle('selected', selection.nodeId === id);
  }
  for (const p of wiresEl.querySelectorAll('.wire')) {
    const id = p.getAttribute('data-id');
    p.classList.toggle('selected', selection.edgeId === id);
  }
}

// ----- Node/Edge CRUD -----
function addNode(type, x, y) {
  const def = NodeCatalog[type];
  const id = uid('node');
  nodes.set(id, { id, type, x, y, params: def.defaultParams() });
  save();
  renderAll();
  scheduleCompute();
  return id;
}
function removeNode(id) {
  nodes.delete(id);
  for (const [eid, e] of [...edges]) {
    if (e.from.nodeId === id || e.to.nodeId === id) edges.delete(eid);
  }
  if (selection.nodeId === id) setSelection({});
  save();
  renderAll();
  scheduleCompute();
}
function addEdge(fromNodeId, fromPort, toNodeId, toPort) {
  if (fromNodeId === toNodeId) return; // no self
  // no multiple connections to same input
  for (const [eid, e] of edges) {
    if (e.to.nodeId === toNodeId && e.to.port === toPort) edges.delete(eid);
  }
  // avoid cycles
  if (createsCycle(fromNodeId, toNodeId)) return;
  const id = uid('edge');
  edges.set(id, { id, from: { nodeId: fromNodeId, port: fromPort }, to: { nodeId: toNodeId, port: toPort } });
  save();
  renderWires();
  scheduleCompute();
}
function removeEdge(id) {
  edges.delete(id);
  if (selection.edgeId === id) setSelection({});
  save();
  renderWires();
  scheduleCompute();
}
function createsCycle(srcNodeId, dstNodeId) {
  // Adding src -> dst. If dst reaches src already, it creates a cycle
  const adj = new Map();
  for (const n of nodes.keys()) adj.set(n, []);
  for (const e of edges.values()) adj.get(e.from.nodeId).push(e.to.nodeId);
  // simulate adding
  if (!adj.has(srcNodeId)) adj.set(srcNodeId, []);
  adj.get(srcNodeId).push(dstNodeId);
  // dfs from dst to see if can reach src
  const seen = new Set();
  const stack = [dstNodeId];
  while (stack.length) {
    const v = stack.pop();
    if (v === srcNodeId) return true;
    if (seen.has(v)) continue; seen.add(v);
    for (const w of adj.get(v) || []) stack.push(w);
  }
  return false;
}

// ----- Persistence -----
function save() {
  const data = {
    nodes: [...nodes.values()].map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, params: n.params })),
    edges: [...edges.values()],
    view: { worldScale, worldX, worldY }
  };
  localStorage.setItem('nodeStudio', JSON.stringify(data));
}
function load() {
  const raw = localStorage.getItem('nodeStudio');
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    nodes = new Map(data.nodes.map(n => [n.id, n]));
    edges = new Map(data.edges.map(e => [e.id, e]));
    if (data.view) { worldScale = data.view.worldScale; worldX = data.view.worldX; worldY = data.view.worldY; }
    applyTransform();
    scheduleCompute();
    return true;
  } catch {}
  return false;
}

// ----- Rendering -----
function renderAll() {
  renderNodes();
  renderWires();
}
function renderNodes() {
  // Ensure DOM nodes match state
  const existing = new Set([...nodesLayerEl.children].map(c => c.getAttribute('data-id')));
  for (const id of existing) if (!nodes.has(id)) nodesLayerEl.querySelector(`[data-id="${id}"]`)?.remove();
  for (const node of nodes.values()) {
    let el = nodesLayerEl.querySelector(`[data-id="${node.id}"]`);
    if (!el) {
      el = createNodeElement(node);
      nodesLayerEl.appendChild(el);
    }
    el.style.transform = `translate(${node.x}px, ${node.y}px)`;
    updateNodePreview(node.id);
  }
  renderSelection();
}
function createNodeElement(node) {
  const def = NodeCatalog[node.type];
  const el = document.createElement('div'); el.className = 'node'; el.setAttribute('data-id', node.id);

  const header = document.createElement('div'); header.className = 'node-header'; header.innerHTML = `<span>${def.label}</span>`;
  const delBtn = document.createElement('button'); delBtn.className = 'btn ghost'; delBtn.textContent = '??';
  delBtn.addEventListener('click', (e) => { e.stopPropagation(); removeNode(node.id); });
  header.appendChild(delBtn);

  const body = document.createElement('div'); body.className = 'node-body';

  const ports = document.createElement('div'); ports.className = 'ports';
  // inputs
  for (const p of (def.inputs || [])) {
    const row = document.createElement('div'); row.className = 'port-row';
    const dot = document.createElement('div'); dot.className = 'port input'; dot.setAttribute('data-port', p);
    dot.addEventListener('mouseup', (e) => { if (connecting) { addEdge(connecting.fromNodeId, connecting.fromPort, node.id, p); connecting = null; renderTempWire(null); } });
    const label = document.createElement('div'); label.className = 'port-label'; label.textContent = p;
    row.appendChild(dot); row.appendChild(label); ports.appendChild(row);
  }
  // outputs
  for (const p of (def.outputs || [])) {
    const row = document.createElement('div'); row.className = 'port-row';
    const label = document.createElement('div'); label.className = 'port-label'; label.textContent = p;
    const dot = document.createElement('div'); dot.className = 'port output'; dot.setAttribute('data-port', p);
    dot.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const rect = dot.getBoundingClientRect();
      const start = toWorld(rect.left + rect.width/2, rect.top + rect.height/2);
      connecting = { fromNodeId: node.id, fromPort: p, startX: start.x, startY: start.y };
    });
    row.appendChild(label); row.appendChild(dot); ports.appendChild(row);
  }

  const preview = document.createElement('div'); preview.className = 'preview'; preview.innerHTML = '<canvas></canvas>';
  const controls = document.createElement('div'); controls.className = 'controls';
  for (const c of def.controls(node.params, (delta) => { Object.assign(node.params, delta); save(); scheduleCompute(); updateNodeControls(node.id); })) controls.appendChild(c);

  body.appendChild(ports);
  body.appendChild(preview);
  body.appendChild(controls);

  el.appendChild(header);
  el.appendChild(body);

  // drag move
  let drag = null;
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelection({ nodeId: node.id });
    drag = { dx: e.clientX, dy: e.clientY, startX: node.x, startY: node.y };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });
  });
  function onMove(e) {
    if (!drag) return;
    const mx = (e.clientX - drag.dx) / worldScale;
    const my = (e.clientY - drag.dy) / worldScale;
    node.x = drag.startX + mx; node.y = drag.startY + my;
    el.style.transform = `translate(${node.x}px, ${node.y}px)`;
    renderWires();
  }
  function onUp() { drag = null; save(); scheduleCompute(); window.removeEventListener('mousemove', onMove); }

  // selection
  el.addEventListener('click', (e) => { e.stopPropagation(); setSelection({ nodeId: node.id }); });

  // context
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); openContextMenu(e.clientX, e.clientY, [
    { label: 'Delete Node', action: () => removeNode(node.id) }
  ]); });

  return el;
}
function updateNodeControls(nodeId) {
  const node = nodes.get(nodeId); if (!node) return;
  const el = nodesLayerEl.querySelector(`[data-id="${nodeId}"]`);
  const controls = el.querySelector('.controls');
  controls.innerHTML = '';
  const def = NodeCatalog[node.type];
  for (const c of def.controls(node.params, (delta) => { Object.assign(node.params, delta); save(); scheduleCompute(); updateNodeControls(node.id); })) controls.appendChild(c);
}
function updateNodePreview(nodeId, imageCanvas=null) {
  const el = nodesLayerEl.querySelector(`[data-id="${nodeId}"]`);
  if (!el) return;
  const cv = el.querySelector('canvas');
  if (imageCanvas) {
    // draw scaled preview
    const maxW = 260; const scale = Math.min(1, maxW / imageCanvas.width);
    cv.width = Math.round(imageCanvas.width * scale);
    cv.height = Math.round(imageCanvas.height * scale);
    const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.drawImage(imageCanvas, 0, 0, cv.width, cv.height);
  }
}

function renderWires() {
  wiresEl.innerHTML = '';
  for (const e of edges.values()) {
    const fromEl = nodesLayerEl.querySelector(`[data-id="${e.from.nodeId}"] .port.output[data-port="${e.from.port}"]`);
    const toEl = nodesLayerEl.querySelector(`[data-id="${e.to.nodeId}"] .port.input[data-port="${e.to.port}"]`);
    if (!fromEl || !toEl) continue;
    const a = centerOf(fromEl); const b = centerOf(toEl);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', cubicPath(a, b));
    path.setAttribute('class', 'wire');
    path.setAttribute('data-id', e.id);
    path.addEventListener('click', (ev) => { ev.stopPropagation(); setSelection({ edgeId: e.id }); });
    path.addEventListener('contextmenu', (ev) => { ev.preventDefault(); openContextMenu(ev.clientX, ev.clientY, [ { label: 'Delete Connection', action: () => removeEdge(e.id) } ]); });
    wiresEl.appendChild(path);
  }
  renderSelection();
}
function renderTempWire(pt) {
  tempWireEl.innerHTML = '';
  if (!connecting || !pt) return;
  const a = { x: connecting.startX, y: connecting.startY };
  const b = pt;
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', cubicPath(a, b));
  path.setAttribute('class', 'wire');
  tempWireEl.appendChild(path);
}
function centerOf(el) {
  const r = el.getBoundingClientRect();
  const w = toWorld(r.left + r.width / 2, r.top + r.height / 2);
  return w;
}
function cubicPath(a, b) {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  const c1 = { x: a.x + dx, y: a.y };
  const c2 = { x: b.x - dx, y: b.y };
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
}

// ----- Compute engine -----
let computeScheduled = false;
function scheduleCompute() {
  if (computeScheduled) return; computeScheduled = true;
  queueMicrotask(async () => { computeScheduled = false; await computeGraph(); });
}
async function computeGraph() {
  // Build graph
  const inEdgesByNode = new Map();
  const outEdgesByNode = new Map();
  for (const id of nodes.keys()) { inEdgesByNode.set(id, []); outEdgesByNode.set(id, []); }
  for (const e of edges.values()) {
    inEdgesByNode.get(e.to.nodeId).push(e);
    outEdgesByNode.get(e.from.nodeId).push(e);
  }
  // Kahn topological sort
  const indeg = new Map([...nodes.keys()].map(id => [id, inEdgesByNode.get(id).length]));
  const q = [...nodes.keys()].filter(id => (indeg.get(id) === 0));
  const order = [];
  while (q.length) {
    const v = q.shift(); order.push(v);
    for (const e of outEdgesByNode.get(v)) {
      const w = e.to.nodeId; indeg.set(w, indeg.get(w)-1);
      if (indeg.get(w) === 0) q.push(w);
    }
  }
  // if cycle: skip compute
  if (order.length !== nodes.size) return;

  const outputs = new Map(); // nodeId -> { image: canvas|null }
  for (const id of order) {
    const node = nodes.get(id); const def = NodeCatalog[node.type];
    const inputMap = {};
    for (const e of inEdgesByNode.get(id)) {
      const fromOut = outputs.get(e.from.nodeId) || {};
      inputMap[e.to.port] = fromOut;
    }
    try {
      const out = await def.compute(node.params, inputMap);
      outputs.set(id, out);
      if (out?.image) updateNodePreview(id, out.image);
      if (node.type === 'Display') updateNodePreview(id, out?.image || null);
    } catch (err) {
      console.error('Compute error for node', id, err);
    }
  }
}

// ----- Pan / Zoom -----
let pan = { dragging: false, startX: 0, startY: 0, baseX: 0, baseY: 0 };
viewportEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  pan.dragging = true; viewportEl.classList.add('dragging');
  pan.startX = e.clientX; pan.startY = e.clientY; pan.baseX = worldX; pan.baseY = worldY;
});
window.addEventListener('mousemove', (e) => {
  if (!pan.dragging) {
    // update temp wire
    if (connecting) { const w = toWorld(e.clientX, e.clientY); renderTempWire(w); }
    return;
  }
  worldX = pan.baseX + (e.clientX - pan.startX) / worldScale;
  worldY = pan.baseY + (e.clientY - pan.startY) / worldScale;
  applyTransform();
});
window.addEventListener('mouseup', () => { pan.dragging = false; viewportEl.classList.remove('dragging'); save(); });
viewportEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  const mouseWorldBefore = toWorld(e.clientX, e.clientY);
  const factor = Math.exp(-e.deltaY * 0.001);
  worldScale = Math.max(0.25, Math.min(2.5, worldScale * factor));
  const mouseWorldAfter = toWorld(e.clientX, e.clientY);
  worldX += (mouseWorldBefore.x - mouseWorldAfter.x);
  worldY += (mouseWorldBefore.y - mouseWorldAfter.y);
  applyTransform(); save();
}, { passive: false });

// ----- Context menu -----
function openContextMenu(clientX, clientY, items) {
  contextMenuEl.innerHTML = '';
  for (const it of items) {
    const el = document.createElement('div'); el.className = 'context-item'; el.textContent = it.label; el.addEventListener('click', () => { closeContextMenu(); it.action(); });
    contextMenuEl.appendChild(el);
  }
  contextMenuEl.style.left = clientX + 'px';
  contextMenuEl.style.top = clientY + 'px';
  contextMenuEl.hidden = false;
}
function closeContextMenu() { contextMenuEl.hidden = true; }
window.addEventListener('click', closeContextMenu);
window.addEventListener('contextmenu', (e) => {
  // background context
  if (e.target.closest('.node') || e.target.closest('.port') || e.target.closest('.wire')) return;
  e.preventDefault();
  const w = toWorld(e.clientX, e.clientY);
  openContextMenu(e.clientX, e.clientY, [
    { label: 'Add Create Image', action: () => addNodeAt('CreateImage', w.x, w.y) },
    { label: 'Add Gradient', action: () => addNodeAt('Gradient', w.x, w.y) },
    { label: 'Add Perlin Noise', action: () => addNodeAt('PerlinNoise', w.x, w.y) },
    { label: 'Add Combine', action: () => addNodeAt('Combine', w.x, w.y) },
    { label: 'Add Display', action: () => addNodeAt('Display', w.x, w.y) }
  ]);
});
function addNodeAt(type, x, y) { const id = addNode(type, x, y); setSelection({ nodeId: id }); }

// ----- Add-node dropdown -----
function buildAddNodeMenu() {
  addNodeMenu.innerHTML = '';
  const items = [
    { key: 'CreateImage', label: 'Create Image' },
    { key: 'Gradient', label: 'Add Gradient' },
    { key: 'PerlinNoise', label: 'Perlin Noise' },
    { key: 'Combine', label: 'Combine Images' },
    { key: 'Display', label: 'Display Image' },
  ];
  for (const it of items) {
    const el = document.createElement('div'); el.className = 'dropdown-item'; el.textContent = it.label;
    el.addEventListener('click', () => { addNodeAt(it.key, -worldX + 200, -worldY + 120); addNodeMenu.hidden = true; });
    addNodeMenu.appendChild(el);
  }
}
addNodeBtn.addEventListener('click', (e) => { addNodeMenu.hidden = !addNodeMenu.hidden; });
window.addEventListener('click', (e) => { if (!e.target.closest('#add-node-dropdown')) addNodeMenu.hidden = true; });

// ----- Selection & deletion -----
window.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selection.nodeId) removeNode(selection.nodeId);
    else if (selection.edgeId) removeEdge(selection.edgeId);
  }
});

// ----- Import/Export -----
exportBtn.addEventListener('click', () => {
  const data = { nodes: [...nodes.values()], edges: [...edges.values()], view: { worldScale, worldX, worldY } };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'graph.json'; a.click();
  URL.revokeObjectURL(url);
});
importBtn.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const file = importFile.files[0]; if (!file) return;
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    nodes = new Map(data.nodes.map(n => [n.id, n]));
    edges = new Map(data.edges.map(e => [e.id, e]));
    if (data.view) { worldScale = data.view.worldScale; worldX = data.view.worldX; worldY = data.view.worldY; }
    applyTransform(); save(); scheduleCompute();
  } catch (err) { alert('Failed to import graph.'); }
  importFile.value = '';
});

// ----- Reset & Help -----
resetViewBtn.addEventListener('click', () => { worldScale = 1; worldX = 2000; worldY = 2000; applyTransform(); save(); });
helpBtn.addEventListener('click', () => helpDialog.showModal());

// ----- Global clicks to finish connections -----
window.addEventListener('mouseup', (e) => {
  if (connecting) { connecting = null; renderTempWire(null); }
});

// ----- Init -----
buildAddNodeMenu();
applyTransform();

if (!load()) {
  // create a starter graph
  const n1 = addNode('PerlinNoise', 1900, 1920);
  const n2 = addNode('Gradient', 1900, 2100);
  const n3 = addNode('Combine', 2100, 2010);
  const n4 = addNode('Display', 2300, 2010);
  addEdge(n1, 'image', n3, 'A');
  addEdge(n2, 'image', n3, 'B');
  addEdge(n3, 'image', n4, 'image');
  scheduleCompute();
}
