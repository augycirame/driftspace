#!/usr/bin/env python3
"""Retarget motion-captured Mixamo clips onto the game's people skeleton.

Reads Mixamo-rigged glTF files (for example three.js's example models Xbot.glb, with idle,
walk, run, agree, headShake, sneak_pose and sad_pose, and Michelle.glb's samba), and our
client/models/people.glb, and writes client/models/people-anims.json: for each clip and each
body (male, female), a rotation track per bone, sampled at 30 fps, plus the hips' height.

How: each Mixamo bone's world rotation is taken relative to its rest pose and applied to our
bone, after first turning our bone (which rests in an A pose, forearms forward) to lie along the
Mixamo bone's rest direction (a T pose). Our bones have no rest rotation, so a local rotation is
just the parent's world rotation undone.

  python3 tools/people/anims.py client/models/people.glb client/models/people-anims.json Xbot.glb Michelle.glb
"""

import json
import struct
import sys

import numpy as np

FPS = 30


def read_glb(path):
    b = open(path, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    off = 20 + jl + 8
    return j, b[off:]


def accessor(j, binb, i):
    a = j['accessors'][i]
    v = j['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}[a['componentType']]
    start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = v.get('byteStride', 0)
    if stride and stride != n * np.dtype(dt).itemsize:
        raw = np.frombuffer(binb, np.uint8, count=stride * a['count'], offset=start).reshape(a['count'], stride)
        return raw[:, :n * np.dtype(dt).itemsize].copy().view(dt).reshape(a['count'], n).astype(np.float64)
    return np.frombuffer(binb, dt, count=a['count'] * n, offset=start).reshape(a['count'], n).astype(np.float64)


# ---- quaternions (x, y, z, w) -----------------------------------------------------------------------------

def qmul(a, b):
    ax, ay, az, aw = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    bx, by, bz, bw = b[..., 0], b[..., 1], b[..., 2], b[..., 3]
    return np.stack([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz], -1)


def qinv(q):
    return q * np.array([-1, -1, -1, 1.0])


def qrot(q, v):
    p = np.concatenate([v, np.zeros(v.shape[:-1] + (1,))], -1)
    return qmul(qmul(q, p), qinv(q))[..., :3]


def qfrom(a, b):
    """Shortest rotation taking direction a to direction b."""
    a, b = a / np.linalg.norm(a), b / np.linalg.norm(b)
    d = float(np.dot(a, b))
    if d < -0.999999:
        axis = np.cross([1, 0, 0], a)
        if np.linalg.norm(axis) < 1e-6:
            axis = np.cross([0, 1, 0], a)
        axis /= np.linalg.norm(axis)
        return np.array([*axis, 0.0])
    c = np.cross(a, b)
    q = np.array([c[0], c[1], c[2], 1 + d])
    return q / np.linalg.norm(q)


def slerp(a, b, t):
    d = np.sum(a * b, -1, keepdims=True)
    b = np.where(d < 0, -b, b)
    d = np.abs(d)
    out = a * (1 - t) + b * t        # nlerp is plenty at 30 fps
    return out / np.linalg.norm(out, axis=-1, keepdims=True)


R = np.array([0, 1, 0, 0.0])         # half a turn about y: Mixamo faces +z, the game faces -z


def to_game_q(q):
    return qmul(qmul(R, q), qinv(R))


def to_game_v(v):
    return v * np.array([-1, 1, -1.0])


# ---- the source rig -------------------------------------------------------------------------------------------

class Rig:
    def __init__(self, path):
        self.j, self.bin = read_glb(path)
        self.nodes = self.j['nodes']
        self.parent = {}
        for i, n in enumerate(self.nodes):
            for c in n.get('children', []):
                self.parent[c] = i
        self.byname = {}
        for i, n in enumerate(self.nodes):
            name = n.get('name', '')
            short = name.split(':')[-1].replace('mixamorig', '')
            self.byname[short] = i

    def rest(self, i):
        n = self.nodes[i]
        return (np.array(n.get('translation', [0, 0, 0]), float), np.array(n.get('rotation', [0, 0, 0, 1]), float),
                np.array(n.get('scale', [1, 1, 1]), float))

    def sample(self, anim, frames, fps=FPS):
        """Local (t, r, s) per node per frame."""
        times = np.arange(frames) / fps
        local = {i: [np.repeat(x[None], frames, 0) for x in self.rest(i)] for i in range(len(self.nodes))}
        for ch in anim['channels']:
            node, path = ch['target']['node'], ch['target']['path']
            s = anim['samplers'][ch['sampler']]
            t = accessor(self.j, self.bin, s['input'])[:, 0]
            v = accessor(self.j, self.bin, s['output'])
            if s.get('interpolation') == 'CUBICSPLINE':
                v = v[1::3]
            k = np.clip(np.searchsorted(t, times) - 1, 0, len(t) - 2) if len(t) > 1 else np.zeros(frames, int)
            if len(t) > 1:
                f = np.clip((times - t[k]) / np.maximum(t[k + 1] - t[k], 1e-9), 0, 1)[:, None]
                if s.get('interpolation') == 'STEP':
                    f = np.zeros_like(f)
                a, b = v[k], v[k + 1]
                val = slerp(a, b, f) if path == 'rotation' else a * (1 - f) + b * f
            else:
                val = np.repeat(v[:1], frames, 0)
            slot = {'translation': 0, 'rotation': 1, 'scale': 2}.get(path)
            if slot is not None:
                local[node][slot] = val
        return local

    def world(self, local, i, frames, cache):
        """World rotation and position of node i per frame."""
        if i in cache:
            return cache[i]
        t, r, s = local[i]
        if i in self.parent:
            pq, pp, ps = self.world(local, self.parent[i], frames, cache)
            q = qmul(pq, r)
            p = pp + qrot(pq, t * ps)
            sc = ps * s
        else:
            q, p, sc = r, t * 1.0, s
        cache[i] = (q, p, sc)
        return cache[i]


# ---- our skeleton ------------------------------------------------------------------------------------------------

def our_skeleton(path, sex):
    j, _ = read_glb(path)
    nodes = j['nodes']
    pre = sex + '_'
    idx = {n['name'][len(pre):]: i for i, n in enumerate(nodes) if n.get('name', '').startswith(pre) and 'mesh' not in n}
    parent = {}
    for name, i in idx.items():
        for c in nodes[i].get('children', []):
            for nm, ci in idx.items():
                if ci == c:
                    parent[nm] = name
    pos = {}

    def p(name):
        if name in pos:
            return pos[name]
        t = np.array(nodes[idx[name]].get('translation', [0, 0, 0]), float)
        pos[name] = t + (p(parent[name]) if name in parent else 0)
        return pos[name]
    for nm in idx:
        p(nm)
    tail = {nm: np.array(nodes[idx[nm]].get('extras', {}).get('tail', [0, 0.1, 0]), float) for nm in idx}
    order = sorted(idx, key=lambda n: idx[n])
    return order, parent, pos, tail


MAP = {'root': 'Hips', 'spine04': 'Spine', 'spine03': 'Spine1', 'spine02': 'Spine2', 'neck01': 'Neck', 'head': 'Head'}
CHILD = {'spine04': ('spine03', 'Spine1'), 'spine03': ('spine02', 'Spine2'), 'spine02': ('neck01', 'Neck'), 'neck01': ('head', 'Head'),
         'head': (None, 'HeadTop_End')}
FING = {1: 'Thumb', 2: 'Index', 3: 'Middle', 4: 'Ring', 5: 'Pinky'}
for s, side in (('L', 'Left'), ('R', 'Right')):
    MAP.update({f'clavicle_{s}': f'{side}Shoulder', f'upperarm01_{s}': f'{side}Arm', f'lowerarm01_{s}': f'{side}ForeArm', f'wrist_{s}': f'{side}Hand',
                f'upperleg01_{s}': f'{side}UpLeg', f'lowerleg01_{s}': f'{side}Leg', f'foot_{s}': f'{side}Foot'})
    CHILD.update({f'clavicle_{s}': (f'upperarm01_{s}', f'{side}Arm'), f'upperarm01_{s}': (f'lowerarm01_{s}', f'{side}ForeArm'),
                  f'lowerarm01_{s}': (f'wrist_{s}', f'{side}Hand'), f'wrist_{s}': (f'finger3_1_{s}', f'{side}HandMiddle1'),
                  f'upperleg01_{s}': (f'lowerleg01_{s}', f'{side}Leg'), f'lowerleg01_{s}': (f'foot_{s}', f'{side}Foot'),
                  f'foot_{s}': (None, f'{side}ToeBase')})
    for f, fn in FING.items():
        for k in (1, 2, 3):
            MAP[f'finger{f}_{k}_{s}'] = f'{side}Hand{fn}{k}'
            CHILD[f'finger{f}_{k}_{s}'] = ((f'finger{f}_{k + 1}_{s}' if k < 3 else None), f'{side}Hand{fn}{k + 1}')


def retarget(rig, anim, sk, frames, fps=FPS):
    order, parent, pos, tail = sk
    local = rig.sample(anim, frames, fps)
    cache, rest_cache = {}, {}
    rest_local = {i: [x[None] for x in rig.rest(i)] for i in range(len(rig.nodes))}
    out = {}
    world_ours = {}
    hips = rig.byname.get('Hips')
    hq, hp, _ = rig.world(local, hips, frames, cache)
    _, hp0, hs0 = rig.world(rest_local, hips, 1, rest_cache)
    for name in order:
        src = MAP.get(name)
        par = parent.get(name)
        pw = world_ours[par] if par else np.tile(np.array([0, 0, 0, 1.0]), (frames, 1))
        if src and src in rig.byname:
            i = rig.byname[src]
            q, _, _ = rig.world(local, i, frames, cache)
            q0, p0, _ = rig.world(rest_local, i, 1, rest_cache)
            delta = to_game_q(qmul(q, qinv(q0)))               # world change from the rest pose
            c = np.array([0, 0, 0, 1.0])
            child = CHILD.get(name)
            if child and child[1] in rig.byname:
                _, pc, _ = rig.world(rest_local, rig.byname[child[1]], 1, rest_cache)
                src_dir = to_game_v((pc - p0)[0])
                ours = (pos[child[0]] - pos[name]) if child[0] else tail[name]
                if np.linalg.norm(src_dir) > 1e-6 and np.linalg.norm(ours) > 1e-6:
                    c = qfrom(ours, src_dir)
            w = qmul(delta, np.broadcast_to(c, delta.shape))
        else:
            w = pw.copy()
        world_ours[name] = w
        out[name] = qmul(qinv(pw), w)
    # The hips' height above their rest (scaled to our height); the rest of root motion is dropped.
    scale = pos['root'][1] / max(1e-6, (hp0[0][1]))
    hipsY = (hp[:, 1] - hp0[0][1]) * scale
    return out, hipsY


def main():
    people, outp, srcs = sys.argv[1], sys.argv[2], sys.argv[3:]
    skel = {sex: our_skeleton(people, sex) for sex in ('male', 'female')}
    clips = {}
    for path in srcs:
        rig = Rig(path)
        for anim in rig.j.get('animations', []):
            name = anim['name']
            if name.lower() == 'tpose':
                continue
            dur = max(accessor(rig.j, rig.bin, s['input'])[-1, 0] for s in anim['samplers'])
            fps = FPS if dur < 6 else 15          # long clips (dances) at a lower rate keep the file small
            frames = max(2, int(round(dur * fps)) + 1)
            clip = {'frames': frames, 'fps': fps, 'bodies': {}}
            for sex, sk in skel.items():
                tracks, hipsY = retarget(rig, anim, sk, frames, fps)
                clip['bodies'][sex] = {'hipsY': [round(float(v), 4) for v in hipsY],
                                       'bones': {b: [round(float(v), 3) for v in q.reshape(-1)] for b, q in tracks.items() if b in MAP}}
            key = name[0].lower() + name[1:]
            clips[key] = clip
            print(path.split('/')[-1], key, frames, 'frames')
    json.dump({'fps': FPS, 'clips': clips}, open(outp, 'w'), separators=(',', ':'))
    import os
    print(outp, os.path.getsize(outp) // 1024, 'KB')


if __name__ == '__main__':
    main()
