"""Deterministic verdict rules. The model only labels each source's stance; code decides.

Rules v2 (checked in this order, over the sources whose stance is not `irrelevant`):
  fewer than 2 usable sources              -> UNVERIFIED
  >=2 contradicts and 0 supports           -> DEBUNKED, but only if at least 2 of the
                                              contradicting sources are authoritative
                                              (journals, .gov/.edu, NIH, WHO...); else NUANCED
  >=2 supports and 0 contradicts           -> SUPPORTED
  supports and contradicts both present    -> DISPUTED
  otherwise (>=1 mixed, or one side only)  -> NUANCED
"""

from __future__ import annotations

from collections import Counter
from typing import Iterable

RULES_VERSION = "v2"
STANCES = ("supports", "contradicts", "mixed", "irrelevant")


def count_stances(stances: Iterable[str]) -> Counter:
    c = Counter()
    for s in stances:
        c[s if s in STANCES else "irrelevant"] += 1
    return c


# Calling a guest's claim DEBUNKED on screen is the strongest thing StudioX says, so it
# needs evidence a reviewer would accept, not two wellness blogs (seen in a seed run).
AUTHORITATIVE_SUFFIXES = (".gov", ".edu", ".int", ".gov.uk", ".nhs.uk", ".ac.uk", ".gc.ca", ".gov.au")
AUTHORITATIVE_HOSTS = {
    "cochrane.org", "cochranelibrary.com", "nature.com", "science.org", "thelancet.com",
    "nejm.org", "bmj.com", "jamanetwork.com", "sciencedirect.com", "springer.com",
    "wiley.com", "frontiersin.org", "plos.org", "oup.com", "cell.com", "mayoclinic.org",
    "clevelandclinic.org",
}


def is_authoritative(url: str | None) -> bool:
    if not url or not url.startswith("https://"):
        return False
    host = url[8:].split("/", 1)[0].split(":", 1)[0].lower()
    if host.endswith(AUTHORITATIVE_SUFFIXES):
        return True
    parts = host.split(".")
    return any(".".join(parts[i:]) in AUTHORITATIVE_HOSTS for i in range(len(parts) - 1))


def decide_verdict(stances: Iterable[str], urls: Iterable[str | None] | None = None) -> str:
    """`urls`, when given, lines up with `stances` (one source URL per stance)."""
    stances = list(stances)
    urls = list(urls) if urls is not None else [None] * len(stances)
    c = count_stances(stances)
    sup, con, mix = c["supports"], c["contradicts"], c["mixed"]
    if sup + con + mix < 2:
        return "UNVERIFIED"
    if con >= 2 and sup == 0:
        strong = sum(1 for s, u in zip(stances, urls) if s == "contradicts" and is_authoritative(u))
        return "DEBUNKED" if strong >= 2 else "NUANCED"
    if sup >= 2 and con == 0:
        return "SUPPORTED"
    if sup and con:
        return "DISPUTED"
    return "NUANCED"
