"""The one place the pipeline imports studiox_core (Lambda layer from backend/shared/python)."""


def validate_widget(widget):
    """(clean_widget, reason). clean_widget is None when the widget fails the TV's schema."""
    from studiox_core import schema
    ok = schema.validate_widget(widget)
    return (ok, "") if ok is not None else (None, "failed validateWidget: " + schema.why_invalid(widget))


def assemble_package(**kwargs):
    from studiox_core import package
    return package.assemble_package(**kwargs)


def speech_stats(transcript):
    from studiox_core import transcript as tr
    return tr.speech_stats(transcript)
