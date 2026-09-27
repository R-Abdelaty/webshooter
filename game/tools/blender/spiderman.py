"""Spider-Man, the player (fan-made model, personal use only): one Mixamo-named rig, two models.

  spiderman.glb       the full body for third person, with the 13 Mixamo clips
  spiderman_arms.glb  the arms and hands cut from the same mesh, on the same skeleton, in
                      camera space (the eye at the origin, looking down -Z, +Y up), with
                      scripted first-person clips (fp_*)
See "The Spider-Man model" and Session P1 in docs/PLAYER_PLAN.md.

The source file (SpiderManOfficial.fbx) carries 16 animation stacks, all two frames long:
the four mixamo.com layers, PeterParkerUpdate_TempMotion, ArmatureAction, FIGAction,
CameraAction and eight shape-key Calibration takes. Rendered side by side
(docs/reference/clips/spiderman_embedded.png): Layer0/Layer0.001 are one static near-T-pose
(arms raised 40 degrees), CameraAction and FIGAction move the whole armature object out of
view with every bone at rest, and the other twelve are the rest pose exactly. None is a
clip, so all are dropped. So are the face shape keys: the game never drives them.

The rig is the file's own, at the file's scale: the armature object keeps its 0.00168 scale
and its 90 degree turn, and the glTF exporter writes both on the armature node, so the model
comes out at real size (1.83 m) with no transform_apply. (That is what turned the Rhino's
clips 90 degrees.)

The clips are Mixamo's, downloaded on X Bot (65 bones in a T-pose; Spider-Man has the same
names plus _end leaves, in an A-pose). They are retargeted per bone and frame as rhino.py
does:
    D  = source pose rotation * inverse(source rest rotation)      (world space)
    Q  = swing taking the target's rest bone direction onto the source's
    target world rotation = D * Q * target rest rotation
and the hips follow the source's, scaled by the hip heights, with any horizontal drift over
the clip taken out, so every clip is in place.
"""
import os, sys, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from common import *

DIR = os.path.join(SRC, "spiderman")
TEX = 2048                     # texture size (the sources are 8000 px)
LENS_TEX = 512
FRAME_TRIS = 4000              # the lens frames: 18.8k triangles of thin rings
SHOOTER_TRIS = 2400            # the web shooters: 6.9k
ROUGH_SUIT, ROUGH_LINES = .62, .3
NORMAL_LINES = 5.0             # how raised the web lines are (height gradient gain)
NORMAL_WRINKLES = 0.0          # the wrinkles mask as height: off (see "normal map" below)

# standard name -> Mixamo download (docs/PLAYER_PLAN.md, Status: which animation each is)
CLIPS = ["idle", "run", "jump", "fall", "land", "perch", "hang", "shoot", "hit", "hit_big", "death", "dodge_l", "dodge_r"]
LOOPS = {"idle", "run", "fall", "perch", "hang"}
M = "mixamorig:"

reset()
objs = imported(bpy.ops.import_scene.fbx, filepath=os.path.join(DIR, "SpiderManOfficial.fbx"))
bpy.context.scene.render.fps = FPS           # the importer takes the file's rate; the clips below are 30
T = next(o for o in objs if o.type == "ARMATURE")
body = next(o for o in objs if o.type == "MESH")
remove([o for o in objs if o not in (T, body)])
clear_nla(T)
if body.data.shape_keys and body.data.shape_keys.animation_data:
    body.data.shape_keys.animation_data_clear()
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
rest(T)
bpy.context.view_layer.update()
log("spiderman", tris(body), "triangles,", len(T.data.bones), "bones")


def activate(o):
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o


# --- mesh -------------------------------------------------------------------------------
activate(body)
if body.data.shape_keys:
    log("shape keys", [(k.name, round(k.value, 2)) for k in body.data.shape_keys.key_blocks])
    bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
# The suit and mask sit in UDIM tile v 2..3 of UVMap (the mask in its corner of the same
# atlas); the lens uses UVMap too. UV1/map1 only map untextured parts. One UV set, in 0..1.
uv = body.data.uv_layers["UVMap"]
for p in body.data.polygons:
    for li in p.loop_indices:
        u, v = uv.data[li].uv
        uv.data[li].uv = (u, v - math.floor(v) if v >= 1 else v)
for name in [l.name for l in body.data.uv_layers if l.name != "UVMap"]:
    body.data.uv_layers.remove(body.data.uv_layers[name])
while len(body.data.color_attributes):      # GLTFLoader would tint him by COLOR_0
    body.data.color_attributes.remove(body.data.color_attributes[0])

# Materials: suit and mask share the atlas, so they become one; the lenses are all on
# Right.002 (Left.002 has no faces).
mats = {m.name: m for m in body.data.materials}
suit, lens, frame, shooter = mats["Suit.003"], mats["Right.002"], mats["Metal28"], mats["_3_Web_Shooter"]
suit.name, lens.name, frame.name, shooter.name = "suit", "lens", "lens_frame", "web_shooter"
index = {m.name: i for i, m in enumerate(body.data.materials)}
for p in body.data.polygons:
    if body.data.materials[p.material_index].name == "Mask.003":
        p.material_index = index["suit"]
