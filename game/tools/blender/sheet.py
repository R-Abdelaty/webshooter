"""Render a contact sheet of every clip in an exported model:
    blender --background --factory-startup --python game/tools/blender/sheet.py -- venom 2.5
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

args = sys.argv[sys.argv.index("--") + 1:]
cid, height = args[0], float(args[1])
props = [os.path.join(OUT, p + ".glb") for p in args[2:]]
contact_sheet(os.path.join(OUT, cid + ".glb"), os.path.join(SHEETS, cid + ".png"), height, props=props)
