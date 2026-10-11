"""
The Kestrel's pilot: a flight-suited figure modelled in the seated pose with both hands on the
controls, skinned to a small armature so the game can move the arms with IK.

Imported by build_ship.py. Blender axes: X right, Y forward (nose), Z up. Units: metres.
"""
import math

import bpy  # noqa: E402  (must be imported before bmesh)
import bmesh
from mathutils import Quaternion, Vector

V = Vector

# ---------------------------------------------------------------- controls (also used by build_ship.py)
EYE = V((0.0, 1.57, 1.52))
GRIP_TILT = math.radians(12)  # the grips lean forward
GRIP_UP = V((0, math.sin(GRIP_TILT), math.cos(GRIP_TILT)))
GRIP_FWD = V((0, math.cos(GRIP_TILT), -math.sin(GRIP_TILT)))
GRIP_R = 0.021
# centre of each hand's hold: right = flight stick, left = throttle
GRIP = {1: V((0.30, 2.057, 1.25)), -1: V((-0.30, 2.057, 1.25))}
STICK_PIVOT = GRIP[1] - GRIP_UP * 0.13
THROTTLE_PIVOT = GRIP[-1] - GRIP_UP * 0.19
# the grip spans these offsets along GRIP_UP from its centre
GRIP_BOTTOM, GRIP_TOP = -0.066, 0.058

# ---------------------------------------------------------------- skeleton (seated rest pose)
PELVIS = V((0, 1.52, 0.80))
SPINE = V((0, 1.49, 0.97))
CHEST = V((0, 1.475, 1.14))
NECK = V((0, 1.48, 1.355))
HEAD = V((0, 1.50, 1.46))
HEAD_TOP = V((0, 1.49, 1.68))
HELMET_C = V((0, 1.497, 1.556))
UPPER_ARM, FORE_ARM = 0.31, 0.27


def shoulder(s):
    return V((s * 0.185, 1.50, 1.305))


def hip(s):
    return V((s * 0.095, 1.53, 0.79))


def knee(s):
    return V((s * 0.13, 1.985, 0.865))


def ankle(s):
    return V((s * 0.145, 2.255, 0.50))


def toe(s):
    return V((s * 0.15, 2.45, 0.44))


def grip_point(s, x, y, z):
    """Hand-local point -> world. x points away from the body (mirrored for the left hand), y forward, z up the grip."""
    return GRIP[s] + V((s * x, 0, 0)) + GRIP_FWD * y + GRIP_UP * z


# the hand is modelled with the palm on the outer side of the grip, then turned so the palm wraps
# the back of the grip and the wrist comes in from behind, toward the body
HAND_YAW = math.radians(-38)
WRIST_LOCAL = (0.035, -0.074, -0.006)
KNUCKLE_LOCAL = (0.031, 0.004, 0.004)


def hand_point(s, x, y, z):
    c, sn = math.cos(HAND_YAW), math.sin(HAND_YAW)
    return grip_point(s, x * c - y * sn, x * sn + y * c, z)


def wrist(s):
    return hand_point(s, *WRIST_LOCAL)


def elbow(s):
    """Two-bone IK for the rest pose; the elbow hangs down and out."""
    sh, wr = shoulder(s), wrist(s)
    d = wr - sh
    dist = d.length
    dn = d.normalized()
    cos_a = (UPPER_ARM ** 2 + dist ** 2 - FORE_ARM ** 2) / (2 * UPPER_ARM * dist)
    cos_a = max(-1.0, min(1.0, cos_a))
    pole = V((s * 0.55, -0.1, -1.0))
    pn = (pole - dn * pole.dot(dn)).normalized()
    return sh + dn * (UPPER_ARM * cos_a) + pn * (UPPER_ARM * math.sqrt(1 - cos_a ** 2))


BONES = []  # (name, head, tail, parent)


