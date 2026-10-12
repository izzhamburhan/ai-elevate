"""Inventory installed distribution metadata and preserve available upstream license files."""
from importlib.metadata import distributions
import json
from pathlib import Path

destination = Path("/reports")
destination.mkdir(exist_ok=True)
inventory = []
for distribution in sorted(distributions(), key=lambda d: d.metadata["Name"].casefold()):
    name = distribution.metadata["Name"]
    license_files = []
    for item in distribution.files or []:
        if any(part.lower() in {"licenses", "license", "license.txt", "license.md", "notice", "notice.txt"} for part in item.parts):
            original = Path(distribution.locate_file(item))
            if original.is_file():
                relative = Path(name) / str(item).replace("/", "__")
                output = destination / "third-party-notices" / relative
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(original.read_bytes())
                license_files.append(str(relative))
    license_text = distribution.metadata.get("License-Expression") or distribution.metadata.get("License", "")
    inventory.append({"name": name, "version": distribution.version, "license_metadata": license_text,
        "classifiers": [value for value in distribution.metadata.get_all("Classifier", []) if value.startswith("License ::")],
        "preserved_license_files": license_files})
(destination / "dependency-licenses.json").write_text(json.dumps(inventory, indent=2) + "\n")
print(json.dumps({"distributions": len(inventory), "notice_files": sum(len(x["preserved_license_files"]) for x in inventory),
                  "missing_license_metadata": [x["name"] for x in inventory if not x["license_metadata"] and not x["classifiers"]]}))
