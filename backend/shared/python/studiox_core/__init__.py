"""StudioX core: stdlib-only helpers shared by the agents and the Lambdas.

Packaged as a Lambda layer: the layer zip root is `backend/shared/` so the import path is
`python/studiox_core`.
"""

from .schema import validate_widget, validate_package  # noqa: F401
from .verdict import RULES_VERSION, decide_verdict  # noqa: F401
from .package import assemble_package  # noqa: F401
from . import transcript  # noqa: F401