def define_bones():
    BONES.clear()
    BONES.extend([
        ('Hips', PELVIS, SPINE, None),
        ('Spine', SPINE, CHEST, 'Hips'),
        ('Chest', CHEST, NECK, 'Spine'),
        ('Neck', NECK, HEAD, 'Chest'),
        ('Head', HEAD, HEAD_TOP, 'Neck'),
    ])
    for s, sx in ((1, 'R'), (-1, 'L')):
        w = wrist(s)
        k = hand_point(s, *KNUCKLE_LOCAL)
        BONES.extend([
            (f'UpperArm_{sx}', shoulder(s), elbow(s), 'Chest'),
            (f'ForeArm_{sx}', elbow(s), w, f'UpperArm_{sx}'),
            (f'Hand_{sx}', w, w + (k - w).normalized() * 0.09, f'ForeArm_{sx}'),
            (f'Thigh_{sx}', hip(s), knee(s), 'Hips'),
            (f'Shin_{sx}', knee(s), ankle(s), f'Thigh_{sx}'),
            (f'Foot_{sx}', ankle(s), toe(s), f'Shin_{sx}'),
        ])


# ---------------------------------------------------------------- mesh helpers
class Part:
    """Accumulates vertices, faces and bone weights for one material."""

    def __init__(self):
        self.verts, self.faces, self.weights = [], [], []

    def add(self, verts, faces, weights):
        base = len(self.verts)
        self.verts.extend(verts)
        self.weights.extend(weights)
        self.faces.extend(tuple(base + i for i in f) for f in faces)


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def se(c, s, n):
    """superellipse point on the unit 'circle' with exponent n"""
    return math.copysign(abs(c) ** (2 / n), c), math.copysign(abs(s) ** (2 / n), s)


def ring_faces(n_rings, m, cap0=False, cap1=False, closed=True):
    faces = []
    for i in range(n_rings - 1):
        for j in range(m if closed else m - 1):
            a, b = i * m + j, i * m + (j + 1) % m
            faces.append((a, b, b + m, a + m))
    extra = []
    if cap0:
        extra.append(('c0', list(range(m))))
    if cap1:
        extra.append(('c1', [(n_rings - 1) * m + j for j in range(m)]))
    return faces, extra


def loft_into(part, rings, weights, cap0=False, cap1=False):
    """rings: list of vertex rings (same length); weights: one {bone: w} per ring."""
    m = len(rings[0])
    verts = [p for r in rings for p in r]
    wts = [w for w in weights for _ in range(m)]
    faces, caps = ring_faces(len(rings), m)
    for kind, idx in caps:
        c = sum((verts[i] for i in idx), V()) / m
        ci = len(verts)
        verts.append(c)
        wts.append(weights[0] if kind == 'c0' else weights[-1])
        for j in range(m):
            a, b = idx[j], idx[(j + 1) % m]
            faces.append((b, a, ci) if kind == 'c0' else (a, b, ci))
    part.add(verts, faces, wts)


def frames_along(points, ref):
    """Rotation-minimising frames along a polyline: (tangent, normal, binormal)."""
    n = len(points)
    tans = [(points[min(i + 1, n - 1)] - points[max(i - 1, 0)]).normalized() for i in range(n)]
    nrm = (ref - tans[0] * ref.dot(tans[0])).normalized()
    out = []
    for i, t in enumerate(tans):
        if i:
            ax = tans[i - 1].cross(t)
            if ax.length > 1e-9:
                nrm = Quaternion(ax.normalized(), tans[i - 1].angle(t)) @ nrm
            nrm = (nrm - t * nrm.dot(t)).normalized()
        out.append((t, nrm, t.cross(nrm)))
    return out


def resample(keys, step):
    """keys: [(point, (r1, r2))]; returns finer [(point, (r1, r2), s)] with smooth radius changes."""
    out = []
    s = 0.0
    for i in range(len(keys) - 1):
        (p0, r0), (p1, r1) = keys[i], keys[i + 1]
        seg = (p1 - p0).length
        n = max(1, int(math.ceil(seg / step)))
        for k in range(n):
            t = k / n
            st = t * t * (3 - 2 * t)
            out.append((p0.lerp(p1, t), (r0[0] + (r1[0] - r0[0]) * st, r0[1] + (r1[1] - r0[1]) * st), s + seg * t))
        s += seg
    out.append((keys[-1][0], keys[-1][1], s))
    return out


def chain_weights(s, joints, first):
    """joints: [(s_joint, bone_after, half_width)]; bones change at each joint with a smooth blend."""
    bone = first
    w = {first: 1.0}
    for sj, after, hw in joints:
        if s >= sj + hw:
            bone = after
            w = {after: 1.0}
        elif s > sj - hw:
            t = smoothstep(sj - hw, sj + hw, s)
            w = {bone: 1 - t, after: t}
            break
        else:
            break
    return w


