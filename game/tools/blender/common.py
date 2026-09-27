"""Shared helpers for the character build scripts (run inside Blender 5.x).

Every script here is run headless, for example:

    blender --background --factory-startup --python game/tools/blender/venom.py

and writes game/assets/models/<id>.glb plus a contact sheet of every clip in
docs/reference/clips/<id>.png. See docs/CHARACTERS_PLAN.md for what each
character needs and why.

Conventions for every exported character:
  - Blender units are metres; the character stands on z=0, faces -Y (Blender's
    front view), which the glTF exporter turns into +Y up / facing +Z.
  - One armature. Clips are Blender actions named with the standard clip names
    (idle, run, hit, ...), exported one glTF animation per action.
"""
import bpy, math, os, sys
import mathutils
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
SRC = os.path.join(REPO, "game", "assets-src", "characters")
OUT = os.path.join(REPO, "game", "assets", "models")
SHEETS = os.path.join(REPO, "docs", "reference", "clips")
FPS = 30

# Character-space axes, in Blender world space, for a character facing -Y.
FWD = Vector((0, -1, 0))
UP = Vector((0, 0, 1))
LEFT = Vector((1, 0, 0))     # the character's own left


def log(*a):
    print("[build]", *a, flush=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    bpy.context.scene.render.fps_base = 1


def imported(fn, **kw):
    before = set(bpy.data.objects)
    fn(**kw)
    return [o for o in bpy.data.objects if o not in before]


def remove(objs):
    for o in list(objs):
        bpy.data.objects.remove(o, do_unlink=True)


def tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# ---------------------------------------------------------------- actions

def use_action(arm, act):
    ad = arm.animation_data or arm.animation_data_create()
    ad.action = act
    if act is not None and act.slots:
        ad.action_slot = act.slots[0]


def clear_nla(arm):
    ad = arm.animation_data
    if ad:
        for t in list(ad.nla_tracks):
            ad.nla_tracks.remove(t)
        ad.action = None


def rest(arm):
    use_action(arm, None)
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def snapshot(arm, bones=None):
    """Local (matrix_basis) transform of every pose bone, as (loc, quat, scale)."""
    out = {}
    for pb in arm.pose.bones:
        if bones is None or pb.name in bones:
            loc, rot, scl = pb.matrix_basis.decompose()
            out[pb.name] = (loc.copy(), rot.copy(), scl.copy())
    return out


def sample(arm, act, f0=None, f1=None):
    """Evaluate an action frame by frame; returns a list of snapshots."""
    use_action(arm, act)
    a0, a1 = act.frame_range
    f0 = a0 if f0 is None else f0
    f1 = a1 if f1 is None else f1
    frames, f = [], f0
    while f <= f1 + 1e-4:
        bpy.context.scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
        frames.append(snapshot(arm))
        f += 1
    return frames


def at(arm, act, t):
    """Snapshot of an action `t` of the way through (0..1)."""
    f0, f1 = act.frame_range
    return sample(arm, act, f0 + (f1 - f0) * t, f0 + (f1 - f0) * t)[0]


def sequence(arm, parts, xfade=3, settle=None, settle_frames=8):
    """Join clips into one list of snapshots.

    parts: [(action, t0, t1)] with t0/t1 as fractions of each clip. Each joint is
    cross-faded over `xfade` frames. `settle` (a snapshot) eases the end back into it.
    """
    out = []
    for act, t0, t1 in parts:
        f0, f1 = act.frame_range
        frames = sample(arm, act, f0 + (f1 - f0) * t0, f0 + (f1 - f0) * t1)
        if out and xfade:
            n = min(xfade, len(frames), len(out))
            tail = out[-n:]
            for i in range(n):
                w = (i + 1) / (n + 1)
                tail[i] = blend(tail[i], frames[i], w)
            out[-n:] = tail
            frames = frames[n:]
        out.extend(frames)
    if settle is not None:
        last = out[-1]
        for i in range(1, settle_frames + 1):
            w = i / settle_frames
            out.append(blend(last, settle, w * w * (3 - 2 * w)))
    return out


def blend(a, b, t):
    out = {}
    for k, (la, ra, sa) in a.items():
        lb, rb, sb = b.get(k, (la, ra, sa))
        out[k] = (la.lerp(lb, t), ra.slerp(rb, t), sa.lerp(sb, t))
    return out


def bake(arm, name, keys, loop=False, interp="LINEAR", scale_keys=False):
    """Make an action from [(frame, snapshot), ...]. Replaces an existing one."""
    old = bpy.data.actions.get(name)
    if old:
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    use_action(arm, act)
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    for frame, snap in keys:
        for bn, (loc, rot, scl) in snap.items():
            pb = arm.pose.bones.get(bn)
            if pb is None:
                continue
            pb.location = loc
            pb.rotation_quaternion = rot
            pb.keyframe_insert("location", frame=frame)
            pb.keyframe_insert("rotation_quaternion", frame=frame)
            if scale_keys:
                pb.scale = scl
                pb.keyframe_insert("scale", frame=frame)
    for fc in fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = interp
    if loop:
        act.use_cyclic = True
    act.use_frame_range = False
    use_action(arm, None)
    return act


def fcurves(act):
    """All F-curves of an action, for Blender's layered actions."""
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                out.extend(bag.fcurves)
    return out


def prune_static(eps=1e-4):
    """Drop every bone channel that sits at its rest value for the whole clip.

    A missing glTF channel means "leave the joint at rest", so this changes nothing on
    screen; it just stops 262-bone rigs storing thousands of flat curves. A channel is
    only dropped whole (all components of location, rotation or scale together).
    """
    rest_val = {"location": (0, 0, 0), "rotation_quaternion": (1, 0, 0, 0), "scale": (1, 1, 1),
                "rotation_euler": (0, 0, 0)}
    dropped = kept = thinned = 0
    for act in bpy.data.actions:
        for layer in act.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    groups = {}
                    for fc in bag.fcurves:
                        prop = fc.data_path.rsplit(".", 1)[-1]
                        groups.setdefault((fc.data_path, prop), []).append(fc)
                    for (path, prop), fcs in groups.items():
                        want = rest_val.get(prop)
                        static = want is not None and all(
                            all(abs(k.co[1] - want[fc.array_index]) < eps for k in fc.keyframe_points) for fc in fcs)
                        if static:
                            for fc in fcs:
                                bag.fcurves.remove(fc)
                            dropped += 1
                        else:
                            kept += 1
                            thinned += thin_keys(fcs)
    log("pruned", dropped, "static channels, kept", kept, "- removed", thinned, "redundant keys")


def thin_keys(fcs, tol=4e-4):
    """Remove linear keys that their neighbours already predict, on every component at once.

    Only for curves keyed on the same frames with linear interpolation (clips that came in
    from glTF). tol is in the curve's own units: metres, or quaternion components (about
    0.05 degrees), well under anything visible.
    """
    pts = [fc.keyframe_points for fc in fcs]
    n = len(pts[0])
    if n < 3 or any(len(p) != n for p in pts):
        return 0
    if any(k.interpolation != "LINEAR" for p in pts for k in p):
        return 0
    xs = [pts[0][i].co[0] for i in range(n)]
    if any(abs(p[i].co[0] - xs[i]) > 1e-4 for p in pts for i in range(n)):
        return 0
    vals = [[p[i].co[1] for i in range(n)] for p in pts]
    keep, last = [0], 0
    for i in range(1, n - 1):
        # can every key between `last` and i+1 be dropped? check all of them against the line
        ok = True
        for c in vals:
            x0, x1, v0, v1 = xs[last], xs[i + 1], c[last], c[i + 1]
            for j in range(last + 1, i + 1):
                t = (xs[j] - x0) / (x1 - x0)
                if abs(v0 + (v1 - v0) * t - c[j]) > tol:
                    ok = False
                    break
            if not ok:
                break
        if not ok:
            keep.append(i)
            last = i
    keep.append(n - 1)
    drop = [i for i in range(n) if i not in set(keep)]
    for p in pts:
        for i in reversed(drop):
            p.remove(p[i], fast=True)
    for fc in fcs:
        fc.update()
    return len(drop) * len(fcs)


def keep_only(names):
    for a in list(bpy.data.actions):
        if a.name not in names:
            bpy.data.actions.remove(a)
    for a in bpy.data.actions:
        a.use_fake_user = True


def rename(act, name):
    old = bpy.data.actions.get(name)
    if old and old != act:
        bpy.data.actions.remove(old)
    act.name = name
    act.use_fake_user = True
    return act


# ---------------------------------------------------------------- export

def export(path, objects, webp_quality=88, sampled=False):
    """Export exactly `objects` (armature + meshes) with every action as a clip."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = next(o for o in objects if o.type == "ARMATURE") if any(o.type == "ARMATURE" for o in objects) else objects[0]
    kw = dict(
        filepath=path, export_format="GLB", use_selection=True,
        export_yup=True, export_apply=True,
        export_texcoords=True, export_normals=True, export_tangents=False,
        export_materials="EXPORT", export_image_format="WEBP", export_image_quality=webp_quality,
        export_skins=True, export_all_influences=False, export_def_bones=False,
        export_animations=True, export_animation_mode="ACTIONS", export_nla_strips=False,
        # Unsampled keeps exactly the curves we kept (see prune_static); every clip here is
        # already keyed on whole frames, so nothing is lost by not resampling.
        export_force_sampling=sampled, export_frame_step=1, export_optimize_animation_size=True,
        export_anim_single_armature=True, export_reset_pose_bones=True,
        export_morph=False, export_lights=False, export_cameras=False, export_extras=False,
    )
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kw = {k: v for k, v in kw.items() if k in props}
    bpy.ops.export_scene.gltf(**kw)
    log("exported", path, round(os.path.getsize(path) / 1e6, 2), "MB")


# ---------------------------------------------------------------- review

def contact_sheet(glb, out_png, height, frames_per_clip=3, cell=200, cols=9, props=(), fov=None, aspect=16 / 9):
    """Re-import an exported GLB and render each clip at a few frames into one image.

    Rendering from the exported file (not the working scene) is the point: it proves
    the clips and skinning survived the export. `props` are other GLBs shown with it
    at the same origin (the Goblin's glider), animated by their own first clip.
    `fov` (degrees, vertical) renders what a camera at the model's origin looking down
    glTF -Z sees, in `aspect` frames: for first-person models built in camera space.
    """
    import numpy as np
    reset()
    objs = imported(bpy.ops.import_scene.gltf, filepath=glb)
    arm = next(o for o in objs if o.type == "ARMATURE")
    clear_nla(arm)
    acts = sorted(bpy.data.actions, key=lambda a: a.name)
    for p in props:
        pobjs = imported(bpy.ops.import_scene.gltf, filepath=p)
        parm = next((o for o in pobjs if o.type == "ARMATURE"), None)
        if parm:
            clear_nla(parm)
            mine = [a for a in bpy.data.actions if a not in acts]
            if mine:
                use_action(parm, next((a for a in mine if "fly" in a.name), mine[0]))
    scene = bpy.context.scene
    bpy.context.view_layer.update()
    # The skinned vertices in the rest pose, not the objects' bounding boxes (those can be
    # far off for a skinned mesh under a scaled armature).
    rest(arm)
    dg = bpy.context.evaluated_depsgraph_get(); pts = []
    for o in bpy.data.objects:
        if o.type == "MESH" and o.visible_get():      # not the importer's hidden bone-shape sphere
            eo = o.evaluated_get(dg); me = eo.to_mesh()
            pts += [o.matrix_world @ v.co for v in me.vertices]
            eo.to_mesh_clear()
    zlo, zhi = min(p.z for p in pts), max(p.z for p in pts)
    height = max(height, zhi - zlo)
    mid = (zlo + zhi) / 2
    scene.render.engine = "BLENDER_EEVEE"
    scene.view_settings.view_transform = "AgX"
    cw, ch = (round(cell * aspect), cell) if fov else (cell, cell)
    scene.render.resolution_x, scene.render.resolution_y = cw, ch
    w = bpy.data.worlds.new("w"); scene.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.62, 0.66, 0.72, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.2; sun.rotation_euler = (0.9, 0.25, 0.7); scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scene.collection.objects.link(cam); scene.camera = cam
    if fov:
        cam.data.sensor_fit = "VERTICAL"; cam.data.angle_y = math.radians(fov); cam.data.clip_start = .02
        cam.location = (0, 0, 0); cam.rotation_euler = (math.pi / 2, 0, 0)      # glTF -Z is +Y here
        sun.rotation_euler = (-0.6, 0.35, 0.3)
        at, size = Vector((-math.tan(math.radians(fov) / 2) * aspect * .96, math.tan(math.radians(fov) / 2) * .8, -1.0)), .1
    else:
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = height * 1.6
        cam.location = (height * 1.2, -height * 3.0, mid + height * 0.25)
        cam.rotation_euler = (Vector((0, 0, mid)) - cam.location).to_track_quat("-Z", "Y").to_euler()
        at, size = Vector((-height * 0.76, height * 0.66, -1.0)), height * 0.09
    bpy.context.view_layer.update()
    font = bpy.data.curves.new("label", "FONT"); font.size = size
    label = bpy.data.objects.new("label", font); scene.collection.objects.link(label)
    label.rotation_euler = cam.rotation_euler
    label.location = cam.matrix_world @ at
    mat = bpy.data.materials.new("lbl"); mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0, 0, 0, 1)
    font.materials.append(mat)
    cols = cols or frames_per_clip * 2
    per_row = cols // frames_per_clip
    rows = math.ceil(len(acts) / per_row)
    sheet = np.ones((rows * ch, cols * cw, 4), dtype=np.float32)
    tmp = os.path.join(bpy.app.tempdir, "cell.png")
    for i, act in enumerate(acts):
        use_action(arm, act)
        f0, f1 = act.frame_range
        for k in range(frames_per_clip):
            f = f0 + (f1 - f0) * (k / max(1, frames_per_clip - 1))
            scene.frame_set(int(round(f)))
            font.body = "%s  %.1fs" % (act.name, (f1 - f0) / FPS) if k == 0 else ""
            scene.render.filepath = tmp
            bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(tmp)
            px = np.empty(cw * ch * 4, dtype=np.float32); img.pixels.foreach_get(px)
            bpy.data.images.remove(img)
            r, c = divmod(i, per_row)
            c = c * frames_per_clip + k
            y0 = (rows - 1 - r) * ch
            sheet[y0:y0 + ch, c * cw:(c + 1) * cw] = px.reshape(ch, cw, 4)
    out = bpy.data.images.new("sheet", cols * cw, rows * ch)
    out.pixels.foreach_set(sheet.ravel())
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    out.filepath_raw = out_png; out.file_format = "PNG"; out.save()
    log("sheet", out_png, len(acts), "clips")
