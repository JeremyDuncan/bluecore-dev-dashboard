"""Where Bluecore is, for notebooks: your local stack or a deployed environment (dev, stage).

    from bluecore import target
    bc = target()                      # the environment this notebook runs against
    bc.get("/api/health").json()       # HTTP, relative to the environment's address
    conn = bc.db()                     # Postgres, read-only
    airflow, api = bc.airflow()        # a signed-in session for the Airflow REST API
    token = bc.keycloak_token()        # a Keycloak token for API endpoints that need auth
    bc.example("/works/")              # the API's own example request body for an endpoint
    show(bc.get("/api/health"))        # print a response briefly

A notebook's environment is stored in its metadata (metadata.bluecore.target); the Notebooks page and
the run_notebook MCP tool set it. target("dev") picks one explicitly. Environments: "local" plus the
deployed sites in the dashboard's docs-sources.json (projectStatus.versionDrift.environments).

Settings
- local: the stack checkout BLUECORE_STACK_DIR points at: its .env, and the repo .env templates it
  installs (scripts/dev/env-templates: the API's Keycloak login, ...), unless BLUECORE_URL,
  BLUECORE_DB_URL, AIRFLOW_USER, ... are set in the dashboard's .env.
- deployed: BLUECORE_<NAME>_URL, _AIRFLOW_USER, _AIRFLOW_PASSWORD, _AIRFLOW_TOKEN, _KEYCLOAK_USERNAME,
  _KEYCLOAK_PASSWORD, _KEYCLOAK_CLIENT_ID, _KEYCLOAK_REALM and _DB_URL (e.g. BLUECORE_DEV_AIRFLOW_USER),
  from the dashboard's .env.notebooks.

Environment variables: when a kernel starts, export_env() (IPython startup) sets os.environ to match the
notebook's environment, for notebooks that read variables directly: locally every setting of the stack
(BLUECORE_URL, API_KEYCLOAK_USER, KEYCLOAK_EXTERNAL_URL, ...); for a deployed one only its address and
the logins from .env.notebooks. Switching a notebook's environment restarts its kernel.

Deployed environments are shared, so they're read-only: the HTTP session refuses anything but GET,
HEAD and OPTIONS, and database sessions are read-only. target("dev", allow_writes=True) lifts the HTTP
check for a notebook that really has to write.
"""

import json
import os
import pathlib
import subprocess

import requests

STACK_DIR = pathlib.Path(os.environ.get("BLUECORE_STACK_DIR") or "/bluecore-stack")
SOURCES = pathlib.Path(os.environ.get("DASHBOARD_SOURCES") or "/dashboard/docs-sources.json")
DASHBOARD_API = (os.environ.get("DASHBOARD_API_URL") or "http://mcp:3001/api").rstrip("/")
HOST = "host.docker.internal"  # this machine, seen from the JupyterLab container
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
TIMEOUT = 20
TEMPLATES = STACK_DIR / "scripts" / "dev" / "env-templates"


class ReadOnlyError(RuntimeError):
    """A write to a deployed environment, which notebooks only read."""


class NotConfigured(RuntimeError):
    """A setting the notebook needs isn't set."""


def _env(name):
    return (os.environ.get(name) or "").strip() or None


# Overrides from the dashboard's .env, as the container started (before export_env changes os.environ)
_DASHBOARD_KEYS = ("BLUECORE_URL", "BLUECORE_DB_URL", "AIRFLOW_USER", "AIRFLOW_PASSWORD", "AIRFLOW_TOKEN", "KEYCLOAK_USERNAME", "KEYCLOAK_PASSWORD", "KEYCLOAK_REALM", "KEYCLOAK_CLIENT_ID")
_DASHBOARD = {k: _env(k) for k in _DASHBOARD_KEYS}


def _override(name):
    return _DASHBOARD.get(name)


def _env_file(path):
    """KEY=value lines of a .env file (no interpolation)"""
    values = {}
    try:
        text = path.read_text()
    except OSError:
        return values
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.removeprefix("export ").strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        else:
            value = value.split(" #", 1)[0].strip()
        values[key] = value
    return values