def tube_into(part, keys, joints, first, segs=16, ref=V((0, 0, 1)), step=0.02, cap0=True, cap1=True, n=2.0, weight_fn=None):
    samples = resample(keys, step)
    pts = [p for p, _, _ in samples]
    frames = frames_along(pts, ref)
    rings, wts = [], []
    for (p, (r1, r2), s), (_, nrm, bn) in zip(samples, frames):
        ring = []
        for j in range(segs):
            a = 2 * math.pi * j / segs
            c, sn = se(math.cos(a), math.sin(a), n)
            ring.append(p + nrm * (c * r1) + bn * (sn * r2))
        rings.append(ring)
        wts.append(weight_fn(p, s) if weight_fn else chain_weights(s, joints, first))
    loft_into(part, rings, wts, cap0, cap1)
    return samples


def ellipsoid_into(part, center, radii, weights, keep=None, rings=12, segs=20, rot=None):
    """UV ellipsoid; keep(dir) -> bool selects which faces to keep (by face centre direction)."""
    verts, faces = [], []
    for i in range(rings + 1):
        v = math.pi * i / rings
        for j in range(segs):
            u = 2 * math.pi * j / segs
            d = V((math.sin(v) * math.cos(u), math.sin(v) * math.sin(u), math.cos(v)))
            if rot:
                d = rot @ d
            verts.append(d)
    for i in range(rings):
        for j in range(segs):
            a, b = i * segs + j, i * segs + (j + 1) % segs
            f = (a, a + segs, b + segs, b)
            if keep:
                dc = sum((verts[k] for k in f), V()).normalized()
                if not keep(dc):
                    continue
            faces.append(f)
    used = sorted({k for f in faces for k in f})
    remap = {k: i for i, k in enumerate(used)}
    pts = [center + V((verts[k].x * radii[0], verts[k].y * radii[1], verts[k].z * radii[2])) for k in used]
    part.add(pts, [tuple(remap[k] for k in f) for f in faces], [weights] * len(pts))


def mirror_faces(faces):
    return [tuple(reversed(f)) for f in faces]


# ---------------------------------------------------------------- torso
# z, centre y, half width, half depth (front), half depth (back)
TORSO = [
    (0.715, 1.505, 0.150, 0.105, 0.115),
    (0.760, 1.508, 0.162, 0.118, 0.125),
    (0.820, 1.505, 0.165, 0.118, 0.122),
    (0.900, 1.497, 0.153, 0.108, 0.108),
    (0.980, 1.490, 0.143, 0.104, 0.100),
    (1.060, 1.482, 0.152, 0.112, 0.104),
    (1.150, 1.476, 0.170, 0.122, 0.112),
    (1.240, 1.475, 0.178, 0.122, 0.115),
    (1.300, 1.478, 0.172, 0.112, 0.112),
    (1.340, 1.482, 0.140, 0.092, 0.098),
    (1.370, 1.486, 0.085, 0.068, 0.075),
    (1.385, 1.488, 0.058, 0.056, 0.060),
]


def torso_at(z):
    for i in range(len(TORSO) - 1):
        a, b = TORSO[i], TORSO[i + 1]
        if a[0] <= z <= b[0]:
            t = smoothstep(a[0], b[0], z) * 0.5 + (z - a[0]) / (b[0] - a[0]) * 0.5
            return tuple(a[k] + (b[k] - a[k]) * t for k in range(1, 5))
    return TORSO[0][1:] if z < TORSO[0][0] else TORSO[-1][1:]


TORSO_N = 2.5


def torso_front(x, z, off=0.0):
    yc, hw, hdf, _ = torso_at(z)
    u = min(abs(x) / (hw + off), 0.999)
    return yc + (hdf + off) * (1 - u ** TORSO_N) ** (1 / TORSO_N)


def torso_weights(z):
    if z < 0.88:
        return {'Hips': 1.0}
    if z < 0.96:
        t = smoothstep(0.88, 0.96, z)
        return {'Hips': 1 - t, 'Spine': t}
    if z < 1.09:
        return {'Spine': 1.0}
    if z < 1.17:
        t = smoothstep(1.09, 1.17, z)
        return {'Spine': 1 - t, 'Chest': t}
    if z < 1.36:
        return {'Chest': 1.0}
    t = smoothstep(1.36, 1.40, z)
    return {'Chest': 1 - t, 'Neck': t}


