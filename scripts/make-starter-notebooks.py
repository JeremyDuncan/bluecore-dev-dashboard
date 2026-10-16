"""Writes the starter notebooks in mcp/starter-notebooks/ (the Notebooks page's "Start from" list).

    python3 scripts/make-starter-notebooks.py

Each starter is one use case, grouped by purpose (metadata.bluecore.group, shown on the Notebooks page).
They import docker/jupyter/bluecore.py, so they run against the notebook's environment: the local
stack, or a deployed one (dev, stage) read-only. Notebooks that write stop on a deployed environment
(bc.require_writable()) and delete the records they create. Edit the cells here, not the .ipynb files.
"""

import json
import pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "mcp" / "starter-notebooks"


def cell(kind, src, n):
    lines = src.strip("\n").split("\n")
    c = {"cell_type": kind, "id": f"c{n:02d}", "metadata": {}, "source": [line + "\n" for line in lines[:-1]] + [lines[-1]]}
    if kind == "code":
        c.update(execution_count=None, outputs=[])
    return c


def notebook(name, title, group, cells):
    doc = {
        "cells": [cell(k, s, i) for i, (k, s) in enumerate(cells)],
        "metadata": {
            "kernelspec": {"display_name": "Python 3 (ipykernel)", "language": "python", "name": "python3"},
            "language_info": {"name": "python"},
            "bluecore": {"title": title, "group": group},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    (OUT / f"{name}.ipynb").write_text(json.dumps(doc, indent=1) + "\n")
    return name


md = lambda s: ("markdown", s)  # noqa: E731
code = lambda s: ("code", s)  # noqa: E731

CHECK, API, LOAD, DEBUG = "Check the stack", "Blue Core API", "Load and export", "Debug"

TARGET_NOTE = (
    "Runs against the notebook's environment: your local stack, or a deployed one (dev, stage), which it only reads. "
    "Pick it on the Notebooks page, or call `target(\"dev\")`."
)
LOCAL_ONLY = (
    "**Local stack only.** It creates records and deletes them again at the end, so it stops on dev and stage, "
    "which are shared. Signing in uses your stack's API login (`API_KEYCLOAK_USER`, from the stack checkout), "
    "with the API's `create` and `update` roles."
)

SETUP = code('''
# Your local stack, or dev / stage: pick it on the Notebooks page.
from bluecore import DASHBOARD_API, show, target
bc = target()
bc
''')

SETUP_WRITE = code('''
import json, uuid
from bluecore import show, target
bc = target()
bc.require_writable()               # stops here on dev and stage
AUTH = bc.auth_headers()            # a Keycloak token for your stack's API login
LD = {**AUTH, "Content-Type": "application/ld+json"}   # a raw JSON-LD body
RUN = uuid.uuid4().hex[:8]          # marks this run's records: https://example.org/notebook/<RUN>/...
bc
''')

made = []

# --- Check the stack --------------------------------------------------------------------------------

made.append(notebook("01-stack-health", "Stack health check", CHECK, [
    md("# Stack health check\nIs each service of Bluecore up, and which version is it running compared with the latest release?\n\n" + TARGET_NOTE),
    SETUP,
    md("## Health endpoints\nThe same health paths the dashboard's Version Drift page checks, plus Keycloak's `bluecore` realm."),
    code('''
import time
import pandas as pd
import requests

CHECKS = {
    "Blue Core API": "/api/health",
    "Workflows (Airflow)": "/workflows/health",
    "Sinopia": "/sinopia/health",
    "Marva": "/marva/health",
    "Keycloak (bluecore realm)": "/keycloak/realms/bluecore/.well-known/openid-configuration",
}

rows = []
for name, path in CHECKS.items():
    started = time.monotonic()
    try:
        r = bc.get(path, timeout=10)
        ms = round((time.monotonic() - started) * 1000)
        try:
            body = r.json()
        except ValueError:
            body = {}
        version = body.get("version") if isinstance(body, dict) else None
        rows.append({"service": name, "status": r.status_code, "ok": r.ok, "version": version, "ms": ms})
    except requests.RequestException as err:
        rows.append({"service": name, "status": None, "ok": False, "version": None, "ms": None, "error": type(err).__name__})

health = pd.DataFrame(rows)
health
'''),
    md("## Compared with the latest releases\nFrom the dashboard's live Version Drift data (GitHub), so you can see whether this environment is behind."),
    code('''
drift = requests.get(f"{DASHBOARD_API}/github/drift/blue-core-lod", timeout=60).json()
releases = pd.DataFrame([
    {
        "service": s["name"],
        "latest release": (s.get("release") or {}).get("tag"),
        "unreleased commits on main": (s.get("unreleased") or {}).get("count", 0),
        "stack image built": (s.get("imageBuiltAt") or "")[:10],
        "summary": s.get("summary"),
    }
    for s in drift["services"]
])
releases
'''),
    code('''
down = health[~health["ok"]]
if down.empty:
    print("Every service answered.")
else:
    print("Not answering:", ", ".join(down["service"]))
    if bc.deployed:
        print("Compare with the other environments in the next starter, or on the dashboard's Version Drift page.")
    else:
        print("Check `docker compose ps` in bluecore-stack, and the service's logs (`docker compose logs <service>`).")
'''),
]))

made.append(notebook("02-compare-environments", "Compare environments", CHECK, [
    md("# Compare environments\nThe same checks side by side on every environment (your local stack, dev, stage): service versions, how many records each holds, and whether a search finds the same thing. Use it to tell a local problem from one that's on dev too.\n\nOnly reads, with plain public requests, so it's safe on every environment whatever this notebook is set to."),
    code('''
import pandas as pd
import requests
from bluecore import environments, target

ENVS = {name: target(name) for name in environments()}
list(ENVS)
'''),
    md("## Versions"),
    code('''
PATHS = {"API": "/api/health", "Workflows": "/workflows/health", "Sinopia": "/sinopia/health", "Marva": "/marva/health"}

def version(t, path):
    try:
        r = t.get(path, timeout=10)
        body = r.json() if r.ok else {}
        return body.get("version") or ("up" if r.ok else f"HTTP {r.status_code}")
    except (requests.RequestException, ValueError):
        return "unreachable"

pd.DataFrame({name: {svc: version(t, p) for svc, p in PATHS.items()} for name, t in ENVS.items()})
'''),
    md("## How many records\nTotals from search (hubs, works, instances) and the profile and other-resource lists."),
    code('''
def total(t, path, **params):
    try:
        r = t.get(path, params={"limit": 1, **params}, timeout=30)
        return r.json().get("total") if r.ok else f"HTTP {r.status_code}"
    except (requests.RequestException, ValueError):
        return "unreachable"

pd.DataFrame({
    name: {
        "hubs": total(t, "/api/search/", q="", type="hubs"),
        "works": total(t, "/api/search/", q="", type="works"),
        "instances": total(t, "/api/search/", q="", type="instances"),
        "profiles": total(t, "/api/profiles/"),
        "other resources": total(t, "/api/resources/"),
    }
    for name, t in ENVS.items()
})
'''),
    md("## The same search everywhere\nChange `QUERY` to something you expect to find."),
    code('''
QUERY = "pride and prejudice"

def top(t, q):
    try:
        r = t.get("/api/search/", params={"q": q, "limit": 3}, timeout=30).json()
        labels = [(x["type"], (x["data"].get("rdfs:label") or [x["data"].get("@id")])[0]) for x in r["results"]]
        return {"total": r["total"], "top results": labels}
    except (requests.RequestException, ValueError, KeyError):
        return {"total": "unreachable", "top results": []}

pd.DataFrame({name: top(t, QUERY) for name, t in ENVS.items()}).T
'''),
]))

# --- Blue Core API ----------------------------------------------------------------------------------

made.append(notebook("10-api-tour", "Blue Core API: every endpoint", API, [
    md("""# Blue Core API: every endpoint
One call to each endpoint of the Blue Core API, grouped by purpose, with the response it gives. Copy the cell you need into your own notebook. The last cell checks the list against the API's live OpenAPI spec, so an endpoint added later shows up as not yet covered.

| Purpose | Endpoints |
|---|---|
| About the service | `/`, `/health`, `/context.jsonld` |
| Find | `/search/`, `/search/profile` |
| Read records | hubs, works and instances, in each format; other resources; profiles |
| History | `…/versions`, `…/version/{id}`, change document feeds |
| Write | create, update and delete for each kind |
| Convert | `/marc2xml`, `/marc2bibframe` |
| Workflows | `/batches/`, `/batches/upload/`, `/export/` |

On your local stack it creates its own example records (marked `example.org/notebook/<run>`), uses them, and deletes them at the end. On dev or stage it reads existing records instead and skips every call that needs a login."""),
    code('''
import json, uuid
import pandas as pd
from bluecore import NotConfigured, marc21, show, target

bc = target()
WRITABLE = not bc.read_only
AUTH = bc.auth_headers() if WRITABLE else {}
LD = {**AUTH, "Content-Type": "application/ld+json"}
RUN = uuid.uuid4().hex[:8]
IDS = {}       # the records the calls use: hub_uuid, work_uuid, ...
CALLS = []     # every call made, for the coverage check at the end

def call(method, endpoint, *, suffix="", chars=600, **kwargs):
    """Calls an endpoint by its OpenAPI path, e.g. call("GET", "/works/{work_uuid}"), filling in IDS"""
    r = bc.http.request(method, "/api" + endpoint.format(**IDS) + suffix, **kwargs)
    CALLS.append({"method": method, "endpoint": endpoint, "status": r.status_code})
    show(r, chars)
    return r

def skip(method, endpoint, why="needs a login, so it only runs on your local stack"):
    CALLS.append({"method": method, "endpoint": endpoint, "status": "skipped: " + why})

bc
'''),
    md("## About the service"),
    code('''
call("GET", "/")
call("GET", "/health")
call("GET", "/context.jsonld", chars=300);
'''),
    md("## Example records\nLocally: create a hub, a work and an instance of it, an other resource and a profile, from the request examples the API documents (`bc.example`). On dev or stage: pick existing ones."),
    code('''
if WRITABLE:
    hub = {**bc.example("/hubs/"), "@id": f"https://example.org/notebook/{RUN}/hub"}
    IDS["hub_uuid"] = call("POST", "/hubs/", json=hub, headers=LD, chars=300).json()["uuid"]

    work = {**bc.example("/works/"), "@id": f"https://example.org/notebook/{RUN}/work"}
    created = call("POST", "/works/", json=work, headers=LD, chars=300).json()
    IDS["work_uuid"], work_id = created["uuid"], created["id"]

    # An instance of that work: the Sinopia body takes the work's database id
    instance = {**bc.example("/instances/"), "@id": f"https://example.org/notebook/{RUN}/instance"}
    body = {"data": json.dumps(instance), "work_id": work_id}
    IDS["instance_uuid"] = call("POST", "/instances/", json=body, headers={**AUTH, "Content-Type": "application/vnd.sinopia+json"}, chars=300).json()["uuid"]

    agent = f"https://example.org/notebook/{RUN}/agent"
    body = {"uri": agent, "data": json.dumps({"@id": agent, "rdfs:label": "Example agent"})}
    IDS["resource_id"] = call("POST", "/resources/", json=body, headers=AUTH, chars=300).json()["id"]

    template = [{"@id": "", "@type": ["http://sinopia.io/vocabulary/ResourceTemplate"],
                 "http://sinopia.io/vocabulary/hasResourceId": [{"@value": f"notebook:example:{RUN}"}],
                 "http://www.w3.org/2000/01/rdf-schema#label": [{"@value": "Notebook example profile"}]}]
    IDS["profile_uuid"] = call("POST", "/profiles/", json={"data": json.dumps(template)}, headers=AUTH, chars=300).json()["uuid"]
else:
    for method, endpoint in [("POST", "/hubs/"), ("POST", "/works/"), ("POST", "/instances/"), ("POST", "/resources/"), ("POST", "/profiles/")]:
        skip(method, endpoint)
    IDS["hub_uuid"], IDS["work_uuid"], IDS["instance_uuid"] = bc.sample("hubs"), bc.sample("works"), bc.sample("instances")
    IDS["resource_id"] = bc.get("/api/resources/", params={"limit": 1}).json()["resources"][0]["id"]
    IDS["profile_uuid"] = bc.get("/api/profiles/", params={"limit": 1}).json()["profiles"][0]["uuid"]
IDS
'''),
    md("## Find\nFull-text search over hubs, works and instances (`type`: `all`, `hubs`, `works`, `instances`; `scope`: `all` or `title`; quotes for a phrase), and over profiles (`nested`: `include` or `exclude`)."),
    code('''
call("GET", "/search/", params={"q": "pride and prejudice", "type": "all", "limit": 2}, chars=500)
call("GET", "/search/profile", params={"q": "title", "limit": 1}, chars=500);
'''),
    md("## Read records\nHubs, works and instances negotiate their format: a suffix (`.jsonld`, `.ttl`, `.nt`, `.rdf`, `.cbd.jsonld`, `.cbd.xml`, `.vnd.sinopia.json`) or an `Accept` header. With neither, they answer with the HTML page people see. `expand=true` adds the linked resources' data."),
    code('''
call("GET", "/hubs/{hub_uuid}", suffix=".jsonld", chars=400)
call("GET", "/works/{work_uuid}", suffix=".ttl", chars=400)
call("GET", "/works/{work_uuid}", params={"expand": "true"}, headers={"Accept": "application/ld+json"}, chars=300)
call("GET", "/instances/{instance_uuid}", suffix=".cbd.jsonld", chars=400)
print("No suffix or Accept header:", bc.get(f"/api/instances/{IDS['instance_uuid']}").headers["content-type"])
'''),
    code('''
call("GET", "/resources/", params={"limit": 1}, chars=400)
call("GET", "/resources/{resource_id}", chars=400)
call("GET", "/profiles/", params={"limit": 1}, chars=300)
call("GET", "/profiles/{profile_uuid}", chars=300);
'''),
    md("## Edit\nA PUT sends the whole record again. Locally: change each example record's label or title."),
    code('''
if WRITABLE:
    hub = bc.get(f"/api/hubs/{IDS['hub_uuid']}.jsonld").json()
    hub["rdfs:label"] = ["Austen, Jane, 1775-1817. Pride and prejudice (edited)"]
    call("PUT", "/hubs/{hub_uuid}", json=hub, headers=LD, chars=200)

    work = bc.get(f"/api/works/{IDS['work_uuid']}.jsonld").json()
    work["title"] = [{"@type": ["Title"], "mainTitle": ["Pride and prejudice (edited)"]}]
    call("PUT", "/works/{work_uuid}", json=work, headers=LD, chars=200)

    instance = bc.get(f"/api/instances/{IDS['instance_uuid']}.jsonld").json()
    instance["rdfs:label"] = ["Pride and prejudice (Penguin Classics, 2003, edited)"]
    call("PUT", "/instances/{instance_uuid}", json=instance, headers=LD, chars=200)

    agent = f"https://example.org/notebook/{RUN}/agent"
    call("PUT", "/resources/{resource_id}", json={"data": json.dumps({"@id": agent, "rdfs:label": "Example agent (edited)"})}, headers=AUTH, chars=200)

    template[0]["http://www.w3.org/2000/01/rdf-schema#label"] = [{"@value": "Notebook example profile (edited)"}]
    call("PUT", "/profiles/{profile_uuid}", json={"data": json.dumps(template)}, headers=AUTH, chars=200)
else:
    for kind in ["/hubs/{hub_uuid}", "/works/{work_uuid}", "/instances/{instance_uuid}", "/resources/{resource_id}", "/profiles/{profile_uuid}"]:
        skip("PUT", kind)
'''),
    md("## History\nEvery save makes a version. `…/versions` lists them, `…/version/{id}` returns the record as it was. The change document feeds (Activity Streams) list every create and update, oldest first, a page at a time.\n\n> **Known issue:** an empty feed names `page/0` as its last page, and that page answers `500` (a negative SQL offset). <!-- found 2026-10-16, bluecore_api 0.35.2 -->"),
    code('''
for kind, key in [("hubs", "hub_uuid"), ("works", "work_uuid"), ("instances", "instance_uuid"), ("profiles", "profile_uuid")]:
    versions = call("GET", f"/{kind}/{{{key}}}/versions", chars=300).json()["versions"]
    IDS["version_id"] = versions[0]["id"]
    call("GET", f"/{kind}/{{{key}}}/version/{{version_id}}", chars=200)
'''),
    code('''
for kind in ["works", "instances"]:
    feed = call("GET", f"/change_documents/{kind}/feed", chars=400).json()
    IDS["id"] = max(int(feed["last"]["id"].rsplit("/", 1)[1]), 1)   # the newest page (an empty feed's "last" is page 0, which fails)
    call("GET", f"/change_documents/{kind}/page/{{id}}", chars=400)
'''),
    md("## Embeddings\nReserved for vector embeddings: the API answers `501 Not implemented` for now."),
    code('''
for kind, key in [("hubs", "hub_uuid"), ("works", "work_uuid"), ("instances", "instance_uuid")]:
    call("GET", f"/{kind}/{{{key}}}/embeddings", chars=200)
    if WRITABLE:
        call("POST", f"/{kind}/{{{key}}}/embeddings", headers=AUTH, chars=200)
    else:
        skip("POST", f"/{kind}/{{{key}}}/embeddings")
'''),
    md("## Convert\nOne MARC record at a time, in the API itself (no Airflow). `/marc2xml` takes binary MARC21; `/marc2bibframe` takes MARCXML or binary MARC and answers in the format you `Accept` (JSON-LD by default, Turtle, RDF/XML, N-Triples). `marc21()` builds a small binary record for testing."),
    code('''
if WRITABLE:
    record = marc21([
        ("001", "92005291"),
        ("008", "920219s1993    caua          001 0 eng  "),
        ("100", "1 ", [("a", "Austen, Jane,"), ("d", "1775-1817.")]),
        ("245", "10", [("a", "Pride and prejudice /"), ("c", "Jane Austen.")]),
    ])
    marcxml = call("POST", "/marc2xml", data=record, headers={**AUTH, "Content-Type": "application/marc"}, chars=400).text
    call("POST", "/marc2bibframe", data=marcxml.encode(), headers={**AUTH, "Content-Type": "application/xml", "Accept": "text/turtle"}, chars=500)
else:
    skip("POST", "/marc2xml")
    skip("POST", "/marc2bibframe")
'''),
    md("## Workflows\nThese start Airflow DAGs. Here, `/batches/upload/` loads the example work through the `resource_loader` DAG for real, then deletes what it loaded. `/batches/` (load from a URI) and `/export/` (send an instance to a library catalog) are only probed with an empty body, which they refuse (`422`), so nothing runs. The **Load records with a batch** and **Export to a catalog** starters run them properly."),
    code('''
if WRITABLE:
    work = {**bc.example("/works/"), "@id": f"https://example.org/notebook/{RUN}/batch-work", "rdfs:label": f"Notebook batch {RUN}"}
    batch = call("POST", "/batches/upload/", files={"file": (f"notebook-{RUN}.jsonld", json.dumps(work), "application/ld+json")}, headers=AUTH).json()
    state, tasks = bc.wait_for_run("resource_loader", batch["workflow_id"])
    print("resource_loader:", state, tasks)
    loaded = [x for x in bc.get("/api/search/", params={"q": f"Notebook batch {RUN}", "type": "works"}).json()["results"]]
    IDS["batch_work_uuids"] = [x["uuid"] for x in loaded]

    call("POST", "/batches/", json={}, headers=AUTH, chars=200)
    call("POST", "/export/", json={}, headers=AUTH, chars=300)
else:
    for endpoint in ["/batches/upload/", "/batches/", "/export/"]:
        skip("POST", endpoint)
'''),
    md("## Delete\nLocally: delete everything this notebook made (instances before their work). The vocabulary terms the records pointed at (`id.loc.gov/vocabulary/...`) stay, as other resources: the API keeps them for other records."),
    code('''
if WRITABLE:
    call("DELETE", "/instances/{instance_uuid}", headers=AUTH)
    call("DELETE", "/works/{work_uuid}", headers=AUTH)
    call("DELETE", "/hubs/{hub_uuid}", headers=AUTH)
    call("DELETE", "/resources/{resource_id}", headers=AUTH)
    call("DELETE", "/profiles/{profile_uuid}", headers=AUTH)
    for u in IDS.get("batch_work_uuids", []):
        print("batch work", u, bc.delete(f"/api/works/{u}", headers=AUTH).status_code)
else:
    for endpoint in ["/instances/{instance_uuid}", "/works/{work_uuid}", "/hubs/{hub_uuid}", "/resources/{resource_id}", "/profiles/{profile_uuid}"]:
        skip("DELETE", endpoint)
'''),
    md("## Coverage\nEvery endpoint in the live OpenAPI spec, with what this notebook got back. One marked **not covered** is new: add a call for it above."),
    code('''
spec = bc.openapi()
done = pd.DataFrame(CALLS).groupby(["method", "endpoint"])["status"].agg(lambda s: ", ".join(sorted({str(x) for x in s})))
coverage = pd.DataFrame([
    {"tag": (op.get("tags") or ["(none)"])[0], "method": m.upper(), "endpoint": path, "summary": op.get("summary"),
     "result": done.get((m.upper(), path), "not covered")}
    for path, ops in spec["paths"].items() for m, op in ops.items() if m in {"get", "post", "put", "delete", "patch"}
])
print(f"{(coverage['result'] != 'not covered').sum()} of {len(coverage)} endpoints called")
coverage.sort_values(["tag", "endpoint", "method"]).reset_index(drop=True)
'''),
]))

made.append(notebook("11-find-records", "Find and read records", API, [
    md("# Find and read records\nSearch for hubs, works and instances, open one, follow its links (work → instances, instance → work), and get it in the format you need. " + TARGET_NOTE + "\n\nReading needs no login."),
    SETUP,
    md("## Search\n`type`: `all`, `hubs`, `works` or `instances`. `scope`: `all` fields or just `title`. Put a phrase in double quotes to match it exactly (no stemming). An empty `q` lists everything, newest last."),
    code('''
import pandas as pd

QUERY = "pride and prejudice"
TYPE = "all"
SCOPE = "all"

r = bc.get("/api/search/", params={"q": QUERY, "type": TYPE, "scope": SCOPE, "limit": 20})
found = r.json()

def label(data):
    for key in ("rdfs:label", "bflc:aap"):
        if data.get(key):
            return data[key][0]
    titles = data.get("title") or []
    return titles[0].get("mainTitle", [""])[0] if titles else data.get("@id")

print(found["total"], "results;", "next page:", found["links"].get("next"))
results = pd.DataFrame([{"type": x["type"], "label": label(x["data"]), "uuid": x["uuid"], "updated": x["updated_at"]} for x in found["results"]])
results
'''),
    md("## Open one\nThe first work in the results, or set `WORK_UUID` yourself."),
    code('''
WORK_UUID = next((x["uuid"] for x in found["results"] if x["type"] == "works"), None) or bc.sample("works")
work = bc.get(f"/api/works/{WORK_UUID}.jsonld").json()
print(label(work), "·", work["@id"])
print("People see it at", f"{bc.url}/works/{WORK_UUID}")
{k: v for k, v in work.items() if k in ("@type", "title", "contribution", "language", "hasInstance", "expressionOf")}
'''),
    md("## Follow its links\nA work lists its instances (`hasInstance`) and may point at a hub (`expressionOf`)."),
    code('''
def uuid_of(uri):
    return uri.rstrip("/").rsplit("/", 1)[-1]

instances = []
for uri in work.get("hasInstance", []):
    inst = bc.get(f"/api/instances/{uuid_of(uri)}.jsonld").json()
    instances.append({"instance": label(inst), "uuid": uuid_of(uri), "types": ", ".join(inst.get("@type", []))})
pd.DataFrame(instances) if instances else "This work has no instances."
'''),
    md("## Other formats\nA suffix or an `Accept` header picks the format. `.cbd.*` is the Concise Bounded Description: the record plus the blank nodes it owns. `expand=true` pulls in the data of linked resources."),
    code('''
for suffix in [".ttl", ".nt", ".rdf", ".cbd.jsonld", ".cbd.xml", ".vnd.sinopia.json"]:
    r = bc.get(f"/api/works/{WORK_UUID}{suffix}")
    print(f"{suffix:<18} {r.status_code}  {r.headers.get('content-type', ''):<40} {len(r.content):>7} bytes")

print()
print(bc.get(f"/api/works/{WORK_UUID}.ttl").text[:1200])
'''),
    code('''
expanded = bc.get(f"/api/works/{WORK_UUID}", params={"expand": "true"}, headers={"Accept": "application/ld+json"}).json()
print("Keys with expand:", sorted(expanded)[:30])
'''),
    md("## Other resources\nAuthorities and other things records point at (agents, subjects, places) are stored as \"other resources\". Look one up by its URI, or list them."),
    code('''
listing = bc.get("/api/resources/", params={"limit": 5}).json()
print(listing["total"], "other resources")
pd.DataFrame([{"id": x["id"], "uri": x["uri"], "label": label(x["data"]) if isinstance(x["data"], dict) else None} for x in listing["resources"]])
'''),
]))

made.append(notebook("12-edit-records", "Create, edit and delete records", API, [
    md("# Create, edit and delete records\nThe whole life of a record through the API: create a hub, a work and an instance of it, edit them, look at their versions, then delete them. Use it to try a change to the API or to reproduce a cataloging bug.\n\n" + LOCAL_ONLY),
    SETUP_WRITE,
    md("## Create\nThe bodies start from the API's own request examples (`bc.example`). The API mints the record's URI and UUID itself; the `@id` you send just has to be unique.\n\nCreate takes either raw JSON-LD (`Content-Type: application/ld+json`) or the Sinopia body (`application/vnd.sinopia+json`, `{\"data\": \"<JSON-LD as a string>\"}`), which can also name the instance's work by its database id."),
    code('''
hub = {**bc.example("/hubs/"), "@id": f"https://example.org/notebook/{RUN}/hub"}
r = bc.post("/api/hubs/", json=hub, headers=LD); show(r, 300)
hub = r.json()

work = {**bc.example("/works/"), "@id": f"https://example.org/notebook/{RUN}/work"}
r = bc.post("/api/works/", json=work, headers=LD); show(r, 300)
work = r.json()

instance = {**bc.example("/instances/"), "@id": f"https://example.org/notebook/{RUN}/instance"}
body = {"data": json.dumps(instance), "work_id": work["id"]}
r = bc.post("/api/instances/", json=body, headers={**AUTH, "Content-Type": "application/vnd.sinopia+json"}); show(r, 300)
instance = r.json()

print("\\nhub", hub["uuid"], "· work", work["uuid"], "· instance", instance["uuid"], "of work id", instance["work_id"])
'''),
    md("""> **Known issue:** a new work that points at an existing Blue Core hub (`"bf:expressionOf": {"@id": "<hub URI>"}`) fails with a `500`: the API tries to store the hub again as an \"other resource\" and hits the unique URI constraint. That's why the work above isn't linked to the hub. <!-- found 2026-10-16, bluecore_api 0.35.2 -->"""),
    md("## Edit\nA PUT sends the whole record. Read it as JSON-LD, change it, send it back."),
    code('''
current = bc.get(f"/api/works/{work['uuid']}.jsonld").json()
current["title"] = [{"@type": ["Title"], "mainTitle": ["Pride and prejudice (second edit)"]}]
r = bc.put(f"/api/works/{work['uuid']}", json=current, headers=LD)
show(r, 400)
'''),
    md("## Versions\nEach save is a version, with who made it."),
    code('''
versions = bc.get(f"/api/works/{work['uuid']}/versions").json()["versions"]
for v in versions:
    old = bc.get(f"/api/works/{work['uuid']}/version/{v['id']}").json()
    print(v["timestamp"], v["user"], "→", old["data"]["title"][0]["mainTitle"])
'''),
    md("## Delete\nInstances first, then the work and the hub. Deleting a work also deletes its instances. The vocabulary terms they pointed at (language, content type, role) stay, as other resources, for other records to share."),
    code('''
for kind, uuid_ in [("instances", instance["uuid"]), ("works", work["uuid"]), ("hubs", hub["uuid"])]:
    r = bc.delete(f"/api/{kind}/{uuid_}", headers=AUTH)
    print(kind, uuid_, r.status_code)
    assert bc.get(f"/api/{kind}/{uuid_}.jsonld").status_code == 404
print("All gone.")
'''),
]))

made.append(notebook("13-record-history", "Record history and change feeds", API, [
    md("# Record history and change feeds\nWhat changed, when and by whom: one record's versions, and the change document feeds (Activity Streams) that downstream systems poll to stay in sync. " + TARGET_NOTE),
    SETUP,
    md("## The change feeds\nOne feed for works, one for instances. The entry point says how many changes there are and where the first and last pages are; pages are oldest first."),
    code('''
import pandas as pd

feeds = {kind: bc.get(f"/api/change_documents/{kind}/feed").json() for kind in ["works", "instances"]}
pd.DataFrame([{"feed": k, "changes": f["totalItems"], "first page": f["first"]["id"], "last page": f["last"]["id"]} for k, f in feeds.items()])
'''),
    md("## The latest changes\nThe newest page of each feed (and the one before it, if the newest is short)."),
    code('''
def page(kind, n):
    return bc.get(f"/api/change_documents/{kind}/page/{n}").json()

rows = []
for kind, feed in feeds.items():
    if not feed["totalItems"]:
        continue   # an empty feed names page 0 as its last page, which the API can't serve (a known bug)
    last = int(feed["last"]["id"].rsplit("/", 1)[1])
    for n in sorted({last, max(last - 1, 1)}):
        for item in page(kind, n)["orderedItems"]:
            rows.append({"feed": kind, "page": n, "change": item["type"], "published": item["published"], "record": item["object"]["id"]})
changes = pd.DataFrame(rows, columns=["feed", "page", "change", "published", "record"]).sort_values("published", ascending=False)
changes.head(20)
'''),
    code('''
changes["day"] = changes["published"].str[:10]
changes.groupby(["day", "feed", "change"]).size().unstack(fill_value=0).tail(10)
'''),
    md("## One record's versions\nThe most recently changed work, or set `WORK_UUID`. Compares the newest two versions."),
    code('''
# The newest change whose work still exists (deleted ones stay in the feed)
WORK_UUID = next((u for u in (r.rsplit("/", 1)[1] for r in changes[changes["feed"] == "works"]["record"])
                  if bc.get(f"/api/works/{u}/versions").ok), None) or bc.sample("works")
versions = bc.get(f"/api/works/{WORK_UUID}/versions").json()["versions"]
print(WORK_UUID, "-", len(versions), "version(s)")
pd.DataFrame(versions)
'''),
    code('''
import difflib, json

if len(versions) < 2:
    print("Only one version: nothing to compare.")
else:
    old, new = (bc.get(f"/api/works/{WORK_UUID}/version/{v['id']}").json()["data"] for v in versions[-2:])
    diff = difflib.unified_diff(json.dumps(old, indent=1, sort_keys=True).splitlines(), json.dumps(new, indent=1, sort_keys=True).splitlines(),
                                f"version {versions[-2]['id']}", f"version {versions[-1]['id']}", lineterm="", n=1)
    print("\\n".join(list(diff)[:120]) or "No differences in the data.")
'''),
]))

made.append(notebook("14-profiles", "Profiles (Sinopia templates)", API, [
    md("# Profiles (Sinopia templates)\nProfiles are the resource templates Sinopia and Marva build their cataloging forms from. Find one, see which properties it defines, and (locally) create, edit and delete a copy. " + TARGET_NOTE),
    SETUP,
    md("## Find profiles\n`/search/profile` searches their text; `nested=exclude` leaves out templates that are only used inside others."),
    code('''
import pandas as pd

SV, RDFS = "http://sinopia.io/vocabulary/", "http://www.w3.org/2000/01/rdf-schema#"

def first(node, key):
    values = node.get(key) or [{}]
    return values[0].get("@value") or values[0].get("@id")

def template_of(profile):
    """The profile's ResourceTemplate node"""
    return next((n for n in profile["data"] if SV + "ResourceTemplate" in n.get("@type", [])), {})

QUERY = "monograph"
found = bc.get("/api/search/profile", params={"q": QUERY, "limit": 15}).json()
print(found["total"], "profiles match", repr(QUERY))
pd.DataFrame([
    {"label": first(template_of(p), RDFS + "label"), "id": first(template_of(p), SV + "hasResourceId"),
     "class": first(template_of(p), SV + "hasClass"), "uuid": p["uuid"]}
    for p in found["results"]
])
'''),
    md("## One profile's properties\nThe first result, or set `PROFILE_UUID`."),
    code('''
listed = found["results"] or bc.get("/api/profiles/", params={"limit": 1}).json()["profiles"]
PROFILE_UUID = listed[0]["uuid"] if listed else None
profile = bc.get(f"/api/profiles/{PROFILE_UUID}").json() if PROFILE_UUID else None
properties = [n for n in profile["data"] if SV + "PropertyTemplate" in n.get("@type", [])] if profile else []
print(first(template_of(profile), RDFS + "label"), "-", len(properties), "properties") if profile else print("No profiles in this environment yet: the last section creates one.")
pd.DataFrame([
    {"label": first(p, RDFS + "label"), "property": first(p, SV + "hasPropertyUri"),
     "type": (first(p, SV + "hasPropertyType") or "").rsplit("/", 1)[-1],
     "repeatable": any(a.get("@id", "").endswith("repeatable") for a in p.get(SV + "hasPropertyAttribute", [])),
     "required": any(a.get("@id", "").endswith("required") for a in p.get(SV + "hasPropertyAttribute", []))}
    for p in properties
])
'''),
    code('''
pd.DataFrame(bc.get(f"/api/profiles/{PROFILE_UUID}/versions").json()["versions"]) if PROFILE_UUID else "No profile."
'''),
    md("## Create, edit and delete a profile\nLocal stack only: copies the profile above (or a minimal template, if there's none) under a new id, renames it, and deletes it."),
    code('''
import json, uuid

bc.require_writable("Creating a profile")
AUTH = bc.auth_headers()
# A copy of the profile above, or a minimal template when there's none
source = profile["data"] if profile else [{"@id": "", "@type": [SV + "ResourceTemplate"], SV + "hasClass": [{"@id": "http://id.loc.gov/ontologies/bibframe/Work"}]}]
copy = json.loads(json.dumps(source))
tpl = next(n for n in copy if SV + "ResourceTemplate" in n.get("@type", []))
tpl[SV + "hasResourceId"] = [{"@value": f"notebook:copy:{uuid.uuid4().hex[:8]}"}]
tpl[RDFS + "label"] = [{"@value": "Notebook copy of " + (first(tpl, RDFS + "label") or "a profile")}]

r = bc.post("/api/profiles/", json={"data": json.dumps(copy)}, headers=AUTH)
show(r, 200)
new = r.json()
print("Minted:", new["uri"])

tpl = next(n for n in new["data"] if SV + "ResourceTemplate" in n.get("@type", []))
tpl[RDFS + "label"] = [{"@value": "Notebook copy (renamed)"}]
show(bc.put(f"/api/profiles/{new['uuid']}", json={"data": json.dumps(new["data"])}, headers=AUTH), 200)
print(len(bc.get(f"/api/profiles/{new['uuid']}/versions").json()["versions"]), "versions")
print("delete:", bc.delete(f"/api/profiles/{new['uuid']}", headers=AUTH).status_code)
'''),
]))

# --- Load and export --------------------------------------------------------------------------------

made.append(notebook("20-marc-to-bibframe", "Convert MARC to BIBFRAME", LOAD, [
    md("# Convert MARC to BIBFRAME\nTurn a MARC record into Blue Core BIBFRAME with the API's converter (the Library of Congress marc2bibframe2 stylesheet, with Blue Core's policy applied), look at what it produced, and optionally load the result into your local stack.\n\nConverting doesn't store anything, but it's a POST that needs a login, so it runs on your local stack (dev and stage are read-only here). One record per request: bulk MARC goes through the `marc_to_bibframe` workflow instead."),
    SETUP,
    code('''
bc.require_writable("Converting MARC")   # a POST with a login: local stack only
AUTH = bc.auth_headers()
'''),
    md("## A MARC record\nThe API's own MARCXML example. To use yours, set `MARCXML` to its text, or `MARC_FILE` to a `.xml` or `.mrc` file in this notebook's folder."),
    code('''
import pathlib

MARC_FILE = ""   # e.g. "record.mrc" or "record.xml"
MARCXML = bc.example("/marc2bibframe", "application/xml")

if MARC_FILE:
    body = pathlib.Path(MARC_FILE).read_bytes()
    content_type = "application/xml" if body.lstrip().startswith(b"<") else "application/marc"
else:
    body, content_type = MARCXML.encode(), "application/xml"
print(content_type, len(body), "bytes")
'''),
    md("## Binary MARC to MARCXML\n`/marc2xml` only takes binary MARC21. `marc21()` builds a small record to try it with."),
    code('''
from bluecore import marc21

binary = body if content_type == "application/marc" else marc21([
    ("001", "92005291"),
    ("100", "1 ", [("a", "Austen, Jane,"), ("d", "1775-1817.")]),
    ("245", "10", [("a", "Pride and prejudice /"), ("c", "Jane Austen.")]),
])
show(bc.post("/api/marc2xml", data=binary, headers={**AUTH, "Content-Type": "application/marc"}), 800)
'''),
    md("## MARC to BIBFRAME\nPick the output with `Accept`: `application/ld+json` (default), `text/turtle`, `application/rdf+xml` or `application/n-triples`. `source_base_uri` sets the base for the URIs it mints (the default is a deliberate placeholder)."),
    code('''
r = bc.post("/api/marc2bibframe", data=body, params={"source_base_uri": "https://example.org/marc/"},
            headers={**AUTH, "Content-Type": content_type, "Accept": "text/turtle"})
print(r.status_code)
print(r.text[:3000])
'''),
    md("## What it produced\nThe resources in the result, by type."),
    code('''
import collections
import pandas as pd

r = bc.post("/api/marc2bibframe", data=body, headers={**AUTH, "Content-Type": content_type})
graph = r.json()
types = collections.Counter(t.rsplit("/", 1)[-1] for node in graph for t in node.get("@type", []))
print(len(graph), "nodes")
pd.Series(types, name="nodes").sort_values(ascending=False)
'''),
    md("## Load it into your stack (optional)\nSet `LOAD = True` to load the result through a batch (the `resource_loader` DAG), wait for it, and list the records it made. The **Load records with a batch** starter explains batches."),
    code('''
import json, time

LOAD = False
if LOAD:
    r = bc.post("/api/batches/upload/", files={"file": ("converted.jsonld", json.dumps(graph), "application/ld+json")}, headers=AUTH)
    show(r)
    state, tasks = bc.wait_for_run("resource_loader", r.json()["workflow_id"])
    print(state, tasks)
    print(bc.get("/api/change_documents/works/feed").json()["totalItems"], "work changes in the feed now")
else:
    print("Set LOAD = True to load it.")
'''),
]))

made.append(notebook("21-batch-load", "Load records with a batch", LOAD, [
    md("# Load records with a batch\nLoad JSON-LD into Blue Core the way bulk loads do: upload a file (`/batches/upload/`) or point at one by URI (`/batches/`). The API hands it to an Airflow DAG (`resource_loader`, or `archived_file_loader` for a `.zip` or `.tar.gz`), and this notebook follows the run to the end and finds the records it made.\n\n" + LOCAL_ONLY),
    SETUP_WRITE,
    md("## A file to load\nTwo example works, made from the API's request example. Use your own by setting `FILE` to a `.jsonld` (or `.zip`) in this notebook's folder."),
    code('''
import pathlib

FILE = ""   # e.g. "my-records.jsonld"
LABEL = f"Notebook batch {RUN}"   # in every example record, to find them afterwards

if FILE:
    name, content = pathlib.Path(FILE).name, pathlib.Path(FILE).read_bytes()
else:
    works = [{**bc.example("/works/"), "@id": f"https://example.org/notebook/{RUN}/work-{i}", "rdfs:label": f"{LABEL} #{i}"} for i in (1, 2)]
    name, content = f"notebook-{RUN}.jsonld", json.dumps({"@context": works[0]["@context"], "@graph": [{k: v for k, v in w.items() if k != "@context"} for w in works]}).encode()
print(name, len(content), "bytes")
'''),
    md("## Upload it\nThe answer names the DAG run (`workflow_id`)."),
    code('''
started = bc.get("/api/change_documents/works/feed").json()["totalItems"]
r = bc.post("/api/batches/upload/", files={"file": (name, content)}, headers=AUTH)
show(r)
batch = r.json()
DAG = "archived_file_loader" if name.endswith((".zip", ".tar.gz", ".tgz", ".gz")) else "resource_loader"
'''),
    md("## Follow the DAG run"),
    code('''
import pandas as pd

state, tasks = bc.wait_for_run(DAG, batch["workflow_id"], timeout=600)
print(DAG, batch["workflow_id"], "→", state)
pd.DataFrame(tasks)
'''),
    code('''
if state != "success":
    s, api = bc.airflow()
    for t in tasks:
        if t["state"] == "failed":
            log = s.get(f"{api}/dags/{DAG}/dagRuns/{batch['workflow_id']}/taskInstances/{t['task']}/logs/1", headers={"Accept": "text/plain"})
            print(f"--- {t['task']} ---")
            print(log.text[-3000:])
else:
    print("Loaded.")
'''),
    md("## What it made\nNew entries in the works change feed since the upload."),
    code('''
feed = bc.get("/api/change_documents/works/feed").json()
new = feed["totalItems"] - started
last = int(feed["last"]["id"].rsplit("/", 1)[1])
items = bc.get(f"/api/change_documents/works/page/{last}").json()["orderedItems"]
if new > len(items) and last > 1:
    items = bc.get(f"/api/change_documents/works/page/{last - 1}").json()["orderedItems"] + items
made = [i["object"]["id"] for i in items[-new:]] if new > 0 else []
print(new, "work change(s)")
made
'''),
    md("## Clean up\nDeletes the works this batch made (and their instances). Skip this cell to keep them."),
    code('''
for uri in made:
    uuid_ = uri.rsplit("/", 1)[1]
    print(uuid_, bc.delete(f"/api/works/{uuid_}", headers=AUTH).status_code)
'''),
    md("## Loading from a URI\n`/batches/` takes a URI the Airflow workers can read: a URL, or a path under `/opt/airflow/uploads`. It needs a `uri`; without one it answers `422`."),
    code('''
show(bc.post("/api/batches/", json={}, headers=AUTH))
# bc.post("/api/batches/", json={"uri": "https://example.org/records.jsonld"}, headers=AUTH)
'''),
]))

made.append(notebook("22-export", "Export to a catalog (LSP)", LOAD, [
    md("# Export to a catalog (LSP)\nSend an instance and its work to an institution's library services platform (FOLIO, Alma) with `/export/`, and follow the export through Airflow: `monitor_institutions_exports` passes it to the institution's DAG (`stanford`, `cornell`, `penn`, `ucdavis`, …), picked by your Keycloak user's group.\n\n**Exporting writes to a catalog.** If your local Airflow has an institution's catalog credentials, a real export reaches that catalog, so the export itself is off until you set `SEND = True`. The rest only reads. Local stack only."),
    SETUP,
    code('''
bc.require_writable("Exporting")
AUTH = bc.auth_headers()
s, AIRFLOW = bc.airflow()
'''),
    md("## Recent exports\nThe latest runs of the monitor DAG and of each institution's DAG."),
    code('''
import pandas as pd

DAGS = ["monitor_institutions_exports", "stanford", "cornell", "penn", "ucdavis"]
rows = []
for dag in DAGS:
    r = s.get(f"{AIRFLOW}/dags/{dag}/dagRuns", params={"limit": 5, "order_by": "-start_date"})
    for run in r.json().get("dag_runs", []) if r.ok else []:
        rows.append({"dag": dag, "run": run["dag_run_id"], "state": run["state"], "start": run.get("start_date"), "resource": (run.get("conf") or {}).get("resource")})
pd.DataFrame(rows).sort_values("start", ascending=False) if rows else "No export runs yet."
'''),
    md("## Export one instance\nThe first instance in search, or set `INSTANCE_URI`. `local_id` overlays an existing catalog record (its HRID, for example) instead of creating one."),
    code('''
INSTANCE_URI = ""
LOCAL_ID = None
SEND = False

if not INSTANCE_URI:
    uuid_ = bc.sample("instances")
    INSTANCE_URI = bc.get(f"/api/instances/{uuid_}.jsonld").json()["@id"] if uuid_ else ""
print("Instance:", INSTANCE_URI or "none in this stack: create one with the Create, edit and delete records starter")

if SEND and INSTANCE_URI:
    r = bc.post("/api/export/", json={"instance_uri": INSTANCE_URI, "local_id": LOCAL_ID}, headers=AUTH)
    show(r)
    export = r.json()
else:
    print("Not sent. Set SEND = True to export.")
    show(bc.post("/api/export/", json={}, headers=AUTH), 300)   # an empty body is refused (422): checks the route and your login
'''),
    md("## Follow it"),
    code('''
if SEND and INSTANCE_URI:
    state, tasks = bc.wait_for_run("monitor_institutions_exports", export["workflow_id"], timeout=600)
    print("monitor_institutions_exports →", state)
    display(pd.DataFrame(tasks))
else:
    print("Nothing sent.")
'''),
]))

# --- Debug ------------------------------------------------------------------------------------------

made.append(notebook("30-keycloak-auth", "Keycloak login and permissions", DEBUG, [
    md("# Keycloak login and permissions\nWhy does the API answer `401` or `403`? Sign in the way the API's clients do, look inside the token (user, groups, roles), and check it against what each endpoint needs. " + TARGET_NOTE + "\n\nOn dev or stage it needs that environment's login in `.env.notebooks` (`BLUECORE_DEV_KEYCLOAK_USERNAME`, `…_PASSWORD`). Never type passwords into a notebook."),
    SETUP,
    md("## The realm\nKeycloak's public OpenID configuration for the `bluecore` realm."),
    code('''
realm = bc._s["keycloak_realm"]
oidc = bc.get(f"/keycloak/realms/{realm}/.well-known/openid-configuration")
print(oidc.status_code, oidc.url)
{k: oidc.json()[k] for k in ["issuer", "token_endpoint", "grant_types_supported"]} if oidc.ok else oidc.text[:300]
'''),
    md("## Sign in and read the token\nThe token is a JWT: its middle part is plain JSON. This decodes it without checking the signature, which is fine for looking."),
    code('''
import base64, json, datetime
from bluecore import NotConfigured

try:
    token = bc.keycloak_token()
except NotConfigured as err:
    token = None
    print(err)

def claims(jwt):
    part = jwt.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))

if token:
    c = claims(token)
    when = lambda t: datetime.datetime.fromtimestamp(t, datetime.UTC).isoformat(timespec="seconds")
    print("user:", c.get("preferred_username"), "· subject:", c.get("sub"))
    print("client:", c.get("azp"), "· issued", when(c["iat"]), "· expires", when(c["exp"]))
    print("realm roles:", c.get("realm_access", {}).get("roles"))
    print("client roles:", {k: v.get("roles") for k, v in (c.get("resource_access") or {}).items()})
    print("groups:", c.get("groups"))
'''),
    md("## What the API lets this user do\nThe API checks the token's roles: `create` (POST), `update` (PUT and DELETE) and `export`. `cataloger-read-only` blocks all of them."),
    code('''
import pandas as pd

if token:
    roles = set(c.get("realm_access", {}).get("roles", [])) | {r for v in (c.get("resource_access") or {}).values() for r in v.get("roles", [])}
    read_only = "cataloger-read-only" in roles
    spec = bc.openapi()
    need = {"post": "create", "put": "update", "delete": "update"}
    rows = []
    for path, ops in spec["paths"].items():
        for m, op in ops.items():
            if op.get("security"):
                role = "export" if path == "/export/" else need.get(m, "create")
                rows.append({"method": m.upper(), "endpoint": path, "needs role": role, "allowed": role in roles and not read_only})
    allowed = pd.DataFrame(rows)
    print("Roles:", sorted(roles), "(read-only)" if read_only else "")
    display(allowed.groupby(["needs role", "allowed"]).size().rename("endpoints"))
    display(allowed[~allowed["allowed"]])
'''),
    md("## Try it\nThe same safe request (an empty export, which the API refuses with `422` once you're allowed) without a token, with a broken one, and with yours: `401`/`403` means the login is the problem, `422` means it got through. Local stack only, as it's a POST."),
    code('''
if token and not bc.read_only:
    for name, headers in [("no token", {}), ("broken token", {"Authorization": "Bearer nope"}), ("your token", {"Authorization": f"Bearer {token}"})]:
        r = bc.post("/api/export/", json={}, headers=headers)
        print(f"{name:<13} → {r.status_code} {r.text[:120]}")
else:
    print("Skipped: needs a token and your local stack.")
'''),
]))

made.append(notebook("31-airflow", "Airflow DAG runs", DEBUG, [
    md("# Airflow DAG runs\nWhich workflows (DAGs) ran recently in Airflow, which failed, and the failed tasks' logs. " + TARGET_NOTE + "\n\nLocally it signs in with your stack's Airflow login (from the stack checkout's `.env`, else `developer` / `123456`). For dev or stage, set `BLUECORE_DEV_AIRFLOW_USER` and `…_PASSWORD` (or `…_AIRFLOW_TOKEN`) in `.env.notebooks`."),
    SETUP,
    code('''
# Airflow 3 (api/v2) signs in for a token; Airflow 2 (api/v1) takes the login on each request
s, API = bc.airflow()
print("Using", API, "-", s.get(f"{API}/version").json())
'''),
    md("## DAGs"),
    code('''
import pandas as pd
dags = s.get(f"{API}/dags", params={"limit": 100}, timeout=15).json()["dags"]
pd.DataFrame([{"dag": d["dag_id"], "paused": d.get("is_paused"), "tags": ", ".join(t["name"] for t in d.get("tags") or [])} for d in dags])
'''),
    md("## Recent runs of every DAG"),
    code('''
runs = []
for d in dags:
    r = s.get(f"{API}/dags/{d['dag_id']}/dagRuns", params={"limit": 5, "order_by": "-start_date"}, timeout=15)
    for run in r.json().get("dag_runs", []):
        runs.append({"dag": d["dag_id"], "run": run["dag_run_id"], "state": run["state"], "start": run.get("start_date"), "end": run.get("end_date")})
runs = pd.DataFrame(runs)
runs.sort_values("start", ascending=False).head(25) if not runs.empty else "No runs yet"
'''),
    md("## Why a run failed\nThe failed tasks of the latest failed run, with the end of each task's log."),
    code(r'''
failed = runs[runs["state"] == "failed"] if not runs.empty else runs
if failed.empty:
    print("No failed runs in the recent history.")
else:
    run = failed.sort_values("start", ascending=False).iloc[0]
    print(f"{run['dag']} / {run['run']}")
    tis = s.get(f"{API}/dags/{run['dag']}/dagRuns/{run['run']}/taskInstances", timeout=15).json()["task_instances"]
    for ti in [t for t in tis if t["state"] == "failed"]:
        log = s.get(f"{API}/dags/{run['dag']}/dagRuns/{run['run']}/taskInstances/{ti['task_id']}/logs/{ti.get('try_number', 1)}",
                    headers={"Accept": "text/plain"}, timeout=30)
        print(f"\n--- {ti['task_id']} (try {ti.get('try_number')}) ---")
        print(log.text[-3000:])
'''),
]))

made.append(notebook("32-database", "Postgres inspection", DEBUG, [
    md("""# Postgres inspection
Look inside the `bluecore` database: tables, row counts, recent rows, and queries running now. Read-only queries only.

Locally it connects with your stack's database login (from the stack checkout's `.env`, else the documented defaults) on `host.docker.internal:5432`. A deployed database is only reachable if you have access (for example an SSH tunnel) and set `BLUECORE_DEV_DB_URL` in `.env.notebooks`.
If your local stack doesn't publish Postgres's port, connect JupyterLab to the stack's network instead, then set `BLUECORE_DB_URL` to use the host `postgres`:

```bash
docker network ls | grep bluecore            # find the stack's network
docker network connect <that network> bluecore-dev-dashboard-jupyter-1
```"""),
    SETUP,
    code('''
import pandas as pd
conn = bc.db()  # read-only

def q(sql, *params):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return pd.DataFrame(cur.fetchall(), columns=[d.name for d in cur.description])

q("select current_database() as db, current_user as user, version()")
'''),
    md("## Tables and their sizes"),
    code('''
q("""
select relname as table, n_live_tup as rows, pg_size_pretty(pg_total_relation_size(relid)) as size
from pg_stat_user_tables
order by n_live_tup desc
""")
'''),
    md("## Records by kind\nHubs, works, instances, other resources and profiles all live in `resource_base`."),
    code('''
q("select type, count(*) as rows, max(updated_at) as last_updated from resource_base group by type order by rows desc")
'''),
    md("## Recent rows of one table\nChange `TABLE` (from the list above)."),
    code('''
TABLE = "resource_base"
cols = q("select column_name from information_schema.columns where table_name = %s order by ordinal_position", TABLE)
order = next((c for c in ["updated_at", "created_at", "id"] if c in set(cols["column_name"])), None)
skip = {"data_vector", "title_vector"}   # long search vectors
shown = ", ".join(f'"{c}"' for c in cols["column_name"] if c not in skip)
q(f'select {shown} from "{TABLE}"' + (f' order by "{order}" desc' if order else "") + " limit 10")
'''),
    md("## Slow or stuck queries right now"),
    code('''
q("""
select pid, state, now() - query_start as running_for, left(query, 120) as query
from pg_stat_activity
where datname = current_database() and state <> 'idle' and pid <> pg_backend_pid()
order by query_start
""")
'''),
]))

made.append(notebook("33-integration-tests", "Integration test triage", DEBUG, [
    md("# Integration test triage\nThe Bluecore Integration Test's recent runs from GitHub (through the dashboard's live API): pass rate, slow runs, and which tests failed and when.\n\nTo reproduce a failure, run the failing test against your local stack (see the stack's Integration Testing docs), and use the other starters to check the services it touches."),
    code('''
import pandas as pd
import requests
from bluecore import DASHBOARD_API
data = requests.get(f"{DASHBOARD_API}/github/ci/blue-core-lod/bluecore-stack/bluecore-integration-test.yml", timeout=60).json()
runs = pd.DataFrame([
    {"run": r["number"], "result": r["conclusion"], "trigger": r["event"], "branch": r["branch"], "started": r["startedAt"],
     "minutes": round((r.get("durationSec") or 0) / 60, 1), "passed": (r.get("tests") or {}).get("passed"), "failed": (r.get("tests") or {}).get("failed"),
     "failed steps": ", ".join(r.get("failedSteps") or []), "url": r["url"]}
    for r in data["runs"]
])
print(data["name"], "-", len(runs), "recent runs of", data["totalRuns"])
runs.head(15)
'''),
    md("## Pass rate and duration"),
    code('''
done = runs[runs["result"].isin(["success", "failure"])]
print(f"Pass rate: {100 * (done['result'] == 'success').mean():.1f}% over {len(done)} finished runs")
ax = runs.sort_values("run").plot(x="run", y="minutes", figsize=(9, 3), title="Duration of each run (minutes)", legend=False)
'''),
    md("## The tests that failed, most often first"),
    code('''
fails = [
    {"test": f.get("name") or f.get("test"), "run": r["number"], "started": r["startedAt"], "error": (f.get("message") or "")[:160]}
    for r in data["runs"]
    for f in ((r.get("tests") or {}).get("failures") or [])
]
fails = pd.DataFrame(fails)
if fails.empty:
    print("No failing tests in these runs.")
else:
    display(fails.groupby("test").agg(times=("run", "count"), last_run=("run", "max")).sort_values("times", ascending=False).head(15))
    display(fails.sort_values("run", ascending=False).head(10))
'''),
]))

# Remove starters that are no longer made here
for old in OUT.glob("*.ipynb"):
    if old.stem not in made:
        old.unlink()
print(f"{len(made)} starters in {OUT}")
