#!/usr/bin/env python3
"""Build the game's realistic people from the MakeHuman assets (CC0).

Reads the MakeHuman data folder (the base mesh, macro targets, the default skeleton and its
weights, and the high-poly eyes) and writes, into client/models/:

  people.glb    male and female bodies, each a skinned mesh with morph targets for variety
                (muscle, heavy, thin, old, african, asian, caucasian, elf ears), plus fitted
                eyes and generated hair, all on a simplified skeleton with finger bones
  people-regions.png  per texel: position along the arm, along the leg, height, body part
  people-detail.png   flight-suit details: harness straps, zipper and buckles, seams, pads
  people-face.png     face details: lips, brows, lash line, beard shadow
  people-eye.png      the eye, its iris as a mask so each person can have their own color

Only the assets are used (they are CC0); none of MakeHuman's code. Run:

  python3 tools/people/build.py <makehuman>/makehuman/data client/models
"""

import json
import math
import os
import struct
import sys

import numpy as np
from PIL import Image

DATA, OUT = sys.argv[1], sys.argv[2]
SCALE = 0.1          # MakeHuman works in decimeters
TEX = 1024


# ---- loading ------------------------------------------------------------------------------------

def load_obj(path):
    V, VT, faces, group = [], [], [], None
    for line in open(path):
        if line.startswith('v '):
            V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('vt '):
            VT.append([float(x) for x in line.split()[1:3]])
        elif line.startswith('g '):
            group = line.split()[1]
        elif line.startswith('f '):
            corners = []
            for t in line.split()[1:]:
                p = t.split('/')
                corners.append((int(p[0]) - 1, int(p[1]) - 1 if len(p) > 1 and p[1] else -1))
            faces.append((group, corners))
    return np.array(V, dtype=np.float64), np.array(VT, dtype=np.float64), faces


V0, VT, FACES = load_obj(os.path.join(DATA, '3dobjs/base.obj'))
BODY = [c for g, c in FACES if g == 'body']
target_cache = {}


def target(name):
    if name not in target_cache:
        rows = [l.split() for l in open(os.path.join(DATA, 'targets', name)) if l.strip() and not l.startswith('#')]
        idx = np.array([int(r[0]) for r in rows], dtype=np.int64)
        d = np.array([[float(x) for x in r[1:4]] for r in rows], dtype=np.float64).reshape(-1, 3)
        target_cache[name] = (idx, d)
    return target_cache[name]


def apply(X, name, w):
    idx, d = target(name)
    X[idx] += d * w


ETH = ['african', 'asian', 'caucasian']


def shape(sex, age='young', muscle='average', weight='average', eth=None, extra=()):
    X = V0.copy()
    for e in ETH:
        apply(X, f'macrodetails/{e}-{sex}-{age}.target', (1.0 if e == eth else 0.0) if eth else 1 / 3)
    apply(X, f'macrodetails/universal-{sex}-{age}-{muscle}muscle-{weight}weight.target', 1)
    for name, w in extra:
        apply(X, name, w)
    return X


# Into the game's frame: meters, feet on the ground, facing -z (MakeHuman faces +z).
FLOOR = None


def to_game(X):
    return np.stack([-X[:, 0], X[:, 1] - FLOOR, -X[:, 2]], axis=1) * SCALE


# ---- skeleton -------------------------------------------------------------------------------------

SKEL = json.load(open(os.path.join(DATA, 'rigs/default.mhskel')))
WEIGHTS = json.load(open(os.path.join(DATA, 'rigs/default_weights.mhw')))['weights']
KEEP = ['root', 'spine05', 'spine04', 'spine03', 'spine02', 'spine01', 'neck01', 'head']
for s in ('L', 'R'):
    KEEP += [f'clavicle.{s}', f'upperarm01.{s}', f'lowerarm01.{s}', f'wrist.{s}']
    KEEP += [f'finger{f}-{k}.{s}' for f in range(1, 6) for k in range(1, 4)]
    KEEP += [f'upperleg01.{s}', f'lowerleg01.{s}', f'foot.{s}']


def kept(bone):
    while bone not in KEEP:
        bone = SKEL['bones'][bone]['parent']
    return bone


def kept_parent(bone):
    p = SKEL['bones'][bone]['parent']
    return kept(p) if p else None


def joints_of(X):
    J = {k: X[v].mean(0) for k, v in SKEL['joints'].items()}
    return {b: (J[SKEL['bones'][b]['head']], J[SKEL['bones'][b]['tail']]) for b in SKEL['bones']}


# ---- mesh with uv seams split ---------------------------------------------------------------------

def triangulate(faces):
    tris = []
    for c in faces:
        for k in range(1, len(c) - 1):
            tris.append((c[0], c[k], c[k + 1]))
    return tris


TRIS = triangulate(BODY)
corner_ids = {}
for t in TRIS:
    for c in t:
        corner_ids.setdefault(c, len(corner_ids))
CORNERS = list(corner_ids.keys())
VIDX = np.array([c[0] for c in CORNERS])               # base-mesh vertex of each output vertex
UVS = np.array([VT[c[1]] for c in CORNERS])
INDEX = np.array([[corner_ids[c] for c in t] for t in TRIS], dtype=np.uint32)


