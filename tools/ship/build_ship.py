"""
Procedurally models the player's ship ("Kestrel": small, white, Star Citizen-like single seater)
with a full cockpit interior, bakes ambient occlusion with Cycles and exports a GLB.

Run with Blender's Python module:  python build_ship.py <out_dir>
Blender axes: X right, Y forward (nose), Z up. Units: metres.
glTF export converts to Y-up / -Z forward (three.js convention).
"""
import math
import os
import sys

import bpy  # noqa: E402  (must be imported before bmesh)
import bmesh
from mathutils import Vector

OUT = sys.argv[-1] if len(sys.argv) > 1 else '.'
os.makedirs(OUT, exist_ok=True)
BAKE_SIZE = int(os.environ.get('BAKE_SIZE', '2048'))
BAKE_SAMPLES = int(os.environ.get('BAKE_SAMPLES', '96'))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ---------------------------------------------------------------- helpers
def lerp(a, b, t):
    return a + (b - a) * t


def smooth_profile(keys, y):
    """Monotone cubic (Catmull-Rom-ish) interpolation through (y, v) keys sorted by y."""
    if y <= keys[0][0]:
        return keys[0][1]
    if y >= keys[-1][0]:
        return keys[-1][1]
    for i in range(len(keys) - 1):
        y0, v0 = keys[i]
        y1, v1 = keys[i + 1]
        if y0 <= y <= y1:
            t = (y - y0) / (y1 - y0)
            vm = keys[i - 1][1] if i > 0 else v0
            vp = keys[i + 2][1] if i + 2 < len(keys) else v1
            m0 = (v1 - vm) * 0.5
            m1 = (vp - v0) * 0.5
            t2, t3 = t * t, t * t * t
            return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * m1
    return keys[-1][1]