activate(body)
bpy.ops.object.material_slot_remove_unused()

# The lens frames and web shooters carry a third of the triangles; thin them on their own
# and join them back, so the suit's silhouette and seams are untouched.
def thin(mat_name, target):
    activate(body)
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="DESELECT")
    body.active_material_index = [m.name for m in body.data.materials].index(mat_name)
    bpy.ops.object.material_slot_select(); bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    part = next(o for o in bpy.context.selected_objects if o != body)
    before = tris(part)
    activate(part)
    dec = part.modifiers.new("dec", "DECIMATE"); dec.ratio = min(1, target / before)
    bpy.ops.object.modifier_apply(modifier=dec.name)
    log("thinned", mat_name, before, "->", tris(part))
    bpy.ops.object.select_all(action="DESELECT"); part.select_set(True); body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()

thin("lens_frame", FRAME_TRIS)
thin("web_shooter", SHOOTER_TRIS)
for p in body.data.polygons:
    p.use_smooth = True
log("triangles", tris(body))


# --- textures: 2K, and roughness and a normal map from the specular (web lines) ------------
def load(name, size, color=True):
    img = bpy.data.images.load(os.path.join(DIR, name))
    img.colorspace_settings.name = "sRGB" if color else "Non-Color"   # before scaling: setting it reloads the file
    img.scale(size, size)
    return img

def pixels(img):
    a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32); img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)

def new_image(name, arr):
    img = bpy.data.images.new(name, arr.shape[1], arr.shape[0], alpha=False)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    img.filepath_raw = os.path.join(bpy.app.tempdir, name + ".png"); img.file_format = "PNG"; img.save()
    return img

def blur(a, n=1):
    for _ in range(n):
        a = (a + np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 5
    return a

base = load("NewDiffuse.png", TEX)
base.filepath_raw = os.path.join(bpy.app.tempdir, "spiderman_base.png"); base.file_format = "PNG"; base.save()
spec = pixels(load("spec2.png", TEX, False))[..., 0]
# spec2 is white on the raised web lines, black elsewhere: shiny lines on matte fabric.
rough = ROUGH_SUIT + (ROUGH_LINES - ROUGH_SUIT) * np.clip(spec, 0, 1)
mr = np.ones((TEX, TEX, 4)); mr[..., 1] = rough; mr[..., 2] = 0
rough_img = new_image("spiderman_mr", mr)
# normal map: the web lines as a height field, tangent space (+X along u, +Y along v, as
# glTF wants). Image rows run bottom to top in Blender, which is +v.
height = blur(np.clip(spec, 0, 1), 1) * NORMAL_LINES
if NORMAL_WRINKLES:
    height = height + blur(pixels(load("wrinkles.png", TEX, False))[..., 0], 3) * NORMAL_WRINKLES
gy, gx = np.gradient(height)
n = np.stack([-gx, -gy, np.ones_like(gx)], -1)
n /= np.linalg.norm(n, axis=-1, keepdims=True)
nrm = np.ones((TEX, TEX, 4)); nrm[..., :3] = n * .5 + .5
normal_img = new_image("spiderman_normal", nrm)
lens_img = load("1_-_Lentes_-_Difusse.jpg", LENS_TEX)
lens_img.filepath_raw = os.path.join(bpy.app.tempdir, "spiderman_lens.png"); lens_img.file_format = "PNG"; lens_img.save()


def principled(mat):
    nt = mat.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
    return nt, b

def image(nt, img):
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = img; return t

nt, b = principled(suit)
nt.links.new(image(nt, base).outputs["Color"], b.inputs["Base Color"])
sep = nt.nodes.new("ShaderNodeSeparateColor"); nt.links.new(image(nt, rough_img).outputs["Color"], sep.inputs["Color"])
nt.links.new(sep.outputs["Green"], b.inputs["Roughness"])
b.inputs["Metallic"].default_value = 0
nm = nt.nodes.new("ShaderNodeNormalMap"); nt.links.new(image(nt, normal_img).outputs["Color"], nm.inputs["Color"])
nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])

nt, b = principled(lens)           # the lens mesh, with a slight glow so the eyes read in shade
t = image(nt, lens_img)
nt.links.new(t.outputs["Color"], b.inputs["Base Color"]); nt.links.new(t.outputs["Color"], b.inputs["Emission Color"])
b.inputs["Emission Strength"].default_value = .35
b.inputs["Roughness"].default_value = .25

nt, b = principled(frame)          # black lacquered metal round the lenses
b.inputs["Base Color"].default_value = (.02, .02, .022, 1); b.inputs["Metallic"].default_value = .8
b.inputs["Roughness"].default_value = .35