def build_torso(part):
    rings, wts = [], []
    m = 36
    zs = [TORSO[0][0] + (TORSO[-1][0] - TORSO[0][0]) * i / 34 for i in range(35)]
    for z in zs:
        yc, hw, hdf, hdb = torso_at(z)
        ring = []
        for j in range(m):
            a = 2 * math.pi * j / m
            c, s = se(math.cos(a), math.sin(a), TORSO_N)
            ring.append(V((hw * c, yc + (hdf if s > 0 else hdb) * s, z)))
        rings.append(ring)
        wts.append(torso_weights(z))
    loft_into(part, rings, wts, cap0=True, cap1=True)


# ---------------------------------------------------------------- hands
def hand_into(s, glove, armor):
    """A gloved hand closed around a vertical grip of radius GRIP_R. Built as a right hand in the
    hand frame (x away from the body, y forward, z up the grip), then placed and mirrored."""
    w = {f'Hand_{"R" if s > 0 else "L"}': 1.0}
    bone = next(iter(w))
    up = V((0, 0, 1))
    sub = Part()
    # palm and back of the hand: a rounded slab from the wrist to the knuckles
    rings = []
    for i in range(11):
        t = i / 10
        y = -0.084 + 0.098 * t
        x = 0.037 + 0.005 * math.sin(t * math.pi)
        hz = 0.030 + 0.016 * smoothstep(0, 0.7, t) - 0.004 * smoothstep(0.85, 1.0, t)
        hx = 0.015 + 0.004 * math.sin(t * math.pi * 0.8)
        ring = []
        for j in range(18):
            a = 2 * math.pi * j / 18
            c, sn = se(math.cos(a), math.sin(a), 2.8)
            ring.append(V((x + hx * c, y, 0.002 - hz * sn)))
        rings.append(ring)
    loft_into(sub, rings, [w] * len(rings), cap0=True, cap1=True)
    # fingers: from the knuckles, curled round the front of the grip; index on top
    rf = GRIP_R + 0.0105
    for z, r, sweep in ((0.032, 0.0104, 168), (0.0105, 0.0108, 178), (-0.0105, 0.0103, 170), (-0.030, 0.0092, 150)):
        pts, radii = [], []
        mcp = V((0.040, 0.010, z))
        a0 = math.atan2(mcp.y, mcp.x)
        r0 = mcp.xy.length
        n = 16
        for k in range(n + 1):
            t = k / n
            a = a0 + math.radians(sweep) * t
            rr = r0 + (rf - r0) * smoothstep(0.0, 0.3, t) + 0.0012 * math.sin(t * math.pi * 3) ** 2
            pts.append(V((rr * math.cos(a), rr * math.sin(a), z - 0.003 * t)))
            radii.append(r * (1 - 0.1 * t))
        pts.insert(0, V((0.038, -0.006, z)))
        radii.insert(0, r)
        frames = frames_along(pts, up)
        rings = [[p + nrm * (rr * math.cos(2 * math.pi * j / 12)) + bn * (rr * math.sin(2 * math.pi * j / 12)) for j in range(12)]
                 for p, rr, (_, nrm, bn) in zip(pts, radii, frames)]
        loft_into(sub, rings, [w] * len(rings), cap0=False, cap1=True)
    # thumb: from the base of the palm, over the top of the grip
    keys = [(V((0.028, -0.058, 0.024)), (0.0128, 0.0120)), (V((0.018, -0.040, 0.047)), (0.0118, 0.0110)),
            (V((0.006, -0.020, 0.062)), (0.0104, 0.0098)), (V((-0.004, -0.002, 0.067)), (0.0096, 0.0091)),
            (V((-0.008, 0.010, 0.066)), (0.0084, 0.0080))]
    tube_into(sub, keys, [], bone, segs=12, ref=up, step=0.008)
    # gauntlet cuff: a thick ring round the wrist
    prof = [(-0.066, 0.036), (-0.112, 0.043), (-0.114, 0.040), (-0.112, 0.032), (-0.070, 0.029)]
    rings = []
    for y, r in prof:
        rings.append([V((0.034 + r * math.cos(2 * math.pi * j / 20), y, -0.001 + r * 1.06 * math.sin(2 * math.pi * j / 20)))
                      for j in range(20)])
    rings.append(rings[0])
    loft_into(sub, rings, [w] * len(rings))
    # knuckle guard on the back of the hand
    guard = Part()
    cap_into(guard, V((0.040, -0.012, 0.002)), (0.040, 0.034, 0.024), V((1, 0, 0)), V((0, 0, 1)), 0.75, w, thickness=0.004)

    def place(src, dst):
        verts = [hand_point(s, v.x, v.y, v.z) for v in src.verts]
        dst.add(verts, src.faces if s > 0 else mirror_faces(src.faces), src.weights)

    place(sub, glove)
    place(guard, armor)