def normals(P, index):
    n = np.zeros_like(P)
    a, b, c = P[index[:, 0]], P[index[:, 1]], P[index[:, 2]]
    fn = np.cross(b - a, c - a)
    for k in range(3):
        np.add.at(n, index[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def body_normals(Xg):
    # Normals on the welded mesh, so uv seams do not show.
    welded = np.array([[c[0] for c in t] for t in TRIS])
    n = normals(Xg, welded)
    return n[VIDX]


# ---- eyes (fitted like a MakeHuman proxy) ----------------------------------------------------------

def load_proxy(path):
    lines = open(path).read().splitlines()
    refs, scales, i = [], {}, 0
    while i < len(lines):
        l = lines[i].split()
        if l and l[0] in ('x_scale', 'y_scale', 'z_scale'):
            scales[l[0][0]] = (int(l[1]), int(l[2]), float(l[3]))
        if l and l[0] == 'verts':
            i += 1
            while i < len(lines) and lines[i].strip() and len(lines[i].split()) in (1, 9):
                p = lines[i].split()
                refs.append([int(p[0]), int(p[0]), int(p[0]), 1, 0, 0, 0, 0, 0] if len(p) == 1 else [float(x) for x in p])
                i += 1
            break
        i += 1
    return np.array(refs), scales


EYE_V, EYE_VT, EYE_F = load_obj(os.path.join(DATA, 'eyes/high-poly/high-poly.obj'))
EYE_REFS, EYE_SCALES = load_proxy(os.path.join(DATA, 'eyes/high-poly/high-poly.mhclo'))


def fit_eyes(X):
    r = EYE_REFS
    v = r[:, 0:3].astype(int)
    w = r[:, 3:6]
    off = r[:, 6:9].copy()
    for axis, k in (('x', 0), ('y', 1), ('z', 2)):
        a, b, d = EYE_SCALES[axis]
        off[:, k] *= abs(X[a, k] - X[b, k]) / d
    return (X[v] * w[:, :, None]).sum(1) + off


EYE_TRIS = triangulate([c for _, c in EYE_F])
eye_ids = {}
for t in EYE_TRIS:
    for c in t:
        eye_ids.setdefault(c, len(eye_ids))
EYE_CORNERS = list(eye_ids.keys())
EYE_VIDX = np.array([c[0] for c in EYE_CORNERS])
EYE_UVS = np.array([EYE_VT[c[1]] for c in EYE_CORNERS])
EYE_INDEX = np.array([[eye_ids[c] for c in t] for t in EYE_TRIS], dtype=np.uint32)


# ---- hair: grown from the scalp of the body mesh -----------------------------------------------------

def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def hair_mask(X, style):
    """0..1 per base vertex: where hair grows, for a style ('crop' or 'long')."""
    J = joints_of(X)
    top = J['head'][1]
    c = (J['head'][0] + top) / 2              # middle of the skull
    c = c + np.array([0, -0.15, -0.1])
    rel = X - c
    d = rel / np.maximum(np.linalg.norm(rel, axis=1, keepdims=True), 1e-9)
    f = d[:, 2]                                # +z is the face in MakeHuman
    ax = np.abs(d[:, 0])
    if style == 'crop':
        line = -0.62 + (0.52 + 0.62) * smooth(-0.35, 0.8, f)
    else:
        line = -0.95 + (0.48 + 0.95) * smooth(-0.3, 0.8, f)
    m = smooth(line - 0.08, line + 0.08, d[:, 1])
    # No hair on the ears, nor on the face.
    ear = np.exp(-(((ax - 0.95) / 0.2) ** 2 + ((d[:, 1] + 0.12) / 0.3) ** 2)) * (f > -0.35) * (f < 0.45)
    m *= 1 - smooth(0.3, 0.7, ear)
    m *= (rel[:, 1] > -1.6)                    # nothing below the jaw line
    # Only the head itself.
    m *= (np.linalg.norm(rel, axis=1) < 1.9)
    return m


def hair_geometry(X, style, m=None):
    """Triangles (game frame) of a hair shell for this shape, with uv running along the strands.
    The mask (where hair grows) comes from the base shape so every variant has the same triangles."""
    if m is None:
        m = hair_mask(X, style)
    Xg = to_game(X)
    welded = np.array([[c[0] for c in t] for t in TRIS])
    n = normals(Xg, welded)
    J = joints_of(X)
    top_y = to_game(np.array([J['head'][1]]))[0][1]
    keep = [t for t in welded if m[t].max() > 0.02]
    thick = (0.007 if style == 'crop' else 0.011) + 0.006 * smooth(top_y - 0.12, top_y, Xg[:, 1])
    if style == 'long':
        thick = thick + 0.008 * smooth(0.0, 0.25, Xg[:, 2] - to_game(np.array([J['head'][0]]))[0][2])
    P = Xg + n * (thick * m)[:, None] + n * 0.0006
    cx = to_game(np.array([J['head'][0]]))[0]
    tris = np.array(keep)
    pos = P[tris.reshape(-1)]
    # uv: around the head, and down from the crown, fixing the wrap at the back.
    rel = pos - cx
    u = (np.arctan2(rel[:, 0], -rel[:, 2]) / (2 * math.pi) + 0.5).reshape(-1, 3)
    wrap = (u.max(1) - u.min(1)) > 0.5
    u[wrap] = np.where(u[wrap] < 0.5, u[wrap] + 1, u[wrap])
    v = ((top_y - pos[:, 1]) / 0.3).reshape(-1, 3)
    uv = np.stack([u.reshape(-1), v.reshape(-1)], 1)
    return pos, uv, n[tris.reshape(-1)], m[tris.reshape(-1)]


# ---- long hair: strands grown from the scalp ---------------------------------------------------------

HAIR_STYLES = {
    # roots, length range (m), card width (m), how far roots spread down the head, segments
    'long': dict(roots=640, length=(0.4, 0.55), width=0.032, segs=12),
    'bob': dict(roots=600, length=(0.2, 0.26), width=0.032, segs=8),
    'ponytail': dict(roots=280, length=(0.3, 0.42), width=0.03, segs=10),
}


def hair_cards(X, style, seed=11):
    """Hair cards for a style on shape X (game frame). Returns positions, normals, uvs, per-vertex
    (grown, along, random), the base vertex each card grows from, and the vertex height for skinning."""
    cfg = HAIR_STYLES[style]
    rng = np.random.default_rng(seed)
    Xg = to_game(X)
    welded = np.array([[c[0] for c in t] for t in TRIS])
    Nw = normals(Xg, welded)
    J = joints_of(X)
    head = to_game(np.array([J['head'][0]]))[0]
    top = to_game(np.array([J['head'][1]]))[0]
    centre = head + (top - head) * 0.45
    body_ids = np.unique(welded)
    hip_y = to_game(np.array([J['root'][0]]))[0][1]
    near = body_ids[Xg[body_ids, 1] > hip_y + 0.15]
    BP, BN = Xg[near], Nw[near]

    def push_out(p, gap):
        # Keep a point outside the body: off the nearest surface point along its normal.
        d = np.linalg.norm(BP[None] - p[:, None], axis=2)
        k = d.argmin(1)
        off = ((p - BP[k]) * BN[k]).sum(1)
        bad = off < gap
        p[bad] += BN[k][bad] * (gap[bad] - off[bad])[:, None]
        return p

    # Roots on the scalp.
    m = hair_mask(X, 'long')
    scalp = np.where(m > 0.6)[0]
    scalp = scalp[np.isin(scalp, body_ids)]
    if style == 'ponytail':
        # Gathered at the back of the head.
        tie = centre + np.array([0, -0.02, 0.1])
        roots = tie + rng.normal(0, 0.012, (cfg['roots'], 3))
        ridx = np.array([scalp[np.argmin(np.linalg.norm(Xg[scalp] - r, axis=1))] for r in roots])
        start_dir = np.tile(np.array([0, -0.4, 1.0]), (cfg['roots'], 1))
    else:
        ridx = rng.choice(scalp, cfg['roots'], replace=len(scalp) < cfg['roots'])
        roots = Xg[ridx] + Nw[ridx] * 0.004
        out = roots - centre
        # Combed from a centre parting: away from the middle, then down.
        part = np.stack([np.sign(out[:, 0]) * (np.abs(out[:, 0]) + 0.02), np.zeros(len(out)), out[:, 2] * 0.6], 1)
        start_dir = Nw[ridx] * 0.25 + part / np.maximum(np.linalg.norm(part, axis=1, keepdims=True), 1e-6)
        # Hair at the front is swept back and to the sides, off the face.
        front = np.clip(-(roots - centre)[:, 2] / 0.08, 0, 1)
        start_dir += np.stack([np.sign(out[:, 0]) * 0.4 * front, np.zeros(len(out)), 0.9 * front], 1)
    start_dir /= np.linalg.norm(start_dir, axis=1, keepdims=True)
    n = len(roots)
    lengths = rng.uniform(*cfg['length'], n)
    segs = cfg['segs']
    layer = rng.uniform(0.003, 0.011, n)            # hair has depth: cards at different heights off the skin
    paths = np.zeros((n, segs + 1, 3))
    paths[:, 0] = roots
    d = start_dir.copy()
    face_z = head[2] - 0.03
    chin_y = head[1] - 0.06
    for k in range(1, segs + 1):
        t = k / segs
        grav = np.array([0, -1.0, 0.3])
        d = d * (0.62 - 0.3 * t) + grav * (0.38 + 0.3 * t)
        d /= np.linalg.norm(d, axis=1, keepdims=True)
        p = paths[:, k - 1] + d * (lengths / segs)[:, None]
        p = push_out(p, layer + 0.002 * k)
        # Never in front of the face; and past the shoulders, hair falls behind them.
        infront = (p[:, 2] < face_z) & (p[:, 1] > chin_y) & (np.abs(p[:, 0]) < 0.1)
        p[infront, 2] = face_z
        p[:, 0] *= np.where(p[:, 1] < chin_y, 0.97, 1.0)
        d = p - paths[:, k - 1]
        d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
        paths[:, k] = p
    # Cards: ribbons along each path, lying along the head (width across, facing out).
    pos, nrm, uv, attr, root_of, hy = [], [], [], [], [], []
    tris = []
    for i in range(n):
        P = paths[i]
        base = len(pos)
        rnd = rng.random()
        u0 = rng.integers(0, 4) / 4                    # one of four strand clumps in the texture
        for k in range(segs + 1):
            t = k / segs
            tang = P[min(k + 1, segs)] - P[max(k - 1, 0)]
            tang /= np.linalg.norm(tang) + 1e-9
            outv = P[k] - centre
            outv[1] *= 0.3
            side = np.cross(tang, outv)
            side /= np.linalg.norm(side) + 1e-9
            face = np.cross(side, tang)
            if np.dot(face, outv) < 0:
                face = -face
            w = cfg['width'] * (1.0 - 0.45 * t) * (0.8 + 0.4 * rnd)
            for sgn, uu in ((-1, 0.0), (1, 1.0)):
                pos.append(P[k] + side * w * 0.5 * sgn)
                nrm.append(face)
                uv.append([u0 + uu * 0.25, t])
                attr.append([1.0, t, rnd])
                root_of.append(ridx[i])
                hy.append(P[k][1])
        for k in range(segs):
            a = base + k * 2
            tris += [[a, a + 2, a + 1], [a + 1, a + 2, a + 3]]
    return (np.array(pos), np.array(nrm), np.array(uv), np.array(attr), np.array(root_of), np.array(hy),
            np.array(tris, dtype=np.uint32), head, to_game(np.array([J['neck01'][0]]))[0][1])


def bun_geometry(X):
    """A bun of hair at the back of the head, as a lumpy sphere (game frame)."""
    J = joints_of(X)
    head = to_game(np.array([J['head'][0]]))[0]
    top = to_game(np.array([J['head'][1]]))[0]
    back = to_game(X[np.argsort(-X[:, 1])[:1]])[0]
    c = np.array([0.0, head[1] + (top[1] - head[1]) * 0.42, head[2] + 0.085])
    rings, segs = 14, 20
    pos, uv, idx = [], [], []
    rng = np.random.default_rng(3)
    lumps = rng.random((rings + 1, segs)) * 0.004
    for i in range(rings + 1):
        th = math.pi * i / rings
        for j in range(segs + 1):
            ph = 2 * math.pi * j / segs
            r = 0.04 + lumps[i, j % segs]
            pos.append(c + np.array([r * math.sin(th) * math.cos(ph), r * math.cos(th) * 0.85, r * math.sin(th) * math.sin(ph) * 0.8]))
            uv.append([j / segs * 2, i / rings])
    for i in range(rings):
        for j in range(segs):
            a, b = i * (segs + 1) + j, i * (segs + 1) + j + 1
            c2, d = a + segs + 1, b + segs + 1
            idx += [a, c2, b, b, c2, d]
    pos, uv = np.array(pos), np.array(uv)
    tri = np.array(idx).reshape(-1, 3)
    nrm = (pos - c) / np.linalg.norm(pos - c, axis=1, keepdims=True)
    return pos[tri.reshape(-1)], uv[tri.reshape(-1)], nrm[tri.reshape(-1)]


# ---- glTF writer -------------------------------------------------------------------------------------------

class GLB:
    def __init__(self):
        self.bin = bytearray()
        self.j = {'asset': {'version': '2.0', 'generator': 'driftspace people builder'}, 'buffers': [], 'bufferViews': [], 'accessors': [],
                  'meshes': [], 'nodes': [], 'skins': [], 'scenes': [{'nodes': []}], 'scene': 0}

    def view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        off = len(self.bin)
        self.bin += data
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            v['target'] = target
        self.j['bufferViews'].append(v)
        return len(self.j['bufferViews']) - 1

    def acc(self, arr, kind, ctype, target=None, minmax=False, normalized=False):
        arr = np.ascontiguousarray(arr)
        a = {'bufferView': self.view(arr.tobytes(), target), 'componentType': ctype, 'count': int(arr.shape[0]), 'type': kind}
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'] = [float(x) for x in arr.min(0)]
            a['max'] = [float(x) for x in arr.max(0)]
        self.j['accessors'].append(a)
        return len(self.j['accessors']) - 1

    def write(self, path):
        self.j['buffers'] = [{'byteLength': len(self.bin)}]
        js = json.dumps(self.j, separators=(',', ':')).encode()
        while len(js) % 4:
            js += b' '
        while len(self.bin) % 4:
            self.bin.append(0)
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(self.bin)))
            f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
            f.write(struct.pack('<II', len(self.bin), 0x004E4942) + bytes(self.bin))


