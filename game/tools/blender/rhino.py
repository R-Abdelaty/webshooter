"""Rhino (Marvel Strike Force rip): Mixamo-named rig, 5 clips of his own, full PBR set.

His fight needs a charge (run), a skid, hits, dodges and a defeat, which he doesn't have.
Venom's rig has all of them and moves like a brute too, so they're retargeted from
Venom's source file onto Rhino's skeleton here. No Mixamo needed.

Retargeting, per mapped bone and frame:
    D  = source pose rotation * inverse(source rest rotation)      (world space)
    Q  = swing taking the target's rest bone direction onto the source's
    target world rotation = D * Q * target rest rotation
Q absorbs the difference between the two rest poses (A-pose vs A-pose at other angles),
so limbs point where Venom's point rather than being off by the rest-pose gap.
See "Rhino notes" in docs/CHARACTERS_PLAN.md.
"""
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Matrix, Quaternion, Vector
from common import *
from venom_clips import hit_and_dodges

HEIGHT = 2.9
ARM_SPACE_DEG = 12        # push his arms out from his bulky torso
DIR = os.path.join(SRC, "rhino")

reset()
# --- target: Rhino ---------------------------------------------------------------------
tobjs = imported(bpy.ops.import_scene.fbx, filepath=os.path.join(DIR, "rhino.fbx"))
T = next(o for o in tobjs if o.type == "ARMATURE")
mesh = next(o for o in tobjs if o.type == "MESH")
remove([o for o in tobjs if o not in (T, mesh)])
own = {a.name.split("|")[-2]: a for a in bpy.data.actions}
log("rhino own clips", list(own))
paths = {fc.data_path.rsplit(".", 1)[-1] for fc in fcurves(next(iter(own.values())))}
log("rhino rotation channels", paths)
clear_nla(T)

# real height while retargeting (so hip heights compare in metres): scale the armature
# object. It goes back to native size before export.
rest(T)
native_scale, native_loc = T.scale.copy(), T.location.copy()
pts = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
h = max(p.z for p in pts) - min(p.z for p in pts)
T.scale = T.scale * (HEIGHT / h)
bpy.context.view_layer.update()
pts = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
T.location.z -= min(p.z for p in pts)
bpy.context.view_layer.update()
log("rhino scaled from", round(h, 3), "to", HEIGHT, "m")

# --- source: Venom ---------------------------------------------------------------------
sobjs = imported(bpy.ops.import_scene.gltf, filepath=os.path.join(SRC, "venom", "venom.glb"))
S = next(o for o in sobjs if o.type == "ARMATURE")
clear_nla(S)
src = {a.name: a for a in bpy.data.actions if a not in own.values()}

MAP = {"pelvis": "Hips", "spine_01": "Spine", "spine_03": "Spine1", "spine_05": "Spine2", "neck_01": "Neck", "head": "Head"}
for s_, S_ in (("l", "Left"), ("r", "Right")):
    MAP.update({"clavicle_" + s_: S_ + "Shoulder", "upperarm_" + s_: S_ + "Arm", "lowerarm_" + s_: S_ + "ForeArm",
                "hand_" + s_: S_ + "Hand", "thigh_" + s_: S_ + "UpLeg", "calf_" + s_: S_ + "Leg",
                "foot_" + s_: S_ + "Foot", "ball_" + s_: S_ + "Toes"})
    for f, F in (("index", "Index"), ("middle", "Middle"), ("ring", "Ring"), ("pinky", "Pinky"), ("thumb", "Thumb")):
        for i in (1, 2, 3):
            MAP["%s_0%d_%s" % (f, i, s_)] = "%sHand%s%d" % (S_, F, i)
