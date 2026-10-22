

def test_curator_labels_are_bounded_and_teasers_only_for_questionable_claims():
    from studiox_core.package import apply_label
    claim = {"id": "c", "type": "claim", "verdict": "NUANCED"}
    w = apply_label(claim, {"headline": "Midday naps cut heart strain by 37%", "teaser": "Does a nap really cut heart strain 37%?"})
    assert w["headline"].startswith("Midday") and w["teaser"].endswith("?")
    sup = apply_label({"id": "s", "type": "claim", "verdict": "SUPPORTED"}, {"headline": "h", "teaser": "q?"})
    assert "teaser" not in sup
    long = apply_label({"id": "p", "type": "protocol"}, {"headline": "word " * 40})
    assert len(long["headline"]) <= 70 and long["headline"].endswith("…")
