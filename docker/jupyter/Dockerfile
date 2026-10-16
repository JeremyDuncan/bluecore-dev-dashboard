# JupyterLab for debugging and troubleshooting the Bluecore stack (docker-compose.yml, service "jupyter").
# Notebooks live in ./notebooks (NOTEBOOKS_DIR), shared with the MCP server, which lists, edits and runs
# them for the Notebooks page and the notebook MCP tools.
FROM python:3.12-slim

# git: the helper reports the local stack checkout's branch and uncommitted changes
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# A small debugging toolkit: HTTP clients for the API, Airflow and Keycloak; Postgres; tables and charts;
# bluecore-client, the Blue Core API's Python client
RUN pip install --no-cache-dir \
      jupyterlab==4.2.5 \
      ipykernel==6.29.5 \
      requests==2.32.3 \
      httpx==0.28.1 \
      "psycopg[binary]==3.2.3" \
      pandas==2.2.3 \
      matplotlib==3.9.2 \
      python-dotenv==1.1.1 \
      tabulate==0.9.0 \
      bluecore-client==0.2.0

# bluecore.py: where each environment is (local stack or dev/stage), for `from bluecore import target`.
# docker-compose.yml also mounts it over this copy, so edits apply on a kernel restart.
COPY bluecore.py /opt/bluecore/bluecore.py
COPY startup.py /root/.ipython/profile_default/startup/00-bluecore.py
ENV PYTHONPATH=/opt/bluecore

WORKDIR /notebooks
EXPOSE 8888

# A new random token on every start (unless JUPYTER_TOKEN is set), written where the MCP server reads
# it; the Notebooks page links to JupyterLab with it. allow_remote_access: the MCP server connects
# from its own container; the port is only published on 127.0.0.1. Kernels idle for 15 minutes are
# shut down, so notebooks run from the page or by agents don't pile up memory next to the stack.
# extension_manager=readonly: no installing JupyterLab extensions from the UI (the image defines what's
# there), which also skips JupyterLab 4.2's PyPI manager, which fails with httpx 0.28 (bluecore-client).
CMD ["sh", "-c", "TOKEN=\"${JUPYTER_TOKEN:-$(python -c 'import secrets; print(secrets.token_hex(24))')}\"; mkdir -p /run/jupyter && printf %s \"$TOKEN\" > /run/jupyter/token && exec jupyter lab --ip=0.0.0.0 --port=8888 --no-browser --allow-root --ServerApp.root_dir=/notebooks --ServerApp.allow_remote_access=True --IdentityProvider.token=\"$TOKEN\" --LabApp.extension_manager=readonly --MappingKernelManager.cull_idle_timeout=900 --MappingKernelManager.cull_interval=120 --ServerApp.terminado_settings='{\"shell_command\": [\"/bin/bash\"]}'"]