nt, b = principled(shooter)        # the web shooters: gunmetal (the file's normal map isn't supplied)
b.inputs["Base Color"].default_value = (.32, .33, .35, 1); b.inputs["Metallic"].default_value = 1
b.inputs["Roughness"].default_value = .38


# --- points the game needs, measured on the mesh --------------------------------------------
Tw = T.matrix_world
Tw_rot = Tw.to_quaternion().normalized()
whead = lambda b_: Tw @ T.data.bones[b_].head_local
wrot = lambda b_: (Tw @ T.data.bones[b_].matrix_local).to_quaternion().normalized()
depsgraph = bpy.context.evaluated_depsgraph_get()
mw = body.matrix_world
mat_of = [m.name for m in body.data.materials]

def verts_of(mat_name):
    ids = set()
    for p in body.data.polygons:
        if mat_of[p.material_index] == mat_name:
            ids.update(p.vertices)
    return [mw @ body.data.vertices[i].co for i in ids]

lens_pts = verts_of("lens")
EYE = sum(lens_pts, Vector()) / len(lens_pts)
EYE.y += .03                   # just behind the lenses' surface, where the eyes would be
log("eye", tuple(round(x, 3) for x in EYE))

def to_gltf(v):                # Blender world (z up, faces -Y) -> glTF (y up, faces +Z)
    return [round(v.x, 3), round(v.z, 3), round(-v.y, 3)]

def local_offset(bone, p):     # a point in a bone's own axes, metres (rotation only)
    return [round(x, 3) for x in wrot(bone).inverted() @ (p - whead(bone))]

shooter_pts = verts_of("web_shooter")
wrists = {}
for side in ("Left", "Right"):
    pts = [p for p in shooter_pts if (p.x > 0) == (side == "Left")]
    c = sum(pts, Vector()) / len(pts)
    wrists[side] = local_offset(M + side + "Hand", c)
log("web shooters (hand-bone offsets)", wrists)

# Body capsules: each part's radius is its measured thickness (the 85th percentile of the
# distance from its own vertices to the segment), as Session C2 did for the villains.
vg = {g.index: g.name for g in body.vertex_groups}
owner = {}
for v in body.data.vertices:
    if v.groups:
        g = max(v.groups, key=lambda g: g.weight)
        owner.setdefault(vg[g.group], []).append(mw @ v.co)

def seg_dist(p, a, b_):
    ab = b_ - a; t = max(0, min(1, (p - a).dot(ab) / ab.length_squared))
    return (a + ab * t - p).length

HEAD_R = .11
crown = whead(M + "HeadTop_End") - Vector((0, 0, HEAD_R))
CAPSULES = [("Hips", "Neck", ["Hips", "Spine", "Spine1", "Spine2"]),
            ("Neck", "Head", ["Neck", "Head"])]
for s in ("Left", "Right"):
    CAPSULES += [(s + "Arm", s + "ForeArm", [s + "Arm"]), (s + "ForeArm", s + "Hand", [s + "ForeArm"])]
for s in ("Left", "Right"):
    CAPSULES += [(s + "UpLeg", s + "Leg", [s + "UpLeg"]), (s + "Leg", s + "Foot", [s + "Leg"])]
capsules = []
for a, b_, parts in CAPSULES:
    A, B = whead(M + a), (crown if b_ == "Head" else whead(M + b_))
    d = sorted(seg_dist(p, A, B) for part in parts for p in owner.get(M + part, []))
    r = round(d[int(len(d) * .85)], 3)
    cap = [M + a, M + b_, r]
    if b_ == "Head":
        cap.append(local_offset(M + "Head", crown))
    capsules.append(cap)
log("capsules", json.dumps(capsules))


# --- clips: retarget the Mixamo downloads -------------------------------------------------
CHILD = {"Hips": "Spine", "Spine": "Spine1", "Spine1": "Spine2", "Spine2": "Neck", "Neck": "Head", "Head": "HeadTop_End"}
for s in ("Left", "Right"):
    CHILD.update({s + "Shoulder": s + "Arm", s + "Arm": s + "ForeArm", s + "ForeArm": s + "Hand", s + "Hand": s + "HandMiddle1",
                  s + "UpLeg": s + "Leg", s + "Leg": s + "Foot", s + "Foot": s + "ToeBase", s + "ToeBase": s + "Toe_End"})
    for f in ("Thumb", "Index", "Middle", "Ring", "Pinky"):
        for i in (1, 2, 3):
            CHILD[s + "Hand%s%d" % (f, i)] = s + "Hand%s%d" % (f, i + 1)
order = [b_.name for b_ in T.data.bones]          # parents come before children
t_hips0 = whead(M + "Hips")


