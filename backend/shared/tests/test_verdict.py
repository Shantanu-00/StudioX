import pytest
from studiox_core.verdict import RULES_VERSION, decide_verdict, is_authoritative


@pytest.mark.parametrize("stances,expected", [
    ([], "UNVERIFIED"),
    (["supports"], "UNVERIFIED"),
    (["supports", "irrelevant", "irrelevant"], "UNVERIFIED"),
    (["contradicts", "contradicts"], "NUANCED"),  # no URLs: not enough to debunk
    (["supports", "supports"], "SUPPORTED"),
    (["supports", "supports", "mixed", "irrelevant"], "SUPPORTED"),
    (["supports", "contradicts"], "DISPUTED"),
    (["supports", "supports", "contradicts"], "DISPUTED"),
    (["supports", "mixed"], "NUANCED"),
    (["mixed", "mixed"], "NUANCED"),
    (["contradicts", "mixed"], "NUANCED"),
    (["bogus", "supports", "supports"], "SUPPORTED"),
])
def test_rules(stances, expected):
    assert decide_verdict(stances) == expected


J = "https://pubmed.ncbi.nlm.nih.gov/1"
BLOG = "https://superpower.com/blog/apigenin"


@pytest.mark.parametrize("stances,urls,expected", [
    (["contradicts", "contradicts"], [J, "https://www.bmj.com/x"], "DEBUNKED"),
    (["contradicts", "contradicts", "mixed"], [J, "https://who.int/a", BLOG], "DEBUNKED"),
    (["contradicts", "contradicts"], [BLOG, "https://sacredlotus.com/x"], "NUANCED"),
    (["contradicts", "contradicts"], [J, BLOG], "NUANCED"),
    (["supports", "supports"], [BLOG, BLOG], "SUPPORTED"),
])
def test_debunked_needs_authoritative_sources(stances, urls, expected):
    assert decide_verdict(stances, urls=urls) == expected


def test_authoritative_hosts():
    assert is_authoritative("https://pmc.ncbi.nlm.nih.gov/articles/1")
    assert is_authoritative("https://www.health.harvard.edu/x")
    assert is_authoritative("https://www.frontiersin.org/articles/1")
    assert not is_authoritative("https://superpower.com/x")
    assert not is_authoritative("http://pubmed.ncbi.nlm.nih.gov/1")
    assert not is_authoritative("https://evil-nih.gov.example.com/x")


def test_version():
    assert RULES_VERSION == "v2"
