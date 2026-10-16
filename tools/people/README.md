# People model

`client/models/people.glb` and its `people-*.png` maps are built by `build.py` from the
[MakeHuman](http://www.makehumancommunity.org/) assets (base mesh, macro targets, default
skeleton and weights, high-poly eyes), which the MakeHuman team released under **CC0**
(see `LICENSE.ASSETS.md` in the MakeHuman source). No MakeHuman code is used or shipped.

To rebuild, download the MakeHuman 1.x source release, then:

    python3 tools/people/build.py <makehuman>/makehuman/data client/models

Needs Python 3 with numpy and Pillow.