# ---------------------------------------------------------------- shells and plates
def cap_into(part, center, radii, axis, hint, theta_max, weights, thickness=0.006, rings=9, segs=28):
    """A shell cut from an ellipsoid around `axis` (radii: across hint, across the other side, along axis),
    with a rounded rim of the given thickness."""
    z = axis.normalized()
    x = (hint - z * hint.dot(z)).normalized()
    y = z.cross(x)

    def pt(th, ph, k):
        return center + x * (radii[0] * k * math.sin(th) * math.cos(ph)) + y * (radii[1] * k * math.sin(th) * math.sin(ph)) \
            + z * (radii[2] * k * math.cos(th))

    kin = 1 - thickness / min(radii)
    verts, faces = [center + z * radii[2]], []
    for i in range(1, rings + 1):
        th = theta_max * i / rings
        verts.extend(pt(th, 2 * math.pi * j / segs, 1.0) for j in range(segs))
    nout = len(verts)
    verts.append(center + z * radii[2] * kin)
    for i in range(1, rings + 1):
        th = theta_max * i / rings
        verts.extend(pt(th, 2 * math.pi * j / segs, kin) for j in range(segs))
    for base, flip in ((0, False), (nout, True)):
        for j in range(segs):
            f = (base, base + 1 + j, base + 1 + (j + 1) % segs)
            faces.append(f if not flip else tuple(reversed(f)))
        for i in range(rings - 1):
            for j in range(segs):
                a = base + 1 + i * segs + j
                b = base + 1 + i * segs + (j + 1) % segs
                f = (a, a + segs, b + segs, b)
                faces.append(f if not flip else tuple(reversed(f)))
    o0 = 1 + (rings - 1) * segs
    i0 = nout + 1 + (rings - 1) * segs
    for j in range(segs):
        j1 = (j + 1) % segs
        faces.append((o0 + j, i0 + j, i0 + j1, o0 + j1))
    part.add(verts, faces, [weights] * len(verts))


def plate_into(part, surface, hw, hh, weights, thickness=0.006, n=3.0, rings=8, segs=32):
    """A plate laid on a surface: surface(u, v, off) -> point, u in [-hw, hw], v in [-hh, hh]."""
    verts, faces = [], []
    for k in (0.0, -thickness):
        verts.append(surface(0, 0, k))
        for i in range(1, rings + 1):
            r = i / rings
            for j in range(segs):
                a = 2 * math.pi * j / segs
                c, sn = se(math.cos(a), math.sin(a), n)
                # soften the rim
                kk = k - (0.003 * smoothstep(0.75, 1.0, r) if k == 0 else 0)
                verts.append(surface(c * r * hw, sn * r * hh, kk))
    half = len(verts) // 2
    for base, flip in ((0, True), (half, False)):
        for j in range(segs):
            f = (base, base + 1 + j, base + 1 + (j + 1) % segs)
            faces.append(f if not flip else tuple(reversed(f)))
        for i in range(rings - 1):
            for j in range(segs):
                a = base + 1 + i * segs + j
                b = base + 1 + i * segs + (j + 1) % segs
                f = (a, a + segs, b + segs, b)
                faces.append(f if not flip else tuple(reversed(f)))
    o0 = 1 + (rings - 1) * segs
    i0 = half + 1 + (rings - 1) * segs
    for j in range(segs):
        j1 = (j + 1) % segs
        faces.append((o0 + j1, i0 + j1, i0 + j, o0 + j))
    part.add(verts, faces, [weights(v) for v in verts] if callable(weights) else [weights] * len(verts))


