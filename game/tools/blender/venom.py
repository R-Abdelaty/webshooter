"""Venom: Marvel Rivals rip, already rigged with 190 clips. Keep the clips the game uses,
rename them to the standard names, build the few that don't exist, thin the mesh, export.
See "Venom notes" in docs/CHARACTERS_PLAN.md."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from common import *
from venom_clips import hit_and_dodges

TRI_TARGET = 50000


# standard name -> source clip. Extras beyond the standard set are for his construction-site fight.
CLIPS = {
    "idle": "Idle_C",
    "walk": "Walk_Fwd_C",
    "run": "Run_Fwd_C",
    "turn_l": "Turn_L90_C",
    "turn_r": "Turn_R90_C",
    "leap_start": "Jump_Start_F_C",
    "leap_air": "Jump_Falling_F_C",
    "land": "Jump_Land_F_C",
    "land_heavy": "Jump_Land_C",
    "attack": "103511_Attack01",
    "attack2": "103511_Attack02",
    "attack3": "103511_Attack03",
    "tentacles": "103521_Tentacles_01",
    "roar": "103581_Symbiote",
    "hit_big": "Knockout",
    "stun": "Giddiness",
    "cling_idle": "Onwall_Idle",
    "crawl_to_cling": "LowCrawl_To_Onwall",
    "cling_to_jump": "Onwall_To_Jump",
    "crawl_idle": "103501_LowCrawl_Idle_L",
    "crawl_move": "103501_LowCrawl_Move",
    "descent_start": "103531_Descent_Start",
    "descent_loop": "103531_Descent_Loop",
    "descent_end": "103531_Descent_End",
}
LOOPS = {"idle", "walk", "run", "leap_air", "cling_idle", "crawl_idle", "crawl_move", "descent_loop"}

reset()
objs = imported(bpy.ops.import_scene.gltf, filepath=os.path.join(SRC, "venom", "venom.glb"))
arm = next(o for o in objs if o.type == "ARMATURE")
body = next(o for o in objs if o.type == "MESH" and o.parent == arm)
remove([o for o in objs if o not in (arm, body)])          # a stray Icosphere at the origin
clear_nla(arm)
src = {a.name: a for a in bpy.data.actions}
log("venom", len(src), "source clips,", tris(body), "triangles")

# --- clips made from other clips ------------------------------------------------------
hit_and_dodges(arm, src)

# defeat: whichever death falls backwards (+Y, away from a player in front of him).
def fall_y(name):
    s = sample(arm, src[name])
    use_action(arm, src[name]); bpy.context.scene.frame_set(int(src[name].frame_range[1]))
    bpy.context.view_layer.update()
    return (arm.matrix_world @ arm.pose.bones["pelvis"].head).y
back = max(("Dead_F", "Dead_B"), key=fall_y)
log("defeat uses", back)
CLIPS["defeat"] = back

keep = set(CLIPS) | {"hit", "dodge_l", "dodge_r"}
for std, name in CLIPS.items():
    rename(src[name], std)
keep_only(keep)
for a in bpy.data.actions:
    a.use_cyclic = a.name in LOOPS
missing = keep - {a.name for a in bpy.data.actions}
assert not missing, missing
prune_static()

# --- mesh ------------------------------------------------------------------------------
rest(arm)
dec = body.modifiers.new("decimate", "DECIMATE")
dec.ratio = min(1.0, TRI_TARGET / tris(body))
bpy.context.view_layer.objects.active = body
bpy.ops.object.modifier_apply(modifier=dec.name)
log("decimated to", tris(body), "triangles")

# The rip carries two extra UV sets and two vertex-colour layers from the game. No material
# uses them, and GLTFLoader would multiply the base colour by COLOR_0, tinting him.
while len(body.data.uv_layers) > 1:
    body.data.uv_layers.remove(body.data.uv_layers[-1])
while len(body.data.color_attributes):
    body.data.color_attributes.remove(body.data.color_attributes[0])

# Head and gear textures are small on screen; the body keeps 2K.
for img in bpy.data.images:
    users = [m.name for m in bpy.data.materials if m.node_tree and any(n.type == "TEX_IMAGE" and n.image == img for n in m.node_tree.nodes)]
    if img.size[0] > 1024 and not any("Body" in u for u in users):
        img.scale(1024, 1024)

export(os.path.join(OUT, "venom.glb"), [arm, body])
