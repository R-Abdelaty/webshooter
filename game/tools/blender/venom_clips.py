"""Clips Venom's rig lacks, built from ones it has. Shared by venom.py and rhino.py."""
from common import *


def hit_and_dodges(arm, src):
    """The clips Venom's rig lacks, built from ones it has. rhino.py builds these on Venom
    too and retargets them, so both brutes react the same way.

    hit: there is no light hit reaction, and KnockOut_F is a lying-down pose. The first
    third of Knockout is the recoil; flinch 60% of the way toward it and back.
    dodge_l/r: the dash is a leap that ends in the air, so land it and settle into idle.
    """
    idle0 = at(arm, src["Idle_C"], 0)
    recoil = at(arm, src["Knockout"], .3)
    bake(arm, "hit", [(1, idle0), (4, blend(idle0, recoil, .6)), (7, blend(idle0, recoil, .35)), (12, idle0)], interp="BEZIER")
    for side in ("L", "R"):
        frames = sequence(arm, [(src["103551_Dash_%s" % side], 0, 1), (src["Jump_Land_%sF_C" % side], 0, 1)],
                          xfade=3, settle=idle0, settle_frames=8)
        bake(arm, "dodge_" + side.lower(), [(i + 1, s) for i, s in enumerate(frames)])