def _on_this_machine(url):
    """localhost in the stack's settings is this machine, which the container reaches as host.docker.internal"""
    for name in ("localhost", "127.0.0.1"):
        url = url.replace(f"//{name}", f"//{HOST}")
    return url


# --- The local stack checkout ---------------------------------------------------------------------


def stack():
    """The local bluecore-stack checkout: where it is, its branch and commit, uncommitted changes"""
    shown = _env("BLUECORE_STACK_SOURCE") or str(STACK_DIR)
    if not (STACK_DIR / "compose-base.yaml").exists() and not (STACK_DIR / "compose.yaml").exists():
        return {"configured": False, "path": shown, "hint": "Set BLUECORE_STACK_DIR in the dashboard's .env to your bluecore-stack checkout, then restart JupyterLab."}

    def git(*args):
        try:
            out = subprocess.run(["git", "-c", "safe.directory=*", "-C", str(STACK_DIR), *args], capture_output=True, text=True, timeout=10)
            return out.stdout.strip() if out.returncode == 0 else None
        except (OSError, subprocess.SubprocessError):
            return None

    changes = git("status", "--porcelain")
    return {
        "configured": True,
        "path": shown,
        "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
        "commit": git("log", "-1", "--format=%h %s (%cr)"),
        "uncommitted": changes.splitlines() if changes else [],
    }


def stack_env():
    """The local stack's settings: the repo .env templates the stack installs into each service's repo
    (bluecore_api.env last, as notebooks mostly talk to the API), then the stack's own .env, with
    localhost turned into an address this container reaches. Empty when BLUECORE_STACK_DIR isn't set."""
    values = {}
    templates = sorted(TEMPLATES.glob("*.env"), key=lambda f: (f.name == "bluecore_api.env", f.name)) if TEMPLATES.is_dir() else []
    for f in templates:
        if f.name != "bluecore-stack.env":  # the seed of the stack's .env, read below
            values.update(_env_file(f))
    values.update(_env_file(STACK_DIR / ".env"))
    return {k: _on_this_machine(v) for k, v in values.items()}


# --- Environments ---------------------------------------------------------------------------------


def _find(obj, key):
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for value in obj.values():
            found = _find(value, key)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for value in obj:
            found = _find(value, key)
            if found is not None:
                return found
    return None


def environments():
    """{name: url} for every environment: local, then the deployed ones"""
    found = {"local": None}
    try:
        drift = _find(json.loads(SOURCES.read_text()), "versionDrift") or {}
        for e in drift.get("environments") or []:
            found[e["name"]] = e["url"].rstrip("/")
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return found


def _local_settings():
    # The defaults are the stack's documented local-development logins (bluecore-stack docs/keycloak.md)
    s = stack_env()
    host = s.get("DATABASE_HOSTNAME") or "postgres"
    db_host = HOST if host in {"postgres", "localhost", "127.0.0.1", HOST} else host
    db_port = s.get("POSTGRES_HOST_PORT") or "5432"  # the port the stack publishes on this machine
    return {
        "url": _override("BLUECORE_URL") or s.get("BLUECORE_URL") or f"http://{HOST}",
        "db_url": _override("BLUECORE_DB_URL")
        or f"postgresql://{s.get('DATABASE_USERNAME') or 'airflow'}:{s.get('DATABASE_PASSWORD') or 'airflow'}@{db_host}:{db_port}/bluecore",
        "airflow_user": _override("AIRFLOW_USER") or s.get("AIRFLOW_WWW_USER_USERNAME") or "developer",
        "airflow_password": _override("AIRFLOW_PASSWORD") or s.get("AIRFLOW_WWW_USER_PASSWORD") or "123456",
        "airflow_token": _override("AIRFLOW_TOKEN"),
        "keycloak_realm": _override("KEYCLOAK_REALM") or s.get("KEYCLOAK_REALM") or "bluecore",
        "keycloak_client_id": _override("KEYCLOAK_CLIENT_ID") or s.get("API_KEYCLOAK_CLIENT_ID") or "bluecore_api",
        "keycloak_username": _override("KEYCLOAK_USERNAME") or s.get("API_KEYCLOAK_USER") or "developer",
        "keycloak_password": _override("KEYCLOAK_PASSWORD") or s.get("API_KEYCLOAK_PASSWORD") or "123456",
    }


