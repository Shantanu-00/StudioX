"""Tiny method + regex path router."""
import re


class Router:
    def __init__(self):
        self._routes = []

    def add(self, method, pattern, fn):
        regex = re.compile("^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", pattern) + "/?$")
        self._routes.append((method, regex, fn))

    def route(self, method, pattern):
        def deco(fn):
            self.add(method, pattern, fn)
            return fn
        return deco

    def match(self, method, path):
        """Returns (fn, params, path_known). fn is None if no route for this method."""
        known = False
        for m, regex, fn in self._routes:
            hit = regex.match(path)
            if hit:
                known = True
                if m == method:
                    return fn, hit.groupdict(), True
        return None, {}, known


def strip_prefix(path, prefix="/v1"):
    if path == prefix:
        return "/"
    return path[len(prefix):] if path.startswith(prefix + "/") else path
