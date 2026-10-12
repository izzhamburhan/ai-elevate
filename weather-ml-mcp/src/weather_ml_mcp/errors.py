"""Safe machine-readable service errors; do not expose upstream payloads or URLs."""


class WeatherError(Exception):
    def __init__(self, code: str, message: str, *, status: int = 422):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status

    def response(self):
        return {"ok": False, "error": {"code": self.code, "message": self.message}, "research_only": True}