def make_mesh(name, verts, faces, mat=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    if mat:
        me.materials.append(mat)
    return ob


def material(name, color, rough=0.5, metal=0.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1)
        bsdf.inputs['Emission Strength'].default_value = 4.0
    return m


def loft(name, sections, mat, close_ring=True, cap_start=False, cap_end=False, smooth=True, skip=None):
    """sections: list of rings (list of (x,y,z)). Builds quads between consecutive rings."""
    verts = []
    faces = []
    n = len(sections[0])
    for ring in sections:
        verts.extend(ring)
    for i in range(len(sections) - 1):
        for j in range(n if close_ring else n - 1):
            a = i * n + j
            b = i * n + (j + 1) % n
            c = (i + 1) * n + (j + 1) % n
            d = (i + 1) * n + j
            if skip and skip(i, j, [verts[a], verts[b], verts[c], verts[d]]):
                continue
            faces.append((a, b, c, d))
    if cap_start:
        faces.append(tuple(reversed(range(n))))
    if cap_end:
        base = (len(sections) - 1) * n
        faces.append(tuple(base + j for j in range(n)))
    return make_mesh(name, verts, faces, mat, smooth)


def superellipse_ring(cx, y, cz, w, top, bottom, n_top, n_bot, m):
    pts = []
    for k in range(m):
        th = 2 * math.pi * k / m
        c, s = math.cos(th), math.sin(th)
        x = cx + w * math.copysign(abs(c) ** (2 / (n_top if s >= 0 else n_bot)), c)
        if s >= 0:
            z = cz + top * abs(s) ** (2 / n_top)
        else:
            z = cz - bottom * abs(s) ** (2 / n_bot)
        pts.append((x, y, z))
    return pts


def add_bevel(ob, width=0.02, segs=2, angle=40):
    mod = ob.modifiers.new('bevel', 'BEVEL')
    mod.width = width
    mod.segments = segs
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(angle)
    mod.harden_normals = False
    return mod


def box(name, center, size, mat, bevel=0.015, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ob.data.materials.append(mat)
    if bevel > 0:
        add_bevel(ob, bevel, 2, 30)
    return ob


def cylinder(name, center, radius, depth, mat, rot=(math.pi / 2, 0, 0), verts=32, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=center, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(mat)
    for p in ob.data.polygons:
        p.use_smooth = True
    if bevel > 0:
        add_bevel(ob, bevel, 2, 30)
    return ob


def tube_along(name, points, radius, mat, res=12):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = radius
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(points) - 1)
    for i, p in enumerate(points):
        sp.points[i].co = (*p, 1)
    ob = bpy.data.objects.new(name, cu)
    scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.active_object
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.select_set(False)
    return ob


# ---------------------------------------------------------------- materials
M_PAINT = material('Paint', (0.82, 0.83, 0.84), 0.3)
M_TRIM = material('Trim', (0.035, 0.037, 0.04), 0.45, 0.6)
M_ACCENT = material('Accent', (0.9, 0.42, 0.08), 0.35)
M_METAL = material('Metal', (0.5, 0.5, 0.52), 0.3, 1.0)
M_INTERIOR = material('Interior', (0.11, 0.115, 0.12), 0.75)
M_PANEL = material('InteriorPanel', (0.22, 0.225, 0.23), 0.55)
M_SEAT = material('Seat', (0.045, 0.045, 0.05), 0.65)
M_GLASS = material('Glass', (0.02, 0.025, 0.03), 0.05)
M_GLOW = material('EngineGlow', (0.0, 0.0, 0.0), 1.0, 0, emit=(0.4, 0.7, 1.0))
M_SCREEN = material('Screen', (0.0, 0.0, 0.0), 0.2)
M_BUTTONS = material('Buttons', (0.02, 0.02, 0.02), 0.4, 0, emit=(1.0, 0.6, 0.2))

# ---------------------------------------------------------------- fuselage
Y_TAIL, Y_NOSE = -6.6, 7.75
W = [(-6.6, 1.25), (-5.2, 1.55), (-2.5, 1.72), (0.0, 1.62), (2.0, 1.45), (3.8, 1.2), (5.6, 0.9), (7.0, 0.58), (7.55, 0.34), (7.75, 0.02)]
TOP = [(-6.6, 0.85), (-5.2, 1.12), (-2.5, 1.26), (0.0, 1.22), (2.0, 1.12), (3.8, 0.94), (5.6, 0.64), (7.0, 0.36), (7.55, 0.2), (7.75, 0.01)]
BOT = [(-6.6, 0.55), (-5.2, 0.68), (-2.5, 0.76), (0.0, 0.74), (2.0, 0.68), (3.8, 0.6), (5.6, 0.48), (7.0, 0.32), (7.55, 0.18), (7.75, 0.01)]
NTOP = [(-6.6, 3.2), (0.0, 3.0), (5.0, 2.6), (7.75, 2.2)]
CZ = [(-6.6, 0.05), (0.0, 0.0), (7.75, -0.06)]

# canopy: base half-width along y
CANOPY_Y0, CANOPY_Y1 = 0.15, 5.0
CW = [(0.15, 0.0), (0.6, 0.62), (1.6, 0.86), (2.8, 0.86), (4.0, 0.7), (4.7, 0.45), (5.0, 0.0)]
CH = [(0.15, 0.0), (0.6, 0.45), (1.6, 0.72), (2.6, 0.72), (3.8, 0.55), (4.7, 0.25), (5.0, 0.0)]

NS, NR = 64, 64
sections = []
ys = []
for i in range(NS + 1):
    t = i / NS
    # denser near the nose tip
    y = lerp(Y_TAIL, Y_NOSE, 1 - (1 - t) ** 1.0 if t < 0.85 else t)
    if t > 0.85:
        y = lerp(lerp(Y_TAIL, Y_NOSE, 0.85), Y_NOSE, 1 - (1 - (t - 0.85) / 0.15) ** 2)
    ys.append(y)
    sections.append(superellipse_ring(0, y, smooth_profile(CZ, y), max(smooth_profile(W, y), 0.02),
                                      max(smooth_profile(TOP, y), 0.01), max(smooth_profile(BOT, y), 0.02),
                                      smooth_profile(NTOP, y), 2.3, NR))


def hull_top_z(x, y):
    """z of the fuselage top surface at (x, y) (approximate, by sampling the superellipse)."""
    w = smooth_profile(W, y)
    top = smooth_profile(TOP, y)
    n = smooth_profile(NTOP, y)
    cz = smooth_profile(CZ, y)
    u = min(abs(x) / max(w, 1e-3), 1.0)
    return cz + top * (max(1 - u ** n, 0)) ** (1 / n)


def cockpit_hole(i, j, quad):
    cy = sum(p[1] for p in quad) / 4
    cx = sum(p[0] for p in quad) / 4
    cz = sum(p[2] for p in quad) / 4
    if not (CANOPY_Y0 + 0.05 < cy < CANOPY_Y1 - 0.05):
        return False
    return abs(cx) < smooth_profile(CW, cy) * 0.97 and cz > 0.2


hull = loft('Fuselage', sections, M_PAINT, skip=cockpit_hole, cap_start=True)

# ---------------------------------------------------------------- canopy glass + frame
CS = 40
canopy_rings = []
for i in range(CS + 1):
    y = lerp(CANOPY_Y0 + 0.02, CANOPY_Y1 - 0.02, i / CS)
    cw = max(smooth_profile(CW, y), 0.01)
    ch = max(smooth_profile(CH, y), 0.01)
    ring = []
    for k in range(25):
        a = math.pi * k / 24
        x = -math.cos(a) * cw
        base = hull_top_z(x, y) - 0.03
        z = base + math.sin(a) ** 0.85 * ch + (hull_top_z(0, y) - hull_top_z(x, y)) * (math.sin(a) ** 2)
        ring.append((x, y, z))
    canopy_rings.append(ring)
canopy = loft('Canopy', canopy_rings, M_GLASS, close_ring=False)


def canopy_point(y, a, off=0.0):
    cw = max(smooth_profile(CW, y), 0.01)
    ch = max(smooth_profile(CH, y), 0.01)
    x = -math.cos(a) * (cw + off)
    base = hull_top_z(x, y) - 0.03
    z = base + math.sin(a) ** 0.85 * (ch + off) + (hull_top_z(0, y) - hull_top_z(x, y)) * (math.sin(a) ** 2)
    return (x, y, z)


frames = []
# side sills (canopy rails)
for side in (0.0, math.pi):
    pts = [canopy_point(lerp(CANOPY_Y0 + 0.05, CANOPY_Y1 - 0.05, t / 30), side + (0.06 if side == 0 else -0.06), 0.01) for t in range(31)]
    frames.append(tube_along('SillRail', pts, 0.055, M_TRIM))
# front bow and rear arch
for yb, r in ((4.15, 0.045), (0.95, 0.06)):
    pts = [canopy_point(yb, lerp(0.07, math.pi - 0.07, k / 30), 0.0) for k in range(31)]
    frames.append(tube_along('Arch', pts, r, M_TRIM))

# ---------------------------------------------------------------- wings
def airfoil_section(y_le, chord, x, z, thick, m=20):
    pts = []
    for k in range(m):
        a = 2 * math.pi * k / m
        c = (math.cos(a) + 1) / 2  # 0..1 along chord (le -> te)
        s = math.sin(a)
        # rounded leading edge, sharp trailing edge
        tprof = thick * (1 - c) ** 0.6 * (c ** 0.35) * 1.6
        pts.append((x, y_le - c * chord, z + s * tprof * 0.5))
    return pts


def wing(side):
    secs = []
    span = [(1.35, 1.2, 5.6, 0.0, 0.36), (2.5, 0.2, 4.4, -0.08, 0.3), (3.8, -1.2, 3.0, -0.14, 0.2), (5.2, -2.7, 1.7, -0.2, 0.12),
            (5.5, -3.05, 1.35, -0.21, 0.1)]
    for x, yle, chord, z, th in span:
        secs.append(airfoil_section(yle, chord, side * x, z - 0.15, th))
    if side < 0:
        secs = [list(reversed(s)) for s in secs]
    return loft('Wing', secs, M_PAINT, cap_end=True)


wings = [wing(1), wing(-1)]

# wingtip fins (canted) and leading-edge trim strips
for side in (1, -1):
    fin = []
    for k, (h, yle, ch, th) in enumerate([(0.0, -2.75, 1.9, 0.09), (0.55, -3.25, 1.3, 0.07), (0.95, -3.7, 0.75, 0.05)]):
        sec = airfoil_section(yle, ch, 0, 0, th, 16)
        sec = [(side * (5.45 + h * 0.35) + p[2], p[1], -0.36 + h * 0.95) for p in sec]
        fin.append(sec if side > 0 else list(reversed(sec)))
    loft('WingFin', fin, M_PAINT, cap_end=True)
    # accent stripe along the wing top, near the leading edge
    pts = [(side * x, yle - 0.25, zz) for x, yle, zz in [(1.6, 0.85, 0.06), (2.6, -0.05, 0.02), (3.9, -1.45, -0.05), (5.1, -2.85, -0.12)]]
    tube_along('AccentStripe', pts, 0.03, M_ACCENT)

# ---------------------------------------------------------------- engines
for side in (1, -1):
    x = side * 1.38
    rings = []
    for k, (y, r) in enumerate([(-2.6, 0.05), (-3.0, 0.42), (-3.8, 0.62), (-5.5, 0.66), (-6.9, 0.6), (-7.35, 0.56)]):
        rings.append(superellipse_ring(x, y, 0.18, r, r * 0.9, r * 0.9, 2.2, 2.2, 40))
    loft('Nacelle', rings, M_PAINT)
    # nozzle
    nz = []
    for y, r in [(-7.3, 0.54), (-7.55, 0.5), (-7.6, 0.44), (-7.35, 0.38)]:
        nz.append(superellipse_ring(x, y, 0.18, r, r * 0.9, r * 0.9, 2.0, 2.0, 40))
    loft('Nozzle', nz, M_TRIM)
    # glowing core recessed in the nozzle
    glow = superellipse_ring(x, -7.32, 0.18, 0.37, 0.33, 0.33, 2.0, 2.0, 32)
    g = make_mesh('EngineGlow', glow, [tuple(range(32))], M_GLOW)
    g['glow'] = 1
    # intake on the nacelle front
    cylinder('Intake', (x, -3.1, 0.18), 0.36, 0.18, M_TRIM, verts=32)

# vertical stabilisers
for side in (1, -1):
    fin = []
    for h, yle, ch, th in [(0.0, -3.9, 2.4, 0.12), (0.7, -4.7, 1.6, 0.09), (1.35, -5.5, 0.9, 0.06)]:
        sec = airfoil_section(yle, ch, 0, 0, th, 16)
        sec = [(side * (0.72 + h * 0.42) + p[2], p[1], 0.95 + h) for p in sec]
        fin.append(sec if side > 0 else list(reversed(sec)))
    loft('TailFin', fin, M_PAINT, cap_end=True)

# greebles: RCS blocks, sensor dome, antenna, landing gear doors, rear deck vents
for side in (1, -1):
    box('RCS', (side * 0.86, 5.6, -0.05), (0.18, 0.4, 0.22), M_TRIM, 0.02)
    box('RCS', (side * 5.35, -3.3, -0.24), (0.16, 0.5, 0.16), M_TRIM, 0.02)
    box('Vent', (side * 0.65, -4.4, 1.08), (0.35, 0.9, 0.06), M_TRIM, 0.015)
    box('GearDoor', (side * 1.0, 0.4, -0.72), (0.5, 1.8, 0.04), M_TRIM, 0.01)
cylinder('SensorDome', (0, 6.3, -0.33), 0.16, 0.12, M_TRIM, rot=(0, 0, 0))
tube_along('Antenna', [(0.0, -5.2, 1.1), (0.0, -5.9, 1.55)], 0.018, M_METAL)
box('DorsalSpine', (0, -2.6, 1.25), (0.35, 3.8, 0.12), M_PAINT, 0.04)
box('DorsalTrim', (0, -2.6, 1.32), (0.12, 3.4, 0.03), M_ACCENT, 0.01)
box('RearDeck', (0, -6.55, 0.2), (1.9, 0.12, 0.8), M_TRIM, 0.03)

# ---------------------------------------------------------------- cockpit interior
FLOOR = 0.12
tub_rings = []
TUB_Y0, TUB_Y1 = CANOPY_Y0 + 0.15, CANOPY_Y1 - 0.25
for i in range(25):
    y = lerp(TUB_Y0, TUB_Y1, i / 24)
    cw = max(smooth_profile(CW, y), 0.12) * 0.97
    zt = hull_top_z(cw, y) - 0.02
    ring = [(-cw, y, zt), (-cw * 0.98, y, FLOOR + 0.3), (-cw * 0.8, y, FLOOR), (cw * 0.8, y, FLOOR), (cw * 0.98, y, FLOOR + 0.3), (cw, y, zt)]
    tub_rings.append(ring)
tub = loft('Tub', tub_rings, M_INTERIOR, close_ring=False)
# flip normals inward (we look at the inside)
bpy.context.view_layer.objects.active = tub
tub.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.flip_normals()
bpy.ops.object.mode_set(mode='OBJECT')
tub.select_set(False)

# rear bulkhead
box('RearBulkhead', (0, TUB_Y0 + 0.02, 0.62), (1.5, 0.06, 1.1), M_INTERIOR, 0.02)
# front bulkhead / footwell
box('FrontBulkhead', (0, TUB_Y1 - 0.02, 0.5), (1.2, 0.06, 0.9), M_INTERIOR, 0.02)

# dashboard: curved panel facing the pilot
dash_rings = []
for i in range(9):
    y = lerp(3.3, 3.72, i / 8)
    zt = lerp(0.6, 1.02, i / 8)
    ring = []
    for k in range(25):
        a = k / 24
        x = lerp(-0.74, 0.74, a)
        # curved around the pilot
        yy = y - 0.18 * (1 - math.cos((a - 0.5) * 1.6)) * 1.8
        ring.append((x, yy, zt))
    dash_rings.append(ring)
dash = loft('Dashboard', dash_rings, M_PANEL, close_ring=False)
dsol = dash.modifiers.new('solid', 'SOLIDIFY')
dsol.thickness = 0.05
# glare shield
gs = []
for i in range(5):
    t = i / 4
    ring = []
    for k in range(25):
        a = k / 24
        x = lerp(-0.78, 0.78, a)
        yy = lerp(3.6, 3.92, t) - 0.18 * (1 - math.cos((a - 0.5) * 1.6)) * 1.8
        ring.append((x, yy, 1.055 + 0.025 * math.sin(t * math.pi)))
    gs.append(ring)
glare = loft('GlareShield', gs, M_INTERIOR, close_ring=False)
gsol = glare.modifiers.new('solid', 'SOLIDIFY')
gsol.thickness = 0.04

# screens: three MFDs on the dashboard face, each with a clean 0..1 UV
def screen(name, cx, w, h, tilt_y):
    # dashboard surface plane at x=cx: interpolate
    a = (cx + 0.74) / 1.48
    off = -0.18 * (1 - math.cos((a - 0.5) * 1.6)) * 1.8
    y0, z0 = 3.3 + off, 0.6
    y1, z1 = 3.72 + off, 1.02
    dy, dz = (y1 - y0), (z1 - z0)
    ln = math.hypot(dy, dz)
    ty, tz = dy / ln, dz / ln
    cy, cz = y0 + dy * 0.45 - 0.03 * tz, z0 + dz * 0.45 + 0.03 * ty
    # normal toward pilot ~ (0, -tz, ty)
    v = [(cx - w / 2, cy - ty * h / 2, cz - tz * h / 2), (cx + w / 2, cy - ty * h / 2, cz - tz * h / 2),
         (cx + w / 2, cy + ty * h / 2, cz + tz * h / 2), (cx - w / 2, cy + ty * h / 2, cz + tz * h / 2)]
    ob = make_mesh(name, v, [(0, 1, 2, 3)], M_SCREEN, smooth=False)
    uv = ob.data.uv_layers.new(name='UVMap')
    for loop, coord in zip(ob.data.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[loop.index].uv = coord
    ob['screen'] = 1
    # bezel
    box(name + 'Bezel', (cx, cy + 0.021 * tz, cz - 0.021 * ty), (w + 0.05, 0.03, h + 0.05), M_INTERIOR, 0.008,
        rot=(math.atan2(-ty, tz), 0, 0))
    return ob


SCREENS = [screen('ScreenL', -0.47, 0.32, 0.22, 0), screen('ScreenC', 0.0, 0.42, 0.25, 0), screen('ScreenR', 0.47, 0.32, 0.22, 0)]

# side consoles with buttons, throttle (left) and flight stick (right)
for side in (1, -1):
    box('SideConsole', (side * 0.6, 2.25, 0.62), (0.3, 1.5, 0.22), M_PANEL, 0.03, rot=(0, side * -0.2, 0))
    box('SideConsoleBase', (side * 0.64, 2.25, 0.36), (0.26, 1.5, 0.42), M_INTERIOR, 0.02)
    for r in range(3):
        for c in range(4):
            box('Button', (side * (0.55 + r * 0.06), 1.85 + c * 0.11, 0.735 + r * side * 0.012 * side), (0.035, 0.05, 0.02), M_BUTTONS, 0.004)
# throttle lever
cylinder('ThrottleBase', (-0.6, 2.6, 0.75), 0.05, 0.06, M_TRIM, rot=(0, 0, 0))
tube_along('ThrottleArm', [(-0.6, 2.6, 0.76), (-0.6, 2.72, 0.95)], 0.022, M_METAL)
box('ThrottleGrip', (-0.6, 2.74, 1.0), (0.07, 0.12, 0.09), M_SEAT, 0.02)
# stick
cylinder('StickBase', (0.6, 2.6, 0.75), 0.06, 0.06, M_TRIM, rot=(0, 0, 0))
tube_along('StickArm', [(0.6, 2.6, 0.76), (0.6, 2.62, 0.95)], 0.02, M_METAL)
box('StickGrip', (0.6, 2.63, 1.02), (0.06, 0.08, 0.16), M_SEAT, 0.025)

# seat
box('SeatBase', (0, 1.55, 0.36), (0.6, 0.62, 0.16), M_SEAT, 0.05)
box('SeatBack', (0, 1.15, 0.85), (0.58, 0.16, 0.95), M_SEAT, 0.06, rot=(-0.25, 0, 0))
box('Headrest', (0, 1.02, 1.42), (0.36, 0.14, 0.24), M_SEAT, 0.05, rot=(-0.25, 0, 0))
box('SeatFrame', (0, 1.3, 0.2), (0.4, 0.7, 0.16), M_TRIM, 0.02)
# overhead panel at the rear arch
box('OverheadPanel', (0, 1.05, 1.82), (0.5, 0.18, 0.06), M_PANEL, 0.015, rot=(0.4, 0, 0))

# ---------------------------------------------------------------- markers
def marker(name, loc):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    scene.collection.objects.link(e)


EYE = (0.0, 1.62, 1.42)
marker('EyePoint', EYE)
marker('NavLeft', (-5.62, -3.6, -0.24))
marker('NavRight', (5.62, -3.6, -0.24))
marker('NavTail', (0.0, -5.95, 1.58))
marker('EngineL', (-1.38, -7.5, 0.18))
marker('EngineR', (1.38, -7.5, 0.18))

# ---------------------------------------------------------------- join groups
bpy.ops.object.select_all(action='DESELECT')


def apply_and_join(objs, name):
    for o in objs:
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        for m in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)
        o.select_set(False)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    bpy.ops.object.select_all(action='DESELECT')
    return ob


INTERIOR_NAMES = ('Tub', 'RearBulkhead', 'FrontBulkhead', 'Dashboard', 'GlareShield', 'SideConsole', 'Button', 'Throttle',
                  'Stick', 'Seat', 'Headrest', 'OverheadPanel', 'Screen')
exterior, interior = [], []
for o in list(scene.objects):
    if o.type != 'MESH':
        continue
    if o.name.startswith(('Canopy', 'EngineGlow')) or o.get('screen'):
        continue
    if o.name.startswith(INTERIOR_NAMES):
        interior.append(o)
    else:
        exterior.append(o)

hull = apply_and_join(exterior, 'Hull')
cockpit = apply_and_join(interior, 'Cockpit')
# merge duplicate verts on lofts' seams
for ob in (hull, cockpit):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    if ob is hull:
        # the fuselage loft and mirrored parts come out inside out: point every shell's faces outward
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()

# auto smooth by angle (sharp edges between parts)
for ob in (hull, cockpit):
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(38))
    except Exception as e:  # older/newer API
        print('auto smooth failed', e)
    ob.select_set(False)

# ---------------------------------------------------------------- UVs + AO bake
def unwrap(ob):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    while ob.data.uv_layers:
        ob.data.uv_layers.remove(ob.data.uv_layers[0])
    ob.data.uv_layers.new(name='UVMap')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=0.004, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    ob.select_set(False)


unwrap(hull)
unwrap(cockpit)

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = BAKE_SAMPLES
world = bpy.data.worlds.new('World')
scene.world = world
world.light_settings.distance = 1.6


def bake_ao(ob, size, path):
    img = bpy.data.images.new(ob.name + '_AO', size, size, alpha=False, float_buffer=False)
    for slot in ob.material_slots:
        m = slot.material
        nt = m.node_tree
        node = nt.nodes.new('ShaderNodeTexImage')
        node.image = img
        node.select = True
        nt.nodes.active = node
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.bake(type='AO', margin=12, use_clear=True)
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    # detach the bake node from materials so it is not exported
    for slot in ob.material_slots:
        nt = slot.material.node_tree
        for n in list(nt.nodes):
            if n.type == 'TEX_IMAGE':
                nt.nodes.remove(n)
    ob.select_set(False)


bake_ao(hull, BAKE_SIZE, os.path.join(OUT, 'hull_ao.png'))
bake_ao(cockpit, BAKE_SIZE, os.path.join(OUT, 'cockpit_ao.png'))

# ---------------------------------------------------------------- export
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, 'ship_raw.glb'),
    export_format='GLB',
    export_yup=True,
    export_apply=True,
    export_texcoords=True,
    export_normals=True,
    export_materials='EXPORT',
    export_extras=True,
)
print('done')