def _deployed_settings(name, url):
    p = f"BLUECORE_{name.upper().replace('-', '_')}_"
    return {
        "url": (_env(p + "URL") or url).rstrip("/"),
        "db_url": _env(p + "DB_URL"),
        "airflow_user": _env(p + "AIRFLOW_USER"),
        "airflow_password": _env(p + "AIRFLOW_PASSWORD"),
        "airflow_token": _env(p + "AIRFLOW_TOKEN"),
        "keycloak_realm": _env(p + "KEYCLOAK_REALM") or "bluecore",
        "keycloak_client_id": _env(p + "KEYCLOAK_CLIENT_ID") or "bluecore_api",
        "keycloak_username": _env(p + "KEYCLOAK_USERNAME"),
        "keycloak_password": _env(p + "KEYCLOAK_PASSWORD"),
        "prefix": p,
    }


def notebook_target():
    """The environment this notebook is set to run against (metadata.bluecore.target), else BLUECORE_DEFAULT_TARGET, else local"""
    path = _env("JPY_SESSION_NAME")  # set by Jupyter Server: the kernel's notebook
    if path and path.endswith(".ipynb"):
        try:
            name = json.loads(pathlib.Path(path).read_text()).get("metadata", {}).get("bluecore", {}).get("target")
            if name:
                return name
        except (OSError, ValueError, AttributeError):
            pass
    return _env("BLUECORE_DEFAULT_TARGET") or "local"


# --- Target ---------------------------------------------------------------------------------------


class _Session(requests.Session):
    """requests.Session with a base URL and a default timeout; refuses writes when read-only"""

    def __init__(self, base, read_only, name):
        super().__init__()
        self.base, self.read_only, self.target_name = base, read_only, name

    def request(self, method, url, *args, **kwargs):
        if not url.startswith(("http://", "https://")):
            url = self.base + ("" if url.startswith("/") else "/") + url
        if self.read_only and method.upper() not in SAFE_METHODS:
            raise ReadOnlyError(
                f"{method.upper()} refused: {self.target_name} is a shared, deployed environment and notebooks only read it. "
                f'Use target("{self.target_name}", allow_writes=True) if this notebook really has to write.'
            )
        kwargs.setdefault("timeout", TIMEOUT)
        return super().request(method, url, *args, **kwargs)