MAP = {k: "mixamorig:" + v for k, v in MAP.items() if k in S.data.bones and ("mixamorig:" + v) in T.data.bones}
CHAIN = {"pelvis": "spine_01", "spine_01": "spine_03", "spine_03": "spine_05", "spine_05": "neck_01", "neck_01": "head"}
for s_ in "lr":
    CHAIN.update({"clavicle_" + s_: "upperarm_" + s_, "upperarm_" + s_: "lowerarm_" + s_, "lowerarm_" + s_: "hand_" + s_,
                  "thigh_" + s_: "calf_" + s_, "calf_" + s_: "foot_" + s_, "foot_" + s_: "ball_" + s_})
    for f in ("index", "middle", "ring", "pinky", "thumb"):
        CHAIN["%s_01_%s" % (f, s_)] = "%s_02_%s" % (f, s_); CHAIN["%s_02_%s" % (f, s_)] = "%s_03_%s" % (f, s_)
log("mapped", len(MAP), "bones")

rest(S); rest(T)
wq = lambda obj, b: (obj.matrix_world @ obj.data.bones[b].matrix_local).to_quaternion().normalized()
whead = lambda obj, b: obj.matrix_world @ obj.data.bones[b].head_local
S_rest = {s: wq(S, s) for s in MAP}
T_rest = {t: wq(T, t) for t in MAP.values()}
Q = {}
for s, t in MAP.items():
    c = CHAIN.get(s)
    if c in MAP:
        ds = (whead(S, c) - whead(S, s)).normalized()
        dt = (whead(T, MAP[c]) - whead(T, t)).normalized()
        Q[s] = dt.rotation_difference(ds)
    else:
        Q[s] = Quaternion()
OUTWARD = {"upperarm_l": Quaternion(Vector((0, 1, 0)), -math.radians(ARM_SPACE_DEG)),
           "upperarm_r": Quaternion(Vector((0, 1, 0)), math.radians(ARM_SPACE_DEG))}
s_pelvis0, t_hips0 = whead(S, "pelvis"), whead(T, MAP["pelvis"])
ratio = t_hips0.z / s_pelvis0.z

order = [b.name for b in T.data.bones]          # parents come before children
t_of = {t: s for s, t in MAP.items()}
Tw = T.matrix_world
Tw_rot = Tw.to_quaternion().normalized()


def target_pose():
    """Rhino's local bone transforms for the source's current frame."""
    bpy.context.view_layer.update()
    pose_arm = {}                                   # armature-space pose matrix per target bone
    snap = {}
    for tb in order:
        bone = T.data.bones[tb]
        rest_rel = (bone.parent.matrix_local.inverted() @ bone.matrix_local) if bone.parent else bone.matrix_local
        A = (pose_arm[bone.parent.name] @ rest_rel) if bone.parent else rest_rel
        s = t_of.get(tb)
        if s is None:
            pose_arm[tb] = A
            continue
        spb = S.pose.bones[s]
        Rs = (S.matrix_world @ spb.matrix).to_quaternion().normalized()
        Rt = (Rs @ S_rest[s].inverted()) @ Q[s] @ T_rest[tb]
        if s in OUTWARD:
            Rt = OUTWARD[s] @ Rt
        Rt_arm = Tw_rot.inverted() @ Rt
        basis_rot = A.to_quaternion().inverted() @ Rt_arm
        loc = Vector()
        if s == "pelvis":
            want_w = t_hips0 + (S.matrix_world @ spb.head - s_pelvis0) * ratio
            want_arm = Tw.inverted() @ want_w
            loc = A.to_3x3().inverted() @ (want_arm - A.translation)
        basis = Matrix.Translation(loc) @ basis_rot.to_matrix().to_4x4()
        pose_arm[tb] = A @ basis
        snap[tb] = (loc, basis_rot, Vector((1, 1, 1)))
    return snap


def retarget(name, parts, loop=False):
    frames = []
    for act in parts:
        use_action(S, act)
        f0, f1 = act.frame_range
        f = f0
        while f <= f1 + 1e-4:
            bpy.context.scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
            frames.append(target_pose())
            f += 1
    act = bake(T, name, [(i + 1, s) for i, s in enumerate(frames)], loop=loop)
    log("retargeted", name, len(frames), "frames")
    return act