def retarget(name, loop):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(DIR, "anim_%s.fbx" % name))
    sobjs = [o for o in bpy.data.objects if o not in before]
    bpy.context.scene.render.fps = FPS
    S = next(o for o in sobjs if o.type == "ARMATURE")
    act = S.animation_data.action
    clear_nla(S); rest(S)
    MAP = [b_.name for b_ in S.data.bones if b_.name in T.data.bones]
    S_rest = {b_: (S.matrix_world @ S.data.bones[b_].matrix_local).to_quaternion().normalized() for b_ in MAP}
    Q = {}
    for b_ in MAP:
        c = M + CHILD.get(b_[len(M):], "")
        if c in S.data.bones and c in T.data.bones:
            ds = (S.matrix_world @ S.data.bones[c].head_local - S.matrix_world @ S.data.bones[b_].head_local).normalized()
            dt = (whead(c) - whead(b_)).normalized()
            Q[b_] = dt.rotation_difference(ds)
        else:
            Q[b_] = Quaternion()
    s_hips0 = S.matrix_world @ S.data.bones[M + "Hips"].head_local
    ratio = t_hips0.z / s_hips0.z

    use_action(S, act)
    f0, f1 = act.frame_range
    frames, hips = [], []
    for f in range(int(f0), int(f1) + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        pose_arm, snap = {}, {}
        for tb in order:
            bone = T.data.bones[tb]
            rest_rel = (bone.parent.matrix_local.inverted() @ bone.matrix_local) if bone.parent else bone.matrix_local
            A = (pose_arm[bone.parent.name] @ rest_rel) if bone.parent else rest_rel
            if tb not in S_rest:
                pose_arm[tb] = A
                continue
            spb = S.pose.bones[tb]
            Rs = (S.matrix_world @ spb.matrix).to_quaternion().normalized()
            Rt = (Rs @ S_rest[tb].inverted()) @ Q[tb] @ wrot(tb)
            basis_rot = A.to_quaternion().inverted() @ (Tw_rot.inverted() @ Rt)
            loc = Vector()
            if tb == M + "Hips":
                want_w = t_hips0 + (S.matrix_world @ spb.head - s_hips0) * ratio
                hips.append(want_w)
                loc = A.to_3x3().inverted() @ (Tw.inverted() @ want_w - A.translation)
            pose_arm[tb] = A @ (Matrix.Translation(loc) @ basis_rot.to_matrix().to_4x4())
            snap[tb] = (loc, basis_rot, Vector((1, 1, 1)))
        frames.append(snap)
    # In place: take out the hips' horizontal drift from the first frame to the last.
    n = len(frames)
    drift = hips[-1] - hips[0]; drift.z = 0
    A = T.data.bones[M + "Hips"].matrix_local
    to_loc = A.to_3x3().inverted() @ Tw.to_3x3().inverted()
    for i, snap in enumerate(frames):
        loc, rot, scl = snap[M + "Hips"]
        snap[M + "Hips"] = (loc - to_loc @ (drift * (i / max(1, n - 1))), rot, scl)
    use_action(S, None)
    remove(sobjs)
    bpy.data.actions.remove(act)
    zs = [h.z for h in hips]
    log("clip %-8s %3d frames %.2fs  drift %.2f m  hips z %.2f..%.2f" % (name, n, (n - 1) / FPS, drift.length, min(zs), max(zs)))
    return frames, to_loc


def feet(act):
    """Per frame: (lowest toe height, that toe's world position)."""
    out = []
    use_action(T, act)
    f0, f1 = act.frame_range
    for f in range(int(f0), int(f1) + 1):
        bpy.context.scene.frame_set(f)
        toes = [Tw @ T.pose.bones[M + s + "ToeBase"].head for s in ("Left", "Right")]
        lo = min(toes, key=lambda p: p.z)
        out.append((lo.z, lo, toes))
    use_action(T, None)
    return out


def raise_hips(snap, to_loc, dz):
    loc, rot, scl = snap[M + "Hips"]
    snap[M + "Hips"] = (loc + to_loc @ Vector((0, 0, dz)), rot, scl)


EVENTS = {}
for c in CLIPS:
    frames, to_loc = retarget(c, c in LOOPS)
    act = bake(T, c, [(i + 1, s) for i, s in enumerate(frames)], loop=c in LOOPS)
    if c not in ("jump", "land"):
        continue
    # The game's physics owns the jump and fall arc (PLAYER_PLAN decision 7), so neither
    # clip may carry the body through the air: jump keeps its crouch and push-off, then
    # holds the hips at their take-off height while the legs tuck; land starts at touchdown.
    fz = [z for z, _, _ in feet(act)]
    floor = min(fz)
    if c == "jump":
        off = next(i for i, z in enumerate(fz) if z > floor + .05)
        hz = lambda s: (Tw @ (T.data.bones[M + "Hips"].matrix_local @ s[M + "Hips"][0])).z
        for s in frames[off:]:
            raise_hips(s, to_loc, -(hz(s) - hz(frames[off])))
        EVENTS["jump"] = {"release_frame": off + 1, "fps": FPS, "release_seconds": round((off + 1) / FPS, 3),
                          "what": "take-off: the feet leave the ground; start the jump's rise here"}
        log("jump takes off at frame", off + 1)
    else:
        down = next(i for i, z in enumerate(fz) if i > 0 and z < floor + .03)
        frames = frames[max(0, down - 2):]
        log("land trimmed to start 2 frames before touchdown (frame", down + 1, ")")
    bake(T, c, [(i + 1, s) for i, s in enumerate(frames)])

# run: the ground speed its stride matches, from the planted foot's backward slide
fr = feet(bpy.data.actions["run"])
floor = min(z for z, _, _ in fr)
speeds = []
for i in range(1, len(fr)):
    for k in (0, 1):
        a, b_ = fr[i - 1][2][k], fr[i][2][k]
        if a.z < floor + .03 and b_.z < floor + .03:
            speeds.append(((b_ - a) * FPS).to_2d().length)
RUN_SPEED = round(sorted(speeds)[len(speeds) // 2], 2) if speeds else None
log("run ground speed", RUN_SPEED, "m/s from", len(speeds), "planted samples")
for c in ("idle", "jump", "land", "perch", "hang", "fall", "death"):
    fz = [round(z, 2) for z, _, _ in feet(bpy.data.actions[c])]
    log("feet", c, fz[::max(1, len(fz) // 12)])

for a in bpy.data.actions:
    a.use_cyclic = a.name in LOOPS
prune_static()

rest(T)
export(os.path.join(OUT, "spiderman.glb"), [T, body])
log("measured", json.dumps({"eye": to_gltf(EYE), "wrists": wrists, "run_speed": RUN_SPEED, "events": EVENTS}))


# ================================================================ first-person arms
# The mesh: every face that is mostly weighted to the clavicles, arms, hands and fingers,
# plus the web shooters. The cut runs across the chest and upper back, behind the camera.
keep_only(set())
rest(T)
ARM = {g.index for g in body.vertex_groups if any(g.name.startswith(M + s) and any(k in g.name for k in ("Shoulder", "Arm", "Hand"))
                                                 for s in ("Left", "Right"))}
arms = body.copy(); arms.data = body.data.copy(); arms.name = "spiderman_arms"
bpy.context.scene.collection.objects.link(arms)
share = []
for v in arms.data.vertices:
    tot = sum(g.weight for g in v.groups)
    share.append(sum(g.weight for g in v.groups if g.group in ARM) / tot if tot else 0)
bm = bmesh.new(); bm.from_mesh(arms.data)
shooter_i = [m.name for m in arms.data.materials].index("web_shooter")
drop = [f for f in bm.faces if f.material_index != shooter_i and sum(share[v.index] for v in f.verts) / len(f.verts) < .5]
bmesh.ops.delete(bm, geom=drop, context="FACES")
bm.to_mesh(arms.data); bm.free()
activate(arms)
bpy.ops.object.material_slot_remove_unused()
log("arms mesh", tris(arms), "triangles, materials", [m.name for m in arms.data.materials])

# --- posing in camera terms --------------------------------------------------------------
# Camera space: x right, y up, looking down -z, metres from the eye. Poses are written for the
# right hand; the left is the mirror image (x negated).
RIGHT = -LEFT
cam = lambda c: EYE + RIGHT * c[0] + UP * c[1] + FWD * (-c[2])
cdir = lambda c: (RIGHT * c[0] + UP * c[1] + FWD * (-c[2])).normalized()
mirror = lambda c: (-c[0], c[1], c[2])
TWIST = .5                     # the forearm takes this share of the hand's roll about it
FINGERS = ("Index", "Middle", "Ring", "Pinky")


def frame(y, x_hint):
    """Rotation whose Y axis is y and whose X axis is x_hint made perpendicular to it."""
    y = y.normalized(); x = (x_hint - y * x_hint.dot(y)).normalized()
    return Matrix((x, y, x.cross(y))).transposed()


def toward(d, target, deg):
    ax = d.cross(target)
    return Quaternion(ax.normalized(), math.radians(deg)) if ax.length > 1e-6 else Quaternion()


REST = {}
for s, sign in (("Left", -1), ("Right", 1)):
    b_ = lambda k: M + s + k
    fh0 = (whead(b_("HandMiddle1")) - whead(b_("Hand"))).normalized()
    # palm normal at rest: across the knuckles (index to pinky) crossed with the fingers,
    # which faces out of the palm for the right hand and into the back of the left.
    nh0 = ((whead(b_("HandIndex1")) - whead(b_("HandPinky1"))).cross(fh0)).normalized() * sign
    fingers = {}
    for f in FINGERS + ("Thumb",):
        for i in (1, 2, 3):
            bn = b_("Hand%s%d" % (f, i))
            d = (whead(b_("Hand%s%d" % (f, i + 1))) - whead(bn)).normalized()
            # turning d toward the palm; the thumb folds across it, toward the little finger
            across = (whead(b_("HandPinky1")) - whead(b_("HandIndex1"))).normalized()
            curl = d.cross((nh0 + across * 1.2).normalized() if f == "Thumb" else nh0).normalized()
            spread = nh0                                  # turning d sideways in the palm's plane
            r3 = wrot(bn).to_matrix()
            fingers[bn] = (r3.inverted() @ curl, r3.inverted() @ spread)
    ua, fa, hd = whead(b_("Arm")), whead(b_("ForeArm")), whead(b_("Hand"))
    REST[s] = dict(fh0=fh0, nh0=nh0, fingers=fingers, a=(fa - ua).length, b=(hd - fa).length,
                   du=(fa - ua).normalized(), df=(hd - fa).normalized(), sign=sign)

# Finger poses: (knuckle, middle, tip) curl in degrees per finger, thumb (spread, 1, 2, 3).
GRIPS = {
    "relaxed": {"Index": (12, 18, 10), "Middle": (18, 24, 12), "Ring": (22, 28, 14), "Pinky": (26, 30, 16), "Thumb": (0, 8, 10, 8)},
    "loose":   {"Index": (35, 45, 25), "Middle": (42, 52, 28), "Ring": (48, 55, 30), "Pinky": (52, 58, 30), "Thumb": (10, 15, 20, 15)},
    "fist":    {"Index": (80, 100, 55), "Middle": (85, 100, 55), "Ring": (88, 100, 55), "Pinky": (90, 100, 55), "Thumb": (0, 35, 50, 40)},
    "thwip":   {"Index": (-4, 0, 0), "Middle": (82, 105, 60), "Ring": (86, 105, 60), "Pinky": (-6, 0, 0), "Thumb": (-35, -10, 0, 0)},
    "open":    {"Index": (-6, -2, 0), "Middle": (-4, -2, 0), "Ring": (-4, -2, 0), "Pinky": (-6, -2, 0), "Thumb": (-20, -5, 0, 0)},
}
SPREAD = {"Index": 6, "Middle": 0, "Ring": -5, "Pinky": -10}     # fanned a little when open


def blend_grip(g1, g2, t):
    g1, g2 = GRIPS.get(g1, g1), GRIPS.get(g2, g2)
    return {k: tuple(a + (b - a) * t for a, b in zip(g1[k], g2[k])) for k in g1}


def arm_pose(s, p):
    """World rotations for one arm, from {w, elbow, f, n, grip, clav}; returns a snapshot."""
    R = REST[s]; b_ = lambda k: M + s + k
    c = (lambda v: mirror(v)) if s == "Left" else (lambda v: v)
    out = {}
    # clavicle: raise (up) and bring forward (fwd), degrees
    up, fwd = p.get("clav", (0, 0))
    dsh = (whead(b_("Arm")) - whead(b_("Shoulder"))).normalized()
    Dc = toward(dsh, FWD, fwd) @ toward(dsh, UP, up)
    Rsh = Dc @ wrot(b_("Shoulder"))
    S = whead(b_("Shoulder")) + Dc @ (whead(b_("Arm")) - whead(b_("Shoulder")))
    # two-bone IK to the wrist, the elbow pushed toward `elbow`
    W = cam(c(p["w"]))
    a, bl = R["a"], R["b"]
    d = max(.05, min((W - S).length, (a + bl) * .995)); u = (W - S).normalized(); W = S + u * d
    along = (a * a - bl * bl + d * d) / (2 * d); h = math.sqrt(max(0, a * a - along * along))
    P = cdir(c(p["elbow"])); P = (P - u * P.dot(u)).normalized()
    E = S + u * along + P * h
    du, df = (E - S).normalized(), (W - E).normalized()
    hinge = du.cross(df).normalized()
    h0 = R["du"].cross(FWD).normalized()
    Du = (frame(du, hinge) @ frame(R["du"], h0).inverted()).to_quaternion()
    Df = (frame(df, hinge) @ frame(R["df"], h0).inverted()).to_quaternion()
    # the hand: fingers along f, palm facing n
    Dh = (frame(cdir(c(p["f"])), cdir(c(p["n"]))) @ frame(R["fh0"], R["nh0"]).inverted()).to_quaternion()
    extra = Dh @ Df.inverted()
    twist = 2 * math.atan2(Vector((extra.x, extra.y, extra.z)).dot(df), extra.w)
    twist = (twist + math.pi) % (2 * math.pi) - math.pi
    Df = Quaternion(df, twist * TWIST) @ Df
    out[b_("Shoulder")] = Rsh
    out[b_("Arm")] = Du @ wrot(b_("Arm"))
    out[b_("ForeArm")] = Df @ wrot(b_("ForeArm"))
    out[b_("Hand")] = Dh @ wrot(b_("Hand"))
    local = {}
    g = p.get("grip", "relaxed")
    g = GRIPS[g] if isinstance(g, str) else g
    open_k = max(0, -g["Index"][0]) / 6
    for f in FINGERS + ("Thumb",):
        vals = g[f]
        if f == "Thumb":
            spread_deg, curls = vals[0], vals[1:]
        else:
            spread_deg, curls = SPREAD[f] * open_k, vals
        for i in (1, 2, 3):
            bn = b_("Hand%s%d" % (f, i))
            ax_curl, ax_spread = R["fingers"][bn]
            q = Quaternion(ax_curl, math.radians(curls[i - 1]))
            if i == 1 and spread_deg:
                q = Quaternion(ax_spread, math.radians(spread_deg) * R["sign"]) @ q
            local[bn] = q
    return out, local


def pose(right=None, left=None):
    """A snapshot (local transforms) of the arms in camera terms; an arm left out stays at rest."""
    world, local = {}, {}
    for s, p in (("Right", right), ("Left", left)):
        if p:
            w_, l_ = arm_pose(s, p); world.update(w_); local.update(l_)
    snap, pose_arm = {}, {}
    for tb in order:
        bone = T.data.bones[tb]
        rest_rel = (bone.parent.matrix_local.inverted() @ bone.matrix_local) if bone.parent else bone.matrix_local
        A = (pose_arm[bone.parent.name] @ rest_rel) if bone.parent else rest_rel
        if tb in world:
            q = A.to_quaternion().inverted() @ (Tw_rot.inverted() @ world[tb])
        elif tb in local:
            q = local[tb]
        else:
            pose_arm[tb] = A
            continue
        pose_arm[tb] = A @ q.to_matrix().to_4x4()
        snap[tb] = (Vector(), q.normalized(), Vector((1, 1, 1)))
    return snap


def lerp_pose(p1, p2, t):
    out = {}
    for k in p1:
        a, b = p1[k], p2.get(k, p1[k])
        if k == "grip":
            out[k] = blend_grip(a, b, t)
        elif isinstance(a, tuple):
            out[k] = tuple(x + (y - x) * t for x, y in zip(a, b))
        else:
            out[k] = a
    return out


def moved(p, dw=(0, 0, 0), **kw):
    q = dict(p); q["w"] = tuple(a + b for a, b in zip(p["w"], dw)); q.update(kw); return q


def delay_of(bn):
    if "Hand" in bn and not bn.endswith("Hand"):
        return 2                                       # fingers trail the hand
    if bn.endswith("Hand"):
        return 1
    return 0


def keyed(name, poses, length, loop=False, delay=True):
    """poses: [(frame, snapshot)]. Every bone used anywhere is keyed at every pose (rest where
    a pose leaves it out), shifted by its delay, with eased Bezier curves. Quaternions are kept
    on one hemisphere from key to key so no joint takes the long way round."""
    used = set().union(*[set(p) for _, p in poses])
    ident = (Vector(), Quaternion(), Vector((1, 1, 1)))
    keys, last = {}, {}
    for f, snap in poses:
        for bn in used:
            loc, q, scl = snap.get(bn, ident)
            q = q.copy()
            if bn in last and last[bn].dot(q) < 0:
                q.negate()
            last[bn] = q
            ff = f if (loop or not delay) else min(max(f + delay_of(bn), 1), length)
            keys.setdefault(ff, {})[bn] = (loc, q, scl)
    act = bake(T, name, sorted(keys.items()), loop=loop, interp="BEZIER")
    for fc in fcurves(act):
        for kp in fc.keyframe_points:
            kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"
        if loop:
            fc.modifiers.new("CYCLES")
        fc.update()
    return act


def loop_clip(name, length, fn, step=2):
    """A seamless loop from a function of phase (0..2pi) -> (right, left) arm poses."""
    return keyed(name, [(f + 1, pose(*fn(2 * math.pi * f / length))) for f in range(0, length + 1, step)], length + 1, loop=True)


# --- the poses (right hand; the left mirrors them) ------------------------------------------
# The shoulder is 16 cm behind the eye and the arm reaches 52 cm, so a hand can only be
# about 35 cm in front of the eye: every pose keeps within that, or the arm locks straight.
IDLE = dict(w=(.27, -.24, -.30), elbow=(.5, -1, .2), f=(-.2, .3, -1), n=(-1, -.35, -.1), grip="relaxed")
RUN = dict(w=(.27, -.31, -.22), elbow=(.4, -1, .5), f=(-.3, .4, -1), n=(-1, -.2, 0), grip="loose")
THWIP = dict(w=(.09, -.13, -.34), elbow=(.6, -1, .1), f=(-.08, 1, -.35), n=(-.12, .15, -1), grip="thwip")
RECOIL = moved(THWIP, (.01, .025, .05), f=(-.08, 1, -.1))
HOLD = dict(w=(.16, .0, -.27), elbow=(.7, -.7, .2), f=(-.5, .8, -.35), n=(-.6, -.2, -.8), grip="fist", clav=(20, 12))
HANG_FREE = dict(w=(.28, -.42, -.18), elbow=(.4, -1, .4), f=(-.1, -.2, -1), n=(-1, -.2, 0), grip="relaxed")
LET_GO = moved(HOLD, (.03, .04, -.04), grip="open")
ZIP_REACH = (dict(w=(.04, -.05, -.32), elbow=(.6, -1, .1), f=(-1, .15, -.2), n=(0, -.3, -1), grip="fist", clav=(6, 12)),
             dict(w=(.0, -.14, -.24), elbow=(.4, -1, .2), f=(-1, .15, -.1), n=(0, -.3, -1), grip="fist", clav=(3, 8)))
ZIP_BACK = (dict(w=(.06, -.2, -.2), elbow=(.4, -1, .3), f=(-1, .2, 0), n=(0, -.5, -1), grip="fist"),
            dict(w=(.03, -.28, -.12), elbow=(.4, -1, .3), f=(-1, .2, 0), n=(0, -.5, -1), grip="fist"))
GUARD = dict(w=(.11, -.08, -.24), elbow=(.5, -1, 0), f=(-.3, .9, -.2), n=(-.2, .1, -1), grip="loose")
SLUMP = dict(w=(.33, -.78, -.12), elbow=(.3, -1, .3), f=(0, -1, -.3), n=(-1, 0, 0), grip="relaxed")

loop_clip("fp_idle", 90, lambda t: (moved(IDLE, (.004 * math.sin(t + .6), .01 * math.sin(t), .005 * math.cos(t))),
                                     moved(IDLE, (-.004 * math.sin(t + 1.1), .01 * math.sin(t + .5), .005 * math.cos(t + .5)))), step=5)
# The run: one arm cycle per stride (as long as `run`, 16 frames), each hand swinging forward
# and up in turn, both bobbing twice a cycle.
loop_clip("fp_run", 16, lambda t: (moved(RUN, (0, .06 * math.sin(t) + .015 * math.cos(2 * t), -.13 * math.sin(t))),
                                    moved(RUN, (0, -.06 * math.sin(t) + .015 * math.cos(2 * t), .13 * math.sin(t)))))

SNAP = 4
for side, other in (("r", "l"), ("l", "r")):
    def one(p):
        return pose(**{("right" if side == "r" else "left"): p})
    # shoot: only the shooting arm is keyed, so it can play over any base (see layers in the manifest)
    keyed("fp_shoot_" + side, [(1, one(IDLE)), (SNAP, one(THWIP)), (SNAP + 2, one(RECOIL)), (SNAP + 4, one(lerp_pose(RECOIL, IDLE, .35))),
                               (11, one(IDLE))], 11)
    hold = lambda t: (moved(HOLD, (.006 * math.sin(t), .01 * math.sin(2 * t), .006 * math.cos(t))),
                      moved(HANG_FREE, (.01 * math.sin(t + 1), .015 * math.sin(t + .4), .01 * math.cos(t))))
    loop_clip("fp_swing_hold_" + side, 60, (lambda t: hold(t)) if side == "r" else (lambda t: hold(t)[::-1]), step=5)
    keyed("fp_release_" + side, [(1, one(HOLD)), (4, one(LET_GO)), (8, one(lerp_pose(LET_GO, IDLE, .5))), (15, one(IDLE))], 15)
    EVENTS["fp_shoot_" + side] = {"release_frame": SNAP, "fps": FPS, "release_seconds": round(SNAP / FPS, 3),
                                  "what": "the snap: the web leaves the shooting wrist"}

# zip: both fists on the line, the right one ahead, hauling it in toward the chest
keyed("fp_zip", [(1, pose(IDLE, IDLE)), (5, pose(*ZIP_REACH)), (14, pose(*ZIP_BACK)), (18, pose(*ZIP_BACK))], 18)
keyed("fp_hit", [(1, pose(IDLE, IDLE)), (4, pose(GUARD, GUARD)), (7, pose(moved(GUARD, (0, -.03, 0)), moved(GUARD, (0, -.03, 0)))),
                 (13, pose(IDLE, IDLE))], 13)
keyed("fp_death", [(1, pose(IDLE, IDLE)), (5, pose(moved(IDLE, (0, .03, .02), grip="open"), moved(IDLE, (0, .03, .02), grip="open"))),
                   (18, pose(lerp_pose(IDLE, SLUMP, .6), lerp_pose(IDLE, SLUMP, .5))), (30, pose(SLUMP, SLUMP))], 30)
for a in bpy.data.actions:
    a.use_cyclic = a.name in ("fp_idle", "fp_run", "fp_swing_hold_l", "fp_swing_hold_r")
log("fp clips", sorted(a.name for a in bpy.data.actions))
prune_static()

# Camera space: an empty at the eye turns him round (the camera looks down -Z in glTF, which
# is +Y here) and puts the eye at the origin. The rig under it is unchanged.
rest(T)
root = bpy.data.objects.new("fp_camera", None)
bpy.context.scene.collection.objects.link(root)
bpy.context.view_layer.update()
root.matrix_world = Matrix.Rotation(math.pi, 4, "Z") @ Matrix.Translation(-EYE)
T.parent = root
bpy.context.view_layer.update()
export(os.path.join(OUT, "spiderman_arms.glb"), [root, T, arms], sampled=True)
log("events", json.dumps(EVENTS))