class Target:
    """One Bluecore environment: its address, an HTTP session, Postgres, Airflow and Keycloak"""

    def __init__(self, name, settings, deployed, allow_writes=False):
        self.name, self.deployed, self._s = name, deployed, settings
        self.url = settings["url"].rstrip("/")
        self.api = self.url + "/api"
        self.airflow_url = self.url + "/workflows"
        self.read_only = deployed and not allow_writes
        self.http = _Session(self.url, self.read_only, name)

    # HTTP, relative to the environment's address: bc.get("/api/health")
    def get(self, path, **kwargs):
        return self.http.get(path, **kwargs)

    def post(self, path, **kwargs):
        return self.http.post(path, **kwargs)

    def put(self, path, **kwargs):
        return self.http.put(path, **kwargs)

    def delete(self, path, **kwargs):
        return self.http.delete(path, **kwargs)

    def require_writable(self, what="This notebook"):
        """Stops a notebook that writes before it touches a read-only (deployed) environment"""
        if self.read_only:
            raise ReadOnlyError(f"{what} creates and deletes records, so it only runs against your local stack. {self.name} is shared and read-only.")

    # --- The Blue Core API ---

    def openapi(self):
        """The API's OpenAPI spec (cached)"""
        if not hasattr(self, "_spec"):
            self._spec = self.get("/api/openapi.json").json()
        return self._spec

    def example(self, path, content_type="application/ld+json", method="post"):
        """The request body example the API documents for an endpoint, e.g. bc.example("/works/"):
        valid records that the API accepts as they are, kept in step with the API"""
        import copy

        return copy.deepcopy(self.openapi()["paths"][path][method]["requestBody"]["content"][content_type]["example"])

    def sample(self, kind="works", q=""):
        """The UUID of one existing hub, work or instance (the first search result), or None"""
        r = self.get("/api/search/", params={"q": q, "type": kind, "limit": 1})
        results = r.json().get("results") if r.ok else None
        return results[0]["uuid"] if results else None

    def wait_for_run(self, dag_id, run_id, timeout=300, every=3):
        """Waits for an Airflow DAG run to finish: (state, [{task, state}])"""
        import time

        s, api = self.airflow()
        deadline = time.monotonic() + timeout
        while True:
            state = s.get(f"{api}/dags/{dag_id}/dagRuns/{run_id}").json().get("state")
            if state in {"success", "failed"} or time.monotonic() > deadline:
                break
            time.sleep(every)
        tis = s.get(f"{api}/dags/{dag_id}/dagRuns/{run_id}/taskInstances").json().get("task_instances", [])
        return state, [{"task": t["task_id"], "state": t["state"]} for t in tis]

    def _need(self, *keys, what):
        missing = [k for k in keys if not self._s.get(k)]
        if missing:
            names = ", ".join((self._s.get("prefix") or "") + k.upper() for k in missing)
            where = "the dashboard's .env.notebooks" if self.deployed else "the dashboard's .env"
            raise NotConfigured(f"{what} on {self.name} needs {names}. Set it in {where}, then restart JupyterLab (docker compose --profile notebooks up -d jupyter).")

    def keycloak_token(self):
        """An access token from Keycloak (password grant), for API endpoints that need auth"""
        self._need("keycloak_username", "keycloak_password", what="A Keycloak token")
        s = self._s
        r = requests.post(
            f"{self.url}/keycloak/realms/{s['keycloak_realm']}/protocol/openid-connect/token",
            data={"grant_type": "password", "client_id": s["keycloak_client_id"], "username": s["keycloak_username"], "password": s["keycloak_password"]},
            timeout=TIMEOUT,
        )
        if not r.ok:
            raise NotConfigured(f"Keycloak on {self.name} refused the login ({r.status_code}). Check the username and password.")
        return r.json()["access_token"]

    def auth_headers(self):
        return {"Authorization": f"Bearer {self.keycloak_token()}"}

    def airflow(self):
        """(session, api_base) for the Airflow REST API: Airflow 3 (api/v2, a token) or Airflow 2 (api/v1, basic auth)"""
        session = _Session(self.airflow_url, self.read_only, self.name)
        if self._s.get("airflow_token"):
            session.headers["Authorization"] = f"Bearer {self._s['airflow_token']}"
            return session, f"{self.airflow_url}/api/v2"
        self._need("airflow_user", "airflow_password", what="Airflow")
        r = requests.post(f"{self.airflow_url}/auth/token", json={"username": self._s["airflow_user"], "password": self._s["airflow_password"]}, timeout=TIMEOUT)
        if r.ok and "access_token" in r.json():
            session.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
            return session, f"{self.airflow_url}/api/v2"
        session.auth = (self._s["airflow_user"], self._s["airflow_password"])
        return session, f"{self.airflow_url}/api/v1"

    def db(self, database=None):
        """A read-only Postgres connection (psycopg), to the bluecore database unless another is named"""
        import psycopg

        if self.deployed and not self._s.get("db_url"):
            raise NotConfigured(
                f"{self.name}'s database isn't reachable from here. If you have access (e.g. an SSH tunnel), "
                f"set {self._s['prefix']}DB_URL in the dashboard's .env.notebooks."
            )
        url = self._s["db_url"]
        if database:
            url = url.rsplit("/", 1)[0] + "/" + database
        conn = psycopg.connect(url, connect_timeout=10, autocommit=True)
        conn.execute("SET default_transaction_read_only = on")  # notebooks only read
        return conn

    def describe(self):
        mode = "deployed, read-only" if self.read_only else ("deployed, writes allowed" if self.deployed else "your local stack")
        lines = [f"**Target: {self.name}** · {self.url} · {mode}"]
        if not self.deployed:
            st = stack()
            if st["configured"]:
                dirty = f", {len(st['uncommitted'])} uncommitted change(s)" if st["uncommitted"] else ""
                lines.append(f"Stack checkout: `{st['path']}` · {st['branch']} @ {st['commit']}{dirty}")
            else:
                lines.append("Stack checkout: not set (BLUECORE_STACK_DIR); using the documented local defaults")
        return "  \n".join(lines)

    def _repr_markdown_(self):
        return self.describe()

    def __repr__(self):
        return f"<Bluecore target {self.name}: {self.url}{' (read-only)' if self.read_only else ''}>"


