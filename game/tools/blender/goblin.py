"""Green Goblin (Spider-Man 2002 rip): rigged, no clips, 256px diffuse only.

Writes three files, all in the same space (Goblin's feet at the origin, facing -Y), so the
runtime can drop them at one transform and they line up:
  goblin.glb  body + goblin mask on his skeleton, with scripted clips
  glider.glb  the glider on its own skeleton, with glider_fly / glider_spin
  bomb.glb    one pumpkin bomb, 20 cm, no animation
See "Goblin notes" in docs/CHARACTERS_PLAN.md.

Clips are keyframed from poses written in character terms (bend forward, lean left,
turn, raise an arm toward a direction), each an offset from his rest pose, which is
already a crouched glider stance. He never leaves the glider except in `defeat`, so
nothing moves the pelvis: the runtime moves and banks the whole rig.
"""
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Matrix, Quaternion, Vector
from common import *

HEIGHT = 1.85
DIR = os.path.join(SRC, "goblin")
BACK, DOWN, RIGHT = -FWD, -UP, -LEFT

reset()
objs = imported(bpy.ops.import_scene.fbx, filepath=os.path.join(DIR, "goblin.fbx"))
bpy.context.scene.render.fps = FPS      # the FBX importer sets the file's 24 fps; the clips below are timed at 30
O = bpy.data.objects
remove([O["mask_norman_head.smd"]])
garm, larm = O["Goblin_ARM"], O["Glider_ARM"]
body, head, glider = O["base_smtmg_goblin_body.smd"], O["mask_goblin_head.smd"], O["studio_glider.smd"]
bomb_parts = [O[n] for n in ("Bomb", "Lights", "Light", "Ring", "Shell")]

# --- scale to 1.85 m, feet on the origin, apply everything ---------------------------
bpy.context.view_layer.update()
pts = [o.matrix_world @ Vector(c) for o in (body, head) for c in o.bound_box]
lo = Vector([min(p[i] for p in pts) for i in range(3)]); hi = Vector([max(p[i] for p in pts) for i in range(3)])
s = HEIGHT / (hi.z - lo.z)
M = Matrix.Translation(Vector((-(lo.x + hi.x) / 2 * s, -(lo.y + hi.y) / 2 * s, -lo.z * s))) @ Matrix.Scale(s, 4)
for o in bpy.data.objects:
    if o.parent is None:
        o.matrix_world = M @ o.matrix_world
bpy.context.view_layer.update()
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
log("scaled by", round(s, 4))

# --- mesh quality: smoother silhouette, crisp hard-surface glider -----------------------
def activate(o):
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o

# The file opens with him posed in a crouched glider stance, but the skeleton's rest pose
# is an upright A-pose. Make the crouch the rest pose, so every clip is an offset from it
# and "no animation" still means crouched on the glider. Same for the glider's rig.
def apply_pose_as_rest(arm, meshes):
    for m in meshes:
        mod = next(md for md in m.modifiers if md.type == "ARMATURE")
        activate(m); bpy.ops.object.modifier_apply(modifier=mod.name)
    activate(arm)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    for m in meshes:
        md = m.modifiers.new("Armature", "ARMATURE"); md.object = arm

posed = sum(pb.matrix_basis.to_quaternion().angle > 1e-3 for pb in garm.pose.bones)
log("bones posed on import:", posed)
apply_pose_as_rest(garm, [body, head])
apply_pose_as_rest(larm, [glider])
bpy.context.view_layer.update()
feet = min((garm.matrix_world @ b.head_local).z for b in garm.data.bones if "Toe" in b.name)
top = max((glider.matrix_world @ Vector(c)).z for c in glider.bound_box)
log("feet z", round(feet, 3), "glider top z", round(top, 3))

for o in (body, head):
    activate(o)
    sub = o.modifiers.new("sub", "SUBSURF"); sub.levels = sub.render_levels = 1
    sub.uv_smooth = "PRESERVE_BOUNDARIES"
    while o.modifiers[0] != sub:
        bpy.ops.object.modifier_move_up(modifier=sub.name)
    bpy.ops.object.modifier_apply(modifier=sub.name)
    for p in o.data.polygons: p.use_smooth = True
activate(glider)
bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
log("triangles body", tris(body), "head", tris(head), "glider", tris(glider))

# --- materials: bake a normal map and a roughness map from the diffuse ----------------
scene = bpy.context.scene
scene.render.engine = "CYCLES"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind; prefs.get_devices()
            if any(d.type == kind for d in prefs.devices):
                for d in prefs.devices: d.use = True
                scene.cycles.device = "GPU"; break
        except TypeError:
            pass
