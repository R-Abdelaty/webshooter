"""Render a contact sheet of every clip in an exported model:
    blender --background --factory-startup --python game/tools/blender/sheet.py -- venom 2.5
    ... -- goblin 1.85 glider                  props shown with it at the same origin
    ... -- spiderman_arms 1.83 --fov 75        first person: from the model's origin, 16:9
Options: --fov DEG, --frames N (per clip), --cell PX (height of a frame), --cols N.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

args = sys.argv[sys.argv.index("--") + 1:]
opts, pos = {}, []
while args:
    a = args.pop(0)
    if a.startswith("--"):
        opts[a[2:]] = float(args.pop(0))
    else:
        pos.append(a)
cid, height = pos[0], float(pos[1])
props = [os.path.join(OUT, p + ".glb") for p in pos[2:]]
kw = {k: int(opts[k]) for k in ("cell", "cols") if k in opts}
if "frames" in opts:
    kw["frames_per_clip"] = int(opts["frames"])
contact_sheet(os.path.join(OUT, cid + ".glb"), os.path.join(SHEETS, cid + ".png"), height, props=props, fov=opts.get("fov"), **kw)