def show(r, chars=1500):
    """Prints a response briefly: method, path and status, then its JSON (indented) or text, cut at chars"""
    from urllib.parse import urlsplit

    u = urlsplit(r.url)
    print(f"{r.request.method} {u.path}{'?' + u.query if u.query else ''} → {r.status_code} {r.reason}")
    if not r.content:
        return
    try:
        text = json.dumps(r.json(), indent=1, ensure_ascii=False)
    except ValueError:
        text = r.text
    print(text[:chars] + (f"\n… ({len(text) - chars} more characters)" if len(text) > chars else ""))


def marc21(fields, leader="00000nam a2200000 a 4500"):
    """A binary MARC21 (ISO 2709) record from [(tag, value)] for control fields and
    [(tag, "ind1ind2", [(code, value), ...])] for data fields: test data for /marc2xml"""
    FT, RT, SD = b"\x1e", b"\x1d", b"\x1f"
    directory, data = b"", b""
    for f in fields:
        tag = f[0]
        body = f[1].encode() if len(f) == 2 else f[1].encode() + b"".join(SD + c.encode() + v.encode() for c, v in f[2])
        body += FT
        directory += f"{tag}{len(body):04d}{len(data):05d}".encode()
        data += body
    base = 24 + len(directory) + 1
    total = base + len(data) + 1
    lead = f"{total:05d}{leader[5:12]}{base:05d}{leader[17:]}".encode()
    return lead + directory + FT + data + RT


def target(name=None, *, allow_writes=False):
    """The environment to work with: name, else the notebook's (see notebook_target)"""
    name = name or notebook_target()
    envs = environments()
    if name == "local":
        return Target("local", _local_settings(), deployed=False)
    if name not in envs:
        raise NotConfigured(f'No environment "{name}". Environments: {", ".join(envs)} (deployed ones come from docs-sources.json).')
    return Target(name, _deployed_settings(name, envs[name]), deployed=True, allow_writes=allow_writes)


def export_env(name=None):
    """Sets os.environ to match the notebook's environment, for notebooks that read variables directly.
    Locally: every setting of the stack (stack_env) that isn't set already, then the connection settings.
    Deployed: only its address and the logins from .env.notebooks; local values are removed, so a
    notebook never mixes the two. Called by the IPython startup when a kernel starts."""
    t = target(name)
    s = t._s
    if not t.deployed:
        for key, value in stack_env().items():
            if not _env(key):
                os.environ[key] = value
    settings = {
        "BLUECORE_TARGET": t.name,
        "BLUECORE_URL": t.url,
        "API_URL": t.api,
        "AIRFLOW_EXTERNAL_URL": t.airflow_url + "/",
        "KEYCLOAK_EXTERNAL_URL": t.url + "/keycloak/",
        "KEYCLOAK_REALM": s.get("keycloak_realm"),
        "API_KEYCLOAK_CLIENT_ID": s.get("keycloak_client_id"),
        "BLUECORE_DB_URL": s.get("db_url"),
        "AIRFLOW_USER": s.get("airflow_user"),
        "AIRFLOW_PASSWORD": s.get("airflow_password"),
        "KEYCLOAK_USERNAME": s.get("keycloak_username"),
        "KEYCLOAK_PASSWORD": s.get("keycloak_password"),
        "API_KEYCLOAK_USER": s.get("keycloak_username"),
        "API_KEYCLOAK_PASSWORD": s.get("keycloak_password"),
    }
    for key, value in settings.items():
        if value:
            os.environ[key] = value
        else:
            os.environ.pop(key, None)
    return t