except Exception as e:
    log("GPU bake unavailable, using CPU:", e)
scene.cycles.samples = 4
scene.render.bake.margin = 8

def diffuse(name):
    up = os.path.join(DIR, name.replace(".png", "_4x.png"))
    return bpy.data.images.load(up if os.path.exists(up) else os.path.join(DIR, name))

def build_material(mat, png, meshes, metallic, rough_lo, rough_hi, bump):
    """Bake a normal (from the diffuse's own shading) and roughness, then rebuild the
    material from image textures only, so it survives glTF export."""
    nt = mat.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    base = nt.nodes.new("ShaderNodeTexImage"); base.image = diffuse(png); base.interpolation = "Cubic"
    lum = nt.nodes.new("ShaderNodeRGBToBW"); nt.links.new(base.outputs["Color"], lum.inputs["Color"])
    bmp = nt.nodes.new("ShaderNodeBump"); bmp.inputs["Strength"].default_value = bump; bmp.inputs["Distance"].default_value = 0.01
    nt.links.new(lum.outputs["Val"], bmp.inputs["Height"])
    nt.links.new(bmp.outputs["Normal"], bsdf.inputs["Normal"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    size = max(1024, base.image.size[0])
    nimg = bpy.data.images.new(mat.name + "_normal", size, size); nimg.colorspace_settings.name = "Non-Color"
    rimg = bpy.data.images.new(mat.name + "_rough", size, size); rimg.colorspace_settings.name = "Non-Color"
    target = nt.nodes.new("ShaderNodeTexImage")
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    # normal
    target.image = nimg; nt.nodes.active = target
    bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", use_clear=True, margin=8)
    # roughness: brighter plates are shinier armour, dark suit is duller
    em = nt.nodes.new("ShaderNodeEmission"); mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["To Min"].default_value = rough_hi; mr.inputs["To Max"].default_value = rough_lo
    nt.links.new(lum.outputs["Val"], mr.inputs["Value"]); nt.links.new(mr.outputs["Result"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    target.image = rimg; nt.nodes.active = target
    bpy.ops.object.bake(type="EMIT", use_clear=True, margin=8)
    for img in (nimg, rimg):
        img.filepath_raw = os.path.join(bpy.app.tempdir, img.name + ".png"); img.file_format = "PNG"; img.save()
    # final, export-friendly graph
    for n in (lum, bmp, em, mr, target): nt.nodes.remove(n)
    nt.links.new(base.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    ntex = nt.nodes.new("ShaderNodeTexImage"); ntex.image = nimg
    nmap = nt.nodes.new("ShaderNodeNormalMap"); nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    rtex = nt.nodes.new("ShaderNodeTexImage"); rtex.image = rimg
    sep = nt.nodes.new("ShaderNodeSeparateColor"); nt.links.new(rtex.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    bsdf.inputs["Metallic"].default_value = metallic
    if "Coat Weight" in bsdf.inputs: bsdf.inputs["Coat Weight"].default_value = 0.0
    log("baked", mat.name, size)

build_material(bpy.data.materials["goblin"], "bodygoblin.png", [body, head], 0.25, 0.28, 0.6, 0.45)
build_material(bpy.data.materials["glider"], "glider.png", [glider], 0.6, 0.25, 0.5, 0.3)

# --- posing in character terms ------------------------------------------------------
B = {
    "pelvis": "TreyarchBiped.Bip01_Pelvis", "spine1": "TreyarchBiped.Bip01_Spine01",
    "spine2": "TreyarchBiped.Bip01_Spine02", "spine3": "TreyarchBiped.Bip01_Spine03",
    "neck": "TreyarchBiped.Bip01_Neck", "head": "TreyarchBiped.Bip01_Head", "jaw": "Jaw_Lower",
}
for side in ("L", "R"):
    s_ = side.lower()
    B.update({"clav_" + s_: "TreyarchBiped.Bip01_Clavicle_" + side, "uarm_" + s_: "TreyarchBiped.Bip01_UpperArm_" + side,
              "farm_" + s_: "TreyarchBiped.Bip01_LowerArm_" + side, "hand_" + s_: "ValveBiped.Bip01_%s_Hand" % side,
              "thigh_" + s_: "TreyarchBiped.Bip01_Thigh_" + side, "calf_" + s_: "TreyarchBiped.Bip01_Calf_" + side,
              "foot_" + s_: "TreyarchBiped.Bip01_Foot_" + side})
CHILD = {"spine1": "spine2", "spine2": "spine3", "spine3": "neck", "neck": "head"}
for s_ in "lr":
    CHILD.update({"uarm_" + s_: "farm_" + s_, "farm_" + s_: "hand_" + s_, "thigh_" + s_: "calf_" + s_, "calf_" + s_: "foot_" + s_})
# Overlap: the head leads a motion, hands and forearms trail it.
DELAY = {"head": -1, "uarm_l": 1, "uarm_r": 1, "farm_l": 2, "farm_r": 2, "hand_l": 3, "hand_r": 3, "jaw": 1}


def make_poser(arm, names, child):
    rest3 = {k: (arm.matrix_world @ arm.data.bones[v].matrix_local).to_3x3() for k, v in names.items() if v in arm.data.bones}

    def direction(k):
        if k in child and child[k] in names:
            return (arm.data.bones[names[child[k]]].head_local - arm.data.bones[names[k]].head_local).normalized()
        if k.startswith("hand"):
            return direction("farm" + k[4:])
        return UP.copy()

    def local(k, axis, deg):
        return Quaternion((rest3[k].inverted() @ axis).normalized(), math.radians(deg))

    def pose(ops):
        """ops: (verb, bone, ...) -> snapshot {bone name: (loc, quat, scale)}."""
        q = {}; loc = {}
        for op in ops:
            verb, k = op[0], op[1]
            if verb == "toward":           # swing the bone toward a world direction
                d = direction(k); ax = d.cross(op[2])
                if ax.length < 1e-4: continue
                r = local(k, ax.normalized(), op[3])
            elif verb == "about":          # rotate about a world axis
                r = local(k, op[2], op[3])
            elif verb == "bend":           # forward (+) / back (-)
                r = local(k, LEFT, op[2])
            elif verb == "lean":           # to his left (+) / right (-)
                r = local(k, BACK, op[2])
            elif verb == "turn":           # to his left (+) / right (-)
                r = local(k, UP, op[2])
            elif verb == "loc":            # move, world metres
                loc[k] = loc.get(k, Vector()) + rest3[k].inverted() @ op[2]; continue
            else:
                raise ValueError(verb)
            q[k] = r @ q.get(k, Quaternion())
        snap = {}
        for k in set(q) | set(loc):
            snap[names[k]] = (loc.get(k, Vector()), q.get(k, Quaternion()), Vector((1, 1, 1)))
        return snap
    return pose


def keyed(arm, name, poses, length, names, delay=None, loop=False):
    """poses: [(frame, snapshot)]. Every bone used anywhere is keyed at every pose (rest
    where a pose leaves it out), shifted by its delay, with eased Bezier curves."""
    delay = delay or {}
    inv = {v: k for k, v in names.items()}
    used = set().union(*[set(p) for _, p in poses])
    ident = (Vector(), Quaternion(), Vector((1, 1, 1)))
    keys = {}
    for f, snap in poses:
        for bn in used:
            d = 0 if loop else delay.get(inv.get(bn), 0)
            ff = min(max(f + d, 1), length)
            keys.setdefault(ff, {})[bn] = snap.get(bn, ident)
    act = bake(arm, name, sorted(keys.items()), loop=loop, interp="BEZIER")
    for fc in fcurves(act):
        for kp in fc.keyframe_points:
            kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"
        if loop:
            fc.modifiers.new("CYCLES")
        fc.update()
    return act


def loop_clip(arm, name, length, fn, names, step=5):
    """A seamless loop from a function of phase (0..2pi) -> ops."""
    poses = []
    for f in range(0, length + 1, step):
        t = 2 * math.pi * f / length
        poses.append((f + 1, pose(fn(t))))
    return keyed(arm, name, poses, length + 1, names, loop=True)


rest(garm)
pose = make_poser(garm, {k: v for k, v in B.items() if v in garm.data.bones}, CHILD)
N = {k: v for k, v in B.items() if v in garm.data.bones}


def flying(t, amt=1.0):
    return [("bend", "spine1", 2.5 * amt * math.sin(t)), ("bend", "spine3", 2 * amt * math.sin(t - .7)),
            ("bend", "head", -3 * amt * math.sin(t - 1.2)), ("turn", "spine2", 2.5 * amt * math.sin(t + .5)),
            ("toward", "uarm_l", UP, 5 * amt * math.sin(t - .9)), ("toward", "uarm_r", UP, 5 * amt * math.sin(t - 1.3)),
            ("toward", "farm_l", FWD, 6 * amt * math.sin(t - 1.4)), ("toward", "farm_r", FWD, 6 * amt * math.sin(t - 1.8))]


def banking(sign):
    """Leaning into a turn to his left (sign +1) or right (-1); the outside arm balances."""
    outside, inside = ("r", "l") if sign > 0 else ("l", "r")
    out_dir = RIGHT if sign > 0 else LEFT
    return [("lean", "spine1", 8 * sign), ("lean", "spine3", 6 * sign), ("lean", "head", -8 * sign),
            ("turn", "head", 15 * sign), ("turn", "spine2", 8 * sign),
            ("toward", "uarm_" + outside, out_dir, 25), ("toward", "uarm_" + outside, UP, 20),
            ("toward", "uarm_" + inside, DOWN, 15), ("toward", "farm_" + inside, FWD, 20)]


loop_clip(garm, "fly", 60, lambda t: flying(t), N)
loop_clip(garm, "idle", 60, lambda t: flying(t), N)
loop_clip(garm, "fly_turn_l", 60, lambda t: banking(+1) + flying(t, .6), N)
loop_clip(garm, "fly_turn_r", 60, lambda t: banking(-1) + flying(t, .6), N)

# Throw a pumpkin bomb with the right hand. The bomb leaves the hand at RELEASE_FRAME.
RELEASE_FRAME = 21
keyed(garm, "attack", [
    (1, pose([])),
    (8, pose([("toward", "uarm_r", DOWN, 25), ("toward", "uarm_r", BACK, 10), ("toward", "farm_r", FWD, 40),
              ("turn", "spine2", -10), ("turn", "head", 5)])),
    (15, pose([("toward", "uarm_r", UP, 95), ("toward", "uarm_r", BACK, 30), ("toward", "farm_r", BACK, 60),
               ("turn", "spine2", -25), ("bend", "spine3", -8), ("toward", "uarm_l", FWD, 40), ("turn", "head", 10)])),
    (RELEASE_FRAME, pose([("toward", "uarm_r", FWD, 70), ("toward", "farm_r", FWD, 10), ("turn", "spine2", 20),
                          ("bend", "spine1", 12), ("toward", "uarm_l", DOWN, 20), ("toward", "uarm_l", BACK, 15)])),
    (27, pose([("toward", "uarm_r", FWD, 60), ("toward", "uarm_r", DOWN, 30), ("bend", "spine1", 15), ("turn", "spine2", 25),
               ("bend", "head", -5)])),
    (40, pose([])),
], 40, N, DELAY)

keyed(garm, "hit", [
    (1, pose([])),
    (4, pose([("bend", "spine3", -10), ("bend", "head", -18), ("toward", "uarm_l", UP, 12), ("toward", "uarm_r", UP, 12)])),
    (12, pose([])),
], 12, N, DELAY)

keyed(garm, "hit_big", [
    (1, pose([])),
    (5, pose([("bend", "head", -35), ("bend", "spine2", -15), ("bend", "spine3", -15),
              ("toward", "uarm_l", UP, 45), ("toward", "uarm_r", UP, 45), ("toward", "uarm_l", BACK, 25), ("toward", "uarm_r", BACK, 25),
              ("toward", "farm_l", UP, 20), ("toward", "farm_r", UP, 20)])),
    (11, pose([("bend", "head", 8), ("bend", "spine2", 6), ("toward", "uarm_l", UP, 10), ("toward", "uarm_r", UP, 10)])),
    (18, pose([("bend", "head", -6), ("bend", "spine2", -3)])),
    (30, pose([])),
], 30, N, DELAY)

for name, sign in (("dodge_l", 1), ("dodge_r", -1)):
    duck = pose([("bend", "spine1", 20), ("lean", "spine2", 18 * sign), ("bend", "head", 10),
                 ("toward", "uarm_l", FWD, 50), ("toward", "uarm_r", FWD, 50), ("toward", "farm_l", UP, 70), ("toward", "farm_r", UP, 70)])
    keyed(garm, name, [(1, pose([])), (5, duck), (10, duck), (20, pose([]))], 20, N, DELAY)

shake = lambda a: pose([("toward", "uarm_l", UP, 60), ("toward", "uarm_r", UP, 60), ("toward", "uarm_l", BACK, 20), ("toward", "uarm_r", BACK, 20),
                        ("toward", "farm_l", UP, 30), ("toward", "farm_r", UP, 30), ("bend", "spine3", -15), ("bend", "head", -30),
                        ("turn", "head", a), ("bend", "jaw", 22)])
keyed(garm, "roar", [
    (1, pose([])),
    (8, pose([("toward", "uarm_l", DOWN, 10), ("toward", "uarm_r", DOWN, 10), ("bend", "spine2", 12), ("bend", "head", 10)])),
    (16, shake(0)), (21, shake(4)), (26, shake(-4)), (31, shake(3)), (36, shake(0)),
    (50, pose([])),
], 50, N, DELAY)

# Knocked backwards off the glider. The clip moves him ~1.5 m back and 2 m down while he
# tumbles; after it the runtime keeps him falling (and the glider plays glider_spin).
keyed(garm, "defeat", [
    (1, pose([])),
    (6, pose([("bend", "head", -30), ("bend", "spine3", -15), ("toward", "uarm_l", UP, 50), ("toward", "uarm_r", UP, 50)])),
    (16, pose([("loc", "pelvis", Vector((0, .4, .25))), ("bend", "pelvis", -45), ("bend", "head", -20),
               ("toward", "uarm_l", UP, 90), ("toward", "uarm_r", UP, 80), ("toward", "thigh_l", FWD, 40), ("toward", "thigh_r", FWD, 25)])),
    (30, pose([("loc", "pelvis", Vector((0, 1.0, -.8))), ("bend", "pelvis", -120), ("toward", "uarm_l", UP, 110), ("toward", "uarm_r", UP, 70),
               ("toward", "thigh_l", FWD, 60), ("toward", "thigh_r", FWD, 20), ("toward", "calf_l", BACK, 40)])),
    (45, pose([("loc", "pelvis", Vector((0, 1.5, -2.0))), ("bend", "pelvis", -190), ("toward", "uarm_l", UP, 80), ("toward", "uarm_r", UP, 100),
               ("toward", "thigh_l", FWD, 30), ("toward", "thigh_r", FWD, 50)])),
], 45, N, {k: v for k, v in DELAY.items() if k != "head"})

# Only the Goblin's clips exist at this point, so the export can't pick up the glider's.
export(os.path.join(OUT, "goblin.glb"), [garm, body, head], sampled=True)

# --- glider ----------------------------------------------------------------------------
keep_only(set())
rest(larm)
GN = {"origin": "Origin", "side_l": "Glider_Side_L", "side_r": "Glider_Side_R"}
gpose = make_poser(larm, GN, {})
loop_clip.__globals__["pose"] = gpose     # loop_clip builds poses with the current poser
loop_clip(larm, "glider_fly", 60, lambda t: [("about", "side_l", BACK, -3 * math.sin(2 * t)),
                                              ("about", "side_r", BACK, 3 * math.sin(2 * t - .3)),
                                              ("bend", "origin", 1.5 * math.sin(t))], GN)
spin = []
for f in range(0, 46, 3):          # small steps so quaternions don't take the short way round
    k = f / 45
    spin.append((f + 1, gpose([("turn", "origin", 720 * k * (1 - .35 * k)), ("lean", "origin", 30 * math.sin(math.pi * k))])))
keyed(larm, "glider_spin", spin, 46, GN)
export(os.path.join(OUT, "glider.glb"), [larm, glider], sampled=True)

# --- pumpkin bomb ----------------------------------------------------------------------
keep_only(set())
bpy.ops.object.select_all(action="DESELECT")
for o in bomb_parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = bomb_parts[0]
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
bpy.ops.object.join()
bomb = bpy.context.view_layer.objects.active
bomb.name = "pumpkin_bomb"
bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
bomb.location = (0, 0, 0)
bomb.scale = [0.2 / max(bomb.dimensions)] * 3
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
dec = bomb.modifiers.new("dec", "DECIMATE"); dec.ratio = min(1, 1600 / tris(bomb))
bpy.ops.object.modifier_apply(modifier=dec.name)
for p in bomb.data.polygons: p.use_smooth = True
look = {"Orange": ((0.75, 0.22, 0.02), 0.45, 0.0, None), "Shell": ((0.75, 0.22, 0.02), 0.45, 0.0, None),
        "Light": ((1.0, 0.55, 0.1), 0.3, 0.0, 6.0), "Ring": ((0.05, 0.05, 0.05), 0.35, 0.9, None),
        "Grip": ((0.25, 0.08, 0.02), 0.6, 0.0, None)}
for slot in bomb.material_slots:
    m = slot.material; b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    c, r, met, glow = look.get(m.name, ((0.5, 0.5, 0.5), 0.5, 0, None))
    b.inputs["Base Color"].default_value = (*c, 1); b.inputs["Roughness"].default_value = r; b.inputs["Metallic"].default_value = met
    if glow:
        b.inputs["Emission Color"].default_value = (*c, 1); b.inputs["Emission Strength"].default_value = glow
log("bomb triangles", tris(bomb), "materials", [s.material.name for s in bomb.material_slots])
export(os.path.join(OUT, "bomb.glb"), [bomb])
log("release frame", RELEASE_FRAME)