def object_into(part, ob, weights):
    """Bakes a Blender object (with its modifiers) into a part, then removes it."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    mw = ob.matrix_world
    verts = [mw @ v.co for v in me.vertices]
    faces = [tuple(p.vertices) for p in me.polygons]
    ev.to_mesh_clear()
    part.add(verts, faces, [weights] * len(verts))


def temp_mesh(name, verts, faces):
    """A closed helper mesh with outward normals (boolean operands need them)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def ellipsoid_obj(name, center, radii, segs=56, rings=28):
    verts, faces = [], []
    for i in range(rings + 1):
        v = math.pi * i / rings
        for j in range(segs):
            u = 2 * math.pi * j / segs
            verts.append(center + V((radii[0] * math.sin(v) * math.cos(u), radii[1] * math.sin(v) * math.sin(u), radii[2] * math.cos(v))))
    for i in range(rings):
        for j in range(segs):
            a, b = i * segs + j, i * segs + (j + 1) % segs
            faces.append((a, a + segs, b + segs, b))
    ob = temp_mesh(name, verts, faces)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def prism_obj(name, center, hx, hz, y0, y1, segs=48, n=2.4):
    """An elliptic prism along y (a boolean cutter)."""
    verts = []
    for y in (y0, y1):
        for j in range(segs):
            a = 2 * math.pi * j / segs
            c, sn = se(math.cos(a), math.sin(a), n)
            verts.append(V((center.x + hx * c, y, center.z + hz * sn)))
    faces = [(j, (j + 1) % segs, segs + (j + 1) % segs, segs + j) for j in range(segs)]
    faces.append(tuple(reversed(range(segs))))
    faces.append(tuple(segs + j for j in range(segs)))
    return temp_mesh(name, verts, faces)


def box_obj(name, lo, hi):
    vs = [V((x, y, z)) for z in (lo.z, hi.z) for y in (lo.y, hi.y) for x in (lo.x, hi.x)]
    faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    return temp_mesh(name, vs, faces)


def boolean(ob, cutter, op):
    m = ob.modifiers.new('bool', 'BOOLEAN')
    m.operation = op
    m.object = cutter
    m.solver = 'EXACT'
    return m


# ---------------------------------------------------------------- helmet
def helmet_into(shell, visor, stripe, trim):
    w = {'Head': 1.0}
    R = V((0.133, 0.153, 0.148))
    c = HELMET_C
    vc = c + V((0, 0, 0.016))  # visor centre height
    cut = prism_obj('HelmetCut', vc, 0.095, 0.063, c.y, c.y + 0.4)
    cut_big = prism_obj('HelmetCutBig', vc, 0.104, 0.071, c.y, c.y + 0.4)
    neck = box_obj('HelmetNeck', c + V((-0.3, -0.3, -0.5)), c + V((0.3, 0.3, -0.118)))
    for o in (cut, cut_big, neck):
        o.hide_render = True
    # shell
    sh = ellipsoid_obj('HelmetShell', c, R)
    sol = sh.modifiers.new('solid', 'SOLIDIFY')
    sol.thickness = 0.012
    sol.offset = -1
    boolean(sh, cut, 'DIFFERENCE')
    boolean(sh, neck, 'DIFFERENCE')
    object_into(shell, sh, w)
    # visor: a little larger than the opening, just inside the shell
    vi = ellipsoid_obj('HelmetVisor', c, R * 0.975)
    sol = vi.modifiers.new('solid', 'SOLIDIFY')
    sol.thickness = 0.003
    boolean(vi, cut_big, 'INTERSECT')
    object_into(visor, vi, w)
    # stripe over the crown, and a rim round the neck opening
    st = ellipsoid_obj('HelmetStripe', c, R * 1.012)
    sol = st.modifiers.new('solid', 'SOLIDIFY')
    sol.thickness = 0.003
    band = box_obj('HelmetBand', c + V((-0.02, -0.4, -0.06)), c + V((0.02, 0.4, 0.4)))
    band.hide_render = True
    boolean(st, band, 'INTERSECT')
    boolean(st, cut_big, 'DIFFERENCE')
    object_into(stripe, st, w)
    # ear modules
    for s in (1, -1):
        keys = [(c + V((s * 0.118, -0.008, -0.012)), (0.036, 0.036)), (c + V((s * 0.142, -0.008, -0.012)), (0.03, 0.03))]
        tube_into(trim, keys, [], 'Head', segs=24, ref=V((0, 0, 1)), step=0.05)
    for o in (sh, vi, st, cut, cut_big, neck, band):
        bpy.data.objects.remove(o, do_unlink=True)


