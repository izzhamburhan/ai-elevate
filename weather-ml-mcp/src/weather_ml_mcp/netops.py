"""Read-only adapter to the existing inventory; synthetic telecom data stays labeled."""
import httpx

from .config import Settings
from .data import validate_coordinates
from .errors import WeatherError


class NetOpsInventory:
    def __init__(self, settings: Settings, client=None):
        self.settings = settings
        self.client = client

    def _get(self, path: str, params: dict):
        own = self.client is None
        client = self.client or httpx.Client(timeout=10)
        try:
            response = client.get(f"{self.settings.netops_url}/api/{path}", params=params)
            response.raise_for_status()
            payload = response.json()
            if payload.get("ok") is False or not isinstance(payload.get("items"), list):
                raise ValueError("Unexpected inventory response")
            return payload
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            raise WeatherError("NETOPS_UNAVAILABLE", "NetOps inventory unavailable; weather location forecasts remain usable", status=503) from exc
        finally:
            if own:
                client.close()

    def sites(self, region=None):
        page, items = 1, []
        while len(items) < self.settings.netops_max_sites:
            params = {"technology": "4g", "page": page, "page_size": min(200, self.settings.netops_max_sites-len(items))}
            if region and region != "all":
                params["region"] = region
            payload = self._get("get_sites", params)
            items.extend(payload["items"])
            if not payload["items"] or page >= payload.get("total_pages", 1):
                break
            page += 1
        return [self._validate_site(site) for site in items]

    def by_ids(self, site_ids: list[str]):
        if not site_ids or len(site_ids) > 25 or any(not isinstance(s, str) or not 2 <= len(s) <= 128 for s in site_ids):
            raise WeatherError("INVALID_SITE_IDS", "Provide 1–25 full site IDs, each 2–128 characters")
        sites = []
        for site_id in dict.fromkeys(site_ids):
            result = self._get("search_sites", {"site_id": site_id, "page": 1, "page_size": 200})
            matches = [item for item in result["items"] if str(item.get("site_id", "")).casefold() == site_id.casefold()]
            if not matches:
                raise WeatherError("SITE_NOT_FOUND", f"No exact NetOps inventory match for site ID {site_id}", status=404)
            sites.extend(self._validate_site(item) for item in matches)
        return sites

    @staticmethod
    def _validate_site(site):
        try:
            latitude, longitude = float(site["latitude"]), float(site["longitude"])
            validate_coordinates(latitude, longitude)
            return {**site, "latitude": latitude, "longitude": longitude, "synthetic_network_data": True,
                    "network_source": "Existing AI Elevate NetOps synthetic telecom inventory"}
        except (ValueError, KeyError, TypeError) as exc:
            raise WeatherError("INVALID_SITE_COORDINATES", "NetOps returned invalid site geography") from exc