F32, U16, U8, U32 = 5126, 5123, 5121, 5125


def quant_weights(w):
    """Skin weights as bytes that still add up to exactly 255."""
    q = np.round(w / np.maximum(w.sum(1, keepdims=True), 1e-9) * 255).astype(np.int32)
    q[np.arange(len(q)), q.argmax(1)] += 255 - q.sum(1)
    return q.astype(np.uint8)
ARRAY, ELEMENTS = 34962, 34963


# ---- texture baking ------------------------------------------------------------------------------------

def rasterize(uv, tris, attrs, size=TEX):
    """Interpolate per-vertex attributes over the uv layout. Returns (filled mask, {name: image})."""
    out = {k: np.zeros((size, size) + ((a.shape[1],) if a.ndim > 1 else ()), np.float32) for k, a in attrs.items()}
    hit = np.zeros((size, size), bool)
    px = np.stack([uv[:, 0] * size, (1 - uv[:, 1]) * size], 1)
    for t in tris:
        p = px[t]
        x0, y0 = np.floor(p.min(0)).astype(int)
        x1, y1 = np.ceil(p.max(0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, size - 1), min(y1, size - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = p
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12:
            continue
        w0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
        w1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
        w2 = 1 - w0 - w1
        inside = (w0 >= -0.02) & (w1 >= -0.02) & (w2 >= -0.02)
        if not inside.any():
            continue
        yy, xx = ys[inside].astype(int), xs[inside].astype(int)
        hit[yy, xx] = True
        for k, a in attrs.items():
            va = a[t]
            if a.ndim > 1:
                out[k][yy, xx] = (w0[inside][:, None] * va[0] + w1[inside][:, None] * va[1] + w2[inside][:, None] * va[2])
            else:
                out[k][yy, xx] = w0[inside] * va[0] + w1[inside] * va[1] + w2[inside] * va[2]
    return hit, out


def dilate(img, hit, steps=6):
    img, hit = img.copy(), hit.copy()
    for _ in range(steps):
        grow = np.zeros_like(img)
        cnt = np.zeros(hit.shape, np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sh = np.roll(np.roll(hit, dy, 0), dx, 1)
            si = np.roll(np.roll(img, dy, 0), dx, 1)
            add = sh & ~hit
            grow[add] += si[add]
            cnt[add] += 1
        new = cnt > 0
        img[new] = grow[new] / cnt[new][:, None] if img.ndim == 3 else grow[new] / cnt[new]
        hit |= new
    return img


def save(img, path):
    Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(path, optimize=True)


# ---- build ---------------------------------------------------------------------------------------------

def main():
    global FLOOR
    os.makedirs(OUT, exist_ok=True)
    base_m = shape('male')
    FLOOR = base_m[np.unique(np.array(BODY_V))][:, 1].min()
    glb = GLB()
    names = ['muscle', 'heavy', 'thin', 'old', 'african', 'asian', 'caucasian', 'elf', 'covered']
    for sex in ('male', 'female'):
        base = shape(sex)
        variants = {
            'muscle': shape(sex, muscle='max'), 'heavy': shape(sex, weight='max'), 'thin': shape(sex, weight='min'),
            'old': shape(sex, age='old'), 'african': shape(sex, eth='african'), 'asian': shape(sex, eth='asian'),
            'caucasian': shape(sex, eth='caucasian'),
            'elf': shape(sex, extra=[('ears/l-ear-shape-pointed.target', 1), ('ears/r-ear-shape-pointed.target', 1),
                                     ('ears/l-ear-scale-vert-incr.target', 0.6), ('ears/r-ear-scale-vert-incr.target', 0.6)]),
            # Under clothes: a smooth chest (no nipples; for women a firm, supported shape).
            'covered': shape(sex, extra=[('breast/nipple-point-decr.target', 1), ('breast/nipple-size-decr.target', 1)]
                             + ([('breast/female-young-averagemuscle-averageweight-averagecup-maxfirmness.target', 0.8)] if sex == 'female' else [])),
        }
        # Skeleton (bone heads in the game frame), parents first.
        J = joints_of(base)
        order = [b for b in KEEP]
        heads = {b: to_game(np.array([J[b][0]]))[0] for b in order}
        tails = {b: to_game(np.array([J[b][1]]))[0] for b in order}
        node0 = len(glb.j['nodes'])
        for b in order:
            p = kept_parent(b) if b != 'root' else None
            t = heads[b] - (heads[p] if p else 0)
            glb.j['nodes'].append({'name': f"{sex}_{b.replace('.', '_').replace('-', '_')}", 'translation': [float(x) for x in t], 'extras': {'tail': [float(x) for x in tails[b] - heads[b]]}})
        for b in order:
            p = kept_parent(b) if b != 'root' else None
            if p:
                glb.j['nodes'][node0 + order.index(p)].setdefault('children', []).append(node0 + order.index(b))
        ibm = np.zeros((len(order), 16), np.float32)
        for i, b in enumerate(order):
            m = np.eye(4, dtype=np.float32)
            m[:3, 3] = -heads[b]
            ibm[i] = m.T.reshape(-1)
        skin = {'joints': list(range(node0, node0 + len(order))), 'inverseBindMatrices': glb.acc(ibm, 'MAT4', F32), 'skeleton': node0}
        glb.j['skins'].append(skin)
        skin_i = len(glb.j['skins']) - 1

        # Skin weights per base vertex, on the kept bones, four strongest.
        nb = len(V0)
        wsum = {}
        for bone, pairs in WEIGHTS.items():
            if bone not in SKEL['bones']:
                continue
            kb = order.index(kept(bone))
            for vi, w in pairs:
                wsum.setdefault(vi, {})
                wsum[vi][kb] = wsum[vi].get(kb, 0) + w
        JI = np.zeros((nb, 4), np.uint16)
        JW = np.zeros((nb, 4), np.float32)
        for vi, d in wsum.items():
            top = sorted(d.items(), key=lambda kv: -kv[1])[:4]
            s = sum(w for _, w in top) or 1
            for k, (bi, w) in enumerate(top):
                JI[vi, k], JW[vi, k] = bi, w / s
        JW[JW.sum(1) == 0, 0] = 1

        def mesh_prims(P, N, UV, idx, joints, weights, morphs):
            attrs = {'POSITION': glb.acc(P.astype(np.float32), 'VEC3', F32, ARRAY, True), 'NORMAL': glb.acc(N.astype(np.float32), 'VEC3', F32, ARRAY),
                     'TEXCOORD_0': glb.acc(UV.astype(np.float32), 'VEC2', F32, ARRAY), 'JOINTS_0': glb.acc(joints.astype(np.uint8), 'VEC4', U8, ARRAY),
                     'WEIGHTS_0': glb.acc(quant_weights(weights), 'VEC4', U8, ARRAY, normalized=True)}
            prim = {'attributes': attrs, 'indices': glb.acc(idx.reshape(-1).astype(np.uint32), 'SCALAR', U32, ELEMENTS)}
            if morphs:
                # Positions only: the normals barely change, and leaving them out halves the file.
                prim['targets'] = [{'POSITION': glb.acc(dp.astype(np.float32), 'VEC3', F32, ARRAY, True)} for dp, dn in morphs]
            return prim

        def add_mesh(name, prim, morph_names):
            glb.j['meshes'].append({'name': name, 'primitives': [prim], 'extras': {'targetNames': morph_names} if morph_names else {}})
            glb.j['nodes'].append({'name': name, 'mesh': len(glb.j['meshes']) - 1, 'skin': skin_i})
            glb.j['scenes'][0]['nodes'].append(len(glb.j['nodes']) - 1)

        # Body.
        Pb = to_game(base)[VIDX]
        Nb = body_normals(to_game(base))
        UVg = np.stack([UVS[:, 0], 1 - UVS[:, 1]], 1)
        morphs = []
        for n in names:
            Pv = to_game(variants[n])
            morphs.append((Pv[VIDX] - Pb, body_normals(Pv) - Nb))
        add_mesh(f'{sex}_body', mesh_prims(Pb, Nb, UVg, INDEX, JI[VIDX], JW[VIDX], morphs), names)
        glb.j['scenes'][0]['nodes'].append(node0)

        # Eyes, on the head bone.
        head_i = order.index('head')
        Pe = to_game(fit_eyes(base))[EYE_VIDX]
        Ne = normals(to_game(fit_eyes(base)), np.array([[c[0] for c in t] for t in EYE_TRIS]))[EYE_VIDX]
        UVe = np.stack([EYE_UVS[:, 0], 1 - EYE_UVS[:, 1]], 1)
        ne = len(Pe)
        ej = np.zeros((ne, 4), np.uint16); ej[:, 0] = head_i
        ew = np.zeros((ne, 4), np.float32); ew[:, 0] = 1
        emorph = []
        for n in names:
            Pv = to_game(fit_eyes(variants[n]))[EYE_VIDX]
            emorph.append((Pv - Pe, np.zeros_like(Pv)))
        add_mesh(f'{sex}_eyes', mesh_prims(Pe, Ne, UVe, EYE_INDEX, ej, ew, emorph), names)

        # Hair styles, rigid on the head.
        for style in ('crop', 'long'):
            hmask = hair_mask(base, style)
            Ph, UVh, Nh, Mh = hair_geometry(base, style, hmask)
            idx = np.arange(len(Ph), dtype=np.uint32).reshape(-1, 3)
            nh = len(Ph)
            hj = np.zeros((nh, 4), np.uint16); hj[:, 0] = head_i
            hw = np.zeros((nh, 4), np.float32); hw[:, 0] = 1
            hm = []
            for n in names:
                Pv, _, _, _ = hair_geometry(variants[n], style, hmask)
                hm.append((Pv - Ph, np.zeros_like(Pv)))
            prim = mesh_prims(Ph, Nh, UVh, idx, hj, hw, hm)
            # How much hair grows at each vertex, so the hairline can fade out softly.
            prim['attributes']['COLOR_0'] = glb.acc(np.repeat(Mh[:, None], 3, 1).astype(np.float32), 'VEC3', F32, ARRAY)
            add_mesh(f'{sex}_hair_{style}', prim, names)
        # Long flowing styles: cards grown from the scalp. Up near the head they move with it;
        # where they lie on the shoulders and back they follow the upper spine instead.
        spine_i = order.index('spine02')
        for style in HAIR_STYLES:
            P, Nh, UVh, A, rid, hy, tri, headp, neck_y = hair_cards(base, style)
            nv = len(P)
            hj = np.zeros((nv, 4), np.uint16); hj[:, 0] = head_i; hj[:, 1] = spine_i
            wb = smooth(neck_y + 0.02, neck_y - 0.12, hy)
            hw = np.zeros((nv, 4), np.float32); hw[:, 0] = 1 - wb; hw[:, 1] = wb
            # (No morphs: head shapes differ too little to matter for hair, and they would triple the file.)
            prim = mesh_prims(P, Nh, UVh, tri, hj, hw, [])
            prim['attributes']['COLOR_0'] = glb.acc(A.astype(np.float32), 'VEC3', F32, ARRAY)
            add_mesh(f'{sex}_hair_{style}_cards', prim, [])
        Pbun, UVbun, Nbun = bun_geometry(base)
        idx = np.arange(len(Pbun), dtype=np.uint32).reshape(-1, 3)
        nbun = len(Pbun)
        bj = np.zeros((nbun, 4), np.uint16); bj[:, 0] = head_i
        bw = np.zeros((nbun, 4), np.float32); bw[:, 0] = 1
        add_mesh(f'{sex}_hair_bun', mesh_prims(Pbun, Nbun, UVbun, idx, bj, bw, []), [])
        print(sex, 'body verts', len(Pb), 'eyes', ne, 'bones', len(order))

    glb.write(os.path.join(OUT, 'people.glb'))
    print('people.glb', os.path.getsize(os.path.join(OUT, 'people.glb')) // 1024, 'KB')
    bake(base_m)


# ---- the baked textures -----------------------------------------------------------------------------

def bake(X):
    J = joints_of(X)
    G = to_game(X)
    Jg = {b: (to_game(np.array([h]))[0], to_game(np.array([t]))[0]) for b, (h, t) in J.items()}
    welded = np.array([[c[0] for c in t] for t in TRIS])
    Nw = normals(G, welded)
    # Per base vertex: the dominant kept bone.
    dom = np.full(len(V0), -1)
    best = np.zeros(len(V0))
    for bone, pairs in WEIGHTS.items():
        if bone not in SKEL['bones']:
            continue
        kb = kept(bone)
        for vi, w in pairs:
            if w > best[vi]:
                best[vi], dom[vi] = w, KEEP.index(kb)
    names = [KEEP[i] if i >= 0 else '' for i in dom]

    def along(p, a, b):
        ab = b - a
        return np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)

    # Position along the arm (shoulder 0, wrist 0.8, fingertips 1) and along the leg (hip 0, ankle 0.85, toes 1).
    armT = np.zeros(len(V0)); legT = np.zeros(len(V0)); part = np.zeros(len(V0))
    for i, n in enumerate(names):
        if not n:
            continue
        if any(k in n for k in ('clavicle', 'upperarm', 'lowerarm', 'wrist', 'finger')):
            s = 'L' if n.endswith('.L') else 'R'
            sh, wr = Jg[f'upperarm01.{s}'][0], Jg[f'wrist.{s}'][0]
            tip = Jg[f'finger3-3.{s}'][1]
            t = along(G[i], sh, wr) * 0.8
            if 'wrist' in n or 'finger' in n:
                t = 0.8 + along(G[i], wr, tip) * 0.2
            if 'clavicle' in n:
                t = 0.0
            armT[i], part[i] = t, 0.66
        elif any(k in n for k in ('upperleg', 'lowerleg', 'foot')):
            s = 'L' if n.endswith('.L') else 'R'
            hip, ank = Jg[f'upperleg01.{s}'][0], Jg[f'foot.{s}'][0]
            t = along(G[i], hip, ank) * 0.85
            if 'foot' in n:
                t = 0.85 + 0.15 * smooth(ank[1], ank[1] - 0.06, G[i][1])
            legT[i], part[i] = t, 1.0
        elif n == 'head':
            part[i] = 0.0
        elif n == 'neck01':
            part[i] = 0.33     # the neck counts as torso; the shader cuts a smooth neckline by height
        else:
            part[i] = 0.33
    attrs = {'pos': G[VIDX], 'nrm': Nw[VIDX], 'arm': armT[VIDX], 'leg': legT[VIDX], 'part': part[VIDX]}
    hit, R = rasterize(UVS, INDEX, attrs)
    P, N = R['pos'], R['nrm']
    height = P[..., 1] / 1.75

    regions = np.stack([R['arm'], R['leg'], np.clip(height, 0, 1), R['part']], -1)
    save(dilate(regions, hit), os.path.join(OUT, 'people-regions.png'))

    # Flight suit details, measured on the body.
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    ax = np.abs(x)
    hip = Jg['root'][0][1]
    chest = Jg['spine01'][0][1]
    neck = Jg['neck01'][0][1]
    torso = (R['part'] > 0.2) & (R['part'] < 0.45)
    band = lambda v, c, w, soft=0.003: smooth(w / 2 + soft, w / 2 - soft, np.abs(v - c))
    straps = np.maximum(band(ax, 0.075, 0.036) * torso * (y > hip + 0.08) * (y < neck + 0.05),
                        band(y, chest - 0.08, 0.03) * torso * (ax < 0.09) * (z < 0))
    belt = band(y, hip + 0.1, 0.045) * torso
    straps = np.maximum(straps, belt)
    buckle = (band(y, hip + 0.1, 0.04) * band(x, 0, 0.055) * (z < 0) + band(y, chest - 0.08, 0.035) * band(x, 0, 0.045) * (z < 0)) * torso
    zipper = band(x, 0, 0.006, 0.001) * torso * (z < 0) * (y > hip + 0.12) * (y < neck + 0.06)
    seams = np.maximum(band(np.abs(R['nrm'][..., 0]), 1.0, 0.18, 0.02) * torso * 0.6, band(R['arm'], 0.06, 0.01, 0.003) * (R['part'] > 0.5) * (R['part'] < 0.8))
    knee = band(R['leg'], 0.5, 0.09, 0.008) * (N[..., 2] < -0.3) * (R['part'] > 0.9)
    pocket = band(R['leg'], 0.27, 0.13, 0.006) * (np.abs(N[..., 0]) > 0.55) * (R['part'] > 0.9)
    pocket_edge = np.clip(pocket - band(R['leg'], 0.27, 0.11, 0.004) * (np.abs(N[..., 0]) > 0.62), 0, 1)
    detail = np.stack([straps, np.maximum(buckle, zipper), np.maximum(seams, pocket_edge), knee], -1)
    save(dilate(detail, hit), os.path.join(OUT, 'people-detail.png'))

    # Face: lips, brows with strokes, lash line, beard shadow, measured from the facial joints.
    eyeL, eyeR = Jg['eye.L'][0], Jg['eye.R'][0]
    mouth = (Jg['oris05'][0] + Jg['oris06'][0]) / 2
    face = (R['part'] < 0.1) & (N[..., 2] < 0.2)
    rng = np.random.default_rng(7)
    strokes = np.array(Image.fromarray((rng.random((512, 64)) * 255).astype(np.uint8)).resize((TEX, TEX), Image.BILINEAR)) / 255
    lips = smooth(0.022, 0.014, np.hypot((x - mouth[0]) * 0.9, (y - mouth[1] + 0.001) * 2.6)) * face * (z < mouth[2] + 0.01)
    brow = np.zeros_like(x)
    lash = np.zeros_like(x)
    for e in (eyeL, eyeR):
        dx = (x - e[0]) * np.sign(e[0])            # outward from the nose
        arc = e[1] + 0.017 + 0.004 * np.cos(np.clip(dx / 0.03, -1.5, 1.5)) - 0.002 * (dx > 0.02)
        thick = 0.0055 - 0.003 * smooth(-0.01, 0.03, dx)
        b = smooth(thick, thick * 0.2, np.abs(y - arc)) * smooth(-0.024, -0.01, dx) * smooth(0.038, 0.02, dx)
        brow = np.maximum(brow, b * (0.45 + 0.55 * strokes))
        r = np.hypot((x - e[0]) / 1.0, (y - e[1]) / 0.62)
        lash = np.maximum(lash, smooth(0.0175, 0.0145, r) * smooth(0.009, 0.0125, r) * (z < e[2] - 0.006))
    brow *= face
    lash *= face
    beard = smooth(mouth[1] + 0.02, mouth[1] - 0.005, y) * face * smooth(0.0, 0.03, np.hypot(x - mouth[0], (y - mouth[1]) * 1.5) - 0.015) * (y > Jg['neck01'][0][1] + 0.02)
    faceimg = np.stack([lips, brow, lash, beard], -1)
    save(dilate(faceimg, hit), os.path.join(OUT, 'people-face.png'))

    # Skin: where blood shows (cheeks, nose, ears, lips' surroundings, knuckles), darker creases
    # (knuckles, elbows, knees, under the eyes, around the nostrils), freckles, and mottling.
    head = R['part'] < 0.1
    nose = Jg['special04'][0] if 'special04' in Jg else mouth
    nose_tip = np.array([0.0, (eyeL[1] + mouth[1]) / 2 - 0.004, min(eyeL[2], mouth[2]) - 0.03])
    flush = np.zeros_like(x)
    for e in (eyeL, eyeR):
        cheek = np.array([e[0] * 1.35, e[1] - 0.035, e[2] + 0.01])
        flush = np.maximum(flush, np.exp(-(((x - cheek[0]) / 0.022) ** 2 + ((y - cheek[1]) / 0.02) ** 2)) * (z < cheek[2] + 0.02))
    flush = np.maximum(flush, np.exp(-((x / 0.012) ** 2 + ((y - nose_tip[1]) / 0.014) ** 2)) * (z < nose_tip[2] + 0.025))
    ear = head * (np.abs(x) > 0.062) * (np.abs(y - eyeL[1] + 0.01) < 0.035) * (z > eyeL[2] + 0.04)
    flush = np.maximum(flush, ear * 0.8)
    flush = np.maximum(flush, smooth(0.035, 0.02, np.hypot(x - mouth[0], (y - mouth[1]) * 1.3)) * head * 0.35)
    hands = (R['part'] > 0.5) & (R['part'] < 0.8)
    knuckles = hands * smooth(0.84, 0.9, R['arm']) * (1 - smooth(0.95, 1.0, R['arm']))
    flush = np.maximum(flush, knuckles * 0.6) * (head | hands)
    legs = R['part'] > 0.9
    elbow = hands * np.exp(-((R['arm'] - 0.4) / 0.025) ** 2) * (N[..., 2] > 0.3)
    knee = legs * np.exp(-((R['leg'] - 0.5) / 0.03) ** 2) * (N[..., 2] < -0.3)
    undereye = np.zeros_like(x)
    for e in (eyeL, eyeR):
        undereye = np.maximum(undereye, np.exp(-(((x - e[0]) / 0.016) ** 2 + ((y - e[1] + 0.017) / 0.006) ** 2)) * (z < e[2] + 0.01))
    creases = np.clip(np.maximum.reduce([knuckles * 0.7, elbow, knee * 0.8, undereye * head]), 0, 1)
    # Freckles: small spots, thickest across the nose and cheeks and on the shoulders.
    spots = rng.random((TEX // 4, TEX // 4)) > 0.86
    spots = np.array(Image.fromarray((spots * 255).astype(np.uint8)).resize((TEX, TEX), Image.BILINEAR)) / 255
    fzone = np.maximum(np.exp(-((x / 0.05) ** 2 + ((y - eyeL[1] + 0.03) / 0.03) ** 2)) * head * (z < eyeL[2] + 0.02),
                       ((R['part'] > 0.2) & (R['part'] < 0.7)) * smooth(Jg['spine01'][0][1] - 0.15, Jg['spine01'][0][1], y) * 0.6)
    freckles = spots * fzone
    mottle = np.array(Image.fromarray((rng.random((48, 48)) * 255).astype(np.uint8)).resize((TEX, TEX), Image.BICUBIC)) / 255
    skin = np.stack([flush, creases, freckles, mottle], -1)
    save(dilate(skin, hit), os.path.join(OUT, 'people-skin.png'))

    # The eye: luminance plus an iris mask, so the shader can color irises per person.
    eyeA = np.asarray(Image.open(os.path.join(DATA, 'eyes/materials/brown_eye.png')).convert('RGBA'), np.float32) / 255
    eye, alpha = eyeA[..., :3], eyeA[..., 3]
    mx, mn = eye.max(-1), eye.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    iris = smooth(0.18, 0.35, sat) * (mx < 0.95)
    lum = eye @ np.array([0.3, 0.59, 0.11])
    out = np.stack([lum, iris, lum, alpha], -1)     # alpha: the cornea layer is see-through
    save(out, os.path.join(OUT, 'people-eye.png'))
    print('textures written')


BODY_V = [c[0] for f in BODY for c in f]

if __name__ == '__main__':
    main()