# ---------------------------------------------------------------- whole figure
def build(scene, mats):
    """mats: name -> material for Suit, Armor, Glove, Boot, Strap, Helmet, Visor, Accent, Buckle, Neck.
    Returns (armature object, mesh object)."""
    define_bones()
    parts = {k: Part() for k in mats}
    suit = parts['Suit']

    build_torso(suit)
    # neck (hidden with the helmet in the cockpit view)
    tube_into(parts['Neck'], [(V((0, 1.478, 1.33)), (0.052, 0.050)), (HEAD + V((0, 0.0, 0.03)), (0.050, 0.050))],
              [(0.08, 'Head', 0.03)], 'Neck', segs=16, step=0.02)
    helmet_into(parts['Helmet'], parts['Visor'], parts['Stripe'], parts['HelmetTrim'])
    # collar ring where the helmet seals to the suit
    ellipsoid_into(parts['Armor'], V((0, 1.486, 1.382)), (0.08, 0.076, 0.032), {'Chest': 1.0},
                   keep=lambda d: abs(d.z) < 0.72, rings=10, segs=28)

    for s, sx in ((1, 'R'), (-1, 'L')):
        sh, el, wr = shoulder(s), elbow(s), wrist(s)
        out = V((s, 0, 0))
        # arm
        keys = [(sh - out * 0.045 + V((0, 0, -0.01)), (0.040, 0.045)), (sh, (0.060, 0.058)),
                (sh.lerp(el, 0.45), (0.050, 0.047)), (el, (0.043, 0.041)), (el.lerp(wr, 0.4), (0.045, 0.040)),
                (wr - (wr - el).normalized() * 0.02, (0.033, 0.029)), (wr, (0.031, 0.028))]
        s_el = (sh - keys[0][0]).length + UPPER_ARM
        tube_into(suit, keys, [(s_el, f'ForeArm_{sx}', 0.035)], f'UpperArm_{sx}', segs=18, ref=V((0, 0, 1)), step=0.02)
        # sleeve band near the shoulder
        b0, b1 = sh.lerp(el, 0.28), sh.lerp(el, 0.36)
        tube_into(parts['Accent'], [(b0, (0.0585, 0.0565)), (b1, (0.0565, 0.0545))], [], f'UpperArm_{sx}', segs=18, step=0.05,
                  cap0=False, cap1=False)
        # shoulder pad
        cap_into(parts['Armor'], sh + V((-s * 0.004, -0.004, -0.008)), (0.074, 0.08, 0.08), V((s * 0.55, 0, 0.84)), V((0, 1, 0)),
                 1.1, {f'UpperArm_{sx}': 0.6, 'Chest': 0.4}, thickness=0.008)
        hand_into(s, parts['Glove'], parts['Armor'])

        # leg
        hp, kn, an = hip(s), knee(s), ankle(s)
        keys = [(hp + V((-s * 0.02, -0.02, 0.0)), (0.075, 0.080)), (hp, (0.088, 0.083)), (hp.lerp(kn, 0.5), (0.077, 0.071)),
                (kn, (0.056, 0.055)), (kn.lerp(an, 0.35), (0.058, 0.055)), (an, (0.043, 0.042))]
        s_kn = (hp - keys[0][0]).length + (kn - hp).length
        tube_into(suit, keys, [(s_kn, f'Shin_{sx}', 0.04)], f'Thigh_{sx}', segs=20, ref=V((0, 0, 1)), step=0.025, cap0=True)
        # knee pad
        kd = ((kn - hp).normalized() - (an - kn).normalized()).normalized()
        cap_into(parts['Armor'], kn - kd * 0.008, (0.066, 0.062, 0.07), kd, V((s, 0, 0)), 1.0, {f'Shin_{sx}': 1.0}, thickness=0.008)
        # boot: shaft round the shin, then the foot
        sd = (an - kn).normalized()
        tube_into(parts['Boot'], [(an + sd * 0.012, (0.050, 0.048)), (an - sd * 0.14, (0.054, 0.052))], [], f'Shin_{sx}',
                  segs=20, step=0.03, cap0=False, cap1=False)
        rings, wts = [], []
        sole = 0.418
        for i in range(13):
            t = i / 12
            y = 2.165 + 0.30 * t
            top = sole + 0.085 * (1 - smoothstep(0.25, 1.0, t)) + 0.032
            hw = 0.044 + 0.008 * math.sin(min(t * 1.3, 1) * math.pi * 0.9) - 0.012 * smoothstep(0.85, 1.0, t)
            zc = (top + sole) / 2
            hh = (top - sole) / 2
            ring = []
            for j in range(20):
                a = 2 * math.pi * j / 20
                c, sn = se(math.cos(a), math.sin(a), 3.0)
                ring.append(V((s * 0.148 + hw * c, y, zc - hh * sn)))
            rings.append(ring)
            wts.append({f'Foot_{sx}': 1.0})
        loft_into(parts['Boot'], rings, wts, cap0=True, cap1=True)

    # harness: shoulder straps down to a buckle, plus a lap belt
    strap, buckle = parts['Strap'], parts['Buckle']
    for s in (1, -1):
        pts = []
        for i in range(15):
            t = i / 14
            z = 1.348 - 0.428 * t
            x = s * (0.092 - 0.05 * smoothstep(0.4, 1.0, t))
            y = torso_front(x, z, 0.004) + (0.017 if 1.10 < z < 1.31 else 0.005)
            pts.append(V((x, y, z)))
        frames = frames_along(pts, V((0, 1, 0)))
        rings, wts = [], []
        for p, (_, nrm, bn) in zip(pts, frames):
            wv = 0.022
            rings.append([p + bn * (wv * c) + nrm * (0.004 * sn) for c, sn in ((-1, -1), (-1, 1), (1, 1), (1, -1))])
            wts.append(torso_weights(p.z))
        loft_into(strap, rings, wts, cap0=True, cap1=True)
    pts = []
    for i in range(13):
        x = -0.15 + 0.30 * i / 12
        pts.append(V((x, torso_front(x, 0.895, 0.004) + 0.003, 0.895 - 0.02 * (x / 0.15) ** 2)))
    frames = frames_along(pts, V((0, 0, 1)))
    rings = [[p + nrm * (0.022 * c) + bn * (0.004 * sn) for c, sn in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
             for p, (_, nrm, bn) in zip(pts, frames)]
    loft_into(strap, rings, [{'Hips': 1.0}] * len(rings), cap0=True, cap1=True)
    by = torso_front(0, 0.90, 0.0)
    tube_into(buckle, [(V((0, by - 0.004, 0.90)), (0.036, 0.036)), (V((0, by + 0.016, 0.90)), (0.034, 0.034))], [], 'Hips',
              segs=28, ref=V((0, 0, 1)), step=0.05)
    tube_into(parts['Accent'], [(V((0, by + 0.012, 0.90)), (0.016, 0.016)), (V((0, by + 0.021, 0.90)), (0.014, 0.014))], [], 'Hips',
              segs=20, ref=V((0, 0, 1)), step=0.05)
    # chest plate, laid on the suit
    plate_into(parts['Armor'], lambda u, v, k: V((u, torso_front(u, 1.205 + v, 0.010 + k), 1.205 + v)), 0.13, 0.095,
               lambda p: torso_weights(p.z), thickness=0.008, n=3.2)

    # ---- assemble into one mesh with one material slot per part
    me = bpy.data.meshes.new('Pilot')
    verts, faces, weights, mat_idx = [], [], [], []
    names = [k for k in mats if parts[k].verts]
    for mi, k in enumerate(names):
        p = parts[k]
        base = len(verts)
        verts.extend(p.verts)
        weights.extend(p.weights)
        faces.extend(tuple(base + i for i in f) for f in p.faces)
        mat_idx.extend([mi] * len(p.faces))
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    for k in names:
        me.materials.append(mats[k])
    for poly, mi in zip(me.polygons, mat_idx):
        poly.material_index = mi
        poly.use_smooth = True
    ob = bpy.data.objects.new('Pilot', me)
    scene.collection.objects.link(ob)
    groups = {}
    for b in BONES:
        groups[b[0]] = ob.vertex_groups.new(name=b[0])
    for i, w in enumerate(weights):
        tot = sum(w.values())
        for bn, wv in w.items():
            if wv > 1e-4:
                groups[bn].add([i], wv / tot, 'REPLACE')

    # ---- armature
    arm = bpy.data.armatures.new('PilotRig')
    rig = bpy.data.objects.new('PilotRig', arm)
    scene.collection.objects.link(rig)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for name, head, tail, parent in BONES:
        b = arm.edit_bones.new(name)
        b.head, b.tail = head, tail
        if parent:
            b.parent = eb[parent]
        eb[name] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    rig.select_set(False)
    ob.parent = rig
    mod = ob.modifiers.new('rig', 'ARMATURE')
    mod.object = rig
    return rig, ob
