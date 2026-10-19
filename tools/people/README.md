# People model

`client/models/people.glb` and its `people-*.png` maps are built by `build.py` from the
[MakeHuman](http://www.makehumancommunity.org/) assets (base mesh, macro targets, default
skeleton and weights, high-poly eyes), which the MakeHuman team released under **CC0**
(see `LICENSE.ASSETS.md` in the MakeHuman source). No MakeHuman code is used or shipped.

To rebuild, download the MakeHuman 1.x source release, then:

    python3 tools/people/build.py <makehuman>/makehuman/data client/models

Needs Python 3 with numpy and Pillow.

## Animations

`client/models/people-anims.json` holds motion-captured clips retargeted onto our skeleton by
`anims.py`: idle, walk, run, agree (nod), headShake, sneak and sad poses from three.js's example
`Xbot.glb`, and a samba from `Michelle.glb` (both rigged and animated with
[Mixamo](https://www.mixamo.com/), royalty-free for use in games):

    python3 tools/people/anims.py client/models/people.glb client/models/people-anims.json Xbot.glb Michelle.glb

The files are in three.js's repository under `examples/models/gltf/`. Rebuild the animations
whenever `people.glb` is rebuilt.

## Hair and skin

Long hair, bobs and ponytails are hair cards grown by `build.py`: strands start on the scalp,
fall under gravity and slide over the head, shoulders and back. Skin tones follow a measured
scale from very fair to very dark with undertones, and `people-skin.png` adds flushing,
creases, freckles and mottling.
