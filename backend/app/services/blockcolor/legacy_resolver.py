"""
Legacy 1.7.10 block texture resolver.

Resolves texture keys for old mods that do not ship blockstate JSON files
by generating all plausible texture key candidates from naming conventions
and selecting the highest-scoring match from the available texture database.

No per-block overrides are used here.  The _OVERRIDES dict in vanilla_tables.py
handles the truly exceptional cases (minecraft grass, GT ores, Chisel path separators).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

# ── Name prefix stripping ─────────────────────────────────────────────────────
# Tried most-specific first.  Each prefix is stripped once (single) and also
# tried in combination with a second prefix (double) to handle names like
# "tile.blockCharger" → strip "tile." → "blockCharger" → strip "block" → "charger".
# fmt: off
_NAME_PREFIXES: list[str] = [
    "gt.block",    # GregTech: "gt.blockOres" → "ores"
    "gt.tile",     # GregTech tile entities
    "tile.block",  # AE2, Thermal: "tile.blockCharger" → "charger"
    "block.",      # ExtraUtils: "block.extrautils.coloredwood"
    "tile.",       # AE2: "tile.OreQuartz" → "OreQuartz"
    "block",       # IC2, TE, BC: "blockGenerator" → "generator"
]
# fmt: on

# ── Suffix scoring ─────────────────────────────────────────────────────────────
# Base (suffix, score) before family-specific adjustments.
# Higher score = more preferred for a top-down map view.
# _top is the explicit top face; "" (no suffix) is often the primary texture.
# fmt: off
_SUFFIX_BASE_SCORES: list[tuple[str, int]] = [
    ("_top",       50),
    ("",           45),
    ("_front",     40),
    ("_active",    37),
    ("_on",        35),
    ("_normal",    33),
    ("_side",      28),
    ("_0",         22),
    ("_1",         21),
    ("_2",         20),
    ("_3",         19),
    ("_4",         18),
    ("_5",         17),
    ("_6",         16),
    ("_7",         15),
    ("_8",         14),
    ("_9",         13),
    ("_10",        12),
    ("_11",        11),
    ("_12",        10),
    ("_13",         9),
    ("_14",         8),
    ("_15",         7),
    ("_off",        5),
    ("_inactive",   4),
    ("_back",       3),
    ("_bottom",     2),
    ("_inner",      1),
    # Direct-digit suffixes (no underscore) — Botania style: "livingrock0", "livingwood0"
    # Lower score than underscore variants so they only win when no _N form exists.
    ("0",           6),
    ("1",           5),
    ("2",           4),
    ("3",           3),
    ("4",           2),
    ("5",           1),
]
# fmt: on

# ── Bad-match penalties ────────────────────────────────────────────────────────
# Subtracted from a candidate's score when the texture key name contains these
# substrings.  Non-block textures (item icons, GUI elements, particle sprites,
# CTM overlays) sometimes live in assets/{mod}/textures/blocks/ but should never
# be picked as the representative block texture for a top-down map.
#
# Penalties are additive; a key can accumulate multiple penalties.
# A penalised key can still win if it is the ONLY match (penalty may push score
# negative, but we compare relative to other candidates — if all have the same
# penalty it doesn't matter).
# fmt: off
_BAD_MATCH_PENALTIES: list[tuple[str, int]] = [
    ("_item",         -100),
    ("item_",         -100),
    ("_icon",         -100),
    ("icon_",         -100),
    ("_gui",           -80),
    ("gui_",           -80),
    ("_inventory",    -100),
    ("inventory_",    -100),
    ("_overlay",       -45),
    ("overlay_",       -35),
    ("_particle",      -70),
    ("particle_",      -60),
    ("_mask",          -50),
    ("mask_",          -40),
    ("_ctm",           -30),
    ("ctm_",           -20),
    ("_connected",     -25),
    ("connected_",     -15),
    ("_fluid_flow",    -55),
    ("_fluid_still",   -35),
]
# fmt: on

# ── Block family detection ─────────────────────────────────────────────────────
# Pattern → family name.  Matched against the full lower-case registry name
# (before any prefix stripping).
_FAMILY_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # Logs and wood — bark (_side) is more map-readable than cross-section rings (_top)
    (re.compile(r"\b(log|plank|wood)\b"), "log"),
    # Machines / tech — distinctive top face is most informative from directly above
    (
        re.compile(
            r"\b(machine|generator|furnace|reactor|pump|miner|laser|assembl"
            r"|refin|distill|electrol|motor|compressor|centrifuge|extruder"
            r"|bending|wiremill|amplifier|drain)\b"
        ),
        "machine",
    ),
    # Ores — plain texture (no suffix) is usually correct
    (re.compile(r"\b(ore|mineral)\b"), "ore"),
    # Fluid containers — avoid still/flow animation textures
    (re.compile(r"\b(tank|drum|fluid|oil|fuel)\b"), "fluid"),
]

# Suffix score adjustments per family (delta added to base suffix score)
# fmt: off
_FAMILY_SUFFIX_ADJUST: dict[str, dict[str, int]] = {
    "log": {
        "_side":   +18,   # bark texture more distinctive on map
        "_top":    -10,   # rings look generic and hard to identify on map
    },
    "machine": {
        "_top":    +8,    # machines typically have a distinctive top face
        "_front":  +3,
    },
    "ore": {
        "":        +8,    # base ore texture (e.g. oreCopper) is often the right one
        "_top":    -5,    # ore tops usually just look like stone
    },
    "fluid": {
        "_still":  -80,   # never pick "still" fluid animation for a block
        "_flow":   -80,
        "_fluid_still": -80,
        "_fluid_flow":  -80,
    },
}
# fmt: on

# Ambiguity threshold: if best minus second-best score ≤ this, mark as ambiguous
_AMBIGUITY_GAP = 8

# Confidence thresholds (based on combined form_score + suffix_score of best match)
# fmt: off
_CONFIDENCE_HIGH   = 120   # strongly-normalised form + good suffix
_CONFIDENCE_MEDIUM = 75    # some normalisation, plausible suffix
# fmt: on


def _camel_to_snake(s: str) -> str:
    """'blockGenerator' → 'block_generator', 'QuartzOre' → 'quartz_ore'."""
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s).lower()


def _detect_family(lower_name: str) -> str | None:
    """Detect block family from registry name for suffix score adjustments."""
    for pattern, family in _FAMILY_PATTERNS:
        if pattern.search(lower_name):
            return family
    return None


def _bad_match_penalty(key_name: str) -> int:
    """Return total penalty for non-block textures (negative int or 0)."""
    total = 0
    for term, pts in _BAD_MATCH_PENALTIES:
        if term in key_name:
            total += pts
    return total


@dataclass
class LegacyResult:
    texture_key: str | None
    failure_reason: str
    confidence: str = "low"  # "high" | "medium" | "low"
    is_ambiguous: bool = False
    candidates_tried: int = 0
    best_score: int = -1
    top_candidates: list[dict[str, object]] = field(default_factory=list)
    trace: list[str] = field(default_factory=list)

    @property
    def resolved(self) -> bool:
        return self.texture_key is not None

    @property
    def method_tag(self) -> str:
        """Compact tag for pipeline report: 'legacy_high', 'legacy_ambiguous', etc."""
        if not self.resolved:
            return "none"
        tag = f"legacy_{self.confidence}"
        if self.is_ambiguous:
            tag += "_ambiguous"
        return tag


def resolve_legacy_texture(
    registry_name: str,
    texture_colors: dict[str, Any],
    meta: int = 0,
) -> LegacyResult:
    """
    Resolve a texture key for a 1.7.10 block using naming conventions.

    Generates all plausible (domain, name_form, suffix) combinations, scores them,
    and returns the highest-scoring match found in texture_colors.

    Scoring:
      total_score = form_score + suffix_score + family_adjust + bad_match_penalty

    Form scores (before suffix):
      100  double-prefix stripped  ("tile.blockCharger" → "charger")
       85  single-prefix stripped  ("blockGenerator" → "generator")
       50  dot-notation last seg   ("block.extrautils.coloredwood" → "coloredwood")
       35  trailing-number stripped (no prefix)
       30  lowercase original

    In all cases the snake_case variant gets +3 ("quartz_ore" preferred over "quartzore").
    Dot→slash variants (for subdir textures) get -2.

    Confidence:
      high    total_score >= 120, no bad-match penalty
      medium  total_score >= 75
      low     anything that resolves but below medium threshold

    Ambiguity:
      is_ambiguous = True when best score − second-best score ≤ 8 points
    """
    result = LegacyResult(texture_key=None, failure_reason="")

    if ":" not in registry_name:
        result.failure_reason = "no_colon"
        return result

    raw_domain, orig_name = registry_name.split(":", 1)
    lower_name = orig_name.lower()
    raw_domain_lower = raw_domain.lower()
    parts = raw_domain_lower.split("|")
    clean_domain = parts[0]  # BuildCraft|Factory → buildcraft

    # Deduplicated list of domains to try (clean first, then joined form, then raw)
    seen: set[str] = {clean_domain}
    domains: list[str] = [clean_domain]
    # Pipe-joined form: "BuildCraft|Factory" → "buildcraftfactory"
    # Handles all BuildCraft sub-modules whose textures live under "buildcraft{module}".
    if len(parts) > 1:
        joined = "".join(parts)
        if joined not in seen:
            domains.append(joined)
            seen.add(joined)
    if raw_domain_lower not in seen:
        domains.append(raw_domain_lower)
        seen.add(raw_domain_lower)

    # Detect block family for suffix adjustments
    family = _detect_family(lower_name)
    family_adjust = _FAMILY_SUFFIX_ADJUST.get(family or "", {})

    # Build suffix score table with family adjustments applied
    suffix_scores: list[tuple[str, int]] = [
        (suf, base + family_adjust.get(suf, 0)) for suf, base in _SUFFIX_BASE_SCORES
    ]

    # ── Form collection ────────────────────────────────────────────────────────
    # Maps lowercase form → best form_score seen so far.
    form_scores: dict[str, int] = {}

    def _add_form(lower: str, orig: str, score: int) -> None:
        """Register a name form plus its snake_case and dot→slash variants."""
        if not lower:
            return
        if score > form_scores.get(lower, -1):
            form_scores[lower] = score
        snake = _camel_to_snake(orig).lower()
        if snake != lower:
            s = score + 3
            if s > form_scores.get(snake, -1):
                form_scores[snake] = s
        slash = lower.replace(".", "/")
        if slash != lower:
            s = score - 2
            if s > form_scores.get(slash, -1):
                form_scores[slash] = s

    # Base: lowercase original
    _add_form(lower_name, orig_name, 30)

    # Trailing-number strip (no prefix stripping)
    stripped_num = re.sub(r"\d+$", "", lower_name)
    if stripped_num and stripped_num != lower_name:
        _add_form(stripped_num, re.sub(r"\d+$", "", orig_name), 35)

    # Dot-notation last/penultimate segment
    if "." in lower_name:
        parts_l = lower_name.split(".")
        parts_o = orig_name.split(".")
        _add_form(parts_l[-1], parts_o[-1] if parts_o else parts_l[-1], 50)
        if len(parts_l) >= 2:
            _add_form(
                ".".join(parts_l[-2:]),
                ".".join(parts_o[-2:]) if len(parts_o) >= 2 else ".".join(parts_l[-2:]),
                40,
            )

    # Single-prefix-stripped forms
    for prefix in _NAME_PREFIXES:
        if not lower_name.startswith(prefix) or len(lower_name) <= len(prefix):
            continue
        tail_l = lower_name[len(prefix) :]
        tail_o = orig_name[len(prefix) :] if len(orig_name) > len(prefix) else tail_l
        _add_form(tail_l, tail_o, 85)

        tail_no_num = re.sub(r"\d+$", "", tail_l)
        if tail_no_num and tail_no_num != tail_l:
            _add_form(tail_no_num, re.sub(r"\d+$", "", tail_o), 80)

        # Double-prefix-stripped forms
        for prefix2 in _NAME_PREFIXES:
            if prefix2 == prefix or not tail_l.startswith(prefix2) or len(tail_l) <= len(prefix2):
                continue
            tail2_l = tail_l[len(prefix2) :]
            tail2_o = tail_o[len(prefix2) :] if len(tail_o) > len(prefix2) else tail2_l
            if not tail2_l:
                continue
            _add_form(tail2_l, tail2_o, 100)
            tail2_no_num = re.sub(r"\d+$", "", tail2_l)
            if tail2_no_num and tail2_no_num != tail2_l:
                _add_form(tail2_no_num, re.sub(r"\d+$", "", tail2_o), 95)

    # ── Candidate scoring ──────────────────────────────────────────────────────
    # Collect ALL (key, score) pairs that exist in texture_colors, then find top-N.
    existing_hits: list[tuple[str, int]] = []
    candidate_count = 0

    for domain in domains:
        for form, form_score in form_scores.items():
            # Meta-specific candidate when meta > 0 (between _top and _0 priority)
            if meta > 0:
                key = f"{domain}:{form}_{meta}"
                candidate_count += 1
                if key in texture_colors:
                    penalty = _bad_match_penalty(key)
                    total = form_score + 26 + penalty
                    existing_hits.append((key, total))

            for suffix, suffix_score in suffix_scores:
                key = f"{domain}:{form}{suffix}"
                candidate_count += 1
                if key in texture_colors:
                    penalty = _bad_match_penalty(key)
                    total = form_score + suffix_score + penalty
                    existing_hits.append((key, total))

    result.candidates_tried = candidate_count

    if not existing_hits:
        result.failure_reason = "no_candidate_in_db"
        result.trace = [f"No match in texture DB ({candidate_count} candidates tried)"]
        return result

    # Sort hits by score descending, keep unique keys (same key may appear from
    # multiple domains/forms — keep the highest score for each)
    seen_keys: dict[str, int] = {}
    for key, score in existing_hits:
        if score > seen_keys.get(key, -9999):
            seen_keys[key] = score
    sorted_hits = sorted(seen_keys.items(), key=lambda x: x[1], reverse=True)

    best_key, best_score = sorted_hits[0]
    second_score = sorted_hits[1][1] if len(sorted_hits) > 1 else best_score - 999

    # Confidence
    raw_base_score = best_score - _bad_match_penalty(best_key)  # exclude penalty
    if raw_base_score >= _CONFIDENCE_HIGH and _bad_match_penalty(best_key) == 0:
        confidence = "high"
    elif raw_base_score >= _CONFIDENCE_MEDIUM:
        confidence = "medium"
    else:
        confidence = "low"

    # Ambiguity: gap between best and second-best
    is_ambiguous = (best_score - second_score) <= _AMBIGUITY_GAP

    # Top candidates for diagnostics (cap at 8)
    top_candidates: list[dict[str, object]] = [
        {"key": k, "score": s, "notes": _describe_penalty(k)} for k, s in sorted_hits[:8]
    ]

    # Trace lines
    trace_lines = [
        f"Resolved: {best_key} (score={best_score}, confidence={confidence}"
        + (", AMBIGUOUS" if is_ambiguous else "")
        + ")",
        f"Family: {family or 'generic'} | forms tried: {len(form_scores)} | "
        f"candidates: {candidate_count} | hits: {len(sorted_hits)}",
    ]
    for i, (k, s) in enumerate(sorted_hits[:6], 1):
        chosen = " ← chosen" if k == best_key else ""
        notes = _describe_penalty(k)
        trace_lines.append(f"  {i}. {k}  score={s}{notes}{chosen}")

    result.texture_key = best_key
    result.failure_reason = ""
    result.confidence = confidence
    result.is_ambiguous = is_ambiguous
    result.best_score = best_score
    result.top_candidates = top_candidates
    result.trace = trace_lines
    return result


def _describe_penalty(key: str) -> str:
    """Return a short human-readable note about any bad-match penalty on this key."""
    hits = [term for term, _ in _BAD_MATCH_PENALTIES if term in key]
    if not hits:
        return ""
    return f" [penalty: {', '.join(hits)}]"
