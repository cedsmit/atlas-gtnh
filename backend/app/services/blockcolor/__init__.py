"""Block → colour / texture resolution subsystem.

Resolves a block (registry name + metadata) to a colour and texture key via the
blockstate→model→texture pipeline, the Forge icon dump, and legacy heuristics,
backed by per-world caches in BlockColorService.
"""