# ---------------------------------------------------------------- optional preview renders
if os.environ.get('PREVIEW'):
    scene.cycles.samples = 24
    scene.render.resolution_x, scene.render.resolution_y = 800, 450
    scene.render.film_transparent = False
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.02, 0.025, 1)
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = 4.0
    so = bpy.data.objects.new('Sun', sun)
    so.rotation_euler = (math.radians(50), math.radians(10), math.radians(140))
    scene.collection.objects.link(so)
    cam = bpy.data.cameras.new('Cam')
    co = bpy.data.objects.new('Cam', cam)
    scene.collection.objects.link(co)
    scene.camera = co

    def look(frm, to, fov, name):
        co.location = frm
        d = Vector(to) - Vector(frm)
        co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        cam.angle = math.radians(fov)
        scene.render.filepath = os.path.join(OUT, name)
        bpy.ops.render.render(write_still=True)

    look((9, 12, 6), (0, 0, 0), 50, 'prev_front34.png')
    look((-10, -12, 5), (0, -1, 0), 50, 'prev_rear34.png')
    look((0, 0.5, 16), (0, 0.5, 0), 70, 'prev_top.png')
    look((14, 0.5, 0.3), (0, 0.5, 0.3), 60, 'prev_side.png')
    bpy.data.objects['Canopy'].hide_render = True
    look(EYE, (0, 9, 0.9), 85, 'prev_cockpit.png')
