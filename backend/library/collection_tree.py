"""The collection tree: nested collections (folders) as a flat list plus ``parent_id``.

docs/plans/library-finder.md §2. Pure and model-free: every helper takes anything
with ``id``, ``name`` and ``parent_id`` (a :class:`~collection_store.Collection`),
so ``collection_store`` can import this module and never the other way round.

Rules this module holds:

* **Depth counts levels from the root**: a top-level collection is depth 1, and
  a move is judged by the depth its *deepest* descendant would land at
  (``depth_of(parent) + subtree_height(moving)``), so a whole subtree fits or
  none of it moves.
* **The file must be a forest**: a dangling ``parent_id`` or a cycle makes the
  file unreadable (:func:`tree_problem`), never a silently flattened tree.
* Every walk carries a visited set, so even a list that was never validated
  cannot loop forever.
"""

from __future__ import annotations

from typing import Mapping, Optional, Protocol, Sequence, TypeVar

from backend.library.errors import CollectionCycle, CollectionTooDeep, UnknownParent

#: How many levels collections may nest; a top-level collection is level 1.
MAX_COLLECTION_DEPTH = 8


class TreeNode(Protocol):
    @property
    def id(self) -> str: ...
    @property
    def name(self) -> str: ...
    @property
    def parent_id(self) -> Optional[str]: ...


Node = TypeVar("Node", bound=TreeNode)


def _by_id(nodes: Sequence[Node]) -> dict[str, Node]:
    return {node.id: node for node in nodes}


def ancestry(nodes: Sequence[Node], node_id: str) -> tuple[Node, ...]:
    """The chain from the top-level ancestor down to ``node_id``, itself last.

    ``()`` for an unknown id. A dangling parent ends the chain where it breaks;
    a cycle ends it before the repeat (a validated file has neither).
    """
    index = _by_id(nodes)
    chain: list[Node] = []
    seen: set[str] = set()
    current = index.get(node_id)
    while current is not None and current.id not in seen:
        seen.add(current.id)
        chain.append(current)
        current = index.get(current.parent_id) if current.parent_id is not None else None
    return tuple(reversed(chain))


def children_of(nodes: Sequence[Node], node_id: str) -> tuple[Node, ...]:
    """The direct subfolders of ``node_id``, in list order."""
    return tuple(node for node in nodes if node.parent_id == node_id)


def descendant_ids(nodes: Sequence[TreeNode], node_id: str) -> frozenset[str]:
    """Every id below ``node_id`` at any depth, never ``node_id`` itself."""
    found: set[str] = set()
    frontier = [node_id]
    while frontier:
        parent = frontier.pop()
        for child in children_of(nodes, parent):
            if child.id not in found and child.id != node_id:
                found.add(child.id)
                frontier.append(child.id)
    return frozenset(found)


def depth_of(nodes: Sequence[TreeNode], node_id: str) -> int:
    """1 for a top-level collection, 2 inside it…; 0 for an unknown id."""
    return len(ancestry(nodes, node_id))


def subtree_height(nodes: Sequence[TreeNode], node_id: str) -> int:
    """Levels in ``node_id``'s subtree, itself included: 1 for a leaf."""
    base = depth_of(nodes, node_id)
    deepest = max((depth_of(nodes, d) for d in descendant_ids(nodes, node_id)), default=base)
    return deepest - base + 1


def collection_path(nodes: Sequence[TreeNode], node_id: str) -> list[str]:
    """Names from the top-level ancestor down to ``node_id``; ``[]`` when unknown."""
    return [node.name for node in ancestry(nodes, node_id)]


def total_members(
    nodes: Sequence[TreeNode], member_counts: Mapping[str, int], node_id: str
) -> int:
    """Videos in ``node_id`` plus every descendant (direct membership summed)."""
    ids = {node_id, *descendant_ids(nodes, node_id)}
    return sum(member_counts.get(each, 0) for each in ids)


def check_placement(
    nodes: Sequence[TreeNode], moving_id: Optional[str], parent_id: Optional[str]
) -> None:
    """Raise when ``parent_id`` cannot hold ``moving_id`` (``None`` = a new collection).

    Checked in this order, so each refusal names the first thing wrong: an
    unknown parent, a cycle, then the depth. ``parent_id=None`` (the root) is
    always a legal place.
    """
    if parent_id is None:
        return
    if parent_id not in _by_id(nodes):
        raise UnknownParent(parent_id)
    if moving_id is not None and (
        parent_id == moving_id or parent_id in descendant_ids(nodes, moving_id)
    ):
        raise CollectionCycle(moving_id, parent_id)
    height = subtree_height(nodes, moving_id) if moving_id is not None else 1
    if depth_of(nodes, parent_id) + height > MAX_COLLECTION_DEPTH:
        raise CollectionTooDeep(parent_id, MAX_COLLECTION_DEPTH)


def tree_problem(nodes: Sequence[TreeNode]) -> Optional[str]:
    """Why ``nodes`` is not a forest (a dangling parent or a cycle), or None."""
    index = _by_id(nodes)
    for node in nodes:
        if node.parent_id is not None and node.parent_id not in index:
            return (
                f"collection {node.id!r} names a parent_id {node.parent_id!r} "
                "that does not exist"
            )
    for node in nodes:
        seen = {node.id}
        current = node.parent_id
        while current is not None:
            if current in seen:
                return f"the parent_ids above collection {node.id!r} loop back on themselves"
            seen.add(current)
            current = index[current].parent_id
    return None