retarget("run", [src["Run_Fwd_C"]], loop=True)
retarget("walk", [src["Walk_Fwd_C"]], loop=True)
retarget("skid", [src["Stop_Fwd_C"]])
retarget("turn_l", [src["Turn_L90_C"]])
retarget("turn_r", [src["Turn_R90_C"]])
retarget("hit_big", [src["Knockout"]])
retarget("stun", [src["Giddiness"]])
retarget("defeat", [src["Dead_F"]])

# hit and dodges: built on Venom exactly as venom.py builds his, then retargeted.
hit_and_dodges(S, src)
for n in ("hit", "dodge_l", "dodge_r"):
    bpy.data.actions[n].name = "venom_" + n
for n in ("hit", "dodge_l", "dodge_r"):
    retarget(n, [bpy.data.actions["venom_" + n]])

# his own clips. The "MaleBig_Entry" drops in from above: his entrance.
rename(own["Anim_Rhino_Shell"], "idle")
rename(own["Anim_Rhino_Shell_Fidget"], "idle_fidget")
rename(own["Anim_MaleBig_Entry"], "entrance")
rename(own["Anim_Rhino_Passive_OnStart"], "roar")
rename(own["Anim_Rhino_Ultimate_Start"], "attack")
mine = set(own.values()) | {a for a in bpy.data.actions if not a.name.startswith("venom_") and a.name not in src}
for a in list(bpy.data.actions):
    if a not in mine:
        bpy.data.actions.remove(a)
for a in bpy.data.actions:
    a.use_cyclic = a.name in ("idle", "idle_fidget", "run", "walk")
remove(sobjs)
log("clips", sorted(a.name for a in bpy.data.actions))
prune_static()

# --- material: relink every map by name (the FBX paths point at the author's PC) -------
def img(name, color):
    up = os.path.join(DIR, name.replace(".png", "_4x.png"))
    i = bpy.data.images.load(up if os.path.exists(up) else os.path.join(DIR, name))
    i.colorspace_settings.name = "sRGB" if color else "Non-Color"
    return i

mat = mesh.material_slots[0].material
mat.name = "rhino"
nt = mat.node_tree; nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputMaterial"); bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
def tex(name, color=False):
    n = nt.nodes.new("ShaderNodeTexImage"); n.image = img(name, color); return n
nt.links.new(tex("Char_Rhino_D.png", True).outputs["Color"], bsdf.inputs["Base Color"])
nm = nt.nodes.new("ShaderNodeNormalMap"); nt.links.new(tex("Char_Rhino_N.png").outputs["Color"], nm.inputs["Color"])
nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
for name, sock in (("Char_Rhino_R.png", "Roughness"), ("Char_Rhino_M.png", "Metallic")):
    sep = nt.nodes.new("ShaderNodeSeparateColor"); nt.links.new(tex(name).outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Red"], bsdf.inputs[sock])
nt.links.new(tex("Char_Rhino_E.png", True).outputs["Color"], bsdf.inputs["Emission Color"])
bsdf.inputs["Emission Strength"].default_value = 1.0
g = bpy.data.node_groups.get("glTF Material Output") or bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
if "Occlusion" not in [s.name for s in g.interface.items_tree]:
    g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
gn = nt.nodes.new("ShaderNodeGroup"); gn.node_tree = g
sep = nt.nodes.new("ShaderNodeSeparateColor"); nt.links.new(tex("Char_Rhino_AO.png").outputs["Color"], sep.inputs["Color"])
nt.links.new(sep.outputs["Red"], gn.inputs["Occlusion"])
for p in mesh.data.polygons: p.use_smooth = True

# Export at his native size (1.38 m); the runtime scales every model to `height` in
# characters.json. Baking the scale in with transform_apply was tried: it re-derives the
# bone rolls of this Unity-exported rig and turned every clip 90 degrees.
rest(T)
T.scale = native_scale
T.location = native_loc
log("exported at native size; runtime scale", round(HEIGHT / h, 4))
export(os.path.join(OUT, "rhino.glb"), [T, mesh])
