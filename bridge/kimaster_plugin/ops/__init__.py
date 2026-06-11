"""
Board operation modules — one file per operation.

Each op class exposes a single public method:
    result = Op(board, notify_fn).execute(data: dict) -> dict

The `notify_fn` is called with a dict to broadcast board_changed after
a successful write. Ops never import from each other.
"""

from .ViaStitch import ViaStitch
from .Teardrops import Teardrops
from .Panelize  import Panelize

__all__ = ["ViaStitch", "Teardrops", "Panelize"]
